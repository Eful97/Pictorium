"use client"

import { BOTTOM_ANCHORS, type BottomAnchor } from "@/lib/badge-anchor"
import { useT } from "@/lib/contexts/TranslationContext"

const GLYPH: Record<Exclude<BottomAnchor, "auto">, string> = { bl: "↙", bc: "↓", br: "↘" }
const KEY = { auto: "ui.auto", bl: "ui.logoAnchorBL", bc: "ui.logoAnchorBC", br: "ui.logoAnchorBR" } as const

/**
 * Selettore del lato della fascia inferiore (genere, riga rating, riga rating
 * separati bottom): Auto / basso-sx / basso-centro / basso-dx. Solo UI: lo
 * stato vive nel chiamante. Cambia solo l'asse X, quindi gli offset restano
 * validi e NON si azzerano al cambio. La barra portrait full-width lo ignora.
 */
export function BottomAnchorSelector({ value, onChange, testId = "bottom-anchor-group" }: {
  value: BottomAnchor | null | undefined
  onChange: (v: BottomAnchor) => void
  testId?: string
}) {
  const { t } = useT()
  const current = value ?? "auto"
  return (
    <div className="space-y-1.5 pt-1" title={t("ui.bottomAnchor")} data-testid={testId}>
      <span className="text-[11px] text-muted font-medium block">{t("ui.bottomAnchor")}</span>
      <div className="flex gap-1">
        {BOTTOM_ANCHORS.map((a) => (
          <button key={a} type="button" title={t(KEY[a])} aria-label={t(KEY[a])} aria-pressed={current === a} data-testid={`bottom-anchor-${a}`}
            onClick={() => onChange(a)}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition duration-150 cursor-pointer ${current === a ? "bg-white/20 text-foreground shadow-sm" : "bg-white/5 text-muted hover:bg-white/10"}`}>
            {a === "auto" ? t("ui.auto") : GLYPH[a]}
          </button>
        ))}
      </div>
    </div>
  )
}
