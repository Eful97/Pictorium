/**
 * Task F correction c1 (RED-before/GREEN-after): strict source policy on the
 * PUBLIC availability endpoint + exact-chart (variant-only) coverage.
 *
 * Parent independently inspected `getStreamingAvailability` and demonstrated
 * acceptance violations despite green helper tests:
 *  1. `?source=flixpatrol|justwatch` still concatenates the legacy auto
 *     builder (legacy `pictorium-stream-*` ids leak into strict responses,
 *     cross potentials leak: justwatch potentials under flixpatrol-only and
 *     vice versa). Strict responses must carry ONLY requested-policy encoded
 *     ids (`pictorium-stream2-*--<source>[--variant]`), never legacy auto ids.
 *  2. Variant-only index sections (non-empty variant arrays, e.g.
 *     `italy.rai.series: ["it"]` — the real country doc carries only
 *     `rai.series-it`, no `rai.series` base) emit a fictitious base choice.
 *     Categories with variants emit the exact variant choices ONLY (empty
 *     `[]` still means the base chart exists); no phantom base, no duplicate
 *     base+variant at equal meaning (overall-only `crave`/`canada`).
 *  3. Stored/route selection parsing: present-but-invalid `source` must fail
 *     closed (drop the entry, never silently switch intent to `auto`);
 *     absent stays `auto`. Legacy alias services (`prime`/`apple`/`hbo`)
 *     normalize to their upstream index ids on the generic path.
 *
 * Isolated like the sibling slices: own DATA_DIR, own cache clears.
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-source-policy-test`,
}));

import { GET as availabilityGET } from "@/app/api/streaming-availability/route";
import { cacheClear } from "@/lib/cache";
import {
  __clearStreamingAvailabilityCache,
  buildGenericStreamingChoices,
  parseAvailabilityIndex,
} from "@/lib/streaming-availability";
import { sanitizeGenericStreamingSelections } from "@/lib/streaming-catalogs";

function req(source?: string, extra = "") {
  const q = source === undefined ? extra : `source=${source}${extra}`;
  return new NextRequest(`http://localhost:3000/api/streaming-availability?${q}`);
}

// Fixture: FP absent + JW known (NOW GB: no `now` key under united-kingdom,
// NOW GB is own-brand JW-eligible), FP available (Netflix IT, Hulu USA with
// full base charts), Hulu USA JW-unmapped (not a legacy service).
const POLICY_DOC = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  regions: {
    italy: {
      netflix: { movies: [], series: [] },
      rai: { movies: [], overall: [], series: ["it"] },
    },
    "united-states": {
      hulu: { movies: [], overall: [], series: [] },
      netflix: { movies: [], series: [] },
    },
    "united-kingdom": {
      netflix: { movies: [], series: [] },
    },
    canada: {
      crave: { overall: ["amazon-channels"] },
    },
  },
};

const isLegacyAutoId = (id: string) =>
  id.startsWith("pictorium-stream-") && !id.startsWith("pictorium-stream2-");

beforeEach(() => {
  __clearStreamingAvailabilityCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  cacheClear();
});

afterAll(async () => {
  await fsp.rm(`${process.cwd()}/test-results/streaming-source-policy-test`, { recursive: true, force: true });
});

describe("public endpoint strict source filtering (RED-before)", () => {
  it("source=flixpatrol carries only flixpatrol-policy ids, no legacy auto leak, no justwatch potential", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const res = await availabilityGET(req("flixpatrol"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices.length).toBeGreaterThan(0);
    // Every descriptor carries the requested policy encoded: no legacy auto ids.
    for (const c of json.choices) {
      expect(isLegacyAutoId(String(c.catalogId))).toBe(false);
    }
    // No cross potential: flixpatrol-only never reports justwatch.
    expect(json.choices.some((c: { potential: string }) => c.potential === "justwatch")).toBe(false);
    // FP-available pairs are served via FP: Netflix IT + Hulu USA (real charts).
    const has = (service: string, slug: string, section: string) =>
      json.choices.find(
        (c: { service: string; chartSlug?: string; countryFlixSlug?: string; section: string }) =>
          c.service === service && (c.chartSlug ?? c.countryFlixSlug) === slug && c.section === section,
      );
    expect(has("netflix", "italy", "series")).toMatchObject({ potential: "flixpatrol" });
    expect(has("hulu", "united-states", "series")).toMatchObject({ potential: "flixpatrol" });
    // NOW GB has no FP chart: never served as flixpatrol (absent or unavailable, never FP).
    const nowGb = json.choices.filter(
      (c: { service: string; chartSlug?: string; countryFlixSlug?: string }) =>
        (c.service === "now" || c.service === "NOW") &&
        ((c.chartSlug ?? c.countryFlixSlug) === "united-kingdom" || (c as { country?: string }).country === "GB"),
    );
    expect(nowGb.every((c: { potential: string }) => c.potential !== "flixpatrol")).toBe(true);
  });

  it("source=justwatch excludes Hulu USA, carries only justwatch-policy ids, no FP potential", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const res = await availabilityGET(req("justwatch"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices.length).toBeGreaterThan(0);
    for (const c of json.choices) {
      expect(isLegacyAutoId(String(c.catalogId))).toBe(false);
      expect(String(c.catalogId)).toContain("--justwatch");
    }
    // No FP potential under justwatch-only (and never unavailable masquerading).
    expect(json.choices.some((c: { potential: string }) => c.potential === "flixpatrol")).toBe(false);
    expect(json.choices.every((c: { potential: string }) => c.potential === "justwatch")).toBe(true);
    // Hulu USA has no verified own-brand JW support: omitted entirely.
    expect(
      json.choices.some(
        (c: { service: string; chartSlug?: string }) => c.service === "hulu" && c.chartSlug === "united-states",
      ),
    ).toBe(false);
    // A JW-eligible indexed legacy pair (Netflix GB) is served as justwatch.
    expect(
      json.choices.some(
        (c: { service: string; chartSlug?: string; section: string; potential: string }) =>
          c.service === "netflix" && c.chartSlug === "united-kingdom" && c.potential === "justwatch",
      ),
    ).toBe(true);
  });

  it("source=auto explicit matches absent (legacy ids retained for compatibility)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const [absentRes, explicitRes] = await Promise.all([
      availabilityGET(req(undefined)),
      availabilityGET(req("auto")),
    ]);
    const absent = await absentRes.json();
    const explicit = await explicitRes.json();
    const absentIds = absent.choices.map((c: { catalogId: string }) => c.catalogId).sort();
    const explicitIds = explicit.choices.map((c: { catalogId: string }) => c.catalogId).sort();
    // Absent and explicit auto agree (compatibility: legacy auto ids retained here).
    expect(explicitIds).toEqual(absentIds);
    expect(absentIds.some((id: string) => isLegacyAutoId(id))).toBe(true);
    // NOW GB (FP absent from the index, JW known via the own-brand matrix)
    // stays covered by its legacy auto entry with justwatch potential.
    const nowGb = absent.choices.filter(
      (c: { service: string; country?: string }) => c.service === "now" && c.country === "GB",
    );
    expect(nowGb).toHaveLength(2);
    expect(nowGb.every((c: { potential: string }) => c.potential === "justwatch")).toBe(true);
  });

  it("unknown source fails closed (never silently auto)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const res = await availabilityGET(req("sometimes"));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Fail-closed: an unknown policy promises nothing (not the auto universe).
    expect(json.choices).toEqual([]);
  });

  it("NOW GB (no FP index entry) is a justwatch choice, never a flixpatrol one", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    // Strict justwatch enumerates the documented own-brand matrix
    // independently of the FP index: NOW GB has no `now` chart entry but is
    // matrix-verified, so both sections appear with justwatch policy ids.
    const jwOnly = await (await availabilityGET(req("justwatch", "&service=now&country=GB"))).json();
    expect(jwOnly.choices.map((c: { catalogId: string }) => c.catalogId).sort()).toEqual([
      "pictorium-stream2-now--united-kingdom--movies--justwatch",
      "pictorium-stream2-now--united-kingdom--series--justwatch",
    ]);
    for (const c of jwOnly.choices) {
      expect(c).toMatchObject({ service: "now", chartSlug: "united-kingdom", potential: "justwatch", fpChart: false });
    }
    // Strict flixpatrol never invents the pair (no FP chart, no fallback).
    const fpOnly = await (await availabilityGET(req("flixpatrol", "&service=now&country=GB"))).json();
    expect(fpOnly.choices).toEqual([]);
  });

  it("index error still serves JW matrix pairs as unknown-FP justwatch", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("index down"));
    // No index document: FP coverage is honestly unknown, but JW support is
    // matrix-verified and does not depend on the FP chart lookup.
    const jwOnly = await (await availabilityGET(req("justwatch", "&service=now&country=GB"))).json();
    expect(jwOnly.indexStatus).toBe("error");
    expect(jwOnly.choices.map((c: { catalogId: string }) => c.catalogId).sort()).toEqual([
      "pictorium-stream2-now--united-kingdom--movies--justwatch",
      "pictorium-stream2-now--united-kingdom--series--justwatch",
    ]);
    for (const c of jwOnly.choices) {
      expect(c).toMatchObject({ potential: "justwatch", fpChart: "unknown" });
    }
  });
});

describe("variant-only exact charts (RED-before)", () => {
  it("Rai Italia: series base absent, variant it available, flixpatrol-only with zero JW fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const auto = await (await availabilityGET(req("auto", "&service=rai&country=IT"))).json();
    const ids = auto.choices.map((c: { catalogId: string }) => c.catalogId);
    // Exact variant choice only: no fictitious base series alongside the variant.
    expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it");
    expect(ids).not.toContain("pictorium-stream2-rai--italy--series--auto");
    // The variant carries the FP chart (real chart, not a guess).
    expect(
      auto.choices.find((c: { variant: string | null }) => c.variant === "it"),
    ).toMatchObject({ potential: "flixpatrol", fpChart: true });
    // flixpatrol-only serves the variant with zero JW fallback.
    const fpOnly = await (await availabilityGET(req("flixpatrol", "&service=rai&country=IT"))).json();
    expect(fpOnly.choices.map((c: { catalogId: string }) => c.catalogId)).toContain(
      "pictorium-stream2-rai--italy--series--flixpatrol--it",
    );
    expect(fpOnly.choices.some((c: { potential: string }) => c.potential === "justwatch")).toBe(false);
    // justwatch-only omits Rai entirely (no verified own-brand JW pair).
    const jwOnly = await (await availabilityGET(req("justwatch", "&service=rai&country=IT"))).json();
    expect(jwOnly.choices).toEqual([]);
  });

  it("Crave Canada overall-only: variant all without a fake duplicate base", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(POLICY_DOC));
    const auto = await (await availabilityGET(req("auto", "&service=crave&country=CA"))).json();
    const ids = auto.choices.map((c: { catalogId: string }) => c.catalogId);
    // One exact variant `all` (real chart), never base+variant duplicates at equal meaning.
    expect(ids).toContain("pictorium-stream2-crave--canada--all--auto--amazon-channels");
    expect(ids).not.toContain("pictorium-stream2-crave--canada--all--auto");
    // movies/series stay explicitly unavailable with the overallOnly capability (never split).
    for (const section of ["movies", "series"]) {
      const entry = auto.choices.find((c: { section: string }) => c.section === section);
      expect(entry).toMatchObject({ potential: "unavailable", overallOnly: true, fpChart: false });
    }
  });

  it("empty variant arrays still mean the base chart exists (no over-pruning)", () => {
    const parsed = parseAvailabilityIndex(POLICY_DOC)!;
    const choices = buildGenericStreamingChoices(parsed.regions, parsed.variants, true, { source: "auto" });
    // hulu-nippon-style base [] pairs keep working: Hulu USA bases exist.
    expect(
      choices.some((c) => c.service === "hulu" && c.chartSlug === "united-states" && c.section === "movies" && c.variant === null),
    ).toBe(true);
    // Rai movies [] base exists alongside the variant-only series.
    expect(
      choices.some((c) => c.service === "rai" && c.chartSlug === "italy" && c.section === "movies" && c.variant === null),
    ).toBe(true);
  });
});

describe("selection parser: invalid source fails closed, absent stays auto", () => {
  it("present-but-invalid source drops the entry (never silent auto)", () => {
    expect(sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", source: "sometimes" }])).toEqual([]);
    expect(sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", source: "JUSTWATCH" }])).toEqual([]);
    // Absent/null/empty stay auto-compatible (never migrated, never dropped).
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "US" }])![0],
    ).toMatchObject({ source: "auto" });
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", source: null }])![0],
    ).toMatchObject({ source: "auto" });
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", source: "auto" }])![0],
    ).toMatchObject({ source: "auto", legacy: false });
  });

  it("legacy alias services normalize to upstream index ids on the generic path", () => {
    // `prime` (curated) vs upstream `amazon-prime`: a generic prime selection
    // must address the real index id, or FP discovery permanently misses.
    const out = sanitizeGenericStreamingSelections([
      { service: "prime", country: "IT", source: "flixpatrol" },
    ])!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ service: "amazon-prime", chartSlug: "italy", source: "flixpatrol" });
    // Legacy-identical entries keep their curated identity (byte-identical legacy ids).
    const legacy = sanitizeGenericStreamingSelections([{ service: "prime", country: "IT" }])!;
    expect(legacy[0]).toMatchObject({ service: "prime", legacy: true });
  });
});

describe("live universe evidence (offline real capture, no network)", () => {
  const fixturePath = path.join(process.cwd(), "src/__tests__/catalogs/fixtures/availability-live-20261022.json");

  it("covers the exact full index universe: 119 regions incl. global, 82 services, 11 variant sections", () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    expect(doc.schema_version).toBe(1);
    const slugs = Object.keys(doc.regions);
    expect(slugs).toHaveLength(119);
    expect(slugs).toContain("global");
    const svc = new Set<string>();
    for (const s of slugs) for (const id of Object.keys(doc.regions[s])) svc.add(id);
    expect(svc.size).toBe(82);
    let variantSections = 0;
    for (const s of slugs)
      for (const id of Object.keys(doc.regions[s]))
        for (const k of ["movies", "series", "overall"]) {
          const v = doc.regions[s][id][k];
          if (Array.isArray(v) && v.length > 0) variantSections++;
        }
    expect(variantSections).toBe(11);
  });

  it("endpoint over the live universe: counts, no legacy leak under strict sources, honest potentials", async () => {
    const doc = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));
    const [auto, fpOnly, jwOnly] = await Promise.all([
      availabilityGET(req("auto")).then((r) => r.json()),
      availabilityGET(req("flixpatrol")).then((r) => r.json()),
      availabilityGET(req("justwatch")).then((r) => r.json()),
    ]);
    // Report the universe counts (evidence, not magic numbers elsewhere).
    console.log(
      `live universe choices: auto=${auto.choices.length} flixpatrol=${fpOnly.choices.length} justwatch=${jwOnly.choices.length}`,
    );
    expect(auto.choices.length).toBeGreaterThan(jwOnly.choices.length);
    expect(fpOnly.choices.length).toBeGreaterThan(jwOnly.choices.length);
    // Strict responses: every id encodes the requested source, no legacy auto leak.
    for (const c of fpOnly.choices) {
      expect(isLegacyAutoId(String(c.catalogId))).toBe(false);
      expect(String(c.catalogId)).toContain("--flixpatrol");
    }
    for (const c of jwOnly.choices) {
      expect(isLegacyAutoId(String(c.catalogId))).toBe(false);
      expect(String(c.catalogId)).toContain("--justwatch");
    }
    expect(fpOnly.choices.some((c: { potential: string }) => c.potential === "justwatch")).toBe(false);
    expect(jwOnly.choices.some((c: { potential: string }) => c.potential !== "justwatch")).toBe(false);
    // Spot checks on the real universe: Hulu USA via FP, Rai variant, Crave variant.
    expect(
      fpOnly.choices.some(
        (c: { service: string; chartSlug: string; section: string; potential: string }) =>
          c.service === "hulu" && c.chartSlug === "united-states" && c.potential === "flixpatrol",
      ),
    ).toBe(true);
    expect(fpOnly.choices.map((c: { catalogId: string }) => c.catalogId)).toContain(
      "pictorium-stream2-rai--italy--series--flixpatrol--it",
    );
    expect(fpOnly.choices.map((c: { catalogId: string }) => c.catalogId)).not.toContain(
      "pictorium-stream2-rai--italy--series--flixpatrol",
    );
    // No fictitious base alongside any variant section of the live universe.
    const parsed = parseAvailabilityIndex(doc)!;
    for (const slug of Object.keys(parsed.variants)) {
      for (const [service, vars] of Object.entries(parsed.variants[slug])) {
        for (const section of ["movies", "series"] as const) {
          const list = vars[section];
          if (list.length === 0) continue;
          const baseId = `pictorium-stream2-${service}--${slug}--${section}--flixpatrol`;
          expect(fpOnly.choices.map((c: { catalogId: string }) => c.catalogId)).not.toContain(baseId);
        }
      }
    }
  });
});
