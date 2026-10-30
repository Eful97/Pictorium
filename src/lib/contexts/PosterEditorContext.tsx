"use client"

import { createContext, useContext, useState, useMemo, useCallback, useRef } from "react"
import type { TMDBImage, NetworkLogoPosition, PosterLayout, PosterFreshScope, PosterShape, LandscapeSettings } from "@/lib/types"
import { useDefaults, type DefaultSyncStatus, type DefaultsState, type StagedSaveResult } from "@/lib/useDefaults"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { DateFormat } from "@/lib/release-badge"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle, ExtraBadgeFollowRank, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle } from "@/lib/badge-styles"
import type { AgeBadgeStyle, AwardBadgeMode } from "@/lib/badge-styles"

import { DEFAULT_AGE_BADGE_STYLE, DEFAULT_AWARD_BADGE_MODE, getSeparateBadgeDefaultScale, isAgeBadgeStyle, isAwardBadgeMode } from "@/lib/badge-styles"
import { DEFAULT_AGE_COUNTRY, normalizeCertificationCountry } from "@/lib/certification"
import type { SashBucket } from "@/lib/badge-priority"
import { normalizeSeasonalThemeChoice, type SeasonalThemeChoice } from "@/lib/seasonal-theme"
import type { VideoFormat } from "@/lib/av-specs"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { independentLandscapeDefaults } from "@/lib/visual-presets"
import { materializeExtraTuning, clearedExtraForPresetApply } from "@/lib/extra-materialize"
import { projectPerTitleVisualPreset } from "@/lib/per-title-preset"
import { logoEffectiveAutoScale } from "@/lib/logo-selection"
import { canonicalizeBadgeItemTransforms, resolveShapeBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { TEXT_LOGO_DEFAULT_FONT } from "@/lib/text-logo"
import { resolveNetworkEffectiveView } from "@/lib/network-follow"
import { cloneShapeDraft, type ShapeDraftShape } from "@/lib/shape-draft"
import type { ActivePresetBaseline, ActivePresetMeta } from "@/lib/active-preset-baseline"

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
  /** Altezza ombra superiore (% canvas) del profilo landscape. */
  topShadeHeight: number
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
  topShadeHeight: 25,
}

export interface PosterEditorCtx {
  applyVisualPreset: (values: VisualPresetValues, target?: "portrait" | "landscape", meta?: ActivePresetMeta) => void
  /**
   * Persisted applied-preset reset references (one per shape), when the
   * settings session owns them. Absent outside the settings draft.
   */
  activePresetBaselines?: Partial<Record<"portrait" | "landscape", ActivePresetBaseline>>
  /**
   * Explicitly refresh the applied-preset reference after an approved preset
   * update. Never called by the global Save or by a plain apply.
   */
  refreshActivePresetBaseline?: (shape: "portrait" | "landscape", meta?: ActivePresetMeta) => void
  /**
   * Landscape profile reset: baseline-aware when an applied preset exists,
   * otherwise the documented clear-to-inherit contract.
   */
  resetLandscapeKeys?: (keys: readonly (keyof LandscapeServerDefaults)[]) => void
  /**
   * Applica uno snapshot visuale (built-in/salvato) al SOLO titolo corrente,
   * nel formato in editing: proiezione allowlisted via
   * `projectPerTitleVisualPreset` (mai `applyVisualPreset`, che scrive i
   * `default*` globali). Nessun cambio default, nessun autosave, artwork e
   * orientamento preservati. Gradiente del formato attivo incluso (flat in
   * portrait, profilo Orizzontale in landscape via `setLandscapeBlur`).
   * `logo` (il logo selezionato del titolo, task2 UI lo passa): serve a
   * risolvere la scala `null` del preset (documented auto-fit) via
   * `logoEffectiveAutoScale(logo, { posterLayout, posterFreshScope,
   * displayedRank: null })` (Fresh effettivo scope-all = 100, ranked + rank
   * ignoto = aspect conservativo riallineato dal rank-effect; Standard =
   * `logoDefaultScale(logo) ?? 75`); assente/senza dimensioni in Standard = 75. La
   * selezione artwork non cambia mai. Auto marca provenance (mai baked).
   */
  applyPerTitleVisualPreset: (values: VisualPresetValues, logo?: Pick<TMDBImage, "width" | "height"> | null) => void
  /**
   * Riporta TUTTI i visuali per-titolo ai default globali (stessi fallback
   * `mapping-assente ?? default*` dell'apertura titolo senza mapping), senza
   * toccare i default stessi. Usato dopo un salvataggio "solo copertina":
   * il mapping salvato congela solo cover + logo, quindi la preview (sempre
   * esplicita) deve mostrare i default per corrispondere al poster salvato.
   * Artwork (poster/backdrop/logo selezionati), logoDisabled, formato canvas,
   * rotazioni, esclusioni ed episodeGroupId restano intatti; `logo` (il logo
   * mantenuto) serve a risolvere la scala come `selectLogo` (default di
   * formato espliciti > auto EFFETTIVO `logoEffectiveAutoScale`
   * (Fresh scope-all = 100, ranked + rank ignoto = aspect, Standard = auto-fit
   * `logoDefaultScale(logo) ?? 75`), stessa catena del server per mapping senza
   * tuning; gli auto marcano provenance, mai baked). L'accent manuale si
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
  /** Badge età per-titolo del poster in editing (default OFF). */
  ageBadge: boolean
  setAgeBadge: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Paese della classificazione età per-titolo ("IT" = resa storica). */
  ageCountry: string
  setAgeCountry: (v: string | ((prev: string) => string)) => void
  /** Stile della pill età per-titolo ("standard" = resa storica). */
  ageBadgeStyle: AgeBadgeStyle
  setAgeBadgeStyle: (v: AgeBadgeStyle | ((prev: AgeBadgeStyle) => AgeBadgeStyle)) => void
  /** Modalità del top-badge premi per-titolo ("badge" = resa testuale storica). */
  awardBadgeStyle: AwardBadgeMode
  setAwardBadgeStyle: (v: AwardBadgeMode | ((prev: AwardBadgeMode) => AwardBadgeMode)) => void
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
  /** Graphical poster layout del poster in editing ("standard" = resa storica). */
  posterLayout: PosterLayout
  setPosterLayout: (v: PosterLayout | ((prev: PosterLayout) => PosterLayout)) => void
  /** Fresh apply scope del poster in editing ("ranked" = default: solo con rank). */
  posterFreshScope: PosterFreshScope
  setPosterFreshScope: (v: PosterFreshScope | ((prev: PosterFreshScope) => PosterFreshScope)) => void
  /**
   * Cornice stagionale per-titolo in editing (flat unico, entrambe le
   * forme): null = Automatico (segue la lista di origine), "none" =
   * sopprime il tema ereditato, "halloween"/"christmas" = scelta esplicita
   * che segue il titolo. Nessun default globale, nessun profilo landscape.
   */
  seasonalTheme: SeasonalThemeChoice | null
  setSeasonalTheme: (v: SeasonalThemeChoice | null | ((prev: SeasonalThemeChoice | null) => SeasonalThemeChoice | null)) => void
  badgeStyle: BadgeStyle
  setBadgeStyle: (v: BadgeStyle | ((prev: BadgeStyle) => BadgeStyle)) => void
  rankingBadgeStyle: RankingBadgeStyle
  setRankingBadgeStyle: (v: RankingBadgeStyle | ((prev: RankingBadgeStyle) => RankingBadgeStyle)) => void
  /** Standalone extra-badge style in editing (null = legacy `rs` fallback; "follow-rank" = explicit own-rank). */
  extraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  setExtraBadgeStyle: (v: ExtraBadgeStyle | ExtraBadgeFollowRank | null | ((prev: ExtraBadgeStyle | ExtraBadgeFollowRank | null) => ExtraBadgeStyle | ExtraBadgeFollowRank | null)) => void
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
  /** Standalone extra-badge style default (null = legacy `rs` fallback; "follow-rank" = explicit own-rank). */
  defaultExtraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  setDefaultExtraBadgeStyle: (v: ExtraBadgeStyle | ExtraBadgeFollowRank | null | ((prev: ExtraBadgeStyle | ExtraBadgeFollowRank | null) => ExtraBadgeStyle | ExtraBadgeFollowRank | null)) => void
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
  /**
   * Per-ITEM corrections of the badge groups (single rating pill / single
   * quality-AV mark) in canonical wire form. Null = automatic layout.
   */
  defaultBadgeItemTransforms: string | null
  setDefaultBadgeItemTransforms: (v: string | null | ((prev: string | null) => string | null)) => void
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
  /** Badge età testuale di default (default OFF). */
  defaultAgeBadge: boolean
  setDefaultAgeBadge: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Paese classificazione età di default ("IT"). Globale, mai auto-cambiato. */
  defaultAgeCountry: string
  setDefaultAgeCountry: (v: string | ((prev: string) => string)) => void
  /** Stile pill età di default ("standard" = resa storica). Globale, mai auto-cambiato. */
  defaultAgeBadgeStyle: AgeBadgeStyle
  setDefaultAgeBadgeStyle: (v: AgeBadgeStyle | ((prev: AgeBadgeStyle) => AgeBadgeStyle)) => void
  /** Modalità del top-badge premi di default ("badge" = resa testuale storica). */
  defaultAwardBadgeStyle: AwardBadgeMode
  setDefaultAwardBadgeStyle: (v: AwardBadgeMode | ((prev: AwardBadgeMode) => AwardBadgeMode)) => void
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
  /** Graphical poster layout di default ("standard" = resa storica). */
  defaultPosterLayout: PosterLayout
  setDefaultPosterLayout: (v: PosterLayout | ((prev: PosterLayout) => PosterLayout)) => void
  /** Fresh apply scope di default ("ranked" = default: solo con rank; "all" = override esplicito). */
  defaultPosterFreshScope: PosterFreshScope
  setDefaultPosterFreshScope: (v: PosterFreshScope | ((prev: PosterFreshScope) => PosterFreshScope)) => void
  /** Bucket sash abilitati (ordine canonico; vuota = tutto spento). */
  defaultSashOrder: SashBucket[]
  setDefaultSashOrder: (v: SashBucket[] | ((prev: SashBucket[]) => SashBucket[])) => void
  /**
   * Tag badge automatici disabilitati space-wide (ID canonici, vedi
   * `content-tags.ts`). Condivisi tra forme: nessun profilo landscape,
   * nessun per-titolo, nessuna recipe preset. Assente/vuoto = storico.
   */
  defaultDisabledContentTags: string[]
  setDefaultDisabledContentTags: (v: string[] | ((prev: string[]) => string[])) => void
  /**
   * Mark network disabilitati space-wide (ID canonici, vedi
   * `network-keys.ts`). Stesso contratto dei tag sopra.
   */
  defaultDisabledNetworks: string[]
  setDefaultDisabledNetworks: (v: string[] | ((prev: string[]) => string[])) => void
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
  /**
   * Authoritative explicit staged save (settings draft foundation): one PUT
   * of the exact staged default fields via the useDefaults sequence/status
   * machinery, no auto-effect duplicate. Failure leaves outer defaults and
   * durable storage unchanged.
   */
  saveStagedDefaults: (staged: DefaultsState) => Promise<StagedSaveResult>

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
  /** Ombra lineare superiore 0-100 in editing (solo per-titolo, default 50). */
  topShade: number
  setTopShade: (v: number | ((prev: number) => number)) => void
  /**
   * Altezza ombra superiore 0-100 (% canvas) in editing (solo per-titolo,
   * default 25 = look storico). 0 = ombra disattivata.
   */
  topShadeHeight: number
  setTopShadeHeight: (v: number | ((prev: number) => number)) => void
  /** Ombra superiore di default 0-100 (Impostazioni globali, default 50). */
  defaultTopShade: number
  setDefaultTopShade: (v: number | ((prev: number) => number)) => void
  /** Altezza ombra superiore di default 0-100 (Impostazioni, default 25). */
  defaultTopShadeHeight: number
  setDefaultTopShadeHeight: (v: number | ((prev: number) => number)) => void
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
  /** Per-ITEM corrections of the badge groups (canonical wire form, null = auto). */
  badgeItemTransforms: string | null
  setBadgeItemTransforms: (v: string | null | ((prev: string | null) => string | null)) => void

  // ---- Logo network ----
  networkLogoScale: number
  setNetworkLogoScale: (v: number | ((prev: number) => number)) => void
  networkLogoOffsetX: number
  setNetworkLogoOffsetX: (v: number | ((prev: number) => number)) => void
  networkLogoOffsetY: number
  setNetworkLogoOffsetY: (v: number | ((prev: number) => number)) => void

  // ---- Logo ----
  logoScale: number
  setLogoScale: (v: number | ((prev: number) => number), opts?: { auto?: boolean }) => void
  /**
   * Provenance della scala titolo (correzione c1: esplicito vs automatico):
   * true = scelta utente/default esplicito (preview emette il valore, il save
   * lo congela, rank/scope/layout non lo toccano mai); false = auto (preview
   * emette il sentinel `scale=0` e il server risolve Fresh-100 vs aspect
   * Standard, il save scrive null, solo gli auto si ricalcolano al
   * rank-arrival/change, ranking on/off, scope ranked↔all e reset/switch).
   * Un 100 automatico non è mai un 100 esplicito: toggle/reset non lo
   * promuovono a Standard baked.
   */
  logoScaleExplicit: boolean
  logoOffsetX: number
  setLogoOffsetX: (v: number | ((prev: number) => number)) => void
  logoOffsetY: number
  setLogoOffsetY: (v: number | ((prev: number) => number)) => void
  logoDisabled: boolean
  setLogoDisabled: (v: boolean | ((prev: boolean) => boolean)) => void
  /**
   * Logo testuale (titoli senza logo TMDB): testo digitato dall'utente,
   * reso dal server con uno dei font del bundle (`logoFont`, enum badge).
   * Vince sul logo immagine selezionato (una sola sorgente logo) e si
   * azzera svuotando il campo; stringa vuota = nessun logo (comportamento
   * storico). Mai un font caricato: solo l'enum.
   */
  logoText: string
  setLogoText: (v: string | ((prev: string) => string)) => void
  logoFont: BadgeFont
  setLogoFont: (v: BadgeFont | ((prev: BadgeFont) => BadgeFont)) => void
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
  /**
   * Shared per-title other-shape draft stash (see `src/lib/shape-draft.ts`):
   * single owner keyed by `perTitleDraftKey(userId, mediaType, id)`. EditView
   * mirrors its shape-switch stash here; normal Save passes its local stash
   * explicitly (wins) while exclusion autosaves resolve the shared draft via
   * `useSharedShapeStash` — same `otherShapeStash` save boundary. Per
   * provider instance (refs, never module-global): nothing leaks across
   * sessions. Key mismatch reads null; a new key claim drops the old entry,
   * so a new title identity never consumes the previous title's draft.
   */
  /** Mirror a staged other-shape draft (ownership moves to `titleKey`). */
  stashShapeDraft: (titleKey: string, shape: ShapeDraftShape, draft: LandscapeSettings) => void
  /** Read a staged draft for exactly `titleKey` (null on key mismatch). */
  readShapeDraft: (titleKey: string, shape: ShapeDraftShape) => LandscapeSettings | null
  /** Claim ownership for `titleKey` with empty drafts (title open). */
  resetShapeDraftsForTitle: (titleKey: string) => void
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
  // logoScaleExplicit (correzione c1): false = auto (sentinel: preview
  // `scale=0`, save null, ricalcolato solo dagli auto-path), true = scelta
  // utente o default esplicito (congelato, mai toccato dal rank-effect).
  // Stato iniziale auto (75 = fallback aspect senza dimensioni, mai baked).
  const [logoScale, setLogoScaleState] = useState(75)
  const [logoScaleExplicit, setLogoScaleExplicit] = useState(false)
  const setLogoScale = useCallback(
    (v: number | ((prev: number) => number), opts?: { auto?: boolean }) => {
      const next = typeof v === "function" ? v(logoScale) : v
      setLogoScaleState(next)
      setLogoScaleExplicit(opts?.auto !== true)
    }, [logoScale])
  const [logoOffsetX, setLogoOffsetX] = useState(0)
  const [logoOffsetY, setLogoOffsetY] = useState(0)
  const [logoDisabled, setLogoDisabled] = useState(false)
  // Text-as-logo: testo digitato + font del bundle (enum badge). Vuoto =
  // nessun logo, cioè la resa storica dei titoli senza logo TMDB.
  const [logoText, setLogoText] = useState("")
  const [logoFont, setLogoFont] = useState<BadgeFont>(TEXT_LOGO_DEFAULT_FONT)

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

  // Shared per-title other-shape draft stash (boundary documented in
  // `src/lib/shape-draft.ts`): single owner + per-shape staged drafts, refs
  // only (no re-render on stash — readers pull synchronously at save time).
  const shapeDraftOwnerRef = useRef<string | null>(null)
  const shapeDraftsRef = useRef(new Map<ShapeDraftShape, LandscapeSettings>())
  const stashShapeDraft = useCallback(
    (titleKey: string, shape: ShapeDraftShape, draft: LandscapeSettings) => {
      if (shapeDraftOwnerRef.current !== titleKey) {
        shapeDraftsRef.current.clear()
        shapeDraftOwnerRef.current = titleKey
      }
      shapeDraftsRef.current.set(shape, cloneShapeDraft(draft))
    }, [])
  const readShapeDraft = useCallback(
    (titleKey: string, shape: ShapeDraftShape): LandscapeSettings | null => {
      if (shapeDraftOwnerRef.current !== titleKey) return null
      const found = shapeDraftsRef.current.get(shape)
      return found ? cloneShapeDraft(found) : null
    }, [])
  const resetShapeDraftsForTitle = useCallback((titleKey: string) => {
    if (shapeDraftOwnerRef.current !== titleKey) {
      shapeDraftsRef.current.clear()
      shapeDraftOwnerRef.current = titleKey
    }
  }, [])

  // ---- Custom badge ----
  const [customBadge, setCustomBadge] = useState<string | null>(null)

  // Badge età per-titolo (stesso pattern dei visuali un tempo condivisi
  // sopra: stato live per-titolo, mai nei default persistiti — i default
  // restano i `defaultAge*`, con legacy alias bare `ageBadge*` intatti).
  // Iniziali = resa storica (l'apertura titolo li riallinea sempre a
  // mapping-effettivo > default di forma, mai colori/valori stantii).
  const [ageBadge, setAgeBadgeState] = useState<boolean>(false)
  const [ageCountry, setAgeCountryState] = useState<string>(DEFAULT_AGE_COUNTRY)
  const [ageBadgeStyle, setAgeBadgeStyleState] = useState<AgeBadgeStyle>(DEFAULT_AGE_BADGE_STYLE)
  // Modalità premi per-titolo (default "badge" = resa storica): stato live
  // dedicato, riallineato all'apertura titolo come l'età sopra.
  const [awardBadgeStyle, setAwardBadgeStyleState] = useState<AwardBadgeMode>(DEFAULT_AWARD_BADGE_MODE)
  // Cornice stagionale per-titolo: stato live dedicato (come l'età sopra),
  // null = Automatico (segue la lista di origine). Iniziale = Automatico
  // (l'apertura titolo lo riallinea sempre al mapping salvato, mai valori
  // stantii del titolo precedente).
  const [seasonalTheme, setSeasonalThemeState] = useState<SeasonalThemeChoice | null>(null)

  const {
    globalBadges, rankingBadges, networkLogo, networkLogoPosition, networkLogoFollowTitle, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle, posterLayout, posterFreshScope,
    gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, topShade, topShadeHeight,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
    extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    badgeItemTransforms,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    badgeStyle, rankingBadgeStyle, qualityBadgeStyle, videoFormats,
    extraBadgeStyle,
    badgeFont, defaultBadgeFont,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultQualityBadgeStyle, defaultVideoFormats,
    defaultExtraBadgeStyle,
    defaultBlurEnabled, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultTintStrength, defaultTopShade, defaultTopShadeHeight,
    defaultGradientHeight, defaultGlobalBadges, defaultRankingBadges,
    defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY,
    defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY,
    defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY,
    defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale,
    defaultSeparateBadgeScale,
    defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY,
    defaultBadgeItemTransforms,
    defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY,
    defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY,
    defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultAgeBadge, defaultAgeCountry, defaultAgeBadgeStyle, defaultAwardBadgeStyle, defaultCustomRatings, defaultCustomRatingEndpoint, defaultCustomRatingApiKeyHeader, defaultRatingSources, defaultSeparateRatings, defaultSeparateRatingsStyle, defaultPosterLayout, defaultPosterFreshScope, defaultSashOrder, defaultDisabledContentTags, defaultDisabledNetworks,
    defaultAutoRotateClean, defaultAutoRotateBackdrop, defaultPortraitFitEnabled, defaultLandscapeFitEnabled, defaultNetworkLogo, defaultNetworkLogoPosition, defaultNetworkLogoFollowTitle, defaultPreRelease, defaultRibbonSide, defaultRibbonEnabled, defaultPosterShape, defaultLogoAlign,
    defaultDisableCleanPosters,
    landscape: landscapeDefaults,
    episodeMetadataSource, defaultEpisodeMetadataSource,
    region, defaultRegion, defaultDateFormat,
    loadDefaultsToState, update,
  } = defaults
  const { defaultSyncStatus, retryDefaultSync, saveStagedDefaults } = defaults

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
  // Badge età per-titolo: stato live dedicato (vedi sopra), mai `update()`
  // sui default. Paese/stile validati fail-closed come il server (mai
  // GLOBAL/spazzatura nel live — il render li normalizza comunque).
  const setAgeBadge = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setAgeBadgeState((prev) => (typeof v === "function" ? v(prev) : v))
    }, [])
  const setAgeCountry = useCallback(
    (v: string | ((prev: string) => string)) => {
      setAgeCountryState((prev) => {
        const next = typeof v === "function" ? v(prev) : v
        return normalizeCertificationCountry(next) ?? DEFAULT_AGE_COUNTRY
      })
    }, [])
  const setAgeBadgeStyle = useCallback(
    (v: AgeBadgeStyle | ((prev: AgeBadgeStyle) => AgeBadgeStyle)) => {
      setAgeBadgeStyleState((prev) => {
        const next = typeof v === "function" ? v(prev) : v
        return isAgeBadgeStyle(next) ? next : DEFAULT_AGE_BADGE_STYLE
      })
    }, [])
  const setAwardBadgeStyle = useCallback(
    (v: AwardBadgeMode | ((prev: AwardBadgeMode) => AwardBadgeMode)) => {
      setAwardBadgeStyleState((prev) => {
        const next = typeof v === "function" ? v(prev) : v
        return isAwardBadgeMode(next) ? next : DEFAULT_AWARD_BADGE_MODE
      })
    }, [])
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
  // Graphical poster layout in editing: scelta esplicita per formato, mai
  // migrazione degli altri visuali (tornando a standard badge/logo/transform
  // restano intatti — il layout non li tocca).
  const setPosterLayout = useCallback(
    (v: PosterLayout | ((prev: PosterLayout) => PosterLayout)) => {
      const next = typeof v === "function" ? v(posterLayout) : v
      update({ posterLayout: next })
    }, [posterLayout, update])
  // Fresh apply scope in editing: scelta esplicita indipendente dal layout —
  // selezionare Standard conserva la preferenza (tornando a Fresh si ritrova).
  const setPosterFreshScope = useCallback(
    (v: PosterFreshScope | ((prev: PosterFreshScope) => PosterFreshScope)) => {
      const next = typeof v === "function" ? v(posterFreshScope) : v
      update({ posterFreshScope: next })
    }, [posterFreshScope, update])
  // Cornice stagionale per-titolo: stato live dedicato (mai `update()` sui
  // default — non esiste un default globale). Null = Automatico (segue la
  // lista); valori non validi normalizzati ad Automatico (fail-closed come
  // il server, mai spazzatura nel live).
  const setSeasonalTheme = useCallback(
    (v: SeasonalThemeChoice | null | ((prev: SeasonalThemeChoice | null) => SeasonalThemeChoice | null)) => {
      setSeasonalThemeState((prev) => {
        const next = typeof v === "function" ? v(prev) : v
        return normalizeSeasonalThemeChoice(next)
      })
    }, [])
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
      // toccano al cambio formato. Task 3B2: in landscape vince l'override
      // del profilo Orizzontale (`land ?? flat`, flat null = sinistra auto);
      // i portrait restano sempre centrati per contratto.
      update({
        posterShape: next,
        logoAlign: next === "landscape" ? (landscapeDefaults?.logoAlign ?? defaultLogoAlign ?? "left") : "center",
      })
    }, [posterShape, update, defaultLogoAlign, landscapeDefaults])
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
  const setBadgeItemTransforms = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      const next = typeof v === "function" ? v(badgeItemTransforms) : v
      // Canonical at the write boundary: one stored form per configuration.
      update({ badgeItemTransforms: canonicalizeBadgeItemTransforms(next) })
    }, [badgeItemTransforms, update])
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
  const setTopShadeHeight = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(topShadeHeight) : v
      update({ topShadeHeight: next })
    }, [topShadeHeight, update])
  const setDefaultTopShadeHeight = useCallback(
    (v: number | ((prev: number) => number)) => {
      const next = typeof v === "function" ? v(defaultTopShadeHeight) : v
      update({ defaultTopShadeHeight: next })
    }, [defaultTopShadeHeight, update])
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
    (v: ExtraBadgeStyle | ExtraBadgeFollowRank | null | ((prev: ExtraBadgeStyle | ExtraBadgeFollowRank | null) => ExtraBadgeStyle | ExtraBadgeFollowRank | null)) => {
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
    (v: ExtraBadgeStyle | ExtraBadgeFollowRank | null | ((prev: ExtraBadgeStyle | ExtraBadgeFollowRank | null) => ExtraBadgeStyle | ExtraBadgeFollowRank | null)) => {
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
  const setDefaultBadgeItemTransforms = useCallback(
    (v: string | null | ((prev: string | null) => string | null)) => {
      const next = typeof v === "function" ? v(defaultBadgeItemTransforms) : v
      // Canonical at the write boundary: one stored form per configuration.
      update({ defaultBadgeItemTransforms: canonicalizeBadgeItemTransforms(next) })
    }, [defaultBadgeItemTransforms, update])
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
  // Setter età portrait: prima della PRIMA modifica congelano nel profilo
  // landscape il valore flat corrente (snapshot esplicito, mai reseed dopo
  // l'update) così un portrait ON non attiva un landscape mai configurato. Il
  // profilo già esplicito (incluso `false`) non si tocca mai.
  const setDefaultAgeBadge = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === "function" ? v(defaultAgeBadge) : v
      update((prev) => prev.landscape.ageBadge === undefined
        ? { defaultAgeBadge: next, landscape: { ...prev.landscape, ageBadge: prev.defaultAgeBadge } }
        : { defaultAgeBadge: next })
    }, [defaultAgeBadge, update])
  const setDefaultAgeCountry = useCallback(
    (v: string | ((prev: string) => string)) => {
      const next = typeof v === "function" ? v(defaultAgeCountry) : v
      update((prev) => prev.landscape.ageCountry === undefined
        ? { defaultAgeCountry: next, landscape: { ...prev.landscape, ageCountry: prev.defaultAgeCountry } }
        : { defaultAgeCountry: next })
    }, [defaultAgeCountry, update])
  const setDefaultAgeBadgeStyle = useCallback(
    (v: AgeBadgeStyle | ((prev: AgeBadgeStyle) => AgeBadgeStyle)) => {
      const next = typeof v === "function" ? v(defaultAgeBadgeStyle) : v
      update((prev) => prev.landscape.ageBadgeStyle === undefined
        ? { defaultAgeBadgeStyle: next, landscape: { ...prev.landscape, ageBadgeStyle: prev.defaultAgeBadgeStyle } }
        : { defaultAgeBadgeStyle: next })
    }, [defaultAgeBadgeStyle, update])
  const setDefaultAwardBadgeStyle = useCallback(
    (v: AwardBadgeMode | ((prev: AwardBadgeMode) => AwardBadgeMode)) => {
      const next = typeof v === "function" ? v(defaultAwardBadgeStyle) : v
      // Portrait edit snapshots the pre-edit value into a still-inheriting
      // landscape profile (same boundary as the age style): pixels unchanged,
      // later portrait edits can never leak across shapes.
      update((prev) => prev.landscape.awardBadgeStyle === undefined
        ? { defaultAwardBadgeStyle: next, landscape: { ...prev.landscape, awardBadgeStyle: prev.defaultAwardBadgeStyle } }
        : { defaultAwardBadgeStyle: next })
    }, [defaultAwardBadgeStyle, update])
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
  const setDefaultPosterLayout = useCallback(
    (v: PosterLayout | ((prev: PosterLayout) => PosterLayout)) => {
      const next = typeof v === "function" ? v(defaultPosterLayout) : v
      update({ defaultPosterLayout: next })
    }, [defaultPosterLayout, update])
  const setDefaultPosterFreshScope = useCallback(
    (v: PosterFreshScope | ((prev: PosterFreshScope) => PosterFreshScope)) => {
      const next = typeof v === "function" ? v(defaultPosterFreshScope) : v
      update({ defaultPosterFreshScope: next })
    }, [defaultPosterFreshScope, update])
  const setDefaultSashOrder = useCallback(
    (v: SashBucket[] | ((prev: SashBucket[]) => SashBucket[])) => {
      const next = typeof v === "function" ? v(defaultSashOrder) : v
      update({ defaultSashOrder: next })
    }, [defaultSashOrder, update])
  const setDefaultDisabledContentTags = useCallback(
    (v: string[] | ((prev: string[]) => string[])) => {
      const next = typeof v === "function" ? v(defaultDisabledContentTags) : v
      update({ defaultDisabledContentTags: next })
    }, [defaultDisabledContentTags, update])
  const setDefaultDisabledNetworks = useCallback(
    (v: string[] | ((prev: string[]) => string[])) => {
      const next = typeof v === "function" ? v(defaultDisabledNetworks) : v
      update({ defaultDisabledNetworks: next })
    }, [defaultDisabledNetworks, update])
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
      // Reset per-shape (task 3B1): indipendente e shape-appropriate, mai
      // clear-to-follow. Congela l'effettivo portrait corrente per ogni chiave
      // (stessi pixel del follow, poi scollegato), qualità ai canonici 0/0
      // landscape e trio età ai default originali OFF/IT/standard (un flat ON
      // non riattiva mai il landscape resettato). Singolo update atomico.
      update((prev) => ({
        landscape: independentLandscapeDefaults(
          prev as unknown as Record<string, unknown>,
        ),
      }))
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

  // Per-title preset apply (EditView quick chooser): proiezione pura sul
  // formato in editing, MAI default*. Un solo merge atomico di chiavi bare
  // via update() (live draft: nessun PUT default, payload invariato); logo e
  // sfumatura landscape vivono in useState locali e passano dai setter
  // dedicati (setLandscapeBlur alza il dirty come un edit, guida il save).
  // posterShape/artwork/Badge Lab binding intoccati (la proiezione non li
  // emette).
  const applyPerTitleVisualPreset = useCallback((values: VisualPresetValues, logo?: Pick<TMDBImage, "width" | "height"> | null) => {
    const projection = projectPerTitleVisualPreset(values, posterShape)
    if (Object.keys(projection.bare).length > 0) {
      update(projection.bare)
    }
    if (projection.logo.scale !== undefined) {
      // Explicit number = exact (explicit); null = documented auto-fit request
      // on the CURRENT title's logo (correzione c1: Fresh EFFETTIVO via
      // logoEffectiveAutoScale con rank ignoto qui — scope "all" = 100, ranked
      // = aspect conservativo riallineato dal rank-effect in context — mai 100
      // baked; Standard = single source logoDefaultScale, fallback 75).
      // Never preserve the live scale. Auto marks provenance (preview
      // sentinel, save null); explicit marks explicit.
      // The auto scale resolves against the APPLIED layout/scope (the staged
      // bare values when the preset owns them), never the live pre-apply
      // pair — otherwise applying Fresh to a Standard title (or back) would
      // bake the outgoing look's scale while the staged recipe says otherwise.
      if (projection.logo.scale === null) {
        const appliedLayout = typeof projection.bare.posterLayout === "string"
          ? projection.bare.posterLayout
          : posterLayout
        const appliedScope = typeof projection.bare.posterFreshScope === "string"
          ? projection.bare.posterFreshScope
          : posterFreshScope
        setLogoScale(
          logoEffectiveAutoScale(logo, { posterLayout: appliedLayout, posterFreshScope: appliedScope, displayedRank: null }),
          { auto: true },
        )
      } else {
        setLogoScale(projection.logo.scale)
      }
    }
    if (projection.logo.offsetX !== undefined) setLogoOffsetX(projection.logo.offsetX)
    if (projection.logo.offsetY !== undefined) setLogoOffsetY(projection.logo.offsetY)
    if (posterShape === "landscape" && Object.keys(projection.landscapeBlur).length > 0) {
      setLandscapeBlur(projection.landscapeBlur)
    }
  }, [posterShape, posterLayout, posterFreshScope, update, setLogoScale, setLogoOffsetX, setLogoOffsetY, setLandscapeBlur])

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
      posterLayout: land?.posterLayout ?? defaultPosterLayout,
      posterFreshScope: land?.posterFreshScope ?? defaultPosterFreshScope,
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
      topShadeHeight: defaultTopShadeHeight,
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
      // Per-item corrections: profile wins when the shape owns the key
      // (including an explicit `null` = automatic layout), else the flat
      // (same inherit contract as every other geometry field).
      badgeItemTransforms: resolveShapeBadgeItemTransforms(land, defaultBadgeItemTransforms),
      networkLogoScale: land?.networkLogoScale ?? defaultNetworkLogoScale,
      networkLogoOffsetX: netResetView.follow ? netResetView.relativeX : (netResetView.fixedX ?? defaultNetworkLogoOffsetX),
      networkLogoOffsetY: netResetView.follow ? netResetView.relativeY : (netResetView.fixedY ?? defaultNetworkLogoOffsetY),
    })
    const isLand = posterShape === "landscape"
    // Scala titolo: default effettivi di formato (espliciti, anche 75/200) >
    // auto EFFETTIVO sul logo mantenuto (correzione c1: scope "all" + fresh =
    // 100, ranked + rank ignoto = aspect conservativo — mai 75/100 baked come
    // esplicito; il rank-effect in context riallinea i soli auto al rank noto).
    // Espliciti sempre preservati; gli auto marcano provenance (save null).
    const resetLayout = (isLand ? landscapeDefaults?.posterLayout : undefined) ?? defaultPosterLayout
    const resetScope = (isLand ? landscapeDefaults?.posterFreshScope : undefined) ?? defaultPosterFreshScope
    const resetDefaultScale = (isLand ? landscapeDefaults?.logoScale : undefined) ?? defaultLogoScale
    if (resetDefaultScale != null) {
      setLogoScale(resetDefaultScale)
    } else {
      setLogoScale(
        logoEffectiveAutoScale(logo, { posterLayout: resetLayout, posterFreshScope: resetScope, displayedRank: null }),
        { auto: true },
      )
    }
    setLogoOffsetX((isLand ? landscapeDefaults?.logoOffsetX : undefined) ?? defaultLogoOffsetX ?? 0)
    setLogoOffsetY((isLand ? landscapeDefaults?.logoOffsetY : undefined) ?? defaultLogoOffsetY ?? 0)
    setBackdropScale(100)
    setBackdropOffsetX(0)
    setBackdropOffsetY(0)
    setCustomBadge(null)
    // Badge età per-titolo: default effettivi di forma (mai il live del
    // titolo precedente — stesso isolamento degli altri visuali; i setter
    // validano fail-closed come il server).
    setAgeBadge(isLandReset ? (land?.ageBadge ?? defaultAgeBadge) : defaultAgeBadge)
    setAgeCountry(isLandReset ? (land?.ageCountry ?? defaultAgeCountry) : defaultAgeCountry)
    setAgeBadgeStyle(isLandReset ? (land?.ageBadgeStyle ?? defaultAgeBadgeStyle) : defaultAgeBadgeStyle)
    setAwardBadgeStyle(isLandReset ? (land?.awardBadgeStyle ?? defaultAwardBadgeStyle) : defaultAwardBadgeStyle)
    // Cornice stagionale per-titolo: il save "solo copertina" azzera la
    // scelta (Automatico = segue la lista) come gli altri visuali custom —
    // il mapping congelato contiene solo cover/logo/metadati.
    setSeasonalTheme(null)
    resetLandscapeBlur({
      gradientHeight: landscapeDefaults?.gradientHeight ?? defaultGradientHeight,
      blurEnabled: landscapeDefaults?.blurEnabled ?? defaultBlurEnabled,
      blurIntensity: landscapeDefaults?.blurIntensity ?? defaultBlurIntensity,
      blurFade: landscapeDefaults?.blurFade ?? defaultBlurFade ?? 70,
      blurDarkness: landscapeDefaults?.blurDarkness ?? defaultBlurDarkness,
      tintStrength: landscapeDefaults?.tintStrength ?? defaultTintStrength,
      topShade: landscapeDefaults?.topShade ?? defaultTopShade,
      topShadeHeight: landscapeDefaults?.topShadeHeight ?? defaultTopShadeHeight,
    })
  }, [update, posterShape, landscapeDefaults, defaultGlobalBadges, defaultRankingBadges, defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultAgeBadge, defaultAgeCountry, defaultAgeBadgeStyle, defaultAwardBadgeStyle, defaultCustomRatings, defaultRatingSources, defaultSeparateRatings, defaultSeparateRatingsStyle, defaultPosterLayout, defaultPosterFreshScope, defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, defaultBadgeFont, defaultQualityBadgeStyle, defaultVideoFormats, defaultNetworkLogo, defaultNetworkLogoPosition, defaultNetworkLogoFollowTitle, defaultRibbonEnabled, defaultGradientHeight, defaultBlurEnabled, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultTintStrength, defaultTopShade, defaultTopShadeHeight, defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultExtraBadgeScale, defaultExtraBadgeOffsetX, defaultExtraBadgeOffsetY, defaultGenreBadgeScale, defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeScale, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY, defaultSeparateBadgeScale, defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY, defaultNetworkLogoScale, defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY, setAgeBadge, setAgeCountry, setAgeBadgeStyle, setAwardBadgeStyle, setSeasonalTheme]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const editorCtx = useMemo<PosterEditorCtx>(
    () => ({
      applyVisualPreset,
      applyPerTitleVisualPreset,
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
      ageBadge,
      setAgeBadge,
      ageCountry,
      setAgeCountry,
      ageBadgeStyle,
      setAgeBadgeStyle,
      awardBadgeStyle,
      setAwardBadgeStyle,
      customRatings,
      setCustomRatings,
      ratingSources,
      setRatingSources,
      separateRatings,
      setSeparateRatings,
      separateRatingsStyle,
      setSeparateRatingsStyle,
      posterLayout,
      setPosterLayout,
      posterFreshScope,
      setPosterFreshScope,
      seasonalTheme,
      setSeasonalTheme,
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
      defaultBadgeItemTransforms,
      setDefaultBadgeItemTransforms,
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
      defaultAgeBadge,
      setDefaultAgeBadge,
      defaultAgeCountry,
      setDefaultAgeCountry,
      defaultAgeBadgeStyle,
      setDefaultAgeBadgeStyle,
      defaultAwardBadgeStyle,
      setDefaultAwardBadgeStyle,
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
      defaultPosterLayout,
      setDefaultPosterLayout,
      defaultPosterFreshScope,
      setDefaultPosterFreshScope,
      defaultSashOrder,
      setDefaultSashOrder,
      defaultDisabledContentTags,
      setDefaultDisabledContentTags,
      defaultDisabledNetworks,
      setDefaultDisabledNetworks,
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
      saveStagedDefaults,

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
      topShadeHeight,
      setTopShadeHeight,
      defaultTopShade,
      setDefaultTopShade,
      defaultTopShadeHeight,
      setDefaultTopShadeHeight,
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
      badgeItemTransforms,
      setBadgeItemTransforms,

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
      logoScaleExplicit,
      logoOffsetX,
      setLogoOffsetX,
      logoOffsetY,
      setLogoOffsetY,
      logoDisabled,
      setLogoDisabled,
      logoText,
      setLogoText,
      logoFont,
      setLogoFont,

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

      // Shared per-title other-shape draft stash (save boundary)
      stashShapeDraft,
      readShapeDraft,
      resetShapeDraftsForTitle,
    }),
    [
      // Badges
      globalBadges, setGlobalBadges,
      rankingBadges, setRankingBadges,
      badgeGenre, setBadgeGenre,
      badgeYear, setBadgeYear,
      badgeRating, setBadgeRating,
      badgeQuality, setBadgeQuality,
      ageBadge, setAgeBadge,
      ageCountry, setAgeCountry,
      ageBadgeStyle, setAgeBadgeStyle,
      awardBadgeStyle, setAwardBadgeStyle,
      customRatings, setCustomRatings,
      ratingSources, setRatingSources,
      separateRatings, setSeparateRatings,
      separateRatingsStyle, setSeparateRatingsStyle,
      posterLayout, setPosterLayout,
      posterFreshScope, setPosterFreshScope,
      seasonalTheme, setSeasonalTheme,
      badgeStyle, setBadgeStyle,
      rankingBadgeStyle, setRankingBadgeStyle,
      extraBadgeStyle, setExtraBadgeStyle,
      badgeFont, setBadgeFont,
      qualityBadgeStyle, setQualityBadgeStyle,
      videoFormats, setVideoFormats,
      customBadge, setCustomBadge,
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
      defaultBadgeItemTransforms,
      setDefaultBadgeItemTransforms,
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
      defaultAgeBadge, setDefaultAgeBadge,
      defaultAgeCountry, setDefaultAgeCountry,
      defaultAgeBadgeStyle, setDefaultAgeBadgeStyle,
      defaultAwardBadgeStyle, setDefaultAwardBadgeStyle,
      defaultCustomRatings, setDefaultCustomRatings,
      defaultCustomRatingEndpoint, setDefaultCustomRatingEndpoint,
      defaultCustomRatingApiKeyHeader, setDefaultCustomRatingApiKeyHeader,
      defaultRatingSources, setDefaultRatingSources,
      defaultSeparateRatings, setDefaultSeparateRatings,
      defaultSeparateRatingsStyle, setDefaultSeparateRatingsStyle,
      defaultPosterLayout, setDefaultPosterLayout,
      defaultPosterFreshScope, setDefaultPosterFreshScope,
      defaultSashOrder, setDefaultSashOrder,
      defaultDisabledContentTags, setDefaultDisabledContentTags,
      defaultDisabledNetworks, setDefaultDisabledNetworks,
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
      loadDefaultsToState, applyVisualPreset, applyPerTitleVisualPreset, resetPerTitleVisuals,
      defaultSyncStatus, retryDefaultSync, saveStagedDefaults,

      // Blur
      blurEnabled, setBlurEnabled,
      landscapeBlur, setLandscapeBlur, resetLandscapeBlur, landscapeBlurDirty,
      blurIntensity, setBlurIntensity,
      tintStrength, setTintStrength,
      topShade, setTopShade,
      topShadeHeight, setTopShadeHeight,
      defaultTopShade, setDefaultTopShade,
      defaultTopShadeHeight, setDefaultTopShadeHeight,
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
      separateBadgeOffsetY, setSeparateBadgeOffsetY, badgeItemTransforms, setBadgeItemTransforms,

      // Logo network
      networkLogoScale, setNetworkLogoScale,
      networkLogoOffsetX, setNetworkLogoOffsetX,
      networkLogoOffsetY, setNetworkLogoOffsetY,

      // Logo
      logoScale, setLogoScale, logoScaleExplicit,
      logoOffsetX, setLogoOffsetX,
      logoOffsetY, setLogoOffsetY,
      logoDisabled, setLogoDisabled,
      logoText, setLogoText, logoFont, setLogoFont,

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

      // Shared per-title other-shape draft stash (stable callbacks)
      stashShapeDraft, readShapeDraft, resetShapeDraftsForTitle,
    ],
  )

  return <Ctx.Provider value={editorCtx}>{children}</Ctx.Provider>
}

/**
 * Value-only PosterEditor override (settings draft foundation): merges a
 * partial value over the outer provider WITHOUT creating a nested real
 * provider (no useDefaults, no state, no persistence). Used to preview
 * staged settings drafts through the existing settings UI.
 */
export function PosterEditorValueOverride({
  value,
  children,
}: {
  value: Partial<PosterEditorCtx>
  children: React.ReactNode
}) {
  const outer = useContext(Ctx)
  if (!outer) throw new Error("usePosterEditor must be inside PosterEditorProvider")
  const merged = useMemo(() => ({ ...outer, ...value }), [outer, value])
  return <Ctx.Provider value={merged}>{children}</Ctx.Provider>
}
