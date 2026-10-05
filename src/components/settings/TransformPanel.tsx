"use client"

import { useState } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { SliderRow } from "@/components/SliderRow"
import { Toggle } from "@/components/Toggle"
import { isBottomSeparateRatingsStyle, getSeparateBadgeDefaultScale, getSeparateRatingsStyleForShape, separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX } from "@/lib/badge-styles"
import { NATURAL_GRADIENT_DEFAULTS, type GradientPresetValues } from "@/lib/gradient-presets"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import { LandscapeDefaultsSection } from "@/components/LandscapeDefaultsSection"
import { ArrowLeftRight, ArrowUpDown, Circle, Cloud, Image as ImageIcon, Minus, Ruler, Search, Sparkles, Star, Trophy, Tv } from "lucide-react"

/** Scheda Trasforma default (specchio del tab Trasforma dell'editor). Estratta da SettingsPanel con il suo stato locale: nessun prop tranne `active`. */
export function TransformPanel({ active }: { active: boolean }) {
  const { t } = useT()
  const ed = usePosterEditor()
  // Sotto-tab Verticale/Orizzontale (solo UI).
  const [trasformaShape, setTrasformaShape] = useState<"portrait" | "landscape">("portrait")
  const [editVal, setEditVal] = useState<string | null>(null)
  const [editTxt, setEditTxt] = useState("")
  // Stile separati effettivo sui default (bar Orizzontale → pills): la X
  // della barra portrait full-width è disabilitata (mai ghost slider).
  const defSepEff = getSeparateRatingsStyleForShape(
    ed.defaultSeparateRatingsStyle, ed.defaultPosterShape === "landscape" ? "landscape" : "poster",
  )
  const defBarXOff = ed.defaultPosterShape !== "landscape" && defSepEff === "bottom-bar"
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.transform")}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
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
      {trasformaShape === "landscape" ? (
        <LandscapeDefaultsSection
          editVal={editVal}
          editTxt={editTxt}
          setEditVal={setEditVal}
          setEditTxt={setEditTxt}
        />
      ) : (
      <>
      {/* Logo Predefinito (null = auto-fit per aspect, storico) */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.logoSection")}
            {ed.defaultLogoScale == null && (
              <span className="text-[10px] font-medium text-muted">· {t("ui.auto")}</span>
            )}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => { ed.setDefaultLogoScale(null); ed.setDefaultLogoOffsetX(null); ed.setDefaultLogoOffsetY(null) }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={ed.defaultLogoScale ?? 75}
          min={10}
          max={100}
          boundsMin={10}
          boundsMax={100}
          onChange={(v) => { ed.setDefaultLogoScale(v) }}
          onDoubleClick={() => { ed.setDefaultLogoScale(null) }}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="dlogoScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={ed.defaultLogoOffsetX ?? 0}
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
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
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => { ed.setDefaultLogoOffsetY(v) }}
          onDoubleClick={() => { ed.setDefaultLogoOffsetY(null) }}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="dlogoOY"
          suffix="px"
        />
      </div>
      {/* Badge Superiore Predefinito */}
      {ed.defaultRankingBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("ui.topBadge")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultTopBadgeScale(100)
                    ed.setDefaultTopBadgeOffsetX(0)
                    ed.setDefaultTopBadgeOffsetY(0)
                  }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
        </div>

        <div className="space-y-1.5 pt-1">
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
            value={ed.defaultTopBadgeOffsetX}
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
            onChange={(v) => {
              ed.setDefaultTopBadgeOffsetX(v)
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
        </div>
      </div>
      )}

      {/* Badge Genere Predefinito */}
      {ed.defaultGlobalBadges && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.genreRatingBadge")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultGenreBadgeScale(100)
                    ed.setDefaultGenreBadgeOffsetX(0)
                    ed.setDefaultGenreBadgeOffsetY(0)
                  }}
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
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultGenreBadgeOffsetX}
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
        </div>
      </div>
      )}

      {/* Badge Qualità Predefinito */}
      {ed.defaultBadgeQuality && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.badgeQuality")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultQualityBadgeScale(100)
                    ed.setDefaultQualityBadgeOffsetX(0)
                    ed.setDefaultQualityBadgeOffsetY(0)
                  }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
            onChange={(v) => {
              ed.setDefaultQualityBadgeOffsetX(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultQualityBadgeOffsetX(0)
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
            onChange={(v) => {
              ed.setDefaultQualityBadgeOffsetY(v)
            }}
            onDoubleClick={() => {
              ed.setDefaultQualityBadgeOffsetY(0)
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

      {/* Rating Separati Predefiniti (scala relativa UI + offset gruppo) */}
      {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.separateRatings")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultSeparateBadgeScale(getSeparateBadgeDefaultScale(ed.defaultSeparateRatingsStyle))
                    ed.setDefaultSeparateBadgeOffsetX(0)
                    ed.setDefaultSeparateBadgeOffsetY(0)
                  }}
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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

        <div className="space-y-1.5 pt-1" title={t("ui.separateRatingsHint")}>
          <span className="text-[11px] text-muted font-medium block">{t("ui.separateRatingsStyle")}</span>
          <div className="flex gap-1">
            {([
              { id: "column", labelKey: "ui.separateRatingsColumn" },
              { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
              { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
            ] as const).map((opt) => {
              // Come il selettore per-titolo: barra disattivata col formato
              // Orizzontale di default (raw conservato, mai nascosta).
              const barOff = opt.id === "bottom-bar" && ed.defaultPosterShape === "landscape"
              const pressed = getSeparateRatingsStyleForShape(
                ed.defaultSeparateRatingsStyle, ed.defaultPosterShape === "landscape" ? "landscape" : "poster",
              ) === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { if (!barOff) ed.setDefaultSeparateRatingsStyle(opt.id) }}
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
          {ed.defaultPosterShape === "landscape" && (
            <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBarLandscapeHint")}</p>
          )}
          {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && isBottomSeparateRatingsStyle(ed.defaultSeparateRatingsStyle) && (
            <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBottomHint")}</p>
          )}
        </div>
      </div>
      )}

      {/* Logo Network Predefinito */}
      {ed.defaultNetworkLogo && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-sky-400" />
            {t("ui.networkLogo")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultNetworkLogoScale(100)
                    ed.setDefaultNetworkLogoOffsetX(0)
                    ed.setDefaultNetworkLogoOffsetY(0)
                  }}
                  className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
            {t("ui.reset")}
          </button>
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
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={ed.defaultNetworkLogoOffsetX}
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
            min={-100}
            max={100}
            boundsMin={-500}
            boundsMax={500}
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
        </div>
      </div>
      )}

      {/* Sfumatura & Blur Predefiniti */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            {t("ui.blurSection")}
          </span>
          <div className="flex items-center gap-2">
            {ed.defaultBlurEnabled && (
              <button type="button" aria-label={t("ui.reset")}
                      onClick={() => {
                        ed.setDefaultGradientHeight(NATURAL_GRADIENT_DEFAULTS.gradientHeight)
                        ed.setDefaultBlurIntensity(NATURAL_GRADIENT_DEFAULTS.blurIntensity)
                        ed.setDefaultBlurFade(NATURAL_GRADIENT_DEFAULTS.blurFade)
                        ed.setDefaultBlurDarkness(NATURAL_GRADIENT_DEFAULTS.blurDarkness)
                        ed.setDefaultTintStrength(NATURAL_GRADIENT_DEFAULTS.tintStrength)
                      }}
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
        onClick={() => {
          ed.setDefaultTopBadgeScale(100)
          ed.setDefaultTopBadgeOffsetX(0)
          ed.setDefaultTopBadgeOffsetY(0)
          ed.setDefaultGenreBadgeScale(100)
          ed.setDefaultGenreBadgeOffsetX(0)
          ed.setDefaultGenreBadgeOffsetY(0)
          ed.setDefaultQualityBadgeScale(100)
          ed.setDefaultQualityBadgeOffsetX(0)
          ed.setDefaultQualityBadgeOffsetY(0)
          ed.setDefaultNetworkLogoScale(100)
          ed.setDefaultNetworkLogoOffsetX(0)
          ed.setDefaultNetworkLogoOffsetY(0)
          ed.setDefaultBlurEnabled(true)
          ed.setDefaultGradientHeight(NATURAL_GRADIENT_DEFAULTS.gradientHeight)
          ed.setDefaultBlurIntensity(NATURAL_GRADIENT_DEFAULTS.blurIntensity)
          ed.setDefaultBlurFade(NATURAL_GRADIENT_DEFAULTS.blurFade)
          ed.setDefaultBlurDarkness(NATURAL_GRADIENT_DEFAULTS.blurDarkness)
          ed.setDefaultTintStrength(NATURAL_GRADIENT_DEFAULTS.tintStrength)
          ed.setDefaultTopShade(50)
        }}
        className="w-full py-1.5 rounded-lg text-[11px] font-semibold text-muted hover:text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
      >
        {t("ui.reset")} · {t("ui.posterShapePortrait")}
      </button>
      </>
      )}
    </div>
  )
}
