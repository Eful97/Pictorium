"use client"

import React, { useEffect, useRef, useState } from "react"
import { Check, Trash2, Maximize2, Folder, RectangleHorizontal, RectangleVertical, MoreHorizontal } from "lucide-react"
import { posterUrl } from "@/lib/utils"
import type { Mapping } from "@/lib/types"
import { effectiveMappingForShape } from "@/lib/types"
import { PosterDepthEdge, PosterDepthSheen } from "@/components/PosterDepthGlow"

export interface TileHandlers {
  select: (key: string) => void
  open: (m: Mapping) => void
  quickView: (m: Mapping, tileEl: HTMLElement | null) => void
  remove: (m: Mapping) => void
  confirmRemove: (m: Mapping) => void
  cancelRemove: () => void
  toggleShape: (m: Mapping) => void
}

type T = (key: string, params?: Record<string, string | number>) => string

export function tileTypeLabel(m: Mapping, t: T) {
  return m.mediaType === "movie"
    ? t("ui.movie")
    : (m.genreName || "").toLowerCase().includes("anim")
      ? t("ui.filterAnime")
      : t("ui.tvSeries")
}

/**
 * Immagine del poster salvato (base del formato primario + logo overlay).
 * Condivisa da griglia e coverflow: stessa base, stesso fallback, mai cicli.
 */
export function TilePoster({ mapping: m, imgClassName = "" }: { mapping: Mapping; imgClassName?: string }) {
  // Dual-format: la tile mostra la base del formato primario (backdrop in
  // landscape con fallback al poster) e il tuning effettivo di quel formato.
  const isLandscape = m.posterShape === "landscape"
  const eff = effectiveMappingForShape(m, isLandscape ? "landscape" : "poster")
  // Logo identity per shape (portrait flat / landscape profile).
  const effLogoPath = eff?.logoDisabled === true ? null : (eff?.logoPath ?? null)
  // Per-format independent base (portrait from customPosterUrl, landscape
  // from customBackdropUrl — like the renderer).
  const customBase = isLandscape
    ? (m.customBackdropUrl?.trim() ? m.customBackdropUrl.trim() : null)
    : (m.customPosterUrl?.trim() ? m.customPosterUrl.trim() : null)
  const fallbackSrc = m.posterPath ? posterUrl(m.posterPath, isLandscape ? "w500" : "w342") : null
  const [customFailed, setCustomFailed] = useState(false)
  // When the poster, backdrop, or URL changes the error resets: the new image retries.
  useEffect(() => {
    setCustomFailed(false)
  }, [customBase, m.posterPath, m.backdropPath])
  const shapeFallbackSrc = isLandscape
    ? (m.backdropPath ? posterUrl(m.backdropPath, "w780") : fallbackSrc)
    : fallbackSrc
  const displaySrc = (customBase && !customFailed ? customBase : null) ?? shapeFallbackSrc

  return (
    <>
      {displaySrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL
        <img
          src={displaySrc}
          alt={m.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`w-full h-full object-cover ${imgClassName}`}
          onError={(e) => {
            // Unloadable custom → one fallback to the shape's TMDB base;
            // never loops (customFailed stays true until the URL changes).
            if (customBase && !customFailed && shapeFallbackSrc && displaySrc === customBase) {
              setCustomFailed(true)
              return
            }
            ;(e.target as HTMLImageElement).style.display = "none"
            ;(e.target as HTMLImageElement).parentElement?.classList.add("show-fallback")
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-800/50 to-zinc-900/80">
          <span className="text-2xl font-semibold text-zinc-600">{m.title?.charAt(0)?.toUpperCase() || "?"}</span>
        </div>
      )}
      {effLogoPath && (
        <div
          className="absolute inset-x-0 bottom-[7.33%] flex items-center justify-center pointer-events-none"
          style={{ transform: `translate(${eff?.logoOffsetX ?? 0}%, ${-(eff?.logoOffsetY ?? 0)}%)` }}
        >
          <div style={{ width: `${eff?.logoScale ?? 75}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
            <img
              src={posterUrl(effLogoPath, "w300")}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="w-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
              style={{ objectFit: "contain" }}
            />
          </div>
        </div>
      )}
    </>
  )
}

interface MoodBoardTileProps {
  mapping: Mapping
  idx: number
  selectMode: boolean
  isSelected: boolean
  confirming?: boolean
  handlers: TileHandlers
  collectionCount?: number
  t: T
}

export const MoodBoardTile = React.memo(function MoodBoardTile({
  mapping: m,
  idx,
  selectMode,
  isSelected,
  confirming = false,
  handlers,
  collectionCount = 0,
  t,
}: MoodBoardTileProps) {
  const key = `${m.mediaType}:${m.tmdbId}`
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const year = (m.releaseDate || m.firstAirDate || "").slice(0, 4)
  const typeLabel = tileTypeLabel(m, t)
  const isLandscape = m.posterShape === "landscape"
  const isDual = !!(m.posterPath && m.backdropPath)
  const eff = effectiveMappingForShape(m, isLandscape ? "landscape" : "poster")
  const hasLogo = eff?.logoDisabled !== true && !!eff?.logoPath

  // Menu ⋯: chiusura su click esterno / Esc.
  useEffect(() => {
    if (!menuOpen) return
    const down = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false) }
    document.addEventListener("mousedown", down)
    document.addEventListener("keydown", key)
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key) }
  }, [menuOpen])

  const menuAction = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    fn()
  }
  const itemCls = "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer"

  return (
    <div
      data-poster-tile
      // Stagger solo alle prime tile; tile-cv salta paint/layout fuori schermo.
      className={`group relative ${idx < 12 ? "animate-stagger-in tile-cv" : "tile-cv"}`}
      style={idx < 12 ? { animationDelay: `${Math.min(idx * 30, 300)}ms` } : undefined}
    >
      <div
        ref={cardRef}
        onClick={() => { if (selectMode) handlers.select(key); else handlers.open(m) }}
        role="button"
        tabIndex={0}
        aria-label={`${m.title} — ${hasLogo ? t("ui.posterWithLogo") : t("ui.cleanPoster")} — ${typeLabel}`}
        aria-pressed={selectMode && isSelected}
        onKeyDown={(e) => {
          if (e.key === "Escape" && confirming) {
            e.stopPropagation()
            handlers.cancelRemove()
            return
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (selectMode) handlers.select(key); else handlers.open(m)
          }
        }}
        className={`surface-card relative z-10 rounded-xl overflow-hidden transition duration-300 ease-out w-full border border-white/10 shadow-lg group-hover:-translate-y-1 group-hover:shadow-[0_22px_48px_rgba(0,0,0,0.5),0_0_26px_rgb(var(--accent-rgb)/0.14)] group-hover:border-white/20 cursor-pointer ${
          selectMode && isSelected ? "ring-2 ring-accent-orange/60 border-accent-orange/70" : ""
        }`}
      >
        <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
        <div className={`relative z-[1] ${isLandscape ? "aspect-video" : "aspect-[2/3]"} bg-surface/80 overflow-hidden`}>
          <TilePoster mapping={m} imgClassName="transition-transform duration-500 ease-out group-hover:scale-[1.05]" />

          {/* Inline delete confirm: overlay locale alla tile. */}
          {!selectMode && confirming && (
            <div
              role="alertdialog"
              aria-label={t("ui.confirmDelete")}
              aria-live="assertive"
              onClick={(e) => { e.stopPropagation(); handlers.cancelRemove() }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85 p-3 text-center animate-fade-scale-in"
            >
              <p className="text-xs font-semibold text-zinc-100 leading-snug line-clamp-2">{t("ui.confirmDelete")}</p>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  autoFocus
                  onClick={() => handlers.confirmRemove(m)}
                  className="min-h-[36px] px-3.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 active:scale-95 transition cursor-pointer"
                >
                  {t("ui.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => handlers.cancelRemove()}
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
        <PosterDepthSheen sheenStrength={20} />
      </div>

      {/* Menu ⋯ fuori dalla card (overflow-hidden): azioni secondarie raccolte. */}
      {!selectMode && !confirming && (
        <div ref={menuRef} className="absolute top-2 right-2 z-30">
          <button
            type="button"
            aria-label={t("ui.moreActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
            onKeyDown={(e) => e.stopPropagation()}
            className={`w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white/90 hover:bg-black/80 active:scale-90 transition duration-200 cursor-pointer touch-manipulation group-hover:-translate-y-1 ${
              menuOpen ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1.5 w-48 rounded-xl p-1 bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/60 animate-fade-scale-in origin-top-right">
              <button type="button" role="menuitem" className={itemCls} onClick={menuAction(() => handlers.quickView(m, cardRef.current))}>
                <Maximize2 className="w-3.5 h-3.5 text-zinc-400" />{t("ui.quickView")}
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={menuAction(() => handlers.quickView(m, cardRef.current))}>
                <Folder className="w-3.5 h-3.5 text-zinc-400" />{t("ui.collections")}
                {collectionCount > 0 && <span className="ml-auto text-[10px] tabular-nums text-zinc-400">{collectionCount}</span>}
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={menuAction(() => handlers.toggleShape(m))}>
                {isLandscape ? <RectangleVertical className="w-3.5 h-3.5 text-zinc-400" /> : <RectangleHorizontal className="w-3.5 h-3.5 text-zinc-400" />}
                {isLandscape ? t("ui.setAsPortrait") : t("ui.setAsLandscape")}
              </button>
              <div className="h-px bg-white/[0.07] my-1" />
              <button type="button" role="menuitem" className={`${itemCls} !text-red-300 hover:!bg-red-500/15`} onClick={menuAction(() => handlers.remove(m))}>
                <Trash2 className="w-3.5 h-3.5" />{t("ui.delete")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Didascalia sotto la card: il poster resta pulito. */}
      <div className="mt-2 px-0.5 min-w-0">
        <p className="text-[13px] font-medium text-foreground truncate">{m.title}</p>
        <p className="text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
          {year && <><span className="tabular-nums">{year}</span><span aria-hidden="true">·</span></>}
          <span>{typeLabel}</span>
          {isDual && <span className="w-1.5 h-1.5 rounded-full bg-accent-orange" title="DUAL" aria-label="DUAL" />}
          {collectionCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-0.5 tabular-nums"><Folder className="w-3 h-3" />{collectionCount}</span>
          )}
        </p>
      </div>
    </div>
  )
})
