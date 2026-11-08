import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearTvdbCache, getTvdbEpisodesResult } from "@/lib/tvdb"

/**
 * TVDB language fallback at the transport level.
 *
 * The episode endpoint takes a TVDB 3-letter language in the path
 * (`/episodes/<seasonType>/<lang>`). When TVDB rejects that language (an
 * unsupported code and/or missing translation: HTTP failure on the first
 * page), the client must retry the language-neutral DEFAULT endpoint and serve
 * the rows from there as a COMPLETE result — never a truncated/empty list and
 * never a cached failure.
 *
 * `providers/tvdb.test.ts` covers the locale -> TVDB mapper and a generic
 * "fallback resolves complete" case with `ita`; this suite pins the actual
 * unsupported-language URL sequence, which is what the fix depends on.
 */
describe("TVDB unsupported-language fallback", () => {
  beforeEach(() => {
    clearTvdbCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearTvdbCache()
  })

  it("retries the language-neutral endpoint and serves a complete result", async () => {
    const requested: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input)
      requested.push(url)
      if (url.includes("/login")) {
        return Response.json({ status: "success", data: { token: "mock-jwt" } })
      }
      if (url.includes("/episodes/default/tlh")) {
        return new Response("unsupported language", { status: 404 })
      }
      if (url.includes("/episodes/default?page=0")) {
        return Response.json({
          status: "success",
          data: { episodes: [{ id: 1, name: "Fallback episode", seasonNumber: 1, number: 1 }] },
          links: { total_pages: 1 },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const result = await getTvdbEpisodesResult(99001, "tlh", "tvdb-key")

    expect(result.complete).toBe(true)
    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]!.name).toBe("Fallback episode")

    const episodeRequests = requested.filter((url) => url.includes("/episodes/"))
    // First the requested (unsupported) language, then the neutral endpoint.
    expect(episodeRequests[0]).toMatch(/\/episodes\/default\/tlh\?page=0$/)
    expect(episodeRequests.some((url) => /\/episodes\/default\?page=0$/.test(url))).toBe(true)
  })

  it("caches the neutral result: a second request never refetches the default rows", async () => {
    const requested: string[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input)
      requested.push(url)
      if (url.includes("/login")) {
        return Response.json({ status: "success", data: { token: "mock-jwt" } })
      }
      if (url.includes("/episodes/default/tlh")) {
        return new Response("unsupported language", { status: 404 })
      }
      if (url.includes("/episodes/default?page=0")) {
        return Response.json({
          status: "success",
          data: { episodes: [{ id: 2, name: "Fallback episode", seasonNumber: 1, number: 1 }] },
          links: { total_pages: 1 },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const first = await getTvdbEpisodesResult(99002, "tlh", "tvdb-key")
    expect(first.complete).toBe(true)

    const neutralFetches = () =>
      requested.filter((url) => /\/episodes\/default\?page=0$/.test(url)).length
    expect(neutralFetches()).toBe(1)

    const second = await getTvdbEpisodesResult(99002, "tlh", "tvdb-key")
    expect(second.complete).toBe(true)
    expect(second.episodes[0]!.name).toBe("Fallback episode")
    // The neutral rows were cached (only complete results are cached): the
    // second call does not refetch them. The unsupported language probe is
    // repeated because a failure is never cached.
    expect(neutralFetches()).toBe(1)
  })
})
