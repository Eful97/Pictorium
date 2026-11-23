import sharp from "sharp"
import { cacheGet, cacheSet } from "./cache"
import { GENRE_FALLBACK } from "./badges"
import { extractBadgeColor, isValidHex } from "./poster-render-helpers"

// TTL cache image-level (colori badge, resize logo/backdrop): le immagini TMDB
// sono immutabili per path → 24h come la badge cache. Le entry si auto-espellono
// col byte/entry limit della cache globale (tag "poster-extract").
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000
const IMAGE_CACHE_TAG = "poster-extract"

// ---------------------------------------------------------------------------
// Image-level caches (colori badge, resize logo/backdrop)
// ---------------------------------------------------------------------------
// Questi passaggi sharp si ripetono a OGNI render freddo, anche per lo stesso
// titolo: cache key poster diverse (config token, rank che cambia, preview
// WYSIWYG, versioni mapping) condividono lo stesso poster/logo/backdrop. Il
// risultato dipende solo dall'immagine sorgente (URL TMDB immutabili per path)
// → si può cachare per path. Nessun cambio dell'output visivo: stesse operazioni
// sharp, stesso ordine, stessi parametri — solo eseguite una volta.

export interface BadgeColorsResult {
  readonly genreColor: string
  readonly rankColor: string
}

/** Colori accent (genere + rank) con cache per (posterSrc, logoSrc, genreName, hueMode, bottomFraction). */
export async function resolveBadgeColors(
  posterBuf: Buffer,
  logoFetch: Buffer | null,
  genreName: string | null,
  posterSrc?: string | null,
  logoSrc?: string | null,
): Promise<BadgeColorsResult> {
  const key = posterSrc ? `extract:${posterSrc}:${logoSrc ?? "x"}:${genreName ?? "x"}` : null
  const cached = key ? cacheGet<BadgeColorsResult>(key) : null
  if (cached) return cached
  const [gColor, rColor] = await Promise.all([
    extractBadgeColor(posterBuf, logoFetch, genreName, 'bottom'),
    extractBadgeColor(posterBuf, logoFetch, null, 'top'),
  ])
  const colors: BadgeColorsResult = {
    genreColor: isValidHex(gColor) ? gColor : (genreName ? GENRE_FALLBACK[genreName] : undefined) || "#555555",
    rankColor: isValidHex(rColor) ? rColor : "#555555",
  }
  if (key) cacheSet(key, colors, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return colors
}

export interface ResizedImage {
  readonly input: Buffer
  readonly w: number
  readonly h: number
}

/** Resize logo (con re-encode PNG) cachato per (logoSrc, dimensioni target). */
export async function resizeLogoCached(
  logoFetch: Buffer,
  width: number,
  height: number,
  logoSrc?: string | null,
): Promise<ResizedImage> {
  const key = logoSrc ? `logo-resize:${logoSrc}:${width}:${height}` : null
  const cached = key ? cacheGet<ResizedImage>(key) : null
  if (cached) return cached
  const { data: input, info } = await sharp(logoFetch).resize(width, height, { fit: "inside" }).png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true })
  const result: ResizedImage = { input, w: info.width || width, h: info.height || height }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}

/** Dimensioni originali del backdrop, cachate per src (salta il metadata() ripetuto). */
export async function backdropMetaCached(
  backdropFetch: Buffer,
  backdropSrc?: string | null,
): Promise<{ readonly width: number; readonly height: number }> {
  const key = backdropSrc ? `backdrop-meta:${backdropSrc}` : null
  const cached = key ? cacheGet<{ width: number; height: number }>(key) : null
  if (cached) return cached
  const meta = await sharp(backdropFetch).metadata()
  const result = { width: meta.width || 1920, height: meta.height || 1080 }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}

/** Resize backdrop cachato per (backdropSrc, dimensioni target). */
export async function resizeBackdropCached(
  backdropFetch: Buffer,
  width: number,
  height: number,
  backdropSrc?: string | null,
): Promise<ResizedImage> {
  const key = backdropSrc ? `backdrop-resize:${backdropSrc}:${width}:${height}` : null
  const cached = key ? cacheGet<ResizedImage>(key) : null
  if (cached) return cached
  const resized = await sharp(backdropFetch).resize(width, height, { fit: 'fill' }).toBuffer()
  const result: ResizedImage = { input: resized, w: width, h: height }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}
