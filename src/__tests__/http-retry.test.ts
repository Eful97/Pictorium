import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, http } from "@/lib/http"

describe("http retry", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  it("401 credenziali: un solo tentativo, niente retry sprecati", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 401 }))
    vi.stubGlobal("fetch", spy)
    await expect(http("/api/tmdb/search?q=x")).rejects.toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("429: ritenta dopo Retry-After", async () => {
    const spy = vi.fn()
    const seq = [
      new Response("{}", { status: 429, headers: { "Retry-After": "0" } }),
      new Response(JSON.stringify([]), { status: 200 }),
    ]
    spy.mockImplementation(async () => seq.shift() ?? new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", spy)
    await expect(http<number[]>("/api/x", { retries: 1 })).resolves.toEqual([])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500, "network"] as const)("%s backoff can outlast the per-attempt timeout", async (status) => {
    const spy = vi.fn()
    if (status === "network") spy.mockRejectedValueOnce(new TypeError("Network failed"))
    else spy.mockResolvedValueOnce(new Response("{}", { status, headers: { "Retry-After": "1" } }))
    spy.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal("fetch", spy)
    await expect(http("/api/x", { retries: 1, timeout: 40 })).resolves.toEqual({ ok: true })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("abort during 429 backoff rejects promptly without a further attempt", async () => {
    const caller = new AbortController()
    const spy = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }))
    vi.stubGlobal("fetch", spy)
    const start = Date.now()
    const pending = http("/api/x", { retries: 1, signal: caller.signal })
    const outcome = await Promise.all([
      pending.then(
        () => "resolved",
        (err: unknown) => (err as { name?: string } | null)?.name ?? "unknown",
      ),
      new Promise<void>((r) => setTimeout(r, 20)).then(() => caller.abort()),
    ]).then(([settlement]) => settlement)
    // The 1s Retry-After wait must be cut short: order-of-magnitude bound only.
    expect(Date.now() - start).toBeLessThan(1000)
    expect(outcome === "AbortError" || outcome === "TimeoutError").toBe(true)
    await expect(pending).rejects.toSatisfy(
      (err: unknown) =>
        (err as { name?: string } | null)?.name === "AbortError" ||
        (err as { name?: string } | null)?.name === "TimeoutError",
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("abort during 5xx backoff rejects promptly without a further attempt", async () => {
    const caller = new AbortController()
    const spy = vi.fn(async () => new Response("boom", { status: 500 }))
    vi.stubGlobal("fetch", spy)
    const start = Date.now()
    const pending = http("/api/x", { retries: 2, signal: caller.signal })
    setTimeout(() => caller.abort(), 20)
    await expect(pending).rejects.toSatisfy(
      (err: unknown) =>
        (err as { name?: string } | null)?.name === "AbortError" ||
        (err as { name?: string } | null)?.name === "TimeoutError",
    )
    // The 1s retry wait must be cut short: order-of-magnitude bound only.
    expect(Date.now() - start).toBeLessThan(1000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("an external abort with a custom reason stops retries with no backoff", async () => {
    const caller = new AbortController()
    let resolveFetchStarted!: () => void
    const fetchStarted = new Promise<void>((r) => {
      resolveFetchStarted = r
    })
    const spy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      resolveFetchStarted()
      const signal = init?.signal as AbortSignal | null | undefined
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () =>
          reject(
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("Aborted", "AbortError"),
          )
        if (!signal) return // hangs forever without a signal
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener("abort", onAbort, { once: true })
      })
    })
    vi.stubGlobal("fetch", spy)
    const pending = http("/api/x", { retries: 2, signal: caller.signal, timeout: 10000 })
    await fetchStarted
    caller.abort(new Error("caller cancelled"))
    await expect(pending).rejects.toThrow("caller cancelled")
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
