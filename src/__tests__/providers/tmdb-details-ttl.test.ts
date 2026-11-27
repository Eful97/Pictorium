import { describe, expect, it } from "vitest"
import { detailsCacheTtlMs } from "@/lib/tmdb"

const DAY = 24 * 60 * 60 * 1000
const MIN5 = 5 * 60 * 1000
const NOW = new Date(2026, 10, 27, 12, 0, 0).getTime() // local noon
const day = (offset: number) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const endOfDay = (offset: number) => new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), new Date(NOW).getDate() + offset + 1).getTime()

describe("detailsCacheTtlMs", () => {
  it("old movie: 24h", () => {
    expect(detailsCacheTtlMs({ release_date: day(-400) }, "movie", NOW)).toBe(DAY)
  })

  it("movie released within 14 days or undated: short", () => {
    expect(detailsCacheTtlMs({ release_date: day(-3) }, "movie", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs({ release_date: day(-13) }, "movie", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs({ release_date: day(-15) }, "movie", NOW)).toBe(DAY)
    expect(detailsCacheTtlMs({ release_date: "" }, "movie", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs({}, "movie", NOW)).toBe(MIN5)
  })

  it("unreleased movie: until the release day starts, at most 24h", () => {
    const tomorrow = new Date(2026, 10, 28).getTime()
    expect(detailsCacheTtlMs({ release_date: day(1) }, "movie", NOW)).toBe(tomorrow - NOW)
    expect(detailsCacheTtlMs({ release_date: day(30) }, "movie", NOW)).toBe(DAY)
  })

  it("ended / quiet series: 24h", () => {
    expect(detailsCacheTtlMs({ first_air_date: day(-900), next_episode_to_air: null }, "tv", NOW)).toBe(DAY)
  })

  it("series with a next episode: valid through the end of that air day", () => {
    expect(detailsCacheTtlMs({ first_air_date: day(-900), next_episode_to_air: { air_date: day(0) } }, "tv", NOW)).toBe(endOfDay(0) - NOW)
    expect(detailsCacheTtlMs({ first_air_date: day(-900), next_episode_to_air: { air_date: day(10) } }, "tv", NOW)).toBe(DAY)
  })

  it("series whose next episode date already passed (TMDB lag): retry in 6h", () => {
    expect(detailsCacheTtlMs({ first_air_date: day(-900), next_episode_to_air: { air_date: day(-1) } }, "tv", NOW)).toBe(6 * 60 * 60 * 1000)
  })

  it("new or undated series: short; future premiere: until it", () => {
    expect(detailsCacheTtlMs({ first_air_date: day(-2) }, "tv", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs({}, "tv", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs({ first_air_date: day(1) }, "tv", NOW)).toBe(new Date(2026, 10, 28).getTime() - NOW)
  })

  it("never below one minute, invalid bodies stay short", () => {
    const almost = new Date(2026, 10, 27, 23, 59, 30).getTime()
    expect(detailsCacheTtlMs({ release_date: day(1) }, "movie", almost)).toBe(60_000)
    expect(detailsCacheTtlMs(null, "movie", NOW)).toBe(MIN5)
    expect(detailsCacheTtlMs("x", "tv", NOW)).toBe(MIN5)
  })
})
