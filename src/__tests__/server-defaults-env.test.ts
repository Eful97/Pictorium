import { afterEach, describe, expect, it, vi } from "vitest"

// Store KV in-memory: valida il cablaggio server-defaults -> kv.ts ->
// @vercel/kv senza rete. Attivo solo con KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

// ENV_DEFAULTS è letto a module-load (vedi best-fit-config.test.ts): reset + reimport.
// POSTERIUM_DATA_DIR punta a una dir vuota così getServerDefaults non legge il
// defaults.json reale del repo (che vincerebbe sull'env per design).
const EMPTY_DIR = "__empty_defaults_dir__"
async function importDefaults() {
  vi.resetModules()
  process.env.POSTERIUM_DATA_DIR = EMPTY_DIR
  return import("@/lib/server-defaults")
}

describe("server-defaults — ENV_DEFAULTS (default di stile d'istanza)", () => {
  afterEach(() => {
    for (const name of [
      "POSTERIUM_GLOBAL_BADGES", "POSTERIUM_RANKING_BADGES", "POSTERIUM_BADGE_GENRE",
      "POSTERIUM_BADGE_YEAR", "POSTERIUM_BADGE_RATING", "POSTERIUM_BLUR_ENABLED",
      "POSTERIUM_NETWORK_LOGO", "POSTERIUM_AUTO_ROTATE_CLEAN", "POSTERIUM_LOGO_FIT_ENABLED",
      "POSTERIUM_BADGE_STYLE", "POSTERIUM_RANKING_BADGE_STYLE", "POSTERIUM_RIBBON_SIDE",
      "POSTERIUM_BLUR_INTENSITY", "POSTERIUM_BLUR_FADE", "POSTERIUM_BLUR_DARKNESS",
      "POSTERIUM_GRADIENT_HEIGHT", "POSTERIUM_DATA_DIR",
      "KV_REST_API_URL", "KV_REST_API_TOKEN",
    ]) {
      delete process.env[name]
    }
    kvStore.clear()
    vi.resetModules()
  })

  it("getServerDefaults ritorna i valori da env quando non ci sono salvati", async () => {
    process.env.POSTERIUM_GLOBAL_BADGES = "0"
    process.env.POSTERIUM_RANKING_BADGES = "0"
    process.env.POSTERIUM_BADGE_GENRE = "0"
    process.env.POSTERIUM_BADGE_YEAR = "0"
    process.env.POSTERIUM_NETWORK_LOGO = "0"
    process.env.POSTERIUM_BLUR_INTENSITY = "8"

    const { getServerDefaults } = await importDefaults()
    const sd = getServerDefaults()

    expect(sd.globalBadges).toBe(false)
    expect(sd.rankingBadges).toBe(false)
    expect(sd.badgeGenre).toBe(false)
    expect(sd.badgeYear).toBe(false)
    expect(sd.networkLogo).toBe(false)
    expect(sd.blurIntensity).toBe(8)
  })

  it("valori on/true/1 sono riconosciuti", async () => {
    process.env.POSTERIUM_GLOBAL_BADGES = "true"
    process.env.POSTERIUM_BADGE_YEAR = "1"
    const { getServerDefaults } = await importDefaults()
    const sd = getServerDefaults()
    expect(sd.globalBadges).toBe(true)
    expect(sd.badgeYear).toBe(true)
  })

  it("valori non validi vengono ignorati (nessun campo forzato)", async () => {
    process.env.POSTERIUM_BADGE_STYLE = "not-a-real-style"
    process.env.POSTERIUM_RIBBON_SIDE = "up"
    process.env.POSTERIUM_BLUR_INTENSITY = "abc"
    const { getServerDefaults } = await importDefaults()
    const sd = getServerDefaults()
    expect(sd.badgeStyle).toBeUndefined()
    expect(sd.ribbonSide).toBeUndefined()
    expect(sd.blurIntensity).toBeUndefined()
  })

  it("senza env il risultato è vuoto (comportamento di default)", async () => {
    const { getServerDefaults } = await importDefaults()
    expect(getServerDefaults()).toEqual({})
  })

  it("user defaults: set/get round-trip sulla KV condivisa tra istanze", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const userId = "33333333-3333-4333-8333-333333333333"
    const mod = await importDefaults()
    await mod.setServerDefaultsForUser(userId, { badgeGenre: false })
    expect(await mod.getStoredUserDefaults(userId)).toEqual({ badgeGenre: false })

    // Altra istanza (modulo ricaricato, cache vuota): legge dalla KV condivisa.
    const reloaded = await importDefaults()
    expect(await reloaded.getStoredUserDefaults(userId)).toEqual({ badgeGenre: false })
  })
})
