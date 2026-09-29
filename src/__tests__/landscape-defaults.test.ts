import { describe, expect, it } from "vitest"
import {
  effectiveDefaultsForShape,
  type ServerDefaults,
} from "@/lib/server-defaults"
import { resolvePosterRenderConfig } from "@/lib/poster-config"

const FLAT: ServerDefaults = {
  badgeStyle: "shadow",
  blurFade: 50,
  gradientHeight: 30,
  globalBadges: true,
}

describe("effectiveDefaultsForShape", () => {
  it("returns the same object for poster or without a landscape profile", () => {
    expect(effectiveDefaultsForShape(FLAT, "poster")).toBe(FLAT)
    expect(effectiveDefaultsForShape(FLAT, "landscape")).toBe(FLAT)
    expect(effectiveDefaultsForShape({ ...FLAT, landscape: null }, "landscape")).toEqual(
      expect.objectContaining({ blurFade: 50 }),
    )
  })

  it("overrides only defined landscape keys, flat fallback otherwise", () => {
    const eff = effectiveDefaultsForShape(
      { ...FLAT, landscape: { blurFade: 70, gradientHeight: undefined } },
      "landscape",
    )
    expect(eff.blurFade).toBe(70)
    // Chiave esplicita undefined = segui il flat, mai clobberare.
    expect(eff.gradientHeight).toBe(30)
    // Chiavi fuori profilo (badge) restano flat.
    expect(eff.badgeStyle).toBe("shadow")
    // L'input non è mutato.
    expect(FLAT.blurFade).toBe(50)
  })
})

describe("landscape blur resolution end-to-end", () => {
  function renderConfig(searchParams: URLSearchParams, sd: ServerDefaults) {
    return resolvePosterRenderConfig({
      searchParams,
      mapping: null,
      configOverride: null,
      sd,
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
      lang: "it",
    })
  }

  it("resolves the landscape blur profile from server defaults", () => {
    const sd: ServerDefaults = {
      blurFade: 50,
      gradientHeight: 30,
      landscape: { blurFade: 70, gradientHeight: 20 },
    }
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), sd)
    expect(landscape.blurFade).toBe(70)
    expect(landscape.blurHeight).toBe(20)
    const portrait = renderConfig(new URLSearchParams(""), sd)
    expect(portrait.blurFade).toBe(50)
    expect(portrait.blurHeight).toBe(30)
  })

  it("resolves tint and top shade from the landscape profile", () => {
    const sd: ServerDefaults = {
      tintStrength: 20,
      topShade: 50,
      landscape: { tintStrength: 80, topShade: 10 },
    }
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), sd)
    expect(landscape.tintStrength).toBe(80)
    expect(landscape.topShade).toBe(10)
    const portrait = renderConfig(new URLSearchParams(""), sd)
    expect(portrait.tintStrength).toBe(20)
    expect(portrait.topShade).toBe(50)
  })

  it("resolves logo scale from global defaults, landscape override wins in landscape", () => {
    const sd: ServerDefaults = {
      logoScale: 80,
      landscape: { logoScale: 60 },
    }
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), sd)
    expect(landscape.logoScale).toBe(60)
    const portrait = renderConfig(new URLSearchParams(""), sd)
    expect(portrait.logoScale).toBe(80)
  })

  it("falls back to auto-fit (null) without any logo default", () => {
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), {})
    expect(landscape.logoScale).toBeNull()
    const portrait = renderConfig(new URLSearchParams(""), {})
    expect(portrait.logoScale).toBeNull()
  })

  it("keeps offsets unset (null) in landscape: calibration lives in the renderer, sliders stay 0", () => {
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), {})
    expect(landscape.logoOffsetX).toBeNull()
    expect(landscape.logoOffsetY).toBeNull()
    const portrait = renderConfig(new URLSearchParams(""), {})
    expect(portrait.logoOffsetX).toBeNull()
    expect(portrait.logoOffsetY).toBeNull()
  })

  it("badge styles stay shared across shapes (no per-shape styles)", () => {    const sd: ServerDefaults = {
      badgeStyle: "pill",
      landscape: { blurFade: 70 },
    }
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), sd)
    expect(landscape.badgeStyle).toBe("pill")
  })

  it("resolves badge scale overrides from the landscape profile", () => {
    const sd: ServerDefaults = {
      topBadgeScale: 100,
      genreBadgeScale: 100,
      landscape: { topBadgeScale: 120, genreBadgeOffsetX: 10 },
    }
    const landscape = renderConfig(new URLSearchParams("shape=landscape"), sd)
    expect(landscape.topBadgeScale).toBe(120)
    expect(landscape.genreBadgeOffsetX).toBe(10)
    // Chiavi assenti: flat.
    expect(landscape.genreBadgeScale).toBe(100)
    const portrait = renderConfig(new URLSearchParams(""), sd)
    expect(portrait.topBadgeScale).toBe(100)
    expect(portrait.genreBadgeOffsetX).toBe(0)
  })
})
