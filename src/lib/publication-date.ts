/**
 * Publication timestamp formatting (client-safe leaf, no imports).
 *
 * The stamps are Pictorium's own publication times (ms epoch of the served
 * pinned snapshot: `/api/tmdb/trending` body `updatedAt`, browse
 * `updatedAt`, `/api/mdblist/anime` `X-Pictorium-Updated-At-*` headers) —
 * never the upstream source's update time, never the request/page time.
 *
 * Validation is bounded and clock-free: finite positive integers inside
 * [2000-01-01, 2100-01-01) only. Anything else (null, non-numeric,
 * non-positive, non-integer, unparseable, out-of-range/absurd) is invalid →
 * null, so the UI renders the honest "unknown" line instead of inventing
 * freshness. The bound does not judge freshness against the browser clock:
 * a plausible-but-future timestamp inside the range still formats.
 */

export interface FormattedPublication {
  /** ISO-8601 instant for the accessible `<time dateTime>`. */
  readonly iso: string
  /** Localized "synced in Pictorium" caption (no date inside). */
  readonly label: string
  /** Localized date+time in Europe/Rome with short zone name. */
  readonly dateText: string
}

const MIN_VALID_MS = Date.UTC(2000, 0, 1)
const MAX_VALID_MS = Date.UTC(2100, 0, 1)

/**
 * Strict bounded parse for a publication stamp (ms epoch). Accepts numbers
 * and numeric strings (HTTP headers always arrive as strings); everything
 * else — null, non-numeric, non-positive, non-integer, unparseable,
 * out-of-range — collapses to null (unknown, never fresh). Bounds:
 * [2000-01-01, 2100-01-01): only absurd values are rejected, with no
 * freshness judgment against the browser clock.
 */
export function parsePublicationStamp(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
  if (!Number.isInteger(n) || n <= 0) return null
  if (n < MIN_VALID_MS || n >= MAX_VALID_MS) return null
  if (!Number.isFinite(new Date(n).getTime())) return null
  return n
}

export type PublicationT = (key: string, params?: Record<string, string | number>) => string

/**
 * Format a validated stamp for display. Returns null for anything invalid
 * (callers render the honest unknown line instead). Never throws: an
 * unformattable locale falls back to unknown rather than crashing render.
 */
export function formatPublicationDate(
  value: unknown,
  lang: string,
  t: PublicationT,
): FormattedPublication | null {
  const stamp = parsePublicationStamp(value)
  if (stamp === null) return null
  const date = new Date(stamp)
  // NOTE: `timeZoneName` is NOT combined with the dateStyle/timeStyle
  // shorthands (that combination throws RangeError on supported runtimes),
  // so the format uses explicit fields instead: same locale-aware output
  // (day/month names, order, digits, Europe/Rome, short zone).
  let dateText: string
  try {
    dateText = new Intl.DateTimeFormat(lang && typeof lang === "string" ? lang : "en", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Rome",
      timeZoneName: "short",
    }).format(date)
  } catch {
    return null
  }
  if (!dateText) return null
  return {
    iso: date.toISOString(),
    label: t("ui.publicationLabel"),
    dateText,
  }
}
