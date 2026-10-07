"use client"

import { useState } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { SliderRow } from "@/components/SliderRow"
import { Toggle } from "@/components/Toggle"
import { isBottomSeparateRatingsStyle, getSeparateBadgeDefaultScale, getSeparateRatingsStyleForShape, separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX, DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y, NUMBER_BADGE_BASE_OFFSET_X } from "@/lib/badge-styles"
import { NATURAL_GRADIENT_DEFAULTS, type GradientPresetValues } from "@/lib/gradient-presets"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import { LandscapeDefaultsSection } from "@/components/LandscapeDefaultsSection"
import { useShapeBadgeDefaults } from "@/components/settings/useShapeDefaults"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import { ArrowLeftRight, ArrowUpDown, Circle, Cloud, Image as ImageIcon, Minus, Ruler, Search, Sparkles, Star, Trophy, Tv } from "lucide-react"
import { getBadgeOffsetRange } from "@/lib/badge-offset-ranges"

/** Trasforma defaults tab (mirrors the editor Transform tab). The portrait /
 *  landscape target is owned by SettingsPanel and arrives as a controlled
 *  `previewShape`: it drives preview + visible section (numbers/gradient on
 *  the existing `land ?? flat` profile), never persisted defaults. The inner
 *  switch renders only when uncontrolled (standalone reuse); hidden when
 *  controlled so duplicate selectors cannot diverge. */
export function TransformPanel({ active, previewShape, onPreviewShapeChange, onPreviewFamilyChange }: {
  active: boolean
  /** Edit-target switch (lifted to SettingsPanel): guides preview + section
   *  only, never the persisted `defaultPosterShape`. Absent = local state
   *  (standalone test/reuse fallback). */
  previewShape?: "portrait" | "landscape"
  onPreviewShapeChange?: (shape: "portrait" | "landscape") => void
  /** Preview-only editing family (owned by SettingsPanel): each numeric group
   *  reports its family on press/focus — text-only state lift, never writes. */
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
}) {
  const { t } = useT()
  const ed = usePosterEditor()
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
  // Preview-family scope (U2): same helper as the Badge tab — explicit press
  // or keyboard focus reports only (never hover: no flicker/fetch storms),
  // no focus moves, no unmounts.
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.transform")}
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
        />
      ) : (
      <>
      {/* Logo Predefinito (null = auto-fit per aspect, storico) */}
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
      </div>
      {/* Badge Superiore Predefinito */}
      {ed.defaultRankingBadges && (
      <div {...famAttrs("rank")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
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
        </div>
      </div>
      )}

      {/* Badge Genere Predefinito */}
      {ed.defaultGlobalBadges && (
      <div {...famAttrs("genre")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
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
        </div>
      </div>
      )}

      {/* Badge Qualità Predefinito */}
      {ed.defaultBadgeQuality && (
      <div {...famAttrs("quality")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.badgeQuality")}
          </span>
          <button type="button" aria-label={t("ui.reset")}
                  onClick={() => {
                    ed.setDefaultQualityBadgeScale(100)
                    ed.setDefaultQualityBadgeOffsetX(DEFAULT_QUALITY_BADGE_OFFSET_X)
                    ed.setDefaultQualityBadgeOffsetY(DEFAULT_QUALITY_BADGE_OFFSET_Y)
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

      {/* Rating Separati Predefiniti (scala relativa UI + offset gruppo) */}
      {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && (
      <div {...famAttrs("ratings")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
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
      </div>
      )}

      {/* Logo Network Predefinito */}
      {ed.defaultNetworkLogo && (
      <div {...famAttrs("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
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
        </div>
      </div>
      )}

      {/* Sfumatura & Blur Predefiniti */}
      <div {...famAttrs("gradient")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
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
          ed.setDefaultQualityBadgeOffsetX(DEFAULT_QUALITY_BADGE_OFFSET_X)
          ed.setDefaultQualityBadgeOffsetY(DEFAULT_QUALITY_BADGE_OFFSET_Y)
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
