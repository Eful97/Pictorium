/**
 * Pure, client-safe helpers for the per-episode still picker.
 *
 * A TMDB still is a single raster file name under the image CDN, exactly like
 * the compositor contract in `thumbnail-renderer.ts`. Keeping the sanitizer
 * here (no sharp/React imports) lets the picker, the mapping write boundary
 * and `/meta` share ONE validation rule.
 */

// Type-only: erased at build time, so this leaf keeps its runtime freedom from
// the server-only renderer (sharp) while reusing its canonical enums.
import { RENDER_VERSION } from "@/lib/render-version"
import type {
  ThumbnailBadgeAnchor,
  ThumbnailBadgeStyle,
  ThumbnailVoteSource,
} from "@/lib/thumbnail-renderer"

/** Same pattern/bounds as `thumbnail-renderer.ts:sanitizeStillPath`. */
export const EPISODE_STILL_PATH_RE = /^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png)$/
export const EPISODE_STILL_PATH_MAX_LENGTH = 512
/** Max overrides stored per series mapping (bounded write). */
export const MAX_EPISODE_STILL_OVERRIDES = 500
/** Mapping key shape: `S:E` (standard numbering). */
export const EPISODE_STILL_KEY_RE = /^\d{1,4}:\d{1,4}$/

/** Allowlisted preview width for the editor picker (route contract). */
export const EPISODE_THUMBNAIL_PREVIEW_WIDTH = 320
export const EPISODE_THUMBNAIL_PREVIEW_BADGES = "both"

/**
 * Anime filler classification codes accepted by the compositor `?fill=`
 * parameter (same vocabulary as the server-side resolver / renderer). Kept as
 * a local literal union so this client-safe leaf never imports the
 * server-only snapshot module. The legacy `canon` code is accepted as an alias
 * of `manga` (the historical v1 snapshot code) and normalized before the URL
 * is built, so old callers keep working with the new cache key.
 */
export const EPISODE_FILLER_STATUSES = ["manga", "anime", "filler", "mixed"] as const
export type EpisodeFillerStatus = (typeof EPISODE_FILLER_STATUSES)[number]

/** Banner layout codes accepted by the compositor `fillStyle` parameter. */
export const EPISODE_FILLER_STYLES = ["corner", "strip"] as const
export type EpisodeFillerStyle = (typeof EPISODE_FILLER_STYLES)[number]


/**
 * Accent hex per classification, same values as the server renderer's
 * `FILLER_BANNER_ACCENTS` (`thumbnail-renderer.ts`). Kept in this client-safe
 * leaf so the editor's colored dots match the rendered banner without pulling
 * `sharp` (or any server-only module) into the browser bundle.
 */
export const EPISODE_FILLER_COLORS: Record<EpisodeFillerStatus, string> = {
  manga: "#22C55E",
  anime: "#A78BFA",
  filler: "#F59E0B",
  mixed: "#38BDF8",
}

/** Canonical classification code, or null (fail-closed: no banner). */
export function sanitizeEpisodeFillerStatus(raw: unknown): EpisodeFillerStatus | null {
  if (typeof raw !== "string") return null
  const value = raw.trim().toLowerCase()
  // Legacy v1 code: an alias of manga, never emitted as-is.
  if (value === "canon") return "manga"
  return (EPISODE_FILLER_STATUSES as readonly string[]).includes(value)
    ? (value as EpisodeFillerStatus)
    : null
}

/** Canonical banner layout, or null (absent/invalid -> caller default). */
export function sanitizeEpisodeFillerStyle(raw: unknown): EpisodeFillerStyle | null {
  if (typeof raw !== "string") return null
  const value = raw.trim().toLowerCase()
  return (EPISODE_FILLER_STYLES as readonly string[]).includes(value)
    ? (value as EpisodeFillerStyle)
    : null
}

/**
 * Display-only locale tag for the banner label (`flang`): a BCP47-ish tag
 * only, so a stray value can never grow the image URL unbounded. Absent =
 * the route falls back to `Accept-Language` / `en`.
 */
export function sanitizeEpisodeFillerLang(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : ""
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null
}

/** Sanitized still path (never a full URL) or null when not acceptable. */
export function sanitizeEpisodeStillPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (!value || value.length > EPISODE_STILL_PATH_MAX_LENGTH) return null
  if (!EPISODE_STILL_PATH_RE.test(value)) return null
  if (value.includes("..") || value.includes("//") || value.includes("\\")) return null
  // TMDB stills are a single file segment (`/abc123.jpg`). Nested paths are
  // not part of the contract and are rejected fail-closed.
  if (value.slice(1).split("/").length !== 1) return null
  return value
}

/** Stable mapping key for an episode's still override (`S:E`). */
export function episodeStillKey(season: number, episode: number): string {
  return `${season}:${episode}`
}

/**
 * Sanitize a stored `Record<"S:E", still>` override map: unknown keys, invalid
 * paths and prototype keys are dropped. Returns null when nothing valid
 * remains (so callers can omit the field and keep payloads byte-identical).
 */
export function sanitizeEpisodeThumbnailStills(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_EPISODE_STILL_OVERRIDES) break
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue
    if (!EPISODE_STILL_KEY_RE.test(key)) continue
    const still = sanitizeEpisodeStillPath(value)
    if (!still) continue
    out[key] = still
    count += 1
  }
  return count > 0 ? out : null
}

export interface EpisodeThumbnailUrlInput {
  readonly seriesId: number
  readonly season: number
  readonly episode: number
  readonly still: string
  readonly width?: number
  readonly badges?: string
  /**
   * Miniature visual choices (same renderer contract as `/meta` and the
   * settings preview). Omitted = legacy URL without visual params, so callers
   * that do not know the space defaults keep byte-identical output.
   */
  readonly badgeStyle?: ThumbnailBadgeStyle
  readonly anchor?: ThumbnailBadgeAnchor
  readonly offsetX?: number
  readonly offsetY?: number
  /**
   * Badge-stack scale percent (`bscale`, 10..200). Omitted = the renderer
   * default 100 with NO param, so callers that do not know the space defaults
   * keep byte-identical output; 100 and absence render the same bytes.
   */
  readonly badgeScale?: number
  readonly voteSource?: ThumbnailVoteSource
  readonly blur?: boolean
  /**
   * Daily still rotation (`rotate`): emitted only when ON, so OFF keeps the
   * historical fixed-still URL byte-identical. Same slot as `/meta`.
   */
  readonly rotation?: boolean
  /**
   * Anime filler classification banner (`fill=manga|anime|filler|mixed`).
   * Absent or invalid = no banner and the historical URL; `/meta` and the
   * per-title editor pass a REAL, fail-closed classification, never a sample.
   */
  readonly filler?: EpisodeFillerStatus | null
  /**
   * Banner layout (`fillStyle=corner|strip`). Emitted only together with a real
   * classification and only when it is NOT the historical default `corner`, so
   * pre-style URLs stay byte-identical. `corner` is the chip rendered when the
   * parameter is absent.
   */
  readonly fillerStyle?: EpisodeFillerStyle | null
  /**
   * Banner label locale (`flang`), emitted only together with `filler`.
   * Display-only, same rule as the settings preview.
   */
  readonly fillerLang?: string | null
  /**
   * Scoped user (multi-user namespace): propagated as `u=` so the compositor
   * route resolves the SAME user keys the `/meta`/catalog request used (TVDB
   * stills and the IMDb id lookup are server-side and need them). Absent =
   * global request, byte-identical URL.
   */
  readonly user?: string | null
}

/**
 * Compositor URL for the selected still. Returns null for an invalid still so
 * the picker never renders a preview it could not persist.
 *
 * Visual params (`bstyle`/`anchor`/`ox`/`oy`/`bscale`/`source`/`blur`) are
 * emitted, in the same order as `/meta` (`applyEpisodeThumbnails`) and the
 * settings preview (`buildThumbnailPreviewUrl`), only when the caller provides
 * them:
 * the per-title picker passes the effective space defaults so its preview is
 * the SAME request Stremio will serve.
 */
export function buildEpisodeThumbnailUrl(input: EpisodeThumbnailUrlInput): string | null {
  const still = sanitizeEpisodeStillPath(input.still)
  if (!still) return null
  const params = new URLSearchParams({
    // Render version (same as `/meta`): the browser never reuses a pre-change PNG.
    rv: RENDER_VERSION,
    still,
    w: String(input.width ?? EPISODE_THUMBNAIL_PREVIEW_WIDTH),
    badges: input.badges ?? EPISODE_THUMBNAIL_PREVIEW_BADGES,
  })
  if (input.badgeStyle !== undefined) params.set("bstyle", input.badgeStyle)
  if (input.anchor !== undefined) params.set("anchor", input.anchor)
  if (input.offsetX !== undefined) params.set("ox", String(Math.round(input.offsetX)))
  if (input.offsetY !== undefined) params.set("oy", String(Math.round(input.offsetY)))
  // Scale is emitted only when known (same `bscale` slot/order as `/meta`);
  // absence IS the renderer default 100, so a caller without space defaults
  // keeps the historical URL. Callers pass an already-clamped value.
  if (input.badgeScale !== undefined) params.set("bscale", String(Math.round(input.badgeScale)))
  if (input.voteSource !== undefined) params.set("source", input.voteSource)
  // OFF is the default: no blur param at all (byte-identical plain still).
  if (input.blur) params.set("blur", "1")
  // Daily rotation: ON only, absence keeps the fixed-still URL unchanged.
  if (input.rotation) params.set("rotate", "1")
  // Anime filler banner: a REAL classification only. Absent/invalid = no
  // `fill` param at all, so the compositor draws no banner (same rule as
  // `/meta`); `flang` is display-only and travels only with the banner.
  const filler = sanitizeEpisodeFillerStatus(input.filler)
  if (filler) {
    params.set("fill", filler)
    // Layout: callers that know the STAGED value pass it explicitly (including
    // `corner`), so a saved `strip` default can never override an unsaved
    // corner choice. `/meta` omits the default corner and emits `strip` only
    // when the space chose it, keeping pre-style URLs byte-identical.
    const fillerStyle = sanitizeEpisodeFillerStyle(input.fillerStyle)
    if (fillerStyle) params.set("fillStyle", fillerStyle)
    const fillerLang = sanitizeEpisodeFillerLang(input.fillerLang)
    if (fillerLang) params.set("flang", fillerLang)
  }
  // Namespace key propagation (multi-user): the image request cannot carry the
  // session headers, so the scoped id travels in the URL (same contract as the
  // poster URLs' `u`). Absent = global request, URL unchanged.
  if (input.user) params.set("u", input.user)
  return `/api/thumbnail/tv/${input.seriesId}/season/${input.season}/episode/${input.episode}?${params.toString()}`
}
