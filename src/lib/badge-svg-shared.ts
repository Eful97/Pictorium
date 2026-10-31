import type { BadgeStyle, RankingBadgeStyle, BadgeFont } from "./badge-styles"
import { isBadgeFont } from "./badge-styles"
import { isWarmGoldAccent, textColorForBg } from "./accent-color"
import { AV_PLATE_RADIUS_FACTOR, AV_PLATE_STROKE_WIDTH, COLOR_MARK_GLYPH, COLOR_MARK_PLATE_BG, COLOR_MARK_PLATE_STROKE, GRADIENT_PLATE_BG, GRADIENT_PLATE_STROKE, PREMIUM_PLATE_BG, PREMIUM_PLATE_STROKE, premiumAccentHex } from "./quality-badge-styles"

const TEXT_SAFE_PAD = 1.15
const GENRE_TEXT_MAX_RATIO = 0.84
const GENRE_PILL_MAX_RATIO = 0.78
const GENRE_FONT_WEIGHT = 600
const RANKING_FONT_WEIGHT = 700

export const BADGE_BOX_PAD_Y_FACTOR = 0.40
export const BADGE_BOX_PAD_X_FACTOR = 0.75

/** Cornice compatta della pill genere (pill + colored): solo padding, mai il
 *  font — il testo resta a base piena, si stringe solo la scatola. */
export const GENRE_PILL_PAD_X_FACTOR = 0.55
export const GENRE_PILL_PAD_Y_FACTOR = 0.30

export function badgeBoxHeight(fs: number): number {
  return fs + Math.round(fs * BADGE_BOX_PAD_Y_FACTOR) * 2
}

export function badgeShadowBox(h: number): { blur: number; off: number } {
  return {
    blur: Math.max(Math.round(h * 0.20), 4),
    off: Math.max(Math.round(h * 0.10), 2),
  }
}

export const STAR_GRADIENT_DEF = `<linearGradient id="starg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FCD34D"/><stop offset="100%" stop-color="#F59E0B"/></linearGradient>`

/**
 * Fill della stella del badge genere/rating sui contenitori CHIARI.
 *
 * La stella vive sul contenitore del badge, non sulla banda del poster: per
 * `bordo`/`vetro` il corpo e chiaro quando la banda e chiara (`bottomLight`,
 * velo milky), per la `bar` e l'opposto (`satinPillStops` inverte la polarita:
 * banda scura → barra bianca satinata, banda chiara → barra grafite). Sul
 * contenitore chiaro il gradiente oro storico (#FCD34D → #F59E0B) misura
 * ~1.4:1 sul bianco e annega mentre il testo resta near-black: la stella
 * prende allora lo STESSO inchiostro del testo (parita per costruzione,
 * nessuna misura contro artwork traslucido arbitrario sotto al velo) — la
 * stessa scelta gia fatta dall'accent caldo della pill `colored`. Sul
 * contenitore scuro l'oro storico resta leggibile: `undefined` = `url(#starg)`,
 * byte-identico al passato. Nessuna geometria toccata (solo il fill).
 */
export function starInkFor(
  bandLight: boolean | undefined,
  style: string | undefined,
  textInk: string,
): string | undefined {
  const lightContainer = style === "bar" ? !bandLight : !!bandLight
  return lightContainer ? textInk : undefined
}

/**
 * Stella dello stile `ink`: off-white MINIMALE (mai bianco puro, mai il
 * gradiente oro) sulla banda scura. L'`ink` e tipografia nuda sopra l'artwork:
 * il gradiente oro storico non appartiene alla modalita (nessun accent, nessun
 * materiale) e il bianco puro risulterebbe troppo duro accanto ai glifi.
 */
export const GENRE_INK_STAR_INK = "rgba(243,244,246,0.92)"

/**
 * Fill della stella nello stile `ink`.
 *
 * Su banda scura la stella e l'off-white minimale `GENRE_INK_STAR_INK`; su
 * banda chiara prende l'inchiostro del testo al 85% (stessa parita per
 * costruzione di `starInkFor`, l'alone scuro dell'ink resta la garanzia di
 * contrasto sul fondo chiaro), cosi resta leggibile su entrambe le polarita.
 * Il gradiente oro non compare MAI in modalita ink.
 */
export function inkStarInkFor(bandLight: boolean | undefined, textInk: string): string {
  return bandLight ? applyFillOpacity(textInk, 85) : GENRE_INK_STAR_INK
}

export function genreBadgeSafePad(fs: number): number {
  return Math.round(fs * TEXT_SAFE_PAD)
}

export function genrePillMaxW(containerW: number): number {
  return Math.min(containerW - 20, Math.round(containerW * GENRE_PILL_MAX_RATIO))
}

export function genreTextMaxW(containerW: number): number {
  return Math.min(containerW - 20, Math.round(containerW * GENRE_TEXT_MAX_RATIO))
}

export function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * Applica un'opacità 0-100 a un fill già risolto (hex o rgba/rgb): gli
 * override house lavorano sul colore finale della ricetta, mai su un
 * secondo canale. Formati ignoti → invariato (fail-safe, mai 500).
 */
export function applyFillOpacity(color: string, opacityPct: number): string {
  const a = Math.min(Math.max(Math.round(opacityPct) / 100, 0), 1)
  const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (hex) return presetHexToRgba(hex[0], Math.round(a * 100))
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgba) {
    const base = Number(rgba[4] ?? 1)
    const out = Math.round(Math.min(Math.max(base * a, 0), 1) * 1000) / 1000
    return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${out})`
  }
  return color
}

/**
 * Recolors BODY <text> fills (technical-family typography overrides): splits
 * off <defs> blocks first so masks/paint servers (knockout cut-outs, star
 * gradients) stay byte-identical, then sets fill on body text tags only.
 * Null color keeps the recipe fill (opacity-only still applies via
 * applyFillOpacity on the existing fill); both null = no-op. Pure string op.
 */
export function recolorBadgeBodyText(svg: string, color: string | null | undefined, opacityPct?: number | null): string {
  if (!color && (opacityPct === undefined || opacityPct === null)) return svg
  const parts = svg.split(/(<defs>[\s\S]*?<\/defs>)/g)
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("<defs>")) continue
    parts[i] = parts[i].replace(/<text\b[^>]*>/g, (tag) => {
      const m = tag.match(/ fill="([^"]*)"/)
      const base = color ?? m?.[1] ?? null
      if (!base) return tag
      const ink = opacityPct === undefined || opacityPct === null ? base : applyFillOpacity(base, opacityPct)
      const safe = ink.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
      if (m) return tag.replace(/ fill="[^"]*"/, ` fill="${safe}"`)
      return tag.replace(/\s*\/?>(?=$)/, (end) => ` fill="${safe}"${end}`)
    })
  }
  return parts.join("")
}

/** Ebraico (blocco base + presentation forms). */
const HEBREW_RE = /[\u0590-\u05FF\uFB1D-\uFB4F]/

/** Arabo (base U+0600-06FF + supplemento U+0750-077F + presentation forms):
 *  stringhe verificate su TMDB ar-SA (generi, status) — Rubik copre tutti
 *  questi glifi in tutti i pesi (Regular/Bold/Black, vedi lib/fonts). */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

/** Segni arabi a larghezza zero: tashkeel + marchi direzionali (RLM/LRM/ALM).
 *  Non avanzano il cursore — contarli allargherebbe la pill via `textLength`. */
const ARABIC_ZEROWIDTH_RE = /[\u064B-\u0652\u0670\u200E\u200F\u061C]/

/** True se il testo contiene ebraico o arabo (serve il font Rubik). */
function needsRubik(text: string): boolean {
  return HEBREW_RE.test(text) || ARABIC_RE.test(text)
}

/**
 * Famiglia da dichiarare per un testo di badge. Inter non ha glifi ebraici
 * ne' arabi:
 * resvg li recupera per-glifo da Rubik (presente nel fontdb, vedi lib/fonts),
 * ma quel fallback ignora il `font-weight` richiesto e ripiega sempre sul
 * regular — un badge in grassetto verrebbe reso sottile. Dichiarando "Rubik"
 * quando il testo contiene ebraico o arabo il peso torna corretto.
 *
 * Barlow Condensed e Oswald non coprono ebraico/arabo: anche con `font`
 * diverso il ramo Rubik resta prioritario (stesso peso dichiarato).
 * Per i testi latini con font "inter" l'SVG emesso resta byte-identico a
 * prima, quindi gli snapshot visivi non si muovono.
 */
export function fontFamilyFor(text: string, font: BadgeFont | string | null | undefined = "inter"): string {
  if (needsRubik(text)) return "Rubik"
  if (font === "barlow-condensed") return "Barlow Condensed"
  if (font === "oswald") return "Oswald"
  return "Inter"
}

/** Normalizza un valore libero al font badge (assente/invalido → "inter"). */
export function normalizeBadgeFont(font: string | null | undefined): BadgeFont {
  return isBadgeFont(font) ? font : "inter"
}

function charWidthFactor(char: string): number {
  if (ARABIC_ZEROWIDTH_RE.test(char)) return 0
  if (char === " ") return 0.33
  // Rubik: le lettere ebraiche hanno avanzamento ~0.55em, uniforme (niente
  // maiuscole/minuscole). Col default 0.62 la stima sforava del ~12% e
  // `lengthAdjust="spacingAndGlyphs"` allargava visibilmente i glifi.
  if (HEBREW_RE.test(char)) return 0.55
  // Arabo in Rubik: avanzamento ~0.55-0.60em (simile all'ebraico, lettere
  // mediamente un filo piu larghe per i tratti discendenti/ascendenti).
  if (ARABIC_RE.test(char)) return 0.58
  if ("iIl.,:;!'|`".includes(char)) return 0.28
  if ("-–_".includes(char)) return 0.36
  if ("fjrt".includes(char.toLowerCase())) return 0.45
  if ("mw".includes(char.toLowerCase())) return 0.86
  if ("#%&@".includes(char)) return 0.75
  if (/\d/.test(char)) return 0.58
  if (/[A-Z]/.test(char)) return 0.68
  return 0.62
}

/** Misura messa in cache (testo+font → unità grezze e fattore condensed). */
const WIDTH_UNITS_CACHE = new Map<string, { units: number; condensed: number }>()
const WIDTH_UNITS_CACHE_MAX = 500

/**
 * Unità di larghezza per testo+font, memorizzate in una Map FIFO bounded
 * (cap ~500, l'eviction più vecchia). La somma per glifo è il costo dominante
 * quando lo shrink loop e i builder ricostruiscono lo stesso testo decine di
 * volte: la cache conserva gli stessi float, quindi il risultato arrotondato
 * resta identico al calcolo diretto (nessun cambio di resa o di cache key).
 */
function widthUnitsFor(text: string, font: BadgeFont | string | null | undefined): { units: number; condensed: number } {
  const key = `${font}\u0000${text}`
  const cached = WIDTH_UNITS_CACHE.get(key)
  if (cached) return cached
  let units = 0
  for (const char of text) units += charWidthFactor(char)
  // Larghezza ottica misurata con resvg su 10 stringhe badge × pesi
  // 600/700/900 (ink bbox, fs=100): Barlow Condensed ≈ 0.73× Inter,
  // Oswald ≈ 0.80×. Senza, `textLength` pinnerebbe sulla larghezza Inter e
  // `spacingAndGlyphs` stirerebbe i glifi condensed fino al +45%.
  // Nessuna scala per ebraico/arabo: quei glifi escono sempre in Rubik
  // (fontFamilyFor) con avanzamenti propri, non Inter.
  const condensed = needsRubik(text) ? 1 : font === "barlow-condensed" ? 0.73 : font === "oswald" ? 0.80 : 1
  if (WIDTH_UNITS_CACHE.size >= WIDTH_UNITS_CACHE_MAX) {
    const oldest = WIDTH_UNITS_CACHE.keys().next().value
    if (oldest !== undefined) WIDTH_UNITS_CACHE.delete(oldest)
  }
  const entry = { units, condensed }
  WIDTH_UNITS_CACHE.set(key, entry)
  return entry
}

export function estimateTextWidth(text: string, fs: number, font: BadgeFont | string | null | undefined = "inter"): number {
  const { units, condensed } = widthUnitsFor(text, font)
  const w = Math.max(units * fs, fs * 0.35)
  return Math.round(w * condensed)
}

export function textFitAttrs(width: number): string {
  return ` textLength="${Math.max(Math.round(width), 1)}" lengthAdjust="spacingAndGlyphs"`
}

type GenreBadgeText = {
  readonly genreName: string
  readonly voteStr: string
  readonly yearStr: string
}

/**
 * Quali componenti del badge genere/rating mostrare. Default tutti ON:
 * con tutte le parti attive l'output SVG \u00e8 byte-identico al precedente
 * "genere \u2022 \u2605 voto \u2022 anno" (i test di regressione visiva non cambiano).
 */
export interface GenreParts {
  readonly showGenre?: boolean
  readonly showYear?: boolean
  readonly showRating?: boolean
}

function normalizeParts(parts?: GenreParts): Required<GenreParts> {
  return {
    showGenre: parts?.showGenre ?? true,
    showYear: parts?.showYear ?? true,
    showRating: parts?.showRating ?? true,
  }
}

type GenreTextFlowArgs = GenreBadgeText & {
  readonly fs: number
  readonly centerX: number
  readonly y: number
  readonly parts?: GenreParts
  readonly style?: string
  /** Override del fill stella (default: gradiente oro). */
  readonly starFill?: string
  /** Font dei testi (default "inter" = resa storica). */
  readonly font?: BadgeFont
}

export function genreBadgeSvgDims(fs: number, genreName: string, voteStr: string, yearStr: string, parts?: GenreParts, style?: string, font: BadgeFont = "inter") {
  const isMinimal = style === "minimal"
  const opts = normalizeParts(parts)
  const gap = Math.round(fs / 3)
  const gapStar = Math.round(fs / 6)
  const bulletW = isMinimal ? Math.round(fs * 0.28) : Math.round(fs * 0.35)
  const starW = Math.round(fs * 0.92)
  const genreW = (opts.showGenre && genreName) ? estimateTextWidth(genreName, fs, font) : 0
  const voteW = (opts.showRating && voteStr) ? estimateTextWidth(voteStr, fs, font) : 0
  const yearW = (opts.showYear && yearStr) ? estimateTextWidth(yearStr, fs, font) : 0
  const buf = Math.round(fs * 0.25)
  // Segmenti condizionali separati da gap+bullet+gap. Con tutti ON questo
  // produce: genreW + (gap+bulletW+gap) + (starW+gapStar+voteW) + (gap+bulletW+gap) + yearW.
  const segGenre = genreW > 0 ? 1 : 0
  const segRating = voteW > 0 ? 1 : 0
  const segYear = yearW > 0 ? 1 : 0
  const segCount = segGenre + segRating + segYear
  const textContentW = segCount > 0
    ? (genreW + (segRating ? starW + gapStar + voteW : 0) + yearW) + (segCount - 1) * (gap + bulletW + gap)
    : 0
  const totalW = textContentW + buf
  const svgH = badgeBoxHeight(fs)
  return { starW, gap, gapStar, totalW, svgH, genreW, voteW, yearW, bulletW, textContentW }
}

function buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX, y, parts, style, starFill, font = "inter" }: GenreTextFlowArgs) {
  const isMinimal = style === "minimal"
  const opts = normalizeParts(parts)
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, opts, style, font)
  // Allineamento verticale della stella (tutti gli stili): il path 5 punte ha
  // il centro geometrico in (0,0) ma l'inchiostro e asimmetrico — punta in
  // alto a -R, base delle due punte inferiori a 0.809R — quindi il centro
  // dell'inchiostro cade 0.0955R SOPRA l'origine. Il testo usa
  // `dominant-baseline="central"`, cioe il centro dell'inchiostro sta sulla
  // `y` condivisa (misurato con resvg: <0.5px). Senza compensazione la stella
  // risultava ~4-5px piu bassa della riga (screenshot utente "Animazione •
  // 8.2"); questo spostamento porta il CENTRO INCHIOSTRO della stella sulla
  // stessa Y del testo (~1-2px sul canvas poster), senza toccare baseline,
  // larghezze o altezze di badge.
  const starR = dims.starW / 2
  const starDy = round2(starR * 0.0955)
  const hasGenre = opts.showGenre && !!genreName
  const hasRating = opts.showRating && !!voteStr
  const hasYear = opts.showYear && !!yearStr
  // Famiglia effettiva del flusso (stessa semplificazione storica: decide il
  // genere per l'intero testo). Ebraico/arabo → Rubik anche coi condensed
  // (Barlow/Oswald non hanno quei glifi), come per Inter.
  const flowFamily = fontFamilyFor(genreName, font)
  // Layout a segmenti espliciti, senza dx/dy e senza textLength multi-chunk:
  // Blink e resvg divergono su TUTTI E TRE — Blink include i dx nella misura
  // di text-anchor middle/end (spec) mentre resvg li esclude, e resvg ignora
  // textLength sui flussi multi-tspan (misurato: span invariato con
  // textLength 200 e 100 su resvg 2.6, onorato solo sul testo a tspan singola
  // e in Blink sempre). La vecchia compensazione -totalDx/2 era corretta per
  // resvg ma spostava la riga a sinistra di ~13-18px in Blink, tagliando la
  // prima lettera nei badge senza margine (bordo/vetro) e sforando il corpo
  // pill (vedi badge-genre-ink-clipping.test.ts). Ogni segmento ha il suo
  // <text> ad ancora centrale + textLength = larghezza stimata (tspan singola:
  // onorato da entrambi i renderer) e la stella e un path posizionato dalle
  // stesse stime — i due renderer convergono per costruzione e la riga non
  // puo piu uscire dal contenitore stimato.
  const bulletText = isMinimal ? "|" : "•"
  const texts: string[] = []
  const segText = (text: string, cx: number, w: number, opacity?: number): void => {
    const op = opacity !== undefined ? ` fill-opacity="${opacity}"` : ""
    texts.push(`<text x="${round2(cx)}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${flowFamily}" font-weight="${GENRE_FONT_WEIGHT}" font-size="${fs}"${textFitAttrs(w)}${op}>${escSvg(text)}</text>`)
  }
  let cursor = centerX - dims.textContentW / 2
  if (hasGenre) {
    segText(genreName, cursor + dims.genreW / 2, dims.genreW)
    cursor += dims.genreW
    if (hasRating || hasYear) {
      cursor += dims.gap
      segText(bulletText, cursor + dims.bulletW / 2, dims.bulletW, 0.45)
      cursor += dims.bulletW + dims.gap
    }
  }
  let starCx: number | null = null
  if (hasRating) {
    starCx = cursor + dims.starW / 2
    cursor += dims.starW + dims.gapStar
    segText(voteStr, cursor + dims.voteW / 2, dims.voteW)
    cursor += dims.voteW
    if (hasYear) {
      cursor += dims.gap
      segText(bulletText, cursor + dims.bulletW / 2, dims.bulletW, 0.45)
      cursor += dims.bulletW + dims.gap
    }
  }
  if (hasYear) {
    segText(yearStr, cursor + dims.yearW / 2, dims.yearW)
    cursor += dims.yearW
  }
  let t = texts.join("")
  if (starCx !== null) {
    t += `<g transform="translate(${round2(starCx)},${round2(y + starDy)})" fill="${starFill ?? "url(#starg)"}"><path d="${starPath(starR)}"/></g>`
  }
  return t
}

/** Stella 5 punte centrata in (0,0), raggio esterno R: stesso ingombro del glifo ★. */
function starPath(R: number): string {
  const inner = R * 0.382
  const pts: string[] = []
  for (let k = 0; k < 10; k++) {
    const ang = ((-90 + k * 36) * Math.PI) / 180
    const r = k % 2 === 0 ? R : inner
    pts.push(`${round2(r * Math.cos(ang))},${round2(r * Math.sin(ang))}`)
  }
  return `M${pts[0]}L${pts.slice(1).join("L")}Z`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildGenreBarSvg(genreName: string, voteStr: string, yearStr: string, pw: number, fs: number, textColor: string, bottomLight: boolean, textOffsetX = 0, parts?: GenreParts, starFill?: string, font: BadgeFont = "inter") {
  const barH = badgeBoxHeight(fs)
  const barR = Math.round(fs * 0.7)
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: pw / 2 + textOffsetX, y: barH / 2, parts, starFill, font })
  const pathD = `M 0,${barH} L 0,${barR} A ${barR},${barR} 0 0,1 ${barR},0 L ${pw - barR},0 A ${barR},${barR} 0 0,1 ${pw},${barR} L ${pw},${barH} Z`
  // Finitura quality-badge: gradiente satinato polarizzato sul fondo (stessa
  // polarità della pill genere), niente alone d'ombra, bordo adattivo 1.5px
  // sul profilo. La metà esterna dello stroke sui bordi full-bleed viene
  // tagliata dal viewport (0.75px, sub-visibile a scala poster).
  const stroke = bottomLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  // Ombra 3D sul path: la barra è full-bleed, canvas esatta — le code
  // laterali/bassa tagliate coincidono col bordo poster (invisibili).
  const defs = `<defs>${STAR_GRADIENT_DEF}<linearGradient id="gbg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(bottomLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
  const textEl = `<g fill="${textColor}">${textParts}</g>`
  const inner = `<path d="${pathD}" fill="url(#gbg)" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${barH}" viewBox="0 0 ${pw} ${barH}">${defs}${inner}${textEl}</svg>`, w: pw, h: barH }
}

export function buildGenrePillSvg(
  genreName: string,
  voteStr: string,
  yearStr: string,
  fs: number,
  bgColor: string,
  textColor: string,
  textOffsetX = 0,
  parts?: GenreParts,
  topLight = false,
  useSatin = true,
  /** Override fill stella (colored su accent caldo: oro → colore testo). */
  starFill?: string,
  font: BadgeFont = "inter",
) {
  const padX = Math.round(fs * GENRE_PILL_PAD_X_FACTOR)
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, undefined, font)
  const pillW = dims.textContentW + padX * 2
  const pillH = fs + Math.round(fs * GENRE_PILL_PAD_Y_FACTOR) * 2
  const pillR = pillH / 2
  // Padding simmetrico per la coda dell'ombra (la pill sta in basso, mai a
  // filo bordo). Vale anche per colored (tinta piatta + ombra).
  const renderW = pillW + TOP_SHADOW_PAD * 2
  const renderH = pillH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: ox + pillW / 2 + textOffsetX, y: oy + pillH / 2, parts, starFill, font })
  const gradDef = useSatin ? `<linearGradient id="gpg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>` : ""
  const fill = useSatin ? "url(#gpg)" : bgColor
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = `<defs>${STAR_GRADIENT_DEF}${gradDef}${TOP_SHADOW_FILTER}</defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<rect x="${ox}" y="${oy}" width="${pillW}" height="${pillH}" rx="${pillR}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: renderH }
}

export function buildGenreTextSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, style: string, textOffsetX = 0, parts?: GenreParts, font: BadgeFont = "inter") {
  const isMinimal = style === "minimal"
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, style, font)
  const shadowPad = style === "shadow" ? 8 : (isMinimal ? 2 : 0)
  const shadowDrop = style === "shadow" ? 5 : (isMinimal ? 1 : 0)
  const safePad = genreBadgeSafePad(fs)
  const renderW = dims.totalW + shadowPad * 2 + safePad * 2
  const renderH = dims.svgH + shadowDrop
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: shadowDrop + (dims.svgH - shadowDrop) / 2, parts, style, font })
  let defs = `<defs>${STAR_GRADIENT_DEF}`
  let filterAttr = ""
  if (style === "shadow") {
    defs += `<filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="rgba(0,0,0,0.8)"/><feDropShadow dx="0" dy="5" stdDeviation="4.5" flood-color="rgba(0,0,0,0.55)"/></filter></defs>`
    filterAttr = ' filter="url(#sh)"'
  } else if (isMinimal) {
    defs += `<filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="rgba(0,0,0,0.7)"/></filter></defs>`
    filterAttr = ' filter="url(#sh)"'
  } else {
    defs += `</defs>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<g fill="${textColor}"${filterAttr}>${textParts}</g></svg>`
  return { svg, w: renderW, h: renderH }
}

// --- Genre `ink` (bare accent typography) -----------------------------------
// Stessa geometria/test flow di `shadow` (nessuna placca, nessun bordo): il
// fill dei glifi è l'accento di scena in gradiente orizzontale (accento →
// stessa tinta a L+0.12) sopra un alone scuro 1px, con la sola ombra 3D
// condivisa `tds`. Additivo: nessuno stile esistente cambia.

/** Spessore VISIBILE dell'alone ink (px sul box): lo stroke è centrato
 *  sull'edge del glifo, quindi `stroke-width` = 2 × questo valore (stessa
 *  ricetta del wordmark, `buildTextLogoSvg`). */
export const GENRE_INK_HALO_WIDTH = 1

/** Delta di lightness HSL del secondo stop del gradiente ink. */
export const GENRE_INK_LIGHTNESS_STEP = 0.12

function hexChannels(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/** RGB [0,255] → HSL (H 0-360, S/L 0-1). Copia locale delle equazioni di
 *  `accent-color.ts` (foglia che le tiene private): nessuna seconda pipeline
 *  di accento, solo la conversione necessaria a derivare lo stop chiaro. */
function hslFromRgb(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2, d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function rgbFromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r1 = 0, g1 = 0, b1 = 0
  if (h < 60) { r1 = c; g1 = x }
  else if (h < 120) { r1 = x; g1 = c }
  else if (h < 180) { g1 = c; b1 = x }
  else if (h < 240) { g1 = x; b1 = c }
  else if (h < 300) { r1 = x; b1 = c }
  else { r1 = c; b1 = x }
  return [
    Math.max(0, Math.min(255, Math.round((r1 + m) * 255))),
    Math.max(0, Math.min(255, Math.round((g1 + m) * 255))),
    Math.max(0, Math.min(255, Math.round((b1 + m) * 255))),
  ]
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, "0")
}

/**
 * Secondo stop del gradiente ink: stesso hue/saturazione dell'accento a
 * L + `GENRE_INK_LIGHTNESS_STEP` (clamp 0..1). Non-hex/malformato → null
 * (nessun colore inventato: il builder ricade sull'inchiostro di ricetta).
 */
export function accentInkLightHex(hex: string | null | undefined, step = GENRE_INK_LIGHTNESS_STEP): string | null {
  if (!hex) return null
  const ch = hexChannels(hex)
  if (!ch) return null
  const { h, s, l } = hslFromRgb(ch[0], ch[1], ch[2])
  const [r, g, b] = rgbFromHsl(h, s, Math.max(0, Math.min(1, l + step)))
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}

/**
 * Stile `ink` (badge genere/rating): tipografia NUDA come `shadow` (stessa
 * geometria, stesso text flow a segmenti, safe pad e shadow pad), fill dei
 * glifi = accento risolto in gradiente orizzontale (accento → L+0.12) e alone
 * scuro 1px sotto (stessa ricetta del wordmark, `TEXT_LOGO_HALO`) con la sola
 * ombra 3D condivisa `tds`. Nessuna placca/bordo/satinatura. Accento
 * assente/invalido → inchiostro di ricetta (`fallbackInk`), mai un colore
 * inventato. La stella NON segue i glifi: resta off-white minimale
 * (`GENRE_INK_STAR_INK`, adattato sul fondo chiaro da `inkStarInkFor`), mai il
 * gradiente oro degli altri stili, anche sopra l'alone.
 */
export function buildGenreInkSvg(
  genreName: string,
  voteStr: string,
  yearStr: string,
  fs: number,
  accentColor: string | null | undefined,
  fallbackInk: string,
  textOffsetX = 0,
  parts?: GenreParts,
  font: BadgeFont = "inter",
  /** Override fill stella (default: off-white minimale, mai oro). */
  starFill?: string,
) {
  // Geometria identica a `shadow` (bare typography, nessun contenitore).
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, undefined, font)
  const shadowPad = 8
  const shadowDrop = 5
  const safePad = genreBadgeSafePad(fs)
  const renderW = dims.totalW + shadowPad * 2 + safePad * 2
  const renderH = dims.svgH + shadowDrop
  const textParts = buildGenreTextFlow({
    genreName,
    voteStr,
    yearStr,
    fs,
    centerX: renderW / 2 + textOffsetX,
    y: shadowDrop + (dims.svgH - shadowDrop) / 2,
    parts,
    starFill: starFill ?? GENRE_INK_STAR_INK,
    font,
  })
  const lightHex = accentInkLightHex(accentColor)
  const inkFill = accentColor && lightHex ? "url(#gik)" : fallbackInk
  const gradDef = inkFill === "url(#gik)"
    ? `<linearGradient id="gik" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${accentColor}"/><stop offset="100%" stop-color="${lightHex}"/></linearGradient>`
    : ""
  const defs = `<defs>${gradDef}${TOP_SHADOW_FILTER}</defs>`
  // Due passate: alone scuro (solo stroke, `fill="none"`) sotto, inchiostro
  // sopra. Gli attributi inline dei segmenti (fill-opacity del bullet, fill
  // della stella) restano quelli del text flow: la stella si porta il proprio
  // fill (off-white minimale) anche nel layer d'alone. Nessun gradiente oro
  // (`starg`) nel ink: la stella non e mai dorata in questa modalita.
  const haloEl = `<g fill="none" stroke="${TEXT_LOGO_HALO}" stroke-width="${GENRE_INK_HALO_WIDTH * 2}" stroke-linejoin="round">${textParts}</g>`
  const inkEl = `<g fill="${inkFill}">${textParts}</g>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<g filter="url(#tds)">${haloEl}${inkEl}</g></svg>`
  return { svg, w: renderW, h: renderH }
}

export function buildGenreBorderedSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, topLight: boolean, textOffsetX = 0, parts?: GenreParts, starFill?: string, font: BadgeFont = "inter") {
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, undefined, font)
  const padX = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const borderW = 2
  const renderW = dims.textContentW + padX * 2
  const boxH = dims.svgH
  const r = Math.round(fs * 0.55)
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.32)"
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: boxH / 2, parts, starFill, font })
  const defs = `<defs>${STAR_GRADIENT_DEF}</defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}" viewBox="0 0 ${renderW} ${boxH}">${defs}<rect x="${borderW / 2}" y="${borderW / 2}" width="${renderW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: boxH }
}

export function buildGenreGlassSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, topLight: boolean, textOffsetX = 0, parts?: GenreParts, starFill?: string, font: BadgeFont = "inter") {
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, undefined, font)
  const padX = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const renderW = dims.textContentW + padX * 2
  const boxH = dims.svgH
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: boxH / 2, parts, starFill, font })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}" viewBox="0 0 ${renderW} ${boxH}"><defs>${STAR_GRADIENT_DEF}<linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect width="${renderW}" height="${boxH}" rx="${r}" fill="url(#gg)" stroke="${borderColor}" stroke-width="1.5"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: boxH }
}

export function glassStops(topLight: boolean): string {
  return topLight
    ? `<stop offset="0%" stop-color="rgba(255,255,255,0.92)"/><stop offset="12%" stop-color="rgba(255,255,255,0.62)"/><stop offset="50%" stop-color="rgba(255,255,255,0.55)"/><stop offset="100%" stop-color="rgba(255,255,255,0.38)"/>`
    : `<stop offset="0%" stop-color="rgba(255,255,255,0.45)"/><stop offset="10%" stop-color="rgba(255,255,255,0.18)"/><stop offset="50%" stop-color="rgba(0,0,0,0.22)"/><stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>`
}

/**
 * Ombra 3D singola per i badge centrali superiori (default/pill ranking ed
 * extra, colored incluso via builder): stessa ricetta del nastro Netflix
 * (dx=3, dy=3, blur 3.5, 0.65), canvas = box esatta come il nastro — la coda
 * oltre il viewport viene tagliata, come lì. Solo sul contenitore, mai sul testo.
 */
export const TOP_SHADOW_FILTER = `<filter id="tds" x="-20%" y="-20%" width="180%" height="180%"><feDropShadow dx="3" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.65"/></filter>`

/**
 * Padding per la coda dell'ombra 3D (dx=3, dy=3, blur 3.5 → ~14px): senza,
 * il viewport taglia di netto l'alone e gli angoli sembrano quadrati.
 * Solo lati e basso: in alto la placca resta a filo del bordo poster (l'ombra
 * cade verso il basso, la coda superiore tagliata è invisibile).
 */
export const TOP_SHADOW_PAD = 14

// ---------------------------------------------------------------------------
// Text-as-logo: wordmark trasparente ricavato dal testo digitato, con i soli
// font del bundle (stesso enum dei badge). Sostituisce il logo TMDB quando il
// titolo non ne ha uno: il buffer PNG entra nel path di compositing logo
// esistente (posizione/scala/velatura invariati), quindi preview e poster
// Stremio restano lo stesso renderer.
// ---------------------------------------------------------------------------

/** Corpo base del logo testuale (griglia interna; resvg scala il run). */
export const TEXT_LOGO_FS = 100

/** Peso del wordmark (Black dei font inclusi, come i marchi tecnici). */
export const TEXT_LOGO_FONT_WEIGHT = 900

/** Inchiostro: bianco polarità-indipendente. La leggibilità sul fondo la
 *  decide la velatura adattiva esistente (logoInkLuminance +
 *  posterLogoZoneLuminance in poster-service), che lavora sull'inchiostro
 *  effettivo del buffer — nessun secondo canale di adattamento. */
export const TEXT_LOGO_INK = "#ffffff"

/** Alone scuro dietro ai glifi (spessore = frazione di `fs`): stacca il
 *  wordmark dal chiaro senza cambiare il colore dell'inchiostro. */
export const TEXT_LOGO_HALO = "rgba(0,0,0,0.55)"
export const TEXT_LOGO_HALO_FACTOR = 0.07

/** Tracking del wordmark manuale (0.02em). */
export const TEXT_LOGO_TRACK_FACTOR = 0.02

/** Opzioni di resa del wordmark. Il default riproduce il logo manuale
 *  (nessun cambio byte); l'automatico passa un tracking più arioso, vedi
 *  `AUTO_WORDMARK_TRACK_FACTOR` in text-logo.ts. */
export interface TextLogoStyle {
  /** Tracking in em applicato ai glifi (default `TEXT_LOGO_TRACK_FACTOR`). */
  readonly trackingEm?: number
}

/**
 * SVG del logo testuale: canvas TRASPARENTE (nessuna placca, nessun bordo),
 * una sola riga di testo con l'alone scuro e l'ombra condivisa `tds`
 * (leggibilità su artwork chiaro/scuro), font risolto da `fontFamilyFor`
 * (Barlow Condensed / Oswald / Inter + fallback Rubik) e testo passato da
 * `escSvg` (nessuna iniezione SVG possibile: il testo è input utente).
 *
 * Il viewport include il padding dell'ombra: il bitmap risultante è più
 * largo del solo run, come i badge che usano `TOP_SHADOW_PAD`.
 */
export function buildTextLogoSvg(
  text: string,
  font: BadgeFont = "inter",
  style?: TextLogoStyle,
): { svg: string; w: number; h: number } {
  const f = normalizeBadgeFont(font)
  const fs = TEXT_LOGO_FS
  const family = fontFamilyFor(text, f)
  const trackFactor = style?.trackingEm ?? TEXT_LOGO_TRACK_FACTOR
  const track = text.length > 1 ? trackFactor * fs * (text.length - 1) : 0
  const textW = Math.round(estimateTextWidth(text, fs, f) + track)
  const halo = Math.max(2, Math.round(fs * TEXT_LOGO_HALO_FACTOR))
  // Altezza ottica del run (ascendenti + discendenti) senza il leading del
  // font: il wordmark resta compatto e la scala auto per aspect del logo
  // (logoDefaultScaleFromAspect) lo porta alla larghezza del titolo.
  const glyphH = Math.round(fs * 1.24)
  const pad = TOP_SHADOW_PAD
  const w = Math.ceil(textW + halo * 2 + pad * 2)
  const h = Math.ceil(glyphH + halo * 2 + pad * 2)
  const cx = w / 2
  const cy = h / 2
  // toFixed solo quando lo stile esplicito lo richiede: 0.05 * 100 non è
  // esatto in binario e un raw concatenato spaccerebbe il render in due
  // stringhe SVG leggermente diverse. Il default manuale resta byte-identico.
  const letterSpacing = style?.trackingEm != null ? Number((trackFactor * fs).toFixed(3)) : trackFactor * fs
  const textAttrs = `x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="${TEXT_LOGO_FONT_WEIGHT}" font-size="${fs}" letter-spacing="${letterSpacing}"`
  // Due passate: alone scuro (solo stroke) sotto, inchiostro sopra. Il
  // `paint-order` non serve e il testo resta una sola stringa escapata.
  const haloEl = `<text ${textAttrs} fill="none" stroke="${TEXT_LOGO_HALO}" stroke-width="${halo * 2}" stroke-linejoin="round">${escSvg(text)}</text>`
  const inkEl = `<text ${textAttrs} fill="${TEXT_LOGO_INK}">${escSvg(text)}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${TOP_SHADOW_FILTER}</defs><g filter="url(#tds)">${haloEl}${inkEl}</g></svg>`
  return { svg, w, h }
}

/**
 * Leggera ombra esterna dei tag `knockout` (tier qualità e marchi A/V):
 * alone morbido, senza offset 3D e con alpha bassa, quanto basta a staccare
 * il tag bianco da un artwork chiaro. Non sostituisce `TOP_SHADOW_FILTER`
 * (che resta sul rect mascherato del tag): vedi `knockoutOuterShadow` per il
 * perché serve un layer separato.
 */
export const KNOCKOUT_SHADOW_FILTER = `<filter id="kos" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.35"/></filter>`

/**
 * Ink opacity of the `knockout` glyphs (quality tier and A/V marks): 70%
 * black painted OVER the artwork that stays visible through the tag cut-out.
 * Painting it on the opaque white body instead would only blend with white,
 * losing every artwork contribution; this way the letters read as stable dark
 * ink while the poster still contributes 30% of the final color.
 */
export const KNOCKOUT_INK_OPACITY = 0.70

/** Box del tag `knockout` su cui disegnare l'alone esterno. */
export interface KnockoutShadowBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly r: number
}

/**
 * Layer di ombra LEGGERA esterna per i tag `knockout` (tier qualità e marchi
 * A/V) — la mask tiene l'alone rigorosamente FUORI dal box del tag.
 *
 * Perché un layer separato: la mask del tag viene applicata DOPO il filtro,
 * quindi `TOP_SHADOW_FILTER` sul rect mascherato non lascia nessun alone
 * fuori dal tag (misurato a raster: zero pixel non trasparenti nel pad). Il
 * tag bianco resta perciò senza stacco su artwork chiaro. L'alone è
 * disegnato SOTTO il tag e la mask copre l'INTERO box (rettangolo pieno,
 * angoli compresi): nessuna ombra entra nelle tacche degli angoli né nei
 * ritagli delle lettere (lì passa solo l'artwork, sotto l'inchiostro del
 * builder) e la geometria del tag non cambia. Il caster mantiene il raggio reale del tag,
 * così l'alone fuori dal box segue la sagoma arrotondata.
 */
export function knockoutOuterShadow(
  maskId: string,
  renderW: number,
  renderH: number,
  box: KnockoutShadowBox,
): { defs: string; layer: string } {
  // Blocker SENZA raggio: deve coprire anche le tacche degli angoli dentro il
  // box (lì il tag è trasparente, ma un'ombra lì sembrerebbe un angolo
  // quadrato — la vecchia regressione che i test pinnano).
  const defs = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${renderW}" height="${renderH}"><rect x="0" y="0" width="${renderW}" height="${renderH}" fill="#ffffff"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#000000"/></mask>`
  const layer = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r}" fill="#ffffff" mask="url(#${maskId})" filter="url(#kos)"/>`
  return { defs, layer }
}

/**
 * Raggio angoli placca ranking/extra default: squadrata ma non a spigolo
 * vivo (0.45 × fs ≈ 11px a fs 24). Vale solo per lo stile default; la pill
 * resta full-round per identità di stile.
 */
export const RANKING_DEFAULT_RADIUS_FACTOR = 0.45

/**
 * Gradiente satinato per i badge a convenzione "pill" (pill chiara + testo
 * scuro su poster scuro, pill scura + testo chiaro su poster chiaro):
 * ranking-default, nastro netflix, qualità.
 *
 * Polarità opposta a `glassStops` (disegnato per testo sempre chiaro):
 * su poster scuro la pill resta chiara e luminosa (il rank deve emergere),
 * su poster chiaro diventa grafite scura. Solo rgba traslucidi, mai opachi.
 */
export function satinPillStops(topLight: boolean): string {
  return topLight
    ? `<stop offset="0%" stop-color="rgba(52,64,86,0.85)"/><stop offset="35%" stop-color="rgba(23,32,48,0.83)"/><stop offset="70%" stop-color="rgba(12,18,30,0.84)"/><stop offset="100%" stop-color="rgba(0,0,0,0.88)"/>`
    : `<stop offset="0%" stop-color="rgba(255,255,255,0.95)"/><stop offset="30%" stop-color="rgba(255,255,255,0.82)"/><stop offset="62%" stop-color="rgba(255,255,255,0.66)"/><stop offset="100%" stop-color="rgba(255,255,255,0.50)"/>`
}

export function buildRankingDefaultSvg(fullText: string, fs: number, textColor: string, _bg: string, topLight = false, flatBg?: string, detached = false, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = estimateTextWidth(fullText, fs, font)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * RANKING_DEFAULT_RADIUS_FACTOR)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD
  const ox = TOP_SHADOW_PAD
  const oy = 0
  const pathD = detached
    ? `M ${ox + r},${oy} L ${ox + totalW - r},${oy} A ${r},${r} 0 0,1 ${ox + totalW},${oy + r} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} L ${ox},${oy + r} A ${r},${r} 0 0,1 ${ox + r},${oy} Z`
    : `M ${ox},${oy} L ${ox + totalW},${oy} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} Z`
  const centerX = ox + totalW / 2
  const centerY = oy + boxH / 2
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = `<defs><linearGradient id="rdg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
  const textEl = `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText, font)}" font-weight="${RANKING_FONT_WEIGHT}" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  // colored: tinta accent piatta (contratto storico); default: gradiente satinato.
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#rdg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
}

/** `split` chip: left accent cell numeral size (em of the badge `fs`). */
export const SPLIT_NUMERAL_FS_FACTOR = 0.9
/** `split` chip: right satin cell label size (em of the badge `fs`). */
export const SPLIT_LABEL_FS_FACTOR = 0.72
/** `split` chip: auto-fit floor for the label (em of `fs`, never clipped). */
export const SPLIT_LABEL_MIN_FS_FACTOR = 0.55
/** `split` chip: contained rounded-rectangle radius (`0.30 × boxH`). */
export const SPLIT_RADIUS_FACTOR = 0.30
/** `split` chip: 1px inner divider between the two cells. */
export const SPLIT_DIVIDER_WIDTH = 1
/** `split` chip: optical gap on each side of the divider (em of `fs`). */
export const SPLIT_DIVIDER_GAP_FACTOR = 0.30
/**
 * `split` chip: FIXED mockup yellow for the numeral cell (`ac=`/scene accent
 * never tints it — the chip must always be the same recognizable mark).
 */
export const SPLIT_ACCENT_YELLOW = "#FCD34D"
/** `split` chip: numeral ink on the fixed yellow cell (measured 12.07:1). */
export const SPLIT_NUMERAL_INK = "#1a1a1a"
/** `split` chip: extra padding on the numeral cell for DOUBLE digits (+10%). */
export const SPLIT_DOUBLE_CELL_PAD_FACTOR = 1.1
/**
 * `split` chip: ink-bearing compensation of the numeral anchor (em of the
 * numeral font size, to the right, FRACTIONAL — never rounded to a whole
 * pixel). The advance-box center of Inter digits sits slightly right of the
 * rasterized ink center (~0.5px at 27px, ~1px on double digits): this keeps
 * the actual ink optically centered in the yellow cell. Calibrated on the
 * rendered PNG (ink margins symmetric within ±1px on "1"/"3"/"9"/"11"/"12"/
 * "20" at the badge base size).
 */
export const SPLIT_NUMERAL_INK_SHIFT_FACTOR = 0.018
/** Legacy neutral accent (kept for compatibility; the split chip is fixed yellow). */
export const SPLIT_NEUTRAL_ACCENT = "#555555"

export interface SplitChipInput {
  /** Rank numeral (left accent cell). */
  readonly numeral: string
  /** Period label (right satin cell). */
  readonly label: string
  readonly fs: number
  /**
   * Legacy scene accent (or `ac=` override). IGNORED by the chip: the numeral
   * cell is always the fixed mockup yellow `SPLIT_ACCENT_YELLOW`.
   */
  readonly accentColor?: string
  readonly topLight?: boolean
  /** Four rounded corners (badge detached from the top edge by `toy`). */
  readonly detached?: boolean
  readonly font?: BadgeFont
  /** Resolved satin-cell ink (already opacity-applied); absent = recipe. */
  readonly textColor?: string
  /**
   * Rendering width cap (poster px, same `pw - 20` aesthetic cap as the
   * ranking badge): the period label auto-fits down to
   * `SPLIT_LABEL_MIN_FS_FACTOR` instead of growing the chip past this width.
   */
  readonly maxWidth?: number
}

/**
 * `split` top badge (RANKING-ONLY, `rs=split`): ONE flat two-tone chip behind
 * the existing dispatcher (`buildHouseRankingSvg`), never a second renderer.
 *
 * - visible box: `textW + numeralPadX + 0.75fs` wide (numeral cell padding is
 *   +10% for double digits), `badgeBoxHeight(fs)` tall, radius `0.30 × boxH`
 *   (contained rounded rectangle, not a full pill);
 * - left cell: FIXED mockup yellow (`SPLIT_ACCENT_YELLOW`, flat — never the
 *   scene accent/`ac=`: the mark is always recognizable), rank numeral at
 *   `0.9em` / weight 900 with dark ink `SPLIT_NUMERAL_INK` (12.07:1),
 *   optically centered on the YELLOW CELL's ink box (`leftCellW / 2` plus the
 *   shared ink-bearing compensation `SPLIT_NUMERAL_INK_SHIFT_FACTOR` — the
 *   asymmetric `numeralPadX`/`cellGap` insets no longer bias it);
 *   double digits keep the +10% cell padding (box contract) and center the
 *   same way, single and double digits alike;
 * - 1px inner divider (polarity-adaptive) between the cells;
 * - right cell: the shared satin pill gradient (polarity from `topLight`)
 *   with the period label at `0.72em` / weight 600, auto-fit down to the
 *   `0.55em` floor for long localized words (never clipped, never past the
 *   `maxWidth` cap).
 *
 * Geometry/economy contract: one `<filter id="tds">` on the chip body and one
 * extra `<rect>` (the accent cell, clipped to the chip shape). The outline is
 * re-stroked above the accent rect so the 1.5px polarized border survives on
 * the covered edge. Extras never reach this builder: `xbs=split` is invalid
 * and the legacy `rs=split` fallback degrades to the default plate in
 * `buildHouseExtraSvg`.
 * `t`/`tl`/scale/offset stay the existing ones (bitmap resize downstream).
 */
export function buildSplitChipSvg(input: SplitChipInput): { svg: string; w: number; h: number } {
  const { fs, label } = input
  const numeral = input.numeral.trim()
  const font = normalizeBadgeFont(input.font)
  const topLight = input.topLight ?? false
  const detached = input.detached ?? false
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const numeralFs = Math.max(1, Math.round(fs * SPLIT_NUMERAL_FS_FACTOR))
  const numeralW = Math.max(estimateTextWidth(numeral, numeralFs, font), Math.round(numeralFs * 0.35))
  const cellGap = Math.max(2, Math.round(fs * SPLIT_DIVIDER_GAP_FACTOR))
  const dividerW = SPLIT_DIVIDER_WIDTH
  // Double digits keep the historical +10% numeral-cell padding (box
  // contract, unchanged), but the numeral is no longer anchored on the padded
  // advance box: that inset is asymmetric (`numeralPadX` on the left, the
  // divider gap `cellGap` on the right), so it read off-center. The anchor is
  // the YELLOW CELL's own center (`leftCellW / 2`) plus a small
  // em-proportional ink-bearing compensation, so the rasterized glyphs sit
  // optically centered (single and double digits alike).
  const doubleDigit = numeral.length >= 2
  const numeralPadX = doubleDigit ? Math.round(px * SPLIT_DOUBLE_CELL_PAD_FACTOR) : px
  const inkShift = numeralFs * SPLIT_NUMERAL_INK_SHIFT_FACTOR
  // Period label: 0.72em default, auto-fit down to the 0.55em floor when a
  // localized label (Aujourd'hui/Heute/…) would push the chip past the cap.
  // `textFitAttrs` pins the run to the measured width, so the label never
  // clips; the chip only grows with its real ink, never past `maxWidth` when
  // one is supplied (same `pw - 20` cap idiom as the ranking badge).
  const labelFloorFs = Math.max(1, Math.ceil(fs * SPLIT_LABEL_MIN_FS_FACTOR))
  let labelFs = Math.max(1, Math.round(fs * SPLIT_LABEL_FS_FACTOR))
  let labelW = label ? Math.max(estimateTextWidth(label, labelFs, font), Math.round(labelFs * 0.35)) : 0
  const maxCap = input.maxWidth && input.maxWidth > 0 ? input.maxWidth : Number.POSITIVE_INFINITY
  const chipW = (lw: number): number => Math.max(1, numeralW + lw + cellGap * 2 + dividerW + numeralPadX + px)
  while (label && labelFs > labelFloorFs && chipW(labelW) > maxCap) {
    labelFs -= 1
    labelW = Math.max(estimateTextWidth(label, labelFs, font), Math.round(labelFs * 0.35))
  }
  // Chip ink run = numeral + label + inner gaps + divider; padding is
  // `numeralPadX` (left cell) + `px` (right cell), see `chipW`.
  const totalW = chipW(labelW)
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(boxH * SPLIT_RADIUS_FACTOR)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD
  const ox = TOP_SHADOW_PAD
  const oy = 0
  const leftCellW = numeralPadX + numeralW + cellGap
  const pathD = detached
    ? `M ${ox + r},${oy} L ${ox + totalW - r},${oy} A ${r},${r} 0 0,1 ${ox + totalW},${oy + r} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} L ${ox},${oy + r} A ${r},${r} 0 0,1 ${ox + r},${oy} Z`
    : `M ${ox},${oy} L ${ox + totalW},${oy} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} Z`
  const centerY = oy + boxH / 2
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const accent = SPLIT_ACCENT_YELLOW
  const labelInk = input.textColor ?? (topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
  const defs = `<defs><linearGradient id="splg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient><clipPath id="splc"><path d="${pathD}"/></clipPath>${TOP_SHADOW_FILTER}</defs>`
  // Chip body: satin fill + polarized border + the single shared 3D shadow.
  const bodyEl = `<path d="${pathD}" fill="url(#splg)" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>`
  const dividerX = ox + leftCellW
  const inset = Math.round(fs * 0.16)
  const accentEl = `<rect x="${ox}" y="${oy}" width="${Math.max(1, leftCellW)}" height="${boxH}" fill="${accent}" clip-path="url(#splc)"/>`
  const dividerEl = `<line x1="${dividerX + dividerW / 2}" y1="${oy + inset}" x2="${dividerX + dividerW / 2}" y2="${oy + boxH - inset}" stroke="${topLight ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.32)"}" stroke-width="${dividerW}"/>`
  // The accent rect covers the inner half of the chip stroke on its cell:
  // re-stroke the exact outline above it (same width/polarity, footprint
  // unchanged). The shadow already bleeds from the body path underneath.
  const outlineEl = `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`
  const numeralX = ox + leftCellW / 2 + inkShift
  const numeralEl = `<text x="${numeralX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(numeral, font)}" font-weight="900" font-size="${numeralFs}" fill="${SPLIT_NUMERAL_INK}"${textFitAttrs(numeralW)}>${escSvg(numeral)}</text>`
  const labelCenterX = ox + leftCellW + dividerW + cellGap + labelW / 2
  const labelEl = label
    ? `<text x="${labelCenterX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="600" font-size="${labelFs}" fill="${labelInk}"${textFitAttrs(labelW)}>${escSvg(label)}</text>`
    : ""
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bodyEl}${accentEl}${dividerEl}${outlineEl}${numeralEl}${labelEl}</svg>`,
    w: renderW,
    h: renderH,
  }
}

export function buildRankingPillSvg(fullText: string, fs: number, textColor: string, bg: string, topLight = false, useSatin = true, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = boxH / 2
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const gradDef = useSatin ? `<linearGradient id="rpg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>` : ""
  const fill = useSatin ? "url(#rpg)" : bg
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = gradDef ? `<defs>${gradDef}${TOP_SHADOW_FILTER}</defs>` : ""
  const filterAttr = useSatin ? ' filter="url(#tds)"' : ""
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${filterAttr}/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

/**
 * Flat accent pill for the ranking `corner` style (top-left anchor):
 * same box model as the satin pill but flat-filled with `accentColorRank`
 * (already-resolved scene tint or `ac=` override), readability-preferred
 * text via `textColorForBg` (white while its effective contrast stays >= 2:1,
 * a visual preference — see COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST).
 * No satin gradient, no stroke — only the shared 3D shadow.
 */
export function buildRankingCornerSvg(fullText: string, fs: number, accentColor: string, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  // Contained rounded-rectangle radius (reference look, ~0.25 boxH),
  // not a full pill.
  const r = Math.round(boxH * 0.25)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const textColor = textColorForBg(accentColor || "")
  const defs = `<defs>${TOP_SHADOW_FILTER}</defs>`
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${accentColor}" filter="url(#tds)"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

/**
 * Big standalone rank numeral for the ranking `number` style (look inspired
 * by PostersPlus `trending_rank.py`, independent SVG/resvg implementation):
 * bare Inter Bold digits with a vertical white→silver gradient and a soft
 * drop shadow. No plate, no ribbon, no "#" and no label — the number sits
 * directly on the artwork in the top corner (placement lives in
 * `poster-service.ts`, same anchor as `corner`, mirrored with `side=right`).
 * Sized as a fraction of the render width so it scales with `pw` like every
 * other badge; `topBadgeScale` applies downstream as a bitmap resize.
 */
export function buildRankingNumberSvg(rank: number, pw: number, font: BadgeFont = "inter") {
  const digits = String(rank)
  // Digit ink height ≈ 0.19 × pw (reference look); Inter Bold digit cap
  // height is ≈ 0.72em, so fs ≈ 0.19/0.72 × pw. Tight tracking like display
  // numerals at large sizes.
  const fs = Math.max(Math.round(pw * 0.264), 10)
  const track = -Math.round(fs * 0.03)
  const advances = [...digits].map((ch) => estimateTextWidth(ch, fs, font))
  const textW = Math.max(
    advances.reduce((a, b) => a + b, 0) + track * Math.max(0, digits.length - 1),
    fs * 0.35,
  )
  const inkH = Math.round(fs * 0.72)
  // Room for the soft shadow blur + offset on every side (no plate).
  const pad = Math.max(8, Math.round(pw * 0.03))
  const renderW = Math.ceil(textW) + pad * 2
  const renderH = inkH + pad * 2
  const blur = Math.max(2, Math.round(pw * 0.012))
  const off = Math.max(1, Math.round(pw * 0.004))
  const gradId = "ranknumg"
  const shadowId = "ranknumsh"
  const defs =
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#FFFFFF"/><stop offset="55%" stop-color="#D6D8DC"/>` +
    `<stop offset="100%" stop-color="#A8ACB4"/></linearGradient>` +
    `<filter id="${shadowId}" x="-40%" y="-40%" width="180%" height="180%">` +
    `<feDropShadow dx="0" dy="${off}" stdDeviation="${blur}" flood-color="#000000" flood-opacity="0.59"/>` +
    `</filter></defs>`
  const textEl =
    `<text x="${pad + textW / 2}" y="${renderH / 2}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${fontFamilyFor(digits, font)}" font-weight="${RANKING_FONT_WEIGHT}" font-size="${fs}" ` +
    `fill="url(#${gradId})" filter="url(#${shadowId})"${textFitAttrs(textW)}>${escSvg(digits)}</text>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildRankingGlassSvg(fullText: string, fs: number, textColor: string, _bg: string, topLight: boolean, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const defs = `<defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
  const bgEl = `<rect x="0" y="0" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#rg)" stroke="${borderColor}" stroke-width="1.5"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildRankingBorderedSvg(fullText: string, fs: number, textColor: string, topLight: boolean, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.55)
  const borderW = 2
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.32)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const bgEl = `<rect x="${borderW / 2}" y="${borderW / 2}" width="${totalW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildExtraDefaultSvg(label: string, fs: number, textColor: string, _bg: string, detached = false, topLight = false, flatBg?: string, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * RANKING_DEFAULT_RADIUS_FACTOR)
  // Come il ranking default: canvas = box + padding per la coda dell'ombra
  // (solo lati/basso: in alto la placca resta a filo), bordo sagomato
  // polarizzato 1.5px. I nuovi parametri restano in coda per non rompere le
  // chiamate posizionali esistenti.
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD
  const ox = TOP_SHADOW_PAD
  const oy = 0
  const pathD = detached
    ? `M ${ox + r},${oy} L ${ox + totalW - r},${oy} A ${r},${r} 0 0,1 ${ox + totalW},${oy + r} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} L ${ox},${oy + r} A ${r},${r} 0 0,1 ${ox + r},${oy} Z`
    : `M ${ox},${oy} L ${ox + totalW},${oy} L ${ox + totalW},${oy + boxH - r} A ${r},${r} 0 0,1 ${ox + totalW - r},${oy + boxH} L ${ox + r},${oy + boxH} A ${r},${r} 0 0,1 ${ox},${oy + boxH - r} Z`
  const centerX = ox + totalW / 2
  const centerY = oy + boxH / 2
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = `<defs><linearGradient id="edg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
  const textEl = `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  // colored: tinta accent piatta (contratto storico); default: gradiente satinato.
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#edg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildExtraPillSvg(label: string, fs: number, textColor: string, bg: string, topLight = false, useSatin = true, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = boxH / 2
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const gradDef = useSatin ? `<linearGradient id="epg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>` : ""
  const fill = useSatin ? "url(#epg)" : bg
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = gradDef ? `<defs>${gradDef}${TOP_SHADOW_FILTER}</defs>` : ""
  const filterAttr = useSatin ? ' filter="url(#tds)"' : ""
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${filterAttr}/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildExtraGlassSvg(label: string, fs: number, textColor: string, _bg: string, topLight: boolean, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const defs = `<defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
  const bgEl = `<rect x="0" y="0" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#eg)" stroke="${borderColor}" stroke-width="1.5"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildExtraBorderedSvg(label: string, fs: number, textColor: string, topLight: boolean, font: BadgeFont = "inter") {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs, font), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.55)
  const borderW = 2
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.32)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const bgEl = `<rect x="${borderW / 2}" y="${borderW / 2}" width="${totalW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildNetflixRankSvg(rank: number, pw: number, font: BadgeFont = "inter") {
  const fs = Math.round(Math.max(23 * pw / 380, 14))
  const w = Math.round(fs * 2.4)
  const h = Math.round(fs * 2.0)
  const cut = Math.round(fs * 0.35)
  const topFs = Math.round(fs * 0.5)
  const rankFs = Math.round(fs * 1.0)
  const pathD = `M ${cut},0 L ${w},0 L ${w},${h} L 0,${h} L 0,${cut} Z`
  const textEl = `<text x="${w / 2}" y="${Math.round(h * 0.38)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor("TOP", font)}" font-weight="700" font-size="${topFs}" fill="#ffffff">TOP</text><text x="${w / 2}" y="${Math.round(h * 0.72)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(String(rank), font)}" font-weight="900" font-size="${rankFs}" fill="#ffffff">${rank}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><clipPath id="nf"><path d="${pathD}"/></clipPath></defs><g clip-path="url(#nf)"><rect width="${w}" height="${h}" rx="2" fill="#E50914"/></g>${textEl}</svg>`
  return { svg, w, h }
}

// ---------------------------------------------------------------------------
// Common VISIBLE box of the quality/age/formats column.
//
// Every TEXT element of the column can be rendered inside a FIXED visible
// width (`targetW`): the group uses the visible width of the canonical 4K
// mark of the active style, so tier, age and A/V marks really share one box
// (not just the same transparent canvas). Glyphs are NEVER stretched: if the
// label (FHD, PG-13, TV-MA…) is wider than the column the FONT shrinks
// (`fitBadgeGlyphFs`, same shared metrics/kerning), while height, radius and
// recipe padding stay those of the base `fs` — the column band never changes.
// Without `targetW` every builder keeps its historic natural geometry (the
// standalone path is untouched).
// ---------------------------------------------------------------------------

/** Technical-mark tracking: 0.06em per gap (shared text metrics). */
const BADGE_TEXT_TRACK_FACTOR = 0.06

/** Pinned glyph-run width (shared estimate + tracking) used by `textLength`. */
export function pinnedBadgeTextWidth(text: string, fs: number, font: BadgeFont = "inter"): number {
  const track = text.length > 1 ? Math.round(BADGE_TEXT_TRACK_FACTOR * fs * (text.length - 1)) : 0
  return Math.max(estimateTextWidth(text, fs, font) + track, fs)
}

/**
 * Largest glyph size `fs <= baseFs` whose pinned run plus the recipe's
 * horizontal padding (`padXFactor × fs`) fits a fixed `targetW`. The low floor
 * guarantees a pathological label still fits the shared box.
 */
export function fitBadgeGlyphFs(
  text: string,
  baseFs: number,
  targetW: number,
  padXFactor: number,
  font: BadgeFont = "inter",
  minFs: number = 4,
): number {
  const floor = Math.max(1, Math.round(minFs))
  for (let fs = Math.max(floor, Math.round(baseFs)); fs > floor; fs--) {
    if (pinnedBadgeTextWidth(text, fs, font) + Math.round(fs * padXFactor) * 2 <= targetW) return fs
  }
  return floor
}

interface BadgeTextBox {
  /** Glyph size (base `fs`, reduced only when a fixed target is pinned). */
  readonly glyphFs: number
  /** Pinned glyph-run width (`textLength`), never wider than the box interior. */
  readonly textW: number
  /** Visible box width (the shared target when pinned, natural otherwise). */
  readonly totalW: number
  /** Visible box height from the BASE `fs`: the common column band. */
  readonly boxH: number
}

// ---------------------------------------------------------------------------
// Satin pill frame of the `standard` family (tier pill, age pill and framed
// A/V marks): one polarity rule for every box in the column.
// ---------------------------------------------------------------------------

/** Pill border 1.5px (shared by every satin frame in the column). */
export const SATIN_PILL_STROKE_WIDTH = 1.5
/** Satin border on a DARK top: light pill, so a light hairline. */
export const SATIN_PILL_STROKE_DARK = "rgba(255,255,255,0.22)"
/** Satin border on a LIGHT top: dark pill, so a dark hairline. */
export const SATIN_PILL_STROKE_LIGHT = "rgba(0,0,0,0.12)"
/** Pill/glyph ink on a LIGHT top (dark pill → white ink). */
export const SATIN_PILL_INK_LIGHT = "rgba(255,255,255,0.95)"
/** Pill/glyph ink on a DARK top (light pill → dark ink). */
export const SATIN_PILL_INK_DARK = "rgba(0,0,0,0.88)"

/** Shared text box of the quality/age recipes (natural or pinned width). */
export function badgeTextBox(
  text: string,
  baseFs: number,
  padXFactor: number,
  font: BadgeFont,
  targetW?: number,
): BadgeTextBox {
  const boxH = badgeBoxHeight(baseFs)
  if (targetW == null) {
    const textW = pinnedBadgeTextWidth(text, baseFs, font)
    return { glyphFs: baseFs, textW, totalW: textW + Math.round(baseFs * padXFactor) * 2, boxH }
  }
  const boxW = Math.max(1, Math.round(targetW))
  const glyphFs = fitBadgeGlyphFs(text, baseFs, boxW, padXFactor, font)
  const px = Math.round(glyphFs * padXFactor)
  // Safety clamp (pathological labels only): the run never spills out of the
  // shared box; `textLength` pins it without changing the box width.
  const textW = Math.min(pinnedBadgeTextWidth(text, glyphFs, font), Math.max(1, boxW - px * 2))
  return { glyphFs, textW, totalW: boxW, boxH }
}

export function buildQualityBadgeSvg(
  quality: string,
  fs: number,
  _textColor: string,
  _bg: string,
  topLight: boolean = false,
  font: BadgeFont = "inter",
  /** Fixed visible box width (group column); absent = natural width. */
  targetW?: number,
) {
  // Crenatura da marchio tecnico: 0.06em per intervallo. Il textLength è
  // pinnato sulla larghezza reale (stima + tracking) così il layout segue e
  // non comprime i glifi.
  const { glyphFs, textW, totalW, boxH } = badgeTextBox(quality, fs, BADGE_BOX_PAD_X_FACTOR, font, targetW)
  const r = Math.round(boxH / 2)
  const stroke = topLight ? SATIN_PILL_STROKE_LIGHT : SATIN_PILL_STROKE_DARK
  const fg = topLight ? SATIN_PILL_INK_LIGHT : SATIN_PILL_INK_DARK
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(quality, font)}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="${fg}"${textFitAttrs(textW)}>${escSvg(quality)}</text>`
  const defs = `<defs><linearGradient id="qg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#qg)" stroke="${stroke}" stroke-width="${SATIN_PILL_STROKE_WIDTH}" filter="url(#tds)"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

/**
 * White knockout tag for the `knockout` quality style: opaque white
 * rounded tag (contained radius, not a full pill) with the tier glyphs cut
 * out via SVG mask, so the poster shows through the letters. The tag box
 * keeps the standard pill metrics (same totalW/boxH from the base `fs`),
 * while the mask glyphs render at ~1.35x `fs` to fill the interior with
 * small anti-clipping margins. With `targetW` (group column) the visible box
 * is pinned to the canonical 4K width and the box font is reduced to fit the
 * label (`fitBadgeGlyphFs`), so the same tag recipe serves every tier without
 * changing the column band. The shared translucent 3D shadow stays on the
 * masked rect (hole edges only) plus a LIGHT outer ring from
 * `knockoutOuterShadow`, strictly outside the tag box. The cut-out letters
 * carry the `KNOCKOUT_INK_OPACITY` black ink drawn OVER the artwork that
 * shows through them: the glyph reads as stable dark ink while keeping a 30%
 * artwork contribution (no stroke, no opaque fill that would hide the poster).
 */
export function buildQualityKnockoutSvg(
  quality: string,
  fs: number,
  font: BadgeFont = "inter",
  /** Fixed visible box width (group column); absent = natural width. */
  targetW?: number,
) {
  const { glyphFs, totalW, boxH } = badgeTextBox(quality, fs, BADGE_BOX_PAD_X_FACTOR, font, targetW)
  // Contained rounded-rectangle radius (reference look), not a full pill.
  const r = Math.round(boxH * 0.30)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const cx = ox + totalW / 2
  const cy = oy + boxH / 2
  const family = fontFamilyFor(quality, font)
  // Oversized mask glyphs inside the unchanged box: more ink width/height
  // than the box font, clamped to the interior with a small margin so
  // resvg never clips (all tiers/fonts).
  const maskFs = Math.round(glyphFs * 1.35)
  const maskTrack = quality.length > 1 ? Math.round(BADGE_TEXT_TRACK_FACTOR * maskFs * (quality.length - 1)) : 0
  const maskNatural = Math.max(estimateTextWidth(quality, maskFs, font) + maskTrack, maskFs)
  const maskMargin = Math.max(2, Math.round(glyphFs * 0.15))
  const maskTextW = Math.min(maskNatural, Math.max(totalW - maskMargin * 2, maskFs))
  const fit = textFitAttrs(maskTextW)
  const shadow = knockoutOuterShadow("qko", renderW, renderH, { x: ox, y: oy, w: totalW, h: boxH, r })
  // One glyph geometry feeds BOTH the mask (black = hole) and the ink layer:
  // any drift between the two would leave an ink fringe on the white body or
  // an un-inked hole.
  const glyphAttrs = `x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="700" font-size="${maskFs}" letter-spacing="0.06em"${fit}`
  const defs = `<defs><mask id="qkm"><rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="#ffffff"/><text ${glyphAttrs} fill="#000000">${escSvg(quality)}</text></mask>${shadow.defs}${TOP_SHADOW_FILTER}${KNOCKOUT_SHADOW_FILTER}</defs>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="#ffffff" mask="url(#qkm)" filter="url(#tds)"/>`
  // Ink above the masked tag: inside the cut-outs the white body is
  // transparent, so a group-opacity layer composites 70% black over the
  // artwork instead of over the white tag.
  const inkEl = `<g opacity="${KNOCKOUT_INK_OPACITY}"><text ${glyphAttrs} fill="#000000">${escSvg(quality)}</text></g>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${shadow.layer}${bgEl}${inkEl}</svg>`, w: renderW, h: renderH }
}

/**
 * Horizontal padding of the age `knockout` tag (sober alternative style,
 * age ONLY): roomier than the shared quality builder for long labels
 * (VM14/PG-13/TV-MA).
 */
export const AGE_KNOCKOUT_PAD_X_FACTOR = 1.0

/** Contained radius of the age `knockout` tag (sober rectangle, not a pill). */
export const AGE_KNOCKOUT_RADIUS_FACTOR = 0.30

/** Opaque white body of the age `knockout` tag (the glyphs are cut out —
 *  the body itself is never transparent). */
export const AGE_KNOCKOUT_BG = "#ffffff"

/**
 * White knockout tag for the age `knockout` style (age ONLY — never the
 * quality path): opaque white rounded rectangle with the label glyphs cut
 * out via SVG mask, so the poster shows through the letters — same white
 * mask/cut-out construction as the shared quality tag, but WITHOUT its
 * `KNOCKOUT_INK_OPACITY` ink layer. Unlike the shared quality
 * builder, the mask glyphs render at the normal box `fs` (no 1.35x
 * oversize) and the box is roomier (`1.0 × fs` padding, contained `0.30 ×
 * boxH` radius), so long labels (VM14/PG-13/TV-MA) keep breathing room.
 * With `targetW` (group column) the visible box is pinned to the canonical
 * 4K width: the glyph font is reduced to fit (`fitBadgeGlyphFs`) instead of
 * squeezing or stretching the letters, while height/radius stay those of
 * the base `fs`. Without `targetW` the natural box/history is unchanged.
 * Same 17px base, box height, tracking (`0.06em` technical-mark kerning,
 * `textLength` pinned on estimate + tracking), font metrics
 * (`fontFamilyFor` / `estimateTextWidth`), escaping (`escSvg`) and
 * shadow/padding geometry as the shared quality knockout, so
 * scale/offset/anchor math downstream is unchanged. No stroke, no gradient
 * — only the shared 3D shadow, like the quality knockout. The shared
 * `buildQualityKnockoutSvg` is a separate builder (quality tier and A/V
 * marks now add their own 70% ink layer), so the age cut-outs stay
 * genuinely transparent here.
 * The transparent lettering is intentional (accepted tradeoff on bright
 * artwork): never add opaque text or contrast-adaptation fallbacks here.
 */
export function buildAgeKnockoutSvg(
  label: string,
  fs: number,
  font: BadgeFont = "inter",
  /** Fixed visible box width (group column); absent = natural width. */
  targetW?: number,
) {
  const { glyphFs, textW, totalW, boxH } = badgeTextBox(label, fs, AGE_KNOCKOUT_PAD_X_FACTOR, font, targetW)
  const r = Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const cx = ox + totalW / 2
  const cy = oy + boxH / 2
  const family = fontFamilyFor(label, font)
  // Mask glyphs at the (possibly fitted) box font, never oversized: the age
  // box already gives long labels room, so the cut-out stays comfortable with
  // small anti-clipping margins (same margin rule as the quality builder).
  const maskMargin = Math.max(2, Math.round(glyphFs * 0.15))
  const maskTextW = Math.min(textW, Math.max(totalW - maskMargin * 2, glyphFs))
  const fit = textFitAttrs(maskTextW)
  const defs = `<defs><mask id="akm"><rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="#ffffff"/><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="#000000"${fit}>${escSvg(label)}</text></mask>${TOP_SHADOW_FILTER}</defs>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${AGE_KNOCKOUT_BG}" mask="url(#akm)" filter="url(#tds)"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}</svg>`, w: renderW, h: renderH }
}

// ---------------------------------------------------------------------------
// Stile `gradient`: glifi extra-bold su una PLACCA scura traslucida. Un solo
// builder per tier (4K/FHD/HD/SD), età (12/PG-13/TV-MA) e marchi A/V
// (DV/ATMOS/IMAX/HDR/HDR10+/combo DV+ATMOS): cambia solo il fill dei glifi —
// bianco pieno per tier ed età, gradiente orizzontale per formato
// (`GRADIENT_MARK_STOPS` in `quality-badge-styles.ts`). Zero asset raster:
// l'etichetta è sempre un parametro di render.
// ---------------------------------------------------------------------------

/** Peso dei glifi `gradient` (extra-bold: è l'unico inchiostro della resa). */
export const GRADIENT_MARK_FONT_WEIGHT = 900

/** Id del gradiente orizzontale dentro l'SVG del singolo marchio (ogni badge
 *  è un documento SVG a sé, rasterizzato separatamente: nessun conflitto). */
export const GRADIENT_MARK_GRADIENT_ID = "gmg"

/**
 * Marchio `gradient`: testo extra-bold su una placca scura traslucida.
 *
 * Geometria CONDIVISA con la colonna qualità/età (`badgeTextBox` +
 * `badgeBoxHeight(fs)` come banda verticale, padding simmetrico
 * `TOP_SHADOW_PAD`, tracking tecnico `0.06em` con `textLength` pinnato sulla
 * stima `textFitAttrs`), così stack/offset/scale/cap e correzioni per-item a
 * valle restano quelli di ogni altro stile. La placca di fondo è un unico
 * `<rect>` col raggio condiviso delle placche A/V
 * (`AV_PLATE_RADIUS_FACTOR`), sempre scuro
 * (`GRADIENT_PLATE_BG`: indipendente da `topLight`, come
 * premium/knockout/nova). L'ombra 3D condivisa (`TOP_SHADOW_FILTER`) avvolge
 * l'intero lockup (placca + testo), come le altre placche. `fill` è un hex
 * solido (tier/età) oppure la lista di stop di un gradiente ORIZZONTALE
 * (`x1="0" y1="0" x2="1" y2="0"`, primo stop a sinistra, ultimo a destra) per
 * i marchi A/V. `targetW` (colonna del gruppo) pinna la banda alla larghezza
 * visibile del 4K riducendo il font (`fitBadgeGlyphFs`), mai stirando i
 * glifi; senza `targetW` resta la larghezza naturale.
 */
export function buildGradientMarkSvg(
  label: string,
  fs: number,
  /** Hex solido oppure stop del gradiente orizzontale. */
  fill: string | readonly string[],
  font: BadgeFont = "inter",
  /** Fixed visible box width (group column); absent = natural width. */
  targetW?: number,
) {
  const { glyphFs, textW, totalW, boxH } = badgeTextBox(label, fs, BADGE_BOX_PAD_X_FACTOR, font, targetW)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const stops = typeof fill === "string" || fill.length === 0 ? null : fill
  // Un array vuoto non è un gradiente valido: si ricade sull'hex passato.
  const ink = stops
    ? `url(#${GRADIENT_MARK_GRADIENT_ID})`
    : typeof fill === "string"
      ? fill
      : "#ffffff"
  const gradDef = stops
    ? `<linearGradient id="${GRADIENT_MARK_GRADIENT_ID}" x1="0" y1="0" x2="1" y2="0">${stops
        .map((stop, i) => `<stop offset="${stops.length > 1 ? Math.round((i * 100) / (stops.length - 1)) : 0}%" stop-color="${stop}"/>`)
        .join("")}</linearGradient>`
    : ""
  const defs = `<defs>${gradDef}${TOP_SHADOW_FILTER}</defs>`
  // Placca scura dietro i glifi (rettangolo arrotondato) col raggio condiviso
  // delle placche A/V, così bordo esterno sulla colonna e glifo dentro valgono
  // anche qui. Bordo hairline della famiglia (`GRADIENT_PLATE_STROKE`, come le
  // placche A/V): lo stroke è centrato sulla path, quindi il rect è inset di
  // metà spessore (0.75px) e il bordo esterno visibile resta ESATTAMENTE sul
  // box storico — footprint invariato, nessuna geometria mossa.
  const plateR = Math.round(boxH * AV_PLATE_RADIUS_FACTOR)
  const plateStrokeW = AV_PLATE_STROKE_WIDTH
  const plateEl = `<rect x="${ox + plateStrokeW / 2}" y="${oy + plateStrokeW / 2}" width="${Math.max(1, totalW - plateStrokeW)}" height="${Math.max(1, boxH - plateStrokeW)}" rx="${plateR}" fill="${GRADIENT_PLATE_BG}" stroke="${GRADIENT_PLATE_STROKE}" stroke-width="${plateStrokeW}"/>`
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, font)}" font-weight="${GRADIENT_MARK_FONT_WEIGHT}" font-size="${glyphFs}" letter-spacing="0.06em" fill="${ink}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  // Un'ombra sola sull'intero lockup (placca + glifi), come le altre placche.
  const bodyEl = `<g filter="url(#tds)">${plateEl}${textEl}</g>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bodyEl}</svg>`, w: renderW, h: renderH }
}

// ---------------------------------------------------------------------------
// `strip`: ONE merged plate for the whole quality group (tier · age · A/V
// marks). Additive layout selected by the `strip` quality style; never a
// second renderer — it reuses the shared box recipe (`badgeTextBox`,
// `badgeBoxHeight`, `fitBadgeGlyphFs`, `TOP_SHADOW_FILTER`) and the plate
// material of the `gradient` family (`GRADIENT_PLATE_BG`/stroke/radius).
//
// Every segment is its own glyph run (one `<text>` per label, `textLength`
// pinned on the shared estimate) joined by a `·` separator drawn at 0.45
// opacity. The whole lockup is a single SVG/raster with ONE 3D shadow filter,
// so the historic 1 bitmap per mark (6 resvg + 6 filters for a full stack)
// collapses to 1 + 1. Segment boxes are returned in bitmap coordinates so the
// per-item report keeps the stable identities (`quality:tier`, `quality:age`,
// `quality:combo:dv-atmos`, `quality:format:<fmt>`) and the existing
// anchor/scale/offset chain.
// ---------------------------------------------------------------------------

/** Separator glyph between strip segments (single source). */
export const QUALITY_STRIP_SEPARATOR = "·"
/** Separator paint opacity (user requirement: 0.45). */
export const QUALITY_STRIP_SEPARATOR_OPACITY = 0.45
/**
 * Lateral plate padding of the strip, as a fraction of the glyph size. Airier
 * than the shared `BADGE_BOX_PAD_X_FACTOR` (0.75): a merged plate needs visible
 * breathing room at both ends, so the border never hugs the first/last glyph.
 * Strip-only — every other badge keeps the shared padding.
 */
export const QUALITY_STRIP_PAD_X_FACTOR = 1.05
/**
 * Max segments on one strip line. Two glyph runs per line keep the plate
 * compact, so a third segment already wraps onto the next, centered line of
 * the SAME plate (`tier · age` / `mark`). Rows are filled row-major two by
 * two, so a wrapped strip reads 2+1, 2+2, 2+2+1, …
 */
export const QUALITY_STRIP_MAX_SEGMENTS_PER_ROW = 2
/** Vertical gap between the two lines of a wrapped strip (fraction of `fs`). */
export const QUALITY_STRIP_ROW_GAP_FACTOR = 0.12

/**
 * Max badges per line in the `row` quality-group layout. Same 2-rule as the
 * merged strip (single source): row-major 2+1, 2+2, 2+2+1 with the shorter
 * last line centred. The `stacked` layout never wraps (one per line).
 */
export const QUALITY_GROUP_ROW_MAX_ITEMS = QUALITY_STRIP_MAX_SEGMENTS_PER_ROW

/** One painted segment box, in the returned bitmap's own coordinates. */
export interface StripBadgeSegmentBox {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

export interface StripBadgeSvgResult {
  readonly svg: string
  readonly w: number
  readonly h: number
  /** One box per non-empty input label, in the same order. */
  readonly segments: readonly StripBadgeSegmentBox[]
}

/**
 * Merged `strip` plate: one dark plate, one glyph run per segment and a `·`
 * at `QUALITY_STRIP_SEPARATOR_OPACITY` between them. Up to
 * `QUALITY_STRIP_MAX_SEGMENTS_PER_ROW` segments share one line; a longer set
 * fills the next, centered line of the SAME plate two by two (row-major: 3 →
 * 2+1, 4 → 2+2, 5 → 2+2+1), so the old single overlong run never happens and
 * the odd last row is centered under the full one (one rect, one shadow
 * filter). `maxW` (optional visible width cap) shrinks the glyph size through
 * `fitBadgeGlyphFs` — never stretch, never clip — while every line keeps the
 * `badgeBoxHeight(fs)` band (the common group band, so the anchor/scale chain
 * is unchanged; every extra row adds one band plus
 * `QUALITY_STRIP_ROW_GAP_FACTOR`).
 */
export function buildStripBadgeSvg(
  labels: readonly string[],
  fs: number,
  font: BadgeFont = "inter",
  maxW?: number,
): StripBadgeSvgResult {
  const texts = labels.map((label) => label.trim()).filter((label) => label !== "")
  const boxH = badgeBoxHeight(fs)
  const limit = maxW != null && maxW > 0 ? Math.round(maxW) : undefined
  /**
   * Segment split: `QUALITY_STRIP_MAX_SEGMENTS_PER_ROW` segments per line,
   * filled row-major (3 → 2+1, 4 → 2+2, 5 → 2+2+1). Identities are never
   * reordered and each row is centered inside the shared plate below.
   */
  const lines = (all: readonly string[]): string[][] => {
    const rows: string[][] = []
    for (let i = 0; i < all.length; i += QUALITY_STRIP_MAX_SEGMENTS_PER_ROW) {
      rows.push(all.slice(i, i + QUALITY_STRIP_MAX_SEGMENTS_PER_ROW))
    }
    return rows.length > 0 ? rows : [[]]
  }
  const measure = (glyphFs: number) => {
    // `badgeTextBox` with padXFactor 0 = natural shared run (tracking and
    // `textLength` estimate); the plate padding is applied ONCE below.
    const sepFs = Math.max(1, Math.round(glyphFs * 0.9))
    const sepW = pinnedBadgeTextWidth(QUALITY_STRIP_SEPARATOR, sepFs, font)
    const sepGap = Math.max(2, Math.round(glyphFs * 0.30))
    // Strip-only airier lateral padding (the shared recipe stays 0.75).
    const padX = Math.round(glyphFs * QUALITY_STRIP_PAD_X_FACTOR)
    const rowGap = Math.max(2, Math.round(glyphFs * QUALITY_STRIP_ROW_GAP_FACTOR))
    const rows = lines(texts).map((row) => {
      const segW = row.map((text) => badgeTextBox(text, glyphFs, 0, font).textW)
      const contentW =
        segW.reduce((sum, w) => sum + w, 0) +
        (row.length > 0 ? (row.length - 1) * (sepW + sepGap * 2) : 0)
      return { texts: row, segW, contentW, w: contentW + padX * 2 }
    })
    const plateW = Math.max(1, ...rows.map((row) => row.w))
    const plateH = rows.length * boxH + (rows.length - 1) * rowGap
    return { rows, sepFs, sepW, sepGap, padX, rowGap, plateW, plateH }
  }
  // Fit the run inside the visible cap. A single line keeps the shared
  // one-label estimate fast path; a wrapped strip starts from the natural
  // size (the joined estimate of two lines would over-shrink) and is trimmed
  // by the bounded loop below.
  let glyphFs =
    texts.length > 0 && texts.length <= QUALITY_STRIP_MAX_SEGMENTS_PER_ROW && limit != null
      ? fitBadgeGlyphFs(texts.join(` ${QUALITY_STRIP_SEPARATOR} `), fs, limit, QUALITY_STRIP_PAD_X_FACTOR, font)
      : fs
  let metrics = measure(glyphFs)
  if (limit != null) {
    for (let guard = 0; metrics.plateW > limit && glyphFs > 4 && guard < 16; guard++) {
      glyphFs -= 1
      metrics = measure(glyphFs)
    }
  }
  const totalW = Math.max(1, metrics.plateW)
  const plateH = Math.max(1, metrics.plateH)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = plateH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const plateR = Math.round(boxH * AV_PLATE_RADIUS_FACTOR)
  const plateStrokeW = AV_PLATE_STROKE_WIDTH
  // Same plate recipe as the `gradient` family: stroke centred on the path,
  // the rect inset by half the width so the visible border sits on the box.
  const plateEl =
    `<rect x="${ox + plateStrokeW / 2}" y="${oy + plateStrokeW / 2}" width="${Math.max(1, totalW - plateStrokeW)}" height="${Math.max(1, plateH - plateStrokeW)}" rx="${plateR}" fill="${GRADIENT_PLATE_BG}" stroke="${GRADIENT_PLATE_STROKE}" stroke-width="${plateStrokeW}"/>`
  const segments: StripBadgeSegmentBox[] = []
  const runs: string[] = []
  metrics.rows.forEach((row, rowIndex) => {
    const rowTop = oy + rowIndex * (boxH + metrics.rowGap)
    const rowCenterY = rowTop + boxH / 2
    // Each line is centred inside the same plate: a shorter second line never
    // hangs off one edge.
    let cursor = ox + Math.round((totalW - row.w) / 2) + metrics.padX
    for (let i = 0; i < row.texts.length; i++) {
      const textW = row.segW[i]
      const text = row.texts[i]
      segments.push({ top: rowTop, left: cursor, w: textW, h: boxH })
      runs.push(
        `<text x="${cursor + textW / 2}" y="${rowCenterY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text, font)}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="#ffffff"${textFitAttrs(textW)}>${escSvg(text)}</text>`,
      )
      cursor += textW
      if (i < row.texts.length - 1) {
        runs.push(
          `<text x="${cursor + metrics.sepGap + metrics.sepW / 2}" y="${rowCenterY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(QUALITY_STRIP_SEPARATOR, font)}" font-weight="700" font-size="${metrics.sepFs}" fill="#ffffff" opacity="${QUALITY_STRIP_SEPARATOR_OPACITY}"${textFitAttrs(metrics.sepW)}>${QUALITY_STRIP_SEPARATOR}</text>`,
        )
        cursor += metrics.sepGap * 2 + metrics.sepW
      }
    }
  })
  const defs = `<defs>${TOP_SHADOW_FILTER}</defs>`
  // ONE 3D shadow for the whole lockup (plate + every glyph run).
  const body = `<g filter="url(#tds)">${plateEl}${runs.join("")}</g>`
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${body}</svg>`,
    w: renderW,
    h: renderH,
    segments,
  }
}

// ---------------------------------------------------------------------------
// Emphasis `mono` / `color` / `premium` / `nova`: the same visual vocabulary as
// the quality tier, applied to the DYNAMIC certification label
// (12/PG-13/TV-MA — no bundled numeric asset, the label is always a parameter).
// `mono` is shared with the quality tier: the quality `mono` tier renders its
// real label (4K/FHD/HD/SD) through this SAME builder, so tier and age can
// never diverge into two mono materials. `nova` is shared the same way with the
// quality tier AND the A/V marks (one dynamic material, zero raster assets).
// `color`/`premium` are age-only.
//
// Geometry is IDENTICAL to the age `knockout` tag for every label (same
// `AGE_KNOCKOUT_PAD_X_FACTOR` padding, `AGE_KNOCKOUT_RADIUS_FACTOR` radius,
// `badgeBoxHeight(fs)` height, base-`fs` glyphs with the shared technical
// tracking), so the top-right stack/offset/scale math and the per-item
// corrections are unchanged across age styles. Colors/frames reuse the
// EXISTING quality palettes (`quality-badge-styles.ts`): no new asset, no
// invented official age color. `standard`/`knockout` never pass through here.
// ---------------------------------------------------------------------------

/** Shared emphasis style family. `mono` is shared by the quality tier/AV
 *  marks, `nova` by the quality tier/AV marks/every age badge (one material,
 *  see below); `color`/`premium` stay age-only; `outline` is shared by the
 *  quality tier, the age badge and every A/V mark (one wireframe material). */
export type AgeEmphasisStyle = "mono" | "color" | "premium" | "nova" | "outline"

/** High-contrast mono ink on a dark top (white, like the mono tier marks). */
export const AGE_MONO_INK_DARK = "#ffffff"

/** High-contrast mono ink on a light top (black, like the mono tier marks). */
export const AGE_MONO_INK_LIGHT = "#000000"

/** Mono frame stroke as a fraction of `fs`: ~7% of the box height, in the
 *  same optical range as the shipped mono tier asset frame (~8%). */
export const AGE_MONO_STROKE_FACTOR = 0.12

/** Minimum mono frame stroke (px): never a sub-pixel hairline at badge sizes. */
export const AGE_MONO_STROKE_MIN = 2

// ---------------------------------------------------------------------------
// `nova`: ONE dynamic material for every tech text badge — quality tier
// (4K/FHD/HD/SD), age certification (12/PG-13/TV-MA) and the A/V marks
// (DV/ATMOS/IMAX/HDR/HDR10+/merged DV+ATMOS). Near-black bluish plate with a
// metallic grey border gradient, an inner top highlight and bold white italic
// glyphs. No raster asset, no CDN, no per-format artwork: the label is always
// a render parameter.
// ---------------------------------------------------------------------------

/** Nova body gradient (top → bottom): near-black with a bluish cast. */
export const AGE_NOVA_BODY_TOP = "#0D1526"
export const AGE_NOVA_BODY_BOTTOM = "#0B1220"

/** Nova metallic border gradient (top-left → bottom-right). */
export const AGE_NOVA_BORDER_TOP = "#D6DCE5"
export const AGE_NOVA_BORDER_BOTTOM = "#6B7280"

/** Border thickness inside the box (px): kept inside so the visible footprint
 *  stays the age-family box. */
export const AGE_NOVA_BORDER_WIDTH = 1.5

/** Glyph fill (bold white, polarity-independent). */
export const AGE_NOVA_INK = "#ffffff"

/** Italic look: skewX in degrees, around the text centre (no new font file). */
export const AGE_NOVA_SKEW_X = -8

/** Inner top highlight (sheen) of the plate: white fade over the upper band. */
export const AGE_NOVA_HIGHLIGHT_TOP = 0.16
export const AGE_NOVA_HIGHLIGHT_END = 55

// ---------------------------------------------------------------------------
// `outline` (wireframe): the SAME dynamic material for quality tier, age badge
// and every A/V mark. A stroked rounded rect with no fill, an inner contrast
// scrim (so the glyphs stay readable on busy artwork) and satin-pill ink
// glyphs. No raster asset, no per-format artwork: the label is a parameter.
// ---------------------------------------------------------------------------

/** Outline stroke on a LIGHT top (dark wireframe, like the satin pill rule). */
export const AGE_OUTLINE_STROKE_LIGHT = "rgba(0,0,0,0.62)"
/** Outline stroke on a DARK top (light wireframe). */
export const AGE_OUTLINE_STROKE_DARK = "rgba(255,255,255,0.72)"
/** Stroke width as a fraction of `fs` (grows with the badge). */
export const AGE_OUTLINE_STROKE_FACTOR = 0.09
/** Minimum outline stroke (px): never a sub-pixel hairline at badge sizes. */
export const AGE_OUTLINE_STROKE_MIN = 1.5
/** Inner scrim on a LIGHT top (dark protective veil under the white ink). */
export const AGE_OUTLINE_SCRIM_LIGHT = "rgba(0,0,0,0.22)"
/** Inner scrim on a DARK top (light protective veil under the dark ink). */
export const AGE_OUTLINE_SCRIM_DARK = "rgba(255,255,255,0.26)"

/**
 * Emphasis tag (`mono`/`color`/`premium`/`nova`). One shared recipe:
 * the box is the age family box (byte-identical footprint to the age
 * knockout), only the ink/plate changes (`mono`/`nova` are ALSO the quality
 * tier material — see below):
 *
 * - `mono`: bare monochrome frame + glyphs in high-contrast white/black by
 *   top polarity, NO satin fill/plate. This is the SINGLE mono material: the
 *   quality `mono` tier renders its real label (4K/FHD/HD/SD) through the
 *   same builder, so tier and age can never diverge.
 * - `color`: yellow glyph (`COLOR_MARK_GLYPH`) on the dark tier plate with
 *   the yellow tier border (`COLOR_MARK_PLATE_*`, palette sampled from the
 *   shipped `quality-badges/color` tier asset).
 * - `premium`: gold design accent (`premiumAccentHex("gold")`) on the compact
 *   neutral dark premium plate (`PREMIUM_PLATE_*`).
 * - `nova`: near-black bluish body, metallic grey border gradient, inner top
 *   highlight and bold white glyphs with a `skewX` italic feel. Polarity
 *   independent (the plate is always dark). This is the SINGLE Nova material:
 *   the quality tier (4K/FHD/HD/SD) and every A/V mark (DV/ATMOS/IMAX/HDR/
 *   HDR10+/merged DV+ATMOS) render their real label through this same branch,
 *   so tier, age and formats can never diverge into two Nova looks.
 * - `outline`: wireframe rounded rect with `fill="none"`, a polarity-adaptive
 *   stroke (`AGE_OUTLINE_STROKE_*`, width `max(1.5, 0.09 × fs)`) and an inner
 *   contrast scrim (`AGE_OUTLINE_SCRIM_*`) under satin-pill ink glyphs. Also
 *   the SINGLE wireframe material for the quality tier and every A/V mark.
 *
 * Plate borders stay INSIDE the box (shared AV plate rule) so the visible
 * footprint is the same as the age knockout for the same label. With
 * `targetW` (group column) the box is pinned to the canonical 4K width and
 * long labels reduce the glyph font (`fitBadgeGlyphFs`) instead of growing
 * the column; height/radius remain those of the base `fs`. Without `targetW`
 * the box still grows with the pinned text estimate (standalone history).
 * Only the shared 3D shadow is applied (`TOP_SHADOW_FILTER`).
 */
export function buildAgeEmphasisSvg(
  label: string,
  fs: number,
  style: AgeEmphasisStyle,
  topLight: boolean = false,
  font: BadgeFont = "inter",
  /** Fixed visible box width (group column); absent = natural width. */
  targetW?: number,
) {
  const { glyphFs, textW, totalW, boxH } = badgeTextBox(label, fs, AGE_KNOCKOUT_PAD_X_FACTOR, font, targetW)
  // Age family radius: same contained rectangle as the age knockout tag.
  const r = Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const cx = ox + totalW / 2
  const cy = oy + boxH / 2
  const family = fontFamilyFor(label, font)
  if (style === "nova") {
    // Metal ring (border gradient) under a near-black body, a soft top sheen
    // for depth, then the white italic glyph run: one shadow over the lockup.
    // No stroke on the body (the ring IS the border) and no raster artwork.
    const bw = AGE_NOVA_BORDER_WIDTH
    const innerW = Math.max(1, totalW - bw * 2)
    const innerH = Math.max(1, boxH - bw * 2)
    const innerR = Math.max(0, r - bw)
    const defs = `<defs><linearGradient id="anvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${AGE_NOVA_BODY_TOP}"/><stop offset="100%" stop-color="${AGE_NOVA_BODY_BOTTOM}"/></linearGradient><linearGradient id="anbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${AGE_NOVA_BORDER_TOP}"/><stop offset="100%" stop-color="${AGE_NOVA_BORDER_BOTTOM}"/></linearGradient><linearGradient id="anvh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="${AGE_NOVA_HIGHLIGHT_TOP}"/><stop offset="${AGE_NOVA_HIGHLIGHT_END}%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>${TOP_SHADOW_FILTER}</defs>`
    const borderEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#anbg)"/>`
    const bodyEl = `<rect x="${ox + bw}" y="${oy + bw}" width="${innerW}" height="${innerH}" rx="${innerR}" fill="url(#anvg)"/>`
    const sheenEl = `<rect x="${ox + bw}" y="${oy + bw}" width="${innerW}" height="${innerH}" rx="${innerR}" fill="url(#anvh)"/>`
    // Italic feel without a new font: the run is skewed around its own centre,
    // so the label stays optically centred. The age-family padding (~1.0 × fs
    // per side) is far larger than the skew displacement at any size → the
    // glyphs never clip the plate.
    const textEl = `<g transform="translate(${cx} ${cy}) skewX(${AGE_NOVA_SKEW_X}) translate(${-cx} ${-cy})"><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="${AGE_NOVA_INK}"${textFitAttrs(textW)}>${escSvg(label)}</text></g>`
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<g filter="url(#tds)">${borderEl}${bodyEl}${sheenEl}${textEl}</g></svg>`,
      w: renderW,
      h: renderH,
    }
  }
  if (style === "outline") {
    // Wireframe material: a stroked rounded rect with NO fill (stroke centered
    // on the path and kept inside the box, so the visible footprint is the
    // age family box), an inner contrast scrim that protects the glyphs from
    // busy artwork and satin-pill ink glyphs (same polarity rule as the
    // `standard` pill: light top → dark scrim + white ink, dark top → light
    // scrim + dark ink). One shadow over the whole lockup.
    const sw = Math.max(AGE_OUTLINE_STROKE_MIN, Math.round(fs * AGE_OUTLINE_STROKE_FACTOR))
    const stroke = topLight ? AGE_OUTLINE_STROKE_LIGHT : AGE_OUTLINE_STROKE_DARK
    const scrim = topLight ? AGE_OUTLINE_SCRIM_LIGHT : AGE_OUTLINE_SCRIM_DARK
    const ink = topLight ? SATIN_PILL_INK_LIGHT : SATIN_PILL_INK_DARK
    const outerX = ox + sw / 2
    const outerY = oy + sw / 2
    const outerW = Math.max(1, totalW - sw)
    const outerH = Math.max(1, boxH - sw)
    const innerX = ox + sw
    const innerY = oy + sw
    const innerW = Math.max(1, totalW - sw * 2)
    const innerH = Math.max(1, boxH - sw * 2)
    const innerR = Math.max(0, r - sw)
    const frameEl = `<rect x="${outerX}" y="${outerY}" width="${outerW}" height="${outerH}" rx="${r}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`
    const scrimEl = `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="${innerR}" fill="${scrim}"/>`
    const textEl = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="${ink}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}"><defs>${TOP_SHADOW_FILTER}</defs><g filter="url(#tds)">${frameEl}${scrimEl}${textEl}</g></svg>`,
      w: renderW,
      h: renderH,
    }
  }
  const monoInk = topLight ? AGE_MONO_INK_LIGHT : AGE_MONO_INK_DARK
  const plateBg = style === "color" ? COLOR_MARK_PLATE_BG : PREMIUM_PLATE_BG
  const plateStroke = style === "color" ? COLOR_MARK_PLATE_STROKE : PREMIUM_PLATE_STROKE
  const glyphFill = style === "color"
    ? COLOR_MARK_GLYPH
    : style === "premium"
      ? premiumAccentHex("gold")
      : monoInk
  const textEl = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-weight="700" font-size="${glyphFs}" letter-spacing="0.06em" fill="${glyphFill}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  // Border stroke centered on the path is kept INSIDE the box (same rule as
  // the AV plates): the visible outer edge lands on the age family box.
  const strokeW = style === "mono" ? Math.max(AGE_MONO_STROKE_MIN, Math.round(fs * AGE_MONO_STROKE_FACTOR)) : AV_PLATE_STROKE_WIDTH
  const rectW = Math.max(1, totalW - strokeW)
  const rectH = Math.max(1, boxH - strokeW)
  const rectX = ox + strokeW / 2
  const rectY = oy + strokeW / 2
  const shapeEl = style === "mono"
    ? `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${r}" fill="none" stroke="${monoInk}" stroke-width="${strokeW}"/>`
    : `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${r}" fill="${plateBg}" stroke="${plateStroke}" stroke-width="${strokeW}"/>`
  // One shadow over the whole lockup (frame/plate + glyphs), like the plates.
  const bodyEl = `<g filter="url(#tds)">${shapeEl}${textEl}</g>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}"><defs>${TOP_SHADOW_FILTER}</defs>${bodyEl}</svg>`, w: renderW, h: renderH }
}

// --- Color helpers (shared native recipes) ---

/** `#RGB/#RRGGBB/#RRGGBBAA` + opacity 0-100 → `rgba(...)` deterministico. */
export function presetHexToRgba(hex: string, opacityPct: number): string {
  let h = hex.replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const hexAlpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  const a = Math.min(Math.max(hexAlpha * (opacityPct / 100), 0), 1)
  const as = String(Math.round(a * 1000) / 1000)
  return `rgba(${r},${g},${b},${as})`
}

// --- House badge dispatch (single source of truth) ---------------------------
// Pure SVG builders for the real poster styles. The server selectors in
// svg-badge.ts delegate here (plus resvg): native preview and Stremio poster
// share the same recipe and cannot diverge.

/**
 * Testo adattivo dei badge traslucidi (vetro/bordo): stesso bianco del badge
 * genere (vedi nota in svg-badge.ts).
 */
export const TRANSLUCENT_BADGE_TEXT = "#e5e7eb"

export interface HouseGenreInput {
  readonly genreName: string
  readonly voteStr: string
  readonly yearStr: string
  readonly pw: number
  readonly style?: BadgeStyle
  readonly accentColor?: string
  readonly bottomLight?: boolean
  readonly parts?: GenreParts
  /** Scala % applicata al font solo per lo stile barra (gli altri scalano via bitmap nel service). */
  readonly scale?: number
  /** Dimensione font assoluta (px su griglia 380; senza = base 28.6 della ricetta). */
  readonly fontSize?: number
  /** Fill testo esplicito (rgba già risolto; senza = adattivo della ricetta). */
  readonly textColor?: string
  /** Opacità 0-100 sul fill finale (ricetta o override; senza = ricetta). */
  readonly textOpacity?: number
  /** Font dei testi (default "inter" = resa storica). */
  readonly font?: BadgeFont
}

export function buildHouseGenreSvg(input: HouseGenreInput): { svg: string; w: number; h: number } {
  const { genreName, voteStr, yearStr, pw, accentColor, parts } = input
  const s = input.style || "shadow"
  const scale = input.scale ?? 100
  const bottomLight = input.bottomLight
  const font = normalizeBadgeFont(input.font)
  // Base 28.6px (+30% scala nativa): resa bilanciata e leggibile, lo slider `gscale` parte da 100.
  // (La compattezza di pill/colored vive nel padding di buildGenrePillSvg, mai nel font.)
  let finalFs = (input.fontSize ?? 28.6) * pw / 380
  // Barra full-width: vedi nota in buildExtraBadgeSVG.
  if (s === "bar") finalFs = (finalFs * scale) / 100
  const aestheticMaxW = Math.round(pw * 0.86) // 86% per margine estetico
  const isMinimal = s === "minimal"
  let dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, s, font)
  let safePad = genreBadgeSafePad(finalFs)
  // Per shadow, ink e minimal, il builder aggiunge shadowPad*2 al renderW finale
  const extraShadowPad = s === "shadow" || s === "ink" ? 8 : (isMinimal ? 2 : 0)
  const estimatedRenderW = dims.totalW + safePad * 2 + extraShadowPad * 2
  if (estimatedRenderW > aestheticMaxW) {
    finalFs = Math.max(aestheticMaxW / estimatedRenderW * finalFs, 10)
    dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, s, font)
    safePad = genreBadgeSafePad(finalFs)
  }

  const isPillStyle = s === "pill" || s === "colored"
  if (isPillStyle) {
    // Cap anti-sprawl sulla larghezza totale della pill (stesso padX del
    // builder, zero safePad): il bound resta sul totale textContentW + padX*2.
    // Itera al massimo 3 volte (converge subito).
    const maxPillW = genrePillMaxW(pw)
    for (let i = 0; i < 3; i++) {
      const _padX = Math.round(finalFs * GENRE_PILL_PAD_X_FACTOR)
      const _dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, undefined, font)
      const total = _dims.textContentW + _padX * 2
      // Margine 4px: il builder arrotonda per eccesso rispetto alla stima.
      if (total + 4 <= maxPillW) break
      finalFs = Math.max((maxPillW - 4) / total * finalFs, 10)
    }
    dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, undefined, font)
    safePad = genreBadgeSafePad(finalFs)
  }
  let fs = Math.round(finalFs)
  const isPill = s === "pill" || s === "colored"
  const isBar = s === "bar"

  const isTranslucent = s === "vetro" || s === "bordo"
  const recipeText = s === "colored"
    ? textColorForBg(accentColor || "")
    : isTranslucent
      ? (bottomLight ? "rgba(0,0,0,0.80)" : TRANSLUCENT_BADGE_TEXT)
      : (isPill
        // Pill satinata: stesso alto contrasto di bar/quality/ranking-default
        // (su fondo chiaro la pill diventa grafite → testo chiaro).
        ? (bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
        : TRANSLUCENT_BADGE_TEXT)
  const textColorRaw = input.textColor ?? recipeText
  const textColor = input.textOpacity !== undefined ? applyFillOpacity(textColorRaw, input.textOpacity) : textColorRaw
  const bgColor = s === "colored"
    ? (accentColor && accentColor !== "#555555" ? accentColor : "rgba(255,255,255,0.80)")
    : (isPill ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")

  let result: { svg: string; w: number; h: number }
  if (s === "bordo") {
    // Stella: sul corpo milky (banda chiara) l'oro annega → inchiostro testo.
    result = buildGenreBorderedSvg(genreName, voteStr, yearStr, fs, textColor, bottomLight ?? false, 0, parts, starInkFor(bottomLight, s, textColor), font)
  } else if (s === "vetro") {
    result = buildGenreGlassSvg(genreName, voteStr, yearStr, fs, textColor, bottomLight ?? false, 0, parts, starInkFor(bottomLight, s, textColor), font)
  } else if (isBar) {
    // Barra genere: testo ad alto contrasto polarizzato sul fondo (come pill).
    const barText = input.textColor ?? (bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
    const barTextFinal = input.textOpacity === undefined ? barText : applyFillOpacity(barText, input.textOpacity)
    // Barra satinata: polarità invertita (`satinPillStops`), la stella segue il
    // contenitore effettivo (barra chiara su banda scura → inchiostro testo).
    result = buildGenreBarSvg(genreName, voteStr, yearStr, pw, fs, barTextFinal, !!bottomLight, 0, parts, starInkFor(bottomLight, s, barTextFinal), font)
  } else if (isPill) {
    // colored: tinta piatta (niente satinatura); pill: satinatura polare.
    // Stella: la pill satinata usa la stessa polarita della barra
    // (`satinPillStops(bottomLight)`), quindi inchiostro testo sul contenitore
    // chiaro e oro sul grafite. colored resta invariata: su accent caldo
    // (oro/ambra) la stella oro annega, fallback in colore testo.
    const useSatin = s !== "colored"
    const starFill = s === "pill"
      ? starInkFor(bottomLight, "bar", textColor)
      : (s === "colored" && accentColor && isWarmGoldAccent(accentColor) ? textColor : undefined)
    result = buildGenrePillSvg(genreName, voteStr, yearStr, fs, bgColor, textColor, 0, parts, !!bottomLight, useSatin, starFill, font)
  } else {
    // Testo nudo: `shadow`/`minimal` (buildGenreTextSvg) e `ink`
    // (buildGenreInkSvg: accento in gradiente + alone, stessa geometria).
    // L'accento arriva dallo stesso input di `colored` (pipeline per-banda
    // `adaptiveAccentHexForBand`, risolta dal service); senza accento la resa
    // ink resta tipografica nell'inchiostro di ricetta. Nessuna placca/bordo.
    // Stella ink: off-white minimale (adattata sul fondo chiaro), mai oro.
    const inkStarFill = inkStarInkFor(bottomLight, textColor)
    const buildBare = (size: number) => s === "ink"
      ? buildGenreInkSvg(genreName, voteStr, yearStr, size, accentColor, textColor, 0, parts, font, inkStarFill)
      : buildGenreTextSvg(genreName, voteStr, yearStr, size, textColor, s, 0, parts, font)
    result = buildBare(fs)
    // Per shadow/ink il renderW include shadowPad*2 + safePad*2 aggiuntivi
    // Assicuriamoci che non superi aestheticMaxW
    let attempts = 0
    // Max 3 rebuild (come la pill): la pre-shrink qui sopra porta già la
    // larghezza vicino al target, quindi 3 iterazioni bastano e convergono.
    while (result.w > aestheticMaxW && attempts < 3) {
      // Riduciamo fs proporzionalmente al surplus
      const targetFs = Math.max(Math.round(fs * (aestheticMaxW - 16) / result.w), 10)
      if (targetFs >= fs) { fs = 10 } else { fs = targetFs }
      result = buildBare(fs)
      attempts++
    }
  }
  return result
}

// Testo sotto il numero del nastro Netflix. Per gli anime è l'etichetta fissa
// "anime" (stessa del passato); per film/serie è l'etichetta del rank (es.
// "Oggi", "Today") — stesso sistema del badge anime esteso a tutti i rank.
function netflixSubLabel(isAnime: boolean | undefined, label: string | undefined): string {
  if (label !== undefined) return label
  return isAnime ? "anime" : ""
}

export function buildNetflixRankBadgeSVG(rank: number, pw: number, topLight: boolean, side: "left" | "right" = "left", isAnime?: boolean, label?: string, accentColor?: string, opts?: { fontSize?: number; textColor?: string; font?: BadgeFont }) {
  // Default ribbon size: previous 27.6px base + 10%, with proportional geometry.
  // fontSize override assoluto (px su griglia 380, dai preset house).
  const fs = opts?.fontSize !== undefined
    ? Math.max(Math.round(opts.fontSize * pw / 380), 8)
    : Math.round(Math.max(24 * 1.15 * 1.10 * pw / 380, 16))
  const w = Math.round(fs * 2.65)
  // Sottotitolo presente (anime o film/serie con etichetta): nastro allungato
  // verso il basso (h × 1.65) per dare pieno respiro alla scritta sopra la V.
  const subLabel = netflixSubLabel(isAnime, label)
  const hasSub = subLabel.length > 0
  // An explicit empty label hides the subtitle while preserving the full ribbon.
  const h = Math.round(w * (hasSub || label === "" ? 1.65 : 1.35))
  const slant = Math.round(w * 0.12)
  const topFs = Math.round(w * 0.25)
  const isDoubleDigit = rank >= 10
  const rankFs = Math.round(w * (isDoubleDigit ? 0.48 : 0.54))
  const rankLetterSpacing = isDoubleDigit ? "-1" : "0"
  const padRight = Math.round(fs * 0.4)
  const padBottom = Math.round(fs * 0.4)
  const totalW = w + padRight
  const totalH = h + padBottom

  const ribbonMidX = w / 2
  const ribbonVNotchY = Math.round(h * 0.90)

  // Sottotitolo sotto il numero: calcolato sulla larghezza reale del trapezio alla base
  // (w - slant) con margine di sicurezza interno (0.82) per evitare qualsiasi sbordatura.
  let subFs = Math.round(w * 0.19)
  if (hasSub) {
    const maxSubW = Math.round((w - slant) * 0.82)
    const subW = estimateTextWidth(subLabel, subFs, opts?.font)
    if (subW > maxSubW) {
      subFs = Math.max(Math.round(subFs * maxSubW / subW), 8)
    }
  }

  // TOP, numero e sottotitolo impilati
  const topY = Math.round(h * (hasSub ? 0.20 : label === "" ? 0.30 : 0.26))
  const textGap = hasSub ? Math.round(Math.min(topFs, subFs) * 0.25) : 0
  const rankY = hasSub
    ? topY + Math.round(topFs / 2) + textGap + Math.round(rankFs / 2)
    : Math.round(h * 0.60)
  const subY = hasSub
    ? Math.round((rankY + Math.round(rankFs / 2) + ribbonVNotchY) / 2)
    : 0

  const isColored = !!(accentColor && accentColor !== "#555555")
  const fill = isColored ? accentColor : "url(#nrg)"
  const recipeText = isColored
    ? textColorForBg(accentColor)
    : (topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")
  const textColor = opts?.textColor ?? recipeText
  const ribbonStroke = isColored
    ? (textColor === "#ffffff" ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)")
    : (topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)")
  const textFilter = isColored && textColor !== "#ffffff" ? "" : 'filter="url(#textShadow)"'

  // Nastro top-left (side="left", default): ancorato al bordo sinistro del poster,
  // lato sinistro dritto e destro inclinato. Modalità Stremio (side="right"): nastro
  // specchiato orizzontalmente, ancorato al bordo destro — lato destro dritto e
  // sinistro inclinato, con il pad (ombra) spostato a sinistra e ombra che cade a sinistra.
  const isRight = side === "right"
  const pathD = isRight
    ? `M ${totalW} 0 L ${padRight} 0 L ${padRight + slant} ${h} L ${totalW - ribbonMidX} ${ribbonVNotchY} L ${totalW} ${h} Z`
    : `M 0 0 L ${w} 0 L ${w - slant} ${h} L ${ribbonMidX} ${ribbonVNotchY} L 0 ${h} Z`
  const highlightX1 = isRight ? padRight : 0
  const highlightX2 = isRight ? totalW : w
  const textX = isRight ? totalW - ribbonMidX : ribbonMidX
  const shadowDx = isRight ? -3 : 3

  const subEl = hasSub
    ? `<text x="${textX}" y="${subY}" fill="${textColor}" font-family="${fontFamilyFor(subLabel, opts?.font)}" font-weight="700" font-size="${subFs}" text-anchor="middle" dominant-baseline="central"${textFilter ? ` ${textFilter}` : ""}>${escSvg(subLabel)}</text>`
    : ""

  const gradDef = isColored ? "" : `<linearGradient id="nrg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
    <defs>
      ${gradDef}
      <filter id="shadow3D" x="-20%" y="-20%" width="180%" height="180%">
        <feDropShadow dx="${shadowDx}" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.65"/>
      </filter>
      <filter id="textShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="${shadowDx > 0 ? 0 : -1.5}" dy="1.5" stdDeviation="1" flood-color="#000000" flood-opacity="0.65"/>
      </filter>
    </defs>
    <path d="${pathD}" fill="${fill}" stroke="${ribbonStroke}" stroke-width="1" filter="url(#shadow3D)"/>
    <line x1="${highlightX1}" y1="1" x2="${highlightX2}" y2="1" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    <text x="${textX}" y="${topY}" fill="${textColor}" font-family="${fontFamilyFor("TOP", opts?.font)}" font-weight="800" font-size="${topFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="1"${textFilter ? ` ${textFilter}` : ""}>TOP</text>
    <text x="${textX}" y="${rankY}" fill="${textColor}" font-family="${fontFamilyFor(String(rank), opts?.font)}" font-weight="900" font-size="${rankFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="${rankLetterSpacing}"${textFilter ? ` ${textFilter}` : ""}>${rank}</text>
    ${subEl}
  </svg>`
  return { svg, w: totalW, h: totalH }
}

export interface HouseRankingInput {
  readonly rank: number
  readonly label?: string
  readonly pw: number
  readonly topLight?: boolean
  readonly style?: RankingBadgeStyle
  readonly accentColor?: string
  readonly side?: "left" | "right"
  readonly isAnime?: boolean
  /** Placca fluttuante con 4 angoli raccordati (badge staccato dal top via toy). */
  readonly detached?: boolean
  /**
   * Nastro top per lo style `colored` (Task P parity gap #1): `false` = placca
   * piatta con tinta accent (nativo `colored`+ribbon OFF via `accentFill`),
   * absent/true = nastro (legacy behavior, storico). Altri stili lo ignorano.
   */
  readonly ribbon?: boolean
  /** Dimensione font assoluta (px su griglia 380; senza = base 30 della ricetta). */
  readonly fontSize?: number
  /** Fill testo esplicito (rgba già risolto; senza = adattivo della ricetta). */
  readonly textColor?: string
  /** Opacità 0-100 sul fill finale (ricetta o override; senza = ricetta). */
  readonly textOpacity?: number
  /**
   * Riempimento piatto con l'accent sul badge default centrato (degrado del
   * "colored" a nastro disattivato): senza nastro deve colorare il badge
   * default. Ininfluente sugli altri stili e col nastro attivo.
   */
  readonly accentFill?: boolean
  /** Font dei testi (default "inter" = resa storica). */
  readonly font?: BadgeFont
}

export function buildHouseRankingSvg(input: HouseRankingInput): { svg: string; w: number; h: number } {
  const { rank, pw, topLight, accentColor, side, isAnime } = input
  const s = input.style || "default"
  const detached = input.detached ?? false
  const font = normalizeBadgeFont(input.font)
  const periodText = input.label || "Oggi"
  const fullText = `#${rank} ${periodText}`
  const maxBadgeW = pw - 20
  // Base 30px: placca visibile in alto, lo slider `topBadgeScale` parte da 100.
  let finalFs = (input.fontSize ?? 30) * pw / 380
  const projectedW = estimateTextWidth(fullText, finalFs, font) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
  if (projectedW > maxBadgeW) {
    finalFs = Math.max(maxBadgeW / projectedW * finalFs, 10)
  }

  const fs = Math.round(finalFs)
  const isColored = s === "colored"
  const ribbonOn = input.ribbon ?? true
  // Legacy `netflix-color` is ribbon-SHAPED for the anchor
  // (`isRibbonRankingStyle` in badge-styles.ts: poster-service anchors it flush
  // to the poster edge and sizes it with the ribbon width) and reads Standard
  // (satin, no accent) in the UI (`resolveRibbonVariant`). It must therefore
  // render the same satin ribbon as `netflix`: with the old exclusion the
  // centered default plate was glued to the left edge (render/anchor mismatch).
  // Stored values are never migrated.
  const isRibbon = s === "netflix" || s === "netflix-color" || (isColored && ribbonOn)
  const coloredBg = isColored && accentColor && accentColor !== "#555555" ? accentColor : undefined
  const bg = coloredBg || (topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)")
  const recipeFg = isColored
    ? textColorForBg(accentColor || "")
    : (s === "vetro" || s === "bordo")
      ? (topLight ? "rgba(0,0,0,0.80)" : TRANSLUCENT_BADGE_TEXT)
      : (topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
  const rawFg = input.textColor ?? recipeFg
  const fg = input.textOpacity !== undefined ? applyFillOpacity(rawFg, input.textOpacity) : rawFg

  if (isRibbon) {
    // Il nastro mostra l'etichetta sotto il numero: per gli anime è "anime",
    // per film/serie è il periodo del rank (es. "Oggi") — stesso sistema.
    // Se lo stile è "colored", il nastro prende l'accentColor.
    const ribbonAccent = isColored ? coloredBg : undefined
    return buildNetflixRankBadgeSVG(rank, pw, !!topLight, side, isAnime, input.label ?? periodText, ribbonAccent, {
      fontSize: input.fontSize,
      textColor: input.textOpacity === undefined ? input.textColor : applyFillOpacity(input.textColor ?? (ribbonAccent ? textColorForBg(ribbonAccent) : (topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")), input.textOpacity),
      font,
    })
  } else if (s === "split") {
    // Flat two-tone chip (single shared builder): accent cell with the rank
    // numeral + satin cell with the period label. Centered anchor, flush top
    // (like the default plate); `detached` rounds all four corners.
    return buildSplitChipSvg({
      numeral: String(rank),
      label: periodText,
      fs,
      accentColor,
      topLight: !!topLight,
      detached,
      font,
      textColor: fg,
      maxWidth: maxBadgeW,
    })
  } else if (s === "pill") {
    return buildRankingPillSvg(fullText, fs, fg, bg, !!topLight, true, font)
  } else if (s === "corner") {
    return buildRankingCornerSvg(fullText, fs, accentColor || "#555555", font)
  } else if (s === "number") {
    // Standalone numeral: no plate/label — only the rank digits matter, so
    // the pill-text overflow cap above is irrelevant (fs unused here).
    return buildRankingNumberSvg(rank, pw, font)
  } else if (s === "vetro") {
    return buildRankingGlassSvg(fullText, fs, fg, bg, !!topLight, font)
  } else if (s === "bordo") {
    return buildRankingBorderedSvg(fullText, fs, fg, !!topLight, font)
  }
  // Senza nastro il "colored" colora il badge default: tinta accent piatta
  // (stesso contratto del builder extra) invece del gradiente satinato.
  // Task P parity: ribbon=false forza la placca anche senza accentFill esterno.
  const accentFlat = (input.accentFill || (isColored && !ribbonOn)) && accentColor && accentColor !== "#555555" ? accentColor : undefined
  return buildRankingDefaultSvg(fullText, fs, accentFlat ? textColorForBg(accentFlat) : fg, bg, !!topLight, accentFlat, detached, font)
}

export interface HouseExtraInput {
  readonly label: string
  readonly pw: number
  readonly topLight?: boolean
  readonly style?: BadgeStyle | RankingBadgeStyle
  readonly accentColor?: string
  /** Placca fluttuante con 4 angoli raccordati (badge staccato dal top via toy). */
  readonly detached?: boolean
  /** Dimensione font assoluta (px su griglia 380; senza = base 27 della ricetta, 90% del ranking). */
  readonly fontSize?: number
  /** Fill testo esplicito (rgba già risolto; senza = adattivo della ricetta). */
  readonly textColor?: string
  /** Opacità 0-100 sul fill finale (ricetta o override; senza = ricetta). */
  readonly textOpacity?: number
  /** Font dei testi (default "inter" = resa storica). */
  readonly font?: BadgeFont
}

/**
 * Shared sync recipe for the extra badge (custom text, no rank digits):
 * the single source used by the native poster path (`buildExtraBadgeSVG` in
 * svg-badge.ts, plus resvg there) and by the Badge Lab house presets
 * (identical inputs → identical SVG, never a copied renderer). Ribbon and
 * numeral styles degrade exactly like the native extra badge (default plate,
 * corner pill) — they stay accepted for backwards compatibility but are not
 * advertised as native extra styles in the Lab gallery.
 */
export function buildHouseExtraSvg(input: HouseExtraInput): { svg: string; w: number; h: number } {
  // `split` is RANKING-ONLY (`rs=split`): an extra badge reached through the
  // legacy `rs` fallback (no `xbs`) never renders the two-tone chip — it
  // degrades to the historic default plate. `xbs=split` is not a valid value,
  // so nothing is migrated and no extra-side style changes.
  const rawStyle = input.style || "default"
  const s = rawStyle === "split" ? "default" : rawStyle
  const f = normalizeBadgeFont(input.font)
  // Cap estetico per gli stili compatti: oltre il 65% di pw il testo si
  // rimpicciolisce (le label corte restano invariate).
  const maxBadgeW = Math.round(input.pw * 0.65)
  // Extra al 90% del badge ranking (base 30): a pari fs le label lunghe
  // ("Candidato Golden Globe") restano compatte rispetto ai rank.
  let finalFs = (input.fontSize ?? 30 * 0.9) * input.pw / 380
  const projectedW = estimateTextWidth(input.label, finalFs, f) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
  if (projectedW > maxBadgeW) {
    finalFs = Math.max(maxBadgeW / projectedW * finalFs, 10)
  }

  const fs = Math.round(finalFs)
  const isColored = s === "colored"
  const isGlass = s === "vetro"
  const coloredBg = isColored && input.accentColor && input.accentColor !== "#555555" ? input.accentColor : undefined
  const bg = coloredBg || (input.topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)")
  const recipeFg = isColored
    ? textColorForBg(input.accentColor || "")
    : (isGlass || s === "bordo")
      ? (input.topLight ? "rgba(0,0,0,0.80)" : TRANSLUCENT_BADGE_TEXT)
      : (input.topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
  const rawFg = input.textColor ?? recipeFg
  const fg = input.textOpacity !== undefined ? applyFillOpacity(rawFg, input.textOpacity) : rawFg

  let result: { svg: string; w: number; h: number }
  if (s === "pill") {
    result = buildExtraPillSvg(input.label, fs, fg, bg, !!input.topLight, true, f)
  } else if (s === "corner") {
    // Corner style for every top badge (rank or extra): same flat accent
    // pill as the ranking corner, fed by the extra label. The 65% cap,
    // font and accent fallback above apply unchanged.
    result = buildRankingCornerSvg(input.label, fs, input.accentColor || "#555555", f)
  } else if (s === "number") {
    // An extra badge carries no digits: degrade to the corner flat pill so
    // rank and extra share the same corner anchor under `rs=number`.
    result = buildRankingCornerSvg(input.label, fs, input.accentColor || "#555555", f)
  } else if (isGlass) {
    result = buildExtraGlassSvg(input.label, fs, fg, bg, !!input.topLight, f)
  } else if (s === "bordo") {
    result = buildExtraBorderedSvg(input.label, fs, fg, !!input.topLight, f)
  } else {
    // colored: passa la tinta accent come flatBg (resta piatta); default: gradiente satinato.
    result = buildExtraDefaultSvg(input.label, fs, fg, bg, !!input.detached, !!input.topLight, isColored ? bg : undefined, f)
  }
  return result
}

/**
 * Corner-ribbon SVG for the pre-digital "coming soon" sticker (pure,
 * sync, single source): the same corner geometry the poster composites
 * with a negative offset (`comingSoonRibbonLayout(pw).offset`), red
 * gradient band + fitted uppercase label + drop shadow. `svg-badge.ts`
 * `renderComingSoonRibbon` rasterizes this builder (no second recipe).
 */
export function buildComingSoonRibbonSvg(
  label: string,
  pw: number,
  side: "left" | "right" = "left",
  font: BadgeFont = "inter",
  /** Optional typography override: absolute font size on the
   *  380 grid, explicit text color/opacity, opt-out of the reference
   *  uppercase. All absent = historic look, byte-identical. */
  typo?: { fontSize?: number; textColor?: string; textOpacity?: number; uppercase?: boolean },
): { svg: string; w: number; h: number } {
  const s = pw / 380
  const CS = Math.round(200 * s)
  const offset = Math.round(20 * s)
  const c = CS - offset - Math.round(100 * s)
  const cx = side === "right" ? CS - c : c
  const rot = side === "right" ? 45 : -45
  const half = Math.round(140 * s)
  const bandH = Math.round(44 * s)
  const text = typo?.uppercase === false ? label : label.toUpperCase()
  let fs = typo?.fontSize !== undefined
    ? Math.max(8, Math.round(typo.fontSize * s))
    : Math.round(21 * s)
  const ink = typo?.textColor ?? "#ffffff"
  const inkFill = typo?.textOpacity !== undefined ? applyFillOpacity(ink, typo.textOpacity) : ink
  // Il testo deve stare nel segmento visibile (tra i due bordi poster):
  // oltre sborda a metà lettera e sembra rotto, non "nastro da angolo".
  // Tetto stretto (120, non tutta la banda): le parole lunghe
  // ("Prossimamente", "Prochainement"...) respirano invece di toccare i bordi.
  const maxTextW = Math.round(120 * s)
  const textW = estimateTextWidth(text, fs, normalizeBadgeFont(font))
  if (textW > maxTextW) {
    fs = Math.max(12, Math.floor((fs * maxTextW) / textW))
  }
  const labelSvg =
    `<text x="0" y="${Math.round(1 * s)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text, normalizeBadgeFont(font))}" font-weight="800" font-size="${fs}" fill="${inkFill}" letter-spacing="0.05em">${escSvg(text)}</text>`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CS}" height="${CS}" viewBox="0 0 ${CS} ${CS}">` +
    `<defs>` +
    `<filter id="csShadow" x="-40%" y="-40%" width="180%" height="180%">` +
    `<feDropShadow dx="0" dy="${Math.round(3 * s)}" stdDeviation="${Math.round(4 * s)}" flood-color="#000000" flood-opacity="0.80"/>` +
    `</filter>` +
    `<linearGradient id="csGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#e50914"/>` +
    `<stop offset="100%" stop-color="#a30810"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<g transform="translate(${cx},${c}) rotate(${rot})" filter="url(#csShadow)">` +
    `<rect x="${-half}" y="${Math.round(-bandH / 2)}" width="${half * 2}" height="${bandH}" fill="url(#csGrad)"/>` +
    labelSvg +
    `</g></svg>`
  return { svg, w: CS, h: CS }
}
