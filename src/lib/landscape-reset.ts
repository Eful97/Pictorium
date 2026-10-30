/**
 * Additive clear contract for the landscape defaults profile.
 *
 * A profile key is cleared by OMITTING it (it inherits the portrait flat), but
 * a JSON PUT cannot express "remove this stored key" by omission: the server
 * merge would keep the old value. `landscapeReset` is the explicit, additive
 * list of profile keys the caller wants deleted after the normal merge /
 * backfill. It is transport-only (never stored), backward compatible (absent =
 * historical merge behavior) and fail-closed: only the keys supported by the
 * `/api/defaults` landscape schema are accepted, duplicates are folded.
 *
 * Keep in sync with the `landscape` object in `src/app/api/defaults/route.ts`.
 */
export const LANDSCAPE_RESET_KEYS = [
  "gradientHeight",
  "blurEnabled",
  "blurIntensity",
  "blurFade",
  "blurDarkness",
  "tintStrength",
  "topShade",
  "topShadeHeight",
  "logoScale",
  "logoOffsetX",
  "logoOffsetY",
  "topBadgeScale",
  "topBadgeOffsetX",
  "topBadgeOffsetY",
  "extraBadgeScale",
  "extraBadgeOffsetX",
  "extraBadgeOffsetY",
  "genreBadgeScale",
  "genreBadgeOffsetX",
  "genreBadgeOffsetY",
  "qualityBadgeScale",
  "qualityBadgeOffsetX",
  "qualityBadgeOffsetY",
  "badgeItemTransforms",
  "separateBadgeScale",
  "separateBadgeOffsetX",
  "separateBadgeOffsetY",
  "separateRatingsStyle",
  "posterLayout",
  "posterFreshScope",
  "networkLogoScale",
  "networkLogoOffsetX",
  "networkLogoOffsetY",
  "badgeStyle",
  "badgePresets",
  "rankingBadgeStyle",
  "extraBadgeStyle",
  "badgeFont",
  "qualityBadgeStyle",
  "videoFormats",
  "globalBadges",
  "rankingBadges",
  "badgeGenre",
  "badgeYear",
  "badgeRating",
  "badgeQuality",
  "ageBadge",
  "ageCountry",
  "ageBadgeStyle",
  "awardBadgeStyle",
  "minQuality",
  "customRatings",
  "separateRatings",
  "networkLogo",
  "networkLogoPosition",
  "networkLogoFollowTitle",
  "logoAlign",
  "preRelease",
  "ribbonSide",
  "ribbonEnabled",
  "sashOrder",
] as const

export type LandscapeResetKey = (typeof LANDSCAPE_RESET_KEYS)[number]

const RESET_KEYS = new Set<string>(LANDSCAPE_RESET_KEYS)

export function isLandscapeResetKey(value: unknown): value is LandscapeResetKey {
  return typeof value === "string" && RESET_KEYS.has(value)
}

/**
 * Canonical transport list: allowlisted keys only, deduplicated and sorted so
 * one configuration always produces one payload/key. Unknown/garbage entries
 * are dropped (never forwarded); callers that must fail closed validate the
 * raw input with `isLandscapeResetKey` first.
 */
export function sanitizeLandscapeReset(keys: readonly unknown[] | null | undefined): LandscapeResetKey[] {
  if (!Array.isArray(keys)) return []
  const out = new Set<LandscapeResetKey>()
  for (const key of keys) {
    if (isLandscapeResetKey(key)) out.add(key)
  }
  return [...out].sort()
}
