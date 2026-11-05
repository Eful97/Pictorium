import { describe, expect, it } from "vitest"
import { computeVote } from "@/lib/rating-weights"
import { calculateAverageRating } from "@/lib/ratings"
import type { AggregatedRatings } from "@/lib/ratings"

const sample: AggregatedRatings = {
  sources: { imdb: 8.0, tmdb: 7.0, letterboxd: 8.0, tomatoes: 6.0, trakt: 9.0 },
  average: 0,
  count: 5,
}

describe("computeVote (sempre media pari, nessun preset)", () => {
  it("equivale al legacy su default IMDb-only", () => {
    expect(computeVote(sample)).toBe(calculateAverageRating(sample))
    expect(computeVote(sample, ["imdb", "tomatoes"])).toBe(
      calculateAverageRating(sample, ["imdb", "tomatoes"]),
    )
  })

  it("rsrc filtra le fonti; intersezione vuota → null", () => {
    expect(computeVote(sample, ["imdb"])).toBe(8.0)
    expect(computeVote(sample, ["letterboxd"])).toBe(8.0)
    expect(computeVote(sample, ["metacritic"])).toBeNull()
  })

  it("ignora valori non numerici o non positivi", () => {
    const dirty = { sources: { imdb: 0, tmdb: NaN, letterboxd: 7.5 }, average: 0, count: 3 }
    expect(computeVote(dirty, ["imdb", "tmdb", "letterboxd"])).toBe(7.5)
    expect(computeVote(dirty)).toBeNull() // nel default IMDb resta solo spazzatura
  })

  it("null quando non c'è proprio niente", () => {
    expect(computeVote(null)).toBeNull()
    expect(computeVote({ sources: {}, average: 0, count: 0 })).toBeNull()
    expect(computeVote(sample, [])).toBe(calculateAverageRating(sample))
  })
})
