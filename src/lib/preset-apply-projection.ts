import { clearedExtraForPresetApply } from "./extra-materialize"
import { withReadyPresetExtraStyleReset } from "./quick-visual-presets"
import {
  applyLandscapeIsolated,
  applyPersonalLandscapeIsolated,
  applyPersonalPortraitIsolated,
  applyPortraitIsolated,
  withReadyPresetAgeOff,
  withReadyPresetLayoutFresh,
  withReadyPresetLayoutStandard,
  withReadyPresetWatchProvidersOff,
  type VisualPresetValues,
} from "./visual-presets"

type PresetShape = "portrait" | "landscape"

/** Live editor values the ready overlays read (layout, age, extra style). */
export type ProjectionEditor = {
  defaultPosterLayout?: unknown
  defaultPosterFreshScope?: unknown
  defaultAgeBadge?: unknown
  defaultExtraBadgeStyle?: unknown
  landscape?: unknown
}

/**
 * Full preset projection onto the live look (Preset tab AND community page,
 * so thumbnails always match what "Apply" stages).
 *
 * - Personal presets (no flags): `personalPresetProjection`.
 * - Ready looks (`ageOff` + `readyPin`, `freshPin` for Fresh): frozen
 *   contract + canonical layout, extra-style reset, age/watch-providers off.
 */
export function projectPreset(
  ed: ProjectionEditor,
  live: VisualPresetValues,
  desired: VisualPresetValues,
  shape: PresetShape,
  ageOff = false,
  readyPin = false,
  freshPin = false,
): VisualPresetValues {
  if (!ageOff && !readyPin) return personalPresetProjection(live, desired, shape)
  const isolated = shape === "landscape" ? applyLandscapeIsolated(live, desired) : applyPortraitIsolated(live, desired)
  // Delivery format never follows a preset (Badge tab precedent).
  const rest = { ...(isolated as unknown as Record<string, unknown>) }
  delete rest.defaultPosterShape
  // Ready canonical layout: Standard looks own Standard, Fresh owns
  // Fresh+ranked; the other shape's effective output stays frozen.
  const withLayout = ageOff
    ? (freshPin ? withReadyPresetLayoutFresh(ed, rest, shape) : withReadyPresetLayoutStandard(ed, rest, shape))
    : rest
  // Ready looks return the edited shape to follow-own-rank extra style
  // (live `ed`: the schema-stripped capture drops the standalone key).
  const withExtra = readyPin ? withReadyPresetExtraStyleReset(withLayout, shape, ed) : withLayout
  if (!ageOff) return withExtra as unknown as VisualPresetValues
  const liveAge = { defaultAgeBadge: ed.defaultAgeBadge, landscape: ed.landscape }
  return withReadyPresetWatchProvidersOff(withReadyPresetAgeOff(liveAge, withExtra, shape), shape) as unknown as VisualPresetValues
}

/**
 * Personal-preset projection onto the live look: the preset owns its full
 * visual recipe for the target shape (personal isolated helpers), while the
 * delivery format never follows a preset. Shared by the Preset tab and the
 * community page so a thumbnail always matches what "Apply" produces.
 */
export function personalPresetProjection(live: VisualPresetValues, desired: VisualPresetValues, shape: PresetShape): VisualPresetValues {
  const isolated = shape === "landscape" ? applyPersonalLandscapeIsolated(live, desired) : applyPersonalPortraitIsolated(live, desired)
  const rest = { ...(isolated as unknown as Record<string, unknown>) }
  delete rest.defaultPosterShape
  return rest as unknown as VisualPresetValues
}

/**
 * The shared target-extra cleanup the staged/provider applyVisualPreset
 * performs (a legacy look without extra clears the target's missing/null
 * extra axes to null): projection + this = COMPLETE post-apply snapshot.
 */
export function withTargetExtraCleanup(projected: VisualPresetValues, shape: PresetShape): VisualPresetValues {
  const isolated = { ...(projected as unknown as Record<string, unknown>) }
  if (shape === "landscape") {
    const land = isolated.landscape
    if (land != null && typeof land === "object") {
      const l = { ...(land as Record<string, unknown>) }
      const cleared = clearedExtraForPresetApply(
        { scale: l.topBadgeScale as number | null | undefined, offsetX: l.topBadgeOffsetX as number | null | undefined, offsetY: l.topBadgeOffsetY as number | null | undefined },
        { scale: l.extraBadgeScale as number | null | undefined, offsetX: l.extraBadgeOffsetX as number | null | undefined, offsetY: l.extraBadgeOffsetY as number | null | undefined },
      )
      if (cleared) {
        l.extraBadgeScale = cleared.scale
        l.extraBadgeOffsetX = cleared.offsetX
        l.extraBadgeOffsetY = cleared.offsetY
      }
      isolated.landscape = l
    }
  } else {
    const cleared = clearedExtraForPresetApply(
      { scale: isolated.defaultTopBadgeScale as number | null | undefined, offsetX: isolated.defaultTopBadgeOffsetX as number | null | undefined, offsetY: isolated.defaultTopBadgeOffsetY as number | null | undefined },
      { scale: isolated.defaultExtraBadgeScale as number | null | undefined, offsetX: isolated.defaultExtraBadgeOffsetX as number | null | undefined, offsetY: isolated.defaultExtraBadgeOffsetY as number | null | undefined },
    )
    if (cleared) {
      isolated.defaultExtraBadgeScale = cleared.scale
      isolated.defaultExtraBadgeOffsetX = cleared.offsetX
      isolated.defaultExtraBadgeOffsetY = cleared.offsetY
    }
  }
  return isolated as unknown as VisualPresetValues
}
