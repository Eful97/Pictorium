import type { NextRequest } from "next/server"
import { createLogger } from "@/lib/logger"
import { hardenPosterSearchParams, isPresetsPosterMode, isPublicPosterInstance } from "@/lib/poster-params-hardening"
import {
  RENDER_SLOT_WAIT_MS,
  canServePosterStaleHit,
  httpRemainingSec,
  normalizePosterCacheParams,
  posterNotModifiedHeaders,
  posterResponse,
  readCachedPoster,
  readPosterError,
  recordPosterLatency,
  recordPosterRequest,
  recordPosterStaleHit,
  resolveImageFormat,
  schedulePosterRefresh,
  serverTimingValue,
  type PosterCachePayload,
  type PosterErrorStatus,
} from "@/lib/poster-runtime-cache"
import { DEMOSAMPLES_FLAG, isDemoSamplesRequest } from "@/lib/demo-samples"
import { hashUserFragment } from "@/lib/cache"
import type { Mapping } from "@/lib/types"

export type ServeResponseVariant = (
  canonical: PosterCachePayload,
  opts?: { ttlMs?: number; immutable?: boolean; factCapped?: boolean; expiresAt?: number },
  latencyOrigin?: "cached" | "render" | "skip",
) => Promise<Response>

/** Contesto condiviso dei lookup di cache (memory cache check di GET). */
export interface PosterCacheLookupContext {
  req: NextRequest
  mediaType: "movie" | "tv"
  tmdbId: number
  startTime: number
  isPreview: boolean
  isConditional: boolean
  ifNoneMatch: string | null
  isLive: boolean
  wantNetGeo: boolean
  refreshRequest: boolean
  needsVariant: boolean
  outputFormat: ReturnType<typeof resolveImageFormat>
  variantKey: string
  cacheKey: string
  variantTtlSec: number | undefined
  dynamicTtlSec: number | undefined
  dynamicPoster: boolean
  immutablePoster: boolean
  serveResponseVariant: ServeResponseVariant
}

const log = createLogger("poster")

export function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }
}

// Risposta di errore coerente per 500/503 con Retry-After esplicito sul 503
// (F5/F8): la CDN/Stremio fa backoff invece di rimbalzare subito sull'endpoint.
// Il body è generico: il 503 copre sia slot esauriti sia deadline/upstream
// lento (fix H3), non solo il busy da render concorrenti.
export function posterErrorResponse(status: PosterErrorStatus): Response {
  if (status === 503) {
    return new Response("Poster temporarily unavailable", {
      status: 503,
      headers: { ...corsHeaders(), "Retry-After": String(Math.max(1, Math.round(RENDER_SLOT_WAIT_MS / 1000))) },
    })
  }
  if (status === 404) {
    return new Response("Poster not found", { status: 404, headers: corsHeaders() })
  }
  return new Response("Poster generation failed", { status: 500, headers: corsHeaders() })
}

/**
 * Phase 2a: parametri di cache (hardening anti cache-busting, quality/lang
 * canonici, namespace utente, segreti rimossi). Estratto verbatim da GET.
 */
export function buildPosterCacheParams(
  req: NextRequest,
  input: {
    isPreview: boolean
    rawPreview: boolean
    previewUnlocked: boolean
    scopedUser: string | null
    mapping: Mapping | null
    earlyEffMapping: Mapping | null
    canonicalQuality: string | null
    canonicalLang: string | null
    effMdblistKey: string | null | undefined
    effSimklKey: string | null | undefined
  },
): { hardenedParams: URLSearchParams; cacheParams: URLSearchParams; demoSamples: boolean; wantAccentMeta: boolean } {
  const { isPreview, rawPreview, previewUnlocked, scopedUser, mapping, earlyEffMapping, canonicalQuality, canonicalLang, effMdblistKey, effSimklKey } = input
  // Hardening anti cache-busting (v1.23.0): con presets attivi le richieste
  // non-preview collassano su un set finito di render (quantize numerici +
  // palette ac + extra canonico dal mapping + strip override keyless su
  // pubbliche anonime). Preview WYSIWYG e istanze private passano intatte.
  // `hardenedParams` alimenta chiave di cache E render così non divergono;
  // il resto legge la query originale (parametri funzionali intatti).
  const hardenedParams = hardenPosterSearchParams(req.nextUrl.searchParams, {
    presets: isPresetsPosterMode(),
    preview: isPreview,
    // F3: strip override keyless su pubbliche anonime. Uno spazio esistente
    // resta "anonimo" per l'hardening quando la sessione non è sbloccata
    // (bare ?u= non è prova): stesso predicato usato per il preview downgrade.
    // Phantom UUID già collassati a null sopra (scopedUser null).
    anonymous: !scopedUser || !previewUnlocked,
    publicInstance: isPublicPosterInstance(),
    hasMapping: !!mapping,
    mappingCustomBadge: earlyEffMapping?.customBadge ?? null,
    // Un mapping con logo disattivato non deve resuscitare il proprio
    // wordmark via hardening (la canonicalizzazione presets è trasparente:
    // deve portare allo STESSO render del mapping salvato).
    mappingLogoText: earlyEffMapping?.logoDisabled ? null : (earlyEffMapping?.logoText ?? null),
    mappingLogoFont: earlyEffMapping?.logoFont ?? null,
  })
  // Preview declassata (blindatura opt-in): senza il flag la chiave resterebbe
  // separata dalle anonime — rimuovendolo condivide la entry canonica.
  if (rawPreview && !isPreview) hardenedParams.delete("preview")
  // Demo samples (Settings defaults preview only): accepted solely on an
  // effective preview with the explicit flag. A downgraded preview drops it
  // so the entry collapses to the canonical key (same render, no split).
  const demoSamples = isDemoSamplesRequest({ isPreview, flag: hardenedParams.get(DEMOSAMPLES_FLAG) })
  if (!isPreview) hardenedParams.delete(DEMOSAMPLES_FLAG)
  // Effective-accent display sync (`?accentmeta=1`, server-only Stage 1): a
  // read-only JSON branch served below from the SAME canonical key. The flag
  // is the ONLY param stripped here (mirror of the L479 preview-delete
  // pattern): preview/tl/bl/config and every render input stay in the key, so
  // the metadata key is byte-identical to the image key — including the
  // preview-downgrade path above, which applies equally to both.
  const wantAccentMeta = req.nextUrl.searchParams.get("accentmeta") === "1"
  hardenedParams.delete("accentmeta")
  // `quality`/`lang` parity: the canonical value computed above is written into
  // the hardened copy BEFORE the cache key, so key and render read the same
  // bytes (hardening already canonicalizes them in presets mode; this keeps
  // preview/private requests on the identical value instead of the raw one).
  if (canonicalQuality) hardenedParams.set("quality", canonicalQuality)
  else hardenedParams.delete("quality")
  if (canonicalLang) hardenedParams.set("lang", canonicalLang)
  else hardenedParams.delete("lang")
  const cacheParams = normalizePosterCacheParams(hardenedParams)
  cacheParams.delete("config")
  cacheParams.delete("c")
  if (scopedUser) {
    // Il namespace entra come hash a 64-bit (mai in chiaro): senza, B
    // servirebbe il render cachato di A. Con flag OFF resta il delete storico.
    cacheParams.set("u", hashUserFragment(scopedUser))
    cacheParams.delete("user")
  } else {
    cacheParams.delete("u")
    cacheParams.delete("user")
  }
  // Removed Badge Lab: the custom badge library is retired. Legacy query
  // values (`badgePreset`/`prv`/`pt`/`bp`/`bpf`/`bpt`) and persisted mapping
  // fields (`badgePresetId`/`badgePresetRev`/`badgePresets`/`badgePresetFollows`)
  // are inert: no store reads, no substitution, no cache-key fragments — old
  // URLs and saved bindings collapse onto the native render. Persisted fields
  // stay stored untouched (never deleted); they simply no longer affect keys
  // or pixels.
  cacheParams.delete("badgePreset")
  cacheParams.delete("prv")
  cacheParams.delete("pt")
  cacheParams.delete("bp")
  cacheParams.delete("bpf")
  cacheParams.delete("bpt")
  // api_key non influisce sul rendering: rimuoverla evita frammentazione della
  // cache per utente e segreti in memoria nelle chiavi.
  cacheParams.delete("api_key")
  // B1-bis come tvdb_key: la chiave MDBList è un segreto e non entra mai in
  // chiaro nella cache key (prima frammentava la cache per chiave e restava
  // in memoria in chiaro). Il flag `mdb=1` separa le entry con rating
  // aggregati attivi da quelle senza — l'output a parità di dati non dipende
  // dalla chiave (solo accesso upstream), quindi niente frammentazione.
  cacheParams.delete("mdblist_key")
  if (effMdblistKey) cacheParams.set("mdb", "1")
  cacheParams.delete("simkl_key")
  if (effSimklKey) cacheParams.set("simkl", "1")
  // La chiave TVDB non entra mai in chiaro nella cache key (segreto in
  // memoria). Il poster automatico non usa più TVDB (rescue rimosso: la
  // selezione TVDB è solo manuale), quindi nessun flag server-side.
  cacheParams.delete("tvdb_key")
  cacheParams.delete("tvdb")
  if (typeof cacheParams.sort === "function") cacheParams.sort()
  return { hardenedParams, cacheParams, demoSamples, wantAccentMeta }
}


/**
 * Phase 3a: fast-path variante (formato non canonico). Estratto verbatim da GET.
 * Ritorna la Response se servita, altrimenti null (GET prosegue col canonico).
 */
export function checkPosterVariantFastPath(ctx: PosterCacheLookupContext): Response | null {
  const {
    req, mediaType, tmdbId, startTime, isPreview, isConditional, ifNoneMatch, isLive, wantNetGeo,
    refreshRequest, needsVariant, outputFormat, variantKey, variantTtlSec,
    dynamicPoster, immutablePoster,
  } = ctx
  // 3. Memory cache check
  // Copia fresca + ETag corrispondente → 304 senza rendering; fresca + ETag
  // diverso → 200. Copia scaduta + condizionale (o live=1) → rivalidazione
  // completa sotto, MAI 304 sulla copia scaduta (audit, problema 2). Solo le
  // non condizionali fuori dal live conservano lo SWR (copia + refresh).
  // C3: la variante ha fast-path dedicato; il canonico resta il
  // fallback (conversione) quando la variante è assente/scadata.
  if (needsVariant && !refreshRequest) {
    const variantHitNow = Date.now()
    const variantHit = readCachedPoster(variantKey, variantHitNow)
    if (!wantNetGeo && variantHit.payload && !variantHit.stale) {
      recordPosterRequest(true, outputFormat)
      recordPosterLatency("cached", Date.now() - startTime)
      const variantHitHttpSec = variantHit.factCapped
        ? httpRemainingSec(variantHit.remainingMs, variantHit.ttlSec ?? variantTtlSec, variantHitNow, variantHit.expiresAt)
        : (variantHit.ttlSec ?? variantTtlSec)
      if (isConditional && ifNoneMatch === variantHit.payload.etag) {
        log.debug("Poster cache: 304 (variant)", { mediaType, tmdbId, ms: Date.now() - startTime })
        return new Response(null, { status: 304, headers: posterNotModifiedHeaders(variantHit.payload.etag, variantHit.immutable ?? immutablePoster, dynamicPoster, variantHitHttpSec, isLive, variantHit.payload.accentMeta, variantHit.factCapped) })
      }
      log.debug("Poster cache: fresh variant hit", { mediaType, tmdbId, ms: Date.now() - startTime })
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, variantHitHttpSec, undefined, isLive, variantHit.factCapped)
    }
    if (variantHit.payload && !isConditional && !isLive && !wantNetGeo && canServePosterStaleHit(variantHit)) {
      recordPosterRequest(true, outputFormat)
      recordPosterStaleHit()
      // Stale/SWR serve: no render here — the scheduled background refresh
      // records its own "render" sample when it completes.
      recordPosterLatency("cached", Date.now() - startTime)
      schedulePosterRefresh(req, isPreview)
      log.debug("Poster cache: stale variant hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
      return posterResponse(variantHit.payload, variantHit.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, undefined, undefined, isLive, undefined, true)
    }
    // Variante assente/scadata con condizionale o live: si prosegue al
    // canonico sotto (fresco → conversione; scaduto/assente → render).
  }
  return null
}

/**
 * Phase 3b: fast-path canonico (fresh / stale SWR). `cachedPoster` è letto in GET
 * perché serve anche alla diagnostica più avanti. Estratto verbatim da GET.
 */
export function checkPosterCanonicalCache(
  ctx: PosterCacheLookupContext,
  cachedPoster: ReturnType<typeof readCachedPoster>,
  cachedPosterNow: number,
): Response | Promise<Response> | null {
  const {
    req, mediaType, tmdbId, startTime, isPreview, isConditional, ifNoneMatch, isLive, wantNetGeo,
    refreshRequest, needsVariant, outputFormat, dynamicTtlSec,
    dynamicPoster, immutablePoster, serveResponseVariant,
  } = ctx
  if (!wantNetGeo && cachedPoster.payload && !cachedPoster.stale) {
    recordPosterRequest(true, outputFormat)
    const cachedHttpSec = cachedPoster.factCapped
      ? httpRemainingSec(cachedPoster.remainingMs, cachedPoster.ttlSec ?? dynamicTtlSec, cachedPosterNow, cachedPoster.expiresAt)
      : (cachedPoster.ttlSec ?? dynamicTtlSec)
    // needsVariant: the "cached" sample for conversions is recorded inside
    // serveResponseVariant (conversion encode included); direct path only here.
    if (needsVariant) return serveResponseVariant(cachedPoster.payload, undefined, "cached")
    recordPosterLatency("cached", Date.now() - startTime)
    if (!needsVariant && isConditional && ifNoneMatch === cachedPoster.payload.etag) {
      log.debug("Poster cache: 304", { mediaType, tmdbId, ms: Date.now() - startTime })
      return new Response(null, { status: 304, headers: posterNotModifiedHeaders(cachedPoster.payload.etag, cachedPoster.immutable ?? immutablePoster, dynamicPoster, cachedHttpSec, isLive, cachedPoster.payload.accentMeta, cachedPoster.factCapped) })
    }
    log.debug("Poster cache: fresh hit", { mediaType, tmdbId, ms: Date.now() - startTime })
    return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedHttpSec,
      serverTimingValue([{ name: "cache", desc: "HIT" }, { name: "total", durMs: Date.now() - startTime }]), isLive, cachedPoster.factCapped)
  }
  if (!wantNetGeo && cachedPoster.payload && !isConditional && !isLive && !refreshRequest && canServePosterStaleHit(cachedPoster)) {
    recordPosterRequest(true, outputFormat)
    recordPosterStaleHit()
    // Stale/SWR serve: no render here — the scheduled background refresh
    // re-renders separately and records its own "render" sample on success.
    // Scheduled BEFORE branching (historical ordering) so variant responses
    // warm the edge cache too; each path records one "cached" sample.
    schedulePosterRefresh(req, isPreview)
    log.debug("Poster cache: stale hit (refresh scheduled)", { mediaType, tmdbId, ms: Date.now() - startTime })
    if (needsVariant) return serveResponseVariant(cachedPoster.payload, undefined, "cached")
    recordPosterLatency("cached", Date.now() - startTime)
    return posterResponse(cachedPoster.payload, cachedPoster.immutable ?? immutablePoster, isPreview, dynamicPoster, outputFormat, cachedPoster.factCapped ? httpRemainingSec(cachedPoster.remainingMs, cachedPoster.ttlSec ?? dynamicTtlSec, Date.now(), cachedPoster.expiresAt) : (cachedPoster.ttlSec ?? dynamicTtlSec), undefined, isLive, cachedPoster.factCapped, true)
  }
  return null
}

/**
 * Phase 3c: negative cache (F3). Estratto verbatim da GET. Sincrono: nessun
 * await sul percorso senza hit (ordine microtask invariato rispetto a GET).
 */
export function checkPosterNegativeCache(ctx: PosterCacheLookupContext): Response | null {
  const {
    mediaType, tmdbId, startTime, cacheKey,
  } = ctx
  // Negative cache (F3): un 500/503 recente sulla stessa cache key non
  // ri-rende la pipeline per il TTL — risponde subito lo stesso status.
  const negativeError = readPosterError(cacheKey)
  if (negativeError) {
    log.debug("Poster negative cache hit", { mediaType, tmdbId, status: negativeError.status, ms: Date.now() - startTime })
    return posterErrorResponse(negativeError.status)
  }
  return null
}
