import { describe, expect, it } from "vitest"
import {
  AGE_KNOCKOUT_RADIUS_FACTOR,
  AGE_MONO_STROKE_FACTOR,
  BADGE_BOX_PAD_X_FACTOR,
  badgeBoxHeight,
  buildAgeEmphasisSvg,
  buildQualityBadgeSvg,
  pinnedBadgeTextWidth,
  TOP_SHADOW_PAD,
} from "@/lib/badge-svg-shared"
import {
  renderAgeEmphasisBadge,
  renderQualityBadge,
} from "@/lib/svg-badge"
import {
  renderQualityBadgeGroup,
  renderQualityIconBadge,
} from "@/lib/poster-service"
import { FORMAT_ICON_PATHS, VIDEO_FORMAT_OPTIONS } from "@/lib/av-specs"
import {
  AV_PLATE_GLYPH_HEIGHT_FACTOR,
  avMarkInkBox,
  avPlateGlyphBox,
  qualityIconReferenceWidth,
} from "@/lib/quality-badge-styles"
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"
import type { BadgeFont } from "@/lib/badge-styles"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

const ROOT = path.resolve(__dirname, "../../..")
const PAD = TOP_SHADOW_PAD
const TIERS = ["4K", "FHD", "HD", "SD"] as const
const FONTS = ["inter", "barlow-condensed", "oswald"] as const satisfies readonly BadgeFont[]

function rxOf(svg: string): number {
  const m = svg.match(/rx="([\d.]+)"/)
  expect(m, "rx present").not.toBeNull()
  return Number(m![1])
}

function textLengthOf(svg: string): number {
  const m = svg.match(/textLength="(\d+)"/)
  expect(m, "textLength present").not.toBeNull()
  return Number(m![1])
}

/** Opaque-ink bbox (alpha > 10) of a rendered badge PNG. */
async function inkBox(png: Buffer, w: number, h: number) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = w, x1 = -1, y0 = h, y1 = -1, n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        n++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  expect(n, "mark visible").toBeGreaterThan(100)
  return { x0, x1, y0, y1, n }
}

describe("standard quality tier is the neutral pill (same recipe as the age pill)", () => {
  it("keeps the historic satin pill geometry for every tier/font (full-pill radius, 0.75x padding)", () => {
    for (const tier of TIERS) {
      for (const font of FONTS) {
        for (const fs of [17, 22]) {
          const pill = buildQualityBadgeSvg(tier, fs, "", "", false, font)
          const boxH = badgeBoxHeight(fs)
          // Full pill radius (rx = boxH/2), not the old contained/squarer tag.
          expect(rxOf(pill.svg), `${tier}/${font}/${fs} radius`).toBe(Math.round(boxH / 2))
          expect(pill.h, `${tier}/${font}/${fs} height`).toBe(boxH + PAD * 2)
          // Historic neutral padding on both sides of the pinned run.
          const pad = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
          expect(pill.w, `${tier}/${font}/${fs} width`).toBe(
            pinnedBadgeTextWidth(tier, fs, font) + pad * 2 + PAD * 2,
          )
          expect(pill.svg, `${tier}/${font}/${fs} satin`).toContain('fill="url(#qg)"')
          // No text clipping: the pinned run fits the pill interior.
          expect(textLengthOf(pill.svg) + pad * 2, `${tier}/${font}/${fs} fit`)
            .toBeLessThanOrEqual(pill.w - PAD * 2)
        }
      }
    }
  })

  it("rasterizes at portrait and landscape badge widths without clipping", async () => {
    for (const pw of [380, 500]) {
      const pill = await renderQualityBadge("4K", pw, false)
      const box = await inkBox(pill.png, pill.w, pill.h)
      expect(box.n).toBeGreaterThan(100)
      // Opaque ink stays inside the box (shadow pad margin on every side).
      expect(box.x0).toBeGreaterThanOrEqual(2)
      expect(box.y0).toBeGreaterThanOrEqual(2)
      expect(box.x1).toBeLessThanOrEqual(pill.w - 3)
      expect(box.y1).toBeLessThanOrEqual(pill.h - 3)
    }
  })
})

describe("age standard pill shares the neutral recipe", () => {
  it("keeps the historic neutral geometry (pad 0.75x, full-pill radius)", () => {
    // "VM14" estimate: V .68 + M .86 + 1 .58 + 4 .58 = 2.70em * 17 = 45.9 -> 46,
    // plus technical-mark tracking round(0.06*17*3) = 3 -> textW 49.
    const age = buildQualityBadgeSvg("VM14", 17, "", "", false, "inter")
    expect(age.w).toBe(49 + Math.round(17 * 0.75) * 2 + PAD * 2)
    expect(rxOf(age.svg)).toBe(Math.round(badgeBoxHeight(17) / 2))
    // Literally the same recipe the standard quality tier now uses.
    const tier = buildQualityBadgeSvg("VM14", 17, "", "", false, "inter")
    expect(tier.svg).toBe(age.svg)
  })

  it("age-only group returns the neutral pill bitmap directly (no tier path)", async () => {
    const group = await renderQualityBadgeGroup(null, "standard", null, 380, false, "inter", "VM14")
    const pill = await renderQualityBadge("VM14", 380, false)
    expect(group).not.toBeNull()
    expect(group!.png.equals(pill.png)).toBe(true)
  })
})

describe("quality -> age -> formats order with the common column", () => {
  const PW = 380
  const GAP = Math.round(5 * PW / 380)
  const REF_W = buildQualityBadgeSvg("4K", 17, "", "", false, "inter").w - PAD * 2

  it("stacks tier, age, then framed format marks on ONE visible width", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["hdr"], PW, false, "inter", "VM14")
    expect(group).not.toBeNull()
    expect(group!.items.map((i) => i.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      qualityFormatItemId("hdr"),
    ])
    // Every painted slot (tier pill, age pill, A/V mark) is exactly as wide as
    // the canonical 4K pill: one real column, not only one canvas.
    for (const item of group!.items) expect(item.w - PAD * 2, item.id).toBe(REF_W)
    expect(group!.w).toBe(REF_W + PAD * 2)
    // Painted slots, top-to-bottom: every box shares the common band (the
    // A/V glyph keeps its native aspect INSIDE its frame).
    const [tier, age, hdr] = group!.items
    const rows = [tier.h, age.h, hdr.h].map((h) => h - PAD * 2)
    expect(rows).toEqual([badgeBoxHeight(17), badgeBoxHeight(17), badgeBoxHeight(17)])
    expect(group!.h).toBe(PAD * 2 + rows.reduce((a, b) => a + b, 0) + GAP * 2)
  })

  it("keeps a uniform gap across a four-row column (tier/age/hdr/imax)", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["hdr", "imax"], PW, false, "inter", "VM14")
    expect(group).not.toBeNull()
    // Painted slots, top-to-bottom in the documented order.
    expect(group!.items.map((i) => i.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      qualityFormatItemId("hdr"),
      qualityFormatItemId("imax"),
    ])
    const [, , hdr, imax] = group!.items
    // Same visible width for the two A/V marks (width normalization), so the
    // column keeps ONE gap and both bands stay centred.
    expect(hdr.w).toBe(imax.w)
    expect([hdr.w - PAD * 2, imax.w - PAD * 2]).toEqual([REF_W, REF_W])
    const rows = group!.items.map((i) => i.h - PAD * 2)
    expect(group!.h).toBe(PAD * 2 + rows.reduce((a, b) => a + b, 0) + GAP * 3)
  })
})

describe("format marks without containers, no relabeling", () => {
  it("keeps the generic HDR label (never HDR10) and every per-format asset", () => {
    const labels = new Map(VIDEO_FORMAT_OPTIONS.map((o) => [o.id, o.label] as const))
    expect(labels.get("hdr")).toBe("HDR")
    expect([...labels.keys()]).not.toContain("hdr10")
    for (const fmt of ["dv", "hdr", "hdr10plus", "atmos", "imax"] as const) {
      expect(
        fs.existsSync(path.join(ROOT, "public", FORMAT_ICON_PATHS[fmt])),
        `missing asset ${fmt}`,
      ).toBe(true)
    }
  })

  it("ships hdr/hdr10plus sources with no container path", () => {
    for (const fmt of ["hdr", "hdr10plus"] as const) {
      const src = fs.readFileSync(path.join(ROOT, "public", FORMAT_ICON_PATHS[fmt]), "utf8")
      // Rounded-rectangle container frame of the previous artwork.
      expect(src).not.toMatch(/94\.3H/)
      expect(src).not.toMatch(/<rect/)
    }
  })

  it("renders bare marks with transparent surroundings on any background", async () => {
    for (const fmt of ["hdr", "hdr10plus", "dv", "atmos"] as const) {
      const icon = await renderQualityIconBadge(FORMAT_ICON_PATHS[fmt], 380, false)
      expect(icon).not.toBeNull()
      const { data } = await sharp(icon!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const corner = (x: number, y: number): number => data[(y * icon!.w + x) * 4 + 3]
      // 5x5 bitmap corners (shadow pad zone): no box may reach the edges.
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          expect(corner(x, y), `${fmt} tl`).toBe(0)
          expect(corner(icon!.w - 1 - x, y), `${fmt} tr`).toBe(0)
          expect(corner(x, icon!.h - 1 - y), `${fmt} bl`).toBe(0)
          expect(corner(icon!.w - 1 - x, icon!.h - 1 - y), `${fmt} br`).toBe(0)
        }
      }
      // Compositing proof on a synthetic red background: mark visible, surround clean.
      const comp = await sharp({
        create: { width: icon!.w, height: icon!.h, channels: 4, background: { r: 212, g: 0, b: 0, alpha: 1 } },
      })
        .composite([{ input: icon!.png }])
        .png()
        .toBuffer()
      const raw = await sharp(comp).ensureAlpha().raw().toBuffer()
      // Far corner stays pure background red (no translucent box film).
      const i = (4 * icon!.w + 4) * 4
      expect(raw[i]).toBe(212)
      expect(raw[i + 1]).toBe(0)
      expect(raw[i + 2]).toBe(0)
    }
  })

  it("shares one visible ink width across every mark, aspect preserved", async () => {
    // Requisito utente: larghezza d'inchiostro UNIFORME. Prima ogni marchio
    // era scalato in altezza (box identico), quindi IMAX/HDR risultavano 2-4x
    // più larghi: qui si ancora la larghezza al badge 4K, l'altezza segue
    // l'aspect naturale dell'asset (mai stretch).
    // pw 760 -> box 62px: i tratti sottili restano risolti.
    const PW_BIG = 760
    const fs = Math.round(Math.max(17 * PW_BIG / 380, 10))
    const ref = qualityIconReferenceWidth(badgeBoxHeight(fs))
    const widths: number[] = []
    for (const fmt of ["dv", "atmos", "hdr", "hdr10plus", "imax"] as const) {
      const icon = await renderQualityIconBadge(FORMAT_ICON_PATHS[fmt], PW_BIG, false)
      expect(icon, fmt).not.toBeNull()
      const ink = avMarkInkBox(FORMAT_ICON_PATHS[fmt])!
      // Bitmap box: larghezza d'inchiostro normalizzata + shadow pad.
      expect(icon!.w, `${fmt} box width`).toBe(ref + PAD * 2)
      expect(icon!.h, `${fmt} box height`).toBe(Math.round(ref * (ink.h / ink.w)) + PAD * 2)
      // Pixel: il bbox visibile (alpha > 10, alone incluso) è identico in
      // larghezza per ogni marchio (l'alone è costante, quindi si elide).
      const box = await inkBox(icon!.png, icon!.w, icon!.h)
      widths.push(box.x1 - box.x0 + 1)
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Mono tier + framed A/V marks (user-authorized restatement): age and quality
// share ONE visual family — the quality `mono` tier is the SAME framed dynamic
// label recipe as the age `mono` (no static icon with a different material),
// and the A/V marks wear the frame of their column: satin PILL for `standard`,
// high-contrast OUTLINE (no fill) for `mono`. Glyphs never stretch: they keep
// their native aspect inside the frame. `color`/`premium`/`knockout` keep
// their existing plates/tag.
// ---------------------------------------------------------------------------

interface RawRgba { data: Buffer; width: number; height: number }
interface Rgba { r: number; g: number; b: number; a: number }

/** RGBA raw of a rendered bitmap (one decode per render). */
async function rawPixels(png: Buffer): Promise<RawRgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function pixelAt(raw: RawRgba, x: number, y: number): Rgba {
  const i = (y * raw.width + x) * 4
  return { r: raw.data[i], g: raw.data[i + 1], b: raw.data[i + 2], a: raw.data[i + 3] }
}

function luma(p: Rgba): number {
  return (p.r + p.g + p.b) / 3
}

/** Visible width of the mono column: the canonical 4K mono FRAME (age recipe). */
const MONO_REF_W = buildAgeEmphasisSvg("4K", 17, "mono", false, "inter").w - PAD * 2
/** Visible width of the standard column: the canonical 4K satin pill. */
const STANDARD_REF_W = buildQualityBadgeSvg("4K", 17, "", "", false, "inter").w - PAD * 2

describe("mono tier shares the age mono frame (quality/age parity)", () => {
  it("dispatches the quality mono tier to the SAME framed label as the age mono (tier/font/polarity)", async () => {
    for (const topLight of [false, true]) {
      for (const font of FONTS) {
        for (const tier of TIERS) {
          const tag = `${tier}/${font}/topLight=${topLight}`
          const tierBadge = await renderQualityBadgeGroup(tier, "mono", null, 380, topLight, font)
          const ageBadge = await renderAgeEmphasisBadge(tier, 380, "mono", topLight, font)
          expect(tierBadge, tag).not.toBeNull()
          // Same text → literally the same frame: one shared material, no
          // static asset that differs from the age mono look.
          expect(tierBadge!.png.equals(ageBadge.png), tag).toBe(true)
          expect([tierBadge!.w, tierBadge!.h], tag).toEqual([ageBadge.w, ageBadge.h])
        }
      }
    }
  }, 60000)

  it("keeps the shared column width derived from the 4K mono frame, never the retired static icon", async () => {
    const group = await renderQualityBadgeGroup("4K", "mono", ["imax"], 380, false, "inter")
    expect(group).not.toBeNull()
    // The old mono anchor was the shipped icon width: the frame recipe is now
    // the single reference (tier, age and A/V all share it).
    expect(MONO_REF_W).not.toBe(qualityIconReferenceWidth(badgeBoxHeight(17)))
    for (const item of group!.items) expect(item.w - PAD * 2, item.id).toBe(MONO_REF_W)
    expect(group!.w).toBe(MONO_REF_W + PAD * 2)
    // The stacked tier cell is the pinned mono frame of its own label.
    const detach = { [BADGE_ITEM_QUALITY_TIER]: { scale: 101, offsetX: 0, offsetY: 0 } }
    const pinned = await renderQualityBadgeGroup("4K", "mono", ["imax"], 380, false, "inter", "VM14", "standard", detach)
    const tierPng = pinned!.items.find((i) => i.id === BADGE_ITEM_QUALITY_TIER)!.png!
    const expected = await renderAgeEmphasisBadge("4K", 380, "mono", false, "inter", MONO_REF_W)
    expect(tierPng.equals(expected.png)).toBe(true)
  }, 30000)

  it("draws the mono family as a bare high-contrast OUTLINE: no satin fill, age-mono contour, adaptive ink", async () => {
    const fs = 17
    const boxH = badgeBoxHeight(fs)
    const strokeW = Math.max(2, Math.round(fs * AGE_MONO_STROKE_FACTOR))
    const dark = await renderQualityBadgeGroup("4K", "mono", ["imax"], 380, false, "inter")
    const light = await renderQualityBadgeGroup("4K", "mono", ["imax"], 380, true, "inter")
    expect(dark).not.toBeNull()
    expect(light).not.toBeNull()
    // Same geometry for both polarities: ink flips, the frame never moves.
    expect([light!.w, light!.h]).toEqual([dark!.w, dark!.h])
    expect(light!.items.map((i) => `${i.left}:${i.top}:${i.w}:${i.h}`))
      .toEqual(dark!.items.map((i) => `${i.left}:${i.top}:${i.w}:${i.h}`))
    // Every item (tier frame and A/V frame) uses the common band height.
    for (const item of dark!.items) expect(item.h - PAD * 2, item.id).toBe(boxH)

    const darkRaw = await rawPixels(dark!.png)
    const lightRaw = await rawPixels(light!.png)
    for (const [raw, group, tag, edgeInk] of [
      [darkRaw, dark!, "dark top", "light"],
      [lightRaw, light!, "light top", "dark"],
    ] as const) {
      for (const item of group.items) {
        const left = item.left + PAD
        const top = item.top + PAD
        const midY = top + Math.round(boxH / 2)
        // Outline stroke: opaque ink exactly on the vertical edge centre…
        const edge = pixelAt(raw, left + Math.max(1, Math.round(strokeW / 2)), midY)
        expect(edge.a, `${tag}/${item.id} frame alpha`).toBeGreaterThan(200)
        if (edgeInk === "light") expect(luma(edge), `${tag}/${item.id} white ink`).toBeGreaterThan(200)
        else expect(luma(edge), `${tag}/${item.id} black ink`).toBeLessThan(40)
        // …rounded contour (age mono radius): the box corner stays clear.
        expect(pixelAt(raw, left + 1, top + 1).a, `${tag}/${item.id} corner`).toBeLessThan(20)
        // NO plate/fill: above the glyph the frame interior carries only the
        // soft 3D shadow (a satin pill or dark plate would be near-opaque).
        const interior = pixelAt(raw, left + Math.round((item.w - PAD * 2) / 2), top + 7)
        expect(interior.a, `${tag}/${item.id} hollow`).toBeLessThan(120)
      }
    }
    // Same column, satin pill: the A/V plate is genuinely FILLED (the mono
    // frame is not) — the two families stay visually distinct.
    const standard = await renderQualityBadgeGroup("4K", "standard", ["imax"], 380, false, "inter")
    const standardMark = standard!.items[1]
    const standardInterior = pixelAt(
      await rawPixels(standard!.png),
      standardMark.left + PAD + Math.round(STANDARD_REF_W / 2),
      standardMark.top + PAD + 7,
    )
    expect(standardInterior.a, "filled satin pill").toBeGreaterThan(180)
    const monoMark = dark!.items[1]
    const monoInterior = pixelAt(darkRaw, monoMark.left + PAD + Math.round(MONO_REF_W / 2), monoMark.top + PAD + 7)
    expect(monoInterior.a, "hollow mono frame").toBeLessThan(120)
  }, 60000)

  it("frames standard A/V marks with the same satin PILL as the tier/age (full radius, adaptive polarity)", async () => {
    const fs = 17
    const boxH = badgeBoxHeight(fs)
    const dark = await renderQualityBadgeGroup("4K", "standard", ["imax"], 380, false, "inter")
    const light = await renderQualityBadgeGroup("4K", "standard", ["imax"], 380, true, "inter")
    expect(dark).not.toBeNull()
    expect(light).not.toBeNull()
    // One visible column: the A/V mark is a full satin pill, not a bare
    // wordmark — same width AND same band height as the tier/age pill.
    for (const group of [dark!, light!]) {
      expect(group.items.map((i) => i.w - PAD * 2)).toEqual([STANDARD_REF_W, STANDARD_REF_W])
      expect(group.items.map((i) => i.h - PAD * 2)).toEqual([boxH, boxH])
    }
    const mark = dark!.items[1]
    const darkRaw = await rawPixels(dark!.png)
    const lightRaw = await rawPixels(light!.png)
    const left = mark.left + PAD
    const top = mark.top + PAD
    // Satin fill present and polarity-adaptive (tier/age pill rule). IMAX is
    // short, so the sample sits above the glyph while staying inside the pill.
    const darkFill = pixelAt(darkRaw, left + Math.round(STANDARD_REF_W / 2), top + 5)
    const lightFill = pixelAt(lightRaw, left + Math.round(STANDARD_REF_W / 2), top + 5)
    expect(darkFill.a, "dark top plate alpha").toBeGreaterThan(150)
    expect(luma(darkFill), "dark top plate").toBeGreaterThan(190)
    expect(lightFill.a, "light top plate alpha").toBeGreaterThan(150)
    expect(luma(lightFill), "light top plate").toBeLessThan(80)
    // Full-pill contour: the top row enters the plate late (rx = boxH/2 arc),
    // while a contained 0.30 × boxH plate would start at ~6px on the same row.
    const firstOpaqueX = (raw: RawRgba) => {
      for (let x = 0; x < STANDARD_REF_W; x++) {
        if (pixelAt(raw, left + x, top + 1).a > 150) return x
      }
      return STANDARD_REF_W
    }
    expect(firstOpaqueX(darkRaw), "full-pill corner arc").toBeGreaterThanOrEqual(8)
    // Glyph ink polarity inside the frame (same adaptive rule).
    const glyphInk = (raw: RawRgba) => {
      let darkInk = 0
      let lightInk = 0
      for (let y = top + 2; y < top + boxH - 2; y++) {
        for (let x = left + 2; x < left + STANDARD_REF_W - 2; x++) {
          const p = pixelAt(raw, x, y)
          if (p.a < 200) continue
          if (luma(p) < 70) darkInk++
          if (luma(p) > 200) lightInk++
        }
      }
      return { darkInk, lightInk }
    }
    const darkPolarity = glyphInk(darkRaw)
    const lightPolarity = glyphInk(lightRaw)
    expect(darkPolarity.darkInk, "dark glyph on light pill").toBeGreaterThan(20)
    expect(lightPolarity.lightInk, "light glyph on dark pill").toBeGreaterThan(20)
  }, 60000)

  it("keeps the native glyph aspect inside every frame (plate, satin pill, mono outline)", () => {
    const fs = 17
    const boxH = badgeBoxHeight(fs)
    for (const fmt of ["dv", "atmos", "hdr", "hdr10plus", "imax"] as const) {
      const ink = avMarkInkBox(FORMAT_ICON_PATHS[fmt])!
      for (const frameW of [STANDARD_REF_W, MONO_REF_W]) {
        const glyph = avPlateGlyphBox(ink, frameW, boxH, fs)
        // Aspect from the asset: the glyph shrinks, never stretches to the
        // band (integer rounding of the frame keeps this within a few %).
        expect(
          Math.abs(glyph.w / glyph.h - ink.w / ink.h) / (ink.w / ink.h),
          `${fmt}/${frameW} aspect`,
        ).toBeLessThan(0.08)
        // Inside the frame with the shared inset (no additive padding).
        expect(glyph.w, `${fmt}/${frameW} width`).toBeLessThan(frameW)
        expect(glyph.h, `${fmt}/${frameW} height`).toBeLessThanOrEqual(Math.round(boxH * AV_PLATE_GLYPH_HEIGHT_FACTOR))
        // Centred in the frame (h alignment of the column).
        expect(Math.abs(glyph.x - (frameW - glyph.w) / 2), `${fmt}/${frameW} cx`).toBeLessThanOrEqual(1)
        expect(Math.abs(glyph.y - (boxH - glyph.h) / 2), `${fmt}/${frameW} cy`).toBeLessThanOrEqual(1)
      }
    }
    // Frame radius is the age mono one (0.30 × boxH), not the satin full pill.
    expect(Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)).toBeLessThan(Math.round(boxH / 2))
  })
})
