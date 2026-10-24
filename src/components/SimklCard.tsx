"use client"

import React from "react"
import { posterUrl } from "@/lib/utils"
import { useT } from "@/lib/contexts/TranslationContext"
import { Check, Trash2 } from "lucide-react"
import { PosterDepthEdge, PosterDepthSheen } from "@/components/PosterDepthGlow"

export interface SimklCardItem {
  tmdbId?: number | null
  id?: number | null
  title?: string | null
  name?: string | null
  poster_path?: string | null
  posterPath?: string | null
  media_type?: string
  mediaType?: string
  rank?: number
  /** Selection chart country (streaming lists; built-in = null/default). */
  region?: string | null
}

interface SimklCardProps {
  items: SimklCardItem[]
  title: string
  totalCount?: number
  meta?: string[]
  onClick?: () => void
  onItemClick?: (item: SimklCardItem) => void
  savedKeys?: Set<string>
  className?: string
  /** Optional source icon (e.g. CatalogSourceBadge icon-only) beside the counter. */
  footerAdornment?: React.ReactNode
  /** Optional single-list remove action (trash button, footer right). */
  onRemove?: () => void
  /** Accessible label for the remove button. Defaults to t("ui.remove"). */
  removeLabel?: string
  /**
   * Optional discreet publication line rendered under the footer (per-card
   * Pictorium sync time or the honest unknown text, built by the caller).
   * Omitted = byte-identical legacy card (no extra DOM).
   */
  publication?: React.ReactNode
}

export function SimklCard({ items, title, totalCount, meta = [], onClick, onItemClick, savedKeys, className, footerAdornment, onRemove, removeLabel, publication }: SimklCardProps) {
  const { t } = useT()
  const displayItems = items.slice(0, 10)
  const isSingle = displayItems.length <= 2 && !className?.includes("simkl-list-card--fill")
  const count = totalCount ?? items.length
  const removeText = removeLabel ?? t("ui.remove")

  const imgSrc = (item: SimklCardItem) => {
    const path = item.poster_path || item.posterPath
    return path ? posterUrl(path, "w185") : ""
  }

  const handlePosterClick = (e: React.MouseEvent, item: SimklCardItem) => {
    e.stopPropagation()
    onItemClick?.(item)
  }

  return (
    <div
      className={`simkl-list-card relative${isSingle ? " simkl-list-card--single" : ""}${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      <div className="posters">
        {displayItems.map((item, idx) => {
          const src = imgSrc(item)
          const mediaType = item.media_type || item.mediaType || "movie"
          const tmdbId = item.tmdbId ?? item.id
          const itemKey = `${mediaType}:${tmdbId}`
          const isSaved = tmdbId && savedKeys?.has(itemKey)

          return (
            <div
              key={`${mediaType}:${tmdbId ?? "item"}-${idx}`}
              className="relative isolate shrink-0 overflow-hidden cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={(e) => handlePosterClick(e, item)}
              // Fix L31: le tile interne erano click-only (inaccessibili da
              // tastiera); ora Enter/Space attivano lo stesso handler.
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onItemClick?.(item)
                }
              }}
            >
              <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
              {/* h-full sul wrapper: senza altezza definita, l'h-full dell'img
                  collassa sul ratio intrinseco (115px × ratio) e i poster più
                  "quadrati" del 2:3 (es. Sesto Senso 836×1203) lasciano una
                  striscia vuota in fondo alla tile 170px. Con h-full l'img
                  riempie sempre e object-cover ritaglia simmetrico. */}
              <div className="relative z-[1] h-full">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote TMDB poster tiles (lazy, optimized by CDN)
                  <img
                    src={src}
                    alt={item.title ?? item.name ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="poster-placeholder w-full h-full" />
                )}
                {isSaved && (
                  <div
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg ring-1 ring-white/30 z-10"
                    title={t("ui.alreadyCustomized")}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </div>
              <PosterDepthSheen sheenStrength={20} />
            </div>
          )
        })}
      </div>
      <div className="info">
        <h3>
          <span className="truncate">{title}</span>
          <span className="grid-hint ml-2 shrink-0" title={t("ui.viewAll")}>⧉</span>
        </h3>
        <div className="meta flex items-center justify-between mt-2.5">
          {footerAdornment ? (
            <span className="flex items-center gap-1.5 min-w-0">
              {count > 0 && (
                <span className="counter-badge text-[11px] px-2 py-0.5 rounded-md font-medium bg-white/10 border border-white/10 text-zinc-300 backdrop-blur-sm">
                  {count} {count === 1 ? t("ui.itemOne") : t("ui.itemMany")}
                </span>
              )}
              {footerAdornment}
            </span>
          ) : (
            count > 0 && (
              <span className="counter-badge text-[11px] px-2 py-0.5 rounded-md font-medium bg-white/10 border border-white/10 text-zinc-300 backdrop-blur-sm">
                {count} {count === 1 ? t("ui.itemOne") : t("ui.itemMany")}
              </span>
            )
          )}
          {onRemove ? (
            <div className="flex items-center gap-2 ml-auto">
              {meta.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted">
                  {meta.map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </div>
              )}
              <button
                type="button"
                aria-label={removeText}
                title={removeText}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove()
                }}
                // The card root (div role=button) activates on Enter/Space:
                // stop propagation so keyboard use of the trash never opens
                // the list/editor. Native button activation is preserved
                // (no preventDefault here).
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation()
                  }
                }}
                className="inline-flex items-center justify-center min-w-10 min-h-10 p-1.5 rounded-lg border border-white/5 text-muted hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            meta.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted">
                {meta.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            )
          )}
        </div>
        {publication != null && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{publication}</p>
        )}
      </div>
    </div>
  )
}
