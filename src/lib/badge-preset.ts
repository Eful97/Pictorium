import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES } from "./badge-styles"

// ---------------------------------------------------------------------------
// Badge Presets — M1: declarative schema + normalizer + revision (isomorphic,
// zero I/O, client-safe: no node: imports so /lab/badges can reuse it).
//
// Two variants sharing id/owner/target/visibility/metadata:
// - "custom": free declarative BadgeDesign (created from scratch in the Lab).
// - "house": one of the real Pictorium house styles (same builders as the
//   poster: pixel-identical starting point, editable template/scale/polarity).
// ---------------------------------------------------------------------------

export const BADGE_TARGETS = ["top", "genre"] as const
export type BadgeTarget = (typeof BADGE_TARGETS)[number]

export const BADGE_PRESET_SHAPES = ["pill", "rect", "squircle", "ribbon", "bar", "bordo"] as const
export type BadgeShape = (typeof BADGE_PRESET_SHAPES)[number]

export const HOUSE_POLARITIES = ["auto", "light", "dark"] as const
export type HousePolarity = (typeof HOUSE_POLARITIES)[number]

export const BADGE_PRESET_VARIANTS = ["custom", "house"] as const
export type BadgePresetVariant = (typeof BADGE_PRESET_VARIANTS)[number]

/** Sottoinsieme letto dal render house/mock (il resto serve solo allo store). */
export interface PresetLike {
  readonly target: BadgeTarget
  readonly variant?: BadgePresetVariant
  readonly design?: BadgeDesign
  readonly house?: HouseBadge
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const PRESET_ID_RE = /^[A-Za-z0-9_-]{8,16}$/
/** Query/URL form (cache-safe): deterministic IDs, no free text. */
export const BADGE_PRESET_ID_RE = /^[A-Za-z0-9_-]{8,24}$/
/** Revision form: FNV-1a hash, 8 lowercase hex chars. */
export const BADGE_PRESET_REV_RE = /^[0-9a-f]{8}$/
const TAG_RE = /^[a-z0-9-]{2,20}$/

export const MAX_PRESETS_PER_USER = 100
export const MAX_PRESET_JSON_BYTES = 16 * 1024
export const MAX_PRESET_TAGS = 8

const hexColor = z.string().regex(HEX_COLOR_RE, "invalid hex color (#RGB, #RRGGBB, #RRGGBBAA)")

const badgePaddingSchema = z.strictObject({
  x: z.number().min(0).max(60),
  y: z.number().min(0).max(40),
})

const badgeBackgroundSchema = z.strictObject({
  type: z.enum(["solid", "gradient"]),
  color: hexColor.optional(),
  opacity: z.number().min(0).max(100),
  gradient: z
    .strictObject({
      from: hexColor,
      to: hexColor,
      direction: z.enum(["horizontal", "vertical", "diagonal"]),
    })
    .optional(),
})

const badgeBorderSchema = z.strictObject({
  enabled: z.boolean(),
  width: z.number().min(0).max(10),
  color: hexColor,
  opacity: z.number().min(0).max(100),
})

const badgeShadowSchema = z.strictObject({
  enabled: z.boolean(),
  blur: z.number().min(0).max(40),
  offsetX: z.number().min(-50).max(50),
  offsetY: z.number().min(-50).max(50),
  opacity: z.number().min(0).max(100),
})

const badgeTextSchema = z.strictObject({
  template: z.string().min(1).max(80),
  color: hexColor,
  opacity: z.number().min(0).max(100),
  fontSize: z.number().min(8).max(48),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
  uppercase: z.boolean(),
  letterSpacing: z.number().min(-2).max(10),
  align: z.enum(["left", "center", "right"]),
})

export const badgeDesignSchema = z.strictObject({
  shape: z.enum(BADGE_PRESET_SHAPES),
  width: z.number().min(20).max(800).optional(),
  height: z.number().min(16).max(200).optional(),
  radius: z.number().min(0).max(100).optional(),
  padding: badgePaddingSchema,
  background: badgeBackgroundSchema,
  border: badgeBorderSchema.optional(),
  shadow: badgeShadowSchema.optional(),
  text: badgeTextSchema,
  scale: z.number().min(50).max(200),
})

export type BadgeDesign = z.infer<typeof badgeDesignSchema>

const badgeMetadataSchema = z.strictObject({
  name: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  tags: z.array(z.string().min(2).max(20)).max(MAX_PRESET_TAGS),
})

/**
 * House style reference: one of the real poster badge styles. `style` is
 * validated against the slot allowlist (genre vs top); `label` is the top
 * period label (variables allowed, falls back to "Oggi"); showGenre/Year/
 * Rating mirror the genre badge segments; `polarity` overrides the
 * scene-derived light/dark adaptation ("auto" follows the artwork).
 */
export const houseBadgeSchema = z.strictObject({
  style: z.string().min(1).max(16),
  label: z.string().max(30).optional(),
  showGenre: z.boolean().optional(),
  showYear: z.boolean().optional(),
  showRating: z.boolean().optional(),
  scale: z.number().min(50).max(200),
  polarity: z.enum(HOUSE_POLARITIES),
  /** Override tinta per gli stili colored (senza = accent di scena, come il poster). */
  accent: hexColor.optional(),
  /** Dimensione font assoluta (px su griglia 380; senza = base della ricetta). */
  fontSize: z.number().min(8).max(48).optional(),
  /** Colore testo esplicito (senza = adattivo della ricetta). */
  textColor: hexColor.optional(),
  textOpacity: z.number().min(0).max(100).optional(),
  uppercase: z.boolean().optional(),
  /** Lato del nastro top (solo style netflix; senza = ribbonSide del mapping). */
  side: z.enum(["left", "right"]).optional(),
  /** Rank fisso top (senza = rank live dalla classifica). */
  rankOverride: z.number().int().min(1).max(500).optional(),
  /** Override valori segmenti genere (variabili ammesse; vuoto = dato live). */
  genreText: z.string().max(30).optional(),
  ratingText: z.string().max(12).optional(),
  yearText: z.string().max(12).optional(),
})

export type HouseBadge = z.infer<typeof houseBadgeSchema>

export const badgePresetSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.string().regex(PRESET_ID_RE, "preset id must be 8-16 base64url chars"),
    ownerUuid: z.string().uuid(),
    target: z.enum(BADGE_TARGETS),
    visibility: z.enum(["public", "private"]),
    forkedFrom: z.string().regex(PRESET_ID_RE).nullable().optional(),
    metadata: badgeMetadataSchema,
    variant: z.enum(BADGE_PRESET_VARIANTS).default("custom"),
    design: badgeDesignSchema.optional(),
    house: houseBadgeSchema.optional(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    revision: z.string().regex(BADGE_PRESET_REV_RE, "revision must be 8 hex chars"),
  })
  .superRefine((p, ctx) => {
    if (p.variant === "house") {
      if (!p.house) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "house preset requires house", path: ["house"] })
        return
      }
      const allowed = p.target === "genre" ? BADGE_STYLES : RANKING_BADGE_STYLES
      if (!(allowed as readonly string[]).includes(p.house.style)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `style ${p.house.style} not allowed for target ${p.target}`,
          path: ["house", "style"],
        })
      }
    } else if (!p.design) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "custom preset requires design", path: ["design"] })
    }
  })

export type BadgePreset = z.infer<typeof badgePresetSchema>

/** Query-param form for ?badgePreset=<id>: wider (8-24) to stay cache-safe. */
const PRESET_QUERY_ID_RE = BADGE_PRESET_ID_RE

export function isBadgePresetId(value: unknown): value is string {
  return typeof value === "string" && PRESET_QUERY_ID_RE.test(value)
}

export function isBadgePresetRev(value: unknown): value is string {
  return typeof value === "string" && BADGE_PRESET_REV_RE.test(value)
}

/** Generate a random 12-char base64url preset id (isomorphic, no node: imports). */
export function generateBadgePresetId(): string {
  const bytes = new Uint8Array(9)
  globalThis.crypto.getRandomValues(bytes)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let out = ""
  // 9 bytes = 72 bits -> 12 x 6-bit chars.
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out += alphabet[(acc >> bits) & 63]
    }
  }
  return out
}

// --- Canonical JSON (sorted keys, no whitespace) for deterministic hashing ---

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k]
      if (v !== undefined) out[k] = canonicalize(v)
    }
    return out
  }
  return value
}

/** FNV-1a 32-bit over UTF-16 code units, rendered as 8 lowercase hex chars. */
export function fnv1a8(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Deterministic revision of a design: FNV-1a hash of its canonical JSON. */
export function computePresetRevision(design: BadgeDesign): string {
  return fnv1a8(JSON.stringify(canonicalize(design)))
}

// --- Normalization (canonical colors + defaults, no semantic change) ---

function normHex(color: string): string {
  return color.toLowerCase()
}

export function slugifyPresetTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Normalize a design: lowercase hex, rounded numbers, trimmed template. */
export function normalizeBadgeDesign(design: BadgeDesign): BadgeDesign {
  const bg = design.background
  const normalized: BadgeDesign = {
    ...design,
    width: design.width !== undefined ? Math.round(design.width) : undefined,
    height: design.height !== undefined ? Math.round(design.height) : undefined,
    radius: design.radius !== undefined ? Math.round(design.radius) : undefined,
    padding: { x: Math.round(design.padding.x), y: Math.round(design.padding.y) },
    background: {
      type: bg.type,
      ...(bg.color !== undefined ? { color: normHex(bg.color) } : {}),
      opacity: Math.round(bg.opacity),
      ...(bg.gradient
        ? {
            gradient: {
              from: normHex(bg.gradient.from),
              to: normHex(bg.gradient.to),
              direction: bg.gradient.direction,
            },
          }
        : {}),
    },
    ...(design.border
      ? {
          border: {
            enabled: design.border.enabled,
            width: Math.round(design.border.width),
            color: normHex(design.border.color),
            opacity: Math.round(design.border.opacity),
          },
        }
      : {}),
    ...(design.shadow
      ? {
          shadow: {
            enabled: design.shadow.enabled,
            blur: Math.round(design.shadow.blur),
            offsetX: Math.round(design.shadow.offsetX),
            offsetY: Math.round(design.shadow.offsetY),
            opacity: Math.round(design.shadow.opacity),
          },
        }
      : {}),
    text: {
      ...design.text,
      template: design.text.template.trim(),
      color: normHex(design.text.color),
      opacity: Math.round(design.text.opacity),
      fontSize: Math.round(design.text.fontSize),
    },
    scale: Math.round(design.scale),
  }
  return badgeDesignSchema.parse(normalized)
}

/** Normalize a house reference: trimmed strings, defaulted segments, rounded numbers. */
export function normalizeHouseBadge(house: HouseBadge): HouseBadge {
  const trimmed = house.label?.trim()
  const cleanText = (v: string | undefined): string | undefined => {
    const t = v?.trim()
    return t ? t : undefined
  }
  return houseBadgeSchema.parse({
    ...house,
    style: house.style.trim(),
    ...(trimmed ? { label: trimmed } : { label: undefined }),
    showGenre: house.showGenre ?? true,
    showYear: house.showYear ?? true,
    showRating: house.showRating ?? true,
    scale: Math.round(house.scale),
    ...(house.accent ? { accent: normHex(house.accent) } : { accent: undefined }),
    ...(house.fontSize !== undefined ? { fontSize: Math.round(house.fontSize) } : { fontSize: undefined }),
    ...(house.textColor ? { textColor: normHex(house.textColor) } : { textColor: undefined }),
    ...(house.textOpacity !== undefined ? { textOpacity: Math.round(house.textOpacity) } : { textOpacity: undefined }),
    ...(house.uppercase !== undefined ? { uppercase: house.uppercase } : { uppercase: undefined }),
    ...(house.side ? { side: house.side } : { side: undefined }),
    ...(house.rankOverride !== undefined ? { rankOverride: Math.round(house.rankOverride) } : { rankOverride: undefined }),
    ...(cleanText(house.genreText) ? { genreText: cleanText(house.genreText) } : { genreText: undefined }),
    ...(cleanText(house.ratingText) ? { ratingText: cleanText(house.ratingText) } : { ratingText: undefined }),
    ...(cleanText(house.yearText) ? { yearText: cleanText(house.yearText) } : { yearText: undefined }),
  })
}

/** Deterministic revision over the full variant payload (custom design or house ref). */
export function computePresetFullRevision(
  variant: BadgePresetVariant,
  design?: BadgeDesign | null,
  house?: HouseBadge | null,
): string {
  return fnv1a8(JSON.stringify(canonicalize({ variant, design: design ?? null, house: house ?? null })))
}

/** Normalize a full preset: variant payload + slugified tags + recomputed revision. */
export function normalizeBadgePreset(preset: BadgePreset): BadgePreset {
  const tags = preset.metadata.tags
    .map(slugifyPresetTag)
    .filter((t) => TAG_RE.test(t))
    .slice(0, MAX_PRESET_TAGS)
  const variant = preset.variant ?? "custom"
  const design = variant === "custom" && preset.design ? normalizeBadgeDesign(preset.design) : undefined
  const house = variant === "house" && preset.house ? normalizeHouseBadge(preset.house) : undefined
  const normalized: BadgePreset = {
    ...preset,
    version: 1,
    id: preset.id,
    ownerUuid: preset.ownerUuid.toLowerCase(),
    metadata: {
      name: preset.metadata.name.trim(),
      ...(preset.metadata.description !== undefined ? { description: preset.metadata.description.trim() } : {}),
      tags,
    },
    variant,
    ...(design ? { design } : { design: undefined }),
    ...(house ? { house } : { house: undefined }),
    revision: computePresetFullRevision(variant, design, house),
  }
  return badgePresetSchema.parse(normalized)
}

/** Byte size guard for the 16KB payload quota. */
export function presetJsonSizeBytes(preset: BadgePreset): number {
  return new TextEncoder().encode(JSON.stringify(preset)).length
}

/**
 * Render-time geometric scaling (NOT a normalizer): multiplies every absolute
 * pixel field by `factor`, leaving enums/colors/strings and `scale` untouched
 * (buildCustomBadgeSvg composes `scale` on top). The result may exceed schema
 * bounds — it is a render transform, never persisted or re-validated.
 */
export function scaleBadgeDesign(design: BadgeDesign, factor: number): BadgeDesign {
  const k = (v: number): number => Math.round(v * factor * 100) / 100
  return {
    ...design,
    width: design.width !== undefined ? k(design.width) : undefined,
    height: design.height !== undefined ? k(design.height) : undefined,
    radius: design.radius !== undefined ? k(design.radius) : undefined,
    padding: { x: k(design.padding.x), y: k(design.padding.y) },
    ...(design.border
      ? { border: { ...design.border, width: k(design.border.width) } }
      : {}),
    ...(design.shadow
      ? {
          shadow: {
            ...design.shadow,
            blur: k(design.shadow.blur),
            offsetX: k(design.shadow.offsetX),
            offsetY: k(design.shadow.offsetY),
          },
        }
      : {}),
    text: { ...design.text, fontSize: k(design.text.fontSize), letterSpacing: k(design.text.letterSpacing) },
  }
}
