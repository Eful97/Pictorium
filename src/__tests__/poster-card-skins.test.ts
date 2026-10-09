import { readFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  CARD_SKIN_LAYOUTS,
  CARD_SKIN_NEUTRAL_ACCENT,
  STREMIO_CARD_SKIN_PALETTE,
  cardSkinBackgroundSvg,
  cardSkinPalette,
  isCardSkin,
  isValidCardAccentHex,
  resolveCardSkinAccent,
  type CardSkin,
} from "@/lib/card-layout-skins"
import { LAND_H, LAND_W } from "@/lib/constants"
import { STD_H, STD_W } from "@/lib/image-utils"

const SKINS: CardSkin[] = ["provider-glass", "nuvio", "stremio"]
const SHAPES = [
  { name: "poster", width: STD_W, height: STD_H },
  { name: "landscape", width: LAND_W, height: LAND_H },
] as const

async function rasterize(svg: string) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { png, data, info }
}

function alphaViolations(data: Buffer, width: number) {
  let invalid = 0
  let firstX = -1
  let firstY = -1
  let firstValue = -1
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      if (invalid === 0) {
        const pixel = (i - 3) / 4
        firstX = pixel % width
        firstY = Math.floor(pixel / width)
        firstValue = data[i]
      }
      invalid++
    }
  }
  return { invalid, firstX, firstY, firstValue }
}

function expectFullyOpaque(data: Buffer, info: { width: number; height: number; channels: number }) {
  expect(info.channels).toBe(4)
  const { invalid, firstX, firstY, firstValue } = alphaViolations(data, info.width)
  expect(
    invalid,
    invalid === 0
      ? "opaque"
      : `${invalid} non-opaque alpha pixel(s); first at x=${firstX} y=${firstY} alpha=${firstValue}`,
  ).toBe(0)
}

function blackViolations(data: Buffer, width: number) {
  let invalid = 0
  let firstX = -1
  let firstY = -1
  let firstR = -1
  let firstG = -1
  let firstB = -1
  let firstA = -1
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 255) {
      if (invalid === 0) {
        const pixel = i / 4
        firstX = pixel % width
        firstY = Math.floor(pixel / width)
        firstR = data[i]
        firstG = data[i + 1]
        firstB = data[i + 2]
        firstA = data[i + 3]
      }
      invalid++
    }
  }
  return { invalid, firstX, firstY, firstR, firstG, firstB, firstA }
}

function expectUniformOpaqueBlack(
  data: Buffer,
  info: { width: number; height: number; channels: number },
) {
  expect(info.channels).toBe(4)
  const { invalid, firstX, firstY, firstR, firstG, firstB, firstA } = blackViolations(
    data,
    info.width,
  )
  expect(
    invalid,
    invalid === 0
      ? "uniform black"
      : `${invalid} non-black pixel(s); first at x=${firstX} y=${firstY} rgba=(${firstR},${firstG},${firstB},${firstA})`,
  ).toBe(0)
}

describe("poster card skins (shared glass backgrounds)", () => {
  it("covers exactly the three skins with no new layout params", () => {
    expect([...CARD_SKIN_LAYOUTS]).toEqual(["provider-glass", "nuvio", "stremio"])
    for (const skin of SKINS) expect(isCardSkin(skin)).toBe(true)
    for (const bad of ["standard", "fresh", "glass", "", null, undefined, 42]) {
      expect(isCardSkin(bad)).toBe(false)
    }
  })

  it("rasterizes all 3 skins x 2 shapes at exact dimensions, fully opaque", async () => {
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        const svg = cardSkinBackgroundSvg(skin, shape.width, shape.height, "#E50914")
        expect(svg).not.toBeNull()
        const { info, data } = await rasterize(svg!)
        expect(info.width).toBe(shape.width)
        expect(info.height).toBe(shape.height)
        expectFullyOpaque(data, info)
      }
    }
  }, 60000)

  it("paints nuvio as uniform opaque black on both shapes", async () => {
    for (const shape of SHAPES) {
      const svg = cardSkinBackgroundSvg("nuvio", shape.width, shape.height, "#E50914")
      expect(svg).not.toBeNull()
      const { data, info } = await rasterize(svg!)
      expect(info.width).toBe(shape.width)
      expect(info.height).toBe(shape.height)
      expectUniformOpaqueBlack(data, info)
    }
  }, 60000)

  it("keeps the stremio fixed violet palette regardless of provider accent", async () => {
    expect(cardSkinPalette("stremio", "#E50914")).toEqual(STREMIO_CARD_SKIN_PALETTE)
    expect(cardSkinPalette("stremio", "#00A8E1")).toEqual(STREMIO_CARD_SKIN_PALETTE)
    expect(cardSkinPalette("stremio")).toEqual(STREMIO_CARD_SKIN_PALETTE)
    const a = cardSkinBackgroundSvg("stremio", STD_W, STD_H, "#E50914")
    const b = cardSkinBackgroundSvg("stremio", STD_W, STD_H, "#00A8E1")
    const c = cardSkinBackgroundSvg("stremio", STD_W, STD_H)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(a).toBe(c)
    const ra = await rasterize(a!)
    const rb = await rasterize(b!)
    expect(Buffer.compare(ra.data, rb.data)).toBe(0)
  }, 60000)

  it("changes provider-glass output with the accent, stable neutral fallback when missing", async () => {
    const red = cardSkinBackgroundSvg("provider-glass", STD_W, STD_H, "#E50914")
    const blue = cardSkinBackgroundSvg("provider-glass", STD_W, STD_H, "#00A8E1")
    expect(red).not.toBeNull()
    expect(blue).not.toBeNull()
    expect(red).not.toBe(blue)
    const rr = await rasterize(red!)
    const br = await rasterize(blue!)
    expect(rr.info.width).toBe(STD_W)
    expect(br.info.height).toBe(STD_H)
    expectFullyOpaque(rr.data, rr.info)
    expectFullyOpaque(br.data, br.info)
    let diff = 0
    for (let i = 0; i < rr.data.length; i += 4) {
      if (
        rr.data[i] !== br.data[i] ||
        rr.data[i + 1] !== br.data[i + 1] ||
        rr.data[i + 2] !== br.data[i + 2]
      ) {
        diff++
      }
    }
    expect(diff).toBeGreaterThan(0)

    const neutral = cardSkinBackgroundSvg(
      "provider-glass",
      STD_W,
      STD_H,
      CARD_SKIN_NEUTRAL_ACCENT,
    )
    for (const missing of [undefined, null, "", "red", "#fff", "#gggggg", 42]) {
      const svg = cardSkinBackgroundSvg("provider-glass", STD_W, STD_H, missing)
      expect(svg).toBe(neutral)
    }
  }, 60000)

  it("sanitizes hostile accent input: fallback output, no markup passthrough", () => {
    const hostile = [
      '#ff0000"/><script>alert(1)</script>',
      "#E50914 onload=alert(1)",
      "<svg><script>",
      "javascript:alert(1)",
      "#12345",
      "#1234567",
    ]
    const neutral = cardSkinBackgroundSvg(
      "provider-glass",
      STD_W,
      STD_H,
      CARD_SKIN_NEUTRAL_ACCENT,
    )
    for (const evil of hostile) {
      expect(isValidCardAccentHex(evil)).toBe(false)
      expect(resolveCardSkinAccent(evil)).toBe(CARD_SKIN_NEUTRAL_ACCENT)
      const svg = cardSkinBackgroundSvg("provider-glass", STD_W, STD_H, evil)!
      expect(svg).toBe(neutral)
      expect(svg).not.toContain(evil)
    }
    expect(isValidCardAccentHex("#e50914")).toBe(true)
    expect(resolveCardSkinAccent("#e50914")).toBe("#E50914")
    expect(isValidCardAccentHex("#E50914")).toBe(true)
  })

  it("supports arbitrary valid dimensions with a bounded decorative frame", async () => {
    for (const [w, h] of [
      [1000, 1500],
      [500, 500],
      [200, 100],
      [64, 64],
    ] as const) {
      for (const skin of SKINS) {
        const svg = cardSkinBackgroundSvg(skin, w, h, "#2D7DFF")
        expect(svg).not.toBeNull()
        const { data, info } = await rasterize(svg!)
        expect(info.width).toBe(w)
        expect(info.height).toBe(h)
        expectFullyOpaque(data, info)
      }
    }
  }, 60000)

  it("keeps a sensible render order: atmosphere first, container, lips last", () => {
    const svg = cardSkinBackgroundSvg("provider-glass", STD_W, STD_H, "#E50914")!
    const atmoFill = svg.indexOf('<rect width="')
    const container = svg.indexOf("<g filter=")
    const topLip = svg.indexOf("url(#topFlare)")
    const bottomLip = svg.indexOf("url(#bottomRimFlare)")
    expect(atmoFill).toBeGreaterThanOrEqual(0)
    expect(container).toBeGreaterThan(atmoFill)
    expect(topLip).toBeGreaterThan(container)
    expect(bottomLip).toBeGreaterThan(topLip)
    expect(svg.endsWith("</svg>")).toBe(true)
  })

  it("returns null for unknown skins and non-finite dimensions, never invented", () => {
    for (const badSkin of ["standard", "", null, undefined] as unknown as CardSkin[]) {
      expect(cardSkinBackgroundSvg(badSkin, STD_W, STD_H)).toBeNull()
    }
    for (const badDim of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as number[]) {
      for (const skin of SKINS) {
        expect(cardSkinBackgroundSvg(skin, badDim, STD_H)).toBeNull()
        expect(cardSkinBackgroundSvg(skin, STD_W, badDim)).toBeNull()
      }
    }
    expect(cardSkinPalette("nuvio", "#E50914")).toBeNull()
  })

  it("detects helper violations at first, middle, and last pixels", () => {
    const width = 4
    const opaque = Buffer.alloc(width * 1 * 4, 255)
    expect(alphaViolations(opaque, width).invalid).toBe(0)
    for (const badByte of [3, 7, 15]) {
      const buf = Buffer.from(opaque)
      buf[badByte] = 0
      const hit = alphaViolations(buf, width)
      expect(hit.invalid).toBe(1)
      expect(hit.firstX).toBe(((badByte - 3) / 4) % width)
    }

    const black = Buffer.alloc(width * 1 * 4)
    for (let i = 3; i < black.length; i += 4) black[i] = 255
    expect(blackViolations(black, width).invalid).toBe(0)
    const channels: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [11, 0],
    ]
    for (const [byte, value] of channels) {
      const buf = Buffer.from(black)
      buf[byte] = value
      expect(blackViolations(buf, width).invalid).toBe(1)
    }
    const last = Buffer.from(black)
    last[last.length - 1] = 0
    const lastHit = blackViolations(last, width)
    expect(lastHit.invalid).toBe(1)
    expect([lastHit.firstX, lastHit.firstY]).toEqual([3, 0])
  })

  it("stays a pure string builder: no sharp, blur roundtrip, fetch, or provider lookup", () => {
    const raw = readFileSync(join(__dirname, "..", "lib", "card-layout-skins.ts"), "utf8")
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1")
    expect(src).not.toMatch(/from\s+["']sharp["']/)
    expect(src).not.toContain("feGaussianBlur")
    expect(src).not.toMatch(/fetch\s*\(/)
    expect(src).not.toMatch(/catalogKey/)
  })
})
