// Tipi del contesto Pictorium: estratti da context.tsx (nessuna logica runtime).
import type { SearchResult, TMDBImage, Mapping, CustomCatalogConfig } from "./types"
import type { STREAMING_PLATFORMS } from "./utils"
import type { EnrichedAnimeItem } from "./validation"
import type { BackupExportOptions, BackupImportOptions } from "./useMappingsStore"
import type { SaveConfigOverrides, ThumbnailSettingsWrite } from "./usePosterSave"
import type { AggregatedRatings } from "./ratings"
import type { CatalogShapes } from "./catalog-shape"

export type ViewType = "search" | "myposters" | "thumbnails" | "edit" | "cataloghi" | "community"

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
  /** Backdrop congelato della base portrait automatica del server (null =
   *  base = poster). Non-null solo quando la base è composta dal renderer
   *  (ramo `previewBaseAuto`): è l'unica base portrait senza titolo cotto
   *  oltre al poster clean, quindi l'unica su cui l'editor può auto-scegliere
   *  un logo senza doppio titolo. */
  portraitBaseBackdropPath: string | null
  /** La base portrait può essere scelta tra i backdrop clean (picker in
   *  griglia): true quando il titolo in editing è nel ramo base-auto (o ha
   *  già una base congelata). Indipendente dalla provenienza `posterPicked`,
   *  così si può sempre tornare alla base da backdrop. */
  portraitBasePickable: boolean
  /** Scelta esplicita del backdrop che alimenta la base portrait 2:3 (tile in
   *  griglia): live in preview (`pbase`) e congelata al save. Ricliccare il
   *  path scelto torna alla base automatica/salvata. Accetta solo backdrop
   *  clean TMDB: ogni altra immagine è ignorata (catena storica intatta). */
  selectPortraitBaseBackdrop: (img: TMDBImage) => void
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
  /**
   * Seleziona un logo. `auto` marca la provenienza dei rami automatici
   * (ingresso in Orizzontale, base clean/backdrop): il ritorno in Verticale su
   * una base con titolo cotto li ritira, mentre una scelta manuale resta.
   */
  selectLogo: (logo: TMDBImage, opts?: { auto?: boolean }) => Promise<void>
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
  saveConfig: (overrides?: SaveConfigOverrides) => Promise<boolean | void>
  /**
   * Thumbnail-only save: writes only the per-title episode-thumbnail keys
   * (`episodeThumbnailStills`/`thumbnailRotation`). Poster fields, `mv` and
   * poster caches are untouched. Optional so lightweight test harnesses that
   * only stub `saveConfig` keep working (callers fall back to `saveConfig`).
   */
  saveThumbnailSettings?: (settings: ThumbnailSettingsWrite) => Promise<boolean>
  /**
   * Cover-only save ("Salva solo poster"): persists the chosen cover image
   * and logo identity; everything else follows the global defaults
   * (previously frozen custom styling is cleared). On success the editor
   * visuals reset to the global defaults so the preview matches the saved
   * poster.
   */
  saveCoverOnly: () => Promise<boolean | void>
  removeMapping: (m: Mapping) => Promise<void>
  mappingsMap: Map<string, Mapping>
  goHome: () => void
  sourceView: "edit" | "search" | "myposters" | "thumbnails" | "cataloghi" | "community" | null
  /**
   * Apre un titolo nell'editor. `originatingListName` è il nome visibile
   * della lista/catalogo di origine (contesto effimero per il `theme=`
   * della preview): omesso = contesto azzerato (niente leakage).
   */
  navigateToPoster: (item: SearchResult, source?: string, originatingListName?: string | null, seasonalKeywords?: { halloween?: readonly string[]; christmas?: readonly string[] } | null) => void
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
  /** Pictorium publication stamps (ms epoch, per slot) of the served Top 20; null = unknown. */
  trendingUpdatedAt: import("./useTrending").PublicationStamps | null
  /** Pictorium publication stamps (ms epoch, per slot) of the served anime lists; null = unknown. */
  animeUpdatedAt: import("./useTrending").PublicationStamps | null
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
  /** Presenza chiavi d'istanza (store cifrato o env): SOLO booleani, mai valori. */
  instanceHasTmdbKey: boolean
  instanceHasMdblistKey: boolean
  /** Rilegge la presenza d'istanza dopo un salvataggio (mai valori in stato). */
  refreshInstanceKeyPresence: () => Promise<void>
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
  /**
   * Restores the two factory default lists (general JustWatch Top 20
   * movies + series): clears their disabled/home/order/rename entries and
   * returns both Top 20 source slots to factory JustWatch charts (`""`).
   * Custom/imported lists stay available (a custom source selection never
   * deletes the list); streaming selections, API keys, region and visual
   * settings are untouched. Same cross-hook split as `removeCustomCatalog`
   * (each hook persists its own slice through its serialized PUT chain).
   */
  resetDefaultLists: () => Promise<void>
  /** Catalog-name emoji visibility (display only, default shown). */
  catalogShowEmojis: boolean
  setCatalogShowEmojis: (show: boolean) => void
  /** Per-catalog card format overrides (`poster`|`landscape` only; absent key = follow global). */
  catalogShapes: CatalogShapes
  setCatalogShapes: (shapes: CatalogShapes) => void
  setCatalogShape: (id: string, shape: "poster" | "landscape" | null) => void
  resetCatalogShapes: () => void
  /**
   * Custom seasonal keywords per theme (user-scoped): extra whole-word/phrase
   * matches for the automatic catalog-name recognition (built-ins always
   * retained). Empty = built-ins only (legacy).
   */
  seasonalHalloweenKeywords: string[]
  setSeasonalHalloweenKeywords: (keywords: string[]) => void
  seasonalChristmasKeywords: string[]
  setSeasonalChristmasKeywords: (keywords: string[]) => void
  resetSeasonalKeywords: () => void
  /**
   * Opt-in streaming selections (service + chart country + source + variant).
   * `undefined` = absent = legacy mode; explicit (`[]` or list) = curated
   * mode (only general JustWatch Top 20 + enabled selections are exposed
   * to Stremio). Same provider in multiple countries/sources/variants are
   * distinct identities (never merged).
   */
  streamingSelections: import("./streaming-catalogs").StreamingSelection[] | undefined
  setStreamingSelections: (selections: import("./streaming-catalogs").StreamingSelection[]) => void
  /** Add/merge one entry (country accepts RegionDef code or chart slug); returns the outcome for user feedback. */
  addStreamingSelection: (
    service: string,
    country: string,
    sections: Array<import("./streaming-catalogs").GenericStreamingSection>,
    source?: import("./streaming-catalogs").StreamingSourceMode,
    variant?: string | null,
  ) => "added" | "merged" | "duplicate" | "full" | "invalid"
  /** Batch add/merge for the multiselect dialog; returns counts + outcome. */
  addStreamingSelections: (entries: import("./streaming-catalog-client").GenericAddEntry[]) => import("./streaming-catalog-client").BatchAddResult
  /**
   * Remove streaming lists. With a `section`, ONLY that derived list is
   * removed (siblings stay); without it the whole entry goes. Shared
   * records lose ONLY the dropped ids.
   */
  removeStreamingSelection: (
    service: string,
    country: string,
    source?: import("./streaming-catalogs").StreamingSourceMode | null,
    variant?: string | null,
    section?: import("./streaming-catalogs").GenericStreamingSection,
  ) => void
  /**
   * Atomic bulk remove of derived streaming lists (manager multi-delete):
   * one mirror read, one persist, one shared-record cleanup. Factory JW
   * ids never enter (toggle-only, filtered by the caller).
   */
  removeStreamingSelections: (
    items: ReadonlyArray<{
      service: string
      country: string
      source?: import("./streaming-catalogs").StreamingSourceMode | null
      variant?: string | null
      section: import("./streaming-catalogs").GenericStreamingSection
    }>,
  ) => { removed: number; droppedIds: string[] }
  /**
   * Atomic bulk remove of whole custom/addon providers (manager
   * multi-delete). Only whole providers: the caller includes a base id only
   * when ALL its emitted rows are selected.
   */
  removeCustomCatalogs: (baseIds: readonly string[], derivedIds: readonly string[]) => void
  /** Independent Hide (keep config, don't expose to Stremio). */
  toggleStreamingSelection: (
    service: string,
    country: string,
    source?: import("./streaming-catalogs").StreamingSourceMode | null,
    variant?: string | null,
  ) => void
  /** Per-section toggle (narrow entry, or Hide when last section). */
  toggleStreamingSection: (
    service: string,
    country: string,
    section: import("./streaming-catalogs").GenericStreamingSection,
    source?: import("./streaming-catalogs").StreamingSourceMode | null,
    variant?: string | null,
  ) => void
  /** Raw Top 20 source ids (`""` = explicit JustWatch); resolved via the pure resolver. */
  rankingSourceMovie: string
  rankingSourceSeries: string
  rankingSourceStatus: import("./useRankingSources").RankingSourceStatus
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
