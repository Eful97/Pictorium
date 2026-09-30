import { describe, expect, it } from "vitest"
import { applyLocalBackup, collectLocalBackup, type MinimalStorage } from "@/lib/backup-local"

function memStorage(seed: Record<string, string> = {}): MinimalStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    dump: () => Object.fromEntries(map),
  }
}

const UUID = "11111111-1111-4111-8111-111111111111"

describe("collectLocalBackup", () => {
  it("raccoglie lingua, tema, ricerche e voci namespaced", () => {
    const s = memStorage({
      preferred_lang: "it",
      pictorium_theme: "dark",
      recent_searches: JSON.stringify(["dune", "alien"]),
      [`badgeDefaults:${UUID}`]: JSON.stringify({ badgeStyle: "shadow" }),
      [`gradientPresets:${UUID}`]: JSON.stringify([{ id: "a", name: "Mio", values: { gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, tintStrength: 20, blurEnabled: true } }]),
      pictorium_custom_catalogs: JSON.stringify([{ id: "c1", name: "C", type: "movie", url: "https://x" }]),
      pictorium_collections: JSON.stringify([{ id: "k", name: "K", posterIds: [], createdAt: 1 }]),
    })
    const out = collectLocalBackup(s, UUID)
    expect(out.lang).toBe("it")
    expect(out.theme).toBe("dark")
    expect(out.recentSearches).toEqual(["dune", "alien"])
    expect(typeof out.badgeDefaults).toBe("string")
    expect(out.gradientPresets).toHaveLength(1)
    expect(out.catalogs).toMatchObject({ custom: [{ id: "c1" }] })
    expect(out.collections).toHaveLength(1)
  })

  it("ignora valori invalidi e non tocca mai i segreti", () => {
    const s = memStorage({
      preferred_lang: "xx",
      pictorium_theme: "rainbow",
      recent_searches: "nope",
      tmdb_key: "SECRET",
      [`pictorium-user-token:${UUID}`]: "SECRET",
    })
    const out = collectLocalBackup(s, UUID)
    expect(out.lang).toBeUndefined()
    expect(out.theme).toBeUndefined()
    expect(out.recentSearches).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain("SECRET")
  })

  it("fail-open su storage rotto", () => {
    const broken: MinimalStorage = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {},
    }
    expect(collectLocalBackup(broken, UUID)).toEqual({})
  })
})

describe("applyLocalBackup", () => {
  it("scrive le voci validate sul namespace corrente (migrazione tra spazi)", () => {
    const s = memStorage()
    const res = applyLocalBackup(s, UUID, {
      lang: "fr",
      theme: "light",
      recentSearches: ["dune"],
      badgeDefaults: JSON.stringify({ badgeStyle: "colored" }),
      gradientPresets: [{ id: "a", name: "Mio", values: { gradientHeight: 35, blurIntensity: 20, blurFade: 10, blurDarkness: 0, tintStrength: 100, blurEnabled: true } }],
      catalogs: { order: ["a", "b"], renames: { x: "Y" } },
      collections: [{ id: "k", name: "K", posterIds: [], createdAt: 1 }],
    })
    expect(res.skipped).toEqual([])
    const dump = s.dump()
    expect(dump.preferred_lang).toBe("fr")
    expect(dump.pictorium_theme).toBe("light")
    expect(JSON.parse(dump.recent_searches)).toEqual(["dune"])
    expect(dump[`badgeDefaults:${UUID}`]).toContain("colored")
    expect(dump[`gradientPresets:${UUID}`]).toContain("Mio")
    expect(JSON.parse(dump.pictorium_catalog_order)).toEqual(["a", "b"])
  })

  it("scarta voci invalide senza lanciare", () => {
    const s = memStorage()
    const res = applyLocalBackup(s, UUID, {
      lang: "xx",
      theme: "rainbow",
      badgeDefaults: "nope",
      gradientPresets: [{ id: "", name: "", values: {} }],
      catalogs: { order: "nope" },
      collections: {},
      tmdb_key: "SECRET",
    })
    expect(s.dump()).toEqual({})
    expect(res.applied).toEqual([])
    expect(res.skipped.length).toBeGreaterThan(0)
  })

  it("ignora sezioni non-oggetto", () => {
    const s = memStorage()
    expect(applyLocalBackup(s, UUID, null)).toEqual({ applied: [], skipped: [] })
    expect(applyLocalBackup(s, UUID, [1])).toEqual({ applied: [], skipped: [] })
    expect(s.dump()).toEqual({})
  })
})
