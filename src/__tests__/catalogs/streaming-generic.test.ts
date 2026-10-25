/**
 * Task F slice: generic opt-in streaming universe (ALL fp-crawler Top 10
 * pairs, not just the 8 curated services x 22 RegionDef countries).
 *
 * Covers the backend contract extension + its isolation from legacy:
 * - generic sanitize/identity/cache keys (backward-accepting legacy 8xISO
 *   entries with byte-identical legacy ids; explicit `auto` behaves like
 *   absent; unknown slugs fail closed, never Italy);
 * - source-mode policy in renewal (auto = FP primary with declared JW
 *   fallback, flixpatrol-only = real FP charts only, justwatch-only = real
 *   own-brand JW only; strict modes never substitute silently);
 * - mixed `all` rows preserve order/rank/real media type (no
 *   duplication/splitting/renumbering);
 * - discovery counts/filters over the dynamic registry (Hulu/Peacock/WOW/
 *   Rai/global/outside-22, variant charts, no fake base);
 * - manifest exposure (legacy ids byte-identical, new `stream2-*` ids,
 *   mixed `all` type, source-neutral names) + namespace/token roundtrip;
 * - catalog serving per generic descriptor (selection chart-country,
 *   per-response source header, 404 on mismatch) and the read-only browse
 *   projection (original TMDB poster paths, zero poster-renderer traffic).
 *
 * Isolated from sibling slices: own DATA_DIR, own cache clears, file-scoped
 * module mocks (same pattern as streaming-selections.test.ts, disjoint dir).
 */
import fsp from "node:fs/promises"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-generic-test`,
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

vi.mock("@/lib/justwatch", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justwatch")>()
  return { ...mod, getJWRankings: vi.fn(), getJWTitles: vi.fn() }
})

import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { GET as browseGET } from "@/app/api/streaming-catalog/route"
import { GET as availabilityGET } from "@/app/api/streaming-availability/route"
import { cacheClear } from "@/lib/cache"
import { encodeConfig, decodeConfig } from "@/lib/config-token"
import { getById } from "@/lib/store"
import { ensureFreshChartFamily, fetchChartFamilyRows } from "@/lib/chart-renewal"
import { getJWRankings } from "@/lib/justwatch"
import { __clearFlixpatrolCache } from "@/lib/flixpatrol"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import {
  GENERIC_STREAMING_CATALOG_ID_PREFIX,
  STREAMING_SOURCE_HEADER,
  chartCountryInfo,
  genericServiceShortName,
  genericStreamFamily,
  genericStreamingCatalogId,
  genericVariantLabel,
  parseAnyStreamingCatalogId,
  parseGenericStreamFamily,
  parseGenericStreamingCatalogId,
  sanitizeGenericStreamingSelections,
} from "@/lib/streaming-catalogs"
import {
  __clearStreamingAvailabilityCache,
  buildGenericStreamingChoices,
  parseAvailabilityIndex,
} from "@/lib/streaming-availability"

const mockedGetById = vi.mocked(getById)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)
const mockedGetJWRankings = vi.mocked(getJWRankings)

function tmdbDetails(id: number, name: string, posterPath = "/poster.jpg") {
  return {
    id,
    title: name,
    release_date: "2024-05-01",
    vote_average: 7.5,
    poster_path: posterPath,
    backdrop_path: "/bd.jpg",
    genres: [{ id: 18, name: "Dramma" }],
    overview: "Overview",
  }
}

function mockTmdbFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (url.includes("justwatch") || url.includes("graphql")) throw new Error("JW must not be touched here")
    if (url.includes("/images")) return Response.json({ logos: [] })
    if (url.includes("/external_ids")) return Response.json({ imdb_id: "tt9000001" })
    const m = /\/(movie|tv)\/(\d+)/.exec(url)
    if (m) {
      const id = Number(m[2])
      return Response.json(tmdbDetails(id, m[1] === "movie" ? `Test Film ${id}` : `Test Show ${id}`, `/p${id}.jpg`))
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  })
}

function pinWith(
  rows: Array<{ tmdbId: number; imdbId: string | null; rank: number; title: string; mediaType?: "movie" | "tv" }>,
  provenance: string | null,
  family = "stream2:auto:hulu:united-states:series:-",
) {
  return {
    id: "20261022-00",
    snapshot: {
      generation: "20261022-00",
      group: "g",
      family,
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
  mockedEnsureFresh.mockReset()
  mockedGetJWRankings.mockReset()
  __clearStreamingAvailabilityCache()
  __clearFlixpatrolCache()
  const { setServerDefaults } = await import("@/lib/server-defaults")
  await setServerDefaults({})
})

afterEach(async () => {
  vi.restoreAllMocks()
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
  // Settle fire-and-forget cache writes before the next test / teardown.
  await new Promise((r) => setTimeout(r, 50))
})

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  await fsp.rm(`${process.cwd()}/test-results/streaming-generic-test`, { recursive: true, force: true }).catch(() => {})
  await new Promise((r) => setTimeout(r, 50))
  await fsp.rm(`${process.cwd()}/test-results/streaming-generic-test`, { recursive: true, force: true }).catch(() => {})
})

describe("generic descriptors (sanitize/identity/isolation)", () => {
  it("passes undefined through (absent = legacy) and bounds entries at 200", () => {
    expect(sanitizeGenericStreamingSelections(undefined)).toBeUndefined()
    expect(sanitizeGenericStreamingSelections(null)).toBeUndefined()
    expect(sanitizeGenericStreamingSelections([])).toEqual([])
    const many = Array.from({ length: 500 }, () => ({ service: "hulu", country: "united-states" }))
    expect(sanitizeGenericStreamingSelections(many)).toHaveLength(200)
  })

  it("backward-accepts legacy 8xISO entries with legacy:true (absent and explicit auto)", () => {
    for (const raw of [
      { service: "netflix", country: "IT" },
      { service: "prime", country: "united-states", sections: ["movies"] as const },
      { service: "now", country: "GB", sections: ["movies", "series"] as const, enabled: false, source: "auto" },
    ]) {
      const out = sanitizeGenericStreamingSelections([raw])!
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({
        service: raw.service,
        source: "auto",
        variant: null,
        legacy: true,
      })
    }
    expect(sanitizeGenericStreamingSelections([{ service: "netflix", country: "IT" }])![0]).toMatchObject({
      chartSlug: "italy",
      country: "IT",
      sections: ["movies", "series"],
      enabled: true,
    })
  })

  it("normalizes generic services/slugs without Italy fallback and keeps source/variant", () => {
    const out = sanitizeGenericStreamingSelections([
      { service: "hulu", country: "united-states", source: "flixpatrol" },
      { service: "wow", country: "germany", sections: ["movies"], source: "justwatch" },
      { service: "rai", country: "italy", sections: ["series"], variant: "it" },
      { service: "netflix", country: "global", sections: ["movies", "series"] },
      { service: "hotstar", country: "india", sections: ["all"] },
      { service: "netflix", country: "albania", sections: ["movies"] },
      // Dropped fail-closed (never Italy, never another service):
      { service: "hulu", country: "XX" },
      { service: "nope--x", country: "IT" },
      { service: "hulu", country: "atlantis" },
      { service: "x".repeat(65), country: "IT" },
    ])! as Array<{ service: string; chartSlug: string; legacy: boolean }>
    expect(out.map((e) => [e.service, e.chartSlug, e.legacy])).toEqual([
      ["hulu", "united-states", false],
      ["wow", "germany", false],
      ["rai", "italy", false],
      ["netflix", "global", false],
      ["hotstar", "india", false],
      ["netflix", "albania", false],
    ])
    expect(out[0]).toMatchObject({ source: "flixpatrol", variant: null, country: "US" })
    expect(out[2]).toMatchObject({ source: "auto", variant: "it" })
    expect(out[4]).toMatchObject({ sections: ["all"] })
    expect(out[5]).toMatchObject({ chartSlug: "albania", country: "ALBANIA" })
  })

  it("fails garbage sources and garbage variants closed (drop, never silent base)", () => {
    // Correction c3/M2: a present-but-invalid `source` drops the entry (never a
    // silent switch to `auto`); a present-but-invalid `variant` drops the entry
    // too (never a silent coerce to base). Absent/null/"" stays base.
    const out = sanitizeGenericStreamingSelections([
      { service: "hulu", country: "US", source: "sometimes", variant: "" },
      { service: "hulu", country: "US", source: "JUSTWATCH", variant: "BAD--V" },
      { service: "hulu", country: "US", variant: "BAD--V" },
      { service: "hulu", country: "US", source: "auto", variant: "--evil" },
    ])! as Array<{ source: string; variant: string | null }>
    expect(out).toHaveLength(0)
  })

  it("derives stable unambiguous ids and parses them back", () => {
    const id = genericStreamingCatalogId("hulu", "united-states", "series", "flixpatrol")
    expect(id).toBe(`${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--united-states--series--flixpatrol`)
    expect(parseGenericStreamingCatalogId(id)).toEqual({
      service: "hulu",
      chartSlug: "united-states",
      section: "series",
      source: "flixpatrol",
      variant: null,
    })
    const allId = genericStreamingCatalogId("crave", "canada", "all", "auto", "amazon-channels")
    expect(parseGenericStreamingCatalogId(allId)).toMatchObject({ section: "all", variant: "amazon-channels" })
    // Malformed ids never parse (no silent fallback, no traversal):
    for (const bad of [
      "pictorium-stream-hulu-us-series",
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--united-states--shows--auto`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--united-states--series--sometimes`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hu--lu--united-states--series--auto`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--atlantis--series--auto`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--united-states--series--auto--`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}HULU--united-states--series--auto`,
      `${GENERIC_STREAMING_CATALOG_ID_PREFIX}hulu--united-states--series`,
    ]) {
      expect(parseGenericStreamingCatalogId(bad)).toBeNull()
    }
    // Legacy ids parse through the unified parser as source auto:
    expect(parseAnyStreamingCatalogId("pictorium-stream-netflix-it-series")).toMatchObject({
      service: "netflix",
      chartSlug: "italy",
      source: "auto",
      variant: null,
    })
    expect(parseAnyStreamingCatalogId(id)).toMatchObject({ service: "hulu", source: "flixpatrol" })
    expect(parseAnyStreamingCatalogId("pictorium-netflix-series")).toBeNull()
  })

  it("isolates chart families per full descriptor (source choices never share pins)", () => {
    const fp = parseGenericStreamingCatalogId(genericStreamingCatalogId("hulu", "united-states", "series", "flixpatrol"))!
    const jw = parseGenericStreamingCatalogId(genericStreamingCatalogId("hulu", "united-states", "series", "justwatch"))!
    const auto = parseGenericStreamingCatalogId(genericStreamingCatalogId("hulu", "united-states", "series", "auto"))!
    const fams = [genericStreamFamily(fp), genericStreamFamily(jw), genericStreamFamily(auto)]
    expect(new Set(fams).size).toBe(3)
    for (const f of fams) {
      expect(parseGenericStreamFamily(f)).toBeTruthy()
    }
    expect(parseGenericStreamFamily("stream:hulu:series")).toBeNull()
    expect(parseGenericStreamFamily("stream2:auto:hulu:atlantis:series:-")).toBeNull()
  })

  it("prettifies unknown services/countries without claiming brands", () => {
    expect(genericServiceShortName("netflix")).toBe("Netflix")
    expect(genericServiceShortName("hulu")).toBe("Hulu")
    expect(genericServiceShortName("peacock")).toBe("Peacock")
    expect(genericServiceShortName("some-new-service")).toBe("Some New Service")
    expect(genericVariantLabel("hi")).toBe("Hindi")
    expect(genericVariantLabel("xx-yy")).toBe("Xx Yy")
    expect(chartCountryInfo("italy")).toMatchObject({ code: "IT", knownRegion: true })
    // US/Germany/Canada/Japan are RegionDef countries (JW-capable slugs);
    // Albania is not (FP-only, synthesized code — never Italy).
    expect(chartCountryInfo("united-states")).toMatchObject({ code: "US", knownRegion: true })
    expect(chartCountryInfo("albania")).toMatchObject({ code: "ALBANIA", knownRegion: false })
    expect(chartCountryInfo("global")).toMatchObject({ code: "GLOBAL" })
  })
})

describe("generic discovery over the dynamic registry", () => {
  // Real-format index excerpt: base + variant charts, overall-only pairs,
  // global, and a country outside the 22 RegionDef (Albania proves the 119
  // path; US/Germany/Canada/Japan are RegionDef). `generated_at` is fresh
  // so the endpoint reports the honest `ok` status.
  const doc = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    regions: {
      italy: {
        netflix: { movies: [], series: [] },
        rai: { movies: [], overall: [], series: ["it"] },
        paramount: { movies: [], overall: [], series: [] },
        crunchyroll: { overall: [] },
      },
      "united-states": {
        hulu: { movies: [], overall: [], series: [] },
        netflix: { movies: [], series: [] },
      },
      germany: {
        wow: { movies: [], series: [] },
      },
      canada: {
        crave: { overall: ["amazon-channels"] },
      },
      japan: {
        "hulu-nippon": { movies: ["ja"], overall: [], series: ["ja", "ko"] },
      },
      albania: {
        netflix: { movies: [], series: [] },
      },
      global: {
        netflix: { movies: [], series: [] },
      },
    },
  }

  it("parses feed variant ids alongside base-chart coverage", () => {
    const parsed = parseAvailabilityIndex(doc)!
    expect(parsed.variants["italy"]?.["rai"]).toEqual({ movies: [], series: ["it"], overall: [] })
    expect(parsed.variants["canada"]?.["crave"]).toEqual({ movies: [], series: [], overall: ["amazon-channels"] })
    expect(parsed.variants["japan"]?.["hulu-nippon"]).toEqual({ movies: ["ja"], series: ["ja", "ko"], overall: [] })
    expect(parsed.variants["italy"]?.["netflix"]).toBeUndefined()
    expect(parsed.regions["italy"]?.["rai"]).toEqual({ movies: true, series: true, overall: true })
  })

  it("suppresses legacy-identical coverage but exposes the full generic universe (auto)", () => {
    const parsed = parseAvailabilityIndex(doc)!
    const choices = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { source: "auto" })
    const ids = new Set(choices.map((c) => c.catalogId))
    // Legacy-identical (netflix/it auto base, no variant) stays on legacy ids:
    expect([...ids].some((id) => id.includes("netflix--italy--"))).toBe(false)
    expect(choices.some((c) => c.service === "netflix" && c.country === "IT")).toBe(false)
    // Full universe present: Hulu USA, WOW Germany, Rai Italy (variant-only
    // series: no fictitious base — the real country doc carries only
    // `rai.series-it`), Crave Canada (variant-only `all`, no base+variant
    // duplicate), Hulu-Nippon Japan (variant-only movies/series + base
    // overall), Albania (outside-22), global.
    const has = (service: string, slug: string, section: string, variant: string | null = null) =>
      choices.find((c) => c.service === service && c.chartSlug === slug && c.section === section && c.variant === variant)
    expect(has("hulu", "united-states", "movies")).toBeTruthy()
    expect(has("hulu", "united-states", "series")).toBeTruthy()
    expect(has("wow", "germany", "movies")).toBeTruthy()
    // Variant-only sections emit the exact variant choice only (correction
    // c1): no base `rai series`, no base `crave all`, no base hulu-nippon
    // movies/series (their arrays are non-empty variant ids).
    expect(has("rai", "italy", "series")).toBeFalsy()
    expect(has("rai", "italy", "series", "it")).toBeTruthy()
    expect(has("crave", "canada", "all")).toBeFalsy()
    expect(has("crave", "canada", "all", "amazon-channels")).toBeTruthy()
    expect(has("hulu-nippon", "japan", "movies")).toBeFalsy()
    expect(has("hulu-nippon", "japan", "movies", "ja")).toBeTruthy()
    expect(has("hulu-nippon", "japan", "series")).toBeFalsy()
    expect(has("hulu-nippon", "japan", "series", "ko")).toBeTruthy()
    // Base `overall` charts ([] empty array) still emit (no over-pruning).
    expect(has("hulu-nippon", "japan", "all")).toBeTruthy()
    expect(has("rai", "italy", "all")).toBeTruthy()
    expect(has("netflix", "albania", "movies")).toBeTruthy()
    expect(has("netflix", "global", "series")).toBeTruthy()
    // Overall-only pairs never split into fake bases: Crave Canada has no
    // movies/series base, only explicit unavailable + overallOnly entries.
    const craveMovies = choices.filter((c) => c.service === "crave" && c.section === "movies")
    expect(craveMovies).toHaveLength(1)
    expect(craveMovies[0]).toMatchObject({ potential: "unavailable", overallOnly: true, fpChart: false })
    // Hulu USA (real FP charts, no verified JW pair): flixpatrol via FP.
    expect(has("hulu", "united-states", "series")).toMatchObject({ fpChart: true, potential: "flixpatrol" })
    // Variant metadata rides along for the UI (no extra fetch):
    expect(has("rai", "italy", "series", "it")?.variants).toEqual(["it"])
    // Neutral names never claim a source; variant catalogs are labeled.
    for (const c of choices) {
      expect(c.displayFp).toContain("Top 10 · FlixPatrol")
      expect(String(c.serviceName).toLowerCase()).not.toContain("flixpatrol")
    }
    expect(has("rai", "italy", "series", "it")?.displayFp).toContain("Italian")
  })

  it("applies strict source policies (no silent substitution)", () => {
    const parsed = parseAvailabilityIndex(doc)!
    // flixpatrol-only: FP-covered pairs stay flixpatrol; pairs without an FP
    // chart are unavailable (never justwatch, even where a JW pair exists).
    const fpOnly = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { source: "flixpatrol" })
    const fp = (service: string, slug: string, section: string) =>
      fpOnly.find((c) => c.service === service && c.chartSlug === slug && c.section === section)
    expect(fp("hulu", "united-states", "series")).toMatchObject({ potential: "flixpatrol" })
    // Crunchyroll IT has no FP movies chart: unavailable in flixpatrol-only
    // (overall is never split), with the overallOnly capability flag.
    expect(fp("crunchyroll", "italy", "movies")).toMatchObject({ potential: "unavailable", overallOnly: true })
    expect(fpOnly.some((c) => c.potential === "justwatch")).toBe(false)
    // justwatch-only: only verified own-brand pairs are listed at all.
    const jwOnly = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { source: "justwatch" })
    expect(jwOnly.length).toBeGreaterThan(0)
    expect(jwOnly.every((c) => c.potential === "justwatch")).toBe(true)
    // Paramount IT (verified pmp pair) is offered; Hulu USA / WOW DE /
    // Albania / global are omitted entirely (unsupported, never guessed).
    expect(jwOnly.some((c) => c.service === "paramount" && c.chartSlug === "italy")).toBe(true)
    expect(jwOnly.some((c) => c.chartSlug === "united-states" && c.service === "hulu")).toBe(false)
    expect(jwOnly.some((c) => c.service === "wow")).toBe(false)
    expect(jwOnly.some((c) => c.chartSlug === "albania")).toBe(false)
    expect(jwOnly.some((c) => c.chartSlug === "global")).toBe(false)
    expect(jwOnly.some((c) => c.section === "all")).toBe(false)
    // Crunchyroll IT (overall-only + verified cru pair): movies/series stay
    // justwatch-eligible via the real JW chart with the overallOnly flag.
    const crunchy = jwOnly.filter((c) => c.service === "crunchyroll" && c.chartSlug === "italy")
    expect(crunchy).toHaveLength(2)
    expect(crunchy.every((c) => c.potential === "justwatch" && c.overallOnly)).toBe(true)
  })

  it("filters by service/country/section and matches nothing unknown", () => {
    const parsed = parseAvailabilityIndex(doc)!
    const byCountryCode = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { country: "US" })
    expect(byCountryCode.length).toBeGreaterThan(0)
    expect(byCountryCode.every((c) => c.chartSlug === "united-states")).toBe(true)
    const bySlug = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { country: "united-states" })
    expect(bySlug).toHaveLength(byCountryCode.length)
    expect(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { service: "hulu", country: "IT" }),
    ).toHaveLength(0)
    expect(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { service: "nosuch", country: "IT" }),
    ).toHaveLength(0)
    expect(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { country: "XX" }),
    ).toHaveLength(0)
    expect(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { section: "all" }).every(
        (c) => c.section === "all",
      ),
    ).toBe(true)
    expect(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { section: "shows" }).length,
    ).toBe(
      buildGenericStreamingChoices(parsed.regions, parsed.variants, true, {}).length,
    )
  })

  it("serves the read-only endpoint with source filter and honest labels", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc))
    const auto = await availabilityGET(
      new NextRequest("http://localhost:3000/api/streaming-availability?service=hulu&country=US"),
    )
    expect(auto.status).toBe(200)
    const autoJson = await auto.json()
    expect(autoJson.indexStatus).toBe("ok")
    expect(autoJson.choices.length).toBeGreaterThan(0)
    expect(autoJson.choices.every((c: { service: string }) => c.service === "hulu")).toBe(true)
    expect(autoJson.choices.some((c: { catalogId: string }) => String(c.catalogId).includes("stream2-"))).toBe(true)
    const fpOnly = await (
      await availabilityGET(
        new NextRequest("http://localhost:3000/api/streaming-availability?service=hulu&country=US&source=flixpatrol"),
      )
    ).json()
    expect(fpOnly.choices.every((c: { potential: string }) => c.potential !== "justwatch")).toBe(true)
    const jwOnly = await (
      await availabilityGET(
        new NextRequest("http://localhost:3000/api/streaming-availability?service=hulu&country=US&source=justwatch"),
      )
    ).json()
    expect(jwOnly.choices).toEqual([])
  })
})

describe("manifest exposure (legacy byte-identical, generic additive)", () => {
  it("keeps legacy ids byte-identical and emits stream2 + mixed all ids", async () => {
    const { setServerDefaults } = await import("@/lib/server-defaults")
    await setServerDefaults({
      streamingSelections: [
        { service: "netflix", country: "IT" },
        { service: "hulu", country: "united-states", sections: ["movies", "series"], source: "flixpatrol" },
        { service: "rai", country: "italy", sections: ["series"], variant: "it" },
        { service: "crave", country: "canada", sections: ["all"], source: "auto", variant: "amazon-channels" },
        { service: "now", country: "US", sections: ["movies"], enabled: false },
      ],
    })
    const { buildManifestResponse } = await import("@/lib/build-manifest")
    const res = await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))
    const json = await res.json()
    const ids = json.catalogs.map((c: { id: string }) => c.id)
    // Legacy byte-identical:
    expect(ids).toContain("pictorium-stream-netflix-it-movies")
    expect(ids).toContain("pictorium-stream-netflix-it-series")
    // Generic additive (source + variant encoded, no legacy alias):
    expect(ids).toContain("pictorium-stream2-hulu--united-states--movies--flixpatrol")
    expect(ids).toContain("pictorium-stream2-hulu--united-states--series--flixpatrol")
    expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it")
    expect(ids).toContain("pictorium-stream2-crave--canada--all--auto--amazon-channels")
    expect(ids.some((id: string) => id.includes("now--") && id.includes("us"))).toBe(false)
    // Mixed overall uses the Stremio mixed type; names stay source-neutral.
    const byId = new Map(json.catalogs.map((c: { id: string; name: string; type: string }) => [c.id, c]))
    expect(byId.get("pictorium-stream2-crave--canada--all--auto--amazon-channels")).toMatchObject({ type: "all" })
    for (const [, cat] of byId) {
      expect(String((cat as { name: string }).name).toLowerCase()).not.toContain("flixpatrol")
      expect(String((cat as { name: string }).name).toLowerCase()).not.toContain("justwatch")
    }
  })

  it("round-trips source/variant through config tokens (catalog-only included)", () => {
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
    const selections: Array<{
      service: string
      country: string
      sections?: Array<"movies" | "series" | "all">
      source?: "auto" | "flixpatrol" | "justwatch"
      variant?: string
    }> = [
      { service: "hulu", country: "united-states", source: "flixpatrol" },
      { service: "rai", country: "italy", sections: ["series"], variant: "it" },
    ]
    expect(decodeConfig(encodeConfig({ ...base, streamingSelections: selections }))?.streamingSelections).toEqual(
      selections,
    )
  })
})

describe("catalog serving per generic descriptor", () => {
  const HULU_SERIES = "pictorium-stream2-hulu--united-states--series--flixpatrol"
  const CRAVE_ALL = "pictorium-stream2-crave--canada--all--auto--amazon-channels"

  it("serves a generic selection with its chart country and FP source header, without automatic rank override", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const req = new NextRequest(`http://localhost:3000/catalog/series/${HULU_SERIES}.json?api_key=k`)
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: `${HULU_SERIES}.json` }) })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt1000001")
    expect(body.metas[0].type).toBe("series")
    expect(body.metas[0].poster).toContain("region=US")
    // Stream lists never supply their own rank: the badge resolves live
    // (general JW/Anime Top 20), so no rk= is emitted.
    expect(body.metas[0].poster).not.toContain("rk=")
  })

  it("preserves order/rank/real media type in mixed all lists (per-item types + movie hints)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith(
        [
          { tmdbId: 21, imdbId: "tt2000001", rank: 1, title: "Mixed Film", mediaType: "movie" },
          { tmdbId: 22, imdbId: null, rank: 2, title: "Mixed Show", mediaType: "tv" },
        ],
        "flixpatrol",
      ) as never,
    )
    const req = new NextRequest(`http://localhost:3000/catalog/all/${CRAVE_ALL}.json?api_key=k`)
    const res = await catalogGET(req, { params: Promise.resolve({ type: "all", id: `${CRAVE_ALL}.json` }) })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    const body = await res.json()
    expect(body.metas).toHaveLength(2)
    // Same order, real per-item types (never renumbered/split); rank badges
    // resolve live (general JW/Anime Top 20), so no automatic rk= is
    // emitted on mixed rows either.
    expect(body.metas[0].type).toBe("movie")
    expect(body.metas[0].id).toBe("tt2000001")
    expect(body.metas[0].poster).not.toContain("rk=")
    expect(body.metas[1].type).toBe("series")
    expect(body.metas[1].id).toBe("tmdb:22")
    expect(body.metas[1].poster).not.toContain("rk=")
    // Movie items carry Easy-parity video navigation; series items do not.
    expect(body.metas[0].behaviorHints).toMatchObject({ defaultVideoId: "tt2000001", hasScheduledVideos: false })
    // Easy parity: no scheduled videos on movie items.
    expect(body.metas[0].videos).toEqual([])
    expect(body.metas[1].behaviorHints).toBeUndefined()
    expect(body.metas[1].videos).toBeUndefined()
  })

  it("404s section/type mismatches and non-mixed all usage (never a silent series fill)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(LIVE_PIN as never)
    const cases = [
      ["series", "pictorium-stream2-hulu--united-states--movies--flixpatrol.json"],
      ["movie", "pictorium-stream2-hulu--united-states--series--flixpatrol.json"],
      ["series", `${CRAVE_ALL}.json`],
      ["movie", `${CRAVE_ALL}.json`],
      ["all", "pictorium-stream2-hulu--united-states--series--flixpatrol.json"],
      ["all", "pictorium-netflix-series.json"],
      ["all", "pictorium-jw-series.json"],
      ["all", "pictorium-stream-netflix-it-series.json"],
    ] as const
    for (const [type, id] of cases) {
      const res = await catalogGET(new NextRequest(`http://localhost:3000/catalog/${type}/${id}?api_key=k`), {
        params: Promise.resolve({ type, id }),
      })
      expect(res.status).toBe(404)
    }
  })

  it("reports justwatch for eligible justwatch-only pins and unknown for unavailable strict modes", async () => {
    mockTmdbFetch()
    const JW_ID = "pictorium-stream2-prime--italy--series--justwatch"
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 31, imdbId: "tt3000001", rank: 1, title: "JW Show" }], "justwatch") as never,
    )
    const jwRes = await catalogGET(new NextRequest(`http://localhost:3000/catalog/series/${JW_ID}.json?api_key=k`), {
      params: Promise.resolve({ type: "series", id: `${JW_ID}.json` }),
    })
    expect(jwRes.status).toBe(200)
    expect(jwRes.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
    expect((await jwRes.json()).metas).toHaveLength(1)
    // Strict flixpatrol-only with no snapshot: honest empty + unknown (never JW).
    mockedEnsureFresh.mockResolvedValue(LIVE_PIN as never)
    const fpRes = await catalogGET(new NextRequest(`http://localhost:3000/catalog/series/${HULU_SERIES}.json?api_key=k`), {
      params: Promise.resolve({ type: "series", id: `${HULU_SERIES}.json` }),
    })
    expect(fpRes.status).toBe(200)
    expect(fpRes.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
    expect((await fpRes.json()).metas).toEqual([])
  })
})

describe("read-only browse projection (original TMDB posters, no renderer traffic)", () => {  const HULU_SERIES = "pictorium-stream2-hulu--united-states--series--flixpatrol"

  it("projects pinned rows with original poster paths and actual source", async () => {
    const seen: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/images")) return Response.json({ logos: [] })
      if (url.includes("/external_ids")) return Response.json({ imdb_id: "tt9000001" })
      const m = /\/(movie|tv)\/(\d+)/.exec(url)
      if (m) {
        const id = Number(m[2])
        return Response.json(tmdbDetails(id, `Test Title ${id}`, `/p${id}.jpg`))
      }
      throw new Error(`unexpected fetch in test: ${url}`)
    })
    mockedEnsureFresh.mockResolvedValue(
      pinWith(
        [
          { tmdbId: 41, imdbId: null, rank: 1, title: "Row One", mediaType: "tv" },
          { tmdbId: 42, imdbId: null, rank: 2, title: "Row Two", mediaType: "tv" },
        ],
        "flixpatrol",
      ) as never,
    )
    const res = await browseGET(new NextRequest(`http://localhost:3000/api/streaming-catalog?catalog=${HULU_SERIES}&api_key=k`))
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    const body = await res.json()
    expect(body.catalogId).toBe(HULU_SERIES)
    expect(body.service).toBe("hulu")
    expect(body.chartSlug).toBe("united-states")
    expect(body.source).toBe("flixpatrol")
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toMatchObject({ tmdbId: 41, mediaType: "tv", rank: 1, posterPath: "/p41.jpg" })
    expect(body.items[1]).toMatchObject({ tmdbId: 42, rank: 2, posterPath: "/p42.jpg" })
    // Zero poster-renderer traffic and no per-title images/external_ids/logo:
    expect(seen.some((u) => u.includes("/api/poster"))).toBe(false)
    expect(seen.some((u) => u.includes("/images"))).toBe(false)
    expect(seen.some((u) => u.includes("/external_ids"))).toBe(false)
    expect(seen.some((u) => u.includes("/logo"))).toBe(false)
  })

  it("404s unknown catalog ids and reports cache hits with the same source", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([{ tmdbId: 11, imdbId: null, rank: 1, title: "X" }], "justwatch") as never)
    const bad = await browseGET(new NextRequest("http://localhost:3000/api/streaming-catalog?catalog=nope&api_key=k"))
    expect(bad.status).toBe(404)
    const url = `http://localhost:3000/api/streaming-catalog?catalog=${HULU_SERIES}&api_key=k`
    const first = await browseGET(new NextRequest(url))
    const second = await browseGET(new NextRequest(url))
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
    expect((await second.json()).items).toHaveLength(1)
  })
})

describe("generic renewal policy (strict sources, failure retention)", () => {
  const FIXED_NOW = Date.UTC(2026, 9, 22, 8, 0, 0) // Rome 2026-10-22 10:00 -> slot 20261022-00

  function huluSeriesDoc(entries: unknown[]) {
    return {
      date: "October 22, 2026",
      scraped_at_utc: "2026-10-22T08:00:00.000Z",
      charts: [
        {
          catalog_id: "hulu.series",
          platform: "Hulu",
          category: "tv shows",
          date: "October 22, 2026",
          entries,
        },
      ],
    }
  }

  const huluEntry = (id: number, rank: number) => ({
    rank,
    title: `Hulu Show ${id}`,
    tmdb: { id, media_type: "tv", release_date: "2024-01-01" },
  })

  function mockFpFiles(files: Record<string, unknown>, opts?: { throwOn?: RegExp }) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (opts?.throwOn?.test(url)) throw new Error("fp-crawler down")
      if (url.includes("justwatch") || url.includes("graphql")) throw new Error("unexpected JW traffic")
      for (const [slug, doc] of Object.entries(files)) {
        if (url.includes(`${slug}.json`)) return Response.json(doc)
      }
      throw new Error(`unexpected upstream: ${url.slice(0, 120)}`)
    })
  }

  function ctxFor(family: string) {
    // Realistic region codes per chart slug (group identity only; the
    // renewal resolves JW eligibility from the family itself).
    const slug = family.split(":")[3] ?? ""
    const code = slug === "italy" ? "IT" : slug === "germany" ? "DE" : slug === "canada" ? "CANADA" : "US"
    return {
      regionCode: code,
      regionLang: "en-US",
      mdblistKey: null as string | null,
      tmdbLang: "en-US",
      tmdbKey: undefined as string | undefined,
      // A future floor forces a real upstream read every time: the file
      // cache (shared DATA_DIR) must never mask an outage fixture.
      floor: FIXED_NOW + 3_600_000,
    }
  }

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW)
  })

  it("flixpatrol-only serves real FP rows with zero JW traffic", async () => {
    const seen: string[] = []
    mockFpFiles({ "united-states": huluSeriesDoc([huluEntry(701, 1), huluEntry(702, 2)]) })
    const spy = vi.spyOn(globalThis, "fetch")
    const res = await fetchChartFamilyRows("stream2:flixpatrol:hulu:united-states:series:-", ctxFor("x:united-states:"))
    expect(res.status).toBe("ok")
    expect(res.provenance).toBe("flixpatrol")
    expect((res.rows as Array<{ tmdbId: number }>).map((r) => r.tmdbId)).toEqual([701, 702])
    for (const call of spy.mock.calls) seen.push(String(call[0]))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((u) => !u.includes("justwatch") && !u.includes("graphql"))).toBe(true)
  })

  it("flixpatrol-only retains on outage (throws) but publishes genuine absent/stale as empty", async () => {
    // Outage: transport failure -> throws (retention + 60s gate upstream).
    mockFpFiles({}, { throwOn: /united-states\.json/ })
    await expect(
      fetchChartFamilyRows("stream2:flixpatrol:hulu:united-states:series:-", ctxFor("x:united-states:")),
    ).rejects.toThrow()
    // Absent split: genuine unavailable empty, no throw. NOTE: the country
    // document must be NON-empty (it carries other charts) — a whole
    // `charts: []` document is quarantined as an integrity failure and
    // throws instead (covered in flixpatrol-empty-country.test.ts).
    mockFpFiles({
      "united-states": {
        date: "October 22, 2026",
        charts: [
          {
            catalog_id: "netflix.movies",
            platform: "Netflix",
            category: "movies",
            date: "October 22, 2026",
            entries: [{ rank: 1, title: "Other", tmdb: { id: 11, media_type: "movie", release_date: "2024-01-01" } }],
          },
        ],
      },
    })
    const absent = await fetchChartFamilyRows("stream2:flixpatrol:hulu:united-states:series:-", ctxFor("x:united-states:"))
    expect(absent).toMatchObject({ status: "empty", rows: [] })
    expect(absent.provenance ?? null).toBeNull()
    // Stale chart: genuinely unavailable for this cycle, no throw.
    mockFpFiles({
      "united-states": {
        date: "October 20, 2026",
        charts: [
          {
            catalog_id: "hulu.series",
            platform: "Hulu",
            category: "tv shows",
            date: "October 20, 2026",
            entries: [huluEntry(701, 1)],
          },
        ],
      },
    })
    const stale = await fetchChartFamilyRows("stream2:flixpatrol:hulu:united-states:series:-", ctxFor("x:united-states:"))
    expect(stale).toMatchObject({ status: "empty", rows: [] })
  })

  it("justwatch-only uses only verified own-brand JW (no FP traffic), omits unsupported pairs silently", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no FP traffic allowed on the justwatch-only path")
    })
    mockedGetJWRankings.mockResolvedValue([
      { tmdbId: 901, imdbId: "tt9000001", rank: 1, title: "Prime Show" },
      { tmdbId: 902, imdbId: null, rank: 2, title: "Prime Show 2" },
    ])
    const res = await fetchChartFamilyRows("stream2:justwatch:prime:italy:series:-", ctxFor("x:italy:"))
    expect(res.status).toBe("ok")
    expect(res.provenance).toBe("justwatch")
    expect((res.rows as Array<{ tmdbId: number }>).map((r) => r.tmdbId)).toEqual([901, 902])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedGetJWRankings).toHaveBeenCalled()
    // Unsupported pair (Hulu USA has no verified JW support): empty with
    // zero upstream traffic of any kind.
    mockedGetJWRankings.mockClear()
    const unsupported = await fetchChartFamilyRows("stream2:justwatch:hulu:united-states:series:-", ctxFor("x:united-states:"))
    expect(unsupported).toMatchObject({ status: "empty", rows: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
  })

  it("justwatch-only retains on JW outage (throws, never a fake empty)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no traffic expected")
    })
    mockedGetJWRankings.mockRejectedValue(new Error("jw down"))
    await expect(
      fetchChartFamilyRows("stream2:justwatch:prime:italy:series:-", ctxFor("x:italy:")),
    ).rejects.toThrow()
  })

  it("auto prefers FP hits with zero JW traffic, falls back to declared JW pairs only", async () => {
    // FP hit wins; JW untouched.
    mockFpFiles({ "united-states": huluSeriesDoc([huluEntry(701, 1), huluEntry(702, 2)]) })
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 999, imdbId: null, rank: 1, title: "Wrong" }])
    const hit = await fetchChartFamilyRows("stream2:auto:hulu:united-states:series:-", ctxFor("x:united-states:"))
    expect(hit.provenance).toBe("flixpatrol")
    expect((hit.rows as Array<{ tmdbId: number }>).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    // FP absent (non-empty country doc without the pair — a whole
    // `charts: []` would quarantine as integrity failure instead) +
    // verified JW pair -> JW fallback with its provenance.
    mockedGetJWRankings.mockClear()
    mockFpFiles({
      italy: {
        date: "October 22, 2026",
        charts: [
          {
            catalog_id: "netflix.movies",
            platform: "Netflix",
            category: "movies",
            date: "October 22, 2026",
            entries: [{ rank: 1, title: "Other", tmdb: { id: 11, media_type: "movie", release_date: "2024-01-01" } }],
          },
        ],
      },
    })
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 901, imdbId: null, rank: 1, title: "Prime Show" }])
    const fb = await fetchChartFamilyRows("stream2:auto:prime:italy:series:-", ctxFor("x:italy:"))
    expect(fb.provenance).toBe("justwatch")
    expect((fb.rows as Array<{ tmdbId: number }>).map((r) => r.tmdbId)).toEqual([901])
    // FP absent + NO verified JW pair -> genuine empty, no JW attempt.
    // (Non-empty country doc without the pair: a whole `charts: []`
    // quarantines as integrity failure and throws instead.)
    mockedGetJWRankings.mockClear()
    mockFpFiles({
      germany: {
        date: "October 22, 2026",
        charts: [
          {
            catalog_id: "netflix.movies",
            platform: "Netflix",
            category: "movies",
            date: "October 22, 2026",
            entries: [{ rank: 1, title: "Other", tmdb: { id: 12, media_type: "movie", release_date: "2024-01-01" } }],
          },
        ],
      },
    })
    const unavailable = await fetchChartFamilyRows("stream2:auto:wow:germany:movies:-", {
      ...ctxFor("x:germany:"),
      regionCode: "DE",
      regionLang: "de-DE",
      tmdbLang: "de-DE",
    })
    expect(unavailable).toMatchObject({ status: "empty", rows: [] })
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
  })

  it("auto on all serves mixed overall rows with real media types and never touches JW", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("canada.json")) {
        return Response.json({
          date: "October 22, 2026",
          charts: [
            {
              catalog_id: "crave.overall",
              platform: "Crave",
              category: "overall",
              date: "October 22, 2026",
              entries: [
                { rank: 1, title: "Show One", tmdb: { id: 511, media_type: "tv", release_date: "2023-01-01" } },
                { rank: 2, title: "Film One", tmdb: { id: 512, media_type: "movie", release_date: "2024-01-01" } },
              ],
            },
          ],
        })
      }
      throw new Error(`unexpected upstream: ${url.slice(0, 120)}`)
    })
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 999, imdbId: null, rank: 1, title: "Wrong" }])
    const res = await fetchChartFamilyRows("stream2:auto:crave:canada:all:-", ctxFor("x:canada:"))
    expect(res.status).toBe("ok")
    expect(res.provenance).toBe("flixpatrol")
    expect(res.rows).toMatchObject([
      { tmdbId: 511, rank: 1, mediaType: "tv" },
      { tmdbId: 512, rank: 2, mediaType: "movie" },
    ])
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("justwatch"))).toBe(true)
  })
})
