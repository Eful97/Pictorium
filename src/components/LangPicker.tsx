"use client"

import { PICKER_LANGS, LANG_FLAGS } from "@/lib/utils"
import { useT } from "@/lib/contexts/TranslationContext"
import { Globe } from "lucide-react"

export function LangPicker({ onPick }: { onPick: (code: string) => void }) {
  const { t } = useT()
  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-lg mx-4">
        <div className="text-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
          <img src="/posterium.svg" alt="Posterium" loading="eager" decoding="async" className="h-auto w-[min(92vw,390px)] mx-auto mb-4 hover:brightness-110 transition-all duration-150" />
          <h2 className="text-2xl font-bold text-zinc-100">{t("ui.welcome")}</h2>
          <p className="text-sm text-muted mt-1.5">{t("ui.welcomeSubtitle")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PICKER_LANGS.map((l) => (
            <button type="button" key={l.code} onClick={() => onPick(l.code)} className="surface-card flex items-center gap-2 px-4 py-3.5 rounded-2xl hover:-translate-y-0.5 active:scale-[0.97] transition-all duration-200 text-left group">
              <span className="text-2xl shrink-0">{LANG_FLAGS[l.code] || <Globe className="w-6 h-6" />}</span>
              <div>
                <p className="text-sm font-medium text-zinc-200 group-hover:text-accent transition-colors">{l.name}</p>
                <p className="text-xs text-muted uppercase tracking-wider">{l.code}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
