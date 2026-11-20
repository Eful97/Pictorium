/**
 * Fila "Dove guardare": fino a MAX_ICONS icone provider quadrate arrotondate
 * (+ slot contatore "+N" quando i provider sono di più). Bitmap `{png,w,h}`
 * come gli altri badge network, così il layout esistente la tratta da logo.
 * Mai throw: nessun logo caricabile → null (il poster resta invariato).
 */

import type { WatchProvider } from "@/lib/watch-providers"

export const MAX_WATCH_ICONS = 3

const TMDB_IMG_BASE = process.env.TMDB_IMG_URL || "https://image.tmdb.org/t/p"
const LOGO_SIZE = "w92"
const SAFE_LOGO_PATH = /^\/[A-Za-z0-9_.-]{1,80}$/

export type WatchLogoLoader = (logoPath: string, signal?: AbortSignal) => Promise<Buffer | null>

const logoCache = new Map<string, Buffer>()
const LOGO_CACHE_MAX = 100

/** Loader di default: path validato (mai interpolato libero), cache in memoria. */
export const loadWatchProviderLogo: WatchLogoLoader = async (logoPath, signal) => {
  if (!SAFE_LOGO_PATH.test(logoPath)) return null
  const hit = logoCache.get(logoPath)
  if (hit) return hit
  try {
    const { fetchImg } = await import("./poster-render-helpers")
    const buf = await fetchImg(`${TMDB_IMG_BASE}/${LOGO_SIZE}${logoPath}`, signal)
    if (logoCache.size >= LOGO_CACHE_MAX) logoCache.delete(logoCache.keys().next().value!)
    logoCache.set(logoPath, buf)
    return buf
  } catch {
    return null
  }
}

export async function renderWatchProviderRow(
  providers: readonly WatchProvider[],
  iconPx: number,
  loadLogo: WatchLogoLoader = loadWatchProviderLogo,
  signal?: AbortSignal,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (providers.length === 0 || iconPx < 8) return null
  try {
    const sharp = (await import("sharp")).default
    const radius = Math.round(iconPx * 0.22)
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${iconPx}" height="${iconPx}"><rect width="${iconPx}" height="${iconPx}" rx="${radius}" fill="#fff"/></svg>`,
    )
    const shown = providers.slice(0, MAX_WATCH_ICONS)
    const loaded: Array<Buffer | null> = await Promise.all(
      shown.map(async (p) => {
        const buf = await loadLogo(p.logoPath, signal)
        if (!buf) return null
        return sharp(buf)
          .resize(iconPx, iconPx, { fit: "cover" })
          .ensureAlpha()
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer()
      }),
    )
    const icons: Buffer[] = loaded.filter((b) => b !== null)
    if (icons.length === 0) return null

    const extra = providers.length - MAX_WATCH_ICONS
    const slots: Buffer[] = [...icons]
    if (extra > 0) {
      const fs = Math.round(iconPx * 0.42)
      const chip = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${iconPx}" height="${iconPx}">` +
          `<rect width="${iconPx}" height="${iconPx}" rx="${radius}" fill="#1c1f2b" fill-opacity="0.85"/>` +
          `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="${fs}" fill="#fff">+${extra}</text></svg>`,
      )
      slots.push(await sharp(chip).png().toBuffer())
    }

    const gap = Math.round(iconPx * 0.18)
    const w = slots.length * iconPx + (slots.length - 1) * gap
    const png = await sharp({ create: { width: w, height: iconPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(slots.map((input, i) => ({ input, left: i * (iconPx + gap), top: 0 })))
      .png()
      .toBuffer()
    return { png, w, h: iconPx }
  } catch {
    return null
  }
}
