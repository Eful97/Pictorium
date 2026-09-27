import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { findSceneTint, findAccentColor, isManualAccent, computeBottomLight, hexLuminance, bottomEdgeAverage, isWarmGoldAccent } from "@/lib/accent-color"
import { extractSceneTint } from "@/lib/poster-render-helpers"
import { GENRE_FALLBACK } from "@/lib/badges"

function createSolidRawRgba(w: number, h: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return buf
}

describe("findSceneTint (same-hue scene tint extraction)", () => {
  it("solid green raw image -> G dominant with significant margin over R and B", () => {
    const raw = createSolidRawRgba(100, 100, 20, 180, 30)
    const tint = findSceneTint(raw, 100, 100, "Action")
    expect(tint.g).toBeGreaterThan(tint.r + 30)
    expect(tint.g).toBeGreaterThan(tint.b + 30)
  })

  it("solid blue raw image -> B dominant over R and G", () => {
    const raw = createSolidRawRgba(100, 100, 30, 40, 200)
    const tint = findSceneTint(raw, 100, 100, "Action")
    expect(tint.b).toBeGreaterThan(tint.r + 30)
    expect(tint.b).toBeGreaterThan(tint.g + 30)
  })

  it("amber image (229, 142, 38) -> R max and same-hue (proves non-rotation vs complementary +150°)", () => {
    const raw = createSolidRawRgba(100, 100, 229, 142, 38)
    const sceneTint = findSceneTint(raw, 100, 100, "Action")
    const accentBadge = findAccentColor(raw, 100, 100, "Action")

    // Scene tint must keep warm amber hue (R dominant, G mid, B lowest)
    expect(sceneTint.r).toBeGreaterThan(sceneTint.g)
    expect(sceneTint.g).toBeGreaterThan(sceneTint.b)

    // Contrast with findAccentColor (+150° rotation gives cool cyan/blue where B or G dominates R)
    expect(accentBadge.b).toBeGreaterThan(accentBadge.r)
  })

  it("golden image (200, 140, 30) keeps a saturated gold tint (not muted olive)", () => {
    // Riferimento concorrenza ~#7f5401 (sat ~0.98, L ~0.25): la tinta deve
    // preservare la saturazione misurata invece di schiacciarla a oliva spento.
    const raw = createSolidRawRgba(100, 100, 200, 140, 30)
    const tint = findSceneTint(raw, 100, 100, "Action")
    expect(tint.r).toBeGreaterThan(tint.g)
    expect(tint.g).toBeGreaterThan(tint.b)
    expect(tint.r).toBeGreaterThan(80)
    expect(tint.r - tint.b).toBeGreaterThan(65)
  })

  it("flat grey / monochromatic -> exact GENRE_FALLBACK without contrast push", () => {
    const raw = createSolidRawRgba(100, 100, 128, 128, 128)
    const tint = findSceneTint(raw, 100, 100, "Animation")
    const expectedHex = GENRE_FALLBACK["Animation"] || "#555555"
    const expectedR = parseInt(expectedHex.slice(1, 3), 16)
    const expectedG = parseInt(expectedHex.slice(3, 5), 16)
    const expectedB = parseInt(expectedHex.slice(5, 7), 16)

    expect(tint.r).toBe(expectedR)
    expect(tint.g).toBe(expectedG)
    expect(tint.b).toBe(expectedB)
  })

  it("findAccentColor remains byte-identical after analyzeBuckets extraction", () => {
    const rawGreen = createSolidRawRgba(50, 50, 20, 180, 30)
    const resGreen = findAccentColor(rawGreen, 50, 50, "Action")
    expect(resGreen).toEqual(findAccentColor(rawGreen, 50, 50, "Action"))

    const rawGrey = createSolidRawRgba(50, 50, 80, 80, 80)
    const resGrey = findAccentColor(rawGrey, 50, 50, "Drama")
    expect(resGrey).toEqual(findAccentColor(rawGrey, 50, 50, "Drama"))
  })
})

describe("extractSceneTint (poster-render-helpers)", () => {
  it("extracts valid #rrggbb hex string from a synthetic JPEG buffer", async () => {
    const jpegBuf = await sharp({
      create: {
        width: 300,
        height: 450,
        channels: 3,
        background: { r: 180, g: 40, b: 40 },
      },
    }).jpeg().toBuffer()

    const hex = await extractSceneTint(jpegBuf, "Action")
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("never throws on corrupt / garbage buffer and falls back to genre hex", async () => {
    const garbage = Buffer.from([0, 1, 2, 3, 4, 5])
    const hex = await extractSceneTint(garbage, "Comedy")
    const expectedFallback = GENRE_FALLBACK["Comedy"] || "#555555"
    expect(hex).toBe(expectedFallback)
  })

  it("returns byte-identical output for identical poster input (deterministic)", async () => {
    const jpegBuf = await sharp({
      create: {
        width: 200,
        height: 300,
        channels: 3,
        background: { r: 50, g: 120, b: 200 },
      },
    }).jpeg().toBuffer()

    const hex1 = await extractSceneTint(jpegBuf, "Sci-Fi")
    const hex2 = await extractSceneTint(jpegBuf, "Sci-Fi")
    expect(hex1).toBe(hex2)
  })

  it("extracts scene tint from the whole poster (no region param)", async () => {
    const jpegBuf = await sharp({
      create: {
        width: 200,
        height: 300,
        channels: 3,
        background: { r: 50, g: 120, b: 200 },
      },
    }).jpeg().toBuffer()

    const hex = await extractSceneTint(jpegBuf, "Sci-Fi")
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    // Blu dominante su tutto il poster -> canale B nettamente sopra R
    const b = parseInt(hex.slice(5, 7), 16)
    const r = parseInt(hex.slice(1, 3), 16)
    expect(b).toBeGreaterThan(r + 30)
  })

  it("faces at the bottom do not hijack the tint (Silo regression)", async () => {
    // Scena verde-teal scura con blob caldo (pelle/tuta) nel 40% inferiore:
    // la tinta deve restare verde smeraldo, non virare al marrone #86642d
    // che votava il crop bottom-40%.
    const w = 200, h = 300
    const raw = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const warmBlob = y > h * 0.6 && x > w * 0.25 && x < w * 0.75
        raw[i] = warmBlob ? 200 : 25
        raw[i + 1] = warmBlob ? 150 : 95
        raw[i + 2] = warmBlob ? 110 : 80
        raw[i + 3] = 255
      }
    }
    const jpegBuf = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).jpeg().toBuffer()
    const hex = await extractSceneTint(jpegBuf, "Action")
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    expect(g).toBeGreaterThan(r + 10)
    expect(g).toBeGreaterThan(b - 10)
  })
})

describe("isManualAccent (manual vs auto-detected accent)", () => {
  it("false when no accent is set", () => {
    expect(isManualAccent(null, "#aabbcc")).toBe(false)
    expect(isManualAccent(undefined, undefined)).toBe(false)
  })

  it("true when set with no auto reference", () => {
    expect(isManualAccent("#ff0000", null)).toBe(true)
    expect(isManualAccent("#ff0000", undefined)).toBe(true)
  })

  it("false when the accent equals the auto-detected color (case-insensitive)", () => {
    expect(isManualAccent("#aabbcc", "#AABBCC")).toBe(false)
  })

  it("true when the accent differs from the auto-detected color", () => {
    expect(isManualAccent("#ff0000", "#aabbcc")).toBe(true)
  })
})

describe("computeBottomLight (genre badge polarity from the bottom strip)", () => {
  it("null when the strip was not measured", () => {
    expect(computeBottomLight(null, 30, true)).toBeNull()
  })

  it("true for a light strip without blur", () => {
    expect(computeBottomLight(0.8, 30, false)).toBe(true)
  })

  it("false for a dark strip", () => {
    expect(computeBottomLight(0.3, 0, false)).toBe(false)
  })

  it("blur darkness pulls a light strip below the threshold", () => {
    // 0.94 * (1 - 0.40) = 0.564 < 0.60: la banda scurisce, la pill resta chiara.
    expect(computeBottomLight(0.94, 40, true)).toBe(false)
    expect(computeBottomLight(0.94, 40, false)).toBe(true)
  })

  it("clamps darkness outside 0-100", () => {
    expect(computeBottomLight(0.8, 200, true)).toBe(false)
    expect(computeBottomLight(0.8, -50, true)).toBe(true)
  })
})

describe("hexLuminance", () => {
  it("white is 1, black is 0", () => {
    expect(hexLuminance("#ffffff")).toBeCloseTo(1, 5)
    expect(hexLuminance("#000000")).toBe(0)
  })

  it("null for missing or malformed input", () => {
    expect(hexLuminance(null)).toBeNull()
    expect(hexLuminance("#fff")).toBeNull()
    expect(hexLuminance("not-a-color")).toBeNull()
  })
})

describe("isWarmGoldAccent", () => {
  it("true per ori/ambre/aranci saturi (la stella oro annegherebbe)", () => {
    expect(isWarmGoldAccent("#F59E0B")).toBe(true)
    expect(isWarmGoldAccent("#fb923c")).toBe(true)
    expect(isWarmGoldAccent("#eab308")).toBe(true)
  })

  it("false per freddi, verdi, grigi e input non-hex", () => {
    expect(isWarmGoldAccent("#3b82f6")).toBe(false)
    expect(isWarmGoldAccent("#22c55e")).toBe(false)
    expect(isWarmGoldAccent("#808080")).toBe(false)
    expect(isWarmGoldAccent("#555555")).toBe(false)
    expect(isWarmGoldAccent(null)).toBe(false)
    expect(isWarmGoldAccent(undefined)).toBe(false)
    expect(isWarmGoldAccent("rgba(0,0,0,0.80)")).toBe(false)
  })
})

describe("bottomEdgeAverage", () => {
  it("samples the bottom rows, not the top", () => {
    const w = 100, h = 100
    const raw = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const bottom = y >= h - Math.max(Math.round(h * 0.08), 3)
        raw[i] = bottom ? 200 : 10
        raw[i + 1] = bottom ? 200 : 10
        raw[i + 2] = bottom ? 200 : 10
        raw[i + 3] = 255
      }
    }
    const { r, g, b } = bottomEdgeAverage(raw, w, h)
    expect(r).toBeGreaterThan(150)
    expect(g).toBeGreaterThan(150)
    expect(b).toBeGreaterThan(150)
  })
})
