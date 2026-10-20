import crypto from "node:crypto"
import sharp from "sharp"
import { cacheGet, cacheSet } from "./cache"
import { findAccentColor, findSceneTint, relativeLuminance, adaptiveAutomaticAccentHex, normalizeAutomaticAccentHex } from "@/lib/accent-color"
import { GENRE_FALLBACK } from "@/lib/badges"
import { RENDER_VERSION } from "./render-version"
import { ARTWORKS_BASE } from "@/lib/tvdb"
import { cachedImageBytes } from "@/lib/image-bytes-cache"
import { timedFetch, readResponseBody } from "@/lib/outbound-stats"
// Batch B: STD_W/STD_H ora provengono da image-utils.ts (single source of truth)
import { STD_W, STD_H, LAND_W, LAND_H, computeRegionStats } from "@/lib/image-utils"

// Sovrascrivibile via env: nei test E2E punta al mock server locale per
// rendere il rendering determinista senza dipendere da image.tmdb.org.
const IMG_BASE = process.env.TMDB_IMG_URL || "https://image.tmdb.org/t/p"
const MAX_IMG_SIZE = 10 * 1024 * 1024

// Re-export per backward compat — tutti i file che importano STD_W/STD_H
// da poster-render-helpers continuano a funzionare.
export { STD_W, STD_H }
export const OUTPUT_W = 500
export const OUTPUT_H = 750

export type BadgeRender = { png: Buffer; w: number; h: number; isRank?: boolean; bleed?: BadgeBleed }
export type PosterComposite = { input: Buffer; top: number; left: number }

/** Visible-body rect inside a badge bitmap canvas (shadow/bleed excluded).
 *  Absolute pixels in the bitmap; absent = body fills the whole canvas. */
export interface BadgeBleed {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Visible-body rect of a badge bitmap (defaults to the full canvas). */
export function badgeBody(b: { w: number; h: number; bleed?: BadgeBleed }): BadgeBleed {
  return b.bleed ?? { x: 0, y: 0, w: b.w, h: b.h }
}

/** Canvas top-left that lands the visible BODY at (bodyLeft, bodyTop). */
export function badgeCanvasForBody(
  bodyLeft: number,
  bodyTop: number,
  b: { bleed?: BadgeBleed },
): { left: number; top: number } {
  return { left: bodyLeft - (b.bleed?.x ?? 0), top: bodyTop - (b.bleed?.y ?? 0) }
}

/** Scale a bleed rect by a bitmap resize ratio (one axis each). */
export function scaleBadgeBleed(bleed: BadgeBleed, rx: number, ry?: number): BadgeBleed {
  const ky = ry ?? rx
  return { x: bleed.x * rx, y: bleed.y * ky, w: bleed.w * rx, h: bleed.h * ky }
}

export function hashKey(key: string): string {
  return crypto.createHash("md5").update(key).digest("hex").slice(0, 16)
}

// Cache delle analisi pixel (luminance top/bottom, tinta di scena): come gli
// altri image-level cache, vive 24h sotto il tag "poster-extract" e la chiave
// identifica i byte sorgente (path TMDB immutabili per path + derivazione:
// portrait/backdrop/pillarbox). Nessun cambio dell'output: stessi byte in
// ingresso → stessi numeri in uscita, solo calcolati una volta per titolo
// invece che a ogni variante di cache key poster. Chiave null → ricalcolo
// diretto senza cache (mai poison da byte non identificati).
const ANALYSIS_CACHE_TTL = 24 * 60 * 60 * 1000
const ANALYSIS_CACHE_TAG = "poster-extract"

export async function fetchImg(url: string, signal?: AbortSignal): Promise<Buffer> {
  // Se il chiamante passa un signal esterno, unirlo al timeout interno invece
  // di sostituirlo: un signal mai abortito (es. renderAbort a render riuscito)
  // lascerebbe il fetch senza tetto in background. Il limite resta 15s.
  const timeoutSignal = AbortSignal.timeout(15000)
  let combined: AbortSignal = timeoutSignal
  if (signal) {
    if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
      combined = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
    } else {
      const ctrl = new AbortController()
      const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
      if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
      else {
        signal.addEventListener("abort", onAbort, { once: true })
        timeoutSignal.addEventListener("abort", onAbort, { once: true })
      }
      combined = ctrl.signal
    }
  }
  // Byte-LRU (F3): a parità di URL i re-download spariscono; SSRF check,
  // signal/timeout e cap size restano dentro doFetch, invariati. Il combined
  // (caller + 15s interni) viaggia anche come signal del waiter coalesced:
  // senza, un waiter resterebbe ostaggio del download del leader oltre la
  // propria scadenza (deadline del suo render / timeout interno).
  return cachedImageBytes(url, async () => {
    const res = await timedFetch(url, { signal: combined })
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
    const cl = res.headers.get("content-length")
    if (cl && Number(cl) > MAX_IMG_SIZE) throw new Error("image too large")
    const buf = Buffer.from(await readResponseBody(res))
    if (buf.length > MAX_IMG_SIZE) throw new Error("image too large")
    return buf
  }, combined)
}

export function isValidHex(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(color)
}

/** Vero quando fetchImg ha rifiutato per il cap anti-OOM (non per 404/timeout). */
export function isImageTooLargeError(e: unknown): boolean {
  return e instanceof Error && e.message === "image too large"
}

/**
 * Bounded-size fetch of a TMDB logo: raster logos download at the documented
 * `w500` tier FIRST (single request on success) instead of `original`-first,
 * so the ordinary poster path never pays a multi-MB original PNG (e.g. the
 * ~10.5MB/7795px Endgame logo, once rejected by the fetchImg anti-OOM cap
 * only after the headers arrived). `w780` is not a documented TMDB logo size
 * and is never attempted here. SVG stays `original` (vector size semantics:
 * a sized tier would rasterize server-side at TMDB). Absolute URLs download
 * once as-is (SSRF allowlist in imgSrc still applies). Cap, transport and
 * timeout/404/abort errors propagate with no extra network — no fallback
 * retries. Telemetry, deadline and byte-cache coalescing live in fetchImg.
 */
export async function fetchLogoImg(path: string, signal?: AbortSignal): Promise<Buffer> {
  // External URLs (http): imgSrc carries no size tier, retrying the same URL
  // would be pointless — a single attempt as before.
  if (path.startsWith("http")) return fetchImg(imgSrc(path), signal)
  // Vector logos keep full resolution: sizing happens locally at composite.
  if (path.toLowerCase().split(/[?#]/, 1)[0].endsWith(".svg")) {
    return fetchImg(imgSrc(path, "original"), signal)
  }
  return fetchImg(imgSrc(path, "w500"), signal)
}

export function imgSrc(path: string, size = "w500"): string {
  if (path.startsWith("http")) {
    // SSRF protection: only allow the TMDB image CDN and the TVDB artworks
    // CDN (fixed hosts — B1 rescue posters; same review bar as TMDB).
    if (!path.startsWith("https://image.tmdb.org/t/p/") && !path.startsWith(`${ARTWORKS_BASE}/`)) {
      throw new Error(`Blocked external image URL: ${path.slice(0, 60)}...`)
    }
    return path
  }
  // Raster logos download at `w500` via fetchLogoImg (bounded size; only SVG
  // vectors use `original`); poster/backdrop restano `w500` per non
  // appesantire memoria e tempi di risposta.
  return `${IMG_BASE}/${size}${path}`
}

export async function fitBadgeToCanvas<T extends BadgeRender>(badge: T, maxW: number, maxH: number): Promise<T> {
  if (badge.w <= maxW && badge.h <= maxH) return badge
  const scale = Math.min(maxW / badge.w, maxH / badge.h)
  const w = Math.max(Math.floor(badge.w * scale), 1)
  const h = Math.max(Math.floor(badge.h * scale), 1)
  const png = await sharp(badge.png)
    .resize(w, h, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 1 })
    .toBuffer()
  // The bleed rect travels with its bitmap: placement anchors the body.
  const bleed = badge.bleed ? scaleBadgeBleed(badge.bleed, w / badge.w, h / badge.h) : undefined
  return { ...badge, png, w, h, ...(bleed ? { bleed } : {}) }
}

export async function fitCompositeToCanvas(
  layer: PosterComposite,
  _maxW: number,
  _maxH: number,
): Promise<PosterComposite | null> {
  if (!layer.input || layer.input.length < 100) return null
  const meta = await sharp(layer.input).metadata()
  if ((meta.width || 0) <= 0 || (meta.height || 0) <= 0) return null
  // Sharp's .composite() handles out-of-bounds clipping natively — no sub-extract needed
  layer.top = Math.round(layer.top)
  layer.left = Math.round(layer.left)
  return layer
}

/**
 * Compute the luminance of the top strip of the poster (top 8% of STD_H).
 *
 * Batch B: delegates to computeRegionStats() from image-utils.ts, so the pixel
 * loop lives in one place instead of being duplicated here. The region stats
 * pool caches the result; computeTextPenalty() reuses the pool for its own
 * crop. Note: extractBadgeColor() has its own pipeline (accent-color.ts) and
 * does NOT consume this pool.
 *
 * The returned values differ slightly (~0.02) from the old topLuminance:
 * the previous implementation used RGBA stride-4, rounded per-channel means,
 * and skipped alpha removal; computeRegionStats uses RGB stride-3 with
 * unrounded Rec.709 luminance. This is why RENDER_VERSION was bumped.
 */
export async function topLuminance(buf: Buffer, cacheKey?: string | null): Promise<number> {
  const key = cacheKey ? `lum:top:${cacheKey}` : null
  const hit = key ? cacheGet<number>(key) : null
  if (hit !== null) return hit
  const stripH = Math.max(Math.round(STD_H * 0.08), 3)
  const stats = await computeRegionStats(buf, 0, 0, STD_W, stripH)
  const lum = stats ? stats.mean / 255 : 0.5 // fallback: medium luminance
  if (key) cacheSet(key, lum, [ANALYSIS_CACHE_TAG], ANALYSIS_CACHE_TTL)
  return lum
}

/**
 * Luminanza della striscia inferiore del poster (ultimo 8% di STD_H).
 * Speculare a topLuminance: decide la polarità del badge genere in basso
 * (bottomLight), che non può riusare il top su poster con alto chiaro e
 * fondo scuro. Stesso pool di computeRegionStats, stessa metrica.
 */
export async function bottomLuminance(buf: Buffer, cacheKey?: string | null): Promise<number> {
  const key = cacheKey ? `lum:bottom:${cacheKey}` : null
  const hit = key ? cacheGet<number>(key) : null
  if (hit !== null) return hit
  const stripH = Math.max(Math.round(STD_H * 0.08), 3)
  const stats = await computeRegionStats(buf, 0, STD_H - stripH, STD_W, stripH)
  const lum = stats ? stats.mean / 255 : 0.5 // fallback: medium luminance
  if (key) cacheSet(key, lum, [ANALYSIS_CACHE_TAG], ANALYSIS_CACHE_TTL)
  return lum
}

/**
 * Canvas dimensions for band sampling by poster shape. The route already fits
 * `posterBuf` to the effective canvas (portrait STD_W × STD_H, landscape
 * LAND_W × LAND_H) before the service runs, so sampling with these dims is a
 * near-identity resize — no new fetch, no second full render.
 */
export function canvasDimsForShape(shape: string | null | undefined): { width: number; height: number } {
  return shape === "landscape" ? { width: LAND_W, height: LAND_H } : { width: STD_W, height: STD_H }
}

/** Mean sRGB channels (0-255) of a badge band. Null when undecodable. */
export interface BandMeanRGB {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface BandSampleOptions {
  readonly cacheKey?: string | null
  readonly canvasW?: number
  readonly canvasH?: number
}

async function bandMeanRGB(
  buf: Buffer,
  band: "top" | "bottom",
  opts?: BandSampleOptions,
): Promise<BandMeanRGB | null> {
  const canvasW = Math.round(opts?.canvasW ?? STD_W)
  const canvasH = Math.round(opts?.canvasH ?? STD_H)
  if (canvasW <= 0 || canvasH <= 0) return null
  const key = opts?.cacheKey ? `accent-band:${band}:${canvasW}x${canvasH}:${opts.cacheKey}` : null
  const hit = key ? cacheGet<BandMeanRGB>(key) : null
  if (hit !== null) return hit
  // Same 8% edge strip as the topLight/bottomLight polarity path: the badge
  // row lives at the canvas edge, so the strip mean is the documented
  // two-band approximation of the local badge background (NOT a per-badge
  // pixel-exact sample — explicit user offsets can move a badge outside its
  // band; the anchor-nearest policy still applies, see the service call site).
  const stripH = Math.max(Math.round(canvasH * 0.08), 3)
  const top = band === "top" ? 0 : canvasH - stripH
  const stats = await computeRegionStats(buf, 0, top, canvasW, stripH, { width: canvasW, height: canvasH })
  if (!stats) return null
  const mean: BandMeanRGB = { r: stats.meanR, g: stats.meanG, b: stats.meanB }
  if (key) cacheSet(key, mean, [ANALYSIS_CACHE_TAG], ANALYSIS_CACHE_TTL)
  return mean
}

/**
 * Mean sRGB of the top 8% strip (rank/extra badge band) on the effective
 * canvas. Reuses the computeRegionStats pool + analysis cache: no new fetch,
 * at most one small crop decode per band per title (24h `poster-extract`).
 */
export function topBandMeanRGB(buf: Buffer, opts?: BandSampleOptions): Promise<BandMeanRGB | null> {
  return bandMeanRGB(buf, "top", opts)
}

/**
 * Mean sRGB of the bottom 8% strip (genre badge band) on the effective
 * canvas. Same pool/cache contract as topBandMeanRGB.
 */
export function bottomBandMeanRGB(buf: Buffer, opts?: BandSampleOptions): Promise<BandMeanRGB | null> {
  return bandMeanRGB(buf, "bottom", opts)
}

/**
 * Effective WCAG linear luminance of the top badge background: the band mean
 * (sRGB) veiled by the black top-shade gradient. The gradient runs full-width
 * from the top edge down to `tsh` % of the canvas height (`topShadeSVG`: edge
 * alpha 0.75·s/100, linear ramp to 0); the badge row sits at the edge, so the
 * edge alpha is the conservative veil — uniform-black blend, then WCAG
 * relativeLuminance on the veiled channels (NOT the nonlinear Rec.709 strip
 * mean fed blindly as linear). `topShade = 0` (falsy) = no veil, never an
 * inherited value. `topShadeHeight = 0` also means no veil (zero-height
 * shadow paints nothing): the raw band mean is measured. Any other height
 * keeps the edge-alpha model (the badge row is always at the edge).
 */
export function effectiveTopBackgroundLuminance(mean: BandMeanRGB, topShade: number, topShadeHeight = 25): number {
  const s = Math.max(0, Math.min(100, Number.isFinite(topShade) ? topShade : 0)) / 100
  const h = Number.isFinite(topShadeHeight) ? topShadeHeight : 25
  if (s <= 0 || h <= 0) return relativeLuminance(mean.r, mean.g, mean.b)
  const alpha = 0.75 * s
  const k = 1 - alpha
  return relativeLuminance(mean.r * k, mean.g * k, mean.b * k)
}

/**
 * Effective WCAG linear luminance of the bottom badge background: the band
 * mean (sRGB) veiled by the bottom blur darkness. The veil applies ONLY when
 * the bottom blur is actually enabled; otherwise the raw band mean is
 * measured. Same conservative uniform-veil model as `computeBottomLight`
 * (the real blur is a non-uniform gradient — documented approximation), but
 * computed in linear WCAG on the veiled channels instead of scaling the
 * nonlinear strip mean.
 */
export function effectiveBottomBackgroundLuminance(
  mean: BandMeanRGB,
  blurDarkness: number,
  blurEnabled: boolean,
): number {
  const d = blurEnabled ? Math.max(0, Math.min(100, Number.isFinite(blurDarkness) ? blurDarkness : 0)) / 100 : 0
  const k = 1 - d
  return relativeLuminance(mean.r * k, mean.g * k, mean.b * k)
}

/**
 * Adaptive automatic accent for one badge band. Manual overrides never reach
 * here (the caller gates on `accentOverride` — manual stays byte-identical).
 * With an extracted scene tint AND a known local background, the bounded
 * solver (`adaptiveAutomaticAccentHex`: same hue/saturation, L in
 * [0.24, 0.60], text 4.5:1 first, 3:1 separation second, best-effort
 * documented when infeasible) adapts the fill to its band. Without extraction
 * (genre/gray fallback) or without a background sample, the legacy fixed
 * 5/12 normalization applies byte-identically — including every
 * GENRE_FALLBACK entry (Comedy included). Malformed input passes through
 * untouched (never an invented color).
 */
export function adaptiveAccentHexForBand(
  sceneTintHex: string | null | undefined,
  fallbackHex: string,
  backgroundLuminance: number | null | undefined,
): string {
  if (!sceneTintHex) return normalizeAutomaticAccentHex(fallbackHex)
  if (backgroundLuminance === null || backgroundLuminance === undefined || !Number.isFinite(backgroundLuminance)) {
    return normalizeAutomaticAccentHex(sceneTintHex)
  }
  return adaptiveAutomaticAccentHex(sceneTintHex, { backgroundLuminance })
}

// B3: memo decode condivisi per extractBadgeColor (chiamato 2× — top+bottom —
// sullo STESSO posterBuf/logoBuf da resolveBadgeColors). WeakMap keyed sul
// Buffer: stesso oggetto = stessi byte, quindi niente invalidazione; le entry
// muoiono col GC dei buffer. Stessi byte negli stessi algoritmi → output
// identico, solo meno decode (1 resize 200×300 e 1 raw logo risparmiati).
const thumbMemo = new WeakMap<Buffer, Promise<Buffer>>()
function posterThumb(posterBuf: Buffer): Promise<Buffer> {
  let p = thumbMemo.get(posterBuf)
  if (!p) {
    p = sharp(posterBuf).resize(200, 300, { fit: "cover" }).toBuffer()
    thumbMemo.set(posterBuf, p)
  }
  return p
}

interface LogoRaw {
  readonly pixels: Buffer
  readonly w: number
  readonly h: number
}
const logoRawMemo = new WeakMap<Buffer, Promise<LogoRaw | null>>()
function logoRawPixels(logoBuf: Buffer): Promise<LogoRaw | null> {
  let p = logoRawMemo.get(logoBuf)
  if (!p) {
    p = (async (): Promise<LogoRaw | null> => {
      try {
        const meta = await sharp(logoBuf).metadata()
        const pixels = await sharp(logoBuf).ensureAlpha().raw().toBuffer()
        return { pixels, w: meta.width || 200, h: meta.height || 100 }
      } catch {
        return null
      }
    })()
    logoRawMemo.set(logoBuf, p)
  }
  return p
}

export async function extractBadgeColor(
  posterBuf: Buffer,
  logoBuf?: Buffer | null,
  fallbackGenre?: string | null,
  region?: 'bottom' | 'top',
): Promise<string> {
  function extractFromRaw(pixels: Buffer, w: number, h: number, genre: string): string {
    const result = findAccentColor(pixels, w, h, genre)
    return `#${result.r.toString(16).padStart(2, "0")}${result.g.toString(16).padStart(2, "0")}${result.b.toString(16).padStart(2, "0")}`
  }

  const thumbBuf = await posterThumb(posterBuf)

  // Crop to target region for more focused color extraction
  let posterAnalysisBuf = thumbBuf
  const posterW = 200
  let posterH = 300
  if (region === 'bottom') {
    posterH = 120  // bottom 40%
    posterAnalysisBuf = await sharp(thumbBuf)
      .extract({ left: 0, top: 180, width: 200, height: posterH })
      .toBuffer()
  } else if (region === 'top') {
    posterH = 120  // top 40%
    posterAnalysisBuf = await sharp(thumbBuf)
      .extract({ left: 0, top: 0, width: 200, height: posterH })
      .toBuffer()
  }

  const posterPixels = await sharp(posterAnalysisBuf).ensureAlpha().raw().toBuffer()
  const logoRaw = logoBuf ? await logoRawPixels(logoBuf) : null
  const posterColor = extractFromRaw(posterPixels, posterW, posterH, fallbackGenre || "")
  const logoColor = logoRaw ? extractFromRaw(logoRaw.pixels, logoRaw.w, logoRaw.h, "") : ""

  if (posterColor && logoColor) {
    const pr = parseInt(posterColor.slice(1, 3), 16)
    const pg = parseInt(posterColor.slice(3, 5), 16)
    const pb = parseInt(posterColor.slice(5, 7), 16)
    const lr = parseInt(logoColor.slice(1, 3), 16)
    const lg = parseInt(logoColor.slice(3, 5), 16)
    const lb = parseInt(logoColor.slice(5, 7), 16)
    return `#${Math.round((pr + lr) / 2).toString(16).padStart(2, "0")}${Math.round((pg + lg) / 2).toString(16).padStart(2, "0")}${Math.round((pb + lb) / 2).toString(16).padStart(2, "0")}`
  }

  return posterColor || logoColor || (fallbackGenre ? (GENRE_FALLBACK[fallbackGenre] || "#555555") : "#555555")
}

/**
 * Extracts the tonal same-hue scene tint from the poster.
 *
 * Ambilight-style sampling of the OUTER frame only (15% margin, see
 * analyzeBuckets in accent-color.ts): faces/logos/titles sit in the center
 * and would hijack the vote (orange skin on Silo); edges almost always see
 * the background/atmosphere. The area-dominant family wins by construction.
 *
 * Total fail-safe: non lancia mai eccezioni, in caso di errore o buffer corrotto
 * restituisce l'hex di fallback del genere o #555555.
 * Riusa `posterThumb(posterBuf)` condividendo la memo WeakMap con `extractBadgeColor`.
 * Non analizza loghi (evita inquinamento cromatico da marchi bianchi/luminosi).
 */
export async function extractSceneTint(
  posterBuf: Buffer,
  fallbackGenre?: string | null,
  cacheKey?: string | null,
): Promise<string> {
  const defaultFallback = fallbackGenre ? (GENRE_FALLBACK[fallbackGenre] || "#555555") : "#555555"
  // Namespaced by RENDER_VERSION (internal key, never a public param): entries
  // written by older code (unversioned `tint:<key>:<genre>`) are simply never
  // read again, so a render-algorithm change cannot serve a stale tint for up
  // to 24h on long-lived/KV instances. No user-cache flush needed: the new
  // namespace repopulates lazily, and RENDER_FILES already rotates the
  // namespace on every future render change.
  const key = cacheKey ? `tint:${RENDER_VERSION}:${cacheKey}:${fallbackGenre ?? "x"}` : null
  const hit = key ? cacheGet<string>(key) : null
  if (hit !== null) return hit
  try {
    const thumbBuf = await posterThumb(posterBuf)
    const posterW = 200
    const posterH = 300

    const pixels = await sharp(thumbBuf).ensureAlpha().raw().toBuffer()
    const tint = findSceneTint(pixels, posterW, posterH, fallbackGenre || "")
    const hex = `#${tint.r.toString(16).padStart(2, "0")}${tint.g.toString(16).padStart(2, "0")}${tint.b.toString(16).padStart(2, "0")}`
    if (key) cacheSet(key, hex, [ANALYSIS_CACHE_TAG], ANALYSIS_CACHE_TTL)
    return hex
  } catch {
    return defaultFallback
  }
}
