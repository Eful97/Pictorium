import { createHash } from "node:crypto"
import sharp from "sharp"
import { renderGenreBadge, renderSVG } from "@/lib/svg-badge"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import { loadSeparateRatingLogo, renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"
import { escSvg, estimateTextWidth, fontFamilyFor } from "@/lib/badge-svg-shared"
import { formatSeparateValue } from "@/lib/ratings"
import { badgeBody, badgeCanvasForBody, fitBadgeToCanvas, scaleBadgeBleed } from "@/lib/poster-render-helpers"
import type { BadgeBleed } from "@/lib/poster-render-helpers"
import { readResponseBodyCapped } from "@/lib/outbound-stats"
import { isTmdbImageCdnUrl } from "@/lib/resolve-image"
import {
  DYNAMIC_ROTATION_CUT_HOUR_UTC,
  dynamicRotationBucket,
  rotationIndexFor,
} from "@/lib/poster-rotation"
import type { RatingItem } from "@/lib/custom-rating"
import type { EpisodeRatingsProviderId } from "@/lib/episode-ratings-provider"

/**
 * Thumbnail compositor for a single TV episode still.
 *
 * Read-only by design: the still is fetched from the public TMDB image CDN,
 * the rating pills are rendered by the EXISTING badge renderers
 * (`renderGenreBadge` for the neutral ★, `renderSeparateRatingsBottom` for a
 * genuinely episode-scoped branded pill, `renderMultiRatings` as the text
 * fallback) and the result is composited with sharp. There is no second
 * poster renderer here: the pills use the same shared recipes as the poster
 * pipeline, only the placement is local.
 */

/**
 * Allowlisted thumbnail widths (16:9 canvas: h = round(w * 9 / 16)).
 *
 * 1280 is the largest sanctioned size (TOP 720p = 1280x720); 1080/Max stay
 * out until they are measured.
 */
export const THUMBNAIL_WIDTHS = [160, 320, 480, 640, 768, 1280] as const
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number]
export const DEFAULT_THUMBNAIL_WIDTH: ThumbnailWidth = 320

export const THUMBNAIL_BADGE_MODES = ["both", "vote", "custom"] as const
export type ThumbnailBadgeMode = (typeof THUMBNAIL_BADGE_MODES)[number]
export const DEFAULT_THUMBNAIL_BADGE_MODE: ThumbnailBadgeMode = "both"

/**
 * Visual style of the neutral vote pill, reusing the EXISTING poster badge
 * recipes (`renderGenreBadge` `bs` values) with no second renderer:
 * - `pill`     → historical satin pill (default, byte-identical);
 * - `bordo`    → rect + border + protective bg;
 * - `vetro`    → liquid glass, same box model;
 * - `branded`  → the separate branded renderer path (its own material; the
 *                bordo/vetro/pill style is ignored there);
 * - `naked`    → no container at all: the vote source's own brand mark
 *                (IMDb/TMDB, unchanged asset) + a WHITE score with a soft dark
 *                halo and a small radial scrim, so it stays readable on light
 *                and dark stills (`bordo`/`vetro`/pill materials are ignored).
 *                A missing brand asset falls back to the neutral pill, never
 *                an error;
 * - `score`    → "Absolute Cinema" grid: a rounded rect filled with the vote
 *                bucket colour + the big score, NO provider logo. The vote
 *                source still selects which score feeds the bucket (default
 *                IMDb). Missing/zero vote = no badge at all (never a fake
 *                purple bucket). Text ink is white/black by luminance and the
 *                rect carries a dark shadow for light stills.
 * - `dot`      → same data/colour contract as `score` (bucket colour + big
 *                score, no provider logo, same bucket/ink and shadow), but the
 *                container is a ROUND circle (pallino) instead of the rounded
 *                rect tile. Missing/zero vote = no badge at all, exactly like
 *                `score` (never a pill fallback).
 * These are the only values accepted by `?bstyle`; absent = `pill`.
 */
export const THUMBNAIL_BADGE_STYLES = ["pill", "bordo", "vetro", "branded", "naked", "score", "dot"] as const
export type ThumbnailBadgeStyle = (typeof THUMBNAIL_BADGE_STYLES)[number]
export const DEFAULT_THUMBNAIL_BADGE_STYLE: ThumbnailBadgeStyle = "pill"

/**
 * Corner anchor of the badge stack (the compositor's safe margins are applied
 * around it; see `THUMBNAIL_BADGE_SAFE_MARGIN_X/Y`).
 * Default `tr` = top-right, matching the TOP poster convention. `ox`/`oy`
 * are user offsets from that corner in canvas px; non-zero values are the
 * "custom" state after a manual slider/drag.
 */
export const THUMBNAIL_BADGE_ANCHORS = ["tl", "tr", "bl", "br"] as const
export type ThumbnailBadgeAnchor = (typeof THUMBNAIL_BADGE_ANCHORS)[number]
export const DEFAULT_THUMBNAIL_BADGE_ANCHOR: ThumbnailBadgeAnchor = "tr"
export const THUMBNAIL_BADGE_OFFSET_MIN = -2000
export const THUMBNAIL_BADGE_OFFSET_MAX = 2000

export function parseThumbnailBadgeAnchor(raw: string | null | undefined): ThumbnailBadgeAnchor | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_BADGE_ANCHOR
  const value = raw.trim().toLowerCase()
  return (THUMBNAIL_BADGE_ANCHORS as readonly string[]).includes(value)
    ? (value as ThumbnailBadgeAnchor)
    : null
}

/** Integer px offset from the anchor; absent = 0, invalid/out-of-range = null. */
export function parseThumbnailBadgeOffset(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return 0
  if (!/^-?\d{1,5}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < THUMBNAIL_BADGE_OFFSET_MIN || n > THUMBNAIL_BADGE_OFFSET_MAX) return null
  return n
}

/**
 * Badge-stack scale (`bscale`), percent of the standard render.
 *
 * 100 is the historical fixed size and stays byte-identical: the scale is
 * applied to the composed pill bitmap only when it differs from 100. Bounds
 * mirror the poster badge contract (10..200); absent = 100, invalid or
 * out-of-range = `null` so the route can reject it with 400.
 */
export const THUMBNAIL_BADGE_SCALE_MIN = 10
export const THUMBNAIL_BADGE_SCALE_MAX = 200
export const DEFAULT_THUMBNAIL_BADGE_SCALE = 100

export function parseThumbnailBadgeScale(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_BADGE_SCALE
  const value = raw.trim()
  if (!/^\d{1,3}$/.test(value)) return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < THUMBNAIL_BADGE_SCALE_MIN || n > THUMBNAIL_BADGE_SCALE_MAX) return null
  return n
}

/**
 * Source of the ★ episode vote.
 *
 * `imdb` (default) is the per-episode IMDb poll resolved by the route through
 * ShowGrid (the default episode provider; Cinemeta is no longer consulted on
 * this path); `tmdb` is the episode `vote_average`. The value itself is always
 * resolved by the caller and passed as `voteAverage`: this renderer only knows
 * the provenance (it is part of the render/cache identity), never a second
 * upstream. The neutral ★ is used for both sources because it represents the
 * EPISODE vote; a branded IMDb pill is reserved for an explicitly
 * episode-scoped custom rating.
 */
export const THUMBNAIL_VOTE_SOURCES = ["tmdb", "imdb"] as const
export type ThumbnailVoteSource = (typeof THUMBNAIL_VOTE_SOURCES)[number]
export const DEFAULT_THUMBNAIL_VOTE_SOURCE: ThumbnailVoteSource = "imdb"

/**
 * `?source` parser: `imdb`/`tmdb` (case-insensitive). Absent means `imdb`
 * (IMDb is the default episode-vote source); `tmdb` explicitly forces the
 * TMDB episode vote. Any other value is invalid (`null`) so the route can
 * reject it with 400.
 */
export function parseThumbnailVoteSource(raw: string | null | undefined): ThumbnailVoteSource | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_VOTE_SOURCE
  const value = raw.trim().toLowerCase()
  return (THUMBNAIL_VOTE_SOURCES as readonly string[]).includes(value)
    ? (value as ThumbnailVoteSource)
    : null
}

/**
 * WHERE the episode still base comes from.
 *
 * `tmdb` (default) is the historical behavior: the caller supplies a
 * sanitized single-segment TMDB image path. `tvdb` prefers the episode image
 * resolved from TheTVDB (artworks.thetvdb.com) and FAILS OPEN to the same
 * TMDB path when the TVDB leg misses or fails, so a thumbnail never regresses
 * to a 500 because of a third-party lookup. The choice is part of the render
 * identity (cache key/ETag) and is the only thing the URL carries: API keys
 * stay server-side.
 */
export const THUMBNAIL_STILL_SOURCES = ["tmdb", "tvdb"] as const
export type ThumbnailStillSource = (typeof THUMBNAIL_STILL_SOURCES)[number]
export const DEFAULT_THUMBNAIL_STILL_SOURCE: ThumbnailStillSource = "tmdb"

/** `?stills` parser: `tmdb`/`tvdb`, case-insensitive; absent = `tmdb`. */
export function parseThumbnailStillSource(raw: string | null | undefined): ThumbnailStillSource | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_STILL_SOURCE
  const value = raw.trim().toLowerCase()
  return (THUMBNAIL_STILL_SOURCES as readonly string[]).includes(value)
    ? (value as ThumbnailStillSource)
    : null
}

/**
 * Gaussian blur sigma (sharp `.blur()`) applied to the still when spoiler
 * protection is requested (`?blur=1`). Scaled with the canvas width so the
 * effect is comparable at every allowlisted width: 160 → 8, 320 → 16,
 * 768 → 38, 1280 → 64. Only the still is blurred; the rating pills are composited
 * afterwards and therefore stay pixel-crisp.
 */
export const THUMBNAIL_BLUR_SIGMA_RATIO = 0.05

export function thumbnailBlurSigma(width: ThumbnailWidth): number {
  return Math.max(6, Math.round(width * THUMBNAIL_BLUR_SIGMA_RATIO))
}

/**
 * `?blur` parser: `0`/`false` = no blur, `1`/`true` = blur the still. Absent
 * means no blur (default `0`, byte-identical to the plain thumbnail); any
 * other value is invalid (`null`) so the route can reject it with 400.
 */
export function parseThumbnailBlur(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return false
  const value = raw.trim().toLowerCase()
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return null
}

/**
 * `?rotate` parser: daily still rotation.
 *
 * `1`/`true` enables it, `0`/`false` disables it; ABSENT means OFF, so the
 * historical fixed `?still` thumbnail stays byte-identical and the opt-in is
 * explicit (the space flag / `/meta` emits the param only when enabled). Any
 * other value is invalid (`null`) so the route can reject it with 400.
 */
export function parseThumbnailRotation(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return false
  const value = raw.trim().toLowerCase()
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return null
}

/**
 * TMDB still paths are a single raster file name under the image CDN. The
 * leading slash is required, the extension is limited to the raster formats
 * TMDB actually serves for stills, and traversal / empty segments are
 * rejected so a caller can never steer the fetch outside the allowlisted
 * TMDB image sizes.
 */
const STILL_PATH_RE = /^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png)$/
const MAX_STILL_PATH_LENGTH = 512
const TMDB_STILL_BASE_W780 = "https://image.tmdb.org/t/p/w780"
/** Real high-res source for the 1280 tier: never a w780 upscale. */
const TMDB_STILL_BASE_W1280 = "https://image.tmdb.org/t/p/w1280"
/**
 * TVDB episode stills are absolute URLs on the exact artworks host (the same
 * origin already allowlisted in `resolve-image.ts`). They are nested raster
 * paths (`/banners/v4/episode/<id>/screencap/<file>.jpg`), so unlike TMDB the
 * path is not single-segment — but it is still pinned to this exact host and
 * to a raster extension, with no credentials, port, query or traversal.
 */
const TVDB_STILL_HOST = "artworks.thetvdb.com"
const TVDB_STILL_PATH_RE = /^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/
const MAX_TVDB_STILL_URL_LENGTH = 1024
const MAX_STILL_BYTES = 10 * 1024 * 1024
/**
 * A complete TMDB image URL is accepted as an ALTERNATIVE spelling of the
 * still path (AIO's Episode Thumbnail URL Pattern passes the episode
 * thumbnail, e.g. `https://image.tmdb.org/t/p/w500/<file>.jpg`, in the
 * `{thumbnail}` placeholder). Only the file name is used: the fetch URL is
 * rebuilt with the existing size policy, so an URL and its path form are the
 * SAME cache entry and the SAME bytes.
 */
const MAX_STILL_URL_LENGTH = 1024
/**
 * Safe margins of the badge stack from the thumbnail edges, in px on the
 * 320px reference canvas (the width `/meta` always emits).
 *
 * The asset stays 16:9 (the Stremio SDK asks for "the video's aspect ratio",
 * and episode stills are 16:9). Clients do NOT paint it in a 16:9 box:
 *
 * - Stremio Web (`src/components/Video/styles.less`) paints the episode
 *   thumbnail at `8rem x 5rem` (aspect 1.6) with `object-fit: cover`, which
 *   crops ~16 source px per side of a 320x180 render;
 * - Nuvio horizontal episode cards (Compose `ContentScale.Crop`, clipped) use
 *   1.52..1.64 aspect boxes (Nuvio TV 280x179..400x263, Nuvio Mobile
 *   296x184..420x256), which crop ~12..23.1 source px per side;
 * - Continue Watching cards are 1.77 (16:9) and crop nothing.
 *
 * So the horizontal margin must clear the widest measured crop (Nuvio TV
 * 400x263 -> 23.12px); 26px leaves ~2.9px of raster/rounding headroom and
 * keeps the visible body inside at every anchor/style/scale. Vertical crop
 * does not happen on those cards (the image height always fits), so 12px only
 * keeps the body clear of the rounded corners (Nuvio radius presets are
 * 0..16dp).
 *
 * Margins scale with the canvas width so the same fraction survives at every
 * allowlisted width (320 is the reference and the `/meta` size). They change
 * bytes, so they are part of the cache identity (`:mx26:my12` in
 * `thumbnailCacheKey`).
 */
export const THUMBNAIL_BADGE_SAFE_MARGIN_X = 26
export const THUMBNAIL_BADGE_SAFE_MARGIN_Y = 12
const THUMBNAIL_BADGE_MARGIN_REFERENCE_WIDTH = 320

/** Horizontal safe margin for a canvas width (proportional to the reference). */
export function thumbnailBadgeSafeMarginX(width: number): number {
  return Math.max(1, Math.round((THUMBNAIL_BADGE_SAFE_MARGIN_X * width) / THUMBNAIL_BADGE_MARGIN_REFERENCE_WIDTH))
}

/** Vertical safe margin for a canvas width (proportional to the reference). */
export function thumbnailBadgeSafeMarginY(width: number): number {
  return Math.max(1, Math.round((THUMBNAIL_BADGE_SAFE_MARGIN_Y * width) / THUMBNAIL_BADGE_MARGIN_REFERENCE_WIDTH))
}

const THUMBNAIL_BADGE_GAP = 6

/**
 * Source size of the still fetch for an allowlisted canvas width.
 *
 * Every existing tier keeps `w780` (byte-identical behavior); only 1280 pulls
 * a genuine higher-res still. The path stays a single TMDB image size, so the
 * `isTmdbImageCdnUrl` gate remains the defense-in-depth check.
 */
function stillSourceBase(width: ThumbnailWidth): string {
  return width >= 1280 ? TMDB_STILL_BASE_W1280 : TMDB_STILL_BASE_W780
}

/** Sanitized still path (never a full URL) or null when not acceptable. */
export function sanitizeStillPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value.length > MAX_STILL_PATH_LENGTH) return null
  if (!STILL_PATH_RE.test(value)) return null
  if (value.includes("..") || value.includes("//") || value.includes("\\")) return null
  // TMDB stills are a single file segment (`/abc123.jpg`). Nested paths are
  // not part of the contract and are rejected fail-closed.
  if (value.slice(1).split("/").length !== 1) return null
  return value
}

/**
 * Sanitized TMDB image URL, or null when not acceptable.
 *
 * Same trust bar as the TVDB still URL (`sanitizeTvdbStillUrl`): https only,
 * exact `image.tmdb.org` host (no subdomains/lookalikes), no userinfo, port,
 * query or hash, and the documented `/t/p/<size>/<raster-file>` shape with a
 * single file segment. `isTmdbImageCdnUrl` is the shared gate; the extra
 * segment check keeps the extraction of the file name unambiguous.
 */
export function sanitizeStillUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value.length > MAX_STILL_URL_LENGTH) return null
  // Reject traversal/backslash BEFORE URL normalization: `new URL` collapses
  // `..` segments, so a raw check keeps the contract explicit and testable.
  if (value.includes("..") || value.includes("\\")) return null
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return null
  }
  if (u.protocol !== "https:") return null
  if (u.username || u.password) return null
  if (u.port) return null
  if (u.search || u.hash) return null
  // Exact host + `/t/p/<documented-size>/<raster-file>` (shared allowlist).
  if (!isTmdbImageCdnUrl(value)) return null
  // `["", "t", "p", <size>, <file>]`: nested paths never pass.
  if (u.pathname.split("/").length !== 5) return null
  // The shared gate above is raster-wide (webp/gif/avif included); the still
  // contract is jpg/jpeg/png only, so the extracted file is re-validated with
  // the SAME path sanitizer used by the historical form.
  if (!sanitizeStillPath(`/${u.pathname.split("/")[4]}`)) return null
  return u.toString()
}

/**
 * Still input for the episode thumbnail route.
 *
 * Three accepted spellings, in this order:
 * 1. the historical single-segment TMDB path (byte-identical behavior,
 *    including the cache key);
 * 2. a complete TMDB image URL, reduced to its file name so the existing size
 *    policy (`w780`/`w1280`) and every downstream contract stay unchanged;
 * 3. a complete TVDB still URL (`https://artworks.thetvdb.com/...`), returned
 *    CANONICALIZED as the absolute URL: it is a directly fetchable, public
 *    artwork file, so no TVDB API lookup (and no TVDB key) is involved. The
 *    raw URL is what enters the cache key, so TVDB-based renders can never
 *    collide with a TMDB path entry.
 *
 * Anything else (other hosts, non-raster paths, credentials, query/fragment,
 * traversal) is rejected (`null`) before any fetch.
 */
export function resolveThumbnailStill(raw: string | null | undefined): string | null {
  const path = sanitizeStillPath(raw)
  if (path) return path
  const url = sanitizeStillUrl(raw)
  if (url) return sanitizeStillPath(`/${new URL(url).pathname.split("/")[4]}`)
  return sanitizeTvdbStillUrl(raw)
}

/**
 * Sanitized absolute TVDB episode-still URL, or null when not acceptable.
 *
 * Same bar as the shared image gate (`resolve-image.ts` allowlists the exact
 * `artworks.thetvdb.com` host): https only, exact hostname, no userinfo/port/
 * query/hash, raster-only nested path with no traversal. The renderer never
 * builds a TVDB URL from untrusted input beyond this validated absolute form.
 */
export function sanitizeTvdbStillUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value.length > MAX_TVDB_STILL_URL_LENGTH) return null
  // Reject traversal/backslash BEFORE URL normalization: `new URL` collapses
  // `..` segments, so a raw check keeps the contract explicit and testable.
  if (value.includes("..") || value.includes("\\")) return null
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return null
  }
  if (u.protocol !== "https:") return null
  if (u.username || u.password) return null
  if (u.port) return null
  if (u.hostname.toLowerCase() !== TVDB_STILL_HOST) return null
  if (u.search || u.hash) return null
  if (!TVDB_STILL_PATH_RE.test(u.pathname)) return null
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("\\")) return null
  return u.toString()
}

export function parseThumbnailWidth(raw: string | null | undefined): ThumbnailWidth | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_WIDTH
  const n = Number(raw)
  return (THUMBNAIL_WIDTHS as readonly number[]).includes(n) ? (n as ThumbnailWidth) : null
}

export function parseThumbnailBadgeMode(raw: string | null | undefined): ThumbnailBadgeMode | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_BADGE_MODE
  return (THUMBNAIL_BADGE_MODES as readonly string[]).includes(raw) ? (raw as ThumbnailBadgeMode) : null
}

export function parseThumbnailBadgeStyle(raw: string | null | undefined): ThumbnailBadgeStyle | null {
  if (raw === null || raw === undefined) return DEFAULT_THUMBNAIL_BADGE_STYLE
  const value = raw.trim().toLowerCase()
  return (THUMBNAIL_BADGE_STYLES as readonly string[]).includes(value)
    ? (value as ThumbnailBadgeStyle)
    : null
}

/** 16:9 output height for an allowlisted width (all values are exact integers). */
export function thumbnailHeight(width: ThumbnailWidth): number {
  return Math.round((width * 9) / 16)
}

export function stillPathHash(still: string): string {
  return createHash("sha256").update(still).digest("hex").slice(0, 16)
}

// ---------------------------------------------------------------------------
// Daily still rotation (episode thumbnail).
//
// The day bucket is the SAME used by the dynamic poster rotation: whole days
// from the most recent 02:00 UTC cut (`DYNAMIC_ROTATION_CUT_HOUR_UTC`). This is
// deliberate and not a second time policy: a title's poster and its episode
// thumbnails move to the next candidate at the same instant, on every instance,
// without any store/write. Rotation is OPT-IN at the caller (`?rotate=1`
// emitted by `/meta` when the space enables Miniature rotation): absent = the
// fixed `?still` path, byte-identical to the historical thumbnail.
//
// The renderer still receives a single still. The CALLER resolves the episode
// still list (TMDB `/images`, already cached by its own route) and passes it
// here; the helpers below are pure and fail open to the fixed still, so a
// provider miss/outage can never turn a thumbnail into a 500.
// ---------------------------------------------------------------------------

/** Daily cut of the thumbnail rotation: the poster rotation cut (02:00 UTC). */
export const THUMBNAIL_ROTATION_CUT_HOUR_UTC = DYNAMIC_ROTATION_CUT_HOUR_UTC

/**
 * Day bucket for thumbnail rotation, aligned with the dynamic poster rotation:
 * two timestamps inside the same 02:00→02:00 UTC window share a bucket, and
 * the bucket advances by one at the cut.
 */
export function thumbnailRotationBucket(nowMs: number = Date.now()): number {
  return dynamicRotationBucket(nowMs)
}

/**
 * Sanitized, de-duplicated candidate stills (fail-closed per entry).
 *
 * Only paths the compositor can actually fetch survive: malformed values,
 * traversal attempts and TVDB-style absolute URLs are dropped, and repeated
 * paths keep their first position so the bucket→index mapping is stable.
 */
function rotationCandidates(candidates: readonly (string | null | undefined)[] | null | undefined): string[] {
  const valid: string[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const still = sanitizeStillPath(typeof raw === "string" ? raw : null)
    if (!still || seen.has(still)) continue
    seen.add(still)
    valid.push(still)
  }
  return valid
}

/** Coerce a possibly non-finite bucket to a stable integer (never NaN). */
function safeRotationBucket(bucket: number): number {
  return Number.isFinite(bucket) ? Math.trunc(bucket) : 0
}

/**
 * Deterministic still for a day bucket: `bucket % validCandidates.length`,
 * advancing by one position every day and wrapping at the end. `fallback`
 * (the fixed `?still`) is returned when the list has no usable candidate, so
 * a miss is the historical thumbnail, never an empty/500.
 */
export function selectRotatedThumbnailStill(
  candidates: readonly (string | null | undefined)[] | null | undefined,
  fallback: string,
  bucket: number,
): string {
  const valid = rotationCandidates(candidates)
  if (valid.length === 0) return fallback
  return valid[rotationIndexFor(safeRotationBucket(bucket), valid.length)]!
}

export interface RotatedThumbnailStillResult {
  /** The still to compose. */
  readonly still: string
  /**
   * Day bucket to include in the cache key when rotation is actually applied;
   * `null` = fixed still (no valid list, or the loader failed), so the
   * historical key/entries stay reusable and failures do not fragment cache.
   */
  readonly rotationBucket: number | null
}

/**
 * Resolve the day's still from an async candidate loader (the caller wraps its
 * cached TMDB `/images` fetch here).
 *
 * Fail-open by contract: a rejected loader, a malformed payload or an empty
 * usable list returns the fixed `fallback` with `rotationBucket: null`. This
 * function NEVER rejects, so rotation can never be the cause of a 500.
 */
export async function resolveRotatedThumbnailStill(input: {
  readonly fallback: string
  readonly bucket: number
  readonly loadCandidates: () => Promise<readonly (string | null | undefined)[] | null | undefined>
}): Promise<RotatedThumbnailStillResult> {
  try {
    const valid = rotationCandidates(await input.loadCandidates())
    if (valid.length === 0) return { still: input.fallback, rotationBucket: null }
    const bucket = safeRotationBucket(input.bucket)
    return {
      still: valid[rotationIndexFor(bucket, valid.length)]!,
      rotationBucket: bucket,
    }
  } catch {
    return { still: input.fallback, rotationBucket: null }
  }
}

export interface ThumbnailCacheKeyInput {
  readonly seriesId: number
  readonly seasonNumber: number
  readonly episodeNumber: number
  readonly still: string
  readonly width: ThumbnailWidth
  readonly badges: ThumbnailBadgeMode
  /** Vote pill style; absent = `pill` (legacy key). */
  readonly badgeStyle?: ThumbnailBadgeStyle
  /** Corner anchor; absent = `tr`. */
  readonly anchor?: ThumbnailBadgeAnchor
  /** Offset from the anchor; absent = 0. */
  readonly offsetX?: number
  readonly offsetY?: number
  /** Badge-stack scale percent (10..200); absent = 100 (historical bytes). */
  readonly badgeScale?: number
  readonly languages: string
  readonly blur: boolean
  /** ★ vote provenance; absent = `imdb` (default episode-vote source). */
  readonly voteSource?: ThumbnailVoteSource
  /**
   * Effective episode-ratings provider id; absent = `showgrid` (default). The
   * same still can be served from different providers (different bytes/ETags),
   * and one provider must never reuse another provider's entry.
   */
  readonly provider?: EpisodeRatingsProviderId
  /**
   * Stills provider for the base image; absent = `tmdb` (legacy). A TVDB-based
   * thumbnail is a different representation of the same episode and must
   * never share an entry with the TMDB path. Only the enum travels here — no
   * TVDB URL and no API key ever enter the key.
   */
  readonly stills?: ThumbnailStillSource
  /**
   * Active day bucket when daily still rotation applies (aligned to the
   * `02:00` UTC poster cut). Absent = fixed still / rotation off: the key is
   * byte-identical to the historical one. Present = a day-specific
   * representation whose key must never be reused across buckets, even in the
   * unlikely case two buckets resolve to the same still list index.
   */
  readonly rotationBucket?: number
  /**
   * Catalog epoch of the namespace (bumped on every defaults/mapping save).
   * Absent = legacy key (byte-identical). Present = any save invalidates the
   * cached thumbnail even when the resolved Miniature settings happen to be
   * unchanged, so a style/source/corner change can never be served stale.
   */
  readonly epoch?: string
}

/**
 * Single cache-key shape shared by the route and its tests.
 *
 * The episode rating is deliberately NOT part of the key: TMDB episode votes
 * change rarely, and the key already pins the full identity (series/season/
 * episode) plus the exact still, width, badge mode and language set. A changed
 * rating is picked up at the next 30-minute thumbnail TTL (TMDB upstream cache
 * is 5 minutes), so no separate invalidation marker is needed.
 */
export function thumbnailCacheKey(input: ThumbnailCacheKeyInput): string {
  // The blur flag is part of the identity: a spoiler-protected still and the
  // plain still are different representations of the same episode and must
  // never share an entry. `b0`/`b1` keeps the segment unambiguous.
  //
  // The ★ source is part of the identity too: the same episode still may be
  // requested with the TMDB vote or the IMDb per-episode poll, and those are
  // different images (and ETags). `src<tmdb|imdb>` never carries an id or a
  // secret.
  const voteSource = input.voteSource ?? DEFAULT_THUMBNAIL_VOTE_SOURCE
  // The provider is part of the identity: a value pinned from ShowGrid must
  // never satisfy a request configured for another provider (and vice versa).
  const provider = input.provider ?? "showgrid"
  // The vote-pill style is part of the identity: pill/bordo/vetro/branded/
  // naked/score/dot are different images (and ETags) of the same still.
  // Absent = pill. `score` therefore produces `:bsscore:` and `dot` (the round
  // variant of score) its own `:bsdot:` identity.
  const badgeStyle = input.badgeStyle ?? DEFAULT_THUMBNAIL_BADGE_STYLE
  const anchor = input.anchor ?? DEFAULT_THUMBNAIL_BADGE_ANCHOR
  const ox = input.offsetX ?? 0
  const oy = input.offsetY ?? 0
  // The badge-stack scale is part of the identity: the same still rendered at
  // 100 and at 150 is a different image (and ETag). Absent = 100 (legacy size).
  const scale = input.badgeScale ?? DEFAULT_THUMBNAIL_BADGE_SCALE
  // The stills provider is part of the identity (`si`): a TVDB-based render
  // never satisfies a TMDB request (or vice versa). Only the enum is used; the
  // resolved TVDB URL and the API key never enter the key.
  const stills = input.stills ?? DEFAULT_THUMBNAIL_STILL_SOURCE
  // The safe margins are part of the identity: a stack drawn 26px/12px from
  // the edges is a different image than the historical 8px one, so a margin
  // change must never be served from a pre-change entry. The fragments are
  // derived from the constants (no hand-maintained literal); the per-width
  // scaling is deterministic from `width`, which is already in the key.
  //
  // Daily rotation adds the day bucket (`:rb<bucket>`) so a rotated thumbnail
  // is a day-specific representation and a bucket change can never be served
  // from the previous day's entry. Absent/failed rotation emits no fragment,
  // keeping the historical key (and its entries) byte-identical.
  const rotationFragment = typeof input.rotationBucket === "number" && Number.isFinite(input.rotationBucket)
    ? `:rb${Math.trunc(input.rotationBucket)}`
    : ""
  const epochFragment = typeof input.epoch === "string" && input.epoch && input.epoch !== "0" ? `:e${input.epoch}` : ""
  return `thumbnail:episode:${input.seriesId}:${input.seasonNumber}:${input.episodeNumber}:${stillPathHash(input.still)}:${input.width}:${input.badges}:bs${badgeStyle}:a${anchor}:x${ox}:y${oy}:sc${scale}:mx${THUMBNAIL_BADGE_SAFE_MARGIN_X}:my${THUMBNAIL_BADGE_SAFE_MARGIN_Y}:pr${provider}:src${voteSource}:si${stills}:b${input.blur ? 1 : 0}:${input.languages}${rotationFragment}${epochFragment}`
}

export class ThumbnailRenderError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Shared, bounded image fetch used by both still providers (10MB cap). */
async function fetchImageBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const timeoutSignal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(8000)
    : undefined
  const combined = signal && timeoutSignal && typeof (AbortSignal as unknown as { any?: unknown }).any === "function"
    ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
    : timeoutSignal ?? signal
  let res: Response
  try {
    res = await fetch(url, { signal: combined, headers: { accept: "image/*" } })
  } catch {
    throw new ThumbnailRenderError(502, "Episode still unavailable")
  }
  if (!res.ok) throw new ThumbnailRenderError(502, "Episode still unavailable")
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (contentType && !contentType.startsWith("image/")) {
    throw new ThumbnailRenderError(502, "Episode still unavailable")
  }
  try {
    const body = await readResponseBodyCapped(res, MAX_STILL_BYTES, () => new Error("still too large"))
    return Buffer.from(body)
  } catch {
    throw new ThumbnailRenderError(502, "Episode still unavailable")
  }
}

async function fetchStillBuffer(still: string, width: ThumbnailWidth, signal?: AbortSignal): Promise<Buffer> {
  // Exact TMDB image CDN + sanitized single-segment path: the caller never
  // supplies a host, so this cannot become an arbitrary fetch.
  const url = `${stillSourceBase(width)}${still}`
  // Defense in depth with the shared TMDB image allowlist: exact host +
  // documented `/t/p/<size>/<raster-file>` path. The sanitized path already
  // guarantees this, the gate makes the invariant explicit and reviewable.
  if (!isTmdbImageCdnUrl(url)) throw new ThumbnailRenderError(502, "Episode still unavailable")
  return fetchImageBuffer(url, signal)
}

/**
 * Fetch a TVDB episode still. The URL is validated against the exact
 * `artworks.thetvdb.com` host and a raster nested path (same bar as the
 * shared image allowlist), and it is the ONLY external input of this leg:
 * the TVDB API key is never part of the URL or the cache key.
 */
async function fetchTvdbStillBuffer(rawUrl: string, signal?: AbortSignal): Promise<Buffer> {
  const url = sanitizeTvdbStillUrl(rawUrl)
  if (!url) throw new ThumbnailRenderError(502, "Episode still unavailable")
  return fetchImageBuffer(url, signal)
}

/**
 * Fetch the base still from whichever trusted source the caller supplied: a
 * canonical `artworks.thetvdb.com` URL (AIO's direct TVDB `{thumbnail}`) or the
 * sanitized single-segment TMDB path. Each leg keeps its own sanitizer; the
 * TVDB one has no size policy because the URL is the complete artwork file.
 */
async function fetchStillBufferForInput(
  still: string,
  width: ThumbnailWidth,
  signal?: AbortSignal,
): Promise<Buffer> {
  const tvdbUrl = sanitizeTvdbStillUrl(still)
  if (tvdbUrl) return fetchTvdbStillBuffer(tvdbUrl, signal)
  return fetchStillBuffer(still, width, signal)
}

type ThumbnailBadge = { png: Buffer; w: number; h: number; bleed?: BadgeBleed }

/**
 * Scale a composed badge bitmap by the requested `bscale` percent.
 *
 * 100 returns the EXACT input object (no `sharp` pass), so the historical
 * thumbnail stays byte-identical. Other scales resize the pill bitmap
 * proportionally (bleed rect included); the caller's existing
 * `fitBadgeToCanvas` still caps it to the thumbnail canvas.
 */
async function scaleThumbnailBadge<T extends ThumbnailBadge>(badge: T, scalePct: number): Promise<T> {
  if (scalePct === DEFAULT_THUMBNAIL_BADGE_SCALE) return badge
  const k = scalePct / DEFAULT_THUMBNAIL_BADGE_SCALE
  const w = Math.max(1, Math.round(badge.w * k))
  const h = Math.max(1, Math.round(badge.h * k))
  const png = await sharp(badge.png)
    .resize(w, h, { fit: "fill" })
    .png({ compressionLevel: 1 })
    .toBuffer()
  const bleed = badge.bleed ? scaleBadgeBleed(badge.bleed, w / badge.w, h / badge.h) : undefined
  return { ...badge, png, w, h, ...(bleed ? { bleed } : {}) }
}

/**
 * Providers that own a brand logo asset usable on the horizontal rating pill.
 *
 * The pill itself is NOT drawn here: `renderSeparateRatingsBottom` (the same
 * branded renderer used by the poster pipeline) owns logo + inline score and
 * its own fit-to-width safety net. Unknown brands keep the text-only
 * `renderMultiRatings` pill.
 */
export const THUMBNAIL_BRANDED_RATING_IDS = ["imdb", "mal", "trakt", "tmdb"] as const

/** True when the provider id has a known brand mark for the horizontal pill. */
export function isThumbnailBrandedRatingId(id: string): boolean {
  return (THUMBNAIL_BRANDED_RATING_IDS as readonly string[]).includes(id.trim().toLowerCase())
}

/**
 * Scope of the `customRatings` supplied by a caller.
 *
 * ONLY `"episode"` (a genuinely per-episode score source) may be branded. The
 * default is `"title"` fail-closed: a series-level score rendered next to an
 * episode still would read as the episode's IMDb/MAL rating, which is exactly
 * the mislabel this renderer must never produce.
 */
export type ThumbnailCustomRatingScope = "episode" | "title"

/**
 * First branding-eligible item of a custom rating list, or `null` when the
 * list is title-level (fail-closed), has no known brand, or the value is not a
 * drawable positive number. Pure: no I/O, used by the renderer and its tests.
 */
export function pickBrandedThumbnailRating(
  items: readonly RatingItem[],
  scope: ThumbnailCustomRatingScope = "title",
): { readonly id: string; readonly value: number } | null {
  if (scope !== "episode") return null
  for (const item of items) {
    if (!isThumbnailBrandedRatingId(item.id)) continue
    if (!Number.isFinite(item.value) || item.value <= 0) continue
    return { id: item.id.trim().toLowerCase(), value: item.value }
  }
  return null
}

export interface RenderEpisodeThumbnailInput {
  /**
   * Base still: a sanitized TMDB still path OR a canonical TVDB still URL
   * (`artworks.thetvdb.com`, accepted directly with no API lookup). In
   * `stills: "tvdb"` it is still the fail-open fallback.
   */
  readonly still: string
  /**
   * Preferred base provider; absent = `tmdb` (historical). `tvdb` only changes
   * the base image: `still` is still required as the fallback and all badge
   * compositing stays identical.
   */
  readonly stills?: ThumbnailStillSource
  /**
   * Absolute TVDB episode still URL resolved by the caller when
   * `stills === "tvdb"`. Invalid/missing values fail open to `still`.
   */
  readonly tvdbStill?: string | null
  readonly width: ThumbnailWidth
  readonly badgeMode: ThumbnailBadgeMode
  /** Vote-badge style (`pill`/`bordo`/`vetro`; `branded` selects the branded
   *  separate-renderer path; `naked` draws the source brand mark + score with
   *  no container; `score` draws the bucket-coloured big-score tile with no
   *  brand mark; `dot` is the round (circle) variant of `score`). Absent =
   *  `pill`. */
  readonly badgeStyle?: ThumbnailBadgeStyle
  /** Corner anchor; absent = `tr` (top-right, TOP convention). */
  readonly anchor?: ThumbnailBadgeAnchor
  /** User offset from the anchor in canvas px; absent = 0. */
  readonly offsetX?: number
  readonly offsetY?: number
  /** Badge-stack scale percent (10..200); absent = 100 (historical size). */
  readonly badgeScale?: number
  readonly voteAverage: number
  readonly customRatings: readonly RatingItem[]
  /**
   * Where `customRatings` come from. Absent = `"title"` (never branded). Only a
   * per-episode source may opt into the branded pill via `"episode"`.
   */
  readonly customRatingsScope?: ThumbnailCustomRatingScope
  /** Provenance of `voteAverage`; absent = `imdb`. Does not change the ★ recipe. */
  readonly voteSource?: ThumbnailVoteSource
  /** Blur the still (spoiler protection); badges are always composited after. */
  readonly blur: boolean
  readonly signal?: AbortSignal
}

export interface RenderEpisodeThumbnailResult {
  readonly png: Buffer
  readonly w: number
  readonly h: number
  /** Whether each pill was actually drawn (used by tests and diagnostics). */
  readonly rendered: { readonly vote: boolean; readonly custom: boolean }
  /** Provenance of the drawn ★ value, echoed for diagnostics/tests. */
  readonly voteSource: ThumbnailVoteSource
  /** Base actually used (TVDB can fail open to the TMDB path). */
  readonly stillSource: ThumbnailStillSource
  /** Visible stack box on the thumbnail canvas (drag/debug geometry). */
  readonly geometry: { readonly left: number; readonly top: number; readonly w: number; readonly h: number }
}

/** `badges` diagnostics payload the shared enlarged-preview drag layer parses. */
export interface ThumbnailBadgeGeometryReport {
  readonly badges: {
    readonly canvasW: number
    readonly canvasH: number
    /** No independent top slot exists on a thumbnail. */
    readonly kind: null
    readonly layout: "ranked"
    /** The badge stack is the single movable family (`genre`). */
    readonly families: {
      readonly genre: RenderEpisodeThumbnailResult["geometry"]
    }
    /** The stack X offset is always applied: no locked axis. */
    readonly fixedX: Record<string, boolean>
    /** Every pill moves with the stack: no per-item or ghost targets. */
    readonly items: readonly never[]
  }
}

/**
 * Diagnostics payload of `?debug=1&netgeo=1` for the episode thumbnail.
 *
 * The enlarged-preview drag overlay is the SAME implementation used by the
 * poster editor, so the thumbnail must speak the SAME `badges` contract
 * (`parseBadgeDragGeometry`: `families`, `fixedX`, `items`). Reporting the box
 * under any other key makes the parser bail, the overlay never mounts and the
 * drag looks broken. There is exactly one movable family (the rating pill
 * stack, `genre`); `ox`/`oy` move every pill together, so there are no
 * per-item/ghost targets.
 */
export function thumbnailBadgeGeometryReport(
  result: Pick<RenderEpisodeThumbnailResult, "w" | "h" | "geometry">,
): ThumbnailBadgeGeometryReport {
  return {
    badges: {
      canvasW: result.w,
      canvasH: result.h,
      kind: null,
      layout: "ranked",
      families: { genre: result.geometry },
      fixedX: {},
      items: [],
    },
  }
}

/**
 * Base font of the naked vote badge on the reference 380px canvas (the same
 * scale family used by the shared horizontal rating renderers). The real font
 * follows the canvas width and the user `bscale`.
 */
const NAKED_BADGE_BASE_FONT = 23
const NAKED_BADGE_SCALE = 130
/** Minimum shadow/scrim padding around the naked cluster (never clipped). */
const NAKED_BADGE_SHADOW_PAD = 8

// ---------------------------------------------------------------------------
// Score badge ("Absolute Cinema" grid).
//
// A rounded rect with the big episode score; the fill encodes the vote bucket
// and NO provider logo is drawn. The chosen vote source still selects WHICH
// score feeds the bucket (the route already resolved `voteAverage`), it is
// only hidden visually. Buckets are half-open on purpose: 9.9 is still the
// dark-green "Awesome" band, exactly 10.0 is blue "Absolute Cinema".
// ---------------------------------------------------------------------------

/** sRGB linearisation used only by the score-tile ink choice (WCAG). */
function scoreSrgbLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const s = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/**
 * Ink for a score-tile background: white or near-black, whichever has the
 * higher WCAG contrast. Derived from the colour itself, so a palette tweak can
 * never leave an unreadable label behind.
 */
export function thumbnailScoreInk(color: string): "#ffffff" | "#111111" {
  const lum = scoreSrgbLuminance(color)
  const white = 1.05 / (lum + 0.05)
  const black = (lum + 0.05) / 0.05
  return white >= black ? "#ffffff" : "#111111"
}

export const THUMBNAIL_SCORE_BUCKETS = [
  { id: "garbage", label: "Garbage", color: "#6D28D9", ink: thumbnailScoreInk("#6D28D9"), min: 0, max: 5 },
  { id: "bad", label: "Bad", color: "#DC2626", ink: thumbnailScoreInk("#DC2626"), min: 5, max: 6 },
  { id: "average", label: "Average", color: "#EA580C", ink: thumbnailScoreInk("#EA580C"), min: 6, max: 7 },
  { id: "good", label: "Good", color: "#EAB308", ink: thumbnailScoreInk("#EAB308"), min: 7, max: 8 },
  { id: "great", label: "Great", color: "#15803D", ink: thumbnailScoreInk("#15803D"), min: 8, max: 9 },
  { id: "awesome", label: "Awesome", color: "#14532D", ink: thumbnailScoreInk("#14532D"), min: 9, max: 10 },
  { id: "absolute-cinema", label: "Absolute Cinema", color: "#2563EB", ink: thumbnailScoreInk("#2563EB"), min: 10, max: Number.POSITIVE_INFINITY },
] as const

export type ThumbnailScoreBucket = (typeof THUMBNAIL_SCORE_BUCKETS)[number]

/**
 * Bucket for a vote, or `null` when there is no real score to paint.
 *
 * `0`, negative, `NaN`/`Infinity` and anything that is not a finite positive
 * number return `null`: the caller skips the badge entirely instead of
 * inventing a purple "Garbage" tile for a missing rating.
 */
export function thumbnailScoreBucket(value: number): ThumbnailScoreBucket | null {
  if (!Number.isFinite(value) || value <= 0) return null
  for (const bucket of THUMBNAIL_SCORE_BUCKETS) {
    if (value >= bucket.min && value < bucket.max) return bucket
  }
  // Values above the last upper bound (e.g. an upstream 10.2) stay blue.
  return THUMBNAIL_SCORE_BUCKETS[THUMBNAIL_SCORE_BUCKETS.length - 1]!
}

const SCORE_BADGE_BASE_FONT = 36
/** Shadow padding around the score tile (same family as the naked badge). */
const SCORE_BADGE_SHADOW_PAD = 8

/**
 * Naked vote badge: provider brand mark (IMDb/TMDB) + WHITE score, with a soft
 * dark drop-shadow on the text and a small radial scrim behind the cluster.
 *
 * Why a local builder instead of `bottom-color`: the shared container-free
 * layout paints DARK score ink and has no shadow, which disappears on a light
 * still and cannot be overridden without changing the poster renderer. This
 * builder reuses the SAME brand assets (`loadSeparateRatingLogo`),
 * value formatter and font metrics, and draws only what the naked contract
 * needs: no pill/band/border, logo untouched, white score + dark halo/scrim so
 * it stays readable on both light and dark stills. Returns `null` when the
 * brand asset is missing so the caller can fail open to the neutral pill.
 */
async function renderNakedVoteBadge(
  voteSource: ThumbnailVoteSource,
  value: number,
  canvasWidth: ThumbnailWidth,
): Promise<ThumbnailBadge | null> {
  // Same base sizing family as the shared bottom renderers (font scales with
  // the canvas), then the historical 130% scale.
  const baseFs = Math.round(Math.max((NAKED_BADGE_BASE_FONT * canvasWidth) / 380, 11))
  const fs = Math.max(1, Math.round((baseFs * NAKED_BADGE_SCALE) / 100))
  const logoH = Math.round(fs * 1.05)
  const logo = await loadSeparateRatingLogo(voteSource, logoH)
  if (!logo) return null
  const display = formatSeparateValue(voteSource, value)
  const textW = Math.max(1, Math.round(estimateTextWidth(display, fs, "inter")))
  const gap = Math.max(3, Math.round(fs * 0.35))
  const contentW = Math.round(logo.w + gap + textW)
  const contentH = Math.round(Math.max(logo.h, fs))
  const pad = Math.max(NAKED_BADGE_SHADOW_PAD, Math.round(fs * 0.5))
  const canvasW = contentW + pad * 2
  const canvasH = contentH + pad * 2
  const logoX = pad
  const logoY = pad + Math.round((contentH - logo.h) / 2)
  const textX = pad + logo.w + gap
  const textY = pad + contentH / 2
  const scrimRx = Math.round(contentW / 2 + pad * 0.7)
  const scrimRy = Math.round(contentH / 2 + pad * 0.7)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
    // Small radial scrim: dark in the centre, fully transparent at the edge.
    // It backs the whole cluster (not a pill shape) and never leaves the
    // transparent canvas, so the still around it is untouched.
    `<defs><radialGradient id="nakedScrim" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#000000" stop-opacity="0.58"/>` +
    `<stop offset="62%" stop-color="#000000" stop-opacity="0.38"/>` +
    `<stop offset="100%" stop-color="#000000" stop-opacity="0"/>` +
    `</radialGradient>` +
    // Soft dark halo under the score: white text stays readable on light stills.
    `<filter id="nakedTextShadow" x="-40%" y="-40%" width="180%" height="180%">` +
    `<feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.9"/>` +
    `</filter></defs>` +
    `<ellipse cx="${canvasW / 2}" cy="${canvasH / 2}" rx="${scrimRx}" ry="${scrimRy}" fill="url(#nakedScrim)"/>` +
    // Logo asset unchanged (same PNG the branded renderers use).
    `<image href="data:image/png;base64,${logo.png.toString("base64")}" x="${logoX}" y="${logoY}" width="${logo.w}" height="${logo.h}"/>` +
    `<g filter="url(#nakedTextShadow)">` +
    `<text x="${textX}" y="${textY}" text-anchor="start" dominant-baseline="central" ` +
    `font-family="${fontFamilyFor(display, "inter")}" font-weight="700" font-size="${fs}" fill="#ffffff" ` +
    `textLength="${textW}" lengthAdjust="spacingAndGlyphs">${escSvg(display)}</text>` +
    `</g></svg>`
  const png = await renderSVG(svg, canvasW)
  // `bleed` = the visible cluster (not the transparent shadow canvas), so the
  // existing anchor/offset math positions the BODY exactly like every other
  // badge style and the shadow never eats the safe margin.
  return {
    png,
    w: canvasW,
    h: canvasH,
    bleed: { x: pad, y: pad, w: contentW, h: contentH },
  }
}

/**
 * Score tile: rounded rect filled with the vote bucket colour + the big score.
 *
 * Deliberately draws NO provider logo — the vote source only chose which score
 * feeds the bucket (the route already resolved it). The rect carries a subtle
 * dark drop shadow so it keeps its edge on a light still; the number uses the
 * bucket's WCAG-derived white/black ink. Returns `null` when there is no real
 * score (0/missing/non-finite), so the caller skips the badge instead of
 * faking a bucket.
 */
async function renderScoreVoteBadge(
  voteSource: ThumbnailVoteSource,
  value: number,
  canvasWidth: ThumbnailWidth,
): Promise<ThumbnailBadge | null> {
  const bucket = thumbnailScoreBucket(value)
  if (!bucket) return null
  // Scale with the canvas like every other local badge family, then render
  // the big score (one decimal, same value formatter as the rating rows).
  const fs = Math.max(12, Math.round((SCORE_BADGE_BASE_FONT * canvasWidth) / 380))
  const display = formatSeparateValue(voteSource, value)
  const textW = Math.max(1, Math.round(estimateTextWidth(display, fs, "inter")))
  const padX = Math.max(6, Math.round(fs * 0.42))
  const padY = Math.max(4, Math.round(fs * 0.24))
  const boxW = textW + padX * 2
  const boxH = fs + padY * 2
  const radius = Math.max(3, Math.round(boxH * 0.26))
  const pad = SCORE_BADGE_SHADOW_PAD
  const canvasW = boxW + pad * 2
  const canvasH = boxH + pad * 2
  const textX = pad + boxW / 2
  const textY = pad + boxH / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
    // Subtle dark halo around the tile: keeps the coloured rect separated from
    // a bright still without adding a second container or background layer.
    `<defs><filter id="scoreShadow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.55"/>` +
    `</filter></defs>` +
    `<g filter="url(#scoreShadow)">` +
    `<rect x="${pad}" y="${pad}" width="${boxW}" height="${boxH}" rx="${radius}" fill="${bucket.color}"/>` +
    `</g>` +
    `<text x="${textX}" y="${textY}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${fontFamilyFor(display, "inter")}" font-weight="900" font-size="${fs}" fill="${bucket.ink}" ` +
    `textLength="${textW}" lengthAdjust="spacingAndGlyphs">${escSvg(display)}</text>` +
    `</svg>`
  const png = await renderSVG(svg, canvasW)
  // Placement anchors the visible rect, never the transparent shadow canvas.
  return {
    png,
    w: canvasW,
    h: canvasH,
    bleed: { x: pad, y: pad, w: boxW, h: boxH },
  }
}

/**
 * Score dot: the ROUND variant of the score tile — same data/colour contract
 * (bucket colour fill, same white/black ink, same big score, NO provider logo,
 * same shadow), but the container is a filled circle instead of the rounded
 * rect. The circle diameter is the larger of the score tile's box width/height,
 * so the score keeps the exact same font/display/metrics inside a round canvas.
 *
 * Returns `null` when there is no real score (0/missing/non-finite), exactly
 * like `renderScoreVoteBadge`: the caller skips the badge and never falls back
 * to a neutral pill or an invented bucket.
 */
async function renderScoreDotVoteBadge(
  voteSource: ThumbnailVoteSource,
  value: number,
  canvasWidth: ThumbnailWidth,
): Promise<ThumbnailBadge | null> {
  const bucket = thumbnailScoreBucket(value)
  if (!bucket) return null
  // Same sizing family as the score tile: canvas-scaled font + value formatter.
  const fs = Math.max(12, Math.round((SCORE_BADGE_BASE_FONT * canvasWidth) / 380))
  const display = formatSeparateValue(voteSource, value)
  const textW = Math.max(1, Math.round(estimateTextWidth(display, fs, "inter")))
  const padX = Math.max(6, Math.round(fs * 0.42))
  const padY = Math.max(4, Math.round(fs * 0.24))
  const boxW = textW + padX * 2
  const boxH = fs + padY * 2
  // Round container: the diameter is the score tile's larger dimension, so the
  // score keeps the same metrics and the badge is a true circle.
  const diameter = Math.max(boxW, boxH)
  const radius = diameter / 2
  const pad = SCORE_BADGE_SHADOW_PAD
  const canvasSize = diameter + pad * 2
  const center = pad + radius
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}">` +
    // Same dark halo as the score tile: keeps the coloured circle separated
    // from a bright still without adding a second container.
    `<defs><filter id="scoreDotShadow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.55"/>` +
    `</filter></defs>` +
    `<g filter="url(#scoreDotShadow)">` +
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="${bucket.color}"/>` +
    `</g>` +
    `<text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${fontFamilyFor(display, "inter")}" font-weight="900" font-size="${fs}" fill="${bucket.ink}" ` +
    `textLength="${textW}" lengthAdjust="spacingAndGlyphs">${escSvg(display)}</text>` +
    `</svg>`
  const png = await renderSVG(svg, canvasSize)
  // Placement anchors the visible circle, never the transparent shadow canvas.
  return {
    png,
    w: canvasSize,
    h: canvasSize,
    bleed: { x: pad, y: pad, w: diameter, h: diameter },
  }
}

/**
 * Fetch the chosen still, resize it to the 16:9 thumbnail canvas and draw the
 * requested rating pills bottom-right. Missing vote / unavailable custom
 * ratings simply skip the corresponding pill (never a placeholder).
 */
export async function renderEpisodeThumbnail(input: RenderEpisodeThumbnailInput): Promise<RenderEpisodeThumbnailResult> {
  const width = input.width
  const height = thumbnailHeight(width)
  const voteSource = input.voteSource ?? DEFAULT_THUMBNAIL_VOTE_SOURCE
  const badgeStyle = input.badgeStyle ?? DEFAULT_THUMBNAIL_BADGE_STYLE
  // Badge-stack scale (percent of the standard render). 100 = historical size
  // and the exact old pipeline (the bitmap is never touched).
  const badgeScale = input.badgeScale ?? DEFAULT_THUMBNAIL_BADGE_SCALE
  // The branded path is its own material: only an explicit `branded` choice
  // selects it, and then bordo/vetro/pill are ignored. Other styles ignore
  // brand entirely (custom ratings fall back to the neutral text pill).
  const useBranded = badgeStyle === "branded"
  // `naked` is the container-free vote badge: the source's brand mark + WHITE
  // score with a dark halo/scrim (no pill/band/border). It reuses the SAME
  // brand assets, score font/metrics and value formatter the poster pipeline
  // uses, only the local composition differs.
  const useNaked = badgeStyle === "naked"
  // `score` is its own local material (bucket-coloured rounded tile, no logo).
  const useScore = badgeStyle === "score"
  // `dot` is the ROUND variant of the score material: same bucket/ink/score and
  // the same "no badge on missing/zero vote" contract, only the shape differs.
  const useDot = badgeStyle === "dot"
  const voteBadgeStyle = badgeStyle === "bordo" || badgeStyle === "vetro" ? badgeStyle : "pill"
  // Base image: the TVDB leg is strictly best-effort. Any miss (no URL, invalid
  // host/path, transport error, non-image body) fails open to the supplied
  // still, so a third-party lookup can never turn a thumbnail into a 500. The
  // badges are composited identically afterwards; only the base bytes change.
  // The supplied `still` itself may already be a canonical TVDB URL (AIO's
  // direct `{thumbnail}`): that leg is fetched as-is, with no TVDB API lookup.
  const preferredStillSource = input.stills ?? DEFAULT_THUMBNAIL_STILL_SOURCE
  const directTvdbStill = sanitizeTvdbStillUrl(input.still)
  let stillBuffer: Buffer
  let stillSource: ThumbnailStillSource = directTvdbStill ? "tvdb" : "tmdb"
  if (preferredStillSource === "tvdb" && input.tvdbStill) {
    try {
      stillBuffer = await fetchTvdbStillBuffer(input.tvdbStill, input.signal)
      stillSource = "tvdb"
    } catch (e) {
      if (!(e instanceof ThumbnailRenderError)) throw e
      stillBuffer = await fetchStillBufferForInput(input.still, width, input.signal)
      stillSource = directTvdbStill ? "tvdb" : "tmdb"
    }
  } else {
    stillBuffer = await fetchStillBufferForInput(input.still, width, input.signal)
  }

  let base: Buffer
  try {
    let pipeline = sharp(stillBuffer).resize(width, height, { fit: "cover", position: "centre" })
    // Spoiler protection blurs the STILL only, before any composite: the
    // badges are drawn afterwards and stay crisp. `blur = false` leaves the
    // pipeline byte-identical to the plain thumbnail.
    if (input.blur) pipeline = pipeline.blur(thumbnailBlurSigma(width))
    base = await pipeline.png().toBuffer()
  } catch {
    throw new ThumbnailRenderError(502, "Episode still unavailable")
  }

  const wantsVote = input.badgeMode !== "custom" && Number.isFinite(input.voteAverage) && input.voteAverage > 0
  const wantsCustom = input.badgeMode !== "vote" && input.customRatings.length > 0
  // Branded pill ONLY for a genuine per-episode score: a title-level rating
  // (series IMDb/Trakt fetched by series id) must never be presented as the
  // episode's IMDb value next to the still. `pickBrandedThumbnailRating`
  // returns null for the default/`"title"` scope, so the text pill stays.
  const brandedRating = wantsCustom && useBranded
    ? pickBrandedThumbnailRating(input.customRatings, input.customRatingsScope)
    : null

  const safeMarginX = thumbnailBadgeSafeMarginX(width)
  const safeMarginY = thumbnailBadgeSafeMarginY(width)
  const maxW = Math.max(1, width - safeMarginX * 2)
  const availableH = Math.max(1, height - safeMarginY * 2)
  const count = (wantsVote ? 1 : 0) + (wantsCustom ? 1 : 0)
  const perMaxH = count > 0
    ? Math.max(1, Math.floor((availableH - THUMBNAIL_BADGE_GAP * (count - 1)) / count))
    : availableH

  let voteBadge: ThumbnailBadge | null = null
  let customBadge: ThumbnailBadge | null = null
  if (wantsVote) {
    // Branded style: the vote source's own logo + inline score through the
    // SHARED separate-rating renderer (same `public/rating/*.svg` brand map).
    // The custom branded item (when present) already represents the brand, so
    // the vote pill then keeps the neutral recipe. Missing logo asset → null
    // → neutral text pill fallback below (never a broken image).
    const brandedVote = badgeStyle === "branded" && !brandedRating
      ? await renderSeparateRatingsBottom(
          [{ id: voteSource, value: input.voteAverage }],
          width,
          "bottom-pills",
          "inter",
          130,
          maxW,
        )
      : null
    // Naked vote: the source brand mark (IMDb/TMDB) + WHITE score with NO
    // container, a soft dark halo on the text and a small radial scrim behind
    // the cluster (readable on light and dark stills). A missing/unrasterizable
    // asset returns null and falls back to the neutral pill below, never a 500
    // or an empty badge.
    const nakedVote = useNaked
      ? await renderNakedVoteBadge(voteSource, input.voteAverage, width)
      : null
    // Score tile: bucket colour + big score, NO brand mark. `null` (missing /
    // zero vote) stays null: score style never falls back to a fake pill or an
    // invented bucket.
    const scoreVote = useScore
      ? await renderScoreVoteBadge(voteSource, input.voteAverage, width)
      : null
    // Score dot: same bucket colour + score as `score`, round container. `null`
    // (missing / zero vote) stays null: dot never falls back to a pill either.
    const dotVote = useDot
      ? await renderScoreDotVoteBadge(voteSource, input.voteAverage, width)
      : null
    const voteSourceBadge = useDot
      ? dotVote
      : useScore
        ? scoreVote
        : brandedVote ?? nakedVote ?? await renderGenreBadge(
        "",
        input.voteAverage,
        width,
        undefined,
        voteBadgeStyle,
        undefined,
        false,
        { showGenre: false, showYear: false, showRating: true },
        100,
        "inter",
      )
    if (voteSourceBadge) {
      voteBadge = await fitBadgeToCanvas(
        await scaleThumbnailBadge(voteSourceBadge, badgeScale),
        maxW,
        perMaxH,
      )
    }
  }
  if (wantsCustom && brandedRating) {
    // Branded single pill: reused shared renderer (logo + inline score), not a
    // second implementation. `bottom-pills` is the horizontal TOP-parity
    // layout; the renderer's own fit keeps the row inside `maxW` and the
    // canvas fit below bounds the height.
    const branded = await renderSeparateRatingsBottom(
      [brandedRating],
      width,
      "bottom-pills",
      "inter",
      130,
      maxW,
    )
    if (branded) customBadge = await fitBadgeToCanvas(await scaleThumbnailBadge(branded, badgeScale), maxW, perMaxH)
  }
  if (wantsCustom && !customBadge) {
    // Fallback (unknown brand, non-positive value, or missing logo asset):
    // the shared text pill. The thumbnail still caps it to one item.
    const custom = await renderMultiRatings([input.customRatings[0]], maxW, false, "inter")
    if (custom) customBadge = await fitBadgeToCanvas(await scaleThumbnailBadge(custom, badgeScale), maxW, perMaxH)
  }

  const composites: { input: Buffer; left: number; top: number }[] = []
  const rendered = { vote: false, custom: false }
  // Corner-anchored stack (default top-right = TOP convention). `badgeBody`
  // anchors the visible body, so the transparent shadow padding is kept
  // inside the safe margin. `ox`/`oy` are user offsets from that corner;
  // non-zero values are the manual "custom" state after presets.
  //
  // Unlike the poster sliders, offsets are CONTAINED here: clients paint the
  // thumbnail inside a rounded, overflow-hidden, cover-cropped card, so a badge
  // moved past the edge would be cut. The offset is clamped once for the whole
  // stack (widest body / full stack height), which keeps the badges' relative
  // alignment and the visible body inside the safe margins at every anchor and
  // scale. In-bounds offsets (the normal case, including 0) are unchanged.
  const anchor = input.anchor ?? DEFAULT_THUMBNAIL_BADGE_ANCHOR
  const rawOffsetX = input.offsetX ?? 0
  const rawOffsetY = input.offsetY ?? 0
  const anchorRight = anchor === "tr" || anchor === "br"
  const anchorBottom = anchor === "bl" || anchor === "br"
  const stack = [voteBadge, customBadge].filter((b): b is ThumbnailBadge => b !== null)
  const stackBodies = stack.map((badge) => badgeBody(badge))
  const stackH = stackBodies.reduce((sum, body) => sum + body.h, 0)
    + THUMBNAIL_BADGE_GAP * Math.max(0, stackBodies.length - 1)
  const widestBody = stackBodies.reduce((max, body) => Math.max(max, body.w), 0)
  const maxOffsetX = Math.max(0, width - safeMarginX * 2 - widestBody)
  const maxOffsetY = Math.max(0, height - safeMarginY * 2 - stackH)
  const offsetX = anchorRight
    ? Math.max(-maxOffsetX, Math.min(0, rawOffsetX))
    : Math.max(0, Math.min(maxOffsetX, rawOffsetX))
  const offsetY = anchorBottom
    ? Math.max(-maxOffsetY, Math.min(0, rawOffsetY))
    : Math.max(0, Math.min(maxOffsetY, rawOffsetY))
  let cursorTop = (anchorBottom ? height - safeMarginY - stackH : safeMarginY) + offsetY
  let unionLeft = Number.POSITIVE_INFINITY
  let unionTop = Number.POSITIVE_INFINITY
  let unionRight = 0
  let unionBottom = 0
  for (let i = 0; i < stack.length; i++) {
    const badge = stack[i]!
    const body = stackBodies[i]!
    const bodyLeft = (anchorRight ? width - safeMarginX - body.w : safeMarginX) + offsetX
    const canvas = badgeCanvasForBody(bodyLeft, cursorTop, badge)
    composites.push({ input: badge.png, left: Math.round(canvas.left), top: Math.round(canvas.top) })
    unionLeft = Math.min(unionLeft, bodyLeft)
    unionTop = Math.min(unionTop, cursorTop)
    unionRight = Math.max(unionRight, bodyLeft + body.w)
    unionBottom = Math.max(unionBottom, cursorTop + body.h)
    cursorTop += body.h + THUMBNAIL_BADGE_GAP
  }
  const geometry = stack.length > 0
    ? { left: unionLeft, top: unionTop, w: unionRight - unionLeft, h: unionBottom - unionTop }
    : { left: 0, top: 0, w: 0, h: 0 }
  if (voteBadge) rendered.vote = true
  if (customBadge) rendered.custom = true

  const png = composites.length
    ? await sharp(base).composite(composites).png().toBuffer()
    : base
  return { png, w: width, h: height, rendered, voteSource, stillSource, geometry }
}
