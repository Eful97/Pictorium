import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

// Store KV in-memory: valida il cablaggio catalog-epoch -> kv.ts -> @vercel/kv
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

const originalDataDir = process.env.POSTERIUM_DATA_DIR
let tempDir: string | undefined

async function freshEpochModule() {
  vi.resetModules()
  return import("@/lib/catalog-epoch")
}

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.POSTERIUM_DATA_DIR
  else process.env.POSTERIUM_DATA_DIR = originalDataDir
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("catalog epoch (F3)", () => {
  it("starts at 0, bumps to a new value, and persists across reloads", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-epoch-"))
    process.env.POSTERIUM_DATA_DIR = tempDir

    const mod = await freshEpochModule()
    expect(await mod.getCatalogEpoch()).toBe("0")

    const first = await mod.bumpCatalogEpoch()
    expect(first).not.toBe("0")
    expect(await mod.getCatalogEpoch()).toBe(first)

    const second = await mod.bumpCatalogEpoch()
    expect(second).not.toBe(first)

    // Persistenza: un worker diverso (modulo ricaricato) legge lo stesso valore.
    const reloaded = await freshEpochModule()
    expect(await reloaded.getCatalogEpoch()).toBe(second)
  })

  it("never throws when persistence fails (save must not hard-fail)", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-epoch-"))
    // DATA_DIR punta a un FILE esistente: mkdir/write falliscono sempre.
    const blocker = path.join(tempDir, "blocker")
    await fsp.writeFile(blocker, "x")
    process.env.POSTERIUM_DATA_DIR = blocker

    const mod = await freshEpochModule()
    await expect(mod.bumpCatalogEpoch()).resolves.toBe("0")
    expect(await mod.getCatalogEpoch()).toBe("0")
  })

  it("uses the KV backend when configured (shared across instances)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"

    const mod = await freshEpochModule()
    expect(await mod.getCatalogEpoch()).toBe("0")

    const first = await mod.bumpCatalogEpoch()
    expect(first).not.toBe("0")
    expect(await mod.getCatalogEpoch()).toBe(first)

    // Altra istanza (modulo ricaricato, mem-cache vuota) legge dalla KV condivisa.
    const reloaded = await freshEpochModule()
    expect(await reloaded.getCatalogEpoch()).toBe(first)
  })
})
