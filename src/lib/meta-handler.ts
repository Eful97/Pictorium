import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGetShared, cacheSet, hashUserFragment } from "@/lib/cache"
import { getServerDefaultsChecked, getServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { selectBestLogo } from "@/lib/logo-selection"
import {
  getFullDetails,
  getImages,
  getTVSeason,
  getTVEpisodeGroup,
  type TMDBEpisodeGroupDetails,
  posterUrl,
  posterUrlOriginal,
  resolveUserApiKeys,
  tmdbFindByImdb,
  tmdbFindByTvdb,
  evictTVSeasonCache,
} from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { buildNoticeDetail, NOTICE_ID_PREFIX } from "@/lib/notice-meta"
import { resolveCatalogRegionWithDefaults } from "@/lib/catalog-handler"
import { isSupportedUiLang, contentLanguageForUiLang } from "@/lib/regions"
import { getScopedUserId, userExists, userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { buildStremioPosterUrl, stremioPosterShape } from "@/lib/stremio-poster-url"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { enrichVideosWithTvdbDetailed } from "@/lib/tvdb"
import { buildVideosFromAnizip, buildVideosFromGroups, buildVideosFromTvdbDetailed, concurrentMap, isSeasonEpisodesComplete } from "@/lib/episode-ordering"
import { groupDetailsEpisodeCount, groupDetailsRegularEpisodeCount, resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { createLogger } from "@/lib/logger"

const log = createLogger("meta")

import { combineAbortSignals } from "@/lib/abort-signal"

const META_TOTAL_BUDGET_MS = 15000

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
  posterShape?: "poster" | "landscape"
  background?: string
  /** Render landscape con logo baked-in (solo titoli landscape, vedi
   *  catalog-handler: NuvioTV non deve sovrapporre il logo separato). */
  landscapePoster?: string
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

function metaResponse(body: { meta: StremioMetaDetail | null }, isPartial = false): Response {
  return Response.json(body, {
    headers: {
      // Stremio Web uses a CDN with long caching: 12h made ordering changes
      // invisible (Re:ZERO: worked on Nuvio/bypass, not on Stremio web).
      // 5 min + a short SWR is enough for performance and lets episodeGroupId
      // changes propagate quickly. The server still invalidates the internal
      // cache on PUT/POST mapping.
      // Partial data (interrupted/truncated seasons): short downstream TTL
      // with no SWR, so 60s is a hard upper stale bound and the retry can
      // actually serve the recovery instead of extended-stale content.
      "Cache-Control": isPartial
        ? "public, max-age=60"
        : "public, max-age=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

const KNOWN_META_TYPES = new Set([
  "movie", "series", "tv", "show", "tvshow", "anime.movie", "anime.series", "anime",
])

// C4: come nei cataloghi — tipo ignoto → null (400) invece di servire
// silenziosamente dati series.
function normalizeMediaType(type: string): "movie" | "series" | null {
  const t = type.toLowerCase()
  if (!KNOWN_META_TYPES.has(t)) return null
  return (t === "movie" || t === "anime.movie") ? "movie" : "series"
}

// Come in catalog-handler.ts: la chiave MDBList resta server-side, mai nel
// poster URL servito a Stremio (M2).
async function pictoriumPosterUrl(
  req: NextRequest,
  type: "movie" | "series",
  id: number,
  configParam?: string | null,
  userParam?: string | null,
  posterLang = "it",
  posterRegion?: string,
): Promise<{ poster: string; posterShape: "poster" | "landscape" }> {
  const scopedUser = getScopedUserId(userParam)
  const serverDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : await getServerDefaultsChecked()
  const userConfig = configParam ? decodeConfig(configParam) : null
  const defaults = userConfig ? { ...serverDefaults, ...userConfig } : serverDefaults
  const mapping = await getById(type === "series" ? "tv" : "movie", id, scopedUser)
  const posterShape = stremioPosterShape(mapping, defaults)
  const poster = buildStremioPosterUrl({
    origin: getOriginFromRequest(req),
    type,
    id,
    defaults,
    mapping,
    lang: posterLang,
    region: posterRegion,
    config: configParam || undefined,
    user: userParam || undefined,
    forceShape: posterShape,
  }).toString()
  return { poster, posterShape }
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
  // Rate-limit per-utente (multi-user): come i cataloghi, il bucket segue il
  // namespace così il flood su `?u=vittima` non brucia la quota altrui.
  const preScopedUser = getScopedUserId(userParam)
  const rl = await rateLimit(preScopedUser ? userRateLimitKey(req, preScopedUser) : rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const cleanId = rawId.replace(/\.json$/, "")
  if (cleanId.length > 80) return metaResponse({ meta: null })

  const stType = normalizeMediaType(mediaType)
  if (!stType) {
    return new Response("Invalid type", {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })
  }
  // Notice cards (Fase 2): id informativo, nessuna risoluzione TMDB/IMDb,
  // nessuna chiamata upstream, nessuna scrittura in cache.
  if (cleanId.startsWith(NOTICE_ID_PREFIX)) {
    return metaResponse({
      meta: buildNoticeDetail({
        id: cleanId,
        type: stType,
        poster: `${getOriginFromRequest(req)}/pictorium.png`,
      }),
    })
  }
  const tmdbMediaType = stType === "movie" ? "movie" : "tv"
  // Single request-wide budget (15s): created BEFORE upstream ID resolution
  // so even very slow /find calls stay under the total cap. It combines the
  // incoming signal (client disconnect) with the internal timeout and fires
  // on whichever comes first. Every phase below (find/details/images/
  // external_ids, episode-group listing/detail, AniZip, TVDB ordering/
  // enrichment, standard seasons) derives from it with per-phase caps via
  // combineAbortSignals.
  const requestSignal = combineAbortSignals(
    (req as { signal?: AbortSignal }).signal ?? null,
    META_TOTAL_BUDGET_MS,
  )
  // Namespace utente (multi-user): null con flag OFF o senza `?u=` → globale.
  // Spazi inventati → anonimo (v1.23.0): niente cache key separate.
  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  // Attività di lettura per il cleanup inattivi (throttled, fire-and-forget).
  if (scopedUser) touchUserActivity(scopedUser)
  // Chiavi effettive (slice 2): esplicite della richiesta > namespace utente
  // (solo con `?u=`) > env d'istanza. Entrano nei cache key (hash) così due
  // namespace non collidono.
  const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = resolvedKeys.tmdb.key
  const mdblistKey = resolvedKeys.mdblist.key
  const tvdbApiKey = resolvedKeys.tvdb.key
  const effectiveDefaults: ServerDefaults = scopedUser
    ? await getServerDefaultsForUser(scopedUser)
    : await getServerDefaultsChecked()
  let userConfig: Partial<PictoriumUserConfig> | null = null

  if (configParam) {
    userConfig = decodeConfig(configParam)
  }
  if (!userConfig) {
    userConfig = effectiveDefaults
  }

  const episodeMetadataSource = userConfig?.episodeMetadataSource || (tvdbApiKey ? "tvdb" : "tmdb")
  const region = resolveCatalogRegionWithDefaults(req, userConfig, effectiveDefaults)
  const requestedLang = req.nextUrl.searchParams.get("lang")?.toLowerCase()
  const posterLang = isSupportedUiLang(requestedLang) ? requestedLang! : region.lang2
  const tmdbLang = contentLanguageForUiLang(posterLang, region.code)

  // Risoluzione ID TMDB e IMDb
  let tmdbId: number | null = null
  let imdbId: string | null = null

  // Fall-open come i cataloghi (metas:[]): senza chiave o con upstream in
  // errore la risoluzione esterna lancia — prima il throw usciva dal try e
  // diventava 500, ora degrada a meta:null (mai cacheato: il return è prima
  // della cache key).
  try {
    if (cleanId.startsWith("tt")) {
      imdbId = cleanId
      tmdbId = await tmdbFindByImdb(cleanId, tmdbMediaType, apiKey, requestSignal)
    } else if (cleanId.startsWith("tmdb:")) {
      const parsed = parseInt(cleanId.slice(5), 10)
      if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
    } else if (cleanId.startsWith("tvdb:")) {
      const tvdbRaw = cleanId.slice(5)
      tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey, requestSignal)
    } else if (cleanId.startsWith("tvdbc:")) {
      const tvdbRaw = cleanId.slice(6)
      tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey, requestSignal)
    } else if (/^\d+$/.test(cleanId)) {
      const parsed = parseInt(cleanId, 10)
      if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
    }
  } catch (error) {
    // debug, non warn: le installazioni senza chiave colpiscono questo ramo
    // a ogni richiesta, un warn per-hit sarebbe log-spam.
    log.debug("Meta ID resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    tmdbId = null
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
    const pre = await getById(tmdbMediaType, tmdbId, scopedUser)
    if (pre) preMappingForCache = { episodeGroupId: pre.episodeGroupId ?? null, updatedAt: pre.updatedAt }
  } catch { /* ignore — fallback a auto */ }
  const egKey = preMappingForCache ? `${preMappingForCache.episodeGroupId ?? "auto"}:${preMappingForCache.updatedAt ?? ""}` : "auto"
  // eo2 = versione ordinamento episodi: il default automatico "Parts" (v2)
  // cambia i videos a parità di mapping — senza frammento, un meta cachato
  // con le stagioni standard resterebbe servito fino a 12h dopo il deploy.
  // Epoch globale + hash server defaults (come nei cataloghi): senza, un
  // cambio default (badge/blur/regione) via PUT restava invisibile nei meta
  // (poster URL stantio) fino a 12h, anche cross-instance dove
  // cacheInvalidate("stremio") non arriva.
  const epoch = await getCatalogEpoch(scopedUser)
  const sdHash = hashFragment(JSON.stringify(effectiveDefaults))
  const freshness = `:e${epoch}:sd${sdHash}`
  const cacheKey = `stremio:meta:${stType}:${cleanId}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${tvdbApiKey ? `:tk${hashFragment(tvdbApiKey)}` : ""}:es${episodeMetadataSource}:eg${hashFragment(egKey)}:r${region.code}:l${posterLang}${stType === "series" ? ":eo2" : ""}${freshness}`
  const cached = await cacheGetShared<{ meta: StremioMetaDetail; __partial?: boolean }>(cacheKey, ["stremio", "meta"])
  // __partial is only an internal signal for the hit HTTP header: never in the JSON.
  if (cached) return metaResponse({ meta: cached.meta }, cached.__partial === true)

  try {
    const details = await getFullDetails(tmdbMediaType, tmdbId, tmdbLang, apiKey, requestSignal)
    if (!details || !details.id) {
      return metaResponse({ meta: null })
    }

    if (!imdbId && details.external_ids?.imdb_id) {
      imdbId = details.external_ids.imdb_id
    }
    if (!imdbId) {
      imdbId = await resolveImdbId(tmdbMediaType, tmdbId, apiKey, 5000, requestSignal)
    }

    const primaryId = imdbId || `tmdb:${tmdbId}`
    const { poster, posterShape } = await pictoriumPosterUrl(req, stType, tmdbId, configParam, userParam, posterLang, region.code)
    // NuvioTV: per i titoli landscape, URL del render con logo baked-in
    // (stesso profilo del poster), inclusi i titoli forzati dal default.
    const landscapePoster = posterShape === "landscape" ? poster : undefined
    const background = details.backdrop_path ? posterUrlOriginal(details.backdrop_path) : undefined

    // Risoluzione Logo
    let logo: string | undefined
    try {
      const images = await getImages(tmdbMediaType, tmdbId, `${posterLang},en,null`, apiKey, requestSignal, 5000)
      if (images?.logos && images.logos.length > 0) {
        // Stessa scala del render poster (lingua → inglese → lingua originale
        // → primo): prima si prendeva il PRIMO logo disponibile appena mancava
        // quello locale, servendo a un utente ebraico un logo giapponese o
        // coreano al posto di quello inglese.
        const langLogo = selectBestLogo(images.logos, posterLang, details.original_language)
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
    let isPartialSeasonData = false

    if (stType === "series") {
      videos = []
      const mapping = await getById("tv", tmdbId, scopedUser)

      // TVDB / AniZip ordering sentinel (shared helper) — supporta tvdb:<seasonType>
      const sentinel = mapping?.episodeGroupId || null
      const isTvdbSentinel = sentinel === "tvdb" || (sentinel?.startsWith("tvdb:") ?? false)
      if (isTvdbSentinel) {
        const seasonType = sentinel === "tvdb" ? "default" : (sentinel!.slice(5) || "default")
        try {
          const orderingSignal = combineAbortSignals(requestSignal, 10000)
          const tvdbOrdered = await buildVideosFromTvdbDetailed(imdbId, tmdbId, primaryId, tvdbApiKey || "", seasonType, apiKey, orderingSignal)
          if (tvdbOrdered.videos.length > 0) videos.push(...(tvdbOrdered.videos as StremioVideo[]))
          // Interrupted TVDB ordering: partials stay servable but with a
          // short TTL, never frozen long-term.
          if (!tvdbOrdered.complete) isPartialSeasonData = true
        } catch (e) {
          log.warn("TVDB ordering failed, fallback to standard", { error: e instanceof Error ? e.message : String(e) })
        }
      } else if (sentinel === "anizip") {
        try {
          const anizipVideos = await buildVideosFromAnizip(tmdbId, primaryId, combineAbortSignals(requestSignal, 8000))
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
        groupDetails = await getTVEpisodeGroup(sentinel!, tmdbLang, apiKey, combineAbortSignals(requestSignal, 8000))
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
              combineAbortSignals(requestSignal, 8000),
            )
            if (autoId) {
              const autoDetails = await getTVEpisodeGroup(autoId, tmdbLang, apiKey, combineAbortSignals(requestSignal, 6000)).catch(() => null)
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
        const seasonSignal = combineAbortSignals(requestSignal, 10000)
        const seasonsData = await concurrentMap(regularSeasons, (s) => getTVSeason(tmdbId, s.season_number!, tmdbLang, apiKey, seasonSignal), 5)

        for (let i = 0; i < regularSeasons.length; i++) {
          const sData = seasonsData[i]
          // Null/missing payloads, unexpectedly empty seasons (episode_count
          // > 0) and short lists mark partial (short TTL + retry); zero-count
          // seasons, future seasons and full-length lists with future episodes
          // stay complete (see helper). Evict partial seasons from the shared
          // 5-minute TMDB cache so the post-TTL retry refetches upstream.
          if (!isSeasonEpisodesComplete(sData, regularSeasons[i]?.episode_count, regularSeasons[i]?.air_date)) {
            isPartialSeasonData = true
            evictTVSeasonCache(tmdbId, regularSeasons[i]!.season_number!)
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

      // Se la fonte metadati episodi è TVDB ed è presente una chiave TVDB, arricchisci con copertine e trame TVDB
      // Skip se già ordinato via TVDB (dati già TVDB nativi) o se i videos
      // seguono un Episode Group: la mappa TVDB è su S:E standard e con le
      // Parti assegnerebbe nome/cover/trama dell'episodio sbagliato.
      const isTvdbOrdering = (mapping?.episodeGroupId === "tvdb" || (mapping?.episodeGroupId?.startsWith("tvdb:") ?? false))
      if (videos.length > 0 && episodeMetadataSource === "tvdb" && tvdbApiKey && !isTvdbOrdering && !videosFromGroup) {
        const enrichSignal = combineAbortSignals(requestSignal, 8000)
        // Interrupted enrichment: TMDB videos stay intact but the meta goes to
        // a short TTL so TVDB covers/synopses are retried.
        const enrichComplete = await enrichVideosWithTvdbDetailed(videos, imdbId, tmdbId, tvdbApiKey, "ita", apiKey, enrichSignal)
        if (!enrichComplete) isPartialSeasonData = true
      }
    }

    const meta: StremioMetaDetail = {
      id: cleanId,
      imdb_id: imdbId || undefined,
      type: stType,
      name: details.title || details.name || "",
      genres: (details.genres || []).map((g) => g.name),
      poster,
      posterShape,
      background,
      landscapePoster,
      // Titoli landscape: il logo è già baked-in nel landscapePoster —
      // esporlo separato farebbe sovrapporre a Nuvio un secondo logo
      // (anche via arricchimento card dal dettaglio).
      logo: posterShape === "landscape" ? undefined : logo,
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
    // Never freeze partial/incomplete season data (upstream timeout or error)
    // for 12h: a short TTL lets the next request retry the missing seasons.
    // __partial only travels in cache for the hit HTTP header, never in JSON.
    if (!isPartialSeasonData) {
      cacheSet(cacheKey, body, ["stremio", "meta"], 12 * 60 * 60 * 1000)
    } else {
      cacheSet(cacheKey, { ...body, __partial: true as const }, ["stremio", "meta"], 60 * 1000)
    }
    return metaResponse(body, isPartialSeasonData)
  } catch (e) {
    log.error("Meta retrieval error", { error: e instanceof Error ? e.message : String(e) })
    return metaResponse({ meta: null })
  }
}
