// Poster details recovery: session-hit reuse, transient retry, abort-aware retry.
//
// Scope: the TV details recovery at the end of the poster render pipeline
// (route.ts: session cache ?? getDetails cap8s ?? getDetails cap8s), which
// recovers networks/studios for mapped/query titles that carry none.
//
// Contract pinned here:
// - session hit → zero details fetch (no extra work);
// - transient first failure → exactly one retry, networks still recovered;
// - hard abort (render deadline) → the retry is skipped, the recovery still
//   settles, the caller answers 503 from the watchdog;
// - persistent failure → fallback output (200, no studio badge), retry kept.
// - overlap → the recovery fetch starts while the sharp resize is held
//   pending (gate-based, deterministic — not timing);
// - mapping overrides win whether session details resolve before the resize
//   (synchronous) or the fetch resolves after the resize completed
//   (deferred, gated on toBuffer settle — not resize start).
process.env.PICTORIUM_RENDER_TIMEOUT_MS = "2000"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Gate on the sharp resize so tests can HOLD the poster resize pending and
// observe whether the details recovery fetch starts meanwhile. Only instances
// where `.resize()` was called are gated (the route's poster resize); fixture
// creation via `sharp({ create }).png().toBuffer()` never calls resize and
// passes through even while armed. Default disarmed → byte-identical
// passthrough for the pre-existing tests. Statics (cache/concurrency used by
// initSharp) are copied onto the wrapper.
const sharpGate = vi.hoisted(() => ({
  armed: false,
  block: false,
  entered: false,
  completed: false,
  gate: null as Promise<void> | null,
  openGate: null as (() => void) | null,
}))

vi.mock("sharp", async (importOriginal) => {
  const mod = await importOriginal<typeof import("sharp")>()
  const realSharp = mod.default
  type SharpLike = {
    resize: (...args: unknown[]) => SharpLike
    toBuffer: (...args: unknown[]) => Promise<Buffer>
  }
  const gated = Object.assign(
    (...args: unknown[]) => {
      const inst = (realSharp as (...a: unknown[]) => SharpLike)(...args)
      if (!sharpGate.armed) return inst
      let resized = false
      const origResize = inst.resize.bind(inst)
      const origToBuffer = inst.toBuffer.bind(inst)
      inst.resize = (...a: unknown[]): SharpLike => {
        resized = true
        sharpGate.entered = true
        return origResize(...a)
      }
      inst.toBuffer = (...a: unknown[]): Promise<Buffer> => {
        // Completion marks the route's resize await settling, which runs
        // strictly before the synchronous mapping assignments below it.
        const markCompleted = (buf: Buffer): Buffer => {
          if (resized) sharpGate.completed = true
          return buf
        }
        if (!resized || !sharpGate.block || !sharpGate.gate) return origToBuffer(...a).then(markCompleted)
        sharpGate.entered = true
        return sharpGate.gate.then(() => origToBuffer(...a)).then(markCompleted)
      }
      return inst
    },
    realSharp,
  )
  return { ...mod, default: gated }
})

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

vi.mock("@/lib/svg-badge", () => ({
  renderGenreBadge: vi.fn(async () => null),
  renderRankingBadge: vi.fn(async () => null),
  renderExtraBadge: vi.fn(async () => null),
  renderQualityBadge: vi.fn(async () => null),
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(async () => ({
    id: 0, title: "unused", genres: [], vote_average: 0, vote_count: 0,
    external_ids: { imdb_id: null, tvdb_id: null },
  })),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn(() => undefined),
  resolveUserApiKeys: vi.fn(async () => {
    const none = { key: undefined, source: "none" } as const
    return { tmdb: none, mdblist: none, tvdb: none, simkl: none, fanart: none }
  }),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))

// Dynamic imports AFTER the module-level env above: the route reads
// RENDER_TIMEOUT_MS at evaluation time.
const { GET } = await import("@/app/api/poster/[type]/[id]/route")
const { getById } = await import("@/lib/store")
const { getDetails } = await import("@/lib/tmdb")
const { cacheClear } = await import("@/lib/cache")
const { __resetPosterRenderLimiter, getPosterStats, acquirePosterRenderSlot, posterErrorStats } = await import("@/lib/poster-runtime-cache")
const { __resetTMDBSessionCache, setTMDBSessionCache } = await import("@/lib/tmdb-session-cache")
const { __resetImageBytesForTest } = await import("@/lib/image-bytes-cache")
const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)

// Bounded poll on a real condition (existing stats/hooks), never a fixed
// sleep: resolves true when cond() holds within timeoutMs, false otherwise.
async function waitFor(cond: () => boolean, timeoutMs: number, stepMs = 25): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (cond()) return true
    if (Date.now() >= end) return cond()
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

function armSharpGate(block: boolean) {
  sharpGate.armed = true
  sharpGate.block = block
  sharpGate.entered = false
  sharpGate.completed = false
  sharpGate.gate = new Promise<void>((resolve) => { sharpGate.openGate = resolve })
}

function disarmSharpGate() {
  sharpGate.armed = false
  sharpGate.block = false
  sharpGate.openGate?.()
  sharpGate.openGate = null
  sharpGate.gate = null
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

function mappedFixture(tmdbId: number) {
  return {
    tmdbId,
    mediaType: "movie" as const,
    title: `Recovery ${tmdbId}`,
    posterPath: `/recovery-${tmdbId}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    showBadges: false,
    rankingBadges: false,
    updatedAt: "2026-10-01T10:15:30.000Z",
  }
}

function stubImages(poster: Buffer) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(poster.length) },
    }),
  )
}

function detailsWithCompanies(tmdbId: number) {
  return {
    id: tmdbId,
    title: `Recovery ${tmdbId}`,
    genres: [{ id: 18, name: "Drama" }],
    vote_average: 7.5,
    vote_count: 100,
    original_language: "en",
    release_date: "2024-01-15",
    networks: [],
    production_companies: [{ name: "Acme Pictures", logo_path: null, origin_country: "US" }],
  }
}

describe("poster details recovery (networks/studios)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    __resetImageBytesForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    disarmSharpGate()
    vi.unstubAllEnvs()
  })

  it("serves networks from the session cache without a details fetch", async () => {
    const tmdbId = 61011
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue(mappedFixture(tmdbId))
    // Same language the route resolves (mapping.language "it"): the recovery
    // must reuse this entry instead of fetching.
    setTMDBSessionCache("movie", tmdbId, "it", {
      details: {
        id: tmdbId,
        title: `Recovery ${tmdbId}`,
        genres: [],
        vote_average: 0,
        vote_count: 0,
        networks: [{ name: "Acme Pictures", logo_path: null, origin_country: "US" }],
        production_companies: [],
      } as never,
    })

    mockedGetDetails.mockClear()
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )

    expect(res.status).toBe(200)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(0)
    const body = await res.json() as { badge: { computed: { studioBadge: unknown } } }
    expect(body.badge.computed.studioBadge).toBe("Acme Pictures")
  })

  it("retries once on transient failure and still recovers networks", async () => {
    const tmdbId = 61012
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue(mappedFixture(tmdbId))

    let calls = 0
    mockedGetDetails.mockImplementation(async (_mediaType: unknown, id: unknown) => {
      calls++
      if (id === tmdbId && calls === 1) throw new Error("cold-start blip")
      return detailsWithCompanies(tmdbId) as never
    })

    mockedGetDetails.mockClear()
    calls = 0
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )

    expect(res.status).toBe(200)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(2)
    const body = await res.json() as { badge: { computed: { studioBadge: unknown } } }
    expect(body.badge.computed.studioBadge).toBe("Acme Pictures")
  })

  it("skips the retry after the render deadline and still settles", { timeout: 20000 }, async () => {
    const tmdbId = 61013
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue(mappedFixture(tmdbId))

    // Signal-cooperative hang (like the real fetch layer): pending until the
    // watchdog aborts, immediate rejection once already aborted.
    mockedGetDetails.mockImplementation(
      async (_mediaType: unknown, _id: unknown, _lang: unknown, _key: unknown, signal: unknown) => {
        const s = signal as AbortSignal | undefined
        if (s?.aborted) throw new DOMException("Aborted", "AbortError")
        await new Promise<void>((_resolve, reject) => {
          s?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
        })
        throw new DOMException("Aborted", "AbortError")
      },
    )

    mockedGetDetails.mockClear()
    const errWritesBefore = posterErrorStats().writes
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )

    // The watchdog answers 503 at the 2s deadline; the recovery must NOT fire
    // a second full-cap wait after the abort.
    expect(res.status).toBe(503)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(1)
    // Bounded wait on the ACTUAL zombie settle via existing limiter stats —
    // the watchdog released the slot (active=0) and holds budget as zombie=1
    // until the job's finally runs endZombieRender. No fixed sleep: this loop
    // observes real completion and fails loudly on timeout instead of passing
    // blind on an arbitrary delay.
    const settled = await waitFor(
      () => {
        const s = getPosterStats()
        return s.zombieRenders === 0 && s.activeRenders === 0
      },
      10000,
    )
    expect(settled).toBe(true)
    expect(getPosterStats().zombieRenders).toBe(0)
    expect(getPosterStats().activeRenders).toBe(0)
    // Still exactly one attempt: no retry after the abort, no late duplicate.
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(1)
    // Single 503 accounting: the watchdog wrote once at the deadline; the
    // late-settling job must not rewrite (existing hook, same rule as the H2
    // non-cooperative test).
    expect(posterErrorStats().writes).toBe(errWritesBefore + 1)
    // Slot budget actually free (existing hook): acquirable and released.
    const slot = await acquirePosterRenderSlot()
    expect(slot).toBeTruthy()
    slot!()
    // No inflight residue: the same key answers from the watchdog's single
    // 503 negative-cache entry immediately instead of coalescing on a leaked
    // render (which would park up to the 15s RENDER_SLOT_WAIT_MS). The 5s
    // bound discriminates a ~ms negative hit from a 15s coalesce wait, and
    // the short-circuit must not trigger a new details fetch.
    const t1 = Date.now()
    const res2 = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )
    expect(res2.status).toBe(503)
    expect(Date.now() - t1).toBeLessThan(5000)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(1)
    expect(posterErrorStats().writes).toBe(errWritesBefore + 1)
  })

  it("renders the fallback poster when details stay unavailable", async () => {
    const tmdbId = 61014
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue(mappedFixture(tmdbId))

    mockedGetDetails.mockRejectedValue(new Error("upstream down"))
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )

    // Fallback: 200 without a studio badge, and the transient retry is kept
    // (two attempts, no selective error plumbing).
    expect(res.status).toBe(200)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(2)
    const body = await res.json() as { badge: { computed: { studioBadge: unknown } } }
    expect(body.badge.computed.studioBadge).toBeNull()
  })

  it("starts details recovery while the resize is held pending (overlap)", { timeout: 20000 }, async () => {
    const tmdbId = 61015
    // Fixture buffer BEFORE arming: creation never calls .resize(), but the
    // ordering keeps the gate strictly about the route's resize.
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue(mappedFixture(tmdbId))
    mockedGetDetails.mockImplementation(async () => detailsWithCompanies(tmdbId) as never)
    mockedGetDetails.mockClear()

    // Hold the route's sharp resize pending; the recovery fetch must already
    // start meanwhile. Pre-overlap code awaited the recovery only AFTER the
    // resize, so with the gate closed getDetails would never be called.
    armSharpGate(true)
    // Owned promise declared OUTSIDE try: on an assertion failure the
    // finally below still releases the gate and collects completion instead
    // of leaking the GET (disarm alone would release but never settle it).
    let p: Promise<Response> | null = null
    try {
      p = GET(
        new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
        { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
      )
      // The route reached the resize (and is blocked on the closed gate).
      expect(await waitFor(() => sharpGate.entered, 10000)).toBe(true)
      // While the resize is STILL held pending, recovery has started.
      expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId).length).toBeGreaterThan(0)
      // Release the CPU; the render completes with recovered networks.
      sharpGate.openGate?.()
      const res = await p
      expect(res.status).toBe(200)
      const body = await res.json() as { badge: { computed: { studioBadge: unknown } } }
      expect(body.badge.computed.studioBadge).toBe("Acme Pictures")
    } finally {
      disarmSharpGate()
      // Always collect the owned GET even when an assertion above threw, so
      // no slot/zombie leaks into the next test; swallowed here so the
      // original failure propagates unchanged.
      await p?.then(
        () => undefined,
        () => undefined,
      )
    }
  })

  it("keeps mapping metadata overrides when session details resolve before resize", async () => {
    const tmdbId = 61016
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue({
      ...mappedFixture(tmdbId),
      tvType: "Miniseries",
      tvStatus: "Ended",
      releaseDate: "2023-05-01",
      firstAirDate: "2023-04-01",
    })
    // Synchronous session hit: the recovery body runs to completion BEFORE
    // the mapping assignments below it, filling nulls from session values
    // that conflict with the mapping. The unconditional mapping overwrite
    // must still win; the recovery-owned networks must still apply.
    setTMDBSessionCache("movie", tmdbId, "it", {
      details: {
        id: tmdbId,
        title: `Recovery ${tmdbId}`,
        genres: [],
        vote_average: 0,
        vote_count: 0,
        release_date: "2024-01-15",
        first_air_date: "2024-01-01",
        type: "Scripted",
        status: "Returning Series",
        networks: [{ name: "Session Net", logo_path: null, origin_country: "US" }],
        production_companies: [],
      } as never,
    })

    mockedGetDetails.mockClear()
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
      { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
    )

    expect(res.status).toBe(200)
    expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(0)
    const body = await res.json() as { genre: { year: unknown }; badge: { computed: { studioBadge: unknown } } }
    // Mapping releaseDate won over the session 2024-01-15.
    expect(body.genre.year).toBe("2023")
    // Recovery still applied its own fields from the session details.
    expect(body.badge.computed.studioBadge).toBe("Session Net")
  })

  it("keeps mapping metadata overrides when details resolve after resize", { timeout: 20000 }, async () => {
    const tmdbId = 61017
    const poster = await imageBuffer("#101010", 500, 750)
    stubImages(poster)
    mockedGetById.mockResolvedValue({
      ...mappedFixture(tmdbId),
      tvType: "Miniseries",
      tvStatus: "Ended",
      releaseDate: "2023-05-01",
      firstAirDate: "2023-04-01",
    })
    // Observe the resize without blocking it; the fetch resolves only after
    // the resize COMPLETED (toBuffer settled + yield), i.e. after the mapping
    // assignments already ran, so the recovery guards must preserve them.
    // (Resize START alone is not enough: it fires before the assignments.)
    armSharpGate(false)
    try {
      mockedGetDetails.mockImplementation(async (_mediaType: unknown, id: unknown) => {
        if (id === tmdbId) {
          // Gate on resize COMPLETION, not resize start: the route's
          // synchronous mapping assignments run right after the resize await,
          // so completion plus a macrotask yield guarantees they applied
          // before this fetch resolves and the recovery guards run. (Gating
          // only on `entered`/resize start could still resolve while the
          // resize is pending — the same order as the early test.)
          expect(await waitFor(() => sharpGate.completed, 10000)).toBe(true)
          await new Promise((r) => setTimeout(r, 0))
        }
        return {
          ...detailsWithCompanies(tmdbId),
          release_date: "2024-01-15",
          first_air_date: "2024-01-01",
          type: "Scripted",
          status: "Returning Series",
          networks: [{ name: "Late Net", logo_path: null, origin_country: "US" }],
          production_companies: [],
        } as never
      })
      mockedGetDetails.mockClear()

      const res = await GET(
        new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?debug=1`),
        { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
      )

      expect(res.status).toBe(200)
      expect(mockedGetDetails.mock.calls.filter((c) => c[1] === tmdbId)).toHaveLength(1)
      const body = await res.json() as { genre: { year: unknown }; badge: { computed: { studioBadge: unknown } } }
      // Mapping releaseDate won over the late 2024-01-15.
      expect(body.genre.year).toBe("2023")
      // Recovery still applied its own fields from the late fetch.
      expect(body.badge.computed.studioBadge).toBe("Late Net")
    } finally {
      disarmSharpGate()
    }
  })
})
