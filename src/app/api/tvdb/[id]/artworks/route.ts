import { NextRequest } from "next/server"
import { getExternalIds, resolveUserApiKeys } from "@/lib/tmdb"
import {
  TvdbArtworksError,
  TVDB_TIMEOUT_MS,
  classifyTvdbArtworks,
  getTvdbArtworksStrict,
  getTvdbMovieIdStrict,
  getTvdbSeriesIdStrict,
  getTvdbToken,
  isTvdbBreakerOpen,
} from "@/lib/tvdb"
import { combineAbortSignals } from "@/lib/abort-signal"
import { getScopedUserId, extractUserParam } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { jsonGzip } from "@/lib/json-response"

type RouteParams = { id: string }

/**
 * GET /api/tvdb/[id]/artworks?type=movie|tv[&types=2,3,23]
 * Grouped TVDB gallery for the editor ({ posters, backdrops, logos } of
 * `{ url, thumbnail, language, width, height, includesText, score,
 * source: "tvdb", type }`, plus a route-level `source: "tvdb"`).
 *
 * Policy (mirrors /api/fanart/[id]/images, neutral keys and cache):
 * - Input is a numeric TMDB id + TMDB `type` (movie|tv, default movie like
 *   Fanart). NEVER a direct TVDB id: the tvdb_id resolves via TMDB
 *   `external_ids.tvdb_id` first, then IMDb through the existing shared
 *   strict matchers (`getTvdbMovieIdStrict/getTvdbSeriesIdStrict`,
 *   confirmed-link-only, no fuzzy `remoteid/<tmdbId>`, no copied resolvers).
 * - ONE `resolveUserApiKeys(req, userId)` for both kinds (user space over
 *   env; no cross-namespace borrowing, no instance fallback on scoped
 *   requests when the multi-user flag forbids it). Missing TVDB key → 503
 *   `{ code: tvdb_not_configured }` (checked BEFORE the cache: a key miss
 *   never becomes a hit). The key never leaves the server (Bearer header
 *   outbound only; no key in cache keys, logs, URLs, or payloads).
 * - ONE aggregate deadline (`TVDB_TIMEOUT_MS`, 5s, configurable via the
 *   existing `TVDB_TIMEOUT_MS` env): a single timer armed synchronously at
 *   request entry — before any await, namespace/key resolution included, so
 *   it bounds the whole handler and never only the chain after it — is
 *   combined with the caller signal via `combineAbortSignals` and the SAME
 *   signal flows through every gallery network layer (TMDB external_ids
 *   with its 5s per-call cap, TVDB login, strict IMDb lookup, strict
 *   artworks). Per-call caps can only fire earlier — they never extend the
 *   aggregate. Budget/user aborts surface as 502 `tvdb_unavailable` and are
 *   never cached as empty. The timer is always cleared (no leaks).
 * - Auth is validated BEFORE serving the neutral route cache
 *   (`tvdb:artworks:{type}:{id}`, no secrets): artworks are public so the
 *   title-keyed sharing is safe, but a cached success must never mask a
 *   rejected key. A null token throws `auth` → 502 `tvdb_auth_error`.
 *   Hits live 6h, confirmed absence 10min; failures are NEVER cached (no
 *   catch-and-cache: a 502 never becomes "empty").
 * - Lookup failures propagate: TMDB external_ids errors, strict IMDb
 *   lookup `auth`/`upstream`/`timeout`, and strict artworks
 *   `auth`/`upstream`/`timeout` all become 502s. Only genuine absence is a
 *   200 with honest empty collections: no TVDB link (no external ids / no
 *   TVDB match / 404) or no artworks for the whitelisted kinds (never
 *   borrowed TMDB/Fanart tiles, never invented URLs).
 * - Optional `types` = additional admitted numeric type ids (docs-first:
 *   intersected with the 14/15/25 movie + 2/3/23 series whitelist, so any
 *   other kind — season 7, clearart 22/24, banner, icon, artifact, MP4 —
 *   stays out even when requested).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  // Aggregate gallery budget: one timer armed synchronously at request entry
  // (before any await, key resolution included) so the budget bounds the
  // whole handler. Always cleared below (no timer leaks).
  const budgetCtrl = new AbortController()
  const budgetTimer = setTimeout(() => {
    budgetCtrl.abort(new DOMException("TVDB gallery budget exceeded", "TimeoutError"))
  }, TVDB_TIMEOUT_MS)
  try {
    return await handleTvdbArtworks(req, { params }, budgetCtrl.signal)
  } finally {
    clearTimeout(budgetTimer)
  }
}

async function handleTvdbArtworks(
  req: NextRequest,
  { params }: { params: Promise<RouteParams> },
  budgetSignal: AbortSignal,
) {
  const rl = await rateLimit(rateLimitKey(req), "tvdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { id } = await params
  const type = req.nextUrl.searchParams.get("type") || "movie"
  if (type !== "movie" && type !== "tv") {
    return Response.json({ error: "Invalid type: must be 'movie' or 'tv'" }, { status: 400 })
  }
  const tmdbId = Number(id)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return Response.json({ error: "Invalid id: must be a positive integer" }, { status: 400 })
  }
  // Single namespace resolution for both kinds (space over env).
  const userId = getScopedUserId(extractUserParam(req))
  const resolved = await resolveUserApiKeys(req, userId)
  if (!resolved.tvdb.key) {
    return Response.json(
      { error: "TVDB is not configured on this instance", code: "tvdb_not_configured" },
      { status: 503 },
    )
  }
  const cacheKey = `tvdb:artworks:${type}:${tmdbId}`
  const acceptEncoding = req.headers.get("accept-encoding")

  // Optional `types` filter = additional admitted numeric type ids
  // (docs-first: the whitelist intersection in the filter step excludes every
  // other kind — season 7, clearart 22/24, banner, icon, artifact, MP4 stay
  // out even when requested). Validated BEFORE the cache so a hit never
  // masks a 400, applied AFTER the hit: the cache keeps the full gallery,
  // the filter is a pure per-request projection.
  let typeFilter: Set<number> | null = null
  const rawTypes = req.nextUrl.searchParams.get("types")
  if (rawTypes !== null) {
    const ids = rawTypes
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
    if (ids.length === 0) {
      return Response.json({ error: "Invalid types: must be comma-separated positive integers" }, { status: 400 })
    }
    typeFilter = new Set(ids)
  }

  try {
    // The SAME signal flows through every gallery network layer; per-call caps
    // (TMDB 5s, TVDB 5s) can only fire earlier, never extend the aggregate.
    const gallerySignal = combineAbortSignals(req.signal, budgetSignal)
    // A budget already spent while resolving the namespace/key is not
    // re-checked here: key validation would return null on the aborted signal
    // and the route would 502 before the gallery chain is attempted. The
    // caller signal still fails fast, and the spent budget stays enforced by
    // the chain itself (its first fetch aborts instantly → 502
    // `tvdb_unavailable`, no gallery stage runs, nothing cached).
    const budgetExhausted = budgetSignal.aborted
    if (req.signal.aborted) throw new TvdbArtworksError("timeout", "TVDB request aborted")

    // Auth-before-cache: validate the key before serving the neutral cache
    // so a cached success never masks a rejected key (and a rejected key
    // never poisons the cache — failures are never written). A null token
    // with an open breaker is a sustained upstream outage (401s never trip
    // the breaker), hence `upstream`, not `auth`. When the budget is already
    // spent the login keeps the caller abort and its own `TVDB_TIMEOUT_MS`
    // per-call cap, so it stays bounded without a spurious auth failure.
    const preToken = await getTvdbToken(
      resolved.tvdb.key,
      budgetExhausted ? req.signal : gallerySignal,
    )
    if (req.signal.aborted || (!budgetExhausted && gallerySignal.aborted)) {
      throw new TvdbArtworksError("timeout", "TVDB request aborted")
    }
    if (!preToken) {
      if (isTvdbBreakerOpen()) throw new TvdbArtworksError("upstream", "TVDB login unavailable")
      throw new TvdbArtworksError("auth", "TVDB rejected the API key")
    }

    const cached = cacheGet<{ posters: { type?: unknown }[]; backdrops: { type?: unknown }[]; logos: { type?: unknown }[]; source: string }>(cacheKey)
    if (cached) {
      const out = typeFilter
        ? {
            posters: cached.posters.filter((i) => typeFilter.has(typeof i.type === "number" ? i.type : -1)),
            backdrops: cached.backdrops.filter((i) => typeFilter.has(typeof i.type === "number" ? i.type : -1)),
            logos: cached.logos.filter((i) => typeFilter.has(typeof i.type === "number" ? i.type : -1)),
            source: cached.source,
          }
        : cached
      return jsonGzip(out, 200, undefined, acceptEncoding)
    }

    // No catch-and-cache: upstream failures never become "no artworks".
    // 1. tvdb_id via TMDB external_ids, then IMDb through the shared strict
    //    matchers. Lookup failures propagate as typed errors; only a genuine
    //    no-link (null) falls through to the honest-empty branch below.
    let tvdbId: number | null = null
    try {
      const ext = await getExternalIds(
        type as "movie" | "tv",
        tmdbId,
        resolved.tmdb.key,
        gallerySignal,
        5000,
      )
      if (ext?.tvdb_id && ext.tvdb_id > 0) {
        tvdbId = ext.tvdb_id
      } else if (ext?.imdb_id) {
        tvdbId = type === "movie"
          ? await getTvdbMovieIdStrict(ext.imdb_id, resolved.tvdb.key, gallerySignal)
          : await getTvdbSeriesIdStrict(ext.imdb_id, resolved.tvdb.key, gallerySignal)
      }
    } catch (e) {
      if (e instanceof TvdbArtworksError) throw e
      if (gallerySignal.aborted) throw new TvdbArtworksError("timeout", "TVDB gallery budget exceeded")
      throw new TvdbArtworksError("upstream", "TMDB external_ids unavailable")
    }
    if (!tvdbId) {
      const empty = { posters: [], backdrops: [], logos: [], source: "tvdb" }
      cacheSet(cacheKey, empty, ["tvdb", "images"], 10 * 60 * 1000)
      return jsonGzip(empty, 200, undefined, acceptEncoding)
    }

    // 2. Strict artworks (throws on auth/upstream/timeout; [] only on
    //    confirmed absence) + per-kind classification on the whitelist.
    const arts = await getTvdbArtworksStrict(
      type as "movie" | "tv",
      tvdbId,
      resolved.tvdb.key,
      gallerySignal,
    )
    const gallery = classifyTvdbArtworks(arts, type as "movie" | "tv")
    // The cache keeps the full gallery; the `types` filter is per-request.
    const full = { ...gallery, source: "tvdb" }
    const nonEmpty = gallery.posters.length + gallery.backdrops.length + gallery.logos.length > 0
    // 6h hits, 10min absence (same TTLs as the lib, no secrets in the key).
    cacheSet(cacheKey, full, ["tvdb", "images"], nonEmpty ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000)
    const data = typeFilter
      ? {
          posters: gallery.posters.filter((i) => typeFilter.has(i.type ?? -1)),
          backdrops: gallery.backdrops.filter((i) => typeFilter.has(i.type ?? -1)),
          logos: gallery.logos.filter((i) => typeFilter.has(i.type ?? -1)),
          source: "tvdb",
        }
      : full
    return jsonGzip(data, 200, undefined, acceptEncoding)
  } catch (e) {
    if (e instanceof TvdbArtworksError && (e.code === "auth" || e.code === "not_configured")) {
      const code = e.code === "not_configured" ? "tvdb_not_configured" : "tvdb_auth_error"
      const status = e.code === "not_configured" ? 503 : 502
      const message = e.code === "not_configured"
        ? "TVDB is not configured on this instance"
        : "TVDB rejected the API key"
      return jsonGzip({ error: message, code }, status, undefined, acceptEncoding)
    }
    return jsonGzip({ error: "TVDB artworks unavailable", code: "tvdb_unavailable" }, 502, undefined, acceptEncoding)
  }
}
