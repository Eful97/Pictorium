"use client"

import { useState, useRef } from "react"
import { Trophy, Info, Film, Tv, ChevronDown, Loader2, Check, AlertCircle } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getRegionDef, GLOBAL_REGION_CODE } from "@/lib/regions"
import {
  resolveRankingSource,
  compatibleRankingCustoms,
  compatibleRankingStreaming,
  resolveCatalogDisplayName,
  RANKING_SOURCE_JW_POPULAR,
  RANKING_SOURCE_JW_TRENDING,
  type RankingStreamingOption,
} from "@/lib/ranking-source"
import { useOutsideDismiss } from "@/lib/useOutsideDismiss"
import { parseAnyStreamingCatalogId } from "@/lib/streaming-catalogs"
import type { RankingSlotKey } from "@/lib/useRankingSources"
import type { CustomCatalogConfig } from "@/lib/types"

function SlotSelect({
  id,
  label,
  slot,
  mediaType,
  options,
  streamingOptions,
  value,
  disabled,
  isGlobal,
  isIncompatible,
  onPick,
}: {
  id: string
  label: string
  slot: RankingSlotKey
  mediaType: "movie" | "series"
  options: CustomCatalogConfig[]
  streamingOptions: RankingStreamingOption[]
  value: string
  disabled: boolean
  isGlobal: boolean
  isIncompatible: boolean
  onPick: (slot: RankingSlotKey, value: string) => void
}) {
  const { t } = useT()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Nomi custom dinamici seguono la visibilità emoji (solo display).
  const showEmojis = usePSelector((v) => v.catalogShowEmojis)

  useOutsideDismiss({
    active: isOpen,
    ref: containerRef,
    onDismiss: () => setIsOpen(false),
  })

  // Imported Top 10 lists share the neutral manifest name between the movie
  // and series sections: the section suffix (existing i18n labels) is the
  // only disambiguator in the picker.
  const streamingLabel = (opt: RankingStreamingOption) => {
    const section =
      opt.section === "movies"
        ? t("ui.movie")
        : opt.section === "series"
          ? t("ui.tvSeries")
          : t("ui.streamSectionMixed")
    const desc = parseAnyStreamingCatalogId(opt.id)
    const policy = desc?.source === "flixpatrol"
      ? t("ui.streamSourceOnlyFp")
      : desc?.source === "justwatch"
        ? t("ui.streamSourceOnlyJw")
        : t("ui.streamSourceAuto")
    return [opt.name, section, policy, desc?.variant].filter(Boolean).join(" · ")
  }

  const activeCustom = options.find((c) => c.id === value)
  const activeStreaming = streamingOptions.find((o) => o.id === value)
  const isCustom = Boolean(activeCustom) || Boolean(activeStreaming)

  let displayLabel: string
  if (activeCustom) {
    displayLabel = resolveCatalogDisplayName(activeCustom.name, showEmojis)
  } else if (activeStreaming) {
    displayLabel = resolveCatalogDisplayName(streamingLabel(activeStreaming), showEmojis)
  } else if (value === RANKING_SOURCE_JW_POPULAR) {
    displayLabel = t("ui.rankingSourceJWPopular")
  } else if (value === RANKING_SOURCE_JW_TRENDING) {
    displayLabel = t("ui.rankingSourceJWTrending")
  } else {
    displayLabel = t("ui.rankingSourceJWCharts")
  }

  const handleSelect = (newVal: string) => {
    onPick(slot, newVal)
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false)
    }
  }

  const builtinOptions = [
    {
      id: "",
      label: t("ui.rankingSourceJWCharts"),
      desc: t("ui.rankingSourceJWChartsDesc"),
      disabled: false,
    },
    {
      id: RANKING_SOURCE_JW_POPULAR,
      label: t("ui.rankingSourceJWPopular"),
      desc: t("ui.rankingSourceJWPopularDesc"),
      disabled: isGlobal,
      disabledReason: isGlobal ? t("ui.rankingSourceGlobalUnsupported") : undefined,
    },
    {
      id: RANKING_SOURCE_JW_TRENDING,
      label: t("ui.rankingSourceJWTrending"),
      desc: t("ui.rankingSourceJWTrendingDesc"),
      disabled: isGlobal,
      disabledReason: isGlobal ? t("ui.rankingSourceGlobalUnsupported") : undefined,
    },
  ]

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`relative flex flex-col ${isOpen ? "z-30" : "z-10"}`}
    >
      {/* Visual trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-150 cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-white/30 ${
          isIncompatible
            ? "bg-amber-500/10 border-amber-500/40 text-amber-200 hover:border-amber-500/60 hover:bg-amber-500/15"
            : isCustom
              ? "bg-accent-orange/15 border-accent-orange/30 text-zinc-100 hover:border-accent-orange/50 hover:bg-accent-orange/20"
              : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
        } ${disabled ? "opacity-50 cursor-wait" : ""}`}
      >
        <span
          className="flex items-center justify-center w-5 h-5 rounded-lg bg-white/5 text-zinc-400 group-hover:text-zinc-200 transition-colors"
          aria-hidden="true"
        >
          {mediaType === "movie" ? <Film className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
        </span>

        <span className="font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
          {label}
        </span>

        <span className="h-3 w-px bg-white/10" aria-hidden="true" />

        <span
          className={`truncate max-w-[130px] sm:max-w-[170px] ${
            isIncompatible
              ? "text-amber-300 font-semibold"
              : isCustom
                ? "text-accent-orange font-semibold"
                : "text-zinc-400 group-hover:text-zinc-200"
          }`}
        >
          {displayLabel}
          {isIncompatible && (
            <span className="ml-1 text-[10px] text-amber-400 font-normal">
              ({t("ui.rankingSourceIncompatibleBadge")})
            </span>
          )}
        </span>

        <span className="ml-0.5 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200">
          {disabled ? (
            <Loader2 className="w-3 h-3 animate-spin text-accent-orange" />
          ) : (
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </span>
      </button>

      {/* Modern Custom Dropdown Menu ("la tendina") */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-2 z-50 min-w-[240px] w-max max-w-[calc(100vw-2rem)] sm:max-w-[320px] rounded-xl bg-zinc-950/95 backdrop-blur-2xl border border-white/10 p-1.5 shadow-2xl shadow-black/80 animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {/* Built-in JustWatch options */}
          <div className="space-y-0.5">
            {builtinOptions.map((opt) => {
              const isSelected = value === opt.id
              const isOptDisabled = Boolean(opt.disabled)
              return (
                <button
                  key={opt.id || "charts"}
                  type="button"
                  role="option"
                  disabled={isOptDisabled}
                  aria-selected={isSelected}
                  onClick={() => !isOptDisabled && handleSelect(opt.id)}
                  className={`w-full flex flex-col gap-0.5 px-3 py-2 rounded-lg text-left transition-colors ${
                    isOptDisabled
                      ? "opacity-40 cursor-not-allowed text-zinc-500"
                      : isSelected
                        ? "bg-accent-orange/15 text-accent-orange font-semibold cursor-pointer"
                        : "text-zinc-300 hover:text-white hover:bg-white/[0.08] cursor-pointer"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-medium truncate">{opt.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0 ml-1" />}
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">
                    {opt.disabledReason ? (
                      <span className="text-amber-400/90">{opt.disabledReason}</span>
                    ) : (
                      opt.desc
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Custom options */}
          {options.length > 0 && (
            <div className="my-1 border-t border-white/[0.06]" />
          )}
          {options.map((c) => {
            const isSelected = value === c.id
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(c.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                  isSelected
                    ? "bg-accent-orange/15 text-accent-orange font-semibold"
                    : "text-zinc-300 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                <span className="truncate">{resolveCatalogDisplayName(c.name, showEmojis)}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
              </button>
            )
          })}

          {/* Imported Top 10 lists (enabled + section-compatible only) */}
          {streamingOptions.length > 0 && (
            <div className="my-1 border-t border-white/[0.06]" />
          )}
          {streamingOptions.map((o) => {
            const isSelected = value === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(o.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                  isSelected
                    ? "bg-accent-orange/15 text-accent-orange font-semibold"
                    : "text-zinc-300 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                <span className="truncate">{resolveCatalogDisplayName(streamingLabel(o), showEmojis)}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Incompatibility warning note when saved selection is not supported in current region */}
      {isIncompatible && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-300/90">
          <AlertCircle className="w-3 h-3 shrink-0 text-amber-400" />
          <span>{t("ui.rankingSourceIncompatible")}</span>
        </div>
      )}

      {/* Accessible native select for programmatic & test compatibility */}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onPick(slot, e.target.value)}
        aria-describedby="ranking-source-desc"
        className="sr-only"
        tabIndex={-1}
      >
        <option value="">{t("ui.rankingSourceJWCharts")}</option>
        <option value={RANKING_SOURCE_JW_POPULAR} disabled={isGlobal}>
          {t("ui.rankingSourceJWPopular")}
        </option>
        <option value={RANKING_SOURCE_JW_TRENDING} disabled={isGlobal}>
          {t("ui.rankingSourceJWTrending")}
        </option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {resolveCatalogDisplayName(c.name, showEmojis)}
          </option>
        ))}
        {streamingOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {resolveCatalogDisplayName(streamingLabel(o), showEmojis)}
          </option>
        ))}
      </select>
    </div>
  )
}

function RankingInfoPopover({
  regionFlag,
  movieOptionsCount,
  seriesOptionsCount,
}: {
  regionFlag: string
  movieOptionsCount: number
  seriesOptionsCount: number
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)

  useOutsideDismiss({
    active: open,
    ref: detailsRef,
    onDismiss: () => {
      if (detailsRef.current) {
        detailsRef.current.open = false
      }
      setOpen(false)
    },
  })

  return (
    <details
      ref={detailsRef}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className={`relative ml-auto ${open ? "z-50" : "z-10"}`}
    >
      <summary
        aria-label={t("ui.rankingSourceTitle")}
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-400 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-white/30 [&::-webkit-details-marker]:hidden"
      >
        <Info className="h-3.5 w-3.5" />
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-72 sm:w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-zinc-950/95 p-3.5 shadow-2xl backdrop-blur-2xl">
        <div className="mb-2 flex items-center gap-2 border-b border-white/[0.08] pb-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-white/10 text-zinc-200">
            <Trophy className="h-3 w-3" />
          </div>
          <span className="text-xs font-semibold text-zinc-200">
            Top 20 {regionFlag}
          </span>
        </div>
        <p id="ranking-source-desc" className="text-xs leading-relaxed text-zinc-300">
          {t("ui.rankingSourceDesc")}
        </p>
        <div className="mt-2.5 flex items-start gap-1.5 border-t border-white/[0.06] pt-2 text-[11px] text-zinc-400">
          <span className="mt-0.5 shrink-0 text-accent-orange">•</span>
          <span>
            {movieOptionsCount === 0 && seriesOptionsCount === 0
              ? t("ui.rankingSourceEmpty")
              : t("ui.rankingSourceKeysNote")}
          </span>
        </div>
      </div>
    </details>
  )
}

/**
 * Global Top 20 source pickers (movie/series), next to the imported catalogs.
 * Rendered as an unobtrusive, modern glass pill toolbar. The shown value is
 * resolver-derived, so a deleted, disabled or type-incompatible custom always
 * displays JustWatch.
 */
export function RankingSourceSection({ regionCode }: { regionCode?: string } = {}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const activeRegionCode = regionCode || ed.defaultRegion || "IT"
  const isGlobal = activeRegionCode.toUpperCase() === GLOBAL_REGION_CODE
  const regionFlag = getRegionDef(activeRegionCode).flag
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const streamingSelections = usePSelector((v) => v.streamingSelections)
  const rankingSourceMovie = usePSelector((v) => v.rankingSourceMovie)
  const rankingSourceSeries = usePSelector((v) => v.rankingSourceSeries)
  const setRankingSource = usePSelector((v) => v.setRankingSource)
  const [saving, setSaving] = useState<null | RankingSlotKey>(null)

  const selection = { customCatalogs, streamingSelections, rankingSourceMovie, rankingSourceSeries }
  const movieSource = resolveRankingSource(selection, "movie")
  const seriesSource = resolveRankingSource(selection, "series")

  const movieValue =
    movieSource.kind === "custom" || movieSource.kind === "addon"
      ? movieSource.customId
      : movieSource.kind === "streaming"
        ? movieSource.catalogId
        : movieSource.mode === "popular"
          ? RANKING_SOURCE_JW_POPULAR
          : movieSource.mode === "trending"
            ? RANKING_SOURCE_JW_TRENDING
            : ""

  const seriesValue =
    seriesSource.kind === "custom" || seriesSource.kind === "addon"
      ? seriesSource.customId
      : seriesSource.kind === "streaming"
        ? seriesSource.catalogId
        : seriesSource.mode === "popular"
          ? RANKING_SOURCE_JW_POPULAR
          : seriesSource.mode === "trending"
            ? RANKING_SOURCE_JW_TRENDING
            : ""

  const movieOptions = compatibleRankingCustoms(customCatalogs, "movie")
  const seriesOptions = compatibleRankingCustoms(customCatalogs, "series")
  // Imported Top 10 lists: enabled + section-compatible selections only
  // (`mixed`/`all` fits both slots, official chart ranks 1..10).
  const movieStreamingOptions = compatibleRankingStreaming(streamingSelections, "movie")
  const seriesStreamingOptions = compatibleRankingStreaming(streamingSelections, "series")

  const isMovieIncompatible = isGlobal && (movieValue === RANKING_SOURCE_JW_POPULAR || movieValue === RANKING_SOURCE_JW_TRENDING)
  const isSeriesIncompatible = isGlobal && (seriesValue === RANKING_SOURCE_JW_POPULAR || seriesValue === RANKING_SOURCE_JW_TRENDING)

  const onPick = async (slot: RankingSlotKey, value: string) => {
    if (saving) return
    setSaving(slot)
    try {
      await setRankingSource(slot, value)
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="relative z-30 mb-8 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-zinc-900/80 via-zinc-900/60 to-zinc-900/80 p-2 shadow-lg shadow-black/20 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Title Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-200 font-semibold text-xs tracking-tight shrink-0">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-accent-orange" />
          <span>{t("ui.rankingSourceTitle")}</span>
          {regionFlag && <span className="text-xs leading-none">{regionFlag}</span>}
        </div>

        {/* Separator on desktop */}
        <div className="hidden sm:block h-4 w-px bg-white/10 shrink-0" aria-hidden="true" />

        {/* Interactive Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          <SlotSelect
            id="ranking-source-movies"
            label={`${t("ui.movie")} — Top 20`}
            slot="movie"
            mediaType="movie"
            options={movieOptions}
            streamingOptions={movieStreamingOptions}
            value={movieValue}
            disabled={saving !== null}
            isGlobal={isGlobal}
            isIncompatible={isMovieIncompatible}
            onPick={onPick}
          />
          <SlotSelect
            id="ranking-source-series"
            label={`${t("ui.tvSeries")} — Top 20`}
            slot="series"
            mediaType="series"
            options={seriesOptions}
            streamingOptions={seriesStreamingOptions}
            value={seriesValue}
            disabled={saving !== null}
            isGlobal={isGlobal}
            isIncompatible={isSeriesIncompatible}
            onPick={onPick}
          />
        </div>

        {/* Info popover */}
        <RankingInfoPopover
          regionFlag={regionFlag}
          movieOptionsCount={movieOptions.length + movieStreamingOptions.length}
          seriesOptionsCount={seriesOptions.length + seriesStreamingOptions.length}
        />
      </div>
    </section>
  )
}
