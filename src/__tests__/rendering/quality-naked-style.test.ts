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
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"
import type { AgeBadgeStyle } from "@/lib/badge-styles"
import type { VideoFormat } from "@/lib/av-specs"

const PW = 380
/** Same 17px base as `renderQualityBadge`/`renderQualityNakedBadge` at 380w. */
const FS = Math.round(Math.max(17 * PW / 380, 10))

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

  it("paints the whole group plate-less: same column/anchors, bare A/V with aspect height", async () => {
    const standard = await renderGroup("standard")
    const naked = await renderGroup("naked")
    expect(standard).not.toBeNull()
    expect(naked).not.toBeNull()

    // The common column and the paint order are unchanged: the tier and the
    // age pill keep the STANDARD box (same builder geometry), so group width
    // does not move.
    expect(naked!.w).toBe(standard!.w)
    expect(naked!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      qualityFormatItemId("imax"),
    ])
    for (const id of [BADGE_ITEM_QUALITY_TIER, BADGE_ITEM_QUALITY_AGE]) {
      expect(byId(naked!, id)).toEqual(byId(standard!, id)) // identical box, no png
    }

    // A/V mark: same anchor and visible width (pinned to the column), but the
    // bare ink keeps the asset aspect → honestly SHORTER than the text box.
    // Never stretched to equal height, so the canvas shrinks by exactly that
    // delta (single-column stack).
    const avId = qualityFormatItemId("imax")
    const avNaked = byId(naked!, avId)
    const avStandard = byId(standard!, avId)
    expect(avNaked.left).toBe(avStandard.left)
    expect(avNaked.top).toBe(avStandard.top)
    expect(avNaked.w).toBe(avStandard.w)
    expect(avNaked.h).toBeLessThan(avStandard.h)
    expect(naked!.h).toBe(standard!.h - (avStandard.h - avNaked.h))
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

    // Age pill: same box, different material (naked = ink + light shadow, no pill).
    const ageStandard = byId(standard!, BADGE_ITEM_QUALITY_AGE)
    const ageNaked = byId(naked!, BADGE_ITEM_QUALITY_AGE)
    expect(ageStandard.png).toBeTruthy()
    expect(ageNaked.png).toBeTruthy()
    expect([ageNaked.w, ageNaked.h]).toEqual([ageStandard.w, ageStandard.h])
    expect(ageNaked.png!.equals(ageStandard.png!)).toBe(false)

    const boxH = badgeBoxHeight(FS)
    const probeY = TOP_SHADOW_PAD + 3 // inside the pill, above any glyph ink
    const ageStandardRaw = await rawPng(ageStandard.png!)
    const ageNakedRaw = await rawPng(ageNaked.png!)
    const ageProbeX = TOP_SHADOW_PAD + Math.round((ageStandard.w - TOP_SHADOW_PAD * 2) / 2)
    expect(alphaAt(ageStandardRaw.data, ageStandardRaw.info, ageProbeX, probeY)).toBeGreaterThan(100)
    expect(alphaAt(ageNakedRaw.data, ageNakedRaw.info, ageProbeX, probeY)).toBe(0)
    // Box corners of the naked bitmap are fully transparent: no plate at all.
    expect(alphaAt(ageNakedRaw.data, ageNakedRaw.info, 0, 0)).toBe(0)
    expect(ageNaked.h).toBe(boxH + TOP_SHADOW_PAD * 2)

    // A/V mark: same width, bare aspect height, no frame rect.
    const avId = String(qualityFormatItemId("imax"))
    const avStandard = byId(standard!, avId)
    const avNaked = byId(naked!, avId)
    expect(avStandard.png).toBeTruthy()
    expect(avNaked.png).toBeTruthy()
    expect(avNaked.png!.equals(avStandard.png!)).toBe(false)
    expect(avNaked.w).toBe(avStandard.w)
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
    // Explicit `agebs=mono` wins over `qbs=naked`: identical material/bytes.
    expect(ageNaked.png!.equals(ageStandard.png!)).toBe(true)
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
