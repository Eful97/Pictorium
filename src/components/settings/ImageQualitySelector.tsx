"use client"

import { useEffect, useState } from "react"
import { Gauge } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { fetchServerStatus } from "@/lib/guest-guard"
import { IMAGE_QUALITIES, type ImageQuality } from "@/lib/image-quality"

export type ImageQualityTarget = "portrait" | "landscape" | "thumbnail"

const LABEL: Record<ImageQuality, string> = {
  low: "ui.imageQualityLow",
  medium: "ui.imageQualityMedium",
  high: "ui.imageQualityHigh",
}

const TARGET_LABEL: Record<ImageQualityTarget, string> = {
  portrait: "ui.imageQualityPortrait",
  landscape: "ui.imageQualityLandscape",
  thumbnail: "ui.imageQualityThumbnail",
}

/**
 * Qualità di compressione della forma mostrata in anteprima (verticale,
 * orizzontale o miniatura). Visibile solo se `/api/status` abilita l'opzione
 * (istanza privata + PICTORIUM_IMAGE_QUALITY_OPTION=1).
 */
export function ImageQualitySelector({ target }: { target: ImageQualityTarget }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let live = true
    fetchServerStatus().then((s) => { if (live) setEnabled(s.imageQualityOption) }, () => {})
    return () => { live = false }
  }, [])
  if (!enabled) return null

  const value = target === "thumbnail"
    ? ed.defaultImageQualityThumbnail
    : target === "landscape" ? ed.defaultImageQualityLandscape : ed.defaultImageQualityPortrait
  const set = target === "thumbnail"
    ? ed.setDefaultImageQualityThumbnail
    : target === "landscape" ? ed.setDefaultImageQualityLandscape : ed.setDefaultImageQualityPortrait
  const label = `${t("ui.imageQuality")} · ${t(TARGET_LABEL[target])}`

  return (
    <div data-testid="image-quality-selector" className="w-full mt-1.5 space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <span className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold text-zinc-200">
        <Gauge className="w-3.5 h-3.5 text-accent-orange shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <div role="radiogroup" aria-label={label} className="flex w-full rounded-lg border border-white/10 overflow-hidden">
        {IMAGE_QUALITIES.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={value === q}
            data-testid={`image-quality-${q}`}
            onClick={() => set(q)}
            className={`flex-1 px-2 min-h-[36px] text-[11px] font-semibold transition cursor-pointer touch-manipulation ${
              value === q ? "bg-accent-orange/20 text-accent-orange" : "text-zinc-300 hover:bg-white/10"
            }`}
          >
            {t(LABEL[q])}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Aggiunge `iq=` all'URL di anteprima (solo valori non di default). */
export function withPreviewImageQuality(url: string, quality: ImageQuality): string {
  if (!url || quality === "medium") return url
  return `${url}${url.includes("?") ? "&" : "?"}iq=${quality}`
}
