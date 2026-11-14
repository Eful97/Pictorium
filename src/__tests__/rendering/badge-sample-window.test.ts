import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { badgeSampleWindow, topBadgeSampleAnchor } from "@/lib/badge-layout"
import { STD_W, topLuminance } from "@/lib/poster-render-helpers"
import type { RankingBadgeStyle } from "@/lib/badge-styles"
import { TOP_LIGHT_LUMINANCE } from "@/lib/constants"

describe("badgeSampleWindow", () => {
  it("center window on portrait", () => {
    const w = badgeSampleWindow("center", 500)
    expect(w.left).toBe(125)
    expect(w.width).toBe(250)
  })
  it("left window", () => {
    const w = badgeSampleWindow("left", 500)
    expect(w.left).toBe(0)
    expect(w.width).toBe(200)
  })
  it("right window", () => {
    const w = badgeSampleWindow("right", 500)
    expect(w.left).toBe(300)
    expect(w.width).toBe(200)
  })
  it("landscape: windows in STD_W units sample the right part of a 768x432 base", async () => {
    // Sampling always resizes to the STD 500x750 canvas, so the route must
    // build windows in STD_W units (LAND_W units shifted/truncated them).
    const W = 768, H = 432
    const raw = Buffer.alloc(W * H * 3)
    for (let y = 0; y < H; y++) raw.fill(255, y * W * 3, (y * W + Math.round(W * 0.4)) * 3)
    const buf = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()
    expect(await topLuminance(buf, null, badgeSampleWindow("left", STD_W))).toBeGreaterThan(0.95)
    expect(await topLuminance(buf, null, badgeSampleWindow("right", STD_W))).toBeLessThan(0.05)
  })
})

describe("topBadgeSampleAnchor", () => {
  it("default/pill/editoriale/split -> center", () => {
    for (const style of ["default", "pill", "editoriale", "split"] as RankingBadgeStyle[]) {
      expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: style, ribbonSide: "left" })).toBe("center")
    }
  })
  it("corner -> left", () => {
    expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: "corner", ribbonSide: "left" })).toBe("left")
  })
  it("netflix side left/right", () => {
    expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: "netflix", ribbonSide: "left" })).toBe("left")
    expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: "netflix", ribbonSide: "right" })).toBe("right")
  })
  it("number at right corner -> right", () => {
    expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: "number", ribbonSide: "right", extraBadgeStyle: null })).toBe("right")
  })
})

async function makeStripBuffer(centerHex: string, sideHex: string): Promise<Buffer> {
  const w = 500, h = 750
  const stripH = Math.max(Math.round(h * 0.08), 3)
  // build raw pixels
  const raw = Buffer.alloc(w * h * 3)
  const parse = (hex: string) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
  const center = parse(centerHex), side = parse(sideHex)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inStrip = y < stripH
      const isCenter = x >= Math.round(w*0.25) && x < Math.round(w*0.75)
      const col = inStrip ? (isCenter ? center : side) : [128,128,128]
      const i = (y*w+x)*3
      raw[i]=col[0]; raw[i+1]=col[1]; raw[i+2]=col[2]
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

describe("topLuminance window polarity", () => {
  it("center beige with dark sides: full strip dark, window center light", async () => {
    const buf = await makeStripBuffer("#D2B48C", "#000000")
    const full = await topLuminance(buf, null)
    const win = await topLuminance(buf, null, badgeSampleWindow("center", 500))
    expect(full).toBeLessThanOrEqual(TOP_LIGHT_LUMINANCE)
    expect(win).toBeGreaterThan(TOP_LIGHT_LUMINANCE)
  })
  it("inverse: center dark, sides light", async () => {
    const buf = await makeStripBuffer("#000000", "#ffffff")
    const win = await topLuminance(buf, null, badgeSampleWindow("center", 500))
    expect(win).toBeLessThanOrEqual(TOP_LIGHT_LUMINANCE)
  })
  it("cache: two windows give different values", async () => {
    const buf = await makeStripBuffer("#D2B48C", "#000000")
    // Same buffer and cacheKey: the window must be part of the cache key.
    const side = await topLuminance(buf, "k", badgeSampleWindow("left", 500))
    const center = await topLuminance(buf, "k", badgeSampleWindow("center", 500))
    expect(center).not.toBe(side)
  })
})