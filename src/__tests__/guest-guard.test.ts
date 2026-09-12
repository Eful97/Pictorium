import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchAdminState,
  isForeignUrl,
  resetGuestGuardForTests,
  shouldSkipServerSync,
} from "@/lib/guest-guard"

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
    setUrl("/")
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    resetGuestGuardForTests()
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
      expect(fetchMock).not.toHaveBeenCalled()
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
})
