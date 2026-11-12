import type { QualityBadgeStyle } from "./badge-styles"
import { FORMAT_ICON_PATHS, KNOWN_VIDEO_FORMATS, VIDEO_FORMAT_OPTIONS, isVideoFormat, type VideoFormat } from "./av-specs"
import {
  packMarkAccent,
  packMarkGradientStops,
  packMarkInkBox,
} from "./quality-badge-pack"

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

/** Stili icona con un set SVG locale (il tier `premium` riusa l'arte `color`).
 *  Il set `mono` resta nel registro per i chiamanti esterni, ma il renderer
 *  del poster NON lo usa più: il tier `mono` disegna la cornice dinamica
 *  condivisa con l'età (`buildAgeEmphasisSvg`), un solo materiale per
 *  qualità ed età. Lo stile `nova` non ha alcun asset: è una ricetta SVG
 *  100% dinamica (`buildAgeEmphasisSvg` con `AgeEmphasisStyle "nova"`), quindi
 *  `qualityBadgeIconStyle("nova")` resta null (nessun path inventato). */
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
 * Nota: il tier `mono` del poster usa la cornice dinamica condivisa con l'età,
 * quindi `qualityBadgeIconPath("mono", …)` è solo un'utilità per i chiamanti
 * (il servizio non lo chiama più: nessun asset statico alternativo al frame).
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

/** Placca scura neutra: fondo fisso (indipendente da `topLight`) e bordo
 *  hairline caldo della famiglia: stesso hue del frame `color`
 *  (`COLOR_MARK_PLATE_STROKE`, #FFCB00) al 38%, così premium e color
 *  condividono UN materiale di cornice e la placca dark resta leggibile
 *  anche su fondi chiari (nessun colore nuovo, solo la stessa tinta). */
export const PREMIUM_PLATE_BG = "rgba(16,17,21,0.88)"
export const PREMIUM_PLATE_STROKE = "rgba(255,203,0,0.38)"
/** Raggio contenuto della placca (frazione dell'altezza box, come il tier tag).
 *  Geometria condivisa da ogni stile placcato (premium e color). */
export const AV_PLATE_RADIUS_FACTOR = 0.30
/** Spessore del bordo della placca (stesso 1.5 del tier): è tenuto DENTRO il
 *  box, così il bordo esterno visibile coincide con la larghezza del tier 4K. */
export const AV_PLATE_STROKE_WIDTH = 1.5
/** Margine interno per lato del glifo dentro la placca (frazione di `fs`),
 *  condiviso da ogni cornice A/V (placca premium/color, pill satinata
 *  `standard`, cornice `mono`). La cornice NON si allarga oltre il tier 4K: è
 *  il glifo a stare dentro, quindi il margine è un piccolo inset, mai un
 *  padding additivo che allarghi la colonna. */
export const AV_PLATE_GLYPH_INSET_FACTOR = 0.10
/** Tetto d'inchiostro del glifo dentro il box (frazione dell'altezza box).
 *  Con la larghezza normalizzata non morde sui marchi A/V shipped (tutti
 *  larghi: il vincolo è la larghezza della placca), ma evita che un futuro
 *  marchio stretto tocchi il bordo della placca. */
export const AV_PLATE_GLYPH_HEIGHT_FACTOR = 0.56

/** Box del glifo (coordinate relative alla cornice, 0,0 = angolo interno). */
export interface AvPlateGlyphBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Single source del glifo dentro una cornice A/V: inset uniforme per lato
 * (`AV_PLATE_GLYPH_INSET_FACTOR`), aspect NATIVO dell'asset (l'altezza segue
 * la larghezza, mai stretch) e tetto d'altezza che preserva il rapporto.
 * Usato da placca `color`/`premium`, pill satinata `standard` e cornice
 * `mono`: la cornice ha sempre la larghezza della colonna, il glifo ci sta
 * dentro — nessun padding additivo che allarghi la colonna.
 */
export function avPlateGlyphBox(
  ink: { readonly w: number; readonly h: number },
  frameW: number,
  boxH: number,
  fs: number,
  /** Inset orizzontale (em di `fs`): le pill full-round ne vogliono di più. */
  insetFactor: number = AV_PLATE_GLYPH_INSET_FACTOR,
): AvPlateGlyphBox {
  const inset = Math.max(1, Math.round(fs * insetFactor))
  const targetW = Math.max(1, frameW - inset * 2)
  const naturalH = Math.max(1, Math.round(targetW * (ink.h / ink.w)))
  const h = Math.min(naturalH, Math.round(boxH * AV_PLATE_GLYPH_HEIGHT_FACTOR))
  const w = h === naturalH ? targetW : Math.max(1, Math.round(h * (ink.w / ink.h)))
  return { x: Math.round((frameW - w) / 2), y: Math.round((boxH - h) / 2), w, h }
}

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

/** Etichetta breve di un marchio A/V (single source: le stesse label che
 *  elenca l'editor, `av-specs.ts`; nessuna seconda denominazione). Usata dagli
 *  stili dinamici testuali (Nova) al posto delle icone. */
export function videoFormatShortLabel(format: VideoFormat): string {
  return VIDEO_FORMAT_OPTIONS.find((option) => option.id === format)?.label ?? format.toUpperCase()
}

/** Etichetta della lockup unita Dolby Vision · Atmos (un solo marchio). */
export const AV_COMBO_SHORT_LABEL = "DV+ATMOS"

/** Ink box di un asset A/V registrato, o null (tier/asset non A/V). */
export function avMarkInkBox(iconPath: string): AvMarkInkBox | null {
  if (iconPath === AV_COMBO_ICON_PATH) return AV_COMBO_INK_BOX
  for (const format of KNOWN_VIDEO_FORMATS) {
    if (FORMAT_ICON_PATHS[format] === iconPath) return AV_MARK_INK_BOX[format]
  }
  return packMarkInkBox(iconPath)
}

/**
 * Accento premium di un marchio qualità: i formati built-in hanno la tabella
 * storica, i marchi del pack dichiarano il proprio (default `gold`, la tinta
 * della famiglia premium) — mai un colore inventato per formato.
 */
export function qualityMarkAccent(id: string): PremiumAccent {
  if (isVideoFormat(id)) return premiumFormatAccent(id)
  return packMarkAccent(id) ?? "gold"
}

// ---------------------------------------------------------------------------
// HDR family: `hdr` (generic HDR/HDR10) and `hdr10plus` are the same wordmark
// family and must read at the SAME visual height on the BARE-ICON path.
//
// The shipped assets already share the cap height (~49.5 viewBox units), but
// the icon renderer normalizes every bare A/V mark to the SAME VISIBLE WIDTH,
// so the short `HDR` wordmark becomes proportionally taller than the longer
// `HDR10+` one and reads as visibly larger. `avMarkGroupInkBox` crops the HDR
// glyph on an inflated horizontal ink box, i.e. it shrinks uniformly inside
// the unchanged box until its rendered height matches the family reference
// (the widest member, HDR10+). The declared `AV_MARK_INK_BOX` stays measured
// from the asset (guard test) — only the render crop is derived.
//
// SCOPE: this sizing applies ONLY to the `naked` (senza-pill) style, which
// draws A/V marks through the bare-icon path. Every other style
// (standard/mono/color/premium/knockout/nova/gradient/outline/strip) keeps
// its pre-HDR measured box (byte-identical). Non-family marks
// (4K/DV/Atmos/IMAX/combo) keep their own aspect; the optical cap only trims
// tall marks down to the tier text cap.
// ---------------------------------------------------------------------------

/** HDR family members (generic HDR/HDR10 and the HDR10+ variant). */
export const HDR_FAMILY_FORMATS: readonly VideoFormat[] = ["hdr", "hdr10plus"]

/** Is a format part of the HDR wordmark family? */
export function isHdrFamilyFormat(format: VideoFormat | null | undefined): boolean {
  return format === "hdr" || format === "hdr10plus"
}

/** Format of a registered A/V asset path, or null (tier/combo/unknown). */
function videoFormatForIconPath(iconPath: string): VideoFormat | null {
  for (const format of KNOWN_VIDEO_FORMATS) {
    if (FORMAT_ICON_PATHS[format] === iconPath) return format
  }
  return null
}

/**
 * Family reference aspect (height / width) = the WIDEST HDR member (HDR10+):
 * the smallest rendered height at a pinned column width. Every HDR-family
 * glyph is scaled to this height so `HDR` and `HDR10+` read the same size.
 */
const HDR_FAMILY_REFERENCE_RATIO: number = Math.min(
  ...HDR_FAMILY_FORMATS.map((format) => AV_MARK_INK_BOX[format].h / AV_MARK_INK_BOX[format].w),
)

/**
 * Render-only ink box of an A/V mark inside the quality group.
 *
 * Two normalizations, both aspect-preserving (width differs by content, the
 * glyph is never stretched) and both NEVER upscaling:
 *
 * 1. HDR family parity: every member is widened to the widest member's aspect
 *    (`HDR_FAMILY_REFERENCE_RATIO`), so `HDR` and `HDR10+` share one visual
 *    height. Other marks keep their measured aspect.
 * 2. Optical cap: when the caller supplies the glyph width the builder will
 *    use (`glyphWidth`) and the shared text cap height (`capHeight`), a mark
 *    whose width-normalized ink height exceeds the cap is shrunk uniformly
 *    down to it. The cap is the tier text cap height, so tall icon wordmarks
 *    (Dolby Vision/Atmos) no longer read larger than the `4K` tier, while
 *    width-bound marks (IMAX, HDR10+) stay exactly as before.
 *
 * The measured `AV_MARK_INK_BOX` is untouched (guard test): only the render
 * crop is derived. Non-A/V paths (tier/combo/unknown) return the measured box.
 */
export function avMarkGroupInkBox(
  iconPath: string,
  /** Width the builder will render the glyph at (frame interior / ink width).
   *  Omit for family parity only (no optical cap, e.g. icon-tier styles). */
  glyphWidth?: number,
  /** Shared optical cap height in px (tier text cap). */
  capHeight?: number,
): AvMarkInkBox | null {
  const ink = avMarkInkBox(iconPath)
  if (!ink) return null
  const format = videoFormatForIconPath(iconPath)
  const ownRatio = ink.h / ink.w
  // HDR family: render every member at the widest member's aspect.
  const requestedRatio = isHdrFamilyFormat(format) ? HDR_FAMILY_REFERENCE_RATIO : ownRatio
  let factor = ownRatio / requestedRatio
  if (glyphWidth != null && capHeight != null) {
    const nativeHeight = Math.max(1, glyphWidth) * requestedRatio
    const targetHeight = Math.min(nativeHeight, Math.max(1, capHeight))
    // Sub-pixel tolerance: never rewrite bytes for a mark that already sits on
    // the cap after raster rounding (e.g. the merged Dolby lockup).
    if (nativeHeight - targetHeight > AV_MARK_CAP_TOLERANCE_PX) {
      factor *= nativeHeight / targetHeight
    }
  }
  if (factor <= 1) return ink
  const widened = ink.w * factor
  return { x: ink.x - (widened - ink.w) / 2, y: ink.y, w: widened, h: ink.h }
}

/** Rounding tolerance (px) of the group optical cap: a mark already within
 *  this distance from the cap keeps its historic crop/bytes. */
export const AV_MARK_CAP_TOLERANCE_PX = 0.5

/** Text cap height as a fraction of the badge font size (Inter/technical
 *  wordmarks). The tier's `4K` glyph measures ~13px at fs 17 (0.765); 0.78
 *  leaves raster headroom so the merged Dolby lockup (0.296 × interior ≈
 *  13.0) stays byte-identical at portrait size. */
export const AV_MARK_CAP_HEIGHT_FACTOR = 0.78

/**
 * Palette dei marchi A/V `color`, campionata dall'asset 4K color shipped
 * (public/quality-badges/color/4k-label-color-icon.svg): cornice oro, placca
 * interna scura, lettering oro. Nessun colore di brand inventato, nessun asset
 * nuovo: il marchio A/V usa la stessa famiglia del tier 4K.
 */
export const COLOR_MARK_PLATE_BG = "#262626"
export const COLOR_MARK_PLATE_STROKE = "#FFCB00"
export const COLOR_MARK_GLYPH = "#FD5"

// ---------------------------------------------------------------------------
// Stile `gradient` (additivo, 100% SVG dinamico, nessun asset raster): glifi
// extra-bold su una placca scura traslucida condivisa. Tier ed età usano un
// inchiostro bianco pieno; i marchi A/V un gradiente ORIZZONTALE per formato.
// Gli stop sono
// scelte di design Pictorium (mai una dichiarazione di colori ufficiali dei
// marchi, nessun asset tracciato): unica fonte per il renderer
// (`poster-service.ts`) e per l'anteprima del selettore UI.
// ---------------------------------------------------------------------------

/** Inchiostro PIENO di tier ed età `gradient` (glifi bianchi, indipendente
 *  dalla polarità: la placca sotto è sempre scura). */
export const GRADIENT_TIER_INK = "#ffffff"

/** Placca scura dietro i glifi `gradient` (riquadro arrotondato nero
 *  traslucido, come il badge `4K DV` di riferimento). Sempre scura,
 *  indipendente da `topLight` come le placche `premium`/`knockout`/`nova`: i
 *  glifi bianchi/gradiente restano leggibili su top chiaro e scuro. Il raggio
 *  è quello condiviso delle placche A/V (`AV_PLATE_RADIUS_FACTOR`). */
export const GRADIENT_PLATE_BG = "rgba(0,0,0,0.50)"
/** Bordo hairline della placca `gradient` (stesso materiale delle placche
 *  A/V): traccia chiara discreta tenuta DENTRO il box, quindi footprint della
 *  placca invariato. Spessore = `AV_PLATE_STROKE_WIDTH` (1.5, come le altre
 *  cornici). */
export const GRADIENT_PLATE_STROKE = "rgba(255,255,255,0.14)"

/** Chiavi dei gradienti A/V: i formati noti più il lockup unito DV+Atmos
 *  (`combo`, non un `VideoFormat`) e `hlg` (riservato: `av-specs.ts` non
 *  espone ancora un HLG come `VideoFormat`/asset, quindi oggi non ha consumer
 *  — gli stop vivono qui per non inventare colori quando il formato arriverà). */
export type GradientMarkKey = VideoFormat | "combo" | "hlg"

/**
 * Stop del gradiente orizzontale per marchio A/V, nella stessa forma delle
 * altre tabelle per-formato (`FORMAT_ICON_PATHS`, `AV_MARK_INK_BOX`): la
 * risoluzione avviene per path icona, così `renderFormatMark`
 * (`poster-service.ts`) non cambia firma.
 */
export const GRADIENT_MARK_STOPS: Readonly<Record<GradientMarkKey, readonly string[]>> = {
  hdr: ["#FF2D2D", "#FF5A1F", "#FFB800"],
  hdr10plus: ["#22D3EE", "#A3E635", "#FACC15", "#FB923C"],
  hlg: ["#FF5C8A", "#FF2D55"],
  dv: ["#3B82F6", "#22D3EE"],
  atmos: ["#A78BFA", "#5B8DEF"],
  imax: ["#4FD1E3", "#2BA8C4"],
  combo: ["#B9A6FF", "#22D3EE"],
}

/** Stop del gradiente di un asset A/V registrato, o null (tier/asset non A/V). */
export function gradientMarkStops(iconPath: string): readonly string[] | null {
  if (iconPath === AV_COMBO_ICON_PATH) return GRADIENT_MARK_STOPS.combo
  for (const format of KNOWN_VIDEO_FORMATS) {
    if (FORMAT_ICON_PATHS[format] === iconPath) return GRADIENT_MARK_STOPS[format]
  }
  return packMarkGradientStops(iconPath)
}

/** Raggio del tag bianco knockout A/V (come il tag knockout del tier). */
export const AV_KNOCKOUT_RADIUS_FACTOR = 0.30
/** Margine interno per lato del glifo ritagliato nel tag knockout (× `fs`). */
export const AV_KNOCKOUT_TAG_INSET_FACTOR = 0.30

