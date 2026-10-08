"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { http } from "@/lib/http"
import {
  APPLE_PRESET_LABEL,
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_PRESET_LABEL,
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_PRESET_LABEL,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import type { VisualPreset, VisualPresetShape, VisualPresetValues } from "@/lib/visual-presets"

const endpoint = "/api/defaults/presets"

interface BuiltInPreset {
  label: string
  descKey: string
  values: VisualPresetValues
}

/**
 * Built-in full looks (same snapshots as the global Badge tab): BetterPoster,
 * RPDB and Apple. Reuses the shared labels/descriptions; applying here goes
 * through the per-title action, never the global-defaults one.
 */
const BUILT_INS: BuiltInPreset[] = [
  { label: BETTER_POSTER_PRESET_LABEL, descKey: "ui.configPresetBetterPosterDesc", values: BETTER_POSTER_VISUAL_DEFAULTS },
  { label: RPDB_PRESET_LABEL, descKey: "ui.configPresetRpdbDesc", values: RPDB_VISUAL_DEFAULTS },
  { label: APPLE_PRESET_LABEL, descKey: "ui.configPresetAppleDesc", values: APPLE_VISUAL_DEFAULTS },
]

/**
 * PerTitlePresetChooser — compact quick-preset disclosure for single-poster
 * customization (EditView, above the tab-specific controls).
 *
 * Closed by default; expanding shows the built-in full looks plus the saved
 * personal presets for the current orientation. Every apply goes through
 * `ed.applyPerTitleVisualPreset(values, selectedLogo)`: current title only,
 * no global defaults change, no autosave — the normal Save persists the
 * change. Deliberately NO active-preset highlight (no full live-value
 * comparison here) and no preset management (save/import/export live in the
 * global Defaults panels).
 *
 * Saved list loads lazily on open via GET /api/defaults/presets?shape=
 * (scoped auth via http). Stale-response guards cover orientation AND user
 * switches, including the paint before effects: entries render (and are
 * clickable) only when they belong to the live shape+user. Built-ins stay
 * usable when the saved list fails to load.
 */
export function PerTitlePresetChooser({ shape = "portrait" }: { shape?: VisualPresetShape }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const userId = usePSelector((v) => v.currentUserId)
  const [presets, setPresets] = useState<VisualPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  // Collapsible disclosure, closed by default. Body unmounts while closed.
  const [isOpen, setIsOpen] = useState(false)
  const bodyId = useId()
  // Live targets for async guards: closures capture shape+user at call time,
  // the refs tell whether they are still current at resolve time.
  const shapeRef = useRef(shape)
  shapeRef.current = shape
  const userRef = useRef(userId)
  userRef.current = userId
  // Monotonic request generation: every load (initial open AND manual retry)
  // takes the next id; only the latest id may write state. This covers what
  // shape/user/signal guards cannot: two overlapping loads for the SAME
  // shape+user (stale retry A vs fresh reopen B, or a shape/user roundtrip
  // back to the start). The id is invalidated on close, on supersede and on
  // unmount, so late responses are ignored instead of overwriting fresh data.
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])
  // Manual-retry fetches carry their own controller so closing (or a newer
  // load) actually aborts them; the generation guard above still ignores a
  // late response when the fetch itself is not cancellable (mocked http).
  const retryControllerRef = useRef<AbortController | null>(null)
  // Which shape+user the shown entries belong to (null = none yet/stale).
  // Reset on target switch so stale entries are never rendered nor clickable
  // — not even for the paint before the reload effect flushes (render-phase
  // reset, derived-state pattern).
  const listKey = `${shape}:${userId ?? ""}`
  const [listedKey, setListedKey] = useState<string | null>(null)
  if (listedKey !== null && listedKey !== listKey) setListedKey(null)
  const fresh = listedKey === listKey
  const visiblePresets = fresh ? presets : []

  const load = useCallback(async (signal?: AbortSignal) => {
    const target = shape
    const targetUser = userId
    const targetKey = `${target}:${targetUser ?? ""}`
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const isCurrent = () =>
      mountedRef.current
      && requestIdRef.current === requestId
      && !signal?.aborted
      && shapeRef.current === target
      && userRef.current === targetUser
    setLoading(true)
    setError(false)
    try {
      const result = await http<{ presets: VisualPreset[] }>(`${endpoint}?shape=${target}`, { signal, retries: 0 })
      if (!isCurrent()) return
      setPresets(result.presets)
      setListedKey(targetKey)
    } catch {
      if (!isCurrent()) return
      setError(true)
      setListedKey(targetKey)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [shape, userId])

  // Lazy load on open only (a closed chooser never fetches); reloads when the
  // orientation or the user changes while open. Built-ins need no fetch.
  // Cleanup aborts the open load AND invalidates the generation, so a pending
  // manual retry (same shape+user, possibly without a signal) can never
  // overwrite the next open after collapse/unmount.
  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    setPresets([])
    void load(controller.signal)
    return () => {
      controller.abort()
      retryControllerRef.current?.abort()
      retryControllerRef.current = null
      requestIdRef.current += 1
    }
  }, [load, isOpen])

  // Manual retry with its own AbortSignal: superseded (aborted + generation
  // invalidated) by close, user/shape change or a newer load; ignored after
  // unmount via the generation guard.
  const retry = useCallback(() => {
    retryControllerRef.current?.abort()
    const controller = new AbortController()
    retryControllerRef.current = controller
    void load(controller.signal)
  }, [load])

  const applyPreset = (values: VisualPresetValues) => {
    // Per-title only (current poster, current orientation) — never the
    // global-defaults applyVisualPreset. selectedLogo resolves the preset's
    // null (auto-fit) scale; null logo falls back inside the action.
    ed.applyPerTitleVisualPreset(values, selectedLogo)
  }

  return (
    <section aria-label={t("ui.perTitlePresetsTitle")} data-testid="per-title-preset-chooser" className="mb-4 space-y-3 text-xs">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        data-testid="per-title-preset-toggle"
        className="w-full flex items-center justify-between gap-2 px-1 py-1 min-h-[44px] cursor-pointer touch-manipulation"
      >
        <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
          <Sparkles className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />{t("ui.perTitlePresetsTitle")} · {t(shape === "landscape" ? "ui.posterShapeLandscape" : "ui.posterShapePortrait")}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
      <div id={bodyId} className="space-y-3">
        <p className="text-[11px] text-muted">{t("ui.perTitlePresetsHint")}</p>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-zinc-300">{t("ui.configPresetTitle")}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            {BUILT_INS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                title={t(preset.descKey)}
                onClick={() => applyPreset(preset.values)}
                className="flex items-center gap-2 max-w-full min-h-[44px] rounded-2xl border border-white/10 bg-linear-to-b from-white/[0.06] to-white/[0.02] py-2 pl-3.5 pr-5 text-zinc-300 shadow-sm hover:border-white/25 hover:text-white transition-colors cursor-pointer"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
                <span className="max-w-[200px] truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-zinc-300">{t("ui.visualPresetsTitle")}</p>
          {loading || !fresh ? (
            <p role="status" className="text-muted">{t("ui.loading")}</p>
          ) : error ? (
            <div className="flex items-center gap-2">
              <p role="alert" className="text-muted">{t("ui.visualPresetsError")}</p>
              <button type="button" onClick={retry} className="text-accent-orange cursor-pointer">{t("ui.retry")}</button>
            </div>
          ) : visiblePresets.length === 0 ? (
            <p className="text-muted">{t("ui.perTitlePresetsEmpty")}</p>
          ) : (
            <div className="flex flex-wrap gap-3 pt-1">
              {visiblePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  onClick={() => applyPreset(preset.values)}
                  className="flex items-center gap-2 max-w-full min-h-[44px] rounded-2xl border border-white/10 bg-linear-to-b from-white/[0.06] to-white/[0.02] py-2 pl-3.5 pr-5 text-zinc-300 shadow-sm hover:border-white/25 hover:text-white transition-colors cursor-pointer"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
                  <span className="max-w-[200px] truncate">{preset.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </section>
  )
}
