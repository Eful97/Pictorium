import { NextRequest } from "next/server"
import { getJWRankings } from "@/lib/justwatch"
import { getDetails, getImages, resolveRouteApiKey } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getServerDefaults } from "@/lib/server-defaults"
import { getRegionDef, normalizeRegion, parseRegion } from "@/lib/regions"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { jsonGzip } from "@/lib/json-response"
import { combineAbortSignals } from "@/lib/abort-signal"
import {
  TRENDING_ENDPOINT_TIMEOUT_MS,
  TRENDING_ENRICH_CONCURRENCY,
  TRENDING_JW_TIMEOUT_MS,
  TRENDING_TMDB_TIMEOUT_MS,
} from "@/lib/trending-budgets"

const log = createLogger("trending")

interface TrendingItem {
  id: number
  media_type: "movie" | "tv"
  title?: string
  name?: string
  poster_path: string | null
  release_date?: string
  first_air_date?: string
  rank: number
}

interface EnrichJob {
  tmdbId: number
  mediaType: "movie" | "tv"
  rank: number
}

function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === "AbortError" || name === "TimeoutError"
}

/**
 * 404 TMDB fisiologico (id rimosso da TMDB): l'item si scarta in silenzio
 * senza degradare la risposta. Qualsiasi altro errore (500/429/rete/abort/
 * timeout/chiave) è un outage (parziale) — la risposta va marcata degradata
 * e mai cachata come sana. `tmdbFetch` lancia `TMDB fetch failed: {status}`.
 */
function isTmdbNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /TMDB fetch failed: 404(?:\D|$)/.test(msg)
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const apiKey = await resolveRouteApiKey(req)
  // Regione classifica: `?country=` > default server > IT (fail-closed su IT).
  const region = getRegionDef(parseRegion(req.nextUrl.searchParams.get("country")) ?? normalizeRegion(getServerDefaults().region))
  const country = region.code
  const tmdbLang = region.lang
  // v2: la lingua di arricchimento segue la regione — le entry v1 (sempre it-IT)
  // non devono avvelenare le richieste non italiane.
  const cacheKey = `trending:v2:${country}`
  const acceptEncoding = req.headers.get("accept-encoding")
  const cached = cacheGet<{ movies: TrendingItem[]; tv: TrendingItem[] }>(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)

  // Deadline di endpoint: timer esplicito (non AbortSignal.timeout) così i
  // test lo controllano col fake clock; combined col signal del client per i
  // fetch TMDB posseduti dalla route. Cleanup nel finally: niente timer zombie
  // né worker residui dopo la risposta.
  //
  // Confine onesto del budget: i 20s coprono fase JW + arricchimento. La fase
  // prima del timer (rate-limit, risoluzione chiave, lookup cache) è fuori
  // budget ma bounded a parte: rate-limit in-memory sync (KV solo con store
  // configurato, comandi con hard timeout + fallback fail-open in kv.ts),
  // chiavi da header/query/env sync e da file locale (solo con `?u=`).
  const endpointCtrl = new AbortController()
  const endpointTimer = setTimeout(() => {
    endpointCtrl.abort(new DOMException("Trending endpoint deadline exceeded", "TimeoutError"))
  }, TRENDING_ENDPOINT_TIMEOUT_MS)
  const onReqAbort = () => {
    endpointCtrl.abort(req.signal.reason instanceof Error ? req.signal.reason : new DOMException("Client aborted trending request", "AbortError"))
  }
  if (req.signal.aborted) onReqAbort()
  else req.signal.addEventListener("abort", onReqAbort, { once: true })
  try {
    // D6: traccia gli errori upstream — una risposta degradata NON va cachata,
    // altrimenti un outage (JW/TMDB) si congela nel cache fino al refresh.
    let degraded = false
    // Timeout/budget scattati durante l'arricchimento: il parziale resta valido
    // ma va marcato incompleto (mai cacheato come sano).
    let enrichmentTimedOut = false
    // Fase classifiche a budget proprio (8s, timer esplicito fake-clock): un JW
    // unilaterale appeso fallisce in fretta e lascia il resto dell'endpoint
    // alla metà sana + arricchimento. Il signal di fase combina abort del
    // client + deadline di endpoint + tetto 8s: un abort a metà fase cancella
    // davvero il trasporto JW posseduto (ogni getJWRankings fa il suo fetch,
    // niente inflight condiviso da preservare qui) e i worker saldano subito.
    // L'abort del chiamante NON avvelena il breaker condiviso: getJWRankings
    // esclude gli errori da caller-abort dal conteggio fallimenti (il timeout
    // interno upstream resta failure). Richiesta già abortita = zero fetch JW.
    const jwCtrl = new AbortController()
    const jwTimer = setTimeout(() => {
      jwCtrl.abort(new DOMException("Trending JW phase deadline exceeded", "TimeoutError"))
    }, TRENDING_JW_TIMEOUT_MS)
    const onPhaseAbort = () => {
      if (!jwCtrl.signal.aborted) {
        jwCtrl.abort(
          endpointCtrl.signal.reason instanceof Error
            ? endpointCtrl.signal.reason
            : new DOMException("Trending JW phase owner aborted", "AbortError"),
        )
      }
    }
    if (endpointCtrl.signal.aborted) onPhaseAbort()
    else endpointCtrl.signal.addEventListener("abort", onPhaseAbort, { once: true })
    const jwSignal = jwCtrl.signal
    let movieRanks: { tmdbId: number; rank: number }[]
    let tvRanks: { tmdbId: number; rank: number }[]
    try {
      if (endpointCtrl.signal.aborted) {
        // Navigazione già abortita: niente fetch posseduti, risposta degradata.
        degraded = true
        enrichmentTimedOut = true
        movieRanks = []
        tvRanks = []
      } else {
        ;[movieRanks, tvRanks] = await Promise.all([
          getJWRankings("MOVIE", country, 20, undefined, tmdbLang, jwSignal).catch((e) => {
            degraded = true
            if (isAbortLike(e)) enrichmentTimedOut = true
            log.warn("JW movie rankings failed", { error: e instanceof Error ? e.message : String(e), country })
            return [] as { tmdbId: number; rank: number }[]
          }),
          getJWRankings("SHOW", country, 20, undefined, tmdbLang, jwSignal).catch((e) => {
            degraded = true
            if (isAbortLike(e)) enrichmentTimedOut = true
            log.warn("JW show rankings failed", { error: e instanceof Error ? e.message : String(e), country })
            return [] as { tmdbId: number; rank: number }[]
          }),
        ])
      }
    } finally {
      clearTimeout(jwTimer)
      endpointCtrl.signal.removeEventListener("abort", onPhaseAbort)
      // Cancella il trasporto JW posseduto ancora appeso (post-deadline/owner
      // abort): niente socket zombie oltre la fase. A fase chiusa è no-op.
      jwCtrl.abort(new DOMException("Trending JW phase settled", "AbortError"))
    }
    const movieResults: TrendingItem[] = []
    const tvResults: TrendingItem[] = []
    // C3: getDetails/getImages del client condiviso (cache LRU 5min + inflight
    // coalescing) al posto dei fetch TMDB propri della route. Bonus: i dettagli
    // riscaldano la stessa cache che leggono i render poster (/movie/{id}?language=it-IT).
    //
    // I budget TMDB sono per-chiamata + signal di route: il leader del dedup
    // resta bounded, i waiter escono al proprio abort SENZA cancellare il
    // leader altrui (raceWithAbort in tmdb.ts — semantica condivisa invariata).
    const tmdbSignal = combineAbortSignals(req.signal ?? undefined, endpointCtrl.signal)
    // Ritorna anche `detailsClean`: true solo se i dettagli sono arrivati
    // PRIMA di qualsiasi abort. Alla deadline i dettagli già validi si
    // conservano (poster null) anche se il fallback immagini opzionale è
    // ancora appeso; un risultato la cui validità è post-abort si scarta
    // (niente item "tardivi" oltre la risposta).
    const enrichItem = async (tmdbId: number, mediaType: "movie" | "tv") => {
      // I dettagli sono obbligatori: dal solo rank non si inventano titoli —
      // un item senza dettagli si scarta (un outage parziale non blocca il batch).
      let details: Awaited<ReturnType<typeof getDetails>>
      try {
        details = await getDetails(mediaType, tmdbId, tmdbLang, apiKey, tmdbSignal, TRENDING_TMDB_TIMEOUT_MS)
      } catch (e) {
        // 404 = id rimosso da TMDB, fisiologico: skip silenzioso. Qualsiasi
        // altro errore (500/429/rete/abort/timeout/chiave) è outage parziale:
        // degrada (mai cache sano) — abort/timeout marcano anche incompleto.
        if (!isTmdbNotFound(e)) degraded = true
        if (isAbortLike(e) || tmdbSignal.aborted || endpointCtrl.signal.aborted) enrichmentTimedOut = true
        return null
      }
      const detailsClean = !tmdbSignal.aborted && !endpointCtrl.signal.aborted
      // Poster già nei dettagli → niente getImages (meno fetch, meno hang).
      // Fallback immagini solo quando serve, con budget proprio: un fallback
      // fallito NON scarta i dettagli validi.
      let poster = details.poster_path ?? null
      if (!poster) {
        try {
          const primary = tmdbLang.slice(0, 2).toLowerCase()
          const images = await getImages(mediaType, tmdbId, `${primary},en,null`, apiKey, tmdbSignal, TRENDING_TMDB_TIMEOUT_MS)
          poster = images?.posters?.[0]?.file_path || null
        } catch (e) {
          // Dettagli validi ma senza poster usabile: si tiene l'item (titolo +
          // date) invece di buttarlo — il client decide il placeholder. Solo
          // il 404 immagini è fisiologico; abort/timeout/500/rete degradano.
          if (!isTmdbNotFound(e)) degraded = true
          if (isAbortLike(e)) enrichmentTimedOut = true
          poster = null
        }
      }
      return {
        item: {
          id: tmdbId,
          media_type: mediaType,
          title: details.title,
          name: details.name,
          poster_path: poster,
          release_date: details.release_date,
          first_air_date: details.first_air_date,
        },
        detailsClean,
      }
    }
    // Pool UNICO e condiviso (max 4 item alla volta = max 8 fetch TMDB quando
    // scatta il fallback immagini): prima i film toroidalmente affamavano le
    // serie (pool film intero e POI pool serie). Coda interlacciata
    // film/serie per fairness deterministica; lo stop su abort è cooperativo
    // (niente dequeue/launch dopo la deadline) e i fetch partiti ricevono
    // l'abort reale via signal — mai Promise.race senza cancellazione.
    const queue: EnrichJob[] = []
    const maxRanks = Math.max(movieRanks.length, tvRanks.length)
    for (let i = 0; i < maxRanks; i++) {
      if (i < movieRanks.length) queue.push({ tmdbId: movieRanks[i].tmdbId, mediaType: "movie", rank: movieRanks[i].rank })
      if (i < tvRanks.length) queue.push({ tmdbId: tvRanks[i].tmdbId, mediaType: "tv", rank: tvRanks[i].rank })
    }
    let next = 0
    const workers = Array.from(
      { length: Math.min(TRENDING_ENRICH_CONCURRENCY, queue.length) },
      async () => {
        while (!tmdbSignal.aborted && !endpointCtrl.signal.aborted) {
          const job = queue[next++]
          if (!job) return
          const settled = await enrichItem(job.tmdbId, job.mediaType)
          if (!settled) continue
          // Niente mutazioni staccate dopo la risposta: a deadline scattata i
          // risultati tardivi si scartano — TRANNE gli item i cui dettagli
          // erano già validi prima dell'abort (checkpoint in enrichItem):
          // il parziale resta valido (poster null) invece di perdersi.
          // Niente validità post-abort accettata: `detailsClean` è misurato
          // sincrono alla resolve dei dettagli, mai dopo.
          if (tmdbSignal.aborted || endpointCtrl.signal.aborted) {
            if (!settled.detailsClean) continue
          }
          const target = job.mediaType === "movie" ? movieResults : tvResults
          target.push({ ...settled.item, rank: job.rank })
        }
      },
    )
    await Promise.all(workers)
    movieResults.sort((a, b) => a.rank - b.rank)
    tvResults.sort((a, b) => a.rank - b.rank)
    const body = { movies: movieResults, tv: tvResults }
    // Se c'erano rank ma non è stato arricchito nulla → probabile outage TMDB.
    // Una SEZIONE intera vuota (film ok, serie ferme o viceversa) è outage
    // parziale: parziale valido ma degradato, mai cacheato come sano.
    const movieSectionEmpty = movieRanks.length > 0 && movieResults.length === 0
    const tvSectionEmpty = tvRanks.length > 0 && tvResults.length === 0
    const emptyEnrichment = movieResults.length === 0 && tvResults.length === 0 && (movieRanks.length > 0 || tvRanks.length > 0)
    const incomplete = tmdbSignal.aborted || endpointCtrl.signal.aborted || enrichmentTimedOut
    if (degraded || emptyEnrichment || movieSectionEmpty || tvSectionEmpty || incomplete) {
      // Fix M12: flag esplicito — prima la risposta era 200 con array vuoti e
      // i client/CDN la trattavano come "niente in evidenza". Con `degraded`
      // il client può mostrare uno stato di outage invece di una home vuota.
      log.warn("Trending degraded — response not cached", { country, movies: movieResults.length, tv: tvResults.length })
      return jsonGzip({ ...body, degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
    }
    cacheSet(cacheKey, body, ["tmdb", "trending", country])
    return jsonGzip({ ...body, degraded: false }, 200, { "Cache-Control": "public, max-age=300, s-maxage=1800" }, acceptEncoding)
  } catch (err) {
    log.error("Trending fetch failed", { error: err instanceof Error ? err.message : String(err) })
    return jsonGzip({ movies: [], tv: [], degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
  } finally {
    clearTimeout(endpointTimer)
    req.signal.removeEventListener("abort", onReqAbort)
  }
}
