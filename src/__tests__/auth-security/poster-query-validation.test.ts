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
    expect(validatePosterQuery(params({ ac: "x".repeat(11) }))).toContain("ac")
    expect(validatePosterQuery(params({ tl: "x".repeat(9) }))).toContain("tl")
    expect(validatePosterQuery(params({ bl: "x".repeat(9) }))).toContain("bl")
    expect(validatePosterQuery(params({ bs: "x".repeat(17) }))).toContain("bs")
    expect(validatePosterQuery(params({ rs: "x".repeat(17) }))).toContain("rs")
  })

  it("rejects oversized image paths", () => {
    expect(validatePosterQuery(params({ poster: `/${"x".repeat(2100)}.jpg` }))).toContain("poster")
    expect(validatePosterQuery(params({ logo: `/${"x".repeat(2100)}.png` }))).toContain("logo")
    expect(validatePosterQuery(params({ backdrop: `/${"x".repeat(2100)}.jpg` }))).toContain("backdrop")
  })

  it("enforces image path length boundaries (total string length)", () => {
    // Query caps (src/lib/validation.ts): poster/logo/backdrop 2048 (the
    // backdrop carries landscape custom bases like poster/logo carry portrait
    // ones).
    // Bounds apply to the full param value, not the repeated filler alone.
    const posterAccept = `/${"x".repeat(2043)}.jpg`
    const posterReject = `/${"x".repeat(2044)}.jpg`
    expect(posterAccept.length).toBe(2048)
    expect(posterReject.length).toBe(2049)
    expect(validatePosterQuery(params({ poster: posterAccept }))).toBeNull()
    expect(validatePosterQuery(params({ poster: posterReject }))).toContain("poster")

    const logoAccept = `/${"x".repeat(2043)}.png`
    const logoReject = `/${"x".repeat(2044)}.png`
    expect(logoAccept.length).toBe(2048)
    expect(logoReject.length).toBe(2049)
    expect(validatePosterQuery(params({ logo: logoAccept }))).toBeNull()
    expect(validatePosterQuery(params({ logo: logoReject }))).toContain("logo")

    const backdropAccept = `/${"x".repeat(2043)}.jpg`
    const backdropReject = `/${"x".repeat(2044)}.jpg`
    expect(backdropAccept.length).toBe(2048)
    expect(backdropReject.length).toBe(2049)
    expect(validatePosterQuery(params({ backdrop: backdropAccept }))).toBeNull()
    expect(validatePosterQuery(params({ backdrop: backdropReject }))).toContain("backdrop")
  })

  it("accepts custom image URLs in poster (same cap as the mapping)", () => {
    expect(
      validatePosterQuery(params({ poster: "https://i.pinimg.com/originals/ab/12/abcdef1234567890.jpg" })),
    ).toBeNull()
  })

  it("accepts custom image URLs in backdrop (landscape base, same cap)", () => {
    expect(
      validatePosterQuery(params({ backdrop: "https://i.pinimg.com/originals/ab/12/abcdef1234567890.jpg" })),
    ).toBeNull()
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
