/**
 * Per-title portrait/landscape independence for the remaining shared visuals:
 * customBadge (extra text), manual accentColor and the Badge Lab binding
 * badgePresetId/badgePresetRev — end to end at the mapping layer.
 *
 * Contract (user-authorized independence, no migration on read):
 * - legacy mappings without the new `landscape` keys render exactly as before
 *   on both shapes (absent profile key = inherit the flat, shared fallback);
 * - a present landscape key (concrete OR explicit null) ALWAYS wins over the
 *   flat for the landscape shape; explicit null = "none/automatic" for the
 *   target shape and never resurrects the flat;
 * - the preset binding travels as a pair: a landscape side never mixes with
 *   the flat side;
 * - manual accent stays manual-only in the mapping (auto is null/absent);
 *   builders emit the shape-effective values through the existing
 *   `extra=`/`ac=`/`badgePreset=`/`prv=` params (no new URL keys).
 */
import { describe, expect, it } from "vitest"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import {
  MAPPING_SHAPE_LAND_KEYS,
  mappingShapeChainEffective,
  snapshotMissingMappingLandscape,
} from "@/lib/visual-presets"

function baseMapping(partial: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 7,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    ...partial,
  }
}

const stremioInput = (mapping: Mapping | null, forceShape?: "poster" | "landscape") => ({
  origin: "https://x.test",
  type: "movie" as const,
  id: 7,
  defaults: {},
  mapping,
  lang: "it",
  ...(forceShape ? { forceShape } : {}),
})

describe("landscape validation for customBadge/accent/preset", () => {
  it("parses a landscape profile carrying the new visual keys", () => {
    const r = mappingSchema.safeParse({
      ...baseMapping(),
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: {
        customBadge: "Landscape pick",
        accentColor: "#00ff00",
        badgePresetId: "Landscap_01",
        badgePresetRev: "abcdef12",
      },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.landscape?.customBadge).toBe("Landscape pick")
      expect(r.data.landscape?.accentColor).toBe("#00ff00")
      expect(r.data.landscape?.badgePresetId).toBe("Landscap_01")
      expect(r.data.landscape?.badgePresetRev).toBe("abcdef12")
    }
  })

  it("preserves explicit null clears in the landscape profile", () => {
    const r = mappingSchema.safeParse({
      ...baseMapping(),
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: {
        customBadge: null,
        accentColor: null,
        badgePresetId: null,
        badgePresetRev: null,
      },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.landscape).toMatchObject({
        customBadge: null,
        accentColor: null,
        badgePresetId: null,
        badgePresetRev: null,
      })
    }
  })

  it("keeps legacy profiles without the new keys valid", () => {
    const r = mappingSchema.safeParse({
      ...baseMapping(),
      customBadge: "Hi",
      landscape: { badgeStyle: "pill" },
    })
    expect(r.success).toBe(true)
  })

  it("rejects garbage in the new landscape keys", () => {
    expect(
      mappingSchema.safeParse({ ...baseMapping(), landscape: { accentColor: "red" } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping(), landscape: { badgePresetId: "<script>" } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping(), landscape: { badgePresetRev: "RANDOM" } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping(), landscape: { customBadge: "x".repeat(41) } }).success,
    ).toBe(false)
  })
})

describe("effectiveMappingForShape for customBadge/accent/preset", () => {
  it("legacy mappings inherit the flat on both shapes (byte-identical)", () => {
    const m = baseMapping({
      customBadge: "Hi",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
    })
    expect(effectiveMappingForShape(m, "landscape")).toBe(m)
    expect(effectiveMappingForShape(m, "poster")).toBe(m)
  })

  it("diverges independently in both directions (NEW titles)", () => {
    const m = baseMapping({
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: {
        customBadge: "Landscape pick",
        accentColor: "#00ff00",
        badgePresetId: "Landscap_01",
        badgePresetRev: "abcdef12",
      },
    })
    const portrait = effectiveMappingForShape(m, "poster")
    const landscape = effectiveMappingForShape(m, "landscape")
    expect(portrait?.customBadge).toBe("Portrait pick")
    expect(portrait?.accentColor).toBe("#ff0000")
    expect(portrait?.badgePresetId).toBe("Abc123-_XyZ")
    expect(portrait?.badgePresetRev).toBe("deadbeef")
    expect(landscape?.customBadge).toBe("Landscape pick")
    expect(landscape?.accentColor).toBe("#00ff00")
    expect(landscape?.badgePresetId).toBe("Landscap_01")
    expect(landscape?.badgePresetRev).toBe("abcdef12")
  })

  it("explicit null clears shadow the flat and never resurrect it", () => {
    const m = baseMapping({
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: {
        customBadge: null,
        accentColor: null,
        badgePresetId: null,
        badgePresetRev: null,
      },
    })
    const landscape = effectiveMappingForShape(m, "landscape")
    expect(landscape?.customBadge).toBeNull()
    expect(landscape?.accentColor).toBeNull()
    expect(landscape?.badgePresetId).toBeNull()
    expect(landscape?.badgePresetRev).toBeNull()
    // The portrait side still reads the flat.
    const portrait = effectiveMappingForShape(m, "poster")
    expect(portrait?.customBadge).toBe("Portrait pick")
    expect(portrait?.accentColor).toBe("#ff0000")
    expect(portrait?.badgePresetId).toBe("Abc123-_XyZ")
  })

  it("an empty customBadge string shadows the flat (explicit none)", () => {
    const m = baseMapping({ customBadge: "Portrait pick", landscape: { customBadge: "" } })
    expect(effectiveMappingForShape(m, "landscape")?.customBadge).toBe("")
    expect(effectiveMappingForShape(m, "poster")?.customBadge).toBe("Portrait pick")
  })

  it("binds the preset id/rev as a pair (never mixes flat and profile sides)", () => {
    const idOnly = baseMapping({
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01" },
    })
    const landEff = effectiveMappingForShape(idOnly, "landscape")
    expect(landEff?.badgePresetId).toBe("Landscap_01")
    // The profile side owns the pair now: the flat rev must NOT leak in.
    expect(landEff?.badgePresetRev).toBeNull()

    const revOnly = baseMapping({
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetRev: "abcdef12" },
    })
    const landEff2 = effectiveMappingForShape(revOnly, "landscape")
    expect(landEff2?.badgePresetRev).toBe("abcdef12")
    expect(landEff2?.badgePresetId).toBeNull()
  })
})

describe("save-boundary helpers cover the new visual keys", () => {
  it("MAPPING_SHAPE_LAND_KEYS owns the four new keys", () => {
    for (const key of ["customBadge", "accentColor", "badgePresetId", "badgePresetRev"] as const) {
      expect(MAPPING_SHAPE_LAND_KEYS).toContain(key)
    }
  })

  it("backfill freezes the pre-edit flat for inherited profile keys", () => {
    const adds = snapshotMissingMappingLandscape(
      { customBadge: "Hi", accentColor: "#ff0000", badgePresetId: "Abc123-_XyZ", badgePresetRev: "deadbeef" },
      {},
    )
    expect(adds).toMatchObject({
      customBadge: "Hi",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
    })
  })

  it("backfill freezes explicit null (auto/none) instead of dropping it", () => {
    const adds = snapshotMissingMappingLandscape(
      { customBadge: null, accentColor: null, badgePresetId: null, badgePresetRev: null },
      {},
    )
    expect(adds).toMatchObject({
      customBadge: null,
      accentColor: null,
      badgePresetId: null,
      badgePresetRev: null,
    })
  })

  it("backfill skips absent flats (the shape keeps inheriting)", () => {
    const adds = snapshotMissingMappingLandscape({}, {})
    expect("customBadge" in adds).toBe(false)
    expect("accentColor" in adds).toBe(false)
    expect("badgePresetId" in adds).toBe(false)
    expect("badgePresetRev" in adds).toBe(false)
  })

  it("chain-effective reports no defaults provenance for the new keys", () => {
    for (const key of ["customBadge", "accentColor", "badgePresetId", "badgePresetRev"] as const) {
      expect(mappingShapeChainEffective(key, {}, {}).known).toBe(false)
    }
  })
})

describe("stremio builder emits the shape-effective visuals", () => {
  it("uses the landscape profile for landscape shapes and the flat for portrait", () => {
    const m = baseMapping({
      customBadge: "Portrait pick",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: {
        customBadge: "Landscape pick",
        badgePresetId: "Landscap_01",
        badgePresetRev: "abcdef12",
      },
    })
    const portraitUrl = buildStremioPosterUrl(stremioInput(m))
    expect(portraitUrl.searchParams.get("extra")).toBe("Portrait pick")
    expect(portraitUrl.searchParams.get("badgePreset")).toBe("Abc123-_XyZ")
    expect(portraitUrl.searchParams.get("prv")).toBe("deadbeef")
    const landscapeUrl = buildStremioPosterUrl(stremioInput(m, "landscape"))
    expect(landscapeUrl.searchParams.get("extra")).toBe("Landscape pick")
    expect(landscapeUrl.searchParams.get("badgePreset")).toBe("Landscap_01")
    expect(landscapeUrl.searchParams.get("prv")).toBe("abcdef12")
  })

  it("legacy mappings keep the shared flat fallback on both shapes", () => {
    const m = baseMapping({
      customBadge: "Shared pick",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
    })
    const portraitUrl = buildStremioPosterUrl(stremioInput(m))
    const landscapeUrl = buildStremioPosterUrl(stremioInput(m, "landscape"))
    expect(portraitUrl.searchParams.get("extra")).toBe("Shared pick")
    expect(landscapeUrl.searchParams.get("extra")).toBe("Shared pick")
    expect(landscapeUrl.searchParams.get("badgePreset")).toBe("Abc123-_XyZ")
    expect(landscapeUrl.searchParams.get("prv")).toBe("deadbeef")
  })

  it("an explicit landscape clear emits no extra/preset (never resurrects the flat)", () => {
    const m = baseMapping({
      customBadge: "Portrait pick",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { customBadge: null, badgePresetId: null, badgePresetRev: null },
    })
    const landscapeUrl = buildStremioPosterUrl(stremioInput(m, "landscape"))
    expect(landscapeUrl.searchParams.has("extra")).toBe(false)
    expect(landscapeUrl.searchParams.has("badgePreset")).toBe(false)
    expect(landscapeUrl.searchParams.has("prv")).toBe(false)
    // The portrait URL still carries the flat values.
    const portraitUrl = buildStremioPosterUrl(stremioInput(m))
    expect(portraitUrl.searchParams.get("extra")).toBe("Portrait pick")
    expect(portraitUrl.searchParams.get("badgePreset")).toBe("Abc123-_XyZ")
  })
})
