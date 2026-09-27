import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchAdminState,
  isForeignUrl,
  resetGuestGuardForTests,
  shouldSkipServerSync,
} from "@/lib/guest-guard"
import { __resetUnlockedUsersForTests, USER_UNLOCK_EVENT } from "@/lib/user-token"
import { setStoredUserPassword, setStoredUserToken, __resetUserCredentialsForTests } from "@/lib/user-token"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

function mockPinApi(response: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => response })),
  )
}

describe("guest guard", () => {
  beforeEach(() => {
    resetGuestGuardForTests()
    __resetUnlockedUsersForTests()
    __resetUserCredentialsForTests()
    setUrl("/")
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    resetGuestGuardForTests()
    __resetUnlockedUsersForTests()
    __resetUserCredentialsForTests()
    setUrl("/")
    vi.unstubAllGlobals()
  })

  describe("isForeignUrl", () => {
    it("riconosce i link altrui (u/user/config/c e path /u/ /c/)", () => {
      for (const url of [
        "/?u=abc123",
        "/?user=abc123",
        "/?config=xyz",
        "/?c=xyz",
        "/u/abc123/configure",
        "/u/abc123/manifest.json",
        "/c/xyz/catalog/movie/pictorium-jw-movies",
      ]) {
        resetGuestGuardForTests()
        setUrl(url)
        expect(isForeignUrl()).toBe(true)
      }
    })

    it("URL propria (liscia o home) non è estranea", () => {
      for (const url of ["/", "/configure", "/cataloghi", "/?region=DE"]) {
        resetGuestGuardForTests()
        setUrl(url)
        expect(isForeignUrl()).toBe(false)
      }
    })
  })

  describe("shouldSkipServerSync", () => {
    it("mai su URL propria (nessuna fetch admin)", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
      vi.stubGlobal("fetch", fetchMock)
      setUrl("/")
      expect(await shouldSkipServerSync()).toBe(false)
      // Only the memoised /api/status lookup (multi-user check); never the
      // admin/PIN endpoint on a single-user instance's own URL.
      const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
      expect(urls.every((u) => u.includes("/api/status"))).toBe(true)
      expect(urls.some((u) => u.includes("/api/auth/pin"))).toBe(false)
    })

    it("skip su link altrui + PIN configurato + nessuna sessione", async () => {
      mockPinApi({ hasPin: true, authenticated: false })
      setUrl("/u/altro-uuid/configure")
      expect(await shouldSkipServerSync()).toBe(true)
    })

    it("no skip con sessione valida (è il proprietario)", async () => {
      mockPinApi({ hasPin: true, authenticated: true })
      setUrl("/u/altro-uuid/configure")
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("no skip su istanza aperta (niente PIN)", async () => {
      mockPinApi({ hasPin: false, authenticated: true })
      setUrl("/?config=xyz")
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("no skip su errore di rete (il PUT fallirebbe da sé)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline")
        }),
      )
      setUrl("/u/altro-uuid/configure")
      expect(await shouldSkipServerSync()).toBe(false)
    })
  })

  describe("fetchAdminState", () => {
    it("cachato tra chiamate, fallimenti non memoizzati", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ hasPin: true, authenticated: false }),
      }))
      vi.stubGlobal("fetch", fetchMock)
      await fetchAdminState()
      await fetchAdminState()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("multi-user owner", () => {
    const UUID = "11111111-1111-4111-8111-111111111111"

    beforeEach(() => {
      __resetUnlockedUsersForTests()
      __resetUserCredentialsForTests()
    })

    afterEach(() => {
      __resetUnlockedUsersForTests()
      __resetUserCredentialsForTests()
    })

    function unlock() {
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    }

    function mockFetchByUrl(handler: (url: string) => unknown): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const body = handler(String(url))
          if (body instanceof Error) throw body
          if (body === null) return { ok: false, status: 404, json: async () => ({}) }
          if (typeof body === "object" && body !== null && "__status" in body) {
            const { __status, ...rest } = body as { __status: number } & Record<string, unknown>
            return { ok: __status >= 200 && __status < 300, status: __status, json: async () => rest }
          }
          return { ok: true, status: 200, json: async () => body }
        }),
      )
    }

    function stubToken(token: string | null): void {
      // Credenziali di sessione (memoria, come in produzione): niente storage.
      __resetUserCredentialsForTests()
      if (token) setStoredUserToken(UUID, token)
    }

    it("proprietario con token valido: mai ospite", async () => {
      stubToken("secret")
      mockFetchByUrl((url) => (url.includes(`/api/users/${UUID}/keys`) ? {} : { hasPin: false, authenticated: false }))
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("token non valido: ospite", async () => {
      stubToken("secret")
      mockFetchByUrl((url) => {
        if (url.includes(`/api/users/${UUID}/keys`)) return { __status: 401 }
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(true)
    })

    it("senza token: ospite solo se multi-user attivo", async () => {
      stubToken(null)
      mockFetchByUrl((url) => {
        if (url.includes("/api/status")) return { multiUser: true }
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(true)

      resetGuestGuardForTests()
      stubToken(null)
      mockFetchByUrl((url) => {
        if (url.includes("/api/status")) return { multiUser: false }
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("memoizza il token valido: una sola GET per tick ripetuti", async () => {
      stubToken("secret")
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes(`/api/users/${UUID}/keys`)) {
          return { ok: true, status: 200, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({ hasPin: false, authenticated: false }) }
      })
      vi.stubGlobal("fetch", fetchMock)
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
      expect(await shouldSkipServerSync()).toBe(false)
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/keys"))).toHaveLength(1)
    })

    it("password in memoria valida: mai ospite (stile AIO)", async () => {
      stubToken(null)
      setStoredUserPassword(UUID, "pw-giusta-1")
      unlock()
      mockFetchByUrl((url) => {
        if (url.includes(`/api/users/${UUID}/verify`)) return {}
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
      setStoredUserPassword(UUID, "")
    })

    it("pre-unlock con token: skip senza validare in rete (niente GET /keys)", async () => {
      stubToken("secret")
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ multiUser: true }) }))
      vi.stubGlobal("fetch", fetchMock)
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(true)
      expect((fetchMock.mock.calls as unknown[][]).filter(([u]) => String(u).includes("/keys"))).toHaveLength(0)
    })

    it("dopo unlock via evento: proprietario non ospite", async () => {
      stubToken("secret")
      unlock()
      mockFetchByUrl((url) => (url.includes(`/api/users/${UUID}/keys`) ? {} : { hasPin: false, authenticated: false }))
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("flag OFF (404): percorso legacy invariato", async () => {
      stubToken("secret")
      mockFetchByUrl((url) => {
        if (url.includes(`/api/users/${UUID}/keys`)) return null
        return { hasPin: true, authenticated: true }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
    })

    it("token stantio + password fresca: resta proprietario (mai ospite)", async () => {
      stubToken("stale-secret")
      setStoredUserPassword(UUID, "pw-fresca-1")
      unlock()
      mockFetchByUrl((url) => {
        if (url.includes(`/api/users/${UUID}/keys`)) return { __status: 401 }
        if (url.includes(`/api/users/${UUID}/verify`)) return {}
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(false)
      setStoredUserPassword(UUID, "")
    })

    it("token stantio senza password: ospite", async () => {
      stubToken("stale-secret")
      unlock()
      mockFetchByUrl((url) => {
        if (url.includes(`/api/users/${UUID}/keys`)) return { __status: 401 }
        return { hasPin: false, authenticated: false }
      })
      setUrl(`/u/${UUID}/configure`)
      expect(await shouldSkipServerSync()).toBe(true)
    })
  })
})
