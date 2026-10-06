"use client"

import { useId } from "react"
import { textColorForBg } from "@/lib/accent-color"

function BadgePreview({ style, accentColor }: { style: string; accentColor?: string | null }) {
  const maskId = useId().replace(/:/g, "")
  const base = "inline-flex items-center justify-center text-[10px] font-black leading-none w-7 h-4 rounded select-none"
  const ac = accentColor || "#fb923c"
  switch (style) {
    case "shadow":
      return <span className={`${base} bg-transparent text-white`} style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7), 0 0 6px rgba(0,0,0,0.4)" }}>Aa</span>
    case "pill":
      return <span className={`${base} text-black`} style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.66) 62%, rgba(255,255,255,0.50) 100%)", padding: "0 3px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)" }}>Aa</span>
    case "bar":
      return <span className={`${base} text-white w-7`} style={{ background: "rgba(255,255,255,0.12)", borderRadius: 1 }}>Aa</span>
    case "colored":
      return <span className={`${base} text-black font-black`} style={{ background: ac }}>Aa</span>
    case "bordo":
      return <span className={`${base} text-white`} style={{ border: "1.5px solid rgba(255,255,255,0.6)", borderRadius: 3, background: "rgba(255,255,255,0.18)", boxShadow: "0 0 4px rgba(255,255,255,0.35)" }}>Aa</span>
    case "vetro":
      return <span className={`${base} text-white`} style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)" }}>Aa</span>
    case "minimal":
      return <span className={`${base} bg-transparent text-white font-medium`} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>A|a</span>
    case "netflix":
      return <span className={`${base} text-white font-black`} style={{ background: "rgba(255,255,255,0.25)", borderRadius: "2px 2px 0 0" }}>TOP</span>
    case "corner":
      return <span className={`${base} font-black`} style={{ background: ac, color: textColorForBg(ac), borderRadius: 9999, padding: "0 3px", boxShadow: "0 2px 3px rgba(0,0,0,0.6)" }}>Aa</span>
    case "number":
      // Big standalone numeral like the poster rank (white-to-silver
      // gradient ink with a soft shadow, no plate): gradient-clipped text.
      return <span className={`${base} font-black`} style={{ background: "linear-gradient(180deg, #ffffff 0%, #A8ACB4 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))", fontSize: 13 }}>1</span>
    case "default":
      return <span className={`${base} text-white/70`}>Aa</span>
    case "mono":
      return (
        <span className={`${base} bg-transparent`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stesso SVG servito al server */}
          <img src="/quality-badges/mono/4k-label-icon.svg" alt="mono" className="w-7 h-4 object-contain brightness-0 invert drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
        </span>
      )
    case "color":
      return (
        <span className={`${base} bg-transparent`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stesso SVG servito al server */}
          <img src="/quality-badges/color/4k-label-color-icon.svg" alt="color" className="w-7 h-4 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
        </span>
      )
    case "knockout":
      // Static cutout swatch (NOT the poster renderer): white tag with the
      // 4K glyphs knocked out via mask, like the real badge.
      return (
        <span className={`${base} bg-transparent`}>
          <svg viewBox="0 0 28 16" className="w-7 h-4" aria-hidden="true" focusable="false">
            <defs>
              <mask id={`${maskId}-ko`}>
                <rect x="0" y="0" width="28" height="16" fill="#ffffff" />
                <text x="14" y="8.5" textAnchor="middle" dominantBaseline="central" fontFamily="Inter, sans-serif" fontWeight={900} fontSize="12" fill="#000000">4K</text>
              </mask>
            </defs>
            <rect x="0" y="0" width="28" height="16" rx="4" fill="#ffffff" mask={`url(#${maskId}-ko)`} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))" }} />
          </svg>
        </span>
      )
    default:
      return <span className={`${base} text-white/50`}>~</span>
  }
}

export function BadgeStyleSelector<S extends string>({
  value,
  options,
  onChange,
  t,
  accentColor,
  disabled,
}: {
  value: S
  options: readonly S[]
  onChange: (v: S) => void
  t: (k: string) => string
  accentColor?: string | null
  disabled?: readonly S[]
}) {
  // Colonne esatte per conteggio (classi letterali: Tailwind le genera solo se scritte per esteso):
  // 5 opzioni in 6 colonne lascerebbero un buco a destra e pulsanti di larghezza
  // diversa dalla riga da 7 — ogni riga riempie la larghezza con i suoi pulsanti.
  const gridCols = options.length <= 3 ? "grid-cols-3" : options.length <= 5 ? "grid-cols-3 sm:grid-cols-5" : options.length <= 6 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-7"
  return (
    <div className={`grid ${gridCols} gap-1.5 w-full`}>
      {options.map((s) => {
        const isActive = value === s
        const isDisabled = disabled?.includes(s) ?? false
        return (
          <button
            key={s}
            type="button"
            onClick={() => !isDisabled && onChange(s)}
            className={`flex flex-col items-center justify-center gap-0.5 w-full py-1.5 px-1 rounded-lg border transition-all duration-150 ${
              isDisabled
                ? "bg-white/5 text-zinc-600 cursor-not-allowed opacity-50 border-transparent"
                : isActive
                  ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"
            }`}
          >
            <span className="badge-style-preview inline-flex items-center justify-center rounded-md">
              <BadgePreview style={s} accentColor={accentColor} />
            </span>
            <span className="text-[10px] font-semibold leading-tight truncate max-w-full">
              {s === "shadow" ? t("ui.shadow") : s === "pill" ? t("ui.pill") : s === "bar" ? t("ui.bar") : s === "default" ? t("ui.bsDefault") : s === "colored" ? t("ui.colored") : s === "bordo" ? t("ui.bordo") : s === "vetro" ? t("ui.vetro") : s === "minimal" ? t("ui.minimal") : s === "netflix" ? t("ui.netflix") : s === "corner" ? t("ui.corner") : s === "number" ? t("ui.number") : s === "standard" ? t("ui.qbsStandard") : s === "mono" ? t("ui.qbsMono") : s === "color" ? t("ui.qbsColor") : s === "knockout" ? t("ui.qbsKnockout") : s}
            </span>
          </button>
        )
      })}
    </div>
  )
}
