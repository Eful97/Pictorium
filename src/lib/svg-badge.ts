import { textColorForBg } from "./accent-color"
import { FONT_FILES } from "./fonts"
import { estimateTextWidth, fontFamilyFor, buildExtraPillSvg, buildExtraGlassSvg, buildExtraBorderedSvg, buildExtraDefaultSvg, buildRankingCornerSvg, buildQualityBadgeSvg, buildQualityKnockoutSvg, buildCustomBadgeSvg, escSvg, buildHouseGenreSvg, buildHouseRankingSvg, buildHousePresetSvg, TRANSLUCENT_BADGE_TEXT } from "./badge-svg-shared"
export { buildNetflixRankBadgeSVG } from "./badge-svg-shared"
import type { GenreParts, HousePresetScene } from "./badge-svg-shared"
import { normalizeBadgeFont } from "./badge-svg-shared"
import { resolveBadgeText, type BadgeVariableContext } from "./badge-variables"
import { scaleBadgeDesign, type BadgePreset } from "./badge-preset"
import type { BadgeStyle, RankingBadgeStyle, BadgeFont } from "./badge-styles"
import { isRibbonRankingStyle } from "./badge-styles"


// NOTE: i badge risolvono i font via `fontFiles: [...FONT_FILES]` in
// renderSVG (fontdb resvg). L'embedding @font-face base64 in ogni SVG
// (wrapSvg) è stato rimosso: resvg non applica i data URI e l'output è
// byte-identico senza (Gate A SHA-256, Fase 1).

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
  badgeStyle?: BadgeStyle | RankingBadgeStyle,
  accentColor?: string,
  /** Placca fluttuante con 4 angoli raccordati (badge staccato dal top via toy). */
  detached = false,
  /** Font dei testi (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const s = badgeStyle || "default"
  const f = normalizeBadgeFont(font)
  // Cap estetico per gli stili compatti: oltre il 65% di pw il testo si
  // rimpicciolisce (le label corte restano invariate).
  const maxBadgeW = Math.round(pw * 0.65)
  // Extra al 90% del badge ranking (base 30): a pari fs le label lunghe
  // ("Candidato Golden Globe") restano compatte rispetto ai rank.
  let finalFs = 30 * 0.9 * pw / 380
  const projectedW = estimateTextWidth(label, finalFs, f) + Math.round(finalFs * 2) + Math.round(finalFs * 0.6) * 2
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
    : (isGlass || s === "bordo")
      ? (topLight ? "rgba(0,0,0,0.80)" : TRANSLUCENT_BADGE_TEXT)
      : (topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)")

  let result: { svg: string; w: number; h: number }
  if (s === "pill") {
    result = buildExtraPillSvg(label, fs, fg, bg, !!topLight, true, f)
  } else if (s === "corner") {
    // Corner style for every top badge (rank or extra): same flat accent
    // pill as the ranking corner, fed by the extra label. The 65% cap,
    // font and accent fallback above apply unchanged.
    result = buildRankingCornerSvg(label, fs, accentColor || "#555555", f)
  } else if (s === "number") {
    // An extra badge carries no digits: degrade to the corner flat pill so
    // rank and extra share the same corner anchor under `rs=number`.
    result = buildRankingCornerSvg(label, fs, accentColor || "#555555", f)
  } else if (isGlass) {
    result = buildExtraGlassSvg(label, fs, fg, bg, !!topLight, f)
  } else if (s === "bordo") {
    result = buildExtraBorderedSvg(label, fs, fg, !!topLight, f)
  } else {
    // colored: passa la tinta accent come flatBg (resta piatta); default: gradiente satinato.
    result = buildExtraDefaultSvg(label, fs, fg, bg, detached, !!topLight, isColored ? bg : undefined, f)
  }
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

// --- Genre badge ---

export async function buildGenreBadgeSVG(
  genreName: string, voteAverage: number, pw: number,
  year?: string, style?: BadgeStyle, accentColor?: string, bottomLight?: boolean, parts?: GenreParts,
  /** Scala % applicata al font solo per lo stile barra (gli altri scalano via bitmap nel service). */
  scale = 100,
  /** Font dei testi (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number } | null> {
  // Ricetta unica in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  const voteStr = voteAverage ? voteAverage.toFixed(1) : ""
  const yearStr = year || ""
  const result = buildHouseGenreSvg({ genreName, voteStr, yearStr, pw, style, accentColor, bottomLight, parts, scale, font })
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

export async function renderGenreBadge(
  genreName: string, voteAverage: number, pw: number,
  year?: string, style?: BadgeStyle, accentColor?: string, bottomLight?: boolean, parts?: GenreParts,
  scale = 100,
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildGenreBadgeSVG(genreName, voteAverage, pw, year, style, accentColor, bottomLight, parts, scale, font)
  if (r) return r
  throw new Error(`SVG genre badge failed: ${genreName}`)
}

// --- Ranking badge ---

export async function buildRankingBadgeSVG(
  rank: number,
  pw: number,
  label?: string,
  topLight?: boolean,
  badgeStyle?: RankingBadgeStyle,
  accentColor?: string,
  side?: "left" | "right",
  isAnime?: boolean,
  /** Placca fluttuante con 4 angoli raccordati (badge staccato dal top via toy). */
  detached = false,
  /** Riempimento piatto accent sul default centrato (degrado "colored" senza nastro). */
  accentFill = false,
  /** Sottotitolo del nastro classifica (stili ribbon); senza = nessun sottotitolo. */
  ribbonLabel?: string,
  /** Font dei testi (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number } | null> {
  // Ricetta unica in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  // I nastri mostrano il sottotitolo periodo (`ribbonLabel`, es. "Oggi") o la
  // label passata per gli anime ("Anime"); senza = nastro senza sottotitolo.
  const result = buildHouseRankingSvg({ rank, label: isRibbonRankingStyle(badgeStyle) ? (ribbonLabel ?? "") : label, pw, topLight, style: badgeStyle, accentColor, side, isAnime, detached, accentFill, font })
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

export async function renderRankingBadge(
  rank: number, pw: number, label?: string,
  topLight?: boolean, badgeStyle?: RankingBadgeStyle, accentColor?: string, side?: "left" | "right", isAnime?: boolean,
  detached = false,
  /** Riempimento piatto accent sul default centrato (degrado "colored" senza nastro). */
  accentFill = false,
  /** Sottotitolo del nastro classifica (stili ribbon); senza = nessun sottotitolo. */
  ribbonLabel?: string,
  /** Font dei testi (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildRankingBadgeSVG(rank, pw, label, topLight, badgeStyle, accentColor, side, isAnime, detached, accentFill, ribbonLabel, font)
  if (r) return r
  throw new Error(`SVG ranking badge failed: rank=${rank}`)
}

export async function renderExtraBadge(
  label: string, pw: number, topLight?: boolean,
  badgeStyle?: BadgeStyle | RankingBadgeStyle, accentColor?: string,
  detached = false,
  /** Font dei testi (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number }> {
  const r = await buildExtraBadgeSVG(label, pw, topLight, badgeStyle, accentColor, detached, font)
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
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
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
  const textW = estimateTextWidth(text, fs, normalizeBadgeFont(font))
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
    `<text x="0" y="${Math.round(1 * s)}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text, normalizeBadgeFont(font))}" font-weight="800" font-size="${fs}" fill="#ffffff" letter-spacing="0.05em">${escSvg(text)}</text>` +
    `</g></svg>`
  const png = await renderSVG(svg, CS)
  return { png, w: CS, h: CS }
}

export async function renderQualityBadge(
  quality: string,
  pw: number,
  topLight?: boolean,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number }> {
  // Base 17px (calibrato sul 65% di 26): watermark bilanciato e sobrio in alto a destra, lo slider `qscale` parte da 100.
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"
  const result = buildQualityBadgeSvg(quality, fs, fg, bg, !!topLight, normalizeBadgeFont(font))
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

/**
 * Renders the `knockout` quality tag: opaque white rounded tag with the
 * tier glyphs cut out (transparent). Same 17px base and box model as the
 * standard pill, so scale/offset/anchor math downstream is unchanged;
 * the mask glyphs render oversized (~1.35x) inside the unchanged box.
 */
export async function renderQualityKnockoutBadge(
  quality: string,
  pw: number,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number }> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const result = buildQualityKnockoutSvg(quality, fs, normalizeBadgeFont(font))
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

// --- Custom preset badge (Badge Lab → poster Stremio: stesso SVG) ---

/**
 * Rende un preset dichiarativo alla larghezza poster `pw` (fattore pw/380
 * come gli altri badge: a 380px è identità col preview Lab). Variabili
 * risolte dal contesto, testo vuoto → null (il chiamante degrada sullo
 * stile standard, mai 500).
 */
export async function buildCustomPresetBadgeSVG(
  preset: BadgePreset,
  context: BadgeVariableContext,
  pw: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (preset.variant !== "custom" || !preset.design) return null
  const design = scaleBadgeDesign(preset.design, pw / 380)
  const text = resolveBadgeText(design.text.template, context)
  if (!text) return null
  const result = buildCustomBadgeSvg(design, text)
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

/**
 * Rende un preset house con gli stessi builder dei badge poster (stessa
 * ricetta, non un'approssimazione). Testo vuoto o rank assente → null (il
 * chiamante degrada sullo stile standard, mai 500).
 */
export async function buildHousePresetBadgeSVG(
  preset: BadgePreset,
  context: BadgeVariableContext,
  pw: number,
  scene: HousePresetScene,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  // Ricetta unica in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  const result = buildHousePresetSvg(preset, context, pw, scene)
  if (!result) return null
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}


