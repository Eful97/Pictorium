import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchUnifiedCatalogItems, detectCatalogProvider } from "@/lib/custom-catalog-providers"
import { getDetails, resolveRequestApiKey, tmdbFindByImdb } from "@/lib/tmdb"

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const url = req.nextUrl.searchParams.get("url")
  if (!url) return Response.json({ items: [] })

  const apiKey = resolveRequestApiKey(req) || process.env.PICTORIUM_TMDB_KEY || process.env.POSTERIUM_TMDB_KEY || process.env.TMDB_KEY || process.env.TMDB_API_KEY || undefined
  const mdblistKey = req.nextUrl.searchParams.get("mdblist_key") || process.env.PICTORIUM_MDBLIST_KEY || process.env.POSTERIUM_MDBLIST_KEY || process.env.MDBLIST_KEY || process.env.MDBLIST_API_KEY || undefined

  try {
    const detection = detectCatalogProvider(url)
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10) || 500, 1), 1000)
    const rawItems = await fetchUnifiedCatalogItems(url, { apiKey, mdblistKey, limit })
    const items = await Promise.all(
      rawItems.map(async (it) => {
        let tmdbId = Number(it.tmdb)
        const mediaType = (it.mediatype === "show" || it.mediatype === "tv" || it.mediatype === "anime") ? "tv" : "movie"
        if (!tmdbId && it.imdb && apiKey) {
          try {
            tmdbId = (await tmdbFindByImdb(it.imdb, mediaType, apiKey)) || 0
          } catch {
            tmdbId = 0
          }
        }
        let posterPath: string | null = null
        if (tmdbId && apiKey) {
          try {
            const d = await getDetails(mediaType, tmdbId, "it-IT", apiKey)
            posterPath = d?.poster_path || null
          } catch {
            posterPath = null
          }
        }
        return {
          id: tmdbId || it.imdb || String(Math.random()),
          tmdbId: tmdbId || undefined,
          media_type: mediaType,
          title: it.title,
          name: it.title,
          poster_path: posterPath,
          year: it.year,
        }
      })
    )
    return Response.json({
      items,
      provider: detection?.provider,
      suggestedName: detection?.nameSuggestion,
      defaultType: detection?.defaultType,
    })
  } catch {
    return Response.json({ items: [] })
  }
}
