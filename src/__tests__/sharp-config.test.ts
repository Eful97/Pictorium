import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

async function initWithEnv(env: Record<string, string | undefined>): Promise<void> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "")
    else vi.stubEnv(k, v)
  }
  vi.resetModules()
  const { initSharp, __resetSharpInit } = await import("@/lib/sharp-config")
  __resetSharpInit()
  initSharp()
}

beforeEach(() => {
  vi.stubEnv("SHARP_CONCURRENCY", "")
  vi.stubEnv("SHARP_CACHE_MEMORY_MB", "")
  vi.stubEnv("SHARP_CACHE_ITEMS", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("initSharp (D3)", () => {
  it("applies conservative defaults without env (not libvips core-count)", async () => {
    await initWithEnv({})
    expect(sharp.concurrency()).toBe(2)
    expect(sharp.cache()).toMatchObject({ memory: expect.objectContaining({ max: 32 }), items: expect.objectContaining({ max: 50 }) })
  })

  it("honours explicit env values (docker/compose path)", async () => {
    await initWithEnv({ SHARP_CONCURRENCY: "2", SHARP_CACHE_MEMORY_MB: "64", SHARP_CACHE_ITEMS: "70" })
    expect(sharp.concurrency()).toBe(2)
    expect(sharp.cache()).toMatchObject({ memory: expect.objectContaining({ max: 64 }), items: expect.objectContaining({ max: 70 }) })
  })

  it("falls back to defaults on invalid env", async () => {
    await initWithEnv({ SHARP_CONCURRENCY: "abc", SHARP_CACHE_MEMORY_MB: "-5" })
    expect(sharp.concurrency()).toBe(2)
    expect(sharp.cache()).toMatchObject({ memory: expect.objectContaining({ max: 32 }) })
  })
})
