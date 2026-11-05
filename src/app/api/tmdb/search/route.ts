import { NextRequest } from "next/server"
import { resolveRouteApiKey, searchMulti, type TMDBMediaResult } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { jsonGzip } from "@/lib/json-response"
import { concurrentMap } from "@/lib/episode-ordering"
import { resolveImdbId } from "@/lib/imdb-cache"
import { fetchCinemetaRating } from "@/lib/cinemeta"

// La multi-search TMDB non pagina oltre questo limite.
const MAX_PAGE = 500

/** Riga di risposta: contratto storico + `imdbRating` additivo (assente = UI su vote_average). */
type SearchRow = TMDBMediaResult & { imdbRating?: string }

/**
 * Budget wall-clock della gamba rating (`Cinemeta`): la ricerca resta servita
 * entro ~1.2s anche con upstream appesi. Fail-open: le righe senza voto
 * escono senza `imdbRating` e la UI usa il `vote_average` TMDB.
 */
const SEARCH_RATINGS_BUDGET_MS = 1200
const SEARCH_RATINGS_CONCURRENCY = 5

/**
 * Contratto `imdbRating` (stesso dei cataloghi): stringa decimale 0-10, mai
 * percentuale e mai `0.0` (valori fuori da `(0.1, 10]` = assente).
 */
function normalizeSearchRating(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 10) return undefined
  return value.toFixed(1)
}

/**
 * Arricchisce le righe con il voto IMDb da Cinemeta (gratis, senza chiave).
 * `resolveImdbId` è memoizzato (external_ids, 7 giorni) e ogni errore/timeout
 * degrada riga per riga: la gamba rating non può mai far fallire la ricerca.
 * Un solo AbortSignal condiviso impone il budget TOTALE; `concurrentMap`
 * limita il burst a 5 richieste.
 */
async function withImdbRatings(results: TMDBMediaResult[], apiKey: string): Promise<SearchRow[]> {
  if (results.length === 0) return results
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("Aborted", "AbortError")), SEARCH_RATINGS_BUDGET_MS)
  try {
    return await concurrentMap(results, async (row): Promise<SearchRow> => {
      if (controller.signal.aborted) return row
      try {
        const imdbId = await resolveImdbId(
          row.media_type,
          row.id,
          apiKey,
          SEARCH_RATINGS_BUDGET_MS,
          controller.signal,
        )
        if (!imdbId || controller.signal.aborted) return row
        const rating = await fetchCinemetaRating(
          imdbId,
          row.media_type === "tv" ? "series" : "movie",
          controller.signal,
        )
        const normalized = normalizeSearchRating(rating)
        return normalized ? { ...row, imdbRating: normalized } : row
      } catch {
        return row
      }
    }, SEARCH_RATINGS_CONCURRENCY)
  } finally {
    clearTimeout(timer)
  }
}

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
  // Additivo: le entry pre-esistenti senza `imdbRating` restano valide (la UI
  // ripiega su `vote_average`), quindi nessun bump di versione della chiave.
  const cached = cacheGet<{ results: SearchRow[]; total_results: number; total_pages: number }>(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)
  try {
    const data = await searchMulti(query, language, apiKey, page)
    // Solo titoli film/serie; il placeholder client copre chi è senza poster.
    // Le persone restano escluse dal flusso titoli. I totali sono quelli
    // upstream della multi-search, non conteggi esatti dei soli visibili.
    const rows = (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv")
    // Gamba rating separata e fail-open: qualsiasi guasto/timeout restituisce
    // le righe TMDB intatte (mai 500/502 per il voto IMDb).
    let results: SearchRow[]
    try {
      results = await withImdbRatings(rows, apiKey)
    } catch {
      results = rows
    }
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
