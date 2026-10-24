import { NextRequest } from "next/server"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import { resolveRankingSource } from "@/lib/ranking-source"
import { findRankingCustomCatalog } from "@/lib/custom-ranking"
import { getDetails, getImages, resolveUserApiKeys } from "@/lib/tmdb"
import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { decodeConfig } from "@/lib/config-token"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getRegionDef, normalizeRegion, parseRegion, GLOBAL_REGION_CODE } from "@/lib/regions"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { CHART_LIVE_PIN_ID, pinChartFamily, pinnedFamilyRows, type ChartFamilyPin } from "@/lib/chart-generation"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { jsonGzip } from "@/lib/json-response"
import { combineAbortSignals } from "@/lib/abort-signal"
import crypto from "node:crypto"
import {
  TRENDING_ENDPOINT_TIMEOUT_MS,
  TRENDING_ENRICH_CONCURRENCY,
  TRENDING_JW_TIMEOUT_MS,
  TRENDING_TMDB_TIMEOUT_MS,
} from "@/lib/trending-budgets"

const log = createLogger("trending")

// Mutable-selection HTTP caching (same precedent as /api/trending/rank):
// the preview body resolves server-side from the namespace (`?u=`), the
// `?config=` token, or the mutable global defaults, so the URL does not
// version the selection — except an explicit `?config=` token, which travels
// in the URL. The automatic hook GET carries no `&_t` cache-buster (only the
// manual refresh does), so a `public` Cache-Control would let shared
// (CDN/proxy) caches — and the browser HTTP cache at the same URL — serve
// the previous source's body after a save ("switch shows same titles until
// manual refresh"). All healthy branches therefore stay out of shared caches
// (`private, no-cache`, token branch included for consistency); the
// server-side app cache above still absorbs upstream cost (headers only, no
// data-cache change). Explicit failures stay `no-store` and are never cached
// anywhere.
const mutablePreviewHeaders = { "Cache-Control": "private, no-cache, must-revalidate" }

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

/** Hash breve e stabile per i cache key — mai il frammento grezzo. */
function hashFragment(value: string | undefined): string {
  return value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 8) : "none"
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
  // Scoped ranking selection (same contract as /api/trending/rank and the
  // Stremio catalogs): `?u=` (user space) and `?config=` (device token, wins
  // over the namespace). Without either, the global selection applies.
  const userParam = req.nextUrl.searchParams.get("u") ?? req.nextUrl.searchParams.get("user")
  const configParam = req.nextUrl.searchParams.get("config") ?? req.nextUrl.searchParams.get("c")
  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  const tokenConfig = configParam ? decodeConfig(configParam) : null
  const namespaceDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : getServerDefaults()
  const selection = {
    customCatalogs: tokenConfig?.customCatalogs ?? namespaceDefaults.customCatalogs,
    rankingSourceMovie: tokenConfig?.rankingSourceMovie ?? namespaceDefaults.rankingSourceMovie,
    rankingSourceSeries: tokenConfig?.rankingSourceSeries ?? namespaceDefaults.rankingSourceSeries,
  }
  const movieSource = resolveRankingSource(selection, "movie")
  const seriesSource = resolveRankingSource(selection, "series")
  const movieCustom = movieSource.kind === "custom"
    ? findRankingCustomCatalog(selection.customCatalogs, movieSource.customId)
    : undefined
  const seriesCustom = seriesSource.kind === "custom"
    ? findRankingCustomCatalog(selection.customCatalogs, seriesSource.customId)
    : undefined
  const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = resolvedKeys.tmdb.key
  // Regione classifica: `?region=`/`?country=` > default server > IT (fail-closed su IT).
  const region = getRegionDef(parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country")) ?? normalizeRegion(namespaceDefaults.region))
  const country = region.code
  const tmdbLang = region.lang
  // v2: la lingua di arricchimento segue la regione — le entry v1 (sempre it-IT)
  // non devono avvelenare le richieste non italiane.
  //
  // Source-aware cache key: the default charts scope keeps the legacy key
  // byte-identically (`trending:v2:<country>`); any effective non-charts
  // selection (namespace, token or global defaults) extends it with per-slot
  // source fragments plus scope/credential hashes, so switching the Top 20
  // source never serves the previous source's body (and custom lists stay
  // isolated per payload-changing credentials).
  const movieFrag = movieSource.kind === "custom" && movieCustom
    ? `rsm${hashFragment(`${movieSource.customId}:${movieCustom.url}:${movieCustom.datasetId ?? ""}`)}`
    : movieSource.kind === "justwatch" && movieSource.mode !== "charts"
      ? `rsm_jw_${movieSource.mode}`
      : "rsm_jw"
  const seriesFrag = seriesSource.kind === "custom" && seriesCustom
    ? `rss${hashFragment(`${seriesSource.customId}:${seriesCustom.url}:${seriesCustom.datasetId ?? ""}`)}`
    : seriesSource.kind === "justwatch" && seriesSource.mode !== "charts"
      ? `rss_jw_${seriesSource.mode}`
      : "rss_jw"
  const isDefaultScope = movieFrag === "rsm_jw" && seriesFrag === "rss_jw" && !scopedUser && !configParam
  let cacheKey = `trending:v2:${country}`
  if (!isDefaultScope) {
    cacheKey += `:${movieFrag}:${seriesFrag}`
    if (scopedUser) cacheKey += `:u${hashFragment(scopedUser)}`
    if (configParam) cacheKey += `:cfg${hashFragment(configParam)}`
    if (movieCustom || seriesCustom) {
      cacheKey += `:ak${hashFragment(resolvedKeys.tmdb.key)}:mk${hashFragment(resolvedKeys.mdblist.key)}:vk${hashFragment(resolvedKeys.tvdb.key)}`
    }
  }
  const acceptEncoding = req.headers.get("accept-encoding")

  // Deadline di endpoint: timer esplicito (non AbortSignal.timeout) così i
  // test lo controllano col fake clock; combined col signal del client per i
  // fetch TMDB posseduti dalla route. Cleanup nel finally: niente timer zombie
  // né worker residui dopo la risposta.
  //
  // Confine onesto del budget: i 20s coprono fase JW + arricchimento. La fase
  // prima del timer (rate-limit, risoluzione chiave) è fuori budget ma bounded
  // a parte: rate-limit in-memory sync (KV solo con store configurato,
  // comandi con hard timeout + fallback fail-open in kv.ts), chiavi da
  // header/query/env sync e da file locale (solo con `?u=`). La lookup cache
  // sta DOPO il pin delle famiglie (sotto): una body pre-fix sotto la vecchia
  // generazione non deve servire oltre il publish (Lupin FIRST vs 12th).
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
    // davvero il trasporto posseduto (ogni ranking fetch fa il suo fetch,
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
    // Aborted upfront: zero chart I/O (same contract as the old live path —
    // no pin refresh attempt, no fetch launch). The resolve step below falls
    // back to live fetches that abort immediately with zero transport.
    const preAborted = endpointCtrl.signal.aborted
    const livePin: ChartFamilyPin = { id: CHART_LIVE_PIN_ID, snapshot: null }
    // Canonical-window pins BEFORE the cache lookup (Lupin repro): the UI
    // must read the SAME published generations the Stremio catalogs serve.
    // A pre-fix live body cached under this key must not serve past a publish.
    const jwFamilyFor = (slot: "movie" | "series"): string | null => {
      const source = slot === "movie" ? movieSource : seriesSource
      if (source.kind !== "justwatch") return null
      const mode = source.mode ?? "charts"
      if ((mode === "popular" || mode === "trending") && country.toUpperCase() === GLOBAL_REGION_CODE) return null
      return `jw:${slot === "movie" ? "movie" : "series"}:${mode}`
    }
    const movieFamily = jwFamilyFor("movie")
    const seriesFamily = jwFamilyFor("series")
    const pinSlot = async (family: string | null): Promise<ChartFamilyPin> => {
      if (!family) return { id: CHART_LIVE_PIN_ID, snapshot: null }
      try {
        return await ensureFreshChartFamily({
          regionCode: country,
          regionLang: tmdbLang,
          tmdbLang,
          family,
          signal: jwSignal,
        })
      } catch {
        try {
          return await pinChartFamily({ regionCode: country, regionLang: tmdbLang, family })
        } catch {
          return { id: CHART_LIVE_PIN_ID, snapshot: null }
        }
      }
    }
    const [moviePin, seriesPin] = preAborted
      ? [livePin, livePin]
      : await Promise.all([pinSlot(movieFamily), pinSlot(seriesFamily)])
    // Generation-fenced lookup: the key stays source-scoped (legacy
    // `trending:v2:<country>` byte-identical), the payload carries the actual
    // pinned generations — a hit from a previous generation is a miss.
    // Publication metadata (T1 backend contract): per-slot last successful
    // publication time (snapshot.publishedAt, ms epoch) — Pictorium's
    // publication, NOT the source's update time, NOT the request time.
    // Null when the slot has no genuine pin (custom/unsupported/live).
    // Cache hits do NOT retimestamp; outage retention keeps the old stamp;
    // an actual empty publish carries its new timestamp.
    type TrendingCached = { movies: TrendingItem[]; tv: TrendingItem[]; gen?: { movie: string; series: string }; updatedAt?: { movie: number | null; series: number | null } }
    const cached = cacheGet<TrendingCached>(cacheKey)
    if (cached && cached.gen && cached.gen.movie === moviePin.id && cached.gen.series === seriesPin.id) {
      clearTimeout(jwTimer)
      endpointCtrl.signal.removeEventListener("abort", onPhaseAbort)
      clearTimeout(endpointTimer)
      req.signal.removeEventListener("abort", onReqAbort)
      return jsonGzip({ movies: cached.movies, tv: cached.tv, updatedAt: cached.updatedAt }, 200, mutablePreviewHeaders, acceptEncoding)
    }
    let movieRanks: { tmdbId: number; rank: number }[]
    let tvRanks: { tmdbId: number; rank: number }[]
    // Top 20 ranking resolution: pinned canonical window for JustWatch
    // (charts/popular/trending) — same generations as the Stremio catalogs.
    // Custom keeps the live shared service (no chart family). A genuine
    // published EMPTY serves [] with NO live fallback (else resurrection);
    // only a cold miss (no snapshot) falls back to live per historic contract.
    // On refresh failure the pin above already holds the last good snapshot,
    // which is served here — never a live refetch over it.
    const resolveSlotRanks = async (
      slot: "movie" | "series",
      label: string,
    ): Promise<{ tmdbId: number; rank: number }[]> => {
      const source = slot === "movie" ? movieSource : seriesSource
      if (source.kind === "justwatch") {
        const mode = source.mode ?? "charts"
        if ((mode === "popular" || mode === "trending") && country.toUpperCase() === GLOBAL_REGION_CODE) {
          return []
        }
        const pin = slot === "movie" ? moviePin : seriesPin
        if (pin.snapshot != null) {
          const rows = pinnedFamilyRows(pin) ?? []
          return rows.map((r) => ({ tmdbId: r.tmdbId, rank: r.rank }))
        }
        // Cold miss: fall through to the live fetch below.
      }
      try {
        const res = await fetchTop20Ranking({
          slot,
          source,
          regionCode: country,
          regionLang: tmdbLang,
          customCatalogs: selection.customCatalogs,
          apiKey,
          mdblistKey: resolvedKeys.mdblist.key,
          tvdbKey: resolvedKeys.tvdb.key,
          userId: scopedUser,
          signal: jwSignal,
        })
        if (res.status === "error") {
          degraded = true
          log.warn("Top 20 custom ranking failed", { error: res.errorStatus, country, slot })
          return []
        }
        return res.items.map((r) => ({ tmdbId: r.tmdbId, rank: r.rank }))
      } catch (e) {
        degraded = true
        if (isAbortLike(e)) enrichmentTimedOut = true
        log.warn(`JW ${label} rankings failed`, { error: e instanceof Error ? e.message : String(e), country })
        return []
      }
    }
    try {
      if (endpointCtrl.signal.aborted) {
        // Navigazione già abortita: niente fetch posseduti, risposta degradata.
        degraded = true
        enrichmentTimedOut = true
        movieRanks = []
        tvRanks = []
      } else {
        ;[movieRanks, tvRanks] = await Promise.all([
          resolveSlotRanks("movie", "movie"),
          resolveSlotRanks("series", "show"),
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
    const updatedAt = {
      movie: moviePin.snapshot?.publishedAt ?? null,
      series: seriesPin.snapshot?.publishedAt ?? null,
    }
    const body = { movies: movieResults, tv: tvResults, gen: { movie: moviePin.id, series: seriesPin.id }, updatedAt }
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
      return jsonGzip({ movies: body.movies, tv: body.tv, updatedAt: body.updatedAt, degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
    }
    cacheSet(cacheKey, body, ["tmdb", "trending", country])
    return jsonGzip({ movies: body.movies, tv: body.tv, updatedAt: body.updatedAt, degraded: false }, 200, mutablePreviewHeaders, acceptEncoding)
  } catch (err) {
    log.error("Trending fetch failed", { error: err instanceof Error ? err.message : String(err) })
    return jsonGzip({ movies: [], tv: [], degraded: true }, 200, { "Cache-Control": "no-store" }, acceptEncoding)
  } finally {
    clearTimeout(endpointTimer)
    req.signal.removeEventListener("abort", onReqAbort)
  }
}
