"use client"

import { useState, useId, type ReactNode } from "react"
import { ChevronDown, Flame, Layers, Menu, Palette, Sparkles, Star, Trophy, Tv, Check } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { useShapeBadgeDefaults, BADGE_VISUAL_LAND_KEYS, type BadgeShapeTarget } from "@/components/settings/useShapeDefaults"
import {
  RankingAppearanceSelector,
  resolveRankingAppearance,
  resolveRankVariant,
  resolveRibbonVariant,
  rankingAppearanceValue,
  rankVariantValue,
  ribbonVariantValue,
  legacyExtraStyleForRank,
  type RankingAppearance,
  type RankBadgeVariant,
  type RankRibbonVariant,
} from "@/components/RankingAppearanceSelector"
import { type ExtraBadgeStyle, type RankingBadgeStyle } from "@/lib/badge-styles"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { Toggle } from "@/components/Toggle"
import { BadgeStyleSelector } from "@/components/ui"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import { isBottomSeparateRatingsStyle, getSeparateRatingsStyleForShape, DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y, DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE, DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE, getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import { NATURAL_GRADIENT_DEFAULTS } from "@/lib/gradient-presets"
import { GenreStyleSection, QualityStyleSection } from "@/components/settings/BadgeStyleSection"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { UI_RATING_SOURCES } from "@/lib/rating-weights"
import { SASH_BUCKETS, DEFAULT_SASH_ORDER, parseSashOrder, moveSashItem, type SashBucket } from "@/lib/badge-priority"
import { formatRating } from "@/lib/custom-rating/formatter"
import { saveDefaults } from "@/lib/save-defaults"
import { http } from "@/lib/http"
import { captureVisualPreset, normalizePresetExtraTuning } from "@/lib/visual-presets"
import { clearedExtraForPresetApply } from "@/lib/extra-materialize"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  portraitPresetPatch,
  resolveEffectiveLandscape,
} from "@/lib/visual-presets"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"

// Master Trend stash, one slot per edit target: portrait keeps the legacy
// key (existing stashes survive), landscape gets its own so restoring one
// format never resurrects the other format's order.
const TREND_SASH_STASH_KEY = "pictorium_trend_sash_stash"
const TREND_SASH_STASH_KEY_LANDSCAPE = "pictorium_trend_sash_stash:landscape"

// Rank-only stash, separate from the master stash: rank OFF remembers the
// exact order (rank position included) per edit target, so rank ON restores
// it without reshuffling the other categories. Never clobbers the master stash.
const RANK_SASH_STASH_KEY = "pictorium_rank_sash_stash"
const RANK_SASH_STASH_KEY_LANDSCAPE = "pictorium_rank_sash_stash:landscape"

function stashSashOrder(key: string, order: readonly SashBucket[] | null | undefined): void {
  try {
    if (order && order.length > 0) localStorage.setItem(key, JSON.stringify(order))
  } catch {}
}

function popStashedSashOrder(key: string): SashBucket[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    localStorage.removeItem(key)
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const parsed = parseSashOrder(arr.join(","))
    return parsed && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

/**
 * Whether the ribbon side control (Nuvio/Stremio) is visible. The side
 * switch also mirrors the `number` rank numeral, so it stays reachable
 * when the ranking style is `number` even with the ribbon itself off.
 * Every other style keeps the historic ribbon-only rule.
 */
export function isSideControlVisible(args: {
  ribbonEnabled: boolean | null | undefined
  rankingBadgeStyle: string | null | undefined
}): boolean {
  return !!args.ribbonEnabled || args.rankingBadgeStyle === "number"
}

/** Presentational macro-group disclosure for the Badge tab. The body stays
 *  mounted and hides via `hidden` (no state loss, no tab stops when closed).
 *  Never reports a preview family: child cards keep their own `famAttrs`. */
function BadgeGroup({ id, title, icon: Icon, defaultOpen, children }: {
  id: "style" | "base" | "overlay" | "quality"
  title: string
  icon: typeof Layers
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <section data-testid={`badge-group-${id}`}>
      <button
        type="button"
        data-testid={`badge-group-${id}-toggle`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-1 py-1 min-h-[44px] cursor-pointer touch-manipulation"
      >
        <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
          <Icon className="w-3.5 h-3.5 text-accent-orange" />
          {title}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div id={bodyId} hidden={!open} className="space-y-3.5">
        {children}
      </div>
    </section>
  )
}

/** Badge defaults tab. `shape` selects the edit target (T1 single selector):
 * portrait reads/writes the shared flats, landscape the `landscape` profile.
 * Data sources, endpoints, region, date format and API settings stay global.
 * `onPreviewFamilyChange` (optional) reports which card the user is editing so
 * the preview owner can show a pertinent sample — preview-only, never writes. */
export function BadgeDefaultsSection({ active, shape, onPreviewFamilyChange }: { active: boolean; shape?: BadgeShapeTarget; onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const accentColor = usePSelector((v) => v.accentColor)
  const { isLandscape, scoped } = useShapeBadgeDefaults(shape)
  const targetShape = isLandscape ? "landscape" : "portrait"
  const sashStashKey = isLandscape ? TREND_SASH_STASH_KEY_LANDSCAPE : TREND_SASH_STASH_KEY
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [sashDrag, setSashDrag] = useState<SashBucket | null>(null)

  // Preview-family scope (U2): each card reports its family on explicit press
  // or keyboard focus so the preview shows a pertinent sample. Press (not
  // hover) avoids preview flicker/fetch storms from mere mouse transit.
  // Text-only state lift — never moves focus, never unmounts controls (no
  // focus trap), identical values bail out in the owner setter.
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })

  // Scoped bindings: portrait = shared flats, landscape = profile override.
  const [globalBadges, setGlobalBadges] = scoped("globalBadges", ed.defaultGlobalBadges, ed.setDefaultGlobalBadges)
  const [badgeGenre, setBadgeGenre] = scoped("badgeGenre", ed.defaultBadgeGenre, ed.setDefaultBadgeGenre)
  const [badgeYear, setBadgeYear] = scoped("badgeYear", ed.defaultBadgeYear, ed.setDefaultBadgeYear)
  const [badgeRating, setBadgeRating] = scoped("badgeRating", ed.defaultBadgeRating, ed.setDefaultBadgeRating)
  const [separateRatings, setSeparateRatings] = scoped("separateRatings", ed.defaultSeparateRatings, ed.setDefaultSeparateRatings)
  const [separateRatingsStyle, setSeparateRatingsStyle] = scoped("separateRatingsStyle", ed.defaultSeparateRatingsStyle, ed.setDefaultSeparateRatingsStyle)
  const [customRatings, setCustomRatings] = scoped("customRatings", ed.defaultCustomRatings, ed.setDefaultCustomRatings)
  const [rankingBadges, setRankingBadges] = scoped("rankingBadges", ed.defaultRankingBadges, ed.setDefaultRankingBadges)
  const [sashOrder, setSashOrder] = scoped("sashOrder", ed.defaultSashOrder, ed.setDefaultSashOrder)
  const [preRelease, setPreRelease] = scoped("preRelease", ed.defaultPreRelease, ed.setDefaultPreRelease)
  const [ribbonEnabled, setRibbonEnabled] = scoped("ribbonEnabled", ed.defaultRibbonEnabled, ed.setDefaultRibbonEnabled)
  const [ribbonSide, setRibbonSide] = scoped("ribbonSide", ed.defaultRibbonSide, ed.setDefaultRibbonSide)
  const [badgeQuality, setBadgeQuality] = scoped("badgeQuality", ed.defaultBadgeQuality, ed.setDefaultBadgeQuality)
  const [networkLogo, setNetworkLogo] = scoped("networkLogo", ed.defaultNetworkLogo, ed.setDefaultNetworkLogo)
  const [networkLogoPosition, setNetworkLogoPosition] = scoped("networkLogoPosition", ed.defaultNetworkLogoPosition, ed.setDefaultNetworkLogoPosition)
  const [badgeStyle] = scoped("badgeStyle", ed.defaultBadgeStyle, ed.setDefaultBadgeStyle)
  const [rankingBadgeStyle, setRankingBadgeStyle] = scoped("rankingBadgeStyle", ed.defaultRankingBadgeStyle, ed.setDefaultRankingBadgeStyle)
  const [extraBadgeStyle, setExtraBadgeStyle] = scoped("extraBadgeStyle", ed.defaultExtraBadgeStyle, ed.setDefaultExtraBadgeStyle)
  // Scoped reset: clears only this tab's landscape overrides (numeric and
  // gradient overrides owned by Transform stay intact).
  const hasVisualOverrides = isLandscape && BADGE_VISUAL_LAND_KEYS.some((k) => ed.landscape[k] !== undefined)
  const resetVisualOverrides = () => {
    ed.setLandscape(Object.fromEntries(BADGE_VISUAL_LAND_KEYS.map((k) => [k, undefined])) as Partial<LandscapeServerDefaults>)
  }

  // Rank bucket toggle: surgical rank on/off inside sashOrder (extra and the
  // rest untouched). OFF stashes the exact order under the rank-only target
  // key; ON restores rank at its stashed position without reshuffling the
  // other categories (canonical slot only when no stash exists).
  const rankOn = sashOrder.includes("rank")
  const rankSashStashKey = isLandscape ? RANK_SASH_STASH_KEY_LANDSCAPE : RANK_SASH_STASH_KEY
  function toggleBucket(bucket: SashBucket, on: boolean) {
    // The rank bucket always goes through the stashed path so the advanced
    // priority list and the Classifica switch behave identically.
    if (bucket === "rank") {
      setRankBucket(on)
      return
    }
    const cur = sashOrder
    if (on) {
      if (cur.includes(bucket)) return
      const home = DEFAULT_SASH_ORDER.indexOf(bucket)
      setSashOrder([
        ...cur.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) < home),
        bucket,
        ...cur.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) > home),
      ])
    } else {
      setSashOrder(cur.filter((x) => x !== bucket))
    }
  }
  function setRankBucket(on: boolean) {
    if (on) {
      if (sashOrder.includes("rank" as SashBucket)) return
      const stashed = popStashedSashOrder(rankSashStashKey)
      const home = stashed ? stashed.indexOf("rank" as SashBucket) : -1
      const without = sashOrder.filter((x) => x !== "rank")
      if (stashed && home >= 0) {
        const at = Math.min(home, without.length)
        setSashOrder([...without.slice(0, at), "rank" as SashBucket, ...without.slice(at)])
        return
      }
      const slot = DEFAULT_SASH_ORDER.indexOf("rank" as SashBucket)
      setSashOrder([
        ...without.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) < slot),
        "rank" as SashBucket,
        ...without.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) > slot),
      ])
    } else {
      if (!sashOrder.includes("rank" as SashBucket)) return
      stashSashOrder(rankSashStashKey, sashOrder)
      setSashOrder(sashOrder.filter((x) => x !== "rank"))
    }
  }

  // Single rank appearance (effective rendering): legacy default+ribbon reads
  // Nastro, legacy default without ribbon reads Badge (standard variant).
  const appearance = resolveRankingAppearance({ rankingBadgeStyle: rankingBadgeStyle, ribbonEnabled: ribbonEnabled })
  const variant: RankBadgeVariant = resolveRankVariant(rankingBadgeStyle)
  const ribbonVariant: RankRibbonVariant = resolveRibbonVariant(rankingBadgeStyle)
  // Freeze the legacy extra look before a rank style change moves it
  // (explicit user choice, never on mount): the extra badge keeps its pixels.
  function writeRankingStyle(rs: RankingBadgeStyle) {
    if (extraBadgeStyle == null) setExtraBadgeStyle(legacyExtraStyleForRank(rankingBadgeStyle))
    setRankingBadgeStyle(rs)
  }
  function handleAppearance(a: RankingAppearance) {
    const v = rankingAppearanceValue(a)
    if (v.rankingBadgeStyle === rankingBadgeStyle && v.ribbonEnabled === ribbonEnabled) return
    writeRankingStyle(v.rankingBadgeStyle)
    setRibbonEnabled(v.ribbonEnabled)
  }
  function handleVariant(v: RankBadgeVariant) {
    const next = rankVariantValue(v)
    if (next.rankingBadgeStyle === rankingBadgeStyle && next.ribbonEnabled === ribbonEnabled) return
    writeRankingStyle(next.rankingBadgeStyle)
    setRibbonEnabled(next.ribbonEnabled)
  }
  function handleRibbonVariant(v: RankRibbonVariant) {
    const next = ribbonVariantValue(v)
    if (next.rankingBadgeStyle === rankingBadgeStyle && next.ribbonEnabled === ribbonEnabled) return
    writeRankingStyle(next.rankingBadgeStyle)
    setRibbonEnabled(next.ribbonEnabled)
  }

  // Extra style options: colored only when already set (legacy compat).
  const extraOptions: ExtraBadgeStyle[] = ["default", "pill", "corner", "vetro", "bordo"]
  if (extraBadgeStyle === "colored") extraOptions.push("colored")
  const EXTRA_STYLE_LABELS: Record<ExtraBadgeStyle, string> = {
    default: "ui.bsDefault",
    pill: "ui.pill",
    corner: "ui.corner",
    vetro: "ui.vetro",
    bordo: "ui.bordo",
    colored: "ui.colored",
  }
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Test provider custom rating (sample fisso server-side, chiave mai esposta).
  const [crTestBusy, setCrTestBusy] = useState(false)
  const [crTestResult, setCrTestResult] = useState<{
    ok: boolean
    status: number | null
    ms: number
    ratings?: { id: string; name: string; value: number; format: string }[]
    error?: string
  } | null>(null)

  const runCustomRatingTest = async () => {
    setCrTestBusy(true)
    setCrTestResult(null)
    try {
      // Flush dei default appena digitati: il test gira sulla config salvata.
      await saveDefaults(ed)
      const res = await http("/api/custom-rating/test", { method: "POST" })
      setCrTestResult(res as typeof crTestResult)
    } catch {
      setCrTestResult({ ok: false, status: null, ms: 0, error: "unreachable" })
    } finally {
      setCrTestBusy(false)
    }
  }

  const customRatingTestErrorLabel = (code?: string) => {
    switch (code) {
      case "disabled": return t("ui.customRatingTestErrDisabled")
      case "no-endpoint": return t("ui.customRatingTestErrNoEndpoint")
      case "unsafe-endpoint": return t("ui.customRatingTestErrUnsafe")
      case "http-error": return t("ui.customRatingTestErrHttp")
      case "oversized": return t("ui.customRatingTestErrOversized")
      case "invalid-response": return t("ui.customRatingTestErrInvalid")
      default: return t("ui.customRatingTestErrUnreachable")
    }
  }

  // Quick-preset canonical transform reset (narrow local helper): Naturale
  // assoluto entrambi i formati + topShade 50 + logo null/null/null (auto) +
  // scale 100 (separati via getSeparateBadgeDefaultScale = 130) + offset 0
  // salvo quality portrait -10/+15 e landscape 0/0. Riusa costanti canoniche,
  // mai UI 75 / relativa 100 / baseline rank -20 (solo render).
  function quickTransformPatch(portrait: boolean): Partial<VisualPresetValues> {
    return {
      defaultBlurEnabled: NATURAL_GRADIENT_DEFAULTS.blurEnabled,
      defaultGradientHeight: NATURAL_GRADIENT_DEFAULTS.gradientHeight,
      defaultBlurIntensity: NATURAL_GRADIENT_DEFAULTS.blurIntensity,
      defaultBlurFade: NATURAL_GRADIENT_DEFAULTS.blurFade,
      defaultBlurDarkness: NATURAL_GRADIENT_DEFAULTS.blurDarkness,
      defaultTintStrength: NATURAL_GRADIENT_DEFAULTS.tintStrength,
      defaultTopShade: 50,
      defaultLogoScale: null,
      defaultLogoOffsetX: null,
      defaultLogoOffsetY: null,
      defaultTopBadgeScale: 100,
      defaultTopBadgeOffsetX: 0,
      defaultTopBadgeOffsetY: 0,
      defaultGenreBadgeScale: 100,
      defaultGenreBadgeOffsetX: 0,
      defaultGenreBadgeOffsetY: 0,
      defaultQualityBadgeScale: 100,
      defaultQualityBadgeOffsetX: portrait
        ? DEFAULT_QUALITY_BADGE_OFFSET_X
        : DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
      defaultQualityBadgeOffsetY: portrait
        ? DEFAULT_QUALITY_BADGE_OFFSET_Y
        : DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
      defaultSeparateBadgeScale: getSeparateBadgeDefaultScale(undefined),
      defaultSeparateBadgeOffsetX: 0,
      defaultSeparateBadgeOffsetY: 0,
      defaultNetworkLogoScale: 100,
      defaultNetworkLogoOffsetX: 0,
      defaultNetworkLogoOffsetY: 0,
    }
  }

  // Lettura effettiva del target (portrait = flat, landscape = profilo ?? flat;
  // logo null esplicito preservato: undefined = eredita, null = auto/zero).
  const effTarget = <T,>(landKey: keyof LandscapeServerDefaults, flat: T): T =>
    isLandscape
      ? ((ed.landscape[landKey] as T | undefined) !== undefined
        ? (ed.landscape[landKey] as T)
        : flat)
      : flat

  function matchesQuickTransform(portrait: boolean): boolean {
    const qx = portrait ? DEFAULT_QUALITY_BADGE_OFFSET_X : DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE
    const qy = portrait ? DEFAULT_QUALITY_BADGE_OFFSET_Y : DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE
    return (
      effTarget("blurEnabled", ed.defaultBlurEnabled) === NATURAL_GRADIENT_DEFAULTS.blurEnabled &&
      effTarget("gradientHeight", ed.defaultGradientHeight) === NATURAL_GRADIENT_DEFAULTS.gradientHeight &&
      effTarget("blurIntensity", ed.defaultBlurIntensity) === NATURAL_GRADIENT_DEFAULTS.blurIntensity &&
      effTarget("blurFade", ed.defaultBlurFade) === NATURAL_GRADIENT_DEFAULTS.blurFade &&
      effTarget("blurDarkness", ed.defaultBlurDarkness) === NATURAL_GRADIENT_DEFAULTS.blurDarkness &&
      effTarget("tintStrength", ed.defaultTintStrength) === NATURAL_GRADIENT_DEFAULTS.tintStrength &&
      effTarget("topShade", ed.defaultTopShade) === 50 &&
      effTarget("logoScale", ed.defaultLogoScale) === null &&
      effTarget("logoOffsetX", ed.defaultLogoOffsetX) === null &&
      effTarget("logoOffsetY", ed.defaultLogoOffsetY) === null &&
      effTarget("topBadgeScale", ed.defaultTopBadgeScale) === 100 &&
      effTarget("topBadgeOffsetX", ed.defaultTopBadgeOffsetX) === 0 &&
      effTarget("topBadgeOffsetY", ed.defaultTopBadgeOffsetY) === 0 &&
      effTarget("genreBadgeScale", ed.defaultGenreBadgeScale) === 100 &&
      effTarget("genreBadgeOffsetX", ed.defaultGenreBadgeOffsetX) === 0 &&
      effTarget("genreBadgeOffsetY", ed.defaultGenreBadgeOffsetY) === 0 &&
      effTarget("qualityBadgeScale", ed.defaultQualityBadgeScale) === 100 &&
      effTarget("qualityBadgeOffsetX", ed.defaultQualityBadgeOffsetX) === qx &&
      effTarget("qualityBadgeOffsetY", ed.defaultQualityBadgeOffsetY) === qy &&
      effTarget("separateBadgeScale", ed.defaultSeparateBadgeScale) === getSeparateBadgeDefaultScale(undefined) &&
      effTarget("separateBadgeOffsetX", ed.defaultSeparateBadgeOffsetX) === 0 &&
      effTarget("separateBadgeOffsetY", ed.defaultSeparateBadgeOffsetY) === 0 &&
      effTarget("networkLogoScale", ed.defaultNetworkLogoScale) === 100 &&
      effTarget("networkLogoOffsetX", ed.defaultNetworkLogoOffsetX) === 0 &&
      effTarget("networkLogoOffsetY", ed.defaultNetworkLogoOffsetY) === 0
    )
  }

  const isEssential =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    !badgeRating &&
    !badgeQuality &&
    !rankingBadges &&
    !networkLogo &&
    badgeStyle === "minimal" &&
    matchesQuickTransform(!isLandscape)

  const isRatings =
    globalBadges &&
    !badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    !rankingBadges &&
    !networkLogo &&
    badgeStyle === "pill" &&
    matchesQuickTransform(!isLandscape)

  const isFull =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    rankingBadges &&
    networkLogo &&
    badgeStyle === "pill" &&
    matchesQuickTransform(!isLandscape)

  // Same as the per-title behavior: in bottom, genre/year defaults are
  // render-suppressed but kept (back to Column restores them, never lost).
  const defaultBottomActive =
    globalBadges &&
    badgeRating &&
    separateRatings &&
    isBottomSeparateRatingsStyle(separateRatingsStyle)

  // Quick preset apply: SINGLE atomic target-aware patch con helpers existing
  // (come Apple/personali). Portrait congela l'effettivo landscape ereditato,
  // landscape scrive solo il profilo; globals (ratingSources/logoAlign/fit) e
  // delivery non mutati per isolamento. Il preset parziale contiene solo
  // scelte badge + reset canonico: sash/font/formats e altri default
  // esistenti preservati. Nessun nested `landscape` nel desired: in landscape
  // l'overlay è solo il patch derivato dai flat (mai il profilo corrente sopra
  // il reset). RatingSources NON resettate (rimozione isolamento): Voti/Completo
  // preservano le fonti utente come Apple/personali; i testi restano validi
  // ("Punteggi IMDb/TMDB e qualità" descrive il contenuto, non un reset).
  const applyQuickForTarget = (badgePatch: Partial<VisualPresetValues>) => {
    const live = { ...captureVisualPreset(ed), landscape: ed.landscape }
    const desired = {
      ...badgePatch,
      ...quickTransformPatch(!isLandscape),
    } as unknown as VisualPresetValues
    ed.applyVisualPreset(
      isLandscape ? applyLandscapeIsolated(live, desired) : applyPortraitIsolated(live, desired),
      isLandscape ? "landscape" : "portrait",
    )
  }

  const applyEssential = () => {
    applyQuickForTarget({ defaultGlobalBadges: true, defaultBadgeGenre: true, defaultBadgeYear: true, defaultBadgeRating: false, defaultBadgeQuality: false, defaultRankingBadges: false, defaultNetworkLogo: false, defaultBadgeStyle: "minimal" })
  }

  const applyRatings = () => {
    applyQuickForTarget({ defaultGlobalBadges: true, defaultBadgeGenre: false, defaultBadgeYear: true, defaultBadgeRating: true, defaultSeparateRatings: false, defaultBadgeQuality: true, defaultQualityBadgeStyle: "standard", defaultRankingBadges: false, defaultNetworkLogo: false, defaultBadgeStyle: "pill" })
  }

  const applyFull = () => {
    applyQuickForTarget({ defaultGlobalBadges: true, defaultBadgeGenre: true, defaultBadgeYear: true, defaultBadgeRating: true, defaultSeparateRatings: false, defaultBadgeQuality: true, defaultQualityBadgeStyle: "standard", defaultRankingBadges: true, defaultRankingBadgeStyle: "default", defaultNetworkLogo: true, defaultBadgeStyle: "pill" })
  }

  // Snapshot preset keys that live in the landscape profile: `defaultX` maps
  // to the `x` profile key. Everything else (rating sources, logo align, fit
  // flags, …) stays global. Delivery shape never follows a preset here.
  const PRESET_TO_LAND: Record<string, keyof LandscapeServerDefaults> = {
    defaultGlobalBadges: "globalBadges",
    defaultRankingBadges: "rankingBadges",
    defaultBadgeGenre: "badgeGenre",
    defaultBadgeYear: "badgeYear",
    defaultBadgeRating: "badgeRating",
    defaultBadgeQuality: "badgeQuality",
    defaultCustomRatings: "customRatings",
    defaultSeparateRatings: "separateRatings",
    defaultSeparateRatingsStyle: "separateRatingsStyle",
    defaultBadgeStyle: "badgeStyle",
    defaultRankingBadgeStyle: "rankingBadgeStyle",
    defaultBadgeFont: "badgeFont",
    defaultQualityBadgeStyle: "qualityBadgeStyle",
    defaultVideoFormats: "videoFormats",
    defaultSashOrder: "sashOrder",
    defaultNetworkLogo: "networkLogo",
    defaultNetworkLogoPosition: "networkLogoPosition",
    defaultPreRelease: "preRelease",
    defaultRibbonEnabled: "ribbonEnabled",
    defaultRibbonSide: "ribbonSide",
    defaultLogoScale: "logoScale",
    defaultLogoOffsetX: "logoOffsetX",
    defaultLogoOffsetY: "logoOffsetY",
    defaultBlurEnabled: "blurEnabled",
    defaultBlurIntensity: "blurIntensity",
    defaultBlurFade: "blurFade",
    defaultBlurDarkness: "blurDarkness",
    defaultTintStrength: "tintStrength",
    defaultTopShade: "topShade",
    defaultGradientHeight: "gradientHeight",
    defaultTopBadgeScale: "topBadgeScale",
    defaultTopBadgeOffsetX: "topBadgeOffsetX",
    defaultTopBadgeOffsetY: "topBadgeOffsetY",
    defaultExtraBadgeScale: "extraBadgeScale",
    defaultExtraBadgeOffsetX: "extraBadgeOffsetX",
    defaultExtraBadgeOffsetY: "extraBadgeOffsetY",
    defaultGenreBadgeScale: "genreBadgeScale",
    defaultGenreBadgeOffsetX: "genreBadgeOffsetX",
    defaultGenreBadgeOffsetY: "genreBadgeOffsetY",
    defaultQualityBadgeScale: "qualityBadgeScale",
    defaultQualityBadgeOffsetX: "qualityBadgeOffsetX",
    defaultQualityBadgeOffsetY: "qualityBadgeOffsetY",
    defaultSeparateBadgeScale: "separateBadgeScale",
    defaultSeparateBadgeOffsetX: "separateBadgeOffsetX",
    defaultSeparateBadgeOffsetY: "separateBadgeOffsetY",
    defaultNetworkLogoScale: "networkLogoScale",
    defaultNetworkLogoOffsetX: "networkLogoOffsetX",
    defaultNetworkLogoOffsetY: "networkLogoOffsetY",
  }

  // Snapshot highlight per target (recognition only, never apply/params):
  // portrait = mapped flats + applied globals, ignores the other-format
  // profile and delivery; landscape = preset-covered effective + applied
  // globals, ignores delivery and preserved keys absent from the preset
  // (e.g. extraBadgeStyle). Per-field comparison (no whole-object JSON:
  // nested key order is not canonical). Reuses existing helpers.
  const snapshotHighlightSource = captureVisualPreset(ed)
  function snapshotFieldEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
    return false
  }
  function snapshotGlobalsMatch(cur: VisualPresetValues, preset: VisualPresetValues): boolean {
    return (
      snapshotFieldEqual(cur.defaultRatingSources, preset.defaultRatingSources) &&
      cur.defaultLogoAlign === preset.defaultLogoAlign &&
      cur.defaultPortraitFitEnabled === preset.defaultPortraitFitEnabled &&
      cur.defaultLandscapeFitEnabled === preset.defaultLandscapeFitEnabled
    )
  }
  function matchesSnapshotPreset(preset: VisualPresetValues): boolean {
    if (!snapshotGlobalsMatch(snapshotHighlightSource, preset)) return false
    // Extra-tuning normalized on both sides first (effective extra per
    // axis): legacy looks without explicit extra compare by their own rank
    // tuning, modern explicit extra compares verbatim.
    if (!isLandscape) {
      const cur = portraitPresetPatch(normalizePresetExtraTuning(snapshotHighlightSource)) as unknown as Record<string, unknown>
      const pre = portraitPresetPatch(normalizePresetExtraTuning(preset)) as unknown as Record<string, unknown>
      for (const k of Object.keys(pre)) {
        if (!snapshotFieldEqual(cur[k], pre[k])) return false
      }
      return true
    }
    const curEff = resolveEffectiveLandscape(normalizePresetExtraTuning(snapshotHighlightSource)) as unknown as Record<string, unknown>
    const preEff = resolveEffectiveLandscape(normalizePresetExtraTuning(preset)) as unknown as Record<string, unknown>
    for (const k of Object.keys(preEff)) {
      if (!snapshotFieldEqual(curEff[k], preEff[k])) return false
    }
    return true
  }
  const isBetterPoster = matchesSnapshotPreset(BETTER_POSTER_VISUAL_DEFAULTS)
  const isRpdb = matchesSnapshotPreset(RPDB_VISUAL_DEFAULTS)

  // Apple builtin, stesso path isolato dei preset personali (mai lo snapshot
  // con globali condivisi di BetterPoster/RPDB): portrait scrive solo i flat
  // mappati congelando l'effettivo dell'altro formato, landscape solo il
  // profilo. Fonti voti, logo align, fit flag e delivery restano intatti in
  // entrambi i target. `live` fonde il profilo RAW (extra fuori contratto,
  // es. chiavi server, sopravvivono all'apply); l'highlight confronta la
  // proiezione intera per forma (flat mappati in portrait, effettivo
  // landscape in orizzontale), mai un subset di chiavi.
  const appleLive = { ...captureVisualPreset(ed), landscape: ed.landscape }
  const appleHighlightSource = captureVisualPreset(ed)
  const isApple =
    JSON.stringify(
      normalizePresetExtraTuning(isLandscape ? resolveEffectiveLandscape(appleHighlightSource) : portraitPresetPatch(appleHighlightSource)),
    ) ===
    JSON.stringify(
      normalizePresetExtraTuning(isLandscape ? resolveEffectiveLandscape(APPLE_VISUAL_DEFAULTS) : portraitPresetPatch(APPLE_VISUAL_DEFAULTS)),
    )
  const applyApple = () => {
    ed.applyVisualPreset(
      isLandscape
        ? applyLandscapeIsolated(appleLive, APPLE_VISUAL_DEFAULTS)
        : applyPortraitIsolated(appleLive, APPLE_VISUAL_DEFAULTS),
      isLandscape ? "landscape" : "portrait",
    )
  }

  // Snapshot presets apply to the edit target only: landscape-capable keys
  // go to the profile, truly shared globals go to root, delivery shape and
  // the preset's own nested landscape never touch anything else. Single
  // setLandscape call plus distinct root keys: no stale-merge loss.
  const applySnapshotForTarget = (values: VisualPresetValues) => {
    if (!isLandscape) {
      // Portrait target: flats only; the existing landscape profile and the
      // delivery shape stay byte-identical.
      ed.applyVisualPreset({ ...values, landscape: ed.landscape, defaultPosterShape: ed.defaultPosterShape }, "portrait")
      return
    }
    const landPatch: Partial<LandscapeServerDefaults> = {}
    for (const [k, v] of Object.entries(values)) {
      if (k === "defaultPosterShape" || k === "landscape") continue
      const lk = PRESET_TO_LAND[k]
      if (lk) (landPatch as Record<string, unknown>)[lk] = v
    }
    if (values.landscape) Object.assign(landPatch, values.landscape)
    // Legacy preset without profile extra: clear to null (follow the
    // preset's own landscape rank); explicit wins; flats untouched (the
    // other shape). No setLandscape materialization here: a full look
    // apply is not a single classifica edit.
    const clearedLandExtra = clearedExtraForPresetApply(
      { scale: landPatch.topBadgeScale, offsetX: landPatch.topBadgeOffsetX, offsetY: landPatch.topBadgeOffsetY },
      { scale: landPatch.extraBadgeScale, offsetX: landPatch.extraBadgeOffsetX, offsetY: landPatch.extraBadgeOffsetY },
    )
    if (clearedLandExtra) {
      landPatch.extraBadgeScale = clearedLandExtra.scale
      landPatch.extraBadgeOffsetX = clearedLandExtra.offsetX
      landPatch.extraBadgeOffsetY = clearedLandExtra.offsetY
    }
    ed.setLandscape(landPatch, { materialize: false })
    ed.setDefaultRatingSources(values.defaultRatingSources)
    ed.setDefaultLogoAlign(values.defaultLogoAlign)
    ed.setDefaultPortraitFitEnabled(values.defaultPortraitFitEnabled)
    ed.setDefaultLandscapeFitEnabled(values.defaultLandscapeFitEnabled)
  }

  const applyBetterPoster = () => {
    applySnapshotForTarget(BETTER_POSTER_VISUAL_DEFAULTS)
  }

  const applyRpdb = () => {
    applySnapshotForTarget(RPDB_VISUAL_DEFAULTS)
  }

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.badgeSection")}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* CARD 0: Configurazioni Rapide Iniziali */}
      {hasVisualOverrides && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetVisualOverrides}
            title={t("ui.formatTargetHint")}
            className="shrink-0 text-[11px] font-semibold text-muted hover:text-zinc-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2.5 py-1 transition-colors cursor-pointer"
          >
            {t("ui.reset")} · {t("ui.posterShapeLandscape")}
          </button>
        </div>
      )}
      {/* Style & Presets: quick presets, genre style, extra style */}
      <BadgeGroup id="style" title={t("ui.badgeGroupStyle")} icon={Palette} defaultOpen>
      <div {...famAttrs("auto")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.configPresetTitle")}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono">1-click</span>
        </div>
        <p className="text-[11px] text-zinc-400 -mt-1">
          {t("ui.configPresetDesc")}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 pt-0.5">
          <button
            type="button"
            onClick={applyEssential}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isEssential
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetEssential")}</span>
              {isEssential && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetEssentialDesc")}</span>
          </button>

          <button
            type="button"
            onClick={applyRatings}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isRatings
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetRatings")}</span>
              {isRatings && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetRatingsDesc")}</span>
          </button>

          <button
            type="button"
            onClick={applyFull}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isFull
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetFull")}</span>
              {isFull && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetFullDesc")}</span>
          </button>

          <button
            type="button"
            onClick={applyBetterPoster}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isBetterPoster
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetBetterPoster")}</span>
              {isBetterPoster && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetBetterPosterDesc")}</span>
          </button>

          <button
            type="button"
            onClick={applyRpdb}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isRpdb
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetRpdb")}</span>
              {isRpdb && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetRpdbDesc")}</span>
          </button>

          <button
            type="button"
            onClick={applyApple}
            className={`flex flex-col text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
              isApple
                ? "bg-accent-orange/15 border-accent-orange/60 text-foreground shadow-sm ring-1 ring-accent-orange/30"
                : "bg-surface2/40 hover:bg-surface2/70 border-surface2 text-zinc-300 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-xs text-foreground">{t("ui.configPresetApple")}</span>
              {isApple && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
            </div>
            <span className="text-[10px] text-zinc-400 mt-1 leading-snug">{t("ui.configPresetAppleDesc")}</span>
          </button>
        </div>
        <p className="text-[10px] text-zinc-500 italic leading-snug pt-0.5">
          {t("ui.configPresetUnofficialNote")}
        </p>
      </div>

      <GenreStyleSection shape={targetShape} onPreviewFamilyChange={onPreviewFamilyChange} />
      {/* Extra badge style: own look, never a fallback.
          Without an explicit choice it shows the effective inherited style. */}
      <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
        <div className="space-y-1.5">
          <span className="text-[11px] text-muted font-medium block">{t("ui.extraBadgeStyle")}</span>
          {extraBadgeStyle == null && (
            <p className="text-[10px] text-muted italic leading-tight">
              {t("ui.inherited")}: {t(EXTRA_STYLE_LABELS[legacyExtraStyleForRank(rankingBadgeStyle)])}
            </p>
          )}
          <BadgeStyleSelector
            value={extraBadgeStyle ?? legacyExtraStyleForRank(rankingBadgeStyle)}
            options={extraOptions}
            onChange={(v) => {
              setExtraBadgeStyle(v)
            }}
            t={t}
            accentColor={accentColor}
          />
        </div>
      </div>
      </BadgeGroup>

      {/* Base content: genre/year toggles, ratings */}
      <BadgeGroup id="base" title={t("ui.badgeGroupBase")} icon={Layers} defaultOpen>

      {/* Base genre/year toggles (info family kept for the preview sample) */}
      <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.titleInfoFamily")}
        </span>

        {/* Master Toggle Genere / Rating */}
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              {t("ui.genreRatingBadge")}
            </span>
            <Toggle
              value={globalBadges}
              onChange={(v) => {
                setGlobalBadges(v)
              }}
              label={t("ui.genreRatingBadge")}
            />
          </div>

          {/* Sub-controlli Genere / Anno / Voto */}
          {globalBadges && (
            <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
              <div className={`flex items-center justify-between ${defaultBottomActive ? "opacity-50" : ""}`} title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={defaultBottomActive || undefined}>
                <span className="text-muted">{t("ui.badgeGenre")}</span>
                <Toggle
                  value={badgeGenre}
                  onChange={(v) => {
                    if (!defaultBottomActive) setBadgeGenre(v)
                  }}
                  label={t("ui.badgeGenre")}
                  disabled={defaultBottomActive}
                />
              </div>
              <div className={`flex items-center justify-between ${defaultBottomActive ? "opacity-50" : ""}`} title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={defaultBottomActive || undefined}>
                <span className="text-muted">{t("ui.badgeYear")}</span>
                <Toggle
                  value={badgeYear}
                  onChange={(v) => {
                    if (!defaultBottomActive) setBadgeYear(v)
                  }}
                  label={t("ui.badgeYear")}
                  disabled={defaultBottomActive}
                />
              </div>
            </div>
          )}

          </div>
        </div>

      {/* CARD Ratings: vote, separate, sources, custom */}
      <div {...famAttrs("ratings")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("ui.ratingsFamily")}
        </span>
        <div className="space-y-2">
          {globalBadges && (
            <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("ui.badgeRating")}</span>
                <Toggle
                  value={badgeRating}
                  onChange={(v) => {
                    setBadgeRating(v)
                  }}
                  label={t("ui.badgeRating")}
                />
              </div>
              {badgeRating && (
                <div className="flex items-center justify-between" title={t("ui.separateRatingsHint")}>
                  <span className="text-muted">{t("ui.separateRatings")}</span>
                  <Toggle value={separateRatings} onChange={(v) => setSeparateRatings(v)} label={t("ui.separateRatings")} />
                </div>
              )}
              {badgeRating && separateRatings && (
                <div className="pt-1 space-y-1.5" title={t("ui.separateRatingsHint")}>
                  <span className="text-[11px] text-muted font-medium block">{t("ui.separateRatingsStyle")}</span>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      { id: "column", labelKey: "ui.separateRatingsColumn" },
                      { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
                      { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
                      { id: "bottom-mono", labelKey: "ui.separateRatingsBottomMono" },
                      { id: "bottom-color", labelKey: "ui.separateRatingsBottomColor" },
                    ] as const).map((opt) => {
                      // Bar disabled on the landscape target (server normalizes
                      // to pills): raw value kept, never hidden.
                      const barOff = opt.id === "bottom-bar" && targetShape === "landscape"
                      const pressed = getSeparateRatingsStyleForShape(
                        separateRatingsStyle, targetShape === "landscape" ? "landscape" : "poster",
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
                  {targetShape === "landscape" && (
                    <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBarLandscapeHint")}</p>
                  )}
                  {globalBadges && badgeRating && separateRatings && isBottomSeparateRatingsStyle(separateRatingsStyle) && (
                    <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBottomHint")}</p>
                  )}
                </div>
              )}

              {/* Rating sources stay global in both targets. */}
              {badgeRating && (
                <div className="pt-2 pb-1 space-y-2 border-t border-surface2/50">
                  <button
                    type="button"
                    onClick={() => setSourcesOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 hover:text-foreground border border-surface2 transition-all group cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400/30" />
                      <span>{t("ui.ratingSources")}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-accent-orange/15 text-accent-orange font-semibold border border-accent-orange/30">
                        {(ed.defaultRatingSources ?? ["imdb", "tmdb"]).length}/16
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted group-hover:text-zinc-200 font-medium">
                      <span>{sourcesOpen ? t("ui.close") : t("ui.configure")}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                          sourcesOpen ? "rotate-180" : ""
                        }`}
                      />
                    </span>
                  </button>

                  {sourcesOpen && (
                    <div className="space-y-2 pt-0.5 animate-fade-in">
                      <div className="flex items-center justify-between px-0.5">
                        <span className="text-[10px] text-muted leading-tight">
                          {t("ui.ratingSourcesHint")}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => {
                              const all = UI_RATING_SOURCES.map((s) => s.id)
                              ed.setDefaultRatingSources(all)
                            }}
                            className="text-accent-orange hover:underline font-semibold transition-colors cursor-pointer"
                          >
                            {t("ui.enableAll")}
                          </button>
                          <span className="text-zinc-600">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              const def = ["imdb"]
                              ed.setDefaultRatingSources(def)
                            }}
                            className="text-muted hover:text-zinc-200 transition-colors cursor-pointer"
                          >
                            {t("ui.sourcesImdbOnly")}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                        {UI_RATING_SOURCES.map((s) => {
                          const current = ed.defaultRatingSources ?? ["imdb", "tmdb"]
                          const isSelected = current.includes(s.id)
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  if (current.length > 1) {
                                    const updated = current.filter((x) => x !== s.id)
                                    ed.setDefaultRatingSources(updated)
                                  }
                                } else {
                                  const updated = [...current, s.id]
                                  ed.setDefaultRatingSources(updated)
                                }
                              }}
                              className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] transition-all duration-150 border cursor-pointer ${
                                isSelected
                                  ? "bg-accent-orange/[0.12] border-accent-orange/35 text-zinc-100 font-medium shadow-sm"
                                  : "bg-white/[0.03] border-white/[0.04] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 hover:border-white/[0.08]"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <RatingSourceIcon id={s.id} className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{t(s.labelKey)}</span>
                              </span>
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ml-1 transition-colors ${
                                  isSelected ? "bg-accent-orange shadow-sm shadow-accent-orange/50" : "bg-zinc-700"
                                }`}
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Voti Personalizzati */}
          <div className="pt-1">
            <div className="flex items-center justify-between" title={t("ui.customRatingsHint")}>
              <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-teal-400" />
                {t("ui.customRatings")}
              </span>
              <Toggle
                value={customRatings}
                onChange={(v) => {
                  setCustomRatings(v)
                }}
                label={t("ui.customRatings")}
              />
            </div>

            {customRatings && (
              <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in mt-1.5">
                <div>
                  <label className="text-[11px] text-muted block mb-1">{t("ui.customRatingEndpoint")}</label>
                  <input
                    type="url"
                    value={ed.defaultCustomRatingEndpoint ?? ""}
                    onChange={(e) => ed.setDefaultCustomRatingEndpoint(e.target.value)}
                    placeholder="https://example.com/ratings/{imdbId}"
                    maxLength={500}
                    className="w-full text-xs font-mono py-1.5 px-2.5 rounded-lg bg-black/40 border border-white/10 text-foreground placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
                  />
                </div>
                <p className="text-[11px] text-zinc-400 italic">{t("ui.customRatingKeyHint")}</p>
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={crTestBusy}
                    onClick={runCustomRatingTest}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {crTestBusy ? t("ui.customRatingTesting") : t("ui.customRatingTest")}
                  </button>
                  {crTestResult && (
                    <div className={`mt-2 p-2 rounded-lg border text-[11px] ${crTestResult.ok ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                      {crTestResult.ok ? (
                        <div className="space-y-1">
                          <div className="font-semibold text-emerald-300">
                            {t("ui.customRatingTestOk")} · {crTestResult.status} OK · {crTestResult.ms} ms
                          </div>
                          {crTestResult.ratings?.map((r) => (
                            <div key={r.id} className="flex items-center justify-between text-zinc-200">
                              <span className="truncate">{r.name}</span>
                              <span className="font-mono ml-2 shrink-0">{formatRating(r.value, r.format as "decimal" | "percent")}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-red-300">
                          {customRatingTestErrorLabel(crTestResult.error)}
                          {crTestResult.status ? ` · ${crTestResult.status}` : ""} · {crTestResult.ms} ms
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </BadgeGroup>

      {/* Special overlays: ranking, sash, network, prerelease */}
      <BadgeGroup id="overlay" title={t("ui.badgeGroupOverlay")} icon={Trophy} defaultOpen={false}>
      {/* CARD Rankings: rank bucket + single appearance + position */}
      <div {...famAttrs("rank")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-amber-500" />
          {t("ui.rankFamily")}
        </span>
        <p className="text-[11px] text-zinc-400 italic -mt-1">{t("ui.badgeDefaultsHint")}</p>

        {/* Top badge master (legacy): general switch for top badges */}
        <div className="flex items-center justify-between py-1">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            {t("ui.topBadge")}
          </span>
          <Toggle
            value={rankingBadges}
            onChange={(v) => {
              setRankingBadges(v)
              if (v) {
                // Master ON restores this target's categories (or all).
                setSashOrder(popStashedSashOrder(sashStashKey) ?? [...DEFAULT_SASH_ORDER])
              } else {
                // Master OFF clears this target's sash; single categories
                // stay switchable below.
                stashSashOrder(sashStashKey, sashOrder)
                setSashOrder([])
              }
            }}
            label={t("ui.topBadge")}
          />
        </div>
        <p className="text-[11px] text-zinc-400 italic mt-1">{t("ui.trendDefaultHint")}</p>

        {/* Rankings toggle: rank bucket only, extra and the rest untouched */}
        <div className="flex items-center justify-between py-1">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            {t("ui.sash_rank")}
          </span>
          <Toggle
            value={rankOn}
            onChange={(v) => setRankBucket(v)}
            label={t("ui.sash_rank")}
          />
        </div>

        <div className="pt-1">
          <RankingAppearanceSelector
            appearance={appearance}
            variant={variant}
            ribbonVariant={ribbonVariant}
            side={ribbonSide}
            onAppearance={handleAppearance}
            onVariant={handleVariant}
            onRibbonVariant={handleRibbonVariant}
            onSide={(s) => setRibbonSide(s)}
          />
        </div>
      </div>

      {/* Sash categories (info family kept for the preview sample) */}
      <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
        <span className="text-[11px] text-muted font-medium block">{t("ui.sashTitle")}</span>
        <div className="space-y-1.5">
          {(["upcoming", "new", "award", "extra"] as const).map((b) => (
            <div key={b} className="flex items-center justify-between">
              <span className="text-muted">{t(`ui.sash_${b}`)}</span>
              <Toggle
                value={sashOrder.includes(b)}
                onChange={(v) => toggleBucket(b, v)}
                label={t(`ui.sash_${b}`)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Coming Soon: release state only. The angular ribbon follows the
          shared legacy ribbon flag (no independent switch on purpose). */}
      <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm" title={t("ui.preReleaseHint")}>
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            {t("ui.preRelease")}
          </span>
          <Toggle
            value={preRelease}
            onChange={(v) => {
              setPreRelease(v)
            }}
            label={t("ui.preRelease")}
          />
        </div>
      </div>

      {/* Advanced: global top-badge priority (a single badge wins) */}
      <div {...famAttrs("info")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 hover:text-foreground border border-surface2 transition-all cursor-pointer"
          >
            <span className="text-[11px] font-semibold">{t("ui.advancedBadgePriority")}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                advancedOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <p className="text-[10px] text-muted italic leading-tight mt-1">{t("ui.singleBadgeHint")}</p>
          {advancedOpen && (
          <div className="space-y-1.5 pt-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted block">
              {t("ui.sashTitle")}
            </span>
            <div className="space-y-1.5">
              {(() => {
                const sash = sashOrder ?? [...DEFAULT_SASH_ORDER]
                // Enabled buckets in saved order, disabled ones appended canonically.
                const ordered: SashBucket[] = [...sash, ...SASH_BUCKETS.filter((b) => !sash.includes(b))]
                const drop = (target: SashBucket) => {
                  if (sashDrag && sashDrag !== target) {
                    setSashOrder(moveSashItem(sash, sashDrag, sash.indexOf(target)))
                  }
                  setSashDrag(null)
                }
                return ordered.map((b) => {
                  const isOn = sash.includes(b)
                  const dragging = sashDrag === b
                  return (
                    <div key={b}
                         draggable={isOn}
                         onDragStart={() => { if (isOn) setSashDrag(b) }}
                         onDragEnd={() => setSashDrag(null)}
                         onDragOver={isOn ? (e) => e.preventDefault() : undefined}
                         onDrop={isOn ? (e) => { e.preventDefault(); drop(b) } : undefined}
                         className={`flex items-center justify-between gap-1 rounded-md select-none ${dragging ? "opacity-40" : ""} ${sashDrag && !dragging && isOn ? "outline outline-1 outline-accent/30" : ""}`}>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        {isOn && (
                          <span title={t("ui.dragOne")}
                                className="pointer-coarse:hidden cursor-grab active:cursor-grabbing p-1 rounded-md hover:bg-white/10 text-muted hover:text-accent transition-colors">
                            <Menu className="w-4 h-4 stroke-[2.5]" />
                          </span>
                        )}
                        <span className={`text-zinc-300 font-medium ${isOn ? "" : "opacity-50"}`}>{t(`ui.sash_${b}`)}</span>
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <Toggle
                          value={isOn}
                          onChange={(v) => toggleBucket(b, v)}
                          label={t(`ui.sash_${b}`)}
                        />
                      </span>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Network logo (quality family kept, overlay placement only) */}
      <div {...famAttrs("quality")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Tv className="w-3.5 h-3.5 text-sky-400" />
              {t("ui.networkLogo")}
            </span>
            <Toggle
              value={networkLogo}
              onChange={(v) => {
                setNetworkLogo(v)
              }}
              label={t("ui.networkLogo")}
            />
          </div>

          {networkLogo && (
            <div className="flex items-center justify-between gap-3" title={t("ui.networkLogoPosition")}>
              <span className="text-zinc-400 font-medium text-[11px] pl-5">
                {t("ui.networkLogoPosition")}
              </span>
              <div className="flex gap-1 flex-1 max-w-[190px]">
                {(["auto", "top"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setNetworkLogoPosition(pos)}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                      networkLogoPosition === pos
                        ? "bg-white/20 text-foreground shadow-sm"
                        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                    }`}
                  >
                    {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </BadgeGroup>

      {/* Quality & formats: quality badge, style, formats */}
      <BadgeGroup id="quality" title={t("ui.badgeGroupQuality")} icon={Tv} defaultOpen={false}>
      {/* Quality toggle card */}
      <div {...famAttrs("quality")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        {/* Specifiche Tecniche & Network */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t("ui.badgeQuality")}
            </span>
            <Toggle
              value={badgeQuality}
              onChange={(v) => {
                setBadgeQuality(v)
              }}
              label={t("ui.badgeQuality")}
            />
          </div>
        </div>
      </div>

      <QualityStyleSection shape={targetShape} qualityEnabled={badgeQuality} onPreviewFamilyChange={onPreviewFamilyChange} />
      </BadgeGroup>
    </div>
  )
}
