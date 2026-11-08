"use client"

import { useCallback, useEffect, useState } from "react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { userFetch } from "@/lib/http"
import {
  buildEpisodeThumbnailUrl,
  episodeStillKey,
  sanitizeEpisodeStillPath,
} from "@/lib/episode-stills"
import {
  clampThumbnailBadgeOffset,
  clampThumbnailBadgeScale,
  sanitizeThumbnailBadgeAnchor,
  sanitizeThumbnailBadgeStyle,
  sanitizeThumbnailVoteSource,
} from "@/components/settings/thumbnail-preview"

/** Still row served by `/api/tmdb/[id]/season/[season]/episode/[episode]/images`. */
export interface TMDBEpisodeStill {
  file_path: string
  iso_639_1?: string | null
  width?: number
  height?: number
  vote_average?: number
  vote_count?: number
}

/**
 * Fetch the sanitized, deduplicated still list of one episode.
 *
 * Shared by the picker hook and the studio's grid fallback so both speak the
 * exact same endpoint and validation (one source, no parallel fetch logic).
 * Errors propagate: the hook surfaces them, the grid keeps its placeholder.
 */
export async function fetchEpisodeStills(
  seriesId: number,
  season: number,
  episode: number,
  tmdbKey?: string | null,
  signal?: AbortSignal,
): Promise<TMDBEpisodeStill[]> {
  if (!Number.isSafeInteger(seriesId) || seriesId <= 0) return []
  const params = new URLSearchParams({ type: "tv", languages: "en,null" })
  const res = await userFetch(
    `/api/tmdb/${seriesId}/season/${season}/episode/${episode}/images?${params.toString()}`,
    {
      headers: tmdbKey ? { "x-api-key": tmdbKey } : undefined,
      ...(signal ? { signal } : {}),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { stills?: unknown }
  const rows = Array.isArray(json?.stills) ? json.stills : []
  const seen = new Set<string>()
  const clean: TMDBEpisodeStill[] = []
  for (const row of rows as TMDBEpisodeStill[]) {
    const path = sanitizeEpisodeStillPath(row?.file_path)
    if (!path || seen.has(path)) continue
    seen.add(path)
    clean.push({ ...row, file_path: path })
  }
  return clean
}

export interface UseEpisodeStillsInput {
  readonly seriesId: number | null | undefined
  readonly season: number
  readonly episode: number
  /**
   * ORIGINAL TMDB S:E of this episode when the visible ordering is remapped
   * (Episode Groups). The stills endpoint only knows standard numbering, so the
   * fetch uses this pair; the override stays keyed by the visible
   * `season:episode` because that is the key `/meta` applies to the video.
   * Absent = the visible numbering is standard.
   */
  readonly stillSeason?: number
  readonly stillEpisode?: number
  readonly tmdbKey?: string | null
  /**
   * Still the raw episode currently uses (the video thumbnail path), shown as
   * the effective selection when the user has not overridden it.
   */
  readonly defaultStill?: string | null
  /** Fetch only while the picker is actually open. */
  readonly enabled?: boolean
  /**
   * Scoped user (multi-user namespace) forwarded as `u=` on the composed URL,
   * so the image request resolves the same server-side keys as the editor.
   */
  readonly user?: string | null
}

export interface UseEpisodeStillsResult {
  readonly stills: TMDBEpisodeStill[]
  readonly loading: boolean
  readonly error: string | null
  /** Effective still: saved override > episode default > first available. */
  readonly selected: string | null
  /** Compositor preview URL for `selected` (null when nothing is selected). */
  readonly previewUrl: string | null
  /** Persist a still override in the per-title mapping state. Invalid = no-op. */
  readonly select: (still: string) => void
}

/**
 * Fetch the full still list of one episode and expose the effective selection.
 *
 * The selection is stored in the editor's per-title mapping state
 * (`episodeThumbnailStills`, key `S:E`) so the normal Save persists it and
 * `/meta` can compose the chosen still when episode thumbnails are enabled.
 * Invalid paths are filtered before entering state: they can never be saved.
 *
 * The COMPOSED preview (not the saved still path) follows the space-wide
 * Miniature defaults (style/anchor/offsets/scale/vote source/blur): the mapping has
 * no per-title thumbnail field, so per-title is inheritance-only. The preview
 * therefore emits exactly the same params as `/meta`, and changing a global
 * choice immediately updates the title preview instead of a stale look.
 */
export function useEpisodeStills({
  seriesId,
  season,
  episode,
  stillSeason,
  stillEpisode,
  tmdbKey,
  defaultStill,
  enabled = true,
  user,
}: UseEpisodeStillsInput): UseEpisodeStillsResult {
  const ed = usePosterEditor()
  const [stills, setStills] = useState<TMDBEpisodeStill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = episodeStillKey(season, episode)
  // The endpoint only speaks standard TMDB numbering: a remapped row carries
  // the original pair, otherwise the visible S:E is already standard.
  const fetchSeason = stillSeason ?? season
  const fetchEpisode = stillEpisode ?? episode
  const override = sanitizeEpisodeStillPath(ed.episodeThumbnailStills?.[key])
  const fallback = sanitizeEpisodeStillPath(defaultStill)

  useEffect(() => {
    if (!enabled || !seriesId || seriesId <= 0) {
      setStills([])
      setLoading(false)
      setError(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    fetchEpisodeStills(seriesId, fetchSeason, fetchEpisode, tmdbKey)
      .then((clean) => {
        if (!active) return
        setStills(clean)
      })
      .catch((e) => {
        if (!active) return
        setStills([])
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [enabled, seriesId, fetchSeason, fetchEpisode, tmdbKey])

  const listHasFallback = fallback ? stills.some((s) => s.file_path === fallback) : false
  const selected = override ?? (listHasFallback ? fallback : stills[0]?.file_path ?? null)
  // The mapping has no per-title thumbnail field: the Miniature choices are
  // space-wide defaults. The picker therefore renders the EFFECTIVE defaults
  // (same sanitizers/params as `/meta`) so a changed style/anchor/source is
  // visible on that title immediately instead of a stale hardcoded look.
  const previewUrl = selected && seriesId
    ? buildEpisodeThumbnailUrl({
        seriesId,
        season,
        episode,
        still: selected,
        badgeStyle: sanitizeThumbnailBadgeStyle(ed.thumbnailBadgeStyle),
        anchor: sanitizeThumbnailBadgeAnchor(ed.thumbnailBadgeAnchor),
        offsetX: clampThumbnailBadgeOffset(ed.thumbnailBadgeOffsetX),
        offsetY: clampThumbnailBadgeOffset(ed.thumbnailBadgeOffsetY),
        badgeScale: clampThumbnailBadgeScale(ed.thumbnailBadgeScale),
        voteSource: sanitizeThumbnailVoteSource(ed.thumbnailVoteSource),
        blur: ed.thumbnailBlurEnabled === true,
        user: user ?? null,
      })
    : null

  const select = useCallback((still: string) => {
    const safe = sanitizeEpisodeStillPath(still)
    if (!safe) return
    ed.setEpisodeThumbnailStills((prev) => ({ ...(prev ?? {}), [key]: safe }))
  }, [ed, key])

  return { stills, loading, error, selected, previewUrl, select }
}
