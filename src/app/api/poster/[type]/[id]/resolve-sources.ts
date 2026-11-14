import type { NextRequest } from "next/server"
import { getImages, getDetails, getDetailsWithExternalIds, type TMDBImage, type TMDBCompany } from "@/lib/tmdb"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { ServerDefaults } from "@/lib/server-defaults"
import { BEST_FIT_GLOBAL, resolveLogoFitEnabled } from "@/lib/best-fit-config"
import { AUTO_FIT_FETCH_TIMEOUT_MS, selectAutoFitCandidates, selectBestLogoFitPosterPath } from "@/lib/poster-auto-fit"
import { matchTMDBStudios } from "@/lib/awards"
import { fetchAggregatedRating, isMdbTmdbIdentityUsable } from "@/lib/ratings"
import { rotationIndexFor } from "@/lib/poster-rotation"
import { getTMDBSessionCache, setTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchImg, imgSrc } from "@/lib/poster-render-helpers"
import { landscapeBackdropUrl, cropBackdropToPortrait } from "@/lib/image-utils"
import { fetchValidatedCustomImage } from "@/lib/custom-poster-base"
import { isCustomPosterUrl } from "@/lib/utils"
import { selectBestLogo, logoBestLogoFallbackReason } from "@/lib/logo-selection"
import { resolveAutoWordmark, resolveTextLogo } from "@/lib/text-logo"
import { combineAbortSignals } from "@/lib/abort-signal"
import { cachedImageBytes } from "@/lib/image-bytes-cache"
import { timedFetch, readResponseBody } from "@/lib/outbound-stats"
import { createLogger } from "@/lib/logger"
import type { PosterAdmission } from "./admission"
import { POSTER_TMDB_TIMEOUT_MS, RATING_WAIT_MS } from "./constants"
import type { PosterArtwork, PosterTitleMeta } from "./sources"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

// Rami di risoluzione delle sorgenti del render (fase G della poster route):
// poster esplicito in query, mapping salvato, automatico TMDB. Ognuno popola
// `artwork` e `titleMeta` e ritorna i valori scalari che la route usa dopo.
// Il corpo dei rami è spostato da route.ts senza modifiche.

/** Valori della richiesta letti dai rami (tutti già risolti, mai riassegnati). */
export interface SourceResolutionContext {
  readonly req: NextRequest
  readonly hardenedParams: URLSearchParams
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly mapping: Mapping | null
  readonly earlyEffMapping: Mapping | null
  readonly sd: ServerDefaults
  readonly configOverride: PosterAdmission["configOverride"]
  readonly posterRegion: RegionDef
  readonly canonicalLang: string | null
  readonly isLandscape: boolean
  readonly autoWordmarkEnabled: boolean
  readonly portraitBackdropFallback: boolean
  readonly dynamicDayBucket: number | null
  readonly dynamicRotationIncludeNonClean: boolean
  readonly effTmdbKey: string | undefined
  readonly effMdblistKey: string | undefined
  readonly effSimklKey: string | undefined
  readonly reqRatingSources: string[]
  readonly renderAbort: AbortController
  readonly queryPoster: string | null
  readonly queryLogo: string | null
  readonly queryBackdrop: string | null
  readonly queryPortraitBase: string | null
  readonly queryGenre: string | null
  readonly queryVote: string | null
}

export interface ExplicitSourcesResult {
  showBadges: boolean
  rankingBadges: boolean
}

export interface AutoSourcesResult {
  aggregatedRating: ReturnType<typeof fetchAggregatedRating> | null
  ratingAbort: AbortController | null
}

/** Ramo query: l'editor passa poster/logo/backdrop e i metadati in chiaro. */
export function resolveQuerySources(
  ctx: SourceResolutionContext,
  artwork: PosterArtwork,
  titleMeta: PosterTitleMeta,
): ExplicitSourcesResult {
  const {
    req, hardenedParams, mediaType, queryPoster, queryLogo, queryBackdrop, queryGenre,
    queryVote,
  } = ctx
  let showBadges = true
  let rankingBadges = true
  artwork.posterPath = queryPoster
  artwork.logoPath = queryLogo || null
  artwork.backdropPath = queryBackdrop || null
  if (queryBackdrop) {
    artwork.backdropScale = Number(hardenedParams.get("bscale") || "100")
    // Bound inferiore + superiore: un valore come 1e-7 produrrebbe resize(0,0) → 500.
    if (!Number.isFinite(artwork.backdropScale) || artwork.backdropScale < 5 || artwork.backdropScale > 500) artwork.backdropScale = 100
    artwork.backdropOffsetX = Number(hardenedParams.get("box") || "0")
    if (!Number.isFinite(artwork.backdropOffsetX)) artwork.backdropOffsetX = 0
    artwork.backdropOffsetY = Number(hardenedParams.get("boy") || "0")
    if (!Number.isFinite(artwork.backdropOffsetY)) artwork.backdropOffsetY = 0
  }
  if (queryGenre) titleMeta.genreName = queryGenre
  if (queryVote) {
    titleMeta.voteAverage = Number(queryVote)
    if (!Number.isFinite(titleMeta.voteAverage)) titleMeta.voteAverage = null
    else titleMeta.voteAverage = Math.min(Math.max(titleMeta.voteAverage, 0), 10) // clamp a [0,10]
  }
  // Fix M1: anno della preview (WYSIWYG). Senza, il ramo query non impostava
  // releaseDate/firstAirDate e il badge genere della preview ometteva
  // "• 2024" presente invece sul poster finale.
  // Date complete (`rd`/`fad`) quando il client le conosce: l'anno da solo
  // diventa `${y}-01-01` e cade fuori dalla finestra theatrical del
  // rilevamento pre-digitale (desync preview/finale).
  const queryRd = hardenedParams.get("rd")
  const queryFad = hardenedParams.get("fad")
  if (mediaType === "tv" && queryFad && /^\d{4}-\d{2}-\d{2}$/.test(queryFad)) {
    titleMeta.firstAirDate = queryFad
  } else if (mediaType !== "tv" && queryRd && /^\d{4}-\d{2}-\d{2}$/.test(queryRd)) {
    titleMeta.releaseDate = queryRd
  } else {
    const queryYear = hardenedParams.get("year")
    if (queryYear && /^\d{4}$/.test(queryYear.slice(0, 4))) {
      const y = queryYear.slice(0, 4)
      if (mediaType === "tv") titleMeta.firstAirDate = `${y}-01-01`
      else titleMeta.releaseDate = `${y}-01-01`
    }
  }
  titleMeta.imdbId = hardenedParams.get("imdbId") || titleMeta.imdbId
  showBadges = req.nextUrl.searchParams.get("badges") !== "0"
  rankingBadges = req.nextUrl.searchParams.get("ranking") !== "0"
  return { showBadges, rankingBadges }
}

/** Ramo mapping: titolo salvato (base, logo/wordmark, backdrop, genere localizzato). */
export async function resolveMappingSources(
  ctx: SourceResolutionContext,
  mapping: Mapping,
  artwork: PosterArtwork,
  titleMeta: PosterTitleMeta,
): Promise<ExplicitSourcesResult> {
  const {
    mediaType, tmdbId, autoWordmarkEnabled, canonicalLang, earlyEffMapping, effTmdbKey,
    isLandscape, queryBackdrop, queryGenre, queryLogo, queryPortraitBase, renderAbort,
  } = ctx
  let showBadges = true
  let rankingBadges = true
  artwork.posterPath = mapping.posterPath
  // Base portrait congelata dal save in modalità auto: la base resa è il
  // cover-crop 2:3 di quel backdrop, non il poster in lingua. La base custom
  // salvata vince sempre (stessa precedenza del ramo custom, invariato) e il
  // landscape resta su `backdropPath`: qui solo portrait senza custom.
  // La scelta live dell'editor (`pbase`) vince sulla base salvata: stessa
  // catena query > mapping degli altri parametri.
  artwork.mappingPortraitBackdropPath = !isLandscape && !(mapping.customPosterUrl && isCustomPosterUrl(mapping.customPosterUrl))
    ? (queryPortraitBase ?? mapping.portraitBackdropPath ?? null)
    : null
  // Logo identity per shape (portrait flat / landscape profile): a title
  // saved portrait clean without logo and landscape with a logo must render
  // each shape with its own identity. Reading the flat mapping here leaked
  // the landscape logo onto the portrait Test URL (/meta poster) and the
  // catalog portrait rendering. Same `effectiveMappingForShape` chain as the
  // rest of the per-shape fields; legacy mappings without profile logo keys
  // inherit the flat exactly as before.
  const shapeEffLogo = effectiveMappingForShape(mapping, isLandscape ? "landscape" : "poster") ?? mapping
  // Logo manuale anche su portrait non-clean: il default resta nessun auto
  // a monte, ma il logoPath esplicito (mapping o ?logo=) è ammesso in ogni
  // formato. logoDisabled sempre onorato; query esplicita vince.
  const effectiveMappingLogo = !shapeEffLogo.logoDisabled ? shapeEffLogo.logoPath : null
  artwork.logoPath = queryLogo || effectiveMappingLogo
  // Wordmark salvato (stessa catena: query > mapping, logoDisabled onorato).
  // Vince sul logoPath del mapping (una sola sorgente logo): un titolo
  // salvato con testo non ha più un logo immagine da comporre.
  if (!artwork.textLogo && !shapeEffLogo.logoDisabled) {
    artwork.textLogo = resolveTextLogo(shapeEffLogo.logoText ?? null, shapeEffLogo.logoFont ?? null)
  }
  // Wordmark automatico (mapping): nessun logo salvato o selezionato, titolo
  // noto e base senza titolo cotto — poster clean (`language === null`,
  // stessa semantica del reopen) o base portrait congelata dal save
  // (`portraitBackdropPath` / `pbase`, backdrop textless) o backdrop del
  // landscape. Una base custom URL non è certificabile come textless: mai
  // wordmark sopra. Il testo NON viene salvato: si rigenera a ogni render.
  if (!artwork.textLogo && !artwork.logoPath) {
    const mappingCustomPoster = !!(mapping.customPosterUrl && isCustomPosterUrl(mapping.customPosterUrl))
    const mappingCustomBackdrop = !!(mapping.customBackdropUrl && isCustomPosterUrl(mapping.customBackdropUrl))
    const auto = resolveAutoWordmark({
      enabled: autoWordmarkEnabled,
      title: mapping.title,
      hasImageLogo: false,
      hasTypedText: false,
      logoDisabled: shapeEffLogo.logoDisabled === true,
      baseIsTextless: isLandscape
        ? !mappingCustomBackdrop
        : !mappingCustomPoster && (artwork.mappingPortraitBackdropPath !== null || mapping.language === null),
    })
    if (auto) {
      artwork.textLogo = auto
      artwork.textLogoAuto = true
    }
  }
  artwork.backdropPath = queryBackdrop || mapping?.backdropPath || null
  artwork.backdropScale = mapping?.backdropScale ?? 100
  // Fix M5: clamp difensivo anche sui mapping già salvati (pre-bounds zod):
  // 0/negativi rompono resizeBackdropCached → 500 permanente.
  if (!Number.isFinite(artwork.backdropScale) || artwork.backdropScale < 5 || artwork.backdropScale > 500) artwork.backdropScale = 100
  artwork.backdropOffsetX = mapping?.backdropOffsetX ?? 0
  artwork.backdropOffsetY = mapping?.backdropOffsetY ?? 0
  titleMeta.genreName = mapping.genreName ?? null
  // A saved genre is a localized string, not a language-independent ID.
  // Explicit poster language wins, just as it does for automatic posters.
  const genreLang = canonicalLang
  if (titleMeta.genreName && genreLang && effTmdbKey && (earlyEffMapping?.showBadges ?? mapping.showBadges) !== false && !queryGenre) {
    try {
      const cached = getTMDBSessionCache(mediaType, tmdbId, genreLang)
      const localizedDetails = cached?.details
        ?? await getDetails(mediaType, tmdbId, genreLang, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS)
      if (!cached?.details && localizedDetails) {
        setTMDBSessionCache(mediaType, tmdbId, genreLang, { ...cached ?? undefined, details: localizedDetails })
      }
      titleMeta.genreName = localizedDetails?.genres?.[0]?.name || titleMeta.genreName
      if (Array.isArray(localizedDetails?.genres)) {
        titleMeta.genreIds = localizedDetails.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id))
      }
    } catch {
      // Keep the saved genre if TMDB is unavailable.
    }
  }
  titleMeta.voteAverage = mapping.voteAverage ?? null
  showBadges = earlyEffMapping?.showBadges ?? mapping.showBadges ?? true
  rankingBadges = earlyEffMapping?.rankingBadges ?? mapping.rankingBadges ?? true
  // IMDb ID salvato al save (il path `tt...` vince se presente): evita il
  // fallback getExternalIds che richiede una chiave TMDB assente in Stremio.
  titleMeta.imdbId = titleMeta.imdbId ?? mapping.imdbId ?? null
  // Niente uscita 304 anticipata qui: un validatore sintetico non
  // rappresenterebbe i byte (rank live e altre dipendenze dinamiche) — la
  // decisione 304/200 avviene solo dopo aver risolto il contenuto
  // (hit fresca) o ri-renderizzato (audit freschezza, problemi 1–2).
  return { showBadges, rankingBadges }
}

/**
 * Ramo automatico (titolo non salvato): details/images/external_ids TMDB con
 * session cache, scelta poster/logo/backdrop (best-fit, rotazione dinamica,
 * fallback lingua), voto aggregato avviato qui e atteso dopo il blocco dati.
 * Un errore upstream imposta `artwork.autoFetchFailed` (503, non 404).
 */
export async function resolveAutoSources(
  ctx: SourceResolutionContext,
  artwork: PosterArtwork,
  titleMeta: PosterTitleMeta,
): Promise<AutoSourcesResult> {
  const {
    req, sd, mediaType, tmdbId, configOverride, posterRegion, canonicalLang, isLandscape,
    autoWordmarkEnabled, portraitBackdropFallback, dynamicDayBucket,
    dynamicRotationIncludeNonClean, effTmdbKey, effMdblistKey, effSimklKey, reqRatingSources,
    renderAbort, queryBackdrop, queryLogo, queryPortraitBase,
  } = ctx
  let aggregatedRating: ReturnType<typeof fetchAggregatedRating> | null = null
  let ratingAbort: AbortController | null = null
  const preferredLanguage = canonicalLang || posterRegion.lang2
  artwork.posterRequestedLang = preferredLanguage
  const apiKey = effTmdbKey
  try {
    // F6: session cache editor — i tick di preview sullo stesso titolo
    // non-mappato riusano details/images/externalIds senza rifare la rete.
    // P1: il primo fetch delle immagini parte in PARALLELO con details e
    // externalIds (non aspetta original_language) usando solo le lingue
    // preferite. original_language servirebbe solo per ritentare quando
    // mancano poster E logo nelle lingue base (tipico: titolo in lingua
    // piccola): aggiungerla sempre a ogni richiesta costerebbe un payload più
    // grande e la stessa RTT, quindi il retry è condizionato e paga l'extra
    // RTT solo nei casi in cui aggiunge davvero qualcosa.
    const sessionData = getTMDBSessionCache(mediaType, tmdbId, preferredLanguage)
    let details: Awaited<ReturnType<typeof getDetails>>
    let images: Awaited<ReturnType<typeof getImages>>
    let extIds: { imdb_id: string | null; tvdb_id?: number | null; wikidata_id?: string | null }
    if (sessionData?.details && sessionData.images) {
      details = sessionData.details
      images = sessionData.images
      extIds = sessionData.externalIds ?? { imdb_id: null, tvdb_id: null }
    } else {
      const baseLangs = `${preferredLanguage},en,null`
      // D4: details + external_ids in un colpo solo (niente RTT separato per
      // gli external_ids). Stesso schema/chiavi del path cataloghi.
      const [det, imgs] = await Promise.all([
        getDetailsWithExternalIds(mediaType, tmdbId, preferredLanguage, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS),
        getImages(mediaType, tmdbId, baseLangs, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS),
      ])
      details = det
      extIds = {
        imdb_id: det.external_ids?.imdb_id ?? null,
        tvdb_id: det.external_ids?.tvdb_id ?? null,
        wikidata_id: det.external_ids?.wikidata_id ?? null,
      }
      const origLang = det.original_language
      // Con clean DISABILITATI (`disableCleanPosters` ON) il pool in lingua
      // originale serve sempre: la catena base non può più chiudere sul
      // clean (`posters[0]` può esserlo), quindi un titolo con soli clean
      // nelle lingue base resterebbe senza base. Il retry paga l'extra RTT
      // solo quando `origLang` aggiunge davvero una lingua (distinta da
      // preferita/en), fail-open come prima (il catch tiene `imgs`).
      // Con clean ABILITATI la condizione storica resta invariata.
      const cleanDisabled = sd.disableCleanPosters === true
      const needsOrigLang = origLang && origLang !== preferredLanguage && origLang !== "en"
        && (imgs.posters.length === 0 || imgs.logos.length === 0 || cleanDisabled)
      images = needsOrigLang
        ? await getImages(mediaType, tmdbId, `${baseLangs},${origLang}`, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => imgs)
        : imgs
      setTMDBSessionCache(mediaType, tmdbId, preferredLanguage, { details: det, images, externalIds: extIds })
    }
    // Candidato sfondo per il ramo landscape: backdrop principale TMDB,
    // poi il primo backdrops di /images (già 16:9 nativi).
    titleMeta.autoTitle = details.title || details.name || null
    artwork.autoBackdropPath = details.backdrop_path || images.backdrops[0]?.file_path || null
    titleMeta.imdbId = extIds.imdb_id
    // Non sovrascrivere un QID già risolto a monte (query > mapping >
    // session): il fetch qui è l'ultima ruota, non la prima.
    if (!titleMeta.wikidataId) titleMeta.wikidataId = extIds.wikidata_id ?? null
    // A1: fetch deferito — la media TMDB+IMDb parte subito ma non blocca.
    // Simkl solo se tra le fonti richieste: la colonna separati pesca da
    // reqRatingSources, quindi sep=1 senza simkl in rsrc non deve pagare i
    // 2 hop Simkl (BYOK: solo chi ha la chiave li pagherebbe comunque).
    // Stessa regola per le fonti anime (AniZip + provider, solo se richieste).
    const wantSimkl = reqRatingSources.includes("simkl") && !!effSimklKey
    const wantAnilist = reqRatingSources.includes("anilist")
    const wantKitsu = reqRatingSources.includes("kitsu")
    const wantImdb = reqRatingSources.includes("imdb")
    // Task C: senza IMDb ma con TMDB id + tipo esplicito si richiedono
    // comunque le fonti via /tmdb/{movie|show}/ (stesso endpoint condiviso,
    // nessuna seconda resa).
    const canRequestRatings = !!titleMeta.imdbId || isMdbTmdbIdentityUsable(tmdbId, mediaType)
    ratingAbort = canRequestRatings ? new AbortController() : null
    aggregatedRating = canRequestRatings
      ? fetchAggregatedRating(titleMeta.imdbId, effMdblistKey, AbortSignal.any([renderAbort.signal, ratingAbort!.signal]), {
          simklKey: effSimklKey,
          tmdbId,
          mediaType,
          wantSimkl,
          wantAnilist,
          wantKitsu,
          wantImdb,
          requestedSources: reqRatingSources,
          ratingWaitMs: RATING_WAIT_MS,
          // Voto TMDB diretto come backfill di sources.tmdb (MDBList down).
          tmdbFallbackVote: details.vote_average ?? undefined,
        }).catch(() => null)
      : Promise.resolve(null)
    titleMeta.genreName = details.genres[0]?.name || null
    titleMeta.genreIds = Array.isArray(details.genres) ? details.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id)) : null
    titleMeta.voteAverage = details.vote_average ?? 0
    titleMeta.releaseDate = details.release_date || null
    titleMeta.firstAirDate = details.first_air_date || null
    titleMeta.lastAirDate = details.last_air_date || null
    titleMeta.seasonCount = details.number_of_seasons ?? null
    titleMeta.nextEpisodeAirDate = details.next_episode_to_air?.air_date || null
    titleMeta.numberOfEpisodes = details.number_of_episodes ?? null
    titleMeta.originCountries = [...(details.networks || []), ...(details.production_companies || [])]
      .map((c) => c.origin_country)
      .filter((c): c is string => !!c)
    titleMeta.tmdbNetworks = (details.networks || []).map((n: TMDBCompany) => n.name)
    titleMeta.tmdbNetworksDetailed = (details.networks || []).map((n: TMDBCompany) => ({ name: n.name, logoPath: n.logo_path }))
    titleMeta.productionCompanies = (details.production_companies || []).map((c: TMDBCompany) => c.name)
    titleMeta.productionCompaniesDetailed = (details.production_companies || []).map((c: TMDBCompany) => ({ name: c.name, logoPath: c.logo_path }))
    titleMeta.tmdbStudios = matchTMDBStudios([...titleMeta.tmdbNetworks, ...titleMeta.productionCompanies])
    titleMeta.tvType = details.type || null
    titleMeta.tvStatus = details.status || null
    // H1: no slot held across the network waits below (logo-fit fetches,
    // Block A/B, Wikidata). The single render slot is acquired just before
    // the composite; the finally still releases it.
    const allLogos: TMDBImage[] = images.logos

    // Il logo si risolve PRIMA del poster. Serve a due cose: i livelli con
    // backdrop valgono solo se c'è un logo da appoggiarci sopra (un backdrop
    // ritagliato senza logo è un'immagine senza titolo), e prima il logo
    // veniva scelto solo dentro il ramo "esiste un poster clean", quindi il
    // ramo senza clean non ne aveva mai uno.
    if (queryLogo) {
      // Custom logo from an external tile (same policy as the custom base):
      // wins directly without a TMDB list match. TMDB paths stay bound to
      // the exact list match as before.
      if (isCustomPosterUrl(queryLogo)) artwork.logoPath = queryLogo
      else {
        const exact = allLogos.find((l: TMDBImage) => l.file_path === queryLogo)
        if (exact) artwork.logoPath = exact.file_path
      }
    }
    if (!artwork.logoPath && !artwork.textLogo) {
      // Default = primo logo del gruppo lingua, lo stesso che mostra il
      // client (`selectBestLogo` in context.tsx): nessun re-ranking per
      // leggibilità, così Stremio rende lo stesso logo della preview.
      const chosenLogo = selectBestLogo(allLogos, preferredLanguage, details.original_language)
      const reason = logoBestLogoFallbackReason(chosenLogo, preferredLanguage, details.original_language)
      if (reason === "origLang") log.info("Logo fallback to original_language", { lang: details.original_language, mediaType, tmdbId })
      else if (reason === "any") log.info("Logo fallback to any (first available)", { mediaType, tmdbId })
      else if (reason === "none") log.info("No logo available", { mediaType, tmdbId })
      artwork.logoFallbackReason = reason
      if (chosenLogo) { artwork.logoPath = chosenLogo.file_path; artwork.logoChosenIso = chosenLogo.iso_639_1 ?? null }
    }
    // Text-as-logo: il testo digitato è la sorgente logo esplicita e vince
    // sulla selezione TMDB appena fatta (una sola sorgente logo, la stessa
    // della preview). Senza testo tutto il ramo sotto resta identico.
    if (artwork.textLogo) {
      artwork.logoPath = null
      artwork.logoPathBuffer = null
    }
    // Un titolo ha un logo (immagine o wordmark)? I gate sotto (clean,
    // rotazione, base portrait da backdrop) valgono per ENTRAMBE le
    // sorgenti: un wordmark composto su un poster in lingua sarebbe un
    // doppio titolo, quindi la catena base resta quella del logo.
    const cleanEnabled = sd.disableCleanPosters !== true
    const clean = cleanEnabled ? images.posters.find((p: TMDBImage) => p.iso_639_1 === null) : undefined
    // Wordmark automatico (titolo senza alcun logo TMDB): eleggibile solo con
    // una base che NON ha un titolo cotto — poster clean, landscape (base =
    // backdrop textless con almeno un backdrop disponibile) o il crop 2:3 del
    // primo backdrop nel ramo senza clean. Nessun logo immagine e nessun testo
    // digitato: quelli vincono sempre. Con clean disabilitati la catena "in
    // lingua" resta storica (poster col titolo stampato, nessun wordmark).
    if (!artwork.logoPath && !artwork.textLogo && cleanEnabled) {
      const auto = resolveAutoWordmark({
        enabled: autoWordmarkEnabled,
        title: titleMeta.autoTitle,
        hasImageLogo: false,
        hasTypedText: false,
        logoDisabled: false,
        baseIsTextless: !!clean || (isLandscape
          ? !!details.backdrop_path || (images.backdrops?.length ?? 0) > 0
          : (images.backdrops?.length ?? 0) > 0),
      })
      if (auto) {
        artwork.textLogo = auto
        artwork.textLogoAuto = true
        log.info("Text logo — auto wordmark from title", { mediaType, tmdbId, auto: true })
      }
    }
    const hasTitleLogo = !!artwork.logoPath || !!artwork.textLogo

    // Opzione "disattiva clean" (default OFF = priorità ai clean): con flag ON
    // il ramo clean è saltato del tutto e si usa la catena in lingua sotto
    // (badge invariati, niente logo sopra in portrait). Mapping salvati e
    // scelta manuale (query poster=) non passano di qui.
    if (clean) {
      // Ramo clean: best-fit pesca solo dalla pool clean, quindi il poster
      // finale resta clean (logo tenuto) salvo il fallback in lingua sotto.
      artwork.autoPosterClean = true
      const qLogoFit = req.nextUrl.searchParams.get("logoFit")
      // Catena in best-fit-config.ts: globale > query > config token >
      // per-shape del namespace > legacy. Default spento.
      const logoFitEnabled = resolveLogoFitEnabled({
        global: BEST_FIT_GLOBAL,
        queryLogoFit: qLogoFit,
        configLogoFit: configOverride?.logoFitEnabled,
        sdFit: sd,
        isLandscape,
      })
      // Rotazione giornaliera dinamici portrait (cut 02:00 UTC):
      // precede il best-fit così il cambio giorno cambia davvero la base.
      // Solo con logo (un clean senza logo non ha titolo da comporre) e con
      // almeno 2 candidati, altrimenti fallback storico invariato.
      // Default globale `defaultRotationIncludeNonClean` (solo titoli NON
      // mappati): quando ON il pool aggiunge i poster della lingua richiesta
      // accanto ai clean. I titoli mappati non passano da qui (dynamicDayBucket
      // e' null con mapping) e restano governati dal flag per-titolo.
      const preferredLangKey = preferredLanguage.trim().toLowerCase().split(/[-_]/)[0]
      const dynamicPortraitPool = (dynamicDayBucket !== null && !isLandscape && hasTitleLogo)
        ? images.posters.filter((p: TMDBImage) =>
            p.iso_639_1 === null
            || (dynamicRotationIncludeNonClean
              && typeof p.iso_639_1 === "string"
              && p.iso_639_1.trim().toLowerCase().split(/[-_]/)[0] === preferredLangKey))
        : []
      if (dynamicDayBucket !== null && dynamicPortraitPool.length >= 2) {
        const picked = dynamicPortraitPool[rotationIndexFor(dynamicDayBucket, dynamicPortraitPool.length)]
        artwork.posterPath = picked.file_path
        const pickedNonClean = picked.iso_639_1 !== null
        artwork.autoPosterClean = !pickedNonClean
        if (pickedNonClean) {
          // Un poster in lingua ha gia' il titolo cotto: nessun secondo
          // titolo (logo/wordmark) sopra la base.
          artwork.logoPath = null
          artwork.logoPathBuffer = null
          artwork.textLogo = null
          artwork.textLogoAuto = false
        }
        log.info("Dynamic rotation: daily portrait poster", {
          mediaType,
          tmdbId,
          poster: picked.file_path,
          pool: dynamicPortraitPool.length,
          includeNonClean: dynamicRotationIncludeNonClean,
        })
      } else if (artwork.logoPath && logoFitEnabled) {
        try {
          const fitStart = Date.now()
          const bestFit = await selectBestLogoFitPosterPath({
            posters: images.posters, logoPath: artwork.logoPath,
            fetchImage: async (path: string) => {
              // Byte-LRU (F3): key = URL finale (imgSrc lancia su URL esterni
              // come prima, fuori dalla cache). B5: signal combinato col
              // watchdog così dopo la deadline non restano zombie.
              // Custom logo from an external URL: same safe pipeline as the
              // render (allowlist + SSRF + raster-only); a failure throws
              // like a failed TMDB fetch (best-fit degrades to the
              // historical fallback, never 500).
              if (isCustomPosterUrl(path)) {
                const buf = await fetchValidatedCustomImage(path, combineAbortSignals(renderAbort.signal, AUTO_FIT_FETCH_TIMEOUT_MS))
                if (!buf) throw new Error("Custom logo fetch failed")
                return buf
              }
              const url = imgSrc(path)
              const imgSignal = combineAbortSignals(renderAbort.signal, AUTO_FIT_FETCH_TIMEOUT_MS)
              return cachedImageBytes(url, async () => {
                const res = await timedFetch(url, { signal: imgSignal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return Buffer.from(await readResponseBody(res))
              }, imgSignal)
            },
            fetchCandidateImage: async (path: string) => {
              if (path.startsWith("http") && !path.startsWith("https://image.tmdb.org/t/p/")) {
                throw new Error("Blocked external URL in fetchCandidateImage")
              }
              const url = path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w342${path}`
              const candidateSignal = combineAbortSignals(renderAbort.signal, AUTO_FIT_FETCH_TIMEOUT_MS)
              return cachedImageBytes(url, async () => {
                const res = await timedFetch(url, { signal: candidateSignal })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return Buffer.from(await readResponseBody(res))
              }, candidateSignal)
            },
            hasBadges: true,
          })
          const fitMs = Date.now() - fitStart
          if (bestFit && bestFit.posterPath && bestFit.posterPath !== clean.file_path) {
            log.info("Best-fit: improved poster selected", { mediaType, tmdbId, bestFit: bestFit.posterPath, original: clean.file_path, ms: fitMs, winnerIndex: bestFit.winnerIndex ?? null, candidateCount: bestFit.candidateCount ?? null })
          } else {
            log.info("Best-fit: first clean already optimal", { mediaType, tmdbId, ms: fitMs, winnerIndex: bestFit?.winnerIndex ?? null, candidateCount: bestFit?.candidateCount ?? null })
          }
          artwork.posterPath = bestFit?.posterPath ?? clean.file_path
          if (bestFit?.posterBuffer) artwork.posterPathBuffer = bestFit.posterBuffer
          if (bestFit?.logoBuffer) artwork.logoPathBuffer = bestFit.logoBuffer
        } catch (e) {
          log.error("Best-fit: fallback to first clean", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
          artwork.posterPath = clean.file_path
        }
      } else if (artwork.logoPath) {
        // Logo disponibile ma best-fit disabilitato: il clean viene usato
        // comunque (il logo verrà composto sopra).
        log.info("Best-fit: disabled by config", { mediaType, tmdbId })
        artwork.posterPath = clean.file_path
      } else if (artwork.textLogo) {
        // Wordmark digitato (nessun logo TMDB da far combaciare): la base
        // clean resta quella storica, il testo viene composto sopra.
        log.info("Text logo — clean poster base", { mediaType, tmdbId })
        artwork.posterPath = clean.file_path
      } else {
        // Nessun logo disponibile: il poster clean senza logo è inutile
        // (lo spazio è pensato per il logo). Fallback al poster in lingua:
        // preferita → originale → prima non-clean → clean come ultima spiaggia.
        const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
        const origPoster = details.original_language ? images.posters.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
        const nonCleanPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 !== null)
        const fallbackPoster = langPoster || origPoster || nonCleanPoster || clean
        log.info("No logo — fallback to language poster", { mediaType, tmdbId, poster: fallbackPoster.file_path })
        artwork.posterPath = fallbackPoster.file_path
        artwork.autoPosterClean = fallbackPoster.iso_639_1 === null
      }
    } else {
      // Nessun clean TMDB disponibile: il poster in lingua ha già il titolo
      // stampato → mai sovrapporre il logo in portrait (stesso invariante
      // del client: buildPreviewUrl emette `logo=` solo con poster clean, e
      // il mapping forza logoPath=null sui non-clean). In landscape la base
      // è il backdrop (senza testo): il logo resta sempre e la base conta
      // come clean per il profilo sfumatura.
      // La selezione TVDB è SOLO manuale (gallery + mapping/query): nessun
      // rescue automatico, così il poster consegnato a Stremio coincide con
      // la scelta visibile nel client.
      // Catena base del ramo senza clean. Con `disableCleanPosters` ON il
      // clean non è MAI una base valida: preferita → inglese → originale →
      // NIENTE. L'ultimo anello storico (`images.posters[0]`) è rimosso
      // perché può essere un clean (proven live: pool con un solo clean e
      // i poster in lingua non ancora fetchati). `chosen` undefined =
      // `posterPath` lasciato non impostato: segue il percorso no-base
      // esistente (crop backdrop B2 quando c'è un backdrop, altrimenti
      // 404) — mai un clean servito. Con clean ABILITATI la catena storica
      // (`posters[0]` incluso) resta byte-identica.
      if (cleanEnabled) {
        const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
        const origPoster = details.original_language ? images.posters.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
        const chosen = langPoster || origPoster || images.posters[0]
        if (chosen) artwork.posterPath = chosen.file_path
      } else {
        const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
        const enPoster = preferredLanguage !== "en"
          ? images.posters.find((p: TMDBImage) => p.iso_639_1 === "en")
          : undefined
        const origLang = details.original_language
        const origPoster = origLang && origLang !== preferredLanguage && origLang !== "en"
          ? images.posters.find((p: TMDBImage) => p.iso_639_1 === origLang)
          : undefined
        const chosen = langPoster || enPoster || origPoster
        if (chosen) artwork.posterPath = chosen.file_path
      }
      // Portrait senza clean ma con un backdrop: il backdrop è un'immagine
      // SENZA titolo cotto, quindi vale come base clean (stesso invariante
      // del ramo landscape) e il logo resta composto sopra. La base è il
      // cover-crop 2:3 del PRIMO backdrop clean (iso_639_1 === null), poi
      // del primo backdrop in qualsiasi lingua; senza backdrops la catena
      // in lingua resta intatta (logo tolto, comportamento storico).
      // Solo con clean ABILITATI (`disableCleanPosters` OFF) e automazione
      // `portraitBackdropFallback` ON (default globale): entrambe sono scelte
      // esplicite dell'utente, mai scavalcate.
      // La base ESPLICITA (mapping `portraitBackdropPath` o `pbase` live) resta
      // onorata anche con il toggle OFF: è una scelta manuale dell'utente,
      // stesso contratto di `disableCleanPosters` (mapping e pick manuali non
      // subiscono il flag). Solo questo ramo AUTOMATICO viene saltato.
      // Il crop usa lo stesso helper della rescue B2 (unico renderer):
      // nessun secondo percorso di rendering.
      if (cleanEnabled && portraitBackdropFallback && !isLandscape && hasTitleLogo && (images.backdrops?.length ?? 0) > 0) {
        // Scelta esplicita dell'editor (`pbase`): vale SOLO se è un backdrop
        // clean della galleria del titolo — un path sconosciuto o non-clean
        // non scavalca mai la catena storica (primo clean, poi primo in
        // lingua).
        const cleanBackdropPaths = new Set(
          (images.backdrops as TMDBImage[]).filter((b) => b.iso_639_1 === null).map((b) => b.file_path),
        )
        const pickedBase = queryPortraitBase && cleanBackdropPaths.has(queryPortraitBase) ? queryPortraitBase : null
        const cropBackdropPath = pickedBase
          ?? (images.backdrops.find((b: TMDBImage) => b.iso_639_1 === null) ?? images.backdrops[0])?.file_path
          ?? null
        try {
          const cropBase = cropBackdropPath
            ? await fetchImg(landscapeBackdropUrl(cropBackdropPath), renderAbort.signal).catch(() => null)
            : null
          if (cropBase && cropBackdropPath) {
            artwork.posterPathBuffer = await cropBackdropToPortrait(cropBase, "center")
            artwork.posterPath = cropBackdropPath
            artwork.portraitBackdropCropPath = cropBackdropPath
            artwork.autoPosterClean = true
            log.info("No clean poster — portrait base from backdrop crop", { mediaType, tmdbId, backdrop: cropBackdropPath })
          }
        } catch (e) {
          // Fetch/crop falliti: catena in lingua invariata, logo tolto.
          artwork.posterPathBuffer = null
          log.error("Backdrop crop for portrait base failed", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
        }
      }
      if (isLandscape && hasTitleLogo) {
        artwork.autoPosterClean = true
      } else if (!artwork.autoPosterClean) {
        // Base con il titolo già cotto: niente logo immagine NE' wordmark
        // sopra (doppio titolo).
        artwork.logoPath = null
        artwork.logoPathBuffer = null
        artwork.textLogo = null
      }
    }
    // Rotazione giornaliera dinamici landscape (solo backdrop clean, cut
    // 02:00 UTC): precede il best-fit così il cambio giorno cambia davvero
    // la base. Solo con logo e almeno 2 backdrop clean, altrimenti fallback
    // storico invariato.
    let dynamicLandscapeRotated = false
    if (isLandscape && !queryBackdrop && hasTitleLogo && dynamicDayBucket !== null) {
      const dynamicBackdropPool = (images.backdrops ?? []).filter((b) => b.iso_639_1 === null)
      if (dynamicBackdropPool.length >= 2) {
        artwork.autoBackdropPath = dynamicBackdropPool[rotationIndexFor(dynamicDayBucket, dynamicBackdropPool.length)].file_path
        dynamicLandscapeRotated = true
        log.info("Dynamic rotation: daily backdrop", { mediaType, tmdbId, backdrop: artwork.autoBackdropPath, pool: dynamicBackdropPool.length })
      }
    }
    // Best-fit automatico dello sfondo landscape (mirror del portrait sopra):
    // senza scelta esplicita (query/backdrop salvato) i titoli non-mappati
    // usavano il primo backdrop TMDB mentre l'editor auto-seleziona il
    // best-fit — l'anteprima Stremio mostrava un altro sfondo (desync
    // WYSIWYG, "vedo comunque il primo poster"). Solo con logo disponibile
    // (senza, niente da comporre sopra) e fit abilitato; qualsiasi fallimento
    // mantiene il fallback storico (primo backdrop), mai 500.
    if (isLandscape && !queryBackdrop && artwork.logoPath && !dynamicLandscapeRotated && (images.backdrops?.length ?? 0) > 0) {
      const qLogoFitLand = req.nextUrl.searchParams.get("logoFit")
      const landFitEnabled = resolveLogoFitEnabled({
        global: BEST_FIT_GLOBAL,
        queryLogoFit: qLogoFitLand,
        configLogoFit: configOverride?.logoFitEnabled,
        sdFit: sd,
        isLandscape: true,
      })
      // <2 clean: niente da scegliere, fallback storico invariato.
      if (!landFitEnabled) {
        log.info("Best-fit landscape: disabled by config", { mediaType, tmdbId })
      } else {
        // Tutto dentro il try: qualsiasi throw (fit, candidati, mock
        // parziali nei test) mantiene il fallback storico, mai 500/503.
        try {
          if (selectAutoFitCandidates(images.backdrops, "landscape").length < 2) {
            // Niente da scegliere: fallback storico invariato.
          } else {
            const landFit = await selectBestLogoFitPosterPath({
              posters: images.backdrops,
              logoPath: artwork.logoPath,
              fetchImage: async (path: string) => {
                const url = imgSrc(path)
                const imgSignal = combineAbortSignals(renderAbort.signal, AUTO_FIT_FETCH_TIMEOUT_MS)
                return cachedImageBytes(url, async () => {
                  const res = await timedFetch(url, { signal: imgSignal })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  return Buffer.from(await readResponseBody(res))
                }, imgSignal)
              },
              fetchCandidateImage: async (path: string) => {
                if (path.startsWith("http") && !path.startsWith("https://image.tmdb.org/t/p/")) {
                  throw new Error("Blocked external URL in fetchCandidateImage")
                }
                // w780 come il client (BackdropOptions): a w342 il testo dei
                // backdrop si perderebbe e la cleanliness sbaglierebbe.
                const url = path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w780${path}`
                const candidateSignal = combineAbortSignals(renderAbort.signal, AUTO_FIT_FETCH_TIMEOUT_MS)
                return cachedImageBytes(url, async () => {
                  const res = await timedFetch(url, { signal: candidateSignal })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  return Buffer.from(await readResponseBody(res))
                }, candidateSignal)
              },
              hasBadges: true,
              shape: "landscape",
            })
            if (landFit?.posterPath) {
              if (landFit.posterPath !== artwork.autoBackdropPath) {
                log.info("Best-fit: improved landscape backdrop selected", { mediaType, tmdbId, bestFit: landFit.posterPath, original: artwork.autoBackdropPath })
              }
              artwork.autoBackdropPath = landFit.posterPath
            }
          }
        } catch (e) {
          log.error("Best-fit landscape: fallback to first backdrop", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
  } catch (e) {
    artwork.autoFetchFailed = true
    log.error("Auto image fetch failed", { error: e instanceof Error ? e.message : String(e) })
  }
  return { aggregatedRating, ratingAbort }
}
