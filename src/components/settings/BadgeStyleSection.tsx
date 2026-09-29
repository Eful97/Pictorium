"use client"

import { Palette } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { BadgeStyleSelector, VideoFormatSelector } from "@/components/ui"
import { KNOWN_VIDEO_FORMATS } from "@/lib/av-specs"

/** Stili grafici predefiniti (tab Badge). Estratto da SettingsPanel: solo JSX + context, nessuno stato locale. */
export function BadgeStyleSection() {
  const accentColor = usePSelector((v) => v.accentColor)
  const { t } = useT()
  const ed = usePosterEditor()
  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <Palette className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.styleDefault")}
      </span>

      <div className="space-y-1.5">
        <label className="text-[11px] text-muted font-medium block">
          {t("ui.styleRankingDefault")}
        </label>
        <BadgeStyleSelector
          value={ed.defaultRankingBadgeStyle}
          options={["default", "pill", "colored", "bordo", "vetro"]}
          onChange={(v) => {
            ed.setDefaultRankingBadgeStyle(v)
          }}
          t={t}
          accentColor={accentColor}
        />
      </div>

      <div className="pt-2 border-t border-surface2/50 space-y-1.5">
        <label className="text-[11px] text-muted font-medium block">
          {t("ui.styleGenreBadge")}
        </label>
        <BadgeStyleSelector
          value={ed.defaultBadgeStyle}
          options={["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"]}
          onChange={(v) => {
            ed.setDefaultBadgeStyle(v)
          }}
          t={t}
        />
      </div>

      {ed.defaultBadgeQuality && (
        <div className="pt-2 border-t border-surface2/50 space-y-1.5">
          <label className="text-[11px] text-muted font-medium block">
            {t("ui.qualityBadgeStyle")}
          </label>
          <BadgeStyleSelector
            value={ed.defaultQualityBadgeStyle}
            options={["standard", "mono", "color"]}
            onChange={(v) => {
              ed.setDefaultQualityBadgeStyle(v)
            }}
            t={t}
          />

          <div className="pt-2 border-t border-surface2/50 space-y-1.5">
            <label className="text-[11px] text-muted font-medium block">
              {t("ui.defaultVideoFormats")}
            </label>
            <VideoFormatSelector
              selectedFormats={ed.defaultVideoFormats ?? KNOWN_VIDEO_FORMATS}
              onChange={(formats) => ed.setDefaultVideoFormats(formats)}
              t={t}
            />
          </div>
        </div>
      )}
    </div>
  )
}
