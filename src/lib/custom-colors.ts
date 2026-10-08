/**
 * Colori d'accento per le basi custom (URL esterni: Fanart.tv, Pinterest…).
 *
 * Il client NON può campionarli dal canvas: i byte cross-origin restano
 * illeggibili (cache opaca / taint) anche quando il CDN invia CORS, e il
 * fallimento è silente (colori stale del poster precedente). Il server li
 * calcola sugli stessi byte validati del render (fetchValidatedCustomImage +
 * byte-cache condivisa) con le stesse funzioni dell'analisi pixel.
 */

import sharp from "sharp"
import {
  fetchValidatedCustomImage,
  type CustomFetchDeps,
} from "./custom-poster-base"
import {
  bottomEdgeAverage,
  findSceneTint,
  normalizeAutomaticAccent,
  topEdgeAverage,
} from "./accent-color"

export interface CustomImageColors {
  readonly accent: string
  readonly topEdge: string
  readonly bottomEdge: string
}

function toHex(c: { r: number; g: number; b: number }): string | null {
  if (![c.r, c.g, c.b].every((n) => Number.isFinite(n))) return null
  const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${cl(c.r).toString(16).padStart(2, "0")}${cl(c.g).toString(16).padStart(2, "0")}${cl(c.b).toString(16).padStart(2, "0")}`
}

/**
 * Accent/top/bottom di un URL custom già allowlisted. Ritorna null su
 * qualsiasi fallimento (host, SSRF, byte invalidi, decode): il chiamante
 * tiene i colori precedenti, come il canvas client oggi.
 * Il decode lavora su thumb ≤342px come il campionamento client.
 */
export async function sampleCustomImageColors(
  rawUrl: string,
  genre: string,
  signal: AbortSignal,
  deps?: CustomFetchDeps,
): Promise<CustomImageColors | null> {
  const buf = await fetchValidatedCustomImage(rawUrl, signal, deps).catch(() => null)
  if (!buf) return null
  try {
    const { data, info } = await sharp(buf)
      .resize({ width: 342, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (!info.width || !info.height || data.length === 0) return null
    const g = genre || ""
    // Only the badge accent is normalized to 5/12 HSL lightness (like the
    // server render): top/bottom stay the natural edge averages.
    const accent = toHex(normalizeAutomaticAccent(findSceneTint(data, info.width, info.height, g)))
    const topEdge = toHex(topEdgeAverage(data, info.width, info.height))
    const bottomEdge = toHex(bottomEdgeAverage(data, info.width, info.height))
    if (!accent || !topEdge || !bottomEdge) return null
    return { accent, topEdge, bottomEdge }
  } catch {
    return null
  }
}
