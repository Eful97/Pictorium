import { describe, expect, it } from "vitest"
import { posterQuerySchema, validatePosterQuery } from "@/lib/validation"

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

describe("posterQuerySchema", () => {
  it("accepts legitimate preview/Stremio params", () => {
    const q = params({
      poster: "/abc123.jpg",
      logo: "/logo.png",
      backdrop: "/backdrop.jpg",
      title: "The Dark Knight",
      genreName: "Dramma",
      voteAverage: "8.2",
      year: "2024",
      rd: "2024-05-17",
      fad: "2017-12-01",
      imdbId: "tt0133093",
      rank: "15",
      animerank: "3",
      label: "Top 10",
      extra: "Custom Label",
      quality: "4K",
      lang: "it-IT",
      rsrc: "imdb,tomatoes",
      scale: "75",
      ox: "5",
      oy: "-3",
      bscale: "100",
      gradHeight: "30",
      blur: "5",
      bf: "60",
      bd: "40",
      mv: "2026-07-16T10:15:30.000Z",
      fmt: "webp",
      bs: "pill",
      side: "right",
      ac: "#ff0000",
    })
    expect(validatePosterQuery(q)).toBeNull()
    expect(posterQuerySchema.safeParse(Object.fromEntries(q)).success).toBe(true)
  })

  it("rejects oversized text params (DoS/cache-flood)", () => {
    expect(validatePosterQuery(params({ extra: "x".repeat(81) }))).toContain("extra")
    expect(validatePosterQuery(params({ label: "x".repeat(81) }))).toContain("label")
    expect(validatePosterQuery(params({ title: "x".repeat(201) }))).toContain("title")
    expect(validatePosterQuery(params({ genreName: "x".repeat(61) }))).toContain("genreName")
    expect(validatePosterQuery(params({ quality: "x".repeat(17) }))).toContain("quality")
    expect(validatePosterQuery(params({ lang: "x".repeat(21) }))).toContain("lang")
  })

  it("rejects oversized image paths", () => {
    expect(validatePosterQuery(params({ poster: `/${"x".repeat(200)}.jpg` }))).toContain("poster")
    expect(validatePosterQuery(params({ logo: `/${"x".repeat(200)}.png` }))).toContain("logo")
    expect(validatePosterQuery(params({ backdrop: `/${"x".repeat(200)}.jpg` }))).toContain("backdrop")
  })

  it("rejects malformed rank/imdbId", () => {
    // Rank oltre 7 cifre o non numerico: mai al renderer.
    expect(validatePosterQuery(params({ rank: "99999999" }))).toContain("rank")
    expect(validatePosterQuery(params({ rank: "12abc" }))).toContain("rank")
    expect(validatePosterQuery(params({ animerank: "1e21" }))).toContain("animerank")
    expect(validatePosterQuery(params({ imdbId: "not-an-id" }))).toContain("imdbId")
    expect(validatePosterQuery(params({ imdbId: "tt" }))).toContain("imdbId")
  })

  it("ignores unknown params (handled or inert at use site)", () => {
    expect(validatePosterQuery(params({ badges: "0", ranking: "1", preview: "1", be: "0", tl: "1" }))).toBeNull()
  })
})
