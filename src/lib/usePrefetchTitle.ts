import { useCallback, useRef } from "react"
import { http } from "./http"
import { contentLanguageForUiLang } from "./regions"
import type { SearchResult } from "./types"

/**
 * Prefetch hover sui risultati di ricerca: scalda le cache server
 * (details + images) così aprendo l'editor trova tutto già caldo.
 * Fire-and-forget con dedup per titolo; niente retry per non inseguire
 * un hover con richieste zombie. Estratto da context.tsx (move wholesale).
 */
export function usePrefetchTitle(opts: {
  tmdbKey: string
  serverHasTmdbKey: boolean
  lang: string
  defaultRegion: string
}): (item: SearchResult) => void {
  const { tmdbKey, serverHasTmdbKey, lang, defaultRegion } = opts
  const prefetchedRef = useRef<Set<string>>(new Set())
  return useCallback((item: SearchResult) => {
    const key = `${item.media_type}:${item.id}`
    if (prefetchedRef.current.has(key)) return
    if (prefetchedRef.current.size > 200) prefetchedRef.current.clear()
    prefetchedRef.current.add(key)
    const rLang = contentLanguageForUiLang(lang, defaultRegion)
    const langs = `${lang},en,null`
    // Senza chiave da nessuna parte evita prefetch destinati al 401.
    if (!tmdbKey && !serverHasTmdbKey) return
    http(`/api/tmdb/${item.id}/details?type=${item.media_type}&language=${rLang}&api_key=${tmdbKey}`, { timeout: 15000, retries: 0 }).catch(() => null)
    http(`/api/tmdb/${item.id}/images?type=${item.media_type}&languages=${langs}&api_key=${tmdbKey}`, { timeout: 15000, retries: 0 }).catch(() => null)
  }, [tmdbKey, serverHasTmdbKey, lang, defaultRegion])
}
