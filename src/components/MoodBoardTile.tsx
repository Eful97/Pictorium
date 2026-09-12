"use client"

import React from "react"
import { Check, Trash2, Maximize2, Folder } from "lucide-react"
import { posterUrl } from "@/lib/utils"
import type { Mapping } from "@/lib/types"
import { PosterDepthEdge, PosterDepthSheen } from "@/components/PosterDepthGlow"

interface MoodBoardTileProps {
  mapping: Mapping
  idx: number
  selectMode: boolean
  selected: Set<string>
  onSelect: () => void
  onOpen: () => void
  onQuickView: (e: React.MouseEvent) => void
  onRemove: (e: React.MouseEvent) => void
  collectionCount?: number
  t: (key: string, params?: Record<string, string | number>) => string
}

export function MoodBoardTile({
  mapping: m,
  idx,
  selectMode,
  selected,
  onSelect,
  onOpen,
  onQuickView,
  onRemove,
  collectionCount = 0,
  t,
}: MoodBoardTileProps) {
  const key = `${m.mediaType}:${m.tmdbId}`
  const isSelected = selected.has(key)
  const year = (m.releaseDate || m.firstAirDate || "").slice(0, 4)
  const typeLabel = m.mediaType === "movie"
    ? t("ui.movie")
    : (m.genreName || "").toLowerCase().includes("anim")
      ? t("ui.filterAnime")
      : t("ui.tvSeries")
  const displaySrc = m.posterPath ? posterUrl(m.posterPath, "w342") : null

  return (
    <div
      className="animate-stagger-in"
      style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
    >
      <div
        onClick={() => { if (selectMode) onSelect(); else onOpen() }}
        role="button"
        tabIndex={0}
        aria-label={`${m.title} — ${m.logoPath ? t("ui.posterWithLogo") : t("ui.cleanPoster")} — ${typeLabel}`}
        aria-pressed={selectMode && isSelected}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (selectMode) onSelect(); else onOpen()
          }
        }}
        className={`surface-card group relative z-10 rounded-xl overflow-hidden transition-all duration-300 ease-out w-full border border-white/10 shadow-2xl hover:-translate-y-[3px] hover:scale-[1.015] hover:shadow-[0_22px_48px_rgba(0,0,0,0.48),0_0_22px_rgba(232,93,42,0.10)] hover:border-white/20 ${
          selectMode
            ? isSelected
              ? "ring-2 ring-red-400/50 border-red-400/70"
              : ""
            : ""
        }`}
      >
        {/* NuvioDesktop-style depth: bordo superiore + riflesso glass */}
        <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
        <div className="relative z-[1]">

      <div className="aspect-[2/3] bg-surface/80 overflow-hidden relative">
        {/* Poster image clean TMDB */}
        {displaySrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL
          <img
            src={displaySrc}
            alt={m.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-[400ms] ease-out group-hover:scale-[1.06]"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = "none"
              ;(e.target as HTMLImageElement).parentElement?.classList.add("show-fallback")
            }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-zinc-800/50 to-zinc-900/80 gap-2">
            <svg className="w-8 h-8 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <polygon points="9.5 8 15.5 12 9.5 16 9.5 8" fill="currentColor" stroke="none"/>
            </svg>
            <span className="text-[10px] font-medium text-zinc-600">{m.title?.charAt(0)?.toUpperCase() || "?"}</span>
          </div>
        )}

        {/* Logo overlay: posizionato sul poster clean con scala e offset */}
        {m.logoPath && (
          <div
            className="absolute inset-x-0 bottom-[7.33%] flex items-center justify-center pointer-events-none"
            style={{
              transform: `translate(${m.logoOffsetX ?? 0}%, ${-(m.logoOffsetY ?? 0)}%)`,
            }}
          >
            <div style={{ width: `${m.logoScale ?? 75}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
              <img
                src={posterUrl(m.logoPath, "w300")}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
                style={{ objectFit: "contain" }}
              />
            </div>
          </div>
        )}

        {/* Hover overlay with metadata */}
        <div
          className="absolute inset-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)",
          }}
        >
          <div className="absolute bottom-0 left-0 right-0 p-3 pb-3.5 animate-overlay-in">
            <p className="text-sm font-semibold text-white truncate drop-shadow-lg">{m.title}</p>
            <div className="flex items-center gap-2 mt-1">
              {year && <span className="text-xs text-zinc-300 font-medium">{year}</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/15 text-zinc-200 font-semibold backdrop-blur-sm">
                {typeLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Quick view button — appears top-right on hover */}
        {!selectMode && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onQuickView(e) }}
            aria-label={t("ui.quickView")}
            className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/80 hover:bg-black/85 hover:text-white transition-all duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 active:scale-90 cursor-pointer shadow-lg z-10 touch-manipulation"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}

        {/* Collection badge — bottom right */}
        {!selectMode && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onQuickView(e) }}
            aria-label={t("ui.collections")}
            className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-zinc-300 hover:text-white hover:bg-black/85 transition-all duration-200 active:scale-90 cursor-pointer z-10 touch-manipulation"
          >
            <Folder className="w-3 h-3" />
            {collectionCount > 0 && (
              <span className="text-[10px] font-semibold tabular-nums">{collectionCount}</span>
            )}
          </button>
        )}

        {/* Delete button (always visible on hover) */}
        {!selectMode && (
          <button
            type="button"
            aria-label={t("ui.delete")}
            onClick={(e) => { e.stopPropagation(); onRemove(e) }}
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute top-2 left-2 w-10 h-10 rounded-lg bg-red-900/70 flex items-center justify-center text-xs text-red-300 hover:bg-red-800 hover:text-red-200 active:scale-90 transition-all duration-150 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer shadow-lg shadow-black/30 touch-manipulation"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Select mode checkbox */}
        {selectMode && (
          <div
            className={`absolute top-2 right-2 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
              isSelected
                ? "bg-red-500 border-red-500 shadow-lg shadow-red-500/30 scale-110"
                : "border-white/40 bg-black/30"
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white drop-shadow" />}
          </div>
        )}
      </div>
      </div>
      <PosterDepthSheen sheenStrength={20} />
    </div>
  </div>
)
}