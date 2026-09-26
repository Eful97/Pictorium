import { createLogger } from "./logger"
import { getJWTitleQualityResult } from "./justwatch"
import { getExternalIds } from "./tmdb"
import { envWithFallback } from "./env-compat"
import { timedFetch } from "./outbound-stats"

const log = createLogger("stream-quality")

// Tier/soglia in quality-tiers.ts (zero dipendenze): qui solo re-export per
// compatibilità degli import esistenti (+ import type per l'uso locale).
import type { StreamQuality } from "./quality-tiers"
export type { StreamQuality } from "./quality-tiers"
export { parseMinQuality, isQualityAtLeast, applyMinQuality } from "./quality-tiers"

const TORRENTIO_BASE_URL = (envWithFallback("TORRENTIO_URL") || process.env.TORRENTIO_URL || "https://torrentio.strem.fun").replace(/\/+$/, "")
const STREAM_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const STREAM_CACHE_TTL_NULL = 2 * 60 * 1000 // 2 minutes for null (evita cache avvelenata su Vercel)

// Sorgente qualità (v1.23.0): "torrentio" (default, catena attuale con
// fallback JW), "justwatch" (solo JW, niente Torrentio), "none" (nessun
// provider: badge mai mostrato, zero upstream). A module level: restart.
const QUALITY_SOURCE = (envWithFallback("QUALITY_SOURCE") || "torrentio").toLowerCase().trim()

// Esito del rilevamento qualità: "resolved" = chiamata completata (anche con
// quality null = esito negativo accertato, es. film 1950 senza stream);
// "timeout" = abort per deadline; "error" = HTTP non-OK / rete. Solo
// resolved-null può cachare a lungo: timeout/error danno render degradato con
// TTL effimero (vedi route poster), altrimenti un outage di 10s avvelena la
// cache per 6h.
export type QualityStatus = "resolved" | "timeout" | "error"
export type QualitySource = "torrentio" | "justwatch" | "none"

export interface StreamQualityResult {
  readonly quality: StreamQuality | null
  readonly status: QualityStatus
  readonly source: QualitySource
  readonly rawTokens?: string[]
}

const qualityCache = new Map<string, { quality: StreamQualityResult; timestamp: number }>()
// Entry da ~100B ma chiavi per-titolo: cap FIFO per i processi long-running.
const STREAM_QUALITY_CACHE_MAX = 2000
function qualityCacheSet(key: string, value: { quality: StreamQualityResult; timestamp: number }): void {
  if (qualityCache.size >= STREAM_QUALITY_CACHE_MAX) qualityCache.delete(qualityCache.keys().next().value!)
  qualityCache.set(key, value)
}

/** True se l'errore è uno scatto di deadline (AbortSignal.timeout / race). */
export function isQualityTimeout(err: unknown): boolean {
  // DOMException di abort/timeout (fetch): in Node NON è instanceof Error,
  // quindi il check sul nome viene prima e copre entrambi i nomi standard.
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return true
  if (typeof DOMException !== "undefined" && (err as DOMException)?.name === "AbortError") return true
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true
    if (/aborted|timeout|timed out/i.test(err.message)) return true
  }
  return false
}

/** Token grezzi (es. ["2160p","4k"]) dal testo degli stream — solo debug=1. */
export function extractRawQualityTokens(
  streams: Array<{ name?: string; title?: string; behaviorHints?: { filename?: string; bingeGroup?: string } }>,
): string[] {
  const found = new Set<string>()
  if (!Array.isArray(streams)) return []
  for (const s of streams) {
    const text = `${s.name || ""} ${s.title || ""} ${s.behaviorHints?.filename || ""} ${s.behaviorHints?.bingeGroup || ""}`
    for (const m of text.matchAll(/\b(2160[pi]?|1080[pi]?|fhd|fullhd|720[pi]?|hdtv|hd|480[pi]?|576[pi]?|sd|dvdrip|cam|ts)\b/gi)) {
      found.add(m[1].toLowerCase())
    }
    // Token 4K attaccati (4KHDR, 4kDV, 2160pHDR, UHD4K…): il \b fallisce tra
    // due word-char, quindi substring sul testo normalizzato.
    const low = text.toLowerCase().replace(/[._\-+]+/g, " ")
    if (low.includes("2160")) found.add("2160p")
    if (low.includes("4k")) found.add("4k")
    if (low.includes("uhd")) found.add("uhd")
  }
  return [...found]
}

const STREAM_TIER_RANK: Record<StreamQuality, number> = { SD: 0, HD: 1, FHD: 2, "4K": 3 }

/**
 * Qualità di un singolo stream. Regola unica: la risoluzione numerica
 * esplicita vince sulla parola di sorgente — un `UHD BluRay 1080p` o un
 * `4K Remaster 1080p` è un file 1080p (FHD), non un 4K. I token 4K attaccati
 * (4KHDR, 2160pHDR…) sono rilevati via substring perché `\b` fallisce tra
 * word-char. I campi strutturati di Torrentio (name `Torrentio\n1080p`,
 * bingeGroup `torrentio|1080p|…`) partecipano già concatenati: nessuna
 * priorità speciale da mantenere, la regola numerica copre i conflitti.
 */
export function parseSingleStreamQuality(
  s: { name?: string; title?: string; behaviorHints?: { filename?: string; bingeGroup?: string } }
): StreamQuality | null {
  const raw = `${s?.name || ""} ${s?.title || ""} ${s?.behaviorHints?.filename || ""} ${s?.behaviorHints?.bingeGroup || ""}`
  const text = raw.toLowerCase().replace(/[._\-+]+/g, " ")
  if (text.includes("2160")) return "4K"
  if (/\b(1080[pi]?|fhd|fullhd)\b/.test(text)) return "FHD"
  if (/\b(720[pi]?|hd|hdtv)\b/.test(text)) return "HD"
  if (/\b(480[pi]?|576[pi]?|sd|dvdrip|cam|ts)\b/.test(text)) return "SD"
  if (text.includes("4k") || text.includes("uhd")) return "4K"
  return null
}

export function parseStreamQualityFromStreams(
  streams: Array<{ name?: string; title?: string; behaviorHints?: { filename?: string; bingeGroup?: string } }>
): StreamQuality | null {
  if (!Array.isArray(streams) || streams.length === 0) return null

  let best: StreamQuality | null = null
  for (const s of streams) {
    const q = parseSingleStreamQuality(s)
    if (q && (best === null || STREAM_TIER_RANK[q] > STREAM_TIER_RANK[best])) {
      if (q === "4K") return "4K"
      best = q
    }
  }
  return best
}

export async function fetchTorrentioQuality(
  type: "movie" | "series",
  imdbId: string,
  signal?: AbortSignal,
  season?: number | null,
  episode?: number | null
): Promise<StreamQualityResult> {
  const streamId = type === "movie" ? imdbId : `${imdbId}:${season ?? 1}:${episode ?? 1}`
  const url = `${TORRENTIO_BASE_URL}/stream/${type}/${encodeURIComponent(streamId)}.json`
  try {
    const timeoutSignal = AbortSignal.timeout(6000)
      let combinedSignal: AbortSignal = timeoutSignal
      if (signal) {
        if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
          combinedSignal = (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
        } else {
          // Fallback Node <19: combina manualmente i signal
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

      const res = await timedFetch(url, {
        headers: { "User-Agent": "Pictorium/1.0" },
        signal: combinedSignal,
      })
      if (!res.ok) {
        log.debug("Torrentio non-OK", { imdbId, status: res.status })
        return { quality: null, status: "error", source: "torrentio" }
      }
      const data = await res.json()
      const q = parseStreamQualityFromStreams(data?.streams)
      if (q) log.debug("Torrentio quality", { imdbId, quality: q })
      return { quality: q, status: "resolved", source: "torrentio", rawTokens: extractRawQualityTokens(data?.streams ?? []) }
    } catch (err) {
      log.debug("Torrentio stream quality check failed or timed out", { imdbId, error: err instanceof Error ? err.message : String(err) })
      return { quality: null, status: isQualityTimeout(err) ? "timeout" : "error", source: "torrentio" }
    }
}

export async function resolveStreamQuality(
  type: "movie" | "series",
  imdbId?: string | null,
  tmdbId?: number | null,
  searchTitle?: string | null,
  signal?: AbortSignal,
  seasonCount?: number | null,
  /** Paese JustWatch (default "IT"): la qualità streaming dipende dal catalogo regionale. */
  region?: string | null,
): Promise<StreamQualityResult> {
  const lastSeason = seasonCount != null ? Math.trunc(seasonCount) : NaN
  const seasonSuffix = type === "series" && Number.isFinite(lastSeason) && lastSeason > 0 ? `:s${lastSeason}` : ""
  const cacheKey = `${type}:${imdbId || tmdbId || searchTitle}${seasonSuffix}`
  const cached = qualityCache.get(cacheKey)
  if (cached) {
    // TTL differenziato per esito: resolved (anche null) 30min, timeout/error
    // 2min — un outage non deve restare appiccicato alla chiave.
    const ttl = cached.quality.status === "resolved" ? STREAM_CACHE_TTL : STREAM_CACHE_TTL_NULL
    if (Date.now() - cached.timestamp < ttl) return cached.quality
  }

  const store = (r: StreamQualityResult): StreamQualityResult => {
    qualityCacheSet(cacheKey, { quality: r, timestamp: Date.now() })
    return r
  }

  // Sorgente "none": nessun provider, esito negativo accertato senza rete.
  if (QUALITY_SOURCE === "none") {
    return store({ quality: null, status: "resolved", source: "none" })
  }
  const useTorrentio = QUALITY_SOURCE !== "justwatch"

  // 1. Try Torrentio via IMDb ID
  let targetImdbId = imdbId
  if (!targetImdbId && tmdbId) {
    try {
      // A3: signal + tetto 8s (come POSTER_TMDB_TIMEOUT_MS) — prima senza
      // entrambi: un TMDB appeso teneva lo slot di render fino a 30s.
      const ext = await getExternalIds(type === "movie" ? "movie" : "tv", tmdbId, undefined, signal, 8000)
      if (ext.imdb_id) targetImdbId = ext.imdb_id
    } catch {}
  }

  let torrentioFailure: StreamQualityResult | null = null
  if (useTorrentio && targetImdbId && targetImdbId.startsWith("tt")) {
    const t = await fetchTorrentioQuality(type, targetImdbId, signal)
    if (t.status === "resolved") {
      let best = t.quality
      let tokens = t.rawTokens ?? []
      // Serie multi-stagione: S01E01 in FHD non esclude 4K dopo — un solo
      // fetch extra sull'ultima stagione (solo Torrentio, mai JW: il badge
      // promette ciò che è riproducibile su Stremio). Solo se S01 è resolved
      // (su timeout/error il secondo fetch fallirebbe uguale: niente raddoppio
      // della latenza) e non è già 4K.
      if (type === "series" && Number.isFinite(lastSeason) && lastSeason > 1 && t.quality !== "4K") {
        const last = await fetchTorrentioQuality(type, targetImdbId, signal, lastSeason, 1).catch(() => null)
        if (last && last.status === "resolved" && last.quality) {
          const merged = [...new Set([...tokens, ...(last.rawTokens ?? [])])]
          if (last.quality === "4K") {
            return store({ quality: "4K", status: "resolved", source: "torrentio", rawTokens: merged })
          }
          if (best === null || STREAM_TIER_RANK[last.quality] > STREAM_TIER_RANK[best]) {
            best = last.quality
            tokens = merged
          }
        }
        // Extra fetch fallito/timeout → ignorato: resta l'esito di S01.
      }
      if (best) return store({ quality: best, status: "resolved", source: "torrentio", rawTokens: tokens })
      // 200 con streams vuoti = resolved-null (esito negativo accertato): il
      // fallback JW può ancora arricchire, ma se non trova nulla resta resolved.
    } else {
      torrentioFailure = t
    }
  }

  // 2. Fallback to JustWatch GraphQL if Torrentio returned nothing and tmdbId is present
  if (tmdbId) {
    try {
      const jw = await getJWTitleQualityResult(
        tmdbId,
        type === "movie" ? "MOVIE" : "SHOW",
        searchTitle,
        region || "IT",
        signal
      )
      if (jw.quality) {
        // Qualità accertata da JW → resolved con TTL pieno (v1.23.0): il
        // vecchio status ereditato dal failure Torrentio dimezzava la cache
        // a 2min anche a qualità certa.
        return store({ quality: jw.quality, status: "resolved", source: "justwatch" })
      }
      // ok=false (breaker aperto o trasporto fallito) = incertezza, NON miss:
      // resta l'eventuale failure di Torrentio, altrimenti error effimero.
      // Solo ok=true con quality null è esito negativo accertato.
      if (!jw.ok) {
        return store(torrentioFailure ?? {
          quality: null,
          status: signal?.aborted ? "timeout" : "error",
          source: "justwatch",
        })
      }
      return store(torrentioFailure ?? { quality: null, status: "resolved", source: targetImdbId ? "torrentio" : "justwatch" })
    } catch (err) {
      return store(torrentioFailure ?? { quality: null, status: isQualityTimeout(err) ? "timeout" : "error", source: "justwatch" })
    }
  }

  return store(torrentioFailure ?? { quality: null, status: "resolved", source: "none" })
}

export function __resetStreamQualityCache() {
  qualityCache.clear()
}
