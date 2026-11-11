import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  captureVisualPreset,
  resolveEffectiveLandscape,
  snapshotMissingLandscape,
  SHAPE_FLAT_TO_LANDSCAPE,
  SHAPE_NULL_INHERIT_KEYS,
  PRESET_FLAT_TO_LANDSCAPE,
  type VisualPresetValues,
} from "./visual-presets"
import type { LandscapeServerDefaults } from "./server-defaults"
import {
  DEFAULT_SEPARATE_RATINGS_STYLE,
  getSeparateRatingsStyleForShape,
  isBottomSeparateRatingsStyle,
  isSeparateRatingsStyle,
} from "./badge-styles"
import { clearedExtraForPresetApply } from "./extra-materialize"
import { DEFAULT_SASH_ORDER } from "./badge-priority"

export type GuideShape = "portrait" | "landscape"
/**
 * Draft provenance: "current" = the user's live config (sparse raw
 * profile, incremental edits only), "preset" = a chosen builtin/personal
 * full look (existing isolated full-look projection). Transient UI state
 * only — never persisted (no schema change).
 */
export type GuideDraftOrigin = "current" | "preset"

function guideValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b)
  return false
}


/** Live snapshot + session guards captured when the guide opens. */
export interface GuideBaseline {
  values: VisualPresetValues
  /** Raw landscape profile (unknown extras preserved on confirm). */
  landscapeRaw: LandscapeServerDefaults
  /**
   * Unstripped conflict extras: every SHAPE_FLAT_TO_LANDSCAPE flat key as
   * read live at open (covers age/layout/scope/extra-style roots outside
   * the preset schema) plus the full raw landscape (unknown server keys
   * included). Never credentials (visual-only map by construction).
   */
  extraFlats: Record<string, unknown>
  landscapeRawFull: Record<string, unknown>
  userId: string | null
  shape: GuideShape
}

/** Flat keys snapshotted for the conflict guard (visual-only, no credentials). */
export const GUIDE_CONFLICT_FLAT_KEYS: readonly string[] = Object.keys(SHAPE_FLAT_TO_LANDSCAPE)

/** Pick the unstripped conflict extras from any live/draft source. Pure. */
export function extractGuideConflictExtras(
  source: Record<string, unknown>,
): { extraFlats: Record<string, unknown>; landscapeRawFull: Record<string, unknown> } {
  const extraFlats: Record<string, unknown> = {}
  for (const k of GUIDE_CONFLICT_FLAT_KEYS) {
    if (k in source) extraFlats[k] = (source as Record<string, unknown>)[k]
  }
  const land = (source as Record<string, unknown>).landscape
  const landscapeRawFull =
    land !== null && typeof land === "object" && !Array.isArray(land)
      ? { ...(land as Record<string, unknown>) }
      : {}
  return { extraFlats, landscapeRawFull }
}

/**
 * Capture the guide baseline from live editor state: schema-only values for
 * compare/draft seed plus the RAW landscape profile for the confirm merge.
 * Pure.
 */
export function captureGuideBaseline(
  source: VisualPresetValues & { landscape?: LandscapeServerDefaults | null } & Record<string, unknown>,
  userId: string | null,
  shape: GuideShape,
): GuideBaseline {
  const values = captureVisualPreset(source)
  const raw = (source.landscape ?? {}) as LandscapeServerDefaults
  const { extraFlats, landscapeRawFull } = extractGuideConflictExtras(
    source as unknown as Record<string, unknown>,
  )
  return { values, landscapeRaw: { ...raw }, extraFlats, landscapeRawFull, userId: userId ?? null, shape }
}

/** Session key: stale shape/user application is rejected. */
export function guideSessionKey(shape: GuideShape, userId: string | null): string {
  return `${shape}::${userId ?? "anon"}`
}








/** Clone a draft from the baseline (local only, never live state). */
export function createGuideDraft(baseline: GuideBaseline): VisualPresetValues {
  return captureVisualPreset({ ...baseline.values, landscape: { ...baseline.landscapeRaw } })
}

/** Apply a builtin snapshot into the draft (pure clone, no live writes). */
export function applyGuideBuiltinToDraft(
  draft: VisualPresetValues,
  builtin: VisualPresetValues,
): VisualPresetValues {
  void draft
  return captureVisualPreset({ ...builtin, landscape: { ...(builtin.landscape ?? {}) } })
}

/** Shallow draft patch (flat keys + nested landscape merge). Pure. */
export function updateGuideDraft(
  draft: VisualPresetValues,
  patch: Partial<VisualPresetValues>,
): VisualPresetValues {
  const { landscape, ...rest } = patch
  const next = { ...draft, ...rest } as VisualPresetValues
  if (landscape !== undefined) {
    next.landscape = { ...(draft.landscape ?? {}), ...landscape } as VisualPresetValues["landscape"]
  }
  return next
}

/**
 * Build the single atomic confirm payload: existing isolated helpers with
 * the LIVE raw landscape underneath (unknown extras preserved), draft wins
 * on top per the preset contract. Globals shared by server design
 * (ratingSources/logoAlign/fit flags/delivery) follow the helper semantics.
 * Exactly one `applyVisualPreset` call is made by the caller with this value.
 * Pure.
 */
/**
 * Normalize the target layer missing/null extra exactly like the provider
 * `applyVisualPreset` (`clearedExtraForPresetApply`): a legacy look without
 * explicit extra follows its own rank after apply. Applied to the confirm
 * payload so the preview projection and the post-apply state agree.
 * Idempotent with the provider (re-clearing is a no-op). Pure.
 */
export function normalizeGuideConfirmExtra(
  values: VisualPresetValues,
  shape: GuideShape,
): VisualPresetValues {
  if (shape === "landscape") {
    const land = { ...((values.landscape ?? {}) as Record<string, unknown>) }
    const cleared = clearedExtraForPresetApply(
      {
        scale: land.topBadgeScale as number | null | undefined,
        offsetX: land.topBadgeOffsetX as number | null | undefined,
        offsetY: land.topBadgeOffsetY as number | null | undefined,
      },
      {
        scale: land.extraBadgeScale as number | null | undefined,
        offsetX: land.extraBadgeOffsetX as number | null | undefined,
        offsetY: land.extraBadgeOffsetY as number | null | undefined,
      },
    )
    if (!cleared) return values
    return {
      ...values,
      landscape: {
        ...land,
        extraBadgeScale: cleared.scale,
        extraBadgeOffsetX: cleared.offsetX,
        extraBadgeOffsetY: cleared.offsetY,
      },
    } as VisualPresetValues
  }
  const v = values as unknown as Record<string, unknown>
  const cleared = clearedExtraForPresetApply(
    {
      scale: v.defaultTopBadgeScale as number | null | undefined,
      offsetX: v.defaultTopBadgeOffsetX as number | null | undefined,
      offsetY: v.defaultTopBadgeOffsetY as number | null | undefined,
    },
    {
      scale: v.defaultExtraBadgeScale as number | null | undefined,
      offsetX: v.defaultExtraBadgeOffsetX as number | null | undefined,
      offsetY: v.defaultExtraBadgeOffsetY as number | null | undefined,
    },
  )
  if (!cleared) return values
  return {
    ...values,
    defaultExtraBadgeScale: cleared.scale,
    defaultExtraBadgeOffsetX: cleared.offsetX,
    defaultExtraBadgeOffsetY: cleared.offsetY,
  } as VisualPresetValues
}

export function buildGuideConfirmValues(
  baseline: GuideBaseline,
  liveLandscapeRaw: LandscapeServerDefaults,
  draft: VisualPresetValues,
  shape: GuideShape,
  origin: GuideDraftOrigin = "preset",
): VisualPresetValues {
  if (origin === "current") {
    return buildGuideCurrentConfirmValues(baseline, liveLandscapeRaw, draft, shape)
  }
  // Provider retention: a nullable/absent flat follow from a valid legacy
  // preset never persists as null (applyVisualPreset strips it, live keeps
  // its value). Model that exactly: absent the key so the live flat flows
  // through instead of overlaying null (preview + confirm stay identical
  // to the post-apply state). Pure.
  const desired = { ...draft, landscape: { ...(draft.landscape ?? {}) } } as unknown as Record<string, unknown>
  if (desired.defaultNetworkLogoFollowTitle == null) {
    delete desired.defaultNetworkLogoFollowTitle
  }
  const live = { ...baseline.values, landscape: { ...liveLandscapeRaw } }
  const out =
    shape === "landscape"
      ? applyLandscapeIsolated(live, desired as unknown as VisualPresetValues)
      : applyPortraitIsolated(live, desired as unknown as VisualPresetValues)
  // Live-owned roots (guide contract: confirm never owns age/layout/scope —
  // the guide manages layout explicitly via its own selector and has no age
  // editing, so the live values flow through in buildGuidePreviewEditor).
  // The preset contract carries these keys since personal independence (new
  // snapshots fill the canonical values); strip them here so the confirm
  // stays projection-pure — before, snapshots simply lacked the keys.
  // The standalone extra style is NOT stripped: it follows the applied look.
  const outRec = out as unknown as Record<string, unknown>
  for (const k of [
    "defaultAgeBadge",
    "defaultAgeCountry",
    "defaultAgeBadgeStyle",
    "defaultPosterLayout",
    "defaultPosterFreshScope",
  ]) {
    delete outRec[k]
  }
  return normalizeGuideConfirmExtra(out, shape)
}

/**
 * CURRENT-origin confirm: sparse incremental merge, never a full preset
 * projection. The untouched current path returns the live visual state
 * byte-equivalent (raw sparse profile + live flats); edits apply ONLY the
 * user-edited target keys over the original raw sparse profile (unknown
 * extras intact). Portrait edits reuse the shared
 * `snapshotMissingLandscape` freeze so the other shape's effective output
 * cannot move. Pure.
 */
function buildGuideCurrentConfirmValues(
  baseline: GuideBaseline,
  liveLandscapeRaw: LandscapeServerDefaults,
  draft: VisualPresetValues,
  shape: GuideShape,
): VisualPresetValues {
  const baseFlats = baseline.values as unknown as Record<string, unknown>
  const draftRec = draft as unknown as Record<string, unknown>
  const baseLand = (baseline.landscapeRaw ?? {}) as unknown as Record<string, unknown>
  const draftLand = ((draft.landscape ?? {}) as unknown as Record<string, unknown>)
  const liveLand = (liveLandscapeRaw ?? {}) as unknown as Record<string, unknown>
  // Edited flats: keys where the draft moved off the baseline seed.
  // A nulled flat follow is never an edit (provider retention keeps live).
  const editedFlatKeys: string[] = []
  const flatPatch: Record<string, unknown> = {}
  for (const k of Object.keys(draftRec)) {
    if (k === "landscape") continue
    if (guideValuesEqual(draftRec[k], baseFlats[k])) continue
    if (k === "defaultNetworkLogoFollowTitle" && draftRec[k] == null) continue
    editedFlatKeys.push(k)
    flatPatch[k] = draftRec[k]
  }
  // Edited profile keys (schema layer only): unknown raw extras live only
  // in liveLand and flow through via the spread below, never diffed.
  // Inherit-null (null vs absent) on SHAPE_NULL_INHERIT_KEYS is the same
  // "follow the flat" state, not an edit.
  const landPatch: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(draftLand), ...Object.keys(baseLand)])) {
    const d = draftLand[k]
    const b = baseLand[k]
    if (d === undefined && b === undefined) continue
    if (d == null && b == null && SHAPE_NULL_INHERIT_KEYS.has(k)) continue
    if (guideValuesEqual(d, b)) continue
    if (d === undefined) continue
    landPatch[k] = d
  }
  const frozen =
    shape === "portrait"
      ? (snapshotMissingLandscape(
          baseFlats,
          liveLand,
          editedFlatKeys,
        ) as unknown as Record<string, unknown>)
      : {}
  const out = {
    ...baseline.values,
    ...flatPatch,
    landscape: { ...liveLand, ...frozen, ...landPatch },
  } as unknown as VisualPresetValues
  return normalizeGuideConfirmExtra(out, shape)
}

/**
 * ONE projection source for preview + confirm: the post-apply preset values
 * merged over the complete live editor fields (read-only overlay, no
 * writes). Root age/layout/scope/alignment, raw profile extras and
 * sources/fit/delivery survive via the isolated-helper semantics (confirm
 * never owns them, so the live values flow through). Pass the result as
 * `draftDefaults` to `buildDefaultsPreviewUrlFromEditor` — never hand-copy
 * builder fields or preview the unprojected draft. Pure.
 */
export function buildGuidePreviewEditor<T extends object>(
  liveEd: T,
  baseline: GuideBaseline,
  liveLandscapeRaw: LandscapeServerDefaults,
  draft: VisualPresetValues,
  shape: GuideShape,
  origin: GuideDraftOrigin = "preset",
): T {
  const confirm = buildGuideConfirmValues(baseline, liveLandscapeRaw, draft, shape, origin)
  return { ...(liveEd as Record<string, unknown>), ...(confirm as Record<string, unknown>) } as T
}

/**
 * Conflict guard: true when the live config moved since the guide opened
 * (someone/something saved in the meantime) or the session key changed.
 * On conflict the caller must offer restart and perform NO writes.
 */
export function isGuideBaselineStale(
  baseline: GuideBaseline,
  liveValues: VisualPresetValues,
  currentUserId: string | null,
  currentShape: GuideShape,
  liveSource?: Record<string, unknown> | null,
): boolean {
  if (baseline.shape !== currentShape) return true
  if ((baseline.userId ?? null) !== (currentUserId ?? null)) return true
  if (JSON.stringify(captureVisualPreset(liveValues)) !== JSON.stringify(baseline.values)) return true
  // Complete visual state outside the schema (age/layout/scope/extra roots
  // + raw landscape): callers pass the live UNSTRIPPED editor state; absent
  // keeps the legacy values-only check byte-identical.
  if (liveSource !== undefined && liveSource !== null) {
    const { extraFlats, landscapeRawFull } = extractGuideConflictExtras(liveSource)
    if (JSON.stringify(extraFlats) !== JSON.stringify(baseline.extraFlats)) return true
    if (JSON.stringify(landscapeRawFull) !== JSON.stringify(baseline.landscapeRawFull)) return true
  }
  return false
}

/**
 * Bottom gate: the shared render predicate (same gates the server and the
 * preview builder apply): normalized style via the shared
 * `getSeparateRatingsStyleForShape` + `badgesEnabled && badgeRating && sep
 * && bottom-style` (the `resolveSeparateDisplayState` bottomActive rule —
 * reusing the shared helpers, never a copied approximation; poster-config
 * itself is server-only so the client-safe badge-styles source is used).
 * Genre/year stay enabled whenever the global master or the rating child
 * is off. Pure.
 */
export function isGuideBottomActive(values: {
  defaultSeparateRatings?: boolean | null
  defaultSeparateRatingsStyle?: string | null
  defaultGlobalBadges?: boolean | null
  defaultBadgeRating?: boolean | null
  shape?: GuideShape
}): boolean {
  const raw = values.defaultSeparateRatingsStyle ?? "column"
  const style = isSeparateRatingsStyle(raw) ? raw : DEFAULT_SEPARATE_RATINGS_STYLE
  const normalized = getSeparateRatingsStyleForShape(
    style,
    values.shape === "landscape" ? "landscape" : "poster",
  )
  return (
    (values.defaultGlobalBadges ?? true) !== false &&
    (values.defaultBadgeRating ?? true) !== false &&
    !!values.defaultSeparateRatings &&
    isBottomSeparateRatingsStyle(normalized)
  )
}

/** Flattened draft fields consumed by the Information step toggles. */
export interface GuideInfoToggles {
  genre: boolean
  year: boolean
  rating: boolean
  quality: boolean
  rank: boolean
  network: boolean
  globalBadges: boolean
}

/**
 * Target-aware effective read: portrait reads the shared flats, landscape
 * resolves `profile ?? flat` via `resolveEffectiveLandscape` (same rule as
 * the preview builder and the server). Master/sash/bottom-mode resolve in
 * the same target layer. Pure.
 */
export function readGuideEffective(
  draft: VisualPresetValues,
  shape: GuideShape,
  flatKey: string,
): unknown {
  const v = (draft as unknown as Record<string, unknown>)[flatKey]
  if (shape !== "landscape") return v
  const landKey = PRESET_FLAT_TO_LANDSCAPE[flatKey] ?? SHAPE_FLAT_TO_LANDSCAPE[flatKey]
  if (landKey === undefined) return v
  const eff = resolveEffectiveLandscape(draft) as unknown as Record<string, unknown>
  return eff[landKey] !== undefined ? eff[landKey] : v
}

export function readGuideInfoToggles(draft: VisualPresetValues, shape: GuideShape = "portrait"): GuideInfoToggles {
  const eff = (k: string) => readGuideEffective(draft, shape, k)
  const sash = (eff("defaultSashOrder") ?? []) as string[]
  return {
    genre: !!eff("defaultBadgeGenre"),
    year: !!eff("defaultBadgeYear"),
    rating: !!eff("defaultBadgeRating"),
    quality: !!eff("defaultBadgeQuality"),
    rank: !!eff("defaultRankingBadges") && sash.includes("rank"),
    network: !!eff("defaultNetworkLogo"),
    globalBadges: eff("defaultGlobalBadges") !== false,
  }
}

/** Info toggle keys handled by the guide (master has no button: enabling a
 *  gated child powers the target-layer master, see below). */
export type GuideInfoKey = "genre" | "year" | "rating" | "quality" | "rank" | "network"

const GUIDE_INFO_FLAT_KEY: Record<GuideInfoKey, string> = {
  genre: "defaultBadgeGenre",
  year: "defaultBadgeYear",
  rating: "defaultBadgeRating",
  quality: "defaultBadgeQuality",
  rank: "defaultRankingBadges",
  network: "defaultNetworkLogo",
}

/**
 * Target-aware toggle patch: portrait writes flats, landscape nests the
 * profile key (ALL Information fields). Enabling a master-gated child
 * (genre/year/rating/rank) also powers the master in the SAME target layer
 * so the click enables the actually visible item per the render contract
 * (`badges=`/`ranking=` read `land ?? flat`); the patch never touches the
 * other shape. Quality is master-independent (poster-service renders the
 * tech tier without the global master), so it never enables the master —
 * do NOT blindly enable it there. Pure.
 */
export function buildGuideInfoPatch(
  draft: VisualPresetValues,
  shape: GuideShape,
  key: GuideInfoKey,
  on: boolean,
): Partial<VisualPresetValues> {
  const flatKey = GUIDE_INFO_FLAT_KEY[key]
  if (shape !== "landscape") {
    if (key === "rank") {
      const cur = [...((draft.defaultSashOrder ?? []) as string[])]
      if (on) {
        const slot = DEFAULT_SASH_ORDER.indexOf("rank" as never)
        const next = cur.includes("rank")
          ? cur
          : [
              ...cur.filter((x) => DEFAULT_SASH_ORDER.indexOf(x as never) < slot),
              "rank",
              ...cur.filter((x) => DEFAULT_SASH_ORDER.indexOf(x as never) > slot),
            ]
        return {
          defaultRankingBadges: true,
          defaultGlobalBadges: true,
          defaultSashOrder: next,
        } as Partial<VisualPresetValues>
      }
      return { defaultSashOrder: cur.filter((x) => x !== "rank") } as Partial<VisualPresetValues>
    }
    if ((key === "genre" || key === "year" || key === "rating") && on) {
      return { defaultGlobalBadges: true, [flatKey]: true } as Partial<VisualPresetValues>
    }
    return { [flatKey]: on } as Partial<VisualPresetValues>
  }
  const landKey = (PRESET_FLAT_TO_LANDSCAPE[flatKey] ?? SHAPE_FLAT_TO_LANDSCAPE[flatKey]) as string
  // Minimal target-layer patch (never a wholesale profile copy: untouched
  // masters must stay absent so the other layer keeps rendering them).
  const land: Record<string, unknown> = {}
  if (key === "rank") {
    const effSash = ((resolveEffectiveLandscape(draft) as unknown as Record<string, unknown>).sashOrder ??
      draft.defaultSashOrder ?? []) as string[]
    if (on) {
      const slot = DEFAULT_SASH_ORDER.indexOf("rank" as never)
      const next = effSash.includes("rank")
        ? [...effSash]
        : [
            ...effSash.filter((x) => DEFAULT_SASH_ORDER.indexOf(x as never) < slot),
            "rank",
            ...effSash.filter((x) => DEFAULT_SASH_ORDER.indexOf(x as never) > slot),
          ]
      land.rankingBadges = true
      land.globalBadges = true
      land.sashOrder = next
    } else {
      land.sashOrder = effSash.filter((x) => x !== "rank")
    }
    return { landscape: land } as Partial<VisualPresetValues>
  }
  if ((key === "genre" || key === "year" || key === "rating") && on) {
    land.globalBadges = true
    land[landKey] = true
    return { landscape: land } as Partial<VisualPresetValues>
  }
  land[landKey] = on
  return { landscape: land } as Partial<VisualPresetValues>
}


/**
 * Target-aware gradient patch: portrait writes flats, landscape nests the
 * profile keys (`land ?? flat` at render). Covers every gradient control
 * the guide offers (blur switch, height slider, natural preset). Pure.
 */
export function buildGuideGradientPatch(
  shape: GuideShape,
  patch: Partial<VisualPresetValues>,
): Partial<VisualPresetValues> {
  if (shape !== "landscape") return patch
  const land: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === "landscape") {
      Object.assign(land, v as Record<string, unknown>)
      continue
    }
    const landKey = PRESET_FLAT_TO_LANDSCAPE[k] ?? SHAPE_FLAT_TO_LANDSCAPE[k]
    if (landKey !== undefined) land[landKey] = v
  }
  return { landscape: land } as Partial<VisualPresetValues>
}
