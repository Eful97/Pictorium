import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchUnifiedCatalogItems, detectCatalogProvider } from "@/lib/custom-catalog-providers"
import { getDetails, resolveRouteApiKey, tmdbFindByImdb } from "@/lib/tmdb"

// Concorrenza del fan-out per-item (v1.23.0): liste fino a 1000 voci con
// Promise.all sparavano migliaia di fetch TMDB concorrenti. Pool fissa;
// le chiavi errate falliscono in fretta via negative-cache 401 (tmdb.ts).
const FANOUT_CONCURRENCY = 5

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const url = req.nextUrl.searchParams.get("url")
  if (!url) return Response.json({ items: [] })

  const apiKey = await resolveRouteApiKey(req)
  const mdblistKey = await resolveRouteApiKey(req, "mdblist")

  try {
    const detection = detectCatalogProvider(url)
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10) || 500, 1), 1000)
    const rawItems = await fetchUnifiedCatalogItems(url, { apiKey, mdblistKey, limit })
    const items = await mapLimit(
      rawItems,
      FANOUT_CONCURRENCY,
      async (it) => {
        let tmdbId = Number(it.tmdb)
        const mediaType = (it.mediatype === "show" || it.mediatype === "tv" || it.mediatype === "anime") ? "tv" : "movie"
        if (!tmdbId && it.imdb && apiKey) {
          try {
            tmdbId = (await tmdbFindByImdb(it.imdb, mediaType, apiKey)) || 0
          } catch {
            tmdbId = 0
          }
        }
        let posterPath: string | null = it.poster_path ?? null
        if (!posterPath && tmdbId && apiKey) {
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
      },
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
