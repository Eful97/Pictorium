import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { closeKvClient } from "@/lib/kv"
import {
  __resetCircuitBreaker,
  __resetWikidataNegativeForTest,
  __resetWikidataRestBreakerForTest,
  fetchAllWikidata,
} from "@/lib/awards"
import { cacheClear } from "@/lib/cache"
import {
  getPersistedWikidata,
  setPersistedWikidata,
} from "@/lib/wikidata-cache"

const DAY_MS = 24 * 60 * 60 * 1000
const tmpDirs: string[] = []

function testTmpBase(): string {
  try {
    const scoped = path.join(os.tmpdir(), "opencode")
    if (fs.existsSync(scoped)) return scoped
  } catch {
    // fall through
  }
  return os.tmpdir()
}

async function freshDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(testTmpBase(), "pictorium-wdint-"))
  tmpDirs.push(dir)
  return dir
}

function stubFileMode(dir: string): void {
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
}

function sparqlOk(bindings: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("sparql")) {
      return new Response(JSON.stringify({ results: { bindings } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function restOk() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    const params = new URL(url).searchParams
    if (url.includes("w/api.php") && (params.get("props") || "").includes("claims")) {
      return new Response(
        JSON.stringify({
          entities: {
            Q12345: { claims: { P166: [{ mainsnak: { datavalue: { value: { id: "Q109487" } } } }] } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url.includes("w/api.php") && (params.get("props") || "").includes("labels")) {
      return new Response(
        JSON.stringify({ entities: { Q109487: { labels: { en: { value: "Academy Award for Best Picture" } } } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (url.includes("sparql")) {
      return new Response(JSON.stringify({ results: { bindings: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

async function flushPersist(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

afterAll(async () => {
  await closeKvClient()
  vi.unstubAllEnvs()
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

describe("fetchAllWikidata persistent integration (7d fresh / 30d stale)", () => {
  beforeEach(async () => {
    stubFileMode(await freshDir())
    cacheClear()
    __resetCircuitBreaker()
    __resetWikidataRestBreakerForTest()
    __resetWikidataNegativeForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("restart: disk fresh served with no network and shared repopulated", async () => {
    expect(await setPersistedWikidata(7101, "movie", {
      awards: ["Oscar"],
      nominations: [],
      studios: [],
      director: null,
      degraded: false,
    })).toBe(true)
    cacheClear() // simulate process restart (L1 empty, disk survives)
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"))
    const res = await fetchAllWikidata(7101, "movie")
    expect(res).toEqual({ awards: ["Oscar"], nominations: [], studios: [], director: null, degraded: false })
    expect(spy).not.toHaveBeenCalled()
    // Shared L1 repopulated with remaining lifetime: second call also network-free.
    const second = await fetchAllWikidata(7101, "movie")
    expect(second.degraded).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    // Persisted timestamp untouched (no retention reset on read).
    const before = await getPersistedWikidata(7101, "movie")
    await fetchAllWikidata(7101, "movie")
    const after = await getPersistedWikidata(7101, "movie")
    expect(after?.fetchedAt).toBe(before?.fetchedAt)
  })

  it("aged >7d refetches upstream and refreshes the persisted record", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7102.json")
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const oldAt = Date.now() - 10 * DAY_MS
    await fsp.writeFile(
      file,
      JSON.stringify({
        v: 1,
        tmdbId: 7102,
        mediaType: "movie",
        fetchedAt: oldAt,
        payload: { awards: [], nominations: [], studios: [], director: null },
      }),
    )
    const spy = sparqlOk([{ awardLabel: { value: "Academy Award", type: "literal" } }])
    const res = await fetchAllWikidata(7102, "movie")
    expect(res.awards).toEqual(["Oscar"])
    expect(res.degraded).toBe(false)
    expect(spy.mock.calls.some((c) => String(c[0]).includes("sparql"))).toBe(true)
    await flushPersist()
    const persisted = await getPersistedWikidata(7102, "movie")
    expect(persisted?.status).toBe("fresh")
    expect(persisted?.payload.awards).toEqual(["Oscar"])
    expect((persisted?.fetchedAt ?? 0) > oldAt).toBe(true)
  })

  it("persists a genuine empty upstream success", async () => {
    const spy = sparqlOk([])
    const res = await fetchAllWikidata(7103, "movie")
    expect(res).toEqual({ awards: [], nominations: [], studios: [], director: null, degraded: false })
    expect(spy).toHaveBeenCalled()
    await flushPersist()
    const persisted = await getPersistedWikidata(7103, "movie")
    expect(persisted?.status).toBe("fresh")
    expect(persisted?.payload).toEqual({ awards: [], nominations: [], studios: [], director: null })
  })

  it("upstream error returns stale degraded:true without rewriting it", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7104.json")
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const staleAt = Date.now() - 10 * DAY_MS
    await fsp.writeFile(
      file,
      JSON.stringify({
        v: 1,
        tmdbId: 7104,
        mediaType: "movie",
        fetchedAt: staleAt,
        payload: { awards: ["Oscar"], nominations: [], studios: [], director: null },
      }),
    )
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sparql down"))
    const res = await fetchAllWikidata(7104, "movie")
    expect(res).toEqual({ awards: ["Oscar"], nominations: [], studios: [], director: null, degraded: true })
    const persisted = await getPersistedWikidata(7104, "movie")
    expect(persisted?.status).toBe("stale")
    expect(persisted?.fetchedAt).toBe(staleAt)
    expect(persisted?.payload.awards).toEqual(["Oscar"])
  })

  it("expired >30d is ignored (empty degraded, no stale leak)", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7105.json")
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(
      file,
      JSON.stringify({
        v: 1,
        tmdbId: 7105,
        mediaType: "movie",
        fetchedAt: Date.now() - 31 * DAY_MS,
        payload: { awards: ["Oscar"], nominations: [], studios: [], director: null },
      }),
    )
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"))
    const res = await fetchAllWikidata(7105, "movie")
    expect(res).toEqual({ awards: [], nominations: [], studios: [], director: null, degraded: true })
  })

  it("negative hit returns stale with no new upstream", async () => {
    expect(await setPersistedWikidata(7106, "movie", {
      awards: ["Cannes"],
      nominations: [],
      studios: [],
      director: null,
      degraded: false,
    })).toBe(true)
    // Age the record into the stale window via direct file rewrite.
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7106.json")
    const raw = JSON.parse(await fsp.readFile(file, "utf-8")) as { fetchedAt: number } & Record<string, unknown>
    raw.fetchedAt = Date.now() - 10 * DAY_MS
    await fsp.writeFile(file, JSON.stringify(raw))
    cacheClear()

    const fail = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sparql down"))
    const first = await fetchAllWikidata(7106, "movie")
    expect(first).toEqual({ awards: ["Cannes"], nominations: [], studios: [], director: null, degraded: true })
    const sparqlCalls = fail.mock.calls.filter((c) => String(c[0]).includes("sparql")).length
    expect(sparqlCalls).toBeLessThanOrEqual(2)
    fail.mockClear()
    // Negative window (60s) now suppresses upstream; stale still served.
    fail.mockRejectedValue(new Error("must not be called"))
    const second = await fetchAllWikidata(7106, "movie")
    // L1 shared holds the stale? No — stale is never cached, so this goes
    // through the negative path with the retained snapshot, still no upstream.
    expect(second.awards).toEqual(["Cannes"])
    expect(second.degraded).toBe(true)
    expect(fail).not.toHaveBeenCalled()
  })

  it("REST success persists and REST failure falls back to SPARQL", async () => {
    const calls = restOk()
    const res = await fetchAllWikidata(7107, "movie", undefined, { wikidataId: "Q12345" })
    expect(res.awards).toEqual(["Oscar"])
    expect(res.degraded).toBe(false)
    expect(calls.mock.calls.some((c) => String(c[0]).includes("sparql"))).toBe(false)
    await flushPersist()
    expect((await getPersistedWikidata(7107, "movie"))?.payload.awards).toEqual(["Oscar"])

    // REST failure → SPARQL fallback preserved.
    cacheClear()
    __resetCircuitBreaker()
    __resetWikidataRestBreakerForTest()
    __resetWikidataNegativeForTest()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("w/api.php")) {
        return new Response("err", { status: 500 })
      }
      if (url.includes("sparql")) {
        return new Response(JSON.stringify({ results: { bindings: [{ awardLabel: { value: "Cannes Film Festival", type: "literal" } }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    const res2 = await fetchAllWikidata(7108, "movie", undefined, { wikidataId: "Q12345" })
    expect(res2.awards).toEqual(["Cannes"])
    expect(res2.degraded).toBe(false)
  })

  it("shared repopulation keeps remaining lifetime (no 7d sliding reset)", async () => {
    const now = Date.now()
    expect(await setPersistedWikidata(7109, "movie", {
      awards: ["Oscar"],
      nominations: [],
      studios: [],
      director: null,
      degraded: false,
    })).toBe(true)
    // Backdate to 6d old (remaining ~1d).
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7109.json")
    const raw = JSON.parse(await fsp.readFile(file, "utf-8")) as { fetchedAt: number } & Record<string, unknown>
    raw.fetchedAt = now - 6 * DAY_MS
    await fsp.writeFile(file, JSON.stringify(raw))
    cacheClear()

    const noNet = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network expected"))
    expect((await fetchAllWikidata(7109, "movie")).degraded).toBe(false)
    expect(noNet).not.toHaveBeenCalled()

    // +2d (age 8d > 7d fresh): the shared entry must be expired → upstream refetch.
    const later = now + 2 * DAY_MS
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(later)
    try {
      noNet.mockRestore()
      const up = sparqlOk([{ awardLabel: { value: "Academy Award", type: "literal" } }])
      const res = await fetchAllWikidata(7109, "movie")
      expect(up.mock.calls.some((c) => String(c[0]).includes("sparql"))).toBe(true)
      expect(res.degraded).toBe(false)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it("aborted caller gets stale fallback with no outbound call", async () => {
    expect(await setPersistedWikidata(7110, "movie", {
      awards: ["BAFTA"],
      nominations: [],
      studios: [],
      director: null,
      degraded: false,
    })).toBe(true)
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = path.join(dir, "wikidata", "wikidata-v1-movie-7110.json")
    const raw = JSON.parse(await fsp.readFile(file, "utf-8")) as { fetchedAt: number } & Record<string, unknown>
    raw.fetchedAt = Date.now() - 10 * DAY_MS
    await fsp.writeFile(file, JSON.stringify(raw))
    cacheClear()

    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"))
    const ctrl = new AbortController()
    ctrl.abort()
    const res = await fetchAllWikidata(7110, "movie", ctrl.signal)
    expect(res).toEqual({ awards: ["BAFTA"], nominations: [], studios: [], director: null, degraded: true })
    expect(spy).not.toHaveBeenCalled()
  })
})
