/**
 * Task7 correction cycle 1 ("metti di default solo rank"): Fresh scope
 * default is RANKED everywhere, ALL stays an explicit override.
 *
 * - Absent/invalid scope resolves to the shared ranked default
 *   (client + server + cache + hardening).
 * - Explicit `all` still overrides an inherited ranked (query, mapping,
 *   defaults, preview/Stremio URLs, save) and preserves the no-rank Fresh.
 * - Existing saved explicit values are untouched (all stays all, ranked
 *   stays ranked); only legacy absence picks up the new ranked default.
 * - Real service renders prove the equalities (no pinned hashes); the real
 *   PosterEditorProvider proves the live UI default.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { createElement } from "react"
import { screen, fireEvent, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { resolvePosterFreshScope } from "@/lib/poster-config"
import {
  effectiveShapeDefaultFreshScope,
  resolveOpenPosterFreshScope,
} from "@/lib/poster-layout-resolve"
import {
  DEFAULT_POSTER_FRESH_SCOPE,
  type Mapping,
} from "@/lib/types"
import { isEffectiveFreshLayout } from "@/lib/fresh-layout"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { PosterFreshScopeSelector } from "@/components/PosterLayoutSelector"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { PictoriumUserConfig } from "@/lib/config-token"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

const TOKEN_BASE: PictoriumUserConfig = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
}

describe("fresh default is ranked everywhere", () => {
  it("shared default constant is ranked", () => {
    expect(DEFAULT_POSTER_FRESH_SCOPE).toBe("ranked")
  })

  it("absent scope resolves ranked; explicit all overrides inherited ranked", () => {
    const rankedEverywhere = {
      mapping: mapping({ posterFreshScope: "ranked" }),
      config: { ...TOKEN_BASE, posterFreshScope: "ranked" } as PictoriumUserConfig,
      sd: { posterFreshScope: "ranked" } as ServerDefaults,
    }
    // Absent everywhere (no mapping/config/defaults at all) = ranked default.
    expect(resolvePosterFreshScope(new URLSearchParams(""), null, null, {}, "poster")).toBe("ranked")
    expect(resolvePosterFreshScope(new URLSearchParams(""), null, null, {}, "landscape")).toBe("ranked")
    // Explicit all wins over ranked stored everywhere (query > mapping > config > defaults).
    expect(
      resolvePosterFreshScope(
        new URLSearchParams("freshScope=all"),
        rankedEverywhere.mapping,
        rankedEverywhere.config,
        rankedEverywhere.sd,
        "poster",
      ),
    ).toBe("all")
    expect(
      resolvePosterFreshScope(
        new URLSearchParams(""),
        mapping({ posterFreshScope: "all" }),
        rankedEverywhere.config,
        rankedEverywhere.sd,
        "poster",
      ),
    ).toBe("all")
  })

  it("present-but-invalid query fails closed to ranked (restricts Fresh, never all)", () => {
    const allEverywhere = {
      mapping: mapping({ posterFreshScope: "all" }),
      sd: { posterFreshScope: "all" } as ServerDefaults,
    }
    expect(
      resolvePosterFreshScope(new URLSearchParams("freshScope=bogus"), allEverywhere.mapping, null, allEverywhere.sd, "poster"),
    ).toBe("ranked")
    expect(
      resolvePosterFreshScope(new URLSearchParams("freshScope="), allEverywhere.mapping, null, allEverywhere.sd, "poster"),
    ).toBe("ranked")
  })

  it("per-shape inheritance keeps saved explicit all (both shapes, both layers)", () => {
    // Saved explicit all survives per shape: flat all is the landscape fallback.
    expect(
      resolvePosterFreshScope(new URLSearchParams(""), mapping({ posterFreshScope: "all" }), null, {}, "landscape"),
    ).toBe("all")
    expect(
      resolvePosterFreshScope(new URLSearchParams(""), mapping({ posterFreshScope: "all" }), null, {}, "poster"),
    ).toBe("all")
    // Landscape profile all overrides a ranked flat.
    expect(
      resolvePosterFreshScope(
        new URLSearchParams(""),
        mapping({ posterFreshScope: "ranked", landscape: { posterFreshScope: "all" } }),
        null,
        {},
        "landscape",
      ),
    ).toBe("all")
    // Open/load path: legacy mapping without scope follows the flat default.
    expect(resolveOpenPosterFreshScope(mapping(), "poster", "ranked", null)).toBe("ranked")
    expect(resolveOpenPosterFreshScope(mapping(), "poster", "all", null)).toBe("all")
    expect(resolveOpenPosterFreshScope(mapping({ posterFreshScope: "all" }), "landscape", "ranked", null)).toBe("all")
    // Shape-default helper fails closed to ranked on garbage, keeps explicit all.
    expect(effectiveShapeDefaultFreshScope("all", {}, "landscape")).toBe("all")
    expect(effectiveShapeDefaultFreshScope("bogus" as never, {}, "landscape")).toBe("ranked")
  })
})

describe("isEffectiveFreshLayout with the ranked default", () => {
  it("only explicit all renders Fresh without a rank", () => {
    expect(isEffectiveFreshLayout("fresh", "all", null)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "all", 0)).toBe(true)
    for (const scope of [undefined, null, "bogus", "", "ranked"] as const) {
      expect(isEffectiveFreshLayout("fresh", scope, null)).toBe(false)
      expect(isEffectiveFreshLayout("fresh", scope, 0)).toBe(false)
      expect(isEffectiveFreshLayout("fresh", scope, 7)).toBe(true)
    }
  })

  it("non-fresh layout never renders Fresh", () => {
    expect(isEffectiveFreshLayout("standard", "all", 3)).toBe(false)
    expect(isEffectiveFreshLayout("standard", "ranked", 3)).toBe(false)
    expect(isEffectiveFreshLayout("standard", undefined, 3)).toBe(false)
  })
})

describe("cache + hardening canonicalize invalid to ranked", () => {
  function keyOf(query: string): string {
    return normalizePosterCacheParams(new URLSearchParams(query)).toString()
  }

  it("garbage collapses onto the ranked key; absent stays distinct", () => {
    const absent = keyOf("")
    const all = keyOf("freshScope=all")
    const ranked = keyOf("freshScope=ranked")
    expect(keyOf("freshScope=bogus")).toBe(ranked)
    expect(keyOf("freshScope=")).toBe(ranked)
    expect(absent).not.toBe(ranked)
    expect(absent).not.toBe(all)
    expect(all).not.toBe(ranked)
  })

  it("presets hardening maps invalid to ranked and keeps absence absent", () => {
    const base = { presets: true, preview: false, anonymous: false, publicInstance: false, hasMapping: false } as const
    expect(hardenPosterSearchParams(new URLSearchParams("freshScope=bogus"), base).get("freshScope")).toBe("ranked")
    expect(hardenPosterSearchParams(new URLSearchParams(""), base).get("freshScope")).toBeNull()
    expect(hardenPosterSearchParams(new URLSearchParams("freshScope=all"), base).get("freshScope")).toBe("all")
  })
})

describe("preview + Stremio URLs under the ranked default", () => {
  function previewState() {
    return {
      selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
      previewPoster: null,
      selectedLogo: null,
      selectedBackdrop: null,
      logoScale: 75,
      logoOffsetX: 0,
      logoOffsetY: 0,
      backdropScale: 100,
      backdropOffsetX: 0,
      backdropOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: null,
      mdblistAnimeList: [],
      topEdgeColor: null,
      bottomEdgeColor: null,
      accentColor: null,
      autoAccentColor: null,
      lang: "it",
      tmdbKey: "k",
      userId: null,
    }
  }

  function badgeParams() {
    return {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      customBadge: null,
      gradientHeight: 30,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      blurEnabled: true,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeScale: 100,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoScale: 100,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
    }
  }

  function paramsOf(url: string): URLSearchParams {
    return new URL(String(url), "http://localhost").searchParams
  }

  it("editor preview defaults to ranked, explicit all still travels", () => {
    expect(paramsOf(buildPreviewUrl(previewState() as never, badgeParams() as never)).get("freshScope")).toBe("ranked")
    expect(
      paramsOf(buildPreviewUrl(previewState() as never, { ...badgeParams(), posterFreshScope: "all" } as never)).get("freshScope"),
    ).toBe("all")
    expect(paramsOf(buildDefaultsPreviewUrl({})).get("freshScope")).toBe("ranked")
    expect(paramsOf(buildDefaultsPreviewUrl({ defaultPosterFreshScope: "all" })).get("freshScope")).toBe("all")
  })

  it("stremio builder: absent stays absent, saved explicit all travels as all", () => {
    expect(buildStremioPosterSearchParams({}).get("freshScope")).toBeNull()
    expect(buildStremioPosterSearchParams({ posterFreshScope: "all" }).get("freshScope")).toBe("all")
    const url = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: mapping({ posterFreshScope: "all" }),
    })
    expect(url.searchParams.get("freshScope")).toBe("all")
  })
})

describe("UI default is ranked (real provider + selector)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => null,
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function ScopeProbe() {
    const ed = usePosterEditor()
    return (
      <div>
        <div data-testid="probe-default">{ed.defaultPosterFreshScope}</div>
        <div data-testid="probe-live">{ed.posterFreshScope}</div>
        <button type="button" data-testid="probe-set-all" onClick={() => ed.setDefaultPosterFreshScope("all")}>
          all
        </button>
        <button type="button" data-testid="probe-set-live-all" onClick={() => ed.setPosterFreshScope("all")}>
          live-all
        </button>
      </div>
    )
  }

  it("live provider mounts with the ranked default when nothing is saved", async () => {
    renderWithCtx(createElement(ScopeProbe))
    expect(screen.getByTestId("probe-default").textContent).toBe("ranked")
    expect(screen.getByTestId("probe-live").textContent).toBe("ranked")
  })

  it("selecting all persists in the live provider (default + per-title)", async () => {
    renderWithCtx(createElement(ScopeProbe))
    await act(async () => {
      fireEvent.click(screen.getByTestId("probe-set-all"))
    })
    expect(screen.getByTestId("probe-default").textContent).toBe("all")
    await act(async () => {
      fireEvent.click(screen.getByTestId("probe-set-live-all"))
    })
    expect(screen.getByTestId("probe-live").textContent).toBe("all")
  })

  it("selector fails closed to ranked on absent/invalid value and emits explicit all", () => {
    const onChange = vi.fn()
    const { container, rerender } = renderWithCtx(
      createElement(PosterFreshScopeSelector, { layout: "fresh", value: undefined, onChange }),
    )
    expect((screen.getByTestId("fresh-scope-select") as HTMLSelectElement).value).toBe("ranked")
    rerender(createElement(PosterFreshScopeSelector, { layout: "fresh", value: "bogus", onChange }))
    expect((screen.getByTestId("fresh-scope-select") as HTMLSelectElement).value).toBe("ranked")
    fireEvent.change(screen.getByTestId("fresh-scope-select"), { target: { value: "all" } })
    expect(onChange).toHaveBeenCalledWith("all")
    expect(container.querySelector('[data-testid="fresh-scope-selector"]')).not.toBeNull()
  })

  it("selector stays hidden under Standard (preference kept, never reset)", () => {
    const { container } = renderWithCtx(
      createElement(PosterFreshScopeSelector, { layout: "standard", value: "ranked", onChange: () => {} }),
    )
    expect(container.querySelector('[data-testid="fresh-scope-selector"]')).toBeNull()
  })
})

// --- Real service renders: default-ranked equalities (no pinned values) ---

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.3,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: "2024-03-10",
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    shape: "poster",
    ...overrides,
  }
}

describe("service renders under the ranked default (both shapes)", () => {
  it("portrait: absent scope behaves ranked (no-rank Standard, valid-rank Fresh, explicit all keeps no-rank Fresh)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const standardNoRank = sha(
      await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: null })),
    )
    // Absent scope without rank falls back to Standard.
    expect(
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", finalRank: null }))),
    ).toBe(standardNoRank)
    // Invalid scope fails closed to ranked too.
    expect(
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "bogus" as never, finalRank: null }),
        ),
      ),
    ).toBe(standardNoRank)
    // Absent scope with a valid rank renders Fresh, identical to explicit all.
    const freshAll = sha(
      await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "all", finalRank: 6 }),
      ),
    )
    expect(
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", finalRank: 6 }))),
    ).toBe(freshAll)
    // Explicit all preserves the no-rank Fresh (differs from Standard).
    const freshAllNoRank = sha(
      await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "all", finalRank: null }),
      ),
    )
    expect(freshAllNoRank).not.toBe(standardNoRank)
    // Rank disabled under the default falls back to Standard.
    expect(
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", rankingEnabled: false, finalRank: 6 }),
        ),
      ),
    ).toBe(
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", rankingEnabled: false, finalRank: 6 }),
        ),
      ),
    )
  }, 180000)

  it("landscape: absent scope behaves ranked (no-rank Standard, valid-rank Fresh)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(LAND_W, LAND_H)
    const land = { shape: "landscape" } as const
    const standardNoRank = sha(
      await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "standard", finalRank: null })),
    )
    expect(
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", finalRank: null }))),
    ).toBe(standardNoRank)
    const freshAll = sha(
      await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "all", finalRank: 5 }),
      ),
    )
    expect(
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", finalRank: 5 }))),
    ).toBe(freshAll)
    const out = await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", finalRank: 5 }),
    )
    const meta = await sharp(out).metadata()
    expect({ w: meta.width, h: meta.height }).toEqual({ w: LAND_W, h: LAND_H })
  }, 180000)
})
