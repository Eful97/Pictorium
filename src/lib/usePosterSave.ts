"use client"

import { useCallback } from "react"
import type { SearchResult, TMDBImage, Mapping, PosterShape } from "./types"
import { titleOf } from "./utils"
import { computeTopBadge, resolveSavedBadgeExtra, type BadgeInput } from "./poster-badge"
import type { SashBucket } from "./badge-priority"
import { defaultGradientHeightForPoster, defaultBlurFadeForPoster } from "./gradient-defaults"
import { logoDefaultScale } from "./logo-selection"
import { t } from "./i18n"
import { isManualAccent } from "./accent-color"
import type { EnrichedAnimeItem } from "./validation"
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
  customBadge: string | null
  badgeStyle: string
  rankingBadgeStyle: string
  defaultBadgeStyle: string
  defaultRankingBadgeStyle: string
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  gradientHeight: number
  setGradientHeight: (v: number) => void
  setBlurFade: (v: number) => void
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
  setLogoScale: (v: number) => void
  setLogoOffsetX: (v: number) => void
  setLogoOffsetY: (v: number) => void
  networkLogo: boolean
  lang: string
  /** Ordine sash dai default editor (stesso del render, o il salvataggio congela un badge diverso). */
  defaultSashOrder?: readonly SashBucket[] | null
  episodeGroupId?: string | null
  /** Formato canvas in editing (congelato per-titolo al save). */
  posterShape: PosterShape
}

export interface SaveConfigOverrides {
  excludedPosters?: string[]
  rotationPosters?: string[]
  excludedBackdrops?: string[]
  rotationBackdrops?: string[]
  previewPoster?: TMDBImage
  silent?: boolean
}

export function usePosterSave(deps: PosterSaveDeps) {
  const {
    selected, previewPoster, selectedLogo, setSelectedLogo, setPreviewPoster, setPreviewId,
    posters, metaInfo, imdbTop250, trendRank, mdblistAnimeList, mappingsMap, loadMappings,
    logoScale, logoOffsetX, logoOffsetY,
    selectedBackdrop, setSelectedBackdrop, backdropScale, backdropOffsetX, backdropOffsetY,
    setBackdropScale, setBackdropOffsetX, setBackdropOffsetY,
    globalBadges, rankingBadges, customBadge, badgeStyle, rankingBadgeStyle,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings,
    defaultBadgeStyle, defaultRankingBadgeStyle,
    blurEnabled, blurIntensity, blurFade, blurDarkness, tintStrength, gradientHeight, setGradientHeight, setBlurFade,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, accentColor, autoAccentColor, logoDisabled, setLogoDisabled,
    rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops,
    setLogoScale, setLogoOffsetX, setLogoOffsetY,     networkLogo, lang, episodeGroupId, posterShape,
    defaultSashOrder,
  } = deps

  const selectPoster = useCallback(async (image: TMDBImage) => {
    if (!selected) return
    setPreviewPoster(image)
    setGradientHeight(defaultGradientHeightForPoster(image))
    setBlurFade(defaultBlurFadeForPoster(image))
    setPreviewId(`${selected.media_type}:${selected.id}`)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const selectLogo = useCallback(async (logo: TMDBImage) => {
    setSelectedLogo(logo)
    setLogoDisabled(false)
    setLogoScale(logoDefaultScale(logo) ?? 75)
    setLogoOffsetX(0)
    setLogoOffsetY(0)
    if (!previewPoster && selected) {
      const existing = mappingsMap.get(`${selected.media_type}:${selected.id}`)
      if (existing) {
        setPreviewPoster({ file_path: existing.posterPath, iso_639_1: existing.language, vote_average: 0, width: 0, height: 0 })
      } else if (posters.length > 0) {
        setPreviewPoster(posters[0])
      }
    }
    if (selected) setPreviewId(`${selected.media_type}:${selected.id}`)
  }, [selected, previewPoster, mappingsMap, posters]) // eslint-disable-line react-hooks/exhaustive-deps -- setter refs are stable

  const removeLogo = useCallback(async () => {
    if (!selected) return
    const key = `${selected.media_type}:${selected.id}`
    const existing = mappingsMap.get(key)
    if (!existing) {
      import("sonner").then(({ toast }) => toast(t("ui.noMappingUpdate")))
      return
    }
    const logoPrecedente = selectedLogo
    try {
      await http(`/api/mappings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: selected.id, mediaType: selected.media_type, title: titleOf(selected),
          posterPath: previewPoster?.file_path || selected.poster_path!, logoPath: null,
          originalPosterPath: selected.poster_path, language: previewPoster?.iso_639_1 || null,
          logoScale, logoOffsetX, logoOffsetY,
          genreName: metaInfo.genres[0]?.name || null,
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
    if (!selected || !posterToSave) return

    // Profilo stateless: il mapping per-titolo non può essere salvato (nessuno
    // storage server). La config di stile viaggia comunque nel link `?config=`.
    // Use shared badge computation — identical to server
    const animeRankData = mdblistAnimeList?.find((a) => a.id === selected.id)
    const badgeInput: BadgeInput = {
      mediaType: selected.media_type === "tv" ? "tv" : "movie",
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
    const badgeLabel = (!badgeExtra && animeRankData) ? t("badge.anime") : (!badgeExtra && computed.badge?.type === "rank") ? (computed.badge.rankLabel || t(selected.media_type === "tv" ? "badge.series" : "badge.movie")) : undefined
    const isClean = posterToSave.iso_639_1 === null
    const isNewMapping = !mappingsMap.has(`${selected.media_type}:${selected.id}`)
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
    const effectiveLogoPath = isClean && !logoDisabled ? (selectedLogo?.file_path || null) : null
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
    const landscapeProfile = isLandscapeMode
      ? {
          logoScale, logoOffsetX, logoOffsetY,
          topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
          genreBadgeScale, genreBadgeOffsetX, genreBadgeOffsetY,
          qualityBadgeScale, qualityBadgeOffsetX, qualityBadgeOffsetY,
          networkLogoScale, networkLogoOffsetX, networkLogoOffsetY,
          gradientHeight, blurEnabled, blurIntensity, blurFade, blurDarkness,
        }
      : (prevMapping?.landscape ?? null)
    const backdropToSave = isLandscapeMode
      ? (selectedBackdrop?.file_path || null)
      : (selectedBackdrop?.file_path ?? prevMapping?.backdropPath ?? null)
    const backdropScaleToSave = isLandscapeMode ? backdropScale : (prevMapping?.backdropScale ?? backdropScale)
    const backdropOffsetXToSave = isLandscapeMode ? backdropOffsetX : (prevMapping?.backdropOffsetX ?? backdropOffsetX)
    const backdropOffsetYToSave = isLandscapeMode ? backdropOffsetY : (prevMapping?.backdropOffsetY ?? backdropOffsetY)
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
          posterPath: posterToSave.file_path,
          logoPath: effectiveLogoPath,
          originalPosterPath: selected.poster_path,
          language: posterToSave.iso_639_1,
          logoScale: keepFlat(logoScale, prevMapping?.logoScale),
          logoOffsetX: keepFlat(logoOffsetX, prevMapping?.logoOffsetX),
          logoOffsetY: keepFlat(logoOffsetY, prevMapping?.logoOffsetY),
          backdropPath: backdropToSave,
          backdropScale: backdropScaleToSave,
          backdropOffsetX: backdropOffsetXToSave,
          backdropOffsetY: backdropOffsetYToSave,
          genreName: metaInfo.genres[0]?.name || null,
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
          accentColor: accentColor !== '#ffffff' && isManualAccent(accentColor, autoAccentColor) ? accentColor : undefined,
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
          tvType: metaInfo.type || null,
          tvStatus: metaInfo.status || null,
          releaseDate: metaInfo.release_date || null,
          firstAirDate: metaInfo.first_air_date || null,
          badgeExtra,
          badgeRank,
          badgeLabel,
          animeRank: animeRankData?.rank ?? null,
          customBadge,
          badgeStyle,
          rankingBadgeStyle,
          defaultBadgeStyle,
          defaultRankingBadgeStyle,
          blurEnabled: keepFlat(blurEnabled, prevMapping?.blurEnabled),
          blurIntensity: keepFlat(blurIntensity, prevMapping?.blurIntensity),
          blurFade: keepFlat(blurFade, prevMapping?.blurFade),
          blurDarkness: keepFlat(blurDarkness, prevMapping?.blurDarkness),
          tintStrength: keepFlat(tintStrength, prevMapping?.tintStrength),
          gradientHeight: keepFlat(gradientHeight, prevMapping?.gradientHeight),
          topBadgeScale: keepFlat(topBadgeScale, prevMapping?.topBadgeScale),
          topBadgeOffsetX: keepFlat(topBadgeOffsetX, prevMapping?.topBadgeOffsetX),
          topBadgeOffsetY: keepFlat(topBadgeOffsetY, prevMapping?.topBadgeOffsetY),
          genreBadgeScale: keepFlat(genreBadgeScale, prevMapping?.genreBadgeScale),
          qualityBadgeScale: keepFlat(qualityBadgeScale, prevMapping?.qualityBadgeScale),
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
          autoRotateClean: effectiveRotationPosters.length > 1 ? (defaultAutoRotateClean && isClean && isNewMapping ? true : autoRotateClean) : undefined,
          excludedPosters: nextExcludedPosters.length > 0 ? nextExcludedPosters : undefined,
          cleanBackdrops: effectiveRotationBackdrops.length > 0 ? effectiveRotationBackdrops : undefined,
          cleanBackdropIndex: isLandscapeMode ? 0 : (prevMapping?.cleanBackdropIndex ?? undefined),
          cleanBackdropUpdatedAt: isLandscapeMode ? new Date().toISOString() : (prevMapping?.cleanBackdropUpdatedAt ?? undefined),
          autoRotateBackdrop: effectiveRotationBackdrops.length > 1 ? (isLandscapeMode && defaultAutoRotateBackdrop && isNewMapping ? true : autoRotateBackdrop) : undefined,
          excludedBackdrops: nextExcludedBackdrops.length > 0 ? nextExcludedBackdrops : undefined,
          logoDisabled: logoDisabled || undefined,
          networkLogo: networkLogo !== undefined ? networkLogo : undefined,
          networkLogoPath: networkLogoPath ?? null,
          networkLogoName: networkLogoName ?? null,
          episodeGroupId: episodeGroupId || undefined,
          posterShape,
          landscape: landscapeProfile,
        }),
      })
      setPreviewId(`${selected.media_type}:${selected.id}`)
      if (!overrides.silent) import("sonner").then(({ toast }) => toast(t("ui.saveSuccess")))
      await loadMappings()
    } catch (error) {
      // 401 = istanza con ADMIN_TOKEN/multi-user senza sblocco: il generico
      // "errore" non dice cosa fare — guida allo sblocco admin (che abilita
      // anche i salvataggi, vedi ui.adminTokenDesc).
      if (!overrides.silent) {
        const toastMsg = error instanceof ApiError && error.status === 401
          ? t("ui.clearCacheUnauthorized")
          : t("ui.saveError")
        import("sonner").then(({ toast }) => toast(toastMsg))
      }
      if (overrides.silent) throw error
    }
  }, [selected, previewPoster, selectedLogo, metaInfo, logoScale, logoOffsetX, logoOffsetY, trendRank, globalBadges, rankingBadges, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, mdblistAnimeList, loadMappings, customBadge, badgeStyle, rankingBadgeStyle, blurEnabled, blurIntensity, blurFade, blurDarkness, tintStrength, gradientHeight, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops, defaultBadgeStyle, defaultRankingBadgeStyle, posters, mappingsMap, accentColor, autoAccentColor, backdropOffsetX, backdropOffsetY, backdropScale, selectedBackdrop, networkLogo, episodeGroupId, posterShape]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally complete to save all poster state

  return { selectPoster, selectLogo, removeLogo, selectBackdrop, removeBackdrop, saveConfig }
}
