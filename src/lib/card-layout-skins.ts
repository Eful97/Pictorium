/**
 * Shared Card skins for the cover layouts ("provider-glass", "nuvio",
 * "stremio"), portrait + landscape.
 *
 * Skin-only companion to `card-layout-geometry.ts`: that module owns the
 * composition (rank left, rounded artwork card right); this module owns ONLY
 * the background skin painted behind it. One shared glass SVG generator, no
 * renderer or UI integration yet.
 *
 * Faithful to the classic cover.js reference (`generateGlassBackground` +
 * `getBrandPalette`):
 * - `provider-glass` = brand-colored glass frame (atmosphere + body
 *   gradients, sheens, rim strokes), tint derived from an already-resolved
 *   brand accent via the reference's GENERIC ratio branch only. The
 *   reference's large per-provider catalog matcher is deliberately NOT
 *   copied: this helper takes an already-resolved accent and performs no
 *   queries, fetches, or provider resolution of its own.
 * - `nuvio` = solid opaque black (reference `black`/`nero` mode).
 * - `stremio` = fixed violet glass (reference non-provider palette),
 *   independent of any passed accent.
 *
 * Missing/unresolved brand -> documented neutral palette derived from the
 * existing project unresolved-accent default (`#555555`, the same sentinel
 * used by `poster-render-helpers.ts` and `badges.ts` GENRE_FALLBACK
 * fallbacks) through the same generic ratio branch.
 *
 * Safety: the only caller-controlled string that reaches the SVG is the
 * accent, and it passes strict `#rrggbb` validation first (anything else
 * falls back to the neutral default). Invalid input therefore cannot inject
 * SVG markup. All other interpolated values are internally computed numbers.
 * Pure string builder: no Sharp, no blur PNG roundtrip, no new dependencies.
 */

import {
  CARD_COVER_LAYOUTS,
  isCardRankDisplayable,
  type CardCoverLayout,
} from "./card-layout-geometry"

/** Cover skins sharing the single Card composition (no new query params). */
export type CardSkin = CardCoverLayout
export const CARD_SKIN_LAYOUTS = CARD_COVER_LAYOUTS

/**
 * Neutral fallback accent for a missing/invalid brand accent: the existing
 * project unresolved-accent default (same sentinel as the genre-fallback and
 * accent-resolution paths), usable as a gray glass tint.
 */
export const CARD_SKIN_NEUTRAL_ACCENT = "#555555"

export interface CardSkinAtmo {
  c1: string
  c2: string
  c3: string
}

export interface CardSkinBody {
  c1: string
  c2: string
  c3: string
  c4: string
}

export interface CardSkinStroke {
  s1: string
  s2: string
  s3: string
  s4: string
  s5: string
  s6: string
}

export interface CardSkinSheen {
  c1: string
  c2: string
}

export interface CardSkinBounce {
  c1: string
  c2: string
}

export interface CardSkinPalette {
  atmo: CardSkinAtmo
  body: CardSkinBody
  stroke: CardSkinStroke
  sheen: CardSkinSheen
  bounce: CardSkinBounce
}

/**
 * Fixed violet glass palette for the `stremio` skin, verbatim from the
 * classic reference's non-provider branch. Ignores any passed accent.
 */
export const STREMIO_CARD_SKIN_PALETTE: CardSkinPalette = {
  atmo: { c1: "#2e2569", c2: "#1b1642", c3: "#0a081c" },
  body: { c1: "#483896", c2: "#322673", c3: "#1d1647", c4: "#050410" },
  stroke: {
    s1: "#FFFFFF",
    s2: "#E0E7FF",
    s3: "#A5B4FC",
    s4: "#6366F1",
    s5: "#C7D2FE",
    s6: "#FFFFFF",
  },
  sheen: { c1: "#FFFFFF", c2: "#C7D2FE" },
  bounce: { c1: "#818CF8", c2: "#C7D2FE" },
}

/** True for the three shared Card skins. */
export function isCardSkin(value: unknown): value is CardSkin {
  return (
    value === "provider-glass" || value === "nuvio" || value === "stremio"
  )
}

/**
 * Effective Card eligibility: one of the cover layouts renders the shared
 * Card composition only when selected (via the `isCardSkin` guard above — no
 * divergent skin list) AND (the scope is explicitly "all" OR a valid
 * DISPLAYED Card rank 1..20 is actually shown, via the P2
 * `isCardRankDisplayable` guard). The rank here is the displayed rank (the
 * resolved topBadge numeral, already rankingEnabled-gated upstream) — never
 * catalog membership, custom badge text or catalog flags. Absent/invalid
 * scope fails closed to "ranked" (the shared default with Fresh):
 * absent/disabled/invalid/null rank under it falls back to Standard
 * (byte-identical to selecting Standard with the same settings); a valid
 * rank renders Card identical to "all" mode. Only an explicit "all" renders
 * Card without a rank — and then the numeral is omitted (never an invented
 * rank). Intentionally diverges from Fresh (`isEffectiveFreshLayout`,
 * 1..100): Fresh keeps 100, Card stops at 20; the Fresh gate is untouched.
 */
export function isEffectiveCardLayout(
  posterLayout: string | null | undefined,
  posterFreshScope: string | null | undefined,
  displayedRank: number | null | undefined,
): boolean {
  if (!isCardSkin(posterLayout)) return false
  if (posterFreshScope === "all") return true
  return isCardRankDisplayable(displayedRank)
}

/** Strict `#rrggbb` validation: the only gate before accent reaches the SVG. */
export function isValidCardAccentHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Resolve a caller-provided (already brand-resolved) accent to a safe
 * uppercase `#rrggbb` hex. Anything missing or malformed falls back to the
 * documented neutral default — never an invented brand color, never raw
 * caller text into the SVG.
 */
export function resolveCardSkinAccent(accent: unknown): string {
  if (isValidCardAccentHex(accent)) return accent.toUpperCase()
  return CARD_SKIN_NEUTRAL_ACCENT
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`
}

/**
 * Generic brand-tint palette from a sanitized accent, faithful to the
 * reference's generic (non-catalog) `getBrandPalette` ratio branch. The
 * input must already be a validated `#rrggbb` hex (see
 * `resolveCardSkinAccent`); it is re-validated here so a direct call with
 * hostile input still cannot inject markup.
 */
function brandTintPalette(accentHex: string): CardSkinPalette {
  const safe = isValidCardAccentHex(accentHex)
    ? accentHex.toUpperCase()
    : CARD_SKIN_NEUTRAL_ACCENT
  const { r, g, b } = hexToRgb(safe)
  const atmo = {
    c1: rgb(Math.round(r * 0.35), Math.round(g * 0.35), Math.round(b * 0.35)),
    c2: rgb(Math.round(r * 0.18), Math.round(g * 0.18), Math.round(b * 0.18)),
    c3: rgb(Math.round(r * 0.05), Math.round(g * 0.05), Math.round(b * 0.05)),
  }
  return {
    atmo,
    body: {
      c1: rgb(Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5)),
      c2: atmo.c1,
      c3: atmo.c2,
      c4: atmo.c3,
    },
    stroke: {
      s1: "#FFFFFF",
      s2: "#E0E7FF",
      s3: safe,
      s4: atmo.c1,
      s5: "#C7D2FE",
      s6: "#FFFFFF",
    },
    sheen: { c1: "#FFFFFF", c2: "#E0E7FF" },
    bounce: { c1: safe, c2: "#FFFFFF" },
  }
}

/**
 * Palette for a glass skin. `nuvio` has no glass palette (solid black) and
 * yields null; `stremio` yields the fixed violet palette regardless of the
 * accent; `provider-glass` derives the brand tint from the already-resolved
 * accent (missing/invalid -> neutral fallback). Unknown skins yield null —
 * never an invented palette.
 */
export function cardSkinPalette(
  skin: CardSkin,
  accent?: unknown,
): CardSkinPalette | null {
  if (skin === "nuvio") return null
  if (skin === "stremio") return STREMIO_CARD_SKIN_PALETTE
  if (skin === "provider-glass")
    return brandTintPalette(resolveCardSkinAccent(accent))
  return null
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

/**
 * Shared background SVG for a Card skin at arbitrary valid dimensions.
 * Render order (faithful to the reference): opaque atmosphere fill first,
 * then the glass container (body + sheen/bevel), then the top/bottom lip
 * accents. The atmosphere rect covers the full canvas, so the output is
 * always fully opaque.
 *
 * Decorative frame is bounded for small canvases: the reference `pad = 12`
 * shrinks proportionally when the canvas is too small to hold it, the corner
 * radius never exceeds half the inner rect, and the stroke never exceeds a
 * quarter of the inner rect. Inner bevel and lips are omitted when the
 * canvas is too small to hold them (no inverted geometry).
 *
 * Returns null for unknown skins or non-finite/non-positive dimensions —
 * never an invented background.
 */
export function cardSkinBackgroundSvg(
  skin: CardSkin,
  width: number,
  height: number,
  accent?: unknown,
): string | null {
  if (!isCardSkin(skin)) return null
  if (!isFinitePositive(width) || !isFinitePositive(height)) return null
  const w = Math.round(width)
  const h = Math.round(height)
  if (w < 1 || h < 1) return null

  if (skin === "nuvio") {
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#000000"/></svg>`
  }

  const pal =
    skin === "stremio"
      ? STREMIO_CARD_SKIN_PALETTE
      : brandTintPalette(resolveCardSkinAccent(accent))

  const pad = Math.max(1, Math.min(12, Math.floor(Math.min(w, h) / 8)))
  const rw = w - pad * 2
  const rh = h - pad * 2
  if (rw < 1 || rh < 1) return null
  const rx = Math.max(
    0,
    Math.min(Math.round(w * 0.032), Math.floor(Math.min(rw, rh) / 2)),
  )
  const refStroke = w > 1100 ? 4 : 3.5
  const strokeW = Math.max(
    1,
    Math.min(refStroke, Math.max(1, Math.floor(Math.min(rw, rh) / 4))),
  )
  const hasInner = rw >= 4 && rh >= 4
  const innerRx = Math.max(0, rx - 1.5)
  const hasLips = w > 2 * (pad + rx) + 16 && h > 2 * pad + 8

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<radialGradient id="glassAtmosphere" cx="50%" cy="25%" r="75%">` +
    `<stop offset="0%" stop-color="${pal.atmo.c1}"/>` +
    `<stop offset="42%" stop-color="${pal.atmo.c2}"/>` +
    `<stop offset="100%" stop-color="${pal.atmo.c3}"/>` +
    `</radialGradient>` +
    `<linearGradient id="glassBodyGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${pal.body.c1}" stop-opacity="0.95"/>` +
    `<stop offset="20%" stop-color="${pal.body.c2}" stop-opacity="0.92"/>` +
    `<stop offset="50%" stop-color="${pal.body.c3}" stop-opacity="0.95"/>` +
    `<stop offset="80%" stop-color="${pal.atmo.c3}" stop-opacity="0.98"/>` +
    `<stop offset="100%" stop-color="${pal.body.c4}" stop-opacity="1.0"/>` +
    `</linearGradient>` +
    `<linearGradient id="innerGlassSheen" x1="0" y1="0" x2="0.8" y2="0.6">` +
    `<stop offset="0%" stop-color="${pal.sheen.c1}" stop-opacity="0.28"/>` +
    `<stop offset="35%" stop-color="${pal.sheen.c2}" stop-opacity="0.10"/>` +
    `<stop offset="100%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="glassStrokeGrad" x1="0" y1="0" x2="0.75" y2="1">` +
    `<stop offset="0%" stop-color="${pal.stroke.s1}" stop-opacity="1.0"/>` +
    `<stop offset="16%" stop-color="${pal.stroke.s2}" stop-opacity="0.90"/>` +
    `<stop offset="40%" stop-color="${pal.stroke.s3}" stop-opacity="0.55"/>` +
    `<stop offset="70%" stop-color="${pal.stroke.s4}" stop-opacity="0.38"/>` +
    `<stop offset="88%" stop-color="${pal.stroke.s5}" stop-opacity="0.70"/>` +
    `<stop offset="100%" stop-color="${pal.stroke.s6}" stop-opacity="0.90"/>` +
    `</linearGradient>` +
    `<linearGradient id="innerBevelGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.60"/>` +
    `<stop offset="25%" stop-color="#FFFFFF" stop-opacity="0.12"/>` +
    `<stop offset="65%" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>` +
    `</linearGradient>` +
    `<linearGradient id="topFlare" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `<stop offset="20%" stop-color="#FFFFFF" stop-opacity="0.90"/>` +
    `<stop offset="50%" stop-color="#FFFFFF" stop-opacity="1.0"/>` +
    `<stop offset="80%" stop-color="#FFFFFF" stop-opacity="0.90"/>` +
    `<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="bottomRimFlare" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>` +
    `<stop offset="30%" stop-color="${pal.bounce.c2}" stop-opacity="0.60"/>` +
    `<stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.85"/>` +
    `<stop offset="70%" stop-color="${pal.bounce.c2}" stop-opacity="0.60"/>` +
    `<stop offset="100%" stop-color="${pal.bounce.c1}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<filter id="glassShadow" x="-15%" y="-15%" width="130%" height="130%">` +
    `<feDropShadow dx="0" dy="12" stdDeviation="22" flood-color="#020105" flood-opacity="0.94"/>` +
    `</filter>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#glassAtmosphere)"/>` +
    `<g filter="url(#glassShadow)">` +
    `<rect x="${pad}" y="${pad}" width="${rw}" height="${rh}" rx="${rx}" ry="${rx}" fill="url(#glassBodyGrad)" stroke="url(#glassStrokeGrad)" stroke-width="${strokeW}"/>` +
    (hasInner
      ? `<rect x="${pad + 1.5}" y="${pad + 1.5}" width="${rw - 3}" height="${rh - 3}" rx="${innerRx}" ry="${innerRx}" fill="url(#innerGlassSheen)" stroke="url(#innerBevelGrad)" stroke-width="1.5"/>`
      : "") +
    `</g>` +
    (hasLips
      ? `<path d="M ${pad + rx + 8} ${pad + 2} Q ${w / 2} ${pad + 1.2} ${w - pad - rx - 8} ${pad + 2}" stroke="url(#topFlare)" stroke-width="${strokeW}" stroke-linecap="round" fill="none"/>` +
        `<path d="M ${pad + rx + 14} ${h - pad - 2} Q ${w / 2} ${h - pad - 1.2} ${w - pad - rx - 14} ${h - pad - 2}" stroke="url(#bottomRimFlare)" stroke-width="2.5" stroke-linecap="round" fill="none"/>`
      : "") +
    `</svg>`
}
