import { describe, it, expect } from "vitest"
import {
  analyzeRootColors,
  findSceneTint,
  topEdgeAverage,
  bottomEdgeAverage,
} from "@/lib/accent-color"

/**
 * M3: the fused single-pass sampler must return bit-identical outputs to the
 * trio it replaces in useRootColors (findSceneTint scene branch + top/bottom
 * edge averages). Any divergence would change preview URLs (tl/bl/ac) and
 * therefore rendered bytes — this test pins exact equality.
 */

function solidRaw(w: number, h: number, r: number, g: number, b: number, a = 255): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = a
  }
  return buf
}

/** Deterministic pseudo-random buffer (gradient + checker + transparency mix). */
function mixedRaw(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  let seed = 123456789
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0
      buf[i] = Math.floor((x / w) * 255 * (checker ? 1 : 0.3) + next() * 20)
      buf[i + 1] = Math.floor((y / h) * 200 + next() * 20)
      buf[i + 2] = Math.floor(255 - (x / w) * 150 * (checker ? 0.5 : 1))
      buf[i + 3] = next() < 0.05 ? 0 : 255
    }
  }
  return buf
}

function expectIdentical(pixels: Buffer, w: number, h: number, genre: string) {
  const fused = analyzeRootColors(pixels, w, h, genre)
  expect(fused.tint).toEqual(findSceneTint(pixels, w, h, genre))
  expect(fused.top).toEqual(topEdgeAverage(pixels, w, h))
  expect(fused.bottom).toEqual(bottomEdgeAverage(pixels, w, h))
}

describe("analyzeRootColors single-pass equivalence", () => {
  it("solid saturated color matches the trio exactly", () => {
    expectIdentical(solidRaw(100, 100, 20, 180, 30), 100, 100, "Action")
  })

  it("solid amber matches the trio exactly", () => {
    expectIdentical(solidRaw(120, 90, 229, 142, 38), 120, 90, "Action")
  })

  it("flat grey (monochrome fallback) matches the trio exactly", () => {
    expectIdentical(solidRaw(100, 100, 128, 128, 128), 100, 100, "Animation")
  })

  it("pure black matches the trio exactly (NaN-guard path)", () => {
    expectIdentical(solidRaw(64, 48, 0, 0, 0), 64, 48, "Dramma")
  })

  it("mixed gradient/checker/alpha buffer matches the trio exactly", () => {
    expectIdentical(mixedRaw(342, 200), 342, 200, "Dramma")
  })

  it("odd portrait dimensions match the trio exactly", () => {
    expectIdentical(mixedRaw(171, 255), 171, 255, "Crime")
  })

  it("tiny buffer matches the trio exactly", () => {
    expectIdentical(mixedRaw(9, 7), 9, 7, "Commedia")
  })

  it("fully transparent buffer matches the trio exactly (empty fallback)", () => {
    expectIdentical(solidRaw(50, 50, 200, 100, 50, 0), 50, 50, "Action")
  })
})
