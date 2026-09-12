import { describe, expect, it } from "vitest"
import { getRegionDef, REGIONS } from "@/lib/regions"
import { getWarmupCatalogs, normalizeCatalogId, normalizeCatalogIdKeys, normalizeCatalogIdList, PICTORIUM_CATALOGS, regionJwName, WARMUP_CATALOG_IDS } from "@/lib/catalog-definitions"

describe("catalog definitions", () => {
  it("keeps warmup catalog IDs backed by manifest catalogs", () => {
    const manifestIds: Set<string> = new Set(PICTORIUM_CATALOGS.map((catalog) => catalog.id))

    const warmupCatalogs = getWarmupCatalogs()

    expect(warmupCatalogs.map((catalog) => catalog.id)).toEqual([
      "pictorium-jw-movies",
      "pictorium-jw-series",
      "pictorium-netflix-movies",
      "pictorium-netflix-series",
      "pictorium-prime-movies",
      "pictorium-prime-series",
      "pictorium-anime-movies",
      "pictorium-anime",
    ])
    expect(warmupCatalogs.every((catalog) => manifestIds.has(catalog.id))).toBe(true)
    expect(warmupCatalogs.map((catalog) => catalog.type)).toEqual(["movie", "series", "movie", "series", "movie", "series", "movie", "series"])
    expect(WARMUP_CATALOG_IDS).toHaveLength(8)
  })

  it("emits only pictorium-* catalog IDs", () => {
    expect(PICTORIUM_CATALOGS.every((catalog) => catalog.id.startsWith("pictorium-"))).toBe(true)
  })

  it("normalizes legacy posterium-* IDs to pictorium-*", () => {
    expect(normalizeCatalogId("posterium-jw-movies")).toBe("pictorium-jw-movies")
    expect(normalizeCatalogId("posterium-custom-movie-x")).toBe("pictorium-custom-movie-x")
    expect(normalizeCatalogId("pictorium-jw-movies")).toBe("pictorium-jw-movies")
    expect(normalizeCatalogIdList(["posterium-jw-movies", "pictorium-anime"])).toEqual([
      "pictorium-jw-movies",
      "pictorium-anime",
    ])
    expect(normalizeCatalogIdList(undefined)).toBeUndefined()
    expect(normalizeCatalogIdKeys({ "posterium-anime": "Anime", other: "x" })).toEqual({
      "pictorium-anime": "Anime",
      other: "x",
    })
  })

  describe("regionJwName (bandiera dinamica)", () => {
    it("segue flag e label della regione per i Top 20 JW", () => {
      expect(regionJwName("pictorium-jw-movies", "movie", getRegionDef("IT"))).toBe("🇮🇹 Top 20 Italia — Film")
      expect(regionJwName("pictorium-jw-series", "series", getRegionDef("IT"))).toBe("🇮🇹 Top 20 Italia — Serie TV")
      expect(regionJwName("pictorium-jw-movies", "movie", getRegionDef("DE"))).toBe("🇩🇪 Top 20 Germania — Film")
      expect(regionJwName("pictorium-jw-series", "series", getRegionDef("JP"))).toBe("🇯🇵 Top 20 Giappone — Serie TV")
    })

    it("copre tutte le regioni senza resti della precedente", () => {
      for (const region of REGIONS) {
        const movie = regionJwName("pictorium-jw-movies", "movie", region)
        const series = regionJwName("pictorium-jw-series", "series", region)
        expect(movie).toContain(region.flag)
        expect(movie).toContain(region.label)
        expect(series).toContain(region.flag)
        expect(series).toContain(region.label)
        // Mai la bandiera di un'altra regione
        for (const other of REGIONS) {
          if (other.code === region.code) continue
          expect(movie).not.toContain(other.flag)
        }
      }
    })

    it("gestisce Ultime Uscite e ignora i non-JW", () => {
      expect(regionJwName("pictorium-jw-new-movies", "movie", getRegionDef("FR"))).toBe("🇫🇷 Ultime Uscite Francia — Film")
      expect(regionJwName("pictorium-netflix-movies", "movie", getRegionDef("DE"))).toBeNull()
      expect(regionJwName("pictorium-anime", "series", getRegionDef("DE"))).toBeNull()
    })
  })
})
