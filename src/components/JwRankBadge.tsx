"use client"

import { useEffect, useState } from "react"
import { TrendingUp, Trophy } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"
import { getRegionDef } from "@/lib/regions"
import { resolveRankingSource } from "@/lib/ranking-source"

interface Props {
  tmdbId: number
  type: "movie" | "tv"
  /** Codice regione attiva (default IT): rank e bandiera seguono il paese. */
  regionCode?: string
  /**
   * Namespace id: the rank endpoint resolves the global Top 20 source
   * (JustWatch/custom) server-side, same selection as the catalogs.
   * Without it the global selection applies.
   */
  userId?: string | null
}

export function JwRankBadge({ tmdbId, type, regionCode = "IT", userId }: Props) {
  const { t } = useT()
  const [rank, setRank] = useState<number | null | undefined>(undefined)
  const [unavailable, setUnavailable] = useState(false)
  const [top, setTop] = useState(20)
  const region = getRegionDef(regionCode)
  // Effective source mirrors the catalogs (pure client resolver on the same
  // state): a custom-driven slot never shows region flags or JW wording.
  const rankingSourceMovie = usePSelector((v) => v.rankingSourceMovie)
  const rankingSourceSeries = usePSelector((v) => v.rankingSourceSeries)
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const rankSourceNonce = usePSelector((v) => v.rankSourceNonce)
  // Same trigger for custom-list edits under an unchanged selection.
  const catalogsSyncNonce = usePSelector((v) => v.catalogsSyncNonce)
  // Device config token where the namespace is not enough (local-only).
  const localConfigToken = usePSelector((v) => v.localConfigToken)
  const localConfigTokenStatus = usePSelector((v) => v.localConfigTokenStatus)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mdblistApiKey = usePSelector((v) => v.mdblistApiKey)
  const tvdbApiKey = usePSelector((v) => v.tvdbApiKey)
  const slot = type === "movie" ? "movie" : "series"
  const source = resolveRankingSource(
    { customCatalogs, rankingSourceMovie, rankingSourceSeries },
    slot,
  )
  const customName = source.kind === "custom"
    ? (customCatalogs.find((c) => c.id === source.customId)?.name?.trim() || null)
    : null

  useEffect(() => {
    let active = true
    setRank(undefined)
    setUnavailable(false)
    // Suspended mint: no request at all (a namespace read here would flash a
    // JW rank under a custom selection). Failed mint: visible error state.
    if (localConfigTokenStatus === "pending") return
    if (localConfigTokenStatus === "error") {
      setUnavailable(true)
      return
    }
    const userParam = userId ? `&u=${encodeURIComponent(userId)}` : ""
    // Browser cache stays out of rank reads (the URL does not version the
    // selection); device config travels explicitly where needed.
    const configParam = localConfigToken ? `&config=${encodeURIComponent(localConfigToken)}` : ""
    const keyParams = new URLSearchParams()
    if (tmdbKey) keyParams.set("api_key", tmdbKey)
    if (mdblistApiKey) keyParams.set("mdblist_key", mdblistApiKey)
    if (tvdbApiKey) keyParams.set("tvdb_key", tvdbApiKey)
    const credentials = keyParams.size ? `&${keyParams}` : ""
    fetch(`/api/trending/rank?type=${type}&id=${tmdbId}&first=20&region=${encodeURIComponent(region.code)}${userParam}${configParam}${credentials}`, { cache: "no-store" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return
        // Explicit provider errors (custom list down/misconfigured) surface
        // as their own state — never disguised as "outside the Top 20".
        if (!ok || data?.error) {
          setUnavailable(true)
          return
        }
        setRank(data.rank ?? null)
        setTop(data.top ?? 20)
      })
      .catch(() => {
        // Network failure is explicit too: never disguised as "outside Top 20".
        if (active) setUnavailable(true)
      })
    return () => {
      active = false
    }
  // Refetch triggers: title, request identity, and the post-save nonce.
  // The optimistic selection itself is intentionally NOT a dep: rank
  // refetches only after the save lands (save-before-refresh), while the
  // label follows the optimistic state immediately.
  }, [tmdbId, type, region.code, userId, localConfigToken, localConfigTokenStatus, rankSourceNonce, catalogsSyncNonce, tmdbKey, mdblistApiKey, tvdbApiKey])

  if (unavailable) {
    return <span className="text-[11px] text-zinc-500">{t("ui.rankUnavailable")}</span>
  }
  if (rank === undefined) {
    return <span className="text-[11px] text-zinc-500 animate-pulse">{t("ui.rankLoading")}</span>
  }
  if (rank === null) {
    if (customName) {
      return <span className="text-[11px] text-zinc-500">{t("ui.rankCustomOutsideTop", { top, name: customName })}</span>
    }
    return <span className="text-[11px] text-zinc-500">{t("ui.rankOutsideTop", { top, flag: region.flag })}</span>
  }
  const isTop3 = rank <= 3
  if (customName) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
          isTop3 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-white/[0.06] text-zinc-200 border-white/10"
        }`}
        title={t("ui.rankCustomTitle", { rank, name: customName })}
      >
        {isTop3 ? <Trophy className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 text-accent-orange" />}
        {t("ui.rankCustomTrending", { rank, name: customName })}
      </span>
    )
  }
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
