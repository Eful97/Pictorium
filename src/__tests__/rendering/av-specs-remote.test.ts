import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { lookupAVSpecsServer, refreshAVSpecsNow, __resetAVSpecsRemoteForTests } from "@/lib/av-specs-remote"
import { lookupAVSpecs } from "@/lib/av-specs"

function snapshot(count: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 1; i <= count; i++) out[`tt${9000000 + i}`] = { quality: "4K", formats: ["hdr"] }
  return { ...out, ...overrides }
}

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal("fetch", fn)
  return fn
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init })

describe("av-specs remote loader", () => {
  beforeEach(() => __resetAVSpecsRemoteForTests())
  afterEach(() => vi.unstubAllGlobals())

  it("falls back to the bundled seed before any remote load", () => {
    mockFetch(() => new Promise(() => {}))
    expect(lookupAVSpecsServer("tt15239678")).toEqual(lookupAVSpecs("tt15239678"))
    expect(lookupAVSpecsServer("tt0000000")).toBeNull()
    expect(lookupAVSpecsServer(null)).toBeNull()
  })

  it("remote entries win over the seed; absent ids keep the seed", async () => {
    mockFetch(async () => json(snapshot(120, { tt15239678: { quality: "FHD", formats: ["atmos"] } })))
    expect(await refreshAVSpecsNow()).toBe(true)
    expect(lookupAVSpecsServer("tt15239678")).toEqual({ quality: "FHD", formats: ["atmos"] })
    expect(lookupAVSpecsServer("tt9000001")).toEqual({ quality: "4K", formats: ["hdr"] })
    expect(lookupAVSpecsServer("tt0816692")).toEqual(lookupAVSpecs("tt0816692"))
  })

  it("drops invalid entries and unknown formats", async () => {
    mockFetch(async () => json(snapshot(120, {
      tt8000001: { quality: "8K", formats: ["hdr", "bogus"] },
      tt8000002: { quality: "4K", formats: ["nope"] },
      bad_id: { quality: "4K" },
    })))
    await refreshAVSpecsNow()
    expect(lookupAVSpecsServer("tt8000001")).toEqual({ formats: ["hdr"] })
    expect(lookupAVSpecsServer("tt8000002")).toEqual({ quality: "4K" })
    expect(lookupAVSpecsServer("bad_id")).toBeNull()
  })

  it("fail-closed: too few entries, bad status, bad JSON keep the previous index", async () => {
    mockFetch(async () => json(snapshot(120)))
    await refreshAVSpecsNow()
    for (const bad of [
      () => json(snapshot(5)),
      () => new Response("x", { status: 500 }),
      () => new Response("not json", { status: 200 }),
      () => json([1, 2, 3]),
    ]) {
      mockFetch(async () => bad())
      expect(await refreshAVSpecsNow()).toBe(false)
      expect(lookupAVSpecsServer("tt9000001")).toEqual({ quality: "4K", formats: ["hdr"] })
    }
  })

  it("network error never throws", async () => {
    mockFetch(async () => { throw new Error("down") })
    expect(await refreshAVSpecsNow()).toBe(false)
  })
})
