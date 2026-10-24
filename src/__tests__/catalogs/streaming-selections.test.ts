/**
 * Backend slice: opt-in streaming catalogs selected by service + country.
 *
 * Covers the shared contracts + endpoints needed by the UI follow-up:
 * - sanitization/identity/cache keys (stable safe ids, unknown countries
 *   never fall back to Italy);
 * - manifest exposure (absent = legacy, explicit = opt-in mode);
 * - catalog serving per selection country (FP-first/JW fallback provenance,
 *   no-alias pairs, per-response source header, rank coherence);
 * - persisted validation + roundtrip (UUID/local-only isolation patterns);
 * - read-only availability endpoint (bounded cached index, no probing).
 */
import fsp from "node:fs/promises"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-selections-test`,
}))

vi.mock("@/lib/flixpatrol", () => ({
  getTop10: vi.fn(),
  resolveFlixPlatformSides: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { GET as availabilityGET } from "@/app/api/streaming-availability/route"
import { cacheClear } from "@/lib/cache"
import { encodeConfig, decodeConfig } from "@/lib/config-token"
import { getTop10, resolveFlixPlatformSides } from "@/lib/flixpatrol"
import { getById } from "@/lib/store"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import {
  STREAMING_CATALOG_ID_PREFIX,
  STREAMING_SOURCE_HEADER,
  isJwFallbackAllowedForPlatform,
  jwFallbackSupported,
  parseStreamingCatalogId,
  sanitizeStreamingSelections,
  streamingAvailabilityServiceId,
  streamingCatalogId,
  streamingCatalogName,
  streamingSelectionCatalogIds,
} from "@/lib/streaming-catalogs"
import {
  __clearStreamingAvailabilityCache,
  __clearStreamingAvailabilityMemory,
  buildStreamingChoices,
  getStreamingAvailability,
  parseAvailabilityIndex,
} from "@/lib/streaming-availability"

const mockedGetTop10 = vi.mocked(getTop10)
const mockedResolveFlixSides = vi.mocked(resolveFlixPlatformSides)
const mockedGetById = vi.mocked(getById)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)

function tmdbDetails(id: number, name: string) {
  return {
    id,
    name,
    first_air_date: "2023-04-01",
    vote_average: 7.5,
    genres: [{ id: 18, name: "Dramma" }],
    backdrop_path: "/bd.jpg",
    overview: "Overview",
  }
}

function mockTmdbFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (url.includes("/images")) return Response.json({ logos: [] })
    if (url.includes("/external_ids")) return Response.json({ imdb_id: "tt9000001" })
    const m = /\/(movie|tv)\/(\d+)/.exec(url)
    if (m) return Response.json(tmdbDetails(Number(m[2]), m[1] === "movie" ? "Test Film" : "Test Show"))
    throw new Error(`unexpected fetch in test: ${url}`)
  })
}

function pinWith(rows: Array<{ tmdbId: number; imdbId: string | null; rank: number; title: string }>, provenance: string | null) {
  return {
    id: "20261022-00",
    snapshot: {
      generation: "20261022-00",
      group: "g",
      family: "platform:netflix:series",
      status: "ok",
      rows,
      fetchedAt: Date.now(),
      publishedAt: Date.now(),
      provenance,
    },
  }
}

const LIVE_PIN = { id: "live", snapshot: null }

beforeEach(async () => {
  mockedGetById.mockResolvedValue(null)
  mockedGetTop10.mockReset()
  mockedResolveFlixSides.mockReset()
  mockedEnsureFresh.mockReset()
  __clearStreamingAvailabilityCache()
  const { setServerDefaults } = await import("@/lib/server-defaults")
  await setServerDefaults({})
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
})

afterAll(async () => {
  await fsp.rm(`${process.cwd()}/test-results/streaming-selections-test`, { recursive: true, force: true })
})

describe("streaming-catalogs contracts", () => {
  it("sanitizes selections: canonical codes, defaults, drops unknown service/country", () => {
    expect(sanitizeStreamingSelections(undefined)).toBeUndefined()
    expect(sanitizeStreamingSelections(null)).toBeUndefined()
    expect(sanitizeStreamingSelections([])).toEqual([])
    const out = sanitizeStreamingSelections([
      { service: "netflix", country: "it" },
      { service: "prime", country: "united-states", sections: ["movies"], enabled: false },
      // Unknowns are dropped — never resolved to another service or Italy.
      { service: "hulu", country: "US" },
      { service: "netflix", country: "XX" },
      { service: "netflix", country: "GLOBAL" },
      { service: "netflix", country: "" },
    ])
    expect(out).toEqual([
      { service: "netflix", country: "IT", sections: ["movies", "series"], enabled: true },
      { service: "prime", country: "US", sections: ["movies"], enabled: false },
    ])
  })

  it("bounds entries and drops overlong/prototype-hostile input", () => {
    // Task F: MAX_STREAMING_SELECTIONS is 200 (batch-adding many providers
    // for one country stays under the token cap; every old config still fits).
    const many = Array.from({ length: 500 }, () => ({ service: "netflix", country: "IT" }))
    expect(sanitizeStreamingSelections(many)).toHaveLength(200)
    expect(
      sanitizeStreamingSelections([
        { service: "x".repeat(65), country: "IT" },
        { service: "netflix", country: "y".repeat(65) },
      ]),
    ).toEqual([])
  })

  it("derives stable safe ids and parses them back (media is part of identity)", () => {
    const id = streamingCatalogId("netflix", "IT", "series")
    expect(id).toBe(`${STREAMING_CATALOG_ID_PREFIX}netflix-it-series`)
    expect(parseStreamingCatalogId(id)).toEqual({ service: "netflix", country: "IT", section: "series" })
    expect(parseStreamingCatalogId("pictorium-netflix-series")).toBeNull()
    expect(parseStreamingCatalogId(`${STREAMING_CATALOG_ID_PREFIX}hulu-us-movies`)).toBeNull()
    expect(parseStreamingCatalogId(`${STREAMING_CATALOG_ID_PREFIX}netflix-xx-movies`)).toBeNull()
    expect(parseStreamingCatalogId(`${STREAMING_CATALOG_ID_PREFIX}netflix-it-shows`)).toBeNull()
    // Enabled selections expand to both sections; disabled expand to none.
    expect(
      streamingSelectionCatalogIds({ service: "netflix", country: "IT", sections: ["movies", "series"], enabled: true }),
    ).toEqual([`${STREAMING_CATALOG_ID_PREFIX}netflix-it-movies`, `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series`])
    expect(
      streamingSelectionCatalogIds({ service: "netflix", country: "IT", sections: ["movies"], enabled: false }),
    ).toEqual([])
  })

  it("keeps manifest names source-neutral (no FP/JW claims without chart I/O)", () => {
    const name = streamingCatalogName("netflix", "IT", "movies")
    expect(name).toContain("Netflix")
    expect(name).toContain("Italia")
    expect(name.toLowerCase()).not.toContain("flixpatrol")
    expect(name.toLowerCase()).not.toContain("justwatch")
  })

  it("gates the JW fallback per pair (NOW+US is FP-only, never a Peacock alias)", () => {
    expect(jwFallbackSupported("now", "US")).toBe(false)
    expect(jwFallbackSupported("now", "IT")).toBe(true)
    expect(jwFallbackSupported("netflix", "US")).toBe(true)
    // Correction c1 (real verified matrix): NOW outside Sky core and
    // Paramount outside verified own-brand countries are unavailable via JW
    // (no sibling-brand alias, no blanket true).
    expect(jwFallbackSupported("now", "JP")).toBe(false)
    expect(jwFallbackSupported("now", "IN")).toBe(false)
    expect(jwFallbackSupported("paramount", "JP")).toBe(false)
    expect(jwFallbackSupported("paramount", "IN")).toBe(false)
    // Legacy unknown platform keys fail-open (legacy behavior preserved):
    // the historic NOW+US Peacock alias stays for legacy platform catalogs.
    expect(isJwFallbackAllowedForPlatform("whatever", "US")).toBe(true)
    expect(isJwFallbackAllowedForPlatform("now", "US")).toBe(true)
    expect(isJwFallbackAllowedForPlatform("now", "IT")).toBe(true)
  })

  it("c2: probe-backed JW allowlist for selections (no blanket worldwide claims)", () => {
    // Live JustWatch probes (2026-10-23, `streamingCharts first:3` with the
    // strict own-brand package filter; nonsense package codes error out, so a
    // `0`-row probe with a non-empty unfiltered control for the same country
    // reads as unsupported). Representative UNSUPPORTED pairs:
    expect(jwFallbackSupported("hbo", "IN")).toBe(false)
    expect(jwFallbackSupported("hbo", "JP")).toBe(false)
    expect(jwFallbackSupported("hbo", "CA")).toBe(false)
    expect(jwFallbackSupported("disney", "IN")).toBe(false)
    expect(jwFallbackSupported("disney", "SA")).toBe(false)
    expect(jwFallbackSupported("disney", "IL")).toBe(false)
    expect(jwFallbackSupported("apple", "TR")).toBe(false)
    expect(jwFallbackSupported("apple", "RO")).toBe(false)
    expect(jwFallbackSupported("now", "US")).toBe(false)
    expect(jwFallbackSupported("now", "DE")).toBe(false)
    expect(jwFallbackSupported("paramount", "ES")).toBe(false)
    expect(jwFallbackSupported("paramount", "JP")).toBe(false)
    expect(jwFallbackSupported("netflix", "IL")).toBe(false)
    expect(jwFallbackSupported("prime", "IL")).toBe(false)
    expect(jwFallbackSupported("crunchyroll", "IL")).toBe(false)
    // Representative SUPPORTED pairs (probes returned chart rows):
    expect(jwFallbackSupported("netflix", "IT")).toBe(true)
    expect(jwFallbackSupported("netflix", "JP")).toBe(true)
    expect(jwFallbackSupported("disney", "TR")).toBe(true)
    expect(jwFallbackSupported("now", "IT")).toBe(true)
    expect(jwFallbackSupported("now", "GB")).toBe(true)
    expect(jwFallbackSupported("hbo", "IT")).toBe(true)
    expect(jwFallbackSupported("hbo", "TR")).toBe(true)
    expect(jwFallbackSupported("paramount", "US")).toBe(true)
    expect(jwFallbackSupported("apple", "IT")).toBe(true)
    expect(jwFallbackSupported("crunchyroll", "BR")).toBe(true)
    // NOW Germany is probe-positive for `ntv`/`skg` but brand-excluded (the
    // DE market brand is WOW/Sky, no NOW consumer brand): serving those rows
    // under the NOW name would mislabel Sky content. IT/GB stay (NOW TV
    // operates there under the NOW brand). Legacy historic unions stay
    // fail-open and untouched (see previous test).
    expect(jwFallbackSupported("now", "DE")).toBe(false)
  })

  it("maps availability service ids to the real upstream index keys (paramount, not paramount-plus)", () => {
    expect(streamingAvailabilityServiceId("netflix")).toBe("netflix")
    expect(streamingAvailabilityServiceId("prime")).toBe("amazon-prime")
    expect(streamingAvailabilityServiceId("disney")).toBe("disney")
    expect(streamingAvailabilityServiceId("now")).toBe("now")
    expect(streamingAvailabilityServiceId("apple")).toBe("apple-tv")
    expect(streamingAvailabilityServiceId("hbo")).toBe("hbo-max")
    expect(streamingAvailabilityServiceId("paramount")).toBe("paramount")
    expect(streamingAvailabilityServiceId("crunchyroll")).toBe("crunchyroll")
  })
})

describe("manifest exposure (absent = legacy, explicit = opt-in)", () => {
  it("keeps legacy platform catalogs when streamingSelections is absent", async () => {
    const { buildManifestResponse } = await import("@/lib/build-manifest")
    const res = await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))
    const json = await res.json()
    const ids = json.catalogs.map((c: { id: string }) => c.id)
    expect(ids).toContain("pictorium-netflix-movies")
    expect(ids).toContain("pictorium-jw-movies")
    expect(ids).toContain("pictorium-anime")
  })

  it("hides legacy platforms on explicit [] and keeps general JW + anime", async () => {
    const { setServerDefaults } = await import("@/lib/server-defaults")
    await setServerDefaults({ streamingSelections: [] })
    const { buildManifestResponse } = await import("@/lib/build-manifest")
    const res = await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))
    const json = await res.json()
    const ids = json.catalogs.map((c: { id: string }) => c.id)
    expect(ids).not.toContain("pictorium-netflix-movies")
    expect(ids).not.toContain("pictorium-prime-series")
    expect(ids).toContain("pictorium-jw-movies")
    expect(ids).toContain("pictorium-jw-series")
    expect(ids).toContain("pictorium-anime-movies")
    expect(ids).toContain("pictorium-anime")
  })

  it("exposes only enabled selections with stable neutral ids; honors disabled/renames", async () => {
    const { setServerDefaults } = await import("@/lib/server-defaults")
    await setServerDefaults({
      streamingSelections: [
        { service: "netflix", country: "IT" },
        { service: "prime", country: "US", sections: ["movies"], enabled: false },
        { service: "disney", country: "XX" },
      ],
      disabledCatalogIds: [`${STREAMING_CATALOG_ID_PREFIX}netflix-it-series`],
      catalogRenames: { [`${STREAMING_CATALOG_ID_PREFIX}netflix-it-movies`]: "Mine" },
    })
    const { buildManifestResponse } = await import("@/lib/build-manifest")
    const res = await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))
    const json = await res.json()
    const byId = new Map(json.catalogs.map((c: { id: string; name: string }) => [c.id, c.name]))
    expect(byId.get(`${STREAMING_CATALOG_ID_PREFIX}netflix-it-movies`)).toBe("Mine")
    expect(byId.has(`${STREAMING_CATALOG_ID_PREFIX}netflix-it-series`)).toBe(false)
    expect(byId.has(`${STREAMING_CATALOG_ID_PREFIX}prime-us-movies`)).toBe(false)
    expect(byId.has(`${STREAMING_CATALOG_ID_PREFIX}disney-xx-movies`)).toBe(false)
    for (const name of byId.values()) {
      expect(String(name).toLowerCase()).not.toContain("flixpatrol")
      expect(String(name).toLowerCase()).not.toContain("justwatch")
    }
  })

  it("namespaces stay isolated (UUID/local-only): A selections do not leak into B", async () => {
    const { setServerDefaultsForUser, getServerDefaultsForUser } = await import("@/lib/server-defaults")
    const uuidA = "11111111-1111-1111-1111-111111111111"
    const uuidB = "22222222-2222-2222-2222-222222222222"
    await setServerDefaultsForUser(uuidA, { streamingSelections: [{ service: "netflix", country: "IT" }] })
    expect(await getServerDefaultsForUser(uuidA)).toMatchObject({
      streamingSelections: [{ service: "netflix", country: "IT" }],
    })
    expect((await getServerDefaultsForUser(uuidB)).streamingSelections).toBeUndefined()
  })
})

describe("config token roundtrip (incl. profileless catalog-only)", () => {
  const base = {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "pill",
    rankingBadgeStyle: "pill",
    blurEnabled: true,
    blurIntensity: 12,
    blurFade: 45,
    blurDarkness: 55,
    gradientHeight: 50,
    networkLogo: true,
    autoRotateClean: false,
  } as const

  it("round-trips selections and preserves explicit []", () => {
    const selections = [{ service: "netflix", country: "IT" }]
    expect(decodeConfig(encodeConfig({ ...base, streamingSelections: selections }))?.streamingSelections).toEqual(selections)
    expect(decodeConfig(encodeConfig({ ...base, streamingSelections: [] }))?.streamingSelections).toEqual([])
    expect(decodeConfig(encodeConfig({ ...base }))?.streamingSelections).toBeUndefined()
  })
})

describe("PUT /api/defaults validation + persistence", () => {
  function putRequest(body: unknown) {
    return new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("persists bounded selections and rejects oversized payloads", async () => {
    const { PUT, GET } = await import("@/app/api/defaults/route")
    const selections = [
      { service: "netflix", country: "IT" },
      { service: "prime", country: "US", sections: ["movies"] },
    ]
    const put = await PUT(putRequest({ streamingSelections: selections }) as unknown as NextRequest)
    expect(put.status).toBe(200)
    const got = (await (await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)).json()) as {
      streamingSelections: unknown
    }
    expect(got.streamingSelections).toEqual(selections)
    const tooMany = Array.from({ length: 201 }, () => ({ service: "netflix", country: "IT" }))
    const bad = await PUT(putRequest({ streamingSelections: tooMany }) as unknown as NextRequest)
    expect(bad.status).toBe(400)
    const badSection = await PUT(
      putRequest({ streamingSelections: [{ service: "netflix", country: "IT", sections: ["shows"] }] }) as unknown as NextRequest,
    )
    expect(badSection.status).toBe(400)
    // Task F additive fields round-trip through the same PUT boundary.
    const withPolicy = await PUT(
      putRequest({
        streamingSelections: [
          { service: "hulu", country: "united-states", sections: ["movies", "series"], source: "flixpatrol" },
          { service: "rai", country: "italy", sections: ["series"], source: "auto", variant: "it" },
        ],
      }) as unknown as NextRequest,
    )
    expect(withPolicy.status).toBe(200)
  })
})

describe("streaming availability index", () => {
  // Captured real upstream shape (2026-10-22): `schema_version: 1`, section
  // presence with EMPTY variant arrays means the base chart EXISTS. Fictional
  // `schema: 1` + non-empty string payloads are not the contract.
  const doc = {
    schema_version: 1,
    generated_at: "2026-10-22T19:34:47Z",
    regions: {
      italy: {
        netflix: { movies: [], series: [] },
        paramount: { movies: [], overall: [], series: [] },
        crunchyroll: { overall: [] },
      },
      "united-states": {
        netflix: { movies: [], series: [] },
        paramount: { movies: [], overall: [], series: [] },
      },
    },
  }

  it("parses the real bounded index and rejects wrong schema versions", () => {
    const parsed = parseAvailabilityIndex(doc)
    expect(parsed?.generatedAt).toBe("2026-10-22T19:34:47Z")
    // Empty variant arrays count as coverage (presence = base chart exists).
    expect(parsed?.regions["italy"]["netflix"]).toEqual({ movies: true, series: true, overall: false })
    expect(parsed?.regions["italy"]["paramount"]).toEqual({ movies: true, series: true, overall: true })
    expect(parsed?.regions["italy"]["crunchyroll"]).toEqual({ movies: false, series: false, overall: true })
    expect(parseAvailabilityIndex({ ...doc, schema_version: 2 })).toBeNull()
    expect(parseAvailabilityIndex({ schema: 1, generated_at: doc.generated_at, regions: doc.regions })).toBeNull()
    expect(parseAvailabilityIndex({ nope: true })).toBeNull()
  })

  it("ignores prototype-polluting index keys (never __proto__ coverage)", () => {
    const evil = {
      schema_version: 1,
      generated_at: "2026-10-22T19:34:47Z",
      regions: {
        italy: { netflix: { movies: [], series: [] }, __proto__: { movies: [], series: [] } },
        __proto__: { netflix: { movies: [], series: [] } },
      },
    }
    const parsed = parseAvailabilityIndex(evil)
    expect(parsed).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(parsed!.regions, "__proto__")).toBe(false)
    expect(({} as Record<string, unknown>)["__proto__"]).not.toEqual({ movies: true })
  })

  it("builds honest choices: FP coverage, overall-only capability, no hulu/peacock claims", () => {
    const parsed = parseAvailabilityIndex(doc)!
    const choices = buildStreamingChoices(parsed.regions, true)
    // Supported subset only: every choice is a known service + RegionDef country.
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.every((c) => ["netflix", "prime", "disney", "now", "apple", "hbo", "paramount", "crunchyroll"].includes(c.service))).toBe(true)
    expect(choices.some((c) => c.catalogId.includes("hulu") || c.catalogId.includes("peacock"))).toBe(false)
    const netflixIt = choices.filter((c) => c.service === "netflix" && c.country === "IT")
    expect(netflixIt).toHaveLength(2)
    expect(netflixIt.every((c) => c.fpChart === true)).toBe(true)
    expect(netflixIt.every((c) => c.potential === "flixpatrol")).toBe(true)
    // Crunchyroll IT carries only an overall chart: no FP movies/series split
    // (dividing would invent ranks). The JW daily-chart fallback stays
    // available own-brand (`cru`), so the pair reports `justwatch` potential
    // with overallOnly capability — never an invented FP split.
    const crunchyIt = choices.filter((c) => c.service === "crunchyroll" && c.country === "IT")
    expect(crunchyIt).toHaveLength(2)
    expect(crunchyIt.every((c) => c.fpChart === false && c.overallOnly)).toBe(true)
    expect(crunchyIt.every((c) => c.potential === "justwatch" && c.jwFallback === true)).toBe(true)
    expect(String(crunchyIt[0].note)).toContain("overall")
    // NOW+US has no FP chart at all in the real index (absent, not overall):
    // unavailable without a Peacock alias.
    const nowUs = choices.filter((c) => c.service === "now" && c.country === "US")
    expect(nowUs).toHaveLength(2)
    expect(nowUs.every((c) => c.fpChart === false && !c.overallOnly && c.potential === "unavailable")).toBe(true)
    expect(nowUs[0].jwFallback).toBe(false)
    // Paramount IT is FP-covered on both sections (real index key `paramount`).
    const paramountIt = choices.filter((c) => c.service === "paramount" && c.country === "IT")
    expect(paramountIt).toHaveLength(2)
    expect(paramountIt.every((c) => c.fpChart === true && c.potential === "flixpatrol")).toBe(true)
    // Unknown countries are simply absent (never promised, never Italy).
    expect(choices.some((c) => c.country === "XX")).toBe(false)
  })

  it("supports service/country/section filters", () => {
    const parsed = parseAvailabilityIndex(doc)!
    expect(buildStreamingChoices(parsed.regions, true, { service: "netflix" }).every((c) => c.service === "netflix")).toBe(true)
    expect(buildStreamingChoices(parsed.regions, true, { country: "us" }).every((c) => c.country === "US")).toBe(true)
    expect(buildStreamingChoices(parsed.regions, true, { section: "movies" }).every((c) => c.section === "movies")).toBe(true)
  })

  it("honors source age honestly: an ancient generated_at is stale, not ok (coverage is not a chart-freshness guarantee)", async () => {
    const ancient = {
      schema_version: 1,
      generated_at: "2020-01-01T00:00:00Z",
      regions: doc.regions,
    }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(ancient))
    __clearStreamingAvailabilityCache()
    const res = await getStreamingAvailability({ service: "netflix", country: "IT" })
    // A freshly fetched but ancient upstream document must not read as `ok`:
    // index coverage alone never proves the underlying charts are fresh.
    expect(res.indexStatus).toBe("stale")
    expect(res.generatedAt).toBe("2020-01-01T00:00:00Z")
  })

  it("isolates opt-in families from legacy platform families (no shared-pin policy drift)", async () => {
    const { chartFamilyForCatalogRequest } = await import("@/lib/catalog-handler")
    type ResolveFn = typeof import("@/lib/ranking-source")["resolveRankingSource"]
    const justwatch = { kind: "justwatch", mode: "charts" } as ReturnType<ResolveFn>
    expect(chartFamilyForCatalogRequest("pictorium-stream-netflix-it-series", "series", justwatch, "IT")).toBe(
      "stream:netflix:series",
    )
    expect(chartFamilyForCatalogRequest("pictorium-netflix-series", "series", justwatch, "IT")).toBe(
      "platform:netflix:series",
    )
  })

  it("fetches the single fixed index URL and marks errors unknown (never false)", async () => {
    const seen: string[] = []
    // The shared fixture carries a pinned 2026-10-22 `generated_at` (kept
    // verbatim for the parse/persistence tests below); this fetch-behavior
    // test needs a source-fresh document to assert the `ok` path, so it
    // re-stamps the generation instant only. The ancient-source `stale` path
    // is covered by the dedicated test below.
    const freshDoc = { ...doc, generated_at: new Date().toISOString() }
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      seen.push(String(input))
      return Response.json(freshDoc)
    })
    const res = await getStreamingAvailability({ service: "netflix", country: "IT" })
    expect(res.indexStatus).toBe("ok")
    expect(seen).toEqual(["https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs/availability.json"])
    expect(res.choices.every((c) => c.service === "netflix" && c.country === "IT")).toBe(true)

    __clearStreamingAvailabilityCache()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"))
    const err = await getStreamingAvailability({})
    expect(err.indexStatus).toBe("error")
    expect(err.choices.every((c) => c.fpChart === "unknown")).toBe(true)
  })

  it("serves the read-only endpoint with filters and honest labels", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc))
    const req = new NextRequest("http://localhost:3000/api/streaming-availability?service=netflix&country=IT&section=movies")
    const res = await availabilityGET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const json = await res.json()
    expect(json.choices).toHaveLength(1)
    expect(json.choices[0]).toMatchObject({
      service: "netflix",
      country: "IT",
      section: "movies",
      catalogId: `${STREAMING_CATALOG_ID_PREFIX}netflix-it-movies`,
      fpChart: true,
      potential: "flixpatrol",
    })
    expect(json.choices[0].displayFp).toContain("FlixPatrol")
    expect(json.choices[0].displayJw).toContain("JustWatch")
  })

  it("c2: persisted normalized booleans reload identically after a restart (RED-before/GREEN-after disk roundtrip)", async () => {
    // Source index with mixed coverage: true from empty-variant arrays,
    // overall-only, and absent pairs. `generated_at` is ancient so the
    // reloaded disk snapshot reports `stale` — coverage must still match.
    const doc = {
      schema_version: 1,
      generated_at: "2020-01-01T00:00:00Z",
      regions: {
        italy: {
          netflix: { movies: [], series: [] },
          crunchyroll: { overall: [] },
        },
      },
    }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc))
    const first = await getStreamingAvailability({})
    expect(first.indexStatus).toBe("stale")
    const triple = (service: string, country: string): [unknown, unknown, unknown] => {
      const c = first.choices.find((x) => x.service === service && x.country === country && x.section === "movies")!
      const s = first.choices.find((x) => x.service === service && x.country === country && x.section === "series")!
      expect(c.overallOnly).toBe(s.overallOnly)
      return [c.fpChart, s.fpChart, c.overallOnly]
    }
    expect(triple("netflix", "IT")).toEqual([true, true, false])
    expect(triple("crunchyroll", "IT")).toEqual([false, false, true])
    expect(triple("now", "US")).toEqual([false, false, false])
    // Simulate a process restart: drop memory only (disk preserved), then
    // lose the network. The disk snapshot must serve the SAME coverage —
    // persisted `true` values must never reload as `false`.
    __clearStreamingAvailabilityMemory()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    const second = await getStreamingAvailability({})
    expect(second.indexStatus).toBe("stale")
    const tripleAfter = (service: string, country: string): [unknown, unknown, unknown] => {
      const c = second.choices.find((x) => x.service === service && x.country === country && x.section === "movies")!
      const s = second.choices.find((x) => x.service === service && x.country === country && x.section === "series")!
      return [c.fpChart, s.fpChart, c.overallOnly]
    }
    expect(tripleAfter("netflix", "IT")).toEqual([true, true, false])
    expect(tripleAfter("crunchyroll", "IT")).toEqual([false, false, true])
    expect(tripleAfter("now", "US")).toEqual([false, false, false])
  })

  it("c2: oversized chunked body without content-length is rejected without full buffering", async () => {
    let yielded = 0
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024))
    const totalChunks = 200 // ~3.2MB with no declared content-length
    const stream = new ReadableStream({
      pull(controller) {
        if (yielded >= totalChunks) {
          controller.close()
          return
        }
        yielded++
        controller.enqueue(chunk)
      },
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(stream as BodyInit, { status: 200 }))
    __clearStreamingAvailabilityCache()
    const res = await getStreamingAvailability({ service: "netflix", country: "IT" })
    expect(res.indexStatus).toBe("error")
    expect(res.choices.every((c) => c.fpChart === "unknown")).toBe(true)
    // Early cancel on overflow: the whole 3.2MB is never consumed.
    expect(yielded).toBeLessThan(totalChunks)
  })

  it("c2: oversized index payload is rejected from disk, never truncated to invalid JSON", async () => {
    // A valid 300-country x 64-service index whose fetched JSON stays under
    // the 1MB body cap but whose normalized persisted form exceeds the 1MB
    // disk cap (the persisted schema always carries all three section keys).
    // The in-memory entry must still serve; the disk write must be skipped
    // (a `.slice()`-truncated payload would poison restarts with invalid JSON).
    const regions: Record<string, unknown> = {}
    for (let c = 0; c < 300; c++) {
      const services: Record<string, unknown> = {}
      for (let s = 0; s < 64; s++) services[`s-${s}-` + "k".repeat(6)] = { movies: [] }
      regions[`c-${c}-` + "k".repeat(6)] = services
    }
    const doc = { schema_version: 1, generated_at: new Date().toISOString(), regions }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc))
    __clearStreamingAvailabilityCache()
    const res = await getStreamingAvailability({})
    expect(res.indexStatus).toBe("ok")
    const { default: path } = await import("node:path")
    const { default: fs } = await import("node:fs")
    const diskPath = path.join(process.cwd(), "test-results/streaming-selections-test", "streaming-availability.json")
    expect(fs.existsSync(diskPath)).toBe(false)
  })
})

describe("catalog serving per selection", () => {
  it("serves a selection with its own country region, list rank and FP source header", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never)
    const req = new NextRequest(
      `http://localhost:3000/catalog/series/${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json?api_key=k`,
    )
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json` }) })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt1000001")
    expect(body.metas[0].poster).toContain("region=IT")
    expect(body.metas[0].poster).toContain("rk=1")
    expect(mockedGetTop10).not.toHaveBeenCalled()
  })

  it("keeps legacy platform serving byte-identical (no header, no rank param, global region)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never)
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-netflix-series.json?api_key=k")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-netflix-series.json" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBeNull()
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].poster).toContain("region=IT")
    expect(body.metas[0].poster).not.toContain("rk=")
  })

  it("isolates countries: the same service in IT and US carries its own region", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 2, title: "Test Show" }], "justwatch") as never)
    const forCountry = async (cc: string) => {
      const req = new NextRequest(
        `http://localhost:3000/catalog/series/${STREAMING_CATALOG_ID_PREFIX}netflix-${cc}-series.json?api_key=k`,
      )
      const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}netflix-${cc}-series.json` }) })
      const body = await res.json()
      return { res, body }
    }
    const itRes = await forCountry("it")
    const usRes = await forCountry("us")
    expect(itRes.body.metas[0].poster).toContain("region=IT")
    expect(usRes.body.metas[0].poster).toContain("region=US")
    expect(itRes.res.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
    expect(usRes.res.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
  })

  it("reports the header on cache hits too", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never)
    const url = `http://localhost:3000/catalog/series/${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json?api_key=k`
    const first = await catalogGET(new NextRequest(url), { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json` }) })
    const second = await catalogGET(new NextRequest(url), { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json` }) })
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
  })

  it("404s malformed selection ids and section/type mismatches (never legacy fallback)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(LIVE_PIN as never)
    for (const [type, id] of [
      ["series", `${STREAMING_CATALOG_ID_PREFIX}hulu-us-series.json`],
      ["movie", `${STREAMING_CATALOG_ID_PREFIX}netflix-xx-movies.json`],
      ["movie", `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series.json`],
      ["series", `${STREAMING_CATALOG_ID_PREFIX}netflix-it-movies.json`],
    ] as const) {
      const res = await catalogGET(new NextRequest(`http://localhost:3000/catalog/${type}/${id}?api_key=k`), {
        params: Promise.resolve({ type, id }),
      })
      expect(res.status).toBe(404)
    }
  })

  it("NOW+US never aliases Peacock: JW snapshots are ignored, FP-only probe decides", async () => {
    mockTmdbFetch()
    // A legacy global-region request may have published JW rows for this
    // family + group: the selection must not serve them under the NOW name.
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 99, imdbId: "tt9999999", rank: 1, title: "Peacock Row" }], "justwatch") as never,
    )
    mockedResolveFlixSides.mockResolvedValue({
      movie: { kind: "miss" },
      tv: { kind: "hit", entries: [{ rank: 1, title: "NOW Show", tmdb: { id: 12, media_type: "tv", release_date: "2024-01-01" } }] },
      loadFailed: false,
    })
    const req = new NextRequest(
      `http://localhost:3000/catalog/series/${STREAMING_CATALOG_ID_PREFIX}now-us-series.json?api_key=k`,
    )
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}now-us-series.json` }) })
    expect(res.status).toBe(200)
    expect(mockedGetTop10).not.toHaveBeenCalled()
    expect(mockedResolveFlixSides).toHaveBeenCalledWith("now", "united-states")
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].poster).toContain("tt")
    expect(body.metas[0].poster).toContain("region=US")
    // Live (unpinned) window: honest "unknown", never a laundered source.
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
  })

  it("NOW+US with no FP chart is unavailable (empty, not Italian, not Peacock)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(LIVE_PIN as never)
    mockedResolveFlixSides.mockResolvedValue({ movie: { kind: "miss" }, tv: { kind: "miss" }, loadFailed: false })
    const req = new NextRequest(
      `http://localhost:3000/catalog/series/${STREAMING_CATALOG_ID_PREFIX}now-us-series.json?api_key=k`,
    )
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: `${STREAMING_CATALOG_ID_PREFIX}now-us-series.json` }) })
    expect(res.status).toBe(200)
    expect(mockedGetTop10).not.toHaveBeenCalled()
    expect((await res.json()).metas).toEqual([])
  })

  it("legacy NOW+US keeps its historic Peacock alias (no opt-in drift when no selection exists)", async () => {
    mockTmdbFetch()
    // Legacy platform catalogs never carry the opt-in header and resolve the
    // rank live: a published JW snapshot (historic Peacock group packages)
    // keeps serving under the legacy name.
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 99, imdbId: "tt9999999", rank: 1, title: "Peacock Row" }], "justwatch") as never)
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-now-series.json?api_key=k&region=US")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-now-series.json" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBeNull()
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt9999999")
  })
})
