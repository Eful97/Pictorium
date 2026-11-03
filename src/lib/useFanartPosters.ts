"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { TMDBImage } from "@/lib/types"
import { usePSelector } from "@/lib/context"
import { userFetch } from "@/lib/http"

export interface FanartTabMeta {
  readonly lang: string | null
  readonly likes: number
}

export type FanartTabStatus = "idle" | "loading" | "ready" | "empty" | "unavailable" | "not_configured"

export interface FanartTabData {
  readonly status: FanartTabStatus
  readonly posters: TMDBImage[]
  readonly meta: FanartTabMeta[]
  /** Additive artwork sections (landscape bases / logos / thumbs). */
  readonly sections: {
    readonly backgrounds: TMDBImage[]
    readonly thumbs: TMDBImage[]
    readonly logos: TMDBImage[]
    readonly clearart: TMDBImage[]
  }
  readonly reload: () => void
}

interface FanartApiPoster {
  url: string
  lang: string | null
  likes: number
}

/**
 * Poster verticali Fanart.tv per il titolo selezionato (tab "Fanart.tv").
 * Fetch lazy: parte solo con `enabled` (tab aperta), abort al cambio titolo.
 * La selezione riusa il percorso custom (customPosterUrl + fallback TMDB):
 * il render non interroga mai l'API Fanart.
 */
export function useFanartPosters(enabled: boolean): FanartTabData {
  const selected = usePSelector((v) => v.selected)
  const key = selected ? `${selected.media_type}:${selected.id}` : null

  const [status, setStatus] = useState<FanartTabStatus>("idle")
  const [posters, setPosters] = useState<TMDBImage[]>([])
  const [meta, setMeta] = useState<FanartTabMeta[]>([])
  const [sections, setSections] = useState<FanartTabData["sections"]>({
    backgrounds: [],
    thumbs: [],
    logos: [],
    clearart: [],
  })
  const abortRef = useRef<AbortController | null>(null)
  const keyRef = useRef<string | null>(null)
  keyRef.current = key

  const load = useCallback(async () => {
    const current = keyRef.current
    const sel = selected
    if (!sel || !current) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus("loading")
    try {
      const mediaType = sel.media_type === "tv" ? "tv" : "movie"
      const res = await userFetch(
        `/api/fanart/${sel.id}/images?type=${mediaType}`,
        { signal: ctrl.signal, timeout: 15000 },
      )
      const data = (await res.json().catch(() => null)) as
        | {
            posters?: FanartApiPoster[]
            sections?: {
              backgrounds?: FanartApiPoster[]
              thumbs?: FanartApiPoster[]
              logos?: FanartApiPoster[]
              clearart?: FanartApiPoster[]
            }
            code?: string
            error?: string
          }
        | null
      // Risposta tardiva di un titolo precedente: scarta.
      if (ctrl.signal.aborted || keyRef.current !== current) return
      if (res.status === 503 || data?.code === "fanart_not_configured") {
        setStatus("not_configured")
        return
      }
      if (!res.ok || !data || !Array.isArray(data.posters)) {
        setStatus("unavailable")
        return
      }
      const toImages = (arr: FanartApiPoster[] | undefined): TMDBImage[] =>
        (Array.isArray(arr) ? arr : [])
          .filter((p) => typeof p?.url === "string")
          .map((p) => ({
            file_path: p.url,
            iso_639_1: null,
            vote_average: 0,
            width: 0,
            height: 0,
          }))
      const items = (data.posters ?? []).filter((p) => typeof p?.url === "string")
      const nextSections = {
        backgrounds: toImages(data.sections?.backgrounds),
        thumbs: toImages(data.sections?.thumbs),
        logos: toImages(data.sections?.logos),
        clearart: toImages(data.sections?.clearart),
      }
      setPosters(items.map((p) => ({
        file_path: p.url,
        iso_639_1: null,
        vote_average: 0,
        width: 0,
        height: 0,
      })))
      setMeta(items.map((p) => ({ lang: p.lang ?? null, likes: p.likes ?? 0 })))
      setSections(nextSections)
      const hasAny = items.length > 0 ||
        nextSections.backgrounds.length > 0 ||
        nextSections.thumbs.length > 0 ||
        nextSections.logos.length > 0 ||
        nextSections.clearart.length > 0
      setStatus(hasAny ? "ready" : "empty")
    } catch {
      if (ctrl.signal.aborted || keyRef.current !== current) return
      setStatus("unavailable")
    }
  }, [selected])

  // Cambio titolo: cancella la richiesta precedente e resetta.
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("idle")
    setPosters([])
    setMeta([])
    setSections({ backgrounds: [], thumbs: [], logos: [], clearart: [] })
  }, [key])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (enabled && selected && status === "idle") void load()
  }, [enabled, selected, status, load])

  return { status, posters, meta, sections, reload: load }
}
