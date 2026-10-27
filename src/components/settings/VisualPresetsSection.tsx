"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { BookmarkPlus, Check, ChevronDown, Download, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { http } from "@/lib/http"
import { usePresetTransfer } from "@/lib/usePresetTransfer"
import {
  applyPersonalLandscapeIsolated,
  applyPersonalPortraitIsolated,
  captureVisualPreset,
  normalizePersonalPreset,
  personalPortraitPatch,
  resolveEffectiveLandscape,
  normalizePresetExtraTuning,
  MAX_VISUAL_PRESETS,
  type VisualPreset,
  type VisualPresetShape,
  type VisualPresetValues,
} from "@/lib/visual-presets"

const endpoint = "/api/defaults/presets"

/**
 * Personal visual presets for one orientation. The parent passes the current
 * format target (existing selector); each list is fully independent
 * (server-scoped names/quota, target-only apply). Not necessarily simultaneous.
 */
export function VisualPresetsSection({ shape = "portrait", enabled = true, gallery = false, thumbnailFor, onApplyPreset }: {
  shape?: VisualPresetShape
  enabled?: boolean
  /**
   * Gallery presentation (Preset tab reuse): personal presets render as a
   * thumbnail grid with selection border/check; save/import/export/delete
   * move into a secondary manage disclosure (never dominant card controls).
   * Absent/false = legacy standalone behavior unchanged.
   */
  gallery?: boolean
  /** Real thumbnail URL per preset (same demo title + actual
   *  DefaultsPosterPreview URL builder, never a fake render). */
  thumbnailFor?: (preset: VisualPreset) => string | null
  /** Custom apply (e.g. target-specific session apply preserving the other
   *  shape). Absent = legacy target-only apply. */
  onApplyPreset?: (preset: VisualPreset) => void
}) {
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
    if (!enabled) return
    const controller = new AbortController()
    setPresets([])
    void load(controller.signal)
    return () => controller.abort()
  }, [load, userId, enabled])

  const mutate = async (
    method: "POST" | "DELETE",
    body: unknown,
    opts?: { resetName?: boolean },
  ): Promise<boolean> => {
    const target = shape
    setBusy(true)
    try {
      const result = await http<{ presets: VisualPreset[] }>(endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 0,
      })
      // A Resolve-after-switch must not overwrite the new list (nor clear
      // the new view's input); toasts still fire for the user's own action.
      if (shapeRef.current !== target) return false
      setPresets(result.presets)
      setListedShape(target)
      if (method === "POST") {
        if (opts?.resetName !== false) setName("")
        toast.success(t("ui.saved"))
      }
      return true
    } catch {
      toast.error(t("ui.visualPresetsError"))
      return false
    } finally { setBusy(false) }
  }

  // Shape-aware snapshot: portrait compares the isolated personal flat
  // projection (owned layout/scope/extra-style/age included — what personal
  // portrait apply actually writes), landscape the effective profile.
  // Normalization first: legacy snapshots without the owned keys resolve to
  // the canonical factory values (never the live previous look), so a legacy
  // preset highlights exactly when the edited shape effectively matches.
  // `live` merges the RAW profile (extras outside the preset contract, e.g.
  // server-supported minQuality, must survive apply commits — update()
  // replaces the profile object); `clean` stays schema-only for storage.
  const clean = captureVisualPreset(ed)
  const live = { ...clean, landscape: ed.landscape }
  const personalKey = (values: VisualPresetValues) =>
    JSON.stringify(normalizePresetExtraTuning(shape === "landscape"
      ? resolveEffectiveLandscape(normalizePersonalPreset(values))
      : personalPortraitPatch(values) as unknown as VisualPresetValues))
  const current = personalKey(clean)
  const presetSnapshot = (preset: VisualPreset) => personalKey(preset.values)
  // Create always adds a new preset: the quota is the only gate. A duplicate
  // name is reported explicitly (never silently overwrites the existing one).
  const canSave = fresh && Boolean(name.trim()) && presets.length < MAX_VISUAL_PRESETS
  const appliedPersonal = ed.activePresetBaselines?.[shape]?.kind === "personal"
    ? ed.activePresetBaselines[shape] ?? null
    : null
  // Update is offered only for a still-stored preset; a deleted reference
  // keeps its immutable reset snapshot but cannot be updated/resurrected.
  const activePersonal = appliedPersonal && presets.some((preset) => preset.id === appliedPersonal.id)
    ? appliedPersonal
    : null
  const nameIsTaken = (candidate: string, excludeId?: string) =>
    presets.some((preset) => preset.name === candidate && preset.id !== excludeId)

  const createPreset = async () => {
    const candidate = name.trim()
    if (!candidate) return
    if (nameIsTaken(candidate)) {
      toast.error(t("ui.visualPresetNameExists"))
      return
    }
    await mutate("POST", { mode: "create", name: candidate, shape, values: captureForShape() }, { resetName: true })
  }

  // Target-only personal apply, single atomic update: portrait owns its full
  // visual recipe (owned layout/scope/extra-style/age included) while the
  // other format's effective output is frozen first (see
  // applyPersonalPortraitIsolated); landscape writes the profile only.
  // Raw extras ride along untouched.
  const applyPreset = (preset: VisualPreset) => {
    ed.applyVisualPreset(
      shape === "landscape" ? applyPersonalLandscapeIsolated(live, preset.values) : applyPersonalPortraitIsolated(live, preset.values),
      shape,
      { id: preset.id, name: preset.name, kind: "personal" },
    )
    setName(preset.name)
    setUpdateArmed(false)
  }

  // Landscape presets store the current effective resolution (self-contained);
  // portrait presets keep the raw capture (stored landscape ignored on apply).
  const captureForShape = () => {
    return shape === "landscape" ? { ...clean, landscape: resolveEffectiveLandscape(clean) } : clean
  }

  const [manageOpen, setManageOpen] = useState(false)
  const [updateArmed, setUpdateArmed] = useState(false)
  const manageBodyId = useId()
  const applyPresetOrCustom = (preset: VisualPreset) => {
    setUpdateArmed(false)
    if (onApplyPreset) {
      onApplyPreset(preset)
      setName(preset.name)
      return
    }
    applyPreset(preset)
  }

  const updatePreset = async () => {
    const target = activePersonal
    if (!target) return
    if (!updateArmed) {
      setUpdateArmed(true)
      return
    }
    const candidate = name.trim()
    if (!candidate) return
    if (nameIsTaken(candidate, target.id)) {
      toast.error(t("ui.visualPresetNameExists"))
      setUpdateArmed(false)
      return
    }
    const ok = await mutate(
      "POST",
      { mode: "update", id: target.id, name: candidate, shape, values: captureForShape() },
      { resetName: false },
    )
    if (ok) {
      ed.refreshActivePresetBaseline?.(shape, { id: target.id, name: candidate, kind: "personal" })
    }
    setUpdateArmed(false)
  }
  // Viewport/tab guard (owner-controlled): the hidden twin instance in
  // AppShell stays unmounted so only the visible form factor fetches.
  if (!enabled) return null

  return (
    <section aria-label={t("ui.visualPresetsTitle")} data-testid="visual-presets-section" className="space-y-3 text-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        data-testid="visual-presets-toggle"
        className="w-full flex items-center justify-between gap-2 px-1 py-1 min-h-[44px] cursor-pointer touch-manipulation"
      >
        <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
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
      ) : gallery ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-0.5" data-testid="visual-presets-gallery">
            {visiblePresets.length === 0 ? (
              <p className="text-muted text-[11px] col-span-full">{t("ui.perTitlePresetsEmpty")}</p>
            ) : visiblePresets.map((preset) => {
              const active = current === presetSnapshot(preset)
              const thumb = thumbnailFor?.(preset) ?? null
              return (
              <button key={preset.id} type="button" disabled={busy} aria-pressed={active}
                title={preset.name}
                data-testid={`visual-preset-${preset.id}`}
                onClick={() => applyPresetOrCustom(preset)}
                className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer disabled:opacity-50 min-h-[44px] ${
                  active
                    ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                    : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
                }`}>
                {/* Compact bounded thumbnail honoring the selected shape
                    (portrait 2:3 ~64–96px, landscape wider at an equal
                    compact 16:9 footprint, contained never cropped). The
                    frame always renders — even with no URL yet or a failed
                    image — so load/error never shifts the layout. */}
                <span aria-hidden="true" className={`mx-auto max-w-full shrink-0 rounded-lg border border-white/10 bg-zinc-950/80 mb-1.5 overflow-hidden ${shape === "landscape" ? "w-28 sm:w-36 lg:w-40 aspect-video" : "w-16 sm:w-20 lg:w-24 aspect-[2/3]"}`}>
                  {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={thumb} alt="" aria-hidden="true" loading="lazy" onError={(e) => e.currentTarget.classList.add("opacity-0")} className="h-full w-full object-contain" />
                  ) : null}
                </span>
                <span className="flex items-center justify-between w-full gap-1">
                  <span className="font-semibold text-xs text-foreground truncate">{preset.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
                </span>
              </button>
              )
            })}
          </div>
          <section aria-label={t("ui.manageSavedStyles")} data-testid="visual-presets-manage">
            <button type="button" data-testid="visual-presets-manage-toggle" aria-expanded={manageOpen} aria-controls={manageBodyId} onClick={() => setManageOpen((v) => !v)} className="w-full flex items-center justify-between px-1 py-1 min-h-[44px] cursor-pointer touch-manipulation">
              <span className="text-xs font-bold text-zinc-100">{t("ui.manageSavedStyles")}</span>
              <ChevronDown aria-hidden="true" className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${manageOpen ? "rotate-180" : ""}`} />
            </button>
            {manageOpen && (
            <div id={manageBodyId} className="space-y-3">
              <form className="flex gap-2" onSubmit={(event) => {
                event.preventDefault()
                if (!busy && !transferBusy && canSave) void createPreset()
              }}>
                <input value={name} onChange={(event) => { setName(event.target.value); setUpdateArmed(false) }} maxLength={40}
                  aria-label={t("ui.visualPresetName")} placeholder={t("ui.visualPresetName")} disabled={busy || transferBusy}
                  className="min-w-0 flex-1 bg-surface2/60 border border-white/10 rounded-lg px-3 h-11 text-zinc-200 outline-none focus:border-accent-orange/50 disabled:opacity-50" />
                <button type="submit" disabled={busy || transferBusy || !canSave}
                  data-testid="visual-preset-create"
                  className="px-3 h-11 rounded-lg bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 cursor-pointer disabled:opacity-50">
                  {t("ui.visualPresetSave")}
                </button>
                {activePersonal && (
                  <button type="button" disabled={busy || transferBusy || !name.trim()}
                    data-testid="visual-preset-update"
                    onClick={() => void updatePreset()}
                    className="px-3 h-11 rounded-lg bg-white/[0.06] text-zinc-200 hover:bg-white/[0.10] border border-white/10 cursor-pointer disabled:opacity-50">
                    {updateArmed ? t("ui.visualPresetUpdateConfirm") : t("ui.visualPresetUpdate")}
                  </button>
                )}
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
              <div className="space-y-1.5">
                {visiblePresets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
                    <span className="truncate text-[11px] text-zinc-300">{preset.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <button type="button" disabled={busy} aria-label={`${t("ui.presetFileExportOne")} ${preset.name}`} title={`${t("ui.presetFileExportOne")} ${preset.name}`} onClick={() => transfer.exportVisual(preset)} className="p-2 rounded-lg text-zinc-400 hover:text-accent-orange cursor-pointer disabled:opacity-50">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" disabled={busy || transferBusy} aria-label={`${t("ui.delete")} ${preset.name}`} title={`${t("ui.delete")} ${preset.name}`} onClick={() => void mutate("DELETE", { id: preset.id, shape })} className="p-2 rounded-lg text-zinc-400 hover:text-red-300 cursor-pointer disabled:opacity-50">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 pt-2">
            {visiblePresets.map((preset) => (
              <div key={preset.id} className="relative max-w-full">
                <button type="button" disabled={busy} aria-pressed={current === presetSnapshot(preset)}
                  title={preset.name}
                  onClick={() => applyPresetOrCustom(preset)}
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
            if (!busy && !transferBusy && canSave) void createPreset()
          }}>
            <input value={name} onChange={(event) => { setName(event.target.value); setUpdateArmed(false) }} maxLength={40}
              aria-label={t("ui.visualPresetName")} placeholder={t("ui.visualPresetName")} disabled={busy || transferBusy}
              className="min-w-0 flex-1 bg-surface2/60 border border-white/10 rounded-lg px-3 h-11 text-zinc-200 outline-none focus:border-accent-orange/50 disabled:opacity-50" />
            <button type="submit" disabled={busy || transferBusy || !canSave}
              data-testid="visual-preset-create"
              className="px-3 h-11 rounded-lg bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 cursor-pointer disabled:opacity-50">
              {t("ui.visualPresetSave")}
            </button>
            {activePersonal && (
              <button type="button" disabled={busy || transferBusy || !name.trim()}
                data-testid="visual-preset-update"
                onClick={() => void updatePreset()}
                className="px-3 h-11 rounded-lg bg-white/[0.06] text-zinc-200 hover:bg-white/[0.10] border border-white/10 cursor-pointer disabled:opacity-50">
                {updateArmed ? t("ui.visualPresetUpdateConfirm") : t("ui.visualPresetUpdate")}
              </button>
            )}
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
