// Chiusura del render (fase L della poster route): ETag dei byte effettivi,
// ricalcolo del freshness cap al momento della scrittura (tempo di composite
// incluso), scrittura cache, record accento, completamento dell'inflight e
// risposta (200, 304 o variante di formato). Corpo spostato da route.ts
// invariato.

import { createHash } from "node:crypto"
import type { Mapping } from "@/lib/types"
import type { CustomRatingConfig } from "@/lib/custom-rating"
import type { SeparateRating } from "@/lib/ratings"
import type { EffectiveAccentMeta } from "@/lib/effective-accent"
import type { GenerationInput } from "@/lib/poster-service"
import { createLogger } from "@/lib/logger"
import {
  posterHeaders,
  posterNotModifiedHeaders,
  recordCompletedAccent,
  recordPosterLatency,
  recordPosterRequest,
  serverTimingValue,
  variantEtagFor,
  writeCachedPoster,
  type PosterCachePayload,
  type PosterImageFormat,
} from "@/lib/poster-runtime-cache"
import { hashKey } from "@/lib/poster-render-helpers"
import { msUntilPosterScheduledRefresh } from "@/lib/cache"
import { capPosterTtlMs } from "@/lib/poster-freshness"
import type { ServeResponseVariant } from "./phases"
import type { PosterTitleMeta } from "./sources"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Esito del composite e stato della richiesta letti dalla chiusura. */
export interface PosterFinalizeContext {
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly startTime: number
  readonly mapping: Mapping | null
  readonly isPreview: boolean
  readonly isConditional: boolean
  readonly ifNoneMatch: string | null
  readonly isLive: boolean
  readonly cacheKey: string
  readonly mappingTag: string | undefined
  readonly outputFormat: PosterImageFormat
  readonly needsVariant: boolean
  readonly dynamicPoster: boolean
  readonly dynamicDayBucket: number | null
  readonly dynamicCutTtlMs: number | null
  readonly customRatingConfig: CustomRatingConfig
  readonly titleMeta: PosterTitleMeta
  readonly finalRank: number | null
  readonly imdbTop250: boolean
  readonly applyPreRelease: boolean
  readonly useSeparate: boolean
  readonly bottomActive: boolean
  readonly sepItems: SeparateRating[]
  readonly ephemeralTtl: boolean
  readonly effectiveImmutable: boolean
  readonly effectiveTtlSec: number | undefined
  readonly cappedTtlMs: number | undefined
  readonly policyBaseMs: number | undefined
  readonly factExpiresAtMs: number | null
  readonly factCappedWrite: boolean
  readonly genInput: GenerationInput
  readonly composited: Buffer
  readonly collectedAccentMeta: EffectiveAccentMeta | null
  readonly tFetchMs: number
  readonly tCompositeStart: number
  readonly completePosterRender: (payload: PosterCachePayload | null, keepEntry?: boolean) => void
  readonly serveResponseVariant: ServeResponseVariant
}

export async function finalizePosterRender(ctx: PosterFinalizeContext): Promise<Response> {
  const {
    mediaType, tmdbId, startTime, mapping, isPreview, isConditional, ifNoneMatch, isLive,
    cacheKey, mappingTag, outputFormat, needsVariant, dynamicPoster, dynamicDayBucket, dynamicCutTtlMs, customRatingConfig,
    titleMeta, finalRank, imdbTop250, applyPreRelease, useSeparate, bottomActive, sepItems, ephemeralTtl,
    effectiveImmutable, cappedTtlMs, policyBaseMs, factExpiresAtMs, factCappedWrite, genInput, composited,
    collectedAccentMeta, tFetchMs, tCompositeStart, completePosterRender, serveResponseVariant,
  } = ctx
  let { effectiveTtlSec } = ctx
  let etag: string
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
}
