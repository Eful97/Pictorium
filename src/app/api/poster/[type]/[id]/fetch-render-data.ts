// Fetch in parallelo del render (fase H della poster route): flag "early"
// (ranking/qualità/pre-release/età/badge), base custom effettiva, poi i due
// blocchi concorrenti: Block A (base, logo, backdrop, rank, qualità,
// pre-digitale) e Block B (Wikidata, keyword, voto aggregato/Top100, età).
// Corpo spostato da route.ts invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { CustomRatingConfig } from "@/lib/custom-rating"
import { AUTO_WORDMARK_TRACK_FACTOR } from "@/lib/text-logo"
import { type WikidataResult, fetchAllWikidata } from "@/lib/awards"
import { buildTextLogoBuffer } from "@/lib/svg-badge"
import { combineAbortSignals } from "@/lib/abort-signal"
import { cropBackdropToPortrait, landscapeBackdropUrl } from "@/lib/image-utils"
import { extractDigitalReleaseDate, isDigitalPreRelease } from "@/lib/pre-release"
import { fetchAggregatedRating, isMdbTmdbIdentityUsable } from "@/lib/ratings"
import { fetchImg, fetchLogoImg, imgSrc } from "@/lib/poster-render-helpers"
import { fetchPosterBaseWithCustom, fetchValidatedCustomImage, resolveEffectiveCustomUrl, safeTmdbImgSrc } from "@/lib/custom-poster-base"
import { getContentRatings, getExternalIds, getKeywords, getReleaseDates } from "@/lib/tmdb"
import { getTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { hasJWOffers } from "@/lib/justwatch"
import { isCustomPosterUrl } from "@/lib/utils"
import { isImdbTop100 } from "@/lib/imdb-top250"
import { isRotatedNonCleanPoster } from "@/lib/poster-rotation"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"
import { resolveAgeCertification } from "@/lib/certification"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { resolveWikidataId } from "@/lib/imdb-cache"
import { createLogger } from "@/lib/logger"
import type { PosterAdmission } from "./admission"
import { POSTER_TMDB_TIMEOUT_MS, RATING_WAIT_MS, WIKIDATA_TIMEOUT } from "./constants"
import type { PosterArtwork, PosterTitleMeta } from "./sources"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Valori della richiesta letti dal fetch (già risolti, mai riassegnati). */
export interface RenderFetchContext {
  readonly req: NextRequest
  readonly hardenedParams: URLSearchParams
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly mapping: Mapping | null
  readonly earlyEffMapping: Mapping | null
  readonly sd: ServerDefaults
  readonly earlyEffSd: ServerDefaults
  readonly configOverride: PosterAdmission["configOverride"]
  readonly configToken: string | null
  readonly posterRegion: RegionDef
  readonly sessionLang: string
  readonly rotationSelectedLang: string
  readonly canonicalQuality: string | null
  readonly isLandscape: boolean
  readonly earlyLandscape: boolean
  readonly queryPoster: string | null
  readonly queryBackdrop: string | null
  readonly showBadges: boolean
  readonly rankingBadges: boolean
  readonly sepDisplay: boolean
  readonly customRatingConfig: CustomRatingConfig
  readonly reqRatingSources: string[]
  readonly effTmdbKey: string | undefined
  readonly effMdblistKey: string | undefined
  readonly effSimklKey: string | undefined
  readonly preTrendRank: number | null
  readonly preAnimeRank: number | null
  readonly renderAbort: AbortController
}

/** Voto aggregato in corso: avviato dal ramo automatico o qui, atteso dopo dalla route. */
export interface PendingRating {
  aggregatedRating: ReturnType<typeof fetchAggregatedRating> | null
  multiRatingOnly: boolean
  ratingAbort: AbortController | null
}

/** Esiti del fetch letti dalla preparazione del render, dal debug e dalla cache. */
export async function fetchRenderData(
  ctx: RenderFetchContext,
  artwork: PosterArtwork,
  titleMeta: PosterTitleMeta,
  pending: PendingRating,
) {
  const {
    req, hardenedParams, mediaType, tmdbId, mapping, earlyEffMapping, sd, earlyEffSd,
    configOverride, configToken, posterRegion, sessionLang, rotationSelectedLang,
    canonicalQuality, isLandscape, earlyLandscape, queryPoster, queryBackdrop, showBadges,
    rankingBadges, sepDisplay, customRatingConfig, reqRatingSources, effTmdbKey, effMdblistKey,
    effSimklKey, preTrendRank, preAnimeRank, renderAbort,
  } = ctx
  let { aggregatedRating, multiRatingOnly, ratingAbort } = pending
  // Invariante: la route risponde 404/503 prima di chiamare il fetch quando
  // nessun ramo ha risolto una base (`artwork.posterPath` è sempre valorizzato).
  if (!artwork.posterPath) throw new Error("fetchRenderData: posterPath not resolved")
  const qRankingEarly = req.nextUrl.searchParams.get("ranking")
  const qBqEarly = req.nextUrl.searchParams.get("bq")
  const qQualityParam = canonicalQuality
  // hasQuery: true se lo stile è specificato esplicitamente — via poster/mapping
  // espliciti O via config token (`?config=`). Senza, i flag query (ranking=
  // badges= bg/by/br/bq) verrebbero ignorati e il server applicherebbe i default
  // (tutti ON), così un link ?config= con "ranking=0" mostrava comunque il badge
  // trend. Con un config token la personalizzazione è esplicita → i flag off
  // devono valere.
  const hasQueryEarly = !!queryPoster || !!mapping || !!configToken
  const rankingEnabledEarly = qRankingEarly !== null ? qRankingEarly !== "0" : (hasQueryEarly ? (earlyEffMapping?.rankingBadges ?? rankingBadges) : true)
  const badgeQualityEarly = qBqEarly !== null ? qBqEarly !== "0" : (earlyEffMapping?.badgeQuality ?? configOverride?.badgeQuality ?? earlyEffSd.badgeQuality ?? sd.badgeQuality ?? true)
  // Flag pre-digitale per il fetch condizionato: query `pre` > config token
  // > server defaults > false (stessa catena di poster-config, senza mapping).
  const qPreEarly = req.nextUrl.searchParams.get("pre")
  const preReleaseEnabledEarly = qPreEarly !== null ? qPreEarly !== "0" : (configOverride?.preRelease ?? earlyEffSd.preRelease ?? sd.preRelease ?? false)
  // Segnali grezzi del rilevamento pre-digitale (solo debug=1).
  let preJw: boolean | null = null
  let preDigital: string | null = null
  // Badge età (default OFF): stessa catena per-shape con per-titolo del
  // render finale (resolveAgeBadgeRequest sul mapping effettivo — mai
  // catene duplicate). Spento = nessun fetch TMDB extra in Block B
  // (zero rete, zero byte diversi); un OFF esplicito per-titolo spegne il
  // fetch anche con default ON.
  const ageEarly = resolveAgeBadgeRequest(req.nextUrl.searchParams, configOverride, earlyEffSd, sd, earlyEffMapping)
  const ageBadgeEnabledEarly = ageEarly.ageBadge
  const ageCountryEarly = ageEarly.ageCountry
  // Master badge globale con la STESSA risoluzione canonica del render
  // finale (resolvePosterRenderConfig: query `badges` > live-follow
  // mapping/config/defaults > hasQuery/config/showBadges > true — mai
  // catene duplicate che divergono). Con master OFF l'età è nascosta a
  // valle (hasAgeBadge in poster-service), quindi il fetch
  // release_dates/content_ratings sarebbe rete puramente opzionale per un
  // badge nascosto: spento = nessun fetch età.
  const qBadgesEarly = hardenedParams.get("badges")
  const isLiveFollowEarly = hardenedParams.get("live") === "1"
  const badgesEnabledEarly: boolean | undefined = qBadgesEarly !== null
    ? qBadgesEarly !== "0"
    : (isLiveFollowEarly
      ? (earlyEffMapping?.showBadges ?? configOverride?.globalBadges ?? earlyEffSd.globalBadges ?? sd.globalBadges ?? showBadges)
      : (hasQueryEarly ? (configOverride !== null ? configOverride.globalBadges : (earlyEffMapping?.showBadges ?? showBadges)) : true))
  const ageFetchEnabledEarly = badgesEnabledEarly !== false && ageBadgeEnabledEarly
  // Anime rank parsed pre-cache; only rankingEnabledEarly is needed here.
  // Ranking source also resolved pre-cache and reused, no recompute.

  // Quarto anello QID (mapping legacy senza wikidataId salvato): una
  // external_ids con memo 7gg invece della lotteria SPARQL — il REST diventa
  // il default anche per Stremio. Solo con ranking ON e chiave TMDB (senza
  // chiave o a fetch fallito il QID resta null e vale lo SPARQL invariato);
  // tetto 1500ms per non tassare il render a freddo oltre la race da 2.5s.
  // Avviato QUI come promise e atteso DENTRO Block B (unico consumer): la
  // lookup QID non ritarda più l'avvio di Block A/B, si limita a
  // sovrapporsi a loro. Semantica invariata: un reject arriva comunque al
  // job catch attraverso l'await di Block B.
  const wikidataIdPromise: Promise<string | null> =
    !titleMeta.wikidataId && rankingEnabledEarly && effTmdbKey
      ? resolveWikidataId(mediaType, tmdbId, effTmdbKey, 1500)
      : Promise.resolve(titleMeta.wikidataId)

  // Saved custom base: portrait from customPosterUrl, landscape from
  // customBackdropUrl (per-format independent). Downloaded IN PARALLEL with
  // TMDB plus automatic fallback — never serial (8.5s render deadline on
  // Vercel). SSRF validation runs on every render inside
  // fetchPosterBaseWithCustom: the saved URL stays user input, never
  // trusted. safeTmdbImgSrc: a non-TMDB posterPath (hand-written legacy
  // mapping) must not throw the render → null fallback.
  const mappingCustomUrl = earlyLandscape
    ? (mapping?.customBackdropUrl ? mapping.customBackdropUrl : null)
    : (mapping?.customPosterUrl ? mapping.customPosterUrl : null)
  const tmdbFallbackSrc = mapping?.posterPath ? safeTmdbImgSrc(mapping.posterPath) : null
  // Explicit custom choice in query (custom tile selected in preview but
  // not saved yet): wins over the saved mapping, just like queryPoster wins
  // over mapping.posterPath in the query branch. Portrait via `poster=`,
  // landscape via `backdrop=` (same allowlist + direct shape — see R2 gate
  // above). The full precedence (preview vs Stremio) lives in
  // resolveEffectiveCustomUrl: in preview a click on a TMDB tile really
  // shows that tile, on Stremio the saved state always wins.
  const queryCustomUrl = earlyLandscape
    ? (queryBackdrop && isCustomPosterUrl(queryBackdrop) ? queryBackdrop : null)
    : (queryPoster && isCustomPosterUrl(queryPoster) ? queryPoster : null)
  const effectiveCustomUrl = resolveEffectiveCustomUrl({
    queryCustomUrl,
    hasQueryPoster: (earlyLandscape ? queryBackdrop : queryPoster) ? true : false,
    mappingCustomUrl,
    isPreview: hardenedParams.get("preview") === "1",
  })

  // Opt-in portrait rotation: a non-clean poster of the selected language
  // already has its title baked in. Suppress the logo image and the text /
  // automatic wordmark (never draw a second title). Clean bases, custom
  // bases and the `portraitBackdropPath` crop (textless backdrop) stay
  // historical. Landscape rotation is backdrop-based: untouched.
  // Cache: the flag/language live in the mapping metadata covered by
  // `mapVersion` (`:mu<updatedAt>`), and an explicit `?lang=` is already in
  // `cacheParams`; the same `posterPath` + rest therefore cannot serve
  // suppressed and unsuppressed bytes from one entry.
  if (
    !isLandscape
    && !effectiveCustomUrl
    && artwork.mappingPortraitBackdropPath === null
    && isRotatedNonCleanPoster(mapping, artwork.posterPath, rotationSelectedLang)
  ) {
    artwork.logoPath = null
    artwork.logoPathBuffer = null
    artwork.textLogo = null
    artwork.textLogoAuto = false
  }

  // 5. Fetch all data in parallel: images + rankings + quality + wikidata + keywords + imdbTop250
  //    All dependencies are available before this point — no Block B depends on Block A
  const emptyWikidata = { awards: [], nominations: [], studios: [], director: null }
  // Esito temporale della race Wikidata, per debug=1 e TTL effimero: la
  // degraded del risultato copre i fallimenti strutturali, questa il timeout.
  let wikidataRaceTimedOut = false
  // Portrait custom for the poster base: in portrait the effective value
  // (query or saved, unchanged); in landscape ONLY the explicit query (a
  // portrait custom tile selected in preview — otherwise the pillarbox
  // would 500 on imgSrc) — never the saved one, which belongs to the other
  // shape. Feeds only the pillarbox when the backdrop is missing (the base
  // stays the backdrop).
  const queryPosterCustomUrl = queryPoster && isCustomPosterUrl(queryPoster) ? queryPoster : null
  const posterCustomForFetch = isLandscape ? queryPosterCustomUrl : effectiveCustomUrl
  // TMDB fallback for the custom base (never a custom URL inside
  // landscapeBackdropUrl/imgSrc: the former would throw on non-TMDB hosts).
  const tmdbBackdropSrc = (() => {
    if (!artwork.backdropPath || isCustomPosterUrl(artwork.backdropPath)) return null
    try {
      return isLandscape ? landscapeBackdropUrl(artwork.backdropPath) : imgSrc(artwork.backdropPath)
    } catch {
      return null
    }
  })()
  // Explicit custom URL in backdropPath (preview with the custom tile, or
  // a hand-crafted query): same validated pipeline, never 500 on
  // allowlisted URLs (in preview it coincides with the effectiveCustomUrl
  // below).
  const explicitBackdropCustomUrl = artwork.backdropPath && isCustomPosterUrl(artwork.backdropPath) ? artwork.backdropPath : null
  // Custom base for the backdrop slot: in landscape the explicit preview
  // query or the saved customBackdropUrl; in portrait ONLY the explicit URL
  // in backdropPath (the portrait custom travels on the poster slot, never
  // here). Without a custom the TMDB branch below stays verbatim.
  const backdropCustomForFetch = (isLandscape ? effectiveCustomUrl : null) ?? explicitBackdropCustomUrl
  // Base portrait congelata dal save (`mappingPortraitBackdropPath`): cover-crop
  // 2:3 con lo stesso helper e lo stesso focus (`center`) del ramo automatico
  // (unico renderer), risolto in parallelo al resto di Block A. Ogni errore
  // (fetch o crop) risolve a null e la catena sotto torna al poster nominale
  // del mapping: mai 500, mai un crop parziale usato come base.
  const savedPortraitBasePath = artwork.mappingPortraitBackdropPath
  const portraitBasePromise = savedPortraitBasePath !== null
    ? (async () => {
      try {
        const source = await fetchImg(landscapeBackdropUrl(savedPortraitBasePath), renderAbort.signal)
        const buf = await cropBackdropToPortrait(source, "center")
        artwork.posterPath = savedPortraitBasePath
        artwork.portraitBackdropCropPath = savedPortraitBasePath
        return { buf, custom: false }
      } catch {
        // Fetch/crop falliti: base storica dal poster nominale del mapping
        // (mai 500, mai crop parziale).
        const fallbackPath: string | null = artwork.posterPath
        if (!fallbackPath) return null
        const buf = await fetchImg(imgSrc(fallbackPath), renderAbort.signal).catch(() => null)
        return buf ? { buf, custom: false } : null
      }
    })()
    : null
  const [
    [originalBase, logoFetch, backdropFetch, rankingResult, animeRankResult, rawLiveQuality, preReleaseDetected],
    [wikidataResult, tmdbKeywords, imdbTop250, ageCert],
  ] = await Promise.all([
    // Block A: images + ranking data + quality
    Promise.all([
      artwork.posterPathBuffer
        ? Promise.resolve({ buf: artwork.posterPathBuffer, custom: false })
        : portraitBasePromise
          ? portraitBasePromise
          : posterCustomForFetch
            ? fetchPosterBaseWithCustom(posterCustomForFetch, tmdbFallbackSrc ?? safeTmdbImgSrc(artwork.posterPath), renderAbort.signal)
            : fetchImg(imgSrc(artwork.posterPath), renderAbort.signal).catch(() => null).then((buf) => (buf ? { buf, custom: false } : null)),
      artwork.logoPathBuffer
        ? Promise.resolve(artwork.logoPathBuffer)
        // Text-as-logo: il wordmark digitato è la sorgente logo (vince su
        // quella immagine sopra): SVG con i font del bundle rasterizzato
        // qui e composto dal renderer esistente, stessi passi di layout,
        // velatura e scala di un logo TMDB. Un errore = composizione senza
        // logo (mai 500), come per il logo custom.
        : artwork.textLogo
          ? buildTextLogoBuffer(
            artwork.textLogo.text,
            artwork.textLogo.font,
            artwork.textLogoAuto ? { trackingEm: AUTO_WORDMARK_TRACK_FACTOR } : undefined,
          ).catch(() => null)
          // Custom logo from an external URL: same safe pipeline as the custom
          // base (allowlist + SSRF + raster-only, no SVG); a definitive
          // failure resolves to null + logo-less composition, never 500. A
          // render abort propagates (never a zombie fallback).
          : artwork.logoPath
            ? (isCustomPosterUrl(artwork.logoPath)
              ? fetchValidatedCustomImage(artwork.logoPath, renderAbort.signal).catch(() => null)
              : fetchLogoImg(artwork.logoPath, renderAbort.signal).catch(() => null))
            : Promise.resolve(null),
      // Landscape custom base (explicit preview query or saved
      // customBackdropUrl): same validated pipeline as the portrait base
      // (allowlist + SSRF + raster-only, parallel TMDB fallback, never 500).
      // Without a custom the TMDB branch stays verbatim (including the
      // historic throw on non-TMDB paths: never changed here). A custom URL
      // in backdropPath never goes through landscapeBackdropUrl/imgSrc
      // (they would throw on non-TMDB hosts).
      backdropCustomForFetch
        ? fetchPosterBaseWithCustom(backdropCustomForFetch, tmdbBackdropSrc, renderAbort.signal).then((r) => (r ? r.buf : null))
        // SOLO landscape: il portrait non ha alcun layer backdrop (la base è
        // `posterPath`/crop) — un buffer qui finiva composto come banda 16:9
        // centrata (y ~235..516) sopra il poster. Il fetch è inutile lì.
        : isLandscape && artwork.backdropPath
          ? fetchImg(landscapeBackdropUrl(artwork.backdropPath), renderAbort.signal).catch(() => null)
          : Promise.resolve(null),
      rankingEnabledEarly
        // Pre-cache snapshot reuse: same value as the cache key.
        ? Promise.resolve(preTrendRank)
        : Promise.resolve(null),
      // Rank anime (media_type=tv): la lista MDBList trending anime senza
      // chiave risponde 503 "Invalid API key" → rank sempre null. Si usa la
      // chiave esplicita della richiesta (mdblist_key) o il fallback
      // d'istanza (PICTORIUM_MDBLIST_KEY). La cache è quella interna di
      // fetchMDBList (keyed per chiave, TTL 30min), quindi niente cache
      // manuale non-keyed.
      // Precedenza: `animerank` (preview/catalogo) > fetch live >
      // mapping.animeRank su fetch FALLITO (badge salvato: funziona anche
      // senza chiavi, come nel WYSIWYG). Miss genuina (titolo fuori chart) →
      // null, mai il rank stantio.
      rankingEnabledEarly
        // Pre-cache snapshot reuse, no second fetch.
        ? Promise.resolve(preAnimeRank)
        : Promise.resolve(null),
      (badgeQualityEarly)
        ? (qQualityParam
            ? Promise.resolve(qQualityParam)
            : (() => {
                const sessionTitle = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details?.title
                  || getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details?.name
                  || null
                const fallbackTitle = mapping?.title || hardenedParams.get("title") || titleMeta.autoTitle || sessionTitle || titleMeta.genreName || null
                const effSeasonCount = titleMeta.seasonCount ?? getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details?.number_of_seasons ?? null
                return resolveStreamQuality(
                  mediaType === "movie" ? "movie" : "series",
                  titleMeta.imdbId,
                  tmdbId,
                  fallbackTitle,
                  renderAbort.signal,
                  effSeasonCount,
                  posterRegion.code,
                ).catch(() => null)
              })())
        : Promise.resolve(null),
      // Rilevamento pre-digitale (solo film, solo se flag `pre` ON):
      // JustWatch ha la precedenza, TMDB release_dates (type 4) come
      // fallback. Tetto 2500ms con fail-open: a dati ignoti il poster
      // resta normale invece di attendere gli upstream.
      (preReleaseEnabledEarly && mediaType === "movie"
        ? (async (): Promise<boolean> => {
            let preTimer: ReturnType<typeof setTimeout> | undefined
            const preTimeout = new Promise<false>((r) => {
              preTimer = setTimeout(() => r(false), 2500)
            })
            const detect = (async (): Promise<boolean> => {
              try {
                const apiKey = effTmdbKey
                // Titolo per la ricerca JW (stesso fallback del blocco
                // qualità): senza searchQuery la query chiede 5 titoli
                // popolari generici e il match per tmdbId fallisce quasi
                // sempre → disponibilità ignota → poster normale.
                const sessionDetails = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details
                const preTitle = mapping?.title
                  || hardenedParams.get("title")
                  || titleMeta.autoTitle
                  || sessionDetails?.title
                  || sessionDetails?.name
                  || titleMeta.genreName
                  || null
                const [relDates, jw] = await Promise.all([
                  getReleaseDates(mediaType, tmdbId, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null),
                  hasJWOffers(tmdbId, "MOVIE", preTitle, posterRegion.code, renderAbort.signal).catch(() => null),
                ])
                preDigital = relDates ? extractDigitalReleaseDate(relDates, posterRegion.code) : null
                preJw = jw
                return isDigitalPreRelease({
                  mediaType,
                  theatricalDate: titleMeta.releaseDate ?? mapping?.releaseDate ?? null,
                  digitalDate: preDigital,
                  jwAvailable: jw,
                })
              } catch {
                return false
              }
            })()
            const detected = await Promise.race([detect, preTimeout])
            if (preTimer) clearTimeout(preTimer)
            return detected
          })()
        : Promise.resolve(false)),
    ]),
    // Block B: badge data (independent of Block A — runs concurrently)
    Promise.all([
      // Fix L3: il timer della race Wikidata viene cancellato quando vince
      // il fetch (prima restava attivo fino alla scadenza del timeout).
      (async () => {
        // QID resolve was started before Block A/B; awaited here so only the
        // Wikidata sub-fetch depends on it (keywords/ratings still run in
        // parallel). The 2500ms race timer starts after the QID, exactly as
        // the previous serial await did (QID stays outside that timeout).
        const resolvedWikidataId = await wikidataIdPromise
        let wikidataTimer: ReturnType<typeof setTimeout> | undefined
        let wikidataTimedOut = false
        const wdStart = Date.now()
        // Lo zombie SPARQL perso alla race viene abortito subito (stesso
        // pattern di ratingAbort): senza, campava fino ai suoi 5s interni
        // occupando uno slot del limiter awards (max 2).
        const wdAbort = new AbortController()
        const wikidataTimeout = new Promise<WikidataResult>((r) => {
          wikidataTimer = setTimeout(() => { wikidataTimedOut = true; r({ ...emptyWikidata, degraded: true }) }, WIKIDATA_TIMEOUT)
        })
        const result: WikidataResult = await Promise.race([
          rankingEnabledEarly
            ? fetchAllWikidata(tmdbId, mediaType, combineAbortSignals(renderAbort.signal, wdAbort.signal), { wikidataId: resolvedWikidataId }).catch((): WikidataResult => ({ ...emptyWikidata, degraded: true }))
            : Promise.resolve({ ...emptyWikidata }),
          wikidataTimeout,
        ])
        if (wikidataTimer) clearTimeout(wikidataTimer)
        wdAbort.abort()
        wikidataRaceTimedOut = wikidataTimedOut
        // a. Osservabilità lotteria badge: esito + tempo + contenuto. Un
        // timeout qui = poster senza premi (per le serie, senza rete: nessun
        // badge) congelato in cache per ore — dal log si distingue subito un
        // miss genuino (fetch veloce, zero premi) da una gara persa.
        log.debug("Wikidata race outcome", {
          mediaType, tmdbId, ms: Date.now() - wdStart, timedOut: wikidataTimedOut,
          awards: result.awards?.length ?? 0, nominations: result.nominations?.length ?? 0,
        })
        return result
      })(),
      rankingEnabledEarly
        ? getKeywords(mediaType, tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => [])
        : Promise.resolve([]),
      (async () => {
        // La colonna separati richiede gli stessi aggregated
        // dei custom rating: senza, preview e poster mappati non avrebbero
        // mai i sources (desync WYSIWYG).
        const sepFetch = sepDisplay
        if (!rankingEnabledEarly && !customRatingConfig.enabled && !sepFetch) return false
        if (!titleMeta.imdbId) {
          // F6: externalIds già in session cache (ramo non-mappato) → niente rete.
          const extIds = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.externalIds
            ?? (await getExternalIds(mediaType, tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null))
          if (extIds?.imdb_id) titleMeta.imdbId = extIds.imdb_id
        }
        if (!titleMeta.imdbId && !isMdbTmdbIdentityUsable(tmdbId, mediaType)) return false
        // Task C: senza IMDb il TMDB id + tipo esplicito basta per le fonti
        // qui sotto (il ranking Top250 resta IMDb-only al return finale).
        if ((customRatingConfig.enabled || sepFetch) && !aggregatedRating) {
          // Saved/query posters need source data only; keep their legacy vote intact.
          multiRatingOnly = true
          ratingAbort = new AbortController()
          const wantSimkl = reqRatingSources.includes("simkl") && !!effSimklKey
          const wantAnilist = reqRatingSources.includes("anilist")
          const wantKitsu = reqRatingSources.includes("kitsu")
          const wantImdb = reqRatingSources.includes("imdb")
          // Backfill TMDB genuino (mai medie query/mapping congelate):
          // solo details già in session cache (ramo non-mappato o fetch
          // precedenti) — senza, niente backfill come prima. Stesso
          // fallback del ramo auto, così la colonna separati non perde
          // `tmdb` a MDBList down pur con chiave TMDB valida.
          const cachedTmdbVote = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details?.vote_average
          const genuineTmdbVote = typeof cachedTmdbVote === "number" && Number.isFinite(cachedTmdbVote) && cachedTmdbVote > 0
            ? cachedTmdbVote
            : undefined
          aggregatedRating = fetchAggregatedRating(
            titleMeta.imdbId,
            effMdblistKey,
            combineAbortSignals(AbortSignal.any([renderAbort.signal, ratingAbort.signal]), RATING_WAIT_MS),
            {
              simklKey: effSimklKey,
              tmdbId,
              mediaType,
              wantSimkl,
              wantAnilist,
              wantKitsu,
              wantImdb,
              requestedSources: reqRatingSources,
              ratingWaitMs: RATING_WAIT_MS,
              tmdbFallbackVote: genuineTmdbVote,
            },
          ).catch(() => null)
        }
        // Absolute Cinema badge flag: rank 1..100 only (variable keeps the
        // legacy `imdbTop250` name for minimal diff; see imdb-top250.ts).
        return rankingEnabledEarly ? isImdbTop100(titleMeta.imdbId, renderAbort.signal) : false
      })(),
      // Badge età (OPTIONAL, default OFF): film → release_dates (stessa URL
      // del blocco pre-digitale in Block A: il tmdbFetch condiviso coalesce
      // le richieste concorrenti identiche in un'unica rete + cache 5min —
      // mai doppia chiamata), serie → content_ratings. Solo quando
      // abilitato e con chiave TMDB (senza chiave niente rete, come il
      // gating qualità); tetto POSTER_TMDB_TIMEOUT_MS col signal di render,
      // fail-open (a dati ignoti il badge si nasconde, mai 500). `ok`
      // distingue il miss genuino (dati ok, paese assente → cache stabile)
      // dal degrado rete (TTL effimero come la qualità).
      (ageFetchEnabledEarly && effTmdbKey
        ? (async (): Promise<{ label: string | null; ok: boolean }> => {
            try {
              if (mediaType === "movie") {
                const relDates = await getReleaseDates(mediaType, tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
                return { label: resolveAgeCertification("movie", ageCountryEarly, { releaseDates: relDates }), ok: relDates !== null }
              }
              const ratings = await getContentRatings(tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
              return { label: resolveAgeCertification("tv", ageCountryEarly, { contentRatings: ratings }), ok: ratings !== null }
            } catch {
              return { label: null, ok: false }
            }
          })()
        : Promise.resolve({ label: null as string | null, ok: true })),
    ]),
  ])
  return {
    qQualityParam, rankingEnabledEarly, preJw, preDigital, effectiveCustomUrl,
    wikidataRaceTimedOut, backdropCustomForFetch, originalBase, logoFetch, backdropFetch,
    rankingResult, animeRankResult, rawLiveQuality, preReleaseDetected, wikidataResult,
    tmdbKeywords, imdbTop250, ageCert, aggregatedRating, multiRatingOnly, ratingAbort,
  }
}
