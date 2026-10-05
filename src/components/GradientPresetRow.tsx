"use client"

import { useRef, useState } from "react"
import { Download, Plus, Upload, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePresetTransfer } from "@/lib/usePresetTransfer"
import {
  GRADIENT_PRESET_COLOR,
  NATURAL_GRADIENT_DEFAULTS,
  MAX_CUSTOM_GRADIENT_PRESETS,
  matchesGradientPreset,
  useCustomGradientPresets,
  addCustomGradientPreset,
  deleteCustomGradientPreset,
  type GradientPresetValues,
} from "@/lib/gradient-presets"

interface GradientPresetRowProps {
  /** Valori correnti (slider editor o default Impostazioni). */
  current: GradientPresetValues
  /** Scrive i valori del preset cliccato (solo numeri, mai il nome). */
  onApply: (v: GradientPresetValues) => void
  naturalLabel: string
  colorLabel: string
  addTitle: string
  namePlaceholder: string
  deleteLabel: string
}

/**
 * Riga preset sfumatura condivisa tra editor (per-titolo) e Impostazioni
 * (default globali): 2 built-in + fino a 3 personali (5 totali). I personali
 * sono scorciatoie locali (localStorage per namespace): fotografano gli
 * slider correnti, non viaggiano mai al server.
 */
export function GradientPresetRow({
  current,
  onApply,
  naturalLabel,
  colorLabel,
  addTitle,
  namePlaceholder,
  deleteLabel,
}: GradientPresetRowProps) {
  const customs = useCustomGradientPresets()
  const { t } = useT()
  const transfer = usePresetTransfer()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const chip = (active: boolean) =>
    `text-xs px-2 py-0.5 rounded-md border transition-colors ${active ? "text-accent border-accent/50" : "text-muted hover:text-accent border-border/50 hover:border-accent/30"}`

  const save = () => {
    if (!name.trim()) return
    if (addCustomGradientPreset(name, current)) {
      setName("")
      setNaming(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-1 flex-wrap">
      <button type="button"
              aria-pressed={matchesGradientPreset(current, NATURAL_GRADIENT_DEFAULTS)}
              onClick={() => onApply(NATURAL_GRADIENT_DEFAULTS)}
              className={chip(matchesGradientPreset(current, NATURAL_GRADIENT_DEFAULTS))}>
        {naturalLabel}
      </button>
      <button type="button"
              aria-pressed={matchesGradientPreset(current, GRADIENT_PRESET_COLOR)}
              onClick={() => onApply(GRADIENT_PRESET_COLOR)}
              className={chip(matchesGradientPreset(current, GRADIENT_PRESET_COLOR))}>
        {colorLabel}
      </button>
      {customs.map((p) => {
        const active = matchesGradientPreset(current, p.values)
        return (
          <span key={p.id} className="inline-flex items-center gap-0.5">
            <button type="button"
                    aria-pressed={active}
                    title={p.name}
                    onClick={() => onApply(p.values)}
                    className={chip(active)}>
              {p.name}
            </button>
            <button type="button"
                    aria-label={`${t("ui.presetFileExportOne")} ${p.name}`}
                    title={`${t("ui.presetFileExportOne")} ${p.name}`}
                    onClick={() => transfer.exportGradient(p)}
                    disabled={transfer.busy}
                    className="text-muted hover:text-accent transition-colors px-0.5 rounded disabled:opacity-50">
              <Download className="w-3 h-3" />
            </button>
            <button type="button"
                    aria-label={deleteLabel}
                    title={deleteLabel}
                    onClick={() => deleteCustomGradientPreset(p.id)}
                    disabled={transfer.busy}
                    className="text-muted hover:text-danger transition-colors px-0.5 rounded disabled:opacity-50">
              <X className="w-3 h-3" />
            </button>
          </span>
        )
      })}
      {customs.length < MAX_CUSTOM_GRADIENT_PRESETS && !naming && (
        <button type="button"
                aria-label={addTitle}
                title={addTitle}
                onClick={() => { setNaming(true); setName("") }}
                disabled={transfer.busy}
                className="text-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded-md border border-dashed border-border/50 hover:border-accent/30 disabled:opacity-50">
          <Plus className="w-3 h-3" />
        </button>
      )}
      {naming && (
        <input autoFocus
               value={name}
               maxLength={24}
               placeholder={namePlaceholder}
               aria-label={namePlaceholder}
               disabled={transfer.busy}
               onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter") save()
                 if (e.key === "Escape") { setNaming(false); setName("") }
               }}
               onBlur={() => { if (!name.trim()) { setNaming(false); setName("") } }}
               className="text-xs bg-surface2/60 border border-border/50 rounded-md px-2 py-0.5 w-28 outline-none focus:border-accent/50 text-zinc-200 placeholder:text-muted" />
      )}
      <span className="inline-flex items-center gap-1 ml-auto">
        <button type="button"
                aria-label={t("ui.presetFileExportGradients")}
                title={t("ui.presetFileExportGradients")}
                onClick={() => void transfer.exportGradients()}
                disabled={transfer.busy}
                className="text-muted hover:text-accent transition-colors px-1 py-0.5 rounded-md disabled:opacity-50">
          <Download className="w-3 h-3" />
        </button>
        <button type="button"
                aria-label={t("ui.presetFileImport")}
                title={t("ui.presetFileImport")}
                onClick={() => fileRef.current?.click()}
                disabled={transfer.busy}
                className="text-muted hover:text-accent transition-colors px-1 py-0.5 rounded-md disabled:opacity-50">
          <Upload className="w-3 h-3" />
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-hidden="true" tabIndex={-1}
               onChange={(e) => {
                 const file = e.target.files?.[0]
                 e.target.value = ""
                 if (file && !transfer.busy) void transfer.importFile(file)
               }} />
      </span>
    </div>
  )
}
