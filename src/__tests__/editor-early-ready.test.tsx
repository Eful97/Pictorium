/**
 * Editor usable before optional rank/awards resolve.
 *
 * loadCurrentItemData publishes artwork as soon as details+images resolve;
 * rank/awards/MDBList enrich afterwards without blocking the editor. These
 * tests drive the REAL provider (PictoriumRoot + useP) with deferred network
 * responses — never a mocked loader — and use controlled promises instead of
 * sleeps or real network.
 */
import { useEffect } from "react"
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  // Publish latest contexts after render (effect, never during render).
  useEffect(() => {
    ctx = v
    ed = e
  })
  return null
}

// --- Deferred fetch rig -----------------------------------------------------

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const calls: { url: string; signal: AbortSignal | null }[] = []
const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: unknown[] = []

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

function queueKey(url: string): string | null {
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  m = url.match(/\/api\/trending\/rank\?[^ ]*[?&]id=(\d+)/)
  if (m) return `rank:${m[1]}`
  m = url.match(/\/api\/awards\/\w+\/(\d+)/)
  if (m) return `awards:${m[1]}`
  if (url.includes("/api/mdblist?imdb=")) return "mdblist"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      calls.push({ url: u, signal })
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (key) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", onAbort, { once: true })
          const q = queues.get(key) ?? []
          queues.set(key, q)
          // Raw settle: callers wrap the payload (okJson for data, errJson
          // for terminal HTTP statuses) so http() sees the real status.
          q.push({
            resolve: (res: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              resolve(res)
            },
            reject: (err: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              reject(err)
            },
          })
        })
      }
      if (u.includes("/api/mappings")) return okJson({ mappings: mappingsPayload })
      return okJson({})
    }),
  )
}

function pendingCount(key: string): number {
  return queues.get(key)?.length ?? 0
}

/** Resolve every queued request for key with a 200 JSON body (covers refetch duplicates). */
function resolveAll(key: string, data: unknown) {
  const q = queues.get(key) ?? []
  queues.set(key, [])
  expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
  for (const p of q) p.resolve(okJson(data))
}

/**
 * Settle every queued request for key with a terminal HTTP response.
 * A non-retryable status (e.g. 404: neither 429 nor >= 500) makes http()
 * throw ApiError immediately with no retry and no backoff, so the caller
 * catch runs within microtasks. A bare network rejection would instead park
 * the wrapper in backoff (real timers), which microtask-only flush cannot
 * drain -- unsuitable for proving the final fallback.
 */
function settleResponse(key: string, status: number, body: unknown = {}) {
  const q = queues.get(key) ?? []
  queues.set(key, [])
  expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
  for (const p of q) {
    p.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => body,
    })
  }
}

function signalsFor(part: string): (AbortSignal | null)[] {
  return calls.filter((c) => c.url.includes(part)).map((c) => c.signal)
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

// --- Fixtures ---------------------------------------------------------------

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_A = {
  posters: [img("/clean-a.jpg", null), img("/it-a.jpg", "it")],
  logos: [img("/logo-a.png", "it"), img("/logo-a2.png", "it")],
  backdrops: [img("/bd-a.jpg", null)],
}
const IMAGES_B = {
  posters: [img("/clean-b.jpg", null), img("/it-b.jpg", "it")],
  logos: [img("/logo-b.png", "it")],
  backdrops: [img("/bd-b.jpg", null)],
}

function detailsFixture(title: string, overrides: Record<string, unknown> = {}) {
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
    title,
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
    ...overrides,
  }
}

const AWARDS_A = {
  awards: ["Oscar"],
  nominations: ["Golden Globe Nom"],
  studios: ["Studio X"],
  director: "Jane Doe",
  keywords: ["heist"],
}

function savedMapping(): Mapping {
  return {
    tmdbId: 101,
    mediaType: "movie",
    title: "Alpha",
    posterPath: "/saved-a.jpg",
    logoPath: "/saved-logo.png",
    originalPosterPath: null,
    language: "it",
    updatedAt: new Date().toISOString(),
    backdropPath: "/saved-bd.jpg",
  }
}

async function renderRoot() {
  ctx = null
  ed = null
  const root = render(
    <PictoriumRoot>
      <Probe />
    </PictoriumRoot>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  // Mount loads mappings (immediate mock response above).
  await flush()
  return root
}

describe("editor early readiness (rank/awards do not block)", () => {
  beforeEach(() => {
    calls.length = 0
    queues.clear()
    mappingsPayload = []
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    })
    installFetchMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(["cataloghi", "myposters", "search"] as const)("cancels a pending title on leaving for %s and resumes on return", async (view) => {
    await renderRoot()
    await act(async () => { ctx!.setTmdbKey("test-key") })
    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    const oldSignals = [...signalsFor("/101/details"), ...signalsFor("/101/images"), ...signalsFor("/api/awards/")]
    expect(oldSignals.length).toBeGreaterThan(0)
    await act(async () => { ctx!.router.push(view) })
    expect(ctx!.view).toBe(view)
    expect(ctx!.loadingImages).toBe(false)
    for (const signal of oldSignals) expect(signal?.aborted).toBe(true)

    // Settling cancelled work must not publish artwork outside the editor.
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.previewPoster).toBeNull()
    await act(async () => { ctx!.router.push("edit") })
    expect(ctx!.loadingImages).toBe(true)
    expect(signalsFor("/101/images")).toHaveLength(2)
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
  })

  it("preserves manual artwork and styles when returning after a route replacement", async () => {
    await renderRoot()
    await act(async () => { ctx!.setTmdbKey("test-key") })
    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    await act(async () => {
      await ctx!.selectPoster(img("/it-a.jpg", "it"))
      await ctx!.selectLogo(img("/logo-a2.png", "it"))
      ed!.setLogoScale(42)
    })
    await act(async () => { ctx!.router.replace("cataloghi") })
    expect(signalsFor("/api/awards/").every((signal) => signal?.aborted)).toBe(true)
    await act(async () => { ctx!.router.push("edit") })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.previewPoster?.file_path).toBe("/it-a.jpg")
    expect(ctx!.selectedLogo?.file_path).toBe("/logo-a2.png")
    expect(ed!.logoScale).toBe(42)
  })

  it("opening a title from the catalog starts only one artwork load", async () => {
    await renderRoot()
    await act(async () => { ctx!.setTmdbKey("test-key"); ctx!.router.push("cataloghi") })
    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    expect(signalsFor("/101/images")).toHaveLength(1)
    expect(signalsFor("/101/images")[0]?.aborted).toBe(false)
  })

  it("publishes artwork and finishes main loading while rank/awards are pending", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    expect(ctx!.loadingImages).toBe(true)
    expect(ctx!.posters).toHaveLength(0)
    // Optional requests start in parallel with the main path.
    expect(pendingCount("rank:101")).toBe(1)
    expect(pendingCount("awards:101")).toBe(1)

    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()

    // Main path done while optionals are still pending.
    expect(pendingCount("rank:101")).toBe(1)
    expect(pendingCount("awards:101")).toBe(1)
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.posters).toHaveLength(2)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
    expect(ctx!.selectedLogo?.file_path).toBe("/logo-a.png")
    expect(ctx!.metaInfo.genres).toEqual([{ id: 18, name: "Drama" }])
    expect(ctx!.metaInfo.voteAverage).toBe(8.2)
    expect(ctx!.trendRank).toBeNull()
    expect(ctx!.metaInfo.awards ?? []).toEqual([])

    // Editor usable: manual artwork selection works before enrichment lands.
    await act(async () => {
      await ctx!.selectPoster(img("/it-a.jpg", "it"))
    })
    expect(ctx!.previewPoster?.file_path).toBe("/it-a.jpg")
  })

  it("late rank/awards update only their owned fields", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    await act(async () => {
      await ctx!.selectPoster(img("/it-a.jpg", "it"))
    })
    await act(async () => {
      ctx!.setAccentColor("#112233")
    })

    resolveAll("rank:101", { rank: 7 })
    resolveAll("awards:101", AWARDS_A)
    await flush()

    // Optional fields land; everything else is untouched.
    expect(ctx!.trendRank).toBe(7)
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
    expect(ctx!.metaInfo.nominations).toEqual(["Golden Globe Nom"])
    expect(ctx!.metaInfo.studios).toEqual(["Studio X"])
    expect(ctx!.metaInfo.director).toBe("Jane Doe")
    expect(ctx!.metaInfo.keywords).toEqual(["heist"])
    expect(ctx!.metaInfo.voteAverage).toBe(8.2)
    expect(ctx!.metaInfo.aggregatedRatings).toEqual({ sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 })
    expect(ctx!.metaInfo.genres).toEqual([{ id: 18, name: "Drama" }])
    expect(ctx!.posters).toHaveLength(2)
    expect(ctx!.previewPoster?.file_path).toBe("/it-a.jpg")
    expect(ctx!.accentColor).toBe("#112233")
  })

  it("optional results arriving before base are merged, not wiped", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    // Optionals settle first: nothing applied yet, base still pending.
    resolveAll("rank:101", { rank: 7 })
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.trendRank).toBeNull()
    expect(ctx!.loadingImages).toBe(true)

    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()

    // Base publish merges the stashed optional results.
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.trendRank).toBe(7)
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
    expect(ctx!.metaInfo.studios).toEqual(["Studio X"])
    expect(ctx!.metaInfo.genres).toEqual([{ id: 18, name: "Drama" }])
    expect(ctx!.posters).toHaveLength(2)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
  })

  it("terminal optional failures finalize with fallbacks and no retry", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    // TMDB-matched studio must survive the awards failure below.
    resolveAll("details:101", detailsFixture("Alpha", {
      production_companies: [{ name: "Pixar", logo_path: "/pixar.png", origin_country: "US" }],
    }))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
    expect(ctx!.metaInfo.studios).toEqual(["Pixar"])
    // Reference before the failures: only the awards catch below may replace it
    // (applyAwards always emits a new metaInfo object; a parked backoff changes
    // nothing, which is exactly what this guards against).
    const baseMeta = ctx!.metaInfo
    const baseJson = JSON.stringify(baseMeta)

    // 404 is terminal for http(): no retry, no backoff -- both optional
    // catches run within microtasks (no sleeps, no timer advance needed).
    settleResponse("rank:101", 404, "not found")
    settleResponse("awards:101", 404, "not found")
    await flush()
    // Same content (fallbacks are empty by design)...
    expect(JSON.stringify(ctx!.metaInfo)).toBe(baseJson)

    // Both optionals finalized: queues drained and no second attempt issued.
    expect(pendingCount("rank:101")).toBe(0)
    expect(pendingCount("awards:101")).toBe(0)
    expect(signalsFor("/api/trending/rank?type=movie&id=101")).toHaveLength(1)
    expect(signalsFor("/api/awards/movie/101")).toHaveLength(1)
    // The awards catch ran its functional update (not a parked backoff).
    expect(ctx!.metaInfo).not.toBe(baseMeta)

    // Artwork path intact; TMDB studio priority preserved over the failed fallback.
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.posters).toHaveLength(2)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
    expect(ctx!.trendRank).toBeNull()
    expect(ctx!.metaInfo.awards ?? []).toEqual([])
    expect(ctx!.metaInfo.studios).toEqual(["Pixar"])
    expect(ctx!.metaInfo.voteAverage).toBe(8.2)
    expect(ctx!.serviceErrors).toEqual({})
    // No unhandled rejection: vitest fails the run on those by default.
  })

  it("A->B aborts every A request; late A never touches B or its spinner", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    // A carries an original-language retry plus an MDBList lookup.
    resolveAll("details:101", detailsFixture("Alpha", { original_language: "fr", imdb_id: "tt1000001" }))
    resolveAll("images:101", IMAGES_A) // base-language artwork
    await flush()
    expect(pendingCount("images:101")).toBe(1) // orig-language retry in flight
    resolveAll("images:101", IMAGES_A) // retry resolves (merge)
    await flush()
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
    expect(pendingCount("mdblist")).toBe(1)

    const aSignals = [
      ...signalsFor("/api/tmdb/101/details"),
      ...signalsFor("/api/tmdb/101/images"),
      ...signalsFor("/api/trending/rank?type=movie&id=101"),
      ...signalsFor("/api/awards/movie/101"),
      ...signalsFor("/api/mdblist?imdb=tt1000001"),
    ]
    expect(aSignals.length).toBeGreaterThanOrEqual(6)
    for (const s of aSignals) expect(s, "loader request carries a signal").toBeTruthy()

    await act(async () => {
      ctx!.navigateToPoster(ITEM_B)
    })
    // Replacement load aborts all of A's network work, retry and MDBList too.
    for (const s of aSignals) expect(s!.aborted).toBe(true)
    expect(ctx!.loadingImages).toBe(true)

    // Late A responses are cancelled work: settling them changes nothing while
    // B is still loading (A's guarded finally must not clear B's spinner).
    resolveAll("rank:101", { rank: 99 })
    resolveAll("awards:101", { awards: ["Late Award"], nominations: [], studios: [], director: null, keywords: [] })
    resolveAll("mdblist", { match: null })
    await flush()
    expect(ctx!.loadingImages).toBe(true)
    expect(ctx!.selected?.id).toBe(202)

    resolveAll("details:202", detailsFixture("Beta"))
    resolveAll("images:202", IMAGES_B)
    await flush()

    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.selected?.id).toBe(202)
    expect(ctx!.posters.map((p) => p.file_path)).toEqual(["/clean-b.jpg", "/it-b.jpg"])
    expect(ctx!.previewPoster?.file_path).toBe("/clean-b.jpg")
    expect(ctx!.metaInfo.genres).toEqual([{ id: 18, name: "Drama" }])
    // B optionals still pending: no A rank leaked in.
    expect(ctx!.trendRank).toBeNull()

    // B's own optional channel still works after A's abort.
    resolveAll("rank:202", { rank: 5 })
    resolveAll("awards:202", AWARDS_A)
    await flush()
    expect(ctx!.trendRank).toBe(5)
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
  })

  it("region change on the same title lets only the latest load publish", async () => {
    const { unmount } = await renderRoot()
    // The language/region refresh effect requires a key to run.
    await act(async () => {
      ctx!.setTmdbKey("test-key")
    })
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    resolveAll("rank:101", { rank: 3 })
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.trendRank).toBe(3)

    // First region switch starts a load that stays pending...
    const markUs = calls.length
    await act(async () => {
      ed!.setDefaultRegion("US")
    })
    await flush()
    // Only the loader requests issued by the US switch (the reactive vote
    // refetch uses an identical URL shape but its own controller).
    const usLoaderSignals = calls
      .slice(markUs)
      .filter((c) => c.url.includes("/api/tmdb/101/details") || c.url.includes("/api/tmdb/101/images"))
      .map((c) => c.signal)
    expect(usLoaderSignals.length).toBe(2)

    // ...then a second switch aborts it; only the latest publishes.
    await act(async () => {
      ed!.setDefaultRegion("GB")
    })
    expect(usLoaderSignals.length).toBe(2)
    for (const s of usLoaderSignals) {
      expect(s, "superseded load carries a signal").toBeTruthy()
      expect(s!.aborted).toBe(true)
    }

    resolveAll("details:101", detailsFixture("Alpha GB"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.selected?.title).toBe("Alpha GB")
    expect(ctx!.posters).toHaveLength(2)
    unmount()
  })

  it("leaving the editor cancels the load and clears state", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    const loadSignals = [...signalsFor("/api/tmdb/101/details"), ...signalsFor("/api/tmdb/101/images")]
    expect(loadSignals.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      ctx!.goHome()
    })
    for (const s of loadSignals) expect(s!.aborted).toBe(true)
    // Late responses cannot repopulate the cleared editor.
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.selected).toBeNull()
    expect(ctx!.posters).toHaveLength(0)
    expect(ctx!.loadingImages).toBe(false)
  })

  it("unmount cancels the load without later updates", async () => {
    const { unmount } = await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    const loadSignals = [...signalsFor("/api/tmdb/101/details"), ...signalsFor("/api/tmdb/101/images")]
    expect(loadSignals.length).toBeGreaterThanOrEqual(2)

    unmount()
    for (const s of loadSignals) expect(s!.aborted).toBe(true)
    // Settling after unmount is a silent no-op (no unhandled rejection).
    for (const q of [...queues.values()]) for (const p of q) p.resolve(okJson({}))
    queues.clear()
    await flush(2)
  })

  it("refresh superseding a pending open still lands artwork and clears loading", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.setTmdbKey("test-key")
    })
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    expect(ctx!.loadingImages).toBe(true)
    expect(ctx!.previewPoster).toBeNull()
    // Region switch supersedes the pending open (its main never resolves).
    const markRefresh = calls.length
    await act(async () => {
      ed!.setDefaultRegion("US")
    })
    // The refresh issued its own main requests (a reactive vote refetch may
    // share the details URL shape but runs on its own controller).
    const refreshMain = calls
      .slice(markRefresh)
      .filter((c) => c.url.includes("/api/tmdb/101/details") || c.url.includes("/api/tmdb/101/images"))
    expect(refreshMain.length).toBe(2)
    // Complete only the latest load; optionals stay pending.
    resolveAll("details:101", detailsFixture("Alpha US"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.posters).toHaveLength(2)
    expect(ctx!.previewPoster?.file_path).toBe("/clean-a.jpg")
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.trendRank).toBeNull()
    // The refresh selection must not revert the just-changed region.
    expect(ed!.defaultRegion).toBe("US")
    // The refresh optional channel is alive: late rank applies.
    resolveAll("rank:101", { rank: 7 })
    await flush()
    expect(ctx!.trendRank).toBe(7)
  })

  it("base publish on refresh clears the previous country rank while the new one pends", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.setTmdbKey("test-key")
    })
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    resolveAll("rank:101", { rank: 3 })
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.trendRank).toBe(3)

    await act(async () => {
      ed!.setDefaultRegion("US")
    })
    resolveAll("details:101", detailsFixture("Alpha US"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    // New rank pending: the stale country rank must not linger.
    expect(ctx!.trendRank).toBeNull()
    expect(ctx!.posters).toHaveLength(2)

    resolveAll("rank:101", { rank: 7 })
    await flush()
    expect(ctx!.trendRank).toBe(7)
  })

  it("A->B with both mains pending keeps B spinner until B lands", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    expect(ctx!.loadingImages).toBe(true)
    const aSignals = [...signalsFor("/api/tmdb/101/details"), ...signalsFor("/api/tmdb/101/images")]
    expect(aSignals.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      ctx!.navigateToPoster(ITEM_B)
    })
    for (const s of aSignals) expect(s!.aborted).toBe(true)
    expect(ctx!.loadingImages).toBe(true)
    expect(ctx!.selected?.id).toBe(202)
    expect(ctx!.posters).toHaveLength(0)

    // Late A main settles cancelled: B is still loading.
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.loadingImages).toBe(true)
    expect(ctx!.selected?.id).toBe(202)

    resolveAll("details:202", detailsFixture("Beta"))
    resolveAll("images:202", IMAGES_B)
    await flush()
    expect(ctx!.loadingImages).toBe(false)
    expect(ctx!.posters.map((p) => p.file_path)).toEqual(["/clean-b.jpg", "/it-b.jpg"])
    expect(ctx!.previewPoster?.file_path).toBe("/clean-b.jpg")
  })

  it("TMDB-matched studios survive late awards fallback", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha", {
      production_companies: [{ name: "Pixar", logo_path: "/pixar.png", origin_country: "US" }],
    }))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.metaInfo.studios).toEqual(["Pixar"])
    expect(ctx!.metaInfo.awards ?? []).toEqual([])

    // Late awards carry a different studio: the TMDB match still wins.
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
    expect(ctx!.metaInfo.studios).toEqual(["Pixar"])
  })

  it("manual ratingSources change during enrichment is not reverted", async () => {
    await renderRoot()
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha", {
      voteAverage: 7.5,
      aggregatedRatings: { sources: { imdb: 9.0, tmdb: 7.0 }, average: 8.0, count: 2 },
    }))
    resolveAll("images:101", IMAGES_A)
    await flush()
    // Reactive confirm on the fresh sources averages both providers.
    expect(ctx!.metaInfo.voteAverage).toBe(8.0)

    // Manual source change recomputes the vote while optionals pend.
    await act(async () => {
      ed!.setRatingSources(["imdb"])
    })
    await flush()
    expect(ctx!.metaInfo.voteAverage).toBe(9.0)

    resolveAll("rank:101", { rank: 7 })
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.metaInfo.voteAverage).toBe(9.0)
    expect(ctx!.metaInfo.aggregatedRatings).toEqual({ sources: { imdb: 9.0, tmdb: 7.0 }, average: 8.0, count: 2 })
    expect(ed!.ratingSources).toEqual(["imdb"])
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
  })

  it("logoDisabled mapping keeps logo empty through enrichment", async () => {
    mappingsPayload = [{ ...savedMapping(), logoPath: null, logoDisabled: true }]
    await renderRoot()
    for (let i = 0; i < 10 && ctx!.mappings.length === 0; i++) await flush(2)
    expect(ctx!.mappings.length).toBe(1)

    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.previewPoster?.file_path).toBe("/saved-a.jpg")
    expect(ctx!.selectedLogo).toBeNull()

    resolveAll("rank:101", { rank: 9 })
    resolveAll("awards:101", AWARDS_A)
    await flush()
    expect(ctx!.selectedLogo).toBeNull()
    expect(ctx!.previewPoster?.file_path).toBe("/saved-a.jpg")
    expect(ctx!.trendRank).toBe(9)
  })

  it("saved mapping and manual selections survive late enrichment", async () => {
    mappingsPayload = [savedMapping()]
    await renderRoot()
    // Wait for the mapping to reach the store (immediate mock response).
    for (let i = 0; i < 10 && ctx!.mappings.length === 0; i++) await flush(2)
    expect(ctx!.mappings.length).toBe(1)

    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()

    // Mapping restore path wins for base/logo/backdrop.
    expect(ctx!.previewPoster?.file_path).toBe("/saved-a.jpg")
    expect(ctx!.selectedLogo?.file_path).toBe("/saved-logo.png")
    expect(ed!.selectedBackdrop?.file_path).toBe("/saved-bd.jpg")

    // Manual selections during enrichment.
    await act(async () => {
      await ctx!.selectPoster(img("/it-a.jpg", "it"))
      await ctx!.selectLogo(img("/logo-a2.png", "it"))
    })
    await act(async () => {
      ed!.setLogoScale(42)
    })
    expect(ctx!.previewPoster?.file_path).toBe("/it-a.jpg")
    expect(ed!.logoScale).toBe(42)

    resolveAll("rank:101", { rank: 9 })
    resolveAll("awards:101", AWARDS_A)
    await flush()

    // Enrichment adds its fields without resetting manual state.
    expect(ctx!.trendRank).toBe(9)
    expect(ctx!.metaInfo.awards).toEqual(["Oscar"])
    expect(ctx!.previewPoster?.file_path).toBe("/it-a.jpg")
    expect(ctx!.selectedLogo?.file_path).toBe("/logo-a2.png")
    expect(ed!.selectedBackdrop?.file_path).toBe("/saved-bd.jpg")
    expect(ed!.logoScale).toBe(42)
    expect(ctx!.metaInfo.voteAverage).toBe(8.2)
  })
})
