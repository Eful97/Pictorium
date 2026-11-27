import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { lookupAVSpecsServer, refreshAVSpecsNow, __resetAVSpecsRemoteForTests } from "@/lib/av-specs-remote"
import { lookupBundledAVSpecs as lookupAVSpecs } from "@/lib/av-specs-remote"
import seedData from "@/data/av-specs.json"

// Above the 75%-of-seed shrink guard.
const BIG = Math.ceil(Object.keys(seedData).length * 0.75) + 5

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
    mockFetch(async () => json(snapshot(BIG, { tt15239678: { quality: "FHD", formats: ["atmos"] } })))
    expect(await refreshAVSpecsNow()).toBe(true)
    expect(lookupAVSpecsServer("tt15239678")).toEqual({ quality: "FHD", formats: ["atmos"] })
    expect(lookupAVSpecsServer("tt9000001")).toEqual({ quality: "4K", formats: ["hdr"] })
    expect(lookupAVSpecsServer("tt0816692")).toEqual(lookupAVSpecs("tt0816692"))
  })

  it("drops invalid entries and unknown formats", async () => {
    mockFetch(async () => json(snapshot(BIG, {
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
    mockFetch(async () => json(snapshot(BIG)))
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

  it("rejects a snapshot that shrinks below 75% of the active data", async () => {
    mockFetch(async () => json(snapshot(BIG + 100)))
    expect(await refreshAVSpecsNow()).toBe(true)
    mockFetch(async () => json(snapshot(Math.floor((BIG + 100) * 0.7))))
    expect(await refreshAVSpecsNow()).toBe(false)
    expect(lookupAVSpecsServer("tt9000001")).toEqual({ quality: "4K", formats: ["hdr"] })
  })

  it("rejects a first load far smaller than the seed", async () => {
    mockFetch(async () => json(snapshot(150)))
    expect(await refreshAVSpecsNow()).toBe(false)
  })

  it("network error never throws", async () => {
    mockFetch(async () => { throw new Error("down") })
    expect(await refreshAVSpecsNow()).toBe(false)
  })
})

describe("av-specs epoch", () => {
  beforeEach(() => __resetAVSpecsRemoteForTests())
  afterEach(() => vi.unstubAllGlobals())

  it("is null before a load, a stable content hash after, and changes with the data", async () => {
    const { avSpecsEpoch } = await import("@/lib/av-specs-remote")
    expect(avSpecsEpoch()).toBeNull()
    mockFetch(async () => json(snapshot(BIG)))
    await refreshAVSpecsNow()
    const first = avSpecsEpoch()
    expect(first).toMatch(/^[0-9a-f]{8}$/)
    await refreshAVSpecsNow()
    expect(avSpecsEpoch()).toBe(first)
    mockFetch(async () => json(snapshot(BIG + 1)))
    await refreshAVSpecsNow()
    expect(avSpecsEpoch()).not.toBe(first)
  })

  it("keeps the previous epoch only after the data changed", async () => {
    const { avSpecsEpoch, avSpecsPrevEpoch } = await import("@/lib/av-specs-remote")
    mockFetch(async () => json(snapshot(BIG)))
    await refreshAVSpecsNow()
    const first = avSpecsEpoch()
    expect(avSpecsPrevEpoch()).toBeNull()
    await refreshAVSpecsNow()
    expect(avSpecsPrevEpoch()).toBeNull()
    mockFetch(async () => json(snapshot(BIG + 1)))
    await refreshAVSpecsNow()
    expect(avSpecsPrevEpoch()).toBe(first)
  })
})
