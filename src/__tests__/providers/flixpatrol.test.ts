import { describe, expect, it, vi, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-flixpatrol-test-"))

// Chart dates ride the wall clock (dynamic Rome-today label): the behaviors
// under test here are country routing and source priority, while chart-date
// freshness must always pass — stale dates are covered by dedicated tests.
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

function makeCatalog(prefix: string): unknown {
  const label = romeChartDateLabel()
  return {
    date: label,
    scraped_at_utc: new Date().toISOString(),
    charts: [
      {
        catalog_id: "netflix",
        platform: "Netflix",
        category: "movies",
        date: label,
        entries: [
          { rank: 1, title: `${prefix} Movie`, tmdb: { id: 1, media_type: "movie", release_date: "2024-01-01" } },
        ],
      },
      {
        catalog_id: "netflix",
        platform: "Netflix",
        category: "tv shows",
        date: label,
        entries: [
          { rank: 1, title: `${prefix} Show`, tmdb: { id: 2, media_type: "tv", release_date: "2024-02-01" } },
        ],
      },
    ],
  }
}

describe("flixpatrol country support (D7)", () => {
  it("uses global platform ranks without filling short charts with national titles", async () => {
    vi.resetModules()
    process.env.POSTERIUM_DATA_DIR = tmpDir
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      expect(request.variables.countryStreamingCharts).toBeNull()
      expect(request.variables.country).toBe("US")
      expect(request.variables.filter.packages).toContain("nfx")
      return new Response(JSON.stringify({ data: { streamingCharts: { edges: [{
        streamingChartInfo: { rank: 1 },
        node: { content: { title: "Global title", externalIds: { tmdbId: 550, imdbId: "tt0137523" } } },
      }] } } }))
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { getTop10 } = await import("@/lib/flixpatrol")
    const data = await getTop10("netflix", "global", undefined, { enrich: false })
    expect(data.country).toBe("global")
    expect(data.movies).toHaveLength(1)
    expect(data.tv).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("honours the country param instead of always returning Italy", async () => {
    vi.resetModules()
    process.env.POSTERIUM_DATA_DIR = tmpDir
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes("italy.json")) return new Response(JSON.stringify(makeCatalog("IT")))
      if (u.includes("france.json")) return new Response(JSON.stringify(makeCatalog("FR")))
      return new Response("not found", { status: 404 })
    }))

    const { getTop10 } = await import("@/lib/flixpatrol")

    const itData = await getTop10("netflix", "italy")
    expect(itData.movies[0].title).toBe("IT Movie")
    expect(itData.tv[0].title).toBe("IT Show")

    const frData = await getTop10("netflix", "france")
    expect(frData.movies[0].title).toBe("FR Movie")
    expect(frData.country).toBe("france")
  })

  it("rejects unsupported countries (fail-closed)", async () => {
    vi.resetModules()
    process.env.POSTERIUM_DATA_DIR = tmpDir
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })))

    const { getTop10 } = await import("@/lib/flixpatrol")
    await expect(getTop10("netflix", "atlantis")).rejects.toThrow("Unsupported country: atlantis")
  })

  it("falls back to JustWatch when FlixPatrol is down (FP-first, JW fallback)", async () => {
    vi.resetModules()
    // Hermetic disk: earlier tests seed the shared tmpDir with fresh FP docs;
    // this case needs FP down, so it reads from an isolated empty dir.
    const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-flixpatrol-fallback-"))
    process.env.POSTERIUM_DATA_DIR = isoDir
    try {
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        const u = String(url)
        if (u.includes("justwatch.com/graphql")) {
          return new Response(JSON.stringify({
            data: {
              streamingCharts: {
                edges: Array.from({ length: 10 }, (_, i) => ({
                  streamingChartInfo: { rank: i + 1 },
                  node: {
                    content: {
                      title: `JW Title ${i + 1}`,
                      externalIds: { tmdbId: 100 + i, imdbId: `tt0000${i + 1}` },
                    },
                  },
                })),
              },
            },
          }))
        }
        return new Response("not found", { status: 404 })
      }))

      const { getTop10 } = await import("@/lib/flixpatrol")
      const data = await getTop10("netflix", "italy", undefined, { enrich: false })
      expect(data.movies).toHaveLength(10)
      expect(data.tv).toHaveLength(10)
      expect(data.movies[0].title).toBe("JW Title 1")
      expect(data.movies[9].title).toBe("JW Title 10")
    } finally {
      fs.rmSync(isoDir, { recursive: true, force: true })
    }
  })
})
