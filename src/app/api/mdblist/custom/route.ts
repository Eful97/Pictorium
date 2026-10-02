import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchUnifiedCatalogResult, detectCatalogProvider } from "@/lib/custom-catalog-providers"
import { getDetails, resolveRouteApiKey, tmdbFindByImdb, tmdbFindByTvdb } from "@/lib/tmdb"
import { checkUserAuth, extractUserParam, getScopedUserId, invalidUserResponse, isMultiUserEnabled, userAuthResponse } from "@/lib/user-auth"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"

// Concorrenza del fan-out per-item (v1.23.0): liste fino a 1000 voci con
// Promise.all sparavano migliaia di fetch TMDB concorrenti. Pool fissa;
// le chiavi errate falliscono in fretta via negative-cache 401 (tmdb.ts).
const FANOUT_CONCURRENCY = 5

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted()
      const idx = next++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const url = req.nextUrl.searchParams.get("url")
  if (!url) return Response.json({ items: [] })
  const rawSkip = req.nextUrl.searchParams.get("skip")
  const skip = rawSkip === null ? 0 : Number(rawSkip)
  const section = req.nextUrl.searchParams.get("media_type")
  if ((rawSkip !== null && (!/^\d+$/.test(rawSkip) || !Number.isSafeInteger(skip) || skip > 1000)) ||
    (section !== null && section !== "movie" && section !== "tv")) {
    return Response.json({ error: "Invalid catalog page" }, { status: 400 })
  }
  const signal = rawSkip === null ? req.signal : AbortSignal.any([req.signal, AbortSignal.timeout(28000)])
  const datasetId = req.nextUrl.searchParams.get("dataset") || undefined
  const rawUser = extractUserParam(req)
  const userId = getScopedUserId(rawUser)
  if (datasetId || /^imdb-csv:/i.test(url.trim())) {
    if (rawUser && isMultiUserEnabled() && !userId) return invalidUserResponse()
    if (userId) {
      if (!(await checkUserAuth(req, userId))) return userAuthResponse()
    } else if (!checkAdminToken(req)) {
      return adminAuthResponse()
    }
  }

  const apiKey = await resolveRouteApiKey(req)
  const mdblistKey = await resolveRouteApiKey(req, "mdblist")
  const tvdbKey = await resolveRouteApiKey(req, "tvdb")

  try {
    const detection = detectCatalogProvider(url)
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10) || 500, 1), 1000)
    // Il conteggio totale serve alla UI ("N titoli — anteprima K"): il raw si
    // fetcha fino a 500 (una sola chiamata upstream, cache condivisa con la
    // pagine della griglia) ma si arricchisce solo la finestra
    // richiesta, così la preview resta leggera.
    const fetchLimit = Math.min(Math.max(limit, 500), 1000)
    const { items: rawItems, status } = await fetchUnifiedCatalogResult(url, { apiKey, mdblistKey, tvdbKey, limit: fetchLimit, datasetId, userId })
    const mediaTypeOf = (it: (typeof rawItems)[number]) =>
      ["show", "tv", "anime"].includes(it.mediatype || "") ? "tv" : "movie"
    const filtered = section ? rawItems.filter(it => mediaTypeOf(it) === section) : rawItems
    const items = await mapLimit(
      filtered.slice(skip, skip + limit),
      FANOUT_CONCURRENCY,
      async (it) => {
        let tmdbId = Number(it.tmdb)
        const mediaType = mediaTypeOf(it)
        if (!tmdbId && it.imdb && apiKey) {
          try {
            tmdbId = (await tmdbFindByImdb(it.imdb, mediaType, apiKey, signal)) || 0
          } catch {
            tmdbId = 0
          }
        }
        if (!tmdbId && it.tvdb && apiKey) {
          tmdbId = (await tmdbFindByTvdb(it.tvdb, mediaType, apiKey, signal).catch(() => null)) || 0
        }
        let posterPath: string | null = it.poster_path ?? null
        let title = it.title
        let year = it.year
        if ((!posterPath || !title || !year) && tmdbId && apiKey) {
          try {
            signal.throwIfAborted()
            const d = await getDetails(mediaType, tmdbId, "it-IT", apiKey, signal)
            posterPath = posterPath || d?.poster_path || null
            title = title || d?.title || d?.name || ""
            year = year || Number((d?.release_date || d?.first_air_date || "").slice(0, 4)) || 0
          } catch {
            // Preserve provider artwork if metadata enrichment fails.
          }
        }
        signal.throwIfAborted()
        return {
          id: tmdbId || it.imdb || `tvdb:${it.tvdb}`,
          tmdbId: tmdbId || undefined,
          media_type: mediaType,
          title,
          name: title,
          poster_path: posterPath,
          year,
        }
      },
      signal,
    )
    return Response.json({
      items,
      total: filtered.length,
      nextOffset: skip + items.length < filtered.length ? skip + items.length : null,
      provider: detection?.provider,
      suggestedName: detection?.nameSuggestion,
      defaultType: detection?.defaultType,
      status,
    })
  } catch {
    if (signal.aborted) return Response.json({ error: "Catalog request cancelled or timed out" }, { status: req.signal.aborted ? 499 : 504 })
    return Response.json({ items: [], status: "unavailable" })
  }
}
