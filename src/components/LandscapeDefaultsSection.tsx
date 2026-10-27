"use client"
import { useRef } from "react"

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
import { usePSelector } from "@/lib/context"
import { isFollowOffDisabled, neutralFollowOffsets } from "@/lib/network-freeze"
import { resolveNetworkShapeView } from "@/lib/network-follow"
import { useNetworkFreeze } from "@/lib/useNetworkFreeze"
import { useNetworkGeometry } from "@/lib/useNetworkGeometry"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { BadgeItemTransformControls } from "@/components/settings/BadgeItemTransformControls"
import type { DefaultsPreviewDemoMedia, DefaultsPreviewFamily } from "@/lib/poster-url"
import type { PosterElementId } from "@/components/settings/PosterElementNavigation"
import { SliderRow } from "@/components/SliderRow"
import { Toggle } from "@/components/Toggle"
import { separateBadgeScaleToUI, uiToSeparateBadgeScale, SEPARATE_BADGE_SCALE_UI_MIN, SEPARATE_BADGE_SCALE_UI_MAX, NUMBER_BADGE_BASE_OFFSET_X } from "@/lib/badge-styles"
import { getBadgeOffsetRange } from "@/lib/badge-offset-ranges"
import { GradientPresetRow } from "@/components/GradientPresetRow"
import type { GradientPresetValues } from "@/lib/gradient-presets"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import { AvailabilityGate, isExtraStyleActive, isGenreStyleActive, isQualityStyleActive, isRankStyleActive, orderActiveFirst, type EffectiveBadgeFlags } from "@/components/settings/SettingsElementAvailability"


interface Props {
  editVal: string | null
  editTxt: string
  setEditVal: (v: string | null) => void
  setEditTxt: (v: string) => void
  /** Preview-only editing family (owned by SettingsPanel): each numeric group
   *  reports its family on press/focus — text-only state lift, never writes. */
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
  /** Preview-only demo title (SettingsPanel): the freeze reads the same sample
   *  as the displayed defaults preview (exact URL + netgeo, no client recompute). */
  demoMedia?: DefaultsPreviewDemoMedia | null
  /** Family being edited (SettingsPanel): same sample as the preview. */
  previewFamily?: DefaultsPreviewFamily | null
  /** True while this section is actually shown (Transform tab + landscape
   *  target): the geometry prefetch only runs then, never per slider tick. */
  controlsVisible?: boolean
  /** Unified workspace element filter: groups for other elements stay
   *  mounted + hidden. Absent = legacy full behavior. */
  element?: PosterElementId | null
  /**
   * Geometry-only presentation (five-tab settings): a Position card hosts
   * the landscape network-position override moved from the Badge tab
   * (title-logo alignment is Auto-only, no selector); gated-off groups
   * render a compact inactive placeholder with a short activate hint.
   * Absent = legacy standalone behavior unchanged.
   */
  geometryOnly?: boolean
}

type LandKey = keyof LandscapeServerDefaults

/**
 * Sezione default Orizzontale (profilo `landscape` dei default server):
 * sfumatura completa (altezza/intensità/fade/darkness/tinta/ombra) + scale e
 * offset dei badge — gli stessi parametri del Verticale. Stili, toggle, tinta
 * no: quelli restano condivisi (flat). Ogni riga mostra il valore effettivo
 * (override landscape ?? flat portrait): modificare imposta l'override; il
 * reset ✕ di gruppo e il doppio click tornano a seguire il portrait
 * (opt-in esplicito al follow, mai leak involontario: un edit portrait
 * congela prima il pre-edit nel profilo). Il reset completo in fondo
 * ripristina default indipendenti di formato (mai clear-to-follow).
 * Nessun parametro URL/chiave cache: il server risolve dal profilo salvato
 * (già coperto da firma defaults e sd-hash).
 */
export function LandscapeDefaultsSection({ editVal, editTxt, setEditVal, setEditTxt, onPreviewFamilyChange, demoMedia, previewFamily, controlsVisible, element, geometryOnly }: Props) {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const land = ed.landscape
  const set = (patch: Partial<LandscapeServerDefaults>) => ed.setLandscape(patch)
  // Key/group reset: applied-preset snapshot when present, otherwise the
  // documented clear-to-inherit contract (persisted through `landscapeReset`).
  const resetKeys = (keys: readonly LandKey[]) => {
    if (ed.resetLandscapeKeys) ed.resetLandscapeKeys(keys)
    else set(Object.fromEntries(keys.map((key) => [key, undefined])) as Partial<LandscapeServerDefaults>)
  }
  const clear = (key: LandKey) => resetKeys([key])
  const isOver = (key: LandKey) => land[key] !== undefined
  const resetLabel = t("ui.reset")
  const enabled = land.blurEnabled ?? ed.defaultBlurEnabled
  // Badge offset ranges (landscape profile): full 16:9 canvas crossing on
  // drag, server contract ±2000 on numeric edit. Default logo offsets share
  // the same ranges; scale/gradient untouched. (Per-title film logo keeps
  // its dynamic logoBounds in TransformControls/context — never this helper.)
  const landOffRangeX = getBadgeOffsetRange("landscape", "x")
  const landOffRangeY = getBadgeOffsetRange("landscape", "y")
  // Preview-family scope (U2): same helper as the other settings cards —
  // explicit press or keyboard focus reports only (never hover), no focus
  // moves, no unmounts.
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  // Unified workspace filter (same contract as TransformPanel): null shows
  // everything (legacy). Ratings and sources share the separate geometry.
  const hideFor = (...els: PosterElementId[]): boolean | undefined =>
    element ? !els.includes(element) : undefined
  const hideForScaleFamily = (family: DefaultsPreviewFamily): boolean | undefined =>
    family === "rank" ? hideFor("rank")
    : family === "info" ? hideFor("info")
    : family === "extra" ? hideFor("info")
    : family === "genre" ? hideFor("genre")
    : family === "quality" ? hideFor("quality")
    : family === "logo" ? hideFor("logo")
    : hideFor("background")
  // Landscape network follow ("Follow the title logo", default ON): same
  // freeze as the portrait card, on the landscape defaults-preview URL (same
  // builder, same sample) + netgeo=1. OFF locks actual top/left + effective
  // post-shrink scale into the landscape profile; ON restores the stashed
  // priors else neutral 0,0 (stored fixed absolutes never re-enter as
  // relative offsets). Reset clears the profile override (follows portrait).
  const { freezing: netFreezing, freezeOff: freezeNetworkOff, turnOn: turnNetworkOn } = useNetworkFreeze()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const userId = usePSelector((v) => v.currentUserId)
  // Effective landscape view with server semantics (flat never leaks into
  // landscape absolutes, follow without fixed coords reads ON): checkbox,
  // sliders and freeze priors always agree with the render.
  const netView = resolveNetworkShapeView(
    {
      networkLogoFollowTitle: ed.defaultNetworkLogoFollowTitle,
      networkLogoOffsetX: ed.defaultNetworkLogoOffsetX,
      networkLogoOffsetY: ed.defaultNetworkLogoOffsetY,
    },
    ed.landscape,
    "landscape",
  )
  const landFollowOn = netView.follow
  const landNetworkOn = (land.networkLogo ?? ed.defaultNetworkLogo) !== false
  const freezeLiveRef = useRef({
    ed, demoMedia: demoMedia ?? null,
    previewFamily: previewFamily ?? null,
    tmdbKey, userId, lang,
  })
  freezeLiveRef.current = {
    ed, demoMedia: demoMedia ?? null,
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
      previewShape: "landscape",
      previewFamily: L.previewFamily,
    })
  }
  const freezePreviewUrl = buildFreezePreview().url
  const netGeoEnabled = (controlsVisible ?? false) && landNetworkOn && landFollowOn && !!freezePreviewUrl
  const { geometry: netGeometry, geometryLoading: netGeometryLoading } = useNetworkGeometry(freezePreviewUrl, netGeoEnabled)
  const followOffDisabled = isFollowOffDisabled({
    networkLogo: landNetworkOn,
    hasPreviewUrl: !!freezePreviewUrl,
    hasTitle: true,
    freezing: netFreezing,
    geometryLoading: netGeometryLoading,
    hasGeometry: netGeometry !== null,
  })
  const handleLandscapeFollowChange = (v: boolean) => {
    if (v) {
      const neutral = neutralFollowOffsets({ fixed: true })
      turnNetworkOn({
        titleKey: "defaults",
        shape: "landscape",
        neutralX: neutral.x,
        neutralY: neutral.y,
        applyOn: ({ follow, offsetX, offsetY }) => {
          set({ networkLogoFollowTitle: follow, networkLogoOffsetX: offsetX, networkLogoOffsetY: offsetY })
        },
      })
      return
    }
    const built = buildFreezePreview()
    if (!built.url || built.shape !== "landscape") return
    void freezeNetworkOff({
      titleKey: "defaults",
      shape: "landscape",
      previewUrl: built.url,
      networkLogo: landNetworkOn,
      currentScale: land.networkLogoScale ?? ed.defaultNetworkLogoScale,
      // Stash priors are the effective relative offsets (never leaked flat
      // absolutes): the way back ON restores them, or neutral 0,0 on miss.
      currentOffsetX: netView.relativeX,
      currentOffsetY: netView.relativeY,
      applyFixed: ({ follow, scale, offsetX, offsetY }) => {
        set({
          networkLogoFollowTitle: follow,
          networkLogoScale: scale,
          networkLogoOffsetX: offsetX,
          networkLogoOffsetY: offsetY,
        })
      },
      getLive: () => {
        const b = buildFreezePreview()
        return { titleKey: "defaults", shape: b.shape, previewUrl: b.url }
      },
    })
  }
  // Separate-ratings numerics gate on the EFFECTIVE flags (`land ?? flat`),
  // matching the Badge tab scoped bindings and the preview builder: raw root
  // flags alone would show/hide this group against the edited target.
  const effSepGate =
    (land.globalBadges ?? ed.defaultGlobalBadges) &&
    (land.badgeRating ?? ed.defaultBadgeRating) &&
    (land.separateRatings ?? ed.defaultSeparateRatings)
  // Card truth for the landscape target (`land ?? flat` inheritance for
  // BOTH layout and scope): geometry locks apply ONLY when the effective
  // landscape Card skin is selected with effective scope "all". Ranked
  // (explicit, absent or invalid) leaves Standard fallback positioning
  // live. Explicit landscape scope wins, else the flat scope is inherited.
  // User transforms are live on every layout (explicit user contract):
  // neutral values keep the historic Card/Fresh look byte-identical.
  const isCardAllLand = false
  const isCardRankedLand = false
  const landCardNote = undefined
  const landFallbackNote = undefined

  const applyPreset = (v: GradientPresetValues) => {
    set({
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
    key: Extract<LandKey, "gradientHeight" | "blurIntensity" | "blurFade" | "blurDarkness" | "tintStrength" | "topShade" | "topShadeHeight">,
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
    sKey: Extract<LandKey, "topBadgeScale" | "extraBadgeScale" | "genreBadgeScale" | "qualityBadgeScale" | "networkLogoScale">,
    xKey: Extract<LandKey, "topBadgeOffsetX" | "extraBadgeOffsetX" | "genreBadgeOffsetX" | "qualityBadgeOffsetX" | "networkLogoOffsetX">,
    yKey: Extract<LandKey, "topBadgeOffsetY" | "extraBadgeOffsetY" | "genreBadgeOffsetY" | "qualityBadgeOffsetY" | "networkLogoOffsetY">,
    flatS: number,
    flatX: number,
    flatY: number,
    prefix: string,
    family: DefaultsPreviewFamily,
    followKey?: Extract<LandKey, "networkLogoFollowTitle">,
    cardLock?: "all" | "offsets" | "follow-offsets",
  ) => (
    <div {...famAttrs(family)} hidden={hideForScaleFamily(family)} className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        {(isOver(sKey) || isOver(xKey) || isOver(yKey) || (followKey && isOver(followKey))) && (
          <button
            type="button"
            title={resetLabel}
            aria-label={resetLabel}
            onClick={() => resetKeys([sKey, xKey, yKey, ...(followKey ? [followKey] : [])])}
            className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
          >
            {resetLabel}
          </button>
        )}
      </div>
      {followKey && (
        <div className="flex items-center justify-between px-1 gap-2" title={followKey && cardLock ? landCardNote : (followKey && isCardRankedLand ? landFallbackNote : undefined)}>
          <span className="text-zinc-300">{t("ui.followTitleLogo")}</span>
          <Toggle
            value={landFollowOn}
            onChange={handleLandscapeFollowChange}
            label={t("ui.followTitleLogo")}
            disabled={(cardLock ? true : false) || netFreezing || (landFollowOn && followOffDisabled)}
          />
        </div>
      )}
      {cardLock === "all" ? (
        <div title={landCardNote ?? undefined}>
        <fieldset disabled className="contents">
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
        </fieldset>
        </div>
      ) : (
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
      )}
      {cardLock ? (
      <div title={landCardNote ?? undefined}>
      <fieldset disabled className="contents">
      {(() => {
        // Effective rank style for the landscape target: the profile
        // override wins, else the portrait flat (styles are independent per
        // shape). Rank numerals (`number`) render on a -20px X baseline, so
        // show the REAL effective X (stored + baseline) and convert edits
        // back to the stored adjustment. Other groups pass through untouched
        // (base 0). Reset/dblclick clear the override (land follows the
        // flat), never touching other settings or stored raws.
        const landRankStyle = land.rankingBadgeStyle ?? ed.defaultRankingBadgeStyle
        const numBase =
          xKey === "topBadgeOffsetX" && landRankStyle === "number"
            ? NUMBER_BADGE_BASE_OFFSET_X
            : 0
        // Network follow card: show the effective view (relative offsets
        // when ON, fixed absolutes when OFF) — raw `land ?? flat` would leak
        // portrait-fixed absolutes into the landscape sliders.
        const storedX = followKey
          ? (netView.follow ? netView.relativeX : (netView.fixedX ?? flatX))
          : (land[xKey] ?? flatX)
        const effX = storedX + numBase
        return (
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={effX}
            min={landOffRangeX.min + numBase}
            max={landOffRangeX.max + numBase}
            boundsMin={landOffRangeX.boundsMin + numBase}
            boundsMax={landOffRangeX.boundsMax + numBase}
            step={1}
            onChange={(v) => set({ [xKey]: v - numBase } as Partial<LandscapeServerDefaults>)}
            onDoubleClick={() => clear(xKey)}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey={`${prefix}OX`}
            suffix="px"
          />
        )
      })()}
      <SliderRow
        icon={<ArrowUpDown className="w-3.5 h-3.5" />}
        label="Y"
        value={followKey ? (netView.follow ? netView.relativeY : (netView.fixedY ?? flatY)) : (land[yKey] ?? flatY)}
        min={landOffRangeY.min}
        max={landOffRangeY.max}
        boundsMin={landOffRangeY.boundsMin}
        boundsMax={landOffRangeY.boundsMax}
        step={1}
        onChange={(v) => set({ [yKey]: v } as Partial<LandscapeServerDefaults>)}
        onDoubleClick={() => clear(yKey)}
        editingValue={editVal}
        editText={editTxt}
        setEditingValue={setEditVal}
        setEditText={setEditTxt}
        editingKey={`${prefix}OY`}
        suffix="px"
      />
      </fieldset>
      </div>
      ) : null}
      {!cardLock && (() => {
        // Effective rank style (live branch): same presentation mapping as
        // the locked branch above, never a second derivation.
        const landRankStyle = land.rankingBadgeStyle ?? ed.defaultRankingBadgeStyle
        const numBase =
          xKey === "topBadgeOffsetX" && landRankStyle === "number"
            ? NUMBER_BADGE_BASE_OFFSET_X
            : 0
        const storedX = followKey
          ? (netView.follow ? netView.relativeX : (netView.fixedX ?? flatX))
          : (land[xKey] ?? flatX)
        const effX = storedX + numBase
        return (
          <SliderRow
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            label="X"
            value={effX}
            min={landOffRangeX.min + numBase}
            max={landOffRangeX.max + numBase}
            boundsMin={landOffRangeX.boundsMin + numBase}
            boundsMax={landOffRangeX.boundsMax + numBase}
            step={1}
            onChange={(v) => set({ [xKey]: v - numBase } as Partial<LandscapeServerDefaults>)}
            onDoubleClick={() => clear(xKey)}
            editingValue={editVal}
            editText={editTxt}
            setEditingValue={setEditVal}
            setEditText={setEditTxt}
            editingKey={`${prefix}OX`}
            suffix="px"
          />
        )
      })()}
      {!cardLock && (
      <SliderRow
        icon={<ArrowUpDown className="w-3.5 h-3.5" />}
        label="Y"
        value={followKey ? (netView.follow ? netView.relativeY : (netView.fixedY ?? flatY)) : (land[yKey] ?? flatY)}
        min={landOffRangeY.min}
        max={landOffRangeY.max}
        boundsMin={landOffRangeY.boundsMin}
        boundsMax={landOffRangeY.boundsMax}
        step={1}
        onChange={(v) => set({ [yKey]: v } as Partial<LandscapeServerDefaults>)}
        onDoubleClick={() => clear(yKey)}
        editingValue={editVal}
        editText={editTxt}
        setEditingValue={setEditVal}
        setEditText={setEditTxt}
        editingKey={`${prefix}OY`}
        suffix="px"
      />
      )}
      {cardLock && (
        <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
      )}
      {!cardLock && isCardRankedLand && (prefix === "lst" || prefix === "lsg" || prefix === "lsn") && (
        <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
      )}
    </div>
  )

  // Effective geometry groups (five-tab settings): gated scale groups in
  // active-first DOM order with retained disabled controls. Legacy path
  // below stays byte-identical (standalone reuse/tests). Deferred render:
  // scaleGroup stays pure, invoked only in the mounted branch.
  const renderSortedGroups = () => {
    const effLandFlags: EffectiveBadgeFlags = {
      globalBadges: land.globalBadges ?? ed.defaultGlobalBadges,
      badgeGenre: land.badgeGenre ?? ed.defaultBadgeGenre,
      badgeYear: land.badgeYear ?? ed.defaultBadgeYear,
      badgeRating: land.badgeRating ?? ed.defaultBadgeRating,
      separateRatings: land.separateRatings ?? ed.defaultSeparateRatings,
      separateRatingsStyle: land.separateRatingsStyle ?? ed.defaultSeparateRatingsStyle,
      rankingBadges: land.rankingBadges ?? ed.defaultRankingBadges,
      sashOrder: land.sashOrder ?? ed.defaultSashOrder,
      badgeQuality: land.badgeQuality ?? ed.defaultBadgeQuality,
      networkLogo: land.networkLogo ?? ed.defaultNetworkLogo,
      preRelease: land.preRelease ?? ed.defaultPreRelease,
    }
    const groups: { key: string; active: boolean; hidden: boolean | undefined; name: string; node: React.ReactNode; testId: string }[] = [
      {
        key: "rank", active: isRankStyleActive(effLandFlags), hidden: hideFor("rank"),
        name: t("ui.rankFamily"), testId: "landscape-geo-rank",
        node: scaleGroup(t("ui.rankFamily"), <Trophy className="w-3.5 h-3.5 text-amber-500" />, "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY", ed.defaultTopBadgeScale, ed.defaultTopBadgeOffsetX, ed.defaultTopBadgeOffsetY, "lst", "rank", undefined, isCardAllLand ? "all" : undefined),
      },
      {
        key: "extra", active: isExtraStyleActive(effLandFlags), hidden: hideFor("info"),
        name: t("ui.sash_extra"), testId: "landscape-geo-extra",
        node: scaleGroup(t("ui.sash_extra"), <Sparkles className="w-3.5 h-3.5 text-emerald-400" />, "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY", ed.defaultExtraBadgeScale ?? land.topBadgeScale ?? ed.defaultTopBadgeScale, ed.defaultExtraBadgeOffsetX ?? land.topBadgeOffsetX ?? ed.defaultTopBadgeOffsetX, ed.defaultExtraBadgeOffsetY ?? land.topBadgeOffsetY ?? ed.defaultTopBadgeOffsetY, "lse", "info"),
      },
      {
        key: "genre", active: isGenreStyleActive(effLandFlags), hidden: hideFor("genre"),
        name: t("ui.genreRatingBadge"), testId: "landscape-geo-genre",
        node: scaleGroup(t("ui.genreRatingBadge"), <Star className="w-3.5 h-3.5 text-amber-400" />, "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY", ed.defaultGenreBadgeScale, ed.defaultGenreBadgeOffsetX, ed.defaultGenreBadgeOffsetY, "lsg", "genre", undefined, isCardAllLand ? "offsets" : undefined),
      },
      {
        key: "quality", active: isQualityStyleActive(effLandFlags), hidden: hideFor("quality"),
        name: t("ui.badgeQuality"), testId: "landscape-geo-quality",
        node: (
          <>
            {scaleGroup(t("ui.badgeQuality"), <Sparkles className="w-3.5 h-3.5 text-purple-400" />, "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY", ed.defaultQualityBadgeScale, ed.defaultQualityBadgeOffsetX, ed.defaultQualityBadgeOffsetY, "lsq", "quality")}
            <BadgeItemTransformControls previewUrl={freezePreviewUrl} family="quality" shape="landscape" className="pt-1.5 border-t border-white/5" />
          </>
        ),
      },
      {
        key: "separate", active: effSepGate, hidden: hideFor("ratings", "sources"),
        name: t("ui.separateRatings"), testId: "landscape-geo-separate",
        node: (
          <div {...famAttrs("ratings")} className="space-y-1.5">
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
                  onClick={() => resetKeys(["separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY"])}
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
              min={landOffRangeX.min}
              max={landOffRangeX.max}
              boundsMin={landOffRangeX.boundsMin}
              boundsMax={landOffRangeX.boundsMax}
              step={1}
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
              min={landOffRangeY.min}
              max={landOffRangeY.max}
              boundsMin={landOffRangeY.boundsMin}
              boundsMax={landOffRangeY.boundsMax}
              step={1}
              onChange={(v) => set({ separateBadgeOffsetY: v })}
              onDoubleClick={() => clear("separateBadgeOffsetY")}
              editingValue={editVal}
              editText={editTxt}
              setEditingValue={setEditVal}
              setEditText={setEditTxt}
              editingKey="lssepsOY"
              suffix="px"
            />
            <BadgeItemTransformControls previewUrl={freezePreviewUrl} family="separate" shape="landscape" className="pt-1.5 border-t border-white/5" />
          </div>
        ),
      },
      {
        key: "network", active: landNetworkOn, hidden: hideFor("logo"),
        name: t("ui.networkLogo"), testId: "landscape-geo-network",
        node: scaleGroup(t("ui.networkLogo"), <Tv className="w-3.5 h-3.5 text-sky-400" />, "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY", ed.defaultNetworkLogoScale, ed.defaultNetworkLogoOffsetX, ed.defaultNetworkLogoOffsetY, "lsn", "logo", "networkLogoFollowTitle", isCardAllLand ? "follow-offsets" : undefined),
      },
    ]
    // Inactive elements stay completely hidden (user request supersedes the
    // legacy disabled-gate disclosure): enabling in Information/Rankings
    // immediately exposes the applicable geometry; staged values live in the
    // editor context so hiding never resets them.
    const ordered = orderActiveFirst(groups.filter((g) => g.active).map((g) => ({ active: g.active, value: g })))
    return (
      <>
        {ordered.map((g, i) => (
          <div key={g.key} hidden={g.hidden}>
            <AvailabilityGate
              active
              name={g.name}
              hint=""
              testId={g.testId}
            >
              {g.node}
            </AvailabilityGate>
            {i < ordered.length - 1 && <hr className="border-surface2/50 mt-3" />}
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="space-y-3.5">
      <p className="text-[11px] text-zinc-400 italic">{t("ui.landscapeDefaultsHint")}</p>

      {/* Logo: stessa card del Verticale (doppio click = segui; esplicito fino a
          200 per il titolo Fresh — correzione c1). Il max segue il layout
          default EFFETTIVO dell'Orizzontale (`land ?? flat`, ereditarietà
          piatta): Fresh 10..200, Standard 10..100 invariato. L'auto mostrato
          segue lo scope effettivo (`land ?? flat`): Fresh-all = 100,
          altrimenti il flat esplicito o 75 (fallback Standard, mai baked). */}
      <div {...famAttrs("logo")} hidden={hideFor("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm animate-fade-in">
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
              onClick={() => resetKeys(["logoScale", "logoOffsetX", "logoOffsetY"])}
              className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
            >
              {resetLabel}
            </button>
          )}
        </div>
        {(() => {
          const effLandLayout = land.posterLayout ?? ed.defaultPosterLayout
          const effLandScope = land.posterFreshScope ?? ed.defaultPosterFreshScope
          const landFresh = effLandLayout === "fresh"
          const landFreshAll = landFresh && effLandScope === "all"
          const landLogoMax = landFresh ? 200 : 100
          const landLogoShown = land.logoScale ?? ed.defaultLogoScale ?? (landFreshAll ? 100 : 75)
          return (
        <SliderRow
          icon={<Search className="w-3.5 h-3.5" />}
          label={t("ui.scale")}
          value={landLogoShown}
          min={10}
          max={landLogoMax}
          boundsMin={10}
          boundsMax={landLogoMax}
          onChange={(v) => set({ logoScale: v })}
          onDoubleClick={() => clear("logoScale")}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="lslogoScale"
          suffix="%"
        />
          )
        })()}
        <div title={isCardAllLand ? landCardNote : (isCardRankedLand ? landFallbackNote : undefined)} aria-disabled={isCardAllLand || undefined}>
        <fieldset disabled={isCardAllLand} className="contents">
        <SliderRow
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="X"
          value={land.logoOffsetX ?? ed.defaultLogoOffsetX ?? 0}
          min={landOffRangeX.min}
          max={landOffRangeX.max}
          boundsMin={landOffRangeX.boundsMin}
          boundsMax={landOffRangeX.boundsMax}
          step={1}
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
          min={landOffRangeY.min}
          max={landOffRangeY.max}
          boundsMin={landOffRangeY.boundsMin}
          boundsMax={landOffRangeY.boundsMax}
          step={1}
          onChange={(v) => set({ logoOffsetY: v })}
          onDoubleClick={() => clear("logoOffsetY")}
          editingValue={editVal}
          editText={editTxt}
          setEditingValue={setEditVal}
          setEditText={setEditTxt}
          editingKey="lslogoOY"
          suffix="px"
        />
        </fieldset>
        </div>
        {isCardAllLand && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardControlsNote")}</p>
        )}
        {isCardRankedLand && (
          <p className="text-[10px] text-muted italic leading-tight px-1">{t("ui.posterLayoutCardFallbackNote")}</p>
        )}
      </div>

      {/* Network position override (moved home from the Badge tab):
          title-logo alignment is Auto-only (no selector). Reset follows the
          flat. Rendered only while the network logo is enabled — never an
          empty Position card. */}
      {geometryOnly && landNetworkOn && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between px-1">
          <span className="font-semibold text-zinc-200">{t("ui.position")}</span>
          {isOver("networkLogoPosition") && (
            <button
              type="button"
              title={resetLabel}
              aria-label={resetLabel}
              onClick={() => resetKeys(["networkLogoPosition"])}
              className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
            >
              {resetLabel}
            </button>
          )}
        </div>
        <div className="space-y-1.5" title={t("ui.networkLogoPosition")} data-testid="landscape-netpos-group">
          <span className="text-[11px] text-muted font-medium block">{t("ui.networkLogoPosition")}</span>
          <div className="flex gap-1">
            {(["auto", "top"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => set({ networkLogoPosition: pos })}
                aria-pressed={(land.networkLogoPosition ?? ed.defaultNetworkLogoPosition) === pos}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                  (land.networkLogoPosition ?? ed.defaultNetworkLogoPosition) === pos
                    ? "bg-white/20 text-foreground shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}
      {/* Stesso ordine del Verticale: badge classifica, extra, genere,
          qualità, network — sfumatura per ultima. */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        {geometryOnly ? renderSortedGroups() : (
        <>
        {scaleGroup(t("ui.rankFamily"), <Trophy className="w-3.5 h-3.5 text-amber-500" />, "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY", ed.defaultTopBadgeScale, ed.defaultTopBadgeOffsetX, ed.defaultTopBadgeOffsetY, "lst", "rank", undefined, isCardAllLand ? "all" : undefined)}
        <hr hidden={hideFor("rank") && hideFor("info")} className="border-surface2/50" />
        {scaleGroup(t("ui.sash_extra"), <Sparkles className="w-3.5 h-3.5 text-emerald-400" />, "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY", ed.defaultExtraBadgeScale ?? land.topBadgeScale ?? ed.defaultTopBadgeScale, ed.defaultExtraBadgeOffsetX ?? land.topBadgeOffsetX ?? ed.defaultTopBadgeOffsetX, ed.defaultExtraBadgeOffsetY ?? land.topBadgeOffsetY ?? ed.defaultTopBadgeOffsetY, "lse", "info")}
        <hr hidden={hideFor("info") && hideFor("genre")} className="border-surface2/50" />
        {scaleGroup(t("ui.genreRatingBadge"), <Star className="w-3.5 h-3.5 text-amber-400" />, "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY", ed.defaultGenreBadgeScale, ed.defaultGenreBadgeOffsetX, ed.defaultGenreBadgeOffsetY, "lsg", "genre", undefined, isCardAllLand ? "offsets" : undefined)}
        <hr hidden={hideFor("genre") && hideFor("quality")} className="border-surface2/50" />
        {scaleGroup(t("ui.badgeQuality"), <Sparkles className="w-3.5 h-3.5 text-purple-400" />, "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY", ed.defaultQualityBadgeScale, ed.defaultQualityBadgeOffsetX, ed.defaultQualityBadgeOffsetY, "lsq", "quality")}
        <BadgeItemTransformControls previewUrl={freezePreviewUrl} family="quality" shape="landscape" className="pt-1.5 border-t border-white/5" />
        {!effSepGate && geometryOnly && (
          <p data-testid="landscape-separate-inactive" className="text-[11px] text-zinc-400 italic px-1">{t("ui.activateInTabHint", { name: t("ui.separateRatings"), tab: t("ui.settingsTabInformation") })}</p>
        )}
        {/* Standalone and geometryOnly share the same effective separate
            gate as the Badge tab and the preview (`land ?? flat`): inactive
            numerics stay hidden (stored overrides preserved, master toggles
            live in the Badge tab), never a root-leak. */}
        {effSepGate && (
          <>
            <hr hidden={hideFor("quality") && hideFor("ratings", "sources")} className="border-surface2/50" />
            <div {...famAttrs("ratings")} hidden={hideFor("ratings", "sources")} className="space-y-1.5">
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
                    onClick={() => resetKeys(["separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY"])}
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
                min={landOffRangeX.min}
                max={landOffRangeX.max}
                boundsMin={landOffRangeX.boundsMin}
                boundsMax={landOffRangeX.boundsMax}
                step={1}
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
                min={landOffRangeY.min}
                max={landOffRangeY.max}
                boundsMin={landOffRangeY.boundsMin}
                boundsMax={landOffRangeY.boundsMax}
                step={1}
                onChange={(v) => set({ separateBadgeOffsetY: v })}
                onDoubleClick={() => clear("separateBadgeOffsetY")}
                editingValue={editVal}
                editText={editTxt}
                setEditingValue={setEditVal}
                setEditText={setEditTxt}
                editingKey="lssepsOY"
                suffix="px"
              />
              <BadgeItemTransformControls previewUrl={freezePreviewUrl} family="separate" shape="landscape" className="pt-1.5 border-t border-white/5" />
            </div>
          </>
        )}
        {!landNetworkOn && geometryOnly && (
          <p data-testid="landscape-network-inactive" className="text-[11px] text-zinc-400 italic px-1">{t("ui.activateInTabHint", { name: t("ui.networkLogo"), tab: t("ui.settingsTabInformation") })}</p>
        )}
        {/* Standalone (non-geometryOnly) keeps the legacy always-rendered
            network group: the effective gate applies to the geometryOnly
            presentation only, never a legacy behavior change. */}
        {(!geometryOnly || landNetworkOn) && (
          <>
            <hr hidden={hideFor("logo") || (hideFor("rank") && hideFor("info") && hideFor("genre") && hideFor("quality") && hideFor("ratings", "sources"))} className="border-surface2/50" />
            {scaleGroup(t("ui.networkLogo"), <Tv className="w-3.5 h-3.5 text-sky-400" />, "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY", ed.defaultNetworkLogoScale, ed.defaultNetworkLogoOffsetX, ed.defaultNetworkLogoOffsetY, "lsn", "logo", "networkLogoFollowTitle", isCardAllLand ? "follow-offsets" : undefined)}
          </>
        )}
        </>
        )}
      </div>

      <div {...famAttrs("gradient")} hidden={hideFor("background")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
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
              neroLabel="Nero"
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
              {gradSlider(t("ui.topShadeHeight"), <Ruler className="w-3.5 h-3.5" />, "topShadeHeight", ed.defaultTopShadeHeight, 0, 100, "%", "lsth")}
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
