import { describe, expect, it } from "vitest"
import { buildQualityKnockoutSvg, buildAgeKnockoutSvg, KNOCKOUT_INK_OPACITY } from "@/lib/badge-svg-shared"
import sharp from "sharp"

const PAD = 14
/** Approved quality-knockout ink: black alpha ~0.70 (30% artwork shows). */
const INK_ALPHA = 0.70 * 255

function rects(svg: string): Array<Record<string, string>> {
  return [...svg.matchAll(/<rect ([^>]*?)\/>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  )
}

/** True when (x,y) lies inside the rounded box (ox,oy,totalW,boxH,r). */
function insideRounded(
  x: number, y: number, ox: number, oy: number, totalW: number, boxH: number, r: number,
): boolean {
  if (x < ox || x >= ox + totalW || y < oy || y >= oy + boxH) return false
  const cx = Math.min(Math.max(x, ox + r), ox + totalW - r)
  const cy = Math.min(Math.max(y, oy + r), oy + boxH - r)
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r
}

describe("quality knockout mask geometry", () => {
  it("mask rect and tag rect share the same box and radius", () => {
    for (const tier of ["4K", "FHD"] as const) {
      const { svg, w, h } = buildQualityKnockoutSvg(tier, 17)
      // The tag cut-out window is the rect inside `<mask id="qkm">`; the tag
      // body is the rect that consumes it (the builder also emits the light
      // outer-shadow mask/layer, so the rects are selected by role, not order).
      const maskBody = svg.match(/<mask id="qkm">([\s\S]*?)<\/mask>/)![1]
      const maskRect = rects(maskBody)[0]
      const bgRect = rects(svg).find((r) => r.mask === "url(#qkm)")
      expect(maskRect).toBeDefined()
      expect(bgRect).toBeDefined()
      // Same box: the cutout window must coincide with the tag underneath.
      for (const k of ["x", "y", "width", "height"] as const) {
        expect(maskRect[k]).toBe(bgRect![k])
      }
      // Same contained radius (not a full pill, not square): the drop shadow
      // is clipped by the mask, so a square mask leaks shadow wedges at the
      // box corners where the rounded tag is transparent.
      const boxH = h - PAD * 2
      expect(boxH).toBeGreaterThan(0)
      expect(w).toBeGreaterThan(h)
      expect(bgRect!.rx).toBe(String(Math.round(boxH * 0.3)))
      expect(maskRect.rx).toBe(bgRect!.rx)
    }
  })

  it("no shadow leaks outside the rounded tag at the box corners", async () => {
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    for (const tier of ["4K", "FHD"] as const) {
      const ko = await renderQualityKnockoutBadge(tier, 380)
      const { data } = await sharp(ko.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalW = ko.w - PAD * 2
      const boxH = ko.h - PAD * 2
      const r = Math.round(boxH * 0.3)
      let leak = 0
      for (let y = PAD; y < PAD + boxH; y++) {
        for (let x = PAD; x < PAD + totalW; x++) {
          if (insideRounded(x, y, PAD, PAD, totalW, boxH, r)) continue
          const i = (y * ko.w + x) * 4
          // White-tag antialiasing is bright; only a leaked black shadow is dark.
          if (data[i + 3] > 16 && Math.max(data[i], data[i + 1], data[i + 2]) < 110) leak++
        }
      }
      expect(leak).toBe(0)
    }
  }, 30000)

  it("paints a light shadow ring OUTSIDE the tag (never over the cut-outs)", async () => {
    const { renderQualityKnockoutBadge, renderAgeKnockoutBadge } = await import("@/lib/svg-badge")
    const { renderQualityBadgeGroup } = await import("@/lib/poster-service")

    /** Dark (shadow) pixels in the pad ring around the tag box: the tag body
     *  edge antialiasing is bright and is not an outer shadow. */
    async function ring(png: Buffer, w: number, h: number, radiusFactor: number, opts?: { skipTopPad?: boolean }) {
      const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalW = w - PAD * 2
      const boxH = h - PAD * 2
      const r = Math.round(boxH * radiusFactor)
      let lit = 0
      let maxAlpha = 0
      let opaqueDark = 0
      for (let y = opts?.skipTopPad ? PAD : 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (insideRounded(x, y, PAD, PAD, totalW, boxH, r)) continue
          const i = (y * w + x) * 4
          const a = data[i + 3]
          if (a <= 8) continue
          if (Math.max(data[i], data[i + 1], data[i + 2]) > 160) continue
          lit++
          if (a > maxAlpha) maxAlpha = a
          if (a > 200) opaqueDark++
        }
      }
      return { lit, maxAlpha, opaqueDark }
    }

    // Tier knockout: the shared 3D filter is applied to the masked rect, so
    // the mask cuts its halo away — the tag needs its own LIGHT outer ring to
    // stay readable on bright artwork.
    for (const tier of ["4K", "FHD"] as const) {
      const ko = await renderQualityKnockoutBadge(tier, 380)
      const stats = await ring(ko.png, ko.w, ko.h, 0.30)
      expect(stats.lit, `${tier} ring`).toBeGreaterThan(150)
      expect(stats.maxAlpha, `${tier} light`).toBeGreaterThan(12)
      expect(stats.maxAlpha, `${tier} light`).toBeLessThan(110)
      expect(stats.opaqueDark, `${tier} opaque shadow`).toBe(0)
    }

    // A/V knockout marks use the same white tag: same light outer ring.
    for (const formats of [["atmos"], ["dv", "atmos"], ["imax"]] as const) {
      const group = await renderQualityBadgeGroup("4K", "knockout", [...formats], 380, false)
      expect(group, formats.join("+")).not.toBeNull()
      const item = group!.items[group!.items.length - 1]
      const cell = await sharp(group!.png)
        .extract({ left: item.left, top: item.top, width: item.w, height: item.h })
        .png()
        .toBuffer()
      // Stacked group cells overlap the tier bitmap by `PAD * 2 - gap` px: the
      // top pad row belongs to the neighbor, so it must not be read as this
      // mark's halo (the tier's ink now reaches there). The left/right/bottom
      // pad is entirely this mark's own shadow ring.
      const stats = await ring(cell, item.w, item.h, 0.30, { skipTopPad: true })
      expect(stats.lit, `${formats.join("+")} ring`).toBeGreaterThan(150)
      expect(stats.maxAlpha, `${formats.join("+")} light`).toBeLessThan(110)
      expect(stats.opaqueDark, `${formats.join("+")} opaque shadow`).toBe(0)
    }

    // Age knockout keeps its own dedicated builder: untouched by the
    // quality-only outer ring (no new filter/mask in its SVG).
    const age = await renderAgeKnockoutBadge("VM14", 380)
    const ageSvg = buildAgeKnockoutSvg("VM14", 17).svg
    expect(ageSvg).not.toContain("url(#qko)")
    // Age cut-outs stay genuinely transparent: the ink contract is quality-only.
    expect(ageSvg).not.toContain('opacity="0.7"')
    const ageStats = await ring(age.png, age.w, age.h, 0.30)
    expect(ageStats.lit).toBe(0)
  }, 60000)

  it("paints the quality glyph cut-outs with 70% black ink over the artwork", async () => {
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    expect(KNOCKOUT_INK_OPACITY).toBe(0.70)
    for (const tier of ["4K", "FHD"] as const) {
      const ko = await renderQualityKnockoutBadge(tier, 380)
      const { data } = await sharp(ko.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalW = ko.w - PAD * 2
      const boxH = ko.h - PAD * 2
      const r = Math.round(boxH * 0.3)
      let ink = 0
      let body = 0
      const inkSpots: Array<[number, number]> = []
      for (let y = PAD; y < PAD + boxH; y++) {
        for (let x = PAD; x < PAD + totalW; x++) {
          if (!insideRounded(x, y, PAD, PAD, totalW, boxH, r)) continue
          const i = (y * ko.w + x) * 4
          // Ink layer: 70% black over the transparent cut-out (alpha ≈ 0.70,
          // RGB ≈ 0) — not an empty hole, not 70% over the opaque white body.
          if (
            Math.abs(data[i + 3] - INK_ALPHA) <= 4 &&
            Math.max(data[i], data[i + 1], data[i + 2]) < 30
          ) {
            ink++
            inkSpots.push([x, y])
          }
          if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) body++
        }
      }
      expect(ink, `${tier} ink glyph`).toBeGreaterThan(50)
      expect(body, `${tier} white body`).toBeGreaterThan(500)
      // Compositing proof: the ink blends with the backdrop behind the
      // cut-outs (30% artwork contribution). Painting 70% black over the
      // opaque white tag would ignore the backdrop color entirely.
      const bg = { r: 200, g: 10, b: 10 }
      const comp = await sharp({
        create: { width: ko.w, height: ko.h, channels: 4, background: { ...bg, alpha: 1 } },
      })
        .composite([{ input: ko.png }])
        .png()
        .toBuffer()
      const { data: cd } = await sharp(comp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const [x, y] of inkSpots.slice(0, 200)) {
        const i = (y * ko.w + x) * 4
        expect(Math.abs(cd[i] - bg.r * (1 - KNOCKOUT_INK_OPACITY)), `${tier} backdrop r`).toBeLessThanOrEqual(3)
        expect(Math.abs(cd[i + 1] - bg.g * (1 - KNOCKOUT_INK_OPACITY)), `${tier} backdrop g`).toBeLessThanOrEqual(3)
        expect(Math.abs(cd[i + 2] - bg.b * (1 - KNOCKOUT_INK_OPACITY)), `${tier} backdrop b`).toBeLessThanOrEqual(3)
      }
    }
  }, 30000)
})
