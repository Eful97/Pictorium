import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { decodeConfig, encodeConfig, partialCatalogTokenSchema } from "@/lib/config-token"
import {
  getExplicitCatalogShape,
  mappingHasBothShapeBases,
  normalizeCatalogShapeKeys,
  sanitizeCatalogShapes,
} from "@/lib/catalog-shape"
import { normalizeCatalogRating, normalizeCatalogRatingString } from "@/lib/catalog-handler"
import { collectLocalBackup, applyLocalBackup } from "@/lib/backup-local"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const mockedGetById = vi.mocked(getById)

function justWatchResponse(tmdbId: number, imdbId?: string): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: {
              content: {
                externalIds: { tmdbId, imdbId: imdbId ?? null },
              },
            },
          },
        ],
      },
    },
  })
}

function tmdbShowResponse(tmdbId: number): Response {
  return Response.json({
    id: tmdbId,
    name: "House of the Dragon",
    poster_path: "/house-of-the-dragon.jpg",
    first_air_date: "2022-08-21",
  })
}

function portraitMapping() {
  return {
    tmdbId: 94997,
    mediaType: "tv",
    title: "House of the Dragon",
    posterPath: "/house-of-the-dragon.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    posterShape: "poster",
    updatedAt: "2026-07-16T10:15:30.000Z",
  }
}

/** Both base families saved (portrait poster + chosen landscape backdrop). */
function dualBaseMapping(partial: Record<string, unknown> = {}) {
  return {
    ...portraitMapping(),
    backdropPath: "/house-of-the-dragon-backdrop.jpg",
    ...partial,
  }
}

async function getCatalogItem(catalogId: string) {
  const req = new NextRequest(`http://localhost:3000/catalog/series/${catalogId}.json?api_key=settings-key`)
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `${catalogId}.json` }) })
  return (await res.json()).metas[0]
}

describe("catalog-shape helper", () => {
  it("sanitizes records strictly: legacy ids normalized, malformed skipped, prototype safe", () => {
    const clean = sanitizeCatalogShapes({
      "pictorium-jw-series": "landscape",
      "posterium-jw-movies": "poster",
      "pictorium-netflix-movies": "global",
      "pictorium-x": "sideways",
      "pictorium-y": 42,
      __proto__: "landscape",
      constructor: "poster",
      prototype: "poster",
      ["k".repeat(81)]: "poster",
    })
    expect(clean).toEqual({
      "pictorium-jw-series": "landscape",
      "pictorium-jw-movies": "poster",
    })
  })

  it("caps entries at a reasonable bound", () => {
    const input: Record<string, string> = {}
    for (let i = 0; i < 300; i++) input[`pictorium-jw-${i}`] = "poster"
    expect(Object.keys(sanitizeCatalogShapes(input))).toHaveLength(200)
  })

  it("normalizeCatalogShapeKeys preserves absent-vs-empty and normalizes legacy ids", () => {
    expect(normalizeCatalogShapeKeys(undefined)).toBeUndefined()
    expect(normalizeCatalogShapeKeys(null)).toBeUndefined()
    expect(normalizeCatalogShapeKeys({})).toEqual({})
    expect(normalizeCatalogShapeKeys({ "posterium-jw-series": "landscape" })).toEqual({
      "pictorium-jw-series": "landscape",
    })
  })

  it("getExplicitCatalogShape uses own-property lookup with legacy normalization", () => {
    const shapes = { "pictorium-jw-series": "landscape" } as Record<string, string>
    expect(getExplicitCatalogShape("pictorium-jw-series", shapes)).toBe("landscape")
    expect(getExplicitCatalogShape("posterium-jw-series", shapes)).toBe("landscape")
    expect(getExplicitCatalogShape("pictorium-jw-movies", shapes)).toBeUndefined()
    expect(getExplicitCatalogShape("toString", shapes)).toBeUndefined()
    expect(getExplicitCatalogShape("__proto__", shapes)).toBeUndefined()
    expect(getExplicitCatalogShape("pictorium-jw-series", undefined)).toBeUndefined()
  })

  it("mappingHasBothShapeBases requires a portrait AND a saved landscape base", () => {
    expect(mappingHasBothShapeBases(null)).toBe(false)
    // Portrait-only save: the landscape family stays absent/null.
    expect(mappingHasBothShapeBases({ ...portraitMapping(), backdropPath: null } as never)).toBe(false)
    // Chosen landscape backdrop (TMDB or custom) = second base saved.
    expect(mappingHasBothShapeBases(dualBaseMapping() as never)).toBe(true)
    expect(mappingHasBothShapeBases({
      ...portraitMapping(), backdropPath: null, customBackdropUrl: "https://example.com/land.jpg",
    } as never)).toBe(true)
    // Automatic landscape backdrop written as null is not a saved base.
    expect(mappingHasBothShapeBases({ ...portraitMapping(), posterShape: "landscape", backdropPath: null } as never)).toBe(false)
  })
})

describe("per-catalog format truth matrix (route)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
    __clearTMDBCache()
    // Fixed chart cycles: no cross-test snapshot/lease leakage.
    __resetChartGenerationForTest()
  })

  it("absent map keeps the legacy forced-global behavior byte-identical", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "landscape" })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("landscape")
    expect(new URL(item.poster).searchParams.get("shape")).toBe("landscape")
    expect(item.landscapePoster).toBe(item.poster)
  })

  it("absent map honors a per-title landscape mapping under a portrait global", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "poster" })
    mockedGetById.mockResolvedValue({ ...portraitMapping(), posterShape: "landscape" } as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(Response.json({ id: 94997, logos: [] }))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("landscape")
  })

  it("explicit portrait countermands a landscape global for that catalog only, keeping logo and dropping landscapePoster", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "landscape",
      catalogShapes: { "pictorium-jw-series": "poster" },
    })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        logos: [{ file_path: "/hotd-logo.png", iso_639_1: "it" }],
      }))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("poster")
    expect(new URL(item.poster).searchParams.get("shape")).not.toBe("landscape")
    expect(item.landscapePoster).toBeUndefined()
    expect(item.logo).toContain("/hotd-logo.png")
    // Banner always stays landscape + hideLogo for other clients.
    expect(item.banner).toContain("shape=landscape")
    expect(item.banner).toContain("hideLogo=1")
  })

  it("explicit landscape forces a portrait mapping to landscape with baked-in card and no separate logo", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "poster",
      catalogShapes: { "pictorium-jw-series": "landscape" },
    })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        logos: [{ file_path: "/hotd-logo.png", iso_639_1: "it" }],
      }))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("landscape")
    const posterUrl = new URL(item.poster)
    expect(posterUrl.searchParams.get("shape")).toBe("landscape")
    expect(posterUrl.searchParams.has("hideLogo")).toBe(false)
    expect(item.landscapePoster).toBe(item.poster)
    expect(item.logo).toBeUndefined()
    expect(item.banner).toContain("hideLogo=1")
  })

  it("same title in two catalogs resolves independently and the stored mapping is untouched", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "landscape",
      catalogShapes: { "pictorium-jw-series": "poster" },
    })
    const stored = portraitMapping()
    mockedGetById.mockResolvedValue({ ...stored } as never)
    const emptyLogos = () => Response.json({ id: 94997, logos: [] })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(emptyLogos())
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(emptyLogos())
    const forcedPortrait = await getCatalogItem("pictorium-jw-series")
    expect(forcedPortrait.posterShape).toBe("poster")
    // The other catalog still follows the landscape global.
    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const other = (await res.json()).metas[0]
    expect(other.posterShape).toBe("landscape")
    // The mapping store still holds the portrait mapping (never rewritten).
    expect(mockedGetById).toHaveBeenCalled()
    expect(stored.posterShape).toBe("poster")
  })

  it("legacy posterium-* shape keys apply to the canonical catalog id", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "poster",
      catalogShapes: { "posterium-jw-series": "landscape" },
    })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("landscape")
  })

  it("dual-format saved title serves portrait poster AND landscape landscapePoster, omitting the separate logo", async () => {
    // Last save was landscape (posterShape landscape) but the portrait base
    // survives: the two canvases must not collapse into one. `poster` is the
    // portrait rendering (Stremio/vertical), `landscapePoster` the landscape
    // one (Nuvio horizontal, logo baked-in) — no separate logo overlay.
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "poster" })
    mockedGetById.mockResolvedValue(dualBaseMapping({ posterShape: "landscape" }) as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("poster")
    const posterUrl = new URL(item.poster)
    expect(posterUrl.searchParams.get("shape")).toBe(null)
    expect(posterUrl.searchParams.has("hideLogo")).toBe(false)
    expect(new URL(item.landscapePoster).searchParams.get("shape")).toBe("landscape")
    expect(new URL(item.landscapePoster).searchParams.has("hideLogo")).toBe(false)
    expect(item.landscapePoster).not.toBe(item.poster)
    // Nuvio overlays `logo` on the landscape canvas: omit it.
    expect(item.logo).toBeUndefined()
    // Clean banner unchanged (landscape + no logo).
    expect(item.banner).toContain("shape=landscape")
    expect(item.banner).toContain("hideLogo=1")
  })

  it("dual-format title keeps both canvases even under the global landscape default", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "landscape" })
    mockedGetById.mockResolvedValue(dualBaseMapping({ posterShape: "poster" }) as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("poster")
    expect(new URL(item.poster).searchParams.get("shape")).toBe(null)
    expect(new URL(item.landscapePoster).searchParams.get("shape")).toBe("landscape")
    expect(item.logo).toBeUndefined()
  })

  it("a config-token override wins over namespace shapes without leaking credentials", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "poster",
      catalogShapes: { "pictorium-jw-series": "poster" },
    })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      blurEnabled: true,
      blurIntensity: 12,
      blurFade: 45,
      blurDarkness: 55,
      gradientHeight: 50,
      networkLogo: true,
      autoRotateClean: false,
      catalogShapes: { "pictorium-jw-series": "landscape" },
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const req = new NextRequest(
      `http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key&mdblist_key=secret-key&config=${token}`,
    )
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const item = (await res.json()).metas[0]
    expect(item.posterShape).toBe("landscape")
    expect(item.poster).not.toContain("mdblist_key")
    expect(item.poster).not.toContain("secret-key")
    expect(item.banner).not.toContain("secret-key")
  })

  it("a token without shapes inherits the namespace map", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({
      posterShape: "poster",
      catalogShapes: { "pictorium-jw-series": "landscape" },
    })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      blurEnabled: true,
      blurIntensity: 12,
      blurFade: 45,
      blurDarkness: 55,
      gradientHeight: 50,
      networkLogo: true,
      autoRotateClean: false,
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const req = new NextRequest(
      `http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key&config=${token}`,
    )
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const item = (await res.json()).metas[0]
    expect(item.posterShape).toBe("landscape")
  })
})

describe("catalogShapes transport validation", () => {
  it("round-trips through signed config tokens and rejects unknown enums", () => {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      blurEnabled: true,
      blurIntensity: 12,
      blurFade: 45,
      blurDarkness: 55,
      gradientHeight: 50,
      networkLogo: true,
      autoRotateClean: false,
      catalogShapes: { "pictorium-jw-series": "landscape" },
    })
    expect(decodeConfig(token)?.catalogShapes).toEqual({ "pictorium-jw-series": "landscape" })
    const tampered = Buffer.from(
      JSON.stringify({
        globalBadges: true,
        rankingBadges: true,
        badgeStyle: "pill",
        rankingBadgeStyle: "pill",
        blurEnabled: true,
        blurIntensity: 12,
        blurFade: 45,
        blurDarkness: 55,
        gradientHeight: 50,
        networkLogo: true,
        autoRotateClean: false,
        catalogShapes: { "pictorium-jw-series": "global" },
      }),
      "utf-8",
    ).toString("base64url")
    expect(decodeConfig(tampered)).toBeNull()
  })

  it("partial catalog tokens accept shapes and stay strict on unknown keys", () => {
    const ok = partialCatalogTokenSchema.safeParse({
      catalogShapes: { "pictorium-jw-series": "poster" },
    })
    expect(ok.success).toBe(true)
    const bad = partialCatalogTokenSchema.safeParse({
      catalogShapes: { "pictorium-jw-series": "poster" },
      posterShape: "landscape",
    })
    expect(bad.success).toBe(false)
  })

  it("backup round-trips shapes and skips malformed/prototype entries", () => {
    const storage = new Map<string, string>()
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    }
    store.setItem(
      "pictorium_catalog_shapes",
      JSON.stringify({
        "pictorium-jw-series": "landscape",
        "pictorium-jw-movies": "global",
        __proto__: "landscape",
      }),
    )
    const collected = collectLocalBackup(store, null)
    expect(collected.catalogs?.shapes).toEqual({ "pictorium-jw-series": "landscape" })
    const fresh = new Map<string, string>()
    const freshStore = {
      getItem: (k: string) => fresh.get(k) ?? null,
      setItem: (k: string, v: string) => { fresh.set(k, v) },
    }
    const applied = applyLocalBackup(freshStore, null, { catalogs: collected.catalogs })
    expect(applied.applied).toContain("catalogs.shapes")
    expect(JSON.parse(fresh.get("pictorium_catalog_shapes")!)).toEqual({ "pictorium-jw-series": "landscape" })
    // All-malformed never wipes the current map.
    const res = applyLocalBackup(freshStore, null, { catalogs: { shapes: { a: "bogus" } } })
    expect(res.skipped).toContain("catalogs.shapes")
    expect(JSON.parse(fresh.get("pictorium_catalog_shapes")!)).toEqual({ "pictorium-jw-series": "landscape" })
  })
})

describe("universal catalog fields (poster / background / logo)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
    __clearTMDBCache()
    __resetChartGenerationForTest()
  })

  function showWithBackdrop(tmdbId: number, voteAverage = 8.4): Response {
    return Response.json({
      id: tmdbId,
      name: "House of the Dragon",
      poster_path: "/house-of-the-dragon.jpg",
      backdrop_path: "/house-of-the-dragon-backdrop.jpg",
      first_air_date: "2022-08-21",
      vote_average: voteAverage,
    })
  }

  it("background is always the raw TMDB original path, never the poster render", async () => {
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(showWithBackdrop(94997))
      .mockResolvedValueOnce(Response.json({ id: 94997, logos: [] }))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.poster).toContain("/api/poster/series/94997")
    expect(item.background).toContain("/t/p/original/house-of-the-dragon-backdrop.jpg")
    // Raw TMDB hero art: never a Pictorium render, never the logo render.
    expect(item.background).not.toContain("/api/poster")
  })

  it("dual-format rows keep the portrait poster plus the landscape canvas and the raw background", async () => {
    // Both base families saved: `poster` stays portrait (the universal card
    // field), `landscapePoster` is additive Nuvio art, background is raw.
    mockedGetById.mockResolvedValue(dualBaseMapping({ posterShape: "landscape" }) as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(showWithBackdrop(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(new URL(item.poster).searchParams.get("shape")).toBe(null)
    expect(new URL(item.poster).searchParams.has("hideLogo")).toBe(false)
    expect(new URL(item.landscapePoster).searchParams.get("shape")).toBe("landscape")
    expect(item.background).toContain("/t/p/original/house-of-the-dragon-backdrop.jpg")
    expect(item.background).not.toContain("/api/poster")
    // Nuvio overlays `logo` on the baked-in landscape canvas: omit it.
    expect(item.logo).toBeUndefined()
  })

  it("single-base landscape rows keep a valid poster URL and raw background while advertising their shape", async () => {
    // Historical contract (unchanged): a single-base title forced to
    // landscape by the global default serves a 16:9 `poster` and declares
    // `posterShape=landscape`; vertical clients must honor that hint or pin
    // the catalog to poster. The tradeoff is documented in .agents/catalog.md.
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "landscape" })
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(showWithBackdrop(94997))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.posterShape).toBe("landscape")
    expect(item.poster).toContain("/api/poster/series/94997")
    expect(new URL(item.poster).searchParams.get("shape")).toBe("landscape")
    expect(item.background).toContain("/t/p/original/house-of-the-dragon-backdrop.jpg")
    expect(item.background).not.toContain("/api/poster")
    // The baked-in landscape canvas suppresses the separate logo (Nuvio).
    expect(item.logo).toBeUndefined()
  })

  it("keeps landscapePoster/banner additive: portrait rows only carry the clean banner", async () => {
    mockedGetById.mockResolvedValue(portraitMapping() as never)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(showWithBackdrop(94997))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        logos: [{ file_path: "/hotd-logo.png", iso_639_1: "it" }],
      }))
    const item = await getCatalogItem("pictorium-jw-series")
    // Universal fields present for every client.
    expect(item.poster).toContain("/api/poster/series/94997")
    expect(item.background).toContain("/t/p/original/")
    expect(item.logo).toContain("/hotd-logo.png")
    // Nuvio-only fields: banner is always the clean landscape canvas,
    // landscapePoster only exists when a landscape canvas is served.
    expect(item.banner).toContain("hideLogo=1")
    expect(item.landscapePoster).toBeUndefined()
  })

  it("never leaks a percent rating into imdbRating", async () => {
    mockedGetById.mockResolvedValue(null)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      // A percent-style upstream value (e.g. 88%) must never reach the
      // Stremio item: imdbRating is a 0-10 value only.
      .mockResolvedValueOnce(showWithBackdrop(94997, 88))
    const item = await getCatalogItem("pictorium-jw-series")
    expect(item.imdbRating).toBeUndefined()
    // The row is still served with its universal fields.
    expect(item.poster).toContain("/api/poster/series/94997")
    expect(item.background).toContain("/t/p/original/")
  })

  it("normalizeCatalogRating guards the 0.1..10 decimal contract", () => {
    expect(normalizeCatalogRating(8.4)).toBe("8.4")
    expect(normalizeCatalogRating(10)).toBe("10.0")
    expect(normalizeCatalogRating(0.1)).toBe("0.1")
    expect(normalizeCatalogRating(0)).toBeUndefined()
    expect(normalizeCatalogRating(0.05)).toBeUndefined()
    expect(normalizeCatalogRating(-1)).toBeUndefined()
    expect(normalizeCatalogRating(10.01)).toBeUndefined()
    expect(normalizeCatalogRating(88)).toBeUndefined()
    expect(normalizeCatalogRating(Number.NaN)).toBeUndefined()
    expect(normalizeCatalogRating(undefined)).toBeUndefined()
    expect(normalizeCatalogRating(null)).toBeUndefined()
    // Cached raw bodies go through the same guard.
    expect(normalizeCatalogRatingString("8.4")).toBe("8.4")
    expect(normalizeCatalogRatingString("88")).toBeUndefined()
    expect(normalizeCatalogRatingString("")).toBeUndefined()
    expect(normalizeCatalogRatingString(8.4)).toBeUndefined()
  })
})
