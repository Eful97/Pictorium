"use client"

import { useCallback } from "react"
import type { SearchResult, TMDBImage, Mapping, NetworkLogoPosition, PosterShape } from "./types"
import { titleOf, isCustomPosterUrl, splitCustomPosterSave } from "./utils"
import { buildCoverOnlyPayload } from "./cover-only-save"
import { computeTopBadge, resolveSavedBadgeExtra, type BadgeInput } from "./poster-badge"
import type { SashBucket } from "./badge-priority"
import { adjustGradientForPosterChange } from "./gradient-presets"
import { logoEffectiveAutoScale, resolveLogoDisplayedRank } from "./logo-selection"
import { t } from "./i18n"
import { isManualAccent } from "./accent-color"
import { normalizeGenreName } from "./genre-normalize"
import type { EnrichedAnimeItem } from "./validation"
import type { VideoFormat } from "./av-specs"
import type { SeparateRatingsStyle, ExtraBadgeStyle } from "./badge-styles"
import type { PosterLayout, PosterFreshScope } from "./types"
import type { LandscapeBlurState } from "./contexts/PosterEditorContext"
import type { LandscapeServerDefaults } from "./server-defaults"
import { http, ApiError } from "./http"

interface PosterSaveDeps {
  selected: SearchResult | null
  previewPoster: TMDBImage | null
  selectedLogo: TMDBImage | null
  setSelectedLogo: (logo: TMDBImage | null) => void
  setPreviewPoster: (poster: TMDBImage | null) => void
  setPreviewId: (id: string | null) => void
  posters: TMDBImage[]
  metaInfo: { genres: { id: number; name: string }[]; voteAverage: number; type?: string; status?: string; release_date?: string; first_air_date?: string; last_air_date?: string; number_of_seasons?: number; awards?: string[]; nominations?: string[]; studios?: string[]; director?: string | null; keywords?: string[]; imdb_id?: string | null; wikidata_id?: string | null; networksDetailed?: { name: string; logo_path: string | null; origin_country?: string }[]; productionCompaniesDetailed?: { name: string; logo_path: string | null; origin_country?: string }[] }
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
  customRatings: boolean
  /** Fonti del voto medio ★ per-titolo (congelate al save come gli altri badge). */
  ratingSources: string[]
  /** Colonna rating separati per-titolo (congelata al save). */
  separateRatings: boolean
  /** Layout dei rating separati per-titolo (congelato al save, default "column"). */
  separateRatingsStyle: SeparateRatingsStyle
  customBadge: string | null
  badgePresetId?: string | null
  badgePresetRev?: string | null
  badgeStyle: string
  rankingBadgeStyle: string
  /** Standalone extra-badge style per-titolo (congelato al save, null = legacy). */
  extraBadgeStyle: ExtraBadgeStyle | null
  /** Font dei testi badge per-titolo (congelato al save). */
  badgeFont: string
  /** Stile icone del badge qualità per-titolo (congelato al save). */
  qualityBadgeStyle: string
  /** Formati A/V abilitati per-titolo (congelati al save). */
  videoFormats?: VideoFormat[] | null
  defaultBadgeStyle: string
  defaultRankingBadgeStyle: string
  defaultExtraBadgeStyle: ExtraBadgeStyle | null
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
}

export function usePosterSave(deps: PosterSaveDeps) {
  const {
    selected, previewPoster, selectedLogo, setSelectedLogo, setPreviewPoster, setPreviewId,
    posters, metaInfo, imdbTop250, trendRank, mdblistAnimeList, mappingsMap, loadMappings,
    logoScale, logoOffsetX, logoOffsetY,
    selectedBackdrop, setSelectedBackdrop, backdropScale, backdropOffsetX, backdropOffsetY,
    setBackdropScale, setBackdropOffsetX, setBackdropOffsetY,
    globalBadges, rankingBadges, customBadge, badgePresetId, badgePresetRev, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle,
    videoFormats,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle,
    blurEnabled, blurIntensity, blurFade, blurDarkness, landscapeBlur, landscapeBlurDirty, setLandscapeBlur, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY, landscapeDefaults, tintStrength, topShade, gradientHeight, setGradientHeight, setBlurFade,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, accentColor, autoAccentColor, logoDisabled, setLogoDisabled,
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
        setPreviewPoster({ file_path: filePath, iso_639_1: customFile ? null : existing.language, vote_average: 0, width: 0, height: 0 })
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
        }),
      })
      setSelectedLogo(null)
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
      voteAverage: metaInfo.voteAverage,
      trendRank: trendRank ?? null,
      animeRank: animeRankData?.rank ?? null,
      awards: metaInfo.awards ?? [],
      nominations: metaInfo.nominations ?? [],
      studios: metaInfo.studios ?? [],
      director: metaInfo.director ?? null,
      tvType: selected.media_type === "tv" ? metaInfo.type : null,
      tvStatus: selected.media_type === "tv" ? metaInfo.status : null,
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
    // Dual-format My Posters: gli slider mostrano il profilo del formato in
    // editing, quindi il save scrive il profilo attivo e PRESERVA l'altro dal
    // mapping esistente (mai azzerato dal save dell'altro formato). Per i
    // mapping nuovi il profilo verticale eredita gli slider (portrait subito
    // funzionante). Lo sfondo è editabile solo in landscape: in portrait si
    // preserva quello salvato, altrimenti ogni save verticale cancellerebbe
    // il 16:9 (oggi removeBackdrop + save portrait = backdrop perso).
    const prevMapping = mappingsMap.get(`${selected.media_type}:${selected.id}`) ?? null
    const isLandscapeMode = posterShape === "landscape"
    const keepFlat = <T>(current: T, saved: T | null | undefined): T =>
      isLandscapeMode ? (prevMapping ? (saved ?? current) : current) : current
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
    }
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
          separateRatingsStyle,
          posterLayout,
          posterFreshScope,
          networkLogoScale, networkLogoOffsetX, networkLogoOffsetY,
          networkLogoFollowTitle,
          ...landscapeBlurPatch,
        }
      : (useLandscapeBlur || prevMapping?.landscape
          ? { ...(prevMapping?.landscape ?? null), ...(useLandscapeBlur ? landscapeBlurPatch : {}) }
          : null)
    const backdropToSave = isLandscapeMode
      ? (backdropToSaveOverride?.file_path || null)
      : (backdropToSaveOverride?.file_path ?? prevMapping?.backdropPath ?? null)
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
          customPosterUrl: saveSplit.customPosterUrl,
          logoPath: effectiveLogoPath,
          originalPosterPath: selected.poster_path,
          language: posterToSave.iso_639_1,
          logoScale: keepFlat(logoScaleExplicit === false ? null : logoScale, prevMapping?.logoScale),
          logoOffsetX: keepFlat(logoOffsetX, prevMapping?.logoOffsetX),
          logoOffsetY: keepFlat(logoOffsetY, prevMapping?.logoOffsetY),
          backdropPath: backdropToSave,
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
          accentColor: isManualAccent(accentColor, autoAccentColor) ? accentColor : undefined,
          showBadges: globalBadges,
          rankingBadges,
          // Snapshot esplicito per-titolo (freeze): valori pieni, mai
          // `undefined`="segui i default". Così cambiare le Impostazioni dopo
          // il save non muove più questo poster. I mapping vecchi con
          // `undefined` continuano a seguire i default finché non risalvati.
          badgeGenre,
          badgeYear,
          badgeRating,
          badgeQuality,
          customRatings,
          ratingSources: ratingSources ?? undefined,
          separateRatings,
          // Stile condiviso ma con profilo landscape preservato: in landscape
          // il flat resta quello salvato (mai clobberato dallo slider del
          // formato), come le altre scale con keepFlat.
          separateRatingsStyle: keepFlat(separateRatingsStyle, prevMapping?.separateRatingsStyle),
          tvType: metaInfo.type || null,
          tvStatus: metaInfo.status || null,
          releaseDate: metaInfo.release_date || null,
          firstAirDate: metaInfo.first_air_date || null,
          badgeExtra,
          badgeRank,
          badgeLabel,
          animeRank: animeRankData?.rank ?? null,
          customBadge,
          badgePresetId: badgePresetId ?? null,
          badgePresetRev: badgePresetRev ?? null,
          badgeStyle,
          rankingBadgeStyle,
          extraBadgeStyle,
          badgeFont,
          qualityBadgeStyle,
          videoFormats: videoFormats !== undefined ? videoFormats : undefined,
          defaultBadgeStyle,
          defaultRankingBadgeStyle,
          defaultExtraBadgeStyle,
          blurEnabled: keepFlat(blurEnabled, prevMapping?.blurEnabled),
          blurIntensity: keepFlat(blurIntensity, prevMapping?.blurIntensity),
          blurFade: keepFlat(blurFade, prevMapping?.blurFade),
          blurDarkness: keepFlat(blurDarkness, prevMapping?.blurDarkness),
          tintStrength: keepFlat(tintStrength, prevMapping?.tintStrength),
          topShade: keepFlat(topShade, prevMapping?.topShade),
          gradientHeight: keepFlat(gradientHeight, prevMapping?.gradientHeight),
          topBadgeScale: keepFlat(topBadgeScale, prevMapping?.topBadgeScale),
          topBadgeOffsetX: keepFlat(topBadgeOffsetX, prevMapping?.topBadgeOffsetX),
          topBadgeOffsetY: keepFlat(topBadgeOffsetY, prevMapping?.topBadgeOffsetY),
          // Tuning extra: null = fallback legacy (mai migrato in automatico:
          // solo un edit extra esplicito lo scrive, vedi materializzazione).
          extraBadgeScale: keepFlat(extraBadgeScale, prevMapping?.extraBadgeScale),
          extraBadgeOffsetX: keepFlat(extraBadgeOffsetX, prevMapping?.extraBadgeOffsetX),
          extraBadgeOffsetY: keepFlat(extraBadgeOffsetY, prevMapping?.extraBadgeOffsetY),
          genreBadgeScale: keepFlat(genreBadgeScale, prevMapping?.genreBadgeScale),
          qualityBadgeScale: keepFlat(qualityBadgeScale, prevMapping?.qualityBadgeScale),
          separateBadgeScale: keepFlat(separateBadgeScale, prevMapping?.separateBadgeScale),
          separateBadgeOffsetX: keepFlat(separateBadgeOffsetX, prevMapping?.separateBadgeOffsetX),
          separateBadgeOffsetY: keepFlat(separateBadgeOffsetY, prevMapping?.separateBadgeOffsetY),
          networkLogoScale: keepFlat(networkLogoScale, prevMapping?.networkLogoScale),
          genreBadgeOffsetX: keepFlat(genreBadgeOffsetX, prevMapping?.genreBadgeOffsetX),
          genreBadgeOffsetY: keepFlat(genreBadgeOffsetY, prevMapping?.genreBadgeOffsetY),
          qualityBadgeOffsetX: keepFlat(qualityBadgeOffsetX, prevMapping?.qualityBadgeOffsetX),
          qualityBadgeOffsetY: keepFlat(qualityBadgeOffsetY, prevMapping?.qualityBadgeOffsetY),
          networkLogoOffsetX: keepFlat(networkLogoOffsetX, prevMapping?.networkLogoOffsetX),
          networkLogoOffsetY: keepFlat(networkLogoOffsetY, prevMapping?.networkLogoOffsetY),
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
          networkLogo: networkLogo !== undefined ? networkLogo : undefined,
          // Follow congelato per-titolo (flat in portrait, preservato in
          // landscape come gli altri tuning per-shape): in landscape il flat
          // resta quello salvato, mai clobberato dal valore del formato.
          networkLogoFollowTitle: isLandscapeMode
            ? (prevMapping?.networkLogoFollowTitle ?? undefined)
            : networkLogoFollowTitle,
          // Posizione congelata per-titolo (freeze come gli altri toggle):
          // "auto" esplicito così il titolo non segue più i default dopo il save.
          networkLogoPosition,
          ribbonEnabled: ribbonEnabled !== undefined ? ribbonEnabled : undefined,
          networkLogoPath: networkLogoPath ?? null,
          networkLogoName: networkLogoName ?? null,
          episodeGroupId: episodeGroupId || undefined,
          posterShape,
          // Graphical layout congelato per-titolo (flat in portrait, preservato
          // in landscape come gli altri tuning per-shape): in landscape il flat
          // resta quello salvato, mai clobberato dal valore del formato.
          posterLayout: keepFlat(posterLayout, prevMapping?.posterLayout),
          // Fresh apply scope congelato per-titolo (stessa regola per-shape
          // del layout sopra): in landscape il flat resta quello salvato.
          posterFreshScope: keepFlat(posterFreshScope, prevMapping?.posterFreshScope),
          landscape: landscapeProfile,
        }),
      })
      setPreviewId(`${selected.media_type}:${selected.id}`)
      // Conferma pillola/goccia arancio (lo stile e l'animazione vengono dal CSS globale).
      if (!overrides.silent) import("sonner").then(({ toast }) => toast.success(t("ui.saveSuccess"), {
        duration: 2500,
      }))
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
  }, [selected, previewPoster, selectedLogo, metaInfo, logoScale, logoOffsetX, logoOffsetY, trendRank, globalBadges, rankingBadges, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle, mdblistAnimeList, loadMappings, customBadge, badgePresetId, badgePresetRev, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle, videoFormats, blurEnabled, blurIntensity, blurFade, blurDarkness, landscapeBlur, landscapeBlurDirty, tintStrength, topShade, gradientHeight, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY, genreBadgeScale, qualityBadgeScale, separateBadgeScale, separateBadgeOffsetX, separateBadgeOffsetY, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops, defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, posters, mappingsMap, accentColor, autoAccentColor, backdropOffsetX, backdropOffsetY, backdropScale, selectedBackdrop, networkLogo, networkLogoPosition, networkLogoFollowTitle, ribbonEnabled, episodeGroupId, posterShape, posterLayout, posterFreshScope]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally complete to save all poster state

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
      import("sonner").then(({ toast }) => toast.success(t("ui.saveSuccess"), {
        duration: 2500,
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
  }, [selected, previewPoster, selectedLogo, logoDisabled, selectedBackdrop, mappingsMap, metaInfo, lang, episodeGroupId, posterShape, loadMappings]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  return { selectPoster, selectLogo, removeLogo, selectBackdrop, removeBackdrop, saveConfig, saveCoverOnly }
}
