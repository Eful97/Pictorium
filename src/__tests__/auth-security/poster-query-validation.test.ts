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

  it("enforces poster/logo 2048 caps with exact boundaries (custom URL contract)", () => {
    const httpsUrlOfLength = (total: number): string => {
      const prefix = "https://i.imgur.com/";
      const suffix = ".png";
      return `${prefix}${"a".repeat(total - prefix.length - suffix.length)}${suffix}`;
    };
    const poster2048 = httpsUrlOfLength(2048);
    const poster2049 = httpsUrlOfLength(2049);
    const logo2048 = httpsUrlOfLength(2048);
    const logo2049 = httpsUrlOfLength(2049);
    expect(poster2048).toHaveLength(2048);
    expect(poster2049).toHaveLength(2049);
    expect(logo2048).toHaveLength(2048);
    expect(logo2049).toHaveLength(2049);
    expect(validatePosterQuery(params({ poster: poster2048 }))).toBeNull();
    expect(validatePosterQuery(params({ poster: poster2049 }))).toContain("poster");
    expect(validatePosterQuery(params({ logo: logo2048 }))).toBeNull();
    expect(validatePosterQuery(params({ logo: logo2049 }))).toContain("logo");
    // Supported custom logo https example stays accepted, as do normal relative paths.
    expect(validatePosterQuery(params({ logo: "https://i.imgur.com/logo123.png" }))).toBeNull();
    expect(validatePosterQuery(params({ logo: "/logo.png" }))).toBeNull();
    expect(validatePosterQuery(params({ poster: "/abc123.jpg" }))).toBeNull();
  });

  it("keeps the backdrop 160 cap with exact boundaries", () => {
    const backdrop160 = `/${"x".repeat(155)}.jpg`;
    const backdrop161 = `/${"x".repeat(156)}.jpg`;
    expect(backdrop160).toHaveLength(160);
    expect(backdrop161).toHaveLength(161);
    expect(validatePosterQuery(params({ backdrop: backdrop160 }))).toBeNull();
    expect(validatePosterQuery(params({ backdrop: backdrop161 }))).toContain("backdrop");
  })

  it("accepts custom image URLs in poster (same cap as the mapping)", () => {
    expect(
      validatePosterQuery(params({ poster: "https://i.pinimg.com/originals/ab/12/abcdef1234567890.jpg" })),
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
