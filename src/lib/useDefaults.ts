"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle, ExtraBadgeFollowRank } from "./badge-styles"
import type { NetworkLogoPosition, PosterLayout, PosterFreshScope, PosterShape } from "./types"
import { isNetworkLogoPosition, isPosterLayout, isPosterFreshScope, isPosterShape } from "./types"
import type { LandscapeServerDefaults } from "./server-defaults"
import { parseDateFormat, type DateFormat } from "./release-badge"
import { normalizeRegion } from "./regions"
import { DEFAULT_AGE_COUNTRY, normalizeCertificationCountry } from "./certification"
import { isProfilelessOnMultiUser, notifyProfilelessOnce, shouldSkipServerSync } from "./guest-guard"
import { userFetch, parseRetryAfter } from "./http"
import { USER_UNLOCK_EVENT, currentPathUuid } from "./user-token"
import { t } from "./i18n"
import { normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import { sanitizeDisabledContentTags } from "./content-tags"
import { sanitizeDisabledNetworks } from "./network-keys"
import { DEFAULT_QUALITY_BADGE_STYLE, type QualityBadgeStyle } from "./badge-styles"
import { DEFAULT_AGE_BADGE_STYLE, isAgeBadgeStyle, type AgeBadgeStyle } from "./badge-styles"
import { DEFAULT_BADGE_FONT, isBadgeFont, type BadgeFont } from "./badge-styles"
import { DEFAULT_SEPARATE_RATINGS_STYLE, isSeparateRatingsStyle, getSeparateBadgeDefaultScale, type SeparateRatingsStyle } from "./badge-styles"
import { SHAPE_FLAT_TO_LANDSCAPE, snapshotMissingLandscape, independentLandscapeDefaults } from "./visual-presets"
import { canonicalizeBadgeItemTransforms } from "./badge-item-transforms"
import { isExtraBadgeStyle, isExtraFollowRank } from "./badge-styles"
import { DEFAULT_QUALITY_BADGE_OFFSET_X, DEFAULT_QUALITY_BADGE_OFFSET_Y } from "./badge-styles"
import type { RetiredBadgeFamilyBindings } from "./types"
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
  defaultExtraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  /** Font dei testi badge di default ("inter" = resa storica). */
  defaultBadgeFont: BadgeFont
  /**
   * BadgeLab family map dei default globali (flat/portrait): sparse per
   * family, assente = nativo (nessun override), presente `null` = Standard
   * esplicito. Il profilo `landscape` fonde chiave-per-chiave sopra (stesso
   * contratto del per-titolo). Solo scelte salvate: mai sentinel di drop.
   */
  defaultBadgePresets: RetiredBadgeFamilyBindings | null
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
  /**
   * Altezza dell'ombra superiore di default in % del canvas 0-100
   * (default 25 = look storico).
   */
  defaultTopShadeHeight: number
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
  /**
   * Per-ITEM corrections di default (single rating pill / single quality-AV
   * mark), canonical wire form. Null = layout automatico.
   */
  defaultBadgeItemTransforms: string | null
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
  /** Badge età testuale di default portrait (default OFF). */
  defaultAgeBadge: boolean
  /** Paese classificazione età di default portrait ("IT"). Mai auto-cambiato. */
  defaultAgeCountry: string
  /** Stile pill età di default portrait ("standard" = resa storica). */
  defaultAgeBadgeStyle: AgeBadgeStyle
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
  /** Graphical poster layout di default ("standard" = resa storica, "fresh" = opt-in). */
  defaultPosterLayout: PosterLayout
  /** Fresh apply scope di default ("ranked" = default: solo con rank; "all" = override esplicito). */
  defaultPosterFreshScope: PosterFreshScope
  /** Bucket sash abilitati (ordine canonico; vuota = tutto spento). */
  defaultSashOrder: SashBucket[]
  /**
   * Tag badge automatici disabilitati space-wide (ID canonici, vedi
   * `content-tags.ts`). Condivisi tra forme: nessun profilo landscape, nessun
   * per-titolo, nessuna recipe preset. Assente/vuoto = storico.
   */
  defaultDisabledContentTags: string[]
  /**
   * Mark network disabilitati space-wide (ID canonici, vedi
   * `network-keys.ts`). Stesso contratto dei tag sopra.
   */
  defaultDisabledNetworks: string[]
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
  /** Graphical poster layout del poster in editing ("standard" = resa storica). */
  posterLayout: PosterLayout
  /** Fresh apply scope del poster in editing ("ranked" = default: solo con rank). */
  posterFreshScope: PosterFreshScope
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
  /**
   * Per-ITEM corrections del poster in editing (canonical wire form). Null =
   * layout automatico; viaggia nel mapping per-titolo come gli altri
   * visuali (mai per indice di array).
   */
  badgeItemTransforms: string | null
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
   * Ombra lineare superiore 0-100 in editing (per-titolo; assente = default
   * globale `defaultTopShade`, canonico 80). Si carica dal mapping
   * all'apertura titolo.
   */
  topShade: number
  /**
   * Altezza dell'ombra superiore 0-100 (% canvas) in editing (per-titolo;
   * assente = default globale `defaultTopShadeHeight`, canonico 25).
   * 0 = ombra disattivata qualunque sia `topShade`.
   */
  topShadeHeight: number
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Standalone extra-badge style in editing (null = legacy `rs` fallback; "follow-rank" = explicit own-rank). */
  extraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | null
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
  /**
   * Transport-only clear list for the landscape profile (pending reset from
   * the settings draft). Never hydrated from storage and never installed in
   * live state; the PUT carries it so the server can delete the keys after
   * its merge/backfill.
   */
  landscapeReset?: string[]
}

const DEFAULT_FLAT_DEFAULTS: Omit<DefaultsState, "landscape"> = {
  defaultBadgeStyle: "shadow",
  defaultRankingBadgeStyle: "default",
  defaultExtraBadgeStyle: null,
  defaultBadgeFont: DEFAULT_BADGE_FONT,
  defaultBadgePresets: null,
  defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
  defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
  defaultBlurEnabled: true,
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultTopShade: 50,
  defaultTopShadeHeight: 25,
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
  defaultAgeBadge: false,
  defaultAgeCountry: DEFAULT_AGE_COUNTRY,
  defaultAgeBadgeStyle: DEFAULT_AGE_BADGE_STYLE,
  defaultCustomRatings: true,
  defaultRatingSources: ["imdb", "tmdb"],
  defaultSeparateRatings: false,
  defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
  defaultPosterLayout: "standard",
  defaultPosterFreshScope: "ranked",
  defaultSashOrder: [...DEFAULT_SASH_ORDER],
  defaultDisabledContentTags: [],
  defaultDisabledNetworks: [],
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
  posterLayout: "standard",
  posterFreshScope: "ranked",
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
  badgeItemTransforms: null,
  defaultBadgeItemTransforms: null,
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
  topShadeHeight: 25,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  extraBadgeStyle: null,
  badgeFont: DEFAULT_BADGE_FONT,
  qualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
  videoFormats: null,
  defaultLogoScale: null,
  defaultLogoOffsetX: null,
  defaultLogoOffsetY: null,
}

const DEFAULTS: DefaultsState = {
  ...DEFAULT_FLAT_DEFAULTS,
  // New settings start fully independent per shape (task 3B1): every mapped
  // key explicit (factory portrait look frozen in), quality at the canonical
  // landscape 0/0 (never the vertical -10/+15) and age at OFF/IT/standard.
  // Legacy stored profiles keep following until their first portrait edit,
  // which snapshots atomically in update() below (same pixels, no leak).
  landscape: independentLandscapeDefaults(
    DEFAULT_FLAT_DEFAULTS as unknown as Record<string, unknown>,
  ),
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
  ageBadge?: boolean
  ageCountry?: string
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
  /** Per-item corrections (canonical wire form); legacy bare alias accepted. */
  defaultBadgeItemTransforms?: string | null
  badgeItemTransforms?: string | null
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
  topShadeHeight?: number
  badgeStyle?: BadgeStyle
  rankingBadgeStyle?: RankingBadgeStyle
  extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  qualityBadgeStyle?: QualityBadgeStyle
  badgeFont?: BadgeFont
  defaultBadgeStyle?: BadgeStyle
  defaultRankingBadgeStyle?: RankingBadgeStyle
  defaultExtraBadgeStyle?: ExtraBadgeStyle | null
  defaultBadgeFont?: BadgeFont
  /** BadgeLab family map dei default (grezza; validata in buildFromStored). */
  defaultBadgePresets?: unknown
  /** Chiave flat server (ServerDefaults.badgePresets): fallback di lettura. */
  badgePresets?: unknown
  defaultQualityBadgeStyle?: QualityBadgeStyle
  defaultBlurEnabled?: boolean
  defaultBlurIntensity?: number
  defaultBlurFade?: number
  defaultBlurDarkness?: number
  defaultTintStrength?: number
  defaultTopShade?: number
  defaultTopShadeHeight?: number
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
  defaultAgeBadge?: boolean
  defaultAgeCountry?: string
  /** Stile pill età (grezzo dallo storage; validato in buildFromStored). */
  defaultAgeBadgeStyle?: AgeBadgeStyle
  /** Chiave flat (scritta da saveDefaults/auto-persist): fallback di lettura. */
  ageBadgeStyle?: AgeBadgeStyle
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
  /** Graphical poster layout (grezzo dallo storage; validato in buildFromStored). */
  defaultPosterLayout?: PosterLayout
  posterLayout?: PosterLayout
  /** Fresh apply scope (grezzo dallo storage; validato in buildFromStored). */
  defaultPosterFreshScope?: PosterFreshScope
  posterFreshScope?: PosterFreshScope
  /** Bucket sash abilitati (grezzi; normalizzati in buildFromStored). */
  defaultSashOrder?: string[]
  /** Chiave server/local piatta (saveDefaults/defaultsToPayload): fallback di lettura. */
  sashOrder?: string[]
  /** Tag badge automatici disabilitati space-wide (grezzi; sanitized in buildFromStored). */
  defaultDisabledContentTags?: string[]
  /** Chiave server/local piatta (saveDefaults/defaultsToPayload): fallback di lettura. */
  disabledContentTags?: string[]
  /** Mark network disabilitati space-wide (grezzi; sanitized in buildFromStored). */
  defaultDisabledNetworks?: string[]
  /** Chiave server/local piatta (saveDefaults/defaultsToPayload): fallback di lettura. */
  disabledNetworks?: string[]
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

/**
 * Committed per-item corrections from the last local defaults save. Used by
 * the title-open path as a hydration-race fallback: the in-memory defaults
 * state can still be the factory `null` at that instant, while the Stremio
 * chain already resolves the persisted value (preview would otherwise send an
 * explicit empty `bit=`, clearing the committed layout). Null when nothing is
 * committed, so an intentional automatic layout stays automatic.
 */
export function readStoredDefaultBadgeItemTransforms(): string | null {
  const d = readStoredDefaults()
  return canonicalizeBadgeItemTransforms(d?.defaultBadgeItemTransforms ?? d?.badgeItemTransforms ?? null)
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

/** Structural equality for flat-edit change detection (arrays/maps by value). */
function flatValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function isPatchLandscapeRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
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
  const out: Record<string, unknown> = { ...base }
  // Solo il ramo tutto-implicito materializza 0/0; il ramo flat-esplicito
  // lascia la chiave ASSENTE (= follow dinamico dei flat, anche futuri).
  // Mai chiavi own-undefined: per lo storage/JSON sono indistinguibili
  // dall'assenza, ma il patch di sessione legge un `undefined` esplicito
  // come clear voluto e lo trasporterebbe come `landscapeReset` fantasma.
  if (landX !== undefined) out.qualityBadgeOffsetX = landX
  else if (flatX === undefined) out.qualityBadgeOffsetX = 0
  if (landY !== undefined) out.qualityBadgeOffsetY = landY
  else if (flatY === undefined) out.qualityBadgeOffsetY = 0
  return out as unknown as LandscapeServerDefaults
}

/**
 * Snapshot esplicito del trio età landscape dai RAW (scelta di migrazione
 * "preserve current appearance"): al PRIMO load con profilo età mai
 * configurato, il landscape eredita i valori flat effettivi dello stored
 * (un legacy ON resta ON in landscape; un legacy OFF resta OFF) così le
 * modifiche portrait successive non leakkano. Solo assente/null/invalido
 * viene congelato; `false` esplicito e valori validi non si toccano mai, né
 * si ri-congelano dopo un update utente (l'auto-persist scrive il profilo
 * seeded e le hydration successive lo ritrovano intatto — mai reseed dal
 * portrait aggiornato). Nuovi settings: OFF/IT/standard indipendenti.
 */
function seedLandscapeAgeTrio(
  rawLandscape: Record<string, unknown> | null | undefined,
  rawFlatAgeBadge: unknown,
  rawFlatAgeCountry: unknown,
  rawFlatAgeBadgeStyle: unknown,
): Pick<LandscapeServerDefaults, "ageBadge" | "ageCountry" | "ageBadgeStyle"> {
  const land: Record<string, unknown> =
    rawLandscape !== null && typeof rawLandscape === "object" && !Array.isArray(rawLandscape)
      ? rawLandscape
      : {}
  const landBadge = land.ageBadge
  const landStyle = typeof land.ageBadgeStyle === "string" ? land.ageBadgeStyle : undefined
  const flatStyle = typeof rawFlatAgeBadgeStyle === "string" ? rawFlatAgeBadgeStyle : undefined
  return {
    ageBadge: typeof landBadge === "boolean"
      ? landBadge
      : (typeof rawFlatAgeBadge === "boolean" ? rawFlatAgeBadge : false),
    ageCountry: normalizeCertificationCountry(land.ageCountry)
      ?? normalizeCertificationCountry(rawFlatAgeCountry)
      ?? DEFAULT_AGE_COUNTRY,
    ageBadgeStyle: isAgeBadgeStyle(landStyle)
      ? landStyle
      : (isAgeBadgeStyle(flatStyle) ? flatStyle : DEFAULT_AGE_BADGE_STYLE),
  }
}

/**
 * Retired Badge Lab family map hydration (custom badge library removed):
 * verbatim pass-through, never sanitized into shape (the editor no longer
 * stages these values and the renderer ignores them). Empty/non-object raws
 * collapse to the same null/undefined sentinels as before so downstream
 * merges stay byte-identical.
 */
function hydrateBadgePresets(
  rawFlat: unknown,
  rawLandscape: unknown,
): { flat: RetiredBadgeFamilyBindings | null; landscape: RetiredBadgeFamilyBindings | null | undefined } {
  const asMap = (raw: unknown): RetiredBadgeFamilyBindings | null =>
    raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0
      ? (raw as RetiredBadgeFamilyBindings)
      : null
  const flatOut = asMap(rawFlat)
  if (rawLandscape === undefined || rawLandscape === null) return { flat: flatOut, landscape: undefined }
  if (typeof rawLandscape !== "object" || Array.isArray(rawLandscape)) return { flat: flatOut, landscape: undefined }
  return { flat: flatOut, landscape: asMap(rawLandscape) ?? undefined }
}

/**
 * Retired Badge Lab landscape profile hydration: verbatim pass-through, only
 * when the saved profile really owns the key. Returns `{}` when there is
 * nothing to merge so the spread stays a no-op.
 */
function hydrateLandscapeBadgePresets(
  rawLandscape: Record<string, unknown> | null | undefined,
): Partial<LandscapeServerDefaults> {
  if (rawLandscape === null || typeof rawLandscape !== "object" || Array.isArray(rawLandscape)) return {}
  if (!Object.prototype.hasOwnProperty.call(rawLandscape, "badgePresets")) return {}
  const raw = (rawLandscape as Record<string, unknown>).badgePresets
  if (raw === null) return { badgePresets: null }
  if (typeof raw !== "object" || Array.isArray(raw)) return {}
  if (Object.keys(raw).length === 0) return {}
  return { badgePresets: raw as RetiredBadgeFamilyBindings }
}

function buildFromStored(d: StoredDefaults | null): DefaultsState {
  // Empty object (fresh backend GET, ancient store) behaves like no store:
  // full independent factory profile instead of a sparse follow-shell, so a
  // first-visit hydration never downgrades the independent initial defaults.
  if (!d || Object.keys(d).length === 0) {
    return {
      ...DEFAULTS,
      landscape: independentLandscapeDefaults(
        DEFAULT_FLAT_DEFAULTS as unknown as Record<string, unknown>,
      ),
    }
  }
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
  // Trio età flat grezzo (stessa risoluzione dei default sotto): alimenta sia
  // i flat portrait sia lo snapshot landscape (mai reseed dopo l'update).
  const flatAgeBadge = d.defaultAgeBadge ?? d.ageBadge
  const flatAgeCountry = d.defaultAgeCountry ?? d.ageCountry
  const flatAgeStyle = d.defaultAgeBadgeStyle ?? d.ageBadgeStyle
  return {
    defaultBadgeStyle: d.defaultBadgeStyle ?? d.badgeStyle ?? "shadow",
    defaultRankingBadgeStyle: d.defaultRankingBadgeStyle ?? d.rankingBadgeStyle ?? "default",
    defaultExtraBadgeStyle: isExtraBadgeStyle(d.defaultExtraBadgeStyle) || isExtraFollowRank(d.defaultExtraBadgeStyle)
      ? (d.defaultExtraBadgeStyle as ExtraBadgeStyle | ExtraBadgeFollowRank)
      : (isExtraBadgeStyle(d.extraBadgeStyle) || isExtraFollowRank(d.extraBadgeStyle) ? (d.extraBadgeStyle as ExtraBadgeStyle | ExtraBadgeFollowRank) : null),
    defaultBadgeFont: isBadgeFont(d.defaultBadgeFont) ? d.defaultBadgeFont : (isBadgeFont(d.badgeFont) ? d.badgeFont : DEFAULT_BADGE_FONT),
    defaultBadgePresets: hydrateBadgePresets(d.defaultBadgePresets ?? d.badgePresets, undefined).flat,
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
    defaultTopShadeHeight: d.defaultTopShadeHeight ?? d.topShadeHeight ?? 25,
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
    // Per-item transforms: canonicalized at the boundary so garbage/unknown
    // identities never enter the state (fail-closed, null = automatic).
    defaultBadgeItemTransforms: canonicalizeBadgeItemTransforms(d.defaultBadgeItemTransforms ?? d.badgeItemTransforms ?? null),
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
    // Badge età portrait: default OFF; paese validato fail-closed su "IT"
    // (mai auto-cambiato con lingua/regione — flat indipendente dalla
    // regione streaming); il landscape ha il suo profilo (vedi sotto).
    defaultAgeBadge: typeof flatAgeBadge === "boolean" ? flatAgeBadge : false,
    defaultAgeCountry: normalizeCertificationCountry(flatAgeCountry) ?? DEFAULT_AGE_COUNTRY,
    // Stile pill età portrait: validato fail-closed su "standard" (mai
    // spazzatura dallo storage — come il font badge).
    defaultAgeBadgeStyle: isAgeBadgeStyle(flatAgeStyle) ? flatAgeStyle : DEFAULT_AGE_BADGE_STYLE,
    defaultCustomRatings: d.defaultCustomRatings ?? d.customRatings ?? true,
    defaultCustomRatingEndpoint: d.defaultCustomRatingEndpoint ?? d.customRatingEndpoint,
    defaultCustomRatingApiKeyHeader: d.defaultCustomRatingApiKeyHeader ?? d.customRatingApiKeyHeader,
    defaultRatingSources: d.defaultRatingSources ?? d.ratingSources ?? ["imdb", "tmdb"],
    defaultSeparateRatings: d.defaultSeparateRatings ?? d.separateRatings ?? false,
    defaultSeparateRatingsStyle: isSeparateRatingsStyle(d.defaultSeparateRatingsStyle)
      ? d.defaultSeparateRatingsStyle
      : (isSeparateRatingsStyle(d.separateRatingsStyle) ? d.separateRatingsStyle : DEFAULT_SEPARATE_RATINGS_STYLE),
    defaultPosterLayout: isPosterLayout(d.defaultPosterLayout)
      ? d.defaultPosterLayout
      : (isPosterLayout(d.posterLayout) ? d.posterLayout : "standard"),
    defaultPosterFreshScope: isPosterFreshScope(d.defaultPosterFreshScope)
      ? d.defaultPosterFreshScope
      : (isPosterFreshScope(d.posterFreshScope) ? d.posterFreshScope : "ranked"),
    defaultSashOrder: normalizeSashOrder(d.defaultSashOrder ?? d.sashOrder) ?? [...DEFAULT_SASH_ORDER],
    // Esclusioni automatiche space-wide (flat condivisi, nessun profilo
    // landscape): allowlist canonica, assente = storico. Mai guess.
    defaultDisabledContentTags: sanitizeDisabledContentTags(d.defaultDisabledContentTags ?? d.disabledContentTags),
    defaultDisabledNetworks: sanitizeDisabledNetworks(d.defaultDisabledNetworks ?? d.disabledNetworks),
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
    posterLayout: isPosterLayout(d.posterLayout)
      ? d.posterLayout
      : (isPosterLayout(d.defaultPosterLayout) ? d.defaultPosterLayout : "standard"),
    posterFreshScope: isPosterFreshScope(d.posterFreshScope)
      ? d.posterFreshScope
      : (isPosterFreshScope(d.defaultPosterFreshScope) ? d.defaultPosterFreshScope : "ranked"),
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
    badgeItemTransforms: canonicalizeBadgeItemTransforms(d.badgeItemTransforms ?? d.defaultBadgeItemTransforms ?? null),
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
    topShadeHeight: d.topShadeHeight ?? d.defaultTopShadeHeight ?? 25,
    badgeStyle: d.badgeStyle ?? d.defaultBadgeStyle ?? "shadow",
    rankingBadgeStyle: d.rankingBadgeStyle ?? d.defaultRankingBadgeStyle ?? "default",
    extraBadgeStyle: isExtraBadgeStyle(d.extraBadgeStyle) || isExtraFollowRank(d.extraBadgeStyle)
      ? (d.extraBadgeStyle as ExtraBadgeStyle | ExtraBadgeFollowRank)
      : (isExtraBadgeStyle(d.defaultExtraBadgeStyle) || isExtraFollowRank(d.defaultExtraBadgeStyle) ? (d.defaultExtraBadgeStyle as ExtraBadgeStyle | ExtraBadgeFollowRank) : null),
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
    // adotta il nuovo default. La chiave "follow" resta ASSENTE (mai un
    // own-undefined, che il patch di sessione leggerebbe come clear voluto);
    // nessuna migrazione degli stored.
    // Trio età seedato dai RAW (scelta "preserve current appearance"): un
    // legacy ON resta ON in landscape, un legacy OFF resta OFF; i nuovi
    // settings partono OFF/IT/standard indipendenti. Mai reseed dopo update.
    landscape: {
      ...seedLandscapeQualityOffsets(
        d.landscape,
        d.defaultQualityBadgeOffsetX ?? d.qualityBadgeOffsetX,
        d.defaultQualityBadgeOffsetY ?? d.qualityBadgeOffsetY,
      ),
      ...seedLandscapeAgeTrio(d.landscape, flatAgeBadge, flatAgeCountry, flatAgeStyle),
      // Family map del profilo: validata fail-closed (malformata = eredita il
      // flat, mai spazzatura id/rev nel live). Null/assente = segue il flat.
      ...hydrateLandscapeBadgePresets(d.landscape),
    },
  }
}

/**
 * Payload dei SOLI default persistiti — allineato allo schema server
 * (`defaultsSchema` in `/api/defaults`) e allo shape scritto da `saveDefaults`.
 * Non include i valori "corrente" (globalBadges, badgeStyle…) che dipendono
 * dal poster in editing.
 */
export function defaultsToPayload(d: DefaultsState): Record<string, unknown> {
  return {
    badgeStyle: d.defaultBadgeStyle,
    rankingBadgeStyle: d.defaultRankingBadgeStyle,
    extraBadgeStyle: d.defaultExtraBadgeStyle ?? null,
    badgeFont: d.defaultBadgeFont,
    badgePresets: d.defaultBadgePresets ?? null,
    qualityBadgeStyle: d.defaultQualityBadgeStyle,
    blurEnabled: d.defaultBlurEnabled,
    blurIntensity: d.defaultBlurIntensity,
    blurFade: d.defaultBlurFade,
    blurDarkness: d.defaultBlurDarkness,
    tintStrength: d.defaultTintStrength,
    topShade: d.defaultTopShade,
    topShadeHeight: d.defaultTopShadeHeight,
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
    // Per-item corrections: ALWAYS emitted, `null` included. PUT /api/defaults
    // MERGES over the stored defaults (a partial payload never clears a key),
    // so omitting the key when the map becomes empty would resurrect the old
    // server-side offsets — exactly the "rejoin the last badge (or the whole
    // group) and the preview keeps the old nudge" bug. `null` is the explicit
    // "automatic layout" clear and the schema accepts it.
    badgeItemTransforms: canonicalizeBadgeItemTransforms(d.defaultBadgeItemTransforms),
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
    ageBadge: d.defaultAgeBadge,
    ageCountry: d.defaultAgeCountry,
    ageBadgeStyle: d.defaultAgeBadgeStyle,
    customRatings: d.defaultCustomRatings,
    // Provider OFF = campo nascosto: un endpoint stale/invalido non deve far
    // fallire l'intero PUT 400 (stessa protezione del Salva manuale).
    customRatingEndpoint: d.defaultCustomRatings ? (d.defaultCustomRatingEndpoint ?? "") : "",
    customRatingApiKeyHeader: d.defaultCustomRatingApiKeyHeader ?? "",
    ratingSources: d.defaultRatingSources,
    separateRatings: d.defaultSeparateRatings,
    separateRatingsStyle: d.defaultSeparateRatingsStyle,
    posterLayout: d.defaultPosterLayout,
    posterFreshScope: d.defaultPosterFreshScope,
    sashOrder: d.defaultSashOrder,
    disabledContentTags: d.defaultDisabledContentTags,
    disabledNetworks: d.defaultDisabledNetworks,
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
    ...(d.landscapeReset && d.landscapeReset.length > 0 ? { landscapeReset: d.landscapeReset } : null),
  }
}

export interface StagedSaveResult {
  ok: boolean
  status: DefaultSyncStatus
  /** Intentional guest skip that still device-saved (truthful local-only). */
  localOnly?: boolean
  /** Payload already matched the persisted truth: no PUT was sent. */
  duplicate?: boolean
  /** Machine-readable failure: not-hydrated | storage | server | namespace | conflict | busy. */
  error?: string
}

/**
 * Install exact staged default fields into live state without touching open
 * per-title bare drafts (same key rule as the hydration live-draft guard:
 * `default*` + `landscape` only). Pure.
 */
function installStagedDefaults(prev: DefaultsState, staged: DefaultsState): DefaultsState {
  const next: DefaultsState = { ...prev }
  const src = staged as unknown as Record<string, unknown>
  const dst = next as unknown as Record<string, unknown>
  for (const key of Object.keys(src)) {
    if (key === "defaultSyncStatus") continue
    if (key === "landscape" || key.startsWith("default")) dst[key] = src[key]
  }
  return next
}

// Total attempts (initial fetch + retries) for hydration GET on 429:
// explicit spec, bounded -- never endless retries against a hot bucket.
const HYDRATION_MAX_ATTEMPTS = 3

// Live per-title draft keys: bare editing-scope fields, never persisted
// (defaultsToPayload carries only default* + landscape -- note its bare-named
// keys like `rankingBadgeStyle` always carry default values, never live
// drafts). Values written here via update() are title/UI scope with no
// dedicated server truth; a late hydration must not reset them to server
// defaults, or just-clicked per-title edits get wiped.
const LIVE_DRAFT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(DEFAULTS).filter((k) => !k.startsWith("default") && k !== "landscape"),
)

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
  // Staged-save ownership: while a saveStagedDefaults PUT owns the wire,
  // legacy auto-persist and server refresh stay out (skip, never overwrite).
  const stagedSavingRef = useRef(false)
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
  // Bare keys explicitly written via update() (per-title drafts, UI-only
  // targets): hydration preserves their live values instead of resetting
  // them to server defaults. Never cleared: values are read live at apply
  // time, so later resets flow through naturally. default* keys are never
  // tracked — server truth always applies to them.
  const touchedLiveRef = useRef<Set<string>>(new Set())
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
  // Optional owner pins a send to the namespace + storage key captured at
  // staged-save entry: any mismatch after an async gap (or before the send)
  // resolves silent WITHOUT touching status, so a profile switch mid-save
  // can never confirm, fail, or announce cross-namespace truth. Legacy
  // callers pass no owner and keep byte-identical behavior.
  const syncSend = useCallback(async (payloadStr: string, seq: number, owner?: { namespace: string | null; storageKey: string }): Promise<boolean> => {
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
    // Guest guard: guest without session stays local-only by design, never
    // overwriting the owner's instance defaults (existing skip semantics).
    if (await shouldSkipServerSync()) {
      if (seq !== syncSeqRef.current || !mountedRef.current) return false
      if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
      // Owner-pinned (staged) failure preserves the prior live dedup ref:
      // clearing it would make the next bare-title update auto-PUT the old
      // live defaults over the staged truth. Legacy callers keep the reset.
      if (!owner) lastPersistRef.current = ""
      setSyncStatus("local-only")
      console.debug("[defaults] Server sync skipped (guest without session, or no profile)")
      void isProfilelessOnMultiUser().then((profileless) => {
        if (profileless) notifyProfilelessOnce()
      })
      return false
    }
    // Slow guard + newer payload: never send a stale PUT after the guard.
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
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
      if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
      if (!owner) lastPersistRef.current = ""
      setSyncStatus("failed")
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[defaults] Auto-sync failed: ${message}`)
      void import("sonner").then(({ toast }) =>
        toast.warning(t("ui.defaultsSyncFailed")),
      )
      return false
    }
    if (seq !== syncSeqRef.current || !mountedRef.current) return false
    if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
    if (res.ok) {
      setSyncStatus("synced")
      return true
    }
    // 401 (admin fail-closed), 403 origin, 5xx persist: il client crede di
    // aver salvato (localStorage) ma i default d'istanza restano vecchi —
    // e su Stremio i poster dei cataloghi usano QUELLI. Segnala il desync.
    // Owner-pinned sends stay silent on a mid-flight namespace switch.
    if (owner && (currentPathUuid() !== owner.namespace || defaultsStorageKey() !== owner.storageKey)) return false
    if (!owner) lastPersistRef.current = ""
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
  // Hydration retry: the shared `defaults` bucket (30 burst / 3 per sec)
  // hits 429 on the hydration GET too under load -- without a retry the
  // editor stayed on factory values for the whole page (previews with
  // rs=default instead of the saved ones). Only 429 waits out Retry-After
  // and retries, at most HYDRATION_MAX_ATTEMPTS total attempts; 401/404/
  // network and persistent 429s keep the previous semantics (unconfirmed,
  // never infinite loading). No speculative 5xx: demonstrated case only.
  const refreshFromServer = useCallback(() => {
    // A staged save owns state while inflight: refresh defers (skips) so a
    // hydration GET can never overwrite the staged operation.
    if (stagedSavingRef.current) return
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
          const serverLand = isPatchLandscapeRecord(
            (serverData as Record<string, unknown> | null)?.landscape,
          )
            ? ((serverData as Record<string, unknown>).landscape as Record<string, unknown>)
            : null
          const localLand = isPatchLandscapeRecord(currentStored?.landscape)
            ? (currentStored as StoredDefaults & { landscape: Record<string, unknown> }).landscape
            : null
          const merged: StoredDefaults = {
            ...(serverData || {}),
            ...(currentStored || {}),
          }
          // Landscape deep-merge (task 3B1): a shallow spread would drop the
          // side the other payload doesn't carry (local snapshot keys vs
          // server backfilled keys). Local wins per key; the seeded/snapshotted
          // profile survives hydration instead of being rebased.
          if (serverLand || localLand) {
            merged.landscape = { ...(serverLand ?? {}), ...(localLand ?? {}) }
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
          // Esclusioni space-wide: adotta il server quando nessun locale le
          // definisce (stessa precedenza locale del sash sopra).
          if (!currentStored?.defaultDisabledContentTags && !currentStored?.disabledContentTags && Array.isArray(serverData.disabledContentTags)) {
            merged.defaultDisabledContentTags = serverData.disabledContentTags
          }
          if (!currentStored?.defaultDisabledNetworks && !currentStored?.disabledNetworks && Array.isArray(serverData.disabledNetworks)) {
            merged.defaultDisabledNetworks = serverData.disabledNetworks
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
          // Live drafts win over hydration: re-apply the current values of
          // keys written via update() since they carry title/UI scope with
          // no server truth. Untouched keys (and all default*) hydrate
          // normally; values are read live so later resets hold.
          setState((prev) => {
            if (touchedLiveRef.current.size === 0) return updated
            const keep: Partial<DefaultsState> = {}
            for (const key of touchedLiveRef.current) {
              const k = key as keyof DefaultsState
              ;(keep as Record<string, unknown>)[key] = prev[k]
            }
            return { ...updated, ...keep }
          })
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
    // A staged save owns the wire while inflight: never bump/abort its
    // sequence from here (no supersede, no double PUT).
    if (stagedSavingRef.current) return
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
    setState((prev) => {
      const resolved = typeof patch === "function" ? patch(prev) : patch
      // Record live-draft keys here (not in the body) so the function form
      // is covered too; Set-add is idempotent under StrictMode re-invokes.
      for (const key of Object.keys(resolved)) {
        if (LIVE_DRAFT_KEYS.has(key)) touchedLiveRef.current.add(key)
      }
      // Strict shape independence (task 3B1): a portrait (flat) edit freezes
      // the PRE-EDIT effective value into the landscape profile for every
      // changed key the profile still inherits — atomically with the edit, so
      // there is no window where the landscape follows the new flat (the
      // leak the old `land ?? flat` read had). Changed-only (surgical
      // sparsity preserved: untouched keys keep inheriting, pixels identical
      // either way); explicit profile keys (incl. logo/extra `null`s) are
      // never overwritten, never rebased after the edit. Pure landscape
      // patches (no flat change) snapshot nothing.
      const changedFlatKeys = Object.keys(SHAPE_FLAT_TO_LANDSCAPE).filter(
        (flatKey) =>
          flatKey in resolved &&
          !flatValuesEqual(
            (resolved as unknown as Record<string, unknown>)[flatKey],
            (prev as unknown as Record<string, unknown>)[flatKey],
          ),
      )
      if (changedFlatKeys.length === 0) return { ...prev, ...resolved }
      const prevLand = (
        isPatchLandscapeRecord(prev.landscape)
          ? prev.landscape
          : {}
      ) as unknown as Record<string, unknown>
      const patchLand = isPatchLandscapeRecord(resolved.landscape)
        ? (resolved.landscape as unknown as Record<string, unknown>)
        : null
      const adds = snapshotMissingLandscape(
        prev as unknown as Record<string, unknown>,
        patchLand ? { ...prevLand, ...patchLand } : prevLand,
        changedFlatKeys,
      )
      if (Object.keys(adds).length === 0 && !patchLand) return { ...prev, ...resolved }
      return {
        ...prev,
        ...resolved,
        landscape: { ...prevLand, ...adds, ...(patchLand ?? {}) },
      }
    })
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

  // Authoritative explicit staged save (settings draft foundation): same
  // defaultsToPayload serializer + syncSend transport/sequence/status
  // machinery as auto-sync, exactly one PUT, no subsequent auto-effect
  // duplicate (lastPersistRef is primed with the staged payload, so the
  // install below dedups the effect). No dedup shortcut: every call sends
  // (Save is disabled while clean at the UI layer); concurrent calls
  // refuse busy and never supersede/abort the inflight first save. No
  // optimistic device write: the PUT goes first, durable storage + live
  // install happen ONLY on ACK; a reject leaves storage and live state
  // exactly as found. A post-ACK storage failure reports truthful
  // local-failed (the server may hold the update) with the draft retained
  // for retry — never a rollback illusion. Namespace + storage key are
  // captured at entry and re-verified after every async guard and before
  // send/write/install. Intentional guest skip device-saves like auto-sync
  // and counts as local success with a truthful local-only status (never
  // a false synced).
  const saveStagedDefaults = useCallback(async (staged: DefaultsState): Promise<StagedSaveResult> => {
    if (stagedSavingRef.current) return { ok: false, status: syncStatus, error: "busy" }
    if (!hydrated || !mountedRef.current) return { ok: false, status: "idle", error: "not-hydrated" }
    // Ownership capture: namespace + exact storage key at entry. Every async
    // guard below re-verifies them before any send, write, or install, so a
    // profile switch mid-save can never persist cross-namespace truth.
    const namespace = currentPathUuid()
    const storageKey = defaultsStorageKey()
    const stillOwned = (): boolean =>
      mountedRef.current && currentPathUuid() === namespace && defaultsStorageKey() === storageKey
    const payloadStr = JSON.stringify(defaultsToPayload(staged))
    // Own the wire + state: invalidate the legacy debounce/inflight PUT and
    // the active refresh generation first (stale chains resolve silent via
    // the seq/gen guards). No duplicate shortcut: identical payloads send.
    stagedSavingRef.current = true
    const seq = ++syncSeqRef.current
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    syncAbortRef.current?.abort()
    refreshSeqRef.current += 1
    refreshAbortRef.current?.abort()
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    const done = (): void => {
      stagedSavingRef.current = false
    }
    // Staged lock is released in `finally`: a rejecting guard (first or
    // second await) must never leave it permanently busy. Failure paths
    // preserve lastPersistRef (the prior live truth) so a later bare-title
    // update cannot auto-PUT stale defaults over the staged outcome.
    try {
    // Intentional guest skip (namespace/identity guard): device-save only,
    // never a PUT. Verified owned after the (async) guard.
    if (await shouldSkipServerSync()) {
      if (!stillOwned() || seq !== syncSeqRef.current) {
        return { ok: false, status: "local-only", localOnly: true, error: "namespace" }
      }
      if (!safeSetItem(storageKey, payloadStr)) {
        setSyncStatus("local-failed")
        return { ok: false, status: "local-failed", localOnly: true, error: "storage" }
      }
      lastPersistRef.current = payloadStr
      setState((prev) => installStagedDefaults(prev, staged))
      setSyncStatus("local-only")
      console.debug("[defaults] Staged save kept local (guest without session, or no profile)")
      void isProfilelessOnMultiUser().then((profileless) => {
        if (profileless) notifyProfilelessOnce()
      })
      return { ok: true, status: "local-only", localOnly: true }
    }
    if (!stillOwned() || seq !== syncSeqRef.current || !mountedRef.current) {
      return { ok: false, status: syncStatus, error: "namespace" }
    }
    // Non-guest: exactly one PUT first, durable + live writes ONLY on ACK.
    setSyncStatus("pending")
    const confirmed = await syncSend(payloadStr, seq, { namespace, storageKey })
    if (!stillOwned() || seq !== syncSeqRef.current || !mountedRef.current) {
      return { ok: false, status: "pending", error: "namespace" }
    }
    if (!confirmed) {
      return { ok: false, status: "failed", error: "server" }
    }
    // ACKed but not yet durable: a storage failure here is truthful
    // local-failed (the server may hold the update), live state stays
    // untouched and the draft is retained for retry — no rollback illusion.
    // lastPersistRef stays on the prior live truth (never cleared): the
    // next bare-title update dedups instead of rewriting old defaults.
    if (!safeSetItem(storageKey, payloadStr)) {
      setSyncStatus("local-failed")
      return { ok: false, status: "local-failed", error: "storage" }
    }
    lastPersistRef.current = payloadStr
    setState((prev) => installStagedDefaults(prev, staged))
    return { ok: true, status: "synced" }
    } catch {
      // Guard/fetch rejection: truthful failure, draft retained, no writes.
      if (!stillOwned() || seq !== syncSeqRef.current || !mountedRef.current) {
        return { ok: false, status: "pending", error: "namespace" }
      }
      setSyncStatus("failed")
      return { ok: false, status: "failed", error: "server" }
    } finally {
      done()
    }
  }, [hydrated, syncSend, syncStatus])

  return { ...state, update, loadDefaultsToState, defaultSyncStatus: syncStatus, retryDefaultSync, saveStagedDefaults }
}
