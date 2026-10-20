/**
 * Foundation: independently configurable badge presets per family (pure
 * data model / schema / binding — no renderer or UI integration yet).
 *
 * Covers the extension of the single legacy top/genre Badge Lab binding:
 * - legacy targets/ids/revisions/imports keep validating (backward compat);
 * - explicit family targets validate (custom everywhere, house only where a
 *   house renderer exists — fail-closed elsewhere);
 * - the sparse per-title/per-shape `badgePresets` map validates with bounded
 *   keys/ids/revisions and rejects unknown families + prototype keys;
 * - the pure family resolver keeps bindings independent per family, lets an
 *   explicit staged/query presence shadow the mapping in preview, preserves
 *   explicit-null + profile inheritance per shape, and applies the legacy
 *   singleton only to its resolved target.
 */
import { describe, expect, it } from "vitest"
import {
  BADGE_FAMILY_IDS,
  MAX_BADGE_FAMILIES,
  badgeFamilyBindingsSchema,
  badgePresetSchema,
  houseStyleAllowlistForTarget,
  isBadgeFamilyId,
  resolveLegacyTargetFamilies,
  type BadgeFamilyId,
} from "@/lib/badge-preset"
import { resolveFamilyPresetBindings, resolvePresetBinding } from "@/lib/badge-preset-binding"
import { coerceBackupPreset } from "@/lib/backup-schema"
import { mappingSchema, mappingUpdateSchema } from "@/lib/validation"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const FLAT_ID = "Abc123-_XyZ"
const FLAT_REV = "deadbeef"
const RANK_ID = "Rank0000-aaa"
const RANK_REV = "12345678"
const STAGED_ID = "Staged999-bbb"
const STAGED_REV = "abcdef01"

const design = {
  shape: "pill",
  padding: { x: 12, y: 6 },
  background: { type: "solid", color: "#cc0000", opacity: 100 },
  text: {
    template: "P",
    color: "#ffffff",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0,
    align: "center",
  },
  scale: 100,
}

function customPreset(target: string, id = FLAT_ID) {
  return {
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "custom",
    design,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: FLAT_REV,
  }
}

function housePreset(target: string, style: string) {
  return {
    version: 1,
    id: FLAT_ID,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "H", tags: [] },
    variant: "house",
    house: { style, scale: 100, polarity: "auto" },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: FLAT_REV,
  }
}

const baseMapping = {
  tmdbId: 1,
  mediaType: "movie",
  title: "T",
  posterPath: "/p.jpg",
}

function savedMapping(overrides: Record<string, unknown> = {}): Mapping {
  return {
    ...baseMapping,
    mediaType: "movie",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  } as Mapping
}

describe("legacy contract stays valid", () => {
  it("accepts the legacy top/genre preset targets with the stored id format", () => {
    expect(badgePresetSchema.safeParse(customPreset("top")).success).toBe(true)
    expect(badgePresetSchema.safeParse(customPreset("genre")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("top", "default")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("genre", "shadow")).success).toBe(true)
  })

  it("keeps old preset versions unchanged (version literal 1)", () => {
    expect(badgePresetSchema.safeParse({ ...customPreset("top"), version: 2 }).success).toBe(false)
  })

  it("keeps the legacy house style allowlists (top=ranking, genre=genre)", () => {
    // A genre-only style on a top preset was always invalid and stays so.
    expect(badgePresetSchema.safeParse(housePreset("top", "shadow")).success).toBe(false)
    expect(badgePresetSchema.safeParse(housePreset("genre", "default")).success).toBe(false)
  })

  it("keeps legacy mappings/updates valid without the family map", () => {
    expect(mappingSchema.safeParse(baseMapping).success).toBe(true)
    expect(
      mappingSchema.safeParse({ ...baseMapping, badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }).success,
    ).toBe(true)
    expect(mappingUpdateSchema.safeParse({ badgePresetId: FLAT_ID }).success).toBe(true)
  })

  it("keeps old import/save schemas valid (backup coercion accepts legacy targets)", () => {
    expect(coerceBackupPreset({ ...customPreset("top"), revision: FLAT_REV })?.target).toBe("top")
    expect(coerceBackupPreset({ ...customPreset("genre"), revision: FLAT_REV })?.target).toBe("genre")
  })

  it("keeps the singleton resolver behavior intact", () => {
    const m = savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV })
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: m, shape: "poster", isPreview: false }),
    ).toEqual({ id: FLAT_ID, rev: FLAT_REV })
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: m, shape: "poster", isPreview: true }),
    ).toEqual({ id: null, rev: null })
  })
})

describe("explicit family targets", () => {
  it("accepts a custom preset for every stable family id", () => {
    expect(MAX_BADGE_FAMILIES).toBe(9)
    for (const family of BADGE_FAMILY_IDS) {
      expect(badgePresetSchema.safeParse(customPreset(family)).success).toBe(true)
    }
  })

  it("extends the ranking slot allowlist to rank/extra and houses every family with native builders", () => {
    expect(badgePresetSchema.safeParse(housePreset("rank", "default")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("extra", "pill")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("rank", "shadow")).success).toBe(false)
    // Technical families render through their own native builders (same
    // recipes as the poster): house validates per family with native styles,
    // custom validates everywhere; cross-family styles stay rejected.
    expect(badgePresetSchema.safeParse(customPreset("quality")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("quality", "standard")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("quality", "mono")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("quality", "netflix")).success).toBe(false)
    expect(badgePresetSchema.safeParse(housePreset("age", "standard")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("age", "knockout")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("network", "pill")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("separateRatings", "column")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("customRatings", "row")).success).toBe(true)
    expect(badgePresetSchema.safeParse(housePreset("comingSoon", "ribbon")).success).toBe(true)
    expect(houseStyleAllowlistForTarget("quality")).toContain("standard")
    expect(houseStyleAllowlistForTarget("genre")).toContain("shadow")
    expect(houseStyleAllowlistForTarget("rank")).toContain("default")
  })

  it("rejects unknown preset targets", () => {
    expect(badgePresetSchema.safeParse(customPreset("nope")).success).toBe(false)
  })

  it("lets the backup import schema accept the new family targets", () => {
    expect(coerceBackupPreset({ ...customPreset("rank"), revision: FLAT_REV })?.target).toBe("rank")
    expect(coerceBackupPreset({ ...customPreset("quality"), revision: FLAT_REV })?.target).toBe("quality")
    expect(coerceBackupPreset({ ...customPreset("nope"), revision: FLAT_REV })).toBeNull()
  })
})

describe("badgePresets map validation (write boundaries)", () => {
  const valid = (overrides: Record<string, unknown> = {}) =>
    mappingSchema.safeParse({ ...baseMapping, ...overrides })

  it("accepts sparse valid entries and explicit per-family null", () => {
    expect(
      valid({ badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV } } }).success,
    ).toBe(true)
    expect(
      valid({ badgePresets: { rank: { id: RANK_ID }, genre: null } }).success,
    ).toBe(true)
    expect(valid({ badgePresets: null }).success).toBe(true)
    expect(valid({}).success).toBe(true)
  })

  it("accepts the full nine-family map", () => {
    const full: Record<string, { id: string; rev: string }> = {}
    for (const family of BADGE_FAMILY_IDS) full[family] = { id: FLAT_ID, rev: FLAT_REV }
    expect(valid({ badgePresets: full }).success).toBe(true)
  })

  it("rejects malformed ids and revisions", () => {
    expect(valid({ badgePresets: { genre: { id: "<script>", rev: FLAT_REV } } }).success).toBe(false)
    expect(valid({ badgePresets: { genre: { id: "short", rev: FLAT_REV } } }).success).toBe(false)
    expect(valid({ badgePresets: { genre: { id: FLAT_ID, rev: "random" } } }).success).toBe(false)
    expect(valid({ badgePresets: { genre: { id: FLAT_ID, rev: "DEADBEEF" } } }).success).toBe(false)
    expect(valid({ badgePresets: { genre: "nope" } }).success).toBe(false)
    expect(valid({ badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV, extra: 1 } } }).success).toBe(false)
  })

  it("rejects unknown families and prototype keys", () => {
    expect(valid({ badgePresets: { nope: { id: FLAT_ID, rev: FLAT_REV } } }).success).toBe(false)
    const proto = JSON.parse('{"__proto__":{"genre":{"id":"Abc123-_XyZ"}}}')
    expect(valid({ badgePresets: proto }).success).toBe(false)
    expect(valid({ badgePresets: { constructor: { id: FLAT_ID } } }).success).toBe(false)
    expect(valid({ badgePresets: { prototype: { id: FLAT_ID } } }).success).toBe(false)
  })

  it("rejects the same map through the update schema and the landscape profile", () => {
    expect(
      mappingUpdateSchema.safeParse({ badgePresets: { rank: { id: RANK_ID, rev: RANK_REV } } }).success,
    ).toBe(true)
    expect(
      mappingUpdateSchema.safeParse({ badgePresets: { nope: { id: FLAT_ID } } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping, landscape: { badgePresets: { rank: null } } }).success,
    ).toBe(true)
    expect(
      mappingSchema.safeParse({ ...baseMapping, landscape: { badgePresets: { nope: null } } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping, landscape: { badgePresets: { genre: { id: "bad!" } } } })
        .success,
    ).toBe(false)
  })
})

describe("effectiveMappingForShape family merge", () => {
  it("sparse landscape inherits the flat map and explicit null shadows per family", () => {
    const m = savedMapping({
      badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV }, rank: { id: RANK_ID, rev: RANK_REV } },
      landscape: { badgePresets: { genre: null } },
    })
    const land = effectiveMappingForShape(m, "landscape")
    expect(land?.badgePresets).toEqual({
      genre: null,
      rank: { id: RANK_ID, rev: RANK_REV },
    })
    // Portrait keeps the flat pair verbatim.
    expect(effectiveMappingForShape(m, "poster")?.badgePresets).toEqual(m.badgePresets)
  })

  it("a null/absent landscape map inherits the flat map", () => {
    const flat = { genre: { id: FLAT_ID, rev: FLAT_REV } }
    expect(
      effectiveMappingForShape(savedMapping({ badgePresets: flat, landscape: null }), "landscape")
        ?.badgePresets,
    ).toEqual(flat)
    expect(
      effectiveMappingForShape(savedMapping({ badgePresets: flat }), "landscape")?.badgePresets,
    ).toEqual(flat)
  })
})

describe("resolveFamilyPresetBindings (pure)", () => {
  const none = { id: null, rev: null }

  function families(resolved: Record<BadgeFamilyId, { id: string | null; rev: string | null }>) {
    return resolved
  }

  it("resolves nothing without bindings", () => {
    const out = resolveFamilyPresetBindings({ mapping: savedMapping(), shape: "poster", isPreview: false })
    for (const family of BADGE_FAMILY_IDS) expect(out[family]).toEqual(none)
  })

  it("applies the legacy genre singleton only to its resolved target", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "genre",
    })
    expect(out.genre).toEqual({ id: FLAT_ID, rev: FLAT_REV })
    for (const family of BADGE_FAMILY_IDS.filter((f) => f !== "genre")) {
      expect(out[family]).toEqual(none)
    }
  })

  it("fans the legacy top singleton out to rank+extra only", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "top",
    })
    expect(out.rank).toEqual({ id: FLAT_ID, rev: FLAT_REV })
    expect(out.extra).toEqual({ id: FLAT_ID, rev: FLAT_REV })
    expect(out.genre).toEqual(none)
    expect(out.quality).toEqual(none)
  })

  it("ignores the legacy singleton without a resolved target", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: null,
    })
    for (const family of BADGE_FAMILY_IDS) expect(out[family]).toEqual(none)
  })

  it("keeps independent family bindings coexisting; clearing one never clears another", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({
        badgePresets: {
          rank: { id: RANK_ID, rev: RANK_REV },
          genre: { id: FLAT_ID, rev: FLAT_REV },
          quality: null,
        },
      }),
      shape: "poster",
      isPreview: false,
    })
    expect(families(out).rank).toEqual({ id: RANK_ID, rev: RANK_REV })
    expect(families(out).genre).toEqual({ id: FLAT_ID, rev: FLAT_REV })
    expect(families(out).quality).toEqual(none)
    expect(families(out).extra).toEqual(none)
  })

  it("inherits the flat map sparsely on landscape and honors explicit-null shadows", () => {
    const m = savedMapping({
      badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV }, rank: { id: RANK_ID, rev: RANK_REV } },
      landscape: { badgePresets: { genre: null } },
    })
    const land = resolveFamilyPresetBindings({ mapping: m, shape: "landscape", isPreview: false })
    expect(land.genre).toEqual(none)
    expect(land.rank).toEqual({ id: RANK_ID, rev: RANK_REV })
    const portrait = resolveFamilyPresetBindings({ mapping: m, shape: "poster", isPreview: false })
    expect(portrait.genre).toEqual({ id: FLAT_ID, rev: FLAT_REV })
  })

  it("lets explicit staged presence shadow the mapping in preview (and never resurrects without it)", () => {
    const m = savedMapping({ badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV } } })
    const staged = resolveFamilyPresetBindings({
      staged: { genre: { id: STAGED_ID, rev: STAGED_REV } },
      mapping: m,
      shape: "poster",
      isPreview: true,
    })
    expect(staged.genre).toEqual({ id: STAGED_ID, rev: STAGED_REV })
    const bare = resolveFamilyPresetBindings({ mapping: m, shape: "poster", isPreview: true })
    expect(bare.genre).toEqual(none)
  })

  it("lets the legacy query win over the mapping for its families only, staged first", () => {
    const m = savedMapping({
      badgePresetId: FLAT_ID,
      badgePresetRev: FLAT_REV,
      badgePresets: { genre: { id: FLAT_ID, rev: FLAT_REV } },
    })
    const out = resolveFamilyPresetBindings({
      mapping: m,
      shape: "poster",
      isPreview: false,
      legacyQueryId: STAGED_ID,
      legacyQueryRev: STAGED_REV,
      legacyQueryTarget: "genre",
      legacyMappingTarget: "genre",
    })
    expect(out.genre).toEqual({ id: STAGED_ID, rev: STAGED_REV })
    // The mapping family entry is shadowed by the query on the same family.
    const staged = resolveFamilyPresetBindings({
      staged: { genre: { id: RANK_ID, rev: RANK_REV } },
      mapping: m,
      shape: "poster",
      isPreview: false,
      legacyQueryId: STAGED_ID,
      legacyQueryRev: STAGED_REV,
      legacyQueryTarget: "genre",
      legacyMappingTarget: "genre",
    })
    expect(staged.genre).toEqual({ id: RANK_ID, rev: RANK_REV })
  })

  it("fails closed on malformed entries and ignores unknown/prototype staged keys", () => {
    const m = savedMapping({
      badgePresetId: FLAT_ID,
      badgePresetRev: FLAT_REV,
      badgePresets: { genre: { id: "<script>", rev: FLAT_REV } },
    })
    // Present-but-invalid mapping entry stays null and does NOT resurrect legacy.
    const out = resolveFamilyPresetBindings({
      mapping: m,
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "genre",
    })
    expect(out.genre).toEqual(none)
    const staged = resolveFamilyPresetBindings({
      staged: {
        genre: { id: "bad!" },
        rank: null,
        ...JSON.parse('{"__proto__":{"extra":{"id":"Abc123-_XyZ"}}}'),
      },
      mapping: savedMapping(),
      shape: "poster",
      isPreview: true,
    })
    expect(staged.genre).toEqual(none)
    expect(staged.rank).toEqual(none)
    expect(staged.extra).toEqual(none)
  })

  it("pins an absent rev to null without dropping the binding", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresets: { rank: { id: RANK_ID } } }),
      shape: "poster",
      isPreview: false,
    })
    expect(out.rank).toEqual({ id: RANK_ID, rev: null })
  })
})

describe("legacy target fan-out helper", () => {
  it("maps genre/families to themselves, top to rank+extra, garbage to none", () => {
    expect(resolveLegacyTargetFamilies("genre")).toEqual(["genre"])
    expect(resolveLegacyTargetFamilies("top")).toEqual(["rank", "extra"])
    expect(resolveLegacyTargetFamilies("quality")).toEqual(["quality"])
    expect(resolveLegacyTargetFamilies("nope")).toEqual([])
    expect(resolveLegacyTargetFamilies(null)).toEqual([])
    expect(isBadgeFamilyId("top")).toBe(false)
    expect(isBadgeFamilyId("rank")).toBe(true)
  })
})

describe("family map schema unit", () => {
  it("accepts sparse maps and rejects junk at the schema boundary", () => {
    expect(badgeFamilyBindingsSchema.safeParse(undefined).success).toBe(true)
    expect(badgeFamilyBindingsSchema.safeParse(null).success).toBe(true)
    expect(
      badgeFamilyBindingsSchema.safeParse({ rank: { id: RANK_ID, rev: RANK_REV } }).success,
    ).toBe(true)
    expect(badgeFamilyBindingsSchema.safeParse({ nope: null }).success).toBe(false)
  })
})
