/**
 * F3 regression: a scoped `?u=<uuid>` request WITHOUT an own key must never
 * fall back to operator env keys. These routes used to read the env directly
 * after the (guard-aware) resolver, bypassing the multi-user fallback policy.
 * Covered here: TVDB season types (TMDB env read) and preview episodes (TVDB
 * env read). The poster route's MDBList env read is covered by
 * poster-route-admission.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createUser } from "@/lib/user-auth"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

// Keep the real key resolver and the real getExternalIds (it owns the env
// fallback we are asserting on); stub only the preview details fetch.
vi.mock("@/lib/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...actual,
    getFullDetails: vi.fn(async () => ({
      id: 1396,
      external_ids: { imdb_id: "tt0903747" },
      seasons: [],
    })),
    getTVSeason: vi.fn(async () => null),
    getTVEpisodeGroup: vi.fn(async () => null),
  }
})

import { GET as seasonTypesGET } from "@/app/api/tvdb/[id]/seasonTypes/route"
import { GET as previewEpisodesGET } from "@/app/api/preview/episodes/route"

describe("scoped requests never inherit operator env keys", () => {
  beforeEach(() => {
    cacheClear()
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    vi.stubEnv("TMDB_KEY", "operator-tmdb-secret")
    vi.stubEnv("TVDB_API_KEY", "operator-tvdb-secret")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PICTORIUM_MULTI_USER
    delete process.env.MULTI_USER
    delete process.env.TMDB_KEY
    delete process.env.TMDB_API_KEY
    delete process.env.TVDB_API_KEY
    cacheClear()
    vi.restoreAllMocks()
  })

  it("seasonTypes does not use the TMDB env key for a bare ?u= request", async () => {
    const { uuid } = await createUser()
    const calls: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input))
      return Response.json({})
    })
    const req = new NextRequest(
      `http://pictorium.test/api/tvdb/71446/seasonTypes?u=${uuid}&tvdb_key=user-tvdb-key`,
    )
    const res = await seasonTypesGET(req, { params: Promise.resolve({ id: "71446" }) })
    expect(res.status).toBe(200)
    expect(calls.some((url) => url.includes("operator-tmdb-secret"))).toBe(false)
  })

  it("seasonTypes still uses the TMDB env key for the global (unscoped) path", async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input))
      return Response.json({})
    })
    const req = new NextRequest("http://pictorium.test/api/tvdb/71446/seasonTypes?tvdb_key=user-tvdb-key")
    const res = await seasonTypesGET(req, { params: Promise.resolve({ id: "71446" }) })
    expect(res.status).toBe(200)
    expect(calls.some((url) => url.includes("operator-tmdb-secret"))).toBe(true)
  })

  it("preview episodes ignores the TVDB env key for a bare ?u= request", async () => {
    const { uuid } = await createUser()
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest(
      `http://pictorium.test/api/preview/episodes?tmdbId=1396&episodeGroupId=tvdb&lang=it-IT&u=${uuid}`,
    )
    const res = await previewEpisodesGET(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { videos: unknown[]; totalEpisodes: number }
    expect(json.videos).toEqual([])
    // A resolved env key would have started the TVDB login/ordering chain.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("preview episodes still uses the TVDB env key for the global path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: "success", data: { token: "mock-jwt" } }),
    )
    const req = new NextRequest(
      "http://pictorium.test/api/preview/episodes?tmdbId=1396&episodeGroupId=tvdb&lang=it-IT",
    )
    const res = await previewEpisodesGET(req)
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalled()
  })
})
