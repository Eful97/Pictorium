"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from "react"
import type { SearchResult, TMDBImage, Mapping, CustomCatalogConfig, NetworkLogoPosition, PosterShape } from "./types"
import { effectiveMappingForShape } from "./types"
import type { BadgeStyle, RankingBadgeStyle, ExtraBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle } from "./badge-styles"
import { isSeparateRatingsStyle, resolveSeparateBadgeScaleFallback } from "./badge-styles"
import type { RibbonSide } from "./useDefaults"
type LogoAlign = "left" | "center"
import { posterUrl, titleOf, yearOf, STREAMING_PLATFORMS, mergeImageLists, isCustomPosterUrl, type ImageLists } from "./utils"
export { mergeImageLists, type ImageLists } from "./utils"
import { matchTMDBStudios } from "./badge-labels"
import { setLang as setI18nLang, createT } from "./i18n"
import { isSupportedUiLang, getRegionDef, defaultRegionForLang, contentLanguageForUiLang } from "./regions"
import type { EnrichedAnimeItem } from "./validation"
import { http, userFetch } from "./http"
import { currentPathUuid, fetchWithUserAuthRetry, userAuthHeaders, USER_UNLOCK_EVENT } from "./user-token"
import { copyText } from "./clipboard"
import { useRootColors } from "./useRootColors"
import { normalizeGenreName } from "./genre-normalize"
import { buildUrlPattern, buildPreviewUrl } from "./poster-url"
import { selectBestLogo, autoLogoSelection, logoDefaultScale } from "./logo-selection"
import { useTrending } from "./useTrending"
import { useSearch } from "./useSearch"
import { useNavigation } from "./useNavigation"
import { useMappingsStore, type BackupExportOptions, type BackupImportOptions } from "./useMappingsStore"
import { usePosterEditor, PosterEditorProvider, type LandscapeBlurState } from "./contexts/PosterEditorContext"
import { usePosterSave } from "./usePosterSave"
import { usePrefetchTitle } from "./usePrefetchTitle"
import { defaultHeightForPoster, defaultFadeForPoster, adjustGradientForPosterChange } from "./gradient-presets"
import { computeLogoOffsetBounds, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_MAX_WIDTH_PCT, LANDSCAPE_LOGO_MAX_HEIGHT_PCT, LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT, LANDSCAPE_LOGO_TOP_OFFSET } from "./logo-layout"
import { LAND_W, LAND_H } from "./constants"
import { useOutsideDismiss } from "./useOutsideDismiss"
import { type AggregatedRatings } from "./ratings"
import { computeVote } from "./rating-weights"
import { SearchProvider } from "./contexts/SearchContext"
import { SettingsProvider } from "./contexts/SettingsContext"
import { TranslationProvider } from "./contexts/TranslationContext"
import { MetaInfoProvider } from "./contexts/MetaInfoContext"
import { MappingsProvider } from "./contexts/MappingsContext"
import { useCustomCatalogs } from "./useCustomCatalogs"
import { useRankingSources } from "./useRankingSources"
import { useLocalConfigToken } from "./useLocalConfigToken"
import { slotsReferencingCustom, shouldApplyRankRefresh } from "./ranking-source"
import { migrateLegacyStorage } from "./storage-migration"
import { writePersonalDeviceKey } from "./device-keys"

export type ViewType = "search" | "myposters" | "edit" | "cataloghi"

export interface MetaInfo {
  genres: { id: number; name: string }[]
  voteAverage: number
  aggregatedRatings?: AggregatedRatings | null
  type?: string
  status?: string
  release_date?: string
  first_air_date?: string
  last_air_date?: string
  next_episode_to_air?: { air_date: string; episode_number: number; season_number: number } | null
  number_of_seasons?: number
  number_of_episodes?: number
  awards?: string[]
  nominations?: string[]
  studios?: string[]
  director?: string | null
  keywords?: string[]
  imdb_id?: string | null
  /** QID Wikidata (es. "Q23577") da TMDB external_ids: alimenta il param
   * wikidata_id della preview (fast-path REST awards, niente SPARQL). */
  wikidata_id?: string | null
  /** Dettaglio reti/produzioni con logo_path TMDB per fallback network logo (SVG → TMDB). */
  networksDetailed?: { name: string; logo_path: string | null; origin_country?: string }[]
  productionCompaniesDetailed?: { name: string; logo_path: string | null; origin_country?: string }[]
}

export interface PictoriumCtx {
  selected: SearchResult | null
  setSelected: React.Dispatch<React.SetStateAction<SearchResult | null>>
  view: ViewType
  setView: React.Dispatch<React.SetStateAction<ViewType>>
  /** Navigazione centralizzata (push/replace/back). */
  router: { push: (v: ViewType) => void; replace: (v: ViewType) => void; back: () => void }
  posters: TMDBImage[]
  loadingImages: boolean
  previewPoster: TMDBImage | null
  setPreviewPoster: React.Dispatch<React.SetStateAction<TMDBImage | null>>
  selectedLogo: TMDBImage | null
  setSelectedLogo: React.Dispatch<React.SetStateAction<TMDBImage | null>>
  logos: TMDBImage[]
  /** original_language dell'ultimo titolo caricato: tier dell'auto-logo
   *  anche fuori dal flusso di apertura (es. passaggio a landscape). */
  titleOrigLang: string | null
  posterActivePath: string | null
  previewUrl: string
  /** Anteprima Stremio: invece dell'URL editor mostra l'URL esatto servito
   *  a Stremio (stesso builder dei cataloghi, via /meta). Solo lettura. */
  stremioPreview: boolean
  setStremioPreview: React.Dispatch<React.SetStateAction<boolean>>
  /** URL Stremio risolto (null in caricamento o se il meta non risolve). */
  stremioPreviewUrl: string | null
  urlPattern: string
  /** Template secondario con `{imdb_id}` (fallback universale). */
  urlPatternImdb: string
  /** Template auto con `{tmdb_id|imdb_id}` (Nuvio: usa l'id disponibile per la vista). */
  urlPatternAuto: string
  /** Template Nuvio a formato automatico (`shape={shape}`): stessa base dei
   *  tre sopra ma con placeholder shape (Nuvio sceglie poster/landscape per
   *  vista; square ricade sul verticale). */
  urlPatternNuvio: string
  urlPatternNuvioImdb: string
  urlPatternNuvioAuto: string
  /**
   * Modalità dei template AIO/Custom: "follow" (Segui il mio spazio, live=1,
   * nessun visuale congelato) o "fixed" (Impostazioni fisse nel link,
   * comportamento attuale). Riguarda solo gli URL poster, mai il manifest.
   */
  linkMode: "follow" | "fixed"
  setLinkMode: React.Dispatch<React.SetStateAction<"follow" | "fixed">>
  lang: string
  openSections: Record<string, boolean>
  toggleSection: (k: string) => void
  posterScrollRef: React.RefObject<HTMLDivElement | null>
  posterScrollInfo: { top: number; height: number }
  setPosterScrollInfo: React.Dispatch<React.SetStateAction<{ top: number; height: number }>>
  selectPoster: (img: TMDBImage) => Promise<void>
  selectLogo: (logo: TMDBImage) => Promise<void>
  removeLogo: () => Promise<void>
  logoBounds: { minX: number; maxX: number; minY: number; maxY: number }
  selectBackdrop: (img: TMDBImage) => void
  removeBackdrop: () => void
  trendRank: number | null
  mdblistMatch: { key: string; rank: number } | null
  /** Pre-resolved IMDb Top 250 membership for the current metaInfo. */
  imdbTop250: boolean
  metaInfo: MetaInfo
  previewId: string | null
  setPreviewId: React.Dispatch<React.SetStateAction<string | null>>
  saveConfig: () => Promise<boolean | void>
  removeMapping: (m: Mapping) => Promise<void>
  mappingsMap: Map<string, Mapping>
  goHome: () => void
  sourceView: "edit" | "search" | "myposters" | "cataloghi" | null
  navigateToPoster: (item: SearchResult, source?: string) => void
  refreshLists: (refreshCustom?: () => Promise<number>) => Promise<void>
  tmdbKey: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  doSearch: (q?: string, page?: number) => Promise<SearchResult[]>
  loadMore: () => Promise<void>
  loadMoreFiltered: (mediaType: "movie" | "tv", targetNew?: number, maxPages?: number) => Promise<number>
  retryFailed: () => Promise<void>
  failedPage: number | null
  hasSearched: boolean
  titleOf: (r: SearchResult) => string
  yearOf: (r: SearchResult) => string
  posterUrl: (path: string, size?: string) => string
  trending: (SearchResult & { rank: number })[]
  trendingError: boolean
  trendingStatus: import("./useTrending").ListStatus
  mdblistAnimeList: EnrichedAnimeItem[]
  animeStatus: import("./useTrending").ListStatus
  animeSource: "mdblist" | "tmdb" | null
  streamingCharts: Record<string, import("./types").FlixPatrolChart>
  platformErrors: Record<string, boolean>
  loadPlatform: (slug: string, force?: boolean) => Promise<boolean>
  refreshNonce: number
  STREAMING_PLATFORMS: typeof STREAMING_PLATFORMS
  loadMappings: () => Promise<void>
  query: string
  results: SearchResult[]
  searching: boolean
  error: string | null
  setError: (v: string | null) => void
  totalResults: number
  totalPages: number
  searchPage: number
  recentSearches: string[]
  removeRecentSearch: (search: string) => void
  clearRecentSearches: () => void
  mappings: Mapping[]
  settingsRef: React.RefObject<HTMLDivElement | null>
  langRef: React.RefObject<HTMLDivElement | null>
  setLangOpen: React.Dispatch<React.SetStateAction<boolean>>
  langOpen: boolean
  pickLang: (l: string) => void
  settingsOpen: boolean
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  showLangPicker: boolean
  setShowLangPicker: React.Dispatch<React.SetStateAction<boolean>>
  t: (key: string, params?: Record<string, string | number>) => string
  tmdbKeyInput: string
  setTmdbKeyInput: React.Dispatch<React.SetStateAction<string>>
  showKey: boolean
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>
  setTmdbKey: (v: string) => void
  /** True se l'istanza ha una chiave TMDB env (booleano pubblico /api/defaults). */
  serverHasTmdbKey: boolean
  /** Presenza chiavi server-side del namespace (solo booleani, mai valori). */
  serverKeyStatus: { tmdb: boolean; mdblist: boolean; tvdb: boolean } | null
  /** UUID del namespace su path /u/<uuid> (o ?u=), null altrove. */
  currentUserId: string | null
  mdblistApiKey: string
  setMdblistApiKey: (v: string) => void
  tvdbApiKey: string
  setTvdbApiKey: (v: string) => void
  exportData: (opts?: BackupExportOptions) => Promise<void>
  importData: (opts?: BackupImportOptions) => void
  copyUrl: () => Promise<void>
  copied: boolean
  accentColor: string | null
  autoAccentColor: string | null
  setAccentColor: (v: string | null) => void
  topEdgeColor: string | null
  bottomEdgeColor: string | null
  autoSaveExcludedPosters: (nextExcluded: string[], nextRotationPosters?: string[], nextPreviewPoster?: TMDBImage) => Promise<void>
  autoSaveExcludedBackdrops: (nextExcluded: string[], nextRotationBackdrops?: string[], nextBackdrop?: import("@/lib/types").TMDBImage | null) => Promise<void>
  /** Scalda le cache details/images per un titolo (hover risultati). */
  prefetchTitle: (item: SearchResult) => void
  theme: "dark" | "light"
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>
  uiAccent: boolean
  setUiAccent: React.Dispatch<React.SetStateAction<boolean>>
  serviceErrors: Record<string, boolean>
  setServiceErrors: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  hasNetflixRank: boolean
  customCatalogs: CustomCatalogConfig[]
  setCustomCatalogs: (catalogs: CustomCatalogConfig[]) => void
  addCustomCatalog: (catalog: Omit<CustomCatalogConfig, "id">) => void
  removeCustomCatalog: (id: string) => void
  toggleCustomCatalog: (id: string) => void
  /** Bumped on every acknowledged catalog PUT (custom edits retarget rank consumers). */
  catalogsSyncNonce: number
  disabledCatalogIds: string[]
  setDisabledCatalogIds: (ids: string[]) => void
  toggleBuiltinCatalog: (id: string) => void
  homeDisabledCatalogIds: string[]
  setHomeDisabledCatalogIds: (ids: string[]) => void
  toggleCatalogHome: (id: string) => void
  catalogOrder: string[]
  setCatalogOrder: (order: string[]) => void
  moveCatalog: (id: string, direction: "up" | "down") => void
  catalogRenames: Record<string, string>
  setCatalogRenames: (renames: Record<string, string>) => void
  renameCatalog: (id: string, newName: string) => void
  resetCatalogNames: () => void
  resetCatalogOrder: () => void
  /** Raw Top 20 source ids (`""` = explicit JustWatch); resolved via the pure resolver. */
  rankingSourceMovie: string
  rankingSourceSeries: string
  setRankingSource: (slot: "movie" | "series", id: string) => Promise<boolean>
  /** Bumped on every successful ranking save: rank consumers refetch. */
  rankSourceNonce: number
  /** Re-reads trendRank for the current item (after a ranking save). */
  refreshCurrentRank: () => void
  /**
   * Signed config token mirroring the device catalog state, present only
   * where the namespace is not enough (local-only/profileless): preview and
   * rank requests append it as `?config=` so the server resolves the device
   * selection. Null everywhere else (URLs byte-identical to before).
   */
  localConfigToken: string | null
  /** Lifecycle of the token above: suspend/error instead of silent JW. */
  localConfigTokenStatus: "off" | "pending" | "ready" | "error"
}

const Ctx = createContext<PictoriumCtx | null>(null)

// Store scoped al provider per la subscription ottimizzata (usePSelector):
// ogni PictoriumProvider ha il proprio store, così i test restano isolati e i
// selettori ri-renderizzano SOLO quando lo slice selezionato cambia (Object.is).
interface SelectorStore {
  value: PictoriumCtx | null
  listeners: Set<() => void>
}
const SelectorStoreCtx = createContext<SelectorStore | null>(null)

/**
 * Consuma solo lo slice richiesto del contesto Pictorium. Il componente
 * ri-renderizza SOLO quando il valore selezionato cambia (Object.is), non a
 * ogni aggiornamento di qualsiasi slice. Il selettore DEVE restituire un
 * riferimento stabile (primitiva o campo di stato esistente), mai un oggetto
 * nuovo creato inline, altrimenti il confronto fallisce.
 */
export function usePSelector<T>(selector: (v: PictoriumCtx) => T): T {
  const store = useContext(SelectorStoreCtx)
  if (!store) throw new Error("usePSelector must be inside PictoriumProvider")
  const get = (): T | undefined => (store.value ? selector(store.value) : undefined)
  return useSyncExternalStore(
    (cb) => {
      store.listeners.add(cb)
      return () => { store.listeners.delete(cb) }
    },
    get,
    get,
  ) as T
}

export function useP() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useP must be inside PictoriumProvider")
  return ctx
}

export function PictoriumProvider({ value, children }: { value: PictoriumCtx; children: React.ReactNode }) {
  const storeRef = useRef<SelectorStore | null>(null)
  if (!storeRef.current) storeRef.current = { value: null, listeners: new Set() }
  const store = storeRef.current
  // Aggiorna lo store durante il render per coerenza del getSnapshot
  store.value = value
  useEffect(() => {
    store.listeners.forEach((l) => l())
  }, [value, store])
  return (
    <SelectorStoreCtx.Provider value={store}>
      <TranslationProvider value={value}>
        <SettingsProvider value={value}>
          <SearchProvider value={value}>
            <MetaInfoProvider value={value.metaInfo}>
              <MappingsProvider value={value.mappings} mapValue={value.mappingsMap}>
                <Ctx.Provider value={value}>{children}</Ctx.Provider>
              </MappingsProvider>
            </MetaInfoProvider>
          </SearchProvider>
        </SettingsProvider>
      </TranslationProvider>
    </SelectorStoreCtx.Provider>
  )
}

/**
 * PictoriumRoot — racchiude la creazione dello stato e la catena provider.
 * PosterEditorProvider wrappa l'esterno così usa useDefaults() in autonomia.
 * Il PictoriumProvider interno riceve tutto lo stato (inclusi editor fields
 * per backward compat via useP()).
 */
export function PictoriumRoot({ children }: { children: React.ReactNode }) {
  // Migrazione one-time localStorage posterium_* → pictorium_*: l'initializer
  // di useState gira nel render del parent, quindi PRIMA degli useEffect dei
  // figli che leggono lo storage (hydration da useCustomCatalogs, tema, ...).
  useState(() => {
    migrateLegacyStorage()
    return null
  })
  return (
    <PosterEditorProvider>
      <PictoriumRootInner>{children}</PictoriumRootInner>
    </PosterEditorProvider>
  )
}

function PictoriumRootInner({ children }: { children: React.ReactNode }) {
  const value = usePictorium()
  return <PictoriumProvider value={value}>{children}</PictoriumProvider>
}

export function usePictorium(): PictoriumCtx {
  // Helper per localStorage: evita crash in Safari ITP / Brave Shield / Firefox Strict
  const safeGetItem = useCallback((key: string): string | null => {
    try { return localStorage.getItem(key) } catch { return null }
  }, [])
  const safeSetItem = useCallback((key: string, val: string): void => {
    try { localStorage.setItem(key, val) } catch { /* localStorage non disponibile */ }
  }, [])

  const [lang, setLang] = useState("it")
  const t = useMemo(() => createT(lang), [lang])
  const [tmdbKey, setTmdbKeyState] = useState("")
  // True se l'istanza ha una chiave TMDB env (booleano pubblico da
  // /api/defaults): la home funziona anche senza chiave nel browser.
  const [serverHasTmdbKey, setServerHasTmdbKey] = useState(false)
  // Chiave TMDB env d'istanza (booleano pubblico da /api/defaults), separata
  // da quella del namespace: l'effettivo è l'OR dei due (vedi sotto) così la
  // rimozione della chiave profilo riazzera il flag invece di restare latchato.
  const [instanceHasTmdbKey, setInstanceHasTmdbKey] = useState(false)
  // Namespace utente (multi-user): uuid dal path /u/<uuid> (o ?u=). Mai
  // catturato una volta sola: back/forward e navigazioni SPA che riusano
  // l'albero lascerebbero lo stato stantio (listener post-unlock mai
  // riattaccati, template AIO sull'uuid sbagliato) — si risincronizza a ogni
  // unlock e a ogni popstate.
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => currentPathUuid())
  useEffect(() => {
    const syncPathUser = () => {
      const id = currentPathUuid()
      setCurrentUserId((prev) => (prev === id ? prev : id))
    }
    syncPathUser()
    window.addEventListener(USER_UNLOCK_EVENT, syncPathUser)
    window.addEventListener("popstate", syncPathUser)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, syncPathUser)
      window.removeEventListener("popstate", syncPathUser)
    }
  }, [])
  // Presenza chiavi server-side del namespace (solo booleani, mai valori):
  // con token valido, il template AIO omette le chiavi (le risolve il server).
  const [serverKeyStatus, setServerKeyStatus] = useState<{ tmdb: boolean; mdblist: boolean; tvdb: boolean } | null>(null)
  useEffect(() => {
    if (!currentUserId) return
    let cancelled = false
    const load = () => {
      // Secret oppure password (di memoria): senza credenziale niente status.
      const headers = userAuthHeaders(currentUserId)
      if (Object.keys(headers).length === 0) {
        if (!cancelled) setServerKeyStatus(null)
        return
      }
      // Retry anti secret-stantio: un secret marcio in storage oscurerebbe la
      // password fresca e il gate poster (serverHasTmdbKey) resterebbe chiuso
      // fino al refresh — mentre gli altri loader (chiavi, identity) si
      // riprendevano da soli. Stesso idioma di UserKeysSection.
      fetchWithUserAuthRetry(currentUserId, `/api/users/${currentUserId}/keys`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return
          setServerKeyStatus({ tmdb: d.tmdb === true, mdblist: d.mdblist === true, tvdb: d.tvdb === true })
        })
        .catch(() => null)
    }
    load()
    window.addEventListener(USER_UNLOCK_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(USER_UNLOCK_EVENT, load)
    }
  }, [currentUserId])
  // Chiave TMDB di sessione = env d'istanza OPPURE namespace: con una
  // chiave profilo salvata, ricerca/trending/hero partono anche senza chiave
  // nel browser (il server la risolve da `?u=`). Derivato (non latchato) così
  // rimozione chiave / forget dello spazio spengono davvero i gate.
  useEffect(() => {
    setServerHasTmdbKey(instanceHasTmdbKey || serverKeyStatus?.tmdb === true)
  }, [instanceHasTmdbKey, serverKeyStatus])
  const [mdblistApiKey, setMdblistApiKey] = useState("")
  const [tvdbApiKey, setTvdbApiKey] = useState("")
  const [tmdbKeyInput, setTmdbKeyInput] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  // Lettura differita in useEffect per evitare hydration mismatch client/server
  const [uiAccent, setUiAccent] = useState(false)
  useEffect(() => {
    const saved = safeGetItem("pictorium_ui_accent")
    if (saved === "true") setUiAccent(true)
  }, [safeGetItem])
  useEffect(() => { safeSetItem("pictorium_ui_accent", String(uiAccent)) }, [uiAccent, safeSetItem])
  // Sync uiAccent toggle to <html> class
  useEffect(() => {
    document.documentElement.classList.toggle("ui-accent", uiAccent)
  }, [uiAccent])
  const keyInit = useRef(false)
  const langInit = useRef(false)

  const navigation = useNavigation()
  const editorCtx = usePosterEditor()
  const trending = useTrending(tmdbKey, mdblistApiKey, editorCtx.defaultRegion, serverHasTmdbKey)
  const tmdbLang = getRegionDef(editorCtx.defaultRegion).lang
  const search = useSearch(tmdbKey, tmdbLang, serverHasTmdbKey)
  const { mappings, mappingsMap, loadMappings, removeMapping, exportData, importData } = useMappingsStore()
  const {
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
    networkLogo, setNetworkLogo,
    networkLogoPosition, setNetworkLogoPosition,
    preRelease,
    ribbonSide,
    ribbonEnabled, setRibbonEnabled,
    posterShape, setPosterShape,
    logoAlign, setLogoAlign,
    // Defaults
    defaultBadgeStyle,
    defaultRankingBadgeStyle,
    defaultExtraBadgeStyle,
    defaultBadgeFont,
    defaultQualityBadgeStyle,
    defaultVideoFormats,
    defaultGlobalBadges,
    defaultRankingBadges,
    defaultBadgeGenre,
    defaultBadgeYear,
    defaultBadgeRating,
    defaultBadgeQuality,
    defaultCustomRatings,
    defaultRatingSources,
    defaultSeparateRatings,
    defaultSeparateRatingsStyle,
    defaultSashOrder,
    defaultRibbonSide,
    defaultRibbonEnabled,
    defaultPosterShape,
    defaultLogoAlign,
    setRibbonSide,
    defaultBlurEnabled,
    defaultBlurIntensity,
    defaultTintStrength,
    defaultTopShade,
    defaultBlurFade,
    defaultBlurDarkness,
    defaultGradientHeight,
    defaultLogoScale,
    defaultLogoOffsetX,
    defaultLogoOffsetY,
    defaultTopBadgeScale,
    defaultTopBadgeOffsetX,
    defaultTopBadgeOffsetY,
    defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale,
    defaultSeparateBadgeScale,
    defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY,
    defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY,
    defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY,
    defaultAutoRotateClean,
    defaultAutoRotateBackdrop,
    defaultDisableCleanPosters,
    defaultNetworkLogo,
    defaultNetworkLogoPosition,
    defaultPreRelease,
    defaultDateFormat,
    loadDefaultsToState,
    // Blur
    blurEnabled, setBlurEnabled,
    landscapeBlur, resetLandscapeBlur, setLandscapeBlur, landscapeBlurDirty,
    landscape: landscapeDefaults,
    blurIntensity, setBlurIntensity,
    tintStrength, setTintStrength,
    topShade, setTopShade,
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
    // Badge qualità
    qualityBadgeScale, setQualityBadgeScale,
    // Colonna rating separati
    separateBadgeScale, setSeparateBadgeScale,
    separateBadgeOffsetX, setSeparateBadgeOffsetX,
    separateBadgeOffsetY, setSeparateBadgeOffsetY,
    // Logo network
    networkLogoScale, setNetworkLogoScale,
    // Offset badge genere/qualità/network
    genreBadgeOffsetX, setGenreBadgeOffsetX,
    genreBadgeOffsetY, setGenreBadgeOffsetY,
    qualityBadgeOffsetX, setQualityBadgeOffsetX,
    qualityBadgeOffsetY, setQualityBadgeOffsetY,
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
    // Editing UI
    // Rotation
    rotationPosters, setRotationPosters,
    autoRotateClean, setAutoRotateClean,
    excludedPosters, setExcludedPosters,
    rotationBackdrops, setRotationBackdrops,
    autoRotateBackdrop, setAutoRotateBackdrop,
    excludedBackdrops, setExcludedBackdrops,
    // Episode Group
    episodeGroupId, setEpisodeGroupId,
  } = editorCtx

  const [urlPattern, setUrlPattern] = useState("")
  const [urlPatternImdb, setUrlPatternImdb] = useState("")
  const [urlPatternAuto, setUrlPatternAuto] = useState("")
  const [urlPatternNuvio, setUrlPatternNuvio] = useState("")
  const [urlPatternNuvioImdb, setUrlPatternNuvioImdb] = useState("")
  const [urlPatternNuvioAuto, setUrlPatternNuvioAuto] = useState("")
  // Modalità template AIO/Custom: per gli spazi utente default "follow"
  // (Segui il mio spazio), altrove "fixed" (comportamento attuale). Se lo
  // spazio compare dopo (unlock/query) e l'utente non ha scelto, passa a follow.
  const [linkMode, setLinkMode] = useState<"follow" | "fixed">(() => (currentUserId ? "follow" : "fixed"))
  const linkModeTouchedRef = useRef(false)
  useEffect(() => {
    if (currentUserId && !linkModeTouchedRef.current) setLinkMode("follow")
  }, [currentUserId])
  const setLinkModeTracked = useCallback((v: React.SetStateAction<"follow" | "fixed">) => {
    linkModeTouchedRef.current = true
    setLinkMode(v)
  }, [])
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [metaInfo, setMetaInfo] = useState<MetaInfo>({ genres: [], voteAverage: 0 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [trendRank, setTrendRank] = useState<number | null>(null)
  const [mdblistMatch, setMdblistMatch] = useState<{ key: string; rank: number } | null>(null)
  // original_language dell'ultimo titolo caricato (vedi applyLoadedSelection):
  // serve il tier dell'auto-logo anche fuori dal flusso di apertura.
  const [titleOrigLang, setTitleOrigLang] = useState<string | null>(null)
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [previewUrl, setPreviewUrl] = useState("")
  // URL poster esattamente come lo serve Stremio (via /meta, stesso builder
  // dei cataloghi): risolto on-demand quando il toggle è attivo.
  const [stremioPreview, setStremioPreview] = useState(false)
  const [stremioPreviewUrl, setStremioPreviewUrl] = useState<string | null>(null)
  const [imdbTop250, setImdbTop250] = useState(false)
  const [accentColor, setAccentColor] = useState<string | null>(null)
  const [autoAccentColor, setAutoAccentColor] = useState<string | null>(null)
  // Accent adattivo: espone il colore dominante del poster come
  // --color-accent su <html>. Con uiAccent attivo, tutte le regole
  // .ui-accent (glow di pagina, slider, toggle, tab chip, podio)
  // si ritintano col poster in editing. Senza poster: fallback arancione.
  useEffect(() => {
    const root = document.documentElement
    if (uiAccent && accentColor) root.style.setProperty("--color-accent", accentColor)
    else root.style.removeProperty("--color-accent")
  }, [uiAccent, accentColor])
  const [topEdgeColor, setTopEdgeColor] = useState<string | null>(null)
  const [bottomEdgeColor, setBottomEdgeColor] = useState<string | null>(null)
  const [serviceErrors, setServiceErrors] = useState<Record<string, boolean>>({})

  const [loadingImages, setLoadingImages] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const langRef = useRef<HTMLDivElement>(null)
  const posterScrollRef = useRef<HTMLDivElement>(null)
  const [posterScrollInfo, setPosterScrollInfo] = useState({ top: 0, height: 100 })


  // Appearance state (logo, backdrop, editing — owned by PosterEditorProvider via usePosterEditor())
  // Specchio client di hasGenreBadge (server): il badge è visibile se almeno uno dei
  // 3 componenti (genere/anno/voto) è abilitato E disponibile.
  const metaYear = (metaInfo.release_date || metaInfo.first_air_date || "").slice(0, 4)
  const genreAvailable = metaInfo.genres.length > 0
  const ratingAvailable = metaInfo.voteAverage > 0
  const yearAvailable = !!metaYear
  const hasBadges = globalBadges
    && ((genreAvailable && badgeGenre) || (ratingAvailable && badgeRating) || (yearAvailable && badgeYear))
  const hasNetflixRank = !!(trendRank || (navigation.selected && trending.mdblistAnimeList.some((a: EnrichedAnimeItem) => a.id === navigation.selected!.id)))

  // Auto-resolve IMDb Top 250 membership.
  // Guard di race: se metaInfo.imdb_id cambia mentre una fetch è in flight,
  // la risposta stale per l'id precedente NON deve sovrascrivere lo stato
  // corrente. fetchIdRef traccia quale id è quello "attivo"; l'AbortController
  // cancella fisicamente la richiesta precedente.
  const fetchIdRef = useRef<string | null>(null)
  useEffect(() => {
    const imdbId = metaInfo.imdb_id
    if (!imdbId) { fetchIdRef.current = null; setImdbTop250(false); return }
    fetchIdRef.current = imdbId
    const ac = new AbortController()
    fetch(`/api/imdb-top250?imdbId=${encodeURIComponent(imdbId)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (fetchIdRef.current === imdbId) setImdbTop250(!!d.inTop250)
      })
      .catch(() => {
        if (ac.signal.aborted || fetchIdRef.current !== imdbId) return
        setImdbTop250(false)
      })
    return () => { ac.abort(); if (fetchIdRef.current === imdbId) fetchIdRef.current = null }
  }, [metaInfo.imdb_id])

  // Appearance state

  // Abort lifecycle of the current title load: starting a replacement load
  // aborts the previous network work (see loadCurrentItemData), browser
  // back/forward and view changes abort too, and unmount aborts whatever is
  // left. Aborting only stops the network — navigation.fetchIdRef stays the
  // guard that drops late state updates.
  const loadAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const abortOnExit = () => {
      loadAbortRef.current?.abort()
      // The guarded finally of a superseded load no longer clears the spinner:
      // leaving the editor clears it explicitly instead.
      setLoadingImages(false)
    }
    window.addEventListener("popstate", abortOnExit)
    return () => {
      window.removeEventListener("popstate", abortOnExit)
      loadAbortRef.current?.abort()
    }
  }, [])

  // Fresh mirrors for async continuations: closures capture render-time values,
  // but a manual selection made mid-load must not be overwritten by stale reads.
  const previewPosterRef = useRef(navigation.previewPoster)
  const selectedLogoRef = useRef(navigation.selectedLogo)
  useEffect(() => {
    previewPosterRef.current = navigation.previewPoster
    selectedLogoRef.current = navigation.selectedLogo
  }, [navigation.previewPoster, navigation.selectedLogo])

  const logoBounds = useMemo(() => {
    if (!navigation.previewPoster || !navigation.selectedLogo) return { minX: -500, maxX: 500, minY: -500, maxY: 500 }
    // Stessi vincoli del server (poster-service): in landscape il canvas è
    // 16:9 col fondo logo in linea col badge genere (vedi costanti in
    // logo-layout.ts), con l'allineamento corrente.
    const isLandscapeShape = posterShape === "landscape"
    return computeLogoOffsetBounds({
      posterW: isLandscapeShape ? LAND_W : (navigation.previewPoster.width || 1000),
      posterH: isLandscapeShape ? LAND_H : (navigation.previewPoster.height || 1500),
      logoW: navigation.selectedLogo.width || 1,
      logoH: navigation.selectedLogo.height || 1,
      logoScale,
      hasBadges,
      align: isLandscapeShape ? logoAlign : "center",
      // Stessi vincoli del server: margine 12% col badge genere (0.10 storico
      // senza), altrimenti i bound degli slider mentono sul render finale.
      ...(hasBadges ? { bottomMarginPct: 12 } : {}),
      ...(isLandscapeShape
        ? { maxWidthPct: LANDSCAPE_LOGO_MAX_WIDTH_PCT, maxHeightPct: LANDSCAPE_LOGO_MAX_HEIGHT_PCT, bottomMarginPct: LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT, topOffset: LANDSCAPE_LOGO_TOP_OFFSET }
        : { maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT, topOffset: PORTRAIT_LOGO_TOP_OFFSET }),
    })
  }, [navigation.previewPoster, navigation.selectedLogo, logoScale, hasBadges, posterShape, logoAlign])

  // --- Custom Catalogs & Profile Auth Hooks ---
  const {
    customCatalogs,
    setCustomCatalogs,
    addCustomCatalog,
    removeCustomCatalog: removeCustomCatalogBase,
    toggleCustomCatalog,
    catalogsSyncNonce,
    disabledCatalogIds,
    setDisabledCatalogIds,
    toggleBuiltinCatalog,
    homeDisabledCatalogIds,
    setHomeDisabledCatalogIds,
    toggleCatalogHome,
    catalogOrder,
    setCatalogOrder,
    moveCatalog,
    catalogRenames,
    setCatalogRenames,
    renameCatalog,
    resetCatalogNames,
    resetCatalogOrder,
  } = useCustomCatalogs(safeGetItem, safeSetItem)

  // --- Top 20 Ranking Sources (global movie/series charts) ---
  const {
    rankingSourceMovie,
    rankingSourceSeries,
    setRankingSource,
    rankSourceNonce,
  } = useRankingSources(safeGetItem, safeSetItem)

  // Signed device config for namespace-less spaces (null otherwise).
  const { token: localConfigToken, status: localConfigTokenStatus } =
    useLocalConfigToken({ customCatalogs, rankingSourceMovie, rankingSourceSeries })

  // Targeted trendRank refresh for the current item (after a ranking save):
  // same endpoint and params as the item loader, without reloading
  // details/images. Superseded calls resolve stale via the generation guard;
  // a title/user switch mid-flight drops the write via the context guard.
  const rankRefreshRef = useRef(0)
  const rankCtxRef = useRef({ key: "", user: null as string | null })
  rankCtxRef.current = {
    key: navigation.selected ? `${navigation.selected.media_type}:${navigation.selected.id}` : "",
    user: currentUserId,
  }
  const refreshCurrentRank = useCallback(() => {
    const item = navigation.selected
    if (!item || (!tmdbKey && !serverHasTmdbKey)) return
    // Token suspend/error: never resolve through the empty namespace while a
    // device selection is pending or failed (silent JW). The persistence
    // effect refires on status transitions.
    if (localConfigTokenStatus === "pending") return
    if (localConfigTokenStatus === "error") {
      setTrendRank(null)
      return
    }
    const gen = ++rankRefreshRef.current
    const fired = { gen, key: `${item.media_type}:${item.id}`, user: currentUserId }
    const regionLang = getRegionDef(editorCtx.defaultRegion).lang
    const userParam = currentUserId ? `&u=${encodeURIComponent(currentUserId)}` : ""
    const configParam = localConfigToken ? `&config=${encodeURIComponent(localConfigToken)}` : ""
    http<{ rank: number | null }>(
      `/api/trending/rank?type=${item.media_type}&id=${item.id}&api_key=${encodeURIComponent(tmdbKey)}&region=${encodeURIComponent(editorCtx.defaultRegion)}&lang=${encodeURIComponent(regionLang)}${userParam}${configParam}`,
      { timeout: 15000, cache: "no-store" },
    ).then(
      (d) => {
        if (!shouldApplyRankRefresh(fired, { gen: rankRefreshRef.current, ...rankCtxRef.current })) return
        setTrendRank(d?.rank ?? null)
      },
      () => {
        if (!shouldApplyRankRefresh(fired, { gen: rankRefreshRef.current, ...rankCtxRef.current })) return
        setTrendRank(null)
      },
    )
  }, [navigation.selected, tmdbKey, serverHasTmdbKey, editorCtx.defaultRegion, currentUserId, localConfigToken, localConfigTokenStatus])

  // Rank follows catalog persistence: any acknowledged ranking or custom
  // save refetches trendRank for the open title (same title, same user).
  // The callback identity is intentionally out of deps (ref-indirection):
  // it renews on every title/key/region switch while the loader already
  // fetches rank there — depending on it would double-fetch on navigation.
  const refreshRankRef = useRef(refreshCurrentRank)
  refreshRankRef.current = refreshCurrentRank
  useEffect(() => {
    refreshRankRef.current()
  }, [catalogsSyncNonce, rankSourceNonce, localConfigTokenStatus])

  // Deleting a custom can never drive Top 20 again: clear the raw reference
  // in slots pointing at it, so a same-id reimport can not resurrect a stale
  // selection. Disabling alone keeps the raw value (re-enable restores it).
  const removeCustomCatalog = useCallback(async (id: string) => {
    removeCustomCatalogBase(id)
    const jobs = slotsReferencingCustom(rankingSourceMovie, rankingSourceSeries, id).map((slot) =>
      setRankingSource(slot, ""),
    )
    await Promise.all(jobs)
  }, [removeCustomCatalogBase, rankingSourceMovie, rankingSourceSeries, setRankingSource])

  const setTmdbKey = useCallback((val: string) => {
    setTmdbKeyState(val)
    setTmdbKeyInput(val)
    // Explicit user edit: stamp personal provenance for future export. Empty clears.
    try { writePersonalDeviceKey(localStorage, "tmdb", val) } catch { /* localStorage unavailable */ }
  }, [])

  const setMdblistApiKeyFn = useCallback((val: string) => {
    setMdblistApiKey(val)
    try { writePersonalDeviceKey(localStorage, "mdblist", val) } catch { /* localStorage unavailable */ }
  }, [])

  const setTvdbApiKeyFn = useCallback((val: string) => {
    setTvdbApiKey(val)
    try { writePersonalDeviceKey(localStorage, "tvdb", val) } catch { /* localStorage unavailable */ }
  }, [])

  useEffect(() => {
    if (keyInit.current) return
    keyInit.current = true
    const savedTmdb = safeGetItem("tmdb_key") || ""
    setTmdbKeyState(savedTmdb)
    setTmdbKeyInput(savedTmdb)
    const savedMdblist = safeGetItem("mdblist_key") || ""
    setMdblistApiKey(savedMdblist)
    const savedTvdb = safeGetItem("tvdb_key") || ""
    setTvdbApiKey(savedTvdb)
    const savedTheme = safeGetItem("pictorium_theme")
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme)

    // Instance keys: memory only, NEVER localStorage. Persisting here would
    // label an operator key as a device key and a future export would leak it
    // (fail-closed provenance, see device-keys.ts). In-memory state is enough:
    // the server still resolves via its instance fallback.
    // userFetch: su path /u/<uuid> legge i defaults del namespace (token da storage).
    userFetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hasInstanceKeys?.tmdbKey) setInstanceHasTmdbKey(true)
        if (!data?.serverKeys) return
        const { tmdbKey, mdblistApiKey: mdblistKey, tvdbApiKey: tvdbKey } = data.serverKeys
        if (!savedTmdb && tmdbKey) {
          setTmdbKeyState(tmdbKey)
          setTmdbKeyInput(tmdbKey)
        }
        if (!savedMdblist && mdblistKey) {
          setMdblistApiKey(mdblistKey)
        }
        if (!savedTvdb && tvdbKey) {
          setTvdbApiKey(tvdbKey)
        }
      })
      .catch(() => {
        /* ignore network errors on init */
      })
  }, [safeGetItem])

  useEffect(() => {
    safeSetItem("pictorium_theme", theme)
  }, [theme, safeSetItem])

  useEffect(() => {
    if (langInit.current) return
    langInit.current = true
    const saved = safeGetItem("preferred_lang")
    // Solo le lingue UI supportate (SUPPORTED_UI_LANGS, include lingue senza
    // regione chart come `vi`); un valore legacy (zh/ru del vecchio picker)
    // rimostra la scelta.
    if (saved && isSupportedUiLang(saved)) {
      setLang(saved.toLowerCase())
      setI18nLang(saved.toLowerCase())
    } else {
      setShowLangPicker(true)
    }
  }, [safeGetItem])

  const pickLang = (l: string) => {
    if (!isSupportedUiLang(l)) return
    const code = l.toLowerCase()
    setLang(code)
    setI18nLang(code)
    safeSetItem("preferred_lang", code)
    const matchingRegion = defaultRegionForLang(code, editorCtx.defaultRegion)
    if (matchingRegion) {
      editorCtx.setDefaultRegion(matchingRegion)
      editorCtx.setRegion(matchingRegion)
    }
  }

  // --- Settings panels ---
  const dismissSettings = useCallback(() => setSettingsOpen(false), [])
  const ignoreMobileSettingsDismiss = useCallback(() => window.innerWidth < 768, [])
  const dismissLang = useCallback(() => setLangOpen(false), [])

  useOutsideDismiss({
    active: settingsOpen,
    ref: settingsRef,
    onDismiss: dismissSettings,
    eventName: "mousedown",
    shouldIgnore: ignoreMobileSettingsDismiss,
  })

  useOutsideDismiss({
    active: langOpen,
    ref: langRef,
    onDismiss: dismissLang,
  })

  // --- URL Pattern (TMDB primario + IMDb fallback, stessi parametri) ---
  // Senza titolo aperto (previewId null: home / Impostazioni) il template
  // copiabile in InstallModal deve seguire i default live, non l'ultimo stato
  // per-titolo (stale). Con titolo aperto resta lo stato corrente (tweak
  // per-titolo inclusi).
  useEffect(() => {
    const noPreview = !navigation.previewId
    // Template WYSIWYG: a titolo aperto la sfumatura segue il profilo del
    // formato in editing (landscapeBlur in orizzontale), come la preview.
    const tmplLandscape = !noPreview && posterShape === "landscape"
    const base = {
      globalBadges: noPreview ? defaultGlobalBadges : globalBadges,
      rankingBadges: noPreview ? defaultRankingBadges : rankingBadges,
      badgeStyle: noPreview ? defaultBadgeStyle : badgeStyle,
      rankingBadgeStyle: noPreview ? defaultRankingBadgeStyle : rankingBadgeStyle,
      extraBadgeStyle: noPreview ? defaultExtraBadgeStyle : extraBadgeStyle,
      badgeFont: noPreview ? defaultBadgeFont : badgeFont,
      qualityBadgeStyle: noPreview ? defaultQualityBadgeStyle : qualityBadgeStyle,
      videoFormats: noPreview ? defaultVideoFormats : (videoFormats ?? defaultVideoFormats),
      badgeGenre: noPreview ? defaultBadgeGenre : badgeGenre,
      badgeYear: noPreview ? defaultBadgeYear : badgeYear,
      badgeRating: noPreview ? defaultBadgeRating : badgeRating,
      badgeQuality: noPreview ? defaultBadgeQuality : badgeQuality,
      customRatings: noPreview ? defaultCustomRatings : customRatings,
      ratingSources: noPreview ? defaultRatingSources : ratingSources,
      separateRatings: noPreview ? defaultSeparateRatings : separateRatings,
      separateRatingsStyle: noPreview ? defaultSeparateRatingsStyle : separateRatingsStyle,
      customBadge,
      gradientHeight: noPreview ? defaultGradientHeight : tmplLandscape ? landscapeBlur.gradientHeight : gradientHeight,
      blurIntensity: noPreview ? defaultBlurIntensity : tmplLandscape ? landscapeBlur.blurIntensity : blurIntensity,
      blurFade: noPreview ? defaultBlurFade : tmplLandscape ? landscapeBlur.blurFade : blurFade,
      blurDarkness: noPreview ? defaultBlurDarkness : tmplLandscape ? landscapeBlur.blurDarkness : blurDarkness,
      blurEnabled: noPreview ? defaultBlurEnabled : tmplLandscape ? landscapeBlur.blurEnabled : blurEnabled,
      tintStrength: noPreview ? defaultTintStrength : tmplLandscape ? landscapeBlur.tintStrength : tintStrength,
      topShade: noPreview ? defaultTopShade : tmplLandscape ? landscapeBlur.topShade : topShade,
      networkLogo: noPreview ? defaultNetworkLogo : networkLogo,
      networkLogoPosition: noPreview ? defaultNetworkLogoPosition : networkLogoPosition,
      preRelease: noPreview ? defaultPreRelease : preRelease,
      ribbonSide: noPreview ? defaultRibbonSide : ribbonSide,
      ribbonEnabled: noPreview ? defaultRibbonEnabled : ribbonEnabled,
      posterShape: noPreview ? defaultPosterShape : posterShape,
      logoAlign: noPreview ? (defaultLogoAlign ?? undefined) : logoAlign,
      topBadgeScale: noPreview ? defaultTopBadgeScale : topBadgeScale,
      topBadgeOffsetX: noPreview ? defaultTopBadgeOffsetX : topBadgeOffsetX,
      topBadgeOffsetY: noPreview ? defaultTopBadgeOffsetY : topBadgeOffsetY,
      genreBadgeScale: noPreview ? defaultGenreBadgeScale : genreBadgeScale,
      qualityBadgeScale: noPreview ? defaultQualityBadgeScale : qualityBadgeScale,
      separateBadgeScale: noPreview ? defaultSeparateBadgeScale : separateBadgeScale,
      separateBadgeOffsetX: noPreview ? defaultSeparateBadgeOffsetX : separateBadgeOffsetX,
      separateBadgeOffsetY: noPreview ? defaultSeparateBadgeOffsetY : separateBadgeOffsetY,
      networkLogoScale: noPreview ? defaultNetworkLogoScale : networkLogoScale,
      genreBadgeOffsetX: noPreview ? defaultGenreBadgeOffsetX : genreBadgeOffsetX,
      genreBadgeOffsetY: noPreview ? defaultGenreBadgeOffsetY : genreBadgeOffsetY,
      qualityBadgeOffsetX: noPreview ? defaultQualityBadgeOffsetX : qualityBadgeOffsetX,
      qualityBadgeOffsetY: noPreview ? defaultQualityBadgeOffsetY : qualityBadgeOffsetY,
      networkLogoOffsetX: noPreview ? defaultNetworkLogoOffsetX : networkLogoOffsetX,
      networkLogoOffsetY: noPreview ? defaultNetworkLogoOffsetY : networkLogoOffsetY,
      tmdbKey, lang, mdblistApiKey,
      dateFormat: defaultDateFormat,
      // AIO multi-user: `u=` nel template + niente chiavi in chiaro quando il
      // namespace le ha server-side (il server risolve da namespace).
      userId: currentUserId,
      // Spazi senza namespace (local-only): il token firmato porta cataloghi
      // e selezione Top 20 del device; assente altrove (template invariati).
      configToken: localConfigToken ?? undefined,
      omitApiKey: serverKeyStatus?.tmdb === true,
      omitMdblistKey: serverKeyStatus?.mdblist === true,
      // Segui-spazio: omette i visuali (il server li risolve dallo spazio).
      followSpace: linkMode === "follow",
    }
    setUrlPattern(buildUrlPattern({ ...base, idPlaceholder: "{tmdb_id}" }))
    setUrlPatternImdb(buildUrlPattern({ ...base, idPlaceholder: "{imdb_id}" }))
    setUrlPatternAuto(buildUrlPattern({ ...base, idPlaceholder: "{tmdb_id|imdb_id}" }))
    setUrlPatternNuvio(buildUrlPattern({ ...base, idPlaceholder: "{tmdb_id}", shapePlaceholder: "{shape}" }))
    setUrlPatternNuvioImdb(buildUrlPattern({ ...base, idPlaceholder: "{imdb_id}", shapePlaceholder: "{shape}" }))
    setUrlPatternNuvioAuto(buildUrlPattern({ ...base, idPlaceholder: "{tmdb_id|imdb_id}", shapePlaceholder: "{shape}" }))
    }, [globalBadges, rankingBadges, badgeGenre, badgeYear, badgeRating, badgeQuality, qualityBadgeStyle, customRatings, ratingSources, separateRatings, separateRatingsStyle, networkLogo, networkLogoPosition, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, landscapeBlur, tintStrength, topShade, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, separateBadgeScale, separateBadgeOffsetX, separateBadgeOffsetY, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, tmdbKey, lang, mdblistApiKey, currentUserId, localConfigToken, serverKeyStatus, linkMode, navigation.previewId, defaultGlobalBadges, defaultRankingBadges, defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, defaultBadgeFont, defaultQualityBadgeStyle, defaultBadgeGenre, defaultBadgeYear, defaultBadgeRating, defaultBadgeQuality, defaultCustomRatings, defaultRatingSources, defaultSeparateRatings, defaultSeparateRatingsStyle, defaultGradientHeight, defaultBlurIntensity, defaultBlurFade, defaultBlurDarkness, defaultBlurEnabled, defaultTintStrength, defaultTopShade, defaultNetworkLogo, defaultNetworkLogoPosition, defaultPreRelease, defaultDateFormat, defaultRibbonSide, defaultRibbonEnabled, defaultPosterShape, defaultLogoAlign, defaultTopBadgeScale, defaultTopBadgeOffsetX, defaultTopBadgeOffsetY, defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale, defaultSeparateBadgeScale, defaultSeparateBadgeOffsetX, defaultSeparateBadgeOffsetY, defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY, defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY]) // eslint-disable-line react-hooks/exhaustive-deps -- customBadge intentionally excluded to avoid loop

  // --- Default live sul titolo corrente ---
  // Una modifica ai default (barra Impostazioni) si riflette subito sulla
  // preview del titolo aperto SOLO se non ha mapping salvato (mai clobberare
  // lavoro salvato). Si propaga solo il default effettivamente cambiato
  // (compare via ref), così i tweak per-titolo sugli altri campi sopravvivono.
  // Senza deps array (gira a ogni render, agisce solo sui delta): niente
  // stale closure, niente loop (dopo il set il compare torna uguale).
  const prevDefaultsRef = useRef<string | null>(null)
  useEffect(() => {
    const snap = JSON.stringify({
      badgeStyle: defaultBadgeStyle, rankingBadgeStyle: defaultRankingBadgeStyle, extraBadgeStyle: defaultExtraBadgeStyle, badgeFont: defaultBadgeFont, qualityBadgeStyle: defaultQualityBadgeStyle, videoFormats: defaultVideoFormats, globalBadges: defaultGlobalBadges,
      rankingBadges: defaultRankingBadges, badgeGenre: defaultBadgeGenre, badgeYear: defaultBadgeYear,
      badgeRating: defaultBadgeRating, badgeQuality: defaultBadgeQuality, customRatings: defaultCustomRatings,
      ratingSources: defaultRatingSources, separateRatings: defaultSeparateRatings,
      separateRatingsStyle: defaultSeparateRatingsStyle,
      networkLogo: defaultNetworkLogo, networkLogoPosition: defaultNetworkLogoPosition, ribbonSide: defaultRibbonSide, ribbonEnabled: defaultRibbonEnabled, posterShape: defaultPosterShape,
      logoAlign: defaultLogoAlign, gradientHeight: defaultGradientHeight, blurIntensity: defaultBlurIntensity,
      tintStrength: defaultTintStrength, topShade: defaultTopShade, blurFade: defaultBlurFade, blurDarkness: defaultBlurDarkness,
      blurEnabled: defaultBlurEnabled, topBadgeScale: defaultTopBadgeScale, topBadgeOffsetX: defaultTopBadgeOffsetX,
      topBadgeOffsetY: defaultTopBadgeOffsetY, genreBadgeScale: defaultGenreBadgeScale,
      qualityBadgeScale: defaultQualityBadgeScale, networkLogoScale: defaultNetworkLogoScale,
      separateBadgeScale: defaultSeparateBadgeScale,
      separateBadgeOffsetX: defaultSeparateBadgeOffsetX, separateBadgeOffsetY: defaultSeparateBadgeOffsetY,
      genreBadgeOffsetX: defaultGenreBadgeOffsetX, genreBadgeOffsetY: defaultGenreBadgeOffsetY,
      qualityBadgeOffsetX: defaultQualityBadgeOffsetX, qualityBadgeOffsetY: defaultQualityBadgeOffsetY,
      networkLogoOffsetX: defaultNetworkLogoOffsetX, networkLogoOffsetY: defaultNetworkLogoOffsetY,
      // Default logo globali (flat + override Orizzontale): propagazione live sotto.
      logoScaleDefault: defaultLogoScale, logoOffsetXDefault: defaultLogoOffsetX, logoOffsetYDefault: defaultLogoOffsetY,
      // Profilo Orizzontale: senza, cambiare le Impostazioni · Orizzontale a
      // poster aperto non muove mai la preview landscape (resta standard).
      landscape: landscapeDefaults ?? {},
    })
    const prevRaw = prevDefaultsRef.current
    prevDefaultsRef.current = snap
    if (prevRaw === null || prevRaw === snap) return
    const prev = JSON.parse(prevRaw) as Record<string, unknown>
    const cur = JSON.parse(snap) as Record<string, unknown>
    const pid = navigation.previewId
    if (!pid || mappingsMap.has(pid)) return
    const changed = (k: string) => JSON.stringify(prev[k]) !== JSON.stringify(cur[k])
    if (changed("badgeStyle")) setBadgeStyle(cur.badgeStyle as BadgeStyle)
    if (changed("rankingBadgeStyle")) setRankingBadgeStyle(cur.rankingBadgeStyle as RankingBadgeStyle)
    if (changed("extraBadgeStyle")) setExtraBadgeStyle(cur.extraBadgeStyle as ExtraBadgeStyle | null)
    if (changed("badgeFont")) setBadgeFont(cur.badgeFont as BadgeFont)
    if (changed("qualityBadgeStyle")) setQualityBadgeStyle(cur.qualityBadgeStyle as QualityBadgeStyle)
    if (changed("videoFormats")) setVideoFormats(null)
    if (changed("globalBadges")) setGlobalBadges(cur.globalBadges as boolean)
    if (changed("rankingBadges")) setRankingBadges(cur.rankingBadges as boolean)
    if (changed("badgeGenre")) setBadgeGenre(cur.badgeGenre as boolean)
    if (changed("badgeYear")) setBadgeYear(cur.badgeYear as boolean)
    if (changed("badgeRating")) setBadgeRating(cur.badgeRating as boolean)
    if (changed("badgeQuality")) setBadgeQuality(cur.badgeQuality as boolean)
    if (changed("customRatings")) setCustomRatings(cur.customRatings as boolean)
    if (changed("ratingSources")) setRatingSources(cur.ratingSources as string[])
    if (changed("separateRatings")) setSeparateRatings(cur.separateRatings as boolean)
    if (changed("separateRatingsStyle")) setSeparateRatingsStyle(cur.separateRatingsStyle as SeparateRatingsStyle)
    if (changed("networkLogo")) setNetworkLogo(cur.networkLogo as boolean)
    if (changed("networkLogoPosition")) setNetworkLogoPosition(cur.networkLogoPosition as NetworkLogoPosition)
    if (changed("ribbonSide")) setRibbonSide(cur.ribbonSide as RibbonSide)
    if (changed("ribbonEnabled")) setRibbonEnabled(cur.ribbonEnabled as boolean)
    if (changed("posterShape") || changed("logoAlign")) {
      if (changed("posterShape")) setPosterShape(cur.posterShape as PosterShape)
      setLogoAlign((cur.posterShape as string) === "landscape" ? ((cur.logoAlign as string) ?? "left") as LogoAlign : "center")
    }
    if (changed("gradientHeight")) setGradientHeight(cur.gradientHeight as number)
    if (changed("blurIntensity")) setBlurIntensity(cur.blurIntensity as number)
    if (changed("tintStrength")) setTintStrength(cur.tintStrength as number)
    if (changed("topShade")) setTopShade(cur.topShade as number)
    if (changed("blurFade")) setBlurFade(cur.blurFade as number)
    if (changed("blurDarkness")) setBlurDarkness(cur.blurDarkness as number)
    if (changed("blurEnabled")) setBlurEnabled(cur.blurEnabled as boolean)
    if (changed("topBadgeScale")) setTopBadgeScale(cur.topBadgeScale as number)
    if (changed("topBadgeOffsetX")) setTopBadgeOffsetX(cur.topBadgeOffsetX as number)
    if (changed("topBadgeOffsetY")) setTopBadgeOffsetY(cur.topBadgeOffsetY as number)
    if (changed("genreBadgeScale")) setGenreBadgeScale(cur.genreBadgeScale as number)
    if (changed("qualityBadgeScale")) setQualityBadgeScale(cur.qualityBadgeScale as number)
    if (changed("separateBadgeScale")) setSeparateBadgeScale(cur.separateBadgeScale as number)
    if (changed("separateBadgeOffsetX")) setSeparateBadgeOffsetX(cur.separateBadgeOffsetX as number)
    if (changed("separateBadgeOffsetY")) setSeparateBadgeOffsetY(cur.separateBadgeOffsetY as number)
    if (changed("networkLogoScale")) setNetworkLogoScale(cur.networkLogoScale as number)
    if (changed("genreBadgeOffsetX")) setGenreBadgeOffsetX(cur.genreBadgeOffsetX as number)
    if (changed("genreBadgeOffsetY")) setGenreBadgeOffsetY(cur.genreBadgeOffsetY as number)
    if (changed("qualityBadgeOffsetX")) setQualityBadgeOffsetX(cur.qualityBadgeOffsetX as number)
    if (changed("qualityBadgeOffsetY")) setQualityBadgeOffsetY(cur.qualityBadgeOffsetY as number)
    if (changed("networkLogoOffsetX")) setNetworkLogoOffsetX(cur.networkLogoOffsetX as number)
    if (changed("networkLogoOffsetY")) setNetworkLogoOffsetY(cur.networkLogoOffsetY as number)
    // Profilo Orizzontale: come i flat, si propaga al poster aperto solo senza
    // mapping salvato — per singola chiave (le altre sopravvivono, come i flat).
    // Chiavi landscape assenti = segui i flat (coerente con l'init
    // all'apertura: mapping.landscape > globali Orizzontale > flat).
    // resetLandscapeBlur (non setLandscapeBlur): la propagazione dai default
    // NON è un edit esplicito, quindi non alza il dirty — altrimenti un save
    // portrait congelerebbe il profilo dai default invece di preservarlo.
    if (changed("landscape")) {
      const prevLand = (prev.landscape ?? {}) as Record<string, unknown>
      const curLand = (cur.landscape ?? {}) as Record<string, unknown>
      const landKeyChanged = (k: string) => JSON.stringify(prevLand[k]) !== JSON.stringify(curLand[k])
      const eff = (k: string, fb: unknown) => (curLand[k] !== undefined ? curLand[k] : fb)
      const patch: Partial<LandscapeBlurState> = {}
      if (landKeyChanged("gradientHeight")) patch.gradientHeight = eff("gradientHeight", gradientHeight) as number
      if (landKeyChanged("blurEnabled")) patch.blurEnabled = eff("blurEnabled", blurEnabled) as boolean
      if (landKeyChanged("blurIntensity")) patch.blurIntensity = eff("blurIntensity", blurIntensity) as number
      if (landKeyChanged("blurFade")) patch.blurFade = eff("blurFade", blurFade) as number
      if (landKeyChanged("blurDarkness")) patch.blurDarkness = eff("blurDarkness", blurDarkness) as number
      if (landKeyChanged("tintStrength")) patch.tintStrength = eff("tintStrength", tintStrength) as number
      if (landKeyChanged("topShade")) patch.topShade = eff("topShade", topShade) as number
      if (Object.keys(patch).length > 0) resetLandscapeBlur({ ...landscapeBlur, ...patch })
      // Scale/offset badge in landscape: gli slider condividono lo stato flat,
      // che in landscape mostra il profilo Orizzontale — i default globali
      // Orizzontale si propagano qui (solo in landscape: in portrait i flat
      // mostrano il profilo Verticale e non si toccano). Chiavi assenti =
      // segui i default flat (come il server).
      if (posterShape === "landscape") {
        if (landKeyChanged("topBadgeScale")) setTopBadgeScale(eff("topBadgeScale", defaultTopBadgeScale) as number)
        if (landKeyChanged("topBadgeOffsetX")) setTopBadgeOffsetX(eff("topBadgeOffsetX", defaultTopBadgeOffsetX) as number)
        if (landKeyChanged("topBadgeOffsetY")) setTopBadgeOffsetY(eff("topBadgeOffsetY", defaultTopBadgeOffsetY) as number)
        if (landKeyChanged("genreBadgeScale")) setGenreBadgeScale(eff("genreBadgeScale", defaultGenreBadgeScale) as number)
        if (landKeyChanged("genreBadgeOffsetX")) setGenreBadgeOffsetX(eff("genreBadgeOffsetX", defaultGenreBadgeOffsetX) as number)
        if (landKeyChanged("genreBadgeOffsetY")) setGenreBadgeOffsetY(eff("genreBadgeOffsetY", defaultGenreBadgeOffsetY) as number)
        if (landKeyChanged("qualityBadgeScale")) setQualityBadgeScale(eff("qualityBadgeScale", defaultQualityBadgeScale) as number)
        if (landKeyChanged("separateBadgeScale")) setSeparateBadgeScale(eff("separateBadgeScale", defaultSeparateBadgeScale) as number)
        if (landKeyChanged("separateBadgeOffsetX")) setSeparateBadgeOffsetX(eff("separateBadgeOffsetX", defaultSeparateBadgeOffsetX) as number)
        if (landKeyChanged("separateBadgeOffsetY")) setSeparateBadgeOffsetY(eff("separateBadgeOffsetY", defaultSeparateBadgeOffsetY) as number)
        if (landKeyChanged("qualityBadgeOffsetX")) setQualityBadgeOffsetX(eff("qualityBadgeOffsetX", defaultQualityBadgeOffsetX) as number)
        if (landKeyChanged("qualityBadgeOffsetY")) setQualityBadgeOffsetY(eff("qualityBadgeOffsetY", defaultQualityBadgeOffsetY) as number)
        if (landKeyChanged("networkLogoScale")) setNetworkLogoScale(eff("networkLogoScale", defaultNetworkLogoScale) as number)
        if (landKeyChanged("networkLogoOffsetX")) setNetworkLogoOffsetX(eff("networkLogoOffsetX", defaultNetworkLogoOffsetX) as number)
        if (landKeyChanged("networkLogoOffsetY")) setNetworkLogoOffsetY(eff("networkLogoOffsetY", defaultNetworkLogoOffsetY) as number)
      }
    }
    // Default logo globali: come gli altri default, si propagano al poster
    // aperto senza mapping (formato corrente: override Orizzontale in
    // landscape, flat altrove). Solo valori espliciti: null = auto-fit/0,
    // niente da propagare (la scala resta quella fittata sul logo).
    {
      const openIsLand = posterShape === "landscape"
      const prevLand = (prev.landscape ?? {}) as Record<string, unknown>
      const curLand = (cur.landscape ?? {}) as Record<string, unknown>
      const effLogoScale = (land: Record<string, unknown>, flat: unknown): number | null =>
        (openIsLand ? ((land.logoScale as number | null | undefined) ?? (flat as number | null)) : (flat as number | null)) ?? null
      const prevLogoScale = effLogoScale(prevLand, prev.logoScaleDefault)
      const curLogoScale = effLogoScale(curLand, cur.logoScaleDefault)
      if (JSON.stringify(prevLogoScale) !== JSON.stringify(curLogoScale) && typeof curLogoScale === "number") {
        setLogoScale(curLogoScale)
      }
      const effLogoOff = (land: Record<string, unknown>, flat: unknown, axis: "logoOffsetX" | "logoOffsetY"): number =>
        (openIsLand ? ((land[axis] as number | null | undefined) ?? (flat as number | null)) : (flat as number | null)) ?? 0
      for (const axis of ["logoOffsetX", "logoOffsetY"] as const) {
        const prevOff = effLogoOff(prevLand, (prev as Record<string, unknown>)[axis === "logoOffsetX" ? "logoOffsetXDefault" : "logoOffsetYDefault"], axis)
        const curOff = effLogoOff(curLand, (cur as Record<string, unknown>)[axis === "logoOffsetX" ? "logoOffsetXDefault" : "logoOffsetYDefault"], axis)
        if (prevOff !== curOff) {
          if (axis === "logoOffsetX") setLogoOffsetX(curOff)
          else setLogoOffsetY(curOff)
        }
      }
    }
  })

  // --- Preview URL ---
  // Modalità Stremio: risolve l'URL esatto servito a Stremio per il titolo
  // (meta → stesso builder dei cataloghi: mapping/auto, default, mv). Chiave
  // browser in query (come le altre preview autenticate) + namespace `u`:
  // se il server non risolve i metadati, si resta sull'editor senza rumore.
  useEffect(() => {
    if (!stremioPreview || !navigation.selected) { setStremioPreviewUrl(null); return }
    if (localConfigTokenStatus === "pending" || localConfigTokenStatus === "error") { setStremioPreviewUrl(null); return }
    const sel = navigation.selected
    const stype = sel.media_type === "movie" ? "movie" : "series"
    const params = new URLSearchParams()
    if (currentUserId) params.set("u", currentUserId)
    if (tmdbKey) params.set("api_key", tmdbKey)
    params.set("lang", lang)
    params.set("region", editorCtx.defaultRegion)
    if (localConfigToken) params.set("config", localConfigToken)
    const qs = params.toString() ? `?${params.toString()}` : ""
    let live = true
    // no-store: /meta risponde `max-age=300` per Stremio, ma qui serve
    // l'URL fresco post-save (il `mv` cambia a ogni salvataggio).
    http<{ meta?: { poster?: string | null } }>(`/meta/${stype}/tmdb:${sel.id}${qs}`, { timeout: 15000, cache: "no-store" })
      .then((d) => { if (live) setStremioPreviewUrl(d?.meta?.poster || null) })
      // Fallimento = modalità non attiva (niente stato bugiardo): si torna
      // all'editor e il modale, se aperto, si chiude da solo.
      .catch(() => { if (live) { setStremioPreviewUrl(null); setStremioPreview(false) } })
    return () => { live = false }
    // mappingsMap: dopo un save il mapping (e il suo `mv`) cambia — l'URL va
    // ririsolta o il modale mostra l'artefatto pre-save (stale).
  }, [stremioPreview, navigation.selected, currentUserId, tmdbKey, mappingsMap, lang, editorCtx.defaultRegion, localConfigToken, localConfigTokenStatus])

  const buildPreviewUrlCb = useCallback(() => {
    // Token suspend: while the device config is minting (or failed), no
    // preview is (re)built — the server would resolve the empty namespace
    // instead of the device selection. The effect below refires on ready.
    if (localConfigTokenStatus === "pending" || localConfigTokenStatus === "error") return
    // Toggle Stremio attivo e URL risolto: mostra l'artefatto finale vero.
    // In caricamento (null) resta l'editor: niente flash vuoto.
    if (stremioPreview && stremioPreviewUrl) {
      setPreviewUrl(stremioPreviewUrl)
      return
    }
    // Profili sfumatura per formato: in landscape la preview mostra i valori
    // live della sezione Orizzontale (quelli salvati nel profilo), in
    // portrait i flat. Tinta e ombra superiore restano condivise (flat).
    const isLandscapePreview = posterShape === "landscape"
    const url = buildPreviewUrl(
      {
        selected: navigation.selected,
        previewPoster: navigation.previewPoster,
        selectedLogo: navigation.selectedLogo,
        selectedBackdrop,
        logoScale, logoOffsetX, logoOffsetY,
        backdropScale, backdropOffsetX, backdropOffsetY,
        metaInfo, trendRank, mdblistAnimeList: trending.mdblistAnimeList,
        topEdgeColor, bottomEdgeColor, accentColor, autoAccentColor, lang, tmdbKey,
        region: editorCtx.defaultRegion,
        dateFormat: editorCtx.defaultDateFormat,
        // Preview WYSIWYG nel namespace (altrimenti mostra il globale).
        userId: currentUserId,
      },
      { globalBadges, rankingBadges, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle, videoFormats, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle, customBadge, gradientHeight: isLandscapePreview ? landscapeBlur.gradientHeight : gradientHeight, blurIntensity: isLandscapePreview ? landscapeBlur.blurIntensity : blurIntensity, blurFade: isLandscapePreview ? landscapeBlur.blurFade : blurFade, blurDarkness: isLandscapePreview ? landscapeBlur.blurDarkness : blurDarkness, blurEnabled: isLandscapePreview ? landscapeBlur.blurEnabled : blurEnabled, tintStrength: isLandscapePreview ? landscapeBlur.tintStrength : tintStrength, topShade: isLandscapePreview ? landscapeBlur.topShade : topShade, networkLogo, networkLogoPosition, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, separateBadgeScale, separateBadgeOffsetX, separateBadgeOffsetY, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY },
      localConfigToken,
    )
    setPreviewUrl(url)
  }, [stremioPreview, stremioPreviewUrl, navigation.selected, navigation.previewPoster, navigation.selectedLogo, selectedBackdrop,
    logoScale, logoOffsetX, logoOffsetY, backdropScale, backdropOffsetX, backdropOffsetY,
    metaInfo, trendRank, trending.mdblistAnimeList, topEdgeColor, bottomEdgeColor, accentColor, autoAccentColor, lang, tmdbKey,
    editorCtx.defaultRegion, editorCtx.defaultDateFormat, currentUserId, localConfigToken, localConfigTokenStatus,
    globalBadges, rankingBadges, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle, videoFormats, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle, customBadge, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, landscapeBlur, tintStrength, topShade, networkLogo, networkLogoPosition, preRelease, ribbonSide, ribbonEnabled, posterShape, logoAlign, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, separateBadgeScale, separateBadgeOffsetX, separateBadgeOffsetY, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY])

  // A1: trailing debounce della preview URL (200ms). Ogni tick di slider
  // cambia l'identità di buildPreviewUrlCb → senza debounce ogni pixel di
  // drag genera una URL e un render server (storm). Il timer si resetta a
  // ogni tick: solo l'ultimo stato dopo la pausa fa partire XHR + sharp.
  // Cambio di titolo selezionato = fire immediato (niente attesa).
  const lastPreviewSelectedId = useRef<number | null>(null)
  useEffect(() => {
    if (!navigation.selected) { lastPreviewSelectedId.current = null; setPreviewUrl(""); return }
    const selectedId = navigation.selected.id
    if (lastPreviewSelectedId.current !== selectedId) {
      lastPreviewSelectedId.current = selectedId
      buildPreviewUrlCb()
      return
    }
    const timer = setTimeout(buildPreviewUrlCb, 200)
    return () => clearTimeout(timer)
  }, [navigation.selected, buildPreviewUrlCb])

  // --- Color detection ---
  // In landscape la base è il backdrop: accent/topLight auto si campionano
  // da lì (w780, tier backdrop), come fa il server sulla stessa immagine —
  // altrimenti `ac=`/`tl=` in preview contraddicono il render.
  const landscapePreview = posterShape === "landscape"
  useRootColors(
    landscapePreview ? (selectedBackdrop ?? navigation.previewPoster) : navigation.previewPoster,
    normalizeGenreName(metaInfo.genres[0]?.name, lang) || undefined,
    posterUrl,
    { setAccentColor, setAutoAccentColor, setTopEdgeColor, setBottomEdgeColor },
    landscapePreview ? "w780" : "w342",
  )

  // --- Caricamento dati item corrente (M16) ---
  // Condiviso tra openPosterBrowser e l'effetto cambio lingua: ricarica
  // dettagli + rank + awards + immagini, aggiornando metaInfo (generi/voto/badge),
  // trendRank, mdblistMatch, posters/logos/backdrops e titolo. La guardia
  // fetchIdRef evita che una risposta stale sovrascriva la selezione corrente.
  // The main path publishes artwork as soon as details+images resolve — rank
  // and awards enrich afterwards without blocking the editor (see pending).
  async function loadCurrentItemData(item: SearchResult, fetchId: number, sourcesOverride?: string[]) {
    // A replacement load aborts the previous network work; exiting the editor
    // or unmounting aborts via the lifecycle effect above. Aborting only stops
    // the network: every state update below still checks fetchIdRef.
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const signal = controller.signal
    const isCurrent = () => navigation.fetchIdRef.current === fetchId && loadAbortRef.current === controller && !signal.aborted
    const itemId = item.id
    const itemType = item.media_type
    const mdblistParam = mdblistApiKey ? "&mdblist_key=" + encodeURIComponent(mdblistApiKey) : ""
    // Fonti esplicite all'apertura titolo (mapping salvato): la closure
    // `ratingSources` vale ancora la sessione precedente finché setRatingSources
    // non committa — senza override il voto congelato in metaInfo userebbe le
    // fonti vecchie e gareggerebbe col refetch dell'effetto [ratingSources].
    const activeSources = sourcesOverride ?? ratingSources
    const rsrcParam = activeSources && activeSources.length > 0 ? "&rsrc=" + encodeURIComponent(activeSources.join(",")) : ""
    const regionLang = contentLanguageForUiLang(lang, editorCtx.defaultRegion)
    const detailsUrl = `/api/tmdb/${itemId}/details?type=${itemType}&language=${regionLang}&api_key=${tmdbKey}${mdblistParam}${rsrcParam}`
    // Le immagini partono SUBITO in parallelo ai details (non dopo): la lingua
    // originale serve solo ad allargare la query quando è fuori da lang/en.
    // Niente retry qui: i dati si ricaricano al tick dopo, e un retry
    // triplicherebbe la coda peggiore (30s × 3) proprio sul path critico.
    const defaultImageLangs = `${lang},en,null`
    const imagesUrl = (langs: string) => `/api/tmdb/${itemId}/images?type=${itemType}&languages=${langs}&api_key=${tmdbKey}`
    const emptyLists: ImageLists = { posters: [], logos: [], backdrops: [] }
    type AwardPayload = { awards: string[]; nominations: string[]; studios: string[]; director: string | null; keywords: string[] }
    const noAwards: AwardPayload = { awards: [], nominations: [], studios: [], director: null, keywords: [] }
    // Optional enrichment (rank + awards) resolves in parallel with the main
    // path and never blocks it. Results arriving before the base publish are
    // stashed and merged into it, so an early optional response is never wiped
    // by the later base publish; results arriving after update only their owned
    // fields via functional updates, so manual edits and artwork selection
    // survive. Failures settle to the previous empty fallbacks without
    // rejecting the artwork path.
    const pending: { rankSettled: boolean; rank: number | null; awardsSettled: boolean; awards: AwardPayload } = {
      rankSettled: false, rank: null, awardsSettled: false, awards: noAwards,
    }
    let basePublished = false
    // Studios matched from TMDB networks/companies win over the awards
    // fallback. The base publish fills this before merging stashed awards;
    // late awards reuse it so they never overwrite a TMDB match.
    let tmdbMatchedStudios: string[] = []
    const applyAwards = (a: AwardPayload) => {
      if (!isCurrent()) return
      setMetaInfo((prev) => {
        if (navigation.fetchIdRef.current !== fetchId || signal.aborted) return prev
        return {
          ...prev,
          awards: a.awards,
          nominations: a.nominations,
          studios: tmdbMatchedStudios.length > 0 ? prev.studios : a.studios,
          director: a.director,
          keywords: a.keywords,
        }
      })
    }
    const regionLangForRank = getRegionDef(editorCtx.defaultRegion).lang
    // Namespace-aware rank (same Top 20 source as the catalogs): without it
    // the preview badge would always read JustWatch. Errors settle to null
    // via the rejection path below — never a JW substitution. Device config
    // token when the namespace is not enough; never browser-cached (the URL
    // does not version the selection). While a device token is pending or
    // failed the rank stays unsettled here (no silent namespace read); the
    // persistence effect refreshes once it resolves.
    const rankConfigParam = localConfigToken ? `&config=${encodeURIComponent(localConfigToken)}` : ""
    const rankUserParam = currentUserId ? `&u=${encodeURIComponent(currentUserId)}` : ""
    if (localConfigTokenStatus !== "pending" && localConfigTokenStatus !== "error") {
    http<{ rank: number | null }>(`/api/trending/rank?type=${itemType}&id=${itemId}&api_key=${encodeURIComponent(tmdbKey)}&region=${encodeURIComponent(editorCtx.defaultRegion)}&lang=${encodeURIComponent(regionLangForRank)}${rankUserParam}${rankConfigParam}`, { timeout: 15000, signal, cache: "no-store" }).then(
      (d) => {
        if (!isCurrent()) return
        pending.rank = d?.rank ?? null
        pending.rankSettled = true
        if (basePublished) setTrendRank(pending.rank || null)
      },
      () => {
        if (!isCurrent()) return
        pending.rank = null
        pending.rankSettled = true
        if (basePublished) setTrendRank(null)
      },
    )
    }
    http<AwardPayload>(`/api/awards/${itemType}/${itemId}?api_key=${encodeURIComponent(tmdbKey)}&lang=${encodeURIComponent(lang)}`, { timeout: 15000, signal }).then(
      (d) => {
        if (!isCurrent()) return
        pending.awards = { awards: d?.awards || [], nominations: d?.nominations || [], studios: d?.studios || [], director: d?.director || null, keywords: d?.keywords || [] }
        pending.awardsSettled = true
        if (basePublished) applyAwards(pending.awards)
      },
      () => {
        if (!isCurrent()) return
        pending.awards = noAwards
        pending.awardsSettled = true
        if (basePublished) applyAwards(noAwards)
      },
    )
    const imagesPromise: Promise<ImageLists | null> = http<ImageLists>(imagesUrl(defaultImageLangs), { timeout: 30000, retries: 0, signal }).catch(() => {
      // Abort is not an error: drop without the empty fallback so the caller
      // publishes nothing for a superseded load.
      if (!isCurrent()) return null
      return emptyLists
    })
    const detailsPromise: Promise<{ genres: { id: number; name: string }[]; voteAverage: number; voteCount: number; status: string | null; type: string | null; release_date: string | null; first_air_date: string | null; last_air_date: string | null; next_episode_to_air: { air_date: string; episode_number: number; season_number: number } | null; number_of_seasons: number | null; number_of_episodes: number | null; title: string | null; name: string | null; imdb_id: string | null; wikidata_id?: string | null; networks: { name: string; logo_path: string | null; origin_country?: string }[]; production_companies: { name: string; logo_path: string | null; origin_country?: string }[]; original_language: string; anime_ids?: SearchResult["anime_ids"]; aggregatedRatings?: AggregatedRatings | null } | null> = http<{ genres: { id: number; name: string }[]; voteAverage: number; voteCount: number; status: string | null; type: string | null; release_date: string | null; first_air_date: string | null; last_air_date: string | null; next_episode_to_air: { air_date: string; episode_number: number; season_number: number } | null; number_of_seasons: number | null; number_of_episodes: number | null; title: string | null; name: string | null; imdb_id: string | null; wikidata_id?: string | null; networks: { name: string; logo_path: string | null; origin_country?: string }[]; production_companies: { name: string; logo_path: string | null; origin_country?: string }[]; original_language: string; anime_ids?: SearchResult["anime_ids"]; aggregatedRatings?: AggregatedRatings | null }>(detailsUrl, { timeout: 30000, signal }).catch((e) => {
      // Abort is not a service error: no outage flag, no fallback published.
      if (!isCurrent()) return null
      console.error("[pictorium] Details fetch failed:", e)
      setServiceErrors((prev) => ({ ...prev, tmdb: true }))
      return { genres: [] as { id: number; name: string }[], voteAverage: 0, voteCount: 0, status: null, type: null, release_date: null, first_air_date: null, last_air_date: null, next_episode_to_air: null, number_of_seasons: null, number_of_episodes: null, title: null, name: null, imdb_id: null, wikidata_id: null, networks: [] as { name: string; logo_path: string | null; origin_country?: string }[], production_companies: [] as { name: string; logo_path: string | null; origin_country?: string }[], original_language: "en", aggregatedRatings: null }
    })
    // Main path waits only for details+images: rank/awards enrich later.
    const [details, initialData] = await Promise.all([detailsPromise, imagesPromise])
    if (!details || !initialData || !isCurrent()) return null
    const origLang = details.original_language
    const imageLangs = origLang && origLang !== lang && origLang !== "en" ? `${defaultImageLangs},${origLang}` : defaultImageLangs
    let data = initialData
    if (imageLangs !== defaultImageLangs) {
      // Solo quando la lingua originale aggiunge copertura: refetch e merge.
      try {
        const extra = await http<ImageLists>(imagesUrl(imageLangs), { timeout: 30000, retries: 0, signal })
        if (!isCurrent()) return null
        data = mergeImageLists(data, extra)
      } catch {
        if (!isCurrent()) return null
        // Retry failure keeps the base-language artwork (previous behavior).
      }
    }
    if (!isCurrent()) return null
    // Single base publish: artwork + details. Already-settled optional results
    // merge in; pending ones apply later via their functional updates above.
    navigation.setSelected({ ...item, imdb_id: details.imdb_id, anime_ids: details.anime_ids })
    navigation.setPosters(data.posters || [])
    navigation.setLogos(data.logos || [])
    setBackdrops(data.backdrops || [])
    if (details.title) navigation.setSelected((prev) => ({ ...prev!, title: details.title! }))
    if (details.name) navigation.setSelected((prev) => ({ ...prev!, name: details.name! }))
    const tmdbNetworks = itemType === "tv" ? (details.networks || []).map((n: { name: string }) => n.name) : (details.production_companies || []).map((c: { name: string }) => c.name)
    tmdbMatchedStudios = matchTMDBStudios(tmdbNetworks)
    const settledAwards = pending.awardsSettled ? pending.awards : noAwards
    setMetaInfo({ genres: details.genres || [], voteAverage: details.voteAverage || 0, aggregatedRatings: details.aggregatedRatings ?? null, imdb_id: details.imdb_id ?? undefined, wikidata_id: details.wikidata_id ?? undefined, type: details.type ?? undefined, status: details.status ?? undefined, release_date: details.release_date ?? undefined, first_air_date: details.first_air_date ?? undefined, last_air_date: details.last_air_date ?? undefined, next_episode_to_air: details.next_episode_to_air ?? undefined, number_of_seasons: details.number_of_seasons ?? undefined, number_of_episodes: details.number_of_episodes ?? undefined, awards: settledAwards.awards, nominations: settledAwards.nominations, studios: tmdbMatchedStudios.length ? tmdbMatchedStudios : settledAwards.studios, director: settledAwards.director, keywords: settledAwards.keywords, networksDetailed: details.networks || [], productionCompaniesDetailed: details.production_companies || [] })
    if (pending.rankSettled) setTrendRank(pending.rank || null)
    // A pending new rank must not leave the previous load's rank visible.
    else setTrendRank(null)
    basePublished = true
    const extImdbId = item.imdb_id || details.imdb_id
    if (extImdbId) {
      http<{ match?: { key: string; rank: number } }>(`/api/mdblist?imdb=${extImdbId}&api_key=${mdblistApiKey}`, { timeout: 15000, signal }).then((d) => {
        if (!isCurrent()) return
        setMdblistMatch(d?.match || null)
      }).catch((e) => {
        // Abort is not an error: silent, no fallback applied to another load.
        if (!isCurrent()) return
        console.error("[pictorium] MDBList lookup failed:", e)
      })
    } else {
      setMdblistMatch(null)
    }
    if (!item.poster_path && data.posters?.length > 0) {
      const first = data.posters.find((p: TMDBImage) => p.iso_639_1) || data.posters[0]
      navigation.setSelected((prev) => ({ ...prev!, poster_path: first.file_path }))
    }
    return { details, data, itemId, itemType, signal }
  }

  // --- Aggiornamento reattivo voto medio quando cambia ratingSources ---
  useEffect(() => {
    if (metaInfo.aggregatedRatings) {
      const calculated = computeVote(metaInfo.aggregatedRatings, ratingSources)
      if (typeof calculated === "number" && calculated > 0) {
        setMetaInfo((prev) => ({ ...prev, voteAverage: calculated }))
        return
      }
    }
    if (!navigation.selected || (!tmdbKey && !serverHasTmdbKey)) return
    const itemId = navigation.selected.id
    const itemType = navigation.selected.media_type
    const mdblistParam = mdblistApiKey ? "&mdblist_key=" + encodeURIComponent(mdblistApiKey) : ""
    const rsrcParam = ratingSources && ratingSources.length > 0 ? "&rsrc=" + encodeURIComponent(ratingSources.join(",")) : ""
    const regionLang = contentLanguageForUiLang(lang, editorCtx.defaultRegion)
    const detailsUrl = `/api/tmdb/${itemId}/details?type=${itemType}&language=${regionLang}&api_key=${tmdbKey}${mdblistParam}${rsrcParam}`
    let active = true
    const signal = loadAbortRef.current?.signal
    http<{ voteAverage: number; aggregatedRatings?: AggregatedRatings | null }>(detailsUrl, { timeout: 15000, signal }).then((d) => {
      if (!active || signal?.aborted) return
      if (typeof d?.voteAverage === "number" && d.voteAverage > 0) {
        setMetaInfo((prev) => ({
          ...prev,
          voteAverage: d.voteAverage,
          aggregatedRatings: d.aggregatedRatings ?? prev.aggregatedRatings,
        }))
      }
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [ratingSources]) // eslint-disable-line react-hooks/exhaustive-deps

  // Default logo globali per formato (Impostazioni · Verticale/Orizzontale):
  // in landscape vince l'override Orizzontale, altrove il flat. Null =
  // unset (auto-fit per la scala, 0 per gli offset). Usati all'apertura e
  // alla scelta logo quando il mapping non congela un valore proprio.
  const logoScaleDefaultFor = (shape: string): number | null =>
    (shape === "landscape" ? landscapeDefaults?.logoScale : undefined) ?? defaultLogoScale ?? null
  const logoOffsetDefault = (shape: string, axis: "x" | "y"): number | null => {
    const land = shape === "landscape" ? landscapeDefaults : undefined
    const flat = axis === "x" ? defaultLogoOffsetX : defaultLogoOffsetY
    return (axis === "x" ? land?.logoOffsetX : land?.logoOffsetY) ?? flat ?? null
  }

  // Shared initial artwork selection (saved-mapping restore or auto chain),
  // used by both openPosterBrowser and the language/region refresh: a refresh
  // that supersedes the open before any poster was picked must still land an
  // initial poster instead of leaving the editor empty. Mapping, preset,
  // logoDisabled, backdrop and format rules live here once — callers must not
  // duplicate them. The refresh passes skipDefaultsSync: rebuilding the whole
  // editor state from storage on a language switch would wipe in-memory tweaks
  // and revert a just-changed region (open already synced styles beforehand).
  const applyLoadedSelection = (data: ImageLists, details: { original_language: string }, item: SearchResult, skipDefaultsSync = false) => {
    const itemType = item.media_type
    const itemId = item.id
    setTitleOrigLang(details.original_language ?? null)
    const existing = mappingsMap.get(`${itemType}:${itemId}`)
    if (existing) {
      // Base custom salvata: la preview parte dal tile custom (highlight e
      // preview coerenti), non dal riferimento TMDB di fallback.
      const customFile = existing.customPosterUrl && isCustomPosterUrl(existing.customPosterUrl)
        ? existing.customPosterUrl
        : null
      const previewFilePath = customFile ?? existing.posterPath
      const previewLang = customFile ? null : existing.language
      const foundPoster = !customFile ? (data.posters || []).find((p: TMDBImage) => p.file_path === existing.posterPath) : undefined
      navigation.setPreviewPoster(foundPoster ? { file_path: foundPoster.file_path, iso_639_1: foundPoster.iso_639_1, vote_average: 0, width: foundPoster.width, height: foundPoster.height } : { file_path: previewFilePath, iso_639_1: previewLang, vote_average: 0, width: 0, height: 0 })
      let foundLogo: TMDBImage | undefined
      if (existing.logoPath) {
        foundLogo = (data.logos || []).find((l: TMDBImage) => l.file_path === existing.logoPath)
        navigation.setSelectedLogo(foundLogo ? { file_path: foundLogo.file_path, iso_639_1: existing.language, vote_average: 0, width: foundLogo.width, height: foundLogo.height } : { file_path: existing.logoPath, iso_639_1: existing.language, vote_average: 0, width: 0, height: 0 })
      // Riapertura mapping senza logo esplicito: nessun auto su portrait
      // non-clean (solo clean o landscape); logoDisabled sempre onorato.
      } else if (!existing.logoDisabled && (customFile ? true : ((foundPoster ? foundPoster.iso_639_1 === null : previewLang === null) || (existing.posterShape ?? defaultPosterShape) === "landscape"))) {
        const autoLogo = autoLogoSelection(data.logos || [], lang, details.original_language, `${itemType}/${itemId}`)
        if (autoLogo) {
          navigation.setSelectedLogo({ file_path: autoLogo.file_path, iso_639_1: autoLogo.iso_639_1, vote_average: 0, width: autoLogo.width, height: autoLogo.height })
          // Scala logo: default globale per formato > auto-fit per aspect.
          const scale = logoScaleDefaultFor(existing.posterShape ?? defaultPosterShape) ?? logoDefaultScale(autoLogo)
          if (scale !== null) setLogoScale(scale)
        }
      }
      setLogoScale(effectiveMappingForShape(existing, existing.posterShape ?? defaultPosterShape)?.logoScale ?? logoScaleDefaultFor(existing.posterShape ?? defaultPosterShape) ?? 75)
      if (existing.backdropPath && data.backdrops) {
        const foundBackdrop = data.backdrops.find((b: TMDBImage) => b.file_path === existing.backdropPath)
        setSelectedBackdrop(foundBackdrop || { file_path: existing.backdropPath, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
      }
      setNetworkLogo(existing.networkLogo ?? defaultNetworkLogo)
      setNetworkLogoPosition(existing.networkLogoPosition ?? defaultNetworkLogoPosition)
      setEpisodeGroupId(existing.episodeGroupId ?? null)
    } else {
      setLogoDisabled(false)
      setNetworkLogo(defaultNetworkLogo)
      setNetworkLogoPosition(defaultNetworkLogoPosition)
      setEpisodeGroupId(null)
      const clean = data.posters?.find((p: TMDBImage) => p.iso_639_1 === null)
      const langPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === lang)
      const firstPoster = data.posters?.[0]
      // Con "disattiva clean" si salta il ramo clean+logo e si usa la catena
      // lingua -> en -> originale -> primo non-clean (badge invariati, niente
      // logo sopra in portrait). La scelta manuale di un clean resta possibile.
      const firstNonClean = defaultDisableCleanPosters
        ? data.posters?.find((p: TMDBImage) => p.iso_639_1 !== null)
        : undefined
      let chosenPoster: TMDBImage | null = null
      if (clean && !defaultDisableCleanPosters) {
        const autoLogo = autoLogoSelection(data.logos || [], lang, details.original_language, `${itemType}/${itemId}`)
        if (autoLogo) {
          chosenPoster = clean
          navigation.setPreviewPoster({ file_path: clean.file_path, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
          navigation.setSelectedLogo({ file_path: autoLogo.file_path, iso_639_1: autoLogo.iso_639_1, vote_average: 0, width: autoLogo.width, height: autoLogo.height })
          // Scala logo: default globale per formato > auto-fit per aspect.
          const scale = logoScaleDefaultFor(defaultPosterShape) ?? logoDefaultScale(autoLogo)
          if (scale !== null) setLogoScale(scale)
        } else {
          const enPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === "en")
          const origPoster = details.original_language ? data.posters?.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
          const fallbackPoster = langPoster || enPoster || origPoster || firstNonClean || firstPoster
          if (fallbackPoster) {
            chosenPoster = fallbackPoster
            navigation.setPreviewPoster({ file_path: fallbackPoster.file_path, iso_639_1: fallbackPoster.iso_639_1, vote_average: 0, width: 0, height: 0 })
          }
        }
      } else if (langPoster) {
        chosenPoster = langPoster
        navigation.setPreviewPoster({ file_path: langPoster.file_path, iso_639_1: lang, vote_average: 0, width: 0, height: 0 })
      } else {
        const origPoster = details.original_language ? data.posters?.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
        const fallbackPoster = origPoster || firstNonClean || firstPoster
        if (fallbackPoster) {
          chosenPoster = fallbackPoster
          navigation.setPreviewPoster({ file_path: fallbackPoster.file_path, iso_639_1: fallbackPoster.iso_639_1, vote_average: 0, width: 0, height: 0 })
        }
      }
      // Solo landscape: senza poster clean (o con clean disattivati) il logo
      // si auto-seleziona comunque (la base è il backdrop, senza testo). In
      // portrait invariato: niente auto-logo senza clean.
      if ((!clean || defaultDisableCleanPosters) && defaultPosterShape === "landscape" && (data.logos?.length ?? 0) > 0) {
        const autoLogo = autoLogoSelection(data.logos || [], lang, details.original_language, `${itemType}/${itemId}`)
        if (autoLogo) {
          navigation.setSelectedLogo({ file_path: autoLogo.file_path, iso_639_1: autoLogo.iso_639_1, vote_average: 0, width: autoLogo.width, height: autoLogo.height })
          // Scala logo: default globale per formato > auto-fit per aspect.
          const landscapeLogoScale = logoScaleDefaultFor(defaultPosterShape) ?? logoDefaultScale(autoLogo)
          if (landscapeLogoScale !== null) setLogoScale(landscapeLogoScale)
        }
      }
      if (!skipDefaultsSync) loadDefaultsToState()
      if (chosenPoster) {
        // Default personalizzati (es. preset Colore) restano assoluti;
        // solo il legacy Naturale si ricalibra per tipo poster.
        setGradientHeight(defaultHeightForPoster(defaultGradientHeight, chosenPoster))
        setBlurFade(defaultFadeForPoster(defaultBlurFade, chosenPoster))
      }
    }
  }

  // --- Poster image refresh ---
  const loadLocaleRef = useRef({ lang, region: editorCtx.defaultRegion })
  useEffect(() => {
    const localeChanged = loadLocaleRef.current.lang !== lang || loadLocaleRef.current.region !== editorCtx.defaultRegion
    loadLocaleRef.current = { lang, region: editorCtx.defaultRegion }
    if (navigation.view !== "edit") {
      loadAbortRef.current?.abort()
      setLoadingImages(false)
      return
    }
    // Resume an interrupted load on return, but do not replace the fresh load
    // already started by openPosterBrowser when opening from another view.
    if (!localeChanged && !loadAbortRef.current?.signal.aborted) return
    if (!navigation.selected || (!tmdbKey && !serverHasTmdbKey)) return
    const item = navigation.selected
    const fetchId = navigation.incrementFetchId()
    setLoadingImages(true)
    // M16: riusa loadCurrentItemData così al cambio lingua si ricaricano anche
    // dettagli/genere/voto/badge, non solo le immagini.
    loadCurrentItemData(item, fetchId).then((loaded) => {
      if (!loaded) return
      if (navigation.fetchIdRef.current !== fetchId || loaded.signal.aborted) return
      const { data, details } = loaded
      if (!previewPosterRef.current) {
        // The open was superseded before picking: same initial selection
        // (without re-syncing defaults from storage: styles are already set).
        applyLoadedSelection(data, details, item, true)
      } else {
        const currentPoster = previewPosterRef.current
        const match = (data.posters || []).find((p: TMDBImage) => p.file_path === currentPoster.file_path)
        if (!match) {
          const oldPoster = previewPosterRef.current
          // Stessa regola del cambio manuale: preset/tweak sopravvivono,
          // solo lo stato pristine si ricalibra sul nuovo tipo.
          const applyFor = (next: TMDBImage) => {
            const adj = adjustGradientForPosterChange(
              { gradientHeight, blurFade },
              oldPoster,
              next,
            )
            if (adj) {
              setGradientHeight(adj.gradientHeight)
              setBlurFade(adj.blurFade)
            }
          }
          const clean = data.posters?.find((p: TMDBImage) => p.iso_639_1 === null)
          const langPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === lang)
          const firstPoster = data.posters?.[0]
          // Con "disattiva clean" il clean non è mai preferito (né qui né sotto):
          // la catena resta lingua -> originale -> primo non-clean.
          const firstNonClean = defaultDisableCleanPosters
            ? data.posters?.find((p: TMDBImage) => p.iso_639_1 !== null)
            : undefined
          if (clean && !defaultDisableCleanPosters) {
            const autoLogo = selectBestLogo(data.logos || [], lang, details.original_language)
            if (autoLogo) {
              navigation.setPreviewPoster({ file_path: clean.file_path, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
              applyFor(clean)
            } else {
              const enPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === "en")
              const nextPoster = langPoster || enPoster || firstPoster || currentPoster
              navigation.setPreviewPoster(nextPoster)
              applyFor(nextPoster)
            }
          } else {
            const nextPoster = langPoster || firstNonClean || firstPoster || currentPoster
            navigation.setPreviewPoster(nextPoster)
            applyFor(nextPoster)
          }
        }
      }
      const livePoster = previewPosterRef.current
      const liveLogo = selectedLogoRef.current
      if (livePoster?.iso_639_1 === null && liveLogo) {
        const match = (data.logos || []).find((l: TMDBImage) => l.file_path === liveLogo.file_path)
        if (!match) {
          const autoLogo = selectBestLogo(data.logos || [], lang, details.original_language)
          navigation.setSelectedLogo(autoLogo || liveLogo)
        }
      }
    }).catch((e) => {
      // A superseded or unmounted load rejects silently: never log or touch
      // state for it (unmount aborts without bumping fetchId, so the signal
      // check below is load-bearing there).
      if (navigation.fetchIdRef.current !== fetchId || loadAbortRef.current?.signal.aborted) return
      console.error("[pictorium] Poster image refresh failed:", e)
    }).finally(() => {
      // Clear the spinner only for the current, non-aborted load: a superseded
      // load must not switch off the new title's spinner, and an unmounted
      // load must not setState at all.
      if (navigation.fetchIdRef.current === fetchId && loadAbortRef.current?.signal.aborted !== true) setLoadingImages(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on locale change or return to editor; other state is set inside
  }, [lang, editorCtx.defaultRegion, navigation.view])

  const openPosterBrowser = async (item: SearchResult) => {
    const itemId = item.id
    const itemType = item.media_type
    const fetchId = navigation.incrementFetchId()
    navigation.setSelected(item)
    navigation.setSelectedLogo(null)
    setSelectedBackdrop(null)
    navigation.setPreviewPoster(null)
    setTrendRank(null)
    setMdblistMatch(null)
    setMetaInfo({ genres: [], voteAverage: 0 })
    setLoadingImages(true)
    setOpenSections({})
    navigation.setPreviewId(`${itemType}:${itemId}`)
    navigation.setView("edit")

    // Imposta stili subito (sync) prima delle chiamate async
    // per evitare race condition: se l'utente cambia opzioni mentre
    // i dati sono in caricamento, la vecchia fetch non deve sovrascrivere
    const existing = mappingsMap.get(`${itemType}:${itemId}`)
    // Fonti che saranno attive per questo titolo (per-titolo salvato o default):
    // stesse per setRatingSources e per il fetch details qui sotto — così il
    // voto in metaInfo nasce già corretto e l'effetto [ratingSources] lo
    // conferma invece di gareggiare con un fetch su fonti diverse.
    const nextSources = existing?.ratingSources ?? defaultRatingSources
    if (existing) {
      setBadgeStyle(existing.badgeStyle ?? defaultBadgeStyle)
      setRankingBadgeStyle(existing.rankingBadgeStyle ?? defaultRankingBadgeStyle)
      setExtraBadgeStyle(existing.extraBadgeStyle ?? defaultExtraBadgeStyle)
      setBadgeFont(existing.badgeFont ?? defaultBadgeFont)
      setQualityBadgeStyle(existing.qualityBadgeStyle ?? defaultQualityBadgeStyle)
      setVideoFormats(existing.videoFormats ?? null)
      setGlobalBadges(existing.showBadges ?? defaultGlobalBadges)
      setRankingBadges(existing.rankingBadges ?? defaultRankingBadges)
      setBadgeGenre(existing.badgeGenre ?? defaultBadgeGenre)
      setBadgeYear(existing.badgeYear ?? defaultBadgeYear)
      setBadgeRating(existing.badgeRating ?? defaultBadgeRating)
      setBadgeQuality(existing.badgeQuality ?? defaultBadgeQuality)
      setCustomRatings(existing.customRatings ?? defaultCustomRatings)
      setRatingSources(nextSources)
      setSeparateRatings(existing.separateRatings ?? defaultSeparateRatings)
      setNetworkLogo(existing.networkLogo ?? defaultNetworkLogo)
      setNetworkLogoPosition(existing.networkLogoPosition ?? defaultNetworkLogoPosition)
      // ribbonSide solo globale: i mapping storici con valore salvato lo ignorano,
      // così la preview resta sincrona con Stremio (side dal default d'istanza).
      setRibbonSide(defaultRibbonSide)
      setRibbonEnabled(existing.ribbonEnabled ?? defaultRibbonEnabled)
      setPosterShape(existing.posterShape ?? defaultPosterShape)
      // Allineamento fisso per formato (verticale sempre centro,
      // orizzontale default globale o sinistra): nessun settaggio deve
      // mai spostare i portrait (contratto legacy).
      setLogoAlign((existing.posterShape ?? defaultPosterShape) === "landscape" ? (defaultLogoAlign ?? "left") : "center")
      // Profili per-formato: all'apertura gli slider mostrano il tuning
      // effettivo del formato salvato (landscape = profilo orizzontale).
      // I flat sfumatura sono il profilo PORTRAIT (la sezione Orizzontale ha
      // il suo store dedicato landscapeBlur, inizializzato qui sotto).
      const eff = effectiveMappingForShape(existing ?? null, existing?.posterShape ?? defaultPosterShape)
      setGradientHeight(existing?.gradientHeight ?? defaultGradientHeight)
      setTopBadgeScale(eff?.topBadgeScale ?? defaultTopBadgeScale)
      setTopBadgeOffsetX(eff?.topBadgeOffsetX ?? defaultTopBadgeOffsetX)
      setTopBadgeOffsetY(eff?.topBadgeOffsetY ?? defaultTopBadgeOffsetY)
      setGenreBadgeScale(eff?.genreBadgeScale ?? defaultGenreBadgeScale)
      setQualityBadgeScale(eff?.qualityBadgeScale ?? defaultQualityBadgeScale)
      // Scala esplicita del mapping vince (incluso 100); default custom
      // salvato (≠ default del suo stile) si preserva; altrimenti segue il
      // default dello stile del titolo (bar senza override → 130).
      setSeparateBadgeScale(resolveSeparateBadgeScaleFallback({ explicit: eff?.separateBadgeScale, defaultScale: defaultSeparateBadgeScale, defaultStyle: defaultSeparateRatingsStyle, style: isSeparateRatingsStyle(eff?.separateRatingsStyle) ? eff.separateRatingsStyle : defaultSeparateRatingsStyle }))
      setSeparateBadgeOffsetX(eff?.separateBadgeOffsetX ?? defaultSeparateBadgeOffsetX)
      setSeparateBadgeOffsetY(eff?.separateBadgeOffsetY ?? defaultSeparateBadgeOffsetY)
      // Layout rating separati dal mapping EFFETTIVO per formato: un eventuale
      // override landscape salvato si rispetta (mai desync); il mapping storico
      // senza campo segue i default. Lo stile resta a scelta singola in UI.
      setSeparateRatingsStyle(isSeparateRatingsStyle(eff?.separateRatingsStyle) ? eff.separateRatingsStyle : defaultSeparateRatingsStyle)
      setNetworkLogoScale(eff?.networkLogoScale ?? defaultNetworkLogoScale)
      setGenreBadgeOffsetX(eff?.genreBadgeOffsetX ?? defaultGenreBadgeOffsetX)
      setGenreBadgeOffsetY(eff?.genreBadgeOffsetY ?? defaultGenreBadgeOffsetY)
      setQualityBadgeOffsetX(eff?.qualityBadgeOffsetX ?? ((existing?.posterShape ?? defaultPosterShape) === "landscape" ? (landscapeDefaults?.qualityBadgeOffsetX ?? defaultQualityBadgeOffsetX) : defaultQualityBadgeOffsetX))
      setQualityBadgeOffsetY(eff?.qualityBadgeOffsetY ?? ((existing?.posterShape ?? defaultPosterShape) === "landscape" ? (landscapeDefaults?.qualityBadgeOffsetY ?? defaultQualityBadgeOffsetY) : defaultQualityBadgeOffsetY))
      setNetworkLogoOffsetX(eff?.networkLogoOffsetX ?? defaultNetworkLogoOffsetX)
      setNetworkLogoOffsetY(eff?.networkLogoOffsetY ?? defaultNetworkLogoOffsetY)
      setBlurIntensity(existing?.blurIntensity ?? defaultBlurIntensity)
      setTintStrength(eff?.tintStrength ?? defaultTintStrength)
      // Ombra superiore: solo per-titolo (flat, niente profilo landscape) —
      // default globale quando il mapping non ce l'ha.
      setTopShade(existing.topShade ?? defaultTopShade)
      setBlurFade(existing?.blurFade ?? defaultBlurFade)
      setBlurDarkness(existing?.blurDarkness ?? defaultBlurDarkness)
      setBlurEnabled(existing?.blurEnabled ?? defaultBlurEnabled)
      // Profilo sfumatura landscape (sezione Orizzontale): mapping.landscape
      // con fallback ai default globali Orizzontale, poi al default flat
      // (come il server), poi al default di formato (fade 70).
      const landEff = effectiveMappingForShape(existing ?? null, "landscape")
      resetLandscapeBlur({
        gradientHeight: landEff?.gradientHeight ?? landscapeDefaults?.gradientHeight ?? defaultGradientHeight,
        blurEnabled: landEff?.blurEnabled ?? landscapeDefaults?.blurEnabled ?? defaultBlurEnabled,
        blurIntensity: landEff?.blurIntensity ?? landscapeDefaults?.blurIntensity ?? defaultBlurIntensity,
        blurFade: landEff?.blurFade ?? landscapeDefaults?.blurFade ?? defaultBlurFade ?? 70,
        blurDarkness: landEff?.blurDarkness ?? landscapeDefaults?.blurDarkness ?? defaultBlurDarkness,
        tintStrength: landEff?.tintStrength ?? landscapeDefaults?.tintStrength ?? defaultTintStrength,
        topShade: landEff?.topShade ?? landscapeDefaults?.topShade ?? defaultTopShade,
      })
      setCustomBadge(existing.customBadge ?? null)
      setRotationPosters(existing.cleanPosters || [])
      setAutoRotateClean(existing.autoRotateClean ?? defaultAutoRotateClean)
      setExcludedPosters(existing.excludedPosters || [])
      setRotationBackdrops(existing.cleanBackdrops || [])
      setAutoRotateBackdrop(existing.autoRotateBackdrop ?? defaultAutoRotateBackdrop)
      setExcludedBackdrops(existing.excludedBackdrops || [])
      setLogoDisabled(existing.logoDisabled ?? false)
      // Offset logo: profilo salvato (mapping.landscape in landscape) > default
      // globali (Orizzontale nel formato) > 0. La calibrazione +10/-10 vive nel
      // renderer, invisibile agli slider.
      setLogoOffsetX(eff?.logoOffsetX ?? logoOffsetDefault(existing?.posterShape ?? defaultPosterShape, "x") ?? 0)
      setLogoOffsetY(eff?.logoOffsetY ?? logoOffsetDefault(existing?.posterShape ?? defaultPosterShape, "y") ?? 0)
      setBackdropScale(existing.backdropScale ?? 100)
      setBackdropOffsetX(existing.backdropOffsetX ?? 0)
      setBackdropOffsetY(existing.backdropOffsetY ?? 0)
    } else {
      setBadgeStyle(defaultBadgeStyle)
      setRankingBadgeStyle(defaultRankingBadgeStyle)
      setExtraBadgeStyle(defaultExtraBadgeStyle)
      setBadgeFont(defaultBadgeFont)
      setGlobalBadges(defaultGlobalBadges)
      setRankingBadges(defaultRankingBadges)
      setBadgeGenre(defaultBadgeGenre)
      setBadgeYear(defaultBadgeYear)
      setBadgeRating(defaultBadgeRating)
      setBadgeQuality(defaultBadgeQuality)
      setQualityBadgeStyle(defaultQualityBadgeStyle)
      setVideoFormats(null)
      setCustomRatings(defaultCustomRatings)
      setRatingSources(nextSources)
      setSeparateRatings(defaultSeparateRatings)
      setGradientHeight(defaultGradientHeight)
      setBlurIntensity(defaultBlurIntensity)
      setTintStrength(defaultTintStrength)
      setTopShade(defaultTopShade)
      setBlurFade(defaultBlurFade)
      setBlurDarkness(defaultBlurDarkness)
      setBlurEnabled(defaultBlurEnabled)
      resetLandscapeBlur({
        gradientHeight: landscapeDefaults?.gradientHeight ?? defaultGradientHeight,
        blurEnabled: landscapeDefaults?.blurEnabled ?? defaultBlurEnabled,
        blurIntensity: landscapeDefaults?.blurIntensity ?? defaultBlurIntensity,
        // Come il server (effectiveDefaultsForShape): senza override
        // Orizzontale si eredita il default flat, non 70 fisso.
        blurFade: landscapeDefaults?.blurFade ?? defaultBlurFade ?? 70,
        blurDarkness: landscapeDefaults?.blurDarkness ?? defaultBlurDarkness,
        tintStrength: landscapeDefaults?.tintStrength ?? defaultTintStrength,
        topShade: landscapeDefaults?.topShade ?? defaultTopShade,
      })
      // Scale badge: con default Orizzontale gli slider partono dai default
      // globali Orizzontale (come la sfumatura sopra); in portrait resta lo
      // storico (valori correnti preservati, mai resettati all'apertura).
      if (defaultPosterShape === "landscape") {
        setTopBadgeScale(landscapeDefaults?.topBadgeScale ?? defaultTopBadgeScale)
        setTopBadgeOffsetX(landscapeDefaults?.topBadgeOffsetX ?? defaultTopBadgeOffsetX)
        setTopBadgeOffsetY(landscapeDefaults?.topBadgeOffsetY ?? defaultTopBadgeOffsetY)
        setGenreBadgeScale(landscapeDefaults?.genreBadgeScale ?? defaultGenreBadgeScale)
        setGenreBadgeOffsetX(landscapeDefaults?.genreBadgeOffsetX ?? defaultGenreBadgeOffsetX)
        setGenreBadgeOffsetY(landscapeDefaults?.genreBadgeOffsetY ?? defaultGenreBadgeOffsetY)
        setQualityBadgeScale(landscapeDefaults?.qualityBadgeScale ?? defaultQualityBadgeScale)
        setSeparateBadgeScale(resolveSeparateBadgeScaleFallback({ explicit: landscapeDefaults?.separateBadgeScale, defaultScale: defaultSeparateBadgeScale, defaultStyle: defaultSeparateRatingsStyle, style: isSeparateRatingsStyle(landscapeDefaults?.separateRatingsStyle) ? landscapeDefaults.separateRatingsStyle : defaultSeparateRatingsStyle }))
        setSeparateBadgeOffsetX(landscapeDefaults?.separateBadgeOffsetX ?? defaultSeparateBadgeOffsetX)
        setSeparateBadgeOffsetY(landscapeDefaults?.separateBadgeOffsetY ?? defaultSeparateBadgeOffsetY)
        // Stile dal profilo Orizzontale se presente (override rispettato),
        // altrimenti default flat condiviso.
        setSeparateRatingsStyle(isSeparateRatingsStyle(landscapeDefaults?.separateRatingsStyle) ? landscapeDefaults.separateRatingsStyle : defaultSeparateRatingsStyle)
        setQualityBadgeOffsetX(landscapeDefaults?.qualityBadgeOffsetX ?? defaultQualityBadgeOffsetX)
        setQualityBadgeOffsetY(landscapeDefaults?.qualityBadgeOffsetY ?? defaultQualityBadgeOffsetY)
        setNetworkLogoScale(landscapeDefaults?.networkLogoScale ?? defaultNetworkLogoScale)
        setNetworkLogoOffsetX(landscapeDefaults?.networkLogoOffsetX ?? defaultNetworkLogoOffsetX)
        setNetworkLogoOffsetY(landscapeDefaults?.networkLogoOffsetY ?? defaultNetworkLogoOffsetY)
      }
      setNetworkLogo(defaultNetworkLogo)
      setNetworkLogoPosition(defaultNetworkLogoPosition)
      setRibbonSide(defaultRibbonSide)
      setRibbonEnabled(defaultRibbonEnabled)
      setPosterShape(defaultPosterShape)
      setLogoAlign(defaultPosterShape === "landscape" ? (defaultLogoAlign ?? "left") : "center")
      setCustomBadge(null)
      setRotationPosters([])
      setAutoRotateClean(defaultAutoRotateClean)
      setExcludedPosters([])
      setRotationBackdrops([])
      setAutoRotateBackdrop(defaultAutoRotateBackdrop)
      setExcludedBackdrops([])
      setLogoDisabled(false)
      setLogoOffsetX(logoOffsetDefault(defaultPosterShape, "x") ?? 0)
      setLogoOffsetY(logoOffsetDefault(defaultPosterShape, "y") ?? 0)
      setSelectedBackdrop(null)
      setBackdropScale(100)
      setBackdropOffsetX(0)
      setBackdropOffsetY(0)
    }

    try {
      const loaded = await loadCurrentItemData(item, fetchId, nextSources)
      if (!loaded) return
      if (navigation.fetchIdRef.current !== fetchId || loaded.signal.aborted) return
      const { details, data } = loaded
      applyLoadedSelection(data, details, item)
    } finally {
      // A superseded load must not switch off the new title's spinner, and an
      // unmounted load (aborted without a fetchId bump) must not setState.
      if (navigation.fetchIdRef.current === fetchId && loadAbortRef.current?.signal.aborted !== true) setLoadingImages(false)
    }
  }
  const openPosterBrowserRef = useRef(openPosterBrowser)
  openPosterBrowserRef.current = openPosterBrowser

  const copyUrl = async () => {
    if (!(await copyText(urlPattern))) return
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const posterActivePath = navigation.previewPoster?.file_path

  const { selectPoster, selectLogo, removeLogo, selectBackdrop, removeBackdrop, saveConfig: savePosterConfig } = usePosterSave({
    selected: navigation.selected, previewPoster: navigation.previewPoster, selectedLogo: navigation.selectedLogo,
    setSelectedLogo: navigation.setSelectedLogo, setPreviewPoster: navigation.setPreviewPoster, setPreviewId: navigation.setPreviewId,
    posters: navigation.posters, metaInfo, trendRank, mdblistAnimeList: trending.mdblistAnimeList,
    mappingsMap, loadMappings, logoScale, logoOffsetX, logoOffsetY,
    selectedBackdrop, setSelectedBackdrop: setSelectedBackdrop, backdropScale, backdropOffsetX, backdropOffsetY,
    setBackdropScale, setBackdropOffsetX, setBackdropOffsetY,
    globalBadges, rankingBadges, customBadge, badgeStyle, rankingBadgeStyle, extraBadgeStyle, badgeFont, qualityBadgeStyle, videoFormats,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, separateRatingsStyle,
    defaultBadgeStyle, defaultRankingBadgeStyle, defaultExtraBadgeStyle, blurEnabled, blurIntensity, blurFade, blurDarkness, landscapeBlur, landscapeBlurDirty, setLandscapeBlur, defaultLogoScale, defaultLogoOffsetX, defaultLogoOffsetY, landscapeDefaults, tintStrength, topShade, gradientHeight,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale,
    separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    setGradientHeight, setBlurFade,
    rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, accentColor, autoAccentColor, logoDisabled, setLogoDisabled,
    rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops,
    setLogoScale, setLogoOffsetX, setLogoOffsetY, networkLogo, networkLogoPosition, ribbonEnabled, lang, episodeGroupId, posterShape,
    defaultSashOrder,
  })

  const saveConfig = useCallback(async () => {
    return await savePosterConfig()
  }, [savePosterConfig])

  const autoSaveExcludedPosters = useCallback(async (nextExcluded: string[], nextRotationPosters?: string[], nextPreviewPoster?: TMDBImage) => {
    await savePosterConfig({
      excludedPosters: nextExcluded,
      rotationPosters: nextRotationPosters ?? rotationPosters,
      previewPoster: nextPreviewPoster,
      silent: true,
    })
  }, [savePosterConfig, rotationPosters])

  const autoSaveExcludedBackdrops = useCallback(async (nextExcluded: string[], nextRotationBackdrops?: string[], nextBackdrop?: TMDBImage | null) => {
    await savePosterConfig({
      excludedBackdrops: nextExcluded,
      rotationBackdrops: nextRotationBackdrops ?? rotationBackdrops,
      ...(nextBackdrop !== undefined ? { selectedBackdrop: nextBackdrop } : {}),
      silent: true,
    })
  }, [savePosterConfig, rotationBackdrops])

  // Prefetch hover sui risultati di ricerca — implementazione in
  // usePrefetchTitle.ts (stesse deps, stessa identità del callback).
  const prefetchTitle = usePrefetchTitle({ tmdbKey, serverHasTmdbKey, lang, defaultRegion: editorCtx.defaultRegion })

  // Leaving the editor cancels the in-flight title load and invalidates it, so
  // late responses cannot repopulate the cleared state. The navigation methods
  // below are stable callbacks, hence this wrapper is stable too.
  const navIncrementFetchId = navigation.incrementFetchId
  const navGoHome = navigation.goHome
  const goHomeAbort = useCallback(() => {
    loadAbortRef.current?.abort()
    navIncrementFetchId()
    // The guarded finally of the cancelled load no longer clears the spinner.
    setLoadingImages(false)
    navGoHome()
  }, [navIncrementFetchId, navGoHome])

  return useMemo(() => ({
    selected: navigation.selected, setSelected: navigation.setSelected,
    view: navigation.view, setView: navigation.setView as React.Dispatch<React.SetStateAction<ViewType>>,
    router: navigation.router,
    posters: navigation.posters, loadingImages,
    previewPoster: navigation.previewPoster, setPreviewPoster: navigation.setPreviewPoster,
    selectedLogo: navigation.selectedLogo, setSelectedLogo: navigation.setSelectedLogo,
    logos: navigation.logos, titleOrigLang,
    posterActivePath: posterActivePath ?? null,
    previewUrl, stremioPreview, setStremioPreview, stremioPreviewUrl, urlPattern, urlPatternImdb, urlPatternAuto, urlPatternNuvio, urlPatternNuvioImdb, urlPatternNuvioAuto, linkMode, setLinkMode: setLinkModeTracked, lang,
    openSections, toggleSection: (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !(prev[key] ?? true) })),
    posterScrollRef, posterScrollInfo, setPosterScrollInfo,
    selectPoster, selectLogo, removeLogo,
    logoBounds,
    selectBackdrop, removeBackdrop,
    trendRank,
    mdblistMatch,
    imdbTop250,
    metaInfo,
    previewId: navigation.previewId, setPreviewId: navigation.setPreviewId,
    saveConfig, removeMapping, mappingsMap,
    goHome: goHomeAbort, sourceView: navigation.sourceView, navigateToPoster: (item: SearchResult, source?: string) => { navigation.navigateToPoster(item, source); openPosterBrowserRef.current(item) },
    refreshLists: trending.refreshLists, loadPlatform: trending.loadPlatform,
    tmdbKey, setQuery: search.setQuery, doSearch: search.doSearch, loadMore: search.loadMore, loadMoreFiltered: search.loadMoreFiltered, retryFailed: search.retryFailed, failedPage: search.failedPage, hasSearched: search.hasSearched,
    titleOf, yearOf, posterUrl,
    trending: trending.trending, trendingError: trending.trendingError, trendingStatus: trending.trendingStatus, streamingCharts: trending.streamingCharts, platformErrors: trending.platformErrors, mdblistAnimeList: trending.mdblistAnimeList, animeStatus: trending.animeStatus, animeSource: trending.animeSource, refreshNonce: trending.refreshNonce,
    STREAMING_PLATFORMS, loadMappings,
    query: search.query, results: search.results, searching: search.searching, error: search.error, setError: search.setError, totalResults: search.totalResults, totalPages: search.totalPages, searchPage: search.searchPage, recentSearches: search.recentSearches, mappings,

    settingsRef, langRef,
    setLangOpen, langOpen, pickLang,
    settingsOpen, setSettingsOpen,
    showLangPicker, setShowLangPicker,
    tmdbKeyInput, setTmdbKeyInput,
    showKey, setShowKey, setTmdbKey,
    serverHasTmdbKey,
    serverKeyStatus,
    currentUserId,
    mdblistApiKey, setMdblistApiKey: setMdblistApiKeyFn,
    tvdbApiKey, setTvdbApiKey: setTvdbApiKeyFn,
    exportData, importData, removeRecentSearch: search.removeRecentSearch, clearRecentSearches: search.clearRecentSearches,
    copyUrl, copied,
    accentColor, autoAccentColor, setAccentColor,
    topEdgeColor, bottomEdgeColor,
    autoSaveExcludedPosters,
    autoSaveExcludedBackdrops,
    prefetchTitle,
    theme, setTheme,
    uiAccent, setUiAccent,
    serviceErrors, setServiceErrors,
    hasNetflixRank,
    customCatalogs, setCustomCatalogs, addCustomCatalog, removeCustomCatalog, toggleCustomCatalog, catalogsSyncNonce,
    disabledCatalogIds, setDisabledCatalogIds, toggleBuiltinCatalog,
    homeDisabledCatalogIds, setHomeDisabledCatalogIds, toggleCatalogHome,
    catalogOrder, setCatalogOrder, moveCatalog,
    catalogRenames, setCatalogRenames, renameCatalog, resetCatalogNames, resetCatalogOrder,
    rankingSourceMovie, rankingSourceSeries, setRankingSource, rankSourceNonce, refreshCurrentRank,
    localConfigToken, localConfigTokenStatus,
    t,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- context value deps intentionally stable to prevent re-render cascades
  }), [
    navigation.selected, navigation.view, navigation.posters, loadingImages, navigation.previewPoster, navigation.selectedLogo,
    navigation.logos, titleOrigLang, posterActivePath, previewUrl, stremioPreview, stremioPreviewUrl, urlPattern, lang,
    openSections, posterScrollInfo, logoBounds,
    trendRank, mdblistMatch, imdbTop250, metaInfo, navigation.previewId,
    selectPoster, selectLogo, saveConfig, removeLogo, goHomeAbort,
    mappingsMap, tmdbKey, search.query, search.results, search.searching, search.totalResults, search.totalPages, search.searchPage, search.recentSearches, search.clearRecentSearches,
    search.doSearch, search.loadMore, search.loadMoreFiltered, search.retryFailed, search.failedPage, search.hasSearched, search.error,
    mappings,
    langOpen, settingsOpen, showLangPicker,
    tmdbKeyInput, showKey, copied, mdblistApiKey, tvdbApiKey,
    serverHasTmdbKey,
    serverKeyStatus,
    currentUserId,
    accentColor, autoAccentColor, setAccentColor,
    topEdgeColor, bottomEdgeColor, autoSaveExcludedPosters, autoSaveExcludedBackdrops, prefetchTitle,
    trending.trending, trending.trendingError, trending.trendingStatus, trending.streamingCharts, trending.platformErrors, trending.mdblistAnimeList, trending.animeStatus, trending.animeSource, trending.refreshNonce,
    trending.refreshLists, trending.loadPlatform,
    theme, uiAccent, serviceErrors, hasNetflixRank,
    customCatalogs, disabledCatalogIds, homeDisabledCatalogIds, catalogOrder, catalogRenames,
    rankingSourceMovie, rankingSourceSeries, rankSourceNonce, catalogsSyncNonce, localConfigToken, localConfigTokenStatus,
  ])
}
