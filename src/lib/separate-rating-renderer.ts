import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { escSvg, estimateTextWidth, fontFamilyFor, normalizeBadgeFont, satinPillStops, badgeDropShadow } from "./badge-svg-shared"
import { renderSVG } from "./svg-badge"
import { formatSeparateValue, MAX_SEPARATE_RATINGS } from "./ratings"
import type { BadgeFont, SeparateBottomVariant } from "./badge-styles"
import {
  applyBadgeItemTransform,
  badgeItemTransform,
  isNeutralBadgeItemTransform,
  RATING_SLOT_MAX,
  ratingItemId,
  ratingSlotItemId,
  type BadgeItemTransform,
  type BadgeItemTransformMap,
} from "./badge-item-transforms"

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
  tvmaze: "tvmaze.svg",
}

const RATINGS_DIR = path.join(process.cwd(), "public", "rating")

/**
 * Memo limitata (FIFO) dei raster deterministi dei marchi provider.
 *
 * `loadSeparateRatingLogo`/`loadRoundRatingLogo` sono pure rispetto a
 * (sorgente, altezza/diametro, polarità): gli asset sono file bundlati e la
 * ricetta è fissa, quindi lo stesso raster veniva ripagato per OGNI pill di una
 * colonna, per ogni riga bottom e a ogni iterazione del loop di shrink delle
 * icone Fresh. Il buffer è condiviso e i consumer lo leggono soltanto (embed
 * base64 / resize sharp): stessi byte, nessuna seconda rasterizzazione.
 *
 * Le chiavi sono limitate dalla lista asset fissa × le altezze prodotte dal
 * layout, più un tetto esplicito (eviction FIFO delete-first, stessa policy di
 * `textLogoBufferCache`/`autoFitCache`): la Map resta limitata per tutta la
 * vita del processo.
 */
const SEPARATE_LOGO_CACHE_MAX_ENTRIES = 200
const separateLogoCache = new Map<string, { png: Buffer; w: number; h: number }>()

/** Inserisce un raster riuscito rispettando il tetto FIFO; i miss non sono cachati. */
function cacheSeparateLogo(
  key: string,
  value: { png: Buffer; w: number; h: number } | null,
): { png: Buffer; w: number; h: number } | null {
  if (!value) return null
  if (separateLogoCache.size >= SEPARATE_LOGO_CACHE_MAX_ENTRIES) {
    const first = separateLogoCache.keys().next().value
    if (first) separateLogoCache.delete(first)
  }
  separateLogoCache.set(key, value)
  return value
}

/**
 * Ombra dedicata ai pill separati: più stretta della 3D standard dei badge
 * (dx=3, dy=3, blur 3.5) — su pill da ~40px con gap verticale di 5px
 * l'ombra standard sborda sul pill successivo e agli angoli sembra un
 * blocco squadrato. Con dy=2 + blur 2 l'estensione (~4px) resta nel gap.
 */
const SEPARATE_SHADOW_FILTER = badgeDropShadow("seps")

/**
 * Riserva perimetrale ORIZZONTALE per l'ombra `seps` della colonna rating
 * separati: il canvas non coincide più con l'inchiostro, le celle sono traslate
 * di `SEPARATE_SHADOW_PAD` e la bitmap cresce dello stesso valore per lato, così
 * il filtro (`x=-30% width=160%`) non viene tagliato dal bordo. Stessa idea di
 * `TOP_SHADOW_PAD` dei badge / della riga multi-rating (canvas = contenuto +
 * 2 × pad, corpo in un `<g translate>`): i box di item e slotGhosts sono
 * riportati in questo spazio (bitmap-relative), quindi il mapping dei consumer
 * (`sepLeft + item.left`, `sepTop + item.top`) resta corretto senza modifiche e
 * un'ancora simmetrica (centro colonna) non sposta un pixel.
 *
 * Solo orizzontale: verticalmente il canvas resta `totalH` perché i consumer
 * ancorano l'INTERA bitmap (colonna sotto il badge qualità) e i contratti pixel
 * esistenti misurano l'altezza della bitmap come span dell'inchiostro
 * (`separate-ratings-cap5` refSpan === stack.h, `separate-badge-scale` pillH
 * derivato da stack.h): un pad verticale richiede ancore caller + contratti
 * aggiornati, fuori da questo file. La stessa riserva per `bottom-pills` è
 * bloccata dai suoi contratti pixel (ancoraggio destro landscape ±8, margine
 * basso portrait ≤27, barra full-bleed w === width): follow-up.
 */
export const SEPARATE_SHADOW_PAD = 8

/** Gap verticale tra le pill dello stack. */
export const SEPARATE_STACK_GAP = 5

/**
 * Logo provider a colori brand originali (mai ricolorati, a differenza dei
 * loghi network). Ritorna null se l'asset manca o non rasterizza: la pill
 * viene skippata invece di rompere il render.
 */
export async function loadSeparateRatingLogo(source: string, targetH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
  const key = `column\u0000${source.toLowerCase()}\u0000${targetH}`
  const cached = separateLogoCache.get(key)
  if (cached) return cached
  return cacheSeparateLogo(key, await buildSeparateRatingLogo(source, targetH))
}

/** Ricetta reale del raster (nessuna cache): pura rispetto agli input. */
async function buildSeparateRatingLogo(source: string, targetH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
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
  // Chiave = tutti gli input che cambiano i byte del raster (sorgente,
  // diametro clampsato, mono/color, polarità della piastra).
  const key = `round\u0000${id}\u0000${Math.max(2, diameter)}\u0000${monochrome ? 1 : 0}\u0000${bottomLight ? 1 : 0}`
  const cached = separateLogoCache.get(key)
  if (cached) return cached
  return cacheSeparateLogo(key, await buildRoundRatingLogo(id, diameter, monochrome, bottomLight))
}

/** Ricetta reale del raster round (nessuna cache): pura rispetto agli input. */
async function buildRoundRatingLogo(
  id: string,
  diameter: number,
  monochrome: boolean,
  bottomLight: boolean,
): Promise<{ png: Buffer; w: number; h: number } | null> {
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
  /**
   * Authoritative slot of every painted pill (px, in THIS bitmap's space), by
   * stable provider identity. `png` is present only when the pill is DETACHED
   * (it owns a per-item correction): the caller composites it independently at
   * the transformed position while the other pills keep their automatic slot.
   */
  readonly items?: readonly SeparateRatingItem[]
  /**
   * Box-only placement of every EMPTY rating SLOT of this bitmap (position
   * `painted + 1` … `RATING_SLOT_MAX`), in THIS bitmap's space. No png, never a
   * pixel: they exist so the settings preview can draw a draggable dashed ghost
   * for a slot the preview title does not paint. Computed here (from the
   * painted boxes, never at request time) so a cached group is as complete as a
   * fresh one; the REPORT decides whether to publish them (`?ghosts=1`).
   */
  readonly slotGhosts?: readonly SeparateRatingSlotGhost[]
}

/** One EMPTY separate-rating slot: stable slot identity + box-only placement. */
export interface SeparateRatingSlotGhost {
  /** `rating:slot:<n>` (`badge-item-transforms`), a position, not a provider. */
  readonly id: string
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

/**
 * Boxes of the EMPTY slot positions, in the bitmap's own space.
 *
 * The first empty position starts one variant gap past the LAST painted box and
 * every further empty position continues down the same advance, reusing the
 * last painted pill's width/height (nothing is invented: an empty stack paints
 * nothing and reports no ghost). Positions are 1-based, exactly like the slot
 * identities, and stop at the family cap — the same cap the renderer already
 * applies to the painted pills.
 */
function slotGhostBoxes(
  boxes: readonly { readonly top: number; readonly left: number; readonly w: number; readonly h: number }[],
  gap: number,
): SeparateRatingSlotGhost[] {
  const painted = boxes.length
  if (painted === 0 || painted >= RATING_SLOT_MAX) return []
  const last = boxes[painted - 1]
  const advance = Math.max(1, last.h) + Math.max(0, Math.round(gap))
  const out: SeparateRatingSlotGhost[] = []
  for (let n = painted + 1; n <= RATING_SLOT_MAX; n++) {
    const id = ratingSlotItemId(n)
    if (!id) break
    out.push({ id, top: last.top + advance * (n - painted), left: last.left, w: last.w, h: last.h })
  }
  return out
}

/**
 * Stored NON-NEUTRAL correction of one identity (`null` = automatic). Shared by
 * the painted pills and their slots: a neutral entry is indistinguishable from
 * no entry, so an untouched configuration takes the historic path byte for
 * byte.
 */
function storedTransform(
  itemTransforms: BadgeItemTransformMap | null | undefined,
  id: string | null,
): BadgeItemTransform | null {
  if (!id) return null
  const t = badgeItemTransform(itemTransforms ?? null, id)
  return t && !isNeutralBadgeItemTransform(t) ? t : null
}

/**
 * Per-ROW corrections, in paint order: SLOT first (order-based: the n-th
 * painted pill owns `rating:slot:<n>`), then the provider IDENTITY, which the
 * CALLER applies on top of the reported box (`poster-service`). Two separate
 * lists because they are two different features: the slot is the positional
 * tuning of this family, the identity is the per-title nudge.
 */
function rowTransforms(
  rows: readonly { readonly id: string | null }[],
  itemTransforms: BadgeItemTransformMap | null | undefined,
): {
  readonly slots: readonly (BadgeItemTransform | null)[]
  readonly detached: readonly boolean[]
} {
  const slots = rows.map((_, index) => storedTransform(itemTransforms, ratingSlotItemId(index + 1)))
  return {
    slots,
    detached: rows.map((row, index) => !!slots[index] || !!storedTransform(itemTransforms, row.id)),
  }
}

/** One painted rating pill: stable identity + final slot (+ png when detached). */
export interface SeparateRatingItem {
  readonly id: string
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  readonly png?: Buffer
  /**
   * 1-based PAINTED POSITION of this pill: the slot this renderer applied
   * (`rating:slot:<slot>`) and the one a defaults-preview drag writes. Reported
   * explicitly so the caller never has to re-derive it from the list order.
   */
  readonly slot?: number
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
  /** Per-item corrections by stable provider identity (empty = automatic). */
  itemTransforms?: BadgeItemTransformMap | null,
  /** `rings` = voto dentro un anello di progresso + logo sotto (stile `rings`). */
  variant: "pill" | "rings" = "pill",
): Promise<SeparateRatingStack | null> {
  const isRings = variant === "rings"
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
  const logoH = Math.round(fs * (isRings ? 1.05 : 0.95))
  // Anello: raggio, spessore e diametro esterno della placca tonda.
  const ringR = Math.round(fs * 1.25)
  const ringStroke = Math.max(3, Math.round(fs * 0.28))
  const ringD = 2 * (ringR + ringStroke + 1)
  const ringGap = Math.max(2, Math.round(fs * 0.3))
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"

  const rows: { id: string | null; logo: { png: Buffer; w: number; h: number }; display: string; textW: number; pillH: number; value: number }[] = []
  for (const item of capped) {
    const logo = await loadSeparateRatingLogo(item.id, logoH)
    if (!logo) continue
    const rawDisplay = formatSeparateValue(item.id, item.value)
    const textW = Math.max(estimateTextWidth(rawDisplay, fs, f), 1)
    rows.push({ id: ratingItemId(item.id), logo, display: rawDisplay, textW, pillH: isRings ? ringD + ringGap + logo.h : pt + logo.h + gap + fs + pt, value: item.value })
  }
  if (rows.length === 0) return null

  // Larghezza UNIFORME: max dei contenuti + padding — la colonna è dritta.
  const colW = isRings
    ? Math.max(ringD, ...rows.map((r) => r.logo.w)) + 2
    : Math.max(...rows.map((r) => Math.max(r.logo.w, r.textW))) + px * 2
  const r = Math.round(Math.max(...rows.map((row) => row.pillH)) * 0.32)
  const totalH = rows.reduce((acc, row) => acc + row.pillH, 0) + SEPARATE_STACK_GAP * (rows.length - 1)
  // Canvas = inchiostro + riserva ombra ORIZZONTALE (vedi SEPARATE_SHADOW_PAD):
  // il corpo resta nelle coordinate del contenuto (0..colW × 0..totalH) e viene
  // traslato nel `<g translate>` del render, così pillSvg/markup non cambiano.
  const canvasW = colW + SEPARATE_SHADOW_PAD * 2

  const defs = `<defs><linearGradient id="sepg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${SEPARATE_SHADOW_FILTER}</defs>`
  const ringSvg = (row: (typeof rows)[number], y: number): string => {
    const cx = colW / 2
    const cy = y + ringD / 2
    const circ = 2 * Math.PI * ringR
    const frac = Math.min(1, Math.max(0, row.value / 10))
    // Colore per punteggio (leggibile a colpo d'occhio, indipendente dal provider).
    const arc = row.value >= 7.5 ? "#22C55E" : row.value >= 6 ? "#EAB308" : "#EF4444"
    const plate = topLight ? "rgba(255,255,255,0.82)" : "rgba(8,10,16,0.72)"
    const track = topLight ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.18)"
    const vfs = Math.round(fs * (row.display.length > 3 ? 0.8 : 0.95))
    const vw = Math.max(estimateTextWidth(row.display, vfs, f), 1)
    return (
      `<circle cx="${cx}" cy="${cy}" r="${ringR + ringStroke}" fill="${plate}" filter="url(#seps)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${track}" stroke-width="${ringStroke}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${arc}" stroke-width="${ringStroke}" stroke-linecap="round" stroke-dasharray="${(circ * frac).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="800" font-size="${vfs}" fill="${topLight ? "rgba(0,0,0,0.88)" : "rgba(255,255,255,0.95)"}" textLength="${vw}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>` +
      `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${Math.round((colW - row.logo.w) / 2)}" y="${y + ringD + ringGap}" width="${row.logo.w}" height="${row.logo.h}" filter="url(#seps)"/>`
    )
  }
  const pillSvg = (row: (typeof rows)[number], y: number): string => {
    if (isRings) return ringSvg(row, y)
    const logoX = Math.round((colW - row.logo.w) / 2)
    const textY = y + pt + row.logo.h + gap + Math.round(fs / 2)
    return (
      `<rect y="${y}" width="${colW}" height="${row.pillH}" rx="${r}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5" filter="url(#seps)"/>` +
      `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${logoX}" y="${y + pt}" width="${row.logo.w}" height="${row.logo.h}"/>` +
      `<text x="${colW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
    )
  }
  // SLOT (order-based, 1-based painted position) → IDENTITY (applied by the
  // caller on the reported box). Both are `applyBadgeItemTransform` calls, so a
  // slot resizes exactly like an identity correction; with neither stored the
  // automatic box is reported untouched (historic bytes).
  const corrections = rowTransforms(rows, itemTransforms)

  let y = 0
  const parts: string[] = []
  const stackItems: SeparateRatingItem[] = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    // Box della CELLA nello spazio della bitmap restituita: larghezza del
    // canvas (l'inchiostro è centrato, il pad è trasparente ai lati) e altezza
    // dell'inchiostro. Il centro coincide col centro dell'inchiostro, quindi
    // una correzione di slot scala come prima.
    const slotBox = applyBadgeItemTransform(
      { top: y, left: 0, w: canvasW, h: row.pillH },
      corrections.slots[index],
    )
    const isDetached = !!corrections.detached[index]
    if (!isDetached) parts.push(pillSvg(row, y))
    if (row.id) {
      // Bitmap della pill staccata: stesso canvas della cella (pad orizzontale
      // incluso), contenuto traslato, così l'ombra laterale non viene tagliata
      // e il png coincide col box riportato al caller.
      const pillPng = isDetached
        ? await renderSVG(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${row.pillH}">${defs}<g transform="translate(${SEPARATE_SHADOW_PAD},0)">${pillSvg(row, 0)}</g></svg>`,
            canvasW,
          )
        : null
      // The detached bitmap is returned at the box it will be composited in
      // (the SLOT box): the caller only adds the identity scale on top.
      const png = pillPng
        ? (slotBox.w === canvasW && slotBox.h === row.pillH
            ? pillPng
            : await sharp(pillPng).resize(slotBox.w, slotBox.h).toBuffer())
        : undefined
      stackItems.push({
        id: row.id,
        slot: index + 1,
        top: slotBox.top,
        left: slotBox.left,
        w: slotBox.w,
        h: slotBox.h,
        ...(png ? { png } : {}),
      })
    }
    y += row.pillH + SEPARATE_STACK_GAP
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${totalH}">` +
    defs +
    `<g transform="translate(${SEPARATE_SHADOW_PAD},0)">` +
    parts.join("") +
    `</g>` +
    `</svg>`
  const png = await renderSVG(svg, canvasW)
  return {
    png,
    w: canvasW,
    h: totalH,
    items: stackItems,
    slotGhosts: slotGhostBoxes(stackItems, SEPARATE_STACK_GAP),
  }
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
  /** Per-item corrections by stable provider identity (empty = automatic). */
  itemTransforms?: BadgeItemTransformMap | null,
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
  interface BottomRow { id: string | null; logo: { png: Buffer; w: number; h: number }; display: string; textW: number; contentW: number; contentH: number }
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
      out.push({ id: ratingItemId(item.id), logo, display, textW, contentW: logo.w + gap + textW, contentH: Math.max(logo.h, size) })
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
  // Per-item corrections, in paint order: SLOT (order-based: the n-th painted
  // cell owns `rating:slot:<n>`) then the provider IDENTITY, which the caller
  // applies on top of the reported box. A corrected cell is detached from the
  // row bitmap (its automatic slot stays empty, nothing else moves) and
  // returned as its own bitmap, so only that provider moves/resizes.
  const corrections = rowTransforms(rows, itemTransforms)
  // Vertical advance used by the EMPTY slot ghosts of this variant (each
  // variant's own gap, same value its cells already use).
  let slotGap = Math.max(6, Math.round(fs * 0.45))
  // `markup(x)` paints the cell at horizontal offset `x`: the group calls it
  // with the automatic slot, the DETACHED bitmap calls it with 0 so the cell
  // is fully inside its own small canvas.
  interface CellInfo {
    id: string
    left: number
    top: number
    w: number
    h: number
    markup: (x: number) => string
    boxW: number
    boxH: number
    /** 1-based PAINTED POSITION (the applied `rating:slot:<n>`). */
    slot: number
    /** True when the SLOT and/or the identity correction detaches the cell. */
    detached: boolean
  }
  const cellsInfo: CellInfo[] = []
  const defs = `<defs><linearGradient id="sepg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(bottomLight)}</linearGradient>${SEPARATE_SHADOW_FILTER}</defs>`

  let svg: string
  let natW: number
  let natH: number
  let background = ""
  if (isBar) {
    const py = Math.max(4, Math.round(fs * 0.6))
    const contentH = Math.max(...rows.map((r) => r.contentH))
    natW = bandW
    natH = contentH + py * 2
    const cellW = bandW / rows.length
    background = `<rect width="${natW}" height="${natH}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5"/>`
    /** Origine del logo: contenuto della cella centrata. */
    const logoX = (i: number, row: BottomRow) =>
      Math.round(i * cellW + (cellW - row.contentW) / 2)
    /** X del valore: centro del valore. */
    const valueX = (i: number, row: BottomRow, startX: number) =>
      startX + row.logo.w + inlineGap + row.textW / 2
    const valueAnchor = "middle"
    /** Box riportato: il contenuto della cella. */
    const cellBox = (startX: number, row: BottomRow) =>
      ({ top: 0, left: startX, w: row.contentW, h: natH })
    rows.forEach((row, i) => {
      const startX = logoX(i, row)
      const logoY = Math.round((natH - row.logo.h) / 2)
      const textY = Math.round(natH / 2)
      // `x` = origine del box riportato: il bitmap staccato usa x=0 e
      // riproduce lo stesso layout.
      const markup = (x: number) => {
        const dx = x - startX
        return `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${startX + dx}" y="${logoY}" width="${row.logo.w}" height="${row.logo.h}"/>` +
          `<text x="${valueX(i, row, startX) + dx}" y="${textY}" text-anchor="${valueAnchor}" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      }
      if (row.id) {
        const boxSpec = cellBox(startX, row)
        const box = applyBadgeItemTransform(boxSpec, corrections.slots[i])
        cellsInfo.push({ id: row.id, left: box.left, top: box.top, w: box.w, h: box.h, markup, boxW: boxSpec.w, boxH: natH, slot: i + 1, detached: corrections.detached[i] })
      }
    })
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">` +
      defs +
      background +
      rows.map((row, i) => {
        if (corrections.detached[i]) return ""
        const startX = logoX(i, row)
        const logoY = Math.round((natH - row.logo.h) / 2)
        const textY = Math.round(natH / 2)
        return `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${startX}" y="${logoY}" width="${row.logo.w}" height="${row.logo.h}"/>` +
          `<text x="${valueX(i, row, startX)}" y="${textY}" text-anchor="${valueAnchor}" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      }).join("") +
      `</svg>`
  } else if (isBare) {
    // No band, pill, border or background behind the values. Only round
    // provider marks + scores, using the existing fit/scale/font pipeline.
    const rowGap = Math.max(6, Math.round(fs * 0.75))
    slotGap = rowGap
    const py = Math.max(2, Math.round(fs * 0.2))
    natH = Math.max(...rows.map((row) => row.contentH)) + py * 2
    natW = rowW(rows, fs)
    let x = 0
    const parts: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const markup = (cx: number) =>
        `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${cx}" y="${Math.round((natH - row.logo.h) / 2)}" width="${row.logo.w}" height="${row.logo.h}"/>` +
        `<text x="${cx + row.logo.w + inlineGap + row.textW / 2}" y="${Math.round(natH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      if (row.id) {
        const box = applyBadgeItemTransform({ top: 0, left: x, w: row.contentW, h: natH }, corrections.slots[i])
        cellsInfo.push({ id: row.id, left: box.left, top: box.top, w: box.w, h: box.h, markup, boxW: row.contentW, boxH: natH, slot: i + 1, detached: corrections.detached[i] })
      }
      if (!corrections.detached[i]) parts.push(markup(x))
      x += row.contentW + rowGap
    }
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">${parts.join("")}</svg>`
  } else {
    const px = Math.round(fs * 0.7)
    const py = Math.max(3, Math.round(fs * 0.35))
    const pillGap = Math.max(6, Math.round(fs * 0.45))
    slotGap = pillGap
    const pillH = Math.max(...rows.map((r) => r.contentH)) + py * 2
    const r = Math.round(pillH / 2)
    natH = pillH
    natW = rows.reduce((acc, row) => acc + row.contentW + px * 2, 0) + pillGap * (rows.length - 1)
    let x = 0
    const pills: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const pillW = row.contentW + px * 2
      const logoY = Math.round((pillH - row.logo.h) / 2)
      const textY = Math.round(pillH / 2)
      const markup = (cx: number) =>
        `<rect x="${cx}" width="${pillW}" height="${pillH}" rx="${r}" fill="url(#sepg)" stroke="${stroke}" stroke-width="1.5" filter="url(#seps)"/>` +
        `<image href="data:image/png;base64,${row.logo.png.toString("base64")}" x="${cx + px}" y="${logoY}" width="${row.logo.w}" height="${row.logo.h}"/>` +
        `<text x="${cx + px + row.logo.w + inlineGap + row.textW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(row.display, f)}" font-weight="700" font-size="${fs}" fill="${fg}" textLength="${row.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(row.display)}</text>`
      if (row.id) {
        const box = applyBadgeItemTransform({ top: 0, left: x, w: pillW, h: pillH }, corrections.slots[i])
        cellsInfo.push({ id: row.id, left: box.left, top: box.top, w: box.w, h: box.h, markup, boxW: pillW, boxH: pillH, slot: i + 1, detached: corrections.detached[i] })
      }
      if (!corrections.detached[i]) pills.push(markup(x))
      x += pillW + pillGap
    }
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${natW}" height="${natH}">` +
      defs +
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
  // Item slots are reported in the RETURNED bitmap's space (the proportional
  // fit is applied here once), so the caller only has to map the final
  // placement/scale it already knows.
  const cellItems: SeparateRatingItem[] = []
  for (const cell of cellsInfo) {
    let itemPng: Buffer | undefined
    if (cell.detached) {
      const raw = await renderSVG(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.boxW}" height="${cell.boxH}">${defs}${cell.markup(0)}</svg>`,
        cell.boxW,
      )
      // The detached bitmap is returned at the box it will be composited in
      // (the SLOT box): the caller only adds the identity scale on top.
      itemPng = cell.boxW === cell.w && cell.boxH === cell.h ? raw : await sharp(raw).resize(cell.w, cell.h).toBuffer()
    }
    cellItems.push({
      id: cell.id,
      slot: cell.slot,
      left: Math.round(cell.left * fitScale),
      top: Math.round(cell.top * fitScale),
      w: Math.max(1, Math.round(cell.w * fitScale)),
      h: Math.max(1, Math.round(cell.h * fitScale)),
      ...(itemPng ? { png: itemPng } : {}),
    })
  }
  // EMPTY positions (painted + 1 … cap) as box-only ghosts, in the SAME
  // returned space as the items (the proportional fit is applied once).
  const slotGhosts = slotGhostBoxes(
    cellsInfo.map((cell) => ({ top: cell.top, left: cell.left, w: cell.w, h: cell.h })),
    slotGap,
  ).map((ghost) => ({
    ...ghost,
    top: Math.round(ghost.top * fitScale),
    left: Math.round(ghost.left * fitScale),
    w: Math.max(1, Math.round(ghost.w * fitScale)),
    h: Math.max(1, Math.round(ghost.h * fitScale)),
  }))
  if (fitScale === 1) return { png, w: natW, h: natH, items: cellItems, slotGhosts }
  const shrunk = await sharp(png).resize(outW, outH).toBuffer()
  return { png: shrunk, w: outW, h: outH, items: cellItems, slotGhosts }
}
