"use client"

import {
  Star,
  Trophy,
  Cloud,
  Minus,
  Circle,
  Ruler,
  Sparkles,
  Tv,
  Search,
  ArrowLeftRight,
  ArrowUpDown,
  Image as ImageIcon,
  X,
} from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { SliderRow } from "@/components/SliderRow"
import { Toggle } from "@/components/Toggle"
import { separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX } from "@/lib/badge-styles"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import type { GradientPresetValues } from "@/lib/gradient-presets"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"

interface Props {
  editVal: string | null
  editTxt: string
  setEditVal: (v: string | null) => void
  setEditTxt: (v: string) => void
}

type LandKey = keyof LandscapeServerDefaults

/**
 * Sezione default Orizzontale (profilo `landscape` dei default server):
 * sfumatura completa (altezza/intensità/fade/darkness/tinta/ombra) + scale e
 * offset dei badge — gli stessi parametri del Verticale. Stili, toggle, tinta
 * no: quelli restano condivisi (flat). Ogni riga mostra il valore effettivo
 * (override landscape ?? flat portrait): modificare imposta l'override, il
 * reset ✕ (o doppio click) torna a seguire il portrait. Nessun parametro
 * URL/chiave cache: il server risolve dal profilo salvato (già coperto da
 * firma defaults e sd-hash).
 */
export function LandscapeDefaultsSection({ editVal, editTxt, setEditVal, setEditTxt }: Props) {
  const { t } = useT()
  const ed = usePosterEditor()
  const land = ed.landscape
  const set = (patch: Partial<LandscapeServerDefaults>) => ed.setLandscape(patch)
  const clear = (key: LandKey) => ed.setLandscape({ [key]: undefined } as Partial<LandscapeServerDefaults>)
  const isOver = (key: LandKey) => land[key] !== undefined
  const resetLabel = t("ui.reset")
  const enabled = land.blurEnabled ?? ed.defaultBlurEnabled

  const applyPreset = (v: GradientPresetValues) => {
    set({
      blurEnabled: true,
      gradientHeight: v.gradientHeight,
      blurIntensity: v.blurIntensity,
      blurFade: v.blurFade,
      blurDarkness: v.blurDarkness,
      tintStrength: v.tintStrength,
    })
  }

  const gradSlider = (
    label: string,
    icon: React.ReactNode,
    key: Extract<LandKey, "gradientHeight" | "blurIntensity" | "blurFade" | "blurDarkness" | "tintStrength" | "topShade">,
    flat: number,
    min: number,
    max: number,
    suffix: string,
    editingKey: string,
  ) => (
    <SliderRow
      icon={icon}
      label={label}
      value={land[key] ?? flat}
      min={min}
      max={max}
      boundsMin={min}
      boundsMax={max}
      onChange={(v) => set({ [key]: v } as Partial<LandscapeServerDefaults>)}
      onDoubleClick={() => clear(key)}
      editingValue={editVal}
      editText={editTxt}
      setEditingValue={setEditVal}
      setEditText={setEditTxt}
      editingKey={editingKey}
      suffix={suffix}
    />
  )

  const scaleGroup = (
    title: string,
    icon: React.ReactNode,
    sKey: Extract<LandKey, "topBadgeScale" | "genreBadgeScale" | "qualityBadgeScale" | "networkLogoScale">,
    xKey: Extract<LandKey, "topBadgeOffsetX" | "genreBadgeOffsetX" | "qualityBadgeOffsetX" | "networkLogoOffsetX">,
    yKey: Extract<LandKey, "topBadgeOffsetY" | "genreBadgeOffsetY" | "qualityBadgeOffsetY" | "networkLogoOffsetY">,
    flatS: number,
    flatX: number,
    flatY: number,
    prefix: string,
  ) => (
    <div className="space-y-1.5" key={prefix}>
      <div className="flex items-center justify-between px-1">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {(isOver(sKey) || isOver(xKey) || isOver(yKey)) && (
          <button
            type="button"
            title={resetLabel}
            aria-label={resetLabel}
            onClick={() => set({ [sKey]: undefined, [xKey]: undefined, [yKey]: undefined } as Partial<LandscapeServerDefaults>)}
            className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
          >
            {resetLabel}
          </button>
        )}
      </div>
      <SliderRow
        icon={<Search className="w-3.5 h-3.5" />}
        label={t("ui.scale")}
        value={land[sKey] ?? flatS}
        min={50}
        max={150}
        boundsMin={10}
        boundsMax={200}
        onChange={(v) => set({ [sKey]: v } as Partial<LandscapeServerDefaults>)}
        onDoubleClick={() => clear(sKey)}
        editingValue={editVal}
        editText={editTxt}
        setEditingValue={setEditVal}
        setEditText={setEditTxt}
        editingKey={`${prefix}Scale`}
        suffix="%"
      />
      <SliderRow
        icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
        label="X"
        value={land[xKey] ?? flatX}
        min={-100}
        max={100}
        boundsMin={-500}
        boundsMax={500}
        onChange={(v) => set({ [xKey]: v } as Partial<LandscapeServerDefaults>)}
        onDoubleClick={() => clear(xKey)}
        editingValue={editVal}
        editText={editTxt}
        setEditingValue={setEditVal}
        setEditText={setEditTxt}
        editingKey={`${prefix}OX`}
        suffix="px"
      />
      <SliderRow
        icon={<ArrowUpDown className="w-3.5 h-3.5" />}
        label="Y"
        value={land[yKey] ?? flatY}
        min={-100}
        max={100}
        boundsMin={-500}
        boundsMax={500}
        onChange={(v) => set({ [yKey]: v } as Partial<LandscapeServerDefaults>)}
        onDoubleClick={() => clear(yKey)}
        editingValue={editVal}
        editText={editTxt}
        setEditingValue={setEditVal}
        setEditText={setEditTxt}
        editingKey={`${prefix}OY`}
        suffix="px"
      />
    </div>
  )

  return (
    <div className="space-y-3.5">
      <p className="text-[11px] text-zinc-400 italic">{t("ui.landscapeDefaultsHint")}</p>

      {/* Logo: stessa card del Verticale (doppio click = segui) */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.logoSection")}
            {(land.logoScale ?? ed.defaultLogoScale) == null && (
              <span className="text-[10px] font-medium text-muted">· {t("ui.auto")}</span>
            )}
          </span>
          {(isOver("logoScale") || isOver("logoOffsetX") || isOver("logoOffsetY")) && (
            <button
              type="button"
              title={resetLabel}
              aria-label={resetLabel}
              onClick={() => set({ logoScale: undefined, logoOffsetX: undefined, logoOffsetY: undefined })}
              className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
            >
              {resetLabel}
            </button>
          )}
        </div>
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={land.logoScale ?? ed.defaultLogoScale ?? 75}
          min={10}
          max={100}
          boundsMin={10}
          boundsMax={100}
          onChange={(v) => set({ logoScale: v })}
          onDoubleClick={() => clear("logoScale")}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="lslogoScale"
          suffix="%"
        />
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={land.logoOffsetX ?? ed.defaultLogoOffsetX ?? 0}
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => set({ logoOffsetX: v })}
          onDoubleClick={() => clear("logoOffsetX")}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="lslogoOX"
          suffix="px"
        />
        <SliderRow
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          label="Y"
          value={land.logoOffsetY ?? ed.defaultLogoOffsetY ?? 0}
          min={-100}
          max={100}
          boundsMin={-500}
          boundsMax={500}
          onChange={(v) => set({ logoOffsetY: v })}
          onDoubleClick={() => clear("logoOffsetY")}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="lslogoOY"
          suffix="px"
        />
      </div>

      {/* Stesso ordine del Verticale: badge superiore, genere, qualità,
          network — sfumatura per ultima. */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        {scaleGroup(t("ui.topBadge"), <Trophy className="w-3.5 h-3.5 text-amber-500" />, "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY", ed.defaultTopBadgeScale, ed.defaultTopBadgeOffsetX, ed.defaultTopBadgeOffsetY, "lst")}
        <hr className="border-surface2/50" />
        {scaleGroup(t("ui.genreRatingBadge"), <Star className="w-3.5 h-3.5 text-amber-400" />, "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY", ed.defaultGenreBadgeScale, ed.defaultGenreBadgeOffsetX, ed.defaultGenreBadgeOffsetY, "lsg")}
        <hr className="border-surface2/50" />
        {scaleGroup(t("ui.badgeQuality"), <Sparkles className="w-3.5 h-3.5 text-purple-400" />, "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY", ed.defaultQualityBadgeScale, ed.defaultQualityBadgeOffsetX, ed.defaultQualityBadgeOffsetY, "lsq")}
        {ed.defaultGlobalBadges && ed.defaultBadgeRating && ed.defaultSeparateRatings && (
          <>
            <hr className="border-surface2/50" />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  {t("ui.separateRatings")}
                </span>
                {(isOver("separateBadgeScale") || isOver("separateBadgeOffsetX") || isOver("separateBadgeOffsetY")) && (
                  <button
                    type="button"
                    title={resetLabel}
                    aria-label={resetLabel}
                    onClick={() => set({ separateBadgeScale: undefined, separateBadgeOffsetX: undefined, separateBadgeOffsetY: undefined })}
                    className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
                  >
                    {resetLabel}
                  </button>
                )}
              </div>
              <SliderRow
                icon={<Search className="w-3.5 h-3.5" />}
                label={t("ui.scale")}
                value={separateBadgeScaleToUI(land.separateBadgeScale ?? ed.defaultSeparateBadgeScale)}
                min={50}
                max={150}
                boundsMin={SEPARATE_BADGE_SCALE_UI_MIN}
                boundsMax={SEPARATE_BADGE_SCALE_UI_MAX}
                onChange={(v) => set({ separateBadgeScale: uiToSeparateBadgeScale(v) })}
                onDoubleClick={() => clear("separateBadgeScale")}
                editingValue={editVal}
                editText={editTxt}
                setEditingValue={setEditVal}
                setEditText={setEditTxt}
                editingKey="lssepsScale"
                suffix="%"
              />
              <SliderRow
                icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
                label="X"
                value={land.separateBadgeOffsetX ?? ed.defaultSeparateBadgeOffsetX}
                min={-100}
                max={100}
                boundsMin={-500}
                boundsMax={500}
                onChange={(v) => set({ separateBadgeOffsetX: v })}
                onDoubleClick={() => clear("separateBadgeOffsetX")}
                editingValue={editVal}
                editText={editTxt}
                setEditingValue={setEditVal}
                setEditText={setEditTxt}
                editingKey="lssepsOX"
                suffix="px"
              />
              <SliderRow
                icon={<ArrowUpDown className="w-3.5 h-3.5" />}
                label="Y"
                value={land.separateBadgeOffsetY ?? ed.defaultSeparateBadgeOffsetY}
                min={-100}
                max={100}
                boundsMin={-500}
                boundsMax={500}
                onChange={(v) => set({ separateBadgeOffsetY: v })}
                onDoubleClick={() => clear("separateBadgeOffsetY")}
                editingValue={editVal}
                editText={editTxt}
                setEditingValue={setEditVal}
                setEditText={setEditTxt}
                editingKey="lssepsOY"
                suffix="px"
              />
            </div>
          </>
        )}
        <hr className="border-surface2/50" />
        {scaleGroup(t("ui.networkLogo"), <Tv className="w-3.5 h-3.5 text-sky-400" />, "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY", ed.defaultNetworkLogoScale, ed.defaultNetworkLogoOffsetX, ed.defaultNetworkLogoOffsetY, "lsn")}
      </div>

      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-zinc-200 font-semibold flex items-center gap-1.5">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            {t("ui.blurSection")} · {t("ui.posterShapeLandscape")}
          </span>
          <span className="flex items-center gap-2">
            {isOver("blurEnabled") && (
              <button
                type="button"
                title={resetLabel}
                aria-label={resetLabel}
                onClick={() => clear("blurEnabled")}
                className="text-[11px] text-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <Toggle
              value={enabled}
              onChange={(v) => set({ blurEnabled: v })}
              label={`${t("ui.blurSection")} · ${t("ui.posterShapeLandscape")}`}
            />
          </span>
        </div>

        {enabled ? (
          <>
            <GradientPresetRow
              current={{
                gradientHeight: land.gradientHeight ?? ed.defaultGradientHeight,
                blurIntensity: land.blurIntensity ?? ed.defaultBlurIntensity,
                blurFade: land.blurFade ?? ed.defaultBlurFade,
                blurDarkness: land.blurDarkness ?? ed.defaultBlurDarkness,
                tintStrength: land.tintStrength ?? ed.defaultTintStrength,
                blurEnabled: enabled,
              }}
              onApply={applyPreset}
              naturalLabel={t("ui.gradientPresetNatural")}
              colorLabel={t("ui.gradientPresetColor")}
              addTitle={t("ui.gradientPresetAdd")}
              namePlaceholder={t("ui.gradientPresetName")}
              deleteLabel={t("ui.gradientPresetDelete")}
            />
            <div className="space-y-1.5 pt-1">
              {gradSlider(t("ui.height"), <Ruler className="w-3.5 h-3.5" />, "gradientHeight", ed.defaultGradientHeight, 5, 100, "%", "lsgh")}
              {gradSlider(t("ui.intensity"), <Cloud className="w-3.5 h-3.5" />, "blurIntensity", ed.defaultBlurIntensity, 1, 100, "px", "lsbi")}
              {gradSlider(t("ui.fade"), <Minus className="w-3.5 h-3.5" />, "blurFade", ed.defaultBlurFade, 0, 100, "%", "lsbf")}
              {gradSlider(t("ui.darkness"), <Circle className="w-3.5 h-3.5" />, "blurDarkness", ed.defaultBlurDarkness, 0, 100, "%", "lsbd")}
              {gradSlider(t("ui.tintStrength"), <Cloud className="w-3.5 h-3.5" />, "tintStrength", ed.defaultTintStrength, 0, 100, "%", "lsts")}
              {gradSlider(t("ui.topShade"), <Circle className="w-3.5 h-3.5" />, "topShade", ed.defaultTopShade, 0, 100, "%", "lstp")}
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
        onClick={() => ed.resetLandscape()}
        className="w-full py-1.5 rounded-lg text-[11px] font-semibold text-muted hover:text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
      >
        {t("ui.reset")} · {t("ui.posterShapeLandscape")}
      </button>
    </div>
  )
}
