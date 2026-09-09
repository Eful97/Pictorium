"use client"

import { createContext, useContext, useMemo } from "react"
import type { PictoriumCtx } from "@/lib/context"
import type { SearchResult, FlixPatrolChart } from "@/lib/types"
import type { EnrichedAnimeItem } from "@/lib/validation"
import { STREAMING_PLATFORMS } from "@/lib/utils"

/**
 * SearchCtx — subset di PictoriumCtx per search + trending.
 */
export interface SearchCtx {
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  results: SearchResult[]
  searching: boolean
  error: string | null
  setError: (v: string | null) => void
  totalResults: number
  totalPages: number
  searchPage: number
  recentSearches: string[]
  removeRecentSearch: (search: string) => void
  clearRecentSearches: () => void
  doSearch: (q?: string, page?: number) => Promise<void>
  loadMore: () => Promise<void>
  trending: (SearchResult & { rank: number })[]
  streamingCharts: Record<string, FlixPatrolChart>
  mdblistAnimeList: EnrichedAnimeItem[]
  refreshLists: () => Promise<void>
  STREAMING_PLATFORMS: typeof STREAMING_PLATFORMS
}

const Ctx = createContext<SearchCtx | null>(null)

export function useSearchCtx() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSearchCtx must be inside PictoriumProvider")
  return v
}

export function SearchProvider({
  value,
  children,
}: {
  value: PictoriumCtx
  children: React.ReactNode
}) {
  const searchCtx = useMemo<SearchCtx>(
    () => ({
      query: value.query,
      setQuery: value.setQuery,
      results: value.results,
      searching: value.searching,
      error: value.error,
      setError: value.setError,
      totalResults: value.totalResults,
      totalPages: value.totalPages,
      searchPage: value.searchPage,
      recentSearches: value.recentSearches,
      removeRecentSearch: value.removeRecentSearch,
      clearRecentSearches: value.clearRecentSearches,
      doSearch: value.doSearch,
      loadMore: value.loadMore,
      trending: value.trending,
      streamingCharts: value.streamingCharts,
      mdblistAnimeList: value.mdblistAnimeList,
      refreshLists: value.refreshLists,
      STREAMING_PLATFORMS: value.STREAMING_PLATFORMS,
    }),
    [
      value.query, value.setQuery,
      value.results, value.searching, value.error, value.setError,
      value.totalResults, value.totalPages, value.searchPage,
      value.recentSearches, value.removeRecentSearch, value.clearRecentSearches,
      value.doSearch, value.loadMore,
      value.trending, value.streamingCharts, value.mdblistAnimeList,
      value.refreshLists, value.STREAMING_PLATFORMS,
    ],
  )

  return <Ctx.Provider value={searchCtx}>{children}</Ctx.Provider>
}
