"use client"

import { VIDEO_FORMAT_OPTIONS, FORMAT_ICON_PATHS, type VideoFormat } from "@/lib/av-specs"
import { RotateCcw } from "lucide-react"

export interface VideoFormatSelectorProps {
  selectedFormats: readonly VideoFormat[]
  onChange: (formats: VideoFormat[]) => void
  onReset?: () => void
  isCustomized?: boolean
  t: (k: string) => string
}

export function VideoFormatSelector({
  selectedFormats,
  onChange,
  onReset,
  isCustomized,
  t,
}: VideoFormatSelectorProps) {
  const toggleFormat = (id: VideoFormat) => {
    const isSelected = selectedFormats.includes(id)
    if (isSelected) {
      onChange(selectedFormats.filter((f) => f !== id))
    } else {
      onChange([...selectedFormats, id])
    }
  }

  const selectAll = () => {
    onChange(VIDEO_FORMAT_OPTIONS.map((opt) => opt.id))
  }

  const selectNone = () => {
    onChange([])
  }

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex items-center justify-between px-0.5 text-[10px]">
        <span className="text-muted leading-tight">
          {selectedFormats.length}/{VIDEO_FORMAT_OPTIONS.length} {t("ui.activeCount") || "attivi"}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {onReset && isCustomized && (
            <>
              <button
                type="button"
                onClick={onReset}
                title={t("ui.resetAuto") || "Ripristina rilevamento automatico"}
                className="text-amber-400/90 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Auto</span>
              </button>
              <span className="text-zinc-600">·</span>
            </>
          )}
          <button
            type="button"
            onClick={selectAll}
            className="text-accent-orange hover:underline font-semibold transition-colors"
          >
            {t("ui.formatsAll") || "Tutti"}
          </button>
          <span className="text-zinc-600">·</span>
          <button
            type="button"
            onClick={selectNone}
            className="text-muted hover:text-zinc-200 transition-colors"
          >
            {t("ui.formatsNone") || "Nessuno"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 w-full">
        {VIDEO_FORMAT_OPTIONS.map((opt) => {
          const isSelected = selectedFormats.includes(opt.id)
          const iconPath = `/${FORMAT_ICON_PATHS[opt.id]}`

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleFormat(opt.id)}
              title={opt.fullName}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 px-0.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                isSelected
                  ? "bg-accent-orange/15 text-zinc-100 border-accent-orange/30 font-semibold shadow-sm"
                  : "bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300 border-white/[0.05] opacity-60 hover:opacity-100"
              }`}
            >
              <div className="h-4 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- SVG locale dinamico */}
                <img
                  src={iconPath}
                  alt={opt.label}
                  className={`h-3 max-w-[28px] object-contain transition-opacity duration-150 ${
                    isSelected ? "brightness-0 invert opacity-100" : "brightness-0 invert opacity-40"
                  }`}
                />
              </div>
              <span className="text-[9px] font-mono leading-none tracking-tight truncate max-w-full">
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
