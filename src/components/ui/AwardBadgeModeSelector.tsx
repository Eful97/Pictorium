"use client"

import type { AwardBadgeMode } from "@/lib/badge-styles"

/**
 * Two-button award mode selector (text badge vs bundled logo), same
 * button chrome as `BadgeStyleSelector`: preview on top, label below.
 * Previews are honest miniatures — the badge button shows the historic
 * light satin pill, the logo button the real bundled Oscar mark
 * (`public/awards/oscar.svg`) on the anthracite plate with its caption.
 */
export function AwardBadgeModeSelector({
  value,
  onChange,
  t,
}: {
  value: AwardBadgeMode
  onChange: (v: AwardBadgeMode) => void
  t: (k: string) => string
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 w-full">
      {([
        { id: "badge", label: t("ui.awardModeBadge") },
        { id: "logo", label: t("ui.awardModeLogo") },
      ] as const).map((opt) => {
        const isActive = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.id)}
            className={`flex flex-col items-center justify-center gap-0.5 w-full py-1.5 px-1 rounded-lg border transition-all duration-150 ${
              isActive
                ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"
            }`}
          >
            {opt.id === "badge" ? (
              <span
                className="inline-flex items-center justify-center h-6 px-1.5 rounded-full text-[7px] font-bold leading-none text-black select-none"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.66) 62%, rgba(255,255,255,0.50) 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)",
                }}
              >
                Oscar
              </span>
            ) : (
              <span
                className="inline-flex flex-col items-center justify-center h-6 px-2 rounded-full select-none"
                style={{
                  background: "rgba(24,24,27,0.88)",
                  border: "1px solid rgba(255,255,255,0.20)",
                  boxShadow: "0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- bundled award mark, same asset the poster renders */}
                <img src="/awards/oscar.svg" alt="" className="w-2.5 h-2.5 object-contain" />
                <span className="text-[6px] font-bold leading-tight text-white/95">Oscar</span>
              </span>
            )}
            <span className="text-[10px] font-semibold leading-tight truncate max-w-full">
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
