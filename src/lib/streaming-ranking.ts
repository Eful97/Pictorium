/**
 * Server-side Top-10 ranking source backed by an imported streaming list.
 *
 * The imported Top 10 catalogs already publish per-family snapshots (official
 * chart ranks 1..10, FlixPatrol or JustWatch per policy). When such a list is
 * explicitly selected as the global Top 20 source, catalogs, previews,
 * `/api/trending/rank` and the poster preflight MUST read the SAME pinned
 * rows: one list, one rank, zero extra chart fetches, zero invented
 * positions past the Top 10 window (a Top 10 chart never yields 11..20).
 *
 * Server-only (chart pin/publish + upstream fetch). The pure selection rules
 * live in `ranking-source.ts` (client-safe); this module only resolves
 * coordinates and reads the pinned family.
 */

import {
  CHART_LIVE_PIN_ID,
  pinnedFamilyRows,
  type ChartFamilyPin,
  type ChartRow,
} from "./chart-generation"
import { ensureFreshChartFamily } from "./chart-renewal"
import { rankingSectionFitsSlot, type RankingSlot } from "./ranking-source"
import {
  genericStreamFamily,
  genericSelectionRegionDef,
  parseAnyStreamingCatalogId,
  parseStreamingCatalogId,
  type GenericStreamingSection,
} from "./streaming-catalogs"

/** Chart coordinates of a derived streaming catalog id. */
export interface StreamingRankingCoordinates {
  /** Canonical chart family (`stream:<service>:<movie|series>` or `stream2:*`). */
  readonly family: string
  /** Selection country (never the request/global region). */
  readonly regionCode: string
  /** Selection metadata language. */
  readonly regionLang: string
  readonly section: GenericStreamingSection
}

/**
 * Resolve the pinned chart family + group coordinates of a streaming catalog
 * id. Null for anything that is not a served opt-in id (fail-closed: the
 * resolver already validated membership in this space's selections).
 */
export function streamingRankingCoordinates(catalogId: string): StreamingRankingCoordinates | null {
  const desc = parseAnyStreamingCatalogId(catalogId)
  if (!desc) return null
  // Legacy ids normalize to `auto`/base but keep their isolated `stream:`
  // family; generic ids fully encode source + section + variant.
  const legacy = parseStreamingCatalogId(catalogId) !== null
  const family = legacy
    ? `stream:${desc.service}:${desc.section === "movies" ? "movie" : "series"}`
    : genericStreamFamily(desc)
  const region = genericSelectionRegionDef(desc)
  return {
    family,
    regionCode: region.code,
    regionLang: region.lang,
    section: desc.section,
  }
}

export interface StreamingRankingItem {
  readonly tmdbId: number
  readonly imdbId: string | null
  /** Official chart position (1..10), never renumbered, clamped or remapped. */
  readonly rank: number
  readonly title: string | null
  readonly mediaType: "movie" | "tv"
}

export type StreamingRankingStatus = "ok" | "empty" | "error"

export interface StreamingRankingResult {
  readonly status: StreamingRankingStatus
  readonly items: readonly StreamingRankingItem[]
  readonly family: string
  readonly pin: ChartFamilyPin
  /** Provider-error detail surfaced by the catalog notice path. */
  readonly errorStatus?: string
}

/** Top-10 window: rows past it (never present in these families) are ignored. */
function isStreamingChartRank(rank: unknown): rank is number {
  return Number.isInteger(rank) && (rank as number) >= 1 && (rank as number) <= 10
}

function rowMediaType(row: ChartRow, section: GenericStreamingSection): "movie" | "tv" {
  if (row.mediaType === "movie" || row.mediaType === "tv") return row.mediaType
  // Mixed `all` charts without a per-row type follow the renewal default
  // (`all` rows are only ever produced for sections other than `series`).
  return section === "series" ? "tv" : "movie"
}

/**
 * Project a pinned family into slot-compatible ranking items. `mixed`/`all`
 * charts keep their real per-row media type and their OFFICIAL ranks: the
 * movie slot sees only movie rows (ranks may skip), never a renumbered or
 * cross-filled Top 10.
 *
 * Status contract: `error` only when there is no published snapshot at all
 * (cold failure — the caller surfaces it explicitly, never substitutes
 * another source's rows); a published empty or a slot with no matching rows
 * is a genuine `empty`.
 */
export function streamingRankingItemsFromPin(
  pin: ChartFamilyPin,
  slot: RankingSlot,
  coords: StreamingRankingCoordinates,
): StreamingRankingResult {
  if (!pin.snapshot) {
    return { status: "error", items: [], family: coords.family, pin, errorStatus: "unavailable" }
  }
  if (!rankingSectionFitsSlot(coords.section, slot)) {
    return { status: "empty", items: [], family: coords.family, pin }
  }
  const items: StreamingRankingItem[] = []
  for (const row of pinnedFamilyRows(pin) ?? []) {
    if (!row.tmdbId || !isStreamingChartRank(row.rank)) continue
    const mediaType = rowMediaType(row, coords.section)
    if (slot === "movie" && mediaType !== "movie") continue
    if (slot === "series" && mediaType !== "tv") continue
    items.push({
      tmdbId: row.tmdbId,
      imdbId: row.imdbId ?? null,
      rank: row.rank,
      title: row.title ?? null,
      mediaType,
    })
  }
  if (pin.snapshot.status === "empty" || items.length === 0) {
    return { status: "empty", items: [], family: coords.family, pin }
  }
  return { status: "ok", items, family: coords.family, pin }
}

export interface FetchStreamingRankingInput {
  readonly catalogId: string
  readonly slot: RankingSlot
  /** Caller deadline (poster watchdog, route phase budget). */
  readonly signal?: AbortSignal
}

/**
 * Refresh (awaited, bounded by the existing chart renewal) + read the pinned
 * family of ONE streaming list. Same published rows the list's own catalog
 * serves and the same generation fence. Renewal follows the selection's
 * FP/JW policy; it never fetches an unrelated general JustWatch chart.
 */
export async function fetchStreamingRanking(
  input: FetchStreamingRankingInput,
): Promise<StreamingRankingResult> {
  const coords = streamingRankingCoordinates(input.catalogId)
  if (!coords) {
    return {
      status: "empty",
      items: [],
      family: "",
      pin: { id: CHART_LIVE_PIN_ID, snapshot: null },
    }
  }
  const pin = await ensureFreshChartFamily({
    regionCode: coords.regionCode,
    regionLang: coords.regionLang,
    tmdbLang: coords.regionLang,
    family: coords.family,
    signal: input.signal,
  })
  return streamingRankingItemsFromPin(pin, input.slot, coords)
}
