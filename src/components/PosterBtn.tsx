"use client"

import React from "react"
import type { TMDBImage } from "@/lib/types"
import { posterUrl } from "@/lib/utils"
import { useT } from "@/lib/contexts/TranslationContext"
import { Check } from "lucide-react"

interface PosterBtnProps {
  img: TMDBImage
  active: boolean
  onSelect: (img: TMDBImage) => void
  title?: string
  staggerIndex?: number
  /** Miniatura orizzontale 16:9 (sfondi TMDB). */
  landscape?: boolean
  /** Tier dimensionale TMDB (default w154 da poster; w300 per i backdrop). */
  imgSize?: string
}

/**
 * Vero per i soli link asset diretti TPDb raw (`/api/assets/<id>` con
 * `/view` opzionale, host esatto): TPDb rifiuta con 403 le miniature
 * hotlinkate che inviano Referer, quindi il tile omette il Referer
 * (`referrerPolicy="no-referrer"`, normale privacy policy del browser).
 * Check client-safe minimale (mai importare `resolve-image.ts` nel client:
 * tira dentro fetch/dns/sharp server-only) — stesso gate esatto del server.
 */
const TPDB_DIRECT_ASSET_RE = /^\/api\/assets\/\d+\/view\/?$/
const TPDB_DIRECT_ASSET_BARE_RE = /^\/api\/assets\/\d+\/?$/

export function isTpdbDirectAssetSrc(src: string): boolean {
  let u: URL
  try {
    u = new URL(src.trim())
  } catch {
    return false
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false
  if (u.hostname.toLowerCase().replace(/\.$/, "") !== "theposterdb.com") return false
  return TPDB_DIRECT_ASSET_RE.test(u.pathname) || TPDB_DIRECT_ASSET_BARE_RE.test(u.pathname)
}

export const PosterBtn = React.memo(function PosterBtn({ img, active, onSelect, title, staggerIndex, landscape, imgSize = "w154" }: PosterBtnProps) {
  const { t } = useT()
  const src = posterUrl(img.file_path, imgSize)
  return (
    <button type="button"
      onClick={() => onSelect(img)}
      className={`poster-tile group relative w-full rounded-xl overflow-hidden transition-all duration-200 ease-out ${active ? "poster-tile-active scale-[1.02]" : ""}`}
      title={title || ""}
      style={staggerIndex !== undefined ? { animation: `fade-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${staggerIndex * 40}ms both` } : undefined}
    >
      <div className={`relative overflow-hidden ${landscape ? "aspect-video" : "aspect-[2/3]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy={isTpdbDirectAssetSrc(src) ? "no-referrer" : undefined} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        {active && (
          <>
            <div className="absolute inset-0 bg-accent-orange/10" />
            <div className="absolute top-1 right-1 w-4 h-4 bg-accent-orange rounded-full flex items-center justify-center shadow-lg shadow-accent-orange/40">
              <Check className="w-2.5 h-2.5 text-white" />
            </div>
            <span className="absolute bottom-0 left-0 right-0 text-[10px] font-semibold text-orange-100 text-center py-0.5 bg-accent-orange/25 backdrop-blur-sm">{t("ui.selected")}</span>
          </>
        )}
        {!active && <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-white/5 transition-opacity duration-300" />}
      </div>
      {title && <p className="text-xs text-muted truncate px-1 py-1 text-left group-hover:text-accent transition-colors">{title}</p>}
    </button>
  )
})
