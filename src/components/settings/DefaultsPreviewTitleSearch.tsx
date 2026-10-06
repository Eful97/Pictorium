"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { SearchBar } from "@/components/SearchBar"
import { useT } from "@/lib/contexts/TranslationContext"
import { http } from "@/lib/http"
import { toSearchResult, type SearchResult } from "@/lib/types"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"

interface DefaultsPreviewTitleSearchProps {
  tmdbKey: string
  hasServerKey: boolean
  /** TMDB locale (e.g. "it-IT") for the /api/tmdb/search route. */
  language: string
  demoMedia: DefaultsPreviewDemoMedia | null
  onDemoMediaChange: (m: DefaultsPreviewDemoMedia | null) => void
}

interface SearchPayload {
  results?: Array<{
    id?: number | null
    media_type?: string
    title?: string | null
    name?: string | null
    poster_path?: string | null
    release_date?: string
    first_air_date?: string
    vote_average?: number
  }>
}

/**
 * Isolated title search for the defaults preview: local state only, never
 * touching global search / recents / mappings / defaults. Same contract and
 * cancellation as the global search (trailing 250ms debounce, revision +
 * AbortController), same `/api/tmdb/search` route with the explicit api_key
 * (the server applies the namespace/env fallback like the current search).
 */
export function DefaultsPreviewTitleSearch({
  tmdbKey,
  hasServerKey,
  language,
  demoMedia,
  onDemoMediaChange,
}: DefaultsPreviewTitleSearchProps) {
  const { t } = useT()
  const [text, setText] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const revRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drops any in-flight request: stale responses must never repopulate state.
  const invalidateFlight = useCallback(() => {
    revRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  // Auth/language switch: the pending request ran with stale credentials.
  useEffect(() => {
    invalidateFlight()
    setResults([])
    setSearching(false)
    setError(null)
    setHasSearched(false)
  }, [invalidateFlight, tmdbKey, hasServerKey, language])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      // Bump the revision so a late response cannot update unmounted state.
      revRef.current += 1
      abortRef.current?.abort()
    }
  }, [])

  const canSearch = !!tmdbKey || hasServerKey

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim().slice(0, 100)
    if (q.length < 2 || !canSearch) return
    const rev = ++revRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true)
    setError(null)
    try {
      const data = await http<SearchPayload>(
        `/api/tmdb/search?q=${encodeURIComponent(q)}&language=${encodeURIComponent(language)}&api_key=${encodeURIComponent(tmdbKey)}&page=1`,
        { timeout: 15000, signal: controller.signal },
      )
      if (rev !== revRef.current) return
      const list = (data.results || [])
        .map((r) => toSearchResult(r))
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 6)
      setResults(list)
    } catch {
      if (rev !== revRef.current) return
      if (controller.signal.aborted) return
      setResults([])
      setError(t("ui.searchError"))
    } finally {
      if (rev === revRef.current) {
        setSearching(false)
        setHasSearched(true)
      }
    }
  }, [canSearch, language, tmdbKey, t])

  const handleChange = useCallback((v: string) => {
    // Invalidate on EVERY keystroke before (re)arming the debounce: without
    // this a superseded response repopulates the list after clear (<2 chars).
    invalidateFlight()
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setText(v)
    if (v.trim().length < 2) {
      setResults([])
      setSearching(false)
      setError(null)
      setHasSearched(false)
      return
    }
    debounceRef.current = setTimeout(() => void runSearch(v), 250)
  }, [invalidateFlight, runSearch])

  const handleSubmit = useCallback((q: string) => {
    invalidateFlight()
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setText(q)
    void runSearch(q)
  }, [invalidateFlight, runSearch])

  const selectTitle = useCallback((r: SearchResult) => {
    // Abort without a new revision is not enough: bump it so the pending
    // finally cannot flip searching/hasSearched after the selection.
    invalidateFlight()
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setResults([])
    setSearching(false)
    setError(null)
    setHasSearched(false)
    onDemoMediaChange({
      mediaType: r.media_type,
      id: r.id,
      title: r.title || r.name || null,
    })
  }, [invalidateFlight, onDemoMediaChange])

  const handleReset = useCallback(() => {
    invalidateFlight()
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setResults([])
    setSearching(false)
    setError(null)
    setHasSearched(false)
    onDemoMediaChange(null)
  }, [invalidateFlight, onDemoMediaChange])

  const yearOf = (r: SearchResult) =>
    r.release_date?.slice(0, 4) || r.first_air_date?.slice(0, 4) || ""

  return (
    <div className="w-full mt-3" data-testid="defaults-preview-title-search">
      <p className="block text-[11px] font-semibold text-zinc-400 mb-1.5 px-1">
        {t("ui.defaultsPreviewSearchLabel")}
      </p>
      <SearchBar
        tmdbKey={tmdbKey}
        hasServerKey={hasServerKey}
        value={text}
        onChange={handleChange}
        onSearch={handleSubmit}
        error={error}
      />
      {!canSearch ? (
        <p className="text-[11px] text-zinc-500 mt-1.5 px-1">{t("ui.noKey")}</p>
      ) : null}
      {demoMedia?.title ? (
        <div className="flex items-center gap-2 mt-2 px-1">
          <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
            <span className="text-zinc-500">{t("ui.defaultsPreviewSelected")}: </span>
            <span className="font-semibold text-zinc-100">{demoMedia.title}</span>
            <span className="ml-1.5 font-mono text-[10px] text-zinc-500">
              {demoMedia.mediaType === "tv" ? "tv" : "movie"}:{demoMedia.id}
            </span>
          </p>
          <button
            type="button"
            onClick={handleReset}
            aria-label={t("ui.defaultsPreviewReset")}
            title={t("ui.defaultsPreviewReset")}
            className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-90 cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}
      {searching ? (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-2 px-1" role="status">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t("ui.searching")}</span>
        </p>
      ) : null}
      {!searching && error ? (
        <div className="flex items-center gap-2 mt-2 px-1" role="alert">
          <p className="flex-1 text-[11px] text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void runSearch(text)}
            className="px-2 py-1 text-[11px] font-semibold text-zinc-200 bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer"
          >
            {t("ui.retry")}
          </button>
        </div>
      ) : null}
      {!searching && !error && hasSearched && results.length === 0 && text.trim().length >= 2 ? (
        <p className="text-[11px] text-zinc-500 mt-2 px-1">{t("ui.noResults")}</p>
      ) : null}
      {!searching && !error && results.length > 0 ? (
        <ul className="mt-2 space-y-1 max-h-44 overflow-y-auto" role="listbox" aria-label={t("ui.defaultsPreviewSearchLabel")}>
          {results.map((r) => {
            const title = r.title || r.name || `#${r.id}`
            const year = yearOf(r)
            return (
              <li key={`${r.media_type}:${r.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={demoMedia?.id === r.id && demoMedia?.mediaType === r.media_type}
                  aria-label={`${title}${year ? ` (${year})` : ""}`}
                  onClick={() => selectTitle(r)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-left hover:bg-white/[0.06] active:bg-white/10 transition-colors cursor-pointer"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-100">{title}</span>
                  {year ? <span className="shrink-0 text-[10px] text-zinc-500 font-mono">{year}</span> : null}
                  <span className="shrink-0 text-[10px] font-semibold text-zinc-400 border border-white/10 rounded-md px-1.5 py-0.5">
                    {r.media_type === "tv" ? "TV" : t("ui.movie")}
                  </span>
                  {typeof r.vote_average === "number" && r.vote_average > 0 ? (
                    <span className="shrink-0 text-[10px] text-amber-300 font-semibold tabular-nums">
                      ★ {r.vote_average.toFixed(1)}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
