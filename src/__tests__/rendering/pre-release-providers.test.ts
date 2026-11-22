import { describe, expect, it } from "vitest"
import { extractProviderAvailability, isDigitalPreRelease } from "@/lib/pre-release"

const NOW = new Date("2026-07-27T12:00:00Z").getTime()

describe("extractProviderAvailability (TMDB watch/providers, by tmdbId)", () => {
  it("true when the exact region has flatrate/rent/buy/ads/free providers", () => {
    for (const k of ["flatrate", "rent", "buy", "ads", "free"]) {
      const resp = { id: 1, results: { IN: { [k]: [{ provider_id: 8 }] } } }
      expect(extractProviderAvailability(resp, "in")).toBe(true)
    }
  })
  it("null (unknown, never false) when region missing, empty or no response", () => {
    expect(extractProviderAvailability({ id: 1, results: { US: { flatrate: [{}] } } }, "IN")).toBeNull()
    expect(extractProviderAvailability({ id: 1, results: { IN: { link: "x" } } }, "IN")).toBeNull()
    expect(extractProviderAvailability(null, "IN")).toBeNull()
  })
  it("true availability keeps Coming Soon only on a known JW no-offers answer; clears it on providers", () => {
    const base = { mediaType: "movie" as const, theatricalDate: "2026-06-20", digitalDate: null, now: NOW }
    expect(isDigitalPreRelease({ ...base, jwAvailable: null })).toBe(false)
    expect(isDigitalPreRelease({ ...base, jwAvailable: false })).toBe(true)
    expect(isDigitalPreRelease({ ...base, jwAvailable: extractProviderAvailability({ id: 1, results: { IN: { rent: [{}] } } }, "IN") })).toBe(false)
  })
})
