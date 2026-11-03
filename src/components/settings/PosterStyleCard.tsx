"use client"

import { Check } from "lucide-react"
import { useAuthenticatedPreviewUrl } from "@/lib/useAuthenticatedPreview"

export interface PosterStyleOption {
  id: string
  title: string
  desc: string
  active: boolean
  onApply: () => void
  /** Optional REAL poster thumbnail URL (existing /api/poster builder).
   *  Absent = text-only card (legacy callers). Never a fake CSS/SVG poster. */
  thumbnailUrl?: string | null
}

/** Thumbnail canvas shape: portrait = 2:3, landscape = 16:9, always contained (no crop). */
export type PosterStyleThumbnailShape = "portrait" | "landscape"

/**
 * Real thumbnail, loaded with the preview credentials when the URL needs them
 * (plain `<img>` cannot send headers → shared instances downgraded the demo).
 * A hook per rendered card: the hook cannot run inside the options map.
 */
function StyleThumbnail({ url }: { url: string }) {
  const src = useAuthenticatedPreviewUrl(url)
  if (!src) return null
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={(e) => e.currentTarget.classList.add("opacity-0")}
      className="h-full w-full object-contain"
    />
  )
}

/**
 * PosterStyleCard — preset-first builtin selection for the Badge tab.
 * Presentational only: options reuse the caller-owned apply/highlight.
 * No live thumbnails; the DefaultsPosterPreview beside it shows the result.
 *
 * Compact gallery mode (Preset tab) bounds the real-poster thumbnails to a
 * small centered frame (portrait ~64–96px, landscape wider at an equal
 * compact 16:9 footprint, images contained, never cropped) so six looks fit
 * without giant empty space. Absent/false = legacy appearance unchanged
 * (text-only callers render no frame at all).
 */
export function PosterStyleCard({
  title,
  desc,
  note,
  options,
  thumbnailShape = "portrait",
  showBadge = true,
  compact = false,
}: {
  title: string
  desc: string
  note: string
  options: PosterStyleOption[]
  thumbnailShape?: PosterStyleThumbnailShape
  /** Hide the "1-click" badge for draft flows (no immediate save). Default legacy unchanged. */
  showBadge?: boolean
  /** Compact bounded thumbnails for the Preset gallery. Default legacy unchanged. */
  compact?: boolean
}) {
  const landscape = thumbnailShape === "landscape"
  // Compact frames stay measurably smaller than the legacy full-card-width
  // frame: bounded responsive widths + the same 2:3/16:9 aspect, centered
  // above the names, with max-w-full so narrow phones never overflow.
  const frameClass = compact
    ? `mx-auto max-w-full shrink-0 rounded-lg border border-white/10 bg-zinc-950/80 mb-1.5 overflow-hidden ${
        landscape ? "w-28 sm:w-36 lg:w-40 aspect-video" : "w-16 sm:w-20 lg:w-24 aspect-[2/3]"
      }`
    : `block w-full rounded-lg border border-white/10 bg-zinc-950/80 mb-1.5 overflow-hidden ${
        landscape ? "aspect-video" : "aspect-[2/3]"
      }`
  return (
    <section aria-label={title} data-testid="poster-style-cards" className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-zinc-200">{title}</span>
        {showBadge && <span className="text-[10px] text-zinc-400 font-mono">1-click</span>}
      </div>
      <p className="text-[11px] text-zinc-400 -mt-1">{desc}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-0.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            data-testid={`poster-style-${opt.id}`}
            onClick={opt.onApply}
            aria-pressed={opt.active}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              compact ? "min-h-[44px]" : ""
            } ${
              opt.active
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            {compact || opt.thumbnailUrl ? (
              <span
                aria-hidden="true"
                className={frameClass}
              >
                {opt.thumbnailUrl ? <StyleThumbnail url={opt.thumbnailUrl} /> : null}
              </span>
            ) : null}
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{opt.title}</span>
              {opt.active && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{opt.desc}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500 italic leading-snug pt-0.5">{note}</p>
    </section>
  )
}
