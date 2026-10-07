"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { t } from "@/lib/i18n"
import {
  buildNetGeoUrl,
  effectiveFrozenScale,
  isFreezeStale,
  parseNetGeoResponse,
  type FreezeSnapshot,
} from "@/lib/network-freeze"

/**
 * Network ON->OFF position freeze with anti-stale guards.
 *
 * - OFF: snapshot {title, shape, exact preview URL} + AbortController per
 *   request; on arrival the live title/shape/URL are re-checked and anything
 *   mismatched is discarded (no partial applies, no jumps on mid-flight
 *   title/settings changes). Prior offsets are kept in a per-shape stash for
 *   the way back ON.
 * - Null geometry (network not rendered) = stay ON with a warning, never a
 *   blind OFF. The UI also disables the switch without network/preview.
 * - Unmount aborts the pending request.
 */
export function useNetworkFreeze() {
  const [freezing, setFreezing] = useState(false)
  const busyRef = useRef(false)
  const seqRef = useRef(0)
  const ctrlRef = useRef<AbortController | null>(null)
  const stashRef = useRef(new Map<string, { x: number; y: number }>())

  useEffect(() => () => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
  }, [])

  const freezeOff = useCallback(async (input: {
    titleKey: string
    shape: "poster" | "landscape"
    previewUrl: string
    networkLogo: boolean
    currentScale: number
    currentOffsetX: number
    currentOffsetY: number
    /** Writes follow=false + effective scale + actual top/left (caller applies atomically). */
    applyFixed: (v: { follow: false; scale: number; offsetX: number; offsetY: number }) => void
    /** Re-reads the live title/shape/URL for the stale guard. */
    getLive: () => { titleKey: string; shape: string; previewUrl: string }
  }): Promise<boolean> => {
    if (busyRef.current) return false
    if (!input.networkLogo || !input.previewUrl) return false
    busyRef.current = true
    setFreezing(true)
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const seq = ++seqRef.current
    const snap: FreezeSnapshot = { titleKey: input.titleKey, shape: input.shape, url: input.previewUrl }
    // Prior relative offsets kept for the way back ON (same title+shape key).
    stashRef.current.set(`${input.titleKey}:${input.shape}`, { x: input.currentOffsetX, y: input.currentOffsetY })
    try {
      const res = await fetch(buildNetGeoUrl(input.previewUrl), { signal: ctrl.signal, cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const geo = parseNetGeoResponse(await res.json())
      if (seq !== seqRef.current || ctrl.signal.aborted) return false
      if (!geo) {
        void import("sonner").then(({ toast }) => toast.warning(t("ui.networkFreezeEmpty")))
        return false
      }
      const live = input.getLive()
      if (isFreezeStale(snap, { titleKey: live.titleKey, shape: live.shape, url: live.previewUrl })) return false
      input.applyFixed({
        follow: false,
        scale: effectiveFrozenScale(input.currentScale, geo.w, geo.nominalW),
        offsetX: Math.round(geo.left),
        offsetY: Math.round(geo.top),
      })
      return true
    } catch (error: unknown) {
      if (ctrl.signal.aborted) return false
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[network-freeze] ${message}`)
      void import("sonner").then(({ toast }) => toast.warning(t("ui.networkFreezeEmpty")))
      return false
    } finally {
      if (seq === seqRef.current) {
        busyRef.current = false
        setFreezing(false)
        if (ctrlRef.current === ctrl) ctrlRef.current = null
      }
    }
  }, [])

  const turnOn = useCallback((input: {
    titleKey: string
    shape: "poster" | "landscape"
    /** Neutral offsets on stash miss (shape default / global 0,0). */
    neutralX: number
    neutralY: number
    /** Writes follow=true + restored offsets (never reinterpreted fixed coords). */
    applyOn: (v: { follow: true; offsetX: number; offsetY: number }) => void
  }): void => {
    const stashed = stashRef.current.get(`${input.titleKey}:${input.shape}`)
    if (stashed) {
      input.applyOn({ follow: true, offsetX: stashed.x, offsetY: stashed.y })
    } else {
      input.applyOn({ follow: true, offsetX: input.neutralX, offsetY: input.neutralY })
    }
  }, [])

  return { freezing, freezeOff, turnOn }
}
