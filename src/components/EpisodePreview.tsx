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
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { userFetch } from "@/lib/http"
import { useEpisodeStills, fetchEpisodeStills, type TMDBEpisodeStill } from "@/lib/useEpisodeStills"
import { buildEpisodeThumbnailUrl, episodeStillKey, sanitizeEpisodeStillPath } from "@/lib/episode-stills"
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

/** Still provider chosen in the right-pane tabs. */
type StillSource = "tmdb" | "tvdb"

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
 *   editor state and triggers ONE normal mapping save (`saveConfig`, the same
 *   full-save used by the editor — `episodeThumbnailStills` rides it); "Cancel"
 *   clears the staged draft. Closing without saving discards the draft: the
 *   staged map lives only in this component and is never written to the
 *   mapping until the Save button runs.
 */
function EpisodeStillStudio({
  seriesId,
  season,
  episode,
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
  tmdbKey?: string | null
  defaultStill?: string | null
  seasons: PreviewSeason[]
  /** False = visible ordering is Parts/TVDB/AniZip; TMDB stills use standard S:E. */
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
  const { t } = useT()
  const ed = usePosterEditor()
  const saveConfig = usePSelector((v) => v.saveConfig)
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
  // The save runs in an effect AFTER the editor state commit, so `saveConfig`
  // (rebuilt with the new `episodeThumbnailStills`) serializes the whole batch.
  const pendingSaveRef = useRef<Record<string, StagedStill> | null>(null)
  const saveConfigRef = useRef(saveConfig)
  useEffect(() => {
    saveConfigRef.current = saveConfig
  }, [saveConfig])

  // Flat episode index for the left pane. The opening episode wins for its own
  // default still (the caller already resolved it); every other row derives the
  // TMDB path from its own thumbnail and falls back to the picker's first still.
  const episodes = useMemo(() => {
    const rows: {
      key: string
      season: number
      episode: number
      name: string
      defaultStill: string | null
      /** Single TVDB episode cover from the preview payload (or null). */
      tvdbImage: string | null
    }[] = []
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
    const targets: { key: string; season: number; episode: number }[] = []
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
      targets.push({ key: row.key, season: row.season, episode: row.episode })
    }
    if (targets.length === 0) return
    // Mark BEFORE fetching so a re-render (or another expanded season) never
    // queues the same S:E twice.
    for (const target of targets) gridFallbackAttempted.current.add(target.key)
    void (async () => {
      for (const target of targets) {
        try {
          const rows = await fetchEpisodeStills(seriesId, target.season, target.episode, tmdbKey)
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
    tmdbKey,
    defaultStill: current.defaultStill,
    user: userId,
  })

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
    seasonNumber: number,
    episodeNumber: number,
    still: string | null,
    provider: StillSource,
  ): string | null => {
    if (!still || seriesId <= 0) return null
    const base = buildEpisodeThumbnailUrl({
      seriesId,
      season: seasonNumber,
      episode: episodeNumber,
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
    Promise.resolve(saveConfigRef.current())
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
  }, [saveNonce])

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
            className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {!standardNumbering && (
          // Honest caveat instead of silently picking another episode's image:
          // the visible ordering is not TMDB standard, so stills resolve by the
          // standard S:E of the same numbers.
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
                      className="w-full min-h-[32px] flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-left hover:bg-white/[0.06] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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
                            <button
                              key={ep.id}
                              type="button"
                              data-testid="episode-browser-episode"
                              aria-pressed={active}
                              onClick={() => setSelectedKey(key)}
                              className={`w-full min-h-[40px] flex items-center gap-2 px-1.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
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
                className={`min-h-[30px] rounded-md text-[10px] font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
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
                className={`min-h-[30px] rounded-md text-[10px] font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
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
                          className={`relative aspect-video overflow-hidden rounded-lg border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
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
                      className={`relative aspect-video overflow-hidden rounded-lg border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
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
              className="min-h-[34px] px-3 rounded-lg border border-white/15 bg-white/5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("ui.episodeStillsResetSaved")}
            </button>
            <button
              type="button"
              data-testid="episode-studio-cancel"
              onClick={() => setStaged({})}
              className="min-h-[34px] px-3 rounded-lg border border-white/15 bg-white/5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10 transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {t("ui.episodeStillsCancelDraft")}
            </button>
            <button
              type="button"
              data-testid="episode-studio-save"
              disabled={(stagedCount === 0 && !rotationChanged) || saving}
              onClick={handleSaveAll}
              className="min-h-[34px] px-3 rounded-lg border border-accent-orange/60 bg-accent-orange/20 text-[11px] font-semibold text-zinc-50 hover:bg-accent-orange/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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

export function EpisodePreview() {
  const { t } = useT()
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
      lang: "it-IT",
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
  }, [selected?.id, selected?.media_type, episodeGroupId, tmdbKey, tvdbApiKey, isTvdbSource])

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
            className="inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg border border-white/15 bg-white/5 text-[10px] font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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
