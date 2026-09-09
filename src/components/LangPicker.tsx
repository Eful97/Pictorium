"use client"

import { useState } from "react"
import { PICKER_LANGS } from "@/lib/utils"
import { REGIONS } from "@/lib/regions"
import { useT } from "@/lib/contexts/TranslationContext"
import { ChevronLeft } from "lucide-react"

interface SetupWizardProps {
  /** Applica la lingua (codice 2 lettere) senza chiudere il wizard. */
  onPickLang: (code: string) => void
  /** Applica la nazionalità delle liste (codice regione, es. "IT"). */
  onPickRegion: (regionCode: string) => void
  /** Chiude il wizard (chiamato dopo la scelta della regione). */
  onDone: () => void
}

/**
 * Configurazione guidata iniziale in 2 passi:
 * 1. lingua dell'interfaccia (12 nazionalità),
 * 2. nazionalità delle liste/classifiche (stesse 12).
 * La lingua si applica subito così il passo 2 è già tradotto.
 */
export function LangPicker({ onPickLang, onPickRegion, onDone }: SetupWizardProps) {
  const { t } = useT()
  const [step, setStep] = useState<"lang" | "region">("lang")

  const pickLang = (code: string) => {
    onPickLang(code)
    setStep("region")
  }

  const pickRegion = (regionCode: string) => {
    onPickRegion(regionCode)
    onDone()
  }

  const isRegion = step === "region"

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-lg mx-4">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
          <img src="/pictorium.svg" alt="Pictorium" loading="eager" decoding="async" className="h-auto w-[min(92vw,430px)] mx-auto mb-4 hover:brightness-110 transition-all duration-150" />
          <h2 className="text-2xl font-bold text-zinc-100">
            {isRegion ? t("ui.setupRegionTitle") : t("ui.welcome")}
          </h2>
          <p className="text-sm text-muted mt-1.5">
            {isRegion ? t("ui.setupRegionSubtitle") : t("ui.welcomeSubtitle")}
          </p>
          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 mt-4" aria-hidden="true">
            <span className={`h-1.5 rounded-full transition-all duration-300 ${!isRegion ? "w-6 bg-accent-orange" : "w-1.5 bg-zinc-600"}`} />
            <span className={`h-1.5 rounded-full transition-all duration-300 ${isRegion ? "w-6 bg-accent-orange" : "w-1.5 bg-zinc-600"}`} />
          </div>
        </div>
        {isRegion ? (
          <div key="region" className="grid grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-0.5 animate-step-enter">
            {REGIONS.map((r) => (
              <button type="button" key={r.code} onClick={() => pickRegion(r.code)} className="surface-card flex items-center gap-2 px-4 py-3.5 rounded-2xl hover:-translate-y-0.5 active:scale-[0.97] transition-all duration-200 text-left group">
                <span className="text-2xl shrink-0">{r.flag}</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-accent transition-colors">{r.label}</p>
                  <p className="text-xs text-muted uppercase tracking-wider">{r.code}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div key="lang" className="grid grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-0.5 animate-step-enter">
            {PICKER_LANGS.map((l) => (
              <button type="button" key={l.key} onClick={() => pickLang(l.code)} className="surface-card flex items-center gap-2 px-4 py-3.5 rounded-2xl hover:-translate-y-0.5 active:scale-[0.97] transition-all duration-200 text-left group">
                <span className="text-2xl shrink-0">{l.flag}</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-accent transition-colors">{l.name}</p>
                  <p className="text-xs text-muted uppercase tracking-wider">{l.sub}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {isRegion && (
          <button
            type="button"
            onClick={() => setStep("lang")}
            className="mx-auto mt-5 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-all active:scale-95"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t("ui.back")}
          </button>
        )}
      </div>
    </div>
  )
}
