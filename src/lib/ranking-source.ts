/**
 * Ranking source selection for the global Top 20 catalogs (movie/series).
 *
 * CLIENT-SAFE LEAF: zero imports, pure types + functions only. The future UI
 * (Settings/Catalogs selector) and tests import it in the browser without
 * pulling server modules (cache/KV/fs/network): a single node-only import in
 * here breaks the Turbopack build, same as `catalog-provider-detect.ts`.
 *
 * Minimal representation: `rankingSourceMovie` / `rankingSourceSeries` hold
 * the chosen custom catalog id, or are absent/empty (= JustWatch, the
 * retrocompatible default). The length bound (64) mirrors the custom catalog
 * id cap (`customCatalogSchema` in `config-token.ts` and `defaults/route.ts`).
 *
 * `enabled` semantics (documented choice): a custom with `enabled === false`
 * is explicitly switched off by the user and can NOT drive the Top 20, so the
 * resolver returns JustWatch. `disabledCatalogIds` / `homeDisabledCatalogIds` /
 * `catalogOrder` describe manifest visibility of other IDs and are ignored
 * here. A deleted id or an incompatible type also returns JustWatch.
 *
 * The resolver is selection only: it never fetches. A configured source that
 * is temporarily unavailable does NOT degrade to JustWatch here — the
 * catalog layer surfaces an explicit error instead (see `custom-ranking.ts`).
 */

import type { CustomCatalogConfig, CustomCatalogType } from "./types"

export type RankingSlot = "movie" | "series"

export type RankingSource =
  | { readonly kind: "justwatch" }
  | { readonly kind: "custom"; readonly customId: string }

/** Custom id cap, same bound as the persistence schemas. */
export const RANKING_SOURCE_MAX_ID_LENGTH = 64

export interface RankingSelection {
  readonly customCatalogs?: readonly CustomCatalogConfig[] | null
  readonly rankingSourceMovie?: string | null
  readonly rankingSourceSeries?: string | null
}

function selectionForSlot(selection: RankingSelection, slot: RankingSlot): string | null {
  return slot === "movie" ? (selection.rankingSourceMovie ?? null) : (selection.rankingSourceSeries ?? null)
}

function isCompatibleCustomType(customType: CustomCatalogType | undefined, slot: RankingSlot): boolean {
  if (customType === "mixed") return true
  return customType === slot
}

/**
 * Resolves the effective ranking source for one slot. Always returns a
 * value: JustWatch when nothing is selected, the selection is blank/invalid,
 * the id was deleted, the catalog is switched off (`enabled === false`), or
 * the custom type is incompatible (e.g. a `movie` custom on the series slot).
 * Stremio-addon imports (`addon` set) can never drive the Top 20: the ranking
 * service only understands normalized custom lists, so they fall back to
 * JustWatch like a deleted id.
 */
export function resolveRankingSource(selection: RankingSelection, slot: RankingSlot): RankingSource {
  const raw = selectionForSlot(selection, slot)
  if (typeof raw !== "string") return { kind: "justwatch" }
  const customId = raw.trim()
  if (!customId || customId.length > RANKING_SOURCE_MAX_ID_LENGTH) return { kind: "justwatch" }
  const customCatalogs = selection.customCatalogs
  if (!customCatalogs) return { kind: "justwatch" }
  const found = customCatalogs.find((c) => c.id === customId)
  if (!found || found.enabled === false || found.addon) return { kind: "justwatch" }
  if (!isCompatibleCustomType(found.type, slot)) return { kind: "justwatch" }
  return { kind: "custom", customId }
}

/** Minimal shape for slot filtering: only `mediatype` is read. */
export interface RankingFilterItem {
  readonly mediatype?: string | null
}

/**
 * Keeps the rows usable on one slot. Same rule as the custom catalog branch
 * in `catalog-handler.ts`: untyped rows pass on both slots, `movie` rows are
 * dropped on series and `show`/`tv`/`anime` rows on movie.
 */
export function filterRankingItemsBySlot<T extends RankingFilterItem>(
  items: readonly T[],
  slot: RankingSlot,
): T[] {
  return items.filter((it) => {
    const mt = it.mediatype ?? undefined
    if (slot === "movie") return mt !== "show" && mt !== "tv" && mt !== "anime"
    return mt !== "movie"
  })
}

/** Minimal shape for source pickers: id, display name, kind and flag. */
export interface RankingCustomOption {
  readonly id: string
  readonly name: string
  readonly type: "movie" | "series" | "mixed"
  readonly enabled?: boolean
}

/**
 * Custom catalogs eligible as a Top 20 source for one slot: enabled and
 * type-compatible (`mixed` fits both). Stremio-addon imports are excluded
 * (the ranking service cannot read them). Single source of truth for every
 * picker — never duplicate the rule in components.
 */
export function compatibleRankingCustoms<T extends RankingCustomOption>(
  customCatalogs: readonly T[] | undefined | null,
  slot: RankingSlot,
): T[] {
  if (!customCatalogs) return []
  return customCatalogs.filter(
    (c) => c.enabled !== false && (c.type === slot || c.type === "mixed") && !(c as { addon?: unknown }).addon,
  )
}

const JW_MOVIE_CATALOG_ID = "pictorium-jw-movies"
const JW_SERIES_CATALOG_ID = "pictorium-jw-series"

/**
 * Slots whose raw selection points at a deleted custom id. Called when a
 * custom catalog is removed so the raw reference is cleared (a same-id
 * reimport can not resurrect a stale selection). Disabling alone never
 * clears (re-enable restores the source).
 */
export function slotsReferencingCustom(
  rankingSourceMovie: string | null | undefined,
  rankingSourceSeries: string | null | undefined,
  deletedId: string,
): RankingSlot[] {
  const slots: RankingSlot[] = []
  if (rankingSourceMovie === deletedId) slots.push("movie")
  if (rankingSourceSeries === deletedId) slots.push("series")
  return slots
}

/** Fired vs latest rank-refresh coordinates (generation + title + user). */
export interface RankRefreshStamp {
  readonly gen: number
  readonly key: string
  readonly user: string | null
}

/**
 * Whether a rank refresh may still write: superseded calls, title switches
 * and user switches mid-flight all drop the write instead of stamping a
 * stale rank onto the new title.
 */
export function shouldApplyRankRefresh(fired: RankRefreshStamp, latest: RankRefreshStamp): boolean {
  return fired.gen === latest.gen && fired.key === latest.key && fired.user === latest.user
}
/**
 * Display name override for the global Top 20 catalogs: when a slot is driven
 * by a custom list, the manifest must not call it JustWatch, so the custom
 * catalog name wins. Returns null for every other catalog and for the
 * JustWatch default (the caller falls through to the regional JW name).
 * User renames still win: the caller checks them first.
 */
export function rankingSourceCatalogName(
  catalogId: string,
  slot: RankingSlot,
  selection: RankingSelection,
): string | null {
  const expected = slot === "movie" ? JW_MOVIE_CATALOG_ID : JW_SERIES_CATALOG_ID
  if (catalogId !== expected) return null
  const source = resolveRankingSource(selection, slot)
  if (source.kind !== "custom") return null
  const found = selection.customCatalogs?.find((c) => c.id === source.customId)
  const name = found?.name?.trim()
  return name ? name : null
}
