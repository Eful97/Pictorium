"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Heart, Pencil, Trash2, Wand2, X } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { ApiError, http } from "@/lib/http"
import { usePreviewDemoMedia } from "@/lib/defaults-preview-media"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PresetThumbnail } from "@/components/settings/VisualPresetsSection"
import { sharedPresetsEndpoint, type SharedPreset } from "@/components/settings/SharedPresetsSection"
import { captureVisualPreset, type VisualPresetShape, type VisualPresetValues } from "@/lib/visual-presets"
import { projectPreset, withTargetExtraCleanup, type ProjectionEditor } from "@/lib/preset-apply-projection"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import { requestPresetApply } from "@/lib/community-preset-apply"
import { requestSettingsTab } from "@/lib/settings-tab"

/** Podium badges (#1 gold, #2 silver, #3 bronze). */
const RANK_BADGE = [
  "bg-[linear-gradient(135deg,#fde68a,#f59e0b)] text-[#3b2604] border-transparent",
  "bg-[linear-gradient(135deg,#f4f4f5,#a1a1aa)] text-[#18181b] border-transparent",
  "bg-[linear-gradient(135deg,#fdba74,#b45309)] text-[#2a1205] border-transparent",
]

/**
 * Community page (MULTI_USER instances): the instance's published presets
 * ranked by likes. Anyone may like others' styles; authors rename or remove
 * their own; "Apply" opens settings on the Preset tab with the style staged
 * as a reviewable draft (same personal apply path as the Preset tab).
 */
export function CommunityView() {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const setSettingsOpen = usePSelector((v) => v.setSettingsOpen)
  const userId = usePSelector((v) => v.currentUserId)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const localConfigToken = usePSelector((v) => v.localConfigToken)
  const [demoMedia] = usePreviewDemoMedia(userId)
  const [shape, setShape] = useState<VisualPresetShape>(ed.editTargetShape === "landscape" ? "landscape" : "portrait")
  const [presets, setPresets] = useState<SharedPreset[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(false)
    try {
      const result = await http<{ presets: SharedPreset[] }>(`${sharedPresetsEndpoint}?shape=${shape}`, { signal, retries: 0 })
      if (!signal?.aborted) setPresets(result.presets)
    } catch (err) {
      if (signal?.aborted) return
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) setUnavailable(true)
      else setError(true)
    }
  }, [shape])

  useEffect(() => {
    const controller = new AbortController()
    setPresets(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Built-in ready looks: name/values/flags from the canonical entries.
  const resolve = useCallback((preset: SharedPreset): { name: string; values: VisualPresetValues; ready?: { fresh: boolean } } | null => {
    if (!preset.builtin) return preset.values ? { name: preset.name, values: preset.values } : null
    const entry = READY_PRESET_ENTRIES.find((candidate) => candidate.id === preset.builtin)
    if (!entry) return null
    return { name: t(entry.labelKey), values: entry.desired(shape === "portrait"), ready: { fresh: entry.fresh } }
  }, [t, shape])

  // Thumbnails = the exact post-apply snapshot (shared projection).
  const live = useMemo(() => ({ ...captureVisualPreset(ed), landscape: ed.landscape }), [ed])
  const thumbUrl = useCallback((values: VisualPresetValues, ready?: { fresh: boolean }): string | null => {
    try {
      const projected = projectPreset(ed as unknown as ProjectionEditor, live, values, shape, !!ready, !!ready, ready?.fresh ?? false)
      return buildDefaultsPreviewUrlFromEditor(
        { ...ed, ...withTargetExtraCleanup(projected, shape) } as unknown as PosterEditorCtx,
        { tmdbKey, userId, configToken: localConfigToken, lang, demoMedia: demoMedia ?? null, previewShape: shape, previewFamily: null, neutralSample: true },
      ).url
    } catch {
      return null
    }
  }, [ed, live, shape, tmdbKey, userId, localConfigToken, lang, demoMedia])

  const mutate = async (id: string, method: "PATCH" | "DELETE", body: unknown): Promise<boolean> => {
    setBusyId(id)
    try {
      const result = await http<{ presets: SharedPreset[] }>(sharedPresetsEndpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 0,
      })
      setPresets(result.presets)
      return true
    } catch {
      toast.error(t("ui.sharedPresetsError"))
      return false
    } finally { setBusyId(null) }
  }

  const saveRename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) return
    if (await mutate(renaming.id, "PATCH", { id: renaming.id, name })) setRenaming(null)
  }

  const apply = (preset: SharedPreset) => {
    const resolved = resolve(preset)
    if (!resolved) return
    ed.setEditTargetShape(preset.shape)
    requestPresetApply({
      id: preset.builtin ?? preset.id, name: resolved.name, shape: preset.shape, values: resolved.values,
      ...(resolved.ready ? { ready: resolved.ready } : null),
    })
    requestSettingsTab("preset")
    setSettingsOpen(true)
  }

  return (
    <div className="pt-4 animate-fade-scale-in">
      <section className="max-w-7xl mx-auto px-4 mb-6" aria-labelledby="community-title">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="text-center md:text-left">
            <span className="hero-kicker mb-3">
              <span className="dot" aria-hidden="true" />
              {t("ui.communityNav")}
            </span>
            <h1 id="community-title" className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-50">{t("ui.communityTitle")}</h1>
            <p className="text-sm text-muted mt-1">{t("ui.communitySubtitle")}</p>
          </div>
          <div role="group" aria-label={t("ui.communityFormat")} className="flex self-center md:self-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(["portrait", "landscape"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={shape === option} onClick={() => setShape(option)}
                data-testid={`community-shape-${option}`}
                className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${shape === option ? "bg-white/15 text-foreground" : "text-zinc-400 hover:text-zinc-200"}`}>
                {t(option === "landscape" ? "ui.posterShapeLandscape" : "ui.posterShapePortrait")}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 pb-28 md:pb-10" data-testid="community-view">
        {unavailable ? (
          <p className="text-sm text-muted" data-testid="community-unavailable">{t("ui.communityUnavailable")}</p>
        ) : error ? (
          <div className="flex items-center gap-3">
            <p role="alert" className="text-sm text-muted">{t("ui.sharedPresetsError")}</p>
            <button type="button" onClick={() => void load()} className="text-sm text-accent-orange cursor-pointer">{t("ui.retry")}</button>
          </div>
        ) : presets === null ? (
          <p role="status" className="text-sm text-muted">{t("ui.loading")}</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted" data-testid="community-empty">{t("ui.communityEmpty")}</p>
        ) : (
          <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3" data-testid="community-ranking">
            {presets.map((preset, index) => {
              const resolved = resolve(preset)
              if (!resolved) return null
              const thumb = thumbUrl(resolved.values, resolved.ready)
              const busy = busyId === preset.id
              const isRenaming = renaming?.id === preset.id
              return (
                <li key={preset.id} data-testid={`community-preset-${preset.id}`}
                  className={`group relative flex flex-col rounded-2xl border p-2.5 bg-gradient-to-b from-white/[0.06] to-white/[0.015] transition duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40 ${index < 3 ? "border-accent-orange/35 hover:border-accent-orange/60" : "border-white/10 hover:border-white/20"}`}>
                  <span aria-hidden="true" className={`relative block w-full rounded-xl border border-white/10 bg-zinc-950/80 overflow-hidden ${shape === "landscape" ? "aspect-video" : "aspect-[2/3]"}`}>
                    <span className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]">
                      {thumb ? <PresetThumbnail url={thumb} /> : null}
                    </span>
                  </span>

                  {isRenaming ? (
                    <form className="mt-2.5 flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); void saveRename() }}>
                      <input autoFocus value={renaming.name} maxLength={40} disabled={busy}
                        aria-label={t("ui.visualPresetName")}
                        data-testid={`community-rename-input-${preset.id}`}
                        onChange={(event) => setRenaming({ id: preset.id, name: event.target.value })}
                        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenaming(null) } }}
                        className="min-w-0 flex-1 h-9 rounded-lg bg-surface2/60 border border-white/10 px-2 text-xs text-zinc-200 outline-none focus:border-accent-orange/50" />
                      <button type="submit" disabled={busy || !renaming.name.trim()} aria-label={t("ui.communityRenameSave")} className="h-9 w-9 flex items-center justify-center rounded-lg text-accent-orange hover:bg-white/[0.06] cursor-pointer disabled:opacity-50">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} aria-label={t("ui.cancel")} className="h-9 w-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[0.06] cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <div className="mt-2.5 flex items-center gap-2 min-w-0 min-h-9">
                      <span className={`shrink-0 flex items-center justify-center h-7 min-w-7 px-1.5 rounded-lg border text-[11px] font-bold tabular-nums ${RANK_BADGE[index] ?? "bg-white/[0.05] border-white/10 text-zinc-300"}`}>
                        #{index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-tight text-foreground" title={resolved.name}>{resolved.name}</p>
                        {(preset.mine || preset.builtin || preset.authorName) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium leading-none">
                            {preset.mine && <span className="text-accent-orange">{t("ui.sharedPresetMine")}</span>}
                            {preset.authorName && <span className="truncate text-zinc-400">{t("ui.sharedPresetBy", { name: preset.authorName })}</span>}
                            {preset.builtin && (
                              <span className="text-zinc-400" data-testid={`community-builtin-${preset.id}`}>{t("ui.communityBuiltin")}</span>
                            )}
                          </p>
                        )}
                      </div>
                      {preset.mine && (
                        <button type="button" disabled={busy} aria-label={`${t("ui.communityRename")} ${resolved.name}`} title={t("ui.communityRename")}
                          data-testid={`community-rename-${preset.id}`}
                          onClick={() => setRenaming({ id: preset.id, name: preset.name })}
                          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-accent-orange hover:bg-white/[0.06] cursor-pointer disabled:opacity-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {preset.canRemove && (
                        <button type="button" disabled={busy} aria-label={`${t("ui.sharedPresetUnpublish")} ${resolved.name}`} title={t("ui.sharedPresetUnpublish")}
                          data-testid={`community-remove-${preset.id}`}
                          onClick={() => void mutate(preset.id, "DELETE", { id: preset.id })}
                          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-950/60 cursor-pointer disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-stretch gap-1 sm:gap-1.5">
                    <button type="button" disabled={busy || preset.mine}
                      aria-pressed={preset.likedByMe}
                      aria-label={`${t(preset.likedByMe ? "ui.communityUnlike" : "ui.communityLike")} ${resolved.name}`}
                      title={preset.mine ? t("ui.communityOwnLike") : t(preset.likedByMe ? "ui.communityUnlike" : "ui.communityLike")}
                      data-testid={`community-like-${preset.id}`}
                      onClick={() => void mutate(preset.id, "PATCH", { id: preset.id, like: !preset.likedByMe })}
                      className={`shrink-0 flex items-center justify-center gap-1 h-10 px-2 sm:min-w-[3.25rem] sm:px-2.5 rounded-xl border text-xs font-semibold tabular-nums transition-colors cursor-pointer active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 ${preset.likedByMe ? "text-rose-300 bg-rose-500/15 border-rose-400/30 hover:bg-rose-500/20" : "text-zinc-300 bg-white/[0.04] border-white/10 hover:bg-white/[0.08] hover:text-rose-300 disabled:hover:bg-white/[0.04] disabled:hover:text-zinc-300 disabled:opacity-60"}`}>
                      <Heart className={`w-4 h-4 ${preset.likedByMe ? "fill-current" : ""}`} aria-hidden="true" />{preset.likeCount}
                    </button>
                    <button type="button" disabled={busy} onClick={() => apply(preset)}
                      data-testid={`community-apply-${preset.id}`}
                      className="btn-primary flex-1 min-w-0 h-10 gap-1.5 px-2 sm:px-3 text-xs cursor-pointer">
                      <Wand2 className="hidden sm:block w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{t("ui.communityApply")}</span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
