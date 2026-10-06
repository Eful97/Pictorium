"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DefaultsPreviewDemoMedia } from "./poster-url"

/**
 * Local preference for the Settings defaults preview title (Avatar fallback
 * when absent). Browser-only, per-profile storage: namespaced per UUID on
 * `/u/<uuid>` paths (no leakage between profiles on the same browser),
 * global otherwise — same rule as `defaultsStorageKey` in useDefaults.
 * Never touches server defaults, mappings or global search; stores only
 * `{id, mediaType, title}` (no API keys). Safe when storage is unavailable.
 */

const GLOBAL_KEY = "previewDemoMedia"

export function previewDemoMediaStorageKey(userId: string | null | undefined): string {
  return userId ? `previewDemoMedia:${userId}` : GLOBAL_KEY
}

export function isValidPreviewDemoMedia(value: unknown): value is DefaultsPreviewDemoMedia {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  if (o.mediaType !== "movie" && o.mediaType !== "tv") return false
  if (typeof o.id !== "number" || !Number.isSafeInteger(o.id) || o.id <= 0) return false
  if (o.title !== undefined && o.title !== null && typeof o.title !== "string") return false
  return true
}

export function readPreviewDemoMedia(userId: string | null | undefined): DefaultsPreviewDemoMedia | null {
  // typeof check stays outside (never throws); every storage access,
  // including the localStorage getter itself (SecurityError under browser
  // privacy modes / sandboxed iframes), runs inside try.
  if (typeof window === "undefined") return null
  try {
    if (!window.localStorage) return null
    const raw = window.localStorage.getItem(previewDemoMediaStorageKey(userId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidPreviewDemoMedia(parsed)) return null
    return { id: parsed.id, mediaType: parsed.mediaType, title: parsed.title ?? null }
  } catch {
    return null
  }
}

export function writePreviewDemoMedia(
  userId: string | null | undefined,
  media: DefaultsPreviewDemoMedia | null,
): void {
  try {
    const key = previewDemoMediaStorageKey(userId)
    if (media === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(
        key,
        JSON.stringify({ id: media.id, mediaType: media.mediaType, title: media.title ?? null }),
      )
    }
  } catch {
    /* localStorage non disponibile */
  }
}

/**
 * Preview demo title with per-profile persistence. Reads once on mount and
 * re-reads when the profile changes while mounted; the hydration effect is
 * read-only (never writes back), so a stale value cannot leak into another
 * profile's slot. Selection persists synchronously under the calling profile.
 */
export function usePreviewDemoMedia(
  userId: string | null | undefined,
): [DefaultsPreviewDemoMedia | null, (m: DefaultsPreviewDemoMedia | null) => void] {
  const key = userId ?? null
  const [demoMedia, setDemoMedia] = useState<DefaultsPreviewDemoMedia | null>(() =>
    readPreviewDemoMedia(key),
  )
  useEffect(() => {
    setDemoMedia(readPreviewDemoMedia(key))
  }, [key])
  const userRef = useRef(key)
  userRef.current = key
  const change = useCallback((m: DefaultsPreviewDemoMedia | null) => {
    setDemoMedia(m)
    writePreviewDemoMedia(userRef.current, m)
  }, [])
  return [demoMedia, change]
}
