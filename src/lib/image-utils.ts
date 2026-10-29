/**
 * Shared image-processing utilities — single source of truth for:
 * - `STD_W` / `STD_H`: standard poster canvas dimensions
 * - `clamp`: standard clamp without Math.round (rounding is explicit at call site)
 * - `luma`: Rec.709 luminance from RGB
 * - `computeRegionStats`: cached region statistics (mean/stdDev/per-channel)
 *
 * Batch B: centralizes the pixel-analysis pipeline (resize → extract →
 * removeAlpha → raw → JS loop) across poster-fit-score.ts, poster-fit-adjust.ts,
 * poster-render-helpers.ts, and config-token.ts, instead of duplicating loops.
 * The per-region cache lets `topLuminance()` and `computeTextPenalty()` avoid
 * recomputing stats on overlapping crops.
 */

import sharp from "sharp"
import { LAND_W, LAND_H } from "./constants"

// ---- Standard poster dimensions (single source of truth) ----

export const STD_W = 500
export const STD_H = 750

// ---- Landscape poster dimensions ----
// Definite in constants.ts (browser-safe): qui solo re-export per
// retrocompatibilità degli import server esistenti.
// Canvas 16:9 per i poster orizzontali stile Nuvio: la base è il backdrop
// TMDB (sfondo, già 16:9 nativo) invece del poster verticale.
export { LAND_W, LAND_H } from "./constants"

/**
 * Tier dimensionale TMDB ottimale per la base landscape: `w780` pesa
 * ~100-200KB contro i backdrop `original` (spesso <1MB ma talvolta
 * multi-MB) ed è geometricamente perfetto per LAND_W=768 — niente
 * upscale, niente spreco di RAM/latenza sul cold render.
 */
export const LANDSCAPE_BACKDROP_SIZE = "w780" as const

/**
 * URL CDN TMDB per un backdrop alla risoluzione landscape. Stessa allowlist
 * SSRF di imgSrc (poster-render-helpers): solo path TMDB o host consentito,
 * altrimenti lancia come imgSrc.
 */
const TMDB_IMG_BASE = process.env.TMDB_IMG_URL || "https://image.tmdb.org/t/p"

export function landscapeBackdropUrl(path: string): string {
  if (path.startsWith("http")) {
    if (!path.startsWith(`${TMDB_IMG_BASE}/`)) {
      throw new Error(`Blocked external image URL: ${path.slice(0, 60)}...`)
    }
    return path
  }
  return `${TMDB_IMG_BASE}/${LANDSCAPE_BACKDROP_SIZE}${path}`
}

/**
 * Base 16:9 di fallback quando il titolo non ha backdrop TMDB: poster
 * verticale centrato a piena altezza su fondo ricavato dal poster stesso
 * (cover blurrato e scurito — pillarbox cinematografico). Nessun titolo
 * resta mai con un riquadro rotto in landscape.
 */
export async function pillarboxLandscapeBase(portraitBuf: Buffer): Promise<Buffer> {
  const bg = await sharp(portraitBuf)
    .resize(LAND_W, LAND_H, { fit: "cover", position: "centre" })
    .blur(18)
    .modulate({ brightness: 0.55, saturation: 1.1 })
    .toBuffer()
  const meta = await sharp(portraitBuf).metadata()
  const fw = Math.max(1, Math.round(LAND_H * ((meta.width || 2) / (meta.height || 3))))
  const fg = await sharp(portraitBuf).resize(fw, LAND_H, { fit: "fill" }).toBuffer()
  return sharp(bg)
    .composite([{ input: fg, left: Math.round((LAND_W - fw) / 2), top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer()
}

/**
 * Strategia di focus del cover-crop backdrop → 2:3.
 * - `attention` (default storico): salienza visiva/volti, migliore per la
 *   rescue B2 (poster orfano). Non ha nozione di volto completo: un fondo
 *   luminoso può battere i soggetti.
 * - `entropy`: dettaglio/densità, segue la zona più densa e può tagliare il
 *   soggetto (bacio/volti fuori dal dettaglio massimo).
 * - `center`: crop geometricamente centrato, nessuna euristica. È il focus
 *   delle basi portrait (auto e mapping): deterministico, non sposta il
 *   soggetto fuori asse come `attention`/`entropy`.
 */
export type BackdropCropFocus = "attention" | "entropy" | "center"

/**
 * Base 2:3 di fallback quando il titolo non ha alcun poster TMDB utilizzabile
 * ma ha un backdrop: cover-crop del backdrop sul canvas portrait con focus
 * configurabile (`attention` di default — nessun cambio di resa per i call
 * site storici; `center` per le basi portrait). Nessun titolo orfano resta
 * mai con un 404. Trigger SOLO in sostituzione del 404 o come base portrait,
 * mai su poster esistenti.
 */
export async function cropBackdropToPortrait(
  backdropBuf: Buffer,
  focus: BackdropCropFocus = "attention",
): Promise<Buffer> {
  const strategy = focus === "entropy"
    ? sharp.strategy.entropy
    : focus === "center" ? "centre" : sharp.strategy.attention
  return sharp(backdropBuf)
    .resize(STD_W, STD_H, { fit: "cover", position: strategy })
    .jpeg({ quality: 90 })
    .toBuffer()
}

// ---- Math utilities ----

/**
 * Standard clamp: Math.max(min, Math.min(max, val)).
 * Does NOT round — if you need rounding, do it explicitly:
 *   clamp(Math.round(v), min, max)
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Rec.709 luminance from 8-bit RGB channels.
 */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ---- Region stats pool (Batch B: eliminates cross-function redundancy) ----

export interface RegionStats {
  /** Mean luminance (0-255) */
  mean: number
  /** Standard deviation of luminance */
  stdDev: number
  /** Mean per channel (0-255) */
  meanR: number
  meanG: number
  meanB: number
  /** Width of the analysed region */
  width: number
  /** Height of the analysed region */
  height: number
}

interface CachedStats {
  stats: RegionStats
  /** Buffer hash for cache invalidation */
  hash: number
}

const statsCache = new Map<string, CachedStats>()
const STATS_CACHE_MAX = 200

function bufferHash(buf: Buffer): number {
  // Strided FNV-1a over the whole buffer. The old hash sampled only the first
  // 64 bytes, which for JPEG/PNG are just the file header (SOI + JFIF + quant
  // tables) — nearly identical across images, so the hash collapsed to a
  // function of length and different posters could collide in statsCache.
  // Striding uniformly covers the entire image while keeping cost bounded to
  // ~SAMPLES reads even for multi-MB posters.
  const SAMPLES = 4096
  const step = Math.max(1, Math.floor(buf.length / SAMPLES))
  let h = 0x811c9dc5 // FNV-1a offset basis
  for (let i = 0; i < buf.length; i += step) {
    h ^= buf[i] ?? 0
    h = Math.imul(h, 0x01000193) // FNV-1a prime
  }
  // Mix length in so buffers of different size never alias even if the
  // sampled bytes line up. Not cryptographic — just invalidation.
  h ^= buf.length
  h = Math.imul(h, 0x01000193)
  return h >>> 0
}

/**
 * Compute mean, stdDev, and per-channel means for a rectangular region of a
 * poster buffer.
 *
 * Pipeline: resize to the canvas size (default STD_W × STD_H portrait;
 * landscape callers pass LAND_W × LAND_H) with fit fill → extract region → removeAlpha
 * (RGB, stride 3) → raw pixel buffer → two JS passes over the pixels (first:
 * mean + per-channel means, second: stdDev). Not Sharp's native `.stats()`.
 *
 * Results are cached per (buffer-hash, region). The hash is a strided FNV-1a
 * over the whole buffer — good enough to invalidate when the underlying image
 * buffer changes, not cryptographic.
 *
 * @param posterBuf - Raw poster image buffer (any format Sharp can read)
 * @param left - X offset within the STD_W × STD_H canvas
 * @param top - Y offset within the STD_W × STD_H canvas
 * @param width - Region width
 * @param height - Region height
 * @returns RegionStats, or null if the region is invalid
 */
export async function computeRegionStats(
  posterBuf: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  canvas?: { readonly width?: number; readonly height?: number },
): Promise<RegionStats | null> {
  const canvasW = Math.round(canvas?.width ?? STD_W)
  const canvasH = Math.round(canvas?.height ?? STD_H)
  if (canvasW <= 0 || canvasH <= 0) return null
  const l = Math.max(0, Math.round(left))
  const t = Math.max(0, Math.round(top))
  const w = Math.min(canvasW - l, Math.round(width))
  const h = Math.min(canvasH - t, Math.round(height))
  if (w <= 0 || h <= 0) return null

  const cacheKey = `${canvasW}x${canvasH}:${l}:${t}:${w}:${h}`
  const hash = bufferHash(posterBuf)
  const cached = statsCache.get(cacheKey)
  if (cached && cached.hash === hash) return cached.stats

  try {
    const { data: rawPixels, info } = await sharp(posterBuf)
      .resize(canvasW, canvasH, { fit: "fill" })
      .extract({ left: l, top: t, width: w, height: h })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const totalPixels = info.width * info.height
    if (totalPixels === 0) return null

    // Single-pass: mean + per-channel means
    let sum = 0
    let rSum = 0
    let gSum = 0
    let bSum = 0
    for (let i = 0; i < rawPixels.length; i += 3) {
      const r = rawPixels[i] ?? 0
      const g = rawPixels[i + 1] ?? 0
      const b = rawPixels[i + 2] ?? 0
      sum += luma(r, g, b)
      rSum += r
      gSum += g
      bSum += b
    }
    const mean = sum / totalPixels
    const meanR = rSum / totalPixels
    const meanG = gSum / totalPixels
    const meanB = bSum / totalPixels

    // Second pass: stdDev (needs mean from first pass)
    let sqSum = 0
    for (let i = 0; i < rawPixels.length; i += 3) {
      const lum = luma(rawPixels[i] ?? 0, rawPixels[i + 1] ?? 0, rawPixels[i + 2] ?? 0)
      const d = lum - mean
      sqSum += d * d
    }
    const stdDev = Math.sqrt(sqSum / totalPixels)

    const stats: RegionStats = {
      mean,
      stdDev,
      meanR,
      meanG,
      meanB,
      width: info.width,
      height: info.height,
    }

    // Cache management (LRU-ish: evict oldest when full)
    if (statsCache.size >= STATS_CACHE_MAX) {
      const firstKey = statsCache.keys().next().value
      if (firstKey) statsCache.delete(firstKey)
    }
    statsCache.set(cacheKey, { stats, hash })

    return stats
  } catch {
    return null
  }
}

/**
 * Clear the region stats cache. Useful for tests.
 */
export function clearRegionStatsCache(): void {
  statsCache.clear()
}

// ---- Raw RGB decode-once helpers (Batch B: poster-fit) ----

/** Tight RGB pixel buffer (3 bytes/pixel, no alpha), as produced by
 *  `decodePosterRaw` / sharp `.raw()`. */
export interface RgbData {
  data: Buffer
  width: number
  height: number
}

/**
 * Slice a tight RGB region out of a full raw RGB buffer (as produced by
 * `decodePosterRaw`). Avoids re-decoding the poster for every analysis region —
 * decode once, slice in JS. Clamping/rounding semantics match
 * `computeRegionStats`.
 */
export function sliceRgb(raw: RgbData, left: number, top: number, width: number, height: number): RgbData | null {
  const l = Math.max(0, Math.round(left))
  const t = Math.max(0, Math.round(top))
  const w = Math.min(raw.width - l, Math.round(width))
  const h = Math.min(raw.height - t, Math.round(height))
  if (w <= 0 || h <= 0) return null
  const data = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const srcStart = ((t + y) * raw.width + l) * 3
    raw.data.copy(data, y * w * 3, srcStart, srcStart + w * 3)
  }
  return { data, width: w, height: h }
}

/**
 * Decode a poster buffer once to raw RGB at the given canvas size
 * (default STD_W × STD_H portrait; landscape callers pass LAND_W × LAND_H),
 * fit fill, tightly packed (3 bytes/pixel). All region analyses then slice
 * this buffer instead of running sharp per region.
 */
export async function decodePosterRaw(buffer: Buffer, width = STD_W, height = STD_H): Promise<RgbData> {
  const { data, info } = await sharp(buffer)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}