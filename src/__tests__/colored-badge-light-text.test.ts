import { describe, expect, it } from "vitest"
import { textColorForBg } from "@/lib/accent-color"
import {
  buildExtraBadgeSVG,
  buildGenreBadgeSVG,
  buildRankingBadgeSVG,
} from "@/lib/svg-badge"
import {
  buildExtraDefaultSvg,
  buildHouseGenreSvg,
  buildHouseRankingSvg,
  buildNetflixRankBadgeSVG,
  buildRankingCornerSvg,
} from "@/lib/badge-svg-shared"

/**
 * C2 — the 2:1 light-text preference reaches every COLORED consumer through
 * the single shared utility (same SVG for preview <img> and Stremio poster:
 * one endpoint, no second implementation). Mid-tone fills now render white
 * text; near-white fills keep the dark-text safeguard; non-colored styles
 * are untouched.
 */
const MID_TONES = ["#D4A574", "#E67E22", "#1ABC9C", "#2ECC71", "#fb923c", "#9a9a9a"]
const NEAR_WHITE = ["#FFD700", "#f2c94c", "#F5E6C4", "#ffffff"]

describe("colored badges render light text on mid-tone fills", () => {
  it("genre colored pill uses white text on mid-tones", () => {
    for (const ac of MID_TONES) {
      const { svg } = buildHouseGenreSvg({
        genreName: "Dramma",
        voteStr: "8.2",
        yearStr: "2024",
        pw: 380,
        style: "colored",
        accentColor: ac,
      })
      expect(svg).toContain('fill="#ffffff"')
    }
  })

  it("ranking colored ribbon uses white text on mid-tones", () => {
    for (const ac of MID_TONES) {
      const { svg } = buildHouseRankingSvg({
        rank: 3,
        label: "Oggi",
        pw: 380,
        style: "colored",
        accentColor: ac,
      })
      expect(svg).toContain('fill="#ffffff"')
      const direct = buildNetflixRankBadgeSVG(3, 380, false, "left", false, "Oggi", ac)
      expect(direct.svg).toContain('fill="#ffffff"')
    }
  })

  it("corner badge uses white text on mid-tones", () => {
    for (const ac of MID_TONES) {
      const { svg } = buildRankingCornerSvg("#3 Oggi", 27, ac)
      expect(svg).toContain('fill="#ffffff"')
    }
  })

  it("extra colored default uses white text on mid-tones", () => {
    for (const ac of MID_TONES) {
      const fg = textColorForBg(ac)
      expect(fg).toBe("#ffffff")
      const { svg } = buildExtraDefaultSvg("Nuova stagione", 27, fg, ac, false, false, ac)
      expect(svg).toContain(`fill="${fg}"`)
    }
  })

  it("async renderer entry points resolve on a mid-tone accent", async () => {
    const genre = await buildGenreBadgeSVG("Dramma", 8.2, 380, "2024", "colored", "#E67E22", false)
    expect(genre!.png.length).toBeGreaterThan(1000)
    const rank = await buildRankingBadgeSVG(3, 380, "Oggi", false, "colored", "#E67E22", "left", false, false, false, "Oggi")
    expect(rank!.png.length).toBeGreaterThan(1000)
    const extra = await buildExtraBadgeSVG("Nuova stagione", 380, false, "colored", "#E67E22")
    expect(extra!.png.length).toBeGreaterThan(1000)
  })
})

describe("near-white safeguard and unrelated styles", () => {
  it("colored badges keep dark text on near-white fills", () => {
    for (const ac of NEAR_WHITE) {
      expect(textColorForBg(ac)).toBe("rgba(0,0,0,0.80)")
      const { svg } = buildHouseGenreSvg({
        genreName: "Dramma",
        voteStr: "8.2",
        yearStr: "2024",
        pw: 380,
        style: "colored",
        accentColor: ac,
      })
      expect(svg).toContain('<g fill="rgba(0,0,0,0.80)">')
    }
  })

  it("non-colored styles ignore the accent light-text preference", () => {
    // Satin pill: polar text from bottomLight, never textColorForBg.
    const pill = buildHouseGenreSvg({
      genreName: "Dramma",
      voteStr: "8.2",
      yearStr: "2024",
      pw: 380,
      style: "pill",
      accentColor: "#E67E22",
      bottomLight: false,
    })
    expect(pill.svg).toContain('fill="rgba(0,0,0,0.88)"')
    // Ranking default: polar text from topLight.
    const rank = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style: "default", accentColor: "#E67E22" })
    expect(rank.svg).toContain('fill="rgba(0,0,0,0.88)"')
  })
})
