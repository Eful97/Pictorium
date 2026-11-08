// @vitest-environment node
/**
 * `/api/filler-status` — read-only anime filler classification for the
 * per-title episode editor.
 *
 * Contracts:
 * - absolute numbering derives from regular TMDB seasons only (season 0 and
 *   missing/unknown seasons fail closed);
 * - the bundled snapshot decides the code; unknown series/out-of-window = null;
 * - the offset map is cached 12h, so navigating episodes reuses one details
 *   call;
 * - upstream failures and malformed ids never invent a classification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"

const tmdbCtl = vi.hoisted(() => ({
  seasons: [] as { season_number: number; episode_count: number }[],
  fail: false,
  detailsCalls: 0,
}))

const rateCtl = vi.hoisted(() => ({ ok: true }))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: rateCtl.ok, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    getDetails: vi.fn(async () => {
      tmdbCtl.detailsCalls += 1
      if (tmdbCtl.fail) throw new Error("upstream down")
      return { id: 46260, seasons: tmdbCtl.seasons }
    }),
    resolveRouteApiKey: vi.fn(async () => "test-key"),
  }
})

import { GET } from "@/app/api/filler-status/route"

const ORIGIN = "http://localhost:3000"

async function getStatus(query: string): Promise<{
  status: number
  body: { status?: string | null; statuses?: Record<string, string | null> }
}> {
  const req = new NextRequest(`${ORIGIN}/api/filler-status?${query}`)
  const res = await GET(req)
  return { status: res.status, body: await res.json() }
}

describe("GET /api/filler-status", () => {
  beforeEach(() => {
    cacheClear()
    tmdbCtl.seasons = []
    tmdbCtl.fail = false
    tmdbCtl.detailsCalls = 0
    rateCtl.ok = true
  })

  afterEach(() => {
    vi.clearAllMocks()
    cacheClear()
  })

  it("classifies Naruto S1E26 (absolute 26) as filler through the bundled snapshot", async () => {
    // Real TMDB series 46260 has a 26-episode first regular season; episode 26
    // is filler in the bundled classification.
    tmdbCtl.seasons = [{ season_number: 1, episode_count: 26 }]

    const { status, body } = await getStatus("tmdb=46260&season=1&episode=26")

    expect(status).toBe(200)
    expect(body.status).toBe("filler")
  })

  it("derives absolute episodes across regular seasons (season offsets)", async () => {
    tmdbCtl.seasons = [
      { season_number: 1, episode_count: 24 },
      { season_number: 2, episode_count: 3 },
    ]

    // S2E1 = absolute 25 (legacy canon range → manga), S2E2 = 26 (filler),
    // S2E3 = 27 (mixed).
    expect((await getStatus("tmdb=46260&season=2&episode=1")).body.status).toBe("manga")
    expect((await getStatus("tmdb=46260&season=2&episode=2")).body.status).toBe("filler")
    expect((await getStatus("tmdb=46260&season=2&episode=3")).body.status).toBe("mixed")
    // One details call serves the whole series (12h offset cache).
    expect(tmdbCtl.detailsCalls).toBe(1)
  })

  it("classifies a whole season in one batch request (additive episodes param)", async () => {
    tmdbCtl.seasons = [{ season_number: 1, episode_count: 26 }]

    const { status, body } = await getStatus("tmdb=46260&season=1&episodes=25,26,27,26")

    expect(status).toBe(200)
    // Absolute 25/26/27: manga/filler/mixed; the duplicate 26 collapses to one key.
    expect(body.statuses).toEqual({ "25": "manga", "26": "filler", "27": "mixed" })
    expect(tmdbCtl.detailsCalls).toBe(1)
  })

  it("fails closed for an invalid batch list (never a silently shorter list)", async () => {
    tmdbCtl.seasons = [{ season_number: 1, episode_count: 26 }]

    expect((await getStatus("tmdb=46260&season=1&episodes=1,abc")).status).toBe(400)
    expect((await getStatus("tmdb=46260&season=1&episodes=0")).status).toBe(400)
    expect((await getStatus("tmdb=46260&season=1&episodes=")).status).toBe(400)
    // Neither form supplied.
    expect((await getStatus("tmdb=46260&season=1")).status).toBe(400)
    expect(tmdbCtl.detailsCalls).toBe(0)
  })

  it("returns null values for a batch when the regular-season offsets are unavailable", async () => {
    tmdbCtl.seasons = [{ season_number: 0, episode_count: 5 }]

    const { status, body } = await getStatus("tmdb=46260&season=1&episodes=1,2")
    expect(status).toBe(200)
    expect(body.statuses).toEqual({ "1": null, "2": null })
  })

  it("returns null for unknown series, specials and out-of-window episodes", async () => {
    tmdbCtl.seasons = [{ season_number: 1, episode_count: 26 }]

    expect((await getStatus("tmdb=94001&season=1&episode=1")).body.status).toBeNull()
    // Specials (season 0) are not part of the absolute regular numbering.
    expect((await getStatus("tmdb=46260&season=0&episode=1")).body.status).toBeNull()
    // Inside the declared window but unclassified upstream: fail closed.
    expect((await getStatus("tmdb=46260&season=1&episode=999")).body.status).toBeNull()
  })

  it("returns null when TMDB has no regular seasons", async () => {
    tmdbCtl.seasons = [{ season_number: 0, episode_count: 5 }]
    expect((await getStatus("tmdb=46260&season=0&episode=1")).body.status).toBeNull()
  })

  it("fails open to null on upstream errors (never a guess, never a 500)", async () => {
    tmdbCtl.seasons = [{ season_number: 1, episode_count: 26 }]
    tmdbCtl.fail = true

    const { status, body } = await getStatus("tmdb=46260&season=1&episode=26")
    expect(status).toBe(200)
    expect(body.status).toBeNull()
  })

  it("rejects malformed identifiers (client treats any non-OK as no banner)", async () => {
    expect((await getStatus("tmdb=abc&season=1&episode=1")).status).toBe(400)
    expect((await getStatus("tmdb=46260&season=-1&episode=1")).status).toBe(400)
    expect((await getStatus("tmdb=46260&season=1&episode=0")).status).toBe(400)
    expect(tmdbCtl.detailsCalls).toBe(0)
  })

  it("rate limits without touching TMDB", async () => {
    rateCtl.ok = false
    const req = new NextRequest(`${ORIGIN}/api/filler-status?tmdb=46260&season=1&episode=26`)
    const res = await GET(req)
    expect(res.status).toBe(429)
    expect(tmdbCtl.detailsCalls).toBe(0)
  })
})
