"use client"

// Rilevamento dei colori accent/edge dal poster selezionato (analisi pixel via
// canvas sul client). Estratto da context.tsx: l'effetto è autosufficiente e
// dipende solo dal poster attivo; aggiorna le CSS custom properties su <html>
// e i due stati accentColor/topEdgeColor del contesto.

import { useEffect } from "react"
import type { TMDBImage } from "./types"
import { isCustomPosterUrl } from "./utils"
import { findSceneTint, topEdgeAverage, bottomEdgeAverage } from "./accent-color"

function parseHexColor(value: unknown): { r: number; g: number; b: number } | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }
}
interface RootColorsSetters {
  setAccentColor: (v: string | null) => void
  setAutoAccentColor?: (v: string | null) => void
  setTopEdgeColor: (v: string | null) => void
  setBottomEdgeColor?: (v: string | null) => void
}

export function useRootColors(
  previewPoster: TMDBImage | null,
  genreName: string | undefined,
  posterUrl: (path: string, size?: string) => string,
  { setAccentColor, setAutoAccentColor, setTopEdgeColor, setBottomEdgeColor }: RootColorsSetters,
  size = "w342",
): void {
  useEffect(() => {
    const root = document.documentElement
    if (!previewPoster) {
      root.style.setProperty("--color-accent", "#555555")
      root.style.setProperty("--color-accent-r", "85")
      root.style.setProperty("--color-accent-g", "85")
      root.style.setProperty("--color-accent-b", "85")
      root.style.setProperty("--color-edge-r", "85")
      root.style.setProperty("--color-edge-g", "85")
      root.style.setProperty("--color-edge-b", "85")
      setAccentColor(null); setAutoAccentColor?.(null); setTopEdgeColor(null); setBottomEdgeColor?.(null); return
    }
    let cancelled = false
    // Basi custom (URL esterni: Fanart.tv…): i byte cross-origin non sono
    // leggibili dal canvas (taint silente → colori stale del poster
    // precedente). Li calcola il server sugli stessi byte del render.
    if (isCustomPosterUrl(previewPoster.file_path)) {
      const ctrl = new AbortController()
      const genre = genreName || ""
      fetch(`/api/custom-colors?url=${encodeURIComponent(previewPoster.file_path)}&genre=${encodeURIComponent(genre)}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? res.json().catch(() => null) : null))
        .then((data) => {
          if (cancelled || !data) return
          const a = parseHexColor((data as Record<string, unknown>).accent)
          const t = parseHexColor((data as Record<string, unknown>).topEdge)
          const b = parseHexColor((data as Record<string, unknown>).bottomEdge)
          if (!a || !t || !b) return
          setRootColors(a.r, a.g, a.b, t.r, t.g, t.b, b.r, b.g, b.b)
        })
        .catch(() => {})
      return () => { cancelled = true; ctrl.abort() }
    }
    // C4: niente cache-busting (?cb=Date.now): i path TMDB sono immutabili,
    // quindi la stessa URL è valida per il browser cache tra un poster e
    // l'altro (l'effetto gira solo al cambio poster). Prima ogni cambio
    // riscaricava il w342 anche se già in cache.
    const url = posterUrl(previewPoster.file_path, size)
    const img = new Image()
    img.crossOrigin = "anonymous"
    const setRootColors = (r: number, g: number, b: number, edgeR: number, edgeG: number, edgeB: number, bottomR: number, bottomG: number, bottomB: number) => {
      const c = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      root.style.setProperty("--color-accent", c)
      root.style.setProperty("--color-accent-r", String(r))
      root.style.setProperty("--color-accent-g", String(g))
      root.style.setProperty("--color-accent-b", String(b))
      const edgeC = `#${edgeR.toString(16).padStart(2, '0')}${edgeG.toString(16).padStart(2, '0')}${edgeB.toString(16).padStart(2, '0')}`
      root.style.setProperty("--color-edge", edgeC)
      root.style.setProperty("--color-edge-r", String(edgeR))
      root.style.setProperty("--color-edge-g", String(edgeG))
      root.style.setProperty("--color-edge-b", String(edgeB))
      setAccentColor(c)
      setAutoAccentColor?.(c)
      setTopEdgeColor(edgeC)
      setBottomEdgeColor?.(`#${bottomR.toString(16).padStart(2, '0')}${bottomG.toString(16).padStart(2, '0')}${bottomB.toString(16).padStart(2, '0')}`)
    }
    img.onload = () => {
      if (cancelled) return
      try {
        const w = Math.min(img.naturalWidth, 342)
        const h = Math.round(w * img.naturalHeight / img.naturalWidth)
        if (!w || !h) return
        const canvas = document.createElement("canvas")
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext("2d")!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, w, h)
        const pixels = ctx.getImageData(0, 0, w, h).data
        // Stessa semantica del server (extractSceneTint su intero thumb):
        // l'auto accent deve coincidere con la tinta usata dal render,
        // altrimenti l'override `ac=` esplicito in preview contraddice
        // il server (es. Silo verde -> rosa complementare). Niente logo.
        const result = findSceneTint(pixels, w, h, genreName || '')
        const edge = topEdgeAverage(pixels, w, h)
        const bottom = bottomEdgeAverage(pixels, w, h)

        setRootColors(result.r, result.g, result.b, edge.r, edge.g, edge.b, bottom.r, bottom.g, bottom.b)
      } catch { /* color detection is non-critical */ }
    }
    img.onerror = () => { if (!cancelled) { setRootColors(85, 85, 85, 85, 85, 85, 85, 85, 85) } }
    img.src = url
    return () => { cancelled = true }
    // La semantica dell'effetto originale: gira solo quando cambia il poster
    // (genreName è letto dalla closure, non è una dependency).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPoster, size])
}
