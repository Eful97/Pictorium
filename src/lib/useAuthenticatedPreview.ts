"use client"

import { useEffect, useState } from "react"
import { previewRequestHeaders } from "@/lib/user-token"

/**
 * Authenticated loading for RAW poster `<img>` URLs (preset / style
 * thumbnails).
 *
 * A plain `<img src>` cannot send request headers, so on a shared instance
 * (MULTI_USER / HOSTED_BY=elfhosted) the poster route saw those thumbnails as
 * anonymous previews: it downgraded them, dropped `demosamples`, and the demo
 * badges (e.g. the demo rank) disappeared. The Settings global preview already
 * solves this with an XHR carrying `previewRequestHeaders`
 * (`DefaultsPosterPreview`); this hook brings the same transport to the
 * thumbnail grids without changing the URL builder or the server route.
 *
 * - No credentials for that URL (`previewRequestHeaders` empty): the URL is
 *   returned untouched and `fetch` is never called.
 * - Credentials present: one `fetch` (shared per URL) → blob → object URL.
 * - Results are cached per URL in a bounded module cache (24 entries, LRU
 *   eviction revokes the evicted object URL); concurrent consumers of the same
 *   URL share one in-flight request.
 * - Unmount / URL change aborts the request when the last consumer leaves; a
 *   cached object URL stays valid (owned by the cache, revoked on eviction).
 * - Any failure falls back to the direct URL: never throws, never blank.
 *
 * `api_key` handling is intentionally out of scope (`useSecurePosterUrl`).
 */

const MAX_CACHED_PREVIEW_URLS = 24

/** url -> object URL, in LRU order (first key = oldest). */
const cache = new Map<string, string>()
/** url -> shared in-flight request. */
const inflight = new Map<string, Promise<string>>()
/** url -> mounted consumers (the last one leaving aborts the request). */
const consumers = new Map<string, number>()
/** url -> controller of the shared in-flight request. */
const controllers = new Map<string, AbortController>()

function cacheGet(url: string): string | null {
  const hit = cache.get(url)
  if (!hit) return null
  // LRU touch: a reused entry must not be the next eviction.
  cache.delete(url)
  cache.set(url, hit)
  return hit
}

function cacheSet(url: string, objectUrl: string) {
  cache.delete(url)
  cache.set(url, objectUrl)
  while (cache.size > MAX_CACHED_PREVIEW_URLS) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    const staleUrl = oldest.value
    const staleObjectUrl = cache.get(staleUrl)
    cache.delete(staleUrl)
    if (staleObjectUrl) URL.revokeObjectURL(staleObjectUrl)
  }
}

/** Test-only: the cache/in-flight state is module-level (process wide). */
export function __resetAuthenticatedPreviewCacheForTests() {
  for (const objectUrl of cache.values()) URL.revokeObjectURL(objectUrl)
  cache.clear()
  inflight.clear()
  consumers.clear()
  controllers.clear()
}

function requestPreview(url: string): Promise<string> {
  const shared = inflight.get(url)
  if (shared) return shared
  const ctrl = new AbortController()
  controllers.set(url, ctrl)
  const pending = fetch(url, {
    cache: "no-store",
    headers: previewRequestHeaders(url),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      cacheSet(url, objectUrl)
      return objectUrl
    })
    .catch((error: unknown) => {
      // Direct URL = what the page showed before: safe, never blank.
      console.warn("[pictorium] Authenticated preview fetch failed, using the direct URL", error)
      return url
    })
    .finally(() => {
      if (inflight.get(url) === pending) inflight.delete(url)
      if (controllers.get(url) === ctrl) controllers.delete(url)
    })
  inflight.set(url, pending)
  return pending
}

export function useAuthenticatedPreviewUrl(url: string | null | undefined): string | null {
  const target = url ?? null
  const [src, setSrc] = useState<string | null>(target)

  useEffect(() => {
    setSrc(target)
    if (!target) return
    // No credential for this URL: direct src, zero extra fetches.
    if (Object.keys(previewRequestHeaders(target)).length === 0) return
    const cached = cacheGet(target)
    if (cached) {
      setSrc(cached)
      return
    }
    let cancelled = false
    consumers.set(target, (consumers.get(target) ?? 0) + 1)
    void requestPreview(target).then((resolved) => {
      if (!cancelled) setSrc(resolved)
    })
    return () => {
      cancelled = true
      const left = (consumers.get(target) ?? 1) - 1
      if (left > 0) {
        consumers.set(target, left)
        return
      }
      consumers.delete(target)
      controllers.get(target)?.abort()
    }
  }, [target])

  return src
}
