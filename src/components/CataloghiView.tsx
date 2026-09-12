"use client"

import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getRegionDef } from "@/lib/regions"
import { toSearchResult } from "@/lib/types"
import { useState, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { SimklCard, type SimklCardItem } from "@/components/SimklCard"
import { CustomCatalogModal } from "@/components/CustomCatalogModal"
import { CatalogManagerModal } from "@/components/CatalogManagerModal"
import { posterUrl } from "@/lib/utils"
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
}: {
  movies: SimklCardItem[]
  tv: SimklCardItem[]
  totalMovies: number
  totalTv: number
  movieTitle: string
  tvTitle: string
  movieGridTitle: string
  tvGridTitle: string
  openGrid: (items: GridViewItem[], title: string) => void
  onItemClick: (item: SimklCardItem) => void
  savedKeys: Set<string>
}) {
  const hasMovies = movies.length > 0
  const hasTv = tv.length > 0
  if (!hasMovies && !hasTv) return null

  const toGrid = (list: SimklCardItem[]): GridViewItem[] => toGridItems(list)

  return (
    <div className={`grid gap-3 ${hasMovies && hasTv ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
      {hasMovies && (
        <SimklCard
          className="simkl-list-card--fill"
          items={movies}
          title={movieTitle}
          totalCount={totalMovies}
          onClick={() => openGrid(toGrid(movies), movieGridTitle)}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
        />
      )}
      {hasTv && (
        <SimklCard
          className="simkl-list-card--fill"
          items={tv}
          title={tvTitle}
          totalCount={totalTv}
          onClick={() => openGrid(toGrid(tv), tvGridTitle)}
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
    tmdbId: it.tmdbId ?? it.id ?? null,
    mediaType: (it.media_type || it.mediaType || "movie") as "movie" | "tv",
    title: it.title ?? it.name ?? "",
    posterPath: it.poster_path ?? it.posterPath ?? null,
  }))
}

/** Filtra la lista completa sulla sezione aperta (film/serie dallo slice preview). */
function filterSection(full: SimklCardItem[], previewSlice: SimklCardItem[]): SimklCardItem[] {
  const types = new Set(previewSlice.map((it) => it.media_type || it.mediaType))
  return full.filter((it) => types.has(it.media_type || it.mediaType))
}

// Preview leggera per le card custom (la griglia completa arriva su open):
// N cataloghi × 500 item parsati nel client ad ogni visita erano il collo
// di bottiglia. Cache di sessione per la lista completa (chiave URL+chiavi).
const CUSTOM_PREVIEW_LIMIT = 40
const CUSTOM_FULL_LIMIT = 500
const customFullCache = new Map<string, SimklCardItem[]>()

function customItemsUrl(url: string, tmdbKey: string, mdblistApiKey: string, limit: number): string {
  const params = new URLSearchParams({
    url,
    api_key: tmdbKey || "",
    mdblist_key: mdblistApiKey || "",
    limit: String(limit),
  })
  return `/api/mdblist/custom?${params.toString()}`
}

async function fetchCustomItems(url: string, signal?: AbortSignal): Promise<SimklCardItem[]> {
  const res = await fetch(url, { signal })
  const data = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(data?.items)) throw new Error(`custom catalog failed: ${res.status}`)
  return data.items
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
}: {
  cat: import("@/lib/types").CustomCatalogConfig
  openGrid: (items: GridViewItem[], title: string) => void
  onItemClick: (item: SimklCardItem) => void
  savedKeys: Set<string>
  toggleCustomCatalog: (id: string) => void
  removeCustomCatalog: (id: string) => void
  homeDisabledCatalogIds: string[]
  toggleCatalogHome: (id: string) => void
  tmdbKey: string
  mdblistApiKey: string
}) {
  const { t } = useT()
  const [items, setItems] = useState<SimklCardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const isEnabled = cat.enabled !== false
  const isHomeVisible = !homeDisabledCatalogIds.includes(cat.id)
  const isMixed = cat.type === "mixed"
  const isMovie = cat.type === "movie"

  const fullCacheKey = `${cat.url}|${tmdbKey || ""}|${mdblistApiKey || ""}`

  useEffect(() => {
    let active = true
    const ctrl = new AbortController()
    setLoading(true)
    setLoadError(false)
    fetchCustomItems(customItemsUrl(cat.url, tmdbKey, mdblistApiKey, CUSTOM_PREVIEW_LIMIT), ctrl.signal)
      .then((list) => {
        if (!active) return
        setItems(list)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setLoadError(true)
        setLoading(false)
      })
    return () => {
      active = false
      ctrl.abort()
    }
  }, [cat.url, tmdbKey, mdblistApiKey, reloadNonce])

  // Griglia completa su richiesta: la preview mostra i primi 40, il full
  // (500) si scarica solo aprendo la griglia e resta in cache di sessione.
  // La sezione (film/serie) si ricava dai tipi presenti nello slice preview.
  const expandAndOpen = (previewSlice: SimklCardItem[], title: string) => {
    const cached = customFullCache.get(fullCacheKey)
    if (cached) {
      openGrid(toGridItems(filterSection(cached, previewSlice)), title)
      return
    }
    setExpanding(true)
    fetchCustomItems(customItemsUrl(cat.url, tmdbKey, mdblistApiKey, CUSTOM_FULL_LIMIT))
      .then((full) => {
        customFullCache.set(fullCacheKey, full)
        openGrid(toGridItems(filterSection(full, previewSlice)), title)
      })
      .catch(() => {
        // Fallback: apri con l'anteprima (meglio che niente).
        openGrid(toGridItems(previewSlice), title)
      })
      .finally(() => setExpanding(false))
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
            {isMixed ? "Misto" : isMovie ? "Film" : "Serie TV"}
          </span>
          <h3 className="text-base font-bold text-white line-clamp-1">{cat.name}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleCatalogHome(cat.id)}
            title={
              isHomeVisible
                ? "Visibile nella Home di Stremio (clicca per nascondere dalla Home)"
                : "Nascosto dalla Home di Stremio (visibile solo in Esplora — clicca per mostrare nella Home)"
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
          <span>{t("ui.catalogsError")}</span>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
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
          openGrid={(items, title) => {
            void expandAndOpen(items, title)
          }}
          onItemClick={onItemClick}
          savedKeys={savedKeys}
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
          openGrid={(items, title) => {
            void expandAndOpen(items, title)
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
          openGrid={(items, title) => {
            void expandAndOpen(items, title)
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
  const trendingError = usePSelector((v) => v.trendingError)
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
  const [gridTitle, setGridTitle] = useState("")
  const [platformFilter, setPlatformFilter] = useState<string>("all")
  const [isAddCustomOpen, setIsAddCustomOpen] = useState(false)
  const [isManagerOpen, setIsManagerOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const savedKeys = useMemo(
    () => new Set(mappings.map((m) => `${m.mediaType}:${m.tmdbId}`)),
    [mappings],
  )

  const openGrid = (items: GridViewItem[], title: string) => {
    setGridItems(items)
    setGridTitle(title)
  }

  const navigateToItem = (item: SimklCardItem) => {
    const id = item.tmdbId ?? item.id
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

  // Blocca lo scroll del body quando la griglia è aperta
  useEffect(() => {
    if (gridItems) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [gridItems])

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
              onClick={async () => { setRefreshing(true); await refreshLists(); setRefreshing(false) }}
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

      {/* Anime trending — Film e Serie in due contenitori separati */}
      {showAnime && mdblistAnimeList.length >= 5 && (
        <>
          <div className="mb-12">
            <h2 className="section-heading text-xl font-bold mb-6">{t("ui.trendingAnime")}</h2>
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

      {trending.length === 0 && !trendingError && (
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

      {trending.length === 0 && trendingError && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-500 animate-fade-scale-in">
          <div className="empty-state-illustration mb-5">
            <svg className="w-10 h-10 text-danger/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-muted mb-4">{t("ui.catalogsError")}</p>
          <button type="button" onClick={() => { void refreshLists() }} className="btn-ghost px-4 py-2 text-xs">{t("ui.retry")}</button>
        </div>
      )}

      {gridItems && createPortal(
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto animate-fade-scale-in" onClick={() => setGridItems(null)}>
          <div className="max-w-7xl mx-auto px-4 py-6 min-h-screen" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-zinc-50">{gridTitle}</h2>
              <button type="button"
                onClick={() => setGridItems(null)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface2 hover:bg-zinc-700 text-muted hover:text-zinc-200 transition-all"
                aria-label={t("ui.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
              {gridItems.map((item, idx) => {
                const src = item.posterPath ? posterUrl(item.posterPath, "w342") : ""
                const itemKey = `${item.mediaType}:${item.tmdbId}`
                const isSaved = item.tmdbId ? savedKeys.has(itemKey) : false

                return (
                  <button type="button"
                    key={`${item.mediaType}:${item.tmdbId ?? "item"}-${idx}`}
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
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
