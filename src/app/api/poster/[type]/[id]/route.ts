import { NextRequest } from "next/server"
import sharp from "sharp"
import { initSharp } from "@/lib/sharp-config"
import { getImages, getDetails, getDetailsWithExternalIds, getExternalIds, getKeywords, getReleaseDates, getContentRatings, resolveUserApiKeys, type TMDBImage, type TMDBCompany } from "@/lib/tmdb"
import { hasJWOffers, jwAvailabilityRemainingMs, jwRankingsRemainingMs, jwTitlesRemainingMs, JW_DIGITAL_MONETIZATION_TYPES } from "@/lib/justwatch"
import { resolveRankingSource } from "@/lib/ranking-source"
import { customRankingRemainingMs, fetchCustomRankingTop20, findRankingCustomCatalog } from "@/lib/custom-ranking"
import { extractDigitalReleaseDate, isDigitalPreRelease } from "@/lib/pre-release"
import { getAll, getById, getImdbAlias } from "@/lib/store"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { verifySessionFromRequestSync } from "@/lib/pin-auth"
import { checkAdminToken } from "@/lib/auth"
import { userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getServerDefaultsForUser, getServerDefaultsChecked, effectiveDefaultsForShape } from "@/lib/server-defaults"
import { effectiveMappingForShape } from "@/lib/types"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang, GLOBAL_REGION_CODE } from "@/lib/regions"
import { pinChartFamily, chartListGroupKey, chartPinCacheFragment, nextRomeSlotStartMs, type ChartFamilyPin } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { BEST_FIT_GLOBAL, resolveLogoFitEnabled } from "@/lib/best-fit-config"
import { selectAutoFitCandidates, selectBestLogoFitPosterPath } from "@/lib/poster-auto-fit"
import { fetchAllWikidata, matchTMDBStudios, directorBadgeLabel, isValidWikidataQid, type WikidataResult } from "@/lib/awards"
import { resolveWikidataId } from "@/lib/imdb-cache"
import { createT } from "@/lib/i18n-server"
import { mdblistRemainingMs } from "@/lib/mdblist"
import { fetchAggregatedRating, isMdbTmdbIdentityUsable, pickSeparateRatings, resolveRatingSources, type SeparateRating } from "@/lib/ratings"
import { isImdbTop100 } from "@/lib/imdb-top250"
import { getEffectiveRotationState, tryRotatePoster, getEffectiveBackdropRotationState, tryRotateBackdrop, getDynamicRotationBucket, rotationIndexFor, secondsUntilDynamicRotationCut } from "@/lib/poster-rotation"
import { getTMDBSessionCache, setTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import { RENDER_VERSION } from "@/lib/render-version"
import { envWithFallback } from "@/lib/env-compat"
import { TOP_LIGHT_LUMINANCE } from "@/lib/constants"
import {
  RENDER_SLOT_WAIT_MS,
  acquirePosterRenderSlot,
  beginPosterRender,
  canServePosterStaleHit,
  getPendingPoster,
  isImmutablePosterRequest,
  isLivePosterRequest,
  isPosterRefreshRequest,
  normalizePosterCacheParams,
  posterHeaders,
  posterNotModifiedHeaders,
  posterResponse,
  convertPosterFormat,
  convertToJpeg,
  variantEtagFor,
  dynamicPosterTtlMs,
  dynamicPosterTtlSec,
  readCachedPoster,
  readCompletedAccent,
  readPosterError,
  recordCompletedAccent,
  recordZombieRenderStart,
  schedulePosterRefresh,
  writeCachedPoster,
  writePosterError,
  recordPosterRequest,
  recordPosterError,
  recordPosterStaleHit,
  recordPosterCoalescedHit,
  recordPosterLatency,
  recordTvdbRescue,
  recordBackdropCropRescue,
  serverTimingValue,
  resolveImageFormat,
  DEFAULT_IMAGE_FORMAT,
  httpRemainingSec,
  payloadHttpRemainingSec,
  type PosterCachePayload,
  type PosterErrorStatus,
} from "@/lib/poster-runtime-cache"
import { capPosterTtlMs, isRankFactConsumed, resolvePosterFactCapMs } from "@/lib/poster-freshness"
import { sanitizeEffectiveAccentMeta, type EffectiveAccentMeta } from "@/lib/effective-accent"
import { hashUserFragment, msUntilPosterScheduledRefresh, userTagFragment } from "@/lib/cache"
import { FormatOverloadError, runFormatConversion } from "@/lib/poster-format-gate"
import { hardenPosterSearchParams, isPresetsPosterMode, isPreviewAuthRequired, isPreviewDowngraded, isPublicPosterInstance } from "@/lib/poster-params-hardening"
import { DEMOSAMPLES_FLAG, DEMO_SAMPLE_GENRE, DEMO_SAMPLE_MOVIE_DATE, DEMO_SAMPLE_QUALITY, DEMO_SAMPLE_RANK, DEMO_SAMPLE_TV_DATE, isDemoSamplesRequest, mergeDemoSampleRatings } from "@/lib/demo-samples"
import {
  STD_H,
  STD_W,
  fetchImg,
  fetchLogoImg,
  hashKey,
  imgSrc,
  isValidHex,
  topLuminance,
  bottomLuminance,
} from "@/lib/poster-render-helpers"
import { computeBottomLight } from "@/lib/accent-color"
import { normalizeGenreName } from "@/lib/genre-normalize"
import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "@/lib/gradient-defaults"
import { LAND_W, LAND_H, landscapeBackdropUrl, pillarboxLandscapeBase, cropBackdropToPortrait } from "@/lib/image-utils"
import { generatePosterBuffer, type GenerationInput, type NetworkGeometry } from "@/lib/poster-service"
import { computeTopBadge, isNextEpisodeDisplayed } from "@/lib/poster-badge"
import { getUpcomingReleaseLabel, parseDateFormat } from "@/lib/release-badge"
import { fetchPosterBaseWithCustom, customBaseAnalysisKey, resolveEffectiveCustomUrl, safeTmdbImgSrc, isAllowedQueryImagePath, fetchValidatedCustomImage } from "@/lib/custom-poster-base"
import { isCustomPosterUrl } from "@/lib/utils"

import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { getTvdbArtworks, getTvdbMovieId, getTvdbSeriesId, pickTvdbPoster } from "@/lib/tvdb"
import { validatePosterQuery } from "@/lib/validation"
import { decodeConfig } from "@/lib/config-token"
import { createLogger } from "@/lib/logger"
import { resolvePosterRenderConfig, resolvePosterShape, resolveSeparateRatingsEnabled, resolveSeparateDisplayState, resolveAgeBadgeRequest } from "@/lib/poster-config"
import { selectBestLogo, logoBestLogoFallbackReason } from "@/lib/logo-selection"
import { resolveStreamQuality, type StreamQualityResult } from "@/lib/stream-quality"
import { applyMinQuality, type StreamQuality } from "@/lib/quality-tiers"
import { lookupAVSpecs, isVideoFormat, type VideoFormat } from "@/lib/av-specs"
import { computeVote } from "@/lib/rating-weights"
import { combineAbortSignals } from "@/lib/abort-signal"
import { cachedImageBytes } from "@/lib/image-bytes-cache"
import { timedFetch, readResponseBody } from "@/lib/outbound-stats"
import { createHash } from "node:crypto"
import { fetchCustomRatings, resolveCustomRatingConfig, type RatingItem } from "@/lib/custom-rating"
import { resolveAgeCertification, sanitizeAgeLabel } from "@/lib/certification"

// Vercel: limite massimo di esecuzione della funzione. Il render poster ha un
// deadline interno di 30s (PICTORIUM_RENDER_TIMEOUT_MS) → 40s copre il caso
// peggiore. Su Hobby Vercel impone comunque 10s; su Pro vale questo valore.
export const maxDuration = 40

const log = createLogger("poster")

// Deadline complessivo del render (F2): limite sull'intera pipeline
// (fetch immagini + TMDB + composizione sharp). Oltre il tempo massimo il
// watchdog abbandona il render e libera slot + inflight map. Lettura a module
// level: un cambio env richiede restart, non hot-reload.
const RENDER_TIMEOUT_MS = (() => {
  const raw = envWithFallback("RENDER_TIMEOUT_MS")
  // Vercel Hobby: 10s di limite funzione — con 30s di deadline la piattaforma
  // chiuderebbe con 504 prima del nostro 503 degradato. Default hobby-safe
  // SOLO se l'utente non ha impostato un valore esplicito (su Pro vale 30s).
  const fallback = process.env.VERCEL && raw === undefined ? 8500 : 30000
  const n = raw ? parseInt(raw, 10) : fallback
  // Clamp superiore = maxDuration (40s): un timeout interno più lungo del
  // limite della funzione serverless non avrebbe mai tempo di scattare (finding 11).
  return Number.isFinite(n) && n >= 1000 && n <= 40000 ? n : fallback
})()

// D5: tetto TMDB nel path poster (slot-bound). Un singolo fetch TMDB appeso
// teneva 1 slot di render fino a 30s; a 8s il render degrada (fallback) o
// fallisce in fretta liberando lo slot. Cataloghi/meta/search restano a 30s.
const POSTER_TMDB_TIMEOUT_MS = 8000

// Tetto massimo per l'attesa del voto medio TMDB+IMDb (MDBList) prima del
// render: se il fetch è lento, il poster usa il voto TMDB senza bloccarsi.
// Sovrascrivibile via env (PICTORIUM_RATING_WAIT_MS); default ridotto a 1500ms
// per stringere il caso peggiore senza rinunciare all'upgrade del voto. Valore
// condiviso con la route tmdb-details (stesso knob).
const RATING_WAIT_MS = (() => {
  const raw = envWithFallback("RATING_WAIT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

// TTL effimero (s) per i render degradati da timeout/errore upstream sulla
// qualità: il poster senza badge resta in cache 2 minuti invece di 6h/24h, così
// Stremio riprova poco dopo senza avvelenare la CDN per mezza giornata.
// Solo storage+header di QUESTO render: resolved-null (esito negativo
// accertato) mantiene il TTL pieno.
const QUALITY_EPHEMERAL_TTL_SEC = 120

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

/**
 * Coalesced pre-cache source fetch: concurrent poster requests for the same
 * chart/list share one upstream call instead of one per title. Inflight-only
 * (deleted on settle), no TTL cache added. Cleanup attaches dual handlers so
 * neither the stored promise nor the derived cleanup promise rejects unhandled.
 */
const rankSourceInflight = new Map<string, Promise<unknown>>()

function sharedSourceFetch<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = rankSourceInflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = start()
  rankSourceInflight.set(key, p as Promise<unknown>)
  void p.then(
    () => { if (rankSourceInflight.get(key) === p) rankSourceInflight.delete(key) },
    () => { if (rankSourceInflight.get(key) === p) rankSourceInflight.delete(key) },
  )
  return p
}

/**
 * Per-caller bounded wait on a shared source promise. Settles with the shared
 * outcome when it wins, otherwise rejects after ms (or on external abort)
 * without aborting the shared fetch other callers wait on. Timer and listener
 * are always cleaned up on either path.
 */
function awaitWithOwnBudget<T>(promise: Promise<T>, ms: number, external?: AbortSignal | null): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cleanup = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    if (onAbort !== undefined && external) { external.removeEventListener("abort", onAbort); onAbort = undefined }
  }
  const bounded = new Promise<T>((_, reject) => {
    timer = setTimeout(() => { cleanup(); reject(new DOMException("Aborted", "AbortError")) }, Math.max(1, ms))
    if (external) {
      if (external.aborted) { cleanup(); reject(new DOMException("Aborted", "AbortError")) }
      else {
        onAbort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")) }
        external.addEventListener("abort", onAbort, { once: true })
      }
    }
  })
  return Promise.race([promise, bounded]).then(
    (v) => { cleanup(); return v },
    (e) => { cleanup(); throw e },
  )
}

type RouteParams = { type: string; id: string }

/**
 * Reverse lookup: mapping salvato con questo imdbId (scritto a mano quando
 * TMDB non lo fornisce). Ritorna il mapping (il chiamante usa tmdbId +
 * mediaType dichiarati). Mai throw: il chiamante ha già il .catch.
 */
async function findMappingByImdb(imdbId: string, userId?: string | null) {
  const all = await getAll(userId)
  return all.find((m) => m.imdbId?.trim() === imdbId) ?? null
}

function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }
}

// Risposta di errore coerente per 500/503 con Retry-After esplicito sul 503
// (F5/F8): la CDN/Stremio fa backoff invece di rimbalzare subito sull'endpoint.
// Il body è generico: il 503 copre sia slot esauriti sia deadline/upstream
// lento (fix H3), non solo il busy da render concorrenti.
function posterErrorResponse(status: PosterErrorStatus): Response {
  if (status === 503) {
    return new Response("Poster temporarily unavailable", {
      status: 503,
      headers: { ...corsHeaders(), "Retry-After": String(Math.max(1, Math.round(RENDER_SLOT_WAIT_MS / 1000))) },
    })
  }
  if (status === 404) {
    return new Response("Poster not found", { status: 404, headers: corsHeaders() })
  }
  return new Response("Poster generation failed", { status: 500, headers: corsHeaders() })
}

/**
 * Sessione preview sbloccata: cookie PIN/admin o admin token. Sync e senza
 * I/O oltre la config cachata — sicuro sull'hot path. Mai throw.
 */
function hasUnlockedPreviewSession(req: NextRequest): boolean {
  try {
    return verifySessionFromRequestSync(req) || checkAdminToken(req)
  } catch {
    return false
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const startTime = Date.now()
  initSharp()
  const { type, id } = await params
  const mediaTypeInit = (["series", "tv", "show", "tvshow"].includes(type?.toLowerCase() || "")) ? "tv" : "movie"
  // `let`: l'alias IMDb manuale può correggere anche il tipo (AIO che manda
  // /movie/tt... per una serie) — l'utente dichiara "questo tt È quello show".
  let mediaType: "movie" | "tv" = mediaTypeInit

  // Namespace utente (multi-user): null con flag OFF o senza `?u=` → globale.
  const rawUser = req.nextUrl.searchParams.get("u") ?? req.nextUrl.searchParams.get("user")
  let scopedUser = getScopedUserId(rawUser)
  // Rate-limit per-utente (multi-user): il bucket segue il namespace
  // (IP+UUID) così il flood su `?u=vittima` brucia solo il sotto-bucket
  // dell'attaccante e non la quota legittima del proprietario.
  const rl = await rateLimit(scopedUser ? userRateLimitKey(req, scopedUser) : rateLimitKey(req), "poster")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Spazi inventati → anonimo (v1.23.0): niente cache key separate né
  // hardening bypassato. DOPO il rate-limit: il flood su UUID altrui resta
  // confinato al sotto-bucket dell'attaccante.
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  // Preview blindata opt-in (v1.23.0): con PICTORIUM_PREVIEW_AUTH=1 le
  // preview anonime sulle pubbliche vengono hardenate e cachate come
  // normali (niente bypass bot). Restano live: spazi esistenti (editor del
  // proprietario) e sessioni sbloccate (cookie PIN/admin). Default OFF.
  const rawPreview = req.nextUrl.searchParams.has("preview")
  let isPreview = rawPreview
  if (
    rawPreview &&
    isPreviewDowngraded({
      presets: isPresetsPosterMode(),
      publicInstance: isPublicPosterInstance(),
      previewAuth: isPreviewAuthRequired(),
      hasScopedUser: !!scopedUser,
      unlocked: hasUnlockedPreviewSession(req),
    })
  ) {
    isPreview = false
  }
  // Chiavi effettive (slice 2, una sola lettura namespace): esplicite della
  // richiesta > namespace utente > env d'istanza. Con `scopedUser` null sono
  // identiche a oggi (byte-identico).
  const effKeys = await resolveUserApiKeys(req, scopedUser)
  const effTmdbKey = effKeys.tmdb?.key
  const effMdblistKey = effKeys.mdblist?.key
  const effTvdbKey = effKeys.tvdb?.key
  const effSimklKey = effKeys.simkl?.key

  // Decode optional stateless config token (stile AIOMetadata / RPDB)
  const configToken = req.nextUrl.searchParams.get("config") || req.nextUrl.searchParams.get("c")
  const configOverride = configToken ? decodeConfig(configToken) : null

  // IMDb ID dal path (es. /api/poster/movie/tt1375666): preservato subito così
  // il provider custom rating (e il ramo mapping) lo usano senza dipendere
  // da getExternalIds — che richiede una chiave TMDB assente negli URL Stremio.
  const pathImdbId = typeof id === "string" && /^tt\d+$/.test(id) ? id : null
  // Id tipizzato `tmdb:<num>` (es. sostituzione Nuvio del template auto
  // `{tmdb_id|imdb_id}`): path numerico esatto, niente /find — come il nudo.
  // Altri prefissi restano 400 (non risolvibili senza lookup dedicati).
  const pathTmdbPrefixed = typeof id === "string" ? id.match(/^tmdb:(\d+)$/i)?.[1] ?? null : null
  let tmdbId = pathTmdbPrefixed ? Number(pathTmdbPrefixed) : Number(id)
  if (isNaN(tmdbId) || tmdbId <= 0) {
    if (typeof id === "string" && id.startsWith("tt")) {
      // Alias manuale per-namespace vince sul /find TMDB (tt di franchise su
      // entry di stagione splittata, es. Monster tt13207736 → tv:299939).
      // Controllato PRIMA di resolveImdbToTmdb così bypassa anche la sua
      // cache 7gg. Fail-open: errore store → fallback al /find invariato.
      // Il globale fa da default operatore (una cura per tutti gli spazi).
      const ownAlias = pathImdbId ? await getImdbAlias(pathImdbId, scopedUser).catch(() => null) : null
      const alias = ownAlias
        ?? (pathImdbId && scopedUser ? await getImdbAlias(pathImdbId).catch(() => null) : null)
      if (alias) {
        tmdbId = alias.tmdbId
        mediaType = alias.mediaType
        log.info("IMDb alias hit", { imdb: pathImdbId, mediaType, tmdbId })
      } else {
        // Reverse lookup sull'imdbId salvato nei mapping (scritto a mano
        // quando TMDB non lo fornisce): proprio, poi globale. La risoluzione
        // è conoscenza globale, il rendering resta per-namespace (il mapping
        // letto dopo è sempre quello dello spazio richiedente).
        const ownHit = pathImdbId && scopedUser
          ? await findMappingByImdb(pathImdbId, scopedUser).catch(() => null)
          : null
        const anyHit = ownHit
          ?? (pathImdbId ? await findMappingByImdb(pathImdbId).catch(() => null) : null)
        if (anyHit) {
          tmdbId = anyHit.tmdbId
          mediaType = anyHit.mediaType
          log.info("IMDb mapping hit", { imdb: pathImdbId, mediaType, tmdbId })
        } else {
          const resolved = await resolveImdbToTmdb(id, mediaType, effTmdbKey)
          if (resolved) tmdbId = resolved
        }
      }
    }
  }

  if (isNaN(tmdbId) || tmdbId <= 0) {
    return new Response("Invalid ID", { status: 400, headers: corsHeaders() })
  }

  // R1: bound anti-DoS/cache-flood sui query param — PRIMA di cache key,
  // slot e inflight: input oltre i bound → 400 immediato, mai render/cache.
  // (I path immagine vengono validati anche contro l'allowlist in R2.)
  const invalidQuery = validatePosterQuery(req.nextUrl.searchParams)
  if (invalidQuery) {
    return new Response(invalidQuery, { status: 400, headers: corsHeaders() })
  }

  // R2: i path immagine passano per l'allowlist SSRF di imgSrc() (stessa
  // funzione usata dal render — nessuna deriva). Prima un URL esterno
  // falliva dentro il try del render → 500 + negative-cache per un errore
  // del client, intasando log e slot. Ora 400 immediato.
  // Exception: `poster`, `logo` e `backdrop` accettano anche http(s) URL su
  // host allowlisted (custom base portrait/landscape da tile esterni + custom
  // logo: isAllowedQueryImagePath, stessa resolve policy — raster-only, no
  // SVG). SSRF pieno (DNS/IP/redirect) resta al fetch dentro
  // fetchPosterBaseWithCustom / fetchValidatedCustomImage.
  for (const imgKey of ["poster", "logo", "backdrop"] as const) {
    const imgPath = req.nextUrl.searchParams.get(imgKey)
    if (imgPath) {
      try {
        if (!isAllowedQueryImagePath(imgPath)) {
          throw new Error(`Blocked query image URL`)
        }
      } catch {
        return new Response(`Invalid query parameter: ${imgKey}`, { status: 400, headers: corsHeaders() })
      }
    }
  }

  // Attività di lettura per il cleanup inattivi (throttled, fire-and-forget):
  // DOPO la validazione (ID + R1/R2) così le request 400 non creano dir/file.
  if (scopedUser) touchUserActivity(scopedUser)

  // 1. Get mapping + server defaults (no network)
  // (`scopedUser` già risolto sopra: serve anche al ramo tt e alle chiavi.)
  let mapping = await getById(mediaType, tmdbId, scopedUser)
  // Lettura revisionata via epoch: dopo un save su un'altra istanza, l'epoch
  // avanzata invalida i default in memoria (finestra residua = 500ms di
  // cache lettura epoch, mai i 5min del TTL defaults).
  const sd = scopedUser ? await getServerDefaultsForUser(scopedUser) : await getServerDefaultsChecked()
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const configRegion = parseRegion(configOverride?.region)
  const langParam = req.nextUrl.searchParams.get("lang") || mapping?.language
  const langRegion = langParam ? (parseRegion(langParam) ?? defaultRegionForLang(langParam)) : null
  const posterRegion = getRegionDef(qRegion ?? configRegion ?? langRegion ?? normalizeRegion(sd.region))

  // Formato canvas PRIMA della rotazione: in landscape ruota il backdrop
  // (cleanBackdrops), in portrait il poster (cleanPosters). Stessa catena
  // query > mapping > config > defaults usata dal render.
  const earlyLandscape = resolvePosterShape(req.nextUrl.searchParams, mapping, configOverride, sd) === "landscape"
  // Effective defaults for the requested shape: the pre-render flags below
  // (customRatings, separate, badgeQuality, preRelease, formats) follow the
  // landscape profile like the render does, not the flats.
  const earlyEffSd = effectiveDefaultsForShape(sd, earlyLandscape ? "landscape" : "poster")

  // Auto-rotate 24h: sfondi landscape o poster verticali a seconda del formato.
  let isRotating = false
  if (mapping) {
    try {
      if (earlyLandscape) {
        const backdropState = getEffectiveBackdropRotationState(mapping)
        isRotating = backdropState.isRotating
        const rotated = await tryRotateBackdrop(mapping, backdropState, scopedUser)
        if (rotated) mapping = rotated
      } else {
        const posterState = getEffectiveRotationState(mapping)
        isRotating = posterState.isRotating
        const rotated = await tryRotatePoster(mapping, posterState, scopedUser)
        if (rotated) mapping = rotated
      }
    } catch (error) {
      log.warn("Auto-rotate failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

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
  const sdHash = hashKey(JSON.stringify(sd) + customRatingHash)
  // Hardening anti cache-busting (v1.23.0): con presets attivi le richieste
  // non-preview collassano su un set finito di render (quantize numerici +
  // palette ac + extra canonico dal mapping + strip override keyless su
  // pubbliche anonime). Preview WYSIWYG e istanze private passano intatte.
  // `hardenedParams` alimenta chiave di cache E render così non divergono;
  // il resto legge la query originale (parametri funzionali intatti).
  const hardenedParams = hardenPosterSearchParams(req.nextUrl.searchParams, {
    presets: isPresetsPosterMode(),
    preview: isPreview,
    anonymous: !scopedUser,
    publicInstance: isPublicPosterInstance(),
    hasMapping: !!mapping,
    mappingCustomBadge: earlyEffMapping?.customBadge ?? null,
  })
  // Preview declassata (blindatura opt-in): senza il flag la chiave resterebbe
  // separata dalle anonime — rimuovendolo condivide la entry canonica.
  if (rawPreview && !isPreview) hardenedParams.delete("preview")
  // Demo samples (Settings defaults preview only): accepted solely on an
  // effective preview with the explicit flag. A downgraded preview drops it
  // so the entry collapses to the canonical key (same render, no split).
  const demoSamples = isDemoSamplesRequest({ isPreview, flag: hardenedParams.get(DEMOSAMPLES_FLAG) })
  if (!isPreview) hardenedParams.delete(DEMOSAMPLES_FLAG)
  // Effective-accent display sync (`?accentmeta=1`, server-only Stage 1): a
  // read-only JSON branch served below from the SAME canonical key. The flag
  // is the ONLY param stripped here (mirror of the L479 preview-delete
  // pattern): preview/tl/bl/config and every render input stay in the key, so
  // the metadata key is byte-identical to the image key — including the
  // preview-downgrade path above, which applies equally to both.
  const wantAccentMeta = req.nextUrl.searchParams.get("accentmeta") === "1"
  hardenedParams.delete("accentmeta")
  const cacheParams = normalizePosterCacheParams(hardenedParams)
  cacheParams.delete("config")
  cacheParams.delete("c")
  if (scopedUser) {
    // Il namespace entra come hash a 64-bit (mai in chiaro): senza, B
    // servirebbe il render cachato di A. Con flag OFF resta il delete storico.
    cacheParams.set("u", hashUserFragment(scopedUser))
    cacheParams.delete("user")
  } else {
    cacheParams.delete("u")
    cacheParams.delete("user")
  }
  // Removed Badge Lab: the custom badge library is retired. Legacy query
  // values (`badgePreset`/`prv`/`pt`/`bp`/`bpf`/`bpt`) and persisted mapping
  // fields (`badgePresetId`/`badgePresetRev`/`badgePresets`/`badgePresetFollows`)
  // are inert: no store reads, no substitution, no cache-key fragments — old
  // URLs and saved bindings collapse onto the native render. Persisted fields
  // stay stored untouched (never deleted); they simply no longer affect keys
  // or pixels.
  cacheParams.delete("badgePreset")
  cacheParams.delete("prv")
  cacheParams.delete("pt")
  cacheParams.delete("bp")
  cacheParams.delete("bpf")
  cacheParams.delete("bpt")
  // api_key non influisce sul rendering: rimuoverla evita frammentazione della
  // cache per utente e segreti in memoria nelle chiavi.
  cacheParams.delete("api_key")
  // B1-bis come tvdb_key: la chiave MDBList è un segreto e non entra mai in
  // chiaro nella cache key (prima frammentava la cache per chiave e restava
  // in memoria in chiaro). Il flag `mdb=1` separa le entry con rating
  // aggregati attivi da quelle senza — l'output a parità di dati non dipende
  // dalla chiave (solo accesso upstream), quindi niente frammentazione.
  cacheParams.delete("mdblist_key")
  if (effMdblistKey) cacheParams.set("mdb", "1")
  cacheParams.delete("simkl_key")
  if (effSimklKey) cacheParams.set("simkl", "1")
  // B1: la chiave TVDB non entra mai in chiaro nella cache key (segreto in
  // memoria); il flag `tvdb=1` separa le entry con rescue attivo da quelle
  // senza (output diverso a parità di altri parametri).
  cacheParams.delete("tvdb_key")
  // Il flag è server-side: un `tvdb=` in query viene ignorato (solo la
  // presenza della chiave abilita il rescue).
  cacheParams.delete("tvdb")
  // Chiave TVDB per il rescue poster (B1): query `tvdb_key` > namespace >
  // fallback d'istanza (stessa precedenza della route meta). Senza chiave il
  // rescue è spento e il comportamento resta quello storico.
  const tvdbApiKey = effTvdbKey
  if (tvdbApiKey) cacheParams.set("tvdb", "1")
  if (typeof cacheParams.sort === "function") cacheParams.sort()
  // Pre-cache rank snapshot so the cache key carries the live trend/anime rank.
  // The same snapshot is reused by the render below: no second fetch.
  // Enabled-flag mirrors the later queryPoster/mapping branches exactly:
  // explicit query wins, query-poster branch ignores the mapping, otherwise
  // the mapping decides, unmapped defaults to true.
  const qRankingPre = req.nextUrl.searchParams.get("ranking")
  const rankingEnabledPre = qRankingPre !== null
    ? qRankingPre !== "0"
    : (!!hardenedParams.get("poster") ? true : (earlyEffMapping?.rankingBadges ?? true))
  // Same parsers as the render: qRank overrides trend only (anime stays
  // independent), and only a valid non-negative int skips the trend fetch.
  const qRankPre = hardenedParams.get("rank")
  const qRankParsedPre = qRankPre !== null ? parseInt(qRankPre, 10) : NaN
  const hasValidQRankOverride = qRankPre !== null && qRankParsedPre >= 0
  const qAnimeRankParamPre = hardenedParams.get("animerank")
  const qAnimeRankPre = qAnimeRankParamPre ? Number(qAnimeRankParamPre) : NaN
  const rankingSelectionPre = {
    customCatalogs: configOverride?.customCatalogs ?? sd.customCatalogs,
    rankingSourceMovie: configOverride?.rankingSourceMovie ?? sd.rankingSourceMovie,
    rankingSourceSeries: configOverride?.rankingSourceSeries ?? sd.rankingSourceSeries,
  }
  const rankingSourcePre = resolveRankingSource(
    rankingSelectionPre,
    mediaType === "movie" ? "movie" : "series",
  )
  const rankingCustomPre = rankingSourcePre.kind === "custom"
    ? findRankingCustomCatalog(rankingSelectionPre.customCatalogs, rankingSourcePre.customId)
    : undefined
  // Fail-closed per new JW mode: an upstream popular/trending error resolves
  // null (no stored-rank fallback from another source). The legacy charts
  // path keeps its historical degraded fallback to the saved rank (pinned by
  // poster-route-mapping.test.ts); the custom branch above is already
  // fail-closed (.catch(() => null)).
  const isNewJwModePre = rankingSourcePre.kind === "justwatch"
    && (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
  // Bounded preflight using existing caps only. Shared source calls run on a
  // common timeout signal (never req.signal: a disconnecting first client must
  // not abort the fetch others are coalesced on).
  const preflightStart = Date.now()
  const preflightBudgetMs = Math.max(1, Math.min(POSTER_TMDB_TIMEOUT_MS, RENDER_TIMEOUT_MS - (preflightStart - startTime)))
  const preflightSourceSignal = AbortSignal.timeout(preflightBudgetMs)
  const needTrendFetch = rankingEnabledPre && !hasValidQRankOverride
  const needAnimeFetch = rankingEnabledPre && !(Number.isFinite(qAnimeRankPre) && qAnimeRankPre > 0)
  const animeListKey = mediaType === "movie" ? "mdblistAnimeMovie" : "mdblistAnime"
  const animeKeyUsed = effMdblistKey || envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_KEY || process.env.MDBLIST_API_KEY || undefined
  // Per-family snapshots (render-budget path): canonical rank inputs come from
  // the SAME published snapshots the catalog and rank routes read — one pin
  // per family per request (mid-request consistency). One request refreshes
  // THAT stale family only (awaited, bounded); unrelated families are never
  // touched. Custom branch excluded (no chart I/O). Coalescing keys isolate
  // the exact group + pinned snapshot version: concurrent different
  // groups/generations never share in-flight reads.
  const jwSlot = mediaType === "movie" ? "movie" : "series"
  const jwFamily = rankingSourcePre.kind === "justwatch" && (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
    ? `jw:${jwSlot}:${rankingSourcePre.mode}`
    : `jw:${jwSlot}:charts`
  // GLOBAL popular/trending: unsupported (fail-closed, zero chart I/O — come
  // la rank route); nessun fetch, nessun gate, nessun fallback inventato.
  const jwGlobalUnsupported = rankingSourcePre.kind === "justwatch" &&
    (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending") &&
    posterRegion.code === GLOBAL_REGION_CODE
  // Conditional pins: pinChartFamily revalidates durable storage, so only
  // pin families this request actually needs. ranking=0 (or an explicit rank
  // override) skips the JW pin; custom sources skip JW chart I/O entirely;
  // anime pins only when the anime rank still needs resolving (a custom JW
  // selection keeps anime behavior: the anime family is independent).
  // Skipped pins fall back to the live fragment in the coalescing key (the
  // corresponding preflight resolves immediately, so the key is unused).
  const needJwPin = needTrendFetch && !jwGlobalUnsupported && rankingSourcePre.kind === "justwatch"
  const needAnimePin = needAnimeFetch
  const jwGroupInput = { regionCode: posterRegion.code, regionLang: posterRegion.lang }
  const jwPrePin = needJwPin ? await pinChartFamily({ ...jwGroupInput, family: jwFamily }) : null
  const jwSourceKey = `jw:${mediaType === "movie" ? "MOVIE" : "SHOW"}:${posterRegion.code}:20:${posterRegion.lang}${rankingSourcePre.kind === "justwatch" && rankingSourcePre.mode !== "charts" ? `:${rankingSourcePre.mode}` : ""}:g${chartListGroupKey(jwGroupInput)}${jwPrePin ? chartPinCacheFragment(jwPrePin) : ":cglive"}`
  const chartAnimeFamily = mediaType === "movie" ? "anime:movie" : "anime:series"
  const animeGroupInput = { regionCode: posterRegion.code, regionLang: posterRegion.lang, mdblistKey: animeKeyUsed }
  const animePrePin = needAnimePin ? await pinChartFamily({ ...animeGroupInput, family: chartAnimeFamily }) : null
  const animeSourceKey = `anime:${mediaType}:${posterRegion.code}:${posterRegion.lang}:${hashKey(animeKeyUsed ?? "")}${animePrePin ? chartPinCacheFragment(animePrePin) : ":cglive"}`
  const customSourceKey = `custom:${mediaType}:${scopedUser ?? "anon"}:${hashKey(JSON.stringify(rankingCustomPre ?? null))}:${hashKey([(effTmdbKey ?? ""), (effMdblistKey ?? ""), (effTvdbKey ?? "")].join("|"))}`
  // Task D: provenance dei fatti baked-in. `true` quando il rank è servito da
  // uno snapshot pubblicato (fatto volatile con scadenza nota = fine slot),
  // non cake fallback al rank salvato (stabile, nessun cap) né abort/budget.
  let trendRankLive = false
  let animeRankLive = false
  // Rank effettivamente consumato dallo snapshot (per il freshness cap sotto).
  let trendSnapshotPin: ChartFamilyPin | null = null
  let animeSnapshotPin: ChartFamilyPin | null = null
  const trendPreflight: Promise<number | null> = !needTrendFetch || jwGlobalUnsupported
    ? Promise.resolve(null)
    : (rankingSourcePre.kind === "custom" && rankingCustomPre
      ? awaitWithOwnBudget(sharedSourceFetch(customSourceKey, () => fetchCustomRankingTop20({
        custom: rankingCustomPre,
        slot: mediaType === "movie" ? "movie" : "series",
        apiKey: effTmdbKey,
        mdblistKey: effMdblistKey,
        tvdbKey: effTvdbKey,
        userId: scopedUser,
        signal: preflightSourceSignal,
      }))
        .then((r) => {
          trendRankLive = true
          if (r.status !== "ok") return null
          const idx = r.items.findIndex((x) => x.tmdbId === tmdbId)
          return idx >= 0 ? idx + 1 : null
        }), preflightBudgetMs, req.signal)
        .catch(() => { trendRankLive = false; return null })
      : awaitWithOwnBudget(sharedSourceFetch(jwSourceKey, () => ensureFreshChartFamily({
        regionCode: posterRegion.code,
        regionLang: posterRegion.lang,
        tmdbLang: posterRegion.lang,
        signal: preflightSourceSignal,
        family: jwFamily,
      }).then((pin) => {
        trendSnapshotPin = pin
        trendRankLive = pin.snapshot != null
        // Cold failure (no snapshot): legacy charts contract degrades to the
        // saved rank; a genuine miss in a published snapshot stays null
        // (never resurrect a stale saved rank for an unranked title).
        if (!pin.snapshot) return isNewJwModePre ? null : (mapping?.badgeRank ?? mapping?.trendRank ?? null)
        return pin.snapshot.rows.find((x) => x.tmdbId === tmdbId)?.rank ?? null
      })), preflightBudgetMs, req.signal)
        .catch(() => { trendRankLive = false; trendSnapshotPin = null; return isNewJwModePre ? null : (mapping?.badgeRank ?? mapping?.trendRank ?? null) }))
  const animePreflight: Promise<number | null> = !needAnimeFetch
    ? Promise.resolve(rankingEnabledPre ? qAnimeRankPre : null)
    : awaitWithOwnBudget(sharedSourceFetch(animeSourceKey, () => ensureFreshChartFamily({
      regionCode: posterRegion.code,
      regionLang: posterRegion.lang,
      tmdbLang: posterRegion.lang,
      mdblistKey: animeKeyUsed,
      signal: preflightSourceSignal,
      family: chartAnimeFamily,
    }).then((pin) => {
      animeSnapshotPin = pin
      animeRankLive = pin.snapshot != null
      // Cold failure (no snapshot): fall back to the saved anime rank; a
      // genuine miss in a published snapshot stays null.
      if (!pin.snapshot) return mapping?.animeRank ?? null
      const idx = pin.snapshot.rows.findIndex((r) => r.tmdbId === tmdbId)
      return idx >= 0 ? idx + 1 : null
    })), preflightBudgetMs, req.signal)
      .catch(() => { animeRankLive = false; animeSnapshotPin = null; return mapping?.animeRank ?? null })
  const [preTrendRank, preAnimeRank] = await Promise.all([trendPreflight, animePreflight])
  // Preflight time is subtracted from the watchdog below: preflight does not
  // extend the existing render budget.
  const preflightMs = Date.now() - preflightStart
  const cachedRank = mapping?.trendRank ?? null
  const rotateKey = isRotating
    ? (earlyLandscape ? `:bi${mapping?.cleanBackdropIndex ?? "x"}` : `:ci${mapping?.cleanPosterIndex ?? "x"}`)
    : ""
  // Rotazione giornaliera dei dinamici (titoli non salvati, solo clean, cut
  // 02:00 UTC): senza mapping e senza `poster=` esplicito, il bucket giorno
  // entra nella chiave così il cambio giorno invalida la cache su tutte le
  // istanze senza write. Portrait → `autoRotateClean`, landscape → default
  // `defaultAutoRotateBackdrop` (stessi toggle dei nuovi mapping).
  const dynamicDayBucket = getDynamicRotationBucket({
    hasMapping: !!mapping,
    hasQueryPoster: hardenedParams.has("poster"),
    isLandscape: earlyLandscape,
    portraitEnabled: sd.autoRotateClean ?? false,
    backdropEnabled: sd.defaultAutoRotateBackdrop ?? false,
    nowMs: startTime,
  })
  const dynamicBucketKey = dynamicDayBucket !== null ? `:dd${dynamicDayBucket}` : ""
  // TTL allineato al prossimo cut (header + storage esplicito sotto): oltre
  // il cut la chiave cambia comunque, mai contenuto stantio oltre il giorno.
  const dynamicCutTtlSec = dynamicDayBucket !== null
    ? secondsUntilDynamicRotationCut(startTime)
    : null
  const dynamicCutTtlMs = dynamicCutTtlSec !== null ? dynamicCutTtlSec * 1000 : null
  const mapVersion = mapping?.updatedAt ? `:mu${mapping.updatedAt}` : ""
  const configHash = configOverride ? hashKey(JSON.stringify(configOverride)) : ""
  const outputFormat = resolveImageFormat(req.headers.get("accept"), req.nextUrl.searchParams.get("fmt") || req.nextUrl.searchParams.get("format"))
  // C3: un solo render canonico per chiave (jpeg storico, webp con
  // PICTORIUM_IMAGE_FORMAT=webp); gli altri formati sono varianti di risposta
  // convertite on-the-fly. Solo ?fmt=avif esplicito mantiene chiave+render
  // dedicati. Il marcatore di formato in chiave evita poison al flip env
  // (stessa chiave + formato diverso = buffer col Content-Type sbagliato).
  const legacyAvif = outputFormat === "avif"
  const canonicalFormat = legacyAvif ? "avif" : DEFAULT_IMAGE_FORMAT
  const formatKey = legacyAvif ? ":fmtavif" : canonicalFormat === "webp" ? ":fmtwebp" : ""
  const cacheKey = `poster:v${RENDER_VERSION}:${mediaType}:${tmdbId}:reg${posterRegion.code}:r${cachedRank ?? "x"}:lr${preTrendRank ?? "x"}:la${preAnimeRank ?? "x"}:sd${sdHash}:${cacheParams.toString()}${rotateKey}${mapVersion}${dynamicBucketKey}${configHash ? `:cfg${configHash}` : ""}${formatKey}`
  const needsVariant = !legacyAvif && outputFormat !== canonicalFormat
  const variantKey = needsVariant ? `${cacheKey}:fmt${outputFormat}` : cacheKey
  const etagBase = hashKey(`v${RENDER_VERSION}:${mediaType}:${tmdbId}:reg${posterRegion.code}:r${cachedRank ?? "x"}:lr${preTrendRank ?? "x"}:la${preAnimeRank ?? "x"}:sd${sdHash}:${cacheParams.toString()}${configHash ? `:${configHash}` : ""}`)
  const currentMappingVersion = mappingVersionParam(mapping)
  // Rating dinamici: con provider abilitato niente cache immutable annuale
  // (i rating cambiano) — vale anche il display-aware locale: solo la riga
  // davvero renderizzata rinuncia all'immutable.
  const immutablePoster = !customRatingConfig.enabled && !sepDisplay && isImmutablePosterRequest(req.nextUrl.searchParams, {
    hasMapping: !!mapping,
    isRotating,
    mappingVersionMatches: !!currentMappingVersion && req.nextUrl.searchParams.get("mv") === currentMappingVersion,
  })
  const refreshRequest = isPosterRefreshRequest(req.nextUrl.searchParams)
  // Percorso "Segui il mio spazio": politica di rivalidazione (non forza il
  // render). Stessi header su 200 e 304, mai immutable (vedi isImmutable...).
  const isLive = isLivePosterRequest(req.nextUrl.searchParams)
  // Geometria network (`netgeo=1`, solo con `debug=1`): deve sempre
  // renderizzare fresco — mai poster bytes/304/stale dalla cache al posto
  // del JSON diagnostico. Non scrive comunque in cache (return prima).
  const wantNetGeo = req.nextUrl.searchParams.get("netgeo") === "1"
  // isPreview effettivo calcolato a inizio richiesta (può essere declassato
  // dalla blindatura opt-in PICTORIUM_PREVIEW_AUTH) — non rileggere la query.
  // Poster non-mappato (composto al volo con dati dinamici): TTL ridotto (6h)
  // invece delle 24h del path mappato, così rank/IMDb Top 250 non restano
  // stantii per un giorno intero. Il flag non cambia per tutta la richiesta.
  const dynamicPoster = !mapping
  // Tag con UUID solo come hash (userTagFragment, stessa forma della cache
  // key): mai l'UUID in chiaro nei tag di cache.
  const mappingTag = mapping ? `poster:${mediaType}:${tmdbId}${scopedUser ? `:${userTagFragment(scopedUser)}` : ""}` : undefined
  // TTL reale della entry canonica (jitter deterministico ±10%): threadato
  // negli header così restano sincronizzati con lo storage (M3). La variante
  // ha storage key propria → TTL proprio (vedi serveResponseVariant).
  const dynamicTtlSec = dynamicPoster ? (dynamicCutTtlSec ?? dynamicPosterTtlSec(cacheKey)) : undefined
  // La variante è un'entry separata (storage key propria) con TTL proprio.
  const variantTtlSec = dynamicPoster && needsVariant ? (dynamicCutTtlSec ?? dynamicPosterTtlSec(variantKey)) : undefined

  // Validatore della richiesta condizionale: null in preview (sempre 200) e
  // quando assente. I confronti usano SEMPRE l'ETag della rappresentazione
  // richiesta (canonico o variante), mai incrociati (audit, problema 1).
  const ifNoneMatch = isPreview ? null : req.headers.get("If-None-Match")
  const isConditional = ifNoneMatch !== null

  // Effective-accent metadata branch (`?accentmeta=1`, read-only, no-store).
  // DIAGNOSTIC ONLY: the editor picker does NOT use this branch — it reads
  // the `X-Pictorium-Accent` response header of the image itself (same XHR,
  // same bytes, zero extra requests; see `posterHeaders` + `usePosterPreview`).
  // Same authorized key as the image above (auth/namespace/mapping/shape/
  // ranking-preflight all ran on the identical lines): fresh sidecar HIT →
  // 200; stale sidecar ignored → overlapping inflight → bounded coalesced wait → 200 on settle (one
  // render, two readers); late preview (inflight already deleted, no
  // persisted entry) → 200 from the short-lived completed record; otherwise
  // 202 honest unknown. NEVER renders, NEVER acquires a slot, NEVER writes
  // negative cache. Format variants read the canonical entry (meta is
  // format-independent fills, never a conversion); the JSON validator is
  // derived from the meta body, never the PNG ETag.
  if (wantAccentMeta) {
    const serveAccentMeta = (meta: EffectiveAccentMeta | null): Response => {
      const clean = sanitizeEffectiveAccentMeta(meta ?? null)
      const body = clean
        ? { status: "ready", ...clean }
        : {
            status: "unknown",
            genreHex: null,
            rankHex: null,
            genrePaints: false,
            topPaints: false,
            topType: null,
            provGenre: "unknown",
            provRank: "unknown",
            gradientHex: null,
            gradientPaints: false,
            provGradient: "unknown",
          }
      const json = JSON.stringify(body)
      const jsonEtag = `"${hashKey(json)}"`
      const headers: Record<string, string> = {
        ...corsHeaders(),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ETag: jsonEtag,
      }
      if (ifNoneMatch === jsonEtag) {
        return new Response(null, { status: 304, headers })
      }
      return new Response(json, { status: clean ? 200 : 202, headers })
    }
    const metaHit = readCachedPoster(cacheKey)
    // Fresh sidecar only: a stale entry may describe bytes a newer image
    // render already replaced — fall through to the inflight / completed /
    // 202 chain (read-only, never renders) instead of serving outdated hex.
    if (metaHit.payload?.accentMeta && !metaHit.stale) {
      return serveAccentMeta(metaHit.payload.accentMeta)
    }
    const metaPending = getPendingPoster(cacheKey)
    if (metaPending) {
      let coalesceTimer: ReturnType<typeof setTimeout> | undefined
      const coalesceTimeout = new Promise<null>((resolve) => {
        coalesceTimer = setTimeout(() => resolve(null), RENDER_SLOT_WAIT_MS)
      })
      const settled = await Promise.race([metaPending, coalesceTimeout])
      if (coalesceTimer) clearTimeout(coalesceTimer)
      // Write-then-complete ordering (success path below) guarantees the
      // completed record exists before waiters resolve — check it too so a
      // settled payload without meta still finds the late record.
      const settledMeta = settled?.accentMeta ?? readCompletedAccent(cacheKey)
      if (settledMeta) return serveAccentMeta(settledMeta)
      return serveAccentMeta(null)
    }
    const lateMeta = readCompletedAccent(cacheKey)
    if (lateMeta) return serveAccentMeta(lateMeta)
    return serveAccentMeta(null)
  }

  // C3: risposta non-canonica da payload canonico (cache variante o conversione).
  // opts (ttlMs/immutable) dal fresh render effimero; sulle HIT riuso record.
  // Il chiamante garantisce un canonico fresco o appena renderizzato: una
  // variante scaduta non viene MAI servita da qui (si riconverte e si
  // sovrascrive); solo una variante fresca evita la conversione.
  // Latency: measured to the terminal response, conversion encode included.
  // "cached" when the caller serves from cache (fresh/stale canonical hits);
  // "render" when the caller just rendered (fresh render, revalidation render
  // — recorded here at terminal success so a failed conversion never counts
  // as a served render); "skip" when the caller records for itself or the
  // sample is excluded by contract (coalesced waiter: it awaited another
  // request's render, never its own).
  const serveResponseVariant = async (canonical: PosterCachePayload, opts?: { ttlMs?: number; immutable?: boolean; factCapped?: boolean; expiresAt?: number }, latencyOrigin: "cached" | "render" | "skip" = "skip"): Promise<Response> => {
    const noteTerminalServe = (): void => {
      if (latencyOrigin === "cached") recordPosterLatency("cached", Date.now() - startTime)
      else if (latencyOrigin === "render") recordPosterLatency("render", Date.now() - startTime)
    }
    // Task D: carry the canonical absolute deadline — no variant may extend
    // the canonical fact expiry. Canonical payload/read carries expiresAt +
    // factCapped (HIT sidecar or fresh render); opts from a fresh render win
    // when present. Variant TTL = min(canonical remaining, variant policy).
    const nowVariantHit = Date.now()
    const canonicalExpiresAt = opts?.expiresAt ?? canonical.expiresAt
    const canonicalFactCapped = opts?.factCapped ?? canonical.factCapped ?? false
    const canonicalRemainingMs =
      canonicalExpiresAt !== undefined
        ? canonicalExpiresAt - nowVariantHit
        : canonical.ttlSec !== undefined
          ? canonical.ttlSec * 1000
          : null
    if (opts?.ttlMs === undefined && canonical.ttlSec !== undefined) {
      opts = { ...opts, ttlMs: canonical.ttlSec * 1000 }
    }
    // Clamp an explicit variant TTL to the canonical remaining so a stale
    // full-TTL opt can never extend a nearly-expired canonical fact.
    // Uncapped canonicals preserve the historical full variant TTL.
    if (canonicalFactCapped && canonicalRemainingMs !== null && opts?.ttlMs !== undefined) {
      const clamped = Math.min(opts.ttlMs, Math.max(0, canonicalRemainingMs))
      if (clamped !== opts.ttlMs) opts = { ...opts, ttlMs: clamped }
    }
    if (canonicalFactCapped && (opts?.factCapped === undefined)) {
      opts = { ...opts, factCapped: true as const }
    }
    if (canonicalExpiresAt !== undefined && opts?.expiresAt === undefined) {
      opts = { ...opts, expiresAt: canonicalExpiresAt }
    }
    const variantHit = readCachedPoster(variantKey, nowVariantHit)
    if (!wantNetGeo && variantHit.payload && !variantHit.stale) {
      const variantHttpSec = httpRemainingSec(variantHit.remainingMs, variantHit.ttlSec ?? variantTtlSec, nowVariantHit, variantHit.expiresAt)
      const variantCapped = variantHit.factCapped ?? canonicalFactCapped ?? false
      if (isConditional && ifNoneMatch === variantHit.payload.etag) {
        log.debug("Poster cache: 304 (variant)", { mediaType, tmdbId, ms: Date.now() - startTime })
        noteTerminalServe()
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(variantHit.payload.etag, variantHit.immutable ?? immutablePoster, dynamicPoster, variantHttpSec, isLive, variantHit.payload.accentMeta, variantCapped) })
      }
      noteTerminalServe()
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, variantHttpSec, undefined, isLive, variantCapped)
    }
    // Format gate: same-revision concurrent conversions share one native
    // encode (key = variant + canonical ETag + format); distinct ones are
    // bounded to 2 natives on a dedicated budget. Overload answers 503 here,
    // never via the negative error cache. Cache hits above never convert.
    const conversionKey = `${variantKey}:${canonical.etag}:${outputFormat}`
    let converted: Buffer
    try {
      converted = canonicalFormat === "webp"
        ? await runFormatConversion(conversionKey, () => convertToJpeg(canonical.buffer))
        : await runFormatConversion(conversionKey, () => convertPosterFormat(canonical.buffer))
    } catch (e) {
      if (e instanceof FormatOverloadError) {
        log.debug("Poster format gate overloaded", { mediaType, tmdbId, ms: Date.now() - startTime })
        return posterErrorResponse(503)
      }
      throw e
    }
    // Conversion delay subtracts elapsed: recompute the canonical remaining
    // AFTER the encode so a slow conversion can never extend the fact expiry.
    const nowAfterConvert = Date.now()
    const canonicalRemainingAfter =
      canonicalExpiresAt !== undefined
        ? canonicalExpiresAt - nowAfterConvert
        : null
    let variantTtlMs: number | undefined = opts?.ttlMs
    if (canonicalFactCapped && canonicalRemainingAfter !== null) {
      if (canonicalRemainingAfter <= 0) {
        // Canonical fact expired during conversion: serve the bytes just built
        // with max-age=0 and store nothing (304 below advertises 0 too — no
        // browser TTL renewal, no rerender loop, no invalidation).
        variantTtlMs = 0
      } else if (variantTtlMs !== undefined) {
        variantTtlMs = Math.min(variantTtlMs, canonicalRemainingAfter)
      } else {
        const variantPolicyMs = variantTtlSec !== undefined ? variantTtlSec * 1000 : undefined
        variantTtlMs = variantPolicyMs !== undefined ? Math.min(variantPolicyMs, canonicalRemainingAfter) : canonicalRemainingAfter
      }
    }
    const variantExpiresAt =
      variantTtlMs !== undefined
        ? (canonicalExpiresAt !== undefined && canonicalRemainingAfter !== null && canonicalRemainingAfter > 0
            ? Math.min(nowAfterConvert + variantTtlMs, canonicalExpiresAt)
            : nowAfterConvert + variantTtlMs)
        : canonicalExpiresAt
    const variantCappedFresh = (opts?.factCapped ?? canonicalFactCapped) || false
    const variant: PosterCachePayload = {
      buffer: converted,
      etag: variantEtagFor(canonical.etag, outputFormat as "jpeg" | "webp"),
      ...(variantTtlMs !== undefined && variantTtlMs > 0 ? { ttlSec: Math.floor(variantTtlMs / 1000) } : {}),
      ...(variantExpiresAt !== undefined ? { expiresAt: variantExpiresAt } : {}),
      ...(variantCappedFresh ? { factCapped: true as const } : {}),
      // Accent fills are format-independent: the converted variant carries the
      // canonical payload's meta, so its 200 serves the same display-sync
      // header (and its cache entry round-trips the sidecar like canonical).
      ...(canonical.accentMeta ? { accentMeta: canonical.accentMeta } : {}),
    }
    // Le preview editor (`preview=1`, ogni tick di slider) non sporcano lo
    // storage: la chiave le separa già, ma scrivere ogni tick è flood.
    // A 304 with remaining 0 stores nothing (no browser renewal extension).
    const freshVariantHttpSec =
      variantExpiresAt !== undefined
        ? Math.max(0, Math.floor((variantExpiresAt - nowAfterConvert) / 1000))
        : variantTtlMs !== undefined
          ? Math.max(0, Math.floor(variantTtlMs / 1000))
          : variantTtlSec
    if (!isPreview && !(variantExpiresAt !== undefined && variantExpiresAt - nowAfterConvert <= 0)) {
      writeCachedPoster(variantKey, variant, mappingTag, {
        ...(variantTtlMs !== undefined ? { ttlMs: variantTtlMs } : {}),
        immutable: opts?.immutable ?? immutablePoster,
        ...(variantCappedFresh ? { factCapped: true as const } : {}),
      })
    }
    if (isConditional && ifNoneMatch === variant.etag) {
      log.debug("Poster cache: 304 (fresh variant)", { mediaType, tmdbId, ms: Date.now() - startTime })
      noteTerminalServe()
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(variant.etag, opts?.immutable ?? immutablePoster, dynamicPoster, freshVariantHttpSec, isLive, variant.accentMeta, variantCappedFresh) })
    }
    noteTerminalServe()
    return posterResponse(variant, opts?.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, freshVariantHttpSec, undefined, isLive, variantCappedFresh)
  }

  // 3. Memory cache check
  // Copia fresca + ETag corrispondente → 304 senza rendering; fresca + ETag
  // diverso → 200. Copia scaduta + condizionale (o live=1) → rivalidazione
  // completa sotto, MAI 304 sulla copia scaduta (audit, problema 2). Solo le
  // non condizionali fuori dal live conservano lo SWR (copia + refresh).
  // C3: la variante ha fast-path dedicato; il canonico resta il
  // fallback (conversione) quando la variante è assente/scadata.
  if (needsVariant && !refreshRequest) {
    const variantHitNow = Date.now()
    const variantHit = readCachedPoster(variantKey, variantHitNow)
    if (!wantNetGeo && variantHit.payload && !variantHit.stale) {
      recordPosterRequest(true, outputFormat)
      recordPosterLatency("cached", Date.now() - startTime)
      const variantHitHttpSec = variantHit.factCapped
        ? httpRemainingSec(variantHit.remainingMs, variantHit.ttlSec ?? variantTtlSec, variantHitNow, variantHit.expiresAt)
        : (variantHit.ttlSec ?? variantTtlSec)
      if (isConditional && ifNoneMatch === variantHit.payload.etag) {
        log.debug("Poster cache: 304 (variant)", { mediaType, tmdbId, ms: Date.now() - startTime })
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(variantHit.payload.etag, variantHit.immutable ?? immutablePoster, dynamicPoster, variantHitHttpSec, isLive, variantHit.payload.accentMeta, variantHit.factCapped) })
      }
      log.debug("Poster cache: fresh variant hit", { mediaType, tmdbId, ms: Date.now() - startTime })
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, variantHitHttpSec, undefined, isLive, variantHit.factCapped)
    }
    if (variantHit.payload && !isConditional && !isLive && !wantNetGeo && canServePosterStaleHit(variantHit)) {
      recordPosterRequest(true, outputFormat)
      recordPosterStaleHit()
      // Stale/SWR serve: no render here — the scheduled background refresh
      // records its own "render" sample when it completes.
      recordPosterLatency("cached", Date.now() - startTime)
      schedulePosterRefresh(req, isPreview)
      log.debug("Poster cache: stale variant hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, undefined, undefined, isLive)
    }
    // Variante assente/scadata con condizionale o live: si prosegue al
    // canonico sotto (fresco → conversione; scaduto/assente → render).
  }
  const cachedPosterNow = Date.now()
  const cachedPoster = readCachedPoster(cacheKey, cachedPosterNow)
  if (!wantNetGeo && cachedPoster.payload && !cachedPoster.stale) {
    recordPosterRequest(true, outputFormat)
    const cachedHttpSec = cachedPoster.factCapped
      ? httpRemainingSec(cachedPoster.remainingMs, cachedPoster.ttlSec ?? dynamicTtlSec, cachedPosterNow, cachedPoster.expiresAt)
      : (cachedPoster.ttlSec ?? dynamicTtlSec)
    // needsVariant: the "cached" sample for conversions is recorded inside
    // serveResponseVariant (conversion encode included); direct path only here.
    if (needsVariant) return serveResponseVariant(cachedPoster.payload, undefined, "cached")
    recordPosterLatency("cached", Date.now() - startTime)
    if (!needsVariant && isConditional && ifNoneMatch === cachedPoster.payload.etag) {
      log.debug("Poster cache: 304", { mediaType, tmdbId, ms: Date.now() - startTime })
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(cachedPoster.payload.etag, cachedPoster.immutable ?? immutablePoster, dynamicPoster, cachedHttpSec, isLive, cachedPoster.payload.accentMeta, cachedPoster.factCapped) })
    }
    log.debug("Poster cache: fresh hit", { mediaType, tmdbId, ms: Date.now() - startTime })
    return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedHttpSec,
      serverTimingValue([{ name: "cache", desc: "HIT" }, { name: "total", durMs: Date.now() - startTime }]), isLive, cachedPoster.factCapped)
  }
  if (!wantNetGeo && cachedPoster.payload && !isConditional && !isLive && !refreshRequest && canServePosterStaleHit(cachedPoster)) {
    recordPosterRequest(true, outputFormat)
    recordPosterStaleHit()
    // Stale/SWR serve: no render here — the scheduled background refresh
    // re-renders separately and records its own "render" sample on success.
    // Scheduled BEFORE branching (historical ordering) so variant responses
    // warm the edge cache too; each path records one "cached" sample.
    schedulePosterRefresh(req, isPreview)
    log.debug("Poster cache: stale hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
    if (needsVariant) return serveResponseVariant(cachedPoster.payload, undefined, "cached")
    recordPosterLatency("cached", Date.now() - startTime)
    return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedPoster.factCapped ? httpRemainingSec(cachedPoster.remainingMs, cachedPoster.ttlSec ?? dynamicTtlSec, Date.now(), cachedPoster.expiresAt) : (cachedPoster.ttlSec ?? dynamicTtlSec), undefined, isLive, cachedPoster.factCapped)
  }
  // Copia scaduta con condizionale o live=1, oppure nessuna copia: si
  // rivalida (deduplicazione inflight sotto, poi confronto sul validatore
  // finale). Se la rivalidazione fallisce, errore — mai un falso 304.

  const pendingPoster = getPendingPoster(cacheKey)
  if (pendingPoster && !wantNetGeo) {
    // F8: il waiter coalesced attende al massimo RENDER_SLOT_WAIT_MS, poi 503
    // con Retry-After invece di tenere la connessione fino all'INFLIGHT_TIMEOUT
    // (60s) del render lento. Fix L3: il timer della race viene cancellato se
    // vince la promise concorrente (prima restava attivo fino alla scadenza).
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined
    const coalesceTimeout = new Promise<PosterCachePayload | null>((resolve) => {
      coalesceTimer = setTimeout(() => resolve(null), RENDER_SLOT_WAIT_MS)
    })
    const payload = await Promise.race([pendingPoster, coalesceTimeout])
    if (coalesceTimer) clearTimeout(coalesceTimer)
    if (payload) {
      log.debug("Poster cache: coalesced with in-flight render", { mediaType, tmdbId, ms: Date.now() - startTime })
      recordPosterRequest(true, outputFormat)
      recordPosterCoalescedHit()
      // Latency: NO sample — the waiter awaited ANOTHER request's render, so
      // its latency measures queue + someone else's pipeline, never its own
      // cache nor its own render. The effective render records its own
      // "render" sample once at terminal success.
      // Finding 5: il waiter della preview deve ricevere gli header no-store
      // anche quando si coalesce con un render in flight (era hardcoded false).
      // C3: il payload condiviso è canonico — il waiter non-canonico converte.
      // Il confronto condizionale usa il validatore della rappresentazione
      // richiesta (audit, problema 1): niente conversione solo per il 304.
      if (needsVariant) {
        const waiterVariantEtag = variantEtagFor(payload.etag, outputFormat as "jpeg" | "webp")
        const waiterNow = Date.now()
        const waiterVariantHttpSec = payload.factCapped ? payloadHttpRemainingSec(payload, variantTtlSec, waiterNow) : (payload.ttlSec ?? variantTtlSec)
        if (isConditional && ifNoneMatch === waiterVariantEtag) {
          return new Response(null, { status: 304, headers: posterNotModifiedHeaders(waiterVariantEtag, immutablePoster, dynamicPoster, waiterVariantHttpSec, isLive, payload.accentMeta, payload.factCapped) })
        }
        return serveResponseVariant(payload)
      }
      if (isConditional && ifNoneMatch === payload.etag) {
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(payload.etag, immutablePoster, dynamicPoster, payload.factCapped ? payloadHttpRemainingSec(payload, dynamicTtlSec) : (payload.ttlSec ?? dynamicTtlSec), isLive, payload.accentMeta, payload.factCapped) })
      }
      return posterResponse(payload, immutablePoster, isPreview, dynamicPoster, outputFormat, payload.factCapped ? payloadHttpRemainingSec(payload, dynamicTtlSec) : (payload.ttlSec ?? dynamicTtlSec), undefined, isLive, payload.factCapped)
    }
    // Coalesce scaduto: o il render è fallito (negative cache) o è ancora in
    // corso — mai duplicare il render, rispondere 503 con backoff esplicito.
    const negError = readPosterError(cacheKey)
    if (negError) {
      log.debug("Poster negative cache hit", { mediaType, tmdbId, status: negError.status, ms: Date.now() - startTime })
      return posterErrorResponse(negError.status)
    }
    log.debug("Coalesce timeout: render ancora in corso", { mediaType, tmdbId, ms: Date.now() - startTime })
    return posterErrorResponse(503)
  }

  // Negative cache (F3): un 500/503 recente sulla stessa cache key non
  // ri-rende la pipeline per il TTL — risponde subito lo stesso status.
  const negativeError = readPosterError(cacheKey)
  if (negativeError) {
    log.debug("Poster negative cache hit", { mediaType, tmdbId, status: negativeError.status, ms: Date.now() - startTime })
    return posterErrorResponse(negativeError.status)
  }

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
  // job: its catch/finally keeps releaseSlotOnce/endZombie/
  // completePosterRender until the work ACTUALLY settles — the early GET
  // return path must never free zombie budget or inflight while work runs.
  // Inner lines keep their existing indentation on purpose: boundary-only
  // diff, no 1500-line reindent.
  const renderJob: Promise<Response> = (async (): Promise<Response> => {
  try {
  // 4. Resolve poster/logo/backdrop paths
  let posterPath: string | null = null
  let posterPathBuffer: Buffer | null = null
  // Buffer del logo già scaricato dal best-fit (w500): riusato nel Block A per
  // evitare il re-fetch. Assente su cache hit del best-fit o timeout del logo →
  // Block A fa il fetch normale.
  let logoPathBuffer: Buffer | null = null
  let logoPath: string | null = null
  // Il poster finale del ramo automatico è clean (senza testo incorporato)?
  // Solo TMDB iso_639_1===null o rescue TVDB textless. Serve a: (1) non
  // sovrapporre mai il logo a un poster con testo, (2) forzare il profilo
  // blur non-clean sui default iniettati da Stremio (Golden Rule col client).
  let autoPosterClean = false
  // Il rescue TVDB ha restituito artwork textless (base clean, logo tenuto)?
  let tvdbRescueClean = false
  // Lingua richiesta per artwork/logo (ramo non-mappato; default da posterRegion):
  // serve al blocco debug=1 fuori dallo scope del ramo.
  let posterRequestedLang = posterRegion.lang2
  // Selezione logo per debug=1: iso scelto + motivo del fallback (null = logo
  // esplicito da query/mapping, nessun fallback applicato).
  let logoChosenIso: string | null = null
  let logoFallbackReason: string | null = null
  let backdropPath: string | null = null
  // Sfondi TMDB del ramo automatico (details.backdrop_path o primo backdrops
  // di getImages): fallback per la base landscape quando query/mapping non
  // ne forniscono uno.
  let autoBackdropPath: string | null = null
  let backdropScale = 100
  let backdropOffsetX = 0
  let backdropOffsetY = 0
  let etag: string
  let genreName: string | null = null
  let voteAverage: number | null = null
  // Il ramo non-mappato ha fallito il fetch automatico dei dati TMDB
  // (errore/outage upstream, non titolo inesistente): le risposte da
  // !posterPath devono essere 503, non 404.
  let autoFetchFailed = false
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
  let releaseDate: string | null = null
  let firstAirDate: string | null = null
  let lastAirDate: string | null = null
  let seasonCount: number | null = null
  /** TMDB `next_episode_to_air.air_date` + `number_of_episodes` (TV series: New Episode / Only N Episodes inputs). */
  let nextEpisodeAirDate: string | null = null
  let numberOfEpisodes: number | null = null
  let originCountries: string[] = []
  /** ID generi TMDB canonici (16 = Animation) — escludono l'animazione dal K-Drama automatico. */
  let genreIds: number[] | null = null
  let tvType: string | null = null
  let tvStatus: string | null = null
  let tmdbStudios: string[] = []
  let tmdbNetworks: string[] = []
  let productionCompanies: string[] = []
  let tmdbNetworksDetailed: { name: string; logoPath: string | null }[] = []
  let productionCompaniesDetailed: { name: string; logoPath: string | null }[] = []
  let imdbId: string | null = pathImdbId
  // TMDB title from the auto branch, kept in scope for the JustWatch match:
  // the session cache is a small LRU and can be evicted mid-render.
  let autoTitle: string | null = null
  // QID Wikidata per il fast-path REST awards (wbgetentities, ~150ms) invece
  // della lotteria SPARQL (4-13s contro race da 2.5s). Catena: query
  // `wikidata_id` (la preview lo ha già dai details, zero RTT) > mapping
  // salvato > session cache TMDB del processo > resolve server-side con memo
  // 7gg (quarto anello, prima della race) > ramo else (details +
  // external_ids in append). Senza QID ovunque: fallback SPARQL invariato.
  // F2: the session cache is language-isolated — reads use the same
  // query > mapping > region chain as the branches that populate it (it
  // matches preferredLanguage when mapping is null, and fbLang of the
  // landscape fallback).
  let wikidataId: string | null = null
  const sessionLang = req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2
  {
    const queryWikidataId = hardenedParams.get("wikidata_id")
    const mappingWikidataId = mapping?.wikidataId ?? null
    const sessionWikidataId = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.externalIds?.wikidata_id ?? null
    if (isValidWikidataQid(queryWikidataId)) wikidataId = queryWikidataId
    else if (isValidWikidataQid(mappingWikidataId)) wikidataId = mappingWikidataId
    else if (isValidWikidataQid(sessionWikidataId)) wikidataId = sessionWikidataId
  }

  const queryPoster = hardenedParams.get("poster")
  const queryLogo = hardenedParams.get("logo")
  const queryBackdrop = hardenedParams.get("backdrop")
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
  const t = createT(req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2)

  if (queryPoster) {
    posterPath = queryPoster
    logoPath = queryLogo || null
    backdropPath = queryBackdrop || null
    if (queryBackdrop) {
      backdropScale = Number(hardenedParams.get("bscale") || "100")
      // Bound inferiore + superiore: un valore come 1e-7 produrrebbe resize(0,0) → 500.
      if (!Number.isFinite(backdropScale) || backdropScale < 5 || backdropScale > 500) backdropScale = 100
      backdropOffsetX = Number(hardenedParams.get("box") || "0")
      if (!Number.isFinite(backdropOffsetX)) backdropOffsetX = 0
      backdropOffsetY = Number(hardenedParams.get("boy") || "0")
      if (!Number.isFinite(backdropOffsetY)) backdropOffsetY = 0
    }
    if (queryGenre) genreName = queryGenre
    if (queryVote) {
      voteAverage = Number(queryVote)
      if (!Number.isFinite(voteAverage)) voteAverage = null
      else voteAverage = Math.min(Math.max(voteAverage, 0), 10) // clamp a [0,10]
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
      firstAirDate = queryFad
    } else if (mediaType !== "tv" && queryRd && /^\d{4}-\d{2}-\d{2}$/.test(queryRd)) {
      releaseDate = queryRd
    } else {
      const queryYear = hardenedParams.get("year")
      if (queryYear && /^\d{4}$/.test(queryYear.slice(0, 4))) {
        const y = queryYear.slice(0, 4)
        if (mediaType === "tv") firstAirDate = `${y}-01-01`
        else releaseDate = `${y}-01-01`
      }
    }
    imdbId = hardenedParams.get("imdbId") || imdbId
    showBadges = req.nextUrl.searchParams.get("badges") !== "0"
    rankingBadges = req.nextUrl.searchParams.get("ranking") !== "0"
    etag = `"p${etagBase}"`
  } else if (mapping) {
    posterPath = mapping.posterPath
    // Logo manuale anche su portrait non-clean: il default resta nessun auto
    // a monte, ma il logoPath esplicito (mapping o ?logo=) è ammesso in ogni
    // formato. logoDisabled sempre onorato; query esplicita vince.
    const effectiveMappingLogo = !mapping.logoDisabled ? mapping.logoPath : null
    logoPath = queryLogo || effectiveMappingLogo
    backdropPath = queryBackdrop || mapping?.backdropPath || null
    backdropScale = mapping?.backdropScale ?? 100
    // Fix M5: clamp difensivo anche sui mapping già salvati (pre-bounds zod):
    // 0/negativi rompono resizeBackdropCached → 500 permanente.
    if (!Number.isFinite(backdropScale) || backdropScale < 5 || backdropScale > 500) backdropScale = 100
    backdropOffsetX = mapping?.backdropOffsetX ?? 0
    backdropOffsetY = mapping?.backdropOffsetY ?? 0
    genreName = mapping.genreName ?? null
    // A saved genre is a localized string, not a language-independent ID.
    // Explicit poster language wins, just as it does for automatic posters.
    const genreLang = req.nextUrl.searchParams.get("lang")
    if (genreName && genreLang && effTmdbKey && (earlyEffMapping?.showBadges ?? mapping.showBadges) !== false && !queryGenre) {
      try {
        const cached = getTMDBSessionCache(mediaType, tmdbId, genreLang)
        const localizedDetails = cached?.details
          ?? await getDetails(mediaType, tmdbId, genreLang, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS)
        if (!cached?.details && localizedDetails) {
          setTMDBSessionCache(mediaType, tmdbId, genreLang, { ...cached ?? undefined, details: localizedDetails })
        }
        genreName = localizedDetails?.genres?.[0]?.name || genreName
        if (Array.isArray(localizedDetails?.genres)) {
          genreIds = localizedDetails.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id))
        }
      } catch {
        // Keep the saved genre if TMDB is unavailable.
      }
    }
    voteAverage = mapping.voteAverage ?? null
    showBadges = earlyEffMapping?.showBadges ?? mapping.showBadges ?? true
    rankingBadges = earlyEffMapping?.rankingBadges ?? mapping.rankingBadges ?? true
    // IMDb ID salvato al save (il path `tt...` vince se presente): evita il
    // fallback getExternalIds che richiede una chiave TMDB assente in Stremio.
    imdbId = imdbId ?? mapping.imdbId ?? null
    etag = `"m${etagBase}:${mapping.updatedAt}"`
    // Niente uscita 304 anticipata qui: il validatore sintetico non
    // rappresenta i byte (rank live e altre dipendenze dinamiche) — la
    // decisione 304/200 avviene solo dopo aver risolto il contenuto
    // (hit fresca) o ri-renderizzato (audit freschezza, problemi 1–2).
  } else {
    const preferredLanguage = req.nextUrl.searchParams.get("lang") || posterRegion.lang2
    posterRequestedLang = preferredLanguage
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
        const needsOrigLang = origLang && origLang !== preferredLanguage && origLang !== "en"
          && (imgs.posters.length === 0 || imgs.logos.length === 0)
        images = needsOrigLang
          ? await getImages(mediaType, tmdbId, `${baseLangs},${origLang}`, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => imgs)
          : imgs
        setTMDBSessionCache(mediaType, tmdbId, preferredLanguage, { details: det, images, externalIds: extIds })
      }
      // Candidato sfondo per il ramo landscape: backdrop principale TMDB,
      // poi il primo backdrops di /images (già 16:9 nativi).
      autoTitle = details.title || details.name || null
      autoBackdropPath = details.backdrop_path || images.backdrops[0]?.file_path || null
      imdbId = extIds.imdb_id
      // Non sovrascrivere un QID già risolto a monte (query > mapping >
      // session): il fetch qui è l'ultima ruota, non la prima.
      if (!wikidataId) wikidataId = extIds.wikidata_id ?? null
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
      const canRequestRatings = !!imdbId || isMdbTmdbIdentityUsable(tmdbId, mediaType)
      ratingAbort = canRequestRatings ? new AbortController() : null
      aggregatedRating = canRequestRatings
        ? fetchAggregatedRating(imdbId, effMdblistKey, ratingAbort!.signal, {
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
      genreName = details.genres[0]?.name || null
      genreIds = Array.isArray(details.genres) ? details.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id)) : null
      voteAverage = details.vote_average ?? 0
      releaseDate = details.release_date || null
      firstAirDate = details.first_air_date || null
      lastAirDate = details.last_air_date || null
      seasonCount = details.number_of_seasons ?? null
      nextEpisodeAirDate = details.next_episode_to_air?.air_date || null
      numberOfEpisodes = details.number_of_episodes ?? null
      originCountries = [...(details.networks || []), ...(details.production_companies || [])]
        .map((c) => c.origin_country)
        .filter((c): c is string => !!c)
      tmdbNetworks = (details.networks || []).map((n: TMDBCompany) => n.name)
      tmdbNetworksDetailed = (details.networks || []).map((n: TMDBCompany) => ({ name: n.name, logoPath: n.logo_path }))
      productionCompanies = (details.production_companies || []).map((c: TMDBCompany) => c.name)
      productionCompaniesDetailed = (details.production_companies || []).map((c: TMDBCompany) => ({ name: c.name, logoPath: c.logo_path }))
      tmdbStudios = matchTMDBStudios([...tmdbNetworks, ...productionCompanies])
      tvType = details.type || null
      tvStatus = details.status || null
      // C1: acquisisci lo slot PRIMA del lavoro CPU pesante del ramo non-mappato
      // (logo-fit: fetch + decode dei poster candidati). Prima questi avvenivano
      // fuori dal semaforo → un burst di logo-fit su cache fredda (griglie
      // catalogo) spingeva la memoria senza bound. Lo stesso slot viene riusato
      // dal render sharp sotto; il finally lo rilascia comunque.
      if (!releaseRender) {
        releaseRender = await acquirePosterRenderSlot()
        if (!releaseRender) {
          clearTimeout(renderDeadline)
          completePosterRender(null)
          // H2 single-503: past the deadline the watchdog already wrote the
          // 503 entry — the late job only answers 503, never rewrites.
          if (!deadlineFired) writePosterError(cacheKey, 503)
          return posterErrorResponse(503)
        }
      }
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
        if (isCustomPosterUrl(queryLogo)) logoPath = queryLogo
        else {
          const exact = allLogos.find((l: TMDBImage) => l.file_path === queryLogo)
          if (exact) logoPath = exact.file_path
        }
      }
      if (!logoPath) {
        // Default = primo logo del gruppo lingua, lo stesso che mostra il
        // client (`selectBestLogo` in context.tsx): nessun re-ranking per
        // leggibilità, così Stremio rende lo stesso logo della preview.
        const chosenLogo = selectBestLogo(allLogos, preferredLanguage, details.original_language)
        const reason = logoBestLogoFallbackReason(chosenLogo, preferredLanguage, details.original_language)
        if (reason === "origLang") log.info("Logo fallback to original_language", { lang: details.original_language, mediaType, tmdbId })
        else if (reason === "any") log.info("Logo fallback to any (first available)", { mediaType, tmdbId })
        else if (reason === "none") log.info("No logo available", { mediaType, tmdbId })
        logoFallbackReason = reason
        if (chosenLogo) { logoPath = chosenLogo.file_path; logoChosenIso = chosenLogo.iso_639_1 ?? null }
      }

      // Opzione "disattiva clean" (default OFF = priorità ai clean): con flag ON
      // il ramo clean è saltato del tutto e si usa la catena in lingua sotto
      // (badge invariati, niente logo sopra in portrait). Mapping salvati e
      // scelta manuale (query poster=) non passano di qui.
      const cleanEnabled = sd.disableCleanPosters !== true
      const clean = cleanEnabled ? images.posters.find((p: TMDBImage) => p.iso_639_1 === null) : undefined
      if (clean) {
        // Ramo clean: best-fit pesca solo dalla pool clean, quindi il poster
        // finale resta clean (logo tenuto) salvo il fallback in lingua sotto.
        autoPosterClean = true
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
        // Rotazione giornaliera dinamici portrait (solo clean, cut 02:00 UTC):
        // precede il best-fit così il cambio giorno cambia davvero la base.
        // Solo con logo (un clean senza logo non ha titolo da comporre) e con
        // almeno 2 clean, altrimenti fallback storico invariato.
        const dynamicCleanPool = (dynamicDayBucket !== null && !isLandscape && logoPath)
          ? images.posters.filter((p: TMDBImage) => p.iso_639_1 === null)
          : []
        if (dynamicDayBucket !== null && dynamicCleanPool.length >= 2) {
          const picked = dynamicCleanPool[rotationIndexFor(dynamicDayBucket, dynamicCleanPool.length)]
          posterPath = picked.file_path
          log.info("Dynamic rotation: daily clean poster", { mediaType, tmdbId, poster: picked.file_path, pool: dynamicCleanPool.length })
        } else if (logoPath && logoFitEnabled) {
          try {
            const fitStart = Date.now()
            const bestFit = await selectBestLogoFitPosterPath({
              posters: images.posters, logoPath,
              fetchImage: async (path: string) => {
                // Byte-LRU (F3): key = URL finale (imgSrc lancia su URL esterni
                // come prima, fuori dalla cache). B5: signal combinato col
                // watchdog così dopo la deadline non restano zombie.
                // Custom logo from an external URL: same safe pipeline as the
                // render (allowlist + SSRF + raster-only); a failure throws
                // like a failed TMDB fetch (best-fit degrades to the
                // historical fallback, never 500).
                if (isCustomPosterUrl(path)) {
                  const buf = await fetchValidatedCustomImage(path, combineAbortSignals(renderAbort.signal, 5000))
                  if (!buf) throw new Error("Custom logo fetch failed")
                  return buf
                }
                const url = imgSrc(path)
                const imgSignal = combineAbortSignals(renderAbort.signal, 5000)
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
                const candidateSignal = combineAbortSignals(renderAbort.signal, 5000)
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
            posterPath = bestFit?.posterPath ?? clean.file_path
            if (bestFit?.posterBuffer) posterPathBuffer = bestFit.posterBuffer
            if (bestFit?.logoBuffer) logoPathBuffer = bestFit.logoBuffer
          } catch (e) {
            log.error("Best-fit: fallback to first clean", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
            posterPath = clean.file_path
          }
        } else if (logoPath) {
          // Logo disponibile ma best-fit disabilitato: il clean viene usato
          // comunque (il logo verrà composto sopra).
          log.info("Best-fit: disabled by config", { mediaType, tmdbId })
          posterPath = clean.file_path
        } else {
          // Nessun logo disponibile: il poster clean senza logo è inutile
          // (lo spazio è pensato per il logo). Fallback al poster in lingua:
          // preferita → originale → prima non-clean → clean come ultima spiaggia.
          const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
          const origPoster = details.original_language ? images.posters.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
          const nonCleanPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 !== null)
          const fallbackPoster = langPoster || origPoster || nonCleanPoster || clean
          log.info("No logo — fallback to language poster", { mediaType, tmdbId, poster: fallbackPoster.file_path })
          posterPath = fallbackPoster.file_path
          autoPosterClean = fallbackPoster.iso_639_1 === null
        }
      } else {
        // B1: TVDB rescue — solo senza clean TMDB (o con clean disattivati il
        // rescue è spento: ricadrebbe su una base textless vanificando l'opzione),
        // con logo e chiave TVDB
        // (gating fail-fast: niente chiave → costo zero). Il poster textless
        // TVDB salva il logo che altrimenti verrebbe droppato col fallback
        // in lingua. Solo portrait (il landscape ha già la base backdrop).
        // Fail-open: qualsiasi errore → fallback in lingua sotto.
        let tvdbRescue: string | null = null
        if (!isLandscape && logoPath && tvdbApiKey && cleanEnabled) {
          try {
            const remoteTvdbId = extIds.tvdb_id
              ?? (imdbId
                ? (mediaType === "movie"
                  ? await getTvdbMovieId(imdbId, tvdbApiKey, renderAbort.signal)
                  : await getTvdbSeriesId(imdbId, tvdbApiKey, renderAbort.signal))
                : null)
            if (remoteTvdbId) {
              const arts = await getTvdbArtworks(mediaType, remoteTvdbId, tvdbApiKey, renderAbort.signal)
              const rescuedArt = pickTvdbPoster(arts, preferredLanguage)
              tvdbRescue = rescuedArt?.image ?? null
              // Solo il textless salva davvero il logo: con testo incorporato
              // la base non è clean → niente logo sopra (doppio logo).
              tvdbRescueClean = !!tvdbRescue && rescuedArt?.includesText === false
            }
          } catch {
            // Fallthrough al fallback in lingua.
          }
        }
        if (tvdbRescue) {
          log.info("TVDB poster rescue", { mediaType, tmdbId, poster: tvdbRescue })
          recordTvdbRescue()
          posterPath = tvdbRescue
          autoPosterClean = tvdbRescueClean
          if (!tvdbRescueClean) {
            // Base con testo incorporato: mai il logo sopra (stesso invariante
            // del fallback in lingua sotto e del client).
            logoPath = null
            logoPathBuffer = null
          }
        } else {
          // Nessun clean disponibile: il poster in lingua ha già il titolo
          // stampato → mai sovrapporre il logo in portrait (stesso invariante
          // del client: buildPreviewUrl emette `logo=` solo con poster clean,
          // e il mapping forza logoPath=null sui non-clean). In landscape la
          // base è il backdrop (senza testo): il logo resta sempre e la base
          // conta come clean per il profilo sfumatura.
          const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
          const origPoster = details.original_language ? images.posters.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
          const chosen = langPoster || origPoster || images.posters[0]
          if (chosen) posterPath = chosen.file_path
          if (isLandscape && logoPath) {
            autoPosterClean = true
          } else {
            logoPath = null
            logoPathBuffer = null
          }
        }
      }
      // Rotazione giornaliera dinamici landscape (solo backdrop clean, cut
      // 02:00 UTC): precede il best-fit così il cambio giorno cambia davvero
      // la base. Solo con logo e almeno 2 backdrop clean, altrimenti fallback
      // storico invariato.
      let dynamicLandscapeRotated = false
      if (isLandscape && !queryBackdrop && logoPath && dynamicDayBucket !== null) {
        const dynamicBackdropPool = (images.backdrops ?? []).filter((b) => b.iso_639_1 === null)
        if (dynamicBackdropPool.length >= 2) {
          autoBackdropPath = dynamicBackdropPool[rotationIndexFor(dynamicDayBucket, dynamicBackdropPool.length)].file_path
          dynamicLandscapeRotated = true
          log.info("Dynamic rotation: daily backdrop", { mediaType, tmdbId, backdrop: autoBackdropPath, pool: dynamicBackdropPool.length })
        }
      }
      // Best-fit automatico dello sfondo landscape (mirror del portrait sopra):
      // senza scelta esplicita (query/backdrop salvato) i titoli non-mappati
      // usavano il primo backdrop TMDB mentre l'editor auto-seleziona il
      // best-fit — l'anteprima Stremio mostrava un altro sfondo (desync
      // WYSIWYG, "vedo comunque il primo poster"). Solo con logo disponibile
      // (senza, niente da comporre sopra) e fit abilitato; qualsiasi fallimento
      // mantiene il fallback storico (primo backdrop), mai 500.
      if (isLandscape && !queryBackdrop && logoPath && !dynamicLandscapeRotated && (images.backdrops?.length ?? 0) > 0) {
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
                logoPath,
                fetchImage: async (path: string) => {
                  const url = imgSrc(path)
                  const imgSignal = combineAbortSignals(renderAbort.signal, 5000)
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
                  const candidateSignal = combineAbortSignals(renderAbort.signal, 5000)
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
                if (landFit.posterPath !== autoBackdropPath) {
                  log.info("Best-fit: improved landscape backdrop selected", { mediaType, tmdbId, bestFit: landFit.posterPath, original: autoBackdropPath })
                }
                autoBackdropPath = landFit.posterPath
              }
            }
          } catch (e) {
            log.error("Best-fit landscape: fallback to first backdrop", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
          }
        }
      }
    } catch (e) {
      autoFetchFailed = true
      log.error("Auto image fetch failed", { error: e instanceof Error ? e.message : String(e) })
    }
    etag = `"a${etagBase}"`
  }

  // Landscape senza backdrop esplicito (query `backdrop` o mapping): i rami
  // query/mapping non toccano TMDB, ma la base 16:9 richiede uno sfondo —
  // fallback live a details.backdrop_path (poi primo backdrops di /images).
  // Solo ramo landscape: il portrait non ne ha bisogno. Su errore resta null
  // e il blocco landscape sotto risponde 404 onesto.
  if (isLandscape && !queryBackdrop && !mapping?.backdropPath && !autoBackdropPath) {
    try {
      const fbApiKey = effTmdbKey
      const fbLang = req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2
      const cached = getTMDBSessionCache(mediaType, tmdbId, fbLang)
      let fbDetails = cached?.details
      if (!fbDetails) {
        fbDetails = await getDetails(mediaType, tmdbId, fbLang, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS)
        const prev = getTMDBSessionCache(mediaType, tmdbId, fbLang)
        setTMDBSessionCache(mediaType, tmdbId, fbLang, { ...prev ?? undefined, details: fbDetails })
      }
      autoBackdropPath = fbDetails?.backdrop_path || null
      if (!autoBackdropPath) {
        const fbImages = cached?.images
          ?? await getImages(mediaType, tmdbId, `${fbLang},en,null`, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
        if (fbImages && !cached?.images) {
          const prev = getTMDBSessionCache(mediaType, tmdbId, fbLang)
          setTMDBSessionCache(mediaType, tmdbId, fbLang, { ...prev ?? undefined, images: fbImages })
        }
        autoBackdropPath = fbImages?.backdrops?.[0]?.file_path || null
      }
    } catch {
      autoBackdropPath = null
    }
  }

  // B2: fallback backdrop-crop — SOLO sostituzione del 404, mai su poster
  // esistenti. Senza poster TMDB utilizzabile ma con un backdrop (query >
  // mapping > automatico), la base diventa il cover-crop 2:3 del backdrop
  // invece di 404. Vale per entrambi i canvas (in landscape la base coperta
  // dal backdrop full-bleed alimenta comunque pillarbox e cache image-level,
  // namespaced per path come le altre sorgenti). Deadline/fetch falliti
  // restano 503/404: niente crop su dati degradati.
  if (!posterPath && !deadlineFired && !autoFetchFailed) {
    const cropSrc = queryBackdrop || mapping?.backdropPath || autoBackdropPath || backdropPath
    if (cropSrc) {
      try {
        const cropBase = await fetchImg(landscapeBackdropUrl(cropSrc), renderAbort.signal).catch(() => null)
        if (cropBase) {
          posterPathBuffer = await cropBackdropToPortrait(cropBase)
          posterPath = cropSrc
          recordBackdropCropRescue()
        }
      } catch {
        // Fallthrough al 404/503 sotto.
      }
    }
  }

  try {
    if (!posterPath) {
      // Deadline sforato o fetch upstream fallito: NIENTE 404. Il titolo può
      // semplicemente essere lento/indisponibile upstream; la negative-cache 503
      // (TTL breve) evita la tempesta di ri-render senza marchiare il titolo
      // come inesistente. Dentro il try: il finally unifica il rilascio slot
      // (releaseSlotOnce è idempotente) — nessun return fuori dal try/finally
      // può più leakare lo slot acquisito dal logo-fit.
      if (deadlineFired || autoFetchFailed) {
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
      backdropPath = queryBackdrop || mapping?.backdropPath || autoBackdropPath || backdropPath
    }

    // Semaforo anti-OOM: limita i render costosi concorrenti (sharp composite,
    // blur, badge SVG→PNG). Se tutti i posti sono occupati per più del timeout,
    // risponde 503 invece di accodarsi e far crescere l'heap senza bound.
    // C1: se il ramo non-mappato ha già acquisito lo slot (logo-fit), lo si
    // riusa — mai doppia acquisizione (releaseRender già valorizzato).
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

    const qRankingEarly = req.nextUrl.searchParams.get("ranking")
    const qBqEarly = req.nextUrl.searchParams.get("bq")
    const qQualityParam = req.nextUrl.searchParams.get("quality")
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
    if (!wikidataId && rankingEnabledEarly && effTmdbKey) {
      wikidataId = await resolveWikidataId(mediaType, tmdbId, effTmdbKey, 1500)
    }

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

    // 5. Fetch all data in parallel: images + rankings + quality + wikidata + keywords + imdbTop250
    //    All dependencies are available before this point — no Block B depends on Block A
    const emptyWikidata = { awards: [], nominations: [], studios: [], director: null }
    const WIKIDATA_TIMEOUT = Number(process.env.WIKIDATA_TIMEOUT) || 2500
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
      if (!backdropPath || isCustomPosterUrl(backdropPath)) return null
      try {
        return isLandscape ? landscapeBackdropUrl(backdropPath) : imgSrc(backdropPath)
      } catch {
        return null
      }
    })()
    // Explicit custom URL in backdropPath (preview with the custom tile, or
    // a hand-crafted query): same validated pipeline, never 500 on
    // allowlisted URLs (in preview it coincides with the effectiveCustomUrl
    // below).
    const explicitBackdropCustomUrl = backdropPath && isCustomPosterUrl(backdropPath) ? backdropPath : null
    // Custom base for the backdrop slot: in landscape the explicit preview
    // query or the saved customBackdropUrl; in portrait ONLY the explicit URL
    // in backdropPath (the portrait custom travels on the poster slot, never
    // here). Without a custom the TMDB branch below stays verbatim.
    const backdropCustomForFetch = (isLandscape ? effectiveCustomUrl : null) ?? explicitBackdropCustomUrl
    const [
      [originalBase, logoFetch, backdropFetch, rankingResult, animeRankResult, rawLiveQuality, preReleaseDetected],
      [wikidataResult, tmdbKeywords, imdbTop250, ageCert],
    ] = await Promise.all([
      // Block A: images + ranking data + quality
      Promise.all([
        posterPathBuffer
          ? Promise.resolve({ buf: posterPathBuffer, custom: false })
          : posterCustomForFetch
            ? fetchPosterBaseWithCustom(posterCustomForFetch, tmdbFallbackSrc ?? safeTmdbImgSrc(posterPath), renderAbort.signal)
            : fetchImg(imgSrc(posterPath), renderAbort.signal).catch(() => null).then((buf) => (buf ? { buf, custom: false } : null)),
        logoPathBuffer
          ? Promise.resolve(logoPathBuffer)
          // Custom logo from an external URL: same safe pipeline as the custom
          // base (allowlist + SSRF + raster-only, no SVG); a definitive
          // failure resolves to null + logo-less composition, never 500. A
          // render abort propagates (never a zombie fallback).
          : logoPath
            ? (isCustomPosterUrl(logoPath)
              ? fetchValidatedCustomImage(logoPath, renderAbort.signal).catch(() => null)
              : fetchLogoImg(logoPath, renderAbort.signal).catch(() => null))
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
          : backdropPath
            ? fetchImg(isLandscape ? landscapeBackdropUrl(backdropPath) : imgSrc(backdropPath), renderAbort.signal).catch(() => null)
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
                  const fallbackTitle = mapping?.title || hardenedParams.get("title") || autoTitle || sessionTitle || genreName || null
                  const effSeasonCount = seasonCount ?? getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.details?.number_of_seasons ?? null
                  return resolveStreamQuality(
                    mediaType === "movie" ? "movie" : "series",
                    imdbId,
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
                    || autoTitle
                    || sessionDetails?.title
                    || sessionDetails?.name
                    || genreName
                    || null
                  const [relDates, jw] = await Promise.all([
                    getReleaseDates(mediaType, tmdbId, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null),
                    hasJWOffers(tmdbId, "MOVIE", preTitle, posterRegion.code, renderAbort.signal).catch(() => null),
                  ])
                  preDigital = relDates ? extractDigitalReleaseDate(relDates, posterRegion.code) : null
                  preJw = jw
                  return isDigitalPreRelease({
                    mediaType,
                    theatricalDate: releaseDate ?? mapping?.releaseDate ?? null,
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
              ? fetchAllWikidata(tmdbId, mediaType, combineAbortSignals(renderAbort.signal, wdAbort.signal), { wikidataId }).catch((): WikidataResult => ({ ...emptyWikidata, degraded: true }))
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
          if (!imdbId) {
            // F6: externalIds già in session cache (ramo non-mappato) → niente rete.
            const extIds = getTMDBSessionCache(mediaType, tmdbId, sessionLang)?.externalIds
              ?? (await getExternalIds(mediaType, tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null))
            if (extIds?.imdb_id) imdbId = extIds.imdb_id
          }
          if (!imdbId && !isMdbTmdbIdentityUsable(tmdbId, mediaType)) return false
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
              imdbId,
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
          return rankingEnabledEarly ? isImdbTop100(imdbId, renderAbort.signal) : false
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
        if (typeof avgVote === "number" && avgVote > 0) voteAverage = avgVote
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

    // Details recovery starts BEFORE the sharp resize below so a session-miss
    // fetch overlaps resize CPU instead of extending the critical path after
    // it. The promise is awaited in the luminance Promise.all; outcome and
    // field application are unchanged (the mapping TV metadata assignments
    // below overwrite unconditionally when present, the recovery guards only
    // fill nulls — final values are identical in either order).
    const needsDetailsRecovery = tmdbNetworks.length === 0 && productionCompanies.length === 0
    const detailsRecovery = needsDetailsRecovery
      ? (async () => {
        const apiKey = effTmdbKey
        const preferredLang = req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2
        // F6: anche il refetch dei dettagli TV riusa la session cache.
        // Un singolo retry sul fallimento transitorio (cold-start
        // upstream): senza dettagli saltano studio/network badge e il
        // render resta cachato così per tutto il TTL.
        const attempt = () => getDetails(mediaType, tmdbId, preferredLang, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
        const details = getTMDBSessionCache(mediaType, tmdbId, preferredLang)?.details
          ?? (await attempt())
          // Hard abort/deadline stops the retry: past the watchdog the caller
          // is already gone and a second full-cap wait only delays the zombie
          // settle (the inflight entry stays held meanwhile). The recovery
          // still settles via the first attempt (abort-fast or cache hit).
          ?? (renderAbort.signal.aborted ? null : await attempt())
        if (!details) return
        if (!releaseDate) releaseDate = details.release_date || null
        if (!firstAirDate) firstAirDate = details.first_air_date || null
        if (!lastAirDate) lastAirDate = details.last_air_date || null
        if (seasonCount == null) seasonCount = details.number_of_seasons ?? null
        if (!nextEpisodeAirDate) nextEpisodeAirDate = details.next_episode_to_air?.air_date || null
        if (numberOfEpisodes == null) numberOfEpisodes = details.number_of_episodes ?? null
        if (originCountries.length === 0) {
          originCountries = [...(details.networks || []), ...(details.production_companies || [])]
            .map((c) => c.origin_country)
            .filter((c): c is string => !!c)
        }
        if (genreIds == null && Array.isArray(details.genres)) {
          genreIds = details.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id))
        }
        if (!tvType) tvType = details.type || null
        if (!tvStatus) tvStatus = details.status || null
        if (details.networks) {
          tmdbNetworks = details.networks.map((n: TMDBCompany) => n.name)
          tmdbNetworksDetailed = details.networks.map((n: TMDBCompany) => ({ name: n.name, logoPath: n.logo_path }))
        }
        if (details.production_companies) {
          productionCompanies = details.production_companies.map((c: TMDBCompany) => c.name)
          productionCompaniesDetailed = details.production_companies.map((c: TMDBCompany) => ({ name: c.name, logoPath: c.logo_path }))
        }
        if (tmdbNetworks.length || productionCompanies.length) tmdbStudios = matchTMDBStudios([...tmdbNetworks, ...productionCompanies])
      })().catch((e: unknown) => { log.error("Details fetch failed", { error: e instanceof Error ? e.message : String(e) }) })
      : null

    // rankingResult è autoritativo: il fallback al mapping salvato avviene solo
    // su fetch fallito (nei catch sopra), MAI su miss genuina. Altrimenti un
    // titolo uscito dalla chart mostrerebbe per sempre il rank del save
    // precedente (es. "top 15" di un titolo oggi fuori top 20).
    const rankingRank = rankingResult ?? (demoSamples && rankingEnabledEarly ? DEMO_SAMPLE_RANK : null)
    // rank/label dalla query hardenata (stessa del cache key): su presets il
    // label free-text è droppato/canonicalizzato, il rank numerico resta.
    const qRank = hardenedParams.get("rank")
    const qLabel = hardenedParams.get("label")
    const finalRank = qRank !== null ? (parseInt(qRank, 10) >= 0 ? parseInt(qRank, 10) : rankingRank) : rankingRank

    // Fase 6 (observability): fine della fase fetch (mapping/defaults + TMDB +
    // JW + wikidata + immagini + selezione logo). Da qui in poi solo CPU locale.
    const tFetchMs = Date.now() - startTime

    // 6. Resize poster + compute luminance
    // Landscape: base = sfondo TMDB ritagliato sul canvas 16:9, oppure
    // pillarbox dal poster quando il titolo non ha sfondi.
    const posterBuf = isLandscape
      ? (backdropFetch
          ? await sharp(backdropFetch).resize(LAND_W, LAND_H, { fit: 'cover', position: 'centre' }).toBuffer()
          : await pillarboxLandscapeBase(baseBuf))
      : await sharp(baseBuf).resize(STD_W, STD_H, { fit: 'cover', position: 'centre' }).toBuffer()
    const qTopLight = req.nextUrl.searchParams.get("tl")
    const qBottomLight = req.nextUrl.searchParams.get("bl")

    // Custom base: hash of the URL, never the URL in the clear (and never
    // the TMDB posterPath, which does not describe the rendered bytes with a
    // custom base). Same effectiveness as the fetch above: effectiveCustomUrl
    // decides in a single place. In landscape the key prefers the effective
    // custom (query or saved) over the nominal backdropPath (with a custom
    // the TMDB path does not describe the bytes).
    const analysisKey = !isLandscape
      ? (effectiveCustomUrl
        ? customBaseAnalysisKey(effectiveCustomUrl)
        : (posterPath && !isCustomPosterUrl(posterPath) ? `portrait:poster:${posterPath}` : null))
      : backdropFetch
        ? (backdropCustomForFetch
          ? customBaseAnalysisKey(backdropCustomForFetch, "landscape")
          : (backdropPath ? `landscape:backdrop:${backdropPath}` : null))
        : (posterPath ? `landscape:pillarbox:${posterPath}` : null)

    // Apply mapping TV metadata (synchronous — no race, no side-effects in parallel closures)
    if (mapping?.tvType) tvType = mapping.tvType
    if (mapping?.tvStatus) tvStatus = mapping.tvStatus
    if (mapping?.releaseDate) releaseDate = mapping.releaseDate
    if (mapping?.firstAirDate) firstAirDate = mapping.firstAirDate

    // Luminance + optional TV details fetch (parallel, independent).
    // detailsRecovery was started above (before the sharp resize) so a
    // session-miss fetch overlaps resize CPU; awaited here with the rest.
    const [customRatings, topLum, bottomLum] = await Promise.all([
      customRatingConfig.enabled ? fetchCustomRatings(imdbId, customRatingConfig, renderAbort.signal) : Promise.resolve([]),
      (async (): Promise<number | null> => {
        if (qTopLight === "1" || qTopLight === "0" || qTopLight === "true" || qTopLight === "false") return null
        return await topLuminance(posterBuf, analysisKey)
      })(),
      (async (): Promise<number | null> => {
        if (qBottomLight === "1" || qBottomLight === "0" || qBottomLight === "true" || qBottomLight === "false") return null
        return await bottomLuminance(posterBuf, analysisKey)
      })(),
      detailsRecovery ?? Promise.resolve(),
    ])

    const topLight = (qTopLight === "1" || qTopLight === "true") ? true : (qTopLight === "0" || qTopLight === "false") ? false : (topLum ?? 0.5) > TOP_LIGHT_LUMINANCE

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
      lang: req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2,
    })
    const {
      badgeStyle, rankingBadgeStyle, qualityBadgeStyle, badgeFont,
    extraBadgeStyle,
      blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness, tintStrength, topShade, topShadeHeight,
      badgesEnabled, rankingEnabled,
      badgeGenre, badgeYear, badgeRating, badgeQuality, ageBadge, ageCountry, ageBadgeStyle, minQuality, sashOrder,
      disabledContentTags, disabledNetworks,
      separateRatings, separateRatingsStyle,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      separateBadgeScale,
      separateBadgeOffsetX, separateBadgeOffsetY,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      queryExtra, qNetLogo, networkLogo, networkLogoPosition, ribbonSide, ribbonEnabled, rankingBadgeAccent,
      networkLogoFollowTitle, networkFixedX, networkFixedY,
      preRelease, posterShape, posterLayout, posterFreshScope, logoAlign, seasonalTheme, hideLogo,
    } = renderConfig

    // Allineamento blur non-clean (Golden Rule col client): se il poster
    // finale del ramo automatico ha testo incorporato, i default globali
    // iniettati negli URL Stremio (30/50) non devono vincere sul profilo
    // non-clean (20/80) — come fa il client. Solo Stremio unmapped: mai su
    // preview (slider editor), poster esplicito o mapping (intento utente).
    let effBlurHeight = blurHeight
    let effBlurFade = blurFade
    if (!isPreview && !mapping && !queryPoster && !autoPosterClean) {
      effBlurHeight = NON_CLEAN_GRADIENT_HEIGHT
      effBlurFade = NON_CLEAN_BLUR_FADE
    }

    // Rating separati: stato display centralizzato (resolveSeparateDisplayState).
    // - colonna storica: attiva solo con badge voto visibili e almeno un
    //   valore; sostituisce il segmento ★ nel badge genere (sostituire, non
    //   sommare); senza valori → fallback media invariato (il custom provider
    //   conserva la priorità storica sulla colonna, invariata);
    // - bottom (bottom-bar/bottom-pills): attivo con badgesEnabled &&
    //   badgeRating && sep && stile bottom, INDIPENDENTE dai valori (con voti
    //   temporaneamente assenti nasconde comunque genere+anno+voto, senza
    //   inventare valori); esclude la riga custom provider (mai duplicata).
    // La soppressione è EFFETTIVA (solo render): mapping/defaults salvati
    // (bg/by/br) non mutati — tornando a column si ripristinano.
    const separateDisplay = resolveSeparateDisplayState({
      badgesEnabled,
      badgeGenre,
      badgeYear,
      badgeRating,
      separateRatings,
      separateRatingsStyle,
      sepItemCount: sepItems.length,
    })
    const useSeparate = separateDisplay.useSeparate
    const bottomActive = separateDisplay.bottomActive
    const effectiveBadgeRating = separateDisplay.effectiveBadgeRating
    const effectiveBadgeGenre = separateDisplay.effectiveBadgeGenre
    const effectiveBadgeYear = separateDisplay.effectiveBadgeYear
    // Reservation logo in bottom: geometria della colonna equivalente (stessi
    // raw flag e sepItemCount, stile `column`) così il logo titolo resta alla
    // stessa altezza anche a 0 provider o con genere/anno raw OFF. Solo
    // geometria: nessun genere/anno/media disegnato in bottom.
    const columnEquiv = bottomActive
      ? resolveSeparateDisplayState({
          badgesEnabled,
          badgeGenre,
          badgeYear,
          badgeRating,
          separateRatings,
          separateRatingsStyle: "column",
          sepItemCount: sepItems.length,
        })
      : null
    const logoBadgeVisibility = bottomActive && columnEquiv
      ? { genre: badgeGenre, year: badgeYear, rating: columnEquiv.effectiveBadgeRating }
      : undefined

    // Render degradato per timeout/errore upstream sulla qualità (solo se il
    // badge FINALE è attivo e senza override esplicito): TTL effimero 120s
    // invece di 6h/24h + niente header immutable, così Stremio riprova poco
    // dopo. Early resta solo per il gating del fetch (Block A).
    const qualityEphemeral = badgeQuality && !qQualityParam && liveQualityResult.status !== "resolved"
    // Etichetta età FINALE: solo col badge finale attivo (stessa catena del
    // gating fetch — early e finale coincidono: catena globale senza mapping)
    // E col master badge globale ON (badgesEnabled !== false, stessa
    // semantica di hasAgeBadge in poster-service: undefined = ON storico):
    // con master OFF il badge è nascosto e l'etichetta resta null (niente
    // pill, niente TTL effimero spurio). Sanificata (tetto lunghezza/charset,
    // mai testo grezzo nel badge).
    // Null = badge nascosto (disabilitato o dati assenti per il paese).
    const ageLabel = ageBadge && badgesEnabled !== false ? sanitizeAgeLabel(ageCert.label) : null
    // Stesso trattamento effimero della qualità per il degrado rete età
    // (fetch fallito a badge attivo): il poster senza pill resta in cache 2
    // minuti invece di 6h/24h. Miss genuino (ok, paese assente) = stabile.
    // Master OFF = stabile (badge già nascosto, nessun degrado da ritentare).
    const ageEphemeral = !!ageBadge && badgesEnabled !== false && !ageCert.ok
    // Stesso trattamento per Wikidata degradato (race persa, breaker, outage):
    // il poster senza premi resta in cache 2 minuti invece di 6h/24h, così un
    // miss transitorio (es. Emmy intermittente) guarisce al ricaricamento
    // senza togli/metti manuale del mapping. `degraded` assente (mock storici,
    // ramo ranking OFF deterministico) = non effimero.
    const wikidataEphemeral = wikidataResult.degraded === true || wikidataRaceTimedOut
    // Stesso trattamento per il fallback TMDB causato da custom fallito: il
    // poster senza base custom resta in cache 2 minuti invece di 6h/24h, così
    // un'origine tornata su guarisce al ricaricamento senza re-save manuale.
    // Solo fallback reale (custom richiesto ma base TMDB): custom riuscito o
    // nessun custom = TTL pieno invariato.
    const customFallbackEphemeral = !!effectiveCustomUrl && originalBase !== null && !originalBase.custom
    // Next-episode freshness: cap to 120s ONLY when the next-episode badge
    // is the EFFECTIVE displayed top badge (auto or canonical manual
    // identity). A merely eligible date that loses to rank/upcoming/awards,
    // a manual override, a disabled `new` sash bucket, or Coming Soon keeps
    // the existing TTL untouched. An elapsed manual identity shows nothing
    // (no stale date, no cap). Shared selection, no divergent chain.
    const ephemeralLocale = req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2
    const ephemeralDateFormat = parseDateFormat(hardenedParams.get("df") ?? sd.dateFormat ?? null) ?? "locale"
    const nextEpisodeEphemeral = isNextEpisodeDisplayed({
      mediaType,
      rankingEnabled,
      badgesEnabled,
      queryExtra,
      badgeInput: {
        mediaType,
        tmdbId,
        digitalReleaseDate: preDigital ?? null,
        releaseDate: releaseDate ?? null,
        firstAirDate: firstAirDate ?? null,
        lastAirDate: lastAirDate ?? null,
        seasonCount: seasonCount ?? null,
        nextEpisodeAirDate: nextEpisodeAirDate ?? null,
        numberOfEpisodes: numberOfEpisodes ?? null,
        originCountries: [...originCountries],
        genreIds: genreIds ? [...genreIds] : null,
        voteAverage: voteAverage ?? 0,
        trendRank: finalRank,
        animeRank: animeRankResult,
        awards: wikidataResult.awards,
        nominations: wikidataResult.nominations,
        studios: [...wikidataResult.studios],
        director: directorBadgeLabel(wikidataResult.director, t),
        tvType: tvType ?? null,
        tvStatus: tvStatus ?? null,
        keywords: [...tmdbKeywords],
        imdbTop250: !!imdbTop250,
        disabledContentTags: disabledContentTags ?? null,
      },
      locale: ephemeralLocale,
      sashOrder,
      dateFormat: ephemeralDateFormat,
      preRelease: !!(preRelease && preReleaseDetected),
      t,
    })
    const ephemeralTtl = qualityEphemeral || wikidataEphemeral || customFallbackEphemeral || ageEphemeral || !!nextEpisodeEphemeral
    // Task D: riassegnato sotto dal freshness cap (solo restrizione, mai estensione).
    let effectiveTtlSec: number | undefined = ephemeralTtl ? QUALITY_EPHEMERAL_TTL_SEC : dynamicTtlSec
    const effectiveImmutable = immutablePoster && !ephemeralTtl

    // Polarità del badge genere in basso: speculare a topLight, ma corretta per
    // la banda blur (che scurisce il fondo) — vedi computeBottomLight. `bl`
    // esplicito vince (preview WYSIWYG), altrimenti decide il server.
    const bottomLight = (qBottomLight === "1" || qBottomLight === "true") ? true : (qBottomLight === "0" || qBottomLight === "false") ? false : (computeBottomLight(bottomLum, blurDarkness, blurEnabled) ?? topLight)

    // Il rilevamento (`preReleaseDetected`) cambia nel tempo: non entra nella
    // cache key (verrebbe letta prima del fetch), il ritorno al poster normale
    // avviene alla scadenza del TTL (6h non-mappati, 24h mappati).
    const applyPreRelease = preRelease && preReleaseDetected

    // Database locale AV specs (prioritario per 4K e formati, zero rete):
    const localSpec = lookupAVSpecs(imdbId)
    // Soglia minima qualità all'uscita: la cache upstream (`resolveStreamQuality`)
    // tiene sempre il raw — qui si sopprime solo il badge sotto soglia.
    // Demo samples: tier dimostrativo solo quando nessuna fonte reale risolve
    // (mai formati inventati: `availableFormats` resta da localSpec reale).
    const effectiveRawQuality = qQualityParam || localSpec?.quality || liveQuality || (demoSamples && badgeQuality ? DEMO_SAMPLE_QUALITY : null)
    const finalQuality = applyMinQuality(
      effectiveRawQuality as StreamQuality | null,
      minQuality,
    )

    // Formati A/V (dv, atmos, imax, hdr, hdr10plus):
    // Sempre rigorosamente automatici basati sulle specifiche reali del film (localSpec).
    // Non vengono MAI mostrati loghi che il titolo non possiede nella realtà.
    const availableFormats = localSpec?.formats ?? []
    const qFormatsRaw = req.nextUrl.searchParams.get("formats")
    const qFormats = qFormatsRaw !== null
      ? (qFormatsRaw === "none" || qFormatsRaw === "" ? [] : (qFormatsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(isVideoFormat) as VideoFormat[]))
      : null
    const allowedFormats = earlyEffSd.videoFormats ?? sd.videoFormats
    const requestedFormats = qFormats ?? earlyEffMapping?.videoFormats ?? null

    const effectiveFormats = availableFormats.filter((f) => {
      if (requestedFormats !== null) {
        return requestedFormats.includes(f)
      }
      if (allowedFormats && allowedFormats.length > 0) {
        return allowedFormats.includes(f)
      }
      return true
    })
    const finalVideoFormats = effectiveFormats.length > 0 ? effectiveFormats : null

    const locale = req.nextUrl.searchParams.get("lang") || mapping?.language || posterRegion.lang2
    // Formato data badge "in uscita": query `df` > default utente > `locale`
    // (fail-closed: valori ignoti o assenti = comportamento storico).
    const dateFormat = parseDateFormat(hardenedParams.get("df") ?? sd.dateFormat ?? null) ?? "locale"
    // Task D — freshness cap: il poster non deve sopravvivere alla scadenza
    // reale dei fatti volatili che cuoce dentro. Solo fatti CONSUMATI:
    // ranking finale abilitato + fetch live vinto senza override da query
    // (il fallback al rank salvato è stabile, non un fatto volatile);
    // offers solo se il pre-release ha consumato il dato noto; la data
    // digitale solo se il velo dipende davvero da lei; l'upcoming solo se
    // effettivamente renderizzato. I remaining sono assoluti
    // (generation+TTL delle cache sorgente): una HIT non rinnova mai la
    // scadenza e non si fa alcun upstream extra solo per la scadenza.
    // Il cap restringe soltanto la policy (effimera/cut/jitter/scheduled):
    // il jitter deterministico non può mai estenderlo.
    const factNowMs = Date.now()
    // Snapshot-backed rank facts expire at the slot end: the published
    // snapshot is valid until the next boundary, when a refresh publishes new
    // rows. Same-slot snapshots are served even after the underlying rolling
    // source caches expire, so the cap follows the snapshot — not the source
    // caches (their remaining is only a fallback at the exact boundary).
    const snapshotSlotRemainingMs = (pin: ChartFamilyPin | null, nowMs: number): number | null => {
      if (!pin?.snapshot) return null
      const remaining = nextRomeSlotStartMs(nowMs) - nowMs
      return remaining > 0 ? remaining : null
    }
    let trendFactMs: number | null = null
    if (
      isRankFactConsumed({
        rankingEnabled,
        fetchNeeded: needTrendFetch,
        fetchWon: trendRankLive,
        rank: preTrendRank,
      })
    ) {
      if (rankingSourcePre.kind === "custom" && rankingCustomPre) {
        trendFactMs = customRankingRemainingMs(
          {
            custom: rankingCustomPre,
            slot: mediaType === "movie" ? "movie" : "series",
            apiKey: effTmdbKey,
            mdblistKey: effMdblistKey,
            tvdbKey: effTvdbKey,
            userId: scopedUser,
          },
          factNowMs,
        )
      } else {
        trendFactMs = snapshotSlotRemainingMs(trendSnapshotPin, factNowMs) ?? (
          rankingSourcePre.kind === "justwatch" &&
          (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
            ? jwTitlesRemainingMs(
              {
                objectType: mediaType === "movie" ? "MOVIE" : "SHOW",
                country: posterRegion.code,
                first: 20,
                offset: 0,
                sortBy: rankingSourcePre.mode === "popular" ? "POPULAR" : "TRENDING",
                packages: undefined,
                genres: undefined,
                monetizationTypes: [...JW_DIGITAL_MONETIZATION_TYPES],
                language: posterRegion.lang,
                overfetch: false,
              },
              factNowMs,
            )
            : jwRankingsRemainingMs(
              mediaType === "movie" ? "MOVIE" : "SHOW",
              posterRegion.code,
              20,
              undefined,
              posterRegion.lang,
              factNowMs,
            )
        )
      }
    }
    const animeFactMs = isRankFactConsumed({
      rankingEnabled,
      fetchNeeded: needAnimeFetch,
      fetchWon: animeRankLive,
      rank: preAnimeRank,
    })
      ? (snapshotSlotRemainingMs(animeSnapshotPin, factNowMs) ?? mdblistRemainingMs(animeListKey, animeKeyUsed, factNowMs))
      : null
    const offersFactMs =
      preRelease && mediaType === "movie" && preJw !== null
        ? jwAvailabilityRemainingMs("MOVIE", posterRegion.code, tmdbId, factNowMs)
        : null
    const digitalDateForCap =
      applyPreRelease && mediaType === "movie" && preJw !== true ? preDigital : null
    const upcomingLabelForCap = getUpcomingReleaseLabel({
      mediaType,
      releaseDate,
      firstAirDate,
      locale,
      dateFormat,
      t,
    })
    const upcomingDateForCap = upcomingLabelForCap
      ? (mediaType === "movie" ? releaseDate : firstAirDate)
      : null
    const factCapMs = resolvePosterFactCapMs({
      trendRankRemainingMs: trendFactMs,
      animeRankRemainingMs: animeFactMs,
      availabilityRemainingMs: offersFactMs,
      digitalReleaseDate: digitalDateForCap,
      upcomingReleaseDate: upcomingDateForCap,
      nowMs: factNowMs,
    })
    // Base di policy invariata: il cap la restringe soltanto. Senza fatti
    // consumati i rami restano byte-identici allo storico (stesso jitter per
    // i dinamici, scheduled per i mappati).
    // Task D (elapsed-render fix): factCapMs above is REMAINING at factNowMs.
    // The render below (generatePosterBuffer) takes real time, so the write
    // must recompute from the ABSOLUTE fact expiry, never reuse the stale
    // remaining — otherwise write TTL from old remaining extends fact expiry.
    const factExpiresAtMs = factCapMs !== null ? factNowMs + factCapMs : null
    // Policy base for the recompute at write time (uncapped value).
    let policyBaseMs: number | undefined
    if (ephemeralTtl) {
      policyBaseMs = QUALITY_EPHEMERAL_TTL_SEC * 1000
    } else if (dynamicCutTtlMs !== null) {
      policyBaseMs = dynamicCutTtlMs
    } else if (dynamicPoster) {
      policyBaseMs = dynamicPosterTtlMs(cacheKey)
    } else if (factCapMs !== null) {
      policyBaseMs = msUntilPosterScheduledRefresh(factNowMs)
    }
    let cappedTtlMs: number | undefined
    if (policyBaseMs !== undefined) {
      cappedTtlMs = capPosterTtlMs(policyBaseMs, factCapMs === null ? [] : [factCapMs])
    }
    // Oltre la scadenza del fatto la entry non si serve stale/SWR (byte
    // potenzialmente di un mondo cambiato): si rivalida. Solo entry con un
    // vero deadline da fatti; la policy resta SWR come prima.
    const factCappedWrite = factCapMs !== null && cappedTtlMs !== undefined
    if (cappedTtlMs !== undefined) {
      // Uncapped path preserves the historical round+max(1): fact-capped HTTP
      // uses floor at response time (see write block), never a 1s round-up
      // past the fact.
      effectiveTtlSec = factCappedWrite
        ? Math.max(0, Math.floor(cappedTtlMs / 1000))
        : Math.max(1, Math.round(cappedTtlMs / 1000))
    }
    // Normalizza i generi composti TV grezzi ("Sci-Fi & Fantasy" mai localizzato
    // in it-IT) in etichette brevi da badge — stesso helper del client, così
    // preview e poster Stremio non divergono e i mapping storici grezzi si
    // sanano senza migrazione. Idempotente.
    genreName = normalizeGenreName(genreName, locale) || null
    // Demo samples: genere/anno reali quando disponibili, fallback fissi
    // (passato deterministico: nessun badge upcoming/new) quando assenti.
    if (demoSamples) {
      if (!genreName) genreName = normalizeGenreName(DEMO_SAMPLE_GENRE, locale) || DEMO_SAMPLE_GENRE
      if (!releaseDate && !firstAirDate) {
        if (mediaType === "tv") firstAirDate = DEMO_SAMPLE_TV_DATE
        else releaseDate = DEMO_SAMPLE_MOVIE_DATE
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
    // no 304). With `netgeo=1` generation runs first and the return below
    // adds the actually rendered network geometry (single renderer source
    // for the UI freeze); plain `debug=1` stays render-free for existing
    // consumers. Normal poster responses are unchanged either way.
    const isDebug = req.nextUrl.searchParams.get("debug") === "1"
    let debugJson: Record<string, unknown> | null = null
    if (isDebug) {
      const badgeInput = {
        mediaType: mediaType as "movie" | "tv",
        tmdbId,
        digitalReleaseDate: preDigital ?? null,
        releaseDate: releaseDate ?? null,
        firstAirDate: firstAirDate ?? null,
        lastAirDate: lastAirDate ?? null,
        seasonCount: seasonCount ?? null,
        nextEpisodeAirDate: nextEpisodeAirDate ?? null,
        numberOfEpisodes: numberOfEpisodes ?? null,
        originCountries: [...originCountries],
        genreIds: genreIds ? [...genreIds] : null,
        voteAverage: voteAverage ?? 0,
        trendRank: finalRank,
        animeRank: animeRankResult,
        awards: wikidataResult.awards,
        nominations: wikidataResult.nominations,
        studios: tmdbStudios.length ? [...tmdbStudios] : [...productionCompanies, ...tmdbNetworks],
        director: directorBadgeLabel(wikidataResult.director, t),
        tvType: tvType ?? null,
        tvStatus,
        keywords: [...tmdbKeywords],
        imdbTop250: !!imdbTop250,
        disabledContentTags: disabledContentTags ?? null,
      }
      const badgeComputed = computeTopBadge(badgeInput, t, locale, sashOrder, dateFormat)
      log.info("Debug mode", { mediaType, tmdbId, imdbId, imdbTop250: !!imdbTop250, badge: badgeComputed.badge?.label ?? "null", vote: voteAverage, genre: genreName, quality: finalQuality })
      debugJson = {
        meta: {
          tmdbId,
          mediaType,
          locale,
          region: posterRegion.code,
          imdbId,
          imdbTop250: !!imdbTop250,
          renderVersion: RENDER_VERSION,
          shape: isLandscape ? "landscape" : "poster",
          mappingId: mapping ? `${mediaType}:${tmdbId}` : null,
        },
        images: {
          poster: posterPath,
          logo: logoPath,
          backdrop: backdropPath,
        },
        logoSelection: {
          requestedLang: posterRequestedLang,
          usedLang: logoChosenIso,
          fallbackReason: logoFallbackReason,
        },
        cache: {
          hit: !!cachedPoster.payload,
          stale: !!cachedPoster.payload && cachedPoster.stale,
        },
        genre: { name: genreName, year: releaseDate?.slice(0, 4) },
        vote: { average: voteAverage },
        quality: {
          value: finalQuality,
          source: liveQualityResult.source,
          status: liveQualityResult.status,
          rawTokens: liveQualityResult.rawTokens ?? [],
        },
        // Badge età: impostazioni effettive + etichetta risolta (null =
        // nascosto: disabilitato o paese senza dati; mai fallback).
        age: {
          enabled: ageBadge,
          country: ageCountry,
          style: ageBadgeStyle,
          label: ageLabel,
          degraded: ageEphemeral,
        },
        minQuality,
        preRelease: { enabled: preRelease, detected: preReleaseDetected, applied: applyPreRelease, jwAvailable: preJw, digitalDate: preDigital, theatricalDate: releaseDate ?? mapping?.releaseDate ?? null },
        rankings: {
          justwatch: rankingResult,
          anime: animeRankResult,
          finalRank,
          qRank: hardenedParams.get("rank") || null,
          qLabel,
        },
        wikidata: {
          awards: wikidataResult.awards,
          nominations: wikidataResult.nominations,
          studios: wikidataResult.studios,
          director: wikidataResult.director,
          directorLabel: directorBadgeLabel(wikidataResult.director, t),
          degraded: wikidataResult.degraded ?? false,
          timedOut: wikidataRaceTimedOut,
        },
        keywords: [...tmdbKeywords],
        badge: {
          computed: {
            badge: badgeComputed.badge,
            upcomingRelease: badgeComputed.upcomingRelease,
            awardBadge: badgeComputed.awardBadge,
            studioBadge: badgeComputed.studioBadge,
            subGenreBadge: badgeComputed.subGenreBadge,
            extraFallback: badgeComputed.extraFallback,
          },
          settings: {
            badgesEnabled,
            rankingEnabled,
            badgeStyle,
            rankingBadgeStyle,
            badgeFont,
            badgeGenre,
            badgeYear,
            badgeRating,
            badgeQuality,
            ageBadge,
            ageCountry,
            ageBadgeStyle,
            separateRatings: useSeparate,
            separateRatingsStyle,
            bottomActive,
            sashOrder,
            customBadge: queryExtra,
          },
        },
        timings: {
          fetchMs: tFetchMs,
          prepMs: Date.now() - startTime - tFetchMs,
          totalMs: Date.now() - startTime,
        },
        appearance: {
          topLight,
          bottomLight,
          blurEnabled,
          blurHeight: effBlurHeight,
          blurIntensity,
          blurFade: effBlurFade,
          blurDarkness,
          gradientHeight: effBlurHeight,
          topShade,
          topShadeHeight,
          accentColor: accentOverride?.genreColor || null,
        },
        logos: {
          scale: logoScale,
          offsetX: logoOffsetX,
          offsetY: logoOffsetY,
          networkLogo,
          networkLogoFollowTitle,
          networkFixedX: networkFixedX ?? null,
          networkFixedY: networkFixedY ?? null,
        },
        topBadge: {
          scale: topBadgeScale,
          offsetX: topBadgeOffsetX,
          offsetY: topBadgeOffsetY,
        },
        extraBadge: {
          scale: extraBadgeScale ?? null,
          offsetX: extraBadgeOffsetX ?? null,
          offsetY: extraBadgeOffsetY ?? null,
        },
        genreBadge: {
          scale: genreBadgeScale,
        },
      }
      if (!wantNetGeo) {
        completePosterRender(null)
        return Response.json(debugJson)
      }
    }

    // Fallback mapping network logo per poster salvati (quando non c'è fetch live)
    if (mapping && tmdbNetworksDetailed.length === 0 && productionCompaniesDetailed.length === 0 && (mapping.networkLogoPath || mapping.networkLogoName)) {
      const fallbackName = mapping.networkLogoName || "network"
      const fallbackPath = mapping.networkLogoPath || null
      // Non sappiamo se è network o production: mettiamo in networks per priorità
      tmdbNetworks = [fallbackName]
      tmdbNetworksDetailed = [{ name: fallbackName, logoPath: fallbackPath }]
    }

    // 10. Generate poster buffer
    // Collettore geometria network per il debug (solo numeri): in fissa è la
    // fonte del freeze senza salto; nel path normale resta inutilizzato.
    let netGeo: NetworkGeometry | null = null
    // Effective-accent collector (display sync): per-request local, filled by
    // the service's pure observer with the fills actually painted. Collected
    // on EVERY render (preview included) — the PNG no-store gate below is
    // untouched, only the ~250-byte meta is retained (sidecar + completed).
    let collectedAccentMeta: EffectiveAccentMeta | null = null
    const genInput: GenerationInput = {      // Custom values override internal sources with the same ID, preserving order.
      // In bottom il custom provider non si rende (suppressCustomRow): la
      // priorità storica della colonna resta invariata.
      ratings: customRatingConfig.enabled && !separateDisplay.suppressCustomRow ? [...new Map([...ratings, ...customRatings].map(item => [item.id, item])).values()] : undefined,
      posterBuf, logoFetch, backdropFetch: isLandscape ? null : backdropFetch,
      backdropScale, backdropOffsetX, backdropOffsetY,
      blurEnabled, blurHeight: effBlurHeight, blurIntensity, blurFade: effBlurFade, blurDarkness, tintStrength, topShade, topShadeHeight,
      badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
      rankingBadgeStyle, extraBadgeStyle, badgeFont, badgeGenre: effectiveBadgeGenre, badgeYear: effectiveBadgeYear, badgeRating: effectiveBadgeRating, badgeQuality,
      qualityBadgeStyle,
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
      topLight, bottomLight, logoBadgeVisibility, targetCenter, ribbonSide, ribbonEnabled, rankingBadgeAccent,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      separateBadgeScale,
      separateBadgeOffsetX, separateBadgeOffsetY,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      mediaType: mediaType as "movie" | "tv",
      finalRank, animeRankResult, rankingResult,
      mapping, tmdbId, digitalReleaseDate: preDigital ?? null, tmdbNetworks, productionCompanies, tmdbStudios,
      tmdbNetworksDetailed, productionCompaniesDetailed,
      tvType, tvStatus, releaseDate, firstAirDate,
      lastAirDate, seasonCount, nextEpisodeAirDate, numberOfEpisodes, originCountries, genreIds,
      wikidataResult, tmdbKeywords, locale, t,
      dateFormat,
      qLabel, queryExtra, qNetLogo, networkLogo, networkLogoPosition, sd,
      networkLogoFollowTitle, networkFixedX, networkFixedY,
      onNetworkGeometry: isDebug && wantNetGeo ? (geo) => { netGeo = geo } : undefined,
      onAccentMeta: (m) => { collectedAccentMeta = m },
      demoSamples,
      accentOverride, imdbTop250, preRelease: applyPreRelease,
      shape: posterShape,
      posterLayout,
      posterFreshScope,
      logoAlign,
      // Cornice stagionale (contesto effimero del catalogo di origine,
      // query-only via renderConfig — mai mapping/config/defaults).
      seasonalTheme,
      hideLogo,
      posterSrc: isLandscape ? backdropPath : posterPath,
      analysisKey,
      logoSrc: logoPath,
      backdropSrc: isLandscape ? null : backdropPath,
      // C3: render sempre canonico (jpeg storico, webp con
      // PICTORIUM_IMAGE_FORMAT=webp; avif solo ?fmt=avif legacy esplicito).
      format: legacyAvif ? outputFormat : canonicalFormat,
    }
    if (renderAbort.signal.aborted) {
      throw new Error("Render deadline exceeded before poster compositing")
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
      return Response.json({ ...(debugJson ?? {}), network: netGeo ?? null })
    }
    // 10. Il validatore rappresenta i byte effettivi: hash del buffer finale
    // (audit, problema 1). Rank live, rating, qualità, premi e ogni altra
    // dipendenza dinamica cambiano i byte → cambia l'ETag. Sulle cache hit il
    // confronto riusa questo ETag senza ri-renderizzare.
    etag = `"${createHash("sha256").update(composited).digest("hex")}"`
    if (customRatingConfig.enabled) {
      etag = `${etag.slice(0, -1)}:cr${hashKey(JSON.stringify(genInput.ratings))}"`
    }

    // 10. Fix stale auto ETag: include dynamic data (rank, rating) so when it re-renders, the ETag changes
    if (!mapping && !isPreview) {
      const sepSig = (useSeparate || bottomActive) ? sepItems.map((s) => `${s.id}${s.value}`).join(",") : ""
      // Rotazione dinamica: il bucket giorno entra nell'ETag così la
      // rivalidazione tra giorni non risponde mai 304 sul poster di ieri.
      const dynEtagSuffix = dynamicDayBucket !== null ? `:${dynamicDayBucket}` : ""
      etag = `${etag.slice(0, -1)}:${finalRank ?? "X"}:${imdbTop250}:${voteAverage ?? "0"}:${applyPreRelease ? "P" : "x"}:${sepSig}${dynEtagSuffix}"`
    }

    // 11. Cache + response
    // Task D (elapsed-render fix): recompute the cap from the ABSOLUTE fact
    // expiry INCLUDING generate time. cappedTtlMs above used factNowMs; the
    // composite took real milliseconds, so reuse would extend fact expiry.
    // When the deadline already elapsed: NO 1s floor extension (that would be
    // past the fact), NO cache write of stale input with a new TTL, NO global
    // invalidation and NO rerender loop — serve no-store-ish (max-age=0) once.
    // Non-positive facts never become 0->scheduled/infinite: the 0 stays an
    // explicit max-age=0 on this response, never an undefined (scheduled) TTL.
    const writeNowMs = Date.now()
    let finalTtlMs: number | undefined = cappedTtlMs
    let finalFactCapped = factCappedWrite
    let factExpiredAtWrite = false
    if (factExpiresAtMs !== null) {
      const factRemainingAtWrite = factExpiresAtMs - writeNowMs
      if (factRemainingAtWrite <= 0) {
        factExpiredAtWrite = true
        finalTtlMs = 0
        finalFactCapped = true
      } else if (policyBaseMs !== undefined) {
        // Refresh the scheduled base too when it was the policy (mapped path
        // used msUntilPosterScheduledRefresh at factNowMs).
        let freshPolicyBaseMs = policyBaseMs
        if (!dynamicPoster && dynamicCutTtlMs === null && !ephemeralTtl) {
          freshPolicyBaseMs = msUntilPosterScheduledRefresh(writeNowMs)
        }
        finalTtlMs = capPosterTtlMs(freshPolicyBaseMs, [factRemainingAtWrite])
      }
    }
    const finalTtlSec =
      finalTtlMs !== undefined
        ? finalFactCapped
          ? Math.max(0, Math.floor(finalTtlMs / 1000))
          : Math.max(1, Math.round(finalTtlMs / 1000))
        : effectiveTtlSec
    if (finalTtlMs !== undefined) {
      effectiveTtlSec = finalTtlSec
    }
    const payloadExpiresAt =
      factExpiredAtWrite
        ? writeNowMs
        : (finalFactCapped && finalTtlMs !== undefined)
          ? writeNowMs + finalTtlMs
          : undefined
    const payload: PosterCachePayload = {
      buffer: composited,
      etag,
      ttlSec: effectiveTtlSec,
      ...(payloadExpiresAt !== undefined ? { expiresAt: payloadExpiresAt } : {}),
      ...(finalFactCapped ? { factCapped: true as const } : {}),
      ...(collectedAccentMeta ? { accentMeta: collectedAccentMeta } : {}),
    }
    // Effective-accent retention (display sync): the completed record covers
    // the late preview subscriber (no-store PNG + deleted inflight). Written
    // AFTER the last success point and BEFORE completePosterRender
    // (write-then-complete), for preview AND non-preview renders alike —
    // failures/deadlines never reach here, so uncompleted renders record
    // nothing. The PNG no-store gate below is unchanged.
    if (collectedAccentMeta) recordCompletedAccent(cacheKey, collectedAccentMeta)
    // Qualità effimera (timeout/errore upstream) o Wikidata degradato: storage
    // 120s + niente immutable, così il degradato non avvelena CDN per 6h/24h.
    // Resolved (anche null) → TTL pieno invariato.
    // Le preview editor (`preview=1`) si servono no-store e non vengono
    // scritte in cache: ogni movimento di slider genererebbe una entry.
    if (!isPreview && !factExpiredAtWrite) {
      writeCachedPoster(cacheKey, payload, mappingTag, finalTtlMs !== undefined
        ? { ttlMs: finalTtlMs, immutable: effectiveImmutable, ...(finalFactCapped ? { factCapped: true as const } : {}) }
        : { immutable: effectiveImmutable })
    }
    completePosterRender(payload)
    recordPosterRequest(false, outputFormat)
    // Latency "render": the pipeline ran for this response (canonical and
    // variant renders, previews, background refreshes, revalidation renders).
    // Recorded once at terminal success — conversion encode included, failed
    // conversions excluded (they answer 500/503, never a success sample).
    // Confronto finale sul validatore della rappresentazione richiesta: una
    // rivalidazione (copia scaduta/assente + condizionale) risponde 304 solo
    // se il contenuto ri-risolto è davvero invariato (audit, problema 2).
    const responseEtag = needsVariant ? variantEtagFor(etag, outputFormat as "jpeg" | "webp") : etag
    if (isConditional && ifNoneMatch === responseEtag) {
      recordPosterLatency("render", Date.now() - startTime)
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(responseEtag, effectiveImmutable, dynamicPoster, finalTtlSec ?? effectiveTtlSec, isLive, collectedAccentMeta, finalFactCapped) })
    }
    log.info("Poster rendered", { mediaType, tmdbId, ms: Date.now() - startTime, bytes: composited.byteLength, cached: !!mappingTag, format: outputFormat, fetchMs: tFetchMs, prepMs: tCompositeStart - startTime - tFetchMs, compositeMs: Date.now() - tCompositeStart })
    // C3: il non-canonico è variante di risposta (convertita + cachata), non un render.
    // Await (not bare return): an async conversion rejection must settle
    // inside this try so the inner catch converts it to the standard
    // 500 + negative-cache response; a bare return would let it escape GET.
    if (needsVariant) return await serveResponseVariant(payload, finalTtlMs !== undefined ? { ttlMs: finalTtlMs, immutable: effectiveImmutable, ...(finalFactCapped ? { factCapped: true as const } : {}), ...(payloadExpiresAt !== undefined ? { expiresAt: payloadExpiresAt } : {}) } : { immutable: effectiveImmutable, ...(payloadExpiresAt !== undefined ? { expiresAt: payloadExpiresAt } : {}), ...(finalFactCapped ? { factCapped: true as const } : {}) }, "render")
    recordPosterLatency("render", Date.now() - startTime)
    const renderHeaders = {
      ...posterHeaders(etag, factExpiredAtWrite ? false : effectiveImmutable, isPreview, dynamicPoster, outputFormat, factExpiredAtWrite ? 0 : (finalTtlSec ?? effectiveTtlSec), isLive, collectedAccentMeta, finalFactCapped),
      "Server-Timing": serverTimingValue([
        { name: "fetch", durMs: tFetchMs },
        { name: "prep", durMs: tCompositeStart - startTime - tFetchMs },
        { name: "composite", durMs: Date.now() - tCompositeStart },
        { name: "total", durMs: Date.now() - startTime },
      ]),
    }
    return new Response(new Uint8Array(composited), { headers: renderHeaders })
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
