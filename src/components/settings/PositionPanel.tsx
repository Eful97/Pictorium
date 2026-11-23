"use client"

import { useState } from "react"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"
import { standardAnchorsReachable } from "@/lib/badge-anchor"
import { QualityAnchorSelector } from "@/components/QualityAnchorSelector"
import { TopBadgeAnchorSelector } from "@/components/TopBadgeAnchorSelector"
import { BottomAnchorSelector } from "@/components/BottomAnchorSelector"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useLandscapeProfile } from "@/components/settings/useLandscapeProfile"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import type { PosterElementId } from "@/components/settings/PosterElementNavigation"
import { Image as ImageIcon, Sparkles, Star, Trophy, Tv } from "lucide-react"
import type { ReactNode } from "react"
import {
  type EffectiveBadgeFlags,
  isBottomActive,
  isCustomRatingsActive,
  isExtraStyleActive,
  isGenreStyleActive,
  isQualityStyleActive,
  isRankStyleActive,
} from "@/components/settings/SettingsElementAvailability"

/**
 * Posizione tab: every anchor selector (logo, classifica, extra, network,
 * qualita, genere) plus the global badge overflow toggle. Moved out of
 * Trasforma/Badge; same value/onChange/side effects, gating and testids.
 * Portrait writes the flat defaults, landscape the landscape profile.
 */
export function PositionPanel({ active, previewShape, onPreviewShapeChange, onPreviewFamilyChange, element }: {
  active: boolean
  previewShape?: "portrait" | "landscape"
  onPreviewShapeChange?: (shape: "portrait" | "landscape") => void
  onPreviewFamilyChange?: (family: DefaultsPreviewFamily) => void
  demoMedia?: unknown
  previewFamily?: DefaultsPreviewFamily | null
  element?: PosterElementId | null
  geometryOnly?: boolean
}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const { land, set, famAttrs: landFamAttrs } = useLandscapeProfile(onPreviewFamilyChange)
  // Format sub-tab: parent-controlled when `previewShape` is provided.
  const [innerShape, setInnerShape] = useState<"portrait" | "landscape">("portrait")
  const controlled = previewShape !== undefined
  const shape = previewShape ?? innerShape
  const setShape = (next: "portrait" | "landscape") => {
    setInnerShape(next)
    onPreviewShapeChange?.(next)
  }
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  const hideFor = (...els: PosterElementId[]): boolean | undefined =>
    element ? !els.includes(element) : undefined
  const card = "bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in"
  const title = (icon: ReactNode, label: string) => (
    <span className="text-zinc-300 font-medium flex items-center gap-1.5">{icon}{label}</span>
  )

  // Solo ciò che il poster disegna davvero (per formato: profilo landscape ?? flat).
  const isLand = shape === "landscape"
  const pick = <T,>(l: T | null | undefined, flat: T): T => (isLand && l !== undefined && l !== null ? l : flat)
  const flags: EffectiveBadgeFlags = {
    globalBadges: pick(land.globalBadges, ed.defaultGlobalBadges),
    badgeGenre: pick(land.badgeGenre, ed.defaultBadgeGenre),
    badgeYear: pick(land.badgeYear, ed.defaultBadgeYear),
    badgeRating: pick(land.badgeRating, ed.defaultBadgeRating),
    separateRatings: pick(land.separateRatings, ed.defaultSeparateRatings),
    separateRatingsStyle: pick(land.separateRatingsStyle, ed.defaultSeparateRatingsStyle),
    rankingBadges: pick(land.rankingBadges, ed.defaultRankingBadges),
    sashOrder: pick(land.sashOrder, ed.defaultSashOrder),
    badgeQuality: pick(land.badgeQuality, ed.defaultBadgeQuality),
    customRatings: pick(land.customRatings, ed.defaultCustomRatings),
    networkLogo: pick(land.networkLogo, ed.defaultNetworkLogo),
    preRelease: pick(land.preRelease, ed.defaultPreRelease),
  }
  const badgesOn = flags.globalBadges !== false
  const overflowNow = (isLand ? land.badgeOverflow : undefined) ?? ed.defaultBadgeOverflow
  const layout = pick(land.posterLayout, ed.defaultPosterLayout)
  const reach = standardAnchorsReachable(layout, pick(land.posterFreshScope, ed.defaultPosterFreshScope))
  const gate = {
    // Portrait logo anchor was never layout-gated (historic); landscape follows the layout.
    logo: isLand ? reach : true,
    netpos: badgesOn && !!flags.networkLogo,
    rank: layout === "standard" && badgesOn && isRankStyleActive(flags),
    extra: reach && badgesOn && isExtraStyleActive(flags),
    genre: reach && (isGenreStyleActive(flags) || isBottomActive(flags) || isCustomRatingsActive(flags)),
    quality: reach && badgesOn && isQualityStyleActive(flags),
  }
  const portraitGates = gate
  const landGates = gate
  const gates = shape === "landscape" ? landGates : portraitGates
  const anyAnchor = Object.values(gates).some(Boolean)

  const portraitCards = (
    <>
      <div {...famAttrs("logo")} hidden={hideFor("logo")} className={card}>
        {title(<ImageIcon className="w-3.5 h-3.5 text-accent-orange" />, t("ui.logoSection"))}
        <AnchorPositionSelector label="ui.logoAnchor" testId="transform-logoanchor-group" optionTestPrefix="logo-anchor" value={ed.defaultLogoAnchor} onChange={(v) => { ed.setDefaultLogoAnchor(v); ed.setDefaultLogoOffsetX(0); ed.setDefaultLogoOffsetY(0) }} previewAttrs={famAttrs("position")} />
      </div>
      {portraitGates.netpos && (
        <div {...famAttrs("logo")} hidden={hideFor("logo")} className={card}>
          {title(<Tv className="w-3.5 h-3.5 text-sky-400" />, t("ui.networkLogo"))}
          <div data-testid="transform-geo-position">
            <AnchorPositionSelector logoRelative label="ui.networkLogoPosition" testId="transform-netpos-group" optionTestPrefix="netpos" value={ed.defaultNetworkLogoPosition} onChange={(v) => ed.setDefaultNetworkLogoPosition(v)} previewAttrs={famAttrs("position")} />
          </div>
        </div>
      )}
      {portraitGates.rank && (
        <div {...famAttrs("rank")} hidden={hideFor("rank")} className={card}>
          {title(<Trophy className="w-3.5 h-3.5 text-amber-500" />, t("ui.rankFamily"))}
          <TopBadgeAnchorSelector value={ed.defaultTopBadgeAnchor} testId="transform-top-badge-anchor-group"
            onChange={(a) => { ed.setDefaultTopBadgeAnchor(a); ed.setDefaultTopBadgeOffsetX(0); ed.setDefaultTopBadgeOffsetY(0) }} />
        </div>
      )}
      {portraitGates.extra && (
        <div {...famAttrs("info")} hidden={hideFor("info")} className={card}>
          {title(<Sparkles className="w-3.5 h-3.5 text-emerald-400" />, t("ui.sash_extra"))}
          <TopBadgeAnchorSelector label="ui.extraBadgeAnchor" optionTestPrefix="extra-badge-anchor" testId="transform-extra-badge-anchor-group"
            value={ed.defaultExtraBadgeAnchor} onChange={(a) => { ed.setDefaultExtraBadgeAnchor(a); ed.setDefaultExtraBadgeOffsetX(0); ed.setDefaultExtraBadgeOffsetY(0) }} />
        </div>
      )}
      {portraitGates.genre && (
        <div {...famAttrs("genre")} hidden={hideFor("genre")} className={card}>
          {title(<Star className="w-3.5 h-3.5 text-amber-400" />, t("ui.genreRatingBadge"))}
          <BottomAnchorSelector previewAttrs={famAttrs("position")} value={ed.defaultBottomAnchor} onChange={ed.setDefaultBottomAnchor} testId="transform-bottom-anchor-group" />
        </div>
      )}
      {portraitGates.quality && (
        <div {...famAttrs("quality")} hidden={hideFor("quality")} className={card}>
          {title(<Sparkles className="w-3.5 h-3.5 text-purple-400" />, t("ui.badgeQuality"))}
          <QualityAnchorSelector previewAttrs={famAttrs("position")} value={ed.defaultQualityAnchor} onChange={ed.setDefaultQualityAnchor} testId="transform-quality-anchor-group" />
        </div>
      )}
    </>
  )

  const landscapeCards = (
    <>
      {landGates.logo && (
        <div {...landFamAttrs("logo")} hidden={hideFor("logo")} className={card}>
          {title(<ImageIcon className="w-3.5 h-3.5 text-accent-orange" />, t("ui.logoSection"))}
          <AnchorPositionSelector label="ui.logoAnchor" testId="landscape-logoanchor-group" optionTestPrefix="logo-anchor" value={land.logoAnchor ?? ed.defaultLogoAnchor} onChange={(v) => set({ logoAnchor: v, logoOffsetX: 0, logoOffsetY: 0 })} previewAttrs={landFamAttrs("position")} />
        </div>
      )}
      {landGates.netpos && (
        <div {...landFamAttrs("logo")} hidden={hideFor("logo")} className={card}>
          {title(<Tv className="w-3.5 h-3.5 text-sky-400" />, t("ui.networkLogo"))}
          <AnchorPositionSelector logoRelative label="ui.networkLogoPosition" testId="landscape-netpos-group" optionTestPrefix="netpos" value={land.networkLogoPosition ?? ed.defaultNetworkLogoPosition} onChange={(v) => set({ networkLogoPosition: v })} previewAttrs={landFamAttrs("position")} />
        </div>
      )}
      {landGates.rank && (
        <div {...landFamAttrs("rank")} hidden={hideFor("rank")} className={card}>
          {title(<Trophy className="w-3.5 h-3.5 text-amber-500" />, t("ui.rankFamily"))}
          <TopBadgeAnchorSelector value={land.topBadgeAnchor ?? ed.defaultTopBadgeAnchor} onChange={(v) => set({ topBadgeAnchor: v, topBadgeOffsetX: 0, topBadgeOffsetY: 0 })} testId="landscape-top-badge-anchor-group" />
        </div>
      )}
      {landGates.extra && (
        <div {...landFamAttrs("info")} hidden={hideFor("info")} className={card}>
          {title(<Sparkles className="w-3.5 h-3.5 text-emerald-400" />, t("ui.sash_extra"))}
          <TopBadgeAnchorSelector label="ui.extraBadgeAnchor" optionTestPrefix="extra-badge-anchor" testId="landscape-extra-badge-anchor-group"
            value={land.extraBadgeAnchor ?? ed.defaultExtraBadgeAnchor} onChange={(v) => set({ extraBadgeAnchor: v, extraBadgeOffsetX: 0, extraBadgeOffsetY: 0 })} />
        </div>
      )}
      {landGates.genre && (
        <div {...landFamAttrs("genre")} hidden={hideFor("genre")} className={card}>
          {title(<Star className="w-3.5 h-3.5 text-amber-400" />, t("ui.genreRatingBadge"))}
          <BottomAnchorSelector previewAttrs={landFamAttrs("position")} value={land.bottomAnchor ?? ed.defaultBottomAnchor} onChange={(v) => set({ bottomAnchor: v })} testId="landscape-bottom-anchor-group" />
        </div>
      )}
      {landGates.quality && (
        <div {...landFamAttrs("quality")} hidden={hideFor("quality")} className={card}>
          {title(<Sparkles className="w-3.5 h-3.5 text-purple-400" />, t("ui.badgeQuality"))}
          <QualityAnchorSelector previewAttrs={landFamAttrs("position")} value={land.qualityAnchor ?? ed.defaultQualityAnchor} onChange={(v) => set({ qualityAnchor: v })} testId="landscape-quality-anchor-group" />
        </div>
      )}
    </>
  )

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.position")}
      hidden={!active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {!controlled && (
        <div className="flex gap-1 p-1 rounded-xl bg-black/40 border border-white/10" aria-label={t("ui.position")}>
          {(["portrait", "landscape"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={shape === s}
              onClick={() => setShape(s)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                shape === s ? "bg-white/15 text-foreground shadow-sm" : "text-muted hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {s === "portrait" ? t("ui.posterShapePortrait") : t("ui.posterShapeLandscape")}
            </button>
          ))}
        </div>
      )}
      {!anyAnchor && (
        <p data-testid="position-tab-inactive" className="text-[11px] text-zinc-400 italic px-1">{t("ui.positionTabInactive")}</p>
      )}
      {shape === "landscape" ? landscapeCards : portraitCards}
      {ed.defaultGlobalBadges && (
        <div className={card} data-testid="badge-overflow-group">
          <div className="flex items-center justify-between py-1">
            <span className="text-zinc-300 font-medium">{t("ui.badgeOverflow")}</span>
            <div role="radiogroup" aria-label={t("ui.badgeOverflow")} className="inline-flex rounded-md bg-white/5 p-0.5">
              {(["move", "hide"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={overflowNow === v}
                  data-testid={`badge-overflow-${v}`}
                  onClick={() => (isLand ? set({ badgeOverflow: v }) : ed.setDefaultBadgeOverflow(v))}
                  className={`px-2 py-0.5 text-[11px] rounded ${overflowNow === v ? "bg-white/20 text-foreground" : "text-muted"}`}
                >
                  {t(v === "move" ? "ui.badgeOverflowMove" : "ui.badgeOverflowHide")}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-zinc-400 leading-snug -mt-1">{t("ui.badgeOverflowHint")}</p>
        </div>
      )}
    </div>
  )
}
