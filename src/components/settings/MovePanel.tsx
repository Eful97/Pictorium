"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { isExtraStyleActive, isGenreStyleActive, isQualityStyleActive, isRankStyleActive, type EffectiveBadgeFlags } from "@/components/settings/SettingsElementAvailability"
import { badgeAnchorFor, type BadgeAnchor, type BadgeAnchorFamily } from "@/lib/badge-item-transforms"

// 3×3 grid; the centre cell is "Auto" (the exact centre would cover the subject).
const GRID: ReadonlyArray<BadgeAnchor | null> = ["tl", "tc", "tr", "ml", null, "mr", "bl", "bc", "br"]

const FAMILIES: ReadonlyArray<{ family: BadgeAnchorFamily; labelKey: string }> = [
  { family: "top", labelKey: "ui.rankFamily" },
  { family: "quality", labelKey: "ui.badgeQuality" },
  { family: "separate", labelKey: "ui.separateRatings" },
  { family: "genre", labelKey: "ui.genreRatingBadge" },
  { family: "network", labelKey: "ui.networkLogo" },
  { family: "logo", labelKey: "ui.anchorTitleLogo" },
]

/**
 * Spostamento tab: pin each badge family to a poster zone. The renderer
 * places the family's real box on every title (see `anchoredBoxPosition`),
 * so wide and narrow badges land on the same centre/edge.
 */
export function MovePanel({ active, previewShape }: { active: boolean; previewShape: "portrait" | "landscape" }) {
  const { t } = useT()
  const defaults = useShapeBadgeGeometryDefaults(previewShape === "landscape" ? "landscape" : "poster")
  const ed = usePosterEditor()
  // Same "is it on?" rule as the Trasforma tab: a family that is switched off
  // has nothing to move, so its grid is disabled.
  const flags: EffectiveBadgeFlags = {
    globalBadges: ed.defaultGlobalBadges,
    badgeGenre: ed.defaultBadgeGenre,
    badgeYear: ed.defaultBadgeYear,
    badgeRating: ed.defaultBadgeRating,
    separateRatings: ed.defaultSeparateRatings,
    separateRatingsStyle: ed.defaultSeparateRatingsStyle,
    rankingBadges: ed.defaultRankingBadges,
    sashOrder: ed.defaultSashOrder,
    badgeQuality: ed.defaultBadgeQuality,
    networkLogo: ed.defaultNetworkLogo,
    preRelease: ed.defaultPreRelease,
  }
  const isOn: Record<BadgeAnchorFamily, boolean> = {
    top: isRankStyleActive(flags) || isExtraStyleActive(flags),
    quality: isQualityStyleActive(flags),
    separate: !!(ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings),
    genre: isGenreStyleActive(flags),
    network: !!ed.defaultNetworkLogo,
    logo: true,
  }
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabMove")}
      hidden={!active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      <p className="px-1 text-[10px] italic leading-tight text-muted">{t("ui.anchorHint")}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {FAMILIES.map(({ family, labelKey }) => {
          const current = badgeAnchorFor(defaults.itemTransforms, family)
          const on = isOn[family]
          const offHint = on ? undefined : t("ui.activateInTabHint", { name: t(labelKey), tab: t("ui.settingsTabInformation") })
          return (
            <div
              key={family}
              className={`flex flex-col items-center gap-1.5${on ? "" : " opacity-40"}`}
              data-testid={`move-family-${family}`}
              data-inactive={on ? undefined : "true"}
              title={offHint}
            >
              <span className="w-full truncate text-center font-semibold text-zinc-200">{t(labelKey)}</span>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/30 p-1" role="group" aria-label={t(labelKey)}>
                {GRID.map((anchor) => {
                  // Centre cell = automatic layout (the exact centre is never a zone).
                  const pressed = current === anchor
                  const label = anchor ? t(`ui.anchor_${anchor}`) : t("ui.anchorAuto")
                  return (
                    <button
                      key={anchor ?? "auto"}
                      type="button"
                      aria-pressed={pressed}
                      aria-label={label}
                      title={on ? label : offHint}
                      disabled={!on}
                      onClick={() => defaults.setAnchor(family, anchor)}
                      className={`h-7 w-7 rounded text-[8px] font-semibold uppercase leading-none transition disabled:cursor-not-allowed ${
                        pressed ? "bg-accent text-black" : "bg-white/10 text-muted enabled:hover:bg-white/25"
                      }`}
                    >
                      {anchor ? null : "Auto"}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
