import { normalizeCatalogId } from "./catalog-definitions"
import type { Mapping, PosterShape } from "./types"

/**
 * Per-catalog card format override, keyed by the actual manifest/route
 * catalog id (e.g. `pictorium-jw-movies`, `pictorium-custom-movie-<base>`).
 * Persisted values are ONLY `poster` (vertical) or `landscape` (horizontal);
 * an absent/deleted key means "follow the global setting".
 *
 * Contract (user-explicit choice, not a hint):
 * - explicit `poster` ALWAYS forces portrait for that catalog, regardless of
 *   the global default or the per-title mapping;
 * - explicit `landscape` ALWAYS forces landscape for that catalog, regardless
 *   of the global default or the per-title mapping;
 * - absent key behaves BYTE-identically to `stremioPosterShape(mapping,
 *   defaults)` (global landscape forces portrait mappings to landscape;
 *   global portrait still honors a per-title landscape mapping).
 * The stored mapping is never rewritten and other catalogs are unaffected.
 * `/meta` keeps its global resolution (no catalog context is invented).
 */
export type CatalogShapeOverride = PosterShape

export type CatalogShapes = Record<string, CatalogShapeOverride>

/**
 * Dual-format saved title: the mapping owns BOTH base families, so the
 * catalog/meta delivery serves both canvases at once (portrait `poster` +
 * landscape `landscapePoster`) instead of collapsing them into one shape.
 *
 * Portrait base = `posterPath` / `customPosterUrl` / `portraitBackdropPath`
 * (the `posterPath` family is always written by a save). Landscape base =
 * `backdropPath` / `customBackdropUrl`: a portrait save writes `backdropPath`
 * from the previous mapping (null when the title never saved a landscape
 * base), so its presence is the marker of a genuinely saved landscape cover.
 * A landscape save left on the automatic TMDB backdrop stores no base and is
 * NOT dual: single-format shape resolution stays byte-identical for it.
 */
export function mappingHasBothShapeBases(mapping: Mapping | null | undefined): boolean {
  if (!mapping) return false
  const portraitBase =
    Boolean(mapping.posterPath) ||
    Boolean(mapping.customPosterUrl) ||
    Boolean(mapping.portraitBackdropPath)
  const landscapeBase = Boolean(mapping.backdropPath) || Boolean(mapping.customBackdropUrl)
  return portraitBase && landscapeBase
}

export const CATALOG_SHAPES_STORAGE_KEY = "pictorium_catalog_shapes"

/** Reasonable cap mirroring the existing catalog record bounds. */
export const MAX_CATALOG_SHAPES = 200

export const MAX_CATALOG_SHAPE_KEY_LENGTH = 80

const FORBIDDEN_SHAPE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
])

export function isCatalogShapeOverride(value: unknown): value is CatalogShapeOverride {
  return value === "poster" || value === "landscape"
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Strict client/import sanitizer: drops prototype-pollution keys, legacy
 * `posterium-*` keys are normalized to `pictorium-*`, over-long keys,
 * unknown enums and over-cap entries are skipped (never defaulted).
 */
export function sanitizeCatalogShapes(input: unknown): CatalogShapes {
  const out: CatalogShapes = {}
  if (!isPlainRecord(input)) return out
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (count >= MAX_CATALOG_SHAPES) break
    if (FORBIDDEN_SHAPE_KEYS.has(rawKey)) continue
    if (typeof rawKey !== "string" || rawKey.length === 0) continue
    const key = normalizeCatalogId(rawKey)
    if (FORBIDDEN_SHAPE_KEYS.has(key)) continue
    if (key.length === 0 || key.length > MAX_CATALOG_SHAPE_KEY_LENGTH) continue
    if (!isCatalogShapeOverride(rawValue)) continue
    if (Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = rawValue
    count += 1
  }
  return out
}

/**
 * Read-path normalizer for server/token payloads (zod already enforces the
 * enum on PUT/token, this only normalizes legacy ids and drops
 * prototype-pollution keys). `undefined`/`null` pass through as `undefined`
 * so "absent" (inherit) stays distinct from "explicit empty" (cleared).
 */
export function normalizeCatalogShapeKeys(
  record: Record<string, string> | Record<string, CatalogShapeOverride> | undefined | null,
): CatalogShapes | undefined {
  if (record === undefined || record === null) return undefined
  if (!isPlainRecord(record)) return {}
  const out: CatalogShapes = {}
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(record)) {
    if (count >= MAX_CATALOG_SHAPES) break
    if (FORBIDDEN_SHAPE_KEYS.has(rawKey)) continue
    const key = normalizeCatalogId(rawKey)
    if (FORBIDDEN_SHAPE_KEYS.has(key)) continue
    if (key.length === 0 || key.length > MAX_CATALOG_SHAPE_KEY_LENGTH) continue
    if (!isCatalogShapeOverride(rawValue)) continue
    if (Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = rawValue
    count += 1
  }
  return out
}

/**
 * Explicit per-catalog override for a (possibly legacy) route id. Own-property
 * lookup only: no prototype chain, no pollution. Returns `undefined` when the
 * catalog follows the global setting.
 */
export function getExplicitCatalogShape(
  catalogId: string,
  shapes: CatalogShapes | Record<string, string> | undefined | null,
): CatalogShapeOverride | undefined {
  if (!shapes || typeof shapes !== "object" || Array.isArray(shapes)) return undefined
  const key = normalizeCatalogId(catalogId)
  if (FORBIDDEN_SHAPE_KEYS.has(key)) return undefined
  if (!Object.prototype.hasOwnProperty.call(shapes, key)) return undefined
  const value = (shapes as Record<string, unknown>)[key]
  return isCatalogShapeOverride(value) ? value : undefined
}
