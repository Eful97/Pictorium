"use client"

import { useState } from "react"
import { Search, ArrowLeftRight, ArrowUpDown, Ruler, Cloud, Minus, Circle, Trophy, Star, Sparkles, Tv, Image as ImageIcon } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { logoDefaultScale } from "@/lib/logo-selection"
import { defaultGradientHeightForPoster } from "@/lib/gradient-defaults"
import { SliderRow } from "@/components/SliderRow"

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

  return (
    <div className="space-y-3.5 text-xs">
      {selectedLogo && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.logoSection")}
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
            {t("ui.topBadge")}
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
            {t("ui.genreRatingBadge")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setGenreBadgeScale(ed.defaultGenreBadgeScale) }}
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
      </div>
      )}

      {ed.badgeQuality && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.badgeQuality")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setQualityBadgeScale(ed.defaultQualityBadgeScale) }}
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
      </div>
      )}

      {ed.networkLogo && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-sky-400" />
            {t("ui.networkLogo")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setNetworkLogoScale(ed.defaultNetworkLogoScale) }}
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
      </div>
      )}

      {ed.blurEnabled && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            {t("ui.blurSection")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setGradientHeight(defaultGradientHeightForPoster(previewPoster)); ed.setBlurIntensity(5); ed.setBlurFade(60); ed.setBlurDarkness(40) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1 animate-fade-in">
            <SliderRow
              icon={<Ruler className="w-3.5 h-3.5" />}
              label={t("ui.height")}
              value={ed.gradientHeight}
              min={5}
              max={100}
              boundsMin={5}
              boundsMax={100}
              onChange={(v) => ed.setGradientHeight(v)}
              onDoubleClick={() => ed.setGradientHeight(defaultGradientHeightForPoster(previewPoster))}
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
              value={ed.blurIntensity}
              min={1}
              max={50}
              boundsMin={1}
              boundsMax={50}
              onChange={(v) => ed.setBlurIntensity(v)}
              onDoubleClick={() => ed.setBlurIntensity(5)}
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
              value={ed.blurFade}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => ed.setBlurFade(v)}
              onDoubleClick={() => ed.setBlurFade(60)}
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
              value={ed.blurDarkness}
              min={0}
              max={100}
              boundsMin={0}
              boundsMax={100}
              onChange={(v) => ed.setBlurDarkness(v)}
              onDoubleClick={() => ed.setBlurDarkness(40)}
              editingValue={editingValue}
              editText={editText}
              setEditingValue={setEditingValue}
              setEditText={setEditText}
              editingKey="blurDarkness"
              suffix="%"
            />
          </div>
      </div>
      )}
    </div>
  )
}
