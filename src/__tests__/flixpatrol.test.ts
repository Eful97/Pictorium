import { describe, expect, it, vi, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-flixpatrol-test-"))

function makeCatalog(prefix: string): unknown {
  return {
    charts: [
      {
        catalog_id: "netflix",
        platform: "Netflix",
        category: "movies",
        entries: [
          { rank: 1, title: `${prefix} Movie`, tmdb: { id: 1, media_type: "movie", release_date: "2024-01-01" } },
        ],
      },
      {
        catalog_id: "netflix",
        platform: "Netflix",
        category: "tv shows",
        entries: [
          { rank: 1, title: `${prefix} Show`, tmdb: { id: 2, media_type: "tv", release_date: "2024-02-01" } },
        ],
      },
    ],
  }
}

describe("flixpatrol country support (D7)", () => {
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

  it("uses JustWatch as primary source returning full 10 movies and 10 shows", async () => {
    vi.resetModules()
    process.env.POSTERIUM_DATA_DIR = tmpDir
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
  })
})
