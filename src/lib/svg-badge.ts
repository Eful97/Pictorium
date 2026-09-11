import fs from "fs"
import { textColorForBg } from "./accent-color"
import { FONT_FILES, FONT_INTER_REGULAR, FONT_INTER_BOLD, FONT_INTER_BLACK, FONT_SYMBOLS } from "./fonts"
import { estimateTextWidth, fontFamilyFor, genreBadgeSafePad, genreBadgeSvgDims, genrePillMaxW, buildGenreBarSvg, buildGenrePillSvg, buildGenreTextSvg, buildGenreBorderedSvg, buildGenreGlassSvg, buildRankingBarSvg, buildRankingDefaultSvg, buildRankingPillSvg, buildExtraBarSvg, buildExtraDefaultSvg, buildExtraPillSvg, buildExtraGlassSvg, buildQualityBadgeSvg, escSvg } from "./badge-svg-shared"
import type { GenreParts } from "./badge-svg-shared"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle } from "./badge-styles"


let _regular: Buffer | null = null
let _bold: Buffer | null = null
let _black: Buffer | null = null
let _symbols: Buffer | null = null
let _b64Regular: string | null = null
let _b64Bold: string | null = null
let _b64Black: string | null = null
let _b64Symbols: string | null = null
let _fontsWarmed = false

export function warmFonts(): void {
  if (_fontsWarmed) return
  try {
    fontRegular(); fontBold(); fontBlack(); fontSymbols()
    fontStyle()
    _fontsWarmed = true
  } catch (e) {
    console.warn("[pictorium] Font warming failed:", e instanceof Error ? e.message : String(e))
  }
}

function fontRegular(): Buffer {
  if (!_regular) _regular = fs.readFileSync(FONT_INTER_REGULAR)
  return _regular
}
function fontBold(): Buffer {
  if (!_bold) _bold = fs.readFileSync(FONT_INTER_BOLD)
  return _bold
}
function fontBlack(): Buffer {
  if (!_black) _black = fs.readFileSync(FONT_INTER_BLACK)
  return _black
}
function fontSymbols(): Buffer {
  if (!_symbols) _symbols = fs.readFileSync(FONT_SYMBOLS)
  return _symbols
}

function b64Regular(): string {
  if (!_b64Regular) _b64Regular = fontRegular().toString("base64")
  return _b64Regular
}
function b64Bold(): string {
  if (!_b64Bold) _b64Bold = fontBold().toString("base64")
  return _b64Bold
}
function b64Black(): string {
  if (!_b64Black) _b64Black = fontBlack().toString("base64")
  return _b64Black
}
function b64Symbols(): string {
  if (!_b64Symbols) _b64Symbols = fontSymbols().toString("base64")
  return _b64Symbols
}

let _cachedStyle: string | null = null
function fontStyle(): string {
  if (!_cachedStyle) {
    _cachedStyle = `<style>@font-face{font-family:'Inter';src:url(data:font/ttf;base64,${b64Regular()});font-weight:400;font-style:normal}@font-face{font-family:'Inter';src:url(data:font/ttf;base64,${b64Bold()});font-weight:700;font-style:normal}@font-face{font-family:'Inter';src:url(data:font/ttf;base64,${b64Black()});font-weight:900;font-style:normal}@font-face{font-family:'Noto Sans Symbols 2';src:url(data:font/ttf;base64,${b64Symbols()});font-weight:400;font-style:normal}</style>`
  }
  return _cachedStyle
}

function wrapSvg(svg: string): string {
  if (svg.includes("</defs>")) {
    return svg.replace("</defs>", `${fontStyle()}</defs>`)
  }
  // SVG senza <defs> (es. Netflix badge): inserisci font-style prima di </svg>
  if (svg.includes("</svg>")) {
    return svg.replace("</svg>", `${fontStyle()}</svg>`)
  }
  return svg.replace(/<svg /, `<svg >${fontStyle()}`)
}

// D2: il dynamic import di resvg (init WASM) veniva rieseguito a OGNI badge —
// un poster con ~5 badge pagava 5 init. Hoist del promise a module level: il
// primo renderSVG carica l'engine, gli altri riusano il modulo già risolto.
// In caso di errore il promise viene resettato → il prossimo badge riprova.
let resvgModule: Promise<typeof import("@resvg/resvg-js")> | null = null
function loadResvg(): Promise<typeof import("@resvg/resvg-js")> {
  if (!resvgModule) {
    resvgModule = import("@resvg/resvg-js").catch((e) => {
      resvgModule = null
      throw e
    })
  }
  return resvgModule
}

export async function renderSVG(svgStr: string, w: number): Promise<Buffer> {
  const { Resvg } = await loadResvg()
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: "width", value: w },
    font: {
      fontFiles: [...FONT_FILES],
      loadSystemFonts: false,
    },
  })
  return Buffer.from(resvg.render().asPng())
}

// --- Extra badge (custom text) ---

export async function buildExtraBadgeSVG(
  label: string,
  pw: number,
  topLight?: boolean,
  badgeStyle?: ExtraBadgeStyle,
  accentColor?: string,
  /** Scala % applicata al font solo per lo stile barra (gli altri scalano via bitmap nel service). */
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const s = badgeStyle || "default"
  // Cap estetico per gli stili compatti: oltre il 65% di pw il testo si
  // rimpicciolisce (le label corte restano invariate). La barra resta
  // full-width: lì vale solo il bound hard anti-overflow (pw - 20).
  const maxBadgeW = s === "bar" ? pw - 20 : Math.round(pw * 0.65)
  // Extra al 90% del badge ranking: a pari fs (es. "Candidato Golden Globe")
  // il testo risultava troppo grande rispetto ai rank.
  let finalFs = 23 * 0.9 * pw / 380
  // Barra full-width: la scala assottiglia nativamente (font+padding),
  // senza staccare la barra dal bordo come farebbe il resize bitmap.
  if (s === "bar") finalFs = (finalFs * scale) / 100
  const projectedW = estimateTextWidth(label, finalFs) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
  if (projectedW > maxBadgeW) {
    finalFs = Math.max(maxBadgeW / projectedW * finalFs, 10)
  }

  const fs = Math.round(finalFs)
  const isColored = s === "colored"
  const isGlass = s === "vetro"
  const coloredBg = isColored && accentColor && accentColor !== "#555555" ? accentColor : undefined
  const bg = coloredBg || (topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)")
  const fg = isColored
    ? textColorForBg(accentColor || "")
    : isGlass
      ? (topLight ? "rgba(0,0,0,0.80)" : "#ffffff")
      : (topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")

  let result: { svg: string; w: number; h: number }
  if (s === "bar") {
    result = buildExtraBarSvg(label, pw, fs, fg, bg)
  } else if (s === "pill") {
    result = buildExtraPillSvg(label, fs, fg, bg)
  } else if (isGlass) {
    result = buildExtraGlassSvg(label, fs, fg, bg, !!topLight)
  } else {
    result = buildExtraDefaultSvg(label, fs, fg, bg)
  }
  const png = await renderSVG(wrapSvg(result.svg), result.w)
  return { png, w: result.w, h: result.h }
}

// --- Genre badge ---

export async function buildGenreBadgeSVG(
  genreName: string, voteAverage: number, pw: number,
  year?: string, style?: BadgeStyle, accentColor?: string, topLight?: boolean, parts?: GenreParts,
  /** Scala % applicata al font solo per lo stile barra (gli altri scalano via bitmap nel service). */
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const s = style || "shadow"
  const voteStr = voteAverage ? voteAverage.toFixed(1) : ""
  const yearStr = year || ""

  // Base al 120%: il badge genere/rating di default rende come l'ex-120%
  // ma nativo (niente upscale bitmap) — lo slider `gscale` parte da 100.
  let finalFs = 24 * 1.2 * pw / 380
  // Barra full-width: vedi nota in buildExtraBadgeSVG.
  if (s === "bar") finalFs = (finalFs * scale) / 100
  const aestheticMaxW = Math.round(pw * 0.86) // 86% per margine estetico
  let dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts)
  let safePad = genreBadgeSafePad(finalFs)
  // Per shadow, buildGenreTextSvg aggiunge shadowPad*2 al renderW finale
  const extraShadowPad = style === "shadow" ? 8 : 0
  const estimatedRenderW = dims.totalW + safePad * 2 + extraShadowPad * 2
  if (estimatedRenderW > aestheticMaxW) {
    finalFs = Math.max(aestheticMaxW / estimatedRenderW * finalFs, 10)
    dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts)
    safePad = genreBadgeSafePad(finalFs)
  }

  const isPillStyle = s === "pill" || s === "colored"
  if (isPillStyle) {
    const _pillPad = Math.round(finalFs * 0.35)
    const maxPillW = genrePillMaxW(pw)
    if (dims.textContentW + _pillPad * 3 + safePad * 2 > maxPillW) {
      finalFs = Math.max(maxPillW / (dims.textContentW + _pillPad * 3 + safePad * 2) * finalFs, 10)
      dims = genreBadgeSvgDims(finalFs, genreName, voteStr, yearStr, parts)
    }
  }
  let fs = Math.round(finalFs)
  const isPill = s === "pill" || s === "colored"
  const isBar = s === "bar"

  const textColor = s === "colored"
    ? textColorForBg(accentColor || "")
    : (isPill ? "rgba(0,0,0,0.80)" : "#e5e7eb")
  const bgColor = s === "colored"
    ? (accentColor && accentColor !== "#555555" ? accentColor : "rgba(255,255,255,0.80)")
    : (isPill ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")

  let result: { svg: string; w: number; h: number }
  if (s === "bordo") {
    result = buildGenreBorderedSvg(genreName, voteStr, yearStr, fs, textColor, topLight ?? false, 0, parts)
  } else if (s === "vetro") {
    result = buildGenreGlassSvg(genreName, voteStr, yearStr, fs, textColor, topLight ?? false, 0, parts)
  } else if (isBar) {
    result = buildGenreBarSvg(genreName, voteStr, yearStr, pw, fs, "rgba(0,0,0,0.80)", !!topLight, 0, parts)
  } else if (isPill) {
    result = buildGenrePillSvg(genreName, voteStr, yearStr, fs, bgColor, textColor, 0, parts)
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
  const png = await renderSVG(wrapSvg(result.svg), result.w)
  return { png, w: result.w, h: result.h }
}

export async function renderGenreBadge(
  genreName: string, voteAverage: number, pw: number,
  year?: string, style?: BadgeStyle, accentColor?: string, topLight?: boolean, parts?: GenreParts,
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildGenreBadgeSVG(genreName, voteAverage, pw, year, style, accentColor, topLight, parts, scale)
  if (r) return r
  throw new Error(`SVG genre badge failed: ${genreName}`)
}

// --- Ranking badge ---

// Testo sotto il numero del nastro Netflix. Per gli anime è l'etichetta fissa
// "anime" (stessa del passato); per film/serie è l'etichetta del rank (es.
// "Oggi", "Today") — stesso sistema del badge anime esteso a tutti i rank.
function netflixSubLabel(isAnime: boolean | undefined, label: string | undefined): string {
  if (label !== undefined && label !== "") return label
  return isAnime ? "anime" : ""
}

export function buildNetflixRankBadgeSVG(rank: number, pw: number, topLight: boolean, side: "left" | "right" = "left", isAnime?: boolean, label?: string) {
  // Leggermente ridotto (-11%): fs base 24, w proporzionale 2.65
  const fs = Math.round(Math.max(24 * pw / 380, 16))
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

  // Stessa logica adattiva degli altri badge ranking (tlBg/tlFg):
  // top chiaro → nastro scuro con testo chiaro; top scuro → nastro chiaro con testo nero.
  const fill = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const textColor = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"

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
    ? `<text x="${textX}" y="${subY}" fill="${textColor}" font-family="${fontFamilyFor(subLabel)}" font-weight="700" font-size="${subFs}" text-anchor="middle" dominant-baseline="central" filter="url(#textShadow)">${escSvg(subLabel)}</text>`
    : ""

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
    <defs>
      <filter id="shadow3D" x="-20%" y="-20%" width="180%" height="180%">
        <feDropShadow dx="${shadowDx}" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.65"/>
      </filter>
      <filter id="textShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="${shadowDx > 0 ? 0 : -1.5}" dy="1.5" stdDeviation="1" flood-color="#000000" flood-opacity="0.65"/>
      </filter>
    </defs>
    <path d="${pathD}" fill="${fill}" filter="url(#shadow3D)"/>
    <line x1="${highlightX1}" y1="1" x2="${highlightX2}" y2="1" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    <text x="${textX}" y="${topY}" fill="${textColor}" font-family="Inter" font-weight="800" font-size="${topFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="1" filter="url(#textShadow)">TOP</text>
    <text x="${textX}" y="${rankY}" fill="${textColor}" font-family="Inter" font-weight="900" font-size="${rankFs}" text-anchor="middle" dominant-baseline="central" letter-spacing="${rankLetterSpacing}" filter="url(#textShadow)">${rank}</text>
    ${subEl}
  </svg>`
  return { svg, w: totalW, h: totalH }
}

export async function buildRankingBadgeSVG(
  rank: number,
  pw: number,
  label?: string,
  topLight?: boolean,
  badgeStyle?: RankingBadgeStyle,
  accentColor?: string,
  side?: "left" | "right",
  isAnime?: boolean,
  /** Scala % applicata al font solo per lo stile barra (gli altri scalano via bitmap nel service). */
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const s = badgeStyle || "default"
  const periodText = label || "Oggi"
  const fullText = `#${rank} ${periodText}`
  const maxBadgeW = pw - 20
  let finalFs = 23 * pw / 380
  // Barra full-width: vedi nota in buildExtraBadgeSVG.
  if (s === "bar") finalFs = (finalFs * scale) / 100
  const projectedW = estimateTextWidth(fullText, finalFs) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
  if (projectedW > maxBadgeW) {
    finalFs = Math.max(maxBadgeW / projectedW * finalFs, 10)
  }

  const fs = Math.round(finalFs)
  const isColored = s === "colored"
  const isNetflix = s === "netflix"
  const coloredBg = isColored && accentColor && accentColor !== "#555555" ? accentColor : undefined
  const bg = coloredBg || (topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)")
  const fg = isColored
    ? textColorForBg(accentColor || "")
    : (topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)")

  let result: { svg: string; w: number; h: number }
  if (isNetflix) {
    // Il nastro mostra l'etichetta sotto il numero: per gli anime è "anime",
    // per film/serie è il periodo del rank (es. "Oggi") — stesso sistema.
    result = buildNetflixRankBadgeSVG(rank, pw, !!topLight, side, isAnime, periodText)
  } else if (s === "bar") {
    result = buildRankingBarSvg(fullText, pw, fs, fg, bg)
  } else if (s === "pill") {
    result = buildRankingPillSvg(fullText, fs, fg, bg)
  } else {
    result = buildRankingDefaultSvg(fullText, fs, fg, bg)
  }
  const png = await renderSVG(wrapSvg(result.svg), result.w)
  return { png, w: result.w, h: result.h }
}

export async function renderRankingBadge(
  rank: number, pw: number, label?: string,
  topLight?: boolean, badgeStyle?: RankingBadgeStyle, accentColor?: string, side?: "left" | "right", isAnime?: boolean,
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildRankingBadgeSVG(rank, pw, label, topLight, badgeStyle, accentColor, side, isAnime, scale)
  if (r) return r
  throw new Error(`SVG ranking badge failed: rank=${rank}`)
}

export async function renderExtraBadge(
  label: string, pw: number, topLight?: boolean,
  badgeStyle?: ExtraBadgeStyle, accentColor?: string,
  scale = 100,
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildExtraBadgeSVG(label, pw, topLight, badgeStyle, accentColor, scale)
  if (r) return r
  throw new Error(`SVG extra badge failed: ${label}`)
}

// --- Coming Soon corner ribbon (pre-digitale) ---
//
// Sticker angolare rosso in alto (a sinistra; speculare a destra con side="right"), la banda sborda
// dai bordi poster (il layer va composto con offset negativo pari a
// `comingSoonRibbonLayout(pw).offset`), così resta visibile solo il
// triangolo d'angolo. Il logo network va impilato sotto `extent` (solo lato sinistro).

export interface ComingSoonRibbonLayout {
  /** Lato del canvas quadrato (px). */
  size: number
  /** Quanto il layer va spostato in negativo su top/left per far sbordare la banda. */
  offset: number
  /** Estensione visibile del nastro dall'angolo (per impilare il logo network sotto). */
  extent: number
}

export function comingSoonRibbonLayout(pw: number): ComingSoonRibbonLayout {
  const s = pw / 380
  return {
    size: Math.round(200 * s),
    offset: Math.round(20 * s),
    extent: Math.round(155 * s),
  }
}

export async function renderComingSoonRibbon(
  label: string,
  pw: number,
  side: "left" | "right" = "left",
): Promise<{ png: Buffer; w: number; h: number }> {
  const s = pw / 380
  const layout = comingSoonRibbonLayout(pw)
  const CS = layout.size
  const c = CS - layout.offset - Math.round(100 * s)
  const cx = side === "right" ? CS - c : c
  const rot = side === "right" ? 45 : -45
  const half = Math.round(140 * s)
  const bandH = Math.round(44 * s)
  const text = label.toUpperCase()
  let fs = Math.round(21 * s)
  // Il testo deve stare nel segmento visibile (tra i due bordi poster):
  // oltre sborda a metà lettera e sembra rotto, non "nastro da angolo".
  // Tetto stretto (120, non tutta la banda): le parole lunghe
  // ("Prossimamente", "Prochainement"...) respirano invece di toccare i bordi.
  const maxTextW = Math.round(120 * s)
  const textW = estimateTextWidth(text, fs)
  if (textW > maxTextW) {
    fs = Math.max(12, Math.floor((fs * maxTextW) / textW))
  }
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
    `<text x="0" y="${Math.round(1 * s)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text)}" font-weight="800" font-size="${fs}" fill="#ffffff" letter-spacing="0.05em">${escSvg(text)}</text>` +
    `</g></svg>`
  const png = await renderSVG(wrapSvg(svg), CS)
  return { png, w: CS, h: CS }
}

export async function renderQualityBadge(
  quality: string,
  pw: number,
  topLight?: boolean,
): Promise<{ png: Buffer; w: number; h: number }> {
  // Base al 120% nativa (come il badge genere): lo slider `qscale` parte da 100.
  const fs = Math.round(Math.max(14 * 1.2 * pw / 380, 10))
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"
  const result = buildQualityBadgeSvg(quality, fs, fg, bg, !!topLight)
  const png = await renderSVG(wrapSvg(result.svg), result.w)
  return { png, w: result.w, h: result.h }
}

