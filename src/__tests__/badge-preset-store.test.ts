import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Fake ioredis in-memory con Set + Sorted Set (nessuna rete).
const fakeState = vi.hoisted(() => ({
  strings: new Map<string, string>(),
  sets: new Map<string, Set<string>>(),
  zsets: new Map<string, Map<string, number>>(),
}))

vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(
      _url: string,
      _opts: unknown,
    ) {}
    async get(key: string): Promise<string | null> {
      return fakeState.strings.get(key) ?? null
    }
    async set(key: string, value: string): Promise<string> {
      fakeState.strings.set(key, value)
      return "OK"
    }
    async del(key: string): Promise<number> {
      const hadStr = fakeState.strings.delete(key)
      const hadSet = fakeState.sets.delete(key)
      const hadZ = fakeState.zsets.delete(key)
      return hadStr || hadSet || hadZ ? 1 : 0
    }
    async sadd(key: string, ...members: string[]): Promise<number> {
      let set = fakeState.sets.get(key)
      if (!set) {
        set = new Set()
        fakeState.sets.set(key, set)
      }
      let added = 0
      for (const m of members) if (!set.has(m)) {
        set.add(m)
        added++
      }
      return added
    }
    async srem(key: string, ...members: string[]): Promise<number> {
      const set = fakeState.sets.get(key)
      if (!set) return 0
      let n = 0
      for (const m of members) if (set.delete(m)) n++
      return n
    }
    async smembers(key: string): Promise<string[]> {
      return [...(fakeState.sets.get(key) ?? [])]
    }
    async zadd(key: string, score: number, member: string): Promise<number> {
      let z = fakeState.zsets.get(key)
      if (!z) {
        z = new Map()
        fakeState.zsets.set(key, z)
      }
      const had = z.has(member)
      z.set(member, score)
      return had ? 0 : 1
    }
    async zrem(key: string, ...members: string[]): Promise<number> {
      const z = fakeState.zsets.get(key)
      if (!z) return 0
      let n = 0
      for (const m of members) if (z.delete(m)) n++
      return n
    }
    async zincrby(key: string, increment: number, member: string): Promise<string> {
      let z = fakeState.zsets.get(key)
      if (!z) {
        z = new Map()
        fakeState.zsets.set(key, z)
      }
      const next = (z.get(member) ?? 0) + increment
      z.set(member, next)
      return String(next)
    }
    async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
      const z = fakeState.zsets.get(key)
      if (!z) return []
      return [...z.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(start, stop + 1)
        .map(([m]) => m)
    }
    async zscore(key: string, member: string): Promise<string | null> {
      const v = fakeState.zsets.get(key)?.get(member)
      return v === undefined ? null : String(v)
    }
    async quit(): Promise<string> {
      return "OK"
    }
  }
  return { default: FakeRedis }
})

import { closeKvClient } from "@/lib/kv"
import {
  __resetPresetStoreForTests,
  deletePreset,
  getDownloadCount,
  getPreset,
  getPresetForUser,
  incrementDownload,
  listPublicPresets,
  listUserPresets,
  savePreset,
  updatePreset,
  PresetForbiddenError,
  PresetNotFoundError,
  PresetQuotaError,
  type PresetCreateInput,
} from "@/lib/badge-preset-store"

const design = {
  shape: "pill" as const,
  padding: { x: 12, y: 6 },
  background: { type: "solid" as const, color: "#ff0000", opacity: 90 },
  text: {
    template: "★ {{rating}}",
    color: "#ffffff",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700 as const,
    uppercase: false,
    letterSpacing: 0,
    align: "center" as const,
  },
  scale: 100,
}

function makeInput(overrides?: Partial<PresetCreateInput>): PresetCreateInput {
  return {
    target: "top",
    visibility: "public",
    metadata: { name: `Preset ${Math.random().toString(36).slice(2, 8)}`, tags: ["test"] },
    design: structuredClone(design),
    ...overrides,
  }
}

function clearFakeKv(): void {
  fakeState.strings.clear()
  fakeState.sets.clear()
  fakeState.zsets.clear()
}

async function freshFileDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-presets-"))
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  __resetPresetStoreForTests()
  return dir
}

describe("badge-preset-store (KV backend)", () => {
  beforeEach(() => {
    vi.stubEnv("PICTORIUM_REDIS_URL", "redis://localhost:6379")
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    clearFakeKv()
    __resetPresetStoreForTests()
  })
  afterAll(async () => {
    await closeKvClient()
    vi.unstubAllEnvs()
  })

  it("saves and reads back a preset with zero downloads", async () => {
    const owner = randomUUID()
    const stored = await savePreset(owner, makeInput())
    expect(stored.downloads).toBe(0)
    expect(stored.preset.ownerUuid).toBe(owner)
    expect(stored.preset.revision).toMatch(/^[0-9a-f]{8}$/)
    const reread = await getPreset(stored.preset.id)
    expect(reread?.preset).toEqual(stored.preset)
  })

  it("saves a house preset without a custom design", async () => {
    const owner = randomUUID()
    const stored = await savePreset(
      owner,
      makeInput({
        variant: "house",
        design: undefined,
        house: { style: "pill", showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto" },
      }),
    )
    expect(stored.preset.variant).toBe("house")
    expect(stored.preset.design).toBeUndefined()
    expect(stored.preset.house?.style).toBe("pill")
    const reread = await getPreset(stored.preset.id)
    expect(reread?.preset).toEqual(stored.preset)
  })

  it("rejects a house preset with a style from the other slot", async () => {
    const owner = randomUUID()
    await expect(
      savePreset(
        owner,
        makeInput({
          variant: "house",
          design: undefined,
          house: { style: "bar", scale: 100, polarity: "auto" },
        }),
      ),
    ).rejects.toThrow()
  })

  it("enforces private isolation", async () => {
    const owner = randomUUID()
    const stranger = randomUUID()
    const priv = await savePreset(owner, makeInput({ visibility: "private" }))
    expect(await getPresetForUser(priv.preset.id, owner)).not.toBeNull()
    expect(await getPresetForUser(priv.preset.id, stranger)).toBeNull()
    const pub = await savePreset(owner, makeInput())
    expect(await getPresetForUser(pub.preset.id, stranger)).not.toBeNull()
    // Private presets never leak into the public catalog.
    const page = await listPublicPresets("newest", 100)
    expect(page.items.map((i) => i.preset.id)).not.toContain(priv.preset.id)
  })

  it("enforces the 100-presets quota", async () => {
    const owner = randomUUID()
    for (let i = 0; i < 100; i++) await savePreset(owner, makeInput({ visibility: "private" }))
    await expect(savePreset(owner, makeInput({ visibility: "private" }))).rejects.toBeInstanceOf(PresetQuotaError)
  })

  it("updates only for the owner and recomputes revision", async () => {
    const owner = randomUUID()
    const stranger = randomUUID()
    const stored = await savePreset(owner, makeInput())
    await expect(updatePreset(stranger, stored.preset.id, {})).rejects.toBeInstanceOf(PresetForbiddenError)
    await expect(updatePreset(owner, "AAAAAAAA", {})).rejects.toBeInstanceOf(PresetNotFoundError)
    const updated = await updatePreset(owner, stored.preset.id, {
      design: { ...structuredClone(design), scale: 150 },
    })
    expect(updated.preset.revision).not.toBe(stored.preset.revision)
    expect(updated.preset.design?.scale).toBe(150)
  })

  it("syncs public indices on visibility flip", async () => {
    const owner = randomUUID()
    const stored = await savePreset(owner, makeInput({ visibility: "private" }))
    expect((await listPublicPresets("newest", 100)).items).toHaveLength(0)
    await updatePreset(owner, stored.preset.id, { visibility: "public" })
    expect((await listPublicPresets("newest", 100)).items.map((i) => i.preset.id)).toContain(stored.preset.id)
    await updatePreset(owner, stored.preset.id, { visibility: "private" })
    expect((await listPublicPresets("newest", 100)).items).toHaveLength(0)
  })

  it("deletes presets and cleans indices, forbidding strangers", async () => {
    const owner = randomUUID()
    const stranger = randomUUID()
    const stored = await savePreset(owner, makeInput())
    await expect(deletePreset(stranger, stored.preset.id)).rejects.toBeInstanceOf(PresetForbiddenError)
    expect(await deletePreset(owner, stored.preset.id)).toBe(true)
    expect(await deletePreset(owner, stored.preset.id)).toBe(false)
    expect(await getPreset(stored.preset.id)).toBeNull()
    expect(await listUserPresets(owner)).toHaveLength(0)
  })

  it("ranks public presets by downloads and paginates", async () => {
    const owner = randomUUID()
    const a = await savePreset(owner, makeInput({ metadata: { name: "A", tags: [] } }))
    const b = await savePreset(owner, makeInput({ metadata: { name: "B", tags: [] } }))
    const c = await savePreset(owner, makeInput({ metadata: { name: "C", tags: [] } }))
    await incrementDownload(b.preset.id, "ip1")
    await incrementDownload(b.preset.id, "ip2")
    await incrementDownload(c.preset.id, "ip1")
    const ranked = await listPublicPresets("downloads", 10)
    expect(ranked.items.map((i) => i.preset.metadata.name)).toEqual(["B", "C", "A"])
    expect(ranked.items[0].downloads).toBe(2)
    const p1 = await listPublicPresets("downloads", 2)
    expect(p1.items).toHaveLength(2)
    expect(p1.nextCursor).toBe(2)
    const p2 = await listPublicPresets("downloads", 2, p1.nextCursor!)
    expect(p2.items.map((i) => i.preset.metadata.name)).toEqual(["A"])
    expect(p2.nextCursor).toBeNull()
    // Newest sort returns all three.
    expect((await listPublicPresets("newest", 10)).items).toHaveLength(3)
    void a
  })

  it("counts one download per ip per 24h and never self-downloads", async () => {
    const owner = randomUUID()
    const stored = await savePreset(owner, makeInput())
    expect(await incrementDownload(stored.preset.id, "ip1", { isOwner: true })).toBe(0)
    expect(await incrementDownload(stored.preset.id, "ip1")).toBe(1)
    expect(await incrementDownload(stored.preset.id, "ip1")).toBe(1)
    expect(await incrementDownload(stored.preset.id, "ip2")).toBe(2)
    expect(await getDownloadCount(stored.preset.id)).toBe(2)
    const priv = await savePreset(owner, makeInput({ visibility: "private" }))
    expect(await incrementDownload(priv.preset.id, "ip9")).toBe(0)
  })

  it("fail-opens on invalid ids", async () => {
    expect(await getPreset("nope")).toBeNull()
    expect(await getPresetForUser("nope", randomUUID())).toBeNull()
    expect(await getDownloadCount("nope")).toBe(0)
    expect(await incrementDownload("nope", "ip1")).toBe(0)
  })
})

describe("badge-preset-store (filesystem backend)", () => {
  beforeEach(async () => {
    vi.stubEnv("PICTORIUM_REDIS_URL", "")
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    clearFakeKv()
    await freshFileDir()
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("saves, reads, isolates, updates and deletes", async () => {
    const owner = randomUUID()
    const stranger = randomUUID()
    const pub = await savePreset(owner, makeInput())
    const priv = await savePreset(owner, makeInput({ visibility: "private" }))
    expect((await getPreset(pub.preset.id))?.preset).toEqual(pub.preset)
    expect(await getPresetForUser(priv.preset.id, stranger)).toBeNull()
    expect(await getPresetForUser(priv.preset.id, owner)).not.toBeNull()
    const mine = await listUserPresets(owner)
    expect(mine).toHaveLength(2)
    expect(mine[0].preset.updatedAt).toBeGreaterThanOrEqual(mine[1].preset.updatedAt)
    const updated = await updatePreset(owner, pub.preset.id, { visibility: "private" })
    expect(updated.preset.visibility).toBe("private")
    expect((await listPublicPresets("newest", 10)).items).toHaveLength(0)
    await expect(deletePreset(stranger, pub.preset.id)).rejects.toBeInstanceOf(PresetForbiddenError)
    expect(await deletePreset(owner, pub.preset.id)).toBe(true)
    expect(await getPreset(pub.preset.id)).toBeNull()
  })

  it("persists across cache resets and ranks by downloads", async () => {
    const owner = randomUUID()
    const a = await savePreset(owner, makeInput({ metadata: { name: "A", tags: [] } }))
    const b = await savePreset(owner, makeInput({ metadata: { name: "B", tags: [] } }))
    __resetPresetStoreForTests()
    expect((await getPreset(a.preset.id))?.preset.id).toBe(a.preset.id)
    await incrementDownload(b.preset.id, "ip1")
    await incrementDownload(b.preset.id, "ip1b")
    await incrementDownload(a.preset.id, "ip2")
    const ranked = await listPublicPresets("downloads", 10)
    expect(ranked.items.map((i) => i.preset.metadata.name)).toEqual(["B", "A"])
    expect(ranked.items[0].downloads).toBe(2)
  })

  it("enforces the 100-presets quota", async () => {
    const owner = randomUUID()
    for (let i = 0; i < 100; i++) await savePreset(owner, makeInput({ visibility: "private" }))
    await expect(savePreset(owner, makeInput({ visibility: "private" }))).rejects.toBeInstanceOf(PresetQuotaError)
  })
})
