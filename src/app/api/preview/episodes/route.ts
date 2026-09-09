import { NextRequest } from "next/server"
import crypto from "node:crypto"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import {
  getFullDetails,
  getTVEpisodeGroup,
  getTVSeason,
  type TMDBEpisodeGroupDetails,
  posterUrl,
  resolveRequestApiKey,
} from "@/lib/tmdb"
import { enrichVideosWithTvdb } from "@/lib/tvdb"
import { buildVideosFromAnizip, buildVideosFromGroups, buildVideosFromTvdb, concurrentMap, resolveSeasonNumbers, seasonNumberForGroup } from "@/lib/episode-ordering"
import { groupDetailsEpisodeCount, resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { envWithFallback } from "@/lib/env-compat"

interface PreviewVideo {
  id: string
  name: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  rating?: string
}

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const tmdbIdRaw = req.nextUrl.searchParams.get("tmdbId") || req.nextUrl.searchParams.get("id")
  const tmdbId = tmdbIdRaw ? parseInt(tmdbIdRaw, 10) : NaN
  if (!tmdbId || Number.isNaN(tmdbId) || tmdbId <= 0) {
    return Response.json({ error: "tmdbId mancante o non valido" }, { status: 400 })
  }

  const rawGroupId = req.nextUrl.searchParams.get("episodeGroupId")
  // normalize: empty string -> null (standard)
  const episodeGroupId = rawGroupId && rawGroupId !== "" ? rawGroupId : null
  const language = req.nextUrl.searchParams.get("lang") || "it-IT"
  const apiKey = resolveRequestApiKey(req)
  const tvdbKeyParam = req.nextUrl.searchParams.get("tvdb_key") || undefined
  const tvdbApiKey = tvdbKeyParam || envWithFallback("TVDB_API_KEY") || process.env.TVDB_API_KEY
  const episodeMetadataSource = req.nextUrl.searchParams.get("source") || (tvdbApiKey ? "tvdb" : "tmdb")

  // "auto" (parametro assente) e "standard" esplicito hanno chiavi diverse:
  // l'automatico può risolvere un gruppo Parts, lo standard mai.
  const cacheKey = `preview:episodes:tv:${tmdbId}:eg${episodeGroupId ?? "auto"}:lang${language}:ak${apiKey ? hashFragment(apiKey) : "none"}:es${episodeMetadataSource}:tk${tvdbApiKey ? hashFragment(tvdbApiKey) : "none"}`
  const cached = cacheGet<{ videos: PreviewVideo[]; seasons: { season: number; name: string; overview?: string; episodes: PreviewVideo[] }[] }>(cacheKey)
  if (cached) {
    return Response.json(cached, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  try {
    const details = await getFullDetails("tv", tmdbId, language, apiKey)
    if (!details || !details.id) {
      return Response.json({ videos: [], seasons: [] }, { status: 200 })
    }

    // tenta di risolvere imdbId per primaryId (per id video stremio)
    let imdbId: string | null = details.external_ids?.imdb_id ?? null
    if (!imdbId) {
      try {
        const { getExternalIds } = await import("@/lib/tmdb")
        const ext = await getExternalIds("tv", tmdbId, apiKey)
        imdbId = ext.imdb_id ?? null
      } catch {
        imdbId = null
      }
    }
    const primaryId = imdbId || `tmdb:${tmdbId}`

    const videos: PreviewVideo[] = []
    let groupDetails: TMDBEpisodeGroupDetails | null = null

    // TVDB / AniZip ordering sentinel (shared helper) — supporta tvdb:<seasonType>
    const isTvdbPreview = episodeGroupId === "tvdb" || (episodeGroupId?.startsWith("tvdb:") ?? false)
    if (isTvdbPreview) {
      const seasonType = episodeGroupId === "tvdb" ? "default" : (episodeGroupId!.slice(5) || "default")
      try {
        const tvdbVideos = await buildVideosFromTvdb(imdbId, tmdbId, primaryId, tvdbApiKey || "", seasonType)
        if (tvdbVideos.length > 0) videos.push(...(tvdbVideos as unknown as PreviewVideo[]))
      } catch {
        // fallback silenzioso a TMDB standard
      }
    } else if (episodeGroupId === "anizip") {
      try {
        const anizipVideos = await buildVideosFromAnizip(tmdbId, primaryId)
        if (anizipVideos.length > 0) videos.push(...(anizipVideos as unknown as PreviewVideo[]))
      } catch {
        // fallback silenzioso a TMDB standard
      }
    }

    const isGroupPreview = episodeGroupId !== null && episodeGroupId !== "standard" && !isTvdbPreview && episodeGroupId !== "anizip"
    if (videos.length === 0 && isGroupPreview) {
      groupDetails = await getTVEpisodeGroup(episodeGroupId!, language, apiKey)
    }

    if (groupDetails?.groups && groupDetails.groups.length > 0) {
      videos.push(...(buildVideosFromGroups(groupDetails, primaryId) as unknown as PreviewVideo[]))
    }
    // true se i videos seguono un Episode Group (esplicito o automatico):
    // vedi meta-handler, l'arricchimento TVDB su S:E standard misallineerebbe.
    let videosFromGroup = groupDetails?.groups != null && groupDetails.groups.length > 0

    // Default automatico "Parts" (stessa logica di meta-handler per WYSIWYG
    // sync): solo quando nessun ordinamento è richiesto (parametro assente).
    // "standard" esplicito resta standard. Ogni fallimento → standard sotto.
    let autoDefault: { groupId: string; name: string } | null = null
    if (videos.length === 0 && episodeGroupId === null && details.seasons && details.seasons.length > 0) {
      try {
        const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
        const standardEpisodeCount = regularSeasons.reduce((n, s) => n + ((s as { episode_count?: number }).episode_count || 0), 0)
        const totalEpisodeCountWithSpecials = details.seasons.reduce((n, s) => n + ((s as { episode_count?: number }).episode_count || 0), 0)
        if (regularSeasons.length > 0 && standardEpisodeCount > 0) {
          const autoId = await resolveDefaultEpisodeGroupId(tmdbId, regularSeasons.length, standardEpisodeCount, apiKey, totalEpisodeCountWithSpecials)
          if (autoId) {
            const autoDetails = await getTVEpisodeGroup(autoId, language, apiKey).catch(() => null)
            const count = groupDetailsEpisodeCount(autoDetails)
            const countMatches = count === standardEpisodeCount || (totalEpisodeCountWithSpecials > standardEpisodeCount && count === totalEpisodeCountWithSpecials)
            if (
              autoDetails?.groups &&
              autoDetails.groups.length > 0 &&
              countMatches
            ) {
              groupDetails = autoDetails
              videos.push(...(buildVideosFromGroups(autoDetails, primaryId) as unknown as PreviewVideo[]))
              videosFromGroup = true
              autoDefault = { groupId: autoId, name: autoDetails.name || autoId }
            }
          }
        }
      } catch {
        // fallback standard sotto
      }
    }

    // Fallback standard — limitato a 5 richieste parallele per evitare burst TMDB
    if (videos.length === 0 && details.seasons && details.seasons.length > 0) {
      const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
      const seasonsData = await concurrentMap(regularSeasons, (s) => getTVSeason(tmdbId, s.season_number!, language, apiKey), 5)
      for (const sData of seasonsData) {
        if (!sData || !sData.episodes) continue
        for (const ep of sData.episodes) {
          videos.push({
            id: `${primaryId}:${ep.season_number}:${ep.episode_number}`,
            name: ep.name || `Episodio ${ep.episode_number}`,
            season: ep.season_number,
            episode: ep.episode_number,
            overview: ep.overview || undefined,
            thumbnail: ep.still_path ? posterUrl(ep.still_path, "w500") : undefined,
            released: ep.air_date ? `${ep.air_date}T00:00:00.000Z` : undefined,
            rating: ep.vote_average ? ep.vote_average.toFixed(1) : undefined,
          })
        }
      }
    }

    const isTvdbPreviewForEnrich = episodeGroupId === "tvdb" || (episodeGroupId?.startsWith("tvdb:") ?? false)
    if (videos.length > 0 && episodeMetadataSource === "tvdb" && tvdbApiKey && !isTvdbPreviewForEnrich && !videosFromGroup) {
      await enrichVideosWithTvdb(videos as unknown as import("@/lib/meta-handler").StremioVideo[], imdbId, tmdbId, tvdbApiKey, "ita")
    }

    // Raggruppa per stagione per l'anteprima
    const seasonMap = new Map<number, PreviewVideo[]>()
    for (const v of videos) {
      if (!seasonMap.has(v.season)) seasonMap.set(v.season, [])
      seasonMap.get(v.season)!.push(v)
    }
    const seasonMetaMap = new Map<number, { name: string; overview?: string }>()
    if (details.seasons) {
      for (const s of details.seasons) {
        if (typeof s.season_number === "number") {
          const so = (s as unknown as { overview?: string }).overview
          seasonMetaMap.set(s.season_number, { name: s.name || `Stagione ${s.season_number}`, overview: so || undefined })
        }
      }
    }
    // per groupDetails usa il nome del gruppo (shared helper per season number)
    if (groupDetails?.groups) {
      const { sorted, hasZero, hasSpecials } = resolveSeasonNumbers(groupDetails.groups)
      for (const g of groupDetails.groups) {
        const derivedSeason = seasonNumberForGroup(g, sorted.indexOf(g), sorted, hasZero, hasSpecials)
        if (!seasonMetaMap.has(derivedSeason)) {
          seasonMetaMap.set(derivedSeason, { name: g.name || `Stagione ${derivedSeason}` })
        }
      }
    }

    const seasons = Array.from(seasonMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, episodes]) => ({
        season,
        name: seasonMetaMap.get(season)?.name || (season === 0 ? "Specials" : `Stagione ${season}`),
        overview: seasonMetaMap.get(season)?.overview,
        episodes: episodes.sort((a, b) => a.episode - b.episode),
      }))

    const payload = { videos, seasons, totalEpisodes: videos.length, totalSeasons: seasons.length, tmdbId, episodeGroupId: episodeGroupId ?? "standard", autoDefault, language }
    cacheSet(cacheKey, payload, ["preview"], 5 * 60 * 1000)
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch (e) {
    return Response.json({ videos: [], seasons: [], totalEpisodes: 0, totalSeasons: 0, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
