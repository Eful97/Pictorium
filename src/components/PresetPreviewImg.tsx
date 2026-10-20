"use client"

import { useEffect, useState } from "react"
import { userFetch } from "@/lib/http"

interface PresetPreviewImgProps {
  id: string
  name: string
  visibility: "public" | "private"
  /** Namespace corrente: serve solo ai privati (richiesta autenticata). */
  userUuid?: string | null
  /**
   * Revisione del preset: entra nell'URL (cache-buster) e nelle dipendenze
   * dell'effetto, così dopo un aggiornamento la miniatura viene ricaricata
   * (con revoca del Blob precedente) invece di restare stantia. Vale anche
   * per le pubbliche (invalidazione cache browser/CDN).
   */
  revision?: string | null
  className?: string
}

/**
 * Miniatura del preset. Gli `<img>` non possono inviare header di
 * autenticazione, quindi i privati viaggiano via fetch autenticato
 * (namespace + token automatici) con URL Blob e revoca alla pulizia; i
 * pubblici restano `<img>` diretti (cachabili). In errore mostra un
 * segnaposto accessibile, mai un'icona rotta.
 */
export function PresetPreviewImg({ id, name, visibility, userUuid, revision, className }: PresetPreviewImgProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const params = new URLSearchParams()
  if (userUuid) params.set("u", userUuid)
  if (revision) params.set("rev", revision)
  const query = params.toString()
  const src = `/api/presets/${encodeURIComponent(id)}/preview.svg${query ? `?${query}` : ""}`
  const useBlob = visibility === "private" && !!userUuid

  useEffect(() => {
    if (!useBlob) return
    let cancelled = false
    let url: string | null = null
    setBlobUrl(null)
    setFailed(false)
    userFetch(src)
      .then(async (res) => {
        if (!res.ok) throw new Error(`preview ${res.status}`)
        const blob = await res.blob()
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [src, useBlob])

  if (!useBlob) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} loading="lazy" className={className} />
  }
  if (failed) {
    return <div role="img" aria-label={name} title={name} className={className} data-preview-fallback="1" />
  }
  if (!blobUrl) {
    return <div aria-hidden="true" className={className} data-preview-loading="1" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={blobUrl} alt={name} className={className} />
}
