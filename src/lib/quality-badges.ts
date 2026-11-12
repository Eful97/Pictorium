import sharp from "sharp"
import { renderSVG, renderComposedSvg } from "./svg-badge"
import fs from "fs"
import path from "path"
import { buildEditorialMarkSvg, buildQualityBadgeSvg, buildQualityKnockoutSvg, buildQualityNakedSvg, buildAgeKnockoutSvg, buildAgeEmphasisSvg, buildGradientMarkSvg, buildStripBadgeSvg, type StripSegmentGlyph, QUALITY_GROUP_ROW_MAX_ITEMS, badgeBoxHeight, TOP_SHADOW_PAD, TOP_SHADOW_FILTER, KNOCKOUT_SHADOW_FILTER, KNOCKOUT_INK_OPACITY, knockoutOuterShadow, AGE_KNOCKOUT_RADIUS_FACTOR, AGE_MONO_STROKE_FACTOR, AGE_MONO_STROKE_MIN, AGE_MONO_INK_DARK, AGE_MONO_INK_LIGHT, SATIN_PILL_INK_DARK, SATIN_PILL_INK_LIGHT, SATIN_PILL_STROKE_DARK, SATIN_PILL_STROKE_LIGHT, SATIN_PILL_STROKE_WIDTH, satinPillStops } from "./badge-svg-shared"
import type { BadgeFont } from "./badge-styles"
import { isAgeBadgeStyle, resolveQualityGroupLayout, isMergedQualityStrip, DEFAULT_AGE_BADGE_STYLE, type AgeBadgeStyle, type QualityGroupLayout } from "./badge-styles"
import { normalizeBadgeFont } from "./badge-svg-shared"
import { AV_KNOCKOUT_RADIUS_FACTOR, AV_KNOCKOUT_TAG_INSET_FACTOR, avMarkCapHeight, QUALITY_TIER_ICON_FILLS, tierAssetPlateGeometry, AV_COMBO_SHORT_LABEL, COLOR_MARK_GLYPH, COLOR_MARK_PLATE_BG, COLOR_MARK_PLATE_STROKE, GRADIENT_TIER_INK, avMarkGroupInkBox, avMarkInkBox, avPlateGlyphBox, gradientMarkStops, qualityBadgeIconPath, qualityIconReferenceWidth, qualityMarkAccent, type AvMarkInkBox, PREMIUM_COMBO_ACCENT, PREMIUM_PLATE_BG, PREMIUM_PLATE_STROKE, premiumAccentHex } from "./quality-badge-styles"
import type { QualityBadgeStyle } from "./badge-styles"
import { MAX_QUALITY_MARKS, QUALITY_MARK_IDS, isQualityMarkId, qualityMarkAspect, qualityMarkIconPath, qualityMarkLabel, qualityMarkMode } from "./quality-badge-pack"
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_COMBO, BADGE_ITEM_QUALITY_HOMES, BADGE_ITEM_QUALITY_TIER, applyBadgeItemTransform, badgeItemTransform, homeIdForPainted, isNeutralBadgeItemTransform, qualityFormatItemId, type BadgeItemTransform, type BadgeItemTransformMap } from "./badge-item-transforms"

/**
 * Optical enlargement of the senza-pill `naked` quality group ONLY.
 *
 * Without a plate the group has no solid mass, so at the shared base font the
 * tier/age text and the bare A/V marks read smaller than every plated style in
 * the same slot. The WHOLE group is scaled uniformly from the single font input
 * (`markFs`), so the tier text, the default age text, the pinned common column
 * and the A/V marks derived from it grow together — shapes/aspect, HDR family
 * parity, optical cap and optical gap all scale proportionally. Nominal factor
 * is +12.5%; the integer base font at pw=380 goes 17 → 19 (+11.8% on the
 * font/column, ~+15% on the measured text cap). Any other style never reads
 * this constant (historic bytes preserved).
 */
const NAKED_GROUP_SCALE = 1.125

// ---------------------------------------------------------------------------
// Quality badge da icone built-in (public/quality-badges, server-only).
// ---------------------------------------------------------------------------

// Sorgenti SVG memoizzati (file immutabili): i render a varie pw e polarità
// condividono i byte sorgente. Il cap segue il registro (formati built-in +
// marchi del pack), così un pack grande non manda la memo in thrash.
const qualityIconMemo = new Map<string, Promise<string | null>>()
const QUALITY_ICON_MEMO_MAX = Math.max(20, QUALITY_MARK_IDS.length * 2)

/** `premium` tier: the color tier asset with its frame/plate recolored to the
 *  premium A/V plate (letters stay gold), so the stack shares one material. */
const PREMIUM_TIER_RECOLOR: Readonly<Record<string, string>> = {
  [QUALITY_TIER_ICON_FILLS.frame]: PREMIUM_PLATE_STROKE,
  [QUALITY_TIER_ICON_FILLS.plate]: PREMIUM_PLATE_BG,
}

function loadQualityIconSvg(iconPath: string): Promise<string | null> {
  const memo = qualityIconMemo.get(iconPath)
  if (memo) return memo
  const p = (async (): Promise<string | null> => {
    try {
      // Solo path del registro (niente ..) — il chiamante passa solo
      // qualityBadgeIconPath(); doppia guardia contro traversal.
      if (iconPath.includes("..") || path.posix.normalize(iconPath) !== iconPath) return null
      const full = path.join(process.cwd(), "public", iconPath)
      return await fs.promises.readFile(full, "utf8")
    } catch {
      return null
    }
  })()
  p.catch(() => { if (qualityIconMemo.get(iconPath) === p) qualityIconMemo.delete(iconPath) })
  if (qualityIconMemo.size >= QUALITY_ICON_MEMO_MAX) qualityIconMemo.delete(qualityIconMemo.keys().next().value!)
  qualityIconMemo.set(iconPath, p)
  return p
}

/** Solo test: svuota la memo dei sorgenti SVG qualità. */
export function __resetQualityIconCacheForTests(): void {
  qualityIconMemo.clear()
  qualityAssetMemo.clear()
}

// Asset binari del pack (modalità `opaque`): artwork già finito, embeddato
// come data URI nell'SVG composto. Stesso guard anti-traversal del loader SVG;
// il path arriva solo dal manifest, mai dall'input utente.
const qualityAssetMemo = new Map<string, Promise<string | null>>()
const QUALITY_ASSET_MEMO_MAX = 64

function qualityAssetMime(iconPath: string): string | null {
  const ext = path.posix.extname(iconPath).toLowerCase()
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".png") return "image/png"
  if (ext === ".webp") return "image/webp"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  return null
}

function loadQualityAssetDataUri(iconPath: string): Promise<string | null> {
  const memo = qualityAssetMemo.get(iconPath)
  if (memo) return memo
  const p = (async (): Promise<string | null> => {
    try {
      if (iconPath.includes("..") || path.posix.normalize(iconPath) !== iconPath) return null
      const mime = qualityAssetMime(iconPath)
      if (!mime) return null
      const full = path.join(process.cwd(), "public", iconPath)
      const bytes = await fs.promises.readFile(full)
      return `data:${mime};base64,${bytes.toString("base64")}`
    } catch {
      return null
    }
  })()
  p.catch(() => { if (qualityAssetMemo.get(iconPath) === p) qualityAssetMemo.delete(iconPath) })
  if (qualityAssetMemo.size >= QUALITY_ASSET_MEMO_MAX) qualityAssetMemo.delete(qualityAssetMemo.keys().next().value!)
  qualityAssetMemo.set(iconPath, p)
  return p
}

function qualityIconViewBox(svg: string): { w: number; h: number } | null {
  const m = svg.match(/viewBox="([\d.\-\s]+)"/)
  if (!m) return null
  const parts = m[1].trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) return null
  return { w: parts[2], h: parts[3] }
}

/**
 * Rende un'icona qualità built-in. Tier `color` (e `premium`, che riusa
 * l'arte color): stesso ingombro verticale della pill standard (stesso anchor
 * di layout), color originale. Il tier `mono` NON passa più da qui: usa il
 * frame dinamico condiviso con l'età (`renderAgeEmphasisBadge`), così qualità
 * ed età non possono divergere in due materiali mono. Marchi A/V: il glifo
 * nudo (`renderBareAvIcon`, larghezza d'inchiostro normalizzata) resta come
 * utilità per i chiamanti — il gruppo qualità/età li disegna dentro la
 * cornice dello stile (`renderFramedAvBadge`, pill satinata / contorno mono).
 * Ritorna null se il file manca o non rasterizza: il chiamante degrada sulla
 * pill standard, mai 500.
 */
export async function renderQualityIconBadge(
  iconPath: string,
  pw: number,
  topLight?: boolean,
  /** Larghezza d'inchiostro imposta ai marchi A/V (default: larghezza 4K). */
  inkWidth?: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  try {
    const built = await buildQualityIconSvg(iconPath, pw, topLight, inkWidth)
    if (!built) return null
    const png = await renderSVG(built.svg, built.w)
    return { png, w: built.w, h: built.h }
  } catch {
    return null
  }
}

/**
 * SVG spec of a single quality/AV mark (canvas + intrinsic size), WITHOUT
 * rasterizing it. The group renderer composes every spec into one SVG so a
 * multi-mark stack costs ONE resvg instance instead of one per mark; the
 * public `render*` wrappers rasterize a spec exactly like before (same
 * `renderSVG(svg, w)` call → byte-identical single-mark output).
 */
interface BadgeSvgSpec {
  readonly svg: string
  readonly w: number
  readonly h: number
}

/**
 * Resolved quality mark: built-in A/V format or pack mark. `tintable` marks go
 * through the existing per-style builders; `opaque` marks are embedded as-is
 * (`aspect` = natural width / height).
 */
interface QualityMarkSpec {
  readonly id: string
  readonly iconPath: string
  readonly label: string
  readonly mode: "tintable" | "opaque"
  readonly aspect: number | null
}

async function buildQualityIconSvg(
  iconPath: string,
  pw: number,
  topLight?: boolean,
  /** Larghezza d'inchiostro imposta ai marchi A/V (default: larghezza 4K). */
  inkWidth?: number,
  /**
   * Render-only ink box override (senza-pill `naked` style only, the sole
   * style on the bare-icon path). It passes the family-parity/optical-cap box
   * (`avMarkGroupInkBox`); every other style keeps the measured asset box
   * (historic bytes).
   */
  inkOverride?: AvMarkInkBox | null,
  /** Fill substitutions on the tier asset (`premium`: frame/plate recolored
   *  to the premium plate so the tier matches its A/V plates). */
  recolor?: Readonly<Record<string, string>>,
): Promise<BadgeSvgSpec | null> {
  try {
    const raw = await loadQualityIconSvg(iconPath)
    if (!raw) return null
    const src = recolor
      ? Object.entries(recolor).reduce((s, [from, to]) => s.replaceAll(`fill="${from}"`, `fill="${to}"`), raw)
      : raw
    // Marchio A/V: viewBox ritagliato sull'inchiostro e larghezza normalizzata.
    // Il tier (mono/color) non entra qui: percorso storico byte-identico.
    const ink = inkOverride ?? avMarkInkBox(iconPath)
    if (ink) return buildBareAvIconSvg(src, ink, pw, topLight, inkWidth)
    const vb = qualityIconViewBox(src)
    if (!vb) return null
    const isMono = !/(^|\/)color\//.test(iconPath)
    // Stessa base della pill standard (17px su griglia 380): l'icona occupa
    // lo stesso ingombro verticale, qscale/qox/qoy invariati a valle.
    const fs = Math.round(Math.max(17 * pw / 380, 10))
    const targetH = badgeBoxHeight(fs)
    const w = Math.max(1, Math.round(targetH * (vb.w / vb.h)))
    const h = Math.max(1, Math.round(w * (vb.h / vb.w)))
    const fill = isMono ? (topLight ? "#000000" : "#ffffff") : null
    const totalW = w + TOP_SHADOW_PAD * 2
    const totalH = h + TOP_SHADOW_PAD * 2
    const innerContent = svgInnerContent(src)
    const fillAttr = fill ? ` fill="${fill}" color="${fill}"` : ""
    // Ombra reale simmetrica con feDropShadow (dx=2, dy=2, stdDev=2.5):
    // stacca l'icona mono/color da sfondi chiari o complessi, mentre
    // il padding TOP_SHADOW_PAD mantiene l'esatto ancoraggio visivo a valle.
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
      `<defs>${TOP_SHADOW_FILTER}</defs>` +
      `<g filter="url(#tds)">` +
      `<svg x="${TOP_SHADOW_PAD}" y="${TOP_SHADOW_PAD}" width="${w}" height="${h}" viewBox="0 0 ${vb.w} ${vb.h}"${fillAttr}>${innerContent}</svg>` +
      `</g></svg>`
    return { svg: compositeSvg, w: totalW, h: totalH }
  } catch {
    return null
  }
}

const DOLBY_ICON_RE = /(^|\/)dolby-[a-z-]+\.svg$/
function isDolbyIconPath(iconPath: string): boolean {
  return DOLBY_ICON_RE.test(iconPath)
}

/** Horizontal glyph inset (em of fs) of the Dolby logo in text-style frames:
 *  clears the outline border/scrim padding on every text style. */
const DOLBY_LOGO_INSET_FACTOR = 0.35
/** Unframed styles (editoriale): no visible column, the logo is sized by the
 *  `4K` text height alone (width follows the logo aspect). */
const DOLBY_LOGO_UNFRAMED_W = 10_000
/** Gap (px) between the Dolby logo and the editoriale underline below it. */
const EDITORIAL_RULE_GAP = 2

/**
 * Text styles (nova/gradient/outline/strip/editoriale): replace the single
 * centred `<text>` label of a mark with the Dolby logo, same frame, same
 * position and the label's own ink (solid hex or gradient url). Size follows
 * the shared plate glyph rule (column width minus inset, capped at the `4K`
 * text height). Falls back to the text mark when anything is missing.
 */
async function withDolbyLogo(spec: BadgeSvgSpec, iconPath: string, frameW: number, fs: number): Promise<BadgeSvgSpec> {
  const src = await loadQualityIconSvg(iconPath)
  const ink = avMarkInkBox(iconPath)
  const m = /<text x="([\d.]+)" y="([\d.]+)"([^>]*)>[^<]*<\/text>/.exec(spec.svg)
  if (!src || !ink || !m) return spec
  const fill = /\sfill="([^"]*)"/.exec(m[3])?.[1] ?? /<g fill="([^"]*)"/.exec(spec.svg)?.[1] ?? "#ffffff"
  const g = avPlateGlyphBox(ink, frameW, badgeBoxHeight(fs), fs, DOLBY_LOGO_INSET_FACTOR)
  // Editoriale underlines the label: keep the rule, the logo sits above it.
  const rule = /^<rect x="[\d.]+" y="([\d.]+)"/.exec(spec.svg.slice(m.index + m[0].length))
  const cy = rule ? Math.min(Number(m[2]), Number(rule[1]) - EDITORIAL_RULE_GAP - g.h / 2) : Number(m[2])
  const logo = dolbyLogoSvg(src, ink, Number(m[1]), cy, g.w, g.h, fill)
  return { ...spec, svg: spec.svg.replace(m[0], logo) }
}

/** The Dolby asset centred on (cx, cy) at w×h, recolored to `fill`. */
function dolbyLogoSvg(src: string, ink: AvMarkInkBox, cx: number, cy: number, w: number, h: number, fill: string): string {
  const color = fill.startsWith("url(") ? "" : ` color="${fill}"`
  return `<svg x="${Math.round(cx - w / 2)}" y="${Math.round(cy - h / 2)}" width="${w}" height="${h}" viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" fill="${fill}"${color}>${svgInnerContent(src).replaceAll("currentColor", fill)}</svg>`
}

/** Merged `strip`: Dolby segments (combo / DV / Atmos) drawn as the logo,
 *  `4K`-text tall, white like the strip text. Null when no Dolby label. */
async function stripDolbyGlyph(labelIcons: ReadonlyMap<string, string>): Promise<StripSegmentGlyph | undefined> {
  const logos = new Map<string, { src: string; ink: AvMarkInkBox }>()
  for (const [label, iconPath] of labelIcons) {
    const src = await loadQualityIconSvg(iconPath)
    const ink = avMarkInkBox(iconPath)
    if (src && ink) logos.set(label, { src, ink })
  }
  if (logos.size === 0) return undefined
  return (label, glyphFs) => {
    const logo = logos.get(label)
    if (!logo) return null
    const h = avMarkCapHeight(glyphFs)
    const w = Math.max(1, Math.round(h * (logo.ink.w / logo.ink.h)))
    return { w, render: (cx, cy) => dolbyLogoSvg(logo.src, logo.ink, cx, cy, w, h, "#ffffff") }
  }
}

/** Contenuto interno di un asset SVG (senza prologo XML e tag radice). */
function svgInnerContent(src: string): string {
  return src.replace(/<\?xml[^>]*\?>/g, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
}

/**
 * Marchio A/V nudo (standard/mono): stessa ombra delle altre icone, ma la
 * larghezza è quella dell'INCHIOSTRO visibile (`inkWidth`, default = badge
 * 4K) e il viewBox è ritagliato sul box dell'ink. Senza il ritaglio i margini
 * trasparenti di HDR (~12% per lato), HDR10+ (~7%) e combo (~5%) renderebbero
 * la larghezza visibile diversa da quella nominale. L'altezza segue l'aspect
 * naturale dell'ink: nessuna distorsione, nessuno stretch a altezza uguale.
 */
async function buildBareAvIconSvg(
  src: string,
  ink: AvMarkInkBox,
  pw: number,
  topLight: boolean | undefined,
  inkWidth: number | undefined,
): Promise<BadgeSvgSpec> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const w = Math.max(1, Math.round(inkWidth ?? qualityIconReferenceWidth(badgeBoxHeight(fs))))
  const h = Math.max(1, Math.round(w * (ink.h / ink.w)))
  const fill = topLight ? "#000000" : "#ffffff"
  const totalW = w + TOP_SHADOW_PAD * 2
  const totalH = h + TOP_SHADOW_PAD * 2
  const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<defs>${TOP_SHADOW_FILTER}</defs>` +
    `<g filter="url(#tds)">` +
    `<svg x="${TOP_SHADOW_PAD}" y="${TOP_SHADOW_PAD}" width="${w}" height="${h}" viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" fill="${fill}" color="${fill}">${svgInnerContent(src)}</svg>` +
    `</g></svg>`
  return { svg: compositeSvg, w: totalW, h: totalH }
}

/**
 * Marchio A/V su placca (stili `color` e `premium`): la placca ha ESATTAMENTE
 * la larghezza del badge 4K dello stile attivo (`plateWidth`, = icona tier),
 * quindi ogni placca della colonna è larga quanto il tier 4K e i marchi non
 * sporgono. Il glifo si adatta DENTRO la placca con un margine uniforme
 * piccolo (`AV_PLATE_GLYPH_INSET_FACTOR`) e l'aspect dell'asset: viewBox
 * ritagliato sull'ink visibile, altezza naturale, mai stirata. La placca
 * ignora la polarità del fondo (i colori restano leggibili su top chiari e
 * scuri).
 */
async function buildPlatedAvBadgeSvg(
  iconPath: string,
  pw: number,
  plateWidth: number,
  glyphHex: string,
  plateBg: string,
  plateStroke: string,
): Promise<BadgeSvgSpec | null> {
  try {
    const src = await loadQualityIconSvg(iconPath)
    if (!src) return null
    const ink = avMarkInkBox(iconPath)
    if (!ink) return null
    const fs = Math.round(Math.max(17 * pw / 380, 10))
    const boxH = badgeBoxHeight(fs)
    // Larghezza placca = larghezza del tier 4K (unica per tutti i marchi).
    const plateW = Math.max(1, Math.round(plateWidth))
    // Frame = the tier asset's own frame (radius + border thickness), so the
    // 4K tier and every A/V plate of the stack share one shape; glyph inside.
    const { strokeW, r, glyph } = tierAssetPlateGeometry(ink, plateW, boxH, fs)
    const totalW = plateW + TOP_SHADOW_PAD * 2
    const totalH = boxH + TOP_SHADOW_PAD * 2
    const ox = TOP_SHADOW_PAD
    const oy = TOP_SHADOW_PAD
    // Lo stroke (centrato sulla path in SVG) è tenuto DENTRO il box: il bordo
    // ESTERNO visibile finisce esattamente su [ox, ox + plateW) × [oy, oy +
    // boxH), cioè sulla larghezza/altezza del tier 4K dello stile attivo.
    const rectW = Math.max(1, plateW - strokeW)
    const rectH = Math.max(1, boxH - strokeW)
    const rectX = ox + strokeW / 2
    const rectY = oy + strokeW / 2
    const gx = ox + glyph.x
    const gy = oy + glyph.y
    // Placca + glifo tinto nello stesso gruppo con l'ombra 3D condivisa
    // (famiglia quality/rank/extra): nessuna placca annidata, nessun asset.
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
      `<defs>${TOP_SHADOW_FILTER}</defs>` +
      `<g filter="url(#tds)">` +
      `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${r}" fill="${plateBg}" stroke="${plateStroke}" stroke-width="${strokeW}"/>` +
      `<svg x="${gx}" y="${gy}" width="${glyph.w}" height="${glyph.h}" viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" fill="${glyphHex}" color="${glyphHex}">${svgInnerContent(src)}</svg>` +
      `</g></svg>`
    return { svg: compositeSvg, w: totalW, h: totalH }
  } catch {
    return null
  }
}

/**
 * Marchio A/V incorniciato come il resto della colonna (stili `standard` e
 * `mono`): il glifo resta quello dell'asset, con aspect nativo DENTRO la
 * cornice (`avPlateGlyphBox`: inset condiviso, mai stretch né padding
 * additivo che allarghi la colonna). La cornice è la ricetta della famiglia:
 *
 * - `satin` (stile `standard`): la STESSA pill satinata del tier/età —
 *   gradiente `satinPillStops`, raggio pieno `boxH/2`, bordo 1.5 a polarità
 *   (`SATIN_PILL_*`), ombra sul solo rect come nella pill testuale; il glifo
 *   porta l'inchiostro adattivo della pill (scuro su pill chiara, chiaro su
 *   pill scura).
 * - `mono` (stile `mono`): la STESSA cornice dell'età mono — `fill="none"`,
 *   raggio `AGE_KNOCKOUT_RADIUS_FACTOR`, stroke alto contrasto
 *   (`AGE_MONO_INK_*`/`AGE_MONO_STROKE_*`), glifo nello stesso inchiostro,
 *   ombra 3D sul gruppo come `buildAgeEmphasisSvg`.
 *
 * Larghezza visibile = colonna (`frameWidth`), altezza = `badgeBoxHeight(fs)`:
 * ogni tacca della colonna ha lo stesso box. `color`/`premium` restano sulle
 * placche esistenti, `knockout` sul tag bianco.
 */
/** Margine minimo tra glifo A/V e profilo della pill satin (em di fs). */
const AV_SATIN_GLYPH_MARGIN_FACTOR = 0.15

function satinGlyphBox(ink: { readonly w: number; readonly h: number }, frameW: number, boxH: number, fs: number) {
  const base = avPlateGlyphBox(ink, frameW, boxH, fs)
  const R = boxH / 2
  const half = base.h / 2
  const clearance = R - Math.sqrt(Math.max(0, R * R - half * half)) + fs * AV_SATIN_GLYPH_MARGIN_FACTOR
  return base.x >= clearance ? base : avPlateGlyphBox(ink, frameW, boxH, fs, clearance / fs)
}

async function buildFramedAvBadgeSvg(
  iconPath: string,
  pw: number,
  frameWidth: number,
  frame: "satin" | "mono",
  topLight: boolean | undefined,
): Promise<BadgeSvgSpec | null> {
  try {
    const src = await loadQualityIconSvg(iconPath)
    if (!src) return null
    const ink = avMarkInkBox(iconPath)
    if (!ink) return null
    const fs = Math.round(Math.max(17 * pw / 380, 10))
    const boxH = badgeBoxHeight(fs)
    const frameW = Math.max(1, Math.round(frameWidth))
    // Pill satin full-round: gli angoli del glifo restano dentro le estremità
    // tonde (clearance geometrica del semicerchio all'altezza del glifo +
    // margine), così i marchi bassi e larghi (Dolby) non rimpiccioliscono.
    const glyph = frame === "satin" ? satinGlyphBox(ink, frameW, boxH, fs) : avPlateGlyphBox(ink, frameW, boxH, fs)
    const totalW = frameW + TOP_SHADOW_PAD * 2
    const totalH = boxH + TOP_SHADOW_PAD * 2
    const ox = TOP_SHADOW_PAD
    const oy = TOP_SHADOW_PAD
    const gx = ox + glyph.x
    const gy = oy + glyph.y
    // Inchiostro del glifo: stessa polarità della cornice che lo contiene.
    const inkHex = frame === "mono"
      ? (topLight ? AGE_MONO_INK_LIGHT : AGE_MONO_INK_DARK)
      : (topLight ? SATIN_PILL_INK_LIGHT : SATIN_PILL_INK_DARK)
    const glyphSvg = `<svg x="${gx}" y="${gy}" width="${glyph.w}" height="${glyph.h}" viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" fill="${inkHex}" color="${inkHex}">${svgInnerContent(src)}</svg>`
    const body = frame === "satin"
      // Pill satinata: stessi attributi del rect di `buildQualityBadgeSvg`
      // (bordo centrato sul box, ombra applicata al rect, testo/glifo senza
      // ombra propria).
      ? `<rect x="${ox}" y="${oy}" width="${frameW}" height="${boxH}" rx="${Math.round(boxH / 2)}" fill="url(#qg)" stroke="${topLight ? SATIN_PILL_STROKE_LIGHT : SATIN_PILL_STROKE_DARK}" stroke-width="${SATIN_PILL_STROKE_WIDTH}" filter="url(#tds)"/>${glyphSvg}`
      // Cornice mono: bordo tenuto DENTRO il box (stessa regola dell'età
      // mono) e ombra 3D sul lockup intero.
      : (() => {
          const strokeW = Math.max(AGE_MONO_STROKE_MIN, Math.round(fs * AGE_MONO_STROKE_FACTOR))
          const r = Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)
          const rectW = Math.max(1, frameW - strokeW)
          const rectH = Math.max(1, boxH - strokeW)
          const monoInk = topLight ? AGE_MONO_INK_LIGHT : AGE_MONO_INK_DARK
          return `<g filter="url(#tds)"><rect x="${ox + strokeW / 2}" y="${oy + strokeW / 2}" width="${rectW}" height="${rectH}" rx="${r}" fill="none" stroke="${monoInk}" stroke-width="${strokeW}"/>${glyphSvg}</g>`
        })()
    const defs = frame === "satin"
      ? `<defs><linearGradient id="qg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(!!topLight)}</linearGradient>${TOP_SHADOW_FILTER}</defs>`
      : `<defs>${TOP_SHADOW_FILTER}</defs>`
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">${defs}${body}</svg>`
    return { svg: compositeSvg, w: totalW, h: totalH }
  } catch {
    return null
  }
}

/**
 * Marchio A/V `color`: glifo oro su placca scura con cornice oro — la stessa
 * famiglia cromatica del tier 4K `color` (palette campionata dall'asset).
 * `plateWidth` (default: larghezza del tier 4K) è la larghezza ESTERNA della
 * placca, non quella del glifo.
 */
export async function renderColorIconBadge(
  iconPath: string,
  pw: number,
  plateWidth?: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const built = await buildPlatedAvBadgeSvg(
    iconPath,
    pw,
    plateWidth ?? qualityIconReferenceWidth(badgeBoxHeight(fs)),
    COLOR_MARK_GLYPH,
    COLOR_MARK_PLATE_BG,
    COLOR_MARK_PLATE_STROKE,
  )
  if (!built) return null
  try {
    const png = await renderSVG(built.svg, built.w)
    return { png, w: built.w, h: built.h }
  } catch {
    return null
  }
}

/**
 * Marchio A/V `premium`: glifo colorato (accento premium) su placca scura
 * neutra. Placca e glifo condividono la geometria normalizzata di
 * `renderPlatedAvBadge`; cambia solo la palette (design Pictorium, non brand).
 * `plateWidth` default = larghezza del tier 4K, così ogni placca della colonna
 * è larga ESATTAMENTE quanto il badge 4K.
 */
export async function renderPremiumIconBadge(
  iconPath: string,
  pw: number,
  accentHex: string,
  plateWidth?: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(17 * pw / 380, 10))
  const built = await buildPlatedAvBadgeSvg(
    iconPath,
    pw,
    plateWidth ?? qualityIconReferenceWidth(badgeBoxHeight(fs)),
    accentHex,
    PREMIUM_PLATE_BG,
    PREMIUM_PLATE_STROKE,
  )
  if (!built) return null
  try {
    const png = await renderSVG(built.svg, built.w)
    return { png, w: built.w, h: built.h }
  } catch {
    return null
  }
}

/**
 * Marchio A/V `knockout`: tag BIANCO opaco con il glifo ritagliato via mask
 * e riempito dall'inchiostro nero al `KNOCKOUT_INK_OPACITY` (70%) disegnato
 * SOPRA l'artwork visibile nel ritaglio, come il tag knockout del tier 4K:
 * il glifo resta scuro stabile conservando il 30% di artwork. Il tag è largo
 * quanto il tag knockout 4K (`tagWidth`), il glifo interno conserva
 * l'inchiostro del badge 4K (`inkWidth`) e l'aspect naturale. Nessuno stroke.
 */
export async function renderAvKnockoutBadge(
  iconPath: string,
  pw: number,
  tagWidth: number,
  inkWidth: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const built = await buildAvKnockoutBadgeSvg(iconPath, pw, tagWidth, inkWidth)
  if (!built) return null
  try {
    const png = await renderSVG(built.svg, built.w)
    return { png, w: built.w, h: built.h }
  } catch {
    return null
  }
}

async function buildAvKnockoutBadgeSvg(
  iconPath: string,
  pw: number,
  tagWidth: number,
  inkWidth: number,
): Promise<BadgeSvgSpec | null> {
  try {
    const src = await loadQualityIconSvg(iconPath)
    if (!src) return null
    const ink = avMarkInkBox(iconPath)
    if (!ink) return null
    const fs = Math.round(Math.max(17 * pw / 380, 10))
    const boxH = badgeBoxHeight(fs)
    const tagW = Math.max(1, Math.round(tagWidth))
    const widthBoundW = Math.min(tagW, Math.max(1, Math.round(inkWidth)))
    // Same optical cap as the plates: never taller than the `4K` text.
    const glyphH = Math.min(Math.max(1, Math.round(widthBoundW * (ink.h / ink.w))), avMarkCapHeight(fs))
    const glyphW = Math.min(widthBoundW, Math.max(1, Math.round(glyphH * (ink.w / ink.h))))
    const r = Math.round(boxH * AV_KNOCKOUT_RADIUS_FACTOR)
    const totalW = tagW + TOP_SHADOW_PAD * 2
    const totalH = boxH + TOP_SHADOW_PAD * 2
    const ox = TOP_SHADOW_PAD
    const oy = TOP_SHADOW_PAD
    const gx = ox + Math.round((tagW - glyphW) / 2)
    const gy = oy + Math.round((boxH - glyphH) / 2)
    const glyph = `<svg x="${gx}" y="${gy}" width="${glyphW}" height="${glyphH}" viewBox="${ink.x} ${ink.y} ${ink.w} ${ink.h}" fill="#000000" color="#000000">${svgInnerContent(src)}</svg>`
    const mask = `<mask id="avkm"><rect x="${ox}" y="${oy}" width="${tagW}" height="${boxH}" rx="${r}" fill="#ffffff"/>` +
      glyph +
      `</mask>`
    // Shadow ON the masked rect (same construction as
    // `buildQualityKnockoutSvg`): filtering a wrapping <g> makes resvg keep
    // the mask partial instead of cutting through, so the glyph would read
    // as grey on white instead of a clean cut-out showing the artwork.
    // The LIGHT outer ring comes from the shared `knockoutOuterShadow`
    // (same layer as the tier tag): the masked 3D shadow above leaves no
    // halo outside the tag, so the white mark needs its own soft ring.
    const shadow = knockoutOuterShadow("avko", totalW, totalH, { x: ox, y: oy, w: tagW, h: boxH, r })
    // The ink reuses the exact glyph geometry of the mask, drawn ABOVE the
    // masked tag: group opacity composites it over the artwork inside the
    // cut-out (never over the opaque white body, which would hide the poster).
    const inkEl = `<g opacity="${KNOCKOUT_INK_OPACITY}">${glyph}</g>`
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
      `<defs>${mask}${shadow.defs}${TOP_SHADOW_FILTER}${KNOCKOUT_SHADOW_FILTER}</defs>` +
      `${shadow.layer}` +
      `<rect x="${ox}" y="${oy}" width="${tagW}" height="${boxH}" rx="${r}" fill="#ffffff" mask="url(#avkm)" filter="url(#tds)"/>` +
      inkEl +
      `</svg>`
    return { svg: compositeSvg, w: totalW, h: totalH }
  } catch {
    return null
  }
}

/** One painted element of the quality/AV stack (stable identity + final box). */
export interface QualityBadgeItem {
  /** Stable identity (`badge-item-transforms`), never an array index. */
  readonly id: string
  /** Box inside the composed group bitmap (px), the box the layout chose. */
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  /** Present only when the item is DETACHED (it owns a per-item correction). */
  readonly png?: Buffer
}

/** Composed quality group + the authoritative box of every painted element. */
export interface QualityBadgeGroupResult {
  readonly png: Buffer
  readonly w: number
  readonly h: number
  readonly items: readonly QualityBadgeItem[]
  /**
   * Boxes of the quality HOMES this render does NOT paint (box only, no png):
   * the renderer reports them so the settings preview can draw a draggable
   * dashed ghost for every empty home. In the group bitmap's own coordinates,
   * exactly like `items`, and computed here (never at request time) so a
   * cached group is as complete as a fresh one. The geometry REPORT decides
   * whether to publish them (`?ghosts=1`): the Stremio render path never does.
   */
  readonly homeGhosts: readonly QualityHomeGhost[]
}

/** One empty quality home: stable home identity + its (box-only) placement. */
export interface QualityHomeGhost {
  /** `quality:home:<kind>` (`badge-item-transforms`), never a position. */
  readonly id: string
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

/**
 * Renderizza la colonna verticale qualità + età + formati A/V (es. [4K] sopra
 * [VM14] sopra [DV] sopra [ATMOS]). Ordine fisso: tier qualità, pill età,
 * formati — mai indipendente, mai un secondo renderer.
 * Se non ci sono formati o falliscono, ritorna il singolo badge di risoluzione.
 * `ageLabel` (etichetta età già sanificata, es. "VM14"): pill testuale in
 * stile `ageStyle` ("standard" = stessa pill neutra della qualità, base 17px;
 * "knockout" = white tag with mask-cut glyphs (transparent cut-out,
 * dedicated age-only builder — never the shared quality-knockout builder,
 * which stays byte-identical); "mono"/"color"/"premium" = shared age
 * emphasis recipe `buildAgeEmphasisSvg` on the same age family box; "nova" =
 * the SAME shared recipe with the Nova material (`AgeEmphasisStyle` "nova"),
 * also used by the quality tier and every A/V mark) between
 * tier and formats, with the same offset/scale/cap del gruppo a valle. Senza
 * qualità né formati ma con età, il gruppo rende la sola pill età (il badge
 * non richiede il 4K).
 * Senza nessuno dei tre → null (nessun composite, percorso storico intatto).
 *
 * COLONNA COMUNE: quando il gruppo ha davvero più di un elemento, ogni box
 * TESTUALE (tier e età) è reso nella stessa larghezza VISIBILE del marchio 4K
 * dello stile attivo (`markRefWidth`), la stessa già usata dai marchi A/V.
 * Non è solo una tela trasparente uguale: il box visibile (pill/tag/placca)
 * coincide, e le etichette più larghe (FHD, PG-13, TV-MA) riducono il font
 * (`fitBadgeGlyphFs`, metriche condivise) invece di allargare la colonna o
 * stirare i glifi. Altezza/raggio/padding restano quelli della ricetta di
 * base, quindi la banda della colonna e il centro sono comuni. I marchi A/V
 * portano la cornice dello stile (pill satinata per `standard`, contorno mono
 * per `mono`, placca per `color`/`premium`, tag bianco per `knockout`) e il
 * glifo conserva l'aspect nativo DENTRO la cornice (mai stretch). Un solo
 * elemento resta il bitmap storico naturale (nessuna normalizzazione
 * inventata).
 *
 * Per-ITEM transforms: every painted element carries its stable identity
 * (`badge-item-transforms`: tier / age / one A/V mark / the merged DV+Atmos
 * combo) and the FINAL box it occupies inside this bitmap. An element with a
 * non-neutral per-item correction is DETACHED: its box stays where the
 * automatic layout put it (nothing else moves) and its own bitmap is returned
 * so the caller can composite it independently at the transformed position.
 * Without corrections the composite is exactly the historic one.
 *
 * Per-HOME transforms (`quality:home:<kind>`, see `badge-item-transforms`): a
 * home is a NAMED content group of the stack (tier / age / dolby / hdr /
 * imax), not a position. When a home correction is stored, the automatic stack
 * box of the painted element of that group is REPLACED by its ISOLATED
 * reference box — the group's pinned column (`markRefWidth`) at the group
 * anchor, with the style's text-family height — so the correction is the same
 * box on every title and every format set (neighbours are ignored). The
 * element STAYS in the group: nothing else moves, the stack canvas is
 * recomputed from the final boxes (never smaller than the automatic frame, so
 * a move past the frame grows the canvas instead of clipping), and only a
 * non-neutral IDENTITY correction still detaches an element. No stored home =
 * byte-identical output, including the single-element historic bitmap.
 * The empty homes of this render are reported as box-only `homeGhosts` (no
 * png): they exist for the settings preview ghost handles and never change a
 * pixel.
 */
export async function renderQualityBadgeGroup(
  quality: string | null | undefined,
  qualityBadgeStyle: QualityBadgeStyle | null | undefined,
  videoFormats: readonly string[] | null | undefined,
  pw: number,
  topLight?: boolean,
  /** Font della pill testuale (default "inter" = resa storica; le icone mono/color restano invariate). */
  font: BadgeFont = "inter",
  /** Etichetta età sanificata (null/"" = assente). */
  ageLabel?: string | null,
  /** Stile della pill età (default "standard" = resa storica). */
  ageStyle?: AgeBadgeStyle | null,
  /** Per-item corrections by stable identity (empty/absent = automatic). */
  itemTransforms?: BadgeItemTransformMap | null,
  /**
   * Group layout: `stacked` (default, historic single column) or `row`
   * (horizontal, max `QUALITY_GROUP_ROW_MAX_ITEMS` per line). Absent/invalid
   * = `stacked`, so every legacy call site keeps its exact bytes.
   */
  qualityGroupLayout?: QualityGroupLayout | string | null,
): Promise<QualityBadgeGroupResult | null> {
  const ageText = typeof ageLabel === "string" ? ageLabel.trim() : ""
  const effAgeStyle: AgeBadgeStyle = isAgeBadgeStyle(ageStyle) ? ageStyle : DEFAULT_AGE_BADGE_STYLE
  const qualityText = typeof quality === "string" ? quality : ""
  const hasQuality = qualityText !== ""
  const isKnockout = qualityBadgeStyle === "knockout"
  // Premium: marchi A/V colorati su placca scura compatta; il tier riusa
  // l'asset `color` (qualityBadgeIconPath → stessa arte, nessun set nuovo).
  const isPremium = qualityBadgeStyle === "premium"
  const isColor = qualityBadgeStyle === "color"
  const isMono = qualityBadgeStyle === "mono"
  // Nova: materiale SVG 100% dinamico (nessun asset) condiviso da tier 4K/
  // FHD/HD/SD, età e marchi A/V — una sola ricetta, mai un secondo renderer.
  const isNova = qualityBadgeStyle === "nova"
  // Gradient: glifi nudi extra-bold, nessun contenitore — 100% SVG dinamico
  // (nessun asset) condiviso da tier, età e marchi A/V: bianco pieno per
  // tier/età, gradiente orizzontale per formato (`GRADIENT_MARK_STOPS`).
  const isGradient = qualityBadgeStyle === "gradient"
  // Naked: the WHOLE group is plate-less — standard text box with the pill
  // container removed for the tier, the existing bare ink path for the A/V
  // marks and the same naked builder for the default age pill. An explicit
  // non-standard `agebs` keeps its own material (independent control wins).
  const isNaked = qualityBadgeStyle === "naked"
  // Outline: materiale wireframe 100% dinamico (rect stroked senza fill +
  // scrim interno + inchiostro satin), condiviso da tier, età e marchi A/V —
  // nessun asset, nessun secondo renderer.
  const isOutline = qualityBadgeStyle === "outline"
  // Editoriale: maiuscolo Oswald tracciato + lineetta, nessuna placca, stessa
  // scatola di testo degli altri marchi (tier, età e A/V con etichetta breve).
  const isEditorial = qualityBadgeStyle === "editoriale"
  // Strip: materiale a placca scura condiviso (una sola ricetta con
  // tier/età/marchi A/V). Il LAYOUT del gruppo è un parametro esplicito
  // (`qgl` > mapping > token > defaults > `stacked`), indipendente dallo
  // stile: in `row` lo strip resta la placca UNICA merged (wrappa 2 per riga
  // da solo), in `stacked` rende una placca per marchio impilata in colonna
  // (stesse identità/box per-item di ogni altro stile).
  const groupLayout = resolveQualityGroupLayout(qualityGroupLayout)
  const isStripStyle = qualityBadgeStyle === "strip"
  const isStrip = isMergedQualityStrip(qualityBadgeStyle, groupLayout)
  const isRowLayout = groupLayout === "row"
  // Larghezza UNICA dei marchi A/V, derivata dal badge 4K dello stile attivo
  // (mai dall'aspect del singolo logo). Include il font perché i tag testuali
  // (standard/knockout/mono) cambiano larghezza con la font. Per `color`/
  // `premium` è la larghezza ESTERNA della placca ( = icona tier 4K): il glifo
  // ci sta dentro con un inset piccolo, mai un padding additivo che allarghi
  // la colonna oltre il tier. Per `nova` è la larghezza visibile del 4K Nova.
  //
  // `naked` (senza-pill) optical enlargement: without a plate the group has no
  // solid mass, so at the shared base font it reads visibly smaller than every
  // plated style on the same slot. The WHOLE group is enlarged uniformly for
  // THIS STYLE ONLY (nominal +12.5% → integer font 17→19 at pw=380, i.e.
  // +11.8% on the font/column): the tier text, the default age text, the
  // pinned common column (`markRefWidth`, derived from this same `markFs`) and
  // therefore every A/V mark that normalizes to that column. Shapes, aspect,
  // HDR parity, optical cap, anchor/scale/offset chain and the per-item
  // identity/home boxes stay the same by construction (they all derive from
  // `markFs`). Every other style keeps the exact historic base font/bytes.
  const baseMarkFs = Math.round(Math.max(17 * pw / 380, 10))
  const markFs = isNaked ? Math.round(baseMarkFs * NAKED_GROUP_SCALE) : baseMarkFs
  const markFont = normalizeBadgeFont(font)
  const markRefWidth = (() => {
    if (isKnockout) {
      return Math.max(1, buildQualityKnockoutSvg("4K", markFs, markFont).w - TOP_SHADOW_PAD * 2)
    }
    // Stile mono: il tier è la STESSA cornice dinamica dell'età mono, quindi
    // la colonna è la larghezza visibile del frame 4K (non più l'asset icona
    // statico, che non è più usato dal renderer).
    if (isMono) {
      return Math.max(1, buildAgeEmphasisSvg("4K", markFs, "mono", !!topLight, markFont).w - TOP_SHADOW_PAD * 2)
    }
    // Nova: il materiale è dinamico come il mono — la colonna è la larghezza
    // visibile della lastra 4K Nova (stessa ricetta di tier/età/marchi A/V).
    if (isNova) {
      return Math.max(1, buildAgeEmphasisSvg("4K", markFs, "nova", false, markFont).w - TOP_SHADOW_PAD * 2)
    }
    // Gradient: la placca scura condivisa è larga quanto la banda visibile
    // del 4K "bianco" nella stessa ricetta (placca + glifi + padding del box).
    if (isGradient) {
      return Math.max(1, buildGradientMarkSvg("4K", markFs, GRADIENT_TIER_INK, markFont).w - TOP_SHADOW_PAD * 2)
    }
    // Outline: la colonna è la larghezza visibile del wireframe 4K (stessa
    // ricetta condivisa di tier/età/marchi A/V).
    if (isOutline) {
      return Math.max(1, buildAgeEmphasisSvg("4K", markFs, "outline", !!topLight, markFont).w - TOP_SHADOW_PAD * 2)
    }
    if (isEditorial) {
      return Math.max(1, buildEditorialMarkSvg("4K", markFs, !!topLight).w - TOP_SHADOW_PAD * 2)
    }
    // Strip: la colonna è la SINGOLA placca scura del 4K (stessa ricetta della
    // strip merged — padX airier, inchiostro bianco, placca `gradient`
    // family), così ogni marchio dello stack condivide la stessa larghezza
    // visibile.
    if (isStripStyle) {
      return Math.max(1, buildStripBadgeSvg(["4K"], markFs, markFont).w - TOP_SHADOW_PAD * 2)
    }
    // Stile standard: la colonna è larga quanto la PILL neutra 4K (stessa
    // ricetta dell'età: satinatura, padding 0.75×fs, raggio a mezza altezza).
    // Ogni tier testuale usa questa ricetta, non un tag più largo/quadrato.
    // `naked` condivide la STESSA scatola di testo (nessun padding/box
    // diverso): la colonna resta identica allo standard per costruzione.
    if (!isPremium && !isColor) {
      return Math.max(1, buildQualityBadgeSvg("4K", markFs, "", "", !!topLight, markFont).w - TOP_SHADOW_PAD * 2)
    }
    return qualityIconReferenceWidth(badgeBoxHeight(markFs))
  })()
  // -------------------------------------------------------------------
  // ISOLATED home frame (single source of the home geometry).
  //
  // A home correction must be identical on every title, so its base cannot be
  // the automatic stack box (that one depends on the painted neighbours).
  // The base is the group's OWN pinned column — `markRefWidth`, the width
  // every element of a real stack is normalized to — at the group ANCHOR (the
  // top-left of the group frame, i.e. the position the automatic layout gives
  // the first painted element) with the style's text-family box height.
  // `homeGhosts` uses this frame directly; a painted element uses its own
  // bitmap centred in it (same box for every style: every element of a stack
  // is `badgeBoxHeight(markFs) + 2 * TOP_SHADOW_PAD` tall).
  // -------------------------------------------------------------------
  const homeFrameW = markRefWidth + TOP_SHADOW_PAD * 2
  const homeFrameH = badgeBoxHeight(markFs) + TOP_SHADOW_PAD * 2
  /** Stored HOME correction of a painted identity (null = automatic stack). */
  const homeTransform = (id: string): BadgeItemTransform | null => {
    const homeId = homeIdForPainted(id)
    if (!homeId) return null
    const t = badgeItemTransform(itemTransforms ?? null, homeId)
    return t && !isNeutralBadgeItemTransform(t) ? t : null
  }
  /** Isolated reference box of a painted element (pinned column, group anchor). */
  const homeReference = (badge: { readonly w: number; readonly h: number }): { top: number; left: number; w: number; h: number } => ({
    top: Math.round((homeFrameH - badge.h) / 2),
    left: Math.round((homeFrameW - badge.w) / 2),
    w: badge.w,
    h: badge.h,
  })
  /**
   * Box-only placement of every home this render does NOT paint: the isolated
   * frame plus its stored correction (neutral when none), i.e. exactly the box
   * the badge of that group would occupy once the title paints it.
   */
  const collectHomeGhosts = (paintedIds: readonly string[]): QualityHomeGhost[] => {
    const painted = new Set(
      paintedIds.flatMap((id) => {
        const homeId = homeIdForPainted(id)
        return homeId ? [homeId] : []
      }),
    )
    const out: QualityHomeGhost[] = []
    for (const homeId of BADGE_ITEM_QUALITY_HOMES) {
      if (painted.has(homeId)) continue
      const stored = badgeItemTransform(itemTransforms ?? null, homeId)
      const correction = stored && !isNeutralBadgeItemTransform(stored) ? stored : null
      const box = applyBadgeItemTransform({ top: 0, left: 0, w: homeFrameW, h: homeFrameH }, correction)
      out.push({ id: homeId, ...box })
    }
    return out
  }
  // Tag knockout: il tag resta largo come il tag knockout 4K, il glifo
  // ritagliato conserva l'inchiostro del badge 4K icona (margine per lato).
  // Sui marchi nudi `markInkWidth` è la larghezza d'inchiostro del glifo.
  const markInkWidth = isKnockout
    ? Math.max(1, markRefWidth - Math.round(markFs * AV_KNOCKOUT_TAG_INSET_FACTOR) * 2)
    : markRefWidth
  // Optical size of the BARE icon A/V marks of the senza-pill `naked` style
  // only (the sole style on the `buildQualityIconSvg` path; see
  // `avMarkGroupInkBox`): the cap is the tier TEXT cap height, so tall icon
  // wordmarks stop reading larger than the `4K` tier while width-bound marks
  // keep their bytes. Every other style keeps its pre-HDR measured box.
  const avCapHeight = avMarkCapHeight(markFs)
  /**
   * Un marchio nel layout `stacked` dello stile `strip`: UNA placca scura per
   * elemento (stessa ricetta/materiale/airier padding della strip merged, un
   * solo glifo), così lo stack resta per-marchio e maniglie per-item + homes
   * continuano a funzionare come ogni altro stile. `columnW` pinna la
   * larghezza VISIBILE alla colonna comune (font ridotto per stare dentro,
   * mai glifi stirati).
   */
  const buildStripMark = (
    label: string,
    columnW?: number,
  ): BadgeSvgSpec => buildStripBadgeSvg(
    [label],
    markFs,
    markFont,
    columnW != null ? Math.max(1, Math.round(columnW)) : undefined,
  )
  /**
   * Opaque pack mark: finished artwork embedded as-is (no tint, no frame, no
   * mask). Width is pinned to the group column (`markRefWidth`); height follows
   * the natural aspect and is contain-fitted to the tier box height, so a tall
   * sticker can never grow the stack. The shared 3D shadow keeps it seated on
   * the poster; no second material is introduced.
   */
  const buildOpaqueMarkSvg = async (
    iconPath: string,
    markWidth: number,
    aspect: number | null,
  ): Promise<BadgeSvgSpec | null> => {
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return null
    const data = await loadQualityAssetDataUri(iconPath)
    if (!data) return null
    const opaqueFs = Math.round(Math.max(17 * pw / 380, 10))
    const boxH = badgeBoxHeight(opaqueFs)
    const targetW = Math.max(1, Math.round(markWidth))
    const naturalH = Math.max(1, Math.round(targetW / aspect))
    const w = naturalH <= boxH ? targetW : Math.max(1, Math.round(boxH * aspect))
    const h = Math.max(1, Math.round(w / aspect))
    const totalW = w + TOP_SHADOW_PAD * 2
    const totalH = h + TOP_SHADOW_PAD * 2
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
      `<defs>${TOP_SHADOW_FILTER}</defs>` +
      `<g filter="url(#tds)">` +
      `<image x="${TOP_SHADOW_PAD}" y="${TOP_SHADOW_PAD}" width="${w}" height="${h}" href="${data}" preserveAspectRatio="xMidYMid meet"/>` +
      `</g></svg>`
    return { svg: compositeSvg, w: totalW, h: totalH }
  }

  /**
   * Un marchio qualità, con la stessa larghezza visibile in ogni stile:
   * standard = glifo dentro la pill satinata del tier/età; mono = glifo dentro
   * la cornice mono dell'età (fill none); color/premium = glifo dentro una
   * placca larga quanto il badge 4K; knockout = tag bianco con glifo
   * ritagliato (trasparente); nova = stessa lastra dinamica del tier/età con
   * l'etichetta breve del formato (nessun artwork per formato); gradient =
   * glifo nudo con il gradiente orizzontale del formato (stessa etichetta
   * breve, nessun artwork). I marchi `opaque` del pack saltano ogni materiale
   * e vengono embeddati as-is.
   *
   * Ritorna lo SVG spec (nessuna rasterizzazione): il gruppo compone tutti i
   * marchi in un solo SVG, il percorso legacy li rasterizza singolarmente.
   */
  const buildFormatMark = async (
    mark: QualityMarkSpec,
    topLightForMark: boolean | undefined,
    accentHex: string,
  ): Promise<BadgeSvgSpec | null> => {
    const { iconPath, label: novaLabel, mode, aspect } = mark
    // Opaque pack artwork is self-contained: never apply the style chrome
    // (plate/frame/mask/tint) — it would double-frame a finished badge.
    if (mode === "opaque") return buildOpaqueMarkSvg(iconPath, markRefWidth, aspect)
    // BARE icon sizing (family parity + optical cap) belongs ONLY to the
    // senza-pill `naked` style: it draws the A/V marks through the
    // `buildQualityIconSvg` bare-icon path with this exact box. Every other
    // style keeps its pre-HDR measured box (`avMarkInkBox`) unchanged.
    const bareInk = avMarkGroupInkBox(iconPath, markRefWidth, avCapHeight)
    // Text styles: Dolby marks show the Dolby logo in the style's own frame/ink.
    const dolby = (spec: BadgeSvgSpec): Promise<BadgeSvgSpec> =>
      isDolbyIconPath(iconPath) ? withDolbyLogo(spec, iconPath, isEditorial ? DOLBY_LOGO_UNFRAMED_W : markRefWidth, markFs) : Promise.resolve(spec)
    if (isStripStyle) {
      // Placca scura singola condivisa: un marchio A/V per placca (nessun
      // artwork per formato, l'etichetta breve è il glifo).
      return dolby(buildStripMark(novaLabel, markRefWidth))
    }
    if (isNova) {
      // Lastra dinamica condivisa: stessa ricetta di tier ed età, larghezza
      // pinnata alla colonna (`markRefWidth`) e font ridotto per stare dentro
      // (`fitBadgeGlyphFs` nel builder). Nessun asset per formato.
      return dolby(buildAgeEmphasisSvg(novaLabel, markFs, "nova", topLightForMark, markFont, markRefWidth))
    }
    if (isGradient) {
      // Glifo nudo con gradiente orizzontale del formato, risolto dal path
      // icona (firma invariata: nessun parametro nuovo). Larghezza pinnata alla
      // colonna e font ridotto per stare dentro, mai glifi stirati. Path non
      // registrato → inchiostro bianco (fail-safe: mai un gradiente di un
      // formato inventato).
      return dolby(buildGradientMarkSvg(novaLabel, markFs, gradientMarkStops(iconPath) ?? GRADIENT_TIER_INK, markFont, markRefWidth))
    }
    if (isEditorial) {
      // Unframed: every label keeps the same font (no column fit, no shrink).
      return dolby(buildEditorialMarkSvg(novaLabel, markFs, !!topLightForMark))
    }
    if (isOutline) {
      // Wireframe dinamico condiviso: l'etichetta breve del formato dentro la
      // stessa cornice di tier/età, larghezza pinnata alla colonna.
      return dolby(buildAgeEmphasisSvg(novaLabel, markFs, "outline", topLightForMark, markFont, markRefWidth))
    }
    if (isPremium) {
      return buildPlatedAvBadgeSvg(iconPath, pw, markRefWidth, accentHex, PREMIUM_PLATE_BG, PREMIUM_PLATE_STROKE)
    }
    if (isColor) {
      return buildPlatedAvBadgeSvg(iconPath, pw, markRefWidth, COLOR_MARK_GLYPH, COLOR_MARK_PLATE_BG, COLOR_MARK_PLATE_STROKE)
    }
    if (isKnockout) {
      return buildAvKnockoutBadgeSvg(iconPath, pw, markRefWidth, markInkWidth)
    }
    if (isNaked) {
      // Naked full group: reuse the EXISTING bare A/V path
      // (`renderQualityIconBadge` → `renderBareAvIcon`) — glyph in the
      // polarity ink (#000 on a light top, #fff on a dark top) with the shared
      // 3D shadow, NO frame/plate rect. Ink width is pinned to the common
      // group column and the height follows the asset aspect (never stretched
      // to the tier box height): a wide wordmark is honestly shorter than the
      // text boxes, so the stack (and a HOME frame) center it instead of
      // faking an equal height.
      return buildQualityIconSvg(iconPath, pw, topLightForMark, markRefWidth, bareInk)
    }
    // standard / mono: stessa cornice del tier e dell'età (mai un marchio nudo).
    return buildFramedAvBadgeSvg(iconPath, pw, markRefWidth, isMono ? "mono" : "satin", topLightForMark)
  }
  // The MONO tier is the shared dynamic frame (age mono recipe): no static
  // mono asset — the renderer must never mix the two materials.
  // Knockout has no icon asset (qualityBadgeIconPath stays null by design):
  // it renders its own tag below and never falls back to the standard pill.
  const qualityIconPath = !hasQuality || isKnockout || isMono || isNova || isOutline || isStripStyle || isEditorial ? null : qualityBadgeIconPath(qualityBadgeStyle, qualityText)
  // Nothing painted at all (no quality, no age): legacy path, no format work.
  // (With a quality, the tier ALWAYS renders: icon or text pill.)
  if (!hasQuality && ageText === "") return null

  // Dedupe + cap deterministico: l'ordine di selezione vince, i marchi oltre
  // il cap non entrano nel gruppo (né nel report per-item).
  const rawValidFormats = [...new Set((videoFormats ?? []).filter((f): f is string => isQualityMarkId(f)))]
    .slice(0, MAX_QUALITY_MARKS)
  // Priorità HDR10+ sul generico HDR (solo render, dopo la selezione
  // effettiva: DB/provenance/raw utente e chiavi cache invariati — il gruppo
  // non disegna HDR quando l'effettivo include anche HDR10+, in ogni ordine).
  const validFormats = rawValidFormats.includes("hdr10plus")
    ? rawValidFormats.filter((f) => f !== "hdr")
    : rawValidFormats

  // -------------------------------------------------------------------
  // `strip` layout (merged single plate) — additive, only when the style
  // resolves to `strip` (legacy styles keep the exact stacked path below).
  //
  // Same painted identities, same fixed order (tier, age, formats — merged
  // DV·Atmos lockup included), same group anchor/scale/offset chain: the
  // result is ONE bitmap with ONE shadow filter instead of one bitmap/filter
  // per mark, so the full stack costs 1 resvg + 1 filter. Per-item boxes are
  // still reported with the stable identities; a merged plate cannot detach a
  // single slice, so no per-item png/home ghosts are emitted for this layout.
  // -------------------------------------------------------------------
  if (isStrip) {
    const segments: { id: string; label: string }[] = []
    if (hasQuality) segments.push({ id: BADGE_ITEM_QUALITY_TIER, label: qualityText })
    if (ageText !== "") segments.push({ id: BADGE_ITEM_QUALITY_AGE, label: ageText })
    const stripCombo = validFormats.includes("dv") && validFormats.includes("atmos")
    if (stripCombo) segments.push({ id: BADGE_ITEM_QUALITY_COMBO, label: AV_COMBO_SHORT_LABEL })
    for (const fmt of validFormats) {
      if (stripCombo && (fmt === "dv" || fmt === "atmos")) continue
      const itemId = qualityFormatItemId(fmt)
      if (itemId) segments.push({ id: itemId, label: qualityMarkLabel(fmt) })
    }
    const painted = segments.filter((segment) => segment.label.trim() !== "")
    if (painted.length === 0) return null
    // Dolby segments render as the logo (label → icon of the painted mark).
    const dolbyLabels = new Map<string, string>()
    if (stripCombo) dolbyLabels.set(AV_COMBO_SHORT_LABEL, "quality-badges/video/dolby-vision-atmos.svg")
    for (const fmt of validFormats) {
      const iconPath = qualityMarkIconPath(fmt)
      if (iconPath && isDolbyIconPath(iconPath) && !(stripCombo && (fmt === "dv" || fmt === "atmos"))) {
        dolbyLabels.set(qualityMarkLabel(fmt), iconPath)
      }
    }
    const strip = buildStripBadgeSvg(
      painted.map((segment) => segment.label),
      markFs,
      markFont,
      Math.min(pw - 20, Math.round(pw * 0.84)),
      await stripDolbyGlyph(dolbyLabels),
    )
    const png = await renderSVG(strip.svg, strip.w)
    return {
      png,
      w: strip.w,
      h: strip.h,
      items: painted.map((segment, index) => ({
        id: segment.id,
        top: strip.segments[index].top,
        left: strip.segments[index].left,
        w: strip.segments[index].w,
        h: strip.segments[index].h,
      })),
      homeGhosts: [],
    }
  }

  const hasDV = validFormats.includes("dv")
  const hasAtmos = validFormats.includes("atmos")
  let useCombo = hasDV && hasAtmos
  let comboIcon: BadgeSvgSpec | null = null
  if (useCombo) {
    // Premium/color: single Dolby accent/glyph on the uniform plate (one
    // merged lockup). Knockout renders its own white tag (polarity moot).
    const comboAccent = premiumAccentHex(PREMIUM_COMBO_ACCENT)
    comboIcon = await buildFormatMark(
      {
        id: "combo",
        iconPath: "quality-badges/video/dolby-vision-atmos.svg",
        label: AV_COMBO_SHORT_LABEL,
        mode: "tintable",
        aspect: null,
      },
      topLight,
      comboAccent,
    )
    if (!comboIcon) useCombo = false
  }

  // One entry per PAINTED mark, with its stable identity. The merged Dolby
  // combo owns its own identity: the two singles it replaces are never drawn,
  // so their stored corrections stay inert (never transferred).
  const formatItems: { id: string; badge: BadgeSvgSpec }[] = []
  if (comboIcon) {
    formatItems.push({ id: BADGE_ITEM_QUALITY_COMBO, badge: comboIcon })
  }

  for (const fmt of validFormats) {
    if (useCombo && (fmt === "dv" || fmt === "atmos")) {
      continue
    }
    const iconPath = qualityMarkIconPath(fmt)
    if (!iconPath) continue
    const icon = await buildFormatMark(
      {
        id: fmt,
        iconPath,
        label: qualityMarkLabel(fmt),
        mode: qualityMarkMode(fmt),
        aspect: qualityMarkAspect(fmt),
      },
      topLight,
      premiumAccentHex(qualityMarkAccent(fmt)),
    )
    const itemId = qualityFormatItemId(fmt)
    if (icon && itemId) formatItems.push({ id: itemId, badge: icon })
  }
  // Pill età in stile `ageStyle`: standard = stessa pill testuale neutra
  // della qualità (base 17px, polarità topLight, font badge); knockout =
  // white tag with mask-cut glyphs (transparent cut-out, builder
  // dedicated age-only `renderAgeKnockoutBadge` builder: never the shared
  // quality-knockout builder, which stays byte-identical); mono/color/premium/
  // nova = shared emphasis recipe (`buildAgeEmphasisSvg`: mono = high-contrast
  // outline, the SAME material as the quality mono tier; color = tier palette
  // plate, premium = gold plate — those two stay age-only; nova = the dynamic
  // Nova plate shared with the quality tier and the A/V marks).
  // Sanitized text maiuscolo-minuscolo preservato (escSvg nel builder, mai
  // HTML grezzo).
  const buildAgePill = (columnW?: number): BadgeSvgSpec | null => {
    if (ageText === "") return null
    // Strip: lo stile possiede il materiale dei suoi marchi (placca scura
    // singola), come nella strip merged dove l'età è un semplice run di glifi:
    // gli stili età restano attivi per gli altri stili qualità.
    if (isStripStyle) return buildStripMark(ageText, columnW)
    // standard = neutral satin pill; knockout = age-only white tag;
    // mono/color/premium/nova = shared emphasis recipe in `badge-svg-shared.ts`
    // (mono is the same material as the quality mono tier); gradient = bare
    // extra-bold white glyphs (same material as the quality gradient tier).
    // Every branch keeps the age family box/height; `columnW` pins the VISIBLE
    // box to the common group width (glyph font reduced to fit, never a
    // stretched label).
    if (effAgeStyle === "knockout") return buildAgeKnockoutSvg(ageText, markFs, markFont, columnW)
    // Editoriale: età esplicita `editoriale`, oppure età standard dentro un
    // gruppo qualità editoriale (stessa regola del `naked`).
    if (effAgeStyle === "editoriale" || (isEditorial && effAgeStyle === "standard")) return buildEditorialMarkSvg(ageText, markFs, !!topLight, isEditorial ? undefined : columnW)
    if (effAgeStyle === "gradient") return buildGradientMarkSvg(ageText, markFs, GRADIENT_TIER_INK, markFont, columnW)
    if (effAgeStyle === "mono" || effAgeStyle === "color" || effAgeStyle === "premium" || effAgeStyle === "nova" || effAgeStyle === "outline") {
      return buildAgeEmphasisSvg(ageText, markFs, effAgeStyle, !!topLight, markFont, columnW)
    }
    if (isNaked) {
      // Naked full group: the default age pill loses its satin plate too,
      // reusing the SAME naked builder as the tier (identical box/geometry,
      // polarity ink + background-tone halo, shared 3D shadow on the glyphs).
      // Only the default `standard` age material is replaced: an explicit
      // non-standard `agebs` already returned above (independent control wins).
      return buildQualityNakedSvg(ageText, markFs, !!topLight, markFont, columnW)
    }
    return buildQualityBadgeSvg(
      ageText,
      markFs,
      topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)",
      topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)",
      !!topLight,
      markFont,
      columnW,
    )
  }

  // One VISIBLE column width for every painted element: the canonical 4K mark
  // of the active style (the reference the A/V marks already normalise to).
  // Only a real stack (2+ elements) pins it; a single element keeps its
  // historic natural box/bitmap. EXCEPTION: an element whose HOME is stored is
  // pinned to the same column even when it is the only painted one, otherwise
  // its home box would differ between a lone-badge title and a full stack
  // (the home must be the SAME box everywhere).
  const paintedCount = (hasQuality ? 1 : 0) + (ageText === "" ? 0 : 1) + formatItems.length
  const groupTargetW = paintedCount > 1 ? markRefWidth : undefined
  // Decoupled (approved): tier/age keep their NATURAL size unless a real group
  // column exists (groupTargetW). A stored HOME alone never resizes the badge
  // to the pinned column — the home frame is for positioning only, the canvas
  // grows to fit (matches quality-badge-styles WIP expectations).
  const tierTargetW = groupTargetW
  const ageTargetW = groupTargetW

  let resBadge: BadgeSvgSpec | null = null
  if (hasQuality) {
    if (isStripStyle) {
      // Placca scura singola (stesso materiale della strip merged): l'etichetta
      // reale del tier, un marchio per placca.
      resBadge = buildStripMark(qualityText, tierTargetW)
    } else if (isNova) {
      // Lastra dinamica condivisa (stessa ricetta di età e marchi A/V). SD è
      // incluso: nessun asset esterno, l'etichetta è sempre un parametro.
      resBadge = buildAgeEmphasisSvg(qualityText, markFs, "nova", topLight, markFont, tierTargetW)
    } else if (isGradient) {
      // Glifi nudi bianchi: stessa ricetta condivisa di età e marchi A/V, nessun
      // asset (anche SD: l'etichetta è un parametro).
      resBadge = buildGradientMarkSvg(qualityText, markFs, GRADIENT_TIER_INK, markFont, tierTargetW)
    } else if (isEditorial) {
      resBadge = buildEditorialMarkSvg(qualityText, markFs, !!topLight)
    } else if (isOutline) {
      // Wireframe condiviso (stessa ricetta di età e marchi A/V): l'etichetta
      // reale del tier dentro cornice+scrim, nessun asset.
      resBadge = buildAgeEmphasisSvg(qualityText, markFs, "outline", topLight, markFont, tierTargetW)
    } else if (qualityIconPath) {
      resBadge = await buildQualityIconSvg(qualityIconPath, pw, topLight, undefined, null, isPremium ? PREMIUM_TIER_RECOLOR : undefined)
    }
    if (!resBadge) {
      // Standard tier = the SAME neutral satin pill as the age standard
      // (buildQualityBadgeSvg: full rx = boxH/2, padding 0.75×fs). Mono tier =
      // the SAME dynamic frame as the age mono (buildAgeEmphasisSvg): the
      // actual label (4K/FHD/HD/SD) on the shared material, never the retired
      // static icon. In a real stack the group column pins every tier label to
      // the 4K box (font reduced to fit, never a stretched box).
      resBadge = isKnockout
        ? buildQualityKnockoutSvg(qualityText, markFs, markFont, tierTargetW)
        : isMono
          ? buildAgeEmphasisSvg(qualityText, markFs, "mono", !!topLight, markFont, tierTargetW)
          : isNaked
            ? buildQualityNakedSvg(qualityText, markFs, !!topLight, markFont, tierTargetW)
            : buildQualityBadgeSvg(
                qualityText,
                markFs,
                topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)",
                topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)",
                !!topLight,
                markFont,
                tierTargetW,
              )
    }
  }
  if (!resBadge && ageText === "") return null
  const agePill = buildAgePill(ageTargetW)
  // Every painted element with its identity, in fixed paint order.
  const identified: { id: string; badge: BadgeSvgSpec }[] = []
  if (resBadge) identified.push({ id: BADGE_ITEM_QUALITY_TIER, badge: resBadge })
  if (agePill) identified.push({ id: BADGE_ITEM_QUALITY_AGE, badge: agePill })
  identified.push(...formatItems)
  const detachItem = (id: string): boolean => {
    const t = badgeItemTransform(itemTransforms ?? null, id)
    return !!t && !isNeutralBadgeItemTransform(t)
  }
  /** Rasterizza lo spec di UN marchio (percorso storico, chiamata 1:1). */
  const renderMark = async (spec: BadgeSvgSpec): Promise<Buffer> => renderSVG(spec.svg, spec.w)
  /**
   * Single painted element = the group itself (no recomposition): its own
   * bitmap IS the group canvas. A DETACHED element must not be painted there
   * too, otherwise the automatic box keeps the glyph (the caller composites
   * the detached copy on top, and that copy is clipped at the canvas edge while
   * the group one never moves). The blank canvas keeps the same w/h, so the
   * group anchor, the quality→separate anchor and the item scale ratio are
   * unchanged; a neutral/absent correction still returns the historic bytes.
   *
   * A single painted element owns its home: with no stored HOME correction
   * this is the historic path (the natural bitmap at 0/0, byte-identical);
   * with one stored the base becomes the ISOLATED reference box (the pinned
   * column at the group anchor) and the canvas grows only to keep the
   * transformed box inside, never to invent geometry.
   */
  const singleItem = async (badge: BadgeSvgSpec): Promise<QualityBadgeGroupResult> => {
    const homeT = homeTransform(identified[0].id)
    const box = homeT
      ? applyBadgeItemTransform(homeReference(badge), homeT)
      : { top: 0, left: 0, w: badge.w, h: badge.h }
    // Union with the historic canvas: a shrink/negative offset never hides the
    // element, and the untouched case keeps the original 0/0 origin and size.
    const originLeft = Math.min(0, box.left)
    const originTop = Math.min(0, box.top)
    const canvasW = Math.max(badge.w, box.left + box.w) - originLeft
    const canvasH = Math.max(badge.h, box.top + box.h) - originTop
    const placed = {
      top: box.top - originTop,
      left: box.left - originLeft,
      w: box.w,
      h: box.h,
    }
    // The single mark bitmap is needed either for the group itself or (when
    // detached) as the caller-composited copy: one rasterization as before.
    const markPng = await renderMark(badge)
    const items = identified.map((entry, index) => ({
      id: entry.id,
      top: index === 0 ? placed.top : 0,
      left: index === 0 ? placed.left : 0,
      w: index === 0 ? placed.w : entry.badge.w,
      h: index === 0 ? placed.h : entry.badge.h,
      ...(detachItem(entry.id) ? { png: entry.badge === badge ? markPng : undefined } : {}),
    }))
    const detached = items.some((item) => item.png != null)
    let png: Buffer
    if (detached) {
      png = await sharp({
        create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).png().toBuffer()
    } else if (placed.top === 0 && placed.left === 0 && placed.w === badge.w && placed.h === badge.h) {
      png = markPng
    } else {
      // Same resize path as an attached scaled element (no second resize rule).
      const scaled = placed.w === badge.w && placed.h === badge.h
        ? markPng
        : await sharp(markPng).resize(placed.w, placed.h).toBuffer()
      png = await sharp({
        create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: scaled, left: placed.left, top: placed.top }])
        .png()
        .toBuffer()
    }
    return {
      png,
      w: canvasW,
      h: canvasH,
      items,
      homeGhosts: collectHomeGhosts(identified.map((entry) => entry.id)).map((ghost) => ({
        ...ghost,
        top: ghost.top - originTop,
        left: ghost.left - originLeft,
      })),
    }
  }
  if (!resBadge && formatItems.length === 0) {
    // Solo età (niente qualità né formati che abbiano reso): la pill età è
    // già il gruppo (ageText non-vuoto garantito dal return sopra, niente
    // ricomposizione).
    return agePill ? await singleItem(agePill) : null
  }

  const gap = Math.round(5 * pw / 380)
  // Spacing of the naked group follows the same enlargement as its marks, so
  // the pitch stays ONE uniform optical gap at the larger size (5→6 at
  // pw=380). Every other style reads `gap` (identical value → same bytes).
  const groupGap = isNaked ? Math.max(gap, Math.round(gap * NAKED_GROUP_SCALE)) : gap
  // Group layout, fixed paint order (quality tier, age certification, every
  // verified format — Dolby like any other format):
  // - `stacked` (default, historic): single vertical column, one badge per
  //   line. Byte-identical to the legacy render (same gap, same rounding).
  // - `row`: the SAME per-mark bitmaps laid out horizontally, filled row-major
  //   at most `QUALITY_GROUP_ROW_MAX_ITEMS` per line (2+1, 2+2, 2+2+1) with each
  //   line centred. Every mark keeps its own plate/frame — the layout never
  //   invents a material.
  // A single painted element stays the original bitmap (historic path).
  const allBadges = identified.map((entry) => entry.badge)
  if (allBadges.length === 0) return null
  if (allBadges.length === 1) return await singleItem(allBadges[0])
  const visWidths = allBadges.map((b) => Math.max(1, b.w - TOP_SHADOW_PAD * 2))
  const visHeights = allBadges.map((b) => Math.max(1, b.h - TOP_SHADOW_PAD * 2))
  const perRow = isRowLayout ? QUALITY_GROUP_ROW_MAX_ITEMS : 1
  const rowIndexes: number[][] = []
  for (let i = 0; i < allBadges.length; i += perRow) {
    const row: number[] = []
    for (let j = i; j < Math.min(i + perRow, allBadges.length); j++) row.push(j)
    rowIndexes.push(row)
  }
  const rowWidths = rowIndexes.map((row) =>
    row.reduce((sum, idx) => sum + visWidths[idx], 0) + groupGap * (row.length - 1),
  )
  const rowHeights = rowIndexes.map((row) => Math.max(...row.map((idx) => visHeights[idx])))
  // -------------------------------------------------------------------
  // `naked` optical-gap stacking (stacked column only; `row` keeps its band
  // centring).
  //
  // The plate-less style paints text-only tier/age boxes that carry ~9px of
  // transparent padding above/below the glyphs, while the bare A/V bitmaps
  // are ink-tight vertically. Advancing by the full VISIBLE BOX height
  // therefore produced unequal optical gaps (23 / 14 / 5 at pw=380). For this
  // style only the pitch comes from each mark's visible INK band (the text
  // cap height for tier/age, the bare bitmap band for A/V marks — the same
  // `avMarkGroupInkBox`-derived height the mark is rendered at) plus the SAME
  // constant `gap`, so every pair of neighbours reads with one optical gap.
  // Every other style keeps the historic visible-box pitch byte-for-byte and
  // `row` keeps its per-band centring. The `items[]` boxes below still report
  // the BITMAP boxes (drag geometry unchanged): only each bitmap's top moves.
  // -------------------------------------------------------------------
  const nakedStack = isNaked && !isRowLayout
  // Text ink height: the shared optical cap of the tier text (~0.78 × fs:
  // 13px at pw=380, where the box is 31px tall → ~9px dead padding per side).
  const nakedTextInkH = avMarkCapHeight(markFs)
  const inkBands = allBadges.map((_, i) => {
    const visH = visHeights[i]
    const id = identified[i].id
    const nakedText = isNaked && (
      id === BADGE_ITEM_QUALITY_TIER
      || (id === BADGE_ITEM_QUALITY_AGE && effAgeStyle === DEFAULT_AGE_BADGE_STYLE)
    )
    if (!nakedStack || !nakedText) return { offset: TOP_SHADOW_PAD, h: visH }
    const h = Math.min(nakedTextInkH, visH)
    return { offset: TOP_SHADOW_PAD + Math.round((visH - h) / 2), h }
  })
  const nakedInkTops: number[] = []
  if (nakedStack) {
    let inkTop = inkBands[0].offset
    for (let i = 0; i < allBadges.length; i++) {
      nakedInkTops[i] = inkTop
      inkTop += inkBands[i].h + groupGap
    }
  }
  const maxVisW = Math.max(...rowWidths)
  const totalW = maxVisW + TOP_SHADOW_PAD * 2
  const totalVisH = (nakedStack
    ? inkBands.reduce((sum, band) => sum + band.h, 0)
    : rowHeights.reduce((sum, h) => sum + h, 0)) + groupGap * (rowIndexes.length - 1)
  const totalH = totalVisH + TOP_SHADOW_PAD * 2
  // Automatic layout position of every painted element, then its HOME: with a
  // stored home the automatic position is REPLACED by the element's ISOLATED
  // reference box (pinned column at the group anchor), so the same stored
  // correction yields the same box on every title and format set. Without one
  // the automatic box is used (today's code path). The identity correction is
  // applied by the CALLER on top, never here. Home-transformed elements STAY
  // in the group: the stack canvas is recomputed from the FINAL boxes (never
  // smaller than the automatic frame, so an untouched stack keeps today's
  // canvas byte-for-byte), and only a non-neutral IDENTITY correction still
  // detaches an element.
  const boxes: { top: number; left: number; w: number; h: number }[] = new Array(allBadges.length)
  let curVisTop = TOP_SHADOW_PAD
  for (let r = 0; r < rowIndexes.length; r++) {
    const row = rowIndexes[r]
    const rowH = rowHeights[r]
    // Each line is centred inside the shared canvas: a shorter last line never
    // hangs off one edge.
    let curVisLeft = TOP_SHADOW_PAD + Math.round((maxVisW - rowWidths[r]) / 2)
    for (const i of row) {
      const auto = {
        top: nakedStack
          ? nakedInkTops[i] - inkBands[i].offset
          : curVisTop + Math.round((rowH - visHeights[i]) / 2) - TOP_SHADOW_PAD,
        left: curVisLeft - TOP_SHADOW_PAD,
        w: allBadges[i].w,
        h: allBadges[i].h,
      }
      const homeT = homeTransform(identified[i].id)
      boxes[i] = homeT ? applyBadgeItemTransform(homeReference(allBadges[i]), homeT) : auto
      curVisLeft += visWidths[i] + groupGap
    }
    if (!nakedStack) curVisTop += rowH + gap
  }
  const originLeft = Math.min(0, ...boxes.map((b) => b.left))
  const originTop = Math.min(0, ...boxes.map((b) => b.top))
  const canvasW = Math.max(totalW, ...boxes.map((b) => b.left + b.w)) - originLeft
  const canvasH = Math.max(totalH, ...boxes.map((b) => b.top + b.h)) - originTop

  // -------------------------------------------------------------------
  // SINGLE-PASS COMPOSITION (the common path).
  //
  // When no element carries a per-item correction (no IDENTITY detach, no
  // HOME transform) every mark sits at its natural size, so the whole stack
  // is ONE composed SVG rasterized by ONE resvg instance instead of one per
  // mark (tier + age + every A/V mark). Ids are namespaced per layer, the
  // geometry/paint order are the exact same ones the bitmap path uses, and
  // the per-mark bitmaps are never materialized. A correction (rare) keeps
  // the historic per-mark render + sharp composite path below, byte-identical.
  // -------------------------------------------------------------------
  const needsLegacyComposite = identified.some((entry) => detachItem(entry.id) || homeTransform(entry.id) != null)
  const items: QualityBadgeItem[] = []
  if (!needsLegacyComposite) {
    for (let i = 0; i < allBadges.length; i++) {
      items.push({
        id: identified[i].id,
        top: boxes[i].top - originTop,
        left: boxes[i].left - originLeft,
        w: boxes[i].w,
        h: boxes[i].h,
      })
    }
    const groupPng = await renderComposedSvg(
      allBadges.map((badge, i) => ({
        svg: badge.svg,
        left: boxes[i].left - originLeft,
        top: boxes[i].top - originTop,
        width: badge.w,
        height: badge.h,
      })),
      canvasW,
      canvasH,
    )
    return {
      png: groupPng,
      w: canvasW,
      h: canvasH,
      items,
      homeGhosts: collectHomeGhosts(identified.map((entry) => entry.id)).map((ghost) => ({
        ...ghost,
        top: ghost.top - originTop,
        left: ghost.left - originLeft,
      })),
    }
  }

  // -------------------------------------------------------------------
  // LEGACY per-mark composition: only for stored corrections, so a corrected
  // stack keeps its exact historic pixels (per-mark render + sharp composite).
  // -------------------------------------------------------------------
  const composites: { input: Buffer; left: number; top: number }[] = []
  for (let i = 0; i < allBadges.length; i++) {
    const badge = allBadges[i]
    const placed = {
      top: boxes[i].top - originTop,
      left: boxes[i].left - originLeft,
      w: boxes[i].w,
      h: boxes[i].h,
    }
    // The box is always reported (the editor must offer a handle for every
    // painted element); only an IDENTITY-corrected element is detached from
    // the bitmap and composited by the caller at its transformed box.
    const detached = detachItem(identified[i].id)
    const markPng = await renderMark(badge)
    items.push({
      id: identified[i].id,
      top: placed.top,
      left: placed.left,
      w: placed.w,
      h: placed.h,
      ...(detached ? { png: markPng } : {}),
    })
    if (detached) continue
    // A home-scaled element is resized exactly like an attached identity-scaled
    // one (same sharp resize, no second rule) and stays in the group bitmap.
    const input = placed.w === badge.w && placed.h === badge.h
      ? markPng
      : await sharp(markPng).resize(placed.w, placed.h).toBuffer()
    composites.push({ input, left: placed.left, top: placed.top })
  }

  const groupPng = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  return {
    png: groupPng,
    w: canvasW,
    h: canvasH,
    items,
    homeGhosts: collectHomeGhosts(identified.map((entry) => entry.id)).map((ghost) => ({
      ...ghost,
      top: ghost.top - originTop,
      left: ghost.left - originLeft,
    })),
  }
}
