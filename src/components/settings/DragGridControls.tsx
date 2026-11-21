"use client"

import { Grid3x3 } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { dragGridLinePcts } from "@/lib/drag-snap"

/** Lines that read as the strong guides: poster centre and the thirds. */
function isMajorLine(pct: number): boolean {
  return pct === 50 || Math.abs(pct - 100 / 3) < 1e-9 || Math.abs(pct - 200 / 3) < 1e-9
}

/**
 * Alignment grid drawn over the poster: every 5% plus thirds and centre.
 * Percent viewBox, so it scales with the preview. Neutral mid-grey with two
 * alpha levels reads on both light and dark themes. Never reaches the render.
 */
export function DragGridOverlay() {
  return (
    <svg
      data-testid="badge-drag-grid-overlay"
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      {dragGridLinePcts().map((pct) => {
        const stroke = isMajorLine(pct) ? "rgba(120,120,120,0.6)" : "rgba(120,120,120,0.25)"
        return (
          <g key={pct}>
            <line x1={pct} y1={0} x2={pct} y2={100} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={pct} x2={100} y2={pct} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

/** Grid toggle: a real button with aria-pressed, keyboard focusable. */
export function DragGridToggle({
  enabled,
  onToggle,
  compact = false,
}: {
  enabled: boolean
  onToggle: () => void
  compact?: boolean
}) {
  const { t } = useT()
  return (
    <button
      type="button"
      data-testid="drag-grid-toggle"
      aria-pressed={enabled}
      aria-label={t("ui.dragGrid")}
      onClick={onToggle}
      className={`flex items-center gap-1 ${compact ? "min-h-[36px]" : "min-h-[44px]"} px-3 rounded-lg border text-xs font-semibold transition cursor-pointer active:scale-95 ${
        enabled
          ? "bg-accent-orange/20 text-accent-orange border-accent-orange/50"
          : "bg-white/10 text-zinc-100 border-white/20 hover:bg-white/20"
      }`}
    >
      <Grid3x3 className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{t("ui.dragGrid")}</span>
    </button>
  )
}
