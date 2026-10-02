import { NextRequest } from "next/server"
import { resolveRouteApiKey, searchMulti, type TMDBMediaResult } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { jsonGzip } from "@/lib/json-response"

// La multi-search TMDB non pagina oltre questo limite.
const MAX_PAGE = 500

function isValidPage(raw: string): boolean {
  if (!/^\+?\d+$/.test(raw.trim())) return false
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "search")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const rawQuery = req.nextUrl.searchParams.get("q")
  const query = rawQuery ? rawQuery.trim().slice(0, 100) : null
  const language = req.nextUrl.searchParams.get("language") || "it-IT"
  const acceptEncoding = req.headers.get("accept-encoding")
  // Query vuota/corta: 200 vuoto senza toccare chiave, cache o upstream.
  if (!query || query.length < 2) {
    return jsonGzip({ results: [], total_results: 0, total_pages: 0 }, 200, undefined, acceptEncoding)
  }
  // Pagina valida: intero positivo entro il limite upstream. Niente NaN né
  // chiavi cache avvelenate da valori non numerici/negativi/frazionari.
  const rawPage = req.nextUrl.searchParams.get("page")
  if (rawPage !== null && !isValidPage(rawPage)) {
    return jsonGzip({ error: "Invalid page parameter", code: "search_invalid_page" }, 400, undefined, acceptEncoding)
  }
  const page = rawPage === null ? 1 : Number(rawPage.trim())
  // L'accesso si verifica prima del cache hit: senza chiave niente dati, ma
  // la cache resta condivisa fra le richieste autorizzate.
  const apiKey = await resolveRouteApiKey(req)
  if (!apiKey) {
    return jsonGzip({ error: "TMDB API key is missing", code: "search_missing_key" }, 401, undefined, acceptEncoding)
  }
  // Cache key normalizzato (trim + lowercase): la ricerca TMDB è case-insensitive,
  // così "Avatar" e "avatar" condividono lo stesso entry e non si generano miss inutili.
  const cacheKey = `search:${query.toLowerCase()}:${language}:${page}`
  const cached = cacheGet<{ results: TMDBMediaResult[]; total_results: number; total_pages: number }>(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)
  try {
    const data = await searchMulti(query, language, apiKey, page)
    // Solo titoli film/serie; il placeholder client copre chi è senza poster.
    // Le persone restano escluse dal flusso titoli. I totali sono quelli
    // upstream della multi-search, non conteggi esatti dei soli visibili.
    const results = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv")
    const body = { results, total_results: data.total_results || 0, total_pages: data.total_pages || 0 }
    cacheSet(cacheKey, body, ["tmdb", "search"])
    return jsonGzip(body, 200, { "Cache-Control": "public, max-age=300, s-maxage=1800" }, acceptEncoding)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Chiave rifiutata dall'upstream (marchiata 401 anche in negative cache).
    if (/\b401\b/.test(message)) {
      return jsonGzip({ error: "TMDB API key was rejected", code: "search_invalid_key" }, 401, { "Cache-Control": "no-store" }, acceptEncoding)
    }
    return jsonGzip({ error: "Search is temporarily unavailable", code: "search_unavailable" }, 502, { "Cache-Control": "no-store" }, acceptEncoding)
  }
}
