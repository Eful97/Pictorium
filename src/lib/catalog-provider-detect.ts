/**
 * Riconoscimento provider dei cataloghi custom da URL (Letterboxd, Trakt,
 * TMDb, TVDB, IMDb, MDBList).
 *
 * FOGLIA CLIENT-SAFE: zero import, solo regex/stringhe. `CustomCatalogModal`
 * lo usa live nel browser, quindi non deve mai importare moduli server
 * (cache/KV/ioredis, fs, network): un solo import node-only qui dentro
 * rompe la build Turbopack con "Can't resolve 'net'/'tls'/'dns'".
 * La logica con I/O (fetch liste) resta in `custom-catalog-providers.ts`,
 * che re-esporta questa funzione per compatibilità (route, test).
 */

export type CatalogProviderType =
  | "letterboxd"
  | "trakt"
  | "tmdb_collection"
  | "tmdb_list"
  | "tvdb"
  | "imdb"
  | "mdblist"

export interface ProviderDetectionResult {
  provider: CatalogProviderType
  nameSuggestion?: string
  defaultType: "movie" | "series" | "mixed"
  identifier?: string
}

/** Translation keys shared by the import dialog and saved catalog previews. */
export function catalogStatusErrorKey(status?: string, provider?: string): string {
  switch (status) {
    case "private": return "ui.customErrPrivate"
    case "not_found": return "ui.customErrNotFound"
    case "rate_limited": return "ui.customErrRateLimited"
    case "key_missing": return provider === "tvdb" ? "ui.customErrTvdbKey" : "ui.customErrUnavailable"
    case "unsupported": return "ui.customErrUnsupported"
    case "unavailable": return "ui.customErrUnavailable"
    default: return "ui.customNoTitles"
  }
}

/**
 * Riconosce il provider e suggerisce nome e tipo in base all'URL inserito.
 */
export function detectCatalogProvider(input: string): ProviderDetectionResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // 1. Letterboxd
  // es. https://letterboxd.com/arinbicer/list/mcu/ o https://letterboxd.com/user/watchlist/
  const letterboxdMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([a-zA-Z0-9_.-]+)\/(?:list\/([a-zA-Z0-9_.-]+)|watchlist)\/?(?:[?#].*)?$/i)
  if (letterboxdMatch) {
    const user = letterboxdMatch[1]
    const slug = letterboxdMatch[2]
    const isWatchlist = trimmed.toLowerCase().includes("/watchlist")
    const rawName = isWatchlist ? `Watchlist di ${user}` : (slug ? slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Letterboxd List")
    return {
      provider: "letterboxd",
      nameSuggestion: rawName,
      defaultType: "mixed",
    }
  }

  // 2. Trakt
  // es. https://trakt.tv/users/donxy/lists/marvel-cinematic-universe o https://trakt.tv/lists/12345
  const traktMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?trakt\.tv\/(?:users\/([a-zA-Z0-9_.-]+)\/(?:lists\/([a-zA-Z0-9_.-]+)|watchlist)|lists\/([a-zA-Z0-9_.-]+))\/?(?:[?#].*)?$/i)
  if (traktMatch) {
    const user = traktMatch[1]
    const slug = traktMatch[2] || traktMatch[3]
    const isWatchlist = trimmed.toLowerCase().includes("/watchlist")
    const rawName = isWatchlist ? `Watchlist Trakt (${user})` : (slug ? slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Trakt List")
    return {
      provider: "trakt",
      nameSuggestion: rawName,
      defaultType: "mixed",
    }
  }

  // 3. TMDb Collection
  // es. https://www.themoviedb.org/collection/86311-the-avengers-collection o tmdb:collection:86311
  const tmdbColMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?themoviedb\.org\/collection\/([0-9]+)(?:-([a-zA-Z0-9_-]+))?\/?(?:[?#].*)?$/i)
    || trimmed.match(/^tmdb:collection:([0-9]+)$/i)
  if (tmdbColMatch) {
    const slug = tmdbColMatch[2]
    return {
      provider: "tmdb_collection",
      identifier: tmdbColMatch[1],
      nameSuggestion: slug ? slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : `TMDb Collezione ${tmdbColMatch[1]}`,
      defaultType: "movie",
    }
  }

  // 4. TMDb List
  // es. https://www.themoviedb.org/list/8249673-marvel-cinematic-universe o https://www.themoviedb.org/list/8249673 o tmdb:list:8249673
  const tmdbListMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?themoviedb\.org\/(?:u\/[^\/]+\/)?list\/([0-9]+)(?:-([a-zA-Z0-9_-]+))?\/?(?:[?#].*)?$/i)
    || trimmed.match(/^tmdb:list:([0-9]+)$/i)
  if (tmdbListMatch) {
    const slug = tmdbListMatch[2]
    return {
      provider: "tmdb_list",
      identifier: tmdbListMatch[1],
      nameSuggestion: slug ? slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : `TMDb Lista ${tmdbListMatch[1]}`,
      defaultType: "movie",
    }
  }

  // 5. TheTVDB List
  // es. https://thetvdb.com/lists/mcu
  const tvdbMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?thetvdb\.com\/lists\/([a-zA-Z0-9_.-]+)\/?(?:[?#].*)?$/i)
  if (tvdbMatch) {
    const slug = tvdbMatch[1]
    return {
      provider: "tvdb",
      identifier: slug,
      nameSuggestion: slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      defaultType: "mixed",
    }
  }

  // 6. IMDb List
  // es. https://www.imdb.com/list/ls000000000/
  const imdbMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?imdb\.com\/list\/(ls[0-9]+)\/?(?:[?#].*)?$/i)
  if (imdbMatch) {
    return {
      provider: "imdb",
      identifier: imdbMatch[1],
      nameSuggestion: `IMDb ${imdbMatch[1]}`,
      defaultType: "movie",
    }
  }

  // 6b. Riferimento a snapshot CSV importato: imdb-csv:<datasetId>.
  // L'URL salvato resta leggibile ma gli item vivono server-side.
  const imdbCsvMatch = trimmed.match(/^imdb-csv:([a-zA-Z0-9_-]+)$/i)
  if (imdbCsvMatch) {
    return {
      provider: "imdb",
      identifier: imdbCsvMatch[1],
      nameSuggestion: "IMDb CSV",
      defaultType: "mixed",
    }
  }

  // 7. MDBList: solo se sembra davvero un target MDBList (URL mdblist.com,
  // user/slug, id numerico o slug singolo). Qualsiasi altra stringa → null,
  // così il modal rifiuta l'input spazzatura invece di salvare un catalogo
  // morto che torna sempre vuoto.
  if (looksLikeMDBListTarget(trimmed)) {
    return {
      provider: "mdblist",
      defaultType: "movie",
    }
  }
  return null
}

/**
 * Euristica client-safe speculare a `parseMDBListTarget` (mdblist.ts):
 * decide se la stringa può essere un target MDBList senza import server.
 */
function looksLikeMDBListTarget(trimmed: string): boolean {
  const noQuery = trimmed.replace(/\?.*$/, "").replace(/\/+$/, "")
  if (/^(?:https?:\/\/)?(?:api\.)?mdblist\.com\/lists\//i.test(noQuery)) return true
  if (/^[0-9]+$/.test(trimmed)) return true
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return true
  // Slug singolo senza scheme/spazi/slash (es. `nome-lista`).
  if (!/[:\s/]/.test(trimmed) && /^[A-Za-z0-9_.-]+$/.test(trimmed)) return true
  return false
}
