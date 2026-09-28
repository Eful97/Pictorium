"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { t, getLang, setLang } from "@/lib/i18n"
import { currentPathUuid } from "@/lib/user-token"
import {
  downloadPresetFile,
  listPublicPresets,
  presetPreviewUrl,
  type PresetListItem,
} from "@/lib/presets-client"

export default function PresetsPage() {
  const [, setLangTick] = useState(0)
  const [uuid, setUuid] = useState<string | null>(null)
  const [sort, setSort] = useState<"downloads" | "newest">("downloads")
  const [q, setQ] = useState("")
  const [tag, setTag] = useState("")
  const [target, setTarget] = useState<"" | "top" | "genre">("")
  const [items, setItems] = useState<PresetListItem[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("pictorium-lang")
      if (saved && saved !== getLang()) {
        setLang(saved)
        setLangTick((n) => n + 1)
      }
    } catch {
      /* storage indisponibile: lingua di default */
    }
    setUuid(currentPathUuid())
  }, [])

  const load = useCallback(
    async (cursor: number | null, append: boolean) => {
      if (cursor === null && append) return
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const page = await listPublicPresets({
          sort,
          q: q.trim() || undefined,
          tag: tag.trim() || undefined,
          target: target || undefined,
          limit: 24,
          cursor: cursor ?? 0,
        })
        setItems((prev) => (append ? [...prev, ...page.items] : page.items))
        setNextCursor(page.nextCursor)
      } catch {
        setError("load")
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [sort, q, tag, target],
  )

  useEffect(() => {
    const timer = setTimeout(() => void load(null, false), q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const applyHref = (id: string): string => {
    const base = `/lab/badges?apply=${encodeURIComponent(id)}`
    return uuid ? `${base}&u=${encodeURIComponent(uuid)}` : base
  }

  const onDownload = async (id: string): Promise<void> => {
    setBusyId(id)
    try {
      await downloadPresetFile(id)
      // Il conteggio si aggiorna al prossimo reload (best-effort, mai bloccante).
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link
          href={uuid ? `/u/${encodeURIComponent(uuid)}/configure` : "/"}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-accent transition-colors mb-6"
        >
          ← Pictorium
        </Link>
        <h1 className="text-2xl font-bold mb-1">{t("ui.presetsTitle")}</h1>
        <p className="text-sm text-zinc-500 mb-6">{t("ui.presetsSubtitle")}</p>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "downloads" | "newest")}
            className="editor-input px-2 py-1.5 cursor-pointer text-xs"
            aria-label={t("ui.presetsSort")}
          >
            <option value="downloads">{t("ui.presetsSortDownloads")}</option>
            <option value="newest">{t("ui.presetsSortNewest")}</option>
          </select>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as "" | "top" | "genre")}
            className="editor-input px-2 py-1.5 cursor-pointer text-xs"
            aria-label={t("ui.presetsTarget")}
          >
            <option value="">{t("ui.presetsAllTargets")}</option>
            <option value="top">top</option>
            <option value="genre">genre</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ui.presetsSearch")}
            maxLength={60}
            className="editor-input px-2.5 py-1.5 text-xs flex-1 min-w-40"
          />
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t("ui.presetsTag")}
            maxLength={20}
            className="editor-input px-2.5 py-1.5 text-xs w-32"
          />
        </div>

        {loading && <p className="text-zinc-400 mt-4">{t("ui.loading")}</p>}
        {error && <p className="text-red-400 mt-4">{t("ui.presetsError")}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-zinc-500 mt-4 text-sm">{t("ui.presetsEmpty")}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(({ preset, downloads }) => (
            <div
              key={preset.id}
              className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3 shadow-sm"
            >
              <div className="flex items-center justify-center min-h-16 rounded-lg bg-black/40 px-2 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={presetPreviewUrl(preset.id)}
                  alt={preset.metadata.name}
                  loading="lazy"
                  className="max-w-full h-auto"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{preset.metadata.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface2/70 text-zinc-300 shrink-0">
                    {preset.target}
                  </span>
                </div>
                {preset.metadata.description && (
                  <p className="text-xs text-zinc-500 truncate mt-0.5">{preset.metadata.description}</p>
                )}
                <p className="text-[11px] text-zinc-500 mt-1">
                  ↓ {downloads} · {preset.metadata.tags.slice(0, 3).map((tg) => `#${tg}`).join(" ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={applyHref(preset.id)}
                  className="flex-1 text-center text-xs font-semibold px-2 py-1.5 rounded-lg bg-accent-orange/15 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/25 transition-colors"
                >
                  {t("ui.presetsApply")}
                </Link>
                <button
                  type="button"
                  disabled={busyId === preset.id}
                  onClick={() => void onDownload(preset.id)}
                  className="flex-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors disabled:opacity-50"
                >
                  {t("ui.presetsDownload")}
                </button>
              </div>
            </div>
          ))}
        </div>

        {nextCursor !== null && !loading && (
          <div className="flex justify-center mt-6">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load(nextCursor, true)}
              className="text-xs font-medium px-4 py-2 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors disabled:opacity-50"
            >
              {loadingMore ? t("ui.loading") : t("ui.presetsLoadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
