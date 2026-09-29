"use client"

import { useState } from "react"
import { Search, ArrowLeftRight, ArrowUpDown, Ruler, Cloud, Minus, Circle, Trophy, Star, Sparkles, Tv, Image as ImageIcon } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { logoDefaultScale } from "@/lib/logo-selection"
import { defaultGradientHeightForPoster } from "@/lib/gradient-defaults"
import { naturalGradientForPoster } from "@/lib/gradient-presets"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import { SliderRow } from "@/components/SliderRow"
import type { LandscapeBlurState } from "@/lib/contexts/PosterEditorContext"

export function TransformControls() {
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const logoBounds = usePSelector((v) => v.logoBounds)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const { t } = useT()
  const ed = usePosterEditor()
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
  const isLandShape = ed.posterShape === "landscape"
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
        <SliderRow icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Y" value={ed.logoOffsetY} min={logoBounds.minY} max={logoBounds.maxY} boundsMin={logoBounds.minX} boundsMax={logoBounds.maxY} onChange={ed.setLogoOffsetY} onDoubleClick={() => ed.setLogoOffsetY(0)} editingValue={editingValue} editText={editText} setEditingValue={setEditingValue} setEditText={setEditText} editingKey="oy" />
      </div>
      )}

      {ed.rankingBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("ui.topBadge")} · {isLandShape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setTopBadgeScale(ed.defaultTopBadgeScale); ed.setTopBadgeOffsetX(ed.defaultTopBadgeOffsetX); ed.setTopBadgeOffsetY(ed.defaultTopBadgeOffsetY) }}
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
            onDoubleClick={() => ed.setTopBadgeScale(ed.defaultTopBadgeScale)}
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
          value={ed.topBadgeOffsetX}
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
            onChange={(v) => ed.setTopBadgeOffsetX(v)}
            onDoubleClick={() => ed.setTopBadgeOffsetX(ed.defaultTopBadgeOffsetX)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
            onChange={(v) => ed.setTopBadgeOffsetY(v)}
            onDoubleClick={() => ed.setTopBadgeOffsetY(ed.defaultTopBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="topBadgeOY"
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
                  onClick={() => { ed.setGenreBadgeScale(ed.defaultGenreBadgeScale); ed.setGenreBadgeOffsetX(ed.defaultGenreBadgeOffsetX); ed.setGenreBadgeOffsetY(ed.defaultGenreBadgeOffsetY) }}
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
          onDoubleClick={() => ed.setGenreBadgeScale(ed.defaultGenreBadgeScale)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setGenreBadgeOffsetX(v)}
          onDoubleClick={() => ed.setGenreBadgeOffsetX(ed.defaultGenreBadgeOffsetX)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setGenreBadgeOffsetY(v)}
          onDoubleClick={() => ed.setGenreBadgeOffsetY(ed.defaultGenreBadgeOffsetY)}
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
                  onClick={() => { ed.setQualityBadgeScale(ed.defaultQualityBadgeScale); ed.setQualityBadgeOffsetX(ed.defaultQualityBadgeOffsetX); ed.setQualityBadgeOffsetY(ed.defaultQualityBadgeOffsetY) }}
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
          onDoubleClick={() => ed.setQualityBadgeScale(ed.defaultQualityBadgeScale)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setQualityBadgeOffsetX(v)}
          onDoubleClick={() => ed.setQualityBadgeOffsetX(ed.defaultQualityBadgeOffsetX)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setQualityBadgeOffsetY(v)}
          onDoubleClick={() => ed.setQualityBadgeOffsetY(ed.defaultQualityBadgeOffsetY)}
          editingValue={editingValue}
          editText={editText}
          setEditingValue={setEditingValue}
          setEditText={setEditText}
          editingKey="qualityOY"
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
                  onClick={() => { ed.setNetworkLogoScale(ed.defaultNetworkLogoScale); ed.setNetworkLogoOffsetX(ed.defaultNetworkLogoOffsetX); ed.setNetworkLogoOffsetY(ed.defaultNetworkLogoOffsetY) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
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
          onDoubleClick={() => ed.setNetworkLogoScale(ed.defaultNetworkLogoScale)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setNetworkLogoOffsetX(v)}
          onDoubleClick={() => ed.setNetworkLogoOffsetX(ed.defaultNetworkLogoOffsetX)}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => ed.setNetworkLogoOffsetY(v)}
          onDoubleClick={() => ed.setNetworkLogoOffsetY(ed.defaultNetworkLogoOffsetY)}
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
