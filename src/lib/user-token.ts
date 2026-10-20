"use client"

// Contratto client delle credenziali utente (multi-user, stile AIOmetadata):
// la password vive SOLO in memoria di sessione (muore col refresh), il secret
// di recupero resta sul dispositivo (localStorage) così è sempre copiabile
// dalle impostazioni; non viaggiano MAI in URL/query/log. Ogni refresh
// richiede di nuovo password o secret per SBLOCCARE la sessione (niente
// auto-login): l'unico rientro esterno è il pulsante "modifica config" di
// Stremio/Nuvio (configurationUrl). Li scrivono il link di recovery
// (`/u/<uuid>/configure#key=<secret>`), la modal di sblocco e il form
// password; li leggono userFetch (header `x-user-token` / `x-user-password`)
// e il guest-guard (proprietario).

/** Evento emesso quando il token utente viene (ri)sbloccato. */
export const USER_UNLOCK_EVENT = "pictorium:user-unlock"

/** Evento per chiedere la riapertura del modal di sblocco (icona UUID). */
export const USER_UNLOCK_REQUEST_EVENT = "pictorium:user-unlock-request"

/** Chiede al modal di sblocco di riaprirsi (resta chiuso se mai aperto). */
export function requestUserUnlock(uuid?: string): void {
  try {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_REQUEST_EVENT, { detail: { uuid } }))
  } catch {
    /* mai rompere il chiamante */
  }
}

/**
 * Sblocchi di sessione (solo memoria): lo sblocco vale per refresh. Senza
 * unlock di sessione, scopedApiInit non allega header auth e le sezioni
 * gestione restano nascoste — chiudere il modal con la X non lascia una
 * sessione operativa alle spalle.
 */
const unlockedSessions = new Set<string>()

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(USER_UNLOCK_EVENT, (e) => {
    const id = (e as CustomEvent<{ uuid?: string }>).detail?.uuid
    if (typeof id === "string" && id) unlockedSessions.add(id.trim().toLowerCase())
  })
}

/** True se l'UUID è stato sbloccato in questa sessione (modal, recovery, save autenticato). */
export function isUserUnlocked(uuid: string | null | undefined): boolean {
  if (typeof uuid !== "string" || !uuid) return false
  return unlockedSessions.has(uuid.trim().toLowerCase())
}

/** Revoca lo sblocco di sessione (forget spazio). Non tocca gli storage. */
export function clearUnlockedUser(uuid: string | null | undefined): void {
  if (typeof uuid !== "string" || !uuid) return
  unlockedSessions.delete(uuid.trim().toLowerCase())
}

/** Solo test: azzera gli sblocchi di sessione. */
export function __resetUnlockedUsersForTests(): void {
  unlockedSessions.clear()
}

/** Solo test: azzera le credenziali di sessione (secret + password in memoria). */
export function __resetUserCredentialsForTests(): void {
  memoryTokens.clear()
  memoryPasswords.clear()
}

/** UUID v4 canonico 8-4-4-4-12 (stessa severità di user-auth, non il vecchio mix 36-char). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Normalizzazione unica: trim + lowercase (usata da secret e password). */
function normalizeUuidId(uuid: string): string {
  return uuid.trim().toLowerCase()
}

/**
 * Secret di recupero: resta sul dispositivo (localStorage) così è sempre
 * copiabile dalla sezione UUID, ma da solo NON sblocca mai (serve l'unlock di
 * sessione a ogni refresh). Fallback in memoria quando lo storage è
 * indisponibile (jsdom senza origin, Safari ITP che lancia): la sessione
 * funziona comunque, solo senza persistenza.
 */
const memoryTokens = new Map<string, string>()

function userTokenStorageKey(uuid: string): string {
  return `pictorium-user-token:${normalizeUuidId(uuid)}`
}

function storageGet(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    return window.localStorage.getItem(key) || null
  } catch {
    return null
  }
}

function storageSet(key: string, value: string | null): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function getStoredUserToken(uuid: string): string | null {
  try {
    if (typeof window === "undefined" || typeof uuid !== "string") return null
    const id = normalizeUuidId(uuid)
    return storageGet(userTokenStorageKey(id)) ?? memoryTokens.get(id) ?? null
  } catch {
    return null
  }
}

export function setStoredUserToken(uuid: string, token: string): void {
  try {
    if (typeof window === "undefined" || typeof uuid !== "string") return
    const id = normalizeUuidId(uuid)
    if (token) {
      if (!storageSet(userTokenStorageKey(id), token)) memoryTokens.set(id, token)
      else memoryTokens.delete(id)
    } else {
      storageSet(userTokenStorageKey(id), null)
      memoryTokens.delete(id)
    }
  } catch {
    /* mai rompere il chiamante */
  }
}

/** Password di sessione (solo memoria: muore col refresh, mai in alcuno storage). */
const memoryPasswords = new Map<string, string>()

export function getStoredUserPassword(uuid: string): string | null {
  try {
    if (typeof window === "undefined" || typeof uuid !== "string") return null
    return memoryPasswords.get(normalizeUuidId(uuid)) ?? null
  } catch {
    return null
  }
}

export function setStoredUserPassword(uuid: string, password: string): void {
  try {
    if (typeof window === "undefined" || typeof uuid !== "string") return
    const id = normalizeUuidId(uuid)
    if (password) memoryPasswords.set(id, password)
    else memoryPasswords.delete(id)
  } catch {
    /* mai rompere il chiamante per una password */
  }
}

/** True se il browser ha una credenziale (secret o password di sessione). */
export function hasStoredCredential(uuid: string): boolean {
  return !!getStoredUserToken(uuid) || !!getStoredUserPassword(uuid)
}

/**
 * Bounded wait for the memory-only session unlock of a namespace (pure
 * client, no I/O): resolves `true` immediately when already unlocked, else
 * on the matching `pictorium:user-unlock` event, else `false` on timeout
 * (never rejects, never hangs the caller past `timeoutMs`).
 *
 * Needed by full-load landings like the Lab "Use for title" handoff return:
 * `location.assign` drops the memory session, the unlock modal opens by
 * design, and owner-gated follow-ups (preset fetch) must wait for the user
 * to unlock instead of failing instantly while the modal is still open.
 */
export function waitForUserUnlock(
  uuid: string | null | undefined,
  timeoutMs = 60_000,
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false)
  if (isUserUnlocked(uuid)) return Promise.resolve(true)
  const want = typeof uuid === "string" ? uuid.trim().toLowerCase() : ""
  if (!want) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
      resolve(value)
    }
    const onUnlock = (e: Event): void => {
      const id = (e as CustomEvent<{ uuid?: string }>).detail?.uuid
      if (typeof id === "string" && id.trim().toLowerCase() === want) finish(true)
    }
    const timer = window.setTimeout(() => finish(false), Math.max(0, timeoutMs))
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
  })
}

/** Header auth per il namespace: secret oppure password di sessione. */
export function userAuthHeaders(uuid: string): Record<string, string> {
  const token = getStoredUserToken(uuid)
  if (token) return { "x-user-token": token }
  const password = getStoredUserPassword(uuid)
  if (password) return { "x-user-password": password }
  return {}
}

function plainHeaders(h?: HeadersInit): Record<string, string> {
  if (!h) return {}
  if (typeof Headers !== "undefined" && h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => { out[k] = v })
    return out
  }
  if (Array.isArray(h)) return Object.fromEntries(h)
  return { ...(h as Record<string, string>) }
}

/**
 * UUID pinned in the request path query (`?u=`/`?user=`), respecting the
 * existing scoping (scopedApiInit). Null when the request carries no scope.
 */
function requestPathUuid(path: string): string | null {
  try {
    const qIndex = path.indexOf("?")
    if (qIndex < 0) return null
    const query = path.slice(qIndex + 1).split("#")[0]
    if (!query) return null
    const sp = new URLSearchParams(query)
    for (const raw of [sp.get("u"), sp.get("user")]) {
      if (typeof raw !== "string") continue
      const id = normalizeUuidId(raw)
      if (UUID_RE.test(id)) return id
    }
    return null
  } catch {
    return null
  }
}

/**
 * Retry 401 con la password di sessione (per `http()`/`userFetch`): stesso
 * caso di fetchWithUserAuthRetry ma per il plumbing generico — il path porta
 * già `?u=` (scopedApiInit) e gli header il token stantio. Ritorna la Response
 * del retry o null se non applicabile (non-401, niente uuid, manca una delle
 * due credenziali). A retry riuscito butta il secret stantio.
 */
export async function retryWithPasswordAuth(
  path: string,
  init: { headers?: HeadersInit; method?: string; body?: BodyInit | null; signal?: AbortSignal | null },
  res: { status: number },
): Promise<Response | null> {
  if (res.status !== 401) return null
  const current = currentPathUuid()
  const pinned = requestPathUuid(path) ?? current
  if (!pinned) return null
  // Namespace guard: the request scope must still own the retry. A profile
  // switch mid-flight (B current, A requested) never sends B's password to
  // A, and token clearing stays pinned to the request scope.
  if (pinned !== current) return null
  const uuid = pinned
  const token = getStoredUserToken(uuid)
  const password = getStoredUserPassword(uuid)
  if (!token || !password) return null
  const headers = plainHeaders(init.headers)
  for (const k of Object.keys(headers)) {
    const kl = k.toLowerCase()
    if (kl === "x-user-token" || kl === "authorization") delete headers[k]
  }
  headers["x-user-password"] = password
  const retryInit: RequestInit = { ...init, headers }
  if (!retryInit.signal) {
    try {
      retryInit.signal = AbortSignal.timeout(15000)
    } catch {
      /* AbortSignal.timeout non disponibile: retry senza tetto */
    }
  }
  const retry = await fetch(path, retryInit)
  if (retry.ok) setStoredUserToken(uuid, "")
  return retry
}

/**
 * Fetch autenticata con retry anti secret-stantio: `userAuthHeaders` preferisce
 * il secret persistito alla password di sessione, ma il secret può essere
 * marcio (typo al login-secret, rotate da altro dispositivo) mentre la password
 * in memoria è fresca. In quel caso il primo 401 non significa "non
 * proprietario": ritenta una sola volta con la sola password e, se passa,
 * butta il secret stantio (provatamente invalido) così i fetch successivi
 * partono già sani. Senza password di sessione nessun retry (401 resta 401).
 */
export async function fetchWithUserAuthRetry(uuid: string, path: string, init: RequestInit = {}): Promise<Response> {
  const first = await fetch(path, { ...init, headers: { ...plainHeaders(init.headers), ...userAuthHeaders(uuid) } })
  if (first.status !== 401) return first
  const password = getStoredUserPassword(uuid)
  if (!password || !getStoredUserToken(uuid)) return first
  const retryHeaders = { ...plainHeaders(init.headers), ...userAuthHeaders(uuid) }
  for (const k of Object.keys(retryHeaders)) {
    const kl = k.toLowerCase()
    if (kl === "x-user-token" || kl === "authorization") delete retryHeaders[k]
  }
  retryHeaders["x-user-password"] = password
  const retry = await fetch(path, { ...init, headers: retryHeaders })
  if (retry.ok) setStoredUserToken(uuid, "")
  return retry
}

/** UUID del path `/u/<uuid>/…` o query `?u=`/`?user=`: primo candidato valido in ordine. */
export function currentPathUuid(): string | null {
  try {
    if (typeof window === "undefined") return null
    const pathMatch = window.location.pathname.match(/^\/u\/([^/]+)/)
    const sp = new URLSearchParams(window.location.search)
    for (const raw of [pathMatch?.[1], sp.get("u"), sp.get("user")]) {
      if (typeof raw !== "string") continue
      const id = normalizeUuidId(raw)
      if (UUID_RE.test(id)) return id
    }
    return null
  } catch {
    return null
  }
}
