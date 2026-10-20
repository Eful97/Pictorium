import type { NextRequest } from "next/server"
import { cacheGet, cacheGetStale, cacheRemainingMs, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import {
  ACCENT_META_HEADER,
  COMPLETED_ACCENT_TTL_MS,
  MAX_COMPLETED_ACCENT_RECORDS,
  encodeEffectiveAccentHeader,
  sanitizeEffectiveAccentMeta,
  type EffectiveAccentMeta,
} from "@/lib/effective-accent"
import { isBadgeStyle, isRankingBadgeStyle, isExtraBadgeStyle, isExtraFollowRank, isBadgeFont, isSeparateRatingsStyle, isAgeBadgeStyle } from "@/lib/badge-styles"
import { isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE } from "@/lib/types"
import { POSTER_CACHE_ALLOWLIST } from "./poster-params-hardening"

const log = createLogger("poster-cache")

export const POSTER_REFRESH_PARAM = "__poster_refresh"

const POSTER_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
const POSTER_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable"
const PREVIEW_CACHE_CONTROL = "no-cache, no-store, must-revalidate, max-age=0"
// Segui-spazio (`live=1`): rivalidazione obbligatoria, niente freshness né SWR.
// Conserva l'immagine e rivalida via ETag (mai no-store: a ETag invariato vale il 304).
const LIVE_CACHE_CONTROL = "public, no-cache, max-age=0, must-revalidate"
const LIVE_SURROGATE_CONTROL = "max-age=0, must-revalidate"

export interface PosterCachePayload {
  readonly buffer: Buffer
  readonly etag: string
  readonly ttlSec?: number
  /**
   * Absolute expiry (ms epoch = generation + storage TTL). Internal: lets
   * HTTP advertise REMAINING (floor) instead of the original full TTL, and
   * lets variants/waiters inherit the canonical fact deadline without
   * extending it. Undefined = scheduled-policy entry (mapped, uncapped).
   */
  readonly expiresAt?: number
  /** Task D: capped by a volatile-fact deadline — never immutable, never SWR past it. */
  readonly factCapped?: boolean
  /**
   * Effective-accent sidecar (display sync, `?accentmeta=1`): the fills the
   * render actually painted, captured via `GenerationInput.onAccentMeta`.
   * Additive optional — old entries read as undefined (honest unknown).
   * Rides the same entry with the same TTL/tags (written inside the headers
   * record below); never trusted without its bytes entry.
   */
  readonly accentMeta?: EffectiveAccentMeta | null
}

// TTL dei poster dinamici (non-mappati, composti al volo): default 6h.
// Sovrascrivibile via env a module level (un cambio richiede restart).
// Gli header Cache-Control/Surrogate derivano dallo STESSO valore del TTL di
// storage: l'header HTTP non può mentire rispetto a quanto resta in cache
// (coerente con fix M3).
const DYNAMIC_POSTER_TTL_SEC = (() => {
  const raw = envWithFallback("DYNAMIC_POSTER_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 6 * 60 * 60 * 1000
  // Clamp 5min–24h: sotto i 5 minuti la CDN martellerebbe il render pipeline,
  // sopra le 24h i dati dinamici (rank, IMDb Top 250) diventano troppo stantii.
  return Number.isFinite(n) && n >= 5 * 60 * 1000 && n <= 24 * 60 * 60 * 1000
    ? Math.round(n / 1000)
    : 6 * 60 * 60
})()
const DYNAMIC_POSTER_TTL_MS = DYNAMIC_POSTER_TTL_SEC * 1000

// Jitter deterministico anti-thundering-herd (Milestone A): il TTL dinamico
// varia ±10% in base all'hash FNV-1a della cache key. Deterministico: stessa
// key → stesso TTL su tutte le istanze (mai Math.random, che frammenterebbe
// la scadenza tra processi). Su un warmup bulk spalma le scadenze su ~72min
// invece di farle collassare tutte nello stesso secondo.
const DYNAMIC_TTL_JITTER_PCT = 10

/** TTL di storage (ms) per una entry dinamica: base ±10% deterministico. */
export function dynamicPosterTtlMs(cacheKey: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < cacheKey.length; i++) {
    h ^= cacheKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const pct = ((h >>> 0) % (2 * DYNAMIC_TTL_JITTER_PCT + 1)) - DYNAMIC_TTL_JITTER_PCT
  return Math.round((DYNAMIC_POSTER_TTL_MS * (100 + pct)) / 100)
}

/** TTL dinamico in secondi (per gli header HTTP): deriva dallo stesso valore
 *  dello storage — l'header non mente mai rispetto alla cache (M3). */
export function dynamicPosterTtlSec(cacheKey: string): number {
  return Math.round(dynamicPosterTtlMs(cacheKey) / 1000)
}

const POSTER_CDN_CACHE_CONTROL = POSTER_CACHE_CONTROL


export type PosterHeaders = Readonly<Record<string, string>>

export interface ImmutablePosterRequestState {
  readonly hasMapping?: boolean
  readonly isRotating?: boolean
  readonly mappingVersionMatches?: boolean
}

const inflight = new Map<string, Promise<PosterCachePayload | null>>()

const refreshInFlight = new Set<string>()
const lastRefreshAt = new Map<string, number>()
const MIN_REFRESH_INTERVAL_MS = 60_000
const MAX_REFRESH_TRACKED = 500

// Se un render in flight muore (crash/timeout serverless) senza chiamare la
// funzione di completamento, la promise resterebbe appesa nella map per sempre
// bloccando ogni richiesta successiva con la stessa cache key su await.
// Timeout difensivo: dopo N secondi risolve con null e libera la map.
const INFLIGHT_TIMEOUT_MS = 60_000

export function normalizePosterCacheParams(searchParams: URLSearchParams): URLSearchParams {
  // Allowlist rigida anti cache-busting (v1.23.0): solo i parametri noti
  // entrano nella chiave — ?x=$RANDOM collassa invece di missare. I repeat
  // multipli della stessa chiave sono preservati come prima.
  const params = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of searchParams) {
    if (!POSTER_CACHE_ALLOWLIST.has(key)) continue
    // Dedup al primo valore (v1.23.0): il render legge .get() (prima
    // occorrenza), ma la serializzazione includerebbe i repeat —
    // ?blur=20&blur=20 sarebbe una chiave diversa a render identico.
    if (seen.has(key)) continue
    seen.add(key)
    params.append(key, value)
  }
  params.delete("rv")
  params.delete("v")
  params.delete("rk")
  params.delete(POSTER_REFRESH_PARAM)

  const ac = params.get("ac")
  if (ac !== null && !/^#([0-9A-Fa-f]{3}){1,2}$/.test(ac)) {
    params.delete("ac")
  }
  const tl = params.get("tl")
  if (tl !== null && tl !== "1" && tl !== "0" && tl !== "true" && tl !== "false") {
    params.delete("tl")
  }
  const bl = params.get("bl")
  if (bl !== null && bl !== "1" && bl !== "0" && bl !== "true" && bl !== "false") {
    params.delete("bl")
  }
  // demosamples: flag booleano fail-closed. Solo "1" abilita i campioni (e
  // solo in preview accettata); garbage collassa sull'assenza, che rende
  // identico (niente avvelenamento chiave).
  const demosamples = params.get("demosamples")
  if (demosamples !== null && demosamples !== "1") {
    params.delete("demosamples")
  }
  const bs = params.get("bs")
  if (bs !== null && !isBadgeStyle(bs)) {
    params.delete("bs")
  }
  const rs = params.get("rs")
  if (rs !== null && !isRankingBadgeStyle(rs)) {
    params.delete("rs")
  }
  // xbs: present-but-invalid behaves as absent (the resolver falls through
  // the chain), so drop it from the key — same render, one key. The explicit
  // "follow-rank" sentinel is a distinct render (own-rank vs inherited flat)
  // and keeps its own key (never collapsed with absent/invalid).
  const xbs = params.get("xbs")
  if (xbs !== null && !isExtraBadgeStyle(xbs) && !isExtraFollowRank(xbs)) {
    params.delete("xbs")
  }
  // sepstyle: fail-closed con distinzione dall'assenza (come bfont sopra):
  // un valore presente ma non valido (garbage o vuoto) rende come column,
  // mentre l'assenza può ereditare bottom da mapping/default. Cancellarlo
  // collasserebbe le due chiavi e la prima richiesta avvelenerebbe le
  // successive (stessa chiave, immagini diverse). Canonical lowercase come
  // il resolver (query case-insensitive, un'unica policy ovunque).
  const sepstyle = params.get("sepstyle")
  if (sepstyle !== null) {
    const v = sepstyle.toLowerCase()
    params.set("sepstyle", isSeparateRatingsStyle(v) ? v : "column")
  }
  // layout: stessa distinzione fail-closed presente/assente di sepstyle
  // sopra: un valore presente ma non valido (garbage o vuoto) rende come
  // standard, mentre l'assenza può ereditare fresh da mapping/default.
  // Cancellarlo collasserebbe le due chiavi e la prima richiesta
  // avvelenerebbe le successive (stessa chiave, immagini diverse).
  // Canonical lowercase come il resolver (query case-insensitive, un'unica
  // policy ovunque). `standard` esplicito e assenza restano chiavi distinte:
  // solo così lo standard esplicito può prevalere su un fresh ereditato.
  const layout = params.get("layout")
  if (layout !== null) {
    const v = layout.toLowerCase()
    params.set("layout", isPosterLayout(v) ? v : "standard")
  }
  // freshScope: stessa distinzione fail-closed presente/assente di layout
  // sopra: un valore presente ma non valido (garbage o vuoto) rende come
  // ranked (default condiviso), mentre l'assenza può ereditare all da
  // mapping/default.
  // Cancellarlo collasserebbe le due chiavi e la prima richiesta
  // avvelenerebbe le successive (stessa chiave, immagini diverse).
  // Canonical lowercase come il resolver (query case-insensitive, un'unica
  // policy ovunque). `all` esplicito e assenza restano chiavi distinte:
  // solo così l'all esplicito può prevalere su un ranked ereditato.
  const freshScope = params.get("freshScope")
  if (freshScope !== null) {
    const v = freshScope.toLowerCase()
    params.set("freshScope", isPosterFreshScope(v) ? v : DEFAULT_POSTER_FRESH_SCOPE)
  }
  const bfont = params.get("bfont")
  if (bfont !== null && !isBadgeFont(bfont)) {
    // Fail-closed con distinzione dall'assenza: un valore invalido rende come
    // Inter, mentre l'assenza può ereditare un altro font da mapping/default.
    // Cancellarlo collasserebbe le due chiavi e la prima richiesta
    // avvelenerebbe le successive (stessa chiave, immagini diverse).
    params.set("bfont", "inter")
  }
  // agecountry: territorio ISO-2 maiuscolo, GLOBAL escluso (vedi
  // normalizeCertificationCountry). Presente-ma-invalido (garbage, vuoto,
  // GLOBAL, non ISO-2) → delete: il resolver cade sul default di spazio
  // esattamente come con l'assenza (stesso render, un'unica chiave).
  // Canonical uppercase come il resolver (query case-insensitive, un'unica
  // policy ovunque: `?agecountry=us` e `?agecountry=US` condividono la key).
  const agecountry = params.get("agecountry")
  if (agecountry !== null) {
    const v = agecountry.trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(v) && v !== "GLOBAL") params.set("agecountry", v)
    else params.delete("agecountry")
  }
  // agebs: age pill style ("standard" historic look / "knockout" white tag
  // with cut-out transparent glyphs, age ONLY).
  // Presente-ma-invalido → "standard" esplicito (fail-closed, come bfont):
  // l'assenza può ereditare knockout da token/defaults, il garbage rende
  // standard — cancellarlo collasserebbe le chiavi avvelenando i render.
  const agebs = params.get("agebs")
  if (agebs !== null) {
    params.set("agebs", isAgeBadgeStyle(agebs) ? agebs : "standard")
  }
  // theme: cornice stagionale effimera (temi canonici `halloween` /
  // `christmas`, su entrambi i canvas col proprio asset). Presente-ma-invalido → delete: il
  // resolver lo ignora esattamente come l'assenza (stesso render unframed, un'unica chiave — niente
  // distinzione presente/assente qui perché non esiste ereditarietà da
  // mapping/config/defaults). Canonical lowercase come il resolver.
  // La forma canvas (`shape`) viaggia in chiave a sé: stesso tema su
  // portrait e landscape = chiavi distinte (asset diversi).
  const theme = params.get("theme")
  if (theme !== null) {
    const v = theme.trim().toLowerCase()
    if (v === "halloween" || v === "christmas") params.set("theme", v)
    else params.delete("theme")
  }

  // Removed Badge Lab params (`bp`/`bpf`/`bpt`): the custom badge library is
  // retired — legacy values are already dropped by the allowlist above, and
  // the route never emits them, so old URLs collapse onto the native key.
  // Belts-and-suspenders deletes (e.g. direct callers bypassing the list):
  params.delete("bp")
  params.delete("bpf")
  params.delete("bpt")
  params.delete("badgePreset")
  params.delete("prv")
  params.delete("pt")

  return params
}

export function isPosterRefreshRequest(searchParams: URLSearchParams): boolean {
  return searchParams.get(POSTER_REFRESH_PARAM) === "1"
}

/**
 * Percorso "Segui il mio spazio" (`live=1`): politica di aggiornamento, non
 * richiesta di rigenerazione — non bypassa la cache interna né forza il render.
 */
export function isLivePosterRequest(searchParams: URLSearchParams): boolean {
  return searchParams.get("live") === "1"
}

/**
 * Un mapping salvato con `rv`+`mv` NON garantisce da solo un'immagine
 * immutabile: ranking live, rating aggregati, qualità streaming, premi,
 * disponibilità/pre-release, finestre temporali e default fuori URL possono
 * cambiare i byte a URL identico (audit freschezza, problemi 3–4). Dimostrare
 * staticità completa richiederebbe una nuova architettura, quindi la scelta
 * conservativa è non concedere mai l'immutable annuale: la cache interna
 * (24h mappati / ~6h dinamici / effimera 120s) resta il riuso veloce, gli
 * header restano finiti. Parametro `state` conservato per la firma.
 */
export function isImmutablePosterRequest(
  _searchParams: URLSearchParams,
  _state: ImmutablePosterRequestState = {},
): boolean {
  return false
}

export type PosterImageFormat = "jpeg" | "webp" | "avif"

const FORMAT_MIME_TYPES: Record<PosterImageFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
}

// Formato servito ai client che non dichiarano preferenze (Accept generico
// `*/*` o assente — quasi tutti i client Stremio nativi). Default `webp`
// (~25-30% più leggero del jpeg a pari qualità); `PICTORIUM_IMAGE_FORMAT=jpeg`
// torna al jpeg universale per istanze con client datati. Lettura a module
// level: cambio = restart. `?fmt=` resta override esplicito in entrambi i sensi
// (via di fuga). Solo `jpeg` è accettato come alternativa: qualsiasi altro
// valore (incluso `avif`, che costa 3-5× in encode) ricade sul default webp.
export const DEFAULT_IMAGE_FORMAT: Exclude<PosterImageFormat, "avif"> = (() => {
  const raw = envWithFallback("IMAGE_FORMAT")
  return raw && raw.trim().toLowerCase() === "jpeg" ? "jpeg" : "webp"
})()

export function resolveImageFormat(acceptHeader?: string | null, queryFmt?: string | null): PosterImageFormat {
  if (queryFmt) {
    const q = queryFmt.toLowerCase()
    if (q === "webp") return "webp"
    // C3: ?fmt=avif esplicito resta onorato (render dedicato legacy); via
    // Accept l'avif mappa a webp (tutti i client avif accettano anche webp,
    // l'encode avif costa 3-5× e triplicherebbe render+cache).
    if (q === "avif") return "avif"
    if (q === "jpeg" || q === "jpg") return "jpeg"
  }
  if (!acceptHeader) return DEFAULT_IMAGE_FORMAT
  const accept = acceptHeader.toLowerCase()
  if (accept.includes("image/webp")) return "webp"
  return DEFAULT_IMAGE_FORMAT
}

// C3: conversione jpeg canonico → webp on-the-fly. Stesse opzioni
// dell'encode webp diretto in poster-service (q85, effort 2): byte non
// identici al render diretto (doppia compressione), ma stessa qualità
// percepita — il webp esiste solo come variante di risposta, mai come chiave
// di render. ~20-50ms contro ~2-8s di re-render completo.
// Con PICTORIUM_IMAGE_FORMAT=webp il verso si inverte (canonico webp,
// variante jpeg): vedi convertToJpeg sotto.
export async function convertPosterFormat(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default
  return sharp(jpeg).webp({ quality: 85, effort: 2 }).toBuffer()
}

/** Conversione inversa (canonico webp → variante jpeg): stesse opzioni
 *  dell'encode jpeg diretto in poster-service (q82 + mozjpeg). */
export async function convertToJpeg(webp: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default
  return sharp(webp).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
}

/** ETag deterministico della variante derivato da quello canonico. Il default
 *  `webp` conserva gli etag storici byte-identici; le varianti jpeg usano
 *  suffisso proprio (mai collisione col canonico né tra varianti). */
export function variantEtagFor(canonicalEtag: string, variant: Exclude<PosterImageFormat, "avif"> = "webp"): string {
  let h = 0x811c9dc5
  const s = `${canonicalEtag}:${variant}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `"${(h >>> 0).toString(16).padStart(8, "0")}"`
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  // The accent display-sync header rides the image response itself: remote
  // previews (and any cross-origin XHR reader) need it exposed explicitly.
  // Additive only — ETag/Cache-Control exposure is unchanged.
  "Access-Control-Expose-Headers": `ETag, Cache-Control, ${ACCENT_META_HEADER}`,
  "Vary": "Accept",
}

/**
 * Additive accent display-sync headers for a poster response. Returns the
 * compact validated `X-Pictorium-Accent` entry, or an empty object when there
 * is nothing honest to send (legacy entries without meta stay header-absent
 * → honest unknown downstream, never a guessed color).
 */
function accentMetaHeaders(meta: EffectiveAccentMeta | null | undefined): Record<string, string> {
  const encoded = encodeEffectiveAccentHeader(meta ?? null)
  return encoded ? { [ACCENT_META_HEADER]: encoded } : {}
}

export function posterHeaders(etag: string, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg", dynamicTtlSec?: number, live: boolean = false, accentMeta?: EffectiveAccentMeta | null, factCapped?: boolean): PosterHeaders {
  const contentType = FORMAT_MIME_TYPES[format] || "image/jpeg"
  if (isPreview) {
    return {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": PREVIEW_CACHE_CONTROL,
      "Pragma": "no-cache",
      "Expires": "0",
      "ETag": etag,
      ...accentMetaHeaders(accentMeta),
    }
  }
  // Percorso live: stessa politica su 200 e 304 (vedi posterNotModifiedHeaders).
  if (live) {
    return {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": LIVE_CACHE_CONTROL,
      "CDN-Cache-Control": LIVE_CACHE_CONTROL,
      "Surrogate-Control": LIVE_SURROGATE_CONTROL,
      "ETag": etag,
      ...accentMetaHeaders(accentMeta),
    }
  }
  // TTL reale della entry (con jitter) o base quando omesso: header e storage
  // restano sincronizzati per costruzione (M3) — entrambi derivano da
  // dynamicPosterTtlSec(cacheKey) nel chiamante. Un TTL ESPLICITO (entry
  // effimera 120s, cut di rotazione) restringe sempre la policy, anche per i
  // mappati: la copia degradata non deve mai uscire con max-age pieno solo
  // perché il flag dynamic è falso (audit, problema 4).
  const dynSec = dynamicTtlSec ?? DYNAMIC_POSTER_TTL_SEC
  const explicitTtl = dynamicTtlSec !== undefined
  // Task D cycle2: fact-capped entries must NEVER carry SWR/stale-if-error on
  // any CDN/Surrogate header — the CDN could otherwise serve the poster past
  // the fact deadline despite the internal no-SWR guard. Capped policy is
  // exact-remaining + must-revalidate; expired (0) is no-cache/max-age=0.
  // Uncapped keeps the historical SWR policy byte-identical.
  if (factCapped) {
    const cappedSec = Math.max(0, Math.floor(dynSec))
    const cappedCacheControl =
      cappedSec <= 0
        ? "public, no-cache, max-age=0, must-revalidate"
        : `public, max-age=${cappedSec}, s-maxage=${cappedSec}, must-revalidate`
    const cappedCdn =
      cappedSec <= 0 ? "public, max-age=0, must-revalidate" : `public, max-age=${cappedSec}, s-maxage=${cappedSec}, must-revalidate`
    const cappedSurrogate = cappedSec <= 0 ? "max-age=0, must-revalidate" : `max-age=${cappedSec}, must-revalidate`
    return {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": cappedCacheControl,
      "CDN-Cache-Control": cappedCdn,
      "Surrogate-Control": cappedSurrogate,
      "ETag": etag,
      ...accentMetaHeaders(accentMeta),
    }
  }
  const dynamicCacheControl = `public, max-age=${dynSec}, s-maxage=${dynSec}, stale-while-revalidate=86400`
  const dynamicSurrogate = `max-age=${dynSec}, stale-while-revalidate=86400`
  // Task D: a fact-capped entry must NEVER advertise the 1y immutable policy —
  // the fact deadline owns the lifetime, even when the request looked static.
  const effectiveImmutable = immutable && !factCapped
  const cacheControl = effectiveImmutable ? POSTER_IMMUTABLE_CACHE_CONTROL : (dynamic || explicitTtl) ? dynamicCacheControl : POSTER_CACHE_CONTROL
  const cdnCacheControl = effectiveImmutable ? POSTER_IMMUTABLE_CACHE_CONTROL : (dynamic || explicitTtl) ? dynamicCacheControl : POSTER_CDN_CACHE_CONTROL
  const surrogate = effectiveImmutable ? "max-age=31536000" : (dynamic || explicitTtl) ? dynamicSurrogate : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
    ...accentMetaHeaders(accentMeta),
  }
}

export function posterNotModifiedHeaders(etag: string, immutable: boolean, dynamic: boolean = false, dynamicTtlSec?: number, live: boolean = false, accentMeta?: EffectiveAccentMeta | null, factCapped?: boolean): PosterHeaders {
  // Percorso live: stessa politica del 200 — il client deve rivalidare sempre.
  if (live) {
    return {
      ...CORS_HEADERS,
      "Cache-Control": LIVE_CACHE_CONTROL,
      "CDN-Cache-Control": LIVE_CACHE_CONTROL,
      "Surrogate-Control": LIVE_SURROGATE_CONTROL,
      "ETag": etag,
      ...accentMetaHeaders(accentMeta),
    }
  }
  // Come posterHeaders: un TTL esplicito restringe sempre (audit problema 4).
  // Task D: fact-capped never immutable (see posterHeaders).
  // Task D cycle2: capped 304 mirrors the capped 200 — no SWR anywhere.
  if (factCapped) {
    const cappedSec = Math.max(0, Math.floor(dynamicTtlSec ?? DYNAMIC_POSTER_TTL_SEC))
    const cappedCacheControl =
      cappedSec <= 0
        ? "public, no-cache, max-age=0, must-revalidate"
        : `public, max-age=${cappedSec}, s-maxage=${cappedSec}, must-revalidate`
    const cappedCdn =
      cappedSec <= 0 ? "public, max-age=0, must-revalidate" : `public, max-age=${cappedSec}, s-maxage=${cappedSec}, must-revalidate`
    const cappedSurrogate = cappedSec <= 0 ? "max-age=0, must-revalidate" : `max-age=${cappedSec}, must-revalidate`
    return {
      ...CORS_HEADERS,
      "Cache-Control": cappedCacheControl,
      "CDN-Cache-Control": cappedCdn,
      "Surrogate-Control": cappedSurrogate,
      "ETag": etag,
      ...accentMetaHeaders(accentMeta),
    }
  }
  const dynSec = dynamicTtlSec ?? DYNAMIC_POSTER_TTL_SEC
  const explicitTtl = dynamicTtlSec !== undefined
  const dynamicCacheControl = `public, max-age=${dynSec}, s-maxage=${dynSec}, stale-while-revalidate=86400`
  const dynamicSurrogate = `max-age=${dynSec}, stale-while-revalidate=86400`
  const effectiveImmutable = immutable && !factCapped
  const cacheControl = effectiveImmutable ? POSTER_IMMUTABLE_CACHE_CONTROL : (dynamic || explicitTtl) ? dynamicCacheControl : POSTER_CACHE_CONTROL
  const cdnCacheControl = effectiveImmutable ? POSTER_IMMUTABLE_CACHE_CONTROL : (dynamic || explicitTtl) ? dynamicCacheControl : POSTER_CDN_CACHE_CONTROL
  const surrogate = effectiveImmutable ? "max-age=31536000" : (dynamic || explicitTtl) ? dynamicSurrogate : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
    ...accentMetaHeaders(accentMeta),
  }
}

export interface ServerTimingEntry {
  readonly name: string
  readonly durMs?: number
  readonly desc?: string
}

/**
 * Valore `Server-Timing` per le risposte poster (`fetch;dur=123, total;dur=456`,
 * `cache;desc="HIT", total;dur=4`). Diagnostica per-request senza righe di log
 * aggiuntive: la scomposizione fetch/prep/composite vive già nel log
 * "Poster rendered". Solo esposizione, mai raccolta di dati personali.
 */
export function serverTimingValue(entries: readonly ServerTimingEntry[]): string {
  return entries
    .map((e) => {
      const dur = e.durMs === undefined ? "" : `;dur=${Math.max(0, Math.round(e.durMs))}`
      const desc = e.desc === undefined ? "" : `;desc="${e.desc}"`
      return `${e.name}${desc}${dur}`
    })
    .join(", ")
}

export function posterResponse(payload: PosterCachePayload, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg", dynamicTtlSec?: number, serverTiming?: string, live: boolean = false, factCapped?: boolean): Response {
  // The accent display-sync header rides the SAME bytes the editor XHR loads:
  // every HIT/SWR/stale/coalesced 200 carries the meta of the payload it
  // serves (legacy payloads without meta stay header-absent → honest
  // unknown). ETag/Content-Type/Cache-Control behavior is unchanged.
  // Task D: factCapped flows to posterHeaders so a capped entry never emits
  // the 1y immutable policy (payload flag wins when the explicit arg is omitted).
  const capped = factCapped ?? payload.factCapped ?? false
  const headers = posterHeaders(payload.etag, immutable, isPreview, dynamic, format, dynamicTtlSec, live, payload.accentMeta, capped)
  return new Response(new Uint8Array(payload.buffer), {
    headers: serverTiming ? { ...headers, "Server-Timing": serverTiming } : headers,
  })
}

export interface PosterHeadersRecord {
  readonly etag: string
  readonly ttlSec?: number
  readonly immutable?: boolean
  /** Absolute expiry (ms epoch) for HTTP remaining; undefined = scheduled-policy (mapped, uncapped). */
  readonly expiresAt?: number
  /** Accent sidecar slot (same TTL/tags as the bytes entry, never KV-alone). */
  readonly accentMeta?: EffectiveAccentMeta | null
  /** Task D: entry capped by a volatile-fact deadline — never SWR-served past it. */
  readonly factCapped?: boolean
}

/**
 * Task D — HTTP must advertise REMAINING, never the original full TTL.
 * Floor (never round up: a 5.9s remaining must not become max-age=6 past the
 * fact), and never a max(1,…) floor past the deadline (remaining <= 0 → 0,
 * the caller treats it as stale/revalidate, not as a fresh 1s renewal).
 * Null/undefined remaining = unknown (legacy/scheduled entry) → fallback.
 */
export function httpRemainingSec(
  remainingMs: number | null | undefined,
  fallbackSec: number | undefined,
  nowMs?: number,
  expiresAt?: number,
): number | undefined {
  if (expiresAt !== undefined && nowMs !== undefined) {
    const rem = expiresAt - nowMs
    if (rem <= 0) return 0
    return Math.floor(rem / 1000)
  }
  if (remainingMs === null || remainingMs === undefined) return fallbackSec
  if (remainingMs <= 0) return 0
  return Math.floor(remainingMs / 1000)
}

/** Remaining seconds for an in-memory payload (waiter/fresh render). */
export function payloadHttpRemainingSec(
  payload: Pick<PosterCachePayload, "ttlSec" | "expiresAt">,
  fallbackSec?: number,
  nowMs: number = Date.now(),
): number | undefined {
  if (payload.expiresAt !== undefined) {
    const rem = payload.expiresAt - nowMs
    if (rem <= 0) return 0
    return Math.floor(rem / 1000)
  }
  return fallbackSec ?? payload.ttlSec
}

export function readCachedPoster(cacheKey: string, nowMs: number = Date.now()): { readonly payload: PosterCachePayload | null; readonly stale: boolean; readonly ttlSec?: number; readonly immutable?: boolean; readonly factCapped?: boolean; readonly expiresAt?: number; readonly remainingMs: number | null } {
  const cached = cacheGetStale<Buffer>(cacheKey)
  const cachedHeaders = cacheGetStale<PosterHeadersRecord>(`${cacheKey}:headers`)
  if (!cached.data || !cachedHeaders.data) return { payload: null, stale: false, remainingMs: null }
  // The sidecar is valid only with its bytes entry (required above): headers
  // alone — e.g. a KV-served record after a restart — never prove a render.
  // Legacy entries carry no meta (undefined → honest unknown downstream).
  const sidecar = sanitizeEffectiveAccentMeta(cachedHeaders.data.accentMeta ?? null)
  const rec = cachedHeaders.data
  const remainingMs = rec.factCapped
    ? rec.expiresAt !== undefined
      ? rec.expiresAt - nowMs
      : rec.ttlSec !== undefined
        ? cacheRemainingMs(cacheKey, nowMs)
        : null
    : null
  return {
    payload: {
      buffer: cached.data,
      etag: rec.etag,
      ttlSec: rec.ttlSec,
      ...(rec.expiresAt !== undefined ? { expiresAt: rec.expiresAt } : {}),
      ...(rec.factCapped ? { factCapped: true as const } : {}),
      ...(sidecar ? { accentMeta: sidecar } : {}),
    },
    stale: cached.stale || cachedHeaders.stale,
    ttlSec: rec.ttlSec,
    immutable: rec.immutable,
    factCapped: rec.factCapped,
    ...(rec.expiresAt !== undefined ? { expiresAt: rec.expiresAt } : {}),
    remainingMs,
  }
}

/**
 * Task D: una entry fact-capped scaduta NON viene servita stale/SWR — oltre
 * la scadenza del fatto volatile i byte potrebbero descrivere un mondo
 * cambiato (nuovo rank, badge temporale flippato), quindi si rivalida invece
 * di servire + refresh in background. Le entry di policy (non capped)
 * conservano lo SWR storico.
 */
export function canServePosterStaleHit(read: {
  readonly stale: boolean
  readonly factCapped?: boolean
}): boolean {
  return read.stale && !read.factCapped
}

// Poster non-mappati (composti al volo con dati dinamici): TTL esplicito
// (fix M3). Prima writeCachedPoster non passava alcun TTL → il tag "poster"
// finiva nel refresh schedulato giornaliero alle 3 UTC (cache.ts) e l'header
// HTTP dynamic (6h) mentiva: in memoria il payload restava fino al refresh
// delle 3, con rank/IMDb Top 250 potenzialmente stantii per un giorno intero.
// DYNAMIC_POSTER_TTL_MS è definito in testa al modulo (env-parametrizzato);
// dynamicPosterTtlMs aggiunge il jitter deterministico ±10% per key e gli
// header dynamic derivano dallo stesso dynamicPosterTtlSec, così header e
// storage restano sincronizzati.

export interface WriteCachedPosterOpts {
  /** TTL esplicito in ms (es. qualità effimera): vince su default mapping/dinamico. */
  readonly ttlMs?: number
  /** Flag immutable effettivo della risposta: persistito per le HIT (M3). */
  readonly immutable?: boolean
  /**
   * Task D: la entry è limitata dalla scadenza reale di un fatto volatile
   * (ranking/release), non dal flat TTL di policy. Persistito nel record:
   * oltre la scadenza la entry NON viene servita stale/SWR (sarebbe oltre
   * il deadline del fatto) ma rivalidata. Interno, mai esposto in HTTP.
   */
  readonly factCapped?: boolean
}

export function writeCachedPoster(cacheKey: string, payload: PosterCachePayload, mappingTag?: string, opts?: WriteCachedPosterOpts): void {
  const tags = mappingTag ? ["poster", mappingTag] : ["poster"]
  // TTL esplicito solo per i non-mappati: per i mappati resta il refresh
  // schedulato giornaliero (invalidazione per tag dopo i salvataggi).
  // Jitter deterministico anti-herd: stessa key → stesso TTL ovunque (M3
  // garantito perché gli header derivano dallo stesso dynamicPosterTtlSec).
  // opts.ttlMs (es. qualità effimera dopo timeout upstream) vince su tutto,
  // anche sul path mappato: un render degradato non deve mai restare 24h.
  const explicitTtlMs = opts?.ttlMs
  const ttl = explicitTtlMs ?? (mappingTag ? undefined : dynamicPosterTtlMs(cacheKey))
  // ttlSec/immutable nel record header: le HIT riusano gli stessi valori dello
  // storage (M3) invece di sovrastimare max-age/immutable con i default di
  // richiesta su entry effimere. Record vecchi senza campi → fallback invariato.
  // Task D: absolute expiresAt sidecar — HTTP advertises REMAINING (floor),
  // never the original full TTL. Payload-carried expiresAt wins (same clock
  // as the waiter path); otherwise now + storage TTL. Scheduled entries stay
  // undefined (historical mapped policy, honest unknown).
  const nowMs = Date.now()
  const isCapped = Boolean(opts?.factCapped || payload.factCapped)
  const expiresAt =
    payload.expiresAt !== undefined
      ? (isCapped ? payload.expiresAt : undefined)
      : isCapped && ttl !== undefined
        ? nowMs + ttl
        : undefined
  const ttlSec = explicitTtlMs !== undefined
    ? Math.max(1, Math.round(explicitTtlMs / 1000))
    : (mappingTag ? undefined : dynamicPosterTtlSec(cacheKey))
  const record: PosterHeadersRecord = {
    etag: payload.etag,
    ttlSec,
    immutable: opts?.immutable,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(opts?.factCapped || payload.factCapped ? { factCapped: true as const } : {}),
    // Accent sidecar: same two-key write, same TTL/tags — no parallel policy.
    // Sanitized + cloned (callers keep no mutable alias into the store).
    ...(payload.accentMeta ? { accentMeta: sanitizeEffectiveAccentMeta(payload.accentMeta) ?? undefined } : {}),
  }
  cacheSet(cacheKey, payload.buffer, tags, ttl)
  cacheSet(`${cacheKey}:headers`, record, tags, ttl)
}

// ---------------------------------------------------------------------------
// Negative cache (F3): un errore 500/503 recente evita di ri-rendere la stessa
// cache key per il TTL, altrimenti ogni retry ricolpisce upstream e slot con la
// pipeline completa. TTL breve: si svuota da sola, senza invalidation esplicita.
// ---------------------------------------------------------------------------

export type PosterErrorStatus = 500 | 503 | 404

export interface PosterErrorRecord {
  readonly status: PosterErrorStatus
}

const NEGATIVE_TTL_MS = (() => {
  const raw = envWithFallback("NEGATIVE_CACHE_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 5000
  return Number.isFinite(n) && n >= 1000 && n <= 60000 ? n : 5000
})()

let negativeWrites = 0
let negativeHits = 0

export function writePosterError(cacheKey: string, status: PosterErrorStatus): void {
  negativeWrites++
  cacheSet(`${cacheKey}:err`, { status } satisfies PosterErrorRecord, ["poster-error"], NEGATIVE_TTL_MS)
}

export function readPosterError(cacheKey: string): PosterErrorRecord | null {
  const rec = cacheGet<PosterErrorRecord>(`${cacheKey}:err`)
  if (rec) negativeHits++
  return rec
}

/** Contatori della negative cache per /status. */
export function posterErrorStats(): { readonly writes: number; readonly hits: number } {
  return { writes: negativeWrites, hits: negativeHits }
}

export function getPendingPoster(cacheKey: string): Promise<PosterCachePayload | null> | null {
  return inflight.get(cacheKey) ?? null
}

// ---------------------------------------------------------------------------
// Completed accent records (effective-accent display sync, `?accentmeta=1`).
// ---------------------------------------------------------------------------
// The editor preview (`preview=1`) is no-store by contract and the inflight
// entry is deleted on completion — a metadata fetch arriving AFTER the
// `<img>` render settles would otherwise find nothing and stay disabled for
// a legitimate success. This bounded memory-only map retains the ~250-byte
// validated meta (never image bytes, never KV) for a short window keyed by
// the FULL canonical authorized cacheKey. Eviction/expiry answer honest
// unknown; the next preview `<img>` load re-warms a fresh record.
// Single-process only: other instances/CDN-cold answer unknown, never a guess.

interface CompletedAccentRecord {
  readonly meta: EffectiveAccentMeta
  readonly expiresAt: number
}

const completedAccent = new Map<string, CompletedAccentRecord>()

/**
 * Record a successful render's accent meta. Call AFTER the last success
 * point and BEFORE `completePosterRender` (write-then-complete), for preview
 * AND non-preview renders alike. Failures/deadlines never record. Invalid
 * payloads are dropped (honest unknown downstream), never stored.
 */
export function recordCompletedAccent(cacheKey: string, meta: EffectiveAccentMeta | null | undefined): void {
  const clean = sanitizeEffectiveAccentMeta(meta ?? null)
  if (!clean) return
  // Deterministic insertion-order eviction (no timers): oldest first.
  while (completedAccent.size >= MAX_COMPLETED_ACCENT_RECORDS) {
    const oldest = completedAccent.keys().next().value
    if (oldest === undefined) break
    completedAccent.delete(oldest)
  }
  completedAccent.set(cacheKey, Object.freeze({
    meta: Object.freeze(clean) as EffectiveAccentMeta,
    expiresAt: Date.now() + COMPLETED_ACCENT_TTL_MS,
  }) as CompletedAccentRecord)
}

/**
 * Late-subscriber read: a fresh clone, or null when absent/expired (lazy
 * expiry, no timers). Cloned per call — callers never share mutable state
 * across requests.
 */
export function readCompletedAccent(cacheKey: string): EffectiveAccentMeta | null {
  const rec = completedAccent.get(cacheKey)
  if (!rec) return null
  if (Date.now() >= rec.expiresAt) {
    completedAccent.delete(cacheKey)
    return null
  }
  return sanitizeEffectiveAccentMeta(rec.meta)
}

/** Only for tests: clear the completed-accent map. */
export function __resetCompletedAccentForTests(): void {
  completedAccent.clear()
}

export function beginPosterRender(
  cacheKey: string,
): (payload: PosterCachePayload | null, keepEntry?: boolean) => void {
  // Race guard: non sovrascrivere un render già in corso. (Il tratto
  // getPendingPoster→begin nella route non ha await in mezzo, quindi in Node
  // è atomico: questa guardia è difensiva, non il meccanismo primario.)
  if (inflight.has(cacheKey)) return () => {}

  let resolveRender: (payload: PosterCachePayload | null) => void = () => {}
  const promise = new Promise<PosterCachePayload | null>((resolve) => {
    resolveRender = resolve
  })
  const timer = setTimeout(() => {
    resolveRender(null)
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }, INFLIGHT_TIMEOUT_MS)
  if (typeof timer.unref === "function") timer.unref()
  inflight.set(cacheKey, promise)
  return (payload, keepEntry = false) => {
    // R4: al watchdog (keepEntry=true) i waiter vengono risolti con null MA
    // l'entry resta prenotata allo zombie finché finisce (o fino al timeout
    // 60s sopra). Prima l'entry veniva cancellata subito: ogni richiesta
    // successiva con la stessa key non trovava inflight e duplicava l'intero
    // render proprio con upstream lento — moltiplicatore di carico invece di
    // coalescing. I nuovi arrivati si attaccano alla promise già risolta con
    // null → 503 immediato, zero lavoro duplicato.
    if (!keepEntry) clearTimeout(timer)
    resolveRender(payload)
    if (!keepEntry && inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }
}

export function schedulePosterRefresh(req: NextRequest, isPreview: boolean = false): void {
  // Le preview (`preview=1`) non vengono servite alle CDN: rigenerarle in
  // background è inutile. Il refresh serve solo per riscaldare la cache edge.
  if (isPreview) return
  if (process.env.VERCEL) return // Serverless: nessun self-fetch in background
  const internalOrigin = `http://127.0.0.1:${process.env.PORT || "3000"}`
  const searchParams = new URLSearchParams(req.nextUrl.searchParams)
  // Fix M1: non inoltrare api_key in chiaro nell'URL di loopback — la chiave
  // viene passata via header x-api-key (come già fa il warmup dei cataloghi).
  // route.ts:167 rimuove già api_key dal cacheKey per non tenerla in memoria.
  const apiKeyForRefresh = searchParams.get("api_key") || req.headers.get("x-api-key") || undefined
  searchParams.delete("api_key")
  searchParams.delete("x-api-key")
  searchParams.set(POSTER_REFRESH_PARAM, "1")
  const refreshUrl = `${internalOrigin}${req.nextUrl.pathname}?${searchParams.toString()}`
  const key = `${req.nextUrl.pathname}?${searchParams.toString()}`
  // Dedup: non avviare due refresh concorrenti per la stessa URL.
  if (refreshInFlight.has(key)) return
  // Min-interval: evita che un titolo sotto attacco (o una catena di stale hit)
  // generi un self-fetch a ogni richiesta — la cache locale viene comunque
  // rigenerata dalla prima richiesta che arriva con il param di refresh.
  const now = Date.now()
  const last = lastRefreshAt.get(key)
  if (last !== undefined && now - last < MIN_REFRESH_INTERVAL_MS) return
  if (lastRefreshAt.size >= MAX_REFRESH_TRACKED) lastRefreshAt.delete(lastRefreshAt.keys().next().value!)
  lastRefreshAt.set(key, now)
  refreshInFlight.add(key)
  const refreshHeaders: Record<string, string> = {}
  if (apiKeyForRefresh) refreshHeaders["x-api-key"] = apiKeyForRefresh
  void fetch(refreshUrl, {
    headers: Object.keys(refreshHeaders).length > 0 ? refreshHeaders : undefined,
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      // Consuma/cancella il body per evitare memory leak senza allocare buffer enormi
      await res.body?.cancel().catch(() => {})
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Background refresh failed", { error: msg })
    })
    .finally(() => { refreshInFlight.delete(key) })
}

// ---------------------------------------------------------------------------
// Render concurrency limiter (anti-OOM)
// ---------------------------------------------------------------------------
// Un cache-miss tiene in memoria poster originali + logo + backdrop + buffer
// RGBA e i risultati delle composizioni sharp (decine di MB per richiesta).
// Su istanze con heap limitato (Docker: --max-old-space-size=384) un burst di
// miss su titoli diversi può portare a OOM senza backpressure. Questo limiter
// serializza i render costosi: le richieste in eccesso attendono un posto per
// un tempo limitato, poi ricevono 503 invece di accodarsi all'infinito.

const MAX_CONCURRENT_RENDERS = (() => {
  const raw = envWithFallback("MAX_CONCURRENT_RENDERS")
  const n = raw ? parseInt(raw, 10) : 4
  return Number.isFinite(n) && n > 0 && n <= 32 ? n : 4
})()
// Attesa massima di un posto di render prima del 503 (F5). Lettura a module
// level: un cambio env richiede restart, non hot-reload.
// Default 15000: le griglie catalogo (Stremio/AIOMetadata) richiedono ~20 poster
// in parallelo su cache fredda; con 4 slot e 5s molti ricevevano 503 (poster
// mancanti). I waiter non tengono buffer immagini (i fetch avvengono dentro lo
// slot), quindi allungare l'attesa è memory-neutral.
export const RENDER_SLOT_WAIT_MS = (() => {
  const raw = envWithFallback("RENDER_SLOT_WAIT_MS")
  // Vercel Hobby: 10s di limite funzione — con 15s di attesa la piattaforma
  // chiuderebbe con 504 prima del nostro 503. Default hobby-safe SOLO se
  // l'utente non ha impostato un valore esplicito (su Pro vale il default).
  const fallback = process.env.VERCEL && raw === undefined ? 7500 : 15000
  const n = raw ? parseInt(raw, 10) : fallback
  return Number.isFinite(n) && n >= 500 && n <= 60000 ? n : fallback
})()
// Coda bounded (opzionale): con 0 il comportamento è attuale (i waiter oltre i
// posti attendono fino a RENDER_SLOT_WAIT_MS). Con N>0 i waiter oltre N
// ricevono 503 immediato invece di accodarsi: backpressure senza code infinite.
const RENDER_QUEUE_LIMIT = (() => {
  const raw = envWithFallback("RENDER_QUEUE")
  const n = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(n) && n >= 0 && n <= 128 ? n : 0
})()

let activeRenders = 0
let zombieRenders = 0
// Picchi cumulativi da avvio processo (telemetria bench/produzione): il
// polling esterno di /api/cache/status può mancare slot brevi, questi
// contatori no (due interi, costo zero). Vedi getPosterStats().
let peakActiveRenders = 0
let peakQueuedRenders = 0
const renderWaiters: Array<() => void> = []
// Quante volte uno zombie ha superato la grazia ed è stato sganciato dal
// budget slot (metrica cumulativa, esposta in getPosterStats).
let zombieGraceExpired = 0

// Tetto di grazia per i render abbandonati dal watchdog (R5): oltre questo
// tempo lo zombie smette di occupare budget slot. Senza, N zombie = N slot
// bruciati con active=0 → 503 a catena anche a pipeline scarica (deadlock
// morbido sotto upstream lento). Lo zombie continua comunque in background
// fino al settle (la sua cleanup è guarded) — si libera solo il conteggio,
// con un warn per distinguere "zombie veloci" (post-R3: abort immediato dei
// fetch) da quelli patologici (sharp appeso).
const ZOMBIE_GRACE_MS = (() => {
  const raw = envWithFallback("ZOMBIE_GRACE_MS")
  const n = raw ? parseInt(raw, 10) : 10000
  return Number.isFinite(n) && n >= 1000 && n <= 120000 ? n : 10000
})()
const pendingGraceTimers = new Set<ReturnType<typeof setTimeout>>()

function pumpWaiters(): void {
  while (renderWaiters.length > 0 && activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    const next = renderWaiters.shift()
    if (next) next()
  }
}

function releaseRenderSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1)
  pumpWaiters()
}

/** Notifica al limiter che un render è stato abbandonato dalla deadline ma continua in background */
export function recordZombieRenderStart(label?: string): () => void {
  zombieRenders++
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    zombieRenders = Math.max(0, zombieRenders - 1)
    pumpWaiters()
  }
  const grace = setTimeout(() => {
    pendingGraceTimers.delete(grace)
    if (settled) return
    settled = true
    zombieRenders = Math.max(0, zombieRenders - 1)
    zombieGraceExpired++
    log.warn("Zombie render grace expired — slot force-released", label ? { zombies: zombieRenders, render: label } : { zombies: zombieRenders })
    pumpWaiters()
  }, ZOMBIE_GRACE_MS)
  if (typeof grace.unref === "function") grace.unref()
  pendingGraceTimers.add(grace)
  return () => {
    pendingGraceTimers.delete(grace)
    clearTimeout(grace)
    settle()
  }
}

/** Acquisisce un posto di render. Risolve con la release function, o null se il timeout scade. */
export async function acquirePosterRenderSlot(): Promise<(() => void) | null> {
  if (activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++
    peakActiveRenders = Math.max(peakActiveRenders, activeRenders)
    return releaseRenderSlot
  }
  if (RENDER_QUEUE_LIMIT > 0 && renderWaiters.length >= RENDER_QUEUE_LIMIT) {
    return null
  }
  return new Promise<(() => void) | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const i = renderWaiters.indexOf(handoff)
      if (i >= 0) renderWaiters.splice(i, 1)
      resolve(null)
    }, RENDER_SLOT_WAIT_MS)
    const handoff = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeRenders++
      peakActiveRenders = Math.max(peakActiveRenders, activeRenders)
      resolve(releaseRenderSlot)
    }
    renderWaiters.push(handoff)
    peakQueuedRenders = Math.max(peakQueuedRenders, renderWaiters.length)
  })
}

/** Solo per i test: svuota lo stato del limiter. */
export function __resetPosterRenderLimiter(): void {
  activeRenders = 0
  zombieRenders = 0
  peakActiveRenders = 0
  peakQueuedRenders = 0
  renderWaiters.length = 0
  for (const t of pendingGraceTimers) clearTimeout(t)
  pendingGraceTimers.clear()
}

// ---------------------------------------------------------------------------
// Poster metrics & telemetry
// ---------------------------------------------------------------------------

export interface PosterStats {
  requests: number
  hits: number
  renders: number
  errors: number
  staleHits: number
  coalescedHits: number
  rescues: {
    tvdb: number
    backdropCrop: number
  }
  formats: {
    jpeg: number
    webp: number
    avif: number
  }
}

const posterMetrics: PosterStats = {
  requests: 0,
  hits: 0,
  renders: 0,
  errors: 0,
  staleHits: 0,
  coalescedHits: 0,
  rescues: {
    tvdb: 0,
    backdropCrop: 0,
  },
  formats: {
    jpeg: 0,
    webp: 0,
    avif: 0,
  },
}

export function recordPosterRequest(hit: boolean, format: PosterImageFormat = "jpeg"): void {
  posterMetrics.requests++
  if (hit) {
    posterMetrics.hits++
  } else {
    posterMetrics.renders++
  }
  posterMetrics.formats[format] = (posterMetrics.formats[format] || 0) + 1
}

export function recordPosterError(): void {
  posterMetrics.requests++
  posterMetrics.errors++
}

export function recordPosterStaleHit(): void {
  posterMetrics.staleHits++
}

export function recordPosterCoalescedHit(): void {
  posterMetrics.coalescedHits++
}

export function recordTvdbRescue(): void {
  posterMetrics.rescues.tvdb++
}

export function recordBackdropCropRescue(): void {
  posterMetrics.rescues.backdropCrop++
}

/** Solo per i test: azzera i contatori telemetria poster. */
export function __resetPosterStatsForTest(): void {
  posterMetrics.requests = 0
  posterMetrics.hits = 0
  posterMetrics.renders = 0
  posterMetrics.errors = 0
  posterMetrics.staleHits = 0
  posterMetrics.coalescedHits = 0
  posterMetrics.rescues.tvdb = 0
  posterMetrics.rescues.backdropCrop = 0
  posterMetrics.formats.jpeg = 0
  posterMetrics.formats.webp = 0
  posterMetrics.formats.avif = 0
  __resetPosterLatencyForTests()
}

// ---------------------------------------------------------------------------
// Poster latency diagnostics (rolling per-process observations, cached vs NEW)
// ---------------------------------------------------------------------------
// Two buckets, separated by what the request actually cost the pipeline:
// - "cached": served WITHOUT running the render pipeline — fresh cache hits
//   (canonical + variant-conversion hits), stale/SWR serves (the scheduled
//   background refresh re-renders separately and records its own "render"
//   sample), and 304s answered from a cached entry.
// - "render": the full render pipeline ran for this response — canonical and
//   variant renders alike, preview (`preview=1`) renders, background-refresh
//   renders, and revalidation renders (stale/expired + conditional that
//   re-rendered instead of answering 304).
// Explicitly EXCLUDED (no sample in either bucket, never double-counted):
// - coalesced waiters: they await ANOTHER request's render, so their latency
//   measures queue + someone else's pipeline, not own-cache nor own-render.
//   Counted in the existing coalescedHits counter, not here.
// - error responses: negative-cache hits, 500/503/404/400, slot/format-gate
//   overload 503s, deadline-abandoned 503s. Counted in errors/negative stats.
// - diagnostic JSON branches (`?accentmeta=1`, `?netgeo=1` debug): not poster
//   bytes, and they never touch the request counters either.
// - variant conversion encode: INCLUDED in whichever bucket served the
//   response — "cached" conversions dominate their sample honestly, and
//   "render" is recorded at terminal success (after conversion), so a failed
//   conversion (500/503) never counts as a served render.
// No PII/telemetry: only {ms, at} numbers. Bounded fixed memory (capacity
// × 2 buckets), rolling window expiry, quantiles computed on diagnostic read
// (getPosterStats, served by the admin-only /api/cache/status) — never sorted
// or aggregated on the per-request path. Single-process scope: other
// instances/CDN-cold answer from their own window, never merged.

export type PosterLatencyKind = "cached" | "render"

/** Rolling observation window (15min): samples older than this are pruned. */
export const POSTER_LATENCY_WINDOW_MS = 15 * 60 * 1000
/** Max retained samples PER bucket (fixed memory: 2 × capacity entries). */
export const POSTER_LATENCY_MAX_SAMPLES = 1024

interface PosterLatencySample {
  readonly ms: number
  readonly at: number
}

const posterLatency: Record<PosterLatencyKind, PosterLatencySample[]> = {
  cached: [],
  render: [],
}

function prunePosterLatency(kind: PosterLatencyKind, nowMs: number): void {
  const arr = posterLatency[kind]
  const cutoff = nowMs - POSTER_LATENCY_WINDOW_MS
  let drop = 0
  while (drop < arr.length && arr[drop]!.at <= cutoff) drop++
  if (drop > 0) arr.splice(0, drop)
  while (arr.length > POSTER_LATENCY_MAX_SAMPLES) arr.shift()
}

/**
 * Record one poster-response latency sample. Invalid inputs are dropped
 * silently (fail-closed: negative/NaN/Infinite durations or timestamps never
 * enter the window, so clock adjustments cannot poison the quantiles).
 * Unknown kinds are ignored (never create buckets).
 */
export function recordPosterLatency(
  kind: PosterLatencyKind,
  ms: number,
  nowMs: number = Date.now(),
): void {
  if (kind !== "cached" && kind !== "render") return
  if (!Number.isFinite(ms) || ms < 0) return
  if (!Number.isFinite(nowMs) || nowMs < 0) return
  posterLatency[kind].push({ ms, at: nowMs })
  prunePosterLatency(kind, nowMs)
}

/**
 * Quantile by linear interpolation on SORTED values (R-7 / numpy "linear":
 * rank = q * (n - 1), interpolate between adjacent ranks). Single value →
 * itself; empty → null (honest no-data, never zero).
 */
export function posterLatencyQuantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]!
  const rank = q * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]!
  const frac = rank - lo
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac
}

export interface PosterLatencySummary {
  readonly count: number
  /** Median of the rolling window, 1-decimal ms; null when count is 0. */
  readonly p50Ms: number | null
  /** 95th percentile of the rolling window, 1-decimal ms; null when count is 0. */
  readonly p95Ms: number | null
}

export interface PosterLatencyStats {
  readonly windowMs: number
  readonly capacity: number
  readonly cached: PosterLatencySummary
  readonly render: PosterLatencySummary
}

/**
 * Diagnostic read: prune expired samples, then compute count/p50/p95 per
 * bucket. Sorting + quantiles happen HERE (admin poll cadence), never on the
 * per-request recording path.
 */
export function getPosterLatencyStats(nowMs: number = Date.now()): PosterLatencyStats {
  const summarize = (kind: PosterLatencyKind): PosterLatencySummary => {
    prunePosterLatency(kind, nowMs)
    const values = posterLatency[kind].map((s) => s.ms).sort((a, b) => a - b)
    if (values.length === 0) return { count: 0, p50Ms: null, p95Ms: null }
    const round1 = (n: number): number => Math.round(n * 10) / 10
    return {
      count: values.length,
      p50Ms: round1(posterLatencyQuantile(values, 0.5) ?? 0),
      p95Ms: round1(posterLatencyQuantile(values, 0.95) ?? 0),
    }
  }
  return {
    windowMs: POSTER_LATENCY_WINDOW_MS,
    capacity: POSTER_LATENCY_MAX_SAMPLES,
    cached: summarize("cached"),
    render: summarize("render"),
  }
}

/** Test-only: clears latency observations (both buckets). */
export function __resetPosterLatencyForTests(): void {
  posterLatency.cached.length = 0
  posterLatency.render.length = 0
}

export function getPosterStats() {
  const hitRate = posterMetrics.requests > 0
    ? Math.round((posterMetrics.hits / posterMetrics.requests) * 1000) / 10
    : 0
  return {
    requests: posterMetrics.requests,
    hits: posterMetrics.hits,
    renders: posterMetrics.renders,
    errors: posterMetrics.errors,
    staleHits: posterMetrics.staleHits,
    coalescedHits: posterMetrics.coalescedHits,
    rescues: { ...posterMetrics.rescues },
    hitRate: `${hitRate}%`,
    hitRateNum: hitRate,
    formats: { ...posterMetrics.formats },
    // Rolling cached-vs-render latency (additive: shapes the admin status
    // payload via /api/cache/status, never exposed on public /api/status).
    latency: getPosterLatencyStats(),
    activeRenders,
    zombieRenders,
    zombieGraceExpired,
    queuedRenders: renderWaiters.length,
    peakActiveRenders,
    peakQueuedRenders,
    maxConcurrent: MAX_CONCURRENT_RENDERS,
  }
}
