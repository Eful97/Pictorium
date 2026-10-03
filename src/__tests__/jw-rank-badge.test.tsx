import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { renderWithCtx, MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { JwRankBadge } from "@/components/JwRankBadge"
import type { CustomCatalogConfig } from "@/lib/types"

// The test bundle resolves JSON translations as namespaces, so the real
// `t()` echoes keys (repo-wide pattern). This fake keeps key routing while
// exposing the interpolation params, which is exactly the feature logic
// under test here (list name in, region flag out for custom badges).
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()
  return {
    ...actual,
    useT: () => ({
      t: (key: string, params?: Record<string, string | number>) =>
        params && Object.keys(params).length > 0
          ? `${key} ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ")}`
          : key,
      lang: "it",
      pickLang: () => {},
    }),
  }
})

const TRAKT: CustomCatalogConfig = {
  id: "trakt-movies",
  name: "Trakt Top 20",
  type: "movie",
  url: "https://mdblist.com/lists/u/trakt-movies",
}

function mockRank(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  )
}

function rankFetchCalls(fetchSpy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return fetchSpy.mock.calls as unknown as unknown[][]
}

function rankCalls(fetchSpy: ReturnType<typeof vi.spyOn>): string[] {
  return rankFetchCalls(fetchSpy)
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/trending/rank"))
}

function rankInits(fetchSpy: ReturnType<typeof vi.spyOn>): unknown[] {
  return rankFetchCalls(fetchSpy)
    .filter((c) => String(c[0]).includes("/api/trending/rank"))
    .map((c) => c[1])
}

describe("JwRankBadge with ranking sources", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the JustWatch wording without a selection and no user param", async () => {
    const fetchSpy = mockRank({ rank: 3, top: 20 })
    renderWithCtx(<JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId={null} />)

    await waitFor(() =>
      expect(screen.getByText("ui.rankTrending rank=3 flag=🇮🇹")).toBeInTheDocument(),
    )
    expect(rankCalls(fetchSpy)).toHaveLength(1)
    expect(rankCalls(fetchSpy)[0]).not.toContain("u=")
    // Rank reads never sit in browser caches: the URL does not version the
    // selection, so a public max-age would serve stale ranks after a switch.
    expect(rankInits(fetchSpy)[0]).toMatchObject({ cache: "no-store" })
  })

  it("shows the custom list name with no region flag", async () => {
    const fetchSpy = mockRank({ rank: 2, top: 20 })
    renderWithCtx(<JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId="u1" />, {
      customCatalogs: [TRAKT],
      rankingSourceMovie: "trakt-movies",
    })

    await waitFor(() =>
      expect(screen.getByText("ui.rankCustomTrending rank=2 name=Trakt Top 20")).toBeInTheDocument(),
    )
    expect(screen.queryByText(/🇮🇹/)).not.toBeInTheDocument()
    expect(rankCalls(fetchSpy)).toHaveLength(1)
    expect(rankCalls(fetchSpy)[0]).toContain("u=u1")
  })

  it("shows the custom miss without JW wording", async () => {
    mockRank({ rank: null, top: 20 })
    renderWithCtx(<JwRankBadge tmdbId={999} type="movie" regionCode="IT" userId="u1" />, {
      customCatalogs: [TRAKT],
      rankingSourceMovie: "trakt-movies",
    })

    await waitFor(() =>
      expect(screen.getByText("ui.rankCustomOutsideTop top=20 name=Trakt Top 20")).toBeInTheDocument(),
    )
  })

  it("sends local credentials and refetches when a key changes", async () => {
    const fetchSpy = mockRank({ rank: 2, top: 20 })
    const badge = <JwRankBadge tmdbId={101} type="movie" />
    const ctx = { ...MOCK_CTX, customCatalogs: [TRAKT], rankingSourceMovie: TRAKT.id,
      tmdbKey: "local tmdb&key", mdblistApiKey: "local-mdb", tvdbApiKey: "local-tvdb" }
    const { rerender } = render(<PictoriumProvider value={ctx}>{badge}</PictoriumProvider>)
    await waitFor(() => expect(rankCalls(fetchSpy)).toHaveLength(1))
    const params = new URL(rankCalls(fetchSpy)[0], window.location.origin).searchParams
    expect(params.get("api_key")).toBe(ctx.tmdbKey)
    expect(params.get("mdblist_key")).toBe(ctx.mdblistApiKey)
    expect(params.get("tvdb_key")).toBe(ctx.tvdbApiKey)
    rerender(<PictoriumProvider value={{ ...ctx, tmdbKey: "new-key" }}>{badge}</PictoriumProvider>)
    await waitFor(() => expect(rankCalls(fetchSpy)).toHaveLength(2))
    expect(new URL(rankCalls(fetchSpy)[1], window.location.origin).searchParams.get("api_key")).toBe("new-key")
  })

  it("shows the unavailable state on explicit provider errors", async () => {
    mockRank({ rank: null, error: "unavailable" }, 502)
    renderWithCtx(<JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId="u1" />, {
      customCatalogs: [TRAKT],
      rankingSourceMovie: "trakt-movies",
    })

    await waitFor(() => expect(screen.getByText("ui.rankUnavailable")).toBeInTheDocument())
  })

  it("suspends requests while the device token is pending", async () => {
    const fetchSpy = mockRank({ rank: 2, top: 20 })
    renderWithCtx(<JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId="u1" />, {
      customCatalogs: [TRAKT],
      rankingSourceMovie: "trakt-movies",
      localConfigTokenStatus: "pending",
    })

    // Loading state, zero RANK requests: no namespace read under a custom choice.
    await waitFor(() => expect(screen.getByText("ui.rankLoading")).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 50))
    expect(rankCalls(fetchSpy)).toHaveLength(0)
  })

  it("shows unavailable on token errors without fetching", async () => {
    const fetchSpy = mockRank({ rank: 2, top: 20 })
    renderWithCtx(<JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId="u1" />, {
      customCatalogs: [TRAKT],
      rankingSourceMovie: "trakt-movies",
      localConfigToken: null,
      localConfigTokenStatus: "error",
    })

    await waitFor(() => expect(screen.getByText("ui.rankUnavailable")).toBeInTheDocument())
    expect(rankCalls(fetchSpy)).toHaveLength(0)
  })

  it("refetches the same title when the ranking nonce bumps", async () => {
    const fetchSpy = mockRank({ rank: 3, top: 20 })
    const badge = <JwRankBadge tmdbId={101} type="movie" regionCode="IT" userId="u1" />
    const { rerender } = render(
      <PictoriumProvider value={{ ...MOCK_CTX, rankSourceNonce: 0 }}>
        {badge}
      </PictoriumProvider>,
    )

    await waitFor(() => expect(screen.getByText(/ui\.rankTrending/)).toBeInTheDocument())
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    rerender(
      <PictoriumProvider value={{ ...MOCK_CTX, rankSourceNonce: 1 }}>
        {badge}
      </PictoriumProvider>,
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })
})
