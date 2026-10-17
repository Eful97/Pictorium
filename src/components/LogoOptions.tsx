"use client"

import React, { useEffect, useState } from "react"
import type { TMDBImage } from "@/lib/types"
import { LANG_NAMES, groupBy, limitBest, posterUrl } from "@/lib/utils"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useTvdbArtworks } from "@/lib/useTvdbArtworks"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { Check, Trash2, ChevronDown, Loader2, X } from "lucide-react"

interface Props {
  logos: TMDBImage[]
  selectedLogo: TMDBImage | null
  lang: string
  selectLogo: (img: TMDBImage) => void
  removeLogo: () => void
  disabled?: boolean
  /** Session custom logo tiles (external URLs, first in the grid, removable). */
  customLogos?: TMDBImage[]
  /** Saved custom logo from the mapping (in the grid without removal: via the box). */
  savedCustomLogo?: TMDBImage | null
  /** Session tile removal (customLogos only, never the saved tile). */
  onRemoveCustomLogo?: (filePath: string) => void
  /** Slot for the URL import box (below the tabs, above the grid). */
  topSlot?: React.ReactNode
}

export const LogoOptions = React.memo(function LogoOptions({ logos, selectedLogo, lang, selectLogo, removeLogo, disabled, customLogos = [], savedCustomLogo = null, onRemoveCustomLogo, topSlot }: Props) {
  const { t } = useT()
  const { logoDisabled, setLogoDisabled } = usePosterEditor()
  const selected = usePSelector((v) => v.selected)
  const [activeLogoGroup, setActiveLogoGroup] = useState("all")
  const [visibleLogoCount, setVisibleLogoCount] = useState(10)
  // Sorgente provider (TMDB | TVDB): solo a titolo selezionato; TVDB lazy
  // all'apertura, fetch condivisa con le altre gallery (vedi useTvdbArtworks).
  const [source, setSource] = useState<"tmdb" | "tvdb">("tmdb")
  const tvdb = useTvdbArtworks(source === "tvdb" && !!selected, "logos")

  useEffect(() => {
    setVisibleLogoCount(10)
  }, [logos, activeLogoGroup, lang, source])

  if (logos.length === 0 && !selected) return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center">
      <p className="text-xs text-zinc-300 font-medium leading-relaxed">{t("ui.noLogosAvailable")}</p>
    </div>
  )
  const groups = groupBy(logos, (img) => img.iso_639_1 || "xx")
  const langGroups = Object.entries(groups).sort(([a], [b]) => {
    if (a === lang) return -1; if (b === lang) return 1
    if (a === "en") return -1; if (b === "en") return 1
    return a.localeCompare(b)
  })

  const logoTabs = [
    { key: "all", label: t("ui.all"), count: logos.length },
    { key: lang, label: LANG_NAMES[lang] || lang, count: groups[lang]?.length ?? 0 },
    ...(lang !== "en" ? [{ key: "en", label: "English", count: groups["en"]?.length ?? 0 }] : []),
    { key: "xx", label: t("ui.withoutLanguage"), count: groups["xx"]?.length ?? 0 },
  ].filter((tab) => tab.count > 0 || tab.key === "all")

  const visibleLogoGroups = activeLogoGroup === "all"
    ? langGroups
    : langGroups.filter(([language]) => language === activeLogoGroup)

  const totalAvailableLogos = visibleLogoGroups.reduce((acc, [, imgs]) => acc + imgs.length, 0)

  let renderedLogosCount = 0

  return (
    <div>
      {topSlot}
      {(customLogos.length > 0 || savedCustomLogo) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {/* Session custom tiles: first in the grid, with a remove button. */}
          {customLogos.map((img) => {
            const isActive = selectedLogo?.file_path === img.file_path
            return (
              <div key={`custom:${img.file_path}`} className="relative group">
                <button type="button" disabled={disabled} onClick={() => selectLogo(img)} className={`poster-tile group relative p-2 rounded-xl transition-all duration-200 ease-out flex items-center justify-center h-20 w-full ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${isActive ? "poster-tile-active bg-accent-orange/10" : ""}`} title={t("ui.customLogoActive")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- custom absolute URL */}
                  <img src={posterUrl(img.file_path, "w154")} alt="" loading="lazy" decoding="async" className="max-h-14 max-w-full object-contain transition-transform duration-200 group-hover:scale-110" />
                  {isActive && <div className="absolute top-1 right-1 rounded-md bg-accent-orange text-white p-0.5 shadow-sm shadow-accent-orange/40"><Check className="w-3 h-3" /></div>}
                </button>
                {onRemoveCustomLogo && (
                  <div className="absolute top-1.5 right-1.5 z-20 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button type="button"
                      aria-label={t("ui.remove")}
                      title={t("ui.remove")}
                      disabled={disabled}
                      onClick={(e) => { e.stopPropagation(); onRemoveCustomLogo(img.file_path) }}
                      className={`poster-image-action w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 bg-black/55 border-white/10 text-zinc-300 hover:bg-red-500/90 hover:text-white hover:border-red-400/60 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {/* Saved custom tile: in the grid without removal (via the box). */}
          {savedCustomLogo && (
            <div key={`custom-saved:${savedCustomLogo.file_path}`} className="relative group">
              <button type="button" disabled={disabled} onClick={() => selectLogo(savedCustomLogo)} className={`poster-tile group relative p-2 rounded-xl transition-all duration-200 ease-out flex items-center justify-center h-20 w-full ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${selectedLogo?.file_path === savedCustomLogo.file_path ? "poster-tile-active bg-accent-orange/10" : ""}`} title={t("ui.customLogoActive")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- custom absolute URL */}
                <img src={posterUrl(savedCustomLogo.file_path, "w154")} alt="" loading="lazy" decoding="async" className="max-h-14 max-w-full object-contain transition-transform duration-200 group-hover:scale-110" />
                {selectedLogo?.file_path === savedCustomLogo.file_path && <div className="absolute top-1 right-1 rounded-md bg-accent-orange text-white p-0.5 shadow-sm shadow-accent-orange/40"><Check className="w-3 h-3" /></div>}
              </button>
            </div>
          )}
        </div>
      )}
      {selected && (
        <div className="flex gap-1 mb-2 overflow-x-auto scrollbar-none">
          <button type="button"
            aria-label={t("ui.tmdb")}
            onClick={() => setSource("tmdb")}
            className={`tab-chip h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-all shrink-0 ${source === "tmdb" ? "tab-chip-active bg-accent-orange/15 text-accent-orange border-accent-orange/35" : "bg-white/5 text-muted border-white/10 hover:text-zinc-200 hover:bg-white/10"}`}
          >
            {t("ui.tmdb")}
            <span className="ml-1 text-[10px] opacity-60">{logos.length}</span>
          </button>
          <button type="button"
            aria-label={t("ui.tvdbTitle")}
            onClick={() => setSource("tvdb")}
            className={`tab-chip h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-all shrink-0 ${source === "tvdb" ? "tab-chip-active bg-accent-orange/15 text-accent-orange border-accent-orange/35" : "bg-white/5 text-muted border-white/10 hover:text-zinc-200 hover:bg-white/10"}`}
          >
            {t("ui.tvdbTitle")}
            <span className="ml-1 text-[10px] opacity-60">{tvdb.items.length}</span>
          </button>
        </div>
      )}
      {source === "tvdb" && selected ? (
        <div data-testid="tvdb-logos-panel">
          {(tvdb.status === "idle" || tvdb.status === "loading") && (
            <p className="flex items-center justify-center gap-1.5 py-12 text-[11px] text-zinc-500" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              {t("ui.tvdbLoading")}
            </p>
          )}
          {tvdb.status === "empty" && (
            <p className="py-12 text-center text-[11px] text-zinc-500">{t("ui.tvdbEmptyLogos")}</p>
          )}
          {tvdb.status === "not_configured" && (
            <p className="py-12 px-2 text-center text-[11px] text-zinc-500 leading-relaxed">{t("ui.tvdbNotConfigured")}</p>
          )}
          {tvdb.status === "unavailable" && (
            <div className="py-8 text-center">
              <p className="text-[11px] text-zinc-500">{t("ui.tvdbUnavailable")}</p>
              <button
                type="button"
                onClick={() => tvdb.reload()}
                className="mt-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
              >
                {t("ui.retry")}
              </button>
            </div>
          )}
          {tvdb.status === "ready" && (
            <div className="grid grid-cols-2 gap-2">
              {tvdb.items.map((img, idx) => {
                const m = tvdb.meta[idx]
                const lang = m?.language ?? null
                const langLabel = !lang ? t("ui.fanartLangUnknown") : lang.toUpperCase()
                const isActive = selectedLogo?.file_path === img.file_path
                return (
                  <button type="button" key={img.file_path} disabled={disabled} onClick={() => selectLogo(img)} className={`poster-tile group relative p-2 rounded-xl transition-all duration-200 ease-out flex items-center justify-center h-20 ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${isActive ? "poster-tile-active bg-accent-orange/10" : ""}`} title={`${t("ui.tvdbTitle")} · ${langLabel}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- TVDB absolute URL */}
                    <img src={m?.thumbnail ?? img.file_path} alt="" loading="lazy" decoding="async" className="max-h-14 max-w-full object-contain transition-transform duration-200 group-hover:scale-110" />
                    <span className="absolute top-1 left-1 z-20 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200 backdrop-blur-md border border-white/10 pointer-events-none">
                      <RatingSourceIcon id="tvdb" className="w-3 h-3" />
                      {t("ui.tvdbTitle")}
                    </span>
                    {isActive && <div className="absolute top-1 right-1 rounded-md bg-accent-orange text-white p-0.5 shadow-sm shadow-accent-orange/40"><Check className="w-3 h-3" /></div>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : logos.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center">
          <p className="text-xs text-zinc-300 font-medium leading-relaxed">{t("ui.noLogosAvailable")}</p>
        </div>
      ) : (
        <>
      <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-none">
        {logoTabs.map((tab) => (
          <button type="button"
            aria-label={tab.label}
            key={tab.key}
            onClick={() => setActiveLogoGroup(tab.key)}
            className={`tab-chip h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-all shrink-0 ${activeLogoGroup === tab.key ? "tab-chip-active bg-accent-orange/15 text-accent-orange border-accent-orange/35" : "bg-white/5 text-muted border-white/10 hover:text-zinc-200 hover:bg-white/10"}`}
          >
            {tab.label}
            <span className="ml-1 text-[10px] opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>
      {visibleLogoGroups.length === 0 ? (
        <p className="py-8 text-center text-xs text-zinc-500">{t("ui.noLogoInLanguage")}</p>
      ) : (
        visibleLogoGroups.map(([language, imgs]) => {
          const quotaLeft = visibleLogoCount - renderedLogosCount
          if (quotaLeft <= 0) return null
          const best = limitBest(imgs).slice(0, quotaLeft)
          if (best.length === 0) return null
          renderedLogosCount += best.length
          return (
            <div key={language} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-px flex-1 bg-zinc-700/40" />
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider shrink-0">{LANG_NAMES[language] || language} {best.length < imgs.length ? `• ${best.length}` : ""}</h4>
                <div className="h-px flex-1 bg-zinc-700/40" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {best.map((img) => {
                  const isActive = selectedLogo?.file_path === img.file_path
                  return (
                    <button type="button" key={img.file_path} disabled={disabled} onClick={() => selectLogo(img)} className={`poster-tile group relative p-2 rounded-xl transition-all duration-200 ease-out flex items-center justify-center h-20 ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${isActive ? "poster-tile-active bg-accent-orange/10" : ""}`} title={isActive ? t("ui.logoSelected") : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL */}
                      <img src={posterUrl(img.file_path, "w154")} alt="" loading="lazy" decoding="async" className="max-h-14 max-w-full object-contain transition-transform duration-200 group-hover:scale-110" />
                      {isActive && <div className="absolute top-1 right-1 rounded-md bg-accent-orange text-white p-0.5 shadow-sm shadow-accent-orange/40"><Check className="w-3 h-3" /></div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      {totalAvailableLogos > visibleLogoCount && (
        <button
          type="button"
          aria-label={t("ui.loadMoreLogosAria")}
          onClick={() => setVisibleLogoCount((prev) => prev + 10)}
          className="btn-secondary w-full mb-3 py-2 px-3 text-xs"
        >
          <ChevronDown className="w-4 h-4" />
          {t("ui.loadMoreLogos", { count: Math.min(10, totalAvailableLogos - visibleLogoCount) })}
          <span className="text-[10px] text-zinc-500 font-normal">{t("ui.xOfY", { current: visibleLogoCount, total: totalAvailableLogos })}</span>
        </button>
      )}
        </>
      )}

      {selectedLogo && (
        <div className="editor-pill mt-3">
          <Check className="w-3 h-3" />{t("ui.logoSelected")}
        </div>
      )}
      {!selectedLogo && (
        <button type="button" aria-label={logoDisabled ? t("ui.removeLogo") : t("ui.enableLogos")} disabled={disabled} onClick={() => setLogoDisabled(!logoDisabled)} className={`mt-3 w-full h-9 rounded-lg border text-[11px] font-semibold transition-all ${disabled ? "bg-surface2/30 text-zinc-600 cursor-not-allowed border-surface2" : logoDisabled ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-surface2 bg-white/[0.03] text-muted hover:text-zinc-200 hover:border-zinc-600"}`}>
          <span className="flex items-center justify-center gap-1.5">{logoDisabled ? t("ui.logosDisabled") : t("ui.disableLogos")}</span>
        </button>
      )}
      {selectedLogo && (
        <button type="button" aria-label={t("ui.removeLogo")} disabled={disabled} onClick={removeLogo} className={`mt-2 w-full h-9 rounded-lg border text-[11px] font-semibold transition-all ${disabled ? "bg-surface2/30 text-zinc-600 cursor-not-allowed border-surface2" : "border-surface2 bg-white/[0.03] text-muted hover:text-red-300 hover:border-red-500/30"}`}>
          <span className="flex items-center justify-center gap-1.5"><Trash2 className="w-3 h-3" />{t("ui.removeLogo")}</span>
        </button>
      )}
    </div>
  )
})
