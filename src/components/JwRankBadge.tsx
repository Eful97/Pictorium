"use client"

import { useEffect, useState } from "react"
import { TrendingUp, Trophy } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { getRegionDef } from "@/lib/regions"

interface Props {
  tmdbId: number
  type: "movie" | "tv"
  /** Codice regione attiva (default IT): rank e bandiera seguono il paese. */
  regionCode?: string
}

export function JwRankBadge({ tmdbId, type, regionCode = "IT" }: Props) {
  const { t } = useT()
  const [rank, setRank] = useState<number | null | undefined>(undefined)
  const [top, setTop] = useState(20)
  const region = getRegionDef(regionCode)

  useEffect(() => {
    let active = true
    setRank(undefined)
    fetch(`/api/trending/rank?type=${type}&id=${tmdbId}&first=20&region=${encodeURIComponent(region.code)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setRank(data.rank ?? null)
        setTop(data.top ?? 20)
      })
      .catch(() => {
        if (active) setRank(null)
      })
    return () => {
      active = false
    }
  }, [tmdbId, type, region.code])

  if (rank === undefined) {
    return <span className="text-[11px] text-zinc-500 animate-pulse">{t("ui.rankLoading")}</span>
  }
  if (rank === null) {
    return <span className="text-[11px] text-zinc-500">{t("ui.rankOutsideTop", { top, flag: region.flag })}</span>
  }
  const isTop3 = rank <= 3
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
        isTop3 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-white/[0.06] text-zinc-200 border-white/10"
      }`}
      title={t("ui.rankTitle", { rank, country: region.label })}
    >
      {isTop3 ? <Trophy className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 text-accent-orange" />}
      {t("ui.rankTrending", { rank, flag: region.flag })}
    </span>
  )
}
