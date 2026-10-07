/**
 * Fast-path REST per Wikidata (Action API via CDN): con wikidata_id noto da
 * TMDB external_ids, fetchAllWikidata usa wbgetentities (claims + labels
 * batch) invece dello SPARQL lento. Fallback SPARQL su QID assente/invalido
 * o REST fallito; stessa cache condivisa v2; breaker REST isolato.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import {
  fetchAllWikidata,
  fetchWikidataRest,
  isValidWikidataQid,
  __resetCircuitBreaker,
  __resetWikidataRestBreakerForTest,
  __resetWikidataNegativeForTest,
} from "@/lib/awards"
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

function resetAwardsState(): void {
  cacheClear()
  __resetCircuitBreaker()
  __resetWikidataRestBreakerForTest()
  __resetWikidataNegativeForTest()
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

function claim(id: string) {
  return { mainsnak: { datavalue: { value: { id } } } }
}

interface RestFixture {
  claims?: Record<string, unknown[]>
  labels?: Record<string, string>
  claimsStatus?: number
  labelsStatus?: number
  sparqlBindings?: unknown[]
}

function mockUpstream(fixture: RestFixture) {
  const calls = { claims: 0, labels: 0, sparql: 0, sitelinks: 0 }
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("sparql")) {
      calls.sparql++
      return new Response(JSON.stringify({ results: { bindings: fixture.sparqlBindings ?? [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.includes("w/api.php")) {
      const props = new URL(url).searchParams.get("props") || ""
      if (props.includes("sitelinks")) {
        calls.sitelinks++
        return new Response(JSON.stringify({ entities: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (props.includes("claims")) {
        calls.claims++
        return new Response(JSON.stringify({ entities: { Q12345: { claims: fixture.claims ?? {} } } }), {
          status: fixture.claimsStatus ?? 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (props.includes("labels")) {
        calls.labels++
        const entities: Record<string, unknown> = {}
        for (const [id, label] of Object.entries(fixture.labels ?? {})) {
          entities[id] = { labels: { en: { value: label } } }
        }
        return new Response(JSON.stringify({ entities }), {
          status: fixture.labelsStatus ?? 200,
          headers: { "content-type": "application/json" },
        })
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return calls
}

const AWARD_CLAIMS = {
  P166: [claim("Q109487")],
  P1411: [claim("Q109488")],
  P57: [claim("Q25191")],
}
const AWARD_LABELS = {
  Q109487: "Academy Award for Best Picture",
  Q109488: "British Academy Film Award",
  Q25191: "Christopher Nolan",
}

describe("isValidWikidataQid", () => {
  it("accepts QIDs and rejects garbage", () => {
    expect(isValidWikidataQid("Q25191")).toBe(true)
    expect(isValidWikidataQid("Q1")).toBe(true)
    expect(isValidWikidataQid(null)).toBe(false)
    expect(isValidWikidataQid(undefined)).toBe(false)
    expect(isValidWikidataQid("")).toBe(false)
    expect(isValidWikidataQid("25191")).toBe(false)
    expect(isValidWikidataQid("http://www.wikidata.org/entity/Q25191")).toBe(false)
  })
})

describe("fetchWikidataRest", () => {
  beforeEach(async () => {
    await stubDurableIsolation()
    resetAwardsState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves awards, nominations and director without SPARQL", async () => {
    const calls = mockUpstream({ claims: AWARD_CLAIMS, labels: AWARD_LABELS })
    const res = await fetchWikidataRest("Q12345", "movie")
    expect(res).not.toBeNull()
    expect(res!.awards).toEqual(["Oscar"])
    expect(res!.nominations).toEqual(["BAFTA"])
    expect(res!.director).toBe("Christopher Nolan")
    expect(calls.claims).toBe(1)
    expect(calls.labels).toBe(1)
    expect(calls.sparql).toBe(0)
  })

  it("returns null for invalid QIDs without network", async () => {
    const calls = mockUpstream({})
    expect(await fetchWikidataRest("nope", "movie")).toBeNull()
    expect(await fetchWikidataRest("", "movie")).toBeNull()
    expect(calls.claims).toBe(0)
    expect(calls.sparql).toBe(0)
  })

  it("returns null when claims fail", async () => {
    const calls = mockUpstream({ claimsStatus: 500 })
    expect(await fetchWikidataRest("Q12345", "movie")).toBeNull()
    expect(calls.labels).toBe(0)
  })

  it("ignores P449 networks for movies but keeps them for tv", async () => {
    const withNet = { ...AWARD_CLAIMS, P449: [claim("Q907311")] }
    const labels = { ...AWARD_LABELS, Q907311: "Netflix" }
    const calls = mockUpstream({ claims: withNet, labels })
    const movie = await fetchWikidataRest("Q12345", "movie")
    expect(movie!.studios).toEqual([])
    const tv = await fetchWikidataRest("Q12345", "tv")
    expect(tv!.studios).toEqual(["Netflix"])
    expect(calls.claims).toBe(2)
  })
})

describe("fetchAllWikidata fast-path integration", () => {
  beforeEach(async () => {
    await stubDurableIsolation()
    resetAwardsState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prefers REST when wikidataId is given and caches under the v2 key", async () => {
    const calls = mockUpstream({ claims: AWARD_CLAIMS, labels: AWARD_LABELS })
    const first = await fetchAllWikidata(801, "movie", undefined, { wikidataId: "Q12345" })
    expect(first.awards).toEqual(["Oscar"])
    expect(first.director).toBe("Christopher Nolan")
    expect(calls.sparql).toBe(0)
    // Seconda chiamata: cache condivisa, zero rete.
    const second = await fetchAllWikidata(801, "movie", undefined, { wikidataId: "Q12345" })
    expect(second.awards).toEqual(["Oscar"])
    expect(calls.claims).toBe(1)
    expect(calls.labels).toBe(1)
  })

  it("falls back to SPARQL without wikidataId", async () => {
    const calls = mockUpstream({
      sparqlBindings: [{ awardLabel: { value: "Academy Award", type: "literal" } }],
    })
    const res = await fetchAllWikidata(802, "movie")
    expect(res.awards).toEqual(["Oscar"])
    expect(calls.claims).toBe(0)
    expect(calls.sparql).toBe(1)
  })

  it("falls back to SPARQL when REST fails", async () => {
    const calls = mockUpstream({
      claimsStatus: 500,
      sparqlBindings: [{ awardLabel: { value: "Academy Award", type: "literal" } }],
    })
    const res = await fetchAllWikidata(803, "movie", undefined, { wikidataId: "Q12345" })
    expect(res.awards).toEqual(["Oscar"])
    expect(calls.claims).toBe(1)
    expect(calls.sparql).toBe(1)
  })

  it("falls back to SPARQL when the REST breaker is open", async () => {
    const calls = mockUpstream({
      claimsStatus: 500,
      sparqlBindings: [{ awardLabel: { value: "Academy Award", type: "literal" } }],
    })
    // 5 fallimenti REST → breaker awards-rest aperto.
    for (let i = 0; i < 5; i++) {
      expect(await fetchWikidataRest("Q12345", "movie")).toBeNull()
    }
    const before = calls.claims
    const res = await fetchAllWikidata(804, "movie", undefined, { wikidataId: "Q12345" })
    expect(res.awards).toEqual(["Oscar"])
    // Nessuna nuova chiamata REST: il breaker la sopprime, vince lo SPARQL.
    expect(calls.claims).toBe(before)
    expect(calls.sparql).toBe(1)
  })
})
