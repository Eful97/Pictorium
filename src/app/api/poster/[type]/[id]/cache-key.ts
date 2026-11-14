// Identità di cache della richiesta poster (fase D della poster route):
// chiave canonica e di variante, base ETag, rotazione giornaliera dei
// dinamici, formato di output, policy immutable/live/refresh, flag di debug,
// TTL dinamici e validatore condizionale. Idrata la entry canonica dal disco
// (L1.5). Corpo spostato da route.ts invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { CustomRatingConfig } from "@/lib/custom-rating"
import { hydratePosterFromDisk } from "@/lib/poster-disk-cache"
import { getDynamicRotationBucket, secondsUntilDynamicRotationCut } from "@/lib/poster-rotation"
import { hashKey } from "@/lib/poster-render-helpers"
import { resolveImageFormat, DEFAULT_IMAGE_FORMAT, isImmutablePosterRequest, isPosterRefreshRequest, isLivePosterRequest, dynamicPosterTtlSec, type PosterImageFormat } from "@/lib/poster-runtime-cache"
import { RENDER_VERSION } from "@/lib/render-version"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import { userTagFragment } from "@/lib/cache"
import type { PosterAdmission } from "./admission"

/** Valori della richiesta che entrano in chiave/policy di cache. */
export interface PosterCacheIdentityContext {
  readonly req: NextRequest
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly scopedUser: string | null
  readonly isPreview: boolean
  readonly previewUnlocked: boolean
  readonly configOverride: PosterAdmission["configOverride"]
  readonly mapping: Mapping | null
  readonly sd: ServerDefaults
  readonly posterRegion: RegionDef
  readonly earlyLandscape: boolean
  readonly isRotating: boolean
  readonly customRatingConfig: CustomRatingConfig
  readonly sepDisplay: boolean
  readonly sdHash: string
  readonly hardenedParams: URLSearchParams
  readonly cacheParams: URLSearchParams
  readonly preTrendRank: number | null
  readonly preAnimeRank: number | null
  readonly startTime: number
}

/** Chiavi, validatori e policy di cache letti dal resto della richiesta. */
export interface PosterCacheIdentity {
  dynamicDayBucket: number | null
  dynamicRotationIncludeNonClean: boolean
  dynamicCutTtlMs: number | null
  outputFormat: PosterImageFormat
  legacyAvif: boolean
  canonicalFormat: "jpeg" | "webp" | "avif"
  cacheKey: string
  needsVariant: boolean
  variantKey: string
  etagBase: string
  immutablePoster: boolean
  refreshRequest: boolean
  isLive: boolean
  isDebug: boolean
  wantNetGeo: boolean
  wantBadgeGhosts: boolean
  dynamicPoster: boolean
  mappingTag: string | undefined
  dynamicTtlSec: number | undefined
  variantTtlSec: number | undefined
  ifNoneMatch: string | null
  isConditional: boolean
}

export async function resolvePosterCacheIdentity(ctx: PosterCacheIdentityContext): Promise<PosterCacheIdentity> {
  const {
    req, mediaType, tmdbId, scopedUser, isPreview, previewUnlocked, configOverride, mapping, sd,
    posterRegion, earlyLandscape, isRotating, customRatingConfig, sepDisplay, sdHash, hardenedParams,
    cacheParams, preTrendRank, preAnimeRank, startTime,
  } = ctx
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

  return {
    dynamicDayBucket,
    dynamicRotationIncludeNonClean,
    dynamicCutTtlMs,
    outputFormat,
    legacyAvif,
    canonicalFormat,
    cacheKey,
    needsVariant,
    variantKey,
    etagBase,
    immutablePoster,
    refreshRequest,
    isLive,
    isDebug,
    wantNetGeo,
    wantBadgeGhosts,
    dynamicPoster,
    mappingTag,
    dynamicTtlSec,
    variantTtlSec,
    ifNoneMatch,
    isConditional,
  }
}
