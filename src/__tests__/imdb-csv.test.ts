import { describe, it, expect } from "vitest"
import {
  parseImdbCsv,
  classifyImdbTitleType,
  isValidImdbId,
  IMDB_CSV_MAX_ITEMS,
} from "@/lib/imdb-csv"

const NEW_FORMAT = [
  "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
  "tt0371746,9,2020-01-01,Iron Man,https://www.imdb.com/title/tt0371746/,Feature Film,7.9,126,2008,Action,900000,2008-05-02,Jon Favreau",
  "tt0903747,10,2020-02-01,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,,2008,Crime,1500000,2008-01-20,Vince Gilligan",
].join("\n")

const OLD_FORMAT = [
  "position,const,created,modified,description,Title,Title type,Directors,You rated,IMDb Rating,Runtime (mins),Year,Genres,Num. Votes,Release Date (month/day/year),URL",
  "1,tt0111161,Mon Jan 1,Mon Jan 1,,The Shawshank Redemption,Feature Film,Frank Darabont,,9.3,142,1994,Drama,2000000,1994-09-23,https://www.imdb.com/title/tt0111161/",
].join("\n")

describe("parseImdbCsv", () => {
  it("parses the post-2018 export format with movie/tv split", () => {
    const res = parseImdbCsv(NEW_FORMAT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBe(2)
    expect(res.items[0]).toMatchObject({ imdb: "tt0371746", title: "Iron Man", year: 2008, mediatype: "movie" })
    expect(res.items[1]).toMatchObject({ imdb: "tt0903747", title: "Breaking Bad", year: 2008, mediatype: "tv" })
  })

  it("parses the pre-2017 export format", () => {
    const res = parseImdbCsv(OLD_FORMAT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBe(1)
    expect(res.items[0]).toMatchObject({ imdb: "tt0111161", mediatype: "movie" })
  })

  it("accepts columns in any order", () => {
    const csv = [
      "Year,Title,Const,Title Type",
      "2008,Iron Man,tt0371746,Feature Film",
    ].join("\n")
    const res = parseImdbCsv(csv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[0]).toMatchObject({ imdb: "tt0371746", title: "Iron Man", year: 2008 })
  })

  it("handles quoted titles with commas and CRLF + BOM", () => {
    const csv = "\uFEFFTitle,Const,Year,Title Type\r\n\"The Good, the Bad and the Ugly\",tt0060196,1966,Feature Film\r\n"
    const res = parseImdbCsv(csv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[0]).toMatchObject({ imdb: "tt0060196", title: "The Good, the Bad and the Ugly" })
  })

  it("dedupes repeated rows and counts them as skipped", () => {
    const csv = [
      "Const,Title,Year,Title Type",
      "tt0371746,Iron Man,2008,Feature Film",
      "tt0371746,Iron Man dup,2008,Feature Film",
      "TT0371746,Iron Man case-dup,2008,Feature Film",
    ].join("\n")
    const res = parseImdbCsv(csv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBe(1)
    expect(res.skippedRows).toBe(2)
  })

  it("skips malformed IDs but recovers tt from the URL column", () => {
    const csv = [
      "Const,Title,Year,URL",
      "nonsense,Bad Row,2000,https://example.com/",
      ",Url Only,2001,https://www.imdb.com/title/tt0133093/",
    ].join("\n")
    const res = parseImdbCsv(csv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBe(1)
    expect(res.items[0].imdb).toBe("tt0133093")
    expect(res.skippedRows).toBe(1)
  })

  it("leaves ambiguous title types unclassified for TMDB resolution", () => {
    const csv = [
      "Const,Title,Year,Title Type",
      "tt1234567,Some Doc,2020,Documentary",
      "tt1234568,Some Episode,2020,TV Episode",
      "tt1234569,No Type,2020,",
    ].join("\n")
    const res = parseImdbCsv(csv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.map((i) => i.mediatype)).toEqual([undefined, undefined, undefined])
  })

  it("rejects empty CSV", () => {
    expect(parseImdbCsv("")).toEqual({ ok: false, error: "empty" })
    expect(parseImdbCsv("   \n  ")).toEqual({ ok: false, error: "empty" })
  })

  it("rejects CSV without Const or URL column", () => {
    const res = parseImdbCsv("Title,Year\nIron Man,2008\n")
    expect(res).toEqual({ ok: false, error: "no_const_column" })
  })

  it("rejects CSV with no valid rows", () => {
    const res = parseImdbCsv("Const,Title,Year\nnope,Bad,2000\n")
    expect(res).toEqual({ ok: false, error: "no_valid_rows" })
  })

  it("rejects oversized files", () => {
    const res = parseImdbCsv("x".repeat(2_000_001))
    expect(res).toEqual({ ok: false, error: "too_large" })
  })

  it("caps items at 500", () => {
    const rows = ["Const,Title,Year"]
    for (let i = 0; i < 600; i++) {
      rows.push(`tt${String(1000000 + i)},M${i},2000`)
    }
    const res = parseImdbCsv(rows.join("\n"))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items.length).toBe(IMDB_CSV_MAX_ITEMS)
  })
})

describe("classifyImdbTitleType / isValidImdbId", () => {
  it("maps film and series types", () => {
    expect(classifyImdbTitleType("Feature Film")).toBe("movie")
    expect(classifyImdbTitleType("TV Movie")).toBe("movie")
    expect(classifyImdbTitleType("TV Series")).toBe("tv")
    expect(classifyImdbTitleType("TV Mini-Series")).toBe("tv")
  })

  it("validates tt IDs", () => {
    expect(isValidImdbId("tt0371746")).toBe(true)
    expect(isValidImdbId("tt123")).toBe(false)
    expect(isValidImdbId("1726")).toBe(false)
    expect(isValidImdbId(null)).toBe(false)
  })
})
