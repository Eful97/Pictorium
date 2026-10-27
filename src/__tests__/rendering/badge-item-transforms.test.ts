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
