/**
 * U2 — episode still picker.
 *
 * The picker lists every TMDB still of one episode (read-only
 * `/api/tmdb/[id]/season/[season]/episode/[episode]/images`), previews the
 * selection through the shared `/api/thumbnail` compositor and persists it in
 * the per-title mapping state (`episodeThumbnailStills`, key `S:E`).
 *
 * Contracts covered here:
 * - fetch is mocked, stills are deduplicated/sanitized;
 * - the fullscreen studio has collapsible seasons, a large center preview and
 *   the still variants pane;
 * - clicking a still STAGES the choice (no editor write, no save);
 * - one Save persists every staged `S:E` at once through the normal mapping
 *   save; Cancel and closing without saving discard the draft;
 * - an invalid path is never staged and never produces a preview;
 * - an empty still list renders the graceful empty state (no error/500).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react"
import { EpisodePreview } from "@/components/EpisodePreview"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useEpisodeStills } from "@/lib/useEpisodeStills"
import {
  buildEpisodeThumbnailUrl,
  sanitizeEpisodeStillPath,
  sanitizeEpisodeThumbnailStills,
} from "@/lib/episode-stills"
import { buildThumbnailPreviewUrl } from "@/components/settings/thumbnail-preview"
import { t } from "@/lib/i18n"
import itDict from "@/lib/translations/it.json"
import enDict from "@/lib/translations/en.json"
import { mappingSchema } from "@/lib/validation"
import { defaultsStorageKey } from "@/lib/useDefaults"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"
import type { SearchResult } from "@/lib/types"

const SERIES_ID = 424242

// Space defaults auto-persist to localStorage on every edit; a test that
// changes a Miniature choice must not leak it into the next one.
beforeEach(() => {
  localStorage.clear()
})

const STILLS = {
  id: 259909,
  stills: [
    { file_path: "/still-one.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 5.3 },
    { file_path: "/still-two.jpg", width: 1920, height: 1080, iso_639_1: null, vote_average: 0 },
    // Duplicate + invalid rows must never reach state/selection.
    { file_path: "/still-one.jpg", width: 1920, height: 1080 },
    { file_path: "/bad still.jpg", width: 1920, height: 1080 },
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

const TWO_STILLS = {
  id: 260001,
  stills: [
    { file_path: "/still-three.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 6.1 },
    { file_path: "/still-four.jpg", width: 1920, height: 1080, iso_639_1: null, vote_average: 0 },
    { file_path: "/bad still.jpg", width: 1920, height: 1080 },
  ],
}

const TWO_EPISODE_PAYLOAD = {
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
          thumbnail: "https://image.tmdb.org/t/p/w500/still-three.jpg",
        },
      ],
    },
  ],
  totalEpisodes: 2,
}

/** Episode row shape the mocked preview endpoint returns (thumbnail optional). */
interface PreviewPayloadFixture {
  videos: unknown[]
  seasons: {
    season: number
    name: string
    episodes: {
      id: number
      name: string
      season: number
      episode: number
      thumbnail?: string
      /** Original TMDB S:E of a remapped (Episode Group) row. */
      stillSeason?: number
      stillEpisode?: number
    }[]
  }[]
  totalEpisodes: number
  totalSeasons: number
}

/** Single TVDB episode cover the TVDB-source payload serves (no variants). */
const TVDB_COVER = "https://artworks.thetvdb.com/banners/episodes/101.jpg"

/** Same series, TVDB-enriched: the episode thumbnail is the TVDB cover. */
const TVDB_PREVIEW_PAYLOAD: PreviewPayloadFixture = {
  ...PREVIEW_PAYLOAD,
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
          thumbnail: TVDB_COVER,
        },
      ],
    },
  ],
}

function mockFetch(
  stillsByEpisode: Record<string, typeof STILLS> = { "1:1": STILLS },
  payload: PreviewPayloadFixture = PREVIEW_PAYLOAD,
  tvdbPayload?: PreviewPayloadFixture,
) {
  const fetchMock = vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes("/api/preview/episodes")) {
      // The component asks `source=tvdb` when the space uses TVDB metadata:
      // serve the enriched payload so the TVDB tab has its single cover.
      const tvdbSource = tvdbPayload !== undefined && /[?&]source=tvdb(?:&|$)/.test(value)
      return { ok: true, status: 200, json: async () => (tvdbSource ? tvdbPayload : payload) }
    }
    const match = value.match(/\/season\/(\d+)\/episode\/(\d+)\/images/)
    if (match) {
      const key = `${Number(match[1])}:${Number(match[2])}`
      return { ok: true, status: 200, json: async () => stillsByEpisode[key] ?? { id: 0, stills: [] } }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function selectedSeries(): SearchResult {
  return {
    id: SERIES_ID,
    media_type: "tv",
    name: "Still Test",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
  } as unknown as SearchResult
}

describe("episode still picker helpers", () => {
  it("sanitizes still paths and the stored S:E map", () => {
    expect(sanitizeEpisodeStillPath("/ok.jpg")).toBe("/ok.jpg")
    expect(sanitizeEpisodeStillPath("https://evil.example/x.jpg")).toBeNull()
    expect(sanitizeEpisodeStillPath("/nested/path.jpg")).toBeNull()
    expect(sanitizeEpisodeStillPath("/bad still.jpg")).toBeNull()
    expect(sanitizeEpisodeThumbnailStills({ "1:2": "/ok.jpg", "x": "/ok.jpg", "1:3": "///" })).toEqual({
      "1:2": "/ok.jpg",
    })
    expect(sanitizeEpisodeThumbnailStills({})).toBeNull()
  })

  it("mapping schema accepts valid S:E overrides and rejects invalid ones", () => {
    const base = { tmdbId: 1, mediaType: "tv" as const, title: "Test", posterPath: "/poster.jpg" }
    expect(mappingSchema.safeParse({
      ...base,
      episodeThumbnailStills: { "1:1": "/still.jpg" },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({
      ...base,
      episodeThumbnailStills: { "1:1": "/bad still.jpg" },
    }).success).toBe(false)
    expect(mappingSchema.safeParse({
      ...base,
      episodeThumbnailStills: { "not-an-episode": "/still.jpg" },
    }).success).toBe(false)
  })

  it("builds the compositor preview URL with the encoded still, w and badges", () => {
    const url = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 2,
      episode: 5,
      still: "/still-two.jpg",
    })
    expect(url).toBe(
      `/api/thumbnail/tv/${SERIES_ID}/season/2/episode/5?still=%2Fstill-two.jpg&w=320&badges=both`,
    )
    expect(buildEpisodeThumbnailUrl({ seriesId: SERIES_ID, season: 1, episode: 1, still: "/bad still.jpg" })).toBeNull()
  })

  it("emits the Miniature visual choices with the same params/order as /meta", () => {
    const url = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
      badgeStyle: "branded",
      anchor: "br",
      offsetX: 12,
      offsetY: -4,
      badgeScale: 150,
      voteSource: "tmdb",
      blur: true,
    })
    expect(url).toBe(
      `/api/thumbnail/tv/${SERIES_ID}/season/1/episode/1?still=%2Fstill-one.jpg&w=320&badges=both&bstyle=branded&anchor=br&ox=12&oy=-4&bscale=150&source=tmdb&blur=1`,
    )
    // Scale is optional: absent = no param (the renderer default 100), so a
    // caller without space defaults keeps the historical URL byte-identical.
    const withoutScale = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
      badgeStyle: "branded",
      anchor: "br",
      offsetX: 12,
      offsetY: -4,
      voteSource: "tmdb",
      blur: true,
    })
    expect(withoutScale).not.toContain("bscale=")
    // Blur OFF is the renderer default: no param at all (byte-identical plain).
    const plain = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
      badgeStyle: "pill",
      anchor: "tr",
      offsetX: 0,
      offsetY: 0,
      badgeScale: 100,
      voteSource: "imdb",
      blur: false,
    })
    // Explicit 100 travels as `bscale=100`; the renderer produces the SAME
    // bytes as an absent param (proven by the thumbnail route tests).
    expect(plain).toContain("&bscale=100&source=imdb")
    expect(plain).not.toContain("blur=")
  })

  it("propagates the scoped user as u= (image requests carry no session headers)", () => {
    // Multi-user BYOK: the compositor resolves TVDB/TMDB keys server-side, so
    // the namespace must travel in the image URL exactly like the poster URL.
    const scoped = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
      user: "11111111-2222-3333-4444-555555555555",
    })
    expect(scoped).not.toBeNull()
    expect(new URL(scoped!, "http://localhost").searchParams.get("u")).toBe(
      "11111111-2222-3333-4444-555555555555",
    )
    // Global request keeps the historical byte-identical URL (no `u=`).
    const global = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
    })
    expect(new URL(global!, "http://localhost").searchParams.has("u")).toBe(false)
  })

  it("carries the same bscale/visual contract as /meta (picker URL vs settings preview)", () => {
    // /meta parity is proven separately (`meta-thumbnail-settings.test.ts`
    // compares the settings preview builder with the emitted /meta URL), so
    // comparing the picker with the SAME preview builder locks the picker to
    // that contract: style, anchor, offsets, scale, source and blur.
    const picker = buildEpisodeThumbnailUrl({
      seriesId: SERIES_ID,
      season: 1,
      episode: 1,
      still: "/still-one.jpg",
      badgeStyle: "branded",
      anchor: "br",
      offsetX: 12,
      offsetY: -8,
      badgeScale: 175,
      voteSource: "tmdb",
      blur: true,
    })
    const preview = buildThumbnailPreviewUrl({
      demoMedia: { mediaType: "tv", id: SERIES_ID, title: "Still Test" },
      still: "/still-one.jpg",
      badgeStyle: "branded",
      anchor: "br",
      offsetX: 12,
      offsetY: -8,
      badgeScale: 175,
      voteSource: "tmdb",
      blur: true,
      showBadges: true,
      badgesEnabled: true,
    })
    expect(picker).not.toBeNull()
    const pickerParams = new URL(picker!, "http://localhost").searchParams
    const previewParams = new URL(preview, "http://localhost").searchParams
    for (const key of ["bstyle", "anchor", "ox", "oy", "bscale", "source", "blur"]) {
      expect(pickerParams.get(key)).toBe(previewParams.get(key))
    }
    expect(pickerParams.get("bscale")).toBe("175")
  })
})

describe("useEpisodeStills", () => {
  beforeEach(() => {
    mockFetch({ "1:1": STILLS })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches stills, defaults to the episode still and persists a selection", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => ({
      state: useEpisodeStills({
        seriesId: SERIES_ID,
        season: 1,
        episode: 1,
        tmdbKey: "test-key",
        defaultStill: "/still-one.jpg",
      }),
      editor: usePosterEditor(),
    }), { wrapper })

    await waitFor(() => expect(result.current.state.stills).toHaveLength(2))
    // Duplicate + invalid rows are dropped; the raw episode still is selected.
    expect(result.current.state.stills.map((s) => s.file_path)).toEqual(["/still-one.jpg", "/still-two.jpg"])
    expect(result.current.state.selected).toBe("/still-one.jpg")
    expect(result.current.state.previewUrl).toContain("still=%2Fstill-one.jpg")

    act(() => {
      result.current.state.select("/still-two.jpg")
    })
    expect(result.current.editor.episodeThumbnailStills).toEqual({ "1:1": "/still-two.jpg" })
    expect(result.current.state.selected).toBe("/still-two.jpg")
    expect(result.current.state.previewUrl).toBe(
      `/api/thumbnail/tv/${SERIES_ID}/season/1/episode/1?still=%2Fstill-two.jpg&w=320&badges=both&bstyle=pill&anchor=tr&ox=0&oy=0&bscale=100&source=imdb`,
    )
  })

  it("follows the space Miniature defaults (branded style + bottom-right anchor)", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => ({
      state: useEpisodeStills({
        seriesId: SERIES_ID,
        season: 1,
        episode: 1,
        tmdbKey: "test-key",
        defaultStill: "/still-one.jpg",
      }),
      editor: usePosterEditor(),
    }), { wrapper })

    await waitFor(() => expect(result.current.state.stills).toHaveLength(2))

    act(() => {
      result.current.editor.setThumbnailBadgeStyle("branded")
      result.current.editor.setThumbnailBadgeAnchor("br")
    })

    await waitFor(() => {
      const url = result.current.state.previewUrl ?? ""
      expect(url).toContain("bstyle=branded")
      expect(url).toContain("anchor=br")
    })
    expect(result.current.state.previewUrl).toBe(
      `/api/thumbnail/tv/${SERIES_ID}/season/1/episode/1?still=%2Fstill-one.jpg&w=320&badges=both&bstyle=branded&anchor=br&ox=0&oy=0&bscale=100&source=imdb`,
    )
  })

  it("follows the saved badge-stack scale live (bscale = thumbnailBadgeScale)", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => ({
      state: useEpisodeStills({
        seriesId: SERIES_ID,
        season: 1,
        episode: 1,
        tmdbKey: "test-key",
        defaultStill: "/still-one.jpg",
      }),
      editor: usePosterEditor(),
    }), { wrapper })

    await waitFor(() => expect(result.current.state.stills).toHaveLength(2))
    expect(result.current.state.previewUrl).toContain("&bscale=100&")

    act(() => {
      result.current.editor.setThumbnailBadgeScale(150)
    })

    await waitFor(() => {
      expect(result.current.state.previewUrl).toContain("&bscale=150&")
    })
    // Out-of-contract values are clamped to the renderer bounds, never emitted raw.
    act(() => {
      result.current.editor.setThumbnailBadgeScale(999)
    })
    await waitFor(() => {
      expect(result.current.state.previewUrl).toContain("&bscale=200&")
    })
  })

  it("never saves an invalid still and keeps the previous selection", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => ({
      state: useEpisodeStills({
        seriesId: SERIES_ID,
        season: 1,
        episode: 1,
        tmdbKey: "test-key",
      }),
      editor: usePosterEditor(),
    }), { wrapper })

    await waitFor(() => expect(result.current.state.stills).toHaveLength(2))
    act(() => {
      result.current.state.select("/still-two.jpg")
    })
    act(() => {
      result.current.state.select("/bad still.jpg")
    })
    expect(result.current.editor.episodeThumbnailStills).toEqual({ "1:1": "/still-two.jpg" })
    expect(result.current.state.selected).toBe("/still-two.jpg")
  })

  it("fetches a remapped episode by its ORIGINAL TMDB S:E but keys the override by the visible S:E", async () => {
    // Episode Groups expose the original TMDB numbering: stills must come from
    // that episode, while the override stays under the visible key `/meta`
    // applies to the group video.
    const REMAPPED_STILLS = {
      id: 270001,
      stills: [
        { file_path: "/orig-a.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 7.1 },
        { file_path: "/orig-b.jpg", width: 1920, height: 1080, iso_639_1: null, vote_average: 0 },
      ],
    }
    const fetchMock = mockFetch({ "2:7": REMAPPED_STILLS })
    const wrapper = createWrapper()
    const { result } = renderHook(() => ({
      state: useEpisodeStills({
        seriesId: SERIES_ID,
        season: 3,
        episode: 1,
        stillSeason: 2,
        stillEpisode: 7,
        tmdbKey: "test-key",
      }),
      editor: usePosterEditor(),
    }), { wrapper })

    await waitFor(() => expect(result.current.state.stills).toHaveLength(2))
    expect(result.current.state.stills.map((s) => s.file_path)).toEqual(["/orig-a.jpg", "/orig-b.jpg"])
    const imageCall = fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes("/images"))
    expect(imageCall).toContain(`/api/tmdb/${SERIES_ID}/season/2/episode/7/images`)

    act(() => {
      result.current.state.select("/orig-b.jpg")
    })
    expect(result.current.editor.episodeThumbnailStills).toEqual({ "3:1": "/orig-b.jpg" })
    // The composed preview stays the visible episode's request (same as /meta).
    expect(result.current.state.previewUrl).toBe(
      `/api/thumbnail/tv/${SERIES_ID}/season/3/episode/1?still=%2Forig-b.jpg&w=320&badges=both&bstyle=pill&anchor=tr&ox=0&oy=0&bscale=100&source=imdb`,
    )
  })
})

describe("EpisodePreview still studio", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function entryButton() {
    return within(screen.getByTestId("episode-studio-entry")).getByTestId("episode-still-expand")
  }

  async function openEpisodeBrowser() {
    // The entry row only appears once `/api/preview/episodes` resolves.
    await screen.findByTestId("episode-studio-entry")
    const open = entryButton()
    act(() => {
      fireEvent.click(open)
    })
    return screen.findByTestId("episode-browser-dialog")
  }

  it("requests episode titles in the active UI language", async () => {
    // Episode/season names come from TMDB: a hardcoded locale would freeze
    // them in one language. The preview must follow the UI language (+ region).
    const fetchMock = mockFetch()
    renderWithCtx(<EpisodePreview />, { selected: selectedSeries(), tmdbKey: "test-key", lang: "en" })

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/preview/episodes"))
      expect(call).toBeTruthy()
      const url = new URL(String(call![0]), "http://localhost")
      expect(url.searchParams.get("lang")).toBe("en")
    })
  })

  function StillOverrideProbe() {
    const ed = usePosterEditor()
    return <span data-testid="still-overrides">{JSON.stringify(ed.episodeThumbnailStills ?? {})}</span>
  }

  /** Space-wide Miniature visual choices (the Reset-all target). */
  function ThumbnailDefaultsProbe() {
    const ed = usePosterEditor()
    return (
      <span data-testid="thumbnail-defaults">
        {JSON.stringify({
          style: ed.thumbnailBadgeStyle,
          anchor: ed.thumbnailBadgeAnchor,
          ox: ed.thumbnailBadgeOffsetX,
          oy: ed.thumbnailBadgeOffsetY,
          scale: ed.thumbnailBadgeScale,
          blur: ed.thumbnailBlurEnabled,
          source: ed.thumbnailVoteSource,
        })}
      </span>
    )
  }

  /** Seed non-default space choices + a saved S:E override before opening. */
  function ThumbnailKnobs() {
    const ed = usePosterEditor()
    return (
      <>
        <button
          type="button"
          data-testid="knob-custom-thumb"
          onClick={() => {
            ed.setThumbnailBadgeStyle("branded")
            ed.setThumbnailBadgeAnchor("br")
            ed.setThumbnailBadgeOffsetX(12)
            ed.setThumbnailBadgeOffsetY(-8)
            ed.setThumbnailBadgeScale(150)
            ed.setThumbnailBlurEnabled(true)
            ed.setThumbnailVoteSource("tmdb")
          }}
        >
          custom thumb
        </button>
        <button
          type="button"
          data-testid="knob-saved-override"
          onClick={() => ed.setEpisodeThumbnailStills({ "1:1": "/still-two.jpg" })}
        >
          saved override
        </button>
      </>
    )
  }

  /** Editor knobs: exercise the picker gate without touching studio internals. */
  function EditorKnobs() {
    const ed = usePosterEditor()
    return (
      <>
        <button type="button" data-testid="knob-tvdb-metadata" onClick={() => ed.setEpisodeMetadataSource("tvdb")}>
          tvdb metadata
        </button>
        <button type="button" data-testid="knob-anizip-order" onClick={() => ed.setEpisodeGroupId("anizip")}>
          anizip ordering
        </button>
        <button type="button" data-testid="knob-group-order" onClick={() => ed.setEpisodeGroupId("remap-group")}>
          group ordering
        </button>
      </>
    )
  }

  /**
   * Changing an editor knob re-runs the `/api/preview/episodes` effect, whose
   * success handler clears the studio seed; wait for that round-trip so the
   * click under test does not race a late refresh.
   */
  async function settlePreviewFetch(fetchMock: ReturnType<typeof mockFetch>, expectedCalls: number) {
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/preview/episodes"))
      expect(calls).toHaveLength(expectedCalls)
    })
    await waitFor(() => {
      expect(screen.queryByText(/Carico episodi da/)).toBeNull()
    })
  }

  it("auto-opens the still studio when entered from the Miniature zone", async () => {
    mockFetch()
    const onAutoOpenThumbnailStudio = vi.fn()
    renderWithCtx(
      <EpisodePreview
        autoOpenThumbnailStudio
        onAutoOpenThumbnailStudio={onAutoOpenThumbnailStudio}
      />,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    // No click on the "Vedi tutti" entry: the Miniature zone lands directly on
    // the editing studio once the preview payload resolves.
    expect(await screen.findByTestId("episode-browser-dialog")).toBeTruthy()
    expect(onAutoOpenThumbnailStudio).toHaveBeenCalledTimes(1)
  })

  it("leaves the still studio closed on a normal poster entry", async () => {
    mockFetch()
    renderWithCtx(<EpisodePreview />, { selected: selectedSeries(), tmdbKey: "test-key" })

    await screen.findByTestId("episode-studio-entry")
    expect(screen.queryByTestId("episode-browser-dialog")).toBeNull()
  })

  it("opens the studio for TVDB content and lists the single TVDB cover in the TVDB tab", async () => {
    // TVDB publishes ONE image per episode (no variant gallery). The studio is
    // shared by both providers: the right pane exposes TMDB | TVDB, and the
    // TVDB tab lists that single cover (never a fabricated list), staging the
    // provider so /meta (`?stills=tvdb`) serves the TVDB base.
    const saveConfig = vi.fn(async () => true)
    const fetchMock = mockFetch(undefined, PREVIEW_PAYLOAD, TVDB_PREVIEW_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <EditorKnobs />
        <StillOverrideProbe />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key", saveConfig },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("knob-tvdb-metadata"))
    })
    await settlePreviewFetch(fetchMock, 2)

    const expand = screen.getByTestId("episode-still-expand")
    act(() => {
      fireEvent.click(expand)
    })
    const dialog = await screen.findByTestId("episode-browser-dialog")

    // Tabs exist and TMDB stays the default.
    expect(within(dialog).getByTestId("episode-still-source-tmdb")).toHaveAttribute("aria-selected", "true")
    expect(within(dialog).getByTestId("episode-still-source-tvdb")).toHaveAttribute("aria-selected", "false")

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-still-source-tvdb"))
    })
    expect(within(dialog).getByTestId("episode-still-source-tvdb")).toHaveAttribute("aria-selected", "true")
    // TMDB variants are not rendered under the TVDB tab; the TVDB provider
    // needs no TMDB-still editor to appear.
    expect(within(dialog).queryAllByTestId("episode-still-tile")).toHaveLength(0)
    const tvdbTile = within(dialog).getByTestId("episode-tvdb-still-tile")
    expect(tvdbTile.getAttribute("data-provider")).toBe("tvdb")
    expect(tvdbTile.querySelector("img")?.getAttribute("src")).toBe(TVDB_COVER)
    // The space itself is TVDB: no "TMDB source" hint is shown.
    expect(within(dialog).queryByTestId("episode-tvdb-still-source-hint")).toBeNull()

    // Staging the TVDB cover records the provider: the composed preview (the
    // same request /meta serves) carries `?stills=tvdb`.
    act(() => {
      fireEvent.click(tvdbTile)
    })
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "stills=tvdb",
      )
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")
    // Nothing written before Save.
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-save"))
    })
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    // Provider record for /meta: the TVDB choice removes any TMDB override, so
    // the space TVDB source is what /meta composes.
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
  })

  it("shows TMDB | TVDB tabs, defaults to TMDB, and keeps an honest empty TVDB state without a cover", async () => {
    // TMDB source payload: no TVDB cover is known, so the TVDB tab must say so
    // instead of inventing variants or re-listing TMDB stills.
    mockFetch()
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    const tmdbTab = within(dialog).getByTestId("episode-still-source-tmdb")
    const tvdbTab = within(dialog).getByTestId("episode-still-source-tvdb")
    expect(within(dialog).getByTestId("episode-still-source-tabs")).toBeInTheDocument()
    expect(tmdbTab).toHaveAttribute("aria-selected", "true")
    expect(tvdbTab).toHaveAttribute("aria-selected", "false")
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })

    act(() => {
      fireEvent.click(tvdbTab)
    })
    expect(tvdbTab).toHaveAttribute("aria-selected", "true")
    expect(tmdbTab).toHaveAttribute("aria-selected", "false")
    expect(within(dialog).queryAllByTestId("episode-still-tile")).toHaveLength(0)
    expect(within(dialog).queryByTestId("episode-tvdb-still-tile")).toBeNull()
    expect(within(dialog).getByTestId("episode-tvdb-still-empty")).toHaveTextContent(
      t("ui.episodeStillPickerEmpty"),
    )
    // The space is TMDB: the honest note explains when /meta serves TVDB.
    expect(within(dialog).getByTestId("episode-tvdb-still-source-hint")).toBeInTheDocument()

    act(() => {
      fireEvent.click(tmdbTab)
    })
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
  })

  it("TVDB tab staging removes a saved TMDB override on save and the preview carries stills=tvdb", async () => {
    // Switching an episode back to the TVDB cover records the provider by
    // dropping its explicit TMDB override: /meta then composes the space TVDB
    // base (`?stills=tvdb`) instead of the stale TMDB still.
    const saveConfig = vi.fn(async () => true)
    const fetchMock = mockFetch(undefined, PREVIEW_PAYLOAD, TVDB_PREVIEW_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <EditorKnobs />
        <ThumbnailKnobs />
        <StillOverrideProbe />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key", saveConfig },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("knob-saved-override"))
      fireEvent.click(screen.getByTestId("knob-tvdb-metadata"))
    })
    await settlePreviewFetch(fetchMock, 2)
    expect(screen.getByTestId("still-overrides").textContent).toBe('{"1:1":"/still-two.jpg"}')

    const dialog = await openEpisodeBrowser()
    // The saved TMDB override still wins on open (it is TMDB by contract).
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-two.jpg",
      )
    })
    expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).not.toContain(
      "stills=tvdb",
    )

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-still-source-tvdb"))
    })
    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-tvdb-still-tile"))
    })
    await waitFor(() => {
      const src = within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
      expect(src).toContain("stills=tvdb")
      // TVDB choice ignores the saved TMDB override as its fallback.
      expect(src).toContain("still=%2Fstill-one.jpg")
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")
    // Still nothing written before Save.
    expect(screen.getByTestId("still-overrides").textContent).toBe('{"1:1":"/still-two.jpg"}')

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-save"))
    })
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("0")
  })

  it("still opens the studio for non-standard episode ordering, with an honest numbering note", async () => {
    // TVDB/AniZip orderings expose no original TMDB S:E: stills resolve by the
    // standard version of the same visible numbers, so the caveat stays. The
    // button must never be dead (click no-op); the note lives in the studio.
    const fetchMock = mockFetch()
    renderWithCtx(
      <>
        <EpisodePreview />
        <EditorKnobs />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("knob-anizip-order"))
    })
    await settlePreviewFetch(fetchMock, 2)

    const expand = entryButton()
    expect(expand).not.toBeDisabled()
    act(() => {
      fireEvent.click(expand)
    })

    const dialog = await screen.findByTestId("episode-browser-dialog")
    expect(within(dialog).getByTestId("episode-studio-numbering-note")).toBeInTheDocument()
    expect(expand).toHaveAttribute("aria-expanded", "true")
  })

  it("uses the original TMDB S:E for Episode Group stills and hides the numbering note", async () => {
    // Episode Groups carry the original TMDB season/episode of each remapped
    // row: stills come from that episode, so the caveat no longer applies.
    const REMAPPED_STILLS = {
      id: 280001,
      stills: [{ file_path: "/orig-part.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 8 }],
    }
    const remappedPayload = {
      videos: [],
      seasons: [
        {
          season: 1,
          name: "Parte 1",
          episodes: [
            { id: 7001, name: "Episodio 1", season: 1, episode: 1, stillSeason: 4, stillEpisode: 12 },
          ],
        },
      ],
      totalEpisodes: 1,
      totalSeasons: 1,
    }
    const fetchMock = mockFetch({ "4:12": REMAPPED_STILLS }, remappedPayload)
    renderWithCtx(
      <>
        <EpisodePreview />
        <EditorKnobs />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    await screen.findByTestId("episode-studio-entry")
    act(() => {
      fireEvent.click(screen.getByTestId("knob-group-order"))
    })
    await settlePreviewFetch(fetchMock, 2)

    const dialog = await openEpisodeBrowser()
    expect(within(dialog).queryByTestId("episode-studio-numbering-note")).toBeNull()

    // The left grid's first-still fallback asks TMDB for the ORIGINAL episode
    // (4:12), never the visible 1:1.
    await waitFor(() => {
      const row = within(dialog).getAllByTestId("episode-browser-episode")[0]
      expect(within(row).getByTestId("episode-row-thumb").getAttribute("src")).toBe(
        "https://image.tmdb.org/t/p/w185/orig-part.jpg",
      )
    })
    const imageUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(imageUrls.some((url) => url.includes(`/api/tmdb/${SERIES_ID}/season/4/episode/12/images`))).toBe(true)
    expect(imageUrls.some((url) => url.includes(`/api/tmdb/${SERIES_ID}/season/1/episode/1/images`))).toBe(false)

    // The center preview must use the SAME original TMDB S:E in the compositor
    // path: the route resolves the episode vote by it, and the visible group
    // pair (1:1 here) would resolve the wrong episode or fail closed (502).
    await waitFor(() => {
      const preview = within(dialog).getByTestId("episode-still-preview") as HTMLImageElement
      const src = preview.getAttribute("src") ?? ""
      expect(src).toContain(`/api/thumbnail/tv/${SERIES_ID}/season/4/episode/12`)
      expect(src).toContain("still=%2Forig-part.jpg")
    })
  })

  it("renders the empty state only when the series truly has no seasons", async () => {
    mockFetch({}, { videos: [], seasons: [], totalEpisodes: 0, totalSeasons: 0 })
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    await screen.findByText(t("ui.noEpisodes"))
    expect(screen.queryByTestId("episode-studio-entry")).toBeNull()
    expect(screen.queryByTestId("episode-still-expand")).toBeNull()
  })

  it("has no inline episode list and opens the fullscreen studio from the single entry button", async () => {
    mockFetch()
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    await screen.findByTestId("episode-studio-entry")
    const expand = entryButton()

    // The old inline season/episode column is gone: outside the studio there is
    // no season toggle, no episode row and no still grid — only one button.
    expect(screen.queryByRole("button", { name: /Season 1/ })).toBeNull()
    expect(screen.queryByText("Episode 1")).toBeNull()
    expect(screen.queryByTestId("episode-browser-season")).toBeNull()
    expect(screen.queryByTestId("episode-browser-dialog")).toBeNull()
    expect(screen.queryAllByTestId("episode-still-tile")).toHaveLength(0)
    expect(screen.getAllByTestId("episode-still-expand")).toHaveLength(1)
    expect(expand).toHaveAttribute("aria-expanded", "false")

    act(() => {
      fireEvent.click(expand)
    })

    const dialog = await screen.findByTestId("episode-browser-dialog")
    expect(expand).toHaveAttribute("aria-expanded", "true")
    // Fullscreen studio: near-full viewport panel, three panes and a batch bar.
    expect(dialog.className).toContain("w-[min(98vw")
    expect(dialog.className).toContain("h-[min(94vh")
    expect(within(dialog).getByTestId("episode-browser-seasons")).toBeInTheDocument()
    expect(within(dialog).getByTestId("episode-browser-preview")).toBeInTheDocument()
    expect(within(dialog).getByTestId("episode-browser-stills")).toBeInTheDocument()
    expect(within(dialog).getByTestId("episode-browser-panes").className).toContain("minmax(640px")
    expect(within(dialog).getByTestId("episode-studio-save")).toBeDisabled()
    expect(within(dialog).getByTestId("episode-studio-cancel")).toBeInTheDocument()

    // The opening episode's season is open by default.
    expect(within(dialog).getByTestId("episode-browser-season")).toHaveAttribute("aria-expanded", "true")

    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    const preview = within(dialog).getByTestId("episode-still-preview") as HTMLImageElement
    expect(preview.getAttribute("src")).toContain("still=%2Fstill-one.jpg")
  })

  it("labels the two bottom-bar actions distinctly (draft vs saved)", async () => {
    // Cancel discards only the staged draft; Reset-all also clears the saved
    // S:E overrides. The old generic labels hid that difference.
    mockFetch()
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    const cancel = within(dialog).getByTestId("episode-studio-cancel")
    const reset = within(dialog).getByTestId("episode-studio-reset-all")

    // The labels resolve through the NEW keys: a stale `ui.cancel` would show
    // the mocked Italian "Annulla" (different from the requested key value).
    expect(cancel.textContent).toBe(t("ui.episodeStillsCancelDraft"))
    expect(reset.textContent).toBe(t("ui.episodeStillsResetSaved"))
    expect(cancel.textContent).not.toBe(t("ui.cancel"))
    expect(reset.textContent).not.toBe(t("ui.episodeStillResetAll"))
    expect(cancel.textContent).not.toBe(reset.textContent)

    // Shipped, user-approved labels: IT translated, every other locale English.
    expect(itDict["ui.episodeStillsCancelDraft"]).toBe("Annulla bozza")
    expect(itDict["ui.episodeStillsResetSaved"]).toBe("Ripristina salvate")
    expect(enDict["ui.episodeStillsCancelDraft"]).toBe("Discard draft")
    expect(enDict["ui.episodeStillsResetSaved"]).toBe("Restore saved")
    // Distinct from the labels they replace.
    expect(itDict["ui.episodeStillsCancelDraft"]).not.toBe(itDict["ui.cancel"])
    expect(itDict["ui.episodeStillsResetSaved"]).not.toBe(itDict["ui.episodeStillResetAll"])
  })

  it("collapses and expands a season in the left pane", async () => {
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    const header = within(dialog).getByTestId("episode-browser-season")
    expect(header).toHaveAttribute("aria-expanded", "true")
    expect(within(dialog).getAllByTestId("episode-browser-episode")).toHaveLength(2)

    act(() => {
      fireEvent.click(header)
    })
    expect(header).toHaveAttribute("aria-expanded", "false")
    expect(within(dialog).queryAllByTestId("episode-browser-episode")).toHaveLength(0)
    // The selected episode (and its still variants) stays in the other panes.
    expect(within(dialog).getByTestId("episode-browser-stills")).toBeInTheDocument()

    act(() => {
      fireEvent.click(header)
    })
    expect(header).toHaveAttribute("aria-expanded", "true")
    expect(within(dialog).getAllByTestId("episode-browser-episode")).toHaveLength(2)
  })

  it("stages stills without persisting and saves every staged episode in one save", async () => {
    const saveConfig = vi.fn(async () => true)
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <StillOverrideProbe />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key", saveConfig },
    )

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })

    // Stage E1 — the preview follows the draft, but nothing is persisted.
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-two.jpg",
      )
    })
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
    expect(within(dialog).getByTestId("episode-studio-save")).toBeEnabled()
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")
    // Staging keeps the left-row indicators working: the dot appears on that
    // S:E and the cell shows the staged still as a RAW image (no recompose).
    const stagedRow = within(dialog).getAllByTestId("episode-browser-episode")[0]
    expect(within(stagedRow).getByTestId("episode-stage-dot")).toBeInTheDocument()
    expect(within(stagedRow).getByTestId("episode-row-thumb").getAttribute("src")).toBe(
      "https://image.tmdb.org/t/p/w185/still-two.jpg",
    )

    // Retarget E2, then stage a second override.
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-browser-episode")[1])
    })
    await waitFor(() => {
      const tiles = within(dialog).getAllByTestId("episode-still-tile")
      expect(tiles[0].querySelector("img")?.getAttribute("src")).toContain("/still-three.jpg")
    })
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-four.jpg",
      )
    })
    // Both drafts staged, still nothing written to the mapping.
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("2")

    // ONE save persists both S:E overrides.
    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-save"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("still-overrides").textContent).toBe(
        JSON.stringify({ "1:1": "/still-two.jpg", "1:2": "/still-four.jpg" }),
      )
    })
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("0")
    })
    expect(within(dialog).getByTestId("episode-studio-save")).toBeDisabled()
  })

  it("clears the staged draft with Cancel without touching the saved mapping", async () => {
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <StillOverrideProbe />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })

    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-two.jpg",
      )
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-cancel"))
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("0")
    expect(within(dialog).getByTestId("episode-studio-save")).toBeDisabled()
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-one.jpg",
      )
    })
  })

  it("discards the staged draft when the studio is closed without saving", async () => {
    mockFetch()
    renderWithCtx(
      <>
        <EpisodePreview />
        <StillOverrideProbe />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    await waitFor(() => {
      expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
        "still=%2Fstill-two.jpg",
      )
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")

    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: t("ui.close") }))
    })
    await waitFor(() => expect(screen.queryByTestId("episode-browser-dialog")).toBeNull())

    // Reopen the same row: the unsaved draft is gone.
    act(() => {
      fireEvent.click(screen.getByTestId("episode-still-expand"))
    })
    const reopened = await screen.findByTestId("episode-browser-dialog")
    await waitFor(() => {
      expect(within(reopened).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    expect(within(reopened).getByTestId("episode-studio-staged-count").textContent).toBe("0")
    expect(within(reopened).getByTestId("episode-still-preview").getAttribute("src")).toContain(
      "still=%2Fstill-one.jpg",
    )
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
  })

  it("follows the selected episode across the left list, center preview and right grid", async () => {
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    const seasons = within(dialog).getByTestId("episode-browser-seasons")
    const leftEpisodes = within(seasons).getAllByTestId("episode-browser-episode")
    expect(leftEpisodes).toHaveLength(2)
    expect(leftEpisodes[0]).toHaveAttribute("aria-pressed", "true")

    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
      "/season/1/episode/1?",
    )

    // Selecting another episode retargets BOTH dependent panes.
    act(() => {
      fireEvent.click(leftEpisodes[1])
    })
    expect(leftEpisodes[1]).toHaveAttribute("aria-pressed", "true")
    await waitFor(() => {
      const src = within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
      expect(src).toContain("/season/1/episode/2?")
      expect(src).toContain("still=%2Fstill-three.jpg")
    })
    await waitFor(() => {
      const tiles = within(dialog).getAllByTestId("episode-still-tile")
      expect(tiles).toHaveLength(2)
      expect(tiles[0].querySelector("img")?.getAttribute("src")).toContain("/still-three.jpg")
    })
  })

  it("renders every left-grid cell with its raw still, never a composed badge", async () => {
    // The grid lists/navigates episodes: each cell shows the plain TMDB still,
    // so opening the studio never triggers one badge recomposition per cell.
    // The composed request stays in the center preview (and in /meta).
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    const rows = within(dialog).getAllByTestId("episode-browser-episode")
    expect(rows).toHaveLength(2)

    const firstThumb = within(rows[0]).getByTestId("episode-row-thumb") as HTMLImageElement
    const secondThumb = within(rows[1]).getByTestId("episode-row-thumb") as HTMLImageElement
    expect(firstThumb.getAttribute("src")).toBe("https://image.tmdb.org/t/p/w185/still-one.jpg")
    expect(secondThumb.getAttribute("src")).toBe("https://image.tmdb.org/t/p/w185/still-three.jpg")
    expect(firstThumb.getAttribute("src")).not.toContain("/api/thumbnail")
    expect(secondThumb.getAttribute("src")).not.toContain("/api/thumbnail")

    // The center preview remains the composed request /meta serves.
    expect(within(dialog).getByTestId("episode-still-preview").getAttribute("src")).toContain(
      `/api/thumbnail/tv/${SERIES_ID}/season/1/episode/1?`,
    )
  })

  it("Reset-all confirms, clears only the staged + saved S:E overrides and keeps the Miniature choices in one save", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const saveConfig = vi.fn(async () => true)
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <StillOverrideProbe />
        <ThumbnailDefaultsProbe />
        <ThumbnailKnobs />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key", saveConfig },
    )

    // Non-default space choices + one already-saved override.
    act(() => {
      fireEvent.click(screen.getByTestId("knob-custom-thumb"))
      fireEvent.click(screen.getByTestId("knob-saved-override"))
    })

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    expect(screen.getByTestId("still-overrides").textContent).toBe('{"1:1":"/still-two.jpg"}')
    // A saved override changes that cell's RAW still (no click needed), and the
    // cell never carries the composed badge request or the space choices.
    await waitFor(() => {
      const row = within(dialog).getAllByTestId("episode-browser-episode")[0]
      const src = within(row).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
      expect(src).toBe("https://image.tmdb.org/t/p/w185/still-two.jpg")
      expect(src).not.toContain("/api/thumbnail")
      expect(src).not.toContain("bstyle=")
    })

    // Stage another episode: the draft must be discarded by Reset-all too.
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-browser-episode")[1])
    })
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-reset-all"))
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId("still-overrides").textContent).toBe("{}")
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("0")
    // Reset-all restores the EPISODE IMAGES only: the space Miniature visual
    // choices are never part of the reset and stay exactly as configured.
    expect(JSON.parse(screen.getByTestId("thumbnail-defaults").textContent ?? "{}")).toEqual({
      style: "branded",
      anchor: "br",
      ox: 12,
      oy: -8,
      scale: 150,
      blur: true,
      source: "tmdb",
    })
    await waitFor(() => {
      const rows = within(dialog).getAllByTestId("episode-browser-episode")
      const first = within(rows[0]).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
      const second = within(rows[1]).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
      // Episode defaults are restored (raw stills, no composed badge request)...
      expect(first).toBe("https://image.tmdb.org/t/p/w185/still-one.jpg")
      expect(second).toBe("https://image.tmdb.org/t/p/w185/still-three.jpg")
      expect(first).not.toContain("/api/thumbnail")
      expect(second).not.toContain("/api/thumbnail")
    })
  })

  it("does nothing when Reset-all is not confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const saveConfig = vi.fn(async () => true)
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    renderWithCtx(
      <>
        <EpisodePreview />
        <StillOverrideProbe />
        <ThumbnailDefaultsProbe />
        <ThumbnailKnobs />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key", saveConfig },
    )

    act(() => {
      fireEvent.click(screen.getByTestId("knob-custom-thumb"))
      fireEvent.click(screen.getByTestId("knob-saved-override"))
    })
    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")

    act(() => {
      fireEvent.click(within(dialog).getByTestId("episode-studio-reset-all"))
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(saveConfig).not.toHaveBeenCalled()
    expect(screen.getByTestId("still-overrides").textContent).toBe('{"1:1":"/still-two.jpg"}')
    expect(within(dialog).getByTestId("episode-studio-staged-count").textContent).toBe("1")
    expect(JSON.parse(screen.getByTestId("thumbnail-defaults").textContent ?? "{}")).toEqual({
      style: "branded",
      anchor: "br",
      ox: 12,
      oy: -8,
      scale: 150,
      blur: true,
      source: "tmdb",
    })
  })

  it("updates the open preview when the space Miniature defaults change (branded + bottom-right)", async () => {
    mockFetch()
    function ThumbnailDefaults() {
      const ed = usePosterEditor()
      return (
        <button
          type="button"
          data-testid="choose-branded-br"
          onClick={() => {
            ed.setThumbnailBadgeStyle("branded")
            ed.setThumbnailBadgeAnchor("br")
          }}
        >
          choose
        </button>
      )
    }
    renderWithCtx(
      <>
        <EpisodePreview />
        <ThumbnailDefaults />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })

    act(() => {
      fireEvent.click(screen.getByTestId("choose-branded-br"))
    })

    await waitFor(() => {
      const src = within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
      expect(src).toContain("bstyle=branded")
      expect(src).toContain("anchor=br")
    })

    // Persistence is GLOBAL (space defaults, here localStorage): there is no
    // per-title thumbnail field in the mapping, so a reload rehydrates the
    // same choice for every title instead of freezing it on this one.
    await waitFor(() => {
      const stored = localStorage.getItem(defaultsStorageKey()) ?? ""
      expect(stored).toContain('"thumbnailBadgeStyle":"branded"')
      expect(stored).toContain('"thumbnailAnchor":"br"')
    })
  })

  it("a manual still pick pins the title when daily rotation is ON (preview follows the click)", async () => {
    mockFetch()
    function RotationOn() {
      const ed = usePosterEditor()
      return <button type="button" data-testid="rotation-on" onClick={() => ed.setDefaultThumbnailRotation(true)}>on</button>
    }
    renderWithCtx(
      <>
        <EpisodePreview />
        <RotationOn />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )
    act(() => {
      fireEvent.click(screen.getByTestId("rotation-on"))
    })
    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    const before = within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
    expect(before).toContain("rotate=1")

    act(() => {
      fireEvent.click(within(dialog).getAllByTestId("episode-still-tile")[1])
    })

    const after = within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
    expect(after).not.toContain("rotate=1")
    expect(after).not.toBe(before)
  })

  it("fills the left grid with each episode's first still by default (no manual select)", async () => {
    // Real payloads can lack a TMDB thumbnail on episodes: the grid must not
    // stay a placeholder until the user selects the row. The first still of
    // each expanded episode is fetched lazily and shown as its raw still.
    const payload = {
      videos: [],
      seasons: [
        {
          season: 1,
          name: "Season 1",
          episodes: [
            { id: 1001, name: "Episode 1", season: 1, episode: 1 },
            { id: 1002, name: "Episode 2", season: 1, episode: 2 },
          ],
        },
      ],
      totalEpisodes: 2,
      totalSeasons: 1,
    }
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, payload)
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      const rows = within(dialog).getAllByTestId("episode-browser-episode")
      expect(rows).toHaveLength(2)
      const first = within(rows[0]).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
      const second = within(rows[1]).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
      expect(first).toBe("https://image.tmdb.org/t/p/w185/still-one.jpg")
      expect(second).toBe("https://image.tmdb.org/t/p/w185/still-three.jpg")
    })
  })

  it("renders the saved badge-stack scale in the studio center preview and follows it live, while grid cells stay raw", async () => {
    // The studio used to render at the fixed 100 while /meta followed the
    // saved `thumbnailBadgeScale`: the preview must be the SAME request.
    mockFetch({ "1:1": STILLS, "1:2": TWO_STILLS }, TWO_EPISODE_PAYLOAD)
    function ThumbnailScale() {
      const ed = usePosterEditor()
      return (
        <button
          type="button"
          data-testid="choose-scale-150"
          onClick={() => ed.setThumbnailBadgeScale(150)}
        >
          scale
        </button>
      )
    }
    renderWithCtx(
      <>
        <EpisodePreview />
        <ThumbnailScale />
      </>,
      { selected: selectedSeries(), tmdbKey: "test-key" },
    )

    const dialog = await openEpisodeBrowser()
    await waitFor(() => {
      expect(within(dialog).getAllByTestId("episode-still-tile")).toHaveLength(2)
    })
    const previewSrc = () =>
      within(dialog).getByTestId("episode-still-preview").getAttribute("src") ?? ""
    // Fresh space: the renderer default 100 is explicit (same bytes as absent).
    expect(previewSrc()).toContain("&bscale=100&")

    act(() => {
      fireEvent.click(screen.getByTestId("choose-scale-150"))
    })

    await waitFor(() => expect(previewSrc()).toContain("&bscale=150&"))
    // Grid cells are raw stills: the space scale never triggers a per-cell
    // composed request (no badge regeneration while navigating the list).
    await waitFor(() => {
      const rows = within(dialog).getAllByTestId("episode-browser-episode")
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        const src = within(row).getByTestId("episode-row-thumb").getAttribute("src") ?? ""
        expect(src).toContain("https://image.tmdb.org/t/p/w185/")
        expect(src).not.toContain("/api/thumbnail")
        expect(src).not.toContain("bscale=")
      }
    })
  })

  it("shows a graceful empty state when the episode has no stills", async () => {
    mockFetch({ "1:1": { id: 1, stills: [] } })
    renderWithCtx(<EpisodePreview />, {
      selected: selectedSeries(),
      tmdbKey: "test-key",
    })

    const dialog = await openEpisodeBrowser()

    await waitFor(() => {
      expect(within(dialog).getByText(t("ui.episodeStillPickerEmpty"))).toBeInTheDocument()
    })
    expect(within(dialog).queryByTestId("episode-still-preview")).toBeNull()
    expect(within(dialog).getByText(t("ui.noResults"))).toBeInTheDocument()
  })
})
