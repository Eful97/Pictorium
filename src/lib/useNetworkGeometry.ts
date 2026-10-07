"use client"

import { useEffect, useRef, useState } from "react"
import {
  buildNetGeoUrl,
  parseNetGeoResponse,
  type FrozenNetworkGeometry,
} from "@/lib/network-freeze"

/**
 * Shared network-geometry prefetch for the follow OFF gate.
 *
 * Fetches `debug=1&netgeo=1` on the exact preview URL being displayed (same
 * request the OFF switch freezes, no client-side layout recompute) while the
 * follow controls are visible and the network logo is on. URL changes are
 * debounced so slider drags never start a fetch per tick; the first URL
 * fetches immediately so the gate resolves on mount. Stale responses and
 * unmounts never write state (sequence guard + abort).
 *
 * The returned geometry is tied to the URL it was fetched for (`geometryUrl`):
 * while the live URL is dirty (changed but not yet fetched) or the hook is
 * disabled, geometry is null and loading is true/false respectively, so the
 * OFF switch never stays enabled on a stale box. Consumers must use the
 * returned geometry fresh (same render) and never cache it across URL changes.
 */
export function useNetworkGeometry(
  previewUrl: string,
  enabled: boolean,
  delayMs = 300,
): {
  geometry: FrozenNetworkGeometry | null
  geometryLoading: boolean
  geometryUrl: string
} {
  const [debouncedUrl, setDebouncedUrl] = useState(previewUrl)
  const [geometry, setGeometry] = useState<FrozenNetworkGeometry | null>(null)
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
    if (!enabled || !debouncedUrl) {
      return
    }
    const seq = ++seqRef.current
    const fetchedUrl = debouncedUrl
    const ctrl = new AbortController()
    setLoading(true)
    fetch(buildNetGeoUrl(fetchedUrl), { signal: ctrl.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: unknown) => {
        if (seq !== seqRef.current || ctrl.signal.aborted) return
        setGeometry(parseNetGeoResponse(json))
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

  // Fresh only: a geometry fetched for another URL (debounce lag) or while
  // disabled must never read as current. Dirty URL disables immediately,
  // before the debounced effect even runs.
  if (!enabled || !previewUrl) {
    return { geometry: null, geometryLoading: false, geometryUrl: "" }
  }
  const fresh = source === previewUrl
  return {
    geometry: fresh ? geometry : null,
    geometryLoading: fresh ? loading : true,
    geometryUrl: source,
  }
}
