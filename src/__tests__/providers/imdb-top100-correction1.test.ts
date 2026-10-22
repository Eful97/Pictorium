import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTop250ForTest,
  getImdbTopRank,
  isImdbTop100,
  isImdbTop250,
  parseImdbTop250Ids,
  parseImdbTop250RankedIds,
} from "@/lib/imdb-top250";
import { IMDB_TOP_250_ORDERED_IDS } from "@/lib/imdb-top250-data";
import { cacheClear, cacheSet } from "@/lib/cache";
import { GET } from "@/app/api/imdb-top250/route";
import { NextRequest } from "next/server";

const LEGACY_CACHE_KEY = "imdb:top250";
const RANKED_CACHE_KEY = "imdb:top250:ranked:v1";
const DAY = 24 * 60 * 60 * 1000;

const SNAP_RANK_1 = IMDB_TOP_250_ORDERED_IDS[0];
const SNAP_RANK_100 = IMDB_TOP_250_ORDERED_IDS[99];
const SNAP_RANK_101 = IMDB_TOP_250_ORDERED_IDS[100];

function synthIds250(start = 3000000): string[] {
  return Array.from({ length: 250 }, (_, i) => `tt${start + i}`);
}

/** Rankless chart edges (legacy shape: no currentRank), in the given id order. */
function ranklessHtml(ids: string[]): string {
  const edges = ids.map((id) => ({ node: { id, titleType: { id: "movie" } } }));
  const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}

/** Ranked chart edges with explicit currentRank, listed in the given edge order. */
function rankedHtml(idsInRankOrder: string[], edgeOrder: "rank" | "reversed" = "rank"): string {
  const edges = idsInRankOrder.map((id, i) => ({
    currentRank: i + 1,
    node: { id, titleType: { id: "movie" } },
  }));
  if (edgeOrder === "reversed") edges.reverse();
  const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } });  return `<html><body><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
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

describe("correction1: ranked Top100 trust (runtime/chart/cache)", () => {
  it("rankless shuffled chart: legacy membership preserved, Top100 falls back (never arbitrary first100)", async () => {
    const synth = synthIds250();
    const shuffled = [...synth].reverse();
    const html = ranklessHtml(shuffled);
    // Legacy 250 membership contract preserved (rankless, edge order).
    expect(parseImdbTop250Ids(html)).toHaveLength(250);
    // Rank-aware parser requires verified rank coverage: rankless → no ranked order.
    expect(parseImdbTop250RankedIds(html)).toEqual([]);
    mockChart(html);
    // The shuffled first element must NOT become Top100.
    expect(await isImdbTop100(shuffled[0])).toBe(false);
    expect(await getImdbTopRank(shuffled[0])).toBeNull();
    // Verified snapshot fallback still answers the true Top100.
    expect(await isImdbTop100(SNAP_RANK_100)).toBe(true);
    expect(await getImdbTopRank(SNAP_RANK_100)).toBe(100);
  });

  it("explicit ranks in scrambled edge order sort correctly by rank", async () => {
    const synth = synthIds250(3100000);
    const html = rankedHtml(synth, "reversed");
    const parsed = parseImdbTop250RankedIds(html);
    expect(parsed).toHaveLength(250);
    expect(parsed[0]).toBe(synth[0]);
    expect(parsed[249]).toBe(synth[249]);
    mockChart(html);
    expect(await getImdbTopRank(synth[0])).toBe(1);
    expect(await getImdbTopRank(synth[99])).toBe(100);
    expect(await isImdbTop100(synth[99])).toBe(true);
    expect(await isImdbTop100(synth[100])).toBe(false);
  });

  it("corrupted shared entries (dupes/invalid ids) are rejected, never trusted", async () => {
    // Legacy key with dupes: 250 entries but only 1 unique id.
    cacheSet(LEGACY_CACHE_KEY, Array(250).fill(SNAP_RANK_1), ["imdb"], DAY);
    // Ranked key with an invalid id smuggled in.
    const poisoned = [...IMDB_TOP_250_ORDERED_IDS];
    poisoned[50] = "tt123";
    cacheSet(RANKED_CACHE_KEY, poisoned, ["imdb"], DAY);
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("net down"));
    // Neither poisoned entry may drive the badge: fallback snapshot answers.
    expect(await isImdbTop100(SNAP_RANK_1)).toBe(true);
    expect(await isImdbTop100(SNAP_RANK_100)).toBe(true);
    expect(await getImdbTopRank(SNAP_RANK_1)).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it("legacy cache is ignored for Top100; new valid ordered cache is used with zero fetch", async () => {
    // Old unranked entry under the legacy key (valid 250, but unproven order).
    cacheSet(LEGACY_CACHE_KEY, synthIds250(), ["imdb"], DAY);
    // New versioned ordered entry with the verified snapshot order.
    cacheSet(RANKED_CACHE_KEY, [...IMDB_TOP_250_ORDERED_IDS], ["imdb"], DAY);
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    expect(await isImdbTop100(SNAP_RANK_100)).toBe(true);
    expect(await isImdbTop100(SNAP_RANK_101)).toBe(false);
    expect(await getImdbTopRank(SNAP_RANK_1)).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("live valid ranked chart populates the versioned cache (single fetch, shared)", async () => {
    mockChart(rankedHtml([...IMDB_TOP_250_ORDERED_IDS]));
    expect(await isImdbTop100(SNAP_RANK_100)).toBe(true);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(1);
    // Second caller served from cache tiers, no second fetch.
    expect(await isImdbTop100(SNAP_RANK_1)).toBe(true);
    expect(await getImdbTopRank(SNAP_RANK_101)).toBe(101);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });
});

describe("correction1: /api/imdb-top250 preview semantics", () => {
  it("default request (no limit) restores the legacy byte-shape { inTop250 }", async () => {
    mockChart(rankedHtml([...IMDB_TOP_250_ORDERED_IDS]));
    const res = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=${SNAP_RANK_101}`));
    const body = await res.json();
    expect(body).toEqual({ inTop250: true });
    expect("limit" in body).toBe(false);
    expect("inTop100" in body).toBe(false);
  });

  it("explicit limit=100 carries the new fields and matches the badge helper", async () => {
    mockChart(rankedHtml([...IMDB_TOP_250_ORDERED_IDS]));
    const r100 = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=${SNAP_RANK_100}&limit=100`));
    expect(await r100.json()).toEqual({ inTop250: true, inTop100: true, limit: 100 });
    __resetTop250ForTest();
    cacheClear();
    mockChart(rankedHtml([...IMDB_TOP_250_ORDERED_IDS]));
    const r101 = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=${SNAP_RANK_101}&limit=100`));
    expect(await r101.json()).toEqual({ inTop250: true, inTop100: false, limit: 100 });
  });

  it("limit=100 for an unknown id is honest fail-closed (no resurrected badge)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("net down"));
    const res = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=tt9999999&limit=100`));
    const body = await res.json();
    expect(body.inTop250).toBe(false);
    expect(body.inTop100).toBe(false);
    // Client evidence rule: only an explicit positive inTop100 drives the badge.
    const showBadge = (b: unknown) =>
      typeof b === "object" && b !== null && (b as { inTop100?: unknown }).inTop100 === true;
    expect(showBadge(body)).toBe(false);
    expect(showBadge({ inTop250: true })).toBe(false);
    expect(showBadge({ inTop250: true, inTop100: true, limit: 100 })).toBe(true);
  });

  it("invalid id and invalid limit bodies stay honest (no inTop100)", async () => {
    const badId = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=not-an-id&limit=100`));
    const badIdBody = await badId.json();
    expect(badIdBody.inTop250).toBe(false);
    expect(badIdBody.inTop100 ?? false).toBe(false);
    const badLimit = await GET(new NextRequest(`http://localhost/api/imdb-top250?imdbId=${SNAP_RANK_1}&limit=50`));
    const badLimitBody = await badLimit.json();
    expect(badLimitBody).toEqual({ inTop250: false });
  });

  it("legacy 250 membership still covers rank 101..250", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blocked"));
    expect(await isImdbTop250(SNAP_RANK_101)).toBe(true);
    expect(await isImdbTop250("tt9999999")).toBe(false);
  });
});
