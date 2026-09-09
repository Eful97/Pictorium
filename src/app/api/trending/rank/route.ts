import { NextRequest } from "next/server"
import { getJWRankings } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang } from "@/lib/regions"
import { getServerDefaults } from "@/lib/server-defaults"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"

const log = createLogger("trending-rank")

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const rawType = req.nextUrl.searchParams.get("type")
  const rawId = req.nextUrl.searchParams.get("id")
  // Fix H11: type validato esplicitamente — prima qualsiasi stringa non-"movie"
  // diventava silenziosamente SHOW, e i tipi inventati producevano lookup errati.
  if (rawType !== "movie" && rawType !== "tv") {
    return Response.json({ error: "Invalid type: must be 'movie' or 'tv'" }, { status: 400 })
  }
  const id = Number(rawId)
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "Invalid id: must be a positive integer" }, { status: 400 })
  }
  const rawFirst = Number(req.nextUrl.searchParams.get("first"))
  // Finestra di classifica consultata (semantica top-N, default 20 = top-20):
  // un titolo fuori dalla finestra non verrà mai trovato e risulta "senza
  // rank". `first` la rende configurabile (1-100) mantenendo il default.
  const first = Number.isFinite(rawFirst) ? Math.min(Math.max(Math.round(rawFirst), 1), 100) : 20
  // Regione classifica: `?region=`/`?country=` > `?lang=` > default server > IT.
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const qLang = req.nextUrl.searchParams.get("lang")
  const langRegion = qLang ? (parseRegion(qLang) ?? defaultRegionForLang(qLang)) : null
  const region = getRegionDef(qRegion ?? langRegion ?? normalizeRegion(getServerDefaults().region))
  const cacheKey = `rank:v2:${rawType}:${id}:f${first}:r${region.code}`
  const cached = cacheGet<{ rank: number | null; period?: string }>(cacheKey)
  if (cached) {
    // Fix L9: anche il cache-hit dichiara i header cache (Next default
    // no-store) — altrimenti il path caldo non veniva mai cacchettato dalla CDN.
    return Response.json(cached, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
  }
  const headers = { "Cache-Control": "public, max-age=300, s-maxage=1800" }
  try {
    const rankings = await getJWRankings(rawType === "movie" ? "MOVIE" : "SHOW", region.code, first, undefined, region.lang)
    const found = rankings.find((r) => r.tmdbId === id)
    if (found) {
      const body = { rank: found.rank, period: "day", top: first }
      cacheSet(cacheKey, body, ["rank", "justwatch"])
      return Response.json(body, { headers })
    }
    // No-match (fuori dalla finestra top-N o non in classifica): TTL breve —
    // un item può entrare in classifica nel giro di minuti, ma il fallimento
    // (o l'assenza) non deve congelarsi per MAX_TTL.
    const body = { rank: null, top: first }
    cacheSet(cacheKey, body, ["rank", "justwatch"], 60_000)
    return Response.json(body, { headers })
  } catch (e) {
    // Errore di rete: NON cachare il fallimento, ritenta al prossimo accesso.
    log.error("Fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ rank: null }, { headers: { "Cache-Control": "no-store" } })
  }
}
