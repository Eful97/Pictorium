"use client"

import { useRef } from "react"
import { ImageOff, RefreshCw } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { useToast } from "@/components/Toast"

interface PosterPreviewProps {
  previewLoading: boolean
  loadProgress: number
  imageError: boolean
  setImageError: (error: boolean) => void
  imgSrc: string
  onRetry?: () => void
}

export function PosterPreview({
  previewLoading,
  loadProgress,
  imageError,
  setImageError,
  imgSrc,
  onRetry
}: PosterPreviewProps) {
  const selected = usePSelector((v) => v.selected)
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const previewUrl = usePSelector((v) => v.previewUrl)
  const { t } = useT()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  return (
    <div role="img" aria-label={`Preview of ${selected?.title || selected?.name || ""} poster with ${selectedLogo ? "logo" : "no logo"}`}
         className={`preview-frame w-full rounded-[1.35rem] overflow-hidden relative ${previewPoster ? "preview-frame-active" : ""}`}>
      <div className="relative aspect-[2/3] select-none pointer-events-none bg-zinc-950/70 overflow-hidden rounded-[1.2rem]">
        {previewUrl ? (
          <>
            <div className="preview-loading-overlay" style={{ opacity: previewLoading ? 1 : 0 }} />
            <div className="preview-hairline-track" style={{ opacity: previewLoading ? 1 : 0, transition: "opacity 0.25s ease" }}>
              <div className="preview-hairline-bar" style={{ transform: `scaleX(${loadProgress / 100})` }} />
            </div>
            <div className="preview-loading-pill" style={{ opacity: previewLoading ? 1 : 0 }}>
              <span className="w-2.5 h-2.5 rounded-full border-2 border-accent-orange/40 border-t-accent-orange animate-spin inline-block mr-1.5" />
              <span>{loadProgress}%</span>
            </div>
            {imgSrc && (
              /* eslint-disable-next-line @next/next/no-img-element -- server-rendered poster */
              <img
                src={imgSrc}
                alt={selected?.title || selected?.name || ""}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </>
        ) : selected ? (
          <div className="absolute inset-0 bg-surface2/50 animate-pulse rounded-2xl" />
        ) : null}
        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 text-center p-8 z-20">
            <ImageOff className="w-12 h-12 mb-3 text-zinc-500" />
            <p className="text-sm text-muted font-medium">{t("ui.imageNotAvailable")}</p>
            <p className="text-xs text-zinc-500 mt-1">{t("ui.posterLoadError")}</p>
            <button type="button" aria-label={t("ui.retry")} onClick={() => { setImageError(false); onRetry?.() }}
                    className="mt-3 px-3 py-1.5 text-xs text-muted hover:text-white border border-border hover:border-zinc-500 rounded-lg transition-all duration-150">
              <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />{t("ui.retry")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}