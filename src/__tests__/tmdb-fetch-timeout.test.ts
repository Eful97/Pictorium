import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearTMDBCache, __resetKey401Cache, getDetails } from "@/lib/tmdb"

describe("tmdbFetch per-call timeout (D5)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  it("aborts a hanging fetch after the custom timeout instead of 30s", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        ;(init?.signal as AbortSignal | undefined)?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        )
      })
    })

    const start = Date.now()
    await expect(getDetails("movie", 424242, "it-IT", "k", undefined, 80)).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it("still succeeds within the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: 424243, genres: [], vote_average: 1, vote_count: 1 }),
    )
    const d = await getDetails("movie", 424243, "it-IT", "k", undefined, 5000)
    expect(d.id).toBe(424243)
  })
})

describe("tmdbFetch 401 negative cache (v1.23.0)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
    __resetKey401Cache()
  })

  it("marks a 401 key and fails fast without network on retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad key", { status: 401 }))
    await expect(getDetails("movie", 424244, "it-IT", "bad-key", undefined, 5000)).rejects.toThrow("401")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // Seconda chiamata (anche altro endpoint): zero rete, stesso errore.
    await expect(getDetails("movie", 424245, "it-IT", "bad-key", undefined, 5000)).rejects.toThrow("401")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("does not poison other keys or non-401 errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("good-key")) return Response.json({ id: 1, genres: [], vote_average: 1, vote_count: 1 })
      return new Response("bad key", { status: 401 })
    })
    await expect(getDetails("movie", 424246, "it-IT", "bad-key", undefined, 5000)).rejects.toThrow("401")
    const d = await getDetails("movie", 424246, "it-IT", "good-key", undefined, 5000)
    expect(d.id).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
