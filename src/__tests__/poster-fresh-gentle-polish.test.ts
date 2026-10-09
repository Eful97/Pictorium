/**
 * Task15 gentle polish candidate (ONE reversible candidate, user-authorized
 * after commit pause): slightly softer number rim + moderately wider blur.
 *
 * INTENTIONAL DELTAS (recorded old values, not weakened assertions):
 * - rim gradient brightest stops 0.95 -> 0.80 (offset 0) and 0.80 -> 0.68
 *   (offset 1); midtones UNCHANGED (0.35 -> 0.55 white, 0.7 -> 0.35 #e2e8f0).
 *   Outer stroke geometry / shadow / border thickness UNCHANGED.
 * - left-blur feather 16 -> 32 logical px; sigma stays 9; scope stays
 *   Fresh-WITH-rank only, full-height, ink-bound + feather (no plateau,
 *   no meta extents, no whole-poster blanket).
 * - band alpha: smoothstep + ONE gamma (s^1.3) holding slightly more uniform
 *   behind the ink before grading off; still 255 at x=0, 0 at end,
 *   monotonic, derivative lands at zero (no hard seam).
 *
 * Geometry (condensing .6 portrait 1..9 / .42 portrait 10+ / .6 landscape,
 * capH, stroke/rim/ring, title anchors) MUST be identical to pre-candidate.
 * Standard + Fresh-unranked MUST stay byte-stable (no band, no rim).
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  composeFreshOverlay,
  freshGeometry,
  freshLeftBlurAlpha,
  freshLeftBlurRegion,
  freshNumeralRimDefs,
  freshNumeralStrokeWidth,
  freshNumeralSvg,
  measureNumeralInk,
  renderFreshLeftBlurStrip,
  renderFreshNumeralMask,
  renderFreshNumeralRim,
  FRESH_LEFT_BLUR_FEATHER,
  FRESH_LEFT_BLUR_SIGMA,
  type FreshMetaInput,
} from "@/lib/fresh-layout";
import { renderSVG } from "@/lib/svg-badge";
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils";

async function alphaPlane(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(info.width * info.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] ?? 0;
  return { a, w: info.width, h: info.height };
}
async function flatBase(w: number, h: number, bg = "#3a3f55"): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } }).jpeg().toBuffer();
}
async function whiteLogo(): Promise<Buffer> {
  return sharp({ create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
}
function metaInput(): FreshMetaInput {
  return { badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true, separateRatingsEnabled: false, separateRatingsStyle: "column", customRatingsEnabled: false, genreName: "Dramma", year: "2024", voteAverage: 8.3, separateRatings: undefined, customRatings: undefined };
}

describe("task15 rim stops (gentle highlight trim only)", () => {
  it("keeps midtones, trims ONLY brightest highlights (old 0.95/0.80 -> new 0.80/0.68)", () => {
    const box = freshGeometry(STD_W, STD_H, 5).numeral!;
    const { defs } = freshNumeralRimDefs(box);
    expect(defs).toContain('<stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>');
    expect(defs).toContain('<stop offset="0.35" stop-color="#ffffff" stop-opacity="0.55"/>');
    expect(defs).toContain('<stop offset="0.7" stop-color="#e2e8f0" stop-opacity="0.35"/>');
    expect(defs).toContain('<stop offset="1" stop-color="#ffffff" stop-opacity="0.68"/>');
    expect(defs).not.toContain("stop-opacity=\"0.95\"");
  });

  it("keeps outer stroke geometry/shadow thickness UNCHANGED (rim = strokeW+8, ringR = ceil(strokeW/2))", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (let rank = 1; rank <= 100; rank++) {
        const box = freshGeometry(CW, CH, rank).numeral!;
        const svg = freshNumeralSvg(box);
        const expectStroke = freshNumeralStrokeWidth(box);
        expect(svg.rim).toBe(expectStroke + 8);
        expect(svg.ringR).toBe(Math.max(1, Math.ceil(expectStroke / 2)));
      }
    }
  }, 240000);

  it("rim peak softened vs baseline but outline stays robust on dark+bright fixtures", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [4, 5, 10, 20] as const) {
        const box = freshGeometry(CW, CH, rank).numeral!;
        const rim = await renderFreshNumeralRim(box);
        const { a } = await alphaPlane(rim.png);
        let peak = 0;
        let visible = 0;
        for (let i = 0; i < a.length; i++) {
          const v = a[i] ?? 0;
          if (v > peak) peak = v;
          if (v > 30) visible++;
        }
        // Old peak ~242 (0.95 stop + shadow); new peak must be lower but
        // still a clearly visible outline (not faint/muted).
        expect(peak).toBeLessThan(228);
        expect(peak).toBeGreaterThan(120);
        expect(visible).toBeGreaterThan(500);
        // Full numeral still composites on dark + bright without throw.
        for (const bg of ["#0b0d14", "#e8ecf4"] as const) {
          const base = await flatBase(CW, CH, bg);
          const { renderFreshGlassNumeral } = await import("@/lib/fresh-layout");
          const num = await renderFreshGlassNumeral(base, CW, CH, box);
          const pa = await alphaPlane(num.png);
          let nvis = 0;
          for (let i = 0; i < pa.a.length; i++) if ((pa.a[i] ?? 0) > 30) nvis++;
          expect(nvis).toBeGreaterThan(500);
        }
      }
    }
  }, 240000);

  it("seam union holds: no rim alpha deep inside glyphs (esp. 4), both shapes", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [4, 5] as const) {
        const box = freshGeometry(CW, CH, rank).numeral!;
        const svg = freshNumeralSvg(box);
        const { svgW, svgH, defs } = freshNumeralRimDefs(box);
        const ringSvg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
          `<defs>${defs}</defs><rect width="${svgW}" height="${svgH}" fill="#ffffff" mask="url(#freshNumRingM)"/></svg>`;
        const ring = await alphaPlane(await renderSVG(ringSvg, svgW));
        const eroSvg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${svg.svgW}" height="${svg.svgH}" viewBox="0 0 ${svg.svgW} ${svg.svgH}">` +
          `<defs><filter id="freshNumEro" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
          `<feMorphology in="SourceAlpha" operator="erode" radius="8" result="e"/>` +
          `<feFlood flood-color="#ffffff" result="c"/><feComposite in="c" in2="e" operator="in"/>` +
          `</filter></defs><g filter="url(#freshNumEro)">${svg.textEl}</g></svg>`;
        const interior = await alphaPlane(await renderSVG(eroSvg, svg.svgW));
        let inCount = 0;
        let seamCount = 0;
        for (let i = 0; i < interior.a.length; i++) {
          if ((interior.a[i] ?? 0) > 128) {
            inCount++;
            if ((ring.a[i] ?? 0) > 30) seamCount++;
          }
        }
        expect(inCount).toBeGreaterThan(200);
        expect(seamCount / Math.max(1, inCount)).toBeLessThan(0.005);
      }
    }
  }, 240000);
});

describe("task15 geometry identical to pre-candidate (ranked 1..100)", () => {
  it("keeps condensing/cap/anchor contract (.6 singles portrait, .42 portrait 10+, .6 landscape)", () => {
    for (const [CW, CH, portrait] of [[STD_W, STD_H, true], [LAND_W, LAND_H, false]] as const) {
      let refCap: number | null = null;
      for (let rank = 1; rank <= 100; rank++) {
        const box = freshGeometry(CW, CH, rank).numeral!;
        const expectCx = portrait ? (rank >= 10 ? 0.42 : 0.6) : 0.6;
        expect(box.condenseX).toBeCloseTo(expectCx, 10);
        if (rank <= 20) {
          if (refCap === null) refCap = box.capH;
          else expect(box.capH).toBe(refCap);
        }
        expect(box.left).toBe(portrait ? 12 : 18);
      }
    }
  });
});

describe("task15 left blur (wider feather + eased falloff, same scope)", () => {
  it("keeps sigma 9, feather 32 (old 16), full-height ink-bound scope", () => {
    expect(FRESH_LEFT_BLUR_SIGMA).toBe(9);
    expect(FRESH_LEFT_BLUR_FEATHER).toBe(32);
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const region = freshLeftBlurRegion(CW, CH, 200)!;
      expect(region.left).toBe(0);
      expect(region.top).toBe(0);
      expect(region.height).toBe(CH);
      expect(region.width).toBe(Math.min(CW, 200 + 32));
    }
  });

  it("alpha endpoints/monotonic/soft landing (255 left, 0 right, derivative ~0, no hard seam)", () => {
    for (const width of [64, 220, 400]) {
      expect(freshLeftBlurAlpha(0, width)).toBe(255);
      expect(freshLeftBlurAlpha(width - 1, width)).toBe(0);
      let prev = 256;
      for (let x = 0; x < width; x++) {
        const a = freshLeftBlurAlpha(x, width);
        expect(a).toBeLessThanOrEqual(prev);
        expect(a).toBeGreaterThanOrEqual(0);
        prev = a;
      }
      // Soft landing: last steps change by only a few levels (no vertical cut).
      expect(freshLeftBlurAlpha(width - 2, width)).toBeLessThanOrEqual(8);
      // Slightly less premature than pure smoothstep: mid-band holds higher.
      const t = 0.5;
      const s = t * t * (3 - 2 * t);
      const pure = Math.round(255 * (1 - s));
      const midX = Math.floor((width - 1) * 0.5);
      expect(freshLeftBlurAlpha(midX, width)).toBeGreaterThanOrEqual(pure);
    }
  });

  it("band follows measured ink + feather, tracks X/scale, null offscreen (both shapes)", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const base = await flatBase(CW, CH);
      for (const rank of [4, 5, 10, 20] as const) {
        const box = freshGeometry(CW, CH, rank).numeral!;
        const mask = await renderFreshNumeralMask(box);
        const ink = await measureNumeralInk(mask.png);
        const rim = freshNumeralSvg(box).rim;
        const inkRight = box.left - rim + ink!.maxX;
        const strip = await renderFreshLeftBlurStrip(base, CW, CH, box);
        expect(strip!.w).toBe(Math.min(CW, Math.round(inkRight + 32)));
        expect(strip!.h).toBe(CH);
      }
      const far = freshGeometry(CW, CH, 7, { numeralScale: 200, numeralOffsetX: 2000 });
      expect(await renderFreshLeftBlurStrip(base, CW, CH, far.numeral!)).toBeNull();
    }
  }, 240000);

  it("Standard/unranked stable: no band without a valid numeral", async () => {
    const logo = await whiteLogo();
    const poster = await flatBase(STD_W, STD_H);
    const ref = await composeFreshOverlay({ posterBuf: poster, CW: STD_W, CH: STD_H, rank: null, meta: metaInput(), logo: { png: logo, w: 220, h: 100 }, provider: null });
    expect(ref).toHaveLength(3);
    for (const rank of [0, -3, 6.5, NaN, 101] as const) {
      const layers = await composeFreshOverlay({ posterBuf: poster, CW: STD_W, CH: STD_H, rank, meta: metaInput(), logo: { png: logo, w: 220, h: 100 }, provider: null });
      expect(layers).toHaveLength(ref.length);
    }
  }, 120000);
});
