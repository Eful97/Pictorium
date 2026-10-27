"use client"

import { useEffect, useState, useId, type ReactNode } from "react"
import { ChevronDown, Flame, Layers, Menu, Palette, SlidersHorizontal, Sparkles, Star, Trophy, Tv } from "lucide-react"
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
  type RankingPresentation,
  type RankBadgeVariant,
  type RankRibbonVariant,
} from "@/components/RankingAppearanceSelector"
import { type ExtraBadgeStyle, type RankingBadgeStyle } from "@/lib/badge-styles"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { Toggle } from "@/components/Toggle"
import { PosterStyleCard } from "@/components/settings/PosterStyleCard"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"
import { REGIONS } from "@/lib/regions"
import { PosterLayoutSelector } from "@/components/PosterLayoutSelector"
import { isCardSkin, type CardSkin } from "@/lib/card-layout-skins"
import { BadgeStyleSelector, BadgeFontSelector } from "@/components/ui"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import type { PosterElementId } from "@/components/settings/PosterElementNavigation"
import { isBottomSeparateRatingsStyle, getSeparateRatingsStyleForShape, DEFAULT_AGE_BADGE_STYLE, DEFAULT_BADGE_FONT, DEFAULT_QUALITY_BADGE_STYLE, DEFAULT_SEPARATE_RATINGS_STYLE, EXTRA_BADGE_FOLLOW_RANK, DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y, DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE, DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE, getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import { DEFAULT_AGE_COUNTRY } from "@/lib/certification"
import { KNOWN_VIDEO_FORMATS } from "@/lib/av-specs"
import { NATURAL_GRADIENT_DEFAULTS } from "@/lib/gradient-presets"
import { QUICK_BADGE_PATCHES, quickTransformPatch as sharedQuickTransformPatch, withReadyPresetExtraStyleReset } from "@/lib/quick-visual-presets"
import { GenreStyleSection, QualityStyleSection } from "@/components/settings/BadgeStyleSection"
import { AvailabilityGate, availabilityDisplayState, isAgeStyleActive, isBadgeFontActive, isCustomRatingsActive, isExtraStyleActive, isGenreStyleActive, isQualityStyleActive, isSeparateStyleActive, orderActiveFirst, type EffectiveBadgeFlags } from "@/components/settings/SettingsElementAvailability"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { UI_RATING_SOURCES } from "@/lib/rating-weights"
import { SASH_BUCKETS, DEFAULT_SASH_ORDER, parseSashOrder, moveSashItem, type SashBucket } from "@/lib/badge-priority"
import { formatRating } from "@/lib/custom-rating/formatter"
import { saveDefaults } from "@/lib/save-defaults"
import { http } from "@/lib/http"
import { captureVisualPreset, normalizePresetExtraTuning, independentLandscapeDefaults } from "@/lib/visual-presets"
import { clearedExtraForPresetApply } from "@/lib/extra-materialize"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  withReadyPresetAgeOff,
  withReadyPresetLayoutStandard,
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

// Staged-mode stash (five-tab settings): in-memory per edit target, never
// localStorage and never a durable config write before the global Save.
// Standalone (mode undefined) keeps the legacy localStorage stash.
const stagedStash = new Map<string, SashBucket[]>()

function stashSashOrder(key: string, order: readonly SashBucket[] | null | undefined, staged?: boolean): void {
  if (staged) {
    if (order && order.length > 0) stagedStash.set(key, [...order])
    return
  }
  try {
    if (order && order.length > 0) localStorage.setItem(key, JSON.stringify(order))
  } catch {}
}

function popStashedSashOrder(key: string, staged?: boolean): SashBucket[] | null {
  if (staged) {
    const hit = stagedStash.get(key) ?? null
    if (hit) stagedStash.delete(key)
    return hit && hit.length > 0 ? hit : null
  }
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
function BadgeGroup({ id, title, icon: Icon, defaultOpen, hidden, children, bare }: {
  id: "style" | "base" | "overlay" | "quality"
  title: string
  icon: typeof Layers
  defaultOpen: boolean
  hidden?: boolean
  children: ReactNode
  /** Family mode: selected element cards shown directly, no macro heading. */
  bare?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  if (bare) {
    return (
      <div data-testid={`badge-group-${id}`} hidden={hidden} className="space-y-3.5">
        {children}
      </div>
    )
  }
  return (
    <section data-testid={`badge-group-${id}`} hidden={hidden}>
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

/** Common badge font (single existing selector, moved outside the genre
 *  gate): the same BadgeFontSelector + target scoping as GenreStyleSection,
 *  rendered once outside the genre AvailabilityGate so a disabled genre
 *  fieldset never traps it. Gated by the canonical isBadgeFontActive over the
 *  effective flags (common text style): with no supported font consumer
 *  active the whole group unmounts — never an orphan disclosure/hint. */
function CommonFontCard({ shape, onPreviewFamilyChange, flags }: { shape?: BadgeShapeTarget; onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void; flags: EffectiveBadgeFlags }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const { scoped } = useShapeBadgeDefaults(shape)
  const [badgeFont, setBadgeFont] = scoped("badgeFont", ed.defaultBadgeFont, ed.setDefaultBadgeFont)
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  const fontActive = isBadgeFontActive(flags)
  if (!fontActive) return null
  return (
    <div {...famAttrs("genre")} data-testid="badge-common-font" className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
      <label className="text-[11px] text-muted font-medium block">{t("ui.badgeFont")}</label>
      <BadgeFontSelector value={badgeFont} onChange={(v) => setBadgeFont(v)} />
    </div>
  )
}

/** Badge defaults tab. `shape` selects the edit target (T1 single selector):
 * portrait reads/writes the shared flats, landscape the `landscape` profile.
 * Data sources, endpoints, region, date format and API settings stay global.
 * `onPreviewFamilyChange` (optional) reports which card the user is editing so
 * the preview owner can show a pertinent sample — preview-only, never writes. */
export type BadgeDefaultsMode = "rankings" | "information" | "appearance"

export function BadgeDefaultsSection({ active, shape, onPreviewFamilyChange, presetsEnabled = true, unifiedView, element, onOpenAdvanced, mode, testStaged, testDirty }: {
  active: boolean
  shape?: BadgeShapeTarget
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
  presetsEnabled?: boolean
  unifiedView?: "summary" | "family"
  element?: PosterElementId | null
  onOpenAdvanced?: () => void
  /**
   * Additive presentation mode (five-tab settings): filters the existing
   * detail cards per tab without any new control implementation.
   * - rankings: rank switch + master gate + appearance + layout (ranked-only,
   *   no scope choice) + priority order
   * - information: visibility switches only (no shape/font/position/size)
   * - appearance: styles only (no visibility switches)
   * Absent = legacy full behavior (standalone reuse/tests unchanged).
   */
  mode?: BadgeDefaultsMode
  /**
   * Staged-session test guard (five-tab settings): when true the provider
   * Test never calls the legacy saveDefaults flush (which would bypass the
   * global Save); instead testing is disabled while the session is dirty
   * with a short Save-first hint. Absent = legacy standalone behavior.
   */
  testStaged?: boolean
  testDirty?: boolean
}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const accentColor = usePSelector((v) => v.accentColor)
  const { isLandscape, scoped } = useShapeBadgeDefaults(shape)
  const targetShape = isLandscape ? "landscape" : "portrait"
  const sashStashKey = isLandscape ? TREND_SASH_STASH_KEY_LANDSCAPE : TREND_SASH_STASH_KEY
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [sashDrag, setSashDrag] = useState<SashBucket | null>(null)
  // Unified workspace (Phase 1): `summary` (style tab) shows presets + quick
  // toggles + a single link to the workspace, no duplicate details;
  // `family` (advanced tab) shows the existing detail cards filtered by the
  // selected element, each mounted + hidden so switching never loses state.
  // Absent = legacy full behavior (standalone reuse/tests).
  const familyMode = unifiedView === "family"
  const hideFor = (...els: PosterElementId[]): boolean | undefined =>
    familyMode && element ? !els.includes(element) : undefined
  // Five-tab presentation filter (additive): with `mode` set, each detail
  // card declares its single home tab. Every primary switch lives in exactly
  // one tab; legacy standalone (mode undefined) renders everything.
  const modeHide = (...homes: BadgeDefaultsMode[]): boolean | undefined =>
    mode === undefined ? undefined : (!homes.includes(mode) ? true : undefined)
  const modeBare = familyMode || mode !== undefined

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
  // Logo-block alignment is Auto-only (no selector anywhere): the staged
  // session normalizes a stored explicit "center" (flat/profile) to null
  // (portrait center, landscape left by server contract; an explicit "left"
  // already renders Auto and stays) and no preset apply may reintroduce an
  // explicit value. The explicit `?align=` / env / schema / server chain is
  // preserved.
  // Graphical cover layout, scoped per edit target like the badge styles:
  // portrait writes the shared flat default, landscape the profile override
  // (reset below clears it back to following the flat).
  const [posterLayout, setPosterLayout] = scoped("posterLayout", ed.defaultPosterLayout, ed.setDefaultPosterLayout)
  // Targeted Fresh-entry reset (Classifiche unified presentation only):
  // entering Fresh neutralizes ONLY the title-logo and genre/rating-group
  // positions in the edited shape (autozero contract: genre 0/0, logo
  // null/null) via the existing scoped setters — scales and every other
  // setting stay intact, the other shape freezes via the standard setters.
  const [, setGenreBadgeOffsetX] = scoped("genreBadgeOffsetX", ed.defaultGenreBadgeOffsetX, ed.setDefaultGenreBadgeOffsetX)
  const [, setGenreBadgeOffsetY] = scoped("genreBadgeOffsetY", ed.defaultGenreBadgeOffsetY, ed.setDefaultGenreBadgeOffsetY)
  const [, setLogoOffsetX] = scoped("logoOffsetX", ed.defaultLogoOffsetX, ed.setDefaultLogoOffsetX)
  const [, setLogoOffsetY] = scoped("logoOffsetY", ed.defaultLogoOffsetY, ed.setDefaultLogoOffsetY)
  // Ranked-only Fresh/Card scope (no "all titles" choice in settings):
  // portrait reads the shared flat default, landscape the profile override.
  // The staged session normalizes a stored explicit "all" to "ranked"; the
  // public ?freshScope=all contract (per-title, old callers) is untouched.
  // Read-only here: the scope renders ranked-only, the hint below states it.
  const [posterFreshScope] = scoped("posterFreshScope", ed.defaultPosterFreshScope, ed.setDefaultPosterFreshScope)
  // Età per-shape (task3A): portrait = flat condivisi, landscape = override
  // del profilo (assente = segue il flat; `false` esplicito vince). Stesso
  // pattern degli altri visual scoped (mai i root setter diretti).
  const [ageBadge, setAgeBadge] = scoped("ageBadge", ed.defaultAgeBadge, ed.setDefaultAgeBadge)
  const [ageCountry, setAgeCountry] = scoped("ageCountry", ed.defaultAgeCountry, ed.setDefaultAgeCountry)
  const [ageBadgeStyle, setAgeBadgeStyle] = scoped("ageBadgeStyle", ed.defaultAgeBadgeStyle, ed.setDefaultAgeBadgeStyle)
  // Effective availability (shared helper, no duplicated gate logic): the
  // scoped bindings above already resolve `land ?? flat` per edit target.
  const effFlags: EffectiveBadgeFlags = {
    globalBadges, badgeGenre, badgeYear, badgeRating, separateRatings,
    separateRatingsStyle, rankingBadges, sashOrder, badgeQuality,
    customRatings, ageBadge, networkLogo, preRelease,
    posterLayout, posterFreshScope,
  }
  const genreStyleActive = isGenreStyleActive(effFlags)
  const extraStyleActive = isExtraStyleActive(effFlags)
  const separateStyleActive = isSeparateStyleActive(effFlags)
  const ageStyleActive = isAgeStyleActive(effFlags)
  const qualityStyleActive = isQualityStyleActive(effFlags)
  // Common font group (appearance): unmounted — wrapper included — when no
  // supported font consumer is effectively active (same canonical gate as
  // the card itself, never a second derivation).
  const fontActive = isBadgeFontActive(effFlags)
  const customRowActive = isCustomRatingsActive(effFlags)
  const effDisplay = availabilityDisplayState(effFlags)
  void customRowActive
  void effDisplay
  // Extra style options: the full renderer-supported subset (canonical
  // EXTRA_BADGE_STYLES order preserved: colored always offered, never gated
  // on the current value — the renderer already handles every entry).
  // Hoisted above the shared cards (same values, same callbacks).
  const extraOptions: ExtraBadgeStyle[] = ["default", "pill", "corner", "vetro", "bordo", "colored"]
  const EXTRA_STYLE_LABELS: Record<ExtraBadgeStyle, string> = {
    default: "ui.bsDefault",
    pill: "ui.pill",
    corner: "ui.corner",
    vetro: "ui.vetro",
    bordo: "ui.bordo",
    colored: "ui.colored",
  }
  // Shared separate-style picker (single implementation, reused callbacks):
  // the appearance tab owns it in a dedicated wrapper; standalone keeps the
  // legacy in-card placement via the same node (never duplicated on screen).
  const separateStylePicker = (
    <div className="pt-1 space-y-1.5" title={t("ui.separateRatingsHint")} data-testid="badge-separate-style-picker">
      <span className="text-[11px] text-muted font-medium block">{t("ui.separateRatingsStyle")}</span>
      <div className="grid grid-cols-3 gap-1">
        {([
          { id: "column", labelKey: "ui.separateRatingsColumn" },
          { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
          { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
          { id: "bottom-mono", labelKey: "ui.separateRatingsBottomMono" },
          { id: "bottom-color", labelKey: "ui.separateRatingsBottomColor" },
        ] as const).map((opt) => {
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
              } ${barOff ? "cursor-not-allowed" : "cursor-pointer"}`}
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
  )
  // Shared extra-style card (single implementation, reused callbacks): the
  // appearance tab wraps it in an effective gate, standalone renders it raw.
  // Reports the dedicated `extra` preview family (not the generic `info`):
  // focusing or pressing this card switches the defaults preview to the
  // extra-bucket sample so the staged `xbs` choice is visible immediately —
  // never the Fresh/Coming Soon sample. Preview-only, never writes.
  const extraStyleCard = (
    <div {...famAttrs("extra")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted font-medium block">{t("ui.extraBadgeStyle")}</span>
        {(extraBadgeStyle == null || extraBadgeStyle === "follow-rank") && (
          <p className="text-[10px] text-muted italic leading-tight">
            {t("ui.inherited")}: {t(EXTRA_STYLE_LABELS[legacyExtraStyleForRank(rankingBadgeStyle)])}
          </p>
        )}
        <BadgeStyleSelector
          value={extraBadgeStyle === "follow-rank" ? legacyExtraStyleForRank(rankingBadgeStyle) : (extraBadgeStyle ?? legacyExtraStyleForRank(rankingBadgeStyle))}
          options={extraOptions}
          onChange={(v) => {
            setExtraBadgeStyle(v)
          }}
          t={t}
          accentColor={accentColor}
        />
        {isLandscape && (
          <div className="flex gap-1 pt-1">
            <button
              type="button"
              onClick={() => setExtraBadgeStyle("follow-rank" as never)}
              aria-pressed={extraBadgeStyle === "follow-rank"}
              className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                extraBadgeStyle === "follow-rank"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              Follow rank
            </button>
            <button
              type="button"
              onClick={() => ed.setLandscape({ extraBadgeStyle: undefined })}
              aria-pressed={!("extraBadgeStyle" in ed.landscape) || (ed.landscape as { extraBadgeStyle?: unknown }).extraBadgeStyle == null}
              className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                (!("extraBadgeStyle" in ed.landscape) || (ed.landscape as { extraBadgeStyle?: unknown }).extraBadgeStyle == null)
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              {t("ui.inherited")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
  // Scoped reset (task 3B1): restores this tab's landscape keys to
  // independent shape-appropriate defaults — the current portrait effective
  // frozen in (same pixels as follow, then decoupled), age forced to the
  // canonical OFF/IT/standard trio — never clear-to-follow. Numerics and
  // gradient overrides owned by Transform stay intact. Divergence (not mere
  // presence) drives the button: a snapshot that still equals the flat is
  // not an override; null on inherit-keys follows the flat (canonical
  // NULL_INHERIT contract, same as the render chains).
  const landRec = ed.landscape as unknown as Record<string, unknown>
  const edRec = ed as unknown as Record<string, unknown>
  const badgeDiverges = (k: (typeof BADGE_VISUAL_LAND_KEYS)[number]): boolean => {
    const lv = landRec[k]
    if (lv === undefined || lv === null) return false
    const fv = edRec[`default${k.charAt(0).toUpperCase()}${k.slice(1)}`]
    return JSON.stringify(lv) !== JSON.stringify(fv)
  }
  const hasVisualOverrides = isLandscape && (BADGE_VISUAL_LAND_KEYS.some(badgeDiverges)
    || ed.landscape.ageBadge !== false
    || ed.landscape.ageCountry !== DEFAULT_AGE_COUNTRY
    || ed.landscape.ageBadgeStyle !== DEFAULT_AGE_BADGE_STYLE)
  const resetVisualOverrides = () => {
    const full = independentLandscapeDefaults(edRec) as unknown as Record<string, unknown>
    const patch = Object.fromEntries(
      BADGE_VISUAL_LAND_KEYS.map((k) => [k, full[k]]),
    ) as unknown as Partial<LandscapeServerDefaults>
    ed.setLandscape({
      ...patch,
      ageBadge: false,
      ageCountry: DEFAULT_AGE_COUNTRY,
      ageBadgeStyle: DEFAULT_AGE_BADGE_STYLE,
    })
  }

  // Rank bucket toggle: surgical rank on/off inside sashOrder (extra and the
  // rest untouched). OFF stashes the exact order under the rank-only target
  // key; ON restores rank at its stashed position without reshuffling the
  // other categories (canonical slot only when no stash exists).
  const rankOn = sashOrder.includes("rank")
  const rankSashStashKey = isLandscape ? RANK_SASH_STASH_KEY_LANDSCAPE : RANK_SASH_STASH_KEY
  // Staged five-tab session: stash in memory so tab/format switches keep
  // the prior order with zero localStorage/config writes before Save.
  const stagedStash = mode !== undefined
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
      const stashed = popStashedSashOrder(rankSashStashKey, stagedStash)
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
      stashSashOrder(rankSashStashKey, sashOrder, stagedStash)
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

  // Unified ranking presentation (Classifiche): one exclusive choice over the
  // existing stored fields; standalone (mode undefined) keeps the legacy split.
  const isRankingsTab = mode === "rankings"
  const presentation: RankingPresentation =
    posterLayout === "fresh" ? "fresh" : isCardSkin(posterLayout) ? "card" : appearance
  // Remembered Card skin (transient UI only, never persisted): survives
  // classic/Fresh/Card switching, same rule as the standalone selector.
  const [rememberedSkin, setRememberedSkin] = useState<CardSkin>(() =>
    isCardSkin(posterLayout) ? posterLayout : "provider-glass",
  )
  useEffect(() => {
    if (isCardSkin(posterLayout)) setRememberedSkin(posterLayout)
  }, [posterLayout])
  function handlePresentation(p: RankingPresentation) {
    if (p === "fresh") {
      // Actual transition only: re-clicking the already-selected Fresh
      // preserves deliberate slider edits made while Fresh. One-way reset —
      // returning to Nastro/Numero never restores the old offsets.
      if (posterLayout !== "fresh") {
        setGenreBadgeOffsetX(0)
        setGenreBadgeOffsetY(0)
        setLogoOffsetX(null)
        setLogoOffsetY(null)
        setPosterLayout("fresh")
      }
      return
    }
    if (p === "card") {
      const skin = isCardSkin(posterLayout) ? posterLayout : rememberedSkin
      if (posterLayout !== skin) setPosterLayout(skin)
      return
    }
    if (posterLayout !== "standard") setPosterLayout("standard")
    handleAppearance(p)
  }
  function handleCardSkin(skin: CardSkin) {
    setRememberedSkin(skin)
    if (posterLayout !== skin) setPosterLayout(skin)
  }

  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Advanced disclosure for the detailed controls below: closed by default
  // (preset-first), body always mounted + hidden so no state is ever lost.
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsBodyId = useId()

  // Test provider custom rating (sample fisso server-side, chiave mai esposta).
  const [crTestBusy, setCrTestBusy] = useState(false)
  const [crTestResult, setCrTestResult] = useState<{
    ok: boolean
    status: number | null
    ms: number
    ratings?: { id: string; name: string; value: number; format: string }[]
    error?: string
  } | null>(null)

  const customTestBlocked = testStaged === true && testDirty === true
  const runCustomRatingTest = async () => {
    if (customTestBlocked) return
    setCrTestBusy(true)
    setCrTestResult(null)
    try {
      // Flush dei default appena digitati: il test gira sulla config salvata.
      // Staged session: never flush (would bypass the global Save); the
      // button is disabled while dirty, and a clean session already matches
      // the saved truth so no flush is needed.
      if (!testStaged) await saveDefaults(ed)
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

  const customRatingTestResult = crTestResult ? (
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
  ) : null

  // Quick-preset canonical transform reset: single shared source (no
  // duplicated constants/formulas — see src/lib/quick-visual-presets.ts).
  function quickTransformPatch(portrait: boolean): Partial<VisualPresetValues> {
    return sharedQuickTransformPatch(portrait)
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
      effTarget("topShadeHeight", ed.defaultTopShadeHeight) === 25 &&
      effTarget("logoScale", ed.defaultLogoScale) === null &&
      effTarget("logoOffsetX", ed.defaultLogoOffsetX) === null &&
      effTarget("logoOffsetY", ed.defaultLogoOffsetY) === null &&
      effTarget("topBadgeScale", ed.defaultTopBadgeScale) === 100 &&
      effTarget("topBadgeOffsetX", ed.defaultTopBadgeOffsetX) === 0 &&
      effTarget("topBadgeOffsetY", ed.defaultTopBadgeOffsetY) === 0 &&
      effTarget("genreBadgeScale", ed.defaultGenreBadgeScale) === 100 &&
      effTarget("genreBadgeOffsetX", ed.defaultGenreBadgeOffsetX) === 0 &&
      effTarget("genreBadgeOffsetY", ed.defaultGenreBadgeOffsetY) === 0 &&
      // Per-item corrections are part of the ready recipe too: the look owns
      // the automatic item layout, so a live nudge means the tile no longer
      // matches its own thumbnail (same rule the gallery highlight uses).
      effTarget("badgeItemTransforms", ed.defaultBadgeItemTransforms) == null &&
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

  // Ready canonical layout gate (standalone preset cards): a Fresh/Card
  // draft with matching badge visuals must never claim a Standard tile
  // (Fresh/Card are mutually exclusive ranking presentations).
  const readyLayoutStandard = posterLayout === "standard"

  // Shared canonical pins every ready look owns (their toggles/styles differ,
  // these never do): separate column off, full sash order, Inter font,
  // standard quality icons, full A/V set, network auto/follow, left side,
  // Coming Soon off and the follow-own-rank extra in the edited shape.
  // A tuned seed matching only the toggles never claims a tile.
  const matchesReadyCommonPins = (customOn: boolean): boolean =>
    (customRatings === customOn) &&
    !separateRatings &&
    getSeparateRatingsStyleForShape(separateRatingsStyle, isLandscape ? "landscape" : "poster") === DEFAULT_SEPARATE_RATINGS_STYLE &&
    effTarget("badgeFont", ed.defaultBadgeFont) === DEFAULT_BADGE_FONT &&
    effTarget("qualityBadgeStyle", ed.defaultQualityBadgeStyle) === DEFAULT_QUALITY_BADGE_STYLE &&
    JSON.stringify(effTarget("videoFormats", ed.defaultVideoFormats)) === JSON.stringify([...KNOWN_VIDEO_FORMATS]) &&
    JSON.stringify(sashOrder) === JSON.stringify([...DEFAULT_SASH_ORDER]) &&
    networkLogoPosition === "auto" &&
    effTarget("networkLogoFollowTitle", ed.defaultNetworkLogoFollowTitle) === true &&
    ribbonSide === "left" &&
    preRelease === false &&
    (isLandscape
      ? effTarget("extraBadgeStyle", ed.defaultExtraBadgeStyle) === EXTRA_BADGE_FOLLOW_RANK
      : ed.defaultExtraBadgeStyle == null)

  const isEssential =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    !badgeRating &&
    !badgeQuality &&
    !rankingBadges &&
    rankingBadgeStyle === "default" &&
    ribbonEnabled === false &&
    !networkLogo &&
    badgeStyle === "minimal" &&
    matchesReadyCommonPins(false) &&
    matchesQuickTransform(!isLandscape) &&
    readyLayoutStandard

  const isRatings =
    globalBadges &&
    !badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    !rankingBadges &&
    rankingBadgeStyle === "default" &&
    ribbonEnabled === false &&
    !networkLogo &&
    badgeStyle === "pill" &&
    matchesReadyCommonPins(true) &&
    matchesQuickTransform(!isLandscape) &&
    readyLayoutStandard

  // User recipe: Completo = Nastro rank + minimal genre badge
  // (`rankingAppearanceValue("nastro")` + minimal `bs`, translated exactly).
  const isFull =
    globalBadges &&
    badgeGenre &&
    badgeYear &&
    badgeRating &&
    badgeQuality &&
    rankingBadges &&
    rankingBadgeStyle === "netflix" &&
    ribbonEnabled === true &&
    networkLogo &&
    badgeStyle === "minimal" &&
    matchesReadyCommonPins(true) &&
    matchesQuickTransform(!isLandscape) &&
    readyLayoutStandard

  // Same as the per-title behavior: in bottom, genre/year defaults are
  // render-suppressed but kept (back to Column restores them, never lost).
  const defaultBottomActive =
    globalBadges &&
    badgeRating &&
    separateRatings &&
    isBottomSeparateRatingsStyle(separateRatingsStyle)

  // Quick preset apply: SINGLE atomic target-aware patch con helpers existing
  // (come Apple/personali). Portrait congela l'effettivo landscape ereditato,
  // landscape scrive solo il profilo; globals (ratingSources/fit) e
  // delivery non mutati per isolamento. Ogni ready look applica la sua
  // ricetta canonica completa (QUICK_BADGE_PATCHES + reset canonico: nessun
  // pin visivo eredita il look precedente). Nessun nested `landscape` nel
  // desired: in landscape l'overlay è solo il patch derivato dai flat (mai
  // il profilo corrente sopra il reset). RatingSources NON resettate
  // (rimozione isolamento): tutti i ready preservano le fonti utente come
  // Apple/personali; i testi restano validi ("Punteggi IMDb/TMDB e qualità"
  // descrive il contenuto, non un reset).
  // Full only (`readyPin`): the canonical complete recipe
  // (QUICK_BADGE_PATCHES.full) plus the standalone-extra reset — the edited
  // shape returns to follow-own-rank instead of inheriting a tuned extra
  // style. Essential/Ratings share the same readyPin with their own canonical
  // recipes below; personal presets never pass it.
  const applyQuickForTarget = (badgePatch: Partial<VisualPresetValues>, readyPin = false, meta?: { id: string; name: string }) => {
    const live = { ...captureVisualPreset(ed), landscape: ed.landscape }
    const desired = {
      ...badgePatch,
      ...quickTransformPatch(!isLandscape),
    } as unknown as VisualPresetValues
    const isolated = isLandscape ? applyLandscapeIsolated(live, desired) : applyPortraitIsolated(live, desired)
    // Ready looks leave the age classification OFF in the edited shape
    // (other shape effective preserved); Information re-enables it manually.
    // Ready canonical layout: the edited shape owns Standard (own ranking
    // mode, never inherits Fresh/Card); the other shape is frozen.
    const aged = withReadyPresetAgeOff(
      { defaultAgeBadge: ed.defaultAgeBadge, landscape: ed.landscape },
      isolated as unknown as Record<string, unknown>,
      isLandscape ? "landscape" : "portrait",
    )
    const laid = withReadyPresetLayoutStandard(
      ed,
      aged,
      isLandscape ? "landscape" : "portrait",
    )
    const staged = (readyPin
      ? withReadyPresetExtraStyleReset(laid, isLandscape ? "landscape" : "portrait", ed as unknown as { defaultExtraBadgeStyle?: unknown; landscape?: unknown })
      : laid) as unknown as VisualPresetValues
    ed.applyVisualPreset(
      staged,
      isLandscape ? "landscape" : "portrait",
      meta ? { ...meta, kind: "ready" } : undefined,
    )
  }

  // Essential/Ratings/Full share the single canonical recipes with the
  // Preset-tab gallery (QUICK_BADGE_PATCHES + transform reset): never
  // duplicated subsets — every entry point stages the identical snapshot.
  const applyEssential = () => {
    applyQuickForTarget(QUICK_BADGE_PATCHES.essential, true, { id: "essential", name: t("ui.configPresetEssential") })
  }

  const applyRatings = () => {
    applyQuickForTarget(QUICK_BADGE_PATCHES.ratings, true, { id: "ratings", name: t("ui.configPresetRatings") })
  }

  // Full shares the single canonical recipe with the Preset-tab gallery
  // (QUICK_BADGE_PATCHES.full + transform reset via quickLookDesired): never
  // a duplicated subset — both entry points stage the identical snapshot.
  const applyFull = () => {
    applyQuickForTarget(QUICK_BADGE_PATCHES.full, true, { id: "full", name: t("ui.configPresetFull") })
  }

  // Snapshot preset keys that live in the landscape profile: `defaultX` maps
  // to the `x` profile key. Everything else (rating sources, fit flags, …)
  // stays global. Logo alignment is Auto-only (never staged from a preset).
  // Delivery shape never follows a preset here.
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
    defaultTopShadeHeight: "topShadeHeight",
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
    // Per-ITEM corrections: part of the preset's own visual recipe, so the
    // landscape apply writes the snapshot value (built-ins carry `null` =
    // automatic). Without the mapping the profile kept the previous look's
    // corrections and the landscape poster stayed moved.
    defaultBadgeItemTransforms: "badgeItemTransforms",
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
    // Logo alignment is Auto-only (no selector): never part of the match —
    // the staged session always carries null and legacy presets may not.
    return (
      snapshotFieldEqual(cur.defaultRatingSources, preset.defaultRatingSources) &&
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
  const isBetterPoster = matchesSnapshotPreset(BETTER_POSTER_VISUAL_DEFAULTS) && readyLayoutStandard
  const isRpdb = matchesSnapshotPreset(RPDB_VISUAL_DEFAULTS) && readyLayoutStandard

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
    ) && readyLayoutStandard
  const applyApple = () => {
    const isolated = isLandscape
      ? applyLandscapeIsolated(appleLive, APPLE_VISUAL_DEFAULTS)
      : applyPortraitIsolated(appleLive, APPLE_VISUAL_DEFAULTS)
    // Ready look: age classification OFF in the edited shape (other shape
    // effective preserved); Information re-enables it manually. Ready
    // canonical layout: the edited shape owns Standard (never inherits
    // Fresh/Card); the other shape is frozen.
    const aged = withReadyPresetAgeOff(
      { defaultAgeBadge: ed.defaultAgeBadge, landscape: ed.landscape },
      isolated as unknown as Record<string, unknown>,
      isLandscape ? "landscape" : "portrait",
    )
    const laid = withReadyPresetLayoutStandard(
      ed,
      aged,
      isLandscape ? "landscape" : "portrait",
    )
    // Ready independence: the standalone extra style returns to
    // follow-own-rank in the edited shape (never inherits a tuned style).
    // Portrait freezes the inheriting other-shape profile to the pre-edit
    // effective flat first (`ed`: appleLive is schema-stripped and drops the
    // standalone extra key), so the other format cannot move.
    const staged = withReadyPresetExtraStyleReset(
      laid,
      isLandscape ? "landscape" : "portrait",
      ed as unknown as { defaultExtraBadgeStyle?: unknown; landscape?: unknown },
    ) as unknown as VisualPresetValues
    ed.applyVisualPreset(staged, isLandscape ? "landscape" : "portrait", { id: "apple", name: t("ui.configPresetApple"), kind: "ready" })
  }

  // Snapshot presets apply to the edit target only: landscape-capable keys
  // go to the profile, truly shared globals go to root, delivery shape and
  // the preset's own nested landscape never touch anything else. Single
  // setLandscape call plus distinct root keys: no stale-merge loss.
  const applySnapshotForTarget = (values: VisualPresetValues, meta: { id: string; name: string }) => {
    if (!isLandscape) {
      // Portrait target: flats only; the existing landscape profile and the
      // delivery shape stay byte-identical. Ready look: age OFF in portrait,
      // inheriting landscape profile frozen to the pre-edit effective.
      // Ready canonical layout: portrait owns Standard (never inherits
      // Fresh/Card); an inheriting landscape profile freezes pre-edit.
      // Logo alignment stays Auto (never staged from a preset). Ready
      // independence: the standalone extra style returns to legacy null
      // (follow the preset's own rank) instead of inheriting a tuned style;
      // an inheriting landscape profile freezes the pre-edit effective flat
      // first (same shared overlay), so the other format cannot move.
      const aged = withReadyPresetAgeOff(
        { defaultAgeBadge: ed.defaultAgeBadge, landscape: ed.landscape },
        { ...values, defaultLogoAlign: null, defaultExtraBadgeStyle: null, landscape: ed.landscape, defaultPosterShape: ed.defaultPosterShape } as unknown as Record<string, unknown>,
        "portrait",
      )
      const laidSnap = withReadyPresetLayoutStandard(
        ed,
        aged,
        "portrait",
      )
      const staged = withReadyPresetExtraStyleReset(
        laidSnap,
        "portrait",
        ed as unknown as { defaultExtraBadgeStyle?: unknown; landscape?: unknown },
      ) as unknown as VisualPresetValues
      ed.applyVisualPreset(staged, "portrait", { ...meta, kind: "ready" })
      return
    }
    const landPatch: Partial<LandscapeServerDefaults> = {}
    for (const [k, v] of Object.entries(values)) {
      if (k === "defaultPosterShape" || k === "landscape") continue
      const lk = PRESET_TO_LAND[k]
      if (lk) (landPatch as Record<string, unknown>)[lk] = v
    }
    if (values.landscape) Object.assign(landPatch, values.landscape)
    // Ready look: age classification OFF in the edited (landscape) shape;
    // portrait flats stay byte-identical. Ready canonical layout: the
    // landscape profile owns Standard (never inherits Fresh/Card). Ready
    // independence: the profile extra style takes the explicit
    // follow-own-rank marker instead of inheriting a tuned flat.
    landPatch.ageBadge = false
    landPatch.posterLayout = "standard"
    landPatch.extraBadgeStyle = EXTRA_BADGE_FOLLOW_RANK
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
    ed.applyVisualPreset({
      landscape: landPatch,
      defaultRatingSources: values.defaultRatingSources,
      // Logo alignment stays Auto (never staged from a preset, even a legacy
      // one carrying an explicit value); the staged session normalizes anyway.
      defaultLogoAlign: null,
      defaultPortraitFitEnabled: values.defaultPortraitFitEnabled,
      defaultLandscapeFitEnabled: values.defaultLandscapeFitEnabled,
    } as unknown as VisualPresetValues, "landscape", { ...meta, kind: "ready" })
  }

  const applyBetterPoster = () => {
    applySnapshotForTarget(BETTER_POSTER_VISUAL_DEFAULTS, { id: "better-poster", name: t("ui.configPresetBetterPoster") })
  }

  const applyRpdb = () => {
    applySnapshotForTarget(RPDB_VISUAL_DEFAULTS, { id: "rpdb", name: t("ui.configPresetRpdb") })
  }

  return (
    <div
      role={familyMode ? undefined : "tabpanel"}
      aria-label={familyMode ? undefined : t("ui.badgeSection")}
      data-testid={familyMode ? "badge-family-content" : undefined}
      hidden={familyMode ? undefined : !active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Preset-first: global scope, builtin looks, personal presets and
          quick toggles stay always visible; the full detailed controls live
          below inside the Advanced disclosure (legacy) or the unified
          element workspace (summary links out, family filters in). */}
      {unifiedView !== "family" && mode === undefined && (<>
      <p data-testid="settings-global-scope" className="text-[11px] text-zinc-400 leading-snug px-1">
        {t("ui.settingsGlobalDesc")}
      </p>
      <div {...famAttrs("auto")}>
        <PosterStyleCard
          title={t("ui.configPresetTitle")}
          desc={t("ui.configPresetDesc")}
          note={t("ui.configPresetUnofficialNote")}
          options={[
            { id: "essential", title: t("ui.configPresetEssential"), desc: t("ui.configPresetEssentialDesc"), active: isEssential, onApply: applyEssential },
            { id: "ratings", title: t("ui.configPresetRatings"), desc: t("ui.configPresetRatingsDesc"), active: isRatings, onApply: applyRatings },
            { id: "full", title: t("ui.configPresetFull"), desc: t("ui.configPresetFullDesc"), active: isFull, onApply: applyFull },
            { id: "better-poster", title: t("ui.configPresetBetterPoster"), desc: t("ui.configPresetBetterPosterDesc"), active: isBetterPoster, onApply: applyBetterPoster },
            { id: "rpdb", title: t("ui.configPresetRpdb"), desc: t("ui.configPresetRpdbDesc"), active: isRpdb, onApply: applyRpdb },
            { id: "apple", title: t("ui.configPresetApple"), desc: t("ui.configPresetAppleDesc"), active: isApple, onApply: applyApple },
          ]}
        />
      </div>
      {/* Personal presets sit right below the builtin selection (same edit
          target, same list guards) — never in a separate SettingsPanel slot. */}
      {presetsEnabled && <VisualPresetsSection shape={targetShape} enabled={presetsEnabled} />}
      {/* What to show: compact quick toggles over the existing shape-scoped
          setters (genre/year/rating/quality/rank/age only). Same values and
          same guards as the detailed controls (genre/year stay disabled while
          a bottom layout suppresses them, rank goes through the stashed
          bucket path); values are only ever written, never reset. */}
      <section aria-label={t("ui.posterStyleWhatToShow")} data-testid="poster-style-whattoshow" className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <span className="font-semibold text-zinc-200">{t("ui.posterStyleWhatToShow")}</span>
        <p className="text-[11px] text-zinc-400 -mt-1">{t("ui.posterStyleWhatToShowHint")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="whattoshow-genre"
            aria-pressed={globalBadges && badgeGenre}
            disabled={defaultBottomActive}
            title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined}
            onClick={() => { if (defaultBottomActive) return; if (globalBadges && badgeGenre) setBadgeGenre(false); else { setGlobalBadges(true); setBadgeGenre(true) } }}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 ${globalBadges && badgeGenre ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"} ${defaultBottomActive ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
          >
            {t("ui.badgeGenre")}
          </button>
          <button
            type="button"
            data-testid="whattoshow-year"
            aria-pressed={globalBadges && badgeYear}
            disabled={defaultBottomActive}
            title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined}
            onClick={() => { if (defaultBottomActive) return; if (globalBadges && badgeYear) setBadgeYear(false); else { setGlobalBadges(true); setBadgeYear(true) } }}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 ${globalBadges && badgeYear ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"} ${defaultBottomActive ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
          >
            {t("ui.badgeYear")}
          </button>
          <button
            type="button"
            data-testid="whattoshow-rating"
            aria-pressed={globalBadges && badgeRating}
            onClick={() => { if (globalBadges && badgeRating) setBadgeRating(false); else { setGlobalBadges(true); setBadgeRating(true) } }}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${globalBadges && badgeRating ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"}`}
          >
            {t("ui.badgeRating")}
          </button>
          <button
            type="button"
            data-testid="whattoshow-quality"
            aria-pressed={badgeQuality}
            onClick={() => setBadgeQuality(!badgeQuality)}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${badgeQuality ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"}`}
          >
            {t("ui.badgeQuality")}
          </button>
          <button
            type="button"
            data-testid="whattoshow-rank"
            aria-pressed={rankingBadges && rankOn}
            onClick={() => { if (rankingBadges && rankOn) setRankBucket(false); else { setRankingBadges(true); setRankBucket(true) } }}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${rankingBadges && rankOn ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"}`}
          >
            {t("ui.sash_rank")}
          </button>
          <button
            type="button"
            data-testid="whattoshow-age"
            aria-pressed={globalBadges && ageBadge}
            onClick={() => { if (globalBadges && ageBadge) setAgeBadge(false); else { setGlobalBadges(true); setAgeBadge(true) } }}
            className={`min-h-[44px] py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${globalBadges && ageBadge ? "bg-white/20 text-white shadow-sm" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"}`}
          >
            {t("ui.ageBadge")}
          </button>
        </div>
      </section>
      </>)}
      {/* Advanced details: legacy standalone disclosure (mounted + hidden);
          summary shows only the single link into the unified workspace;
          family shows the filtered detail cards directly (no disclosure). */}
      <section data-testid={familyMode ? "badge-family-details" : "badge-advanced"}>
        {!familyMode && mode === undefined && (<>
        <button
          type="button"
          data-testid="badge-advanced-toggle"
          aria-expanded={unifiedView === "summary" ? false : detailsOpen}
          aria-controls={unifiedView === "summary" ? undefined : detailsBodyId}
          onClick={() => { if (unifiedView === "summary") onOpenAdvanced?.(); else setDetailsOpen((v) => !v) }}
          className="w-full flex items-center justify-between gap-2 px-1 py-1 min-h-[44px] cursor-pointer touch-manipulation"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
            <SlidersHorizontal className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.badgeAdvancedTitle")}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
              detailsOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        <p className="text-[11px] text-zinc-400 px-1 pb-1">{t("ui.badgeAdvancedHint")}</p>
        </>)}
        {unifiedView !== "summary" && (
        <div id={detailsBodyId} hidden={mode !== undefined ? false : (familyMode ? false : !detailsOpen)} className="space-y-3.5">
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
      {/* Style & Presets: genre style, extra style (preset cards moved above) */}
      <BadgeGroup id="style" title={t("ui.badgeGroupStyle")} icon={Palette} defaultOpen bare={modeBare} hidden={hideFor("logo", "genre", "info")}>

      {/* Standalone only: five-tab settings own the layout via the unified choice. */}
      {!familyMode && mode === undefined && (
      <div data-testid="poster-layout-card" hidden={hideFor("logo")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.posterLayout")}
        </span>
        <PosterLayoutSelector value={posterLayout} onChange={(v) => setPosterLayout(v)} />
        {(posterLayout === "fresh" || isCardSkin(posterLayout)) && (
          <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
            {t(isCardSkin(posterLayout) ? "ui.posterLayoutScopeHint" : "ui.posterFreshScopeHint")}
          </p>
        )}
      </div>
      )}

      {mode === "appearance" ? (
        <>
          {orderActiveFirst([
            {
              active: genreStyleActive,
              value: (
                <div key="genre" hidden={hideFor("genre")} data-testid="badge-genre-style-wrap">
                  <AvailabilityGate active name={t("ui.styleGenreBadge")} hint="" testId="badge-genre-style">
                    <GenreStyleSection shape={targetShape} onPreviewFamilyChange={onPreviewFamilyChange} styleDisabled={!genreStyleActive} showFont={false} />
                  </AvailabilityGate>
                </div>
              ),
            },
            {
              active: extraStyleActive,
              value: (
                <div key="extra" hidden={hideFor("info")} data-testid="badge-extra-style-wrap">
                  <AvailabilityGate active name={t("ui.extraBadgeStyle")} hint="" testId="badge-extra-style">
                    {extraStyleCard}
                  </AvailabilityGate>
                </div>
              ),
            },
          ].filter((it) => it.active))}
          {fontActive && (
          <div hidden={hideFor("genre")} data-testid="badge-common-font-wrap">
            <CommonFontCard shape={targetShape} onPreviewFamilyChange={onPreviewFamilyChange} flags={effFlags} />
          </div>
          )}
        </>
      ) : (
        <>
          <div hidden={hideFor("genre") || modeHide("appearance")} data-testid="badge-genre-style-wrap">
            <GenreStyleSection shape={targetShape} onPreviewFamilyChange={onPreviewFamilyChange} />
          </div>
          <div hidden={hideFor("info") || modeHide("appearance")} data-testid="badge-extra-style-wrap">
            {extraStyleCard}
          </div>
        </>
      )}
      {/* Logo-block alignment is Auto-only: no selector is rendered here (nor
          in any other settings home). Portraits render centered and landscapes
          left by server contract; the staged session normalizes stored
          explicit values to null and the single Save clears them. */}
      </BadgeGroup>

      {/* Base content: genre/year toggles, ratings */}
      <BadgeGroup id="base" title={t("ui.badgeGroupBase")} icon={Layers} defaultOpen bare={modeBare} hidden={hideFor("genre", "ratings")}>

      {/* Base genre/year toggles (info family kept for the preview sample) */}
      <div {...famAttrs("info")} hidden={hideFor("genre") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
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
              <fieldset disabled={defaultBottomActive} className="contents">
              <div className="flex items-center justify-between" title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={defaultBottomActive || undefined}>
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
              <div className="flex items-center justify-between" title={defaultBottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={defaultBottomActive || undefined}>
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
              </fieldset>
            </div>
          )}

          </div>
        </div>

      {/* CARD Ratings: vote, separate, sources, custom. Visibility lives ONLY
          in Information: the separate style picker owns a dedicated appearance
          wrapper below, so in appearance this card would render as an orphan
          shell (title with every control hidden) — it stays mounted + hidden
          for state, never visible. */}
      <div {...famAttrs("ratings")} hidden={hideFor("ratings") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("ui.ratingsFamily")}
        </span>
        <div className="space-y-2">
          {globalBadges && (
            <div hidden={mode !== undefined && mode !== "information" ? true : undefined} className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
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
              {badgeRating && separateRatings && mode === undefined && separateStylePicker}

              {/* Rating sources stay global in both targets. Legacy path only:
                  family mode owns a dedicated Sources card (always accessible,
                  no rating/master gate on the container). */}
              {!familyMode && badgeRating && (mode === undefined || mode === "information") && (
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
          {!familyMode && (mode === undefined || mode === "information") && (
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
                    // Machine-readable provider URL: always LTR even under RTL document.
                    dir="ltr"
                    className="w-full text-xs font-mono py-1.5 px-2.5 rounded-lg bg-black/40 border border-white/10 text-foreground placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
                  />
                </div>
                <p className="text-[11px] text-zinc-400 italic">{t("ui.customRatingKeyHint")}</p>
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={crTestBusy || customTestBlocked}
                    title={customTestBlocked ? t("ui.customRatingSaveFirstHint") : undefined}
                    onClick={runCustomRatingTest}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 disabled:opacity-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    {crTestBusy ? t("ui.customRatingTesting") : t("ui.customRatingTest")}
                  </button>
                  {customTestBlocked && (
                    <p className="text-[10px] text-zinc-500 italic leading-tight pt-1">{t("ui.customRatingSaveFirstHint")}</p>
                  )}
                  {customRatingTestResult}
                </div>
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      {/* Separate style: appearance-own home (never inside the
          information-hidden visibility wrapper above). Visibility lives ONLY
          in Information; the root ratings card stays mounted in both tabs. */}
      {(mode !== "appearance" || separateStyleActive) && (
      <div hidden={hideFor("ratings") || (mode !== "appearance" ? true : undefined)} data-testid="badge-separate-style-wrap">
        {mode === "appearance" && separateStyleActive && (
          <AvailabilityGate active name={t("ui.separateRatingsStyle")} hint="" testId="badge-separate-style">
            <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
              {separateStylePicker}
            </div>
          </AvailabilityGate>
        )}
      </div>
      )}
      </BadgeGroup>
      {/* Sources-only card (family mode): rating sources + custom provider,
          always accessible even when rating/master off; setter semantics
          unchanged. Legacy standalone keeps the in-card gated version. */}
      {familyMode && (
      <div data-testid="badge-sources-card" hidden={hideFor("sources")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("ui.ratingSources")}
        </span>
        <p className="text-[11px] text-zinc-400 italic -mt-1">{t("ui.ratingSourcesHint")}</p>
        <div className="flex items-center gap-1.5 text-[10px]">
          <button type="button" onClick={() => ed.setDefaultRatingSources(UI_RATING_SOURCES.map((s) => s.id))} className="text-accent-orange hover:underline font-semibold cursor-pointer">{t("ui.enableAll")}</button>
          <span className="text-zinc-600">·</span>
          <button type="button" onClick={() => ed.setDefaultRatingSources(["imdb"])} className="text-muted hover:text-zinc-200 cursor-pointer">{t("ui.sourcesImdbOnly")}</button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
          {UI_RATING_SOURCES.map((s) => {
            const current = ed.defaultRatingSources ?? ["imdb", "tmdb"]
            const isSelected = current.includes(s.id)
            return (
              <button key={s.id} type="button" onClick={() => {
                if (isSelected) { if (current.length > 1) ed.setDefaultRatingSources(current.filter((x) => x !== s.id)) }
                else ed.setDefaultRatingSources([...current, s.id])
              }} className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] border cursor-pointer ${isSelected ? "bg-accent-orange/[0.12] border-accent-orange/35 text-zinc-100" : "bg-white/[0.03] border-white/[0.04] text-zinc-400"}` }>
                <span className="flex items-center gap-1.5 truncate"><RatingSourceIcon id={s.id} className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{t(s.labelKey)}</span></span>
                <span className={`w-2 h-2 rounded-full shrink-0 ml-1 ${isSelected ? "bg-accent-orange" : "bg-zinc-700"}`} />
              </button>
            )
          })}
        </div>
        <div className="pt-1 border-t border-surface2/50">
          <div className="flex items-center justify-between" title={t("ui.customRatingsHint")}>
            <span className="text-zinc-300 font-medium flex items-center gap-1.5"><Star className="w-3.5 h-3.5 text-teal-400" />{t("ui.customRatings")}</span>
            <Toggle value={customRatings} onChange={(v) => setCustomRatings(v)} label={t("ui.customRatings")} />
          </div>
          {customRatings && (
            <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 mt-1.5">
              <label className="text-[11px] text-muted block mb-1">{t("ui.customRatingEndpoint")}</label>
              <input type="url" value={ed.defaultCustomRatingEndpoint ?? ""} onChange={(e) => ed.setDefaultCustomRatingEndpoint(e.target.value)} placeholder="https://example.com/ratings/{imdbId}" maxLength={500} dir="ltr" className="w-full text-xs font-mono py-1.5 px-2.5 rounded-lg bg-black/40 border border-white/10 text-foreground placeholder-zinc-600 focus:outline-none focus:border-teal-500/50" />
              <p className="text-[11px] text-zinc-400 italic">{t("ui.customRatingKeyHint")}</p>
              <button type="button" disabled={crTestBusy || customTestBlocked} title={customTestBlocked ? t("ui.customRatingSaveFirstHint") : undefined} onClick={runCustomRatingTest} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">{crTestBusy ? t("ui.customRatingTesting") : t("ui.customRatingTest")}</button>
              {customTestBlocked && (
                <p className="text-[10px] text-zinc-500 italic leading-tight pt-1">{t("ui.customRatingSaveFirstHint")}</p>
              )}
              {customRatingTestResult}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Special overlays: ranking, sash, network, prerelease */}
      <BadgeGroup id="overlay" title={t("ui.badgeGroupOverlay")} icon={Trophy} defaultOpen={familyMode ? true : false} bare={modeBare} hidden={hideFor("rank", "info", "logo")}>
      {/* CARD Rankings: rank bucket + single appearance + position */}
      <div {...famAttrs("rank")} hidden={hideFor("rank") || modeHide("rankings")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
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
                setSashOrder(popStashedSashOrder(sashStashKey, stagedStash) ?? [...DEFAULT_SASH_ORDER])
              } else {
                // Master OFF clears this target's sash; single categories
                // stay switchable below.
                stashSashOrder(sashStashKey, sashOrder, stagedStash)
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
            {...(isRankingsTab
              ? {
                  presentation,
                  onPresentation: handlePresentation,
                  cardSkin: isCardSkin(posterLayout) ? posterLayout : rememberedSkin,
                  onCardSkin: handleCardSkin,
                }
              : {})}
          />
          {isRankingsTab && (presentation === "fresh" || presentation === "card") && (
            <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
              {t(presentation === "card" ? "ui.posterLayoutScopeHint" : "ui.posterFreshScopeHint")}
            </p>
          )}
        </div>
      </div>

      {/* Sash categories (info family kept for the preview sample) */}
      <div {...famAttrs("info")} hidden={hideFor("rank", "info") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
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
      <div {...famAttrs("info")} hidden={hideFor("info") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm" title={t("ui.preReleaseHint")}>
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
      <div {...famAttrs("info")} hidden={hideFor("rank", "info") || modeHide("rankings")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-1.5 shadow-sm">
        <div className="pt-1">
          {mode === "rankings" && (
            <p className="text-[10px] text-muted italic leading-tight pb-1">{t("ui.badgePriorityOrderHint")}</p>
          )}
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
                        {mode === "rankings" ? (
                          <span className={`text-[10px] font-mono px-1 ${isOn ? "text-zinc-300" : "text-zinc-600"}`}>{isOn ? `#${sash.indexOf(b) + 1}` : "—"}</span>
                        ) : (
                        <Toggle
                          value={isOn}
                          onChange={(v) => toggleBucket(b, v)}
                          label={t(`ui.sash_${b}`)}
                        />
                        )}
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
      <div {...famAttrs("quality")} hidden={hideFor("logo") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2 shadow-sm">
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

          {networkLogo && mode === undefined && (
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
      <BadgeGroup id="quality" title={t("ui.badgeGroupQuality")} icon={Tv} defaultOpen={familyMode ? true : false} bare={modeBare} hidden={hideFor("quality")}>
      {/* Quality toggle card */}
      <div {...famAttrs("quality")} hidden={hideFor("quality") || modeHide("information")} className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
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

      {/* Age rating: small neutral text badge below the quality stack. In
          appearance the whole card unmounts while the age style is inactive
          (never an empty shell with a lone heading); Information always keeps
          the toggle reachable. */}
      {(mode !== "appearance" || ageStyleActive) && (
      <div {...famAttrs("quality")} hidden={hideFor("quality") || modeHide("information", "appearance")} data-testid="badge-age-card" className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <div className="space-y-2">
          <div hidden={mode !== undefined && mode !== "information" ? true : undefined} className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t("ui.ageBadge")}
            </span>
            <Toggle
              value={ageBadge}
              onChange={(v) => {
                setAgeBadge(v)
              }}
              label={t("ui.ageBadge")}
            />
          </div>
          <p hidden={mode !== undefined && mode !== "information" ? true : undefined} className="text-[11px] text-zinc-500 leading-relaxed">{t("ui.ageBadgeHint")}</p>
          {ageBadge && (mode === undefined || mode === "information") && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400 font-medium text-[11px] ps-5">
                {t("ui.ageBadgeCountry")}
              </span>
              <select
                value={ageCountry}
                onChange={(e) => {
                  setAgeCountry(e.target.value)
                }}
                aria-label={t("ui.ageBadgeCountry")}
                className="max-w-[190px] truncate px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-teal-500/50 cursor-pointer"
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code} className="bg-zinc-900 text-zinc-100">
                    {r.flag} {r.label} ({r.code})
                  </option>
                ))}
              </select>
            </div>
          )}
          {(mode === undefined || mode === "appearance") && (mode === "appearance" ? (
            ageStyleActive ? (
            <AvailabilityGate active name={t("ui.ageBadgeStyle")} hint="" testId="badge-age-style">
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted font-medium block">
                  {t("ui.ageBadgeStyle")}
                </label>
                <BadgeStyleSelector
                  value={ageBadgeStyle}
                  options={["standard", "knockout"] as const}
                  onChange={(v) => {
                    setAgeBadgeStyle(v)
                  }}
                  t={t}
                />
              </div>
            </AvailabilityGate>
            ) : null
          ) : ageBadge ? (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted font-medium block">
                {t("ui.ageBadgeStyle")}
              </label>
              <BadgeStyleSelector
                value={ageBadgeStyle}
                options={["standard", "knockout"] as const}
                onChange={(v) => {
                  setAgeBadgeStyle(v)
                }}
                t={t}
              />
            </div>
          ) : null)}
        </div>
      </div>
      )}

      {(mode !== "appearance" || qualityStyleActive) && (
      <div hidden={hideFor("quality") || modeHide("appearance")} data-testid="badge-quality-style-wrap">
        {mode === "appearance" ? (
          qualityStyleActive ? (
          <AvailabilityGate active name={t("ui.qualityBadgeStyle")} hint="" testId="badge-quality-style">
            <QualityStyleSection shape={targetShape} qualityEnabled={badgeQuality} onPreviewFamilyChange={onPreviewFamilyChange} forceShow />
          </AvailabilityGate>
          ) : null
        ) : (
          <QualityStyleSection shape={targetShape} qualityEnabled={badgeQuality} onPreviewFamilyChange={onPreviewFamilyChange} />
        )}
      </div>
      )}
      </BadgeGroup>
        </div>)}
      </section>
    </div>
  )
}
