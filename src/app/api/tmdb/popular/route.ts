import { NextRequest } from "next/server"
import { getPopularMovies, getPopularTV, resolveRouteApiKey, type TMDBMediaResult } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Fix L24: page validato e bounded — prima un valore arbitrario/NaN creava
  // cache key illimitate e 422 upstream.
  const rawPage = req.nextUrl.searchParams.get("page")
  const parsedPage = rawPage ? parseInt(rawPage, 10) : 1
  const page = Number.isFinite(parsedPage) ? Math.min(Math.max(parsedPage, 1), 500) : 1
  const language = req.nextUrl.searchParams.get("language") || "it-IT"
  // api_key esclusa dal cache key: i dati popular non dipendono dalla chiave.
  // Inserirla qui metterebbe il segreto in una Map key e frammenterebbe la cache.
  const cacheKey = `popular:${page}:${language}`
  const cached = cacheGet<{ results: (TMDBMediaResult & { media_type: "movie" | "tv" })[]; page: number; totalPages: number }>(cacheKey)
  if (cached) return Response.json(cached)
  try {
    const apiKey = await resolveRouteApiKey(req)
    const [movies, tv] = await Promise.all([getPopularMovies(page, language, apiKey), getPopularTV(page, language, apiKey)])
    const movieResults = (movies.results || [])
      .filter((r: TMDBMediaResult) => r.poster_path)
      .map((r: TMDBMediaResult) => ({ ...r, media_type: "movie" as const }))
    const tvResults = (tv.results || [])
      .filter((r: TMDBMediaResult) => r.poster_path)
      .map((r: TMDBMediaResult) => ({ ...r, media_type: "tv" as const }))
    const results: Array<TMDBMediaResult & { media_type: "movie" | "tv" }> = []
    const max = Math.max(movieResults.length, tvResults.length)
    for (let i = 0; i < max; i++) {
      if (i < movieResults.length) results.push(movieResults[i])
      if (i < tvResults.length) results.push(tvResults[i])
    }
    const totalPages = Math.min(movies?.total_pages || 1, tv?.total_pages || 1)
    const body = { results: results.slice(0, 24), page, totalPages }
    cacheSet(cacheKey, body, ["tmdb", "popular"])
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800", "Vary": "x-api-key" } })
  } catch {
    return Response.json({ results: [], page: 1, totalPages: 0 }, { headers: { "Cache-Control": "no-store" } })
  }
}
