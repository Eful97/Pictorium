import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { chartGroupKey, chartPinCacheFragment, pinnedFamilyRows, type ChartFamilyPin } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { getDetails, resolveRouteApiKey } from "@/lib/tmdb"
import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import type { EnrichedAnimeItem } from "@/lib/validation"

const log = createLogger("mdblist-anime")

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const typeParam = req.nextUrl.searchParams.get("type") // "movie" | "tv" | null

  const mdblistKey = (await resolveRouteApiKey(req, "mdblist")) || ""
  const tmdbKey = await resolveRouteApiKey(req)
  if (!mdblistKey || !tmdbKey) return Response.json([])

  // Per-family snapshots: full-list canonicals come from the SAME published
  // snapshots the anime catalogs and poster badges read. The families needed
  // by this request (one or both, per `type`) are ensured upfront; one
  // request refreshes THAT stale family only (awaited, bounded). Enrichment
  // below stays live per request. The key isolates the exact credential
  // group (keyed vs public never share enriched bodies) plus each family's
  // pinned generation. No renewal of unrelated families.
  const chartGroupInput = { regionCode: "IT", regionLang: "it-IT", mdblistKey: mdblistKey || undefined }
  const chartGroup = chartGroupKey(chartGroupInput)
  const neededFamilies = [
    ...((!typeParam || typeParam === "tv" || typeParam === "series") ? ["anime:series"] : []),
    ...((!typeParam || typeParam === "movie") ? ["anime:movie"] : []),
  ]
  const pins: Record<string, ChartFamilyPin> = {}
  for (const family of neededFamilies) {
    pins[family] = await ensureFreshChartFamily({ ...chartGroupInput, family })
  }
  const cacheKey = `mdblist:anime:top20:${typeParam || "all"}:enriched:g${chartGroup}${neededFamilies.map((f) => chartPinCacheFragment(pins[f])).join("")}`

  // Publication metadata (T1 backend contract): per-slot last successful
  // publication time (ms epoch) of the SAME pinned snapshot(s) the rows
  // come from — Pictorium's publication, NOT MDBList's update, NOT the
  // request/page time. The array body stays byte-identical (Stremio shape);
  // stamps travel as headers, each absent with no genuine pin for that slot.
  // The combined header is kept for backcompat (oldest served snapshot);
  // the per-slot headers carry the ACTUAL publication of each list (movie
  // vs series publish independently). No extra fetch exists for metadata.
  // Computed from the already-resolved pins BEFORE the cache return so a
  // cache hit repeats the SAME stamps (never dropped, never retimestamped).
  const stampMovie = neededFamilies.includes("anime:movie")
    ? (pins["anime:movie"]?.snapshot?.publishedAt ?? null)
    : null
  const stampSeries = neededFamilies.includes("anime:series")
    ? (pins["anime:series"]?.snapshot?.publishedAt ?? null)
    : null
  const headers: Record<string, string> = {}
  if (typeof stampMovie === "number") headers["X-Pictorium-Updated-At-Movie"] = String(stampMovie)
  if (typeof stampSeries === "number") headers["X-Pictorium-Updated-At-Series"] = String(stampSeries)
  const stamps = [stampMovie, stampSeries].filter((v): v is number => typeof v === "number")
  if (stamps.length === neededFamilies.length && stamps.length > 0) {
    headers["X-Pictorium-Updated-At"] = String(Math.min(...stamps))
  }

  const cached = cacheGet<EnrichedAnimeItem[]>(cacheKey)
  if (cached) return Response.json(cached, { headers })

  try {
    const listsToFetch: Array<{ mediaType: "tv" | "movie"; family: string }> = []
    if (!typeParam || typeParam === "tv" || typeParam === "series") {
      listsToFetch.push({ mediaType: "tv", family: "anime:series" })
    }
    if (!typeParam || typeParam === "movie") {
      listsToFetch.push({ mediaType: "movie", family: "anime:movie" })
    }

    const allResults = await Promise.all(
      listsToFetch.map(async ({ mediaType, family }) => {
        const pinnedRows = pinnedFamilyRows(pins[family])
        const entries = (pinnedRows ?? []).map((r) => ({ imdb: r.imdbId ?? "", title: r.title ?? "", year: r.year ?? 0, tmdb: r.tmdbId || undefined }))
        const enriched = await Promise.all(
          entries.slice(0, 20).map(async (entry, idx): Promise<EnrichedAnimeItem | null> => {
            let tmdbId = entry.tmdb
            if (!tmdbId && entry.imdb) {
              tmdbId = (await resolveImdbToTmdb(entry.imdb, mediaType, tmdbKey)) ?? undefined
            }
            if (!tmdbId) return null
            try {
              const found = await getDetails(mediaType, tmdbId, "it-IT", tmdbKey)
              return {
                id: tmdbId,
                title: found.title || found.name || entry.title || "",
                poster_path: found.poster_path || "",
                rank: idx + 1,
                media_type: mediaType,
              }
            } catch (e) {
              log.error("TMDB lookup failed", { error: e instanceof Error ? e.message : String(e) })
              return null
            }
          })
        )
        return enriched.filter((r): r is EnrichedAnimeItem => r !== null)
      })
    )

    const flattened = allResults.flat()
    if (flattened.length > 0) cacheSet(cacheKey, flattened, ["mdblist"])
    return Response.json(flattened, { headers })
  } catch (e) {
    log.error("Fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json([])
  }
}
