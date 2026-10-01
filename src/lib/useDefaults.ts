"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { BadgeStyle, RankingBadgeStyle } from "./badge-styles"
import type { NetworkLogoPosition, PosterShape } from "./types"
import { isNetworkLogoPosition, isPosterShape } from "./types"
import type { LandscapeServerDefaults } from "./server-defaults"
import { parseDateFormat, type DateFormat } from "./release-badge"
import { normalizeRegion } from "./regions"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { userFetch } from "./http"
import { USER_UNLOCK_EVENT, currentPathUuid } from "./user-token"
import { t } from "./i18n"
import { normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import { DEFAULT_QUALITY_BADGE_STYLE, type QualityBadgeStyle } from "./badge-styles"
import { KNOWN_VIDEO_FORMATS, isVideoFormat, type VideoFormat } from "./av-specs"

export type RibbonSide = "left" | "right"

export interface DefaultsState {
  defaultBadgeStyle: BadgeStyle
  defaultRankingBadgeStyle: RankingBadgeStyle
  /** Stile icone del badge qualità di default (default "standard"). */
  defaultQualityBadgeStyle: QualityBadgeStyle
  /** Formati A/V abilitati di default (dv, atmos, imax, hdr, hdr10plus). */
  defaultVideoFormats: VideoFormat[]
  defaultBlurEnabled: boolean
  defaultBlurIntensity: number
  defaultBlurFade: number
  defaultBlurDarkness: number
  /** Intensità tinta di scena di default 0-100 (default 20). */
  defaultTintStrength: number
  /** Ombra lineare superiore di default 0-100 (default 50). */
  defaultTopShade: number
  defaultGradientHeight: number
  defaultTopBadgeScale: number
  defaultTopBadgeOffsetX: number
  defaultTopBadgeOffsetY: number
  defaultGenreBadgeScale: number
  defaultQualityBadgeScale: number
  defaultNetworkLogoScale: number
  defaultGenreBadgeOffsetX: number
  defaultGenreBadgeOffsetY: number
  defaultQualityBadgeOffsetX: number
  defaultQualityBadgeOffsetY: number
  defaultNetworkLogoOffsetX: number
  defaultNetworkLogoOffsetY: number
  defaultGlobalBadges: boolean
  defaultRankingBadges: boolean
  /** Componenti del badge genere/rating di default (default tutti ON). */
  defaultBadgeGenre: boolean
  defaultBadgeYear: boolean
  defaultBadgeRating: boolean
  defaultBadgeQuality: boolean
  /** Riga rating custom provider di default (default ON). */
  defaultCustomRatings: boolean
  /** Endpoint provider custom rating salvato via UI (non-segreto). */
  defaultCustomRatingEndpoint?: string
  /** Header chiave provider salvato via UI. */
  defaultCustomRatingApiKeyHeader?: string
  defaultRatingSources: string[]
  /** Colonna rating separati di default (default OFF). */
  defaultSeparateRatings: boolean
  /** Bucket sash abilitati (ordine canonico; vuota = tutto spento). */
  defaultSashOrder: SashBucket[]
  defaultAutoRotateClean: boolean
  /** Rotazione 24h di default per formato (sdoppiata). */
  defaultAutoRotateBackdrop: boolean
  /** Disattiva i poster clean TMDB nella selezione automatica (default OFF = priorità ai clean). */
  defaultDisableCleanPosters: boolean
  /** Best-fit automatico per formato (sdoppiato da defaultLogoFitEnabled). */
  defaultPortraitFitEnabled: boolean
  defaultLandscapeFitEnabled: boolean
  defaultNetworkLogo: boolean
  /** Posizione del logo network di default ("auto" = specchio dinamico, "top" = angolo alto lato nastro). */
  defaultNetworkLogoPosition: NetworkLogoPosition
  defaultPreRelease: boolean
  defaultRibbonSide: RibbonSide
  /** Nastro stile Netflix all'angolo di default (false = badge classifica centrato). */
  defaultRibbonEnabled: boolean
  /** Formato canvas di default (portrait = verticale standard). */
  defaultPosterShape: PosterShape
  /** Allineamento blocco logo/metadati di default (null = default di formato). */
  defaultLogoAlign: "left" | "center" | null
  defaultEpisodeMetadataSource: "tmdb" | "tvdb"
  /** Regione classifiche (codice JW canonico, es. "IT"). */
  defaultRegion: string
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  defaultDateFormat: DateFormat
  region: string
  globalBadges: boolean
  rankingBadges: boolean
  /** Componenti del badge genere/rating (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality: boolean
  /** Riga rating custom provider (default ON). */
  customRatings: boolean
  ratingSources: string[]
  /** Colonna rating separati a destra (default OFF). */
  separateRatings: boolean
  networkLogo: boolean
  /** Posizione del logo network del poster in editing. */
  networkLogoPosition: NetworkLogoPosition
  preRelease: boolean
  ribbonSide: RibbonSide
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). */
  ribbonEnabled: boolean
  /** Allineamento blocco logo/metadati del poster in editing. */
  logoAlign: "left" | "center"
  /** Formato canvas del poster in editing (default: defaultPosterShape). */
  posterShape: PosterShape
  episodeMetadataSource: "tmdb" | "tvdb"
  gradientHeight: number
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  genreBadgeScale: number
  qualityBadgeScale: number
  networkLogoScale: number
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  networkLogoOffsetX: number
  networkLogoOffsetY: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  blurEnabled: boolean
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength: number
  /**
   * Ombra lineare superiore 0-100 in editing (solo per-titolo, default 0 =
   * spenta). Nessun default globale in Fase 1: parte sempre da 0 e si carica
   * dal mapping all'apertura titolo.
   */
  topShade: number
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Stile icone del badge qualità del poster in editing. */
  qualityBadgeStyle: QualityBadgeStyle
  /** Formati A/V del poster in editing (null = segui default / spec locale). */
  videoFormats: VideoFormat[] | null
  /** Scala % logo di default (null = auto-fit per aspect, storico). */
  defaultLogoScale: number | null
  /** Offset px logo di default (null = 0). */
  defaultLogoOffsetX: number | null
  defaultLogoOffsetY: number | null
  /**
   * Profilo default landscape (sezione Impostazioni · Orizzontale): chiavi
   * assenti seguono i flat (portrait). Sempre oggetto (mai null) per
   * patch parziali semplici.
   */
  landscape: LandscapeServerDefaults
}

const DEFAULTS: DefaultsState = {
  defaultBadgeStyle: "shadow",
  defaultRankingBadgeStyle: "default",
  defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
  defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
  defaultBlurEnabled: true,
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultTopShade: 50,
  defaultGradientHeight: 30,
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultQualityBadgeScale: 100,
  defaultNetworkLogoScale: 100,
  defaultGenreBadgeOffsetX: 0,
  defaultGenreBadgeOffsetY: 0,
  defaultQualityBadgeOffsetX: 0,
  defaultQualityBadgeOffsetY: 0,
  defaultNetworkLogoOffsetX: 0,
  defaultNetworkLogoOffsetY: 0,
  defaultGlobalBadges: true,
  defaultRankingBadges: true,
  defaultBadgeGenre: true,
  defaultBadgeYear: true,
  defaultBadgeRating: true,
  defaultBadgeQuality: true,
  defaultCustomRatings: true,
  defaultRatingSources: ["imdb", "tmdb"],
  defaultSeparateRatings: false,
  defaultSashOrder: [...DEFAULT_SASH_ORDER],
  defaultAutoRotateClean: false,
  defaultAutoRotateBackdrop: false,
  defaultDisableCleanPosters: false,
  defaultPortraitFitEnabled: true,
  defaultLandscapeFitEnabled: true,
  defaultNetworkLogo: true,
  defaultNetworkLogoPosition: "auto",
  defaultPreRelease: false,
  defaultRibbonSide: "left",
  defaultRibbonEnabled: true,
  defaultPosterShape: "poster",
  defaultLogoAlign: null,
  defaultEpisodeMetadataSource: "tmdb",
  defaultDateFormat: "locale",
  defaultRegion: "IT",
  region: "IT",
  globalBadges: true,
  rankingBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeQuality: true,
  customRatings: true,
  ratingSources: ["imdb", "tmdb"],
  separateRatings: false,
  networkLogo: true,
  networkLogoPosition: "auto",
  preRelease: false,
  ribbonSide: "left",
  ribbonEnabled: true,
  posterShape: "poster",
  logoAlign: "center",
  episodeMetadataSource: "tmdb",
  gradientHeight: 30,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  blurEnabled: true,
  tintStrength: 20,
  topShade: 50,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  qualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
  videoFormats: null,
  defaultLogoScale: null,
  defaultLogoOffsetX: null,
  defaultLogoOffsetY: null,
  landscape: {},
}

interface StoredDefaults {
  videoFormats?: VideoFormat[] | null
  defaultVideoFormats?: VideoFormat[] | null
  globalBadges?: boolean
  rankingBadges?: boolean
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  customRatings?: boolean
  networkLogo?: boolean
  gradientHeight?: number
  topBadgeScale?: number
  topBadgeOffsetX?: number
  topBadgeOffsetY?: number
  genreBadgeScale?: number
  qualityBadgeScale?: number
  networkLogoScale?: number
  genreBadgeOffsetX?: number
  genreBadgeOffsetY?: number
  qualityBadgeOffsetX?: number
  qualityBadgeOffsetY?: number
  networkLogoOffsetX?: number
  networkLogoOffsetY?: number
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  blurEnabled?: boolean
  tintStrength?: number
  topShade?: number
  badgeStyle?: BadgeStyle
  rankingBadgeStyle?: RankingBadgeStyle
  qualityBadgeStyle?: QualityBadgeStyle
  defaultBadgeStyle?: BadgeStyle
  defaultRankingBadgeStyle?: RankingBadgeStyle
  defaultQualityBadgeStyle?: QualityBadgeStyle
  defaultBlurEnabled?: boolean
  defaultBlurIntensity?: number
  defaultBlurFade?: number
  defaultBlurDarkness?: number
  defaultTintStrength?: number
  defaultTopShade?: number
  defaultGradientHeight?: number
  defaultTopBadgeScale?: number
  defaultTopBadgeOffsetX?: number
  defaultTopBadgeOffsetY?: number
  defaultGenreBadgeScale?: number
  defaultQualityBadgeScale?: number
  defaultNetworkLogoScale?: number
  defaultGenreBadgeOffsetX?: number
  defaultGenreBadgeOffsetY?: number
  defaultQualityBadgeOffsetX?: number
  defaultQualityBadgeOffsetY?: number
  defaultNetworkLogoOffsetX?: number
  defaultNetworkLogoOffsetY?: number
  defaultGlobalBadges?: boolean
  defaultRankingBadges?: boolean
  defaultBadgeGenre?: boolean
  defaultBadgeYear?: boolean
  defaultBadgeRating?: boolean
  defaultBadgeQuality?: boolean
  defaultCustomRatings?: boolean
  defaultCustomRatingEndpoint?: string
  defaultCustomRatingApiKeyHeader?: string
  customRatingEndpoint?: string
  customRatingApiKeyHeader?: string
  defaultRatingSources?: string[]
  ratingSources?: string[]
  defaultSeparateRatings?: boolean
  separateRatings?: boolean
  /** Bucket sash abilitati (grezzi; normalizzati in buildFromStored). */
  defaultSashOrder?: string[]
  defaultAutoRotateClean?: boolean
  defaultAutoRotateBackdrop?: boolean
  defaultDisableCleanPosters?: boolean
  /** Chiave flat server (ServerDefaults.disableCleanPosters): fallback di lettura. */
  disableCleanPosters?: boolean
  defaultPortraitFitEnabled?: boolean
  defaultLandscapeFitEnabled?: boolean
  /** Deprecato (migrazione): il flag unico alimenta entrambi i formati. */
  defaultLogoFitEnabled?: boolean
  defaultNetworkLogo?: boolean
  defaultNetworkLogoPosition?: NetworkLogoPosition
  networkLogoPosition?: NetworkLogoPosition
  defaultPreRelease?: boolean
  preRelease?: boolean
  defaultRibbonSide?: RibbonSide
  ribbonSide?: RibbonSide
  defaultRibbonEnabled?: boolean
  ribbonEnabled?: boolean
  defaultPosterShape?: PosterShape
  posterShape?: PosterShape
  /** null/assente = default di formato (mai spazzatura dallo storage). */
  defaultLogoAlign?: "left" | "center" | null
  logoAlign?: "left" | "center"
  defaultEpisodeMetadataSource?: "tmdb" | "tvdb"
  episodeMetadataSource?: "tmdb" | "tvdb"
  defaultDateFormat?: DateFormat
  defaultRegion?: string
  region?: string
  autoRotateClean?: boolean
  /** Scala % logo di default (numero o null = auto-fit; mai spazzatura).
   *  Legge entrambe le chiavi (flat da saveDefaults/auto-persist, prefixed
   *  legacy), come gli altri default numerici. */
  defaultLogoScale?: number | null
  defaultLogoOffsetX?: number | null
  defaultLogoOffsetY?: number | null
  /** Chiavi flat (scritte da saveDefaults/auto-persist): fallback di lettura. */
  logoScale?: number | null
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  /** Profilo default landscape (grezzo dallo storage/server, mai validato qui). */
  landscape?: Record<string, unknown> | null
}

function readStoredDefaults(): StoredDefaults | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(defaultsStorageKey())
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[defaults] Failed to read local defaults: ${message}`)
    return null
  }
}

/**
 * Chiave localStorage dei default: namespaced per UUID sui path `/u/<uuid>`
 * (niente inquinamento tra profili sullo stesso browser), globale altrove.
 * Lo uuid è fisso per mount (il cambio path rimonta), quindi stabile dentro
 * ogni effect che la usa.
 */
export function defaultsStorageKey(): string {
  const uuid = currentPathUuid()
  return uuid ? `badgeDefaults:${uuid}` : "badgeDefaults"
}

function safeSetItem(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* localStorage non disponibile */ }
}

function buildFromStored(d: StoredDefaults | null): DefaultsState {
  if (!d) return { ...DEFAULTS }
  // Lo storage è JSON non validato: solo shape noti, mai spazzatura.
  const storedDefaultShape = isPosterShape(d.defaultPosterShape)
    ? d.defaultPosterShape
    : (isPosterShape(d.posterShape) ? d.posterShape : undefined)
  const storedShape = isPosterShape(d.posterShape)
    ? d.posterShape
    : (isPosterShape(d.defaultPosterShape) ? d.defaultPosterShape : undefined)
  return {
    defaultBadgeStyle: d.defaultBadgeStyle ?? d.badgeStyle ?? "shadow",
    defaultRankingBadgeStyle: d.defaultRankingBadgeStyle ?? d.rankingBadgeStyle ?? "default",
    defaultQualityBadgeStyle: d.defaultQualityBadgeStyle ?? d.qualityBadgeStyle ?? DEFAULT_QUALITY_BADGE_STYLE,
    defaultVideoFormats: Array.isArray(d.defaultVideoFormats)
      ? d.defaultVideoFormats.filter(isVideoFormat)
      : (Array.isArray(d.videoFormats) ? d.videoFormats.filter(isVideoFormat) : [...KNOWN_VIDEO_FORMATS]),
    defaultBlurEnabled: d.defaultBlurEnabled ?? d.blurEnabled ?? true,
    defaultBlurIntensity: d.defaultBlurIntensity ?? d.blurIntensity ?? 20,
    defaultBlurFade: d.defaultBlurFade ?? d.blurFade ?? 50,
    defaultBlurDarkness: d.defaultBlurDarkness ?? d.blurDarkness ?? 30,
    defaultTintStrength: d.defaultTintStrength ?? d.tintStrength ?? 20,
    defaultTopShade: d.defaultTopShade ?? d.topShade ?? 50,
    defaultGradientHeight: d.defaultGradientHeight ?? d.gradientHeight ?? 30,
    defaultTopBadgeScale: d.defaultTopBadgeScale ?? d.topBadgeScale ?? 100,
    defaultTopBadgeOffsetX: d.defaultTopBadgeOffsetX ?? d.topBadgeOffsetX ?? 0,
    defaultTopBadgeOffsetY: d.defaultTopBadgeOffsetY ?? d.topBadgeOffsetY ?? 0,
    defaultGenreBadgeScale: d.defaultGenreBadgeScale ?? d.genreBadgeScale ?? 100,
    defaultQualityBadgeScale: d.defaultQualityBadgeScale ?? d.qualityBadgeScale ?? 100,
    defaultNetworkLogoScale: d.defaultNetworkLogoScale ?? d.networkLogoScale ?? 100,
    defaultGenreBadgeOffsetX: d.defaultGenreBadgeOffsetX ?? d.genreBadgeOffsetX ?? 0,
    defaultGenreBadgeOffsetY: d.defaultGenreBadgeOffsetY ?? d.genreBadgeOffsetY ?? 0,
    defaultQualityBadgeOffsetX: d.defaultQualityBadgeOffsetX ?? d.qualityBadgeOffsetX ?? 0,
    defaultQualityBadgeOffsetY: d.defaultQualityBadgeOffsetY ?? d.qualityBadgeOffsetY ?? 0,
    defaultNetworkLogoOffsetX: d.defaultNetworkLogoOffsetX ?? d.networkLogoOffsetX ?? 0,
    defaultNetworkLogoOffsetY: d.defaultNetworkLogoOffsetY ?? d.networkLogoOffsetY ?? 0,
    defaultGlobalBadges: d.defaultGlobalBadges ?? d.globalBadges ?? true,
    defaultRankingBadges: d.defaultRankingBadges ?? d.rankingBadges ?? true,
    defaultBadgeGenre: d.defaultBadgeGenre ?? d.badgeGenre ?? true,
    defaultBadgeYear: d.defaultBadgeYear ?? d.badgeYear ?? true,
    defaultBadgeRating: d.defaultBadgeRating ?? d.badgeRating ?? true,
    defaultBadgeQuality: d.defaultBadgeQuality ?? d.badgeQuality ?? true,
    defaultCustomRatings: d.defaultCustomRatings ?? d.customRatings ?? true,
    defaultCustomRatingEndpoint: d.defaultCustomRatingEndpoint ?? d.customRatingEndpoint,
    defaultCustomRatingApiKeyHeader: d.defaultCustomRatingApiKeyHeader ?? d.customRatingApiKeyHeader,
    defaultRatingSources: d.defaultRatingSources ?? d.ratingSources ?? ["imdb", "tmdb"],
    defaultSeparateRatings: d.defaultSeparateRatings ?? d.separateRatings ?? false,
    defaultSashOrder: normalizeSashOrder(d.defaultSashOrder) ?? [...DEFAULT_SASH_ORDER],
    defaultAutoRotateClean: d.defaultAutoRotateClean ?? d.autoRotateClean ?? false,
    defaultAutoRotateBackdrop: d.defaultAutoRotateBackdrop ?? false,
    defaultDisableCleanPosters: d.defaultDisableCleanPosters ?? d.disableCleanPosters ?? false,
    // Migrazione: il vecchio flag unico alimenta entrambi i formati.
    defaultPortraitFitEnabled: d.defaultPortraitFitEnabled ?? d.defaultLogoFitEnabled ?? true,
    defaultLandscapeFitEnabled: d.defaultLandscapeFitEnabled ?? d.defaultLogoFitEnabled ?? true,
    defaultNetworkLogo: d.defaultNetworkLogo ?? d.networkLogo ?? true,
    defaultNetworkLogoPosition: isNetworkLogoPosition(d.defaultNetworkLogoPosition)
      ? d.defaultNetworkLogoPosition
      : (isNetworkLogoPosition(d.networkLogoPosition) ? d.networkLogoPosition : "auto"),
    defaultPreRelease: d.defaultPreRelease ?? d.preRelease ?? false,
    defaultRibbonSide: d.defaultRibbonSide ?? d.ribbonSide ?? "left",
    defaultRibbonEnabled: d.defaultRibbonEnabled ?? d.ribbonEnabled ?? true,
    defaultPosterShape: storedDefaultShape ?? "poster",
    defaultLogoAlign: d.defaultLogoAlign === "left" || d.defaultLogoAlign === "center" ? d.defaultLogoAlign : null,
    defaultEpisodeMetadataSource: d.defaultEpisodeMetadataSource ?? d.episodeMetadataSource ?? "tmdb",
    defaultDateFormat: parseDateFormat(d.defaultDateFormat) ?? "locale",
    defaultRegion: normalizeRegion(d.defaultRegion ?? d.region),
    region: normalizeRegion(d.region ?? d.defaultRegion),
    globalBadges: d.globalBadges ?? d.defaultGlobalBadges ?? true,
    rankingBadges: d.rankingBadges ?? d.defaultRankingBadges ?? true,
    badgeGenre: d.badgeGenre ?? d.defaultBadgeGenre ?? true,
    badgeYear: d.badgeYear ?? d.defaultBadgeYear ?? true,
    badgeRating: d.badgeRating ?? d.defaultBadgeRating ?? true,
    badgeQuality: d.badgeQuality ?? d.defaultBadgeQuality ?? true,
    customRatings: d.customRatings ?? d.defaultCustomRatings ?? true,
    ratingSources: d.ratingSources ?? d.defaultRatingSources ?? ["imdb", "tmdb"],
    separateRatings: d.separateRatings ?? d.defaultSeparateRatings ?? false,
    networkLogo: d.networkLogo ?? d.defaultNetworkLogo ?? true,
    networkLogoPosition: isNetworkLogoPosition(d.networkLogoPosition)
      ? d.networkLogoPosition
      : (isNetworkLogoPosition(d.defaultNetworkLogoPosition) ? d.defaultNetworkLogoPosition : "auto"),
    preRelease: d.preRelease ?? d.defaultPreRelease ?? false,
    ribbonSide: d.ribbonSide ?? d.defaultRibbonSide ?? "left",
    ribbonEnabled: d.ribbonEnabled ?? d.defaultRibbonEnabled ?? true,
    posterShape: storedShape ?? "poster",
    logoAlign: d.logoAlign === "left" || d.logoAlign === "center"
      ? d.logoAlign
      : (storedShape === "landscape" ? "left" : "center"),
    episodeMetadataSource: d.episodeMetadataSource ?? d.defaultEpisodeMetadataSource ?? "tmdb",
    gradientHeight: d.gradientHeight ?? d.defaultGradientHeight ?? 30,
    topBadgeScale: d.topBadgeScale ?? d.defaultTopBadgeScale ?? 100,
    topBadgeOffsetX: d.topBadgeOffsetX ?? d.defaultTopBadgeOffsetX ?? 0,
    topBadgeOffsetY: d.topBadgeOffsetY ?? d.defaultTopBadgeOffsetY ?? 0,
    genreBadgeScale: d.genreBadgeScale ?? d.defaultGenreBadgeScale ?? 100,
    qualityBadgeScale: d.qualityBadgeScale ?? d.defaultQualityBadgeScale ?? 100,
    networkLogoScale: d.networkLogoScale ?? d.defaultNetworkLogoScale ?? 100,
    genreBadgeOffsetX: d.genreBadgeOffsetX ?? d.defaultGenreBadgeOffsetX ?? 0,
    genreBadgeOffsetY: d.genreBadgeOffsetY ?? d.defaultGenreBadgeOffsetY ?? 0,
    qualityBadgeOffsetX: d.qualityBadgeOffsetX ?? d.defaultQualityBadgeOffsetX ?? 0,
    qualityBadgeOffsetY: d.qualityBadgeOffsetY ?? d.defaultQualityBadgeOffsetY ?? 0,
    networkLogoOffsetX: d.networkLogoOffsetX ?? d.defaultNetworkLogoOffsetX ?? 0,
    networkLogoOffsetY: d.networkLogoOffsetY ?? d.defaultNetworkLogoOffsetY ?? 0,
    blurIntensity: d.blurIntensity ?? d.defaultBlurIntensity ?? 20,
    blurFade: d.blurFade ?? d.defaultBlurFade ?? 50,
    blurDarkness: d.blurDarkness ?? d.defaultBlurDarkness ?? 30,
    blurEnabled: d.blurEnabled ?? d.defaultBlurEnabled ?? true,
    tintStrength: d.tintStrength ?? d.defaultTintStrength ?? 20,
    // Solo per-titolo nel localStorage (dal mapping): il default globale vive
    // in defaultTopShade — qui si segue lo stesso per coerenza coi correnti.
    topShade: d.topShade ?? d.defaultTopShade ?? 50,
    badgeStyle: d.badgeStyle ?? d.defaultBadgeStyle ?? "shadow",
    rankingBadgeStyle: d.rankingBadgeStyle ?? d.defaultRankingBadgeStyle ?? "default",
    qualityBadgeStyle: d.qualityBadgeStyle ?? d.defaultQualityBadgeStyle ?? DEFAULT_QUALITY_BADGE_STYLE,
    videoFormats: Array.isArray(d.videoFormats) ? d.videoFormats.filter(isVideoFormat) : null,
    defaultLogoScale: typeof d.defaultLogoScale === "number" ? d.defaultLogoScale : (typeof d.logoScale === "number" ? d.logoScale : null),
    defaultLogoOffsetX: typeof d.defaultLogoOffsetX === "number" ? d.defaultLogoOffsetX : (typeof d.logoOffsetX === "number" ? d.logoOffsetX : null),
    defaultLogoOffsetY: typeof d.defaultLogoOffsetY === "number" ? d.defaultLogoOffsetY : (typeof d.logoOffsetY === "number" ? d.logoOffsetY : null),
    // Profilo landscape: solo plain object (mai array/null dallo storage);
    // la validazione vera avviene sul server al sync (PUT).
    landscape: (d.landscape !== null && typeof d.landscape === "object" && !Array.isArray(d.landscape))
      ? (d.landscape as LandscapeServerDefaults)
      : {},
  }
}

/**
 * Payload dei SOLI default persistiti — allineato allo schema server
 * (`defaultsSchema` in `/api/defaults`) e allo shape scritto da `saveDefaults`.
 * Non include i valori "corrente" (globalBadges, badgeStyle…) che dipendono
 * dal poster in editing.
 */
function defaultsToPayload(d: DefaultsState): Record<string, unknown> {
  return {
    badgeStyle: d.defaultBadgeStyle,
    rankingBadgeStyle: d.defaultRankingBadgeStyle,
    qualityBadgeStyle: d.defaultQualityBadgeStyle,
    blurEnabled: d.defaultBlurEnabled,
    blurIntensity: d.defaultBlurIntensity,
    blurFade: d.defaultBlurFade,
    blurDarkness: d.defaultBlurDarkness,
    tintStrength: d.defaultTintStrength,
    topShade: d.defaultTopShade,
    gradientHeight: d.defaultGradientHeight,
    topBadgeScale: d.defaultTopBadgeScale,
    topBadgeOffsetX: d.defaultTopBadgeOffsetX,
    topBadgeOffsetY: d.defaultTopBadgeOffsetY,
    genreBadgeScale: d.defaultGenreBadgeScale,
    qualityBadgeScale: d.defaultQualityBadgeScale,
    networkLogoScale: d.defaultNetworkLogoScale,
    genreBadgeOffsetX: d.defaultGenreBadgeOffsetX,
    genreBadgeOffsetY: d.defaultGenreBadgeOffsetY,
    qualityBadgeOffsetX: d.defaultQualityBadgeOffsetX,
    qualityBadgeOffsetY: d.defaultQualityBadgeOffsetY,
    networkLogoOffsetX: d.defaultNetworkLogoOffsetX,
    networkLogoOffsetY: d.defaultNetworkLogoOffsetY,
    globalBadges: d.defaultGlobalBadges,
    rankingBadges: d.defaultRankingBadges,
    badgeGenre: d.defaultBadgeGenre,
    badgeYear: d.defaultBadgeYear,
    badgeRating: d.defaultBadgeRating,
    badgeQuality: d.defaultBadgeQuality,
    customRatings: d.defaultCustomRatings,
    customRatingEndpoint: d.defaultCustomRatingEndpoint ?? "",
    customRatingApiKeyHeader: d.defaultCustomRatingApiKeyHeader ?? "",
    ratingSources: d.defaultRatingSources,
    separateRatings: d.defaultSeparateRatings,
    sashOrder: d.defaultSashOrder,
    autoRotateClean: d.defaultAutoRotateClean,
    defaultAutoRotateBackdrop: d.defaultAutoRotateBackdrop,
    disableCleanPosters: d.defaultDisableCleanPosters,
    defaultPortraitFitEnabled: d.defaultPortraitFitEnabled,
    defaultLandscapeFitEnabled: d.defaultLandscapeFitEnabled,
    networkLogo: d.defaultNetworkLogo,
    networkLogoPosition: d.defaultNetworkLogoPosition,
    preRelease: d.defaultPreRelease,
    ribbonSide: d.defaultRibbonSide,
    ribbonEnabled: d.defaultRibbonEnabled,
    posterShape: d.defaultPosterShape,
    logoAlign: d.defaultLogoAlign,
    episodeMetadataSource: d.defaultEpisodeMetadataSource,
    region: d.defaultRegion,
    dateFormat: d.defaultDateFormat,
    videoFormats: d.defaultVideoFormats,
    logoScale: d.defaultLogoScale ?? null,
    logoOffsetX: d.defaultLogoOffsetX ?? null,
    logoOffsetY: d.defaultLogoOffsetY ?? null,
    landscape: d.landscape,
  }
}

export function useDefaults() {
  // Stato iniziale deterministico (DEFAULTS): la lettura di localStorage è rimandata
  // al mount via useEffect. Durante la SSR `window` non esiste (readStoredDefaults
  // torna null) quindi l'HTML server usa i default; leggere lo storage nell'initializer
  // di useState avrebbe prodotto un hydration mismatch con l'HTML renderizzato dal server.
  const [state, setState] = useState<DefaultsState>(() => ({ ...DEFAULTS }))

  // Gate anti-clobber: l'effect di auto-persist sotto gira nello stesso commit
  // del caricamento con `state` ancora ai factory — senza gate sovrascriverebbe
  // localStorage (e poi il server via PUT) con i factory. In dev StrictMode
  // rimonta due volte e il secondo mount leggeva lo storage già avvelenato,
  // consolidando i factory al rientro ("le impostazioni non si salvano").
  // Il gate resta chiuso finché il load non conferma l'idratazione.
  const [hydrated, setHydrated] = useState(false)

  // Ref di dedup per l'auto-persist: primato durante l'hydration con il payload appena
  // caricato, così il primo run dell'effetto di sync trova payload identico e non scrive.
  const lastPersistRef = useRef<string>("")

  // Refresh defaults dal server (namespace via userFetch su /u/<uuid>).
  // Estratto per riuso post-unlock: la prima fetch può aver girato senza
  // token (race col #key=) e il merge server→locale va rifatto a sblocco.
  const refreshFromServer = useCallback(() => {
    userFetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((serverData) => {
        if (!serverData) return
        const currentStored = readStoredDefaults()
        const merged: StoredDefaults = {
          ...(serverData || {}),
          ...(currentStored || {}),
        }
        if (!currentStored?.episodeMetadataSource && !currentStored?.defaultEpisodeMetadataSource && serverData.episodeMetadataSource) {
          merged.defaultEpisodeMetadataSource = serverData.episodeMetadataSource
          merged.episodeMetadataSource = serverData.episodeMetadataSource
        }
        if (!currentStored?.ratingSources && !currentStored?.defaultRatingSources && Array.isArray(serverData.ratingSources)) {
          merged.defaultRatingSources = serverData.ratingSources
          merged.ratingSources = serverData.ratingSources
        }
        if (!currentStored?.defaultSashOrder && Array.isArray(serverData.sashOrder)) {
          merged.defaultSashOrder = serverData.sashOrder
        }
        if (!currentStored?.defaultVideoFormats && Array.isArray(serverData.videoFormats)) {
          merged.defaultVideoFormats = serverData.videoFormats
        }
        const updated = buildFromStored(merged)
        setState(updated)
        lastPersistRef.current = JSON.stringify(defaultsToPayload(updated))
        safeSetItem(defaultsStorageKey(), JSON.stringify(defaultsToPayload(updated)))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const stored = readStoredDefaults()
    const hydratedState = buildFromStored(stored)
    setState(hydratedState)
    lastPersistRef.current = JSON.stringify(defaultsToPayload(hydratedState))
    setHydrated(true)

    refreshFromServer()
  }, [refreshFromServer])

  // Post-unlock: ricarica i defaults del namespace senza refresh pagina.
  useEffect(() => {
    const onUnlock = () => refreshFromServer()
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [refreshFromServer])

  // Auto-persist: ogni cambio dei default scrive SUBITO su localStorage
  // e tenta il sync server (/api/defaults). Dedup via payload string — se cambiano
  // solo i valori "corrente" il payload resta identico e non viene riscritta.
  // Il gate `hydrated` blocca il run del primo commit (state ancora factory).
  useEffect(() => {
    if (!hydrated) return
    const payload = defaultsToPayload(state)
    const payloadStr = JSON.stringify(payload)
    if (lastPersistRef.current === payloadStr) return
    lastPersistRef.current = payloadStr

    // Scrittura immediata e sincrona in localStorage ad ogni cambio
    safeSetItem(defaultsStorageKey(), payloadStr)

    const timer = setTimeout(() => {
      // Guest guard: ospite da link altrui senza sessione su istanza con PIN
      // → resta tutto locale, mai sovrascrivere i default del proprietario
      // (es. cambio lingua che sposta la regione). Come sul 401: ref azzerato
      // così un cambio successivo (es. dopo il login) riprova il sync.
      void shouldSkipServerSync().then((skip) => {
        if (skip) {
          lastPersistRef.current = ""
          console.debug("[defaults] Server sync skipped (guest without session, or no profile)")
          void isProfilelessOnMultiUser().then((profileless) => {
            if (profileless) notifyProfilelessOnce()
          })
          return
        }
        userFetch("/api/defaults", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: payloadStr,
        })
        .then((res) => {
          if (res.ok) return
          // 401 (admin fail-closed), 403 origin, 5xx persist: il client crede di
          // aver salvato (localStorage) ma i default d'istanza restano vecchi —
          // e su Stremio i poster dei cataloghi usano QUELLI. Segnala il desync.
          lastPersistRef.current = ""
          console.warn(`[defaults] Auto-sync failed: HTTP ${res.status}`)
          void import("sonner").then(({ toast }) =>
            toast.warning(t("ui.defaultsSyncFailed")),
          )
        })
        .catch((error: unknown) => {
          // Se il PUT fallisce (rete, serverless cold start) resetta il ref
          // così un successivo cambio di default riprova invece di considerare "sincronizzato".
          lastPersistRef.current = ""
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[defaults] Auto-sync failed: ${message}`)
          void import("sonner").then(({ toast }) =>
            toast.warning(t("ui.defaultsSyncFailed")),
          )
        })
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [state, hydrated])

  const update = useCallback((patch: Partial<DefaultsState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const loadDefaultsToState = useCallback(() => {
    const stored = readStoredDefaults()
    setState(buildFromStored(stored))
    lastPersistRef.current = JSON.stringify(defaultsToPayload(buildFromStored(stored)))
  }, [])

  return { ...state, update, loadDefaultsToState }
}
