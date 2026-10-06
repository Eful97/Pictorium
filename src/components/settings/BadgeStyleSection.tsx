"use client"

import { Palette } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { BadgeStyleSelector, VideoFormatSelector, BadgeFontSelector } from "@/components/ui"
import { KNOWN_VIDEO_FORMATS } from "@/lib/av-specs"
import { useShapeBadgeDefaults, type BadgeShapeTarget } from "@/components/settings/useShapeDefaults"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"

/** Default graphic styles (Badge tab). Follows the Badge edit target:
 * portrait reads/writes the shared flats, landscape the profile overrides.
 * Sub-groups report their preview family (genre style + font = genre, quality
 * style = quality) — preview-only, never writes. */
export function BadgeStyleSection({ shape, qualityEnabled, onPreviewFamilyChange }: { shape?: BadgeShapeTarget; qualityEnabled?: boolean; onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const { scoped } = useShapeBadgeDefaults(shape)
  const [badgeStyle, setBadgeStyle] = scoped("badgeStyle", ed.defaultBadgeStyle, ed.setDefaultBadgeStyle)
  const [badgeFont, setBadgeFont] = scoped("badgeFont", ed.defaultBadgeFont, ed.setDefaultBadgeFont)
  const [qualityBadgeStyle, setQualityBadgeStyle] = scoped("qualityBadgeStyle", ed.defaultQualityBadgeStyle, ed.setDefaultQualityBadgeStyle)
  const [videoFormats, setVideoFormats] = scoped("videoFormats", ed.defaultVideoFormats, ed.setDefaultVideoFormats)
  const showQuality = qualityEnabled ?? ed.defaultBadgeQuality
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <Palette className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.styleDefault")}
      </span>

      {/* Rank/extra looks live in the Classifica + Informazioni cards above
          (single RankingAppearanceSelector, no duplicated switches here). */}

      <div {...famAttrs("genre")} className="space-y-1.5">
        <label className="text-[11px] text-muted font-medium block">
          {t("ui.styleGenreBadge")}
        </label>
        <BadgeStyleSelector
          value={badgeStyle}
          options={["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"]}
          onChange={(v) => {
            setBadgeStyle(v)
          }}
          t={t}
        />
      </div>

      <div {...famAttrs("genre")} className="pt-2 border-t border-surface2/50 space-y-1.5">
        <label className="text-[11px] text-muted font-medium block">
          {t("ui.badgeFont")}
        </label>
        <BadgeFontSelector
          value={badgeFont}
          onChange={(v) => {
            setBadgeFont(v)
          }}
        />
      </div>

      {showQuality && (
        <div {...famAttrs("quality")} className="pt-2 border-t border-surface2/50 space-y-1.5">
          <label className="text-[11px] text-muted font-medium block">
            {t("ui.qualityBadgeStyle")}
          </label>
          <BadgeStyleSelector
            value={qualityBadgeStyle}
            options={["standard", "mono", "color", "knockout"]}
            onChange={(v) => {
              setQualityBadgeStyle(v)
            }}
            t={t}
          />

          <div className="pt-2 border-t border-surface2/50 space-y-1.5">
            <label className="text-[11px] text-muted font-medium block">
              {t("ui.defaultVideoFormats")}
            </label>
            <VideoFormatSelector
              selectedFormats={videoFormats ?? KNOWN_VIDEO_FORMATS}
              onChange={(formats) => setVideoFormats(formats)}
              t={t}
            />
          </div>
        </div>
      )}
    </div>
  )
}
