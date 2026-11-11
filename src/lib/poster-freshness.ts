/**
 * Task D — poster freshness cap (server-only, no pixels).
 *
 * A cached poster must not outlive the earliest REAL known freshness
 * deadline of the volatile facts it bakes in (trend/anime rankings,
 * time-dependent release status). The flat policy TTL alone (6h dynamic /
 * 24h mapped + jitter) can otherwise serve a poster long after its source
 * facts refreshed.
 *
 * Provenance rules (enforced by the helpers here, fed by read-only
 * `*RemainingMs` readers on the EXISTING source caches):
 * - Caps derive from ACTUAL source cache generation + TTL (absolute
 *   remaining), never `now + TTL` on a cache hit (no sliding renewal:
 *   cache reads never rewrite generation timestamps).
 * - Future calendar boundaries (digital-release UTC midnight, upcoming-badge
 *   local midnight) use the SAME day semantics as their consumers
 *   (`isDigitalPreRelease` parses `YYYY-MM-DDT00:00:00Z`;
 *   `getUpcomingReleaseLabel` compares against local midnight). A past date
 *   is never a deadline — metadata age alone must not fake staleness.
 * - Absent/disabled/unconsumed facts (null/undefined) impose no cap.
 * - Invalid deadlines (NaN/Infinity) are ignored and can never EXTEND the TTL.
 * - Non-positive deadlines (already-expired/now facts) collapse to a small
 *   positive floor — never 0, because 0/undefined means scheduled/infinite in
 *   the cache layer, and never rounded UP past the fact (no 60s-minimum
 *   extension of the expiry).
 * - The cap only ever SHRINKS the policy TTL (min); deterministic jitter
 *   applied beforehand can never push the poster past the cap.
 *
 * Explicitly NOT covered here (recorded, not claimed): the aggregated-rating
 * vote baked into the genre badge and the streaming-quality badge. Both have
 * their own freshness handling (ratings 6h success TTL + TMDB direct-vote
 * overlay; quality ephemeral-on-degraded) and capping them would widen this
 * task beyond the authorized rankings/release-status scope.
 */

/** Floor for an already-reached deadline: positive, never infinite, never past the fact. */
export const POSTER_FACT_FLOOR_MS = 1000


function isUsableDeadline(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Cap a policy TTL (ms) by the earliest fact deadline. Pure: no I/O, no
 * clock reads (pass `nowMs` explicitly where needed upstream).
 *
 * - No usable facts → base unchanged.
 * - Otherwise min(base, earliest fact); non-positive results floor at
 *   POSTER_FACT_FLOOR_MS (bounded by base, so the floor can never extend it).
 */
export function capPosterTtlMs(
  baseMs: number,
  facts: ReadonlyArray<number | null | undefined>,
): number {
  let earliest: number | null = null
  for (const fact of facts) {
    if (!isUsableDeadline(fact)) continue
    if (earliest === null || fact < earliest) earliest = fact
  }
  if (earliest === null) return baseMs
  const capped = Math.min(baseMs, earliest)
  if (capped <= 0) return Math.min(baseMs, POSTER_FACT_FLOOR_MS)
  return capped
}

function parseCalendarDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  // Reject impossible calendar dates the same way the raw-TTL guard does
  // (Date.parse normalizes 2020-02-30 instead of failing).
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null
  return { y, m, d }
}

/**
 * Milliseconds from `nowMs` until 00:00:00Z of the given `YYYY-MM-DD` date —
 * the exact instant `isDigitalPreRelease` flips (it parses
 * `${digitalDate}T00:00:00Z`). Null when absent/invalid/already reached:
 * a past digital date is normal history, not a freshness deadline.
 */
export function msUntilUtcDateBoundary(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const parsed = parseCalendarDate(dateStr)
  if (!parsed) return null
  const boundary = Date.UTC(parsed.y, parsed.m - 1, parsed.d)
  const remaining = boundary - nowMs
  return remaining > 0 ? remaining : null
}

/**
 * Milliseconds from `nowMs` until LOCAL midnight of the given `YYYY-MM-DD`
 * date — the instant the "upcoming release" badge flips (same day semantics
 * as `getUpcomingReleaseLabel`, which compares against local midnight).
 * Null when absent/invalid/already reached.
 */
export function msUntilLocalDateBoundary(
  dateStr: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const parsed = parseCalendarDate(dateStr)
  if (!parsed) return null
  const boundary = new Date(parsed.y, parsed.m - 1, parsed.d).getTime()
  const remaining = boundary - nowMs
  return remaining > 0 ? remaining : null
}

export interface PosterFactDeadlines {
  /** Absolute remaining of the consumed trend-rank source (null = not consumed). */
  readonly trendRankRemainingMs?: number | null
  /** Absolute remaining of the consumed anime-rank source (null = not consumed). */
  readonly animeRankRemainingMs?: number | null
  /** Absolute remaining of the consumed availability source (null = not consumed/unknown). */
  readonly availabilityRemainingMs?: number | null
  /** Future digital-release date only when the pre-release badge depends on it. */
  readonly digitalReleaseDate?: string | null
  /** Release/first-air date only when the upcoming badge actually renders. */
  readonly upcomingReleaseDate?: string | null
  readonly nowMs?: number
}

/**
 * Earliest REAL freshness deadline across the CONSUMED facts, or null when
 * nothing consumed imposes one. The caller decides consumption (ranking
 * enabled + live fetch won, no query override; pre-release actually depends
 * on the date; upcoming badge actually rendered) — this function only
 * compares honest deadlines, it never fetches.
 */
export function resolvePosterFactCapMs(facts: PosterFactDeadlines): number | null {
  const nowMs = facts.nowMs ?? Date.now()
  const candidates: Array<number | null | undefined> = [
    facts.trendRankRemainingMs,
    facts.animeRankRemainingMs,
    facts.availabilityRemainingMs,
    facts.digitalReleaseDate ? msUntilUtcDateBoundary(facts.digitalReleaseDate, nowMs) : null,
    facts.upcomingReleaseDate ? msUntilLocalDateBoundary(facts.upcomingReleaseDate, nowMs) : null,
  ]
  let earliest: number | null = null
  for (const candidate of candidates) {
    if (!isUsableDeadline(candidate)) continue
    if (earliest === null || candidate < earliest) earliest = candidate
  }
  return earliest
}

export interface PosterRankConsumption {
  /** Final render flag: the rank badge channel is actually enabled. */
  readonly rankingEnabled: boolean
  /** No query override: the rank was really fetched, not caller-supplied. */
  readonly fetchNeeded: boolean
  /** The live source won (not a saved-rank fallback, not an abort/budget loss). */
  readonly fetchWon: boolean
  /** The resolved rank value (null = genuine chart miss). */
  readonly rank: number | null
}

/**
 * Whether a rank source fact was CONSUMED into the poster and may therefore
 * bound its TTL. A genuine miss (live fetch won, title outside the chart) is
 * an ABSENT fact: the poster bakes "no badge" exactly like history, and the
 * 60s empty/throttle cadence of the source must not shrink every unranked
 * poster to a 1-minute TTL (render storm on the majority of titles). Rank
 * transitions still self-heal through the rank-carrying cache key.
 */
export function isRankFactConsumed(consumption: PosterRankConsumption): boolean {
  return (
    consumption.rankingEnabled &&
    consumption.fetchNeeded &&
    consumption.fetchWon &&
    consumption.rank !== null
  )
}

export interface PreReleaseDetectionState {
  /** Pre-release flag actually enabled for this render (query > token > defaults). */
  readonly preReleaseEnabled: boolean
  /** Media type: only movies can be pre-digital (series return false upstream). */
  readonly mediaType: string
  /**
   * JustWatch availability for the title: true/false = known answer,
   * null = fetch error or the 2500ms detection race was lost (preJw stays null).
   */
  readonly jwAvailable: boolean | null
}

/**
 * True when an ENABLED pre-release detection has no JustWatch answer yet
 * (fetch error or the 2500ms race lost, `preJw === null`). That is an
 * UNDECIDED volatile fact: the caller must mark the render ephemeral instead
 * of freezing a possibly-wrong poster for the flat 6h dynamic / 24h mapped
 * policy. Disabled pre-release and known answers (true/false) never trigger
 * this path — the known-answer freshness cap stays untouched.
 */
export function isPreReleaseDetectionUndecided(state: PreReleaseDetectionState): boolean {
  return (
    state.preReleaseEnabled &&
    state.mediaType === "movie" &&
    state.jwAvailable === null
  )
}
