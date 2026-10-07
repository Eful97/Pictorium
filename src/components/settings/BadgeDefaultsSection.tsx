"use client"

import { useState } from "react"
import { ChevronDown, Flame, Layers, Menu, Sparkles, Star, Trophy, Tv, Check } from "lucide-react"
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
import { isBottomSeparateRatingsStyle, getSeparateRatingsStyleForShape } from "@/lib/badge-styles"
import { BadgeStyleSection } from "@/components/settings/BadgeStyleSection"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { UI_RATING_SOURCES } from "@/lib/rating-weights"
import { SASH_BUCKETS, DEFAULT_SASH_ORDER, parseSashOrder, moveSashItem, type SashBucket } from "@/lib/badge-priority"
import { formatRating } from "@/lib/custom-rating/formatter"
import { saveDefaults } from "@/lib/save-defaults"
import { http } from "@/lib/http"
import { captureVisualPreset } from "@/lib/visual-presets"
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

  const isEssential =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    !badgeRating &&
    !badgeQuality &&
    !rankingBadges &&
    !networkLogo &&
    badgeStyle === "minimal"

  const isRatings =
    globalBadges &&
    !badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    !rankingBadges &&
    !networkLogo &&
    badgeStyle === "pill"

  const isFull =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    rankingBadges &&
    networkLogo &&
    badgeStyle === "pill"

  // Same as the per-title behavior: in bottom, genre/year defaults are
  // render-suppressed but kept (back to Column restores them, never lost).
  const defaultBottomActive =
    globalBadges &&
    badgeRating &&
    separateRatings &&
    isBottomSeparateRatingsStyle(separateRatingsStyle)

  const applyEssential = () => {
    if (!isLandscape) {
      ed.setDefaultGlobalBadges(true)
      ed.setDefaultBadgeGenre(true)
      ed.setDefaultBadgeYear(true)
      ed.setDefaultBadgeRating(false)
      ed.setDefaultBadgeQuality(false)
      ed.setDefaultRankingBadges(false)
      ed.setDefaultNetworkLogo(false)
      ed.setDefaultBadgeStyle("minimal")
      return
    }
    ed.setLandscape({ globalBadges: true, badgeGenre: true, badgeYear: true, badgeRating: false, badgeQuality: false, rankingBadges: false, networkLogo: false, badgeStyle: "minimal" })
  }

  const applyRatings = () => {
    // Rating sources stay global in both targets.
    ed.setDefaultRatingSources(["imdb", "tmdb"])
    if (!isLandscape) {
      ed.setDefaultGlobalBadges(true)
      ed.setDefaultBadgeGenre(false)
      ed.setDefaultBadgeYear(true)
      ed.setDefaultBadgeRating(true)
      ed.setDefaultSeparateRatings(false)
      ed.setDefaultBadgeQuality(true)
      ed.setDefaultQualityBadgeStyle("standard")
      ed.setDefaultRankingBadges(false)
      ed.setDefaultNetworkLogo(false)
      ed.setDefaultBadgeStyle("pill")
      return
    }
    ed.setLandscape({ globalBadges: true, badgeGenre: false, badgeYear: true, badgeRating: true, separateRatings: false, badgeQuality: true, qualityBadgeStyle: "standard", rankingBadges: false, networkLogo: false, badgeStyle: "pill" })
  }

  const applyFull = () => {
    // Rating sources stay global in both targets.
    ed.setDefaultRatingSources(["imdb", "tmdb"])
    if (!isLandscape) {
      ed.setDefaultGlobalBadges(true)
      ed.setDefaultBadgeGenre(true)
      ed.setDefaultBadgeYear(true)
      ed.setDefaultBadgeRating(true)
      ed.setDefaultSeparateRatings(false)
      ed.setDefaultBadgeQuality(true)
      ed.setDefaultQualityBadgeStyle("standard")
      ed.setDefaultRankingBadges(true)
      ed.setDefaultRankingBadgeStyle("default")
      ed.setDefaultNetworkLogo(true)
      ed.setDefaultBadgeStyle("pill")
      return
    }
    ed.setLandscape({ globalBadges: true, badgeGenre: true, badgeYear: true, badgeRating: true, separateRatings: false, badgeQuality: true, qualityBadgeStyle: "standard", rankingBadges: true, rankingBadgeStyle: "default", networkLogo: true, badgeStyle: "pill" })
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

  // Full snapshots read through the edit target, so the highlight matches
  // what this tab edits (root in portrait, profile in landscape).
  const presetSource = (() => {
    const base = captureVisualPreset(ed)
    if (!isLandscape) return base
    const eff = { ...base }
    for (const [presetKey, landKey] of Object.entries(PRESET_TO_LAND)) {
      const lv = ed.landscape[landKey]
      if (lv !== undefined) (eff as Record<string, unknown>)[presetKey] = lv
    }
    return eff
  })()
  const currentVisualSnapshot = JSON.stringify(captureVisualPreset(presetSource))
  const isBetterPoster =
    currentVisualSnapshot === JSON.stringify(BETTER_POSTER_VISUAL_DEFAULTS)
  const isRpdb = currentVisualSnapshot === JSON.stringify(RPDB_VISUAL_DEFAULTS)

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
      isLandscape ? resolveEffectiveLandscape(appleHighlightSource) : portraitPresetPatch(appleHighlightSource),
    ) ===
    JSON.stringify(
      isLandscape ? resolveEffectiveLandscape(APPLE_VISUAL_DEFAULTS) : portraitPresetPatch(APPLE_VISUAL_DEFAULTS),
    )
  const applyApple = () => {
    ed.applyVisualPreset(
      isLandscape
        ? applyLandscapeIsolated(appleLive, APPLE_VISUAL_DEFAULTS)
        : applyPortraitIsolated(appleLive, APPLE_VISUAL_DEFAULTS),
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
      ed.applyVisualPreset({ ...values, landscape: ed.landscape, defaultPosterShape: ed.defaultPosterShape })
      return
    }
    const landPatch: Partial<LandscapeServerDefaults> = {}
    for (const [k, v] of Object.entries(values)) {
      if (k === "defaultPosterShape" || k === "landscape") continue
      const lk = PRESET_TO_LAND[k]
      if (lk) (landPatch as Record<string, unknown>)[lk] = v
    }
    if (values.landscape) Object.assign(landPatch, values.landscape)
    ed.setLandscape(landPatch)
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

      {/* CARD Title info: genre/year, extra style, categories, Coming Soon */}
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

        {/* Extra badge style: own look, never a fallback.
            Without an explicit choice it shows the effective inherited style. */}
        <div className="pt-1 space-y-1.5">
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

        {/* Non-rank sash categories (top badge family, always reachable) */}
        <div className="pt-1 space-y-1.5">
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

        {/* Coming Soon: release state only. The angular ribbon follows the
            shared legacy ribbon flag (no independent switch on purpose). */}
        <div className="pt-1 space-y-1.5" title={t("ui.preReleaseHint")}>
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
                  <div className="flex gap-1">
                    {([
                      { id: "column", labelKey: "ui.separateRatingsColumn" },
                      { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
                      { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
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

      {/* CARD Quality & Network */}
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

      {/* Stili Grafici Predefiniti */}
      <BadgeStyleSection shape={targetShape} qualityEnabled={badgeQuality} onPreviewFamilyChange={onPreviewFamilyChange} />
    </div>
  )
}
