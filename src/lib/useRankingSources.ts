"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { userFetch } from "./http"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { t } from "./i18n"

export const RANKING_SOURCE_MOVIE_KEY = "pictorium_ranking_source_movie"
export const RANKING_SOURCE_SERIES_KEY = "pictorium_ranking_source_series"

/** Raw stored selection (`""` = explicit JustWatch, absent = default JW). */
export type RankingSlotKey = "movie" | "series"

export type RankingSourceStatus = "idle" | "saving" | "ready" | "error"

function sanitizeSelection(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  // Widest accepted id: the derived streaming catalog id cap (160). The
  // resolver validates membership/shape; this only bounds the stored field.
  if (trimmed.length > 160) return null
  return trimmed
}

export function useRankingSources(
  safeGetItem: (key: string) => string | null,
  safeSetItem: (key: string, val: string) => void,
) {
  const [rankingSourceMovie, setRankingSourceMovieState] = useState("")
  const [rankingSourceSeries, setRankingSourceSeriesState] = useState("")
  const [rankingSourceStatus, setRankingSourceStatus] = useState<RankingSourceStatus>("idle")
  // Bumped on every successful save so rank consumers (badge, trendRank,
  // preview poster) refetch even when title and user are unchanged.
  const [rankSourceNonce, setRankSourceNonce] = useState(0)
  // Last server-confirmed values: revert target when a PUT fails, so the
  // dropdowns always mirror the server.
  const savedRef = useRef({ movie: "", series: "" })
  // Last SERVER-confirmed payload (effective defaults: an absent GET field
  // resolves to JustWatch charts on the server, i.e. ""). Equivalent re-saves
  // skip the network only against this — localStorage is never assumed to
  // equal server truth (a device-local pick survives only while the server
  // is silent, and must still be persisted on re-select).
  const serverConfirmedRef = useRef({ movie: "", series: "" })
  // Per-slot server knowledge: false until a GET completes (absent fields
  // count as known-default "") or a PUT succeeds. Full equivalence requires
  // both slots known; a pending or unreachable GET never dedupes.
  const serverKnownRef = useRef({ movie: false, series: false })
  // Last device-local payload (localStorage mirror): the local-only path
  // dedupes against this, never against the server tracker.
  const localWrittenRef = useRef({ movie: "", series: "" })
  // Revision tracking: every real write bumps writeRev; the nonce (rank
  // refetch signal) is bumped at most once per newly confirmed revision by
  // the latest completion — a burst of same-intent saves ships one PUT and
  // still refetches exactly once, while a true no-op never refetches.
  const writeRevRef = useRef(0)
  const ackedRevRef = useRef(0)
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
    localWrittenRef.current = { movie: startMovie, series: startSeries }
    // NOTE: serverKnown stays false here — the device-local paint is not
    // server truth until the GET below (or a PUT) confirms it.
    userFetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // Late GET guard: a user pick started after this fetch must win.
        if (!data || genRef.current !== gen) return
        const serverMovie = sanitizeSelection(data.rankingSourceMovie)
        const serverSeries = sanitizeSelection(data.rankingSourceSeries)
        // Server-effective confirmation FIRST (even when silent): a reachable
        // GET pins both slots — an absent field resolves to JustWatch charts
        // on the server, never to the device-local fallback — without a
        // revision bump, since no save happened.
        serverConfirmedRef.current = {
          movie: serverMovie ?? "",
          series: serverSeries ?? "",
        }
        serverKnownRef.current = { movie: true, series: true }
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
        // The local mirror follows what was just written to storage.
        localWrittenRef.current = { ...cleanNext }
      })
      .catch(() => {})
  }, [safeGetItem, safeSetItem])

  /**
   * Saves the Top 20 source for one slot. Optimistic locally, reverted on
   * PUT failure so the dropdowns always mirror the server. Resolves true
   * only after the save, so callers refetch previews after (never before).
   * Each call ships its own call-time intent (never a newer snapshot), and
   * PUTs run serialized in arrival order like useCustomCatalogs, so
   * back-to-back saves of both slots converge with sequential writes and a
   * stale success can never mark a newer intent saved: only the latest
   * completion flips ready/error and bumps the nonce.
   */
  const setRankingSource = useCallback(async (slot: RankingSlotKey, id: string): Promise<boolean> => {
    const clean = sanitizeSelection(id) ?? ""
    genRef.current += 1
    const callId = ++callSeqRef.current
    // Call-time intent snapshot: queued PUTs each persist what their caller
    // picked, so overlapping saves of either slot can not lose each other.
    const intent = {
      movie: slot === "movie" ? clean : latestRef.current.movie,
      series: slot === "series" ? clean : latestRef.current.series,
    }
    latestRef.current = intent
    setRankingSourceMovieState(intent.movie)
    setRankingSourceSeriesState(intent.series)
    safeSetItem(RANKING_SOURCE_MOVIE_KEY, intent.movie)
    safeSetItem(RANKING_SOURCE_SERIES_KEY, intent.series)
    setRankingSourceStatus("saving")
    // Serialize PUTs in arrival order like useCustomCatalogs: a slow PUT
    // must not land after a newer one. The link never rejects (outcome
    // object), so one failure can not wedge the chain for later saves.
    const job: Promise<{ ok: boolean; confirmed: { movie: string; series: string } | null }> =
      putChainRef.current.then(async () => {
        try {
          // Equivalent to the last SERVER-confirmed payload, and both slots
          // actually known: already on the server, no redundant write (still
          // acknowledges the intent).
          const known = serverKnownRef.current.movie && serverKnownRef.current.series
          if (
            known &&
            intent.movie === serverConfirmedRef.current.movie &&
            intent.series === serverConfirmedRef.current.series
          ) {
            return { ok: true as const, confirmed: null }
          }
          if (await shouldSkipServerSync()) {
            if (await isProfilelessOnMultiUser()) notifyProfilelessOnce()
            // Local-only mode: the device state stands on its own (the
            // selection travels via config token, see localConfigToken).
            // Dedupe against the local mirror, never the server tracker.
            if (
              intent.movie === localWrittenRef.current.movie &&
              intent.series === localWrittenRef.current.series
            ) {
              return { ok: true as const, confirmed: null }
            }
            const confirmed = { ...intent }
            localWrittenRef.current = confirmed
            writeRevRef.current += 1
            return { ok: true as const, confirmed }
          }
          const res = await userFetch("/api/defaults", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rankingSourceMovie: intent.movie,
              rankingSourceSeries: intent.series,
            }),
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const confirmed = { ...intent }
          serverConfirmedRef.current = confirmed
          serverKnownRef.current = { movie: true, series: true }
          localWrittenRef.current = { ...confirmed }
          writeRevRef.current += 1
          return { ok: true as const, confirmed }
        } catch (error) {
          console.warn("[ranking-source] Sync failed:", error)
          try {
            const { toast } = await import("sonner")
            toast.warning(t("ui.catalogSyncFailed"))
          } catch {
            /* toast is best-effort */
          }
          return { ok: false as const, confirmed: null }
        }
      })
    putChainRef.current = job.then(
      () => undefined,
      () => undefined,
    )
    const outcome = await job
    if (outcome.ok) {
      // Track the last actually persisted payload even for a stale success,
      // so a later failure rolls back to server truth (never to an
      // unpersisted intent). Only the latest completion acknowledges with
      // ready/nonce — and the nonce fires at most once per newly confirmed
      // revision: a redundant job that deduped against a write from the same
      // burst still refetches exactly once, while a true no-op never does.
      if (outcome.confirmed) savedRef.current = { ...outcome.confirmed }
      if (callId === callSeqRef.current) {
        setRankingSourceStatus("ready")
        if (ackedRevRef.current !== writeRevRef.current) {
          ackedRevRef.current = writeRevRef.current
          setRankSourceNonce((n) => n + 1)
        }
      }
      return true
    }
    if (callId === callSeqRef.current) {
      // Revert only when no newer save took over meanwhile.
      const prev = savedRef.current
      latestRef.current = { ...prev }
      localWrittenRef.current = { ...prev }
      setRankingSourceMovieState(prev.movie)
      setRankingSourceSeriesState(prev.series)
      safeSetItem(RANKING_SOURCE_MOVIE_KEY, prev.movie)
      safeSetItem(RANKING_SOURCE_SERIES_KEY, prev.series)
      setRankingSourceStatus("error")
    }
    return false
  }, [safeSetItem])

  return {
    rankingSourceMovie,
    rankingSourceSeries,
    rankingSourceStatus,
    setRankingSource,
    rankSourceNonce,
  }
}
