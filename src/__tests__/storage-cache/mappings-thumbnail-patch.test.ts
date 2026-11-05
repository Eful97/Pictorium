import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { PATCH } from "@/app/api/mappings/[id]/route"
import { getById, remove, upsert } from "@/lib/store"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { cacheInvalidate, cacheInvalidatePosterDataFor } from "@/lib/cache"
import type { Mapping } from "@/lib/types"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
  remove: vi.fn(),
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

const BASE = "http://localhost:3000/api/mappings/tv:999"
const params = { params: Promise.resolve({ id: "tv:999" }) }

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * A fully saved poster mapping: every poster-facing field is populated so the
 * test can prove a thumbnail write preserves them byte-for-byte.
 */
function existingMapping(): Mapping {
  return {
    tmdbId: 999,
    mediaType: "tv",
    title: "Serie",
    posterPath: "/poster.jpg",
    customPosterUrl: null,
    logoPath: "/logo.png",
    originalPosterPath: "/poster.jpg",
    language: "it",
    backdropPath: "/backdrop.jpg",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cleanPosters: ["/clean-a.jpg", "/clean-b.jpg"],
    cleanPosterIndex: 1,
    cleanPosterUpdatedAt: "2025-12-31T12:00:00.000Z",
    episodeGroupId: "standard",
    badgeStyle: "colored",
    genreBadgeScale: 140,
    episodeThumbnailStills: { "1:1": "/still-one.jpg" },
    thumbnailRotation: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getById).mockResolvedValue(existingMapping())
  vi.mocked(remove).mockResolvedValue(undefined)
  vi.mocked(upsert).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PATCH /api/mappings/[id] thumbnail-only write", () => {
  it("writes only thumbnail keys and preserves every poster field INCLUDING updatedAt", async () => {
    const before = existingMapping()
    const res = await PATCH(patchRequest({
      episodeThumbnailStills: { "1:2": "/still-two.jpg" },
      thumbnailRotation: true,
    }), params)

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [saved, scoped, options] = vi.mocked(upsert).mock.calls[0]
    expect(scoped).toBeNull()
    expect(options).toEqual({ keepUpdatedAt: true })

    // The full record is copied verbatim; only the two thumbnail keys move.
    expect(saved).toEqual({
      ...before,
      episodeThumbnailStills: { "1:2": "/still-two.jpg" },
      thumbnailRotation: true,
    })
    // `mv` derives from updatedAt: unchanged means the poster URL is unchanged.
    expect(mappingVersionParam(saved as Mapping)).toBe(mappingVersionParam(before))
    expect((saved as Mapping).updatedAt).toBe(before.updatedAt)
    // Poster identity/rotation state untouched.
    expect((saved as Mapping).posterPath).toBe("/poster.jpg")
    expect((saved as Mapping).cleanPosterIndex).toBe(1)
    expect((saved as Mapping).cleanPosterUpdatedAt).toBe("2025-12-31T12:00:00.000Z")

    // Meta/catalog freshness is granted by the epoch; poster data is NOT
    // invalidated (poster bytes/caches stay warm and identical).
    expect(bumpCatalogEpoch).toHaveBeenCalledWith(null)
    expect(cacheInvalidate).toHaveBeenCalledWith("stremio")
    expect(cacheInvalidatePosterDataFor).not.toHaveBeenCalled()
  })

  it("rejects any non-thumbnail key (no poster back door)", async () => {
    for (const body of [
      { posterPath: "/evil.jpg" },
      { thumbnailRotation: true, posterPath: "/evil.jpg" },
      { title: "Renamed" },
    ]) {
      const res = await PATCH(patchRequest(body), params)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(upsert).not.toHaveBeenCalled()
  })

  it("clears thumbnailRotation with an explicit null (back to inherited)", async () => {
    const res = await PATCH(patchRequest({ thumbnailRotation: null }), params)
    expect(res.status).toBe(200)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect("thumbnailRotation" in saved).toBe(false)
    expect(saved.episodeThumbnailStills).toEqual({ "1:1": "/still-one.jpg" })
    expect(mappingVersionParam(saved)).toBe(mappingVersionParam(existingMapping()))
  })

  it("clears the still overrides with an explicit empty map (restore/reset-all)", async () => {
    const res = await PATCH(patchRequest({ episodeThumbnailStills: {} }), params)
    expect(res.status).toBe(200)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect("episodeThumbnailStills" in saved).toBe(false)
    expect(saved.thumbnailRotation).toBe(false)
    expect(mappingVersionParam(saved)).toBe(mappingVersionParam(existingMapping()))
  })

  it("rejects invalid still overrides without touching the store", async () => {
    for (const value of [{ "1:1": "/bad still.jpg" }, { "not-an-episode": "/a.jpg" }, ["x"]]) {
      const res = await PATCH(patchRequest({ episodeThumbnailStills: value }), params)
      expect(res.status, JSON.stringify(value)).toBe(400)
    }
    expect(upsert).not.toHaveBeenCalled()
  })

  it("404 when the title has no mapping yet (caller falls back to the full save)", async () => {
    vi.mocked(getById).mockResolvedValue(null)
    const res = await PATCH(patchRequest({ thumbnailRotation: true }), params)
    expect(res.status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
    expect(bumpCatalogEpoch).not.toHaveBeenCalled()
  })

  it("requires at least one thumbnail key", async () => {
    const res = await PATCH(patchRequest({}), params)
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("removes the mapping only when it never held poster data", async () => {
    // Synthetic record: identity + thumbnail keys only (a full save always
    // writes posterPath/clean lists, so real poster mappings keep their record).
    vi.mocked(getById).mockResolvedValue({
      tmdbId: 999,
      mediaType: "tv",
      title: "Serie",
      updatedAt: "2026-01-01T00:00:00.000Z",
      episodeThumbnailStills: { "1:1": "/still-one.jpg" },
    } as unknown as Mapping)
    const res = await PATCH(patchRequest({ episodeThumbnailStills: null, thumbnailRotation: null }), params)
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith("tv", 999, null)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("keeps a mapping that still has a saved poster (strips thumbnail keys only)", async () => {
    const res = await PATCH(patchRequest({ episodeThumbnailStills: null, thumbnailRotation: null }), params)
    expect(res.status).toBe(200)
    expect(remove).not.toHaveBeenCalled()
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.posterPath).toBe("/poster.jpg")
    expect("episodeThumbnailStills" in saved).toBe(false)
    expect("thumbnailRotation" in saved).toBe(false)
  })
})
