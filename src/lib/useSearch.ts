"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { http } from "./http"
import { t } from "./i18n"
import type { SearchResult } from "./types"
import { toast } from "sonner"

function readRecentSearches(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return []
  try {
    const raw = JSON.parse(window.localStorage.getItem("recent_searches") || "[]")
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[search] Failed to read recent searches: ${message}`)
    return []
  }
}

function writeRecentSearches(searches: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    window.localStorage.setItem("recent_searches", JSON.stringify(searches))
  } catch {
    // localStorage non disponibile
  }
}

export function useSearch(tmdbKey: string, lang: string, hasServerKey = false) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalResults, setTotalResults] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches)
  // Identità della ricerca che ha prodotto i risultati correnti (query
  // normalizzata + lingua): loadMore/loadMoreFiltered la riusano invece del
  // testo live del campo, che può già contenere un'altra digitazione.
  const activeRef = useRef<{ query: string; lang: string } | null>(null)
  // Ultima richiesta fallita (query + pagina): il retry la ripete senza
  // azzerare i risultati con una nuova pagina 1.
  const failedRef = useRef<{ query: string; lang: string; page: number } | null>(null)
  const [failedPage, setFailedPage] = useState<number | null>(null)
  // Una ricerca pagina-1 è stata completata (successo o errore): solo allora
  // la UI può mostrare "nessun risultato" invece del campo iniziale.
  const [hasSearched, setHasSearched] = useState(false)

  // Revision counter per scartare risposte stale
  const revRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    writeRecentSearches(recentSearches)
  }, [recentSearches])

  const doSearch = useCallback(async (q?: string, page = 1, opts?: { silent?: boolean; language?: string }): Promise<SearchResult[]> => {
    const searchQuery = (q ?? query).trim().slice(0, 100)
    const language = opts?.language ?? lang
    // Senza chiave browser si prova comunque se il server ne ha una d'istanza
    // (fallback env in resolveRequestApiKey): a vuoto risponde 401 e si torna [].
    // Query vuota/corta (anche soli spazi): nessun fetch, nessun recente.
    if (searchQuery.length < 2 || (!tmdbKey && !hasServerKey)) return []
    const rev = ++revRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (!opts?.silent) setSearching(true)
    setError(null)
    if (page === 1) {
      setSearchPage(1)
      activeRef.current = null
      setTotalPages(0)
      failedRef.current = null
      setFailedPage(null)
    }
    try {
      const data = await http<{ results: SearchResult[]; total_results: number; total_pages: number }>(
        `/api/tmdb/search?q=${encodeURIComponent(searchQuery)}&language=${encodeURIComponent(language)}&api_key=${encodeURIComponent(tmdbKey)}&page=${page}`,
        { timeout: 15000, signal: controller.signal }
      )
      if (rev !== revRef.current) return []
      const newResults = data.results || []
      if (page === 1) {
        activeRef.current = { query: searchQuery, lang: language }
      } else if (!activeRef.current) {
        activeRef.current = { query: searchQuery, lang: language }
      }
      setResults(page === 1 ? newResults : (prev) => [...prev, ...newResults])
      setTotalResults(data.total_results || 0)
      setTotalPages(Math.min(data.total_pages || 0, 500))
      if (page > 1) setSearchPage(page)
      if (page === 1) {
        setSearchPage(1)
        setRecentSearches((prev) => [searchQuery, ...prev.filter((s) => s !== searchQuery)].slice(0, 5))
      }
      if (failedRef.current && failedRef.current.query === searchQuery && failedRef.current.page === page) {
        failedRef.current = null
        setFailedPage(null)
      }
      return newResults
    } catch (e) {
      if (rev !== revRef.current) return []
      if (controller.signal.aborted) return []
      console.error("[pictorium] Search failed:", e)
      failedRef.current = { query: searchQuery, lang: language, page }
      setFailedPage(page)
      // Le pagine silent (ciclo filtrato) registrano solo il fallimento per
      // il retry mirato: niente toast né errore globale che lampeggia.
      if (!opts?.silent) {
        toast.error(t("ui.searchError"))
        setError(t("ui.searchError"))
      }
      if (page === 1) setResults([])
      return []
    } finally {
      if (!opts?.silent && rev === revRef.current) setSearching(false)
      if (page === 1 && rev === revRef.current) setHasSearched(true)
    }
  }, [query, tmdbKey, lang, hasServerKey])

  const loadMoreRef = useRef(false)
  const loadMore = useCallback(async () => {
    if (searching || searchPage >= totalPages || loadMoreRef.current) return
    const active = activeRef.current
    if (!active) return
    loadMoreRef.current = true
    try {
      await doSearch(active.query, searchPage + 1, { language: active.lang })
    } finally {
      loadMoreRef.current = false
    }
  }, [searchPage, totalPages, searching, doSearch])

  /**
   * "Carica altri" con filtro tipo attivo: una pagina mista da 20 aggiunge
   * pochi match visibili, così si prosegue finché non se ne accumulano
   * `targetNew` (o pagine esaurite / maxPages per click). Ritorna i match aggiunti.
   * Silent (niente overlay lampeggiante: lo spinner del bottone copre l'attesa).
   * Avanza solo dopo una pagina riuscita (anche vuota di match): dopo un
   * errore si ferma sulla stessa pagina e il retry la ripete.
   */
  const loadMoreFiltered = useCallback(async (
    mediaType: "movie" | "tv",
    targetNew = 10,
    maxPages = 3,
  ): Promise<number> => {
    if (searching || searchPage >= totalPages || loadMoreRef.current) return 0
    const active = activeRef.current
    if (!active) return 0
    loadMoreRef.current = true
    const matches = (list: SearchResult[]): number =>
      list.filter((r) => (mediaType === "movie" ? r.media_type === "movie" : r.media_type !== "movie")).length
    let page = searchPage
    let added = 0
    try {
      for (let i = 0; i < maxPages && added < targetNew && page < totalPages; i++) {
        const revBefore = revRef.current
        const batch = await doSearch(active.query, page + 1, { silent: true, language: active.lang })
        // Nuova ricerca nel frattempo (altro submit): stop, i suoi risultati
        // hanno già sostituito la lista (ogni doSearch avanza rev di uno).
        if (revRef.current !== revBefore + 1) break
        // Errore su questa pagina: stop senza avanzare né cancellare
        // l'errore; il retry ripartirà dalla stessa pagina.
        if (failedRef.current && failedRef.current.query === active.query && failedRef.current.page === page + 1) break
        page += 1
        added += matches(batch)
      }
      return added
    } finally {
      loadMoreRef.current = false
    }
  }, [searchPage, totalPages, searching, doSearch])

  /** Ripete l'ultima richiesta fallita (stessa query e pagina), senza
   *  azzerare i risultati già caricati con una nuova pagina 1. */
  const retryFailed = useCallback(async (): Promise<void> => {
    const failed = failedRef.current
    if (!failed || searching || loadMoreRef.current) return
    loadMoreRef.current = true
    try {
      await doSearch(failed.query, failed.page, { language: failed.lang })
    } finally {
      loadMoreRef.current = false
    }
  }, [searching, doSearch])

  const removeRecentSearch = useCallback((search: string) => {
    setRecentSearches((prev) => prev.filter((s) => s !== search))
  }, [])

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
  }, [])

  return {
    query,
    setQuery,
    results,
    setResults,
    searching,
    error,
    setError,
    totalResults,
    totalPages,
    searchPage,
    recentSearches,
    doSearch,
    loadMore,
    loadMoreFiltered,
    retryFailed,
    failedPage,
    hasSearched,
    removeRecentSearch,
    clearRecentSearches,
  }
}
