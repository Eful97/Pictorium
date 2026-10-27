"use client"

import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import { getQualityBadgeOffsetDefault, getSeparateBadgeDefaultScale, isExtraBadgeStyle, isExtraFollowRank } from "@/lib/badge-styles"
import { NATURAL_GRADIENT_DEFAULTS } from "@/lib/gradient-presets"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { baselineFlat, baselineLandscape, type ActivePresetBaseline } from "@/lib/active-preset-baseline"
import {
  isQualityItemId,
  isRatingItemId,
  parseBadgeItemTransforms,
  rejoinBadgeItems,
  serializeBadgeItemTransforms,
  withBadgeItemTransform,
  withoutBadgeItemFamily,
  withoutBadgeItemTransform,
  type BadgeItemTransform,
  type BadgeItemTransformMap,
} from "@/lib/badge-item-transforms"

export type BadgeShapeTarget = "portrait" | "landscape"

/** One geometry family of the badge editor (same set as the renderer report). */
export type BadgeGeometryFamily = "rank" | "extra" | "genre" | "quality" | "separate" | "network" | "logo"

/**
 * One pending geometry write of a family: the offsets (and, only for the
 * complete fallback top slot, the scale). A batch of these is applied with a
 * SINGLE state write, so moving several selected groups together cannot lose
 * all but the last one to React batching.
 */
export interface BadgeFamilyMove {
  readonly family: BadgeGeometryFamily
  readonly offsetX: number
  readonly offsetY: number
  /** Non-null only when the write must materialize the family scale. */
  readonly scale?: number | null
}

/** One pending per-ITEM correction of a batch (neutral = removed). */
export interface BadgeItemMove {
  readonly id: string
  readonly transform: BadgeItemTransform
}

/**
 * Scoped badge-default bindings for the Badge tab edit target.
 * Portrait reads/writes the shared flats; landscape reads
 * `land[key] ?? flat` and writes the landscape profile. Absent keys follow
 * the portrait EFFECTIVE value at rest (legacy appearance preserved), but a
 * portrait edit atomically snapshots the pre-edit value into the profile
 * (see `update` in useDefaults + the PUT backfill), so the follow never
 * leaks after an edit — strict per-shape independence. Explicit `null` on
 * null-inheriting keys (fonts, formats, follow toggle, age style, logo
 * align) keeps inheriting per the canonical contract; logo/extra-tuning
 * `null`s stay explicit (auto/zero). The standalone extra style is its own
 * case: legacy profile `null`/absent inherits the flat (old contract); only
 * the explicit "follow-rank" sentinel shadows the portrait flat (see
 * `scoped` below), so a portrait extra edit can never leak across shapes.
 * Data sources, endpoints, region, date format and API settings stay global
 * and are intentionally absent here (callers keep the root setters).
 */
export function useShapeBadgeDefaults(shape: BadgeShapeTarget | undefined) {
  const ed = usePosterEditor()
  const isLandscape = shape === "landscape"
  const land = ed.landscape
  function scoped<T>(
    landKey: keyof LandscapeServerDefaults,
    flatValue: T,
    setFlat: (v: T) => void,
  ): readonly [T, (v: T) => void] {
    if (!isLandscape) return [flatValue, setFlat] as const
    // Standalone extra style: only the explicit "follow-rank" sentinel
    // shadows the portrait flat (a `??` read would resurrect the portrait
    // style in the editor). Legacy profile null/absent/invalid keeps the
    // canonical `??` follow (inherit the flat).
    if (landKey === "extraBadgeStyle" && "extraBadgeStyle" in land) {
      const raw = (land as { extraBadgeStyle?: unknown }).extraBadgeStyle
      if (isExtraFollowRank(raw) || isExtraBadgeStyle(typeof raw === "string" ? raw : null)) {
        const owned = raw as T
        const setOwned = (v: T) => {
          ed.setLandscape({ [landKey]: v } as Partial<LandscapeServerDefaults>)
        }
        return [owned, setOwned] as const
      }
    }
    const value = (land[landKey] ?? flatValue) as T
    const set = (v: T) => {
      ed.setLandscape({ [landKey]: v } as Partial<LandscapeServerDefaults>)
    }
    return [value, set] as const
  }
  return { isLandscape, scoped }
}

/** Landscape visual keys owned by the Badge tab (reset scope, presets stay out of numerics). */
export const BADGE_VISUAL_LAND_KEYS = [
  "globalBadges",
  "rankingBadges",
  "badgeGenre",
  "badgeYear",
  "badgeRating",
  "badgeQuality",
  "customRatings",
  "separateRatings",
  "separateRatingsStyle",
  "badgeStyle",
  "rankingBadgeStyle",
  "extraBadgeStyle",
  "badgeFont",
  "qualityBadgeStyle",
  "videoFormats",
  "sashOrder",
  "networkLogo",
  "networkLogoPosition",
  "networkLogoFollowTitle",
  "preRelease",
  "ribbonSide",
  "ribbonEnabled",
  "logoAlign",
  "posterLayout",
  "posterFreshScope",
] as const satisfies readonly (keyof LandscapeServerDefaults)[]

/** Flat/profile keys owned by each geometry family (reset scope). */
const FAMILY_TRANSFORM_KEYS: Record<BadgeGeometryFamily, { flat: readonly string[]; land: readonly (keyof LandscapeServerDefaults)[] }> = {
  rank: {
    flat: ["defaultTopBadgeScale", "defaultTopBadgeOffsetX", "defaultTopBadgeOffsetY"],
    land: ["topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY"],
  },
  extra: {
    flat: ["defaultExtraBadgeScale", "defaultExtraBadgeOffsetX", "defaultExtraBadgeOffsetY"],
    land: ["extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY"],
  },
  genre: {
    flat: ["defaultGenreBadgeScale", "defaultGenreBadgeOffsetX", "defaultGenreBadgeOffsetY"],
    land: ["genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY"],
  },
  quality: {
    flat: ["defaultQualityBadgeScale", "defaultQualityBadgeOffsetX", "defaultQualityBadgeOffsetY"],
    land: ["qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY"],
  },
  separate: {
    flat: ["defaultSeparateBadgeScale", "defaultSeparateBadgeOffsetX", "defaultSeparateBadgeOffsetY"],
    land: ["separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY"],
  },
  network: {
    flat: ["defaultNetworkLogoScale", "defaultNetworkLogoOffsetX", "defaultNetworkLogoOffsetY"],
    land: ["networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY"],
  },
  logo: {
    flat: ["defaultLogoScale", "defaultLogoOffsetX", "defaultLogoOffsetY"],
    land: ["logoScale", "logoOffsetX", "logoOffsetY"],
  },
}

/** Gradient/blur keys of the Transform reset group (both layers). */
const GRADIENT_FLAT_KEYS = [
  "defaultBlurEnabled",
  "defaultGradientHeight",
  "defaultBlurIntensity",
  "defaultBlurFade",
  "defaultBlurDarkness",
  "defaultTintStrength",
  "defaultTopShade",
  "defaultTopShadeHeight",
] as const
const GRADIENT_LAND_KEYS = [
  "blurEnabled",
  "gradientHeight",
  "blurIntensity",
  "blurFade",
  "blurDarkness",
  "tintStrength",
  "topShade",
  "topShadeHeight",
] as const satisfies readonly (keyof LandscapeServerDefaults)[]

/** Canonical factory fallback for one flat visual default (no active preset). */
function canonicalFlatDefault(key: string): unknown {
  switch (key) {
    case "defaultTopBadgeScale":
    case "defaultGenreBadgeScale":
    case "defaultQualityBadgeScale":
    case "defaultNetworkLogoScale":
      return 100
    case "defaultExtraBadgeScale":
    case "defaultExtraBadgeOffsetX":
    case "defaultExtraBadgeOffsetY":
    case "defaultLogoScale":
      return null
    case "defaultQualityBadgeOffsetX":
      return getQualityBadgeOffsetDefault("poster", "x")
    case "defaultQualityBadgeOffsetY":
      return getQualityBadgeOffsetDefault("poster", "y")
    case "defaultLogoOffsetX":
    case "defaultLogoOffsetY":
      return null
    case "defaultBlurEnabled":
      return NATURAL_GRADIENT_DEFAULTS.blurEnabled
    case "defaultGradientHeight":
      return NATURAL_GRADIENT_DEFAULTS.gradientHeight
    case "defaultBlurIntensity":
      return NATURAL_GRADIENT_DEFAULTS.blurIntensity
    case "defaultBlurFade":
      return NATURAL_GRADIENT_DEFAULTS.blurFade
    case "defaultBlurDarkness":
      return NATURAL_GRADIENT_DEFAULTS.blurDarkness
    case "defaultTintStrength":
      return NATURAL_GRADIENT_DEFAULTS.tintStrength
    case "defaultTopShade":
      return 50
    case "defaultTopShadeHeight":
      return 25
    default:
      return 0
  }
}

function setPortraitFlat(ed: ReturnType<typeof usePosterEditor>, key: string, value: unknown): void {
  switch (key) {
    case "defaultTopBadgeScale":
      ed.setDefaultTopBadgeScale(value as number)
      return
    case "defaultTopBadgeOffsetX":
      ed.setDefaultTopBadgeOffsetX(value as number)
      return
    case "defaultTopBadgeOffsetY":
      ed.setDefaultTopBadgeOffsetY(value as number)
      return
    case "defaultExtraBadgeScale":
      ed.setDefaultExtraBadgeScale(value as number | null)
      return
    case "defaultExtraBadgeOffsetX":
      ed.setDefaultExtraBadgeOffsetX(value as number | null)
      return
    case "defaultExtraBadgeOffsetY":
      ed.setDefaultExtraBadgeOffsetY(value as number | null)
      return
    case "defaultGenreBadgeScale":
      ed.setDefaultGenreBadgeScale(value as number)
      return
    case "defaultGenreBadgeOffsetX":
      ed.setDefaultGenreBadgeOffsetX(value as number)
      return
    case "defaultGenreBadgeOffsetY":
      ed.setDefaultGenreBadgeOffsetY(value as number)
      return
    case "defaultQualityBadgeScale":
      ed.setDefaultQualityBadgeScale(value as number)
      return
    case "defaultQualityBadgeOffsetX":
      ed.setDefaultQualityBadgeOffsetX(value as number)
      return
    case "defaultQualityBadgeOffsetY":
      ed.setDefaultQualityBadgeOffsetY(value as number)
      return
    case "defaultSeparateBadgeScale":
      ed.setDefaultSeparateBadgeScale(value as number)
      return
    case "defaultSeparateBadgeOffsetX":
      ed.setDefaultSeparateBadgeOffsetX(value as number)
      return
    case "defaultSeparateBadgeOffsetY":
      ed.setDefaultSeparateBadgeOffsetY(value as number)
      return
    case "defaultNetworkLogoFollowTitle":
      ed.setDefaultNetworkLogoFollowTitle(value as boolean)
      return
    case "defaultNetworkLogoScale":
      ed.setDefaultNetworkLogoScale(value as number)
      return
    case "defaultNetworkLogoOffsetX":
      ed.setDefaultNetworkLogoOffsetX(value as number)
      return
    case "defaultNetworkLogoOffsetY":
      ed.setDefaultNetworkLogoOffsetY(value as number)
      return
    case "defaultLogoScale":
      ed.setDefaultLogoScale(value as number | null)
      return
    case "defaultLogoOffsetX":
      ed.setDefaultLogoOffsetX(value as number | null)
      return
    case "defaultLogoOffsetY":
      ed.setDefaultLogoOffsetY(value as number | null)
      return
    case "defaultBlurEnabled":
      ed.setDefaultBlurEnabled(value as boolean)
      return
    case "defaultGradientHeight":
      ed.setDefaultGradientHeight(value as number)
      return
    case "defaultBlurIntensity":
      ed.setDefaultBlurIntensity(value as number)
      return
    case "defaultBlurFade":
      ed.setDefaultBlurFade(value as number)
      return
    case "defaultBlurDarkness":
      ed.setDefaultBlurDarkness(value as number)
      return
    case "defaultTintStrength":
      ed.setDefaultTintStrength(value as number)
      return
    case "defaultTopShade":
      ed.setDefaultTopShade(value as number)
      return
    case "defaultTopShadeHeight":
      ed.setDefaultTopShadeHeight(value as number)
  }
}

function baselineItemTransforms(
  baseline: ActivePresetBaseline | null,
  shape: "poster" | "landscape",
): BadgeItemTransformMap | null {
  if (!baseline) return null
  const raw = shape === "landscape"
    ? (baseline.snapshot.landscape as Record<string, unknown> | undefined)?.badgeItemTransforms
    : baseline.snapshot.defaultBadgeItemTransforms
  return parseBadgeItemTransforms(typeof raw === "string" ? raw : null)
}

/**
 * Shape-scoped geometry values for the preview drag handles.
 *
 * Reads the same EFFECTIVE values the renderer uses (`land[key] ?? flat`, with
 * the per-axis extra→classifica legacy fallback), and writes back to the same
 * layer the Transform sliders write: the landscape profile for the landscape
 * preview, the shared flats for portrait. Writes are atomic per drag (one
 * `setLandscape` patch, so the existing classifica→extra materialization runs
 * once) and never invent new keys.
 */
export function useShapeBadgeGeometryDefaults(shape: "poster" | "landscape") {
  const ed = usePosterEditor()
  const isLandscape = shape === "landscape"
  const land = ed.landscape
  const activeBaseline = ed.activePresetBaselines?.[isLandscape ? "landscape" : "portrait"] ?? null
  const activeBaselineItems = baselineItemTransforms(activeBaseline, shape)

  // Same per-key rule as the preview URL builder for the always-concrete
  // families: a profile value wins, absent/null follows the flat.
  const landOr = <T,>(key: keyof LandscapeServerDefaults, flat: T): T => {
    if (!isLandscape) return flat
    return ((land[key] ?? flat) as T)
  }
  const pick = <T,>(value: T | undefined, flat: T | null): T | null =>
    value !== undefined ? value : flat

  // Ranked top slot ("with ranking"): the classifica profile of the shape.
  const topBadgeScale = landOr("topBadgeScale", ed.defaultTopBadgeScale)
  const topBadgeOffsetX = landOr("topBadgeOffsetX", ed.defaultTopBadgeOffsetX)
  const topBadgeOffsetY = landOr("topBadgeOffsetY", ed.defaultTopBadgeOffsetY)

  // Fallback top slot ("without ranking": extra badge): its own COMPLETE
  // profile, else the legacy axis-by-axis inherit of the ranked one — exactly
  // the resolution the preview URL and the renderer apply.
  const extraScaleRaw = pick(
    isLandscape ? land.extraBadgeScale : undefined,
    ed.defaultExtraBadgeScale,
  )
  const extraOffsetXRaw = pick(
    isLandscape ? land.extraBadgeOffsetX : undefined,
    ed.defaultExtraBadgeOffsetX,
  )
  const extraOffsetYRaw = pick(
    isLandscape ? land.extraBadgeOffsetY : undefined,
    ed.defaultExtraBadgeOffsetY,
  )

  // Title logo offsets: position only while dragging (scale has its own
  // control, null = auto-fit). Landscape nullable profile with the preview
  // URL's `?? 0`.
  const logoScale = (isLandscape ? pick(land.logoScale, ed.defaultLogoScale) : ed.defaultLogoScale)
  const logoOffsetX = (isLandscape ? pick(land.logoOffsetX, ed.defaultLogoOffsetX) : ed.defaultLogoOffsetX) ?? 0
  const logoOffsetY = (isLandscape ? pick(land.logoOffsetY, ed.defaultLogoOffsetY) : ed.defaultLogoOffsetY) ?? 0

  /**
   * Per-ITEM corrections of the ACTIVE shape (stable identity, never an array
   * index). Read resolves exactly like the preview URL builder and the
   * renderer: `undefined` (key absent) follows the flat, an OWNED profile value
   * — including the explicit `null` a preset writes, meaning "automatic" —
   * wins. Reading `null` through `??` would surface the OTHER shape's portrait
   * corrections as if they were this shape's, and the first drag would then
   * write "that shape's value + delta" onto a badge the renderer places
   * automatically.
   */
  const itemTransforms: BadgeItemTransformMap = parseBadgeItemTransforms(
    isLandscape
      ? (land.badgeItemTransforms !== undefined ? land.badgeItemTransforms : ed.defaultBadgeItemTransforms)
      : ed.defaultBadgeItemTransforms,
  )
  const setItemTransforms = (next: BadgeItemTransformMap) => {
    const serialized = serializeBadgeItemTransforms(next)
    if (isLandscape) ed.setLandscape({ badgeItemTransforms: serialized })
    else ed.setDefaultBadgeItemTransforms(serialized)
  }
  /** One item correction (neutral = removed: automatic layout again). */
  const setItemTransform = (id: string, transform: BadgeItemTransform) => {
    setItemTransforms(withBadgeItemTransform(itemTransforms, id, transform))
  }
  /**
   * Several item corrections in ONE write (multi-selection drag). Neutral
   * entries are removed by `withBadgeItemTransform`, so moving a corrected pill
   * back onto its automatic slot restores the automatic layout instead of
   * leaving a stale correction behind.
   */
  const applyItemMoves = (moves: readonly BadgeItemMove[]) => {
    if (moves.length === 0) return
    const base = itemTransforms
    const next = moves.reduce<BadgeItemTransformMap>(
      (acc, move) => withBadgeItemTransform(acc, move.id, move.transform),
      base,
    )
    // Portrait reads the functional updater so a queued write cannot be
    // clobbered by a stale closure; landscape resolves from the same base in
    // the single patch below (one call per gesture either way).
    if (!isLandscape) {
      ed.setDefaultBadgeItemTransforms((prev) => {
        const prevMap = parseBadgeItemTransforms(prev)
        const applied = moves.reduce<BadgeItemTransformMap>(
          (acc, move) => withBadgeItemTransform(acc, move.id, move.transform),
          prevMap,
        )
        return serializeBadgeItemTransforms(applied)
      })
      return
    }
    setItemTransforms(next)
  }
  /** Reset ONE item: with an applied preset restore that preset's own item
   *  correction (or automatic layout when it had none); otherwise remove the
   *  current correction. Group transforms and every other item stay untouched. */
  const resetItem = (id: string) => {
    if (activeBaseline) {
      const base = activeBaselineItems?.[id]
      setItemTransforms(base
        ? withBadgeItemTransform(itemTransforms, id, base)
        : withoutBadgeItemTransform(itemTransforms, id))
      return
    }
    setItemTransforms(withoutBadgeItemTransform(itemTransforms, id))
  }
  /** Reset several items in ONE write (multi-selection), same baseline rule. */
  const resetItems = (ids: readonly string[]) => {
    if (ids.length === 0) return
    const next = ids.reduce<BadgeItemTransformMap>((acc, id) => {
      if (!activeBaseline) return withoutBadgeItemTransform(acc, id)
      const base = activeBaselineItems?.[id]
      return base
        ? withBadgeItemTransform(acc, id, base)
        : withoutBadgeItemTransform(acc, id)
    }, itemTransforms)
    setItemTransforms(next)
  }

  /** Write only when the canonical wire form actually changes (a rejoin of an
   *  already-clean map must not dirty the draft nor raise a false conflict). */
  const commitItemTransforms = (next: BadgeItemTransformMap) => {
    if (serializeBadgeItemTransforms(next) === serializeBadgeItemTransforms(itemTransforms)) return
    setItemTransforms(next)
  }
  /**
   * Explicit REJOIN (recovery control, NOT a reset) of a whole selection in ONE
   * write: family-wide drops plus single identities.
   *
   * - every listed FAMILY loses every stored correction it owns — including the
   *   identities that are CURRENTLY NOT PAINTED (a `quality:format:<fmt>`
   *   suppressed by hdr10plus, the merged `quality:combo:dv-atmos`, an absent
   *   age pill): the action works on the stored map, so it never depends on a
   *   fresh geometry report or on the rows the editor happens to list;
   * - every listed ITEM loses exactly its own correction.
   * The group's position/scale and the corrections of every other family keep
   * their values. Unlike `resetItem`/`resetItems` it never consults the
   * applied-preset baseline, so a stale nudge captured in that snapshot can
   * never be restored onto a badge. One write = no lost update when a caller
   * rejoins a family and an item together; an already-clean map writes nothing
   * (no dirty draft, no false conflict).
   */
  const rejoin = (patch: {
    readonly families?: readonly ("quality" | "separate")[]
    readonly items?: readonly string[]
  }) => {
    const families = patch.families ?? []
    const items = patch.items ?? []
    if (families.length === 0 && items.length === 0) return
    let next = itemTransforms
    for (const family of families) next = withoutBadgeItemFamily(next, family)
    if (items.length > 0) next = rejoinBadgeItems(next, items)
    commitItemTransforms(next)
  }

  /**
   * Geometry write of ONE OR SEVERAL families in a single state update.
   * Portrait flats are distinct keys merged functionally; the landscape profile
   * is one patch. Same semantics as the individual setters, so the numeric
   * controls and the direct manipulation stay in sync.
   */
  const applyFamilyMoves = (moves: readonly BadgeFamilyMove[]) => {
    if (moves.length === 0) return
    if (isLandscape) {
      const patch: Record<string, number> = {}
      for (const move of moves) {
        switch (move.family) {
          case "rank":
            patch.topBadgeOffsetX = move.offsetX
            patch.topBadgeOffsetY = move.offsetY
            break
          case "extra":
            patch.extraBadgeOffsetX = move.offsetX
            patch.extraBadgeOffsetY = move.offsetY
            if (move.scale != null) patch.extraBadgeScale = move.scale
            break
          case "genre":
            patch.genreBadgeOffsetX = move.offsetX
            patch.genreBadgeOffsetY = move.offsetY
            break
          case "quality":
            patch.qualityBadgeOffsetX = move.offsetX
            patch.qualityBadgeOffsetY = move.offsetY
            break
          case "separate":
            patch.separateBadgeOffsetX = move.offsetX
            patch.separateBadgeOffsetY = move.offsetY
            break
          case "network":
            patch.networkLogoOffsetX = move.offsetX
            patch.networkLogoOffsetY = move.offsetY
            break
          case "logo":
            patch.logoOffsetX = move.offsetX
            patch.logoOffsetY = move.offsetY
            break
        }
      }
      if (Object.keys(patch).length > 0) {
        ed.setLandscape(patch as Partial<LandscapeServerDefaults>)
      }
      return
    }
    for (const move of moves) {
      switch (move.family) {
        case "rank":
          ed.setDefaultTopBadgeOffsetX(move.offsetX)
          ed.setDefaultTopBadgeOffsetY(move.offsetY)
          break
        case "extra":
          if (move.scale != null) ed.setDefaultExtraBadgeScale(move.scale)
          ed.setDefaultExtraBadgeOffsetX(move.offsetX)
          ed.setDefaultExtraBadgeOffsetY(move.offsetY)
          break
        case "genre":
          ed.setDefaultGenreBadgeOffsetX(move.offsetX)
          ed.setDefaultGenreBadgeOffsetY(move.offsetY)
          break
        case "quality":
          ed.setDefaultQualityBadgeOffsetX(move.offsetX)
          ed.setDefaultQualityBadgeOffsetY(move.offsetY)
          break
        case "separate":
          ed.setDefaultSeparateBadgeOffsetX(move.offsetX)
          ed.setDefaultSeparateBadgeOffsetY(move.offsetY)
          break
        case "network":
          ed.setDefaultNetworkLogoOffsetX(move.offsetX)
          ed.setDefaultNetworkLogoOffsetY(move.offsetY)
          break
        case "logo":
          ed.setDefaultLogoOffsetX(move.offsetX)
          ed.setDefaultLogoOffsetY(move.offsetY)
          break
      }
    }
  }

  /**
   * Canonical family reset for the ACTIVE shape/profile.
   * - With an applied preset: restore that immutable snapshot's own family
   *   values/corrections (or clear/automatic when the preset did not own them),
   *   so a later global Save cannot redefine the reset reference.
   * - Without an applied preset: the historical reset contract (portrait
   *   canonical constants; landscape clear-to-inherit).
   *
   * Only the requested families are touched, and the top-slot reset only
   * applies to the layout that actually displays it. A reset family also
   * resets the per-ITEM corrections it owns (`quality:*`, `rating:*`).
   * Other families' items are untouched.
   */
  const resetFamilies = (families: readonly BadgeGeometryFamily[]) => {
    if (families.length === 0) return
    if (isLandscape) {
      const keys = families.flatMap((family) => FAMILY_TRANSFORM_KEYS[family].land)
      if (ed.resetLandscapeKeys) {
        // Settings session: one call owns both the baseline restore and the
        // persisted clear list.
        ed.resetLandscapeKeys(keys)
      } else {
        const patch: Record<string, unknown> = {}
        for (const key of keys) {
          const own = activeBaseline ? baselineLandscape(activeBaseline, key) : { present: false }
          patch[key] = own.present ? own.value : undefined
        }
        ed.setLandscape(patch as Partial<LandscapeServerDefaults>)
      }
    } else {
      for (const family of families) {
        for (const key of FAMILY_TRANSFORM_KEYS[family].flat) {
          const own = activeBaseline ? baselineFlat(activeBaseline, key) : { present: false }
          const fallback = key === "defaultSeparateBadgeScale"
            ? getSeparateBadgeDefaultScale(ed.defaultSeparateRatingsStyle)
            : canonicalFlatDefault(key)
          setPortraitFlat(ed, key, own.present ? own.value : fallback)
        }
      }
    }
    // Item corrections owned by a reset family are part of that family's
    // layout. With an applied preset restore exactly its own corrections for
    // that family; otherwise drop them (automatic layout). Unrelated item
    // families are preserved in both paths.
    let items = itemTransforms
    for (const family of families) {
      if (family !== "quality" && family !== "separate") continue
      items = withoutBadgeItemFamily(items, family)
      if (activeBaseline) {
        for (const [id, transform] of Object.entries(activeBaselineItems ?? {})) {
          const owned = family === "quality" ? isQualityItemId(id) : isRatingItemId(id)
          if (owned) items = withBadgeItemTransform(items, id, transform)
        }
      }
    }
    const serialized = serializeBadgeItemTransforms(items)
    const current = serializeBadgeItemTransforms(itemTransforms)
    if (serialized !== current) setItemTransforms(items)
  }
  /** Reset ONE family (see `resetFamilies`). */
  const resetFamily = (family: BadgeGeometryFamily) => resetFamilies([family])

  /**
   * Transform-panel network group reset: family geometry PLUS the follow
   * toggle (the historical button contract; a fullscreen group double-click
   * keeps its geometry-only reset). With an applied preset the toggle returns
   * to the snapshot value.
   */
  const resetNetworkGroup = () => {
    resetFamilies(["network"])
    if (isLandscape) {
      const own = activeBaseline ? baselineLandscape(activeBaseline, "networkLogoFollowTitle") : { present: false }
      ed.setLandscape({
        networkLogoFollowTitle: own.present ? own.value : undefined,
      } as Partial<LandscapeServerDefaults>)
      return
    }
    const own = activeBaseline ? baselineFlat(activeBaseline, "defaultNetworkLogoFollowTitle") : { present: false }
    ed.setDefaultNetworkLogoFollowTitle(own.present ? own.value as boolean : true)
  }

  /** Gradient/blur group reset (same baseline rule; factory Natural without it). */
  const resetGradient = () => {
    if (isLandscape) {
      const patch: Record<string, unknown> = {}
      for (const key of GRADIENT_LAND_KEYS) {
        const own = activeBaseline ? baselineLandscape(activeBaseline, key) : { present: false }
        patch[key] = own.present ? own.value : undefined
      }
      ed.setLandscape(patch as Partial<LandscapeServerDefaults>)
      return
    }
    const keys = activeBaseline
      ? GRADIENT_FLAT_KEYS
      : ([
          "defaultGradientHeight",
          "defaultBlurIntensity",
          "defaultBlurFade",
          "defaultBlurDarkness",
          "defaultTintStrength",
        ] as const)
    for (const key of keys) {
      const own = activeBaseline ? baselineFlat(activeBaseline, key) : { present: false }
      setPortraitFlat(ed, key, own.present ? own.value : canonicalFlatDefault(key))
    }
  }

  /** Full portrait visual reset (bottom "Reset · Portrait" control). */
  const resetAllPortrait = () => {
    const keys = [
      ...FAMILY_TRANSFORM_KEYS.rank.flat,
      ...FAMILY_TRANSFORM_KEYS.extra.flat,
      ...FAMILY_TRANSFORM_KEYS.genre.flat,
      ...FAMILY_TRANSFORM_KEYS.quality.flat,
      ...FAMILY_TRANSFORM_KEYS.network.flat,
      "defaultNetworkLogoFollowTitle",
      ...GRADIENT_FLAT_KEYS,
    ]
    for (const key of keys) {
      const own = activeBaseline ? baselineFlat(activeBaseline, key) : { present: false }
      setPortraitFlat(ed, key, own.present ? own.value : canonicalFlatDefault(key))
    }
  }

  return {
    isLandscape,
    itemTransforms,
    setItemTransform,
    resetItem,
    topBadgeScale,
    topBadgeOffsetX,
    topBadgeOffsetY,
    extraBadgeScale: extraScaleRaw ?? topBadgeScale,
    extraBadgeOffsetX: extraOffsetXRaw ?? topBadgeOffsetX,
    extraBadgeOffsetY: extraOffsetYRaw ?? topBadgeOffsetY,
    extraBadgeScaleExplicit: extraScaleRaw,
    extraBadgeOffsetXExplicit: extraOffsetXRaw,
    extraBadgeOffsetYExplicit: extraOffsetYRaw,
    genreBadgeScale: landOr("genreBadgeScale", ed.defaultGenreBadgeScale),
    genreBadgeOffsetX: landOr("genreBadgeOffsetX", ed.defaultGenreBadgeOffsetX),
    genreBadgeOffsetY: landOr("genreBadgeOffsetY", ed.defaultGenreBadgeOffsetY),
    qualityBadgeScale: landOr("qualityBadgeScale", ed.defaultQualityBadgeScale),
    qualityBadgeOffsetX: landOr("qualityBadgeOffsetX", ed.defaultQualityBadgeOffsetX),
    qualityBadgeOffsetY: landOr("qualityBadgeOffsetY", ed.defaultQualityBadgeOffsetY),
    separateBadgeScale: landOr("separateBadgeScale", ed.defaultSeparateBadgeScale),
    separateBadgeOffsetX: landOr("separateBadgeOffsetX", ed.defaultSeparateBadgeOffsetX),
    separateBadgeOffsetY: landOr("separateBadgeOffsetY", ed.defaultSeparateBadgeOffsetY),
    networkLogoScale: landOr("networkLogoScale", ed.defaultNetworkLogoScale),
    networkLogoOffsetX: landOr("networkLogoOffsetX", ed.defaultNetworkLogoOffsetX),
    networkLogoOffsetY: landOr("networkLogoOffsetY", ed.defaultNetworkLogoOffsetY),
    logoScale,
    logoOffsetX,
    logoOffsetY,
    resetFamily,
    resetFamilies,
    resetNetworkGroup,
    resetGradient,
    resetAllPortrait,
    resetItems,
    rejoin,
    applyItemMoves,
    applyFamilyMoves,
    /** Individual family write: one move of the same batch API. */
    setTopBadgeOffset: (x: number, y: number) => applyFamilyMoves([{ family: "rank", offsetX: x, offsetY: y }]),
    setExtraBadgeOffsets: (x: number, y: number, scale: number | null) =>
      applyFamilyMoves([{ family: "extra", offsetX: x, offsetY: y, scale }]),
    setGenreBadgeOffsets: (x: number, y: number) => applyFamilyMoves([{ family: "genre", offsetX: x, offsetY: y }]),
    setQualityBadgeOffsets: (x: number, y: number) => applyFamilyMoves([{ family: "quality", offsetX: x, offsetY: y }]),
    setSeparateBadgeOffsets: (x: number, y: number) => applyFamilyMoves([{ family: "separate", offsetX: x, offsetY: y }]),
    setNetworkLogoOffsets: (x: number, y: number) => applyFamilyMoves([{ family: "network", offsetX: x, offsetY: y }]),
    setLogoOffsets: (x: number, y: number) => applyFamilyMoves([{ family: "logo", offsetX: x, offsetY: y }]),
    /**
     * Scale write for the direct resize on the defaults preview. Same storage
     * layer and same setter contract as the Transform scale slider of that
     * family: portrait flats, landscape profile (`land[key] ?? flat` read), the
     * standalone extra profile key, the separate-ratings RAW scale and the
     * title-logo explicit scale (clearing auto). No new key, no second path.
     */
    setFamilyScale: (
      family: "rank" | "extra" | "genre" | "quality" | "separate" | "network" | "logo",
      scale: number,
    ) => {
      const v = Math.round(scale)
      if (!Number.isFinite(v)) return
      if (isLandscape) {
        const key: keyof LandscapeServerDefaults =
          family === "rank"
            ? "topBadgeScale"
            : family === "extra"
              ? "extraBadgeScale"
              : family === "genre"
                ? "genreBadgeScale"
                : family === "quality"
                  ? "qualityBadgeScale"
                  : family === "separate"
                    ? "separateBadgeScale"
                    : family === "network"
                      ? "networkLogoScale"
                      : "logoScale"
        ed.setLandscape({ [key]: v } as Partial<LandscapeServerDefaults>)
        return
      }
      switch (family) {
        case "rank":
          ed.setDefaultTopBadgeScale(v)
          return
        case "extra":
          ed.setDefaultExtraBadgeScale(v)
          return
        case "genre":
          ed.setDefaultGenreBadgeScale(v)
          return
        case "quality":
          ed.setDefaultQualityBadgeScale(v)
          return
        case "separate":
          ed.setDefaultSeparateBadgeScale(v)
          return
        case "network":
          ed.setDefaultNetworkLogoScale(v)
          return
        case "logo":
          ed.setDefaultLogoScale(v)
          return
      }
    },
  }
}
