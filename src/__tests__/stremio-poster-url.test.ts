import { describe, expect, it } from "vitest"
import { buildStremioPosterUrl, mappingVersionParam } from "@/lib/stremio-poster-url"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { Mapping } from "@/lib/types"

function mapping(updatedAt: string): Mapping {
  return {
    tmdbId: 42,
    mediaType: "movie",
    title: "Test",
    posterPath: "/poster.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt,
  }
}

describe("buildStremioPosterUrl", () => {
  it("adds a mapping version parameter when a saved mapping exists", () => {
    const updatedAt = "2026-07-16T10:15:30.000Z"
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: { badgeStyle: "bar" },
      mapping: mapping(updatedAt),
    })

    expect(url.pathname).toBe("/api/poster/movie/42")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.get("mv")).toBe(String(Date.parse(updatedAt)))
    expect(url.searchParams.get("bs")).toBe("bar")
    // Mai segreti nei poster serviti (M2): niente api_key/mdblist_key.
    expect(url.searchParams.has("api_key")).toBe(false)
    expect(url.searchParams.has("mdblist_key")).toBe(false)
  })

  it("emits the mapping title for JustWatch matching", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: {},
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    })

    expect(url.searchParams.get("title")).toBe("Test")
  })

  it("omits title without a saved mapping", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.searchParams.has("title")).toBe(false)
  })

  it("omits mapping version for unsaved titles", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.pathname).toBe("/api/poster/series/94997")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.has("mv")).toBe(false)
  })

  it("forwards badge subcomponents and ribbonSide from mapping and defaults", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 123,
      defaults: {
        badgeGenre: true,
        badgeYear: false,
        badgeRating: true,
        badgeQuality: false,
        ratingSources: ["tmdb", "imdb"],
        ribbonSide: "right",
      },
      mapping: {
        ...mapping("2026-07-16T10:15:30.000Z"),
        badgeGenre: false,
        ribbonSide: "left",
      },
    })

    expect(url.searchParams.get("bg")).toBe("0") // mapping wins
    expect(url.searchParams.get("by")).toBe("0") // defaults
    expect(url.searchParams.has("br")).toBe(false) // badgeRating is true
    expect(url.searchParams.get("bq")).toBe("0") // defaults
    expect(url.searchParams.get("rsrc")).toBe("tmdb,imdb")
    expect(url.searchParams.get("side")).toBe("left") // mapping wins
  })

  it("ignores invalid mapping timestamps", () => {
    expect(mappingVersionParam(mapping("not-a-date"))).toBeNull()
  })
})
