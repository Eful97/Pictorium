"use client"

import { useState, type ReactNode } from "react"
import {
  isBottomSeparateActive,
  resolveSeparateDisplayState,
} from "@/lib/poster-config"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { isCardSkin } from "@/lib/card-layout-skins"
import type { SeparateRatingsStyle } from "@/lib/badge-styles"

/**
 * Effective availability (single shared gate for Badge/Transform settings).
 * Pure helpers over EFFECTIVE flags (`land ?? flat`, already resolved by the
 * scoped bindings): renderer truth lives in `poster-config` (bottom +
 * separate display) and is reused here — never re-derived.
 */

export type AvailabilityShape = "portrait" | "landscape"

export interface EffectiveBadgeFlags {
  globalBadges?: boolean | null
  badgeGenre?: boolean | null
  badgeYear?: boolean | null
  badgeRating?: boolean | null
  separateRatings?: boolean | null
  separateRatingsStyle?: SeparateRatingsStyle | string | null
  rankingBadges?: boolean | null
  sashOrder?: readonly string[] | null
  badgeQuality?: boolean | null
  customRatings?: boolean | null
  ageBadge?: boolean | null
  networkLogo?: boolean | null
  preRelease?: boolean | null
  posterLayout?: string | null
  posterFreshScope?: string | null
}

/** `land ?? flat` read (null/undefined = absent = follow the flat). */
export function effectiveFlag<T>(
  flat: T,
  land: T | undefined | null,
  shape: AvailabilityShape,
): T {
  if (shape !== "landscape") return flat
  return land !== undefined && land !== null ? land : flat
}

function on(v: boolean | null | undefined): boolean {
  return v ?? true
}

function sashHas(order: readonly string[] | null | undefined, bucket: string): boolean {
  // Nullable sash follows the saved-order contract: null/undefined = never
  // explicitly edited = canonical default order (all buckets on); [] stays
  // an explicit all-off. Never coerce [] to default.
  const eff = order ?? DEFAULT_SASH_ORDER
  return eff.includes(bucket)
}

/** Bottom suppression (renderer truth, independent of item count). */
export function isBottomActive(flags: EffectiveBadgeFlags): boolean {
  return isBottomSeparateActive({
    badgesEnabled: on(flags.globalBadges),
    badgeRating: !!flags.badgeRating,
    separateRatings: !!flags.separateRatings,
    separateRatingsStyle: (flags.separateRatingsStyle ?? "column") as SeparateRatingsStyle,
  })
}

/**
 * Separate display state for availability: item count is forced to 1 so an
 * unknown runtime provider never disables a potentially active feature.
 * Bottom suppression stays exact (renderer truth).
 */
export function availabilityDisplayState(flags: EffectiveBadgeFlags) {
  return resolveSeparateDisplayState({
    badgesEnabled: on(flags.globalBadges),
    badgeGenre: !!flags.badgeGenre,
    badgeYear: !!flags.badgeYear,
    badgeRating: !!flags.badgeRating,
    separateRatings: !!flags.separateRatings,
    separateRatingsStyle: (flags.separateRatingsStyle ?? "column") as SeparateRatingsStyle,
    sepItemCount: 1,
  })
}

/** Genre style: global && !bottom && (genre || year || rating-not-separated). */
export function isGenreStyleActive(flags: EffectiveBadgeFlags): boolean {
  if (!on(flags.globalBadges)) return false
  const display = availabilityDisplayState(flags)
  if (display.bottomActive) return false
  const ratingCounts = !!flags.badgeRating && !display.useSeparate
  return !!flags.badgeGenre || !!flags.badgeYear || ratingCounts
}

/** Badge font: common text style shared by every badge text renderer (genre,
 *  rank, extra, separate stacks, quality, custom rows, coming-soon ribbon).
 *  Active when at least one supported font consumer is effectively active;
 *  fully inactive (no consumer) hides the whole common font group — never an
 *  orphan disclosure/hint. Pure over EFFECTIVE flags, no duplicated logic. */
export function isBadgeFontActive(flags: EffectiveBadgeFlags): boolean {
  return (
    isGenreStyleActive(flags) ||
    isRankStyleActive(flags) ||
    isExtraStyleActive(flags) ||
    isSeparateStyleActive(flags) ||
    isQualityStyleActive(flags) ||
    isCustomRatingsActive(flags) ||
    isAgeStyleActive(flags)
  )
}

/** Rank appearance: master + rank sash bucket. */
export function isRankStyleActive(flags: EffectiveBadgeFlags): boolean {
  return !!flags.rankingBadges && sashHas(flags.sashOrder, "rank")
}

/**
 * Extra style: Coming Soon (preRelease) is independent of the rank master;
 * otherwise the server badge-priority chain renders `extra`-type badges for
 * the upcoming/new/award/extra buckets (rank itself is the only `rank`
 * type). Gate: preRelease || (rankingBadges && any upcoming/new/award/extra).
 */
export function isExtraStyleActive(flags: EffectiveBadgeFlags): boolean {
  if (!!flags.preRelease) return true
  if (!flags.rankingBadges) return false
  return (
    sashHas(flags.sashOrder, "upcoming") ||
    sashHas(flags.sashOrder, "new") ||
    sashHas(flags.sashOrder, "award") ||
    sashHas(flags.sashOrder, "extra")
  )
}

/**
 * Separate style picker: global && rating && separate. Intentionally NOT
 * gated on bottom (bottom styles are the picker's own values — the picker
 * stays reachable to switch back) and NOT on runtime item count (unknown
 * provider capabilities must not disable a potentially active feature).
 */
export function isSeparateStyleActive(flags: EffectiveBadgeFlags): boolean {
  return on(flags.globalBadges) && !!flags.badgeRating && !!flags.separateRatings
}

/** Age style (renderer exact: `ageBadge && badgesEnabled !== false`). */
export function isAgeStyleActive(flags: EffectiveBadgeFlags): boolean {
  return on(flags.globalBadges) && !!flags.ageBadge
}

/** Quality style: renderer-independent (quality badge ignores the master). */
export function isQualityStyleActive(flags: EffectiveBadgeFlags): boolean {
  return !!flags.badgeQuality
}

/**
 * Custom provider row: toggle on && !bottom-suppressed. Never gated on the
 * runtime item count or provider configuration (unknown at settings time).
 */
export function isCustomRatingsActive(flags: EffectiveBadgeFlags): boolean {
  if (!flags.customRatings) return false
  return !isBottomActive(flags)
}

/** Network geometry (scale/offsets + position): network master only. */
export function isNetworkGeometryActive(flags: EffectiveBadgeFlags): boolean {
  return !!flags.networkLogo
}

/** Meta (genre/rating badge) geometry: same gate as the genre style. */

/** Card scope: geometry locks apply ONLY with scope "all". */
export function isCardAllDefaults(layout: unknown, scope: unknown): boolean {
  return isCardSkin(layout) && scope === "all"
}

/** Geometry locked by a Card "all" skin (offsets disabled, values kept). */
export function isGeometryLocked(layout: unknown, scope: unknown): boolean {
  return isCardAllDefaults(layout, scope)
}

/** Stable active-first DOM order (never CSS `order` alone: focus follows DOM). */
export function orderActiveFirst<T>(items: ReadonlyArray<{ active: boolean; value: T }>): T[] {
  return [...items]
    .map((it, index) => ({ ...it, index }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)
    .map(({ value }) => value)
}

/**
 * Compact inactive disclosure: readable hint + the REAL controls retained
 * inside a disabled fieldset (no whole-container opacity, no unmount).
 * Active renders children directly. Appearance only — never adds toggles.
 */
export function AvailabilityGate({
  active,
  name,
  hint,
  children,
  testId,
}: {
  active: boolean
  name: string
  hint: string
  children: ReactNode
  testId: string
}) {
  const [open, setOpen] = useState(false)
  if (active) {
    return <div data-testid={testId}>{children}</div>
  }
  return (
    <details data-testid={`${testId}-inactive`} open={open} className="bg-surface/50 border border-surface2/60 rounded-xl px-3.5 py-2.5 space-y-1.5 shadow-sm">
      <summary
        onClick={(e) => {
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className="cursor-pointer list-none flex items-center justify-between gap-2 min-h-[32px]"
        aria-expanded={open}
      >
        <span className="text-[11px] text-muted font-medium">{name}</span>
        <span className="text-[10px] text-zinc-500">{open ? "\u2212" : "+"}</span>
      </summary>
      <p className="text-[11px] text-zinc-400 italic leading-snug">{hint}</p>
      <div hidden={!open}>
        <fieldset disabled className="contents">
          {children}
        </fieldset>
      </div>
    </details>
  )
}
