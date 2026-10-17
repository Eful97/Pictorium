/**
 * Fresh offscreen numeral oversize regression (task1/5).
 *
 * Valid Fresh rank 100 + tscale 200 + tox/toy ±2000 produces an oversized
 * offscreen rim layer at fresh-layout.ts:1035-1038 (portrait 679x620 on
 * 500x750, landscape 825x543 on 768x432). fitCompositeToCanvas ignores
 * bounds and the actual sharp compositor throws
 * ("Image to composite must have same dimensions or smaller").
 *
 * Real production path only (no mocks hiding the bug):
 *   freshGeometry -> renderFreshGlassNumeral -> composeFreshOverlay ->
 *   fitCompositeToCanvas (poster-service.ts:3705 gate) ->
 *   sharp(base).composite(layers) (actual compositor).
 * Deterministic local buffers only: no fetches, no dev server.
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  composeFreshOverlay,
  freshGeometry,
  renderFreshGlassNumeral,
  type ComposeFreshInput,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { fitCompositeToCanvas } from "@/lib/poster-render-helpers"
import { STD_W, STD_H, LAND_W, LAND_H } from "@/lib/image-utils"

const CW_P = STD_W // 500
const CH_P = STD_H // 750
const CW_L = LAND_W // 768
const CH_L = LAND_H // 432

async function solidBase(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 58, g: 74, b: 122 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
}

async function smallLogo(): Promise<{ png: Buffer; w: number; h: number }> {
  const png = await sharp({
    create: { width: 180, height: 60, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return { png, w: 180, h: 60 }
}

async function smallProvider(): Promise<{ png: Buffer; w: number; h: number }> {
  const png = await sharp({
    create: { width: 120, height: 40, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return { png, w: 120, h: 40 }
}

const META: FreshMetaInput = {
  badgesEnabled: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  separateRatingsEnabled: false,
  customRatingsEnabled: false,
  genreName: "Drama",
  year: "2024",
  voteAverage: 8.2,
  separateRatings: [],
  customRatings: [],
}

async function dims(png: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(png).metadata()
  return { w: m.width ?? -1, h: m.height ?? -1 }
}

async function compositeMustSucceed(
  CW: number,
  CH: number,
  rank: number | null,
  transforms: ComposeFreshInput["transforms"],
): Promise<void> {
  const posterBuf = await solidBase(CW, CH)
  const logo = await smallLogo()
  const provider = await smallProvider()
  const input: ComposeFreshInput = { posterBuf, CW, CH, rank, meta: META, logo, provider, transforms }
  const layers = await composeFreshOverlay(input)
  // Every emitted layer must be canvas-compatible (sharp throws on oversize
  // overlays regardless of position).
  for (const l of layers) {
    const d = await dims(l.input)
    expect(d.w, `layer png width ${d.w} on ${CW}x${CH} rank=${rank}`).toBeLessThanOrEqual(CW)
    expect(d.h, `layer png height ${d.h} on ${CW}x${CH} rank=${rank}`).toBeLessThanOrEqual(CH)
  }
  const safe = (
    await Promise.all(layers.map((layer) => fitCompositeToCanvas(layer, CW, CH)))
  ).filter((l): l is NonNullable<typeof l> => l !== null)
  for (const l of safe) {
    const d = await dims(l.input)
    expect(d.w, `kept layer width ${d.w} on ${CW}x${CH}`).toBeLessThanOrEqual(CW)
    expect(d.h, `kept layer height ${d.h} on ${CW}x${CH}`).toBeLessThanOrEqual(CH)
  }
  // Actual sharp compositor (same shape as poster-service final composite).
  await sharp(posterBuf)
    .composite(safe.map((l) => ({ input: l.input, left: l.left, top: l.top })))
    .jpeg({ quality: 82 })
    .toBuffer()
}

describe("fresh offscreen numeral oversize (task1)", () => {
  it("rank100 tscale200 extreme offsets composite on both shapes/signs", async () => {
    await compositeMustSucceed(CW_P, CH_P, 100, {
      numeralScale: 200,
      numeralOffsetX: 2000,
      numeralOffsetY: 2000,
    })
    await compositeMustSucceed(CW_P, CH_P, 100, {
      numeralScale: 200,
      numeralOffsetX: -2000,
      numeralOffsetY: -2000,
    })
    await compositeMustSucceed(CW_L, CH_L, 100, {
      numeralScale: 200,
      numeralOffsetX: 2000,
      numeralOffsetY: 2000,
    })
    await compositeMustSucceed(CW_L, CH_L, 100, {
      numeralScale: 200,
      numeralOffsetX: -2000,
      numeralOffsetY: -2000,
    })
  }, 120000)

  it("neutral rank100 controls still composite (no behavior change)", async () => {
    await compositeMustSucceed(CW_P, CH_P, 100, null)
    await compositeMustSucceed(CW_L, CH_L, 100, null)
  }, 120000)

  it("all valid ranks 1..100 stay canvas-compatible at scale/offset extremes", async () => {
    const posterP = await solidBase(CW_P, CH_P)
    const posterL = await solidBase(CW_L, CH_L)
    const extremes: ComposeFreshInput["transforms"][] = [
      { numeralScale: 200, numeralOffsetX: 2000, numeralOffsetY: 2000 },
      { numeralScale: 200, numeralOffsetX: -2000, numeralOffsetY: -2000 },
    ]
    for (let rank = 1; rank <= 100; rank++) {
      for (const t of extremes) {
        const geoP = freshGeometry(CW_P, CH_P, rank, t)
        if (geoP.numeral) {
          const num = await renderFreshGlassNumeral(posterP, CW_P, CH_P, geoP.numeral)
          // renderFreshGlassNumeral may return null when the numeral is fully
          // offscreen (nothing visible to composite).
          if (num) {
            const d = await dims(num.png)
            expect(d.w, `portrait rank=${rank} numeral width`).toBeLessThanOrEqual(CW_P)
            expect(d.h, `portrait rank=${rank} numeral height`).toBeLessThanOrEqual(CH_P)
            expect(num.w, `portrait rank=${rank} declared w`).toBeLessThanOrEqual(CW_P)
            expect(num.h, `portrait rank=${rank} declared h`).toBeLessThanOrEqual(CH_P)
          }
        }
        const geoL = freshGeometry(CW_L, CH_L, rank, t)
        if (geoL.numeral) {
          const num = await renderFreshGlassNumeral(posterL, CW_L, CH_L, geoL.numeral)
          if (num) {
            const d = await dims(num.png)
            expect(d.w, `landscape rank=${rank} numeral width`).toBeLessThanOrEqual(CW_L)
            expect(d.h, `landscape rank=${rank} numeral height`).toBeLessThanOrEqual(CH_L)
            expect(num.w, `landscape rank=${rank} declared w`).toBeLessThanOrEqual(CW_L)
            expect(num.h, `landscape rank=${rank} declared h`).toBeLessThanOrEqual(CH_L)
          }
        }
      }
    }
    // Full overlay composite for a sampled subset (keeps runtime bounded while
    // the loop above covers every rank at the numeral-layer level).
    for (const rank of [1, 7, 10, 20, 100]) {
      await compositeMustSucceed(CW_P, CH_P, rank, extremes[0])
      await compositeMustSucceed(CW_L, CH_L, rank, extremes[1])
    }
  }, 300000)

  it("unranked fresh stays throwable-free at the same extremes", async () => {
    await compositeMustSucceed(CW_P, CH_P, null, {
      numeralScale: 200,
      numeralOffsetX: 2000,
      numeralOffsetY: 2000,
    })
    await compositeMustSucceed(CW_L, CH_L, null, {
      numeralScale: 200,
      numeralOffsetX: -2000,
      numeralOffsetY: -2000,
    })
  }, 120000)
})
