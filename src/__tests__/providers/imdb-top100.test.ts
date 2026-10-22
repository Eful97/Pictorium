import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABSOLUTE_CINEMA_MAX_RANK,
  TOP_250_EXPECTED_COUNT,
  __resetTop250ForTest,
  getImdbTopRank,
  isImdbTop100,
  isImdbTop250,
  parseImdbTop250Ids,
} from "@/lib/imdb-top250";
import {
  IMDB_TOP_250_IDS,
  IMDB_TOP_250_ORDERED_IDS,
  IMDB_TOP_250_PROVENANCE,
} from "@/lib/imdb-top250-data";
import { cacheClear, cacheSet } from "@/lib/cache";
import { computeAbsoluteCinema, computeBadge, getAllBadgeOptions } from "@/lib/badge-priority";
import { GET } from "@/app/api/imdb-top250/route";
import { NextRequest } from "next/server";
import chartFixture from "../fixtures/imdb-top250-chart.json";

const RANK_100_ID = "tt0338013"; // Eternal Sunshine of the Spotless Mind
const RANK_101_ID = "tt0053604"; // The Apartment
const RANK_1_ID = "tt0111161";
const RANK_250_ID = "tt10431500";

function nextDataHtmlWithRanks(ids: string[]): string {
  const edges = ids.map((id, i) => ({ currentRank: i + 1, node: { id, titleType: { id: "movie" } } }));
  const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

function chartIds250(start = 1000000): string[] {
  return Array.from({ length: 250 }, (_, i) => `tt${start + i}`);
}

function mockChart(html: string, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(html, { status, headers: { "content-type": "text/html" } }),
  );
}

beforeEach(() => {
  cacheClear();
  __resetTop250ForTest();
  vi.restoreAllMocks();
});

describe("authoritative Top250 snapshot (user capture 2026-10-22)", () => {
  it("holds exactly 250 unique ordered ids with provenance", () => {
    expect(TOP_250_EXPECTED_COUNT).toBe(250);
    expect(IMDB_TOP_250_ORDERED_IDS).toHaveLength(250);
    expect(new Set(IMDB_TOP_250_ORDERED_IDS).size).toBe(250);
    expect(IMDB_TOP_250_IDS.size).toBe(250);
    expect(IMDB_TOP_250_PROVENANCE.sourceUrl).toBe("https://www.imdb.com/it/chart/top/");
    expect(IMDB_TOP_250_PROVENANCE.importedOn).toBe("2026-10-22");
    expect(IMDB_TOP_250_PROVENANCE.sourceGeneratedAt).toBe("UNKNOWN");
    expect(IMDB_TOP_250_PROVENANCE.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the committed minimal fixture rank boundaries", () => {
    const entries = (chartFixture as { entries: Array<{ rank: number; id: string }> }).entries;
    expect(entries).toHaveLength(250);
    expect(entries[0]).toMatchObject({ rank: 1, id: RANK_1_ID });
    expect(entries[99]).toMatchObject({ rank: 100, id: RANK_100_ID });
    expect(entries[100]).toMatchObject({ rank: 101, id: RANK_101_ID });
    expect(entries[249]).toMatchObject({ rank: 250, id: RANK_250_ID });
    expect(IMDB_TOP_250_ORDERED_IDS[0]).toBe(RANK_1_ID);
    expect(IMDB_TOP_250_ORDERED_IDS[99]).toBe(RANK_100_ID);
    expect(IMDB_TOP_250_ORDERED_IDS[100]).toBe(RANK_101_ID);
    expect(IMDB_TOP_250_ORDERED_IDS[249]).toBe(RANK_250_ID);
  });
});

describe("parseImdbTop250Ids strict chart validation", () => {
  it("accepts ranked movie edges in rank order", () => {
    const ids = chartIds250();
    const parsed = parseImdbTop250Ids(nextDataHtmlWithRanks(ids));
    expect(parsed).toHaveLength(250);
    expect(parsed[0]).toBe(ids[0]);
  });

  it("rejects duplicate ids", () => {
    const ids = chartIds250();
    ids[249] = ids[0];
    expect(parseImdbTop250Ids(nextDataHtmlWithRanks(ids))).toEqual([]);
  });

  it("rejects duplicate ranks", () => {
    const edges = chartIds250().map((id, i) => ({
      currentRank: i === 249 ? 1 : i + 1,
      node: { id, titleType: { id: "movie" } },
    }));
    const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });
    expect(
      parseImdbTop250Ids(`<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`),
    ).toEqual([]);
  });

  it("rejects missing/out-of-range ranks and partial pages", () => {
    expect(parseImdbTop250Ids(nextDataHtmlWithRanks(chartIds250().slice(0, 100)))).toEqual([]);
    const ids = chartIds250();
    const edges = ids.map((id, i) => ({
      currentRank: i === 0 ? 0 : i + 1,
      node: { id, titleType: { id: "movie" } },
    }));
    const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });
    expect(
      parseImdbTop250Ids(`<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`),
    ).toEqual([]);
  });

  it("rejects tv rows and invalid ids", () => {
    const tvEdges = chartIds250().map((id, i) => ({
      currentRank: i + 1,
      node: { id, titleType: { id: i === 5 ? "tvSeries" : "movie" } },
    }));
    const tvJson = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges: tvEdges } } } } });
    expect(
      parseImdbTop250Ids(`<html><body><script id="__NEXT_DATA__" type="application/json">${tvJson}</script></body></html>`),
    ).toEqual([]);
    const bad = chartIds250();
    bad[10] = "tt123";
    expect(parseImdbTop250Ids(nextDataHtmlWithRanks(bad))).toEqual([]);
  });

  it("rejects the legacy corrupt 257-row/160-unique shape", () => {
    const dupes = Array.from({ length: 257 }, (_, i) => `tt${1000000 + (i % 160)}`);
    expect(parseImdbTop250Ids(nextDataHtmlWithRanks(dupes).replace("tt1000000", "tt1000000"))).toEqual([]);
  });
});

describe("Absolute Cinema Top100 boundary (actual chart order)", () => {
  it("rank 100 in, rank 101 out — live and fallback agree", async () => {
    mockChart(nextDataHtmlWithRanks([...IMDB_TOP_250_ORDERED_IDS]));
    expect(await isImdbTop100(RANK_100_ID)).toBe(true);
    expect(await isImdbTop100(RANK_101_ID)).toBe(false);
    expect(await getImdbTopRank(RANK_100_ID)).toBe(100);
    expect(await getImdbTopRank(RANK_101_ID)).toBe(101);
    __resetTop250ForTest();
    cacheClear();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blocked"));
    expect(await isImdbTop100(RANK_100_ID)).toBe(true);
    expect(await isImdbTop100(RANK_101_ID)).toBe(false);
  });

  it("legacy 250 contract still covers rank 101..250", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blocked"));
    expect(await isImdbTop250(RANK_101_ID)).toBe(true);
    expect(await isImdbTop250(RANK_250_ID)).toBe(true);
    expect(await isImdbTop250("tt9999999")).toBe(false);
    expect(ABSOLUTE_CINEMA_MAX_RANK).toBe(100);
  });

  it("badge is movies-only, disabled-aware, and keeps the Absolute Cinema label", () => {
    const t = (k: string) => k;
    expect(computeAbsoluteCinema({ mediaType: "movie", imdbTop250: true }, t)).toBe("badge.absoluteCinema");
    expect(computeAbsoluteCinema({ mediaType: "tv", imdbTop250: true }, t)).toBeNull();
    expect(computeAbsoluteCinema({ mediaType: "movie", imdbTop250: false }, t)).toBeNull();
    const hit = computeBadge(
      {
        mediaType: "movie",
        upcomingRelease: null,
        isNewMovie: false,
        isNewSeries: false,
        animeRank: null,
        trendRank: null,
        award: null,
        nomination: null,
        studio: null,
        director: null,
        imdbTop250: true,
        extra: null,
      },
      t,
    );
    expect(hit?.label).toBe("badge.absoluteCinema");
    const off = computeBadge(
      {
        mediaType: "movie",
        upcomingRelease: null,
        isNewMovie: false,
        isNewSeries: false,
        animeRank: null,
        trendRank: null,
        award: null,
        nomination: null,
        studio: null,
        director: null,
        imdbTop250: true,
        extra: null,
        disabledContentTags: ["absoluteCinema"],
      },
      t,
    );
    expect(off).toBeNull();
    const options = getAllBadgeOptions({
      upcomingRelease: null,
      isNewMovie: false,
      isNewSeries: false,
      animeRank: null,
      trendRank: null,
      award: null,
      nomination: null,
      studio: null,
      director: null,
      extra: null,
      mediaType: "movie",
      voteAverage: 9,
      tvType: null,
      tvStatus: null,
      imdbTop250: true,
    });
    expect(options).toContain("__badge.absoluteCinema");
  });
});

describe("cache tiers and API parity", () => {
  it("serves memory, then shared, then fallback — never a partial prefix", async () => {
    const ordered = [...IMDB_TOP_250_ORDERED_IDS];
    mockChart(nextDataHtmlWithRanks(ordered));
    expect(await isImdbTop100(RANK_1_ID)).toBe(true);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(await isImdbTop100(RANK_100_ID)).toBe(true);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
    __resetTop250ForTest();
    cacheClear();
    // Ranked tier reads only its versioned ordered key (unversioned legacy
    // entries carry unproven order and are never trusted for Top100).
    cacheSet("imdb:top250:ranked:v1", ordered, ["imdb"], 24 * 60 * 60 * 1000);
    vi.restoreAllMocks();
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    expect(await isImdbTop100(RANK_100_ID)).toBe(true);
    expect(await isImdbTop100(RANK_101_ID)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("API limit=100 matches the badge helper; default stays 250", async () => {
    mockChart(nextDataHtmlWithRanks([...IMDB_TOP_250_ORDERED_IDS]));
    const top100Req = new NextRequest(`http://localhost/api/imdb-top250?imdbId=${RANK_101_ID}&limit=100`);
    const top100Res = await GET(top100Req);
    const top100Body = await top100Res.json();
    expect(top100Body.inTop100).toBe(false);
    expect(top100Body.inTop250).toBe(true);
    const legacyReq = new NextRequest(`http://localhost/api/imdb-top250?imdbId=${RANK_101_ID}`);
    const legacyRes = await GET(legacyReq);
    const legacyBody = await legacyRes.json();
    expect(legacyBody.inTop250).toBe(true);
    expect(legacyBody.inTop100).toBeUndefined();
  });
});
