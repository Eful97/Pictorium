import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCustomRankingTop20 } from "@/lib/custom-ranking"
import { cacheClear } from "@/lib/cache"
import { tmdbFindByImdb, tmdbFindByTvdb } from "@/lib/tmdb"

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    tmdbFindByImdb: vi.fn(),
    tmdbFindByTvdb: vi.fn(),
  }
})

const mockedFindByImdb = vi.mocked(tmdbFindByImdb)
const mockedFindByTvdb = vi.mocked(tmdbFindByTvdb)

function mdblistItems(items: unknown[]): Response {
  return Response.json(items)
}

function entry(tmdb: number, title: string, extra: Record<string, unknown> = {}) {
  return { tmdb_id: tmdb, title, year: 2024, imdb_id: `tt${String(tmdb).padStart(7, "0")}`, ...extra }
}

describe("fetchCustomRankingTop20", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedFindByImdb.mockReset()
    mockedFindByTvdb.mockReset()
    cacheClear()
  })

  it("preserves list order and caps at the Top 20", async () => {
    const items = Array.from({ length: 25 }, (_, i) => entry(1000 + i, `Title ${i}`))
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mdblistItems(items))

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/long" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res.status).toBe("ok")
    expect(res.items).toHaveLength(20)
    expect(res.items.map((i) => i.tmdbId)).toEqual(items.slice(0, 20).map((_, i) => 1000 + i))
  })

  it("dedupes repeated TMDB ids keeping the first position", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mdblistItems([entry(11, "A"), entry(22, "B"), entry(11, "A dup")]),
    )

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/dups" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res.status).toBe("ok")
    expect(res.items.map((i) => i.tmdbId)).toEqual([11, 22])
  })

  it("filters mixed lists by slot before ranking", async () => {
    const items = [
      entry(1, "Film", { mediatype: "movie" }),
      entry(2, "Show", { mediatype: "show" }),
      entry(3, "Plain"),
    ]
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => mdblistItems(items))

    const movies = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/mixed" },
      slot: "movie",
      apiKey: "k",
    })
    expect(movies.items.map((i) => i.tmdbId)).toEqual([1, 3])

    cacheClear()
    const series = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/mixed" },
      slot: "series",
      apiKey: "k",
    })
    expect(series.items.map((i) => i.tmdbId)).toEqual([2, 3])
  })

  it("resolves IMDb-only rows to TMDB ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mdblistItems([{ imdb_id: "tt9999999", title: "Only Imdb", year: 2023 }]),
    )
    mockedFindByImdb.mockResolvedValue(4242)

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/imdb-only" },
      slot: "movie",
      apiKey: "k",
    })

    expect(mockedFindByImdb).toHaveBeenCalledWith("tt9999999", "movie", "k", expect.any(AbortSignal))
    expect(res).toMatchObject({ status: "ok", items: [{ tmdbId: 4242 }] })
  })

  it("returns empty (not an error) for a genuinely empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mdblistItems([]))

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/empty" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res).toEqual({ status: "empty", items: [] })
  })

  it("propagates provider errors instead of masking them as empty", async () => {
    // IMDb page URLs without an imported CSV snapshot are unsupported: no
    // fetch happens, the structured status tells the caller apart from empty.
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://www.imdb.com/list/ls1234567/" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res).toEqual({ status: "unsupported", items: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("stops resolving once the Top 20 is full", async () => {
    const direct = Array.from({ length: 20 }, (_, i) => entry(3000 + i, `Title ${i}`))
    const imdbOnly = Array.from({ length: 5 }, (_, i) => ({
      imdb_id: `tt880000${i}`,
      title: `Imdb ${i}`,
      year: 2024,
    }))
    let fetches = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetches++
      return mdblistItems([...direct, ...imdbOnly])
    })
    // Even a throwing tail must stay untouched once the window is full.
    mockedFindByImdb.mockRejectedValue(new Error("must not run"))

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/stop-20" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res.status).toBe("ok")
    expect(res.items).toHaveLength(20)
    expect(mockedFindByImdb).not.toHaveBeenCalled()
    expect(mockedFindByTvdb).not.toHaveBeenCalled()
    expect(fetches).toBe(1)
  })

  it("reuses the normalized cache across calls", async () => {
    let fetches = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetches++
      return mdblistItems([entry(44, "Cached")])
    })
    const input = {
      custom: { url: "https://mdblist.com/lists/u/reuse" },
      slot: "movie" as const,
      apiKey: "k",
    }

    const first = await fetchCustomRankingTop20(input)
    const second = await fetchCustomRankingTop20(input)

    expect(first).toEqual({ status: "ok", items: [{ tmdbId: 44, imdb: "tt0000044", title: "Cached", year: 2024 }] })
    expect(second).toEqual(first)
    expect(fetches).toBe(1)
  })

  it("coalesces concurrent resolutions into one upstream fetch", async () => {
    let fetches = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetches++
      await new Promise((r) => setTimeout(r, 20))
      return mdblistItems([entry(55, "Shared")])
    })
    const input = {
      custom: { url: "https://mdblist.com/lists/u/shared" },
      slot: "movie" as const,
      apiKey: "k",
    }

    const [a, b] = await Promise.all([fetchCustomRankingTop20(input), fetchCustomRankingTop20(input)])

    expect(a.status).toBe("ok")
    expect(b).toEqual(a)
    expect(fetches).toBe(1)
  })

  it("reports key_missing when ids need a key that is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([{ imdb_id: "tt9999998", title: "Needs Key", year: 2023 }]),
    )

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/needs-key" },
      slot: "movie",
    })

    expect(res).toEqual({ status: "key_missing", items: [] })
    expect(mockedFindByImdb).not.toHaveBeenCalled()
  })

  it("reports unavailable when lookups throw instead of a bogus empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([{ imdb_id: "tt9999997", title: "Flaky", year: 2023 }]),
    )
    mockedFindByImdb.mockRejectedValue(new Error("boom"))

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/flaky" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res).toEqual({ status: "unavailable", items: [] })
  })

  it("treats unmapped ids as genuine empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([{ imdb_id: "tt9999996", title: "Unknown", year: 2023 }]),
    )
    mockedFindByImdb.mockResolvedValue(null)

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/unmapped" },
      slot: "movie",
      apiKey: "k",
    })

    expect(res).toEqual({ status: "empty", items: [] })
  })

  it("aborts instead of returning partial results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([entry(66, "Never")]),
    )
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(
      fetchCustomRankingTop20({
        custom: { url: "https://mdblist.com/lists/u/aborted" },
        slot: "movie",
        apiKey: "k",
        signal: ctrl.signal,
      }),
    ).rejects.toThrow()
  })

  it("throws on an already-aborted signal even with a warm cache", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([entry(78, "Warm")]),
    )
    const base = {
      custom: { url: "https://mdblist.com/lists/u/warm-abort" },
      slot: "movie" as const,
      apiKey: "k",
    }
    const first = await fetchCustomRankingTop20(base)
    expect(first.status).toBe("ok")
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(
      fetchCustomRankingTop20({ ...base, signal: ctrl.signal }),
    ).rejects.toThrow()
  })

  it("isolates follower aborts from shared in-flight work", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return mdblistItems([entry(77, "Shared")])
    })
    const base = {
      custom: { url: "https://mdblist.com/lists/u/iso-abort" },
      slot: "movie" as const,
      apiKey: "k",
    }
    const ctrl = new AbortController()
    const a = fetchCustomRankingTop20(base)
    const b = fetchCustomRankingTop20({ ...base, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 10)

    const [ra, rb] = await Promise.allSettled([a, b])
    expect(ra.status).toBe("fulfilled")
    if (ra.status === "fulfilled") expect(ra.value.status).toBe("ok")
    expect(rb.status).toBe("rejected")
  })

  it("returns the whole error when head rows fail but the tail would fill", async () => {
    const head = Array.from({ length: 3 }, (_, i) => ({
      imdb_id: `tt770000${i}`,
      title: `Head ${i}`,
      year: 2024,
    }))
    const tail = Array.from({ length: 20 }, (_, i) => entry(7700 + i, `Tail ${i}`))
    let fetches = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetches++
      return mdblistItems([...head, ...tail])
    })
    mockedFindByImdb.mockRejectedValue(new Error("boom"))
    const input = {
      custom: { url: "https://mdblist.com/lists/u/head-fail" },
      slot: "movie" as const,
      apiKey: "k",
    }

    const first = await fetchCustomRankingTop20(input)
    expect(first).toEqual({ status: "unavailable", items: [] })
    // Errors are never cached as results: a retry re-resolves (the raw
    // provider cache still holds, so no second list fetch).
    const second = await fetchCustomRankingTop20(input)
    expect(second).toEqual({ status: "unavailable", items: [] })
    expect(mockedFindByImdb).toHaveBeenCalledTimes(6)
    expect(fetches).toBe(1)
  })

  it("keeps shared work alive when the leader aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return mdblistItems([entry(80, "LeaderGone")])
    })
    const ctrl = new AbortController()
    const base = {
      custom: { url: "https://mdblist.com/lists/u/leader-abort" },
      slot: "movie" as const,
      apiKey: "k",
    }
    const leader = fetchCustomRankingTop20({ ...base, signal: ctrl.signal })
    const follower = fetchCustomRankingTop20(base)
    setTimeout(() => ctrl.abort(), 10)

    const [rl, rf] = await Promise.allSettled([leader, follower])
    expect(rl.status).toBe("rejected")
    expect(rf.status).toBe("fulfilled")
    if (rf.status === "fulfilled") {
      expect(rf.value.status).toBe("ok")
      expect(rf.value.items.map((i) => i.tmdbId)).toEqual([80])
    }
  })

  it("returns key_missing when head rows need a missing key", async () => {
    const head = [{ imdb_id: "tt7600000", title: "Head", year: 2024 }]
    const tail = Array.from({ length: 20 }, (_, i) => entry(7600 + i, `Tail ${i}`))
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      mdblistItems([...head, ...tail]),
    )

    const res = await fetchCustomRankingTop20({
      custom: { url: "https://mdblist.com/lists/u/head-nokey" },
      slot: "movie",
    })

    expect(res).toEqual({ status: "key_missing", items: [] })
    expect(mockedFindByImdb).not.toHaveBeenCalled()
  })
})
