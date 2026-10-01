import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { buildGenrePillSvg, buildGenreTextSvg, buildGenreBarSvg, buildRankingDefaultSvg, buildExtraDefaultSvg, buildQualityBadgeSvg, glassStops, satinPillStops, buildGenreGlassSvg, buildGenreBorderedSvg, buildRankingGlassSvg, buildRankingBorderedSvg, buildExtraBorderedSvg, buildHouseRankingSvg } from "@/lib/badge-svg-shared"
import { buildGenreBadgeSVG, buildRankingBadgeSVG, buildExtraBadgeSVG, buildNetflixRankBadgeSVG, renderComingSoonRibbon, comingSoonRibbonLayout } from "@/lib/svg-badge"

async function alphaBounds(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let maxX = -1

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3]
      if (alpha && alpha > 10) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
  }

  return { minX, maxX, width: info.width }
}

/**
 * Conta i pixel scuri e coprenti nella fascia centrale del badge.
 * I badge traslucidi (vetro/bordo) hanno testo sempre chiaro: qualsiasi pixel
 * scuro lì dentro è un glifo scuro, cioè il bug (testo scuro su vetro/fumé).
 * I margini laterali sono esclusi: il bordo 2px è scuro per disegno sul top
 * chiaro, il testo sta sempre al centro (padding >= 0.75*fs).
 */
async function darkPixelCount(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  const y0 = Math.floor(info.height * 0.3), y1 = Math.ceil(info.height * 0.7)
  const x0 = 8, x1 = info.width - 8
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60 && data[i + 3] > 100) n++
    }
  }
  return n
}

describe("ranking ribbon labels", () => {
  it("omits media labels on ranking ribbons without ribbonLabel, including anime", async () => {
    for (const style of ["netflix", "colored"] as const) {
      for (const side of ["left", "right"] as const) {
        const plain = await buildRankingBadgeSVG(3, 380, "", false, style, "#e50914", side)
        for (const label of ["Film", "Serie TV", "Anime"]) {
          const badge = await buildRankingBadgeSVG(3, 380, label, false, style, "#e50914", side, label === "Anime")
          expect(badge).toEqual(plain)
        }
        expect(plain!.h).toBe(buildNetflixRankBadgeSVG(3, 380, false, side, false, "Film").h)
      }
    }
  })

  it("shows the period subtitle on ranking ribbons when ribbonLabel is set", async () => {
    for (const style of ["netflix", "colored"] as const) {
      for (const side of ["left", "right"] as const) {
        // La label per media type resta ignorata: conta solo ribbonLabel.
        const badge = await buildRankingBadgeSVG(3, 380, "Film", false, style, "#e50914", side, false, false, false, "Oggi")
        const plain = await buildRankingBadgeSVG(3, 380, "", false, style, "#e50914", side)
        expect(badge).not.toBeNull()
        expect(badge!.png).not.toEqual(plain!.png)
        expect(badge!.h).toBe(plain!.h)
        // Contenuto verificato sul builder sincrono (stessa ricetta).
        const { svg } = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style })
        expect(svg).toContain(">TOP<")
        expect(svg).toContain(">Oggi<")
        expect(svg).not.toContain(">Film<")
      }
    }
  })

  it("shows the period subtitle on anime ribbons too", async () => {
    const badge = await buildRankingBadgeSVG(1, 380, "Anime", false, "netflix", "#e50914", "left", true, false, false, "Oggi")
    const plain = await buildRankingBadgeSVG(1, 380, "Anime", false, "netflix", "#e50914", "left", true)
    expect(badge).not.toBeNull()
    expect(badge!.png).not.toEqual(plain!.png)
    const { svg } = buildHouseRankingSvg({ rank: 1, label: "Oggi", pw: 380, style: "netflix", isAnime: true })
    expect(svg).toContain(">TOP<")
    expect(svg).toContain(">Oggi<")
    expect(svg).not.toContain(">Anime<")
  })
})

describe("buildGenreBadgeSVG", () => {
  it("keeps genre separators in natural text flow", () => {
    const { svg } = buildGenreTextSvg("Sci-Fi & Fantasy", "8.0", "2022", 63, "#e5e7eb", "shadow")

    expect(svg).toContain("<tspan>Sci-Fi &amp; Fantasy</tspan>")
    // Bullet calibrato 0.45 (restyle cinematografico) + stella dorata con gradiente.
    expect(svg).toContain('<tspan dx="21" fill-opacity="0.45">•</tspan>')
    expect(svg).toContain('fill="url(#starg)"')
    expect(svg).toContain('text-anchor="middle"')
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"')
    expect(svg).not.toContain("Sci-Fi &amp; Fantasy</text><text")
  })

  it("uses a lighter text weight for genre/rating badges", () => {
    const { svg } = buildGenreTextSvg("Sci-Fi & Fantasy", "8.0", "2022", 63, "#e5e7eb", "shadow")

    expect(svg).toContain('font-weight="600"')
  })

  it("lowers the star symbol without shifting the rating baseline", () => {
    const fs = 63
    const starDy = Math.max(2, Math.round(fs * 0.14))
    const { svg } = buildGenreTextSvg("Fantascienza", "8.7", "2026", fs, "#e5e7eb", "shadow")

    expect(svg).toContain(`dy="${starDy}" font-family="Noto Sans Symbols 2"`)
    expect(svg).toContain(`dy="${-starDy}">8.7</tspan>`)
  })

  it("keeps long genre pill compact and centers its text flow", async () => {
    const rawPill = buildGenrePillSvg("Sci-Fi & Fantasy", "8.2", "2019", 53, "rgba(255,255,255,0.80)", "rgba(0,0,0,0.80)")
    expect(rawPill.svg).toContain('text-anchor="middle"')

    const badge = await buildGenreBadgeSVG("Sci-Fi & Fantasy", 8.2, 1000, "2019", "pill", "#555555", false)
    expect(badge).not.toBeNull()
    // 800 di contenuto + 28 di padding ombra.
    expect(badge!.w).toBeLessThan(830)
  })

  it("keeps long shadow genre badge within aesthetic width", async () => {
    const badge = await buildGenreBadgeSVG("Sci-Fi & Fantasy", 8.0, 1000, "2022", "shadow", "#555555", false)

    expect(badge).not.toBeNull()
    expect(badge!.w).toBeLessThanOrEqual(860)
  })

  it("scales bar badges natively (full-width kept, height shrinks)", async () => {
    const full = await buildGenreBadgeSVG("Dramma", 6.4, 380, undefined, "bar", "#555555", false, undefined, 100)
    const slim = await buildGenreBadgeSVG("Dramma", 6.4, 380, undefined, "bar", "#555555", false, undefined, 70)
    expect(full).not.toBeNull()
    expect(slim).not.toBeNull()
    expect(full!.w).toBe(380)
    expect(slim!.w).toBe(380)
    expect(slim!.h).toBeLessThan(full!.h)
  })

  it("ignores the scale param for non-bar styles (bitmap scaling lives in the service)", async () => {
    const a = await buildGenreBadgeSVG("Dramma", 6.4, 380, undefined, "shadow", "#555555", false, undefined, 100)
    const b = await buildGenreBadgeSVG("Dramma", 6.4, 380, undefined, "shadow", "#555555", false, undefined, 70)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b!.w).toBe(a!.w)
    expect(b!.h).toBe(a!.h)
  })

  it.each([
    ["Commedia", 8.1, "2026"],
    ["Sci-Fi & Fantasy", 8.0, "2022"],
  ])("keeps server-rendered genre text away from SVG edges for %s", async (genre, vote, year) => {
    const badge = await buildGenreBadgeSVG(genre, vote, 1000, year, "shadow", "#555555", true)
    expect(badge).not.toBeNull()

    const bounds = await alphaBounds(badge!.png)

    expect(bounds.minX).toBeGreaterThan(20)
    expect(bounds.maxX).toBeLessThan(bounds.width - 20)
  })

  it("centers the rendered genre text optically in the transparent badge", async () => {
    const badge = await buildGenreBadgeSVG("Sci-Fi & Fantasy", 8.0, 1000, "2022", "shadow", "#555555", false)
    expect(badge).not.toBeNull()

    const bounds = await alphaBounds(badge!.png)
    const leftPad = bounds.minX
    const rightPad = bounds.width - 1 - bounds.maxX

    expect(Math.abs(leftPad - rightPad)).toBeLessThanOrEqual(12)
  })

  it("uses adjustedX for text-anchor middle to compensate dx tspans", () => {
    const { svg } = buildGenreTextSvg("Azione", "7.5", "2024", 60, "#e5e7eb", "shadow")
    expect(svg).toContain('text-anchor="middle"')
    // The text element should have an x attribute with the adjustedX value
    expect(svg).toMatch(/<text[^>]*x="/)
    // adjustedX should be less than the canvas center (centerX = renderW/2, renderW > 300)
    const xVal = Number(svg.match(/<text[^>]*x="([\d.]+)"/)![1])
    expect(xVal).toBeGreaterThan(100)
    expect(xVal).toBeLessThan(500)
  })

  it("handles single-word genre with year", async () => {
    const badge = await buildGenreBadgeSVG("Azione", 7.5, 1000, "2024", "shadow", "#555555", false)
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(100)
    expect(badge!.w).toBeLessThan(900)
  })

  it("handles missing year gracefully", async () => {
    const badge = await buildGenreBadgeSVG("Commedia", 6.0, 1000, undefined, "shadow", "#555555", false)
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(0)
  })

  it("renders bar style full-width", async () => {
    const badge = await buildGenreBadgeSVG("Dramma", 8.5, 1000, "2023", "bar", "#555555", false)
    expect(badge).not.toBeNull()
    expect(badge!.w).toBe(1000)
  })

  it("renders genre bar with satin gradient, 3D shadow, adaptive 1.5px stroke", async () => {
    const { svg } = buildGenreBarSvg("Dramma", "8.5", "2023", 380, 28, "rgba(0,0,0,0.88)", false)
    expect(svg).toContain('fill="url(#gbg)"')
    expect(svg).toContain('stop-color="rgba(255,255,255,0.95)"')
    expect(svg).toContain('stroke="rgba(255,255,255,0.22)"')
    expect(svg).toContain('stroke-width="1.5"')
    expect(svg).toContain('filter="url(#tds)"')
    expect(svg).not.toContain("<line ")
    const light = buildGenreBarSvg("Dramma", "8.5", "2023", 380, 28, "rgba(255,255,255,0.95)", true)
    expect(light.svg).toContain('stroke="rgba(0,0,0,0.12)"')
    expect(light.svg).toContain('stop-color="rgba(0,0,0,0.88)"')
  })

  it("renders genre pill and quality badge with 3D shadow (satin and colored)", () => {
    const pill = buildGenrePillSvg("Dramma", "8.5", "2023", 28, "rgba(255,255,255,0.80)", "rgba(0,0,0,0.80)")
    expect(pill.svg).toContain('filter="url(#tds)"')
    const colored = buildGenrePillSvg("Dramma", "8.5", "2023", 28, "#ff6430", "#ffffff", 0, undefined, false, false)
    expect(colored.svg).toContain('fill="#ff6430"')
    expect(colored.svg).toContain('filter="url(#tds)"')
    const quality = buildQualityBadgeSvg("4K", 20, "", "", false)
    expect(quality.svg).toContain('filter="url(#tds)"')
  })

  it("star falls back to text color on warm gold accent, stays gold otherwise", () => {
    const warm = buildGenrePillSvg("Dramma", "8.5", "2023", 28, "#F59E0B", "#ffffff", 0, undefined, false, false, "#ffffff")
    expect(warm.svg).toContain('fill="#ffffff"')
    expect(warm.svg).not.toContain("url(#starg)")
    const cool = buildGenrePillSvg("Dramma", "8.5", "2023", 28, "#3b82f6", "#ffffff", 0, undefined, false, false)
    expect(cool.svg).toContain("url(#starg)")
  })
})

describe("GenreParts combinations", () => {
  it("hides genre and rating when only year is enabled", () => {
    const { svg } = buildGenreTextSvg("Dramma", "8.2", "2024", 60, "#e5e7eb", "shadow", 0, { showGenre: false, showRating: false })
    expect(svg).toContain("2024")
    expect(svg).not.toContain("Dramma")
    expect(svg).not.toContain("Noto Sans Symbols 2")
    expect(svg).not.toContain("8.2")
  })

  it("hides genre and year when only rating is enabled", () => {
    const { svg } = buildGenreTextSvg("Dramma", "8.2", "2024", 60, "#e5e7eb", "shadow", 0, { showGenre: false, showYear: false })
    expect(svg).toContain("Noto Sans Symbols 2")
    expect(svg).toContain("8.2")
    expect(svg).not.toContain("Dramma")
    expect(svg).not.toContain("2024")
  })

  it("hides rating but keeps genre and year", () => {
    const { svg } = buildGenreTextSvg("Dramma", "8.2", "2024", 60, "#e5e7eb", "shadow", 0, { showRating: false })
    expect(svg).toContain("Dramma")
    expect(svg).toContain("2024")
    expect(svg).not.toContain("Noto Sans Symbols 2")
    expect(svg).not.toContain("8.2")
  })

  it("hides genre but keeps rating and year", () => {
    const { svg } = buildGenreTextSvg("Dramma", "8.2", "2024", 60, "#e5e7eb", "shadow", 0, { showGenre: false })
    expect(svg).toContain("Noto Sans Symbols 2")
    expect(svg).toContain("8.2")
    expect(svg).toContain("2024")
    expect(svg).not.toContain("Dramma")
  })

  it("hides year and rating but keeps genre", () => {
    const { svg } = buildGenreTextSvg("Dramma", "8.2", "2024", 60, "#e5e7eb", "shadow", 0, { showYear: false, showRating: false })
    expect(svg).toContain("Dramma")
    expect(svg).not.toContain("Noto Sans Symbols 2")
    expect(svg).not.toContain("2024")
    expect(svg).not.toContain("8.2")
  })

  it("centers the only-year badge optically", async () => {
    const badge = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "shadow", "#555555", false, { showGenre: false, showRating: false })
    expect(badge).not.toBeNull()
    const bounds = await alphaBounds(badge!.png)
    expect(bounds.minX).toBeGreaterThan(20)
    expect(bounds.maxX).toBeLessThan(bounds.width - 20)
    expect(Math.abs((bounds.width - 1 - bounds.maxX) - bounds.minX)).toBeLessThanOrEqual(16)
  })

  it("centers the only-rating badge optically", async () => {
    const badge = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "shadow", "#555555", false, { showGenre: false, showYear: false })
    expect(badge).not.toBeNull()
    const bounds = await alphaBounds(badge!.png)
    expect(bounds.minX).toBeGreaterThan(20)
    expect(bounds.maxX).toBeLessThan(bounds.width - 20)
    expect(Math.abs((bounds.width - 1 - bounds.maxX) - bounds.minX)).toBeLessThanOrEqual(16)
  })

  it("renders a partial badge narrower than the full badge", async () => {
    const full = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "shadow", "#555555", false)
    const partial = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "shadow", "#555555", false, { showGenre: false })
    expect(full).not.toBeNull()
    expect(partial).not.toBeNull()
    expect(partial!.w).toBeLessThan(full!.w)
  })
})

describe("buildRankingBadgeSVG", () => {
  it("renders default ranking badge with rank and label", async () => {
    const badge = await buildRankingBadgeSVG(1, 1000, "Oggi", false, "default", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
    expect(badge!.w).toBeLessThan(600)
  })

  it("falls back to default plaque for the removed bar style", async () => {
    // "bar" rimosso da RANKING_BADGE_STYLES: il renderer non lo distingue più
    // dal default (il degrade query ?rs=bar→default vive in poster-config).
    const badge = await buildRankingBadgeSVG(5, 1000, "Oggi", false, "bar" as never, "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeLessThan(600)
  })

  it("renders colored ranking badge", async () => {
    const badge = await buildRankingBadgeSVG(3, 1000, "Oggi", false, "colored", "#ff6430")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
  })

  it("handles long rank text with overflow protection", async () => {
    const badge = await buildRankingBadgeSVG(999, 500, "Supercalifragilistichespiralidoso", false, "default", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeLessThanOrEqual(500)
    expect(badge!.w).toBeGreaterThan(0)
  })

  it("renders without label", async () => {
    const badge = await buildRankingBadgeSVG(1, 1000, undefined, false, "default", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(0)
  })

  it("renders netflix ribbon light with dark text when top is dark", async () => {
    const badge = await buildRankingBadgeSVG(4, 1000, "Oggi", false, "netflix", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(0)
  })

  it("renders vetro ranking badge with the glass gradient", async () => {
    const badge = await buildRankingBadgeSVG(2, 1000, "Oggi", false, "vetro", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
    expect(buildRankingGlassSvg("#2 Oggi", 30, "#fff", "", false).svg).toContain('fill="url(#rg)"')
  })

  it("renders bordo ranking badge with a 2px calibrated stroke", async () => {
    const badge = await buildRankingBadgeSVG(2, 1000, "Oggi", false, "bordo", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
    expect(buildRankingBorderedSvg("#2 Oggi", 30, "#fff", false).svg).toContain('stroke-width="2"')
  })

  it("uses satin gradient ribbon + adaptive text when top is dark", () => {
    const { svg } = buildNetflixRankBadgeSVG(4, 1000, false)
    expect(svg).toContain('fill="url(#nrg)"')
    expect(svg).toContain('stop-color="rgba(255,255,255,0.95)"')
    expect(svg).toContain('fill="rgba(0,0,0,0.80)"')
    expect(svg).not.toContain('fill="rgba(255,255,255,0.80)"')
  })

  it("uses dark satin ribbon + light text when top is light", () => {
    const { svg } = buildNetflixRankBadgeSVG(4, 1000, true)
    expect(svg).toContain('fill="url(#nrg)"')
    expect(svg).toContain('stop-color="rgba(0,0,0,0.88)"')
    expect(svg).toContain('fill="rgba(255,255,255,0.80)"')
  })

  it("mirrors the ribbon horizontally when side=right (Stremio mode)", () => {
    const left = buildNetflixRankBadgeSVG(4, 1000, false)
    const right = buildNetflixRankBadgeSVG(4, 1000, false, "right")
    const pathL = left.svg.match(/<path d="([^"]+)"/)![1]
    const pathR = right.svg.match(/<path d="([^"]+)"/)![1]
    // Path specchiato: parte dall'angolo alto-destro della viewBox
    const totalW = Number(right.svg.match(/viewBox="0 0 (\d+) (\d+)"/)![1])
    expect(pathR).toMatch(new RegExp(`^M ${totalW} 0 L`))
    expect(pathL).not.toBe(pathR)
    // Ombra invertita: cade verso sinistra (verso il centro del poster)
    expect(right.svg).toContain('dx="-3" dy="3"')
    expect(left.svg).toContain('dx="3" dy="3"')
    // Testo non specchiato: "TOP" e rank restano leggibili
    expect(right.svg).toContain(">TOP</text>")
    expect(right.svg).toContain(">4</text>")
  })

  it("renders the rank label under the number for movie/series ribbons", () => {
    const { svg, h } = buildNetflixRankBadgeSVG(4, 1000, false, "left", false, "Oggi")
    expect(svg).toContain(">TOP</text>")
    expect(svg).toContain(">4</text>")
    expect(svg).toContain(">Oggi</text>")
    // Nastro esteso (h × 1.65): il testo ha bisogno di spazio
    const fs = Math.round(Math.max(24 * 1.15 * 1.10 * 1000 / 380, 16))
    const w = Math.round(fs * 2.65)
    const extendedH = Math.round(w * 1.65) + Math.round(fs * 0.4)
    expect(h).toBe(extendedH)
  })

  it("stays compact without label and not anime", () => {
    const { svg, h } = buildNetflixRankBadgeSVG(4, 1000, false)
    expect(svg).not.toContain(">anime</text>")
    const fs = Math.round(Math.max(24 * 1.15 * 1.10 * 1000 / 380, 16))
    const w = Math.round(fs * 2.65)
    expect(h).toBe(Math.round(w * 1.35) + Math.round(fs * 0.4))
  })

  it("keeps the anime sub-label 'anime' (legacy behavior)", () => {
    const { svg } = buildNetflixRankBadgeSVG(4, 1000, false, "left", true)
    expect(svg).toContain(">anime</text>")
    expect(svg).toContain(">TOP</text>")
    expect(svg).toContain(">4</text>")
  })

  it("auto-fits a long label under the number", () => {
    const { svg } = buildNetflixRankBadgeSVG(4, 1000, false, "left", false, "Supercalifragilistichespiralidoso")
    expect(svg).toContain(">Supercalifragilistichespiralidoso</text>")
  })

  it("constrains sub-labels across languages to prevent ribbon overflow", () => {
    const labels = ["Película", "Serie", "Film", "Series", "Série", "Serie de TV", "Série de TV", "TV series", "סרט", "סדרה"]
    for (const label of labels) {
      const { svg, w } = buildNetflixRankBadgeSVG(1, 500, false, "left", false, label)
      expect(svg).toContain(`>${label}</text>`)
      expect(w).toBeGreaterThan(95)
    }
  })
})

describe("top badge uniformity (rank vs extra)", () => {
  it("renders extra badges at 90% of the rank size", async () => {
    // Rank a fs 30, extra al 90% (fs 27): h extra ≈ 49, h rank ≈ 54 a pw 380.
    const rank = await buildRankingBadgeSVG(3, 380, "Oggi", false, "default", "#555555")
    const extra = await buildExtraBadgeSVG("Oscar 2024", 380, false, "default", "#555555")
    expect(rank).not.toBeNull()
    expect(extra).not.toBeNull()
    expect(extra!.h).toBeLessThan(rank!.h)
    expect(extra!.h / rank!.h).toBeCloseTo(0.9, 1)
    expect(extra!.h).toBeGreaterThan(35)
  })
})

describe("buildExtraBadgeSVG", () => {
  it("renders default extra badge with label", async () => {
    const badge = await buildExtraBadgeSVG("Golden Globe", 1000, false, "default", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
    expect(badge!.w).toBeLessThan(600)
  })

  it("falls back to default plaque for the removed bar style", async () => {
    const badge = await buildExtraBadgeSVG("Vincitore Oscar", 1000, false, "bar" as never, "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeLessThan(600)
  })

  it("handles long extra label with overflow protection", async () => {
    const badge = await buildExtraBadgeSVG("Supercalifragilistichespiralidosamente lungo", 500, false, "default", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeLessThanOrEqual(500)
    expect(badge!.w).toBeGreaterThan(0)
  })

  it("renders bordo extra badge with a 2px calibrated stroke", async () => {
    const badge = await buildExtraBadgeSVG("Oscar 2024", 1000, false, "bordo", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
    expect(buildExtraBorderedSvg("Oscar 2024", 30, "#fff", false).svg).toContain('stroke-width="2"')
  })

  it("renders vetro extra badge with the glass gradient", async () => {
    const badge = await buildExtraBadgeSVG("Oscar 2024", 1000, false, "vetro", "#555555")
    expect(badge).not.toBeNull()
    expect(badge!.w).toBeGreaterThan(50)
  })
})

describe("translucent badges adapt text to the background (like quality/netflix)", () => {
  it("ranking vetro: light text on dark top, dark text on light top", async () => {
    const dark = await buildRankingBadgeSVG(6, 1000, "Film", false, "vetro", "#555555")
    expect(await darkPixelCount(dark!.png)).toBe(0)
    const light = await buildRankingBadgeSVG(6, 1000, "Film", true, "vetro", "#555555")
    expect(await darkPixelCount(light!.png)).toBeGreaterThan(0)
  })

  it("ranking bordo: light text on dark top, dark text on light top", async () => {
    const dark = await buildRankingBadgeSVG(6, 1000, "Film", false, "bordo", "#555555")
    expect(await darkPixelCount(dark!.png)).toBe(0)
    const light = await buildRankingBadgeSVG(6, 1000, "Film", true, "bordo", "#555555")
    expect(await darkPixelCount(light!.png)).toBeGreaterThan(0)
  })

  it("extra vetro/bordo: light text on dark top, dark text on light top", async () => {
    const darkVetro = await buildExtraBadgeSVG("Oscar 2024", 1000, false, "vetro", "#555555")
    expect(await darkPixelCount(darkVetro!.png)).toBe(0)
    const lightVetro = await buildExtraBadgeSVG("Oscar 2024", 1000, true, "vetro", "#555555")
    expect(await darkPixelCount(lightVetro!.png)).toBeGreaterThan(0)
    const darkBordo = await buildExtraBadgeSVG("Oscar 2024", 1000, false, "bordo", "#555555")
    expect(await darkPixelCount(darkBordo!.png)).toBe(0)
    const lightBordo = await buildExtraBadgeSVG("Oscar 2024", 1000, true, "bordo", "#555555")
    expect(await darkPixelCount(lightBordo!.png)).toBeGreaterThan(0)
  })

  it("genre vetro/bordo follow the bottom light, like the top follows the top", async () => {
    const darkVetro = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "vetro", "#555555", false)
    expect(await darkPixelCount(darkVetro!.png)).toBe(0)
    const lightVetro = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "vetro", "#555555", true)
    expect(await darkPixelCount(lightVetro!.png)).toBeGreaterThan(0)
    const darkBordo = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "bordo", "#555555", false)
    expect(await darkPixelCount(darkBordo!.png)).toBe(0)
    const lightBordo = await buildGenreBadgeSVG("Dramma", 8.2, 1000, "2024", "bordo", "#555555", true)
    expect(await darkPixelCount(lightBordo!.png)).toBeGreaterThan(0)
  })

  it("control: opaque ranking default keeps dark text on a dark top", async () => {
    const badge = await buildRankingBadgeSVG(6, 1000, "Film", false, "default", "#555555")
    expect(await darkPixelCount(badge!.png)).toBeGreaterThan(0)
  })
})

describe("buildRankingDefaultSvg", () => {
  it("contains text-anchor middle for centering", () => {
    const { svg } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(255,255,255,0.80)", "rgba(0,0,0,0.80)")
    expect(svg).toContain('text-anchor="middle"')
  })

  it("uses a lighter text weight for trend badges", () => {
    const { svg } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(255,255,255,0.80)", "rgba(0,0,0,0.80)")

    expect(svg).toContain('font-weight="700"')
  })

  it("locks text to the measured badge width", () => {
    const { svg } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(255,255,255,0.80)", "rgba(0,0,0,0.80)")
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  it("shares the vetro satin stops (no opaque silver)", () => {
    expect(glassStops(false)).toContain('stop-color="rgba(255,255,255,0.45)"')
    expect(glassStops(false)).toContain('stop-color="rgba(0,0,0,0.35)"')
    expect(glassStops(true)).toContain('stop-color="rgba(255,255,255,0.92)"')
    expect(glassStops(true)).not.toContain("#FFFFFF")
    expect(glassStops(true)).not.toContain("#E2E8F0")
  })

  it("renders ranking-default with satin gradient (dark top → light pill)", () => {
    const { svg } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", false)
    expect(svg).toContain('fill="url(#rdg)"')
    expect(svg).toContain('stop-color="rgba(255,255,255,0.95)"')
  })

  it("has a single 3D box shadow and exact box geometry (ribbon-style finish)", () => {
    const { svg, w, h } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", false)
    expect(svg).toContain("feDropShadow")
    expect(svg).toContain('filter="url(#tds)"')
    expect(svg).toContain('stroke-width="1.5"')
    // Canvas = box esatta, senza padding ombra.
    expect(svg).toContain(`width="${w}" height="${h}"`)
  })

  it("uses polarized 1.5px stroke (light on dark tops, dark on light tops)", () => {
    const dark = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", false)
    expect(dark.svg).toContain('stroke="rgba(255,255,255,0.22)"')
    const light = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", true)
    expect(light.svg).toContain('stroke="rgba(0,0,0,0.12)"')
  })

  it("keeps the accent flat fill for rs=colored (no satin override)", () => {
    const { svg } = buildRankingDefaultSvg("#2 Film", 60, "#ffffff", "#ff6430", false, "#ff6430")
    expect(svg).toContain('fill="#ff6430"')
    expect(svg).not.toContain('fill="url(#rdg)"')
  })

  it("uses squared-but-rounded bottom corners (0.45 x fs)", () => {
    const { svg } = buildRankingDefaultSvg("#1 Oggi", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", false)
    // r = round(60 * 0.45) = 27: angoli squadrati ma non a spigolo vivo.
    expect(svg).toContain("A 27,27")
    expect(svg).not.toContain("A 42,42")
  })

  it("renders quality badge with satin gradient (geometry unchanged)", () => {
    const dark = buildQualityBadgeSvg("4K", 20, "", "", false)
    expect(dark.svg).toContain('fill="url(#qg)"')
    expect(dark.svg).toContain('stop-color="rgba(255,255,255,0.95)"')
    const light = buildQualityBadgeSvg("4K", 20, "", "", true)
    expect(light.svg).toContain('stop-color="rgba(0,0,0,0.88)"')
  })

  it("keeps pill-polarity stops bright on dark tops (rank must pop)", () => {
    expect(satinPillStops(false)).toContain('stop-color="rgba(255,255,255,0.95)"')
    expect(satinPillStops(true)).toContain('stop-color="rgba(0,0,0,0.88)"')
  })
})

describe("buildExtraDefaultSvg", () => {
  it("locks text to the measured badge width", () => {
    const { svg } = buildExtraDefaultSvg("Vincitore Golden Globe", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)")
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  it("uses satin gradient with polarized stroke and 3D box shadow by default", () => {
    const { svg } = buildExtraDefaultSvg("Vincitore Golden Globe", 60, "rgba(0,0,0,0.80)", "rgba(255,255,255,0.80)", false, false)
    expect(svg).toContain('fill="url(#edg)"')
    expect(svg).toContain('stroke="rgba(255,255,255,0.22)"')
    expect(svg).toContain('stroke-width="1.5"')
    expect(svg).toContain('filter="url(#tds)"')
  })

  it("keeps the accent flat fill for colored (no satin override)", () => {
    const { svg } = buildExtraDefaultSvg("Premio", 60, "#ffffff", "#ff6430", false, false, "#ff6430")
    expect(svg).toContain('fill="#ff6430"')
    expect(svg).not.toContain('fill="url(#edg)"')
  })

  it("uses squared-but-rounded bottom corners (0.45 x fs)", () => {
    const { svg } = buildExtraDefaultSvg("Premio", 60, "#ffffff", "#ff6430", false, false)
    expect(svg).toContain("A 27,27")
    expect(svg).not.toContain("A 42,42")
  })
})

describe("comingSoonRibbonLayout", () => {
  it("scales with poster width", () => {
    const l380 = comingSoonRibbonLayout(380)
    expect(l380).toEqual({ size: 200, offset: 20, extent: 155 })
    const l190 = comingSoonRibbonLayout(190)
    expect(l190).toEqual({ size: 100, offset: 10, extent: 78 })
  })
})

describe("renderComingSoonRibbon", () => {
  it("rasterizes a red diagonal band touching the top-left corner", async () => {
    const { png, w, h } = await renderComingSoonRibbon("Coming Soon", 380)
    expect(w).toBe(200)
    expect(h).toBe(200)
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(200)
    // Banda rossa presente nei pressi dell'angolo (pixel con rosso dominante)
    let redCount = 0
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 120; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3] > 200) redCount++
      }
    }
    expect(redCount).toBeGreaterThan(500)
    // Centro del canvas: testo chiaro sulla banda (pixel quasi bianchi)
    let whiteCount = 0
    for (let y = 40; y < 100; y++) {
      for (let x = 40; x < 100; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220 && data[i + 3] > 200) whiteCount++
      }
    }
    expect(whiteCount).toBeGreaterThan(50)
  }, 30000)

  it("rasterizes a red diagonal band touching the top-right corner when side=right", async () => {
    const { png, w, h } = await renderComingSoonRibbon("Coming Soon", 380, "right")
    expect(w).toBe(200)
    expect(h).toBe(200)
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(200)
    let redCount = 0
    for (let y = 0; y < 120; y++) {
      for (let x = 80; x < 200; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3] > 200) redCount++
      }
    }
    expect(redCount).toBeGreaterThan(500)
  }, 30000)

  it("rasterizes Coming Soon ribbon for all 10 supported translations", async () => {
    const labels = [
      "Coming Soon",
      "Prossimamente",
      "Próximamente",
      "Prochainement",
      "Demnächst",
      "Em breve",
      "近日公開",
      "개봉 예정",
      "בקרוב",
      "Brzy",
    ]
    for (const label of labels) {
      const { png, w, h } = await renderComingSoonRibbon(label, 380)
      expect(w).toBe(200)
      expect(h).toBe(200)
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let whiteCount = 0
      for (let y = 30; y < 110; y++) {
        for (let x = 30; x < 110; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200 && data[i + 3] > 180) whiteCount++
        }
      }
      expect(whiteCount, `White text pixels for ${label}`).toBeGreaterThan(20)
    }
  }, 30000)
})

describe("vetro shares bordo box model (same size and position)", () => {
  it("genre glass and bordered produce identical bitmap dimensions", () => {
    for (const topLight of [false, true]) {
      const glass = buildGenreGlassSvg("Dramma", "8.2", "2024", 34, "#fff", topLight)
      const bordo = buildGenreBorderedSvg("Dramma", "8.2", "2024", 34, "#fff", topLight)
      expect(glass.w).toBe(bordo.w)
      expect(glass.h).toBe(bordo.h)
    }
  })

  it("ranking glass and bordered produce identical bitmap dimensions", () => {
    for (const topLight of [false, true]) {
      const glass = buildRankingGlassSvg("#1 Oggi", 30, "#fff", "", topLight)
      const bordo = buildRankingBorderedSvg("#1 Oggi", 30, "#fff", topLight)
      expect(glass.w).toBe(bordo.w)
      expect(glass.h).toBe(bordo.h)
    }
  })
})

