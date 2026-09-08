import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import { getJWRankings, getJWTitleQuality, __resetJWRankingsCache } from "@/lib/justwatch"

describe("JustWatch resilience & anti-bot", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sends realistic browser headers including Chrome UA and Referer", async () => {
    let capturedHeaders: Record<string, string> | undefined

    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(
        JSON.stringify({
          data: {
            streamingCharts: {
              edges: [
                {
                  streamingChartInfo: { rank: 1 },
                  node: { content: { externalIds: { tmdbId: 100, imdbId: "tt100" }, title: "Film A" } },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    })

    const results = await getJWRankings("MOVIE", "IT", 1)
    expect(results).toHaveLength(1)
    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders!["User-Agent"]).toContain("Chrome/")
    expect(capturedHeaders!["Origin"]).toBe("https://www.justwatch.com")
    expect(capturedHeaders!["Referer"]).toBe("https://www.justwatch.com/")
    expect(capturedHeaders!["X-Platform"]).toBe("WEB")
    expect(capturedHeaders!["sec-ch-ua"]).toBeDefined()
  })

  it("captures DataDome cookie from response and includes it in subsequent requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    // Prima chiamata: JustWatch restituisce Set-Cookie con datadome token
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            streamingCharts: {
              edges: [
                {
                  streamingChartInfo: { rank: 1 },
                  node: { content: { externalIds: { tmdbId: 101, imdbId: "tt101" }, title: "Film 1" } },
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "datadome=test_token_xyz123; Path=/; Domain=.justwatch.com; Secure",
          },
        }
      )
    )

    // Seconda chiamata: deve includere Cookie: datadome=test_token_xyz123
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            streamingCharts: {
              edges: [
                {
                  streamingChartInfo: { rank: 1 },
                  node: { content: { externalIds: { tmdbId: 102, imdbId: "tt102" }, title: "Film 2" } },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )

    await getJWRankings("MOVIE", "IT", 1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Eseguiamo la seconda con parametri diversi per evitare cache in-memory
    await getJWRankings("SHOW", "IT", 1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    const secondCallHeaders = fetchSpy.mock.calls[1][1]?.headers as Record<string, string>
    expect(secondCallHeaders["Cookie"]).toBe("datadome=test_token_xyz123")
  })

  it("opens circuit breaker on 403 (DataDome block) and fails fast without touching network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden - DataDome", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      })
    )

    // La prima chiamata riceve 403
    await expect(getJWRankings("MOVIE", "IT", 1)).rejects.toThrow("JustWatch MOVIE failed: 403")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Le chiamate successive per parametri diversi devono ritornare immediatamente vuoto / null (0ms)
    const fastFailRankings = await getJWRankings("SHOW", "US", 1)
    expect(fastFailRankings).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1) // Network NON toccata!

    const fastFailQuality = await getJWTitleQuality(12345, "MOVIE", "Test Title", "IT")
    expect(fastFailQuality).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1) // Ancora nessuna chiamata di rete!

    // Il reset della cache ripristina il circuit breaker
    __resetJWRankingsCache()
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            streamingCharts: { edges: [] },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )

    const recovered = await getJWRankings("SHOW", "US", 1)
    expect(recovered).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(2) // La rete viene richiamata dopo il reset
  })

  it("serves partial usable data even when GraphQL returns field errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "Field resolver failed for an externalId", path: ["streamingCharts"] }],
          data: {
            streamingCharts: {
              edges: [
                {
                  streamingChartInfo: { rank: 1 },
                  node: { content: { externalIds: { tmdbId: 201, imdbId: "tt201" }, title: "Film Survivor" } },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )

    const results = await getJWRankings("MOVIE", "IT", 1)
    expect(results).toHaveLength(1)
    expect(results[0].tmdbId).toBe(201)
    expect(results[0].title).toBe("Film Survivor")
  })
})
