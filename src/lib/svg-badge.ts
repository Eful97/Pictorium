import { FONT_FILES } from "./fonts"
import { recolorBadgeBodyText, buildQualityBadgeSvg, buildQualityTierBadgeSvg, buildQualityKnockoutSvg, buildAgeKnockoutSvg, buildComingSoonRibbonSvg, buildCustomBadgeSvg, buildHouseExtraSvg, buildHouseGenreSvg, buildHouseRankingSvg, buildHousePresetSvg } from "./badge-svg-shared"
export { buildNetflixRankBadgeSVG } from "./badge-svg-shared"
import type { GenreParts, HousePresetScene } from "./badge-svg-shared"
import { normalizeBadgeFont } from "./badge-svg-shared"
import { applyHouseAppearance, type SvgBadge } from "./badge-house-appearance"
import type { TechnicalTypography } from "./badge-preset-technical"
import { resolveBadgeText, type BadgeVariableContext } from "./badge-variables"
import { scaleBadgeDesign, type BadgePreset, type HouseBadge } from "./badge-preset"
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

/**
 * Technical-family appearance finish (single shared helper, not a copied
 * renderer): applies validated text ink + declarative material to a native
 * SVG badge, then rasterizes. Undefined appearance/typography = the input
 * badge untouched (byte-identical). Returns the C-contract bleed when the
 * appearance pads the canvas (shadow/border/offset/scale), so placement and
 * fit helpers keep anchoring the visible body.
 */
export async function renderSvgBadgeWithAppearance(
  badge: SvgBadge,
  appearance: HouseBadge["appearance"],
  pixelScale: number,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  const styled = appearance ? applyHouseAppearance(badge, appearance, pixelScale) : badge
  const png = await renderSVG(styled.svg, styled.w)
  return styled.layout
    ? { png, w: styled.w, h: styled.h, bleed: { x: styled.layout.x, y: styled.layout.y, w: styled.layout.w, h: styled.layout.h } }
    : { png, w: styled.w, h: styled.h }
}

/** Optional technical-family finish for native text badges (all undefined = historic recipe). */
export interface TechnicalBadgeFinish {
  appearance?: HouseBadge["appearance"]
  typography?: TechnicalTypography | null
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
  // Ricetta unica in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  const result = buildHouseExtraSvg({ label, pw, topLight, style: badgeStyle, accentColor, detached, font })
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
  /** Technical finish: typography (size/color/opacity/case) + material. */
  finish?: TechnicalBadgeFinish,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  // Unica ricetta in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  const t = finish?.typography ?? null
  const result = buildComingSoonRibbonSvg(label, pw, side, normalizeBadgeFont(font), {
    fontSize: t?.fontSize,
    textColor: t?.textColor ?? undefined,
    textOpacity: t?.textOpacity ?? undefined,
    uppercase: t?.uppercase,
  })
  return renderSvgBadgeWithAppearance(result, finish?.appearance, pw / 380)
}

export async function renderQualityBadge(
  quality: string,
  pw: number,
  topLight?: boolean,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
  /** Technical finish: typography (size/color/opacity/case) + material. */
  finish?: TechnicalBadgeFinish,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  // Base 17px (calibrato sul 65% di 26): watermark bilanciato e sobrio in alto a destra, lo slider `qscale` parte da 100.
  const t = finish?.typography ?? null
  const label = t?.uppercase ? quality.toUpperCase() : quality
  const fs = t?.fontSize !== undefined
    ? Math.max(Math.round(t.fontSize * pw / 380), 8)
    : Math.round(Math.max(17 * pw / 380, 10))
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"
  const built = buildQualityBadgeSvg(label, fs, fg, bg, !!topLight, normalizeBadgeFont(font))
  const inked = t?.textColor || t?.textOpacity !== undefined
    ? { ...built, svg: recolorBadgeBodyText(built.svg, t?.textColor ?? null, t?.textOpacity ?? null) }
    : built
  return renderSvgBadgeWithAppearance(inked, finish?.appearance, pw / 380)
}

/**
 * Renders the streaming-quality tier tag (4K/FHD/...) for the `standard`
 * style: wider, less-rounded box than the neutral pill (see
 * `buildQualityTierBadgeSvg`). Same 17px base and box height as
 * `renderQualityBadge`, so scale/offset/anchor math downstream is unchanged.
 * The age pill keeps `renderQualityBadge` (historic neutral geometry).
 */
export async function renderQualityTierBadge(
  quality: string,
  pw: number,
  topLight?: boolean,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
  /** Technical finish: typography (size/color/opacity/case) + material. */
  finish?: TechnicalBadgeFinish,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  // Stessa base della pill neutra (17px su griglia 380, `qscale` da 100).
  const t = finish?.typography ?? null
  const label = t?.uppercase ? quality.toUpperCase() : quality
  const fs = t?.fontSize !== undefined
    ? Math.max(Math.round(t.fontSize * pw / 380), 8)
    : Math.round(Math.max(17 * pw / 380, 10))
  const built = buildQualityTierBadgeSvg(label, fs, !!topLight, normalizeBadgeFont(font))
  const inked = t?.textColor || t?.textOpacity !== undefined
    ? { ...built, svg: recolorBadgeBodyText(built.svg, t?.textColor ?? null, t?.textOpacity ?? null) }
    : built
  return renderSvgBadgeWithAppearance(inked, finish?.appearance, pw / 380)
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
  /** Technical finish: size/case honored; text color is inert here (the
   *  letters are mask cut-outs with no ink — see technicalTypographyForStyle). */
  finish?: TechnicalBadgeFinish,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  const t = finish?.typography ?? null
  const label = t?.uppercase ? quality.toUpperCase() : quality
  const fs = t?.fontSize !== undefined
    ? Math.max(Math.round(t.fontSize * pw / 380), 8)
    : Math.round(Math.max(17 * pw / 380, 10))
  const result = buildQualityKnockoutSvg(label, fs, normalizeBadgeFont(font))
  return renderSvgBadgeWithAppearance(result, finish?.appearance, pw / 380)
}

/**
 * Renders the age `knockout` style (age ONLY): opaque white tag with the
 * label glyphs cut out (transparent, poster shows through — see
 * `buildAgeKnockoutSvg`). Same 17px base and box model as the quality
 * knockout, so scale/offset/anchor math downstream is unchanged; unlike
 * the shared quality knockout the mask glyphs render at the normal base
 * `fs` (no oversize) inside a roomier box. The shared quality knockout
 * (`renderQualityKnockoutBadge`) is untouched.
 */
export async function renderAgeKnockoutBadge(
  label: string,
  pw: number,
  /** Text font (default "inter" = historic look). */
  font: BadgeFont = "inter",
  /** Technical finish: size/case honored; text color is inert here (the
   *  letters are mask cut-outs with no ink — see technicalTypographyForStyle). */
  finish?: TechnicalBadgeFinish,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } }> {
  const t = finish?.typography ?? null
  const text = t?.uppercase ? label.toUpperCase() : label
  const fs = t?.fontSize !== undefined
    ? Math.max(Math.round(t.fontSize * pw / 380), 8)
    : Math.round(Math.max(17 * pw / 380, 10))
  const result = buildAgeKnockoutSvg(text, fs, normalizeBadgeFont(font))
  return renderSvgBadgeWithAppearance(result, finish?.appearance, pw / 380)
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
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } } | null> {
  if (preset.variant !== "custom" || !preset.design) return null
  const design = scaleBadgeDesign(preset.design, pw / 380)
  const text = resolveBadgeText(design.text.template, context)
  if (!text) return null
  const result = buildCustomBadgeSvg(design, text)
  const png = await renderSVG(result.svg, result.w)
  // No appearance layer on custom designs: body == canvas, no bleed.
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
  /**
   * Actual top slot the preset fills (poster service: the resolved topBadge
   * kind — an extra badge renders the label alone, never `#rank`). Absent
   * keeps the historic behavior (`top` → rank).
   */
  slot?: "rank" | "extra" | null,
  /** Live extra label for the extra slot (poster: resolved topBadge label). */
  slotLabel?: string | null,
  /** Detached plate geometry (combined Y offset ≠ 0, centered styles only). */
  detached?: boolean,
): Promise<{ png: Buffer; w: number; h: number; bleed?: { x: number; y: number; w: number; h: number } } | null> {
  // Ricetta unica in badge-svg-shared (stessa del Badge Lab): qui solo resvg.
  const result = buildHousePresetSvg(preset, context, pw, scene, slot, slotLabel, detached ?? false)
  if (!result) return null
  const png = await renderSVG(result.svg, result.w)
  // Contract: w/h = actual raster canvas pixels (what resizes/placements
  // must use); bleed = visible-body rect inside that canvas (shadow/bleed
  // excluded, anchored like the Lab preview body). No layout = body == canvas.
  return { png, w: result.w, h: result.h, ...(result.layout ? { bleed: { x: result.layout.x, y: result.layout.y, w: result.layout.w, h: result.layout.h } } : {}) }
}


