import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getUpcomingReleaseLabel } from "@/lib/release-badge"

describe("getUpcomingReleaseLabel", () => {
  beforeEach(() => {
    // Pin "today" to 2026-07-27 so tests are deterministic
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("movie media type", () => {
    it("returns label for a future release date", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-12-25",
      })
      expect(result).toBe("In uscita 25.12.26")
    })

    it("returns null for a past release date", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2020-01-15",
      })
      expect(result).toBeNull()
    })

    it("returns null for today's date", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-07-27",
      })
      expect(result).toBeNull()
    })

    it("returns null when releaseDate is null", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: null,
      })
      expect(result).toBeNull()
    })

    it("returns null when releaseDate is undefined", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
      })
      expect(result).toBeNull()
    })

    it("returns null when releaseDate is an empty string", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "",
      })
      expect(result).toBeNull()
    })

    it("returns null for an unparseable date string", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "abc",
      })
      expect(result).toBeNull()
    })

    it("returns null for a date string with non-numeric year", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "20xx-01-01",
      })
      expect(result).toBeNull()
    })

    it("uses Italian locale by default", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-08-15",
      })
      expect(result).toBe("In uscita 15.08.26")
    })

    it("formats date in English locale when specified", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-08-15",
        locale: "en",
      })
      // The exact separator depends on the runtime's Intl implementation
      // (some use "/", others "."), so only check the prefix and digit pattern
      expect(result).toMatch(/^In uscita \d{2}[./]\d{2}[./]\d{2}$/)
    })

    it("uses Italian locale when explicitly set", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-09-01",
        locale: "it",
      })
      expect(result).toBe("In uscita 01.09.26")
    })

    it("honors a custom translator (M14: prefix is no longer hardcoded)", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-08-15",
        locale: "en",
        t: (key, params) => key === "badge.upcomingRelease" ? `Coming soon ${params?.date}` : key,
      })
      expect(result).toBe("Coming soon 08.15.26")
    })
  })

  describe("tv / series media type", () => {
    it("returns label for a future firstAirDate (serie annunciata)", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "tv",
        firstAirDate: "2026-12-25",
      })
      expect(result).toBe("In uscita 25.12.26")
    })

    it("ignores releaseDate for tv (usa firstAirDate)", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "tv",
        releaseDate: "2026-12-25",
      })
      expect(result).toBeNull()
    })

    it("returns null when firstAirDate is past", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "tv",
        firstAirDate: "2020-01-15",
      })
      expect(result).toBeNull()
    })

    it("returns null when firstAirDate is missing", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "tv",
      })
      expect(result).toBeNull()
    })
  })

  describe("boundary conditions", () => {
    it("handles end-of-year dates correctly", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-12-31",
      })
      expect(result).toBe("In uscita 31.12.26")
    })

    it("handles a date one day in the future", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-07-28",
      })
      expect(result).toBe("In uscita 28.07.26")
    })

    it("handles a date one day in the past", () => {
      const result = getUpcomingReleaseLabel({
        mediaType: "movie",
        releaseDate: "2026-07-26",
      })
      expect(result).toBeNull()
    })
  })
})
