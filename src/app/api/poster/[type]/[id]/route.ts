import { NextRequest } from "next/server"

import { hydratePosterFromDisk } from "@/lib/poster-disk-cache"

import { initSharp } from "@/lib/sharp-config"

import { getImages, getDetails, type TMDBCompany } from "@/lib/tmdb"
import { jwAvailabilityRemainingMs, jwRankingsRemainingMs, jwTitlesRemainingMs, JW_DIGITAL_MONETIZATION_TYPES } from "@/lib/justwatch"
import { customRankingRemainingMs } from "@/lib/custom-ranking"

import { getById } from "@/lib/store"

import { getServerDefaultsForUser, getServerDefaultsChecked, effectiveDefaultsForShape, pickVisualDefaults } from "@/lib/server-defaults"

import { effectiveMappingForShape } from "@/lib/types"

import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang } from "@/lib/regions"

import { chartSlotEndMs, familySlotEndMs, type ChartFamilyPin } from "@/lib/chart-generation"

import { addonRankingRemainingMs } from "@/lib/addon-ranking"

import { matchTMDBStudios, directorBadgeLabel, isValidWikidataQid } from "@/lib/awards"
import { createT } from "@/lib/i18n-server"

import { mdblistRemainingMs } from "@/lib/mdblist"

import { fetchAggregatedRating, pickSeparateRatings, resolveRatingSources, type SeparateRating } from "@/lib/ratings"
import { getEffectiveRotationState, tryRotatePoster, getEffectiveBackdropRotationState, tryRotateBackdrop, getDynamicRotationBucket, secondsUntilDynamicRotationCut } from "@/lib/poster-rotation"
import { getTMDBSessionCache, setTMDBSessionCache } from "@/lib/tmdb-session-cache"

import { mappingVersionParam } from "@/lib/stremio-poster-url"

import { RENDER_VERSION } from "@/lib/render-version"

import { TOP_LIGHT_LUMINANCE } from "@/lib/constants"

import {
  RENDER_SLOT_WAIT_MS,
  acquirePosterFetchSlot,
  acquirePosterRenderSlot,
  beginPosterRender,
  getPendingPoster,
  isImmutablePosterRequest,
  isLivePosterRequest,
  isPosterRefreshRequest,
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
  writeCachedPoster,
  writePosterError,
  recordPosterRequest,
  recordPosterError,
  recordPosterCoalescedHit,
  recordPosterLatency,
  recordBackdropCropRescue,
  serverTimingValue,
  resolveImageFormat,
  DEFAULT_IMAGE_FORMAT,
  httpRemainingSec,
  payloadHttpRemainingSec,
  type PosterCachePayload,
} from "@/lib/poster-runtime-cache"

import { capPosterTtlMs, isPreReleaseDetectionUndecided, isRankFactConsumed, resolvePosterFactCapMs } from "@/lib/poster-freshness"

import { sanitizeEffectiveAccentMeta, type EffectiveAccentMeta } from "@/lib/effective-accent"

import { msUntilPosterScheduledRefresh, userTagFragment } from "@/lib/cache"

import { FormatOverloadError, runFormatConversion } from "@/lib/poster-format-gate"

import { canonicalPosterLang, canonicalPosterQuality, resolveFinalRankWithListContext, sanitizePortraitBaseBackdropPath } from "@/lib/poster-params-hardening"

import { DEMO_SAMPLE_AGE_LABEL, DEMO_SAMPLE_GENRE, DEMO_SAMPLE_MOVIE_DATE, DEMO_SAMPLE_QUALITY, DEMO_SAMPLE_RANK, DEMO_SAMPLE_TV_DATE, mergeDemoSampleRatings, sampleDemoVideoFormats } from "@/lib/demo-samples"

import {
  STD_H,
  fetchImg,
  hashKey,
  isValidHex,
  topLuminance,
  bottomLuminance,
} from "@/lib/poster-render-helpers"
import { computeBottomLight } from "@/lib/accent-color"

import { normalizeGenreName } from "@/lib/genre-normalize"

import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "@/lib/gradient-defaults"

import { LAND_H, landscapeBackdropUrl, pillarboxLandscapeBase, cropBackdropToPortrait, fitPortraitBase, fitLandscapeBase } from "@/lib/image-utils"

import { generatePosterBuffer, type GenerationInput, type NetworkGeometry, type BadgeGeometryReport } from "@/lib/poster-service"

import { isNextEpisodeDisplayed } from "@/lib/poster-badge"

import { getUpcomingReleaseLabel, parseDateFormat } from "@/lib/release-badge"

import { customBaseAnalysisKey } from "@/lib/custom-poster-base"
import { isCustomPosterUrl } from "@/lib/utils"


import { createLogger } from "@/lib/logger"

import { resolvePosterRenderConfig, resolvePosterShape, resolveSeparateRatingsEnabled, resolveSeparateDisplayState } from "@/lib/poster-config"
import { resolveAutoWordmark, resolveTextLogo } from "@/lib/text-logo"
import { type StreamQualityResult } from "@/lib/stream-quality"
import { applyMinQuality, type StreamQuality } from "@/lib/quality-tiers"

import { lookupAVSpecs } from "@/lib/av-specs"

import { isQualityMarkId } from "@/lib/quality-badge-pack"

import { resolveEffectiveQualityMarks } from "@/lib/quality-marks-selection"

import { computeVote } from "@/lib/rating-weights"

import { createHash } from "node:crypto"

import { fetchCustomRatings, resolveCustomRatingConfig, type RatingItem } from "@/lib/custom-rating"

import { sanitizeAgeLabel } from "@/lib/certification"
import {
  PosterCacheLookupContext,
  buildPosterCacheParams,
  checkPosterCanonicalCache,
  checkPosterNegativeCache,
  checkPosterVariantFastPath,
  corsHeaders,
  posterErrorResponse,
} from "./phases"

import { admitPosterRequest } from "./admission"

import { POSTER_TMDB_TIMEOUT_MS, RATING_WAIT_MS, RENDER_TIMEOUT_MS } from "./constants"

import { runRankingPreflight } from "./ranking-preflight"

import { buildPosterDebugJson } from "./debug"

import { fetchRenderData } from "./fetch-render-data"

import type { PosterArtwork, PosterTitleMeta } from "./sources"

import { resolveAutoSources, resolveMappingSources, resolveQuerySources, type SourceResolutionContext } from "./resolve-sources"


// Vercel: limite massimo di esecuzione della funzione. Il render poster ha un
// deadline interno di 30s (PICTORIUM_RENDER_TIMEOUT_MS) → 40s copre il caso
// peggiore. Su Hobby Vercel impone comunque 10s; su Pro vale questo valore.
export const maxDuration = 40

const log = createLogger("poster")

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

  // 1. Get mapping + server defaults (no network)
  // (`scopedUser` già risolto sopra: serve anche al ramo tt e alle chiavi.)
  // Le due letture sono indipendenti (mapping per titolo vs defaults di
  // spazio): partono insieme invece di sommare due attese seriali. Lettura
  // revisionata via epoch: dopo un save su un'altra istanza, l'epoch avanzata
  // invalida i default in memoria (finestra residua = 500ms di cache lettura
  // epoch, mai i 5min del TTL defaults).
  const [mappingRow, sdRow] = await Promise.all([
    getById(mediaType, tmdbId, scopedUser),
    scopedUser ? getServerDefaultsForUser(scopedUser) : getServerDefaultsChecked(),
  ])
  let mapping = mappingRow
  const sd = sdRow
  // Automazioni globali (solo default/space, mai per-titolo o per-forma):
  // catena config token > server defaults > ON. La chiave assente significa ON,
  // quindi spazi esistenti e vecchi config token restano byte-identici.
  const portraitBackdropFallback = configOverride?.portraitBackdropFallback ?? sd.portraitBackdropFallback ?? true
  const autoWordmarkEnabled = configOverride?.autoWordmark ?? sd.autoWordmark ?? true
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const configRegion = parseRegion(configOverride?.region)
  // `quality`/`lang` canonical values: the SAME value feeds the cache key
  // (synced into `hardenedParams` below) and every read in the render, so a
  // garbage value can neither mint a distinct entry nor repaint the canonical
  // one. Non-canonical = absent = the pre-existing fallback chain.
  const canonicalQuality = canonicalPosterQuality(req.nextUrl.searchParams.get("quality"))
  const canonicalLang = canonicalPosterLang(req.nextUrl.searchParams.get("lang"))
  const langParam = canonicalLang || mapping?.language
  const langRegion = langParam ? (parseRegion(langParam) ?? defaultRegionForLang(langParam)) : null
  const posterRegion = getRegionDef(qRegion ?? configRegion ?? langRegion ?? normalizeRegion(sd.region))
  // "My language" for the portrait 24h rotation: the SAME canonical chain the
  // render/UI use (`?lang=` > saved mapping language > region language), never
  // a new setting. Only filters the opted-in non-clean rotation posters; the
  // clean pool is language-independent.
  const rotationSelectedLang = canonicalLang || mapping?.language || posterRegion.lang2

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
        // Per-title flag wins; null/absent inherits the space default
        // (config token > server defaults > OFF), mirroring the editor's
        // `mapping.autoRotateClean ?? defaultAutoRotateClean` resolution.
        // Saved explicit true/false keeps the historical behavior.
        const posterState = getEffectiveRotationState(
          mapping,
          rotationSelectedLang,
          configOverride?.autoRotateClean ?? sd.autoRotateClean ?? false,
        )
        isRotating = posterState.isRotating
        const rotated = await tryRotatePoster(mapping, posterState, scopedUser, rotationSelectedLang)
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
  // Global rotation-scope default for UNMAPPED portrait titles only: when ON
  // (+ auto-rotate ON) the dynamic pool includes the requested-language
  // posters alongside the clean ones. Mapped titles never read it (their
  // per-title mapping flag is authoritative).
  const dynamicRotationIncludeNonClean =
    configOverride?.defaultRotationIncludeNonClean ?? sd.defaultRotationIncludeNonClean ?? false
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
  // Base portrait congelata (`portraitBackdropPath`): il path del backdrop è un
  // input di render, quindi entra esplicitamente nella chiave. `mapVersion`
  // copre i write, ma un mapping con `updatedAt` invariato (import/edit
  // manuale) non deve servire l'altra base. Solo quando quel ramo è davvero in
  // uso: portrait e nessun `poster=` di query (che vince sul mapping).
  const portraitBaseKey = !earlyLandscape && mapping?.portraitBackdropPath && !hardenedParams.get("poster")
    ? `:pbp${mapping.portraitBackdropPath}`
    : ""
  const cacheKey = `poster:v${RENDER_VERSION}:${mediaType}:${tmdbId}:reg${posterRegion.code}:r${cachedRank ?? "x"}:lr${preTrendRank ?? "x"}:la${preAnimeRank ?? "x"}:sd${sdHash}:${cacheParams.toString()}${rotateKey}${mapVersion}${dynamicBucketKey}${portraitBaseKey}${configHash ? `:cfg${configHash}` : ""}${formatKey}`
  const needsVariant = !legacyAvif && outputFormat !== canonicalFormat
  const variantKey = needsVariant ? `${cacheKey}:fmt${outputFormat}` : cacheKey
  // Disk L1.5: after a restart/deploy the canonical render comes back from
  // disk (original timestamp → same TTL/SWR) instead of a cold render.
  await hydratePosterFromDisk(cacheKey)
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
  // Diagnostica geometria (`debug=1`): solo per il proprietario. `netgeo=1`
  // forzava un render completo saltando TUTTE le fast-path di cache, quindi
  // resta riservato a preview effettiva o sessione sbloccata (PIN/admin) —
  // un anonimo non può usarlo come bypass della cache. Senza sessione il
  // comportamento torna quello normale (plain `debug=1` resta render-free).
  const isDebug = req.nextUrl.searchParams.get("debug") === "1"
  const diagnosticsAllowed = isPreview || previewUnlocked
  // Geometria network (`netgeo=1`, solo con `debug=1` autorizzato): deve sempre
  // renderizzare fresco — mai poster bytes/304/stale dalla cache al posto
  // del JSON diagnostico. Non scrive comunque in cache (return prima).
  const wantNetGeo = isDebug && req.nextUrl.searchParams.get("netgeo") === "1" && diagnosticsAllowed
  // Ghost delle HOME qualità vuote (`ghosts=1`, solo con debug+netgeo):
  // diagnostica della preview (maniglie tratteggiate dei gruppi non dipinti).
  // Il percorso Stremio non lo chiede mai → nessun ghost riportato, nessun
  // pixel diverso. Il param non è in allowlist: non entra nella cache key.
  const wantBadgeGhosts = req.nextUrl.searchParams.get("ghosts") === "1"
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
  let etag: string
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
    reqRatingSources, etagBase, renderAbort, queryPoster, queryLogo, queryBackdrop,
    queryPortraitBase, queryGenre, queryVote,
  }
  if (queryPoster) {
    ;({ etag, showBadges, rankingBadges } = resolveQuerySources(sourceCtx, artwork, titleMeta))
  } else if (mapping) {
    ;({ etag, showBadges, rankingBadges } = await resolveMappingSources(sourceCtx, mapping, artwork, titleMeta))
  } else {
    ;({ etag, aggregatedRating, ratingAbort } = await resolveAutoSources(sourceCtx, artwork, titleMeta))
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

    // Details recovery starts BEFORE the sharp resize below so a session-miss
    // fetch overlaps resize CPU instead of extending the critical path after
    // it. The promise is awaited in the luminance Promise.all; outcome and
    // field application are unchanged (the mapping TV metadata assignments
    // below overwrite unconditionally when present, the recovery guards only
    // fill nulls — final values are identical in either order).
    const needsDetailsRecovery = titleMeta.tmdbNetworks.length === 0 && titleMeta.productionCompanies.length === 0
    const detailsRecovery = needsDetailsRecovery
      ? (async () => {
        const apiKey = effTmdbKey
        const preferredLang = canonicalLang || mapping?.language || posterRegion.lang2
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
        if (!titleMeta.releaseDate) titleMeta.releaseDate = details.release_date || null
        if (!titleMeta.firstAirDate) titleMeta.firstAirDate = details.first_air_date || null
        if (!titleMeta.lastAirDate) titleMeta.lastAirDate = details.last_air_date || null
        if (titleMeta.seasonCount == null) titleMeta.seasonCount = details.number_of_seasons ?? null
        if (!titleMeta.nextEpisodeAirDate) titleMeta.nextEpisodeAirDate = details.next_episode_to_air?.air_date || null
        if (titleMeta.numberOfEpisodes == null) titleMeta.numberOfEpisodes = details.number_of_episodes ?? null
        if (titleMeta.originCountries.length === 0) {
          titleMeta.originCountries = [...(details.networks || []), ...(details.production_companies || [])]
            .map((c) => c.origin_country)
            .filter((c): c is string => !!c)
        }
        if (titleMeta.genreIds == null && Array.isArray(details.genres)) {
          titleMeta.genreIds = details.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id))
        }
        if (!titleMeta.tvType) titleMeta.tvType = details.type || null
        if (!titleMeta.tvStatus) titleMeta.tvStatus = details.status || null
        if (details.networks) {
          titleMeta.tmdbNetworks = details.networks.map((n: TMDBCompany) => n.name)
          titleMeta.tmdbNetworksDetailed = details.networks.map((n: TMDBCompany) => ({ name: n.name, logoPath: n.logo_path }))
        }
        if (details.production_companies) {
          titleMeta.productionCompanies = details.production_companies.map((c: TMDBCompany) => c.name)
          titleMeta.productionCompaniesDetailed = details.production_companies.map((c: TMDBCompany) => ({ name: c.name, logoPath: c.logo_path }))
        }
        if (titleMeta.tmdbNetworks.length || titleMeta.productionCompanies.length) titleMeta.tmdbStudios = matchTMDBStudios([...titleMeta.tmdbNetworks, ...titleMeta.productionCompanies])
      })().catch((e: unknown) => { log.error("Details fetch failed", { error: e instanceof Error ? e.message : String(e) }) })
      : null

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

    // 6. Resize poster + compute luminance
    // Landscape: base = sfondo TMDB ritagliato sul canvas 16:9, oppure
    // pillarbox dal poster quando il titolo non ha sfondi.
    // Portrait: `fitPortraitBase` salta il resize quando la base è già
    // 500×750 (poster TMDB `w500`), evitando l'encode/decode JPEG q80 che il
    // vecchio `sharp(...).resize(...).toBuffer()` pagava anche a geometria
    // invariata (generazione lossy extra rimossa: miglioramento di qualità
    // intenzionale, nessun cambio di geometria).
    const posterBuf = isLandscape
      ? (backdropFetch
          ? await fitLandscapeBase(backdropFetch)
          : await pillarboxLandscapeBase(baseBuf))
      : await fitPortraitBase(baseBuf)
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
        : artwork.portraitBackdropCropPath
          ? `portrait:backdropcrop:${artwork.portraitBackdropCropPath}`
          : (artwork.posterPath && !isCustomPosterUrl(artwork.posterPath) ? `portrait:poster:${artwork.posterPath}` : null))
      : backdropFetch
        ? (backdropCustomForFetch
          ? customBaseAnalysisKey(backdropCustomForFetch, "landscape")
          : (artwork.backdropPath ? `landscape:backdrop:${artwork.backdropPath}` : null))
        : (artwork.posterPath ? `landscape:pillarbox:${artwork.posterPath}` : null)

    // Apply mapping TV metadata (synchronous — no race, no side-effects in parallel closures)
    if (mapping?.tvType) titleMeta.tvType = mapping.tvType
    if (mapping?.tvStatus) titleMeta.tvStatus = mapping.tvStatus
    if (mapping?.releaseDate) titleMeta.releaseDate = mapping.releaseDate
    if (mapping?.firstAirDate) titleMeta.firstAirDate = mapping.firstAirDate

    // Luminance + optional TV details fetch (parallel, independent).
    // detailsRecovery was started above (before the sharp resize) so a
    // session-miss fetch overlaps resize CPU; awaited here with the rest.
    const [customRatings, topLum, bottomLum] = await Promise.all([
      customRatingConfig.enabled ? fetchCustomRatings(titleMeta.imdbId, customRatingConfig, renderAbort.signal) : Promise.resolve([]),
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
      lang: canonicalLang || mapping?.language || posterRegion.lang2,
    })
    const {
      badgeStyle, rankingBadgeStyle, qualityBadgeStyle, qualityGroupLayout, badgeFont,
    extraBadgeStyle,
      blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness, tintStrength, topShade, topShadeHeight,
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

    // Allineamento blur non-clean (Golden Rule col client): se il poster
    // finale del ramo automatico ha testo incorporato, i default globali
    // iniettati negli URL Stremio (30/50) non devono vincere sul profilo
    // non-clean (20/80) — come fa il client. Solo Stremio unmapped: mai su
    // preview (slider editor), poster esplicito o mapping (intento utente).
    let effBlurHeight = blurHeight
    let effBlurFade = blurFade
    if (!isPreview && !mapping && !queryPoster && !artwork.autoPosterClean) {
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
    // Demo samples (Settings preview only): a demonstration label when the
    // title resolves none, so the age badge style stays visible. Same gate
    // (master toggle + age toggle) and same sanitizer: real data first, never
    // in Stremio posters or per-title editor previews.
    const realAgeLabel = ageBadge && badgesEnabled !== false ? sanitizeAgeLabel(ageCert.label) : null
    const ageLabel = realAgeLabel
      ?? (demoSamples && ageBadge && badgesEnabled !== false ? sanitizeAgeLabel(DEMO_SAMPLE_AGE_LABEL) : null)
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
    const ephemeralLocale = canonicalLang || mapping?.language || posterRegion.lang2
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
        releaseDate: titleMeta.releaseDate ?? null,
        firstAirDate: titleMeta.firstAirDate ?? null,
        lastAirDate: titleMeta.lastAirDate ?? null,
        seasonCount: titleMeta.seasonCount ?? null,
        nextEpisodeAirDate: titleMeta.nextEpisodeAirDate ?? null,
        numberOfEpisodes: titleMeta.numberOfEpisodes ?? null,
        originCountries: [...titleMeta.originCountries],
        genreIds: titleMeta.genreIds ? [...titleMeta.genreIds] : null,
        voteAverage: titleMeta.voteAverage ?? 0,
        trendRank: finalRank,
        animeRank: animeRankResult,
        awards: wikidataResult.awards,
        nominations: wikidataResult.nominations,
        studios: [...wikidataResult.studios],
        director: directorBadgeLabel(wikidataResult.director, t),
        tvType: titleMeta.tvType ?? null,
        tvStatus: titleMeta.tvStatus ?? null,
        keywords: [...tmdbKeywords],
        imdbTop250: !!imdbTop250,
        whatsonFeatures: aggregated?.whatsonFeatures ?? null,
        disabledContentTags: disabledContentTags ?? null,
      },
      locale: ephemeralLocale,
      sashOrder,
      dateFormat: ephemeralDateFormat,
      preRelease: !!(preRelease && preReleaseDetected),
      t,
    })
    // Stabilization: an ENABLED pre-release whose JustWatch availability is
    // still unknown (fetch error / 2500ms race lost, preJw stays null) is an
    // undecided volatile fact. Never freeze a possibly-wrong poster for the
    // flat 6h/24h policy: reuse the existing ephemeral TTL so the next render
    // can resolve the real state. Known answers (preJw true/false) keep the
    // existing fact-cap path untouched, and disabled pre-release adds nothing.
    const preReleaseUndecidedEphemeral = isPreReleaseDetectionUndecided({
      preReleaseEnabled: preRelease,
      mediaType,
      jwAvailable: preJw,
    })
    const ephemeralTtl = qualityEphemeral || wikidataEphemeral || customFallbackEphemeral || ageEphemeral || !!nextEpisodeEphemeral || preReleaseUndecidedEphemeral
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
    const localSpec = lookupAVSpecs(titleMeta.imdbId)
    // Soglia minima qualità all'uscita: la cache upstream (`resolveStreamQuality`)
    // tiene sempre il raw — qui si sopprime solo il badge sotto soglia.
    // Demo samples (Settings preview only): a demo tier only when no real
    // source resolves one (formats are handled separately below).
    const effectiveRawQuality = qQualityParam || localSpec?.quality || liveQuality || (demoSamples && badgeQuality ? DEMO_SAMPLE_QUALITY : null)
    const finalQuality = applyMinQuality(
      effectiveRawQuality as StreamQuality | null,
      minQuality,
    )

    // Formati A/V built-in (dv, atmos, imax, hdr, hdr10plus): sempre
    // automatici dalle specifiche reali del film (localSpec, poi JW live) — mai un logo che
    // il titolo non possiede. I marchi del pack (`QualityMarkId` non built-in)
    // non hanno dati per-titolo: entrano SOLO quando la selezione esplicita
    // (query/mapping, o defaults non vuoti) li contiene, quindi l'assenza di
    // selezione resta byte-identica allo storico.
    // Precedenza come la qualità: DB locale (curato) > JustWatch live.
    const availableFormats = localSpec?.formats ?? liveQualityResult.formats ?? []
    const qFormatsRaw = req.nextUrl.searchParams.get("formats")
    const qFormats = qFormatsRaw !== null
      ? (qFormatsRaw === "none" || qFormatsRaw === "" ? [] : qFormatsRaw.split(",").map((s) => s.trim().toLowerCase()).filter(isQualityMarkId))
      : null
    const allowedFormats = earlyEffSd.videoFormats ?? sd.videoFormats
    const requestedFormats = qFormats ?? earlyEffMapping?.videoFormats ?? null
    const selectedFormats = requestedFormats ?? (allowedFormats && allowedFormats.length > 0 ? allowedFormats : null)
    const cappedFormats = resolveEffectiveQualityMarks({
      availableFormats,
      requestedFormats,
      allowedFormats,
    })
    // Demo samples (Settings preview only): every ENABLED mark is demoed, so a
    // partial real spec (e.g. DV only) still shows the other enabled styles.
    // The enabled selection is the only gate — `formats=none`/unchecked
    // formats demo nothing, a restricted list demos exactly that list — and it
    // applies to the real specs too. The renderer keeps its own precedence
    // rules (HDR10+ replaces HDR, DV+Atmos merge into one lockup).
    const sampledFormats = demoSamples
      ? sampleDemoVideoFormats(availableFormats, selectedFormats)
      : null
    const finalVideoFormats = sampledFormats && sampledFormats.length > 0
      ? sampledFormats
      : (cappedFormats.length > 0 ? cappedFormats : null)

    const locale = canonicalLang || mapping?.language || posterRegion.lang2
    // Formato data badge "in uscita": query `df` > default utente > `locale`
    // (fail-closed: valori ignoti o assenti = comportamento storico).
    const dateFormat = parseDateFormat(hardenedParams.get("df") ?? sd.dateFormat ?? null) ?? "locale"
    // Genere in alto con slot libero: query `gtop` (presente ≠ "0" = on, come
    // gli altri toggle booleani in chiave) > default utente > off.
    const qGtop = hardenedParams.get("gtop")
    const genreTopWhenFree = qGtop !== null ? qGtop !== "0" : sd.genreTopWhenFree === true
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
    const snapshotSlotRemainingMs = (pin: ChartFamilyPin | null, family: string | null, nowMs: number): number | null => {
      if (!pin?.snapshot) return null
      // Family cadence: the pinned end follows the family's own slots
      // (00/06/12/18 for JW, 00/12 otherwise) — never the current window.
      const slotEnd = family ? familySlotEndMs(family, pin.snapshot.generation) : chartSlotEndMs(pin.snapshot.generation)
      if (!slotEnd) return null
      const remaining = slotEnd - nowMs
      // A pin published in a previous slot (retained on outage, or a render
      // starting just before the boundary) is already expired: yield ZERO,
      // never null — null would fall through to the rolling JW TTL and extend
      // freshness past the published list. The write path turns 0 into
      // max-age=0 + no store (see factExpiredAtWrite below).
      return remaining > 0 ? remaining : 0
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
      } else if (rankingSourcePre.kind === "streaming") {
        // Imported Top 10 ranking source: the fact expires with its pinned
        // family slot (6h/12h cadence), never a fixed TTL.
        trendFactMs = snapshotSlotRemainingMs(
          streamingSnapshotPin,
          streamingRankPre?.family ?? null,
          factNowMs,
        )
      } else if (rankingSourcePre.kind === "addon") {
        // Imported addon ranking source: the fact expires with the effective
        // remote page freshness (10 min / 60s empty), never a blind policy.
        trendFactMs = addonRankingInput
          ? addonRankingRemainingMs(addonRankingInput, factNowMs)
          : null
      } else {
        trendFactMs = snapshotSlotRemainingMs(trendSnapshotPin, jwFamily, factNowMs) ?? (
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
      ? (snapshotSlotRemainingMs(animeSnapshotPin, chartAnimeFamily, factNowMs) ?? mdblistRemainingMs(animeListKey, animeKeyUsed, factNowMs))
      : null
    const offersFactMs =
      preRelease && mediaType === "movie" && preJw !== null
        ? jwAvailabilityRemainingMs("MOVIE", posterRegion.code, tmdbId, factNowMs)
        : null
    const digitalDateForCap =
      applyPreRelease && mediaType === "movie" && preJw !== true ? preDigital : null
    const upcomingLabelForCap = getUpcomingReleaseLabel({
      mediaType,
      releaseDate: titleMeta.releaseDate,
      firstAirDate: titleMeta.firstAirDate,
      locale,
      dateFormat,
      t,
    })
    const upcomingDateForCap = upcomingLabelForCap
      ? (mediaType === "movie" ? titleMeta.releaseDate : titleMeta.firstAirDate)
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
      etag = `${etag.slice(0, -1)}:${finalRank ?? "X"}:${imdbTop250}:${titleMeta.voteAverage ?? "0"}:${applyPreRelease ? "P" : "x"}:${sepSig}${dynEtagSuffix}"`
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
    // M5: zero-copy view — `new Uint8Array(buffer)` would MEMCPY the whole
    // image per response; the view shares the same bytes.
    const compositedView = new Uint8Array(composited.buffer, composited.byteOffset, composited.byteLength) as Uint8Array<ArrayBuffer>
    return new Response(compositedView, { headers: renderHeaders })
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
