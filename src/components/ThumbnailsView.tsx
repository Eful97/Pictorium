"use client"

import React, { useCallback, useMemo, useState } from "react"
import { ChevronDown, ImageIcon, Pencil, Search, Trash2, X } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { http } from "@/lib/http"
import { toSearchResult } from "@/lib/types"
import type { Mapping } from "@/lib/types"
import { ThumbnailRotationSelector } from "@/components/settings/ThumbnailRotationSelector"
import { ConfirmDialog } from "@/components/ConfirmDialog"

/**
 * Top-level Miniature zone ("Miniature episodi").
 *
 * Lists ONLY TV titles that own a thumbnail customization
 * (`episodeThumbnailStills` or a per-title `thumbnailRotation` override).
 * Rows are COMPACT by default (name + status chips); expanding a row reveals
 * the composed preview, the rotation tri-state and the entry to the existing
 * still studio (same editor, no duplicated picker). There is deliberately NO
 * poster editing here: every write is the thumbnail-only PATCH, which never
 * touches poster fields, `mv` or poster caches. Deleting strips the two
 * thumbnail keys only (the mapping is removed only when it never had any
 * poster data — see the PATCH route).
 */

interface StillEntry {
  readonly season: number
  readonly episode: number
  readonly still: string
}

function firstStillEntry(stills: Record<string, string> | null | undefined): StillEntry | null {
  if (!stills) return null
  let best: StillEntry | null = null
  for (const [key, still] of Object.entries(stills)) {
    const match = /^(\d+):(\d+)$/.exec(key)
    if (!match) continue
    const season = Number(match[1])
    const episode = Number(match[2])
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue
    if (!best || season < best.season || (season === best.season && episode < best.episode)) {
      best = { season, episode, still }
    }
  }
  return best
}

function hasThumbnailCustomization(mapping: Mapping): boolean {
  const stills = mapping.episodeThumbnailStills
  const hasStills = !!stills && Object.keys(stills).length > 0
  return hasStills || typeof mapping.thumbnailRotation === "boolean"
}

function stillsCount(mapping: Mapping): number {
  return mapping.episodeThumbnailStills ? Object.keys(mapping.episodeThumbnailStills).length : 0
}

export function ThumbnailsView() {
  const mappings = usePSelector((v) => v.mappings)
  const currentUserId = usePSelector((v) => v.currentUserId)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const lang = usePSelector((v) => v.lang)
  const { t } = useT()
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Selection is by mapping key and SURVIVES filtering: the user can search,
  // select across several searches, then delete once. The toolbar count is
  // always the real selection size (never "visible selected").
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const rows = useMemo(
    () =>
      mappings
        .filter((mapping) => mapping.mediaType === "tv" && hasThumbnailCustomization(mapping))
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, lang || undefined)),
    [mappings, lang],
  )

  const query = filter.trim().toLocaleLowerCase(lang || undefined)
  const visible = useMemo(
    () => (query ? rows.filter((mapping) => mapping.title.toLocaleLowerCase(lang || undefined).includes(query)) : rows),
    [rows, query, lang],
  )

  const keyOf = (mapping: Mapping) => `${mapping.mediaType}:${mapping.tmdbId}`
  const visibleKeys = visible.map(keyOf)
  const selectedVisible = visibleKeys.filter((key) => selected.has(key))
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisible.length === visibleKeys.length
  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      const remove = visibleKeys.every((key) => next.has(key))
      for (const key of visibleKeys) {
        if (remove) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }, [visibleKeys])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const setRotation = useCallback(
    async (mapping: Mapping, value: boolean | null) => {
      try {
        await http(`/api/mappings/${mapping.mediaType}:${mapping.tmdbId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thumbnailRotation: value }),
        })
        await loadMappings()
      } catch {
        import("sonner").then(({ toast }) => toast.error(t("ui.saveError")))
      }
    },
    [loadMappings, t],
  )

  const openStudio = useCallback(
    (mapping: Mapping) => {
      navigateToPoster(
        toSearchResult({
          id: mapping.tmdbId,
          media_type: mapping.mediaType,
          title: mapping.title,
          name: mapping.title,
          poster_path: mapping.posterPath,
        }),
        "thumbnails",
      )
    },
    [navigateToPoster],
  )

  const stripThumbnails = useCallback(
    async (targets: Mapping[]): Promise<number> => {
      const results = await Promise.allSettled(
        targets.map((mapping) =>
          http(`/api/mappings/${mapping.mediaType}:${mapping.tmdbId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ episodeThumbnailStills: null, thumbnailRotation: null }),
          }),
        ),
      )
      const succeeded = targets.filter((_, index) => results[index].status === "fulfilled").map(keyOf)
      if (succeeded.length > 0) {
        setSelected((prev) => {
          const next = new Set(prev)
          for (const key of succeeded) next.delete(key)
          return next
        })
        await loadMappings()
      }
      return results.filter((result) => result.status === "rejected").length
    },
    [loadMappings],
  )

  const deleteSelected = useCallback(async () => {
    setConfirmOpen(false)
    const targets = mappings.filter((mapping) => selected.has(keyOf(mapping)))
    if (targets.length === 0) return
    setDeleting(true)
    try {
      const failed = await stripThumbnails(targets)
      if (failed > 0) import("sonner").then(({ toast }) => toast.error(t("ui.deleteFailed", { count: failed })))
    } finally {
      setDeleting(false)
    }
  }, [mappings, selected, stripThumbnails, t])

  const deleteOne = useCallback(
    async (mapping: Mapping) => {
      setDeleting(true)
      try {
        const failed = await stripThumbnails([mapping])
        if (failed > 0) import("sonner").then(({ toast }) => toast.error(t("ui.deleteFailed", { count: failed })))
      } finally {
        setDeleting(false)
      }
    },
    [stripThumbnails, t],
  )

  return (
    <div className="pt-4 animate-fade-scale-in">
      <section className="max-w-7xl mx-auto px-4 mb-6" aria-labelledby="thumbnails-title">
        <div className="text-center md:text-left">
          <span className="hero-kicker mb-3">
            <span className="dot" aria-hidden="true" />
            {t("ui.thumbnailsNav")}
          </span>
          <h1
            id="thumbnails-title"
            className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-50 flex items-center justify-center md:justify-start gap-3"
          >
            {t("ui.episodeThumbnails")}
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-muted tabular-nums">
              {rows.length}
            </span>
          </h1>
          <p className="text-sm text-muted mt-1">{t("ui.thumbnailsZoneSubtitle")}</p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          {/* Search + bulk toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div role="search" className="search-shell flex items-center h-9 rounded-xl group flex-1 min-w-0">
              <span className="shrink-0 pl-3 text-zinc-500 group-focus-within:text-zinc-300 transition-colors">
                <Search size={14} />
              </span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("ui.thumbnailsZoneSearch")}
                aria-label={t("ui.thumbnailsZoneSearch")}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted focus:placeholder:text-muted px-2 h-full transition-colors duration-200"
              />
              {filter.length > 0 && (
                <button
                  type="button"
                  aria-label={t("ui.thumbnailsZoneClear")}
                  onClick={() => setFilter("")}
                  className="shrink-0 w-6 h-6 mr-1.5 flex items-center justify-center bg-zinc-700/60 text-zinc-300 rounded-full hover:bg-zinc-600 active:scale-90 transition-all duration-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  aria-label={t("ui.selectAll")}
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected
                  }}
                  onChange={toggleSelectAllVisible}
                  disabled={visible.length === 0}
                  className="h-3.5 w-3.5 accent-accent-orange"
                />
                {t("ui.selectAll")}
              </label>
              <span className="text-[11px] text-muted tabular-nums" data-testid="thumbnails-selected-count" data-count={selected.size}>
                {t("ui.selectedCount", { count: selected.size })}
              </span>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={selected.size === 0 || deleting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="thumbnails-bulk-delete"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                {t("ui.deleteSelected", { count: selected.size })}
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-muted mt-3" data-testid="thumbnail-zone-empty">
              {t("ui.thumbnailsZoneEmpty")}
            </p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-muted mt-3" data-testid="thumbnail-zone-no-results">
              {t("ui.noResultsForQuery")}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-white/5">
              {visible.map((mapping) => {
                const key = keyOf(mapping)
                const isExpanded = expanded.has(key)
                const entry = firstStillEntry(mapping.episodeThumbnailStills)
                const season = entry?.season ?? 1
                const episode = entry?.episode ?? 1
                const params = new URLSearchParams({ w: "160", badges: "vote" })
                if (entry) params.set("still", entry.still)
                if (currentUserId) params.set("u", currentUserId)
                const previewUrl = `/api/thumbnail/tv/${mapping.tmdbId}/season/${season}/episode/${episode}?${params.toString()}`
                return (
                  <li key={key} data-testid="thumbnail-zone-row" className="py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        aria-label={`${t("ui.selectAll")}: ${mapping.title}`}
                        checked={selected.has(key)}
                        onChange={() => toggleSelected(key)}
                        className="h-3.5 w-3.5 accent-accent-orange shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        aria-expanded={isExpanded}
                        aria-label={`${t("ui.details")}: ${mapping.title}`}
                        className="flex flex-1 items-center gap-2 min-w-0 rounded-lg px-1 py-1 text-left hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 shrink-0 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                        <span className="truncate text-xs font-medium text-zinc-200">{mapping.title}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {stillsCount(mapping) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300">
                              <ImageIcon className="w-2.5 h-2.5" aria-hidden="true" />
                              {stillsCount(mapping)}
                            </span>
                          )}
                          {typeof mapping.thumbnailRotation === "boolean" && (
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300">
                              {mapping.thumbnailRotation
                                ? t("ui.thumbnailRotationOn")
                                : t("ui.thumbnailRotationOff")}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { void deleteOne(mapping) }}
                        disabled={deleting}
                        aria-label={`${t("ui.delete")}: ${mapping.title}`}
                        className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        data-testid="thumbnail-zone-delete-row"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="flex flex-wrap items-center gap-3 pl-7 pt-1.5 pb-1">
                        {/* eslint-disable-next-line @next/next/no-img-element -- composed dynamic PNG endpoint, not a static optimizable asset */}
                        <img
                          src={previewUrl}
                          alt=""
                          width={71}
                          height={40}
                          loading="lazy"
                          className="h-10 w-[71px] rounded-md object-cover bg-black/40 border border-white/10 shrink-0"
                        />
                        <ThumbnailRotationSelector
                          value={typeof mapping.thumbnailRotation === "boolean" ? mapping.thumbnailRotation : null}
                          onChange={(value) => { void setRotation(mapping, value) }}
                        />
                        <button
                          type="button"
                          onClick={() => openStudio(mapping)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 hover:border-accent-orange/40 hover:text-accent-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
                          data-testid="thumbnail-zone-edit"
                        >
                          <Pencil className="w-3 h-3" aria-hidden="true" />
                          {t("ui.thumbnailsZoneEdit")}
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={t("ui.thumbnailsZoneDeleteTitle")}
        message={t("ui.thumbnailsZoneDeleteMsg")}
        confirmLabel={t("ui.delete")}
        onConfirm={() => { void deleteSelected() }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
