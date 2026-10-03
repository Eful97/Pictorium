/**
 * Real provider propagation for catalog/ranking persistence.
 *
 * Drives the REAL PictoriumRoot (never mocked loaders) with a stubbed
 * network: proves that an acknowledged catalog PUT reaches selectors
 * (context value/memo propagation) and refetches the open title rank
 * (same title, same user) through the persistence effect.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useEffect } from "react"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import type { SearchResult, TMDBImage } from "@/lib/types"

let ctx: PictoriumCtx | null = null

function Probe() {
  const v = useP()
  useEffect(() => {
    ctx = v
  })
  return null
}

const ITEM: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES = {
  posters: [img("/clean-a.jpg", null)],
  logos: [],
  backdrops: [],
}

function detailsFixture() {
  return {
    genres: [{ id: 18, name: "Drama" }],
    voteAverage: 8.2,
    voteCount: 120,
    status: null,
    type: null,
    release_date: "2024-03-01",
    first_air_date: null,
    last_air_date: null,
    next_episode_to_air: null,
    number_of_seasons: null,
    number_of_episodes: null,
    title: "Alpha",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: null,
  }
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

const rankCalls: string[] = []
let nextRank: { rank: number | null } = { rank: null }

async function fetchMock(url: unknown): Promise<unknown> {
  const u = String(url)
  if (u.includes("/api/trending/rank?")) {
    rankCalls.push(u)
    return okJson(nextRank)
  }
  if (u.includes("/api/tmdb/101/details")) return okJson(detailsFixture())
  if (u.includes("/api/tmdb/101/images")) return okJson(IMAGES)
  if (u.includes("/api/awards/")) {
    return okJson({ awards: [], nominations: [], studios: [], director: null, keywords: [] })
  }
  return okJson({})
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

describe("ranking provider propagation (real PictoriumRoot)", () => {
  beforeEach(() => {
    rankCalls.length = 0
    nextRank = { rank: null }
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as typeof fetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("propagates catalogsSyncNonce to selectors after an acknowledged PUT", async () => {
    ctx = null
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx, "provider context available").toBeTruthy()
    expect(ctx!.catalogsSyncNonce).toBe(0)

    await act(async () => {
      ctx!.addCustomCatalog({ name: "Lista", type: "movie", url: "https://mdblist.com/lists/u/slug" })
    })
    // Debounced catalog PUT (400ms) + roundtrip.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    await flush()

    // Without catalogsSyncNonce in the context memo deps this stays 0: the
    // acknowledged save would never reach badge/preview selectors.
    expect(ctx!.catalogsSyncNonce).toBe(1)
  })

  it("refetches the open title rank after a catalog save (same title, same user)", async () => {
    ctx = null
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.setTmdbKey("test-key")
    })
    nextRank = { rank: 5 }
    await act(async () => {
      ctx!.navigateToPoster(ITEM)
    })
    await flush()
    expect(rankCalls.length).toBeGreaterThanOrEqual(1)
    expect(ctx!.trendRank).toBe(5)

    nextRank = { rank: 7 }
    await act(async () => {
      ctx!.addCustomCatalog({ name: "Lista", type: "movie", url: "https://mdblist.com/lists/u/slug" })
    })
    const callsBefore = rankCalls.length
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    await flush()

    // The catalog persistence effect refetched the same open title.
    expect(rankCalls.length).toBeGreaterThan(callsBefore)
    expect(ctx!.trendRank).toBe(7)
  })
})
