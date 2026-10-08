"use client"

import { createContext, useContext, useState, useMemo, useCallback } from "react"
import type { TMDBImage, NetworkLogoPosition, PosterShape } from "@/lib/types"
import { useDefaults, type DefaultSyncStatus, type DefaultsState } from "@/lib/useDefaults"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { DateFormat } from "@/lib/release-badge"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle } from "@/lib/badge-styles"
import { getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import type { SashBucket } from "@/lib/badge-priority"
import type { VideoFormat } from "@/lib/av-specs"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { materializeExtraTuning, clearedExtraForPresetApply } from "@/lib/extra-materialize"
import { logoDefaultScale } from "@/lib/logo-selection"
import { resolveNetworkEffectiveView } from "@/lib/network-follow"

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
  applyVisualPreset: (values: VisualPresetValues, target?: "portrait" | "landscape") => void
  /**
   * Riporta TUTTI i visuali per-titolo ai default globali (stessi fallback
   * `mapping-assente ?? default*` dell'apertura titolo senza mapping), senza
   * toccare i default stessi. Usato dopo un salvataggio "solo copertina":
   * il mapping salvato congela solo cover + logo, quindi la preview (sempre
   * esplicita) deve mostrare i default per corrispondere al poster salvato.
   * Artwork (poster/backdrop/logo selezionati), logoDisabled, formato canvas,
   * rotazioni, esclusioni ed episodeGroupId restano intatti; `logo` (il logo
   * mantenuto) serve a risolvere la scala come `selectLogo` (default di
   * formato > default globali > auto-fit `logoDefaultScale(logo) ?? 75`,
   * stessa catena del server per mapping senza tuning). L'accent manuale si
   * azzera dal chiamante (stato context).
   */
  resetPerTitleVisuals: (logo?: Pick<TMDBImage, "width" | "height"> | null) => void
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
  /** Layout dei rating separati del poster in editing ("column" = colonna storica). */
  separateRatingsStyle: SeparateRatingsStyle
  setSeparateRatingsStyle: (v: SeparateRatingsStyle | ((prev: SeparateRatingsStyle) => SeparateRatingsStyle)) => void
  badgeStyle: BadgeStyle
  setBadgeStyle: (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => void
  rankingBadgeStyle: RankingBadgeStyle
  setRankingBadgeStyle: (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => void
  /** Standalone extra-badge style in editing (null = legacy `rs` fallback). */
  extraBadgeStyle: ExtraBadgeStyle | null
  setExtraBadgeStyle: (v: ExtraBadgeStyle | null | ((prev: ExtraBadgeStyle | null) => ExtraBadgeStyle | null)) => void
  /** Font dei testi badge del poster in editing ("inter" = resa storica). */
  badgeFont: BadgeFont
  setBadgeFont: (v: BadgeFont | ((prev: BadgeFont) => BadgeFont)) => void
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
  /** Il network segue il titolo nel poster in editing (false = posizione assoluta). */
  networkLogoFollowTitle: boolean
  setNetworkLogoFollowTitle: (v: boolean | ((prev: boolean) => boolean)) => void
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
  /** Standalone extra-badge style default (null = legacy `rs` fallback). */
  defaultExtraBadgeStyle: ExtraBadgeStyle | null
  setDefaultExtraBadgeStyle: (v: ExtraBadgeStyle | null | ((prev: ExtraBadgeStyle | null) => ExtraBadgeStyle | null)) => void
  /** Font dei testi badge di default ("inter" = resa storica). */
  defaultBadgeFont: BadgeFont
  setDefaultBadgeFont: (v: BadgeFont | ((prev: BadgeFont) => BadgeFont)) => void
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
  setDefaultTopBadgeScale: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  defaultTopBadgeOffsetX: number
  setDefaultTopBadgeOffsetX: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  defaultTopBadgeOffsetY: number
  setDefaultTopBadgeOffsetY: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  /** Tuning EXTRA superiore di default (null = fallback legacy classifica). */
  defaultExtraBadgeScale: number | null
  setDefaultExtraBadgeScale: (v: number | null | ((prev: number | null) => number | null)) => void
  defaultExtraBadgeOffsetX: number | null
  setDefaultExtraBadgeOffsetX: (v: number | null | ((prev: number | null) => number | null)) => void
  defaultExtraBadgeOffsetY: number | null
  setDefaultExtraBadgeOffsetY: (v: number | null | ((prev: number | null) => number | null)) => void
  defaultGenreBadgeScale: number
  setDefaultGenreBadgeScale: (v: number | ((prev: number) => number)) => void
  defaultQualityBadgeScale: number
  setDefaultQualityBadgeScale: (v: number | ((prev: number) => number)) => void
  /** Scala % rating separati di default (default unico 130). */
  defaultSeparateBadgeScale: number
  setDefaultSeparateBadgeScale: (v: number | ((prev: number) => number)) => void
  /** Offset px gruppo rating separati di default (default 0). */
  defaultSeparateBadgeOffsetX: number
  setDefaultSeparateBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  /** Offset px gruppo rating separati di default (default 0). */
  defaultSeparateBadgeOffsetY: number
  setDefaultSeparateBadgeOffsetY: (v: number | ((prev: number) => number)) => void
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
  /** Layout dei rating separati di default ("column" = colonna destra storica). */
  defaultSeparateRatingsStyle: SeparateRatingsStyle
  setDefaultSeparateRatingsStyle: (v: SeparateRatingsStyle | ((prev: SeparateRatingsStyle) => SeparateRatingsStyle)) => void
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
  /** Il network segue il titolo di default (true = layout storico). */
  defaultNetworkLogoFollowTitle: boolean
  setDefaultNetworkLogoFollowTitle: (v: boolean | ((prev: boolean) => boolean)) => void
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
  setLandscape: (patch: Partial<LandscapeServerDefaults>, opts?: { materialize?: boolean }) => void
  resetLandscape: () => void
  defaultRegion: string
  setDefaultRegion: (v: string | ((prev: string) => string)) => void
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  defaultDateFormat: DateFormat
  setDefaultDateFormat: (v: DateFormat | ((prev: DateFormat) => DateFormat)) => void
  loadDefaultsToState: () => void
  /** Authoritative defaults sync state (local + server truth for the footer). */
  defaultSyncStatus: DefaultSyncStatus
  /** Immediate server retry of the current defaults payload (single PUT). */
  retryDefaultSync: () => Promise<boolean>

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
  setTopBadgeScale: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  topBadgeOffsetX: number
  setTopBadgeOffsetX: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  topBadgeOffsetY: number
  setTopBadgeOffsetY: (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => void
  /** Tuning EXTRA superiore in editing (null = fallback legacy classifica). */
  extraBadgeScale: number | null
  setExtraBadgeScale: (v: number | null | ((prev: number | null) => number | null)) => void
  extraBadgeOffsetX: number | null
  setExtraBadgeOffsetX: (v: number | null | ((prev: number | null) => number | null)) => void
  extraBadgeOffsetY: number | null
  setExtraBadgeOffsetY: (v: number | null | ((prev: number | null) => number | null)) => void

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

  // ---- Rating separati (scala relativa UI su raw 130; offset gruppo, default 0) ----
  separateBadgeScale: number
  setSeparateBadgeScale: (v: number | ((prev: number) => number)) => void
  separateBadgeOffsetX: number
  setSeparateBadgeOffsetX: (v: number | ((prev: number) => number)) => void
  separateBadgeOffsetY: number
  setSeparateBadgeOffsetY: (v: number | ((prev: number) => number)) => void

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
    globalBadges, rankingBadges, networkLogo, networkLogoPosition, networkLogoFollowTitle, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle,
    gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, topShade,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
    extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    badgeStyle, rankingBadgeStyle, qualityBadgeStyle, videoFormats,
    extraBadgeStyle,
    badgeFont, defaultBadgeFont,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultQualityBadgeStyle, defaultVideoFormats,
    defaultExtraBadgeStyle,
    defaultBlurEnabled, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultTintStrength, defaultTopShade,
    defaultGradientHeight, defaultGlobalBadges, defaultRankingBadges,
    defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY,
    defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY,
    defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY,
    defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale,
    defaultSeparateBadgeScale,
    defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY,
    defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY,
    defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY,
    defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultCustomRatings, defaultCustomRatingEndpoint, defaultCustomRatingApiKeyHeader, defaultRatingSources, defaultSeparateRatings, defaultSeparateRatingsStyle, defaultSashOrder,
    defaultAutoRotateClean, defaultAutoRotateBackdrop, defaultPortraitFitEnabled, defaultLandscapeFitEnabled, defaultNetworkLogo, defaultNetworkLogoPosition, defaultNetworkLogoFollowTitle, defaultPreRelease, defaultRibbonSide, defaultRibbonEnabled, defaultPosterShape, defaultLogoAlign,
    defaultDisableCleanPosters,
    landscape: landscapeDefaults,
    episodeMetadataSource, defaultEpisodeMetadataSource,
    region, defaultRegion, defaultDateFormat,
    loadDefaultsToState, update,
  } = defaults
  const { defaultSyncStatus, retryDefaultSync } = defaults

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
  const setSeparateRatingsStyle = useCallback(
    (v: SeparateRatingsStyle | ((prev: SeparateRatingsStyle) => SeparateRatingsStyle)) => {
      const next = typeof v === "function" ? v(separateRatingsStyle) : v
      // Solo azione esplicita di cambio stile: se la scala è ancora al
      // default del vecchio stile segue il default del nuovo (bar → 130),
      // altrimenti il custom (es. 120) si preserva. Setter scala invariato.
      update(separateBadgeScale === getSeparateBadgeDefaultScale(separateRatingsStyle)
        ? { separateRatingsStyle: next, separateBadgeScale: getSeparateBadgeDefaultScale(next) }
        : { separateRatingsStyle: next })
    }, [separateRatingsStyle, separateBadgeScale, update])
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
  const setNetworkLogoFollowTitle = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(networkLogoFollowTitle) : v
      update({ networkLogoFollowTitle: next })
    }, [networkLogoFollowTitle, update])
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
  // Editing CLASSIFICA first materializes the previous independent EXTRA
  // (all still-following axes) BEFORE the rank change, so the extra badge
  // keeps its pixels. Sync paths (shape switch, mapping load, defaults
  // propagation) pass { materialize: false }: they restore/move values,
  // never edit them. Editing EXTRA never touches the classifica.
  const setTopBadgeScale = useCallback(
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(topBadgeScale) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: topBadgeScale, offsetX: topBadgeOffsetX, offsetY: topBadgeOffsetY },
        nextRank: { scale: next },
        extra: { scale: extraBadgeScale, offsetX: extraBadgeOffsetX, offsetY: extraBadgeOffsetY },
        fallbackExtra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { topBadgeScale: next, extraBadgeScale: mat.scale, extraBadgeOffsetX: mat.offsetX, extraBadgeOffsetY: mat.offsetY }
        : { topBadgeScale: next })
    }, [topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
  const setTopBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(topBadgeOffsetX) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: topBadgeScale, offsetX: topBadgeOffsetX, offsetY: topBadgeOffsetY },
        nextRank: { offsetX: next },
        extra: { scale: extraBadgeScale, offsetX: extraBadgeOffsetX, offsetY: extraBadgeOffsetY },
        fallbackExtra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { topBadgeOffsetX: next, extraBadgeScale: mat.scale, extraBadgeOffsetX: mat.offsetX, extraBadgeOffsetY: mat.offsetY }
        : { topBadgeOffsetX: next })
    }, [topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
  const setTopBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(topBadgeOffsetY) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: topBadgeScale, offsetX: topBadgeOffsetX, offsetY: topBadgeOffsetY },
        nextRank: { offsetY: next },
        extra: { scale: extraBadgeScale, offsetX: extraBadgeOffsetX, offsetY: extraBadgeOffsetY },
        fallbackExtra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { topBadgeOffsetY: next, extraBadgeScale: mat.scale, extraBadgeOffsetX: mat.offsetX, extraBadgeOffsetY: mat.offsetY }
        : { topBadgeOffsetY: next })
    }, [topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
  const setExtraBadgeScale = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(extraBadgeScale) : v
      update({ extraBadgeScale: next })
    }, [extraBadgeScale, update])
  const setExtraBadgeOffsetX = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(extraBadgeOffsetX) : v
      update({ extraBadgeOffsetX: next })
    }, [extraBadgeOffsetX, update])
  const setExtraBadgeOffsetY = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(extraBadgeOffsetY) : v
      update({ extraBadgeOffsetY: next })
    }, [extraBadgeOffsetY, update])
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
  const setSeparateBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(separateBadgeScale) : v
      update({ separateBadgeScale: next })
    }, [separateBadgeScale, update])
  const setSeparateBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(separateBadgeOffsetX) : v
      update({ separateBadgeOffsetX: next })
    }, [separateBadgeOffsetX, update])
  const setSeparateBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(separateBadgeOffsetY) : v
      update({ separateBadgeOffsetY: next })
    }, [separateBadgeOffsetY, update])
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
  const setExtraBadgeStyle = useCallback(
    (v: ExtraBadgeStyle | null | ((prev: ExtraBadgeStyle | null) => ExtraBadgeStyle | null)) => {
      const next = typeof v === "function" ? v(extraBadgeStyle) : v
      update({ extraBadgeStyle: next })
    }, [extraBadgeStyle, update])
  const setBadgeFont = useCallback(
    (v: BadgeFont | ((prev: BadgeFont) => BadgeFont)) => {
      const next = typeof v === "function" ? v(badgeFont) : v
      update({ badgeFont: next })
    }, [badgeFont, update])
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
  const setDefaultExtraBadgeStyle = useCallback(
    (v: ExtraBadgeStyle | null | ((prev: ExtraBadgeStyle | null) => ExtraBadgeStyle | null)) => {
      const next = typeof v === "function" ? v(defaultExtraBadgeStyle) : v
      update({ defaultExtraBadgeStyle: next })
    }, [defaultExtraBadgeStyle, update])
  const setDefaultBadgeFont = useCallback(
    (v: BadgeFont | ((prev: BadgeFont) => BadgeFont)) => {
      const next = typeof v === "function" ? v(defaultBadgeFont) : v
      update({ defaultBadgeFont: next })
    }, [defaultBadgeFont, update])
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
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(defaultTopBadgeScale) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: defaultTopBadgeScale, offsetX: defaultTopBadgeOffsetX, offsetY: defaultTopBadgeOffsetY },
        nextRank: { scale: next },
        extra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { defaultTopBadgeScale: next, defaultExtraBadgeScale: mat.scale, defaultExtraBadgeOffsetX: mat.offsetX, defaultExtraBadgeOffsetY: mat.offsetY }
        : { defaultTopBadgeScale: next })
    }, [defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
  const setDefaultExtraBadgeScale = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultExtraBadgeScale) : v
      update({ defaultExtraBadgeScale: next })
    }, [defaultExtraBadgeScale, update])
  const setDefaultExtraBadgeOffsetX = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultExtraBadgeOffsetX) : v
      update({ defaultExtraBadgeOffsetX: next })
    }, [defaultExtraBadgeOffsetX, update])
  const setDefaultExtraBadgeOffsetY = useCallback(
    (v: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof v === "function" ? v(defaultExtraBadgeOffsetY) : v
      update({ defaultExtraBadgeOffsetY: next })
    }, [defaultExtraBadgeOffsetY, update])
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
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(defaultTopBadgeOffsetX) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: defaultTopBadgeScale, offsetX: defaultTopBadgeOffsetX, offsetY: defaultTopBadgeOffsetY },
        nextRank: { offsetX: next },
        extra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { defaultTopBadgeOffsetX: next, defaultExtraBadgeScale: mat.scale, defaultExtraBadgeOffsetX: mat.offsetX, defaultExtraBadgeOffsetY: mat.offsetY }
        : { defaultTopBadgeOffsetX: next })
    }, [defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
  const setDefaultTopBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number), opts?: { materialize?: boolean }) => {
      const next = typeof v === "function" ? v(defaultTopBadgeOffsetY) : v
      const mat = opts?.materialize === false ? null : materializeExtraTuning({
        rank: { scale: defaultTopBadgeScale, offsetX: defaultTopBadgeOffsetX, offsetY: defaultTopBadgeOffsetY },
        nextRank: { offsetY: next },
        extra: { scale: defaultExtraBadgeScale, offsetX: defaultExtraBadgeOffsetX, offsetY: defaultExtraBadgeOffsetY },
      })
      update(mat
        ? { defaultTopBadgeOffsetY: next, defaultExtraBadgeScale: mat.scale, defaultExtraBadgeOffsetX: mat.offsetX, defaultExtraBadgeOffsetY: mat.offsetY }
        : { defaultTopBadgeOffsetY: next })
    }, [defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, update])
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
  const setDefaultSeparateBadgeScale = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultSeparateBadgeScale) : v
      update({ defaultSeparateBadgeScale: next })
    }, [defaultSeparateBadgeScale, update])
  const setDefaultSeparateBadgeOffsetX = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultSeparateBadgeOffsetX) : v
      update({ defaultSeparateBadgeOffsetX: next })
    }, [defaultSeparateBadgeOffsetX, update])
  const setDefaultSeparateBadgeOffsetY = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultSeparateBadgeOffsetY) : v
      update({ defaultSeparateBadgeOffsetY: next })
    }, [defaultSeparateBadgeOffsetY, update])
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
  const setDefaultSeparateRatingsStyle = useCallback(
    (v: SeparateRatingsStyle | ((prev: SeparateRatingsStyle) => SeparateRatingsStyle)) => {
      const next = typeof v === "function" ? v(defaultSeparateRatingsStyle) : v
      // Stesso follow del setter editor ma sul default globale (defaults panel).
      update(defaultSeparateBadgeScale === getSeparateBadgeDefaultScale(defaultSeparateRatingsStyle)
        ? { defaultSeparateRatingsStyle: next, defaultSeparateBadgeScale: getSeparateBadgeDefaultScale(next) }
        : { defaultSeparateRatingsStyle: next })
    }, [defaultSeparateRatingsStyle, defaultSeparateBadgeScale, update])
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
  const setDefaultNetworkLogoFollowTitle = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultNetworkLogoFollowTitle) : v
      update({ defaultNetworkLogoFollowTitle: next })
    }, [defaultNetworkLogoFollowTitle, update])
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
  // sync server come gli altri default. Un edit classifica materializza prima
  // l'extra indipendente precedente (stesse regole dei flat); i sync che
  // ripristinano valori passano { materialize: false }.
  const setLandscape = useCallback(
    (patch: Partial<LandscapeServerDefaults>, opts?: { materialize?: boolean }) => {
      // Functional merge: back-to-back patches in one handler never clobber
      // each other on the stale `landscapeDefaults` closure.
      update((prev) => {
        // Rank-key PRESENCE (not value): group resets/dblclick send own keys
        // as undefined, but the effective rank still changes (profile cleared
        // falls back to flats), so the extra must freeze instead of dragging.
        const rankKeys = ["topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY"] as const
        const touchesRank = rankKeys.some((k) => k in patch)
        // Next effective rank AFTER this patch (explicit undefined = cleared
        // and falls back to flats), compared against the current effective.
        const nextEff = (
          key: (typeof rankKeys)[number],
          flat: number,
        ): number => ((key in patch ? patch[key] : prev.landscape[key]) ?? flat) as number
        const mat = opts?.materialize === false || !touchesRank ? null : materializeExtraTuning({
          rank: {
            scale: prev.landscape.topBadgeScale ?? prev.defaultTopBadgeScale,
            offsetX: prev.landscape.topBadgeOffsetX ?? prev.defaultTopBadgeOffsetX,
            offsetY: prev.landscape.topBadgeOffsetY ?? prev.defaultTopBadgeOffsetY,
          },
          nextRank: {
            scale: nextEff("topBadgeScale", prev.defaultTopBadgeScale),
            offsetX: nextEff("topBadgeOffsetX", prev.defaultTopBadgeOffsetX),
            offsetY: nextEff("topBadgeOffsetY", prev.defaultTopBadgeOffsetY),
          },
          extra: {
            scale: prev.landscape.extraBadgeScale,
            offsetX: prev.landscape.extraBadgeOffsetX,
            offsetY: prev.landscape.extraBadgeOffsetY,
          },
          fallbackExtra: {
            scale: prev.defaultExtraBadgeScale,
            offsetX: prev.defaultExtraBadgeOffsetX,
            offsetY: prev.defaultExtraBadgeOffsetY,
          },
        })
        return {
          landscape: {
            ...prev.landscape,
            ...(mat ? { extraBadgeScale: mat.scale, extraBadgeOffsetX: mat.offsetX, extraBadgeOffsetY: mat.offsetY } : null),
            ...patch,
          },
        }
      })
    }, [update])
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

  const applyVisualPreset = useCallback((values: VisualPresetValues, target: "portrait" | "landscape" = "portrait") => {
    // Preset senza follow (legacy) o null = eredita: mai null nello stato
    // (i default restano booleani come gli altri toggle).
    const { defaultNetworkLogoFollowTitle, ...rest } = values
    const patch = { ...(defaultNetworkLogoFollowTitle == null ? rest : { ...rest, defaultNetworkLogoFollowTitle }) } as Record<string, unknown>
    // Full look application per edit target: a legacy preset without extra
    // clears the TARGET's missing/null extra axes to null (follow the
    // target's own rank, keeps legacy URLs); a modern preset with explicit
    // extra always wins. The other shape is never touched (its frozen
    // preservation from the isolated helpers survives). Layers without rank
    // keys (partial other-family patches) are left untouched.
    if (target === "landscape") {
      const land = patch.landscape
      if (land != null && typeof land === "object") {
        // Copy: patch.landscape may alias the caller's object (live profile
        // or a frozen preset), never mutate input.
        const l = { ...(land as Record<string, unknown>) }
        const cleared = clearedExtraForPresetApply(
          {
            scale: l.topBadgeScale as number | null | undefined,
            offsetX: l.topBadgeOffsetX as number | null | undefined,
            offsetY: l.topBadgeOffsetY as number | null | undefined,
          },
          {
            scale: l.extraBadgeScale as number | null | undefined,
            offsetX: l.extraBadgeOffsetX as number | null | undefined,
            offsetY: l.extraBadgeOffsetY as number | null | undefined,
          },
        )
        if (cleared) {
          l.extraBadgeScale = cleared.scale
          l.extraBadgeOffsetX = cleared.offsetX
          l.extraBadgeOffsetY = cleared.offsetY
        }
        patch.landscape = l
      }
    } else {
      const cleared = clearedExtraForPresetApply(
        {
          scale: patch.defaultTopBadgeScale as number | null | undefined,
          offsetX: patch.defaultTopBadgeOffsetX as number | null | undefined,
          offsetY: patch.defaultTopBadgeOffsetY as number | null | undefined,
        },
        {
          scale: patch.defaultExtraBadgeScale as number | null | undefined,
          offsetX: patch.defaultExtraBadgeOffsetX as number | null | undefined,
          offsetY: patch.defaultExtraBadgeOffsetY as number | null | undefined,
        },
      )
      if (cleared) {
        patch.defaultExtraBadgeScale = cleared.scale
        patch.defaultExtraBadgeOffsetX = cleared.offsetX
        patch.defaultExtraBadgeOffsetY = cleared.offsetY
      }
    }
    update(patch as Partial<DefaultsState>)
  }, [update])

  // Reset post-"solo copertina": un solo merge atomico dei bare visuali ai
  // default EFFETTIVI di formato (stessa `effectiveDefaultsForShape` del
  // server: in landscape il profilo Orizzontale vince sui flat chiave per
  // chiave, mai i flat grezzi — altrimenti preview=100 e salvato=140).
  // Extra: esplicito effettivo (profilo ?? globale, null = fallback legacy
  // preservato con check undefined — mai sempre-null); videoFormats:
  // effettivo esplicito (profilo ?? globale, null eredita il globale via
  // ??). Network follow/offset via `resolveNetworkEffectiveView` (stessa
  // semantica server: un flat fixed portrait non leakka assoluti in
  // landscape). Logo e disabled preservati (congelati dal save); la scala
  // segue `selectLogo` (default di formato > default globali > auto-fit sul
  // logo mantenuto, mai il live manuale). Sfumatura landscape dal profilo
  // Orizzontale (dirty azzerato via resetLandscapeBlur); i flat sfumatura
  // restano il profilo portrait. Intoccati: logoDisabled, posterShape,
  // logoAlign, artwork, rotazioni, esclusioni, episodeGroupId,
  // preRelease/ribbonSide (solo globali).
  const resetPerTitleVisuals = useCallback((logo?: Pick<TMDBImage, "width" | "height"> | null) => {
    const isLandReset = posterShape === "landscape"
    const land = isLandReset ? (landscapeDefaults ?? null) : null
    // Effective network view (server semantics, mapping assente: solo default
    // globali + profilo — mai leak di assoluti portrait in landscape).
    const netResetView = resolveNetworkEffectiveView(
      null,
      {
        networkLogoFollowTitle: defaultNetworkLogoFollowTitle,
        networkLogoOffsetX: defaultNetworkLogoOffsetX,
        networkLogoOffsetY: defaultNetworkLogoOffsetY,
      },
      land,
      isLandReset ? "landscape" : "poster",
    )
    update({
      globalBadges: land?.globalBadges ?? defaultGlobalBadges,
      rankingBadges: land?.rankingBadges ?? defaultRankingBadges,
      badgeGenre: land?.badgeGenre ?? defaultBadgeGenre,
      badgeYear: land?.badgeYear ?? defaultBadgeYear,
      badgeRating: land?.badgeRating ?? defaultBadgeRating,
      badgeQuality: land?.badgeQuality ?? defaultBadgeQuality,
      customRatings: land?.customRatings ?? defaultCustomRatings,
      ratingSources: defaultRatingSources,
      separateRatings: land?.separateRatings ?? defaultSeparateRatings,
      separateRatingsStyle: land?.separateRatingsStyle ?? defaultSeparateRatingsStyle,
      badgeStyle: land?.badgeStyle ?? defaultBadgeStyle,
      rankingBadgeStyle: land?.rankingBadgeStyle ?? defaultRankingBadgeStyle,
      extraBadgeStyle: land?.extraBadgeStyle ?? defaultExtraBadgeStyle,
      badgeFont: land?.badgeFont ?? defaultBadgeFont,
      qualityBadgeStyle: land?.qualityBadgeStyle ?? defaultQualityBadgeStyle,
      videoFormats: land?.videoFormats ?? defaultVideoFormats,
      networkLogo: land?.networkLogo ?? defaultNetworkLogo,
      networkLogoPosition: land?.networkLogoPosition ?? defaultNetworkLogoPosition,
      networkLogoFollowTitle: netResetView.follow,
      ribbonEnabled: land?.ribbonEnabled ?? defaultRibbonEnabled,
      gradientHeight: defaultGradientHeight,
      blurEnabled: defaultBlurEnabled,
      blurIntensity: defaultBlurIntensity,
      blurFade: defaultBlurFade,
      blurDarkness: defaultBlurDarkness,
      tintStrength: defaultTintStrength,
      topShade: defaultTopShade,
      topBadgeScale: land?.topBadgeScale ?? defaultTopBadgeScale,
      topBadgeOffsetX: land?.topBadgeOffsetX ?? defaultTopBadgeOffsetX,
      topBadgeOffsetY: land?.topBadgeOffsetY ?? defaultTopBadgeOffsetY,
      // Null esplicito del profilo = fallback legacy (preservato): solo
      // undefined eredita il globale. Mai sempre-null (rispetta l'extra
      // globale esplicito).
      extraBadgeScale: land?.extraBadgeScale !== undefined ? land.extraBadgeScale : defaultExtraBadgeScale,
      extraBadgeOffsetX: land?.extraBadgeOffsetX !== undefined ? land.extraBadgeOffsetX : defaultExtraBadgeOffsetX,
      extraBadgeOffsetY: land?.extraBadgeOffsetY !== undefined ? land.extraBadgeOffsetY : defaultExtraBadgeOffsetY,
      genreBadgeScale: land?.genreBadgeScale ?? defaultGenreBadgeScale,
      genreBadgeOffsetX: land?.genreBadgeOffsetX ?? defaultGenreBadgeOffsetX,
      genreBadgeOffsetY: land?.genreBadgeOffsetY ?? defaultGenreBadgeOffsetY,
      qualityBadgeScale: land?.qualityBadgeScale ?? defaultQualityBadgeScale,
      qualityBadgeOffsetX: land?.qualityBadgeOffsetX ?? defaultQualityBadgeOffsetX,
      qualityBadgeOffsetY: land?.qualityBadgeOffsetY ?? defaultQualityBadgeOffsetY,
      separateBadgeScale: land?.separateBadgeScale ?? defaultSeparateBadgeScale,
      separateBadgeOffsetX: land?.separateBadgeOffsetX ?? defaultSeparateBadgeOffsetX,
      separateBadgeOffsetY: land?.separateBadgeOffsetY ?? defaultSeparateBadgeOffsetY,
      networkLogoScale: land?.networkLogoScale ?? defaultNetworkLogoScale,
      networkLogoOffsetX: netResetView.follow ? netResetView.relativeX : (netResetView.fixedX ?? defaultNetworkLogoOffsetX),
      networkLogoOffsetY: netResetView.follow ? netResetView.relativeY : (netResetView.fixedY ?? defaultNetworkLogoOffsetY),
    })
    const isLand = posterShape === "landscape"
    setLogoScale((isLand ? landscapeDefaults?.logoScale : undefined) ?? defaultLogoScale ?? (logo ? (logoDefaultScale(logo as TMDBImage) ?? 75) : 75))
    setLogoOffsetX((isLand ? landscapeDefaults?.logoOffsetX : undefined) ?? defaultLogoOffsetX ?? 0)
    setLogoOffsetY((isLand ? landscapeDefaults?.logoOffsetY : undefined) ?? defaultLogoOffsetY ?? 0)
    setBackdropScale(100)
    setBackdropOffsetX(0)
    setBackdropOffsetY(0)
    setCustomBadge(null)
    setBadgePresetId(null)
    setBadgePresetRev(null)
    resetLandscapeBlur({
      gradientHeight: landscapeDefaults?.gradientHeight ?? defaultGradientHeight,
      blurEnabled: landscapeDefaults?.blurEnabled ?? defaultBlurEnabled,
      blurIntensity: landscapeDefaults?.blurIntensity ?? defaultBlurIntensity,
      blurFade: landscapeDefaults?.blurFade ?? defaultBlurFade ?? 70,
      blurDarkness: landscapeDefaults?.blurDarkness ?? defaultBlurDarkness,
      tintStrength: landscapeDefaults?.tintStrength ?? defaultTintStrength,
      topShade: landscapeDefaults?.topShade ?? defaultTopShade,
    })
  }, [update, posterShape, landscapeDefaults, defaultGlobalBadges, defaultRankingBadges, defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultCustomRatings, defaultRatingSources, defaultSeparateRatings, defaultSeparateRatingsStyle, defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, defaultBadgeFont, defaultQualityBadgeStyle, defaultVideoFormats, defaultNetworkLogo, defaultNetworkLogoPosition, defaultNetworkLogoFollowTitle, defaultRibbonEnabled, defaultGradientHeight, defaultBlurEnabled, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultTintStrength, defaultTopShade, defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, defaultGenreBadgeScale, defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeScale, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY, defaultSeparateBadgeScale, defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY, defaultNetworkLogoScale, defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const editorCtx = useMemo<PosterEditorCtx>(
    () => ({
      applyVisualPreset,
      resetPerTitleVisuals,
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
      separateRatingsStyle,
      setSeparateRatingsStyle,
      badgeStyle,
      setBadgeStyle,
      rankingBadgeStyle,
      setRankingBadgeStyle,
      extraBadgeStyle,
      setExtraBadgeStyle,
      badgeFont,
      setBadgeFont,
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
      networkLogoFollowTitle,
      setNetworkLogoFollowTitle,
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
      defaultExtraBadgeStyle,
      setDefaultExtraBadgeStyle,
      defaultBadgeFont,
      setDefaultBadgeFont,
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
      defaultExtraBadgeScale,
      setDefaultExtraBadgeScale,
      defaultExtraBadgeOffsetX,
      setDefaultExtraBadgeOffsetX,
      defaultExtraBadgeOffsetY,
      setDefaultExtraBadgeOffsetY,
      defaultGenreBadgeScale,
      setDefaultGenreBadgeScale,
      defaultGenreBadgeOffsetX,
      setDefaultGenreBadgeOffsetX,
      defaultGenreBadgeOffsetY,
      setDefaultGenreBadgeOffsetY,
      defaultQualityBadgeScale,
      setDefaultQualityBadgeScale,
      defaultSeparateBadgeScale,
      setDefaultSeparateBadgeScale,
      defaultSeparateBadgeOffsetX,
      setDefaultSeparateBadgeOffsetX,
      defaultSeparateBadgeOffsetY,
      setDefaultSeparateBadgeOffsetY,
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
      defaultSeparateRatingsStyle,
      setDefaultSeparateRatingsStyle,
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
      defaultNetworkLogoFollowTitle,
      setDefaultNetworkLogoFollowTitle,
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
      defaultSyncStatus,
      retryDefaultSync,

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
      extraBadgeScale,
      setExtraBadgeScale,
      extraBadgeOffsetX,
      setExtraBadgeOffsetX,
      extraBadgeOffsetY,
      setExtraBadgeOffsetY,

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

      // Colonna rating separati
      separateBadgeScale,
      setSeparateBadgeScale,
      separateBadgeOffsetX,
      setSeparateBadgeOffsetX,
      separateBadgeOffsetY,
      setSeparateBadgeOffsetY,

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
      separateRatingsStyle, setSeparateRatingsStyle,
      badgeStyle, setBadgeStyle,
      rankingBadgeStyle, setRankingBadgeStyle,
      extraBadgeStyle, setExtraBadgeStyle,
      badgeFont, setBadgeFont,
      qualityBadgeStyle, setQualityBadgeStyle,
      videoFormats, setVideoFormats,
      customBadge, setCustomBadge,
      badgePresetId, setBadgePresetId,
      badgePresetRev, setBadgePresetRev,
      networkLogo, setNetworkLogo,
      networkLogoPosition, setNetworkLogoPosition,
      networkLogoFollowTitle, setNetworkLogoFollowTitle,
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
      defaultExtraBadgeStyle, setDefaultExtraBadgeStyle,
      defaultBadgeFont, setDefaultBadgeFont,
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
      defaultExtraBadgeScale, setDefaultExtraBadgeScale,
      defaultExtraBadgeOffsetX, setDefaultExtraBadgeOffsetX,
      defaultExtraBadgeOffsetY, setDefaultExtraBadgeOffsetY,
      defaultGenreBadgeScale,
      setDefaultGenreBadgeScale,
      defaultGenreBadgeOffsetX,
      setDefaultGenreBadgeOffsetX,
      defaultGenreBadgeOffsetY,
      setDefaultGenreBadgeOffsetY,
      defaultQualityBadgeScale,
      setDefaultQualityBadgeScale,
      defaultSeparateBadgeScale,
      setDefaultSeparateBadgeScale,
      defaultSeparateBadgeOffsetX,
      setDefaultSeparateBadgeOffsetX,
      defaultSeparateBadgeOffsetY,
      setDefaultSeparateBadgeOffsetY,
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
      defaultSeparateRatingsStyle, setDefaultSeparateRatingsStyle,
      defaultSashOrder, setDefaultSashOrder,
      defaultAutoRotateClean, setDefaultAutoRotateClean,
      defaultDisableCleanPosters, setDefaultDisableCleanPosters,
      defaultAutoRotateBackdrop, setDefaultAutoRotateBackdrop,
      defaultPortraitFitEnabled, setDefaultPortraitFitEnabled,
      defaultLandscapeFitEnabled, setDefaultLandscapeFitEnabled,
      defaultNetworkLogo, setDefaultNetworkLogo,
      defaultNetworkLogoPosition, setDefaultNetworkLogoPosition,
      defaultNetworkLogoFollowTitle, setDefaultNetworkLogoFollowTitle,
      defaultPreRelease, setDefaultPreRelease,
      defaultRibbonSide, setDefaultRibbonSide,
      defaultRibbonEnabled, setDefaultRibbonEnabled,
      defaultPosterShape, setDefaultPosterShape,
      landscapeDefaults, setLandscape, resetLandscape,
      defaultLogoAlign, setDefaultLogoAlign,
      loadDefaultsToState, applyVisualPreset, resetPerTitleVisuals,
      defaultSyncStatus, retryDefaultSync,

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
      extraBadgeScale, setExtraBadgeScale,
      extraBadgeOffsetX, setExtraBadgeOffsetX,
      extraBadgeOffsetY, setExtraBadgeOffsetY,

      // Badge genere
      genreBadgeScale, setGenreBadgeScale,
      genreBadgeOffsetX, setGenreBadgeOffsetX,
      genreBadgeOffsetY, setGenreBadgeOffsetY,

      // Badge qualità
      qualityBadgeScale, setQualityBadgeScale,
      qualityBadgeOffsetX, setQualityBadgeOffsetX,
      qualityBadgeOffsetY, setQualityBadgeOffsetY,

      // Colonna rating separati
      separateBadgeScale, setSeparateBadgeScale,
      separateBadgeOffsetX, setSeparateBadgeOffsetX,
      separateBadgeOffsetY, setSeparateBadgeOffsetY,

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
