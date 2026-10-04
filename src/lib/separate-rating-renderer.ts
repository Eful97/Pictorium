import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { escSvg, estimateTextWidth, fontFamilyFor, normalizeBadgeFont, satinPillStops } from "./badge-svg-shared"
import { renderSVG } from "./svg-badge"
import { formatSeparateValue } from "./ratings"
import type { BadgeFont } from "./badge-styles"

/** Mappa fonte → asset logo (stesso riuso di RatingSourceIcon: metacriticuser→metacritic, filmwebcritics→filmweb). */
const SEPARATE_RATING_ICON_FILES: Record<string, string> = {
  imdb: "imdb.svg",
  tmdb: "tmdb.svg",
  mdblist: "mdblist.svg",
  tomatoes: "tomatoes.svg",
  popcorntime: "popcorntime.svg",
  letterboxd: "letterboxd.svg",
  metacritic: "metacritic.svg",
  metacriticuser: "metacritic.svg",
  trakt: "trakt.svg",
  simkl: "simkl.svg",
  mal: "mal.svg",
  anilist: "anilist.svg",
  kitsu: "kitsu.svg",
  filmweb: "filmweb.svg",
  filmwebcritics: "filmweb.svg",
  rogerebert: "rogerebert.svg",
}

const RATINGS_DIR = path.join(process.cwd(), "public", "rating")

/**
 * Ombra dedicata ai pill separati: più stretta della 3D standard dei badge
 * (dx=3, dy=3, blur 3.5) — su pill da ~40px con gap verticale di 5px
 * l'ombra standard sborda sul pill successivo e agli angoli sembra un
 * blocco squadrato. Con dy=2 + blur 2 l'estensione (~4px) resta nel gap.
 */
const SEPARATE_SHADOW_FILTER = `<filter id="seps" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.55"/></filter>`

/** Gap verticale tra le pill dello stack. */
export const SEPARATE_STACK_GAP = 5

/**
 * Logo provider a colori brand originali (mai ricolorati, a differenza dei
 * loghi network). Ritorna null se l'asset manca o non rasterizza: la pill
 * viene skippata invece di rompere il render.
 */
async function loadSeparateRatingLogo(source: string, targetH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
  const filename = SEPARATE_RATING_ICON_FILES[source.toLowerCase()]
  if (!filename) return null
  const filePath = path.join(RATINGS_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const svgBuffer = await fs.promises.readFile(filePath)
    const { data, info } = await sharp(svgBuffer, { density: 288 })
      .resize({ height: Math.max(2, targetH * 2) })
      .png()
      .toBuffer({ resolveWithObject: true })
    const w = Math.max(1, Math.round(info.width / 2))
    const h = Math.max(1, Math.round(info.height / 2))
    const png = await sharp(data).resize(w, h).toBuffer()
    return { png, w, h }
  } catch {
    return null
  }
}

export interface SeparateRatingStack {
  readonly png: Buffer
  readonly w: number
  readonly h: number
}

/**
 * Colonna rating separati in UN solo bitmap: pill verticali (logo sopra,
 * punteggio sotto, centrati) TUTTE della stessa larghezza (la max dei
 * contenuti + padding), così la colonna è dritta e non dentellata.
 * Stile quality-badge (satinato polarizzato, bordo 1.5px, ombra 3D singola).
 * Fonti senza asset logo skippate; se nessuna resta → null.
 */
export async function renderSeparateRatingStack(
  items: readonly { id: string; value: number }[],
  pw: number,
  topLight = true,
  /** Font dei punteggi (default "inter" = resa storica; i loghi provider restano invariati). */
  font: BadgeFont = "inter",
): Promise<SeparateRatingStack | null> {
  // Pill compatte in stile moderno: proporzioni solide e bilanciate col badge 4K.
  const f = normalizeBadgeFont(font)
  const fs = Math.round(Math.max(14 * pw / 380, 11))
  const px = Math.round(fs * 0.6)
  const pt = Math.max(2, Math.round(fs * 0.22))
  const gap = Math.max(2, Math.round(fs * 0.18))
  const logoH = Math.round(fs * 0.95)
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"

  const rows: { logo: { png: Buffer; w: number; h: number }; display: string; textW: number; pillH: number }[] = []
  for (const item of items) {
    const logo = await loadSeparateRatingLogo(item.id, logoH)
    if (!logo) continue
    const display = formatSeparateValue(item.id, item.value)
    const textW = Math.max(estimateTextWidth(display, fs, f), 1)
    rows.push({ logo, display, textW, pillH: pt + logo.h + gap + fs + pt })
  }
  if (rows.length === 0) return null

  // Larghezza UNIFORME: max dei contenuti + padding — la colonna è dritta.
  const colW = Math.max(...rows.map((r) => Math.max(r.logo.w, r.textW))) + px * 2
  const r = Math.round(Math.max(...rows.map((row) => row.pillH)) * 0.32)
  const totalH = rows.reduce((acc, row) => acc + row.pillH, 0) + SEPARATE_STACK_GAP * (rows.length - 1)

  let y = 0
  const parts: string[] = []
  for (const row of rows) {
    const logoX = Math.round((colW - row.logo.w) / 2)
    const textY = y + pt + row.logo.h + gap + Math.round(fs / 2)
    parts.push(
      `<rect y="${y}" width="${colW}" height="${row.pillH}" rx="${r}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5" filter="url(#seps)"/>` +
      `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${logoX}" y="${y + pt}" width="${row.logo.w}" height="${row.logo.h}"/>` +
      `<text x="${colW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`,
    )
    y += row.pillH + SEPARATE_STACK_GAP
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${colW}" height="${totalH}">` +
    `<defs><linearGradient id="sepg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${SEPARATE_SHADOW_FILTER}</defs>` +
    parts.join("") +
    `</svg>`
  const png = await renderSVG(svg, colW)
  return { png, w: colW, h: totalH }
}
