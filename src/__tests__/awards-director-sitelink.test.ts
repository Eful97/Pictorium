/**
 * Fallback sitelink per il nome regista: quando l'item Wikidata del regista
 * non ha label (vandalismo/decadimento, es. Q25191 senza label ma con
 * sitelink enwiki "Christopher Nolan"), il badge usa il titolo enwiki
 * risolto via MediaWiki API (mai join sitelink in SPARQL: rende la query
 * 10x più lenta e manda in timeout l'intero payload premi).
 * La label resta prioritaria; senza nessuno dei due → null (invariato).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { fetchAllWikidata, directorBadgeLabel, __resetCircuitBreaker } from "@/lib/awards"
import { cacheClear, cacheSet } from "@/lib/cache"

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

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

function sparqlOk(bindings: unknown[]) {
  return new Response(JSON.stringify({ results: { bindings } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function apiOkFor(ids: string, titles: Record<string, string | null>) {
  const entities: Record<string, unknown> = {}
  for (const id of ids.split("|")) {
    const title = titles[id]
    entities[id] = title ? { sitelinks: { enwiki: { title } } } : { sitelinks: {} }
  }
  return new Response(JSON.stringify({ entities }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/** SPARQL con label presente; l'API non deve nemmeno essere chiamata. */
function mockFetch(sparqlBindings: unknown[], titles: Record<string, string | null> = {}) {
  let apiCalls = 0
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("w/api.php")) {
      apiCalls++
      const ids = new URL(url).searchParams.get("ids") || ""
      return apiOkFor(ids, titles)
    }
    return sparqlOk(sparqlBindings)
  })
  return () => apiCalls
}

describe("fetchAllWikidata director sitelink fallback", () => {
  beforeEach(async () => {
    await stubDurableIsolation()
    cacheClear()
    __resetCircuitBreaker()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prefers the rdfs:label when present (no API call)", async () => {
    const apiCalls = mockFetch(
      [{ directorLabel: { value: "Christopher Nolan", type: "literal" } }]
    )
    const res = await fetchAllWikidata(901, "movie")
    expect(res.director).toBe("Christopher Nolan")
    expect(apiCalls()).toBe(0)
  })

  it("falls back to the enwiki sitelink title when the label is missing", async () => {
    const apiCalls = mockFetch(
      [
        {
          director: { value: "http://www.wikidata.org/entity/Q25191", type: "uri" },
        },
      ],
      { Q25191: "Christopher Nolan" }
    )
    const res = await fetchAllWikidata(902, "movie")
    expect(res.director).toBe("Christopher Nolan")
    expect(apiCalls()).toBe(1)
  })

  it("matches the allowlist on sitelink titles with disambiguation", async () => {
    mockFetch(
      [
        {
          director: { value: "http://www.wikidata.org/entity/Q25191", type: "uri" },
        },
      ],
      { Q25191: "Christopher Nolan (director)" }
    )
    const res = await fetchAllWikidata(903, "movie")
    // Nome canonico dalla allowlist, non il raw col disambiguatore — e non reso:
    // la resa avviene a render-time con directorBadgeLabel.
    expect(res.director).toBe("Christopher Nolan")
  })

  it("returns null when neither label, QID nor sitelink exists", async () => {
    const apiCalls = mockFetch([{}], {})
    const res = await fetchAllWikidata(904, "movie")
    expect(res.director).toBeNull()
    expect(apiCalls()).toBe(0)
  })

  it("still returns null for directors outside the allowlist", async () => {
    mockFetch(
      [
        {
          director: { value: "http://www.wikidata.org/entity/Q999999", type: "uri" },
        },
      ],
      { Q999999: "Jane Unknown" }
    )
    const res = await fetchAllWikidata(905, "movie")
    expect(res.director).toBeNull()
  })

  it("stores the canonical name once: every language renders from the same cache entry", async () => {
    mockFetch(
      [{ directorLabel: { value: "Christopher Nolan", type: "literal" } }]
    )
    const first = await fetchAllWikidata(906, "movie")
    expect(first.director).toBe("Christopher Nolan")
    // Seconda richiesta: la cache non viene riscritta…
    const second = await fetchAllWikidata(906, "movie")
    expect(second.director).toBe("Christopher Nolan")
    // …e ogni lingua rende la propria etichetta dallo stesso canonico
    // (stub al posto dei dizionari: il mock i18n globale ignora la lingua).
    const tIt = (_k: string, p?: Record<string, string | number>) => `Di ${p?.name}`
    const tEn = (_k: string, p?: Record<string, string | number>) => `By ${p?.name}`
    expect(directorBadgeLabel(second.director, tIt)).toBe("Di Christopher Nolan")
    expect(directorBadgeLabel(second.director, tEn)).toBe("By Christopher Nolan")
    expect(directorBadgeLabel(null, tEn)).toBeNull()
    expect(directorBadgeLabel("Christopher Nolan")).toBe("Di Christopher Nolan")
    // Idempotenza: non raddoppia prefissi già presenti
    expect(directorBadgeLabel("Di Christopher Nolan", tIt)).toBe("Di Christopher Nolan")
    expect(directorBadgeLabel("By Christopher Nolan", tEn)).toBe("By Christopher Nolan")
    expect(directorBadgeLabel("Di Christopher Nolan", tEn)).toBe("By Christopher Nolan")
  })

  it("ignores unversioned wikidata cache entries and uses wikidata:v2 key", async () => {
    cacheSet("wikidata:movie:907", {
      awards: [],
      nominations: [],
      studios: [],
      director: "Di Christopher Nolan",
    })
    mockFetch(
      [{ directorLabel: { value: "Christopher Nolan", type: "literal" } }]
    )
    const res = await fetchAllWikidata(907, "movie")
    expect(res.director).toBe("Christopher Nolan")
  })
})
