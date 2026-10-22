/**
 * Shared poster truth for badge computation.
 * Used by both the server route and client hooks, ensuring the same badge
 * logic applies in preview (WYSIWYG) and final poster.
 */
import { computeBadge, computeAbsoluteCinema, isMiniseriesType, isReturningStatus, stripArabicDiacritics, NEXT_EPISODE_BADGE_KEY, isNextEpisodeBadgeKey, type BadgeResult, type SashBucket } from "./badge-priority"
import { getAwardBadgeLabel, getNominationBadgeLabel } from "./badge-labels"
import { withIdAwards, withIdNoms } from "./award-ids"
import { formatReleaseDate, getUpcomingReleaseLabel, type DateFormat } from "./release-badge"
import { getSubGenreMatch, getAllSubGenreMatches } from "./subgenres"
import { isContentTagDisabled } from "./content-tags"

export { NEXT_EPISODE_BADGE_KEY, isNextEpisodeBadgeKey }

export type BadgeT = (key: string, params?: Record<string, string | number>) => string

export interface BadgeInput {
  mediaType: "movie" | "tv"
  /** TMDB ID per il lookup premi certi (liste ID): assente = solo Wikidata. */
  tmdbId?: number | null
  /** Data uscita digitale (solo se già calcolata dal pre-release): Just Added. */
  digitalReleaseDate?: string | null
  releaseDate: string | null
  firstAirDate: string | null
  /** Ultima messa in onda (serie TV) — per il badge "Nuova stagione". */
  lastAirDate: string | null
  /** Numero di stagioni TMDB — per il suffisso "S2" del badge "Nuova stagione". */
  seasonCount: number | null
  /** Origin country di network + production companies (ISO-3166) — per "K-Drama". */
  originCountries: string[]
  /**
   * ID generi TMDB canonici (16 = Animation) — per escludere le serie animate
   * dal K-Drama automatico. Opzionale per compatibilità: assente/null/vuoto =
   * non animato (comportamento storico invariato, mai un'invenzione).
   */
  genreIds?: readonly number[] | null
  voteAverage: number
  trendRank: number | null
  animeRank: number | null
  awards: string[]
  nominations: string[]
  studios: string[]
  director: string | null
  tvType: string | null | undefined
  tvStatus: string | null | undefined
  /** TMDB `next_episode_to_air.air_date` (TV) — "Next episode" badge input. */
  nextEpisodeAirDate?: string | null
  /** TMDB `number_of_episodes` (TV) — enriches Miniseries 1..8. */
  numberOfEpisodes?: number | null
  networkLogoMatched?: boolean
  /** Keywords TMDB (per i sottogeneri) + true story / book. */
  keywords?: string[]
  /** IMDb Top 100 eligibility flag for Absolute Cinema (rank 1..100; legacy name kept, see badge-priority). Resolved externally (async fetch). */
  imdbTop250?: boolean
  /**
   * Space-wide disabled automatic content-tag IDs (canonical, see
   * `content-tags.ts`). Filters BEFORE priority selection: a disabled
   * candidate yields to the next enabled one. Absent/empty = historical
   * behavior. Manual explicit overrides never pass through here.
   */
  disabledContentTags?: readonly string[] | null
}

export interface ComputedTopBadge {
  readonly badge: BadgeResult | null
  readonly upcomingRelease: string | null
  readonly isNewMovie: boolean
  readonly isNewSeries: boolean
  readonly newSeason: string | null
  readonly nextEpisode: string | null
  readonly justAdded: string | null
  readonly seriesEnded: string | null
  readonly extraFallback: string | null
  readonly awardBadge: string | null
  readonly studioBadge: string | null
  readonly subGenreBadge: string | null
  readonly trueStory: string | null
  readonly basedOnBook: string | null
}

export function isNetworkStudio(studioName: string | null): boolean {
  if (!studioName) return false
  const lower = studioName.toLowerCase().trim()
  return !!(
    lower.includes("netflix") ||
    lower.includes("hbo") || lower === "max" ||
    lower.includes("disney") ||
    lower.includes("prime") || lower.includes("amazon") ||
    lower.includes("apple") ||
    lower.includes("paramount") ||
    lower === "rai" || lower.startsWith("rai ") ||
    lower.includes("crunchyroll")
  )
}

/**
 * Canonical Sky provider-family keys (bundled marks): `sky` covers Sky and
 * NOW (same service, the NOW mark), `sky_cinema` keeps its own mark but
 * stays in the family. Explicit set — never substring heuristics.
 */
const SKY_FAMILY_KEYS: ReadonlySet<string> = new Set(["sky", "sky_cinema"])

/**
 * True for names in the Sky provider family (Sky, Sky Cinema, NOW).
 * Mirrors the sky branch of the network resolver
 * (`network-svgs.ts:getNetworkKey`) without importing server-only modules:
 * - "Sky Cinema" before the generic Sky match (own mark, same family);
 * - SKY PerfecTV! (Japanese satellite) explicitly excluded;
 * - `\bsky\b` boundary so "Skydance" never matches;
 * - NOW only as the whole name or its head ("NOW", "NOW TV"), never as a
 *   word anywhere (avoids "Don't Look Now" false positives).
 */
export function isSkyFamilyName(value: string | null | undefined): boolean {
  const lower = (value ?? "").toLowerCase().trim()
  if (!lower) return false
  if (lower.includes("sky perfec")) return false
  if (lower.includes("sky cinema")) return true
  if (/\bsky\b/.test(lower)) return true
  if (lower === "now" || lower.startsWith("now ")) return true
  return false
}

export interface ProviderBadgeLogo {
  readonly networkKey: string
  readonly matchedName: string
}

/**
 * True when an AUTO extra top badge repeats provider information already
 * visibly represented by the rendered network logo. Narrow Sky-family
 * equivalence only (same information twice: "Sky" pill + NOW/Sky mark):
 * - rank badges, award labels and other families never match;
 * - manual custom text (`queryExtra`) is never auto-suppressed;
 * - a disabled or missing logo (null) keeps the badge (useful, not redundant).
 */
export function shouldSuppressExtraTopBadgeForNetwork(input: {
  readonly label: string
  readonly type: "extra" | "rank" | null
  readonly manualOverride: boolean
  readonly networkLogo: ProviderBadgeLogo | null
}): boolean {
  if (input.type !== "extra") return false
  if (input.manualOverride) return false
  const logo = input.networkLogo
  if (!logo) return false
  if (!isSkyFamilyName(input.label)) return false
  if (SKY_FAMILY_KEYS.has(logo.networkKey.toLowerCase().trim())) return true
  return isSkyFamilyName(logo.matchedName)
}

/**
 * Badge "Nuova stagione": serie TV con ultima messa in onda recente (<14gg)
 * ma prima messa in onda vecchia (altrimenti è "Nuova serie", non nuova stagione).
 * Con seasonCount > 1 usa `badge.newSeasonN`, che include il numero (es.
 * "Nuova S2"). Il numero sta DENTRO la stringa tradotta e non
 * concatenato dopo: in ebraico un " S2" attaccato a un testo RTL produce una
 * stringa a direzione mista, mentre così ogni lingua decide dove metterlo.
 * Formula condivisa con BadgeControls (mai forkare): entrambi importano da qui.
 */
export function getNewSeasonLabel(input: {
  lastAirDate?: string | null
  firstAirDate?: string | null
  seasonCount?: number | null
  t: BadgeT
}): string | null {
  const now = Date.now()
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
  const lastTime = input.lastAirDate ? new Date(input.lastAirDate).getTime() : NaN
  if (!Number.isFinite(lastTime)) return null
  if (!(lastTime <= now && (now - lastTime) < TWO_WEEKS_MS)) return null
  const firstTime = input.firstAirDate ? new Date(input.firstAirDate).getTime() : NaN
  if (Number.isFinite(firstTime) && firstTime <= now && (now - firstTime) < TWO_WEEKS_MS) return null
  const n = input.seasonCount
  const numbered = typeof n === "number" && Number.isFinite(n) && n > 1
  return numbered ? input.t("badge.newSeasonN", { n: n! }) : input.t("badge.newSeason")
}

/**
 * Strict `YYYY-MM-DD` calendar parse for the next-episode badge ONLY.
 * The shared upcoming helper (`parseTmdbDate`) stays loose on purpose and is
 * left untouched. This parser requires exact zero-padded shape, a real month
 * (1-12), and a real day via round-trip (rejects overflow like 2026-02-30 or
 * 2026-10-32, month 13, non-padded parts, and trailing junk).
 */
export function parseStrictTmdbDate(value?: string | null): Date | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > daysInMonth) return null
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

/**
 * "Next episode {date}" badge from the TMDB `next_episode_to_air.air_date`.
 * Only future dates inside the 14 calendar-day window: an aired episode is
 * covered by "new season", one months away is noise. TV only.
 */
export function getNextEpisodeLabel(input: {
  mediaType: "movie" | "tv"
  airDate?: string | null
  locale?: string
  dateFormat?: DateFormat | null
  t: BadgeT
}): string | null {
  if (input.mediaType !== "tv") return null
  const date = parseStrictTmdbDate(input.airDate)
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Calendar-day difference (UTC, DST-safe: across a DST switch a plain
  // ms/86400000 division yields 14.04 and would wrongly drop day 14).
  const days = Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / (24 * 60 * 60 * 1000),
  )
  if (days < 1 || days > 14) return null
  return input.t("badge.nextEpisode", { date: formatReleaseDate(date, input.locale ?? "it", input.dateFormat ?? "locale") })
}

/**
 * Resolve a canonical manual next-episode selection to its CURRENT label.
 * Exact token match only (`__badge.nextEpisode`); any other value — including
 * free-text that happens to look like a next-episode badge — returns null so
 * existing manual text is never reinterpreted. Returns null when the window
 * elapsed (no stale dated text is ever resurrected).
 */
export function resolveManualNextEpisodeLabel(
  queryExtra: string | null | undefined,
  input: {
    mediaType: "movie" | "tv"
    airDate?: string | null
    locale?: string
    dateFormat?: DateFormat | null
    t: BadgeT
  },
): string | null {
  if (!isNextEpisodeBadgeKey(queryExtra ?? null)) return null
  return getNextEpisodeLabel({
    mediaType: input.mediaType,
    airDate: input.airDate ?? null,
    locale: input.locale,
    dateFormat: input.dateFormat ?? null,
    t: input.t,
  })
}

/**
 * Canonical TMDB keyword sets (lowercase, exact match — never substrings or
 * title text) for the "true story" and "book" content badges.
 */
const TRUE_STORY_KEYWORDS: ReadonlySet<string> = new Set([
  "based on true story",
  "based on a true story",
])

const BASED_ON_BOOK_KEYWORDS: ReadonlySet<string> = new Set([
  "based on novel or book",
  "based on novel",
  "based on book",
  "based on young adult novel",
])

/**
 * "Based on a true story" badge: exact match on normalized TMDB keywords
 * (lowercase + trim). Movies and series.
 */
export function getTrueStoryLabel(keywords: readonly string[] | undefined | null, t: BadgeT): string | null {
  if (!keywords?.length) return null
  const hit = keywords.some((k) => TRUE_STORY_KEYWORDS.has(k.toLowerCase().trim()))
  return hit ? t("badge.trueStory") : null
}

/**
 * "Based on a book" badge: exact match on normalized TMDB keywords.
 * Movies and series. Independent from the true-story badge: when both apply,
 * both are selectable and auto follows the documented priority (story first).
 */
export function getBasedOnBookLabel(keywords: readonly string[] | undefined | null, t: BadgeT): string | null {
  if (!keywords?.length) return null
  const hit = keywords.some((k) => BASED_ON_BOOK_KEYWORDS.has(k.toLowerCase().trim()))
  return hit ? t("badge.basedOnBook") : null
}

/**
 * Episode count for the "Only N episodes" enrichment: only a typed miniseries
 * (same match as isMiniseriesType, never a short regular series) with a known
 * integer count 1..8. Out of bounds = null (plain Miniseries unchanged).
 */
export function getFewEpisodesLabel(input: {
  tvType: string | null | undefined
  episodeCount?: number | null
  t: BadgeT
}): string | null {
  if (!isMiniseriesType(input.tvType)) return null
  const n = input.episodeCount
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 8) return null
  return input.t("badge.onlyEpisodes", { n })
}

/**
 * Badge "Just Added": film con uscita digitale recente (<14gg, mai futura).
 * Solo film: la data digitale arriva dal rilevamento pre-release (route),
 * assente = niente bollino (mai una chiamata forzata, mai un'invenzione).
 */
export function getJustAddedLabel(input: {
  digitalReleaseDate?: string | null
  mediaType: "movie" | "tv"
  t: BadgeT
}): string | null {
  if (input.mediaType !== "movie") return null
  const time = input.digitalReleaseDate ? new Date(input.digitalReleaseDate).getTime() : NaN
  if (!Number.isFinite(time)) return null
  const now = Date.now()
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
  if (!(time <= now && (now - time) < TWO_WEEKS_MS)) return null
  return input.t("badge.justAddedMovie")
}

/** Stati "serie finita" (TMDB li localizza: en/it/ar + tr/nl/sv).
 *  L'arabo arriva vocalizzato ("مُنتهٍ"): il confronto avviene spogliando i
 *  diacritici ("منته"), piu variante non vocalizzata "منتهي". */
const ENDED_STATUSES = ["ended", "terminata", "terminato", "finita", "finito", "conclusa", "concluso", "bitti", "afgelopen", "avslutad"]

/**
 * Badge "Serie conclusa": status finita + ultima puntata recente (<14gg,
 * mai futura). Solo transitorio verificato: "Cancellata" resta fuori di
 * proposito (altro significato). In coda a `extra`, MAI in `upcoming`.
 */
export function getSeriesEndedLabel(input: {
  tvStatus?: string | null | undefined
  lastAirDate?: string | null
  t: BadgeT
}): string | null {
  const s = (input.tvStatus || "").trim().toLowerCase()
  if (!ENDED_STATUSES.includes(s)) {
    const ar = stripArabicDiacritics(s)
    if (ar !== "منته" && ar !== "منتهي") return null
  }
  const lastTime = input.lastAirDate ? new Date(input.lastAirDate).getTime() : NaN
  if (!Number.isFinite(lastTime)) return null
  const now = Date.now()
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
  if (!(lastTime <= now && (now - lastTime) < TWO_WEEKS_MS)) return null
  return input.t("badge.seriesEnded")
}

/**
 * True se almeno un origin country di network/production è KR (K-Drama).
 * Confronto case-insensitive su codici ISO-3166 già normalizzati da TMDB.
 */
export function isKDramaOrigin(originCountries: readonly string[] | undefined | null): boolean {
  return !!originCountries?.some((c) => c?.trim().toUpperCase() === "KR")
}

/** ID genere TMDB canonico per Animation (stabile tra lingue, a differenza dei nomi). */
export const TMDB_ANIMATION_GENRE_ID = 16

/**
 * True se i generi TMDB includono Animation (id 16 canonico).
 * Assente/null/vuoto = non animato (fail-open verso il comportamento storico:
 * mai escludere un titolo per dati mancanti).
 */
export function isAnimationGenreIds(genreIds: readonly number[] | undefined | null): boolean {
  return !!genreIds?.some((id) => id === TMDB_ANIMATION_GENRE_ID)
}

/**
 * Eleggibilità al K-Drama AUTOMATICO: KR live-action soltanto.
 * Le serie animate (anche coreane, es. Solo Leveling) non ricevono mai il
 * K-Drama automatico; i generi mancanti restano eleggibili (compatibilità).
 * Le etichette manuali esplicite ("K-Drama" scelto dall'utente) non passano
 * di qui e restano sempre onorate (queryExtra vince sul calcolato).
 */
export function isKDramaBadgeEligible(
  originCountries: readonly string[] | undefined | null,
  genreIds?: readonly number[] | undefined | null,
): boolean {
  return isKDramaOrigin(originCountries) && !isAnimationGenreIds(genreIds)
}

/**
 * Single entry point for badge computation — shared by server (route.ts)
 * and client (usePosterSave.ts, poster-url.ts).
 * Returns both the final badge and intermediate values so callers can
 * use them for save logic without recomputing.
 */
export function computeTopBadge(input: BadgeInput, t: BadgeT, locale?: string, order?: readonly SashBucket[] | null, dateFormat?: DateFormat | null): ComputedTopBadge {
  const now = Date.now()
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
  // Future-date guard: with a forward date, (now - date) is negative and
  // therefore always < TWO_WEEKS_MS, which would badge everything as "new"
  // through the whole pre-release window. "New" only applies to past dates
  // inside two weeks; future dates belong to the upcoming badge.
  const releaseTime = input.releaseDate ? new Date(input.releaseDate).getTime() : NaN
  const isNewMovie = input.mediaType === "movie" && Number.isFinite(releaseTime)
    ? releaseTime <= now && (now - releaseTime) < TWO_WEEKS_MS
    : false
  const firstAirTime = input.firstAirDate ? new Date(input.firstAirDate).getTime() : NaN
  const isNewSeries = input.mediaType === "tv" && Number.isFinite(firstAirTime)
    ? firstAirTime <= now && (now - firstAirTime) < TWO_WEEKS_MS
    : false

  // Certain awards from curated ID lists first, then generic Wikidata labels
  // (same canonical strings keep dropdown/cache in sync, see award-ids.ts).
  const mergedAwards = withIdAwards(input.tmdbId, input.mediaType, input.awards)
  const mergedNoms = withIdNoms(input.tmdbId, input.mediaType, input.nominations)
  const awardBadge = mergedAwards.length ? getAwardBadgeLabel(mergedAwards, t) : null
  const nomination = !awardBadge && mergedNoms.length
    ? getNominationBadgeLabel(mergedNoms, t)
    : null
  const studioBadge = input.studios.length ? input.studios[0] : null
  const isNetStudio = isNetworkStudio(studioBadge)
  const studio = (input.networkLogoMatched || isNetStudio) ? null : studioBadge
  const extraFallback = computeAbsoluteCinema({
    mediaType: input.mediaType,
    imdbTop250: !!input.imdbTop250,
  }, t)

  const upcomingRelease = getUpcomingReleaseLabel({
    mediaType: input.mediaType,
    releaseDate: input.releaseDate,
    firstAirDate: input.firstAirDate,
    locale: locale || "it",
    dateFormat: dateFormat ?? "locale",
    t,
  })

  const subGenreMatch = getSubGenreMatch(input.keywords || [], locale)
  const subGenreBadge = subGenreMatch?.label ?? null
  // Auto pick: with several canonical keyword matches a disabled first
  // match yields to the next ENABLED sub-genre before lower-priority
  // buckets (true story, book, …). The introspected `subGenreBadge` above
  // stays the first overall match (manual dropdown stays unfiltered and
  // authoritative: an explicit choice can still select a disabled label).
  const disabledSet = input.disabledContentTags ?? null
  const autoSubGenre = getAllSubGenreMatches(input.keywords || [], locale).find(
    (m) => !isContentTagDisabled("subgenre", m.key, disabledSet),
  ) ?? null

  const justAdded = getJustAddedLabel({
    digitalReleaseDate: input.digitalReleaseDate,
    mediaType: input.mediaType,
    t,
  })
  const seriesEnded = input.mediaType === "tv"
    ? getSeriesEndedLabel({ tvStatus: input.tvStatus, lastAirDate: input.lastAirDate, t })
    : null
  // A just-ended series is NOT a "new season": the finale suppresses that
  // label (same rule as the dropdown, never fork the formula).
  const newSeason = input.mediaType === "tv" && !seriesEnded
    ? getNewSeasonLabel({
        lastAirDate: input.lastAirDate,
        firstAirDate: input.firstAirDate,
        seasonCount: input.seasonCount,
        t,
      })
    : null
  const trueStory = getTrueStoryLabel(input.keywords || [], t)
  const basedOnBook = getBasedOnBookLabel(input.keywords || [], t)
  const nextEpisode = input.mediaType === "tv"
    ? getNextEpisodeLabel({
        mediaType: "tv",
        airDate: input.nextEpisodeAirDate,
        locale: locale || "it",
        dateFormat: dateFormat ?? "locale",
        t,
      })
    : null
  const isKDrama = input.mediaType === "tv" && isKDramaBadgeEligible(input.originCountries, input.genreIds)
  // Miniseries (permanent format) and returning series (transient status):
  // same conditions as the dropdown (getAllBadgeOptions), promoted to auto
  // at the extra tail. Single badge: miniseries wins over returning. Matchers
  // live in isMiniseriesType/isReturningStatus (badge-priority). With a known
  // count 1..8 the miniseries enriches to "Only N episodes" (never a short
  // regular series: miniseries type only, see getFewEpisodesLabel).
  const fewEpisodes = input.mediaType === "tv"
    ? getFewEpisodesLabel({ tvType: input.tvType, episodeCount: input.numberOfEpisodes, t })
    : null
  const miniseries = input.mediaType === "tv" && isMiniseriesType(input.tvType)
    ? (fewEpisodes ?? t("badge.miniseries"))
    : null
  const returning = input.mediaType === "tv" && !miniseries && isReturningStatus(input.tvStatus)
    ? t("badge.returning")
    : null

  const badge = computeBadge({
    mediaType: input.mediaType,
    upcomingRelease,
    isNewMovie,
    isNewSeries,
    justAdded,
    newSeason,
    nextEpisode,
    animeRank: input.animeRank,
    trendRank: input.trendRank,
    award: awardBadge,
    nomination,
    studio,
    director: input.director,
    miniseries,
    returning,
    seriesEnded,
    subGenre: autoSubGenre?.label ?? null,
    subGenreKey: autoSubGenre?.key ?? null,
    trueStory,
    basedOnBook,
    isKDrama,
    imdbTop250: !!input.imdbTop250,
    extra: extraFallback,
    disabledContentTags: input.disabledContentTags ?? null,
  }, t, order)

  return {
    badge,
    upcomingRelease,
    isNewMovie,
    isNewSeries,
    newSeason,
    nextEpisode,
    justAdded,
    seriesEnded,
    extraFallback,
    awardBadge,
    studioBadge,
    subGenreBadge,
    trueStory,
    basedOnBook,
  }
}

/**
 * Which badge value to freeze into the saved mapping's `badgeExtra`.
 * Time-bound badges are never frozen (they would stick forever): upcoming,
 * new season, next episode (ephemeral date), returning, Just Added, and
 * ended series (transient status, recomputed at runtime). Miniseries (even
 * enriched to "Only N episodes"), true story, and book stay freezable
 * (permanent properties).
 */
export function resolveSavedBadgeExtra(
  computed: Pick<ComputedTopBadge, "badge" | "upcomingRelease" | "newSeason"> & Partial<Pick<ComputedTopBadge, "justAdded" | "seriesEnded" | "nextEpisode">>,
  t: BadgeT,
): string | undefined {
  if (computed.badge?.type !== "extra") return undefined
  if (computed.upcomingRelease && computed.badge.label === computed.upcomingRelease) return undefined
  if (computed.newSeason && computed.badge.label === computed.newSeason) return undefined
  if (computed.nextEpisode && computed.badge.label === computed.nextEpisode) return undefined
  if (computed.badge.label === t("badge.returning")) return undefined
  if (computed.justAdded && computed.badge.label === computed.justAdded) return undefined
  if (computed.seriesEnded && computed.badge.label === computed.seriesEnded) return undefined
  return computed.badge.label
}

/**
 * True when the EFFECTIVE displayed top badge is the next-episode badge
 * (auto or canonical manual identity). Uses the shared selection
 * (`computeTopBadge`) — no divergent priority chain.
 *
 * - Manual token (`__badge.nextEpisode`) wins when eligible (same as the
 *   renderer: explicit override beats computed, Coming Soon never overrides a
 *   manual choice); elapsed token = miss, never a stale date.
 * - Any other manual text wins over auto (auto next is not displayed).
 * - Auto path reuses `computeTopBadge` with the same inputs, so rank,
 *   upcoming, awards, sash-disabled (`new` off), and Coming Soon overrides
 *   all behave exactly like the render: only a truly displayed next badge
 *   returns true.
 * - Network/logo suppression cannot trigger for dated next-episode labels
 *   (exact dated text never equals a provider name, and the Sky-family guard
 *   skips manual overrides), so it needs no separate branch here.
 */
export function isNextEpisodeDisplayed(input: {
  mediaType: "movie" | "tv"
  rankingEnabled: boolean
  badgesEnabled?: boolean
  queryExtra: string | null | undefined
  badgeInput: BadgeInput
  locale?: string
  sashOrder?: readonly SashBucket[] | null
  dateFormat?: DateFormat | null
  preRelease?: boolean
  t: BadgeT
}): boolean {
  if (input.mediaType !== "tv") return false
  if (!input.rankingEnabled) return false
  if (input.badgesEnabled === false) return false
  const locale = input.locale ?? "it"
  const dateFormat = input.dateFormat ?? "locale"
  const nextLabel = getNextEpisodeLabel({
    mediaType: "tv",
    airDate: input.badgeInput.nextEpisodeAirDate ?? null,
    locale,
    dateFormat,
    t: input.t,
  })
  if (!nextLabel) return false
  const raw = input.queryExtra ?? null
  if (isNextEpisodeBadgeKey(raw)) return true
  if (raw) return false
  const computed = computeTopBadge(input.badgeInput, input.t, locale, input.sashOrder ?? null, dateFormat)
  if (!computed.badge || computed.badge.type !== "extra") return false
  if (computed.badge.label !== nextLabel) return false
  if (input.preRelease) {
    const isUpcoming = !!computed.upcomingRelease && computed.badge.label === computed.upcomingRelease
    if (!isUpcoming) return false
  }
  return true
}
