/**
 * Default Top 20 lists remove/reset (task G).
 *
 * Pure, client-safe leaf: no imports from server/backend modules, no
 * persistence of its own. Persistence always flows through the existing
 * setters (`useCustomCatalogs` for catalog records, `setRankingSource`
 * for the two Top 20 source slots, `useLocalConfigToken` for the
 * profileless token) — this file only computes the next state slices.
 *
 * Scope: ONLY the two general JustWatch Top 20 factory lists
 * (`pictorium-jw-movies` / `pictorium-jw-series`). Added streaming
 * selections, custom catalogs, API keys, visual/global settings and the
 * anime rows are never touched here.
 */

export const DEFAULT_TOP20_MOVIE_CATALOG_ID = "pictorium-jw-movies"
export const DEFAULT_TOP20_SERIES_CATALOG_ID = "pictorium-jw-series"

/** Factory ids of the two removable/restorable default lists. */
export const DEFAULT_TOP20_CATALOG_IDS = [
  DEFAULT_TOP20_MOVIE_CATALOG_ID,
  DEFAULT_TOP20_SERIES_CATALOG_ID,
] as const

export type DefaultTop20CatalogId = (typeof DEFAULT_TOP20_CATALOG_IDS)[number]

/** True for the two factory default lists (never for custom/streaming ids). */
export function isDefaultTop20CatalogId(id: string): boolean {
  return id === DEFAULT_TOP20_MOVIE_CATALOG_ID || id === DEFAULT_TOP20_SERIES_CATALOG_ID
}

/**
 * Per-default removal = hide the factory row via the saved disabled list
 * (nondestructive: reset recovers it). Drops ONLY the default ids, every
 * unrelated entry is preserved verbatim and in order.
 */
export function withoutDefaultTop20Ids(ids: readonly string[]): string[] {
  return ids.filter((id) => !isDefaultTop20CatalogId(id))
}

/**
 * Removes ONLY the default-list keys from a shared catalog record
 * (renames/order-adjacent maps). Unrelated keys pass through untouched
 * (same object identity when nothing changes).
 */
export function withoutDefaultTop20Keys<T extends Record<string, unknown>>(record: T): T {
  if (!(DEFAULT_TOP20_MOVIE_CATALOG_ID in record) && !(DEFAULT_TOP20_SERIES_CATALOG_ID in record)) {
    return record
  }
  const next = { ...record }
  delete next[DEFAULT_TOP20_MOVIE_CATALOG_ID]
  delete next[DEFAULT_TOP20_SERIES_CATALOG_ID]
  return next
}

export interface DefaultListsState {
  disabledCatalogIds: readonly string[]
  homeDisabledCatalogIds: readonly string[]
  catalogRenames: Readonly<Record<string, string>>
  /** Raw Top 20 source slots (`""` = explicit/factory JustWatch charts). */
  rankingSourceMovie: string
  rankingSourceSeries: string
}

/**
 * True when any default-list configuration differs from factory: a default
 * row removed/hidden/renamed/home-hidden, or a Top 20 slot not on the
 * factory JustWatch charts source. Drives the visibility of the
 * "Ripristina liste predefinite" reset entry point (which then restores
 * exactly this slice). Order/shape entries are intentionally NOT part of
 * the signal: reset preserves custom ordering and card formats.
 */
export function areDefaultListsDirty(state: DefaultListsState): boolean {
  const { disabledCatalogIds, homeDisabledCatalogIds, catalogRenames, rankingSourceMovie, rankingSourceSeries } = state
  if (
    disabledCatalogIds.some(isDefaultTop20CatalogId) ||
    homeDisabledCatalogIds.some(isDefaultTop20CatalogId) ||
    DEFAULT_TOP20_MOVIE_CATALOG_ID in catalogRenames ||
    DEFAULT_TOP20_SERIES_CATALOG_ID in catalogRenames
  ) {
    return true
  }
  return rankingSourceMovie !== "" || rankingSourceSeries !== ""
}

/**
 * Per-list visibility of the two default rows. Each default renders
 * independently: removing the movies list never hides the series list.
 */
export function resolveDefaultTop20Visibility(disabledCatalogIds: readonly string[]): {
  showMovies: boolean
  showSeries: boolean
} {
  return {
    showMovies: !disabledCatalogIds.includes(DEFAULT_TOP20_MOVIE_CATALOG_ID),
    showSeries: !disabledCatalogIds.includes(DEFAULT_TOP20_SERIES_CATALOG_ID),
  }
}
