"use client"

import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"
import { standardAnchorsReachable } from "@/lib/badge-anchor"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { QualityAnchorSelector } from "@/components/QualityAnchorSelector"
import { TopBadgeAnchorSelector } from "@/components/TopBadgeAnchorSelector"
import { BottomAnchorSelector } from "@/components/BottomAnchorSelector"
import { usePSelector } from "@/lib/context"
import {
  type EffectiveBadgeFlags,
  isBottomActive,
  isCustomRatingsActive,
  isExtraStyleActive,
  isGenreStyleActive,
  isQualityStyleActive,
  isRankStyleActive,
} from "@/components/settings/SettingsElementAvailability"

export function PositionControls() {
  const { t } = useT()
  const ed = usePosterEditor()
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const anchorsReachable = standardAnchorsReachable(ed.posterLayout, ed.posterFreshScope)
  // Solo ciò che il poster disegna davvero: un elemento spento non ha posizione.
  const flags: EffectiveBadgeFlags = {
    globalBadges: ed.globalBadges,
    badgeGenre: ed.badgeGenre,
    badgeYear: ed.badgeYear,
    badgeRating: ed.badgeRating,
    separateRatings: ed.separateRatings,
    separateRatingsStyle: ed.separateRatingsStyle,
    rankingBadges: ed.rankingBadges,
    sashOrder: ed.defaultSashOrder,
    badgeQuality: ed.badgeQuality,
    customRatings: ed.customRatings,
    networkLogo: ed.networkLogo,
    preRelease: ed.preRelease,
  }
  const badgesOn = ed.globalBadges !== false
  const show = {
    logo: anchorsReachable && !!selectedLogo,
    rank: ed.posterLayout === "standard" && badgesOn && isRankStyleActive(flags),
    extra: anchorsReachable && badgesOn && isExtraStyleActive(flags),
    network: badgesOn && ed.networkLogo,
    quality: anchorsReachable && badgesOn && isQualityStyleActive(flags),
    bottom: anchorsReachable && (isGenreStyleActive(flags) || isBottomActive(flags) || isCustomRatingsActive(flags)),
  }

  const card = (key: string, children: React.ReactNode) => (
    <div key={key} className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
      {children}
    </div>
  )

  return (
    <div className="space-y-3">
      <h3 className="px-1 font-semibold text-zinc-200">{t("ui.position")}</h3>
      {!Object.values(show).some(Boolean) && (
        <p className="px-1 text-[11px] text-muted italic leading-tight">{t("ui.positionTabInactive")}</p>
      )}
      {show.logo && card("logo",
        <AnchorPositionSelector label="ui.logoAnchor" testId="logo-anchor-group" optionTestPrefix="logo-anchor" value={ed.logoAnchor} onChange={(v) => { ed.setLogoAnchor(v); ed.setLogoOffsetX(0); ed.setLogoOffsetY(0) }} />
      )}
      {show.rank && card("rank",
        <TopBadgeAnchorSelector value={ed.topBadgeAnchor} testId="badge-top-badge-anchor-group"
          onChange={(a) => { ed.setTopBadgeAnchor(a); ed.setTopBadgeOffsetX(0); ed.setTopBadgeOffsetY(0) }} />
      )}
      {show.extra && card("extra",
        <TopBadgeAnchorSelector label="ui.extraBadgeAnchor" optionTestPrefix="extra-badge-anchor" testId="badge-extra-badge-anchor-group"
          value={ed.extraBadgeAnchor} onChange={(a) => { ed.setExtraBadgeAnchor(a); ed.setExtraBadgeOffsetX(0); ed.setExtraBadgeOffsetY(0) }} />
      )}
      {show.network && card("network",
        <AnchorPositionSelector logoRelative label="ui.networkLogoPosition" testId="badge-netpos-group" optionTestPrefix="netpos" value={ed.networkLogoPosition} onChange={(v) => ed.setNetworkLogoPosition(v)} />
      )}
      {show.quality && card("quality",
        <QualityAnchorSelector value={ed.qualityAnchor} onChange={ed.setQualityAnchor} />
      )}
      {show.bottom && card("bottom",
        <BottomAnchorSelector value={ed.bottomAnchor} onChange={ed.setBottomAnchor} />
      )}
    </div>
  )
}
