// @vitest-environment node
/**
 * TMDB → IMDb episode numbering for the ShowGrid ★ (thumbnail S:E is TMDB).
 * Lupin (tt2531336): TMDB 10/7/8, IMDb 5/5/7/8 — a direct lookup read Part 2's
 * scores for TMDB season 2 and fell back to TMDB for 1:6-10.
 */
import { describe, expect, it } from "vitest"
import { mapTmdbEpisodeToImdb } from "@/lib/episode-ratings-provider"

function keys(split: number[]): string[] {
  return split.flatMap((count, i) => Array.from({ length: count }, (_, e) => `${i + 1}:${e + 1}`))
}
const counts = (split: number[]) => new Map(split.map((c, i) => [i + 1, c]))

describe("mapTmdbEpisodeToImdb", () => {
  const lupinImdb = keys([5, 5, 7, 8])
  const lupinTmdb = counts([10, 7, 8])

  it("maps Lupin TMDB seasons onto the IMDb parts by absolute episode", () => {
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb, 1, 5)).toEqual({ season: 1, episode: 5 })
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb, 1, 6)).toEqual({ season: 2, episode: 1 })
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb, 2, 1)).toEqual({ season: 3, episode: 1 })
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb, 3, 8)).toEqual({ season: 4, episode: 8 })
  })

  it("keeps the direct pair when the structures match (last IMDb season may be short)", () => {
    expect(mapTmdbEpisodeToImdb(counts([7, 13]), keys([7, 10]), 2, 3)).toEqual({ season: 2, episode: 3 })
    expect(mapTmdbEpisodeToImdb(counts([7, 13]), keys([7, 10]), 2, 12)).toEqual({ season: 2, episode: 12 })
  })

  it("keeps the direct pair without a TMDB structure or for specials", () => {
    expect(mapTmdbEpisodeToImdb(null, lupinImdb, 2, 1)).toEqual({ season: 2, episode: 1 })
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb, 0, 1)).toEqual({ season: 0, episode: 1 })
  })

  it("fails closed when the split cannot be mapped safely", () => {
    // IMDb has more episodes than TMDB: different split, no safe translation.
    expect(mapTmdbEpisodeToImdb(counts([10]), keys([6, 6]), 1, 3)).toBeNull()
    // Gap inside an IMDb season (unrated mid-season episode) on a misaligned split.
    expect(mapTmdbEpisodeToImdb(lupinTmdb, lupinImdb.filter((k) => k !== "2:3"), 1, 9)).toBeNull()
  })
})
