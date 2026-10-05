import { describe, expect, it } from "vitest"
import {
  applyLocalBackup,
  applyPersonalKeys,
  collectLocalBackup,
  collectPersonalKeys,
  stripLocalPersonalKeys,
  type MinimalStorage,
} from "@/lib/backup-local"
import { readPersonalDeviceKey, writePersonalDeviceKey, type DeviceKeyStorage } from "@/lib/device-keys"

function memStorage(seed: Record<string, string> = {}): DeviceKeyStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
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

  it("raccoglie e ripristina le fonti ranking (stringa vuota = override JW)", () => {
    const s = memStorage({
      pictorium_ranking_source_movie: "cat_movies",
      pictorium_ranking_source_series: "",
    })
    expect(collectLocalBackup(s, UUID)).toMatchObject({
      rankingSources: { movie: "cat_movies", series: "" },
    })

    const target = memStorage()
    const res = applyLocalBackup(target, UUID, {
      rankingSources: { movie: "cat_movies", series: "" },
    })
    expect(res.applied).toContain("rankingSources.movie")
    expect(res.applied).toContain("rankingSources.series")
    expect(target.dump()["pictorium_ranking_source_movie"]).toBe("cat_movies")
    expect(target.dump()["pictorium_ranking_source_series"]).toBe("")

    const bad = applyLocalBackup(memStorage(), UUID, {
      rankingSources: { movie: "x".repeat(65), series: 42 },
    })
    expect(bad.applied).not.toContain("rankingSources.movie")
    expect(bad.skipped).toContain("rankingSources.movie")
    expect(bad.skipped).toContain("rankingSources.series")
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

describe("collectPersonalKeys", () => {
  it("raccoglie solo chiavi con provenienza personale", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "tmdb", "personal-tmdb-1")).toBe(true)
    expect(writePersonalDeviceKey(s, "simkl", "personal-simkl-1")).toBe(true)
    s.setItem("mdblist_key", "legacy-unmarked-key")
    s.setItem("tvdb_key", "instance-copy-no-marker")
    expect(collectPersonalKeys(s)).toEqual({
      tmdb: "personal-tmdb-1",
      simkl: "personal-simkl-1",
    })
  })

  it("torna {} senza chiavi marcate", () => {
    expect(collectPersonalKeys(memStorage())).toEqual({})
    expect(collectPersonalKeys(memStorage({ tmdb_key: "legacy" }))).toEqual({})
  })
})

describe("applyPersonalKeys", () => {
  it("applica chiavi assenti con marker", () => {
    const s = memStorage()
    const res = applyPersonalKeys(s, { tmdb: "new-tmdb-1", fanart: "new-fanart-1" })
    expect(res).toEqual({ applied: ["personalKeys.tmdb", "personalKeys.fanart"], skipped: [] })
    expect(readPersonalDeviceKey(s, "tmdb")).toBe("new-tmdb-1")
    expect(readPersonalDeviceKey(s, "fanart")).toBe("new-fanart-1")
  })

  it("default: esistenti (anche unknown) non sovrascritte senza consenso", () => {
    const s = memStorage({ tmdb_key: "device-unknown-1", mdblist_key: "other-legacy" })
    const res = applyPersonalKeys(s, { tmdb: "file-different-2", mdblist: "other-legacy" })
    expect(res.applied).toEqual([])
    expect(res.skipped).toEqual(["personalKeys.tmdb", "personalKeys.mdblist"])
    expect(s.dump()["tmdb_key"]).toBe("device-unknown-1")
    expect(s.dump()["mdblist_key:origin"]).toBeUndefined()
  })

  it("overwrite esplicito sostituisce e rimarca", () => {
    const s = memStorage({ tmdb_key: "device-unknown-1" })
    const res = applyPersonalKeys(s, { tmdb: "file-new-2" }, { overwrite: true })
    expect(res).toEqual({ applied: ["personalKeys.tmdb"], skipped: [] })
    expect(readPersonalDeviceKey(s, "tmdb")).toBe("file-new-2")
  })

  it("valore identico marcato: idempotente senza overwrite", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "tvdb", "same-key-1")).toBe(true)
    const res = applyPersonalKeys(s, { tvdb: "same-key-1" })
    expect(res).toEqual({ applied: ["personalKeys.tvdb"], skipped: [] })
  })

  it("null/vuote/invalide mai wipe (esistente conservata)", () => {
    const s = memStorage({ tmdb_key: "keep-me-1", mdblist_key: "keep-me-2" })
    const res = applyPersonalKeys(s, {
      tmdb: null,
      mdblist: "   ",
      tvdb: 42,
      simkl: "x".repeat(257),
      fanart: "has space",
    })
    expect(res.applied).toEqual([])
    expect(res.skipped).toHaveLength(5)
    expect(s.dump()["tmdb_key"]).toBe("keep-me-1")
    expect(s.dump()["mdblist_key"]).toBe("keep-me-2")
    expect(s.dump()["tvdb_key"]).toBeUndefined()
  })

  it("ignora token/PIN/props ignote e non inquina i prototipi", () => {
    const s = memStorage()
    const input = JSON.parse(
      '{"tmdb":"ok-key-1","token":"T","pin":"123456","serverKeys":{"tmdbKey":"S"},"unknownKind":"x","__proto__":{"polluted":true}}',
    )
    const res = applyPersonalKeys(s, input)
    expect(res).toEqual({ applied: ["personalKeys.tmdb"], skipped: [] })
    expect(s.dump()["token"]).toBeUndefined()
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined()
  })

  it("ignora input non-oggetto", () => {
    const s = memStorage()
    expect(applyPersonalKeys(s, null)).toEqual({ applied: [], skipped: [] })
    expect(applyPersonalKeys(s, [1])).toEqual({ applied: [], skipped: [] })
    expect(applyPersonalKeys(s, "tmdb")).toEqual({ applied: [], skipped: [] })
    expect(s.dump()).toEqual({})
  })

  it("lettura storage fallita: SKIP senza scrivere (fail-closed)", () => {
    const calls: string[] = []
    const unreadable = {
      getItem: (_k: string): string | null => {
        throw new Error("denied")
      },
      setItem: (k: string, _v: string) => {
        calls.push(k)
      },
      removeItem: (_k: string) => {},
    }
    const res = applyPersonalKeys(unreadable, { tmdb: "file-key-1", mdblist: "file-key-2" })
    expect(res).toEqual({ applied: [], skipped: ["personalKeys.tmdb", "personalKeys.mdblist"] })
    expect(calls).toEqual([])
  })
})

describe("stripLocalPersonalKeys", () => {
  it("rimuove personalKeys preservando il resto", () => {
    const body = {
      schemaVersion: 2,
      mappings: [],
      local: { lang: "it", personalKeys: { tmdb: "SECRET" } },
    }
    const out = stripLocalPersonalKeys(body) as Record<string, unknown>
    expect(out.local).toEqual({ lang: "it" })
    expect(JSON.stringify(out)).not.toContain("SECRET")
    // Input non mutato.
    expect(body.local).toEqual({ lang: "it", personalKeys: { tmdb: "SECRET" } })
  })

  it("passthrough senza personalKeys o non-oggetti", () => {
    expect(stripLocalPersonalKeys({ local: { lang: "it" } })).toEqual({ local: { lang: "it" } })
    expect(stripLocalPersonalKeys({ mappings: [] })).toEqual({ mappings: [] })
    expect(stripLocalPersonalKeys([1])).toEqual([1])
    expect(stripLocalPersonalKeys(null)).toBeNull()
  })
})
