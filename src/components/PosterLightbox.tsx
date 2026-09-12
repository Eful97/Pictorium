"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { X, Star, ExternalLink, Maximize2, Check } from "lucide-react"
import type { Mapping } from "@/lib/types"
import type { PosterCollection } from "@/lib/useCollections"

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

interface PosterLightboxProps {
  lightbox: { mapping: Mapping; rect: DOMRect } | null
  onClose: () => void
  posterUrlFn: (path: string, size?: string) => string
  t: (key: string, params?: Record<string, string | number>) => string
  collections?: PosterCollection[]
  onAddToCollection?: (collectionId: string, posterKey: string) => void
  onRemoveFromCollection?: (collectionId: string, posterKey: string) => void
  lang?: string
  onOpenEditor?: () => void
}

export function PosterLightbox({
  lightbox,
  onClose,
  posterUrlFn,
  t,
  collections,
  onAddToCollection,
  onRemoveFromCollection,
  lang,
  onOpenEditor,
}: PosterLightboxProps) {
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mapping = lightbox?.mapping ?? null
  const rect = lightbox?.rect ?? null
  const posterKey = mapping ? `${mapping.mediaType}:${mapping.tmdbId}` : null
  const mediaSrc = imgFailed
    ? null
    : (mapping?.posterPath ? posterUrlFn(mapping.posterPath, "w500") : null)

  // Start animation on mount
  useEffect(() => {
    if (!mapping) return
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMounted(true))
    })
    return () => cancelAnimationFrame(raf)
  }, [mapping])

  // Reset del fallback immagine quando cambia il poster
  useEffect(() => {
    setImgFailed(false)
  }, [mapping])

  // Set transform-origin on the card once measured
  useEffect(() => {
    if (!mounted || !cardRef.current || !rect) return
    const cardRect = cardRef.current.getBoundingClientRect()
    const tileCenterX = rect.left + rect.width / 2
    const tileCenterY = rect.top + rect.height / 2
    const originX = tileCenterX - cardRect.left
    const originY = tileCenterY - cardRect.top
    cardRef.current.style.transformOrigin = `${originX}px ${originY}px`
  }, [mounted, rect])

  const handleClose = useCallback(() => {
    setClosing(true)
    // 300ms = durata dell'exit della card (transition-all duration-300):
    // smontare prima tagliava l'animazione a metà (era 150ms).
    closeTimerRef.current = setTimeout(() => {
      setClosing(false)
      setMounted(false)
      onClose()
      closeTimerRef.current = null
    }, 300)
  }, [onClose])

  // Keyboard handler: Escape chiude, Tab resta intrappolato nel dialog
  useEffect(() => {
    if (!mapping) return
    const panel = cardRef.current
    document.body.style.overflow = "hidden"
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose()
        return
      }
      if (e.key !== "Tab" || !panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => {
      document.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [mapping, handleClose])

  // Cleanup del timer di chiusura su unmount: evita setState su componente smontato
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  if (!mapping) return null

  const year = (mapping.releaseDate || mapping.firstAirDate || "").slice(0, 4)
  const typeLabel = mapping.mediaType === "movie"
    ? t("ui.movie")
    : (mapping.genreName || "").toLowerCase().includes("anim")
      ? t("ui.filterAnime")
      : t("ui.tvSeries")
  const vote = mapping.voteAverage != null ? mapping.voteAverage.toFixed(1) : null

  const isInCol = (colId: string) =>
    collections?.some((c) => c.id === colId && c.posterIds.includes(posterKey!)) ?? false

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/30" : mounted ? "bg-black/50 backdrop-blur-sm" : "bg-black/0"
      }`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${mapping.title} ${t("ui.quickView")}`}
    >
      {/* Card — anima dalla posizione del tile al centro */}
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-xs sm:max-w-sm rounded-2xl surface-card overflow-hidden shadow-2xl shadow-black/60 transition-all duration-300 ${
          mounted && !closing
            ? "opacity-100 scale-100"
            : closing
              ? "opacity-0 scale-75"
              : "opacity-0 scale-[0.3]"
        }`}
        style={{
          transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* Close button */}
        <button type="button"
          autoFocus
          onClick={handleClose}
          aria-label={t("ui.cancel")}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:bg-black/70 hover:text-white transition-all duration-200 active:scale-90 z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Poster area */}
        <div className="aspect-[2/3] bg-surface relative overflow-hidden">
          {mediaSrc ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
              <img
                src={mediaSrc}
                alt={mapping.title}
                className="w-full h-full object-cover"
                onError={() => { if (!imgFailed) setImgFailed(true) }}
              />
              {/* Logo overlay */}
              {mapping.logoPath && (
                <div
                  className="absolute inset-x-0 bottom-[16%] flex items-center justify-center pointer-events-none"
                  style={{
                    transform: `translate(${mapping.logoOffsetX ?? 0}%, ${-(mapping.logoOffsetY ?? 0)}%)`,
                  }}
                >
                  <div style={{ width: `${mapping.logoScale ?? 75}%` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
                    <img
                      src={posterUrlFn(mapping.logoPath, "w500")}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)]"
                      style={{ objectFit: "contain" }}
                    />
                  </div>
                </div>
              )}
              {/* Gradient overlay for text readability */}
              <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-surface">
              <ExternalLink className="w-12 h-12 text-zinc-600" />
            </div>
          )}

          {/* Title + metadata sovrapposti al poster */}
          <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
            <p className="text-base font-bold text-white drop-shadow-lg leading-tight">{mapping.title}</p>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
              {year && <span className="text-xs font-medium text-zinc-200 drop-shadow">{year}</span>}
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/20 text-white font-semibold backdrop-blur-sm">
                {typeLabel}
              </span>
              {vote && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-400 drop-shadow">
                  <Star className="w-3 h-3 fill-amber-400" />
                  {vote}
                </span>
              )}
              {mapping.updatedAt && (
                <span className="text-[10px] font-medium text-zinc-400 drop-shadow">
                  {t("ui.savedOn")} {new Date(mapping.updatedAt).toLocaleDateString(lang)}
                </span>
              )}
            </div>
          </div>

          {/* Poster icon badge */}
          {mediaSrc && (
            <div className="absolute top-3 left-3 w-7 h-7 rounded-lg bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <Maximize2 className="w-3.5 h-3.5 text-white/60" />
            </div>
          )}
        </div>

        {/* Collections section */}
        {posterKey && collections && (
          <div className="px-4 py-3 border-t border-white/5">
            <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
              {t("ui.collections")}
            </p>
            {collections.length === 0 ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">{t("ui.noCollections")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {collections.map((col) => {
                  const checked = isInCol(col.id)
                return (
                  <button type="button"
                    key={col.id}
                    onClick={() => {
                      if (checked) {
                        onRemoveFromCollection?.(col.id, posterKey)
                      } else {
                        onAddToCollection?.(col.id, posterKey)
                      }
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 active:scale-95 ${
                      checked
                        ? "bg-accent-orange/15 text-accent-orange border border-accent-orange/25"
                        : "bg-white/5 text-muted hover:text-zinc-300 border border-white/5 hover:border-white/10"
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5" />}
                    <span className="truncate max-w-24">{col.name}</span>
                  </button>
                )
              })}
            </div>
            )}
          </div>
        )}

        {/* Actions — un solo CTA primario: apri nell'editor */}
        {onOpenEditor && (
          <div className="px-4 py-3 border-t border-white/5 flex items-center gap-2">
            <button type="button" onClick={() => { handleClose(); onOpenEditor() }} className="btn-primary flex-1 px-3 py-2 text-xs font-semibold whitespace-nowrap">
              {t("ui.openInEditor")}
            </button>
            <button type="button" onClick={handleClose} className="btn-ghost px-3 py-2 text-xs font-medium whitespace-nowrap">
              {t("ui.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
