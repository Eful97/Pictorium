import { describe, it, expect, vi, beforeEach } from "vitest"
import { getExternalIds } from "@/lib/tmdb"
import { __clearImdbCache, resolveWikidataId } from "@/lib/imdb-cache"

vi.mock("@/lib/tmdb", () => ({
  getExternalIds: vi.fn(),
}))

const mockedGetExternalIds = vi.mocked(getExternalIds)

describe("resolveWikidataId", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    __clearImdbCache()
  })

  it("returns the QID and memoizes it (one upstream call)", async () => {
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null, wikidata_id: "Q23577" })
    const first = await resolveWikidataId("tv", 1405, "key")
    const second = await resolveWikidataId("tv", 1405, "key")
    expect(first).toBe("Q23577")
    expect(second).toBe("Q23577")
    expect(mockedGetExternalIds).toHaveBeenCalledTimes(1)
  })

  it("discards garbage QIDs (null = SPARQL fallback)", async () => {
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null, wikidata_id: "nope" })
    expect(await resolveWikidataId("movie", 550, "key")).toBeNull()
  })

  it("returns null when TMDB has no link", async () => {
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt0137523", wikidata_id: null })
    expect(await resolveWikidataId("movie", 551, "key")).toBeNull()
  })

  it("returns null on upstream failure without throwing", async () => {
    mockedGetExternalIds.mockRejectedValue(new Error("boom"))
    expect(await resolveWikidataId("tv", 1406, "key")).toBeNull()
  })
})
