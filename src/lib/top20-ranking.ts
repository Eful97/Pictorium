import { GLOBAL_REGION_CODE } from "./regions"
import { getJWRankings, getJWTitles, JW_DIGITAL_MONETIZATION_TYPES, type JWRankEntry } from "./justwatch"
import { fetchCustomRankingTop20, findRankingCustomCatalog, type CustomRankingResult } from "./custom-ranking"
import type { RankingSlot, RankingSource } from "./ranking-source"
import type { CustomCatalogConfig } from "./types"

export interface Top20RankItem {
  readonly tmdbId: number
  readonly imdbId: string | null
  readonly rank: number
  readonly title?: string | null
}

export type Top20RankingStatus = "ok" | "empty" | "unsupported" | "error"

export interface Top20RankingResult {
  readonly status: Top20RankingStatus
  readonly items: readonly Top20RankItem[]
  readonly period: "day" | "popular" | "trending" | "custom"
  readonly errorStatus?: string
}

export interface FetchTop20RankingInput {
  readonly slot: RankingSlot
  readonly source: RankingSource
  readonly regionCode: string
  readonly regionLang?: string
  readonly customCatalogs?: readonly CustomCatalogConfig[]
  readonly apiKey?: string
  readonly mdblistKey?: string
  readonly tvdbKey?: string
  readonly userId?: string | null
  readonly signal?: AbortSignal
  /**
   * Cycle-aware freshness floor (fixed chart cycles): forwarded to the
   * ranking source caches so pre-boundary payloads are refreshed in-slot.
   * Custom branches ignore it (excluded from chart cycles).
   */
  readonly minFetchedAtMs?: number
  /**
   * Strict chart-cycle mode: transport failure (including an open JustWatch
   * circuit) THROWS instead of resolving a conflated []. Genuine successful
   * empties still resolve `{status:"empty"}`. Legacy callers keep fail-open.
   */
  readonly strict?: boolean
}

/**
 * Single source of truth for Top 20 rankings across Stremio catalogs,
 * `/api/trending/rank` and poster rendering.
 *
 * Guaranteed invariants:
 * - At most 20 deduplicated items.
 * - Charts: keeps official JW ranks.
 * - Popular / Trending: positions 1..N based on list order, strictly digital monetization
 *   (FLATRATE, FREE, BUY, RENT, ADS; excludes cinema-only).
 * - Global region: Popular and Trending are unsupported (returns empty list fail-closed,
 *   never a silent fallback to US or any other region).
 * - Custom lists: positions 1..N based on normalized provider order.
 * - Never backfills short lists with items from other sources.
 */
export async function fetchTop20Ranking(input: FetchTop20RankingInput): Promise<Top20RankingResult> {
  const {
    slot,
    source,
    regionCode,
    regionLang = "it-IT",
    customCatalogs,
    apiKey,
    mdblistKey,
    tvdbKey,
    userId,
    signal,
    minFetchedAtMs,
    strict = false,
  } = input

  if (source.kind === "custom") {
    const customConfig = findRankingCustomCatalog(customCatalogs, source.customId)
    if (!customConfig) {
      return { status: "empty", items: [], period: "custom" }
    }
    const res: CustomRankingResult = await fetchCustomRankingTop20({
      custom: customConfig,
      slot,
      apiKey,
      mdblistKey,
      tvdbKey,
      userId,
      signal,
    })
    if (res.status === "empty") {
      return { status: "empty", items: [], period: "custom" }
    }
    if (res.status !== "ok") {
      return { status: "error", items: [], period: "custom", errorStatus: res.status }
    }
    const items: Top20RankItem[] = res.items.slice(0, 20).map((it, idx) => ({
      tmdbId: it.tmdbId,
      imdbId: it.imdb || null,
      rank: idx + 1,
      title: it.title || null,
    }))
    return {
      status: items.length > 0 ? "ok" : "empty",
      items,
      period: "custom",
    }
  }

  // JustWatch modes
  const isGlobal = regionCode.toUpperCase() === GLOBAL_REGION_CODE

  if (source.mode === "popular" || source.mode === "trending") {
    if (isGlobal) {
      // Global region is not supported for popular or trending rankings. Fail-closed: empty, no false ranks.
      return { status: "unsupported", items: [], period: source.mode }
    }

    // Shares the exact native first-20 window with the paginated Stremio
    // catalog page 0 (same first/offset/overfetch:false, unfiltered): with
    // duplicate or unresolvable upstream ids the two stay identical instead
    // of the overfetch-40 preview drifting from the page. Charts/custom and
    // the getJWTitles default (overfetch true) are untouched.
    // `strict` is forwarded only when true: the exact-options assertions in
    // top20-ranking.test.ts pin the legacy shape, and the key scheme is
    // unchanged either way.
    const rows = await getJWTitles({
      objectType: slot === "movie" ? "MOVIE" : "SHOW",
      country: regionCode,
      first: 20,
      offset: 0,
      sortBy: source.mode === "popular" ? "POPULAR" : "TRENDING",
      language: regionLang,
      monetizationTypes: JW_DIGITAL_MONETIZATION_TYPES,
      overfetch: false,
      signal,
      minFetchedAtMs,
      ...(strict ? { strict: true as const } : {}),
    })

    const seenTmdb = new Set<number>()
    const items: Top20RankItem[] = []
    let rank = 1
    for (const r of rows) {
      if (!r.tmdbId || seenTmdb.has(r.tmdbId)) continue
      seenTmdb.add(r.tmdbId)
      items.push({
        tmdbId: r.tmdbId,
        imdbId: r.imdbId || null,
        rank,
        title: r.title || null,
      })
      rank++
      if (items.length >= 20) break
    }

    return {
      status: items.length > 0 ? "ok" : "empty",
      items,
      period: source.mode,
    }
  }

  // Default: JustWatch charts. `strict` keeps the legacy 7-arg call shape
  // (pinned by top20-ranking.test.ts) unless the chart cycle needs failure
  // provenance — then the 8th arg opts into throw-on-transport-failure.
  const rows: JWRankEntry[] = strict
    ? await getJWRankings(
      slot === "movie" ? "MOVIE" : "SHOW",
      regionCode,
      20,
      undefined,
      regionLang,
      signal,
      minFetchedAtMs,
      true,
    )
    : await getJWRankings(
      slot === "movie" ? "MOVIE" : "SHOW",
      regionCode,
      20,
      undefined,
      regionLang,
      signal,
      minFetchedAtMs,
    )

  const seenTmdb = new Set<number>()
  const items: Top20RankItem[] = []
  for (const r of rows) {
    if (!r.tmdbId || seenTmdb.has(r.tmdbId)) continue
    seenTmdb.add(r.tmdbId)
    items.push({
      tmdbId: r.tmdbId,
      imdbId: r.imdbId || null,
      rank: r.rank,
      title: r.title || null,
    })
    if (items.length >= 20) break
  }

  return {
    status: items.length > 0 ? "ok" : "empty",
    items,
    period: "day",
  }
}
