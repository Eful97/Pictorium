/**
 * Per-episode IMDb ratings via Cinemeta (free, no API key).
 *
 * Cinemeta's `meta/series/<imdbId>.json` exposes a `videos[]` array where each
 * series episode carries `season`, `episode`, `rating` (IMDb 0-10, often as a
 * string) and `thumbnail` (an already-hosted still). This module parses that
 * payload into an isolated `S:E` map and keeps it in the same cache family as
 * the series rating (`cinemeta`) with a short 5-minute TTL.
 *
 * Scope is deliberately narrow: no thumbnail route wiring, no TVDB, no UI
 * provider switch. Fail-open everywhere (transport/HTTP/parse) so callers can
 * fall back to their existing source without a thrown error.
 */

import { cacheGet, cacheSet } from "./cache"
import { timedFetch } from "./outbound-stats"
import { createLogger } from "@/lib/logger"
import { combineAbortSignals } from "@/lib/abort-signal"

const log = createLogger("cinemeta-episodes")

// Same deterministic E2E override as `cinemeta.ts`; no key is ever involved.
const CINEMETA_BASE = process.env.CINEMETA_API_URL || "https://v3-cinemeta.strem.io"

const EPISODE_TIMEOUT_MS = 8_000
const EPISODE_CACHE_TTL_MS = 5 * 60 * 1000
// Same cache family as the series-level Cinemeta rating.
const CINEMETA_CACHE_TAG = "cinemeta"

// IMDb ids are `tt` + digits, lowercase. Anything else is a fail-closed miss
// (never a fetch with an arbitrary caller string).
const IMDB_ID_RE = /^tt\d+$/

export interface ImdbEpisodeRating {
  /** IMDb episode rating on the 0-10 scale (> 0, one decimal). */
  readonly rating: number
  /** Cinemeta thumbnail URL when present, otherwise null. */
  readonly thumbnail: string | null
}

/** Plain, JSON-serializable cache entry (a Map would serialize as `{}`). */
type CachedEpisodeEntry = [string, ImdbEpisodeRating]

function emptyMap(): Map<string, ImdbEpisodeRating> {
  return new Map()
}

function parseRating(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null
  const n = typeof raw === "number" ? raw : parseFloat(raw.trim())
  // "0", "N/A", missing, NaN and out-of-range values are not genuine polls.
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return Math.round(n * 10) / 10
}

function parseIndex(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    return parseInt(trimmed, 10)
  }
  return null
}

function parseThumbnail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseEpisodes(data: unknown): CachedEpisodeEntry[] {
  if (typeof data !== "object" || data === null) return []
  const meta = (data as { meta?: unknown }).meta
  if (typeof meta !== "object" || meta === null) return []
  const videos = (meta as { videos?: unknown }).videos
  if (!Array.isArray(videos)) return []

  const entries: CachedEpisodeEntry[] = []
  for (const video of videos) {
    if (typeof video !== "object" || video === null) continue
    const record = video as Record<string, unknown>
    const season = parseIndex(record.season)
    const episode = parseIndex(record.episode)
    const rating = parseRating(record.rating)
    // Episodes without a genuine IMDb rating are skipped entirely (this
    // module is a rating source; thumbnails alone are not an entry).
    if (season === null || episode === null || rating === null) continue
    entries.push([`${season}:${episode}`, { rating, thumbnail: parseThumbnail(record.thumbnail) }])
  }
  return entries
}

/** Rebuild the returned Map, dropping any malformed cached record. */
function toMap(entries: CachedEpisodeEntry[]): Map<string, ImdbEpisodeRating> {
  const map = new Map<string, ImdbEpisodeRating>()
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [key, value] = entry
    if (typeof key !== "string") continue
    if (typeof value !== "object" || value === null) continue
    const rating = (value as ImdbEpisodeRating).rating
    if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0 || rating > 10) continue
    const thumbnail = (value as ImdbEpisodeRating).thumbnail
    map.set(key, {
      rating,
      thumbnail: typeof thumbnail === "string" && thumbnail.trim().length > 0 ? thumbnail : null,
    })
  }
  return map
}

/**
 * Fetch the IMDb per-episode ratings of a series from Cinemeta.
 *
 * Returns a Map keyed by `"<season>:<episode>"` (for example `"1:1"`).
 * Invalid ids, transport failures, non-2xx responses and malformed payloads
 * all resolve to an empty Map: this provider never throws and never exposes a
 * secret (Cinemeta is public).
 */
export async function fetchCinemetaEpisodeRatings(
  imdbId: string | null | undefined,
  signal?: AbortSignal,
): Promise<Map<string, ImdbEpisodeRating>> {
  if (typeof imdbId !== "string" || !IMDB_ID_RE.test(imdbId)) return emptyMap()

  const cacheKey = `cinemeta:episodes:${imdbId}`
  const cached = cacheGet<CachedEpisodeEntry[]>(cacheKey)
  if (Array.isArray(cached)) return toMap(cached)

  try {
    const res = await timedFetch(`${CINEMETA_BASE}/meta/series/${encodeURIComponent(imdbId)}.json`, {
      headers: { Accept: "application/json" },
      signal: combineAbortSignals(signal, EPISODE_TIMEOUT_MS),
    })
    // 404/5xx and any other non-OK response are failures: no negative cache,
    // the caller falls back and a later request may retry.
    if (!res.ok) return emptyMap()

    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      // Aborted body read or malformed JSON: fail-open, never cached.
      return emptyMap()
    }

    const entries = parseEpisodes(data)
    cacheSet(cacheKey, entries, [CINEMETA_CACHE_TAG], EPISODE_CACHE_TTL_MS)
    return toMap(entries)
  } catch (e) {
    log.error("Cinemeta episode ratings fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    })
    return emptyMap()
  }
}
