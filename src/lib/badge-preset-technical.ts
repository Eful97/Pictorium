// ---------------------------------------------------------------------------
// Badge Lab technical families: shared rendering support for the six
// non-top/genre families (quality, age, network, separateRatings,
// customRatings, comingSoon).
//
// One conceptual renderer: every starter below invokes the EXISTING native
// builders (same recipes as the poster — pixel-identical starting points,
// never hand-copied SVG or approximate clones). This module is the single
// source for starter inventory + Lab template metadata + the pure preset
// resolvers the poster service applies; the async bitmap work stays in the
// existing builders (svg-badge.ts, separate-rating-renderer.ts,
// multi-rating-renderer.ts, network-svgs.ts) called with live dynamic values.
//
// Customization contract per family (honest matrix — fields the native
// builders genuinely consume are honored; everything else validates but is
// reserved for later renderer work, never silently promised):
// - quality:       style (4 tier styles) + scale + polarity + typography
//                  (fontSize/textColor/textOpacity/uppercase on the tier/age
//                  text) + material container (background/border/radius/
//                  shadow/opacity/width-height/effects) around the native
//                  tier/knockout/icon plate. Logos stay brand artwork
//                  (mono/color icons); tier text stays the live tier.
// - age:           style (standard/knockout) + scale + polarity + typography
//                  + material container (same knobs as quality). Label stays
//                  the live resolved certification (target independent of
//                  quality: the age pill renders even without a 4K tier).
// - network:       scale + material container (padding/background/border/
//                  shadow/opacity/width-height around the retained raw mark)
//                  + polarity-aware plate. The mark stays the matched brand
//                  artwork (never invented: no native match = no badge, preset
//                  or not). Typography is N/A on a logo-only mark (no text
//                  knob is offered for it).
// - separateRatings: style (5 layouts) + scale + polarity + typography
//                  (value text presentation) + material container around
//                  every actual live item. Items stay the live ordered source
//                  list (ordering/max-5/cap honored); mutual exclusion with
//                  the custom row is preserved.
// - customRatings: scale + polarity + typography + material container around
//                  the live provider row. Values stay the live provider items
//                  (never invented).
// - comingSoon:    side + label (explicit user text only, default = live
//                  localized label) + typography (size/color/opacity/case on
//                  the ribbon text) + material/opacity on the ribbon band.
//                  Renders only under the real pre-digital gate; corner
//                  geometry is fixed so preset scale stays inert (no scale
//                  knob is offered) and appearance width/heightScale are
//                  sanitized away to preserve the corner contract.
// Fresh/Card layout-specific numerals stay owned by those renderers and are
// NOT customizable through these families (the retained shared overlays —
// quality group, coming-soon ribbon — do pick up the styling above).
// ---------------------------------------------------------------------------

import {
  fnv1a8,
  houseBadgeSchema,
  houseStyleAllowlistForTarget,
  resolvePresetPosition,
  type BadgeFamilyId,
  type BadgePreset,
  type HouseBadge,
  type HousePolarity,
  type PresetLike,
} from "./badge-preset"
import type { RatingItem } from "./custom-rating/types"
import type { SeparateRating } from "./ratings"

/** The six technical families covered by this module. */
export const TECHNICAL_FAMILY_IDS = [
  "quality",
  "age",
  "network",
  "separateRatings",
  "customRatings",
  "comingSoon",
] as const
export type TechnicalFamilyId = (typeof TECHNICAL_FAMILY_IDS)[number]

export function isTechnicalFamilyId(value: unknown): value is TechnicalFamilyId {
  return (
    typeof value === "string" &&
    (TECHNICAL_FAMILY_IDS as readonly string[]).includes(value)
  )
}

/** Native style inventory per technical family (mirrors the schema allowlist). */
export function technicalFamilyStyles(
  family: TechnicalFamilyId,
): readonly string[] {
  return houseStyleAllowlistForTarget(family) ?? []
}

function techHouse(style: HouseBadge["style"]): HouseBadge {
  return { style, scale: 100, polarity: "auto" }
}

/**
 * Built-in starter inventory: one house preset payload per EXISTING native
 * style (no id/owner — the Lab/store layer assigns identity on fork; the
 * payload itself is the native recipe verbatim). Native no-override parity:
 * applying a starter with scale 100 + polarity auto renders the identical
 * bitmap to the existing native selected style.
 */
export interface TechnicalFamilyStarter {
  readonly family: TechnicalFamilyId
  readonly style: string
  readonly house: HouseBadge
}

function startersFor(family: TechnicalFamilyId): readonly TechnicalFamilyStarter[] {
  return technicalFamilyStyles(family).map((style) => ({
    family,
    style,
    house:
      family === "comingSoon"
        ? { ...techHouse(style), side: "left" as const }
        : techHouse(style),
  }))
}

export const TECHNICAL_FAMILY_STARTERS: readonly TechnicalFamilyStarter[] =
  (TECHNICAL_FAMILY_IDS as readonly TechnicalFamilyId[]).flatMap(startersFor)

/** Starter lookup (Lab "start from native" gallery, future UI wiring). */
export function getTechnicalStarter(
  family: TechnicalFamilyId,
  style: string,
): TechnicalFamilyStarter | null {
  return (
    TECHNICAL_FAMILY_STARTERS.find((s) => s.family === family && s.style === style) ??
    null
  )
}

// --- Template metadata for later Lab exposure (no UI wiring in this task) ---

export interface TechnicalFamilySupport {
  readonly style: boolean
  readonly scale: boolean
  readonly polarity: boolean
  readonly side: boolean
  readonly label: boolean
  readonly font: boolean
  /** Declarative material container (background/border/radius/shadow/
   *  opacity/width-height/effects) honored around the native badge. */
  readonly appearance: boolean
  /** Value-text presentation (fontSize/textColor/textOpacity/uppercase)
   *  honored on the live text; false where the mark carries no text. */
  readonly typography: boolean
  /** Editable plate/container around retained brand artwork (network). */
  readonly container: boolean
  /** Poster-space placement (Task P X/Y, frame offset, bounded ±2000). */
  readonly position: boolean
}

export interface TechnicalFamilyMeta {
  readonly family: TechnicalFamilyId
  /** Display title for the future Lab family picker (i18n wiring: next UI task). */
  readonly title: string
  readonly styles: readonly string[]
  readonly supports: TechnicalFamilySupport
  /** Honest one-liner: what stays native no matter the preset. */
  readonly nativeGuarantee: string
}

const NO: TechnicalFamilySupport = {
  style: false,
  scale: false,
  polarity: false,
  side: false,
  label: false,
  font: false,
  appearance: false,
  typography: false,
  container: false,
  position: false,
}

export const TECHNICAL_FAMILY_META: readonly TechnicalFamilyMeta[] = [
  {
    family: "quality",
    title: "Quality",
    styles: technicalFamilyStyles("quality"),
    supports: { ...NO, style: true, scale: true, polarity: true, appearance: true, typography: true, container: true, position: true },
    nativeGuarantee: "Tier text and brand icons stay live native values; material/text knobs style the plate, never the artwork.",
  },
  {
    family: "age",
    title: "Age rating",
    styles: technicalFamilyStyles("age"),
    supports: { ...NO, style: true, scale: true, polarity: true, appearance: true, typography: true, container: true, position: true },
    nativeGuarantee: "Certification label stays the live resolved value; material/text knobs style the pill, never invent content.",
  },
  {
    family: "network",
    title: "Network",
    styles: technicalFamilyStyles("network"),
    supports: { ...NO, style: true, scale: true, appearance: true, container: true, position: true },
    nativeGuarantee: "Mark stays the matched raw brand artwork; only the surrounding container is editable (typography N/A: logo-only mark).",
  },
  {
    family: "separateRatings",
    title: "Separate ratings",
    styles: technicalFamilyStyles("separateRatings"),
    supports: { ...NO, style: true, scale: true, polarity: true, appearance: true, typography: true, container: true, position: true },
    nativeGuarantee: "Sources, order, values and the max-5 cap stay live; material/text knobs never change data or mutual exclusion.",
  },
  {
    family: "customRatings",
    title: "Custom ratings",
    styles: technicalFamilyStyles("customRatings"),
    supports: { ...NO, scale: true, polarity: true, appearance: true, typography: true, container: true, position: true },
    nativeGuarantee: "Provider values stay live; mutual exclusion preserved; no invented items.",
  },
  {
    family: "comingSoon",
    title: "Coming soon",
    styles: technicalFamilyStyles("comingSoon"),
    supports: { ...NO, side: true, label: true, appearance: true, typography: true, container: true, position: true },
    nativeGuarantee: "Renders only under the real pre-digital gate; corner geometry fixed (scale inert and unsanitized).",
  },
]

export function getTechnicalFamilyMeta(
  family: TechnicalFamilyId,
): TechnicalFamilyMeta | null {
  return TECHNICAL_FAMILY_META.find((m) => m.family === family) ?? null
}

// --- Pure preset resolvers (no I/O, fail-closed) ---

/**
 * Effective native style for a technical family: house presets carry an
 * allowlisted style and address the family directly; custom presets carry
 * none (scale-only: native content is never replaced by generic text).
 * Invalid/absent/mismatched-target → null (native style). The service
 * compatibility-filters before calling, this check is defense in depth.
 */
export function resolveTechnicalHouseStyle(
  family: TechnicalFamilyId,
  preset: PresetLike | null | undefined,
): string | null {
  if (!preset || preset.variant !== "house" || !preset.house) return null
  if (preset.target !== family) return null
  const allowed = houseStyleAllowlistForTarget(family) ?? []
  const style = preset.house.style
  return typeof style === "string" && (allowed as readonly string[]).includes(style)
    ? style
    : null
}

/**
 * Effective preset scale (%): house.scale or design.scale, else 100.
 * Applied as a post-render bitmap scale (existing placement/collision math
 * consumes the final dimensions). Neutral 100 = byte-identical.
 */
export function technicalPresetScale(preset: PresetLike | null | undefined): number {
  const raw =
    preset?.variant === "house"
      ? preset.house?.scale
      : preset?.variant === "custom"
        ? preset.design?.scale
        : undefined
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 100
  return Math.min(200, Math.max(50, Math.round(raw)))
}

/** Effective polarity override (house only; null = follow the scene). */
export function technicalPresetPolarity(
  preset: PresetLike | null | undefined,
): HousePolarity | null {
  if (preset?.variant !== "house" || !preset.house) return null
  const p = preset.house.polarity
  return p === "light" || p === "dark" || p === "auto" ? p : null
}

/** Effective ribbon side override (comingSoon house only). */
export function technicalPresetSide(
  preset: PresetLike | null | undefined,
): "left" | "right" | null {
  if (preset?.variant !== "house" || !preset.house) return null
  const s = preset.house.side
  return s === "left" || s === "right" ? s : null
}

/** Value-text presentation carried by a house preset (live text restyled, never replaced). */
export interface TechnicalTypography {
  readonly fontSize?: number
  readonly textColor?: string
  readonly textOpacity?: number
  readonly uppercase?: boolean
}

/**
 * Effective typography override (house only; null = recipe text). Validated
 * fail-closed per field (bad hex/NaN drops just that field, never the whole
 * preset). Families without text (network) never receive typography — the
 * caller gates on the support matrix; this resolver still returns the raw
 * validated value so the matrix stays the single policy owner.
 */
export function technicalPresetTypography(
  preset: PresetLike | null | undefined,
): TechnicalTypography | null {
  if (preset?.variant !== "house" || !preset.house) return null
  const h = preset.house
  const out: { fontSize?: number; textColor?: string; textOpacity?: number; uppercase?: boolean } = {}
  if (typeof h.fontSize === "number" && Number.isFinite(h.fontSize)) {
    out.fontSize = Math.min(48, Math.max(8, Math.round(h.fontSize)))
  }
  if (typeof h.textColor === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h.textColor)) {
    out.textColor = h.textColor.toLowerCase()
  }
  if (typeof h.textOpacity === "number" && Number.isFinite(h.textOpacity)) {
    out.textOpacity = Math.min(100, Math.max(0, Math.round(h.textOpacity)))
  }
  if (h.uppercase === true) out.uppercase = true
  return Object.keys(out).length > 0 ? out : null
}

const CONTAINER_APPEARANCE_KEYS = new Set([
  "background",
  "border",
  "shadow",
  "radius",
  "widthScale",
  "heightScale",
  "brightness",
  "contrast",
  "saturation",
  "opacity",
])

/**
 * Style-aware typography gate (single policy owner for the genuinely
 * incompatible case): knockout plates render their letters as mask cut-outs
 * (transparent by design, dedicated age/quality builders) — an explicit text
 * color/opacity has no ink to paint there, so those two fields are dropped
 * while size/case stay honored. Network marks carry no text at all (null).
 * Every other style honors the full validated typography.
 */
export function technicalTypographyForStyle(
  family: TechnicalFamilyId,
  style: string | null | undefined,
  typo: TechnicalTypography | null | undefined,
): TechnicalTypography | null {
  if (!typo) return null
  if (family === "network") return null
  if ((family === "quality" || family === "age") && style === "knockout") {
    const { textColor: _droppedColor, textOpacity: _droppedOpacity, ...rest } = typo
    void _droppedColor
    void _droppedOpacity
    return Object.keys(rest).length > 0 ? rest : null
  }
  return typo
}

/**
 * Effective declarative material override (house only; null = native plate).
 * Schema-validated fail-closed (invalid appearance = null, never a partial
 * recolor), then per-family sanitized so incompatible knobs can never leak:
 * - network (logo-only mark): container/material keys only — text knobs
 *   (fontWeight/letterSpacing/textOffsetX/textOffsetY) are dropped;
 * - comingSoon (fixed corner geometry): width/heightScale are dropped to
 *   preserve the corner contract (preset scale is already inert there);
 * - every other technical family: the full appearance passes through.
 * Empty after sanitize = null (native plate, byte-identical).
 */
export function technicalPresetAppearance(
  family: TechnicalFamilyId,
  preset: PresetLike | null | undefined,
): HouseBadge["appearance"] | null {
  if (preset?.variant !== "house" || !preset.house) return null
  const raw = preset.house.appearance
  if (!raw || !Object.keys(raw).length) return null
  const parsed = houseBadgeSchema.shape.appearance.unwrap().safeParse(raw)
  if (!parsed.success) return null
  const a = parsed.data
  if (family === "network") {
    const kept: Record<string, unknown> = {}
    for (const k of Object.keys(a)) {
      if (CONTAINER_APPEARANCE_KEYS.has(k)) kept[k] = (a as Record<string, unknown>)[k]
    }
    return Object.keys(kept).length > 0 ? (kept as HouseBadge["appearance"]) : null
  }
  if (family === "comingSoon") {
    const { widthScale: _w, heightScale: _h, ...rest } = a
    void _w
    void _h
    return Object.keys(rest).length > 0 ? (rest as HouseBadge["appearance"]) : null
  }
  return a
}

/** True when a preset carries any honored material/typography override. */
export function hasTechnicalAppearance(
  family: TechnicalFamilyId,
  preset: PresetLike | null | undefined,
): boolean {
  return (
    technicalPresetAppearance(family, preset) !== null ||
    (family !== "network" && technicalPresetTypography(preset) !== null)
  )
}

/**
 * Stable cache fragment for honored material/typography overrides (8-hex
 * FNV-1a over the sanitized values). Null when the preset carries nothing
 * honored (cache keys stay byte-identical to the no-override path).
 */
export function technicalPresetAppearanceFrag(
  family: TechnicalFamilyId,
  preset: PresetLike | null | undefined,
): string | null {
  const a = technicalPresetAppearance(family, preset)
  const t = family === "network" ? null : technicalPresetTypography(preset)
  if (!a && !t) return null
  return fnv1a8(JSON.stringify({ a: a ?? null, t: t ?? null }))
}

/** True when the family has an authorized preset bound (any variant). */
export function hasTechnicalPreset(
  family: BadgeFamilyId,
  presets: Partial<Record<BadgeFamilyId, BadgePreset | null>> | null | undefined,
): boolean {
  return !!presets?.[family]
}

/**
 * Effective poster-space position for a technical family (Task P, both
 * variants): custom reads `design.position`, house reads `house.position`.
 * Shared resolver with the top/genre families (`resolvePresetPosition` —
 * same bounds ±2000, same fail-closed 0/0). Null = native anchor,
 * byte-identical. Applied ONCE at placement (additive with the tuning
 * offset), never inside the SVG glyph.
 */
export function technicalPresetPosition(
  preset: PresetLike | null | undefined,
): { x: number; y: number } {
  return resolvePresetPosition(preset)
}

// --- Deterministic preview fixtures (no API fetch) ---

/**
 * Fixture dynamic values for preset previews (preview.svg route + Lab mock
 * scene): same shapes as the live inputs (tier strings, certification
 * labels, rating items), zero upstream fetch. Live poster renders always use
 * real values — fixtures never leak into the poster path.
 */
export const TECHNICAL_PREVIEW_FIXTURES = {
  quality: "4K",
  age: "VM14",
  comingSoon: "Coming Soon",
  separateRatings: [
    { id: "imdb", value: 7.3 },
    { id: "tomatoes", value: 8.8 },
    { id: "tmdb", value: 7.8 },
  ] as readonly SeparateRating[],
  customRatings: [
    { id: "mdblist", name: "MDBList", value: 7.3, format: "decimal" },
    { id: "trakt", name: "Trakt", value: 82, format: "percent" },
  ] as readonly RatingItem[],
} as const
