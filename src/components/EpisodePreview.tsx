"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Film,
  Image as ImageIcon,
  ImageOff,
  Maximize2,
  X,
} from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { contentLanguageForUiLang } from "@/lib/regions"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { userFetch } from "@/lib/http"
import { useEpisodeStills, fetchEpisodeStills, type TMDBEpisodeStill } from "@/lib/useEpisodeStills"
import { buildEpisodeThumbnailUrl, episodeStillKey, EPISODE_FILLER_COLORS, sanitizeEpisodeFillerStatus, sanitizeEpisodeStillPath, type EpisodeFillerStatus } from "@/lib/episode-stills"
import {
  buildBulkFillerCorrectionIssue,
  buildFillerCorrectionIssueUrl,
  compressEpisodeNumbers,
  FILLER_CORRECTION_DIRECT_VIEWING,
  FILLER_CORRECTION_SOURCES,
  FILLER_CORRECTION_STATUS_LABELS,
  isFillerCorrectionPrototypeEnabled,
  MAX_BULK_CORRECTION_EPISODES,
  type FillerCorrectionSource,
} from "@/lib/filler-correction-issue"
import {
  clampThumbnailBadgeOffset,
  clampThumbnailBadgeScale,
  sanitizeThumbnailBadgeAnchor,
  sanitizeThumbnailBadgeStyle,
  sanitizeThumbnailVoteSource,
} from "@/components/settings/thumbnail-preview"
import { ThumbnailRotationSelector } from "@/components/settings/ThumbnailRotationSelector"
import { Modal } from "@/components/ui/Modal"

const STILL_THUMB_BASE = "https://image.tmdb.org/t/p/w185"

/**
 * Session cache + in-flight coalescing for the read-only filler lookups.
 *
 * The studio needs the classification of EVERY row it lists, so the endpoint is
 * called once per open regular season (`episodes=`) instead of once per S:E.
 * The promise itself is stored, so a second mount while the first is still in
 * flight joins it instead of firing a duplicate. Any failure resolves to an
 * empty map (no dots/banner): the editor never blocks and never fabricates a
 * classification.
 */
const fillerStatusRequests = new Map<string, Promise<Record<string, EpisodeFillerStatus | null>>>()

function fetchEpisodeFillerStatuses(input: {
  seriesId: number
  season: number
  episodes: number[]
  tmdbKey?: string | null
  user?: string | null
}): Promise<Record<string, EpisodeFillerStatus | null>> {
  const key = `${input.seriesId}:${input.season}:${input.episodes.join(",")}`
  const cached = fillerStatusRequests.get(key)
  if (cached) return cached

  const params = new URLSearchParams({
    tmdb: String(input.seriesId),
    season: String(input.season),
    episodes: input.episodes.join(","),
  })
  // Scoped user: the server resolves the SAME namespace keys the editor used
  // (BYOK), exactly like the composed image URLs.
  if (input.user) params.set("u", input.user)

  const request = userFetch(`/api/filler-status?${params.toString()}`, {
    headers: input.tmdbKey ? { "x-api-key": input.tmdbKey } : undefined,
  })
    .then(async (res) => {
      const out: Record<string, EpisodeFillerStatus | null> = {}
      if (!res.ok) return out
      const json = (await res.json()) as { statuses?: unknown }
      const raw = json?.statuses
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
      for (const [episode, value] of Object.entries(raw as Record<string, unknown>)) {
        out[episode] = sanitizeEpisodeFillerStatus(value)
      }
      return out
    })
    .catch(() => ({} as Record<string, EpisodeFillerStatus | null>))
  fillerStatusRequests.set(key, request)
  return request
}

/** i18n keys of the four classification labels (same text as the banner). */
const FILLER_STATUS_LABEL_KEYS: Record<EpisodeFillerStatus, string> = {
  manga: "ui.thumbnailFillerStatusManga",
  anime: "ui.thumbnailFillerStatusAnime",
  filler: "ui.thumbnailFillerStatusFiller",
  mixed: "ui.thumbnailFillerStatusMixed",
}

/** Still provider chosen in the right-pane tabs. */
type StillSource = "tmdb" | "tvdb"

/** One episode of the left pane, in the visible ordering. */
interface StudioEpisodeRow {
  key: string
  season: number
  episode: number
  /**
   * Original TMDB S:E when the visible ordering is remapped (Episode Groups):
   * stills are fetched with this pair, the override stays keyed by `key`.
   */
  stillSeason?: number
  stillEpisode?: number
  name: string
  defaultStill: string | null
  tvdbImage: string | null
}

/** Draft key of the shared bulk-correction fields (never a real S:E). */
const BULK_CORRECTION_DRAFT_KEY = "__bulk__"

/**
 * Draft choice for one episode. `tmdb` carries the explicit still path (the
 * only value `/meta` accepts as a per-episode override); `tvdb` records that
 * the user chose the TVDB cover, which `/meta` serves by NOT emitting a TMDB
 * override (the space metadata source decides the composed base).
 */
type StagedStill =
  | { provider: "tmdb"; still: string }
  | { provider: "tvdb" }

/** TMDB still path from a raw episode thumbnail URL (null for other hosts). */
function stillPathFromThumbnail(url?: string | null): string | null {
  return url?.match(/^https?:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/.+)$/)?.[1] ?? null
}

/**
 * TVDB episode cover from a raw thumbnail URL. TVDB publishes ONE image per
 * episode (no variant gallery), so the TVDB tab shows that single cover or an
 * honest empty state — never a fabricated list of variants.
 */
function tvdbCoverFromThumbnail(url?: string | null): string | null {
  return url && /^https?:\/\/artworks\.thetvdb\.com\/[^?#\s]+$/i.test(url) ? url : null
}

/** Raw still URL for a left-grid cell (no `/api/thumbnail`, no composed badge). */
function rawStillUrl(still?: string | null): string | null {
  return still ? `${STILL_THUMB_BASE}${still}` : null
}

/**
 * Raw still URL of a left-grid cell: the plain TMDB still, never the composed
 * `/api/thumbnail` request. The grid only lists/navigates episodes, so it must
 * not trigger one badge recomposition (and one compositor render) per cell;
 * the composed look stays in the center preview and in `/meta`, which share
 * the same request.
 *
 * Loading/error are per cell: a shimmer while the image loads, the Film
 * placeholder when the still is missing or cannot be loaded. The fallback
 * never throws and never blocks the rest of the list.
 */
function EpisodeRowThumbnail({ src }: { src: string | null }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading")
  useEffect(() => {
    setState("loading")
  }, [src])

  if (!src || state === "error") {
    return (
      <span className="w-full h-full flex items-center justify-center bg-white/[0.03]">
        <Film className="w-3 h-3 text-zinc-500" aria-hidden="true" />
      </span>
    )
  }

  return (
    <>
      {state === "loading" && (
        <span
          data-testid="episode-row-thumb-loading"
          aria-hidden="true"
          className="absolute inset-0 skeleton-shimmer"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="episode-row-thumb"
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className={`w-full h-full object-cover transition-opacity ${
          state === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  )
}

/**
 * Fullscreen "episode thumbnail studio" for one episode, opened from the single
 * entry button in the card: a three-pane workspace where the user stages still
 * overrides for MANY episodes and persists them together with a single save.
 *
 * - LEFT: seasons, each collapsible, with the episode list + small thumbs;
 * - CENTER: large composed `/api/thumbnail` preview of the selected episode
 *   with the current space Miniature defaults (same request `/meta` serves);
 * - RIGHT: TMDB | TVDB tabs. TMDB lists every still of the selected episode;
 *   TVDB shows the single TVDB cover (or an honest empty state). Clicking a
 *   tile STAGES the choice and its provider (no mapping write, no save);
 * - BOTTOM BAR: "Save thumbnails" writes all staged `S:E` overrides into the
 *   editor state and persists them with the THUMBNAIL-ONLY PATCH (only
 *   `episodeThumbnailStills`/`thumbnailRotation`; poster fields, poster `mv`
 *   and poster caches are never touched). A title with no mapping yet falls
 *   back to the full save, which is the only path that creates its record.
 *   "Cancel" clears the staged draft. Closing without saving discards the
 *   draft: the staged map lives only in this component and is never written to
 *   the mapping until the Save button runs.
 */
function EpisodeStillStudio({
  seriesId,
  season,
  episode,
  title,
  malId,
  tmdbKey,
  defaultStill,
  seasons,
  standardNumbering,
  readOnly = false,
  stills = "tmdb",
  onClose,
}: {
  seriesId: number
  season: number
  episode: number
  /** Visible series title, prefilled in the correction issue. */
  title: string
  /** MAL id when the loaded title carries one, else null. */
  malId?: number | null
  tmdbKey?: string | null
  defaultStill?: string | null
  seasons: PreviewSeason[]
  /** False = visible ordering is Parts/TVDB/AniZip. Stills use the original
   * TMDB S:E when the payload carries it (Parts/Episode Groups), otherwise the
   * standard S:E of the same visible numbers (TVDB/AniZip). */
  standardNumbering: boolean
  /**
   * Read-only studio (no tabs, no batch bar): kept for callers that only need
   * to preview the composed thumbnail. The default studio is editable for
   * both providers.
   */
  readOnly?: boolean
  /** Space base still provider (initial tab/selection and `stills` contract). */
  stills?: "tmdb" | "tvdb"
  onClose: () => void
}) {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const saveConfig = usePSelector((v) => v.saveConfig)
  // Thumbnail-only save (poster fields/`mv` untouched). Optional in the
  // context type: harnesses that only stub `saveConfig` keep the old path.
  const saveThumbnailSettings = usePSelector((v) => v.saveThumbnailSettings)
  // Scoped user (multi-user): the composed <img> URL cannot carry session
  // headers, so it must carry the namespace (`u=`) for the server-side TVDB /
  // IMDb-id key resolution to see the same keys the editor used.
  const userId = usePSelector((v) => v.currentUserId)
  const initialKey = episodeStillKey(season, episode)
  const [selectedKey, setSelectedKey] = useState(initialKey)
  // Draft choices for every touched episode (still path OR provider-only).
  // Never persisted until Save.
  const [staged, setStaged] = useState<Record<string, StagedStill>>({})
  // Right-pane source tab: TMDB variants first (historical default), TVDB is
  // the single-cover provider the space metadata source can serve.
  const [sourceTab, setSourceTab] = useState<StillSource>("tmdb")
  // Seasons are collapsible; the opening episode's season starts open.
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(() => new Set([season]))
  const [saveNonce, setSaveNonce] = useState(0)
  const [saving, setSaving] = useState(false)
  // Per-title daily rotation draft (null = inherit the space default). Saved
  // with the same batch Save as the still overrides, so the studio preview and
  // `/meta` stay WYSIWYG. `savedRotation` only advances on a successful save,
  // so a failed attempt keeps the Save button enabled for a retry.
  const [rotationDraft, setRotationDraft] = useState<boolean | null>(
    ed.thumbnailRotationOverride ?? null,
  )
  const [savedRotation, setSavedRotation] = useState<boolean | null>(
    ed.thumbnailRotationOverride ?? null,
  )
  const rotationChanged = rotationDraft !== savedRotation
  const pendingRotationRef = useRef<boolean | null>(null)
  // The save runs in an effect AFTER the editor state commit, so the saver
  // (rebuilt with the new `episodeThumbnailStills`) serializes the whole batch.
  const pendingSaveRef = useRef<Record<string, StagedStill> | null>(null)
  const saveConfigRef = useRef(saveConfig)
  useEffect(() => {
    saveConfigRef.current = saveConfig
  }, [saveConfig])
  const saveThumbnailSettingsRef = useRef(saveThumbnailSettings)
  useEffect(() => {
    saveThumbnailSettingsRef.current = saveThumbnailSettings
  }, [saveThumbnailSettings])

  // Flat episode index for the left pane. The opening episode wins for its own
  // default still (the caller already resolved it); every other row derives the
  // TMDB path from its own thumbnail and falls back to the picker's first still.
  const episodes = useMemo(() => {
    /** Single TVDB episode cover from the preview payload (or null). */
    const rows: StudioEpisodeRow[] = []
    const seen = new Set<string>()
    for (const s of seasons) {
      for (const ep of s.episodes) {
        const key = episodeStillKey(ep.season, ep.episode)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          key,
          season: ep.season,
          episode: ep.episode,
          stillSeason: ep.stillSeason,
          stillEpisode: ep.stillEpisode,
          name: ep.name,
          defaultStill:
            key === initialKey
              ? sanitizeEpisodeStillPath(defaultStill) ?? stillPathFromThumbnail(ep.thumbnail)
              : stillPathFromThumbnail(ep.thumbnail),
          tvdbImage: tvdbCoverFromThumbnail(ep.thumbnail),
        })
      }
    }
    if (!seen.has(initialKey)) {
      rows.unshift({
        key: initialKey,
        season,
        episode,
        name: "",
        defaultStill: sanitizeEpisodeStillPath(defaultStill),
        tvdbImage: null,
      })
    }
    return rows
  }, [seasons, initialKey, season, episode, defaultStill])

  /**
   * True when EVERY visible row carries the ORIGINAL TMDB S:E (Episode Groups):
   * stills are fetched with that pair, so the numbering caveat no longer
   * applies. TVDB/AniZip rows have no such pair, and a partial group payload
   * keeps the honest caveat.
   */
  const stillNumberingKnown = useMemo(
    () =>
      episodes.length > 0 &&
      episodes.every((row) => typeof row.stillSeason === "number" && typeof row.stillEpisode === "number"),
    [episodes],
  )

  /**
   * Filler classification is keyed by ABSOLUTE episode. It is resolvable with
   * standard TMDB numbering, or with a remapped ordering that carries the
   * ORIGINAL TMDB S:E (Episode Groups): the lookup then uses that pair, never
   * the visible one. TVDB/AniZip expose no such pair and stay suppressed.
   */
  const fillerNumberingKnown = standardNumbering || stillNumberingKnown

  // Default still per S:E (opening episode's caller-resolved still, every other
  // row from its own TMDB thumbnail): the grid preview composes THAT base
  // without an extra fetch per episode.
  const defaultStillByKey = useMemo(
    () => new Map(episodes.map((row) => [row.key, row.defaultStill])),
    [episodes],
  )
  // Single TVDB cover per S:E (never a variant list: TVDB exposes one episode
  // image). Used by the grid cell and by the TVDB tab.
  const tvdbImageByKey = useMemo(
    () => new Map(episodes.map((row) => [row.key, row.tvdbImage])),
    [episodes],
  )

  /**
   * First-still fallback for the left grid.
   *
   * An episode whose preview payload carries no TMDB thumbnail (or a non-TMDB
   * cover) used to stay a placeholder icon until the user selected it. Every
   * OPEN season now resolves the first still of its S:E rows through the SAME
   * images endpoint the picker uses, and the composed cell renders immediately.
   *
   * Lazy and bounded: only rows of expanded seasons are fetched, once per S:E
   * and serially; a saved/staged/default still always wins (no request at all),
   * and a failed lookup keeps the honest placeholder without blocking the rest.
   */
  const [gridFallbackStills, setGridFallbackStills] = useState<Record<string, string>>({})
  const gridFallbackAttempted = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    if (seriesId <= 0) return
    const targets: {
      key: string
      season: number
      episode: number
      stillSeason?: number
      stillEpisode?: number
    }[] = []
    for (const row of episodes) {
      if (!openSeasons.has(row.season)) continue
      if (gridFallbackAttempted.current.has(row.key)) continue
      const stagedEntry = staged[row.key]
      const known =
        (stagedEntry?.provider === "tmdb" ? sanitizeEpisodeStillPath(stagedEntry.still) : null) ??
        sanitizeEpisodeStillPath(ed.episodeThumbnailStills?.[row.key]) ??
        row.defaultStill ??
        // A TVDB-only choice has its own raw cover: no TMDB fallback lookup.
        (stagedEntry?.provider === "tvdb" ? row.tvdbImage : null)
      if (known) continue
      targets.push({
        key: row.key,
        season: row.season,
        episode: row.episode,
        stillSeason: row.stillSeason,
        stillEpisode: row.stillEpisode,
      })
    }
    if (targets.length === 0) return
    // Mark BEFORE fetching so a re-render (or another expanded season) never
    // queues the same S:E twice.
    for (const target of targets) gridFallbackAttempted.current.add(target.key)
    void (async () => {
      for (const target of targets) {
        try {
          const rows = await fetchEpisodeStills(
            seriesId,
            target.stillSeason ?? target.season,
            target.stillEpisode ?? target.episode,
            tmdbKey,
          )
          const first = rows[0]?.file_path
          if (!first || !mountedRef.current) continue
          setGridFallbackStills((prev) =>
            prev[target.key] ? prev : { ...prev, [target.key]: first },
          )
        } catch {
          // Honest placeholder stays; the rest of the grid is unaffected.
        }
      }
    })()
  }, [episodes, openSeasons, staged, ed.episodeThumbnailStills, seriesId, tmdbKey])

  const current = useMemo(
    () =>
      episodes.find((row) => row.key === selectedKey) ?? {
        key: selectedKey,
        season,
        episode,
        name: "",
        defaultStill: sanitizeEpisodeStillPath(defaultStill),
        tvdbImage: null,
      },
    [episodes, selectedKey, season, episode, defaultStill],
  )

  // One hook call owns the selected episode's still list. The studio only
  // mounts while open, so its fetch is naturally lazy.
  // Its `select` is intentionally NOT used here: the studio stages the draft
  // and only the batch save writes the mapping.
  const stillsState = useEpisodeStills({
    seriesId,
    season: current.season,
    episode: current.episode,
    stillSeason: current.stillSeason,
    stillEpisode: current.stillEpisode,
    tmdbKey,
    defaultStill: current.defaultStill,
    user: userId,
  })

  /**
   * Real anime filler classification for the studio's episode list (never a
   * sample). Fetched from the read-only `/api/filler-status` endpoint only when
   * the space toggle is ON and the visible ordering is standard TMDB: `/meta`
   * suppresses the banner for remapped orderings (Episode Groups / TVDB /
   * AniZip), so asking there would label the wrong episode's absolute number.
   *
   * One BATCH request per open regular season covers every row (the endpoint
   * resolves them against the bundled snapshot), so each episode can show its
   * colored dot and the selected one its composed banner. Results are stored per
   * `S:E`: switching episodes can never show the previous episode's status while
   * the new lookup is in flight. Unknown or failed lookups stay absent
   * (fail-open to no dot/banner).
   */
  const [fillerStatusByKey, setFillerStatusByKey] = useState<Record<string, EpisodeFillerStatus>>({})
  // Keys whose lookup actually COMPLETED (success or null). Lets the studio tell
  // "still loading" apart from "not classified", so an unknown title gets an
  // honest note instead of silently rendering no banner.
  const [fillerResolvedByKey, setFillerResolvedByKey] = useState<Record<string, true>>({})
  const fillerBadgeEnabled = ed.defaultThumbnailFillerBadge === true
  useEffect(() => {
    if (!fillerBadgeEnabled || !fillerNumberingKnown || seriesId <= 0) return
    // Visible S:E -> the ORIGINAL TMDB S:E used for the absolute-episode
    // lookup. Standard ordering uses its own S:E; an Episode Group uses the
    // original pair carried by the payload. Rows without a resolvable pair are
    // skipped (never a guessed label).
    const bySourceSeason = new Map<number, { key: string; sourceEpisode: number }[]>()
    for (const entry of seasons) {
      if (entry.season <= 0 || !openSeasons.has(entry.season)) continue
      for (const ep of entry.episodes) {
        if (ep.season !== entry.season || ep.episode <= 0) continue
        const sourceSeason = standardNumbering ? ep.season : ep.stillSeason
        const sourceEpisode = standardNumbering ? ep.episode : ep.stillEpisode
        if (
          sourceSeason === undefined ||
          sourceSeason <= 0 ||
          sourceEpisode === undefined ||
          sourceEpisode <= 0
        ) {
          continue
        }
        const row = { key: episodeStillKey(ep.season, ep.episode), sourceEpisode }
        const list = bySourceSeason.get(sourceSeason)
        if (list) list.push(row)
        else bySourceSeason.set(sourceSeason, [row])
      }
    }
    if (bySourceSeason.size === 0) return
    let active = true
    for (const [sourceSeason, rows] of bySourceSeason) {
      const sourceEpisodes = [...new Set(rows.map((row) => row.sourceEpisode))]
      // The helper stores the in-flight promise per season list, so re-runs
      // (StrictMode double-invoke, expand/collapse) join it instead of firing a
      // duplicate request. Never keep a ref that makes the second run skip:
      // the first run's cleanup would then cancel the only live subscriber and
      // the banner/dots would never appear in development.
      void fetchEpisodeFillerStatuses({
        seriesId,
        season: sourceSeason,
        episodes: sourceEpisodes,
        tmdbKey,
        user: userId,
      }).then((statuses) => {
        if (!active) return
        const resolvedKeys = rows.map((row) => row.key)
        setFillerResolvedByKey((prev) => {
          let changed = false
          const next = { ...prev }
          for (const key of resolvedKeys) {
            if (next[key] !== true) {
              next[key] = true
              changed = true
            }
          }
          return changed ? next : prev
        })
        setFillerStatusByKey((prev) => {
          let next = prev
          for (const row of rows) {
            const status = statuses[String(row.sourceEpisode)]
            if (!status) continue
            if (next[row.key] === status) continue
            if (next === prev) next = { ...prev }
            next[row.key] = status
          }
          return next
        })
      })
    }
    return () => {
      active = false
    }
  }, [fillerBadgeEnabled, fillerNumberingKnown, standardNumbering, seriesId, seasons, openSeasons, tmdbKey, userId])
  const fillerStatus =
    fillerBadgeEnabled && fillerNumberingKnown ? fillerStatusByKey[current.key] ?? null : null
  /** Lookup finished with no classification: honest note, never a fake banner. */
  const fillerUnavailable =
    fillerBadgeEnabled &&
    fillerNumberingKnown &&
    fillerResolvedByKey[current.key] === true &&
    fillerStatus === null

  /**
   * "Suggest filler correction" panel (opt-in: hidden by default; the build
   * must set `NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1` to show it).
   *
   * The link only PREFILLS a public GitHub issue: the user reviews and submits
   * with their own account. No token, no fetch, no issue created by Pictorium.
   * The in-app origin is logically direct viewing (the user is looking at the
   * episode), so the attestation starts checked; unchecking it requires a
   * clean source, fail-closed.
   *
   * Per-episode drafts: navigating the left pane can never carry a proposal
   * (or an unchecked attestation) from another S:E.
   *
   * Bulk mode: checking episode rows switches the panel to a multi-episode
   * selection (S:E keys). One type applies to the selection, per-row
   * dropdowns override it, and the panel prefills compressed ranges, titles
   * and one shared reason/attestation. Clearing the selection returns to the
   * historical single-episode mode, where the current episode is the target.
   */
  const correctionEnabled = isFillerCorrectionPrototypeEnabled()
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [proposalDraft, setProposalDraft] = useState<Record<string, EpisodeFillerStatus | "">>({})
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})
  const [watchedDraft, setWatchedDraft] = useState<Record<string, boolean>>({})
  const [sourceDraft, setSourceDraft] = useState<Record<string, FillerCorrectionSource | "">>({})
  const [sourceNotesDraft, setSourceNotesDraft] = useState<Record<string, string>>({})
  // Bulk correction: checkbox selection of S:E keys. Empty = the historical
  // single-episode mode, where the current episode is the implicit target.
  const [selectedCorrectionKeys, setSelectedCorrectionKeys] = useState<Set<string>>(
    () => new Set(),
  )
  // Optional per-episode overrides; blank = follow the bulk type.
  const [perEpisodeTypeDraft, setPerEpisodeTypeDraft] = useState<
    Record<string, EpisodeFillerStatus | "">
  >({})
  const [continuationDraft, setContinuationDraft] = useState("")
  const selectionEnabled = correctionEnabled && fillerBadgeEnabled && standardNumbering
  const bulkMode = selectedCorrectionKeys.size > 0
  // Single and bulk drafts never share fields: switching modes can never leak
  // an unchecked attestation (or a type) from one target to the other.
  const correctionDraftKey = bulkMode ? BULK_CORRECTION_DRAFT_KEY : current.key
  const proposedStatus =
    proposalDraft[correctionDraftKey] ?? (bulkMode ? "" : fillerStatus ?? "")
  const correctionReason = reasonDraft[correctionDraftKey] ?? ""
  const correctionWatched = watchedDraft[correctionDraftKey] ?? true
  const correctionSource = sourceDraft[correctionDraftKey] ?? ""
  const correctionSourceNotes = sourceNotesDraft[correctionDraftKey] ?? ""
  const updateProposal = useCallback(
    (value: EpisodeFillerStatus | "") => {
      setProposalDraft((prev) => ({ ...prev, [correctionDraftKey]: value }))
    },
    [correctionDraftKey],
  )
  const updateReason = useCallback(
    (value: string) => {
      setReasonDraft((prev) => ({ ...prev, [correctionDraftKey]: value }))
    },
    [correctionDraftKey],
  )
  const updateWatched = useCallback(
    (value: boolean) => {
      setWatchedDraft((prev) => ({ ...prev, [correctionDraftKey]: value }))
    },
    [correctionDraftKey],
  )
  const updateSource = useCallback(
    (value: FillerCorrectionSource | "") => {
      setSourceDraft((prev) => ({ ...prev, [correctionDraftKey]: value }))
    },
    [correctionDraftKey],
  )
  const updateSourceNotes = useCallback(
    (value: string) => {
      setSourceNotesDraft((prev) => ({ ...prev, [correctionDraftKey]: value }))
    },
    [correctionDraftKey],
  )
  const updateRowType = useCallback((key: string, value: EpisodeFillerStatus | "") => {
    setPerEpisodeTypeDraft((prev) => {
      if (value === "") {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }, [])
  const toggleCorrectionSelection = useCallback((key: string) => {
    setSelectedCorrectionKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const clearCorrectionSelection = useCallback(() => {
    setSelectedCorrectionKeys(new Set())
  }, [])
  // "Visible" = rows of the currently expanded seasons, the only ones the
  // user can see and therefore the only ones bulk-select can pick.
  const selectAllVisibleCorrections = useCallback(() => {
    setSelectedCorrectionKeys((prev) => {
      const next = new Set(prev)
      for (const row of episodes) {
        if (row.season > 0 && openSeasons.has(row.season)) next.add(row.key)
      }
      return next
    })
  }, [episodes, openSeasons])
  /** Regular seasons only: `N` of the issue form excludes specials/season 0. */
  const regularEpisodeTotal = useMemo(
    () => seasons.reduce((sum, s) => (s.season > 0 ? sum + s.episodes.length : sum), 0),
    [seasons],
  )
  /** Absolute episode from the visible standard ordering (null when remapped). */
  const absoluteEpisode = useMemo(() => {
    if (!standardNumbering || current.season <= 0 || current.episode <= 0) return null
    let before = 0
    for (const s of seasons) {
      if (s.season > 0 && s.season < current.season) before += s.episodes.length
    }
    return before + current.episode
  }, [standardNumbering, seasons, current.season, current.episode])
  /**
   * Absolute episode of EVERY visible row (same regular-season offsets as the
   * single flow). Bulk ranges are absolute; specials are excluded upstream.
   */
  const absoluteEpisodeByKey = useMemo(() => {
    const map = new Map<string, number>()
    if (!standardNumbering) return map
    for (const season of seasons) {
      if (season.season <= 0) continue
      let before = 0
      for (const other of seasons) {
        if (other.season > 0 && other.season < season.season) {
          before += other.episodes.length
        }
      }
      for (const episode of season.episodes) {
        map.set(episodeStillKey(episode.season, episode.episode), before + episode.episode)
      }
    }
    return map
  }, [standardNumbering, seasons])
  const correctionRowsByKey = useMemo(
    () => new Map(episodes.map((row) => [row.key, row] as const)),
    [episodes],
  )
  const selectedCorrectionRows = useMemo(
    () =>
      [...selectedCorrectionKeys]
        .map((key) => correctionRowsByKey.get(key))
        .filter((row): row is StudioEpisodeRow => row !== undefined && row.season > 0)
        .sort((a, b) => a.season - b.season || a.episode - b.episode),
    [selectedCorrectionKeys, correctionRowsByKey],
  )
  /** Live range preview, independent from the validity of the other fields. */
  const bulkRangePreview = useMemo(() => {
    const filler: number[] = []
    const mixed: number[] = []
    for (const row of selectedCorrectionRows) {
      const type = perEpisodeTypeDraft[row.key] || proposedStatus
      // Same fallback as the builder (absolute unknown -> local episode).
      const absolute = absoluteEpisodeByKey.get(row.key) ?? row.episode
      if (!type) continue
      if (type === "filler") filler.push(absolute)
      else if (type === "mixed") mixed.push(absolute)
    }
    return {
      filler: compressEpisodeNumbers(filler),
      mixed: compressEpisodeNumbers(mixed),
    }
  }, [selectedCorrectionRows, perEpisodeTypeDraft, proposedStatus, absoluteEpisodeByKey])
  const bulkCorrection = useMemo(() => {
    if (!selectionEnabled || selectedCorrectionRows.length === 0) return null
    const continuedFrom = /^\d+$/.test(continuationDraft.trim())
      ? Number(continuationDraft.trim())
      : null
    return buildBulkFillerCorrectionIssue({
      title,
      tmdbId: seriesId,
      malId,
      totalEpisodes: regularEpisodeTotal > 0 ? regularEpisodeTotal : null,
      episodes: selectedCorrectionRows.map((row) => ({
        season: row.season,
        episode: row.episode,
        absoluteEpisode: absoluteEpisodeByKey.get(row.key) ?? null,
        title: row.name,
        proposedStatus: perEpisodeTypeDraft[row.key] || proposedStatus,
      })),
      reason: correctionReason,
      watched: correctionWatched,
      source: correctionSource === "" ? null : correctionSource,
      sourceNotes: correctionWatched ? null : correctionSourceNotes,
      continuedFrom,
    })
  }, [
    selectionEnabled,
    selectedCorrectionRows,
    continuationDraft,
    title,
    seriesId,
    malId,
    regularEpisodeTotal,
    absoluteEpisodeByKey,
    perEpisodeTypeDraft,
    proposedStatus,
    correctionReason,
    correctionWatched,
    correctionSource,
    correctionSourceNotes,
  ])
  const correctionUrl = useMemo(() => {
    if (!correctionEnabled || !fillerBadgeEnabled || !standardNumbering) return null
    if (bulkMode) return bulkCorrection?.ok ? bulkCorrection.url : null
    // Season 0/specials are outside the public regular-season absolute
    // numbering: never propose a correction that would mislabel episode 1.
    if (current.season <= 0) return null
    return buildFillerCorrectionIssueUrl({
      title,
      tmdbId: seriesId,
      malId,
      season: current.season,
      episode: current.episode,
      absoluteEpisode,
      totalEpisodes: regularEpisodeTotal > 0 ? regularEpisodeTotal : null,
      currentStatus: fillerStatus,
      proposedStatus: proposedStatus === "" ? null : proposedStatus,
      reason: correctionReason,
      watched: correctionWatched,
      source: correctionSource === "" ? null : correctionSource,
      sourceNotes: correctionWatched ? null : correctionSourceNotes,
    })
  }, [
    correctionEnabled,
    fillerBadgeEnabled,
    standardNumbering,
    bulkMode,
    bulkCorrection,
    title,
    seriesId,
    malId,
    current.season,
    current.episode,
    absoluteEpisode,
    regularEpisodeTotal,
    fillerStatus,
    proposedStatus,
    correctionReason,
    correctionWatched,
    correctionSource,
    correctionSourceNotes,
  ])
  const openCorrectionIssue = useCallback(() => {
    if (!correctionUrl) return
    // User submits; Pictorium never authenticates to GitHub.
    window.open(correctionUrl, "_blank", "noopener,noreferrer")
  }, [correctionUrl])

  // Effective provider for the selected S:E, same precedence as `/meta`:
  // staged choice > saved TMDB override (always TMDB by contract) > the space
  // provider passed by the caller (`?stills=` note). The TVDB choice is
  // recorded by NOT emitting a TMDB override: /meta then serves the space's
  // TVDB base, which is the only provider the current /meta contract resolves
  // per title.
  const stagedEntry = staged[selectedKey]
  const stagedTmdbStill =
    stagedEntry?.provider === "tmdb" ? sanitizeEpisodeStillPath(stagedEntry.still) : null
  const savedOverride = sanitizeEpisodeStillPath(ed.episodeThumbnailStills?.[selectedKey])
  const effectiveProvider: StillSource =
    stagedEntry?.provider ?? (savedOverride ? "tmdb" : stills)
  // TMDB still used as the base (provider TMDB) or as the required fail-open
  // fallback of the compositor (provider TVDB). A TVDB choice never reuses the
  // saved TMDB override as its fallback: `/meta` would not either after save.
  const tmdbFallbackStill =
    current.defaultStill ?? stillsState.stills[0]?.file_path ?? null
  const effectiveStill: string | null =
    effectiveProvider === "tmdb"
      ? stagedTmdbStill ?? savedOverride ?? stillsState.selected
      : tmdbFallbackStill
  /**
   * ONE composed `/api/thumbnail` request for the CENTER preview, with the same
   * effective Miniature choices as `/meta`. Left-grid cells intentionally use
   * the raw still (`rawStillUrl`): navigating the list must never recompose a
   * badge per episode.
   */
  const composeThumbnailUrl = (
    // Visible S:E: only the per-episode filler guard below is keyed by it.
    seasonNumber: number,
    episodeNumber: number,
    still: string | null,
    provider: StillSource,
    // ORIGINAL TMDB S:E for the compositor path (Episode Groups remap the
    // visible pair, and the route resolves vote/details with it: a visible
    // group pair that does not exist on TMDB fails closed with a 502).
    sourceSeason: number = seasonNumber,
    sourceEpisode: number = episodeNumber,
  ): string | null => {
    if (!still || seriesId <= 0) return null
    const base = buildEpisodeThumbnailUrl({
      seriesId,
      season: sourceSeason,
      episode: sourceEpisode,
      still,
      badgeStyle: sanitizeThumbnailBadgeStyle(ed.thumbnailBadgeStyle),
      anchor: sanitizeThumbnailBadgeAnchor(ed.thumbnailBadgeAnchor),
      offsetX: clampThumbnailBadgeOffset(ed.thumbnailBadgeOffsetX),
      offsetY: clampThumbnailBadgeOffset(ed.thumbnailBadgeOffsetY),
      badgeScale: clampThumbnailBadgeScale(ed.thumbnailBadgeScale),
      voteSource: sanitizeThumbnailVoteSource(ed.thumbnailVoteSource),
      blur: ed.thumbnailBlurEnabled === true,
      // Effective rotation: per-title draft (explicit) wins on the space
      // default, exactly like `/meta`.
      rotation: rotationDraft ?? ed.defaultThumbnailRotation,
      // Real classification only (null = no banner). The per-episode guard
      // keeps the banner on the episode it was resolved for.
      filler:
        seasonNumber === current.season && episodeNumber === current.episode
          ? fillerStatus
          : null,
      fillerStyle: ed.defaultThumbnailFillerStyle,
      fillerLang: lang,
      user: userId,
    })
    if (!base) return null
    return provider === "tvdb" ? `${base}&stills=tvdb` : base
  }
  const previewUrl = composeThumbnailUrl(
    current.season,
    current.episode,
    effectiveStill,
    effectiveProvider,
    current.stillSeason ?? current.season,
    current.stillEpisode ?? current.episode,
  )

  const stagedCount = Object.keys(staged).length

  // Closing without saving discards the draft: staged choices only exist in
  // this component and are never written to the mapping before Save.
  const close = useCallback(() => {
    setStaged({})
    onClose()
  }, [onClose])

  const toggleSeason = useCallback((value: number) => {
    setOpenSeasons((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }, [])

  const stageStill = useCallback((still: string) => {
    const safe = sanitizeEpisodeStillPath(still)
    if (!safe) return
    setStaged((prev) => ({ ...prev, [selectedKey]: { provider: "tmdb", still: safe } }))
  }, [selectedKey])

  // TVDB choice: records the provider and removes any TMDB override for this
  // S:E at save, so `/meta` serves the space TVDB base (the only per-episode
  // provider the current contract resolves). No fabricated still path.
  const stageTvdb = useCallback(() => {
    setStaged((prev) => ({ ...prev, [selectedKey]: { provider: "tvdb" } }))
  }, [selectedKey])

  // Save-all: commit every staged S:E into the editor's per-title mapping
  // state, then run ONE normal save. A `false` result keeps the draft so the
  // user can retry; success clears it.
  const handleSaveAll = useCallback(() => {
    if (Object.keys(staged).length === 0 && !rotationChanged) return
    const next = { ...(ed.episodeThumbnailStills ?? {}) }
    for (const [key, entry] of Object.entries(staged)) {
      if (entry.provider === "tvdb") {
        // Provider record for /meta: TVDB means "no TMDB override".
        delete next[key]
        continue
      }
      const safe = sanitizeEpisodeStillPath(entry.still)
      if (safe) next[key] = safe
    }
    ed.setEpisodeThumbnailStills(next)
    // Per-title rotation override rides the same save: explicit on/off, or
    // null to hand control back to the space default.
    ed.setThumbnailRotationOverride(rotationDraft)
    pendingRotationRef.current = rotationDraft
    pendingSaveRef.current = staged
    setSaveNonce((nonce) => nonce + 1)
  }, [ed, staged, rotationDraft, rotationChanged])

  // Reset-all: clear the staged draft AND every saved S:E override of this
  // title, then run ONE normal save (same serialization path as the batch
  // save). It restores the EPISODE IMAGES, never the space Miniature visual
  // choices: style/anchor/offset/scale/blur/source stay exactly as configured.
  // The confirm avoids destroying a curated mapping with one misclick.
  const handleResetAll = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm(t("ui.episodeStillResetConfirm"))) return
    setStaged({})
    ed.setEpisodeThumbnailStills({})
    pendingSaveRef.current = {}
    setSaveNonce((nonce) => nonce + 1)
  }, [ed, t])

  useEffect(() => {
    if (saveNonce === 0) return
    const pending = pendingSaveRef.current
    if (!pending) return
    pendingSaveRef.current = null
    let active = true
    setSaving(true)
    // Thumbnail-only save: ONLY `episodeThumbnailStills` + the rotation choice
    // are written, so poster fields/`mv`/caches stay untouched. The full save
    // remains the fallback for harnesses without the saver and for a title
    // with no mapping yet (the PATCH saver delegates internally).
    const thumbnailSaver = saveThumbnailSettingsRef.current
    Promise.resolve(
      thumbnailSaver
        ? thumbnailSaver({
          episodeThumbnailStills: ed.episodeThumbnailStills,
          thumbnailRotation: pendingRotationRef.current,
        })
        : saveConfigRef.current(),
    )
      .then((ok) => {
        if (!active) return
        if (ok !== false) setStaged({})
        // Only a successful save advances the baseline (failed attempts stay
        // retryable: the Save button keeps seeing a pending rotation change).
        if (ok !== false) setSavedRotation(pendingRotationRef.current)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSaving(false)
      })
    return () => {
      active = false
    }
  }, [saveNonce]) // eslint-disable-line react-hooks/exhaustive-deps -- one batch save per nonce; `ed` is read post-commit (the new stills are already in the render that flips the nonce)

  return (
    <Modal
      isOpen
      onClose={close}
      testId="episode-browser-dialog"
      labelledBy="episode-browser-title"
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-black/85 backdrop-blur-md animate-fade-in"
      className="max-w-none w-[min(98vw,1800px)] h-[min(94vh,1100px)] flex flex-col overflow-hidden"
    >
        <div className="flex items-center justify-between gap-3 shrink-0 border-b border-white/10 pb-2.5">
          <h3 id="episode-browser-title" className="text-sm sm:text-base font-bold tracking-tight text-zinc-50 inline-flex items-center gap-1.5 min-w-0">
            <ImageIcon className="w-4 h-4 shrink-0 text-accent-orange" aria-hidden="true" />
            <span className="truncate">
              {t("ui.episodeThumbnails")} · {t("ui.episodeStillPickerTitle")} · S{current.season}:E{current.episode}
            </span>
          </h3>
          <button
            type="button"
            onClick={close}
            aria-label={t("ui.close")}
            title={t("ui.close")}
            className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {!standardNumbering && !stillNumberingKnown && (
          // Honest caveat only where it still applies: TVDB/AniZip orderings
          // expose no original TMDB S:E, so their stills resolve by the standard
          // numbering of the same visible numbers. Episode Groups carry the
          // original pair (stillSeason/stillEpisode), so their stills ARE the
          // right episode's and the note is hidden.
          <p
            data-testid="episode-studio-numbering-note"
            className="shrink-0 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span>{t("ui.thumbnailNumberingNote")}</span>
          </p>
        )}

        <div
          data-testid="episode-browser-panes"
          data-readonly={readOnly ? "1" : undefined}
          className={`grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto xl:overflow-hidden ${
            readOnly ? "xl:grid-cols-[260px_minmax(640px,1fr)]" : "xl:grid-cols-[260px_minmax(640px,1fr)_320px]"
          }`}
        >
          {/* LEFT — collapsible seasons, every episode with its current still. */}
          <aside
            data-testid="episode-browser-seasons"
            className="min-w-0 min-h-0 rounded-xl border border-white/10 bg-black/25 p-2 overflow-y-auto space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5 border-b border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1 min-w-0">
                <Film className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("ui.seasons")}</span>
              </span>
              <span className="shrink-0 text-[10px] font-mono tabular-nums text-zinc-500">
                {seasons.length}
              </span>
            </div>
            {selectionEnabled && episodes.length > 0 && (
              <div
                data-testid="episode-bulk-selection"
                className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5 border-b border-white/[0.06]"
              >
                <button
                  type="button"
                  data-testid="episode-select-all-visible"
                  onClick={selectAllVisibleCorrections}
                  className="min-h-[26px] px-2 rounded-md border border-white/10 bg-white/5 text-[10px] font-semibold text-zinc-300 hover:bg-white/10 transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  Select all visible
                </button>
                <button
                  type="button"
                  data-testid="episode-select-clear"
                  disabled={selectedCorrectionKeys.size === 0}
                  onClick={clearCorrectionSelection}
                  className="min-h-[26px] px-2 rounded-md border border-white/10 bg-white/5 text-[10px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  Clear
                </button>
                <span
                  data-testid="episode-select-count"
                  className="ml-auto text-[10px] font-mono tabular-nums text-zinc-500"
                >
                  {selectedCorrectionKeys.size} selected
                </span>
              </div>
            )}
            {episodes.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic px-1 py-2">{t("ui.noEpisodes")}</p>
            ) : (
              seasons.map((s) => {
                const open = openSeasons.has(s.season)
                return (
                  <div key={s.season} data-testid="episode-browser-season-group" className="rounded-lg overflow-hidden">
                    <button
                      type="button"
                      data-testid="episode-browser-season"
                      aria-expanded={open}
                      onClick={() => toggleSeason(s.season)}
                      className="w-full min-h-[32px] flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-left hover:bg-white/[0.06] transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      {open ? (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-200">
                        {s.season === 0 ? "Specials" : s.name}
                        <span className="ml-1 font-normal text-zinc-500">S{s.season}</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-mono tabular-nums text-zinc-500">{s.episodes.length}</span>
                    </button>

                    {open && (
                      <div data-testid="episode-browser-season-episodes" className="space-y-0.5 pb-1">
                        {s.episodes.map((ep) => {
                          const key = episodeStillKey(ep.season, ep.episode)
                          const active = key === selectedKey
                          // Known classification of THIS row. Groups are
                          // resolved through their original TMDB S:E, so the
                          // dots follow the banner instead of disappearing.
                          const rowFillerStatus =
                            fillerBadgeEnabled && fillerNumberingKnown
                              ? fillerStatusByKey[key] ?? null
                              : null
                          const stagedEntry = staged[key]
                          const stagedTmdb =
                            stagedEntry?.provider === "tmdb"
                              ? sanitizeEpisodeStillPath(stagedEntry.still)
                              : null
                          const savedOverride = sanitizeEpisodeStillPath(ed.episodeThumbnailStills?.[key])
                          const thumbStill =
                            stagedTmdb ??
                            savedOverride ??
                            defaultStillByKey.get(key) ??
                            gridFallbackStills[key] ??
                            null
                          // A TVDB choice shows the single TVDB cover (raw, no
                          // composed badge) instead of a TMDB still it never
                          // chose; missing cover = honest TMDB fallback cell.
                          const thumbUrl =
                            stagedEntry?.provider === "tvdb"
                              ? tvdbImageByKey.get(key) ?? rawStillUrl(thumbStill)
                              : rawStillUrl(thumbStill)
                          return (
                            <div key={ep.id} className="flex items-center gap-1.5">
                              {selectionEnabled && ep.season > 0 && (
                                <input
                                  type="checkbox"
                                  data-testid="episode-browser-select"
                                  data-episode-key={key}
                                  aria-label={`Select S${ep.season}:E${ep.episode} for a bulk correction`}
                                  checked={selectedCorrectionKeys.has(key)}
                                  onChange={() => toggleCorrectionSelection(key)}
                                  className="w-3.5 h-3.5 shrink-0 accent-accent-orange cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                />
                              )}
                              <button
                                type="button"
                                data-testid="episode-browser-episode"
                                aria-pressed={active}
                                onClick={() => setSelectedKey(key)}
                                className={`min-w-0 flex-1 min-h-[40px] flex items-center gap-2 px-1.5 py-1.5 rounded-lg border text-left transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                                  active
                                    ? "border-accent-orange/70 bg-accent-orange/15"
                                    : "border-transparent hover:bg-white/[0.06]"
                                }`}
                              >
                                <span className="relative block w-14 h-8 shrink-0 overflow-hidden rounded-md bg-zinc-800 border border-white/10">
                                  <EpisodeRowThumbnail src={thumbUrl} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[11px] font-medium text-zinc-100 truncate">{ep.name}</span>
                                  <span className="block text-[10px] font-mono tabular-nums text-zinc-500">
                                    S{ep.season}:E{ep.episode}
                                    {rowFillerStatus && (
                                      <span
                                        data-testid="episode-filler-dot"
                                        data-status={rowFillerStatus}
                                        role="img"
                                        aria-label={t(FILLER_STATUS_LABEL_KEYS[rowFillerStatus])}
                                        title={t(FILLER_STATUS_LABEL_KEYS[rowFillerStatus])}
                                        className="ml-1.5 inline-block w-2 h-2 rounded-full align-middle ring-1 ring-black/40"
                                        style={{ backgroundColor: EPISODE_FILLER_COLORS[rowFillerStatus] }}
                                      />
                                    )}
                                    {stagedEntry && (
                                      <span
                                        data-testid="episode-stage-dot"
                                        data-provider={stagedEntry.provider}
                                        className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent-orange align-middle"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </span>
                                </span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </aside>

          {/* CENTER — large composed thumbnail of the selected episode. */}
          <section
            data-testid="episode-browser-preview"
            className="min-w-0 min-h-0 rounded-xl border border-white/10 bg-black/25 p-3 flex flex-col gap-2.5"
          >
            <div className="flex items-center justify-between gap-2 shrink-0 px-0.5 pb-1.5 border-b border-white/[0.06]">
              <p className="text-[12px] font-semibold text-zinc-100 truncate">
                {current.name || t("ui.episodeStillPickerTitle")}
              </p>
              <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/10 shrink-0">
                S{current.season}:E{current.episode}
              </span>
            </div>

            <div className="min-h-0 flex-1 flex items-center justify-center overflow-hidden">
              {stillsState.loading && !previewUrl && (
                <div className="w-full max-w-[560px] aspect-video rounded-lg skeleton-shimmer" />
              )}

              {!stillsState.loading && stillsState.error && (
                <div className="flex items-start gap-2 max-w-[420px] rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                  <span>{t("ui.episodeStillPickerError")}</span>
                </div>
              )}

              {!stillsState.error && previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-testid="episode-still-preview"
                  src={previewUrl}
                  alt={t("ui.episodeStillPickerTitle")}
                  className="max-w-full max-h-full object-contain rounded-lg border border-white/10 bg-zinc-900 shadow-lg shadow-black/30"
                />
              )}

              {/* TVDB has no TMDB fail-open still available: the single TVDB
                  cover is shown raw (no invented composition). */}
              {!stillsState.loading && !stillsState.error && !previewUrl &&
                effectiveProvider === "tvdb" && current.tvdbImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-testid="episode-tvdb-preview"
                  src={current.tvdbImage}
                  alt={t("ui.episodeStillPickerTitle")}
                  className="max-w-full max-h-full object-contain rounded-lg border border-white/10 bg-zinc-900 shadow-lg shadow-black/30"
                />
              )}

              {!stillsState.loading && !stillsState.error && !previewUrl &&
                stillsState.stills.length === 0 &&
                !(effectiveProvider === "tvdb" && current.tvdbImage) && (
                <div className="flex flex-col items-center gap-1.5 text-center px-4">
                  <ImageOff className="w-5 h-5 text-zinc-600" aria-hidden="true" />
                  <p className="text-[11px] text-zinc-500 italic">{t("ui.episodeStillPickerEmpty")}</p>
                </div>
              )}
            </div>

            {/* Honest explanation when the filler toggle is ON but the bundled
                snapshot has no classification for this title/episode. The
                settings preview sample never claims a real status: without
                data there is no banner (by design, no guessed label). */}
            {fillerUnavailable && (
              <p
                data-testid="episode-filler-unavailable"
                className="shrink-0 flex items-start gap-2 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-[11px] leading-relaxed text-zinc-300"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-zinc-400" aria-hidden="true" />
                <span>{t("ui.thumbnailFillerUnavailable")}</span>
              </p>
            )}

            {/* Opt-in panel: prefilled public GitHub issue. The user reviews
                and submits; no token, no fetch, no auto-create. Hidden unless
                the build sets NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1. */}
            {correctionEnabled && fillerBadgeEnabled && standardNumbering && (current.season > 0 || bulkMode) && (
              <div
                data-testid="filler-correction"
                className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
              >
                <button
                  type="button"
                  data-testid="filler-correction-toggle"
                  aria-expanded={correctionOpen}
                  onClick={() => setCorrectionOpen((open) => !open)}
                  className="w-full min-h-[28px] flex items-center justify-between gap-2 text-left text-[11px] font-semibold text-zinc-200 hover:text-zinc-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 rounded-md"
                >
                  <span>
                    Suggest filler correction
                    {bulkMode ? ` · ${selectedCorrectionRows.length} selected` : ""}
                  </span>
                  {correctionOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                  )}
                </button>

                {correctionOpen && (
                  <div data-testid="filler-correction-panel" className="mt-2 space-y-2">
                    {bulkMode ? (
                      <p
                        data-testid="filler-correction-bulk-summary"
                        className="text-[11px] leading-relaxed text-zinc-400"
                      >
                        Bulk selection:{" "}
                        <span className="font-semibold text-zinc-200">
                          {selectedCorrectionRows.length} episodes
                        </span>
                        {selectedCorrectionRows.length > MAX_BULK_CORRECTION_EPISODES
                          ? ` (max ${MAX_BULK_CORRECTION_EPISODES} per issue)`
                          : ""}
                        {" · "}the type below applies to all; override a row when needed.
                      </p>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-zinc-400">
                        Current:{" "}
                        <span className="font-semibold text-zinc-200">
                          {fillerStatus ? FILLER_CORRECTION_STATUS_LABELS[fillerStatus] : "unknown"}
                        </span>
                        {" · "}S{current.season}:E{current.episode}
                        {absoluteEpisode !== null ? ` (absolute ${absoluteEpisode})` : ""}
                      </p>
                    )}

                    <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                      {bulkMode ? "Proposed type for the selection" : "Proposed type"}
                      <select
                        data-testid="filler-correction-proposed"
                        aria-label={bulkMode ? "Proposed type for the selection" : "Proposed type"}
                        value={proposedStatus}
                        onChange={(e) =>
                          updateProposal(e.target.value as EpisodeFillerStatus | "")
                        }
                        className="mt-1 block w-full min-h-[30px] rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {(Object.keys(FILLER_CORRECTION_STATUS_LABELS) as EpisodeFillerStatus[]).map(
                          (status) => (
                            <option key={status} value={status}>
                              {FILLER_CORRECTION_STATUS_LABELS[status]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    {bulkMode && selectedCorrectionRows.length > 0 && (
                      <div
                        data-testid="filler-correction-bulk-rows"
                        className="max-h-44 overflow-y-auto space-y-1 rounded-md border border-white/10 bg-black/30 p-1.5"
                      >
                        {selectedCorrectionRows.map((row) => (
                          <div key={row.key} className="flex items-center gap-2">
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                              S{row.season}:E{row.episode}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-300">
                              {row.name || "—"}
                            </span>
                            <select
                              data-testid="filler-correction-row-type"
                              data-episode-key={row.key}
                              aria-label={`Proposed type for S${row.season}:E${row.episode}`}
                              value={perEpisodeTypeDraft[row.key] ?? ""}
                              onChange={(e) =>
                                updateRowType(row.key, e.target.value as EpisodeFillerStatus | "")
                              }
                              className="shrink-0 min-h-[26px] max-w-[112px] rounded-md border border-white/10 bg-black/40 px-1 text-[10px] text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                            >
                              <option value="">
                                {proposedStatus
                                  ? `Bulk: ${FILLER_CORRECTION_STATUS_LABELS[proposedStatus]}`
                                  : "Bulk type"}
                              </option>
                              {(Object.keys(FILLER_CORRECTION_STATUS_LABELS) as EpisodeFillerStatus[]).map(
                                (status) => (
                                  <option key={status} value={status}>
                                    {FILLER_CORRECTION_STATUS_LABELS[status]}
                                  </option>
                                ),
                              )}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {bulkMode && (
                      <div
                        data-testid="filler-correction-bulk-preview"
                        className="space-y-0.5 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-400"
                      >
                        <p>
                          Filler:{" "}
                          <span
                            data-testid="filler-correction-range-filler"
                            className="font-mono text-zinc-200"
                          >
                            {bulkRangePreview.filler}
                          </span>
                        </p>
                        <p>
                          Mixed:{" "}
                          <span
                            data-testid="filler-correction-range-mixed"
                            className="font-mono text-zinc-200"
                          >
                            {bulkRangePreview.mixed}
                          </span>
                        </p>
                        <p>
                          Titles: {selectedCorrectionRows.filter((row) => row.name).length}/
                          {selectedCorrectionRows.length} from TMDB
                          {selectedCorrectionRows.some((row) => !row.name)
                            ? " · missing titles are flagged, not invented"
                            : ""}
                        </p>
                      </div>
                    )}

                    {bulkMode && bulkCorrection && !bulkCorrection.ok && (
                      <p
                        data-testid="filler-correction-bulk-error"
                        className="text-[10px] leading-relaxed text-amber-200"
                      >
                        {bulkCorrection.message}
                      </p>
                    )}

                    <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                      Because (optional)
                      <input
                        data-testid="filler-correction-reason"
                        aria-label="Reason"
                        type="text"
                        maxLength={600}
                        value={correctionReason}
                        onChange={(e) => updateReason(e.target.value)}
                        placeholder="e.g. episode 12 adapts manga chapters 30-31"
                        className="mt-1 block w-full min-h-[30px] rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                      />
                    </label>

                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-300">
                      <input
                        data-testid="filler-correction-watched"
                        type="checkbox"
                        checked={correctionWatched}
                        onChange={(e) => updateWatched(e.target.checked)}
                        className="mt-0.5 accent-accent-orange"
                      />
                      <span>
                        {bulkMode
                          ? "I watched these episodes (direct viewing). Uncheck if you did not: a clean source is then required."
                          : "I watched this episode (direct viewing). Uncheck if you did not: a clean source is then required."}
                      </span>
                    </label>

                    {!correctionWatched && (
                      <>
                        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                          Source (required)
                          <select
                            data-testid="filler-correction-source"
                            aria-label="Source"
                            value={correctionSource}
                            onChange={(e) =>
                              updateSource(e.target.value as FillerCorrectionSource | "")
                            }
                            className="mt-1 block w-full min-h-[30px] rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                          >
                            <option value="" disabled>
                              Select a source…
                            </option>
                            {FILLER_CORRECTION_SOURCES.filter(
                              (option) => option !== FILLER_CORRECTION_DIRECT_VIEWING,
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                          Citation (URL, revision/date, license)
                          <textarea
                            data-testid="filler-correction-source-notes"
                            aria-label="Citation"
                            rows={2}
                            maxLength={600}
                            value={correctionSourceNotes}
                            onChange={(e) => updateSourceNotes(e.target.value)}
                            placeholder="https://… — revision/date, license, attribution"
                            className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                          />
                        </label>
                      </>
                    )}

                    {bulkMode && (
                      <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
                        Continued from issue # (only when splitting a large selection)
                        <input
                          data-testid="filler-correction-continued-from"
                          aria-label="Continued from issue number"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={continuationDraft}
                          onChange={(e) => setContinuationDraft(e.target.value)}
                          placeholder="e.g. 123"
                          className="mt-1 block w-full min-h-[30px] rounded-md border border-white/10 bg-black/40 px-2 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                        />
                      </label>
                    )}

                    <button
                      type="button"
                      data-testid="filler-correction-open"
                      disabled={!correctionUrl}
                      onClick={openCorrectionIssue}
                      className="w-full min-h-[32px] rounded-lg border border-accent-orange/60 bg-accent-orange/20 px-3 text-[11px] font-semibold text-zinc-50 hover:bg-accent-orange/30 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      {bulkMode
                        ? `Open prefilled GitHub issue (${selectedCorrectionRows.length} episodes)`
                        : "Open prefilled GitHub issue"}
                    </button>
                    <p
                      data-testid="filler-correction-help"
                      className="text-[10px] leading-relaxed text-zinc-500"
                    >
                      {bulkMode
                        ? "The ranges and the episode titles are compiled from the selection: choose one type, open the prefilled issue, review it and submit it with your own account (two clicks after selecting). Pictorium sends no token and creates nothing automatically."
                        : "GitHub opens the public add-series issue prefilled. You review and submit with your own account: Pictorium sends no token and creates nothing automatically. Check several episodes in the list to switch to a bulk correction."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* RIGHT — source tabs: TMDB variant grid | TVDB single episode cover. */}
          {!readOnly && (
          <aside
            data-testid="episode-browser-stills"
            className="min-w-0 min-h-0 rounded-xl border border-white/10 bg-black/25 p-2.5 space-y-2.5 overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5 border-b border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1 min-w-0">
                <ImageIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("ui.episodeStillPickerTitle")}</span>
              </span>
              <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/10 shrink-0">
                {sourceTab === "tmdb" ? stillsState.stills.length : current.tvdbImage ? 1 : 0}
              </span>
            </div>

            {/* Provider tabs: default TMDB keeps the historical variant grid. */}
            <div
              role="tablist"
              aria-label={t("ui.episodeStillPickerTitle")}
              data-testid="episode-still-source-tabs"
              className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black/40 border border-white/10"
            >
              <button
                type="button"
                role="tab"
                id="episode-still-tab-tmdb"
                aria-selected={sourceTab === "tmdb"}
                aria-controls="episode-still-panel-tmdb"
                data-testid="episode-still-source-tmdb"
                onClick={() => setSourceTab("tmdb")}
                className={`min-h-[30px] rounded-md text-[10px] font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                  sourceTab === "tmdb"
                    ? "bg-accent-orange/20 text-zinc-50 border border-accent-orange/50"
                    : "text-zinc-400 hover:text-zinc-100 border border-transparent"
                }`}
              >
                TMDB
              </button>
              <button
                type="button"
                role="tab"
                id="episode-still-tab-tvdb"
                aria-selected={sourceTab === "tvdb"}
                aria-controls="episode-still-panel-tvdb"
                data-testid="episode-still-source-tvdb"
                onClick={() => setSourceTab("tvdb")}
                className={`min-h-[30px] rounded-md text-[10px] font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                  sourceTab === "tvdb"
                    ? "bg-accent-orange/20 text-zinc-50 border border-accent-orange/50"
                    : "text-zinc-400 hover:text-zinc-100 border border-transparent"
                }`}
              >
                TVDB
              </button>
            </div>

            {sourceTab === "tmdb" && (
              <div role="tabpanel" id="episode-still-panel-tmdb" aria-labelledby="episode-still-tab-tmdb">
                {stillsState.loading && (
                  <div className="grid grid-cols-2 gap-2" aria-hidden="true">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="aspect-video rounded-md skeleton-shimmer" />
                    ))}
                  </div>
                )}

                {!stillsState.loading && stillsState.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                    <span>{t("ui.episodeStillPickerError")}</span>
                  </div>
                )}

                {!stillsState.loading && !stillsState.error && stillsState.stills.length === 0 && (
                  <div className="flex flex-col items-center gap-1.5 text-center px-2 py-4">
                    <ImageOff className="w-4 h-4 text-zinc-600" aria-hidden="true" />
                    <p className="text-[11px] text-zinc-500 italic">{t("ui.noResults")}</p>
                  </div>
                )}

                {!stillsState.loading && !stillsState.error && stillsState.stills.length > 0 && (
                  <div role="group" className="grid grid-cols-2 gap-2">
                    {stillsState.stills.map((still: TMDBEpisodeStill) => {
                      const active = effectiveProvider === "tmdb" && still.file_path === effectiveStill
                      return (
                        <button
                          key={still.file_path}
                          type="button"
                          data-testid="episode-still-tile"
                          data-provider="tmdb"
                          aria-pressed={active}
                          aria-label={t("ui.episodeStillPickerChoose", {
                            ep: `S${current.season}:E${current.episode}`,
                          })}
                          onClick={() => stageStill(still.file_path)}
                          className={`relative aspect-video overflow-hidden rounded-lg border transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                            active
                              ? "border-accent-orange ring-2 ring-accent-orange/40"
                              : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${STILL_THUMB_BASE}${still.file_path}`}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {sourceTab === "tvdb" && (
              <div
                role="tabpanel"
                id="episode-still-panel-tvdb"
                aria-labelledby="episode-still-tab-tvdb"
                className="space-y-2"
              >
                {/* TVDB exposes ONE episode image, never a variant gallery:
                    the tab lists that single cover or says so honestly. */}
                {current.tvdbImage ? (
                  <div role="group" data-testid="episode-tvdb-grid" className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      data-testid="episode-tvdb-still-tile"
                      data-provider="tvdb"
                      aria-pressed={effectiveProvider === "tvdb"}
                      aria-label={t("ui.episodeStillPickerChoose", {
                        ep: `S${current.season}:E${current.episode}`,
                      })}
                      onClick={stageTvdb}
                      className={`relative aspect-video overflow-hidden rounded-lg border transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                        effectiveProvider === "tvdb"
                          ? "border-accent-orange ring-2 ring-accent-orange/40"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={current.tvdbImage}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <p data-testid="episode-tvdb-still-note" className="text-[11px] text-zinc-500 leading-relaxed px-1">
                      TVDB · 1 immagine per episodio (nessuna variante).
                    </p>
                  </div>
                ) : (
                  <p data-testid="episode-tvdb-still-empty" className="text-[11px] text-zinc-500 italic px-1">
                    {t("ui.episodeStillPickerEmpty")}
                  </p>
                )}
                {stills !== "tvdb" && (
                  <p data-testid="episode-tvdb-still-source-hint" className="text-[11px] text-amber-200/80 leading-relaxed px-1">
                    La copertina TVDB viene servita da /meta solo quando la sorgente episodi dello spazio è TVDB.
                  </p>
                )}
              </div>
            )}
          </aside>
          )}
        </div>

        {/* BOTTOM BAR — one batch save for every staged episode. */}
        {!readOnly && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <div className="min-w-0 flex items-center gap-3">
            <span className="min-w-0 inline-flex items-center gap-2 text-[11px] text-zinc-400">
              <span className="uppercase tracking-wide">{t("ui.episodeThumbnails")}</span>
              <span
                data-testid="episode-studio-staged-count"
                className="font-mono tabular-nums min-w-[24px] text-center px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/10"
              >
                {stagedCount}
              </span>
            </span>
            {/* Per-title daily rotation: explicit on/off beats the space
                default, Inherit hands control back (`null` on the mapping). */}
            <ThumbnailRotationSelector value={rotationDraft} onChange={setRotationDraft} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="episode-studio-reset-all"
              disabled={saving}
              onClick={handleResetAll}
              className="min-h-[34px] px-3 rounded-lg border border-white/15 bg-white/5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("ui.episodeStillsResetSaved")}
            </button>
            <button
              type="button"
              data-testid="episode-studio-cancel"
              onClick={() => setStaged({})}
              className="min-h-[34px] px-3 rounded-lg border border-white/15 bg-white/5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("ui.episodeStillsCancelDraft")}
            </button>
            <button
              type="button"
              data-testid="episode-studio-save"
              disabled={(stagedCount === 0 && !rotationChanged) || saving}
              onClick={handleSaveAll}
              className="min-h-[34px] px-3 rounded-lg border border-accent-orange/60 bg-accent-orange/20 text-[11px] font-semibold text-zinc-50 hover:bg-accent-orange/30 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("ui.save")} {t("ui.episodeThumbnails")}
            </button>
          </div>
        </div>
        )}
    </Modal>
  )
}

interface PreviewVideo {
  id: string
  name: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  rating?: string
  /** Original TMDB S:E when the visible ordering is remapped (Episode Groups). */
  stillSeason?: number
  stillEpisode?: number
}

interface PreviewSeason {
  season: number
  name: string
  overview?: string
  episodes: PreviewVideo[]
}

interface PreviewPayload {
  videos: PreviewVideo[]
  seasons: PreviewSeason[]
  totalEpisodes: number
  totalSeasons: number
  autoDefault?: { groupId: string; name: string } | null
  error?: string
}

/** Episode that seeds the studio when the single entry button opens it. */
interface PreviewEpisodeSeed {
  season: number
  episode: number
  defaultStill: string | null
  /** Raw episode cover from the preview payload (static fallback, no picker). */
  coverUrl?: string | null
}

export function EpisodePreview({
  autoOpenThumbnailStudio = false,
  onAutoOpenThumbnailStudio,
}: {
  /** Miniature-zone entry: open the still studio once the preview resolves. */
  autoOpenThumbnailStudio?: boolean
  /** Fired when the one-shot auto-open has been honoured. */
  onAutoOpenThumbnailStudio?: () => void
} = {}) {
  const { t, lang } = useT()
  const selected = usePSelector((v) => v.selected)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const tvdbApiKey = usePSelector((v) => v.tvdbApiKey)
  const serverKeyStatus = usePSelector((v) => v.serverKeyStatus)
  const hasTvdbKey = !!tvdbApiKey || !!serverKeyStatus?.tvdb
  const ed = usePosterEditor()

  const [data, setData] = useState<PreviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Episode that seeds the studio when the single entry button opens it
  // (closed = null). The season/episode list itself lives inside the studio.
  const [studioEpisode, setStudioEpisode] = useState<PreviewEpisodeSeed | null>(null)
  // Miniature-zone entry intent: latched so clearing the prop (after the open)
  // cannot cancel a pending open, and consumed once per mount.
  const autoOpenRequestedRef = useRef(autoOpenThumbnailStudio)
  useEffect(() => {
    if (autoOpenThumbnailStudio) autoOpenRequestedRef.current = true
  }, [autoOpenThumbnailStudio])

  // Episode titles follow the active UI language exactly like `/meta`
  // (content language from UI language + default region): changing the
  // language must refetch the localized episode/season names.
  const previewLanguage = contentLanguageForUiLang(lang, ed.defaultRegion)
  const episodeGroupId = ed.episodeGroupId
  const tvdbOrdering = episodeGroupId === "tvdb" || (episodeGroupId?.startsWith("tvdb:") ?? false)
  const isTvdbSource = tvdbOrdering || ed.episodeMetadataSource === "tvdb" || ed.defaultEpisodeMetadataSource === "tvdb"
  // Space base still provider for the studio (initial tab/selection and the
  // composed `?stills=` note). Uses the SAME resolved `isTvdbSource` as the
  // preview fetch (token/default), so the studio and `/meta` agree on the
  // provider the space actually serves; the tabs let the user override one
  // episode in either direction.
  const tvdbStills = isTvdbSource
  // The stills endpoint only knows standard TMDB numbering: custom groups,
  // AniZip, TVDB ORDERING and the AUTO-APPLIED Parts default resolve stills by
  // a different numbering. That is a warning INSIDE the studio, never a
  // disabled entry button: the metadata SOURCE (TMDB/TVDB enrichment) does not
  // renumber at all, and a dead "Vedi tutti" button (the old gate) looked like
  // a broken picker. `autoDefault` = the server actually applied a group.
  const standardNumbering =
    (episodeGroupId === null || episodeGroupId === "standard") && !data?.autoDefault

  useEffect(() => {
    if (!selected || selected.media_type !== "tv") {
      setData(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      tmdbId: String(selected.id),
      lang: previewLanguage,
    })
    if (episodeGroupId && episodeGroupId !== "standard") {
      params.set("episodeGroupId", episodeGroupId)
    } else if (episodeGroupId === "standard") {
      // "standard" esplicito: disattiva il default automatico Parts
      params.set("episodeGroupId", "standard")
    }
    // episodeGroupId null = nessuna scelta: parametro omesso → il server
    // applica il default automatico Parts quando rilevato (meta-handler sync)
    if (tvdbApiKey) params.set("tvdb_key", tvdbApiKey)
    // per l'anteprima TVDB mostra sempre thumbnail TVDB se disponibile
    if (isTvdbSource) params.set("source", "tvdb")

    userFetch(`/api/preview/episodes?${params.toString()}`, {
      headers: tmdbKey ? { "x-api-key": tmdbKey } : undefined,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json: PreviewPayload) => {
        if (!active) return
        if (json.error && (!json.videos || json.videos.length === 0)) {
          setError(json.error)
        } else {
          setData(json)
          setStudioEpisode(null)
        }
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selected is object identity, we want id+type
  }, [selected?.id, selected?.media_type, episodeGroupId, tmdbKey, tvdbApiKey, isTvdbSource, previewLanguage])

  // First episode of the visible ordering seeds the studio; the studio's own
  // left pane navigates between seasons and episodes.
  let entryEpisode: PreviewEpisodeSeed | null = null
  for (const s of data?.seasons ?? []) {
    const first = s.episodes[0]
    if (first) {
      entryEpisode = {
        season: first.season,
        episode: first.episode,
        defaultStill: stillPathFromThumbnail(first.thumbnail),
        coverUrl: first.thumbnail ?? null,
      }
      break
    }
  }

  // Miniature-zone entry: open the still studio as soon as the first episode of
  // the visible ordering is available. Consumed once; a later tab switch or a
  // manual studio close never re-opens it.
  useEffect(() => {
    if (!autoOpenRequestedRef.current || !entryEpisode) return
    autoOpenRequestedRef.current = false
    setStudioEpisode(entryEpisode)
    onAutoOpenThumbnailStudio?.()
  }, [entryEpisode, onAutoOpenThumbnailStudio])

  if (!selected || selected.media_type !== "tv") return null

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs tracking-tight">
          <Film className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
          {t("ui.epPreviewTitle")}
        </span>
        {!loading && data && (
          <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-white/[0.06] text-zinc-300 border border-white/10 shrink-0">
            {t("ui.epPreviewCount", { seasons: data.totalSeasons, episodes: data.totalEpisodes })}
          </span>
        )}
      </div>

      {!loading && !error && data?.autoDefault && (
        <div className="rounded-lg bg-accent-orange/10 border border-accent-orange/30 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-zinc-200">{t("ui.epAutoDefault", { name: data.autoDefault.name })}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-11 rounded-lg skeleton-shimmer" />
          ))}
          <p className="text-[11px] text-zinc-500 text-center py-1 leading-relaxed">Carico episodi da {(episodeGroupId === "tvdb" || episodeGroupId?.startsWith("tvdb:")) ? "TheTVDB" : "TMDB"}…</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <p className="min-w-0 break-words">Errore anteprima: {error}</p>
        </div>
      )}

      {isTvdbSource && !hasTvdbKey && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <p className="min-w-0">{t("ui.tvdbKeyMissingWarn")}</p>
        </div>
      )}

      {!loading && !error && data && data.seasons.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-center">
          <ImageOff className="w-5 h-5 text-zinc-600" aria-hidden="true" />
          <p className="text-[11px] text-zinc-500 italic">{t("ui.noEpisodes")}</p>
        </div>
      )}

      {!loading && !error && data && data.seasons.length > 0 && (
        <div
          data-testid="episode-studio-entry"
          className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2"
        >
          <span className="block w-14 h-8 shrink-0 overflow-hidden rounded-md border border-white/10 bg-zinc-800 flex items-center justify-center">
            {entryEpisode?.defaultStill ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="episode-still-cover"
                src={`${STILL_THUMB_BASE}${entryEpisode.defaultStill}`}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
            ) : entryEpisode?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="episode-still-cover"
                src={entryEpisode.coverUrl}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1 text-[11px] font-medium text-zinc-200 inline-flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3 shrink-0 text-accent-orange" aria-hidden="true" />
            <span className="truncate">{t("ui.episodeThumbnails")}</span>
          </span>
          {/* Both providers open the same studio: the right pane exposes the
              TMDB | TVDB tabs, so a TVDB space can pick a TMDB still and vice
              versa without a second editor. */}
          <button
            type="button"
            data-testid="episode-still-expand"
            aria-expanded={studioEpisode !== null}
            aria-haspopup="dialog"
            // `entryEpisode` is always set when the entry row renders (it
            // requires at least one episode): the button never opens on a
            // null seed. The visible action stays "Vedi tutti" and the
            // label/tooltip spell out WHAT opens (the thumbnail studio).
            aria-label={`${t("ui.episodeThumbnails")} — ${t("ui.viewAll")}`}
            title={`${t("ui.episodeThumbnails")} — ${t("ui.viewAll")}`}
            disabled={!entryEpisode}
            onClick={() => {
              if (entryEpisode) setStudioEpisode(entryEpisode)
            }}
            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg border border-white/15 bg-white/5 text-[10px] font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <Maximize2 className="w-3 h-3" aria-hidden="true" />
            {t("ui.viewAll")}
          </button>
        </div>
      )}

      {studioEpisode && (
        <EpisodeStillStudio
          seriesId={selected.id}
          season={studioEpisode.season}
          episode={studioEpisode.episode}
          title={selected.title || selected.name || ""}
          malId={selected.anime_ids?.mal?.[0] ?? null}
          tmdbKey={tmdbKey}
          defaultStill={studioEpisode.defaultStill}
          seasons={data?.seasons ?? []}
          standardNumbering={standardNumbering}
          stills={tvdbStills ? "tvdb" : "tmdb"}
          onClose={() => setStudioEpisode(null)}
        />
      )}

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        È la stessa lista che Stremio riceverà su <span className="font-mono text-zinc-400">/meta/series/{selected?.id}.json</span>. Apri lo studio delle miniature per scegliere le immagini degli episodi prima di salvare.
      </p>
    </div>
  )
}
