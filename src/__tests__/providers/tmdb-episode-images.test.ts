import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { __clearTMDBCache, __resetKey401Cache, getTVEpisodeImages } from "@/lib/tmdb"
import { cacheClear, cacheGet } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const { GET } = await import("@/app/api/tmdb/[id]/season/[season]/episode/[episode]/images/route")

const STILLS_PAYLOAD = {
  id: 259909,
  stills: [
    {
      aspect_ratio: 1.778,
      file_path: "/still-one.jpg",
      height: 1080,
      iso_639_1: "en",
      vote_average: 5.3,
      vote_count: 3,
      width: 1920,
    },
    {
      aspect_ratio: 1.778,
      file_path: "/still-two.jpg",
      height: 1080,
      iso_639_1: null,
      vote_average: 0,
      vote_count: 0,
      width: 1920,
    },
  ],
}

function epReq(id: string, season: string, episode: string, query = ""): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/tmdb/${id}/season/${season}/episode/${episode}/images?type=tv&languages=en,null${query}`,
    { headers: { "x-api-key": "test-key" } },
  )
}

function epParams(id: string, season: string, episode: string) {
  return { params: Promise.resolve({ id, season, episode }) }
}

function mockFetchJson(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    status >= 200 && status < 300 ? Response.json(body) : new Response("upstream error", { status }),
  )
}

describe("getTVEpisodeImages (TMDB per-episode stills)", () => {
  beforeEach(() => {
    __clearTMDBCache()
    __resetKey401Cache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  it("mappa gli still e inoltra include_image_language come getImages", async () => {
    const fetchSpy = mockFetchJson(STILLS_PAYLOAD)

    const res = await getTVEpisodeImages(259909, 2, 1, "en,null", "test-key")

    expect(res.stills).toHaveLength(2)
    expect(res.stills[0]).toMatchObject({
      file_path: "/still-one.jpg",
      width: 1920,
      height: 1080,
      iso_639_1: "en",
      vote_average: 5.3,
      vote_count: 3,
    })
    expect(res.stills[1].file_path).toBe("/still-two.jpg")
    expect(res.stills[1].iso_639_1).toBeNull()

    const calledUrl = String(fetchSpy.mock.calls[0][0])
    expect(calledUrl).toContain("/tv/259909/season/2/episode/1/images")
    expect(calledUrl).toContain("include_image_language=en%2Cnull")
  })

  it("una risposta senza still restituisce un array vuoto (non un errore)", async () => {
    mockFetchJson({ id: 99, stills: [] })

    const res = await getTVEpisodeImages(99, 1, 1, "en,null", "test-key")

    expect(res.stills).toEqual([])
  })

  it("un 404 upstream fallisce in modo chiuso (nessuno stack grezzo)", async () => {
    mockFetchJson(null, 404)

    await expect(getTVEpisodeImages(404404, 1, 1, "en,null", "test-key")).rejects.toThrow(
      /TMDB fetch failed: 404/,
    )
  })

  it("rifiuta id non validi prima di qualsiasi chiamata di rete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(getTVEpisodeImages(0, 1, 1)).rejects.toThrow(/invalid series id/i)
    await expect(getTVEpisodeImages(259909, -1, 1)).rejects.toThrow(/invalid season number/i)
    await expect(getTVEpisodeImages(259909, 1, -1)).rejects.toThrow(/invalid episode number/i)
    await expect(getTVEpisodeImages(Number.NaN, 1, 1)).rejects.toThrow(/invalid series id/i)
    await expect(getTVEpisodeImages(1.5, 1, 1)).rejects.toThrow(/invalid series id/i)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("GET /api/tmdb/[id]/season/[season]/episode/[episode]/images", () => {
  beforeEach(() => {
    cacheClear()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  it("risponde 200 con gli still e mette in cache il successo (30 min, tag images)", async () => {
    const fetchSpy = mockFetchJson(STILLS_PAYLOAD)

    const res = await GET(epReq("259909", "2", "1"), epParams("259909", "2", "1"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stills).toHaveLength(2)
    expect(body.stills[0].file_path).toBe("/still-one.jpg")
    expect(cacheGet("episode_images:259909:2:1:en,null")).toEqual(STILLS_PAYLOAD)

    // Seconda richiesta: cache di risposta, nessun nuovo upstream.
    const res2 = await GET(epReq("259909", "2", "1"), epParams("259909", "2", "1"))
    expect(res2.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("risponde 502 su 404 upstream e NON mette in cache il fallimento", async () => {
    mockFetchJson(null, 404)

    const res = await GET(epReq("555001", "1", "1"), epParams("555001", "1", "1"))

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "TMDB episode images unavailable" })
    expect(cacheGet("episode_images:555001:1:1:en,null")).toBeNull()
  })

  it("rifiuta type diverso da tv con 400", async () => {
    const res = await GET(
      new NextRequest("http://localhost:3000/api/tmdb/259909/season/2/episode/1/images?type=movie"),
      epParams("259909", "2", "1"),
    )
    expect(res.status).toBe(400)
  })

  it("rifiuta id serie/stagione/episodio non numerici o negativi con 400", async () => {
    const badId = await GET(epReq("abc", "2", "1"), epParams("abc", "2", "1"))
    expect(badId.status).toBe(400)

    const badSeason = await GET(epReq("259909", "-1", "1"), epParams("259909", "-1", "1"))
    expect(badSeason.status).toBe(400)

    const badEpisode = await GET(epReq("259909", "2", "x"), epParams("259909", "2", "x"))
    expect(badEpisode.status).toBe(400)
  })
})
