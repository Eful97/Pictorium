import { NextRequest } from "next/server"
import { getTVEpisodeImages, resolveRouteApiKey } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { jsonGzip } from "@/lib/json-response"

type RouteParams = { id: string; season: string; episode: string }

/**
 * Still collezione di un singolo episodio TMDB.
 * Read-only: nessun renderer/thumbnail qui (il picker arriva in un task
 * successivo). Stessa validazione e stessa cache (`tmdb`/`images`) della
 * route `/api/tmdb/[id]/images`, ma con type=tv obbligatorio e id
 * serie/stagione/episodio numerici.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { id, season, episode } = await params
  const type = req.nextUrl.searchParams.get("type") || "tv"
  // Stesso default/trattamento della route images: la lingua è una lista
  // passata a `include_image_language`, senza allowlist dedicata.
  const languages = req.nextUrl.searchParams.get("languages") || "en,null"
  const acceptEncoding = req.headers.get("accept-encoding")

  if (type !== "tv") {
    return jsonGzip({ error: "Invalid type: must be 'tv'" }, 400, undefined, acceptEncoding)
  }
  const seriesId = Number(id)
  const seasonNumber = Number(season)
  const episodeNumber = Number(episode)
  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    return jsonGzip({ error: "Invalid id: must be a positive integer" }, 400, undefined, acceptEncoding)
  }
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    return jsonGzip({ error: "Invalid season: must be a non-negative integer" }, 400, undefined, acceptEncoding)
  }
  if (!Number.isInteger(episodeNumber) || episodeNumber < 0) {
    return jsonGzip({ error: "Invalid episode: must be a non-negative integer" }, 400, undefined, acceptEncoding)
  }

  const apiKey = await resolveRouteApiKey(req)
  const cacheKey = `episode_images:${seriesId}:${seasonNumber}:${episodeNumber}:${languages}`
  const cached = cacheGet(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)
  // Niente catch-and-cache: un errore/outage upstream NON diventa una lista
  // vuota cached (avvelenerebbe il picker). 502 e retry possibile.
  let data: Awaited<ReturnType<typeof getTVEpisodeImages>>
  try {
    const imagesSignal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(8000) : undefined
    data = await getTVEpisodeImages(seriesId, seasonNumber, episodeNumber, languages, apiKey, imagesSignal, 8000)
  } catch {
    return jsonGzip({ error: "TMDB episode images unavailable" }, 502, undefined, acceptEncoding)
  }
  // Stesso tag della route images: la cache di risposta condivisa resta una
  // sola famiglia (TTL di default 30 minuti).
  cacheSet(cacheKey, data, ["tmdb", "images"])
  return jsonGzip(data, 200, undefined, acceptEncoding)
}
