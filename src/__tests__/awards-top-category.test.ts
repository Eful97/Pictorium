/**
 * Main-title strictness for Oscar/Emmy/Golden Globe upstream evidence.
 *
 * Only demonstrated main-category QIDs (verified live 2026-10-22, see
 * docs/awards-top-category-provenance.md) may produce a main-title badge:
 * - Oscar Best Picture: Q102427 (movies only);
 * - Emmy Outstanding Drama/Comedy/Limited Series: Q989438/Q2110156/Q20714679
 *   (tv only);
 * - Golden Globe film: Q1011509/Q670282 (movies only); TV: Q1255198/Q596294/
 *   Q265435 (tv only).
 *
 * Broad generic parents (Academy Awards Q19020, Primetime Emmy Awards
 * Q1044427, Golden Globes Q1011547) and craft/acting/writing categories
 * (e.g. Best Actor Q103916) MUST NOT claim an eligible main-award win or
 * nomination. Identical semantics on REST (claims) and SPARQL (bindings):
 * category evidence is filtered on QIDs, never on the lossy merged label.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import {
  fetchAllWikidata,
  fetchWikidataRest,
  strictMainCategoryOrgs,
  __resetCircuitBreaker,
  __resetWikidataRestBreakerForTest,
  __resetWikidataNegativeForTest,
} from "@/lib/awards"
import { getAwardBadgeLabel, getNominationBadgeLabel } from "@/lib/badge-labels"
import { computeTopBadge } from "@/lib/poster-badge"
import { withIdAwards } from "@/lib/award-ids"
import { createT } from "@/lib/i18n"
import enDict from "@/lib/translations/en.json"
import { cacheClear, cacheGet } from "@/lib/cache"

const t = createT("it")

const tmpDirs: string[] = []

async function stubDurableIsolation(): Promise<void> {
  let base = os.tmpdir()
  try {
    const scoped = path.join(os.tmpdir(), "opencode")
    if (existsSync(scoped)) base = scoped
  } catch {
    // platform default
  }
  const dir = await fsp.mkdtemp(path.join(base, "pictorium-awardstop-"))
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

function mockRest(claims: Record<string, unknown[]>, labels: Record<string, string>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes("w/api.php")) {
      const props = new URL(url).searchParams.get("props") || ""
      if (props.includes("claims")) {
        return new Response(JSON.stringify({ entities: { Q12345: { claims } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (props.includes("labels")) {
        const entities: Record<string, unknown> = {}
        for (const [id, label] of Object.entries(labels)) {
          entities[id] = { labels: { en: { value: label } } }
        }
        return new Response(JSON.stringify({ entities }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (props.includes("sitelinks")) {
        return new Response(JSON.stringify({ entities: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function mockSparql(bindings: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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

const uri = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}`, type: "uri" })
const lit = (value: string) => ({ value, type: "literal" })

describe("strictMainCategoryOrgs (pure QID gate)", () => {
  it("accepts every verified main-category QID, media-gated", () => {
    expect(strictMainCategoryOrgs(["Q102427"], "movie")).toEqual(["Oscar"])
    expect(strictMainCategoryOrgs(["Q989438"], "tv")).toEqual(["Emmy"])
    expect(strictMainCategoryOrgs(["Q2110156"], "tv")).toEqual(["Emmy"])
    expect(strictMainCategoryOrgs(["Q20714679"], "tv")).toEqual(["Emmy"])
    expect(strictMainCategoryOrgs(["Q1011509"], "movie")).toEqual(["Golden Globe"])
    expect(strictMainCategoryOrgs(["Q670282"], "movie")).toEqual(["Golden Globe"])
    expect(strictMainCategoryOrgs(["Q1255198"], "tv")).toEqual(["Golden Globe"])
    expect(strictMainCategoryOrgs(["Q596294"], "tv")).toEqual(["Golden Globe"])
    expect(strictMainCategoryOrgs(["Q265435"], "tv")).toEqual(["Golden Globe"])
  })

  it("rejects generic parents and acting/directing/writing categories", () => {
    // Academy Awards / Primetime Emmy Awards / Golden Globes (parents).
    expect(strictMainCategoryOrgs(["Q19020"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q1044427"], "tv")).toEqual([])
    expect(strictMainCategoryOrgs(["Q1011547"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q1011547"], "tv")).toEqual([])
    // Best Actor (acting) is not Best Picture.
    expect(strictMainCategoryOrgs(["Q103916"], "movie")).toEqual([])
  })

  it("isolates movie/tv namespaces: cross-namespace QIDs never match", () => {
    // Emmy top-series on a movie: nothing. Oscar/Globe-film on tv: nothing.
    expect(strictMainCategoryOrgs(["Q989438"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q2110156"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q20714679"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q102427"], "tv")).toEqual([])
    expect(strictMainCategoryOrgs(["Q1011509"], "tv")).toEqual([])
    expect(strictMainCategoryOrgs(["Q670282"], "tv")).toEqual([])
    // Globe TV categories on a movie: nothing.
    expect(strictMainCategoryOrgs(["Q1255198"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q596294"], "movie")).toEqual([])
    expect(strictMainCategoryOrgs(["Q265435"], "movie")).toEqual([])
  })
})

describe("REST strictness (claims QIDs, no extra network)", () => {
  beforeEach(async () => {
    await stubDurableIsolation()
    resetAwardsState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("main-category win accepted, acting + generic rejected on the same title", async () => {
    mockRest(
      { P166: [claim("Q102427"), claim("Q103916"), claim("Q19020")] },
      {
        Q102427: "Academy Award for Best Picture",
        Q103916: "Academy Award for Best Actor",
        Q19020: "Academy Awards",
      },
    )
    const res = await fetchWikidataRest("Q12345", "movie")
    // Exactly one Oscar from the Best Picture QID: the acting win and the
    // generic parent contribute nothing (no duplicated/generic badge).
    expect(res!.awards).toEqual(["Oscar"])
  })

  it("winners vs nominations stay distinct (P166 vs P1411)", async () => {
    mockRest(
      {
        P166: [claim("Q103916")],
        P1411: [claim("Q102427")],
      },
      {
        Q103916: "Academy Award for Best Actor",
        Q102427: "Academy Award for Best Picture",
      },
    )
    const res = await fetchWikidataRest("Q12345", "movie")
    expect(res!.awards).toEqual([])
    expect(res!.nominations).toEqual(["Oscar"])
  })

  it("Emmy and Globe TV categories are tv-only; Globe film is movie-only", async () => {
    mockRest(
      { P166: [claim("Q989438"), claim("Q1255198"), claim("Q1011509")] },
      {
        Q989438: "Primetime Emmy Award for Outstanding Drama Series",
        Q1255198: "Golden Globe Award for Best Television Series – Drama",
        Q1011509: "Golden Globe Award for Best Motion Picture – Drama",
      },
    )
    const tv = await fetchWikidataRest("Q12345", "tv")
    expect(tv!.awards).toEqual(["Emmy", "Golden Globe"])
    const movie = await fetchWikidataRest("Q12345", "movie")
    expect(movie!.awards).toEqual(["Golden Globe"])
  })

  it("legacy non-strict orgs keep label matching (BAFTA/Cannes unchanged)", async () => {
    mockRest(
      {
        P166: [claim("Q777001")],
        P1411: [claim("Q777002")],
      },
      {
        Q777001: "Cannes Film Festival",
        Q777002: "British Academy Film Award",
      },
    )
    const res = await fetchWikidataRest("Q12345", "movie")
    expect(res!.awards).toEqual(["Cannes"])
    expect(res!.nominations).toEqual(["BAFTA"])
  })
})

describe("SPARQL strictness (identical semantics, entities projected)", () => {
  beforeEach(async () => {
    await stubDurableIsolation()
    resetAwardsState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("main-category entity accepted; label-only and generic/acting rejected", async () => {
    mockSparql([
      { award: uri("Q102427"), awardLabel: lit("Academy Award for Best Picture") },
      // Label-only row (no entity): no main-title org, even with a matching label.
      { awardLabel: lit("Academy Award for Best Picture") },
      { award: uri("Q103916"), awardLabel: lit("Academy Award for Best Actor") },
      { award: uri("Q19020"), awardLabel: lit("Academy Awards") },
    ])
    const res = await fetchAllWikidata(9101, "movie")
    expect(res.awards).toEqual(["Oscar"])
  })

  it("winners vs nominations stay distinct in bindings", async () => {
    mockSparql([
      { award: uri("Q103916"), awardLabel: lit("Academy Award for Best Actor") },
      { nomination: uri("Q102427"), nominationLabel: lit("Academy Award for Best Picture") },
    ])
    const res = await fetchAllWikidata(9102, "movie")
    expect(res.awards).toEqual([])
    expect(res.nominations).toEqual(["Oscar"])
  })

  it("tv categories accepted on tv, rejected on movie", async () => {
    const bindings = [
      { award: uri("Q989438"), awardLabel: lit("Primetime Emmy Award for Outstanding Drama Series") },
      { award: uri("Q1255198"), awardLabel: lit("Golden Globe Award for Best Television Series – Drama") },
    ]
    mockSparql(bindings)
    const tv = await fetchAllWikidata(9103, "tv")
    expect(tv.awards).toEqual(["Emmy", "Golden Globe"])
    vi.restoreAllMocks()
    resetAwardsState()
    mockSparql(bindings)
    const movie = await fetchAllWikidata(9104, "movie")
    expect(movie.awards).toEqual([])
  })

  it("shared cache moved to the v3 namespace (old broad v2 entries bypassed)", async () => {
    mockSparql([
      { award: uri("Q102427"), awardLabel: lit("Academy Award for Best Picture") },
    ])
    const res = await fetchAllWikidata(9105, "movie")
    expect(res.awards).toEqual(["Oscar"])
    expect(cacheGet(`wikidata:v3:movie:9105`)).not.toBeNull()
    expect(cacheGet(`wikidata:v2:movie:9105`)).toBeNull()
  })
})

describe("short winner/nominee badge texts (category is selection-only, i18n)", () => {
  const base = {
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [] as string[],
    voteAverage: 8,
    trendRank: null,
    animeRank: null,
    awards: [] as string[],
    nominations: [] as string[],
    studios: [] as string[],
    director: null,
    tvType: null,
    tvStatus: null,
    keywords: [] as string[],
    imdbTop250: false,
  }

  // NOTE: the global test setup mocks "@/lib/i18n" (createT => Italian
  // mockT), so English assertions below use the real en dictionary
  // directly instead of createT("en").
  function enT(key: string, params?: Record<string, string | number>): string {
    let val: string = (enDict as unknown as Record<string, string>)[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) val = val.replace(`{${k}}`, String(v))
    }
    return val
  }

  it("winners are explicit short forms, nominees stay short (it + en exact)", () => {
    expect(getAwardBadgeLabel(["Oscar"], t)).toBe("Vincitore Oscar")
    expect(getNominationBadgeLabel(["Oscar"], t)).toBe("Candidato Oscar")
    expect(getAwardBadgeLabel(["Emmy"], t)).toBe("Vincitore Emmy")
    expect(getNominationBadgeLabel(["Emmy"], t)).toBe("Candidato Emmy")
    expect(getAwardBadgeLabel(["Golden Globe"], t)).toBe("Vincitore Golden Globe")
    expect(getNominationBadgeLabel(["Golden Globe"], t)).toBe("Candidato Golden Globe")
    expect(getAwardBadgeLabel(["Oscar"], enT)).toBe("Oscar Winner")
    expect(getAwardBadgeLabel(["Emmy"], enT)).toBe("Emmy Winner")
    expect(getAwardBadgeLabel(["Golden Globe"], enT)).toBe("Golden Globe Winner")
    expect(getNominationBadgeLabel(["Oscar"], enT)).toBe("Nominee Oscar")
    expect(getNominationBadgeLabel(["Emmy"], enT)).toBe("Nominee Emmy")
    expect(getNominationBadgeLabel(["Golden Globe"], enT)).toBe("Nominee Golden Globe")
  })

  it("fallback without t stays explicit for winners", () => {
    expect(getAwardBadgeLabel(["Oscar"])).toBe("Oscar Winner")
    expect(getAwardBadgeLabel(["Emmy"])).toBe("Emmy Winner")
    expect(getAwardBadgeLabel(["Golden Globe"])).toBe("Golden Globe Winner")
    // Legacy fallback quirk preserved (Italian "Candidato", as before).
    expect(getNominationBadgeLabel(["Oscar"])).toBe("Candidato Oscar")
    expect(getNominationBadgeLabel(["Golden Globe"])).toBe("Candidato Golden Globe")
  })

  it("other orgs keep their legacy labels byte-identically (bare winner, short nominee)", () => {
    expect(getAwardBadgeLabel(["BAFTA"], t)).toBe("BAFTA")
    expect(getNominationBadgeLabel(["Cannes"], t)).toBe("Candidato Cannes")
    expect(getAwardBadgeLabel(["Venezia"], t)).toBe("Venezia")
    expect(getNominationBadgeLabel(["David"], t)).toBe("Candidato David")
    expect(getAwardBadgeLabel(["BAFTA"])).toBe("BAFTA")
    expect(getNominationBadgeLabel(["Cannes"])).toBe("Candidato Cannes")
    // Other-org winners never gain the explicit top-winner form.
    expect(getAwardBadgeLabel(["Cannes"], t)).toBe("Cannes")
    expect(getAwardBadgeLabel(["David"], t)).toBe("David")
  })

  it("no category text is ever rendered (it + en + fallback)", () => {
    const banned = [
      "Miglior",
      "Outstanding",
      "Best Picture",
      "Best Motion Picture",
      "Best Television Series",
      "Serie TV",
    ]
    const labels = [
      getAwardBadgeLabel(["Oscar"], t),
      getNominationBadgeLabel(["Oscar"], t),
      getAwardBadgeLabel(["Emmy"], t),
      getNominationBadgeLabel(["Emmy"], t),
      getAwardBadgeLabel(["Golden Globe"], t),
      getNominationBadgeLabel(["Golden Globe"], t),
      getAwardBadgeLabel(["Oscar"], enT),
      getNominationBadgeLabel(["Emmy"], enT),
      getAwardBadgeLabel(["Golden Globe"], enT),
      getAwardBadgeLabel(["Oscar"]),
      getAwardBadgeLabel(["Emmy"]),
      getNominationBadgeLabel(["Golden Globe"]),
    ]
    for (const label of labels) {
      expect(label).not.toBeNull()
      for (const word of banned) expect(label).not.toContain(word)
    }
  })

  it("computeTopBadge renders the same short labels as the dropdown helper", () => {
    // BadgeControls builds its manual dropdown options through the same
    // shared helpers, so helper parity covers the manual path too.
    const movie = computeTopBadge({ ...base, mediaType: "movie", awards: ["Golden Globe"] }, t, "it")
    expect(movie.awardBadge).toBe(getAwardBadgeLabel(["Golden Globe"], t))
    expect(movie.awardBadge).toBe("Vincitore Golden Globe")
    const tv = computeTopBadge(
      { ...base, mediaType: "tv", awards: [], nominations: ["Emmy"] },
      t,
      "it",
    )
    expect(tv.badge?.label).toBe(getNominationBadgeLabel(["Emmy"], t))
    expect(tv.badge?.label).toBe("Candidato Emmy")
    // Winner still suppresses the nominee (unchanged precedence).
    const both = computeTopBadge(
      { ...base, mediaType: "tv", awards: ["Emmy"], nominations: ["Golden Globe"] },
      t,
      "it",
    )
    expect(both.awardBadge).toBe(getAwardBadgeLabel(["Emmy"], t))
    expect(both.awardBadge).toBe("Vincitore Emmy")
    expect(both.badge?.label).toBe("Vincitore Emmy")
  })

  it("dropdown mirror (withIdAwards + shared helper) renders short labels", () => {
    // Mirrors BadgeControls: curated IDs merge first, then the shared helper
    // renders — manual options never see category text either.
    const mergedAwards = withIdAwards(872585, "movie", [])
    expect(mergedAwards).toContain("Oscar")
    const label = getAwardBadgeLabel(mergedAwards, t)
    expect(label).toBe("Vincitore Oscar")
    expect(label).not.toContain("Miglior")
  })
})
