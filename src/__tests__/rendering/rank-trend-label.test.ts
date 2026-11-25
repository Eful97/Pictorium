import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { attachRankTrendArrow, buildRankTrendArrowSvg, placeRankTrendArrow, rankTrendDirection, rankTrendFromPin, rankTrendModeFor } from "@/lib/rank-trend-label"
import type { ChartFamilyPin } from "@/lib/chart-generation"

const pin = (rows: Array<Record<string, unknown>>): ChartFamilyPin =>
  ({ id: "20261125-12", snapshot: { generation: "20261125-12", group: "g", family: "jw:movie:charts", status: "ok", rows, fetchedAt: 0, publishedAt: 0 } }) as unknown as ChartFamilyPin

describe("rankTrendDirection", () => {
  it("maps UP/DOWN and ignores everything else", () => {
    expect(rankTrendDirection({ trend: "UP" })).toBe("up")
    expect(rankTrendDirection({ trend: "DOWN" })).toBe("down")
    expect(rankTrendDirection({ trend: "STABLE" })).toBeNull()
    expect(rankTrendDirection({ trend: "WEIRD" })).toBeNull()
    expect(rankTrendDirection({})).toBeNull()
    expect(rankTrendDirection(null)).toBeNull()
  })
})

describe("rankTrendFromPin", () => {
  const rows = [
    { tmdbId: 1, imdbId: null, rank: 3, trend: "UP" },
    { tmdbId: 2, imdbId: null, rank: 5, trend: "DOWN" },
    { tmdbId: 3, imdbId: null, rank: 7 },
  ]
  it("returns the direction only for the row that produced the rank", () => {
    expect(rankTrendFromPin(pin(rows), 1, 3)).toBe("up")
    expect(rankTrendFromPin(pin(rows), 2, 5)).toBe("down")
  })
  it("ignores a rank that does not match the pinned row (override/saved fallback)", () => {
    expect(rankTrendFromPin(pin(rows), 1, 7)).toBeNull()
    expect(rankTrendFromPin(pin(rows), 1, null)).toBeNull()
  })
  it("is null without trend data, snapshot or row", () => {
    expect(rankTrendFromPin(pin(rows), 3, 7)).toBeNull()
    expect(rankTrendFromPin(pin(rows), 99, 1)).toBeNull()
    expect(rankTrendFromPin({ id: "live", snapshot: null }, 1, 3)).toBeNull()
    expect(rankTrendFromPin(null, 1, 3)).toBeNull()
  })
})

describe("buildRankTrendArrowSvg", () => {
  it("is green for up and red for down (rotated)", () => {
    expect(buildRankTrendArrowSvg("up", 20)).toContain("#2fd27a")
    const down = buildRankTrendArrowSvg("down", 20)
    expect(down).toContain("#ff5d5d")
    expect(down).toContain("rotate(180")
  })
})

describe("rankTrendModeFor", () => {
  it("routes styles to inside / ribbon / beside", () => {
    expect(rankTrendModeFor("pill")).toBe("inside")
    expect(rankTrendModeFor("notch-crema")).toBe("inside")
    expect(rankTrendModeFor("split")).toBe("inside")
    expect(rankTrendModeFor("netflix")).toBe("ribbon")
    expect(rankTrendModeFor("colored")).toBe("ribbon")
    expect(rankTrendModeFor("number")).toBe("beside")
    expect(rankTrendModeFor("editoriale")).toBe("beside")
  })
})

describe("attachRankTrendArrow", () => {
  const pill = async () => {
    const png = await sharp({ create: { width: 200, height: 60, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    return { png, w: 200, h: 60 }
  }
  it("inside mode paints the arrow without growing the bitmap", async () => {
    const out = await attachRankTrendArrow(await pill(), "up", 500, "inside", "pill")
    expect(out.w).toBe(200)
    const { data } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true })
    let green = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] > data[i] + 60 && data[i + 1] > data[i + 2] + 40) green++
    expect(green).toBeGreaterThan(10)
  })
  it("beside mode grows the canvas and the body so layout counts the arrow", async () => {
    const out = await attachRankTrendArrow(await pill(), "down", 500, "beside")
    expect(out.w).toBeGreaterThan(200)
    expect((out as { bleed?: { w: number } }).bleed!.w).toBeGreaterThan(200)
  })
})

describe("placeRankTrendArrow", () => {
  it("fresh: right of the digit ink, inside the canvas", () => {
    const p = placeRankTrendArrow({ left: 0, top: 0, w: 172, h: 312 }, 500, 750, "fresh")!
    expect(p.left).toBeGreaterThan(140)
    expect(p.left + p.size).toBeLessThan(500)
  })
  it("card: above the numeral in the frame margin", () => {
    const p = placeRankTrendArrow({ left: 0, top: 256, w: 213, h: 267 }, 500, 750, "card")!
    expect(p.top + p.size).toBeLessThanOrEqual(256)
  })
  it("card: centred in the left gutter above the numeral", () => {
    const p = placeRankTrendArrow({ left: 0, top: 256, w: 213, h: 267 }, 500, 750, "card", 105)!
    expect(p.left + p.size / 2).toBeCloseTo(52.5, 0)
    expect(p.top + p.size).toBeLessThanOrEqual(256)
  })
  it("returns null when the spot is off canvas", () => {
    expect(placeRankTrendArrow({ left: 0, top: 0, w: 172, h: 312 }, 120, 750, "fresh")).toBeNull()
  })
})

describe("rt URL plumbing", () => {
  it("Stremio params emit rt=1 only when the toggle is on", async () => {
    const { buildStremioPosterSearchParams } = await import("@/lib/stremio-poster-params")
    const on = buildStremioPosterSearchParams({ rankTrend: true } as never)
    const off = buildStremioPosterSearchParams({ rankTrend: false } as never)
    expect(on.get("rt")).toBe("1")
    expect(off.has("rt")).toBe(false)
  })
})

describe("settings preview URL", () => {
  it("adds rt=1 to the defaults preview only when the toggle is on", async () => {
    const { buildDefaultsPreviewUrl } = await import("@/lib/poster-url")
    expect(new URL(buildDefaultsPreviewUrl({ defaultRankTrend: true }), "http://x").searchParams.get("rt")).toBe("1")
    expect(new URL(buildDefaultsPreviewUrl({}), "http://x").searchParams.has("rt")).toBe(false)
    expect(new URL(buildDefaultsPreviewUrl({ defaultRankTrend: false }), "http://x").searchParams.has("rt")).toBe(false)
  })
})
