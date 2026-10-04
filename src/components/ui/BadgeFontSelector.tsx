"use client"

import { Barlow_Condensed, Oswald } from "next/font/google"
import { BADGE_FONTS, type BadgeFont } from "@/lib/badge-styles"

// Campioni visivi del selettore "Font dei badge": webfont caricate a build
// time da next/font (zero richieste remote a runtime e al render — il render
// poster usa i TTF locali in src/assets/fonts). Il font dell'interfaccia
// resta invariato: queste classi servono solo ai campioni "Aa".
const barlowSample = Barlow_Condensed({ subsets: ["latin"], weight: ["600"] })
const oswaldSample = Oswald({ subsets: ["latin"], weight: ["600"] })

const SAMPLE_CLASS: Record<BadgeFont, string> = {
  inter: "",
  "barlow-condensed": barlowSample.className,
  oswald: oswaldSample.className,
}

export function BadgeFontSelector({
  value,
  onChange,
}: {
  value: BadgeFont
  onChange: (v: BadgeFont) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 w-full" role="radiogroup" aria-label="Badge font">
      {(BADGE_FONTS as readonly BadgeFont[]).map((f) => {
        const isActive = value === f
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(f)}
            className={`flex flex-col items-center justify-center gap-0.5 w-full py-1.5 px-1 rounded-lg border transition-all duration-150 cursor-pointer ${
              isActive
                ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"
            }`}
          >
            <span className={`text-[15px] font-semibold leading-none select-none ${SAMPLE_CLASS[f]}`}>
              Aa
            </span>
            <span className="text-[10px] font-semibold leading-tight truncate max-w-full">
              {f === "inter" ? "Inter" : f === "barlow-condensed" ? "Barlow Condensed" : "Oswald"}
            </span>
          </button>
        )
      })}
    </div>
  )
}
