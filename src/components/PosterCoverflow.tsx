"use client"

import React, { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { posterUrl } from "@/lib/utils"
import type { Mapping } from "@/lib/types"
import { TilePoster, tileTypeLabel } from "@/components/MoodBoardTile"

// Card renderizzate attorno all'attiva: il resto non è nel DOM, così
// centinaia di poster restano fluidi (solo transform, niente layout).
const WINDOW = 6

interface Props {
  items: Mapping[]
  onOpen: (m: Mapping) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function PosterCoverflow({ items, onOpen, t }: Props) {
  const [active, setActive] = useState(0)
  const [width, setWidth] = useState(1000)
  const stageRef = useRef<HTMLDivElement>(null)
  // Trascinamento live (mouse e touch): le card seguono il dito, poi si
  // agganciano al poster più vicino al rilascio.
  const drag = useRef<{ x: number; id: number; idx: number | null } | null>(null)
  const [dragDx, setDragDx] = useState(0)
  const n = items.length
  const hasItems = n > 0
  const cur = Math.min(active, Math.max(0, n - 1))
  const go = (i: number) => setActive(Math.max(0, Math.min(n - 1, i)))

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasItems])


  if (n === 0) return null
  const m = items[cur]
  // Spaziatura proporzionale allo stage: su mobile le card laterali si stringono.
  const gap = Math.min(200, width * 0.27)
  const step = gap * 0.42
  // Posizione continua durante il drag: px trascinati → poster.
  const unit = Math.max(50, gap * 0.55)
  const pos = Math.max(-0.4, Math.min(n - 0.6, cur - dragDx / unit))
  const dragging = dragDx !== 0
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (Math.abs(e.clientX - d.x) < 6) {
      // Tap/clic: sulla laterale la porta al centro, sull attiva apre l editor.
      setDragDx(0)
      if (d.idx === null) return
      if (d.idx === cur) onOpen(items[cur]); else go(d.idx)
      return
    }
    go(Math.round(pos))
    setDragDx(0)
  }
  const ambient = m.backdropPath || m.posterPath

  return (
    <div className="relative max-w-7xl mx-auto px-4">
      {ambient && (
        // Bagliore ambientale col colore del poster attivo (w92 sfocato: costo trascurabile).
        // eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL
        <img
          key={ambient}
          src={posterUrl(ambient, "w92")}
          alt=""
          aria-hidden="true"
          className="absolute inset-x-0 top-[15%] mx-auto w-1/2 h-1/2 object-cover blur-3xl opacity-20 saturate-150 pointer-events-none animate-fade-in"
        />
      )}
      <div
        ref={stageRef}
        role="listbox"
        aria-label={t("ui.viewCoverflow")}
        aria-activedescendant={`cf-${m.mediaType}-${m.tmdbId}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1) }
          else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1) }
          else if (e.key === "Home") { e.preventDefault(); go(0) }
          else if (e.key === "End") { e.preventDefault(); go(n - 1) }
          else if (e.key === "Enter") { e.preventDefault(); onOpen(m) }
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement
          if (target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return
          const card = target.closest<HTMLElement>("[data-cf-idx]")
          drag.current = { x: e.clientX, id: e.pointerId, idx: card ? Number(card.dataset.cfIdx) : null }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d && d.id === e.pointerId) setDragDx(e.clientX - d.x)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-[400px] md:h-[500px] outline-none select-none touch-pan-y cursor-grab active:cursor-grabbing [perspective:1200px] focus-visible:ring-1 focus-visible:ring-white/15 rounded-2xl"
      >
        {items.map((it, k) => {
          const o = k - pos
          if (Math.abs(o) > WINDOW) return null
          const a = Math.abs(o)
          const s = Math.sign(o)
          // Funzione continua dell offset: il drag interpola centro ↔ lati.
          const x = s * (a < 1 ? a * gap : gap + (a - 1) * step)
          const z = a < 1 ? 40 - a * 130 : -60 - a * 30
          const tr = `translateX(${x}px) translateZ(${z}px) rotateY(${-s * 50 * Math.min(1, a)}deg)`
          const isActive = k === Math.round(pos)
          const landscape = it.posterShape === "landscape"
          const year = (it.releaseDate || it.firstAirDate || "").slice(0, 4)
          return (
            <div
              key={`${it.mediaType}:${it.tmdbId}`}
              id={`cf-${it.mediaType}-${it.tmdbId}`}
              role="option"
              aria-selected={k === cur}
              data-cf-idx={k}
              className={`absolute left-1/2 top-[40%] ${landscape ? "w-[280px] md:w-[400px]" : "w-[170px] md:w-[230px]"}`}
              style={{
                transform: `translate(-50%, -50%) ${tr}`,
                zIndex: 100 - Math.round(a * 2),
                opacity: a > WINDOW - 1 ? WINDOW - a : 1,
                transition: dragging ? "none" : "transform 550ms cubic-bezier(.2,.8,.2,1), opacity 400ms",
              }}
            >
              <div
                className={`relative ${landscape ? "aspect-video" : "aspect-[2/3]"} rounded-xl overflow-hidden border bg-surface transition-[box-shadow,filter,border-color] duration-500 ${
                  isActive
                    ? "border-white/20 shadow-[0_30px_60px_rgba(0,0,0,0.6),0_0_40px_rgb(var(--accent-rgb)/0.18)]"
                    : "border-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.55)] brightness-[0.55] hover:brightness-75"
                }`}
              >
                <TilePoster mapping={it} />
              </div>
              {/* Didascalia solo sull'attiva (clic sull'attiva = apre l'editor). */}
              <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-4 w-[min(80vw,340px)] text-center transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <p className="text-base md:text-lg font-semibold text-foreground truncate">{it.title}</p>
                <p className="text-xs text-muted mt-0.5">{[year, tileTypeLabel(it, t)].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          )
        })}

        <button type="button" aria-label="←" onClick={() => go(cur - 1)} disabled={cur === 0} className="absolute left-0 md:left-2 top-[40%] -translate-y-1/2 z-[200] w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white flex items-center justify-center hover:bg-black/70 disabled:opacity-0 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button type="button" aria-label="→" onClick={() => go(cur + 1)} disabled={cur === n - 1} className="absolute right-0 md:right-2 top-[40%] -translate-y-1/2 z-[200] w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-white flex items-center justify-center hover:bg-black/70 disabled:opacity-0 transition">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

    </div>
  )
}
