import { describe, expect, it } from "vitest"
import {
  computeTopBadge,
  getReturningSeasonLabel,
  resolveReturningSeason,
  resolveSavedBadgeExtra,
} from "@/lib/poster-badge"
import { resolvePosterFactCapMs } from "@/lib/poster-freshness"
import { createT } from "@/lib/i18n"

const t = createT("it")
// LOCAL calendar dates, like the label itself (toISOString() is UTC and flakes at the day bounds).
const inDays = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const premiere = (days: number, over: Record<string, unknown> = {}) => ({
  tvStatus: "Returning Series",
  airDate: inDays(days),
  season: 3,
  episode: 1,
  ...over,
})

describe("resolveReturningSeason", () => {
  it("accepts a season premiere beyond the 14-day next-episode window", () => {
    const r = resolveReturningSeason(premiere(40))
    expect(r?.season).toBe(3)
    expect(r?.takeoverDate).toBe(inDays(26))
  })

  it("rejects the next-episode window, today, the past and far placeholders", () => {
    expect(resolveReturningSeason(premiere(14))).toBeNull()
    expect(resolveReturningSeason(premiere(15))).not.toBeNull()
    expect(resolveReturningSeason(premiere(0))).toBeNull()
    expect(resolveReturningSeason(premiere(-3))).toBeNull()
    expect(resolveReturningSeason(premiere(366))).not.toBeNull()
    expect(resolveReturningSeason(premiere(367))).toBeNull()
  })

  it("needs episode 1 of season >= 2 and a returning status", () => {
    expect(resolveReturningSeason(premiere(40, { episode: 2 }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { season: 1 }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { season: null }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { episode: null }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { tvStatus: "Ended" }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { tvStatus: null }))).toBeNull()
    expect(resolveReturningSeason(premiere(40, { airDate: "2026-02-30" }))).toBeNull()
  })
})

describe("getReturningSeasonLabel", () => {
  it("renders S{n} and the date", () => {
    const label = getReturningSeasonLabel({ ...premiere(40), locale: "it", t })
    expect(label).toMatch(/^S3 · /)
  })

  it("is null outside the rule", () => {
    expect(getReturningSeasonLabel({ ...premiere(5), t })).toBeNull()
  })
})

describe("computeTopBadge: returning label", () => {
  const base = {
    mediaType: "tv" as const,
    releaseDate: null,
    firstAirDate: inDays(-800),
    lastAirDate: inDays(-200),
    seasonCount: 2,
    originCountries: [] as string[],
    voteAverage: 8,
    trendRank: null,
    animeRank: null,
    awards: [] as string[],
    nominations: [] as string[],
    studios: [] as string[],
    director: null,
    tvType: null,
    tvStatus: "Returning Series",
    keywords: [] as string[],
    imdbTop250: false,
  }

  it("a dated premiere replaces the undated Returning label", () => {
    const c = computeTopBadge({ ...base, nextEpisodeAirDate: inDays(40), nextEpisodeSeason: 3, nextEpisodeNumber: 1 }, t, "it")
    expect(c.returningSeason).toMatch(/^S3 · /)
    expect(c.badge?.label).toBe(c.returningSeason)
  })

  it("without episode numbers it stays plain Returning", () => {
    const c = computeTopBadge({ ...base, nextEpisodeAirDate: inDays(40) }, t, "it")
    expect(c.returningSeason).toBeNull()
    expect(c.badge?.label).toBe(t("badge.returning"))
  })

  it("inside 14 days the New episode label wins and no dated returning is built", () => {
    const c = computeTopBadge({ ...base, nextEpisodeAirDate: inDays(10), nextEpisodeSeason: 3, nextEpisodeNumber: 1 }, t, "it")
    expect(c.returningSeason).toBeNull()
    expect(c.nextEpisode).not.toBeNull()
    expect(c.badge?.label).toBe(c.nextEpisode)
  })

  it("TMDB lag (date already passed) falls back to plain Returning", () => {
    const c = computeTopBadge({ ...base, nextEpisodeAirDate: inDays(-1), nextEpisodeSeason: 3, nextEpisodeNumber: 1 }, t, "it")
    expect(c.returningSeason).toBeNull()
    expect(c.badge?.label).toBe(t("badge.returning"))
  })

  it("an ended series never gets it", () => {
    const c = computeTopBadge({ ...base, tvStatus: "Ended", nextEpisodeAirDate: inDays(40), nextEpisodeSeason: 3, nextEpisodeNumber: 1 }, t, "it")
    expect(c.returningSeason).toBeNull()
  })

  it("is never frozen into a saved mapping", () => {
    const c = computeTopBadge({ ...base, nextEpisodeAirDate: inDays(40), nextEpisodeSeason: 3, nextEpisodeNumber: 1 }, t, "it")
    expect(resolveSavedBadgeExtra(c, t)).toBeUndefined()
  })
})

describe("poster fact cap for the dated returning label", () => {
  it("expires at the local midnight where the next-episode badge takes over", () => {
    const r = resolveReturningSeason(premiere(15))!
    const now = Date.now()
    const cap = resolvePosterFactCapMs({ returningTakeoverDate: r.takeoverDate, nowMs: now })
    const [y, m, d] = r.takeoverDate.split("-").map(Number)
    expect(cap).toBe(new Date(y, m - 1, d).getTime() - now)
  })

  it("no cap without the label or once the takeover date has passed", () => {
    expect(resolvePosterFactCapMs({ returningTakeoverDate: null })).toBeNull()
    expect(resolvePosterFactCapMs({ returningTakeoverDate: inDays(-1) })).toBeNull()
  })
})
