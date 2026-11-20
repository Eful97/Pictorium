"use client"

import { QUALITY_ANCHORS, type QualityAnchor } from "@/lib/badge-anchor"
import { useT } from "@/lib/contexts/TranslationContext"

const GLYPH: Record<Exclude<QualityAnchor, "auto">, string> = { tl: "↖", tr: "↗" }
const KEY = { auto: "ui.auto", tl: "ui.logoAnchorTL", tr: "ui.logoAnchorTR" } as const

/**
 * Selettore del lato del badge qualità (Auto / alto-sx / alto-dx). Solo UI:
 * lo stato vive nel chiamante (per-titolo, default portrait o profilo
 * landscape). Non azzera gli offset: l'ancora tiene la STESSA geometria base
 * dell'auto (stessa quota e margine), cambia solo il lato.
 */
export function QualityAnchorSelector({ value, onChange, testId = "quality-anchor-group" }: {
  value: QualityAnchor | null | undefined
  onChange: (v: QualityAnchor) => void
  testId?: string
}) {
  const { t } = useT()
  const current = value ?? "auto"
  return (
    <div className="space-y-1.5 pt-1" title={t("ui.qualityAnchor")} data-testid={testId}>
      <span className="text-[11px] text-muted font-medium block">{t("ui.qualityAnchor")}</span>
      <div className="flex gap-1">
        {QUALITY_ANCHORS.map((a) => (
          <button key={a} type="button" title={t(KEY[a])} aria-label={t(KEY[a])} aria-pressed={current === a} data-testid={`quality-anchor-${a}`}
            onClick={() => onChange(a)}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition duration-150 cursor-pointer ${current === a ? "bg-white/20 text-foreground shadow-sm" : "bg-white/5 text-muted hover:bg-white/10"}`}>
            {a === "auto" ? t("ui.auto") : GLYPH[a]}
          </button>
        ))}
      </div>
    </div>
  )
}
