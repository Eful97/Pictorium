import { describe, expect, it } from "vitest"
import {
  DEVICE_KEY_KINDS,
  DEVICE_KEY_NAMES,
  clearDeviceKey,
  isPersonalDeviceKey,
  readPersonalDeviceKey,
  writePersonalDeviceKey,
  type DeviceKeyStorage,
} from "@/lib/device-keys"

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

describe("device-keys (provenienza fail-closed)", () => {
  it("roundtrip per tutte e 5 le kind con marker legato al valore", () => {
    const s = memStorage()
    for (const kind of DEVICE_KEY_KINDS) {
      expect(writePersonalDeviceKey(s, kind, `personal-key-${kind}-123`)).toBe(true)
      expect(readPersonalDeviceKey(s, kind)).toBe(`personal-key-${kind}-123`)
      expect(isPersonalDeviceKey(s, kind)).toBe(true)
    }
    expect(DEVICE_KEY_NAMES).toEqual({
      tmdb: "tmdb_key",
      mdblist: "mdblist_key",
      tvdb: "tvdb_key",
      simkl: "simkl_key",
      fanart: "fanart_key",
    })
  })

  it("legacy senza marker: esclusa (fail-closed, serve reinserimento)", () => {
    const s = memStorage({ tmdb_key: "old-instance-or-legacy-key" })
    expect(readPersonalDeviceKey(s, "tmdb")).toBeNull()
    expect(isPersonalDeviceKey(s, "tmdb")).toBe(false)
  })

  it("overwrite esterna senza marker: marker stale non valida il nuovo valore", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "tmdb", "first-key-1234567890")).toBe(true)
    // Sovrascrittura che bypassa l'utility (es. vecchio codice, altro tab):
    // il marker resta quello del primo valore e non deve validare il secondo.
    s.setItem("tmdb_key", "second-key-1234567890")
    expect(readPersonalDeviceKey(s, "tmdb")).toBeNull()
  })

  it("marker corrotto o di altra chiave: esclusa", () => {
    const s = memStorage({ tmdb_key: "some-key-1234567890", "tmdb_key:origin": "garbage" })
    expect(readPersonalDeviceKey(s, "tmdb")).toBeNull()
    const cross = memStorage()
    expect(writePersonalDeviceKey(cross, "mdblist", "mdblist-key-1")).toBe(true)
    // Marker di un'altra kind ma valore DIVERSO in questo slot → esclusa.
    cross.setItem("tmdb_key", "other-key-2")
    cross.setItem("tmdb_key:origin", cross.dump()["mdblist_key:origin"]!)
    expect(readPersonalDeviceKey(cross, "tmdb")).toBeNull()
    // Nota: valore+marker copiati INSIEME restano validi per disegno (chi può
    // scrivere entrambi ha già il segreto: nessuna perdita di sicurezza).
  })

  it("reinserimento identico rimarca (stesso valore riscritto resta leggibile)", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "tvdb", "same-key-123")).toBe(true)
    const before = s.dump()["tvdb_key:origin"]
    expect(writePersonalDeviceKey(s, "tvdb", "same-key-123")).toBe(true)
    expect(s.dump()["tvdb_key:origin"]).toBe(before)
    expect(readPersonalDeviceKey(s, "tvdb")).toBe("same-key-123")
  })

  it("stringa vuota = clear esplicito (chiave + marker rimossi)", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "simkl", "simkl-key-1")).toBe(true)
    expect(writePersonalDeviceKey(s, "simkl", "   ")).toBe(true)
    expect(s.dump()).toEqual({})
    expect(readPersonalDeviceKey(s, "simkl")).toBeNull()
  })

  it("valori non validi rifiutati senza toccare lo storage", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "tmdb", "x".repeat(257))).toBe(false)
    expect(writePersonalDeviceKey(s, "tmdb", "has space inside")).toBe(false)
    expect(s.dump()).toEqual({})
  })

  it("clear rimuove chiave + marker", () => {
    const s = memStorage()
    expect(writePersonalDeviceKey(s, "fanart", "fanart-key-1")).toBe(true)
    clearDeviceKey(s, "fanart")
    expect(s.dump()).toEqual({})
    expect(readPersonalDeviceKey(s, "fanart")).toBeNull()
  })

  it("storage rotto: mai lanciare, esito negativo", () => {
    const broken: DeviceKeyStorage = {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
      removeItem: () => {
        throw new Error("denied")
      },
    }
    expect(writePersonalDeviceKey(broken, "tmdb", "k-1234567890")).toBe(false)
    expect(readPersonalDeviceKey(broken, "tmdb")).toBeNull()
    expect(isPersonalDeviceKey(broken, "tmdb")).toBe(false)
    expect(() => clearDeviceKey(broken, "tmdb")).not.toThrow()
  })

  it("marker write failure (quota) preserves the pre-existing key+marker", () => {
    const seed = memStorage()
    expect(writePersonalDeviceKey(seed, "tmdb", "old-key-1")).toBe(true)
    const snapshot = seed.dump()
    // Storage hitting quota on marker writes only: key write succeeds, marker fails.
    const live: Record<string, string> = { ...snapshot }
    const quota: DeviceKeyStorage = {
      getItem: (k: string) => live[k] ?? null,
      setItem: (k: string, v: string) => {
        if (k.endsWith(":origin")) throw new Error("quota exceeded")
        live[k] = v
      },
      removeItem: (k: string) => {
        delete live[k]
      },
    }
    expect(writePersonalDeviceKey(quota, "tmdb", "new-key-2")).toBe(false)
    // Pre-existing value AND marker restored, never dropped.
    expect(live["tmdb_key"]).toBe("old-key-1")
    expect(live["tmdb_key:origin"]).toBe(snapshot["tmdb_key:origin"])
    expect(readPersonalDeviceKey(quota, "tmdb")).toBe("old-key-1")
  })

  it("marker write failure with no pre-existing key leaves nothing behind", () => {
    const live: Record<string, string> = {}
    const quota: DeviceKeyStorage = {
      getItem: (k: string) => live[k] ?? null,
      setItem: (k: string, v: string) => {
        if (k.endsWith(":origin")) throw new Error("quota exceeded")
        live[k] = v
      },
      removeItem: (k: string) => {
        delete live[k]
      },
    }
    expect(writePersonalDeviceKey(quota, "tmdb", "new-key-2")).toBe(false)
    expect(live).toEqual({})
  })
})
