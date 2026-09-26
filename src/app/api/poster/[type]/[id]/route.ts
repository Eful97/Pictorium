import { NextRequest } from "next/server"
import sharp from "sharp"
import { initSharp } from "@/lib/sharp-config"
import { getImages, getDetails, getDetailsWithExternalIds, getExternalIds, getKeywords, getReleaseDates, resolveUserApiKeys, type TMDBImage, type TMDBCompany } from "@/lib/tmdb"
import { getJWRankings, hasJWOffers } from "@/lib/justwatch"
import { extractDigitalReleaseDate, isDigitalPreRelease } from "@/lib/pre-release"
import { getAll, getById, getImdbAlias } from "@/lib/store"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { verifySessionFromRequestSync } from "@/lib/pin-auth"
import { checkAdminToken } from "@/lib/auth"
import { userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang } from "@/lib/regions"
import { BEST_FIT_GLOBAL, resolveLogoFitEnabled } from "@/lib/best-fit-config"
import { selectBestLogoFitPosterPath } from "@/lib/poster-auto-fit"
import { fetchAllWikidata, matchTMDBStudios, directorBadgeLabel, isValidWikidataQid, type WikidataResult } from "@/lib/awards"
import { resolveWikidataId } from "@/lib/imdb-cache"
import { createT } from "@/lib/i18n"
import type { EnrichedAnimeItem } from "@/lib/validation"
import { fetchMDBList, type MDBListEntry } from "@/lib/mdblist"
import { fetchAggregatedRating, pickSeparateRatings, resolveRatingSources, type SeparateRating } from "@/lib/ratings"
import { isImdbTop250 } from "@/lib/imdb-top250"
import { getEffectiveRotationState, tryRotatePoster, getEffectiveBackdropRotationState, tryRotateBackdrop } from "@/lib/poster-rotation"
import { getTMDBSessionCache, setTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import { RENDER_VERSION } from "@/lib/render-version"
import { envWithFallback } from "@/lib/env-compat"
import { TOP_LIGHT_LUMINANCE } from "@/lib/constants"
import {
  RENDER_SLOT_WAIT_MS,
  acquirePosterRenderSlot,
  beginPosterRender,
  getPendingPoster,
  isImmutablePosterRequest,
  isPosterRefreshRequest,
  normalizePosterCacheParams,
  posterHeaders,
  posterNotModifiedHeaders,
  posterResponse,
  convertPosterFormat,
  variantEtagFor,
  dynamicPosterTtlSec,
  readCachedPoster,
  readPosterError,
  recordZombieRenderStart,
  schedulePosterRefresh,
  writeCachedPoster,
  writePosterError,
  recordPosterRequest,
  recordPosterError,
  recordPosterStaleHit,
  recordPosterCoalescedHit,
  recordTvdbRescue,
  recordBackdropCropRescue,
  serverTimingValue,
  resolveImageFormat,
  type PosterCachePayload,
  type PosterErrorStatus,
} from "@/lib/poster-runtime-cache"
import { hashUserFragment, userTagFragment } from "@/lib/cache"
import { hardenPosterSearchParams, isPresetsPosterMode, isPreviewAuthRequired, isPreviewDowngraded, isPublicPosterInstance } from "@/lib/poster-params-hardening"
import {
  STD_H,
  STD_W,
  fetchImg,
  hashKey,
  imgSrc,
  isValidHex,
  topLuminance,
  bottomLuminance,
} from "@/lib/poster-render-helpers"
import { computeBottomLight } from "@/lib/accent-color"
import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "@/lib/gradient-defaults"
import { LAND_W, LAND_H, landscapeBackdropUrl, pillarboxLandscapeBase, cropBackdropToPortrait } from "@/lib/image-utils"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { computeTopBadge } from "@/lib/poster-badge"

import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { getTvdbArtworks, getTvdbMovieId, getTvdbSeriesId, pickTvdbPoster } from "@/lib/tvdb"
import { validatePosterQuery } from "@/lib/validation"
import { decodeConfig } from "@/lib/config-token"
import { createLogger } from "@/lib/logger"
import { resolvePosterRenderConfig, resolvePosterShape } from "@/lib/poster-config"
import { selectBestLogo, logoBestLogoFallbackReason } from "@/lib/logo-selection"
import { resolveStreamQuality, type StreamQualityResult } from "@/lib/stream-quality"
import { applyMinQuality, type StreamQuality } from "@/lib/quality-tiers"
import { computeVote } from "@/lib/rating-weights"
import { combineAbortSignals } from "@/lib/abort-signal"
import { cachedImageBytes } from "@/lib/image-bytes-cache"
import { timedFetch } from "@/lib/outbound-stats"
import { createHash } from "node:crypto"
import { fetchCustomRatings, resolveCustomRatingConfig, type RatingItem } from "@/lib/custom-rating"

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
  let tmdbId = Number(id)
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
  for (const imgKey of ["poster", "logo", "backdrop"] as const) {
    const imgPath = req.nextUrl.searchParams.get(imgKey)
    if (imgPath) {
      try {
        imgSrc(imgPath)
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
  const sd = scopedUser ? await getServerDefaultsForUser(scopedUser) : getServerDefaults()
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const configRegion = parseRegion(configOverride?.region)
  const langParam = req.nextUrl.searchParams.get("lang") || mapping?.language
  const langRegion = langParam ? (parseRegion(langParam) ?? defaultRegionForLang(langParam)) : null
  const posterRegion = getRegionDef(qRegion ?? configRegion ?? langRegion ?? normalizeRegion(sd.region))

  // Formato canvas PRIMA della rotazione: in landscape ruota il backdrop
  // (cleanBackdrops), in portrait il poster (cleanPosters). Stessa catena
  // query > mapping > config > defaults usata dal render.
  const earlyLandscape = resolvePosterShape(req.nextUrl.searchParams, mapping, configOverride, sd) === "landscape"

  // Auto-rotate 24h: sfondi landscape o poster verticali a seconda del formato.
  let isRotating = false
  if (mapping) {
    try {
      if (earlyLandscape) {
        const backdropState = getEffectiveBackdropRotationState(mapping)
        isRotating = backdropState.isRotating
        const rotated = await tryRotateBackdrop(mapping, backdropState)
        if (rotated) mapping = rotated
      } else {
        const posterState = getEffectiveRotationState(mapping)
        isRotating = posterState.isRotating
        const rotated = await tryRotatePoster(mapping, posterState)
        if (rotated) mapping = rotated
      }
    } catch (error) {
      log.warn("Auto-rotate failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // 2. Cache key
  // Riga rating custom: il provider deve essere configurato (env) E il display
  // abilitato (catena query `cr` > mapping > config > defaults > true, come
  // bg/by/br — vedi resolvePosterRenderConfig). `cr` resta nei cacheParams e
  // `mv`/configHash coprono mapping/token, quindi niente stale.
  const qCr = req.nextUrl.searchParams.get("cr")
  const customRatingsDisplay = qCr !== null
    ? qCr !== "0"
    : (mapping?.customRatings ?? configOverride?.customRatings ?? sd.customRatings ?? true)
  const envRatingConfig = resolveCustomRatingConfig({}, sd)
  const customRatingConfig = { ...envRatingConfig, enabled: envRatingConfig.enabled && customRatingsDisplay }
  // Colonna rating separati (display) — catena: query `sep` > mapping >
  // config token > server defaults > false (stessa di `cr` sopra).
  const qSep = req.nextUrl.searchParams.get("sep")
  const sepDisplay = qSep !== null
    ? qSep !== "0"
    : (mapping?.separateRatings ?? configOverride?.separateRatings ?? sd.separateRatings ?? false)
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
    mappingCustomBadge: mapping?.customBadge ?? null,
  })
  // Preview declassata (blindatura opt-in): senza il flag la chiave resterebbe
  // separata dalle anonime — rimuovendolo condivide la entry canonica.
  if (rawPreview && !isPreview) hardenedParams.delete("preview")
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
  const cachedRank = mapping?.trendRank ?? null
  const rotateKey = isRotating
    ? (earlyLandscape ? `:bi${mapping?.cleanBackdropIndex ?? "x"}` : `:ci${mapping?.cleanPosterIndex ?? "x"}`)
    : ""
  const mapVersion = mapping?.updatedAt ? `:mu${mapping.updatedAt}` : ""
  const configHash = configOverride ? hashKey(JSON.stringify(configOverride)) : ""
  const outputFormat = resolveImageFormat(req.headers.get("accept"), req.nextUrl.searchParams.get("fmt") || req.nextUrl.searchParams.get("format"))
  // C3: render canonico jpeg (il webp è variante di risposta convertita
  // on-the-fly); solo ?fmt=avif esplicito mantiene chiave+render dedicati.
  const legacyAvif = outputFormat === "avif"
  const formatKey = legacyAvif ? ":fmtavif" : ""
  const cacheKey = `poster:v${RENDER_VERSION}:${mediaType}:${tmdbId}:reg${posterRegion.code}:r${cachedRank ?? "x"}:sd${sdHash}:${cacheParams.toString()}${rotateKey}${mapVersion}${configHash ? `:cfg${configHash}` : ""}${formatKey}`
  const variantKey = outputFormat === "webp" ? `${cacheKey}:fmtwebp` : cacheKey
  const etagBase = hashKey(`v${RENDER_VERSION}:${mediaType}:${tmdbId}:reg${posterRegion.code}:r${cachedRank ?? "x"}:sd${sdHash}:${cacheParams.toString()}${configHash ? `:${configHash}` : ""}`)
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
  // webp ha storage key propria → TTL proprio (vedi serveWebpVariant).
  const dynamicTtlSec = dynamicPoster ? dynamicPosterTtlSec(cacheKey) : undefined
  // La variante webp è un'entry separata (storage key propria) con TTL proprio.
  const variantTtlSec = dynamicPoster && outputFormat === "webp" ? dynamicPosterTtlSec(variantKey) : undefined

  // C3: risposta webp da payload canonico jpeg (cache variante o conversione).
  // opts (ttlMs/immutable) dal fresh render effimero; sulle HIT riuso record.
  const serveWebpVariant = async (canonical: PosterCachePayload, opts?: { ttlMs?: number; immutable?: boolean }): Promise<Response> => {
    const variantHit = readCachedPoster(variantKey)
    if (variantHit.payload) {
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, variantHit.ttlSec ?? variantTtlSec)
    }
    const converted = await convertPosterFormat(canonical.buffer)
    const variant: PosterCachePayload = { buffer: converted, etag: variantEtagFor(canonical.etag) }
    // Le preview editor (`preview=1`, ogni tick di slider) non sporcano lo
    // storage: la chiave le separa già, ma scrivere ogni tick è flood.
    if (!isPreview) writeCachedPoster(variantKey, variant, mappingTag, opts)
    const freshVariantTtl = opts?.ttlMs !== undefined ? Math.max(1, Math.round(opts.ttlMs / 1000)) : variantTtlSec
    return posterResponse(variant, opts?.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, freshVariantTtl)
  }

  // 3. Memory cache check
  // C3: la variante webp ha fast-path dedicato; il canonico jpeg resta il
  // fallback (conversione) quando la variante è assente/evicted.
  if (outputFormat === "webp" && !refreshRequest) {
    const variantHit = readCachedPoster(variantKey)
    if (variantHit.payload) {
      recordPosterRequest(true, outputFormat)
      if (!isPreview && req.headers.get("If-None-Match") === variantHit.payload.etag) {
        if (variantHit.stale) recordPosterStaleHit()
        log.debug("Poster cache: 304 (variant)", { mediaType, tmdbId, ms: Date.now() - startTime })
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(variantHit.payload.etag, variantHit.immutable ?? immutablePoster, dynamicPoster, variantHit.ttlSec ?? variantTtlSec) })
      }
      if (!variantHit.stale) {
        log.debug("Poster cache: fresh variant hit", { mediaType, tmdbId, ms: Date.now() - startTime })
        return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, variantHit.ttlSec ?? variantTtlSec)
      }
      recordPosterStaleHit()
      schedulePosterRefresh(req, isPreview)
      log.debug("Poster cache: stale variant hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat)
    }
  }
  const cachedPoster = readCachedPoster(cacheKey)
  if (cachedPoster.payload) {
    recordPosterRequest(true, outputFormat)
    if (!isPreview && outputFormat !== "webp" && req.headers.get("If-None-Match") === cachedPoster.payload.etag) {
      if (cachedPoster.stale) recordPosterStaleHit()
      log.debug("Poster cache: 304", { mediaType, tmdbId, ms: Date.now() - startTime })
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(cachedPoster.payload.etag, cachedPoster.immutable ?? immutablePoster, dynamicPoster, cachedPoster.ttlSec ?? dynamicTtlSec) })
    }
    if (!cachedPoster.stale) {
      log.debug("Poster cache: fresh hit", { mediaType, tmdbId, ms: Date.now() - startTime })
      if (outputFormat === "webp") return serveWebpVariant(cachedPoster.payload)
      return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedPoster.ttlSec ?? dynamicTtlSec,
        serverTimingValue([{ name: "cache", desc: "HIT" }, { name: "total", durMs: Date.now() - startTime }]))
    }
    if (!refreshRequest) {
      recordPosterStaleHit()
      schedulePosterRefresh(req, isPreview)
      log.debug("Poster cache: stale hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
      if (outputFormat === "webp") return serveWebpVariant(cachedPoster.payload)
      return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedPoster.ttlSec ?? dynamicTtlSec)
    }
  }

  const pendingPoster = getPendingPoster(cacheKey)
  if (pendingPoster) {
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
      // Finding 5: il waiter della preview deve ricevere gli header no-store
      // anche quando si coalesce con un render in flight (era hardcoded false).
      // C3: il payload condiviso è canonico jpeg — il waiter webp converte.
      if (outputFormat === "webp" && !legacyAvif) return serveWebpVariant(payload)
      return posterResponse(payload, immutablePoster, isPreview, dynamicPoster, outputFormat, dynamicTtlSec)
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
  }, RENDER_TIMEOUT_MS)
  if (typeof renderDeadline.unref === "function") renderDeadline.unref()

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
  // Lingua richiesta per artwork/logo (ramo non-mappato; default "it"):
  // serve al blocco debug=1 fuori dallo scope del ramo.
  let posterRequestedLang = "it"
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
  // Colonna rating separati: popolata dai sources aggregati dopo la race
  // (solo portrait — il gate è qui, non in poster-config che resta pura).
  let sepItems: SeparateRating[] = []
  let ratingAbort: AbortController | null = null
  let showBadges = true
  let rankingBadges = true
  let releaseDate: string | null = null
  let firstAirDate: string | null = null
  let lastAirDate: string | null = null
  let seasonCount: number | null = null
  let originCountries: string[] = []
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
  let wikidataId: string | null = null
  {
    const queryWikidataId = hardenedParams.get("wikidata_id")
    const mappingWikidataId = mapping?.wikidataId ?? null
    const sessionWikidataId = getTMDBSessionCache(mediaType, tmdbId)?.externalIds?.wikidata_id ?? null
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
  const t = createT(req.nextUrl.searchParams.get("lang") || mapping?.language || "it")

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
    // Poster non-clean (language !== null) ha già testo incorporato → mai sovrapporre logo
    const isMappingClean = mapping.language === null
    const effectiveMappingLogo = isMappingClean && !mapping.logoDisabled ? mapping.logoPath : null
    logoPath = queryLogo || effectiveMappingLogo
    if (!isMappingClean) logoPath = null
    backdropPath = queryBackdrop || mapping?.backdropPath || null
    backdropScale = mapping?.backdropScale ?? 100
    // Fix M5: clamp difensivo anche sui mapping già salvati (pre-bounds zod):
    // 0/negativi rompono resizeBackdropCached → 500 permanente.
    if (!Number.isFinite(backdropScale) || backdropScale < 5 || backdropScale > 500) backdropScale = 100
    backdropOffsetX = mapping?.backdropOffsetX ?? 0
    backdropOffsetY = mapping?.backdropOffsetY ?? 0
    genreName = mapping.genreName ?? null
    voteAverage = mapping.voteAverage ?? null
    showBadges = mapping.showBadges ?? true
    rankingBadges = mapping.rankingBadges ?? true
    // IMDb ID salvato al save (il path `tt...` vince se presente): evita il
    // fallback getExternalIds che richiede una chiave TMDB assente in Stremio.
    imdbId = imdbId ?? mapping.imdbId ?? null
    etag = `"m${etagBase}:${mapping.updatedAt}"`
    if (!customRatingConfig.enabled && req.headers.get("If-None-Match") === etag) {
      clearTimeout(renderDeadline)
      completePosterRender(null)
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(etag, immutablePoster, dynamicPoster, dynamicTtlSec) })
    }
  } else {
    const preferredLanguage = req.nextUrl.searchParams.get("lang") || "it"
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
      const sessionData = getTMDBSessionCache(mediaType, tmdbId)
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
        setTMDBSessionCache(mediaType, tmdbId, { details: det, images, externalIds: extIds })
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
      ratingAbort = imdbId ? new AbortController() : null
      aggregatedRating = imdbId
        ? fetchAggregatedRating(imdbId, effMdblistKey, ratingAbort!.signal, {
            simklKey: effSimklKey,
            tmdbId,
            mediaType,
            wantSimkl,
            wantAnilist,
            wantKitsu,
            wantImdb,
            // Voto TMDB diretto come backfill di sources.tmdb (MDBList down).
            tmdbFallbackVote: details.vote_average ?? undefined,
          }).catch(() => null)
        : Promise.resolve(null)
      genreName = details.genres[0]?.name || null
      voteAverage = details.vote_average ?? 0
      releaseDate = details.release_date || null
      firstAirDate = details.first_air_date || null
      lastAirDate = details.last_air_date || null
      seasonCount = details.number_of_seasons ?? null
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
          writePosterError(cacheKey, 503)
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
        const exact = allLogos.find((l: TMDBImage) => l.file_path === queryLogo)
        if (exact) logoPath = exact.file_path
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

      const clean = images.posters.find((p: TMDBImage) => p.iso_639_1 === null)
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
        if (logoPath && logoFitEnabled) {
          try {
            const fitStart = Date.now()
            const bestFit = await selectBestLogoFitPosterPath({
              posters: images.posters, logoPath,
              fetchImage: async (path: string) => {
                // Byte-LRU (F3): key = URL finale (imgSrc lancia su URL esterni
                // come prima, fuori dalla cache). B5: signal combinato col
                // watchdog così dopo la deadline non restano zombie.
                const url = imgSrc(path)
                return cachedImageBytes(url, async () => {
                  const res = await timedFetch(url, { signal: combineAbortSignals(renderAbort.signal, 5000) })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  return Buffer.from(await res.arrayBuffer())
                })
              },
              fetchCandidateImage: async (path: string) => {
                if (path.startsWith("http") && !path.startsWith("https://image.tmdb.org/t/p/")) {
                  throw new Error("Blocked external URL in fetchCandidateImage")
                }
                const url = path.startsWith("http") ? path : `https://image.tmdb.org/t/p/w342${path}`
                return cachedImageBytes(url, async () => {
                  const res = await timedFetch(url, { signal: combineAbortSignals(renderAbort.signal, 5000) })
                  if (!res.ok) throw new Error(`HTTP ${res.status}`)
                  return Buffer.from(await res.arrayBuffer())
                })
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
        // B1: TVDB rescue — solo senza clean TMDB, con logo e chiave TVDB
        // (gating fail-fast: niente chiave → costo zero). Il poster textless
        // TVDB salva il logo che altrimenti verrebbe droppato col fallback
        // in lingua. Solo portrait (il landscape ha già la base backdrop).
        // Fail-open: qualsiasi errore → fallback in lingua sotto.
        let tvdbRescue: string | null = null
        if (!isLandscape && logoPath && tvdbApiKey) {
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
          // stampato → mai sovrapporre il logo (stesso invariante del client:
          // buildPreviewUrl emette `logo=` solo con poster clean, e il mapping
          // forza logoPath=null sui non-clean).
          const langPoster = images.posters.find((p: TMDBImage) => p.iso_639_1 === preferredLanguage)
          const origPoster = details.original_language ? images.posters.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
          const chosen = langPoster || origPoster || images.posters[0]
          if (chosen) posterPath = chosen.file_path
          logoPath = null
          logoPathBuffer = null
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
      const fbLang = req.nextUrl.searchParams.get("lang") || mapping?.language || "it"
      const cached = getTMDBSessionCache(mediaType, tmdbId)
      let fbDetails = cached?.details
      if (!fbDetails) {
        fbDetails = await getDetails(mediaType, tmdbId, fbLang, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS)
        const prev = getTMDBSessionCache(mediaType, tmdbId)
        setTMDBSessionCache(mediaType, tmdbId, { ...prev ?? undefined, details: fbDetails })
      }
      autoBackdropPath = fbDetails?.backdrop_path || null
      if (!autoBackdropPath) {
        const fbImages = cached?.images
          ?? await getImages(mediaType, tmdbId, `${fbLang},en,null`, fbApiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
        if (fbImages && !cached?.images) {
          const prev = getTMDBSessionCache(mediaType, tmdbId)
          setTMDBSessionCache(mediaType, tmdbId, { ...prev ?? undefined, images: fbImages })
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
        writePosterError(cacheKey, 503)
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
        writePosterError(cacheKey, 503)
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
    const rankingEnabledEarly = hasQueryEarly ? (qRankingEarly !== null ? qRankingEarly !== "0" : rankingBadges) : true
    const badgeQualityEarly = qBqEarly !== null ? qBqEarly !== "0" : (mapping?.badgeQuality ?? configOverride?.badgeQuality ?? sd.badgeQuality ?? true)
    // Flag pre-digitale per il fetch condizionato: query `pre` > config token
    // > server defaults > false (stessa catena di poster-config, senza mapping).
    const qPreEarly = req.nextUrl.searchParams.get("pre")
    const preReleaseEnabledEarly = qPreEarly !== null ? qPreEarly !== "0" : (configOverride?.preRelease ?? sd.preRelease ?? false)
    // Segnali grezzi del rilevamento pre-digitale (solo debug=1).
    let preJw: boolean | null = null
    let preDigital: string | null = null
    // Rank anime inviato dal client nella preview WYSIWYG (override del fetch).
    const qAnimeRankParam = hardenedParams.get("animerank")
    const qAnimeRank = qAnimeRankParam ? Number(qAnimeRankParam) : NaN

    // Quarto anello QID (mapping legacy senza wikidataId salvato): una
    // external_ids con memo 7gg invece della lotteria SPARQL — il REST diventa
    // il default anche per Stremio. Solo con ranking ON e chiave TMDB (senza
    // chiave o a fetch fallito il QID resta null e vale lo SPARQL invariato);
    // tetto 1500ms per non tassare il render a freddo oltre la race da 2.5s.
    if (!wikidataId && rankingEnabledEarly && effTmdbKey) {
      wikidataId = await resolveWikidataId(mediaType, tmdbId, effTmdbKey, 1500)
    }

    // 5. Fetch all data in parallel: images + rankings + quality + wikidata + keywords + imdbTop250
    //    All dependencies are available before this point — no Block B depends on Block A
    const emptyWikidata = { awards: [], nominations: [], studios: [], director: null }
    const WIKIDATA_TIMEOUT = Number(process.env.WIKIDATA_TIMEOUT) || 2500
    // Esito temporale della race Wikidata, per debug=1 e TTL effimero: la
    // degraded del risultato copre i fallimenti strutturali, questa il timeout.
    let wikidataRaceTimedOut = false
    const [
      [originalBuf, logoFetch, backdropFetch, rankingResult, animeRankResult, rawLiveQuality, preReleaseDetected],
      [wikidataResult, tmdbKeywords, imdbTop250],
    ] = await Promise.all([
      // Block A: images + ranking data + quality
      Promise.all([
        posterPathBuffer
          ? Promise.resolve(posterPathBuffer)
          : fetchImg(imgSrc(posterPath), renderAbort.signal).catch(() => null),
        logoPathBuffer
          ? Promise.resolve(logoPathBuffer)
          : logoPath ? fetchImg(imgSrc(logoPath, "original"), renderAbort.signal).catch(() => null) : Promise.resolve(null),
        backdropPath ? fetchImg(isLandscape ? landscapeBackdropUrl(backdropPath) : imgSrc(backdropPath), renderAbort.signal).catch(() => null) : Promise.resolve(null),
        rankingEnabledEarly
          // R3: signal del watchdog — allo scatto della deadline il fetch
          // abortisce invece di proseguire come zombie in background.
          ? getJWRankings(mediaType === "movie" ? "MOVIE" : "SHOW", posterRegion.code, 20, undefined, posterRegion.lang, renderAbort.signal)
            .then((r) => r.find((x) => x.tmdbId === tmdbId)?.rank ?? null)
            // Solo il FETCH FALLITO (rete/outage) ripiega sul rank salvato nel
            // mapping (degraded esplicito). La miss genuina (fetch riuscito, il
            // titolo è fuori chart) resta null: MAI resuscitare il rank stantio
            // del save precedente (es. "top 15" di un titolo oggi fuori top 20).
            .catch(() => mapping?.badgeRank ?? mapping?.trendRank ?? null)
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
          ? (Number.isFinite(qAnimeRank) && qAnimeRank > 0
              ? Promise.resolve(qAnimeRank)
              : fetchMDBList(
                  mediaType === "movie" ? "mdblistAnimeMovie" : "mdblistAnime",
                  // Namespace incluso via effMdblistKey; coda env allargata
                  // storica di questo sito (MDBLIST_KEY/MDBLIST_API_KEY).
                  effMdblistKey || envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_KEY || process.env.MDBLIST_API_KEY || undefined,
                  renderAbort.signal
                )
                  .then((entries) => {
                    // Shape inattesa → come failure: fallback al salvato.
                    if (!Array.isArray(entries)) return mapping?.animeRank ?? null
                    const idx = entries.findIndex((e) => {
                      const entry = e as MDBListEntry
                      const animeId = Number(entry.tmdb) || Number((entry as unknown as EnrichedAnimeItem).id)
                      return animeId === tmdbId
                    })
                    return idx >= 0 ? idx + 1 : null
                  })
                  .catch(() => mapping?.animeRank ?? null))
          : Promise.resolve(null),
        (badgeQualityEarly)
          ? (qQualityParam
              ? Promise.resolve(qQualityParam)
              : (() => {
                  const sessionTitle = getTMDBSessionCache(mediaType, tmdbId)?.details?.title
                    || getTMDBSessionCache(mediaType, tmdbId)?.details?.name
                    || null
                  const fallbackTitle = mapping?.title || hardenedParams.get("title") || autoTitle || sessionTitle || genreName || null
                  const effSeasonCount = seasonCount ?? getTMDBSessionCache(mediaType, tmdbId)?.details?.number_of_seasons ?? null
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
                  const sessionDetails = getTMDBSessionCache(mediaType, tmdbId)?.details
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
          // La colonna separati (solo portrait) richiede gli stessi aggregated
          // dei custom rating: senza, preview e poster mappati non avrebbero
          // mai i sources (desync WYSIWYG).
          const sepFetch = sepDisplay && !isLandscape
          if (!rankingEnabledEarly && !customRatingConfig.enabled && !sepFetch) return false
          if (!imdbId) {
            // F6: externalIds già in session cache (ramo non-mappato) → niente rete.
            const extIds = getTMDBSessionCache(mediaType, tmdbId)?.externalIds
              ?? (await getExternalIds(mediaType, tmdbId, effTmdbKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null))
            if (extIds?.imdb_id) imdbId = extIds.imdb_id
          }
          if (!imdbId) return false
          if ((customRatingConfig.enabled || sepFetch) && !aggregatedRating) {
            // Saved/query posters need source data only; keep their legacy vote intact.
            multiRatingOnly = true
            ratingAbort = new AbortController()
            const wantSimkl = reqRatingSources.includes("simkl") && !!effSimklKey
            const wantAnilist = reqRatingSources.includes("anilist")
            const wantKitsu = reqRatingSources.includes("kitsu")
            const wantImdb = reqRatingSources.includes("imdb")
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
              },
            ).catch(() => null)
          }
          return rankingEnabledEarly ? isImdbTop250(imdbId, renderAbort.signal) : false
        })(),
      ]),
    ])

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
    if (aggregatedRating) {
      // Fix L3: timer della race RATING_WAIT cancellato se vince il fetch.
      let ratingTimer: ReturnType<typeof setTimeout> | undefined
      const ratingTimeout = new Promise<Awaited<ReturnType<typeof fetchAggregatedRating>>>((resolve) => {
        ratingTimer = setTimeout(() => resolve(null), RATING_WAIT_MS)
      })
      const aggregated = await Promise.race([aggregatedRating, ratingTimeout])
      if (ratingTimer) clearTimeout(ratingTimer)
      const imdbRating = aggregated?.sources.imdb
      if (customRatingConfig.enabled && typeof imdbRating === "number" && Number.isFinite(imdbRating) && imdbRating > 0 && imdbRating <= 10) {
        ratings.push({ id: "imdb", name: "IMDb", value: imdbRating, format: "decimal" })
      }
      if (!multiRatingOnly) {
        const avgVote = computeVote(aggregated, reqRatingSources)
        if (typeof avgVote === "number" && avgVote > 0) voteAverage = avgVote
      }
      // Colonna separati: dai sources aggregati (anche con media skippata via
      // multiRatingOnly — i sources servono comunque). Vuoto → fallback media.
      if (sepDisplay && !isLandscape) sepItems = pickSeparateRatings(aggregated, reqRatingSources)
      ratingAbort?.abort()
    }

    // Base effettiva: portrait = poster; landscape = sfondo TMDB o, in sua
    // assenza, pillarbox ricavato dal poster (vedi sotto).
    const baseBuf = isLandscape ? (backdropFetch ?? originalBuf) : originalBuf
    if (!baseBuf) {
      // Deadline sforato → 503 con negative cache: il fetch dell'immagine è
      // stato abortito dal watchdog, non è un titolo inesistente.
      if (deadlineFired) {
        writePosterError(cacheKey, 503)
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
    const rankingRank = rankingResult
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

    // Apply mapping TV metadata (synchronous — no race, no side-effects in parallel closures)
    if (mapping?.tvType) tvType = mapping.tvType
    if (mapping?.tvStatus) tvStatus = mapping.tvStatus
    if (mapping?.releaseDate) releaseDate = mapping.releaseDate
    if (mapping?.firstAirDate) firstAirDate = mapping.firstAirDate

    // Luminance + optional TV details fetch (parallel, independent)
    const [customRatings, topLum, bottomLum] = await Promise.all([
      customRatingConfig.enabled ? fetchCustomRatings(imdbId, customRatingConfig, renderAbort.signal) : Promise.resolve([]),
      (async (): Promise<number | null> => {
        if (qTopLight === "1" || qTopLight === "0" || qTopLight === "true" || qTopLight === "false") return null
        return await topLuminance(posterBuf)
      })(),
      (async (): Promise<number | null> => {
        if (qBottomLight === "1" || qBottomLight === "0" || qBottomLight === "true" || qBottomLight === "false") return null
        return await bottomLuminance(posterBuf)
      })(),
      (tmdbNetworks.length === 0 && productionCompanies.length === 0)
          ? (async () => {
            const apiKey = effTmdbKey
            const preferredLang = req.nextUrl.searchParams.get("lang") || mapping?.language || "it"
            // F6: anche il refetch dei dettagli TV riusa la session cache.
            // Un singolo retry sul fallimento transitorio (cold-start
            // upstream): senza dettagli saltano studio/network badge e il
            // render resta cachato così per tutto il TTL.
            const details = getTMDBSessionCache(mediaType, tmdbId)?.details
              ?? (await getDetails(mediaType, tmdbId, preferredLang, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null))
              ?? (await getDetails(mediaType, tmdbId, preferredLang, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null))
            if (!details) return
            if (!releaseDate) releaseDate = details.release_date || null
            if (!firstAirDate) firstAirDate = details.first_air_date || null
            if (!lastAirDate) lastAirDate = details.last_air_date || null
            if (seasonCount == null) seasonCount = details.number_of_seasons ?? null
            if (originCountries.length === 0) {
              originCountries = [...(details.networks || []), ...(details.production_companies || [])]
                .map((c) => c.origin_country)
                .filter((c): c is string => !!c)
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
        : Promise.resolve(),
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
      // Fix L32: lingua per la risoluzione delle label prefissate (__badge.*).
      lang: req.nextUrl.searchParams.get("lang") || mapping?.language || "it",
    })
    const {
      badgeStyle, rankingBadgeStyle,
      blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness, tintStrength,
      badgesEnabled, rankingEnabled,
      badgeGenre, badgeYear, badgeRating, badgeQuality, minQuality, sashOrder,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      queryExtra, qNetLogo, networkLogo, ribbonSide,
      preRelease, posterShape, logoAlign, hideLogo,
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

    // Colonna rating separati attiva solo con badge voto visibili e almeno un
    // valore: sostituisce il segmento ★ nel badge genere (sostituire, non
    // sommare). Senza valori → fallback media invariato.
    const useSeparate = badgesEnabled && badgeRating && sepItems.length > 0
    const effectiveBadgeRating = badgeRating && !useSeparate

    // Render degradato per timeout/errore upstream sulla qualità (solo se il
    // badge FINALE è attivo e senza override esplicito): TTL effimero 120s
    // invece di 6h/24h + niente header immutable, così Stremio riprova poco
    // dopo. Early resta solo per il gating del fetch (Block A).
    const qualityEphemeral = badgeQuality && !qQualityParam && liveQualityResult.status !== "resolved"
    // Stesso trattamento per Wikidata degradato (race persa, breaker, outage):
    // il poster senza premi resta in cache 2 minuti invece di 6h/24h, così un
    // miss transitorio (es. Emmy intermittente) guarisce al ricaricamento
    // senza togli/metti manuale del mapping. `degraded` assente (mock storici,
    // ramo ranking OFF deterministico) = non effimero.
    const wikidataEphemeral = wikidataResult.degraded === true || wikidataRaceTimedOut
    const ephemeralTtl = qualityEphemeral || wikidataEphemeral
    const effectiveTtlSec = ephemeralTtl ? QUALITY_EPHEMERAL_TTL_SEC : dynamicTtlSec
    const effectiveImmutable = immutablePoster && !ephemeralTtl

    // Polarità del badge genere in basso: speculare a topLight, ma corretta per
    // la banda blur (che scurisce il fondo) — vedi computeBottomLight. `bl`
    // esplicito vince (preview WYSIWYG), altrimenti decide il server.
    const bottomLight = (qBottomLight === "1" || qBottomLight === "true") ? true : (qBottomLight === "0" || qBottomLight === "false") ? false : (computeBottomLight(bottomLum, blurDarkness, blurEnabled) ?? topLight)

    // Il rilevamento (`preReleaseDetected`) cambia nel tempo: non entra nella
    // cache key (verrebbe letta prima del fetch), il ritorno al poster normale
    // avviene alla scadenza del TTL (6h non-mappati, 24h mappati).
    const applyPreRelease = preRelease && preReleaseDetected

    // Soglia minima qualità all'uscita: la cache upstream (`resolveStreamQuality`)
    // tiene sempre il raw — qui si sopprime solo il badge sotto soglia.
    const finalQuality = applyMinQuality(
      (qQualityParam || liveQuality || null) as StreamQuality | null,
      minQuality,
    )

    const locale = req.nextUrl.searchParams.get("lang") || mapping?.language || "it"
    const targetCenter = Math.round(30 * (isLandscape ? LAND_H : STD_H) / 570)

    // 8. Pre-resolve accent color override
    const qAc = hardenedParams.get("ac")
    const accentOverride = (qAc && isValidHex(qAc))
      ? { genreColor: qAc, rankColor: qAc }
      : mapping?.accentColor
        ? { genreColor: mapping.accentColor, rankColor: mapping.accentColor }
        : null

    // 9. Debug mode — return JSON with all computed data instead of rendering
    const isDebug = req.nextUrl.searchParams.get("debug") === "1"
    if (isDebug) {
      const badgeInput = {
        mediaType: mediaType as "movie" | "tv",
        releaseDate: releaseDate ?? null,
        firstAirDate: firstAirDate ?? null,
        lastAirDate: lastAirDate ?? null,
        seasonCount: seasonCount ?? null,
        originCountries: [...originCountries],
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
      }
      const badgeComputed = computeTopBadge(badgeInput, t, locale, sashOrder)
      log.info("Debug mode", { mediaType, tmdbId, imdbId, imdbTop250: !!imdbTop250, badge: badgeComputed.badge?.label ?? "null", vote: voteAverage, genre: genreName, quality: finalQuality })
      completePosterRender(null)
      return Response.json({
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
            badgeGenre,
            badgeYear,
            badgeRating,
            badgeQuality,
            separateRatings: useSeparate,
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
          accentColor: accentOverride?.genreColor || null,
        },
        logos: {
          scale: logoScale,
          offsetX: logoOffsetX,
          offsetY: logoOffsetY,
          networkLogo,
        },
        topBadge: {
          scale: topBadgeScale,
          offsetX: topBadgeOffsetX,
          offsetY: topBadgeOffsetY,
        },
        genreBadge: {
          scale: genreBadgeScale,
        },
      })
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
    const genInput: GenerationInput = {
      // Custom values override internal sources with the same ID, preserving order.
      ratings: customRatingConfig.enabled ? [...new Map([...ratings, ...customRatings].map(item => [item.id, item])).values()] : undefined,
      posterBuf, logoFetch, backdropFetch: isLandscape ? null : backdropFetch,
      backdropScale, backdropOffsetX, backdropOffsetY,
      blurEnabled, blurHeight: effBlurHeight, blurIntensity, blurFade: effBlurFade, blurDarkness, tintStrength,
      badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
      rankingBadgeStyle, badgeGenre, badgeYear, badgeRating: effectiveBadgeRating, badgeQuality,
      separateRatings: useSeparate ? sepItems : undefined,
      sashOrder,
      quality: finalQuality,
      topLight, bottomLight, targetCenter, ribbonSide,
      logoScale, logoOffsetX, logoOffsetY,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
      genreBadgeScale, qualityBadgeScale, networkLogoScale,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      mediaType: mediaType as "movie" | "tv",
      finalRank, animeRankResult, rankingResult,
      mapping, tmdbNetworks, productionCompanies, tmdbStudios,
      tmdbNetworksDetailed, productionCompaniesDetailed,
      tvType, tvStatus, releaseDate, firstAirDate,
      lastAirDate, seasonCount, originCountries,
      wikidataResult, tmdbKeywords, locale, t,
      qLabel, queryExtra, qNetLogo, networkLogo, sd,
      accentOverride, imdbTop250, preRelease: applyPreRelease,
      shape: posterShape,
      logoAlign,
      hideLogo,
      posterSrc: isLandscape ? backdropPath : posterPath,
      logoSrc: logoPath,
      backdropSrc: isLandscape ? null : backdropPath,
      // C3: render sempre canonico jpeg (tranne ?fmt=avif legacy esplicito).
      format: legacyAvif ? outputFormat : "jpeg",
    }
    if (renderAbort.signal.aborted) {
      throw new Error("Render deadline exceeded before poster compositing")
    }
    // Fine della fase prep (resize, config, accent): da qui solo composite CPU.
    const tCompositeStart = Date.now()
    const composited = await generatePosterBuffer(genInput)
    if (customRatingConfig.enabled) {
      etag = `${etag.slice(0, -1)}:cr${hashKey(JSON.stringify(genInput.ratings))}"`
    }

    // 10. Fix stale auto ETag: include dynamic data (rank, rating) so when it re-renders, the ETag changes
    if (!mapping && !isPreview) {
      const sepSig = useSeparate ? sepItems.map((s) => `${s.id}${s.value}`).join(",") : ""
      etag = `${etag.slice(0, -1)}:${finalRank ?? "X"}:${imdbTop250}:${voteAverage ?? "0"}:${applyPreRelease ? "P" : "x"}:${sepSig}"`
    }

    // 11. Cache + response
    const payload = { buffer: composited, etag }
    // Qualità effimera (timeout/errore upstream) o Wikidata degradato: storage
    // 120s + niente immutable, così il degradato non avvelena CDN per 6h/24h.
    // Resolved (anche null) → TTL pieno invariato.
    // Le preview editor (`preview=1`) si servono no-store e non vengono
    // scritte in cache: ogni movimento di slider genererebbe una entry.
    if (!isPreview) {
      writeCachedPoster(cacheKey, payload, mappingTag, ephemeralTtl
        ? { ttlMs: QUALITY_EPHEMERAL_TTL_SEC * 1000, immutable: false }
        : { immutable: immutablePoster })
    }
    completePosterRender(payload)
    recordPosterRequest(false, outputFormat)
    // Enabled enrichment must revalidate against the final state, including [].
    const responseEtag = outputFormat === "webp" ? variantEtagFor(etag) : etag
    if (customRatingConfig.enabled && !isPreview && req.headers.get("If-None-Match") === responseEtag) {
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(responseEtag, effectiveImmutable, dynamicPoster, effectiveTtlSec) })
    }
    log.info("Poster rendered", { mediaType, tmdbId, ms: Date.now() - startTime, bytes: composited.byteLength, cached: !!mappingTag, format: outputFormat, fetchMs: tFetchMs, prepMs: tCompositeStart - startTime - tFetchMs, compositeMs: Date.now() - tCompositeStart })
    // C3: il webp è variante di risposta (convertita + cachata), non un render.
    if (outputFormat === "webp") return serveWebpVariant(payload, ephemeralTtl ? { ttlMs: QUALITY_EPHEMERAL_TTL_SEC * 1000, immutable: false } : { immutable: immutablePoster })
    const renderHeaders = {
      ...posterHeaders(etag, effectiveImmutable, isPreview, dynamicPoster, outputFormat, effectiveTtlSec),
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
    recordPosterError()
    // Deadline sforato: il render è stato abbandonato dal watchdog perché
    // troppo lento → 503 (con negative cache) invece di un 500 generico.
    if (deadlineFired) {
      writePosterError(cacheKey, 503)
      log.error("Poster generation failed (render deadline exceeded)", { error: e instanceof Error ? e.message : String(e) })
      return posterErrorResponse(503)
    }
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
}
