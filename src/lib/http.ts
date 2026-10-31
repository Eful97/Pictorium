import { currentPathUuid, getStoredUserPassword, getStoredUserToken, isUserUnlocked, retryWithPasswordAuth } from "./user-token"
import { applyAdminAuthHeaders } from "./admin-token"
import { combineAbortSignals, raceWithAbort } from "./abort-signal"

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

// Famiglie API namespaced (multi-user): solo a queste si aggiungono `?u=` e
// `x-user-token`. `POST /api/users` (creazione identità, pre-uuid) è esclusa
// di proposito: il prefisso richiede lo slash finale. Le famiglie proxy
// upstream (tmdb/mdblist/awards/trending/flixpatrol/tvdb) sono incluse: senza
// `?u=` il server non può risolvere le chiavi salvate nel profilo (chiave
// salvata ma poster vuoti su profilo fresco).
const SCOPED_PREFIXES = ["/api/mappings", "/api/defaults", "/api/users/", "/api/tmdb", "/api/mdblist", "/api/awards", "/api/trending", "/api/flixpatrol", "/api/tvdb", "/api/fanart", "/api/preview", "/api/poster-fit", "/api/resolve-image", "/api/custom-rating"]

function isScopedPath(path: string): boolean {
  if (!path.startsWith("/api/")) return false
  return SCOPED_PREFIXES.some((p) => path === p || path.startsWith(p))
}

function mergeNamedHeader(
  headers: HeadersInit | undefined,
  name: string,
  value: string,
): HeadersInit {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    if (!headers.get("x-user-token") && !headers.get("authorization") && !headers.get("x-user-password")) {
      headers.set(name, value)
    }
    return headers
  }
  if (Array.isArray(headers)) {
    const has = headers.some(([k]) => {
      const kl = k.toLowerCase()
      return kl === "x-user-token" || kl === "authorization" || kl === "x-user-password"
    })
    return has ? headers : [...headers, [name, value] as [string, string]]
  }
  const record = { ...(headers as Record<string, string> | undefined) }
  const keys = Object.keys(record).map((k) => k.toLowerCase())
  if (!keys.includes("x-user-token") && !keys.includes("authorization") && !keys.includes("x-user-password")) {
    record[name] = value
  }
  return record
}

/**
 * Applica il namespace utente a una chiamata API: `?u=` sempre (identità
 * pubblica, serve anche a Stremio) + credenziale (`x-user-token` o
 * `x-user-password`) SOLO se sbloccato in sessione. Senza unlock, niente
 * header auth: chiudere il modal con la X non lascia una sessione operativa
 * (letture pubbliche ok, scritture 401). Header espliciti del chiamante
 * vincono sempre (mai sovrascritti).
 */
export function scopedApiInit(
  path: string,
  init?: { headers?: HeadersInit },
): { path: string; headers: HeadersInit | undefined } {
  const uuid = currentPathUuid()
  if (!uuid || !isScopedPath(path)) return { path, headers: init?.headers }
  let out = path
  if (!/[?&]u=/.test(path)) out += (path.includes("?") ? "&" : "?") + `u=${uuid}`
  if (!isUserUnlocked(uuid)) return { path: out, headers: init?.headers }
  const token = getStoredUserToken(uuid)
  if (token) return { path: out, headers: mergeNamedHeader(init?.headers, "x-user-token", token) }
  const password = getStoredUserPassword(uuid)
  if (password) return { path: out, headers: mergeNamedHeader(init?.headers, "x-user-password", password) }
  return { path: out, headers: init?.headers }
}

/**
 * Fetch namespaced (multi-user): come fetch ma con `?u=` + `x-user-token`
 * automatici sui path utente. Per le chiamate con retry/timeout usare http().
 * Timeout di default 15s (stesso di http): senza, un upstream appeso lascia
 * `loading` per sempre (es. /api/poster-fit su render incastrato).
 */
export async function userFetch(input: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 15000, signal: externalSignal, ...fetchInit } = init
  const scoped = scopedApiInit(input, fetchInit)
  const scopedInit = { ...fetchInit, headers: applyAdminAuthHeaders(scoped.path, scoped.headers) }
  // The timeout and the caller cancellation share one composed signal, used
  // by both the first fetch and the password-auth retry below.
  const signal = combineAbortSignals(externalSignal ?? undefined, timeout)
  throwIfAborted(signal)
  // M1: concurrent identical scoped GETs share one round-trip. Responses fan
  // out via clone() (a Response body is single-use): the shared original is
  // never consumed, so late joiners can still clone it. Unit fetch-mocks
  // return Response-likes without clone(): those fall through shared (same
  // as sequential calls would observe) — production fetch always returns
  // real Responses and takes the clone path.
  const fanOut = (r: Response): Response =>
    typeof r.clone === "function" ? r.clone() : r
  const method = ((fetchInit.method ?? "GET") as string).toUpperCase()
  const hasBody = fetchInit.body !== undefined && fetchInit.body !== null
  const key = inflightGetKey(method, scoped.path, hasBody)
  if (!key) {
    const res = await fetch(scoped.path, { ...scopedInit, signal })
    // Secret stantio + password fresca: un solo retry con password (butta il
    // secret se il retry passa). Senza entrambe le credenziali è passthrough.
    return (await retryWithPasswordAuth(scoped.path, { ...scopedInit, signal }, res)) ?? res
  }
  const existing = lookupShared(key)
  // The fan-out copy happens AFTER the abort race on the returned chain, so
  // no derived promise is ever left without a handler on the early-abort path.
  if (existing) return raceWithAbort(existing as Promise<Response>, externalSignal ?? undefined).then(fanOut)
  const shared = trackShared(key, externalSignal ?? undefined, async () => {
    const res = await fetch(scoped.path, { ...scopedInit, signal })
    return (await retryWithPasswordAuth(scoped.path, { ...scopedInit, signal }, res)) ?? res
  })
  return raceWithAbort(shared as Promise<Response>, externalSignal ?? undefined).then(fanOut)
}

interface ApiOptions extends Omit<RequestInit, "signal"> {
  timeout?: number
  retries?: number
  signal?: AbortSignal
}

export async function http<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { timeout = 15000, retries = 2, signal: externalSignal, ...fetchOpts } = opts
  // Namespace utente (multi-user): `?u=` + `x-user-token` automatici sui
  // path scoped quando si è su un link `/u/<uuid>`. Fuori da lì è passthrough.
  const scoped = scopedApiInit(path, { headers: fetchOpts.headers })
  path = scoped.path
  const scopedOpts = { ...fetchOpts, headers: applyAdminAuthHeaders(path, scoped.headers) }

  // M1: concurrent identical scoped GETs share one attempt loop. Joiners get
  // an isolated copy (JSON round-trip) so no caller can mutate the shared
  // value; an already-aborted caller never joins (existing abort tests stay
  // exact). First caller's timeout/retry budget governs the shared fetch.
  const method = ((fetchOpts.method ?? "GET") as string).toUpperCase()
  const hasBody = fetchOpts.body !== undefined && fetchOpts.body !== null
  const key = inflightGetKey(method, path, hasBody)
  const run = async (): Promise<T> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Fresh per-attempt budget: the timeout restarts on every attempt while
    // the caller cancellation stays effective. The auth retry below belongs
    // to this attempt and shares its effective signal. Backoff waits use only
    // caller cancellation, since the completed attempt's budget may expire.
    const combinedSignal = combineAbortSignals(externalSignal ?? undefined, timeout)
    throwIfAborted(combinedSignal)

    try {
      let res = await fetch(path, { ...scopedOpts, signal: combinedSignal })
      // Secret stantio + password fresca: un solo retry con password prima di
      // trattare il 401 come definitivo (vedi userFetch sopra).
      res = (await retryWithPasswordAuth(path, { ...scopedOpts, signal: combinedSignal }, res)) ?? res

      if (!res.ok) {
        // Fix L21: retry anche per i 5xx (il server può essere in riavvio o
        // transitoriamente sovraccarico). Prima solo il 429 ritentava: un
        // timeout/500 dell'upstream falliva subito e l'utente vedeva
        // l'errore anche se un attimo dopo il server rispondeva.
        if (attempt < retries) {
          if (res.status === 429) {
            await delay(parseRetryAfter(res.headers.get("Retry-After")), externalSignal)
            continue
          }
          if (res.status >= 500) {
            await delay(1000 * (attempt + 1), externalSignal)
            continue
          }
        }
        throw new ApiError(res.status, `API ${res.status}: ${path}`)
      }

      if (res.status === 204) return null as T
      const text = await res.text()
      if (!text) return null as T
      return JSON.parse(text) as T
    } catch (err) {
      if (err instanceof ApiError) throw err
      // A caller abort may carry a custom reason (not an AbortError): an
      // aborted attempt signal still means "do not retry", with no backoff.
      if (combinedSignal.aborted || isAbortError(err)) throw err
      if (attempt < retries) {
        await delay(1000 * (attempt + 1), externalSignal)
        continue
      }
      throw err
    }
  }
  throw new Error("Unreachable")
  }
  if (!key) return run()
  const existing = lookupShared(key) as Promise<T> | undefined
  // The isolation copy happens AFTER the abort race on the returned chain,
  // so no derived promise is ever left without a handler on early abort.
  const isolate = (v: T): T =>
    v !== null && typeof v === "object" ? (JSON.parse(JSON.stringify(v)) as T) : v
  if (existing) {
    return raceWithAbort(existing, externalSignal ?? undefined).then(isolate)
  }
  const shared = trackShared(key, externalSignal ?? undefined, run)
  return raceWithAbort(shared, externalSignal ?? undefined).then(isolate)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError")
  }
}

/**
 * Retry backoff wait that an abort cuts short: no further fetch follows a
 * cancellation. The listener is always removed on settle (no leak on the
 * caller signal) and an already-aborted signal rejects without waiting.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortion(signal))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(signal ? abortion(signal) : new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function abortion(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError")
}

/**
 * M1: inflight GET dedupe. Boot fans out several identical GETs
 * (e.g. 4x `GET /api/defaults` from context, defaults hydration, custom
 * catalogs, ranking sources): concurrent identical scoped GETs share one
 * network round-trip instead of racing the server 4x. Keyed by the full
 * scoped path (namespace `?u=` included), so different users/spaces never
 * share. Entries live only while the request is inflight (deleted on
 * settle) — sequential calls always re-fetch. Non-GET and bodied requests
 * never dedupe. A joiner with its own abort signal stops waiting without
 * cancelling the shared fetch (first caller's timeout budget governs it);
 * an already-aborted caller never joins. A fetch whose owner already aborted
 * never serves joiners either (editor load-supersede aborts the previous
 * controller before starting the next load, so joining it would join a dying
 * fetch instead of issuing the load's own request).
 */
const inflightGets = new Map<string, InflightEntry>()

interface InflightEntry {
  promise: Promise<unknown>
  /** Owning caller's external signal (undefined when the caller passed none). */
  signal?: AbortSignal
}

function inflightGetKey(method: string, path: string, hasBody: boolean): string | null {
  if (method !== "GET" || hasBody) return null
  return `GET ${path}`
}

/**
 * A superseded (aborted) owner never serves joiners: editor loads abort
 * their controller before starting the next load, and the next load must
 * issue its own fetch on its own controller (per-load abort/count
 * semantics) instead of joining a fetch that is already dying. The dead
 * entry is dropped so the caller stores a fresh one.
 */
function lookupShared(key: string): Promise<unknown> | undefined {
  const entry = inflightGets.get(key)
  if (!entry) return undefined
  if (entry.signal?.aborted) {
    if (inflightGets.get(key) === entry) inflightGets.delete(key)
    return undefined
  }
  return entry.promise
}

function trackShared<T>(key: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const entry: InflightEntry = { promise: undefined as unknown as Promise<unknown>, signal }
  const p = run()
  entry.promise = p
  inflightGets.set(key, entry)
  const cleanup = () => { if (inflightGets.get(key) === entry) inflightGets.delete(key) }
  p.then(cleanup, cleanup)
  return p
}

/**
 * Parsa l'header `Retry-After` (429). Accetta sia delta-secondi che HTTP-date.
 * Su input malformato o data già passata torna a un fallback breve; un cap di
 * 30s evita che un valore gigante (o una data lontana) congelì le retry.
 * Esportata per il retry limitato dell'hydration defaults (stessa semantica).
 */
export function parseRetryAfter(header: string | null): number {
  const raw = (header || "").trim()
  if (!raw) return 1000
  if (/^\d+$/.test(raw)) {
    const seconds = Math.min(Number(raw), 30)
    return seconds * 1000
  }
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    const waitMs = asDate - Date.now()
    if (waitMs > 0) return Math.min(waitMs, 30_000)
    return 1000 // data già passata → retry subito
  }
  return 1000
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const name = (err as { name?: string }).name
  return name === "AbortError" || name === "TimeoutError"
}
