/**
 * Fallback sitelink per il nome regista: quando l'item Wikidata del regista
 * non ha label (vandalismo/decadimento, es. Q25191 senza label ma con
 * sitelink enwiki "Christopher Nolan"), il badge usa il titolo enwiki
 * risolto via MediaWiki API (mai join sitelink in SPARQL: rende la query
 * 10x più lenta e manda in timeout l'intero payload premi).
 * La label resta prioritaria; senza nessuno dei due → null (invariato).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchAllWikidata, __resetCircuitBreaker } from "@/lib/awards"
import { cacheClear } from "@/lib/cache"

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
  beforeEach(() => {
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
    expect(res.director).toBe("Di Christopher Nolan")
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
    expect(res.director).toBe("Di Christopher Nolan")
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
    // Nome canonico dalla allowlist, non il raw col disambiguatore.
    expect(res.director).toBe("Di Christopher Nolan")
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
})
