import { describe, expect, it } from "vitest"
import {
  COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST,
  contrastRatio,
  relativeLuminance,
  textColorForBg,
} from "@/lib/accent-color"

const DARK = "#ffffff"
const LIGHT = "rgba(0,0,0,0.80)"

function hexLum(hex: string): number {
  return relativeLuminance(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  )
}

/** Effective contrast of a (possibly translucent) candidate on a bg hex. */
function effectiveContrast(bgHex: string, candidate: string): number {
  const r = parseInt(bgHex.slice(1, 3), 16)
  const g = parseInt(bgHex.slice(3, 5), 16)
  const b = parseInt(bgHex.slice(5, 7), 16)
  const m = candidate.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  let tr: number, tg: number, tb: number, ta: number
  if (m) {
    tr = parseInt(m[1]); tg = parseInt(m[2]); tb = parseInt(m[3])
    ta = m[4] !== undefined ? parseFloat(m[4]) : 1
  } else {
    tr = parseInt(candidate.slice(1, 3), 16)
    tg = parseInt(candidate.slice(3, 5), 16)
    tb = parseInt(candidate.slice(5, 7), 16)
    ta = 1
  }
  const er = ta < 1 ? Math.round(tr * ta + r * (1 - ta)) : tr
  const eg = ta < 1 ? Math.round(tg * ta + g * (1 - ta)) : tg
  const eb = ta < 1 ? Math.round(tb * ta + b * (1 - ta)) : tb
  return contrastRatio(relativeLuminance(er, eg, eb), hexLum(bgHex))
}

describe("textColorForBg light-preference (visual, colored badges only)", () => {
  it("uses the shared 2:1 visual-preference threshold (not a WCAG claim)", () => {
    // Explicit user-requested visual preference: 2:1 is below every WCAG
    // threshold, so it must never be presented as readable/compliant.
    expect(COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST).toBe(2)
  })

  it("prefers white on the Tuner teal #4a9daa even though black contrasts more", () => {
    const white = effectiveContrast("#4a9daa", DARK)
    const black = effectiveContrast("#4a9daa", LIGHT)
    // Grounded tradeoff: white stays readable, black is numerically higher.
    expect(white).toBeGreaterThanOrEqual(2)
    expect(black).toBeGreaterThan(white)
    expect(textColorForBg("#4a9daa")).toBe(DARK)
  })

  it("prefers white on mid-tone fills the user asked to lighten", () => {
    // All below the old 3:1 bar, all at/above the 2:1 visual preference —
    // these flipped from dark to light text with the threshold change.
    for (const bg of ["#D4A574", "#E67E22", "#1ABC9C", "#2ECC71", "#fb923c", "#9a9a9a"]) {
      expect(effectiveContrast(bg, DARK)).toBeGreaterThanOrEqual(2)
      expect(textColorForBg(bg)).toBe(DARK)
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
      expect(effectiveContrast(bg, DARK)).toBeLessThan(2)
      expect(textColorForBg(bg)).toBe(LIGHT)
    }
  })

  it("pins the 2:1 boundary: just above stays white, just below goes dark", () => {
    // Grays straddling the threshold within ±0.02 (measured):
    // #B6B6B6 -> 2.028 (white), #B8B8B8 -> 1.984 (dark).
    expect(effectiveContrast("#B6B6B6", DARK)).toBeGreaterThanOrEqual(2)
    expect(textColorForBg("#B6B6B6")).toBe(DARK)
    expect(effectiveContrast("#B8B8B8", DARK)).toBeLessThan(2)
    expect(textColorForBg("#B8B8B8")).toBe(LIGHT)
  })

  it("resolves the former #555555 sentinel by real contrast (white), empty stays dark-text fallback", () => {
    expect(effectiveContrast("#555555", DARK)).toBeGreaterThanOrEqual(2)
    expect(textColorForBg("#555555")).toBe(DARK)
    expect(textColorForBg("")).toBe(LIGHT)
  })

  it("prefers the first candidate with custom colors when readable (param order preserved)", () => {
    // Bright green on navy: clearly readable -> first candidate wins.
    expect(textColorForBg("#1a2b4a", "#00ff00", "#000000")).toBe("#00ff00")
    // Yellow on teal: 2.92, readable under the 2:1 visual preference
    // (it fell back to black under the old 3:1 bar) -> first candidate wins.
    expect(effectiveContrast("#4a9daa", "#ffff00")).toBeGreaterThanOrEqual(2)
    expect(textColorForBg("#4a9daa", "#ffff00", "#000000")).toBe("#ffff00")
    // Yellow on white: 1.07, below the preference -> max-contrast fallback.
    expect(effectiveContrast("#ffffff", "#ffff00")).toBeLessThan(2)
    expect(textColorForBg("#ffffff", "#ffff00", "#000000")).toBe("#000000")
  })

  it("blends translucent candidates on the real background before deciding", () => {
    // Half-white on navy stays readable once blended -> kept verbatim.
    const half = "rgba(255,255,255,0.50)"
    expect(effectiveContrast("#1a2b4a", half)).toBeGreaterThanOrEqual(2)
    expect(textColorForBg("#1a2b4a", half, "#000000")).toBe(half)
    // Half-white on pure white is invisible -> dark candidate wins.
    expect(textColorForBg("#ffffff", half, LIGHT)).toBe(LIGHT)
  })
})
