/**
 * Per-episode IMDb ratings via ShowGrid (https://theshowgrid.com).
 *
 * ShowGrid's public endpoint
 * `GET /api/sg/getEpisodeRatings?imdbID=<tt...>` returns the show details plus
 * a `ratings[]` array where each episode carries `sno` (season), `eno`
 * (episode), `r` (IMDb 0-10) and `v` (vote count). The array is NOT ordered by
 * episode, so this module parses it into an isolated `S:E` map keyed by
 * `"<season>:<episode>"` and caches it under its own `showgrid` tag for 12
 * hours.
 *
 * DEFAULT episode source: this is the ★ provider the thumbnail route consults
 * with no configuration. The use is an explicit operator decision that accepts
 * the third-party risk: ShowGrid has no licence and the provider permission is
 * still pending. `PICTORIUM_SHOWGRID_URL` is only an optional origin override
 * (E2E mock / self-hosting); the public origin below is the no-env default.
 *
 * No API key is involved: nothing secret can leak into the URL, the cache key
 * or the logs. Fail-open everywhere (transport/HTTP/parse/oversize) so callers
 * fall back to their existing source without a thrown error.
 */

import { cacheGet, cacheSet } from "./cache"
import { timedFetch, readResponseBodyCapped } from "./outbound-stats"
import { createLogger } from "@/lib/logger"
import { combineAbortSignals } from "@/lib/abort-signal"

const log = createLogger("showgrid-episodes")

/**
 * Public ShowGrid API origin. `PICTORIUM_SHOWGRID_URL` (read per call) is the
 * optional E2E-mock / self-hosted override; this constant is the default used
 * when the env is blank (the normal production path).
 */
export const SHOWGRID_DEFAULT_BASE_URL = "https://api.theshowgrid.com"

/** Endpoint path of the episode-ratings payload (ShowGrid public API). */
export const SHOWGRID_EPISODE_RATINGS_PATH = "/api/sg/getEpisodeRatings"

const EPISODE_TIMEOUT_MS = 8_000
const EPISODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
/** Hard cap on the JSON payload: an abusive/oversized body is a fail-open miss. */
const MAX_PAYLOAD_BYTES = 512 * 1024
const SHOWGRID_CACHE_TAG = "showgrid"

// IMDb ids are `tt` + digits, lowercase. Anything else is a fail-closed miss
// (never a fetch with an arbitrary caller string).
const IMDB_ID_RE = /^tt\d+$/

export interface ShowgridEpisodeRating {
  /** IMDb episode rating on the 0-10 scale (> 0, one decimal). */
  readonly rating: number
  /** Vote count when the payload carries a plausible one, otherwise null. */
  readonly votes: number | null
}

/** Plain, JSON-serializable cache entry (a Map would serialize as `{}`). */
type CachedEpisodeEntry = [string, ShowgridEpisodeRating]

function emptyMap(): Map<string, ShowgridEpisodeRating> {
  return new Map()
}

/**
 * Non-negative integer index from a number or a digits-only string.
 * `min` enforces the contract: season >= 0 (specials are legitimate when the
 * source returns them), episode >= 1 (a series episode never starts at 0).
 */
function parseIndex(raw: unknown, min: number): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= min ? raw : null
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const n = parseInt(trimmed, 10)
    return n >= min ? n : null
  }
  return null
}

function parseRating(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null
  const n = typeof raw === "number" ? raw : parseFloat(raw.trim())
  // "0", "N/A", missing, NaN and out-of-range values are not genuine polls.
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return Math.round(n * 10) / 10
}

function parseVotes(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    return parseInt(trimmed, 10)
  }
  return null
}

/** The rating rows of the payload; anything else is malformed (empty). */
function readRatingRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (typeof data !== "object" || data === null) return []
  const ratings = (data as { ratings?: unknown }).ratings
  return Array.isArray(ratings) ? ratings : []
}

function parseEpisodes(data: unknown): CachedEpisodeEntry[] {
  const rows = readRatingRows(data)
  const entries: CachedEpisodeEntry[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const record = row as Record<string, unknown>
    // ShowGrid's native keys first; long-form aliases keep the parser honest
    // for a future payload revision without accepting free-form garbage.
    const season = parseIndex(record.sno ?? record.season, 0)
    const episode = parseIndex(record.eno ?? record.episode, 1)
    const rating = parseRating(record.r ?? record.rating)
    // Episodes without a genuine rating are skipped entirely (this module is a
    // rating source; a named episode without a score is not an entry).
    if (season === null || episode === null || rating === null) continue
    entries.push([`${season}:${episode}`, { rating, votes: parseVotes(record.v ?? record.votes) }])
  }
  return entries
}

/** Rebuild the returned Map, dropping any malformed cached record. */
function toMap(entries: CachedEpisodeEntry[]): Map<string, ShowgridEpisodeRating> {
  const map = new Map<string, ShowgridEpisodeRating>()
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [key, value] = entry
    if (typeof key !== "string") continue
    if (typeof value !== "object" || value === null) continue
    const rating = (value as ShowgridEpisodeRating).rating
    if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0 || rating > 10) continue
    const votes = (value as ShowgridEpisodeRating).votes
    map.set(key, {
      rating,
      votes: typeof votes === "number" && Number.isFinite(votes) && Number.isInteger(votes) && votes >= 0
        ? votes
        : null,
    })
  }
  return map
}

/** Base origin read per call so the E2E mock / self-hosting override is honored. */
function showgridBaseUrl(): string {
  const raw = process.env.PICTORIUM_SHOWGRID_URL
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return (trimmed || SHOWGRID_DEFAULT_BASE_URL).replace(/\/+$/, "")
}

/**
 * Fetch the per-episode ratings of a series from ShowGrid.
 *
 * Returns a Map keyed by `"<season>:<episode>"` (for example `"1:1"`).
 * Invalid ids, transport failures, non-2xx responses, oversized bodies and
 * malformed payloads all resolve to an empty Map and are never cached: this
 * provider never throws and never exposes a secret (ShowGrid needs no key).
 */
export async function fetchShowgridEpisodeRatings(
  imdbId: string | null | undefined,
  signal?: AbortSignal,
): Promise<Map<string, ShowgridEpisodeRating>> {
  if (typeof imdbId !== "string" || !IMDB_ID_RE.test(imdbId)) return emptyMap()

  const cacheKey = `showgrid:episodes:${imdbId}`
  const cached = cacheGet<CachedEpisodeEntry[]>(cacheKey)
  if (Array.isArray(cached)) return toMap(cached)

  try {
    const url = `${showgridBaseUrl()}${SHOWGRID_EPISODE_RATINGS_PATH}?imdbID=${encodeURIComponent(imdbId)}`
    const res = await timedFetch(url, {
      headers: { Accept: "application/json" },
      signal: combineAbortSignals(signal, EPISODE_TIMEOUT_MS),
    })
    // 404/5xx and any other non-OK response are failures: no negative cache,
    // the caller falls back and a later request may retry.
    if (!res.ok) return emptyMap()

    let data: unknown
    try {
      const body = await readResponseBodyCapped(res, MAX_PAYLOAD_BYTES, () => new Error("showgrid payload too large"))
      data = JSON.parse(new TextDecoder().decode(body))
    } catch {
      // Oversized body, aborted read or malformed JSON: fail-open, never cached.
      return emptyMap()
    }

    const entries = parseEpisodes(data)
    cacheSet(cacheKey, entries, [SHOWGRID_CACHE_TAG], EPISODE_CACHE_TTL_MS)
    return toMap(entries)
  } catch (e) {
    log.error("ShowGrid episode ratings fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    })
    return emptyMap()
  }
}
