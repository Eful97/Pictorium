/**
 * POST /api/mappings full-replacement proof for the cover-only save: the
 * route never reads the existing mapping (no merge), so a minimal
 * cover-identity body clears previously frozen custom styling. PUT is the
 * merge path and must NOT be used for this (see mapping-null-put tests).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/mappings/route"
import { getById, upsert } from "@/lib/store"
import type { Mapping } from "@/lib/types"

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(),
  getById: vi.fn(),
  upsert: vi.fn(),
  removeAll: vi.fn(),
  QuotaExceededError: class QuotaExceededError extends Error {},
}))

vi.mock("@/lib/auth", () => ({
  checkAdminToken: vi.fn(() => true),
  requireAdminToken: vi.fn(() => false),
  isSameOrigin: vi.fn(() => true),
  adminAuthResponse: vi.fn(() => new Response("unauthorized", { status: 401 })),
  originMismatchResponse: vi.fn(() => new Response("forbidden", { status: 403 })),
}))

vi.mock("@/lib/user-auth", () => ({
  checkUserAuth: vi.fn(async () => true),
  getScopedUserId: vi.fn(() => null),
  extractUserParam: vi.fn(() => null),
  invalidUserResponse: vi.fn(() => new Response("bad user", { status: 400 })),
  isMultiUserEnabled: vi.fn(() => false),
  userAuthResponse: vi.fn(() => new Response("unauthorized", { status: 401 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
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

const BASE = "http://localhost:3000/api/mappings"

function postRequest(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Minimal cover-only body (as built by buildCoverOnlyPayload). */
function coverOnlyBody(): Record<string, unknown> {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/clean.jpg",
    customPosterUrl: null,
    originalPosterPath: "/fc.jpg",
    language: null,
    logoPath: null,
    imdbId: "tt0137523",
    wikidataId: "Q190304",
    genreName: "Dramma",
    voteAverage: 7.5,
    releaseDate: "2024-03-01",
    firstAirDate: null,
    tvType: null,
    tvStatus: null,
    episodeGroupId: "ep42",
    posterShape: "poster",
    backdropPath: "/bd.jpg",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Skip the post-save warmup self-fetch: it would hit the network.
  vi.stubEnv("VERCEL", "1")
  vi.mocked(upsert).mockResolvedValue(undefined)
})

describe("POST /api/mappings cover-only full replacement", () => {
  it("persists the minimal body verbatim without reading/merging the existing mapping", async () => {
    const res = await POST(postRequest(coverOnlyBody()))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    // Full-replace proof: the route never reads the stored mapping, so no
    // previously frozen styling can survive through a merge.
    expect(getById).not.toHaveBeenCalled()
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.tmdbId).toBe(550)
    expect(saved.posterPath).toBe("/clean.jpg")
    expect(saved.backdropPath).toBe("/bd.jpg")
    expect(saved.imdbId).toBe("tt0137523")
    expect(saved.episodeGroupId).toBe("ep42")
    // Route-level null normalization for the allowlisted logo identity
    // (explicit nulls, not frozen values).
    expect(saved.logoPath).toBeNull()
    // Title metadata identity persists verbatim (mapped branch renders ONLY
    // from it — without it Genre/Rating blanks on Test URL/Stremio).
    expect(saved.genreName).toBe("Dramma")
    expect(saved.voteAverage).toBe(7.5)
    expect(saved.releaseDate).toBe("2024-03-01")
    // Route-normalized snapshot keys arrive nullish (null or present-as-
    // undefined), never frozen: they resolve through the ?? chains as absent.
    // (genreName/voteAverage/releaseDate persist above as title identity.)
    for (const k of [
      "trendRank", "trendPeriod", "tvType", "tvStatus",
      "accentColor", "badgeExtra", "badgeRank", "badgeLabel", "animeRank",
      "customBadge", "firstAirDate",
      "logoDisabled", "networkLogoPath", "networkLogoName",
    ] as const) {
      expect(saved[k] ?? null).toBeNull()
    }
    // Styling keys are never added by the route: full replacement clears them.
    for (const k of [
      "badgeStyle", "rankingBadgeStyle", "extraBadgeStyle", "badgeFont", "qualityBadgeStyle",
      "showBadges", "rankingBadges", "badgeGenre", "badgeYear", "badgeRating",
      "customRatings", "ratingSources", "separateRatings", "separateRatingsStyle",
      "separateBadgeScale",
      "gradientHeight", "blurEnabled", "blurIntensity", "blurFade", "blurDarkness",
      "tintStrength", "topShade",
      "logoScale", "logoOffsetX", "logoOffsetY",
      "topBadgeScale", "genreBadgeScale", "qualityBadgeScale", "networkLogoScale",
      "networkLogo", "networkLogoPosition",
      "landscape", "cleanPosters", "autoRotateClean",
      "defaultBadgeStyle", "defaultRankingBadgeStyle",
    ]) {
      expect(saved, k).not.toHaveProperty(k)
    }
  })

  it("persists the chosen logo identity without freezing logo transforms", async () => {
    const withLogo = {
      ...coverOnlyBody(),
      logoPath: "/logo.png",
      language: "en",
    }
    const res = await POST(postRequest(withLogo))
    expect(res.status).toBe(200)
    const saved = vi.mocked(upsert).mock.calls[0][0] as Mapping
    expect(saved.logoPath).toBe("/logo.png")
    expect(saved.logoScale).toBeUndefined()
    expect(saved.logoOffsetX).toBeUndefined()
    expect(saved.logoOffsetY).toBeUndefined()
    expect(saved, "logoScale").not.toHaveProperty("logoScale")

    const disabled = { ...coverOnlyBody(), logoPath: null, logoDisabled: true }
    const res2 = await POST(postRequest(disabled))
    expect(res2.status).toBe(200)
    const saved2 = vi.mocked(upsert).mock.calls[1][0] as Mapping
    expect(saved2.logoDisabled).toBe(true)
    expect(saved2.logoPath).toBeNull()
  })

  it("second POST (cover-only after full save) carries no frozen styling", async () => {
    const full = {
      ...coverOnlyBody(),
      logoPath: "/logo.png",
      logoDisabled: undefined,
      badgeStyle: "pill",
      rankingBadgeStyle: "colored",
      logoScale: 80,
      gradientHeight: 80,
      accentColor: "#ff0000",
      showBadges: false,
      trendRank: 3,
      cleanPosters: ["/a.jpg", "/b.jpg"],
      autoRotateClean: true,
      landscape: { gradientHeight: 60 },
    }
    const r1 = await POST(postRequest(full))
    expect(r1.status).toBe(200)
    const r2 = await POST(postRequest(coverOnlyBody()))
    expect(r2.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(2)
    const second = vi.mocked(upsert).mock.calls[1][0] as Mapping
    // Previously frozen logo choice is cleared back to null (route norm).
    expect(second.logoPath).toBeNull()
    for (const k of [
      "badgeStyle", "rankingBadgeStyle", "logoScale", "logoOffsetX", "gradientHeight",
      "showBadges", "cleanPosters", "autoRotateClean", "landscape",
    ]) {
      expect(second, k).not.toHaveProperty(k)
    }
    // Snapshot keys come back nullish, never frozen.
    expect(second.accentColor ?? null).toBeNull()
    expect(second.trendRank ?? null).toBeNull()
  })
})
