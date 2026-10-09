import { effectiveMappingForShape, isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE, type Mapping, type PosterLayout, type PosterFreshScope, type PosterShape } from "./types"
import type { LandscapeServerDefaults } from "./server-defaults"

/**
 * Effective shape default for the graphical poster layout (`land ?? flat`).
 * Matches the server `effectiveDefaultsForShape` rule for `posterLayout`:
 * in landscape a defined profile value wins, absent keys follow the flat.
 * Invalid flats fail closed to "standard" (same as the server resolver).
 */
export function effectiveShapeDefaultLayout(
  defaultPosterLayout: PosterLayout,
  landscape: LandscapeServerDefaults | null | undefined,
  shape: PosterShape,
): PosterLayout {
  const flat = isPosterLayout(defaultPosterLayout) ? defaultPosterLayout : "standard"
  if (shape !== "landscape") return flat
  const land = landscape?.posterLayout
  return isPosterLayout(land) ? land : flat
}

/**
 * Open/load resolution for the editor (no query/config at this layer:
 * those override at render). Precedence: effective mapping
 * (`mapping.landscape` > flat per key, via `effectiveMappingForShape`) >
 * effective shape default (`landscapeDefaults.posterLayout` > flat).
 * Matches the server `resolvePosterLayout` chain without query/config.
 */
export function resolveOpenPosterLayout(
  mapping: Mapping | null,
  shape: PosterShape,
  defaultPosterLayout: PosterLayout,
  landscape: LandscapeServerDefaults | null | undefined,
): PosterLayout {
  const eff = effectiveMappingForShape(mapping, shape)
  if (isPosterLayout(eff?.posterLayout)) return eff.posterLayout
  return effectiveShapeDefaultLayout(defaultPosterLayout, landscape, shape)
}

/**
 * Effective shape default for the Fresh apply scope (`land ?? flat`).
 * Matches the server `effectiveDefaultsForShape` rule for
 * `posterFreshScope`: in landscape a defined profile value wins, absent keys
 * follow the flat. Invalid flats fail closed to "ranked" (same as the server
 * resolver, the shared default).
 */
export function effectiveShapeDefaultFreshScope(
  defaultPosterFreshScope: PosterFreshScope,
  landscape: LandscapeServerDefaults | null | undefined,
  shape: PosterShape,
): PosterFreshScope {
  const flat = isPosterFreshScope(defaultPosterFreshScope) ? defaultPosterFreshScope : DEFAULT_POSTER_FRESH_SCOPE
  if (shape !== "landscape") return flat
  const land = landscape?.posterFreshScope
  return isPosterFreshScope(land) ? land : flat
}

/**
 * Open/load resolution for the editor scope (no query/config at this layer:
 * those override at render). Precedence: effective mapping
 * (`mapping.landscape` > flat per key, via `effectiveMappingForShape`) >
 * effective shape default (`landscapeDefaults.posterFreshScope` > flat).
 * Matches the server `resolvePosterFreshScope` chain without query/config.
 * The stored preference is kept even when Standard is selected, so switching
 * back to Fresh restores the choice.
 */
export function resolveOpenPosterFreshScope(
  mapping: Mapping | null,
  shape: PosterShape,
  defaultPosterFreshScope: PosterFreshScope,
  landscape: LandscapeServerDefaults | null | undefined,
): PosterFreshScope {
  const eff = effectiveMappingForShape(mapping, shape)
  if (isPosterFreshScope(eff?.posterFreshScope)) return eff.posterFreshScope
  return effectiveShapeDefaultFreshScope(defaultPosterFreshScope, landscape, shape)
}
