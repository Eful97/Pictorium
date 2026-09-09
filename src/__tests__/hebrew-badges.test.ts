import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { buildExtraDefaultSvg, buildGenreTextSvg, fontFamilyFor } from "@/lib/badge-svg-shared"
import { buildExtraBadgeSVG, buildGenreBadgeSVG, buildNetflixRankBadgeSVG, renderSVG } from "@/lib/svg-badge"

/** Pixel "accesi" e loro estensione orizzontale: un badge con glifi mancanti
 *  esce vuoto (0 pixel) oppure pieno di tofu (rettangoli, molto più inchiostro). */
async function ink(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  let minX = info.width
  let maxX = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        count++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
  }
  return { count, minX, maxX, width: info.width }
}

describe("fontFamilyFor", () => {
  it("keeps Inter for Latin text so the SVG stays byte-identical", () => {
    expect(fontFamilyFor("New season")).toBe("Inter")
    expect(fontFamilyFor("4K")).toBe("Inter")
    expect(fontFamilyFor("")).toBe("Inter")
  })

  it("declares Rubik as soon as the text contains Hebrew", () => {
    // Il fallback per-glifo di resvg troverebbe comunque i glifi, ma ignora il
    // peso richiesto: senza famiglia esplicita un badge bold uscirebbe regular.
    expect(fontFamilyFor("עונה חדשה")).toBe("Rubik")
    expect(fontFamilyFor("עונה חדשה 3")).toBe("Rubik")
  })

  it("emits the declared family into the badge SVG", () => {
    expect(buildExtraDefaultSvg("New season", 20, "#fff", "#333").svg).toContain('font-family="Inter"')
    expect(buildExtraDefaultSvg("עונה חדשה", 20, "#fff", "#333").svg).toContain('font-family="Rubik"')
    expect(buildGenreTextSvg("אקשן", "8.0", "2022", 63, "#e5e7eb", "shadow").svg).toContain('font-family="Rubik"')
  })
})

describe("Hebrew badge rasterisation", () => {
  it("renders Hebrew glyphs in the extra badge", async () => {
    const he = await buildExtraBadgeSVG("עונה חדשה", 380, false, "default", "#D4A574")
    expect(he).not.toBeNull()
    const bounds = await ink(he!.png)
    expect(bounds.count).toBeGreaterThan(0)
    // Il testo sta dentro la pill e non è schiacciato su un bordo.
    expect(bounds.minX).toBeGreaterThan(0)
    expect(bounds.maxX).toBeLessThan(bounds.width - 1)
  })

  it("renders a Hebrew genre name next to Latin rating and year", async () => {
    const he = await buildGenreBadgeSVG("אקשן", 8.2, 380, "2019", "shadow", "#D4A574", false)
    expect(he).not.toBeNull()
    expect((await ink(he!.png)).count).toBeGreaterThan(0)
  })

  it("renders a Hebrew sub-label on the Netflix ribbon", async () => {
    const { svg, w } = buildNetflixRankBadgeSVG(3, 380, false, "left", false, "היום")
    expect(svg).toContain('font-family="Rubik"')
    expect((await ink(await renderSVG(svg, w))).count).toBeGreaterThan(0)
  })

  it("sizes a Hebrew pill from its own advance widths, not the Latin default", async () => {
    // charWidthFactor tratta l'ebraico a 0.55: col vecchio default 0.62 la
    // stima sforava e `lengthAdjust="spacingAndGlyphs"` allargava i glifi.
    const he = await buildExtraBadgeSVG("עונה חדשה", 380, false, "default", "#D4A574")
    const bounds = await ink(he!.png)
    const inkWidth = bounds.maxX - bounds.minX + 1
    expect(inkWidth).toBeGreaterThan(bounds.width * 0.5)
    expect(inkWidth).toBeLessThan(bounds.width)
  })
})
