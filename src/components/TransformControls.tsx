"use client"

import { useState, useRef } from "react"
import { Search, ArrowLeftRight, ArrowUpDown, Ruler, Cloud, Minus, Circle, Trophy, Star, Sparkles, Tv, Image as ImageIcon } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import { isFollowOffDisabled, neutralFollowOffsets } from "@/lib/network-freeze"
import { useNetworkFreeze } from "@/lib/useNetworkFreeze"
import { useNetworkGeometry } from "@/lib/useNetworkGeometry"
import { resolveNetworkShapeView } from "@/lib/network-follow"
import { logoDefaultScale } from "@/lib/logo-selection"
import { defaultGradientHeightForPoster } from "@/lib/gradient-defaults"
import { naturalGradientForPoster } from "@/lib/gradient-presets"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import { SliderRow } from "@/components/SliderRow"
import { resolveSeparateBadgeScaleFallback, separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX, getSeparateRatingsStyleForShape, NUMBER_BADGE_BASE_OFFSET_X } from "@/lib/badge-styles"
import { getBadgeOffsetRange } from "@/lib/badge-offset-ranges"
import type { LandscapeBlurState } from "@/lib/contexts/PosterEditorContext"

export function TransformControls() {
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const logoBounds = usePSelector((v) => v.logoBounds)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const previewUrl = usePSelector((v) => v.previewUrl)
  const selected = usePSelector((v) => v.selected)
  const { t } = useT()
  const ed = usePosterEditor()
  const { freezing, freezeOff, turnOn } = useNetworkFreeze()
  const isLandShape = ed.posterShape === "landscape"
  // Live snapshot for the freeze stale guard (title/shape/URL at response
  // time, never the click-time ones).
  const liveRef = useRef({ titleKey: "", shape: "poster", previewUrl: "" })
  const titleKey = selected ? `${selected.media_type}:${selected.id}` : ""
  liveRef.current = {
    titleKey,
    shape: ed.posterShape,
    previewUrl: previewUrl || "",
  }
  // B1: editingValue/editText LOCALI (prima nel context condiviso → ri-render di
  // tutti i consumer a ogni tasto). Come in BadgeControls/SettingsPanel.
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editText, setEditText] = useState("")

  const defaultLogoScale = () => {
    const l = selectedLogo
    if (!l) { ed.setLogoScale(75); return }
    ed.setLogoScale(logoDefaultScale(l) ?? 75)
  }

  // Preset sfumatura: scorciatoie che scrivono gli slider esistenti (nessun
  // nuovo parametro server — la preview/Stremio ricevono gli stessi valori).
  // La sezione segue il formato in editing: in landscape scrive il profilo
  // Orizzontale (landscapeBlur, sfumatura completa di tinta e ombra),
  // in portrait i flat.
  const land = ed.landscapeBlur
  interface GradVals {
    gradientHeight: number
    blurIntensity: number
    blurFade: number
    blurDarkness: number
    tintStrength: number
    topShade: number
    blurEnabled: boolean
  }
  const gradVals: GradVals = isLandShape
    ? {
        gradientHeight: land.gradientHeight,
        blurIntensity: land.blurIntensity,
        blurFade: land.blurFade,
        blurDarkness: land.blurDarkness,
        tintStrength: land.tintStrength,
        topShade: land.topShade,
        blurEnabled: land.blurEnabled,
      }
    : {
        gradientHeight: ed.gradientHeight,
        blurIntensity: ed.blurIntensity,
        blurFade: ed.blurFade,
        blurDarkness: ed.blurDarkness,
        tintStrength: ed.tintStrength,
        topShade: ed.topShade,
        blurEnabled: ed.blurEnabled,
      }
  const setGradVals = (v: Partial<GradVals>) => {
    if (isLandShape) {
      const patch: Partial<LandscapeBlurState> = {}
      if (v.gradientHeight !== undefined) patch.gradientHeight = v.gradientHeight
      if (v.blurIntensity !== undefined) patch.blurIntensity = v.blurIntensity
      if (v.blurFade !== undefined) patch.blurFade = v.blurFade
      if (v.blurDarkness !== undefined) patch.blurDarkness = v.blurDarkness
      if (v.tintStrength !== undefined) patch.tintStrength = v.tintStrength
      if (v.topShade !== undefined) patch.topShade = v.topShade
      if (v.blurEnabled !== undefined) patch.blurEnabled = v.blurEnabled
      if (Object.keys(patch).length > 0) ed.setLandscapeBlur(patch)
    } else {
      if (v.blurEnabled !== undefined) ed.setBlurEnabled(v.blurEnabled)
      if (v.gradientHeight !== undefined) ed.setGradientHeight(v.gradientHeight)
      if (v.blurIntensity !== undefined) ed.setBlurIntensity(v.blurIntensity)
      if (v.blurFade !== undefined) ed.setBlurFade(v.blurFade)
      if (v.blurDarkness !== undefined) ed.setBlurDarkness(v.blurDarkness)
      if (v.tintStrength !== undefined) ed.setTintStrength(v.tintStrength)
      if (v.topShade !== undefined) ed.setTopShade(v.topShade)
    }
  }
  const naturalVals = naturalGradientForPoster(previewPoster, ed.posterShape)
  // X slider shows the effective position when Number is selected (stored
  // adjustment + render baseline); edits convert back to the stored
  // adjustment (raw preserved, style switches never rewrite it). The rendered
  // badge type is unknown here (rank vs extra with legacy fallback), so this
  // is a style-level presentation mapping only.
  const topXBase = ed.rankingBadgeStyle === "number" ? NUMBER_BADGE_BASE_OFFSET_X : 0
  // Badge offset drag ranges: full canvas crossing per axis/shape (slider),
  // server contract ±2000 (numeric edit). Film-logo sliders keep their
  // dynamic logoBounds; scale/gradient sliders are untouched.
  const offRangeX = getBadgeOffsetRange(ed.posterShape, "x")
  const offRangeY = getBadgeOffsetRange(ed.posterShape, "y")
  // Follow network ("Follow the title logo", default ON): OFF freezes the
  // actually composed geometry (debug fetch on the exact preview URL, never
  // a client recompute) and writes actual top/left + effective post-shrink
  // scale into the sliders; ON restores the priors or neutral offsets.
  // Title+shape key + live-URL guard against stale responses. OFF stays
  // disabled until the shared geometry prefetch proves the network box is
  // actually rendered (same URL the freeze reads, debounced).
  const geoEnabled = ed.networkLogo && ed.networkLogoFollowTitle && !!previewUrl && !!selected
  const { geometry: netGeometry, geometryLoading: netGeometryLoading } = useNetworkGeometry(previewUrl || "", geoEnabled)
  const followOffDisabled = isFollowOffDisabled({
    networkLogo: ed.networkLogo,
    hasPreviewUrl: !!previewUrl,
    hasTitle: !!selected,
    freezing,
    geometryLoading: netGeometryLoading,
    hasGeometry: netGeometry !== null,
  })
  const handleFollowChange = (v: boolean) => {
    if (v) {
      // Stash miss (e.g. reload with fixed absolutes stored): neutral 0,0 —
      // stored fixed coords must never re-enter as relative offsets.
      const neutral = neutralFollowOffsets({
        fixed: !ed.networkLogoFollowTitle || ed.defaultNetworkLogoFollowTitle === false,
        relativeX: ed.defaultNetworkLogoOffsetX,
        relativeY: ed.defaultNetworkLogoOffsetY,
      })
      turnOn({
        titleKey,
        shape: isLandShape ? "landscape" : "poster",
        neutralX: neutral.x,
        neutralY: neutral.y,
        applyOn: ({ follow, offsetX, offsetY }) => {
          ed.setNetworkLogoFollowTitle(follow)
          ed.setNetworkLogoOffsetX(offsetX)
          ed.setNetworkLogoOffsetY(offsetY)
        },
      })
      return
    }
    if (!titleKey) return
    void freezeOff({
      titleKey,
      shape: isLandShape ? "landscape" : "poster",
      previewUrl,
      networkLogo: ed.networkLogo,
      currentScale: ed.networkLogoScale,
      currentOffsetX: ed.networkLogoOffsetX,
      currentOffsetY: ed.networkLogoOffsetY,
      applyFixed: ({ follow, scale, offsetX, offsetY }) => {
        ed.setNetworkLogoFollowTitle(follow)
        ed.setNetworkLogoScale(scale)
        ed.setNetworkLogoOffsetX(offsetX)
        ed.setNetworkLogoOffsetY(offsetY)
      },
      getLive: () => ({ ...liveRef.current }),
    })
  }
  // Stile separati effettivo sul canvas corrente (bar landscape → pills):
  // la X della barra portrait full-width è disabilitata (mai ghost slider).
  const sepEffStyle = getSeparateRatingsStyleForShape(
    ed.separateRatingsStyle, isLandShape ? "landscape" : "poster",
  )
  const sepBarXOff = !isLandShape && sepEffStyle === "bottom-bar"
  const resetSeparate = () => {
    ed.setSeparateBadgeScale(resolveSeparateBadgeScaleFallback({ explicit: isLandShape ? ed.landscape.separateBadgeScale : undefined, defaultScale: ed.defaultSeparateBadgeScale, defaultStyle: ed.defaultSeparateRatingsStyle, style: ed.separateRatingsStyle }))
    ed.setSeparateBadgeOffsetX(isLandShape ? (ed.landscape.separateBadgeOffsetX ?? ed.defaultSeparateBadgeOffsetX) : ed.defaultSeparateBadgeOffsetX)
    ed.setSeparateBadgeOffsetY(isLandShape ? (ed.landscape.separateBadgeOffsetY ?? ed.defaultSeparateBadgeOffsetY) : ed.defaultSeparateBadgeOffsetY)
  }
  const applyGradientPreset = (v: typeof naturalVals) => {
    setGradVals({
      blurEnabled: true,
      gradientHeight: v.gradientHeight,
      blurIntensity: v.blurIntensity,
      blurFade: v.blurFade,
      blurDarkness: v.blurDarkness,
      tintStrength: v.tintStrength,
    })
  }

  return (
    <div className="space-y-3.5 text-xs">
      {selectedLogo && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.logoSection")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { defaultLogoScale(); ed.setLogoOffsetX(0); ed.setLogoOffsetY(0) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow icon={<Search className="w-3.5 h-3.5" />} label={t("ui.scale")} value={ed.logoScale} min={10} max={100} boundsMin={10} boundsMax={100} onChange={ed.setLogoScale} onDoubleClick={defaultLogoScale} editingValue={editingValue} editText={editText} setEditingValue={setEditingValue} setEditText={setEditText} editingKey="scale" />
        <SliderRow icon={<ArrowLeftRight className="w-3.5 h-3.5" />} label="X" value={ed.logoOffsetX} min={logoBounds.minX} max={logoBounds.maxX} boundsMin={logoBounds.minX} boundsMax={logoBounds.maxX} onChange={ed.setLogoOffsetX} onDoubleClick={() => ed.setLogoOffsetX(0)} editingValue={editingValue} editText={editText} setEditingValue={setEditingValue} setEditText={setEditText} editingKey="ox" />
        <SliderRow icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Y" value={ed.logoOffsetY} min={logoBounds.minY} max={logoBounds.maxY} boundsMin={logoBounds.minY} boundsMax={logoBounds.maxY} onChange={ed.setLogoOffsetY} onDoubleClick={() => ed.setLogoOffsetY(0)} editingValue={editingValue} editText={editText} setEditingValue={setEditingValue} setEditText={setEditText} editingKey="oy" />
      </div>
      )}

      {ed.rankingBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("ui.rankFamily")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { const land = ed.landscape; ed.setTopBadgeScale(isLandShape ? (land.topBadgeScale ?? ed.defaultTopBadgeScale) : ed.defaultTopBadgeScale); ed.setTopBadgeOffsetX(isLandShape ? (land.topBadgeOffsetX ?? ed.defaultTopBadgeOffsetX) : ed.defaultTopBadgeOffsetX); ed.setTopBadgeOffsetY(isLandShape ? (land.topBadgeOffsetY ?? ed.defaultTopBadgeOffsetY) : ed.defaultTopBadgeOffsetY) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.topBadgeScale}
          min={50}
          max={150}
          boundsMin={10}
          boundsMax={200}
            onChange={(v) => ed.setTopBadgeScale(v)}
            onDoubleClick={() => ed.setTopBadgeScale(isLandShape ? (ed.landscape.topBadgeScale ?? ed.defaultTopBadgeScale) : ed.defaultTopBadgeScale)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="topBadgeScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.topBadgeOffsetX + topXBase}
          min={offRangeX.min + topXBase}
          max={offRangeX.max + topXBase}
          boundsMin={offRangeX.boundsMin + topXBase}
          boundsMax={offRangeX.boundsMax + topXBase}
          step={1}
            onChange={(v) => ed.setTopBadgeOffsetX(v - topXBase)}
            onDoubleClick={() => ed.setTopBadgeOffsetX(isLandShape ? (ed.landscape.topBadgeOffsetX ?? ed.defaultTopBadgeOffsetX) : ed.defaultTopBadgeOffsetX)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="topBadgeOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.topBadgeOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
            onChange={(v) => ed.setTopBadgeOffsetY(v)}
            onDoubleClick={() => ed.setTopBadgeOffsetY(isLandShape ? (ed.landscape.topBadgeOffsetY ?? ed.defaultTopBadgeOffsetY) : ed.defaultTopBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="topBadgeOY"
          suffix="px"
        />
      </div>
      )}

      {ed.rankingBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            {t("ui.sash_extra")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setExtraBadgeScale(null); ed.setExtraBadgeOffsetX(null); ed.setExtraBadgeOffsetY(null) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.extraBadgeScale ?? ed.defaultExtraBadgeScale ?? ed.topBadgeScale}
          min={50}
          max={150}
          boundsMin={10}
          boundsMax={200}
            onChange={(v) => ed.setExtraBadgeScale(v)}
            onDoubleClick={() => ed.setExtraBadgeScale(null)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="extraScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.extraBadgeOffsetX ?? ed.defaultExtraBadgeOffsetX ?? ed.topBadgeOffsetX}
          min={offRangeX.min}
          max={offRangeX.max}
          boundsMin={offRangeX.boundsMin}
          boundsMax={offRangeX.boundsMax}
          step={1}
            onChange={(v) => ed.setExtraBadgeOffsetX(v)}
            onDoubleClick={() => ed.setExtraBadgeOffsetX(null)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="extraOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.extraBadgeOffsetY ?? ed.defaultExtraBadgeOffsetY ?? ed.topBadgeOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
            onChange={(v) => ed.setExtraBadgeOffsetY(v)}
            onDoubleClick={() => ed.setExtraBadgeOffsetY(null)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="extraOY"
          suffix="px"
        />
      </div>
      )}

      {ed.globalBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.genreRatingBadge")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { const land = ed.landscape; ed.setGenreBadgeScale(isLandShape ? (land.genreBadgeScale ?? ed.defaultGenreBadgeScale) : ed.defaultGenreBadgeScale); ed.setGenreBadgeOffsetX(isLandShape ? (land.genreBadgeOffsetX ?? ed.defaultGenreBadgeOffsetX) : ed.defaultGenreBadgeOffsetX); ed.setGenreBadgeOffsetY(isLandShape ? (land.genreBadgeOffsetY ?? ed.defaultGenreBadgeOffsetY) : ed.defaultGenreBadgeOffsetY) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.genreBadgeScale}
          min={50}
          max={150}
          boundsMin={10}
          boundsMax={200}
          onChange={(v) => ed.setGenreBadgeScale(v)}
          onDoubleClick={() => ed.setGenreBadgeScale(isLandShape ? (ed.landscape.genreBadgeScale ?? ed.defaultGenreBadgeScale) : ed.defaultGenreBadgeScale)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="genreScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.genreBadgeOffsetX}
          min={offRangeX.min}
          max={offRangeX.max}
          boundsMin={offRangeX.boundsMin}
          boundsMax={offRangeX.boundsMax}
          step={1}
          onChange={(v) => ed.setGenreBadgeOffsetX(v)}
          onDoubleClick={() => ed.setGenreBadgeOffsetX(isLandShape ? (ed.landscape.genreBadgeOffsetX ?? ed.defaultGenreBadgeOffsetX) : ed.defaultGenreBadgeOffsetX)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="genreOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.genreBadgeOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
          onChange={(v) => ed.setGenreBadgeOffsetY(v)}
          onDoubleClick={() => ed.setGenreBadgeOffsetY(isLandShape ? (ed.landscape.genreBadgeOffsetY ?? ed.defaultGenreBadgeOffsetY) : ed.defaultGenreBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="genreOY"
          suffix="px"
        />
      </div>
      )}

      {ed.badgeQuality && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.badgeQuality")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { const land = ed.landscape; ed.setQualityBadgeScale(isLandShape ? (land.qualityBadgeScale ?? ed.defaultQualityBadgeScale) : ed.defaultQualityBadgeScale); ed.setQualityBadgeOffsetX(isLandShape ? (land.qualityBadgeOffsetX ?? ed.defaultQualityBadgeOffsetX) : ed.defaultQualityBadgeOffsetX); ed.setQualityBadgeOffsetY(isLandShape ? (land.qualityBadgeOffsetY ?? ed.defaultQualityBadgeOffsetY) : ed.defaultQualityBadgeOffsetY) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.qualityBadgeScale}
          min={50}
          max={150}
          boundsMin={10}
          boundsMax={200}
          onChange={(v) => ed.setQualityBadgeScale(v)}
          onDoubleClick={() => ed.setQualityBadgeScale(isLandShape ? (ed.landscape.qualityBadgeScale ?? ed.defaultQualityBadgeScale) : ed.defaultQualityBadgeScale)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="qualityScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.qualityBadgeOffsetX}
          min={offRangeX.min}
          max={offRangeX.max}
          boundsMin={offRangeX.boundsMin}
          boundsMax={offRangeX.boundsMax}
          step={1}
          onChange={(v) => ed.setQualityBadgeOffsetX(v)}
          onDoubleClick={() => ed.setQualityBadgeOffsetX(isLandShape ? (ed.landscape.qualityBadgeOffsetX ?? ed.defaultQualityBadgeOffsetX) : ed.defaultQualityBadgeOffsetX)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="qualityOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.qualityBadgeOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
          onChange={(v) => ed.setQualityBadgeOffsetY(v)}
          onDoubleClick={() => ed.setQualityBadgeOffsetY(isLandShape ? (ed.landscape.qualityBadgeOffsetY ?? ed.defaultQualityBadgeOffsetY) : ed.defaultQualityBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="qualityOY"
          suffix="px"
        />
      </div>
      )}

      {ed.globalBadges && ed.badgeRating && ed.separateRatings && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.separateRatings")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={resetSeparate}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={separateBadgeScaleToUI(ed.separateBadgeScale)}
          min={50}
          max={150}
          boundsMin={SEPARATE_BADGE_SCALE_UI_MIN}
          boundsMax={SEPARATE_BADGE_SCALE_UI_MAX}
          onChange={(v) => ed.setSeparateBadgeScale(uiToSeparateBadgeScale(v))}
          onDoubleClick={() => ed.setSeparateBadgeScale(resolveSeparateBadgeScaleFallback({ explicit: isLandShape ? ed.landscape.separateBadgeScale : undefined, defaultScale: ed.defaultSeparateBadgeScale, defaultStyle: ed.defaultSeparateRatingsStyle, style: ed.separateRatingsStyle }))}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="separateScale"
          suffix="%"
        />
        <div title={sepBarXOff ? t("ui.separateRatingsBarXDisabledHint") : undefined}>
        <fieldset disabled={sepBarXOff} className="contents">
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.separateBadgeOffsetX}
          min={offRangeX.min}
          max={offRangeX.max}
          boundsMin={offRangeX.boundsMin}
          boundsMax={offRangeX.boundsMax}
          step={1}
          onChange={(v) => { if (!sepBarXOff) ed.setSeparateBadgeOffsetX(v) }}
          onDoubleClick={() => ed.setSeparateBadgeOffsetX(isLandShape ? (ed.landscape.separateBadgeOffsetX ?? ed.defaultSeparateBadgeOffsetX) : ed.defaultSeparateBadgeOffsetX)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="separateOX"
          suffix="px"
        />
        </fieldset>
        </div>
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.separateBadgeOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
          onChange={(v) => ed.setSeparateBadgeOffsetY(v)}
          onDoubleClick={() => ed.setSeparateBadgeOffsetY(isLandShape ? (ed.landscape.separateBadgeOffsetY ?? ed.defaultSeparateBadgeOffsetY) : ed.defaultSeparateBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="separateOY"
          suffix="px"
        />
      </div>
      )}

      {ed.networkLogo && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-sky-400" />
            {t("ui.networkLogo")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { const land = ed.landscape; const netView = resolveNetworkShapeView({ networkLogoFollowTitle: ed.defaultNetworkLogoFollowTitle, networkLogoOffsetX: ed.defaultNetworkLogoOffsetX, networkLogoOffsetY: ed.defaultNetworkLogoOffsetY }, land, isLandShape ? "landscape" : "poster"); ed.setNetworkLogoScale(isLandShape ? (land.networkLogoScale ?? ed.defaultNetworkLogoScale) : ed.defaultNetworkLogoScale); ed.setNetworkLogoOffsetX(netView.follow ? netView.relativeX : (netView.fixedX ?? 0)); ed.setNetworkLogoOffsetY(netView.follow ? netView.relativeY : (netView.fixedY ?? 0)); ed.setNetworkLogoFollowTitle(netView.follow) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <div className="flex items-center justify-between px-1 gap-2">
          <span className="text-zinc-300">{t("ui.followTitleLogo")}</span>
          <Toggle
            value={ed.networkLogoFollowTitle}
            onChange={handleFollowChange}
            label={t("ui.followTitleLogo")}
            disabled={freezing || (ed.networkLogoFollowTitle && followOffDisabled)}
          />
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.networkLogoScale}
          min={50}
          max={150}
          boundsMin={10}
          boundsMax={200}
          onChange={(v) => ed.setNetworkLogoScale(v)}
          onDoubleClick={() => ed.setNetworkLogoScale(isLandShape ? (ed.landscape.networkLogoScale ?? ed.defaultNetworkLogoScale) : ed.defaultNetworkLogoScale)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="networkScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.networkLogoOffsetX}
          min={offRangeX.min}
          max={offRangeX.max}
          boundsMin={offRangeX.boundsMin}
          boundsMax={offRangeX.boundsMax}
          step={1}
          onChange={(v) => ed.setNetworkLogoOffsetX(v)}
          onDoubleClick={() => ed.setNetworkLogoOffsetX(isLandShape ? (ed.landscape.networkLogoOffsetX ?? ed.defaultNetworkLogoOffsetX) : ed.defaultNetworkLogoOffsetX)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="networkOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={ed.networkLogoOffsetY}
          min={offRangeY.min}
          max={offRangeY.max}
          boundsMin={offRangeY.boundsMin}
          boundsMax={offRangeY.boundsMax}
          step={1}
          onChange={(v) => ed.setNetworkLogoOffsetY(v)}
          onDoubleClick={() => ed.setNetworkLogoOffsetY(isLandShape ? (ed.landscape.networkLogoOffsetY ?? ed.defaultNetworkLogoOffsetY) : ed.defaultNetworkLogoOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="networkOY"
          suffix="px"
        />
      </div>
      )}

      {gradVals.blurEnabled && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            {t("ui.blurSection")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => applyGradientPreset(naturalVals)}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <GradientPresetRow
          current={{ gradientHeight: gradVals.gradientHeight, blurIntensity: gradVals.blurIntensity, blurFade: gradVals.blurFade, blurDarkness: gradVals.blurDarkness, tintStrength: gradVals.tintStrength, blurEnabled: gradVals.blurEnabled }}
          onApply={applyGradientPreset}
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
              value={gradVals.gradientHeight}
              min={5}
              max={100}
              boundsMin={5}
              boundsMax={100}
              onChange={(v) => setGradVals({ gradientHeight: v })}
              onDoubleClick={() => setGradVals({ gradientHeight: defaultGradientHeightForPoster(previewPoster) })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="gradHeight"
              suffix="%"
            />
            <SliderRow
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t("ui.intensity")}
              value={gradVals.blurIntensity}
              min={1}
              max={100}
              boundsMin={1}
              boundsMax={100}
              onChange={(v) => setGradVals({ blurIntensity: v })}
              onDoubleClick={() => setGradVals({ blurIntensity: 20 })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="blurIntensity"
              suffix="px"
            />
            <SliderRow
              icon={<Minus className="w-3.5 h-3.5" />}
              label={t("ui.fade")}
              value={gradVals.blurFade}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => setGradVals({ blurFade: v })}
              onDoubleClick={() => setGradVals({ blurFade: isLandShape ? 70 : 50 })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="blurFade"
              suffix="%"
            />
            <SliderRow
              icon={<Circle className="w-3.5 h-3.5" />}
              label={t("ui.darkness")}
              value={gradVals.blurDarkness}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => setGradVals({ blurDarkness: v })}
              onDoubleClick={() => setGradVals({ blurDarkness: 30 })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="blurDarkness"
              suffix="%"
            />
            <SliderRow
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t("ui.tintStrength")}
              value={gradVals.tintStrength}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => setGradVals({ tintStrength: v })}
              onDoubleClick={() => setGradVals({ tintStrength: 20 })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="tintStrength"
              suffix="%"
            />
            <SliderRow
              icon={<Circle className="w-3.5 h-3.5" />}
              label={t("ui.topShade")}
              value={gradVals.topShade}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => setGradVals({ topShade: v })}
              onDoubleClick={() => setGradVals({ topShade: 50 })}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="topShade"
              suffix="%"
            />
          </div>
      </div>
      )}
    </div>
  )
}
