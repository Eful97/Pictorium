/**
 * Server-side Top-10/Top-20 ranking source backed by an imported Stremio
 * addon catalog.
 *
 * The imported addon branch stays a passthrough for its own catalog
 * (`catalog-handler.ts`: original order/duplicates/IDs). This module is the
 * ONLY ranking projection: it reads the same SSRF-safe remote page through
 * `fetchAddonCatalogPage`, resolves supported IDs (tt/tmdb/tvdb via the
 * existing utilities) and keeps the REAL list positions.
 *
 * Contract:
 * - a manifest may expose several catalogs: the remote identity is
 *   `manifestUrl + catalogId + catalogType`, never the local custom id alone;
 * - order and positions are the source's: an unresolvable row is dropped,
 *   later rows keep their original rank (no renumbering, no backfill);
 * - TOP 10 window when the source yields a 10-row chart, otherwise the first
 *   20 positions (never inferred from the catalog name);
 * - mixed rows keep their declared media type (`type`), slot filtering uses
 *   the REAL per-row type, falling back to the imported catalog type;
 * - only IDs already resolvable through the existing safe utilities are used:
 *   `tmdb:`/numeric need no lookup, `tt`/`tvdb` go through the shared TMDB
 *   `/find` cache (no details fetch, no second renderer);
 * - unsupported/proprietary IDs are a genuine drop; a missing key or a failed
 *   lookup is an explicit error (never cached, never a silent empty);
 * - one cache entry per remote source/slot/credential/namespace with the same
 *   10-minute freshness as the addon page cache, exposed to callers as a
 *   remaining-TTL so poster/preview facts expire with the effective source.
 */

import crypto from "node:crypto"

import { cacheGet, cacheRemainingMs, cacheSet } from "./cache"
import { raceWithAbort } from "./abort-signal"
import { concurrentMap } from "./episode-ordering"
import { createLogger } from "./logger"
import type { RankingSlot } from "./ranking-source"
import { addonCatalogCacheNamespace, fetchAddonCatalogPage, type AddonFetchError } from "./stremio-addon-server"
import { normalizeManifestUrl, parseSupportedTmdbRef, type StremioAddonSource } from "./stremio-addon"
import { tmdbFindByImdb, tmdbFindByTvdb } from "./tmdb"
import type { CustomCatalogConfig } from "./types"

const log = createLogger("addon-ranking")

/** A source that yields at most ten rows is a Top-10 chart. */
export const ADDON_RANKING_TOP10 = 10
/** Every other source contributes its first 20 real positions. */
export const ADDON_RANKING_TOP20 = 20

/** Same freshness as the addon page cache (`stremio-addon-server.ts`). */
const ADDON_RANKING_TTL_MS = 10 * 60 * 1000
const ADDON_RANKING_EMPTY_TTL_MS = 60 * 1000
const ADDON_RANKING_TAGS = ["custom_catalogs", "stremio", "addon"]

export interface AddonRankingItem {
  readonly tmdbId: number
  readonly imdbId: string | null
  /** Real position in the remote list (1-based), never renumbered. */
  readonly rank: number
  readonly title: string | null
  readonly mediaType: "movie" | "tv"
}

export type AddonRankingStatus = "ok" | "empty" | "error"

export interface AddonRankingResult {
  readonly status: AddonRankingStatus
  readonly items: readonly AddonRankingItem[]
  /** Effective window of this source: 10 (Top-10 chart) or 20. */
  readonly window: typeof ADDON_RANKING_TOP10 | typeof ADDON_RANKING_TOP20
  /** Stable remote-identity fragment (never a credential URL). */
  readonly sourceKey: string
  /** Provider/key error surfaced by the callers' notice/502 paths. */
  readonly errorStatus?: AddonFetchError | "key_missing" | "unavailable"
}

export interface FetchAddonRankingInput {
  /** Imported catalog entry: local id + the actual remote catalog source. */
  readonly custom: Pick<CustomCatalogConfig, "id" | "addon">
  readonly slot: RankingSlot
  readonly apiKey?: string
  readonly tvdbKey?: string
  readonly userId?: string | null
  /** `?config=` token (hashed in cache keys, never stored raw). */
  readonly configParam?: string | null
  /** Trusted origin for the existing self-recursion guard. */
  readonly requestOrigin: string | null
  /** Caller deadline (poster watchdog, route phase budget). */
  readonly signal?: AbortSignal
}

type CachedAddonRanking = Pick<AddonRankingResult, "items" | "window">

function hashFragment(value: string | undefined | null): string {
  return value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 10) : "none"
}

/** Normalized remote identity: a manifest can host several different lists. */
export function addonRankingSourceKey(source: StremioAddonSource): string {
  const manifest = normalizeManifestUrl(source.manifestUrl) ?? source.manifestUrl.trim()
  return hashFragment(`${manifest}|${source.catalogType}|${source.catalogId}`)
}

function addonRankingCacheKey(input: FetchAddonRankingInput): string {
  const addon = input.custom.addon
  return [
    "addon_rank",
    addon ? addonRankingSourceKey(addon) : "noaddon",
    input.slot,
    `u${hashFragment(input.userId)}`,
    `cfg${hashFragment(input.configParam)}`,
    `ak${hashFragment(input.apiKey)}`,
    `vk${hashFragment(input.tvdbKey)}`,
  ].join(":")
}

/**
 * Remaining lifetime (ms) of a resolved addon ranking from its ABSOLUTE
 * cache provenance, or null when absent/expired. Read-only: never fetches,
 * never renews (poster/preview freshness cap).
 */
export function addonRankingRemainingMs(
  input: FetchAddonRankingInput,
  nowMs: number = Date.now(),
): number | null {
  return cacheRemainingMs(addonRankingCacheKey(input), nowMs)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Addon ranking aborted")
}

function addonQueryNamespace(input: FetchAddonRankingInput): string {
  return addonCatalogCacheNamespace(input.userId, input.configParam, input.apiKey)
}

function rowMediaType(raw: Record<string, unknown>, remoteType: "movie" | "series"): "movie" | "tv" {
  const declared = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : ""
  if (declared === "movie") return "movie"
  if (declared === "series" || declared === "tv" || declared === "show") return "tv"
  return remoteType === "movie" ? "movie" : "tv"
}

type RowOutcome =
  | { kind: "row"; item: AddonRankingItem }
  /** Unsupported/proprietary ID or a genuine `/find` miss: drop only. */
  | { kind: "drop" }
  /** Needs a TMDB key the caller did not provide. */
  | { kind: "key_missing" }
  /** Lookup itself failed (outage/timeout, abort excluded). */
  | { kind: "failed" }

async function resolveOne(
  raw: Record<string, unknown>,
  rank: number,
  mediaType: "movie" | "tv",
  input: FetchAddonRankingInput,
): Promise<RowOutcome> {
  if (typeof raw.id !== "string") return { kind: "drop" }
  const ref = parseSupportedTmdbRef(raw.id)
  if (!ref) return { kind: "drop" }
  let tmdbId: number | null = null
  if (ref.kind === "tmdb") {
    tmdbId = ref.tmdbId
  } else if (!input.apiKey) {
    return { kind: "key_missing" }
  } else if (ref.kind === "imdb") {
    try {
      tmdbId = await tmdbFindByImdb(ref.imdb, mediaType, input.apiKey, input.signal)
    } catch {
      throwIfAborted(input.signal)
      return { kind: "failed" }
    }
  } else {
    try {
      tmdbId = await tmdbFindByTvdb(ref.tvdb, mediaType, input.apiKey, input.signal)
    } catch {
      throwIfAborted(input.signal)
      return { kind: "failed" }
    }
  }
  if (!tmdbId) return { kind: "drop" }
  const title = typeof raw.name === "string" && raw.name
    ? raw.name
    : typeof raw.title === "string" && raw.title
      ? raw.title
      : null
  return {
    kind: "row",
    item: {
      tmdbId,
      imdbId: ref.kind === "imdb" ? ref.imdb : null,
      rank,
      title,
      mediaType,
    },
  }
}

/**
 * Read + project ONE imported addon catalog into ranking rows. Same remote
 * page the addon catalog passthrough serves, zero extra ranking fetches.
 */
export async function fetchAddonRanking(input: FetchAddonRankingInput): Promise<AddonRankingResult> {
  const addon = input.custom.addon
  const empty: AddonRankingResult = {
    status: "empty",
    items: [],
    window: ADDON_RANKING_TOP10,
    sourceKey: addon ? addonRankingSourceKey(addon) : "",
  }
  if (!addon) return empty
  const sourceKey = addonRankingSourceKey(addon)
  const key = addonRankingCacheKey(input)
  throwIfAborted(input.signal)
  const hit = cacheGet<CachedAddonRanking>(key)
  if (hit) return { status: hit.items.length > 0 ? "ok" : "empty", ...hit, sourceKey }

  const page = await raceWithAbort(fetchAddonCatalogPage(
    addon.manifestUrl,
    addon.catalogType,
    addon.catalogId,
    {},
    input.requestOrigin,
    addonQueryNamespace(input),
    input.signal,
  ), input.signal).catch((e: unknown) => {
    throwIfAborted(input.signal)
    log.warn("Addon ranking page failed", { error: e instanceof Error ? e.message : String(e) })
    return { items: [] as Array<Record<string, unknown>>, error: "unavailable" as const }
  })
  if ("error" in page) {
    return { status: "error", items: [], window: ADDON_RANKING_TOP10, sourceKey, errorStatus: page.error }
  }

  // Window: a 10-row source is a Top-10 chart, every other source is read as
  // an ordered list whose first 20 real positions drive the Top 20. The name
  // is never consulted (a "Top 10" label is not a contract).
  const window: AddonRankingResult["window"] =
    page.items.length <= ADDON_RANKING_TOP10 ? ADDON_RANKING_TOP10 : ADDON_RANKING_TOP20
  const candidates = page.items.slice(0, window).map((raw, idx) => ({
    raw,
    rank: idx + 1,
    mediaType: rowMediaType(raw, addon.catalogType),
  }))
  const slotType = input.slot === "movie" ? "movie" : "tv"
  const outcomes = await concurrentMap(
    candidates.filter((c) => c.mediaType === slotType),
    async (c) => resolveOne(c.raw, c.rank, c.mediaType, input),
    5,
  )
  throwIfAborted(input.signal)

  let keyMissing = false
  let failed = false
  const seen = new Set<number>()
  const items: AddonRankingItem[] = []
  for (const out of outcomes) {
    if (out.kind === "key_missing") {
      keyMissing = true
      continue
    }
    if (out.kind === "failed") {
      failed = true
      continue
    }
    if (out.kind !== "row" || seen.has(out.item.tmdbId)) continue
    seen.add(out.item.tmdbId)
    items.push(out.item)
  }
  if (keyMissing) {
    return { status: "error", items: [], window, sourceKey, errorStatus: "key_missing" }
  }
  if (failed) {
    return { status: "error", items: [], window, sourceKey, errorStatus: "unavailable" }
  }
  const cached: CachedAddonRanking = { items, window }
  // A projection cannot renew an older page's lifetime. Without source
  // provenance it remains usable for this request, but is not cached.
  const remainingMs = "expiresAt" in page && typeof page.expiresAt === "number"
    ? page.expiresAt - Date.now()
    : 0
  if (remainingMs > 0) {
    cacheSet(
      key,
      cached,
      ADDON_RANKING_TAGS,
      Math.min(remainingMs, items.length > 0 ? ADDON_RANKING_TTL_MS : ADDON_RANKING_EMPTY_TTL_MS),
    )
  }
  return { status: items.length > 0 ? "ok" : "empty", ...cached, sourceKey }
}
