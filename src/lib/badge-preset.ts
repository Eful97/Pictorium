import { z } from "zod"
import {
  AGE_BADGE_STYLES,
  BADGE_STYLES,
  QUALITY_BADGE_STYLES,
  RANKING_BADGE_STYLES,
  SEPARATE_RATINGS_STYLES,
} from "./badge-styles"

// ---------------------------------------------------------------------------
// Badge Presets — M1: declarative schema + normalizer + revision (isomorphic,
// zero I/O, client-safe: no node: imports so /lab/badges can reuse it).
//
// Two variants sharing id/owner/target/visibility/metadata:
// - "custom": free declarative BadgeDesign (created from scratch in the Lab).
// - "house": one of the real Pictorium house styles (same builders as the
//   poster: pixel-identical starting point, editable template/scale/polarity).
// ---------------------------------------------------------------------------

export const BADGE_FAMILY_IDS = [
  "rank",
  "extra",
  "genre",
  "quality",
  "age",
  "network",
  "separateRatings",
  "customRatings",
  "comingSoon",
] as const
export type BadgeFamilyId = (typeof BADGE_FAMILY_IDS)[number]

/**
 * Accepted preset targets: the legacy `top` slot contract plus one explicit
 * entry per independently configurable badge family. `top` is preserved
 * verbatim (existing presets/URLs/imports keep validating); a standalone
 * top-target preset stays a legacy alias for the top slot and is resolved to
 * rank and/or extra only by the later render resolver — never rewritten here.
 */
export const BADGE_TARGETS = ["top", ...BADGE_FAMILY_IDS] as const
export type BadgeTarget = (typeof BADGE_TARGETS)[number]

/**
 * UI-visible preset targets for the Lab editor + community library: the
 * legacy `top` slot alias is NOT offered as a separate choice — "badge
 * superiore e classifica sono la stessa cosa" (user request: single
 * Classifica). `BADGE_TARGETS` above stays the public/storage contract
 * (existing presets/URLs/imports keep validating); this list only drives
 * what the UI offers. Use `labVisibleTargetFor` to display a stored target.
 */
export const LAB_VISIBLE_TARGETS = [
  "rank",
  "extra",
  "genre",
  "quality",
  "age",
  "network",
  "separateRatings",
  "customRatings",
  "comingSoon",
] as const
export type LabVisibleTarget = (typeof LAB_VISIBLE_TARGETS)[number]

/**
 * Stored target → UI-visible target (pure). The legacy `top` alias displays
 * as Classifica (`rank`) so an old top preset never renders a blank
 * selection; every other target passes through, unknown/absent fail-safe to
 * `rank` (never blank). Storage/rendering keep the verbatim `top` value —
 * this only affects what the selector shows.
 */
export function labVisibleTargetFor(
  target: BadgeTarget | string | null | undefined,
): LabVisibleTarget {
  if (target === "top") return "rank"
  if (typeof target === "string" && (LAB_VISIBLE_TARGETS as readonly string[]).includes(target)) {
    return target as LabVisibleTarget
  }
  return "rank"
}

/**
 * Community catalog filter match (pure): the visible `rank` (Classifica)
 * filter also matches legacy `top`-slot presets — they render the same top
 * slot, so hiding them under the single Classifica filter would silently
 * drop discoverable presets. Every other filter stays an exact match, and
 * the API still accepts an explicit `top` filter verbatim (contract).
 */
export function isCommunityTargetMatch(
  filter: BadgeTarget | string | null | undefined,
  presetTarget: BadgeTarget | string | null | undefined,
): boolean {
  if (filter == null || filter === "") return true
  if (filter === presetTarget) return true
  if (filter === "rank" && presetTarget === "top") return true
  return false
}

/** Hard cap for the per-title/per-shape family map (one entry per family). */
export const MAX_BADGE_FAMILIES = BADGE_FAMILY_IDS.length

export function isBadgeFamilyId(value: unknown): value is BadgeFamilyId {
  return typeof value === "string" && (BADGE_FAMILY_IDS as readonly string[]).includes(value)
}

export const BADGE_PRESET_SHAPES = ["pill", "rect", "squircle", "ribbon", "bar", "bordo"] as const
export type BadgeShape = (typeof BADGE_PRESET_SHAPES)[number]

export const HOUSE_POLARITIES = ["auto", "light", "dark"] as const
export type HousePolarity = (typeof HOUSE_POLARITIES)[number]

export const BADGE_PRESET_VARIANTS = ["custom", "house"] as const
export type BadgePresetVariant = (typeof BADGE_PRESET_VARIANTS)[number]

/**
 * House style allowlist for a preset target (single source for the schema
 * below and future Lab/render callers). `genre` renders with the genre badge
 * builders; the top slot (`top` legacy alias, `rank`, `extra`) renders with
 * the ranking badge builders; every technical family renders with its own
 * native builders (same recipes as the poster — pixel-identical starters,
 * see `badge-preset-technical.ts`):
 * - `quality` → the 4 streaming-tier styles (standard/tier pill, mono/color
 *   brand icons, knockout tag);
 * - `age` → the 2 certification styles (standard neutral pill, knockout tag);
 * - `network` → the single native network pill (`pill`);
 * - `separateRatings` → the 5 separate-ratings layouts;
 * - `customRatings` → the single custom provider row (`row`);
 * - `comingSoon` → the single pre-digital corner ribbon (`ribbon`).
 */
export function houseStyleAllowlistForTarget(
  target: BadgeTarget | string | null | undefined,
): readonly string[] | null {
  if (target === "genre") return BADGE_STYLES
  if (target === "top" || target === "rank" || target === "extra") return RANKING_BADGE_STYLES
  if (target === "quality") return QUALITY_BADGE_STYLES
  if (target === "age") return AGE_BADGE_STYLES
  if (target === "network") return ["pill"] as const
  if (target === "separateRatings") return SEPARATE_RATINGS_STYLES
  if (target === "customRatings") return ["row"] as const
  if (target === "comingSoon") return ["ribbon"] as const
  return null
}

/**
 * Legacy preset-target → family resolution (pure, no store I/O). `genre` and
 * every explicit family resolve to themselves; the legacy `top` alias fans
 * out to `rank` + `extra` (the two badges sharing the historic top slot) so
 * the existing singleton keeps rendering where it always did — the later
 * render resolver disambiguates which slot a top-target preset fills.
 * Unknown targets resolve to no family (never a silent default).
 */
export function resolveLegacyTargetFamilies(
  target: BadgeTarget | string | null | undefined,
): readonly BadgeFamilyId[] {
  if (target === "top") return ["rank", "extra"]
  if (isBadgeFamilyId(target)) return [target]
  return []
}

/** Per-family binding identity: valid id + optional rev (null = unpinned). */
export interface BadgeFamilyBinding {
  id: string
  rev: string | null
}

/**
 * Sparse per-title/per-shape family map: absent key = inherit/no override,
 * present `null` = explicit clear for that family (never clears siblings).
 */
export type BadgeFamilyBindings = Partial<Record<BadgeFamilyId, BadgeFamilyBinding | null>>

/**
 * Merge per-family con semantica "override vince": ogni chiave presente in
 * `override` (inclusa `null` = clear esplicito) ombreggia la base, assente
 * eredita. `override` null/assente/non-oggetto = base invariata. Ritorna
 * `undefined` quando entrambi mancano, così i builder URL non emettono `bp`
 * e gli URL legacy restano byte-identici.
 */
export function mergeBadgeFamilyBindings(
  base: BadgeFamilyBindings | null | undefined,
  override: BadgeFamilyBindings | null | undefined,
): BadgeFamilyBindings | undefined {
  if (!override || typeof override !== "object") return base ?? undefined
  return { ...(base ?? {}), ...override }
}

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

/**
 * Poster-space placement offset (Badge Lab "Posizione", Task P): moves the
 * RENDERED bitmap on the poster canvas (frame offset, px on the 380 grid),
 * never the glyph inside the SVG (that stays `appearance.textOffsetX/Y`,
 * internal typography, bounded ±50). Optional, bounded ±2000 (frame offsets);
 * absent/zero = byte-identical to the native anchor. Nested in the hashed
 * design/house payload so the full revision naturally captures it (no
 * unversioned root metadata). Single application: the service adds it ONCE
 * to the existing per-title tuning offset (additive baseline, documented in
 * render-params.md); the raw tuning values are never rewritten.
 */
export const PRESET_POSITION_BOUND = 2000
export const badgePositionSchema = z.strictObject({
  x: z.number().min(-2000).max(2000),
  y: z.number().min(-2000).max(2000),
})
export type BadgePosition = z.infer<typeof badgePositionSchema>

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
  /** Poster-space placement (Task P, optional, bounded ±2000, default 0/0). */
  position: badgePositionSchema.optional(),
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
  /**
   * Nastro top per lo style `colored` rank (default backcompat `true` = nastro
   * come lo storico; `false` = placca piatta con tinta accent, stesso contratto
   * del renderer nativo `colored`+ribbon OFF via `accentFill`). Ininfluente
   * sugli altri stili. Assente = legacy (nastro), mai migrazione in lettura.
   */
  ribbon: z.boolean().optional(),
  /** Poster-space placement (Task P, optional, bounded ±2000, default 0/0). */
  position: badgePositionSchema.optional(),
  /** Rank fisso top (senza = rank live dalla classifica). */
  rankOverride: z.number().int().min(1).max(500).optional(),
  /** Override valori segmenti genere (variabili ammesse; vuoto = dato live). */
  genreText: z.string().max(30).optional(),
  ratingText: z.string().max(12).optional(),
  yearText: z.string().max(12).optional(),
  /** Optional appearance overrides; absent fields preserve the original recipe. */
  appearance: z.strictObject({
    background: badgeBackgroundSchema.optional(),
    border: badgeBorderSchema.optional(),
    shadow: badgeShadowSchema.optional(),
    radius: z.number().min(0).max(100).optional(),
    widthScale: z.number().min(50).max(200).optional(),
    heightScale: z.number().min(50).max(200).optional(),
    brightness: z.number().min(0).max(200).optional(),
    contrast: z.number().min(0).max(200).optional(),
    saturation: z.number().min(0).max(200).optional(),
    opacity: z.number().min(0).max(100).optional(),
    fontWeight: badgeTextSchema.shape.fontWeight.optional(),
    letterSpacing: badgeTextSchema.shape.letterSpacing.optional(),
    textOffsetX: z.number().min(-50).max(50).optional(),
    textOffsetY: z.number().min(-50).max(50).optional(),
  }).optional(),
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
      const allowed = houseStyleAllowlistForTarget(p.target)
      if (!allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `house presets not yet supported for target ${p.target}`,
          path: ["house", "style"],
        })
        return
      }
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

/**
 * Single family binding value at write boundaries: strict id/rev formats
 * (same bounds as the legacy singleton), rev optional (absent = unpinned).
 * The entry itself is nullable (explicit clear); unknown sub-keys rejected.
 */
const badgeFamilyBindingSchema = z.strictObject({
  id: z.string().regex(BADGE_PRESET_ID_RE, "preset id must be 8-24 base64url chars"),
  rev: z.string().regex(BADGE_PRESET_REV_RE, "revision must be 8 hex chars").nullable().optional(),
})

const FORBIDDEN_FAMILY_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

/**
 * Validated write-boundary form of the per-title/per-shape family map
 * (Mapping + LandscapeSettings `badgePresets`). Sparse: absent key =
 * inherit/no override, present `null` = explicit clear for that family.
 *
 * Implemented as a fail-closed predicate (not a plain record): zod record
 * parsing drops `__proto__` own-keys silently, so the allowlist, the
 * prototype-key rejection and the id/rev formats are enforced here on the
 * RAW input — unknown families, malformed ids/revisions and prototype keys
 * fail the whole write, never strip silently, never reach the render path.
 */
export const badgeFamilyBindingsSchema = z.custom<BadgeFamilyBindings | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > MAX_BADGE_FAMILIES) return false
  for (const [k, v] of entries) {
    if (FORBIDDEN_FAMILY_KEYS.has(k) || !isBadgeFamilyId(k)) return false
    if (v === null) continue
    if (typeof v !== "object" || Array.isArray(v)) return false
    for (const sk of Object.keys(v)) {
      if (FORBIDDEN_FAMILY_KEYS.has(sk) || (sk !== "id" && sk !== "rev")) return false
    }
    if (badgeFamilyBindingSchema.safeParse(v).success === false) return false
  }
  return true
}).nullable().optional()

/**
 * Persisted per-title/per-shape family follow flags (G2 correction c1).
 *
 * Sparse opt-in: present `true` = this shape explicitly follows the space
 * settings for the family, bypassing any stored flat/profile pin AND the
 * legacy singleton for that family/shape. Absent key = legacy semantics
 * (inherit/no override — old mappings without this field stay byte-identical).
 * Only the literal `true` is accepted; `false`/null/garbage fail the write
 * (never strip silently, never reach the render path). Client-only
 * `__follow__` staged markers are NEVER serialized here (save translates them
 * to flag writes + key deletions); this field never carries id/rev values.
 */
export type BadgeFamilyFollows = Partial<Record<BadgeFamilyId, true>>

export const badgeFamilyFollowsSchema = z.custom<BadgeFamilyFollows | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > MAX_BADGE_FAMILIES) return false
  for (const [k, v] of entries) {
    if (FORBIDDEN_FAMILY_KEYS.has(k) || !isBadgeFamilyId(k)) return false
    if (v !== true) return false
  }
  return true
}).nullable().optional()

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
    ...(design.position &&
    Number.isFinite(Number((design.position as { x?: unknown }).x)) &&
    Number.isFinite(Number((design.position as { y?: unknown }).y))
      ? (() => {
          const cx = Math.min(
            PRESET_POSITION_BOUND,
            Math.max(-PRESET_POSITION_BOUND, Math.round(Number((design.position as { x: number }).x))),
          )
          const cy = Math.min(
            PRESET_POSITION_BOUND,
            Math.max(-PRESET_POSITION_BOUND, Math.round(Number((design.position as { y: number }).y))),
          )
          return cx === 0 && cy === 0 ? { position: undefined } : { position: { x: cx, y: cy } }
        })()
      : { position: undefined }),
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
  const cleanPosition = (p: HouseBadge["position"]): HouseBadge["position"] | undefined => {
    if (!p || typeof p !== "object") return undefined
    const x = Math.round(Number((p as { x?: unknown }).x))
    const y = Math.round(Number((p as { y?: unknown }).y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    const cx = Math.min(PRESET_POSITION_BOUND, Math.max(-PRESET_POSITION_BOUND, x))
    const cy = Math.min(PRESET_POSITION_BOUND, Math.max(-PRESET_POSITION_BOUND, y))
    if (cx === 0 && cy === 0) return undefined
    return { x: cx, y: cy }
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
    ...(house.ribbon !== undefined ? { ribbon: house.ribbon } : { ribbon: undefined }),
    ...(cleanPosition(house.position) ? { position: cleanPosition(house.position) } : { position: undefined }),
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

/** Stato editor necessario a costruire il documento JSON esportato dal Lab. */
export interface PresetExportDraft {
  variant: BadgePresetVariant
  design: BadgeDesign
  house: HouseBadge
  target: BadgePreset["target"]
  visibility: BadgePreset["visibility"]
  name: string
  description?: string
  tags: string[]
  forkedFrom: string | null
  editingId: string | null
  ownerUuid: string | null
}

/**
 * Documento JSON esportabile (stessa forma di onExport nel Lab): id valido
 * generato per i non salvati (mai "unsaved"), owner zero-UUID senza spazio,
 * revisione ricalcolata. Validabile con badgePresetSchema.
 */
export function buildPresetExportDocument(draft: PresetExportDraft): unknown {
  const now = Date.now()
  return {
    version: 1,
    id: draft.editingId ?? generateBadgePresetId(),
    ownerUuid: draft.ownerUuid ?? "00000000-0000-0000-0000-000000000000",
    target: draft.target,
    visibility: draft.visibility,
    forkedFrom: draft.forkedFrom,
    metadata: {
      name: draft.name.trim() || "preset",
      description: draft.description?.trim() || undefined,
      tags: draft.tags,
    },
    variant: draft.variant,
    ...(draft.variant === "house" ? { house: draft.house } : { design: draft.design }),
    createdAt: now,
    updatedAt: now,
    revision: computePresetFullRevision(
      draft.variant,
      draft.variant === "house" ? undefined : draft.design,
      draft.variant === "house" ? draft.house : undefined,
    ),
  }
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
 * Poster-space `position` is intentionally NOT scaled here: it is a frame
 * offset applied once at placement (service adds it to the tuning offset).
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

/**
 * Effective poster-space position carried by a preset (Task P, both variants).
 * Custom reads `design.position`, house reads `house.position`; absent,
 * malformed or NaN fields fail-closed to 0/0 (native anchor, byte-identical).
 * Values are clamped to ±PRESET_POSITION_BOUND and rounded (same bounds as
 * the schema; direct service callers without validation stay safe).
 */
export function resolvePresetPosition(preset: PresetLike | null | undefined): { x: number; y: number } {
  const raw =
    preset?.variant === "house"
      ? (preset.house as HouseBadge | undefined)?.position
      : preset?.variant === "custom"
        ? (preset.design as BadgeDesign | undefined)?.position
        : undefined
  const rx = typeof raw === "object" && raw !== null ? Number((raw as { x?: unknown }).x) : NaN
  const ry = typeof raw === "object" && raw !== null ? Number((raw as { y?: unknown }).y) : NaN
  const x = Number.isFinite(rx) ? Math.min(PRESET_POSITION_BOUND, Math.max(-PRESET_POSITION_BOUND, Math.round(rx))) : 0
  const y = Number.isFinite(ry) ? Math.min(PRESET_POSITION_BOUND, Math.max(-PRESET_POSITION_BOUND, Math.round(ry))) : 0
  return { x, y }
}

/** True when the preset carries a non-zero honored poster-space offset. */
export function hasPresetPosition(preset: PresetLike | null | undefined): boolean {
  const p = resolvePresetPosition(preset)
  return p.x !== 0 || p.y !== 0
}

/**
 * Explicit ribbon state for rank `colored` house presets (parity gap #1):
 * `ribbon: false` renders the flat accent plate (native `colored`+ribbon OFF
 * via `accentFill`); absent/true renders the ribbon (legacy behavior, the
 * historic builder default). Every other style ignores it (null).
 */
export function resolveHouseRibbon(preset: PresetLike | null | undefined): boolean | null {
  if (preset?.variant !== "house" || !preset.house) return null
  if (preset.house.style !== "colored") return null
  if (preset.target !== "rank" && preset.target !== "top") return null
  return preset.house.ribbon === false ? false : true
}
