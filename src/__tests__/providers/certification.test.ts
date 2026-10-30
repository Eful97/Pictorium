import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CERTIFICATION_RELEASE_TYPE_PRECEDENCE,
  normalizeCertificationCountry,
  resolveAgeCertification,
  resolveMovieCertification,
  resolveTvCertification,
  sanitizeAgeLabel,
} from "@/lib/certification"
import { __clearTMDBCache, __resetKey401Cache, getContentRatings } from "@/lib/tmdb"

function movieResp(
  results: { iso_3166_1: string; release_dates: { certification?: string; release_date: string; type: number }[] }[],
) {
  return { id: 1, results }
}

function tvResp(results: { iso_3166_1: string; rating?: string | null }[]) {
  return { id: 2, results }
}

describe("normalizeCertificationCountry", () => {
  it("uppercases valid ISO alpha-2", () => {
    expect(normalizeCertificationCountry("it")).toBe("IT")
    expect(normalizeCertificationCountry(" US ")).toBe("US")
  })

  it("rejects missing/blank/invalid/GLOBAL", () => {
    expect(normalizeCertificationCountry(null)).toBeNull()
    expect(normalizeCertificationCountry(undefined)).toBeNull()
    expect(normalizeCertificationCountry("")).toBeNull()
    expect(normalizeCertificationCountry("   ")).toBeNull()
    expect(normalizeCertificationCountry("USA")).toBeNull()
    expect(normalizeCertificationCountry("1T")).toBeNull()
    expect(normalizeCertificationCountry("GLOBAL")).toBeNull()
    expect(normalizeCertificationCountry("global")).toBeNull()
    expect(normalizeCertificationCountry(42)).toBeNull()
  })
})

describe("resolveMovieCertification", () => {
  it("prefers theatrical over a newer digital (no newest-wins override)", () => {
    const resp = movieResp([
      {
        iso_3166_1: "IT",
        release_dates: [
          { certification: "T", release_date: "2024-06-01T00:00:00.000Z", type: 4 },
          { certification: "VM14", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
        ],
      },
    ])
    expect(resolveMovieCertification(resp, "IT")).toBe("VM14")
  })

  it("follows explicit type precedence 3 > 2 > 1 > 4 > 5 > 6", () => {
    expect(CERTIFICATION_RELEASE_TYPE_PRECEDENCE).toEqual([3, 2, 1, 4, 5, 6])
    const resp = movieResp([
      {
        iso_3166_1: "US",
        release_dates: [
          { certification: "TV", release_date: "2020-01-01T00:00:00.000Z", type: 6 },
          { certification: "PHYS", release_date: "2020-01-01T00:00:00.000Z", type: 5 },
          { certification: "DIG", release_date: "2020-01-01T00:00:00.000Z", type: 4 },
          { certification: "PREM", release_date: "2020-01-01T00:00:00.000Z", type: 1 },
          { certification: "LIM", release_date: "2020-01-01T00:00:00.000Z", type: 2 },
          { certification: "PG-13", release_date: "2020-01-01T00:00:00.000Z", type: 3 },
        ],
      },
    ])
    expect(resolveMovieCertification(resp, "US")).toBe("PG-13")
  })

  it("picks the earliest date within the same type", () => {
    const resp = movieResp([
      {
        iso_3166_1: "CH",
        release_dates: [
          { certification: "18", release_date: "1999-11-10T00:00:00.000Z", type: 3 },
          { certification: "16", release_date: "1999-11-04T00:00:00.000Z", type: 3 },
        ],
      },
    ])
    expect(resolveMovieCertification(resp, "CH")).toBe("16")
  })

  it("ignores blank certifications and trims the label without conversion", () => {
    const resp = movieResp([
      {
        iso_3166_1: "IT",
        release_dates: [
          { certification: "   ", release_date: "2024-01-01T00:00:00.000Z", type: 3 },
          { certification: " VM14 ", release_date: "2024-02-01T00:00:00.000Z", type: 3 },
        ],
      },
    ])
    expect(resolveMovieCertification(resp, "IT")).toBe("VM14")
  })

  it("has no US/other-country fallback", () => {
    const resp = movieResp([
      { iso_3166_1: "US", release_dates: [{ certification: "R", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] },
    ])
    expect(resolveMovieCertification(resp, "IT")).toBeNull()
  })

  it("returns null on missing/empty payload or invalid country", () => {
    expect(resolveMovieCertification(null, "IT")).toBeNull()
    expect(resolveMovieCertification(undefined, "IT")).toBeNull()
    expect(resolveMovieCertification({ id: 1, results: [] }, "IT")).toBeNull()
    expect(resolveMovieCertification(movieResp([{ iso_3166_1: "IT", release_dates: [] }]), "IT")).toBeNull()
    expect(resolveMovieCertification(movieResp([{ iso_3166_1: "IT", release_dates: [{ certification: "", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] }]), "IT")).toBeNull()
    expect(resolveMovieCertification(movieResp([{ iso_3166_1: "IT", release_dates: [{ certification: "VM14", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] }]), "")).toBeNull()
    expect(resolveMovieCertification(movieResp([{ iso_3166_1: "IT", release_dates: [{ certification: "VM14", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] }]), "GLOBAL")).toBeNull()
    expect(resolveMovieCertification(movieResp([{ iso_3166_1: "IT", release_dates: [{ certification: "VM14", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] }]), "USA")).toBeNull()
  })
})

describe("resolveTvCertification", () => {
  it("returns the exact-country rating untouched", () => {
    const resp = tvResp([
      { iso_3166_1: "US", rating: "TV-MA" },
      { iso_3166_1: "IT", rating: "VM14" },
    ])
    expect(resolveTvCertification(resp, "IT")).toBe("VM14")
    expect(resolveTvCertification(resp, "it")).toBe("VM14")
    expect(resolveTvCertification(resp, "US")).toBe("TV-MA")
  })

  it("has no fallback to other countries", () => {
    const resp = tvResp([{ iso_3166_1: "US", rating: "TV-MA" }])
    expect(resolveTvCertification(resp, "IT")).toBeNull()
  })

  it("ignores blank ratings and trims without conversion", () => {
    const resp = tvResp([
      { iso_3166_1: "IT", rating: "   " },
      { iso_3166_1: "FR", rating: " 16 " },
    ])
    expect(resolveTvCertification(resp, "IT")).toBeNull()
    expect(resolveTvCertification(resp, "FR")).toBe("16")
  })

  it("returns null on missing/empty payload or invalid country", () => {
    expect(resolveTvCertification(null, "IT")).toBeNull()
    expect(resolveTvCertification(undefined, "IT")).toBeNull()
    expect(resolveTvCertification({ id: 2, results: [] }, "IT")).toBeNull()
    expect(resolveTvCertification(tvResp([{ iso_3166_1: "IT", rating: null }]), "IT")).toBeNull()
    expect(resolveTvCertification(tvResp([{ iso_3166_1: "IT", rating: "VM14" }]), "")).toBeNull()
    expect(resolveTvCertification(tvResp([{ iso_3166_1: "IT", rating: "VM14" }]), "GLOBAL")).toBeNull()
  })
})

describe("real-world label matrix (Kometa-7 + IT)", () => {
  const movieCases: { country: string; label: string }[] = [
    { country: "IT", label: "VM14" },
    { country: "US", label: "PG-13" },
    { country: "US", label: "TV-MA" },
    { country: "DE", label: "FSK 16" },
    { country: "GB", label: "U" },
    { country: "GB", label: "12" },
    { country: "AU", label: "R18+" },
  ]

  it.each(movieCases)("movie $country label '$label' resolves verbatim and sanitizes unchanged", ({ country, label }) => {
    const resp = movieResp([
      {
        iso_3166_1: country,
        release_dates: [{ certification: label, release_date: "2024-01-01T00:00:00.000Z", type: 3 }],
      },
    ])
    expect(resolveMovieCertification(resp, country)).toBe(label)
    expect(sanitizeAgeLabel(label)).toBe(label)
  })

  const tvCases: { country: string; label: string }[] = [
    { country: "IT", label: "VM14" },
    { country: "US", label: "PG-13" },
    { country: "US", label: "TV-MA" },
    { country: "DE", label: "FSK 16" },
    { country: "GB", label: "U" },
    { country: "GB", label: "12" },
    { country: "AU", label: "R18+" },
  ]

  it.each(tvCases)("tv $country label '$label' resolves verbatim and sanitizes unchanged", ({ country, label }) => {
    const resp = tvResp([{ iso_3166_1: country, rating: label }])
    expect(resolveTvCertification(resp, country)).toBe(label)
    expect(sanitizeAgeLabel(label)).toBe(label)
  })

  it("trims surrounding whitespace but performs no conversion", () => {
    const resp = movieResp([
      {
        iso_3166_1: "DE",
        release_dates: [{ certification: " FSK 16 ", release_date: "2024-01-01T00:00:00.000Z", type: 3 }],
      },
    ])
    expect(resolveMovieCertification(resp, "DE")).toBe("FSK 16")
    expect(sanitizeAgeLabel("  PG-13  ")).toBe("PG-13")
  })

  it("has no cross-country fallback for matrix labels", () => {
    const resp = movieResp([
      {
        iso_3166_1: "US",
        release_dates: [{ certification: "PG-13", release_date: "2024-01-01T00:00:00.000Z", type: 3 }],
      },
    ])
    expect(resolveMovieCertification(resp, "IT")).toBeNull()
    expect(resolveTvCertification(tvResp([{ iso_3166_1: "US", rating: "TV-MA" }]), "DE")).toBeNull()
  })

  it("known-limit: labels over 12 chars or with exotic charset hide (null)", () => {
    // Documented known-limit, not a failure: the dynamic pill hides rather
    // than truncating/converting an unrenderable label.
    expect(sanitizeAgeLabel("Freigegeben ab 18")).toBeNull()
    expect(sanitizeAgeLabel("PG-13!")).toBeNull()
  })
})

describe("resolveAgeCertification", () => {
  it("dispatches movie to release_dates and tv to content_ratings", () => {
    const releaseDates = movieResp([
      { iso_3166_1: "IT", release_dates: [{ certification: "VM14", release_date: "2024-01-01T00:00:00.000Z", type: 3 }] },
    ])
    const contentRatings = tvResp([{ iso_3166_1: "IT", rating: "TV-14" }])
    expect(resolveAgeCertification("movie", "IT", { releaseDates, contentRatings })).toBe("VM14")
    expect(resolveAgeCertification("tv", "IT", { releaseDates, contentRatings })).toBe("TV-14")
    expect(resolveAgeCertification("movie", "IT", { contentRatings })).toBeNull()
    expect(resolveAgeCertification("tv", "IT", { releaseDates })).toBeNull()
    expect(resolveAgeCertification("movie", "IT", null)).toBeNull()
  })
})

describe("getContentRatings (shared tmdbFetch layer)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  it("fetches /tv/{id}/content_ratings and parses the TMDB body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: 1399, results: [{ iso_3166_1: "US", rating: "TV-MA", descriptors: [] }] }),
    )
    const data = await getContentRatings(1399, "test-key")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/tv/1399/content_ratings")
    expect(String(fetchSpy.mock.calls[0][0])).toContain("api_key=test-key")
    expect(data.results[0].rating).toBe("TV-MA")
  })

  it("shares the neutral cache key across api keys (no key in cache)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: 1400, results: [{ iso_3166_1: "IT", rating: "VM14" }] }),
    )
    await getContentRatings(1400, "key-one")
    await getContentRatings(1400, "key-two")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("propagates upstream errors and aborts on cancellation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(getContentRatings(1401, "k", undefined, 5000)).rejects.toThrow("TMDB fetch failed: 500")

    vi.restoreAllMocks()
    __clearTMDBCache()
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(getContentRatings(1402, "k", ctrl.signal, 5000)).rejects.toThrow()
  })

  it("requires an api key like the other tmdb helpers", async () => {
    await expect(getContentRatings(1403, undefined)).rejects.toThrow("TMDB API key is missing")
  })
})
