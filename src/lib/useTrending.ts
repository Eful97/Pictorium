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
  // preview) e invalida la cache full di sessione.
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastRefreshRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const platformAbortRef = useRef<AbortController | null>(null)

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

  // FlixPatrol: defer + limit concurrency (evita burst di 8 fetch al mount).
  // Il paese segue la regione attiva: al cambio regione si ricaricano le chart.
  useEffect(() => {
    setStreamingCharts({})
    setPlatformErrors({})
    if (!tmdbKey && !hasServerKey) return
    const ctrl = new AbortController()
    platformAbortRef.current = ctrl
    const signal = ctrl.signal
    // Defer di 2s per non intasare il burst iniziale trending+anime
    const timer = setTimeout(() => {
      let idx = 0
      const runNext = () => {
        if (signal.aborted || idx >= STREAMING_PLATFORMS.length) return
        // batch di 2 alla volta
        const batch = STREAMING_PLATFORMS.slice(idx, idx + 2)
        idx += 2
        Promise.all(batch.map((p) =>
          http<FlixPatrolChart>(`/api/flixpatrol/top10?platform=${p.slug}&country=${encodeURIComponent(flixCountry)}&api_key=${encodeURIComponent(tmdbKey)}`, { timeout: 30000, signal })
            .then((data) => {
              if (signal.aborted) return
              setStreamingCharts((prev) => ({ ...prev, [p.slug]: data }))
              setPlatformErrors((prev) => {
                if (!prev[p.slug]) return prev
                const next = { ...prev }
                delete next[p.slug]
                return next
              })
            })
            .catch((e) => {
              if (signal.aborted) return
              console.error("[pictorium] FlixPatrol fetch failed for", p.slug, e)
              setPlatformErrors((prev) => ({ ...prev, [p.slug]: true }))
            })
        )).finally(() => {
          if (!signal.aborted) setTimeout(runNext, 300)
        })
      }
      runNext()
    }, 2000)
    return () => { clearTimeout(timer); ctrl.abort() }
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
    // Le entry custom ricaricano le preview su questo cambio; la cache full
    // di sessione viene invalidata da CataloghiView sullo stesso segnale.
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
    // Piattaforme a batch di 2 (stesso limite del mount), esiti indipendenti.
    for (let i = 0; (tmdbKey || hasServerKey) && i < STREAMING_PLATFORMS.length; i += 2) {
      if (signal.aborted) return
      const batch = STREAMING_PLATFORMS.slice(i, i + 2)
      const settled = await Promise.allSettled(batch.map((p) =>
        http<FlixPatrolChart>(`/api/flixpatrol/top10?platform=${p.slug}&country=${encodeURIComponent(flixCountry)}&api_key=${encodeURIComponent(tmdbKey)}&_t=${now}`, { timeout: 30000, signal }),
      ))
      if (signal.aborted) return
      settled.forEach((res, bi) => {
        const slug = batch[bi].slug
        if (res.status === "fulfilled") {
          setStreamingCharts((prev) => ({ ...prev, [slug]: res.value }))
          setPlatformErrors((prev) => {
            if (!prev[slug]) return prev
            const next = { ...prev }
            delete next[slug]
            return next
          })
        } else {
          if ((res.reason as Error)?.name !== "AbortError") {
            console.error("[pictorium] FlixPatrol refresh failed for", slug, res.reason)
          }
          setPlatformErrors((prev) => ({ ...prev, [slug]: true }))
          failures++
        }
      })
    }
    failures += await customPromise
    if (signal.aborted) return
    // Successo solo per gli esiti davvero riusciti: il parziale resta
    // riconoscibile e i dati vecchi non vengono mai cancellati.
    import("sonner").then(({ toast }) => {
      if (failures === 0) toast(t("ui.listsRefreshed"))
      else toast.warning(t("ui.listsPartial"))
    })
  }, [tmdbKey, mdblistApiKey, region.code, flixCountry, hasServerKey])

  return { trending, trendingStatus, trendingError: trendingStatus === "error", mdblistAnimeList, animeStatus, animeSource, streamingCharts, platformErrors, refreshLists, refreshNonce }
}
