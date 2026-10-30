"use client"

import { useEffect, useRef, useState } from "react"
import { buildNetGeoUrl } from "@/lib/network-freeze"
import { parseBadgeDragGeometry, type BadgeDragGeometry } from "@/lib/badge-drag-geometry"

/**
 * In-flight coalescing: the enlarged preview and the per-item numeric controls
 * ask for the SAME diagnostic URL at the same time. One debug render answers
 * both (the promise is dropped as soon as it settles, so a later edit always
 * refetches — never a stale box). Keyed by the exact URL.
 */
const inflight = new Map<string, Promise<unknown>>()

/**
 * Geometry URL: the exact preview URL being displayed plus `debug=1&netgeo=1`
 * and the ADDITIVE `ghosts=1` diagnostic flag. The flag only makes the report
 * publish the EMPTY tunable places (box-only entries): the quality HOMES and
 * the rating SLOTS this render does not paint. The editor draws them as
 * draggable dashed ghosts so a home/slot can be arranged before the preview
 * title paints that content. It never changes which badges exist nor a pixel.
 */
function badgeGeometryUrl(previewUrl: string): string {
  const base = buildNetGeoUrl(previewUrl)
  if (!base) return ""
  if (/[?&]ghosts=1(?:&|$)/.test(base)) return base
  return `${base}${base.includes("?") ? "&" : "?"}ghosts=1`
}

function fetchGeometryJson(url: string): Promise<unknown> {
  const existing = inflight.get(url)
  if (existing) return existing
  const next = fetch(url, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<unknown>
  })
  inflight.set(url, next)
  const clear = () => {
    if (inflight.get(url) === next) inflight.delete(url)
  }
  next.then(clear, clear)
  return next
}

/**
 * Preview params that only MOVE or RESIZE elements the renderer already
 * composed (group/item geometry) plus the diagnostics themselves. Editing one
 * changes the preview URL — and therefore invalidates the rendered hitboxes —
 * but never changes WHICH badges exist.
 */
const NON_SEMANTIC_PREVIEW_PARAMS = new Set([
  "tscale",
  "tox",
  "toy",
  "exscale",
  "exox",
  "exoy",
  "gscale",
  "gox",
  "goy",
  "qscale",
  "qox",
  "qoy",
  "sepscale",
  "sepox",
  "sepoy",
  "netscale",
  "nox",
  "noy",
  "bit",
  "debug",
  "netgeo",
])

/**
 * SEMANTIC identity of a preview URL: everything that can change which badges
 * the renderer composes (title, shape, layout, family scope, present providers,
 * styles) with the transform-only params stripped and the remaining ones
 * sorted (param order is a transport detail).
 *
 * Used to decide whether an item list that the server already reported is
 * still applicable to the requested render: a transform-only edit keeps the
 * same key (the rows stay mounted, no refetch flicker), while any semantic
 * change yields a new key so the previous rows are dropped instead of lingering
 * as phantom badges. Unknown params count as semantic on purpose: a future
 * param invalidates the list rather than silently reusing it.
 */
export function badgeGeometrySourceKey(previewUrl: string): string {
  const trimmed = previewUrl.trim()
  if (!trimmed) return ""
  const queryAt = trimmed.indexOf("?")
  if (queryAt < 0) return trimmed
  const kept: string[] = []
  for (const [key, value] of new URLSearchParams(trimmed.slice(queryAt + 1))) {
    if (NON_SEMANTIC_PREVIEW_PARAMS.has(key)) continue
    kept.push(`${key}=${value}`)
  }
  kept.sort()
  return `${trimmed.slice(0, queryAt)}?${kept.join("&")}`
}

/**
 * Authoritative badge geometry for the drag overlay.
 *
 * Same request as the network freeze (`debug=1&netgeo=1` on the exact preview
 * URL being displayed): the server renders the poster and returns the boxes it
 * actually composed, so the client never guesses anchors or sizes. URL changes
 * are debounced (slider drags never start a fetch per tick) and every response
 * is tied to the URL it was fetched for: while the live URL is dirty the
 * geometry is null, so stale boxes are never offered as handles.
 */
export function useBadgeDragGeometry(
  previewUrl: string,
  enabled: boolean,
  delayMs = 300,
): {
  geometry: BadgeDragGeometry | null
  loading: boolean
  /** URL the current geometry belongs to ("" = none). */
  geometryUrl: string
} {
  const [debouncedUrl, setDebouncedUrl] = useState(previewUrl)
  const [geometry, setGeometry] = useState<BadgeDragGeometry | null>(null)
  const [source, setSource] = useState("")
  const [loading, setLoading] = useState(false)
  const firstRef = useRef(true)
  const seqRef = useRef(0)

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false
      setDebouncedUrl(previewUrl)
      return
    }
    const timer = setTimeout(() => setDebouncedUrl(previewUrl), delayMs)
    return () => clearTimeout(timer)
  }, [previewUrl, delayMs])

  useEffect(() => {
    if (!enabled || !debouncedUrl) return
    const seq = ++seqRef.current
    const fetchedUrl = debouncedUrl
    const ctrl = new AbortController()
    setLoading(true)
    fetchGeometryJson(badgeGeometryUrl(fetchedUrl))
      .then((json: unknown) => {
        if (seq !== seqRef.current || ctrl.signal.aborted) return
        setGeometry(parseBadgeDragGeometry(json))
        setSource(fetchedUrl)
      })
      .catch(() => {
        if (seq !== seqRef.current || ctrl.signal.aborted) return
        setGeometry(null)
        setSource(fetchedUrl)
      })
      .finally(() => {
        if (seq !== seqRef.current || ctrl.signal.aborted) return
        setLoading(false)
      })
    return () => {
      ctrl.abort()
    }
  }, [debouncedUrl, enabled])

  if (!enabled || !previewUrl) {
    return { geometry: null, loading: false, geometryUrl: "" }
  }
  const fresh = source === previewUrl
  return {
    geometry: fresh ? geometry : null,
    loading: fresh ? loading : true,
    geometryUrl: source,
  }
}
