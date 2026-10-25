/**
 * Country-wide empty-document quarantine (`charts: []`).
 *
 * A whole fp-crawler country document with zero charts is quarantined as an
 * integrity failure by policy (strict path retains + gates, legacy falls
 * back to JW), never trusted as data: it must never overwrite a last-good
 * country cache, and must never publish a false-empty snapshot. No claim is
 * made about what the upstream served — only the received document shape is
 * judged. A chart that is PRESENT + fresh with `entries: []` stays a genuine
 * supported empty.
 *
 * Hermetic: fresh tmp DATA_DIR + fresh module registry per test, global
 * fetch stubbed (fp-crawler + JustWatch GraphQL shapes only, enrich off so
 * no TMDB traffic exists).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function romeChartDateLabel(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(nowMs)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("month")} ${Number(get("day"))}, ${get("year")}`
}

function goodItalyDoc(label: string, platforms: Array<{ slug: string; name: string; catId: string }> = []) {
  const entry = (rank: number, id: number, title: string, mediaType: string) => ({
    rank,
    title,
    tmdb: { id, media_type: mediaType, release_date: "2024-01-01" },
  })
  const charts = [
    {
      catalog_id: "netflix.movies",
      platform: "Netflix",
      category: "movies",
      date: label,
      entries: [entry(1, 1, "Good Movie", "movie")],
    },
    {
      catalog_id: "netflix.series",
      platform: "Netflix",
      category: "tv shows",
      date: label,
      entries: [entry(1, 2, "Good Show", "tv")],
    },
  ]
  let nextId = 10
  for (const p of platforms) {
    charts.push({
      catalog_id: `${p.catId}.movies`,
      platform: p.name,
      category: "movies",
      date: label,
      entries: [entry(1, nextId++, `${p.name} Movie`, "movie")],
    })
  }
  return { date: label, scraped_at_utc: new Date().toISOString(), charts }
}

/** Poison shape observed live: whole country document, zero charts. */
function emptyCountryDoc(): unknown {
  return { charts: [] }
}

function jwGraphqlResponse(startId: number, titles: string) {
  return Response.json({
    data: {
      streamingCharts: {
        edges: Array.from({ length: 10 }, (_, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: {
            content: {
              title: `${titles} ${i + 1}`,
              externalIds: { tmdbId: startId + i, imdbId: `tt0000${i + 1}` },
            },
          },
        })),
      },
    },
  })
}

let fp: typeof import("@/lib/flixpatrol")
let dataDir: string
let fetchCalls: string[]

async function freshImport(): Promise<void> {
  vi.resetModules()
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-fp-empty-country-"))
  vi.stubEnv("PICTORIUM_DATA_DIR", dataDir)
  fetchCalls = []
  fp = await import("@/lib/flixpatrol")
}

function stubFetch(handler: (url: string) => Response | Promise<Response> | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input)
      fetchCalls.push(url)
      const res = await handler(url)
      if (res) return res
      throw new Error(`unexpected upstream: ${url.slice(0, 120)}`)
    }),
  )
}

function fpFetch(handler: (url: string) => Response | Promise<Response> | null, opts?: { jw?: "rows" | "http500" | "none" }): void {
  stubFetch((url) => {
    if (url.includes("justwatch.com/graphql")) {
      if (opts?.jw === "http500") return new Response("err", { status: 500 })
      if (opts?.jw === "none") throw new Error("no JW traffic expected here")
      return jwGraphqlResponse(100, "JW Title")
    }
    const res = handler(url)
    return res
  })
}

/** saveCache is fire-and-forget: poll the disk file until it settles. */
async function readDiskCache(
  country: string,
  accept?: (doc: { catalog?: { charts?: unknown[] } } | null) => boolean,
): Promise<{ catalog?: { charts?: unknown[] } } | null> {
  const file = path.join(dataDir, `flixpatrol_cache_${country}.json`)
  const deadline = Date.now() + 5000
  let last: { catalog?: { charts?: unknown[] } } | null = null
  for (;;) {
    try {
      last = JSON.parse(fs.readFileSync(file, "utf-8"))
    } catch {
      last = null
    }
    if (!accept || accept(last)) return last
    if (Date.now() > deadline) return last
    await new Promise((r) => setTimeout(r, 25))
  }
}

const hasCharts = (doc: { catalog?: { charts?: unknown[] } } | null): boolean =>
  Array.isArray(doc?.catalog?.charts) && (doc?.catalog?.charts?.length ?? 0) > 0

beforeEach(freshImport)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("country-wide empty document quarantine", () => {
  it("strict sides report docInvalid (integrity) on a network country-empty, never a hit", async () => {
    fpFetch(() => Response.json(emptyCountryDoc()))
    const sides = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(sides.movie.kind).toBe("miss")
    expect(sides.tv.kind).toBe("miss")
    expect(sides.loadFailed).toBe(false)
    expect(sides.docInvalid).toBe(true)
  })

  it("legacy sides report a plain miss on country-empty (JW fallback owns the decision), no throw", async () => {
    fpFetch(() => Response.json(emptyCountryDoc()))
    const sides = await fp.resolveFlixPlatformSides("netflix", "italy")
    expect(sides.movie.kind).toBe("miss")
    expect(sides.tv.kind).toBe("miss")
    expect(sides.loadFailed).toBe(false)
  })

  it("legacy getTop10 falls back to JW on country-empty (tolerant semantics preserved)", async () => {
    fpFetch((url) => (url.includes("italy.json") ? Response.json(emptyCountryDoc()) : null), { jw: "rows" })
    const data = await fp.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(data.movies).toHaveLength(10)
    expect(data.tv).toHaveLength(10)
    expect(data.movies[0].title).toBe("JW Title 1")
    expect(fetchCalls.some((u) => u.includes("italy.json"))).toBe(true)
    expect(fetchCalls.some((u) => u.includes("justwatch.com/graphql"))).toBe(true)
  })

  it("strict getTop10 with JW down throws on country-empty (both sources down), never a fake empty", async () => {
    fpFetch((url) => (url.includes("italy.json") ? Response.json(emptyCountryDoc()) : null), { jw: "http500" })
    await expect(fp.getTop10("netflix", "italy", undefined, { enrich: false, freshOrThrow: true })).rejects.toThrow()
  })

  it("genuine individual empty still resolves: present + fresh chart with entries[] is a hit, strict getTop10 returns [] without throw", async () => {
    const label = romeChartDateLabel()
    const emptyChartsDoc = {
      date: label,
      charts: [
        { catalog_id: "netflix.movies", platform: "Netflix", category: "movies", date: label, entries: [] },
        { catalog_id: "netflix.series", platform: "Netflix", category: "tv shows", date: label, entries: [] },
      ],
    }
    fpFetch((url) => (url.includes("italy.json") ? Response.json(emptyChartsDoc) : null), { jw: "none" })
    const sides = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(sides.movie).toEqual({ kind: "hit", entries: [] })
    expect(sides.tv).toEqual({ kind: "hit", entries: [] })
    const data = await fp.getTop10("netflix", "italy", undefined, { enrich: false, freshOrThrow: true })
    expect(data.movies).toEqual([])
    expect(data.tv).toEqual([])
    // Zero JW traffic: both sides were genuine FP empties.
    expect(fetchCalls.some((u) => u.includes("justwatch.com/graphql"))).toBe(false)
  })

  it("transport errors keep existing semantics (strict loadFailed, legacy JW fallback)", async () => {
    fpFetch(() => {
      throw new Error("fp-crawler down")
    }, { jw: "rows" })
    const strict = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(strict.loadFailed).toBe(true)
    expect(strict.movie.kind).toBe("miss")
    const legacy = await fp.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(legacy.movies).toHaveLength(10)
  })

  it("poisoned disk cache heals on a healthy feed without waiting for TTL (first encounter refetches)", async () => {
    // Seed the exact poison observed live: whole-country `charts: []`
    // with a FRESH timestamp (the old code would trust it for 12h).
    fs.writeFileSync(
      path.join(dataDir, "flixpatrol_cache_italy.json"),
      JSON.stringify({ catalog: emptyCountryDoc(), timestamp: Date.now() }),
      "utf-8",
    )
    const label = romeChartDateLabel()
    fpFetch((url) => (url.includes("italy.json") ? Response.json(goodItalyDoc(label)) : null), { jw: "none" })
    const strict = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(strict.movie.kind).toBe("hit")
    expect(strict.docInvalid ?? false).toBe(false)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
    const disk = await readDiskCache("italy", hasCharts)
    expect(hasCharts(disk)).toBe(true)
  })

  it("poisoned disk cache with a still-empty feed reports unusable without a refetch storm", async () => {
    fs.writeFileSync(
      path.join(dataDir, "flixpatrol_cache_italy.json"),
      JSON.stringify({ catalog: emptyCountryDoc(), timestamp: Date.now() }),
      "utf-8",
    )
    fpFetch(
      (url) => {
        if (url.includes("italy.json")) return Response.json(emptyCountryDoc())
        return null
      },
      { jw: "rows" },
    )
    // First encounter refetches once (cooldown arms from this observation)...
    const first = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(first.docInvalid).toBe(true)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
    // ...further reads within the cooldown share the verdict, no refetch.
    const second = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(second.docInvalid).toBe(true)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
    // Legacy still falls back to JW, no FP refetch either.
    const legacy = await fp.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(legacy.movies).toHaveLength(10)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
  })

  it("poisoned cache TTL-expired triggers a refetch and heals on a healthy payload", async () => {
    fs.writeFileSync(
      path.join(dataDir, "flixpatrol_cache_italy.json"),
      JSON.stringify({ catalog: emptyCountryDoc(), timestamp: Date.now() - 13 * 60 * 60 * 1000 }),
      "utf-8",
    )
    const label = romeChartDateLabel()
    fpFetch((url) => (url.includes("italy.json") ? Response.json(goodItalyDoc(label)) : null), { jw: "none" })
    const sides = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(sides.movie.kind).toBe("hit")
    expect(fetchCalls.some((u) => u.includes("italy.json"))).toBe(true)
    const disk = await readDiskCache("italy", hasCharts)
    expect(hasCharts(disk)).toBe(true)
  })

  it("network country-empty never overwrites a last-good cache (timestamps preserved; strict retains, legacy fail-opens)", async () => {
    const label = romeChartDateLabel()
    let serveEmpty = false
    fpFetch((url) => (url.includes("italy.json") ? Response.json(serveEmpty ? emptyCountryDoc() : goodItalyDoc(label)) : null), {
      jw: "none",
    })
    // Seed last-good via a healthy fetch.
    const seeded = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(seeded.movie.kind).toBe("hit")
    const diskBefore = await readDiskCache("italy", hasCharts)
    expect(hasCharts(diskBefore)).toBe(true)
    // Upstream flips to whole-country empty; a future floor forces a real
    // refetch past the warmed cache.
    serveEmpty = true
    const floor = Date.now() + 3_600_000
    const quarantined = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true, minFetchedAtMs: floor })
    // Strict mirrors a transport failure with previous data: retention signal.
    expect(quarantined.loadFailed).toBe(true)
    expect(quarantined.loadError).toBeDefined()
    expect(quarantined.movie.kind).toBe("miss")
    // Legacy mirrors fail-open: the last-good payload still serves.
    const legacy = await fp.resolveFlixPlatformSides("netflix", "italy", { minFetchedAtMs: floor })
    expect(legacy.movie.kind).toBe("hit")
    // Disk payload byte-identical: the empty observation never overwrote it.
    const diskAfter = await readDiskCache("italy", hasCharts)
    expect(JSON.stringify(diskAfter)).toBe(JSON.stringify(diskBefore))
  })

  it("active quarantine short-circuits refresh with a stale last-good: N sequential requests share one verdict, heal after cooldown", async () => {
    const t0 = Date.now()
    const label = romeChartDateLabel(t0)
    let mockedNow = t0
    vi.spyOn(Date, "now").mockImplementation(() => mockedNow)
    let serveEmpty = false
    fpFetch((url) => (url.includes("italy.json") ? Response.json(serveEmpty ? emptyCountryDoc() : goodItalyDoc(label)) : null), {
      jw: "none",
    })
    // Last-good fetched BEFORE the floor.
    const seeded = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(seeded.movie.kind).toBe("hit")
    // Upstream flips to empty; a future floor forces exactly ONE real
    // refetch that observes the empty document and arms the cooldown.
    serveEmpty = true
    const floor = mockedNow + 3_600_000
    const firstStrict = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true, minFetchedAtMs: floor })
    expect(firstStrict.loadFailed).toBe(true)
    expect(firstStrict.loadError).toBeDefined()
    const fetchesAfterFirst = fetchCalls.filter((u) => u.includes("italy.json")).length
    expect(fetchesAfterFirst).toBeGreaterThan(0)
    // N sequential same-country requests during the cooldown share the
    // verdict with ZERO extra upstream fetches: strict retains, legacy
    // fail-opens on the retained payload.
    for (let i = 0; i < 3; i++) {
      const s = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true, minFetchedAtMs: floor })
      expect(s.loadFailed).toBe(true)
      expect(s.loadError).toBeDefined()
      expect(s.movie.kind).toBe("miss")
      const l = await fp.resolveFlixPlatformSides("netflix", "italy", { minFetchedAtMs: floor })
      expect(l.movie.kind).toBe("hit")
    }
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(fetchesAfterFirst)
    // Past the cooldown a healed feed recovers with exactly one refetch.
    mockedNow = t0 + 61_000
    serveEmpty = false
    const healed = await fp.resolveFlixPlatformSides("netflix", "italy", {
      freshOrThrow: true,
      minFetchedAtMs: mockedNow + 3_600_000,
    })
    expect(healed.movie.kind).toBe("hit")
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(fetchesAfterFirst + 1)
  })

  it("repeated strict failures stay bounded: active-cooldown empty observation is not refetched", async () => {
    fpFetch((url) => (url.includes("italy.json") ? Response.json(emptyCountryDoc()) : null), { jw: "none" })
    const first = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(first.docInvalid).toBe(true)
    const callsAfterFirst = fetchCalls.length
    expect(callsAfterFirst).toBeGreaterThan(0)
    const second = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(second.docInvalid).toBe(true)
    // The 60s negative cooldown marks the empty observation known-unusable
    // (nothing is stored): no second upstream fetch.
    expect(fetchCalls.length).toBe(callsAfterFirst)
  })

  it("generic strict path reports outage (not unavailable) on country-empty", async () => {
    fpFetch((url) => (url.includes("united-states.json") ? Response.json(emptyCountryDoc()) : null), { jw: "none" })
    const res = await fp.resolveGenericFlixCharts("hulu", "united-states", "series")
    expect(res.kind).toBe("miss")
    expect(res.docInvalid).toBe(true)
  })

  it("cooldown expiry allows recovery: empty, then healthy after 60s -> hit without a 12h wait", async () => {
    const t0 = Date.now()
    const label = romeChartDateLabel(t0)
    let mockedNow = t0
    vi.spyOn(Date, "now").mockImplementation(() => mockedNow)
    let serveEmpty = true
    fpFetch((url) => (url.includes("italy.json") ? Response.json(serveEmpty ? emptyCountryDoc() : goodItalyDoc(label)) : null), {
      jw: "none",
    })
    const first = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(first.docInvalid).toBe(true)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
    // Past the 60s negative cooldown the feed healed: refetch recovers.
    mockedNow = t0 + 61_000
    serveEmpty = false
    const second = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(second.movie.kind).toBe("hit")
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(2)
    // The healed payload is last-good now: a forced refetch that still sees
    // empty retains (strict) instead of publishing anything.
    mockedNow = t0 + 62_000
    serveEmpty = true
    const floor = mockedNow + 3_600_000
    const third = await fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true, minFetchedAtMs: floor })
    expect(third.loadFailed).toBe(true)
    expect(third.movie.kind).toBe("miss")
    const disk = await readDiskCache("italy", hasCharts)
    expect(hasCharts(disk)).toBe(true)
  })

  it("concurrent same-country refetches share one upstream read (no storm)", async () => {
    const label = romeChartDateLabel()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    stubFetch(async (url) => {
      if (url.includes("italy.json")) {
        await gate
        return Response.json(
          goodItalyDoc(label, [
            { slug: "disney", name: "Disney+", catId: "disney" },
            { slug: "apple-tv", name: "Apple TV", catId: "apple-tv" },
          ]),
        )
      }
      throw new Error(`unexpected upstream: ${url.slice(0, 120)}`)
    })
    const pending = [
      fp.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true }),
      fp.resolveFlixPlatformSides("disney", "italy", { freshOrThrow: true }),
      fp.resolveFlixPlatformSides("apple-tv", "italy", { freshOrThrow: true }),
    ]
    await new Promise((r) => setTimeout(r, 25))
    release()
    const results = await Promise.all(pending)
    expect(fetchCalls.filter((u) => u.includes("italy.json"))).toHaveLength(1)
    for (const sides of results) expect(sides.movie.kind).toBe("hit")
  })
})

describe("cold country-empty at the renewal boundary (no fake publish)", () => {
  it("fetchChartFamilyRows rejects and ensureFreshChartFamily stays live + gated", async () => {
    vi.resetModules()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-fp-empty-cold-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", dir)
    const cg = await import("@/lib/chart-generation")
    const renewal = await import("@/lib/chart-renewal")
    cg.__setChartGenerationPersistForTest(cg.__inMemoryChartGenerationPersist())
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.includes("united-states.json")) return Response.json(emptyCountryDoc())
        throw new Error(`unexpected upstream: ${url.slice(0, 120)}`)
      }),
    )
    const input = {
      regionCode: "US",
      regionLang: "en-US",
      mdblistKey: null as string | null,
      family: "stream2:flixpatrol:hulu:united-states:series:-",
    }
    // No published snapshot is faked from a country-empty: the fetch throws.
    await expect(
      renewal.fetchChartFamilyRows(input.family, { ...input, floor: Date.now() + 3_600_000 }),
    ).rejects.toThrow()
    // Cold + failure: no pin minted (stays live), failure gate active.
    const pin = await renewal.ensureFreshChartFamily(input)
    expect(pin.id).toBe(cg.CHART_LIVE_PIN_ID)
    expect(pin.snapshot).toBeNull()
    expect(await cg.isChartFamilyGated(input)).toBe(true)
  })
})
