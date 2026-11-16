import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { opaqueComponents, tightenBoxesToInk } from "@/lib/poster-render-helpers"

describe("editor frames tightened on the painted ink", () => {
  it("splits two plates whose padded boxes overlap, ignoring soft shadow", async () => {
    // Due placche opache 40×20 a y=10 e y=40, ombra tenue (alpha 30) tra loro.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80">
      <rect x="0" y="30" width="60" height="12" fill="#000" fill-opacity="0.12"/>
      <rect x="10" y="10" width="40" height="20" fill="#fff"/>
      <rect x="10" y="40" width="40" height="20" fill="#fff"/></svg>`
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const comps = await opaqueComponents(png)
    expect(comps).toHaveLength(2)
    // Box grezzi con pad: si sovrappongono (0..45 e 25..80).
    const boxes = [{ id: "a", left: 0, top: 0, w: 60, h: 45 }, { id: "b", left: 0, top: 25, w: 60, h: 55 }]
    const [a, b] = tightenBoxesToInk(boxes, comps)
    expect(a).toMatchObject({ id: "a", left: 10, top: 10, w: 40, h: 20 })
    expect(b).toMatchObject({ id: "b", left: 10, top: 40, w: 40, h: 20 })
  })

  it("leaves a box with no ink of its own untouched", () => {
    const box = { left: 0, top: 0, w: 10, h: 10 }
    expect(tightenBoxesToInk([box], [{ left: 50, top: 50, w: 5, h: 5 }])[0]).toBe(box)
  })
})
