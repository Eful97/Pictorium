"use client"

import { useState } from "react"
import { Trophy } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getRegionDef } from "@/lib/regions"
import { resolveRankingSource, compatibleRankingCustoms } from "@/lib/ranking-source"
import type { RankingSlotKey } from "@/lib/useRankingSources"
import type { CustomCatalogConfig } from "@/lib/types"

const SELECT_CLASS =
  "max-w-[210px] truncate px-3 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer touch-manipulation disabled:opacity-50 disabled:cursor-wait"

function SlotSelect({
  id,
  label,
  slot,
  options,
  value,
  disabled,
  onPick,
}: {
  id: string
  label: string
  slot: RankingSlotKey
  options: CustomCatalogConfig[]
  value: string
  disabled: boolean
  onPick: (slot: RankingSlotKey, value: string) => void
}) {
  const { t } = useT()
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-zinc-200 text-xs sm:text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onPick(slot, e.target.value)}
        aria-label={label}
        aria-describedby="ranking-source-desc"
        className={SELECT_CLASS}
      >
        <option value="" className="bg-zinc-900 text-zinc-100">
          {t("ui.rankingSourceJW")}
        </option>
        {options.map((c) => (
          <option key={c.id} value={c.id} className="bg-zinc-900 text-zinc-100">
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Global Top 20 source pickers (movie/series), next to the imported catalogs.
 * The shown value is resolver-derived, so a deleted, disabled or
 * type-incompatible custom always displays JustWatch. Saving completes
 * before any preview refetch (the hook resolves only after the PUT).
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
      // trendRank/badge/poster follow via the save nonces (effect above in
      // context): no explicit refresh here, it would double-fetch.
      await setRankingSource(slot, value)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-heading text-xl font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-accent-orange" />
          {t("ui.rankingSourceTitle")} {regionFlag}
        </h2>
      </div>
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3.5 shadow-sm">
        <p id="ranking-source-desc" className="text-xs text-muted leading-relaxed">
          {t("ui.rankingSourceDesc")}
        </p>
        <div className="space-y-3 pt-1">
          <SlotSelect
            id="ranking-source-movies"
            label={`${t("ui.movie")} — Top 20`}
            slot="movie"
            options={movieOptions}
            value={movieValue}
            disabled={saving !== null}
            onPick={onPick}
          />
          <SlotSelect
            id="ranking-source-series"
            label={`${t("ui.tvSeries")} — Top 20`}
            slot="series"
            options={seriesOptions}
            value={seriesValue}
            disabled={saving !== null}
            onPick={onPick}
          />
        </div>
        {movieOptions.length === 0 && seriesOptions.length === 0 ? (
          <p className="text-xs text-muted">{t("ui.rankingSourceEmpty")}</p>
        ) : (
          <p className="text-xs text-muted">{t("ui.rankingSourceKeysNote")}</p>
        )}
      </div>
    </div>
  )
}
