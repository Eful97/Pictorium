import { currentPathUuid, getStoredUserPassword, getStoredUserToken, isUserUnlocked, retryWithPasswordAuth } from "./user-token"
import { applyAdminAuthHeaders } from "./admin-token"

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
const SCOPED_PREFIXES = ["/api/mappings", "/api/defaults", "/api/users/", "/api/tmdb", "/api/mdblist", "/api/awards", "/api/trending", "/api/flixpatrol", "/api/tvdb", "/api/fanart", "/api/preview", "/api/poster-fit", "/api/presets", "/api/resolve-image", "/api/custom-rating"]

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
  const { timeout = 15000, ...fetchInit } = init
  const scoped = scopedApiInit(input, fetchInit)
  const scopedInit = { ...fetchInit, headers: applyAdminAuthHeaders(scoped.path, scoped.headers) }
  const res = await fetch(scoped.path, { ...scopedInit, signal: scopedInit.signal ?? AbortSignal.timeout(timeout) })
  // Secret stantio + password fresca: un solo retry con password (butta il
  // secret se il retry passa). Senza entrambe le credenziali è passthrough.
  return (await retryWithPasswordAuth(scoped.path, scopedInit, res)) ?? res
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

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const signalPair = externalSignal
      ? combineAbortSignals(externalSignal, controller.signal)
      : null

    const combinedSignal = signalPair?.signal ?? controller.signal

    try {
      let res = await fetch(path, { ...scopedOpts, signal: combinedSignal })
      // Secret stantio + password fresca: un solo retry con password prima di
      // trattare il 401 come definitivo (vedi userFetch sopra).
      res = (await retryWithPasswordAuth(path, scopedOpts, res)) ?? res

      if (!res.ok) {
        // Fix L21: retry anche per i 5xx (il server può essere in riavvio o
        // transitoriamente sovraccarico). Prima solo il 429 ritentava: un
        // timeout/500 dell'upstream falliva subito e l'utente vedeva
        // l'errore anche se un attimo dopo il server rispondeva.
        if (attempt < retries) {
          if (res.status === 429) {
            await delay(parseRetryAfter(res.headers.get("Retry-After")))
            continue
          }
          if (res.status >= 500) {
            await delay(1000 * (attempt + 1))
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
      if (isAbortError(err)) throw err
      if (attempt < retries) {
        await delay(1000 * (attempt + 1))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
      signalPair?.cleanup()
    }
  }
  throw new Error("Unreachable")
}

function combineAbortSignals(external: AbortSignal, internal: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  external.addEventListener("abort", onAbort, { once: true })
  internal.addEventListener("abort", onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      external.removeEventListener("abort", onAbort)
      internal.removeEventListener("abort", onAbort)
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Parsa l'header `Retry-After` (429). Accetta sia delta-secondi che HTTP-date.
 * Su input malformato o data già passata torna a un fallback breve; un cap di
 * 30s evita che un valore gigante (o una data lontana) congelì le retry.
 */
function parseRetryAfter(header: string | null): number {
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
