"use client"

import { useCallback, useEffect, useState } from "react"
import { BookmarkPlus, X } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { http } from "@/lib/http"
import { captureVisualPreset, MAX_VISUAL_PRESETS, type VisualPreset } from "@/lib/visual-presets"

const endpoint = "/api/defaults/presets"

export function VisualPresetsSection() {
  const { t } = useT()
  const ed = usePosterEditor()
  const userId = usePSelector((v) => v.currentUserId)
  const [presets, setPresets] = useState<VisualPreset[]>([])
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(false)
    try {
      const result = await http<{ presets: VisualPreset[] }>(endpoint, { signal, retries: 0 })
      if (!signal?.aborted) setPresets(result.presets)
    } catch {
      if (!signal?.aborted) setError(true)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setPresets([])
    void load(controller.signal)
    return () => controller.abort()
  }, [load, userId])

  const mutate = async (method: "POST" | "DELETE", body: unknown) => {
    setBusy(true)
    try {
      const result = await http<{ presets: VisualPreset[] }>(endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 0,
      })
      setPresets(result.presets)
      if (method === "POST") {
        setName("")
        toast.success(t("ui.saved"))
      }
    } catch {
      toast.error(t("ui.visualPresetsError"))
    } finally { setBusy(false) }
  }

  const current = JSON.stringify(captureVisualPreset(ed))
  const canSave = Boolean(name.trim()) && (presets.length < MAX_VISUAL_PRESETS || presets.some((preset) => preset.name === name.trim()))

  return (
    <section aria-label={t("ui.visualPresetsTitle")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <BookmarkPlus className="w-3.5 h-3.5 text-accent-orange" />{t("ui.visualPresetsTitle")}
        </h4>
        <span className="text-[10px] text-muted">{presets.length}/{MAX_VISUAL_PRESETS}</span>
      </div>
      <p className="text-[11px] text-muted">{t("ui.visualPresetsHint")}</p>
      {loading ? <p role="status" className="text-muted">{t("ui.loading")}</p> : error ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-muted">{t("ui.visualPresetsError")}</p>
          <button type="button" onClick={() => void load()} className="text-accent-orange cursor-pointer">{t("ui.retry")}</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 pt-2">
            {presets.map((preset) => (
              <div key={preset.id} className="relative max-w-full">
                <button type="button" disabled={busy} aria-pressed={current === JSON.stringify(preset.values)}
                  title={preset.name}
                  onClick={() => { ed.applyVisualPreset(preset.values); setName(preset.name) }}
                  className="flex items-center gap-2 max-w-full min-h-[44px] rounded-2xl border border-white/10 bg-linear-to-b from-white/[0.06] to-white/[0.02] py-2 pl-3.5 pr-5 text-zinc-300 shadow-sm hover:border-white/25 hover:text-white aria-pressed:border-accent-orange/40 aria-pressed:from-accent-orange/15 aria-pressed:to-accent-orange/5 aria-pressed:text-accent-orange transition-colors cursor-pointer disabled:opacity-50">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${current === JSON.stringify(preset.values) ? "bg-accent-orange" : "bg-zinc-500"}`} />
                  <span className="max-w-[200px] truncate">{preset.name}</span>
                </button>
                <button type="button" disabled={busy} aria-label={`${t("ui.delete")} ${preset.name}`}
                  title={`${t("ui.delete")} ${preset.name}`}
                  onClick={() => void mutate("DELETE", { id: preset.id })}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#202024] text-zinc-400 shadow-md hover:border-red-400/40 hover:bg-red-950 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-orange transition-colors cursor-pointer disabled:opacity-50">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault()
            if (!busy && canSave) void mutate("POST", { name: name.trim(), values: captureVisualPreset(ed) })
          }}>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40}
              aria-label={t("ui.visualPresetName")} placeholder={t("ui.visualPresetName")} disabled={busy}
              className="min-w-0 flex-1 bg-surface2/60 border border-white/10 rounded-lg px-3 h-11 text-zinc-200 outline-none focus:border-accent-orange/50 disabled:opacity-50" />
            <button type="submit" disabled={busy || !canSave}
              className="px-3 h-11 rounded-lg bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 cursor-pointer disabled:opacity-50">
              {t("ui.visualPresetSave")}
            </button>
          </form>
        </>
      )}
    </section>
  )
}
