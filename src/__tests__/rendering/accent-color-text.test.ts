import { describe, expect, it } from "vitest"
import {
  COLORED_BADGE_LIGHT_TEXT_LC_BIAS,
  apcaLc,
  textColorForBg,
} from "@/lib/accent-color"

const DARK = "#ffffff"
const LIGHT = "rgba(0,0,0,0.80)"

describe("textColorForBg light-preference (visual, colored badges only)", () => {
  it("uses the shared APCA Lc bias (not a WCAG 2:1 claim)", () => {
    expect(COLORED_BADGE_LIGHT_TEXT_LC_BIAS).toBe(5)
  })

  it("prefers white on the Tuner teal #4a9daa even though dark contrasts more", () => {
    expect(textColorForBg("#4a9daa")).toBe(DARK)
  })

  it("prefers white on mid-tone fills the user asked to lighten", () => {
    for (const bg of ["#E67E22", "#1ABC9C", "#9a9a9a", "#4a9daa"]) {
      expect(textColorForBg(bg)).toBe(DARK)
    }
    // These now resolve to dark text under APCA.
    for (const bg of ["#D4A574", "#2ECC71", "#fb923c"]) {
      expect(textColorForBg(bg)).toBe(LIGHT)
    }
  })

  it("keeps white on dark backgrounds (navy, red, mid gray)", () => {
    expect(textColorForBg("#1a2b4a")).toBe(DARK)
    expect(textColorForBg("#e50914")).toBe(DARK)
    expect(textColorForBg("#808080")).toBe(DARK)
  })

  it("keeps dark text on near-white backgrounds (white, yellow/gold, pastel guard)", () => {
    // Near-white safeguard: white text would wash out here, so the
    // max-contrast fallback keeps dark text fully legible.
    for (const bg of ["#f2c94c", "#FFD700", "#ffffff", "#F5E6C4"]) {
      expect(textColorForBg(bg)).toBe(LIGHT)
    }
  })

  it("pins the APCA boundary: #aaaaaa white, #ababab dark", () => {
    expect(textColorForBg("#aaaaaa")).toBe(DARK)
    expect(textColorForBg("#ababab")).toBe(LIGHT)
  })

  it("resolves the former #555555 sentinel by real contrast (white), empty stays dark-text fallback", () => {
    expect(textColorForBg("#555555")).toBe(DARK)
    expect(textColorForBg("")).toBe(LIGHT)
  })

  it("prefers the first candidate with custom colors when readable (param order preserved)", () => {
    // Bright green on navy: clearly readable -> first candidate wins.
    expect(textColorForBg("#1a2b4a", "#00ff00", "#000000")).toBe("#00ff00")
    // Yellow on teal -> first candidate wins.
    expect(textColorForBg("#4a9daa", "#ffff00", "#000000")).toBe("#ffff00")
    // Yellow on white -> max-contrast fallback.
    expect(textColorForBg("#ffffff", "#ffff00", "#000000")).toBe("#000000")
  })

  describe("beige / tan", () => {
    it("dark text on light beige/tan, white on deeper tans", () => {
      for (const bg of ["#C8AD7F", "#D2B48C"]) {
        expect(textColorForBg(bg)).toBe(LIGHT)
      }
      for (const bg of ["#B49B76", "#A89070", "#8B7355"]) {
        expect(textColorForBg(bg)).toBe(DARK)
      }
    })
  })

  describe("APCA reference values (official apca-w3)", () => {
    it("matches the published example: #888 on #fff = 63.06, inverted = -68.54", () => {
      expect(apcaLc([0x88, 0x88, 0x88], [0xff, 0xff, 0xff])).toBeCloseTo(63.06, 1)
      // apcaLc returns the absolute magnitude; the signed official value is -68.54.
      // Recompute signed via the same formula is not needed: check magnitude of inverted.
      expect(apcaLc([0xff, 0xff, 0xff], [0x88, 0x88, 0x88])).toBeCloseTo(68.54, 1)
    })
  })

  it("blends translucent candidates on the real background before deciding", () => {
    // Half-white on navy stays readable once blended -> kept verbatim.
    const half = "rgba(255,255,255,0.50)"
    expect(textColorForBg("#1a2b4a", half, "#000000")).toBe(half)
    // Half-white on pure white is invisible -> dark candidate wins.
    expect(textColorForBg("#ffffff", half, LIGHT)).toBe(LIGHT)
  })
})
