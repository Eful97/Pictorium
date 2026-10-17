import { beforeEach, describe, expect, it } from "vitest"
import { loadCustomTiles, storeCustomTiles, loadCustomLogoTiles, storeCustomLogoTiles } from "@/lib/custom-tiles-store"
import type { TMDBImage } from "@/lib/types"

function tile(url: string): TMDBImage {
  return { file_path: url, iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
}

beforeEach(() => {
  localStorage.clear()
})

describe("custom-tiles-store", () => {
  it("round-trip per-titolo (namespace per tmdbId)", () => {
    storeCustomTiles(550, [tile("https://i.imgur.com/a.jpg")])
    expect(loadCustomTiles(550)).toEqual([tile("https://i.imgur.com/a.jpg")])
    expect(loadCustomTiles(551)).toEqual([])
  })

  it("scarta voci malformate e non-URL", () => {
    localStorage.setItem(
      "pictorium_custom_posters_550",
      JSON.stringify([tile("https://i.imgur.com/a.jpg"), { file_path: "/abc.jpg" }, null, "nope"]),
    )
    expect(loadCustomTiles(550)).toEqual([tile("https://i.imgur.com/a.jpg")])
  })

  it("tronca oltre il cap e rimuove la chiave a lista vuota", () => {
    const many = Array.from({ length: 30 }, (_, i) => tile(`https://i.imgur.com/${i}.jpg`))
    storeCustomTiles(550, many)
    expect(loadCustomTiles(550)).toHaveLength(20)
    storeCustomTiles(550, [])
    expect(localStorage.getItem("pictorium_custom_posters_550")).toBeNull()
  })

  it("id nullo = no-op senza eccezioni", () => {
    expect(loadCustomTiles(null)).toEqual([])
    expect(() => storeCustomTiles(undefined, [tile("https://i.imgur.com/a.jpg")])).not.toThrow()
  })
})

describe("custom logo tiles store (title key includes media type)", () => {
  it("round-trips per title key", () => {
    storeCustomLogoTiles("movie:550", [tile("https://i.imgur.com/logo-a.png")])
    expect(loadCustomLogoTiles("movie:550")).toEqual([tile("https://i.imgur.com/logo-a.png")])
    expect(loadCustomLogoTiles("movie:551")).toEqual([])
  })

  it("isolates movie and tv sharing the same numeric id", () => {
    storeCustomLogoTiles("movie:550", [tile("https://i.imgur.com/movie-logo.png")])
    storeCustomLogoTiles("tv:550", [tile("https://i.imgur.com/tv-logo.png")])
    expect(loadCustomLogoTiles("movie:550")).toEqual([tile("https://i.imgur.com/movie-logo.png")])
    expect(loadCustomLogoTiles("tv:550")).toEqual([tile("https://i.imgur.com/tv-logo.png")])
  })

  it("preserves A->B->A across title switches (no cross-title leak)", () => {
    const tileA = tile("https://i.imgur.com/logo-a.png")
    const tileB = tile("https://i.imgur.com/logo-b.png")
    storeCustomLogoTiles("movie:550", [tileA])
    storeCustomLogoTiles("movie:551", [tileB])
    // Coming back to A must still read A's tiles, never B's.
    expect(loadCustomLogoTiles("movie:550")).toEqual([tileA])
    expect(loadCustomLogoTiles("movie:551")).toEqual([tileB])
  })

  it("null key is a no-op without exceptions", () => {
    expect(loadCustomLogoTiles(null)).toEqual([])
    expect(loadCustomLogoTiles(undefined)).toEqual([])
    expect(() => storeCustomLogoTiles(null, [tile("https://i.imgur.com/a.jpg")])).not.toThrow()
    expect(() => storeCustomLogoTiles(undefined, [tile("https://i.imgur.com/a.jpg")])).not.toThrow()
  })

  it("empty list removes the namespaced key", () => {
    storeCustomLogoTiles("movie:550", [tile("https://i.imgur.com/a.jpg")])
    storeCustomLogoTiles("movie:550", [])
    expect(localStorage.getItem("pictorium_custom_logos_movie:550")).toBeNull()
  })
})
