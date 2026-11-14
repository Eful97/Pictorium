// Risposta di diagnostica `debug=1` della poster route (fase J): un JSON con
// meta, sorgenti, ranking, qualità, badge calcolati e impostazioni effettive,
// al posto del poster. Solo letture: nessun render, nessuna scrittura cache.
// Corpo spostato da route.ts invariato.

import type { Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { DateFormat } from "@/lib/release-badge"
import type { PosterRenderConfig } from "@/lib/poster-config"
import type { AggregatedRatings } from "@/lib/ratings"
import type { StreamQuality } from "@/lib/quality-tiers"
import type { StreamQualityResult } from "@/lib/stream-quality"
import { directorBadgeLabel, type WikidataResult } from "@/lib/awards"
import { computeTopBadge } from "@/lib/poster-badge"
import { RENDER_VERSION } from "@/lib/render-version"
import { createLogger } from "@/lib/logger"
import type { PosterArtwork, PosterTitleMeta } from "./sources"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Tutto ciò che il JSON di debug espone, già risolto dalla route. */
export interface PosterDebugInput {
  // Identità della richiesta
  readonly tmdbId: number
  readonly mediaType: "movie" | "tv"
  readonly mapping: Mapping | null
  readonly posterRegion: RegionDef
  readonly locale: string
  readonly t: (key: string, params?: Record<string, string | number>) => string
  readonly dateFormat: DateFormat
  readonly isLandscape: boolean
  readonly hardenedParams: URLSearchParams
  // Sorgenti e configurazione risolte
  readonly artwork: PosterArtwork
  readonly titleMeta: PosterTitleMeta
  readonly renderConfig: PosterRenderConfig
  // Esiti del fetch in parallelo
  readonly rankingResult: number | null
  readonly animeRankResult: number | null
  readonly wikidataResult: WikidataResult
  readonly wikidataRaceTimedOut: boolean
  readonly tmdbKeywords: string[]
  readonly imdbTop250: boolean
  readonly aggregated: AggregatedRatings | null
  readonly liveQualityResult: StreamQualityResult
  readonly preJw: boolean | null
  readonly preDigital: string | null
  readonly preReleaseDetected: boolean
  // Valori derivati per il render
  readonly finalRank: number | null
  readonly finalQuality: StreamQuality | null
  readonly qLabel: string | null
  readonly ageLabel: string | null
  readonly ageEphemeral: boolean
  readonly applyPreRelease: boolean
  readonly accentOverride: { genreColor: string; rankColor: string } | null
  readonly topLight: boolean
  readonly bottomLight: boolean
  readonly bottomActive: boolean
  readonly useSeparate: boolean
  readonly effBlurHeight: number
  readonly effBlurFade: number
  // Cache e tempi
  readonly cacheHit: boolean
  readonly cacheStale: boolean
  readonly startTime: number
  readonly tFetchMs: number
}

export function buildPosterDebugJson(input: PosterDebugInput): Record<string, unknown> {
  const {
    tmdbId, mediaType, mapping, posterRegion, locale, t, dateFormat, isLandscape,
    hardenedParams, artwork, titleMeta, rankingResult, animeRankResult, wikidataResult,
    wikidataRaceTimedOut, tmdbKeywords, imdbTop250, aggregated, liveQualityResult, preJw,
    preDigital, preReleaseDetected, finalRank, finalQuality, qLabel, ageLabel, ageEphemeral,
    applyPreRelease, accentOverride, topLight, bottomLight, bottomActive, useSeparate,
    effBlurHeight, effBlurFade, cacheHit, cacheStale, startTime, tFetchMs,
  } = input
  const {
    ageBadge, ageBadgeStyle, ageCountry, badgeFont, badgeGenre, badgeQuality, badgeRating,
    badgeStyle, badgeYear, badgesEnabled, blurDarkness, blurEnabled, blurIntensity,
    disabledContentTags, extraBadgeOffsetX, extraBadgeOffsetY, extraBadgeScale, genreBadgeScale,
    logoOffsetX, logoOffsetY, logoScale, minQuality, networkFixedX, networkFixedY, networkLogo,
    networkLogoFollowTitle, preRelease, queryExtra, rankingBadgeStyle, rankingEnabled,
    sashOrder, separateRatingsStyle, topBadgeOffsetX, topBadgeOffsetY, topBadgeScale, topShade,
    topShadeHeight,
  } = input.renderConfig
  const badgeInput = {
    mediaType: mediaType as "movie" | "tv",
    tmdbId,
    digitalReleaseDate: preDigital ?? null,
    releaseDate: titleMeta.releaseDate ?? null,
    firstAirDate: titleMeta.firstAirDate ?? null,
    lastAirDate: titleMeta.lastAirDate ?? null,
    seasonCount: titleMeta.seasonCount ?? null,
    nextEpisodeAirDate: titleMeta.nextEpisodeAirDate ?? null,
    numberOfEpisodes: titleMeta.numberOfEpisodes ?? null,
    originCountries: [...titleMeta.originCountries],
    genreIds: titleMeta.genreIds ? [...titleMeta.genreIds] : null,
    voteAverage: titleMeta.voteAverage ?? 0,
    trendRank: finalRank,
    animeRank: animeRankResult,
    awards: wikidataResult.awards,
    nominations: wikidataResult.nominations,
    studios: titleMeta.tmdbStudios.length ? [...titleMeta.tmdbStudios] : [...titleMeta.productionCompanies, ...titleMeta.tmdbNetworks],
    director: directorBadgeLabel(wikidataResult.director, t),
    tvType: titleMeta.tvType ?? null,
    tvStatus: titleMeta.tvStatus,
    keywords: [...tmdbKeywords],
    imdbTop250: !!imdbTop250,
    whatsonFeatures: aggregated?.whatsonFeatures ?? null,
    disabledContentTags: disabledContentTags ?? null,
  }
  const badgeComputed = computeTopBadge(badgeInput, t, locale, sashOrder, dateFormat)
  log.info("Debug mode", { mediaType, tmdbId, imdbId: titleMeta.imdbId, imdbTop250: !!imdbTop250, badge: badgeComputed.badge?.label ?? "null", vote: titleMeta.voteAverage, genre: titleMeta.genreName, quality: finalQuality })
  return {
    meta: {
      tmdbId,
      mediaType,
      locale,
      region: posterRegion.code,
      imdbId: titleMeta.imdbId,
      imdbTop250: !!imdbTop250,
      renderVersion: RENDER_VERSION,
      shape: isLandscape ? "landscape" : "poster",
      mappingId: mapping ? `${mediaType}:${tmdbId}` : null,
    },
    images: {
      poster: artwork.posterPath,
      logo: artwork.logoPath,
      backdrop: artwork.backdropPath,
    },
    logoSelection: {
      requestedLang: artwork.posterRequestedLang,
      usedLang: artwork.logoChosenIso,
      fallbackReason: artwork.logoFallbackReason,
    },
    cache: {
      hit: cacheHit,
      stale: cacheStale,
    },
    genre: { name: titleMeta.genreName, year: titleMeta.releaseDate?.slice(0, 4) },
    vote: { average: titleMeta.voteAverage },
    quality: {
      value: finalQuality,
      source: liveQualityResult.source,
      status: liveQualityResult.status,
      rawTokens: liveQualityResult.rawTokens ?? [],
    },
    // Badge età: impostazioni effettive + etichetta risolta (null =
    // nascosto: disabilitato o paese senza dati; mai fallback).
    age: {
      enabled: ageBadge,
      country: ageCountry,
      style: ageBadgeStyle,
      label: ageLabel,
      degraded: ageEphemeral,
    },
    minQuality,
    preRelease: { enabled: preRelease, detected: preReleaseDetected, applied: applyPreRelease, jwAvailable: preJw, digitalDate: preDigital, theatricalDate: titleMeta.releaseDate ?? mapping?.releaseDate ?? null },
    rankings: {
      justwatch: rankingResult,
      anime: animeRankResult,
      finalRank,
      qRank: hardenedParams.get("rank") || null,
      qLabel,
    },
    wikidata: {
      awards: wikidataResult.awards,
      nominations: wikidataResult.nominations,
      studios: wikidataResult.studios,
      director: wikidataResult.director,
      directorLabel: directorBadgeLabel(wikidataResult.director, t),
      degraded: wikidataResult.degraded ?? false,
      timedOut: wikidataRaceTimedOut,
    },
    keywords: [...tmdbKeywords],
    badge: {
      computed: {
        badge: badgeComputed.badge,
        upcomingRelease: badgeComputed.upcomingRelease,
        awardBadge: badgeComputed.awardBadge,
        studioBadge: badgeComputed.studioBadge,
        subGenreBadge: badgeComputed.subGenreBadge,
        extraFallback: badgeComputed.extraFallback,
      },
      settings: {
        badgesEnabled,
        rankingEnabled,
        badgeStyle,
        rankingBadgeStyle,
        badgeFont,
        badgeGenre,
        badgeYear,
        badgeRating,
        badgeQuality,
        ageBadge,
        ageCountry,
        ageBadgeStyle,
        separateRatings: useSeparate,
        separateRatingsStyle,
        bottomActive,
        sashOrder,
        customBadge: queryExtra,
      },
    },
    timings: {
      fetchMs: tFetchMs,
      prepMs: Date.now() - startTime - tFetchMs,
      totalMs: Date.now() - startTime,
    },
    appearance: {
      topLight,
      bottomLight,
      blurEnabled,
      blurHeight: effBlurHeight,
      blurIntensity,
      blurFade: effBlurFade,
      blurDarkness,
      gradientHeight: effBlurHeight,
      topShade,
      topShadeHeight,
      accentColor: accentOverride?.genreColor || null,
    },
    logos: {
      scale: logoScale,
      offsetX: logoOffsetX,
      offsetY: logoOffsetY,
      networkLogo,
      networkLogoFollowTitle,
      networkFixedX: networkFixedX ?? null,
      networkFixedY: networkFixedY ?? null,
    },
    topBadge: {
      scale: topBadgeScale,
      offsetX: topBadgeOffsetX,
      offsetY: topBadgeOffsetY,
    },
    extraBadge: {
      scale: extraBadgeScale ?? null,
      offsetX: extraBadgeOffsetX ?? null,
      offsetY: extraBadgeOffsetY ?? null,
    },
    genreBadge: {
      scale: genreBadgeScale,
    },
  }
}
