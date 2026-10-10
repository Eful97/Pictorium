import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { escSvg, estimateTextWidth, fontFamilyFor, normalizeBadgeFont, satinPillStops } from "./badge-svg-shared"
import { renderSVG } from "./svg-badge"
import { formatSeparateValue, MAX_SEPARATE_RATINGS } from "./ratings"
import type { BadgeFont, SeparateBottomVariant } from "./badge-styles"

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
export async function loadSeparateRatingLogo(source: string, targetH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
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

/** Round marks for the container-free layouts; legacy brand assets stay untouched. */
async function loadRoundRatingLogo(
  source: string,
  diameter: number,
  monochrome: boolean,
  bottomLight: boolean,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const id = source.toLowerCase()
  const filename = SEPARATE_RATING_ICON_FILES[id]
  if (!filename) return null
  try {
    let svg = await fs.promises.readFile(path.join(RATINGS_DIR, filename), "utf8")
    // IMDb's existing asset includes a yellow rectangle. Keep only its letters
    // on the new round plate, without changing the column/bar/pill asset.
    if (id === "imdb") svg = svg.replace(/<use\b[^>]*xlink:href="#d1pwhf9wy2"[^>]*\/>/g, "")
    const d = Math.max(2, diameter)
    const naturalTomato = id === "tomatoes" && !monochrome
    const inset = naturalTomato ? 0 : Math.round(d * 0.14)
    const glyphSize = Math.max(1, d - inset * 2)
    const { data, info } = await sharp(Buffer.from(svg), { density: 288 })
      .resize(glyphSize, glyphSize, { fit: "contain", background: "#00000000" })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const tone = bottomLight ? 32 : 208
    if (monochrome) {
      // Preserve white countershapes (e.g. Metacritic's m) while all brand
      // colours become the same dark ink against the monochrome plate.
      for (let i = 0; i < data.length; i += 4) {
        const white = Math.min(data[i], data[i + 1], data[i + 2]) > 230
        const v = white ? tone : (bottomLight ? 208 : 32)
        data[i] = data[i + 1] = data[i + 2] = v
      }
    }
    const glyph = await sharp(data, { raw: info }).png().toBuffer()
    const plateColor = monochrome ? `rgb(${tone},${tone},${tone})` : id === "imdb" ? "#f6c700" : "#032541"
    const plate = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">` +
      (naturalTomato ? "" : `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${plateColor}"/>`) +
      `<image href="data:image/png;base64,${glyph.toString("base64")}" x="${inset}" y="${inset}" width="${glyphSize}" height="${glyphSize}"/></svg>`
    return { png: await renderSVG(plate, d), w: d, h: d }
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
  /** Scala % della colonna (default 130; esplicito 100 = resa storica byte-identica). */
  scalePct: number = 130,
): Promise<SeparateRatingStack | null> {
  // Pill compatte in stile moderno: proporzioni solide e bilanciate col badge 4K.
  const f = normalizeBadgeFont(font)
  const baseFs = Math.round(Math.max(14 * pw / 380, 11))
  const scale = Number.isFinite(scalePct) ? Math.min(Math.max(Math.round(scalePct), 10), 200) : 130
  // A 100 il font resta l'esatto storico (nessun arrotondamento intermedio):
  // padding, gap, loghi e ombre risultano byte-identici al passato.
  // Cap condiviso: oltre MAX_SEPARATE_RATINGS la colonna mangerebbe il poster
  // (stesso clamp della riga bottom; l'ordine di selezione resta al chiamante).
  const capped = items.slice(0, MAX_SEPARATE_RATINGS)
  const fs = scale === 100 ? baseFs : Math.max(1, Math.round(baseFs * scale / 100))
  const px = Math.round(fs * 0.6)
  const pt = Math.max(2, Math.round(fs * 0.22))
  const gap = Math.max(2, Math.round(fs * 0.18))
  const logoH = Math.round(fs * 0.95)
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"

  const rows: { logo: { png: Buffer; w: number; h: number }; display: string; textW: number; pillH: number }[] = []
  for (const item of capped) {
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

/**
 * Riga rating separati in basso (modalità bottom): logo provider + valore
 * affiancati in linea, max MAX_SEPARATE_RATINGS (=5, clamp anche su chiamate
 * dirette), vuota → null (mai placeholder senza dati).
 *
 * Quattro varianti in stile Pictorium (mai clone di layout esterni):
 * - `bottom-bar`: fascia satinata a tutta larghezza `width` sul bordo
 *   inferiore, celle equidistanti centrate (logo + valore inline);
 * - `bottom-pills`: 1-5 pill orizzontali satinate con contorno sottile e
 *   ombra coerente, riga centrata di larghezza naturale (max `width`).
 * - `bottom-mono` / `bottom-color`: icone tonde + voto senza pillola/barra
 *   né contenitore (mono = piastra grigia + voto monocolore, color = piastra
 *   brand originale + voto chiaro su scuro); base font 23 (15 per bar/pills).
 *
 * Riuso esistente: loghi brand `loadSeparateRatingLogo`, `formatSeparateValue`
 * (percent per la famiglia percent), `estimateTextWidth`/`fontFamilyFor` per
 * font, `satinPillStops(bottomLight)` + ombra `seps` per i materiali. Materiale
 * satinato adattivo come il badge genere (fondo chiaro → pill scura con testo
 * chiaro, fondo scuro → pill chiara con testo scuro): loghi brand invariati.
 * Scala % nativa via font 10..200 (a 100 percorso
 * identico); se la riga non entra in `width` (valori lunghi tipo `100%`,
 * cinque provider, scala max) fit sul font + shrink proporzionale del bitmap —
 * mai clipping, mai numeri minuscoli a scala 100.
 */
export async function renderSeparateRatingsBottom(
  items: readonly { id: string; value: number }[],
  pw: number,
  variant: SeparateBottomVariant,
  /** Font dei valori (default "inter"; i loghi provider restano invariati). */
  font: BadgeFont = "inter",
  /** Scala % della riga (default 130, stessi bound della colonna). */
  scalePct: number = 130,
  /**
   * Bar: larghezza della fascia (canvas portrait, contenuto landscape).
   * Pills: larghezza massima della riga. Default `pw`.
   */
  width?: number,
  /**
   * Polarità del materiale (stessa convenzione del badge genere: fondo chiaro
   * → pill scura). Default `true` = resa dark storica (chiamate esistenti invariate).
   */
  bottomLight: boolean = true,
): Promise<SeparateRatingStack | null> {
  const list = items.slice(0, MAX_SEPARATE_RATINGS)
  if (list.length === 0) return null
  const isBar = variant === "bottom-bar"
  const isBare = variant === "bottom-mono" || variant === "bottom-color"
  const f = normalizeBadgeFont(font)
  const baseFs = Math.round(Math.max((isBare ? 23 : 15) * pw / 380, 11))
  const scale = Number.isFinite(scalePct) ? Math.min(Math.max(Math.round(scalePct), 10), 200) : 130
  const reqFs = scale === 100 ? baseFs : Math.max(1, Math.round(baseFs * scale / 100))
  // Materiale adattivo (stessa convenzione del badge genere): fondo chiaro →
  // pill scura + testo chiaro, fondo scuro → pill chiara + testo scuro.
  const fg = isBare
    ? (bottomLight ? "#202020" : "#d0d0d0")
    : (bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
  const stroke = bottomLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const bandW = Math.max(1, Math.round(width ?? pw))
  const maxW = Math.max(1, Math.round(width ?? pw))
  // Fit sul font (come il loop max-iterazioni delle pill genere): a scala max
  // o con valori lunghi il font scende finché la riga entra — mai overlap tra
  // celle, mai numeri minuscoli a scala 100 (il loop non scatta mai al default
  // su larghezze normali). Ultima rete: shrink proporzionale del bitmap.
  const floorFs = Math.max(8, Math.round(baseFs * 0.55))
  interface BottomRow { logo: { png: Buffer; w: number; h: number }; display: string; textW: number; contentW: number; contentH: number }
  const rowW = (rows: BottomRow[], fs: number): number => {
    const px = isBare ? 0 : Math.round(fs * 0.7)
    const pillGap = Math.max(6, Math.round(fs * (isBare ? 0.75 : 0.45)))
    return rows.reduce((acc, row) => acc + row.contentW + px * 2, 0) + pillGap * (rows.length - 1)
  }
  // Costruzione righe a un fs dato (loghi caricati a quell'altezza: misure
  // testo/logo sempre coerenti col font di build).
  const buildRows = async (size: number): Promise<BottomRow[]> => {
    const logoH = Math.round(size * 1.05)
    const gap = Math.max(3, Math.round(size * 0.35))
    const out: BottomRow[] = []
    for (const item of list) {
      const logo = isBare
        ? await loadRoundRatingLogo(item.id, logoH, variant === "bottom-mono", bottomLight)
        : await loadSeparateRatingLogo(item.id, logoH)
      if (!logo) continue
      const display = formatSeparateValue(item.id, item.value)
      const textW = Math.max(estimateTextWidth(display, size, f), 1)
      out.push({ logo, display, textW, contentW: logo.w + gap + textW, contentH: Math.max(logo.h, size) })
    }
    return out
  }
  let fs = reqFs
  let rows: BottomRow[] = []
  let builtFs = -1
  for (let attempt = 0; attempt < 4; attempt++) {
    rows = await buildRows(fs)
    if (rows.length === 0) return null
    builtFs = fs
    const fits = isBar
      ? Math.max(...rows.map((r) => r.contentW)) <= bandW / rows.length - 8
      : rowW(rows, fs) <= maxW
    if (fits || fs <= floorFs) break
    fs = Math.max(floorFs, Math.round(fs * 0.85))
  }
  if (builtFs !== fs) {
    // L'ultimo fs ridotto non ha mai costruito le rows (mismatch testo/loghi):
    // ricostruzione finale coerente prima del raster.
    rows = await buildRows(fs)
    if (rows.length === 0) return null
  }
  const inlineGap = Math.max(3, Math.round(fs * 0.35))

  let svg: string
  let natW: number
  let natH: number
  if (isBar) {
    const py = Math.max(4, Math.round(fs * 0.6))
    const contentH = Math.max(...rows.map((r) => r.contentH))
    natW = bandW
    natH = contentH + py * 2
    const cellW = bandW / rows.length
    const cells = rows.map((row, i) => {
      const startX = Math.round(i * cellW + (cellW - row.contentW) / 2)
      const logoY = Math.round((natH - row.logo.h) / 2)
      const textY = Math.round(natH / 2)
      return (
        `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${startX}" y="${logoY}" width="${row.logo.w}" height="${row.logo.h}"/>` +
        `<text x="${startX + row.logo.w + inlineGap + row.textW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      )
    })
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">` +
      `<defs><linearGradient id="sepg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(bottomLight)}</linearGradient>${SEPARATE_SHADOW_FILTER}</defs>` +
      `<rect width="${natW}" height="${natH}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5"/>` +
      cells.join("") +
      `</svg>`
  } else if (isBare) {
    // No band, pill, border or background behind the values. Only round
    // provider marks + scores, using the existing fit/scale/font pipeline.
    const rowGap = Math.max(6, Math.round(fs * 0.75))
    const py = Math.max(2, Math.round(fs * 0.2))
    natH = Math.max(...rows.map((row) => row.contentH)) + py * 2
    natW = rowW(rows, fs)
    let x = 0
    const cells = rows.map((row) => {
      const part =
        `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${x}" y="${Math.round((natH - row.logo.h) / 2)}" width="${row.logo.w}" height="${row.logo.h}"/>` +
        `<text x="${x + row.logo.w + inlineGap + row.textW / 2}" y="${Math.round(natH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      x += row.contentW + rowGap
      return part
    })
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">${cells.join("")}</svg>`
  } else {
    const px = Math.round(fs * 0.7)
    const py = Math.max(3, Math.round(fs * 0.35))
    const pillGap = Math.max(6, Math.round(fs * 0.45))
    const pillH = Math.max(...rows.map((r) => r.contentH)) + py * 2
    const r = Math.round(pillH / 2)
    natH = pillH
    natW = rows.reduce((acc, row) => acc + row.contentW + px * 2, 0) + pillGap * (rows.length - 1)
    let x = 0
    const pills = rows.map((row) => {
      const pillW = row.contentW + px * 2
      const logoY = Math.round((pillH - row.logo.h) / 2)
      const textY = Math.round(pillH / 2)
      const part =
        `<rect x="${x}" width="${pillW}" height="${pillH}" rx="${r}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5" filter="url(#seps)"/>` +
        `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${x + px}" y="${logoY}" width="${row.logo.w}" height="${row.logo.h}"/>` +
        `<text x="${x + px + row.logo.w + inlineGap + row.textW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      x += pillW + pillGap
      return part
    })
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">` +
      `<defs><linearGradient id="sepg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(bottomLight)}</linearGradient>${SEPARATE_SHADOW_FILTER}</defs>` +
      pills.join("") +
      `</svg>`
  }
  // Ultima rete di sicurezza: se (per arrotondamenti/aspect estremi) la riga
  // eccede ancora `width`, shrink proporzionale del bitmap — mai clipping,
  // aspect preservato, una sola ricampionatura.
  const fitScale = natW > maxW ? maxW / natW : 1
  const outW = Math.max(1, Math.round(natW * fitScale))
  const outH = Math.max(1, Math.round(natH * fitScale))
  const png = await renderSVG(svg, natW)
  if (fitScale === 1) return { png, w: natW, h: natH }
  const shrunk = await sharp(png).resize(outW, outH).toBuffer()
  return { png: shrunk, w: outW, h: outH }
}
