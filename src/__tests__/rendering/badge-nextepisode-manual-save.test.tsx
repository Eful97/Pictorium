/**
 * Manual next-episode identity: dropdown token -> save -> reload/render.
 *
 * A manual "New episode" pick stores the stable token (never dated text) in
 * both shapes, and the runtime resolves the current label before the air
 * date and nothing after it. Portrait and landscape/stash boundaries keep
 * the other shape's saved look intact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { getAllBadgeOptions, NEXT_EPISODE_BADGE_KEY } from "@/lib/badge-priority"
import {
  getNextEpisodeLabel,
  isNextEpisodeDisplayed,
  resolveManualNextEpisodeLabel,
} from "@/lib/poster-badge"
import { createT } from "@/lib/i18n"

const t = createT("it")
const noop = () => {}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 7, media_type: "tv", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
    posters: [],
    metaInfo: {
      genres: [{ id: 1, name: "Dramma" }],
      voteAverage: 7.5,
      type: "Series",
      status: null,
      first_air_date: "2024-01-01",
      last_air_date: null,
      next_episode_to_air: { air_date: "2026-11-03" },
      number_of_seasons: 2,
      number_of_episodes: null,
      awards: [],
      nominations: [],
      studios: [],
      director: null,
      keywords: [],
    },
    trendRank: null,
    mdblistAnimeList: [],
    mappingsMap: new Map<string, Mapping>(),
    loadMappings: async () => {},
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: true,
    rankingBadges: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    badgeQuality: true,
    customRatings: true,
    ratingSources: ["imdb", "tmdb"],
    separateRatings: false,
    separateRatingsStyle: "column",
    customBadge: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    extraBadgeStyle: null,
    badgeFont: "inter",
    qualityBadgeStyle: "standard",
    videoFormats: null,
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    defaultExtraBadgeStyle: null,
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    landscapeBlur: {
      gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 50,
      blurDarkness: 30, tintStrength: 20, topShade: 50, topShadeHeight: 25,
    },
    landscapeBlurDirty: false,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    topShadeHeight: 25,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    extraBadgeScale: null,
    extraBadgeOffsetX: null,
    extraBadgeOffsetY: null,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 130,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    rotationPosters: [],
    autoRotateClean: false,
    defaultAutoRotateClean: false,
    excludedPosters: [],
    accentColor: null,
    logoDisabled: false,
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    logoScaleExplicit: true,
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: true,
    networkLogoPosition: "auto",
    networkLogoFollowTitle: true,
    ribbonEnabled: true,
    lang: "it",
    episodeGroupId: null,
    posterShape: "poster",
    posterLayout: "standard",
    posterFreshScope: "ranked",
    defaultSashOrder: null,
    ...overrides,
  } as never
}

let posted: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  posted = []
  vi.useRealTimers()
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
    const body = (init as { body?: string })?.body
    posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
  }))
})

function mappingPosts() {
  return posted.filter((p) => String(p.url).includes("/api/mappings"))
}

describe("manual next-episode dropdown -> save -> reload/render", () => {
  it("dropdown offers the token identity while showing the dated label", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-20T12:00:00"))
    const dated = getNextEpisodeLabel({ mediaType: "tv", airDate: "2026-10-23", locale: "it", t })
    expect(dated).toMatch(/^Nuovo episodio /)
    const options = getAllBadgeOptions({
      upcomingRelease: null,
      isNewMovie: false,
      isNewSeries: false,
      newSeason: null,
      nextEpisode: dated,
      animeRank: null,
      trendRank: null,
      award: null,
      nomination: null,
      studio: null,
      director: null,
      subGenre: null,
      extra: null,
      mediaType: "tv",
      voteAverage: 7.5,
      tvType: null,
      tvStatus: null,
    })
    expect(options).toContain(NEXT_EPISODE_BADGE_KEY)
    expect(options).not.toContain(dated)
  })

  it("portrait save freezes the token, never dated text", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-20T12:00:00"))
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      customBadge: NEXT_EPISODE_BADGE_KEY,
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.customBadge).toBe(NEXT_EPISODE_BADGE_KEY)
    expect(posts[0].body.badgeExtra).toBeUndefined()

    // Reload: same identity renders the current label before air date.
    const saved = posts[0].body as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.customBadge).toBe(NEXT_EPISODE_BADGE_KEY)
    expect(resolveManualNextEpisodeLabel(
      effectiveMappingForShape(saved, "poster")?.customBadge ?? null,
      { mediaType: "tv", airDate: "2026-10-23", locale: "it", t },
    )).toMatch(/^Nuovo episodio /)
    expect(isNextEpisodeDisplayed({
      mediaType: "tv",
      rankingEnabled: true,
      queryExtra: NEXT_EPISODE_BADGE_KEY,
      badgeInput: {
        mediaType: "tv",
        releaseDate: null,
        firstAirDate: "2024-01-01",
        lastAirDate: null,
        seasonCount: 2,
        nextEpisodeAirDate: "2026-10-23",
        numberOfEpisodes: null,
        originCountries: [],
        voteAverage: 7.5,
        trendRank: null,
        animeRank: null,
        awards: [],
        nominations: [],
        studios: [],
        director: null,
        tvType: "Series",
        tvStatus: null,
        keywords: [],
        imdbTop250: false,
      },
      locale: "it",
      t,
    })).toBe(true)

    // After the window the same identity shows nothing (no stale date).
    expect(resolveManualNextEpisodeLabel(
      effectiveMappingForShape(saved, "poster")?.customBadge ?? null,
      { mediaType: "tv", airDate: "2026-09-01", locale: "it", t },
    )).toBeNull()
    expect(isNextEpisodeDisplayed({
      mediaType: "tv",
      rankingEnabled: true,
      queryExtra: NEXT_EPISODE_BADGE_KEY,
      badgeInput: {
        mediaType: "tv",
        releaseDate: null,
        firstAirDate: "2024-01-01",
        lastAirDate: null,
        seasonCount: 2,
        nextEpisodeAirDate: "2026-09-01",
        numberOfEpisodes: null,
        originCountries: [],
        voteAverage: 7.5,
        trendRank: null,
        animeRank: null,
        awards: [],
        nominations: [],
        studios: [],
        director: null,
        tvType: "Series",
        tvStatus: null,
        keywords: [],
        imdbTop250: false,
      },
      locale: "it",
      t,
    })).toBe(false)
  })

  it("landscape save keeps the portrait flat intact and profiles the token", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-20T12:00:00"))
    const prev: Mapping = {
      tmdbId: 7, mediaType: "tv", title: "T", posterPath: "/p.jpg",
      logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
      customBadge: null,
    }
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      customBadge: NEXT_EPISODE_BADGE_KEY,
      mappingsMap: new Map([["tv:7", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Portrait flat stays saved (null), landscape profile carries the token.
    expect(posts[0].body.customBadge).toBeNull()
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.customBadge).toBe(NEXT_EPISODE_BADGE_KEY)
    expect(effectiveMappingForShape(posts[0].body as unknown as Mapping, "landscape")?.customBadge)
      .toBe(NEXT_EPISODE_BADGE_KEY)
    expect(effectiveMappingForShape(posts[0].body as unknown as Mapping, "poster")?.customBadge)
      .toBeNull()
  })
})
