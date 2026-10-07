import { NextRequest } from "next/server"
import { fetchAllWikidata, directorBadgeLabel, isValidWikidataQid } from "@/lib/awards"
import { createT } from "@/lib/i18n-server"
import { getKeywords, resolveRouteApiKey } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"

const log = createLogger("awards")

type RouteParams = { type: string; id: string }

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { type, id } = await params
  const mediaType = type === "tv" || type === "series" ? "tv" : "movie"
  const tmdbId = Number(id)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return Response.json({ awards: [], nominations: [], studios: [], keywords: [] })
  }
  const apiKey = await resolveRouteApiKey(req)
  // Fix L10: try/catch — prima un throw di fetchAllWikidata/getKeywords
  // (outage upstream) cascava in un 500 generico.
  try {
    // Fast-path REST solo se il chiamante porta già il QID (mai fetch TMDB
    // extra qui: endpoint leggero, SPARQL resta il default).
    const qidParam = req.nextUrl.searchParams.get("wikidata_id")
    const wikidataId = isValidWikidataQid(qidParam) ? qidParam : undefined
    const [data, keywords] = await Promise.all([
      fetchAllWikidata(tmdbId, mediaType, undefined, wikidataId ? { wikidataId } : undefined),
      getKeywords(mediaType, tmdbId, apiKey),
    ])
    // Il director in cache è canonico (chiave senza lingua): reso qui nella
    // lingua richiesta (default "it" = comportamento storico senza lang).
    const lang = req.nextUrl.searchParams.get("lang") || "it"
    return Response.json({ ...data, director: directorBadgeLabel(data.director, createT(lang)), keywords })
  } catch (e) {
    log.warn("Awards fetch failed", { mediaType, tmdbId, error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Awards data unavailable" }, { status: 502 })
  }
}
