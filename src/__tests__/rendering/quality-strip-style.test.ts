import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  QUALITY_GROUP_LAYOUTS,
  DEFAULT_QUALITY_GROUP_LAYOUT,
  isQualityGroupLayout,
  isMergedQualityStrip,
} from "@/lib/badge-styles"
import {
  BADGE_BOX_PAD_X_FACTOR,
  QUALITY_STRIP_MAX_SEGMENTS_PER_ROW,
  QUALITY_STRIP_PAD_X_FACTOR,
  QUALITY_STRIP_ROW_GAP_FACTOR,
  QUALITY_STRIP_SEPARATOR,
  QUALITY_STRIP_SEPARATOR_OPACITY,
  badgeBoxHeight,
  buildStripBadgeSvg,
  TOP_SHADOW_PAD,
} from "@/lib/badge-svg-shared"
import {
  BADGE_ITEM_QUALITY_AGE,
  BADGE_ITEM_QUALITY_COMBO,
  BADGE_ITEM_QUALITY_TIER,
  qualityFormatItemId,
} from "@/lib/badge-item-transforms"
import {
  generatePosterBuffer,
  renderQualityBadgeGroup,
  type BadgeGeometryReport,
  type GenerationInput,
} from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"

const PW = 380

/** Production visible-width cap of the quality group. */
const stripCap = (pw: number) => Math.min(pw - 20, Math.round(pw * 0.84))

/** Row gap at a given glyph size (same formula as the builder). */
const rowGapFor = (fs: number) => Math.max(2, Math.round(fs * QUALITY_STRIP_ROW_GAP_FACTOR))

describe("quality strip style — merged single-plate lockup", () => {
  it("resolves a fail-closed stacked/row layout, independent from the style", () => {
    expect([...QUALITY_GROUP_LAYOUTS]).toEqual(["stacked", "row"])
    expect(DEFAULT_QUALITY_GROUP_LAYOUT).toBe("stacked")
    expect(isQualityGroupLayout("row")).toBe(true)
    expect(isQualityGroupLayout("stacked")).toBe(true)
    expect(isQualityGroupLayout("strip")).toBe(false)
    expect(isQualityGroupLayout(null)).toBe(false)
    // Merged plate: ONLY strip + row. Every other combination is a per-mark
    // stack (strip stacked included), so per-item handles keep working.
    expect(isMergedQualityStrip("strip", "row")).toBe(true)
    expect(isMergedQualityStrip("strip", null)).toBe(false)
    expect(isMergedQualityStrip("strip", undefined)).toBe(false)
    expect(isMergedQualityStrip("strip", "nope")).toBe(false)
    for (const style of ["standard", "mono", "color", "knockout", "premium", "nova", "gradient", "outline"] as const) {
      expect(isMergedQualityStrip(style, "row"), style).toBe(false)
    }
  })

  it("builds ONE plate with one glyph run per segment, 0.45-opacity dots and airier lateral padding", () => {
    // One row: up to `QUALITY_STRIP_MAX_SEGMENTS_PER_ROW` segments share it.
    const labels = ["4K", "VM14"]
    const built = buildStripBadgeSvg(labels, 22)
    // One text run per label + one separator run between every pair.
    expect((built.svg.match(/<text /g) ?? []).length).toBe(labels.length * 2 - 1)
    expect((built.svg.match(new RegExp(`opacity="${QUALITY_STRIP_SEPARATOR_OPACITY}"`, "g")) ?? []).length).toBe(labels.length - 1)
    expect((built.svg.match(new RegExp(`>${QUALITY_STRIP_SEPARATOR}</text>`, "g")) ?? []).length).toBe(labels.length - 1)
    // ONE plate and ONE 3D shadow usage for the whole lockup.
    expect((built.svg.match(/<rect /g) ?? []).length).toBe(1)
    expect((built.svg.match(/filter="url\(#tds\)"/g) ?? []).length).toBe(1)
    // Same shared band height + symmetric shadow padding as the other styles.
    expect(built.h).toBe(badgeBoxHeight(22) + TOP_SHADOW_PAD * 2)
    // Segment boxes: one per label, ordered and inside the plate.
    expect(built.segments).toHaveLength(labels.length)
    for (let i = 1; i < built.segments.length; i++) {
      expect(built.segments[i].left).toBeGreaterThan(built.segments[i - 1].left)
      expect(built.segments[i].left).toBeGreaterThanOrEqual(
        built.segments[i - 1].left + built.segments[i - 1].w,
      )
    }
    // Strip-only airier padding: the border never hugs the first/last glyph.
    expect(QUALITY_STRIP_PAD_X_FACTOR).toBeGreaterThan(BADGE_BOX_PAD_X_FACTOR)
    const padX = Math.round(22 * QUALITY_STRIP_PAD_X_FACTOR)
    expect(built.segments[0].left).toBeGreaterThanOrEqual(TOP_SHADOW_PAD + padX)
    expect(built.segments[built.segments.length - 1].left + built.segments[built.segments.length - 1].w)
      .toBeLessThanOrEqual(built.w - TOP_SHADOW_PAD - padX)
  })

  it("wraps three segments as 2+1 with the single segment centered under the plate", () => {
    const labels = ["4K", "VM14", "IMAX"]
    expect(labels.length).toBeGreaterThan(QUALITY_STRIP_MAX_SEGMENTS_PER_ROW)
    const built = buildStripBadgeSvg(labels, 22)
    const boxH = badgeBoxHeight(22)
    const gap = rowGapFor(22)
    // Still ONE plate + ONE shadow: the wrap never spawns a second bitmap.
    expect((built.svg.match(/<rect /g) ?? []).length).toBe(1)
    expect((built.svg.match(/filter="url\(#tds\)"/g) ?? []).length).toBe(1)
    // Two bands plus the row gap, no other geometry change.
    expect(built.h).toBe(2 * boxH + gap + TOP_SHADOW_PAD * 2)
    expect(built.segments).toHaveLength(labels.length)
    // Row-major: the first two identities on line 1, the third alone on line 2.
    for (const segment of built.segments.slice(0, 2)) expect(segment.top).toBe(TOP_SHADOW_PAD)
    expect(built.segments[2].top).toBe(TOP_SHADOW_PAD + boxH + gap)
    for (const segment of built.segments) expect(segment.h).toBe(boxH)
    // Line 1 still reads left to right.
    expect(built.segments[1].left).toBeGreaterThanOrEqual(built.segments[0].left + built.segments[0].w)
    // Separators only inside each line (never across the wrap).
    expect((built.svg.match(new RegExp(`>${QUALITY_STRIP_SEPARATOR}</text>`, "g")) ?? []).length).toBe(1)
    // The single second-row run is CENTERED inside the same plate.
    const solo = built.segments[2]
    const soloLeftGap = solo.left - TOP_SHADOW_PAD
    const soloRightGap = built.w - TOP_SHADOW_PAD - (solo.left + solo.w)
    expect(Math.abs(soloLeftGap - soloRightGap)).toBeLessThanOrEqual(1)
  })

  it("fills rows two by two (4 → 2+2, 5 → 2+2+1) inside the same plate", () => {
    const boxH = badgeBoxHeight(22)
    const gap = rowGapFor(22)
    const centeredGaps = (built: ReturnType<typeof buildStripBadgeSvg>, row: typeof built.segments) => {
      const leftGap = row[0].left - TOP_SHADOW_PAD
      const rightGap = built.w - TOP_SHADOW_PAD - (row[row.length - 1].left + row[row.length - 1].w)
      return Math.abs(leftGap - rightGap)
    }
    const four = buildStripBadgeSvg(["4K", "VM14", "DV+ATMOS", "IMAX"], 22)
    expect((four.svg.match(/<rect /g) ?? []).length).toBe(1)
    expect((four.svg.match(/filter="url\(#tds\)"/g) ?? []).length).toBe(1)
    expect(four.segments).toHaveLength(4)
    expect(four.h).toBe(2 * boxH + gap + TOP_SHADOW_PAD * 2)
    for (const segment of four.segments.slice(0, 2)) expect(segment.top).toBe(TOP_SHADOW_PAD)
    for (const segment of four.segments.slice(2)) expect(segment.top).toBe(TOP_SHADOW_PAD + boxH + gap)
    // One separator per row (both rows hold two segments).
    expect((four.svg.match(new RegExp(`>${QUALITY_STRIP_SEPARATOR}</text>`, "g")) ?? []).length).toBe(2)
    // Both lines are centered inside the plate.
    expect(centeredGaps(four, four.segments.slice(0, 2))).toBeLessThanOrEqual(1)
    expect(centeredGaps(four, four.segments.slice(2))).toBeLessThanOrEqual(1)

    const five = buildStripBadgeSvg(["4K", "VM14", "DV+ATMOS", "IMAX", "HDR"], 22)
    expect(five.segments).toHaveLength(5)
    expect(five.h).toBe(3 * boxH + 2 * gap + TOP_SHADOW_PAD * 2)
    for (const segment of five.segments.slice(0, 2)) expect(segment.top).toBe(TOP_SHADOW_PAD)
    for (const segment of five.segments.slice(2, 4)) expect(segment.top).toBe(TOP_SHADOW_PAD + boxH + gap)
    expect(five.segments[4].top).toBe(TOP_SHADOW_PAD + 2 * (boxH + gap))
    // Separators only within a row: 1 + 1 + 0 on the odd last row.
    expect((five.svg.match(new RegExp(`>${QUALITY_STRIP_SEPARATOR}</text>`, "g")) ?? []).length).toBe(2)
    expect(centeredGaps(five, [five.segments[4]])).toBeLessThanOrEqual(1)
  })

  it("shrinks the glyph size instead of overflowing the visible width cap", () => {
    // Single line (2 segments): the shared one-row fit fast path.
    const labels = ["4K", "VM14"]
    const maxW = 90
    const natural = buildStripBadgeSvg(labels, 22)
    const fitted = buildStripBadgeSvg(labels, 22, "inter", maxW)
    expect(fitted.w - TOP_SHADOW_PAD * 2).toBeLessThanOrEqual(maxW)
    expect(fitted.w).toBeLessThan(natural.w)
    // Never stretches the plate: the visible box stays exactly one shared band
    // (shrink only, no extra row, no clipping).
    expect(fitted.segments[0].top).toBe(TOP_SHADOW_PAD)
    expect(fitted.segments[0].h).toBe(fitted.h - TOP_SHADOW_PAD * 2)
    expect(fitted.h).toBeLessThanOrEqual(natural.h)
  })

  it("keeps the wrapped plate inside the production width cap too", () => {
    const labels = ["4K", "VM14", "DV+ATMOS", "IMAX", "HDR"]
    const cap = stripCap(PW)
    const built = buildStripBadgeSvg(labels, 22, "inter", cap)
    expect(built.w - TOP_SHADOW_PAD * 2).toBeLessThanOrEqual(cap)
  })

  it("renders the merged plate only in the row layout, with the stable per-item identities", async () => {
    const group = await renderQualityBadgeGroup(
      "4K",
      "strip",
      ["dv", "atmos", "imax"],
      PW,
      false,
      "inter",
      "VM14",
      "standard",
      null,
      "row",
    )
    expect(group).not.toBeNull()
    expect(group!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
    ])
    // Merged plate: four identities fill two lines two by two (no vertical
    // stack, no per-item bitmaps, no empty-home ghosts).
    const boxH = badgeBoxHeight(17)
    const gap = rowGapFor(17)
    expect(group!.h).toBe(2 * boxH + gap + TOP_SHADOW_PAD * 2)
    expect(group!.items.every((item) => item.png === undefined)).toBe(true)
    expect(group!.homeGhosts).toEqual([])
    // Same band height for every reported segment; 2+2 row-major tops.
    for (const item of group!.items) expect(item.h).toBe(boxH)
    for (const item of group!.items.slice(0, 2)) expect(item.top).toBe(TOP_SHADOW_PAD)
    for (const item of group!.items.slice(2)) expect(item.top).toBe(TOP_SHADOW_PAD + boxH + gap)
  })

  it("strip + stacked renders one dark plate per mark (per-item stack, homes reported)", async () => {
    const stacked = await renderQualityBadgeGroup(
      "4K",
      "strip",
      ["dv", "atmos", "imax"],
      PW,
      false,
      "inter",
      "VM14",
    )
    const merged = await renderQualityBadgeGroup(
      "4K",
      "strip",
      ["dv", "atmos", "imax"],
      PW,
      false,
      "inter",
      "VM14",
      "standard",
      null,
      "row",
    )
    expect(stacked).not.toBeNull()
    expect(merged).not.toBeNull()
    // Same painted identities and order in both layouts.
    expect(stacked!.items.map((item) => item.id)).toEqual(merged!.items.map((item) => item.id))
    // Column: one box per mark, stacked top-to-bottom, no merged plate.
    const tops = stacked!.items.map((item) => item.top)
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    expect(stacked!.items.every((item) => item.png === undefined)).toBe(true)
    // Every empty home is reported (per-item handles + home ghosts active).
    expect(stacked!.homeGhosts.length).toBeGreaterThan(0)
    expect(stacked!.png.equals(merged!.png)).toBe(false)
    expect(stacked!.h).toBeGreaterThan(merged!.h)
  })

  it("keeps per-item transforms inert on the merged bitmap (same reported boxes, no detach)", async () => {
    const base = await renderQualityBadgeGroup("4K", "strip", ["imax"], PW, false, "inter", "VM14", "standard", null, "row")
    const tuned = await renderQualityBadgeGroup(
      "4K",
      "strip",
      ["imax"],
      PW,
      false,
      "inter",
      "VM14",
      "standard",
      { [BADGE_ITEM_QUALITY_AGE]: { scale: 150, offsetX: 12, offsetY: -8 } },
      "row",
    )
    expect(base).not.toBeNull()
    expect(tuned).not.toBeNull()
    expect(tuned!.items.map((item) => `${item.id}:${item.left}:${item.top}:${item.w}:${item.h}`))
      .toEqual(base!.items.map((item) => `${item.id}:${item.left}:${item.top}:${item.w}:${item.h}`))
    expect(tuned!.items.some((item) => item.png !== undefined)).toBe(false)
    expect(tuned!.png.equals(base!.png)).toBe(true)
  })

  it("is additive: the default/standard style keeps the historic vertical stack", async () => {
    const standard = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14")
    const explicitStacked = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14", "standard", null, "stacked")
    expect(standard).not.toBeNull()
    // Absent layout = stacked, byte-identical to the explicit value.
    expect(explicitStacked!.png.equals(standard!.png)).toBe(true)
    // The stacked path keeps one bitmap per element and a taller column.
    expect(standard!.items.every((item) => item.png === undefined)).toBe(true)
    const tops = standard!.items.map((item) => item.top)
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    // Row layout of the same marks is wider and shorter (horizontal).
    const row = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14", "standard", null, "row")
    expect(row!.h).toBeLessThan(standard!.h)
    expect(row!.w).toBeGreaterThan(standard!.w)
    expect(row!.items[0].top).toBe(row!.items[1].top)
  })
})

// ---------------------------------------------------------------------------
// Per-item handles are DISABLED in the strip layout: the geometry report of the
// real render publishes only the group box (one merged plate cannot detach a
// single slice), while the group contract still lists the painted identities.
// ---------------------------------------------------------------------------

function stripGeometryInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "strip",
    // Merged plate requires the row layout (stacked = one plate per mark).
    qualityGroupLayout: "row",
    videoFormats: ["dv", "atmos", "imax"],
    ageLabel: "VM14",
    ageBadgeStyle: "standard",
    separateRatings: [],
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

describe("quality strip style — per-item handles", () => {
  it("disables per-item handles on the merged row plate only", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    const render = async (badgeHomeGhosts?: boolean, layout?: "stacked" | "row") => {
      let geometry: BadgeGeometryReport | null = null
      await generatePosterBuffer(
        stripGeometryInput({
          posterBuf: poster,
          badgeHomeGhosts,
          ...(layout ? { qualityGroupLayout: layout } : {}),
          onBadgeGeometry: (geo) => { geometry = geo },
        }),
      )
      return geometry as unknown as BadgeGeometryReport
    }
    const plain = await render()
    // The group is still composed and reported (the drag overlay keeps ONE
    // group handle), but no `quality:*` per-item handle is published.
    expect(plain.families.quality).toBeDefined()
    expect(plain.items.filter((item) => item.family === "quality")).toEqual([])
    // `?ghosts=1` adds nothing for the merged plate: it has no empty homes.
    const withGhosts = await render(true)
    expect(withGhosts.items.filter((item) => item.family === "quality")).toEqual([])
    // `stacked` renders one plate per mark: per-item handles AND home ghosts
    // are published (the same contract as every other style).
    const stacked = await render(true, "stacked")
    const stackedItems = stacked.items.filter((item) => item.family === "quality")
    expect(stackedItems.length).toBeGreaterThan(0)
    expect(stackedItems.some((item) => item.ghost)).toBe(true)
    // The renderer contract keeps listing the painted identities.
    const merged = await renderQualityBadgeGroup("4K", "strip", ["dv", "atmos", "imax"], PW, false, "inter", "VM14", "standard", null, "row")
    expect(merged!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
    ])
  }, 120000)
})
