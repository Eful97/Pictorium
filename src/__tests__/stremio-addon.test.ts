import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  addonCatalogIncompatibility,
  buildRemoteCatalogUrl,
  isSupportedAddonId,
  normalizeManifestUrl,
  parseSupportedTmdbRef,
  pictoriumExtraForAddon,
  rejectReasonForUrl,
  selectableAddonCatalogs,
  validateCatalogShape,
  validateManifestShape,
} from "@/lib/stremio-addon"
import { isSelfManifest } from "@/lib/stremio-addon-server"
import { buildManifestResponse } from "@/lib/build-manifest"
import { encodeConfig } from "@/lib/config-token"
import { NextRequest } from "next/server"

const MANIFEST_FIXTURE = {
  id: "com.example.test",
  name: "Test Addon",
  version: "1.0.0",
  catalogs: [
    { id: "top", type: "movie", name: "Popular", extra: [{ name: "genre", options: ["Action"] }, { name: "search" }, { name: "skip" }] },
    { id: "top", type: "series", name: "Popular", extra: [{ name: "search" }, { name: "skip" }] },
    { id: "last-videos", type: "series", name: "Last", extra: [{ name: "lastVideosIds", isRequired: true }] },
    { id: "anime", type: "anime", name: "Anime", extra: [] },
  ],
}

describe("stremio-addon import (MVP)", () => {
  it("normalizes manifest URLs to https manifest.json without credentials", () => {
    expect(normalizeManifestUrl("https://example.com/manifest.json")).toBe("https://example.com/manifest.json")
    expect(normalizeManifestUrl("https://example.com/")).toBe("https://example.com/manifest.json")
    expect(normalizeManifestUrl("http://example.com/manifest.json")).toBeNull()
    expect(normalizeManifestUrl("https://user:pass@example.com/manifest.json")).toBeNull()
    expect(normalizeManifestUrl("https://example.com/other.json")).toBeNull()
  })

  it("validates manifest shape and filters selectable movie/series", () => {
    const m = validateManifestShape(MANIFEST_FIXTURE)
    expect(m).not.toBeNull()
    const sel = selectableAddonCatalogs(m!)
    expect(sel.map((c) => `${c.type}:${c.id}`).sort()).toEqual(["movie:top", "series:last-videos", "series:top"])
    expect(addonCatalogIncompatibility(sel.find((c) => c.id === "last-videos")!)).toBe("extra-required:lastVideosIds")
    expect(addonCatalogIncompatibility(sel.find((c) => c.id === "top" && c.type === "movie")!)).toBeNull()
  })

  it("normalizes legacy extraSupported/extraRequired into modern extras", () => {
    const m = validateManifestShape({
      id: "com.example.legacy",
      name: "Legacy",
      catalogs: [
        // Solo formato legacy: search obbligatoria + skip facoltativa.
        { id: "s", type: "movie", name: "S", extraSupported: ["search", "skip"], extraRequired: ["search"] },
        // Required non supportato dal MVP: deve emergere come incompatibile.
        { id: "t", type: "series", name: "T", extraSupported: ["skip"], extraRequired: ["streamUrl"] },
        // Formato misto: il required legacy completa il moderno.
        { id: "m", type: "movie", name: "M", extra: [{ name: "genre" }], extraSupported: ["genre", "skip"], extraRequired: ["genre", "skip"] },
      ],
    })
    expect(m).not.toBeNull()
    const byId = Object.fromEntries(m!.catalogs.map((c) => [c.id, c]))
    expect(byId.s.extra).toEqual([{ name: "search", isRequired: true }, { name: "skip" }])
    expect(addonCatalogIncompatibility(byId.s)).toBeNull()
    expect(addonCatalogIncompatibility(byId.t)).toBe("extra-required:streamUrl")
    expect(byId.m.extra).toEqual([{ name: "genre", isRequired: true }, { name: "skip", isRequired: true }])
  })

  it("keeps modern extras untouched when no legacy fields exist", () => {
    const m = validateManifestShape(MANIFEST_FIXTURE)
    const top = m!.catalogs.find((c) => c.id === "top" && c.type === "movie")!
    expect(top.extra).toEqual([
      { name: "genre", options: ["Action"] },
      { name: "search" },
      { name: "skip" },
    ])
  })
  it("builds remote catalog URLs preserving base path with encoded params", () => {
    const u = buildRemoteCatalogUrl("https://example.com/addon/manifest.json", "movie", "top", {
      search: "Avatar & Me",
      skip: 20,
      genre: "Sci-Fi",
    })
    expect(u).toBe("https://example.com/addon/catalog/movie/top/search=Avatar%20%26%20Me&genre=Sci-Fi&skip=20.json")
    const u2 = buildRemoteCatalogUrl("https://example.com/manifest.json", "series", "top", {})
    expect(u2).toBe("https://example.com/catalog/series/top.json")
  })

  it("parses supported IDs (imdb/tmdb/tvdb) and rejects proprietary", () => {
    expect(parseSupportedTmdbRef("tt1234567")).toMatchObject({ kind: "imdb" })
    expect(parseSupportedTmdbRef("tmdb:123")).toMatchObject({ kind: "tmdb", tmdbId: 123 })
    expect(parseSupportedTmdbRef("tvdb:456")).toMatchObject({ kind: "tvdb" })
    expect(parseSupportedTmdbRef("kitsu:123")).toBeNull()
    expect(parseSupportedTmdbRef("mal:123")).toBeNull()
    expect(isSupportedAddonId("tt1234567")).toBe(true)
    expect(isSupportedAddonId("kitsu:123")).toBe(false)
  })

  it("preserves order, duplicates and IDs in catalog validation", () => {
    const items = validateCatalogShape({
      metas: [
        { id: "tt001", name: "A" },
        { id: "tt001", name: "A dup" },
        { id: "kitsu:9", name: "B" },
      ],
    })
    expect(items?.map((m) => m.id)).toEqual(["tt001", "tt001", "kitsu:9"])
  })

  it("exposes addon catalogs in manifest with source extras and stable distinct IDs", async () => {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      customCatalogs: [
        {
          id: "cat_one",
          name: "Test — Popular",
          type: "movie",
          url: "https://example.com/manifest.json",
          addon: {
            manifestUrl: "https://example.com/manifest.json",
            catalogId: "top",
            catalogType: "movie",
            extra: [{ name: "search" }, { name: "skip" }],
            addonName: "Test",
          },
        },
        {
          id: "cat_two",
          name: "Test — Popular 2",
          type: "movie",
          url: "https://example.com/manifest.json",
          addon: {
            manifestUrl: "https://example.com/manifest.json",
            catalogId: "top",
            catalogType: "movie",
            extra: [{ name: "search" }, { name: "skip" }],
          },
        },
      ],
    })
    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    const data = await res.json()
    const one = data.catalogs.find((c: { id: string }) => c.id === "pictorium-custom-movie-cat_one")
    const two = data.catalogs.find((c: { id: string }) => c.id === "pictorium-custom-movie-cat_two")
    expect(one).toBeDefined()
    expect(two).toBeDefined()
    expect(one.id).not.toBe(two.id)
    // Capacità della fonte preservate, niente generi generici aggiunti.
    expect(one.extra.map((e: { name: string }) => e.name).sort()).toEqual(["search", "skip"])
    expect(pictoriumExtraForAddon({ manifestUrl: "https://example.com/manifest.json", catalogId: "top", catalogType: "movie", extra: [{ name: "genre", isRequired: true, options: ["A"] }] })).toEqual([
      { name: "genre", isRequired: true, options: ["A"] },
    ])
  })

  it("keeps backward compat for configs without addon", async () => {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      customCatalogs: [
        { id: "old", name: "Old", type: "movie", url: "https://mdblist.com/lists/u/slug" },
      ],
    })
    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    const data = await res.json()
    expect(data.catalogs.some((c: { id: string }) => c.id === "pictorium-custom-movie-old")).toBe(true)
  })

  it("rejects credentials/non-https/private hosts without claiming secret detection", () => {
    expect(rejectReasonForUrl("https://user:pass@example.com/manifest.json")).toBe("credentials")
    expect(rejectReasonForUrl("http://example.com/manifest.json")).toBe("not_https")
    expect(rejectReasonForUrl("https://localhost/manifest.json")).toBe("private")
    expect(rejectReasonForUrl("https://192.168.1.10/manifest.json")).toBe("private")
    expect(normalizeManifestUrl("https://example.com/manifest.json?token=secret")).toBe(
      "https://example.com/manifest.json?token=secret",
    )
  })

  it("caps catalog validation and blocks self recursion", () => {
    const big = { metas: Array.from({ length: 101 }, (_, i) => ({ id: `tt${1000000 + i}` })) }
    expect(validateCatalogShape(big, 100)).toBeNull()
    expect(isSelfManifest("https://pictorium.test/manifest.json", "https://pictorium.test")).toBe(true)
    expect(isSelfManifest("https://example.com/manifest.json", "https://pictorium.test")).toBe(false)
  })

  it("never offers addon imports as Top 20 ranking sources", async () => {
    const ranking = await import("@/lib/ranking-source")
    const customs = [
      { id: "a1", name: "Addon", type: "movie" as const, url: "https://example.com/manifest.json", addon: { manifestUrl: "https://example.com/manifest.json", catalogId: "top", catalogType: "movie" as const } },
      { id: "l1", name: "List", type: "movie" as const, url: "https://mdblist.com/lists/u/s" },
    ]
    expect(ranking.compatibleRankingCustoms(customs, "movie").map((c) => c.id)).toEqual(["l1"])
    expect(ranking.resolveRankingSource({ customCatalogs: customs, rankingSourceMovie: "a1" }, "movie")).toEqual({ kind: "justwatch" })
    expect(ranking.resolveRankingSource({ customCatalogs: customs, rankingSourceMovie: "l1" }, "movie")).toEqual({ kind: "custom", customId: "l1" })
  })
})

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

vi.mock("@/lib/store", () => ({ getById: vi.fn(async () => null) }))
vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
    getServerDefaults: () => ({}),
  }
})

describe("stremio-addon catalog branch", () => {
  beforeEach(async () => {
    const { cacheClear } = await import("@/lib/cache")
    cacheClear()
    vi.mocked((await import("@/lib/stremio-addon-server")).fetchAddonCatalogPage).mockReset()
  })

  afterEach(async () => {
    const { cacheClear } = await import("@/lib/cache")
    cacheClear()
  })

  function addonToken() {
    return encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      customCatalogs: [
        {
          id: "addon1",
          name: "Test — Popular",
          type: "movie",
          url: "https://example.com/manifest.json",
          addon: {
            manifestUrl: "https://example.com/manifest.json",
            catalogId: "top",
            catalogType: "movie",
            extra: [{ name: "search" }, { name: "skip" }, { name: "genre", options: ["Action"] }],
            addonName: "Test",
          },
        },
      ],
    })
  }

  it("preserves order/duplicates/IDs, enriches supported and keeps unknown originals", async () => {
    const srv = await import("@/lib/stremio-addon-server")
    vi.mocked(srv.fetchAddonCatalogPage).mockResolvedValue({
      items: [
        { id: "tmdb:123", name: "A", poster: "https://orig/a.jpg", background: "https://orig/bg.jpg" },
        { id: "tmdb:123", name: "A dup", poster: "https://orig/a.jpg" },
        { id: "kitsu:9", name: "B", poster: "https://orig/b.jpg" },
      ],
    })
    const { GET } = await import("@/app/catalog/[type]/[id]/route")
    const token = addonToken()
    const req = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1.json?config=${token}`)
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:123", "tmdb:123", "kitsu:9"])
    expect(body.metas[0].poster).toContain("/api/poster/movie/123")
    expect(body.metas[1].poster).toContain("/api/poster/movie/123")
    // Sconosciuto conservato con immagini originali.
    expect(body.metas[2].poster).toBe("https://orig/b.jpg")
    // Originali preservati (background della fonte, non ricostruito via TMDB).
    expect(body.metas[0].background).toBe("https://orig/bg.jpg")
  })

  it("forwards pagination/search/filters to the source and isolates cache per params", async () => {
    const srv = await import("@/lib/stremio-addon-server")
    const mock = vi.mocked(srv.fetchAddonCatalogPage)
    mock.mockResolvedValue({ items: [{ id: "tmdb:1", name: "X" }] })
    const { GET } = await import("@/app/catalog/[type]/[id]/route")
    const { GET: GET_EXTRA } = await import("@/app/catalog/[type]/[id]/[...extra]/route")
    const token = addonToken()
    const req1 = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1.json?config=${token}`)
    await GET(req1, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1.json" }) })
    const req2 = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1/skip=20.json?config=${token}`)
    await GET_EXTRA(req2, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1", extra: ["skip=20.json"] }) })
    const req3 = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1/search=Avatar.json?config=${token}`)
    const res3 = await GET_EXTRA(req3, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1", extra: ["search=Avatar.json"] }) })
    expect((await res3.json()).metas).toHaveLength(1)
    const calls = mock.mock.calls.map((c) => c[3])
    expect(calls[0]).toMatchObject({})
    expect(calls[1]).toMatchObject({ skip: 20 })
    expect(calls[2]).toMatchObject({ search: "Avatar" })
    // Cache handler: stessa pagina riusa il body senza rifetch.
    const before = mock.mock.calls.length
    await GET(new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1.json?config=${token}`), {
      params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1.json" }),
    })
    expect(mock.mock.calls.length).toBe(before)
  })

  it("keeps the title when enrichment throws", async () => {
    const srv = await import("@/lib/stremio-addon-server")
    vi.mocked(srv.fetchAddonCatalogPage).mockResolvedValue({
      items: [{ id: "tmdb:999", name: "Boom", poster: "https://orig/boom.jpg" }],
    })
    const store = await import("@/lib/store")
    vi.mocked(store.getById).mockRejectedValueOnce(new Error("store down"))
    const { GET } = await import("@/app/catalog/[type]/[id]/route")
    const token = addonToken()
    const req = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1.json?config=${token}&x=${Date.now()}`)
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1.json" }) })
    const body = await res.json()
    // Il titolo resta: o arricchito o originale, mai eliminato.
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tmdb:999")
  })

  it("skips the local genre filter on addon catalogs (year-like genres)", async () => {
    // Cinemeta year: genre=2024 è un anno, non un genere — il filtro locale
    // per nome lo confrontava con genres=['Drama'] ed eliminava tutto.
    const srv = await import("@/lib/stremio-addon-server")
    const mock = vi.mocked(srv.fetchAddonCatalogPage)
    mock.mockResolvedValue({
      items: [
        { id: "tmdb:21", name: "Drama 2024 A", genres: ["Drama"], poster: "https://orig/21.jpg" },
        { id: "tmdb:22", name: "Drama 2024 B", genres: ["Drama"], poster: "https://orig/22.jpg" },
      ],
    })
    const { GET: GET_EXTRA } = await import("@/app/catalog/[type]/[id]/[...extra]/route")
    const token = addonToken()
    const req = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-addon1/genre=2024.json?config=${token}`)
    const res = await GET_EXTRA(req, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-addon1", extra: ["genre=2024.json"] }) })
    const body = await res.json()
    expect(mock.mock.calls[0][3]).toMatchObject({ genre: "2024" })
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:21", "tmdb:22"])
  })
})
