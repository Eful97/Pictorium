import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearTMDBCache, getDetailsWithExternalIds } from "@/lib/tmdb"

describe("getDetailsWithExternalIds (D4)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
  })

  it("fetches details + external_ids in a single request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        id: 550,
        title: "Fight Club",
        genres: [{ id: 18, name: "Drama" }],
        vote_average: 8.4,
        vote_count: 100,
        external_ids: { imdb_id: "tt0137523" },
      }),
    )

    const d = await getDetailsWithExternalIds("movie", 550, "it-IT", "test-key")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain("append_to_response=external_ids")
    expect(d.title).toBe("Fight Club")
    expect(d.external_ids?.imdb_id).toBe("tt0137523")
  })
})
