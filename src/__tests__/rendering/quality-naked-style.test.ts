import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import {
  badgeBoxHeight,
  TOP_SHADOW_PAD,
  buildQualityBadgeSvg,
  buildQualityNakedSvg,
  QUALITY_NAKED_INK_LIGHT,
  QUALITY_NAKED_INK_DARK,
  QUALITY_NAKED_SHADOW_FILTER,
} from "@/lib/badge-svg-shared"
import { renderQualityBadge, renderQualityNakedBadge } from "@/lib/svg-badge"
import { renderQualityBadgeGroup } from "@/lib/poster-service"
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_COMBO, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"
import type { AgeBadgeStyle } from "@/lib/badge-styles"
import type { VideoFormat } from "@/lib/av-specs"

const PW = 380
/** Same 17px base as `renderQualityBadge`/`renderQualityNakedBadge` at 380w. */
const FS = Math.round(Math.max(17 * PW / 380, 10))
/** `naked` group optical enlargement at 380w: base font 17 → 19 (+12.5%). */
const NAKED_FS = 19

async function rawPng(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, info }
}

function alphaAt(
  data: Buffer,
  info: { width: number; channels: number },
  x: number,
  y: number,
): number {
  return data[(y * info.width + x) * info.channels + 3]
}

/**
 * `naked` quality style: the whole group is plate-less. The tier is the
 * standard text box with the satin pill removed; the default age pill reuses
 * the same builder; A/V marks use the existing bare ink path. Acceptance:
 * identical geometry where it is shared (tier/age w/h, group column, layout),
 * different bytes, no pill rect (transparent where the standard pill is
 * opaque), polarity-aware ink with a LIGHT shadow behind it and NO stroke
 * halo/border, no plate for A/V, and an explicit non-standard age style stays
 * independent.
 */
describe("quality badge style `naked` — builder geometry and material", () => {
  it("keeps the standard box geometry (natural and pinned column width)", () => {
    const standardNatural = buildQualityBadgeSvg("4K", FS, "", "", false, "inter")
    const nakedNatural = buildQualityNakedSvg("4K", FS, false, "inter")
    expect([nakedNatural.w, nakedNatural.h]).toEqual([standardNatural.w, standardNatural.h])

    // Group column width = visible 4K box of the standard pill.
    const columnW = standardNatural.w - TOP_SHADOW_PAD * 2
    for (const label of ["4K", "FHD", "HD", "SD"]) {
      const standard = buildQualityBadgeSvg(label, FS, "", "", false, "inter", columnW)
      const naked = buildQualityNakedSvg(label, FS, false, "inter", columnW)
      expect([naked.w, naked.h], label).toEqual([standard.w, standard.h])
      // Same shared band height for every label.
      expect(naked.h, label).toBe(badgeBoxHeight(FS) + TOP_SHADOW_PAD * 2)
    }
  })

  it("removes the pill (rect/gradient/stroke) and keeps one ink pass with a light shadow", () => {
    const { svg } = buildQualityNakedSvg("4K", FS, false, "inter")
    // No container paint: no plate rect, no satin gradient, no pill stroke.
    expect(svg).not.toContain("<rect")
    expect(svg).not.toContain("linearGradient")
    expect(svg).not.toContain("stroke-width=\"1.5\"")
    // No stroke halo/border: the glyphs are a single filled pass.
    expect(svg.match(/<text /g)).toHaveLength(1)
    expect(svg).not.toMatch(/<text[^>]*\sstroke=/)
    expect(svg).not.toContain('fill="none"')
    // One LIGHT shadow behind the ink (never the heavy plate shadow).
    expect(svg).toContain('<g filter="url(#qks)">')
    expect(svg).toContain(QUALITY_NAKED_SHADOW_FILTER)
    expect(svg).toMatch(/<feDropShadow dx="0" dy="1" stdDeviation="2"[^>]*flood-opacity="0\.35"/)
    expect(svg).not.toContain('filter="url(#tds)"')
  })

  it("inverts the ink against the background polarity without any halo border", () => {
    const darkTop = buildQualityNakedSvg("4K", FS, false, "inter")
    const lightTop = buildQualityNakedSvg("4K", FS, true, "inter")

    // Dark top: white glyphs, no border stroke.
    expect(darkTop.svg).toContain(`fill="${QUALITY_NAKED_INK_DARK}"`)
    // Light top: black glyphs, no border stroke.
    expect(lightTop.svg).toContain(`fill="${QUALITY_NAKED_INK_LIGHT}"`)
    for (const built of [darkTop, lightTop]) {
      expect(built.svg).not.toContain('stroke="rgba(')
      // No satin gradient ink leaks into this style.
      expect(built.svg).not.toContain("url(#qg)")
      expect(built.svg).toContain('filter="url(#qks)"')
    }
    expect(darkTop.svg.match(/<text /g)).toHaveLength(1)
    expect(lightTop.svg.match(/<text /g)).toHaveLength(1)
  })
})

describe("quality badge style `naked` — raster output", () => {
  it("renders the same canvas as standard, different bytes, no pill pixels", async () => {
    const standard = await renderQualityBadge("4K", PW, false, "inter")
    const naked = await renderQualityNakedBadge("4K", PW, false, "inter")

    expect([naked.w, naked.h]).toEqual([standard.w, standard.h])
    expect(naked.png.equals(standard.png)).toBe(false)

    // Sample a point inside the standard pill's left padding (middle band):
    // satin pill paint there (translucent stops, never fully transparent),
    // fully transparent for the naked tier (only the glyph ink and its light
    // shadow paint, never a plate or a halo).
    const boxH = badgeBoxHeight(FS)
    const probeX = TOP_SHADOW_PAD + 2
    const probeY = TOP_SHADOW_PAD + Math.round(boxH / 2)
    const standardRaw = await rawPng(standard.png)
    const nakedRaw = await rawPng(naked.png)
    expect(alphaAt(standardRaw.data, standardRaw.info, probeX, probeY)).toBeGreaterThan(100)
    expect(alphaAt(nakedRaw.data, nakedRaw.info, probeX, probeY)).toBe(0)
    // No border/halo reaches the bitmap corner (transparent box corners).
    expect(alphaAt(nakedRaw.data, nakedRaw.info, 0, 0)).toBe(0)

    // The glyphs ARE painted (visible ink pixels inside the box).
    let painted = 0
    for (let i = 3; i < nakedRaw.data.length; i += nakedRaw.info.channels) {
      if (nakedRaw.data[i] > 0) painted++
    }
    expect(painted).toBeGreaterThan(50)
  })

  it("paints dark ink on a light top and light ink on a dark top", async () => {
    const paintedLuma = async (png: Buffer) => {
      const { data, info } = await rawPng(png)
      let sum = 0
      let count = 0
      for (let i = 0; i < data.length; i += info.channels) {
        const alpha = data[i + 3]
        // Fully painted ink pixels only: excludes the light shadow tail.
        if (alpha < 250) continue
        sum += data[i] + data[i + 1] + data[i + 2]
        count++
      }
      expect(count).toBeGreaterThan(50)
      return sum / count
    }
    const darkTop = await paintedLuma((await renderQualityNakedBadge("4K", PW, false, "inter")).png)
    const lightTop = await paintedLuma((await renderQualityNakedBadge("4K", PW, true, "inter")).png)
    // White ink on a dark top is brighter than black ink on a light top.
    expect(darkTop).toBeGreaterThan(lightTop)
  })
})

describe("quality badge style `naked` — quality group integration (full group)", () => {
  type TransformMap = Readonly<Record<string, { scale: number; offsetX: number; offsetY: number }>>
  const renderGroup = (
    style: "standard" | "naked",
    options: {
      itemTransforms?: TransformMap
      ageStyle?: AgeBadgeStyle
      formats?: readonly VideoFormat[]
    } = {},
  ) =>
    renderQualityBadgeGroup(
      "4K",
      style,
      options.formats ?? ["imax"],
      PW,
      false,
      "inter",
      "VM14",
      options.ageStyle ?? "standard",
      options.itemTransforms,
    )

  const byId = (group: NonNullable<Awaited<ReturnType<typeof renderGroup>>>, id: string | null) => {
    const found = group.items.find((item) => item.id === id)
    expect(found, String(id)).toBeTruthy()
    return found!
  }

  it("paints the whole group plate-less: enlarged column, bare A/V with aspect height", async () => {
    const standard = await renderGroup("standard")
    const naked = await renderGroup("naked")
    expect(standard).not.toBeNull()
    expect(naked).not.toBeNull()

    // `naked` optically enlarges the WHOLE group (nominal +12.5%, integer base
    // font 17 → 19 at pw=380): the shared column, the tier/age text boxes and
    // therefore every A/V mark that normalizes to the column grow together.
    // The paint order and the anchor X do not move.
    expect(naked!.w).toBe(81)
    expect(standard!.w).toBe(76)
    expect(naked!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      qualityFormatItemId("imax"),
    ])
    for (const id of [BADGE_ITEM_QUALITY_TIER, BADGE_ITEM_QUALITY_AGE]) {
      const injected = byId(naked!, id)
      const original = byId(standard!, id)
      expect([injected.w, injected.h], String(id)).toEqual([81, 63])
      expect([original.w, original.h], String(id)).toEqual([76, 59])
      expect(injected.left, String(id)).toBe(original.left)
    }
    // Optical-gap pitch: the plate-less style advances by each mark's visible
    // INK band (text cap for tier/age, bare bitmap band for A/V) plus one
    // scaled 6px gap, not by the full text box. The tier text box carries
    // ~10px of dead padding per side, so the age pill sits at top 21 (was 36).
    expect(byId(naked!, BADGE_ITEM_QUALITY_TIER).top).toBe(0)
    expect(byId(naked!, BADGE_ITEM_QUALITY_AGE).top).toBe(21)

    // A/V mark: same anchor X, visible width pinned to the (larger) column, but
    // the bare ink keeps the asset aspect → honestly SHORTER than the text
    // box (38 vs 63). It follows the age ink band at the same 6px optical gap
    // (top 52, was 72 by visible-box pitch), and the canvas shrinks.
    const avId = qualityFormatItemId("imax")
    const avNaked = byId(naked!, avId)
    const avStandard = byId(standard!, avId)
    expect(avNaked.left).toBe(avStandard.left)
    expect(avNaked.w).toBe(81)
    expect(avStandard.w).toBe(76)
    expect(avNaked.h).toBeLessThan(avStandard.h)
    expect(avNaked.h).toBe(38)
    expect(avNaked.top).toBe(52)
    expect(naked!.h).toBe(90)
    expect(standard!.h).toBe(131)
    expect(naked!.png.equals(standard!.png)).toBe(false)
  })

  it("uses one uniform optical gap across a representative full stack", async () => {
    const formats: readonly VideoFormat[] = ["dv", "atmos", "imax", "hdr10plus"]
    const standard = await renderGroup("standard", { formats })
    const naked = await renderGroup("naked", { formats })
    expect(standard).not.toBeNull()
    expect(naked).not.toBeNull()

    expect(naked!.w).toBe(81)
    expect(standard!.w).toBe(76)
    expect(naked!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
      qualityFormatItemId("hdr10plus"),
    ])
    // The enlarged group scales tier/age text boxes (81×63 vs 76×59) and the
    // pinned column; A/V marks keep the pinned visible width but the bare ink
    // is honestly shorter than the framed standard one. Only the pitch moves
    // for the A/V marks.
    for (const id of [BADGE_ITEM_QUALITY_TIER, BADGE_ITEM_QUALITY_AGE]) {
      const injected = byId(naked!, id)
      const original = byId(standard!, id)
      expect([injected.w, injected.h], String(id)).toEqual([81, 63])
      expect([original.w, original.h], String(id)).toEqual([76, 59])
      expect(injected.left, String(id)).toBe(original.left)
    }
    for (const id of [BADGE_ITEM_QUALITY_COMBO, qualityFormatItemId("imax"), qualityFormatItemId("hdr10plus")]) {
      const injected = byId(naked!, id)
      const original = byId(standard!, id)
      expect(injected.w, String(id)).toBe(81)
      expect(original.w, String(id)).toBe(76)
      expect(injected.h, String(id)).toBeLessThan(original.h)
      expect(injected.left, String(id)).toBe(original.left)
    }

    // Visible tops follow the approved enlarged naked pitch:
    // 0 / 21 / 52 / 73 / 89, i.e. every pair of neighbours is separated by the
    // SAME scaled 6px optical gap after each mark's real ink band.
    const tops = naked!.items.map((item) => item.top)
    expect(tops).toEqual([0, 21, 52, 73, 89])
    expect(naked!.h).toBe(128)
    expect(standard!.h).toBe(203)
    expect(naked!.h).toBeLessThan(standard!.h)
    expect(naked!.png.equals(standard!.png)).toBe(false)
  })

  it("renders the default age pill and the A/V mark with no plate pixels", async () => {
    // Non-neutral identity corrections detach the age pill / A/V mark so their
    // own bitmaps are returned and can be compared pixel-by-pixel.
    const itemTransforms = {
      [BADGE_ITEM_QUALITY_AGE]: { scale: 100, offsetX: 7, offsetY: 0 },
      [String(qualityFormatItemId("imax"))]: { scale: 100, offsetX: 0, offsetY: 7 },
    }
    const standard = await renderGroup("standard", { itemTransforms })
    const naked = await renderGroup("naked", { itemTransforms })
    expect(standard).not.toBeNull()
    expect(naked).not.toBeNull()

    // Age pill: the naked group is optically enlarged, so the box is larger
    // (81×63 vs 76×59) and the material differs (naked = ink + light shadow,
    // no pill).
    const ageStandard = byId(standard!, BADGE_ITEM_QUALITY_AGE)
    const ageNaked = byId(naked!, BADGE_ITEM_QUALITY_AGE)
    expect(ageStandard.png).toBeTruthy()
    expect(ageNaked.png).toBeTruthy()
    expect([ageNaked.w, ageNaked.h]).toEqual([81, 63])
    expect([ageStandard.w, ageStandard.h]).toEqual([76, 59])
    expect(ageNaked.png!.equals(ageStandard.png!)).toBe(false)

    const boxH = badgeBoxHeight(NAKED_FS)
    const probeY = TOP_SHADOW_PAD + 3 // inside the pill, above any glyph ink
    const ageStandardRaw = await rawPng(ageStandard.png!)
    const ageNakedRaw = await rawPng(ageNaked.png!)
    const ageProbeX = TOP_SHADOW_PAD + Math.round((ageStandard.w - TOP_SHADOW_PAD * 2) / 2)
    expect(alphaAt(ageStandardRaw.data, ageStandardRaw.info, ageProbeX, probeY)).toBeGreaterThan(100)
    expect(alphaAt(ageNakedRaw.data, ageNakedRaw.info, ageProbeX, probeY)).toBe(0)
    // Box corners of the naked bitmap are fully transparent: no plate at all.
    expect(alphaAt(ageNakedRaw.data, ageNakedRaw.info, 0, 0)).toBe(0)
    expect(ageNaked.h).toBe(boxH + TOP_SHADOW_PAD * 2)

    // A/V mark: larger pinned width, bare aspect height, no frame rect.
    const avId = String(qualityFormatItemId("imax"))
    const avStandard = byId(standard!, avId)
    const avNaked = byId(naked!, avId)
    expect(avStandard.png).toBeTruthy()
    expect(avNaked.png).toBeTruthy()
    expect(avNaked.png!.equals(avStandard.png!)).toBe(false)
    expect(avNaked.w).toBe(81)
    expect(avStandard.w).toBe(76)
    expect(avNaked.h).toBeLessThan(avStandard.h)
    const avStandardRaw = await rawPng(avStandard.png!)
    const avNakedRaw = await rawPng(avNaked.png!)
    const opaque = (raw: Awaited<ReturnType<typeof rawPng>>) => {
      let count = 0
      for (let i = 3; i < raw.data.length; i += raw.info.channels) if (raw.data[i] > 100) count++
      return count
    }
    // The standard frame is a filled satin plate (most of the box is painted);
    // the naked mark paints only its thin bare glyph band and its shadow.
    expect(opaque(avStandardRaw)).toBeGreaterThan(1000)
    expect(opaque(avNakedRaw)).toBeGreaterThan(80)
    expect(opaque(avNakedRaw)).toBeLessThan(opaque(avStandardRaw) / 2)
    expect(alphaAt(avNakedRaw.data, avNakedRaw.info, 0, 0)).toBe(0)
  })

  it("keeps an explicit non-standard age style independent of the quality style", async () => {
    const itemTransforms = {
      [BADGE_ITEM_QUALITY_AGE]: { scale: 100, offsetX: 7, offsetY: 0 },
    }
    const standard = await renderGroup("standard", { itemTransforms, ageStyle: "mono" })
    const naked = await renderGroup("naked", { itemTransforms, ageStyle: "mono" })
    expect(standard).not.toBeNull()
    expect(naked).not.toBeNull()

    const ageStandard = byId(standard!, BADGE_ITEM_QUALITY_AGE)
    const ageNaked = byId(naked!, BADGE_ITEM_QUALITY_AGE)
    expect(ageStandard.png).toBeTruthy()
    expect(ageNaked.png).toBeTruthy()
    // Explicit `agebs=mono` wins over `qbs=naked`: the SAME mono material at
    // the two group scales (81×63 vs 76×59), so bytes differ by size only.
    expect([ageNaked.w, ageNaked.h]).toEqual([81, 63])
    expect([ageStandard.w, ageStandard.h]).toEqual([76, 59])
    expect(ageNaked.png!.equals(ageStandard.png!)).toBe(false)

    const monoMaterial = async (png: Buffer) => {
      const raw = await rawPng(png)
      let maxAlpha = 0
      let painted = 0
      for (let i = 3; i < raw.data.length; i += raw.info.channels) {
        if (raw.data[i] > 0) painted++
        if (raw.data[i] > maxAlpha) maxAlpha = raw.data[i]
      }
      return { raw, maxAlpha, painted }
    }
    const nakedMono = await monoMaterial(ageNaked.png!)
    const standardMono = await monoMaterial(ageStandard.png!)
    for (const stats of [nakedMono, standardMono]) {
      // Opaque frame/glyph ink over a fully transparent background — the mono
      // material, never a satin plate or a naked text-only box.
      expect(stats.maxAlpha).toBe(255)
      expect(stats.painted).toBeGreaterThan(100)
      expect(alphaAt(stats.raw.data, stats.raw.info, 0, 0)).toBe(0)
      // The mono frame paints the box edge inset; a naked text box keeps that
      // area as dead transparent padding.
      expect(alphaAt(stats.raw.data, stats.raw.info, TOP_SHADOW_PAD + 3, TOP_SHADOW_PAD + 3)).toBeGreaterThan(50)
    }
  })
})

describe("quality badge style `naked` — transport", () => {
  it("is accepted by the instance env default gate (PICTORIUM_QUALITY_BADGE_STYLE)", async () => {
    vi.resetModules()
    const previous = process.env.PICTORIUM_QUALITY_BADGE_STYLE
    process.env.PICTORIUM_QUALITY_BADGE_STYLE = "naked"
    try {
      const mod = await import("@/lib/server-defaults")
      expect(mod.getInstanceEnvDefaults().qualityBadgeStyle).toBe("naked")
    } finally {
      if (previous === undefined) delete process.env.PICTORIUM_QUALITY_BADGE_STYLE
      else process.env.PICTORIUM_QUALITY_BADGE_STYLE = previous
      vi.resetModules()
    }
  })
})
