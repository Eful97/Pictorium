/**
 * Settings "Miniature" preview target (V1: selector + live preview only).
 *
 * The thumbnail compositor is the existing `/api/thumbnail` endpoint; this
 * module only builds the SAMPLE URL shown by the settings preview. It reuses
 * the single client-safe URL builder (`buildEpisodeThumbnailUrl`) so the
 * sanitizer/parameter contract stays in one place.
 *
 * Sample rule (follow-up):
 * - TV title in preview → its own S01E01 first still, resolved through the
 *   existing episode-stills endpoint (no second metadata source).
 * - Movie, empty still list, fetch error or invalid path → stable Breaking
 *   Bad S01E01 fallback (`/api/thumbnail` stays renderable, never a broken
 *   placeholder).
 *
 * No new backend parameter and no second renderer: the sample uses an
 * allowlisted width, the standard badge mode and the existing `blur` flag
 * (mapped from the poster blur default so that control still has a visible
 * effect).
 */

import { buildEpisodeThumbnailUrl, sanitizeEpisodeStillPath } from "@/lib/episode-stills"
import { userFetch } from "@/lib/http"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"
import type { ThumbnailBadgeAnchor, ThumbnailBadgeStyle, ThumbnailFillerStyle } from "@/lib/contexts/PosterEditorContext"
import { getDomain } from "@/lib/utils"

/** Stable public TV sample used as the fallback. */
export const THUMBNAIL_PREVIEW_DEMO_SERIES_ID = 1396 // Breaking Bad (TMDB id)
export const THUMBNAIL_PREVIEW_SEASON = 1
export const THUMBNAIL_PREVIEW_EPISODE = 1
/**
 * TMDB image path used as the fallback still. The compositor only requires a
 * sanitized TMDB raster path (not a semantically verified episode still), so
 * this stable path keeps the sample working without a metadata round-trip.
 */
export const THUMBNAIL_PREVIEW_SAMPLE_STILL = "/dZSyWJ7F78W725BI7CKQIesvmKy.jpg"
/** Raw still CDN base used when the master badge toggle is OFF. */
export const THUMBNAIL_RAW_STILL_BASE = "https://image.tmdb.org/t/p/w780"
/**
 * Single standard thumbnail width for preview + `/meta` URLs: Stremio cards
 * are small, so a fixed 320 keeps the grid uniform and the cache variants
 * bounded. The route still accepts the wider allowlist for explicit callers.
 */
export const THUMBNAIL_PREVIEW_WIDTH = 320
/**
 * Thumbnail badge scale (percent of the standard render). 100 is the
 * historical fixed size; the settings preview always emits `bscale`
 * explicitly (WYSIWYG) and the enlarged-preview drag/resize writes the same
 * value the `/meta` URL carries.
 */
export const THUMBNAIL_BADGE_SCALE_MIN = 10
export const THUMBNAIL_BADGE_SCALE_MAX = 200
export const THUMBNAIL_BADGE_SCALE = 100

/** Clamp a raw scale to the renderer contract (integer 10..200). */
export function clampThumbnailBadgeScale(raw: number): number {
  if (!Number.isFinite(raw)) return THUMBNAIL_BADGE_SCALE
  const n = Math.round(raw)
  return Math.max(THUMBNAIL_BADGE_SCALE_MIN, Math.min(THUMBNAIL_BADGE_SCALE_MAX, n))
}
/**
 * Thumbnail vote-badge styles (renderer `bstyle` contract; `naked` = brand mark
 * + score, no container; `score` = bucket-coloured big-score tile, no logo;
 * `circle` = round variant of `score`: same bucket colour + score, no logo).
 */
export const THUMBNAIL_BADGE_STYLES = ["pill", "bordo", "vetro", "branded", "naked", "score", "circle"] as const
export const DEFAULT_THUMBNAIL_BADGE_STYLE: ThumbnailBadgeStyle = "pill"

export function sanitizeThumbnailBadgeStyle(raw: unknown): ThumbnailBadgeStyle {
  // Same normalization as the renderer parser (`trim` + lowercase): a stored
  // or queried `" CIRCLE "` resolves to `circle`, the legacy `dot` id maps to
  // `circle`, invalid values → pill.
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : raw
  const canonical = value === "dot" ? "circle" : value
  return (THUMBNAIL_BADGE_STYLES as readonly unknown[]).includes(canonical)
    ? (canonical as ThumbnailBadgeStyle)
    : DEFAULT_THUMBNAIL_BADGE_STYLE
}

/**
 * Source of the ★ episode vote (renderer `source` contract: `imdb`/`tmdb`).
 *
 * Mirrored locally instead of importing `thumbnail-renderer`: that module is
 * server-only (sharp + node:crypto) while this one is bundled into the client
 * settings UI. IMDb is the renderer default (per-episode Cinemeta poll); TMDB
 * is the explicit episode `vote_average`. The settings preview always emits
 * the source explicitly (WYSIWYG), unlike legacy URLs where absence = IMDb.
 */
export const THUMBNAIL_VOTE_SOURCES = ["imdb", "tmdb"] as const
export type ThumbnailVoteSource = (typeof THUMBNAIL_VOTE_SOURCES)[number]
export const DEFAULT_THUMBNAIL_VOTE_SOURCE: ThumbnailVoteSource = "imdb"

export function sanitizeThumbnailVoteSource(raw: unknown): ThumbnailVoteSource {
  return (THUMBNAIL_VOTE_SOURCES as readonly unknown[]).includes(raw)
    ? (raw as ThumbnailVoteSource)
    : DEFAULT_THUMBNAIL_VOTE_SOURCE
}

/** Corner anchors (renderer `anchor` contract); default top-right. */
export const THUMBNAIL_BADGE_ANCHORS = ["tl", "tr", "bl", "br"] as const
export const DEFAULT_THUMBNAIL_BADGE_ANCHOR: ThumbnailBadgeAnchor = "tr"

/**
 * Filler banner layouts (renderer `fillStyle` contract). `corner` is the
 * historical compact chip and the default; `strip` is the full-width top plate.
 */
export const THUMBNAIL_FILLER_STYLES = ["corner", "strip"] as const
export const DEFAULT_THUMBNAIL_FILLER_STYLE: ThumbnailFillerStyle = "corner"

export function sanitizeThumbnailFillerStyle(raw: unknown): ThumbnailFillerStyle {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : raw
  return (THUMBNAIL_FILLER_STYLES as readonly unknown[]).includes(value)
    ? (value as ThumbnailFillerStyle)
    : DEFAULT_THUMBNAIL_FILLER_STYLE
}

export function sanitizeThumbnailBadgeAnchor(raw: unknown): ThumbnailBadgeAnchor {
  return (THUMBNAIL_BADGE_ANCHORS as readonly unknown[]).includes(raw)
    ? (raw as ThumbnailBadgeAnchor)
    : DEFAULT_THUMBNAIL_BADGE_ANCHOR
}

export function clampThumbnailBadgeOffset(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  const n = Math.round(raw)
  return Math.max(-2000, Math.min(2000, n))
}

export interface ThumbnailPreviewInput {
  demoMedia?: DefaultsPreviewDemoMedia | null
  /** First S01E01 still of the TV title in preview (null = fallback). */
  still?: string | null
  /** Vote-pill style (invalid/absent → pill). */
  badgeStyle?: ThumbnailBadgeStyle | null
  /** Corner anchor (invalid/absent → tr) + px offsets from it. */
  anchor?: ThumbnailBadgeAnchor | null
  offsetX?: number | null
  offsetY?: number | null
  /** Badge-stack scale percent (invalid/absent → 100). */
  badgeScale?: number | null
  /** Master ON = composed badges; OFF = raw still, no /api/thumbnail call. */
  showBadges?: boolean
  /**
   * Preview-only sample classification: adds `fill=manga` (+ `flang`) so the
   * settings editor shows the banner layout. Delivered thumbnails still get
   * their classification only from `/meta`; an unknown title never shows one.
   */
  sampleFiller?: boolean
  /** Filler banner layout (`fillStyle`; ignored without `sampleFiller`). */
  fillerStyle?: ThumbnailFillerStyle | null
  /** Locale of the sample banner label (`flang`; ignored without `sampleFiller`). */
  fillerLang?: string | null
  /** Poster blur default → thumbnail spoiler blur (`blur=1`). */
  blur?: boolean
  /** Badge master → `both` (vote + custom) or `vote` only when disabled. */
  badgesEnabled?: boolean
  /** Episode ★ vote source (`source`; invalid/absent → imdb). */
  voteSource?: ThumbnailVoteSource | null
  /**
   * Scoped user (multi-user namespace) propagated as `u=` on the image URL so
   * the compositor resolves the same server-side keys the settings/meta
   * request did. Absent = global request, URL unchanged.
   */
  user?: string | null
}

/** Valid TV demo id of the title in preview, or null (movie/invalid). */
export function demoTvSeriesId(
  demoMedia: DefaultsPreviewDemoMedia | null | undefined,
): number | null {
  if (
    demoMedia &&
    demoMedia.mediaType === "tv" &&
    Number.isSafeInteger(demoMedia.id) &&
    demoMedia.id > 0
  ) {
    return demoMedia.id
  }
  return null
}



/**
 * Fetch the first usable S01E01 still of a TV title through the existing
 * episode-stills endpoint. Fail-closed (`null`) on any non-OK response,
 * malformed payload or invalid path: the caller then uses the stable fallback.
 */
export async function fetchFirstEpisodeStill(args: {
  seriesId: number
  tmdbKey?: string | null
  signal?: AbortSignal
}): Promise<string | null> {
  if (!Number.isSafeInteger(args.seriesId) || args.seriesId <= 0) return null
  try {
    const params = new URLSearchParams({ type: "tv", languages: "en,null" })
    const res = await userFetch(
      `/api/tmdb/${args.seriesId}/season/${THUMBNAIL_PREVIEW_SEASON}/episode/${THUMBNAIL_PREVIEW_EPISODE}/images?${params.toString()}`,
      {
        headers: args.tmdbKey ? { "x-api-key": args.tmdbKey } : undefined,
        ...(args.signal ? { signal: args.signal } : {}),
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { stills?: unknown }
    const rows = Array.isArray(json?.stills) ? json.stills : []
    for (const row of rows as Array<{ file_path?: unknown }>) {
      const path = sanitizeEpisodeStillPath(row?.file_path)
      if (path) return path
    }
    return null
  } catch {
    return null
  }
}

/**
 * Display-only locale tag for the sample banner (`flang`): a BCP47-ish tag
 * only, so a stray value can never grow the preview URL unbounded. Absent =
 * the route falls back to `Accept-Language` / `en`.
 */
function sanitizeFillerPreviewLang(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim()
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null
}

/**
 * Absolute thumbnail preview URL (same origin). Uses the title's own first
 * still when available; otherwise the stable fallback. Never throws.
 */
export function buildThumbnailPreviewUrl(input: ThumbnailPreviewInput = {}): string {
  const demoSeries = demoTvSeriesId(input.demoMedia)
  const demoStill = demoSeries ? sanitizeEpisodeStillPath(input.still) : null
  const seriesId = demoStill ? demoSeries! : THUMBNAIL_PREVIEW_DEMO_SERIES_ID
  const still = demoStill ?? THUMBNAIL_PREVIEW_SAMPLE_STILL
  // Master OFF: raw TMDB still, no compositor and therefore no rating pill.
  if (input.showBadges === false) return `${THUMBNAIL_RAW_STILL_BASE}${still}`
  const base = buildEpisodeThumbnailUrl({
    seriesId,
    season: THUMBNAIL_PREVIEW_SEASON,
    episode: THUMBNAIL_PREVIEW_EPISODE,
    still,
    width: THUMBNAIL_PREVIEW_WIDTH,
    badges: input.badgesEnabled === false ? "vote" : "both",
    user: input.user ?? null,
  })
  if (!base) return ""
  // Style is always explicit in the settings preview (WYSIWYG) and defaults
  // to pill; the renderer owns the actual material. `blur` is optional and
  // absent = byte-identical plain thumbnail.
  const style = sanitizeThumbnailBadgeStyle(input.badgeStyle)
  const anchor = sanitizeThumbnailBadgeAnchor(input.anchor)
  const ox = clampThumbnailBadgeOffset(input.offsetX ?? 0)
  const oy = clampThumbnailBadgeOffset(input.offsetY ?? 0)
  // Scale is always explicit too: the enlarged-preview resize handles write
  // the same value the `/meta` URL carries (WYSIWYG). 100 = historical bytes.
  const badgeScale = clampThumbnailBadgeScale(input.badgeScale ?? THUMBNAIL_BADGE_SCALE)
  // Always explicit: the switch must be observable in the preview (WYSIWYG).
  const source = sanitizeThumbnailVoteSource(input.voteSource)
  const params = [`bstyle=${style}`, `anchor=${anchor}`, `ox=${ox}`, `oy=${oy}`, `bscale=${badgeScale}`, `source=${source}`]
  // OFF is the default: no blur param at all (byte-identical plain still).
  if (input.blur) params.push("blur=1")
  // Preview-only sample banner: the settings editor shows the strip layout
  // when the toggle is ON. Real classifications travel only on `/meta` URLs,
  // so an unclassified title still renders without a banner everywhere else.
  if (input.sampleFiller === true) {
    // Explicit manga-canon sample (the historical `canon` code is an alias):
    // the same green chip, now on the canonical `:flmanga` cache entry.
    params.push("fill=manga")
    // Explicit layout (WYSIWYG): a staged `corner` must override a saved
    // `strip` space default, so the preview never relies on the fallback.
    params.push(`fillStyle=${sanitizeThumbnailFillerStyle(input.fillerStyle)}`)
    const flang = sanitizeFillerPreviewLang(input.fillerLang)
    if (flang) params.push(`flang=${flang}`)
  }
  return `${getDomain()}${base}&${params.join("&")}`
}
