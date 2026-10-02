import { afterEach, describe, expect, it, vi } from "vitest"
import { getTMDBSessionCache, invalidateTMDBSessionCache, setTMDBSessionCache, __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import type { TMDBDetails, TMDBImagesResponse } from "@/lib/tmdb"

const DETAILS = { id: 42, title: "Test", genres: [], vote_average: 7.0, vote_count: 100 } as unknown as TMDBDetails
const IMAGES = { id: 42, backdrops: [], posters: [], logos: [] } as unknown as TMDBImagesResponse

describe("TMDB session cache (F6, language-isolated)", () => {
  afterEach(() => {
    vi.useRealTimers()
    __resetTMDBSessionCache()
  })

  it("stores and returns the entry for the same type:id:lang", () => {
    __resetTMDBSessionCache()
    expect(getTMDBSessionCache("movie", 42, "it")).toBeNull()

    setTMDBSessionCache("movie", 42, "it", { details: DETAILS, images: IMAGES })
    const entry = getTMDBSessionCache("movie", 42, "it")
    expect(entry?.details).toEqual(DETAILS)
    expect(entry?.images).toEqual(IMAGES)
    expect(getTMDBSessionCache("movie", 42, "it")).toEqual(entry)
  })

  it("isolates languages: a hit in A never serves B", () => {
    __resetTMDBSessionCache()
    setTMDBSessionCache("movie", 42, "it", { details: DETAILS, images: IMAGES })
    expect(getTMDBSessionCache("movie", 42, "fr")).toBeNull()

    setTMDBSessionCache("movie", 42, "fr", { details: { ...DETAILS, title: "Autre" } as never })
    expect(getTMDBSessionCache("movie", 42, "it")?.details).toEqual(DETAILS)
    expect(getTMDBSessionCache("movie", 42, "fr")?.details).toEqual({ ...DETAILS, title: "Autre" })
    // Repeated same-language reads keep hitting.
    expect(getTMDBSessionCache("movie", 42, "fr")?.details).toEqual({ ...DETAILS, title: "Autre" })
  })

  it("keys by type:id:lang so different titles and types do not collide", () => {
    __resetTMDBSessionCache()
    setTMDBSessionCache("movie", 42, "it", { details: DETAILS })
    expect(getTMDBSessionCache("movie", 43, "it")).toBeNull()
    expect(getTMDBSessionCache("tv", 42, "it")).toBeNull()
    expect(getTMDBSessionCache("movie", 42, "fr")).toBeNull()
  })

  it("invalidates every language variant of a title, nothing else", () => {
    __resetTMDBSessionCache()
    setTMDBSessionCache("movie", 42, "it", { details: DETAILS })
    setTMDBSessionCache("movie", 42, "fr", { details: DETAILS })
    setTMDBSessionCache("movie", 43, "it", { details: DETAILS })
    invalidateTMDBSessionCache("movie", 42)
    expect(getTMDBSessionCache("movie", 42, "it")).toBeNull()
    expect(getTMDBSessionCache("movie", 42, "fr")).toBeNull()
    expect(getTMDBSessionCache("movie", 43, "it")?.details).toEqual(DETAILS)
  })

  it("clears every language variant on global reset", () => {
    __resetTMDBSessionCache()
    setTMDBSessionCache("movie", 42, "it", { details: DETAILS })
    setTMDBSessionCache("movie", 42, "fr", { details: DETAILS })
    expect(getTMDBSessionCache("movie", 42, "it")?.details).toEqual(DETAILS)
    expect(getTMDBSessionCache("movie", 42, "fr")?.details).toEqual(DETAILS)
    __resetTMDBSessionCache()
    expect(getTMDBSessionCache("movie", 42, "it")).toBeNull()
    expect(getTMDBSessionCache("movie", 42, "fr")).toBeNull()
  })

  it("expires entries after the TTL and slides on access", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    __resetTMDBSessionCache()
    setTMDBSessionCache("movie", 42, "it", { details: DETAILS })
    // Sliding access at 9min keeps the entry alive past the original deadline.
    vi.setSystemTime(9 * 60 * 1000)
    expect(getTMDBSessionCache("movie", 42, "it")?.details).toEqual(DETAILS)
    vi.setSystemTime(9 * 60 * 1000 + 10 * 60 * 1000 + 1)
    expect(getTMDBSessionCache("movie", 42, "it")).toBeNull()
    // Without access the TTL applies from the write.
    vi.setSystemTime(0)
    setTMDBSessionCache("movie", 43, "it", { details: DETAILS })
    vi.setSystemTime(10 * 60 * 1000 + 1)
    expect(getTMDBSessionCache("movie", 43, "it")).toBeNull()
  })

  it("evicts the least-recently-used entry past the limit", () => {
    __resetTMDBSessionCache()
    for (let id = 1; id <= 50; id++) {
      setTMDBSessionCache("movie", id, "it", { details: DETAILS })
    }
    // Promote id 1 to MRU so id 2 becomes the eviction victim.
    expect(getTMDBSessionCache("movie", 1, "it")?.details).toEqual(DETAILS)
    setTMDBSessionCache("movie", 51, "it", { details: DETAILS })
    expect(getTMDBSessionCache("movie", 51, "it")?.details).toEqual(DETAILS)
    expect(getTMDBSessionCache("movie", 1, "it")?.details).toEqual(DETAILS)
    expect(getTMDBSessionCache("movie", 2, "it")).toBeNull()
  })
})
