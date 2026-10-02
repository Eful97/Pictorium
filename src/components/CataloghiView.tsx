"use client"

import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getRegionDef } from "@/lib/regions"
import { toSearchResult } from "@/lib/types"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Modal } from "@/components/ui/Modal"
import { catalogStatusErrorKey } from "@/lib/catalog-provider-detect"
import { SimklCard, type SimklCardItem } from "@/components/SimklCard"
import { CustomCatalogModal } from "@/components/CustomCatalogModal"
import { CatalogManagerModal } from "@/components/CatalogManagerModal"
import { posterUrl } from "@/lib/utils"
import { userFetch } from "@/lib/http"
import { currentPathUuid } from "@/lib/user-token"
import { X, Check, ListPlus, Trash2, Film, Tv, Shuffle, Power, SlidersHorizontal, Home, RefreshCw } from "lucide-react"

interface GridViewItem {
  tmdbId: number | null
  mediaType: "movie" | "tv"
  title: string
  posterPath: string | null
}

/** Coppia di contenitori Film | Serie affiancati sulla stessa riga (2 colonne su desktop). */
function CatalogPair({
  movies,
  tv,
  totalMovies,
  totalTv,
  movieTitle,
  tvTitle,
  movieGridTitle,
  tvGridTitle,
  openGrid,
  onItemClick,
  savedKeys,
  showEmpty,
}: {
  movies: SimklCardItem[]
  tv: SimklCardItem[]
  totalMovies: number
  totalTv: number
  movieTitle: string
  tvTitle: string
  movieGridTitle: string
  tvGridTitle: string
  openGrid: (items: GridViewItem[], title: string, section: "movie" | "tv") => void
  onItemClick: (item: SimklCardItem) => void
  savedKeys: Set<string>
  /** Se true, rende anche le sezioni vuote (cataloghi mixed con preview
   * sbilanciata: la sezione assente in preview resta cliccabile e carica il
   * full filtrato alla prima apertura). */
  showEmpty?: boolean
}) {
  const hasMovies = movies.length > 0
  const hasTv = tv.length > 0
  const showMovies = hasMovies || !!showEmpty
  const showTv = hasTv || !!showEmpty
  if (!showMovies && !showTv) return null

  const toGrid = (list: SimklCardItem[]): GridViewItem[] => toGridItems(list)

  return (
    <div className={`grid gap-3 ${showMovies && showTv ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
      {showMovies && (
        <SimklCard
          className="simkl-list-card--fill"
          items={movies}
          title={movieTitle}
          totalCount={totalMovies}
          onClick={() => openGrid(toGrid(movies), movieGridTitle, "movie")}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
        />
      )}
      {showTv && (
        <SimklCard
          className="simkl-list-card--fill"
          items={tv}
          title={tvTitle}
          totalCount={totalTv}
          onClick={() => openGrid(toGrid(tv), tvGridTitle, "tv")}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
        />
      )}
    </div>
  )
}

/** Converte item custom/unificati nel formato griglia (condiviso). */
function toGridItems(list: SimklCardItem[]): GridViewItem[] {
  return list.map((it) => ({
    tmdbId: resolvedTmdbId(it),
    mediaType: (it.media_type || it.mediaType || "movie") as "movie" | "tv",
    title: it.title ?? it.name ?? "",
    posterPath: it.poster_path ?? it.posterPath ?? null,
  }))
}

function resolvedTmdbId(item: SimklCardItem): number | null {
  const id = item.tmdbId ?? item.id
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Filtra la lista completa sulla sezione aperta (film/serie dallo slice preview). */
function filterSection(full: SimklCardItem[], previewSlice: SimklCardItem[]): SimklCardItem[] {
  const types = new Set(previewSlice.map((it) => it.media_type || it.mediaType))
  return full.filter((it) => types.has(it.media_type || it.mediaType))
}

/** Filtro per sezione esplicita della card; senza `section` degrada allo slice preview. */
function filterBySection(
  full: SimklCardItem[],
  previewSlice: SimklCardItem[] | GridViewItem[],
  section?: "movie" | "tv",
): SimklCardItem[] {
  if (section) return full.filter((it) => (it.media_type || it.mediaType) === section)
  return filterSection(full, previewSlice as SimklCardItem[])
}

// Preview leggera per le card custom (la griglia completa arriva su open):
// N cataloghi × 500 item parsati nel client ad ogni visita erano il collo
// di bottiglia. Cache di sessione per la lista completa (chiave URL+chiavi).
const CUSTOM_PREVIEW_LIMIT = 40
const CUSTOM_FULL_LIMIT = 500
const CUSTOM_CACHE_TTL = 5 * 60 * 1000
const customFullCache = new Map<string, { items: SimklCardItem[]; expires: number }>()

function customItemsUrl(url: string, tmdbKey: string, mdblistApiKey: string, limit: number, datasetId?: string): string {
  const params = new URLSearchParams({
    url,
    api_key: tmdbKey || "",
    mdblist_key: mdblistApiKey || "",
    limit: String(limit),
  })
  if (datasetId) params.set("dataset", datasetId)
  return `/api/mdblist/custom?${params.toString()}`
}

async function fetchCustomItems(url: string, signal?: AbortSignal): Promise<{ items: SimklCardItem[]; total: number | null }> {
  // userFetch (mai fetch grezzo): sui path /u/<uuid> aggiunge ?u= + token così
  // il server risolve le chiavi salvate nel profilo (con fetch grezzo le
  // copertine restavano vuote in multi-user pur funzionando in locale).
  const res = await userFetch(url, { signal })
  const data = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(data?.items)) throw new Error("ui.catalogsError")
  if (data.status && data.status !== "ok" && data.status !== "empty") {
    throw new Error(catalogStatusErrorKey(data.status, data.provider))
  }
  return { items: data.items, total: typeof data?.total === "number" ? data.total : null }
}

function CustomCatalogEntry({
  cat,
  openGrid,
  onItemClick,
  savedKeys,
  toggleCustomCatalog,
  removeCustomCatalog,
  homeDisabledCatalogIds,
  toggleCatalogHome,
  tmdbKey,
  mdblistApiKey,
  registerRefresh,
}: {
  cat: import("@/lib/types").CustomCatalogConfig
  openGrid: (items: GridViewItem[], title: string, notice?: string) => void
  onItemClick: (item: SimklCardItem) => void
  savedKeys: Set<string>
  toggleCustomCatalog: (id: string) => void
  removeCustomCatalog: (id: string) => void
  homeDisabledCatalogIds: string[]
  toggleCatalogHome: (id: string) => void
  tmdbKey: string
  mdblistApiKey: string
  registerRefresh: (id: string, refresh: (() => Promise<boolean>) | null) => void
}) {
  const { t } = useT()
  const [items, setItems] = useState<SimklCardItem[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanding, setExpanding] = useState(false)
  const previewControllerRef = useRef<AbortController | null>(null)
  const fullControllerRef = useRef<AbortController | null>(null)
  const isEnabled = cat.enabled !== false
  const isHomeVisible = !homeDisabledCatalogIds.includes(cat.id)
  const isMixed = cat.type === "mixed"
  const isMovie = cat.type === "movie"

  // Il namespace entra nella chiave: due profili non devono condividere il
  // full cachato (le chiavi server-side differiscono per utente).
  const namespaceUuid = currentPathUuid()
  const fullCacheKey = `${namespaceUuid || ""}|${cat.url}|${cat.datasetId || ""}|${tmdbKey || ""}|${mdblistApiKey || ""}`

  const loadPreview = useCallback(async (): Promise<boolean> => {
    previewControllerRef.current?.abort()
    fullControllerRef.current?.abort()
    setExpanding(false)
    const ctrl = new AbortController()
    previewControllerRef.current = ctrl
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchCustomItems(customItemsUrl(cat.url, tmdbKey, mdblistApiKey, CUSTOM_PREVIEW_LIMIT, cat.datasetId), AbortSignal.any([ctrl.signal, AbortSignal.timeout(30000)]))
      if (ctrl.signal.aborted) return false
      setItems(data.items)
      setTotal(data.total)
      return true
    } catch (error) {
      if (!ctrl.signal.aborted) setLoadError(error instanceof Error && error.message.startsWith("ui.") ? error.message : "ui.catalogsError")
      return false
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [cat.url, cat.datasetId, tmdbKey, mdblistApiKey])

  useEffect(() => {
    registerRefresh(cat.id, loadPreview)
    void loadPreview()
    return () => {
      registerRefresh(cat.id, null)
      previewControllerRef.current?.abort()
      fullControllerRef.current?.abort()
    }
  }, [cat.id, fullCacheKey, loadPreview, registerRefresh])

  const expandAndOpen = async (previewSlice: SimklCardItem[] | GridViewItem[], title: string, section?: "movie" | "tv") => {
    const cached = customFullCache.get(fullCacheKey)
    if (cached && cached.expires > Date.now()) {
      openGrid(toGridItems(filterBySection(cached.items, previewSlice, section)), title, cached.items.length >= CUSTOM_FULL_LIMIT ? "ui.customGridLimit" : undefined)
      return
    }
    fullControllerRef.current?.abort()
    const ctrl = new AbortController()
    fullControllerRef.current = ctrl
    setExpanding(true)
    try {
      const { items: full } = await fetchCustomItems(customItemsUrl(cat.url, tmdbKey, mdblistApiKey, CUSTOM_FULL_LIMIT, cat.datasetId), AbortSignal.any([ctrl.signal, AbortSignal.timeout(30000)]))
      if (ctrl.signal.aborted) return
      customFullCache.delete(fullCacheKey)
      if (customFullCache.size >= 20) customFullCache.delete(customFullCache.keys().next().value!)
      customFullCache.set(fullCacheKey, { items: full, expires: Date.now() + CUSTOM_CACHE_TTL })
      openGrid(toGridItems(filterBySection(full, previewSlice, section)), title, full.length >= CUSTOM_FULL_LIMIT ? "ui.customGridLimit" : undefined)
    } catch {
      if (!ctrl.signal.aborted) openGrid(toGridItems(previewSlice as SimklCardItem[]), title, "ui.customPreviewOnly")
    } finally {
      if (!ctrl.signal.aborted) setExpanding(false)
    }
  }

  const movies = items.filter((it) => (it.media_type || it.mediaType) === "movie")
  const tv = items.filter((it) => (it.media_type || it.mediaType) !== "movie")

  return (
    <div className={`relative p-4 rounded-2xl border transition-all duration-200 ${
      isEnabled ? "bg-surface border-white/10 shadow-sm" : "bg-surface/40 border-white/5 opacity-60"
    }`}>
      {expanding && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl bg-black/50 backdrop-blur-[2px] text-xs text-zinc-300" aria-live="polite">
          <div className="w-4 h-4 border-2 border-accent-orange/30 border-t-accent-orange rounded-full animate-spin" />
          {t("ui.customLoadingTitles")}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${
            isMixed
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              : isMovie
              ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
              : "bg-purple-500/15 text-purple-400 border border-purple-500/20"
          }`}>
            {isMixed ? <Shuffle className="w-3 h-3" /> : isMovie ? <Film className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
            {isMixed ? t("ui.mixedType") : isMovie ? t("ui.movie") : t("ui.tvSeries")}
          </span>
          <h3 className="text-base font-bold text-white line-clamp-1">{cat.name}</h3>
          {total !== null && total > items.length && (
            <span className="shrink-0 text-[10px] text-muted">
              {total} {total === 1 ? t("ui.itemOne") : t("ui.itemMany")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleCatalogHome(cat.id)}
            title={
              isHomeVisible
                ? t("ui.homeVisible")
                : t("ui.homeHidden")
            }
            className={`p-1.5 rounded-lg border transition-colors ${
              isHomeVisible
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                : "bg-white/5 border-white/5 text-muted hover:text-white"
            }`}
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => toggleCustomCatalog(cat.id)}
            title={isEnabled ? t("ui.disableStremio") : t("ui.enableStremio")}
            className={`p-1.5 rounded-lg border transition-colors ${
              isEnabled
                ? "bg-accent-orange/15 border-accent-orange/30 text-accent-orange hover:bg-accent-orange/25"
                : "bg-white/5 border-white/5 text-muted hover:text-white"
            }`}
          >
            <Power className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => removeCustomCatalog(cat.id)}
            title={t("ui.deleteCatalog")}
            className="p-1.5 rounded-lg border border-white/5 text-muted hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-28 flex items-center justify-center rounded-xl bg-black/20 border border-white/5 text-xs text-muted">
          <div className="w-4 h-4 border-2 border-accent-orange/30 border-t-accent-orange rounded-full animate-spin mr-2" />
          {t("ui.customLoadingTitles")}
        </div>
      ) : loadError ? (
        <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-muted flex items-center justify-between gap-2">
          <span>{t(loadError)}</span>
          <button
            type="button"
            onClick={() => { void loadPreview() }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface2/60 text-zinc-200 hover:bg-surface2 border border-white/10 transition-colors"
          >
            {t("ui.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-muted">
          {t("ui.customNoTitles")}
        </div>
      ) : isMixed ? (
        <CatalogPair
          movies={movies}
          tv={tv}
          totalMovies={movies.length}
          totalTv={tv.length}
          movieTitle={`${cat.name} — ${t("ui.movie")}`}
          tvTitle={`${cat.name} — ${t("ui.tvSeries")}`}
          movieGridTitle={`${cat.name} — ${t("ui.movie")}`}
          tvGridTitle={`${cat.name} — ${t("ui.tvSeries")}`}
          openGrid={(gridItems, title, section) => {
            void expandAndOpen(gridItems, title, section)
          }}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
          showEmpty
        />
      ) : isMovie ? (
        <CatalogPair
          movies={movies.length > 0 ? movies : items}
          tv={[]}
          totalMovies={movies.length > 0 ? movies.length : items.length}
          totalTv={0}
          movieTitle={cat.name}
          tvTitle=""
          movieGridTitle={cat.name}
          tvGridTitle=""
          openGrid={(gridItems, title, section) => {
            void expandAndOpen(gridItems, title, section)
          }}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
        />
      ) : (
        <CatalogPair
          movies={[]}
          tv={tv.length > 0 ? tv : items}
          totalMovies={0}
          totalTv={tv.length > 0 ? tv.length : items.length}
          movieTitle=""
          tvTitle={cat.name}
          movieGridTitle=""
          tvGridTitle={cat.name}
          openGrid={(gridItems, title, section) => {
            void expandAndOpen(gridItems, title, section)
          }}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
        />
      )}
    </div>
  )
}

export function CataloghiView() {
  const trending = usePSelector((v) => v.trending)
  const trendingStatus = usePSelector((v) => v.trendingStatus)
  const animeStatus = usePSelector((v) => v.animeStatus)
  const animeSource = usePSelector((v) => v.animeSource)
  const platformErrors = usePSelector((v) => v.platformErrors)
  const mappings = usePSelector((v) => v.mappings)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const STREAMING_PLATFORMS = usePSelector((v) => v.STREAMING_PLATFORMS)
  const mdblistAnimeList = usePSelector((v) => v.mdblistAnimeList)
  const router = usePSelector((v) => v.router)
  const streamingCharts = usePSelector((v) => v.streamingCharts)
  const refreshLists = usePSelector((v) => v.refreshLists)
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const removeCustomCatalog = usePSelector((v) => v.removeCustomCatalog)
  const toggleCustomCatalog = usePSelector((v) => v.toggleCustomCatalog)
  const homeDisabledCatalogIds = usePSelector((v) => v.homeDisabledCatalogIds)
  const toggleCatalogHome = usePSelector((v) => v.toggleCatalogHome)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const serverHasTmdbKey = usePSelector((v) => v.serverHasTmdbKey)
  const hasKey = !!tmdbKey || serverHasTmdbKey
  const mdblistApiKey = usePSelector((v) => v.mdblistApiKey)
  const { t } = useT()
  const platformFilters = useMemo(() => [
    { id: "all", label: t("ui.all") },
    { id: "custom", label: t("ui.customCatalogs") },
    { id: "justwatch", label: "JustWatch" },
    { id: "netflix", label: "Netflix" },
    { id: "amazon-prime", label: "Prime Video" },
    { id: "disney", label: "Disney+" },
    { id: "now", label: "NOW / Sky" },
    { id: "apple-tv", label: "Apple TV+" },
    { id: "hbo-max", label: "HBO Max" },
    { id: "paramount-plus", label: "Paramount+" },
    { id: "crunchyroll", label: "Crunchyroll" },
    { id: "anime", label: "Anime" },
  ], [t])
  const ed = usePosterEditor()
  const regionFlag = getRegionDef(ed.defaultRegion).flag
  const movieTrending = trending.filter((r) => r.media_type === "movie").slice(0, 20)
  const tvTrending = trending.filter((r) => r.media_type === "tv").slice(0, 20)
  const animeMovies = mdblistAnimeList.filter((r) => r.media_type === "movie")
  const animeTv = mdblistAnimeList.filter((r) => r.media_type !== "movie")
  const [gridItems, setGridItems] = useState<GridViewItem[] | null>(null)
  const [gridNotice, setGridNotice] = useState<string | undefined>()
  const [gridTitle, setGridTitle] = useState("")
  const [platformFilter, setPlatformFilter] = useState<string>("all")
  const [isAddCustomOpen, setIsAddCustomOpen] = useState(false)
  const [isManagerOpen, setIsManagerOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const savedKeys = useMemo(
    () => new Set(mappings.map((m) => `${m.mediaType}:${m.tmdbId}`)),
    [mappings],
  )

  const openGrid = (items: GridViewItem[], title: string, notice?: string) => {
    setGridNotice(notice)
    setGridItems(items)
    setGridTitle(title)
  }

  const navigateToItem = (item: SimklCardItem) => {
    const id = resolvedTmdbId(item)
    if (!id) return
    const mediaType = (item.media_type || item.mediaType) as "movie" | "tv" || "movie"
    const title = item.title ?? item.name ?? ""
    navigateToPoster(toSearchResult({
      id,
      media_type: mediaType,
      title,
      name: title,
      poster_path: item.poster_path ?? item.posterPath,
    }), "cataloghi")
  }

  const customRefreshers = useRef(new Map<string, () => Promise<boolean>>())
  const registerRefresh = useCallback((id: string, refresh: (() => Promise<boolean>) | null) => {
    if (refresh) customRefreshers.current.set(id, refresh)
    else customRefreshers.current.delete(id)
  }, [])
  const refreshCatalogs = async () => {
    setRefreshing(true)
    try {
      await refreshLists(async () => {
        customFullCache.clear()
        const results = await Promise.allSettled(Array.from(customRefreshers.current.values(), (refresh) => refresh()))
        return results.filter((result) => result.status === "rejected" || !result.value).length
      })
    } finally { setRefreshing(false) }
  }
  const closeGrid = useCallback(() => setGridItems(null), [])

  const SCROLL_KEY = "cataloghi:scroll"

  useEffect(() => {
    // sessionStorage può lanciare (private mode, iframe sandbox): non deve rompere il render
    let saved: string | null = null
    try { saved = sessionStorage.getItem(SCROLL_KEY) } catch { /* storage non disponibile */ }
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, Number(saved)))
    }
    return () => {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)) } catch { /* storage non disponibile */ }
    }
  }, [])

  const filteredPlatforms = STREAMING_PLATFORMS.filter((sp) => {
    if (platformFilter === "all") return true
    if (platformFilter === "justwatch" || platformFilter === "anime" || platformFilter === "custom") return false
    return sp.slug === platformFilter
  })

  const showJustWatch = (platformFilter === "all" || platformFilter === "justwatch") && trending.length > 0
  const showAnime = (platformFilter === "all" || platformFilter === "anime") && mdblistAnimeList.length > 0
  const showCustom = (platformFilter === "all" || platformFilter === "custom")

  return (
    <div className="max-w-6xl mx-auto animate-fade-scale-in">
      <>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <button type="button"
              onClick={() => router.push("edit")}
              className="text-xs text-muted hover:text-white transition-colors mb-3 inline-flex items-center gap-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              {t("ui.homeBtn")}
            </button>
            <h1 className="text-2xl font-bold text-zinc-50">{t("ui.catalogsTitle")}</h1>
            <p className="text-sm text-muted mt-1">{t("ui.catalogsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              aria-label={t("ui.refreshLists")}
              title={t("ui.refreshLists")}
              onClick={refreshCatalogs}
              disabled={refreshing}
              className="flex items-center justify-center w-9 h-9 rounded-xl bg-surface2 border border-white/10 hover:border-white/20 text-zinc-200 hover:text-white active:scale-95 transition-all shadow-sm disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-accent-orange ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsManagerOpen((prev) => !prev)
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface2 border border-white/10 hover:border-white/20 text-zinc-200 text-xs font-semibold hover:text-white active:scale-95 transition-all shadow-sm"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-accent-orange" />
                <span>{t("ui.priorityNames")}</span>
              </button>
              <CatalogManagerModal isOpen={isManagerOpen} onClose={() => setIsManagerOpen(false)} />
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsAddCustomOpen((prev) => !prev)
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-orange text-white text-xs font-semibold hover:bg-accent-orange/90 active:scale-95 transition-all shadow-md"
              >
                <ListPlus className="w-4 h-4" />
                <span>{t("ui.addCatalog")}</span>
              </button>
              <CustomCatalogModal isOpen={isAddCustomOpen} onClose={() => setIsAddCustomOpen(false)} />
            </div>
          </div>
        </div>
      </>

      {/* Platform Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-2 mb-8">
        {platformFilters.map((f) => (
          <button type="button"
            key={f.id}
            onClick={() => setPlatformFilter(f.id)}
            aria-pressed={platformFilter === f.id}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-150 active:scale-95 ${
              platformFilter === f.id
                ? "bg-accent-orange/15 text-accent-orange border border-accent-orange/30 shadow-sm font-semibold"
                : "bg-surface/80 text-muted hover:text-zinc-200 border border-white/5 hover:border-white/10"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Custom Catalogs Section */}
      {showCustom && customCatalogs.length > 0 && (
        <>
          <div className="mb-12 space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-heading text-xl font-bold">{t("ui.customCatalogs")}</h2>
              <span className="text-xs text-muted">
                {t("ui.activeOnStremio", { count: customCatalogs.filter((c) => c.enabled !== false).length })}
              </span>
            </div>
            <div className="space-y-6">
              {customCatalogs.map((cat) => (
                <CustomCatalogEntry
                  key={cat.id}
                  cat={cat}
                  openGrid={openGrid}
                  onItemClick={navigateToItem}
                  savedKeys={savedKeys}
                  toggleCustomCatalog={toggleCustomCatalog}
                  removeCustomCatalog={removeCustomCatalog}
                  homeDisabledCatalogIds={homeDisabledCatalogIds}
                  toggleCatalogHome={toggleCatalogHome}
                  tmdbKey={tmdbKey}
                  mdblistApiKey={mdblistApiKey}
                  registerRefresh={registerRefresh}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {showCustom && customCatalogs.length > 0 && <div className="section-divider" />}

      {/* JustWatch Top 20 — due contenitori separati (Film | Serie) sulla stessa riga */}
      {showJustWatch && (
        <>
          <div className="mb-12">
            <h2 className="section-heading text-xl font-bold mb-6">{t("ui.justwatchTop20")} {regionFlag}</h2>
            <CatalogPair
              movies={movieTrending}
              tv={tvTrending}
              totalMovies={movieTrending.length}
              totalTv={tvTrending.length}
              movieTitle={`${t("ui.movie")} — Top 20`}
              tvTitle={`${t("ui.tvSeries")} — Top 20`}
              movieGridTitle={`JustWatch — ${t("ui.movie")}`}
              tvGridTitle={`JustWatch — ${t("ui.tvSeries")}`}
              openGrid={openGrid}
              onItemClick={navigateToItem}
              savedKeys={savedKeys}
            />
          </div>
        </>
      )}

      {showJustWatch && <div className="section-divider" />}

      {/* Piattaforme streaming — filtrate se attivo un filtro */}
      {filteredPlatforms.length > 0 && (
        <>
          <div className="mb-12">
            <h2 className="section-heading text-xl font-bold mb-6">{t("ui.streamingPlatforms")}</h2>
            {filteredPlatforms.map((sp) => {
              const chart = streamingCharts[sp.slug]
              if (!chart || (chart.movies.length === 0 && chart.tv.length === 0)) return null
              return (
                <div key={sp.slug} className="mb-6 last:mb-0">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                    {sp.icon && <span className="text-base">{sp.icon}</span>}
                    {sp.name}
                  </h3>
                  <CatalogPair
                    movies={chart.movies}
                    tv={chart.tv}
                    totalMovies={chart.movies.length}
                    totalTv={chart.tv.length}
                    movieTitle={`${t("ui.movie")} — Top 10`}
                    tvTitle={`${t("ui.tvSeries")} — Top 10`}
                    movieGridTitle={`${sp.name} — ${t("ui.movie")}`}
                    tvGridTitle={`${sp.name} — ${t("ui.tvSeries")}`}
                    openGrid={openGrid}
                    onItemClick={navigateToItem}
                    savedKeys={savedKeys}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}

      {showAnime && <div className="section-divider" />}

      {/* Anime trending — Film e Serie in due contenitori separati.
          Anche uno-quattro risultati validi si mostrano (niente soglia). */}
      {showAnime && (
        <>
          <div className="mb-12">
            <h2 className="section-heading text-xl font-bold mb-6">{t("ui.trendingAnime")}</h2>
            {animeSource === "tmdb" && <p className="text-xs text-muted mb-3">{t("ui.animeFallback")}</p>}
            <CatalogPair
              movies={animeMovies}
              tv={animeTv}
              totalMovies={animeMovies.length}
              totalTv={animeTv.length}
              movieTitle={`${t("ui.movie")} — Top 20`}
              tvTitle={`${t("ui.tvSeries")} — Top 20`}
              movieGridTitle={`Anime — ${t("ui.movie")}`}
              tvGridTitle={`Anime — ${t("ui.tvSeries")}`}
              openGrid={openGrid}
              onItemClick={navigateToItem}
              savedKeys={savedKeys}
            />
          </div>
        </>
      )}

      {/* Stati di fondo: espliciti per filtro e per stato di caricamento, mai
          dedotti dal solo trending.length. Un problema JustWatch non nasconde
          le liste custom funzionanti mostrate sopra. */}
      {!hasKey && platformFilter !== "custom" && trending.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <div className="empty-state-illustration mb-5">
            <svg className="w-10 h-10 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" opacity="0.3"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" opacity="0.5"/>
            </svg>
          </div>
          <p className="text-sm text-muted mb-2">{t("ui.noKey")}</p>
          <p className="text-zinc-500 text-xs max-w-xs mx-auto leading-relaxed text-center">{t("ui.noKeySub")}</p>
        </div>
      )}

      {hasKey && trending.length === 0 && (platformFilter === "all" || platformFilter === "justwatch") && (trendingStatus === "loading" || trendingStatus === "idle") && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <div className="empty-state-illustration mb-5">
            <svg className="w-10 h-10 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" opacity="0.5"/>
            </svg>
          </div>
          <p className="text-sm text-muted mb-2">{t("ui.loadingCatalogs")}</p>
          <div className="w-8 h-8 rounded-full border-2 border-border border-t-accent-orange animate-spin" />
        </div>
      )}

      {hasKey && trending.length === 0 && (platformFilter === "all" || platformFilter === "justwatch") && trendingStatus === "error" && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <div className="empty-state-illustration mb-5">
            <svg className="w-10 h-10 text-danger/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-muted mb-4">{t("ui.catalogsError")}</p>
          <button type="button" onClick={() => { void refreshCatalogs() }} className="btn-ghost px-4 py-2 text-xs">{t("ui.retry")}</button>
        </div>
      )}

      {hasKey && trending.length === 0 && trendingStatus === "empty" && (platformFilter === "justwatch" || (platformFilter === "all" && (animeStatus === "empty" || animeStatus === "error") && mdblistAnimeList.length === 0 && customCatalogs.length === 0 && STREAMING_PLATFORMS.every(sp => streamingCharts[sp.slug] || platformErrors[sp.slug]) && !STREAMING_PLATFORMS.some((sp) => {
        const c = streamingCharts[sp.slug]
        return c && (c.movies.length > 0 || c.tv.length > 0)
      }))) && (
        <div className="text-center py-16 animate-fade-scale-in">
          <p className="text-muted text-sm">{t("ui.customNoTitles")}</p>
        </div>
      )}

      {hasKey && platformFilter === "anime" && mdblistAnimeList.length === 0 && (animeStatus === "loading" || animeStatus === "idle") && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <p className="text-sm text-muted mb-2">{t("ui.loadingCatalogs")}</p>
          <div className="w-8 h-8 rounded-full border-2 border-border border-t-accent-orange animate-spin" />
        </div>
      )}

      {hasKey && platformFilter === "anime" && mdblistAnimeList.length === 0 && animeStatus === "error" && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <p className="text-sm text-muted mb-4">{t("ui.catalogsError")}</p>
          <button type="button" onClick={() => { void refreshCatalogs() }} className="btn-ghost px-4 py-2 text-xs">{t("ui.retry")}</button>
        </div>
      )}

      {hasKey && platformFilter === "anime" && mdblistAnimeList.length === 0 && animeStatus === "empty" && (
        <div className="text-center py-16 animate-fade-scale-in">
          <p className="text-muted text-sm">{t("ui.customNoTitles")}</p>
        </div>
      )}

      {hasKey && !["all", "custom", "justwatch", "anime"].includes(platformFilter) && (() => {
        const sp = STREAMING_PLATFORMS.find((p) => p.slug === platformFilter)
        const chart = sp ? streamingCharts[sp.slug] : undefined
        const hasData = !!chart && (chart.movies.length > 0 || chart.tv.length > 0)
        if (hasData) return null
        if (sp && platformErrors[sp.slug]) {
          return (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
              <p className="text-sm text-muted mb-4">{t("ui.catalogsError")}</p>
              <button type="button" onClick={() => { void refreshCatalogs() }} className="btn-ghost px-4 py-2 text-xs">{t("ui.retry")}</button>
            </div>
          )
        }
        if (!chart) {
          return (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
              <p className="text-sm text-muted mb-2">{t("ui.loadingCatalogs")}</p>
              <div className="w-8 h-8 rounded-full border-2 border-border border-t-accent-orange animate-spin" />
            </div>
          )
        }
        return (
          <div className="text-center py-16 animate-fade-scale-in">
            <p className="text-muted text-sm">{t("ui.customNoTitles")}</p>
          </div>
        )
      })()}

      {platformFilter === "custom" && customCatalogs.length === 0 && (
        <div className="text-center py-16 animate-fade-scale-in">
          <p className="text-muted text-sm">{t("ui.customNoTitles")}</p>
        </div>
      )}

      <Modal isOpen={gridItems !== null} onClose={closeGrid} labelledBy="catalog-grid-title" className="!max-w-7xl max-h-[90vh] overflow-y-auto !p-4">
            <div className="flex items-center justify-between mb-6">
              <h2 id="catalog-grid-title" className="text-xl font-bold text-zinc-50">{gridTitle}</h2>
              <button type="button"
                onClick={() => setGridItems(null)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface2 hover:bg-zinc-700 text-muted hover:text-zinc-200 transition-all"
                aria-label={t("ui.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {gridNotice && <p role="status" className="text-xs text-muted">{t(gridNotice)}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
              {(gridItems ?? []).map((item, idx) => {
                const src = item.posterPath ? posterUrl(item.posterPath, "w342") : ""
                const itemKey = `${item.mediaType}:${item.tmdbId}`
                const isSaved = item.tmdbId ? savedKeys.has(itemKey) : false

                return (
                  <button type="button"
                    key={`${item.mediaType}:${item.tmdbId ?? "item"}-${idx}`}
                    disabled={item.tmdbId === null}
                    onClick={() => {
                      if (item.tmdbId) {
                        navigateToPoster(toSearchResult({
                          id: item.tmdbId,
                          media_type: item.mediaType,
                          title: item.title,
                          name: item.title,
                          poster_path: item.posterPath,
                        }), "cataloghi")
                      }
                    }}
                    className={`group relative aspect-[2/3] rounded-xl overflow-hidden bg-surface2 transition-all focus:outline-none focus:ring-2 focus:ring-accent ${
                      isSaved
                        ? "ring-2 ring-emerald-500/80 border-emerald-500/80"
                        : "hover:ring-2 hover:ring-accent/50"
                    }`}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- remote TMDB poster tiles (lazy, optimized by CDN)
                      <img
                        src={src}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs p-2 text-center leading-relaxed">
                        {item.title}
                      </div>
                    )}
                    {isSaved && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-500/90 text-white text-[10px] font-semibold flex items-center gap-1 shadow-lg backdrop-blur-sm z-10">
                        <Check className="w-3 h-3 stroke-[3]" />
                        <span>{t("ui.savedShort")}</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
      </Modal>
    </div>
  )
}
