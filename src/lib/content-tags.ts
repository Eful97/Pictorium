/**
 * Client-safe canonical registry for space-wide automatic tag-badge
 * exclusions (`disabledContentTags`).
 *
 * Exclusions are defaults-only and space-wide: shared across shapes, with no
 * per-title fields and no personal/ready preset additions. An absent/empty
 * list preserves historical behavior (fail-open to the legacy render).
 *
 * Individual content tags filter BEFORE priority selection: a disabled
 * candidate yields to the next enabled candidate inside the same bucket,
 * then to the subsequent buckets. Manual explicit custom overrides
 * (`queryExtra` / saved `customBadge`) stay authoritative and are never
 * filtered here.
 *
 * Sub-genres are addressed by canonical ID (`subgenre:<key>`, never by
 * localized label — labels move with the UI language, IDs don't). The
 * `subgenre` family ID disables every sub-genre badge at once.
 * Award/nomination use generic family IDs.
 */

/** Canonical sub-genre keys — must match `SUB_GENRES[].key` in `subgenres.ts`. */
export const SUBGENRE_TAG_KEYS: readonly string[] = [
  "timetravel",
  "cyberpunk",
  "whodunit",
  "heist",
  "zombie",
  "vampire",
  "paranormal",
  "kaiju",
  "postapocalyptic",
  "foundfootage",
  "noir",
  "spaghettiwestern",
  "martialarts",
  "spaceopera",
]

export const SUBGENRE_TAG_PREFIX = "subgenre:"

/** Generic family ID: disables every sub-genre badge at once. */
export const SUBGENRE_FAMILY_TAG = "subgenre"

/**
 * Canonical automatic content-tag IDs (stable, allowlisted).
 * Rank badges are intentionally absent: ranking switches live in the existing
 * tab and are never duplicated here.
 */
export const CONTENT_TAG_IDS: readonly string[] = [
  // upcoming bucket
  "upcoming",
  // new bucket
  "newMovie",
  "newSeries",
  "justAdded",
  "newSeason",
  "nextEpisode",
  // award bucket (generic families)
  "award",
  "nomination",
  "absoluteCinema",
  // extra bucket
  SUBGENRE_FAMILY_TAG,
  ...SUBGENRE_TAG_KEYS.map((k) => `${SUBGENRE_TAG_PREFIX}${k}`),
  "trueStory",
  "basedOnBook",
  "kdrama",
  "director",
  "studio",
  "miniseries",
  "returning",
  "seriesEnded",
]

const CONTENT_TAG_ID_SET: ReadonlySet<string> = new Set(CONTENT_TAG_IDS)

/** Max entries: bounded like the other catalog records. */
export const MAX_DISABLED_CONTENT_TAGS = 64

/**
 * Bounded validation for space-wide disabled content tags: keeps known
 * canonical IDs only (exact case — IDs are case-sensitive by contract),
 * dedupes, caps at 64. Unknown IDs are dropped (fail-closed); non-arrays
 * → [] (absent = historical behavior).
 */
export function sanitizeDisabledContentTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const id = v.trim()
    if (!CONTENT_TAG_ID_SET.has(id) || out.includes(id)) continue
    out.push(id)
    if (out.length >= MAX_DISABLED_CONTENT_TAGS) break
  }
  return out
}

/**
 * True when an automatic tag candidate is disabled space-wide.
 * Sub-genres match the family ID or their own canonical key
 * (`subgenre:<key>`); every other tag matches its own ID exactly.
 * Absent/empty lists (or a null key) → false (historical behavior).
 */
export function isContentTagDisabled(
  tagId: string | null | undefined,
  subGenreKey?: string | null,
  disabled?: ReadonlySet<string> | readonly string[] | null,
): boolean {
  if (!tagId || !disabled) return false
  const has = (id: string): boolean =>
    Array.isArray(disabled) ? disabled.includes(id) : (disabled as ReadonlySet<string>).has(id)
  if (tagId === SUBGENRE_FAMILY_TAG) {
    if (has(SUBGENRE_FAMILY_TAG)) return true
    if (subGenreKey && has(`${SUBGENRE_TAG_PREFIX}${subGenreKey}`)) return true
    return false
  }
  return has(tagId)
}
