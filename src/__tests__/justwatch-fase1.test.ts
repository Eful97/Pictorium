import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import { getJWRankings, resolveJWGenreCode, __resetJWRankingsCache } from "@/lib/justwatch"

function streamingChartResponse(
  edges: Array<{ tmdbId: number; rank: number; date?: string | null }>,
): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: edges.map((e) => ({
          streamingChartInfo: { rank: e.rank },
          node: {
            content: {
              title: `Film ${e.tmdbId}`,
              ...(e.date !== undefined ? { originalReleaseDate: e.date } : {}),
              externalIds: { tmdbId: e.tmdbId, imdbId: `tt${e.tmdbId}` },
            },
          },
        })),
      },
    },
  })
}

describe("JustWatch Fase 1 (unreleased, doppio-decode, breaker)", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetJWRankingsCache()
  })

  it("resolveJWGenreCode gestisce il doppio-encoding Stremio (%2520)", () => {
    expect(resolveJWGenreCode("Science%20Fiction")).toBe("scf")
    expect(resolveJWGenreCode("Fantascienza")).toBe("scf")
    expect(resolveJWGenreCode("Science Fiction")).toBe("scf")
    expect(resolveJWGenreCode("Acci%C3%B3n")).toBe("act")
    expect(resolveJWGenreCode("Accion")).toBe("act")
    expect(resolveJWGenreCode("Comédie")).toBe("cmy")
    expect(resolveJWGenreCode("Comedie")).toBe("cmy")
    expect(resolveJWGenreCode("Ação")).toBe("act")
    expect(resolveJWGenreCode("Acao")).toBe("act")
    expect(resolveJWGenreCode("Animación")).toBe("ani")
    expect(resolveJWGenreCode("Animacion")).toBe("ani")
    expect(resolveJWGenreCode("Terror")).toBe("hrr")
    expect(resolveJWGenreCode("Histoire")).toBe("hst")
    expect(resolveJWGenreCode("Deporte")).toBe("spt")
    expect(resolveJWGenreCode("Faroeste")).toBe("wsn")
    expect(resolveJWGenreCode("Guerre")).toBe("war")
  })

  it("resolveJWGenreCode non altera nomi genuini e degrada su input malformati", () => {
    expect(resolveJWGenreCode("Dramma")).toBe("drm")
    expect(resolveJWGenreCode("Tutti")).toBeNull()
    expect(resolveJWGenreCode("GenereInesistente")).toBeNull()
    expect(resolveJWGenreCode("%E0%A4%A")).toBeNull()
    expect(resolveJWGenreCode(null)).toBeNull()
  })

  it("getJWRankings scarta i titoli con releaseDate futura, tiene gli altri", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      streamingChartResponse([
        { tmdbId: 11, rank: 1, date: "2020-01-01" },
        { tmdbId: 22, rank: 2, date: "2999-05-05" },
        { tmdbId: 33, rank: 3 },
      ]),
    )

    const rows = await getJWRankings("MOVIE", "IT", 10)
    expect(rows.map((r) => r.tmdbId)).toEqual([11, 33])
  })

  it("il breaker apre dopo 5 fallimenti non-403 (non prima)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("err", { status: 500 }))

    for (let i = 0; i < 4; i++) {
      await expect(getJWRankings("MOVIE", "IT", 1)).rejects.toThrow("JustWatch MOVIE failed: 500")
    }
    expect(fetchSpy).toHaveBeenCalledTimes(4)

    // 5° fallimento: ancora rete (il circuito apre DOPO averlo contato)
    await expect(getJWRankings("MOVIE", "IT", 1)).rejects.toThrow("JustWatch MOVIE failed: 500")
    expect(fetchSpy).toHaveBeenCalledTimes(5)

    // 6°: fail-fast senza toccare la rete
    const fastFail = await getJWRankings("SHOW", "US", 1)
    expect(fastFail).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(5)
  })
})
