import { beforeEach, describe, expect, it } from "vitest"
import { loadCustomTiles, storeCustomTiles } from "@/lib/custom-tiles-store"
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
