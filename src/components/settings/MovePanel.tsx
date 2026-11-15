"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { badgeAnchorFor, type BadgeAnchor, type BadgeAnchorFamily } from "@/lib/badge-item-transforms"

// 3×3 grid without the centre cell (it would cover the subject).
const GRID: ReadonlyArray<BadgeAnchor | null> = ["tl", "tc", "tr", "ml", null, "mr", "bl", "bc", "br"]

const FAMILIES: ReadonlyArray<{ family: BadgeAnchorFamily; labelKey: string }> = [
  { family: "top", labelKey: "ui.rankFamily" },
  { family: "quality", labelKey: "ui.badgeQuality" },
  { family: "separate", labelKey: "ui.separateRatings" },
  { family: "genre", labelKey: "ui.genreRatingBadge" },
  { family: "network", labelKey: "ui.networkLogo" },
]

/**
 * Spostamento tab: pin each badge family to a poster zone. The renderer
 * places the family's real box on every title (see `anchoredBoxPosition`),
 * so wide and narrow badges land on the same centre/edge.
 */
export function MovePanel({ active, previewShape }: { active: boolean; previewShape: "portrait" | "landscape" }) {
  const { t } = useT()
  const defaults = useShapeBadgeGeometryDefaults(previewShape === "landscape" ? "landscape" : "poster")
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabMove")}
      hidden={!active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      <p className="px-1 text-[10px] italic leading-tight text-muted">{t("ui.anchorHint")}</p>
      {FAMILIES.map(({ family, labelKey }) => {
        const current = badgeAnchorFor(defaults.itemTransforms, family)
        return (
          <div key={family} className="flex items-center gap-3 px-1" data-testid={`move-family-${family}`}>
            <div className="flex-1 min-w-0">
              <span className="block truncate font-semibold text-zinc-200">{t(labelKey)}</span>
              <button
                type="button"
                aria-pressed={current === null}
                onClick={() => defaults.setAnchor(family, null)}
                className={`mt-1 rounded-md border px-2 py-0.5 text-[10px] transition ${
                  current === null ? "border-accent/50 text-accent" : "border-border/50 text-muted hover:text-accent"
                }`}
              >
                {t("ui.anchorAuto")}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/30 p-1" role="group" aria-label={t(labelKey)}>
              {GRID.map((anchor, i) =>
                anchor === null ? (
                  <span key={i} className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <button
                    key={anchor}
                    type="button"
                    aria-pressed={current === anchor}
                    aria-label={t(`ui.anchor_${anchor}`)}
                    title={t(`ui.anchor_${anchor}`)}
                    onClick={() => defaults.setAnchor(family, anchor)}
                    className={`h-6 w-6 rounded transition ${
                      current === anchor ? "bg-accent" : "bg-white/10 hover:bg-white/25"
                    }`}
                  />
                ),
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
