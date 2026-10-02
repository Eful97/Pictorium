import { afterEach, describe, expect, it, vi } from "vitest"
import { http, ApiError } from "@/lib/http"
import { clearAdminToken, setAdminToken } from "@/lib/admin-token"

describe("http", () => {
  afterEach(() => {
    clearAdminToken()
    vi.unstubAllGlobals()
  })

  it("returns null when the response has no content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))

    const result = await http<null>("/api/empty", { retries: 0 })

    expect(result).toBeNull()
  })

  it("throws ApiError for non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })))

    await expect(http("/api/protected", { retries: 0 })).rejects.toBeInstanceOf(ApiError)
  })

  it("attaches the session admin token to /api/ calls", async () => {
    setAdminToken("adm")
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await http("/api/warmup", { method: "POST", retries: 0 })

    const [call] = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const [, init] = call
    expect((init.headers as Record<string, string>)["x-admin-token"]).toBe("adm")
  })

  it("performs no network request when the caller signal is already aborted", async () => {
    const caller = new AbortController()
    caller.abort()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const failure = await http("/api/warmup", { retries: 0, signal: caller.signal }).then(
      () => null,
      (err: unknown) => err as { name?: string },
    )
    expect(failure?.name === "AbortError" || failure?.name === "TimeoutError").toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ends a hanging fetch at the per-attempt timeout with a live external signal", async () => {
    const caller = new AbortController()
    const seen: Array<AbortSignal | null | undefined> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | null | undefined
        seen.push(signal)
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
      }),
    )

    const failure = await http("/api/warmup", {
      retries: 0,
      signal: caller.signal,
      timeout: 40,
    }).then(
      () => null,
      (err: unknown) => err as { name?: string },
    )
    expect(failure?.name === "AbortError" || failure?.name === "TimeoutError").toBe(true)
    expect(seen).toHaveLength(1)
  })

  it("does not retry a recognized cancellation", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError")
    })
    vi.stubGlobal("fetch", fetchMock)

    const failure = await http("/api/warmup", { retries: 2 }).then(
      () => null,
      (err: unknown) => err as { name?: string },
    )
    expect(failure?.name).toBe("AbortError")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
