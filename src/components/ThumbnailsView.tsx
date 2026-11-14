"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, CheckSquare, ChevronDown, ImageIcon, MoreHorizontal, Pencil, Search, Square, Trash2, X } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { http } from "@/lib/http"
import { posterUrl } from "@/lib/utils"
import { RENDER_VERSION } from "@/lib/render-version"
import { toSearchResult } from "@/lib/types"
import type { Mapping } from "@/lib/types"
import { ThumbnailRotationSelector } from "@/components/settings/ThumbnailRotationSelector"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PosterDepthEdge } from "@/components/PosterDepthGlow"

/**
 * Top-level Miniature zone ("Miniature episodi").
 *
 * Lists ONLY TV titles that own a thumbnail customization
 * (`episodeThumbnailStills` or a per-title `thumbnailRotation` override) as a
 * grid of 16:9 cards (same language as the "I miei poster" grid): the composed
 * preview is always visible, clicking the card opens the existing still studio,
 * "Details" reveals the rotation tri-state and every customized episode. There
 * is deliberately NO poster editing here: every write is the thumbnail-only
 * PATCH, which never touches poster fields, `mv` or poster caches. Deleting
 * strips the two thumbnail keys only (the mapping is removed only when it never
 * had any poster data — see the PATCH route).
 */

interface StillEntry {
  readonly season: number
  readonly episode: number
  readonly still: string
}

function stillEntries(stills: Record<string, string> | null | undefined): StillEntry[] {
  if (!stills) return []
  const out: StillEntry[] = []
  for (const [key, still] of Object.entries(stills)) {
    const match = /^(\d+):(\d+)$/.exec(key)
    if (!match) continue
    out.push({ season: Number(match[1]), episode: Number(match[2]), still })
  }
  return out.sort((a, b) => a.season - b.season || a.episode - b.episode)
}

function hasThumbnailCustomization(mapping: Mapping): boolean {
  const stills = mapping.episodeThumbnailStills
  const hasStills = !!stills && Object.keys(stills).length > 0
  return hasStills || typeof mapping.thumbnailRotation === "boolean"
}

const keyOf = (mapping: Mapping) => `${mapping.mediaType}:${mapping.tmdbId}`
const chipCls = "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300"

interface CardProps {
  mapping: Mapping
  idx: number
  currentUserId: string | null | undefined
  selectMode: boolean
  isSelected: boolean
  deleting: boolean
  onToggleSelect: (key: string) => void
  onOpen: (mapping: Mapping) => void
  onDelete: (mapping: Mapping) => void
  onRotation: (mapping: Mapping, value: boolean | null) => void
}

const ThumbnailCard = React.memo(function ThumbnailCard({
  mapping,
  idx,
  currentUserId,
  selectMode,
  isSelected,
  deleting,
  onToggleSelect,
  onOpen,
  onDelete,
  onRotation,
}: CardProps) {
  const { t } = useT()
  const key = keyOf(mapping)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const down = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false) }
    document.addEventListener("mousedown", down)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", esc) }
  }, [menuOpen])

  const entries = stillEntries(mapping.episodeThumbnailStills)
  const first = entries[0]
  const params = new URLSearchParams({ rv: RENDER_VERSION, w: "480", badges: "vote" })
  if (first) params.set("still", first.still)
  if (currentUserId) params.set("u", currentUserId)
  const previewUrl = `/api/thumbnail/tv/${mapping.tmdbId}/season/${first?.season ?? 1}/episode/${first?.episode ?? 1}?${params.toString()}`
  const rotation = typeof mapping.thumbnailRotation === "boolean" ? mapping.thumbnailRotation : null
  const activate = () => { if (selectMode) onToggleSelect(key); else onOpen(mapping) }
  const itemCls = "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer"

  return (
    <li
      data-testid="thumbnail-zone-row"
      className={`group relative min-w-0 ${idx < 12 ? "animate-stagger-in" : ""}`}
      style={idx < 12 ? { animationDelay: `${Math.min(idx * 30, 300)}ms` } : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === "Escape" && confirming) { e.stopPropagation(); setConfirming(false); return }
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate() }
        }}
        aria-label={selectMode ? `${t("ui.selectAll")}: ${mapping.title}` : `${t("ui.thumbnailsZoneEdit")}: ${mapping.title}`}
        aria-pressed={selectMode ? isSelected : undefined}
        className={`surface-card relative z-10 rounded-xl overflow-hidden transition duration-300 ease-out w-full border border-white/10 shadow-lg group-hover:-translate-y-1 group-hover:shadow-[0_22px_48px_rgba(0,0,0,0.5),0_0_26px_rgb(var(--accent-rgb)/0.14)] group-hover:border-white/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 ${
          selectMode && isSelected ? "ring-2 ring-accent-orange/60 border-accent-orange/70" : ""
        }`}
      >
        <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
        <div className="relative z-[1] aspect-video bg-black/40 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- composed dynamic PNG endpoint, not a static optimizable asset */}
          <img
            src={previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden" }}
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />

          {confirming && !selectMode && (
            <div
              role="alertdialog"
              aria-label={t("ui.confirmDelete")}
              onClick={(e) => { e.stopPropagation(); setConfirming(false) }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85 p-3 text-center animate-fade-scale-in"
            >
              <p className="text-xs font-semibold text-zinc-100">{t("ui.confirmDelete")}</p>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  autoFocus
                  disabled={deleting}
                  onClick={() => { setConfirming(false); onDelete(mapping) }}
                  data-testid="thumbnail-zone-confirm-delete"
                  className="min-h-[36px] px-3.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 active:scale-95 transition cursor-pointer disabled:opacity-50"
                >
                  {t("ui.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-[36px] px-3.5 rounded-lg text-xs font-medium bg-white/10 text-zinc-200 hover:bg-white/15 active:scale-95 transition cursor-pointer"
                >
                  {t("ui.cancelAction")}
                </button>
              </div>
            </div>
          )}

          {selectMode && (
            <div
              className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition duration-200 ${
                isSelected ? "bg-accent-orange border-accent-orange scale-110" : "border-white/50 bg-black/40"
              }`}
            >
              {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
            </div>
          )}
        </div>
      </div>

      {/* Menu ⋯ fuori dalla card (overflow-hidden). */}
      {!selectMode && !confirming && (
        <div ref={menuRef} className="absolute top-2 right-2 z-30">
          <button
            type="button"
            aria-label={`${t("ui.moreActions")}: ${mapping.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={`w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white/90 hover:bg-black/80 active:scale-90 transition duration-200 cursor-pointer touch-manipulation group-hover:-translate-y-1 ${
              menuOpen ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1.5 w-48 rounded-xl p-1 bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/60 animate-fade-scale-in origin-top-right">
              <button type="button" role="menuitem" className={itemCls} data-testid="thumbnail-zone-edit" onClick={() => { setMenuOpen(false); onOpen(mapping) }}>
                <Pencil className="w-3.5 h-3.5 text-zinc-400" />{t("ui.thumbnailsZoneEdit")}
              </button>
              <div className="h-px bg-white/[0.07] my-1" />
              <button
                type="button"
                role="menuitem"
                className={`${itemCls} !text-red-300 hover:!bg-red-500/15`}
                data-testid="thumbnail-zone-delete-row"
                onClick={() => { setMenuOpen(false); setConfirming(true) }}
              >
                <Trash2 className="w-3.5 h-3.5" />{t("ui.delete")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Didascalia + dettagli (rotazione, episodi personalizzati). */}
      <div className="mt-2 px-0.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="flex-1 text-[13px] font-medium text-foreground truncate">{mapping.title}</p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${t("ui.details")}: ${mapping.title}`}
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {entries.length > 0 && (
            <span className={chipCls}><ImageIcon className="w-2.5 h-2.5" aria-hidden="true" />{entries.length}</span>
          )}
          {rotation !== null && (
            <span className={chipCls}>{rotation ? t("ui.thumbnailRotationOn") : t("ui.thumbnailRotationOff")}</span>
          )}
        </div>
        {expanded && (
          <div className="mt-2 flex flex-col gap-2 animate-fade-scale-in" data-testid="thumbnail-zone-details">
            <ThumbnailRotationSelector value={rotation} onChange={(value) => onRotation(mapping, value)} />
            {entries.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5" data-testid="thumbnail-zone-episodes">
                {entries.map((entry) => (
                  <button
                    key={`${entry.season}:${entry.episode}`}
                    type="button"
                    onClick={() => onOpen(mapping)}
                    className="shrink-0 w-28 text-left group/ep"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
                    <img
                      src={posterUrl(entry.still, "w300")}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-28 aspect-video rounded-md object-cover bg-black/40 border border-white/10 group-hover/ep:border-accent-orange/40 transition-colors"
                    />
                    <span className="block mt-0.5 text-[10px] font-mono text-muted tabular-nums">
                      S{String(entry.season).padStart(2, "0")}E{String(entry.episode).padStart(2, "0")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
})

export function ThumbnailsView() {
  const mappings = usePSelector((v) => v.mappings)
  const currentUserId = usePSelector((v) => v.currentUserId)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const lang = usePSelector((v) => v.lang)
  const { t } = useT()
  const [filter, setFilter] = useState("")
  const [selectMode, setSelectMode] = useState(false)
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

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      const remove = visibleKeys.every((key) => next.has(key))
      for (const key of visibleKeys) {
        if (remove) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

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

  const runDelete = useCallback(
    async (targets: Mapping[]) => {
      if (targets.length === 0) return
      setDeleting(true)
      try {
        const failed = await stripThumbnails(targets)
        if (failed > 0) import("sonner").then(({ toast }) => toast.error(t("ui.deleteFailed", { count: failed })))
      } finally {
        setDeleting(false)
      }
    },
    [stripThumbnails, t],
  )

  const deleteOne = useCallback((mapping: Mapping) => { void runDelete([mapping]) }, [runDelete])
  const onRotation = useCallback((mapping: Mapping, value: boolean | null) => { void setRotation(mapping, value) }, [setRotation])

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
        {/* Search + selection toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-5">
          <div role="search" className="search-shell flex items-center h-10 rounded-xl group flex-1 min-w-0">
            <span className="shrink-0 pl-3 text-zinc-500 group-focus-within:text-zinc-300 transition-colors">
              <Search size={14} />
            </span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("ui.thumbnailsZoneSearch")}
              aria-label={t("ui.thumbnailsZoneSearch")}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted px-2 h-full"
            />
            {filter.length > 0 && (
              <button
                type="button"
                aria-label={t("ui.thumbnailsZoneClear")}
                onClick={() => setFilter("")}
                className="shrink-0 w-6 h-6 mr-1.5 flex items-center justify-center bg-zinc-700/60 text-zinc-300 rounded-full hover:bg-zinc-600 active:scale-90 transition duration-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {selectMode && (
              <>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    aria-label={t("ui.selectAll")}
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected }}
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
                  className="h-10 inline-flex items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="thumbnails-bulk-delete"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {t("ui.deleteSelected", { count: selected.size })}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }}
              disabled={rows.length === 0}
              data-testid="thumbnails-select-mode"
              className={`h-10 px-3 rounded-xl text-xs font-medium transition duration-150 active:scale-95 flex items-center gap-1.5 border disabled:opacity-40 disabled:cursor-not-allowed ${
                selectMode
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40 shadow-sm"
                  : "bg-surface border-surface2/60 text-muted hover:bg-surface2 hover:text-zinc-200"
              }`}
            >
              {selectMode ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {selectMode ? t("ui.cancel") : t("ui.select")}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted text-center py-16" data-testid="thumbnail-zone-empty">
            {t("ui.thumbnailsZoneEmpty")}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted text-center py-16" data-testid="thumbnail-zone-no-results">
            {t("ui.noResultsForQuery")}
          </p>
        ) : (
          <ul className="grid gap-x-3 gap-y-6 md:gap-x-5 md:gap-y-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((mapping, idx) => {
              const key = keyOf(mapping)
              return (
                <ThumbnailCard
                  key={key}
                  mapping={mapping}
                  idx={idx}
                  currentUserId={currentUserId}
                  selectMode={selectMode}
                  isSelected={selected.has(key)}
                  deleting={deleting}
                  onToggleSelect={toggleSelected}
                  onOpen={openStudio}
                  onDelete={deleteOne}
                  onRotation={onRotation}
                />
              )
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={t("ui.thumbnailsZoneDeleteTitle")}
        message={t("ui.thumbnailsZoneDeleteMsg")}
        confirmLabel={t("ui.delete")}
        onConfirm={() => {
          setConfirmOpen(false)
          void runDelete(mappings.filter((mapping) => selected.has(keyOf(mapping))))
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
