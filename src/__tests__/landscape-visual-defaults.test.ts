import type { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import { configTokenSchema } from "@/lib/config-token"
import { GET, PUT } from "@/app/api/defaults/route"
import { buildDefaultsPreviewUrl, buildPreviewUrl, type DefaultsPreviewParams } from "@/lib/poster-url"
import { buildStremioPosterUrl, stremioPosterShape } from "@/lib/stremio-poster-url"
import type { Mapping } from "@/lib/types"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-landscape-visual-test`,
}))

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ADMIN_TOKEN
})

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

const land = (shape: "poster" | "landscape", sd: Record<string, never> | object) =>
  resolvePosterRenderConfig(baseInput({
    searchParams: new URLSearchParams(shape === "landscape" ? { shape: "landscape" } : {}),
    sd: sd as never,
  }))

describe("landscape visual defaults: portrait unchanged, absent unchanged", () => {
  it("portrait ignores the landscape profile; absent profile keeps legacy", () => {
    const sd = {
      badgeStyle: "shadow", badgeGenre: true, badgeQuality: true,
      networkLogoPosition: "auto", ribbonEnabled: true,
      landscape: { badgeStyle: "pill", badgeGenre: false, badgeQuality: false, networkLogoPosition: "top", ribbonEnabled: false },
    } as never
    const portrait = land("poster", sd)
    expect(portrait.badgeStyle).toBe("shadow")
    expect(portrait.badgeGenre).toBe(true)
    expect(portrait.badgeQuality).toBe(true)
    expect(portrait.networkLogoPosition).toBe("auto")
    expect(portrait.ribbonEnabled).toBe(true)
    const bare = land("poster", {})
    expect(bare.badgeStyle).toBe("shadow")
    expect(bare.rankingBadgeStyle).toBe("default")
    expect(bare.extraBadgeStyle).toBeNull()
    expect(bare.badgeFont).toBe("inter")
    expect(bare.qualityBadgeStyle).toBe("standard")
    expect(bare.minQuality).toBe("SD")
  })

  it("explicit false/[]/0 win over flat, null/absent inherit", () => {
    const sd = {
      globalBadges: true, separateRatings: true, topBadgeScale: 100,
      videoFormats: ["dv", "atmos"], sashOrder: ["upcoming", "rank", "new", "award", "extra"],
      landscape: { globalBadges: false, separateRatings: false, videoFormats: [], sashOrder: [] },
    } as never
    const live = (shape: string) => resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape, live: "1" }),
      sd,
    }))
    expect(live("landscape").badgesEnabled).toBe(false)
    expect(live("poster").badgesEnabled).toBe(true)
    expect(land("landscape", sd).separateRatings).toBe(false)
    expect(land("poster", sd).separateRatings).toBe(true)
    // Null landscape values behave as absent (flat wins).
    const nulled = land("landscape", { badgeFont: "oswald", landscape: { badgeFont: null } } as never)
    expect(nulled.badgeFont).toBe("oswald")
  })
})

describe("landscape visual defaults: independent explicit values", () => {
  const sd = {
    badgeStyle: "shadow", rankingBadgeStyle: "default", badgeFont: "inter",
    qualityBadgeStyle: "standard", badgeYear: true, badgeRating: true,
    customRatings: true, networkLogo: true, preRelease: false, ribbonSide: "left",
    minQuality: "SD",
    landscape: {
      badgeStyle: "pill", rankingBadgeStyle: "corner", extraBadgeStyle: "vetro",
      badgeFont: "oswald", qualityBadgeStyle: "mono", badgeYear: false, badgeRating: false,
      customRatings: false, networkLogo: false, networkLogoPosition: "top",
      preRelease: true, ribbonSide: "right", ribbonEnabled: false, minQuality: "4K",
      sashOrder: ["extra"],
    },
  } as never

  it("landscape resolves the profile, portrait keeps flats", () => {
    const l = land("landscape", sd)
    expect(l.badgeStyle).toBe("pill")
    expect(l.rankingBadgeStyle).toBe("corner")
    expect(l.extraBadgeStyle).toBe("vetro")
    expect(l.badgeFont).toBe("oswald")
    expect(l.qualityBadgeStyle).toBe("mono")
    expect(l.badgeYear).toBe(false)
    expect(l.badgeRating).toBe(false)
    expect(l.customRatings).toBe(false)
    expect(l.networkLogo).toBe(false)
    expect(l.networkLogoPosition).toBe("top")
    expect(l.preRelease).toBe(true)
    expect(l.ribbonSide).toBe("right")
    expect(l.ribbonEnabled).toBe(false)
    expect(l.minQuality).toBe("4K")
    expect(l.sashOrder).toEqual(["extra"])
    const p = land("poster", sd)
    expect(p.badgeStyle).toBe("shadow")
    expect(p.rankingBadgeStyle).toBe("default")
    expect(p.extraBadgeStyle).toBeNull()
    expect(p.ribbonEnabled).toBe(true)
    expect(p.minQuality).toBe("SD")
  })

  it("explicit mapping flat still beats landscape defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: mapping({ badgeStyle: "colored", badgeYear: true }),
      sd,
    }))
    expect(r.badgeStyle).toBe("colored")
    expect(r.badgeYear).toBe(true)
    // Untouched keys still follow the landscape profile.
    expect(r.badgeRating).toBe(false)
  })

  it("query still beats everything in landscape", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape", bs: "bar", bg: "1" }),
      sd,
    }))
    expect(r.badgeStyle).toBe("shadow") // bar degrades in landscape, as before
    expect(r.badgeGenre).toBe(true)
  })
})

describe("landscape visual defaults: shared globals stay global", () => {
  it("ratingSources/region/dateFormat ignore the landscape profile", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: { ratingSources: ["imdb"], landscape: { badgeStyle: "pill" } } as never,
    }))
    expect(r.ratingSources).toEqual(["imdb"])
    expect(effectiveDefaultsForShape({ region: "US" }, "landscape")).toMatchObject({ region: "US" })
  })

  it("config token carries flat visuals only (no landscape subset)", () => {
    expect(configTokenSchema.safeParse({
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow",
      rankingBadgeStyle: "default", extraBadgeStyle: "corner",
      blurEnabled: true, blurIntensity: 5, blurFade: 60, blurDarkness: 40,
      gradientHeight: 30, networkLogo: true, autoRotateClean: false, logoFitEnabled: false,
    }).success).toBe(true)
    expect("landscape" in configTokenSchema.shape).toBe(false)
    // A token carrying a landscape key keeps validating: unknown keys are
    // stripped, flat contract unchanged.
    const withLand = configTokenSchema.safeParse({
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: true, blurIntensity: 5, blurFade: 60, blurDarkness: 40,
      gradientHeight: 30, networkLogo: true, autoRotateClean: false,
      landscape: { badgeStyle: "pill" },
    })
    expect(withLand.success).toBe(true)
    if (withLand.success) expect("landscape" in withLand.data).toBe(false)
  })
})

describe("landscape visual defaults: preview and Stremio agree per shape", () => {
  const flats: DefaultsPreviewParams = {
    defaultGlobalBadges: true, defaultBadgeGenre: true, defaultBadgeYear: true,
    defaultBadgeStyle: "shadow", defaultRankingBadgeStyle: "default",
    defaultNetworkLogoPosition: "auto", defaultRibbonEnabled: true,
  }
  const profile: LandscapeServerDefaults = {
    badgeStyle: "pill", badgeGenre: false, rankingBadgeStyle: "corner",
    networkLogoPosition: "top", ribbonEnabled: false,
  }

  it("same effective styles/toggles from preview URL and Stremio URL", () => {
    const preview = new URL(buildDefaultsPreviewUrl({
      ...flats, landscape: profile, previewShape: "landscape",
    })).searchParams
    expect(preview.get("shape")).toBe("landscape")
    expect(preview.get("bs")).toBe("pill")
    expect(preview.get("bg")).toBe("0")
    expect(preview.get("rs")).toBe("corner")
    expect(preview.get("ribbon")).toBe("0")
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, forceShape: "landscape",
      defaults: {
        globalBadges: true, badgeGenre: true, badgeStyle: "shadow",
        rankingBadgeStyle: "default", networkLogoPosition: "auto", ribbonEnabled: true,
        landscape: profile,
      },
    }).searchParams
    expect(stremio.get("shape")).toBe("landscape")
    const sd = {
      globalBadges: true, badgeGenre: true, badgeStyle: "shadow",
      rankingBadgeStyle: "default", networkLogoPosition: "auto", ribbonEnabled: true,
      landscape: profile,
    } as never
    const fromPreview = resolvePosterRenderConfig(baseInput({ searchParams: preview, sd }))
    const fromStremio = resolvePosterRenderConfig(baseInput({ searchParams: stremio, sd }))
    for (const k of ["badgeStyle", "rankingBadgeStyle", "badgeGenre", "networkLogoPosition", "ribbonEnabled"] as const) {
      expect(fromStremio[k]).toBe(fromPreview[k])
    }
    expect(fromPreview.badgeStyle).toBe("pill")
  })

  it("delivery shape ignores the landscape visual profile", () => {
    expect(stremioPosterShape(null, { landscape: profile } as never)).toBe("poster")
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { landscape: profile } as never,
    })
    expect(url.searchParams.has("shape")).toBe(false)
    expect(url.searchParams.get("bs")).toBe("shadow")
  })
})

describe("ribbonSide legacy restore", () => {
  const q = (params: Record<string, string>) => new URLSearchParams(params)
  it("portrait ignores saved flat side without query/config (legacy exact)", () => {
    expect(resolvePosterRenderConfig(baseInput({ sd: { ribbonSide: "right" } as never })).ribbonSide).toBe("left")
  })
  it("landscape without landscape override keeps legacy", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: q({ shape: "landscape" }),
      sd: { ribbonSide: "right" } as never,
    }))
    expect(r.ribbonSide).toBe("left")
  })
  it("explicit landscape side applies; live follows effective; query/config win", () => {
    const sd = { ribbonSide: "left", landscape: { ribbonSide: "right" } } as never
    expect(resolvePosterRenderConfig(baseInput({ searchParams: q({ shape: "landscape" }), sd })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: q({ shape: "landscape", live: "1" }), sd })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: q({ live: "1" }), sd: { ribbonSide: "right" } as never })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: q({ shape: "landscape", side: "left" }), sd })).ribbonSide).toBe("left")
    // Explicit landscape null = no override = legacy.
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: q({ shape: "landscape" }),
      sd: { ribbonSide: "right", landscape: { ribbonSide: null } } as never,
    })).ribbonSide).toBe("left")
  })
})

describe("nullable landscape visuals inherit flats", () => {
  it("landscape xbs=null keeps flat pill across resolve/preview/Stremio", () => {
    const sd = { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: null } } as never
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }), sd,
    })).extraBadgeStyle).toBe("pill")
    const preview = new URL(buildDefaultsPreviewUrl({
      defaultExtraBadgeStyle: "pill", landscape: { extraBadgeStyle: null }, previewShape: "landscape",
    })).searchParams
    expect(preview.get("xbs")).toBe("pill")
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, forceShape: "landscape",
      defaults: { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: null } },
    })
    expect(stremio.searchParams.get("xbs")).toBe("pill")
  })

  it("explicit [] formats survive; landscape logoScale null stays auto", () => {
    const preview = new URL(buildDefaultsPreviewUrl({
      defaultVideoFormats: ["dv"], landscape: { videoFormats: [] }, previewShape: "landscape",
    })).searchParams
    expect(preview.get("formats")).toBe("none")
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, forceShape: "landscape",
      defaults: { videoFormats: ["dv"], landscape: { videoFormats: [] } },
    })
    expect(stremio.searchParams.get("formats")).toBe("none")
    expect(effectiveDefaultsForShape({ logoScale: 60, landscape: { logoScale: null } }, "landscape").logoScale).toBeNull()
    expect(effectiveDefaultsForShape({ logoScale: 60, landscape: {} }, "landscape").logoScale).toBe(60)
  })

  it("landscape badgeFont null keeps flat font in resolve and Stremio URL", () => {
    const sd = { badgeFont: "oswald", landscape: { badgeFont: null } } as never
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }), sd,
    })).badgeFont).toBe("oswald")
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, forceShape: "landscape", defaults: sd,
    })
    expect(stremio.searchParams.get("bfont")).toBe("oswald")
  })
})

describe("toggle flags reach production URLs", () => {
  it("editor preview always carries explicit badges/ranking", () => {
    const selected = { id: 1, media_type: "movie" as const, poster_path: "/p.jpg" }
    const ps = {
      selected, previewPoster: null, selectedLogo: null, selectedBackdrop: null,
      logoScale: 75, logoOffsetX: 0, logoOffsetY: 0, backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 }, trendRank: null, mdblistAnimeList: [],
      topEdgeColor: null, lang: "it", tmdbKey: "",
    }
    const bp = {
      globalBadges: false, rankingBadges: false, badgeStyle: "shadow" as const, rankingBadgeStyle: "default" as const,
      customBadge: null, gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0, genreBadgeScale: 100,
      genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    }
    const p = new URL(buildPreviewUrl(ps, bp)).searchParams
    expect(p.get("badges")).toBe("0")
    expect(p.get("ranking")).toBe("0")
  })

  it("Stremio without config emits landscape flags when false; live bare resolves them", () => {
    const sd = { rankingBadges: true, landscape: { rankingBadges: false } } as never
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, forceShape: "landscape", defaults: sd,
    })
    expect(stremio.searchParams.get("ranking")).toBe("0")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: stremio.searchParams, sd })).rankingEnabled).toBe(false)
    // Direct live URL (followSpace carries no visual flags): effective defaults win.
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape", live: "1" }), sd,
    })).rankingEnabled).toBe(false)
  })

  it("legacy hasQuery special stays: mapping path ignores defaults without query/config", () => {
    // Intentional legacy: with a mapping but no query/config token, the
    // pre-resolved showBadges input wins over saved defaults.
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({}),
      showBadges: true,
      sd: { landscape: { globalBadges: false } } as never,
    }))
    expect(r.badgesEnabled).toBe(true)
  })
})

describe("PUT /api/defaults landscape visual profile", () => {
  function put(body: unknown): Request {
    return new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("persists explicit styles/toggles/arrays and returns them", async () => {
    delete process.env.ADMIN_TOKEN
    const res = await PUT(put({
      landscape: {
        badgeStyle: "pill", rankingBadgeStyle: "corner", extraBadgeStyle: "vetro",
        badgeFont: "oswald", qualityBadgeStyle: "mono", videoFormats: [],
        globalBadges: false, badgeGenre: false, minQuality: "4K",
        separateRatings: true, separateRatingsStyle: "bottom-pills",
        networkLogoPosition: "top", ribbonEnabled: false, sashOrder: ["extra"],
      },
    }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const body = await (await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)).json() as Record<string, Record<string, unknown>>
    expect(body.landscape).toMatchObject({
      badgeStyle: "pill", rankingBadgeStyle: "corner", extraBadgeStyle: "vetro",
      globalBadges: false, videoFormats: [], minQuality: "4K", sashOrder: ["extra"],
    })
  })

  it("rejects mistyped landscape visual values", async () => {
    delete process.env.ADMIN_TOKEN
    expect((await PUT(put({ landscape: { badgeStyle: "glossy" } }) as unknown as NextRequest)).status).toBe(400)
    expect((await PUT(put({ landscape: { globalBadges: "yes" } }) as unknown as NextRequest)).status).toBe(400)
  })
})
