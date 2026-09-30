import { fetchImg, hashKey, imgSrc } from "@/lib/poster-render-helpers"
import { ImageValidationError, validateImageBytes } from "@/lib/custom-image-validate"
import { peekImageBytes, storeImageBytes } from "@/lib/image-bytes-cache"
import { combineAbortSignals, raceWithAbort } from "@/lib/abort-signal"
export { splitCustomPosterSave, type PosterSaveSplit } from "@/lib/utils"
import { isAllowedResolveHost } from "@/lib/resolve-image"
import {
  BodyTooLargeError,
  readBodyCapped,
  resolveAndCheckBlocked,
  safeFetchRemote,
} from "@/lib/safe-remote-fetch"
import { createLogger } from "@/lib/logger"

const log = createLogger("custom-poster-base")

const MAX_CUSTOM_IMAGE_BYTES = 10 * 1024 * 1024

// --- Stato condiviso basi custom (byte-cache + failure cache) ---
// La byte-cache vera vive in image-bytes-cache.ts (budget 32MB condiviso,
// TTL 24h, cap 2000 URL): qui solo la failure map (fallimenti = niente rete
// per 60s) e il reset per i test. Il download condiviso in-flight è più sotto.

/** TTL failure cache: un'origine morta non si ricontatta per 60s. */
export const CUSTOM_FAIL_TTL_MS = 60_000
/** Tetto voci failure cache (con rimozione pigra delle scadute). */
export const CUSTOM_FAIL_MAX_ENTRIES = 500
/** Timeout proprio del download custom condiviso (indipendente dai waiter). */
const CUSTOM_FETCH_TIMEOUT_MS = 15_000
/** Budget custom nel parallelo col TMDB (solo con fallback noto). */
export const CUSTOM_BUDGET_MS = 5_000
/** Basi sopra questa taglia si rendono ma non entrano in byte-cache: non
 *  devono mai flushare i byte TMDB dal budget condiviso (32MB). */
const CUSTOM_CACHE_MAX_BYTES = 4 * 1024 * 1024

/** url normalizzato → expiry epoch ms del fallimento. */
const customFailures = new Map<string, number>()

/** Solo per i test: svuota failure cache + download condivisi in corso. */
export function __resetCustomImageStateForTests(): void {
  for (const entry of customInflight.values()) {
    clearTimeout(entry.timeout)
    entry.controller.abort()
  }
  customInflight.clear()
  customFailures.clear()
}

/**
 * Vero per gli abort (AbortError) da QUALSIASI realm: DOMException di jsdom,
 * undici o Node non condividono la catena `instanceof Error` tra realm, ma
 * hanno sempre name "AbortError" (code 20). Il duck-type evita di
 * classificare un abort come fallimento definitivo (che finirebbe nella
 * failure cache) o, viceversa, di ingoiare errori veri.
 */
function isAbortError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true
  if (typeof e !== "object" || e === null) return false
  const rec = e as { name?: unknown; code?: unknown }
  if (rec.name !== "AbortError") return false
  return rec.code === undefined || rec.code === 20 || e instanceof Error
}

interface CustomInflightEntry {
  refs: number
  controller: AbortController
  timeout: ReturnType<typeof setTimeout>
  timeoutFired: boolean
  promise: Promise<Buffer | null>
}

/** Un solo download attivo per URL: i render concorrenti lo condividono. */
const customInflight = new Map<string, CustomInflightEntry>()

/**
 * Download condiviso con abort per-waiter: ogni render può staccarsi (il suo
 * abort non uccide il download degli altri) ma quando resta zero waiter il
 * lavoro residuo si interrompe + cleanup timer. Il download ha deadline
 * propria (CUSTOM_FETCH_TIMEOUT_MS), indipendente dai signal dei chiamanti.
 */
async function sharedCustomDownload(
  key: string,
  callerSignal: AbortSignal,
  work: (signal: AbortSignal) => Promise<Buffer | null>,
): Promise<Buffer | null> {
  if (callerSignal.aborted) {
    throw new DOMException("Aborted", "AbortError")
  }
  let entry = customInflight.get(key)
  if (!entry) {
    const controller = new AbortController()
    const fresh: CustomInflightEntry = {
      refs: 0,
      controller,
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      timeoutFired: false,
      promise: null as unknown as Promise<Buffer | null>,
    }
    fresh.timeout = setTimeout(() => {
      fresh.timeoutFired = true
      fresh.controller.abort()
    }, CUSTOM_FETCH_TIMEOUT_MS)
    fresh.promise = (async (): Promise<Buffer | null> => {
      try {
        const result = await raceWithAbort(work(controller.signal), controller.signal)
        // Lavoro finito con null = origine fallita in modo definitivo.
        if (result === null && !controller.signal.aborted) recordCustomFailure(key)
        return result
      } catch (e) {
        // Registra solo fallimenti definitivi: timeout interno = origine
        // lenta; mai l'abort da detach (zero waiter o deadline del render),
        // che arriva come AbortError a timeoutFired spento.
        if (fresh.timeoutFired || (!controller.signal.aborted && !isAbortError(e))) recordCustomFailure(key)
        throw e
      } finally {
        clearTimeout(fresh.timeout)
        if (customInflight.get(key) === fresh) customInflight.delete(key)
      }
    })()
    customInflight.set(key, fresh)
    entry = fresh
  }
  entry.refs++
  try {
    return await raceWithAbort(entry.promise, callerSignal)
  } finally {
    entry.refs--
    if (entry.refs <= 0) {
      clearTimeout(entry.timeout)
      if (customInflight.get(key) === entry) customInflight.delete(key)
      entry.controller.abort()
    }
  }
}

function isRecentlyFailed(key: string, now: number = Date.now()): boolean {
  const exp = customFailures.get(key)
  if (exp === undefined) return false
  if (exp <= now) {
    customFailures.delete(key)
    return false
  }
  return true
}

function recordCustomFailure(key: string): void {
  if (customFailures.size >= CUSTOM_FAIL_MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, exp] of customFailures) {
      if (exp <= now) customFailures.delete(k)
    }
    if (customFailures.size >= CUSTOM_FAIL_MAX_ENTRIES) {
      const oldest = customFailures.keys().next().value
      if (oldest !== undefined) customFailures.delete(oldest)
    }
  }
  customFailures.set(key, Date.now() + CUSTOM_FAIL_TTL_MS)
}

export interface PosterBaseResult {
  readonly buf: Buffer
  /** True quando la base è l'URL custom (serve per analysisKey e diagnostica). */
  readonly custom: boolean
}

export interface CustomFetchDeps {
  fetchRemote?: (url: string, signal: AbortSignal) => Promise<Response>
  checkBlocked?: (url: string) => Promise<boolean>
  /** Override del budget custom (default CUSTOM_BUDGET_MS): solo per i test. */
  budgetMs?: number
}

/**
 * Scarica e valida un'immagine da URL custom salvato nel mapping.
 * Ritorna null su fallimento definitivo (host fuori allowlist, SSRF, HTTP
 * non-ok, MIME/magic/pixel/animate, body oltre il cap): il chiamante ripiega
 * sulla base TMDB, mai un poster rotto per un URL morto. L'abort del
 * chiamante (deadline render, budget) PROPAGA invece di diventare null: un
 * render abortito non deve continuare come zombie sul fallback.
 * La sicurezza SSRF non dipende dalla validazione dello schema ma da questi
 * check a ogni miss (DNS/IP + redirect manuali via safeFetchRemote).
 * Byte-cache 24h su URL salvato + failure cache 60s + download condiviso.
 */
export async function fetchValidatedCustomImage(
  rawUrl: string,
  signal: AbortSignal,
  deps?: CustomFetchDeps,
): Promise<Buffer | null> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError")
  const fetchRemote =
    deps?.fetchRemote ??
    ((url: string, sig: AbortSignal) =>
      safeFetchRemote(url, {
        signal: sig,
        isAllowedUrl: (u) => isAllowedResolveHost(u.hostname),
        maxRedirects: 3,
      }))
  const checkBlocked = deps?.checkBlocked ?? resolveAndCheckBlocked

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (!isAllowedResolveHost(parsed.hostname)) return null
  // Chiave = URL salvato normalizzato (non il finale post-redirect, che può
  // variare per geo/instance e frammenterebbe la cache).
  const key = parsed.href
  if (isRecentlyFailed(key)) return null
  const hit = peekImageBytes(key)
  if (hit) return hit

  let buf: Buffer | null
  try {
    buf = await sharedCustomDownload(key, signal, (sig) =>
      downloadAndValidateCustomImage(parsed, sig, fetchRemote, checkBlocked),
    )
  } catch (e) {
    // Abort del chiamante (deadline/budget): propaga, mai fallback zombie.
    if (isAbortError(e)) throw e
    return null
  }
  if (!buf) return null
  if (buf.length > 0 && buf.length <= CUSTOM_CACHE_MAX_BYTES) {
    storeImageBytes(key, buf)
  }
  return buf
}

/** Download + validazione di un URL già approvato in sintassi/allowlist.
 *  Il check SSRF corre QUI (una volta per download condiviso, fresco anche
 *  per i waiter tardivi), non prima: DNS rebinding safe per costruzione.
 *  Null su fallimento definitivo, throw solo su abort. */
async function downloadAndValidateCustomImage(
  parsed: URL,
  signal: AbortSignal,
  fetchRemote: (url: string, signal: AbortSignal) => Promise<Response>,
  checkBlocked: (url: string) => Promise<boolean>,
): Promise<Buffer | null> {
  try {
    if (await raceWithAbort(checkBlocked(parsed.href), signal)) return null
  } catch (e) {
    if (isAbortError(e)) throw e
    return null
  }
  let res: Response
  try {
    res = await fetchRemote(parsed.href, signal)
  } catch (e) {
    if (isAbortError(e)) throw e
    return null
  }
  if (!res.ok) return null
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (!contentType.startsWith("image/")) {
    log.warn("Custom poster is not an image", { host: parsed.hostname, contentType })
    return null
  }
  let buf: Buffer
  try {
    buf = await readBodyCapped(res, MAX_CUSTOM_IMAGE_BYTES)
  } catch (e) {
    if (isAbortError(e)) throw e
    if (!(e instanceof BodyTooLargeError)) log.warn("Custom poster body read failed", { host: parsed.hostname })
    return null
  }
  // Stesse regole del resolve (MIME raster, magic, pixel, no animate):
  // qualsiasi rifiuto → null + fallback TMDB, mai poster rotto.
  try {
    await validateImageBytes(buf, res.headers.get("content-type"))
    return buf
  } catch (e) {
    if (isAbortError(e)) throw e
    log.warn("Custom poster image rejected", {
      host: parsed.hostname,
      reason: e instanceof ImageValidationError ? e.reason : "unknown",
    })
    return null
  }
}

/** imgSrc che non lancia: ritorna null per i path non-TMDB/non-TVDB (es. URL
 *  custom nel posterPath di un mapping legacy) invece di far fallire il render. */
export function safeTmdbImgSrc(path: string): string | null {
  try {
    return imgSrc(path)
  } catch {
    return null
  }
}

/**
 * Gate R2 per i path immagine in query: TMDB/TVDB via imgSrc (invariato) +
 * URL esterni http(s) su host allowlist (solo `poster`, la base custom).
 * La SSRF piena (DNS/IP/redirect) resta al fetch dentro
 * fetchPosterBaseWithCustom; qui solo check sintattico veloce prima di
 * cache key/slot/inflight. Logo/backdrop restano strict (mai URL custom).
 */
export function isAllowedQueryImagePath(value: string): boolean {
  try {
    imgSrc(value)
    return true
  } catch {
    // Non-TMDB: solo URL http(s) su host allowlist delle sorgenti custom.
    try {
      const u = new URL(value.trim())
      return (
        (u.protocol === "http:" || u.protocol === "https:") &&
        isAllowedResolveHost(u.hostname)
      )
    } catch {
      return false
    }
  }
}

/** Selezione pura della base: custom valida vince, altrimenti TMDB, altrimenti null. */
export function pickPosterBase(custom: Buffer | null, tmdb: Buffer | null): PosterBaseResult | null {
  if (custom) return { buf: custom, custom: true }
  if (tmdb) return { buf: tmdb, custom: false }
  return null
}

/**
 * Base portrait con custom URL in PARALLELO al TMDB (non in serie: su Vercel
 * il render ha deadline 8.5s, un fallback seriale arriverebbe troppo tardi).
 * customPosterUrl null → solo TMDB, comportamento storico invariato.
 * tmdbUrl null (nessun fallback TMDB noto) → solo tentativo custom.
 * Budget custom 5s SOLO con fallback noto: oltre, il TMDB vince senza
 * aspettare (mai gara al primo arrivato: un custom valido ma lento non viene
 * ignorato finché resta nel budget). Senza fallback il custom aspetta fino
 * alla deadline del render. La deadline vera propaga sempre (mai zombie).
 */
export async function fetchPosterBaseWithCustom(
  customUrl: string | null | undefined,
  tmdbUrl: string | null,
  signal: AbortSignal,
  deps?: CustomFetchDeps,
): Promise<PosterBaseResult | null> {
  if (!customUrl) {
    if (!tmdbUrl) return null
    const tmdb = await fetchImg(tmdbUrl, signal).catch(() => null)
    return pickPosterBase(null, tmdb)
  }
  const budgetMs = deps?.budgetMs ?? CUSTOM_BUDGET_MS
  const customSignal = tmdbUrl ? combineAbortSignals(signal, AbortSignal.timeout(budgetMs)) : signal
  const [custom, tmdb] = await Promise.all([
    fetchValidatedCustomImage(customUrl, customSignal, deps).catch((e) => {
      // Deadline vera del render: propaga. Budget scaduto: null → TMDB.
      if (signal.aborted) throw e
      return null
    }),
    tmdbUrl ? fetchImg(tmdbUrl, signal).catch(() => null) : Promise.resolve(null),
  ])
  return pickPosterBase(custom, tmdb)
}

/**
 * Chiave analisi pixel per base custom: hash dell'URL, mai l'URL in chiaro
 * (lunghezza variabile e query potenzialmente instabili nella chiave cache).
 */
export function customBaseAnalysisKey(customUrl: string): string {
  return `portrait:custom:${hashKey(customUrl)}`
}

export interface EffectiveCustomUrlInput {
  /** `poster=` in query quando è un URL esterno (scelta esplicita non salvata). */
  readonly queryCustomUrl: string | null
  /** Qualsiasi `poster=` in query (URL o path TMDB): presente = scelta esplicita. */
  readonly hasQueryPoster: boolean
  /** customPosterUrl del mapping salvato. */
  readonly mappingCustomUrl: string | null
  /** True per le preview editor (`preview=1`), false per Stremio/cataloghi. */
  readonly isPreview: boolean
}

/**
 * Quale base custom usare, se alcuna — pura e testabile.
 * - Scelta query URL vince sempre (è l'azione più recente dell'utente).
 * - Senza query esplicita vale il salvato (anche in preview: stato iniziale).
 * - Query TMDB-path in preview = click su tile TMDB: vince sul salvato così
 *   la preview mostra davvero il tile cliccato (WYSIWYG).
 * - Query TMDB-path su Stremio = URL server-built: comanda lo stato salvato.
 */
export function resolveEffectiveCustomUrl(input: EffectiveCustomUrlInput): string | null {
  if (input.queryCustomUrl) return input.queryCustomUrl
  if (!input.hasQueryPoster || !input.isPreview) return input.mappingCustomUrl
  return null
}
