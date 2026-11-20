/**
 * Fallback standalone dell'icona tipo (solo glifo bianco con ombra morbida,
 * senza sfondo) per i layout senza badge genere standard (Fresh/Card, genere
 * spento). Con il badge genere standard il glifo è inline nella riga.
 * Bitmap `{png,w,h}`. Mai throw: errore → null.
 */
import { TYPE_ICON_PATHS, TYPE_ICON_INK_W, type TypeIconKind } from "./type-icon-glyphs"

export type { TypeIconKind }

export async function renderTypeIcon(
  kind: TypeIconKind,
  sizePx: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (sizePx < 8) return null
  try {
    const sharp = (await import("sharp")).default
    const s = sizePx / TYPE_ICON_INK_W
    const pad = Math.ceil(sizePx * 0.2)
    const w = sizePx + pad * 2
    const h = Math.ceil(16 * s) + pad * 2
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${(sizePx * 0.05).toFixed(2)}" stdDeviation="${(sizePx * 0.07).toFixed(2)}" flood-color="#000" flood-opacity="0.6"/></filter></defs>` +
      `<g filter="url(#sh)"><path fill="#fff" fill-rule="evenodd" transform="translate(${(pad - 3 * s).toFixed(2)},${(h / 2 - 12 * s).toFixed(2)}) scale(${s.toFixed(4)})" d="${TYPE_ICON_PATHS[kind]}"/></g></svg>`
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    return { png, w, h }
  } catch {
    return null
  }
}
