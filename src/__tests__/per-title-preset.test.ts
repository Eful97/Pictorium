/**
 * Per-title visual preset projection (task 1, no UI):
 * `projectPerTitleVisualPreset` maps a full defaults-space snapshot onto
 * the current title's live editor state for the shape in editing.
 *
 * - Typed allowlist: no `default*`/landscape/artwork/global output.
 * - Portrait = mapped flats via PRESET_FLAT_TO_LANDSCAPE; landscape =
 *   resolveEffectiveLandscape (profile wins, null-inherit falls to flat).
 * - Legacy extra axes clear to null (never materialized); explicit wins.
 * - Null network follow = inherit; fixed landscape coords never copy
 *   portrait absolutes.
 * - extraBadgeStyle audit: portrait never writes it (landscape-only style
 *   must not leak); landscape only from an explicit effective profile.
 */
import { describe, expect, it } from "vitest"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import {
  projectPerTitleVisualPreset,
  type PerTitleVisualBareKey,
} from "@/lib/per-title-preset"
import { captureVisualPreset, type VisualPresetValues } from "@/lib/visual-presets"

const ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "globalBadges", "rankingBadges",
  "badgeGenre", "badgeYear", "badgeRating", "badgeQuality",
  "customRatings", "separateRatings", "separateRatingsStyle",
  "badgeStyle", "rankingBadgeStyle", "extraBadgeStyle",
  "badgeFont", "qualityBadgeStyle", "videoFormats",
  "networkLogo", "networkLogoPosition", "networkLogoFollowTitle",
  "preRelease", "ribbonEnabled",
  "gradientHeight", "blurEnabled", "blurIntensity", "blurFade",
  "blurDarkness", "tintStrength", "topShade",
  "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY",
  "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY",
  "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY",
  "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY",
  "separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY",
  "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY",
] satisfies readonly PerTitleVisualBareKey[])

const FORBIDDEN = [
  "landscape",
  "sashOrder",
  "ratingSources",
  "logoAlign",
  "posterShape",
  "customBadge",
  "badgePresetId",
  "badgePresetRev",
  "region",
  "logoDisabled",
  "backdrops",
  "selectedBackdrop",
]

function bareKeys(patch: { bare: Record<string, unknown> }): string[] {
  return Object.keys(patch.bare)
}

describe("projectPerTitleVisualPreset allowlist (acceptance 1)", () => {
  it.each([
    ["BetterPoster", BETTER_POSTER_VISUAL_DEFAULTS],
    ["RPDB", RPDB_VISUAL_DEFAULTS],
    ["Apple", APPLE_VISUAL_DEFAULTS],
  ] as const)("%s portrait emits only allowlisted bare keys", (_label, values) => {
    const { bare, landscapeBlur } = projectPerTitleVisualPreset(values, "poster")
    for (const key of bareKeys({ bare })) {
      expect(key.startsWith("default")).toBe(false)
      expect(ALLOWLIST.has(key)).toBe(true)
    }
    for (const key of FORBIDDEN) {
      expect(bareKeys({ bare })).not.toContain(key)
    }
    expect(landscapeBlur).toEqual({})
  })

  it.each([
    ["BetterPoster", BETTER_POSTER_VISUAL_DEFAULTS],
    ["RPDB", RPDB_VISUAL_DEFAULTS],
    ["Apple", APPLE_VISUAL_DEFAULTS],
  ] as const)("%s landscape emits only allowlisted bare keys + blur profile", (_label, values) => {
    const { bare, landscapeBlur } = projectPerTitleVisualPreset(values, "landscape")
    for (const key of bareKeys({ bare })) {
      expect(key.startsWith("default")).toBe(false)
      expect(ALLOWLIST.has(key)).toBe(true)
    }
    for (const key of FORBIDDEN) {
      expect(bareKeys({ bare })).not.toContain(key)
    }
    // No opposite (portrait) gradient in the bare patch: gradient travels
    // in the local landscape profile state only.
    for (const key of ["gradientHeight", "blurEnabled", "blurIntensity", "blurFade", "blurDarkness", "tintStrength", "topShade"]) {
      expect(bareKeys({ bare })).not.toContain(key)
    }
    expect(Object.keys(landscapeBlur).length).toBeGreaterThan(0)
  })
})

describe("portrait projection values", () => {
  it("copies mapped flats, active-shape gradient and portrait network layer", () => {
    const { bare, logo } = projectPerTitleVisualPreset(BETTER_POSTER_VISUAL_DEFAULTS, "poster")
    expect(bare.badgeStyle).toBe("minimal")
    expect(bare.rankingBadgeStyle).toBe("default")
    expect(bare.networkLogo).toBe(false)
    expect(bare.gradientHeight).toBe(35)
    expect(bare.blurFade).toBe(10)
    expect(bare.tintStrength).toBe(100)
    expect(bare.networkLogoFollowTitle).toBe(true)
    expect(bare.networkLogoOffsetX).toBe(0)
    expect(bare.networkLogoOffsetY).toBe(0)
    // Logo null contract: scale null (auto-fit) emitted as an explicit
    // auto-fit request (null, resolved by the caller), offsets null -> 0.
    expect(logo.scale).toBeNull()
    expect(logo.offsetX).toBe(0)
    expect(logo.offsetY).toBe(0)
  })

  it("copies explicit logo transforms (Apple offsets)", () => {
    const { logo } = projectPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, "poster")
    expect(logo.scale).toBeNull()
    expect(logo.offsetX).toBe(0)
    expect(logo.offsetY).toBe(-40)
  })

  it("legacy extra axes clear to null (follow own rank), never numbers", () => {
    const { bare } = projectPerTitleVisualPreset(BETTER_POSTER_VISUAL_DEFAULTS, "poster")
    expect(bare.extraBadgeScale).toBeNull()
    expect(bare.extraBadgeOffsetX).toBeNull()
    expect(bare.extraBadgeOffsetY).toBeNull()
    // Rank tuning still comes from the flat.
    expect(bare.topBadgeScale).toBe(100)
  })

  it("explicit preset extra wins verbatim", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultExtraBadgeScale: 120,
      defaultExtraBadgeOffsetX: 5,
      defaultExtraBadgeOffsetY: -6,
    } as VisualPresetValues)
    const { bare } = projectPerTitleVisualPreset(values, "poster")
    expect(bare.extraBadgeScale).toBe(120)
    expect(bare.extraBadgeOffsetX).toBe(5)
    expect(bare.extraBadgeOffsetY).toBe(-6)
  })

  it("null network follow = inherit (key omitted, offsets still portrait)", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultNetworkLogoFollowTitle: undefined,
    } as unknown as VisualPresetValues)
    const { bare } = projectPerTitleVisualPreset(values, "poster")
    expect("networkLogoFollowTitle" in bare).toBe(false)
    expect(bare.networkLogoOffsetX).toBe(0)
    expect(bare.networkLogoOffsetY).toBe(0)
  })
})

describe("landscape projection values (resolveEffectiveLandscape)", () => {
  it("profile wins over flat; gradient goes to landscapeBlur, not bare", () => {
    const { bare, landscapeBlur, logo } = projectPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, "landscape")
    expect(bare.genreBadgeOffsetY).toBe(0)
    expect(bare.qualityBadgeStyle).toBe("color")
    expect(bare.rankingBadgeStyle).toBe("number")
    expect(landscapeBlur.blurFade).toBe(100)
    expect(landscapeBlur.gradientHeight).toBe(50)
    expect(landscapeBlur.tintStrength).toBe(0)
    // Explicit profile null offset = 0 by contract (never inherits the
    // flat): the flat -40 must not leak through.
    expect(logo.offsetY).toBe(0)
    expect(logo.scale).toBeNull()
  })

  it("null-inherit styles fall through to the flat (never null out)", () => {
    const values = captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      landscape: {
        ...APPLE_VISUAL_DEFAULTS.landscape,
        badgeFont: null,
        qualityBadgeStyle: null,
        videoFormats: null,
      },
    } as unknown as VisualPresetValues)
    const { bare } = projectPerTitleVisualPreset(values, "landscape")
    expect(bare.badgeFont).toBe("inter")
    expect(bare.qualityBadgeStyle).toBe("knockout")
    expect(bare.videoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
  })

  it("fixed flat layer without profile coords: follow set, offsets omitted", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 30,
      defaultNetworkLogoOffsetY: 40,
      landscape: {},
    } as unknown as VisualPresetValues)
    const portrait = projectPerTitleVisualPreset(values, "poster")
    expect(portrait.bare.networkLogoFollowTitle).toBe(false)
    expect(portrait.bare.networkLogoOffsetX).toBe(30)
    expect(portrait.bare.networkLogoOffsetY).toBe(40)
    const landscape = projectPerTitleVisualPreset(values, "landscape")
    expect(landscape.bare.networkLogoFollowTitle).toBe(false)
    // Portrait absolutes must never become landscape coords.
    expect("networkLogoOffsetX" in landscape.bare).toBe(false)
    expect("networkLogoOffsetY" in landscape.bare).toBe(false)
  })

  it("explicit landscape fixed coords are kept", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultNetworkLogoFollowTitle: true,
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 11, networkLogoOffsetY: 22 },
    } as unknown as VisualPresetValues)
    const { bare } = projectPerTitleVisualPreset(values, "landscape")
    expect(bare.networkLogoFollowTitle).toBe(false)
    expect(bare.networkLogoOffsetX).toBe(11)
    expect(bare.networkLogoOffsetY).toBe(22)
  })

  it("absent follow in landscape inherits the whole layer (offsets omitted)", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultNetworkLogoFollowTitle: undefined,
      landscape: {},
    } as unknown as VisualPresetValues)
    const { bare } = projectPerTitleVisualPreset(values, "landscape")
    expect("networkLogoFollowTitle" in bare).toBe(false)
    expect("networkLogoOffsetX" in bare).toBe(false)
    expect("networkLogoOffsetY" in bare).toBe(false)
  })

  it("legacy landscape extra resolves against the effective rank, unfilled", () => {
    const { bare } = projectPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, "landscape")
    // Apple carries no explicit extra anywhere: cleared to follow.
    expect(bare.extraBadgeScale).toBeNull()
    expect(bare.extraBadgeOffsetX).toBeNull()
    expect(bare.extraBadgeOffsetY).toBeNull()
  })
})

describe("extraBadgeStyle audit", () => {
  function styledPreset(): VisualPresetValues {
    return captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      landscape: { ...APPLE_VISUAL_DEFAULTS.landscape, extraBadgeStyle: "vetro" },
    } as unknown as VisualPresetValues)
  }

  it("portrait never writes extraBadgeStyle (landscape-only style not retained)", () => {
    const { bare } = projectPerTitleVisualPreset(styledPreset(), "poster")
    expect("extraBadgeStyle" in bare).toBe(false)
  })

  it("landscape writes the effective profile style", () => {
    const { bare } = projectPerTitleVisualPreset(styledPreset(), "landscape")
    expect(bare.extraBadgeStyle).toBe("vetro")
  })

  it("landscape without a profile style preserves the title (key omitted)", () => {
    const { bare } = projectPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, "landscape")
    expect("extraBadgeStyle" in bare).toBe(false)
  })
})

describe("logo scale semantics (null = auto-fit request)", () => {
  it("explicit portrait scale stays exact", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: 90,
    } as unknown as VisualPresetValues)
    const { logo } = projectPerTitleVisualPreset(values, "poster")
    expect(logo.scale).toBe(90)
  })

  it("explicit landscape scale stays exact", () => {
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: 90,
      landscape: { logoScale: 88 },
    } as unknown as VisualPresetValues)
    const { logo } = projectPerTitleVisualPreset(values, "landscape")
    expect(logo.scale).toBe(88)
  })

  it("undefined portrait scale = inherit (key omitted)", () => {
    const values = {
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: undefined,
    } as unknown as VisualPresetValues
    const { logo } = projectPerTitleVisualPreset(values, "poster")
    expect("scale" in logo).toBe(false)
  })

  it("null portrait scale = auto-fit request (never inherit)", () => {
    const { logo } = projectPerTitleVisualPreset(BETTER_POSTER_VISUAL_DEFAULTS, "poster")
    expect(logo.scale).toBeNull()
  })

  it("null landscape scale = auto-fit request (never inherit)", () => {
    const { logo } = projectPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, "landscape")
    expect(logo.scale).toBeNull()
  })
})
