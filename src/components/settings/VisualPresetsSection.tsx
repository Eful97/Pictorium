"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { BookmarkPlus, ChevronDown, Download, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { http } from "@/lib/http"
import { usePresetTransfer } from "@/lib/usePresetTransfer"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  captureVisualPreset,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  normalizePresetExtraTuning,
  MAX_VISUAL_PRESETS,
  type VisualPreset,
  type VisualPresetShape,
} from "@/lib/visual-presets"

const endpoint = "/api/defaults/presets"

/**
 * Personal visual presets for one orientation. The parent passes the current
 * format target (existing selector); each list is fully independent
 * (server-scoped names/quota, target-only apply). Not necessarily simultaneous.
 */
export function VisualPresetsSection({ shape = "portrait" }: { shape?: VisualPresetShape }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const userId = usePSelector((v) => v.currentUserId)
  const [presets, setPresets] = useState<VisualPreset[]>([])
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  // Preset-file transfer is shape-aware (format v1 entries default to
  // portrait): refresh only the matching view, never clobber the other one —
  // including imports that resolve after a target switch (ref, not closure).
  const transfer = usePresetTransfer({
    onVisualsChanged: (s, next) => {
      if (shapeRef.current !== s) return
      setPresets(next)
      setListedShape(s)
    },
  })
  const transferBusy = transfer.busy
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Collapsible disclosure, closed by default to save vertical space.
  // Body is unmounted while closed (DataPanel pattern); load still runs at
  // mount so the header count stays accurate.
  const [isOpen, setIsOpen] = useState(false)
  const bodyId = useId()
  // Live target for async guards: closures capture the shape at call time,
  // the ref tells whether it is still current at resolve time.
  const shapeRef = useRef(shape)
  shapeRef.current = shape
  // Which shape the shown entries belong to (null = none yet/stale). Set on
  // every successful load/mutation; reset on target switch so stale entries
  // are never rendered nor clickable — not even for the paint before the
  // reload effect flushes (render-phase reset, derived-state pattern).
  const [listedShape, setListedShape] = useState<VisualPresetShape | null>(shape)
  if (listedShape !== null && listedShape !== shape) setListedShape(null)
  const fresh = listedShape === shape
  const visiblePresets = fresh ? presets : []

  const load = useCallback(async (signal?: AbortSignal) => {
    const target = shape
    setLoading(true)
    setError(false)
    try {
      const result = await http<{ presets: VisualPreset[] }>(`${endpoint}?shape=${target}`, { signal, retries: 0 })
      if (signal?.aborted || shapeRef.current !== target) return
      setPresets(result.presets)
      setListedShape(target)
    } catch {
      if (signal?.aborted || shapeRef.current !== target) return
      setError(true)
      setListedShape(target)
    } finally {
      if (!signal?.aborted && shapeRef.current === target) setLoading(false)
    }
  }, [shape])

  useEffect(() => {
    const controller = new AbortController()
    setPresets([])
    void load(controller.signal)
    return () => controller.abort()
  }, [load, userId])

  const mutate = async (method: "POST" | "DELETE", body: unknown) => {
    const target = shape
    setBusy(true)
    try {
      const result = await http<{ presets: VisualPreset[] }>(endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 0,
      })
      // A Resolve-after-switch must not overwrite the new list (nor clear
      // the new view's input); toasts still fire for the user's own action.
      if (shapeRef.current !== target) return
      setPresets(result.presets)
      setListedShape(target)
      if (method === "POST") {
        setName("")
        toast.success(t("ui.saved"))
      }
    } catch {
      toast.error(t("ui.visualPresetsError"))
    } finally { setBusy(false) }
  }

  // Shape-aware snapshot: portrait compares the isolated flat projection
  // (what portrait apply actually writes), landscape the effective profile.
  // `live` merges the RAW profile (extras outside the preset contract, e.g.
  // server-supported minQuality, must survive apply commits — update()
  // replaces the profile object); `clean` stays schema-only for storage.
  const clean = captureVisualPreset(ed)
  const live = { ...clean, landscape: ed.landscape }
  const current = JSON.stringify(normalizePresetExtraTuning(shape === "landscape" ? resolveEffectiveLandscape(clean) : portraitPresetPatch(clean)))
  const presetSnapshot = (preset: VisualPreset) =>
    JSON.stringify(normalizePresetExtraTuning(shape === "landscape" ? resolveEffectiveLandscape(preset.values) : portraitPresetPatch(preset.values)))
  const canSave = fresh && Boolean(name.trim()) && (presets.length < MAX_VISUAL_PRESETS || presets.some((preset) => preset.name === name.trim()))

  // Target-only apply, single atomic update: portrait freezes the other
  // format's effective output first (see applyPortraitIsolated), landscape
  // writes the profile only. Raw extras ride along untouched.
  const applyPreset = (preset: VisualPreset) => {
    ed.applyVisualPreset(shape === "landscape" ? applyLandscapeIsolated(live, preset.values) : applyPortraitIsolated(live, preset.values), shape)
    setName(preset.name)
  }

  // Landscape presets store the current effective resolution (self-contained);
  // portrait presets keep the raw capture (stored landscape ignored on apply).
  const captureForShape = () => {
    return shape === "landscape" ? { ...clean, landscape: resolveEffectiveLandscape(clean) } : clean
  }

  return (
    <section aria-label={t("ui.visualPresetsTitle")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 text-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="w-full min-h-[44px] py-1 flex items-center justify-between gap-2 cursor-pointer group touch-manipulation"
      >
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <BookmarkPlus className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />{t("ui.visualPresetsTitle")} · {t(shape === "landscape" ? "ui.posterShapeLandscape" : "ui.posterShapePortrait")}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-muted">{visiblePresets.length}/{MAX_VISUAL_PRESETS}</span>
          <ChevronDown
            aria-hidden="true"
            className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {isOpen && (
      <div id={bodyId} className="space-y-3">
      <p className="text-[11px] text-muted">{t("ui.visualPresetsHint")}</p>
      {loading || !fresh ? <p role="status" className="text-muted">{t("ui.loading")}</p> : error ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-muted">{t("ui.visualPresetsError")}</p>
          <button type="button" onClick={() => void load()} className="text-accent-orange cursor-pointer">{t("ui.retry")}</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 pt-2">
            {visiblePresets.map((preset) => (
              <div key={preset.id} className="relative max-w-full">
                <button type="button" disabled={busy} aria-pressed={current === presetSnapshot(preset)}
                  title={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="flex items-center gap-2 max-w-full min-h-[44px] rounded-2xl border border-white/10 bg-linear-to-b from-white/[0.06] to-white/[0.02] py-2 pl-3.5 pr-5 text-zinc-300 shadow-sm hover:border-white/25 hover:text-white aria-pressed:border-accent-orange/40 aria-pressed:from-accent-orange/15 aria-pressed:to-accent-orange/5 aria-pressed:text-accent-orange transition-colors cursor-pointer disabled:opacity-50">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${current === presetSnapshot(preset) ? "bg-accent-orange" : "bg-zinc-500"}`} />
                  <span className="max-w-[200px] truncate">{preset.name}</span>
                </button>
                <button type="button" disabled={busy} aria-label={`${t("ui.presetFileExportOne")} ${preset.name}`}
                  title={`${t("ui.presetFileExportOne")} ${preset.name}`}
                  onClick={() => transfer.exportVisual(preset)}
                  className="absolute -left-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#202024] text-zinc-400 shadow-md hover:border-accent-orange/40 hover:bg-accent-orange/15 hover:text-accent-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-orange transition-colors cursor-pointer disabled:opacity-50">
                  <Download className="w-3 h-3" />
                </button>
                <button type="button" disabled={busy || transferBusy} aria-label={`${t("ui.delete")} ${preset.name}`}
                  title={`${t("ui.delete")} ${preset.name}`}
                  onClick={() => void mutate("DELETE", { id: preset.id, shape })}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#202024] text-zinc-400 shadow-md hover:border-red-400/40 hover:bg-red-950 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-orange transition-colors cursor-pointer disabled:opacity-50">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault()
            if (!busy && !transferBusy && canSave) void mutate("POST", { name: name.trim(), shape, values: captureForShape() })
          }}>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40}
              aria-label={t("ui.visualPresetName")} placeholder={t("ui.visualPresetName")} disabled={busy || transferBusy}
              className="min-w-0 flex-1 bg-surface2/60 border border-white/10 rounded-lg px-3 h-11 text-zinc-200 outline-none focus:border-accent-orange/50 disabled:opacity-50" />
            <button type="submit" disabled={busy || transferBusy || !canSave}
              className="px-3 h-11 rounded-lg bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 cursor-pointer disabled:opacity-50">
              {t("ui.visualPresetSave")}
            </button>
          </form>
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={busy || transferBusy}
              onClick={() => void transfer.exportAll()}
              className="flex flex-1 items-center justify-center gap-1.5 h-11 rounded-lg bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-50">
              <Download className="w-3.5 h-3.5 text-accent-orange" />{t("ui.presetFileExportAll")}
            </button>
            <button type="button" disabled={busy || transferBusy}
              onClick={() => fileRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-1.5 h-11 rounded-lg bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-50">
              <Upload className="w-3.5 h-3.5 text-blue-400" />{t("ui.presetFileImport")}
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-hidden="true" tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file && !transferBusy) void transfer.importFile(file)
              }} />
          </div>
        </>
      )}
      </div>
      )}
    </section>
  )
}
