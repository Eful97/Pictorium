import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { PUT } from "@/app/api/mappings/[id]/route"
import { getById, upsert } from "@/lib/store"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import type { Mapping } from "@/lib/types"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  checkAdminToken: vi.fn(() => true),
  requireAdminToken: vi.fn(() => null),
  isSameOrigin: vi.fn(() => true),
  adminAuthResponse: vi.fn(() => new Response("unauthorized", { status: 401 })),
  originMismatchResponse: vi.fn(() => new Response("forbidden", { status: 403 })),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test-key"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
}))

vi.mock("@/lib/cache", () => ({
  cacheInvalidate: vi.fn(),
  cacheInvalidatePosterData: vi.fn(),
  cacheInvalidatePosterDataFor: vi.fn(),
  cacheInvalidatePosterDataForUser: vi.fn(),
}))

vi.mock("@/lib/catalog-epoch", () => ({
  bumpCatalogEpoch: vi.fn(),
}))

const BASE = "http://localhost:3000/api/mappings/movie:550"

function putRequest(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function existingMapping(): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath: null,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    customPosterUrl: null,
  }
}

const params = { params: Promise.resolve({ id: "movie:550" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getById).mockResolvedValue(existingMapping())
  vi.mocked(upsert).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PUT /api/mappings/[id] customPosterUrl", () => {
  it("salva l'URL custom e bumpa updatedAt (mv invalida cache e URL Stremio)", async () => {
    const res = await PUT(putRequest({ customPosterUrl: "https://i.imgur.com/x.jpg" }), params)
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.customPosterUrl).toBe("https://i.imgur.com/x.jpg")
    expect(saved.posterPath).toBe("/abc.jpg")
    expect(saved.updatedAt).not.toBe("2026-01-01T00:00:00.000Z")
    // mv cambia → la chiave cache `:mu` e il param `mv` non collidono col vecchio
    expect(mappingVersionParam(saved)).not.toBe(mappingVersionParam(existingMapping()))
    expect(Number(mappingVersionParam(saved))).toBeGreaterThan(Number(mappingVersionParam(existingMapping())))
  })

  it("preserva l'URL custom esistente quando il body non lo tocca", async () => {
    vi.mocked(getById).mockResolvedValue({ ...existingMapping(), customPosterUrl: "https://i.imgur.com/old.jpg" })
    const res = await PUT(putRequest({ genreName: "Drama" }), params)
    expect(res.status).toBe(200)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.customPosterUrl).toBe("https://i.imgur.com/old.jpg")
    expect(saved.genreName).toBe("Drama")
  })

  it("rimuove l'URL custom con null esplicito", async () => {
    vi.mocked(getById).mockResolvedValue({ ...existingMapping(), customPosterUrl: "https://i.imgur.com/old.jpg" })
    const res = await PUT(putRequest({ customPosterUrl: null }), params)
    expect(res.status).toBe(200)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.customPosterUrl).toBeNull()
  })

  it("rifiuta scheme non-HTTP senza toccare lo store", async () => {
    const res = await PUT(putRequest({ customPosterUrl: "ftp://evil.com/x.jpg" }), params)
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("il mapping importato con customPosterUrl passa lo schema (import/export round-trip)", async () => {
    const { mappingSchema } = await import("@/lib/validation")
    const parsed = mappingSchema.safeParse({ ...existingMapping(), customPosterUrl: "https://i.imgur.com/x.jpg" })
    expect(parsed.success).toBe(true)
  })
})
