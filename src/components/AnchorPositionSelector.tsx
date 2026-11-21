"use client"

import { useRef, useState, type HTMLAttributes, type KeyboardEvent } from "react"
import { isAnchorPosition, type AnchorChoice, type AnchorChoiceRel, type AnchorPosition } from "@/lib/badge-anchor"
import { useT } from "@/lib/contexts/TranslationContext"

/** Griglia 3×3 nell'ordine di lettura (riga alta, centro, riga bassa). */
const GRID: readonly (readonly AnchorPosition[])[] = [
  ["tl", "tc", "tr"],
  ["ml", "mc", "mr"],
  ["bl", "bc", "br"],
]
const FLAT: readonly AnchorPosition[] = GRID.flat()
/** Allineamento del marcatore dentro la sua cella (dove finisce il badge). */
const PLACE: Record<AnchorPosition, string> = {
  tl: "items-start justify-start", tc: "items-start justify-center", tr: "items-start justify-end",
  ml: "items-center justify-start", mc: "items-center justify-center", mr: "items-center justify-end",
  bl: "items-end justify-start", bc: "items-end justify-center", br: "items-end justify-end",
}
const KEY: Record<AnchorPosition, string> = {
  tl: "ui.anchorTL", tc: "ui.anchorTC", tr: "ui.anchorTR",
  ml: "ui.anchorML", mc: "ui.anchorMC", mr: "ui.anchorMR",
  bl: "ui.anchorBL", bc: "ui.anchorBC", br: "ui.anchorBR",
}
const STEP: Record<string, [number, number]> = {
  ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
}
const RELATIVE: readonly { pos: "above" | "below"; key: string }[] = [
  { pos: "above", key: "ui.anchorAboveLogo" },
  { pos: "below", key: "ui.anchorBelowLogo" },
]
const PILL = "px-2.5 py-1 rounded-full text-[11px] font-semibold transition duration-150 cursor-pointer border"
const PILL_ON = "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm"
const PILL_OFF = "bg-white/5 border-white/10 text-muted hover:bg-white/10 hover:text-foreground"

/**
 * Selettore unico d'ancora per tutti i badge: "Auto" + griglia 3×3 delle 9
 * posizioni fisse. Solo UI: lo stato vive nel chiamante. Un valore non valido
 * (es. legacy `top` di networkLogoPosition) non preme nulla. Frecce = focus
 * nella griglia (roving tabindex).
 */
// `V` è il tipo del setter del chiamante: i valori above/below compaiono solo con
// `logoRelative` (chiamanti netPos/qanc/banc/tanc/xanc), mai per lanc.
export function AnchorPositionSelector<V extends AnchorChoiceRel = AnchorChoice>({ value, onChange, label, testId, optionTestPrefix, previewAttrs, logoRelative }: {
  value: string | null | undefined
  onChange: (v: V) => void
  /** Chiave i18n dell'etichetta. */
  label: string
  testId: string
  /** Prefisso dei data-testid: `${prefix}-auto` e `${prefix}-${pos}`. */
  optionTestPrefix: string
  previewAttrs?: HTMLAttributes<HTMLDivElement>
  /** Mostra "Sopra il logo" / "Sotto il logo" (netPos, qanc, banc, tanc, xanc; non lanc). */
  logoRelative?: boolean
}) {
  const { t } = useT()
  const current = value ?? "auto"
  const pressedIdx = isAnchorPosition(value) ? FLAT.indexOf(value) : -1
  const [focusIdx, setFocusIdx] = useState(pressedIdx >= 0 ? pressedIdx : 0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const step = STEP[e.key]
    if (!step) return
    e.preventDefault()
    const r = Math.floor(idx / 3) + step[0]
    const c = (idx % 3) + step[1]
    if (r < 0 || r > 2 || c < 0 || c > 2) return
    const ni = r * 3 + c
    setFocusIdx(ni)
    refs.current[ni]?.focus()
  }

  const isAuto = current === "auto"
  return (
    <div className="space-y-2 pt-1" title={t(label)} data-testid={testId} {...previewAttrs}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted font-medium">{t(label)}</span>
        <button type="button" data-testid={`${optionTestPrefix}-auto`} title={t("ui.auto")} aria-label={t("ui.auto")}
          aria-pressed={isAuto} onClick={() => onChange("auto" as V)}
          className={`${PILL} ${isAuto ? PILL_ON : PILL_OFF}`}>
          {t("ui.auto")}
        </button>
      </div>
      {/* Mini-poster: ogni cella porta il suo marcatore nel punto reale del badge. */}
      <div role="group" aria-label={t(label)}
        className={`mx-auto grid grid-cols-3 grid-rows-3 gap-0.5 w-[6.5rem] aspect-[2/3] p-1.5 rounded-xl border bg-gradient-to-b from-white/[0.07] to-white/[0.02] transition duration-150 ${isAuto ? "border-white/10 opacity-80" : "border-white/20"}`}>
        {FLAT.map((pos, idx) => {
          const on = current === pos
          return (
            <button key={pos} ref={(el) => { refs.current[idx] = el }} type="button"
              data-testid={`${optionTestPrefix}-${pos}`} title={t(KEY[pos])} aria-label={t(KEY[pos])}
              aria-pressed={on} tabIndex={idx === focusIdx ? 0 : -1}
              onFocus={() => setFocusIdx(idx)} onKeyDown={(e) => move(e, idx)} onClick={() => onChange(pos as V)}
              className={`group flex ${PLACE[pos]} p-0.5 rounded-md cursor-pointer transition duration-150 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-orange`}>
              <span aria-hidden className={on
                ? "block w-5 h-2.5 rounded-[3px] bg-accent-orange shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                : "block w-1.5 h-1.5 rounded-full bg-white/30 transition-all duration-150 group-hover:w-3 group-hover:h-2 group-hover:rounded-[3px] group-hover:bg-white/60"} />
            </button>
          )
        })}
      </div>
      {logoRelative && (
        <div role="group" aria-label={t(label)} className="flex justify-center gap-1.5">
          {RELATIVE.map((r) => (
            <button key={r.pos} type="button" data-testid={`${optionTestPrefix}-${r.pos}`}
              title={t(r.key)} aria-label={t(r.key)} aria-pressed={current === r.pos}
              onClick={() => onChange(r.pos as V)}
              className={`${PILL} ${current === r.pos ? PILL_ON : PILL_OFF}`}>
              {t(r.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
