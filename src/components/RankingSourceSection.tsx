"use client"

import { useState, useRef } from "react"
import { Trophy, Info, Film, Tv, ChevronDown, Loader2, Check } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getRegionDef } from "@/lib/regions"
import { resolveRankingSource, compatibleRankingCustoms } from "@/lib/ranking-source"
import { useOutsideDismiss } from "@/lib/useOutsideDismiss"
import type { RankingSlotKey } from "@/lib/useRankingSources"
import type { CustomCatalogConfig } from "@/lib/types"

function SlotSelect({
  id,
  label,
  slot,
  mediaType,
  options,
  value,
  disabled,
  onPick,
}: {
  id: string
  label: string
  slot: RankingSlotKey
  mediaType: "movie" | "series"
  options: CustomCatalogConfig[]
  value: string
  disabled: boolean
  onPick: (slot: RankingSlotKey, value: string) => void
}) {
  const { t } = useT()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useOutsideDismiss({
    active: isOpen,
    ref: containerRef,
    onDismiss: () => setIsOpen(false),
  })

  const activeCustom = options.find((c) => c.id === value)
  const isCustom = Boolean(activeCustom)
  const displayLabel = activeCustom ? activeCustom.name : t("ui.rankingSourceJW")

  const handleSelect = (newVal: string) => {
    onPick(slot, newVal)
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false)
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`relative flex items-center ${isOpen ? "z-30" : "z-10"}`}
    >
      {/* Visual trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-150 cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-white/30 ${
          isCustom
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
            isCustom ? "text-accent-orange font-semibold" : "text-zinc-400 group-hover:text-zinc-200"
          }`}
        >
          {displayLabel}
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
          className="absolute left-0 top-full mt-2 z-50 min-w-[200px] w-max max-w-[calc(100vw-2rem)] sm:max-w-[280px] rounded-xl bg-zinc-950/95 backdrop-blur-2xl border border-white/10 p-1.5 shadow-2xl shadow-black/80 animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {/* Default JustWatch option */}
          <button
            type="button"
            role="option"
            aria-selected={value === ""}
            onClick={() => handleSelect("")}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
              value === ""
                ? "bg-accent-orange/15 text-accent-orange font-semibold"
                : "text-zinc-300 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            <span className="truncate">{t("ui.rankingSourceJW")}</span>
            {value === "" && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
          </button>

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
                <span className="truncate">{c.name}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Accessible native select for full programmatic & test compatibility */}
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
        <option value="">{t("ui.rankingSourceJW")}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
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
export function RankingSourceSection() {
  const { t } = useT()
  const ed = usePosterEditor()
  const regionFlag = getRegionDef(ed.defaultRegion).flag
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const rankingSourceMovie = usePSelector((v) => v.rankingSourceMovie)
  const rankingSourceSeries = usePSelector((v) => v.rankingSourceSeries)
  const setRankingSource = usePSelector((v) => v.setRankingSource)
  const [saving, setSaving] = useState<null | RankingSlotKey>(null)

  const selection = { customCatalogs, rankingSourceMovie, rankingSourceSeries }
  const movieSource = resolveRankingSource(selection, "movie")
  const seriesSource = resolveRankingSource(selection, "series")
  const movieValue = movieSource.kind === "custom" ? movieSource.customId : ""
  const seriesValue = seriesSource.kind === "custom" ? seriesSource.customId : ""
  const movieOptions = compatibleRankingCustoms(customCatalogs, "movie")
  const seriesOptions = compatibleRankingCustoms(customCatalogs, "series")

  const onPick = async (slot: RankingSlotKey, value: string) => {
    if (saving) return
    setSaving(slot)
    try {
      // trendRank/badge/poster follow via the save nonces (effect in context):
      // no explicit refresh here, it would double-fetch.
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
            value={movieValue}
            disabled={saving !== null}
            onPick={onPick}
          />
          <SlotSelect
            id="ranking-source-series"
            label={`${t("ui.tvSeries")} — Top 20`}
            slot="series"
            mediaType="series"
            options={seriesOptions}
            value={seriesValue}
            disabled={saving !== null}
            onPick={onPick}
          />
        </div>

        {/* Info popover */}
        <RankingInfoPopover
          regionFlag={regionFlag}
          movieOptionsCount={movieOptions.length}
          seriesOptionsCount={seriesOptions.length}
        />
      </div>
    </section>
  )
}
