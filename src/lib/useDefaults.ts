"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle } from "./badge-styles"
import type { NetworkLogoPosition, PosterShape } from "./types"
import { isNetworkLogoPosition, isPosterShape } from "./types"
import type { LandscapeServerDefaults } from "./server-defaults"
import { parseDateFormat, type DateFormat } from "./release-badge"
import { normalizeRegion } from "./regions"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { userFetch, parseRetryAfter } from "./http"
import { USER_UNLOCK_EVENT, currentPathUuid } from "./user-token"
import { t } from "./i18n"
import { normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import { DEFAULT_QUALITY_BADGE_STYLE, type QualityBadgeStyle } from "./badge-styles"
import { DEFAULT_BADGE_FONT, isBadgeFont, type BadgeFont } from "./badge-styles"
import { DEFAULT_SEPARATE_RATINGS_STYLE, isSeparateRatingsStyle, getSeparateBadgeDefaultScale, type SeparateRatingsStyle } from "./badge-styles"
import { isExtraBadgeStyle } from "./badge-styles"
import { DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y, DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE, DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE } from "./badge-styles"
import { KNOWN_VIDEO_FORMATS, isVideoFormat, type VideoFormat } from "./av-specs"

export type RibbonSide = "left" | "right"

/**
 * Authoritative defaults sync state (single source: useDefaults).
 * idle = loading, before any completed attempt; pending = device-saved with
 * the server send outstanding; synced = latest payload server-confirmed;
 * failed = server rejected (device copy intact); local-failed = device write
 * failed; local-only = server sync skipped by design (guest); unconfirmed =
 * locally loaded but never server-confirmed (attempt failed or diverged).
 * Seq is bumped at every new payload arrival (effect or retry), never at PUT
 * start, so a stale send resolving later announces nothing.
 */
export type DefaultSyncStatus = "idle" | "pending" | "synced" | "failed" | "local-only" | "local-failed" | "unconfirmed"

export interface DefaultsState {
  defaultBadgeStyle: BadgeStyle
  defaultRankingBadgeStyle: RankingBadgeStyle
  /** Standalone extra-badge style default (null = legacy `rs` fallback). */
  defaultExtraBadgeStyle: ExtraBadgeStyle | null
  /** Font dei testi badge di default ("inter" = resa storica). */
  defaultBadgeFont: BadgeFont
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
  /** Tuning EXTRA superiore di default (null = fallback legacy classifica). */
  defaultExtraBadgeScale: number | null
  defaultExtraBadgeOffsetX: number | null
  defaultExtraBadgeOffsetY: number | null
  defaultGenreBadgeScale: number
  defaultQualityBadgeScale: number
  /** Scala % rating separati di default (default unico 130; esplicito 100 storico preservato). */
  defaultSeparateBadgeScale: number
  /** Offset px gruppo rating separati di default (default 0). */
  defaultSeparateBadgeOffsetX: number
  /** Offset px gruppo rating separati di default (default 0). */
  defaultSeparateBadgeOffsetY: number
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
  /** Layout dei rating separati di default ("column" = colonna destra storica). */
  defaultSeparateRatingsStyle: SeparateRatingsStyle
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
  /** Il network segue il titolo di default (true = layout storico). */
  defaultNetworkLogoFollowTitle: boolean
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
  /** Layout dei rating separati del poster in editing ("column" = colonna storica). */
  separateRatingsStyle: SeparateRatingsStyle
  networkLogo: boolean
  /** Posizione del logo network del poster in editing. */
  networkLogoPosition: NetworkLogoPosition
  /** Il network segue il titolo nel poster in editing (false = posizione assoluta). */
  networkLogoFollowTitle: boolean
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
  /** Tuning EXTRA superiore in editing (null = fallback legacy classifica). */
  extraBadgeScale: number | null
  extraBadgeOffsetX: number | null
  extraBadgeOffsetY: number | null
  genreBadgeScale: number
  qualityBadgeScale: number
  /** Scala % rating separati del poster in editing (default unico 130). */
  separateBadgeScale: number
  /** Offset px gruppo rating separati del poster in editing (default 0). */
  separateBadgeOffsetX: number
  /** Offset px gruppo rating separati del poster in editing (default 0). */
  separateBadgeOffsetY: number
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
  /** Standalone extra-badge style in editing (null = legacy `rs` fallback). */
  extraBadgeStyle: ExtraBadgeStyle | null
  /** Font dei testi badge del poster in editing. */
  badgeFont: BadgeFont
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
  defaultExtraBadgeStyle: null,
  defaultBadgeFont: DEFAULT_BADGE_FONT,
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
  defaultExtraBadgeScale: null,
  defaultExtraBadgeOffsetX: null,
  defaultExtraBadgeOffsetY: null,
  defaultGenreBadgeScale: 100,
  defaultQualityBadgeScale: 100,
  defaultSeparateBadgeScale: 130,
  defaultSeparateBadgeOffsetX: 0,
  defaultSeparateBadgeOffsetY: 0,
  defaultNetworkLogoScale: 100,
  defaultGenreBadgeOffsetX: 0,
  defaultGenreBadgeOffsetY: 0,
  defaultQualityBadgeOffsetX: DEFAULT_QUALITY_BADGE_OFFSET_X,
  defaultQualityBadgeOffsetY: DEFAULT_QUALITY_BADGE_OFFSET_Y,
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
  defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
  defaultSashOrder: [...DEFAULT_SASH_ORDER],
  defaultAutoRotateClean: false,
  defaultAutoRotateBackdrop: false,
  defaultDisableCleanPosters: false,
  defaultPortraitFitEnabled: true,
  defaultLandscapeFitEnabled: true,
  defaultNetworkLogo: true,
  defaultNetworkLogoPosition: "auto",
  defaultNetworkLogoFollowTitle: true,
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
  separateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
  networkLogo: true,
  networkLogoPosition: "auto",
  networkLogoFollowTitle: true,
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
  extraBadgeScale: null,
  extraBadgeOffsetX: null,
  extraBadgeOffsetY: null,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  separateBadgeScale: 130,
  separateBadgeOffsetX: 0,
  separateBadgeOffsetY: 0,
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
  extraBadgeStyle: null,
  badgeFont: DEFAULT_BADGE_FONT,
  qualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
  videoFormats: null,
  defaultLogoScale: null,
  defaultLogoOffsetX: null,
  defaultLogoOffsetY: null,
  // Profilo landscape per i nuovi settings: qualità a 0/0 storico (non segue
  // il nuovo default verticale -10/+10); gli altri offset restano in follow
  // dei flat. Vedi buildFromStored per gli stored esistenti.
  landscape: {
    qualityBadgeOffsetX: DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
    qualityBadgeOffsetY: DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
  },
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
  /** Chiavi flat extra (saveDefaults/auto-persist): fallback di lettura. */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  genreBadgeScale?: number
  qualityBadgeScale?: number
  separateBadgeScale?: number
  separateBadgeOffsetX?: number
  separateBadgeOffsetY?: number
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
  extraBadgeStyle?: ExtraBadgeStyle | null
  qualityBadgeStyle?: QualityBadgeStyle
  badgeFont?: BadgeFont
  defaultBadgeStyle?: BadgeStyle
  defaultRankingBadgeStyle?: RankingBadgeStyle
  defaultExtraBadgeStyle?: ExtraBadgeStyle | null
  defaultBadgeFont?: BadgeFont
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
  defaultExtraBadgeScale?: number | null
  defaultExtraBadgeOffsetX?: number | null
  defaultExtraBadgeOffsetY?: number | null
  defaultGenreBadgeScale?: number
  defaultQualityBadgeScale?: number
  defaultSeparateBadgeScale?: number
  defaultSeparateBadgeOffsetX?: number
  defaultSeparateBadgeOffsetY?: number
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
  /** Layout dei rating separati (grezzo dallo storage; validato in buildFromStored). */
  defaultSeparateRatingsStyle?: SeparateRatingsStyle
  separateRatingsStyle?: SeparateRatingsStyle
  /** Bucket sash abilitati (grezzi; normalizzati in buildFromStored). */
  defaultSashOrder?: string[]
  /** Chiave server/local piatta (saveDefaults/defaultsToPayload): fallback di lettura. */
  sashOrder?: string[]
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
  defaultNetworkLogoFollowTitle?: boolean
  networkLogoPosition?: NetworkLogoPosition
  networkLogoFollowTitle?: boolean
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
  /** Chiave server/local piatta (saveDefaults/defaultsToPayload): fallback di lettura. */
  dateFormat?: DateFormat
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

function safeSetItem(key: string, val: string): boolean {
  try {
    localStorage.setItem(key, val)
    return true
  } catch {
    // Quota/private-mode write failure: callers must not mistake it for saved.
    return false
  }
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** Numerico finito o null (mai spazzatura dallo storage: garbage = fallback legacy). */
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Profilo landscape idratato con provenance dai dati RAW (vedi nota al sito
 * d'uso in buildFromStored). Ritorna sempre un plain object; non scrive mai
 * sullo storage (la persistenza resta il normale auto-persist dell'hook).
 */
function seedLandscapeQualityOffsets(
  rawLandscape: Record<string, unknown> | null | undefined,
  rawFlatOffsetX: unknown,
  rawFlatOffsetY: unknown,
): LandscapeServerDefaults {
  const base: Record<string, unknown> =
    rawLandscape !== null && typeof rawLandscape === "object" && !Array.isArray(rawLandscape)
      ? { ...rawLandscape }
      : {}
  const landX = numOrUndef(base.qualityBadgeOffsetX)
  const landY = numOrUndef(base.qualityBadgeOffsetY)
  const flatX = numOrUndef(rawFlatOffsetX)
  const flatY = numOrUndef(rawFlatOffsetY)
  return {
    ...(base as Partial<LandscapeServerDefaults>),
    // Solo il ramo tutto-implicito materializza 0/0; il ramo flat-esplicito
    // resta undefined (= follow dinamico dei flat, anche futuri).
    qualityBadgeOffsetX: landX ?? (flatX === undefined ? 0 : undefined),
    qualityBadgeOffsetY: landY ?? (flatY === undefined ? 0 : undefined),
  }
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
  // Default scala stile-dipendente: assente + stile bar → 130, altrimenti 100.
  // Un numerico salvato (incluso 100) si preserva sempre (niente migrazione
  // silenziosa dei mapping/defaults in load).
  const storedDefaultStyle = isSeparateRatingsStyle(d.defaultSeparateRatingsStyle)
    ? d.defaultSeparateRatingsStyle
    : (isSeparateRatingsStyle(d.separateRatingsStyle) ? d.separateRatingsStyle : DEFAULT_SEPARATE_RATINGS_STYLE)
  const storedStyle = isSeparateRatingsStyle(d.separateRatingsStyle)
    ? d.separateRatingsStyle
    : storedDefaultStyle
  return {
    defaultBadgeStyle: d.defaultBadgeStyle ?? d.badgeStyle ?? "shadow",
    defaultRankingBadgeStyle: d.defaultRankingBadgeStyle ?? d.rankingBadgeStyle ?? "default",
    defaultExtraBadgeStyle: isExtraBadgeStyle(d.defaultExtraBadgeStyle)
      ? d.defaultExtraBadgeStyle
      : (isExtraBadgeStyle(d.extraBadgeStyle) ? d.extraBadgeStyle : null),
    defaultBadgeFont: isBadgeFont(d.defaultBadgeFont) ? d.defaultBadgeFont : (isBadgeFont(d.badgeFont) ? d.badgeFont : DEFAULT_BADGE_FONT),
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
    // Extra: no legacy alias (new field). Garbage falls back, never invented numbers.
    defaultExtraBadgeScale: numOrNull(d.defaultExtraBadgeScale ?? d.extraBadgeScale),
    defaultExtraBadgeOffsetX: numOrNull(d.defaultExtraBadgeOffsetX ?? d.extraBadgeOffsetX),
    defaultExtraBadgeOffsetY: numOrNull(d.defaultExtraBadgeOffsetY ?? d.extraBadgeOffsetY),
    defaultGenreBadgeScale: d.defaultGenreBadgeScale ?? d.genreBadgeScale ?? 100,
    defaultQualityBadgeScale: d.defaultQualityBadgeScale ?? d.qualityBadgeScale ?? 100,
    defaultSeparateBadgeScale: d.defaultSeparateBadgeScale ?? d.separateBadgeScale ?? getSeparateBadgeDefaultScale(storedDefaultStyle),
    defaultSeparateBadgeOffsetX: d.defaultSeparateBadgeOffsetX ?? d.separateBadgeOffsetX ?? 0,
    defaultSeparateBadgeOffsetY: d.defaultSeparateBadgeOffsetY ?? d.separateBadgeOffsetY ?? 0,
    defaultNetworkLogoScale: d.defaultNetworkLogoScale ?? d.networkLogoScale ?? 100,
    defaultGenreBadgeOffsetX: d.defaultGenreBadgeOffsetX ?? d.genreBadgeOffsetX ?? 0,
    defaultGenreBadgeOffsetY: d.defaultGenreBadgeOffsetY ?? d.genreBadgeOffsetY ?? 0,
    defaultQualityBadgeOffsetX: d.defaultQualityBadgeOffsetX ?? d.qualityBadgeOffsetX ?? DEFAULT_QUALITY_BADGE_OFFSET_X,
    defaultQualityBadgeOffsetY: d.defaultQualityBadgeOffsetY ?? d.qualityBadgeOffsetY ?? DEFAULT_QUALITY_BADGE_OFFSET_Y,
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
    defaultSeparateRatingsStyle: isSeparateRatingsStyle(d.defaultSeparateRatingsStyle)
      ? d.defaultSeparateRatingsStyle
      : (isSeparateRatingsStyle(d.separateRatingsStyle) ? d.separateRatingsStyle : DEFAULT_SEPARATE_RATINGS_STYLE),
    defaultSashOrder: normalizeSashOrder(d.defaultSashOrder ?? d.sashOrder) ?? [...DEFAULT_SASH_ORDER],
    defaultAutoRotateClean: d.defaultAutoRotateClean ?? d.autoRotateClean ?? false,
    defaultAutoRotateBackdrop: d.defaultAutoRotateBackdrop ?? false,
    defaultDisableCleanPosters: d.defaultDisableCleanPosters ?? d.disableCleanPosters ?? false,
    // Migrazione: il vecchio flag unico alimenta entrambi i formati.
    defaultPortraitFitEnabled: d.defaultPortraitFitEnabled ?? d.defaultLogoFitEnabled ?? true,
    defaultLandscapeFitEnabled: d.defaultLandscapeFitEnabled ?? d.defaultLogoFitEnabled ?? true,
    defaultNetworkLogo: d.defaultNetworkLogo ?? d.networkLogo ?? true,
    defaultNetworkLogoFollowTitle: d.defaultNetworkLogoFollowTitle ?? d.networkLogoFollowTitle ?? true,
    defaultNetworkLogoPosition: isNetworkLogoPosition(d.defaultNetworkLogoPosition)
      ? d.defaultNetworkLogoPosition
      : (isNetworkLogoPosition(d.networkLogoPosition) ? d.networkLogoPosition : "auto"),
    defaultPreRelease: d.defaultPreRelease ?? d.preRelease ?? false,
    defaultRibbonSide: d.defaultRibbonSide ?? d.ribbonSide ?? "left",
    defaultRibbonEnabled: d.defaultRibbonEnabled ?? d.ribbonEnabled ?? true,
    defaultPosterShape: storedDefaultShape ?? "poster",
    defaultLogoAlign: d.defaultLogoAlign === "left" || d.defaultLogoAlign === "center" ? d.defaultLogoAlign : null,
    defaultEpisodeMetadataSource: d.defaultEpisodeMetadataSource ?? d.episodeMetadataSource ?? "tmdb",
    defaultDateFormat: parseDateFormat(d.defaultDateFormat ?? d.dateFormat) ?? "locale",
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
    separateRatingsStyle: isSeparateRatingsStyle(d.separateRatingsStyle)
      ? d.separateRatingsStyle
      : (isSeparateRatingsStyle(d.defaultSeparateRatingsStyle) ? d.defaultSeparateRatingsStyle : DEFAULT_SEPARATE_RATINGS_STYLE),
    networkLogo: d.networkLogo ?? d.defaultNetworkLogo ?? true,
    networkLogoFollowTitle: d.networkLogoFollowTitle ?? d.defaultNetworkLogoFollowTitle ?? true,
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
    extraBadgeScale: numOrNull(d.extraBadgeScale ?? d.defaultExtraBadgeScale),
    extraBadgeOffsetX: numOrNull(d.extraBadgeOffsetX ?? d.defaultExtraBadgeOffsetX),
    extraBadgeOffsetY: numOrNull(d.extraBadgeOffsetY ?? d.defaultExtraBadgeOffsetY),
    genreBadgeScale: d.genreBadgeScale ?? d.defaultGenreBadgeScale ?? 100,
    qualityBadgeScale: d.qualityBadgeScale ?? d.defaultQualityBadgeScale ?? 100,
    separateBadgeScale: d.separateBadgeScale ?? d.defaultSeparateBadgeScale ?? getSeparateBadgeDefaultScale(storedStyle),
    separateBadgeOffsetX: d.separateBadgeOffsetX ?? d.defaultSeparateBadgeOffsetX ?? 0,
    separateBadgeOffsetY: d.separateBadgeOffsetY ?? d.defaultSeparateBadgeOffsetY ?? 0,
    networkLogoScale: d.networkLogoScale ?? d.defaultNetworkLogoScale ?? 100,
    genreBadgeOffsetX: d.genreBadgeOffsetX ?? d.defaultGenreBadgeOffsetX ?? 0,
    genreBadgeOffsetY: d.genreBadgeOffsetY ?? d.defaultGenreBadgeOffsetY ?? 0,
    qualityBadgeOffsetX: d.qualityBadgeOffsetX ?? d.defaultQualityBadgeOffsetX ?? DEFAULT_QUALITY_BADGE_OFFSET_X,
    qualityBadgeOffsetY: d.qualityBadgeOffsetY ?? d.defaultQualityBadgeOffsetY ?? DEFAULT_QUALITY_BADGE_OFFSET_Y,
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
    extraBadgeStyle: isExtraBadgeStyle(d.extraBadgeStyle)
      ? d.extraBadgeStyle
      : (isExtraBadgeStyle(d.defaultExtraBadgeStyle) ? d.defaultExtraBadgeStyle : null),
    badgeFont: isBadgeFont(d.badgeFont) ? d.badgeFont : (isBadgeFont(d.defaultBadgeFont) ? d.defaultBadgeFont : DEFAULT_BADGE_FONT),
    qualityBadgeStyle: d.qualityBadgeStyle ?? d.defaultQualityBadgeStyle ?? DEFAULT_QUALITY_BADGE_STYLE,
    videoFormats: Array.isArray(d.videoFormats) ? d.videoFormats.filter(isVideoFormat) : null,
    defaultLogoScale: typeof d.defaultLogoScale === "number" ? d.defaultLogoScale : (typeof d.logoScale === "number" ? d.logoScale : null),
    defaultLogoOffsetX: typeof d.defaultLogoOffsetX === "number" ? d.defaultLogoOffsetX : (typeof d.logoOffsetX === "number" ? d.logoOffsetX : null),
    defaultLogoOffsetY: typeof d.defaultLogoOffsetY === "number" ? d.defaultLogoOffsetY : (typeof d.logoOffsetY === "number" ? d.logoOffsetY : null),
    // Profilo landscape: solo plain object (mai array/null dallo storage);
    // la validazione vera avviene sul server al sync (PUT). Seed qualità da
    // RAW prima del merge (mai confronto valori): override landscape
    // esplicito vince (incluso 0); senza, si segue il flat esplicito
    // (inclusi alias legacy e -10/+10 deliberati); solo quando anche il flat
    // è implicito (nuovi settings) si fissa 0/0 storico, mentre il portrait
    // adotta il nuovo default. Chiave presente-ma-undefined si comporta come
    // assente (??) e non persiste in JSON — nessuna migrazione degli stored.
    landscape: seedLandscapeQualityOffsets(
      d.landscape,
      d.defaultQualityBadgeOffsetX ?? d.qualityBadgeOffsetX,
      d.defaultQualityBadgeOffsetY ?? d.qualityBadgeOffsetY,
    ),
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
    extraBadgeStyle: d.defaultExtraBadgeStyle ?? null,
    badgeFont: d.defaultBadgeFont,
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
    extraBadgeScale: d.defaultExtraBadgeScale ?? null,
    extraBadgeOffsetX: d.defaultExtraBadgeOffsetX ?? null,
    extraBadgeOffsetY: d.defaultExtraBadgeOffsetY ?? null,
    genreBadgeScale: d.defaultGenreBadgeScale,
    qualityBadgeScale: d.defaultQualityBadgeScale,
    separateBadgeScale: d.defaultSeparateBadgeScale,
    separateBadgeOffsetX: d.defaultSeparateBadgeOffsetX,
    separateBadgeOffsetY: d.defaultSeparateBadgeOffsetY,
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
    // Provider OFF = campo nascosto: un endpoint stale/invalido non deve far
    // fallire l'intero PUT 400 (stessa protezione del Salva manuale).
    customRatingEndpoint: d.defaultCustomRatings ? (d.defaultCustomRatingEndpoint ?? "") : "",
    customRatingApiKeyHeader: d.defaultCustomRatingApiKeyHeader ?? "",
    ratingSources: d.defaultRatingSources,
    separateRatings: d.defaultSeparateRatings,
    separateRatingsStyle: d.defaultSeparateRatingsStyle,
    sashOrder: d.defaultSashOrder,
    autoRotateClean: d.defaultAutoRotateClean,
    defaultAutoRotateBackdrop: d.defaultAutoRotateBackdrop,
    disableCleanPosters: d.defaultDisableCleanPosters,
    defaultPortraitFitEnabled: d.defaultPortraitFitEnabled,
    defaultLandscapeFitEnabled: d.defaultLandscapeFitEnabled,
    networkLogo: d.defaultNetworkLogo,
    networkLogoPosition: d.defaultNetworkLogoPosition,
    networkLogoFollowTitle: d.defaultNetworkLogoFollowTitle,
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

// Tentativi totali (prima fetch + retry) dell'hydration GET su 429: spec
// esplicito, bounded — mai retry infiniti contro un bucket saturo.
const HYDRATION_MAX_ATTEMPTS = 3

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

  const [syncStatus, setSyncStatus] = useState<DefaultSyncStatus>("idle")
  // Monotonic send id, bumped at every new payload arrival (effect body or
  // retry): a stale send resolving later announces nothing.
  const syncSeqRef = useRef(0)
  // Pending debounce timer (ref, so manual retry can flush it: no double PUT).
  // No effect cleanup: only a new payload arrival (body above) or retry
  // replaces the timer, and unmount is covered by the mounted effect below.
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Inflight PUT cancellation (superseded send or unmount).
  const syncAbortRef = useRef<AbortController | null>(null)
  // Pending hydration-retry timer (429 backoff below): cleared on unmount so
  // a retry never fires after teardown (state writes stay mounted-guarded).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hydration generation ownership: each refreshFromServer call invalidates
  // the previous one (timer cleared, inflight GET aborted). Stale chains
  // resolve into no-ops, so only the latest refresh can write state or
  // schedule retries — attempts stay bounded per owner even across
  // StrictMode remounts or concurrent post-unlock refreshes.
  const refreshSeqRef = useRef(0)
  const refreshAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshAbortRef.current?.abort()
      // Invalidate any hydration chain that outlives this unmount (StrictMode
      // remount starts a fresh owned generation below).
      refreshSeqRef.current += 1
      syncAbortRef.current?.abort()
    }
  }, [])

  // Single server send for an exact payload string. Never reads component
  // state: retry and debounce share it, so they cannot diverge or double-PUT.
  // True only when the server confirmed; never on skip/local/network failure.
  const syncSend = useCallback(async (payloadStr: string, seq: number): Promise<boolean> => {
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    // Guest guard: guest without session stays local-only by design, never
    // overwriting the owner's instance defaults (existing skip semantics).
    if (await shouldSkipServerSync()) {
      if (seq !== syncSeqRef.current || !mountedRef.current) return false
      lastPersistRef.current = ""
      setSyncStatus("local-only")
      console.debug("[defaults] Server sync skipped (guest without session, or no profile)")
      void isProfilelessOnMultiUser().then((profileless) => {
        if (profileless) notifyProfilelessOnce()
      })
      return false
    }
    // Slow guard + newer payload: never send a stale PUT after the guard.
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    const ctrl = new AbortController()
    syncAbortRef.current = ctrl
    let res: Response
    try {
      res = await userFetch("/api/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payloadStr,
        signal: ctrl.signal,
      })
    } catch (error: unknown) {
      // Superseded, aborted or unmounted sends never announce anything.
      if (seq !== syncSeqRef.current || !mountedRef.current || ctrl.signal.aborted) return false
      lastPersistRef.current = ""
      setSyncStatus("failed")
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[defaults] Auto-sync failed: ${message}`)
      void import("sonner").then(({ toast }) =>
        toast.warning(t("ui.defaultsSyncFailed")),
      )
      return false
    }
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    if (res.ok) {
      setSyncStatus("synced")
      return true
    }
    // 401 (admin fail-closed), 403 origin, 5xx persist: il client crede di
    // aver salvato (localStorage) ma i default d'istanza restano vecchi —
    // e su Stremio i poster dei cataloghi usano QUELLI. Segnala il desync.
    lastPersistRef.current = ""
    setSyncStatus("failed")
    console.warn(`[defaults] Auto-sync failed: HTTP ${res.status}`)
    void import("sonner").then(({ toast }) =>
      toast.warning(t("ui.defaultsSyncFailed")),
    )
    return false
  }, [])

  // Idle-only completion helper for server refresh: guests present
  // local-only (never a false synced), everyone else the given state.
  // Newer edit states are never overwritten; unmounted no-op.
  const settleIdle = useCallback(async (nonGuest: DefaultSyncStatus): Promise<void> => {
    const skip = await shouldSkipServerSync().catch(() => false)
    if (!mountedRef.current) return
    setSyncStatus((prev) => (prev === "idle" ? (skip ? "local-only" : nonGuest) : prev))
  }, [])

  // Refresh defaults dal server (namespace via userFetch su /u/<uuid>).
  // Estratto per riuso post-unlock: la prima fetch può aver girato senza
  // token (race col #key=) e il merge server→locale va rifatto a sblocco.
  // Hydration retry: il bucket `defaults` è condiviso (30 burst / 3 al sec)
  // e sotto carico va in 429 ANCHE sulla GET di hydration — senza retry
  // l'editor restava ai factory per tutta la pagina (preview con rs=default
  // invece dei salvati). Solo il 429 aspetta il Retry-After e riprova, al
  // massimo HYDRATION_MAX_ATTEMPTS tentativi totali; 401/404/network e
  // 429 persistenti mantengono la semantica precedente (unconfirmed, mai
  // loading infinito). Niente 5xx speculativi: solo il caso dimostrato.
  const refreshFromServer = useCallback(() => {
    // New generation invalidates the previous chain first: its retry timer
    // is cancelled and its inflight GET aborted (userFetch already takes an
    // AbortSignal). Late resolutions of the old chain hit the owner guard
    // below and stay silent — an old 429 never schedules over the new
    // refresh, an old 200 never applies obsolete data.
    refreshSeqRef.current += 1
    const gen = refreshSeqRef.current
    refreshAbortRef.current?.abort()
    const ctrl = new AbortController()
    refreshAbortRef.current = ctrl
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    const isOwner = (): boolean => gen === refreshSeqRef.current && mountedRef.current
    const attemptLoad = (attempt: number): void => {
      if (!isOwner()) return
      userFetch("/api/defaults", { signal: ctrl.signal })
        .then((r) => {
          if (!isOwner()) return undefined
          if (r.status === 429 && attempt < HYDRATION_MAX_ATTEMPTS) {
            const waitMs = parseRetryAfter(r.headers.get("Retry-After"))
            // Observability (same convention as the syncSend warn): hydration
            // 429s used to be silent — the retry stays measurable in logs
            // without changing behavior.
            console.warn(`[defaults] Hydration 429: retry ${attempt + 1}/${HYDRATION_MAX_ATTEMPTS} in ${waitMs}ms`)
            refreshTimerRef.current = setTimeout(() => {
              refreshTimerRef.current = null
              if (!isOwner()) return
              attemptLoad(attempt + 1)
            }, waitMs)
            return undefined
          }
          return r.ok ? r.json() : null
        })
        .then(async (serverData) => {
          if (!isOwner()) return
          if (serverData === undefined) return // 429 retry scheduled above
          if (!serverData) {
            // Completed without server confirmation (fail/non-ok): locally
            // loaded but unverified — never infinite loading, retry available.
            await settleIdle("unconfirmed")
            return
          }
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
          if (!currentStored?.defaultSashOrder && !currentStored?.sashOrder && Array.isArray(serverData.sashOrder)) {
            merged.defaultSashOrder = serverData.sashOrder
          }
          if (!currentStored?.defaultVideoFormats && Array.isArray(serverData.videoFormats)) {
            merged.defaultVideoFormats = serverData.videoFormats
          }
          const updated = buildFromStored(merged)
          const mergedStr = JSON.stringify(defaultsToPayload(updated))
          // Server-only canonical payload: a GET ok confirms the merged one
          // only when both are equal (local precedence may differ).
          const serverStr = JSON.stringify(defaultsToPayload(buildFromStored(serverData)))
          const storedOk = safeSetItem(defaultsStorageKey(), mergedStr)
          lastPersistRef.current = mergedStr
          if (!isOwner()) return
          setState(updated)
          if (!storedOk) {
            // Local write failed: local-failed (never synced).
            setSyncStatus((prev) => (prev === "idle" ? "local-failed" : prev))
            return
          }
          // Truthful hydration from idle only, no auto-PUT at startup: the
          // server confirms the merged payload only when its canonical form
          // equals it, otherwise these values were never seen server-side.
          // The guest consult decides local-only vs the confirmed state.
          await settleIdle(serverStr === mergedStr ? "synced" : "unconfirmed")
        })
        .catch(() => {
          // Network rejection / JSON exception / aborted superseded chain:
          // same completion as a failed attempt (never infinite idle),
          // owner-guarded so stale generations stay silent.
          if (!isOwner()) return
          void settleIdle("unconfirmed")
        })
    }
    attemptLoad(1)
  }, [settleIdle])

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
  // Debounce invariato a 500ms; lo stato di sync resta autorevole qui.
  useEffect(() => {
    if (!hydrated) return
    const payload = defaultsToPayload(state)
    const payloadStr = JSON.stringify(payload)
    if (lastPersistRef.current === payloadStr) return
    lastPersistRef.current = payloadStr

    // Invalidate at payload arrival (before local write/debounce): a stale
    // send resolving later — even during this debounce — announces nothing,
    // the pending timer is replaced, never stacked, and the previous inflight
    // PUT is aborted. The timer captures the already-allocated seq.
    const seq = ++syncSeqRef.current
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    syncAbortRef.current?.abort()

    // Immediate synchronous local write; a failed write is a local failure
    // (explicit status + retry), never silently treated as saved.
    if (!safeSetItem(defaultsStorageKey(), payloadStr)) {
      setSyncStatus("local-failed")
      return
    }
    setSyncStatus("pending")

    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      void syncSend(payloadStr, seq)
    }, 500)
  }, [state, hydrated, syncSend])

  const update = useCallback((patch: Partial<DefaultsState> | ((prev: DefaultsState) => Partial<DefaultsState>)) => {
    setState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }))
  }, [])

  const loadDefaultsToState = useCallback(() => {
    const stored = readStoredDefaults()
    setState(buildFromStored(stored))
    lastPersistRef.current = JSON.stringify(defaultsToPayload(buildFromStored(stored)))
  }, [])

  // Manual recovery + explicit retry: invalidates first (a slow
  // guard/debounce from a previous payload must not win), clears the pending
  // timer before writing, then sends the current payload immediately (single
  // PUT, same shape as auto-sync, no new edit required). The local write is
  // attempted again, so recovery from a local failure also needs no new edit.
  // True only when the server confirmed.
  const retryDefaultSync = useCallback((): Promise<boolean> => {
    if (!hydrated) return Promise.resolve(false)
    const seq = ++syncSeqRef.current
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    syncAbortRef.current?.abort()
    const payloadStr = JSON.stringify(defaultsToPayload(state))
    lastPersistRef.current = payloadStr
    if (!safeSetItem(defaultsStorageKey(), payloadStr)) {
      setSyncStatus("local-failed")
      return Promise.resolve(false)
    }
    setSyncStatus("pending")
    return syncSend(payloadStr, seq)
  }, [state, hydrated, syncSend])

  return { ...state, update, loadDefaultsToState, defaultSyncStatus: syncStatus, retryDefaultSync }
}
