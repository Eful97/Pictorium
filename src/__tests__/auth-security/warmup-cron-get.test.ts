/**
 * Vercel Cron regression: `vercel.json` schedules `GET /api/warmup`, but the
 * route used to export only POST (405 for the cron). GET is authenticated
 * exclusively via `Authorization: Bearer <CRON_SECRET>` (constant-time
 * comparison); without CRON_SECRET the route stays fail-closed (401).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/justwatch", () => ({ getJWRankings: vi.fn(async () => []) }))
vi.mock("@/lib/imdb-top250", () => ({ warmTop250: vi.fn(async () => undefined) }))
vi.mock("@/lib/store", () => ({ getAll: vi.fn(async () => []) }))
vi.mock("@/lib/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tmdb")>()
  return { ...actual, getTrending: vi.fn(async () => ({ results: [] })) }
})

import { GET } from "@/app/api/warmup/route"

const EMPTY_QUERY = "?trending=0&justwatch=0&mappings=0&catalogs=0"

function cronRequest(secret?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/warmup${EMPTY_QUERY}`, {
    method: "GET",
    ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
  })
}

describe("GET /api/warmup — Vercel Cron bearer auth", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
  let savedCronSecret: string | undefined

  beforeEach(() => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
    savedCronSecret = process.env.CRON_SECRET
  })

  afterEach(() => {
    if (savedCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedCronSecret
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(cronRequest("anything"))
    expect(res.status).toBe(401)
  })

  it("returns 401 when the bearer token is absent", async () => {
    process.env.CRON_SECRET = "test-cron-secret"
    const res = await GET(cronRequest())
    expect(res.status).toBe(401)
  })

  it("returns 401 when the bearer token does not match", async () => {
    process.env.CRON_SECRET = "test-cron-secret"
    const res = await GET(cronRequest("wrong-secret"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with a correct bearer token (empty queue, no self-fetch)", async () => {
    process.env.CRON_SECRET = "test-cron-secret"
    const res = await GET(cronRequest("test-cron-secret"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { total: number }
    expect(body.total).toBe(0)
  })
})
