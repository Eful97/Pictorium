/**
 * API endpoint: check IMDb chart membership for the "Absolute Cinema" badge.
 * Used by the client preview to resolve the badge.
 *
 * GET /api/imdb-top250?imdbId=tt0111161               → { inTop250 } (legacy byte-shape, no new fields)
 * GET /api/imdb-top250?imdbId=tt0111161&limit=250     → { inTop250, limit: 250 } (explicit legacy)
 * GET /api/imdb-top250?imdbId=tt0111161&limit=100     → { inTop250, inTop100, limit: 100 }
 *
 * Default stays 250-membership with the legacy body for back-compat; badge
 * callers pass `limit=100` (rank 1..100 only). The limit=100 branch derives
 * both flags from the single rank-verified source (one fetch, one snapshot),
 * so inTop250/inTop100 can never disagree. No other query changes.
 */
import { NextRequest } from "next/server"
import { ABSOLUTE_CINEMA_MAX_RANK, getImdbTopRank, isImdbTop250 } from "@/lib/imdb-top250"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  // Fix L23: rate limit (prima la route era illimitata e senza header cache).
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const imdbId = req.nextUrl.searchParams.get("imdbId") || ""
  // Solo id IMDb validi: un input arbitrario non deve scaldare la lookup.
  if (!/^tt\d+$/.test(imdbId)) {
    return Response.json({ inTop250: false }, { headers: { "Cache-Control": "no-store" } })
  }
  try {
    const limitRaw = req.nextUrl.searchParams.get("limit")
    if (limitRaw !== null && limitRaw !== "100" && limitRaw !== "250") {
      return Response.json({ inTop250: false }, { headers: { "Cache-Control": "no-store" } })
    }
    if (limitRaw === "100") {
      // Single rank-verified source: no second fetch, no mixed snapshots.
      const rank = await getImdbTopRank(imdbId)
      const inTop250 = rank !== null
      const inTop100 = rank !== null && rank <= ABSOLUTE_CINEMA_MAX_RANK
      return Response.json({ inTop250, inTop100, limit: 100 }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
    }
    const inTop250 = await isImdbTop250(imdbId)
    if (limitRaw === "250") {
      return Response.json({ inTop250, limit: 250 }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
    }
    return Response.json({ inTop250 }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
  } catch {
    return Response.json({ inTop250: false })
  }
}
