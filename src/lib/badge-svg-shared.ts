import type { BadgeDesign, HouseBadge, PresetLike } from "./badge-preset"
import type { BadgeStyle, RankingBadgeStyle } from "./badge-styles"
import { isWarmGoldAccent, textColorForBg } from "./accent-color"
import { resolveBadgeText, type BadgeVariableContext } from "./badge-variables"

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

/** Ebraico (blocco base + presentation forms). */
const HEBREW_RE = /[\u0590-\u05FF\uFB1D-\uFB4F]/

/**
 * Famiglia da dichiarare per un testo di badge. Inter non ha glifi ebraici:
 * resvg li recupera per-glifo da Rubik (presente nel fontdb, vedi lib/fonts),
 * ma quel fallback ignora il `font-weight` richiesto e ripiega sempre sul
 * regular — un badge in grassetto verrebbe reso sottile. Dichiarando "Rubik"
 * quando il testo contiene ebraico il peso torna corretto.
 *
 * Per i testi latini ritorna "Inter": l'SVG emesso resta byte-identico a
 * prima, quindi gli snapshot visivi non si muovono.
 */
export function fontFamilyFor(text: string): string {
  return HEBREW_RE.test(text) ? "Rubik" : "Inter"
}

function charWidthFactor(char: string): number {
  if (char === " ") return 0.33
  // Rubik: le lettere ebraiche hanno avanzamento ~0.55em, uniforme (niente
  // maiuscole/minuscole). Col default 0.62 la stima sforava del ~12% e
  // `lengthAdjust="spacingAndGlyphs"` allargava visibilmente i glifi.
  if (HEBREW_RE.test(char)) return 0.55
  if ("iIl.,:;!'|`".includes(char)) return 0.28
  if ("-–_".includes(char)) return 0.36
  if ("fjrt".includes(char.toLowerCase())) return 0.45
  if ("mw".includes(char.toLowerCase())) return 0.86
  if ("#%&@".includes(char)) return 0.75
  if (/\d/.test(char)) return 0.58
  if (/[A-Z]/.test(char)) return 0.68
  return 0.62
}

export function estimateTextWidth(text: string, fs: number): number {
  let units = 0
  for (const char of text) units += charWidthFactor(char)
  return Math.round(Math.max(units * fs, fs * 0.35))
}

function textFitAttrs(width: number): string {
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
}

export function genreBadgeSvgDims(fs: number, genreName: string, voteStr: string, yearStr: string, parts?: GenreParts, style?: string) {
  const isMinimal = style === "minimal"
  const opts = normalizeParts(parts)
  const gap = Math.round(fs / 3)
  const gapStar = Math.round(fs / 6)
  const bulletW = isMinimal ? Math.round(fs * 0.28) : Math.round(fs * 0.35)
  const starW = Math.round(fs * 0.92)
  const genreW = (opts.showGenre && genreName) ? estimateTextWidth(genreName, fs) : 0
  const voteW = (opts.showRating && voteStr) ? estimateTextWidth(voteStr, fs) : 0
  const yearW = (opts.showYear && yearStr) ? estimateTextWidth(yearStr, fs) : 0
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

function buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX, y, parts, style, starFill }: GenreTextFlowArgs) {
  const isMinimal = style === "minimal"
  const opts = normalizeParts(parts)
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, opts, style)
  const starDy = Math.max(2, Math.round(fs * 0.14))
  const hasGenre = opts.showGenre && !!genreName
  const hasRating = opts.showRating && !!voteStr
  const hasYear = opts.showYear && !!yearStr
  const bullet = (dx: number) => isMinimal
    ? `<tspan dx="${dx}" fill-opacity="0.45">|</tspan>`
    : `<tspan dx="${dx}" fill-opacity="0.45">${escSvg("\u2022")}</tspan>`
  const tspan: string[] = []
  // Il dx di separazione va emesso SOLO se il segmento ha un precedente visibile:
  // quando stella o anno sono il PRIMO segmento (es. solo anno, solo voto) il dx
  // sposterebbe il testo fuori centro. Con tutti ON l'output resta byte-identico:
  // stella emette gap (dopo il genere), anno emette gap (dopo stella o genere).
  const starGapDx = hasGenre ? dims.gap : 0
  const yearGapDx = (hasGenre || hasRating) ? dims.gap : 0
  if (hasGenre) {
    tspan.push(`<tspan>${escSvg(genreName)}</tspan>`)
    if (hasRating || hasYear) tspan.push(bullet(dims.gap))
  }
  if (hasRating) {
    tspan.push(`<tspan dx="${starGapDx}" dy="${starDy}" font-family="Noto Sans Symbols 2" font-weight="400" fill="${starFill ?? "url(#starg)"}">${escSvg("\u2605")}</tspan>`)
    tspan.push(`<tspan dx="${dims.gapStar}" dy="${-starDy}">${escSvg(voteStr)}</tspan>`)
    if (hasYear) tspan.push(bullet(dims.gap))
  }
  if (hasYear) {
    tspan.push(`<tspan dx="${yearGapDx}">${escSvg(yearStr)}</tspan>`)
  }
  // Ogni separatore tra segmenti contribuisce gap*2 ai dx (gap prima e dopo il
  // bullet); il gap della stella contribuisce gapStar. Con tutti ON: gap*4 + gapStar.
  const separators = (hasGenre ? 1 : 0) + (hasRating ? 1 : 0) + (hasYear ? 1 : 0) - 1
  const totalDx = separators * dims.gap * 2 + (hasRating ? dims.gapStar : 0)
  const adjustedX = centerX - totalDx / 2
  let t = `<text x="${adjustedX}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(genreName)}" font-weight="${GENRE_FONT_WEIGHT}" font-size="${fs}"${textFitAttrs(dims.textContentW)}>`
  t += tspan.join("")
  t += "</text>"
  return t
}

export function buildGenreBarSvg(genreName: string, voteStr: string, yearStr: string, pw: number, fs: number, textColor: string, bottomLight: boolean, textOffsetX = 0, parts?: GenreParts) {
  const barH = badgeBoxHeight(fs)
  const barR = Math.round(fs * 0.7)
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: pw / 2 + textOffsetX, y: barH / 2, parts })
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
) {
  const padX = Math.round(fs * GENRE_PILL_PAD_X_FACTOR)
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts)
  const pillW = dims.textContentW + padX * 2
  const pillH = fs + Math.round(fs * GENRE_PILL_PAD_Y_FACTOR) * 2
  const pillR = pillH / 2
  // Padding simmetrico per la coda dell'ombra (la pill sta in basso, mai a
  // filo bordo). Vale anche per colored (tinta piatta + ombra).
  const renderW = pillW + TOP_SHADOW_PAD * 2
  const renderH = pillH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: ox + pillW / 2 + textOffsetX, y: oy + pillH / 2, parts, starFill })
  const gradDef = useSatin ? `<linearGradient id="gpg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>` : ""
  const fill = useSatin ? "url(#gpg)" : bgColor
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const defs = `<defs>${STAR_GRADIENT_DEF}${gradDef}${TOP_SHADOW_FILTER}</defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<rect x="${ox}" y="${oy}" width="${pillW}" height="${pillH}" rx="${pillR}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: renderH }
}

export function buildGenreTextSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, style: string, textOffsetX = 0, parts?: GenreParts) {
  const isMinimal = style === "minimal"
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts, style)
  const shadowPad = style === "shadow" ? 8 : (isMinimal ? 2 : 0)
  const shadowDrop = style === "shadow" ? 5 : (isMinimal ? 1 : 0)
  const safePad = genreBadgeSafePad(fs)
  const renderW = dims.totalW + shadowPad * 2 + safePad * 2
  const renderH = dims.svgH + shadowDrop
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: shadowDrop + (dims.svgH - shadowDrop) / 2, parts, style })
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

export function buildGenreBorderedSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, topLight: boolean, textOffsetX = 0, parts?: GenreParts) {
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts)
  const padX = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const borderW = 2
  const renderW = dims.textContentW + padX * 2
  const boxH = dims.svgH
  const r = Math.round(fs * 0.55)
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)"
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: boxH / 2, parts })
  const defs = `<defs>${STAR_GRADIENT_DEF}</defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}" viewBox="0 0 ${renderW} ${boxH}">${defs}<rect x="${borderW / 2}" y="${borderW / 2}" width="${renderW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: boxH }
}

export function buildGenreGlassSvg(genreName: string, voteStr: string, yearStr: string, fs: number, textColor: string, topLight: boolean, textOffsetX = 0, parts?: GenreParts) {
  const dims = genreBadgeSvgDims(fs, genreName, voteStr, yearStr, parts)
  const padX = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const renderW = dims.textContentW + padX * 2
  const boxH = dims.svgH
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textParts = buildGenreTextFlow({ genreName, voteStr, yearStr, fs, centerX: renderW / 2 + textOffsetX, y: boxH / 2, parts })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}" viewBox="0 0 ${renderW} ${boxH}"><defs>${STAR_GRADIENT_DEF}<linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect width="${renderW}" height="${boxH}" rx="${r}" fill="url(#gg)" stroke="${borderColor}" stroke-width="1.5"/><g fill="${textColor}">${textParts}</g></svg>`
  return { svg, w: renderW, h: boxH }
}

export function glassStops(topLight: boolean): string {
  return topLight
    ? `<stop offset="0%" stop-color="rgba(255,255,255,0.92)"/><stop offset="12%" stop-color="rgba(255,255,255,0.55)"/><stop offset="50%" stop-color="rgba(255,255,255,0.32)"/><stop offset="100%" stop-color="rgba(0,0,0,0.08)"/>`
    : `<stop offset="0%" stop-color="rgba(255,255,255,0.45)"/><stop offset="10%" stop-color="rgba(255,255,255,0.14)"/><stop offset="50%" stop-color="rgba(255,255,255,0.07)"/><stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>`
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

export function buildRankingDefaultSvg(fullText: string, fs: number, textColor: string, _bg: string, topLight = false, flatBg?: string, detached = false) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = estimateTextWidth(fullText, fs)
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
  const textEl = `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText)}" font-weight="${RANKING_FONT_WEIGHT}" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  // colored: tinta accent piatta (contratto storico); default: gradiente satinato.
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#rdg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildRankingPillSvg(fullText: string, fs: number, textColor: string, bg: string, topLight = false, useSatin = true) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs), fs)
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
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${filterAttr}/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildRankingGlassSvg(fullText: string, fs: number, textColor: string, _bg: string, topLight: boolean) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const defs = `<defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
  const bgEl = `<rect x="0" y="0" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#rg)" stroke="${borderColor}" stroke-width="1.5"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildRankingBorderedSvg(fullText: string, fs: number, textColor: string, topLight: boolean) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(fullText, fs), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.55)
  const borderW = 2
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(fullText)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(fullText)}</text>`
  const bgEl = `<rect x="${borderW / 2}" y="${borderW / 2}" width="${totalW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildExtraDefaultSvg(label: string, fs: number, textColor: string, _bg: string, detached = false, topLight = false, flatBg?: string) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs), fs)
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
  const textEl = `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  // colored: tinta accent piatta (contratto storico); default: gradiente satinato.
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#edg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildExtraPillSvg(label: string, fs: number, textColor: string, bg: string, topLight = false, useSatin = true) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs), fs)
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
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${filterAttr}/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

export function buildExtraGlassSvg(label: string, fs: number, textColor: string, _bg: string, topLight: boolean) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.6)
  const stops = glassStops(topLight)
  const borderColor = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const defs = `<defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
  const bgEl = `<rect x="0" y="0" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#eg)" stroke="${borderColor}" stroke-width="1.5"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildExtraBorderedSvg(label: string, fs: number, textColor: string, topLight: boolean) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.55)
  const borderW = 2
  const borderColor = topLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.60)"
  const bgFill = topLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)"
  const textEl = `<text x="${totalW / 2}" y="${boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${textColor}"${textFitAttrs(textW)}>${escSvg(label)}</text>`
  const bgEl = `<rect x="${borderW / 2}" y="${borderW / 2}" width="${totalW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}" viewBox="0 0 ${totalW} ${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildNetflixRankSvg(rank: number, pw: number) {
  const fs = Math.round(Math.max(23 * pw / 380, 14))
  const w = Math.round(fs * 2.4)
  const h = Math.round(fs * 2.0)
  const cut = Math.round(fs * 0.35)
  const topFs = Math.round(fs * 0.5)
  const rankFs = Math.round(fs * 1.0)
  const pathD = `M ${cut},0 L ${w},0 L ${w},${h} L 0,${h} L 0,${cut} Z`
  const textEl = `<text x="${w / 2}" y="${Math.round(h * 0.38)}" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="700" font-size="${topFs}" fill="#ffffff">TOP</text><text x="${w / 2}" y="${Math.round(h * 0.72)}" text-anchor="middle" dominant-baseline="central" font-family="Inter" font-weight="900" font-size="${rankFs}" fill="#ffffff">${rank}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><clipPath id="nf"><path d="${pathD}"/></clipPath></defs><g clip-path="url(#nf)"><rect width="${w}" height="${h}" rx="2" fill="#E50914"/></g>${textEl}</svg>`
  return { svg, w, h }
}

export function buildQualityBadgeSvg(quality: string, fs: number, _textColor: string, _bg: string, topLight: boolean = false) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  // Crenatura da marchio tecnico: 0.06em per intervallo. Il textLength è
  // pinnato sulla larghezza reale (stima + tracking) così il layout segue e
  // non comprime i glifi.
  const track = quality.length > 1 ? Math.round(0.06 * fs * (quality.length - 1)) : 0
  const textW = Math.max(estimateTextWidth(quality, fs) + track, fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(boxH / 2)
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const renderW = totalW + TOP_SHADOW_PAD * 2
  const renderH = boxH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  const textEl = `<text x="${ox + totalW / 2}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(quality)}" font-weight="700" font-size="${fs}" letter-spacing="0.06em" fill="${fg}"${textFitAttrs(textW)}>${escSvg(quality)}</text>`
  const defs = `<defs><linearGradient id="qg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
  const bgEl = `<rect x="${ox}" y="${oy}" width="${totalW}" height="${boxH}" rx="${r}" fill="url(#qg)" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

// --- Custom preset badges (Badge Lab + poster Stremio: stessa funzione) ---

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

function presetGradientAttrs(direction: "horizontal" | "vertical" | "diagonal"): string {
  if (direction === "horizontal") return `x1="0" y1="0" x2="1" y2="0"`
  if (direction === "vertical") return `x1="0" y1="0" x2="0" y2="1"`
  return `x1="0" y1="0" x2="1" y2="1"`
}

/**
 * Badge custom dichiarativo: funzione pura (zero I/O), deterministica,
 * compatibile con DOM browser e resvg. L'editor la esegue live a 0ms, il
 * server riusa lo stesso SVG prima di `renderSVG` — Golden Rule per costruzione.
 */
export function buildCustomBadgeSvg(design: BadgeDesign, resolvedText: string): { svg: string; w: number; h: number } {
  const k = design.scale / 100
  const fs = Math.max(1, Math.round(design.text.fontSize * k))
  const label = (design.text.uppercase ? resolvedText.toUpperCase() : resolvedText).slice(0, 80)
  const track = Math.round(design.text.letterSpacing * Math.max(label.length - 1, 0))
  const textW = label ? Math.max(estimateTextWidth(label, fs) + track, Math.round(fs * 0.35)) : 0
  const padX = Math.round(design.padding.x * k)
  const padY = Math.round(design.padding.y * k)
  const autoW = textW + padX * 2
  const boxW = Math.max(design.width !== undefined ? Math.round(design.width * k) : autoW, autoW, 20)
  const autoH = fs + padY * 2
  const boxH = Math.max(design.height !== undefined ? Math.round(design.height * k) : autoH, fs + 4, 16)
  const r = design.radius !== undefined
    ? Math.round(design.radius * k)
    : design.shape === "pill"
      ? Math.floor(boxH / 2)
      : design.shape === "squircle"
        ? Math.round(Math.min(boxW, boxH) * 0.28)
        : design.shape === "ribbon"
          ? Math.round(fs * RANKING_DEFAULT_RADIUS_FACTOR)
          : design.shape === "bordo"
            ? Math.round(fs * 0.55)
            : 0

  const bg = design.background
  const fill = bg.type === "gradient" && bg.gradient
    ? "url(#cpbg)"
    : presetHexToRgba(bg.color ?? "#000000", bg.opacity)
  const gradDef = bg.type === "gradient" && bg.gradient
    ? `<linearGradient id="cpbg" ${presetGradientAttrs(bg.gradient.direction)}><stop offset="0%" stop-color="${bg.gradient.from}" stop-opacity="${Math.min(Math.max(bg.opacity / 100, 0), 1)}"/><stop offset="100%" stop-color="${bg.gradient.to}" stop-opacity="${Math.min(Math.max(bg.opacity / 100, 0), 1)}"/></linearGradient>`
    : ""

  const border = design.border
  const bw = border && border.enabled ? Math.round(border.width * k) : 0
  const stroke = bw > 0 && border ? presetHexToRgba(border.color, border.opacity) : "none"

  const shadow = design.shadow
  const shOn = !!shadow && shadow.enabled && (shadow.blur > 0 || shadow.offsetX !== 0 || shadow.offsetY !== 0)
  const shBlur = shOn ? Math.round(shadow!.blur * k) : 0
  const shDx = shOn ? Math.round(shadow!.offsetX * k) : 0
  const shDy = shOn ? Math.round(shadow!.offsetY * k) : 0
  const shPad = shOn ? Math.round(shBlur + Math.max(Math.abs(shDx), Math.abs(shDy))) + 4 : 0
  const shadowDef = shOn
    ? `<filter id="cpbsh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="${shDx}" dy="${shDy}" stdDeviation="${shBlur}" flood-color="#000000" flood-opacity="${Math.min(Math.max(shadow!.opacity / 100, 0), 1)}"/></filter>`
    : ""
  const filterAttr = shOn ? ` filter="url(#cpbsh)"` : ""

  const renderW = boxW + shPad * 2 + (bw > 0 ? 2 : 0)
  const renderH = boxH + shPad * 2 + (bw > 0 ? 2 : 0)
  const ox = shPad + (bw > 0 ? 1 : 0)
  const oy = shPad + (bw > 0 ? 1 : 0)
  const inset = bw / 2
  const textX = design.text.align === "left"
    ? ox + padX + textW / 2
    : design.text.align === "right"
      ? ox + boxW - padX - textW / 2
      : ox + boxW / 2
  const fg = presetHexToRgba(design.text.color, design.text.opacity)
  const lsAttr = design.text.letterSpacing !== 0 ? ` letter-spacing="${design.text.letterSpacing}"` : ""
  const textEl = label
    ? `<text x="${textX}" y="${oy + boxH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="${design.text.fontWeight}" font-size="${fs}" fill="${fg}"${lsAttr}${textFitAttrs(textW)}>${escSvg(label)}</text>`
    : ""
  const defs = gradDef || shadowDef ? `<defs>${gradDef}${shadowDef}</defs>` : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">${defs}<rect x="${ox + inset}" y="${oy + inset}" width="${boxW - bw}" height="${boxH - bw}" rx="${Math.max(r - inset, 0)}" fill="${fill}" stroke="${stroke}" stroke-width="${bw}"${filterAttr}/>${textEl}</svg>`
  return { svg, w: renderW, h: renderH }
}

// --- House badge dispatch (single source of truth) ---------------------------
// Pure SVG builders for the real poster styles. The server selectors in
// svg-badge.ts delegate here (plus resvg); the Badge Lab calls the same
// functions in the browser — Lab preview and Stremio poster cannot diverge.

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
}

export function buildHouseGenreSvg(input: HouseGenreInput): { svg: string; w: number; h: number } {
  const { genreName, voteStr, yearStr, pw, accentColor, parts } = input
  const s = input.style || "shadow"
  const scale = input.scale ?? 100
  const bottomLight = input.bottomLight
  // Base 28.6px (+30% scala nativa): resa bilanciata e leggibile, lo slider `gscale` parte da 100.
  // (La compattezza di pill/colored vive nel padding di buildGenrePillSvg, mai nel font.)
  let finalFs = (input.fontSize ?? 28.6) * pw / 380
  // Barra full-width: vedi nota in buildExtraBadgeSVG.
  if (s === "bar") finalFs = (finalFs * scale) / 100
  const aestheticMaxW = Math.round(pw * 0.86) // 86% per margine estetico
  const isMinimal = s === "minimal"
  let dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, s)
  let safePad = genreBadgeSafePad(finalFs)
  // Per shadow e minimal, buildGenreTextSvg aggiunge shadowPad*2 al renderW finale
  const extraShadowPad = s === "shadow" ? 8 : (isMinimal ? 2 : 0)
  const estimatedRenderW = dims.totalW + safePad * 2 + extraShadowPad * 2
  if (estimatedRenderW > aestheticMaxW) {
    finalFs = Math.max(aestheticMaxW / estimatedRenderW * finalFs, 10)
    dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts, s)
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
      const _dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts)
      const total = _dims.textContentW + _padX * 2
      // Margine 4px: il builder arrotonda per eccesso rispetto alla stima.
      if (total + 4 <= maxPillW) break
      finalFs = Math.max((maxPillW - 4) / total * finalFs, 10)
    }
    dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts)
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
  const textColor = input.textColor ?? recipeText
  const bgColor = s === "colored"
    ? (accentColor && accentColor !== "#555555" ? accentColor : "rgba(255,255,255,0.80)")
    : (isPill ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")

  let result: { svg: string; w: number; h: number }
  if (s === "bordo") {
    result = buildGenreBorderedSvg(genreName, voteStr, yearStr, fs, textColor, bottomLight ?? false, 0, parts)
  } else if (s === "vetro") {
    result = buildGenreGlassSvg(genreName, voteStr, yearStr, fs, textColor, bottomLight ?? false, 0, parts)
  } else if (isBar) {
    // Barra genere: testo ad alto contrasto polarizzato sul fondo (come pill).
    result = buildGenreBarSvg(genreName, voteStr, yearStr, pw, fs, bottomLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)", !!bottomLight, 0, parts)
  } else if (isPill) {
    // colored: tinta piatta (niente satinatura); pill: satinatura polare.
    // Su accent caldo (oro/ambra) la stella oro annega: fallback in colore testo.
    const useSatin = s !== "colored"
    const starFill = s === "colored" && accentColor && isWarmGoldAccent(accentColor) ? textColor : undefined
    result = buildGenrePillSvg(genreName, voteStr, yearStr, fs, bgColor, textColor, 0, parts, !!bottomLight, useSatin, starFill)
  } else {
    result = buildGenreTextSvg(genreName, voteStr, yearStr, fs, textColor, s, 0, parts)
    // Per shadow, il renderW include shadowPad*2 + safePad*2 aggiuntivi
    // Assicuriamoci che non superi aestheticMaxW
    let attempts = 0
    while (result.w > aestheticMaxW && attempts < 30) {
      // Riduciamo fs proporzionalmente al surplus
      const targetFs = Math.max(Math.round(fs * (aestheticMaxW - 16) / result.w), 10)
      if (targetFs >= fs) { fs = 10 } else { fs = targetFs }
      result = buildGenreTextSvg(genreName, voteStr, yearStr, fs, textColor, s, 0, parts)
      attempts++
    }
  }
  return result
}

// Testo sotto il numero del nastro Netflix. Per gli anime è l'etichetta fissa
// "anime" (stessa del passato); per film/serie è l'etichetta del rank (es.
// "Oggi", "Today") — stesso sistema del badge anime esteso a tutti i rank.
function netflixSubLabel(isAnime: boolean | undefined, label: string | undefined): string {
  if (label !== undefined && label !== "") return label
  return isAnime ? "anime" : ""
}

export function buildNetflixRankBadgeSVG(rank: number, pw: number, topLight: boolean, side: "left" | "right" = "left", isAnime?: boolean, label?: string, accentColor?: string, opts?: { fontSize?: number; textColor?: string }) {
  // Nastro maggiorato (+15% default): fs base 24 → 27.6, w/h proporzionali.
  // fontSize override assoluto (px su griglia 380, dai preset house).
  const fs = opts?.fontSize !== undefined
    ? Math.max(Math.round(opts.fontSize * pw / 380), 8)
    : Math.round(Math.max(24 * 1.15 * pw / 380, 16))
  const w = Math.round(fs * 2.65)
  // Sottotitolo presente (anime o film/serie con etichetta): nastro allungato
  // verso il basso (h × 1.65) per dare pieno respiro alla scritta sopra la V.
  const subLabel = netflixSubLabel(isAnime, label)
  const hasSub = subLabel.length > 0
  const h = Math.round(w * (hasSub ? 1.65 : 1.35))
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
    const subW = estimateTextWidth(subLabel, subFs)
    if (subW > maxSubW) {
      subFs = Math.max(Math.round(subFs * maxSubW / subW), 8)
    }
  }

  // TOP, numero e sottotitolo impilati
  const topY = hasSub ? Math.round(h * 0.20) : Math.round(h * 0.26)
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
    ? `<text x="${textX}" y="${subY}" fill="${textColor}" font-family="${fontFamilyFor(subLabel)}" font-weight="700" font-size="${subFs}" text-anchor="middle" dominant-baseline="central"${textFilter ? ` ${textFilter}` : ""}>${escSvg(subLabel)}</text>`
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
    <text x="${textX}" y="${topY}" fill="${textColor}" font-family="Inter" font-weight="800" font-size="${topFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="1"${textFilter ? ` ${textFilter}` : ""}>TOP</text>
    <text x="${textX}" y="${rankY}" fill="${textColor}" font-family="Inter" font-weight="900" font-size="${rankFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="${rankLetterSpacing}"${textFilter ? ` ${textFilter}` : ""}>${rank}</text>
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
  /** Dimensione font assoluta (px su griglia 380; senza = base 30 della ricetta). */
  readonly fontSize?: number
  /** Fill testo esplicito (rgba già risolto; senza = adattivo della ricetta). */
  readonly textColor?: string
}

export function buildHouseRankingSvg(input: HouseRankingInput): { svg: string; w: number; h: number } {
  const { rank, pw, topLight, accentColor, side, isAnime } = input
  const s = input.style || "default"
  const detached = input.detached ?? false
  const periodText = input.label || "Oggi"
  const fullText = `#${rank} ${periodText}`
  const maxBadgeW = pw - 20
  // Base 30px: placca visibile in alto, lo slider `topBadgeScale` parte da 100.
  let finalFs = (input.fontSize ?? 30) * pw / 380
  const projectedW = estimateTextWidth(fullText, finalFs) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
  if (projectedW > maxBadgeW) {
    finalFs = Math.max(maxBadgeW / projectedW * finalFs, 10)
  }

  const fs = Math.round(finalFs)
  const isColored = s === "colored"
  const isRibbon = s === "netflix" || isColored
  const coloredBg = isColored && accentColor && accentColor !== "#555555" ? accentColor : undefined
  const bg = coloredBg || (topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)")
  const recipeFg = isColored
    ? textColorForBg(accentColor || "")
    : (s === "vetro" || s === "bordo")
      ? (topLight ? "rgba(0,0,0,0.80)" : TRANSLUCENT_BADGE_TEXT)
      : (topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")
  const fg = input.textColor ?? recipeFg

  if (isRibbon) {
    // Il nastro mostra l'etichetta sotto il numero: per gli anime è "anime",
    // per film/serie è il periodo del rank (es. "Oggi") — stesso sistema.
    // Se lo stile è "colored", il nastro prende l'accentColor.
    const ribbonAccent = isColored ? coloredBg : undefined
    return buildNetflixRankBadgeSVG(rank, pw, !!topLight, side, isAnime, periodText, ribbonAccent, {
      fontSize: input.fontSize,
      textColor: input.textColor,
    })
  } else if (s === "pill") {
    return buildRankingPillSvg(fullText, fs, fg, bg, !!topLight)
  } else if (s === "vetro") {
    return buildRankingGlassSvg(fullText, fs, fg, bg, !!topLight)
  } else if (s === "bordo") {
    return buildRankingBorderedSvg(fullText, fs, fg, !!topLight)
  }
  return buildRankingDefaultSvg(fullText, fs, fg, bg, !!topLight, undefined, detached)
}

export interface HousePresetScene {
  readonly topLight: boolean
  readonly bottomLight: boolean
  /** Accent esadecimale o null (null = sentinella "nessun accent", come "#555555"). */
  readonly accentColor: string | null
  readonly side?: "left" | "right"
  readonly isAnime?: boolean
}

/**
 * Render SVG puro di un preset house con gli stessi builder dei badge poster
 * (stessa ricetta, non un'approssimazione). Server, route preview.svg e
 * Badge Lab usano questa unica funzione — Golden Rule per costruzione. La
 * scala del preset agisce sulla larghezza di lavoro così font e geometria
 * restano proporzionali; testo vuoto o rank assente → null (fail-open).
 */
export function buildHousePresetSvg(
  preset: PresetLike,
  context: BadgeVariableContext,
  pw: number,
  scene: HousePresetScene,
): { svg: string; w: number; h: number } | null {
  const house: HouseBadge | undefined = preset.house
  if (preset.variant !== "house" || !house) return null
  const effPw = Math.max(1, (pw * house.scale) / 100)
  // Override esplicito del preset, altrimenti accent di scena (come il poster).
  const accent = house.accent ?? scene.accentColor ?? undefined
  // Override di testo (variabili ammesse): vuoto o irrisolto = dato live.
  const overrideText = (v: string | undefined): string => {
    const t = v?.trim()
    return t ? resolveBadgeText(t, context) : ""
  }
  if (preset.target === "genre") {
    const genreName = overrideText(house.genreText) || context.genre || ""
    const ratingLive = context.rating
    const yearLive = context.year
    const voteStr =
      overrideText(house.ratingText) ||
      (ratingLive === null || ratingLive === undefined || ratingLive === "" ? "" : String(ratingLive))
    const yearStr =
      overrideText(house.yearText) ||
      (yearLive === null || yearLive === undefined || yearLive === "" ? "" : String(yearLive))
    const parts = {
      showGenre: house.showGenre ?? true,
      showYear: house.showYear ?? true,
      showRating: house.showRating ?? true,
    }
    if (!((parts.showGenre && genreName) || (parts.showRating && voteStr) || (parts.showYear && yearStr))) {
      return null
    }
    const bottomLight = house.polarity === "auto" ? scene.bottomLight : house.polarity === "light"
    return buildHouseGenreSvg({
      genreName,
      voteStr,
      yearStr,
      pw: effPw,
      style: house.style as BadgeStyle,
      accentColor: accent,
      bottomLight,
      parts,
      scale: 100,
    })
  }
  const rank = house.rankOverride ?? Number(context.rank)
  if (!Number.isFinite(rank) || rank <= 0) return null
  const label = resolveBadgeText(house.label ?? "", context) || "Oggi"
  const topLight = house.polarity === "auto" ? scene.topLight : house.polarity === "light"
  return buildHouseRankingSvg({
    rank,
    label,
    pw: effPw,
    topLight,
    style: house.style as RankingBadgeStyle,
    accentColor: accent,
    side: house.side ?? scene.side ?? "left",
    isAnime: scene.isAnime,
  })
}

