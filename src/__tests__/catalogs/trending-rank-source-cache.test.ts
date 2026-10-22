// Rank-route HTTP caching must follow the mutable selection, not the URL.
//
// Audit for the correction-cycle-2 review: GET /api/trending/rank answers
// depend on the server-side resolved ranking source (namespace `?u=`,
// `?config=` token, or mutable global defaults), but the popular/trending
// branches — including the GLOBAL-unsupported path — answered
// `public, max-age=300, s-maxage=1800`. In-repo callers fetch with
// `cache: "no-store"`, yet that only binds the requesting client: any shared
// (CDN/proxy) cache may still serve the publicly-cached body after the
// selection changes at the same URL. The custom branch already uses
// `private, no-cache` for exactly this reason; popular/trending/charts follow
// the same precedent while the server-side app cache keeps absorbing upstream
// cost (no data-cache clearing here, headers only). The GLOBAL-unsupported
// mode answers explicit `error: "unsupported"` with `no-store`: JwRankBadge
// already renders `data?.error` as unavailable, so this is an explicit
// unavailable state — never a publicly cached genuine miss.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/trending/rank/route"
import { cacheClear } from "@/lib/cache"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { getJWRankings } from "@/lib/justwatch"
import { fetchTop20Ranking } from "@/lib/top20-ranking"

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...mod,
    getScopedUserId: vi.fn((raw: string | null | undefined) => raw ?? null),
    userExists: vi.fn(async () => true),
  }
})

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
}))

vi.mock("@/lib/top20-ranking", () => ({
  fetchTop20Ranking: vi.fn(async () => ({ status: "empty", items: [], period: "popular" })),
}))

import { getServerDefaults } from "@/lib/server-defaults"

const mockedDefaults = vi.mocked(getServerDefaults)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedFetchTop20 = vi.mocked(fetchTop20Ranking)

const MUTABLE_URL = "http://localhost:3000/api/trending/rank?type=movie&id=91001&region=IT"

describe("GET /api/trending/rank mutable-source HTTP caching", () => {
  beforeEach(() => {
    mockedDefaults.mockReset()
    mockedDefaults.mockReturnValue({})
    mockedGetJWRankings.mockReset().mockResolvedValue([])
    mockedFetchTop20.mockReset().mockResolvedValue({ status: "empty", items: [], period: "popular" })
    cacheClear()
    // Fixed chart cycles: no cross-test snapshot/lease leakage.
    __resetChartGenerationForTest()
  })

  afterEach(() => {
    cacheClear()
    __resetChartGenerationForTest()
  })

  it("serves a different body at the same URL after a default-source switch (stale shared-cache demonstration)", async () => {
    // Canonical charts reads come from the published family snapshot (the
    // renewal fetches it via fetchTop20Ranking): the JW live mock below is
    // not on this path. Real-caller URL shape (no `first`) is preserved.
    mockedFetchTop20.mockResolvedValue({
      status: "ok",
      items: [{ tmdbId: 91001, imdbId: null, rank: 5, title: "Charts Five" }],
      period: "day",
    })

    const charts = await GET(new NextRequest(MUTABLE_URL))
    expect(charts.status).toBe(200)
    expect(await charts.json()).toMatchObject({ rank: 5, period: "day" })
    const chartsCache = charts.headers.get("Cache-Control") ?? ""

    // Operator switches the global default movie source to popular. The URL
    // is byte-identical (no ?u=/?config= involved), yet the resolved source
    // — and therefore the body — changes.
    mockedDefaults.mockReturnValue({ rankingSourceMovie: "jw:popular" })
    mockedFetchTop20.mockResolvedValue({
      status: "ok",
      items: [{ tmdbId: 91001, imdbId: null, rank: 2, title: "Popular Two" }],
      period: "popular",
    })

    const popular = await GET(new NextRequest(MUTABLE_URL))
    expect(popular.status).toBe(200)
    expect(await popular.json()).toMatchObject({ rank: 2, period: "popular" })

    // A shared cache obeying the first response's headers would keep serving
    // `{rank: 5, period: "day"}` for up to s-maxage after the switch. Both
    // mutable branches must therefore stay out of shared caches.
    expect(chartsCache).not.toContain("public")
    expect(popular.headers.get("Cache-Control")).not.toContain("public")
    expect(popular.headers.get("Cache-Control")).toContain("private")
    expect(popular.headers.get("Cache-Control")).toContain("no-cache")
  })

  it("keeps popular/trending bodies out of shared caches while retaining the server-side data cache", async () => {
    mockedDefaults.mockReturnValue({ rankingSourceMovie: "jw:popular" })
    mockedFetchTop20.mockResolvedValue({
      status: "ok",
      items: [{ tmdbId: 91002, imdbId: null, rank: 1, title: "Popular One" }],
      period: "popular",
    })
    const url = "http://localhost:3000/api/trending/rank?type=movie&id=91002&region=IT"

    const first = await GET(new NextRequest(url))
    expect(first.status).toBe(200)
    expect(first.headers.get("Cache-Control")).toContain("private")
    expect(first.headers.get("Cache-Control")).toContain("no-cache")

    const second = await GET(new NextRequest(url))
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ rank: 1, period: "popular" })
    // Server-side app cache still absorbs the upstream cost (one upstream
    // call for two identical reads): headers-only change, no data-cache
    // clearing.
    expect(mockedFetchTop20).toHaveBeenCalledTimes(1)
  })

  it("keeps charts bodies out of shared caches when the selection resolves through mutable defaults", async () => {
    // Same canonical-seam note as above: charts reads publish via the
    // renewal fetcher (fetchTop20Ranking mock), not the JW live mock.
    mockedFetchTop20.mockResolvedValue({
      status: "ok",
      items: [{ tmdbId: 91003, imdbId: null, rank: 3, title: "Charts Three" }],
      period: "day",
    })
    const url = "http://localhost:3000/api/trending/rank?type=movie&id=91003&region=IT"

    const res = await GET(new NextRequest(url))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: 3, period: "day" })
    expect(res.headers.get("Cache-Control")).toContain("private")
    expect(res.headers.get("Cache-Control")).toContain("no-cache")
    expect(res.headers.get("Cache-Control")).not.toContain("public")
  })

  it("answers GLOBAL popular/trending as explicit unavailable with no-store (never a publicly cached miss)", async () => {
    mockedDefaults.mockReturnValue({ rankingSourceMovie: "jw:popular" })
    const url = "http://localhost:3000/api/trending/rank?type=movie&id=91004&region=GLOBAL"

    const res = await GET(new NextRequest(url))
    expect(res.status).toBe(200)
    // Explicit unavailable marker: JwRankBadge renders `data?.error` as
    // unavailable instead of "outside the Top 20".
    expect(await res.json()).toMatchObject({ rank: null, error: "unsupported" })
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Cache-Control")).not.toContain("public")
    // Fail-closed before any upstream call: no substitution, no fetch.
    expect(mockedFetchTop20).not.toHaveBeenCalled()
  })
})
