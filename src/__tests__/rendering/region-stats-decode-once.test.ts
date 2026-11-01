/**
 * Region stats: ONE poster decode + hash-keyed stats cache.
 *
 * A cold render analyses the same fitted poster up to five times (top
 * luminance, bottom luminance, top band mean, bottom band mean, logo-zone
 * luminance). Before this change every analysis ran its own
 * `sharp(...).resize().extract().raw()` decode, and the stats cache key was the
 * region geometry alone — the buffer hash was only compared on hit — so entries
 * from different titles evicted each other and every render re-decoded.
 *
 * Contract proved here:
 * 1. one decode per (buffer object, canvas size): the memo hands the SAME
 *    promise to every consumer, a different canvas size gets its own;
 * 2. the decode-once + `sliceRgb` pipeline returns EXACTLY the values of the
 *    old resize → extract → removeAlpha → raw pipeline (byte-identical: no
 *    snapshot churn, no RENDER_VERSION need);
 * 3. the buffer identity is part of the cache key: two titles that share the
 *    same region geometry keep their own stats (no aliasing now that the hash
 *    is no longer compared on hit).
 */
import { describe, it, expect, beforeEach } from "vitest"
import sharp from "sharp"
import {
  STD_W,
  STD_H,
  LAND_W,
  LAND_H,
  luma,
  computeRegionStats,
  decodePosterRawCached,
  clearRegionStatsCache,
  type RegionStats,
} from "@/lib/image-utils"
import {
  topLuminance,
  bottomLuminance,
  topBandMeanRGB,
  bottomBandMeanRGB,
} from "@/lib/poster-render-helpers"
import { posterLogoZoneLuminance } from "@/lib/logo-contrast"
import { relativeLuminance } from "@/lib/accent-color"

function gradient(w: number, h: number, tone: number): Buffer {
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      data[i] = (Math.round((x / Math.max(1, w - 1)) * 255) + tone) % 256
      data[i + 1] = (Math.round((y / Math.max(1, h - 1)) * 255) + tone) % 256
      data[i + 2] = (x * 7 + y * 3 + tone) % 256
    }
  }
  return data
}

async function scene(w: number, h: number, tone = 0): Promise<Buffer> {
  return sharp(gradient(w, h, tone), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer()
}

/**
 * The pre-change pipeline, verbatim: resize (fit fill) → extract → removeAlpha
 * → raw → same two JS passes. Used as the byte-identity oracle.
 */
async function legacyRegionStats(
  buf: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  canvasW = STD_W,
  canvasH = STD_H,
): Promise<RegionStats> {
  const { data, info } = await sharp(buf)
    .resize(canvasW, canvasH, { fit: "fill" })
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const totalPixels = info.width * info.height
  let sum = 0
  let rSum = 0
  let gSum = 0
  let bSum = 0
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    sum += luma(r, g, b)
    rSum += r
    gSum += g
    bSum += b
  }
  const mean = sum / totalPixels
  const meanR = rSum / totalPixels
  const meanG = gSum / totalPixels
  const meanB = bSum / totalPixels
  let sqSum = 0
  for (let i = 0; i < data.length; i += 3) {
    const lum = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
    const d = lum - mean
    sqSum += d * d
  }
  return {
    mean,
    stdDev: Math.sqrt(sqSum / totalPixels),
    meanR,
    meanG,
    meanB,
    width: info.width,
    height: info.height,
  }
}

beforeEach(() => {
  clearRegionStatsCache()
})

describe("decodePosterRawCached: one decode per buffer and canvas", () => {
  it("hands the SAME pending decode to every consumer of the same canvas", async () => {
    const buf = await scene(STD_W, STD_H)
    const first = decodePosterRawCached(buf, STD_W, STD_H)
    const second = decodePosterRawCached(buf, STD_W, STD_H)
    expect(second).toBe(first)

    const raw = await first
    expect(raw.width).toBe(STD_W)
    expect(raw.height).toBe(STD_H)
    expect(raw.data.length).toBe(STD_W * STD_H * 3)
  })

  it("keeps one entry per canvas size (portrait luminance vs landscape band)", async () => {
    const buf = await scene(STD_W, STD_H)
    const portrait = decodePosterRawCached(buf, STD_W, STD_H)
    const landscape = decodePosterRawCached(buf, LAND_W, LAND_H)
    expect(landscape).not.toBe(portrait)
    const [p, l] = await Promise.all([portrait, landscape])
    expect(p.width).toBe(STD_W)
    expect(l.width).toBe(LAND_W)
  })

  it("drops a failed decode so the next caller retries instead of caching it", async () => {
    const notAnImage = Buffer.from("not-an-image")
    const first = decodePosterRawCached(notAnImage, STD_W, STD_H)
    await expect(first).rejects.toBeTruthy()
    const second = decodePosterRawCached(notAnImage, STD_W, STD_H)
    expect(second).not.toBe(first)
    await expect(second).rejects.toBeTruthy()
  })
})

describe("region stats: decode-once + sliceRgb is byte-identical to the old pipeline", () => {
  it("matches resize → extract → raw exactly (portrait top/bottom strips and logo zone)", async () => {
    const buf = await scene(STD_W, STD_H)
    const stripH = Math.max(Math.round(STD_H * 0.08), 3)
    const cases = [
      { l: 0, t: 0, w: STD_W, h: stripH },
      { l: 0, t: STD_H - stripH, w: STD_W, h: stripH },
      { l: 120, t: 300, w: 260, h: 150 },
    ]
    for (const c of cases) {
      const expected = await legacyRegionStats(buf, c.l, c.t, c.w, c.h)
      const actual = await computeRegionStats(buf, c.l, c.t, c.w, c.h)
      expect(actual).not.toBeNull()
      // Exact float equality: same pixels, same operations, same order.
      expect(actual!.mean).toBe(expected.mean)
      expect(actual!.stdDev).toBe(expected.stdDev)
      expect(actual!.meanR).toBe(expected.meanR)
      expect(actual!.meanG).toBe(expected.meanG)
      expect(actual!.meanB).toBe(expected.meanB)
      expect(actual!.width).toBe(expected.width)
      expect(actual!.height).toBe(expected.height)
    }
  })

  it("matches exactly on the explicit landscape canvas (band sampling)", async () => {
    const buf = await scene(LAND_W, LAND_H)
    const stripH = Math.max(Math.round(LAND_H * 0.08), 3)
    for (const top of [0, LAND_H - stripH]) {
      const expected = await legacyRegionStats(buf, 0, top, LAND_W, stripH, LAND_W, LAND_H)
      const actual = await computeRegionStats(buf, 0, top, LAND_W, stripH, { width: LAND_W, height: LAND_H })
      expect(actual!.mean).toBe(expected.mean)
      expect(actual!.stdDev).toBe(expected.stdDev)
      expect(actual!.meanR).toBe(expected.meanR)
      expect(actual!.meanG).toBe(expected.meanG)
      expect(actual!.meanB).toBe(expected.meanB)
    }
  })

  it("keeps the public analysis helpers on the same values", async () => {
    const buf = await scene(STD_W, STD_H)
    const stripH = Math.max(Math.round(STD_H * 0.08), 3)
    const top = await legacyRegionStats(buf, 0, 0, STD_W, stripH)
    const bottom = await legacyRegionStats(buf, 0, STD_H - stripH, STD_W, stripH)
    // No persistent analysis cache key: the helper must measure, not recall.
    expect(await topLuminance(buf, null)).toBe(top.mean / 255)
    expect(await bottomLuminance(buf, null)).toBe(bottom.mean / 255)
    expect(await topBandMeanRGB(buf, { cacheKey: null, canvasW: STD_W, canvasH: STD_H })).toEqual({
      r: top.meanR,
      g: top.meanG,
      b: top.meanB,
    })
    expect(await bottomBandMeanRGB(buf, { cacheKey: null, canvasW: STD_W, canvasH: STD_H })).toEqual({
      r: bottom.meanR,
      g: bottom.meanG,
      b: bottom.meanB,
    })
    const zone = await legacyRegionStats(buf, 120, 300, 260, 150)
    // posterLogoZoneLuminance returns WCAG relative luminance of the channel
    // means — compare through the same formula instead of duplicating it.
    const zoneLum = await posterLogoZoneLuminance(buf, { left: 120, top: 300, width: 260, height: 150 })
    expect(zoneLum).toBe(relativeLuminance(zone.meanR, zone.meanG, zone.meanB))
  })
})

describe("stats cache key: buffer identity is part of the key", () => {
  it("keeps one entry per title on identical region geometry (no aliasing)", async () => {
    const dark = await scene(STD_W, STD_H, 0)
    const light = await scene(STD_W, STD_H, 128)
    const stripH = Math.max(Math.round(STD_H * 0.08), 3)

    const a1 = await computeRegionStats(dark, 0, 0, STD_W, stripH)
    const b1 = await computeRegionStats(light, 0, 0, STD_W, stripH)
    // A third call for the FIRST title must return its own stats: with the hash
    // only compared on hit (old key) this entry had been overwritten by `light`
    // and would come back as `b1` or force a re-decode.
    const a2 = await computeRegionStats(dark, 0, 0, STD_W, stripH)

    expect(a1!.mean).not.toBe(b1!.mean)
    expect(a2).toBe(a1)
    expect(a2!.mean).toBe(a1!.mean)
    expect(a2!.meanR).toBe(a1!.meanR)
  })
})
