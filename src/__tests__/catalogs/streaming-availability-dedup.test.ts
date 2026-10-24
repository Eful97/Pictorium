/**
 * R: user-demonstrated bugfix — auto availability emits SEMANTIC DUPLICATES.
 *
 * Screenshot: Italy + Crunchyroll shows JW Film, JW Serie, FP Mista, then a
 * DUPLICATE JW Film + JW Serie pair. Root (coordinator review): `auto`
 * concatenates legacy `buildStreamingChoices` (all 8 x matrix) with generic
 * `buildGenericStreamingChoices`; the generic suppresses a legacy duplicate
 * ONLY when `source === auto && variant === null && legacySlug &&
 * (movies|series) && chartExists`. Overall-only Crunchyroll IT has NO FP
 * movies/series split (`chartExists === false`, only `overall: []`), so the
 * generic JW-fallback movies/series entries are ADDED beside the identical
 * legacy JW-fallback pair — different catalogIds, same persisted semantic
 * list — forcing 5 chips where the user needs 3 independent per-provider
 * Film/Serie/Mista choices.
 *
 * Contract: backend shared contracts STABLE — no field/type/schema/id format
 * changes, only REMOVE semantic duplicates. Legacy ids win when
 * legacy-identical-first (no old config IDs invalidated). Strict FP/JW
 * responses unchanged. `amazon` vs `amazon-prime` and `hulu` vs
 * `hulu-nippon` stay distinct rows (canonicalization only via the existing
 * `genericIndexServiceId` alias map: prime->amazon-prime, apple->apple-tv,
 * hbo->hbo-max). Mixed `all` never merges with split sections.
 *
 * Offline proof: real captured fixture `availability-live-20261022.json`
 * (119 slugs / 82 services), no network, no guesses.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-availability-dedup-test`,
}));

import { GET as availabilityGET } from "@/app/api/streaming-availability/route";
import {
  __clearStreamingAvailabilityCache,
  buildGenericStreamingChoices,
  buildStreamingChoices,
  getStreamingAvailability,
  parseAvailabilityIndex,
} from "@/lib/streaming-availability";
import { genericIndexServiceId } from "@/lib/streaming-catalogs";
import { NextRequest } from "next/server";

function req(query: string) {
  return new NextRequest(`http://localhost:3000/api/streaming-availability?${query}`);
}

function loadLiveDoc() {
  const p = path.join(process.cwd(), "src/__tests__/catalogs/fixtures/availability-live-20261022.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Canonical semantic identity used by the auto dedup (mirrors the fix). */
function canonicalKey(c: {
  service: string;
  chartSlug?: string;
  countryFlixSlug?: string;
  section: string;
  variant?: string | null;
}): string {
  const slug = (c.chartSlug ?? c.countryFlixSlug ?? "").toLowerCase();
  const svc = genericIndexServiceId(String(c.service).toLowerCase());
  return `${svc}|${slug}|${c.section}|auto|${c.variant ?? "-"}`;
}

beforeEach(() => {
  __clearStreamingAvailabilityCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { default: fsp } = await import("node:fs/promises");
  await fsp.rm(`${process.cwd()}/test-results/streaming-availability-dedup-test`, {
    recursive: true,
    force: true,
  });
});

describe("auto dedup: Italy Crunchyroll is exactly 3 semantic lists (RED-before)", () => {
  it("auto IT Crunchyroll = 2 legacy JW split fallbacks + 1 FP mixed, never 5", async () => {
    const doc = loadLiveDoc();
    // Sanity on the real capture: Crunchyroll IT is overall-only (no FP split).
    expect(doc.regions.italy.crunchyroll).toEqual({ overall: [] });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));

    const json = await (await availabilityGET(req("service=crunchyroll&country=IT"))).json();
    const choices = json.choices as Array<{
      catalogId: string;
      service: string;
      section: string;
      potential: string;
      overallOnly?: boolean;
      source?: string;
      variant?: string | null;
      chartSlug?: string;
      countryFlixSlug?: string;
    }>;

    // EXACT 3 semantic lists, not 5.
    expect(choices).toHaveLength(3);

    // The 2 split fallbacks keep their STABLE legacy auto ids.
    const ids = choices.map((c) => c.catalogId).sort();
    expect(ids).toEqual([
      "pictorium-stream-crunchyroll-it-movies",
      "pictorium-stream-crunchyroll-it-series",
      "pictorium-stream2-crunchyroll--italy--all--auto",
    ]);

    const byId = new Map(choices.map((c) => [c.catalogId, c]));
    expect(byId.get("pictorium-stream-crunchyroll-it-movies")).toMatchObject({
      section: "movies",
      potential: "justwatch",
    });
    expect(byId.get("pictorium-stream-crunchyroll-it-series")).toMatchObject({
      section: "series",
      potential: "justwatch",
    });
    expect(byId.get("pictorium-stream2-crunchyroll--italy--all--auto")).toMatchObject({
      section: "all",
      potential: "flixpatrol",
    });

    // No duplicate canonical semantic id downstream (AddableLists count).
    expect(new Set(choices.map(canonicalKey)).size).toBe(choices.length);
  });

  it("Netflix/Paramount IT keep stable legacy split lists with no generic shadow (mixed all preserved)", async () => {
    const doc = loadLiveDoc();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));
    // Netflix IT has no overall chart: exactly the 2 legacy split lists.
    const netflix = await (await availabilityGET(req("service=netflix&country=IT"))).json();
    expect(
      (netflix.choices as Array<{ catalogId: string }>).map((c) => c.catalogId).sort(),
    ).toEqual(["pictorium-stream-netflix-it-movies", "pictorium-stream-netflix-it-series"]);
    // Paramount IT carries a real overall base too: the 2 legacy splits PLUS
    // the genuinely distinct mixed `all` (never merged with the split).
    const paramount = await (await availabilityGET(req("service=paramount&country=IT"))).json();
    expect(
      (paramount.choices as Array<{ catalogId: string }>).map((c) => c.catalogId).sort(),
    ).toEqual([
      "pictorium-stream-paramount-it-movies",
      "pictorium-stream-paramount-it-series",
      "pictorium-stream2-paramount--italy--all--auto",
    ]);
  });

  it("Rai IT variant stays distinct from the base (variant-only base rule intact)", async () => {
    const doc = loadLiveDoc();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));
    const json = await (await availabilityGET(req("service=rai&country=IT"))).json();
    const ids = (json.choices as Array<{ catalogId: string }>).map((c) => c.catalogId);
    expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it");
    expect(ids).not.toContain("pictorium-stream2-rai--italy--series--auto");
    // Base sections still served where the index proves them.
    expect(ids).toContain("pictorium-stream2-rai--italy--movies--auto");
    expect(ids).toContain("pictorium-stream2-rai--italy--all--auto");
  });

  it("strict source policies unchanged: only-FP serves real FP charts, only-JW serves the matrix", async () => {
    const doc = loadLiveDoc();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));
    const fp = await (await availabilityGET(req("service=crunchyroll&country=IT&source=flixpatrol"))).json();
    const fpIds = (fp.choices as Array<{ catalogId: string }>).map((c) => c.catalogId).sort();
    expect(fpIds).toEqual(["pictorium-stream2-crunchyroll--italy--all--flixpatrol"]);
    const jw = await (await availabilityGET(req("service=crunchyroll&country=IT&source=justwatch"))).json();
    const jwIds = (jw.choices as Array<{ catalogId: string }>).map((c) => c.catalogId).sort();
    expect(jwIds).toEqual([
      "pictorium-stream2-crunchyroll--italy--movies--justwatch",
      "pictorium-stream2-crunchyroll--italy--series--justwatch",
    ]);
  });

  it("full live universe: dedup removes ONLY duplicate keys, misses no semantic list", async () => {
    const doc = loadLiveDoc();
    const parsed = parseAvailabilityIndex(doc)!;
    const indexKnown = true;
    const legacy = buildStreamingChoices(parsed.regions, indexKnown);
    const genericAuto = buildGenericStreamingChoices(parsed.regions, parsed.variants, indexKnown, {
      source: "auto",
    });
    // Expected semantic cardinality, computed from the live document — never a
    // hardcoded total (the pre-dedup auto result was 1777; that stale count
    // must NOT be maintained by test-gaming).
    const expectedKeys = new Set<string>();
    for (const c of [...legacy, ...genericAuto]) expectedKeys.add(canonicalKey(c as never));
    expect(legacy.length + genericAuto.length).toBeGreaterThan(expectedKeys.size);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(doc));
    const auto = await getStreamingAvailability();
    // Same computed cardinality: duplicates gone, nothing else lost.
    expect(auto.choices.length).toBe(expectedKeys.size);
    expect(new Set(auto.choices.map(canonicalKey as never)).size).toBe(auto.choices.length);
    // Response order retains first (legacy) ids: no legacy catalogId lost.
    const autoIds = new Set(auto.choices.map((c) => (c as { catalogId: string }).catalogId));
    for (const c of legacy) {
      expect(autoIds.has(c.catalogId)).toBe(true);
    }
    // Provider-name aliases stay ONE semantic service: amazon-prime (index id)
    // and prime (legacy name) canonicalize together, never two rows.
    const primeKeys = auto.choices
      .filter(
        (c) =>
          ((c as { chartSlug?: string; countryFlixSlug?: string }).chartSlug ??
            (c as { chartSlug?: string; countryFlixSlug?: string }).countryFlixSlug) === "italy" &&
          (c as { section: string }).section === "movies" &&
          ["prime", "amazon-prime"].includes((c as { service: string }).service),
      )
      .map(canonicalKey as never);
    expect(new Set(primeKeys).size).toBe(1);
    // hulu vs hulu-nippon never merge (different services, different rows).
    const huluRows = auto.choices.filter(
      (c) => (c as { service: string }).service === "hulu",
    );
    const nipponRows = auto.choices.filter(
      (c) => (c as { service: string }).service === "hulu-nippon",
    );
    expect(huluRows.length).toBeGreaterThan(0);
    expect(nipponRows.length).toBeGreaterThan(0);
    expect(
      (huluRows[0] as { chartSlug?: string; countryFlixSlug?: string }).chartSlug ??
        (huluRows[0] as { chartSlug?: string; countryFlixSlug?: string }).countryFlixSlug,
    ).not.toBe(
      (nipponRows[0] as { chartSlug?: string; countryFlixSlug?: string }).chartSlug ??
        (nipponRows[0] as { chartSlug?: string; countryFlixSlug?: string }).countryFlixSlug,
    );
  });
});
