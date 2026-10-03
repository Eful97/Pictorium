/**
 * Shared server-side custom ranking service: the single function that turns
 * a configured custom list into an ordered Top-N of resolvable TMDB ids.
 *
 * Future consumers (`/api/trending/rank`, the poster route) must reuse
 * `fetchCustomRankingTop20` instead of growing independent copies: one
 * source of truth for filtering, id resolution, ordering and status.
 *
 * Status contract (mirrors `fetchUnifiedCatalogResult`): `ok` carries items,
 * `empty` is a genuine empty list (no filler, no fallback), any other status
 * (`private`, `not_found`, `rate_limited`, `key_missing`, `unavailable`,
 * `unsupported`) is a provider error the caller must surface explicitly,
 * never silently fall back to JustWatch.
 *
 * Resolution failures are classified, not swallowed: a `/find` miss drops
 * one row, but a missing key or a throwing upstream marks the whole result
 * (`key_missing` / `unavailable`) instead of a bogus valid-empty list.
 * A failure only poisons ranks it could have shifted (see `covers` below);
 * failures past every collected row leave the Top-N window exact.
 * Aborts propagate as thrown errors so the caller can tell cancellation
 * apart from an empty chart.
 *
 * A failure only poisons ranks it could have shifted: rows past every
 * collected position leave the Top-N window exact. Anything else (a gap
 * inside the window, or too few rows with failures outstanding) returns the
 * whole error state and is never cached.
 *
 * Cancellation is per-caller: followers joining shared in-flight work race
 * it against their own signal, so one abort rejects only its caller while
 * the shared resolution keeps running for the others. Cache hits on an
 * already-aborted signal throw instead of returning stale data.
 */

import crypto from "node:crypto"

import { cacheGet, cacheSet } from "./cache"
import { concurrentMap } from "./episode-ordering"
import { createLogger } from "./logger"
import {
  fetchUnifiedCatalogResult,
  type CatalogFetchStatus,
} from "./custom-catalog-providers"
import { filterRankingItemsBySlot, type RankingSlot } from "./ranking-source"
import { tmdbFindByImdb, tmdbFindByTvdb } from "./tmdb"
import type { CustomCatalogConfig } from "./types"

const log = createLogger("custom-ranking")

/** Rank window: only the first 20 positions drive badges and Top 20 grids. */
export const CUSTOM_RANKING_TOP_N = 20

/**
 * Provider fetch window: same 500-row window as the pictorium-custom-*
 * catalogs, so first-20-per-type is preserved across the whole supported
 * list (a mixed list with movies late in the tail still fills the movie
 * Top-20). Per-render cost is bounded by deadline (caller signal race +
 * shared timeout below), never by a cutoff that would change semantics.
 * The unified cache key already separates limits.
 */
const RANKING_FETCH_LIMIT = 500

/**
 * Resolution stride: rows resolve in list order in chunks of this size and
 * the scan stops as soon as the Top-N is full, so a fully-mapped head never
 * pays `/find` calls for the tail. The stride also bounds fan-out: at most
 * one chunk is ever in flight, every `/find` carries the caller signal.
 */
const RESOLVE_CHUNK_SIZE = 10

/**
 * Resolution scan cap: covers the whole fetch window, so a late-tail type
 * still fills its Top-20 (see fetch limit above). The ordered early stop
 * exits far earlier in practice; the cap only bounds pathological
 * fully-unmapped tails, whose cost is deadline-bounded by the caller signal.
 */
const RESOLVE_SCAN_CAP = 500

/**
 * Normalized result TTL: same 30 minutes as the provider list cache, same
 * `custom_catalogs` tag so existing invalidations clear both layers.
 * Only `ok` results with items are cached; errors and genuine empties are
 * recomputed (the catalog layer already holds empty bodies for 60s).
 */
const RANKING_CACHE_TTL_MS = 30 * 60 * 1000
const RANKING_CACHE_TAGS = ["custom_catalogs"]

/**
 * Bound for a shared resolution: independent of every caller signal (a
 * leader abort never cancels shared work), so abandoned resolutions can
 * not outlive it. Normal work finishes far below via chunked early stop;
 * provider fetches and `/find` lookups carry their own shorter timeouts.
 */
const SHARED_RESOLVE_TIMEOUT_MS = 30_000

export interface CustomRankingSourceRef {
  readonly url: string
  readonly datasetId?: string
}

export interface CustomRankingItem {
  readonly tmdbId: number
  readonly imdb: string
  readonly title: string
  readonly year: number
}

export interface CustomRankingResult {
  readonly status: CatalogFetchStatus
  /** Ordered Top-N: position is `index + 1`, nothing beyond Top-N. */
  readonly items: CustomRankingItem[]
}

export interface FetchCustomRankingInput {
  readonly custom: CustomRankingSourceRef
  readonly slot: RankingSlot
  readonly apiKey?: string
  readonly mdblistKey?: string
  readonly tvdbKey?: string
  readonly userId?: string | null
  /**
   * Caller deadline (the poster pipeline passes its render watchdog):
   * forwarded to every `/find` lookup and checked between chunks; an abort
   * throws instead of returning a partial or empty result.
   */
  readonly signal?: AbortSignal
}

/**
 * Finds the referenced custom catalog inside a merged config. Returns
 * undefined when the selection was deleted (the resolver already validated
 * it, so this only guards against races between resolution and use).
 */
export function findRankingCustomCatalog(
  customCatalogs: readonly CustomCatalogConfig[] | undefined,
  customId: string,
): CustomCatalogConfig | undefined {
  return customCatalogs?.find((c) => c.id === customId)
}

function hashFragment(value: string | undefined): string {
  return value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 8) : "none"
}

function rankingCacheKey(input: FetchCustomRankingInput): string {
  const urlHash = crypto.createHash("sha1").update(input.custom.url.trim()).digest("hex").slice(0, 10)
  return [
    "custom_rank",
    urlHash,
    input.slot,
    `n${CUSTOM_RANKING_TOP_N}`,
    `ak${hashFragment(input.apiKey)}`,
    `mk${hashFragment(input.mdblistKey)}`,
    `vk${hashFragment(input.tvdbKey)}`,
    `ds${hashFragment(input.custom.datasetId)}`,
    `u${hashFragment(input.userId ?? undefined)}`,
  ].join(":")
}

// In-flight coalescing: concurrent resolutions of the same key share one
// promise (same pattern as the TMDB fetch layer). Entries are deleted on
// settle, so a failed shared call never poisons later ones.
const inflight = new Map<string, Promise<CustomRankingResult>>()

/** Test hook: drops in-flight entries (mirrors `__resetTvdbTokenCache`). */
export function __resetCustomRankingInflight(): void {
  inflight.clear()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Custom ranking aborted")
}

/**
 * Races shared work against one caller signal without cancelling it: only
 * this caller rejects on abort. Both branches stay observed, so whichever
 * side loses never surfaces as an unhandled rejection.
 */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  let onAbort!: () => void
  const aborter = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Custom ranking aborted"))
  })
  signal.addEventListener("abort", onAbort, { once: true })
  // Mark the shared promise handled on this branch too: if this caller
  // aborts first, the later settlement of the shared work stays silent.
  promise.catch(() => {})
  return Promise.race([promise, aborter]).finally(() => {
    signal.removeEventListener("abort", onAbort)
  })
}

export async function fetchCustomRankingTop20(input: FetchCustomRankingInput): Promise<CustomRankingResult> {
  // An already-aborted caller never reads (or joins) shared state, not even
  // a cache hit.
  throwIfAborted(input.signal)
  const key = rankingCacheKey(input)
  const hit = cacheGet<CustomRankingItem[]>(key)
  if (hit && hit.length > 0) return { status: "ok", items: hit }
  const pending = inflight.get(key)
  // Every caller (leader included) races shared work against its own
  // signal: one abort rejects only its caller, never the shared resolution.
  if (pending) return raceWithSignal(pending, input.signal)
  // The shared resolution runs on an independent signal: a leader abort
  // must not cancel followers. The bound below keeps abandoned work from
  // becoming unlimited server zombies; provider fetches and `/find` carry
  // their own shorter timeouts on top.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SHARED_RESOLVE_TIMEOUT_MS)
  const promise = resolveTop20({ ...input, signal: ctrl.signal }).finally(() => {
    clearTimeout(timer)
    if (inflight.get(key) === promise) inflight.delete(key)
  })
  inflight.set(key, promise)
  return raceWithSignal(promise, input.signal)
}

type RowOutcome =
  | { kind: "row"; row: CustomRankingItem }
  /** Unresolvable by construction (no ids) or genuine `/find` miss. */
  | { kind: "drop" }
  /** Ids need a TMDB key the caller did not provide. */
  | { kind: "key_missing" }
  /** The lookup itself threw (outage, timeout, abort excluded). */
  | { kind: "failed" }

async function resolveOne(
  item: { tmdb?: number; imdb?: string; tvdb?: number; title?: string; year?: number | string },
  mediaType: "movie" | "tv",
  input: FetchCustomRankingInput,
): Promise<RowOutcome> {
  let tmdbId = Number(item.tmdb) || 0
  if (!tmdbId) {
    if (!item.imdb && !item.tvdb) return { kind: "drop" }
    if (!input.apiKey) return { kind: "key_missing" }
    try {
      const found = item.imdb
        ? await tmdbFindByImdb(item.imdb, mediaType, input.apiKey, input.signal)
        : await tmdbFindByTvdb(item.tvdb as number, mediaType, input.apiKey, input.signal)
      if (!found) return { kind: "drop" }
      tmdbId = found
    } catch {
      throwIfAborted(input.signal)
      return { kind: "failed" }
    }
  }
  return {
    kind: "row",
    row: {
      tmdbId,
      imdb: item.imdb || "",
      title: item.title || "",
      year: Number(item.year) || 0,
    },
  }
}

async function resolveTop20(input: FetchCustomRankingInput): Promise<CustomRankingResult> {
  const mediaType = input.slot === "movie" ? "movie" : "tv"
  // Auth/namespace isolation rides on the unified fetch cache key (hashed
  // request keys, dataset id and user id): two namespaces never collide.
  // The initial provider fetch races the caller deadline instead of holding
  // a render slot past it; the loss is silent by contract (throw on abort).
  const result = await raceWithSignal(
    fetchUnifiedCatalogResult(input.custom.url, {
      apiKey: input.apiKey,
      mdblistKey: input.mdblistKey,
      tvdbKey: input.tvdbKey,
      limit: RANKING_FETCH_LIMIT,
      datasetId: input.custom.datasetId,
      userId: input.userId ?? null,
    }),
    input.signal,
  )
  if (result.status !== "ok" && result.status !== "empty") {
    return { status: result.status, items: [] }
  }
  const filtered = filterRankingItemsBySlot(result.items, input.slot)
  if (filtered.length === 0) return { status: "empty", items: [] }

  // Id resolution in list order with an early stop: chunks resolve
  // concurrently, the scan ends once Top-N is full. Failure positions are
  // tracked so a gap inside the window poisons the whole result instead of
  // compressing later rows into wrong ranks.
  const seen = new Set<number>()
  const items: CustomRankingItem[] = []
  const collectedAt: number[] = []
  const keyMissingAt: number[] = []
  const failedAt: number[] = []
  const candidates = filtered.slice(0, RESOLVE_SCAN_CAP)
  for (let start = 0; start < candidates.length && items.length < CUSTOM_RANKING_TOP_N; start += RESOLVE_CHUNK_SIZE) {
    throwIfAborted(input.signal)
    const chunk = candidates.slice(start, start + RESOLVE_CHUNK_SIZE)
    const resolved = await concurrentMap(chunk, (item) => resolveOne(item, mediaType, input), 5)
    for (let i = 0; i < resolved.length; i++) {
      const out = resolved[i]
      if (out.kind === "key_missing") {
        keyMissingAt.push(start + i)
        continue
      }
      if (out.kind === "failed") {
        failedAt.push(start + i)
        continue
      }
      if (out.kind !== "row" || seen.has(out.row.tmdbId)) continue
      seen.add(out.row.tmdbId)
      items.push(out.row)
      collectedAt.push(start + i)
      if (items.length >= CUSTOM_RANKING_TOP_N) break
    }
  }
  // A failure matters only when it sits before the last collected position
  // (ranks would shift) or when the window never filled (it might have
  // filled it). Anything past every collected row leaves Top-N exact.
  const covers = (idxs: number[]): boolean =>
    items.length >= CUSTOM_RANKING_TOP_N
      ? idxs.some((idx) => idx < collectedAt[collectedAt.length - 1])
      : idxs.length > 0
  if (covers(keyMissingAt)) return { status: "key_missing", items: [] }
  if (covers(failedAt)) return { status: "unavailable", items: [] }
  if (items.length > 0) {
    const done: CustomRankingResult = { status: "ok", items }
    cacheSet(rankingCacheKey(input), done.items, RANKING_CACHE_TAGS, RANKING_CACHE_TTL_MS)
    return done
  }
  log.debug("Custom ranking resolved to zero TMDB ids", { slot: input.slot })
  return { status: "empty", items: [] }
}
