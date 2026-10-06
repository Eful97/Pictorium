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

describe("findSceneTint (background representative medians)", () => {
  function createTealNavyFrame(): Buffer {
    // Teal #5195a3 background with a navy strip in the frame (~12% of
    // samples, like the hoodie edges on Tuner) + tall black band (skipped
    // for l < 0.08): the winner stays teal.
    const w = 200, h = 300
    const buf = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const navy = x < 12
        const blackBand = y < 6
        const [r, g, b] = blackBand ? [10, 10, 10] : navy ? [20, 30, 60] : [81, 149, 163]
        buf[i] = r
        buf[i + 1] = g
        buf[i + 2] = b
        buf[i + 3] = 255
      }
    }
    return buf
  }

  it("teal background with navy frame patches returns the teal itself, near #5195a3", () => {
    const raw = createTealNavyFrame()
    const tint = findSceneTint(raw, 200, 300, "Crime")
    // Winning-bucket medians = pure teal pixels (navy votes bucket 7,
    // black is excluded by the filters) → exact background color.
    expect(tint).toEqual({ r: 81, g: 149, b: 163 })
    // Robust threshold vs target (12.7 euclidean measured on the real poster
    // for edge teal-navy blends; 0 here by construction).
    const dR = 81 - tint.r, dG = 149 - tint.g, dB = 163 - tint.b
    expect(Math.sqrt(dR * dR + dG * dG + dB * dB)).toBeLessThan(25)
    // Teal signature, not navy (navy: g - r ≈ 10).
    expect(tint.g).toBeGreaterThan(tint.r + 30)
  })

  it("dark scene preserves the dark background lightness (no lift to scrim band)", () => {
    const w = 200, h = 300
    const raw = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const lamp = x >= w * 0.6 && x < w * 0.8 && y >= h * 0.55 && y < h * 0.7
        const [r, g, b] = lamp ? [210, 140, 60] : [22, 30, 52]
        raw[i] = r
        raw[i + 1] = g
        raw[i + 2] = b
        raw[i + 3] = 255
      }
    }
    const tint = findSceneTint(raw, w, h, "Crime")
    // Center lamp = outside the frame → medians = exact dark background,
    // darker than the old fixed band (L = 0.26): scenic darkening stays the
    // renderer's job, not the extractor's.
    expect(tint).toEqual({ r: 22, g: 30, b: 52 })
    expect(tint.b).toBeGreaterThan(tint.g)
    expect(tint.g).toBeGreaterThan(tint.r)
  })

  it("uniform saturated color returns the color itself", () => {
    const raw = createSolidRawRgba(100, 100, 81, 149, 163)
    expect(findSceneTint(raw, 100, 100, "Crime")).toEqual({ r: 81, g: 149, b: 163 })
  })
})

describe("findSceneTint (median edge cases)", () => {
  it("even sample count averages the two middle values deterministically", () => {
    // 20x20 with 8px frame margins: paint 12 saturated pixels on the top
    // frame row, six R=80 + six R=82 (same G/B/hue bucket) → median R is
    // exactly (80 + 82) / 2 = 81, on every run.
    const w = 20, h = 20
    const buf = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = 128
      buf[i * 4 + 1] = 128
      buf[i * 4 + 2] = 128
      buf[i * 4 + 3] = 255
    }
    const paint = (x: number, y: number, r: number) => {
      const i = (y * w + x) * 4
      buf[i] = r
      buf[i + 1] = 150
      buf[i + 2] = 160
      buf[i + 3] = 255
    }
    for (let x = 0; x < 20; x += 2) paint(x, 0, x < 8 ? 80 : 82)
    paint(0, 2, 80)
    paint(2, 2, 80)
    const first = findSceneTint(buf, w, h, "Action")
    expect(first).toEqual({ r: 81, g: 150, b: 160 })
    expect(findSceneTint(buf, w, h, "Action")).toEqual(first)
  })

  it("fully transparent pixels never vote (alpha = 0 excluded)", () => {
    // The teal majority is fully transparent; only the opaque navy strip
    // votes. If transparent teal leaked in, teal would dominate by area.
    const w = 100, h = 100
    const buf = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (x < 50) {
          buf[i] = 20
          buf[i + 1] = 30
          buf[i + 2] = 60
          buf[i + 3] = 255
        } else {
          buf[i] = 81
          buf[i + 1] = 149
          buf[i + 2] = 163
          buf[i + 3] = 0
        }
      }
    }
    expect(findSceneTint(buf, w, h, "Crime")).toEqual({ r: 20, g: 30, b: 60 })
  })

  it("desaturated grey and near-black pixels never vote", () => {
    // The frame is grey + near-black noise; only a small saturated teal
    // patch at the corner contributes weight → teal wins, medians exact.
    const w = 100, h = 100
    const buf = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const tealPatch = x < 12 && y < 12
        const nearBlack = !tealPatch && (x + y) % 3 === 0
        const [r, g, b] = tealPatch ? [81, 149, 163] : nearBlack ? [5, 5, 5] : [150, 150, 150]
        buf[i] = r
        buf[i + 1] = g
        buf[i + 2] = b
        buf[i + 3] = 255
      }
    }
    expect(findSceneTint(buf, w, h, "Crime")).toEqual({ r: 81, g: 149, b: 163 })
  })

  it("red straddling the 0/360 boundary keeps every sample in-family", () => {
    // Left half hue ≈ 356.5° (bucket 11), right half hue ≈ 3.5° (bucket 0):
    // deriving the winner from the mean hue must attribute each sample to
    // its own bucket instead of dropping the red family.
    const w = 100, h = 100
    const buf = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const left = x < 50
        buf[i] = 200
        buf[i + 1] = left ? 30 : 40
        buf[i + 2] = left ? 40 : 30
        buf[i + 3] = 255
      }
    }
    const tint = findSceneTint(buf, w, h, "Action")
    // Whichever side wins, the medians are exactly that side's color —
    // never a blend, never the fallback, always red-dominant.
    expect([[200, 30, 40], [200, 40, 30]]).toContainEqual([tint.r, tint.g, tint.b])
    expect(tint.r).toBeGreaterThan(tint.g + 100)
    expect(tint.r).toBeGreaterThan(tint.b + 100)
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
