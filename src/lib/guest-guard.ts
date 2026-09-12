"use client"

// Guard ospite: impedisce che un visitatore da link altrui sovrascriva
// silenziosamente i default server (es. cambio lingua → cambio regione →
// auto-PUT /api/defaults). La scrittura locale avviene sempre (il browser
// dell'ospite deve funzionare); a saltare è solo il sync server.
//
// Client-safe: solo window.location + GET /api/auth/pin (endpoint pubblico,
// il cookie HttpOnly di sessione viaggia da solo nella fetch).

export interface AdminState {
  readonly hasPin: boolean
  readonly authenticated: boolean
}

let foreignCache: boolean | null = null

/** True se l'app è stata aperta da link altrui (?u/?user/?config/?c o path /u/ /c/). */
export function isForeignUrl(): boolean {
  if (typeof window === "undefined") return false
  if (foreignCache !== null) return foreignCache
  const params = new URLSearchParams(window.location.search)
  foreignCache =
    params.has("u") ||
    params.has("user") ||
    params.has("config") ||
    params.has("c") ||
    window.location.pathname.startsWith("/u/") ||
    window.location.pathname.startsWith("/c/")
  return foreignCache
}

let adminCache: Promise<AdminState> | null = null

/** Stato PIN/sessione (cachato; i fallimenti di rete non si memoizzano). */
export function fetchAdminState(): Promise<AdminState> {
  if (!adminCache) {
    adminCache = fetch("/api/auth/pin")
      .then((r) => (r.ok ? r.json() : null))
      .then((d): AdminState => ({
        hasPin: d?.hasPin === true,
        authenticated: d?.authenticated === true,
      }))
    // Fallimento (rete/server): non congelarlo — il PUT fallirebbe comunque
    // e il percorso d'errore esistente gestisce retry/toast.
    adminCache.catch(() => {
      adminCache = null
    })
  }
  return adminCache
}

/**
 * True quando il sync server va saltato: ospite (link altrui) senza sessione
 * su istanza protetta da PIN. Istanze aperte (niente PIN) restano invariate
 * per design; il proprietario con sessione passa sempre. Su errore di rete
 * non si salta (il PUT fallirebbe da sé col percorso esistente).
 */
export async function shouldSkipServerSync(): Promise<boolean> {
  if (!isForeignUrl()) return false
  const admin = await fetchAdminState().catch(
    (): AdminState => ({ hasPin: false, authenticated: false }),
  )
  return admin.hasPin && !admin.authenticated
}

/** Solo per i test: azzera le memo. */
export function resetGuestGuardForTests(): void {
  foreignCache = null
  adminCache = null
}
