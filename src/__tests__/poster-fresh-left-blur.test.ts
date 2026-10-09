/**
 * Fresh ranked left-blur gradient (task8b, user-approved "parte dalla parte
 * sinistra e termina quando finisce il numero").
 *
 * Contract:
 * - ONLY effective Fresh WITH a valid displayed rank numeral (1..100):
 *   a full-height left strip of the artwork, blurred once (sigma 9, same as
 *   the glass fill), composited UNDER the fresh shade with a smooth
 *   horizontal alpha gradient — opaque at the canvas left, exactly 0 at the
 *   RIGHT VISIBLE INK BOUND of the transformed numeral + a tiny feather
 *   (16px). No hard vertical seam, no full-image softening.
 * - Horizontal extent follows the numeral X/scale (transformed box → tight
 *   real ink via measureNumeralInk, never estW/zoneW); Y is a full-height
 *   band by explicit minimal decision (user reference constrains only the
 *   horizontal end). Numeral fully offscreen → no band (skip, never throw,
 *   never whole-canvas blur). Absent/invalid/disabled numeral → no effect.
 * - Layer order: strip, shade, numeral, meta, provider, title — title/meta
 *   chrome unaffected (strip is below everything); quality/ribbon/extra
 *   chrome is composited by the caller after these layers, untouched.
 * - Standard and Fresh-without-numeral (unranked `all`, ranked-fallback
 *   Standard) are byte-identical (pinned by the pre-existing suites:
 *   poster-fresh-unranked, poster-fresh-centered-title, poster-fresh-scope).
 *   Ranked Fresh portraits AND landscapes INTENTIONALLY change bytes (new
 *   pins live with the suites that own them; here we assert the change is
 *   the strip and nothing else).
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  composeFreshOverlay,
  freshGeometry,
  freshLeftBlurAlpha,
  freshLeftBlurRegion,
  freshNumeralSvg,
  measureNumeralInk,
  renderFreshLeftBlurStrip,
  renderFreshNumeralMask,
  FRESH_LEFT_BLUR_FEATHER,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

/** High-frequency pattern artwork: blur MUST soften it (variance drops). */
async function checkerBase(w: number, h: number, cell = 8): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0
      const i = (y * w + x) * 3
      // Two contrasting hues (not gray) so hue coherence is observable.
      raw[i] = on ? 200 : 20
      raw[i + 1] = on ? 60 : 120
      raw[i + 2] = on ? 40 : 200
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer()
}

/** Smooth deterministic artwork (same builder family as the pin suites). */
async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

async function redProvider(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function metaInput(overrides: Partial<FreshMetaInput> = {}): FreshMetaInput {
  return {
    badgesEnabled: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    separateRatingsEnabled: false,
    separateRatingsStyle: "column",
    customRatingsEnabled: false,
    genreName: "Dramma",
    year: "2024",
    voteAverage: 8.3,
    separateRatings: undefined,
    customRatings: undefined,
    ...overrides,
  }
}

async function variance(region: { data: Buffer; info: { width: number; height: number; channels: number } }): Promise<number> {
  const { data, info } = region
  const ch = info.channels
  const n = info.width * info.height
  let mean = 0
  for (let i = 0; i < n; i++) mean += (data[i * ch] ?? 0) + (data[i * ch + 1] ?? 0) + (data[i * ch + 2] ?? 0)
  mean /= n * 3
  let v = 0
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const d = (data[i * ch + c] ?? 0) - mean
      v += d * d
    }
  }
  return v / (n * 3)
}

async function rawRegion(buf: Buffer, left: number, top: number, width: number, height: number) {
  // ensureAlpha: the JPEG base decodes to 3 channels while the composited
  // PNG carries 4 — compare identical strides (RGB must match exactly).
  return sharp(buf).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

describe("left-blur geometry (pure)", () => {
  it("is a full-height band from the canvas left to ink-right + feather, both shapes", () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [1, 9, 20, 100] as const) {
        const geo = freshGeometry(CW, CH, rank)
        expect(geo.numeral).not.toBeNull()
        const box = geo.numeral!
        // Ink-right proxy at geometry level: the box advance end (the async
        // renderer re-derives this from measured ink — see below).
        const region = freshLeftBlurRegion(CW, CH, box.left + box.estW)
        expect(region).not.toBeNull()
        expect(region!.left).toBe(0)
        expect(region!.top).toBe(0)
        expect(region!.height).toBe(CH)
        expect(region!.width).toBe(
          Math.min(CW, Math.round(box.left + box.estW + FRESH_LEFT_BLUR_FEATHER)),
        )
        expect(region!.width).toBeLessThanOrEqual(CW)
        expect(region!.width).toBeGreaterThan(0)
      }
    }
  })

  it("rejects non-finite ink bounds and degenerate canvases (no effect)", () => {
    expect(freshLeftBlurRegion(STD_W, STD_H, NaN)).toBeNull()
    expect(freshLeftBlurRegion(STD_W, STD_H, Infinity)).toBeNull()
    expect(freshLeftBlurRegion(0, STD_H, 100)).toBeNull()
    expect(freshLeftBlurRegion(STD_W, 0, 100)).toBeNull()
  })

  it("tracks moved/scaled numerals (X/scale follow, both shapes)", () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const ref = freshGeometry(CW, CH, 7)
      const moved = freshGeometry(CW, CH, 7, { numeralOffsetX: 60 })
      const scaled = freshGeometry(CW, CH, 7, { numeralScale: 200 })
      expect(moved.numeral!.left).toBe(ref.numeral!.left + 60)
      expect(scaled.numeral!.fontSize).toBeGreaterThan(ref.numeral!.fontSize)
      const refR = freshLeftBlurRegion(CW, CH, ref.numeral!.left + ref.numeral!.estW)!
      const movedR = freshLeftBlurRegion(CW, CH, moved.numeral!.left + moved.numeral!.estW)!
      const scaledR = freshLeftBlurRegion(CW, CH, scaled.numeral!.left + scaled.numeral!.estW)!
      // The band starts at the canvas left in every case and ends further
      // right when the numeral moves/scales right.
      expect(movedR.left).toBe(0)
      expect(movedR.width).toBeGreaterThan(refR.width)
      expect(scaledR.width).toBeGreaterThanOrEqual(refR.width)
      // Scale clamps inside the canvas (never wider than CW).
      const huge = freshGeometry(CW, CH, 100, { numeralScale: 200, numeralOffsetX: 2000 })
      const hugeR = freshLeftBlurRegion(CW, CH, huge.numeral!.left + huge.numeral!.estW)!
      expect(hugeR.width).toBeLessThanOrEqual(CW)
    }
  })
})

describe("left-blur alpha mask", () => {
  it("is opaque at the canvas left, exactly 0 at the band end, monotonic between", () => {
    for (const width of [2, 64, 220]) {
      expect(freshLeftBlurAlpha(0, width)).toBe(255)
      expect(freshLeftBlurAlpha(width - 1, width)).toBe(0)
      let prev = 256
      for (let x = 0; x < width; x++) {
        const a = freshLeftBlurAlpha(x, width)
        expect(a).toBeLessThanOrEqual(prev)
        expect(a).toBeGreaterThanOrEqual(0)
        prev = a
      }
    }
  })
})

describe("left-blur strip (pixels, pattern artwork)", () => {
  it("softens the left artwork and lands exactly on the sharp base at the band end", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const base = await checkerBase(CW, CH)
      const geo = freshGeometry(CW, CH, 7)
      const t0 = Date.now()
      const strip = await renderFreshLeftBlurStrip(base, CW, CH, geo.numeral!)
      const ms = Date.now() - t0
      console.log(`[task8b] strip render rank7 ${CW}x${CH}: ${strip!.w}x${strip!.h} in ${ms}ms`)
      expect(strip).not.toBeNull()
      expect(strip!.left).toBe(0)
      expect(strip!.top).toBe(0)
      expect(strip!.h).toBe(CH)
      // Composite the band over the base (production order: band UNDER the
      // shade — here over the raw base to isolate the band effect).
      // Lossless PNG: untouched regions must stay byte-exact.
      const comp = await sharp(base)
        .composite([{ input: strip!.png, left: 0, top: 0 }])
        .png()
        .toBuffer()
      // Left region: high-frequency detail is softened (variance drops).
      const bandW = strip!.w
      const leftW = Math.max(8, Math.floor(bandW * 0.3))
      const beforeLeft = await rawRegion(base, 0, 0, leftW, CH)
      const afterLeft = await rawRegion(comp, 0, 0, leftW, CH)
      const vBefore = await variance(beforeLeft)
      const vAfter = await variance(afterLeft)
      expect(vAfter).toBeLessThan(vBefore * 0.9)
      // Right of the band: byte-identical to the base (alpha 0 → background).
      const rightX = bandW
      if (rightX < CW - 8) {
        const w = Math.min(32, CW - rightX)
        const beforeRight = await rawRegion(base, rightX, 0, w, CH)
        const afterRight = await rawRegion(comp, rightX, 0, w, CH)
        expect(Buffer.from(afterRight.data).equals(Buffer.from(beforeRight.data))).toBe(true)
      }
    }
  }, 120000)

  it("ends at the measured ink right + feather (tight geometry, not zone width)", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [1, 9, 20, 100] as const) {
        const base = await checkerBase(CW, CH)
        const geo = freshGeometry(CW, CH, rank)
        const mask = await renderFreshNumeralMask(geo.numeral!)
        const ink = await measureNumeralInk(mask.png)
        expect(ink).not.toBeNull()
        const rim = freshNumeralSvg(geo.numeral!).rim
        const inkRight = geo.numeral!.left - rim + ink!.maxX
        const strip = await renderFreshLeftBlurStrip(base, CW, CH, geo.numeral!)
        expect(strip).not.toBeNull()
        // Band end == ink right + feather (clamped), far inside the zone
        // estimate for small ranks (tight, not the column width).
        expect(strip!.w).toBe(Math.min(CW, Math.round(inkRight + FRESH_LEFT_BLUR_FEATHER)))
        const zoneW = geo.zoneW
        if (rank === 1) expect(strip!.w).toBeLessThan(zoneW)
      }
    }
  }, 180000)

  it("returns null for offscreen numerals (never whole-canvas blur, never throw)", async () => {
    const base = await checkerBase(STD_W, STD_H)
    // Numeral pushed fully outside every side: skip.
    for (const transforms of [
      { numeralOffsetX: 2000 },
      { numeralOffsetX: -2000 },
      { numeralOffsetY: 2000 },
      { numeralOffsetY: -2000 },
    ] as const) {
      const geo = freshGeometry(STD_W, STD_H, 7, transforms)
      const strip = await renderFreshLeftBlurStrip(base, STD_W, STD_H, geo.numeral!)
      // Fully-offscreen axes skip; a still-visible axis clamps inside CW.
      if (strip) expect(strip.w).toBeLessThanOrEqual(STD_W)
    }
    // Fully offscreen must skip (band would otherwise span the canvas).
    const farRight = freshGeometry(STD_W, STD_H, 7, { numeralScale: 200, numeralOffsetX: 2000 })
    expect(await renderFreshLeftBlurStrip(base, STD_W, STD_H, farRight.numeral!)).toBeNull()
    const farBottom = freshGeometry(STD_W, STD_H, 7, { numeralOffsetY: 2000 })
    expect(await renderFreshLeftBlurStrip(base, STD_W, STD_H, farBottom.numeral!)).toBeNull()
  }, 120000)
})

describe("left-blur layer wiring (composeFreshOverlay)", () => {
  it("inserts the band under the shade before the numeral for valid ranks, both shapes", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const poster = await patternedBase(CW, CH)
      const logo = await whiteLogo()
      const provider = await redProvider()
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank: 6,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      })
      // Strip, shade, numeral, meta, provider, title.
      expect(layers).toHaveLength(6)
      const [strip, shade, numeral] = layers
      expect(strip.left).toBe(0)
      expect(strip.top).toBe(0)
      const stripMeta = await sharp(strip.input).metadata()
      expect(stripMeta.height).toBe(CH)
      expect(stripMeta.width).toBeLessThanOrEqual(CW)
      expect(shade.top).toBe(0)
      expect(shade.left).toBe(0)
      // The numeral still composites after (above) the band.
      expect(numeral).toBeDefined()
      // Title/meta chrome positions are set by their own anchors (the band
      // adds no offsets): title stays on its shape anchor.
      const geo = freshGeometry(CW, CH, 6)
      const title = layers[layers.length - 1]
      const titleMeta = await sharp(title.input).metadata()
      const tw = titleMeta.width ?? 0
      const th = titleMeta.height ?? 0
      expect(title.top).toBe(CH - th - geo.titleBottom)
      if (CW === STD_W) expect(title.left).toBe(Math.round((CW - tw) / 2))
      else expect(title.left).toBe(CW - tw - geo.titleRight)
    }
  }, 180000)

  it("renders no band for absent/invalid ranks (byte-identical layers to null)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay({ ...base, rank: null })
    // Unranked: shade first, no band.
    expect(ref).toHaveLength(4)
    expect(ref[0].top).toBe(0)
    expect(ref[0].left).toBe(0)
    for (const rank of [0, -3, 6.5, NaN, 101] as const) {
      const layers = await composeFreshOverlay({ ...base, rank })
      expect(layers).toHaveLength(ref.length)
      for (let i = 0; i < layers.length; i++) {
        expect(layers[i].top).toBe(ref[i].top)
        expect(layers[i].left).toBe(ref[i].left)
        expect((layers[i].input as Buffer).equals(ref[i].input as Buffer)).toBe(true)
      }
    }
  }, 120000)

  it("renders a band for rank profiles 1/9/20/100 (multi-digit follows the numeral)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    for (const rank of [1, 9, 20, 100] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: STD_W,
        CH: STD_H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: null,
      })
      // Strip, shade, numeral, meta, title (no provider).
      expect(layers).toHaveLength(5)
      const stripMeta = await sharp(layers[0].input).metadata()
      expect(layers[0].left).toBe(0)
      expect(layers[0].top).toBe(0)
      expect(stripMeta.height).toBe(STD_H)
      // Wider numerals end further right (scale-follow, monotonic-ish).
      expect(stripMeta.width).toBeGreaterThan(0)
    }
    // Multi-digit bands end further right than single-digit ones.
    const one = await composeFreshOverlay({
      posterBuf: poster, CW: STD_W, CH: STD_H, rank: 1, meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 }, provider: null,
    })
    const hundred = await composeFreshOverlay({
      posterBuf: poster, CW: STD_W, CH: STD_H, rank: 100, meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 }, provider: null,
    })
    const w1 = (await sharp(one[0].input).metadata()).width ?? 0
    const w100 = (await sharp(hundred[0].input).metadata()).width ?? 0
    expect(w100).toBeGreaterThan(w1)
  }, 180000)
})

describe("task8b evidence samples (approved temp only, never the repo)", () => {
  it("writes ranked before/after-style samples + preservation samples", async () => {
    const outDir = "C:/Users/lucaf/AppData/Local/Temp/opencode/task8b"
    await mkdir(outDir, { recursive: true })
    const logo = await whiteLogo()
    for (const [W, H, name, rank] of [
      [STD_W, STD_H, "ranked-portrait", 6],
      [LAND_W, LAND_H, "ranked-landscape", 5],
    ] as const) {
      const poster = await patternedBase(W, H)
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: W,
        CH: H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: null,
      })
      // Layer 0 is the band: composite base + band only (no shade/numeral)
      // to show the isolated gradient effect for review.
      const bandOnly = await sharp(poster)
        .composite([{ input: layers[0].input, left: 0, top: 0 }])
        .jpeg({ quality: 88 })
        .toBuffer()
      await writeFile(`${outDir}/${name}-band-only.jpg`, bandOnly)
      // Full ranked overlay (band + shade + numeral + meta + title).
      const composites = layers.map((l) => ({ input: l.input, left: l.left, top: l.top }))
      const full = await sharp(poster).composite(composites).jpeg({ quality: 88 }).toBuffer()
      await writeFile(`${outDir}/${name}-full.jpg`, full)
      console.log(`[task8b] ${name}: sha=${sha(full)}`)
    }
    // Preservation: unranked Fresh has no band (shade first).
    const unranked = await composeFreshOverlay({
      posterBuf: await patternedBase(STD_W, STD_H),
      CW: STD_W,
      CH: STD_H,
      rank: null,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: null,
    })
    expect(unranked).toHaveLength(3)
    console.log(`[task8b] samples written to ${outDir}`)
  }, 180000)
})
