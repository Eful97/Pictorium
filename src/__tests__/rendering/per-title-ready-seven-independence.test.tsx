/**
 * Per-title ready-seven + personal independence (T2):
 * the gallery's seven canonical ready looks (same shared source as the
 * global Preset-tab gallery) plus saved personal presets apply as the
 * title's OWN independent visual recipe in Personalizza — staged only,
 * edited shape only.
 *
 * - Shared leaf: seven entries in gallery order, snapshot consts by
 *   reference, quick looks via the canonical `quickLookDesired` (badge patch
 *   + transform reset — never live previous values), both shapes.
 * - Projection matrix (actual `projectPerTitleVisualPreset`, both shapes):
 *   ready six own Standard (+ Full Nastro/minimal/ribbon), Fresh owns
 *   fresh+ranked on both profiles, personal owns its stored layout/scope/
 *   extra verbatim; legacy snapshots without the keys resolve the canonical
 *   factory values (standard/ranked/legacy-null/follow-rank) — never live;
 *   no `default*`/landscape/artwork/global keys, no age keys (excluded by
 *   design: the dedicated per-title control owns age — the chooser says so
 *   explicitly).
 * - Shape isolation: portrait writes bare flats (+ empty landscapeBlur),
 *   landscape writes the profile (+ local gradient, never bare gradient).
 * - Save trace: every emitted bare key persists per-title (flat or landscape
 *   profile in POST /api/mappings); age never leaves the globals.
 * - Logo autofit (actual `applyPerTitleVisualPreset`): the auto scale
 *   resolves against the APPLIED layout/scope, never the live pre-apply
 *   pair — with correct auto provenance (explicit stays explicit).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { createElement } from "react"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  FRESH_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import { quickLookDesired } from "@/lib/quick-visual-presets"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import {
  projectPerTitleVisualPreset,
  type PerTitleVisualBareKey,
} from "@/lib/per-title-preset"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { captureVisualPreset, type VisualPresetValues } from "@/lib/visual-presets"
import { createWrapper } from "@/__tests__/test-utils"

/** Bare keys the per-title mapping persists (flat or landscape profile). */
const MAPPING_SUPPORTED: ReadonlySet<string> = new Set<string>([
  "globalBadges", "rankingBadges",
  "badgeGenre", "badgeYear", "badgeRating", "badgeQuality",
  "customRatings", "separateRatings", "separateRatingsStyle",
  "badgeStyle", "rankingBadgeStyle", "extraBadgeStyle",
  "posterLayout", "posterFreshScope",
  "badgeFont", "qualityBadgeStyle", "videoFormats",
  "networkLogo", "networkLogoPosition", "networkLogoFollowTitle",
  "preRelease", "ribbonEnabled",
  "gradientHeight", "blurEnabled", "blurIntensity", "blurFade",
  "blurDarkness", "tintStrength", "topShade", "topShadeHeight",
  "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY",
  "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY",
  "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY",
  "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY",
  "separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY",
  // Per-item corrections: mapping-persisted (types.ts Mapping +
  // validation.ts), keyed by stable identity — part of the per-title recipe.
  "badgeItemTransforms",
  "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY",
] satisfies readonly PerTitleVisualBareKey[])

const GRADIENT_KEYS = [
  "gradientHeight", "blurEnabled", "blurIntensity", "blurFade",
  "blurDarkness", "tintStrength", "topShade", "topShadeHeight",
]

function personalExplicit(): VisualPresetValues {
  return captureVisualPreset({
    ...APPLE_VISUAL_DEFAULTS,
    defaultPosterLayout: "fresh",
    defaultPosterFreshScope: "all",
    defaultExtraBadgeStyle: "bordo",
    defaultAgeBadge: true,
    defaultAgeCountry: "GB",
    defaultAgeBadgeStyle: "knockout",
    landscape: {
      ...APPLE_VISUAL_DEFAULTS.landscape,
      posterLayout: "fresh",
      posterFreshScope: "all",
      extraBadgeStyle: "bordo",
    },
  } as unknown as VisualPresetValues)
}

/** Stored legacy snapshot: owned keys never existed (raw, unparsed). */
function personalLegacyRaw(): VisualPresetValues {
  const v = structuredClone(APPLE_VISUAL_DEFAULTS) as unknown as Record<string, unknown>
  for (const k of [
    "defaultPosterLayout", "defaultPosterFreshScope", "defaultExtraBadgeStyle",
    "defaultAgeBadge", "defaultAgeCountry", "defaultAgeBadgeStyle",
  ]) delete v[k]
  const land = { ...((v.landscape ?? {}) as Record<string, unknown>) }
  for (const k of ["posterLayout", "posterFreshScope", "extraBadgeStyle", "ageBadge", "ageCountry", "ageBadgeStyle"]) delete land[k]
  v.landscape = land
  return v as unknown as VisualPresetValues
}

function assertCleanPatch(
  patch: { bare: Record<string, unknown>; landscapeBlur: Record<string, unknown>; logo: Record<string, unknown> },
  shape: "poster" | "landscape",
) {
  for (const key of Object.keys(patch.bare)) {
    expect(key.startsWith("default"), `no default* key (${key})`).toBe(false)
    expect(MAPPING_SUPPORTED.has(key), `mapping-supported key (${key})`).toBe(true)
    expect(key.toLowerCase()).not.toContain("age")
  }
  for (const key of Object.keys(patch.landscapeBlur)) {
    expect(key.toLowerCase()).not.toContain("age")
  }
  if (shape === "poster") {
    expect(patch.landscapeBlur).toEqual({})
  } else {
    for (const key of GRADIENT_KEYS) {
      expect(Object.keys(patch.bare)).not.toContain(key)
    }
    expect(patch.landscapeBlur.gradientHeight).toBeDefined()
  }
}

describe("shared ready-seven leaf (single truth)", () => {
  it("exposes the seven canonical looks in gallery order", () => {
    expect(READY_PRESET_ENTRIES.map((e) => e.id)).toEqual([
      "apple", "better-poster", "rpdb", "essential", "ratings", "full", "fresh",
    ])
  })

  it("snapshot entries resolve the global consts by reference", () => {
    const byId = Object.fromEntries(READY_PRESET_ENTRIES.map((e) => [e.id, e]))
    expect(byId.apple.desired(true)).toBe(APPLE_VISUAL_DEFAULTS)
    expect(byId["better-poster"].desired(false)).toBe(BETTER_POSTER_VISUAL_DEFAULTS)
    expect(byId.rpdb.desired(true)).toBe(RPDB_VISUAL_DEFAULTS)
    expect(byId.fresh.desired(true)).toBe(FRESH_VISUAL_DEFAULTS)
    expect(byId.fresh.desired(false)).toBe(FRESH_VISUAL_DEFAULTS)
    expect(byId.fresh.fresh).toBe(true)
    for (const e of READY_PRESET_ENTRIES) {
      if (e.id !== "fresh") expect(e.fresh).toBe(false)
    }
  })

  it("quick entries resolve the canonical quickLookDesired (never live values)", () => {
    const byId = Object.fromEntries(READY_PRESET_ENTRIES.map((e) => [e.id, e]))
    for (const id of ["essential", "ratings", "full"] as const) {
      expect(byId[id].desired(true)).toEqual(quickLookDesired(id, true))
      expect(byId[id].desired(false)).toEqual(quickLookDesired(id, false))
    }
  })
})

describe("per-title ready-seven projection matrix", () => {
  const cases = [
    { id: "apple", layout: "standard" as const },
    { id: "better-poster", layout: "standard" as const },
    { id: "rpdb", layout: "standard" as const },
    { id: "essential", layout: "standard" as const },
    { id: "ratings", layout: "standard" as const },
    { id: "full", layout: "standard" as const },
    { id: "fresh", layout: "fresh" as const },
  ]

  it.each(cases)("$id portrait owns its recipe (layout/scope/extra, no live)", ({ id, layout }) => {
    const entry = READY_PRESET_ENTRIES.find((e) => e.id === id)!
    const patch = projectPerTitleVisualPreset(entry.desired(true), "poster")
    assertCleanPatch(patch as never, "poster")
    expect(patch.bare.posterLayout).toBe(layout)
    expect(patch.bare.posterFreshScope).toBe("ranked")
    // Ready snapshots carry the legacy extra (follow own rank): portrait
    // owns the flat null, never a tuned live style.
    expect(patch.bare.extraBadgeStyle).toBeNull()
  })

  it.each(cases)("$id landscape owns its profile (gradient local, flats untouched)", ({ id, layout }) => {
    const entry = READY_PRESET_ENTRIES.find((e) => e.id === id)!
    const patch = projectPerTitleVisualPreset(entry.desired(false), "landscape")
    assertCleanPatch(patch as never, "landscape")
    expect(patch.bare.posterLayout).toBe(layout)
    expect(patch.bare.posterFreshScope).toBe("ranked")
    // Legacy extra owns the explicit follow-own-rank marker (canonical,
    // leak-proof) instead of preserving a live tuned style (Fresh carries
    // the same marker explicitly in its landscape profile).
    expect(patch.bare.extraBadgeStyle).toBe("follow-rank")
  })

  it("Full owns Nastro + minimal + ribbon in both shapes", () => {
    const full = READY_PRESET_ENTRIES.find((e) => e.id === "full")!
    for (const shape of ["poster", "landscape"] as const) {
      const patch = projectPerTitleVisualPreset(full.desired(shape === "poster"), shape)
      expect(patch.bare.rankingBadgeStyle).toBe("netflix")
      expect(patch.bare.ribbonEnabled).toBe(true)
      expect(patch.bare.badgeStyle).toBe("minimal")
    }
  })

  it("Fresh is faithful on both profiles (fresh+ranked, fixed appearance keys)", () => {
    const fresh = READY_PRESET_ENTRIES.find((e) => e.id === "fresh")!
    const portrait = projectPerTitleVisualPreset(fresh.desired(true), "poster")
    expect(portrait.bare.posterLayout).toBe("fresh")
    expect(portrait.bare.posterFreshScope).toBe("ranked")
    expect(portrait.bare.rankingBadgeStyle).toBe("netflix")
    expect(portrait.bare.badgeStyle).toBe("minimal")
    expect(portrait.bare.ribbonEnabled).toBe(true)
    const landscape = projectPerTitleVisualPreset(fresh.desired(false), "landscape")
    expect(landscape.bare.posterLayout).toBe("fresh")
    expect(landscape.bare.posterFreshScope).toBe("ranked")
    expect(landscape.bare.rankingBadgeStyle).toBe("number")
  })
})

describe("per-title personal projection matrix", () => {
  it("explicit personal owns its stored recipe (both shapes), age stays global", () => {
    const personal = personalExplicit()
    const portrait = projectPerTitleVisualPreset(personal, "poster")
    assertCleanPatch(portrait as never, "poster")
    expect(portrait.bare.posterLayout).toBe("fresh")
    expect(portrait.bare.posterFreshScope).toBe("all")
    expect(portrait.bare.extraBadgeStyle).toBe("bordo")
    const landscape = projectPerTitleVisualPreset(personal, "landscape")
    assertCleanPatch(landscape as never, "landscape")
    expect(landscape.bare.posterLayout).toBe("fresh")
    expect(landscape.bare.posterFreshScope).toBe("all")
    expect(landscape.bare.extraBadgeStyle).toBe("bordo")
  })

  it("legacy personal resolves canonical (never live), stored data never rewritten", () => {
    const legacy = personalLegacyRaw()
    const before = JSON.stringify(legacy)
    const portrait = projectPerTitleVisualPreset(legacy, "poster")
    expect(portrait.bare.posterLayout).toBe("standard")
    expect(portrait.bare.posterFreshScope).toBe("ranked")
    expect(portrait.bare.extraBadgeStyle).toBeNull()
    const landscape = projectPerTitleVisualPreset(legacy, "landscape")
    expect(landscape.bare.posterLayout).toBe("standard")
    expect(landscape.bare.posterFreshScope).toBe("ranked")
    expect(landscape.bare.extraBadgeStyle).toBe("follow-rank")
    // No persisted-data rewrite: the input snapshot is byte-identical.
    expect(JSON.stringify(legacy)).toBe(before)
  })

  it("personal apply is deterministic from the snapshot (not the previous look)", () => {
    // Same legacy snapshot projected twice yields identical patches — the
    // projection takes no live input, so no previous look can leak.
    const a = projectPerTitleVisualPreset(personalLegacyRaw(), "poster")
    const b = projectPerTitleVisualPreset(personalLegacyRaw(), "poster")
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const c = projectPerTitleVisualPreset(personalExplicit(), "landscape")
    const d = projectPerTitleVisualPreset(personalExplicit(), "landscape")
    expect(JSON.stringify(c)).toBe(JSON.stringify(d))
  })
})

describe("per-title logo autofit follows the applied recipe", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({}) })))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function renderProbe() {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    return box
  }

  async function settled(box: { ed: PosterEditorCtx | null }) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    if (!box.ed) throw new Error("editor context not mounted")
    return box.ed as PosterEditorCtx
  }

  it("Standard recipe on a Fresh+all title resolves the aspect scale (not 100)", async () => {
    const box = renderProbe()
    await settled(box)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).setPosterShape("poster")
      ;(box.ed as PosterEditorCtx).setPosterLayout("fresh")
      ;(box.ed as PosterEditorCtx).setPosterFreshScope("all")
      ;(box.ed as PosterEditorCtx).setLogoScale(100, { auto: true })
    })
    // Live Fresh+all would auto-resolve 100; the APPLIED Standard recipe
    // must resolve the 2:1 aspect scale (60) instead.
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, { width: 800, height: 400 })
    })
    const ed = box.ed as PosterEditorCtx
    expect(ed.posterLayout).toBe("standard")
    expect(ed.logoScale).toBe(60)
    expect(ed.logoScaleExplicit).toBe(false)
  })

  it("Fresh+all personal recipe on a Standard title resolves 100 (not the aspect)", async () => {
    const box = renderProbe()
    await settled(box)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).setPosterShape("poster")
      ;(box.ed as PosterEditorCtx).setPosterLayout("standard")
      ;(box.ed as PosterEditorCtx).setLogoScale(60, { auto: true })
    })
    // Live Standard would auto-resolve the 2:1 aspect (60); the APPLIED
    // fresh+all recipe must resolve 100 instead.
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(personalExplicit(), { width: 800, height: 400 })
    })
    const ed = box.ed as PosterEditorCtx
    expect(ed.posterLayout).toBe("fresh")
    expect(ed.logoScale).toBe(100)
    expect(ed.logoScaleExplicit).toBe(false)
  })

  it("explicit logo scale stays explicit regardless of the applied layout", async () => {
    const box = renderProbe()
    await settled(box)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).setPosterShape("poster")
      ;(box.ed as PosterEditorCtx).setPosterLayout("standard")
    })
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: 90,
    } as unknown as VisualPresetValues)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(values, { width: 800, height: 400 })
    })
    const ed = box.ed as PosterEditorCtx
    expect(ed.logoScale).toBe(90)
    expect(ed.logoScaleExplicit).toBe(true)
  })
})
