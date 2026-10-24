import { describe, expect, it } from "vitest"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { validatePosterQuery } from "@/lib/validation"
import { getServerDefaults, type ServerDefaults } from "@/lib/server-defaults"

describe("rank cache-busting (rk parameter)", () => {
  const origin = "https://example.com"
  const defaults: ServerDefaults = getServerDefaults()

  describe("URL identity and determinism", () => {
    it("produces identical URL when title and rank are unchanged", () => {
      const url1 = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 6,
      }).toString()

      const url2 = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 6,
      }).toString()

      expect(url1).toBe(url2)
      expect(url1).toContain("rk=6")
    })

    it("produces distinct URLs when rank changes (#6 -> #7)", () => {
      const urlRank6 = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 6,
      }).toString()

      const urlRank7 = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 7,
      }).toString()

      expect(urlRank6).not.toBe(urlRank7)
      expect(urlRank6).toContain("rk=6")
      expect(urlRank7).toContain("rk=7")
    })

    it("handles transition between unranked, ranked, and dropped from ranking", () => {
      // 1. Unranked outside ranking catalog (no rk)
      const urlLegacy = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
      }).toString()
      expect(urlLegacy).not.toContain("rk=")

      // 2. Enters ranking at #6 (rk=6)
      const urlRanked = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 6,
      }).toString()
      expect(urlRanked).toContain("rk=6")
      expect(urlRanked).not.toBe(urlLegacy)

      // 3. Drops from ranking (rk=0)
      const urlDropped = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        rankBuster: 0,
      }).toString()
      expect(urlDropped).toContain("rk=0")
      // Dropped URL is distinct from both the ranked URL and the legacy unranked URL
      expect(urlDropped).not.toBe(urlRanked)
      expect(urlDropped).not.toBe(urlLegacy)
    })

    it("does not change URL for unaffected posters without rankBuster", () => {
      const url1 = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 99999,
        defaults,
      }).toString()

      expect(url1).not.toContain("rk=")
    })

    it("does not use time-based or random tokens", () => {
      const params1 = buildStremioPosterSearchParams({ rankBuster: 3 })
      const params2 = buildStremioPosterSearchParams({ rankBuster: 3 })
      expect(params1.get("rk")).toBe("3")
      expect(params2.get("rk")).toBe("3")
    })
  })

  describe("ranking disabled guard", () => {
    it("omits rk when rankingBadges is false", () => {
      const url = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults: { ...defaults, rankingBadges: false },
        rankBuster: 6,
      }).toString()

      expect(url).not.toContain("rk=")
    })

    it("omits rk when globalBadges is false", () => {
      const url = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults: { ...defaults, globalBadges: false },
        rankBuster: 6,
      }).toString()

      expect(url).not.toContain("rk=")
    })

    it("omits rk in followSpace mode", () => {
      const params = buildStremioPosterSearchParams({
        followSpace: true,
        user: "11111111-1111-4111-8111-111111111111",
        rankBuster: 6,
      })

      expect(params.has("rk")).toBe(false)
      expect(params.get("live")).toBe("1")
    })
  })

  describe("server cache normalization and validation", () => {
    it("keeps valid rk in normalized cache params (decision A: same title rank N vs M = different keys/bytes)", () => {
      const incoming = new URLSearchParams("rk=6&shape=poster&lang=it&rv=1.23.0")
      const normalized = normalizePosterCacheParams(incoming)

      expect(normalized.get("rk")).toBe("6")
      expect(normalized.has("rv")).toBe(false)
      expect(normalized.get("lang")).toBe("it")
    })

    it("strips invalid rk onto absent (no poisoning, legacy inert)", () => {
      for (const raw of ["abc", "-1", "101", "1.5", ""]) {
        const normalized = normalizePosterCacheParams(new URLSearchParams(`rk=${raw}`))
        expect(normalized.has("rk")).toBe(false)
      }
    })

    it("accepts rk in posterQuery validation", () => {
      expect(validatePosterQuery(new URLSearchParams("rk=6"))).toBeNull()
      expect(validatePosterQuery(new URLSearchParams("rk=0"))).toBeNull()
      expect(validatePosterQuery(new URLSearchParams("rk=verylongstringthatislongerthan16chars"))).toContain("rk")
    })

    it("coexists with mv, dv, live without interference", () => {
      const url = buildStremioPosterUrl({
        origin,
        type: "movie",
        id: 12345,
        defaults,
        mapping: {
          tmdbId: 12345,
          mediaType: "movie",
          title: "Test",
          posterPath: "/test.jpg",
          logoPath: null,
          originalPosterPath: null,
          language: null,
          updatedAt: "2026-10-14T12:00:00.000Z",
        },
        rankBuster: 4,
      }).toString()

      expect(url).toContain("rk=4")
      expect(url).toContain("mv=")
      expect(url).toContain("rv=")
      expect(url).toContain("dv=")
    })
  })
})
