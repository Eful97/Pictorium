"use client"

import { useCallback } from "react"
import type { SearchResult, TMDBImage, Mapping, NetworkLogoPosition, PosterShape } from "./types"
import { titleOf, isCustomPosterUrl, splitCustomPosterSave, splitCustomBackdropSave } from "./utils"
import { isTvdbArtworkUrl } from "./tvdb-gallery-types"
import { buildCoverOnlyPayload } from "./cover-only-save"
import { computeTopBadge, resolveSavedBadgeExtra, type BadgeInput } from "./poster-badge"
import type { SashBucket } from "./badge-priority"
import { adjustGradientForPosterChange } from "./gradient-presets"
import { logoEffectiveAutoScale, resolveLogoDisplayedRank } from "./logo-selection"
import { t } from "./i18n"
import { isManualAccent } from "./accent-color"
import { sanitizeLogoText, TEXT_LOGO_DEFAULT_FONT } from "./text-logo"
import { normalizeGenreName } from "./genre-normalize"
import type { EnrichedAnimeItem } from "./validation"
import type { VideoFormat } from "./av-specs"
import type { SeparateRatingsStyle, ExtraBadgeStyle, ExtraBadgeFollowRank, AgeBadgeStyle, AwardBadgeMode, BadgeFont } from "./badge-styles"
import { isExtraBadgeStyleTransport, isExtraFollowRank, isAgeBadgeStyle, isAwardBadgeMode, DEFAULT_AGE_BADGE_STYLE, DEFAULT_AWARD_BADGE_MODE } from "./badge-styles"
import { DEFAULT_AGE_COUNTRY } from "./certification"
import type { PosterLayout, PosterFreshScope } from "./types"
import type { LandscapeBlurState } from "./contexts/PosterEditorContext"
import type { LandscapeServerDefaults } from "./server-defaults"
import { MAPPING_SHAPE_LAND_KEYS, isLandscapeKeyPresent, mappingShapeChainEffective, snapshotMissingMappingLandscape, type MappingShapeLandKey } from "./visual-presets"
import { http, ApiError } from "./http"

interface PosterSaveDeps {
  selected: SearchResult | null
  previewPoster: TMDBImage | null
  selectedLogo: TMDBImage | null
  setSelectedLogo: (logo: TMDBImage | null) => void
  setPreviewPoster: (poster: TMDBImage | null) => void
  setPreviewId: (id: string | null) => void
  posters: TMDBImage[]
  metaInfo: { genres: { id: number; name: string }[]; voteAverage: number; type?: string; status?: string; release_date?: string; first_air_date?: string; last_air_date?: string; next_episode_to_air?: { air_date: string } | null; number_of_seasons?: number; number_of_episodes?: number; awards?: string[]; nominations?: string[]; studios?: string[]; director?: string | null; keywords?: string[]; imdb_id?: string | null; wikidata_id?: string | null; networksDetailed?: { name: string; logo_path: string | null; origin_country?: string }[]; productionCompaniesDetailed?: { name: string; logo_path: string | null; origin_country?: string }[] }
  /** IMDb Top 250 membership for the selected content. */
  imdbTop250?: boolean
  trendRank: number | null
  mdblistAnimeList: EnrichedAnimeItem[]
  mappingsMap: Map<string, Mapping>
  loadMappings: () => Promise<void>
  logoScale: number
  logoOffsetX: number
  logoOffsetY: number
  selectedBackdrop: TMDBImage | null
  setSelectedBackdrop: (d: TMDBImage | null) => void
  backdropScale: number
  backdropOffsetX: number
  backdropOffsetY: number
  setBackdropScale: (v: number) => void
  setBackdropOffsetX: (v: number) => void
  setBackdropOffsetY: (v: number) => void
  globalBadges: boolean
  rankingBadges: boolean
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality: boolean
  /** Badge età per-titolo in editing (congelato al save; assente = default effettivi, mai migrato). */
  ageBadge?: boolean
  /** Paese classificazione età per-titolo in editing (fail-closed al render). */
  ageCountry?: string
  /** Stile pill età per-titolo in editing ("standard" = resa storica). */
  ageBadgeStyle?: AgeBadgeStyle
  /** Modalità top-badge premi per-titolo in editing ("badge" = resa storica). */
  awardBadgeStyle?: AwardBadgeMode
  customRatings: boolean
  /** Fonti del voto medio ★ per-titolo (congelate al save come gli altri badge). */
  ratingSources: string[]
  /** Colonna rating separati per-titolo (congelata al save). */
  separateRatings: boolean
  /** Layout dei rating separati per-titolo (congelato al save, default "column"). */
  separateRatingsStyle: SeparateRatingsStyle
  /**
   * Cornice stagionale per-titolo in editing (flat unico, entrambe le
   * forme): null = Automatico (assente nel payload = segue la lista),
   * "none"/temi = congelati al save. Condiviso tra i formati (mai profilo
   * landscape, mai backfill per-formato).
   */
  seasonalTheme?: import("./seasonal-theme").SeasonalThemeChoice | null
  customBadge: string | null
  badgeStyle: string
  rankingBadgeStyle: string
  /** Standalone extra-badge style per-titolo (congelato al save; null = legacy eredita, "follow-rank" = own-rank esplicito persistito). */
  extraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
  /** Font dei testi badge per-titolo (congelato al save). */
  badgeFont: string
  /** Stile icone del badge qualità per-titolo (congelato al save). */
  qualityBadgeStyle: string
  /** Formati A/V abilitati per-titolo (congelati al save). */
  videoFormats?: VideoFormat[] | null
  defaultBadgeStyle: string
  defaultRankingBadgeStyle: string
  defaultExtraBadgeStyle: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
  /** Flat style defaults for the save independence boundary (chain-correct
   *  backfill when a legacy flat is inherit-null/absent). All optional:
   *  absent = legacy factory/skip fallback (never the edited live value). */
  defaultGlobalBadges?: boolean
  defaultRankingBadges?: boolean
  defaultBadgeGenre?: boolean
  defaultBadgeYear?: boolean
  defaultBadgeRating?: boolean
  defaultBadgeQuality?: boolean
  /** Provenance default per-titolo per il boundary di indipendenza (vedi sopra). */
  defaultAgeBadge?: boolean
  defaultAgeCountry?: string
  defaultAgeBadgeStyle?: AgeBadgeStyle
  defaultAwardBadgeStyle?: AwardBadgeMode
  defaultCustomRatings?: boolean
  defaultSeparateRatings?: boolean
  defaultBadgeFont?: string
  defaultQualityBadgeStyle?: string
  defaultVideoFormats?: VideoFormat[] | null
  defaultNetworkLogo?: boolean
  defaultNetworkLogoPosition?: NetworkLogoPosition
  defaultRibbonEnabled?: boolean
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Profilo sfumatura landscape live (sezione Orizzontale). */
  landscapeBlur: LandscapeBlurState
  /** True se la sezione Orizzontale è stata toccata (guida il save). */
  landscapeBlurDirty: boolean
  /** Default globali logo (flat) e profilo Orizzontale: la scelta logo li
   *  applica quando il mapping non congela valori propri (null = auto/0). */
  defaultLogoScale: number | null
  defaultLogoOffsetX: number | null
  defaultLogoOffsetY: number | null
  landscapeDefaults: LandscapeServerDefaults | null
  tintStrength: number
  /** Ombra lineare superiore 0-100 (solo per-titolo). */
  topShade: number
  /** Altezza ombra superiore 0-100 (% canvas, solo per-titolo). */
  topShadeHeight: number
  gradientHeight: number
  setGradientHeight: (v: number) => void
  setBlurFade: (v: number) => void
  setLandscapeBlur: (patch: Partial<LandscapeBlurState>) => void
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /** Tuning EXTRA superiore per-titolo (congelato al save; null = fallback legacy). */
  extraBadgeScale: number | null
  extraBadgeOffsetX: number | null
  extraBadgeOffsetY: number | null
  genreBadgeScale: number
  qualityBadgeScale: number
  /** Scala % colonna rating separati per-titolo (congelata al save). */
  separateBadgeScale: number
  /** Offset px gruppo rating separati per-titolo (congelati al save). */
  separateBadgeOffsetX: number
  /** Offset px gruppo rating separati per-titolo (congelati al save). */
  separateBadgeOffsetY: number
  /**
   * Per-ITEM corrections del poster in editing (canonical wire form).
   * Congelate al save nel mapping per-titolo (null = automatico).
   */
  badgeItemTransforms?: string | null
  networkLogoScale: number
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  networkLogoOffsetX: number
  networkLogoOffsetY: number
  rotationPosters: string[]
  autoRotateClean: boolean
  defaultAutoRotateClean: boolean
  excludedPosters: string[]
  rotationBackdrops: string[]
  autoRotateBackdrop: boolean
  defaultAutoRotateBackdrop: boolean
  excludedBackdrops: string[]
  backdrops: TMDBImage[]
  accentColor: string | null
  /** Auto-rilevato: se coincide con accentColor, il mapping non congela alcun override. */
  autoAccentColor?: string | null
  logoDisabled: boolean
  setLogoDisabled: (v: boolean) => void
  /**
   * Text-as-logo dell'editor: testo digitato + font del bundle (enum badge).
   * Vuoto = nessun logo; non vuoto = il testo è la sorgente logo e il logo
   * immagine non viene salvato (una sola sorgente).
   */
  logoText?: string
  logoFont?: BadgeFont
  /** Rimozione logo: azzera anche il wordmark (è un logo, non styling). */
  setLogoText?: (v: string) => void
  setLogoFont?: (v: BadgeFont) => void
  /**
   * Base portrait congelata (`portraitBackdropPath`): path del backdrop da cui
   * il renderer ricava il crop 2:3 della base. Non-null SOLO quando l'editor è
   * in base auto (titolo senza poster clean, clean abilitati, nessun tile
   * scelto in griglia); null = base = poster salvato.
   */
  portraitBaseBackdropPath?: string | null
  /**
   * Logo che il server compone sulla base auto (stessa selezione condivisa
   * `selectBestLogo`): congelato al save insieme alla base, altrimenti il crop
   * salvato resterebbe un'immagine senza titolo su Stremio.
   */
  portraitBaseLogoPath?: string | null
  setLogoScale: (v: number, opts?: { auto?: boolean }) => void
  /**
   * Provenance scala titolo (correzione c1): false/assente = auto (il save
   * scrive null così il poster resta auto al rank-change; mai 100 baked sui
   * fallback Standard). True = esplicito (congelato, anche 75/100/150/200).
   */
  logoScaleExplicit?: boolean
  setLogoOffsetX: (v: number) => void
  setLogoOffsetY: (v: number) => void
  networkLogo: boolean
  /** Ancoraggio orizzontale del logo network per-titolo (congelato al save). */
  networkLogoPosition: NetworkLogoPosition
  /** Il network segue il titolo per-titolo (congelato al save, per-shape). */
  networkLogoFollowTitle: boolean
  /** Nastro stile Netflix all'angolo per-titolo (congelato al save). */
  ribbonEnabled: boolean
  lang: string
  /** Ordine sash dai default editor (stesso del render, o il salvataggio congela un badge diverso). */
  defaultSashOrder?: readonly SashBucket[] | null
  episodeGroupId?: string | null
  /** Formato canvas in editing (congelato per-titolo al save). */
  posterShape: PosterShape
  /** Graphical poster layout in editing (congelato per-titolo al save, per-shape). */
  posterLayout: PosterLayout
  /** Fresh apply scope in editing (congelato per-titolo al save, per-shape). */
  posterFreshScope: PosterFreshScope
}

export interface SaveConfigOverrides {
  excludedPosters?: string[]
  rotationPosters?: string[]
  excludedBackdrops?: string[]
  rotationBackdrops?: string[]
  previewPoster?: TMDBImage
  selectedBackdrop?: TMDBImage | null
  silent?: boolean
  /**
   * Staged style values of the shape NOT in editing (EditView shape stash,
   * newer than the saved mapping): portrait values for a landscape save,
   * landscape values for a portrait save. Only MAPPING_SHAPE_LAND_KEYS are
   * consumed (tuning, logo and gradient keep their existing rules);
   * absent = no staged edits (boundary from the saved mapping). Enables
   * both-shape edits before a single save without leaking either look into
   * the other.
   */
  otherShapeStash?: Partial<Record<MappingShapeLandKey, unknown>> | null
}

/**
 * Per-title save success toast position: bottom-right on desktop (>= lg),
 * global top-center below lg. Evaluated at toast time (SSR-safe); the global
 * Toaster stays top-center for errors and settings.
 */
function saveSuccessToastPosition(): "bottom-right" | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined
  try {
    return window.matchMedia("(max-width: 1023.5px)").matches ? undefined : "bottom-right"
  } catch {
    return undefined
  }
}

export function usePosterSave(deps: PosterSaveDeps) {
  const {
    selected, previewPoster, selectedLogo, setSelectedLogo, setPreviewPoster, setPreviewId,
    posters, metaInfo, imdbTop250, trendRank, mdblistAnimeList, mappingsMap, loadMappings,
    logoScale, logoOffsetX, logoOffsetY,
    selectedBackdrop, setSelectedBackdrop, backdropScale, backdropOffsetX, backdropOffsetY,
    setBackdropScale, setBackdropOffsetX, setBackdropOffsetY,
    globalBadges, rankingBadges, customBadge, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle,
    videoFormats,
    badgeGenre, badgeYear, badgeRating, badgeQuality, ageBadge, ageCountry, ageBadgeStyle, awardBadgeStyle, customRatings, ratingSources, separateRatings, separateRatingsStyle,
    seasonalTheme,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle,
    defaultGlobalBadges, defaultRankingBadges, defaultBadgeGenre, defaultBadgeYear,
    defaultBadgeRating, defaultBadgeQuality, defaultAgeBadge, defaultAgeCountry, defaultAgeBadgeStyle, defaultAwardBadgeStyle, defaultCustomRatings, defaultSeparateRatings,
    defaultBadgeFont, defaultQualityBadgeStyle, defaultVideoFormats,
    defaultNetworkLogo, defaultNetworkLogoPosition, defaultRibbonEnabled,
    blurEnabled, blurIntensity, blurFade, blurDarkness, landscapeBlur, landscapeBlurDirty, setLandscapeBlur, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY, landscapeDefaults, tintStrength, topShade, topShadeHeight, gradientHeight, setGradientHeight, setBlurFade,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    badgeItemTransforms,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, accentColor, autoAccentColor, logoDisabled, setLogoDisabled,
    portraitBaseBackdropPath, portraitBaseLogoPath,
    logoText, logoFont, setLogoText, setLogoFont,
    rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops,
    setLogoScale, setLogoOffsetX, setLogoOffsetY,     networkLogo, networkLogoPosition, networkLogoFollowTitle, ribbonEnabled, lang, episodeGroupId, posterShape, posterLayout, posterFreshScope,
    defaultSashOrder, logoScaleExplicit,
  } = deps

  const selectPoster = useCallback(async (image: TMDBImage) => {
    if (!selected) return
    // Il cambio artwork ricalibra altezza/fade solo da stato pristine
    // (default di tipo del poster precedente): preset Colore e tweak manuali
    // sopravvivono alla scelta di un altro poster. In landscape si ricalibra
    // il profilo Orizzontale (quello visibile in preview), in portrait i flat.
    const isLand = posterShape === "landscape"
    // Logo manuale su non-clean: scegliendo un DIVERSO poster non-clean in
    // portrait si azzera il logo in stato (solo locale, mai PUT, mai
    // logoDisabled) così non si trascina l'auto dal clean; l'utente può poi
    // applicarlo manualmente. Stesso poster ricliccato = nessun reset.
    // Landscape invariato (auto-effect dedicato).
    if (!isLand && image.file_path !== previewPoster?.file_path && image.iso_639_1 !== null) {
      setSelectedLogo(null)
    }
    const adj = adjustGradientForPosterChange(
      isLand ? { gradientHeight: landscapeBlur.gradientHeight, blurFade: landscapeBlur.blurFade } : { gradientHeight, blurFade },
      previewPoster,
      image,
    )
    setPreviewPoster(image)
    if (adj) {
      if (isLand) setLandscapeBlur({ gradientHeight: adj.gradientHeight, blurFade: adj.blurFade })
      else {
        setGradientHeight(adj.gradientHeight)
        setBlurFade(adj.blurFade)
      }
    }
    setPreviewId(`${selected.media_type}:${selected.id}`)
  }, [selected, previewPoster, gradientHeight, blurFade, posterShape, landscapeBlur, setLandscapeBlur, setSelectedLogo]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const selectLogo = useCallback(async (logo: TMDBImage) => {
    setSelectedLogo(logo)
    setLogoDisabled(false)
    // Scala/offset logo: default globali per formato (espliciti, anche 75) >
    // auto EFFETTIVO (correzione c1: Fresh effettivo = 100, fallback Standard
    // = aspect — mai 100 baked sui no-rank). Default → esplicito; puro auto →
    // provenance auto (preview sentinel, save null, rank-effect lo riallinea).
    // Senza default si resta sullo storico (auto + 0), mai regressioni;
    // espliciti salvati altrove invariati.
    const landLogo = posterShape === "landscape" ? landscapeDefaults : undefined
    const shapeDefault = landLogo?.logoScale ?? defaultLogoScale ?? null
    if (shapeDefault != null) {
      setLogoScale(shapeDefault)
    } else {
      const animeRank = mdblistAnimeList?.find((a) => a.id === selected?.id)?.rank ?? null
      const displayed = resolveLogoDisplayedRank({ trendRank, animeRank, rankingEnabled: rankingBadges })
      setLogoScale(
        logoEffectiveAutoScale(logo, { posterLayout, posterFreshScope, displayedRank: displayed }),
        { auto: true },
      )
    }
    setLogoOffsetX(landLogo?.logoOffsetX ?? defaultLogoOffsetX ?? 0)
    setLogoOffsetY(landLogo?.logoOffsetY ?? defaultLogoOffsetY ?? 0)
    if (!previewPoster && selected) {
      const existing = mappingsMap.get(`${selected.media_type}:${selected.id}`)
      if (existing) {
        // Base custom salvata: la preview deve partire dal tile custom (non
        // dal riferimento TMDB), altrimenti highlight e preview divergono.
        const customFile = existing.customPosterUrl && isCustomPosterUrl(existing.customPosterUrl)
          ? existing.customPosterUrl
          : null
        const filePath = customFile ?? existing.posterPath
        // Saved TVDB base reuses the stored mapping language (no new schema):
        // a with-text portrait restages honestly non-clean so save/reopen
        // never overlay an auto logo on baked-in text. Legacy-ambiguous
        // (null) and generic custom URLs keep the historical null.
        const stagedLang = customFile
          ? (isTvdbArtworkUrl(customFile) ? (existing.language ?? null) : null)
          : existing.language
        setPreviewPoster({ file_path: filePath, iso_639_1: stagedLang, vote_average: 0, width: 0, height: 0 })
      } else if (posters.length > 0) {
        setPreviewPoster(posters[0])
      }
    }
    if (selected) setPreviewId(`${selected.media_type}:${selected.id}`)
  }, [selected, previewPoster, mappingsMap, posters, posterShape, posterLayout, posterFreshScope, landscapeDefaults, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY, trendRank, mdblistAnimeList, rankingBadges]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const removeLogo = useCallback(async () => {
    if (!selected) return
    const key = `${selected.media_type}:${selected.id}`
    const existing = mappingsMap.get(key)
    if (!existing) {
      // Nessun mapping salvato: rimozione solo locale (niente PUT).
      setSelectedLogo(null)
      setLogoDisabled(true)
      // Anche il wordmark è un logo: rimuoverlo lo svuota (nessuna traccia
      // nascosta che rispunti riattivando i loghi).
      setLogoText?.("")
      setLogoFont?.(TEXT_LOGO_DEFAULT_FONT)
      if (selected) setPreviewId(`${selected.media_type}:${selected.id}`)
      return
    }
    const logoPrecedente = selectedLogo
    // Stesso split del save: mai un URL custom dentro posterPath (il render lo
    // usa come fallback TMDB). Il custom salvato resta intatto (non nel body).
    const logoSplit = splitCustomPosterSave(
      previewPoster?.file_path || selected.poster_path || "",
      selected.poster_path,
    )
    try {
      await http(`/api/mappings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: selected.id, mediaType: selected.media_type, title: titleOf(selected),
          posterPath: logoSplit.posterPath, logoPath: null,
          originalPosterPath: selected.poster_path, language: previewPoster?.iso_639_1 || null,
          logoScale, logoOffsetX, logoOffsetY,
          genreName: normalizeGenreName(metaInfo.genres[0]?.name, lang) || null,
          voteAverage: metaInfo.voteAverage || null,
          trendRank: trendRank ?? null,
          logoDisabled: true,
          // Il wordmark salvato è logo: "rimuovi logo" lo azzera davvero
          // (PUT merge: presente-null = clear esplicito).
          logoText: null,
          logoFont: null,
        }),
      })
      setSelectedLogo(null)
      setLogoText?.("")
      setLogoFont?.(TEXT_LOGO_DEFAULT_FONT)
      import("sonner").then(({ toast }) => toast(t("ui.logoRemoved")))
      loadMappings()
      if (selected) setPreviewId(`${selected.media_type}:${selected.id}`)
    } catch (e) {
      console.error("[pictorium] Remove logo failed:", e)
      // M17: rollback dello stato se il PUT non va a buon fine
      if (logoPrecedente) setSelectedLogo(logoPrecedente)
      import("sonner").then(({ toast }) => toast(t("ui.saveError")))
    }
  }, [selected, selectedLogo, previewPoster, logoScale, logoOffsetX, logoOffsetY, metaInfo, trendRank, mappingsMap, loadMappings]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const selectBackdrop = useCallback((img: TMDBImage) => {
    setSelectedBackdrop(img)
    setBackdropScale(100)
    setBackdropOffsetX(0)
    setBackdropOffsetY(0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const removeBackdrop = useCallback(() => {
    setSelectedBackdrop(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const saveConfig = useCallback(async (overrides: SaveConfigOverrides = {}) => {
    const posterToSave = overrides.previewPoster ?? previewPoster
    const backdropToSaveOverride = overrides.selectedBackdrop !== undefined ? overrides.selectedBackdrop : selectedBackdrop
    if (!selected || !posterToSave) return

    // Profilo stateless: il mapping per-titolo non può essere salvato (nessuno
    // storage server). La config di stile viaggia comunque nel link `?config=`.
    // Use shared badge computation — identical to server
    const animeRankData = mdblistAnimeList?.find((a) => a.id === selected.id)
    const badgeInput: BadgeInput = {
      mediaType: selected.media_type === "tv" ? "tv" : "movie",
      tmdbId: selected.id,
      releaseDate: metaInfo.release_date ?? null,
      firstAirDate: metaInfo.first_air_date ?? null,
      lastAirDate: metaInfo.last_air_date ?? null,
      seasonCount: metaInfo.number_of_seasons ?? null,
      originCountries: [...(metaInfo.networksDetailed ?? []), ...(metaInfo.productionCompaniesDetailed ?? [])]
        .map((c) => c.origin_country)
        .filter((c): c is string => !!c),
      genreIds: Array.isArray(metaInfo.genres) ? metaInfo.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id)) : null,
      voteAverage: metaInfo.voteAverage,
      trendRank: trendRank ?? null,
      animeRank: animeRankData?.rank ?? null,
      awards: metaInfo.awards ?? [],
      nominations: metaInfo.nominations ?? [],
      studios: metaInfo.studios ?? [],
      director: metaInfo.director ?? null,
      tvType: selected.media_type === "tv" ? metaInfo.type : null,
      tvStatus: selected.media_type === "tv" ? metaInfo.status : null,
      nextEpisodeAirDate: selected.media_type === "tv" ? (metaInfo.next_episode_to_air?.air_date ?? null) : null,
      numberOfEpisodes: selected.media_type === "tv" ? (metaInfo.number_of_episodes ?? null) : null,
      keywords: metaInfo.keywords ?? [],
      imdbTop250: !!imdbTop250,
    }
    const computed = computeTopBadge(badgeInput, t, lang, defaultSashOrder ?? null)
    // Time-bound mai congelati (upcoming, nuova stagione, "Ritorna"):
    // Stremio li ricalcola a runtime. Vedi resolveSavedBadgeExtra.
    const badgeExtra = resolveSavedBadgeExtra(computed, t)
    const badgeRank = (!badgeExtra && rankingBadges) ? (computed.badge?.type === "rank" ? computed.badge.rank : trendRank || undefined) : undefined
    const badgeLabel = (!badgeExtra && animeRankData) ? t("badge.anime") : (!badgeExtra && computed.badge?.type === "rank") ? (computed.badge.rankLabel || t("badge.today")) : undefined
    const isClean = posterToSave.iso_639_1 === null
    const isNewMapping = !mappingsMap.has(`${selected.media_type}:${selected.id}`)
    // Tile custom selezionato: posterPath resta il riferimento TMDB (fallback
    // del render) e l'URL va in customPosterUrl. Tile TMDB: custom azzerato
    // (il save congela lo stato mostrato). Vedi splitCustomPosterSave.
    const saveSplit = splitCustomPosterSave(posterToSave.file_path, selected.poster_path)
    const nextExcludedPosters = overrides.excludedPosters ?? excludedPosters
    const nextRotationPosters = overrides.rotationPosters ?? rotationPosters
    const excludedSet = new Set(nextExcludedPosters)
    const baseRotationPosters = nextRotationPosters.length > 0
      ? nextRotationPosters
      : defaultAutoRotateClean && isClean && isNewMapping
        ? posters.filter(p => p.iso_639_1 === null).map(p => p.file_path)
        : []
    const effectiveRotationPosters = baseRotationPosters.filter((path) => !excludedSet.has(path))
    // Risolvi network logo da salvare: SVG first → TMDB fallback, stesso ordine del poster-service
    let networkLogoPath: string | null = null
    let networkLogoName: string | null = null
    {
      const candidates: { name: string; logoPath: string | null }[] = [
        ...(metaInfo.networksDetailed ?? []),
        ...(metaInfo.productionCompaniesDetailed ?? []),
      ].map((c) => ({ name: c.name, logoPath: c.logo_path }))
      // Filtro anime già in getNetworkKey (ma per salvataggio teniamo semplice: prova SVG existence via heuristica locale minima)
      // Per non importare getNetworkKey qui, salva il primo con logo_path non null; il render farà comunque SVG-first.
      for (const cand of candidates) {
        if (cand.logoPath) { networkLogoPath = cand.logoPath; networkLogoName = cand.name; break }
      }
      if (!networkLogoPath && candidates.length) { networkLogoName = candidates[0].name }
    }
    // Logo manuale anche su portrait non-clean: il default resta nessun auto
    // (auto solo da clean/landscape a monte), ma la scelta manuale persiste.
    const effectiveLogoPath = !logoDisabled ? (selectedLogo?.file_path || null) : null
    // Text-as-logo: una sola sorgente logo. Con un wordmark digitato non si
    // salva il logo immagine (vince il testo, come in preview e al render);
    // svuotando il campo torna il logo selezionato. `logoDisabled` azzera
    // entrambi (scelta esplicita di nessun logo).
    const savedLogoText = logoDisabled ? null : sanitizeLogoText(logoText)
    // Base portrait auto congelata: la base è il crop del backdrop, che senza
    // logo sarebbe un'immagine senza titolo (stesso invariante del ramo
    // automatico, che senza logo torna al poster in lingua). Se l'editor non
    // ha un logo scelto si congela quello che il renderer comporrebbe sulla
    // base (stessa selezione condivisa). `logoDisabled` (scelta esplicita) non
    // viene mai scavalcato: il provider passa null in quel caso.
    const savedLogoPath = savedLogoText
      ? null
      : (effectiveLogoPath ?? (logoDisabled ? null : (portraitBaseLogoPath ?? null)))
    // Dual-format My Posters: gli slider mostrano il profilo del formato in
    // editing, quindi il save scrive il profilo attivo e PRESERVA l'altro dal
    // mapping esistente (mai azzerato dal save dell'altro formato). Per i
    // mapping nuovi il profilo verticale eredita gli slider (portrait subito
    // funzionante). Lo sfondo è editabile solo in landscape: in portrait si
    // preserva quello salvato, altrimenti ogni save verticale cancellerebbe
    // il 16:9 (oggi removeBackdrop + save portrait = backdrop perso).
    const prevMapping = mappingsMap.get(`${selected.media_type}:${selected.id}`) ?? null
    const isLandscapeMode = posterShape === "landscape"
    // Flat defaults for the independence boundary, in mapping-bare names
    // (`showBadges`, `badgeStyle`, …): the chain-effective freeze for
    // inherit-null/absent saved flats. A level the caller did not pass stays
    // `undefined` (= unknown provenance → legacy fallback, documented).
    const flatDefaultsChain: Record<string, unknown> = {
      showBadges: defaultGlobalBadges,
      rankingBadges: defaultRankingBadges,
      badgeGenre: defaultBadgeGenre,
      badgeYear: defaultBadgeYear,
      badgeRating: defaultBadgeRating,
      badgeQuality: defaultBadgeQuality,
      // Badge età per-titolo: provenance per il freeze chain-correct del
      // backfill (un OFF esplicito con default ON congela ON nel profilo
      // dell'altro formato; assente = fallback legacy, mai il live editato).
      ageBadge: defaultAgeBadge,
      ageCountry: defaultAgeCountry,
      ageBadgeStyle: defaultAgeBadgeStyle,
      awardBadgeStyle: defaultAwardBadgeStyle,
      customRatings: defaultCustomRatings,
      separateRatings: defaultSeparateRatings,
      badgeStyle: defaultBadgeStyle,
      rankingBadgeStyle: defaultRankingBadgeStyle,
      extraBadgeStyle: defaultExtraBadgeStyle,
      badgeFont: defaultBadgeFont,
      qualityBadgeStyle: defaultQualityBadgeStyle,
      videoFormats: defaultVideoFormats,
      networkLogo: defaultNetworkLogo,
      networkLogoPosition: defaultNetworkLogoPosition,
      ribbonEnabled: defaultRibbonEnabled,
    }
    // Staged edits of the shape NOT in editing (EditView shape stash, passed
    // as `otherShapeStash`): portrait values for a landscape save, landscape
    // values for a portrait save. Newer than the saved mapping when present.
    const otherStash = (overrides.otherShapeStash ?? null) as Record<string, unknown> | null
    const portraitStash = isLandscapeMode ? otherStash : null
    const landscapeStash = !isLandscapeMode ? otherStash : null
    // Portrait-flat writer (correction c1): a landscape save preserves the
    // flat VERBATIM — staged portrait value when present (newer than the
    // saved mapping, or the only portrait value for a new mapping), else the
    // saved flat (concrete stays, null stays null, absent stays absent on the
    // full-replace POST), else absent for a new mapping (inherit — never a
    // clone of the edited landscape live value into the portrait flat).
    const keepFlatKey = <T>(key: string, current: T): T => {
      if (!isLandscapeMode) return current
      const stashed = portraitStash?.[key]
      if (stashed !== undefined) return stashed as T
      if (prevMapping) return (prevMapping as unknown as Record<string, unknown>)[key] as T
      return undefined as T
    }
    // Sfumatura landscape: i valori live della sezione Orizzontale vincono
    // quando la sezione è stata toccata oppure il save avviene in landscape
    // (la preview li mostra) — altrimenti il profilo salvato resta intatto
    // (niente freeze involontario dei default al save portrait).
    const useLandscapeBlur = landscapeBlurDirty || isLandscapeMode
    const landscapeBlurPatch = {
      gradientHeight: landscapeBlur.gradientHeight,
      blurEnabled: landscapeBlur.blurEnabled,
      blurIntensity: landscapeBlur.blurIntensity,
      blurFade: landscapeBlur.blurFade,
      blurDarkness: landscapeBlur.blurDarkness,
      tintStrength: landscapeBlur.tintStrength,
      topShade: landscapeBlur.topShade,
      topShadeHeight: landscapeBlur.topShadeHeight,
    }
    // Stili/toggle per-titolo con indipendenza per formato (stessa regola del
    // tuning): i live sono la veste del formato in editing. Normalizzati come
    // il flat storico (extra transport-validated, formati null = eredita).
    const styleLive: Record<string, unknown> = {
      showBadges: globalBadges,
      rankingBadges,
      badgeGenre,
      badgeYear,
      badgeRating,
      badgeQuality,
      // Badge età per-titolo live (fallback default/factory per i chiamanti
      // legacy senza live: mai undefined nel boundary — un undefined
      // congelerebbe un backfill spurio nel profilo dell'altro formato).
      ageBadge: ageBadge ?? defaultAgeBadge ?? false,
      ageCountry: ageCountry ?? defaultAgeCountry ?? DEFAULT_AGE_COUNTRY,
      ageBadgeStyle: isAgeBadgeStyle(ageBadgeStyle)
        ? ageBadgeStyle
        : (isAgeBadgeStyle(defaultAgeBadgeStyle) ? defaultAgeBadgeStyle : DEFAULT_AGE_BADGE_STYLE),
      awardBadgeStyle: isAwardBadgeMode(awardBadgeStyle)
        ? awardBadgeStyle
        : (isAwardBadgeMode(defaultAwardBadgeStyle) ? defaultAwardBadgeStyle : DEFAULT_AWARD_BADGE_MODE),
      customRatings,
      separateRatings,
      badgeStyle,
      rankingBadgeStyle,
      extraBadgeStyle: isExtraBadgeStyleTransport(extraBadgeStyle) ? extraBadgeStyle : null,
      badgeFont,
      qualityBadgeStyle,
      videoFormats: videoFormats ?? null,
      networkLogo,
      networkLogoPosition,
      ribbonEnabled,
    }
    // Backfill portrait-save: for keys the edit moves away from the saved flat,
    // the landscape profile freezes the PRE-EDIT value (never the new flat),
    // so a portrait edit cannot move the landscape look. Only missing profile
    // keys (owned keys are never rebased); arrays cloned; inherit-null via the
    // shared snapshot helper. For inherit-null/absent saved flats the other
    // shape rendered the CHAIN (defaults), not the flat: freeze the
    // chain-effective value — but only when the edit actually moves it,
    // keeping the profile sparse otherwise. Unknown provenance (no defaults
    // passed: tests/legacy callers) keeps the legacy factory/skip fallback,
    // byte-identical to the pre-correction boundary. New mappings: no saved
    // flat to preserve, but an unvisited landscape would otherwise inherit the
    // new portrait flat and shadow the landscape defaults — so freeze the
    // CHAIN-effective look (landscape-defaults profile > flat default >
    // factory, never the edited live) for keys where it differs from the new
    // flat; staged landscape edits still win below.
    const prevFlatForBackfill: Record<string, unknown> = {}
    if (!isLandscapeMode && prevMapping) {
      const prevRec = prevMapping as unknown as Record<string, unknown>
      const prevLand = (prevMapping?.landscape ?? {}) as Record<string, unknown>
      for (const k of MAPPING_SHAPE_LAND_KEYS) {
        if (isLandscapeKeyPresent(prevLand, k)) continue
        const live = styleLive[k]
        const prev = prevRec[k]
        if (prev !== undefined && prev !== null) {
          const same = Array.isArray(live) || Array.isArray(prev)
            ? JSON.stringify(live ?? null) === JSON.stringify(prev ?? null)
            : (live ?? null) === (prev ?? null)
          if (!same) prevFlatForBackfill[k] = prev
          continue
        }
        const chain = mappingShapeChainEffective(
          k,
          flatDefaultsChain,
          (landscapeDefaults ?? null) as Record<string, unknown> | null,
        )
        if (!chain.known) {
          // Legacy fallback, byte-identical to the pre-correction boundary.
          if (prev === undefined) continue
          const same = Array.isArray(live) || Array.isArray(prev)
            ? JSON.stringify(live ?? null) === JSON.stringify(prev ?? null)
            : (live ?? null) === (prev ?? null)
          if (!same) prevFlatForBackfill[k] = prev
          continue
        }
        const target = chain.value
        if (k === "extraBadgeStyle" && (live == null) && isExtraFollowRank(target)) continue
        const moved = Array.isArray(live) || Array.isArray(target)
          ? JSON.stringify(live ?? null) !== JSON.stringify(target ?? null)
          : (live ?? null) !== (target ?? null)
        if (moved) prevFlatForBackfill[k] = target
      }
    }
    const styleBackfill = (!isLandscapeMode && prevMapping)
      ? snapshotMissingMappingLandscape(
        prevFlatForBackfill,
        (prevMapping?.landscape ?? {}) as Record<string, unknown>,
      )
      : (!isLandscapeMode && !prevMapping)
        ? (() => {
            const fresh: Record<string, unknown> = {}
            const stashRec = (landscapeStash ?? null) as Record<string, unknown> | null
            for (const k of MAPPING_SHAPE_LAND_KEYS) {
              if (stashRec?.[k] !== undefined) continue
              const chain = mappingShapeChainEffective(
                k,
                flatDefaultsChain,
                (landscapeDefaults ?? null) as Record<string, unknown> | null,
              )
              if (!chain.known) continue
              const live = styleLive[k]
              const target = chain.value
              // Legacy null extra renders pixel-identical to the follow-rank
              // marker (own-rank): never freeze a marker over a legacy null on
              // a new map — keep the profile sparse.
              if (k === "extraBadgeStyle" && (live == null) && isExtraFollowRank(target)) continue
              const moved = Array.isArray(live) || Array.isArray(target)
                ? JSON.stringify(live ?? null) !== JSON.stringify(target ?? null)
                : (live ?? null) !== (target ?? null)
              if (moved) fresh[k] = Array.isArray(target) ? [...(target as unknown[])] : target
            }
            return fresh
          })()
        : {}
    // Staged landscape style edits (both-shape edits before save): the stash
    // holds the last landscape live values (true effective, user intent) and
    // wins over the pre-edit backfill for the style keys it carries. Tuning,
    // logo and gradient keep their existing rules (prev-preserved / dirty).
    // The formerly-shared visuals travel in the same stash verbatim
    // (customBadge/accent/preset draft, null included: explicit auto/none —
    // the switch-restore materializes the effective look into live, so a
    // stashed null is never an untouched inherit).
    const landscapeStashStyles: Record<string, unknown> = {}
    if (landscapeStash) {
      const stashRec = landscapeStash as Record<string, unknown>
      for (const k of MAPPING_SHAPE_LAND_KEYS) {
        const v = stashRec[k]
        if (v !== undefined) landscapeStashStyles[k] = v
      }
    }
    // Retired Badge Lab (custom badge library removed): the editor no longer
    // stages family bindings, so the stored values round-trip verbatim —
    // never edited, never deleted by a save (full-replace upsert would drop
    // omitted keys). The renderer ignores them unconditionally.
    const prevRec = (prevMapping ?? null) as unknown as Record<string, unknown> | null
    const carryStored = (key: string): unknown =>
      prevRec && Object.prototype.hasOwnProperty.call(prevRec, key) ? prevRec[key] : undefined
    const prevLandRec = (prevMapping?.landscape ?? null) as unknown as Record<string, unknown> | null
    const carryStoredLand = (key: string): unknown =>
      prevLandRec && Object.prototype.hasOwnProperty.call(prevLandRec, key) ? prevLandRec[key] : undefined
    const landscapeProfile = isLandscapeMode
      ? {
          // Correzione c1: auto (provenance) → null (resta auto al
          // rank-change; mai 100 baked sui fallback Standard). Espliciti
          // (anche 75/100/150/200) congelati invariati.
          logoScale: logoScaleExplicit === false ? null : logoScale, logoOffsetX, logoOffsetY,
          topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
          extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
          genreBadgeScale, genreBadgeOffsetX, genreBadgeOffsetY,
          qualityBadgeScale, qualityBadgeOffsetX, qualityBadgeOffsetY,
          separateBadgeScale,
          separateBadgeOffsetX, separateBadgeOffsetY,
          badgeItemTransforms,
          separateRatingsStyle,
          posterLayout,
          posterFreshScope,
          networkLogoScale, networkLogoOffsetX, networkLogoOffsetY,
          networkLogoFollowTitle,
          ...styleLive,
          // Visuali un tempo condivisi, per-formato in landscape: il profilo
          // possiede il live della forma in editing (mai il flat portrait).
          // customBadge verbatim (null = auto, mai resurrect); accentColor
          // manual-or-null (null = automatico esplicito, mai auto congelato);
          // preset coppia atomica (null/null = nessun preset per la forma).
          customBadge,
          accentColor: isManualAccent(accentColor, autoAccentColor) ? accentColor : null,
          // Retired Badge Lab (custom badge library removed): the stored
          // profile keys round-trip verbatim (never edited, never deleted).
          ...(carryStoredLand("badgePresetId") !== undefined ? { badgePresetId: carryStoredLand("badgePresetId") } : {}),
          ...(carryStoredLand("badgePresetRev") !== undefined ? { badgePresetRev: carryStoredLand("badgePresetRev") } : {}),
          ...(carryStoredLand("badgePresets") !== undefined ? { badgePresets: carryStoredLand("badgePresets") } : {}),
          ...(carryStoredLand("badgePresetFollows") !== undefined ? { badgePresetFollows: carryStoredLand("badgePresetFollows") } : {}),
          ...landscapeBlurPatch,
        }
      : (useLandscapeBlur || prevMapping?.landscape || Object.keys(styleBackfill).length > 0 || Object.keys(landscapeStashStyles).length > 0
          ? (() => {
            const merged = { ...(prevMapping?.landscape ?? null), ...styleBackfill, ...landscapeStashStyles, ...(useLandscapeBlur ? landscapeBlurPatch : {}) }
            return merged
          })()
          : null)
    const backdropToSave = isLandscapeMode
      ? (backdropToSaveOverride?.file_path || null)
      : (backdropToSaveOverride?.file_path ?? prevMapping?.backdropPath ?? null)
    // Landscape custom split (portrait mirror above): custom tile →
    // backdropPath keeps the TMDB reference (render fallback if the URL dies)
    // and the URL goes to customBackdropUrl; TMDB tile or missing backdrop
    // (automatic) → custom cleared, the save freezes the shown state. The
    // portrait save preserves the saved customBackdropUrl verbatim
    // (per-format independence: portrait never touches landscape).
    const prevBackdropTmdbRef = prevMapping?.backdropPath && !isCustomPosterUrl(prevMapping.backdropPath)
      ? prevMapping.backdropPath
      : null
    const backdropSplit = isLandscapeMode
      ? (backdropToSave
        ? splitCustomBackdropSave(backdropToSave, prevBackdropTmdbRef)
        : { backdropPath: null as string | null, customBackdropUrl: null as string | null })
      : { backdropPath: backdropToSave, customBackdropUrl: prevMapping?.customBackdropUrl ?? null }
    // Esclusione con fallback (override presente): mirror di selectBackdrop,
    // che resetta scala/offset a 100/0/0 insieme alla selezione — senza, il save
    // conserverebbe le trasformazioni dello sfondo appena escluso.
    const backdropScaleToSave = overrides.selectedBackdrop !== undefined ? 100 : (isLandscapeMode ? backdropScale : (prevMapping?.backdropScale ?? backdropScale))
    const backdropOffsetXToSave = overrides.selectedBackdrop !== undefined ? 0 : (isLandscapeMode ? backdropOffsetX : (prevMapping?.backdropOffsetX ?? backdropOffsetX))
    const backdropOffsetYToSave = overrides.selectedBackdrop !== undefined ? 0 : (isLandscapeMode ? backdropOffsetY : (prevMapping?.backdropOffsetY ?? backdropOffsetY))
    // Rotazione sfondi landscape (mirror verticale): in portrait si preserva
    // quella salvata, altrimenti ogni save verticale cancellerebbe la
    // rotazione 16:9. Per i mapping nuovi in landscape con auto-rotate ON,
    // la lista parte da tutti gli sfondi disponibili.
    const nextExcludedBackdrops = overrides.excludedBackdrops ?? excludedBackdrops
    const nextRotationBackdrops = overrides.rotationBackdrops ?? rotationBackdrops
    const excludedBackdropSet = new Set(nextExcludedBackdrops)
    const baseRotationBackdrops = isLandscapeMode
      ? (nextRotationBackdrops.length > 0
        ? nextRotationBackdrops
        : defaultAutoRotateBackdrop && isNewMapping
          ? backdrops.map((b) => b.file_path)
          : [])
      : (prevMapping?.cleanBackdrops ?? [])
    const effectiveRotationBackdrops = baseRotationBackdrops.filter((path) => !excludedBackdropSet.has(path))
    try {
      await http("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: selected.id,
          mediaType: selected.media_type,
          title: titleOf(selected),
          posterPath: saveSplit.posterPath,
          // Portrait cover identity: on landscape saves the saved flat stays
          // saved (never clobbered by the other shape's live value — same
          // keepFlatKey rule as tuning/styles and the cover-only strict
          // split). Only without a mapping (first save) is the live value
          // frozen, like cover-only from the portrait file.
          customPosterUrl: isLandscapeMode && prevMapping ? (prevMapping.customPosterUrl ?? null) : saveSplit.customPosterUrl,
          logoPath: savedLogoPath,
          // Wordmark salvato (testo + font del bundle): i titoli senza logo
          // TMDB mantengono il proprio titolo composto anche su Stremio.
          logoText: savedLogoText,
          logoFont: savedLogoText ? logoFont : null,
          originalPosterPath: selected.poster_path,
          language: posterToSave.iso_639_1,
          logoScale: keepFlatKey("logoScale", logoScaleExplicit === false ? null : logoScale),
          logoOffsetX: keepFlatKey("logoOffsetX", logoOffsetX),
          logoOffsetY: keepFlatKey("logoOffsetY", logoOffsetY),
          backdropPath: backdropSplit.backdropPath,
          customBackdropUrl: backdropSplit.customBackdropUrl,
          // Base portrait congelata in modalità auto (solo portrait, vedi
          // provider): null = base storica dal poster, così un tile scelto in
          // griglia azzera la provenienza auto. In landscape il portrait è
          // l'ALTRO formato: preservato verbatim come la cover identity.
          portraitBackdropPath: isLandscapeMode && prevMapping
            ? (prevMapping.portraitBackdropPath ?? null)
            : (portraitBaseBackdropPath ?? null),
          backdropScale: backdropScaleToSave,
          backdropOffsetX: backdropOffsetXToSave,
          backdropOffsetY: backdropOffsetYToSave,
          genreName: normalizeGenreName(metaInfo.genres[0]?.name, lang) || null,
          voteAverage: metaInfo.voteAverage || null,
          // IMDb ID per provider custom rating: evita getExternalIds sui salvati.
          imdbId: metaInfo.imdb_id || null,
          // QID Wikidata per il fast-path REST awards (stesso pattern imdbId).
          wikidataId: metaInfo.wikidata_id || null,
          trendRank: trendRank ?? undefined,
          trendPeriod: "day",
          // Solo scelta manuale: l'auto-rilevato coincide con autoAccentColor e
          // non deve congelarsi nel mapping, altrimenti il calcolo server non
          // girerebbe più per questo titolo (né in preview né su Stremio).
          // Per-formato: in landscape il flat resta quello salvato VERBATIM
          // (mai clobberato dal live dell'altro formato); dallo stash portrait
          // vince la chiave PRESENTE (stessa semantica presence di keepFlatKey:
          // manuale valido stashato, oppure null = automatico ESPLICITO che
          // azzera il flat come un save portrait — mai resurrect del manuale
          // salvato; assente = mai visitato = salvato verbatim). Gli auto
          // effettivi non si congelano mai (il save scrive manual-or-null per
          // forma, mai l'hex campionato). Azzerare il flat portrait
          // (automatico) viaggia anche via save landscape quando lo stash
          // portrait lo dichiara esplicito; senza stash resta il salvato.
          accentColor: isLandscapeMode
            ? (() => {
              if (portraitStash != null && "accentColor" in portraitStash) {
                const stashed = (portraitStash as Record<string, unknown>).accentColor
                if (stashed === null) return undefined
                if (
                  typeof stashed === "string" &&
                  /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(stashed)
                ) {
                  return stashed
                }
              }
              return ((prevMapping?.accentColor ?? undefined) as string | undefined)
            })()
            : (isManualAccent(accentColor, autoAccentColor) ? accentColor : undefined),
          showBadges: keepFlatKey("showBadges", globalBadges),
          rankingBadges: keepFlatKey("rankingBadges", rankingBadges),
          // Snapshot esplicito per-titolo (freeze): valori pieni, mai
          // `undefined`="segui i default". Così cambiare le Impostazioni dopo
          // il save non muove più questo poster. I mapping vecchi con
          // `undefined` continuano a seguire i default finché non risalvati.
          // Per-formato: in landscape il flat resta quello salvato (mai
          // clobberato dalla veste dell'altro formato), come il tuning.
          badgeGenre: keepFlatKey("badgeGenre", badgeGenre),
          badgeYear: keepFlatKey("badgeYear", badgeYear),
          badgeRating: keepFlatKey("badgeRating", badgeRating),
          badgeQuality: keepFlatKey("badgeQuality", badgeQuality),
          // Badge età congelato per-titolo (stessa regola per-shape degli
          // altri toggle/stili: flat preservato in landscape, live in
          // portrait). I mapping vecchi senza chiavi restano senza chiavi
          // finché non risalvati (mai migrazione in lettura).
          ageBadge: keepFlatKey("ageBadge", ageBadge),
          ageCountry: keepFlatKey("ageCountry", ageCountry),
          ageBadgeStyle: keepFlatKey("ageBadgeStyle", ageBadgeStyle),
          awardBadgeStyle: keepFlatKey("awardBadgeStyle", awardBadgeStyle),
          customRatings: keepFlatKey("customRatings", customRatings),
          ratingSources: ratingSources ?? undefined,
          separateRatings: keepFlatKey("separateRatings", separateRatings),
          // Stile condiviso ma con profilo landscape preservato: in landscape
          // il flat resta quello salvato (mai clobberato dallo slider del
          // formato), come le altre scale con keepFlatKey.
          separateRatingsStyle: keepFlatKey("separateRatingsStyle", separateRatingsStyle),
          tvType: metaInfo.type || null,
          tvStatus: metaInfo.status || null,
          releaseDate: metaInfo.release_date || null,
          firstAirDate: metaInfo.first_air_date || null,
          badgeExtra,
          badgeRank,
          badgeLabel,
          animeRank: animeRankData?.rank ?? null,
          // Extra testuale per-titolo: in portrait il live ("" mai dal UI —
          // blur coerce a null), in landscape il flat salvato VERBATIM (mai
          // clobberato dal live dell'altro formato; staged portrait vince).
          customBadge: keepFlatKey("customBadge", customBadge),
          // Retired Badge Lab (custom badge library removed): the stored flat
          // keys round-trip verbatim (never edited, never deleted).
          ...(carryStored("badgePresetId") !== undefined ? { badgePresetId: carryStored("badgePresetId") } : {}),
          ...(carryStored("badgePresetRev") !== undefined ? { badgePresetRev: carryStored("badgePresetRev") } : {}),
          ...(carryStored("badgePresets") !== undefined ? { badgePresets: carryStored("badgePresets") } : {}),
          ...(carryStored("badgePresetFollows") !== undefined ? { badgePresetFollows: carryStored("badgePresetFollows") } : {}),
          badgeStyle: keepFlatKey("badgeStyle", badgeStyle),
          rankingBadgeStyle: keepFlatKey("rankingBadgeStyle", rankingBadgeStyle),
          // Transport snapshot (renderer boundary escluso): stili concreti e
          // sentinel "follow-rank" viaggiano validati; null/garbage = legacy.
          // Per-formato come gli altri stili (flat preservato in landscape).
          extraBadgeStyle: keepFlatKey("extraBadgeStyle", isExtraBadgeStyleTransport(extraBadgeStyle) ? extraBadgeStyle : null),
          badgeFont: keepFlatKey("badgeFont", badgeFont),
          qualityBadgeStyle: keepFlatKey("qualityBadgeStyle", qualityBadgeStyle),
          videoFormats: keepFlatKey("videoFormats", videoFormats !== undefined ? videoFormats : undefined),
          defaultBadgeStyle,
          defaultRankingBadgeStyle,
          defaultExtraBadgeStyle,
          blurEnabled: keepFlatKey("blurEnabled", blurEnabled),
          blurIntensity: keepFlatKey("blurIntensity", blurIntensity),
          blurFade: keepFlatKey("blurFade", blurFade),
          blurDarkness: keepFlatKey("blurDarkness", blurDarkness),
          tintStrength: keepFlatKey("tintStrength", tintStrength),
          topShade: keepFlatKey("topShade", topShade),
          topShadeHeight: keepFlatKey("topShadeHeight", topShadeHeight),
          gradientHeight: keepFlatKey("gradientHeight", gradientHeight),
          topBadgeScale: keepFlatKey("topBadgeScale", topBadgeScale),
          topBadgeOffsetX: keepFlatKey("topBadgeOffsetX", topBadgeOffsetX),
          topBadgeOffsetY: keepFlatKey("topBadgeOffsetY", topBadgeOffsetY),
          // Tuning extra: null = fallback legacy (mai migrato in automatico:
          // solo un edit extra esplicito lo scrive, vedi materializzazione).
          extraBadgeScale: keepFlatKey("extraBadgeScale", extraBadgeScale),
          extraBadgeOffsetX: keepFlatKey("extraBadgeOffsetX", extraBadgeOffsetX),
          extraBadgeOffsetY: keepFlatKey("extraBadgeOffsetY", extraBadgeOffsetY),
          genreBadgeScale: keepFlatKey("genreBadgeScale", genreBadgeScale),
          qualityBadgeScale: keepFlatKey("qualityBadgeScale", qualityBadgeScale),
          separateBadgeScale: keepFlatKey("separateBadgeScale", separateBadgeScale),
          separateBadgeOffsetX: keepFlatKey("separateBadgeOffsetX", separateBadgeOffsetX),
          separateBadgeOffsetY: keepFlatKey("separateBadgeOffsetY", separateBadgeOffsetY),
          // Per-item corrections: canonical form of the edited title. Absent
          // (null) = automatic layout, like every other geometry value.
          badgeItemTransforms: keepFlatKey("badgeItemTransforms", badgeItemTransforms),
          networkLogoScale: keepFlatKey("networkLogoScale", networkLogoScale),
          genreBadgeOffsetX: keepFlatKey("genreBadgeOffsetX", genreBadgeOffsetX),
          genreBadgeOffsetY: keepFlatKey("genreBadgeOffsetY", genreBadgeOffsetY),
          qualityBadgeOffsetX: keepFlatKey("qualityBadgeOffsetX", qualityBadgeOffsetX),
          qualityBadgeOffsetY: keepFlatKey("qualityBadgeOffsetY", qualityBadgeOffsetY),
          networkLogoOffsetX: keepFlatKey("networkLogoOffsetX", networkLogoOffsetX),
          networkLogoOffsetY: keepFlatKey("networkLogoOffsetY", networkLogoOffsetY),
          cleanPosters: effectiveRotationPosters.length > 0 ? effectiveRotationPosters : undefined,
          cleanPosterIndex: 0,
          cleanPosterUpdatedAt: new Date().toISOString(),
          autoRotateClean: effectiveRotationPosters.length > 1 ? autoRotateClean : undefined,
          excludedPosters: nextExcludedPosters.length > 0 ? nextExcludedPosters : undefined,
          cleanBackdrops: effectiveRotationBackdrops.length > 0 ? effectiveRotationBackdrops : undefined,
          cleanBackdropIndex: isLandscapeMode ? 0 : (prevMapping?.cleanBackdropIndex ?? undefined),
          cleanBackdropUpdatedAt: isLandscapeMode ? new Date().toISOString() : (prevMapping?.cleanBackdropUpdatedAt ?? undefined),
          autoRotateBackdrop: effectiveRotationBackdrops.length > 1 ? autoRotateBackdrop : undefined,
          excludedBackdrops: nextExcludedBackdrops.length > 0 ? nextExcludedBackdrops : undefined,
          logoDisabled: logoDisabled || undefined,
          networkLogo: keepFlatKey("networkLogo", networkLogo !== undefined ? networkLogo : undefined),
          // Follow congelato per-titolo (flat in portrait, preservato in
          // landscape come gli altri tuning per-shape): in landscape il flat
          // resta quello salvato, mai clobberato dal valore del formato.
          networkLogoFollowTitle: isLandscapeMode
            ? (prevMapping?.networkLogoFollowTitle ?? undefined)
            : networkLogoFollowTitle,
          // Posizione congelata per-titolo (freeze come gli altri toggle):
          // "auto" esplicito così il titolo non segue più i default dopo il save.
          // Per-formato: in landscape il flat resta quello salvato.
          networkLogoPosition: keepFlatKey("networkLogoPosition", networkLogoPosition),
          ribbonEnabled: keepFlatKey("ribbonEnabled", ribbonEnabled !== undefined ? ribbonEnabled : undefined),
          networkLogoPath: networkLogoPath ?? null,
          networkLogoName: networkLogoName ?? null,
          episodeGroupId: episodeGroupId || undefined,
          posterShape,
          // Graphical layout congelato per-titolo (flat in portrait, preservato
          // in landscape come gli altri tuning per-shape): in landscape il flat
          // resta quello salvato, mai clobberato dal valore del formato.
          posterLayout: keepFlatKey("posterLayout", posterLayout),
          // Fresh apply scope congelato per-titolo (stessa regola per-shape
          // del layout sopra): in landscape il flat resta quello salvato.
          posterFreshScope: keepFlatKey("posterFreshScope", posterFreshScope),
          // Cornice stagionale congelata per-titolo (flat unico condiviso
          // tra i formati: nessuna indipendenza per-formato, nessuno stash
          // landscape, nessun backfill — come ratingSources sopra). Null =
          // Automatico (assente nel payload = segue la lista di origine);
          // "none" = sopprime un tema ereditato; i temi seguono il titolo.
          seasonalTheme: seasonalTheme ?? undefined,
          landscape: landscapeProfile,
        }),
      })
      setPreviewId(`${selected.media_type}:${selected.id}`)
      // Conferma pillola/goccia arancio (lo stile e l'animazione vengono dal CSS globale).
      // Per-title success only: bottom-right on desktop via per-toast override;
      // below lg it inherits the global top-center.
      if (!overrides.silent) {
        const successPosition = saveSuccessToastPosition()
        import("sonner").then(({ toast }) => toast.success(t("ui.saveSuccess"), {
          duration: 2500,
          ...(successPosition ? { position: successPosition } : {}),
        }))
      }
      await loadMappings()
      return true
    } catch (error) {
      // 401 = istanza con ADMIN_TOKEN/multi-user senza sblocco: il generico
      // "errore" non dice cosa fare — guida allo sblocco admin (che abilita
      // anche i salvataggi, vedi ui.adminTokenDesc).
      if (!overrides.silent) {
        const toastMsg = error instanceof ApiError && error.status === 401
          ? t("ui.clearCacheUnauthorized")
          : t("ui.saveError")
        import("sonner").then(({ toast }) => toast.error(toastMsg))
      }
      if (overrides.silent) throw error
      return false
    }
  }, [selected, previewPoster, selectedLogo, metaInfo, logoScale, logoOffsetX, logoOffsetY, trendRank, globalBadges, rankingBadges, badgeGenre, badgeYear, badgeRating, badgeQuality, ageBadge, ageCountry, ageBadgeStyle, awardBadgeStyle, customRatings, ratingSources, separateRatings, separateRatingsStyle, seasonalTheme, mdblistAnimeList, loadMappings, customBadge, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle, videoFormats, blurEnabled, blurIntensity, blurFade, blurDarkness, landscapeBlur, landscapeBlurDirty, tintStrength, topShade, topShadeHeight, gradientHeight, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, genreBadgeScale, qualityBadgeScale, separateBadgeScale, separateBadgeOffsetX, separateBadgeOffsetY, badgeItemTransforms, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops, defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, defaultGlobalBadges, defaultRankingBadges, defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultAgeBadge, defaultAgeCountry, defaultAgeBadgeStyle, defaultAwardBadgeStyle, defaultCustomRatings, defaultSeparateRatings, defaultBadgeFont, defaultQualityBadgeStyle, defaultVideoFormats, defaultNetworkLogo, defaultNetworkLogoPosition, defaultRibbonEnabled, posters, mappingsMap, accentColor, autoAccentColor, backdropOffsetX, backdropOffsetY, backdropScale, selectedBackdrop, networkLogo, networkLogoPosition, networkLogoFollowTitle, ribbonEnabled, episodeGroupId, posterShape, posterLayout, posterFreshScope, portraitBaseBackdropPath, portraitBaseLogoPath, logoText, logoFont]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally complete to save all poster state

  /**
   * Cover-only save ("Salva solo poster" / "Save poster only"): persists
   * the cover image + logo identity plus non-visual title metadata
   * (see buildCoverOnlyPayload — genreName/voteAverage deliberately carried
   * as legacy mapped metadata so the mapped render branch keeps Genre/Rating
   * badges) via
   * full-replace POST — never PUT, whose merge would preserve previously
   * frozen styling instead of clearing it. Everything else follows the
   * global defaults after save. Exclusion autosaves keep using saveConfig
   * (full-save, unchanged).
   */
  const saveCoverOnly = useCallback(async () => {
    if (!selected) return
    const key = `${selected.media_type}:${selected.id}`
    const body = buildCoverOnlyPayload({
      selected,
      previewPoster,
      selectedBackdrop,
      selectedLogo,
      logoDisabled,
      logoText,
      logoFont,
      prevMapping: mappingsMap.get(key) ?? null,
      metaInfo,
      lang,
      episodeGroupId,
      posterShape,
    })
    if (!body) return
    try {
      await http("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setPreviewId(`${selected.media_type}:${selected.id}`)
      // Same desktop override as the full save; top-center inherited below lg. Errors unchanged.
      const coverSuccessPosition = saveSuccessToastPosition()
      import("sonner").then(({ toast }) => toast.success(t("ui.saveSuccess"), {
        duration: 2500,
        ...(coverSuccessPosition ? { position: coverSuccessPosition } : {}),
      }))
      await loadMappings()
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        import("sonner").then(({ toast }) => toast.error(t("ui.clearCacheUnauthorized")))
      } else {
        import("sonner").then(({ toast }) => toast.error(t("ui.saveError")))
      }
      return false
    }
  }, [selected, previewPoster, selectedLogo, logoDisabled, logoText, logoFont, selectedBackdrop, mappingsMap, metaInfo, lang, episodeGroupId, posterShape, loadMappings]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  return { selectPoster, selectLogo, removeLogo, selectBackdrop, removeBackdrop, saveConfig, saveCoverOnly }
}
