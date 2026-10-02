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
})
