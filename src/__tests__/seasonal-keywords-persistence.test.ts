/**
 * Seasonal keywords persistence (user-scoped settings):
 * - hook: real useCustomCatalogs sanitizes on write, persists locally and
 *   carries the keywords in the canonical catalog PUT;
 * - server: real PUT/GET /api/defaults route on an isolated DATA_DIR
 *   round-trips the bounded arrays and rejects overlong input (400).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { NextRequest } from "next/server"

vi.mock("@/lib/http", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/http")>()
  return { ...mod, userFetch: vi.fn() }
})
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }))

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-seasonal-keywords-test`,
}))

vi.mock("@/lib/user-auth", () => ({
  checkUserAuth: vi.fn(async () => true),
  getScopedUserId: vi.fn((raw: string | null) => raw),
  extractUserParam: vi.fn((req: Request) => new URL(req.url).searchParams.get("u")),
  invalidUserResponse: () => new Response("bad user", { status: 400 }),
  isMultiUserEnabled: () => true,
  userAuthResponse: () => new Response("auth", { status: 401 }),
  userRateLimitKey: (req: Request) => `test:${req.url}`,
}))

import { userFetch } from "@/lib/http"
import { useCustomCatalogs } from "@/lib/useCustomCatalogs"

const mockedFetch = vi.mocked(userFetch)
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function memStore() {
  const map = new Map<string, string>()
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v)
    },
    raw: map,
  }
}

function mockPutRequest(body: unknown, url = "http://localhost:3000/api/defaults"): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function freshRoute() {
  const fs = await import("node:fs")
  fs.rmSync(`${process.cwd()}/test-results/data-seasonal-keywords-test`, {
    recursive: true,
    force: true,
  })
  vi.resetModules()
  return await import("@/app/api/defaults/route")
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ADMIN_TOKEN
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("hook: seasonal keywords sanitize + local persist + PUT sync", () => {
  it("sanitizes on write, persists locally, syncs via the canonical PUT", async () => {
    const store = memStore()
    mockedFetch.mockImplementation(async (url, init) => {
      if ((init as RequestInit)?.method === "PUT") {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
      }
      return { ok: true, json: async () => ({}) } as unknown as Response
    })
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.seasonalHalloweenKeywords).toEqual([]))

    act(() => {
      result.current.setSeasonalHalloweenKeywords(["  Spooky Season ", "spooky season", "", "x".repeat(41), "cozy"])
    })
    // Sanitized: trimmed, deduped (match-form), overlong dropped.
    expect(result.current.seasonalHalloweenKeywords).toEqual(["Spooky Season", "cozy"])
    expect(JSON.parse(store.raw.get("pictorium_seasonal_halloween_keywords") ?? "[]")).toEqual([
      "Spooky Season",
      "cozy",
    ])

    // The debounced canonical PUT carries the sanitized keywords.
    await waitFor(() => {
      const puts = mockedFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT")
      expect(puts.length).toBeGreaterThan(0)
      const last = JSON.parse(String((puts[puts.length - 1][1] as RequestInit)?.body))
      expect(last.seasonalHalloweenKeywords).toEqual(["Spooky Season", "cozy"])
      expect(last.seasonalChristmasKeywords).toEqual([])
    })

    // Christmas list is independent; reset clears both.
    act(() => {
      result.current.setSeasonalChristmasKeywords(["pumpkin spice"])
    })
    expect(result.current.seasonalChristmasKeywords).toEqual(["pumpkin spice"])
    act(() => {
      result.current.resetSeasonalKeywords()
    })
    expect(result.current.seasonalHalloweenKeywords).toEqual([])
    expect(result.current.seasonalChristmasKeywords).toEqual([])
    // Reset syncs empty lists through the canonical PUT (clears the server
    // side too; local removal uses the production safeSetItem path).
    await waitFor(() => {
      const puts = mockedFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT")
      const last = JSON.parse(String((puts[puts.length - 1][1] as RequestInit)?.body))
      expect(last.seasonalHalloweenKeywords).toEqual([])
      expect(last.seasonalChristmasKeywords).toEqual([])
    })
  })
})

describe("server: /api/defaults round-trips bounded keyword arrays", () => {
  it("PUT then GET preserves keywords per namespace; oversized input is rejected", async () => {
    const { PUT, GET } = await freshRoute()
    const put = await PUT(
      mockPutRequest(
        { seasonalHalloweenKeywords: ["Spooky Season"], seasonalChristmasKeywords: ["pumpkin spice", "cozy"] },
        `http://localhost:3000/api/defaults?u=${USER_A}`,
      ) as unknown as NextRequest,
    )
    expect(put.status).toBe(200)
    const get = await GET(
      new Request(`http://localhost:3000/api/defaults?u=${USER_A}`) as unknown as NextRequest,
    )
    expect(get.status).toBe(200)
    const data = await get.json()
    expect(data.seasonalHalloweenKeywords).toEqual(["Spooky Season"])
    expect(data.seasonalChristmasKeywords).toEqual(["pumpkin spice", "cozy"])

    const tooMany = Array.from({ length: 25 }, (_, i) => `kw${i}`)
    const bad = await PUT(
      mockPutRequest({ seasonalHalloweenKeywords: tooMany }, `http://localhost:3000/api/defaults?u=${USER_A}`) as unknown as NextRequest,
    )
    expect(bad.status).toBe(400)
    const badEntry = await PUT(
      mockPutRequest({ seasonalChristmasKeywords: ["x".repeat(41)] }, `http://localhost:3000/api/defaults?u=${USER_A}`) as unknown as NextRequest,
    )
    expect(badEntry.status).toBe(400)
  })
})
