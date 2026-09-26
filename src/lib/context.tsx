"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from "react"
import type { SearchResult, TMDBImage, Mapping, CustomCatalogConfig, PosterShape } from "./types"
import { effectiveMappingForShape } from "./types"
import type { BadgeStyle, RankingBadgeStyle } from "./badge-styles"
import type { RibbonSide } from "./useDefaults"
type LogoAlign = "left" | "center"
import { posterUrl, titleOf, yearOf, STREAMING_PLATFORMS } from "./utils"
import { matchTMDBStudios } from "./badge-labels"
import { setLang as setI18nLang, createT } from "./i18n"
import { isSupportedUiLang, getRegionDef, defaultRegionForLang } from "./regions"
import type { EnrichedAnimeItem } from "./validation"
import { http, userFetch } from "./http"
import { currentPathUuid, fetchWithUserAuthRetry, userAuthHeaders, USER_UNLOCK_EVENT } from "./user-token"
import { copyText } from "./clipboard"
import { useRootColors } from "./useRootColors"
import { buildUrlPattern, buildPreviewUrl } from "./poster-url"
import { selectBestLogo, autoLogoSelection, logoDefaultScale } from "./logo-selection"
import { useTrending } from "./useTrending"
import { useSearch } from "./useSearch"
import { useNavigation } from "./useNavigation"
import { useMappingsStore } from "./useMappingsStore"
import { usePosterEditor, PosterEditorProvider } from "./contexts/PosterEditorContext"
import { usePosterSave } from "./usePosterSave"
import { defaultGradientHeightForPoster, defaultBlurFadeForPoster } from "./gradient-defaults"
import { computeLogoOffsetBounds, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET } from "./logo-layout"
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
import { migrateLegacyStorage } from "./storage-migration"

export type ViewType = "search" | "myposters" | "edit" | "cataloghi"

export interface ImageLists {
  posters: TMDBImage[]
  logos: TMDBImage[]
  backdrops: TMDBImage[]
}

/**
 * Fonde due risposte /images TMDB (default + allargata alla lingua originale),
 * deduplicando per file_path. La prima lista vince a parità di path.
 */
export function mergeImageLists(base: ImageLists, extra: ImageLists): ImageLists {
  const merge = (a: TMDBImage[], b: TMDBImage[]): TMDBImage[] => {
    const seen = new Set(a.map((img) => img.file_path))
    const out = [...a]
    for (const img of b) {
      if (!seen.has(img.file_path)) {
        seen.add(img.file_path)
        out.push(img)
      }
    }
    return out
  }
  return {
    posters: merge(base.posters || [], extra.posters || []),
    logos: merge(base.logos || [], extra.logos || []),
    backdrops: merge(base.backdrops || [], extra.backdrops || []),
  }
}

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
  saveConfig: () => Promise<void>
  removeMapping: (m: Mapping) => Promise<void>
  mappingsMap: Map<string, Mapping>
  goHome: () => void
  sourceView: "edit" | "search" | "myposters" | "cataloghi" | null
  navigateToPoster: (item: SearchResult, source?: string) => void
  refreshLists: () => Promise<void>
  tmdbKey: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  doSearch: (q?: string, page?: number) => Promise<SearchResult[]>
  loadMore: () => Promise<void>
  loadMoreFiltered: (mediaType: "movie" | "tv", targetNew?: number, maxPages?: number) => Promise<number>
  titleOf: (r: SearchResult) => string
  yearOf: (r: SearchResult) => string
  posterUrl: (path: string, size?: string) => string
  trending: (SearchResult & { rank: number })[]
  trendingError: boolean
  mdblistAnimeList: EnrichedAnimeItem[]
  streamingCharts: Record<string, import("./types").FlixPatrolChart>
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
  exportData: () => Promise<void>
  importData: () => void
  copyUrl: () => Promise<void>
  copied: boolean
  accentColor: string | null
  autoAccentColor: string | null
  setAccentColor: (v: string | null) => void
  topEdgeColor: string | null
  bottomEdgeColor: string | null
  autoSaveExcludedPosters: (nextExcluded: string[], nextRotationPosters?: string[], nextPreviewPoster?: TMDBImage) => Promise<void>
  autoSaveExcludedBackdrops: (nextExcluded: string[], nextRotationBackdrops?: string[]) => Promise<void>
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
    badgeStyle, setBadgeStyle,
    rankingBadgeStyle, setRankingBadgeStyle,
    customBadge, setCustomBadge,
    networkLogo, setNetworkLogo,
    preRelease,
    ribbonSide,
    posterShape, setPosterShape,
    logoAlign, setLogoAlign,
    // Defaults
    defaultBadgeStyle,
    defaultRankingBadgeStyle,
    defaultGlobalBadges,
    defaultRankingBadges,
    defaultBadgeGenre,
    defaultBadgeYear,
    defaultBadgeRating,
    defaultBadgeQuality,
    defaultCustomRatings,
    defaultRatingSources,
    defaultSeparateRatings,
    defaultSashOrder,
    defaultRibbonSide,
    defaultPosterShape,
    defaultLogoAlign,
    setRibbonSide,
    defaultBlurEnabled,
    defaultBlurIntensity,
    defaultTintStrength,
    defaultBlurFade,
    defaultBlurDarkness,
    defaultGradientHeight,
    defaultTopBadgeScale,
    defaultTopBadgeOffsetX,
    defaultTopBadgeOffsetY,
    defaultGenreBadgeScale, defaultQualityBadgeScale, defaultNetworkLogoScale,
    defaultGenreBadgeOffsetX, defaultGenreBadgeOffsetY, defaultQualityBadgeOffsetX, defaultQualityBadgeOffsetY,
    defaultNetworkLogoOffsetX, defaultNetworkLogoOffsetY,
    defaultAutoRotateClean,
    defaultAutoRotateBackdrop,
    defaultNetworkLogo,
    loadDefaultsToState,
    // Blur
    blurEnabled, setBlurEnabled,
    blurIntensity, setBlurIntensity,
    tintStrength, setTintStrength,
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

  const logoBounds = useMemo(() => {
    if (!navigation.previewPoster || !navigation.selectedLogo) return { minX: -500, maxX: 500, minY: -500, maxY: 500 }
    // Stessi vincoli del server (poster-service): in landscape il canvas è
    // 16:9 con logo contenuto (max 40%, max 24% altezza) e sollevato
    // (margine 25%), con l'allineamento corrente.
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
        ? { maxWidthPct: 40, maxHeightPct: 24, bottomMarginPct: 25, topOffset: 55 }
        : { maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT, topOffset: PORTRAIT_LOGO_TOP_OFFSET }),
    })
  }, [navigation.previewPoster, navigation.selectedLogo, logoScale, hasBadges, posterShape, logoAlign])

  // --- Custom Catalogs & Profile Auth Hooks ---
  const {
    customCatalogs,
    setCustomCatalogs,
    addCustomCatalog,
    removeCustomCatalog,
    toggleCustomCatalog,
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

  const setTmdbKey = useCallback((val: string) => {
    setTmdbKeyState(val)
    setTmdbKeyInput(val)
    safeSetItem("tmdb_key", val)
  }, [safeSetItem])

  const setMdblistApiKeyFn = useCallback((val: string) => {
    setMdblistApiKey(val)
    safeSetItem("mdblist_key", val)
  }, [safeSetItem])

  const setTvdbApiKeyFn = useCallback((val: string) => {
    setTvdbApiKey(val)
    safeSetItem("tvdb_key", val)
  }, [safeSetItem])

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

    // Se sul dispositivo corrente alcune chiavi sono vuote, interroga /api/defaults
    // per prelevare le chiavi configurate sul server e pre-popolare il client.
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
          safeSetItem("tmdb_key", tmdbKey)
        }
        if (!savedMdblist && mdblistKey) {
          setMdblistApiKey(mdblistKey)
          safeSetItem("mdblist_key", mdblistKey)
        }
        if (!savedTvdb && tvdbKey) {
          setTvdbApiKey(tvdbKey)
          safeSetItem("tvdb_key", tvdbKey)
        }
      })
      .catch(() => {
        /* ignore network errors on init */
      })
  }, [safeGetItem, safeSetItem])

  useEffect(() => {
    safeSetItem("pictorium_theme", theme)
  }, [theme, safeSetItem])

  useEffect(() => {
    if (langInit.current) return
    langInit.current = true
    const saved = safeGetItem("preferred_lang")
    // Solo le lingue delle 12 nazionalità supportate; un valore legacy
    // (zh/ru/ar/nl del vecchio picker) rimostra la scelta.
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
  useEffect(() => {
    const base = {
      globalBadges, rankingBadges, badgeStyle, rankingBadgeStyle,
      badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings,
      customBadge, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, networkLogo, preRelease, ribbonSide, posterShape, logoAlign,
      topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale,
      genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
      networkLogoOffsetX, networkLogoOffsetY,
      tmdbKey, lang, mdblistApiKey,
      // AIO multi-user: `u=` nel template + niente chiavi in chiaro quando il
      // namespace le ha server-side (il server risolve da namespace).
      userId: currentUserId,
      omitApiKey: serverKeyStatus?.tmdb === true,
      omitMdblistKey: serverKeyStatus?.mdblist === true,
    }
    setUrlPattern(buildUrlPattern({ ...base, idPlaceholder: "{tmdb_id}" }))
    setUrlPatternImdb(buildUrlPattern({ ...base, idPlaceholder: "{imdb_id}" }))
    }, [globalBadges, rankingBadges, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, networkLogo, preRelease, ribbonSide, posterShape, logoAlign, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, badgeStyle, rankingBadgeStyle, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, tmdbKey, lang, mdblistApiKey, currentUserId, serverKeyStatus]) // eslint-disable-line react-hooks/exhaustive-deps -- customBadge intentionally excluded to avoid loop

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
      badgeStyle: defaultBadgeStyle, rankingBadgeStyle, globalBadges: defaultGlobalBadges,
      rankingBadges: defaultRankingBadges, badgeGenre: defaultBadgeGenre, badgeYear: defaultBadgeYear,
      badgeRating: defaultBadgeRating, badgeQuality: defaultBadgeQuality, customRatings: defaultCustomRatings,
      ratingSources: defaultRatingSources, separateRatings: defaultSeparateRatings,
      networkLogo: defaultNetworkLogo, ribbonSide: defaultRibbonSide, posterShape: defaultPosterShape,
      logoAlign: defaultLogoAlign, gradientHeight: defaultGradientHeight, blurIntensity: defaultBlurIntensity,
      tintStrength: defaultTintStrength, blurFade: defaultBlurFade, blurDarkness: defaultBlurDarkness,
      blurEnabled: defaultBlurEnabled, topBadgeScale: defaultTopBadgeScale, topBadgeOffsetX: defaultTopBadgeOffsetX,
      topBadgeOffsetY: defaultTopBadgeOffsetY, genreBadgeScale: defaultGenreBadgeScale,
      qualityBadgeScale: defaultQualityBadgeScale, networkLogoScale: defaultNetworkLogoScale,
      genreBadgeOffsetX: defaultGenreBadgeOffsetX, genreBadgeOffsetY: defaultGenreBadgeOffsetY,
      qualityBadgeOffsetX: defaultQualityBadgeOffsetX, qualityBadgeOffsetY: defaultQualityBadgeOffsetY,
      networkLogoOffsetX: defaultNetworkLogoOffsetX, networkLogoOffsetY: defaultNetworkLogoOffsetY,
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
    if (changed("globalBadges")) setGlobalBadges(cur.globalBadges as boolean)
    if (changed("rankingBadges")) setRankingBadges(cur.rankingBadges as boolean)
    if (changed("badgeGenre")) setBadgeGenre(cur.badgeGenre as boolean)
    if (changed("badgeYear")) setBadgeYear(cur.badgeYear as boolean)
    if (changed("badgeRating")) setBadgeRating(cur.badgeRating as boolean)
    if (changed("badgeQuality")) setBadgeQuality(cur.badgeQuality as boolean)
    if (changed("customRatings")) setCustomRatings(cur.customRatings as boolean)
    if (changed("ratingSources")) setRatingSources(cur.ratingSources as string[])
    if (changed("separateRatings")) setSeparateRatings(cur.separateRatings as boolean)
    if (changed("networkLogo")) setNetworkLogo(cur.networkLogo as boolean)
    if (changed("ribbonSide")) setRibbonSide(cur.ribbonSide as RibbonSide)
    if (changed("posterShape") || changed("logoAlign")) {
      if (changed("posterShape")) setPosterShape(cur.posterShape as PosterShape)
      setLogoAlign((cur.posterShape as string) === "landscape" ? ((cur.logoAlign as string) ?? "left") as LogoAlign : "center")
    }
    if (changed("gradientHeight")) setGradientHeight(cur.gradientHeight as number)
    if (changed("blurIntensity")) setBlurIntensity(cur.blurIntensity as number)
    if (changed("tintStrength")) setTintStrength(cur.tintStrength as number)
    if (changed("blurFade")) setBlurFade(cur.blurFade as number)
    if (changed("blurDarkness")) setBlurDarkness(cur.blurDarkness as number)
    if (changed("blurEnabled")) setBlurEnabled(cur.blurEnabled as boolean)
    if (changed("topBadgeScale")) setTopBadgeScale(cur.topBadgeScale as number)
    if (changed("topBadgeOffsetX")) setTopBadgeOffsetX(cur.topBadgeOffsetX as number)
    if (changed("topBadgeOffsetY")) setTopBadgeOffsetY(cur.topBadgeOffsetY as number)
    if (changed("genreBadgeScale")) setGenreBadgeScale(cur.genreBadgeScale as number)
    if (changed("qualityBadgeScale")) setQualityBadgeScale(cur.qualityBadgeScale as number)
    if (changed("networkLogoScale")) setNetworkLogoScale(cur.networkLogoScale as number)
    if (changed("genreBadgeOffsetX")) setGenreBadgeOffsetX(cur.genreBadgeOffsetX as number)
    if (changed("genreBadgeOffsetY")) setGenreBadgeOffsetY(cur.genreBadgeOffsetY as number)
    if (changed("qualityBadgeOffsetX")) setQualityBadgeOffsetX(cur.qualityBadgeOffsetX as number)
    if (changed("qualityBadgeOffsetY")) setQualityBadgeOffsetY(cur.qualityBadgeOffsetY as number)
    if (changed("networkLogoOffsetX")) setNetworkLogoOffsetX(cur.networkLogoOffsetX as number)
    if (changed("networkLogoOffsetY")) setNetworkLogoOffsetY(cur.networkLogoOffsetY as number)
  })

  // --- Preview URL ---
  // Modalità Stremio: risolve l'URL esatto servito a Stremio per il titolo
  // (meta → stesso builder dei cataloghi: mapping/auto, default, mv). Chiave
  // browser in query (come le altre preview autenticate) + namespace `u`:
  // se il server non risolve i metadati, si resta sull'editor senza rumore.
  useEffect(() => {
    if (!stremioPreview || !navigation.selected) { setStremioPreviewUrl(null); return }
    const sel = navigation.selected
    const stype = sel.media_type === "movie" ? "movie" : "series"
    const params = new URLSearchParams()
    if (currentUserId) params.set("u", currentUserId)
    if (tmdbKey) params.set("api_key", tmdbKey)
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
  }, [stremioPreview, navigation.selected, currentUserId, tmdbKey, mappingsMap])

  const buildPreviewUrlCb = useCallback(() => {
    // Toggle Stremio attivo e URL risolto: mostra l'artefatto finale vero.
    // In caricamento (null) resta l'editor: niente flash vuoto.
    if (stremioPreview && stremioPreviewUrl) {
      setPreviewUrl(stremioPreviewUrl)
      return
    }
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
        // Preview WYSIWYG nel namespace (altrimenti mostra il globale).
        userId: currentUserId,
      },
      { globalBadges, rankingBadges, badgeStyle, rankingBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, customBadge, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, networkLogo, preRelease, ribbonSide, posterShape, logoAlign, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY }
    )
    setPreviewUrl(url)
  }, [stremioPreview, stremioPreviewUrl, navigation.selected, navigation.previewPoster, navigation.selectedLogo, selectedBackdrop,
    logoScale, logoOffsetX, logoOffsetY, backdropScale, backdropOffsetX, backdropOffsetY,
    metaInfo, trendRank, trending.mdblistAnimeList, topEdgeColor, bottomEdgeColor, accentColor, autoAccentColor, lang, tmdbKey,
    editorCtx.defaultRegion, currentUserId,
    globalBadges, rankingBadges, badgeStyle, rankingBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings, customBadge, gradientHeight, blurIntensity, blurFade, blurDarkness, blurEnabled, tintStrength, networkLogo, preRelease, ribbonSide, posterShape, logoAlign, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale, genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY])

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
    metaInfo.genres[0]?.name,
    posterUrl,
    { setAccentColor, setAutoAccentColor, setTopEdgeColor, setBottomEdgeColor },
    landscapePreview ? "w780" : "w342",
  )

  // --- Caricamento dati item corrente (M16) ---
  // Condiviso tra openPosterBrowser e l'effetto cambio lingua: ricarica
  // dettagli + rank + awards + immagini, aggiornando metaInfo (generi/voto/badge),
  // trendRank, mdblistMatch, posters/logos/backdrops e titolo. La guardia
  // fetchIdRef evita che una risposta stale sovrascriva la selezione corrente.
  async function loadCurrentItemData(item: SearchResult, fetchId: number, sourcesOverride?: string[]) {
    const itemId = item.id
    const itemType = item.media_type
    const mdblistParam = mdblistApiKey ? "&mdblist_key=" + encodeURIComponent(mdblistApiKey) : ""
    // Fonti esplicite all'apertura titolo (mapping salvato): la closure
    // `ratingSources` vale ancora la sessione precedente finché setRatingSources
    // non committa — senza override il voto congelato in metaInfo userebbe le
    // fonti vecchie e gareggerebbe col refetch dell'effetto [ratingSources].
    const activeSources = sourcesOverride ?? ratingSources
    const rsrcParam = activeSources && activeSources.length > 0 ? "&rsrc=" + encodeURIComponent(activeSources.join(",")) : ""
    const regionLang = getRegionDef(editorCtx.defaultRegion).lang
    const detailsUrl = `/api/tmdb/${itemId}/details?type=${itemType}&language=${regionLang}&api_key=${tmdbKey}${mdblistParam}${rsrcParam}`
    // Le immagini partono SUBITO in parallelo ai details (non dopo): la lingua
    // originale serve solo ad allargare la query quando è fuori da lang/en.
    // Niente retry qui: i dati si ricaricano al tick dopo, e un retry
    // triplicherebbe la coda peggiore (30s × 3) proprio sul path critico.
    const defaultImageLangs = `${lang},en,null`
    const imagesUrl = (langs: string) => `/api/tmdb/${itemId}/images?type=${itemType}&languages=${langs}&api_key=${tmdbKey}`
    const emptyLists: ImageLists = { posters: [], logos: [], backdrops: [] }
    const imagesPromise = http<ImageLists>(imagesUrl(defaultImageLangs), { timeout: 30000, retries: 0 }).catch(() => emptyLists)
    const [details, rankData, awardData] = await Promise.all([
      http<{ genres: { id: number; name: string }[]; voteAverage: number; voteCount: number; status: string | null; type: string | null; release_date: string | null; first_air_date: string | null; last_air_date: string | null; next_episode_to_air: { air_date: string; episode_number: number; season_number: number } | null; number_of_seasons: number | null; number_of_episodes: number | null; title: string | null; name: string | null; imdb_id: string | null; wikidata_id?: string | null; networks: { name: string; logo_path: string | null; origin_country?: string }[]; production_companies: { name: string; logo_path: string | null; origin_country?: string }[]; original_language: string; aggregatedRatings?: AggregatedRatings | null }>(detailsUrl, { timeout: 30000 }).catch((e) => { console.error("[pictorium] Details fetch failed:", e); setServiceErrors((prev) => ({ ...prev, tmdb: true })); return { genres: [] as { id: number; name: string }[], voteAverage: 0, voteCount: 0, status: null, type: null, release_date: null, first_air_date: null, last_air_date: null, next_episode_to_air: null, number_of_seasons: null, number_of_episodes: null, title: null, name: null, imdb_id: null, wikidata_id: null, networks: [] as { name: string; logo_path: string | null; origin_country?: string }[], production_companies: [] as { name: string; logo_path: string | null; origin_country?: string }[], original_language: "en", aggregatedRatings: null } }),
      http<{ rank: number | null }>(`/api/trending/rank?type=${itemType}&id=${itemId}&api_key=${encodeURIComponent(tmdbKey)}&region=${encodeURIComponent(editorCtx.defaultRegion)}&lang=${encodeURIComponent(regionLang)}`, { timeout: 15000 }).catch(() => ({ rank: null })),
      http<{ awards: string[]; nominations: string[]; studios: string[]; director: string | null; keywords: string[] }>(`/api/awards/${itemType}/${itemId}?api_key=${encodeURIComponent(tmdbKey)}&lang=${encodeURIComponent(lang)}`, { timeout: 15000 }).catch(() => ({ awards: [] as string[], nominations: [] as string[], studios: [] as string[], director: null, keywords: [] as string[] })),
    ])
    const origLang = details.original_language
    const imageLangs = origLang && origLang !== lang && origLang !== "en" ? `${defaultImageLangs},${origLang}` : defaultImageLangs
    let data = await imagesPromise
    if (imageLangs !== defaultImageLangs) {
      // Solo quando la lingua originale aggiunge copertura: refetch e merge.
      const extra = await http<ImageLists>(imagesUrl(imageLangs), { timeout: 30000, retries: 0 }).catch(() => null)
      if (extra && navigation.fetchIdRef.current === fetchId) data = mergeImageLists(data, extra)
    }
    if (navigation.fetchIdRef.current !== fetchId) return null
    navigation.setSelected({ ...item, imdb_id: details.imdb_id })
    navigation.setPosters(data.posters || [])
    navigation.setLogos(data.logos || [])
    setBackdrops(data.backdrops || [])
    if (details.title) navigation.setSelected((prev) => ({ ...prev!, title: details.title! }))
    if (details.name) navigation.setSelected((prev) => ({ ...prev!, name: details.name! }))
    const tmdbNetworks = itemType === "tv" ? (details.networks || []).map((n: { name: string }) => n.name) : (details.production_companies || []).map((c: { name: string }) => c.name)
    setMetaInfo({ genres: details.genres || [], voteAverage: details.voteAverage || 0, aggregatedRatings: details.aggregatedRatings ?? null, imdb_id: details.imdb_id ?? undefined, wikidata_id: details.wikidata_id ?? undefined, type: details.type ?? undefined, status: details.status ?? undefined, release_date: details.release_date ?? undefined, first_air_date: details.first_air_date ?? undefined, last_air_date: details.last_air_date ?? undefined, next_episode_to_air: details.next_episode_to_air ?? undefined, number_of_seasons: details.number_of_seasons ?? undefined, number_of_episodes: details.number_of_episodes ?? undefined, awards: awardData?.awards || [], nominations: awardData?.nominations || [], studios: matchTMDBStudios(tmdbNetworks).length ? matchTMDBStudios(tmdbNetworks) : (awardData?.studios || []), director: awardData?.director || null, keywords: awardData?.keywords || [], networksDetailed: details.networks || [], productionCompaniesDetailed: details.production_companies || [] })
    setTrendRank(rankData.rank || null)
    const extImdbId = item.imdb_id || details.imdb_id
    if (extImdbId) {
      http<{ match?: { key: string; rank: number } }>(`/api/mdblist?imdb=${extImdbId}&api_key=${mdblistApiKey}`, { timeout: 15000 }).then((d) => {
        if (navigation.fetchIdRef.current === fetchId) {
          setMdblistMatch(d?.match || null)
        }
      }).catch((e) => { console.error("[pictorium] MDBList lookup failed:", e) })
    } else {
      setMdblistMatch(null)
    }
    if (!item.poster_path && data.posters?.length > 0) {
      const first = data.posters.find((p: TMDBImage) => p.iso_639_1) || data.posters[0]
      navigation.setSelected((prev) => ({ ...prev!, poster_path: first.file_path }))
    }
    return { details, data, itemId, itemType }
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
    const regionLang = getRegionDef(editorCtx.defaultRegion).lang
    const detailsUrl = `/api/tmdb/${itemId}/details?type=${itemType}&language=${regionLang}&api_key=${tmdbKey}${mdblistParam}${rsrcParam}`
    let active = true
    http<{ voteAverage: number; aggregatedRatings?: AggregatedRatings | null }>(detailsUrl, { timeout: 15000 }).then((d) => {
      if (!active) return
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

  // --- Poster image refresh ---
  useEffect(() => {
    if (!navigation.selected || (!tmdbKey && !serverHasTmdbKey)) return
    const item = navigation.selected
    const fetchId = navigation.incrementFetchId()
    // M16: riusa loadCurrentItemData così al cambio lingua si ricaricano anche
    // dettagli/genere/voto/badge, non solo le immagini.
    loadCurrentItemData(item, fetchId).then((loaded) => {
      if (!loaded) return
      const { data, details } = loaded
      if (navigation.previewPoster) {
        const match = (data.posters || []).find((p: TMDBImage) => p.file_path === navigation.previewPoster!.file_path)
        if (!match) {
          const clean = data.posters?.find((p: TMDBImage) => p.iso_639_1 === null)
          const langPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === lang)
          const firstPoster = data.posters?.[0]
          if (clean) {
            const autoLogo = selectBestLogo(data.logos || [], lang, details.original_language)
            if (autoLogo) {
              navigation.setPreviewPoster({ file_path: clean.file_path, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
              setGradientHeight(defaultGradientHeightForPoster(clean))
              setBlurFade(defaultBlurFadeForPoster(clean))
            } else {
              const enPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === "en")
              const nextPoster = langPoster || enPoster || firstPoster || navigation.previewPoster
              navigation.setPreviewPoster(nextPoster)
              setGradientHeight(defaultGradientHeightForPoster(nextPoster))
              setBlurFade(defaultBlurFadeForPoster(nextPoster))
            }
          } else {
            const nextPoster = langPoster || firstPoster || navigation.previewPoster
            navigation.setPreviewPoster(nextPoster)
            setGradientHeight(defaultGradientHeightForPoster(nextPoster))
            setBlurFade(defaultBlurFadeForPoster(nextPoster))
          }
        }
      }
      if (navigation.previewPoster?.iso_639_1 === null && navigation.selectedLogo) {
        const match = (data.logos || []).find((l: TMDBImage) => l.file_path === navigation.selectedLogo!.file_path)
        if (!match) {
          const autoLogo = selectBestLogo(data.logos || [], lang, details.original_language)
          navigation.setSelectedLogo(autoLogo || navigation.selectedLogo)
        }
      }
    }).catch((e) => { console.error("[pictorium] Poster image refresh failed:", e) })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on lang / defaultRegion change; others set inside
  }, [lang, editorCtx.defaultRegion])

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
      // ribbonSide solo globale: i mapping storici con valore salvato lo ignorano,
      // così la preview resta sincrona con Stremio (side dal default d'istanza).
      setRibbonSide(defaultRibbonSide)
      setPosterShape(existing.posterShape ?? defaultPosterShape)
      // Allineamento fisso per formato (verticale sempre centro,
      // orizzontale default globale o sinistra): nessun settaggio deve
      // mai spostare i portrait (contratto legacy).
      setLogoAlign((existing.posterShape ?? defaultPosterShape) === "landscape" ? (defaultLogoAlign ?? "left") : "center")
      // Profili per-formato: all'apertura gli slider mostrano il tuning
      // effettivo del formato salvato (landscape = profilo orizzontale).
      const eff = effectiveMappingForShape(existing ?? null, existing?.posterShape ?? defaultPosterShape)
      setGradientHeight(eff?.gradientHeight ?? defaultGradientHeight)
      setTopBadgeScale(eff?.topBadgeScale ?? defaultTopBadgeScale)
      setTopBadgeOffsetX(eff?.topBadgeOffsetX ?? defaultTopBadgeOffsetX)
      setTopBadgeOffsetY(eff?.topBadgeOffsetY ?? defaultTopBadgeOffsetY)
      setGenreBadgeScale(eff?.genreBadgeScale ?? defaultGenreBadgeScale)
      setQualityBadgeScale(eff?.qualityBadgeScale ?? defaultQualityBadgeScale)
      setNetworkLogoScale(eff?.networkLogoScale ?? defaultNetworkLogoScale)
      setGenreBadgeOffsetX(eff?.genreBadgeOffsetX ?? defaultGenreBadgeOffsetX)
      setGenreBadgeOffsetY(eff?.genreBadgeOffsetY ?? defaultGenreBadgeOffsetY)
      setQualityBadgeOffsetX(eff?.qualityBadgeOffsetX ?? defaultQualityBadgeOffsetX)
      setQualityBadgeOffsetY(eff?.qualityBadgeOffsetY ?? defaultQualityBadgeOffsetY)
      setNetworkLogoOffsetX(eff?.networkLogoOffsetX ?? defaultNetworkLogoOffsetX)
      setNetworkLogoOffsetY(eff?.networkLogoOffsetY ?? defaultNetworkLogoOffsetY)
      setBlurIntensity(eff?.blurIntensity ?? defaultBlurIntensity)
      setTintStrength(eff?.tintStrength ?? defaultTintStrength)
      setBlurFade(eff?.blurFade ?? defaultBlurFade)
      setBlurDarkness(eff?.blurDarkness ?? defaultBlurDarkness)
      setBlurEnabled(eff?.blurEnabled ?? defaultBlurEnabled)
      setCustomBadge(existing.customBadge ?? null)
      setRotationPosters(existing.cleanPosters || [])
      setAutoRotateClean(existing.autoRotateClean ?? defaultAutoRotateClean)
      setExcludedPosters(existing.excludedPosters || [])
      setRotationBackdrops(existing.cleanBackdrops || [])
      setAutoRotateBackdrop(existing.autoRotateBackdrop ?? defaultAutoRotateBackdrop)
      setExcludedBackdrops(existing.excludedBackdrops || [])
      setLogoDisabled(existing.logoDisabled ?? false)
      setLogoOffsetX(eff?.logoOffsetX ?? 0)
      setLogoOffsetY(eff?.logoOffsetY ?? 0)
      setBackdropScale(existing.backdropScale ?? 100)
      setBackdropOffsetX(existing.backdropOffsetX ?? 0)
      setBackdropOffsetY(existing.backdropOffsetY ?? 0)
    } else {
      setBadgeStyle(defaultBadgeStyle)
      setRankingBadgeStyle(defaultRankingBadgeStyle)
      setGlobalBadges(defaultGlobalBadges)
      setRankingBadges(defaultRankingBadges)
      setBadgeGenre(defaultBadgeGenre)
      setBadgeYear(defaultBadgeYear)
      setBadgeRating(defaultBadgeRating)
      setBadgeQuality(defaultBadgeQuality)
      setCustomRatings(defaultCustomRatings)
      setRatingSources(nextSources)
      setSeparateRatings(defaultSeparateRatings)
      setGradientHeight(defaultGradientHeight)
      setBlurIntensity(defaultBlurIntensity)
      setTintStrength(defaultTintStrength)
      setBlurFade(defaultBlurFade)
      setBlurDarkness(defaultBlurDarkness)
      setBlurEnabled(defaultBlurEnabled)
      setNetworkLogo(defaultNetworkLogo)
      setRibbonSide(defaultRibbonSide)
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
      setLogoOffsetX(0)
      setLogoOffsetY(0)
      setSelectedBackdrop(null)
      setBackdropScale(100)
      setBackdropOffsetX(0)
      setBackdropOffsetY(0)
    }

    try {
      const loaded = await loadCurrentItemData(item, fetchId, nextSources)
      if (!loaded) return
      const { details, data } = loaded
      const existing = mappingsMap.get(`${itemType}:${itemId}`)
      if (existing) {
        const foundPoster = (data.posters || []).find((p: TMDBImage) => p.file_path === existing.posterPath)
        navigation.setPreviewPoster(foundPoster ? { file_path: foundPoster.file_path, iso_639_1: foundPoster.iso_639_1, vote_average: 0, width: foundPoster.width, height: foundPoster.height } : { file_path: existing.posterPath, iso_639_1: existing.language, vote_average: 0, width: 0, height: 0 })
        let foundLogo: TMDBImage | undefined
        if (existing.logoPath) {
          foundLogo = (data.logos || []).find((l: TMDBImage) => l.file_path === existing.logoPath)
          navigation.setSelectedLogo(foundLogo ? { file_path: foundLogo.file_path, iso_639_1: existing.language, vote_average: 0, width: foundLogo.width, height: foundLogo.height } : { file_path: existing.logoPath, iso_639_1: existing.language, vote_average: 0, width: 0, height: 0 })
        } else if (!existing.logoDisabled) {
          const autoLogo = autoLogoSelection(data.logos || [], lang, details.original_language, `${itemType}/${itemId}`)
          if (autoLogo) {
            navigation.setSelectedLogo({ file_path: autoLogo.file_path, iso_639_1: autoLogo.iso_639_1, vote_average: 0, width: autoLogo.width, height: autoLogo.height })
            const scale = logoDefaultScale(autoLogo)
            if (scale !== null) setLogoScale(scale)
          }
        }
        setLogoScale(effectiveMappingForShape(existing, existing.posterShape ?? defaultPosterShape)?.logoScale ?? 75)
        if (existing.backdropPath && data.backdrops) {
          const foundBackdrop = data.backdrops.find((b: TMDBImage) => b.file_path === existing.backdropPath)
          setSelectedBackdrop(foundBackdrop || { file_path: existing.backdropPath, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
        }
        setNetworkLogo(existing.networkLogo ?? defaultNetworkLogo)
        setEpisodeGroupId(existing.episodeGroupId ?? null)
      } else {
        setLogoDisabled(false)
        setNetworkLogo(defaultNetworkLogo)
        setEpisodeGroupId(null)
        const clean = data.posters?.find((p: TMDBImage) => p.iso_639_1 === null)
        const langPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === lang)
        const firstPoster = data.posters?.[0]
        let chosenPoster: TMDBImage | null = null
        if (clean) {
          const autoLogo = autoLogoSelection(data.logos || [], lang, details.original_language, `${itemType}/${itemId}`)
          if (autoLogo) {
            chosenPoster = clean
            navigation.setPreviewPoster({ file_path: clean.file_path, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
            navigation.setSelectedLogo({ file_path: autoLogo.file_path, iso_639_1: autoLogo.iso_639_1, vote_average: 0, width: autoLogo.width, height: autoLogo.height })
            const scale = logoDefaultScale(autoLogo)
            if (scale !== null) setLogoScale(scale)
          } else {
            const enPoster = data.posters?.find((p: TMDBImage) => p.iso_639_1 === "en")
            const origPoster = details.original_language ? data.posters?.find((p: TMDBImage) => p.iso_639_1 === details.original_language) : undefined
            const fallbackPoster = langPoster || enPoster || origPoster || firstPoster
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
          const fallbackPoster = origPoster || firstPoster
          if (fallbackPoster) {
            chosenPoster = fallbackPoster
            navigation.setPreviewPoster({ file_path: fallbackPoster.file_path, iso_639_1: fallbackPoster.iso_639_1, vote_average: 0, width: 0, height: 0 })
          }
        }
        loadDefaultsToState()
        if (chosenPoster) {
          setGradientHeight(defaultGradientHeightForPoster(chosenPoster))
          setBlurFade(defaultBlurFadeForPoster(chosenPoster))
        }
      }
    } finally {
      setLoadingImages(false)
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
    globalBadges, rankingBadges, customBadge, badgeStyle, rankingBadgeStyle,
    badgeGenre, badgeYear, badgeRating, badgeQuality, customRatings, ratingSources, separateRatings,
    defaultBadgeStyle, defaultRankingBadgeStyle, blurEnabled, blurIntensity, blurFade, blurDarkness, tintStrength, gradientHeight,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, qualityBadgeScale, networkLogoScale,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    setGradientHeight, setBlurFade,
    rotationPosters, autoRotateClean, defaultAutoRotateClean, excludedPosters, accentColor, autoAccentColor, logoDisabled, setLogoDisabled,
    rotationBackdrops, autoRotateBackdrop, defaultAutoRotateBackdrop, excludedBackdrops, backdrops,
    setLogoScale, setLogoOffsetX, setLogoOffsetY, networkLogo, lang, episodeGroupId, posterShape,
    defaultSashOrder,
  })

  const saveConfig = useCallback(async () => {
    await savePosterConfig()
  }, [savePosterConfig])

  const autoSaveExcludedPosters = useCallback(async (nextExcluded: string[], nextRotationPosters?: string[], nextPreviewPoster?: TMDBImage) => {
    await savePosterConfig({
      excludedPosters: nextExcluded,
      rotationPosters: nextRotationPosters ?? rotationPosters,
      previewPoster: nextPreviewPoster,
      silent: true,
    })
  }, [savePosterConfig, rotationPosters])

  const autoSaveExcludedBackdrops = useCallback(async (nextExcluded: string[], nextRotationBackdrops?: string[]) => {
    await savePosterConfig({
      excludedBackdrops: nextExcluded,
      rotationBackdrops: nextRotationBackdrops ?? rotationBackdrops,
      silent: true,
    })
  }, [savePosterConfig, rotationBackdrops])

  // Prefetch hover sui risultati di ricerca: scalda le cache server
  // (details + images) così aprendo l'editor trova tutto già caldo.
  // Fire-and-forget con dedup per titolo; niente retry per non inseguire
  // un hover con richieste zombie.
  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchTitle = useCallback((item: SearchResult) => {
    const key = `${item.media_type}:${item.id}`
    if (prefetchedRef.current.has(key)) return
    if (prefetchedRef.current.size > 200) prefetchedRef.current.clear()
    prefetchedRef.current.add(key)
    const rLang = getRegionDef(editorCtx.defaultRegion).lang
    const langs = `${lang},en,null`
    // Senza chiave da nessuna parte evita prefetch destinati al 401.
    if (!tmdbKey && !serverHasTmdbKey) return
    http(`/api/tmdb/${item.id}/details?type=${item.media_type}&language=${rLang}&api_key=${tmdbKey}`, { timeout: 15000, retries: 0 }).catch(() => null)
    http(`/api/tmdb/${item.id}/images?type=${item.media_type}&languages=${langs}&api_key=${tmdbKey}`, { timeout: 15000, retries: 0 }).catch(() => null)
  }, [tmdbKey, serverHasTmdbKey, lang, editorCtx.defaultRegion])

  return useMemo(() => ({
    selected: navigation.selected, setSelected: navigation.setSelected,
    view: navigation.view, setView: navigation.setView as React.Dispatch<React.SetStateAction<ViewType>>,
    router: navigation.router,
    posters: navigation.posters, loadingImages,
    previewPoster: navigation.previewPoster, setPreviewPoster: navigation.setPreviewPoster,
    selectedLogo: navigation.selectedLogo, setSelectedLogo: navigation.setSelectedLogo,
    logos: navigation.logos,
    posterActivePath: posterActivePath ?? null,
    previewUrl, stremioPreview, setStremioPreview, stremioPreviewUrl, urlPattern, urlPatternImdb, lang,
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
    goHome: navigation.goHome, sourceView: navigation.sourceView, navigateToPoster: (item: SearchResult, source?: string) => { navigation.navigateToPoster(item, source); openPosterBrowserRef.current(item) },
    refreshLists: trending.refreshLists,
    tmdbKey, setQuery: search.setQuery, doSearch: search.doSearch, loadMore: search.loadMore, loadMoreFiltered: search.loadMoreFiltered,
    titleOf, yearOf, posterUrl,
    trending: trending.trending, trendingError: trending.trendingError, streamingCharts: trending.streamingCharts, mdblistAnimeList: trending.mdblistAnimeList,
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
    customCatalogs, setCustomCatalogs, addCustomCatalog, removeCustomCatalog, toggleCustomCatalog,
    disabledCatalogIds, setDisabledCatalogIds, toggleBuiltinCatalog,
    homeDisabledCatalogIds, setHomeDisabledCatalogIds, toggleCatalogHome,
    catalogOrder, setCatalogOrder, moveCatalog,
    catalogRenames, setCatalogRenames, renameCatalog, resetCatalogNames, resetCatalogOrder,
    t,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- context value deps intentionally stable to prevent re-render cascades
  }), [
    navigation.selected, navigation.view, navigation.posters, loadingImages, navigation.previewPoster, navigation.selectedLogo,
    navigation.logos, posterActivePath, previewUrl, stremioPreview, stremioPreviewUrl, urlPattern, lang,
    openSections, posterScrollInfo, logoBounds,
    trendRank, mdblistMatch, imdbTop250, metaInfo, navigation.previewId,
    selectPoster, selectLogo, saveConfig, removeLogo,
    mappingsMap, tmdbKey, search.query, search.results, search.searching, search.totalResults, search.totalPages, search.searchPage, search.recentSearches, search.clearRecentSearches,
    mappings,
    langOpen, settingsOpen, showLangPicker,
    tmdbKeyInput, showKey, copied, mdblistApiKey, tvdbApiKey,
    serverHasTmdbKey,
    serverKeyStatus,
    currentUserId,
    accentColor, autoAccentColor, setAccentColor,
    topEdgeColor, bottomEdgeColor, autoSaveExcludedPosters, autoSaveExcludedBackdrops, prefetchTitle,
    trending.trending, trending.trendingError, trending.streamingCharts, trending.mdblistAnimeList,
    trending.refreshLists,
    theme, uiAccent, serviceErrors, hasNetflixRank,
    customCatalogs, disabledCatalogIds, homeDisabledCatalogIds, catalogOrder, catalogRenames,
  ])
}
