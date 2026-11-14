import { NextRequest } from "next/server"
import { initSharp } from "@/lib/sharp-config"
import { getImages, getDetails } from "@/lib/tmdb"
import { pickVisualDefaults } from "@/lib/server-defaults"
import { effectiveMappingForShape } from "@/lib/types"
import { isValidWikidataQid } from "@/lib/awards"
import { createT } from "@/lib/i18n-server"
import { fetchAggregatedRating, pickSeparateRatings, resolveRatingSources, type SeparateRating } from "@/lib/ratings"
import { getTMDBSessionCache, setTMDBSessionCache } from "@/lib/tmdb-session-cache"
import {
  acquirePosterFetchSlot,
  acquirePosterRenderSlot,
  beginPosterRender,
  getPendingPoster,
  readCachedPoster,
  recordZombieRenderStart,
  writePosterError,
  recordPosterError,
  recordBackdropCropRescue,
} from "@/lib/poster-runtime-cache"
import { type EffectiveAccentMeta } from "@/lib/effective-accent"
import { resolveFinalRankWithListContext, sanitizePortraitBaseBackdropPath } from "@/lib/poster-params-hardening"
import { DEMO_SAMPLE_GENRE, DEMO_SAMPLE_MOVIE_DATE, DEMO_SAMPLE_RANK, DEMO_SAMPLE_TV_DATE, mergeDemoSampleRatings } from "@/lib/demo-samples"
import {
  STD_H,
  fetchImg,
  hashKey,
  isValidHex,
} from "@/lib/poster-render-helpers"
import { computeBottomLight } from "@/lib/accent-color"
import { normalizeGenreName } from "@/lib/genre-normalize"
import { LAND_H, landscapeBackdropUrl, cropBackdropToPortrait } from "@/lib/image-utils"
import { generatePosterBuffer, type GenerationInput, type NetworkGeometry, type BadgeGeometryReport } from "@/lib/poster-service"
import { parseDateFormat } from "@/lib/release-badge"
import { isCustomPosterUrl } from "@/lib/utils"
import { createLogger } from "@/lib/logger"
import { resolvePosterRenderConfig, resolvePosterShape, resolveSeparateRatingsEnabled } from "@/lib/poster-config"
import { resolveAutoWordmark, resolveTextLogo } from "@/lib/text-logo"
import { type StreamQualityResult } from "@/lib/stream-quality"
import { type StreamQuality } from "@/lib/quality-tiers"
import { computeVote } from "@/lib/rating-weights"
import { createHash } from "node:crypto"
import { resolveCustomRatingConfig, type RatingItem } from "@/lib/custom-rating"
import {
  PosterCacheLookupContext,
  buildPosterCacheParams,
  checkPosterCanonicalCache,
  checkPosterNegativeCache,
  serveCoalescedPoster,
  checkPosterVariantFastPath,
  corsHeaders,
  posterErrorResponse,
} from "./phases"
import { admitPosterRequest } from "./admission"
import { POSTER_TMDB_TIMEOUT_MS, RATING_WAIT_MS, RENDER_TIMEOUT_MS } from "./constants"
import { runRankingPreflight } from "./ranking-preflight"
import { buildPosterDebugJson } from "./debug"
import { fetchRenderData } from "./fetch-render-data"
import { prepareRenderBase } from "./render-base"
import { resolveEphemeralPolicy, resolveFactCap } from "./freshness"
import { resolveRenderQuality } from "./quality"
import { serveAccentMetaRequest } from "./accent-meta"
import { createResponseVariantServer } from "./variant"
import { loadPosterRequestContext } from "./request-context"
import { resolvePosterCacheIdentity } from "./cache-key"
import { finalizePosterRender } from "./finalize"
import { resolveRenderDisplay } from "./display-state"
import type { PosterArtwork, PosterTitleMeta } from "./sources"
import { resolveAutoSources, resolveMappingSources, resolveQuerySources, type SourceResolutionContext } from "./resolve-sources"

// Vercel: limite massimo di esecuzione della funzione. Il render poster ha un
// deadline interno di 30s (PICTORIUM_RENDER_TIMEOUT_MS) → 40s copre il caso
// peggiore. Su Hobby Vercel impone comunque 10s; su Pro vale questo valore.
export const maxDuration = 40

const log = createLogger("poster")

/**
 * Normalizza il risultato qualità in StreamQualityResult. Accetta il legacy
 * `StreamQuality | null` (mock dei test, override `?quality=`) come
 * resolved: preserva il caching pieno storico per quei path.
 */
function normalizeQualityResult(raw: StreamQualityResult | StreamQuality | string | null | undefined): StreamQualityResult {
  if (raw !== null && typeof raw === "object" && "status" in raw) return raw as StreamQualityResult
  if (typeof raw === "string") return { quality: raw as StreamQuality, status: "resolved", source: "none" }
  return { quality: (raw ?? null) as StreamQuality | null, status: "resolved", source: "none" }
}

type RouteParams = { type: string; id: string }

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const startTime = Date.now()
  initSharp()
  const { type, id } = await params
  // Ammissione (admission.ts): namespace, rate-limit, preview, chiavi,
  // config token, risoluzione id e validazione query (R1/R2).
  const admission = await admitPosterRequest(req, type, id)
  if (admission instanceof Response) return admission
  const {
    mediaType, tmdbId, pathImdbId, scopedUser, rawPreview, isPreview, previewUnlocked,
    effTmdbKey, effMdblistKey, effTvdbKey, effSimklKey, configToken, configOverride,
  } = admission

  // 1. Mapping + server defaults, regione/lingua, forma e rotazione 24h
  // (request-context.ts, nessuna rete oltre allo storage).
  const {
    mapping, sd, portraitBackdropFallback, autoWordmarkEnabled, canonicalQuality, canonicalLang,
    posterRegion, rotationSelectedLang, earlyLandscape, earlyEffSd, isRotating,
  } = await loadPosterRequestContext(req, admission)

  // 2. Cache key
  // Mapping effettivo per la forma richiesta: i pre-gate sotto (customRatings,
  // separate, ranking, badgeQuality, showBadges, formats) seguono il profilo
  // landscape come il render, non i flat (stessa `effectiveMappingForShape`
  // di resolvePosterRenderConfig). Calcolato qui — dopo la rotazione, che non
  // tocca i campi visivi — così chiave di cache e render non divergono.
  const earlyEffMapping = effectiveMappingForShape(mapping, earlyLandscape ? "landscape" : "poster")
  // Riga rating custom: il provider deve essere configurato (env) E il display
  // abilitato (catena query `cr` > mapping > config > defaults > true, come
  // bg/by/br — vedi resolvePosterRenderConfig). `cr` resta nei cacheParams e
  // `mv`/configHash coprono mapping/token, quindi niente stale.
  const qCr = req.nextUrl.searchParams.get("cr")
  const customRatingsDisplay = qCr !== null
    ? qCr !== "0"
    : (earlyEffMapping?.customRatings ?? configOverride?.customRatings ?? earlyEffSd.customRatings ?? sd.customRatings ?? true)
  const envRatingConfig = resolveCustomRatingConfig({}, sd)
  const customRatingConfig = { ...envRatingConfig, enabled: envRatingConfig.enabled && customRatingsDisplay }
  // Colonna rating separati (display) — catena centralizzata
  // (resolveSeparateRatingsEnabled: query `sep` > mapping > config token >
  // server defaults > false, stessa di `cr` sopra). Unico punto di verità
  // con resolvePosterRenderConfig: mai catene duplicate che divergono.
  const sepDisplay = resolveSeparateRatingsEnabled(
    req.nextUrl.searchParams,
    mapping,
    configOverride,
    earlyEffSd,
    sd,
    earlyLandscape ? "landscape" : "poster",
  )
  const customRatingHash = customRatingConfig.enabled
    ? createHash("sha256").update(JSON.stringify(customRatingConfig)).digest("hex") : ""
  // Defaults hash: SOLO i campi di resa (badge/ranking/stili/tuning/gradienti/
  // logo/forma/formati/età/network/ribbon/sash/dct-dnet/dateFormat/landscape…).
  // I campi catalog-only (customCatalogs, streamingSelections, rankingSource*,
  // ordine/rename/visibilità cataloghi, catalogShapes, episodeMetadataSource,
  // keyword stagionali) sono esclusi: cambiarli non tocca i pixel, quindi non
  // deve invalidare ogni poster. La classifica risolta resta comunque in chiave
  // (r/lr/la); la lista completa e la prova dei consumer sono in
  // `pickVisualDefaults` (server-defaults.ts).
  const sdHash = hashKey(JSON.stringify(pickVisualDefaults(sd)) + customRatingHash)
  // Hardening anti cache-busting + parametri di cache: vedi phases.ts
  const { hardenedParams, cacheParams, demoSamples, wantAccentMeta } = buildPosterCacheParams(req, {
    isPreview,
    rawPreview,
    previewUnlocked,
    scopedUser,
    mapping,
    earlyEffMapping,
    canonicalQuality,
    canonicalLang,
    effMdblistKey,
    effSimklKey,
  })
  // Preflight ranking (ranking-preflight.ts): snapshot rank pre-cache riusato dal render.
  const {
    rankingSourcePre, rankingCustomPre, streamingRankPre, needTrendFetch, needAnimeFetch, animeListKey,
    animeKeyUsed, jwFamily, chartAnimeFamily, addonRankingInput, trendRankLive, animeRankLive,
    trendSnapshotPin, animeSnapshotPin, streamingSnapshotPin, preTrendRank, preAnimeRank, preflightMs,
  } = await runRankingPreflight({
    req, hardenedParams, mediaType, tmdbId, mapping, earlyEffMapping, sd, configOverride, configToken,
    posterRegion, scopedUser, effTmdbKey, effMdblistKey, effTvdbKey, startTime,
  })
  // Chiave di cache, ETag base, formato, policy TTL/immutable e flag di
  // debug (cache-key.ts). Idrata la entry canonica dal disco.
  const {
    dynamicDayBucket, dynamicRotationIncludeNonClean, dynamicCutTtlMs, outputFormat, legacyAvif,
    canonicalFormat, cacheKey, needsVariant, variantKey, immutablePoster, refreshRequest,
    isLive, isDebug, wantNetGeo, wantBadgeGhosts, dynamicPoster, mappingTag, dynamicTtlSec,
    variantTtlSec, ifNoneMatch, isConditional,
  } = await resolvePosterCacheIdentity({
    req, mediaType, tmdbId, scopedUser, isPreview, previewUnlocked, configOverride, mapping, sd,
    posterRegion, earlyLandscape, isRotating, customRatingConfig, sepDisplay, sdHash, hardenedParams,
    cacheParams, preTrendRank, preAnimeRank, startTime,
  })

  // Effective-accent metadata branch (`?accentmeta=1`, read-only, no-store,
  // never renders): see accent-meta.ts.
  if (wantAccentMeta) return await serveAccentMetaRequest(cacheKey, ifNoneMatch)

  // C3: risposta non-canonica da payload canonico (vedi variant.ts).
  const serveResponseVariant = createResponseVariantServer({
    mediaType, tmdbId, startTime, isPreview, isConditional, ifNoneMatch, isLive, wantNetGeo,
    outputFormat, canonicalFormat, variantKey, variantTtlSec, mappingTag, dynamicPoster, immutablePoster,
  })

  // 3. Memory cache check (lookup in phases.ts)
  const cacheLookupCtx: PosterCacheLookupContext = {
    req,
    mediaType,
    tmdbId,
    startTime,
    isPreview,
    isConditional,
    ifNoneMatch,
    isLive,
    wantNetGeo,
    refreshRequest,
    needsVariant,
    outputFormat,
    variantKey,
    cacheKey,
    variantTtlSec,
    dynamicTtlSec,
    dynamicPoster,
    immutablePoster,
    serveResponseVariant,
  }
  const variantLookupResponse = checkPosterVariantFastPath(cacheLookupCtx)
  if (variantLookupResponse) return variantLookupResponse
  const cachedPosterNow = Date.now()
  const cachedPoster = readCachedPoster(cacheKey, cachedPosterNow)
  const canonicalLookupResponse = checkPosterCanonicalCache(cacheLookupCtx, cachedPoster, cachedPosterNow)
  if (canonicalLookupResponse) return canonicalLookupResponse
  // Copia scaduta con condizionale o live=1, oppure nessuna copia: si
  // rivalida (deduplicazione inflight sotto, poi confronto sul validatore
  // finale). Se la rivalidazione fallisce, errore — mai un falso 304.

  const pendingPoster = getPendingPoster(cacheKey)
  if (pendingPoster && !wantNetGeo) return await serveCoalescedPoster(cacheLookupCtx, pendingPoster)
  const negativeLookupResponse = checkPosterNegativeCache(cacheLookupCtx)
  if (negativeLookupResponse) return negativeLookupResponse
  const completePosterRender = beginPosterRender(cacheKey)

  // Flag impostato dal watchdog: se la pipeline supera RENDER_TIMEOUT_MS le
  // risposte di errore successive devono essere 503 (upstream lento/assente),
  // MAI 404: un titolo reale non è "non trovato" solo perché il render ha
  // sforato il tempo massimo (prima il ramo !originalBuf rispondeva 404 e
  // scriveva una negative-cache 404, facendo credere inesistente un titolo
  // sano per i 5s di TTL).
  let deadlineFired = false

  // Deadline complessivo del render (F2): se la pipeline non finisce entro
  // RENDER_TIMEOUT_MS (es. sharp appeso o upstream degradato), il watchdog
  // abbandona il render e libera sia la inflight map sia lo slot, così gli
  // altri render non restano in starvation. completePosterRender è idempotente
  // e releaseSlotOnce è guarded: il watchdog può scattare prima del finally.
  const renderAbort = new AbortController()
  let releaseRender: (() => void) | null = null
  let slotReleased = false
  let endZombieRender: (() => void) | null = null
  const releaseSlotOnce = (): void => {
    if (releaseRender && !slotReleased) {
      slotReleased = true
      releaseRender()
    }
  }
  // H1 fetch guard: same ownership as the composite slot above — acquired at
  // the top of the render job, freed by the watchdog on deadline (every fetch
  // below is abort-bounded, so the abandon settles fast) and by the guarded
  // finally on every other path. Never double-counted with the composite.
  let releaseFetch: (() => void) | null = null
  let fetchReleased = false
  const releaseFetchOnce = (): void => {
    if (releaseFetch && !fetchReleased) {
      fetchReleased = true
      releaseFetch()
    }
  }
  // H2: the deadline also settles the ORIGINAL caller. The timer below resolves
  // a dedicated deadline response (bounded 503 with Retry-After) while the
  // actual render job keeps running in the background with full cleanup
  // ownership (slot/zombie/inflight) until it REALLY settles. The GET returns
  // whichever settles first and never frees job-owned accounting early.
  let resolveDeadline: ((res: Response) => void) | null = null
  const deadlineResponse: Promise<Response> = new Promise<Response>((resolve) => {
    resolveDeadline = resolve
  })
  const renderDeadline = setTimeout(() => {
    deadlineFired = true
    // Osservabilità hang (Bugonia): prima lo scatto era silenzioso e l'unica
    // traccia era lo zombie-warn 10s dopo senza tmdbId — diagnosi cieca.
    log.warn("Poster render deadline exceeded — waiter abandoned, zombie continues", { mediaType, tmdbId, ms: Date.now() - startTime })
    renderAbort.abort()
    // R4: risolve i waiter con null ma TIENE l'entry inflight prenotata allo
    // zombie (keepEntry) — i nuovi arrivati fanno 503 immediato invece di
    // duplicare il render. L'entry si libera alla fine dello zombie o al
    // timeout 60s di beginPosterRender.
    completePosterRender(null, true)
    endZombieRender = recordZombieRenderStart(`${mediaType}:${tmdbId}`)
    releaseSlotOnce()
    releaseFetchOnce()
    // H2: single 503 accounting for the abandoned render — the late job must
    // NOT count or write again on settle (see the deadlineFired guards in the
    // job catch and the post-compositing guard below).
    recordPosterError()
    writePosterError(cacheKey, 503)
    resolveDeadline?.(posterErrorResponse(503))
  }, Math.max(1, RENDER_TIMEOUT_MS - preflightMs))
  if (typeof renderDeadline.unref === "function") renderDeadline.unref()

  // H2: whole async post-preflight render job. The GET races this job against
  // the dedicated deadline response above, so a non-cooperative backend (one
  // that ignores renderAbort, e.g. a stuck native worker) can no longer hang
  // the ORIGINAL caller past the deadline. Cleanup ownership stays with the
  // job: its catch/finally keeps releaseSlotOnce/releaseFetchOnce/endZombie/
  // completePosterRender until the work ACTUALLY settles — the early GET
  // return path must never free zombie budget or inflight while work runs.
  // Inner lines keep their existing indentation on purpose: boundary-only
  // diff, no 1500-line reindent.
  const renderJob: Promise<Response> = (async (): Promise<Response> => {
  try {
  // H1 fetch guard: bound the whole fetch/decode phase (Block A/B image
  // downloads, logo-fit candidates, sharp decodes) that runs outside the
  // composite slot. Same 503 + Retry-After backpressure when permits stay
  // busy past the wait; the watchdog frees the permit on deadline and the
  // finally below frees it on every other path.
  if (!releaseFetch) {
    releaseFetch = await acquirePosterFetchSlot()
    if (!releaseFetch) {
      completePosterRender(null)
      // H2 single-503: past the deadline the watchdog already wrote the
      // 503 entry — the late job only answers 503, never rewrites.
      if (!deadlineFired) writePosterError(cacheKey, 503)
      return posterErrorResponse(503)
    }
  }
  // 4. Resolve poster/logo/backdrop paths (campi documentati in sources.ts)
  const artwork: PosterArtwork = {
    posterPath: null,
    posterPathBuffer: null,
    portraitBackdropCropPath: null,
    mappingPortraitBackdropPath: null,
    logoPathBuffer: null,
    logoPath: null,
    autoPosterClean: false,
    posterRequestedLang: posterRegion.lang2,
    logoChosenIso: null,
    logoFallbackReason: null,
    backdropPath: null,
    autoBackdropPath: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    autoFetchFailed: false,
    textLogo: resolveTextLogo(hardenedParams.get("ltext"), hardenedParams.get("lfont")),
    textLogoAuto: false,
  }
  const titleMeta: PosterTitleMeta = {
    genreName: null,
    voteAverage: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    nextEpisodeAirDate: null,
    numberOfEpisodes: null,
    originCountries: [],
    genreIds: null,
    tvType: null,
    tvStatus: null,
    tmdbStudios: [],
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbNetworksDetailed: [],
    productionCompaniesDetailed: [],
    imdbId: pathImdbId,
    autoTitle: null,
    wikidataId: null,
  }
  // A1: promise del voto medio TMDB+IMDb (MDBList) lanciata nel ramo
  // non-mappato ma attesa SOLO dopo il blocco dati parallelo, con un tetto
  // breve (RATING_WAIT_MS): se MDBList è lenta, il poster usa il voto TMDB
  // senza aspettare il timeout di fetch (8s).
  // AbortController dedicato: passare renderAbort.signal a fetchAggregatedRating
  // bypasserebbe il timeout interno di 8s (ratings.ts usa signal ?? timeout), e
  // renderAbort non viene mai abortito a render riuscito → il controller va
  // abortito subito dopo la race per non lasciare il fetch orfano in background.
  let aggregatedRating: ReturnType<typeof fetchAggregatedRating> | null = null
  let multiRatingOnly = false
  const ratings: RatingItem[] = []
  // Colonna rating separati: popolata dai sources aggregati dopo la race.
  let sepItems: SeparateRating[] = []
  let ratingAbort: AbortController | null = null
  let showBadges = true
  let rankingBadges = true
  const sessionLang = canonicalLang || mapping?.language || posterRegion.lang2
  {
    const queryWikidataId = hardenedParams.get("wikidata_id")
    const mappingWikidataId = mapping?.wikidataId ?? null
    const sessionWikidataId = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.externalIds?.wikidata_id ?? null
    if (isValidWikidataQid(queryWikidataId)) titleMeta.wikidataId = queryWikidataId
    else if (isValidWikidataQid(mappingWikidataId)) titleMeta.wikidataId = mappingWikidataId
    else if (isValidWikidataQid(sessionWikidataId)) titleMeta.wikidataId = sessionWikidataId
  }

  const queryPoster = hardenedParams.get("poster")
  const queryLogo = hardenedParams.get("logo")
  const queryBackdrop = hardenedParams.get("backdrop")
  // Base portrait scelta live dall'editor (`pbase`): path TMDB di un backdrop
  // clean selezionato nel picker. Vince sulla base salvata/con automatica solo
  // in forma canonica (path TMDB raster): un valore malformato è assente.
  const queryPortraitBase = sanitizePortraitBaseBackdropPath(hardenedParams.get("pbase"))
  // Formato canvas: query `shape` > mapping > config > defaults (stessa
  // catena degli altri parametri — vedi resolvePosterShape). Solo
  // "landscape" attiva il ramo 16:9 con base = sfondo TMDB.
  const isLandscape = resolvePosterShape(req.nextUrl.searchParams, mapping, configOverride, sd) === "landscape"
  const queryGenre = hardenedParams.get("genreName")
  const queryVote = hardenedParams.get("voteAverage")
  // Fonti voto medio ★ — stessa catena canonica di poster-config/Stremio:
  // query `rsrc` > mapping per-titolo > config token > server defaults > default.
  // (Prima: senza whitelist e senza mapping/sd — la preview col client valeva
  // una media diversa da Stremio a parità di titolo.)
  const reqRatingSources = resolveRatingSources(
    hardenedParams.get("rsrc"),
    mapping?.ratingSources,
    configOverride?.ratingSources,
    sd.ratingSources,
  )
  const t = createT(canonicalLang || mapping?.language || posterRegion.lang2)

  // 4b. Rami di risoluzione (resolve-sources.ts): query > mapping > automatico.
  const sourceCtx: SourceResolutionContext = {
    req, hardenedParams, mediaType, tmdbId, mapping, earlyEffMapping, sd, configOverride,
    posterRegion, canonicalLang, isLandscape, autoWordmarkEnabled, portraitBackdropFallback,
    dynamicDayBucket, dynamicRotationIncludeNonClean, effTmdbKey, effMdblistKey, effSimklKey,
    reqRatingSources, renderAbort, queryPoster, queryLogo, queryBackdrop,
    queryPortraitBase, queryGenre, queryVote,
  }
  if (queryPoster) {
    ;({ showBadges, rankingBadges } = resolveQuerySources(sourceCtx, artwork, titleMeta))
  } else if (mapping) {
    ;({ showBadges, rankingBadges } = await resolveMappingSources(sourceCtx, mapping, artwork, titleMeta))
  } else {
    ;({ aggregatedRating, ratingAbort } = await resolveAutoSources(sourceCtx, artwork, titleMeta))
  }

  // Landscape senza backdrop esplicito (query `backdrop` o mapping): i rami
  // query/mapping non toccano TMDB, ma la base 16:9 richiede uno sfondo —
  // fallback live a details.backdrop_path (poi primo backdrops di /images).
  // Solo ramo landscape: il portrait non ne ha bisogno. Su errore resta null
  // e il blocco landscape sotto risponde 404 onesto.
  if (isLandscape && !queryBackdrop && !mapping?.backdropPath && !artwork.autoBackdropPath) {
    try {
      const fbApiKey = effTmdbKey
      const fbLang = canonicalLang || mapping?.language || posterRegion.lang2
      const cached = getTMDBSessionCache(mediaType, tmdbId, fbLang)
      let fbDetails = cached?.details
      if (!fbDetails) {
        fbDetails = await getDetails(mediaType, tmdbId, fbLang, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS)
        const prev = getTMDBSessionCache(mediaType, tmdbId, fbLang)
        setTMDBSessionCache(mediaType, tmdbId, fbLang, { ...prev ?? undefined, details: fbDetails })
      }
      artwork.autoBackdropPath = fbDetails?.backdrop_path || null
      if (!artwork.autoBackdropPath) {
        const fbImages = cached?.images
          ?? await getImages(mediaType, tmdbId, `${fbLang},en,null`, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
        if (fbImages && !cached?.images) {
          const prev = getTMDBSessionCache(mediaType, tmdbId, fbLang)
          setTMDBSessionCache(mediaType, tmdbId, fbLang, { ...prev ?? undefined, images: fbImages })
        }
        artwork.autoBackdropPath = fbImages?.backdrops?.[0]?.file_path || null
      }
    } catch {
      artwork.autoBackdropPath = null
    }
  }

  // B2: fallback backdrop-crop — SOLO sostituzione del 404, mai su poster
  // esistenti. Senza poster TMDB utilizzabile ma con un backdrop (query >
  // mapping > automatico), la base diventa il cover-crop 2:3 del backdrop
  // invece di 404. Vale per entrambi i canvas (in landscape la base coperta
  // dal backdrop full-bleed alimenta comunque pillarbox e cache image-level,
  // namespaced per path come le altre sorgenti). Deadline/fetch falliti
  // restano 503/404: niente crop su dati degradati.
  if (!artwork.posterPath && !deadlineFired && !artwork.autoFetchFailed) {
    const cropSrc = queryBackdrop || mapping?.backdropPath || artwork.autoBackdropPath || artwork.backdropPath
    if (cropSrc) {
      try {
        const cropBase = await fetchImg(landscapeBackdropUrl(cropSrc), renderAbort.signal).catch(() => null)
        if (cropBase) {
          artwork.posterPathBuffer = await cropBackdropToPortrait(cropBase)
          artwork.posterPath = cropSrc
          recordBackdropCropRescue()
        }
      } catch {
        // Fallthrough al 404/503 sotto.
      }
    }
  }

  try {
    if (!artwork.posterPath) {
      // Deadline sforato o fetch upstream fallito: NIENTE 404. Il titolo può
      // semplicemente essere lento/indisponibile upstream; la negative-cache 503
      // (TTL breve) evita la tempesta di ri-render senza marchiare il titolo
      // come inesistente. Dentro il try: il finally unifica il rilascio slot
      // (releaseSlotOnce è idempotente) — nessun return fuori dal try/finally
      // può più leakare lo slot acquisito dal logo-fit.
      if (deadlineFired || artwork.autoFetchFailed) {
        // H2 single-503: past the deadline the watchdog already wrote the
        // 503 entry — the late job only answers 503, never rewrites.
        // Pre-deadline autoFetchFailed still writes (existing negative cache).
        if (!deadlineFired) writePosterError(cacheKey, 503)
        completePosterRender(null)
        return posterErrorResponse(503)
      }
      // Nessun poster davvero disponibile per questo titolo: 404 + negative cache.
      writePosterError(cacheKey, 404)
      completePosterRender(null)
      return new Response("Poster not found", { status: 404, headers: corsHeaders() })
    }

    // Ramo landscape: la base è lo sfondo TMDB (query `backdrop` > mapping >
    // ramo automatico). Senza sfondo la base diventa pillarbox dal poster
    // (mai 404: nessun riquadro rotto su Stremio).
    if (isLandscape) {
      artwork.backdropPath = queryBackdrop || mapping?.backdropPath || artwork.autoBackdropPath || artwork.backdropPath
    }

    // Wordmark automatico in preview (`lauto=1`): risolto QUI perché la base
    // di una preview query-only è nota solo dopo il fallback backdrop
    // landscape (senza `backdrop=` la base la decide il renderer unico, che
    // deve comporre lo stesso wordmark di Stremio). La preview manda solo il
    // flag, MAI il testo: il server lo deriva dal `title` con la stessa
    // funzione del render Stremio, così il save non eredita un wordmark
    // automatico. Logo immagine, testo digitato e base in lingua/custom
    // spengono il flag (una sola sorgente logo, stessa precedenza del render).
    if (queryPoster && !artwork.textLogo && hardenedParams.get("lauto") === "1") {
      const queryBaseTextless = isLandscape
        ? !!artwork.backdropPath && !isCustomPosterUrl(artwork.backdropPath)
        : !!artwork.posterPath && !isCustomPosterUrl(artwork.posterPath)
      const auto = resolveAutoWordmark({
        enabled: autoWordmarkEnabled,
        title: hardenedParams.get("title"),
        hasImageLogo: !!artwork.logoPath,
        hasTypedText: false,
        logoDisabled: false,
        baseIsTextless: queryBaseTextless,
      })
      if (auto) {
        artwork.textLogo = auto
        artwork.textLogoAuto = true
      }
    }

    // H1: the render slot is acquired just before the composite below —
    // never held across the Block A/B network waits above. Unchanged 503 +
    // Retry-After backpressure when all slots stay busy past the timeout.
    // 5. Fetch in parallelo (fetch-render-data.ts): flag early, base custom, Block A + Block B.
    const {
      qQualityParam, rankingEnabledEarly, preJw, preDigital, effectiveCustomUrl, wikidataRaceTimedOut,
      backdropCustomForFetch, originalBase, logoFetch, backdropFetch, rankingResult, animeRankResult,
      rawLiveQuality, preReleaseDetected, wikidataResult, tmdbKeywords, imdbTop250, ageCert,
      ...pendingRating
    } = await fetchRenderData({
      req, hardenedParams, mediaType, tmdbId, mapping, earlyEffMapping, sd, earlyEffSd, configOverride,
      configToken, posterRegion, sessionLang, rotationSelectedLang, canonicalQuality, isLandscape,
      earlyLandscape, queryPoster, queryBackdrop, showBadges, rankingBadges, sepDisplay,
      customRatingConfig, reqRatingSources, effTmdbKey, effMdblistKey, effSimklKey, preTrendRank,
      preAnimeRank, renderAbort,
    }, artwork, titleMeta, { aggregatedRating, multiRatingOnly, ratingAbort })
    ;({ aggregatedRating, multiRatingOnly, ratingAbort } = pendingRating)

    // Base portrait: l'URL custom vince solo se scaricato e validato,
    // altrimenti vale il TMDB (fallback parallelo, mai seriale).
    const originalBuf = originalBase?.buf ?? null

    // Normalizza il risultato qualità (oggetto statusato oppure legacy string /
    // null da `?quality=` e dai mock): da qui in poi solo StreamQualityResult.
    // Nota: la decisione effimera (TTL) sta dopo resolvePosterRenderConfig e
    // usa il badgeQuality FINALE, non l'early (stessa catena, ma l'autorevole
    // è quello — un futuro disallineamento non deve rompere la cache).
    const liveQualityResult = normalizeQualityResult(rawLiveQuality as StreamQualityResult | StreamQuality | string | null)
    const liveQuality = liveQualityResult.quality

    // A1: upgrade del voto con la media TMDB+IMDb, ma con tetto breve: oltre
    // RATING_WAIT_MS si usa il voto TMDB già impostato (niente blocco lungo).
    // Dopo la race, se il fetch è ancora in corso viene abortito (no-op se ha
    // già vinto): il risultato è scartato, non ha senso tenerlo in background.
    // Demo samples: merge gap-only sulle fonti richieste (i voti reali non si
    // toccano mai). Nessuna attesa aggiuntiva: la race sotto è quella esistente,
    // saltata del tutto senza promise di fetch. Il rendering resta gated dai
    // toggle a valle (br/custom/sep), mai forzato qui.
    let aggregated: Awaited<ReturnType<typeof fetchAggregatedRating>> = null
    if (aggregatedRating) {
      // Fix L3: timer della race RATING_WAIT cancellato se vince il fetch.
      let ratingTimer: ReturnType<typeof setTimeout> | undefined
      const ratingTimeout = new Promise<Awaited<ReturnType<typeof fetchAggregatedRating>>>((resolve) => {
        ratingTimer = setTimeout(() => resolve(null), RATING_WAIT_MS)
      })
      aggregated = await Promise.race([aggregatedRating, ratingTimeout])
      if (ratingTimer) clearTimeout(ratingTimer)
      ratingAbort?.abort()
    }
    // Copia merged (mai in place: l'aggregato reale può essere cachato).
    const effectiveAggregated = demoSamples ? mergeDemoSampleRatings(aggregated, reqRatingSources) : aggregated
    if (effectiveAggregated) {
      const imdbRating = effectiveAggregated?.sources.imdb
      if (customRatingConfig.enabled && typeof imdbRating === "number" && Number.isFinite(imdbRating) && imdbRating > 0 && imdbRating <= 10) {
        ratings.push({ id: "imdb", name: "IMDb", value: imdbRating, format: "decimal" })
      }
      if (!multiRatingOnly) {
        const avgVote = computeVote(effectiveAggregated, reqRatingSources)
        if (typeof avgVote === "number" && avgVote > 0) titleMeta.voteAverage = avgVote
      }
      // Colonna separati: dai sources aggregati (anche con media skippata via
      // multiRatingOnly — i sources servono comunque). Vuoto → fallback media.
      // Vale per entrambi i canvas (la colonna segue il badge qualità).
      if (sepDisplay) sepItems = pickSeparateRatings(effectiveAggregated, reqRatingSources)
      ratingAbort?.abort()
    }

    // Base effettiva: portrait = poster; landscape = sfondo TMDB o, in sua
    // assenza, pillarbox ricavato dal poster (vedi sotto).
    const baseBuf = isLandscape ? (backdropFetch ?? originalBuf) : originalBuf
    if (!baseBuf) {
      // Deadline sforato → 503 con negative cache: il fetch dell'immagine è
      // stato abortito dal watchdog, non è un titolo inesistente.
      if (deadlineFired) {
        // H2 single-503: the watchdog already wrote the 503 entry at the
        // deadline — the late job only answers 503, never rewrites.
        completePosterRender(null)
        return posterErrorResponse(503)
      }
      // Immagine davvero non disponibile dal CDN: 404 + negative cache per i
      // waiter coalesced e per le richieste successive.
      writePosterError(cacheKey, 404)
      completePosterRender(null)
      return new Response(isLandscape ? "Landscape backdrop not available" : "Poster image not available", { status: 404, headers: corsHeaders() })
    }

    // rankingResult è autoritativo: il fallback al mapping salvato avviene solo
    // su fetch fallito (nei catch sopra), MAI su miss genuina. Altrimenti un
    // titolo uscito dalla chart mostrerebbe per sempre il rank del save
    // precedente (es. "top 15" di un titolo oggi fuori top 20).
    const rankingRank = rankingResult ?? (demoSamples && rankingEnabledEarly ? DEMO_SAMPLE_RANK : null)
    // rank/label dalla query hardenata (stessa del cache key): su presets il
    // label free-text è droppato/canonicalizzato, il rank numerico resta.
    // Precedenza rank: `rank=` esplicito (override manuale, vince) > `rk=`
    // contesto lista effimero (posizione nella lista di origine, decisione A)
    // > rank live da fonte selezionata. `rk=0` = unranked esplicito (sopprime
    // il badge, mai fallback al live). `rk` invalido = assente (legacy).
    const qRank = hardenedParams.get("rank")
    const qLabel = hardenedParams.get("label")
    const finalRank = resolveFinalRankWithListContext(qRank, hardenedParams.get("rk"), rankingRank)

    // Fase 6 (observability): fine della fase fetch (mapping/defaults + TMDB +
    // JW + wikidata + immagini + selezione logo). Da qui in poi solo CPU locale.
    const tFetchMs = Date.now() - startTime

    // 6. Details recovery + resize base + luminance (vedi render-base.ts)
    const { posterBuf, analysisKey, qBottomLight, customRatings, bottomLum, topLight } = await prepareRenderBase({
      req, mediaType, tmdbId, mapping, canonicalLang, posterRegion, effTmdbKey, isLandscape,
      customRatingConfig, effectiveCustomUrl, backdropCustomForFetch, backdropFetch, renderAbort,
    }, baseBuf, artwork, titleMeta)

    // 7. Parse blur / badge / logo config from query
    const renderConfig = resolvePosterRenderConfig({
      searchParams: hardenedParams,
      mapping,
      configOverride,
      sd,
      hasQuery: !!queryPoster || !!mapping || !!configToken,
      showBadges,
      rankingBadges,
      animeRank: animeRankResult,
      rankingResult,
      finalRank,
      // Effective authorized preview (downgrade-aware): staged `theme=` wins
      // over the saved mapping; a downgraded preview resolves as non-preview.
      isPreview,
      // Fix L32: lingua per la risoluzione delle label prefissate (__badge.*).
      lang: canonicalLang || mapping?.language || posterRegion.lang2,
    })
    const {
      badgeStyle, rankingBadgeStyle, qualityBadgeStyle, qualityGroupLayout, badgeFont,
    extraBadgeStyle,
      blurEnabled, blurIntensity, blurDarkness, tintStrength, topShade, topShadeHeight,
      badgesEnabled, rankingEnabled,
      badgeGenre, badgeYear, badgeRating, badgeQuality, ageBadge, ageBadgeStyle, awardBadgeStyle, minQuality, sashOrder,
      disabledContentTags, disabledNetworks,
      separateRatings, separateRatingsStyle,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      separateBadgeScale,
      separateBadgeOffsetX, separateBadgeOffsetY,
      badgeItemTransforms,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      queryExtra, qNetLogo, networkLogo, networkLogoPosition, ribbonSide, ribbonEnabled, rankingBadgeAccent,
      networkLogoFollowTitle, networkFixedX, networkFixedY,
      preRelease, posterShape, posterLayout, posterFreshScope, logoAlign, seasonalTheme, hideLogo,
    } = renderConfig

    // Blur non-clean + stato display dei rating separati (display-state.ts).
    const {
      effBlurHeight, effBlurFade, separateDisplay, useSeparate, bottomActive,
      effectiveBadgeRating, effectiveBadgeGenre, effectiveBadgeYear, logoBadgeVisibility,
    } = resolveRenderDisplay({ renderConfig, isPreview, mapping, queryPoster, sepItems }, artwork)

    // TTL effimero per i render degradati (vedi freshness.ts).
    const ephemeral = resolveEphemeralPolicy({
      mediaType, tmdbId, mapping, sd, hardenedParams, canonicalLang, posterRegion, t, demoSamples,
      badgesEnabled, rankingEnabled, badgeQuality, ageBadge, preRelease, queryExtra, sashOrder,
      disabledContentTags, qQualityParam, liveQualityResult, ageCert, wikidataResult, wikidataRaceTimedOut,
      effectiveCustomUrl, originalBase, preDigital, preJw, preReleaseDetected, finalRank, animeRankResult,
      tmdbKeywords, imdbTop250, aggregated, dynamicTtlSec, immutablePoster,
    }, titleMeta)
    const { ageLabel, ageEphemeral, ephemeralTtl, effectiveImmutable } = ephemeral
    // Task D: riassegnato sotto dal freshness cap (solo restrizione, mai estensione).
    let effectiveTtlSec: number | undefined = ephemeral.effectiveTtlSec

    // Polarità del badge genere in basso: speculare a topLight, ma corretta per
    // la banda blur (che scurisce il fondo) — vedi computeBottomLight. `bl`
    // esplicito vince (preview WYSIWYG), altrimenti decide il server.
    const bottomLight = (qBottomLight === "1" || qBottomLight === "true") ? true : (qBottomLight === "0" || qBottomLight === "false") ? false : (computeBottomLight(bottomLum, blurDarkness, blurEnabled) ?? topLight)

    // Il rilevamento (`preReleaseDetected`) cambia nel tempo: non entra nella
    // cache key (verrebbe letta prima del fetch), il ritorno al poster normale
    // avviene alla scadenza del TTL (6h non-mappati, 24h mappati).
    const applyPreRelease = preRelease && preReleaseDetected

    // Qualità + formati A/V (vedi quality.ts).
    const { finalQuality, finalVideoFormats } = resolveRenderQuality({
      req, sd, earlyEffSd, earlyEffMapping, qQualityParam, liveQuality, liveQualityResult,
      minQuality, badgeQuality, demoSamples,
    }, titleMeta)

    const locale = canonicalLang || mapping?.language || posterRegion.lang2
    // Formato data badge "in uscita": query `df` > default utente > `locale`
    // (fail-closed: valori ignoti o assenti = comportamento storico).
    const dateFormat = parseDateFormat(hardenedParams.get("df") ?? sd.dateFormat ?? null) ?? "locale"
    // Genere in alto con slot libero: query `gtop` (presente ≠ "0" = on, come
    // gli altri toggle booleani in chiave) > default utente > off.
    const qGtop = hardenedParams.get("gtop")
    const genreTopWhenFree = qGtop !== null ? qGtop !== "0" : sd.genreTopWhenFree === true
    // Task D — freshness cap dai fatti volatili consumati (vedi freshness.ts).
    const factCap = resolveFactCap({
      mediaType, tmdbId, posterRegion, t, scopedUser, effTmdbKey, effMdblistKey, effTvdbKey,
      rankingEnabled, preRelease, preDigital, preJw, rankingSourcePre, rankingCustomPre, streamingRankPre,
      needTrendFetch, needAnimeFetch, trendRankLive, animeRankLive, preTrendRank, preAnimeRank,
      trendSnapshotPin, animeSnapshotPin, streamingSnapshotPin, jwFamily, chartAnimeFamily, animeListKey,
      animeKeyUsed, addonRankingInput, cacheKey, dynamicPoster, dynamicCutTtlMs,
    }, titleMeta, { applyPreRelease, locale, dateFormat, ephemeralTtl }, effectiveTtlSec)
    effectiveTtlSec = factCap.effectiveTtlSec
    const { factExpiresAtMs, policyBaseMs, cappedTtlMs, factCappedWrite } = factCap
    // Normalizza i generi composti TV grezzi ("Sci-Fi & Fantasy" mai localizzato
    // in it-IT) in etichette brevi da badge — stesso helper del client, così
    // preview e poster Stremio non divergono e i mapping storici grezzi si
    // sanano senza migrazione. Idempotente.
    titleMeta.genreName = normalizeGenreName(titleMeta.genreName, locale) || null
    // Demo samples: genere/anno reali quando disponibili, fallback fissi
    // (passato deterministico: nessun badge upcoming/new) quando assenti.
    if (demoSamples) {
      if (!titleMeta.genreName) titleMeta.genreName = normalizeGenreName(DEMO_SAMPLE_GENRE, locale) || DEMO_SAMPLE_GENRE
      if (!titleMeta.releaseDate && !titleMeta.firstAirDate) {
        if (mediaType === "tv") titleMeta.firstAirDate = DEMO_SAMPLE_TV_DATE
        else titleMeta.releaseDate = DEMO_SAMPLE_MOVIE_DATE
      }
    }
    const targetCenter = Math.round(30 * (isLandscape ? LAND_H : STD_H) / 570)

    // 8. Pre-resolve accent color override
    // Query `ac=` manuale vince; altrimenti il manuale salvato EFFETTIVO per
    // forma (profilo landscape vince sul flat a chiave presente — null di
    // profilo = automatico esplicito, mai resurrect del flat; assente =
    // eredita). Solo manuali persistiti: gli auto effettivi non si congelano.
    const qAc = hardenedParams.get("ac")
    const effAccentForShape = effectiveMappingForShape(mapping, isLandscape ? "landscape" : "poster")?.accentColor
    const accentOverride = (qAc && isValidHex(qAc))
      ? { genreColor: qAc, rankColor: qAc }
      : effAccentForShape
        ? { genreColor: effAccentForShape, rankColor: effAccentForShape }
        : null

    // 9. Debug mode — JSON instead of the poster (no render, no cache write,
    // no 304). With authorized `netgeo=1` generation runs first and the return
    // below adds the actually rendered network geometry (single renderer source
    // for the UI freeze); plain `debug=1` stays render-free for existing
    // consumers. Normal poster responses are unchanged either way.
    let debugJson: Record<string, unknown> | null = null
    if (isDebug) {
      debugJson = buildPosterDebugJson({
        tmdbId, mediaType, mapping, posterRegion, locale, t, dateFormat, isLandscape, hardenedParams,
        artwork, titleMeta, renderConfig,
        rankingResult, animeRankResult, wikidataResult, wikidataRaceTimedOut, tmdbKeywords, imdbTop250,
        aggregated, liveQualityResult, preJw, preDigital, preReleaseDetected,
        finalRank, finalQuality, qLabel, ageLabel, ageEphemeral, applyPreRelease, accentOverride,
        topLight, bottomLight, bottomActive, useSeparate, effBlurHeight, effBlurFade,
        cacheHit: !!cachedPoster.payload,
        cacheStale: !!cachedPoster.payload && cachedPoster.stale,
        startTime, tFetchMs,
      })
      if (!wantNetGeo) {
        completePosterRender(null)
        return Response.json(debugJson)
      }
    }

    // Fallback mapping network logo per poster salvati (quando non c'è fetch live)
    if (mapping && titleMeta.tmdbNetworksDetailed.length === 0 && titleMeta.productionCompaniesDetailed.length === 0 && (mapping.networkLogoPath || mapping.networkLogoName)) {
      const fallbackName = mapping.networkLogoName || "network"
      const fallbackPath = mapping.networkLogoPath || null
      // Non sappiamo se è network o production: mettiamo in networks per priorità
      titleMeta.tmdbNetworks = [fallbackName]
      titleMeta.tmdbNetworksDetailed = [{ name: fallbackName, logoPath: fallbackPath }]
    }

    // 10. Generate poster buffer
    // Collettore geometria network per il debug (solo numeri): in fissa è la
    // fonte del freeze senza salto; nel path normale resta inutilizzato.
    let netGeo: NetworkGeometry | null = null
    // Collettore geometria badge (stessi numeri della preview, unico renderer):
    // box finali per le maniglie di drag in Impostazioni globali.
    let badgeGeo: BadgeGeometryReport | null = null
    // Effective-accent collector (display sync): per-request local, filled by
    // the service's pure observer with the fills actually painted. Collected
    // on EVERY render (preview included) — the PNG no-store gate below is
    // untouched, only the ~250-byte meta is retained (sidecar + completed).
    let collectedAccentMeta: EffectiveAccentMeta | null = null
    const genInput: GenerationInput = {      // Custom values override internal sources with the same ID, preserving order.
      // In bottom il custom provider non si rende (suppressCustomRow): la
      // priorità storica della colonna resta invariata.
      ratings: customRatingConfig.enabled && !separateDisplay.suppressCustomRow ? [...new Map([...ratings, ...customRatings].map(item => [item.id, item])).values()] : undefined,
      // Never forwarded: in landscape the fitted backdrop IS `posterBuf`
      // (the service layer would be redundant work on the same bytes), in
      // portrait there is no backdrop layer at all. The service gate is the
      // second line of defence.
      posterBuf, logoFetch, backdropFetch: null,
      backdropScale: artwork.backdropScale, backdropOffsetX: artwork.backdropOffsetX, backdropOffsetY: artwork.backdropOffsetY,
      blurEnabled, blurHeight: effBlurHeight, blurIntensity, blurFade: effBlurFade, blurDarkness, tintStrength, topShade, topShadeHeight,
      badgesEnabled, rankingEnabled, genreName: titleMeta.genreName, voteAverage: titleMeta.voteAverage, badgeStyle,
      rankingBadgeStyle, extraBadgeStyle, badgeFont, badgeGenre: effectiveBadgeGenre, badgeYear: effectiveBadgeYear, badgeRating: effectiveBadgeRating, badgeQuality,
      qualityBadgeStyle,
      qualityGroupLayout,
      videoFormats: finalVideoFormats,
      separateRatings: (useSeparate || (bottomActive && sepItems.length > 0)) ? sepItems : undefined,
      separateRatingsStyle,
      // Toggle raw (pre-suppressione) per la colonna meta fresh: fresh
      // applica gli stessi gate condivisi sui valori raw — con i soli flag
      // effettivi (soppressi quando la colonna/bottom è attiva) non
      // mostrerebbe mai i separati. Standard invariato (usa gli effettivi).
      freshRawBadgeRating: badgeRating,
      freshRawSeparateRatings: separateRatings,
      freshRawBadgeGenre: badgeGenre,
      freshRawBadgeYear: badgeYear,
      sashOrder,
      disabledContentTags,
      disabledNetworks,
      quality: finalQuality,
      ageLabel,
      ageBadgeStyle,
      awardBadgeStyle,
      topLight, bottomLight, logoBadgeVisibility, targetCenter, ribbonSide, ribbonEnabled, rankingBadgeAccent,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      separateBadgeScale,
      separateBadgeOffsetX, separateBadgeOffsetY,
      badgeItemTransforms,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      mediaType: mediaType as "movie" | "tv",
      finalRank, animeRankResult, rankingResult,
      mapping, tmdbId, digitalReleaseDate: preDigital ?? null, tmdbNetworks: titleMeta.tmdbNetworks, productionCompanies: titleMeta.productionCompanies, tmdbStudios: titleMeta.tmdbStudios,
      tmdbNetworksDetailed: titleMeta.tmdbNetworksDetailed, productionCompaniesDetailed: titleMeta.productionCompaniesDetailed,
      tvType: titleMeta.tvType, tvStatus: titleMeta.tvStatus, releaseDate: titleMeta.releaseDate, firstAirDate: titleMeta.firstAirDate,
      lastAirDate: titleMeta.lastAirDate, seasonCount: titleMeta.seasonCount, nextEpisodeAirDate: titleMeta.nextEpisodeAirDate, numberOfEpisodes: titleMeta.numberOfEpisodes, originCountries: titleMeta.originCountries, genreIds: titleMeta.genreIds,
      wikidataResult, tmdbKeywords, locale, t,
      dateFormat,
      genreTopWhenFree,
      qLabel, queryExtra, qNetLogo, networkLogo, networkLogoPosition, sd,
      networkLogoFollowTitle, networkFixedX, networkFixedY,
      onNetworkGeometry: isDebug && wantNetGeo ? (geo) => { netGeo = geo } : undefined,
      onBadgeGeometry: isDebug && wantNetGeo ? (geo) => { badgeGeo = geo } : undefined,
      badgeHomeGhosts: isDebug && wantNetGeo && wantBadgeGhosts,
      onAccentMeta: (m) => { collectedAccentMeta = m },
      demoSamples,
      accentOverride, imdbTop250, whatsonFeatures: aggregated?.whatsonFeatures ?? null, preRelease: applyPreRelease,
      shape: posterShape,
      posterLayout,
      posterFreshScope,
      logoAlign,
      // Cornice stagionale (contesto effimero del catalogo di origine,
      // query-only via renderConfig — mai mapping/config/defaults).
      seasonalTheme,
      hideLogo,
      posterSrc: isLandscape ? artwork.backdropPath : artwork.posterPath,
      analysisKey,
      // Chiave della cache image-level del resize: il wordmark non ha un
      // path, quindi firma testo+font (stessi byte → stessa entry).
      logoSrc: artwork.textLogo
        ? (artwork.textLogoAuto
          ? `text-logo-auto:${artwork.textLogo.font}:${artwork.textLogo.text}`
          : `text-logo:${artwork.textLogo.font}:${artwork.textLogo.text}`)
        : artwork.logoPath,
      backdropSrc: isLandscape ? null : artwork.backdropPath,
      // C3: render sempre canonico (jpeg storico, webp con
      // PICTORIUM_IMAGE_FORMAT=webp; avif solo ?fmt=avif legacy esplicito).
      format: legacyAvif ? outputFormat : canonicalFormat,
    }
    if (renderAbort.signal.aborted) {
      throw new Error("Render deadline exceeded before poster compositing")
    }
    // H1 fetch permit: la fase fetch/decode è finita, quindi il permesso va
    // rilasciato PRIMA di attendere il composite slot. Un render in coda per
    // uno slot non tiene più occupato un permesso fetch (né il budget di
    // buffer che rappresenta): il picco di heap resta limitato alla fase di
    // fetch reale, non a fetch+attesa accodata. Idempotente: il finally
    // continua a rilasciarlo su ogni altro percorso e il watchdog sul deadline.
    releaseFetchOnce()
    // H1: single slot acquire, immediately before the composite it guards
    // (sharp buffers, blur, badge SVG→PNG). Fetch/prep above run slot-free so
    // cold renders scale with CPUs; RENDER_QUEUE/RENDER_SLOT_WAIT_MS semantics
    // (503 + Retry-After) unchanged. Released by the finally below.
    if (!releaseRender) {
      releaseRender = await acquirePosterRenderSlot()
      if (!releaseRender) {
        completePosterRender(null)
        // H2 single-503: past the deadline the watchdog already wrote the
        // 503 entry — the late job only answers 503, never rewrites.
        if (!deadlineFired) writePosterError(cacheKey, 503)
        return posterErrorResponse(503)
      }
    }
    // Fine della fase prep (resize, config, accent): da qui solo composite CPU.
    const tCompositeStart = Date.now()
    const composited = await generatePosterBuffer(genInput)
    // H2: the render outlived the deadline (a non-cooperative backend ignored
    // the abort). The caller already got the bounded 503 — never write/cache
    // poster bytes nor report success metrics for abandoned work. The watchdog
    // applied the single 503 accounting, so just free the kept inflight entry
    // and answer 503 without recounting.
    if (deadlineFired || renderAbort.signal.aborted) {
      completePosterRender(null)
      return posterErrorResponse(503)
    }
    // Debug with netgeo=1 (plain debug returned early above): pre-composite
    // payload plus the actually rendered network geometry. Numbers and
    // resolved config only, no sensitive data. Normal poster responses
    // below are unchanged.
    if (isDebug && wantNetGeo) {
      completePosterRender(null)
      return Response.json({ ...(debugJson ?? {}), network: netGeo ?? null, badges: badgeGeo ?? null })
    }
    // 10–11. ETag, cap alla scrittura, cache e risposta (finalize.ts).
    return await finalizePosterRender({
      mediaType, tmdbId, startTime, mapping, isPreview, isConditional, ifNoneMatch, isLive,
      cacheKey, mappingTag, outputFormat, needsVariant, dynamicPoster, dynamicDayBucket, dynamicCutTtlMs, customRatingConfig,
      titleMeta, finalRank, imdbTop250, applyPreRelease, useSeparate, bottomActive, sepItems, ephemeralTtl,
      effectiveImmutable, effectiveTtlSec, cappedTtlMs, policyBaseMs, factExpiresAtMs, factCappedWrite, genInput, composited,
      collectedAccentMeta, tFetchMs, tCompositeStart, completePosterRender, serveResponseVariant,
    })
  } catch (e) {
    completePosterRender(null)
    // Deadline sforato: il render è stato abbandonato dal watchdog perché
    // troppo lento → 503 invece di un 500 generico. H2: the watchdog already
    // applied the single 503 negative-cache entry and error count at the
    // deadline — a late failure must not count or write twice.
    if (deadlineFired) {
      log.error("Poster generation failed (render deadline exceeded)", { error: e instanceof Error ? e.message : String(e) })
      return posterErrorResponse(503)
    }
    recordPosterError()
    // F3: negative cache — lo stesso errore non ri-rende la pipeline per il TTL.
    writePosterError(cacheKey, 500)
    log.error("Poster generation failed", { error: e instanceof Error ? e.message : String(e) })
    return posterErrorResponse(500)
  } finally {
    clearTimeout(renderDeadline)
    releaseSlotOnce()
    releaseFetchOnce()
    const cleanupZombie = endZombieRender as (() => void) | null
    if (cleanupZombie) {
      cleanupZombie()
      endZombieRender = null
    }
  }
  } catch (outerError) {
    // H2: setup-phase failure before the inner render try (same propagation
    // as before — the caller still sees the throw) but without leaking the
    // armed deadline timer, an acquired slot, or the inflight entry. Past the
    // deadline the watchdog already accounted once: no recount here.
    clearTimeout(renderDeadline)
    releaseSlotOnce()
    releaseFetchOnce()
    completePosterRender(null)
    throw outerError
  }
  })()
  // H2: a late job settlement after the deadline already answered the caller
  // must stay silent — a late failure is logged, never unhandled and never
  // double-counted. This handler marks the job promise handled so a late
  // rejection cannot surface as an unhandled rejection; the race below still
  // observes the job outcome for the timely path.
  void renderJob.then(
    () => {},
    (e: unknown) => {
      if (deadlineFired) {
        log.error("Late poster render failed after deadline (caller already answered)", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
      }
    },
  )
  // Original caller: whichever settles first wins. Past the deadline this is
  // the bounded 503 with Retry-After; the actual job keeps running in the
  // background with its own cleanup until it really settles.
  return Promise.race([renderJob, deadlineResponse])
}
