import type { QualityBadgeStyle } from "./badge-styles"
import { FORMAT_ICON_PATHS, KNOWN_VIDEO_FORMATS, type VideoFormat } from "./av-specs"

// ---------------------------------------------------------------------------
// Registro icone del badge qualità streaming (stili built-in da SVG locali).
//
// File in public/quality-badges/<style>/<tier-file> (serviti statici per la
// preview client, letti da fs sul server per il raster). Solo i nomi file
// vivono qui: niente fs, modulo isomorfico e client-safe (lo usa anche la UI
// per le anteprime del selettore).
// ---------------------------------------------------------------------------

export type QualityTier = "4K" | "FHD" | "HD" | "SD"

export const QUALITY_TIERS: readonly QualityTier[] = ["4K", "FHD", "HD", "SD"]

/** Stili icona con un set SVG locale (il tier `premium` riusa l'arte `color`). */
type QualityIconStyle = "mono" | "color"

const QUALITY_BADGE_FILES: Record<QualityIconStyle, Record<QualityTier, string>> = {
  mono: {
    "4K": "4k-label-icon.svg",
    FHD: "full-hd-label-icon.svg",
    HD: "hd-label-icon.svg",
    SD: "sd-label-icon.svg",
  },
  color: {
    "4K": "4k-label-color-icon.svg",
    FHD: "full-hd-icon.svg",
    HD: "hd-label-color-icon.svg",
    SD: "sd-label-color-icon.svg",
  },
}

/**
 * Normalizza stringhe di qualità comuni (1080p, 4k, 2160p, 720p, etc.) nei
 * 4 tier canonici: "4K" | "FHD" | "HD" | "SD".
 */
export function normalizeQualityTier(raw: string | null | undefined): QualityTier | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  if (s === "4K" || s === "2160P" || s === "UHD") return "4K"
  if (s === "FHD" || s === "1080P" || s === "FULL HD" || s === "FULLHD") return "FHD"
  if (s === "HD" || s === "720P") return "HD"
  if (s === "SD" || s === "480P" || s === "576P") return "SD"
  return null
}

/**
 * Famiglia di asset icona di uno stile: `mono`/`color` hanno un set proprio,
 * `premium` riusa l'arte tier `color` (stessa palette: il tier non richiede
 * un nuovo set locale), standard/knockout non hanno file (pill/tag testuali).
 * Single source: un nuovo stile icona non duplica la tabella dei file.
 */
export function qualityBadgeIconStyle(style: QualityBadgeStyle | null | undefined): QualityIconStyle | null {
  if (style === "mono") return "mono"
  if (style === "color" || style === "premium") return "color"
  return null
}

/**
 * Path pubblico (servito statico) dell'icona per stile+tier, o null per lo
 * stile standard (pill testuale) e combinazioni non valide. Il chiamante
 * server risolve il path fs da questo; assente/file illeggibile → fallback
 * standard, mai 500.
 */
export function qualityBadgeIconPath(style: QualityBadgeStyle | null | undefined, tier: string | null | undefined): string | null {
  const iconStyle = qualityBadgeIconStyle(style)
  if (!iconStyle) return null
  const normalizedTier = normalizeQualityTier(tier)
  if (!normalizedTier) return null
  const file = QUALITY_BADGE_FILES[iconStyle][normalizedTier]
  return file ? `quality-badges/${iconStyle}/${file}` : null
}

// ---------------------------------------------------------------------------
// Stile `premium` (additivo, richiesto dall'utente): glifi A/V colorati su una
// placca COMPATTA scura neutra. La placca è indipendente dalla polarità del
// fondo (sempre scura) così i marchi colorati restano leggibili sia su top
// chiari sia su top scuri — stessa logica del tag bianco `knockout`. Gli
// accenti sono scelte di design Pictorium, mai una dichiarazione di colori
// ufficiali dei marchi.
// ---------------------------------------------------------------------------

export type PremiumAccent = "gold" | "cyan" | "dolby"

/** Inchiostri d'accento della placca premium (palette di design, non brand). */
export const PREMIUM_ACCENT_COLORS: Readonly<Record<PremiumAccent, string>> = {
  // HDR / HDR10+
  gold: "#F2C14E",
  // IMAX
  cyan: "#4FD1E3",
  // Dolby Vision / Atmos (un solo accento: la combo DV+Atmos è un marchio unito)
  dolby: "#B9A6FF",
}

/** Formato A/V → accento premium (nessun nuovo formato, solo una tinta). */
export const PREMIUM_FORMAT_ACCENT: Readonly<Record<VideoFormat, PremiumAccent>> = {
  hdr: "gold",
  hdr10plus: "gold",
  imax: "cyan",
  dv: "dolby",
  atmos: "dolby",
}

/** La lockup unita DV+Atmos è un solo marchio: un solo accento. */
export const PREMIUM_COMBO_ACCENT: PremiumAccent = "dolby"

/** Hex dell'accento premium (unica fonte per renderer + anteprima UI). */
export function premiumAccentHex(accent: PremiumAccent): string {
  return PREMIUM_ACCENT_COLORS[accent]
}

/** Accento premium di un formato A/V (gold per HDR/HDR10+, cyan IMAX, Dolby). */
export function premiumFormatAccent(format: VideoFormat): PremiumAccent {
  return PREMIUM_FORMAT_ACCENT[format]
}

/** Placca scura neutra: fondo/stroke fissi (indipendenti da `topLight`). */
export const PREMIUM_PLATE_BG = "rgba(16,17,21,0.88)"
export const PREMIUM_PLATE_STROKE = "rgba(255,255,255,0.20)"
/** Raggio contenuto della placca (frazione dell'altezza box, come il tier tag).
 *  Geometria condivisa da ogni stile placcato (premium e color). */
export const AV_PLATE_RADIUS_FACTOR = 0.30
/** Spessore del bordo della placca (stesso 1.5 del tier): è tenuto DENTRO il
 *  box, così il bordo esterno visibile coincide con la larghezza del tier 4K. */
export const AV_PLATE_STROKE_WIDTH = 1.5
/** Margine interno per lato del glifo dentro la placca (frazione di `fs`),
 *  condiviso premium/color. La placca NON si allarga oltre il tier 4K: è il
 *  glifo a stare dentro la placca, quindi il margine è un piccolo inset, mai
 *  un padding additivo che allarghi la colonna. */
export const AV_PLATE_GLYPH_INSET_FACTOR = 0.10
/** Tetto d'inchiostro del glifo dentro il box (frazione dell'altezza box).
 *  Con la larghezza normalizzata non morde sui marchi A/V shipped (tutti
 *  larghi: il vincolo è la larghezza della placca), ma evita che un futuro
 *  marchio stretto tocchi il bordo della placca. */
export const AV_PLATE_GLYPH_HEIGHT_FACTOR = 0.56

// ---------------------------------------------------------------------------
// Geometria NORMALIZZATA dei marchi A/V (larghezza unica).
//
// Prima la larghezza era `altezza box × aspect del viewBox`: IMAX/HDR10+ (e in
// misura minore Dolby/HDR) risultavano 1.6–3.9× più larghi del tier 4K. Ora
// OGNI marchio A/V occupa la stessa larghezza VISIBILE del badge 4K,
// indipendentemente dal proprio aspect: l'altezza resta quella naturale
// (proporzioni intatte), quindi le wordmark larghe diventano più basse invece
// di allargare la colonna. Sui marchi nudi (`standard`/`mono`) la larghezza è
// quella dell'inchiostro; sulle placche (`color`/`premium`) la larghezza del
// TIER è quella della placca e il glifo ci sta dentro con un inset piccolo.
// ---------------------------------------------------------------------------

/** Aspect ratio (larghezza visibile / altezza box) dell'asset icone 4K. */
export const QUALITY_TIER_ICON_ASPECT = 512 / 414.888

/** Larghezza d'inchiostro del badge 4K per una data altezza box: target A/V. */
export function qualityIconReferenceWidth(boxHeight: number): number {
  return Math.max(1, Math.round(boxHeight * QUALITY_TIER_ICON_ASPECT))
}

export interface AvMarkInkBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Bounding box dell'inchiostro VISIBILE (unità viewBox) degli asset A/V
 * shipped, misurata dal canale alpha. Il renderer ritaglia il viewBox su questo
 * box: senza, normalizzare la larghezza del viewBox lascerebbe i margini
 * trasparenti (HDR ~12% per lato, HDR10+ ~7%, combo ~5%) e i marchi non
 * sarebbero davvero larghi uguale. Guardata da un test che rimisura i file.
 */
const AV_MARK_INK_BOX: Readonly<Record<VideoFormat, AvMarkInkBox>> = {
  dv: { x: 4.38, y: 66.56, w: 1046.62, h: 388.87 },
  atmos: { x: 4.38, y: 66.56, w: 1046.62, h: 387.99 },
  hdr: { x: 8.62, y: 8.51, w: 128.46, h: 49.37 },
  hdr10plus: { x: 8.66, y: 8.68, w: 242.57, h: 49.67 },
  imax: { x: 0, y: 150.27, w: 978.37, h: 189.47 },
}

/** Lockup unito Dolby Vision · Atmos (un solo marchio, non un VideoFormat). */
export const AV_COMBO_ICON_PATH = "quality-badges/video/dolby-vision-atmos.svg"
const AV_COMBO_INK_BOX: AvMarkInkBox = { x: 23.2, y: 104.8, w: 913.6, h: 270.4 }

/** Ink box di un asset A/V registrato, o null (tier/asset non A/V). */
export function avMarkInkBox(iconPath: string): AvMarkInkBox | null {
  if (iconPath === AV_COMBO_ICON_PATH) return AV_COMBO_INK_BOX
  for (const format of KNOWN_VIDEO_FORMATS) {
    if (FORMAT_ICON_PATHS[format] === iconPath) return AV_MARK_INK_BOX[format]
  }
  return null
}

/**
 * Palette dei marchi A/V `color`, campionata dall'asset 4K color shipped
 * (public/quality-badges/color/4k-label-color-icon.svg): cornice oro, placca
 * interna scura, lettering oro. Nessun colore di brand inventato, nessun asset
 * nuovo: il marchio A/V usa la stessa famiglia del tier 4K.
 */
export const COLOR_MARK_PLATE_BG = "#262626"
export const COLOR_MARK_PLATE_STROKE = "#FFCB00"
export const COLOR_MARK_GLYPH = "#FD5"

/** Raggio del tag bianco knockout A/V (come il tag knockout del tier). */
export const AV_KNOCKOUT_RADIUS_FACTOR = 0.30
/** Margine interno per lato del glifo ritagliato nel tag knockout (× `fs`). */
export const AV_KNOCKOUT_TAG_INSET_FACTOR = 0.30

