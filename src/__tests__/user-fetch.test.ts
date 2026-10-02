import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, scopedApiInit, userFetch } from "@/lib/http"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  getStoredUserToken,
  setStoredUserPassword,
  setStoredUserToken,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

const UUID = "11111111-1111-4111-8111-111111111111"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

// jsdom qui non espone localStorage: memory store (tenuto per compatibilità,
// il contratto token non lo usa più — solo memoria di sessione).
function installMemoryStorage(): Record<string, string> {
  const store: Record<string, string> = {}
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v) },
      removeItem: (k: string) => { delete store[k] },
      clear: () => { for (const k of Object.keys(store)) delete store[k] },
    },
    configurable: true,
  })
  return store
}

function okResponse(): Response {
  return new Response("{}", { status: 200 })
}

beforeEach(() => {
  setUrl("/")
  installMemoryStorage()
  window.localStorage.clear()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  vi.stubGlobal("fetch", vi.fn(async () => okResponse()))
})

afterEach(() => {
  setUrl("/")
  try { window.localStorage.clear() } catch { /* assente */ }
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  vi.unstubAllGlobals()
})

describe("scopedApiInit / userFetch", () => {
  it("passthrough fuori dai path utente", () => {
    expect(scopedApiInit("/api/mappings", {})).toEqual({ path: "/api/mappings", headers: undefined })
    expect(scopedApiInit("/api/health", {})).toEqual({ path: "/api/health", headers: undefined })
  })

  it("non tocca POST /api/users (creazione identità)", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "tok")
    await userFetch("/api/users", { method: "POST" })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/users")
    expect((init.headers as Record<string, string> | undefined)?.["x-user-token"]).toBeUndefined()
  })

  it("aggiunge ?u= + x-user-token sulle famiglie scoped (dopo unlock)", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "tok")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    await userFetch("/api/mappings")
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/mappings?u=${UUID}`)
    expect((init.headers as Record<string, string>)["x-user-token"]).toBe("tok")
  })

  it("non duplica ?u= già presente e non sovrascrive header espliciti", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "tok")
    await userFetch(`/api/defaults?u=${UUID}`, { headers: { Authorization: "Bearer admin" } })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/defaults?u=${UUID}`)
    const headers = init.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer admin")
    expect(headers["x-user-token"]).toBeUndefined()
  })

  it("senza token aggiunge solo ?u=", async () => {
    setUrl(`/?u=${UUID}`)
    await userFetch("/api/mappings")
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/mappings?u=${UUID}`)
    expect(init.headers).toBeUndefined()
  })

  it("ignora uuid invalidi nel path", async () => {
    setUrl("/u/non-un-uuid/configure")
    setStoredUserToken("non-un-uuid", "tok")
    await userFetch("/api/mappings")
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/mappings")
  })

  it("pre-unlock (modal chiusa con X): ?u= sì, credenziali mai", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "tok")
    await userFetch("/api/mappings")
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/mappings?u=${UUID}`)
    expect(init.headers).toBeUndefined()
  })

  it("aggiunge ?u= alle famiglie proxy upstream (tmdb/mdblist/awards/tvdb)", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "tok")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    for (const p of ["/api/tmdb/search?q=x", "/api/mdblist/anime", "/api/awards/movie/1", "/api/tvdb/123/seasonTypes", "/api/flixpatrol/top10", "/api/trending/rank?type=movie&id=1"]) {
      vi.mocked(fetch).mockClear()
      await userFetch(p)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(`u=${UUID}`)
      expect((init.headers as Record<string, string>)["x-user-token"]).toBe("tok")
    }
  })

  it("401 con token stantio + password fresca: retry password e drop token", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-1")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      if (headers["x-user-password"] === "fresh-pw-1" && !headers["x-user-token"]) {
        return new Response('{"ok":true}', { status: 200 })
      }
      return new Response("{}", { status: 500 })
    })
    const res = await userFetch("/api/mappings")
    expect(res.status).toBe(200)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    // Secret provatamente invalido: rimosso, i prossimi fetch partono sani.
    expect(getStoredUserToken(UUID)).toBeNull()
  })

  it("401 senza password di sessione: niente retry, 401 integro", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 401 }))
    const res = await userFetch("/api/mappings")
    expect(res.status).toBe(401)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("http(): stesso retry password sul plumbing con timeout", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-2")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      return new Response('{"mappings":[]}', { status: 200 })
    })
    const body = await http<{ mappings: unknown[] }>("/api/mappings", { retries: 0 })
    expect(body).toEqual({ mappings: [] })
    expect(getStoredUserToken(UUID)).toBeNull()
  })
})

describe("userFetch/http timeout and cancellation (Phase 3)", () => {
  function isCancel(err: unknown): boolean {
    const name = (err as { name?: string } | null)?.name
    return name === "AbortError" || name === "TimeoutError"
  }

  /** Fetch mock that hangs until its signal aborts (never settles otherwise). */
  function hangUntilAbort(init?: RequestInit): Promise<Response> {
    const signal = init?.signal as AbortSignal | null | undefined
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () =>
        reject(
          signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"),
        )
      if (!signal) return // hangs forever without a signal
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  it("applies the timeout even when the caller passes a live signal", async () => {
    const caller = new AbortController()
    const seen: Array<AbortSignal | null | undefined> = []
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.signal as AbortSignal | null | undefined)
      return hangUntilAbort(init)
    })
    await expect(userFetch("/api/mappings", { signal: caller.signal, timeout: 40 })).rejects.toSatisfy(
      isCancel,
    )
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(seen[0]).toBeDefined()
    expect(seen[0]).not.toBe(caller.signal)
  })

  it("an external abort interrupts the active fetch even with a longer timeout", async () => {
    const caller = new AbortController()
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => hangUntilAbort(init))
    const pending = userFetch("/api/mappings", { signal: caller.signal, timeout: 10000 })
    caller.abort()
    await expect(pending).rejects.toSatisfy(isCancel)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("an already-aborted signal performs no network request", async () => {
    const caller = new AbortController()
    caller.abort()
    const spy = vi.mocked(fetch)
    await expect(userFetch("/api/mappings", { signal: caller.signal, timeout: 1000 })).rejects.toSatisfy(
      isCancel,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it("auth retry reuses the effective signal: cancel reaches the retry", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-3")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    const seen: Array<AbortSignal | null | undefined> = []
    let resolveRetryStarted!: () => void
    const retryStarted = new Promise<void>((r) => {
      resolveRetryStarted = r
    })
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.signal as AbortSignal | null | undefined)
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      resolveRetryStarted()
      return hangUntilAbort(init)
    })
    const caller = new AbortController()
    const pending = userFetch("/api/mappings", { signal: caller.signal, timeout: 10000 })
    // Wait until the password retry has started before aborting: ordering
    // without timing.
    await retryStarted
    caller.abort()
    await expect(pending).rejects.toSatisfy(isCancel)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
  })

  it("auth retry respects the timeout budget", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-4")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      return hangUntilAbort(init)
    })
    const caller = new AbortController()
    await expect(userFetch("/api/mappings", { signal: caller.signal, timeout: 40 })).rejects.toSatisfy(
      isCancel,
    )
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it("successful auth retry keeps secret cleanup, namespace and headers on the shared signal", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-5")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    const seen: Array<{ url: unknown; init?: RequestInit }> = []
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: RequestInit) => {
      seen.push({ url, init })
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      return new Response('{"ok":true}', { status: 200 })
    })
    const caller = new AbortController()
    const res = await userFetch("/api/mappings", { signal: caller.signal, timeout: 1000 })
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(2)
    // First fetch and password retry share the same composed signal.
    expect(seen[1].init?.signal).toBe(seen[0].init?.signal)
    expect(String(seen[0].url)).toBe(`/api/mappings?u=${UUID}`)
    const retryHeaders = (seen[1].init?.headers ?? {}) as Record<string, string>
    expect(retryHeaders["x-user-password"]).toBe("fresh-pw-5")
    expect(retryHeaders["x-user-token"]).toBeUndefined()
    expect(getStoredUserToken(UUID)).toBeNull()
  })

  it("http(): auth retry is cancelled by an external abort", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-6")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    let resolveRetryStarted!: () => void
    const retryStarted = new Promise<void>((r) => {
      resolveRetryStarted = r
    })
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      resolveRetryStarted()
      return hangUntilAbort(init)
    })
    const caller = new AbortController()
    const pending = http("/api/mappings", { retries: 0, signal: caller.signal, timeout: 10000 })
    await retryStarted
    caller.abort()
    await expect(pending).rejects.toSatisfy(isCancel)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it("http(): auth retry shares the attempt signal and times out without a third fetch", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserToken(UUID, "stale-tok")
    setStoredUserPassword(UUID, "fresh-pw-7")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    const seen: Array<AbortSignal | null | undefined> = []
    vi.mocked(fetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.signal as AbortSignal | null | undefined)
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers["x-user-token"] === "stale-tok") return new Response("{}", { status: 401 })
      return hangUntilAbort(init)
    })
    const caller = new AbortController()
    await expect(
      http("/api/mappings", { retries: 1, signal: caller.signal, timeout: 40 }),
    ).rejects.toSatisfy(isCancel)
    // First fetch + password retry on the same composed signal; the timeout
    // is not retried numerically, so no third fetch follows.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
  })
})
