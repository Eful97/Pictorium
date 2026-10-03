"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { userFetch } from "./http"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { t } from "./i18n"

export const RANKING_SOURCE_MOVIE_KEY = "pictorium_ranking_source_movie"
export const RANKING_SOURCE_SERIES_KEY = "pictorium_ranking_source_series"

/** Raw stored selection (`""` = explicit JustWatch, absent = default JW). */
export type RankingSlotKey = "movie" | "series"

function sanitizeSelection(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length > 64) return null
  return trimmed
}

export function useRankingSources(
  safeGetItem: (key: string) => string | null,
  safeSetItem: (key: string, val: string) => void,
) {
  const [rankingSourceMovie, setRankingSourceMovieState] = useState("")
  const [rankingSourceSeries, setRankingSourceSeriesState] = useState("")
  // Bumped on every successful save so rank consumers (badge, trendRank,
  // preview poster) refetch even when title and user are unchanged.
  const [rankSourceNonce, setRankSourceNonce] = useState(0)
  // Last server-confirmed values: revert target when a PUT fails, so the
  // dropdowns always mirror the server.
  const savedRef = useRef({ movie: "", series: "" })
  // Latest intended values (updated synchronously on every set call, so a
  // queued PUT always ships the newest intent, never a stale snapshot).
  const latestRef = useRef({ movie: "", series: "" })
  // Set-call generation: guards the initial server fill against a late
  // GET overwriting a newer user pick.
  const genRef = useRef(0)
  // Monotonic save sequence: only the newest call may revert on failure.
  const callSeqRef = useRef(0)
  const putChainRef = useRef<Promise<void>>(Promise.resolve())

  // Initial load: localStorage first for instant paint, then the server
  // namespace wins per slot where it provides a value (it owns what Stremio
  // renders, so the dropdowns must mirror it). A device-local choice survives
  // only when the server is silent (absent key or unreachable): profileless
  // and offline devices keep working through the config token (see below).
  useEffect(() => {
    const gen = genRef.current
    const localMovie = safeGetItem(RANKING_SOURCE_MOVIE_KEY)
    const localSeries = safeGetItem(RANKING_SOURCE_SERIES_KEY)
    const cleanMovie = localMovie !== null ? sanitizeSelection(localMovie) : null
    const cleanSeries = localSeries !== null ? sanitizeSelection(localSeries) : null
    const startMovie = cleanMovie ?? ""
    const startSeries = cleanSeries ?? ""
    setRankingSourceMovieState(startMovie)
    setRankingSourceSeriesState(startSeries)
    latestRef.current = { movie: startMovie, series: startSeries }
    savedRef.current = { movie: startMovie, series: startSeries }
    userFetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // Late GET guard: a user pick started after this fetch must win.
        if (!data || genRef.current !== gen) return
        const serverMovie = sanitizeSelection(data.rankingSourceMovie)
        const serverSeries = sanitizeSelection(data.rankingSourceSeries)
        if (serverMovie === null && serverSeries === null) return
        const next = {
          movie: serverMovie !== null ? serverMovie : (safeGetItem(RANKING_SOURCE_MOVIE_KEY) ?? ""),
          series: serverSeries !== null ? serverSeries : (safeGetItem(RANKING_SOURCE_SERIES_KEY) ?? ""),
        }
        const cleanNext = {
          movie: sanitizeSelection(next.movie) ?? "",
          series: sanitizeSelection(next.series) ?? "",
        }
        setRankingSourceMovieState(cleanNext.movie)
        setRankingSourceSeriesState(cleanNext.series)
        safeSetItem(RANKING_SOURCE_MOVIE_KEY, cleanNext.movie)
        safeSetItem(RANKING_SOURCE_SERIES_KEY, cleanNext.series)
        latestRef.current = cleanNext
        savedRef.current = cleanNext
      })
      .catch(() => {})
  }, [safeGetItem, safeSetItem])

  /**
   * Saves the Top 20 source for one slot. Optimistic locally, reverted on
   * PUT failure so the dropdowns always mirror the server. Resolves true
   * only after the save, so callers refetch previews after (never before).
   * The PUT ships the newest intent at execution time (not call time), so
   * back-to-back saves of both slots can not lose each other; only the
   * newest call may revert on failure.
   */
  const setRankingSource = useCallback(async (slot: RankingSlotKey, id: string): Promise<boolean> => {
    const clean = sanitizeSelection(id) ?? ""
    genRef.current += 1
    const callId = ++callSeqRef.current
    const next = {
      movie: slot === "movie" ? clean : latestRef.current.movie,
      series: slot === "series" ? clean : latestRef.current.series,
    }
    latestRef.current = next
    setRankingSourceMovieState(next.movie)
    setRankingSourceSeriesState(next.series)
    safeSetItem(RANKING_SOURCE_MOVIE_KEY, next.movie)
    safeSetItem(RANKING_SOURCE_SERIES_KEY, next.series)
    let ok = false
    // Serialize PUTs in arrival order like useCustomCatalogs: a slow PUT
    // must not land after a newer one.
    putChainRef.current = putChainRef.current.then(async () => {
      // Payload read at execution time: chained saves converge on one body.
      const body = JSON.stringify({
        rankingSourceMovie: latestRef.current.movie,
        rankingSourceSeries: latestRef.current.series,
      })
      try {
        if (await shouldSkipServerSync()) {
          if (await isProfilelessOnMultiUser()) notifyProfilelessOnce()
          // Local-only mode: the device state stands on its own (the
          // selection travels via config token, see localConfigToken).
          ok = true
          return
        }
        const res = await userFetch("/api/defaults", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        ok = true
      } catch (error) {
        console.warn("[ranking-source] Sync failed:", error)
        const { toast } = await import("sonner")
        toast.warning(t("ui.catalogSyncFailed"))
        ok = false
      }
    })
    await putChainRef.current
    if (ok) {
      savedRef.current = { ...latestRef.current }
      setRankSourceNonce((n) => n + 1)
    } else if (callId === callSeqRef.current) {
      // Revert only when no newer save took over meanwhile.
      const prev = savedRef.current
      latestRef.current = { ...prev }
      setRankingSourceMovieState(prev.movie)
      setRankingSourceSeriesState(prev.series)
      safeSetItem(RANKING_SOURCE_MOVIE_KEY, prev.movie)
      safeSetItem(RANKING_SOURCE_SERIES_KEY, prev.series)
    }
    return ok
  }, [safeSetItem])

  return {
    rankingSourceMovie,
    rankingSourceSeries,
    setRankingSource,
    rankSourceNonce,
  }
}
