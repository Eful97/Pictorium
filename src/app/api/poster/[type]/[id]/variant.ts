// Risposta in un formato non canonico (variante cache o conversione) della
// poster route. Corpo spostato da route.ts invariato: il contesto sostituisce
// le variabili della richiesta catturate dalla closure originale.

import { createLogger } from "@/lib/logger"
import {
  convertPosterFormat,
  convertToJpeg,
  httpRemainingSec,
  posterNotModifiedHeaders,
  posterResponse,
  readCachedPoster,
  recordPosterLatency,
  variantEtagFor,
  writeCachedPoster,
  type PosterCachePayload,
  type PosterImageFormat,
} from "@/lib/poster-runtime-cache"
import { FormatOverloadError, runFormatConversion } from "@/lib/poster-format-gate"
import { posterErrorResponse, type ServeResponseVariant } from "./phases"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Valori della richiesta letti dal server delle varianti. */
export interface ResponseVariantContext {
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly startTime: number
  readonly isPreview: boolean
  readonly isConditional: boolean
  readonly ifNoneMatch: string | null
  readonly isLive: boolean
  readonly wantNetGeo: boolean
  readonly outputFormat: PosterImageFormat
  readonly canonicalFormat: "jpeg" | "webp" | "avif"
  readonly variantKey: string
  readonly variantTtlSec: number | undefined
  readonly mappingTag: string | undefined
  readonly dynamicPoster: boolean
  readonly immutablePoster: boolean
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
export function createResponseVariantServer(ctx: ResponseVariantContext): ServeResponseVariant {
  const {
    mediaType, tmdbId, startTime, isPreview, isConditional, ifNoneMatch, isLive, wantNetGeo,
    outputFormat, canonicalFormat, variantKey, variantTtlSec, mappingTag, dynamicPoster, immutablePoster,
  } = ctx
  return async (canonical: PosterCachePayload, opts?: { ttlMs?: number; immutable?: boolean; factCapped?: boolean; expiresAt?: number }, latencyOrigin: "cached" | "render" | "skip" = "skip"): Promise<Response> => {
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
}
