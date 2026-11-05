/**
 * `/api/tmdb/search` exposes an additive `imdbRating` (Cinemeta IMDb) per row.
 *
 * Contract: the field is present only with a usable Cinemeta vote (0-10
 * decimal string, never `0.0`/percent); `vote_average` stays untouched for
 * backward compatibility and the UI is the fail-open fallback. The ratings
 * leg is bounded (~1200ms total, max 5 concurrent) and can never fail the
 * search itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tmdb/search/route"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { __resetCinemetaBreaker, __resetCinemetaNullForTest } from "@/lib/cinemeta"
import { cacheClear } from "@/lib/cache"

const ENV_KEYS = ["PICTORIUM_TMDB_KEY", "POSTERIUM_TMDB_KEY", "TMDB_BASE_URL"] as const
let savedEnv: Record<string, string | undefined> = {}

const CINEMETA = "v3-cinemeta.strem.io"

function req(url: string): NextRequest {
  // Plain JSON: without accept-encoding jsonGzip legacy-compresses bodies
  // above 1KB, which the test Response cannot decode.
  return new NextRequest(url, { headers: { "accept-encoding": "identity" } })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function searchPayload(results: unknown[]) {
  return {
    page: 1,
    total_pages: 1,
    total_results: results.length,
    results,
  }
}

function routeUrl(query: string): string {
  return `http://x/api/tmdb/search?q=${encodeURIComponent(query)}&api_key=good-key`
}

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
  __resetCinemetaBreaker()
  __resetCinemetaNullForTest()
  vi.restoreAllMocks()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
  __resetCinemetaBreaker()
  __resetCinemetaNullForTest()
  vi.unstubAllGlobals()
})

describe("GET /api/tmdb/search imdbRating (Cinemeta, fail-open)", () => {
  it("adds the Cinemeta IMDb rating when available and leaves vote_average untouched", async () => {
    const cinemetaCalls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const u = String(input)
        if (u.includes("/search/multi")) {
          return json(
            searchPayload([
              { id: 101, media_type: "movie", title: "Hit", poster_path: "/a.jpg", vote_average: 7.1 },
              { id: 102, media_type: "tv", name: "Miss", poster_path: null, vote_average: 6.4 },
            ]),
          )
        }
        if (u.includes("/movie/101/external_ids")) return json({ id: 101, imdb_id: "tt9000101" })
        if (u.includes("/tv/102/external_ids")) return json({ id: 102, imdb_id: "tt9000102" })
        if (u.includes(CINEMETA)) {
          cinemetaCalls.push(u)
          if (u.includes("/meta/movie/tt9000101.json")) return json({ meta: { imdbRating: "9.1" } })
          return json({ meta: {} })
        }
        return json({}, 404)
      }),
    )

    const res = await GET(req(routeUrl("imdbhit1")))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.results[0]).toMatchObject({ id: 101, vote_average: 7.1, imdbRating: "9.1" })
    // Miss genuino: campo assente (la UI ripiega su vote_average), mai "0.0".
    expect(body.results[1].id).toBe(102)
    expect(body.results[1].vote_average).toBe(6.4)
    expect(body.results[1]).not.toHaveProperty("imdbRating")
    // Cinemeta è interrogata per entrambe le righe con IMDb id (la riga
    // "miss" prova anche il tipo secondario, comportamento del provider).
    expect(cinemetaCalls.some((u) => u.includes("tt9000101"))).toBe(true)
    expect(cinemetaCalls.some((u) => u.includes("tt9000102"))).toBe(true)
    expect(cinemetaCalls.length).toBeLessThanOrEqual(3)
  })

  it("never fails the search when Cinemeta is in error (429) and keeps vote_average", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const u = String(input)
        if (u.includes("/search/multi")) {
          return json(
            searchPayload([
              { id: 111, media_type: "movie", title: "Errore", poster_path: null, vote_average: 8.2 },
            ]),
          )
        }
        if (u.includes("/movie/111/external_ids")) return json({ id: 111, imdb_id: "tt9000111" })
        if (u.includes(CINEMETA)) return json({}, 429)
        return json({}, 404)
      }),
    )

    const res = await GET(req(routeUrl("imdberror1")))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results[0].vote_average).toBe(8.2)
    expect(body.results[0]).not.toHaveProperty("imdbRating")
  })

  it("enforces the ~1200ms total budget on the ratings leg (search still 200)", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: 200 + i,
      media_type: "movie",
      title: `Title ${i}`,
      poster_path: null,
      vote_average: 5,
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown) => {
        const u = String(input)
        if (u.includes("/search/multi")) return Promise.resolve(json(searchPayload(rows)))
        // Upstream appeso e non cooperativo: il cap interno TMDB deve comunque
        // liberare la riga entro il budget condiviso.
        if (u.includes("/external_ids")) return new Promise<Response>(() => {})
        return Promise.resolve(json({}, 404))
      }),
    )

    const started = Date.now()
    const res = await GET(req(routeUrl("imdbbudget1")))
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(20)
    expect(body.results.every((r: { imdbRating?: string }) => r.imdbRating === undefined)).toBe(true)
    // ~1200ms di budget: mai oltre il tetto, e il tempo è stato davvero atteso.
    expect(elapsed).toBeGreaterThanOrEqual(900)
    expect(elapsed).toBeLessThan(3000)
  })

  it("caps the ratings leg at 5 concurrent requests", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: 300 + i,
      media_type: "movie",
      title: `Concurrent ${i}`,
      poster_path: null,
      vote_average: 4,
    }))
    let active = 0
    let maxActive = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const u = String(input)
        if (u.includes("/search/multi")) return json(searchPayload(rows))
        if (u.includes("/external_ids")) {
          active += 1
          maxActive = Math.max(maxActive, active)
          try {
            await new Promise((resolve) => setTimeout(resolve, 20))
            const id = Number(u.match(/\/(?:movie|tv)\/(\d+)\/external_ids/)?.[1] ?? 0)
            return json({ id, imdb_id: null })
          } finally {
            active -= 1
          }
        }
        return json({}, 404)
      }),
    )

    const res = await GET(req(routeUrl("imdbconcurrency1")))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(12)
    expect(maxActive).toBeLessThanOrEqual(5)
    expect(maxActive).toBeGreaterThan(1)
  })
})
