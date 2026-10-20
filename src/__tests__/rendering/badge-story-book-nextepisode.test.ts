import { afterEach, describe, expect, it, vi } from "vitest"
import { computeBadge, getAllBadgeOptions, NEXT_EPISODE_BADGE_KEY } from "@/lib/badge-priority"
import {
  computeTopBadge,
  getBasedOnBookLabel,
  getFewEpisodesLabel,
  getNextEpisodeLabel,
  getTrueStoryLabel,
  isNextEpisodeDisplayed,
  parseStrictTmdbDate,
  resolveManualNextEpisodeLabel,
  resolveSavedBadgeExtra,
} from "@/lib/poster-badge"
import { createT } from "@/lib/i18n"

const t = createT("it")
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const baseInput = {
  mediaType: "tv" as const,
  releaseDate: null,
  firstAirDate: daysAgo(400),
  lastAirDate: null as string | null,
  seasonCount: null as number | null,
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

afterEach(() => {
  vi.useRealTimers()
})

describe("getTrueStoryLabel (exact TMDB keyword)", () => {
  it("matches the two canonical keywords, case-insensitive", () => {
    expect(getTrueStoryLabel(["based on true story"], t)).toBe("Tratto da una storia vera")
    expect(getTrueStoryLabel(["Based on a True Story"], t)).toBe("Tratto da una storia vera")
    expect(getTrueStoryLabel(["other", "  based on a true story  "], t)).toBe("Tratto da una storia vera")
  })

  it("rejects substrings, plurals and title text", () => {
    expect(getTrueStoryLabel(["true story"], t)).toBeNull()
    expect(getTrueStoryLabel(["based on true stories"], t)).toBeNull()
    expect(getTrueStoryLabel(["a true story of survival"], t)).toBeNull()
    expect(getTrueStoryLabel([], t)).toBeNull()
  })
})

describe("getBasedOnBookLabel (exact TMDB keyword)", () => {
  it("matches the four canonical keywords, case-insensitive", () => {
    expect(getBasedOnBookLabel(["based on novel"], t)).toBe("Tratto da un libro")
    expect(getBasedOnBookLabel(["Based on Novel or Book"], t)).toBe("Tratto da un libro")
    expect(getBasedOnBookLabel(["based on book"], t)).toBe("Tratto da un libro")
    expect(getBasedOnBookLabel(["based on young adult novel"], t)).toBe("Tratto da un libro")
  })

  it("rejects substrings and non-listed keywords", () => {
    expect(getBasedOnBookLabel(["book"], t)).toBeNull()
    expect(getBasedOnBookLabel(["based on book series"], t)).toBeNull()
    expect(getBasedOnBookLabel(["based on comic book"], t)).toBeNull()
    expect(getBasedOnBookLabel([], t)).toBeNull()
  })
})

describe("parseStrictTmdbDate (exact YYYY-MM-DD, real calendar)", () => {
  it("accepts a real date and round-trips it", () => {
    const d = parseStrictTmdbDate("2026-10-23")
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(9)
    expect(d!.getDate()).toBe(23)
  })

  it("rejects overflow, month 13, non-padded parts and trailing junk", () => {
    expect(parseStrictTmdbDate("2026-10-32")).toBeNull()
    expect(parseStrictTmdbDate("2026-02-30")).toBeNull()
    expect(parseStrictTmdbDate("2026-13-01")).toBeNull()
    expect(parseStrictTmdbDate("2026-00-10")).toBeNull()
    expect(parseStrictTmdbDate("2026-1-01")).toBeNull()
    expect(parseStrictTmdbDate("2026-01-1")).toBeNull()
    expect(parseStrictTmdbDate("2026-01-01T00:00:00")).toBeNull()
    expect(parseStrictTmdbDate("2026-01-01 ")).toBeNull()
    expect(parseStrictTmdbDate("not-a-date")).toBeNull()
    expect(parseStrictTmdbDate(null)).toBeNull()
  })

  it("enforces the real leap calendar", () => {
    expect(parseStrictTmdbDate("2024-02-29")).not.toBeNull()
    expect(parseStrictTmdbDate("2023-02-29")).toBeNull()
    expect(parseStrictTmdbDate("2025-02-29")).toBeNull()
  })
})

describe("getNextEpisodeLabel (strict dates, calendar 1..14 days, tv only)", () => {
  it("labels a next episode within the window with its date", () => {
    const label = getNextEpisodeLabel({ mediaType: "tv", airDate: inDays(3), locale: "it", t })
    expect(label).toMatch(/^Nuovo episodio /)
  })

  it("accepts day 1 and day 14, rejects today/past/day 15", () => {
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: inDays(1), locale: "it", t })).toMatch(/^Nuovo episodio /)
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: inDays(14), locale: "it", t })).toMatch(/^Nuovo episodio /)
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: daysAgo(0), locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: daysAgo(2), locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: inDays(15), locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: null, locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "not-a-date", locale: "it", t })).toBeNull()
  })

  it("rejects rolled-over invalid dates that the loose parser used to accept", () => {
    // Loose `new Date(2026, 9, 32)` rolls to Nov 1 and could look eligible.
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-10-32", locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-02-30", locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-13-01", locale: "it", t })).toBeNull()
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: inDays(3).slice(0, 7) + "  ", locale: "it", t })).toBeNull()
  })

  it("holds day 14 across a DST switch (UTC calendar days, fake clock)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-20T12:00:00"))
    // Europe/Rome falls back on 2026-10-25: +14 calendar days still counts.
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-11-03", locale: "it", t })).toMatch(/^Nuovo episodio /)
    expect(getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-11-04", locale: "it", t })).toBeNull()
  })

  it("never fires for movies", () => {
    expect(getNextEpisodeLabel({ mediaType: "movie", airDate: inDays(3), locale: "it", t })).toBeNull()
  })
})

describe("getFewEpisodesLabel (miniseries 1..8 only)", () => {
  it("enriches an eligible miniseries with the count", () => {
    expect(getFewEpisodesLabel({ tvType: "Miniseries", episodeCount: 6, t })).toBe("Solo 6 episodi")
    expect(getFewEpisodesLabel({ tvType: "miniserie", episodeCount: 1, t })).toBe("Solo 1 episodi")
    expect(getFewEpisodesLabel({ tvType: "Miniseries", episodeCount: 8, t })).toBe("Solo 8 episodi")
  })

  it("keeps the plain Miniseries when count is missing or out of bounds", () => {
    expect(getFewEpisodesLabel({ tvType: "Miniseries", episodeCount: null, t })).toBeNull()
    expect(getFewEpisodesLabel({ tvType: "Miniseries", episodeCount: 0, t })).toBeNull()
    expect(getFewEpisodesLabel({ tvType: "Miniseries", episodeCount: 9, t })).toBeNull()
    expect(getFewEpisodesLabel({ tvType: "Series", episodeCount: 6, t })).toBeNull()
    expect(getFewEpisodesLabel({ tvType: null, episodeCount: 6, t })).toBeNull()
  })
})

describe("computeTopBadge (story/book/next-episode/few-episodes)", () => {
  it("auto true-story below awards, above plain extra", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(30), keywords: ["based on a true story"] }, t, "it")
    expect(c.trueStory).toBe("Tratto da una storia vera")
    expect(c.badge).toEqual({ type: "extra", label: "Tratto da una storia vera" })
    const awarded = computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(30), keywords: ["based on a true story"], awards: ["Emmy"] }, t, "it")
    expect(awarded.badge?.label).toBe("Emmy")
  })

  it("offers both story and book labels when both apply, deterministic fallback", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(30), keywords: ["based on true story", "based on novel"] }, t, "it")
    expect(c.trueStory).toBe("Tratto da una storia vera")
    expect(c.basedOnBook).toBe("Tratto da un libro")
    // Deterministic: story precedes book in the extra bucket.
    expect(c.badge).toEqual({ type: "extra", label: "Tratto da una storia vera" })
  })

  it("next episode sits below new season, above awards", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: null, nextEpisodeAirDate: inDays(3) }, t, "it")
    expect(c.nextEpisode).toMatch(/^Nuovo episodio /)
    expect(c.badge).toEqual({ type: "extra", label: c.nextEpisode })
    const withSeason = computeTopBadge({ ...baseInput, tvStatus: null, lastAirDate: daysAgo(3), seasonCount: 2, firstAirDate: daysAgo(400), nextEpisodeAirDate: inDays(3) }, t, "it")
    expect(withSeason.badge?.label).toBe(withSeason.newSeason)
    // The `new` bucket precedes `award`: like a new season, the next
    // episode beats an award.
    const awarded = computeTopBadge({ ...baseInput, tvStatus: null, nextEpisodeAirDate: inDays(3), awards: ["Emmy"] }, t, "it")
    expect(awarded.badge?.label).toBe(awarded.nextEpisode)
  })

  it("only-episodes enriches an eligible miniseries, plain otherwise", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: null, tvType: "Miniseries", numberOfEpisodes: 6 }, t, "it")
    expect(c.badge).toEqual({ type: "extra", label: "Solo 6 episodi" })
    const plain = computeTopBadge({ ...baseInput, tvStatus: null, tvType: "Miniseries", numberOfEpisodes: null }, t, "it")
    expect(plain.badge).toEqual({ type: "extra", label: "Miniserie" })
    const ordinary = computeTopBadge({ ...baseInput, tvStatus: null, tvType: "Series", numberOfEpisodes: 6 }, t, "it")
    expect(ordinary.badge?.label).not.toBe("Solo 6 episodi")
  })

  it("sash buckets still gate the new badges (no blanket priority rewrite)", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: null, nextEpisodeAirDate: inDays(3) }, t, "it", ["upcoming", "rank", "award", "extra"])
    expect(c.nextEpisode).toMatch(/^Nuovo episodio /)
    expect(c.badge).toBeNull()
    const d = computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(30), keywords: ["based on novel"] }, t, "it", ["upcoming", "rank", "new", "award"])
    expect(d.basedOnBook).toBe("Tratto da un libro")
    expect(d.badge).toBeNull()
  })
})

describe("getAllBadgeOptions (token identity for next episode)", () => {
  const optsBase = {
    upcomingRelease: null,
    isNewMovie: false,
    isNewSeries: false,
    animeRank: null,
    trendRank: null,
    award: null,
    nomination: null,
    studio: null,
    director: null,
    extra: null,
    mediaType: "tv" as const,
    voteAverage: 8,
    tvType: null as string | null,
    tvStatus: null as string | null,
  }
  it("emits the stable token (never dated text) for an eligible next episode", () => {
    const next = getAllBadgeOptions({ ...optsBase, nextEpisode: "Nuovo episodio · 23.10.26" })
    expect(next).toContain(NEXT_EPISODE_BADGE_KEY)
    expect(next).not.toContain("Nuovo episodio · 23.10.26")
    const story = getAllBadgeOptions({ ...optsBase, trueStory: "Tratto da una storia vera", basedOnBook: "Tratto da un libro" })
    expect(story).toContain("Tratto da una storia vera")
    expect(story).toContain("Tratto da un libro")
    const few = getAllBadgeOptions({ ...optsBase, tvType: "Miniseries", fewEpisodes: "Solo 6 episodi" })
    expect(few).toContain("Solo 6 episodi")
    expect(few).not.toContain("badge.miniseries")
  })
})

describe("canonical manual next-episode identity", () => {
  it("resolves the token to the current label, nothing when elapsed", () => {
    const label = resolveManualNextEpisodeLabel(NEXT_EPISODE_BADGE_KEY, { mediaType: "tv", airDate: inDays(3), locale: "it", t })
    expect(label).toMatch(/^Nuovo episodio /)
    expect(resolveManualNextEpisodeLabel(NEXT_EPISODE_BADGE_KEY, { mediaType: "tv", airDate: daysAgo(2), locale: "it", t })).toBeNull()
    expect(resolveManualNextEpisodeLabel(NEXT_EPISODE_BADGE_KEY, { mediaType: "movie", airDate: inDays(3), locale: "it", t })).toBeNull()
  })

  it("never reinterprets free text, even when it looks like a next-episode badge", () => {
    expect(resolveManualNextEpisodeLabel("Nuovo episodio · 23.10.26", { mediaType: "tv", airDate: inDays(3), locale: "it", t })).toBeNull()
    expect(resolveManualNextEpisodeLabel("My custom badge", { mediaType: "tv", airDate: inDays(3), locale: "it", t })).toBeNull()
    expect(resolveManualNextEpisodeLabel(null, { mediaType: "tv", airDate: inDays(3), locale: "it", t })).toBeNull()
  })
})

describe("computeBadge priority (new badges below news/ranks/awards)", () => {
  const base = {
    mediaType: "tv" as const,
    upcomingRelease: null,
    isNewMovie: false, isNewSeries: false,
    animeRank: null, trendRank: null,
    award: null, nomination: null,
    studio: null, director: null, extra: null,
  }
  it("new season beats next episode; rank beats story", () => {
    expect(computeBadge({ ...base, newSeason: "Nuova S2", nextEpisode: "Nuovo episodio · 23.10.26" }, t)?.label).toBe("Nuova S2")
    expect(computeBadge({ ...base, trendRank: 3, trueStory: "Tratto da una storia vera" }, t)?.label).toBe("Oggi")
  })
})

describe("resolveSavedBadgeExtra (next-episode never frozen)", () => {
  it("never freezes the dated next-episode label", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Nuovo episodio · 23.10.26" }, upcomingRelease: null, newSeason: null, nextEpisode: "Nuovo episodio · 23.10.26" }, t)).toBeUndefined()
  })

  it("freezes story/book/few-episodes like other permanent labels", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Tratto da una storia vera" }, upcomingRelease: null, newSeason: null }, t)).toBe("Tratto da una storia vera")
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Tratto da un libro" }, upcomingRelease: null, newSeason: null }, t)).toBe("Tratto da un libro")
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Solo 6 episodi" }, upcomingRelease: null, newSeason: null }, t)).toBe("Solo 6 episodi")
  })
})

describe("isNextEpisodeDisplayed (effective badge, shared selection)", () => {
  const badgeBase = { ...baseInput, tvStatus: null as string | null }
  it("is true for the displayed auto badge", () => {
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: null, badgeInput: { ...badgeBase, nextEpisodeAirDate: inDays(3) },
      locale: "it", t,
    })).toBe(true)
  })

  it("is false when rank, manual text, or a disabled sash bucket wins", () => {
    // Rank override wins over auto next.
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: null,
      badgeInput: { ...badgeBase, nextEpisodeAirDate: inDays(3), trendRank: 2 },
      locale: "it", t,
    })).toBe(false)
    // Manual free text wins over auto next.
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: "My premiere",
      badgeInput: { ...badgeBase, nextEpisodeAirDate: inDays(3) },
      locale: "it", t,
    })).toBe(false)
    // Disabled `new` bucket hides the auto next badge.
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: null,
      badgeInput: { ...badgeBase, nextEpisodeAirDate: inDays(3) },
      locale: "it", sashOrder: ["upcoming", "rank", "award", "extra"], t,
    })).toBe(false)
  })

  it("follows the canonical manual identity (shown when eligible, gone when elapsed)", () => {
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: NEXT_EPISODE_BADGE_KEY,
      badgeInput: { ...badgeBase, nextEpisodeAirDate: inDays(3) },
      locale: "it", t,
    })).toBe(true)
    expect(isNextEpisodeDisplayed({
      mediaType: "tv", rankingEnabled: true, queryExtra: NEXT_EPISODE_BADGE_KEY,
      badgeInput: { ...badgeBase, nextEpisodeAirDate: daysAgo(2) },
      locale: "it", t,
    })).toBe(false)
  })
})
