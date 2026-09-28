"use client"

function BadgePreview({ style, accentColor }: { style: string; accentColor?: string | null }) {
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
            <BadgePreview style={s} accentColor={accentColor} />
            <span className="text-[10px] font-semibold leading-tight truncate max-w-full">
              {s === "shadow" ? t("ui.shadow") : s === "pill" ? t("ui.pill") : s === "bar" ? t("ui.bar") : s === "default" ? t("ui.bsDefault") : s === "colored" ? t("ui.colored") : s === "bordo" ? t("ui.bordo") : s === "vetro" ? t("ui.vetro") : s === "minimal" ? t("ui.minimal") : s === "netflix" ? t("ui.netflix") : s === "standard" ? t("ui.qbsStandard") : s === "mono" ? t("ui.qbsMono") : s === "color" ? t("ui.qbsColor") : s}
            </span>
          </button>
        )
      })}
    </div>
  )
}
