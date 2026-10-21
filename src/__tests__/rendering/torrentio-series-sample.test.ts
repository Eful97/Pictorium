import { describe, expect, it } from "vitest"
import {
  SERIES_ALLOWED_ADDED,
  SERIES_IDS,
  isStrictCalendarDate,
  isUnambiguousSeriesFind,
  parseSeriesArgs,
  sanitizeSeriesProvenanceEntry,
  selectMedianAiredEpisode,
  seriesAdditiveDelta,
} from "../../../scripts/torrentio-series-sample.mjs"

describe("torrentio-series-sample scope pins (exactly 2 confirmed series)", () => {
  it("binds exactly the 2 authorized series ids", () => {
    expect(SERIES_IDS).toEqual(["tt11198330", "tt10466872"])
  })

  it("series delta allowlist is dv/hdr10plus/atmos only (no generic hdr, no imax)", () => {
    expect([...SERIES_ALLOWED_ADDED].sort()).toEqual(["atmos", "dv", "hdr10plus"])
  })

  it("defaults to dry-run and rejects unknown/duplicate/low-spacing flags", () => {
    const parsed = parseSeriesArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected ok")
    expect(parsed.args.live).toBe(false)
    expect(parseSeriesArgs(["--bogus"]).ok).toBe(false)
    expect(parseSeriesArgs(["--live", "--live"]).ok).toBe(false)
    expect(parseSeriesArgs(["--spacing-ms", "250"]).ok).toBe(false)
    expect(parseSeriesArgs(["--torrentio-base", "http://x"]).ok).toBe(false)
  })
})

describe("selectMedianAiredEpisode (lower median over regular aired episodes)", () => {
  it("returns null for empty input", () => {
    expect(selectMedianAiredEpisode([], "2026-10-21")).toBeNull()
  })

  it("excludes specials, future, absent, and invalid dates", () => {
    const episodes = [
      { season_number: 0, episode_number: 1, air_date: "2020-01-01" },
      { season_number: 1, episode_number: 1, air_date: "2020-01-10" },
      { season_number: 1, episode_number: 2, air_date: "2030-01-01" },
      { season_number: 1, episode_number: 3, air_date: "" },
      { season_number: 1, episode_number: 4, air_date: "not-a-date" },
      { season_number: 1, episode_number: 5, air_date: "2020-01-12" },
    ]
    expect(selectMedianAiredEpisode(episodes, "2026-10-21")).toEqual({
      season: 1,
      episode: 1,
      airDate: "2020-01-10",
    })
  })

  it("picks the exact middle for odd counts (sorted by season then episode)", () => {
    const episodes = [
      { season_number: 2, episode_number: 1, air_date: "2021-03-01" },
      { season_number: 1, episode_number: 2, air_date: "2021-01-02" },
      { season_number: 1, episode_number: 1, air_date: "2021-01-01" },
    ]
    expect(selectMedianAiredEpisode(episodes, "2026-10-21")).toEqual({
      season: 1,
      episode: 2,
      airDate: "2021-01-02",
    })
  })

  it("picks the lower median for even counts (floor((n-1)/2))", () => {
    const episodes = [
      { season_number: 1, episode_number: 1, air_date: "2021-01-01" },
      { season_number: 1, episode_number: 2, air_date: "2021-01-02" },
      { season_number: 1, episode_number: 3, air_date: "2021-01-03" },
      { season_number: 1, episode_number: 4, air_date: "2021-01-04" },
    ]
    expect(selectMedianAiredEpisode(episodes, "2026-10-21")).toEqual({
      season: 1,
      episode: 2,
      airDate: "2021-01-02",
    })
  })

  it("treats an episode airing exactly today as aired", () => {
    const episodes = [{ season_number: 1, episode_number: 1, air_date: "2026-10-21" }]
    expect(selectMedianAiredEpisode(episodes, "2026-10-21")).toEqual({
      season: 1,
      episode: 1,
      airDate: "2026-10-21",
    })
  })

  it("excludes impossible calendar dates that Date.parse normalizes (Feb 30/31)", () => {
    const episodes = [
      { season_number: 1, episode_number: 1, air_date: "2024-02-29" },
      { season_number: 1, episode_number: 2, air_date: "2024-02-30" },
      { season_number: 1, episode_number: 3, air_date: "2024-02-31" },
    ]
    expect(selectMedianAiredEpisode(episodes, "2026-10-21")).toEqual({
      season: 1,
      episode: 1,
      airDate: "2024-02-29",
    })
  })

  it("includes the legitimate leap day 2024-02-29 but excludes non-leap 2023-02-29", () => {
    expect(
      selectMedianAiredEpisode(
        [
          { season_number: 1, episode_number: 1, air_date: "2023-02-29" },
          { season_number: 1, episode_number: 2, air_date: "2023-03-01" },
        ],
        "2026-10-21",
      ),
    ).toEqual({ season: 1, episode: 2, airDate: "2023-03-01" })
    expect(
      selectMedianAiredEpisode([{ season_number: 1, episode_number: 1, air_date: "2024-02-29" }], "2026-10-21"),
    ).toEqual({ season: 1, episode: 1, airDate: "2024-02-29" })
  })
})

describe("isStrictCalendarDate (YYYY-MM-DD roundtrip)", () => {
  it("accepts real dates and rejects impossible/normalized ones", () => {
    expect(isStrictCalendarDate("2024-02-29")).toBe(true)
    expect(isStrictCalendarDate("2024-02-30")).toBe(false)
    expect(isStrictCalendarDate("2024-02-31")).toBe(false)
    expect(isStrictCalendarDate("2023-02-29")).toBe(false)
    expect(isStrictCalendarDate("2024-13-01")).toBe(false)
    expect(isStrictCalendarDate("2024-00-10")).toBe(false)
    expect(isStrictCalendarDate("not-a-date")).toBe(false)
  })
})

describe("isUnambiguousSeriesFind (exact tvResults === 1)", () => {
  it("requires zero movie results and exactly one tv result with a numeric id", () => {
    expect(isUnambiguousSeriesFind(0, 1, { id: 123 })).toBe(true)
    expect(isUnambiguousSeriesFind(0, 2, { id: 123 })).toBe(false)
    expect(isUnambiguousSeriesFind(0, 0, null)).toBe(false)
    expect(isUnambiguousSeriesFind(1, 1, { id: 123 })).toBe(false)
    expect(isUnambiguousSeriesFind(0, 1, null)).toBe(false)
    expect(isUnambiguousSeriesFind(0, 1, { id: "123" })).toBe(false)
  })
})

describe("seriesAdditiveDelta (curated wins; series allowlist only)", () => {
  it("proposes only absent dv/hdr10plus/atmos and never generic hdr/imax", () => {
    const d = seriesAdditiveDelta(
      { quality: "4K", formats: ["dv", "atmos"] },
      { quality: "4K", formats: ["hdr10plus", "dv"] },
    )
    expect(d).toEqual({ added: ["hdr10plus"], decision: "mutated" })
  })

  it("filters generic hdr out (nochange when only hdr is new)", () => {
    const d = seriesAdditiveDelta(
      { quality: "4K", formats: ["dv", "atmos"] },
      { quality: "4K", formats: ["hdr", "dv"] },
    )
    expect(d).toEqual({ added: [], decision: "nochange" })
  })

  it("reports nochange when the candidate adds nothing curated", () => {
    const d = seriesAdditiveDelta(
      { quality: "4K", formats: ["dv", "atmos"] },
      { quality: "4K", formats: ["dv", "atmos"] },
    )
    expect(d.decision).toBe("nochange")
  })
})

describe("sanitizeSeriesProvenanceEntry (episode-proxy, no raw payload)", () => {
  it("forwards only the allowlisted episode-proxy shape", () => {
    const entry = sanitizeSeriesProvenanceEntry({
      observedAt: "2026-10-21T00:00:00.000Z",
      season: 2,
      episode: 5,
      airDate: "2021-03-01",
      candidate: { quality: "4K", formats: ["dv", "atmos"] },
      added: ["hdr10plus"],
      decision: "mutated",
      tvResults: 1,
      movieResults: 0,
      filename: "Show.S02E05.2160p.WEBDL.DV.ATMOS.x265-XYZ.mkv",
      url: "magnet:?xt=urn:btih:abc123",
    })
    expect(entry.source).toBe("torrentio")
    expect(entry.verification).toBe("declared-episode-sample")
    expect(entry.userAccepted).toBe(true)
    expect(entry.season).toBe(2)
    expect(entry.episode).toBe(5)
    expect(entry.airDate).toBe("2021-03-01")
    expect(entry.algorithm).toBe("median-aired-lower-regular-seasons")
    expect(entry.semantics).toContain("episode-proxy-for-entire-series")
    const text = JSON.stringify(entry)
    expect(text).not.toContain("XYZ")
    expect(text).not.toContain("magnet")
  })
})
