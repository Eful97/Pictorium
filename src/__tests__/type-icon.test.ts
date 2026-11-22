/**
 * Icona tipo film/serie: `ti`. Catena query > default per forma > OFF;
 * verticale e landscape indipendenti; emesso negli URL Stremio solo se ON.
 */
import { describe, it, expect } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { POSTER_CACHE_ALLOWLIST } from "@/lib/poster-params-hardening"
import { renderTypeIcon } from "@/lib/type-icon-render"
import { genreBadgeSvgDims } from "@/lib/badge-svg-shared"

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: false,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

describe("typeIcon config chain", () => {
  it("defaults OFF", () => {
    expect(resolvePosterRenderConfig(baseInput()).typeIcon).toBe(false)
  })
  it("portrait and landscape defaults are independent", () => {
    const sd = { typeIcon: true }
    expect(resolvePosterRenderConfig(baseInput({ sd })).typeIcon).toBe(true)
    expect(resolvePosterRenderConfig(baseInput({ sd, searchParams: new URLSearchParams("shape=landscape") })).typeIcon).toBe(false)
    const sdL = { typeIconLandscape: true }
    expect(resolvePosterRenderConfig(baseInput({ sd: sdL })).typeIcon).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ sd: sdL, searchParams: new URLSearchParams("shape=landscape") })).typeIcon).toBe(true)
  })
  it("query ti wins over defaults", () => {
    expect(resolvePosterRenderConfig(baseInput({ sd: { typeIcon: true }, searchParams: new URLSearchParams("ti=0") })).typeIcon).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams("ti=1") })).typeIcon).toBe(true)
  })
})

describe("typeIcon URLs", () => {
  it("Stremio emits ti=1 only when ON", () => {
    expect(buildStremioPosterSearchParams({ typeIcon: true } as never).get("ti")).toBe("1")
    expect(buildStremioPosterSearchParams({ typeIcon: false } as never).has("ti")).toBe(false)
    expect(buildStremioPosterSearchParams({} as never).has("ti")).toBe(false)
  })
  it("defaults preview emits explicit ti", () => {
    expect(buildDefaultsPreviewUrl({ defaultTypeIcon: false } as never)).toContain("ti=0")
    expect(buildDefaultsPreviewUrl({ defaultTypeIcon: true } as never)).toContain("ti=1")
  })
  it("ti is cache-allowlisted", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("ti")).toBe(true)
  })
})

describe("renderTypeIcon", () => {
  it("renders square PNG for both kinds, null when too small", async () => {
    for (const k of ["movie", "tv"] as const) {
      const r = await renderTypeIcon(k, 40)
      expect(r?.w).toBeGreaterThanOrEqual(40)
      expect(r?.png.subarray(1, 4).toString()).toBe("PNG")
    }
    expect(await renderTypeIcon("movie", 4)).toBeNull()
  })
})

describe("genre badge inline glyph", () => {
  it("widens the row only when a typeIcon is set", () => {
    const base = genreBadgeSvgDims(24, "Action", "7.8", "2009")
    const withIcon = genreBadgeSvgDims(24, "Action", "7.8", "2009", { typeIcon: "movie" })
    expect(withIcon.totalW - base.totalW).toBe(withIcon.iconW + withIcon.iconGap)
    expect(withIcon.iconW).toBeGreaterThan(0)
    expect(base.iconW).toBe(0)
    expect(genreBadgeSvgDims(24, "Action", "7.8", "2009", { typeIcon: null }).totalW).toBe(base.totalW)
  })
})
