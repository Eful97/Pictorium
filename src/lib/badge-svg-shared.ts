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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${barH}">${defs}${inner}${textEl}</svg>`, w: pw, h: barH }
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}<rect x="${ox}" y="${oy}" width="${pillW}" height="${pillH}" rx="${pillR}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/><g fill="${textColor}">${textParts}</g></svg>`
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}<g fill="${textColor}"${filterAttr}>${textParts}</g></svg>`
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}">${defs}<rect x="${borderW / 2}" y="${borderW / 2}" width="${renderW - borderW}" height="${boxH - borderW}" rx="${r}" fill="${bgFill}" stroke="${borderColor}" stroke-width="${borderW}"/><g fill="${textColor}">${textParts}</g></svg>`
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${boxH}"><defs>${STAR_GRADIENT_DEF}<linearGradient id="gg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect width="${renderW}" height="${boxH}" rx="${r}" fill="url(#gg)" stroke="${borderColor}" stroke-width="1.5"/><g fill="${textColor}">${textParts}</g></svg>`
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
  const r = Math.round(fs * 0.7)
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#rdg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
}

export function buildExtraDefaultSvg(label: string, fs: number, textColor: string, _bg: string, detached = false, topLight = false, flatBg?: string) {
  const px = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const textW = Math.max(estimateTextWidth(label, fs), fs)
  const totalW = textW + px * 2
  const boxH = badgeBoxHeight(fs)
  const r = Math.round(fs * 0.7)
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}<path d="${pathD}" fill="${flatBg ?? "url(#edg)"}" stroke="${stroke}" stroke-width="1.5" filter="url(#tds)"/>${textEl}</svg>`, w: renderW, h: renderH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}">${defs}${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${boxH}">${bgEl}${textEl}</svg>`, w: totalW, h: boxH }
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
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}">${defs}${bgEl}${textEl}</svg>`, w: renderW, h: renderH }
}

