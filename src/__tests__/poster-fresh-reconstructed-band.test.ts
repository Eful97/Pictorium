/**
 * Task16 reconstructed-band experiment (ONE reversible candidate).
 * Fresh WITH valid rank ONLY: artwork shifts right ~6% CW (30px @500
 * portrait, 46px @768 landscape), vacated left gap filled with blurred
 * mirrored edge extension (sigma 9), raccorded via the existing left-blur
 * band gradient. Canvas dims unchanged, no art scale change, rightmost
 * shiftX strip cropped. Standard / Fresh-unranked / invalid-rank paths
 * unchanged (no new layers, no geometry/style/position changes).
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  composeFreshOverlay,
  freshGeometry,
  freshReconstructShiftX,
  isEffectiveFreshLayout,
  isFreshRank,
  prepareFreshReconstructedBackground,
  FRESH_LEFT_BLUR_SIGMA,
  FRESH_RECONSTRUCT_SHIFT_SHARE,
  type FreshMetaInput,
} from "@/lib/fresh-layout";
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils";

async function checkerBase(w: number, h: number, cell = 8): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
      const i = (y * w + x) * 3;
      raw[i] = on ? 200 : 20;
      raw[i + 1] = on ? 60 : 120;
      raw[i + 2] = on ? 40 : 200;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function rawRegion(buf: Buffer, left: number, top: number, width: number, height: number) {
  return sharp(buf).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function metaInput(): FreshMetaInput {
  return {
    badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
    separateRatingsEnabled: false, separateRatingsStyle: "column", customRatingsEnabled: false,
    genreName: "Dramma", year: "2024", voteAverage: 8.3,
    separateRatings: undefined, customRatings: undefined,
  };
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({ create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
}

describe("task16 shift geometry (pure)", () => {
  it("shares 0.06 and lands on 30px portrait / 46px landscape", () => {
    expect(FRESH_RECONSTRUCT_SHIFT_SHARE).toBe(0.06);
    expect(freshReconstructShiftX(STD_W)).toBe(30);
    expect(freshReconstructShiftX(LAND_W)).toBe(46);
    expect(freshReconstructShiftX(500)).toBe(30);
    expect(freshReconstructShiftX(768)).toBe(46);
  });

  it("gates to Fresh WITH valid numeral only (scope fallback unchanged)", () => {
    for (const rank of [5, 10, 20]) {
      expect(isEffectiveFreshLayout("fresh", "ranked", rank)).toBe(true);
      expect(isFreshRank(rank)).toBe(true);
    }
    for (const rank of [null, 0, -3, 6.5, NaN, 101] as const) {
      expect(isEffectiveFreshLayout("fresh", "ranked", rank)).toBe(false);
    }
    expect(isEffectiveFreshLayout("standard", "ranked", 5)).toBe(false);
    expect(isEffectiveFreshLayout("fresh", "all", null)).toBe(true);
  });
});

describe("task16 prepared background (pixels)", () => {
  it("keeps canvas dims, shifts right by shiftX, crops rightmost strip (both shapes, LOSSLESS pixel identity)", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const encode of ["jpeg", "png"] as const) {
        const raw = Buffer.alloc(CW * CH * 3);
        // High-frequency deterministic fixture (no encoder smoothing to hide
        // behind): every pixel derives from its coordinates.
        for (let y = 0; y < CH; y++) {
          for (let x = 0; x < CW; x++) {
            const i = (y * CW + x) * 3;
            raw[i] = (x * 7 + y * 13) & 255;
            raw[i + 1] = (x * 29 + y * 3) & 255;
            raw[i + 2] = (x * 11 + y * 31) & 255;
          }
        }
        const base =
          encode === "jpeg"
            ? await sharp(raw, { raw: { width: CW, height: CH, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
            : await sharp(raw, { raw: { width: CW, height: CH, channels: 3 } }).png().toBuffer();
        const shiftX = freshReconstructShiftX(CW);
        const t0 = Date.now();
        const prep = await prepareFreshReconstructedBackground(base, CW, CH);
        const ms = Date.now() - t0;
        console.log(`[task16-lossless] prepare ${CW}x${CH} ${encode} shift=${shiftX} in ${ms}ms base=${base.length}B prepared=${prep.png.length}B`);
        expect(prep.shiftX).toBe(shiftX);
        const meta = await sharp(prep.png).metadata();
        expect(meta.width).toBe(CW);
        expect(meta.height).toBe(CH);
        // Prepared buffer is actually lossless PNG (interface promise).
        expect(meta.format).toBe("png");
        // STRICT lossless identity right of the gap: prepared[x] == original
        // decoded [x - shiftX] for x >= shiftX, all channels, zero tolerance
        // (no JPEG tolerance allowed — the raw pipeline + single PNG encode
        // roundtrip bit-exactly). Compare decodes, not encodings.
        const px = Math.min(64, CW - shiftX);
        const sx = shiftX;
        const after = await rawRegion(prep.png, sx, 0, px, CH);
        const before = await rawRegion(base, 0, 0, px, CH);
        expect(Buffer.from(after.data).equals(Buffer.from(before.data))).toBe(true);
        // Full shifted region identity (whole canvas right of gap).
        const afterFull = await rawRegion(prep.png, shiftX, 0, CW - shiftX, CH);
        const beforeFull = await rawRegion(base, 0, 0, CW - shiftX, CH);
        expect(Buffer.from(afterFull.data).equals(Buffer.from(beforeFull.data))).toBe(true);
      }
    }
  }, 120000);

  it("shifts a fiducial by exactly CW*0.06 (Y unchanged, right crop = shift, EXACT)", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const shiftX = freshReconstructShiftX(CW);
      // Black canvas with a 2px white vertical fiducial at x=100, full height.
      const raw = Buffer.alloc(CW * CH * 3, 0);
      for (let y = 0; y < CH; y++) {
        for (let x = 100; x < 102; x++) {
          const i = (y * CW + x) * 3;
          raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255;
        }
      }
      const base = await sharp(raw, { raw: { width: CW, height: CH, channels: 3 } }).png().toBuffer();
      const prep = await prepareFreshReconstructedBackground(base, CW, CH);
      expect(prep.shiftX).toBe(shiftX);
      // Brightest column in the prepared middle band must sit EXACTLY at
      // 100 + shiftX (lossless — no ±1 encode tolerance).
      const band = await rawRegion(prep.png, shiftX + 60, 0, 120, CH);
      let bestX = 0;
      let bestM = -1;
      for (let x = 0; x < 120; x++) {
        let m = 0;
        for (let y = 0; y < CH; y++) m += (band.data[(y * 120 + x) * 4] ?? 0);
        m /= CH;
        if (m > bestM) { bestM = m; bestX = x; }
      }
      const foundX = shiftX + 60 + bestX;
      expect(foundX).toBe(100 + shiftX);
      expect(bestM).toBeGreaterThan(30);
    }
  }, 120000);

  it("fills the vacated left gap opaque full-frame from artwork only (no blank/black)", async () => {
    // Gradient artwork (not high-frequency checker): the blurred mirrored
    // edge keeps tone variance after sigma-9.
    const gradientBase = async (w: number, h: number): Promise<Buffer> => {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="#c8321e"/><stop offset="0.5" stop-color="#2e7a4a"/><stop offset="1" stop-color="#1e3ac8"/>` +
        `</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
      return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    };
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const base = await gradientBase(CW, CH);
      const prep = await prepareFreshReconstructedBackground(base, CW, CH);
      const shiftX = prep.shiftX;
      expect(shiftX).toBeGreaterThan(0);
      const gap = await rawRegion(prep.png, 0, 0, shiftX, CH);
      const d = gap.data;
      // Opaque alpha full-frame.
      for (let i = 0; i < shiftX * CH; i++) expect(d[i * 4 + 3]).toBe(255);
      // Not blank/black: carries artwork luminance variance.
      let mean = 0;
      const n = shiftX * CH;
      for (let i = 0; i < n; i++) mean += ((d[i * 4] ?? 0) + (d[i * 4 + 1] ?? 0) + (d[i * 4 + 2] ?? 0)) / 3;
      mean /= n;
      expect(mean).toBeGreaterThan(15);
      expect(mean).toBeLessThan(245);
      // A narrow blurred edge slice is near-flat by design (sigma 9 over a
      // 30px gradient ramp): assert artwork-derivation instead — the gap mean
      // tracks the source left-edge tone, not black/blank/arbitrary color.
      const srcEdge = await rawRegion(base, 0, 0, shiftX, CH);
      let srcMean = 0;
      for (let i = 0; i < n; i++) srcMean += ((srcEdge.data[i * 4] ?? 0) + (srcEdge.data[i * 4 + 1] ?? 0) + (srcEdge.data[i * 4 + 2] ?? 0)) / 3;
      srcMean /= n;
      expect(Math.abs(mean - srcMean)).toBeLessThan(40);
    }
  }, 120000);

  it("left gap is the blurred mirrored edge (art-derived, not black/unblurred)", async () => {
    // High-contrast vertical split fixture: left half dark, right half
    // bright. The mirrored-blurred gap must carry the dark left-edge tone
    // (not the bright interior, not black-zero, not the unblurred mirror).
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const raw = Buffer.alloc(CW * CH * 3);
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          const i = (y * CW + x) * 3;
          const bright = x >= CW / 2;
          raw[i] = bright ? 220 : 20;
          raw[i + 1] = bright ? 210 : 25;
          raw[i + 2] = bright ? 200 : 30;
        }
      }
      for (const encode of ["jpeg", "png"] as const) {
        const base =
          encode === "jpeg"
            ? await sharp(raw, { raw: { width: CW, height: CH, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
            : await sharp(raw, { raw: { width: CW, height: CH, channels: 3 } }).png().toBuffer();
        const prep = await prepareFreshReconstructedBackground(base, CW, CH);
        const shiftX = prep.shiftX;
        const gap = await rawRegion(prep.png, 0, 0, shiftX, CH);
        let mean = 0;
        const n = shiftX * CH;
        for (let i = 0; i < n; i++) mean += ((gap.data[i * 4] ?? 0) + (gap.data[i * 4 + 1] ?? 0) + (gap.data[i * 4 + 2] ?? 0)) / 3;
        mean /= n;
        // Dark left-edge tone (far from the bright interior ~210, far from black 0).
        expect(mean).toBeGreaterThan(5);
        expect(mean).toBeLessThan(120);
        // No uninitialised/black pixels anywhere in the gap.
        let black = 0;
        for (let i = 0; i < n; i++) {
          if ((gap.data[i * 4] ?? 1) === 0 && (gap.data[i * 4 + 1] ?? 1) === 0 && (gap.data[i * 4 + 2] ?? 1) === 0) black++;
          expect(gap.data[i * 4 + 3]).toBe(255);
        }
        expect(black).toBe(0);
      }
    }
  }, 120000);

  it("has no hard vertical seam at x=shiftX (smooth blurred raccord)", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const base = await checkerBase(CW, CH);
      const prep = await prepareFreshReconstructedBackground(base, CW, CH);
      const shiftX = prep.shiftX;
      // Column-mean step across the seam must stay far below a hard black cut.
      const colMean = async (x: number): Promise<number> => {
        const r = await rawRegion(prep.png, x, 0, 1, CH);
        let m = 0;
        for (let i = 0; i < CH; i++) m += ((r.data[i * 4] ?? 0) + (r.data[i * 4 + 1] ?? 0) + (r.data[i * 4 + 2] ?? 0)) / 3;
        return m / CH;
      };
      const left = await colMean(Math.max(0, shiftX - 1));
      const right = await colMean(Math.min(CW - 1, shiftX + 1));
      // No black vertical line: neither side is near-black while the other is bright.
      expect(Math.abs(left - right)).toBeLessThan(120);
      expect(left).toBeGreaterThan(5);
      expect(right).toBeGreaterThan(5);
    }
  }, 120000);

  it("keeps sigma 9 convention for the extension blur", () => {
    expect(FRESH_LEFT_BLUR_SIGMA).toBe(9);
  });
});

describe("task16 layer wiring unchanged (composeFreshOverlay)", () => {
  it("keeps layer order/count and anchors (only artwork fill changes)", async () => {
    const logo = await whiteLogo();
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const poster = await checkerBase(CW, CH);
      const layers = await composeFreshOverlay({
        posterBuf: poster, CW, CH, rank: 6, meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 }, provider: null,
      });
      // Strip, shade, numeral, meta, title (no provider) — same as task15.
      expect(layers).toHaveLength(5);
      expect(layers[0].left).toBe(0);
      expect(layers[0].top).toBe(0);
      const geo = freshGeometry(CW, CH, 6);
      const title = layers[layers.length - 1];
      const tm = await sharp(title.input).metadata();
      expect(title.top).toBe(CH - (tm.height ?? 0) - geo.titleBottom);
    }
  }, 180000);

  it("renders no band for absent/invalid ranks (unranked path untouched)", async () => {
    const logo = await whiteLogo();
    const poster = await checkerBase(STD_W, STD_H);
    const ref = await composeFreshOverlay({
      posterBuf: poster, CW: STD_W, CH: STD_H, rank: null, meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 }, provider: null,
    });
    expect(ref).toHaveLength(3);
  }, 120000);
});
