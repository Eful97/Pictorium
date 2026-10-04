import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { getDetails, getExternalIds, resolveRouteApiKey } from "@/lib/tmdb"
import { fetchAggregatedRating, parseRatingSources } from "@/lib/ratings"
import { computeVote } from "@/lib/rating-weights"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { envWithFallback } from "@/lib/env-compat"
import { findAnimeByTmdb } from "@/lib/anime-id-map"

// Tetto massimo per l'attesa del voto medio TMDB+IMDb (MDBList): se il fetch
// è lento si usa il voto TMDB, coerente con la route poster (stesso knob
// PICTORIUM_RATING_WAIT_MS, stesso default).
const RATING_WAIT_MS = (() => {
  const raw = envWithFallback("RATING_WAIT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { id } = await params
  const type = req.nextUrl.searchParams.get("type") || "movie"
  const language = req.nextUrl.searchParams.get("language") || "it-IT"
  const apiKey = await resolveRouteApiKey(req)
  const mdblistKey = await resolveRouteApiKey(req, "mdblist")
  const simklKey = await resolveRouteApiKey(req, "simkl")
  // Stesso parser della poster route (Fix D): whitelist identica ovunque.
  const ratingSources = parseRatingSources(req.nextUrl.searchParams.get("rsrc")) ?? undefined
  const mediaType = type === "tv" || type === "series" ? "tv" : "movie"
  const tmdbId = Number(id)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return Response.json({ genres: [], voteAverage: 0, voteCount: 0, status: null, type: null, release_date: null, first_air_date: null, last_air_date: null, next_episode_to_air: null, number_of_seasons: null, number_of_episodes: null, title: null, name: null, imdb_id: null })
  }
  // Return every association for this media side, without choosing a season.
  // Computed outside the details cache so snapshot updates also reach cache hits.
  const animeMatches = findAnimeByTmdb(tmdbId, mediaType)
  const anime_ids = {
    kitsu: [...new Set(animeMatches.flatMap((match) => match.k ? [match.k] : []))],
    mal: [...new Set(animeMatches.flatMap((match) => match.m ? [match.m] : []))],
  }
  // mdblist_key, simkl_key e rsrc cambiano il voto medio → parte del cache key.
  // Le fonti anime non hanno chiavi (endpoint pubblici): rsrcKey le copre.
  const mdblistHash = mdblistKey ? crypto.createHash("sha1").update(mdblistKey).digest("hex").slice(0, 8) : ""
  const simklHash = simklKey ? crypto.createHash("sha1").update(simklKey).digest("hex").slice(0, 8) : ""
  const rsrcKey = ratingSources ? ratingSources.slice().sort().join(",") : ""
  // v14: le fonti anime (anilist/kitsu) entrano negli aggregated via rsrcKey
  const cacheKey = rsrcKey
    ? `details:v14:${type}:${tmdbId}:${language}:${mdblistHash || "nomk"}:${simklHash || "nosk"}:${rsrcKey}`
    : `details:v14:${type}:${tmdbId}:${language}:${mdblistHash || "nomk"}:${simklHash || "nosk"}`
  interface Genre { id: number; name: string }
  interface Episode { id: number; name: string; air_date: string | null; episode_number: number; season_number: number }

  const cached = cacheGet<{ title?: string; name?: string; genres: Genre[]; voteAverage: number; voteCount: number; type?: string; status?: string; release_date?: string; first_air_date?: string; last_air_date?: string; next_episode_to_air?: Episode | null; number_of_seasons?: number; number_of_episodes?: number; networks?: { id: number; name: string; logo_path: string | null; origin_country: string }[]; production_companies?: { id: number; name: string; logo_path: string | null; origin_country: string }[]; imdb_id?: string | null; wikidata_id?: string | null; original_language?: string }>(cacheKey)
  if (cached) return Response.json({ ...cached, anime_ids })
  try {
    const [data, extIds] = await Promise.all([
      getDetails(mediaType, tmdbId, language, apiKey),
      getExternalIds(mediaType, tmdbId, apiKey).catch(() => ({ imdb_id: null, wikidata_id: null })),
    ])
    const imdbId = extIds.imdb_id
    let aggregatedData: Awaited<ReturnType<typeof fetchAggregatedRating>> = null
    const rating = imdbId
      ? (await (async () => {
          // Fix L19: timer della race cancellato se vince il fetch del rating.
          let ratingTimer: ReturnType<typeof setTimeout> | undefined
          const ratingTimeout = new Promise<Awaited<ReturnType<typeof fetchAggregatedRating>>>((resolve) => {
            ratingTimer = setTimeout(() => resolve(null), RATING_WAIT_MS)
          })
          const wantSimkl = !!(ratingSources?.includes("simkl") && simklKey)
          const wantAnilist = !!ratingSources?.includes("anilist")
          const wantKitsu = !!ratingSources?.includes("kitsu")
          const wantImdb = !ratingSources || ratingSources.includes("imdb")
          const aggregated = await Promise.race([
            fetchAggregatedRating(imdbId, mdblistKey, undefined, {
              simklKey,
              tmdbId,
              mediaType,
              wantSimkl,
              wantAnilist,
              wantKitsu,
              wantImdb,
              tmdbFallbackVote: data.vote_average ?? undefined,
            }).catch(() => null),
            ratingTimeout,
          ])
          if (ratingTimer) clearTimeout(ratingTimer)
          aggregatedData = aggregated
          const avgVote = computeVote(aggregated, ratingSources)
          return avgVote ?? data.vote_average ?? 0
        })())
      : data.vote_average ?? 0
    // wikidata_id: già fetchato qui sopra via getExternalIds (zero RTT extra) —
    // serve al client per il param wikidata_id della preview (fast-path REST
    // awards senza passare dallo SPARQL lento).
    const body = { title: data.title, name: data.name, genres: data.genres || [], voteAverage: rating, voteCount: data.vote_count, type: data.type, status: data.status, release_date: data.release_date, first_air_date: data.first_air_date, last_air_date: data.last_air_date, next_episode_to_air: data.next_episode_to_air, number_of_seasons: data.number_of_seasons, number_of_episodes: data.number_of_episodes, networks: data.networks, production_companies: data.production_companies, imdb_id: extIds.imdb_id, wikidata_id: extIds.wikidata_id ?? null, original_language: data.original_language, aggregatedRatings: aggregatedData }
    cacheSet(cacheKey, body, ["tmdb", "details"])
    return Response.json({ ...body, anime_ids })
  } catch {
    return Response.json({ genres: [], voteAverage: 0, voteCount: 0, status: null, type: null, release_date: null, first_air_date: null, last_air_date: null, next_episode_to_air: null, number_of_seasons: null, number_of_episodes: null, title: null, name: null, imdb_id: null })
  }
}
