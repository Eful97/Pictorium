import { describe, expect, it } from "vitest"
import { buildQualityKnockoutSvg } from "@/lib/badge-svg-shared"
import sharp from "sharp"

const PAD = 14

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
      const [maskRect, bgRect] = rects(svg)
      expect(maskRect).toBeDefined()
      expect(bgRect).toBeDefined()
      // Same box: the cutout window must coincide with the tag underneath.
      for (const k of ["x", "y", "width", "height"] as const) {
        expect(maskRect[k]).toBe(bgRect[k])
      }
      // Same contained radius (not a full pill, not square): the drop shadow
      // is clipped by the mask, so a square mask leaks shadow wedges at the
      // box corners where the rounded tag is transparent.
      const boxH = h - PAD * 2
      expect(boxH).toBeGreaterThan(0)
      expect(w).toBeGreaterThan(h)
      expect(bgRect.rx).toBe(String(Math.round(boxH * 0.3)))
      expect(maskRect.rx).toBe(bgRect.rx)
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

  it("glyph cutouts stay transparent over an opaque white tag", async () => {
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    for (const tier of ["4K", "FHD"] as const) {
      const ko = await renderQualityKnockoutBadge(tier, 380)
      const { data } = await sharp(ko.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalW = ko.w - PAD * 2
      const boxH = ko.h - PAD * 2
      const r = Math.round(boxH * 0.3)
      let holes = 0
      let body = 0
      for (let y = PAD; y < PAD + boxH; y++) {
        for (let x = PAD; x < PAD + totalW; x++) {
          if (!insideRounded(x, y, PAD, PAD, totalW, boxH, r)) continue
          const i = (y * ko.w + x) * 4
          if (data[i + 3] === 0) holes++
          if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) body++
        }
      }
      expect(holes).toBeGreaterThan(50)
      expect(body).toBeGreaterThan(500)
    }
  }, 30000)
})
