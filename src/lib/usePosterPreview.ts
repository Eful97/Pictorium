import { useState, useRef, useEffect, useCallback } from "react"
import { usePSelector } from "@/lib/context"
import { t } from "@/lib/i18n"
import { toast } from "sonner"
import { ACCENT_META_HEADER, parseEffectiveAccentHeader, type EffectiveAccentMeta } from "@/lib/effective-accent"
import { publishEffectiveAccentDisplay } from "@/lib/effective-accent-display"

/**
 * H1: bounded in-memory preview cache. Every debounced slider tick rebuilds
 * an identical preview URL, and without a cache each one is a full cold
 * server render (no-store previews never touch the browser HTTP cache).
 * Identical URL (+identical rank/catalog/retry nonces) within TTL serves the
 * cached bytes with no request; an expired entry revalidates with
 * If-None-Match so an unchanged render answers 304 instead of re-rendering.
 *
 * Client memory only (never shared, never persisted): server Cache-Control
 * semantics — including the downgraded-anonymous no-store path and the
 * Stremio path — are untouched (no server file changed). Nonce-bumped
 * refetches (rank-source save, catalog sync, manual retry) get fresh cache
 * keys, so new server-side content is never masked by stale bytes.
 */
interface CachedPreview {
  blob: Blob
  etag: string | null
  meta: EffectiveAccentMeta | null
  /** ready (vs unknown) when the cached response carried valid accent metadata */
  metaReady: boolean
  expiresAt: number
}

const PREVIEW_CACHE_MAX = 32
const PREVIEW_CACHE_TTL_MS = 45_000
const previewMemoryCache = new Map<string, CachedPreview>()

function previewCacheKey(url: string, rankNonce: unknown, catalogNonce: unknown, retryNonce: number): string {
  return `${url}\n${String(rankNonce)}.${String(catalogNonce)}.${retryNonce}`
}

function prunePreviewCache(now: number): void {
  for (const [k, v] of previewMemoryCache) {
    if (v.expiresAt <= now) previewMemoryCache.delete(k)
  }
  while (previewMemoryCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewMemoryCache.keys().next()
    if (oldest.done) break
    previewMemoryCache.delete(oldest.value)
  }
}

/** Test-only isolation for the module-level H1 cache (unit suites reuse URLs). */
export function __clearPreviewMemoryCacheForTests(): void {
  previewMemoryCache.clear()
}

export function usePosterPreview() {
  // B2: selettore slice — prima useP() ri-renderizzava il hook (e chi lo usa)
  // a OGNI aggiornamento del context Pictorium, non solo al cambio previewUrl.
  const previewUrl = usePSelector((v) => v.previewUrl)
  // Rank-source save bump: la preview va rifetchata anche a URL identico
  // (la selezione vive server-side e non entra nell'URL); le risposte
  // preview sono no-store, quindi il reload rilegge sempre il render nuovo.
  const rankSourceNonce = usePSelector((v) => v.rankSourceNonce)
  const catalogsSyncNonce = usePSelector((v) => v.catalogsSyncNonce)

  const [imageError, setImageError] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [imgSrc, setImgSrc] = useState("")
  // Bump per far ripartire la fetch: il Retry del preview non può dipendere
  // solo da previewUrl (invariato dopo un errore), serve un nonce.
  const [retryNonce, setRetryNonce] = useState(0)
  
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const loadDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevObjUrlRef = useRef("")
  // Effective-accent display sync (header transport): monotonic generation so
  // a superseded XHR whose onload fires late (e.g. manually after abort())
  // can never publish over the latest image + metadata pair.
  const accentGenerationRef = useRef(0)
  // D6: throttle del progress — gli eventi onprogress di XHR arrivano a decine
  // al secondo; setLoadProgress a ogni evento ri-renderizza la preview senza
  // beneficio visivo. Aggiorna solo a step ≥5% (il 100% arriva in onload).
  const lastProgressRef = useRef(-1)

  useEffect(() => {
    setImageError(false)
    setLoadProgress(0)
    lastProgressRef.current = 0
    if (!previewUrl) {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
      setImgSrc("")
      setPreviewLoading(false)
      // No preview displayed: drop any previous record (never show a stale
      // hex for the next title before its own load publishes).
      const generation = accentGenerationRef.current + 1
      accentGenerationRef.current = generation
      publishEffectiveAccentDisplay({ status: "unknown", meta: null, previewUrl: "", generation })
      return
    }

    // Keep old img visible while new one loads — no flicker
    const url = previewUrl
    // H1: identical URL within TTL serves cached bytes with no request at
    // all (same generation plumbing as a fresh load, so the accent picker
    // can never claim a stale hex).
    const cacheKey = previewCacheKey(url, rankSourceNonce, catalogsSyncNonce, retryNonce)
    const now = Date.now()
    const cached = previewMemoryCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      // LRU refresh without unbounded growth.
      previewMemoryCache.delete(cacheKey)
      previewMemoryCache.set(cacheKey, cached)
      const generation = accentGenerationRef.current + 1
      accentGenerationRef.current = generation
      publishEffectiveAccentDisplay({ status: "loading", meta: null, previewUrl: url, generation })
      const objUrl = URL.createObjectURL(cached.blob)
      if (prevObjUrlRef.current) URL.revokeObjectURL(prevObjUrlRef.current)
      prevObjUrlRef.current = objUrl
      setImgSrc(objUrl)
      setLoadProgress(100)
      setPreviewLoading(false)
      publishEffectiveAccentDisplay({
        status: cached.metaReady ? "ready" : "unknown",
        meta: cached.meta,
        previewUrl: url,
        generation,
      })
      return
    }
    const staleEntry = cached ?? null
    if (staleEntry) previewMemoryCache.delete(cacheKey)
    // New load (URL/shape change or rank-source/catalog/retry nonce refetch
    // at the SAME url): publish loading FIRST so the accent picker can never
    // claim a stale hex as the new preview. The old object URL stays valid
    // on screen (crossfade) until THIS generation succeeds.
    const generation = accentGenerationRef.current + 1
    accentGenerationRef.current = generation
    publishEffectiveAccentDisplay({ status: "loading", meta: null, previewUrl: url, generation })
    // Show loading bar only if the network request takes >200ms. Armed ONLY on
    // this path: a cache hit returns above, so no timer can outlive the effect
    // (it would fire after unmount, or paint a spinner over cached bytes).
    loadDelayRef.current = setTimeout(() => setPreviewLoading(true), 200)
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open("GET", url, true)
    xhr.responseType = "blob"
    // H1: expired entry with a known ETag revalidates instead of cold-loading.
    if (staleEntry?.etag) {
      try {
        xhr.setRequestHeader("If-None-Match", staleEntry.etag)
      } catch {
        /* non-critical: falls back to a full load */
      }
    }
    // Senza timeout la barra percentuale resta ferma per sempre su render
    // appeso (Bugonia): peggio dei casi server = slot-wait 15s + watchdog 30s,
    // quindi 45s lascia arrivare il 503 del server prima di dichiarare errore.
    xhr.timeout = 45000
    
    xhr.onprogress = (e) => {
      // Eligibility first: a superseded XHR must never move the new progress.
      if (xhrRef.current !== xhr || accentGenerationRef.current !== generation) return
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        if (lastProgressRef.current < 0 || pct - lastProgressRef.current >= 5 || pct >= 100) {
          lastProgressRef.current = pct
          setLoadProgress(pct)
        }
      }
    }
    
    xhr.onload = () => {
      // Generation guard FIRST: a superseded XHR (aborted by a newer load,
      // then firing onload late) must not clear the NEW spinner timer, touch
      // image state, or publish bytes/metadata.
      if (xhrRef.current !== xhr || accentGenerationRef.current !== generation) return
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      if (xhr.status === 200) {
        const blob = xhr.response as Blob
        const objUrl = URL.createObjectURL(blob)
        if (prevObjUrlRef.current) URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = objUrl
        setImgSrc(objUrl)
        setLoadProgress(100)
        setPreviewLoading(false)
        // Primary accent transport: validated metadata parsed from the SAME
        // response that carried these bytes. Absent/malformed (legacy cache,
        // stripped CDN header) → honest unknown, never a guessed color; the
        // manual chooser stays available and nothing is re-rendered.
        let meta: ReturnType<typeof parseEffectiveAccentHeader> = null
        try {
          meta = parseEffectiveAccentHeader(xhr.getResponseHeader(ACCENT_META_HEADER))
        } catch {
          meta = null
        }
        let etag: string | null = null
        try {
          etag = xhr.getResponseHeader("ETag")
        } catch {
          etag = null
        }
        if (blob) {
          prunePreviewCache(Date.now())
          previewMemoryCache.set(cacheKey, {
            blob,
            etag,
            meta,
            metaReady: meta !== null,
            expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
          })
        }
        publishEffectiveAccentDisplay({
          status: meta ? "ready" : "unknown",
          meta,
          previewUrl: url,
          generation,
        })
      } else if (xhr.status === 304 && staleEntry) {
        // H1: unchanged render — reuse the expired entry's bytes and refresh
        // its TTL. Same display path as a fresh load.
        prunePreviewCache(Date.now())
        const refreshed: CachedPreview = { ...staleEntry, expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS }
        previewMemoryCache.set(cacheKey, refreshed)
        const objUrl = URL.createObjectURL(refreshed.blob)
        if (prevObjUrlRef.current) URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = objUrl
        setImgSrc(objUrl)
        setLoadProgress(100)
        setPreviewLoading(false)
        publishEffectiveAccentDisplay({
          status: refreshed.metaReady ? "ready" : "unknown",
          meta: refreshed.meta,
          previewUrl: url,
          generation,
        })
      } else {
        setImageError(true)
        setPreviewLoading(false)
        publishEffectiveAccentDisplay({ status: "unknown", meta: null, previewUrl: url, generation })
      }
    }

    xhr.onerror = () => {
      // Eligibility first: a stale error must set no error state, clear no
      // timer, publish nothing and toast nothing on the new generation.
      if (xhrRef.current !== xhr || accentGenerationRef.current !== generation) return
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      setImageError(true)
      setPreviewLoading(false)
      publishEffectiveAccentDisplay({ status: "unknown", meta: null, previewUrl: url, generation })
      toast.error(t("ui.posterLoadError"))
    }

    xhr.ontimeout = () => {
      // Eligibility first: same as onerror — a stale timeout is fully ignored.
      if (xhrRef.current !== xhr || accentGenerationRef.current !== generation) return
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      setImageError(true)
      setPreviewLoading(false)
      publishEffectiveAccentDisplay({ status: "unknown", meta: null, previewUrl: url, generation })
      toast.error(t("ui.posterLoadError"))
    }
    
    xhr.send()
    
    return () => {
      // Invalidate BEFORE abort: abort() may synchronously re-enter
      // xhr.onerror while this XHR is still registered as current, which
      // would poison the next generation (error state + toast + cleared
      // timer). No record is published here — the next effect owns it.
      xhrRef.current = null
      xhr.abort()
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
    }
  }, [previewUrl, retryNonce, rankSourceNonce, catalogsSyncNonce])

  // Rifà la fetch della preview corrente (usato dal pulsante Retry dopo un errore).
  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1)
  }, [])

  // Revoca l'object URL residuo SOLO allo smontaggio. La cleanup dell'effetto
  // sopra non può revocare: durante il caricamento della nuova preview l'immagine
  // vecchia deve restare valida (no-flicker).
  useEffect(() => {
    return () => {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
    }
  }, [])

  return {
    imageError,
    setImageError,
    previewLoading,
    loadProgress,
    imgSrc,
    retry,
  }
}
