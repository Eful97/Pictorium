"use client"

// Credenziale admin di sessione (istanza privata con PICTORIUM_ADMIN_TOKEN):
// il server richiede `x-admin-token`/`Authorization: Bearer` sulle route admin
// (warmup, cache, defaults, mappings, PIN), ma il client non lo inviava mai —
// senza token la UI restava chiusa fuori con 401 (fail-closed). Questo modulo
// tiene il token SOLO in sessione (sessionStorage + fallback in memoria:
// muore col tab, mai in localStorage/disco/URL/log) e lo allega alle chiamate
// /api/ same-origin. Header espliciti del chiamante vincono sempre.

const STORAGE_KEY = "pictorium_admin_token"

let memoryToken: string | null = null

function sessionGet(): string | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null
    return window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function sessionSet(value: string | null): boolean {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value)
    else window.sessionStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Token admin di sessione (null se mai sbloccato in questo tab). */
export function getAdminToken(): string | null {
  try {
    return sessionGet() ?? memoryToken
  } catch {
    return null
  }
}

/** Salva il token in sessione (trim; stringa vuota = dimentica). */
export function setAdminToken(token: string): void {
  try {
    const clean = typeof token === "string" ? token.trim() : ""
    if (!clean) {
      clearAdminToken()
      return
    }
    if (!sessionSet(clean)) memoryToken = clean
    else memoryToken = null
  } catch {
    /* mai rompere il chiamante */
  }
}

/** Dimentica il token di sessione. */
export function clearAdminToken(): void {
  try {
    sessionSet(null)
    memoryToken = null
  } catch {
    /* mai rompere il chiamante */
  }
}

/** True se un token admin è sbloccato in questa sessione. */
export function hasAdminToken(): boolean {
  return !!getAdminToken()
}

/** Header auth admin (vuoto se non sbloccato). */
export function adminAuthHeaders(): Record<string, string> {
  const token = getAdminToken()
  return token ? { "x-admin-token": token } : {}
}

function hasExplicitAdminAuth(headers: HeadersInit): boolean {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return !!(headers.get("x-admin-token") || headers.get("authorization"))
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => {
      const kl = k.toLowerCase()
      return kl === "x-admin-token" || kl === "authorization"
    })
  }
  return Object.keys(headers as Record<string, string>).some((k) => {
    const kl = k.toLowerCase()
    return kl === "x-admin-token" || kl === "authorization"
  })
}

/**
 * Allega `x-admin-token` agli header quando: path same-origin /api/, token in
 * sessione, nessun auth admin esplicita già presente. Fuori da /api/ è
 * passthrough (mai far trapelare il segreto verso URL terze).
 */
export function applyAdminAuthHeaders(
  path: string,
  headers: HeadersInit | undefined,
): HeadersInit | undefined {
  if (!path.startsWith("/api/")) return headers
  const token = getAdminToken()
  if (!token) return headers
  if (headers && hasExplicitAdminAuth(headers)) return headers
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.set("x-admin-token", token)
    return headers
  }
  if (Array.isArray(headers)) {
    return [...headers, ["x-admin-token", token] as [string, string]]
  }
  return { ...(headers as Record<string, string> | undefined), "x-admin-token": token }
}

/** Solo test: azzera il token di sessione. */
export function __resetAdminTokenForTests(): void {
  try {
    sessionSet(null)
  } catch {
    /* noop */
  }
  memoryToken = null
}
