import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { getServerDefaults } from "@/lib/server-defaults"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { envWithFallback } from "@/lib/env-compat"
import {
  getFullDetails,
  getImages,
  getTVSeason,
  getTVEpisodeGroup,
  type TMDBEpisodeGroupDetails,
  posterUrl,
  posterUrlOriginal,
  resolveRequestApiKey,
  tmdbFindByImdb,
  tmdbFindByTvdb,
} from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { resolveCatalogRegion } from "@/lib/catalog-handler"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { enrichVideosWithTvdb } from "@/lib/tvdb"
import { buildVideosFromAnizip, buildVideosFromGroups, buildVideosFromTvdb, concurrentMap } from "@/lib/episode-ordering"
import { groupDetailsEpisodeCount, resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { createLogger } from "@/lib/logger"

const log = createLogger("meta")

export interface StremioVideo {
  id: string
  name: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  rating?: string
}

export interface StremioTrailer {
  source: string
  type: string
}

export interface StremioMetaDetail {
  id: string
  imdb_id?: string
  type: "movie" | "series"
  name: string
  genres: string[]
  poster: string | null
  posterShape?: "poster"
  background?: string
  logo?: string
  description?: string
  releaseInfo?: string
  released?: string
  runtime?: string
  imdbRating?: string
  cast?: string[]
  director?: string[]
  writer?: string[]
  trailers?: StremioTrailer[]
  behaviorHints?: {
    defaultVideoId?: string
  }
  videos?: StremioVideo[]
}

function metaResponse(body: { meta: StremioMetaDetail | null }): Response {
  return Response.json(body, {
    headers: {
      // Stremio Web usa CDN con cache lunga: 12h rendeva invisibile il cambio
      // ordinamento (Re:ZERO: funzionava su Nuvio/bypass, non su Stremio web).
      // 5 min + SWR breve è sufficiente per le performance e permette al
      // cambio episodeGroupId di propagarsi velocemente. Il server invalida
      // comunque la cache interna su PUT/POST mapping.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

function normalizeMediaType(type: string): "movie" | "series" {
  const t = type.toLowerCase()
  return (t === "movie" || t === "anime.movie") ? "movie" : "series"
}

async function pictoriumPosterUrl(
  req: NextRequest,
  type: "movie" | "series",
  id: number,
  configParam?: string | null,
  userParam?: string | null,
  mdblistKeyParam?: string | null,
  posterLang = "it",
): Promise<string> {
  const serverDefaults = getServerDefaults()
  const userConfig = configParam ? decodeConfig(configParam) : null
  const defaults = userConfig ? { ...serverDefaults, ...userConfig } : serverDefaults
  const mapping = await getById(type === "series" ? "tv" : "movie", id)
  return buildStremioPosterUrl({
    origin: getOriginFromRequest(req),
    type,
    id,
    defaults,
    mapping,
    lang: posterLang,
    config: configParam || undefined,
    user: userParam || undefined,
    mdblistKey: mdblistKeyParam || undefined,
  }).toString()
}



/**
 * Gestore principale della risorsa `meta` di Stremio.
 * Fornisce schede complete (dettagli, cast, trailer, trame, logo e lista episodi)
 * con il poster nativo di Pictorium.
 */
export async function pictoriumMeta(
  req: NextRequest,
  mediaType: string,
  rawId: string,
  userParam: string | null,
  configParam: string | null,
): Promise<Response> {
  const rl = await rateLimit(rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const cleanId = rawId.replace(/\.json$/, "")
  if (cleanId.length > 80) return metaResponse({ meta: null })

  const stType = normalizeMediaType(mediaType)
  const tmdbMediaType = stType === "movie" ? "movie" : "tv"
  const mdblistKeyParam = req.nextUrl.searchParams.get("mdblist_key") || undefined
  const tvdbKeyParam = req.nextUrl.searchParams.get("tvdb_key") || undefined

  const apiKey = resolveRequestApiKey(req)
  const mdblistKey = mdblistKeyParam || envWithFallback("MDBLIST_KEY")
  const tvdbApiKey = tvdbKeyParam || envWithFallback("TVDB_API_KEY") || process.env.TVDB_API_KEY
  let userConfig: Partial<PictoriumUserConfig> | null = null

  if (configParam) {
    userConfig = decodeConfig(configParam)
  }
  if (!userConfig) {
    userConfig = getServerDefaults()
  }

  const episodeMetadataSource = userConfig?.episodeMetadataSource || (tvdbApiKey ? "tvdb" : "tmdb")
  const region = resolveCatalogRegion(req, userConfig)
  const tmdbLang = region.lang
  const posterLang = tmdbLang.slice(0, 2).toLowerCase()

  // Risoluzione ID TMDB e IMDb
  let tmdbId: number | null = null
  let imdbId: string | null = null

  if (cleanId.startsWith("tt")) {
    imdbId = cleanId
    tmdbId = await tmdbFindByImdb(cleanId, tmdbMediaType, apiKey)
  } else if (cleanId.startsWith("tmdb:")) {
    const parsed = parseInt(cleanId.slice(5), 10)
    if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
  } else if (cleanId.startsWith("tvdb:")) {
    const tvdbRaw = cleanId.slice(5)
    tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey)
  } else if (cleanId.startsWith("tvdbc:")) {
    const tvdbRaw = cleanId.slice(6)
    tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey)
  } else if (/^\d+$/.test(cleanId)) {
    const parsed = parseInt(cleanId, 10)
    if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
  }

  if (!tmdbId) {
    return metaResponse({ meta: null })
  }

  // Per le serie, il meta videos dipende dal mapping episodeGroupId; per i film
  // il poster dipende comunque dal mapping (cambio poster/stili): includere
  // episodeGroupId+updatedAt nella cache key (fetch pre-cache) altrimenti dopo
  // un save si serve lo stale fino a 12h. Il lookup è cached (memCache/KV
  // 500ms) quindi costo minimo. Prima era solo per le serie (F4).
  let preMappingForCache: { episodeGroupId?: string | null; updatedAt?: string } | null = null
  try {
    const pre = await getById(tmdbMediaType, tmdbId)
    if (pre) preMappingForCache = { episodeGroupId: pre.episodeGroupId ?? null, updatedAt: pre.updatedAt }
  } catch { /* ignore — fallback a auto */ }
  const egKey = preMappingForCache ? `${preMappingForCache.episodeGroupId ?? "auto"}:${preMappingForCache.updatedAt ?? ""}` : "auto"
  // eo2 = versione ordinamento episodi: il default automatico "Parts" (v2)
  // cambia i videos a parità di mapping — senza frammento, un meta cachato
  // con le stagioni standard resterebbe servito fino a 12h dopo il deploy.
  const cacheKey = `stremio:meta:${stType}:${cleanId}:pv${POSTER_URL_VERSION}${userParam ? `:u${hashFragment(userParam)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${tvdbApiKey ? `:tk${hashFragment(tvdbApiKey)}` : ""}:es${episodeMetadataSource}:eg${hashFragment(egKey)}:r${region.code}${stType === "series" ? ":eo2" : ""}`
  const cached = cacheGet<{ meta: StremioMetaDetail }>(cacheKey)
  if (cached) return metaResponse(cached)

  try {
    const details = await getFullDetails(tmdbMediaType, tmdbId, tmdbLang, apiKey)
    if (!details || !details.id) {
      return metaResponse({ meta: null })
    }

    if (!imdbId && details.external_ids?.imdb_id) {
      imdbId = details.external_ids.imdb_id
    }
    if (!imdbId) {
      imdbId = await resolveImdbId(tmdbMediaType, tmdbId, apiKey)
    }

    const primaryId = imdbId || `tmdb:${tmdbId}`
    const poster = await pictoriumPosterUrl(req, stType, tmdbId, configParam, userParam, mdblistKeyParam, posterLang)
    const background = details.backdrop_path ? posterUrlOriginal(details.backdrop_path) : undefined

    // Risoluzione Logo
    let logo: string | undefined
    try {
      const images = await getImages(tmdbMediaType, tmdbId, `${posterLang},en,null`, apiKey)
      if (images?.logos && images.logos.length > 0) {
        // Preferisci logo della lingua locale, altrimenti primo disponibile
        const langLogo = images.logos.find((l) => l.iso_639_1 === posterLang) || images.logos[0]
        if (langLogo?.file_path) {
          logo = posterUrlOriginal(langLogo.file_path)
        }
      }
    } catch {
      // Logo opzionale
    }

    const cast = (details.credits?.cast || []).slice(0, 10).map((c) => c.name)
    const director = (details.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name)
    const writers = (details.credits?.crew || []).filter((c) => c.job === "Writer" || c.job === "Screenplay").map((c) => c.name)

    const trailers: StremioTrailer[] = (details.videos?.results || [])
      .filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"))
      .slice(0, 3)
      .map((v) => ({ source: v.key, type: "Trailer" }))

    let videos: StremioVideo[] | undefined

    if (stType === "series") {
      videos = []
      const mapping = await getById("tv", tmdbId)

      // TVDB / AniZip ordering sentinel (shared helper) — supporta tvdb:<seasonType>
      const sentinel = mapping?.episodeGroupId || null
      const isTvdbSentinel = sentinel === "tvdb" || (sentinel?.startsWith("tvdb:") ?? false)
      if (isTvdbSentinel) {
        const seasonType = sentinel === "tvdb" ? "default" : (sentinel!.slice(5) || "default")
        try {
          const tvdbVideos = await buildVideosFromTvdb(imdbId, tmdbId, primaryId, tvdbApiKey || "", seasonType)
          if (tvdbVideos.length > 0) videos.push(...(tvdbVideos as StremioVideo[]))
        } catch (e) {
          log.warn("TVDB ordering failed, fallback to standard", { error: e instanceof Error ? e.message : String(e) })
        }
      } else if (sentinel === "anizip") {
        try {
          const anizipVideos = await buildVideosFromAnizip(tmdbId, primaryId)
          if (anizipVideos.length > 0) videos.push(...(anizipVideos as StremioVideo[]))
        } catch (e) {
          log.warn("AniZip ordering failed, fallback to standard", { error: e instanceof Error ? e.message : String(e) })
        }
      }

      let groupDetails: TMDBEpisodeGroupDetails | null = null
      const isGroupSentinel = sentinel !== null && sentinel !== "standard" && !isTvdbSentinel && sentinel !== "anizip"
      // true quando i videos seguono un Episode Group (esplicito o default
      // automatico): la numerazione S:E non coincide più con quella standard
      // e l'arricchimento TVDB (mappato su S:E) assegnerebbe titoli/cover
      // dell'episodio sbagliato → va saltato (vedi sotto).
      let videosFromGroup = false

      // Default: stagioni standard TMDB. Si usa un Episode Group solo se
      // l'utente ha salvato esplicitamente un episodeGroupId diverso da "standard", "tvdb:*" e "anizip".
      if (videos.length === 0 && isGroupSentinel) {
        groupDetails = await getTVEpisodeGroup(sentinel!, "it-IT", apiKey)
      }

      if (groupDetails?.groups && groupDetails.groups.length > 0) {
        videos.push(...(buildVideosFromGroups(groupDetails, primaryId) as StremioVideo[]))
        videosFromGroup = true
      }

      // Default automatico "Parts" (es. Casa di Carta 5 parti invece di 3
      // stagioni): solo quando nessun mapping salvato sceglie esplicitamente
      // (sentinel null). "standard" esplicito resta standard, mapping salvato
      // vince sempre. Ogni fallimento degrada allo standard sotto.
      if (videos.length === 0 && sentinel === null && details.seasons && details.seasons.length > 0) {
        try {
          const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
          const standardEpisodeCount = regularSeasons.reduce((n, s) => n + (s.episode_count || 0), 0)
          const totalEpisodeCountWithSpecials = details.seasons.reduce((n, s) => n + (s.episode_count || 0), 0)
          if (regularSeasons.length > 0 && standardEpisodeCount > 0) {
            const autoId = await resolveDefaultEpisodeGroupId(
              tmdbId,
              regularSeasons.length,
              standardEpisodeCount,
              apiKey,
              totalEpisodeCountWithSpecials,
            )
            if (autoId) {
              const autoDetails = await getTVEpisodeGroup(autoId, tmdbLang, apiKey).catch(() => null)
              const count = groupDetailsEpisodeCount(autoDetails)
              const countMatches = count === standardEpisodeCount || (totalEpisodeCountWithSpecials > standardEpisodeCount && count === totalEpisodeCountWithSpecials)
              if (
                autoDetails?.groups &&
                autoDetails.groups.length > 0 &&
                countMatches
              ) {
                videos.push(...(buildVideosFromGroups(autoDetails, primaryId) as StremioVideo[]))
                videosFromGroup = true
              }
            }
          }
        } catch {
          // fallback standard sotto
        }
      }

      // Fallback alle stagioni standard se non ci sono Episode Groups alternativi
      if (videos.length === 0 && details.seasons && details.seasons.length > 0) {
        const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
        const seasonsData = await concurrentMap(regularSeasons, (s) => getTVSeason(tmdbId, s.season_number!, tmdbLang, apiKey), 5)

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

      // Se la fonte metadati episodi è TVDB ed è presente una chiave TVDB, arricchisci con copertine e trame TVDB
      // Skip se già ordinato via TVDB (dati già TVDB nativi) o se i videos
      // seguono un Episode Group: la mappa TVDB è su S:E standard e con le
      // Parti assegnerebbe nome/cover/trama dell'episodio sbagliato.
      const isTvdbOrdering = (mapping?.episodeGroupId === "tvdb" || (mapping?.episodeGroupId?.startsWith("tvdb:") ?? false))
      if (videos.length > 0 && episodeMetadataSource === "tvdb" && tvdbApiKey && !isTvdbOrdering && !videosFromGroup) {
        await enrichVideosWithTvdb(videos, imdbId, tmdbId, tvdbApiKey, "ita")
      }
    }

    const meta: StremioMetaDetail = {
      id: cleanId,
      imdb_id: imdbId || undefined,
      type: stType,
      name: details.title || details.name || "",
      genres: (details.genres || []).map((g) => g.name),
      poster,
      posterShape: "poster",
      background,
      logo,
      description: details.overview || details.tagline || undefined,
      releaseInfo: (details.release_date || details.first_air_date || "").slice(0, 4) || undefined,
      released: details.release_date ? `${details.release_date}T00:00:00.000Z` : undefined,
      runtime: details.runtime ? `${details.runtime} min` : undefined,
      imdbRating: details.vote_average ? details.vote_average.toFixed(1) : undefined,
      cast: cast.length > 0 ? cast : undefined,
      director: director.length > 0 ? director : undefined,
      writer: writers.length > 0 ? writers : undefined,
      trailers: trailers.length > 0 ? trailers : undefined,
      behaviorHints: stType === "movie" ? { defaultVideoId: primaryId } : undefined,
      videos: videos && videos.length > 0 ? videos : undefined,
    }

    const body = { meta }
    cacheSet(cacheKey, body, ["stremio", "meta"], 12 * 60 * 60 * 1000)
    return metaResponse(body)
  } catch (e) {
    log.error("Meta retrieval error", { error: e instanceof Error ? e.message : String(e) })
    return metaResponse({ meta: null })
  }
}
