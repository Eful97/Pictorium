"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { http } from "./http"
import { STREAMING_PLATFORMS } from "./utils"
import { t } from "./i18n"
import { getRegionDef } from "./regions"
import type { SearchResult, FlixPatrolChart } from "./types"
import type { EnrichedAnimeItem } from "./validation"

/** Stato minimo di una lista: idle (mai partita, es. senza chiave),
 *  loading, ready (con dati), empty (successo vuoto), error. */
export type ListStatus = "idle" | "loading" | "ready" | "empty" | "error"

function statusOf(length: number): ListStatus {
  return length > 0 ? "ready" : "empty"
}

export function useTrending(tmdbKey: string, mdblistApiKey: string, regionCode = "IT", hasServerKey = false) {
  const region = getRegionDef(regionCode)
  const flixCountry = region.flixSlug
  const [trending, setTrending] = useState<Array<SearchResult & { rank: number }>>([])
  const [trendingStatus, setTrendingStatus] = useState<ListStatus>("idle")
  const [mdblistAnimeList, setMdblistAnimeList] = useState<EnrichedAnimeItem[]>([])
  const [animeStatus, setAnimeStatus] = useState<ListStatus>("idle")
  const [animeSource, setAnimeSource] = useState<"mdblist" | "tmdb" | null>(null)
  const [streamingCharts, setStreamingCharts] = useState<Record<string, FlixPatrolChart>>({})
  const [platformErrors, setPlatformErrors] = useState<Record<string, boolean>>({})
  // Contatore refresh: CataloghiView lo passa alle entry custom (refetch
  // preview) e invalida la cache delle pagine di sessione.
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastRefreshRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const platformAbortRef = useRef<AbortController | null>(null)
  const requestedPlatformsRef = useRef(new Set<string>())
  const chartsRef = useRef<Record<string, FlixPatrolChart>>({})
  const platformInflightRef = useRef(new Map<string, Promise<boolean>>())
  // Two queues bound work even when several sections enter the viewport together.
  const platformQueuesRef = useRef([Promise.resolve(), Promise.resolve()])
  const nextQueueRef = useRef(0)

  useEffect(() => {
    if (!tmdbKey && !hasServerKey) {
      setTrending([])
      setMdblistAnimeList([])
      setTrendingStatus("idle")
      setAnimeStatus("idle")
      return
    }
    setTrendingStatus("loading")
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const signal = ctrl.signal
    http<{ movies: Array<SearchResult & { rank: number }>; tv: Array<SearchResult & { rank: number }> }>(`/api/tmdb/trending?api_key=${tmdbKey}&country=${encodeURIComponent(region.code)}`, { timeout: 30000, signal })
      .then((data) => {
        if (signal.aborted) return
        const list = [...(data.movies || []), ...(data.tv || [])]
        setTrending(list)
        setTrendingStatus(statusOf(list.length))
      })
      .catch((e) => {
        if (signal.aborted) return
        console.error("[pictorium] Failed to load trending:", e)
        setTrendingStatus("error")
      })
    setAnimeStatus("loading")
    http<EnrichedAnimeItem[]>(`/api/mdblist/anime?mdblist_key=${encodeURIComponent(mdblistApiKey || "")}&api_key=${encodeURIComponent(tmdbKey)}`, { timeout: 30000, signal })
      .then((data) => {
        if (signal.aborted) return
        if (Array.isArray(data) && data.length > 0) {
          setMdblistAnimeList(data)
          setAnimeStatus("ready")
          setAnimeSource("mdblist")
        } else {
          // Fallback TMDB trending anime
          http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity`, { timeout: 30000, signal })
            .then((tmdbData) => {
              if (signal.aborted) return
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
            })
            .catch(() => { if (!signal.aborted) setAnimeStatus("error") })
        }
      })
      .catch(() => {
        if (signal.aborted) return
        http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity`, { timeout: 30000, signal })
          .then((tmdbData) => {
            if (signal.aborted) return
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
          })
          .catch(() => { if (!signal.aborted) setAnimeStatus("error") })
      })
    return () => { ctrl.abort(); abortRef.current?.abort() }
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
    platformAbortRef.current?.abort()
    const ctrl = new AbortController()
    const signal = ctrl.signal
    abortRef.current = ctrl
    platformAbortRef.current = new AbortController()
    platformInflightRef.current.clear()
    platformQueuesRef.current = [Promise.resolve(), Promise.resolve()]
    // CataloghiView invalida le pagine e ricarica le preview registrate.
    setRefreshNonce((n) => n + 1)
    const customPromise = refreshCustom ? refreshCustom().catch(() => 1) : Promise.resolve(0)
    let failures = 0
    if (tmdbKey || hasServerKey) try {
      const animePromise = http<EnrichedAnimeItem[]>(`/api/mdblist/anime?mdblist_key=${encodeURIComponent(mdblistApiKey || "")}&api_key=${encodeURIComponent(tmdbKey)}&_t=${now}`, { timeout: 30000, signal })
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            if (!signal.aborted) setAnimeSource("mdblist")
            return data
          }
          return null
        })
        .catch(() => null)
        .then((res) => {
          if (res) return res
          if (signal.aborted) return null
          return http<{ results: SearchResult[] }>(`/api/tmdb/trending/tv/week?api_key=${tmdbKey}&with_original_language=ja&sort_by=popularity&_t=${now}`, { timeout: 30000, signal })
            .then((data): EnrichedAnimeItem[] => {
              if (!signal.aborted) setAnimeSource("tmdb")
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
      // JustWatch e anime procedono indipendentemente: il fallimento di uno
      // non cancella i dati dell'altro.
      const [trendingRes, animeRes] = await Promise.allSettled([
        http<{ movies: Array<SearchResult & { rank: number }>; tv: Array<SearchResult & { rank: number }> }>(`/api/tmdb/trending?api_key=${tmdbKey}&country=${encodeURIComponent(region.code)}&_t=${now}`, { timeout: 30000, signal }),
        animePromise,
      ])
      if (signal.aborted) return
      if (trendingRes.status === "fulfilled") {
        const list = [...(trendingRes.value.movies || []), ...(trendingRes.value.tv || [])]
        setTrending(list)
        setTrendingStatus(statusOf(list.length))
      } else {
        console.error("[pictorium] Failed to refresh lists:", trendingRes.reason)
        setTrendingStatus("error")
        failures++
      }
      if (animeRes.status === "fulfilled" && animeRes.value) {
        setMdblistAnimeList(animeRes.value as EnrichedAnimeItem[])
        setAnimeStatus(statusOf(animeRes.value.length))
      } else if (animeRes.status === "rejected" || !animeRes.value) {
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
  }, [tmdbKey, mdblistApiKey, region.code, hasServerKey, loadPlatform])

  return { trending, trendingStatus, trendingError: trendingStatus === "error", mdblistAnimeList, animeStatus, animeSource, streamingCharts, platformErrors, loadPlatform, refreshLists, refreshNonce }
}
