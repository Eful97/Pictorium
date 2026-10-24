"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { http } from "./http"
import { userFetch } from "./http"
import { parsePublicationStamp } from "./publication-date"
import { STREAMING_PLATFORMS } from "./utils"
import { t } from "./i18n"
import { getRegionDef } from "./regions"
import type { SearchResult, FlixPatrolChart } from "./types"
import type { EnrichedAnimeItem } from "./validation"

/** Stato minimo di una lista: idle (mai partita, es. senza chiave),
 *  loading, ready (con dati), empty (successo vuoto), error. */
export type ListStatus = "idle" | "loading" | "ready" | "empty" | "error"

/**
 * Publication stamps (ms epoch) of the served snapshots, per slot. Null =
 * unknown (no genuine pin, failed fetch, or never loaded). The UI renders
 * these verbatim — never the page clock, never a re-timestamped cache hit.
 */
export interface PublicationStamps {
  readonly movie: number | null
  readonly series: number | null
}

function statusOf(length: number): ListStatus {
  return length > 0 ? "ready" : "empty"
}

export interface TrendingScope {
  /** Raw Top 20 selections (`""` = explicit JustWatch charts). */
  readonly movieSource?: string
  readonly seriesSource?: string
  /** Namespace for source resolution (server resolves `?u=` too; explicit
   *  here so tests and manual refreshes carry it deterministically). */
  readonly userId?: string | null
  /** Signed device config (profileless spaces); null elsewhere. */
  readonly configToken?: string | null
  /** Token lifecycle: suspend/error instead of silent JW (same rule as rank). */
  readonly tokenStatus?: "off" | "pending" | "ready" | "error"
  /** Server save status: suspend/error to avoid fetching with obsolete server defaults. */
  readonly saveStatus?: "idle" | "saving" | "ready" | "error"
  /** Bumped on every acknowledged ranking save: refetch even when the title
   *  and user are unchanged. */
  readonly rankNonce?: number
}

export function useTrending(
  tmdbKey: string,
  mdblistApiKey: string,
  regionCode = "IT",
  hasServerKey = false,
  scope: TrendingScope = {},
) {
  const region = getRegionDef(regionCode)
  const flixCountry = region.flixSlug
  const movieSource = scope.movieSource ?? ""
  const seriesSource = scope.seriesSource ?? ""
  const scopeUserId = scope.userId ?? null
  const configToken = scope.configToken ?? null
  const tokenStatus = scope.tokenStatus ?? "off"
  const saveStatus = scope.saveStatus ?? "idle"
  const rankNonce = scope.rankNonce ?? 0
  const [trending, setTrending] = useState<Array<SearchResult & { rank: number }>>([])
  const [trendingStatus, setTrendingStatus] = useState<ListStatus>("idle")
  const [trendingUpdatedAt, setTrendingUpdatedAt] = useState<PublicationStamps | null>(null)
  const [mdblistAnimeList, setMdblistAnimeList] = useState<EnrichedAnimeItem[]>([])
  const [animeStatus, setAnimeStatus] = useState<ListStatus>("idle")
  const [animeUpdatedAt, setAnimeUpdatedAt] = useState<PublicationStamps | null>(null)
  const [animeSource, setAnimeSource] = useState<"mdblist" | "tmdb" | null>(null)
  const [streamingCharts, setStreamingCharts] = useState<Record<string, FlixPatrolChart>>({})
  const [platformErrors, setPlatformErrors] = useState<Record<string, boolean>>({})
  // Contatore refresh: CataloghiView lo passa alle entry custom (refetch
  // preview) e invalida la cache delle pagine di sessione.
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastRefreshRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const animeAbortRef = useRef<AbortController | null>(null)
  // Generation guard: a slow response from a previous scope (or a previous
  // manual refresh) must never overwrite the current scope's rows.
  const trendGenRef = useRef(0)
  const animeGenRef = useRef(0)
  const platformAbortRef = useRef<AbortController | null>(null)
  const requestedPlatformsRef = useRef(new Set<string>())
  const chartsRef = useRef<Record<string, FlixPatrolChart>>({})
  const platformInflightRef = useRef(new Map<string, Promise<boolean>>())
  // Two queues bound work even when several sections enter the viewport together.
  const platformQueuesRef = useRef([Promise.resolve(), Promise.resolve()])
  const nextQueueRef = useRef(0)

  // Scoped Top 20 URL: the server resolves the effective ranking source
  // (namespace `?u=`, `?config=` token, or global defaults) through the SAME
  // shared service the Stremio catalogs use — the UI rows and the installed
  // catalogs can never disagree on content/order/ids.
  const trendingUrl = useCallback((buster?: number) => {
    let url = `/api/tmdb/trending?api_key=${tmdbKey}&country=${encodeURIComponent(region.code)}`
    if (scopeUserId) url += `&u=${encodeURIComponent(scopeUserId)}`
    if (configToken) url += `&config=${encodeURIComponent(configToken)}`
    if (buster !== undefined) url += `&_t=${buster}`
    return url
  }, [tmdbKey, region.code, scopeUserId, configToken])

  // Top 20 effect: follows the ranking selection (sources, namespace, token,
  // save nonce) as well as keys/region. Anime and platforms are deliberately
  // NOT in here: switching the Top 20 source must never refetch them.
  useEffect(() => {
    if (!tmdbKey && !hasServerKey) {
      setTrending([])
      setTrendingStatus("idle")
      setTrendingUpdatedAt(null)
      return
    }
    // Token suspend/error or server save pending: never resolve through the
    // server while a selection is saving or token is minting (otherwise it
    // queries the previous selection on the server!).
    if (saveStatus === "saving" || tokenStatus === "pending") {
      abortRef.current?.abort()
      setTrending([])
      setTrendingStatus("loading")
      setTrendingUpdatedAt(null)
      return
    }
    if (saveStatus === "error" || tokenStatus === "error") {
      abortRef.current?.abort()
      setTrending([])
      setTrendingStatus("error")
      setTrendingUpdatedAt(null)
      return
    }
    const gen = ++trendGenRef.current
    // Clear previous results immediately when starting a new fetch so old titles
    // are never shown under the new name while loading. Stamps clear too: a
    // new scope must never display the previous publication time.
    setTrending([])
    setTrendingStatus("loading")
    setTrendingUpdatedAt(null)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const signal = ctrl.signal
    const url = trendingUrl()
    // `cache: "no-store"` bypasses the browser HTTP cache at this same
    // namespace URL (the selection lives server-side and the URL carries no
    // `&_t` buster on this automatic path, unlike the manual refresh below):
    // without it the browser/CDN could keep serving the previous source's
    // body after a save even though the server-side app cache key is correct.
    // Server-side data caching is untouched (headers/transport only).
    http<{ movies: Array<SearchResult & { rank: number }>; tv: Array<SearchResult & { rank: number }>; updatedAt?: { movie?: unknown; series?: unknown } | null }>(url, { timeout: 30000, signal, cache: "no-store" })
      .then((data) => {
        if (signal.aborted || gen !== trendGenRef.current) return
        const movies = (data.movies || []).slice(0, 20)
        const tv = (data.tv || []).slice(0, 20)
        const list = [...movies, ...tv]
        setTrending(list)
        setTrendingStatus(statusOf(list.length))
        // Served publication stamps (T1 contract): per-slot ms epoch, or
        // null when the slot has no genuine pin. A reload carries the same
        // stamps — never the page clock.
        const stamp = data.updatedAt && typeof data.updatedAt === "object" ? data.updatedAt : null
        setTrendingUpdatedAt({
          movie: stamp ? parsePublicationStamp(stamp.movie) : null,
          series: stamp ? parsePublicationStamp(stamp.series) : null,
        })
      })
      .catch((e) => {
        if (signal.aborted || gen !== trendGenRef.current) return
        console.error("[pictorium] Failed to load trending:", e)
        setTrendingStatus("error")
      })
    return () => { ctrl.abort(); if (abortRef.current === ctrl) abortRef.current = null }
  }, [tmdbKey, region.code, hasServerKey, movieSource, seriesSource, scopeUserId, configToken, tokenStatus, saveStatus, rankNonce, trendingUrl])

  // Anime effect: keys only (plus the historic region dep). A Top 20 source
  // switch never touches this list.
  useEffect(() => {
    if (!tmdbKey && !hasServerKey) {
      setMdblistAnimeList([])
      setAnimeStatus("idle")
      setAnimeUpdatedAt(null)
      return
    }
    const gen = ++animeGenRef.current
    setAnimeStatus("loading")
    // A new load never retains the previous publication stamps.
    setAnimeUpdatedAt(null)
    const ctrl = new AbortController()
    animeAbortRef.current = ctrl
    const signal = ctrl.signal
    // userFetch (not http): the per-slot publication stamps travel in the
    // response headers (`X-Pictorium-Updated-At-Movie/Series`), which the
    // JSON-only helper cannot see. Same timeout/abort semantics; a non-OK
    // status still falls through to the TMDB fallback below.
    userFetch(`/api/mdblist/anime?mdblist_key=${encodeURIComponent(mdblistApiKey || "")}&api_key=${encodeURIComponent(tmdbKey)}`, { timeout: 30000, signal })
      .then(async (res) => {
        if (signal.aborted || gen !== animeGenRef.current) return
        const movieStamp = parsePublicationStamp(res.headers.get("X-Pictorium-Updated-At-Movie"))
        const seriesStamp = parsePublicationStamp(res.headers.get("X-Pictorium-Updated-At-Series"))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json().catch(() => null)) as EnrichedAnimeItem[] | null
        if (signal.aborted || gen !== animeGenRef.current) return
        if (Array.isArray(data) && data.length > 0) {
          setMdblistAnimeList(data)
          setAnimeStatus("ready")
          setAnimeSource("mdblist")
          setAnimeUpdatedAt({ movie: movieStamp, series: seriesStamp })
        } else {
          // Fallback TMDB trending anime
          http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity`, { timeout: 30000, signal })
            .then((tmdbData) => {
              if (signal.aborted || gen !== animeGenRef.current) return
              const fallback: EnrichedAnimeItem[] = (tmdbData.results || []).map((item: SearchResult, idx: number) => ({
                id: item.id,
                title: item.title || item.name || "",
                poster_path: item.poster_path || "",
                rank: idx + 1,
                media_type: item.media_type || "tv",
              }))
              setMdblistAnimeList(fallback)
              setAnimeStatus(statusOf(fallback.length))
              setAnimeSource("tmdb")
              // TMDB fallback rows carry no publication stamp.
              setAnimeUpdatedAt(null)
            })
            .catch(() => { if (!signal.aborted && gen === animeGenRef.current) setAnimeStatus("error") })
        }
      })
      .catch(() => {
        if (signal.aborted || gen !== animeGenRef.current) return
        http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity`, { timeout: 30000, signal })
          .then((tmdbData) => {
            if (signal.aborted || gen !== animeGenRef.current) return
            const fallback: EnrichedAnimeItem[] = (tmdbData.results || []).map((item: SearchResult, idx: number) => ({
              id: item.id,
              title: item.title || item.name || "",
              poster_path: item.poster_path || "",
              rank: idx + 1,
              media_type: item.media_type || "tv",
            }))
            setMdblistAnimeList(fallback)
            setAnimeStatus(statusOf(fallback.length))
            setAnimeSource("tmdb")
            // TMDB fallback rows carry no publication stamp.
            setAnimeUpdatedAt(null)
          })
          .catch(() => { if (!signal.aborted && gen === animeGenRef.current) setAnimeStatus("error") })
      })
    return () => { ctrl.abort(); if (animeAbortRef.current === ctrl) animeAbortRef.current = null }
  }, [tmdbKey, mdblistApiKey, region.code, hasServerKey])

  useEffect(() => {
    const ctrl = new AbortController()
    platformAbortRef.current = ctrl
    chartsRef.current = {}
    requestedPlatformsRef.current.clear()
    platformInflightRef.current.clear()
    platformQueuesRef.current = [Promise.resolve(), Promise.resolve()]
    setStreamingCharts({})
    setPlatformErrors({})
    return () => { ctrl.abort(); platformAbortRef.current?.abort() }
  }, [tmdbKey, flixCountry, hasServerKey])

  const loadPlatform = useCallback(async (slug: string, force = false): Promise<boolean> => {
    // Let scope-reset effects complete before accepting demand from a child.
    await Promise.resolve()
    if ((!tmdbKey && !hasServerKey) || !STREAMING_PLATFORMS.some(p => p.slug === slug)) return false
    const pending = platformInflightRef.current.get(slug)
    if (pending) return pending
    if (!force && requestedPlatformsRef.current.has(slug)) return !!chartsRef.current[slug]
    const ctrl = platformAbortRef.current
    if (!ctrl || ctrl.signal.aborted) return false
    requestedPlatformsRef.current.add(slug)
    const queue = nextQueueRef.current++ % 2
    const job = platformQueuesRef.current[queue].then(async () => {
      if (ctrl.signal.aborted) return false
      try {
        const suffix = force ? "&_t=" + Date.now() : ""
        const chart = await http<FlixPatrolChart>("/api/flixpatrol/top10?platform=" + encodeURIComponent(slug) + "&country=" + encodeURIComponent(flixCountry) + "&api_key=" + encodeURIComponent(tmdbKey) + suffix, { timeout: 30000, signal: ctrl.signal })
        if (ctrl.signal.aborted) return false
        chartsRef.current[slug] = chart
        setStreamingCharts(prev => ({ ...prev, [slug]: chart }))
        setPlatformErrors(prev => ({ ...prev, [slug]: false }))
        return true
      } catch (error) {
        if (!ctrl.signal.aborted) {
          console.error("[pictorium] Platform failed:", slug, error)
          setPlatformErrors(prev => ({ ...prev, [slug]: true }))
        }
        return false
      }
    }).finally(() => {
      if (platformInflightRef.current.get(slug) === job) platformInflightRef.current.delete(slug)
    })
    platformInflightRef.current.set(slug, job)
    platformQueuesRef.current[queue] = job.then(() => {})
    return job
  }, [tmdbKey, flixCountry, hasServerKey])

  const refreshLists = useCallback(async (refreshCustom?: () => Promise<number>) => {
    const now = Date.now()
    if (now - lastRefreshRef.current < 15 * 1000) {
      import("sonner").then(({ toast }) => toast(t("ui.refreshRateLimit")))
      return
    }
    lastRefreshRef.current = now
    if (abortRef.current) abortRef.current.abort()
    if (animeAbortRef.current) animeAbortRef.current.abort()
    platformAbortRef.current?.abort()
    const ctrl = new AbortController()
    const signal = ctrl.signal
    abortRef.current = ctrl
    const animeCtrl = new AbortController()
    const animeSignal = animeCtrl.signal
    animeAbortRef.current = animeCtrl
    platformAbortRef.current = new AbortController()
    platformInflightRef.current.clear()
    platformQueuesRef.current = [Promise.resolve(), Promise.resolve()]
    // CataloghiView invalida le pagine e ricarica le preview registrate.
    setRefreshNonce((n) => n + 1)
    const customPromise = refreshCustom ? refreshCustom().catch(() => 1) : Promise.resolve(0)
    let failures = 0
    // Token suspend/error or server save pending: the manual refresh
    // resolves through the same scoped selection as the mount effect — never
    // through the empty namespace while a device selection is pending or
    // failed (silent JW), and never through the stale server defaults while
    // a ranking save is pending or failed. Anime and platforms stay
    // independent: only the Top 20 trend fetch is gated here.
    const trendingSuspended =
      tokenStatus === "pending" ||
      tokenStatus === "error" ||
      saveStatus === "saving" ||
      saveStatus === "error"
    if (tmdbKey || hasServerKey) try {
      const trendGen = ++trendGenRef.current
      const animeGen = ++animeGenRef.current
      const trendingPromise = trendingSuspended
        ? Promise.resolve(null)
        // `&_t` already busts the URL, but `cache: "no-store"` (same as the
        // automatic effect above) keeps the manual path consistent and
        // explicit failures never cached anywhere.
        : http<{ movies: Array<SearchResult & { rank: number }>; tv: Array<SearchResult & { rank: number }>; updatedAt?: { movie?: unknown; series?: unknown } | null }>(trendingUrl(now), { timeout: 30000, signal, cache: "no-store" })
      let refreshAnimeStamps: PublicationStamps | null = null
      const animePromise = userFetch(`/api/mdblist/anime?mdblist_key=${encodeURIComponent(mdblistApiKey || "")}&api_key=${encodeURIComponent(tmdbKey)}&_t=${now}`, { timeout: 30000, signal: animeSignal })
        .then(async (res) => {
          if (animeSignal.aborted) return null
          const movieStamp = parsePublicationStamp(res.headers.get("X-Pictorium-Updated-At-Movie"))
          const seriesStamp = parsePublicationStamp(res.headers.get("X-Pictorium-Updated-At-Series"))
          if (!res.ok) return null
          const data = (await res.json().catch(() => null)) as EnrichedAnimeItem[] | null
          if (Array.isArray(data) && data.length > 0) {
            if (!animeSignal.aborted && animeGen === animeGenRef.current) {
              setAnimeSource("mdblist")
              refreshAnimeStamps = { movie: movieStamp, series: seriesStamp }
            }
            return data
          }
          return null
        })
        .catch(() => null)
        .then((res) => {
          if (res) return res
          if (animeSignal.aborted) return null
          return http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity&_t=${now}`, { timeout: 30000, signal: animeSignal })
            .then((data): EnrichedAnimeItem[] => {
              if (!animeSignal.aborted && animeGen === animeGenRef.current) {
                setAnimeSource("tmdb")
                // TMDB fallback rows carry no publication stamp.
                refreshAnimeStamps = null
              }
              return (data.results || []).map((item: SearchResult, idx: number) => ({
              id: item.id,
              title: item.title || item.name || "",
              poster_path: item.poster_path || "",
              rank: idx + 1,
              media_type: item.media_type || "tv",
            }))
            })
            .catch(() => null)
        })
      // Top 20 e anime procedono indipendentemente: il fallimento di uno
      // non cancella i dati dell'altro.
      const [trendingRes, animeRes] = await Promise.allSettled([
        trendingPromise,
        animePromise,
      ])
      if (signal.aborted) return
      if (trendingSuspended) {
        // Refresh while the device selection is pending/failed: the rows stay
        // untouched (the mount effect owns them) but the toast stays honest.
        failures++
      } else if (trendingRes.status === "fulfilled" && trendingRes.value) {
        if (trendGen !== trendGenRef.current) return
        const list = [...(trendingRes.value.movies || []), ...(trendingRes.value.tv || [])]
        setTrending(list)
        setTrendingStatus(statusOf(list.length))
        const stamp = trendingRes.value.updatedAt && typeof trendingRes.value.updatedAt === "object" ? trendingRes.value.updatedAt : null
        setTrendingUpdatedAt({
          movie: stamp ? parsePublicationStamp(stamp.movie) : null,
          series: stamp ? parsePublicationStamp(stamp.series) : null,
        })
      } else {
        if (trendGen !== trendGenRef.current) return
        console.error("[pictorium] Failed to refresh lists:", trendingRes.status === "rejected" ? trendingRes.reason : "suspended")
        setTrendingStatus("error")
        failures++
      }
      if (animeRes.status === "fulfilled" && animeRes.value) {
        if (animeGen !== animeGenRef.current) return
        setMdblistAnimeList(animeRes.value as EnrichedAnimeItem[])
        setAnimeStatus(statusOf(animeRes.value.length))
        setAnimeUpdatedAt(refreshAnimeStamps)
      } else if (animeRes.status === "rejected" || !animeRes.value) {
        if (animeGen !== animeGenRef.current) return
        if (animeRes.status === "rejected") console.error("[pictorium] Failed to refresh anime:", animeRes.reason)
        setAnimeStatus("error")
        failures++
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      console.error("[pictorium] Failed to refresh lists:", e)
      setTrendingStatus("error")
      failures++
    }
    if (signal.aborted) return
    // Refresh only platforms the user has actually requested.
    const platforms = Array.from(requestedPlatformsRef.current)
    const platformResults = await Promise.all(platforms.map(slug => loadPlatform(slug, true)))
    if (signal.aborted) return
    failures += platformResults.filter(ok => !ok).length
    failures += await customPromise
    if (signal.aborted) return
    // Successo solo per gli esiti davvero riusciti: il parziale resta
    // riconoscibile e i dati vecchi non vengono mai cancellati.
    import("sonner").then(({ toast }) => {
      if (failures === 0) toast(t("ui.listsRefreshed"))
      else toast.warning(t("ui.listsPartial"))
    })
  }, [tmdbKey, mdblistApiKey, hasServerKey, loadPlatform, trendingUrl, tokenStatus, saveStatus])

  return { trending, trendingStatus, trendingError: trendingStatus === "error", trendingUpdatedAt, mdblistAnimeList, animeStatus, animeSource, animeUpdatedAt, streamingCharts, platformErrors, loadPlatform, refreshLists, refreshNonce }
}
