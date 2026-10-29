import { FONT_FILES } from "./fonts"
import { buildQualityBadgeSvg, buildQualityKnockoutSvg, buildAgeKnockoutSvg, buildAgeEmphasisSvg, buildComingSoonRibbonSvg, buildHouseExtraSvg, buildHouseGenreSvg, buildHouseRankingSvg, buildTextLogoSvg } from "./badge-svg-shared"
import type { AgeEmphasisStyle, TextLogoStyle } from "./badge-svg-shared"
export { buildNetflixRankBadgeSVG } from "./badge-svg-shared"
import type { GenreParts } from "./badge-svg-shared"
import { normalizeBadgeFont } from "./badge-svg-shared"
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

// --- Text-as-logo (font del bundle, nessun upload) ---

/**
 * Larghezza di render del wordmark: il buffer viene poi ridimensionato al
 * layout del logo (max 25% altezza in portrait, 40% larghezza in landscape),
 * quindi si rasterizza grande per non perdere nitidezza in scala.
 */
export const TEXT_LOGO_RENDER_WIDTH = 1200

/**
 * Cap duro della memo del wordmark: la chiave è il testo già sanitizzato
 * (max 60 caratteri manuale, 30 auto) + font + tracking, quindi le voci
 * possibili restano legate all'input e non a un attaccante con testi unici;
 * il tetto è comunque esplicito. 200 wordmark da 1200px stanno in poche
 * decine di MB, e l'eviction FIFO (delete-first, come `autoFitCache`) tiene
 * la Map limitata per tutta la vita del processo.
 */
const TEXT_LOGO_CACHE_MAX_ENTRIES = 200

/**
 * Memo dell'output resvg del wordmark: la rasterizzazione è pura rispetto a
 * (testo, font normalizzato, tracking effettivo) — nessun font dinamico, i
 * `FONT_FILES` sono quelli del bundle. Sotto il limiter a 4 slot, le tile
 * concorrenti dello stesso titolo pagavano la stessa rasterizzazione a ogni
 * render; ora la pagano una volta sola. Il buffer è condiviso e i consumer
 * (sharp) lo leggono soltanto: stessi byte, nessun cambio di resa.
 */
const textLogoBufferCache = new Map<string, Buffer>()

function textLogoCacheKey(text: string, font: BadgeFont, style?: TextLogoStyle): string {
  // `trackingEm` esplicito e default producono stringhe SVG diverse (toFixed
  // solo quando esplicito): restano chiavi distinte per non mischiare buffer.
  return `${text}\u0000${normalizeBadgeFont(font)}\u0000${style?.trackingEm != null ? `t${style.trackingEm}` : "d"}`
}

/**
 * Buffer PNG trasparente del logo testuale (input del path logo esistente).
 * Ricetta SVG in badge-svg-shared (`buildTextLogoSvg`): qui solo resvg, con
 * gli stessi `FONT_FILES` dei badge — nessun font esterno, nessuna dipendenza
 * nuova. `style` distingue la resa del wordmark automatico (tracking) dal
 * logo manuale, sullo stesso builder e sullo stesso path di compositing.
 */
export async function buildTextLogoBuffer(
  text: string,
  font: BadgeFont = "inter",
  style?: TextLogoStyle,
): Promise<Buffer> {
  const key = textLogoCacheKey(text, font, style)
  const cached = textLogoBufferCache.get(key)
  if (cached) return cached
  const { svg } = buildTextLogoSvg(text, font, style)
  const buf = await renderSVG(svg, TEXT_LOGO_RENDER_WIDTH)
  if (textLogoBufferCache.size >= TEXT_LOGO_CACHE_MAX_ENTRIES) {
    const first = textLogoBufferCache.keys().next().value
    if (first) textLogoBufferCache.delete(first)
  }
  textLogoBufferCache.set(key, buf)
  return buf
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
  // Ricetta unica in badge-svg-shared: qui solo resvg.
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
  // Ricetta unica in badge-svg-shared: qui solo resvg.
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
  // Ricetta unica in badge-svg-shared: qui solo resvg.
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
  // Unica ricetta in badge-svg-shared: qui solo resvg.
  const result = buildComingSoonRibbonSvg(label, pw, side, normalizeBadgeFont(font))
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

export async function renderQualityBadge(
  quality: string,
  pw: number,
  topLight?: boolean,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
  /** Larghezza visibile fissa (colonna del gruppo); assente = naturale. */
  targetW?: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  // Base 17px (calibrato sul 65% di 26): watermark bilanciato e sobrio in alto a destra, lo slider `qscale` parte da 100.
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"
  const built = buildQualityBadgeSvg(quality, fs, fg, bg, !!topLight, normalizeBadgeFont(font), targetW)
  const png = await renderSVG(built.svg, built.w)
  return { png, w: built.w, h: built.h }
}

/**
 * Renders the `knockout` quality tag: opaque white rounded tag with the
 * tier glyphs cut out (transparent). Same 17px base and box model as the
 * standard pill, so scale/offset/anchor math downstream is unchanged;
 * the mask glyphs render oversized (~1.35x) inside the unchanged box.
 * `targetW` pins the visible box to the group column (glyph font reduced to
 * fit long labels), never stretching the tag.
 */
export async function renderQualityKnockoutBadge(
  quality: string,
  pw: number,
  /** Font del testo (default "inter" = resa storica). */
  font: BadgeFont = "inter",
  /** Larghezza visibile fissa (colonna del gruppo); assente = naturale. */
  targetW?: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const result = buildQualityKnockoutSvg(quality, fs, normalizeBadgeFont(font), targetW)
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

/**
 * Renders the age `knockout` style (age ONLY): opaque white tag with the
 * label glyphs cut out (transparent, poster shows through — see
 * `buildAgeKnockoutSvg`). Same 17px base and box model as the quality
 * knockout, so scale/offset/anchor math downstream is unchanged; unlike
 * the shared quality knockout the mask glyphs render at the normal base
 * `fs` (no oversize) inside a roomier box. `targetW` pins the visible box to
 * the group column, reducing the glyph font for long labels. The shared
 * quality knockout (`renderQualityKnockoutBadge`) is untouched.
 */
export async function renderAgeKnockoutBadge(
  label: string,
  pw: number,
  /** Text font (default "inter" = historic look). */
  font: BadgeFont = "inter",
  /** Larghezza visibile fissa (colonna del gruppo); assente = naturale. */
  targetW?: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const result = buildAgeKnockoutSvg(label, fs, normalizeBadgeFont(font), targetW)
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

/**
 * Renders the emphasis styles `mono`/`color`/`premium` (shared emphasis
 * recipe). `mono` is ALSO the quality tier material (the `mono` tier calls
 * this wrapper with its real label, so tier and age can never diverge);
 * `color`/`premium` are age-only. `standard`/`knockout` keep their own
 * renderers. One shared recipe (`buildAgeEmphasisSvg` in
 * `badge-svg-shared.ts`) draws the dynamic label on the age family box, so the
 * footprint/anchor math matches the age knockout and the client selector
 * swatches come from the same source. `topLight` only affects `mono`
 * (white/black high-contrast ink); the plates are polarity independent like
 * the quality `color`/`premium` plates. `targetW` pins the visible box to the
 * group column (glyph font reduced to fit the label).
 */
export async function renderAgeEmphasisBadge(
  label: string,
  pw: number,
  style: AgeEmphasisStyle,
  topLight?: boolean,
  /** Text font (default "inter" = historic look). */
  font: BadgeFont = "inter",
  /** Larghezza visibile fissa (colonna del gruppo); assente = naturale. */
  targetW?: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const result = buildAgeEmphasisSvg(label, fs, style, !!topLight, normalizeBadgeFont(font), targetW)
  const png = await renderSVG(result.svg, result.w)
  return { png, w: result.w, h: result.h }
}

