/**
 * Per-title episode editor — REAL anime filler banner.
 *
 * The studio used to build its composed `/api/thumbnail` URL without `fill=`,
 * so a classified anime episode showed the vote badge but never the banner
 * (the settings preview showed a SAMPLE `fill=manga`). This suite locks the
 * honest contract:
 * - with the space toggle ON and a KNOWN classification, the composed preview
 *   carries `fill=<code>` + `flang=<ui lang>`;
 * - OFF, unknown, remapped ordering and failed lookups never emit `fill`
 *   (never a fabricated/sample banner);
 * - the grid cells stay raw stills (no per-cell classification requests);
 * - the classification never comes from the server-only snapshot on the
 *   client (only plain numbers travel to `/api/filler-status`).
 */
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { EpisodePreview } from "@/components/EpisodePreview"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import {
  buildEpisodeThumbnailUrl,
  type EpisodeFillerStatus,
  sanitizeEpisodeFillerLang,
  sanitizeEpisodeFillerStatus,
} from "@/lib/episode-stills"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { SearchResult } from "@/lib/types"

const STILLS = {
  id: 259909,
  stills: [
    { file_path: "/still-one.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 5.3 },
    { file_path: "/still-two.jpg", width: 1920, height: 1080, iso_639_1: null, vote_average: 0 },
  ],
}

const PREVIEW_PAYLOAD = {
  videos: [],
  seasons: [
    {
      season: 1,
      name: "Season 1",
      episodes: [
        {
          id: 1001,
          name: "Episode 1",
          season: 1,
          episode: 1,
          thumbnail: "https://image.tmdb.org/t/p/w500/still-one.jpg",
        },
      ],
    },
  ],
  totalEpisodes: 1,
  totalSeasons: 1,
}

/** Series ids are unique per test: the lookup is cached per S:E for the session. */
const FILLER_SERIES_ID = 924601
const UNKNOWN_SERIES_ID = 924602
const OFF_SERIES_ID = 924603
const NON_STANDARD_SERIES_ID = 924604
const LIVE_TOGGLE_SERIES_ID = 924605
const STRIP_SERIES_ID = 924606
const DOTS_SERIES_ID = 924607
const GROUP_FILLER_SERIES_ID = 924608

beforeEach(() => {
  localStorage.clear()
})

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

/** `/api/filler-status` answers from `statusesByKey` keyed by `tmdb:season:episode`. */
function mockFetch(statusesByKey: Record<string, EpisodeFillerStatus | null> = {}) {
  const fetchMock = vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes("/api/filler-status")) {
      const parsed = new URL(value, "http://localhost")
      const tmdb = parsed.searchParams.get("tmdb")
      const season = parsed.searchParams.get("season")
      const batch = parsed.searchParams.get("episodes")
      // Batch mode (one request per open season) and the single-episode
      // contract resolve from the SAME map.
      if (batch !== null) {
        const statuses: Record<string, EpisodeFillerStatus | null> = {}
        for (const episode of batch.split(",")) {
          statuses[episode] = statusesByKey[`${tmdb}:${season}:${episode}`] ?? null
        }
        return jsonResponse({ statuses })
      }
      const key = [tmdb, season, parsed.searchParams.get("episode")].join(":")
      return jsonResponse({ status: statusesByKey[key] ?? null })
    }
    if (value.includes("/api/preview/episodes")) return jsonResponse(PREVIEW_PAYLOAD)
    if (/\/season\/\d+\/episode\/\d+\/images/.test(value)) return jsonResponse(STILLS)
    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function selectedSeries(id: number): SearchResult {
  return {
    id,
    media_type: "tv",
    name: "Filler Test",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
  } as unknown as SearchResult
}

function fillerCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/filler-status"))
}

function FillerToggle() {
  const ed = usePosterEditor()
  return (
    <button
      type="button"
      data-testid="filler-toggle"
      onClick={() => ed.setDefaultThumbnailFillerBadge(!ed.defaultThumbnailFillerBadge)}
    >
      filler
    </button>
  )
}

function OrderingKnob() {
  const ed = usePosterEditor()
  return (
    <button
      type="button"
      data-testid="anizip-order"
      onClick={() => ed.setEpisodeGroupId("anizip")}
    >
      anizip
    </button>
  )
}

function FillerStyleKnob() {
  const ed = usePosterEditor()
  return (
    <button
      type="button"
      data-testid="filler-style-strip"
      onClick={() => ed.setDefaultThumbnailFillerStyle("strip")}
    >
      strip
    </button>
  )
}

function GroupOrderingKnob() {
  const ed = usePosterEditor()
  return (
    <button
      type="button"
      data-testid="group-order"
      onClick={() => ed.setEpisodeGroupId("grp-filler")}
    >
      group
    </button>
  )
}

async function openStudio() {
  await screen.findByTestId("episode-studio-entry")
  act(() => {
    fireEvent.click(within(screen.getByTestId("episode-studio-entry")).getByTestId("episode-still-expand"))
  })
  return screen.findByTestId("episode-browser-dialog")
}

function previewSrc(dialog: HTMLElement) {
  return within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("episode filler URL contract (client-safe builder)", () => {
  const base = {
    seriesId: 46260,
    season: 1,
    episode: 26,
    still: "/still-one.jpg",
  } as const

  it("sanitizes the classification and the display locale fail-closed", () => {
    expect(sanitizeEpisodeFillerStatus("filler")).toBe("filler")
    expect(sanitizeEpisodeFillerStatus(" MANGA ")).toBe("manga")
    expect(sanitizeEpisodeFillerStatus("anime")).toBe("anime")
    // Legacy v1 code: accepted as an alias of manga, never emitted as-is.
    expect(sanitizeEpisodeFillerStatus(" CANON ")).toBe("manga")
    expect(sanitizeEpisodeFillerStatus("sample")).toBeNull()
    expect(sanitizeEpisodeFillerStatus(null)).toBeNull()
    expect(sanitizeEpisodeFillerLang("it")).toBe("it")
    expect(sanitizeEpisodeFillerLang("pt-BR")).toBe("pt-BR")
    expect(sanitizeEpisodeFillerLang("bad lang")).toBeNull()
    expect(sanitizeEpisodeFillerLang("<svg>")).toBeNull()
  })

  it("emits fill + flang only for a real classification", () => {
    const withBanner = buildEpisodeThumbnailUrl({
      ...base,
      filler: "filler",
      fillerLang: "it",
    })
    expect(withBanner).not.toBeNull()
    const params = new URL(withBanner!, "http://localhost").searchParams
    expect(params.get("fill")).toBe("filler")
    expect(params.get("flang")).toBe("it")

    // Absent classification = no banner and the historical URL.
    const plain = buildEpisodeThumbnailUrl(base)!
    expect(new URL(plain, "http://localhost").searchParams.has("fill")).toBe(false)
    expect(plain).not.toContain("flang=")

    // Invalid values can never mint a banner.
    const invalid = buildEpisodeThumbnailUrl({
      ...base,
      filler: "sample" as unknown as EpisodeFillerStatus,
      fillerLang: "it",
    })!
    expect(new URL(invalid, "http://localhost").searchParams.has("fill")).toBe(false)
  })

  it("keeps flang out when it is unusable but keeps the real fill", () => {
    const url = buildEpisodeThumbnailUrl({
      ...base,
      filler: "manga",
      fillerLang: "bad lang",
    })!
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("fill")).toBe("manga")
    expect(params.has("flang")).toBe(false)
  })

  it("normalizes the legacy canon code to manga before the URL/cache key", () => {
    const url = buildEpisodeThumbnailUrl({
      ...base,
      filler: "canon" as unknown as EpisodeFillerStatus,
      fillerLang: "it",
    })!
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("fill")).toBe("manga")
    expect(params.get("flang")).toBe("it")
  })
})

describe("EpisodePreview real filler banner", () => {
  it("composes fill/flang when the toggle is ON and the episode is classified", async () => {
    const fetchMock = mockFetch({ [`${FILLER_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(FILLER_SERIES_ID), tmdbKey: "test-key" },
    )

    const dialog = await openStudio()
    // Toggle OFF (default): no lookup, no banner.
    expect(previewSrc(dialog)).not.toContain("fill=")
    expect(fillerCalls(fetchMock)).toHaveLength(0)

    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })

    await waitFor(() => {
      const src = previewSrc(dialog)
      expect(src).toContain("fill=filler")
      // Same display locale as the settings preview (UI lang, not a fixed code).
      expect(src).toContain("flang=it")
      // The staged layout is explicit (WYSIWYG); default is the corner chip.
      expect(src).toContain("fillStyle=corner")
    })
    expect(fillerCalls(fetchMock)).toHaveLength(1)
  })

  it("carries the selected strip layout on the preview URL", async () => {
    mockFetch({ [`${STRIP_SERIES_ID}:1:1`]: "manga" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
        <FillerStyleKnob />
      </>,
      { selected: selectedSeries(STRIP_SERIES_ID), tmdbKey: "test-key" },
    )

    const dialog = await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-style-strip"))
    })
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => {
      expect(previewSrc(dialog)).toContain("fill=manga")
    })
    expect(previewSrc(dialog)).toContain("fillStyle=strip")
  })

  it("never fabricates a banner for an unknown episode (toggle ON)", async () => {
    const fetchMock = mockFetch()
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(UNKNOWN_SERIES_ID), tmdbKey: "test-key" },
    )

    const dialog = await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => expect(fillerCalls(fetchMock)).toHaveLength(1))
    await waitFor(() => {
      expect(previewSrc(dialog)).not.toContain("fill=")
    })
    // Uncovered title/episode: an honest note explains the absent banner
    // instead of leaving the user wondering why the sample never matches.
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-filler-unavailable")).toBeInTheDocument()
    })
  })

  it("does not even ask when the toggle is OFF; OFF bytes stay banner-free", async () => {
    const fetchMock = mockFetch({ [`${OFF_SERIES_ID}:1:1`]: "manga" })
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(OFF_SERIES_ID),
      tmdbKey: "test-key",
    })

    const dialog = await openStudio()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    expect(previewSrc(dialog)).toContain("still=%2Fstill-one.jpg")
    expect(previewSrc(dialog)).not.toContain("fill=")
    expect(previewSrc(dialog)).not.toContain("flang=")
    expect(fillerCalls(fetchMock)).toHaveLength(0)
  })

  it("suppresses the lookup for remapped orderings (standard numbering only)", async () => {
    const fetchMock = mockFetch({ [`${NON_STANDARD_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <OrderingKnob />
        <FillerToggle />
      </>,
      { selected: selectedSeries(NON_STANDARD_SERIES_ID), tmdbKey: "test-key" },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("anizip-order"))
    })
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/api/preview/episodes"),
      )
      expect(calls).toHaveLength(2)
    })

    const expand = within(screen.getByTestId("episode-studio-entry")).getByTestId("episode-still-expand")
    act(() => {
      fireEvent.click(expand)
    })
    const dialog = await screen.findByTestId("episode-browser-dialog")
    expect(within(dialog).getByTestId("episode-studio-numbering-note")).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    // The gate is a real data constraint, not a missing request timing: the
    // toggle can be ON, but a remapped ordering would label the wrong episode.
    expect(fillerCalls(fetchMock)).toHaveLength(0)
    expect(previewSrc(dialog)).not.toContain("fill=")
  })

  it("keeps the banner on the selected episode only while navigating", async () => {
    // Two episodes: classification of 1:1 must never leak onto an unresolved
    // 1:2 after switching rows.
    const payload = {
      ...PREVIEW_PAYLOAD,
      seasons: [
        {
          season: 1,
          name: "Season 1",
          episodes: [
            ...PREVIEW_PAYLOAD.seasons[0].episodes,
            {
              id: 1002,
              name: "Episode 2",
              season: 1,
              episode: 2,
              thumbnail: "https://image.tmdb.org/t/p/w500/still-two.jpg",
            },
          ],
        },
      ],
      totalEpisodes: 2,
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      const value = String(url)
      if (value.includes("/api/filler-status")) {
        const parsed = new URL(value, "http://localhost")
        const batch = parsed.searchParams.get("episodes")
        if (batch !== null) {
          const statuses: Record<string, string | null> = {}
          for (const episode of batch.split(",")) {
            statuses[episode] = episode === "1" ? "filler" : null
          }
          return jsonResponse({ statuses })
        }
        const episode = parsed.searchParams.get("episode")
        return jsonResponse({ status: episode === "1" ? "filler" : null })
      }
      if (value.includes("/api/preview/episodes")) return jsonResponse(payload)
      if (/\/season\/\d+\/episode\/\d+\/images/.test(value)) return jsonResponse(STILLS)
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(LIVE_TOGGLE_SERIES_ID), tmdbKey: "test-key" },
    )

    const dialog = await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => expect(previewSrc(dialog)).toContain("fill=filler"))

    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-browser-episode")[1])
    })
    await waitFor(() => {
      expect(previewSrc(dialog)).toContain("episode/2?")
    })
    await waitFor(() => {
      expect(previewSrc(dialog)).not.toContain("fill=")
    })
  })

  it("shows a colored classification dot on every classified row", async () => {
    const payload = {
      ...PREVIEW_PAYLOAD,
      seasons: [
        {
          season: 1,
          name: "Season 1",
          episodes: [
            { id: 1001, name: "Episode 1", season: 1, episode: 1 },
            { id: 1002, name: "Episode 2", season: 1, episode: 2 },
            { id: 1003, name: "Episode 3", season: 1, episode: 3 },
          ],
        },
      ],
      totalEpisodes: 3,
    }
    const byEpisode: Record<string, EpisodeFillerStatus | null> = {
      "1": "manga",
      "2": "anime",
      "3": "mixed",
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      const value = String(url)
      if (value.includes("/api/filler-status")) {
        const parsed = new URL(value, "http://localhost")
        const batch = parsed.searchParams.get("episodes")
        if (batch !== null) {
          const statuses: Record<string, EpisodeFillerStatus | null> = {}
          for (const episode of batch.split(",")) {
            statuses[episode] = byEpisode[episode] ?? null
          }
          return jsonResponse({ statuses })
        }
        return jsonResponse({
          status: byEpisode[parsed.searchParams.get("episode") ?? ""] ?? null,
        })
      }
      if (value.includes("/api/preview/episodes")) return jsonResponse(payload)
      if (/\/season\/\d+\/episode\/\d+\/images/.test(value)) return jsonResponse(STILLS)
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithCtx(
      <StrictMode>
        <EpisodePreview />
        <FillerToggle />
      </StrictMode>,
      { selected: selectedSeries(DOTS_SERIES_ID), tmdbKey: "test-key" },
    )

    const dialog = await openStudio()
    // Toggle OFF: no lookup, no dots.
    expect(within(dialog).queryAllByTestId("episode-filler-dot")).toHaveLength(0)

    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })

    await waitFor(() => {
      const dots = within(dialog).getAllByTestId("episode-filler-dot")
      expect(dots).toHaveLength(3)
      expect(dots.map((dot) => dot.getAttribute("data-status"))).toEqual([
        "manga",
        "anime",
        "mixed",
      ])
    })
    // The actual symptom this test guards: under StrictMode the batch must
    // still feed the composed center banner, not only the row dots.
    expect(previewSrc(dialog)).toContain("fill=manga")
    const dots = within(dialog).getAllByTestId("episode-filler-dot")
    // Same accents as the rendered banner (client-safe mirror).
    expect(dots[0].style.backgroundColor).toBe("rgb(34, 197, 94)")
    expect(dots[1].style.backgroundColor).toBe("rgb(167, 139, 250)")
    expect(dots[2].style.backgroundColor).toBe("rgb(56, 189, 248)")
  })

  it("resolves the banner and dots from the ORIGINAL TMDB S:E for Episode Groups", async () => {
    const groupPayload = {
      videos: [],
      seasons: [
        {
          season: 1,
          name: "Parte 1",
          episodes: [
            // Visible S1:E1, original TMDB S1:E26 (filler in the snapshot).
            { id: 2001, name: "Episodio 1", season: 1, episode: 1, stillSeason: 1, stillEpisode: 26 },
          ],
        },
      ],
      totalEpisodes: 1,
      totalSeasons: 1,
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      const value = String(url)
      if (value.includes("/api/filler-status")) {
        const parsed = new URL(value, "http://localhost")
        const batch = parsed.searchParams.get("episodes")
        if (batch !== null) {
          const statuses: Record<string, EpisodeFillerStatus | null> = {}
          for (const episode of batch.split(",")) {
            statuses[episode] =
              parsed.searchParams.get("season") === "1" && episode === "26" ? "filler" : null
          }
          return jsonResponse({ statuses })
        }
        return jsonResponse({ status: null })
      }
      if (value.includes("/api/preview/episodes")) return jsonResponse(groupPayload)
      if (/\/season\/\d+\/episode\/\d+\/images/.test(value)) return jsonResponse(STILLS)
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithCtx(
      <>
        <EpisodePreview />
        <GroupOrderingKnob />
        <FillerToggle />
      </>,
      { selected: selectedSeries(GROUP_FILLER_SERIES_ID), tmdbKey: "test-key" },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("group-order"))
    })
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/api/preview/episodes"),
      )
      expect(calls).toHaveLength(2)
    })

    const dialog = await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })

    await waitFor(() => {
      expect(previewSrc(dialog)).toContain("fill=filler")
      const dots = within(dialog).getAllByTestId("episode-filler-dot")
      expect(dots).toHaveLength(1)
      expect(dots[0].getAttribute("data-status")).toBe("filler")
    })

    // The lookup used the ORIGINAL S1:E26, never the visible S1:E1.
    const fillerUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/api/filler-status"))
    expect(fillerUrls.some((url) => url.includes("season=1") && url.includes("episodes=26"))).toBe(
      true,
    )
    expect(fillerUrls.some((url) => url.includes("episodes=1"))).toBe(false)
  })
})
