import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearTMDBCache, getDetails } from "@/lib/tmdb"

describe("tmdbFetch per-call timeout (D5)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
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
