import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  clearUnlockedUser,
  currentPathUuid,
  getStoredUserPassword,
  getStoredUserToken,
  hasStoredCredential,
  isUserUnlocked,
  previewRequestHeaders,
  setStoredUserPassword,
  setStoredUserToken,
  userAuthHeaders,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import { scopedApiInit } from "@/lib/http"

const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"

function installStorages(): { local: Record<string, string>; session: Record<string, string> } {
  const local: Record<string, string> = {}
  const session: Record<string, string> = {}
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
  Object.defineProperty(window, "localStorage", { value: mem(local), configurable: true })
  Object.defineProperty(window, "sessionStorage", { value: mem(session), configurable: true })
  return { local, session }
}

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

beforeEach(() => {
  installStorages()
  setUrl("/")
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  __resetAdminTokenForTests()
})

afterEach(() => {
  setUrl("/")
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  __resetAdminTokenForTests()
  vi.unstubAllGlobals()
})

describe("user-token secret + password: tutto in memoria, zero localStorage", () => {
  it("password solo in memoria (mai in alcuno storage), muore col refresh", () => {
    setStoredUserPassword(UUID_A, "secret-pw-1")
    expect(getStoredUserPassword(UUID_A)).toBe("secret-pw-1")
    expect(window.localStorage.getItem(`pictorium-user-password:${UUID_A}`)).toBeNull()
    expect(window.sessionStorage.getItem(`pictorium-user-password:${UUID_A}`)).toBeNull()
    expect(hasStoredCredential(UUID_A)).toBe(true)
    setStoredUserPassword(UUID_A, "")
    expect(getStoredUserPassword(UUID_A)).toBeNull()
    expect(hasStoredCredential(UUID_A)).toBe(false)
  })

  it("userAuthHeaders: token vince, poi password, poi vuoto", () => {
    expect(userAuthHeaders(UUID_A)).toEqual({})
    setStoredUserPassword(UUID_A, "pw")
    expect(userAuthHeaders(UUID_A)).toEqual({ "x-user-password": "pw" })
    setStoredUserToken(UUID_A, "tok")
    expect(userAuthHeaders(UUID_A)).toEqual({ "x-user-token": "tok" })
  })

  it("secret persistente sul dispositivo (copiabile sempre), mai password", () => {
    setStoredUserToken(UUID_A, "tok-1")
    expect(getStoredUserToken(UUID_A)).toBe("tok-1")
    expect(getStoredUserToken(UUID_B)).toBeNull()
    // Scritto in localStorage: resta dopo il refresh (la sessione no).
    expect(window.localStorage.getItem(`pictorium-user-token:${UUID_A.toLowerCase()}`)).toBe("tok-1")
    expect(hasStoredCredential(UUID_A)).toBe(true)
    setStoredUserToken(UUID_A, "")
    expect(getStoredUserToken(UUID_A)).toBeNull()
    expect(window.localStorage.getItem(`pictorium-user-token:${UUID_A.toLowerCase()}`)).toBeNull()
    expect(hasStoredCredential(UUID_A)).toBe(false)
    // Null-safe.
    expect(getStoredUserToken(null as unknown as string)).toBeNull()
    expect(() => setStoredUserToken(null as unknown as string, "x")).not.toThrow()
  })
})

describe("sblocco di sessione", () => {
  beforeEach(() => {
    __resetUnlockedUsersForTests()
  })

  afterEach(() => {
    __resetUnlockedUsersForTests()
  })

  function unlock(uuid: string) {
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
  }

  it("locked di default, unlock via evento, clear e reset", () => {
    expect(isUserUnlocked(UUID_A)).toBe(false)
    expect(isUserUnlocked(null)).toBe(false)
    expect(isUserUnlocked("")).toBe(false)
    unlock(UUID_A)
    expect(isUserUnlocked(UUID_A)).toBe(true)
    // Case-insensitive come il resto del contratto.
    expect(isUserUnlocked(UUID_A.toUpperCase())).toBe(true)
    expect(isUserUnlocked(UUID_B)).toBe(false)
    clearUnlockedUser(UUID_A)
    expect(isUserUnlocked(UUID_A)).toBe(false)
    unlock(UUID_A)
    __resetUnlockedUsersForTests()
    expect(isUserUnlocked(UUID_A)).toBe(false)
  })

  it("eventi senza uuid valido non sbloccano nessuno", () => {
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: {} }))
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: "" } }))
    expect(isUserUnlocked(UUID_A)).toBe(false)
  })
})

describe("currentPathUuid", () => {
  it("preferisce il path ma ripiega sulla query valida", () => {
    setUrl(`/u/${UUID_A}/configure`)
    expect(currentPathUuid()).toBe(UUID_A)
    setUrl(`/u/non-un-uuid/configure?u=${UUID_B}`)
    expect(currentPathUuid()).toBe(UUID_B)
    setUrl(`/?user=${UUID_A}`)
    expect(currentPathUuid()).toBe(UUID_A)
    setUrl("/u/non-un-uuid/configure")
    expect(currentPathUuid()).toBeNull()
    setUrl("/")
    expect(currentPathUuid()).toBeNull()
  })
})

describe("previewRequestHeaders (auth transport of the Settings/preview XHR)", () => {
  function unlock() {
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID_A } }))
  }
  const previewUrl = (extra = "") =>
    `http://localhost:3000/api/poster/movie/19995?preview=1&u=${UUID_A}${extra}`

  it("locked namespace: no credentials, even with a stored secret", () => {
    setStoredUserToken(UUID_A, "tok")
    expect(previewRequestHeaders(previewUrl())).toEqual({})
  })

  it("unlocked namespace: the same credential scopedApiInit sends", () => {
    setStoredUserPassword(UUID_A, "pw")
    unlock()
    expect(previewRequestHeaders(previewUrl())).toEqual({ "x-user-password": "pw" })
    setStoredUserToken(UUID_A, "tok")
    expect(previewRequestHeaders(previewUrl())).toEqual({ "x-user-token": "tok" })
  })

  it("URL without a valid scoped uuid never carries a credential", () => {
    setStoredUserToken(UUID_A, "tok")
    unlock()
    expect(previewRequestHeaders("http://localhost:3000/api/poster/movie/19995?preview=1")).toEqual({})
    expect(previewRequestHeaders(`http://localhost:3000/api/poster/movie/19995?preview=1&u=not-a-uuid`)).toEqual({})
  })

  it("another namespace's unlock never leaks", () => {
    setStoredUserToken(UUID_B, "tok-b")
    unlock() // unlocks A only
    expect(previewRequestHeaders(`http://localhost:3000/api/poster/movie/19995?preview=1&u=${UUID_B}`)).toEqual({})
  })
})

describe("scopedApiInit con password", () => {
  function unlock() {
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID_A } }))
  }

  it("pre-unlock: ?u= sì, credenziali mai (modal chiusa con X)", () => {
    setUrl(`/u/${UUID_A}/configure`)
    setStoredUserPassword(UUID_A, "pw")
    const out = scopedApiInit("/api/mappings", {})
    expect(out.path).toBe(`/api/mappings?u=${UUID_A}`)
    expect(out.headers).toBeUndefined()
  })

  it("allega x-user-password quando c'è solo la sessione (dopo unlock)", () => {
    setUrl(`/u/${UUID_A}/configure`)
    setStoredUserPassword(UUID_A, "pw")
    unlock()
    const out = scopedApiInit("/api/mappings", {})
    expect(out.path).toBe(`/api/mappings?u=${UUID_A}`)
    expect(out.headers).toEqual({ "x-user-password": "pw" })
  })

  it("il token vince sulla password (dopo unlock)", () => {
    setUrl(`/u/${UUID_A}/configure`)
    setStoredUserPassword(UUID_A, "pw")
    setStoredUserToken(UUID_A, "tok")
    unlock()
    const out = scopedApiInit("/api/mappings", {})
    expect(out.headers).toEqual({ "x-user-token": "tok" })
  })

  it("header espliciti mai sovrascritti", () => {
    setUrl(`/u/${UUID_A}/configure`)
    setStoredUserPassword(UUID_A, "pw")
    const out = scopedApiInit("/api/mappings", { headers: { "x-user-token": "explicit" } })
    expect(out.headers).toEqual({ "x-user-token": "explicit" })
  })
})

describe("zero memoria cross-test: reset credenziali", () => {
  it("ogni test parte senza credenziali residue", () => {
    // Il beforeEach azzera mappe memoria: niente leak tra test.
    expect(getStoredUserToken(UUID_A)).toBeNull()
    expect(getStoredUserPassword(UUID_A)).toBeNull()
    expect(hasStoredCredential(UUID_A)).toBe(false)
  })
})
