"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { useSearchCtx } from "@/lib/contexts/SearchContext"
import { posterUrl, titleOf, yearOf } from "@/lib/utils"
import { SearchBar } from "@/components/SearchBar"
import { PosterCardSkeleton } from "@/components/Skeleton"
import { Clock, X, Check, ChevronDown, Clapperboard, Tv, Star, Trash2, Loader2 } from "lucide-react"
import { PosterDepthEdge } from "@/components/PosterDepthGlow"

export function SearchView() {
  const { t } = useT()
  const s = useSearchCtx()
  const { setQuery } = s
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const [searchFocused, setSearchFocused] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // B3: setQuery debounced (trailing 250ms) — digitare non ri-renderizza la griglia
  // risultati a ogni tasto (prima onChange={s.setQuery} committava al context per
  // keystroke). La ricerca vera parte solo su submit/Enter via doSearch.
  const queryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleQueryChange = useCallback((q: string) => {
    if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current)
    queryDebounceRef.current = setTimeout(() => setQuery(q), 250)
  }, [setQuery])

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
      if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current)
    }
  }, [])

  // Deep-link ?q=: precompila la ricerca dalla URL (es. /search?q=interstellar)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get("q")?.trim() ?? ""
    if (q.length >= 2) {
      s.setQuery(q)
      s.doSearch(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al mount
  }, [])

  const showRecent = searchFocused && s.recentSearches.length > 0

  const handleLoadMore = async () => {
    setLoadingMore(true)
    try {
      await s.loadMore()
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div>
      <div className="max-w-lg mx-auto relative z-[100] isolate mb-6">
        <SearchBar
          tmdbKey={tmdbKey}
          value={s.query}
          onChange={handleQueryChange}
          onSearch={(q) => {
            s.setQuery(q)
            s.doSearch(q)
          }}
          large
          onFocus={() => setSearchFocused(true)}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setSearchFocused(false), 200)
          }}
          error={s.error}
        />
        {showRecent && (
          <div className="absolute top-full left-0 right-0 mt-2 glass-panel rounded-2xl p-2 z-50 animate-fade-scale-in">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/[0.06] mb-1">
              <p className="text-xs text-muted font-semibold">{t("ui.recentSearches")}</p>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  s.clearRecentSearches()
                }}
                className="text-[11px] text-zinc-400 hover:text-rose-400 font-medium flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-rose-500/10 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t("ui.clearRecentSearches")}</span>
              </button>
            </div>
            {s.recentSearches.map((term) => (
              <button
                type="button"
                key={term}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  s.setQuery(term)
                  s.doSearch(term)
                  setSearchFocused(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent-orange/10 text-sm text-zinc-300 hover:text-accent transition-all duration-150 text-left"
              >
                <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
                <span className="flex-1 truncate">{term}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    s.removeRecentSearch(term)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      s.removeRecentSearch(term)
                    }
                  }}
                  aria-label={t("ui.remove")}
                  className="text-danger hover:text-red-300 transition-all duration-150 text-sm px-2 shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {s.searching && s.results.length === 0 && (
        <div className="mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4 max-w-7xl">
          {Array.from({ length: 12 }).map((_, i) => (
            <PosterCardSkeleton key={i} />
          ))}
        </div>
      )}

      {s.results.length > 0 && (
        <div className="relative animate-fade-scale-in">
          {s.searching && <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-20 rounded-2xl flex items-center justify-center"><p className="text-sm text-muted animate-pulse">{t("ui.searching")}</p></div>}
          <div className="mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4 max-w-7xl">
          {s.results.map((r, idx) => {
            const mapping = mappingsMap.get(`${r.media_type}:${r.id}`)
            const year = yearOf(r)
            const title = titleOf(r)
            return (
              <button
                type="button"
                key={`${r.media_type}:${r.id}`}
                onClick={() => navigateToPoster(r)}
                aria-label={`${title} (${year})`}
                className="surface-card group relative rounded-xl overflow-hidden transition-all duration-300 ease-out w-full border border-white/10 shadow-2xl hover:-translate-y-[3px] hover:scale-[1.015] hover:shadow-[0_22px_48px_rgba(0,0,0,0.48),0_0_22px_rgba(232,93,42,0.10)] hover:border-white/20 active:scale-[0.98] cursor-pointer animate-stagger-in text-left flex flex-col"
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                {/* NuvioDesktop-style depth edge */}
                <PosterDepthEdge edgeStrength={35} edgeCoverage={10} />
                <div className="relative z-[1] w-full flex-1 flex flex-col">
                  <div className="aspect-[2/3] bg-surface/80 overflow-hidden relative w-full">
                    {/* Immagine Poster */}
                    {r.poster_path ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB dynamic URL
                      <img
                        src={posterUrl(r.poster_path, "w342")}
                        alt={title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-[400ms] ease-out group-hover:scale-[1.06]"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-zinc-800/50 to-zinc-900/80 gap-2">
                        <svg className="w-8 h-8 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <polygon points="9.5 8 15.5 12 9.5 16 9.5 8" fill="currentColor" stroke="none"/>
                        </svg>
                        <span className="text-xl font-bold text-zinc-600">{title.charAt(0) || "?"}</span>
                      </div>
                    )}

                    {/* Badge tipo media (Film / Serie TV) in alto a sinistra */}
                    <div className="absolute top-2 left-2 z-10 pointer-events-none">
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-md border border-white/10 text-zinc-200 font-semibold shadow-md flex items-center gap-1">
                        {r.media_type === "movie" ? <Clapperboard className="w-3 h-3 text-amber-400" /> : <Tv className="w-3 h-3 text-sky-400" />}
                        <span>{r.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}</span>
                      </span>
                    </div>

                    {/* Badge se già personalizzato/salvato */}
                    {mapping && (
                      <div
                        className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent-orange text-white text-[10px] font-bold shadow-lg shadow-accent-orange/40 pointer-events-none"
                        title={t("ui.customPosterSet")}
                      >
                        <Check className="w-3 h-3 stroke-[2.5]" />
                      </div>
                    )}

                    {/* Overlay informativo al passaggio del mouse */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none flex flex-col justify-end p-3"
                      style={{
                        background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)",
                      }}
                    >
                      <p className="text-xs font-bold text-white truncate drop-shadow-md">{title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {year && <span className="text-xs text-zinc-300 font-medium">{year}</span>}
                        {r.vote_average != null && r.vote_average > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold flex items-center gap-1">
                            <Star className="w-2.5 h-2.5 fill-amber-300" />
                            {r.vote_average.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card info strip sottostante (sempre leggibile) */}
                  <div className="p-2.5 text-left bg-surface/50 border-t border-white/[0.04]">
                    <p className="text-xs font-semibold text-zinc-100 truncate group-hover:text-accent-orange transition-colors duration-200">
                      {title}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-muted mt-0.5">
                      <span>{year || "—"}</span>
                      <span className="capitalize text-zinc-400">{r.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
          </div>
          {s.searchPage < s.totalPages && (
            <div className="flex flex-col items-center justify-center mt-10 mb-4 gap-2">
              <button
                type="button"
                aria-label={t("ui.showMore")}
                disabled={loadingMore || s.searching}
                onClick={handleLoadMore}
                className="group relative inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl text-sm font-medium text-zinc-200 bg-surface/90 hover:bg-surface2/90 border border-white/[0.08] hover:border-accent-orange/40 shadow-lg shadow-black/25 hover:shadow-accent-orange/10 backdrop-blur-md transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer overflow-hidden"
              >
                {/* Subtle gradient hover highlight */}
                <div className="absolute inset-0 bg-gradient-to-r from-accent-orange/0 via-accent-orange/10 to-accent-orange/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 text-accent-orange animate-spin" />
                    <span>{t("ui.loading")}</span>
                  </>
                ) : (
                  <>
                    <span>{t("ui.showMore")}</span>
                    <ChevronDown className="w-4 h-4 text-accent-orange/80 group-hover:text-accent-orange group-hover:translate-y-0.5 transition-all duration-200" />
                  </>
                )}
              </button>

              {s.totalPages > 1 && (
                <span className="text-[11px] text-zinc-500 font-mono tracking-wider">
                  {s.searchPage} / {s.totalPages}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {!tmdbKey && (
        <div className="text-center py-16 animate-fade-scale-in">
          <div className="empty-state-illustration mb-4">
            <svg className="w-10 h-10 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" opacity="0.3"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" opacity="0.5"/>
            </svg>
          </div>
          <p className="text-muted text-sm font-medium mb-1.5">{t("ui.noKey")}</p>
          <p className="text-zinc-500 text-xs max-w-xs mx-auto leading-relaxed">{t("ui.noKeySub")}</p>
        </div>
      )}
      {s.error && (
        <div className="text-center py-12 animate-fade-scale-in">
          <div className="empty-state-illustration mb-4 border-red-900/40 bg-red-900/15">
            <svg className="w-10 h-10 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" opacity="0.4"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className="text-danger text-sm font-medium mb-1">{t("ui.searchError")}</p>
          <p className="text-zinc-500 text-xs mb-4 max-w-xs mx-auto leading-relaxed">{s.error}</p>
          <button type="button" onClick={() => { s.setError(null); s.doSearch(s.query) }} className="px-5 py-2 rounded-xl text-xs font-semibold bg-red-900/30 border border-red-800/40 text-red-300 hover:bg-red-900/50 hover:text-red-200 active:scale-95 transition-all duration-200 press-scale">{t("ui.retry")}</button>
        </div>
      )}
      {s.results.length === 0 && !s.searching && !showRecent && !s.error && s.query.length >= 2 && tmdbKey && (
        <div className="text-center py-16 animate-fade-scale-in">
          <div className="empty-state-illustration mb-4">
            <svg className="w-10 h-10 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" opacity="0.4"/>
              <path d="m21 21-4.3-4.3" opacity="0.4"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
              <line x1="11" y1="8" x2="11" y2="14"/>
            </svg>
          </div>
          <p className="text-muted text-sm mb-2">{t("ui.noResults")}</p>
          <p className="text-zinc-500 text-xs max-w-xs mx-auto leading-relaxed">{t("ui.noResultsForQuery")}</p>
        </div>
      )}
    </div>
  )
}