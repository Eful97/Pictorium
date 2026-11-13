"use client"

import { useT } from "@/lib/contexts/TranslationContext"

/**
 * Tri-state daily-rotation selector for episode thumbnails (per-title studio):
 * `null` = inherit the space default, `true`/`false` = explicit override.
 *
 * Controlled and presentation-only: the caller owns the draft (and persists it
 * with the same save as the still overrides), so the same widget can never
 * disagree with the editor state. Labels reuse the existing `ui.inherited`
 * key plus the Miniature on/off keys.
 */
const CARD_CLASS = "inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"

export interface ThumbnailRotationSelectorProps {
  /** Draft value: `null` = inherit, `true`/`false` = explicit override. */
  value: boolean | null
  onChange: (value: boolean | null) => void
}

export function ThumbnailRotationSelector({ value, onChange }: ThumbnailRotationSelectorProps) {
  const { t } = useT()
  const options = [
    { id: "inherit", value: null as boolean | null, labelKey: "ui.inherited" },
    { id: "on", value: true as boolean | null, labelKey: "ui.thumbnailRotationOn" },
    { id: "off", value: false as boolean | null, labelKey: "ui.thumbnailRotationOff" },
  ]
  return (
    <div role="group" aria-label={t("ui.thumbnailRotation")} className={CARD_CLASS}>
      <span className="px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
        {t("ui.thumbnailRotation")}
      </span>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`episode-rotation-${option.id}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-[28px] px-2 rounded-md text-[11px] font-semibold transition cursor-pointer active:scale-95 ${FOCUS_RING} ${
              selected
                ? "bg-accent-orange/20 border border-accent-orange/50 text-accent-orange"
                : "border border-transparent text-zinc-300 hover:bg-white/10"
            }`}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
