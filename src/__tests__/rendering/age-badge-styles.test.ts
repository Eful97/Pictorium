/**
 * Age certification badge styles — the SAME style vocabulary as the quality
 * badge (`standard`/`mono`/`color`/`knockout`/`premium`) applied to the
 * DYNAMIC age label (12/PG-13/TV-MA, always a parameter: no bundled numeric
 * asset, no invented official age color).
 *
 * Contracts pinned here:
 * - the enum is the single source (`agebs` transport/schema/cache derive);
 * - `standard` is the neutral satin pill (full rx = boxH/2) and `knockout`
 *   the masked white tag; both keep their historic standalone geometry
 *   (structural + pixel checks, no pinned bitmap hashes);
 * - `mono` = high-contrast monochrome frame+glyph, no satin fill/plate;
 * - `color` = yellow glyph on the dark tier plate with the yellow tier border
 *   (existing `COLOR_MARK_*` palette, sampled from the shipped tier asset);
 * - `premium` = gold design accent on the compact dark premium plate
 *   (existing `PREMIUM_PLATE_*` + `premiumAccentHex("gold")`);
 * - every age style shares the age family box (padding/radius/height), so the
 *   top-right stack, scales and offsets are unchanged;
 * - in a REAL stack (2+ elements) tier, age and A/V marks share ONE VISIBLE
 *   column width — the canonical 4K mark of the active style — with the same
 *   band height for containers; long labels reduce the glyph font instead of
 *   widening the column, and standalone age-only output keeps its natural box.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { AGE_BADGE_STYLES, DEFAULT_AGE_BADGE_STYLE, isAgeBadgeStyle } from "@/lib/badge-styles"
import {
  AGE_KNOCKOUT_PAD_X_FACTOR,
  AGE_KNOCKOUT_RADIUS_FACTOR,
  AGE_MONO_INK_DARK,
  AGE_MONO_INK_LIGHT,
  AGE_MONO_STROKE_FACTOR,
  BADGE_BOX_PAD_X_FACTOR,
  TOP_SHADOW_PAD,
  badgeBoxHeight,
  badgeTextBox,
  buildAgeEmphasisSvg,
  buildAgeKnockoutSvg,
  buildQualityBadgeSvg,
  buildQualityKnockoutSvg,
  fitBadgeGlyphFs,
  pinnedBadgeTextWidth,
} from "@/lib/badge-svg-shared"
import {
  AV_PLATE_STROKE_WIDTH,
  COLOR_MARK_GLYPH,
  COLOR_MARK_PLATE_BG,
  COLOR_MARK_PLATE_STROKE,
  PREMIUM_PLATE_BG,
  PREMIUM_PLATE_STROKE,
  avMarkInkBox,
  premiumAccentHex,
  qualityBadgeIconPath,
  qualityIconReferenceWidth,
} from "@/lib/quality-badge-styles"
import { FORMAT_ICON_PATHS } from "@/lib/av-specs"
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"
import { renderQualityBadgeGroup, renderQualityIconBadge } from "@/lib/poster-service"
import { renderAgeEmphasisBadge, renderAgeKnockoutBadge, renderQualityBadge } from "@/lib/svg-badge"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { mappingSchema, mappingUpdateSchema } from "@/lib/validation"

const PW = 380
const LABELS = ["12", "6+", "VM14", "PG-13", "TV-MA", "FSK 16"] as const
const EMPHASIS_STYLES = ["mono", "color", "premium"] as const
const STACK_STYLES = ["standard", ...EMPHASIS_STYLES, "knockout"] as const
const TIERS = ["4K", "FHD", "HD", "SD"] as const
const PAD = TOP_SHADOW_PAD

/**
 * Canonical visible width of the 4K mark for a style (the column reference):
 * the pill for standard, the masked tag for knockout, the shared 4K frame for
 * mono (the tier renders it dynamically, no static icon), the tier icon width
 * for the plate styles. Mirrors the documented production contract.
 */
function columnWidth(style: (typeof STACK_STYLES)[number], fs: number): number {
  if (style === "knockout") return buildQualityKnockoutSvg("4K", fs, "inter").w - PAD * 2
  if (style === "standard") return buildQualityBadgeSvg("4K", fs, "", "", false, "inter").w - PAD * 2
  if (style === "mono") return buildAgeEmphasisSvg("4K", fs, "mono", false, "inter").w - PAD * 2
  return qualityIconReferenceWidth(badgeBoxHeight(fs))
}

/** Pixel stats for an opaque hex tint (and its absence). */
async function tintStats(png: Buffer, hex: string, tol = 24) {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const target = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let tint = 0
  let opaque = 0
  let transparent = 0
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (a > 200) opaque++
    if (a < 20) transparent++
    if (a > 200 && Math.abs(r - target[0]) <= tol && Math.abs(g - target[1]) <= tol && Math.abs(b - target[2]) <= tol) tint++
  }
  return { tint, opaque, transparent }
}

describe("age badge style enum (single source for schemas, URL and cache)", () => {
  it("exposes the quality vocabulary with the historic standard default", () => {
    expect([...AGE_BADGE_STYLES]).toEqual(["standard", "mono", "color", "knockout", "premium"])
    expect(DEFAULT_AGE_BADGE_STYLE).toBe("standard")
    for (const style of AGE_BADGE_STYLES) expect(isAgeBadgeStyle(style), style).toBe(true)
    // Unknown/uppercase values are still rejected (fail-closed, no inference).
    expect(isAgeBadgeStyle("garbage")).toBe(false)
    expect(isAgeBadgeStyle("KNOCKOUT")).toBe(false)
    expect(isAgeBadgeStyle("")).toBe(false)
    expect(isAgeBadgeStyle(null)).toBe(false)
    expect(isAgeBadgeStyle(undefined)).toBe(false)
  })

  it("carries every style through the resolve chain (query > mapping > token > defaults)", () => {
    for (const style of EMPHASIS_STYLES) {
      expect(resolveAgeBadgeRequest(new URLSearchParams({ agebs: style }), null, {}, null).ageBadgeStyle).toBe(style)
      expect(resolveAgeBadgeRequest(
        new URLSearchParams({ agebs: style }),
        { ageBadgeStyle: "standard" } as never,
        { ageBadgeStyle: "knockout" },
        null,
      ).ageBadgeStyle).toBe(style)
      expect(resolveAgeBadgeRequest(
        new URLSearchParams(),
        null,
        { ageBadgeStyle: style } as never,
        null,
      ).ageBadgeStyle).toBe(style)
      expect(resolveAgeBadgeRequest(
        new URLSearchParams(),
        null,
        { ageBadgeStyle: "standard" },
        null,
        { tmdbId: 1, mediaType: "movie", ageBadgeStyle: style } as never,
      ).ageBadgeStyle).toBe(style)
    }
    // Invalid stays fail-closed on the historic style.
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agebs: "garbage" }), null, { ageBadgeStyle: "color" }, null).ageBadgeStyle).toBe("standard")
  })

  it("keeps every valid agebs in the cache key (garbage collapses to standard)", () => {
    for (const style of AGE_BADGE_STYLES) {
      expect(normalizePosterCacheParams(new URLSearchParams({ agebs: style })).get("agebs")).toBe(style)
    }
    expect(normalizePosterCacheParams(new URLSearchParams({ agebs: "garbage" })).get("agebs")).toBe("standard")
    expect(normalizePosterCacheParams(new URLSearchParams()).has("agebs")).toBe(false)
  })

  it("per-title save accepts the new styles (mapping schema) and rejects junk", () => {
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    for (const style of ["standard", ...EMPHASIS_STYLES, "knockout"] as const) {
      expect(mappingSchema.safeParse({ ...base, ageBadgeStyle: style }).success, style).toBe(true)
      expect(mappingUpdateSchema.safeParse({ ageBadgeStyle: style }).success, style).toBe(true)
    }
    expect(mappingSchema.safeParse({ ...base, ageBadgeStyle: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, ageBadgeStyle: "garbage" }).success).toBe(false)
    expect(mappingUpdateSchema.safeParse({ ageBadgeStyle: "garbage" }).success).toBe(false)
  })

  it("emits the new styles in the preview and Stremio URLs", () => {
    const ps = { selected: { id: 1 } } as never
    expect(new URL(buildPreviewUrl(ps, { ageBadge: true, ageBadgeStyle: "color" } as never)).searchParams.get("agebs")).toBe("color")
    const land = new URL(buildDefaultsPreviewUrl({
      defaultAgeBadge: true,
      defaultAgeBadgeStyle: "standard",
      previewShape: "landscape",
      landscape: { ageBadgeStyle: "premium" },
    } as never))
    expect(land.searchParams.get("agebs")).toBe("premium")
    expect(buildStremioPosterSearchParams({ ageBadge: true, ageBadgeStyle: "mono" }).get("agebs")).toBe("mono")
    expect(buildStremioPosterSearchParams({ ageBadge: false, ageBadgeStyle: "mono" }).has("agebs")).toBe(false)
  })
})

describe("age style renderer dispatch (one shared renderer)", () => {
  it("keeps standard on the neutral satin pill and knockout on the masked tag", async () => {
    const fs = 17
    // Standard: historic neutral pill recipe (no separate/squarer tier tag).
    const std = await renderQualityBadge("VM14", PW, false, "inter")
    const pill = buildQualityBadgeSvg("VM14", fs, "", "", false, "inter")
    expect(std.w).toBe(pill.w)
    expect(std.h).toBe(pill.h)
    const boxH = badgeBoxHeight(fs)
    expect(pill.svg).toContain(`rx="${Math.round(boxH / 2)}"`)
    expect(pill.svg).toContain('fill="url(#qg)"')
    // Visible box = pinned text + the shared 0.75x padding on both sides.
    expect(pill.w - PAD * 2).toBe(
      pinnedBadgeTextWidth("VM14", fs, "inter") + Math.round(fs * BADGE_BOX_PAD_X_FACTOR) * 2,
    )
    // Knockout: genuine masked cut-out (glyph holes, no opaque text fill).
    const ko = await renderAgeKnockoutBadge("VM14", PW, "inter")
    const tag = buildAgeKnockoutSvg("VM14", fs, "inter")
    expect(ko.w).toBe(tag.w)
    expect(ko.h).toBe(tag.h)
    expect(tag.svg).toContain("<mask")
    expect(tag.svg).toContain('mask="url(#akm)"')
    expect(tag.svg).toContain(`font-size="${fs}"`)
  }, 30000)

  it("dispatches mono/color/premium to the age emphasis recipe (never the quality tier)", async () => {
    for (const style of EMPHASIS_STYLES) {
      const group = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", style)
      const expected = await renderAgeEmphasisBadge("VM14", PW, style, false, "inter")
      expect(group, style).not.toBeNull()
      expect(group!.png.equals(expected.png), style).toBe(true)
      // Distinct from both historic age styles.
      const std = await renderQualityBadge("VM14", PW, false, "inter")
      const ko = await renderAgeKnockoutBadge("VM14", PW, "inter")
      expect(group!.png.equals(std.png), `${style} vs standard`).toBe(false)
      expect(group!.png.equals(ko.png), `${style} vs knockout`).toBe(false)
    }
  }, 30000)

  it("keeps the age family box for every style and label (standalone history)", () => {
    for (const label of LABELS) {
      const fs = 17
      const knockout = buildAgeKnockoutSvg(label, fs)
      for (const style of EMPHASIS_STYLES) {
        const built = buildAgeEmphasisSvg(label, fs, style)
        expect(built.h, `${style}/${label} height`).toBe(knockout.h)
        expect(built.w, `${style}/${label} width`).toBe(knockout.w)
      }
      // Height is the shared badge box + symmetric shadow padding.
      expect(knockout.h).toBe(badgeBoxHeight(fs) + TOP_SHADOW_PAD * 2)
    }
    // Standalone (no group target) long labels still grow the box: legibility
    // over squeezing; the uniform column belongs to the group path below.
    const short = buildAgeEmphasisSvg("12", 17, "color")
    const long = buildAgeEmphasisSvg("PG-13", 17, "color")
    expect(long.w).toBeGreaterThan(short.w)
    expect(long.h).toBe(short.h)
  })

  it("keeps the quality/age/formats stack geometry identical across age styles", async () => {
    // Same label, same tier, same format: switching the AGE style only changes
    // the age bitmap, never the group footprint or the paint order/identities.
    const koGroup = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, true, "inter", "TV-MA", "knockout")
    expect(koGroup).not.toBeNull()
    for (const style of EMPHASIS_STYLES) {
      const group = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, true, "inter", "TV-MA", style)
      expect(group, style).not.toBeNull()
      expect([group!.w, group!.h], style).toEqual([koGroup!.w, koGroup!.h])
      expect(group!.items.map((i) => i.id), style).toEqual(koGroup!.items.map((i) => i.id))
    }
  }, 30000)

  it("keeps the age plate geometry (padding/radius/stroke) of the age family", () => {
    const fs = 17
    for (const style of EMPHASIS_STYLES) {
      const { svg } = buildAgeEmphasisSvg("VM14", fs, style)
      const boxH = badgeBoxHeight(fs)
      const r = Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)
      expect(svg, `${style} radius`).toContain(`rx="${r}"`)
      if (style === "mono") {
        const stroke = Math.max(2, Math.round(fs * AGE_MONO_STROKE_FACTOR))
        expect(svg, "mono frame").toContain(`fill="none" stroke="${AGE_MONO_INK_DARK}" stroke-width="${stroke}"`)
      } else {
        expect(svg, `${style} plate stroke`).toContain(`stroke-width="${AV_PLATE_STROKE_WIDTH}"`)
      }
      // Glyphs at the base fs (no quality-style oversize) + pinned width.
      expect(svg).toContain(`font-size="${fs}"`)
      expect(svg).toContain("textLength=")
      expect(svg).toContain("lengthAdjust=")
      // Comfortable padding on both sides (same rule as the age knockout).
      const px = Math.round(fs * AGE_KNOCKOUT_PAD_X_FACTOR)
      const textLen = Number(svg.match(/textLength="(\d+)"/)?.[1] ?? "0")
      const totalW = buildAgeEmphasisSvg("VM14", fs, style).w - TOP_SHADOW_PAD * 2
      expect(totalW - textLen).toBeGreaterThanOrEqual(px * 2)
    }
  })

  it("reuses the shared font metrics and escaping", () => {
    const inter = buildAgeEmphasisSvg("VM14", 17, "color", false, "inter").svg
    const oswald = buildAgeEmphasisSvg("VM14", 17, "color", false, "oswald").svg
    expect(oswald).not.toBe(inter)
    expect(oswald).toContain('font-family="Oswald"')
    expect(buildAgeEmphasisSvg("A&B", 17, "mono").svg).toContain("A&amp;B")
    expect(buildAgeEmphasisSvg("A&B", 17, "mono").svg).not.toContain(">A&B<")
  })
})

describe("age styles: concrete ink/plate of the existing quality palettes", () => {
  it("mono is a high-contrast monochrome mark with no satin fill", async () => {
    const dark = await renderAgeEmphasisBadge("VM14", PW, "mono", false, "inter")
    const light = await renderAgeEmphasisBadge("VM14", PW, "mono", true, "inter")
    const darkWhite = await tintStats(dark.png, AGE_MONO_INK_DARK)
    const darkBlack = await tintStats(dark.png, AGE_MONO_INK_LIGHT)
    const lightBlack = await tintStats(light.png, AGE_MONO_INK_LIGHT)
    // Dark top → white ink only; light top → black ink only.
    expect(darkWhite.tint).toBeGreaterThan(200)
    expect(darkBlack.tint).toBe(0)
    expect(lightBlack.tint).toBeGreaterThan(200)
    // No plate/fill: most of the canvas is transparent (frame + glyphs only).
    expect(darkWhite.transparent).toBeGreaterThan(darkWhite.opaque)
    expect(darkWhite.transparent).toBeGreaterThan(1000)
  }, 30000)

  it("color uses the dark tier plate, yellow tier border and yellow glyph", async () => {
    const color = await renderAgeEmphasisBadge("VM14", PW, "color", false, "inter")
    expect((await tintStats(color.png, COLOR_MARK_PLATE_BG)).tint).toBeGreaterThan(500)
    expect((await tintStats(color.png, COLOR_MARK_PLATE_STROKE)).tint).toBeGreaterThan(50)
    expect((await tintStats(color.png, COLOR_MARK_GLYPH)).tint).toBeGreaterThan(20)
    // Plate styles ignore the top polarity: identical bitmap on light/dark.
    const light = await renderAgeEmphasisBadge("VM14", PW, "color", true, "inter")
    expect(light.png.equals(color.png)).toBe(true)
  }, 30000)

  it("premium uses the compact dark premium plate with the design gold accent", async () => {
    const premium = await renderAgeEmphasisBadge("VM14", PW, "premium", false, "inter")
    const gold = premiumAccentHex("gold")
    expect((await tintStats(premium.png, gold)).tint).toBeGreaterThan(20)
    // Dark neutral premium plate (rgba(16,17,21,0.88)) + its shared stroke.
    expect((await tintStats(premium.png, "#101115")).tint).toBeGreaterThan(200)
    const { svg } = buildAgeEmphasisSvg("VM14", 17, "premium")
    expect(svg).toContain(PREMIUM_PLATE_BG)
    expect(svg).toContain(PREMIUM_PLATE_STROKE)
    // Never the tier yellow (that palette belongs to `color`).
    expect((await tintStats(premium.png, COLOR_MARK_GLYPH)).tint).toBe(0)
    const light = await renderAgeEmphasisBadge("VM14", PW, "premium", true, "inter")
    expect(light.png.equals(premium.png)).toBe(true)
  }, 30000)

  it("renders long labels without clipping inside the box", async () => {
    for (const label of LABELS) {
      for (const style of ["knockout", ...EMPHASIS_STYLES] as const) {
        const built = style === "knockout"
          ? buildAgeKnockoutSvg(label, 17)
          : buildAgeEmphasisSvg(label, 17, style)
        const totalW = built.w - TOP_SHADOW_PAD * 2
        const textLen = Number(built.svg.match(/textLength="(\d+)"/)?.[1] ?? "0")
        expect(textLen, `${style}/${label}`).toBeGreaterThan(0)
        // The pinned glyph run always stays inside the box with side padding.
        expect(textLen).toBeLessThan(totalW)
        expect(totalW - textLen).toBeGreaterThanOrEqual(Math.round(17 * AGE_KNOCKOUT_PAD_X_FACTOR))
      }
    }
  })
})

describe("common visible column geometry (tier / age / A/V)", () => {
  it("pins tier, age and A/V to the canonical 4K visible width for every style/tier/label (portrait + landscape)", async () => {
    const check = async (
      pw: number,
      style: (typeof STACK_STYLES)[number],
      tier: string,
      label: string,
    ) => {
      const fs = Math.round(Math.max(17 * pw / 380, 10))
      const boxH = badgeBoxHeight(fs)
      const refW = columnWidth(style, fs)
      const tag = `${style}/${tier}/${label}/${pw}`
      const group = await renderQualityBadgeGroup(tier, style, ["dv", "imax"], pw, false, "inter", label)
      expect(group, tag).not.toBeNull()
      expect(group!.items.map((i) => i.id), tag).toEqual([
        BADGE_ITEM_QUALITY_TIER,
        BADGE_ITEM_QUALITY_AGE,
        qualityFormatItemId("dv"),
        qualityFormatItemId("imax"),
      ])
      // ONE VISIBLE width for every element (not merely an equal transparent
      // canvas): the pill/tag/plate itself is as wide as the canonical 4K.
      for (const item of group!.items) {
        expect(item.w - PAD * 2, `${tag}/${item.id} visible width`).toBe(refW)
        expect(item.left + item.w / 2, `${tag}/${item.id} center`).toBe(group!.w / 2)
      }
      expect(group!.w, `${tag} column width`).toBe(refW + PAD * 2)
      // Text containers share the common band height (the 4K box height).
      for (const item of group!.items.slice(0, 2)) {
        expect(item.h, `${tag}/${item.id} band height`).toBe(boxH + PAD * 2)
      }
      // EVERY A/V mark is framed to the common band: satin pill (`standard`),
      // mono outline (`mono`), plate (`color`/`premium`), white tag (`knockout`).
      // The glyph inside keeps its native aspect (never stretched), which is
      // pinned by `avPlateGlyphBox` in the quality aesthetic suite.
      for (const mark of [
        { id: "dv", ink: avMarkInkBox(FORMAT_ICON_PATHS.dv)! },
        { id: "imax", ink: avMarkInkBox(FORMAT_ICON_PATHS.imax)! },
      ]) {
        const item = group!.items.find((i) => i.id === qualityFormatItemId(mark.id as "dv" | "imax"))!
        expect(item.h, `${tag}/${mark.id} band`).toBe(boxH + PAD * 2)
      }
    }
    for (const pw of [380, 500]) {
      for (const style of STACK_STYLES) {
        // Tier variants (4K/FHD/SD) and age label variants, same column.
        for (const tier of ["4K", "FHD", "SD"] as const) await check(pw, style, tier, "TV-MA")
        for (const label of LABELS) await check(pw, style, "4K", label)
      }
    }
  }, 180000)

  it("renders the standard tier with the SAME neutral pill recipe as the age standard", async () => {
    const fs = 17
    // Detach both text items: the returned bitmaps ARE the painted tier/age.
    const detach = {
      [BADGE_ITEM_QUALITY_TIER]: { scale: 101, offsetX: 0, offsetY: 0 },
      [BADGE_ITEM_QUALITY_AGE]: { scale: 101, offsetX: 0, offsetY: 0 },
    }
    const group = await renderQualityBadgeGroup("VM14", "standard", ["imax"], PW, false, "inter", "VM14", "standard", detach)
    const tier = group!.items.find((i) => i.id === BADGE_ITEM_QUALITY_TIER)!
    const age = group!.items.find((i) => i.id === BADGE_ITEM_QUALITY_AGE)!
    expect(tier.png, "tier detached").toBeDefined()
    expect(age.png, "age detached").toBeDefined()
    // Same label, same column → literally the same pill: full rx = boxH/2,
    // shared satin padding and glyph font.
    expect(tier.png!.equals(age.png!)).toBe(true)
    expect([tier.w, tier.h]).toEqual([age.w, age.h])
    const refW = columnWidth("standard", fs)
    const pill = buildQualityBadgeSvg("VM14", fs, "", "", false, "inter", refW)
    const boxH = badgeBoxHeight(fs)
    expect(pill.w - PAD * 2).toBe(refW)
    expect(pill.svg).toContain(`rx="${Math.round(boxH / 2)}"`)
    expect(pill.svg).toContain('fill="url(#qg)"')
    // Pinned glyph font (no squish): reduced from 17 to fit the shared box.
    const glyphFs = Number(pill.svg.match(/font-size="(\d+)"/)?.[1])
    expect(glyphFs).toBeLessThan(fs)
    expect(glyphFs).toBe(fitBadgeGlyphFs("VM14", fs, refW, BADGE_BOX_PAD_X_FACTOR, "inter"))
    expect(pill.svg).toContain(`textLength="${pinnedBadgeTextWidth("VM14", glyphFs, "inter")}"`)
  }, 30000)

  it("keeps age-only natural output and pins the column only for real stacks", async () => {
    const fs = 17
    // Single painted element = historic bitmap, no invented normalisation.
    const alone = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "standard")
    const direct = await renderQualityBadge("VM14", PW, false, "inter")
    expect(alone!.png.equals(direct.png)).toBe(true)
    const naturalPill = buildQualityBadgeSvg("VM14", fs, "", "", false, "inter")
    expect([alone!.w, alone!.h]).toEqual([naturalPill.w, naturalPill.h])
    // Age + A/V mark ⇒ a real column: both pinned to the canonical 4K width.
    const stacked = await renderQualityBadgeGroup(null, "standard", ["imax"], PW, false, "inter", "VM14", "standard")
    const refW = columnWidth("standard", fs)
    expect(stacked!.items.map((i) => i.w - PAD * 2)).toEqual([refW, refW])
    // Quality-only keeps the full natural tier box (even when wider than 4K).
    const qualityAlone = await renderQualityBadgeGroup("FHD", "standard", null, PW, false, "inter", null)
    expect(qualityAlone!.w).toBe(buildQualityBadgeSvg("FHD", fs, "", "", false, "inter").w)
    // Quality + A/V ⇒ the tier is pinned to the same 4K column.
    const qualityStack = await renderQualityBadgeGroup("FHD", "standard", ["imax"], PW, false, "inter", null)
    expect(qualityStack!.items.map((i) => i.w - PAD * 2)).toEqual([refW, refW])
    expect(qualityStack!.items[0].h).toBe(badgeBoxHeight(fs) + PAD * 2)
  }, 30000)

  it("normalises the mono/color tier icon to the same visible column width (ratio preserved)", async () => {
    const fs = 17
    const refW = qualityIconReferenceWidth(badgeBoxHeight(fs))
    for (const icon of [qualityBadgeIconPath("mono", "4K")!, qualityBadgeIconPath("color", "4K")!]) {
      const rendered = await renderQualityIconBadge(icon, PW, false)
      expect(rendered, icon).not.toBeNull()
      // Canvas and visible band: same column width/height as the text pills.
      expect(rendered!.w).toBe(refW + PAD * 2)
      expect(rendered!.h).toBe(badgeBoxHeight(fs) + PAD * 2)
      // The opaque icon body at the vertical centre spans the whole visible
      // width (tight asset bounds, never stretched beyond its ratio).
      const { data, info } = await sharp(rendered!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const y = Math.round(info.height / 2)
      let x0 = info.width
      let x1 = -1
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] > 200) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
        }
      }
      expect(x1 - x0 + 1, `${icon} visible body`).toBe(refW)
    }
  }, 30000)

  it("computes the pinned glyph size from the shared metrics (never squashes the label)", () => {
    const natural = badgeTextBox("VM14", 17, BADGE_BOX_PAD_X_FACTOR, "inter")
    expect(natural.glyphFs).toBe(17)
    expect(natural.totalW).toBe(pinnedBadgeTextWidth("VM14", 17, "inter") + Math.round(17 * BADGE_BOX_PAD_X_FACTOR) * 2)
    const pinned = badgeTextBox("VM14", 17, BADGE_BOX_PAD_X_FACTOR, "inter", 48)
    expect(pinned.glyphFs).toBe(11)
    expect(pinned.glyphFs).toBe(fitBadgeGlyphFs("VM14", 17, 48, BADGE_BOX_PAD_X_FACTOR, "inter"))
    expect(pinned.totalW).toBe(48)
    expect(pinned.boxH).toBe(natural.boxH)
    // Pinned run = the natural width AT the fitted font (no compressed glyphs).
    expect(pinned.textW).toBe(pinnedBadgeTextWidth("VM14", 11, "inter"))
  })

  it("fits every tier and age label in the common box without clipping (all fonts, pw 380/500)", () => {
    const FONTS = ["inter", "barlow-condensed", "oswald"] as const
    for (const pw of [380, 500]) {
      const fs = Math.round(Math.max(17 * pw / 380, 10))
      const boxH = badgeBoxHeight(fs)
      for (const font of FONTS) {
        for (const style of STACK_STYLES) {
          const refW = columnWidth(style, fs)
          for (const label of [...TIERS, ...LABELS]) {
            const built = style === "standard"
              ? buildQualityBadgeSvg(label, fs, "", "", false, font, refW)
              : style === "knockout"
                ? buildAgeKnockoutSvg(label, fs, font, refW)
                : buildAgeEmphasisSvg(label, fs, style, false, font, refW)
            expect(built.w - PAD * 2, `${style}/${label}/${font}/${pw} width`).toBe(refW)
            expect(built.h, `${style}/${label}/${font}/${pw} height`).toBe(boxH + PAD * 2)
            const glyphFs = Number(built.svg.match(/font-size="(\d+)"/)?.[1])
            expect(glyphFs, `${style}/${label}/${font}/${pw} glyph`).toBeGreaterThan(0)
            expect(glyphFs).toBeLessThanOrEqual(fs)
            const pad = style === "standard" ? BADGE_BOX_PAD_X_FACTOR : AGE_KNOCKOUT_PAD_X_FACTOR
            const textLen = Number(built.svg.match(/textLength="(\d+)"/)?.[1])
            // The pinned glyph run fits the box with the recipe padding: the
            // font shrinks instead of the label being squashed into the box.
            expect(textLen, `${style}/${label}/${font}/${pw} text`).toBeGreaterThan(0)
            expect(textLen + Math.round(glyphFs * pad) * 2, `${style}/${label}/${font}/${pw} fit`)
              .toBeLessThanOrEqual(refW)
          }
        }
      }
    }
  })

  it("keeps the quality style and the age style independent", async () => {
    const detachTier = { [BADGE_ITEM_QUALITY_TIER]: { scale: 101, offsetX: 0, offsetY: 0 } }
    const detachAge = { [BADGE_ITEM_QUALITY_AGE]: { scale: 101, offsetX: 0, offsetY: 0 } }
    // Changing the AGE style never rewrites the quality tier bitmap.
    const tiers: Buffer[] = []
    for (const ageStyle of STACK_STYLES) {
      const g = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14", ageStyle, detachTier)
      tiers.push(g!.items.find((i) => i.id === BADGE_ITEM_QUALITY_TIER)!.png!)
    }
    for (const png of tiers) expect(png.equals(tiers[0])).toBe(true)
    // Changing the QUALITY style never copies its palette onto the age badge:
    // standard age stays the satin pill, color age stays the tier plate.
    const stdAge = await renderQualityBadgeGroup("4K", "color", ["imax"], PW, false, "inter", "VM14", "standard", detachAge)
    const stdAgePng = stdAge!.items.find((i) => i.id === BADGE_ITEM_QUALITY_AGE)!.png!
    expect((await tintStats(stdAgePng, COLOR_MARK_GLYPH)).tint).toBe(0)
    // The satin pill has no dark tier PLATE: only incidental antialiased ink
    // pixels may sit near the plate colour (far below a real plate body).
    expect((await tintStats(stdAgePng, COLOR_MARK_PLATE_BG)).tint).toBeLessThan(100)
    const colorAge = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14", "color", detachAge)
    const colorAgePng = colorAge!.items.find((i) => i.id === BADGE_ITEM_QUALITY_AGE)!.png!
    expect((await tintStats(colorAgePng, COLOR_MARK_PLATE_BG)).tint).toBeGreaterThan(200)
    expect((await tintStats(colorAgePng, COLOR_MARK_GLYPH)).tint).toBeGreaterThan(20)
  }, 60000)

  it("keeps per-item overrides as intentional exceptions (slots never reflow)", async () => {
    const base = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14")
    const tuned = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, false, "inter", "VM14", "standard", {
      [BADGE_ITEM_QUALITY_AGE]: { scale: 140, offsetX: 12, offsetY: -6 },
    })
    expect([tuned!.w, tuned!.h]).toEqual([base!.w, base!.h])
    expect(tuned!.items.map((i) => `${i.id}:${i.left}:${i.top}:${i.w}:${i.h}`)).toEqual(
      base!.items.map((i) => `${i.id}:${i.left}:${i.top}:${i.w}:${i.h}`),
    )
    const age = tuned!.items.find((i) => i.id === BADGE_ITEM_QUALITY_AGE)!
    // The caller applies the user correction on top; the shared slot/geometry
    // stays the automatic one (explicit user scale/offset = intentional).
    expect(age.png).toBeDefined()
    expect(tuned!.items.filter((i) => i.png !== undefined).map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_AGE])
  }, 30000)
})

describe("age styles keep the quality defaults independent", () => {
  it("never shares a mutable enum array with the quality style list", () => {
    // Same vocabulary, separate constants: adding/removing a quality style can
    // never silently change the age transport (and vice versa).
    expect(AGE_BADGE_STYLES).not.toBe(EMPHASIS_STYLES)
    expect([...AGE_BADGE_STYLES]).toEqual(["standard", "mono", "color", "knockout", "premium"])
  })
})
