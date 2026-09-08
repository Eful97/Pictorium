import { NextRequest } from "next/server"
import { getJWRankings } from "@/lib/justwatch"
import { getDetails, getImages } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getServerDefaults } from "@/lib/server-defaults"
import { getRegionDef, normalizeRegion, parseRegion } from "@/lib/regions"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { jsonGzip } from "@/lib/json-response"

const log = createLogger("trending")

/** Esegue `fn` su ogni item con al massimo `limit` chiamate concorrenti. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

interface TrendingItem {
  id: number
  media_type: "movie" | "tv"
  title?: string
  name?: string
  poster_path: string | null
  release_date?: string
  first_air_date?: string
  rank: number
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const apiKey = req.nextUrl.searchParams.get("api_key") || undefined
  // Regione classifica: `?country=` > default server > IT (fail-closed su IT).
  const region = getRegionDef(parseRegion(req.nextUrl.searchParams.get("country")) ?? normalizeRegion(getServerDefaults().region))
  const country = region.code
  const tmdbLang = region.lang
  // v2: la lingua di arricchimento segue la regione — le entry v1 (sempre it-IT)
  // non devono avvelenare le richieste non italiane.
  const cacheKey = `trending:v2:${country}`
  const acceptEncoding = req.headers.get("accept-encoding")
  const cached = cacheGet<{ movies: TrendingItem[]; tv: TrendingItem[] }>(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)
  try {
    // D6: traccia gli errori upstream — una risposta degradata NON va cachata,
    // altrimenti un outage (JW/TMDB) si congela nel cache fino al refresh.
    let degraded = false
    const [movieRanks, tvRanks] = await Promise.all([
      getJWRankings("MOVIE", country, 20, undefined, tmdbLang).catch((e) => {
        degraded = true
        log.warn("JW movie rankings failed", { error: e instanceof Error ? e.message : String(e), country })
        return [] as { tmdbId: number; rank: number }[]
      }),
      getJWRankings("SHOW", country, 20, undefined, tmdbLang).catch((e) => {
        degraded = true
        log.warn("JW show rankings failed", { error: e instanceof Error ? e.message : String(e), country })
        return [] as { tmdbId: number; rank: number }[]
      }),
    ])
    const movieResults: TrendingItem[] = []
    const tvResults: TrendingItem[] = []
    // C3: getDetails/getImages del client condiviso (cache LRU 5min + inflight
    // coalescing) al posto dei fetch TMDB propri della route. Bonus: i dettagli
    // riscaldano la stessa cache che leggono i render poster (/movie/{id}?language=it-IT).
    const enrichItem = async (tmdbId: number, mediaType: "movie" | "tv") => {
      try {
        const primary = tmdbLang.slice(0, 2).toLowerCase()
        const [details, images] = await Promise.all([
          getDetails(mediaType, tmdbId, tmdbLang, apiKey),
          getImages(mediaType, tmdbId, `${primary},en,null`, apiKey),
        ])
        const poster = details.poster_path
          ? details.poster_path
          : images?.posters?.[0]?.file_path || null
        return {
          id: tmdbId,
          media_type: mediaType,
          title: details.title,
          name: details.name,
          poster_path: poster,
          release_date: details.release_date,
          first_air_date: details.first_air_date,
        }
      } catch {
        // Singolo item fallito → salta (un outage parziale non blocca il batch).
        return null
      }
    }
    // Concurrency limiter: ogni enrichItem fa 2 fetch TMDB; senza cap l'esplosione
    // parallela satura il rate limit TMDB. Pool di 4 alla volta.
    const CONCURRENCY = 4
    const movieBatches = await mapLimit(movieRanks, CONCURRENCY, async (r) => {
      const item = await enrichItem(r.tmdbId, "movie")
      if (item) movieResults.push({ ...item, rank: r.rank })
    })
    const tvBatches = await mapLimit(tvRanks, CONCURRENCY, async (r) => {
      const item = await enrichItem(r.tmdbId, "tv")
      if (item) tvResults.push({ ...item, rank: r.rank })
    })
    await Promise.all([movieBatches, tvBatches])
    movieResults.sort((a, b) => a.rank - b.rank)
    tvResults.sort((a, b) => a.rank - b.rank)
    const body = { movies: movieResults, tv: tvResults }
    // Se c'erano rank ma non è stato arricchito nulla → probabile outage TMDB.
    const emptyEnrichment = movieResults.length === 0 && tvResults.length === 0 && (movieRanks.length > 0 || tvRanks.length > 0)
    if (degraded || emptyEnrichment) {
      // Fix M12: flag esplicito — prima la risposta era 200 con array vuoti e
      // i client/CDN la trattavano come "niente in evidenza". Con `degraded`
      // il client può mostrare uno stato di outage invece di una home vuota.
      log.warn("Trending degraded — response not cached", { country, movies: movieResults.length, tv: tvResults.length })
      return jsonGzip({ ...body, degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
    }
    cacheSet(cacheKey, body, ["tmdb", "trending", country])
    return jsonGzip({ ...body, degraded: false }, 200, { "Cache-Control": "public, max-age=300, s-maxage=1800" }, acceptEncoding)
  } catch (err) {
    log.error("Trending fetch failed", { error: err instanceof Error ? err.message : String(err) })
    return jsonGzip({ movies: [], tv: [], degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
  }
}
