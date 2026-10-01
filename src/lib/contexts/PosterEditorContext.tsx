"use client"

import { createContext, useContext, useState, useMemo, useCallback } from "react"
import type { TMDBImage, NetworkLogoPosition, PosterShape } from "@/lib/types"
import { useDefaults } from "@/lib/useDefaults"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { DateFormat } from "@/lib/release-badge"
import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle } from "@/lib/badge-styles"
import type { SashBucket } from "@/lib/badge-priority"
import type { VideoFormat } from "@/lib/av-specs"

/**
 * PosterEditorCtx — possiede il proprio stato di editing (badge defaults,
 * posizionamento logo/backdrop, rotazione, esclusioni).
 * È il SINGLE SOURCE OF TRUTH per tutti i campi editor.
 *
 * I consumer che usano SOLO usePosterEditor() (es. BadgeControls, TransformControls)
 * NON ri-renderizzano quando cambia trending/search/navigation.
 */
/**
 * Profilo sfumatura/blur landscape (sezione Trasforma · Orizzontale).
 * Sottoinsieme dei campi di LandscapeSettings (sfumatura completa, non badge:
 * quelli restano flat + stash al cambio formato). Valori sempre concreti,
 * inizializzati all'apertura titolo.
 */
export interface LandscapeBlurState {
  gradientHeight: number
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  topShade: number
}

/** Default di formato per il profilo landscape (mirror server/stremio-poster-url: fade 70). */
export const LANDSCAPE_BLUR_DEFAULTS: LandscapeBlurState = {
  gradientHeight: 30,
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 70,
  blurDarkness: 30,
  tintStrength: 20,
  topShade: 50,
}

export interface PosterEditorCtx {
  // ---- Badges ----
  globalBadges: boolean
  setGlobalBadges: (v: boolean | ((prev: boolean) => boolean)) => void
  rankingBadges: boolean
  setRankingBadges: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Componenti del badge genere/rating (default tutti ON). */
  badgeGenre: boolean
  setBadgeGenre: (v: boolean | ((prev: boolean) => boolean)) => void
  badgeYear: boolean
  setBadgeYear: (v: boolean | ((prev: boolean) => boolean)) => void
  badgeRating: boolean
  setBadgeRating: (v: boolean | ((prev: boolean) => boolean)) => void
  badgeQuality: boolean
  setBadgeQuality: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Riga rating custom provider (default ON quando il provider è configurato). */
  customRatings: boolean
  setCustomRatings: (v: boolean | ((prev: boolean) => boolean)) => void
  ratingSources: string[]
  setRatingSources: (v: string[] | ((prev: string[]) => string[])) => void
  /** Colonna rating separati a destra (sostituisce la media ★, default OFF). */
  separateRatings: boolean
  setSeparateRatings: (v: boolean | ((prev: boolean) => boolean)) => void
  badgeStyle: BadgeStyle
  setBadgeStyle: (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => void
  rankingBadgeStyle: RankingBadgeStyle
  setRankingBadgeStyle: (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => void
  /** Stile icone del badge qualità del poster in editing. */
  qualityBadgeStyle: QualityBadgeStyle
  setQualityBadgeStyle: (v: QualityBadgeStyle | ((prev: QualityBadgeStyle) => QualityBadgeStyle)) => void
  /** Formati A/V del poster in editing. */
  videoFormats: VideoFormat[] | null
  setVideoFormats: (v: VideoFormat[] | null | ((prev: VideoFormat[] | null) => VideoFormat[] | null)) => void
  customBadge: string | null
  setCustomBadge: (v: string | null | ((prev: string | null) => string | null)) => void
  badgePresetId: string | null
  setBadgePresetId: (v: string | null | ((prev: string | null) => string | null)) => void
  badgePresetRev: string | null
  setBadgePresetRev: (v: string | null | ((prev: string | null) => string | null)) => void
  networkLogo: boolean
  setNetworkLogo: (v: boolean | ((prev: boolean) => boolean)) => void
  networkLogoPosition: NetworkLogoPosition
  setNetworkLogoPosition: (v: NetworkLogoPosition | ((prev: NetworkLogoPosition) => NetworkLogoPosition)) => void
  preRelease: boolean
  setPreRelease: (v: boolean | ((prev: boolean) => boolean)) => void
  ribbonSide: "left" | "right"
  setRibbonSide: (v: "left" | "right" | ((prev: "left" | "right") => "left" | "right")) => void
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). */
  ribbonEnabled: boolean
  setRibbonEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Allineamento blocco logo/metadati del poster in editing. */
  logoAlign: "left" | "center"
  setLogoAlign: (v: "left" | "center" | ((prev: "left" | "center") => "left" | "center")) => void
  /** Formato canvas del poster in editing (switch per-titolo in EditView). */
  posterShape: PosterShape
  setPosterShape: (v: PosterShape | ((prev: PosterShape) => PosterShape)) => void
  episodeMetadataSource: "tmdb" | "tvdb"
  setEpisodeMetadataSource: (v: "tmdb" | "tvdb" | ((prev: "tmdb" | "tvdb") => "tmdb" | "tvdb")) => void
  region: string
  setRegion: (v: string | ((prev: string) => string)) => void

  // ---- Defaults ----
  defaultBadgeStyle: BadgeStyle
  setDefaultBadgeStyle: (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => void
  defaultRankingBadgeStyle: RankingBadgeStyle
  setDefaultRankingBadgeStyle: (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => void
  /** Stile icone del badge qualità di default. */
  defaultQualityBadgeStyle: QualityBadgeStyle
  setDefaultQualityBadgeStyle: (v: QualityBadgeStyle | ((prev: QualityBadgeStyle) => QualityBadgeStyle)) => void
  /** Formati A/V di default. */
  defaultVideoFormats: VideoFormat[]
  setDefaultVideoFormats: (v: VideoFormat[] | ((prev: VideoFormat[]) => VideoFormat[])) => void
  defaultEpisodeMetadataSource: "tmdb" | "tvdb"
  setDefaultEpisodeMetadataSource: (v: "tmdb" | "tvdb" | ((prev: "tmdb" | "tvdb") => "tmdb" | "tvdb")) => void
  defaultBlurEnabled: boolean
  setDefaultBlurEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultBlurIntensity: number
  setDefaultBlurIntensity: (v: number | ((prev: number) => number)) => void
  defaultTintStrength: number
  setDefaultTintStrength: (v: number | ((prev: number) => number)) => void
  defaultBlurFade: number
  setDefaultBlurFade: (v: number | ((prev: number) => number)) => void
  defaultBlurDarkness: number
  setDefaultBlurDarkness: (v: number | ((prev: number) => number)) => void
  defaultGradientHeight: number
  setDefaultGradientHeight: (v: number | ((prev: number) => number)) => void
  /** Scala % logo di default (null = auto-fit per aspect, storico). */
  defaultLogoScale: number | null
  setDefaultLogoScale: (v: number | null | ((prev: number | null) => number | null)) => void
  /** Offset px logo di default (null = 0). */
  defaultLogoOffsetX: number | null
  setDefaultLogoOffsetX: (v: number | null | ((prev: number | null) => number | null)) => void
  defaultLogoOffsetY: number | null
  setDefaultLogoOffsetY: (v: number | null | ((prev: number | null) => number | null)) => void
  defaultTopBadgeScale: number
  setDefaultTopBadgeScale: (v: number | ((prev: number) => number)) => void
  defaultTopBadgeOffsetX: number
  setDefaultTopBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  defaultTopBadgeOffsetY: number
  setDefaultTopBadgeOffsetY: (v: number | ((prev: number) => number)) => void
  defaultGenreBadgeScale: number
  setDefaultGenreBadgeScale: (v: number | ((prev: number) => number)) => void
  defaultQualityBadgeScale: number
  setDefaultQualityBadgeScale: (v: number | ((prev: number) => number)) => void
  defaultNetworkLogoScale: number
  setDefaultNetworkLogoScale: (v: number | ((prev: number) => number)) => void
  defaultNetworkLogoOffsetX: number
  setDefaultNetworkLogoOffsetX: (v: number | ((prev: number) => number)) => void
  defaultNetworkLogoOffsetY: number
  setDefaultNetworkLogoOffsetY: (v: number | ((prev: number) => number)) => void
  defaultGenreBadgeOffsetX: number
  setDefaultGenreBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  defaultGenreBadgeOffsetY: number
  setDefaultGenreBadgeOffsetY: (v: number | ((prev: number) => number)) => void
  defaultQualityBadgeOffsetX: number
  setDefaultQualityBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  defaultQualityBadgeOffsetY: number
  setDefaultQualityBadgeOffsetY: (v: number | ((prev: number) => number)) => void
  defaultGlobalBadges: boolean
  setDefaultGlobalBadges: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultRankingBadges: boolean
  setDefaultRankingBadges: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultBadgeGenre: boolean
  setDefaultBadgeGenre: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultBadgeYear: boolean
  setDefaultBadgeYear: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultBadgeRating: boolean
  setDefaultBadgeRating: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultBadgeQuality: boolean
  setDefaultBadgeQuality: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultCustomRatings: boolean
  setDefaultCustomRatings: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Endpoint provider custom rating (non-segreto; chiave solo env). */
  defaultCustomRatingEndpoint?: string
  setDefaultCustomRatingEndpoint: (v: string | undefined | ((prev: string | undefined) => string | undefined)) => void
  defaultCustomRatingApiKeyHeader?: string
  setDefaultCustomRatingApiKeyHeader: (v: string | undefined | ((prev: string | undefined) => string | undefined)) => void
  defaultRatingSources: string[]
  setDefaultRatingSources: (v: string[] | ((prev: string[]) => string[])) => void
  defaultSeparateRatings: boolean
  setDefaultSeparateRatings: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Bucket sash abilitati (ordine canonico; vuota = tutto spento). */
  defaultSashOrder: SashBucket[]
  setDefaultSashOrder: (v: SashBucket[] | ((prev: SashBucket[]) => SashBucket[])) => void
  defaultAutoRotateClean: boolean
  setDefaultAutoRotateClean: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Disattiva i poster clean TMDB nella selezione automatica (default OFF). */
  defaultDisableCleanPosters: boolean
  setDefaultDisableCleanPosters: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultAutoRotateBackdrop: boolean
  setDefaultAutoRotateBackdrop: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Best-fit automatico per formato (sdoppiato dal vecchio flag unico). */
  defaultPortraitFitEnabled: boolean
  setDefaultPortraitFitEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultLandscapeFitEnabled: boolean
  setDefaultLandscapeFitEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultNetworkLogo: boolean
  setDefaultNetworkLogo: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultNetworkLogoPosition: NetworkLogoPosition
  setDefaultNetworkLogoPosition: (v: NetworkLogoPosition | ((prev: NetworkLogoPosition) => NetworkLogoPosition)) => void
  defaultPreRelease: boolean
  setDefaultPreRelease: (v: boolean | ((prev: boolean) => boolean)) => void
  defaultRibbonSide: "left" | "right"
  setDefaultRibbonSide: (v: "left" | "right" | ((prev: "left" | "right") => "left" | "right")) => void
  /** Nastro stile Netflix all'angolo di default (false = badge classifica centrato). */
  defaultRibbonEnabled: boolean
  setDefaultRibbonEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Allineamento di default (null = default di formato). */
  defaultLogoAlign: "left" | "center" | null
  setDefaultLogoAlign: (v: "left" | "center" | null | ((prev: "left" | "center" | null) => "left" | "center" | null)) => void
  /** Formato canvas di default (Impostazioni globali). */
  defaultPosterShape: PosterShape
  setDefaultPosterShape: (v: PosterShape | ((prev: PosterShape) => PosterShape)) => void
  /**
   * Profilo default landscape (Impostazioni · Orizzontale): chiavi assenti
   * seguono i flat (portrait). Patch parziale; reset = segui tutto.
   */
  landscape: LandscapeServerDefaults
  setLandscape: (patch: Partial<LandscapeServerDefaults>) => void
  resetLandscape: () => void
  defaultRegion: string
  setDefaultRegion: (v: string | ((prev: string) => string)) => void
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  defaultDateFormat: DateFormat
  setDefaultDateFormat: (v: DateFormat | ((prev: DateFormat) => DateFormat)) => void
  loadDefaultsToState: () => void

  // ---- Blur ----
  blurEnabled: boolean
  setBlurEnabled: (v: boolean | ((prev: boolean) => boolean)) => void
  blurIntensity: number
  setBlurIntensity: (v: number | ((prev: number) => number)) => void
  /**
   * Sfumatura/blur del profilo landscape (sezione Trasforma · Orizzontale):
   * valori live indipendenti dai flat (profilo portrait). Inizializzati
   * all'apertura titolo da mapping.landscape > default di formato.
   */
  landscapeBlur: LandscapeBlurState
  setLandscapeBlur: (patch: Partial<LandscapeBlurState>) => void
  resetLandscapeBlur: (values: LandscapeBlurState) => void
  /** True se la sezione Orizzontale è stata toccata nella sessione (guida il save). */
  landscapeBlurDirty: boolean
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength: number
  setTintStrength: (v: number | ((prev: number) => number)) => void
  /** Ombra lineare superiore 0-100 in editing (solo per-titolo, default 0). */
  topShade: number
  setTopShade: (v: number | ((prev: number) => number)) => void
  /** Ombra superiore di default 0-100 (Impostazioni globali, default 50). */
  defaultTopShade: number
  setDefaultTopShade: (v: number | ((prev: number) => number)) => void
  blurFade: number
  setBlurFade: (v: number | ((prev: number) => number)) => void
  blurDarkness: number
  setBlurDarkness: (v: number | ((prev: number) => number)) => void

  // ---- Gradient ----
  gradientHeight: number
  setGradientHeight: (v: number | ((prev: number) => number)) => void

  // ---- Badge superiore (rank/extra in alto) ----
  topBadgeScale: number
  setTopBadgeScale: (v: number | ((prev: number) => number)) => void
  topBadgeOffsetX: number
  setTopBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  topBadgeOffsetY: number
  setTopBadgeOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Badge genere/rating in basso ----
  genreBadgeScale: number
  setGenreBadgeScale: (v: number | ((prev: number) => number)) => void
  genreBadgeOffsetX: number
  setGenreBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  genreBadgeOffsetY: number
  setGenreBadgeOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Badge qualità streaming ----
  qualityBadgeScale: number
  setQualityBadgeScale: (v: number | ((prev: number) => number)) => void
  qualityBadgeOffsetX: number
  setQualityBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  qualityBadgeOffsetY: number
  setQualityBadgeOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Logo network ----
  networkLogoScale: number
  setNetworkLogoScale: (v: number | ((prev: number) => number)) => void
  networkLogoOffsetX: number
  setNetworkLogoOffsetX: (v: number | ((prev: number) => number)) => void
  networkLogoOffsetY: number
  setNetworkLogoOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Logo ----
  logoScale: number
  setLogoScale: (v: number | ((prev: number) => number)) => void
  logoOffsetX: number
  setLogoOffsetX: (v: number | ((prev: number) => number)) => void
  logoOffsetY: number
  setLogoOffsetY: (v: number | ((prev: number) => number)) => void
  logoDisabled: boolean
  setLogoDisabled: (v: boolean | ((prev: boolean) => boolean)) => void
  // ---- Backdrop ----
  backdrops: TMDBImage[]
  setBackdrops: (v: TMDBImage[] | ((prev: TMDBImage[]) => TMDBImage[])) => void
  selectedBackdrop: TMDBImage | null
  setSelectedBackdrop: (v: TMDBImage | null | ((prev: TMDBImage | null) => TMDBImage | null)) => void
  backdropScale: number
  setBackdropScale: (v: number | ((prev: number) => number)) => void
  backdropOffsetX: number
  setBackdropOffsetX: (v: number | ((prev: number) => number)) => void
  backdropOffsetY: number
  setBackdropOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Rotation / esclusioni ----
  rotationPosters: string[]
  setRotationPosters: (v: string[] | ((prev: string[]) => string[])) => void
  autoRotateClean: boolean
  setAutoRotateClean: (v: boolean | ((prev: boolean) => boolean)) => void
  excludedPosters: string[]
  setExcludedPosters: (v: string[] | ((prev: string[]) => string[])) => void
  /** Rotazione 24h sfondi landscape (mirror verticale, stato per-titolo). */
  rotationBackdrops: string[]
  setRotationBackdrops: (v: string[] | ((prev: string[]) => string[])) => void
  autoRotateBackdrop: boolean
  setAutoRotateBackdrop: (v: boolean | ((prev: boolean) => boolean)) => void
  excludedBackdrops: string[]
  setExcludedBackdrops: (v: string[] | ((prev: string[]) => string[])) => void

  // ---- Episode Group (TV Series parts/seasons order) ----
  episodeGroupId: string | null
  setEpisodeGroupId: (v: string | null | ((prev: string | null) => string | null)) => void
}

const Ctx = createContext<PosterEditorCtx | null>(null)

export function usePosterEditor() {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosterEditor must be inside PosterEditorProvider")
  return v
}

/**
 * PosterEditorProvider — ORA possiede il proprio stato.
 * Non dipende più da PictoriumCtx.
 * Crea useDefaults() internamente per badge/blur/gradient defaults persistenti,
 * e useState per logo/backdrop/rotazione/editing.
 */
export function PosterEditorProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const defaults = useDefaults()

  // ---- Logo state ----
  const [logoScale, setLogoScale] = useState(75)
  const [logoOffsetX, setLogoOffsetX] = useState(0)
  const [logoOffsetY, setLogoOffsetY] = useState(0)
  const [logoDisabled, setLogoDisabled] = useState(false)

  // ---- Backdrop state ----
  const [backdrops, setBackdrops] = useState<TMDBImage[]>([])
  const [selectedBackdrop, setSelectedBackdrop] = useState<TMDBImage | null>(null)
  const [backdropScale, setBackdropScale] = useState(100)
  const [backdropOffsetX, setBackdropOffsetX] = useState(0)
  const [backdropOffsetY, setBackdropOffsetY] = useState(0)

  // ---- Rotation / esclusioni ----
  const [rotationPosters, setRotationPosters] = useState<string[]>([])
  const [autoRotateClean, setAutoRotateClean] = useState(false)
  const [excludedPosters, setExcludedPosters] = useState<string[]>([])
  const [rotationBackdrops, setRotationBackdrops] = useState<string[]>([])
  const [autoRotateBackdrop, setAutoRotateBackdrop] = useState(false)
  const [excludedBackdrops, setExcludedBackdrops] = useState<string[]>([])

  // ---- Episode Group state ----
  const [episodeGroupId, setEpisodeGroupId] = useState<string | null>(null)

  // ---- Custom badge ----
  const [customBadge, setCustomBadge] = useState<string | null>(null)
  const [badgePresetId, setBadgePresetId] = useState<string | null>(null)
  const [badgePresetRev, setBadgePresetRev] = useState<string | null>(null)

  const {
    globalBadges, rankingBadges, networkLogo, networkLogoPosition, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings,
    gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, topShade,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    badgeStyle, rankingBadgeStyle, qualityBadgeStyle, videoFormats,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultQualityBadgeStyle, defaultVideoFormats,
    defaultBlurEnabled, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultTintStrength, defaultTopShade,
    defaultGradientHeight, defaultGlobalBadges, defaultRankingBadges,
    defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY,
    defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY,
    defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale,
    defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY,
    defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY,
    defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultCustomRatings, defaultCustomRatingEndpoint, defaultCustomRatingApiKeyHeader, defaultRatingSources, defaultSeparateRatings, defaultSashOrder,
    defaultAutoRotateClean, defaultAutoRotateBackdrop, defaultPortraitFitEnabled, defaultLandscapeFitEnabled, defaultNetworkLogo, defaultNetworkLogoPosition, defaultPreRelease, defaultRibbonSide, defaultRibbonEnabled, defaultPosterShape, defaultLogoAlign,
    defaultDisableCleanPosters,
    landscape: landscapeDefaults,
    episodeMetadataSource, defaultEpisodeMetadataSource,
    region, defaultRegion, defaultDateFormat,
    loadDefaultsToState, update,
  } = defaults

  const setGlobalBadges = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(globalBadges) : v
      update({ globalBadges: next })
    }, [globalBadges, update])
  const setRankingBadges = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(rankingBadges) : v
      update({ rankingBadges: next })
    }, [rankingBadges, update])
  const setBadgeGenre = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(badgeGenre) : v
      update({ badgeGenre: next })
    }, [badgeGenre, update])
  const setBadgeYear = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(badgeYear) : v
      update({ badgeYear: next })
    }, [badgeYear, update])
  const setBadgeRating = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(badgeRating) : v
      update({ badgeRating: next })
    }, [badgeRating, update])
  const setBadgeQuality = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(badgeQuality) : v
      update({ badgeQuality: next })
    }, [badgeQuality, update])
  const setCustomRatings = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(customRatings) : v
      update({ customRatings: next })
    }, [customRatings, update])
  const setRatingSources = useCallback(
    (v: string[] | ((prev: string[]) => string[])) => {
      const next = typeof v === "function" ? v(ratingSources) : v
      update({ ratingSources: next })
    }, [ratingSources, update])
  const setSeparateRatings = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(separateRatings) : v
      update({ separateRatings: next })
    }, [separateRatings, update])
  const setNetworkLogo = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(networkLogo) : v
      update({ networkLogo: next })
    }, [networkLogo, update])
  const setNetworkLogoPosition = useCallback(
    (v: NetworkLogoPosition | ((prev: NetworkLogoPosition) => NetworkLogoPosition)) => {
      const next = typeof v === "function" ? v(networkLogoPosition) : v
      update({ networkLogoPosition: next })
    }, [networkLogoPosition, update])
  const setPreRelease = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(preRelease) : v
      update({ preRelease: next })
    }, [preRelease, update])
  const setRibbonSide = useCallback(
    (v: "left" | "right" | ((prev: "left" | "right") => "left" | "right")) => {
      const next = typeof v === "function" ? v(ribbonSide) : v
      update({ ribbonSide: next })
    }, [ribbonSide, update])
  const setRibbonEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(ribbonEnabled) : v
      update({ ribbonEnabled: next })
    }, [ribbonEnabled, update])
  const setPosterShape = useCallback(
    (v: PosterShape | ((prev: PosterShape) => PosterShape)) => {
      const next = typeof v === "function" ? v(posterShape) : v
      // Solo allineamento: i valori sfumatura sono profili dedicati per
      // formato (flat = portrait, landscapeBlur = landscape) e non si
      // toccano al cambio formato.
      update({
        posterShape: next,
        logoAlign: next === "landscape" ? (defaultLogoAlign ?? "left") : "center",
      })
    }, [posterShape, update, defaultLogoAlign])
  // Regola di split corrente/default (vale per TUTTI i setter di questo file):
  // i setter dell'editor (setX) scrivono solo il valore corrente del poster
  // aperto, i setter delle Impostazioni (setDefaultX) solo il default globale.
  // I flussi automatici (apertura/selezione poster, slider del poster corrente)
  // non devono riscrivere il default salvato, altrimenti al rientro il default
  // risulta "cambiato da solo"; e cambiare un default non deve riscrivere il
  // poster aperto, altrimenti il salvataggio per-titolo non congela nulla.
  const setGradientHeight = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(gradientHeight) : v
      update({ gradientHeight: next })
    }, [gradientHeight, update])
  const setTopBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(topBadgeScale) : v
      update({ topBadgeScale: next })
    }, [topBadgeScale, update])
  const setTopBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(topBadgeOffsetX) : v
      update({ topBadgeOffsetX: next })
    }, [topBadgeOffsetX, update])
  const setTopBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(topBadgeOffsetY) : v
      update({ topBadgeOffsetY: next })
    }, [topBadgeOffsetY, update])
  const setGenreBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(genreBadgeScale) : v
      update({ genreBadgeScale: next })
    }, [genreBadgeScale, update])
  const setGenreBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(genreBadgeOffsetX) : v
      update({ genreBadgeOffsetX: next })
    }, [genreBadgeOffsetX, update])
  const setGenreBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(genreBadgeOffsetY) : v
      update({ genreBadgeOffsetY: next })
    }, [genreBadgeOffsetY, update])
  const setQualityBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(qualityBadgeScale) : v
      update({ qualityBadgeScale: next })
    }, [qualityBadgeScale, update])
  const setQualityBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(qualityBadgeOffsetX) : v
      update({ qualityBadgeOffsetX: next })
    }, [qualityBadgeOffsetX, update])
  const setQualityBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(qualityBadgeOffsetY) : v
      update({ qualityBadgeOffsetY: next })
    }, [qualityBadgeOffsetY, update])
  const setNetworkLogoScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(networkLogoScale) : v
      update({ networkLogoScale: next })
    }, [networkLogoScale, update])
  const setNetworkLogoOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(networkLogoOffsetX) : v
      update({ networkLogoOffsetX: next })
    }, [networkLogoOffsetX, update])
  const setNetworkLogoOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(networkLogoOffsetY) : v
      update({ networkLogoOffsetY: next })
    }, [networkLogoOffsetY, update])
  const setBlurIntensity = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(blurIntensity) : v
      update({ blurIntensity: next })
    }, [blurIntensity, update])
  const setTintStrength = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(tintStrength) : v
      update({ tintStrength: next })
    }, [tintStrength, update])
  const setTopShade = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(topShade) : v
      update({ topShade: next })
    }, [topShade, update])
  const setDefaultTopShade = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTopShade) : v
      update({ defaultTopShade: next })
    }, [defaultTopShade, update])
  const setBlurFade = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(blurFade) : v
      update({ blurFade: next })
    }, [blurFade, update])
  const setBlurDarkness = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(blurDarkness) : v
      update({ blurDarkness: next })
    }, [blurDarkness, update])
  const setBlurEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(blurEnabled) : v
      update({ blurEnabled: next })
    }, [blurEnabled, update])
  // Profilo sfumatura landscape (Trasforma · Orizzontale): stato per-titolo
  // indipendente dai flat (profilo portrait). Ogni patch utente alza il flag
  // dirty (guida il save); resetLandscapeBlur lo reinizializza (apertura titolo).
  const [landscapeBlur, setLandscapeBlurState] = useState<LandscapeBlurState>(LANDSCAPE_BLUR_DEFAULTS)
  const [landscapeBlurDirty, setLandscapeBlurDirty] = useState(false)
  const setLandscapeBlur = useCallback(
    (patch: Partial<LandscapeBlurState>) => {
      setLandscapeBlurState((prev) => ({ ...prev, ...patch }))
      setLandscapeBlurDirty(true)
    }, [])
  const resetLandscapeBlur = useCallback(
    (values: LandscapeBlurState) => {
      setLandscapeBlurState(values)
      setLandscapeBlurDirty(false)
    }, [])
  const setBadgeStyle = useCallback(
    (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => {
      const next = typeof v === "function" ? v(badgeStyle) : v
      update({ badgeStyle: next })
    }, [badgeStyle, update])
  const setRankingBadgeStyle = useCallback(
    (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => {
      const next = typeof v === "function" ? v(rankingBadgeStyle) : v
      update({ rankingBadgeStyle: next })
    }, [rankingBadgeStyle, update])
  const setQualityBadgeStyle = useCallback(
    (v: QualityBadgeStyle | ((prev: QualityBadgeStyle) => QualityBadgeStyle)) => {
      const next = typeof v === "function" ? v(qualityBadgeStyle) : v
      update({ qualityBadgeStyle: next })
    }, [qualityBadgeStyle, update])
  const setVideoFormats = useCallback(
    (v: VideoFormat[] | null | ((prev: VideoFormat[] | null) => VideoFormat[] | null)) => {
      const next = typeof v === "function" ? v(videoFormats) : v
      update({ videoFormats: next })
    }, [videoFormats, update])
  const setDefaultBadgeStyle = useCallback(
    (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => {
      const next = typeof v === "function" ? v(defaultBadgeStyle) : v
      update({ defaultBadgeStyle: next })
    }, [defaultBadgeStyle, update])
  const setDefaultRankingBadgeStyle = useCallback(
    (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => {
      const next = typeof v === "function" ? v(defaultRankingBadgeStyle) : v
      update({ defaultRankingBadgeStyle: next })
    }, [defaultRankingBadgeStyle, update])
  const setDefaultQualityBadgeStyle = useCallback(
    (v: QualityBadgeStyle | ((prev: QualityBadgeStyle) => QualityBadgeStyle)) => {
      const next = typeof v === "function" ? v(defaultQualityBadgeStyle) : v
      update({ defaultQualityBadgeStyle: next })
    }, [defaultQualityBadgeStyle, update])
  const setDefaultVideoFormats = useCallback(
    (v: VideoFormat[] | ((prev: VideoFormat[]) => VideoFormat[])) => {
      const next = typeof v === "function" ? v(defaultVideoFormats) : v
      update({ defaultVideoFormats: next })
    }, [defaultVideoFormats, update])
  const setDefaultBlurEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultBlurEnabled) : v
      update({ defaultBlurEnabled: next })
    }, [defaultBlurEnabled, update])
  const setDefaultBlurIntensity = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultBlurIntensity) : v
      update({ defaultBlurIntensity: next })
    }, [defaultBlurIntensity, update])
  const setDefaultTintStrength = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTintStrength) : v
      update({ defaultTintStrength: next })
    }, [defaultTintStrength, update])
  const setDefaultBlurFade = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultBlurFade) : v
      update({ defaultBlurFade: next })
    }, [defaultBlurFade, update])
  const setDefaultBlurDarkness = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultBlurDarkness) : v
      update({ defaultBlurDarkness: next })
    }, [defaultBlurDarkness, update])
  const setDefaultGradientHeight = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultGradientHeight) : v
      update({ defaultGradientHeight: next })
    }, [defaultGradientHeight, update])
  const setDefaultTopBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTopBadgeScale) : v
      update({ defaultTopBadgeScale: next })
    }, [defaultTopBadgeScale, update])
  const setDefaultLogoScale = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultLogoScale) : v
      update({ defaultLogoScale: next })
    }, [defaultLogoScale, update])
  const setDefaultLogoOffsetX = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultLogoOffsetX) : v
      update({ defaultLogoOffsetX: next })
    }, [defaultLogoOffsetX, update])
  const setDefaultLogoOffsetY = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultLogoOffsetY) : v
      update({ defaultLogoOffsetY: next })
    }, [defaultLogoOffsetY, update])
  const setDefaultTopBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTopBadgeOffsetX) : v
      update({ defaultTopBadgeOffsetX: next })
    }, [defaultTopBadgeOffsetX, update])
  const setDefaultTopBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTopBadgeOffsetY) : v
      update({ defaultTopBadgeOffsetY: next })
    }, [defaultTopBadgeOffsetY, update])
  const setDefaultGenreBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultGenreBadgeScale) : v
      update({ defaultGenreBadgeScale: next })
    }, [defaultGenreBadgeScale, update])
  const setDefaultGenreBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultGenreBadgeOffsetX) : v
      update({ defaultGenreBadgeOffsetX: next })
    }, [defaultGenreBadgeOffsetX, update])
  const setDefaultGenreBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultGenreBadgeOffsetY) : v
      update({ defaultGenreBadgeOffsetY: next })
    }, [defaultGenreBadgeOffsetY, update])
  const setDefaultQualityBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultQualityBadgeScale) : v
      update({ defaultQualityBadgeScale: next })
    }, [defaultQualityBadgeScale, update])
  const setDefaultQualityBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultQualityBadgeOffsetX) : v
      update({ defaultQualityBadgeOffsetX: next })
    }, [defaultQualityBadgeOffsetX, update])
  const setDefaultQualityBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultQualityBadgeOffsetY) : v
      update({ defaultQualityBadgeOffsetY: next })
    }, [defaultQualityBadgeOffsetY, update])
  const setDefaultNetworkLogoScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogoScale) : v
      update({ defaultNetworkLogoScale: next })
    }, [defaultNetworkLogoScale, update])
  const setDefaultNetworkLogoOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogoOffsetX) : v
      update({ defaultNetworkLogoOffsetX: next })
    }, [defaultNetworkLogoOffsetX, update])
  const setDefaultNetworkLogoOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogoOffsetY) : v
      update({ defaultNetworkLogoOffsetY: next })
    }, [defaultNetworkLogoOffsetY, update])
  const setDefaultGlobalBadges = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultGlobalBadges) : v
      update({ defaultGlobalBadges: next })
    }, [defaultGlobalBadges, update])
  const setDefaultRankingBadges = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultRankingBadges) : v
      update({ defaultRankingBadges: next })
    }, [defaultRankingBadges, update])
  const setDefaultBadgeGenre = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultBadgeGenre) : v
      update({ defaultBadgeGenre: next })
    }, [defaultBadgeGenre, update])
  const setDefaultBadgeYear = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultBadgeYear) : v
      update({ defaultBadgeYear: next })
    }, [defaultBadgeYear, update])
  const setDefaultBadgeRating = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultBadgeRating) : v
      update({ defaultBadgeRating: next })
    }, [defaultBadgeRating, update])
  const setDefaultBadgeQuality = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultBadgeQuality) : v
      update({ defaultBadgeQuality: next })
    }, [defaultBadgeQuality, update])
  const setDefaultCustomRatings = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultCustomRatings) : v
      update({ defaultCustomRatings: next })
    }, [defaultCustomRatings, update])
  const setDefaultCustomRatingEndpoint = useCallback(
    (v: string | undefined | ((prev: string | undefined) => string | undefined)) => {
      const next = typeof v === "function" ? v(defaultCustomRatingEndpoint) : v
      update({ defaultCustomRatingEndpoint: next })
    }, [defaultCustomRatingEndpoint, update])
  const setDefaultCustomRatingApiKeyHeader = useCallback(
    (v: string | undefined | ((prev: string | undefined) => string | undefined)) => {
      const next = typeof v === "function" ? v(defaultCustomRatingApiKeyHeader) : v
      update({ defaultCustomRatingApiKeyHeader: next })
    }, [defaultCustomRatingApiKeyHeader, update])
  const setDefaultRatingSources = useCallback(
    (v: string[] | ((prev: string[]) => string[])) => {
      const next = typeof v === "function" ? v(defaultRatingSources) : v
      update({ defaultRatingSources: next })
    }, [defaultRatingSources, update])
  const setDefaultSeparateRatings = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultSeparateRatings) : v
      update({ defaultSeparateRatings: next })
    }, [defaultSeparateRatings, update])
  const setDefaultSashOrder = useCallback(
    (v: SashBucket[] | ((prev: SashBucket[]) => SashBucket[])) => {
      const next = typeof v === "function" ? v(defaultSashOrder) : v
      update({ defaultSashOrder: next })
    }, [defaultSashOrder, update])
  const setDefaultAutoRotateClean = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultAutoRotateClean) : v
      update({ defaultAutoRotateClean: next })
    }, [defaultAutoRotateClean, update])
  const setDefaultAutoRotateBackdrop = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultAutoRotateBackdrop) : v
      update({ defaultAutoRotateBackdrop: next })
    }, [defaultAutoRotateBackdrop, update])
  const setDefaultDisableCleanPosters = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultDisableCleanPosters) : v
      update({ defaultDisableCleanPosters: next })
    }, [defaultDisableCleanPosters, update])
  const setDefaultPortraitFitEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultPortraitFitEnabled) : v
      update({ defaultPortraitFitEnabled: next })
    }, [defaultPortraitFitEnabled, update])
  const setDefaultLandscapeFitEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultLandscapeFitEnabled) : v
      update({ defaultLandscapeFitEnabled: next })
    }, [defaultLandscapeFitEnabled, update])
  const setDefaultNetworkLogo = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogo) : v
      update({ defaultNetworkLogo: next })
    }, [defaultNetworkLogo, update])
  const setDefaultNetworkLogoPosition = useCallback(
    (v: NetworkLogoPosition | ((prev: NetworkLogoPosition) => NetworkLogoPosition)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogoPosition) : v
      update({ defaultNetworkLogoPosition: next })
    }, [defaultNetworkLogoPosition, update])
  const setDefaultPreRelease = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultPreRelease) : v
      update({ defaultPreRelease: next })
    }, [defaultPreRelease, update])
  const setDefaultRibbonSide = useCallback(
    (v: "left" | "right" | ((prev: "left" | "right") => "left" | "right")) => {
      const next = typeof v === "function" ? v(defaultRibbonSide) : v
      update({ defaultRibbonSide: next })
    }, [defaultRibbonSide, update])
  const setDefaultRibbonEnabled = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultRibbonEnabled) : v
      update({ defaultRibbonEnabled: next })
    }, [defaultRibbonEnabled, update])
  const setDefaultPosterShape = useCallback(
    (v: PosterShape | ((prev: PosterShape) => PosterShape)) => {
      const next = typeof v === "function" ? v(defaultPosterShape) : v
      update({ defaultPosterShape: next })
    }, [defaultPosterShape, update])
  // Profilo default landscape: patch parziale (chiavi assenti = segui i flat),
  // reset = svuota (torna a seguire tutto). Passa da update → auto-persist +
  // sync server come gli altri default.
  const setLandscape = useCallback(
    (patch: Partial<LandscapeServerDefaults>) => {
      update({ landscape: { ...landscapeDefaults, ...patch } })
    }, [landscapeDefaults, update])
  const resetLandscape = useCallback(
    () => {
      update({ landscape: {} })
    }, [update])
  const setLogoAlign = useCallback(
    (v: "left" | "center" | ((prev: "left" | "center") => "left" | "center")) => {
      const next = typeof v === "function" ? v(logoAlign) : v
      update({ logoAlign: next })
    }, [logoAlign, update])
  const setDefaultLogoAlign = useCallback(
    (v: "left" | "center" | null | ((prev: "left" | "center" | null) => "left" | "center" | null)) => {
      const next = typeof v === "function" ? v(defaultLogoAlign) : v
      update({ defaultLogoAlign: next })
    }, [defaultLogoAlign, update])
  const setEpisodeMetadataSource = useCallback(
    (v: "tmdb" | "tvdb" | ((prev: "tmdb" | "tvdb") => "tmdb" | "tvdb")) => {
      const next = typeof v === "function" ? v(episodeMetadataSource) : v
      update({ episodeMetadataSource: next })
    }, [episodeMetadataSource, update])
  const setDefaultEpisodeMetadataSource = useCallback(
    (v: "tmdb" | "tvdb" | ((prev: "tmdb" | "tvdb") => "tmdb" | "tvdb")) => {
      const next = typeof v === "function" ? v(defaultEpisodeMetadataSource) : v
      update({ defaultEpisodeMetadataSource: next })
    }, [defaultEpisodeMetadataSource, update])
  const setRegion = useCallback(
    (v: string | ((prev: string) => string)) => {
      const next = typeof v === "function" ? v(region) : v
      update({ region: next })
    }, [region, update])
  const setDefaultRegion = useCallback(
    (v: string | ((prev: string) => string)) => {
      const next = typeof v === "function" ? v(defaultRegion) : v
      update({ defaultRegion: next })
    }, [defaultRegion, update])
  const setDefaultDateFormat = useCallback(
    (v: DateFormat | ((prev: DateFormat) => DateFormat)) => {
      const next = typeof v === "function" ? v(defaultDateFormat) : v
      update({ defaultDateFormat: next })
    }, [defaultDateFormat, update])

  const editorCtx = useMemo<PosterEditorCtx>(
    () => ({
      // Badges
      globalBadges,
      setGlobalBadges,
      rankingBadges,
      setRankingBadges,
      badgeGenre,
      setBadgeGenre,
      badgeYear,
      setBadgeYear,
      badgeRating,
      setBadgeRating,
      badgeQuality,
      setBadgeQuality,
      customRatings,
      setCustomRatings,
      ratingSources,
      setRatingSources,
      separateRatings,
      setSeparateRatings,
      badgeStyle,
      setBadgeStyle,
      rankingBadgeStyle,
      setRankingBadgeStyle,
      qualityBadgeStyle,
      setQualityBadgeStyle,
      videoFormats,
      setVideoFormats,
      customBadge,
      setCustomBadge,
      badgePresetId,
      setBadgePresetId,
      badgePresetRev,
      setBadgePresetRev,
      networkLogo,
      setNetworkLogo,
      networkLogoPosition,
      setNetworkLogoPosition,
      preRelease,
      setPreRelease,
      ribbonSide,
      setRibbonSide,
      ribbonEnabled,
      setRibbonEnabled,
      posterShape,
      setPosterShape,
      logoAlign,
      setLogoAlign,
      episodeMetadataSource,
      setEpisodeMetadataSource,
      region,
      setRegion,

      // Defaults
      defaultBadgeStyle,
      setDefaultBadgeStyle,
      defaultRankingBadgeStyle,
      setDefaultRankingBadgeStyle,
      defaultQualityBadgeStyle,
      setDefaultQualityBadgeStyle,
      defaultVideoFormats,
      setDefaultVideoFormats,
      defaultEpisodeMetadataSource,
      setDefaultEpisodeMetadataSource,
      defaultBlurEnabled,
      setDefaultBlurEnabled,
      defaultBlurIntensity,
      setDefaultBlurIntensity,
      defaultTintStrength,
      setDefaultTintStrength,
      defaultBlurFade,
      setDefaultBlurFade,
      defaultBlurDarkness,
      setDefaultBlurDarkness,
      defaultGradientHeight,
      setDefaultGradientHeight,
      defaultLogoScale,
      setDefaultLogoScale,
      defaultLogoOffsetX,
      setDefaultLogoOffsetX,
      defaultLogoOffsetY,
      setDefaultLogoOffsetY,
      defaultTopBadgeScale,
      setDefaultTopBadgeScale,
      defaultTopBadgeOffsetX,
      setDefaultTopBadgeOffsetX,
      defaultTopBadgeOffsetY,
      setDefaultTopBadgeOffsetY,
      defaultGenreBadgeScale,
      setDefaultGenreBadgeScale,
      defaultGenreBadgeOffsetX,
      setDefaultGenreBadgeOffsetX,
      defaultGenreBadgeOffsetY,
      setDefaultGenreBadgeOffsetY,
      defaultQualityBadgeScale,
      setDefaultQualityBadgeScale,
      defaultQualityBadgeOffsetX,
      setDefaultQualityBadgeOffsetX,
      defaultQualityBadgeOffsetY,
      setDefaultQualityBadgeOffsetY,
      defaultNetworkLogoScale,
      setDefaultNetworkLogoScale,
      defaultNetworkLogoOffsetX,
      setDefaultNetworkLogoOffsetX,
      defaultNetworkLogoOffsetY,
      setDefaultNetworkLogoOffsetY,
      defaultGlobalBadges,
      setDefaultGlobalBadges,
      defaultRankingBadges,
      setDefaultRankingBadges,
      defaultBadgeGenre,
      setDefaultBadgeGenre,
      defaultBadgeYear,
      setDefaultBadgeYear,
      defaultBadgeRating,
      setDefaultBadgeRating,
      defaultBadgeQuality,
      setDefaultBadgeQuality,
      defaultCustomRatings,
      setDefaultCustomRatings,
      defaultCustomRatingEndpoint,
      setDefaultCustomRatingEndpoint,
      defaultCustomRatingApiKeyHeader,
      setDefaultCustomRatingApiKeyHeader,
      defaultRatingSources,
      setDefaultRatingSources,
      defaultSeparateRatings,
      setDefaultSeparateRatings,
      defaultSashOrder,
      setDefaultSashOrder,
      defaultAutoRotateClean,
      setDefaultAutoRotateClean,
      defaultDisableCleanPosters,
      setDefaultDisableCleanPosters,
      defaultAutoRotateBackdrop,
      setDefaultAutoRotateBackdrop,
      defaultPortraitFitEnabled,
      setDefaultPortraitFitEnabled,
      defaultLandscapeFitEnabled,
      setDefaultLandscapeFitEnabled,
      defaultNetworkLogo,
      setDefaultNetworkLogo,
      defaultNetworkLogoPosition,
      setDefaultNetworkLogoPosition,
      defaultPreRelease,
      setDefaultPreRelease,
      defaultRibbonSide,
      setDefaultRibbonSide,
      defaultRibbonEnabled,
      setDefaultRibbonEnabled,
      defaultPosterShape,
      setDefaultPosterShape,
      landscape: landscapeDefaults,
      setLandscape,
      resetLandscape,
      defaultLogoAlign,
      setDefaultLogoAlign,
      defaultRegion,
      setDefaultRegion,
      defaultDateFormat,
      setDefaultDateFormat,
      loadDefaultsToState,

      // Blur
      blurEnabled,
      setBlurEnabled,
      landscapeBlur,
      setLandscapeBlur,
      resetLandscapeBlur,
      landscapeBlurDirty,
      blurIntensity,
      setBlurIntensity,
      tintStrength,
      setTintStrength,
      topShade,
      setTopShade,
      defaultTopShade,
      setDefaultTopShade,
      blurFade,
      setBlurFade,
      blurDarkness,
      setBlurDarkness,

      // Gradient
      gradientHeight,
      setGradientHeight,

      // Badge superiore
      topBadgeScale,
      setTopBadgeScale,
      topBadgeOffsetX,
      setTopBadgeOffsetX,
      topBadgeOffsetY,
      setTopBadgeOffsetY,

      // Badge genere
      genreBadgeScale,
      setGenreBadgeScale,
      genreBadgeOffsetX,
      setGenreBadgeOffsetX,
      genreBadgeOffsetY,
      setGenreBadgeOffsetY,

      // Badge qualità
      qualityBadgeScale,
      setQualityBadgeScale,
      qualityBadgeOffsetX,
      setQualityBadgeOffsetX,
      qualityBadgeOffsetY,
      setQualityBadgeOffsetY,

      // Logo network
      networkLogoScale,
      setNetworkLogoScale,
      networkLogoOffsetX,
      setNetworkLogoOffsetX,
      networkLogoOffsetY,
      setNetworkLogoOffsetY,

      // Logo
      logoScale,
      setLogoScale,
      logoOffsetX,
      setLogoOffsetX,
      logoOffsetY,
      setLogoOffsetY,
      logoDisabled,
      setLogoDisabled,

      // Backdrop
      backdrops,
      setBackdrops,
      selectedBackdrop,
      setSelectedBackdrop,
      backdropScale,
      setBackdropScale,
      backdropOffsetX,
      setBackdropOffsetX,
      backdropOffsetY,
      setBackdropOffsetY,

      // Rotation
      rotationPosters,
      setRotationPosters,
      autoRotateClean,
      setAutoRotateClean,
      excludedPosters,
      setExcludedPosters,
      rotationBackdrops,
      setRotationBackdrops,
      autoRotateBackdrop,
      setAutoRotateBackdrop,
      excludedBackdrops,
      setExcludedBackdrops,

      // Episode Group
      episodeGroupId,
      setEpisodeGroupId,
    }),
    [
      // Badges
      globalBadges, setGlobalBadges,
      rankingBadges, setRankingBadges,
      badgeGenre, setBadgeGenre,
      badgeYear, setBadgeYear,
      badgeRating, setBadgeRating,
      badgeQuality, setBadgeQuality,
      customRatings, setCustomRatings,
      ratingSources, setRatingSources,
      separateRatings, setSeparateRatings,
      badgeStyle, setBadgeStyle,
      rankingBadgeStyle, setRankingBadgeStyle,
      qualityBadgeStyle, setQualityBadgeStyle,
      videoFormats, setVideoFormats,
      customBadge, setCustomBadge,
      badgePresetId, setBadgePresetId,
      badgePresetRev, setBadgePresetRev,
      networkLogo, setNetworkLogo,
      networkLogoPosition, setNetworkLogoPosition,
      preRelease, setPreRelease,
      ribbonSide, setRibbonSide,
      ribbonEnabled, setRibbonEnabled,
      posterShape, setPosterShape,
      logoAlign, setLogoAlign,
      episodeMetadataSource, setEpisodeMetadataSource,
      region, setRegion,
      defaultRegion, setDefaultRegion,
      defaultDateFormat, setDefaultDateFormat,

      // Defaults
      defaultBadgeStyle, setDefaultBadgeStyle,
      defaultRankingBadgeStyle, setDefaultRankingBadgeStyle,
      defaultQualityBadgeStyle, setDefaultQualityBadgeStyle,
      defaultVideoFormats, setDefaultVideoFormats,
      defaultEpisodeMetadataSource, setDefaultEpisodeMetadataSource,
      defaultBlurEnabled, setDefaultBlurEnabled,
      defaultBlurIntensity, setDefaultBlurIntensity,
      defaultTintStrength, setDefaultTintStrength,
      defaultBlurFade, setDefaultBlurFade,
      defaultBlurDarkness, setDefaultBlurDarkness,
      defaultGradientHeight, setDefaultGradientHeight,
      defaultLogoScale, setDefaultLogoScale,
      defaultLogoOffsetX, setDefaultLogoOffsetX,
      defaultLogoOffsetY, setDefaultLogoOffsetY,
      defaultTopBadgeScale, setDefaultTopBadgeScale,
      defaultTopBadgeOffsetX, setDefaultTopBadgeOffsetX,
      defaultTopBadgeOffsetY, setDefaultTopBadgeOffsetY,
      defaultGenreBadgeScale,
      setDefaultGenreBadgeScale,
      defaultGenreBadgeOffsetX,
      setDefaultGenreBadgeOffsetX,
      defaultGenreBadgeOffsetY,
      setDefaultGenreBadgeOffsetY,
      defaultQualityBadgeScale,
      setDefaultQualityBadgeScale,
      defaultQualityBadgeOffsetX,
      setDefaultQualityBadgeOffsetX,
      defaultQualityBadgeOffsetY,
      setDefaultQualityBadgeOffsetY,
      defaultNetworkLogoScale,
      setDefaultNetworkLogoScale,
      defaultNetworkLogoOffsetX,
      setDefaultNetworkLogoOffsetX,
      defaultNetworkLogoOffsetY,
      setDefaultNetworkLogoOffsetY,
      defaultGlobalBadges, setDefaultGlobalBadges,
      defaultRankingBadges, setDefaultRankingBadges,
      defaultBadgeGenre, setDefaultBadgeGenre,
      defaultBadgeYear, setDefaultBadgeYear,
      defaultBadgeRating, setDefaultBadgeRating,
      defaultBadgeQuality, setDefaultBadgeQuality,
      defaultCustomRatings, setDefaultCustomRatings,
      defaultCustomRatingEndpoint, setDefaultCustomRatingEndpoint,
      defaultCustomRatingApiKeyHeader, setDefaultCustomRatingApiKeyHeader,
      defaultRatingSources, setDefaultRatingSources,
      defaultSeparateRatings, setDefaultSeparateRatings,
      defaultSashOrder, setDefaultSashOrder,
      defaultAutoRotateClean, setDefaultAutoRotateClean,
      defaultDisableCleanPosters, setDefaultDisableCleanPosters,
      defaultAutoRotateBackdrop, setDefaultAutoRotateBackdrop,
      defaultPortraitFitEnabled, setDefaultPortraitFitEnabled,
      defaultLandscapeFitEnabled, setDefaultLandscapeFitEnabled,
      defaultNetworkLogo, setDefaultNetworkLogo,
      defaultNetworkLogoPosition, setDefaultNetworkLogoPosition,
      defaultPreRelease, setDefaultPreRelease,
      defaultRibbonSide, setDefaultRibbonSide,
      defaultRibbonEnabled, setDefaultRibbonEnabled,
      defaultPosterShape, setDefaultPosterShape,
      landscapeDefaults, setLandscape, resetLandscape,
      defaultLogoAlign, setDefaultLogoAlign,
      loadDefaultsToState,

      // Blur
      blurEnabled, setBlurEnabled,
      landscapeBlur, setLandscapeBlur, resetLandscapeBlur, landscapeBlurDirty,
      blurIntensity, setBlurIntensity,
      tintStrength, setTintStrength,
      topShade, setTopShade,
      defaultTopShade, setDefaultTopShade,
      blurFade, setBlurFade,
      blurDarkness, setBlurDarkness,

      // Gradient
      gradientHeight, setGradientHeight,

      // Badge superiore
      topBadgeScale, setTopBadgeScale,
      topBadgeOffsetX, setTopBadgeOffsetX,
      topBadgeOffsetY, setTopBadgeOffsetY,

      // Badge genere
      genreBadgeScale, setGenreBadgeScale,
      genreBadgeOffsetX, setGenreBadgeOffsetX,
      genreBadgeOffsetY, setGenreBadgeOffsetY,

      // Badge qualità
      qualityBadgeScale, setQualityBadgeScale,
      qualityBadgeOffsetX, setQualityBadgeOffsetX,
      qualityBadgeOffsetY, setQualityBadgeOffsetY,

      // Logo network
      networkLogoScale, setNetworkLogoScale,
      networkLogoOffsetX, setNetworkLogoOffsetX,
      networkLogoOffsetY, setNetworkLogoOffsetY,

      // Logo
      logoScale, setLogoScale,
      logoOffsetX, setLogoOffsetX,
      logoOffsetY, setLogoOffsetY,
      logoDisabled, setLogoDisabled,

      // Backdrop
      backdrops, setBackdrops,
      selectedBackdrop, setSelectedBackdrop,
      backdropScale, setBackdropScale,
      backdropOffsetX, setBackdropOffsetX,
      backdropOffsetY, setBackdropOffsetY,

      // Rotation
      rotationPosters, setRotationPosters,
      autoRotateClean, setAutoRotateClean,
      excludedPosters, setExcludedPosters,
      rotationBackdrops, setRotationBackdrops,
      autoRotateBackdrop, setAutoRotateBackdrop,
      excludedBackdrops, setExcludedBackdrops,

      // Episode Group
      episodeGroupId, setEpisodeGroupId,
    ],
  )

  return <Ctx.Provider value={editorCtx}>{children}</Ctx.Provider>
}