import { getJWRankings, getJWTitles, JW_DIGITAL_MONETIZATION_TYPES, jwGraphql } from "./justwatch"
import type { MDBListEntry } from "./mdblist"
import type { JWDynamicSpec } from "./catalog-provider-detect"
import { REGIONS } from "./regions"
import { createLogger } from "./logger"

const log = createLogger("jw-dynamic")

const NEW_TITLES_QUERY = `query GetNewTitles($country: Country!, $date: Date!, $language: Language!, $filter: TitleFilter, $after: String, $first: Int!, $pageType: NewPageType!) {
  newTitles(country: $country, date: $date, filter: $filter, after: $after, first: $first, priceDrops: false, pageType: $pageType) {
    edges {
      node {
        __typename
        ... on MovieOrSeason {
          objectType
          content(country: $country, language: $language) { title originalReleaseYear externalIds { imdbId tmdbId } }
          ... on Season { show { content(country: $country, language: $language) { title originalReleaseYear externalIds { imdbId tmdbId } } } }
        }
      }
    }
    pageInfo { endCursor hasNextPage }
  }
}`

// Liste lunghe (60 titoli): oltre il timeout rapido delle chart.
const LIST_TIMEOUT_MS = 8000
const PAGE_SIZE = 60
const MAX_PAGES = 4
const DEFAULT_LIMIT = 60

export type JWDynamicStatus = "ok" | "empty" | "unavailable"
export interface JWDynamicResult {
  items: MDBListEntry[]
  status: JWDynamicStatus
}

interface ExternalIds { imdbId?: string | null; tmdbId?: string | null }
interface TitleContent { title?: string | null; originalReleaseYear?: number | null; originalReleaseDate?: string | null; externalIds?: ExternalIds | null }
interface NewTitlesData {
  newTitles?: {
    edges?: Array<{ node?: { objectType?: string; content?: TitleContent; show?: { content?: TitleContent } } }>
    pageInfo?: { endCursor?: string | null; hasNextPage?: boolean }
  }
}

/** Lingua JW per il paese: RegionDef se supportato, altrimenti inglese. */
function languageFor(country: string): string {
  return REGIONS.find((r) => r.code === country)?.lang ?? "en-US"
}

function toEntry(content: TitleContent | null | undefined, type: "movie" | "series"): MDBListEntry | null {
  const rawTmdb = content?.externalIds?.tmdbId
  // Le stagioni espongono "<showId>:<n>": mai un id di stagione come titolo.
  const tmdb = typeof rawTmdb === "string" && /^\d+$/.test(rawTmdb) ? Number(rawTmdb) : undefined
  const imdb = content?.externalIds?.imdbId || ""
  if (!tmdb && !imdb) return null
  return {
    imdb,
    tmdb,
    title: content?.title || "",
    year: Number(content?.originalReleaseYear) || 0,
    mediatype: type === "series" ? "tv" : "movie",
  }
}

function pushUnique(out: MDBListEntry[], seen: Set<string>, entry: MDBListEntry | null): void {
  if (!entry) return
  const key = entry.tmdb ? `t${entry.tmdb}` : `i${entry.imdb}`
  if (seen.has(key)) return
  seen.add(key)
  out.push(entry)
}

const PAGE_TYPE = { new: "NEW", leaving: "LEAVING_SOON", upcoming: "UPCOMING" } as const

async function fetchNewTitlesList(
  spec: JWDynamicSpec,
  pageType: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<MDBListEntry[]> {
  const wantMovie = spec.type === "movie"
  const today = new Date().toISOString().slice(0, 10)
  const out: MDBListEntry[] = []
  const seen = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
    const data: NewTitlesData = await jwGraphql<NewTitlesData>("GetNewTitles", NEW_TITLES_QUERY, {
      country: spec.country,
      language: languageFor(spec.country),
      date: today,
      first: PAGE_SIZE,
      after,
      pageType,
      filter: { objectTypes: [wantMovie ? "MOVIE" : "SHOW"] },
    }, signal, LIST_TIMEOUT_MS)
    const conn = data?.newTitles
    for (const edge of conn?.edges ?? []) {
      const node = edge?.node
      // LEAVING_SOON ignora il filtro objectTypes: filtro anche lato client.
      if (wantMovie ? node?.objectType !== "MOVIE" : node?.objectType === "MOVIE") continue
      pushUnique(out, seen, toEntry(wantMovie ? node?.content : (node?.show?.content ?? node?.content), spec.type))
      if (out.length >= limit) break
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break
    after = conn.pageInfo.endCursor
  }
  return out
}

async function fetchGenreTop(
  spec: JWDynamicSpec,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<MDBListEntry[]> {
  // Titoli più popolari del genere (stesso percorso dei filtri genere dei
  // cataloghi JW); strict: un outage lancia invece di sembrare un genere vuoto.
  const rows = await getJWTitles({
    objectType: spec.type === "movie" ? "MOVIE" : "SHOW",
    country: spec.country,
    first: limit,
    genres: spec.genre ? [spec.genre] : undefined,
    sortBy: "POPULAR",
    language: languageFor(spec.country),
    monetizationTypes: JW_DIGITAL_MONETIZATION_TYPES,
    overfetch: false,
    signal,
    strict: true,
  })
  return rows.slice(0, limit).map((r) => ({
    imdb: r.imdbId ?? "",
    tmdb: r.tmdbId,
    title: r.title ?? "",
    year: 0,
    mediatype: spec.type === "series" ? ("tv" as const) : ("movie" as const),
  }))
}

/** "In salita": titoli UP della chart del giorno, maggiore salto prima. */
async function fetchRising(
  spec: JWDynamicSpec,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<MDBListEntry[]> {
  // strict: un outage lancia invece di sembrare "nessun titolo in salita".
  const rows = await getJWRankings(
    spec.type === "movie" ? "MOVIE" : "SHOW",
    spec.country,
    100,
    undefined,
    languageFor(spec.country),
    signal,
    undefined,
    true,
  )
  return rows
    .filter((r) => r.trend === "UP" && (r.trendDifference ?? 0) > 0)
    .sort((a, b) => (b.trendDifference ?? 0) - (a.trendDifference ?? 0) || a.rank - b.rank)
    .slice(0, limit)
    .map((r) => ({
      imdb: r.imdbId ?? "",
      tmdb: r.tmdbId,
      title: r.title ?? "",
      year: 0,
      mediatype: spec.type === "series" ? ("tv" as const) : ("movie" as const),
    }))
}

/**
 * Lista dinamica JustWatch: sempre la lista live del giorno (nessuno snapshot);
 * l'identità del titolo viaggia come tmdb/imdb come per ogni catalogo custom.
 */
export async function fetchJWDynamicList(
  spec: JWDynamicSpec,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<JWDynamicResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT))
  try {
    let items: MDBListEntry[]
    if (spec.kind === "rising") items = await fetchRising(spec, limit, opts?.signal)
    else if (spec.kind === "genre") items = await fetchGenreTop(spec, limit, opts?.signal)
    else items = await fetchNewTitlesList(spec, PAGE_TYPE[spec.kind], limit, opts?.signal)
    return { items, status: items.length > 0 ? "ok" : "empty" }
  } catch (err) {
    log.warn("JustWatch dynamic list failed", { kind: spec.kind, error: err instanceof Error ? err.message : String(err) })
    return { items: [], status: "unavailable" }
  }
}
