import { describe, expect, it } from "vitest"
import {
  animeMapInfo,
  createAnimeIdMapResolver,
  findAnimeByImdb,
  findAnimeByTmdb,
  parseAnimeNamespace,
  resolveAnimeArtwork,
} from "@/lib/anime-id-map"

const SMALL = [
  { a: 164, k: 142, m: 164, d: 7, t: 128, y: "movie", i: ["tt0119698"] },
  { a: 290, k: 265, t: 26209, y: "tv", s: 1, i: ["tt0286390"] },
  { a: 396, k: 266, t: 26209, y: "tv", s: 2 },
  { a: 3120, k: 2809, t: 34775, y: "movie", i: ["tt0185196"] },
  { a: 1693, k: 1521, t: 34775, y: "tv", s: 1, i: ["tt0989787"] },
  { a: 999001, t: 73529, y: "movie" },
  { a: 999001, t: 73530, y: "movie" },
  { k: 777, t: 555, y: "tv" },
  { t: 1, y: "tv" },
  null,
  "garbage",
  { a: -3, t: -1, y: "tv" },
  // Snapshot untrusted: id frazionari / stringhe parziali non indicizzati.
  { a: 16.5, k: 778.5, t: 556, y: "tv" },
  { a: "164junk", k: 779, t: 557, y: "tv" },
] as unknown[]

describe("anime-id-map resolver (lookup semantics)", () => {
  it("resolves movie and series artwork where unique", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
    expect(r.resolveArtwork("kitsu", 265, "tv")).toEqual({ status: "resolved", tmdbId: 26209, tmdbSide: "tv" })
    expect(r.resolveArtwork("mal", 164, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
    expect(r.resolveArtwork("anidb", 7, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
  })

  it("is case-insensitive on namespace and strict on media side", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.resolveArtwork("AniList", 164, "movie").status).toBe("resolved")
    // Media-type incompatibile: 164 esiste solo sul lato movie.
    expect(r.resolveArtwork("anilist", 164, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 164, "ova")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 164, null)).toEqual({ status: "missing" })
  })

  it("rejects invalid ids without throwing", () => {
    const r = createAnimeIdMapResolver(SMALL)
    for (const bad of [0, -5, "xx", null, undefined, NaN, "", "164junk", "12ab34", "3.5", 3.5, 16.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "0x10", "1e3", {}, []]) {
      expect(r.resolveArtwork("anilist", bad, "movie")).toEqual({ status: "missing" })
    }
    expect(r.resolveArtwork("unknown-ns", 164, "movie")).toEqual({ status: "missing" })
    expect(r.resolveArtwork(null, 164, "movie")).toEqual({ status: "missing" })
    // Numeriche intere come stringa restano accettate…
    expect(r.resolveArtwork("anilist", "164", "movie")).toMatchObject({ status: "resolved", tmdbId: 128 })
    expect(r.findByTmdb("128", "movie")).toHaveLength(1)
    // …ma parziali/frazionarie mai.
    expect(r.findByTmdb("128junk")).toEqual([])
    expect(r.findByTmdb(128.5)).toEqual([])
  })

  it("never first-picks on conflicts (ambiguous)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // anilist 999001 -> due film diversi: ambiguo, non il primo.
    expect(r.resolveArtwork("anilist", 999001, "movie")).toEqual({ status: "ambiguous" })
  })

  it("missing optional fields do not invalidate usable associations", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // Solo kitsu noto, senza imdb/stagione: risolve comunque.
    expect(r.resolveArtwork("kitsu", 777, "tv")).toEqual({ status: "resolved", tmdbId: 555, tmdbSide: "tv" })
  })

  it("reverse lookup preserves ALL matches (seasons sharing a show)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    const matches = r.findByTmdb(26209, "tv")
    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.a).sort()).toEqual([290, 396])
    // Senza lato: unisce movie+tv; con lato: solo quel lato.
    expect(r.findByTmdb(128)).toHaveLength(1)
    expect(r.findByTmdb(128, "tv")).toHaveLength(0)
    expect(r.findByTmdb("nope")).toHaveLength(0)
    expect(r.findByTmdb(-1)).toHaveLength(0)
  })

  it("reverse imdb lookup is syntax-validated", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.findByImdb("tt0119698")).toHaveLength(1)
    expect(r.findByImdb("TT0119698")).toHaveLength(1)
    expect(r.findByImdb("tt0000000")).toHaveLength(0)
    expect(r.findByImdb("not-an-id")).toHaveLength(0)
    expect(r.findByImdb(null)).toHaveLength(0)
    // Filtro lato: l'imdb del film non è prestato alle serie.
    expect(r.findByImdb("tt0119698", "tv")).toHaveLength(0)
    expect(r.findByImdb("tt0119698", "movie")).toHaveLength(1)
    expect(r.findByImdb("tt0286390", "movie")).toHaveLength(0)
    expect(r.findByImdb("tt0286390", "tv")).toHaveLength(1)
  })

  it("snapshot ids are strictly validated (no partial/fractional indexing)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // a:16.5 frazionario mai indicizzato…
    expect(r.resolveArtwork("anilist", 16.5, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("kitsu", 778.5, "tv")).toEqual({ status: "missing" })
    // …a:"164junk" stringa mai indicizzata (e kitsu:779 della stessa riga resta valido).
    expect(r.resolveArtwork("anilist", "164junk", "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("kitsu", 779, "tv")).toMatchObject({ status: "resolved", tmdbId: 557 })
  })

  it("same numeric id on both sides stays separated", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // tmdb 34775 esiste sia come film (a3120) sia come serie (a1693).
    expect(r.resolveArtwork("anilist", 3120, "movie")).toMatchObject({ status: "resolved", tmdbId: 34775 })
    expect(r.resolveArtwork("anilist", 3120, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 1693, "tv")).toMatchObject({ status: "resolved", tmdbId: 34775 })
    expect(r.resolveArtwork("anilist", 1693, "movie")).toEqual({ status: "missing" })
    expect(r.findByTmdb(34775, "movie").map((m) => m.a)).toEqual([3120])
    expect(r.findByTmdb(34775, "tv").map((m) => m.a)).toEqual([1693])
    expect(r.findByTmdb(34775)).toHaveLength(2)
  })

  it("unavailable snapshot: everything misses, never throws", () => {
    const r = createAnimeIdMapResolver([])
    expect(r.info().available).toBe(false)
    expect(r.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "unavailable" })
    expect(r.findByTmdb(128)).toEqual([])
    expect(r.findByImdb("tt0119698")).toEqual([])
    const broken = createAnimeIdMapResolver("not-an-array" as unknown as never[])
    expect(broken.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "unavailable" })
  })

  it("bundled snapshot is available, versioned and sizable", () => {
    const info = animeMapInfo()
    expect(info.available).toBe(true)
    expect(info.schemaVersion).toBe(1)
    expect(typeof info.sourceRevision).toBe("string")
    expect(info.sourceRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(info.recordCount).toBeGreaterThan(1000)
    // Forward reale: film + serie.
    expect(resolveAnimeArtwork("anilist", 164, "movie")).toMatchObject({ status: "resolved", tmdbId: 128 })
    expect(resolveAnimeArtwork("anilist", 290, "tv")).toMatchObject({ status: "resolved", tmdbId: 26209 })
    // Reverse reale: 7 stagioni sullo stesso show preservate.
    expect(findAnimeByTmdb(26209, "tv").length).toBeGreaterThan(1)
    // Reverse reale unico: un solo record.
    expect(findAnimeByImdb("tt0119698")).toHaveLength(1)
  })

  it("parseAnimeNamespace accepts only known namespaces", () => {
    expect(parseAnimeNamespace("anilist")).toBe("anilist")
    expect(parseAnimeNamespace("KITSU")).toBe("kitsu")
    expect(parseAnimeNamespace("mal")).toBe("mal")
    expect(parseAnimeNamespace("anidb")).toBe("anidb")
    expect(parseAnimeNamespace("tmdb")).toBeNull()
    expect(parseAnimeNamespace("")).toBeNull()
    expect(parseAnimeNamespace(null)).toBeNull()
  })
})
