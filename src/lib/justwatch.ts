// Sovrascrivibile via env: nei test E2E punta al mock server locale.
const JW_API = process.env.JUSTWATCH_API_URL || "https://apis.justwatch.com/graphql"

const QUERY = `query GetStreamingChartInfo($country: Country!, $language: Language!, $filter: StreamingChartsFilter, $first: Int!) {
  streamingCharts(country: $country, filter: $filter, first: $first) {
    edges {
      streamingChartInfo { rank }
      node {
        ... on MovieOrShowOrSeason {
          content(country: $country, language: $language) {
            title
            externalIds { tmdbId imdbId }
          }
        }
      }
    }
  }
}`

export interface JWRankEntry {
  tmdbId: number
  /** IMDb id restituito da JustWatch stesso — evita la chiamata extra a TMDB. */
  imdbId: string | null
  rank: number
  title?: string | null
}

export const PLATFORM_JW_PACKAGES: Record<string, string[]> = {
  netflix: ["nfx"],
  "amazon-prime": ["prv"],
  prime: ["prv"],
  disney: ["dnp"],
  "disney-plus": ["dnp"],
  now: ["ntv", "skg"],
  "now-tv": ["ntv", "skg"],
  "apple-tv": ["atp"],
  apple: ["atp"],
  "hbo-max": ["mxx"],
  hbo: ["mxx"],
  "paramount-plus": ["pmp"],
  paramount: ["pmp"],
}

const rankingsCache = new Map<string, { data: JWRankEntry[]; timestamp: number }>()
const CACHE_TTL = 30 * 60 * 1000
const CACHE_MAX = 100

export async function getJWRankings(
  objectType: "MOVIE" | "SHOW",
  country = "IT",
  first = 20,
  packages?: readonly string[] | string[],
  language = "it-IT",
): Promise<JWRankEntry[]> {
  const pkgKey = packages && packages.length > 0 ? packages.join(",") : "all"
  // La lingua entra nella key: i titoli JW seguono la lingua query.
  const cacheKey = `${objectType}:${country}:${first}:${pkgKey}:${language}`
  const cached = rankingsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  const filter: Record<string, unknown> = {
    objectType,
    category: "DAILY_POPULARITY_SAME_CONTENT_TYPE",
  }
  if (packages && packages.length > 0) {
    filter.packages = packages
  }

  const res = await fetch(JW_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Platform": "WEB" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      operationName: "GetStreamingChartInfo",
      query: QUERY,
      variables: {
        country,
        language,
        filter,
        first: Math.max(first * 2, 20),
      },
    }),
  })
  if (!res.ok) throw new Error(`JustWatch ${objectType} failed: ${res.status}`)
  const json = await res.json()
  const edges = json?.data?.streamingCharts?.edges || []
  const seenTmdb = new Set<number>()
  const result: JWRankEntry[] = []

  for (const e of edges) {
    const tmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
    const imdbId = e?.node?.content?.externalIds?.imdbId || null
    const title = e?.node?.content?.title || null
    const rank = e?.streamingChartInfo?.rank
    if (!tmdbId || !rank || seenTmdb.has(tmdbId)) continue
    seenTmdb.add(tmdbId)
    result.push({ tmdbId, imdbId, rank, title })
    if (result.length >= first) break
  }

  if (result.length > 0) {
    if (rankingsCache.size >= CACHE_MAX) rankingsCache.delete(rankingsCache.keys().next().value!)
    rankingsCache.set(cacheKey, { data: result, timestamp: Date.now() })
  }
  return result
}

const TITLE_OFFERS_QUERY = `query GetTitleOffers($country: Country!, $language: Language!, $filter: TitleFilter) {
  popularTitles(country: $country, filter: $filter, first: 5) {
    edges {
      node {
        content(country: $country, language: $language) {
          title
          externalIds { tmdbId imdbId }
        }
        offers(country: $country, platform: WEB) {
          presentationType
        }
      }
    }
  }
}`

export type JWQuality = "4K" | "1080p" | "SD"

export function resolveMaxQuality(presentationTypes: (string | null | undefined)[]): JWQuality | null {
  const types = presentationTypes.filter(Boolean).map((t) => String(t).toUpperCase())
  if (types.some((t) => t.includes("4K") || t.includes("UHD") || t.includes("2160") || t.includes("_4K"))) {
    return "4K"
  }
  if (types.some((t) => t.includes("HD") || t.includes("1080") || t.includes("720") || t.includes("_1080P") || t.includes("HD_1080"))) {
    return "1080p"
  }
  if (types.some((t) => t.includes("SD") || t.includes("480"))) {
    return "SD"
  }
  return null
}

const qualityCache = new Map<string, { data: JWQuality | null; timestamp: number }>()

export async function getJWTitleQuality(
  tmdbId: number,
  objectType: "MOVIE" | "SHOW",
  searchTitle?: string | null,
  country = "IT",
  signal?: AbortSignal,
  language = "it-IT",
): Promise<JWQuality | null> {
  const cacheKey = `${objectType}:${country}:${tmdbId}`
  const cached = qualityCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    const filter: Record<string, unknown> = {
      objectTypes: [objectType],
    }
    if (searchTitle) {
      filter.searchQuery = searchTitle
    }

    const timeoutSignal = AbortSignal.timeout(4000)
    let combinedSignal: AbortSignal = timeoutSignal
    if (signal) {
      if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
        combinedSignal = (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
      } else {
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
        if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
        else {
          signal.addEventListener("abort", onAbort, { once: true })
          timeoutSignal.addEventListener("abort", onAbort, { once: true })
        }
        combinedSignal = ctrl.signal
      }
    }

    const res = await fetch(JW_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Platform": "WEB" },
      signal: combinedSignal,
      body: JSON.stringify({
        operationName: "GetTitleOffers",
        query: TITLE_OFFERS_QUERY,
        variables: {
          country,
          language,
          filter,
        },
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    const edges = json?.data?.popularTitles?.edges || []

    let matchedNode = null
    for (const e of edges) {
      const edgeTmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
      if (edgeTmdbId === tmdbId) {
        matchedNode = e.node
        break
      }
    }
    if (!matchedNode && searchTitle && edges.length > 0) {
      matchedNode = edges[0].node
    }

    const offers = (matchedNode?.offers || []) as Array<{ presentationType?: string }>
    const presTypes = offers.map((o) => o.presentationType)
    const maxQ = resolveMaxQuality(presTypes)

    if (qualityCache.size >= CACHE_MAX) qualityCache.delete(qualityCache.keys().next().value!)
    qualityCache.set(cacheKey, { data: maxQ, timestamp: Date.now() })
    return maxQ
  } catch {
    return null
  }
}

/** Solo per i test: svuota la cache condivisa delle classifiche e qualità JustWatch. */
export function __resetJWRankingsCache(): void {
  rankingsCache.clear()
  qualityCache.clear()
}
