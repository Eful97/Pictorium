/**
 * Task F correction c3 (RED-before/GREEN-after): persisted availability-cache
 * migration (M1), strict variant validation (M2), and mixed-`all` manifest
 * types (N).
 *
 * - M1: pre-F disk snapshots carry only normalized booleans with NO
 *   `variants` key. Trusting them as `variants: {}` makes `hasBase()` read
 *   `true + []` as a proven base and advertises a fictitious base for
 *   variant-only categories (verified real doc: `italy.rai.series: ["it"]`,
 *   only `rai.series-it` exists upstream). The persisted parser now rejects
 *   snapshots without `variants` (compat marker) so the loader forces a
 *   bounded refetch; with the network down the loader reports honestly
 *   unknown (never a stale `true`).
 * - M2: a present-but-nonempty invalid `variant` drops the selection entry
 *   (never a silent coerce to base); absent/null/"" stays base. Write
 *   boundaries (defaults PUT, full + partial config tokens) reject invalid
 *   variants with the single canonical `parseGenericVariantId` leaf.
 * - N: mixed `all` catalogs are served under `/catalog/all/...`; the string
 *   `catalog` resource inherits root `types` (SDK manifest docs), so root
 *   advertises `all` exactly when mixed catalogs are emitted. `meta` keeps
 *   its explicit types (the resolver has no `all` branch).
 *
 * Isolated like the sibling slices: own DATA_DIR, own cache clears.
 */
import fs from "node:fs"
import path from "node:path"
import fsp from "node:fs/promises"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-variants-cache-test`,
}))

import { GET as availabilityGET } from "@/app/api/streaming-availability/route"
import { cacheClear } from "@/lib/cache"
import {
  __clearStreamingAvailabilityCache,
  __clearStreamingAvailabilityMemory,
  getStreamingAvailability,
} from "@/lib/streaming-availability"
import { sanitizeGenericStreamingSelections } from "@/lib/streaming-catalogs"
import { configTokenSchema, partialCatalogTokenSchema, encodeConfig, decodeConfig } from "@/lib/config-token"

const DIR = `${process.cwd()}/test-results/streaming-variants-cache-test`
const DISK = path.join(DIR, "streaming-availability.json")

// Real-format index excerpt: Rai Italy series is variant-only (no base),
// Netflix Italy carries real bases. `generated_at` is fresh (ok path).
const REAL_DOC = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  regions: {
    italy: {
      netflix: { movies: [], series: [] },
      rai: { movies: [], overall: [], series: ["it"] },
    },
  },
}

function writeLegacyDisk(): void {
  fs.mkdirSync(DIR, { recursive: true })
  // Pre-F normalized snapshot: booleans only, NO `variants` key.
  fs.writeFileSync(
    DISK,
    JSON.stringify({
      fetchedAt: Date.now(),
      generatedAt: null,
      regions: { italy: { rai: { movies: true, series: true, overall: true } } },
    }),
    "utf-8",
  )
}

function readDiskRaw(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(DISK, "utf-8")) as Record<string, unknown>
}

beforeEach(() => {
  __clearStreamingAvailabilityCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
})

afterAll(async () => {
  await fsp.rm(DIR, { recursive: true, force: true }).catch(() => {})
})

describe("M1: legacy persisted cache without variants forces refetch (no fake base)", () => {
  it("migrates on fetch: variant-only Rai series emits exact variant, never a base", async () => {
    writeLegacyDisk()
    // Simulate a restart against the legacy file (memory empty, disk kept).
    __clearStreamingAvailabilityMemory()
    expect(fs.existsSync(DISK)).toBe(true)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(REAL_DOC))
    const res = await getStreamingAvailability({ service: "rai", country: "IT" })
    const ids = res.choices.map((c) => c.catalogId)
    expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it")
    expect(ids).not.toContain("pictorium-stream2-rai--italy--series--auto")
    const variantChoice = res.choices.find((c) => "variant" in c && c.variant === "it")
    expect(variantChoice).toMatchObject({ potential: "flixpatrol", fpChart: true })
    // Migration persisted the compat marker: the rewritten disk snapshot
    // carries `variants` (fresh roundtrips stay intact, no repeated legacy).
    expect(readDiskRaw()["variants"]).toBeDefined()
  })

  it("network down with legacy cache never advertises the fake base (honestly unknown)", async () => {
    writeLegacyDisk()
    __clearStreamingAvailabilityMemory()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    const res = await getStreamingAvailability({ service: "rai", country: "IT" })
    const ids = res.choices.map((c) => c.catalogId)
    expect(ids).not.toContain("pictorium-stream2-rai--italy--series--auto")
    // Honest: error (unknown FP coverage), never a stale `true` base.
    expect(res.indexStatus).toBe("error")
    expect(res.choices.every((c) => c.fpChart === "unknown")).toBe(true)
  })

  it("new cache fresh roundtrip preserves base/variant coverage and source age", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(REAL_DOC))
    const first = await getStreamingAvailability({})
    expect(first.generatedAt).toBe(REAL_DOC.generated_at)
    const firstIds = first.choices.map((c) => c.catalogId)
    expect(firstIds).toContain("pictorium-stream2-rai--italy--series--auto--it")
    // Legacy-identical Netflix IT base stays on the legacy id (generic
    // suppresses the duplicate); the base itself must survive the roundtrip.
    expect(firstIds).toContain("pictorium-stream-netflix-it-series")
    // Restart (memory dropped, disk kept) + network down: the NEW snapshot
    // (with `variants`) reloads identically — base stays base, variant-only
    // stays variant-only, source age preserved.
    __clearStreamingAvailabilityMemory()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    const second = await getStreamingAvailability({})
    // Source-fresh document (`generated_at` recent): the reloaded disk
    // snapshot reports `ok` (source age, not fetch age), with identical
    // coverage and source age.
    expect(second.indexStatus).toBe("ok")
    expect(second.generatedAt).toBe(REAL_DOC.generated_at)
    const secondIds = second.choices.map((c) => c.catalogId)
    expect(secondIds).toContain("pictorium-stream2-rai--italy--series--auto--it")
    expect(secondIds).not.toContain("pictorium-stream2-rai--italy--series--auto")
    expect(secondIds).toContain("pictorium-stream-netflix-it-series")
  })
})

describe("M2: strict variant validation (read drops, write rejects, valid accepted)", () => {
  it("drops present-nonempty invalid variants, keeps absent/null/empty as base", () => {
    expect(sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", source: "auto", variant: "--evil" }])).toEqual([])
    expect(sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", variant: "BAD--V" }])).toEqual([])
    expect(sanitizeGenericStreamingSelections([{ service: "hulu", country: "US", variant: "has space" }])).toEqual([])
    // Absent/null/empty compatibility (documented contract, never migrated):
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "united-states" }])![0],
    ).toMatchObject({ variant: null })
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "united-states", variant: null }])![0],
    ).toMatchObject({ variant: null })
    expect(
      sanitizeGenericStreamingSelections([{ service: "hulu", country: "united-states", variant: "" }])![0],
    ).toMatchObject({ variant: null })
  })

  it("accepts real feed variants (incl. hyphenated) with source-only FP identity preserved", () => {
    const out = sanitizeGenericStreamingSelections([
      { service: "crave", country: "canada", sections: ["all"], source: "flixpatrol", variant: "amazon-channels" },
      { service: "hulu-nippon", country: "japan", sections: ["movies"], source: "auto", variant: "ja" },
      { service: "hulu-nippon", country: "japan", sections: ["series"], source: "auto", variant: "ko" },
    ])!
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ service: "crave", variant: "amazon-channels", source: "flixpatrol" })
    expect(out[1]).toMatchObject({ variant: "ja" })
    expect(out[2]).toMatchObject({ variant: "ko" })
  })

  it("write boundaries reject unsafe variants (defaults PUT 400, tokens fail closed)", async () => {
    const { PUT } = await import("@/app/api/defaults/route")
    const put = (body: unknown) =>
      PUT(
        new Request("http://localhost:3000/api/defaults", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }) as unknown as NextRequest,
      )
    expect((await put({ streamingSelections: [{ service: "hulu", country: "US", variant: "--evil" }] })).status).toBe(400)
    expect((await put({ streamingSelections: [{ service: "hulu", country: "US", variant: "BAD--V" }] })).status).toBe(400)
    expect(
      (await put({ streamingSelections: [{ service: "hulu", country: "united-states", variant: "amazon-channels" }] })).status,
    ).toBe(200)
    // Config tokens share the same canonical gate (full + partial schemas).
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
    expect(
      configTokenSchema.safeParse({ ...base, streamingSelections: [{ service: "hulu", country: "US", variant: "--evil" }] }).success,
    ).toBe(false)
    expect(
      partialCatalogTokenSchema.safeParse({ streamingSelections: [{ service: "hulu", country: "US", variant: "--evil" }] }).success,
    ).toBe(false)
    const validSelections = [{ service: "hulu", country: "united-states", variant: "amazon-channels" }]
    expect(decodeConfig(encodeConfig({ ...base, streamingSelections: validSelections }))?.streamingSelections).toEqual(
      validSelections,
    )
  })
})

describe("N: mixed all manifest types (root conditional, meta untouched, legacy identical)", () => {
  it("advertises root all only with mixed catalogs; legacy stays byte-identical", async () => {
    const { setServerDefaults } = await import("@/lib/server-defaults")
    const { buildManifestResponse } = await import("@/lib/build-manifest")
    // Legacy: no mixed catalogs (explicit empty opt-in keeps only JW/anime).
    await setServerDefaults({ streamingSelections: [] })
    const legacy = await (await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))).json()
    expect(legacy.types).toEqual(["movie", "series", "anime.movie", "anime.series", "anime"])
    expect(legacy.catalogs.some((c: { type: string }) => c.type === "all")).toBe(false)
    // Mixed: variant overall choice adds a stream2 all id.
    await setServerDefaults({
      streamingSelections: [{ service: "crave", country: "canada", sections: ["all"], source: "auto", variant: "amazon-channels" }],
    })
    const mixed = await (await buildManifestResponse(new NextRequest("http://localhost:3000/manifest.json"))).json()
    expect(mixed.types).toContain("all")
    expect(mixed.catalogs.some((c: { id: string; type: string }) => c.id === "pictorium-stream2-crave--canada--all--auto--amazon-channels" && c.type === "all")).toBe(true)
    // The meta resource keeps its explicit resolver-supported types (no fake meta all).
    const meta = (mixed.resources as Array<string | { name: string; types: string[] }>).find(
      (r) => typeof r !== "string" && r.name === "meta",
    ) as { name: string; types: string[] }
    expect(meta.types).not.toContain("all")
    expect(meta.types).toEqual(["movie", "series", "anime.movie", "anime.series", "anime"])
  })

  it("availability endpoint still serves the real variant choice over HTTP", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(REAL_DOC))
    const json = await (await availabilityGET(new NextRequest("http://localhost:3000/api/streaming-availability?service=rai&country=IT"))).json()
    const ids = (json.choices as Array<{ catalogId: string }>).map((c) => c.catalogId)
    expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it")
    expect(ids).not.toContain("pictorium-stream2-rai--italy--series--auto")
  })
})
