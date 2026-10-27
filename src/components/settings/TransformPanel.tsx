"use client"

import { useState, useRef } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { isFollowOffDisabled, neutralFollowOffsets } from "@/lib/network-freeze"
import { useNetworkFreeze } from "@/lib/useNetworkFreeze"
import { useNetworkGeometry } from "@/lib/useNetworkGeometry"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"
import { SliderRow } from "@/components/SliderRow"
import { Toggle } from "@/components/Toggle"
import { isBottomSeparateRatingsStyle, getSeparateBadgeDefaultScale, getSeparateRatingsStyleForShape, separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX, DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y, NUMBER_BADGE_BASE_OFFSET_X } from "@/lib/badge-styles"
import { NATURAL_GRADIENT_DEFAULTS, type GradientPresetValues } from "@/lib/gradient-presets"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import { LandscapeDefaultsSection } from "@/components/LandscapeDefaultsSection"
import { useShapeBadgeDefaults, useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import type { PosterElementId } from "@/components/settings/PosterElementNavigation"
import { ArrowLeftRight, ArrowUpDown, Circle, Cloud, Image as ImageIcon, Minus, Ruler, Search, Sparkles, Star, Trophy, Tv } from "lucide-react"
import { getBadgeOffsetRange } from "@/lib/badge-offset-ranges"
import { AvailabilityGate, isExtraStyleActive, isGenreStyleActive, isQualityStyleActive, isRankStyleActive, orderActiveFirst, type EffectiveBadgeFlags } from "@/components/settings/SettingsElementAvailability"
import { BadgeItemTransformControls } from "@/components/settings/BadgeItemTransformControls"

/** Compact inactive placeholder for geometry mode: the group stays
 *  discoverable with a short hint naming the tab that owns its switch.
 *  Never an opacity-dimmed container. */
function TransformInactive({ name, tab }: { name: string; tab: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 cursor-pointer"
      >
        <span className="text-zinc-300 font-medium text-xs">{name}</span>
        <span className="text-[10px] text-zinc-500">{open ? "\u2212" : "+"}</span>
      </button>
      {open && (
        <p className="text-[11px] text-zinc-400 italic leading-snug">{t("ui.activateInTabHint", { name, tab })}</p>
      )}
    </div>
  )
}

/**
 * Portrait effective geometry (five-tab settings): gated geometry groups in
 * active-first DOM order with retained disabled controls. Title logo and
 * background stay independent (always active); no visibility/style/layout
 * pickers live here. Raw setting values, resets, ranges, units and Card
 * locks mirror the legacy standalone cards below (single callbacks, no
 * duplicated implementations on screen — this branch mounts exclusively).
 */
function PortraitEffectiveGeometry({ editVal, editTxt, setEditVal, setEditTxt, element, onPreviewFamilyChange, followOn, followOffDisabled, freezing, onFollowChange, defOffRangeX, defOffRangeY, defTopXBase, defBarXOff, isCardAll, isCardRanked, cardNote, fallbackNote, itemPreviewUrl }: {
  editVal: string | null
  editTxt: string
  setEditVal: (v: string | null) => void
  setEditTxt: (v: string) => void
  element?: PosterElementId | null
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
  followOn: boolean
  followOffDisabled: boolean
  freezing: boolean
  onFollowChange: (v: boolean) => void
  defOffRangeX: { min: number; max: number; boundsMin: number; boundsMax: number }
  defOffRangeY: { min: number; max: number; boundsMin: number; boundsMax: number }
  defTopXBase: number
  defBarXOff: boolean
  isCardAll: boolean
  isCardRanked: boolean
  cardNote?: string
  fallbackNote?: string
  /** Exact defaults-preview URL of this shape (per-item controls need it). */
  itemPreviewUrl?: string
}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const resets = useShapeBadgeGeometryDefaults("poster")
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  const hideFor = (...els: PosterElementId[]): boolean | undefined =>
    element ? !els.includes(element) : undefined
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
  const rankActive = isRankStyleActive(flags)
  const extraActive = isExtraStyleActive(flags)
  const metaActive = isGenreStyleActive(flags)
  const qualityActive = isQualityStyleActive(flags)
  const sepActive = !!(ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings)
  const netActive = !!ed.defaultNetworkLogo
  const tabHint = t("ui.settingsTabInformation")
  const rankTabHint = t("ui.settingsTabRankings")
  const slider = (icon: React.ReactNode, label: string, value: number, min: number, max: number, boundsMin: number, boundsMax: number, onChange: (v: number) => void, onDoubleClick: () => void, editingKey: string, suffix: string, step?: number) => (
    <SliderRow icon={icon} label={label} value={value} min={min} max={max} boundsMin={boundsMin} boundsMax={boundsMax} step={step} onChange={onChange} onDoubleClick={onDoubleClick} editingValue={editVal} editText={editTxt} setEditingValue={setEditVal} setEditText={setEditTxt} editingKey={editingKey} suffix={suffix} />
  )
  const cardNotes = (rankedOnly?: boolean) => (
    <>
      {isCardAll && (
        <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
      )}
      {isCardRanked && (rankedOnly || true) && (
        <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
      )}
    </>
  )
  void cardNote
  void fallbackNote
  const flatFresh = ed.defaultPosterLayout === "fresh"
  const flatFreshAll = flatFresh && ed.defaultPosterFreshScope === "all"
  const logoMax = flatFresh ? 200 : 100
  const logoShown = ed.defaultLogoScale ?? (flatFreshAll ? 100 : 75)
  const logoCard = (
    <div {...famAttrs("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.logoSection")}
          {ed.defaultLogoScale == null && (
            <span className="text-[10px] font-medium text-muted">· {t("ui.auto")}</span>
          )}
        </span>
        <button type="button" aria-label={t("ui.reset")}
                onClick={() => resets.resetFamily("logo")}
                className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), logoShown, 10, logoMax, 10, logoMax, (v) => { ed.setDefaultLogoScale(v) }, () => { ed.setDefaultLogoScale(null) }, "dlogoScale", "%")}
      <div title={isCardAll ? t("ui.posterLayoutCardControlsNote") : (isCardRanked ? t("ui.posterLayoutCardFallbackNote") : undefined)} aria-disabled={isCardAll || undefined}>
        <fieldset disabled={isCardAll} className="contents">
          {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultLogoOffsetX ?? 0, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { ed.setDefaultLogoOffsetX(v) }, () => { ed.setDefaultLogoOffsetX(null) }, "dlogoOX", "px", 1)}
          {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultLogoOffsetY ?? 0, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultLogoOffsetY(v) }, () => { ed.setDefaultLogoOffsetY(null) }, "dlogoOY", "px", 1)}
        </fieldset>
      </div>
      {cardNotes()}
    </div>
  )
  // Position card (Auto alignment only): the title-logo alignment selector
  // is removed — Auto always (portrait center, landscape left by server
  // contract). Only the network-position override lives here, and only while
  // the network logo is enabled (no empty Position card when off).
  const positionCard = netActive ? (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <span className="text-zinc-200 font-semibold text-xs">{t("ui.position")}</span>
      <div className="space-y-1.5" title={t("ui.networkLogoPosition")} data-testid="transform-netpos-group">
        <span className="text-[11px] text-muted font-medium block">{t("ui.networkLogoPosition")}</span>
          <div className="flex gap-1">
            {(["auto", "top"] as const).map((pos) => (
              <button key={pos} type="button" onClick={() => ed.setDefaultNetworkLogoPosition(pos)} aria-pressed={ed.defaultNetworkLogoPosition === pos} className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${ed.defaultNetworkLogoPosition === pos ? "bg-white/20 text-foreground shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"}`}>
                {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
              </button>
            ))}
          </div>
      </div>
    </div>
  ) : null
  const rankCard = (
    <div {...famAttrs("rank")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-500" />
          {t("ui.rankFamily")}
        </span>
        <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetFamily("rank")} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      <div className="space-y-1.5 pt-1" title={isCardAll ? t("ui.posterLayoutCardControlsNote") : (isCardRanked ? t("ui.posterLayoutCardFallbackNote") : undefined)}>
        <fieldset disabled={isCardAll} className="contents">
          {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), ed.defaultTopBadgeScale, 50, 150, 10, 200, (v) => { ed.setDefaultTopBadgeScale(v) }, () => { ed.setDefaultTopBadgeScale(100) }, "tbs", "%")}
          {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultTopBadgeOffsetX + defTopXBase, defOffRangeX.min + defTopXBase, defOffRangeX.max + defTopXBase, defOffRangeX.boundsMin + defTopXBase, defOffRangeX.boundsMax + defTopXBase, (v) => { ed.setDefaultTopBadgeOffsetX(v - defTopXBase) }, () => { ed.setDefaultTopBadgeOffsetX(0) }, "tbx", "px", 1)}
          {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultTopBadgeOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultTopBadgeOffsetY(v) }, () => { ed.setDefaultTopBadgeOffsetY(0) }, "tby", "px", 1)}
        </fieldset>
      </div>
      {cardNotes()}
    </div>
  )
  const extraCard = (
    <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          {t("ui.sash_extra")}
        </span>
        <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetFamily("extra")} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      <div className="space-y-1.5 pt-1">
        {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), ed.defaultExtraBadgeScale ?? ed.defaultTopBadgeScale, 50, 150, 10, 200, (v) => { ed.setDefaultExtraBadgeScale(v) }, () => { ed.setDefaultExtraBadgeScale(null) }, "exs", "%")}
        {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultExtraBadgeOffsetX ?? ed.defaultTopBadgeOffsetX, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { ed.setDefaultExtraBadgeOffsetX(v) }, () => { ed.setDefaultExtraBadgeOffsetX(null) }, "exx", "px", 1)}
        {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultExtraBadgeOffsetY ?? ed.defaultTopBadgeOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultExtraBadgeOffsetY(v) }, () => { ed.setDefaultExtraBadgeOffsetY(null) }, "exy", "px", 1)}
      </div>
    </div>
  )
  const metaCard = (
    <div {...famAttrs("genre")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("ui.genreRatingBadge")}
        </span>
        <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetFamily("genre")} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      <div className="space-y-1.5 pt-1">
        {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), ed.defaultGenreBadgeScale, 50, 150, 10, 200, (v) => { ed.setDefaultGenreBadgeScale(v) }, () => { ed.setDefaultGenreBadgeScale(100) }, "gbs", "%")}
        <div title={isCardAll ? t("ui.posterLayoutCardControlsNote") : (isCardRanked ? t("ui.posterLayoutCardFallbackNote") : undefined)} aria-disabled={isCardAll || undefined}>
          <fieldset disabled={isCardAll} className="contents">
            {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultGenreBadgeOffsetX, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { ed.setDefaultGenreBadgeOffsetX(v) }, () => { ed.setDefaultGenreBadgeOffsetX(0) }, "gbx", "px", 1)}
            {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultGenreBadgeOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultGenreBadgeOffsetY(v) }, () => { ed.setDefaultGenreBadgeOffsetY(0) }, "gby", "px", 1)}
          </fieldset>
        </div>
        {cardNotes()}
      </div>
    </div>
  )
  const qualityCard = (
    <div {...famAttrs("quality")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          {t("ui.badgeQuality")}
        </span>
        <div className="flex items-center gap-1">
          {/* Recovery, not reset: deletes every quality badge correction from
              the draft (hidden marks included) and leaves the group's own
              position/scale, the ratings and the applied preset untouched. */}
          <button
            type="button"
            aria-label={t("ui.badgeGroupRejoin")}
            title={t("ui.badgeRejoinHint")}
            data-testid="badge-group-rejoin-quality"
            onClick={() => resets.rejoin({ families: ["quality"] })}
            className="text-xs text-sky-200 hover:text-white transition-colors px-2 py-0.5 rounded-md border border-sky-300/40 hover:border-sky-300"
          >
            {t("ui.badgeGroupRejoin")}
          </button>
          <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetFamily("quality")} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
      </div>
      <div className="space-y-1.5 pt-1">
        {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), ed.defaultQualityBadgeScale, 50, 150, 10, 200, (v) => { ed.setDefaultQualityBadgeScale(v) }, () => { ed.setDefaultQualityBadgeScale(100) }, "qbs", "%")}
        {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultQualityBadgeOffsetX, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { ed.setDefaultQualityBadgeOffsetX(v) }, () => { ed.setDefaultQualityBadgeOffsetX(DEFAULT_QUALITY_BADGE_OFFSET_X) }, "qbx", "px", 1)}
        {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultQualityBadgeOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultQualityBadgeOffsetY(v) }, () => { ed.setDefaultQualityBadgeOffsetY(DEFAULT_QUALITY_BADGE_OFFSET_Y) }, "qby", "px", 1)}
        <BadgeItemTransformControls previewUrl={itemPreviewUrl ?? ""} family="quality" shape="poster" className="pt-1.5 border-t border-white/5" />
      </div>
    </div>
  )
  const separateCard = (
    <div {...famAttrs("ratings")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("ui.separateRatings")}
        </span>
        <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetFamily("separate")} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      <div className="space-y-1.5 pt-1">
        {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), separateBadgeScaleToUI(ed.defaultSeparateBadgeScale), 50, 150, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX, (v) => { ed.setDefaultSeparateBadgeScale(uiToSeparateBadgeScale(v)) }, () => { ed.setDefaultSeparateBadgeScale(getSeparateBadgeDefaultScale(ed.defaultSeparateRatingsStyle)) }, "seps", "%")}
        <div title={defBarXOff ? t("ui.separateRatingsBarXDisabledHint") : undefined}>
          <fieldset disabled={defBarXOff} className="contents">
            {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultSeparateBadgeOffsetX, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { if (!defBarXOff) ed.setDefaultSeparateBadgeOffsetX(v) }, () => { ed.setDefaultSeparateBadgeOffsetX(0) }, "sepsox", "px", 1)}
          </fieldset>
        </div>
        {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultSeparateBadgeOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultSeparateBadgeOffsetY(v) }, () => { ed.setDefaultSeparateBadgeOffsetY(0) }, "sepsoy", "px", 1)}
        <BadgeItemTransformControls previewUrl={itemPreviewUrl ?? ""} family="separate" shape="poster" className="pt-1.5 border-t border-white/5" />
      </div>
    </div>
  )
  const networkCard = (
    <div {...famAttrs("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium flex items-center gap-1.5">
          <Tv className="w-3.5 h-3.5 text-sky-400" />
          {t("ui.networkLogo")}
        </span>
        <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetNetworkGroup()} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
          {t("ui.reset")}
        </button>
      </div>
      <div className="flex items-center justify-between px-1 gap-2" title={isCardAll ? t("ui.posterLayoutCardControlsNote") : (isCardRanked ? t("ui.posterLayoutCardFallbackNote") : undefined)}>
        <span className="text-zinc-300">{t("ui.followTitleLogo")}</span>
        <Toggle value={followOn} onChange={onFollowChange} label={t("ui.followTitleLogo")} disabled={isCardAll || freezing || (followOn && followOffDisabled)} />
      </div>
      <div className="space-y-1.5 pt-1">
        {slider(<Search className="w-3.5 h-3.5" />, t("ui.scale"), ed.defaultNetworkLogoScale, 50, 150, 10, 200, (v) => { ed.setDefaultNetworkLogoScale(v) }, () => { ed.setDefaultNetworkLogoScale(100) }, "nls", "%")}
        <div title={isCardAll ? t("ui.posterLayoutCardControlsNote") : (isCardRanked ? t("ui.posterLayoutCardFallbackNote") : undefined)} aria-disabled={isCardAll || undefined}>
          <fieldset disabled={isCardAll} className="contents">
            {slider(<ArrowLeftRight className="w-3.5 h-3.5" />, "X", ed.defaultNetworkLogoOffsetX, defOffRangeX.min, defOffRangeX.max, defOffRangeX.boundsMin, defOffRangeX.boundsMax, (v) => { ed.setDefaultNetworkLogoOffsetX(v) }, () => { ed.setDefaultNetworkLogoOffsetX(0) }, "nlx", "px", 1)}
            {slider(<ArrowUpDown className="w-3.5 h-3.5" />, "Y", ed.defaultNetworkLogoOffsetY, defOffRangeY.min, defOffRangeY.max, defOffRangeY.boundsMin, defOffRangeY.boundsMax, (v) => { ed.setDefaultNetworkLogoOffsetY(v) }, () => { ed.setDefaultNetworkLogoOffsetY(0) }, "nly", "px", 1)}
          </fieldset>
        </div>
        {cardNotes()}
      </div>
    </div>
  )
  const gradientCard = (
    <div {...famAttrs("gradient")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
          <Cloud className="w-3.5 h-3.5 text-cyan-400" />
          {t("ui.blurSection")}
        </span>
        <div className="flex items-center gap-2">
          {ed.defaultBlurEnabled && (
            <button type="button" aria-label={t("ui.reset")} onClick={() => resets.resetGradient()} className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer">
              {t("ui.reset")}
            </button>
          )}
          <Toggle value={ed.defaultBlurEnabled} onChange={(v) => ed.setDefaultBlurEnabled(v)} label={t("ui.blurSection")} />
        </div>
      </div>
      {ed.defaultBlurEnabled ? (
        <>
          <GradientPresetRow current={{ gradientHeight: ed.defaultGradientHeight, blurIntensity: ed.defaultBlurIntensity, blurFade: ed.defaultBlurFade, blurDarkness: ed.defaultBlurDarkness, tintStrength: ed.defaultTintStrength, blurEnabled: ed.defaultBlurEnabled }} onApply={(v: GradientPresetValues) => { ed.setDefaultBlurEnabled(true); ed.setDefaultGradientHeight(v.gradientHeight); ed.setDefaultBlurIntensity(v.blurIntensity); ed.setDefaultBlurFade(v.blurFade); ed.setDefaultBlurDarkness(v.blurDarkness); ed.setDefaultTintStrength(v.tintStrength) }} naturalLabel={t("ui.gradientPresetNatural")} colorLabel={t("ui.gradientPresetColor")} neroLabel="Nero" addTitle={t("ui.gradientPresetAdd")} namePlaceholder={t("ui.gradientPresetName")} deleteLabel={t("ui.gradientPresetDelete")} />
          <div className="space-y-1.5 pt-1 animate-fade-in">
            {slider(<Ruler className="w-3.5 h-3.5" />, t("ui.height"), ed.defaultGradientHeight, 5, 100, 5, 100, (v) => { ed.setDefaultGradientHeight(v) }, () => { ed.setDefaultGradientHeight(30) }, "gh", "%")}
            {slider(<Cloud className="w-3.5 h-3.5" />, t("ui.intensity"), ed.defaultBlurIntensity, 1, 100, 1, 100, (v) => { ed.setDefaultBlurIntensity(v) }, () => { ed.setDefaultBlurIntensity(NATURAL_GRADIENT_DEFAULTS.blurIntensity) }, "bi", "px")}
            {slider(<Minus className="w-3.5 h-3.5" />, t("ui.fade"), ed.defaultBlurFade, 0, 100, 0, 100, (v) => { ed.setDefaultBlurFade(v) }, () => { ed.setDefaultBlurFade(NATURAL_GRADIENT_DEFAULTS.blurFade) }, "bf", "%")}
            {slider(<Circle className="w-3.5 h-3.5" />, t("ui.darkness"), ed.defaultBlurDarkness, 0, 100, 0, 100, (v) => { ed.setDefaultBlurDarkness(v) }, () => { ed.setDefaultBlurDarkness(30) }, "bd", "%")}
            {slider(<Cloud className="w-3.5 h-3.5" />, t("ui.tintStrength"), ed.defaultTintStrength, 0, 100, 0, 100, (v) => { ed.setDefaultTintStrength(v) }, () => { ed.setDefaultTintStrength(20) }, "tint", "%")}
            {slider(<Circle className="w-3.5 h-3.5" />, t("ui.topShade"), ed.defaultTopShade, 0, 100, 0, 100, (v) => { ed.setDefaultTopShade(v) }, () => { ed.setDefaultTopShade(50) }, "tsdef", "%")}
            {slider(<Ruler className="w-3.5 h-3.5" />, t("ui.topShadeHeight"), ed.defaultTopShadeHeight, 0, 100, 0, 100, (v) => { ed.setDefaultTopShadeHeight(v) }, () => { ed.setDefaultTopShadeHeight(25) }, "tshdef", "%")}
          </div>
        </>
      ) : (
        <p className="text-[11px] text-zinc-400 italic">{t("ui.blurDisabled")}</p>
      )}
    </div>
  )
  const gated: { key: string; active: boolean; hidden: boolean | undefined; name: string; hintTab: string; testId: string; node: React.ReactNode }[] = [
    { key: "rank", active: rankActive, hidden: hideFor("rank"), name: t("ui.rankFamily"), hintTab: rankTabHint, testId: "transform-geo-rank", node: rankCard },
    { key: "extra", active: extraActive, hidden: hideFor("info"), name: t("ui.sash_extra"), hintTab: rankTabHint, testId: "transform-geo-extra", node: extraCard },
    { key: "meta", active: metaActive, hidden: hideFor("genre"), name: t("ui.genreRatingBadge"), hintTab: tabHint, testId: "transform-geo-meta", node: metaCard },
    { key: "quality", active: qualityActive, hidden: hideFor("quality"), name: t("ui.badgeQuality"), hintTab: tabHint, testId: "transform-geo-quality", node: qualityCard },
    { key: "separate", active: sepActive, hidden: hideFor("ratings", "sources"), name: t("ui.separateRatings"), hintTab: tabHint, testId: "transform-geo-separate", node: separateCard },
    { key: "network", active: netActive, hidden: hideFor("logo"), name: t("ui.networkLogo"), hintTab: tabHint, testId: "transform-geo-network", node: networkCard },
  ]
  // Inactive elements stay completely hidden (user request supersedes the
  // legacy disabled-gate disclosure): enabling in Information/Rankings
  // immediately exposes the applicable geometry; staged values live in the
  // editor context so hiding never resets them.
  const gatedActive = gated.filter((g) => g.active)
  const ordered = orderActiveFirst(gatedActive.map((g) => ({ active: g.active, value: g })))
  return (
    <>
      <div hidden={hideFor("logo")} data-testid="transform-geo-logo">{logoCard}</div>
      {positionCard && <div data-testid="transform-geo-position">{positionCard}</div>}
      {ordered.map((g) => (
        <div key={g.key} hidden={g.hidden}>
          <AvailabilityGate active name={g.name} hint="" testId={g.testId}>
            {g.node}
          </AvailabilityGate>
        </div>
      ))}
      <div hidden={hideFor("background")} data-testid="transform-geo-gradient">{gradientCard}</div>
      <button type="button" onClick={() => resets.resetAllPortrait()} className="w-full py-1.5 rounded-lg text-[11px] font-semibold text-muted hover:text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer">
        {t("ui.reset")} · {t("ui.posterShapePortrait")}
      </button>
    </>
  )
}

/** Trasforma defaults tab (mirrors the editor Transform tab). The portrait /
 *  landscape target is owned by SettingsPanel and arrives as a controlled
 *  `previewShape`: it drives preview + visible section (numbers/gradient on
 *  the existing `land ?? flat` profile), never persisted defaults. The inner
 *  switch renders only when uncontrolled (standalone reuse); hidden when
 *  controlled so duplicate selectors cannot diverge. */
export function TransformPanel({ active, previewShape, onPreviewShapeChange, onPreviewFamilyChange, demoMedia, previewFamily, element, geometryOnly }: {
  active: boolean
  /** Edit-target switch (lifted to SettingsPanel): guides preview + section
   *  only, never the persisted `defaultPosterShape`. Absent = local state
   *  (standalone test/reuse fallback). */
  previewShape?: "portrait" | "landscape"
  onPreviewShapeChange?: (shape: "portrait" | "landscape") => void
  /** Preview-only editing family (owned by SettingsPanel): each numeric group
   *  reports its family on press/focus — text-only state lift, never writes. */
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
  /** Preview-only demo title (SettingsPanel): the freeze reads the same sample
   *  as the displayed defaults preview (exact URL + netgeo, no client recompute). */
  demoMedia?: DefaultsPreviewDemoMedia | null
  /** Family being edited (SettingsPanel): same sample as the preview. */
  previewFamily?: DefaultsPreviewFamily | null
  /** Unified workspace element filter (SettingsPanel): shows only the
   *  geometry groups for the selected element (mounted + hidden, never
   *  unmounted). Absent = legacy full behavior (standalone reuse/tests). */
  element?: PosterElementId | null
  /**
   * Geometry-only presentation (five-tab settings): the separate-ratings
   * style picker moves to its Badge appearance home (never duplicated here),
   * a Position card hosts the network-position control moved from the Badge
   * tab (title-logo alignment is Auto-only, no selector), and gated-off
   * groups render a compact inactive placeholder with a short activate hint
   * instead of vanishing. Absent = legacy standalone behavior unchanged.
   */
  geometryOnly?: boolean
}) {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const resets = useShapeBadgeGeometryDefaults("poster")
  // Portrait/landscape sub-tab (UI only): parent-controlled when `previewShape`
  // is provided (SettingsPanel single selector), local state otherwise.
  const [innerShape, setInnerShape] = useState<"portrait" | "landscape">("portrait")
  const controlled = previewShape !== undefined
  const trasformaShape = previewShape ?? innerShape
  const setTrasformaShape = (shape: "portrait" | "landscape") => {
    setInnerShape(shape)
    onPreviewShapeChange?.(shape)
  }
  const [editVal, setEditVal] = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState("")
  // Separate style follows the same edit target as the Badge tab (shared
  // hook): portrait reads/writes the flat, landscape the profile override.
  const { scoped } = useShapeBadgeDefaults(trasformaShape)
  const [separateRatingsStyle, setSeparateRatingsStyle] = scoped("separateRatingsStyle", ed.defaultSeparateRatingsStyle, ed.setDefaultSeparateRatingsStyle)
  // Stile separati effettivo sui default (bar Orizzontale → pills): la X
  // della barra portrait full-width è disabilitata (mai ghost slider).
  const defSepEff = getSeparateRatingsStyleForShape(
    separateRatingsStyle, trasformaShape === "landscape" ? "landscape" : "poster",
  )
  const defBarXOff = trasformaShape !== "landscape" && defSepEff === "bottom-bar"
  // Rank numerals (`number` style) render on a -20px style baseline: the X
  // slider shows the REAL effective position (stored adjustment + baseline),
  // edits convert back to the stored adjustment (no silent writes — the raw
  // value is preserved and style switches never rewrite it). Reset/dblclick
  // restore the stored 0, i.e. the -20 visual baseline.
  const defTopXBase = ed.defaultRankingBadgeStyle === "number" ? NUMBER_BADGE_BASE_OFFSET_X : 0
  // Badge offset ranges (portrait branch only: landscape renders
  // LandscapeDefaultsSection): full canvas crossing per axis on drag,
  // server contract ±2000 on numeric edit. Default logo offsets share the
  // same ranges; scale/gradient untouched. (Per-title film logo keeps its
  // dynamic logoBounds in TransformControls/context — never this helper.)
  const defOffRangeX = getBadgeOffsetRange("poster", "x")
  const defOffRangeY = getBadgeOffsetRange("poster", "y")
  // Card skins keep their composed slots, but user transforms are live on
  // every layout (explicit user contract): the shared compositor applies the
  // same offsets/scales, neutral values stay byte-identical. No geometry
  // locks, no fixed-layout hints.
  const isCardAllDefaults = false
  const isCardRankedDefaults = false
  const cardControlsNote = undefined
  const cardFallbackNote = undefined
  // Preview-family scope (U2): same helper as the Badge tab — explicit press
  // or keyboard focus reports only (never hover: no flicker/fetch storms),
  // no focus moves, no unmounts.
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  // Unified workspace filter: null = show everything (legacy). Ratings and
  // sources share the separate-ratings geometry; the network card follows
  // the logo element with the title-logo card.
  const hideFor = (...els: PosterElementId[]): boolean | undefined =>
    element ? !els.includes(element) : undefined
  // Global network follow ("Follow the title logo", default ON): same freeze
  // as the per-title card, but on the exact defaults-preview URL being
  // displayed (same builder, same sample, same shape) + netgeo=1. OFF locks
  // the actual top/left + effective post-shrink scale into the flat defaults;
  // ON restores the stashed priors else neutral 0,0 (stored fixed absolutes
  // never re-enter as relative offsets).
  const { freezing: netFreezing, freezeOff: freezeNetworkOff, turnOn: turnNetworkOn } = useNetworkFreeze()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const userId = usePSelector((v) => v.currentUserId)
  const freezeLiveRef = useRef({
    ed, demoMedia: demoMedia ?? null,
    previewShape: trasformaShape,
    previewFamily: previewFamily ?? null,
    tmdbKey, userId, lang,
  })
  freezeLiveRef.current = {
    ed, demoMedia: demoMedia ?? null,
    previewShape: trasformaShape,
    previewFamily: previewFamily ?? null,
    tmdbKey, userId, lang,
  }
  const buildFreezePreview = () => {
    const L = freezeLiveRef.current
    return buildDefaultsPreviewUrlFromEditor(L.ed, {
      tmdbKey: L.tmdbKey,
      userId: L.userId,
      lang: L.lang,
      demoMedia: L.demoMedia,
      previewShape: L.previewShape,
      previewFamily: L.previewFamily,
    })
  }
  const freezePreviewUrl = buildFreezePreview().url
  const portraitFollowOn = ed.defaultNetworkLogoFollowTitle !== false
  const netGeoEnabled = active && trasformaShape === "portrait" && ed.defaultNetworkLogo && portraitFollowOn && !!freezePreviewUrl
  const { geometry: netGeometry, geometryLoading: netGeometryLoading } = useNetworkGeometry(freezePreviewUrl, netGeoEnabled)
  const followOffDisabled = isFollowOffDisabled({
    networkLogo: ed.defaultNetworkLogo,
    hasPreviewUrl: !!freezePreviewUrl,
    hasTitle: true,
    freezing: netFreezing,
    geometryLoading: netGeometryLoading,
    hasGeometry: netGeometry !== null,
  })
  const handleGlobalFollowChange = (v: boolean) => {
    if (v) {
      const neutral = neutralFollowOffsets({ fixed: true })
      turnNetworkOn({
        titleKey: "defaults",
        shape: "poster",
        neutralX: neutral.x,
        neutralY: neutral.y,
        applyOn: ({ follow, offsetX, offsetY }) => {
          ed.setDefaultNetworkLogoFollowTitle(follow)
          ed.setDefaultNetworkLogoOffsetX(offsetX)
          ed.setDefaultNetworkLogoOffsetY(offsetY)
        },
      })
      return
    }
    const built = buildFreezePreview()
    if (!built.url || built.shape !== "poster") return
    void freezeNetworkOff({
      titleKey: "defaults",
      shape: "poster",
      previewUrl: built.url,
      networkLogo: ed.defaultNetworkLogo,
      currentScale: ed.defaultNetworkLogoScale,
      currentOffsetX: ed.defaultNetworkLogoOffsetX,
      currentOffsetY: ed.defaultNetworkLogoOffsetY,
      applyFixed: ({ follow, scale, offsetX, offsetY }) => {
        ed.setDefaultNetworkLogoFollowTitle(follow)
        ed.setDefaultNetworkLogoScale(scale)
        ed.setDefaultNetworkLogoOffsetX(offsetX)
        ed.setDefaultNetworkLogoOffsetY(offsetY)
      },
      getLive: () => {
        const b = buildFreezePreview()
        return { titleKey: "defaults", shape: b.shape, previewUrl: b.url }
      },
    })
  }
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.transform")}
      hidden={!active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Inner switch for uncontrolled use only: SettingsPanel renders the
          single selector above the controls and drives this panel. */}
      {!controlled && (
      <div className="flex gap-1 p-1 rounded-xl bg-black/40 border border-white/10" aria-label={t("ui.transform")}>
        {(["portrait", "landscape"] as const).map((shape) => (
          <button
            key={shape}
            type="button"
            aria-pressed={trasformaShape === shape}
            onClick={() => setTrasformaShape(shape)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
              trasformaShape === shape
                ? "bg-white/15 text-foreground shadow-sm"
                : "text-muted hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            {shape === "portrait" ? t("ui.posterShapePortrait") : t("ui.posterShapeLandscape")}
          </button>
        ))}
      </div>
      )}
      {trasformaShape === "landscape" ? (
        <LandscapeDefaultsSection
          editVal={editVal}
          editTxt={editTxt}
          setEditVal={setEditVal}
          setEditTxt={setEditTxt}
          onPreviewFamilyChange={onPreviewFamilyChange}
          demoMedia={demoMedia}
          previewFamily={previewFamily}
          controlsVisible={active}
          element={element}
          geometryOnly={geometryOnly}
        />
      ) : geometryOnly ? (
        <PortraitEffectiveGeometry editVal={editVal} editTxt={editTxt} setEditVal={setEditVal} setEditTxt={setEditTxt} element={element} onPreviewFamilyChange={onPreviewFamilyChange} followOn={portraitFollowOn} followOffDisabled={followOffDisabled} freezing={netFreezing} onFollowChange={handleGlobalFollowChange} defOffRangeX={defOffRangeX} defOffRangeY={defOffRangeY} defTopXBase={defTopXBase} defBarXOff={defBarXOff} isCardAll={isCardAllDefaults} isCardRanked={isCardRankedDefaults} cardNote={cardControlsNote} fallbackNote={cardFallbackNote} itemPreviewUrl={active && trasformaShape === "portrait" ? buildFreezePreview().url : ""} />
      ) : (
      <>
      {/* Logo Predefinito (null = auto-fit per aspect, storico; esplicito fino a
          200 per il titolo Fresh — correzione c1, richiesto utente). Il max
          segue il layout default EFFETTIVO del Verticale (flat): Fresh 10..200,
          Standard 10..100 invariato. L'auto mostrato segue lo scope effettivo:
          Fresh-all = 100, altrimenti 75 (fallback Standard storico, mai baked). */}
      <div {...famAttrs("logo")} hidden={hideFor("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.logoSection")}
            {ed.defaultLogoScale == null && (
              <span className="text-[10px] font-medium text-muted">· {t("ui.auto")}</span>
            )}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetFamily("logo")}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        {(() => {
          const flatFresh = ed.defaultPosterLayout === "fresh"
          const flatFreshAll = flatFresh && ed.defaultPosterFreshScope === "all"
          const logoMax = flatFresh ? 200 : 100
          const logoShown = ed.defaultLogoScale ?? (flatFreshAll ? 100 : 75)
          return (
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={logoShown}
          min={10}
          max={logoMax}
          boundsMin={10}
          boundsMax={logoMax}
          onChange={(v) => { ed.setDefaultLogoScale(v) }}
          onDoubleClick={() => { ed.setDefaultLogoScale(null) }}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="dlogoScale"
          suffix="%"
        />
          )
        })()}
        <div title={cardControlsNote ?? cardFallbackNote} aria-disabled={isCardAllDefaults || undefined}>
        <fieldset disabled={isCardAllDefaults} className="contents">
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.defaultLogoOffsetX ?? 0}
          min={defOffRangeX.min}
          max={defOffRangeX.max}
          boundsMin={defOffRangeX.boundsMin}
          boundsMax={defOffRangeX.boundsMax}
          step={1}
          onChange={(v) => { ed.setDefaultLogoOffsetX(v) }}
          onDoubleClick={() => { ed.setDefaultLogoOffsetX(null) }}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="dlogoOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.defaultLogoOffsetY ?? 0}
          min={defOffRangeY.min}
          max={defOffRangeY.max}
          boundsMin={defOffRangeY.boundsMin}
          boundsMax={defOffRangeY.boundsMax}
          step={1}
          onChange={(v) => { ed.setDefaultLogoOffsetY(v) }}
          onDoubleClick={() => { ed.setDefaultLogoOffsetY(null) }}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="dlogoOY"
          suffix="px"
        />
        </fieldset>
        </div>
        {isCardAllDefaults && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
        )}
        {isCardRankedDefaults && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
        )}
      </div>
      {/* Network position home (moved from the Badge tab): title-logo
          alignment is Auto-only (no selector). Portrait flat here, landscape
          override in the landscape section. */}
      {geometryOnly && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <span className="text-zinc-200 font-semibold text-xs">{t("ui.position")}</span>
        <div className="space-y-1.5" title={t("ui.networkLogoPosition")}>
          <span className="text-[11px] text-muted font-medium block">{t("ui.networkLogoPosition")}</span>
          {geometryOnly && !ed.defaultNetworkLogo && (
            <p data-testid="transform-netpos-inactive" className="text-[11px] text-zinc-400 italic leading-snug">{t("ui.activateInTabHint", { name: t("ui.networkLogo"), tab: t("ui.settingsTabInformation") })}</p>
          )}
          <fieldset disabled={geometryOnly && !ed.defaultNetworkLogo} className="contents">
          <div className="flex gap-1">
            {(["auto", "top"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => ed.setDefaultNetworkLogoPosition(pos)}
                aria-pressed={ed.defaultNetworkLogoPosition === pos}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                  ed.defaultNetworkLogoPosition === pos
                    ? "bg-white/20 text-foreground shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
              </button>
            ))}
          </div>
          </fieldset>
        </div>
      </div>
      )}
      {!ed.defaultRankingBadges && geometryOnly && (
        <TransformInactive name={t("ui.rankFamily")} tab={t("ui.settingsTabRankings")} />
      )}
      {/* Badge Classifica Predefinito */}
      {ed.defaultRankingBadges && (
      <div {...famAttrs("rank")} hidden={hideFor("rank")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("ui.rankFamily")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetFamily("rank")}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1" title={cardControlsNote ?? cardFallbackNote}>
        <fieldset disabled={isCardAllDefaults} className="contents">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={ed.defaultTopBadgeScale}
            min={50}
            max={150}
            boundsMin={10}
            boundsMax={200}
            onChange={(v) => {
              ed.setDefaultTopBadgeScale(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultTopBadgeScale(100)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="tbs"
            suffix="%"
          />
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultTopBadgeOffsetX + defTopXBase}
            min={defOffRangeX.min + defTopXBase}
            max={defOffRangeX.max + defTopXBase}
            boundsMin={defOffRangeX.boundsMin + defTopXBase}
            boundsMax={defOffRangeX.boundsMax + defTopXBase}
            step={1}
            onChange={(v) => {
              ed.setDefaultTopBadgeOffsetX(v - defTopXBase)
            }}
            onDoubleClick={() => {
              ed.setDefaultTopBadgeOffsetX(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="tbx"
            suffix="px"
          />
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultTopBadgeOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultTopBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultTopBadgeOffsetY(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="tby"
            suffix="px"
          />
        </fieldset>
        </div>
        {isCardAllDefaults && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
        )}
        {isCardRankedDefaults && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
        )}
      </div>
      )}

      {!ed.defaultRankingBadges && geometryOnly && (
        <TransformInactive name={t("ui.sash_extra")} tab={t("ui.settingsTabRankings")} />
      )}
      {/* Badge Extra Predefinito (indipendente dalla classifica; reset = segui) */}
      {ed.defaultRankingBadges && (
      <div {...famAttrs("info")} hidden={hideFor("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            {t("ui.sash_extra")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetFamily("extra")}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={ed.defaultExtraBadgeScale ?? ed.defaultTopBadgeScale}
            min={50}
            max={150}
            boundsMin={10}
            boundsMax={200}
            onChange={(v) => {
              ed.setDefaultExtraBadgeScale(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultExtraBadgeScale(null)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="exs"
            suffix="%"
          />
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultExtraBadgeOffsetX ?? ed.defaultTopBadgeOffsetX}
            min={defOffRangeX.min}
            max={defOffRangeX.max}
            boundsMin={defOffRangeX.boundsMin}
            boundsMax={defOffRangeX.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultExtraBadgeOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultExtraBadgeOffsetX(null)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="exx"
            suffix="px"
          />
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultExtraBadgeOffsetY ?? ed.defaultTopBadgeOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultExtraBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultExtraBadgeOffsetY(null)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="exy"
            suffix="px"
          />
        </div>
      </div>
      )}

      {!ed.defaultGlobalBadges && geometryOnly && (
        <TransformInactive name={t("ui.genreRatingBadge")} tab={t("ui.settingsTabInformation")} />
      )}
      {/* Badge Genere Predefinito */}
      {ed.defaultGlobalBadges && (
      <div {...famAttrs("genre")} hidden={hideFor("genre")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.genreRatingBadge")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetFamily("genre")}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={ed.defaultGenreBadgeScale}
            min={50}
            max={150}
            boundsMin={10}
            boundsMax={200}
            onChange={(v) => {
              ed.setDefaultGenreBadgeScale(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultGenreBadgeScale(100)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="gbs"
            suffix="%"
          />
          <div title={cardControlsNote ?? cardFallbackNote} aria-disabled={isCardAllDefaults || undefined}>
          <fieldset disabled={isCardAllDefaults} className="contents">
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultGenreBadgeOffsetX}
            min={defOffRangeX.min}
            max={defOffRangeX.max}
            boundsMin={defOffRangeX.boundsMin}
            boundsMax={defOffRangeX.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultGenreBadgeOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultGenreBadgeOffsetX(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="gbx"
            suffix="px"
          />
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultGenreBadgeOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultGenreBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultGenreBadgeOffsetY(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="gby"
            suffix="px"
          />
          </fieldset>
          </div>
          {isCardAllDefaults && (
            <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
          )}
          {isCardRankedDefaults && (
            <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
          )}
        </div>
      </div>
      )}

      {!ed.defaultBadgeQuality && geometryOnly && (
        <TransformInactive name={t("ui.badgeQuality")} tab={t("ui.settingsTabInformation")} />
      )}
      {/* Badge Qualità Predefinito */}
      {ed.defaultBadgeQuality && (
      <div {...famAttrs("quality")} hidden={hideFor("quality")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.badgeQuality")}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t("ui.badgeGroupRejoin")}
                    title={t("ui.badgeRejoinHint")}
                    data-testid="badge-group-rejoin-quality"
                    onClick={() => resets.rejoin({ families: ["quality"] })}
                    className="text-xs text-sky-200 hover:text-white transition-colors px-2 py-0.5 rounded-md border border-sky-300/40 hover:border-sky-300">
              {t("ui.badgeGroupRejoin")}
            </button>
            <button type="button" aria-label={t("ui.reset")}
                    onClick={() => resets.resetFamily("quality")}
                    className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
              {t("ui.reset")}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={ed.defaultQualityBadgeScale}
            min={50}
            max={150}
            boundsMin={10}
            boundsMax={200}
            onChange={(v) => {
              ed.setDefaultQualityBadgeScale(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultQualityBadgeScale(100)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="qbs"
            suffix="%"
          />
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultQualityBadgeOffsetX}
            min={defOffRangeX.min}
            max={defOffRangeX.max}
            boundsMin={defOffRangeX.boundsMin}
            boundsMax={defOffRangeX.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultQualityBadgeOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultQualityBadgeOffsetX(DEFAULT_QUALITY_BADGE_OFFSET_X)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="qbx"
            suffix="px"
          />
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultQualityBadgeOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultQualityBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultQualityBadgeOffsetY(DEFAULT_QUALITY_BADGE_OFFSET_Y)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="qby"
            suffix="px"
          />
        </div>
      </div>
      )}

      {!(ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings) && geometryOnly && (
        <TransformInactive name={t("ui.separateRatings")} tab={t("ui.settingsTabInformation")} />
      )}
      {/* Rating Separati Predefiniti (scala relativa UI + offset gruppo) */}
      {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && (
      <div {...famAttrs("ratings")} hidden={hideFor("ratings", "sources")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.separateRatings")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetFamily("separate")}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={separateBadgeScaleToUI(ed.defaultSeparateBadgeScale)}
            min={50}
            max={150}
            boundsMin={SEPARATE_BADGE_SCALE_UI_MIN}
            boundsMax={SEPARATE_BADGE_SCALE_UI_MAX}
            onChange={(v) => {
              ed.setDefaultSeparateBadgeScale(uiToSeparateBadgeScale(v))
            }}
            onDoubleClick={() => {
              ed.setDefaultSeparateBadgeScale(getSeparateBadgeDefaultScale(ed.defaultSeparateRatingsStyle))
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="seps"
            suffix="%"
          />
          <div title={defBarXOff ? t("ui.separateRatingsBarXDisabledHint") : undefined}>
          <fieldset disabled={defBarXOff} className="contents">
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultSeparateBadgeOffsetX}
            min={defOffRangeX.min}
            max={defOffRangeX.max}
            boundsMin={defOffRangeX.boundsMin}
            boundsMax={defOffRangeX.boundsMax}
            step={1}
            onChange={(v) => {
              if (!defBarXOff) ed.setDefaultSeparateBadgeOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultSeparateBadgeOffsetX(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="sepsox"
            suffix="px"
          />
          </fieldset>
          </div>
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultSeparateBadgeOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultSeparateBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultSeparateBadgeOffsetY(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="sepsoy"
            suffix="px"
          />
        </div>

        {/* Separate style picker lives in Badge content (appearance home)
            in unified element mode — geometry only here. Standalone keeps
            the picker (legacy behavior unchanged). Five-tab geometry mode
            never duplicates it here. */}
        {!element && !geometryOnly && (
        <div className="space-y-1.5 pt-1" title={t("ui.separateRatingsHint")}>
          <span className="text-[11px] text-muted font-medium block">{t("ui.separateRatingsStyle")}</span>
          <div className="grid grid-cols-3 gap-1">
            {([
              { id: "column", labelKey: "ui.separateRatingsColumn" },
              { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
              { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
              { id: "bottom-mono", labelKey: "ui.separateRatingsBottomMono" },
              { id: "bottom-color", labelKey: "ui.separateRatingsBottomColor" },
            ] as const).map((opt) => {
              // Portrait target always allows the bar (landscape normalizes
              // it to pills); the raw value is kept, never hidden.
              const barOff = false
              const pressed = getSeparateRatingsStyleForShape(
                separateRatingsStyle, "poster",
              ) === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { if (!barOff) setSeparateRatingsStyle(opt.id) }}
                  aria-pressed={pressed}
                  disabled={barOff}
                  title={barOff ? t("ui.separateRatingsBarLandscapeHint") : undefined}
                  className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 ${
                    pressed
                      ? "bg-white/20 text-white shadow-sm"
                      : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                  } ${barOff ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {t(opt.labelKey)}
                </button>
              )
            })}
          </div>
          {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && isBottomSeparateRatingsStyle(separateRatingsStyle) && (
            <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBottomHint")}</p>
          )}
        </div>
        )}
      </div>
      )}

      {!ed.defaultNetworkLogo && geometryOnly && (
        <TransformInactive name={t("ui.networkLogo")} tab={t("ui.settingsTabInformation")} />
      )}
      {/* Logo Network Predefinito */}
      {ed.defaultNetworkLogo && (
      <div {...famAttrs("logo")} hidden={hideFor("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-sky-400" />
            {t("ui.networkLogo")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => resets.resetNetworkGroup()}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <div className="flex items-center justify-between px-1 gap-2" title={cardControlsNote ?? cardFallbackNote}>
          <span className="text-zinc-300">{t("ui.followTitleLogo")}</span>
          <Toggle
            value={portraitFollowOn}
            onChange={handleGlobalFollowChange}
            label={t("ui.followTitleLogo")}
            disabled={isCardAllDefaults || netFreezing || (portraitFollowOn && followOffDisabled)}
          />
        </div>

        <div className="space-y-1.5 pt-1">
          <SliderRow
            icon={<Search className="w-3.5 h-3.5" />}
            label={t("ui.scale")}
            value={ed.defaultNetworkLogoScale}
            min={50}
            max={150}
            boundsMin={10}
            boundsMax={200}
            onChange={(v) => {
              ed.setDefaultNetworkLogoScale(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultNetworkLogoScale(100)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="nls"
            suffix="%"
          />
          <div title={cardControlsNote ?? cardFallbackNote} aria-disabled={isCardAllDefaults || undefined}>
          <fieldset disabled={isCardAllDefaults} className="contents">
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultNetworkLogoOffsetX}
            min={defOffRangeX.min}
            max={defOffRangeX.max}
            boundsMin={defOffRangeX.boundsMin}
            boundsMax={defOffRangeX.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultNetworkLogoOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultNetworkLogoOffsetX(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="nlx"
            suffix="px"
          />
          <SliderRow
            icon={<ArrowUpDown className="w-3.5 h-3.5" />}
            label="Y"
            value={ed.defaultNetworkLogoOffsetY}
            min={defOffRangeY.min}
            max={defOffRangeY.max}
            boundsMin={defOffRangeY.boundsMin}
            boundsMax={defOffRangeY.boundsMax}
            step={1}
            onChange={(v) => {
              ed.setDefaultNetworkLogoOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultNetworkLogoOffsetY(0)
            }}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey="nly"
            suffix="px"
          />
          </fieldset>
          </div>
          {isCardAllDefaults && (
            <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
          )}
          {isCardRankedDefaults && (
            <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
          )}
        </div>
      </div>
      )}

      {/* Sfumatura & Blur Predefiniti */}
      <div {...famAttrs("gradient")} hidden={hideFor("background")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            {t("ui.blurSection")}
          </span>
          <div className="flex items-center gap-2">
            {ed.defaultBlurEnabled && (
              <button type="button" aria-label={t("ui.reset")}
                      onClick={() => resets.resetGradient()}
                      className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer">
                {t("ui.reset")}
              </button>
            )}
            <Toggle
              value={ed.defaultBlurEnabled}
              onChange={(v) => ed.setDefaultBlurEnabled(v)}
              label={t("ui.blurSection")}
            />
          </div>
        </div>

        {ed.defaultBlurEnabled ? (
          <>

        <GradientPresetRow
          current={{ gradientHeight: ed.defaultGradientHeight, blurIntensity: ed.defaultBlurIntensity, blurFade: ed.defaultBlurFade, blurDarkness: ed.defaultBlurDarkness, tintStrength: ed.defaultTintStrength, blurEnabled: ed.defaultBlurEnabled }}
          onApply={(v: GradientPresetValues) => {
            ed.setDefaultBlurEnabled(true)
            ed.setDefaultGradientHeight(v.gradientHeight)
            ed.setDefaultBlurIntensity(v.blurIntensity)
            ed.setDefaultBlurFade(v.blurFade)
            ed.setDefaultBlurDarkness(v.blurDarkness)
            ed.setDefaultTintStrength(v.tintStrength)
          }}
          naturalLabel={t("ui.gradientPresetNatural")}
          colorLabel={t("ui.gradientPresetColor")}
          neroLabel="Nero"
          addTitle={t("ui.gradientPresetAdd")}
          namePlaceholder={t("ui.gradientPresetName")}
          deleteLabel={t("ui.gradientPresetDelete")}
        />

        <div className="space-y-1.5 pt-1 animate-fade-in">
            <SliderRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label={t("ui.height")}
              value={ed.defaultGradientHeight}
              min={5}
              max={100}
              boundsMin={5}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultGradientHeight(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultGradientHeight(30)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="gh"
              suffix="%"
            />
            <SliderRow
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t("ui.intensity")}
              value={ed.defaultBlurIntensity}
              min={1}
              max={100}
              boundsMin={1}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultBlurIntensity(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultBlurIntensity(NATURAL_GRADIENT_DEFAULTS.blurIntensity)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="bi"
              suffix="px"
            />
            <SliderRow
              icon={<Minus className="w-3.5 h-3.5" />}
              label={t("ui.fade")}
              value={ed.defaultBlurFade}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultBlurFade(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultBlurFade(NATURAL_GRADIENT_DEFAULTS.blurFade)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="bf"
              suffix="%"
            />
            <SliderRow
              icon={<Circle className="w-3.5 h-3.5" />}
              label={t("ui.darkness")}
              value={ed.defaultBlurDarkness}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultBlurDarkness(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultBlurDarkness(30)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="bd"
              suffix="%"
            />
            <SliderRow
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t("ui.tintStrength")}
              value={ed.defaultTintStrength}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultTintStrength(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultTintStrength(20)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="tint"
              suffix="%"
            />
            <SliderRow
              icon={<Circle className="w-3.5 h-3.5" />}
              label={t("ui.topShade")}
              value={ed.defaultTopShade}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultTopShade(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultTopShade(50)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="tsdef"
              suffix="%"
            />
            <SliderRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label={t("ui.topShadeHeight")}
              value={ed.defaultTopShadeHeight}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => {
                ed.setDefaultTopShadeHeight(v)
              }}
              onDoubleClick={() => {
                ed.setDefaultTopShadeHeight(25)
              }}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="tshdef"
              suffix="%"
            />
          </div>
          </>
        ) : (
          <p className="text-[11px] text-zinc-400 italic">
            {t("ui.blurDisabled")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => resets.resetAllPortrait()}
        className="w-full py-1.5 rounded-lg text-[11px] font-semibold text-muted hover:text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
      >
        {t("ui.reset")} · {t("ui.posterShapePortrait")}
      </button>
      </>
      )}
    </div>
  )
}
