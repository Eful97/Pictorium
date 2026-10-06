/**
 * Demonstration badge data for the Settings defaults preview.
 *
 * Preview-only samples: shown when the chosen demo title has no real chart,
 * quality, network or ratings data, so every ENABLED badge still renders and
 * the user sees its actual style. Real data always wins — samples only fill
 * gaps, never override. Toggles and styles keep gating the render downstream.
 *
 * Server-side only in effect: the route applies these after the existing
 * preview auth/downgrade check, and only with `preview=1` plus the explicit
 * `demosamples=1` flag (emitted solely by `buildDefaultsPreviewUrl`). No new
 * upstream fetch, no key usage, no mapping writes, no cache writes for
 * previews. Pure module: no runtime imports.
 */

/** Query flag enabling demo samples (Settings preview builder only). */
export const DEMOSAMPLES_FLAG = "demosamples"

/** Sample trend rank shown when the title is in no chart. */
export const DEMO_SAMPLE_RANK = 11

/** Sample streaming tier shown when no offers resolve (top tier: it always
 *  passes the `qmin` minimum-quality gate). */
export const DEMO_SAMPLE_QUALITY = "4K" as const

/** Sample network shown when no network/company data resolves. The name
 *  matches a brand SVG already bundled in `public/networks/` (zero network
 *  fetch, real icon asset). */
export const DEMO_SAMPLE_NETWORK = { name: "Netflix", logoPath: null } as const

/** Sample genre shown only when TMDB details provide none. */
export const DEMO_SAMPLE_GENRE = "Avventura"

/** Sample release dates used only when details provide none (fixed past
 *  dates: no upcoming/new side effects, deterministic output). */
export const DEMO_SAMPLE_MOVIE_DATE = "2009-12-10"
export const DEMO_SAMPLE_TV_DATE = "2017-05-02"

/**
 * Sample provider ratings on the /10 scale used by aggregated sources
 * (percent-family sources render as `value * 10`, same as real data).
 * Only the user-selected sources are ever filled.
 */
export const DEMO_SAMPLE_RATING_SOURCES: Readonly<Record<string, number>> = {
  imdb: 8.2,
  tmdb: 7.6,
  mdblist: 7.9,
  tomatoes: 8.8,
  popcorntime: 9.1,
  letterboxd: 8.0,
  metacritic: 7.5,
  metacriticuser: 7.8,
  trakt: 8.0,
  simkl: 7.7,
  filmweb: 7.4,
  filmwebcritics: 7.0,
  rogerebert: 8.0,
  mal: 8.1,
  anilist: 8.0,
  kitsu: 8.3,
}

/** Fallback sample for a selected source without a curated value. */
export const DEMO_SAMPLE_RATING_DEFAULT = 7.5

export interface DemoSampledRatings {
  sources: Record<string, number>
  average: number
  count: number
}

/**
 * Merge real aggregated ratings with samples for the MISSING requested
 * sources only (absent keys — real scores, including 0, are never touched).
 * Average mirrors the fetch rule exactly: imdb+tmdb when present (typeof
 * number check included), otherwise all values. Returns the input untouched
 * when nothing is missing, null when nothing is renderable.
 */
export function mergeDemoSampleRatings(
  aggregated: { sources: Record<string, number>; average: number; count: number } | null | undefined,
  requestedSources: readonly string[],
): DemoSampledRatings | null {
  const sources: Record<string, number> = { ...(aggregated?.sources ?? {}) }
  let filled = false
  for (const raw of requestedSources) {
    const src = raw.trim().toLowerCase()
    if (!src || sources[src] !== undefined) continue
    const curated = DEMO_SAMPLE_RATING_SOURCES[src]
    sources[src] = typeof curated === "number" ? curated : DEMO_SAMPLE_RATING_DEFAULT
    filled = true
  }
  if (!filled) {
    if (!aggregated || Object.keys(aggregated.sources).length === 0) return null
    return { ...aggregated, sources: { ...aggregated.sources } }
  }
  const values = Object.values(sources)
  if (values.length === 0) return null
  const reference = [sources.imdb, sources.tmdb].filter((v): v is number => typeof v === "number")
  const pool = reference.length > 0 ? reference : values
  const average = pool.reduce((a, b) => a + b, 0) / pool.length
  return { sources, average, count: values.length }
}

/**
 * Accepted demo-samples request: effective preview (post downgrade) plus the
 * explicit flag at exactly "1". Anything else (absent, garbage, non-preview)
 * renders the genuine data path.
 */
export function isDemoSamplesRequest(input: {
  isPreview: boolean
  flag: string | null | undefined
}): boolean {
  return input.isPreview === true && input.flag === "1"
}

/**
 * Synthetic aggregated ratings for the requested sources only (same shape as
 * `fetchAggregatedRating`, same downstream path: average upgrade, custom row,
 * separate column). Average mirrors the fetch rule: imdb+tmdb when present,
 * otherwise all sampled values.
 */
export function sampleAggregatedRatings(requestedSources: readonly string[]): DemoSampledRatings {
  return (
    mergeDemoSampleRatings(null, requestedSources) ?? { sources: {}, average: 0, count: 0 }
  )
}
