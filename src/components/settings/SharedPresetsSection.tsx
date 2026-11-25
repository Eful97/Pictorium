"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { ChevronDown, Heart, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { ApiError, http } from "@/lib/http"
import { PresetThumbnail } from "@/components/settings/VisualPresetsSection"
import type { VisualPresetShape, VisualPresetValues } from "@/lib/visual-presets"

export const sharedPresetsEndpoint = "/api/defaults/presets/shared"

/** Mirrors the server cap (shared-preset-store.ts); duplicated to keep server code out of the client bundle. */
export const MAX_AUTHOR_NAME = 24

export interface SharedPreset {
  id: string
  name: string
  /** Credit chosen by the author; null = anonymous. */
  authorName: string | null
  shape: VisualPresetShape
  /** null for built-in ready looks (`builtin` = ready-look id). */
  values: VisualPresetValues | null
  builtin?: string
  mine: boolean
  canRemove: boolean
  likeCount: number
  likedByMe: boolean
}

/**
 * Instance gallery (MULTI_USER only): presets published by this instance's
 * users. Click applies (same path as a personal preset); the author (or an
 * admin, moderation) can unpublish. Hidden when the server refuses the caller.
 */
export function SharedPresetsSection({ shape, refreshKey, limit, onSeeAll, collapsible = false, thumbnailFor, onApply }: {
  /** Title toggles the list, closed by default (Preset tab). */
  collapsible?: boolean
  shape: VisualPresetShape
  /** Bumped by the parent after a publish so the list reloads. */
  refreshKey: number
  /** Show only the top N of the ranking (server order: most liked first). */
  limit?: number
  /** "See all" link to the community page. */
  onSeeAll?: () => void
  thumbnailFor: (values: VisualPresetValues) => string | null
  onApply: (preset: SharedPreset) => void
}) {
  const { t } = useT()
  const [presets, setPresets] = useState<SharedPreset[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(!collapsible)
  const bodyId = useId()

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(false)
    try {
      const result = await http<{ presets: SharedPreset[] }>(`${sharedPresetsEndpoint}?shape=${shape}`, { signal, retries: 0 })
      // Built-in ready looks already have their own grid in this tab.
      if (!signal?.aborted) setPresets(result.presets.filter((preset) => !preset.builtin))
    } catch (err) {
      if (signal?.aborted) return
      if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) setHidden(true)
      else setError(true)
    }
  }, [shape])

  useEffect(() => {
    const controller = new AbortController()
    setPresets(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  const unpublish = async (preset: SharedPreset) => {
    setBusy(true)
    try {
      const result = await http<{ presets: SharedPreset[] }>(sharedPresetsEndpoint, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: preset.id }), retries: 0,
      })
      setPresets(result.presets.filter((entry) => !entry.builtin))
    } catch {
      toast.error(t("ui.sharedPresetsError"))
    } finally { setBusy(false) }
  }

  if (hidden) return null

  return (
    <section aria-label={t("ui.sharedPresetsTitle")} data-testid="shared-presets-section" className="space-y-3 text-xs">
      <div className="px-1">
        <div className="flex items-center justify-between gap-2">
          {collapsible ? (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={bodyId}
              data-testid="shared-presets-toggle"
              className="flex flex-1 items-center justify-between gap-1.5 min-h-[44px] text-xs font-bold text-zinc-100 cursor-pointer touch-manipulation">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />{t("ui.sharedPresetsTitle")}
              </span>
              <ChevronDown aria-hidden="true" className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
              <Users className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />{t("ui.sharedPresetsTitle")}
            </p>
          )}
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} data-testid="shared-presets-see-all" className="min-h-[44px] px-2 text-[11px] font-semibold text-accent-orange hover:underline cursor-pointer">
              {t("ui.communitySeeAll")}
            </button>
          )}
        </div>
      </div>
      <div id={bodyId} hidden={!open} className="space-y-3">
      <p className="text-[11px] text-muted -mt-2 px-1">{t("ui.sharedPresetsHint")}</p>
      {error ? (
        <div className="flex items-center gap-2 px-1">
          <p role="alert" className="text-muted">{t("ui.sharedPresetsError")}</p>
          <button type="button" onClick={() => void load()} className="text-accent-orange cursor-pointer">{t("ui.retry")}</button>
        </div>
      ) : presets === null ? (
        <p role="status" className="text-muted px-1">{t("ui.loading")}</p>
      ) : presets.length === 0 ? (
        <p className="text-muted text-[11px] px-1">{t("ui.sharedPresetsEmpty")}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="shared-presets-gallery">
          {(limit ? presets.slice(0, limit) : presets).map((preset) => {
            // Collapsed = no thumbnail fetch (each tile is a real render).
            const thumb = open && preset.values ? thumbnailFor(preset.values) : null
            return (
              <div key={preset.id} className="relative">
                <button type="button" disabled={busy} title={preset.name}
                  data-testid={`shared-preset-${preset.id}`}
                  onClick={() => onApply(preset)}
                  className="w-full flex flex-col text-left p-2.5 rounded-xl border bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground transition cursor-pointer disabled:opacity-50 min-h-[44px]">
                  <span aria-hidden="true" className={`mx-auto max-w-full shrink-0 rounded-lg border border-white/10 bg-zinc-950/80 mb-1.5 overflow-hidden ${shape === "landscape" ? "w-28 sm:w-36 lg:w-40 aspect-video" : "w-16 sm:w-20 lg:w-24 aspect-[2/3]"}`}>
                    {thumb ? <PresetThumbnail url={thumb} /> : null}
                  </span>
                  <span className="flex items-center justify-between w-full gap-1">
                    <span className="min-w-0">
                      <span className="block font-semibold text-xs text-foreground truncate">{preset.name}</span>
                      {preset.authorName && <span className="block text-[10px] text-zinc-500 truncate">{t("ui.sharedPresetBy", { name: preset.authorName })}</span>}
                    </span>
                    <span className="flex items-center gap-1 shrink-0 text-[10px]">
                      {preset.mine && <span className="text-accent-orange">{t("ui.sharedPresetMine")}</span>}
                      <span className="flex items-center gap-0.5 text-zinc-400" aria-label={`${preset.likeCount} ${t("ui.communityLikes")}`}>
                        <Heart className="w-3 h-3" aria-hidden="true" />{preset.likeCount}
                      </span>
                    </span>
                  </span>
                </button>
                {preset.canRemove && (
                  <button type="button" disabled={busy}
                    data-testid={`shared-preset-unpublish-${preset.id}`}
                    aria-label={`${t("ui.sharedPresetUnpublish")} ${preset.name}`} title={`${t("ui.sharedPresetUnpublish")} ${preset.name}`}
                    onClick={() => void unpublish(preset)}
                    className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#202024] text-zinc-400 hover:border-red-400/40 hover:bg-red-950 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>
    </section>
  )
}
