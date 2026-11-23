import sharp from "sharp"
import { cacheGet,cacheSet } from "./cache"
import { isValidHex } from "./poster-render-helpers"
import { renderGenreBadge } from "./svg-badge"
import type { BadgeFont } from "./badge-styles"
import { type BadgeStyle } from "./badge-styles"
import { BADGE_CACHE_TTL } from "./poster-layout-helpers"
import { badgeCacheKey,coalesceBadgeRender } from "./poster-cache-infra"

/**
 * Card NON-provider-glass brand accent (P5 correction): an explicit manual
 * accent (`ac=` query or saved per-title mapping, via `accentOverride`)
 * wins when present — that is the existing control semantics (the user's
 * explicit color choice), so it tints the glass. Otherwise the tint derives
 * from the ALREADY-RESOLVED original brand bitmap (`networkLogoForLayout`,
 * raw provider colors passed to the Card below — no new fetch, no copied
 * per-provider catalog matcher): bounded sampling of opaque pixels only
 * (alpha >= 200, so the raw badge's soft drop-shadow halo never votes).
 * NOTE: `provider-glass` no longer uses this sampler — it resolves from
 * the fixed brand palette by identity (`resolveProviderGlassAccent` in
 * `provider-brand-palette.ts`, brand key from the original match record).
 * (alpha >= 200, so the raw badge's soft drop-shadow halo never votes).
 * A white / achromatic brand (all-white wordmarks, monochrome marks, TMDB
 * logo fallbacks which render white) carries no brand hue and falls back to
 * the documented neutral (the compositor's `#555555` gray glass) — never the
 * scene tint, which describes the artwork atmosphere, not the provider brand.
 * Returns null when no brand color applies (missing provider, white brand,
 * unreadable bitmap): the caller passes null and the compositor renders the
 * documented neutral glass. Never throws, never invents a brand color.
 */
export async function resolveCardBrandAccent(
  providerLogo: { png: Buffer } | null | undefined,
  accentOverride: { genreColor: string; rankColor: string } | null | undefined,
): Promise<string | null> {
  if (accentOverride && isValidHex(accentOverride.genreColor)) return accentOverride.genreColor
  if (!providerLogo || !Buffer.isBuffer(providerLogo.png) || providerLogo.png.length === 0) return null
  try {
    const { data, info } = await sharp(providerLogo.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const channels = info.channels ?? 4
    const total = info.width * info.height
    if (!Number.isFinite(total) || total <= 0) return null
    // Bounded: at most ~8k samples, evenly spaced (brand bitmaps are small;
    // the stride keeps large TMDB fallbacks cheap without a PNG roundtrip).
    // ceil, not floor: floor(total/8192) still samples up to 16383 pixels on
    // large bitmaps, breaking the advertised bound. No pre-resize: brand
    // bitmaps are small and this single raw decode is already stride-bounded.
    const step = Math.max(1, Math.ceil(total / 8192))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < total; i += step) {
      const o = i * channels
      const a = channels >= 4 ? (data[o + 3] ?? 0) : 255
      if (a < 200) continue
      r += data[o] ?? 0
      g += data[o + 1] ?? 0
      b += data[o + 2] ?? 0
      n++
    }
    if (n === 0) return null
    const ar = Math.round(r / n)
    const ag = Math.round(g / n)
    const ab = Math.round(b / n)
    // No usable hue (white / gray / black marks): documented neutral.
    if (Math.max(ar, ag, ab) - Math.min(ar, ag, ab) < 30) return null
    const to2 = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")
    return `#${to2(ar)}${to2(ag)}${to2(ab)}`
  } catch {
    return null
  }
}

/**
 * Card main badge (P15): the EXISTING standard genre/rating renderer fed with
 * the ONE aggregate score (`aggregateCardRating` of the selected stack, P8)
 * instead of the ordinary single vote — never a second Card genre SVG/text
 * flow/star/year renderer. Parts follow the raw (pre-suppression) toggles so
 * the main badge stays combined with the optional separate individuals
 * (user-explicit); style/font/accent/polarity/scale match the standard badge
 * exactly. `aggregate: null` renders no rating segment (vote 0 = empty
 * `voteStr`, same as the standard builder). Bar styles scale natively via
 * font (full-width); other styles scale via bitmap at the call site, exactly
 * like the standard path. Exported for the pixel-equality tests (single call
 * site below, no duplication).
 */
export async function renderCardMainBadge(args: {
  readonly genreName: string | null
  readonly year: string | undefined
  readonly aggregate: number | null
  readonly showGenre: boolean
  readonly showYear: boolean
  readonly showRating: boolean
  /** Icona tipo film/serie inline (stessa riga del genere). */
  readonly typeIcon?: "movie" | "tv" | null
  readonly badgePw: number
  readonly CW: number
  readonly badgeStyle: BadgeStyle
  readonly accentColor: string
  readonly bottomLight: boolean
  readonly badgeFont: BadgeFont
  readonly nativeScale: number
}): Promise<{ png: Buffer; w: number; h: number } | null> {
  const vote = args.aggregate ?? 0
  const key = badgeCacheKey("card-genre", args.genreName, vote, args.CW, args.year, args.badgeStyle, args.badgeFont, args.accentColor, args.bottomLight, args.showGenre, args.showYear, args.showRating, args.nativeScale, args.typeIcon ?? null)
  const cached = cacheGet<{ png: Buffer; w: number; h: number }>(key)
  if (cached) return cached
  return coalesceBadgeRender(key, () =>
    renderGenreBadge(args.genreName ?? "", vote, args.badgePw, args.year, args.badgeStyle, args.accentColor, args.bottomLight, { showGenre: args.showGenre, showYear: args.showYear, showRating: args.showRating, typeIcon: args.typeIcon ?? null }, args.nativeScale, args.badgeFont)
      .then((r) => { if (r) cacheSet(key, r, ["badge"], BADGE_CACHE_TTL); return r }),
  )
}

/**
 * Vertical stack of two already-rendered Card overlay bitmaps (custom row
 * above the main badge, main badge above the bottom row), each centered on
 * the max width. Sharp-only composition of existing bitmaps, no renderer.
 */
export async function stackCardOverlayParts(
  top: { png: Buffer; w: number; h: number },
  bottom: { png: Buffer; w: number; h: number },
  gap: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const w = Math.max(top.w, bottom.w)
  const h = top.h + gap + bottom.h
  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: top.png, left: Math.round((w - top.w) / 2), top: 0 },
      { input: bottom.png, left: Math.round((w - bottom.w) / 2), top: top.h + gap },
    ])
    .png()
    .toBuffer()
  return { png, w, h }
}
