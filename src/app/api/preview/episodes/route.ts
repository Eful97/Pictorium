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
  resolveRouteApiKey,
  evictTVSeasonCache,
} from "@/lib/tmdb"
import { enrichVideosWithTvdbDetailed } from "@/lib/tvdb"
import { buildVideosFromAnizip, buildVideosFromGroups, buildVideosFromTvdbDetailed, concurrentMap, isSeasonEpisodesComplete, resolveSeasonNumbers, seasonNumberForGroup } from "@/lib/episode-ordering"
import { groupDetailsEpisodeCount, groupDetailsRegularEpisodeCount, resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { envWithFallback } from "@/lib/env-compat"
import { combineAbortSignals } from "@/lib/abort-signal"

const PREVIEW_EPISODES_BUDGET_MS = 15000

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

interface PreviewEpisodesBody {
  videos: PreviewVideo[]
  seasons: { season: number; name: string; overview?: string; episodes: PreviewVideo[] }[]
  totalEpisodes: number
  totalSeasons: number
  tmdbId: number
  episodeGroupId: string
  autoDefault: { groupId: string; name: string } | null
  language: string
}

function previewCacheHeaders(isPartial: boolean): Record<string, string> {
  // Partial: short downstream TTL with no SWR, so 30s is a hard upper stale
  // bound and the retry can actually serve the recovery.
  return {
    "Cache-Control": isPartial
      ? "public, max-age=30"
      : "public, max-age=60, stale-while-revalidate=120",
    "Access-Control-Allow-Origin": "*",
  }
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
  const apiKey = (await resolveRouteApiKey(req)) || ""
  const tvdbKeyParam = req.nextUrl.searchParams.get("tvdb_key") || undefined
  const tvdbApiKey = tvdbKeyParam || (await resolveRouteApiKey(req, "tvdb")) || envWithFallback("TVDB_API_KEY") || process.env.TVDB_API_KEY || ""
  const episodeMetadataSource = req.nextUrl.searchParams.get("source") || (tvdbApiKey ? "tvdb" : "tmdb")

  // "auto" (parametro assente) e "standard" esplicito hanno chiavi diverse:
  // l'automatico può risolvere un gruppo Parts, lo standard mai.
  const cacheKey = `preview:episodes:tv:${tmdbId}:eg${episodeGroupId ?? "auto"}:lang${language}:ak${apiKey ? hashFragment(apiKey) : "none"}:es${episodeMetadataSource}:tk${tvdbApiKey ? hashFragment(tvdbApiKey) : "none"}`
  const cached = cacheGet<{ body: PreviewEpisodesBody; partial: boolean }>(cacheKey)
  if (cached) {
    return Response.json(cached.body, {
      headers: previewCacheHeaders(cached.partial === true),
    })
  }

  try {
    // Single request-wide budget (15s) combined with the incoming signal
    // (client disconnect): every phase below derives from it with per-phase caps.
    const requestSignal = combineAbortSignals(
      (req as { signal?: AbortSignal }).signal ?? null,
      PREVIEW_EPISODES_BUDGET_MS,
    )
    const details = await getFullDetails("tv", tmdbId, language, apiKey, requestSignal)
    if (!details || !details.id) {
      return Response.json({ videos: [], seasons: [] }, { status: 200 })
    }

    // tenta di risolvere imdbId per primaryId (per id video stremio)
    let imdbId: string | null = details.external_ids?.imdb_id ?? null
    if (!imdbId) {
      try {
        const { getExternalIds } = await import("@/lib/tmdb")
        const ext = await getExternalIds("tv", tmdbId, apiKey, requestSignal, 5000)
        imdbId = ext.imdb_id ?? null
      } catch {
        imdbId = null
      }
    }
    const primaryId = imdbId || `tmdb:${tmdbId}`

    const videos: PreviewVideo[] = []
    let isPartialSeasonData = false
    let groupDetails: TMDBEpisodeGroupDetails | null = null

    // TVDB / AniZip ordering sentinel (shared helper) — supporta tvdb:<seasonType>
    const isTvdbPreview = episodeGroupId === "tvdb" || (episodeGroupId?.startsWith("tvdb:") ?? false)
    if (isTvdbPreview) {
      const seasonType = episodeGroupId === "tvdb" ? "default" : (episodeGroupId!.slice(5) || "default")
      try {
        const orderingSignal = combineAbortSignals(requestSignal, 10000)
        const tvdbOrdered = await buildVideosFromTvdbDetailed(imdbId, tmdbId, primaryId, tvdbApiKey || "", seasonType, apiKey, orderingSignal)
        if (tvdbOrdered.videos.length > 0) videos.push(...(tvdbOrdered.videos as unknown as PreviewVideo[]))
        if (!tvdbOrdered.complete) isPartialSeasonData = true
      } catch {
        // fallback silenzioso a TMDB standard
      }
    } else if (episodeGroupId === "anizip") {
      try {
        const anizipVideos = await buildVideosFromAnizip(tmdbId, primaryId, combineAbortSignals(requestSignal, 8000))
        if (anizipVideos.length > 0) videos.push(...(anizipVideos as unknown as PreviewVideo[]))
      } catch {
        // fallback silenzioso a TMDB standard
      }
    }

    const isGroupPreview = episodeGroupId !== null && episodeGroupId !== "standard" && !isTvdbPreview && episodeGroupId !== "anizip"
    if (videos.length === 0 && isGroupPreview) {
      groupDetails = await getTVEpisodeGroup(episodeGroupId!, language, apiKey, combineAbortSignals(requestSignal, 8000))
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
          const autoId = await resolveDefaultEpisodeGroupId(tmdbId, regularSeasons.length, standardEpisodeCount, apiKey, totalEpisodeCountWithSpecials, combineAbortSignals(requestSignal, 8000))
          if (autoId) {
            const autoDetails = await getTVEpisodeGroup(autoId, language, apiKey, combineAbortSignals(requestSignal, 6000)).catch(() => null)
            const count = groupDetailsEpisodeCount(autoDetails)
            const regularCount = groupDetailsRegularEpisodeCount(autoDetails)
            const countMatches =
              count === standardEpisodeCount ||
              regularCount === standardEpisodeCount ||
              (totalEpisodeCountWithSpecials > standardEpisodeCount &&
                (count === totalEpisodeCountWithSpecials || Math.abs(count - totalEpisodeCountWithSpecials) <= 15))
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
      const seasonSignal = combineAbortSignals(requestSignal, 10000)
      const seasonsData = await concurrentMap(regularSeasons, (s) => getTVSeason(tmdbId, s.season_number!, language, apiKey, seasonSignal), 5)
      for (let i = 0; i < regularSeasons.length; i++) {
        const sData = seasonsData[i]
        const expected = (regularSeasons[i] as unknown as { episode_count?: number }).episode_count
        const aired = (regularSeasons[i] as unknown as { air_date?: string }).air_date
        if (!isSeasonEpisodesComplete(sData, expected, aired)) {
          isPartialSeasonData = true
          evictTVSeasonCache(tmdbId, (regularSeasons[i] as unknown as { season_number?: number }).season_number!)
        }
        for (const ep of sData?.episodes ?? []) {
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
      const enrichSignal = combineAbortSignals(requestSignal, 8000)
      const enrichComplete = await enrichVideosWithTvdbDetailed(videos as unknown as import("@/lib/meta-handler").StremioVideo[], imdbId, tmdbId, tvdbApiKey, "ita", apiKey, enrichSignal)
      if (!enrichComplete) isPartialSeasonData = true
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
        const existing = seasonMetaMap.get(derivedSeason)
        seasonMetaMap.set(derivedSeason, {
          name: g.name || existing?.name || (derivedSeason === 0 ? "Specials" : `Stagione ${derivedSeason}`),
          overview: existing?.overview,
        })
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

    const payload: PreviewEpisodesBody = { videos, seasons, totalEpisodes: videos.length, totalSeasons: seasons.length, tmdbId, episodeGroupId: episodeGroupId ?? "standard", autoDefault, language }
    if (!isPartialSeasonData) {
      cacheSet(cacheKey, { body: payload, partial: false }, ["preview"], 5 * 60 * 1000)
    } else {
      cacheSet(cacheKey, { body: payload, partial: true }, ["preview"], 30 * 1000)
    }
    return Response.json(payload, {
      headers: previewCacheHeaders(isPartialSeasonData),
    })
  } catch {
    // Mai e.message in chiaro nel body: può contenere URL/chiavi upstream.
    return Response.json({ videos: [], seasons: [], totalEpisodes: 0, totalSeasons: 0, error: "Episodi non disponibili" }, { status: 200 })
  }
}
