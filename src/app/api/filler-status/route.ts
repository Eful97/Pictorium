import { NextRequest } from "next/server"
import { cacheGet, cacheSet } from "@/lib/cache"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { resolveFillerStatus, type AnimeFillerStatus } from "@/lib/anime-filler"
import { getDetails, resolveRouteApiKey } from "@/lib/tmdb"

/**
 * GET /api/filler-status — read-only anime filler classification for ONE
 * standard-numbered episode, used by the per-title episode editor so its
 * composed preview can carry the SAME real `fill=` classification `/meta`
 * emits (never a sample).
 *
 * Absolute episode numbering is derived exactly like `meta-handler.ts`: only
 * regular TMDB seasons (`season_number > 0`), cumulative `episode_count`,
 * sorted by season number. The offsets map is what gets cached (12h), so
 * navigating episodes reuses one upstream details call.
 *
 * Fail-closed contract:
 * - unknown/invalid ids → 400 (client treats any non-OK as "no banner");
 * - unknown series, specials (season 0), out-of-window episodes, missing
 *   seasons or an upstream failure → 200 `{ status: null }`, never a guess;
 * - remapped orderings (Episode Groups / TVDB / AniZip) are the caller's
 *   gate: `/meta` suppresses the banner for them and the editor only asks
 *   when its numbering is standard.
 *
 * The bundled snapshot stays server-only: this module imports it, the client
 * never does (the UI only sends plain tmdb/season/episode numbers).
 */

/** Offsets depend only on the series' declared regular seasons. */
const OFFSETS_TTL_MS = 12 * 60 * 60 * 1000
const OFFSETS_CACHE_PREFIX = "filler:season-offsets:tv:"

const RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=300",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
} as const

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Bound on a batch: one season's episode list, never a whole catalog. */
const MAX_BATCH_EPISODES = 500

/**
 * `episodes=1,2,3` → deduplicated positive episode numbers, or null when any
 * token is invalid / the list is empty or too long. Fail-closed: a malformed
 * batch is a 400, never a silently shorter list.
 */
function parseEpisodeList(raw: string): number[] | null {
  const parts = raw.split(",")
  if (parts.length === 0 || parts.length > MAX_BATCH_EPISODES) return null
  const seen = new Set<number>()
  const episodes: number[] = []
  for (const part of parts) {
    const episode = parsePositiveInt(part)
    if (episode === null) return null
    if (seen.has(episode)) continue
    seen.add(episode)
    episodes.push(episode)
  }
  return episodes.length > 0 ? episodes : null
}

/**
 * `season` → absolute episodes before that season, for regular seasons only.
 * Cached 12h on success; every failure (missing key, upstream error, no
 * regular seasons) returns null and is never cached, so a later request can
 * recover instead of pinning a false "unknown".
 */
async function resolveSeasonAbsoluteOffsets(
  seriesId: number,
  apiKey: string | undefined,
): Promise<Map<number, number> | null> {
  const cacheKey = `${OFFSETS_CACHE_PREFIX}${seriesId}`
  const cached = cacheGet<Record<string, number>>(cacheKey)
  if (cached) {
    return new Map(
      Object.entries(cached).map(([season, offset]) => [Number(season), offset] as const),
    )
  }

  const details = await getDetails("tv", seriesId, "en-US", apiKey, undefined, 8000)
  const regularSeasons = [...(details.seasons ?? [])]
    .filter((season) => typeof season.season_number === "number" && season.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number)
  if (regularSeasons.length === 0) return null

  const offsets: Record<string, number> = {}
  let absoluteStart = 0
  for (const season of regularSeasons) {
    offsets[String(season.season_number)] = absoluteStart
    absoluteStart += season.episode_count ?? 0
  }
  cacheSet(cacheKey, offsets, ["filler"], OFFSETS_TTL_MS)
  return new Map(
    Object.entries(offsets).map(([season, offset]) => [Number(season), offset] as const),
  )
}

export async function GET(req: NextRequest): Promise<Response> {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const params = req.nextUrl.searchParams
  const seriesId = parsePositiveInt(params.get("tmdb"))
  const season = parseNonNegativeInt(params.get("season"))
  if (seriesId === null || season === null) {
    return Response.json(
      { error: "tmdb (positive) and season (>=0) are required" },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  // Batch mode for the editor's episode list: one request per open season.
  // Additive to the single-episode contract (`episode`), never a replacement.
  const episodesRaw = params.get("episodes")
  const episodes = episodesRaw === null ? null : parseEpisodeList(episodesRaw)
  if (episodesRaw !== null && episodes === null) {
    return Response.json(
      {
        error: `episodes must be a comma-separated list of positive integers (max ${MAX_BATCH_EPISODES})`,
      },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }
  const episode = episodes === null ? parsePositiveInt(params.get("episode")) : null
  if (episodes === null && episode === null) {
    return Response.json(
      { error: "episode (positive) or episodes (list) is required" },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const apiKey = await resolveRouteApiKey(req)
    const offsets = await resolveSeasonAbsoluteOffsets(seriesId, apiKey)
    const absoluteStart = offsets?.get(season)
    if (episodes !== null) {
      // Unknown offsets = every requested episode is unknown (never a guess).
      const statuses: Record<string, AnimeFillerStatus | null> = {}
      for (const value of episodes) {
        statuses[String(value)] =
          absoluteStart === undefined ? null : resolveFillerStatus(seriesId, absoluteStart + value)
      }
      return Response.json({ statuses }, { headers: RESPONSE_HEADERS })
    }
    const status =
      absoluteStart === undefined || episode === null
        ? null
        : resolveFillerStatus(seriesId, absoluteStart + episode)
    return Response.json({ status }, { headers: RESPONSE_HEADERS })
  } catch {
    // Fail-closed: no banner/dots, never an invented classification and never a
    // 500. A batch keeps its shape so the caller can treat every row as unknown.
    return Response.json(
      episodes !== null ? { statuses: {} } : { status: null },
      { headers: RESPONSE_HEADERS },
    )
  }
}
