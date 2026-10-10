import type { TMDBEpisodeGroupDetails } from "@/lib/tmdb"
import type { StremioVideo } from "@/lib/meta-handler"
import { posterUrl } from "@/lib/tmdb"
import { getTvdbEpisodesResult, getTvdbSeriesId, formatTvdbImageUrl } from "@/lib/tvdb"
import { combineAbortSignals } from "@/lib/abort-signal"

// Per-fetch AniZip cap: preserves the previous 5s internal timeout; when a
// budget signal is present the combined signal fires on whichever comes first.
const ANIZIP_FETCH_TIMEOUT_MS = 5000

type PreviewVideo = StremioVideo

/**
 * Risolve il seasonNumber per un gruppo TMDB considerando
 * la quirks "order 0 vs 1" e lo special 0 → S0.
 * Estratta da meta-handler + preview per evitare drift (Re:ZERO fix).
 */
export function resolveSeasonNumbers(groups: TMDBEpisodeGroupDetails["groups"]): {
  sorted: TMDBEpisodeGroupDetails["groups"]
  hasZero: boolean
  hasSpecials: boolean
} {
  const sorted = [...groups].sort((a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0))
  const hasZero = sorted.some((g) => g.order === 0)
  const hasSpecials = sorted.some((g) => g.name?.toLowerCase().includes("special"))
  return { sorted, hasZero, hasSpecials }
}

export function seasonNumberForGroup(
  grp: TMDBEpisodeGroupDetails["groups"][number],
  idx: number,
  sorted: TMDBEpisodeGroupDetails["groups"],
  hasZero: boolean,
  hasSpecials: boolean
): number {
  if (typeof grp.order === "number") {
    if (hasSpecials && grp.name?.toLowerCase().includes("special") && grp.order === 0) return 0
    if (hasZero) return hasSpecials ? grp.order : grp.order + 1
    return grp.order
  }
  return idx + 1
}

/**
 * Costruisce i video Stremio da un Episode Group TMDB.
 * Condivisa tra meta-handler e preview per WYSIWYG sync.
 */
export function buildVideosFromGroups(
  groupDetails: TMDBEpisodeGroupDetails,
  primaryId: string
): PreviewVideo[] {
  const videos: PreviewVideo[] = []
  const nonEmpty = groupDetails.groups.filter((g) => g.episodes && g.episodes.length > 0)
  const groupsForMeta = nonEmpty.length > 0 ? nonEmpty : groupDetails.groups
  const { sorted, hasZero, hasSpecials } = resolveSeasonNumbers(groupsForMeta)

  for (let gIdx = 0; gIdx < sorted.length; gIdx++) {
    const grp = sorted[gIdx]
    const seasonNumber = seasonNumberForGroup(grp, gIdx, sorted, hasZero, hasSpecials)
    const sortedEps = [...(grp.episodes || [])].sort((a, b) => (typeof a.order === "number" ? a.order : 0) - (typeof b.order === "number" ? b.order : 0))
    for (let epIdx = 0; epIdx < sortedEps.length; epIdx++) {
      const ep = sortedEps[epIdx]
      const episodeNumber = typeof ep.order === "number" ? ep.order + 1 : epIdx + 1
      videos.push({
        id: `${primaryId}:${seasonNumber}:${episodeNumber}`,
        name: ep.name || `Episodio ${episodeNumber}`,
        season: seasonNumber,
        episode: episodeNumber,
        overview: ep.overview || undefined,
        thumbnail: ep.still_path ? posterUrl(ep.still_path, "w500") : undefined,
        released: ep.air_date ? `${ep.air_date}T00:00:00.000Z` : undefined,
        rating: ep.vote_average ? ep.vote_average.toFixed(1) : undefined,
      })
    }
  }
  return videos
}

/**
 * Esegue una mappatura concorrente limitata (default 5) per evitare burst TMDB
 * su serie con molte stagioni (es. One Piece 20+ stagioni).
 */
export async function concurrentMap<T, R>(items: T[], fn: (item: T, idx: number) => Promise<R>, limit = 5): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[]
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

const ANIZIP_CACHE = new Map<string, { value: unknown; expiry: number }>()
const ANIZIP_TTL_MS = 6 * 60 * 60 * 1000
const ANIZIP_MAX = 200

function anizipCacheGet(key: string): unknown | undefined {
  const e = ANIZIP_CACHE.get(key)
  if (!e || Date.now() > e.expiry) {
    if (e) ANIZIP_CACHE.delete(key)
    return undefined
  }
  return e.value
}
function anizipCacheSet(key: string, value: unknown) {
  if (ANIZIP_CACHE.size >= ANIZIP_MAX) {
    const oldest = ANIZIP_CACHE.keys().next().value as string | undefined
    if (oldest) ANIZIP_CACHE.delete(oldest)
  }
  ANIZIP_CACHE.set(key, { value, expiry: Date.now() + ANIZIP_TTL_MS })
}

/** Test-only: clears the in-memory AniZip cache. */
export function __clearAnizipCache(): void {
  ANIZIP_CACHE.clear()
}

interface AnizipEpisode {
  tvdbShowId?: number
  seasonNumber?: number
  episodeNumber?: number
  absoluteEpisodeNumber?: number
  title?: Record<string, string>
  overview?: string
  summary?: string
  image?: string
  airDate?: string
  rating?: string | number
}

interface AnizipPayload {
  episodes?: Record<string, AnizipEpisode>
  mappings?: Record<string, unknown>
}

async function fetchAnizip(tmdbId: number, signal?: AbortSignal): Promise<AnizipPayload | null> {
  const key = `tmdb:${tmdbId}`
  const cached = anizipCacheGet(key) as AnizipPayload | undefined
  if (cached) return cached
  if (signal?.aborted) return null
  const combined = signal ? combineAbortSignals(signal, ANIZIP_FETCH_TIMEOUT_MS) : AbortSignal.timeout(ANIZIP_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.ani.zip/mappings?themoviedb_id=${tmdbId}`, {
      signal: combined,
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as AnizipPayload
    if (!data || !data.episodes) return null
    anizipCacheSet(key, data)
    return data
  } catch {
    return null
  }
}

export async function buildVideosFromAnizip(tmdbId: number, primaryId: string, signal?: AbortSignal): Promise<PreviewVideo[]> {
  const payload = await fetchAnizip(tmdbId, signal)
  if (!payload?.episodes) return []
  const eps = Object.values(payload.episodes)
  // filtra S* specials, ordina per assoluto o stagione/episodio
  const regular = eps.filter((e) => typeof e.seasonNumber === "number" && typeof e.episodeNumber === "number" && e.seasonNumber !== 0)
  const sorted = regular.sort((a, b) => (a.seasonNumber! - b.seasonNumber!) || (a.episodeNumber! - b.episodeNumber!))
  const videos: PreviewVideo[] = []
  for (const ep of sorted) {
    const title = ep.title?.en || ep.title?.["x-jat"] || ep.title?.ja || `Episodio ${ep.episodeNumber}`
    videos.push({
      id: `${primaryId}:${ep.seasonNumber}:${ep.episodeNumber}`,
      name: title,
      season: ep.seasonNumber!,
      episode: ep.episodeNumber!,
      overview: ep.overview || ep.summary || undefined,
      thumbnail: ep.image || undefined,
      released: ep.airDate ? `${ep.airDate}T00:00:00.000Z` : undefined,
      rating: ep.rating ? String(ep.rating) : undefined,
    })
  }
  return videos
}

/**
 * True when the TMDB /season response can be considered complete against the
 * episode_count declared in the details. Null/missing payloads, unexpectedly
 * empty lists and short lists mark partial (callers serve with a short TTL
 * and retry); zero-episode seasons and not-yet-aired future seasons stay
 * complete by construction and must never mark partial.
 *
 * Truncation rule: with a known positive expected count, any short list is
 * partial even when it already contains a future-dated episode (one future
 * entry does not prove the tail arrived). Full-length lists stay complete
 * even when they include future dates. A missing payload with an unknown
 * expected count cannot prove completeness, so it marks partial; only an
 * explicit zero count may be complete.
 */
export function isSeasonEpisodesComplete(
  season: { episodes?: { air_date?: string }[] | null } | null | undefined,
  expectedCount?: number | null,
  seasonAirDate?: string | null,
): boolean {
  const hasExpected = typeof expectedCount === "number" && Number.isFinite(expectedCount)
  const episodes = season?.episodes
  if (!Array.isArray(episodes)) {
    if (hasExpected && expectedCount! <= 0) return true
    if (hasExpected && isFutureDate(seasonAirDate)) return true
    return false
  }
  if (episodes.length === 0) {
    if (hasExpected && expectedCount! <= 0) return true
    if (hasExpected && isFutureDate(seasonAirDate)) return true
    return false
  }
  if (hasExpected && expectedCount! > 0 && episodes.length < expectedCount!) return false
  return true
}

function isFutureDate(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false
  const t = Date.parse(value)
  return Number.isFinite(t) && t > Date.now()
}

/**
 * Builds videos from TheTVDB (explicitly chosen ordering), reporting whether
 * the fetch is complete. Interrupted lists (budget/timeout/error) are served
 * with a short TTL, never frozen long-term.
 * Same enrichment rule: only confirmed links (IMDb or tvdb_id), never a fuzzy
 * `remoteid/<tmdbId>` fallback — without a certain link it returns []
 * (complete: true, the downstream standard fallback has its own guard) and
 * callers degrade to the standard TMDB list (fail-open).
 */
export async function buildVideosFromTvdbDetailed(
  imdbId: string | null,
  tmdbId: number | null,
  primaryId: string,
  tvdbApiKey: string,
  seasonType: string = "default",
  tmdbApiKey?: string,
  signal?: AbortSignal,
): Promise<{ videos: PreviewVideo[]; complete: boolean }> {
  if (!tvdbApiKey) return { videos: [], complete: true }
  let tvdbSeriesId: number | null = null
  if (imdbId) tvdbSeriesId = await getTvdbSeriesId(imdbId, tvdbApiKey, signal)
  if (!tvdbSeriesId && tmdbApiKey && tmdbId) {
    try {
      const { getExternalIds } = await import("@/lib/tmdb")
      const ext = await getExternalIds("tv", tmdbId, tmdbApiKey, signal, 5000)
      if (ext?.tvdb_id && ext.tvdb_id > 0) {
        tvdbSeriesId = ext.tvdb_id
      } else if (ext?.imdb_id) {
        tvdbSeriesId = await getTvdbSeriesId(ext.imdb_id, tvdbApiKey, signal)
      }
    } catch {}
  }
  if (!tvdbSeriesId) return { videos: [], complete: true }
  const { episodes: tvdbEps, complete } = await getTvdbEpisodesResult(tvdbSeriesId, "ita", tvdbApiKey, seasonType, signal)
  const sorted = [...tvdbEps].sort((a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number)
  const videos: PreviewVideo[] = []
  for (const ep of sorted) {
    if (typeof ep.seasonNumber !== "number" || typeof ep.number !== "number") continue
    videos.push({
      id: `${primaryId}:${ep.seasonNumber}:${ep.number}`,
      name: ep.name || `Episodio ${ep.number}`,
      season: ep.seasonNumber,
      episode: ep.number,
      overview: ep.overview || undefined,
      thumbnail: formatTvdbImageUrl(ep.image) || undefined,
      released: ep.aired ? `${ep.aired}T00:00:00.000Z` : undefined,
    })
  }
  return { videos, complete }
}

/**
 * Builds videos from TheTVDB (explicitly chosen ordering).
 * Same enrichment rule: only confirmed links (IMDb or tvdb_id), never a fuzzy
 * `remoteid/<tmdbId>` fallback — without a certain link it returns [] and
 * callers degrade to the standard TMDB list (fail-open).
 */
export async function buildVideosFromTvdb(
  imdbId: string | null,
  tmdbId: number | null,
  primaryId: string,
  tvdbApiKey: string,
  seasonType: string = "default",
  tmdbApiKey?: string,
  signal?: AbortSignal,
): Promise<PreviewVideo[]> {
  return (await buildVideosFromTvdbDetailed(imdbId, tmdbId, primaryId, tvdbApiKey, seasonType, tmdbApiKey, signal)).videos
}
