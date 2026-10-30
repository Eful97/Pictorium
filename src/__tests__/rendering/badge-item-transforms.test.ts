/**
 * Per-ITEM badge transforms (`badge-item-transforms`): the shared schema,
 * the stable identity rules and the composition math.
 *
 * Contract:
 * - identity, never array position: a missing/reordered rating can never
 *   inherit another provider's tuning;
 * - the wire form is canonical (sorted, clamped, neutral entries dropped) so a
 *   configuration has exactly one representation (cache key, URL, mapping);
 * - neutral (100/0/0) is indistinguishable from "no entry": unconfigured
 *   output stays identical;
 * - composition: scale about the item's own centre, then the offset.
 */
import { describe, expect, it } from "vitest"
import {
  BADGE_ITEM_NEUTRAL,
  BADGE_ITEM_QUALITY_AGE,
  BADGE_ITEM_QUALITY_COMBO,
  BADGE_ITEM_QUALITY_HOMES,
  BADGE_ITEM_QUALITY_HOME_AGE,
  BADGE_ITEM_QUALITY_HOME_DOLBY,
  BADGE_ITEM_QUALITY_HOME_HDR,
  BADGE_ITEM_QUALITY_HOME_IMAX,
  BADGE_ITEM_QUALITY_HOME_TIER,
  BADGE_ITEM_QUALITY_TIER,
  BADGE_ITEM_SCALE_MAX,
  BADGE_ITEM_SCALE_MIN,
  applyBadgeItemTransform,
  badgeItemLabelKind,
  badgeItemTransform,
  canonicalizeBadgeItemTransforms,
  clampBadgeItemOffset,
  clampBadgeItemScale,
  effectiveBadgeItemTransforms,
  homeIdForPainted,
  isQualityHomeItemId,
  qualityHomeBaseLabel,
  qualityHomeItemId,
  qualityHomeKind,
  withoutBadgeItemFamily,
  hasBadgeItemTransforms,
  isBadgeItemId,
  isNeutralBadgeItemTransform,
  isQualityItemId,
  isRatingItemId,
  moveBadgeItemTransform,
  parseBadgeItemTransforms,
  qualityFormatItemId,
  ratingItemId,
  resizeBadgeItemTransform,
  serializeBadgeItemTransforms,
  withBadgeItemTransform,
  withoutBadgeItemTransform,
  type BadgeItemTransformMap,
} from "@/lib/badge-item-transforms"
import { BADGE_OFFSET_NUMERIC_LIMIT } from "@/lib/badge-offset-ranges"

describe("stable identities", () => {
  it("builds provider/format identities from the data, never from a position", () => {
    expect(ratingItemId("IMDB")).toBe("rating:imdb")
    expect(ratingItemId("metacriticuser")).toBe("rating:metacriticuser")
    expect(qualityFormatItemId("dv")).toBe("quality:format:dv")
    expect(qualityFormatItemId("hdr10plus")).toBe("quality:format:hdr10plus")
    expect(BADGE_ITEM_QUALITY_TIER).toBe("quality:tier")
    expect(BADGE_ITEM_QUALITY_AGE).toBe("quality:age")
    expect(BADGE_ITEM_QUALITY_COMBO).toBe("quality:combo:dv-atmos")
  })

  it("rejects garbage identities instead of inventing one", () => {
    expect(ratingItemId("")).toBeNull()
    expect(ratingItemId("!!")).toBeNull()
    expect(ratingItemId("a".repeat(64))).toBeNull()
    expect(qualityFormatItemId(null)).toBeNull()
    expect(isBadgeItemId("rating:imdb")).toBe(true)
    expect(isBadgeItemId("quality:tier")).toBe(true)
    expect(isBadgeItemId("imdb")).toBe(false)
    expect(isBadgeItemId("bogus:x")).toBe(false)
    expect(isBadgeItemId(42)).toBe(false)
  })

  it("classifies identities by family and label kind", () => {
    expect(isRatingItemId("rating:imdb")).toBe(true)
    expect(isQualityItemId(BADGE_ITEM_QUALITY_TIER)).toBe(true)
    expect(badgeItemLabelKind("rating:imdb")).toEqual({ kind: "rating", id: "imdb" })
    expect(badgeItemLabelKind(BADGE_ITEM_QUALITY_AGE)).toEqual({ kind: "age" })
    expect(badgeItemLabelKind(BADGE_ITEM_QUALITY_COMBO)).toEqual({ kind: "combo" })
    expect(badgeItemLabelKind("quality:format:dv")).toEqual({ kind: "format", format: "dv" })
  })
})

describe("wire form", () => {
  it("round-trips through serialize/parse with a canonical sorted order", () => {
    const map: BadgeItemTransformMap = {
      "rating:imdb": { scale: 120, offsetX: -8, offsetY: 14 },
      [BADGE_ITEM_QUALITY_TIER]: { scale: 90, offsetX: 3, offsetY: 0 },
    }
    const wire = serializeBadgeItemTransforms(map)
    expect(wire).toBe("quality:tier=90,3,0;rating:imdb=120,-8,14")
    expect(parseBadgeItemTransforms(wire)).toEqual(map)
    // Idempotent: parsing and serializing again changes nothing.
    expect(serializeBadgeItemTransforms(parseBadgeItemTransforms(wire))).toBe(wire)
    expect(canonicalizeBadgeItemTransforms(wire)).toBe(wire)
  })

  it("returns null for the automatic layout (indistinguishable from absent)", () => {
    expect(serializeBadgeItemTransforms({})).toBeNull()
    expect(serializeBadgeItemTransforms(null)).toBeNull()
    expect(serializeBadgeItemTransforms({ "rating:imdb": BADGE_ITEM_NEUTRAL })).toBeNull()
    expect(canonicalizeBadgeItemTransforms("")).toBeNull()
    expect(canonicalizeBadgeItemTransforms(null)).toBeNull()
    expect(hasBadgeItemTransforms({ "rating:imdb": BADGE_ITEM_NEUTRAL })).toBe(false)
  })

  it("drops unknown identities, malformed triples and garbage (fail-closed)", () => {
    expect(parseBadgeItemTransforms("bogus:x=100,0,0")).toEqual({})
    expect(parseBadgeItemTransforms("rating:imdb")).toEqual({})
    expect(parseBadgeItemTransforms("rating:imdb=100,0")).toEqual({})
    expect(parseBadgeItemTransforms("rating:imdb=a,b,c")).toEqual({})
    expect(parseBadgeItemTransforms("=100,0,0")).toEqual({})
    expect(parseBadgeItemTransforms("rating:imdb=100,0,0")).toEqual({})
    expect(
      parseBadgeItemTransforms("rating:imdb=100,0,0;rating:tmdb=110,2,0"),
    ).toEqual({ "rating:tmdb": { scale: 110, offsetX: 2, offsetY: 0 } })
  })

  it("clamps to the shared server bounds and keeps the last duplicate", () => {
    expect(clampBadgeItemScale(1)).toBe(BADGE_ITEM_SCALE_MIN)
    expect(clampBadgeItemScale(9999)).toBe(BADGE_ITEM_SCALE_MAX)
    expect(clampBadgeItemScale(Number.NaN)).toBe(100)
    expect(clampBadgeItemOffset(99999)).toBe(BADGE_OFFSET_NUMERIC_LIMIT)
    expect(clampBadgeItemOffset(-99999)).toBe(-BADGE_OFFSET_NUMERIC_LIMIT)
    expect(parseBadgeItemTransforms("rating:imdb=500,-99999,0;rating:imdb=120,4,0")).toEqual({
      "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 },
    })
    expect(parseBadgeItemTransforms("rating:imdb=5,0,0")).toEqual({
      "rating:imdb": { scale: BADGE_ITEM_SCALE_MIN, offsetX: 0, offsetY: 0 },
    })
    // A duplicate that sanitizes back to neutral removes the earlier entry.
    expect(parseBadgeItemTransforms("rating:imdb=120,4,0;rating:imdb=100,0,0")).toEqual({})
  })

  it("canonicalizes a dirty payload to one representation", () => {
    expect(
      canonicalizeBadgeItemTransforms(" rating:tmdb=110,2,0 ; rating:imdb=120,4,0 ; junk "),
    ).toBe("rating:imdb=120,4,0;rating:tmdb=110,2,0")
    expect(canonicalizeBadgeItemTransforms("x")).toBeNull()
  })
})

describe("immutable writes and reset semantics", () => {
  it("writes one item without touching the others", () => {
    const start: BadgeItemTransformMap = { "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 } }
    const next = withBadgeItemTransform(start, "rating:tmdb", { scale: 90, offsetX: 0, offsetY: 6 })
    expect(next).toEqual({
      "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 },
      "rating:tmdb": { scale: 90, offsetX: 0, offsetY: 6 },
    })
    expect(start).toEqual({ "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 } })
    expect(badgeItemTransform(next, "rating:imdb")).toEqual({ scale: 120, offsetX: 4, offsetY: 0 })
    expect(badgeItemTransform(next, "rating:missing")).toBeNull()
  })

  it("a neutral write removes the entry (automatic layout again)", () => {
    const start: BadgeItemTransformMap = { "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 } }
    expect(withBadgeItemTransform(start, "rating:imdb", BADGE_ITEM_NEUTRAL)).toEqual({})
    expect(isNeutralBadgeItemTransform(null)).toBe(true)
  })

  it("resets ONE item, leaving groups and other items untouched", () => {
    const start: BadgeItemTransformMap = {
      "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 },
      "rating:tmdb": { scale: 80, offsetX: 0, offsetY: 6 },
    }
    expect(withoutBadgeItemTransform(start, "rating:imdb")).toEqual({
      "rating:tmdb": { scale: 80, offsetX: 0, offsetY: 6 },
    })
    expect(withoutBadgeItemTransform(start, "rating:absent")).toEqual(start)
  })

  it("ignores writes under an invalid identity", () => {
    expect(withBadgeItemTransform({}, "imdb", { scale: 120, offsetX: 0, offsetY: 0 })).toEqual({})
  })
})

describe("identity independence (missing / reordered ratings)", () => {
  it("a reordered list keeps every provider's own tuning", () => {
    const stored = parseBadgeItemTransforms("rating:imdb=120,10,0;rating:tmdb=80,-5,0")
    // Render order changes: identifiers stay attached to their provider.
    const rendered = ["tmdb", "imdb"].map((id) => ratingItemId(id)!)
    expect(rendered.map((id) => badgeItemTransform(stored, id))).toEqual([
      { scale: 80, offsetX: -5, offsetY: 0 },
      { scale: 120, offsetX: 10, offsetY: 0 },
    ])
  })

  it("a disappeared provider leaves its entry inert instead of transferring it", () => {
    const stored = parseBadgeItemTransforms("rating:imdb=120,10,0;rating:tomatoes=70,0,20")
    // IMDb has no data this render: only TMDB is painted, and it must not
    // inherit the IMDb correction sitting at the same array position.
    expect(badgeItemTransform(stored, "rating:tmdb")).toBeNull()
    expect(badgeItemTransform(stored, "rating:imdb")).toEqual({ scale: 120, offsetX: 10, offsetY: 0 })
  })

  it("a suppressed/merged AV mark never passes its tuning to the combo", () => {
    const stored = parseBadgeItemTransforms(
      `${qualityFormatItemId("dv")}=130,0,6;${qualityFormatItemId("atmos")}=90,0,-4`,
    )
    // DV+Atmos merged into the combo: the singles are not painted, the combo
    // has its own identity and stays automatic (no transferred tuning).
    expect(badgeItemTransform(stored, BADGE_ITEM_QUALITY_COMBO)).toBeNull()
    expect(badgeItemTransform(stored, qualityFormatItemId("dv")!)).toEqual({ scale: 130, offsetX: 0, offsetY: 6 })
  })
})

describe("composition math", () => {
  const box = { top: 100, left: 200, w: 80, h: 40 }

  it("neutral is an exact no-op (unconfigured output preserved)", () => {
    expect(applyBadgeItemTransform(box, null)).toEqual(box)
    expect(applyBadgeItemTransform(box, BADGE_ITEM_NEUTRAL)).toEqual(box)
    expect(applyBadgeItemTransform(box, { scale: 100, offsetX: 0, offsetY: 0 })).toEqual(box)
  })

  it("scales about the item centre, then applies the offset", () => {
    // 50%: 80x40 -> 40x20 around the same centre (240,120) -> left 220 top 110.
    expect(applyBadgeItemTransform(box, { scale: 50, offsetX: 7, offsetY: -3 })).toEqual({
      left: 227,
      top: 107,
      w: 40,
      h: 20,
    })
    // 200%: 160x80 about the same centre -> left 160 top 80.
    expect(applyBadgeItemTransform(box, { scale: 200, offsetX: 0, offsetY: 0 })).toEqual({
      left: 160,
      top: 80,
      w: 160,
      h: 80,
    })
  })

  it("integer output: what is drawn is what is stored", () => {
    const out = applyBadgeItemTransform({ top: 0, left: 0, w: 7, h: 3 }, { scale: 133, offsetX: 1, offsetY: 1 })
    expect(Number.isInteger(out.top)).toBe(true)
    expect(Number.isInteger(out.left)).toBe(true)
    expect(Number.isInteger(out.w)).toBe(true)
    expect(Number.isInteger(out.h)).toBe(true)
    expect(out.w).toBeGreaterThanOrEqual(1)
    expect(out.h).toBeGreaterThanOrEqual(1)
  })

  it("a drag adds the canvas delta to the stored offset (group rule)", () => {
    expect(moveBadgeItemTransform(null, { x: 3, y: -2 })).toEqual({ scale: 100, offsetX: 3, offsetY: -2 })
    expect(moveBadgeItemTransform({ scale: 120, offsetX: 5, offsetY: 5 }, { x: -5, y: 1 })).toEqual({
      scale: 120,
      offsetX: 0,
      offsetY: 6,
    })
    expect(moveBadgeItemTransform(null, { x: 99999, y: 0 }).offsetX).toBe(BADGE_OFFSET_NUMERIC_LIMIT)
  })

  it("a resize writes the scale only (offsets preserved)", () => {
    expect(resizeBadgeItemTransform({ scale: 100, offsetX: 4, offsetY: 8 }, 137)).toEqual({
      scale: 137,
      offsetX: 4,
      offsetY: 8,
    })
    expect(resizeBadgeItemTransform(null, 1000).scale).toBe(BADGE_ITEM_SCALE_MAX)
  })

  it("effective maps drop neutral entries and unknown identities", () => {
    expect(
      effectiveBadgeItemTransforms({
        "rating:imdb": BADGE_ITEM_NEUTRAL,
        "rating:tmdb": { scale: 120, offsetX: 0, offsetY: 0 },
        "bogus:x": { scale: 120, offsetX: 0, offsetY: 0 },
      }),
    ).toEqual({ "rating:tmdb": { scale: 120, offsetX: 0, offsetY: 0 } })
  })
})

describe("withoutBadgeItemFamily (group reset hierarchy)", () => {
  const map = {
    "rating:imdb": { scale: 100, offsetX: 6, offsetY: 0 },
    "rating:tmdb": { scale: 90, offsetX: 0, offsetY: -4 },
    [BADGE_ITEM_QUALITY_TIER]: { scale: 100, offsetX: 4, offsetY: 0 },
    [BADGE_ITEM_QUALITY_COMBO]: { scale: 120, offsetX: 0, offsetY: 0 },
  }

  it("drops only the corrections owned by the reset family", () => {
    // An item correction is a delta on top of its family layout: a family reset
    // that kept them would leave the items outside the restored layout.
    expect(withoutBadgeItemFamily(map, "separate")).toEqual({
      [BADGE_ITEM_QUALITY_TIER]: { scale: 100, offsetX: 4, offsetY: 0 },
      [BADGE_ITEM_QUALITY_COMBO]: { scale: 120, offsetX: 0, offsetY: 0 },
    })
    expect(withoutBadgeItemFamily(map, "quality")).toEqual({
      "rating:imdb": { scale: 100, offsetX: 6, offsetY: 0 },
      "rating:tmdb": { scale: 90, offsetX: 0, offsetY: -4 },
    })
  })

  it("is a no-op for a family that owns no items", () => {
    expect(withoutBadgeItemFamily(map, null)).toEqual(map)
    expect(withoutBadgeItemFamily({}, "quality")).toEqual({})
  })
})

/**
 * HOME corrections (`quality:home:<kind>`): NAMED, content-bound places of the
 * quality stack. A home is not a badge identity: whatever badge of its content
 * group PAINTS on a title goes to that home, so one stored correction yields the
 * SAME box on every title and every format set. The home composes with the
 * per-item identity correction of the same element (identity on top), and with
 * no home stored the output stays byte-identical to the historic layout.
 */
describe("quality stack homes", () => {
  /** Exactly the quality-family segment the render cache key serializes. */
  function qualityKeySegment(map: BadgeItemTransformMap | null | undefined): string {
    return (
      serializeBadgeItemTransforms(
        Object.fromEntries(Object.entries(effectiveBadgeItemTransforms(map)).filter(([id]) => isQualityItemId(id))),
      ) ?? "items0"
    )
  }

  it("is the closed set of five content groups", () => {
    expect(BADGE_ITEM_QUALITY_HOMES).toEqual([
      "quality:home:tier",
      "quality:home:age",
      "quality:home:dolby",
      "quality:home:hdr",
      "quality:home:imax",
    ])
    expect(qualityHomeItemId("tier")).toBe(BADGE_ITEM_QUALITY_HOME_TIER)
    expect(qualityHomeItemId("age")).toBe(BADGE_ITEM_QUALITY_HOME_AGE)
    expect(qualityHomeItemId("dolby")).toBe(BADGE_ITEM_QUALITY_HOME_DOLBY)
    expect(qualityHomeItemId("hdr")).toBe(BADGE_ITEM_QUALITY_HOME_HDR)
    expect(qualityHomeItemId("imax")).toBe(BADGE_ITEM_QUALITY_HOME_IMAX)
    for (const id of BADGE_ITEM_QUALITY_HOMES) {
      expect(isQualityHomeItemId(id)).toBe(true)
      const kind = qualityHomeKind(id)
      expect(kind).not.toBeNull()
      expect(qualityHomeItemId(kind!)).toBe(id)
    }
    // Not a home: an unknown group, a plain mark, a rating.
    expect(isQualityHomeItemId("quality:home:atmos")).toBe(false)
    expect(qualityHomeKind("quality:tier")).toBeNull()
    expect(qualityHomeKind("rating:imdb")).toBeNull()
    expect(isQualityHomeItemId("quality:format:hdr")).toBe(false)
  })

  it("binds every painted badge of a group to its own home", () => {
    // Tier and age are one badge each.
    expect(homeIdForPainted(BADGE_ITEM_QUALITY_TIER)).toBe(BADGE_ITEM_QUALITY_HOME_TIER)
    expect(homeIdForPainted(BADGE_ITEM_QUALITY_AGE)).toBe(BADGE_ITEM_QUALITY_HOME_AGE)
    // Dolby: the merged combo AND both singles belong to the same home (the
    // existing merge logic decides what paints, never the binding).
    expect(homeIdForPainted(BADGE_ITEM_QUALITY_COMBO)).toBe(BADGE_ITEM_QUALITY_HOME_DOLBY)
    expect(homeIdForPainted(qualityFormatItemId("dv")!)).toBe(BADGE_ITEM_QUALITY_HOME_DOLBY)
    expect(homeIdForPainted(qualityFormatItemId("atmos")!)).toBe(BADGE_ITEM_QUALITY_HOME_DOLBY)
    // HDR: HDR10+ wins the render, but both live in the same home.
    expect(homeIdForPainted(qualityFormatItemId("hdr")!)).toBe(BADGE_ITEM_QUALITY_HOME_HDR)
    expect(homeIdForPainted(qualityFormatItemId("hdr10plus")!)).toBe(BADGE_ITEM_QUALITY_HOME_HDR)
    expect(homeIdForPainted(qualityFormatItemId("imax")!)).toBe(BADGE_ITEM_QUALITY_HOME_IMAX)
    // A home target IS its own home (ghost handles drag the home).
    for (const id of BADGE_ITEM_QUALITY_HOMES) expect(homeIdForPainted(id)).toBe(id)
    // Nothing else has a home: separate ratings and unknown formats.
    expect(homeIdForPainted("rating:imdb")).toBeNull()
    expect(homeIdForPainted("quality:format:hlg")).toBeNull()
    expect(homeIdForPainted("quality:combo:other")).toBeNull()
  })

  it("belongs to the quality family (family filter, reset and cache key)", () => {
    const map = {
      [BADGE_ITEM_QUALITY_HOME_DOLBY]: { scale: 120, offsetX: 0, offsetY: 8 },
      "rating:imdb": { scale: 90, offsetX: 0, offsetY: 0 },
    }
    // `isQualityItemId` covers `quality:home:*` through the shared prefix, so
    // the group cache key and every family filter see a home.
    for (const id of BADGE_ITEM_QUALITY_HOMES) expect(isQualityItemId(id)).toBe(true)
    expect(isRatingItemId(BADGE_ITEM_QUALITY_HOME_TIER)).toBe(false)
    // A quality group reset clears the homes too (they are the family layout).
    expect(withoutBadgeItemFamily(map, "quality")).toEqual({ "rating:imdb": { scale: 90, offsetX: 0, offsetY: 0 } })
    // A separate-rating reset NEVER touches a home (other family's layout).
    expect(withoutBadgeItemFamily(map, "separate")).toEqual({
      [BADGE_ITEM_QUALITY_HOME_DOLBY]: { scale: 120, offsetX: 0, offsetY: 8 },
    })
    // Wire form: a home id passes the shared id validator and round-trips.
    expect(isBadgeItemId(BADGE_ITEM_QUALITY_HOME_IMAX)).toBe(true)
    expect(parseBadgeItemTransforms("quality:home:imax=120,0,8")).toEqual({
      "quality:home:imax": { scale: 120, offsetX: 0, offsetY: 8 },
    })
    expect(serializeBadgeItemTransforms({ "quality:home:imax": { scale: 120, offsetX: 0, offsetY: 8 } }))
      .toBe("quality:home:imax=120,0,8")
    expect(BADGE_ITEM_NEUTRAL).toEqual({ scale: 100, offsetX: 0, offsetY: 0 })
    expect(canonicalizeBadgeItemTransforms("quality:home:hdr=100,0,0")).toBeNull()
  })

  it("enters the quality cache key: same badges + different homes = different key", () => {
    // Same painted stack (labels/formats identical): only the IMAX home differs.
    const a = qualityKeySegment({ "quality:home:imax": { scale: 100, offsetX: 0, offsetY: 0 } })
    const b = qualityKeySegment({ "quality:home:imax": { scale: 100, offsetX: 0, offsetY: 6 } })
    const c = qualityKeySegment({ "quality:home:imax": { scale: 100, offsetX: 0, offsetY: 12 } })
    // Neutral home = automatic layout (the historic sentinel, no key churn).
    expect(a).toBe("items0")
    expect(b).toBe("quality:home:imax=100,0,6")
    expect(new Set([a, b, c]).size).toBe(3)
    // Two DIFFERENT homes never collapse onto the same key segment.
    const tier = qualityKeySegment({ "quality:home:tier": { scale: 100, offsetX: 0, offsetY: 6 } })
    const hdr = qualityKeySegment({ "quality:home:hdr": { scale: 100, offsetX: 0, offsetY: 6 } })
    expect(new Set([b, tier, hdr]).size).toBe(3)
    // Identity corrections keep their own semantics and never collide with a home.
    const identity = qualityKeySegment({ [BADGE_ITEM_QUALITY_TIER]: { scale: 100, offsetX: 0, offsetY: 6 } })
    expect(identity).not.toBe(tier)
    // A separate-family id (rating) never enters the quality segment.
    expect(qualityKeySegment({ "rating:imdb": { scale: 100, offsetX: 0, offsetY: 6 } })).toBe("items0")
  })

  it("labels a home with the existing sources behind a code literal (no new i18n key)", () => {
    expect(badgeItemLabelKind(BADGE_ITEM_QUALITY_HOME_TIER)).toEqual({ kind: "home", home: "tier" })
    expect(badgeItemLabelKind(BADGE_ITEM_QUALITY_HOME_IMAX)).toEqual({ kind: "home", home: "imax" })
    expect(badgeItemLabelKind("quality:home:atmos")).toBeNull()
    expect(badgeItemLabelKind(BADGE_ITEM_QUALITY_TIER)).toEqual({ kind: "tier" })
    // The base label reuses the existing translation keys / A/V full names.
    const translate = (key: string) => `T:${key}`
    expect(qualityHomeBaseLabel("tier", translate)).toBe("T:ui.badgeQuality")
    expect(qualityHomeBaseLabel("age", translate)).toBe("T:ui.ageBadge")
    expect(qualityHomeBaseLabel("dolby", translate)).toBe("Dolby Vision + Atmos")
    expect(qualityHomeBaseLabel("hdr", translate)).toBe("HDR")
    expect(qualityHomeBaseLabel("imax", translate)).toBe("IMAX Enhanced")
  })

  it("applies the home BEFORE the identity correction of the same element", () => {
    const isolated = { top: 0, left: 0, w: 40, h: 20 }
    const home = { scale: 150, offsetX: 2, offsetY: 6 }
    const identity = { scale: 120, offsetX: 3, offsetY: -2 }
    const homeOnly = applyBadgeItemTransform(isolated, home)
    const both = applyBadgeItemTransform(homeOnly, identity)
    // The identity correction is a delta on top of the HOME-transformed box
    // (same helper, so its scale resizes the home box, never the automatic one).
    expect(both.w).toBe(Math.round((homeOnly.w * 120) / 100))
    expect(both.h).toBe(Math.round((homeOnly.h * 120) / 100))
    expect(both.top).toBe(Math.round(homeOnly.top + (homeOnly.h - both.h) / 2) - 2)
    expect(both.left).toBe(Math.round(homeOnly.left + (homeOnly.w - both.w) / 2) + 3)
    // Neither correction alone can reproduce the composition.
    expect(both).not.toEqual(homeOnly)
    expect(both).not.toEqual(applyBadgeItemTransform(isolated, identity))
    // Neutral home = the automatic box, byte-for-byte.
    expect(applyBadgeItemTransform(isolated, null)).toEqual(isolated)
  })
})
