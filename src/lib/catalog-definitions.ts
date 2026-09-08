export type PosteriumCatalogType = "movie" | "series"

export type PosteriumCatalogDefinition = {
  readonly id: string
  readonly name: string
  readonly type: PosteriumCatalogType
}

export const POSTERIUM_CATALOGS = [
  { id: "posterium-jw-movies", name: "🇮🇹 Top 20 Italia — Film", type: "movie" },
  { id: "posterium-jw-series", name: "🇮🇹 Top 20 Italia — Serie TV", type: "series" },
  { id: "posterium-netflix-movies", name: "🔴 Netflix — Film", type: "movie" },
  { id: "posterium-netflix-series", name: "🔴 Netflix — Serie TV", type: "series" },
  { id: "posterium-prime-movies", name: "📦 Prime Video — Film", type: "movie" },
  { id: "posterium-prime-series", name: "📦 Prime Video — Serie TV", type: "series" },
  { id: "posterium-disney-movies", name: "🏰 Disney+ — Film", type: "movie" },
  { id: "posterium-disney-series", name: "🏰 Disney+ — Serie TV", type: "series" },
  { id: "posterium-now-movies", name: "☁️ Sky Go / NOW — Film", type: "movie" },
  { id: "posterium-now-series", name: "☁️ Sky Go / NOW — Serie TV", type: "series" },
  { id: "posterium-apple-movies", name: "🍎 Apple TV+ — Film", type: "movie" },
  { id: "posterium-apple-series", name: "🍎 Apple TV+ — Serie TV", type: "series" },
  { id: "posterium-hbo-movies", name: "🟣 HBO Max — Film", type: "movie" },
  { id: "posterium-hbo-series", name: "🟣 HBO Max — Serie TV", type: "series" },
  { id: "posterium-paramount-movies", name: "🏔️ Paramount+ — Film", type: "movie" },
  { id: "posterium-paramount-series", name: "🏔️ Paramount+ — Serie TV", type: "series" },
  { id: "posterium-crunchyroll-series", name: "🍥 Crunchyroll — Anime & Serie", type: "series" },
  { id: "posterium-crunchyroll-movies", name: "🍥 Crunchyroll — Film Anime", type: "movie" },
  { id: "posterium-anime-movies", name: "⛩️ Top 20 Film Anime", type: "movie" },
  { id: "posterium-anime", name: "⛩️ Top 20 Serie Anime", type: "series" },
] as const satisfies readonly PosteriumCatalogDefinition[]

export type StremioCatalogExtra = {
  readonly name: string
  readonly isRequired?: boolean
  readonly options?: readonly string[]
}

export type PosteriumManifestCatalog = {
  id: string
  name: string
  type: PosteriumCatalogType
  extra?: readonly StremioCatalogExtra[]
}

export const POSTERIUM_SEARCH_CATALOGS = [
  { id: "posterium-search-movies", name: "🔍 Posterium — Cerca Film", type: "movie" },
  { id: "posterium-search-series", name: "🔍 Posterium — Cerca Serie TV", type: "series" },
] as const satisfies readonly PosteriumCatalogDefinition[]

export const POSTERIUM_PEOPLE_SEARCH_CATALOGS = [
  { id: "posterium-search-people-movies", name: "🔍 Posterium — Cerca per Persona (Film)", type: "movie" },
  { id: "posterium-search-people-series", name: "🔍 Posterium — Cerca per Persona (Serie TV)", type: "series" },
] as const satisfies readonly PosteriumCatalogDefinition[]

export const WARMUP_CATALOG_IDS = [
  "posterium-jw-movies",
  "posterium-jw-series",
  "posterium-netflix-movies",
  "posterium-netflix-series",
  "posterium-prime-movies",
  "posterium-prime-series",
  "posterium-anime-movies",
  "posterium-anime",
] as const

const WARMUP_CATALOG_ID_SET: ReadonlySet<string> = new Set(WARMUP_CATALOG_IDS)

export function getWarmupCatalogs(): readonly PosteriumCatalogDefinition[] {
  return POSTERIUM_CATALOGS.filter((catalog) => WARMUP_CATALOG_ID_SET.has(catalog.id))
}
