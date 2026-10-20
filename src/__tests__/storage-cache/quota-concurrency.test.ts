// Quota-concurrency race tests: per-user KV quota check-then-write races.
// Each test pre-fills the backend to max-1, then races TWO different inserts
// from two "instances" against the REAL store code (no production internals
// mocked — only the `ioredis` network backend is an in-memory fake, shared
// across module instances exactly like a shared Redis would be).
//
// A deterministic barrier holds the quota-decision read of BOTH racers until
// both have arrived, so both check against the same pre-write snapshot —
// this models two serverless instances hitting Redis concurrently, which no
// in-process queue can serialize (the file backend's withFileLock /
// enqueueUserWrite only serializes ONE process).
//
// Desired invariant (asserted): exactly one insert succeeds, the other is
// rejected with the quota error (→ HTTP 413 per the route contract), and the
// stored count never exceeds max.
//
// Status: all 3 races are FIXED and GREEN — mapping upsert / mapping import /
// alias setImdbAlias (atomic hash EVALs, Q2b2). The barrier below only gates
// the legacy check-read path; fixed paths decide inside a single EVAL, so a
// stale armed barrier never gates them — racers still interleave
// deterministically through the shared fake backend and exactly one writer
// wins.
//
// Env: stubbed per test, originals restored EXACTLY in afterEach. No real
// Redis/KV/network/credentials anywhere in this file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// In-memory ioredis fake (shared backend state, like a real shared Redis).
// Includes a one-shot check-read barrier for deterministic interleaving.
// ---------------------------------------------------------------------------
const fakeState = vi.hoisted(() => ({
  strings: new Map<string, string>(),
  sets: new Map<string, Set<string>>(),
  zsets: new Map<string, Map<string, number>>(),
  hashes: new Map<string, Map<string, string>>(),
  barrier: null as null | {
    key: string
    needed: number
    arrived: number
    release: () => void
    gate: Promise<void>
  },
}))

/** Hold the next `needed` reads of `key` until all have arrived. */
function armCheckBarrier(key: string, needed: number): void {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  fakeState.barrier = { key, needed, arrived: 0, release, gate }
}

function disarmBarrier(): void {
  fakeState.barrier = null
}

vi.mock("ioredis", () => {
  // NOTE: this factory may ONLY touch `fakeState` (vi.hoisted). Referring to
  // any other top-level binding breaks Vitest mock isolation and falls back
  // to the real ioredis (live connection attempts) — hence the barrier logic
  // is inlined here instead of calling the file-level helper.
  async function factoryBarrier(key: string): Promise<void> {
    const b = fakeState.barrier
    if (!b || b.key !== key) return
    b.arrived += 1
    if (b.arrived >= b.needed) b.release()
    else await b.gate
  }
  class FakeRedis {
    constructor(
      _url: string,
      _opts: unknown,
    ) {}
    async get(key: string): Promise<string | null> {
      return fakeState.strings.get(key) ?? null
    }
    async set(key: string, value: string, ..._args: unknown[]): Promise<string> {
      fakeState.strings.set(key, value)
      return "OK"
    }
    /**
     * Modeled Lua execution: the whole check-then-write transition runs
     * synchronously (no await between check and write), so concurrent evals
     * cannot interleave — exactly the atomicity a real Redis EVAL provides.
     * This models the engine, it is not the engine; only the known
     * preset-save / mapping-upsert / mapping-import / alias-set scripts are
     * accepted (anything else throws).
     */
    async eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown> {
      const keys = keysAndArgs.slice(0, numKeys)
      const args = keysAndArgs.slice(numKeys)
      const hasAs = (m: Map<string, unknown>, k: string): boolean => m.has(k)
      const hashOf = (k: string): Map<string, string> => {
        let h = fakeState.hashes.get(k)
        if (!h) {
          h = new Map()
          fakeState.hashes.set(k, h)
        }
        return h
      }
      const isHashKey = (k: string): boolean =>
        !hasAs(fakeState.strings, k) &&
        !hasAs(fakeState.sets as Map<string, unknown>, k) &&
        !hasAs(fakeState.zsets as Map<string, unknown>, k)
      if (script.includes("pictorium:preset-save:v1")) {
        if (numKeys !== 4) throw new Error("unsupported preset-save args in fake eval")
        if (keys.length !== 4 || args.length !== 5) throw new Error("unsupported preset-save args in fake eval")
        const [presetK, indexK, dlK, createdK] = keys
        const [maxRaw, id, json, pubFlag, createdRaw] = args
        if (
          hasAs(fakeState.strings, indexK) ||
          hasAs(fakeState.zsets as Map<string, unknown>, indexK) ||
          hasAs(fakeState.hashes as Map<string, unknown>, indexK)
        )
          return 3
        if (pubFlag === "1") {
          for (const zk of [dlK, createdK]) {
            if (
              hasAs(fakeState.strings, zk) ||
              hasAs(fakeState.sets as Map<string, unknown>, zk) ||
              hasAs(fakeState.hashes as Map<string, unknown>, zk)
            )
              return 3
          }
        }
        if ((fakeState.sets.get(indexK)?.size ?? 0) >= parseInt(maxRaw, 10)) return 1
        if (fakeState.strings.has(presetK)) return 2
        fakeState.strings.set(presetK, json)
        let set = fakeState.sets.get(indexK)
        if (!set) {
          set = new Set()
          fakeState.sets.set(indexK, set)
        }
        set.add(id)
        if (pubFlag === "1") {
          let dl = fakeState.zsets.get(dlK)
          if (!dl) {
            dl = new Map()
            fakeState.zsets.set(dlK, dl)
          }
          dl.set(id, 0)
          let created = fakeState.zsets.get(createdK)
          if (!created) {
            created = new Map()
            fakeState.zsets.set(createdK, created)
          }
          created.set(id, Number(createdRaw))
        }
        return 0
      }
      if (script.includes("pictorium:mapping-upsert:v1")) {
        if (numKeys !== 1 || keys.length !== 1 || args.length !== 3)
          throw new Error("unsupported mapping-upsert args in fake eval")
        const [hashK] = keys
        const [maxRaw, field, json] = args
        if (!isHashKey(hashK)) return 3
        const h = hashOf(hashK)
        if (h.has(field)) {
          h.set(field, json)
          return 0
        }
        if (h.size >= parseInt(maxRaw, 10)) return 1
        h.set(field, json)
        return 0
      }
      if (script.includes("pictorium:mapping-import:v1")) {
        if (numKeys !== 1 || keys.length !== 1 || args.length < 1 || (args.length - 1) % 2 !== 0)
          throw new Error("unsupported mapping-import args in fake eval")
        const [hashK] = keys
        const maxRaw = args[0]
        if (!isHashKey(hashK)) return 3
        const h = hashOf(hashK)
        let fresh = 0
        for (let i = 1; i < args.length; i += 2) if (!h.has(args[i])) fresh++
        if (h.size + fresh > parseInt(maxRaw, 10)) return 1
        for (let i = 1; i < args.length; i += 2) h.set(args[i], args[i + 1])
        return 0
      }
      if (script.includes("pictorium:alias-set:v1")) {
        if (numKeys !== 2 || keys.length !== 2 || args.length !== 3)
          throw new Error("unsupported alias-set args in fake eval")
        const [aliasK, mapK] = keys
        const [maxRaw, field, json] = args
        if (!isHashKey(aliasK) || !isHashKey(mapK)) return 3
        const ah = hashOf(aliasK)
        const mh = fakeState.hashes.get(mapK)
        if (ah.has(field)) {
          ah.set(field, json)
          return 0
        }
        if (ah.size + (mh?.size ?? 0) >= parseInt(maxRaw, 10)) return 1
        ah.set(field, json)
        return 0
      }
      throw new Error("unsupported script in fake eval")
    }
    async del(key: string): Promise<number> {
      const had =
        fakeState.strings.delete(key) || fakeState.sets.delete(key) || fakeState.hashes.delete(key)
      return had ? 1 : 0
    }
    async hgetall(key: string): Promise<Record<string, string>> {
      await factoryBarrier(key)
      const h = fakeState.hashes.get(key)
      return h ? Object.fromEntries(h) : {}
    }
    async hset(key: string, obj: Record<string, string>): Promise<number> {
      let h = fakeState.hashes.get(key)
      if (!h) {
        h = new Map()
        fakeState.hashes.set(key, h)
      }
      for (const [f, v] of Object.entries(obj)) h.set(f, v)
      return 1
    }
    async hdel(key: string, ...fields: string[]): Promise<number> {
      const h = fakeState.hashes.get(key)
      if (!h) return 0
      let n = 0
      for (const f of fields) if (h.delete(f)) n++
      return n
    }
    async sadd(key: string, ...members: string[]): Promise<number> {
      let set = fakeState.sets.get(key)
      if (!set) {
        set = new Set()
        fakeState.sets.set(key, set)
      }
      let added = 0
      for (const m of members)
        if (!set.has(m)) {
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
      await factoryBarrier(key)
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

// NOTE: redisKv encodes non-strings as JSON on write and JSON-decodes on
// read. The fake above stores raw strings like real ioredis, so the real
// adapter's encode/decode path is exercised end to end.

import { closeKvClient } from "@/lib/kv"
import type { Mapping } from "@/lib/types"

const UUID_A = "11111111-1111-4111-8111-111111111111"

// --- Exact env isolation: capture originals, restore verbatim. ---
const ENV_KEYS = [
  "PICTORIUM_REDIS_URL",
  "POSTERIUM_REDIS_URL",
  "REDIS_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "PICTORIUM_MAX_MAPPINGS_PER_USER",
  "POSTERIUM_MAX_MAPPINGS_PER_USER",
] as const
const originalEnv = new Map<string, string | undefined>()

function rejectionSummary(results: PromiseSettledResult<unknown>[]): string {
  return results
    .map((r) =>
      r.status === "fulfilled"
        ? "fulfilled"
        : `rejected(${r.reason instanceof Error ? `${r.reason.name}: ${r.reason.message}` : String(r.reason)})`,
    )
    .join(", ")
}

function clearFakeBackend(): void {
  fakeState.strings.clear()
  fakeState.sets.clear()
  fakeState.zsets.clear()
  fakeState.hashes.clear()
  disarmBarrier()
}

function forceKvMode(): void {
  process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379"
  delete process.env.POSTERIUM_REDIS_URL
  delete process.env.REDIS_URL
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
}

function makeMapping(id: number, title: string): Mapping {
  return {
    tmdbId: id,
    mediaType: "movie",
    title,
    posterPath: `/p${id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    updatedAt: new Date().toISOString(),
  }
}

beforeEach(() => {
  for (const k of ENV_KEYS) originalEnv.set(k, process.env[k])
  clearFakeBackend()
  forceKvMode()
})

afterEach(async () => {
  disarmBarrier()
  clearFakeBackend()
  for (const k of ENV_KEYS) {
    const v = originalEnv.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  originalEnv.clear()
  vi.resetModules()
  await closeKvClient()
})

describe("quota races: mappings/aliases (Q2b2) atomic EVAL, all GREEN", () => {
  it("mapping upsert: two concurrent inserts at max-1 must not both succeed", async () => {
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "2"
    vi.resetModules()
    // Two module instances = two server instances sharing one Redis.
    const storeA = await import("@/lib/store")
    vi.resetModules()
    const storeB = await import("@/lib/store")

    await storeA.upsert(makeMapping(1, "Seed"), UUID_A)
    const hashKey = `mappings:${UUID_A}`

    armCheckBarrier(hashKey, 2)
    const [r1, r2] = await Promise.allSettled([
      storeA.upsert(makeMapping(2, "Racer A"), UUID_A),
      storeB.upsert(makeMapping(3, "Racer B"), UUID_A),
    ])
    disarmBarrier()

    const ok = [r1, r2].filter((r) => r.status === "fulfilled")
    const ko = [r1, r2].filter((r) => r.status === "rejected")
    const finalCount = (await storeA.getAll(UUID_A)).length

    // FIXED Q2b2: the atomic hash EVAL admits exactly one racer; the hash
    // stays at 2 and the loser gets QuotaExceededError (HTTP 413 at the route).
    expect(
      finalCount,
      `quota overshoot: ${finalCount} mappings stored, max 2 [${rejectionSummary([r1, r2])}]`,
    ).toBeLessThanOrEqual(2)
    expect(ok).toHaveLength(1)
    // Two module instances = two distinct QuotaExceededError classes: the
    // loser is whichever racer ran second, so accept either class but require
    // the quota contract (name + max, → HTTP 413 at the route).
    {
      const reason = (ko[0] as PromiseRejectedResult).reason as Error & { max?: number }
      expect(reason?.name).toBe("QuotaExceededError")
      expect((reason as { max?: number }).max).toBe(2)
      expect(
        reason instanceof storeA.QuotaExceededError || reason instanceof storeB.QuotaExceededError,
      ).toBe(true)
    }
  })

  it("mapping importMappings: two concurrent imports at max-1 must not both succeed", async () => {
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "2"
    vi.resetModules()
    const storeA = await import("@/lib/store")
    vi.resetModules()
    const storeB = await import("@/lib/store")

    await storeA.upsert(makeMapping(1, "Seed"), UUID_A)
    const hashKey = `mappings:${UUID_A}`

    armCheckBarrier(hashKey, 2)
    const [r1, r2] = await Promise.allSettled([
      storeA.importMappings([makeMapping(2, "Import A")], UUID_A),
      storeB.importMappings([makeMapping(3, "Import B")], UUID_A),
    ])
    disarmBarrier()

    const ok = [r1, r2].filter((r) => r.status === "fulfilled")
    const ko = [r1, r2].filter((r) => r.status === "rejected")
    const finalCount = (await storeA.getAll(UUID_A)).length

    // FIXED Q2b2: both imports decide inside ONE atomic EVAL each (fresh
    // fields via HEXISTS), so exactly one import commits and the other gets
    // QuotaExceededError with no partial writes.
    expect(
      finalCount,
      `quota overshoot: ${finalCount} mappings stored, max 2 [${rejectionSummary([r1, r2])}]`,
    ).toBeLessThanOrEqual(2)
    expect(ok).toHaveLength(1)
    {
      const reason = (ko[0] as PromiseRejectedResult).reason as Error & { max?: number }
      expect(reason?.name).toBe("QuotaExceededError")
      expect((reason as { max?: number }).max).toBe(2)
      expect(
        reason instanceof storeA.QuotaExceededError || reason instanceof storeB.QuotaExceededError,
      ).toBe(true)
    }
  })

  it("alias setImdbAlias: two concurrent aliases sharing quota at max-1 must not both succeed", async () => {
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "2"
    vi.resetModules()
    const storeA = await import("@/lib/store")
    vi.resetModules()
    const storeB = await import("@/lib/store")

    // Shared quota: 1 mapping already occupies half of max=2.
    await storeA.upsert(makeMapping(1, "Seed"), UUID_A)
    // Barrier on the legacy quota-decision read path: fixed code decides
    // inside ONE atomic EVAL, so the barrier no longer gates the racers —
    // both evals still race on the shared backend and exactly one wins.
    armCheckBarrier(`mappings:${UUID_A}`, 2)
    const [r1, r2] = await Promise.allSettled([
      storeA.setImdbAlias({ imdbId: "tt10000001", mediaType: "tv", tmdbId: 101 }, UUID_A),
      storeB.setImdbAlias({ imdbId: "tt10000002", mediaType: "tv", tmdbId: 102 }, UUID_A),
    ])
    disarmBarrier()

    const ok = [r1, r2].filter((r) => r.status === "fulfilled")
    const ko = [r1, r2].filter((r) => r.status === "rejected")
    const combined =
      (await storeA.getAll(UUID_A)).length + (await storeA.getAllAliases(UUID_A)).length

    // FIXED Q2b2: both aliases decide inside ONE atomic EVAL each against
    // the combined mappings+aliases count, so exactly one alias commits and
    // the combined usage stays at 2.
    expect(
      combined,
      `quota overshoot: combined mappings+aliases ${combined}, max 2 [${rejectionSummary([r1, r2])}]`,
    ).toBeLessThanOrEqual(2)
    expect(ok).toHaveLength(1)
    {
      const reason = (ko[0] as PromiseRejectedResult).reason as Error & { max?: number }
      expect(reason?.name).toBe("QuotaExceededError")
      expect((reason as { max?: number }).max).toBe(2)
      expect(
        reason instanceof storeA.QuotaExceededError || reason instanceof storeB.QuotaExceededError,
      ).toBe(true)
    }
  })
})
