"use client"

import { useEffect, useRef, useState } from "react"
import { userFetch } from "@/lib/http"
import type { BadgeTarget, HouseBadge } from "@/lib/badge-preset"

interface DraftPresetPreviewImgProps {
  target: BadgeTarget
  house: HouseBadge
  name: string
  className?: string
  /**
   * Fallback label shown while the server renders or when the draft cannot
   * render yet (empty live value). Never a stale saved thumbnail masquerading
   * as the draft: loading/error states are explicit placeholders.
   */
  fallbackLabel?: string
}

/**
 * Live draft preview for technical raster families (network/separateRatings/
 * customRatings): the browser cannot render brand artwork itself, so the
 * current UNSAVED house draft is POSTed to the bounded server draft-preview
 * route (same native renderers + deterministic fixtures as the poster — no
 * store reads/writes) and the returned SVG is shown via Blob URL. Debounced
 * so slider drags do not storm the renderer; each response revokes the
 * previous Blob URL.
 */
export function DraftPresetPreviewImg({ target, house, name, className, fallbackLabel }: DraftPresetPreviewImgProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const payload = JSON.stringify({ variant: "house" as const, target, house })

  useEffect(() => {
    setPending(true)
    setFailed(false)
    if (timer.current) clearTimeout(timer.current)
    let cancelled = false
    let url: string | null = null
    // The signal actually aborts the in-flight render when the draft changes
    // or unmounts (userFetch composes it with its timeout): no zombie renders
    // burning CPU after the thumbnail is already stale.
    const controller = new AbortController()
    // Debounce: one server render per settled edit, not per slider tick.
    timer.current = setTimeout(() => {
      userFetch("/api/presets/draft-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: JSON.parse(payload) }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`draft preview ${res.status}`)
          const blob = await res.blob()
          if (cancelled) return
          url = URL.createObjectURL(blob)
          setBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
          setPending(false)
        })
        .catch(() => {
          if (cancelled) return
          setFailed(true)
          setPending(false)
        })
    }, 300)
    return () => {
      cancelled = true
      // Abort the pending render (no-op once settled) and drop the timer so
      // a superseded edit never fires after a newer one took over.
      controller.abort()
      if (timer.current) clearTimeout(timer.current)
      if (url) URL.revokeObjectURL(url)
    }
    // Payload string is the debounce identity (stable per edit).
  }, [payload])

  if (failed) {
    return <div role="img" aria-label={name} title={name} className={className} data-preview-fallback="1">{fallbackLabel ?? ""}</div>
  }
  if (pending || !blobUrl) {
    return <div aria-hidden="true" className={className} data-preview-loading="1" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={blobUrl} alt={name} loading="lazy" className={className} />
}
