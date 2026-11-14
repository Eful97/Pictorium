// Preparazione della base del render (fase I della poster route): recupero
// dettagli TV mancanti (avviato prima del resize così il fetch si sovrappone
// alla CPU di sharp), resize/fit della base, chiave di analisi, metadata TV
// del mapping e luminanza alto/basso. Corpo spostato da route.ts invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { CustomRatingConfig, RatingItem } from "@/lib/custom-rating"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { getDetails, type TMDBCompany } from "@/lib/tmdb"
import { getTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { matchTMDBStudios } from "@/lib/awards"
import { TOP_LIGHT_LUMINANCE } from "@/lib/constants"
import { topLuminance, bottomLuminance } from "@/lib/poster-render-helpers"
import { pillarboxLandscapeBase, fitPortraitBase, fitLandscapeBase } from "@/lib/image-utils"
import { customBaseAnalysisKey } from "@/lib/custom-poster-base"
import { isCustomPosterUrl } from "@/lib/utils"
import { createLogger } from "@/lib/logger"
import { POSTER_TMDB_TIMEOUT_MS } from "./constants"
import type { PosterArtwork, PosterTitleMeta } from "./sources"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Valori della richiesta letti dalla preparazione della base. */
export interface RenderBaseContext {
  readonly req: NextRequest
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly mapping: Mapping | null
  readonly canonicalLang: string | null
  readonly posterRegion: RegionDef
  readonly effTmdbKey: string | undefined
  readonly isLandscape: boolean
  readonly customRatingConfig: CustomRatingConfig
  readonly effectiveCustomUrl: string | null
  readonly backdropCustomForFetch: string | null
  readonly backdropFetch: Buffer | null
  readonly renderAbort: AbortController
}

/** Base pronta per il composite + polarità/rating letti dalla preparazione. */
export interface RenderBase {
  posterBuf: Buffer
  analysisKey: string | null
  qBottomLight: string | null
  customRatings: RatingItem[]
  bottomLum: number | null
  topLight: boolean
}

/**
 * Muta `titleMeta` (recupero dettagli TV, metadata TV del mapping) come il
 * blocco originale nella route.
 */
export async function prepareRenderBase(
  ctx: RenderBaseContext,
  baseBuf: Buffer,
  artwork: PosterArtwork,
  titleMeta: PosterTitleMeta,
): Promise<RenderBase> {
  const {
    req, mediaType, tmdbId, mapping, canonicalLang, posterRegion, effTmdbKey, isLandscape,
    customRatingConfig, effectiveCustomUrl, backdropCustomForFetch, backdropFetch, renderAbort,
  } = ctx
  // Details recovery starts BEFORE the sharp resize below so a session-miss
  // fetch overlaps resize CPU instead of extending the critical path after
  // it. The promise is awaited in the luminance Promise.all; outcome and
  // field application are unchanged (the mapping TV metadata assignments
  // below overwrite unconditionally when present, the recovery guards only
  // fill nulls — final values are identical in either order).
  const needsDetailsRecovery = titleMeta.tmdbNetworks.length === 0 && titleMeta.productionCompanies.length === 0
  const detailsRecovery = needsDetailsRecovery
    ? (async () => {
      const apiKey = effTmdbKey
      const preferredLang = canonicalLang || mapping?.language || posterRegion.lang2
      // F6: anche il refetch dei dettagli TV riusa la session cache.
      // Un singolo retry sul fallimento transitorio (cold-start
      // upstream): senza dettagli saltano studio/network badge e il
      // render resta cachato così per tutto il TTL.
      const attempt = () => getDetails(mediaType, tmdbId, preferredLang, apiKey, renderAbort.signal, POSTER_TMDB_TIMEOUT_MS).catch(() => null)
      const details = getTMDBSessionCache(mediaType, tmdbId, preferredLang)?.details
        ?? (await attempt())
        // Hard abort/deadline stops the retry: past the watchdog the caller
        // is already gone and a second full-cap wait only delays the zombie
        // settle (the inflight entry stays held meanwhile). The recovery
        // still settles via the first attempt (abort-fast or cache hit).
        ?? (renderAbort.signal.aborted ? null : await attempt())
      if (!details) return
      if (!titleMeta.releaseDate) titleMeta.releaseDate = details.release_date || null
      if (!titleMeta.firstAirDate) titleMeta.firstAirDate = details.first_air_date || null
      if (!titleMeta.lastAirDate) titleMeta.lastAirDate = details.last_air_date || null
      if (titleMeta.seasonCount == null) titleMeta.seasonCount = details.number_of_seasons ?? null
      if (!titleMeta.nextEpisodeAirDate) titleMeta.nextEpisodeAirDate = details.next_episode_to_air?.air_date || null
      if (titleMeta.numberOfEpisodes == null) titleMeta.numberOfEpisodes = details.number_of_episodes ?? null
      if (titleMeta.originCountries.length === 0) {
        titleMeta.originCountries = [...(details.networks || []), ...(details.production_companies || [])]
          .map((c) => c.origin_country)
          .filter((c): c is string => !!c)
      }
      if (titleMeta.genreIds == null && Array.isArray(details.genres)) {
        titleMeta.genreIds = details.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id))
      }
      if (!titleMeta.tvType) titleMeta.tvType = details.type || null
      if (!titleMeta.tvStatus) titleMeta.tvStatus = details.status || null
      if (details.networks) {
        titleMeta.tmdbNetworks = details.networks.map((n: TMDBCompany) => n.name)
        titleMeta.tmdbNetworksDetailed = details.networks.map((n: TMDBCompany) => ({ name: n.name, logoPath: n.logo_path }))
      }
      if (details.production_companies) {
        titleMeta.productionCompanies = details.production_companies.map((c: TMDBCompany) => c.name)
        titleMeta.productionCompaniesDetailed = details.production_companies.map((c: TMDBCompany) => ({ name: c.name, logoPath: c.logo_path }))
      }
      if (titleMeta.tmdbNetworks.length || titleMeta.productionCompanies.length) titleMeta.tmdbStudios = matchTMDBStudios([...titleMeta.tmdbNetworks, ...titleMeta.productionCompanies])
    })().catch((e: unknown) => { log.error("Details fetch failed", { error: e instanceof Error ? e.message : String(e) }) })
    : null

  // 6. Resize poster + compute luminance
  // Landscape: base = sfondo TMDB ritagliato sul canvas 16:9, oppure
  // pillarbox dal poster quando il titolo non ha sfondi.
  // Portrait: `fitPortraitBase` salta il resize quando la base è già
  // 500×750 (poster TMDB `w500`), evitando l'encode/decode JPEG q80 che il
  // vecchio `sharp(...).resize(...).toBuffer()` pagava anche a geometria
  // invariata (generazione lossy extra rimossa: miglioramento di qualità
  // intenzionale, nessun cambio di geometria).
  const posterBuf = isLandscape
    ? (backdropFetch
        ? await fitLandscapeBase(backdropFetch)
        : await pillarboxLandscapeBase(baseBuf))
    : await fitPortraitBase(baseBuf)
  const qTopLight = req.nextUrl.searchParams.get("tl")
  const qBottomLight = req.nextUrl.searchParams.get("bl")

  // Custom base: hash of the URL, never the URL in the clear (and never
  // the TMDB posterPath, which does not describe the rendered bytes with a
  // custom base). Same effectiveness as the fetch above: effectiveCustomUrl
  // decides in a single place. In landscape the key prefers the effective
  // custom (query or saved) over the nominal backdropPath (with a custom
  // the TMDB path does not describe the bytes).
  const analysisKey = !isLandscape
    ? (effectiveCustomUrl
      ? customBaseAnalysisKey(effectiveCustomUrl)
      : artwork.portraitBackdropCropPath
        ? `portrait:backdropcrop:${artwork.portraitBackdropCropPath}`
        : (artwork.posterPath && !isCustomPosterUrl(artwork.posterPath) ? `portrait:poster:${artwork.posterPath}` : null))
    : backdropFetch
      ? (backdropCustomForFetch
        ? customBaseAnalysisKey(backdropCustomForFetch, "landscape")
        : (artwork.backdropPath ? `landscape:backdrop:${artwork.backdropPath}` : null))
      : (artwork.posterPath ? `landscape:pillarbox:${artwork.posterPath}` : null)

  // Apply mapping TV metadata (synchronous — no race, no side-effects in parallel closures)
  if (mapping?.tvType) titleMeta.tvType = mapping.tvType
  if (mapping?.tvStatus) titleMeta.tvStatus = mapping.tvStatus
  if (mapping?.releaseDate) titleMeta.releaseDate = mapping.releaseDate
  if (mapping?.firstAirDate) titleMeta.firstAirDate = mapping.firstAirDate

  // Luminance + optional TV details fetch (parallel, independent).
  // detailsRecovery was started above (before the sharp resize) so a
  // session-miss fetch overlaps resize CPU; awaited here with the rest.
  const [customRatings, topLum, bottomLum] = await Promise.all([
    customRatingConfig.enabled ? fetchCustomRatings(titleMeta.imdbId, customRatingConfig, renderAbort.signal) : Promise.resolve([]),
    (async (): Promise<number | null> => {
      if (qTopLight === "1" || qTopLight === "0" || qTopLight === "true" || qTopLight === "false") return null
      return await topLuminance(posterBuf, analysisKey)
    })(),
    (async (): Promise<number | null> => {
      if (qBottomLight === "1" || qBottomLight === "0" || qBottomLight === "true" || qBottomLight === "false") return null
      return await bottomLuminance(posterBuf, analysisKey)
    })(),
    detailsRecovery ?? Promise.resolve(),
  ])

  const topLight = (qTopLight === "1" || qTopLight === "true") ? true : (qTopLight === "0" || qTopLight === "false") ? false : (topLum ?? 0.5) > TOP_LIGHT_LUMINANCE

  return { posterBuf, analysisKey, qBottomLight, customRatings, bottomLum, topLight }
}
