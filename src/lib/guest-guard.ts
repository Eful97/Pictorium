"use client"

import { currentPathUuid, getStoredUserPassword, getStoredUserToken, isUserUnlocked } from "./user-token"

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
 * per design; il proprietario con sessione passa sempre.
 *
 * Multi-user: su path `/u/<uuid>` il proprietario SBLOCCATO in sessione
 * (token valido salvato + unlock via modal/recovery, verificato via status
 * chiavi) non è mai ospite; senza unlock è ospite read-only (mai sovrascrivere
 * il namespace altrui) anche con secret persistito — chiudere il modal con la
 * X non lascia sync attivi. Con flag OFF (endpoint 404) vale il percorso
 * legacy invariato.
 * Direzione fail del ramo multi-user: su errore di rete si salta il sync
 * (fail-closed per le write altrui — il contrario del ramo legacy, dove il
 * PUT fallirebbe da sé e il non-skip preserva il retry). Fail-closed qui è
 * voluto: meglio un default locale che un PUT su un namespace non verificato.
 */
export async function shouldSkipServerSync(): Promise<boolean> {
  const uuid = currentPathUuid()
  if (uuid) {
    // Pre-unlock (hard gate ancora aperto, in attesa di sblocco): niente
    // sync e niente validazioni di rete — locale soltanto, senza toast 401.
    // Lo sblocco (password, secret, recovery) emette USER_UNLOCK_EVENT e i
    // caller ritentano da lì.
    if (!isUserUnlocked(uuid)) {
      try {
        if (await isMultiUserServer()) return true
      } catch {
        return true
      }
    }
    const token = getStoredUserToken(uuid)
    if (token) {
      // Memo per (uuid, token): senza, ogni tick di autosave (debounced)
      // costerebbe una GET /keys + una PUT (raddoppio traffico write).
      // I fallimenti non si memoizzano (retry al prossimo tick come il PUT).
      const valid = await checkOwnerToken(uuid, token)
      if (valid === true) return false
      // null = endpoint 404 (flag OFF) → percorso legacy sotto (byte-identico).
      if (valid === null) {
        // fallthrough al percorso legacy
      } else if (await checkOwnerPasswordFallback(uuid)) {
        // Secret rifiutato (stantio: typo, rotate da altro device) ma password
        // di sessione valida: resta proprietario. Senza questo ramo un secret
        // marcio degradava a ospite anche con password fresca (stesso buco
        // del fetch chiavi, qui sul solo autosave).
        return false
      } else {
        return true
      }
    } else {
      // Password di sessione (stile AIO): stesso riconoscimento del secret.
      const password = getStoredUserPassword(uuid)
      if (password) {
        const valid = await checkOwnerPassword(uuid, password)
        if (valid === true) return false
        if (valid === null) {
          // fallthrough al percorso legacy
        } else {
          return true
        }
      } else {
        // Senza credenziali: ospite solo se il multi-user è attivo (altrimenti i
        // link /u/ legacy continuano a sincronizzare come prima).
        try {
          if (await isMultiUserServer()) return true
        } catch {
          return true
        }
      }
    }
  }
  if (!isForeignUrl()) return false
  const admin = await fetchAdminState().catch(
    (): AdminState => ({ hasPin: false, authenticated: false }),
  )
  return admin.hasPin && !admin.authenticated
}

export interface ServerStatus {
  readonly multiUser: boolean
  readonly hostedBy: "elfhosted" | null
}

let serverStatusCache: Promise<ServerStatus> | null = null

/** Stato pubblico del server (cachato; i fallimenti non si memoizzano). */
export function fetchServerStatus(): Promise<ServerStatus> {
  if (!serverStatusCache) {
    serverStatusCache = fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d): ServerStatus => ({
        multiUser: d?.multiUser === true,
        hostedBy: d?.hostedBy === "elfhosted" ? "elfhosted" : null,
      }))
    serverStatusCache.catch(() => {
      serverStatusCache = null
    })
  }
  return serverStatusCache
}

/** Flag multi-user del server (cachato; i fallimenti non si memoizzano). */
export function isMultiUserServer(): Promise<boolean> {
  return fetchServerStatus().then((s) => s.multiUser)
}

// Validazione token proprietario memoizzata per (uuid, token): true =
// proprietario, false = token errato/revocato (ospite), null = endpoint 404
// (flag OFF → percorso legacy). Solo i `true` si memoizzano (un 401 da
// wipe/revoke deve rivalutarsi al prossimo tick); gli errori di rete
// ritornano false senza memo (retry come il PUT).
// TTL 5 min sui `true`: una revoke ha al massimo 5 min di finestra residua
// sul solo autosave (le write server restano autenticate per-richiesta).
const ownerCheckCache = new Map<string, { valid: boolean; at: number }>()
const OWNER_CHECK_TTL_MS = 5 * 60 * 1000
const OWNER_CHECK_CAP = 50

async function checkOwnerToken(uuid: string, token: string): Promise<boolean | null> {
  const cacheKey = `t:${uuid}:${token}`
  const hit = ownerCheckCache.get(cacheKey)
  if (hit && Date.now() - hit.at < OWNER_CHECK_TTL_MS) return hit.valid
  let valid: boolean | null
  try {
    const res = await fetch(`/api/users/${uuid}/keys`, { headers: { "x-user-token": token } })
    if (res.ok) valid = true
    else if (res.status === 404) valid = null
    else valid = false
  } catch {
    return false
  }
  if (valid === true) {
    if (ownerCheckCache.size >= OWNER_CHECK_CAP) {
      const oldest = ownerCheckCache.keys().next().value
      if (oldest !== undefined) ownerCheckCache.delete(oldest)
    }
    ownerCheckCache.set(cacheKey, { valid: true, at: Date.now() })
  }
  return valid
}

/**
 * Fallback password quando il token è stato rifiutato: true = proprietario
 * (password di sessione valida), false/null = resta il verdetto del token
 * (null = flag OFF → percorso legacy). Evita che un secret stantio oscuri
 * una password fresca sul solo autosave.
 */
async function checkOwnerPasswordFallback(uuid: string): Promise<boolean> {
  const password = getStoredUserPassword(uuid)
  if (!password) return false
  return (await checkOwnerPassword(uuid, password)) === true
}

/**
 * Come sopra ma per la password di sessione (POST verify, bucket stretto
 * server-side). Stesse regole memo: solo i `true`, TTL 5 min.
 */
async function checkOwnerPassword(uuid: string, password: string): Promise<boolean | null> {
  const cacheKey = `p:${uuid}:${password}`
  const hit = ownerCheckCache.get(cacheKey)
  if (hit && Date.now() - hit.at < OWNER_CHECK_TTL_MS) return hit.valid
  let valid: boolean | null
  try {
    const res = await fetch(`/api/users/${uuid}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
    if (res.ok) valid = true
    else if (res.status === 404) valid = null
    else valid = false
  } catch {
    return false
  }
  if (valid === true) {
    if (ownerCheckCache.size >= OWNER_CHECK_CAP) {
      const oldest = ownerCheckCache.keys().next().value
      if (oldest !== undefined) ownerCheckCache.delete(oldest)
    }
    ownerCheckCache.set(cacheKey, { valid: true, at: Date.now() })
  }
  return valid
}

/** Solo per i test: azzera le memo. */
export function resetGuestGuardForTests(): void {
  foreignCache = null
  adminCache = null
  serverStatusCache = null
  ownerCheckCache.clear()
}

/**
 * Invalida il memo owner-check per un UUID (rotate secret/password, forget
 * spazio, wipe account): senza, un `true` memoizzato (TTL 5 min) direbbe
 * ancora "proprietario" per il vecchio token dopo la revoca — con autosave
 * che continua a scrivere per minuti. Le write server restano autenticate
 * per-richiesta (rifiutano subito il vecchio token), ma il memo non deve
 * sopravvivere alla revoca nemmeno sul solo autosave.
 */
export function invalidateOwnerCheck(uuid: string): void {
  if (typeof uuid !== "string" || !uuid) return
  const id = uuid.trim().toLowerCase()
  for (const key of [...ownerCheckCache.keys()]) {
    if (key === `t:${id}` || key.startsWith(`t:${id}:`) || key === `p:${id}` || key.startsWith(`p:${id}:`)) {
      ownerCheckCache.delete(key)
    }
  }
}
