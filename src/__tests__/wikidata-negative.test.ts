import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { __resetCircuitBreaker, __resetWikidataNegativeForTest, fetchAllWikidata } from "@/lib/awards"
import { cacheClear } from "@/lib/cache"

const tmpDirs: string[] = []

/** Isolate the durable wikidata layer: per-test DATA_DIR in file mode, so the
 *  fire-and-forget persist never touches the repo ./data (cross-suite
 *  pollution) nor a real KV backend. */
async function stubDurableIsolation(): Promise<void> {
  let base = os.tmpdir()
  try {
    const scoped = path.join(os.tmpdir(), "opencode")
    if (existsSync(scoped)) base = scoped
  } catch {
    // platform default
  }
  const dir = await fsp.mkdtemp(path.join(base, "pictorium-awards-"))
  tmpDirs.push(dir)
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
}

beforeEach(async () => {
  await stubDurableIsolation()
  cacheClear()
  __resetCircuitBreaker()
  __resetWikidataNegativeForTest()
})

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Wikidata transient-failure negative cache (60s)", () => {
  it("second call within 60s after SPARQL failure makes no second POST", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sparql down"))
    const first = await fetchAllWikidata(424242, "movie")
    expect(first).toEqual({ awards: [], nominations: [], studios: [], director: null, degraded: true })
    const second = await fetchAllWikidata(424242, "movie")
    expect(second).toEqual({ awards: [], nominations: [], studios: [], director: null, degraded: true })
    // 1 POST (con retry interno una sola sequenza): la negativa assorbe la 2ª.
    expect(spy.mock.calls.filter((c) => String(c[0]).includes("sparql")).length).toBeLessThanOrEqual(2)
  })

  it("success still caches 24h and is unaffected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: { bindings: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const first = await fetchAllWikidata(424243, "movie")
    expect(first.awards).toEqual([])
    expect(first.degraded).toBe(false)
    await fetchAllWikidata(424243, "movie")
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("REST fast-path hit is not degraded", async () => {
    // claims con P166 + labels batch: successo accertato anche con zero premi.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const u = String(url)
      if (u.includes("wbgetentities") && u.includes("claims")) {
        return Promise.resolve(new Response(JSON.stringify({
          entities: { Q999: { claims: { P166: [{ mainsnak: { datavalue: { value: { id: "Q101" } } } }] } } },
        }), { status: 200, headers: { "content-type": "application/json" } }))
      }
      if (u.includes("wbgetentities")) {
        return Promise.resolve(new Response(JSON.stringify({
          entities: { Q101: { labels: { en: { value: "Some Unknown Prize" } } } },
        }), { status: 200, headers: { "content-type": "application/json" } }))
      }
      return Promise.reject(new Error("unexpected fetch " + u))
    })
    const res = await fetchAllWikidata(424244, "movie", undefined, { wikidataId: "Q999" })
    expect(res.awards).toEqual([])
    expect(res.degraded).toBe(false)
    expect(spy).toHaveBeenCalled()
  })
})
