import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import {
  detectCatalogProvider,
  fetchUnifiedCatalogItems,
  fetchUnifiedCatalogResult,
} from "@/lib/custom-catalog-providers"
import { cacheClear, cacheInvalidate } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { encodeConfig } from "@/lib/config-token"
import { buildManifestResponse } from "@/lib/build-manifest"
import { getById } from "@/lib/store"
import { GET as GET_PREVIEW } from "@/app/api/mdblist/custom/route"
import { GET as GET_CATALOG } from "@/app/catalog/[type]/[id]/route"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const mockedGetById = vi.mocked(getById)

const CLIENT_ID = "test-trakt-media-client-id"

const MEDIA_URLS = {
  trending: "https://app.trakt.tv/discover/trending?mode=media",
  anticipated: "https://app.trakt.tv/discover/anticipated?mode=media",
  popular: "https://app.trakt.tv/discover/popular?mode=media",
} as const

const MEDIA_ENDPOINTS = {
  trending: "api.trakt.tv/media/trending",
  anticipated: "api.trakt.tv/media/anticipated",
  popular: "api.trakt.tv/media/popular",
} as const

function movieMedia(imdb: string | null, tmdb: number | null, title: string, year: number) {
  return { title, year, ids: { trakt: 1000 + (tmdb ?? 0), slug: "m", imdb, tmdb } }
}

function showMedia(
  imdb: string | null,
  tmdb: number | null,
  title: string,
  year: number,
  tvdb: number | null = null,
) {
  return { title, year, ids: { trakt: 2000 + (tmdb ?? tvdb ?? 0), slug: "s", tvdb, imdb, tmdb } }
}

// Official GET /media/trending shape (developer.trakt.tv openapi 3.0.2):
// [{ watchers, movie?|show? }] — wrapped, no `type` field, movie/show keys
// discriminate the record.
function trendingMediaEntry(kind: "movie" | "show", media: unknown, watchers = 9) {
  return kind === "movie" ? { watchers, movie: media } : { watchers, show: media }
}

// Official GET /media/anticipated shape: [{ list_count, movie?|show? }].
function anticipatedMediaEntry(kind: "movie" | "show", media: unknown, listCount = 9) {
  return kind === "movie" ? { list_count: listCount, movie: media } : { list_count: listCount, show: media }
}

describe.each([
  ["trending", "Trakt Trending Movies & Shows"],
  ["anticipated", "Trakt Anticipated Movies & Shows"],
  ["popular", "Trakt Popular Movies & Shows"],
] as const)("detectCatalogProvider: Trakt %s (mixed media)", (kind, name) => {
  it(`detects app.trakt.tv/discover/${kind}?mode=media as trakt/mixed`, () => {
    const res = detectCatalogProvider(MEDIA_URLS[kind])
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("trakt")
    expect(res?.nameSuggestion).toBe(name)
    expect(res?.defaultType).toBe("mixed")
  })

  it("accepts the www and bare trakt.tv hosts for media", () => {
    for (const url of [
      `https://www.trakt.tv/discover/${kind}?mode=media`,
      `https://trakt.tv/discover/${kind}?mode=media`,
    ]) {
      const res = detectCatalogProvider(url)
      expect(res?.provider).toBe("trakt")
      expect(res?.defaultType).toBe("mixed")
    }
  })

  it("matches the mode value case-insensitively", () => {
    const res = detectCatalogProvider(`https://app.trakt.tv/discover/${kind}?mode=Media`)
    expect(res?.provider).toBe("trakt")
    expect(res?.defaultType).toBe("mixed")
  })

  it("keeps the movie/show detects for mode=movie and mode=show", () => {
    expect(detectCatalogProvider(`https://app.trakt.tv/discover/${kind}?mode=movie`)?.defaultType).toBe("movie")
    expect(detectCatalogProvider(`https://app.trakt.tv/discover/${kind}?mode=show`)?.defaultType).toBe("series")
  })

  it("rejects lookalike hosts (exact host restriction)", () => {
    expect(detectCatalogProvider(`https://trakt.tv.evil.com/discover/${kind}?mode=media`)).toBeNull()
    expect(detectCatalogProvider(`https://app.trakt.tv.evil.com/discover/${kind}?mode=media`)).toBeNull()
  })
})

describe("fetchUnifiedCatalogResult: Trakt trending media (mixed)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    cacheInvalidate("custom_catalogs")
  })

  it("yields both movies and series in API interleaving order via /media/trending", async () => {
    const seenUrls: string[] = []
    let seenKey = ""
    global.fetch = vi.fn().mockImplementation((url: string, opts?: { headers?: Record<string, string> }) => {
      seenUrls.push(String(url))
      seenKey = String(opts?.headers?.["trakt-api-key"] || "")
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008), 42),
          trendingMediaEntry("show", showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189), 41),
          trendingMediaEntry("movie", movieMedia("tt0800080", 1724, "Hulk", 2008), 40),
        ],
      })
    }) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult(MEDIA_URLS.trending)
    expect(result.status).toBe("ok")
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toMatchObject({ imdb: "tt0371746", tmdb: 1726, title: "Iron Man", year: 2008, mediatype: "movie" })
    expect(result.items[1]).toMatchObject({ imdb: "tt0903747", tmdb: 1396, tvdb: 81189, title: "Breaking Bad", mediatype: "tv" })
    expect(result.items[2]).toMatchObject({ title: "Hulk", mediatype: "movie" })
    expect(seenUrls[0]).toContain(MEDIA_ENDPOINTS.trending)
    expect(seenUrls[0]).toContain("limit=100")
    expect(seenKey).toBe(CLIENT_ID)
  })

  it("rejects ambiguous (both keys) and missing (neither key) wrapped records", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008)),
          { watchers: 5, movie: movieMedia("tt0133093", 603, "Matrix", 1999), show: showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189) },
          { watchers: 4 },
          { error: "upstream hiccup" },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.trending)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Iron Man")
  })

  it("keeps the show TVDB id as fallback when IMDb/TMDB are missing", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [trendingMediaEntry("show", showMedia(null, null, "Tvdb Only", 2026, 37552))],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.trending)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ tvdb: 37552, mediatype: "tv" })
  })

  it("bounds pagination to the requested limit without concatenating scopes", async () => {
    const seenUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url))
      const page = Number(new URL(String(url)).searchParams.get("page") || "1")
      const payload =
        page <= 2
          ? Array.from({ length: 100 }, (_, i) =>
              i % 2
                ? trendingMediaEntry("show", showMedia(null, page * 1000 + i, `S${page * 1000 + i}`, 2030, 90000 + i))
                : trendingMediaEntry("movie", movieMedia(null, page * 1000 + i, `M${page * 1000 + i}`, 2030)),
            )
          : []
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "X-Pagination-Page-Count": "10" }),
        json: async () => payload,
      })
    }) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult(MEDIA_URLS.trending, { limit: 150 })
    expect(result.status).toBe("ok")
    expect(result.items).toHaveLength(150)
    expect(global.fetch).toHaveBeenCalledTimes(2)
    // Single upstream ranking: every page hits /media/trending, never
    // /movies/trending + /shows/trending concatenation.
    expect(seenUrls.every((u) => u.includes("api.trakt.tv/media/trending"))).toBe(true)
    expect(result.items.filter((i) => i.mediatype === "tv")).toHaveLength(75)
    expect(result.items.filter((i) => i.mediatype === "movie")).toHaveLength(75)
  })

  it("serves the landed prefix as incomplete on abort instead of freezing it", async () => {
    const ctrl = new AbortController()
    let page2 = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
      const u = String(input)
      if (u.includes("/media/trending")) {
        if (u.includes("page=2")) {
          page2++
          const sig = init?.signal as AbortSignal | undefined
          queueMicrotask(() => ctrl.abort())
          await new Promise<void>((_res, rej) => {
            sig?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")), { once: true })
          })
          throw new DOMException("Aborted", "AbortError")
        }
        return Response.json(
          Array.from({ length: 100 }, (_, i) => trendingMediaEntry("movie", movieMedia(null, 5000 + i, `A${i}`, 2030))),
        )
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(MEDIA_URLS.trending, { signal: ctrl.signal })
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(100)
    expect(first.incomplete).toBe(true)
    expect(page2).toBe(1)

    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/media/trending")) {
        if (u.includes("page=2")) {
          return Response.json([trendingMediaEntry("show", showMedia(null, 6000, "B", 2031, 4242))])
        }
        return Response.json(
          Array.from({ length: 100 }, (_, i) => trendingMediaEntry("movie", movieMedia(null, 5000 + i, `A${i}`, 2030))),
        )
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(MEDIA_URLS.trending)
    expect(second.items).toHaveLength(101)
    expect(second.incomplete).toBeFalsy()
  })

  it("treats a top-level error body as transient, not as entries", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ error: "bad gateway" }),
      })
    ) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult(MEDIA_URLS.trending)
    expect(result.items).toEqual([])
    expect(result.status).toBe("unavailable")
  })

  it("maps key_missing/private/not_found/rate_limited distinctly", async () => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    global.fetch = vi.fn(() => Promise.reject(new Error("must not fetch"))) as unknown as typeof fetch
    expect((await fetchUnifiedCatalogResult(MEDIA_URLS.trending)).status).toBe("key_missing")
    expect(global.fetch).not.toHaveBeenCalled()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID

    for (const [status, expected] of [
      [401, "private"],
      [403, "private"],
      [404, "not_found"],
      [429, "rate_limited"],
    ] as const) {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({ ok: false, status, headers: new Headers(), json: async () => ({}) })
      ) as unknown as typeof fetch
      expect((await fetchUnifiedCatalogResult(`${MEDIA_URLS.trending}&t=${status}`)).status).toBe(expected)
    }
  })
})

describe("fetchUnifiedCatalogResult: Trakt anticipated media (mixed)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    cacheInvalidate("custom_catalogs")
  })

  it("yields both movies and series in API interleaving order via /media/anticipated", async () => {
    const seenUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url))
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          anticipatedMediaEntry("show", showMedia("tt0944947", 1399, "Game of Thrones", 2011, 121361), 42),
          anticipatedMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008), 41),
        ],
      })
    }) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult(MEDIA_URLS.anticipated)
    expect(result.status).toBe("ok")
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ imdb: "tt0944947", tmdb: 1399, title: "Game of Thrones", mediatype: "tv" })
    expect(result.items[1]).toMatchObject({ imdb: "tt0371746", title: "Iron Man", mediatype: "movie" })
    expect(seenUrls[0]).toContain(MEDIA_ENDPOINTS.anticipated)
  })

  it("rejects ambiguous and keyless wrapped records", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          anticipatedMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008)),
          { list_count: 3, movie: movieMedia("tt0133093", 603, "Matrix", 1999), show: showMedia("tt0903747", 1396, "BB", 2008, 1) },
          { list_count: 2 },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.anticipated)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Iron Man")
  })
})

describe("fetchUnifiedCatalogResult: Trakt popular media (mixed, bare records)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    cacheInvalidate("custom_catalogs")
  })

  it("discriminates bare movie/show records by official shape via /media/popular", async () => {
    const seenUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url))
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          // Bare movie with extended=full: explicit `released` marker.
          { ...movieMedia("tt0371746", 1726, "Iron Man", 2008), released: "2008-05-02" },
          // Bare show, minimal shape: tvdb key present, no extended fields.
          showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189),
          // Bare show, full shape marker.
          { ...showMedia("tt0944947", 1399, "Game of Thrones", 2011, 121361), aired_episodes: 73 },
        ],
      })
    }) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult(MEDIA_URLS.popular)
    expect(result.status).toBe("ok")
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toMatchObject({ imdb: "tt0371746", tmdb: 1726, mediatype: "movie" })
    expect(result.items[1]).toMatchObject({ imdb: "tt0903747", tvdb: 81189, mediatype: "tv" })
    expect(result.items[2]).toMatchObject({ title: "Game of Thrones", mediatype: "tv" })
    expect(seenUrls[0]).toContain(MEDIA_ENDPOINTS.popular)
    expect(seenUrls[0]).toContain("extended=full")
  })

  it("requests extended=full only for mixed popular (single-scope and mixed trending/anticipated stay minimal)", async () => {
    const seenUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url))
      const u = String(url)
      if (u.includes("/media/popular")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [{ ...movieMedia("tt0371746", 1726, "Iron Man", 2008), released: "2008-05-02" }],
        })
      }
      if (u.includes("/media/trending")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008))],
        })
      }
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] })
    }) as unknown as typeof fetch

    await fetchUnifiedCatalogResult(MEDIA_URLS.popular)
    await fetchUnifiedCatalogResult(MEDIA_URLS.trending)
    const popularUrl = seenUrls.find((u) => u.includes("/media/popular")) ?? ""
    const trendingUrl = seenUrls.find((u) => u.includes("/media/trending")) ?? ""
    expect(popularUrl).toContain("extended=full")
    expect(trendingUrl).not.toContain("extended")
  })

  it("never defaults a schema-valid minimal record without type markers to movie", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        // Schema-valid for EITHER oneOf variant (required only [title, ids],
        // tvdb optional): without `released`/show markers the type is
        // unknowable — must be skipped, never silently movie.
        json: async () => [
          { title: "Markerless", year: 2026, ids: { trakt: 7, slug: "x", imdb: "tt0000007", tmdb: 7007 } },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.popular)
    expect(items).toHaveLength(0)
  })

  it("accepts explicit null-valued markers (released:null is movie, first_aired:null is show)", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          { title: "Null Movie", year: 2026, released: null, ids: { trakt: 8, slug: "x", imdb: "tt0000008", tmdb: 8008 } },
          { title: "Null Show", year: 2026, first_aired: null, ids: { trakt: 9, slug: "y", imdb: "tt0000009", tmdb: 9009 } },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.popular)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: "Null Movie", mediatype: "movie" })
    expect(items[1]).toMatchObject({ title: "Null Show", mediatype: "tv" })
  })

  it("rejects records carrying both movie and show markers as ambiguous", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          { ...movieMedia("tt0371746", 1726, "Iron Man", 2008), released: "2008-05-02" },
          // Both markers: released (movie) + first_aired/tvdb (show).
          { title: "Both", year: 2026, released: "2026-01-01", first_aired: "2026-01-02", ids: { trakt: 10, slug: "z", tvdb: 4242, imdb: "tt0000010", tmdb: 10010 } },
          { ...showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189), first_aired: "2008-01-20" },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.popular)
    expect(items.map((i) => i.title)).toEqual(["Iron Man", "Breaking Bad"])
  })

  it("treats a present-but-null tvdb key as a show marker (property, not value)", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ title: "No Tvdb Value", year: 2026, ids: { trakt: 5, slug: "x", tvdb: null, imdb: "tt9999999", tmdb: 424242 } }],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.popular)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ mediatype: "tv", imdb: "tt9999999" })
  })

  it("skips wrapped-looking and id-less records in popular media (bare-only shape)", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          { ...movieMedia("tt0371746", 1726, "Iron Man", 2008), released: "2008-05-02" },
          { movie: movieMedia("tt0133093", 603, "Matrix", 1999) },
          { title: "No Ids", year: 2030, released: "2030-01-01", ids: { trakt: 9, slug: "x", imdb: null, tmdb: null } },
          { error: "upstream hiccup" },
        ],
      })
    ) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems(MEDIA_URLS.popular)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Iron Man")
  })
})

describe("fetchUnifiedCatalogResult: Trakt discovery cache separation", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    cacheInvalidate("custom_catalogs")
  })

  it("keeps movie, show and media caches apart (no cross-serving)", async () => {
    const movieUrl = "https://app.trakt.tv/discover/trending?mode=movie"
    const showUrl = "https://app.trakt.tv/discover/trending?mode=show"
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      const payload = u.includes("/media/trending")
        ? [trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008))]
        : u.includes("/shows/trending")
          ? [{ watchers: 1, show: showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189) }]
          : [{ watchers: 1, movie: movieMedia("tt0800080", 1724, "Hulk", 2008) }]
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => payload })
    }) as unknown as typeof fetch

    const movieRes = await fetchUnifiedCatalogResult(movieUrl)
    expect(movieRes.items.map((i) => i.title)).toEqual(["Hulk"])
    const showRes = await fetchUnifiedCatalogResult(showUrl)
    expect(showRes.items.map((i) => i.title)).toEqual(["Breaking Bad"])
    const mediaRes = await fetchUnifiedCatalogResult(MEDIA_URLS.trending)
    expect(mediaRes.items.map((i) => i.title)).toEqual(["Iron Man"])
    expect(global.fetch).toHaveBeenCalledTimes(3)

    // Re-fetching the movie URL is a cache hit: no fourth upstream call.
    const movieAgain = await fetchUnifiedCatalogResult(movieUrl)
    expect(movieAgain.items.map((i) => i.title)).toEqual(["Hulk"])
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })
})

describe("fetchUnifiedCatalogResult: ordinary mixed Trakt user lists keep films and series", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    cacheInvalidate("custom_catalogs")
  })

  it("preserves interleaved movie/show/season items with correct mediatypes", async () => {
    const seenUrls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url))
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [
          { type: "movie", movie: movieMedia("tt0371746", 1726, "Iron Man", 2008) },
          { type: "show", show: showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189) },
          { type: "season", show: showMedia("tt0944947", 1399, "Game of Thrones", 2011, 121361) },
          { type: "movie", movie: movieMedia("tt0800080", 1724, "Hulk", 2008) },
        ],
      })
    }) as unknown as typeof fetch

    const result = await fetchUnifiedCatalogResult("https://trakt.tv/users/donxy/lists/misto-film-serie")
    expect(result.status).toBe("ok")
    expect(result.items).toHaveLength(4)
    expect(result.items.map((i) => i.mediatype)).toEqual(["movie", "tv", "tv", "movie"])
    expect(result.items.map((i) => i.title)).toEqual(["Iron Man", "Breaking Bad", "Game of Thrones", "Hulk"])
    expect(seenUrls[0]).toContain("api.trakt.tv/users/donxy/lists/misto-film-serie/items/movie,show")
  })
})

describe("Trakt media discovery consumers: preview, manifest, catalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockResolvedValue(null)
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    delete process.env.TRAKT_API_URL
  })

  afterEach(() => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_API_URL
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    cacheInvalidate("custom_catalogs")
    __clearTMDBCache()
    __clearImdbCache()
  })

  function mockMediaTrending() {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes("api.trakt.tv/media/trending")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [
            trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008), 42),
            trendingMediaEntry("show", showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189), 41),
          ],
        })
      }
      return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => ({}) })
    }) as unknown as typeof fetch
  }

  it("preview route serves both movies and series for a mixed media URL", async () => {
    mockMediaTrending()
    const res = await GET_PREVIEW(
      new NextRequest(`http://localhost:3000/api/mdblist/custom?url=${encodeURIComponent(MEDIA_URLS.trending)}&limit=10`),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ media_type: string; title: string }>
      provider: string
      suggestedName: string
      defaultType: string
      status: string
    }
    expect(body.status).toBe("ok")
    expect(body.provider).toBe("trakt")
    expect(body.suggestedName).toBe("Trakt Trending Movies & Shows")
    expect(body.defaultType).toBe("mixed")
    expect(body.items.map((i) => i.media_type)).toEqual(["movie", "tv"])
    expect(body.items.map((i) => i.title)).toEqual(["Iron Man", "Breaking Bad"])
  })

  it("preview route slices a mixed media URL by media_type without dropping the other side", async () => {
    mockMediaTrending()
    const movies = await (
      await GET_PREVIEW(
        new NextRequest(`http://localhost:3000/api/mdblist/custom?url=${encodeURIComponent(MEDIA_URLS.trending)}&media_type=movie`),
      )
    ).json() as { items: Array<{ media_type: string }>; total: number }
    expect(movies.items).toHaveLength(1)
    expect(movies.items[0].media_type).toBe("movie")
    expect(movies.total).toBe(1)

    const series = await (
      await GET_PREVIEW(
        new NextRequest(`http://localhost:3000/api/mdblist/custom?url=${encodeURIComponent(MEDIA_URLS.trending)}&media_type=tv`),
      )
    ).json() as { items: Array<{ media_type: string }>; total: number }
    expect(series.items).toHaveLength(1)
    expect(series.items[0].media_type).toBe("tv")
    expect(series.total).toBe(1)
  })

  it("manifest splits a saved mixed media URL into movie and series catalogs", async () => {
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
          id: "trakt-media-trending",
          name: "Trakt Trending Movies & Shows",
          type: "mixed",
          url: MEDIA_URLS.trending,
          enabled: true,
        },
      ],
    })

    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    const data = (await res.json()) as { catalogs: Array<{ id: string; name: string; type: string }> }

    const movieCat = data.catalogs.find((c) => c.id === "pictorium-custom-movie-trakt-media-trending")
    const seriesCat = data.catalogs.find((c) => c.id === "pictorium-custom-series-trakt-media-trending")
    expect(movieCat).toBeDefined()
    expect(movieCat?.type).toBe("movie")
    expect(seriesCat).toBeDefined()
    expect(seriesCat?.type).toBe("series")
  })

  it("Stremio catalogs filter one mixed media URL per resource (movie hides shows, series hides movies)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("api.trakt.tv/media/trending")) {
        return Response.json([
          trendingMediaEntry("movie", movieMedia("tt0371746", 1726, "Iron Man", 2008), 42),
          trendingMediaEntry("show", showMedia("tt0903747", 1396, "Breaking Bad", 2008, 81189), 41),
        ])
      }
      if (u.includes("/external_ids") || u.includes("/images")) {
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        const id = Number(m?.[1] ?? m?.[2] ?? 0)
        if (u.includes("/external_ids")) return Response.json({ id, imdb_id: null })
        return Response.json({ id, backdrops: [], posters: [], logos: [] })
      }
      if (u.includes("/find/")) return Response.json({ movie_results: [], tv_results: [] })
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-01-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })

    const cid = "trakt-media-mix"
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
      customCatalogs: [
        { id: cid, name: "Media Mix", type: "mixed", url: MEDIA_URLS.trending, enabled: true },
      ],
    })

    const movieReq = new NextRequest(
      `http://localhost:3000/catalog/movie/pictorium-custom-movie-${cid}.json?api_key=test-key&config=${token}`,
    )
    const movieRes = await GET_CATALOG(movieReq, {
      params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }),
    })
    const movieBody = (await movieRes.json()) as { metas: Array<{ id: string }> }
    expect(movieBody.metas.map((m) => m.id)).toEqual(["tt0371746"])

    const seriesReq = new NextRequest(
      `http://localhost:3000/catalog/series/pictorium-custom-series-${cid}.json?api_key=test-key&config=${token}`,
    )
    const seriesRes = await GET_CATALOG(seriesReq, {
      params: Promise.resolve({ type: "series", id: `pictorium-custom-series-${cid}.json` }),
    })
    const seriesBody = (await seriesRes.json()) as { metas: Array<{ id: string }> }
    expect(seriesBody.metas.map((m) => m.id)).toEqual(["tt0903747"])
  })
})
