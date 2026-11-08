/**
 * Prototype gate + UI wiring for the in-app "Suggest filler correction" link.
 *
 * The component must never call the network or GitHub: it only opens a
 * prefilled public issue in a new tab on an explicit click. These tests lock:
 * - opt-in gate: hidden by default and for any non-`1` value (`0`, `true`);
 * - explicit `1`: panel, bulk bar and checkboxes are present;
 * - banner ON: known episodes default the proposal and open a URL;
 * - unknown episodes require an explicit proposal before the link enables;
 * - the attestation is checked by default (in-app = watched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { EpisodePreview } from "@/components/EpisodePreview"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { SearchResult } from "@/lib/types"

const STILLS = {
  id: 259909,
  stills: [{ file_path: "/still-one.jpg", width: 1920, height: 1080, iso_639_1: "en", vote_average: 5.3 }],
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
        {
          id: 1002,
          name: "Episode 2",
          season: 1,
          episode: 2,
          thumbnail: "https://image.tmdb.org/t/p/w500/still-one.jpg",
        },
      ],
    },
  ],
  totalEpisodes: 2,
  totalSeasons: 1,
}

/** Unique series ids: the filler lookup is memoized per S:E for the session. */
const DEFAULT_SERIES_ID = 925600
const KNOWN_SERIES_ID = 925601
const UNKNOWN_SERIES_ID = 925602
const OFF_SERIES_ID = 925603
const SOURCE_SERIES_ID = 925604
const BULK_SERIES_ID = 925605

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function mockFetch(statusesByKey: Record<string, "filler" | "manga" | "anime" | "mixed" | null> = {}) {
  const fetchMock = vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes("/api/filler-status")) {
      const parsed = new URL(value, "http://localhost")
      const tmdb = parsed.searchParams.get("tmdb")
      const season = parsed.searchParams.get("season")
      const batch = parsed.searchParams.get("episodes")
      if (batch !== null) {
        const statuses: Record<string, string | null> = {}
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
    title: "Filler Test",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    anime_ids: { kitsu: [], mal: [12345] },
  } as unknown as SearchResult
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

async function openStudio() {
  await screen.findByTestId("episode-studio-entry")
  act(() => {
    fireEvent.click(within(screen.getByTestId("episode-studio-entry")).getByTestId("episode-still-expand"))
  })
  return screen.findByTestId("episode-browser-dialog")
}

beforeEach(() => {
  localStorage.clear()
  // Opt-in gate: the panel only renders with an explicit 1. The hidden cases
  // below unset/override it; every panel test relies on this stub.
  vi.stubEnv("NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION", "1")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("Suggest filler correction", () => {
  it("is hidden without the explicit opt-in env (panel, bulk bar, checkboxes)", async () => {
    delete process.env.NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION
    mockFetch({ [`${DEFAULT_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(DEFAULT_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => {
      expect(screen.queryByTestId("filler-correction")).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId("episode-bulk-selection")).not.toBeInTheDocument()
    expect(screen.queryAllByTestId("episode-browser-select")).toHaveLength(0)
  })

  it("is absent with an explicit non-1 value (0)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION", "0")
    mockFetch({ [`${OFF_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(OFF_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => {
      expect(screen.queryByTestId("filler-correction")).not.toBeInTheDocument()
    })
  })

  it("opens a prefilled issue for a classified episode (attestation checked)", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    mockFetch({ [`${KNOWN_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(KNOWN_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })

    const panelToggle = await screen.findByTestId("filler-correction-toggle")
    act(() => {
      fireEvent.click(panelToggle)
    })
    await waitFor(() => {
      // The proposal defaults to the real current classification.
      expect(screen.getByTestId("filler-correction-proposed")).toHaveValue("filler")
    })
    expect(screen.getByTestId("filler-correction-watched")).toBeChecked()

    const open = screen.getByTestId("filler-correction-open")
    expect(open).not.toBeDisabled()
    act(() => {
      fireEvent.click(open)
    })

    expect(openSpy).toHaveBeenCalledTimes(1)
    const url = String(openSpy.mock.calls[0][0])
    const params = new URL(url).searchParams
    expect(url.startsWith("https://github.com/Eful97/pictorium-anime-filler-data/issues/new?")).toBe(true)
    expect(params.get("template")).toBe("add-series.yml")
    expect(params.get("title")).toBe("[Add series] Filler Test")
    expect(params.get("origin")).toBe("pictorium-in-app")
    expect(params.get("watched")).toBe("yes")
    const body = params.get("body")!
    expect(body).toContain("### Series title\n\nFiller Test")
    expect(body).toContain("### MyAnimeList ID (optional)\n\n12345")
    expect(body).toContain("### Filler ranges\n\n1")
    expect(body).toContain("current fill: filler")
  })

  it("requires an explicit proposal for an unknown episode before enabling", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    mockFetch()
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(UNKNOWN_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("episode-filler-unavailable")).toBeInTheDocument()
    })

    act(() => {
      fireEvent.click(screen.getByTestId("filler-correction-toggle"))
    })
    const proposed = screen.getByTestId("filler-correction-proposed")
    const open = screen.getByTestId("filler-correction-open")
    expect(proposed).toHaveValue("")
    expect(open).toBeDisabled()

    act(() => {
      fireEvent.change(proposed, { target: { value: "mixed" } })
    })
    expect(open).not.toBeDisabled()
    act(() => {
      fireEvent.click(open)
    })

    const body = new URL(String(openSpy.mock.calls[0][0])).searchParams.get("body")!
    expect(body).toContain("### Mixed ranges (optional)\n\n1")
    expect(body).toContain("current fill: unknown")
  })

  it("bulk-selects episodes and prefills compressed ranges with titles", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    mockFetch({ [`${BULK_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(BULK_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await screen.findByTestId("episode-bulk-selection")
    const checks = screen.getAllByTestId("episode-browser-select")
    expect(checks).toHaveLength(2)
    act(() => {
      fireEvent.click(checks[0])
      fireEvent.click(checks[1])
    })
    expect(screen.getByTestId("episode-select-count")).toHaveTextContent("2 selected")

    act(() => {
      fireEvent.click(screen.getByTestId("filler-correction-toggle"))
    })
    expect(await screen.findByTestId("filler-correction-bulk-summary")).toHaveTextContent(
      "2 episodes",
    )
    expect(screen.getByTestId("filler-correction-range-filler")).toHaveTextContent("none")
    // Bulk mode never inherits the single-episode current type.
    const proposed = screen.getByTestId("filler-correction-proposed")
    expect(proposed).toHaveValue("")
    const open = screen.getByTestId("filler-correction-open")
    expect(open).toBeDisabled()

    act(() => {
      fireEvent.change(proposed, { target: { value: "filler" } })
    })
    expect(screen.getByTestId("filler-correction-range-filler")).toHaveTextContent("1-2")
    expect(open).not.toBeDisabled()
    act(() => {
      fireEvent.click(open)
    })

    const body = new URL(String(openSpy.mock.calls[0][0])).searchParams.get("body")!
    expect(body).toContain("### Filler ranges\n\n1-2")
    expect(body).toContain("### Mixed ranges (optional)\n\nnone")
    expect(body).toContain("### Episode titles\n\n- S1:E1 — Episode 1\n- S1:E2 — Episode 2")
    expect(body).toContain("Origin: pictorium-in-app")
    expect(body).toContain("Watched: yes")
  })

  it("lets a per-row type override split the compressed ranges", async () => {
    mockFetch({ [`${BULK_SERIES_ID + 2}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(BULK_SERIES_ID + 2), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await screen.findByTestId("episode-bulk-selection")
    const checks = screen.getAllByTestId("episode-browser-select")
    act(() => {
      fireEvent.click(checks[0])
      fireEvent.click(checks[1])
    })
    act(() => {
      fireEvent.click(screen.getByTestId("filler-correction-toggle"))
    })
    const proposed = await screen.findByTestId("filler-correction-proposed")
    act(() => {
      fireEvent.change(proposed, { target: { value: "filler" } })
    })
    expect(screen.getByTestId("filler-correction-range-filler")).toHaveTextContent("1-2")

    const rowTypes = screen.getAllByTestId("filler-correction-row-type")
    expect(rowTypes).toHaveLength(2)
    act(() => {
      fireEvent.change(rowTypes[1], { target: { value: "mixed" } })
    })
    expect(screen.getByTestId("filler-correction-range-filler")).toHaveTextContent("1")
    expect(screen.getByTestId("filler-correction-range-mixed")).toHaveTextContent("2")
  })

  it("select all visible and clear drive the bulk selection", async () => {
    mockFetch({ [`${BULK_SERIES_ID}:1:1`]: "filler" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(BULK_SERIES_ID + 1), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await screen.findByTestId("episode-select-all-visible")
    act(() => {
      fireEvent.click(screen.getByTestId("episode-select-all-visible"))
    })
    expect(screen.getByTestId("episode-select-count")).toHaveTextContent("2 selected")
    for (const box of screen.getAllByTestId("episode-browser-select")) {
      expect(box).toBeChecked()
    }
    act(() => {
      fireEvent.click(screen.getByTestId("episode-select-clear"))
    })
    expect(screen.getByTestId("episode-select-count")).toHaveTextContent("0 selected")
    expect(screen.getByTestId("episode-select-clear")).toBeDisabled()
  })

  it("unchecking the attestation requires a clean source", async () => {
    mockFetch({ [`${SOURCE_SERIES_ID}:1:1`]: "manga" })
    renderWithCtx(
      <>
        <EpisodePreview />
        <FillerToggle />
      </>,
      { selected: selectedSeries(SOURCE_SERIES_ID), tmdbKey: "test-key" },
    )
    await openStudio()
    act(() => {
      fireEvent.click(screen.getByTestId("filler-toggle"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("filler-correction-toggle")).toBeInTheDocument()
    })
    act(() => {
      fireEvent.click(screen.getByTestId("filler-correction-toggle"))
    })
    await waitFor(() => {
      expect(screen.getByTestId("filler-correction-proposed")).toHaveValue("manga")
    })
    const open = screen.getByTestId("filler-correction-open")
    expect(open).not.toBeDisabled()

    act(() => {
      fireEvent.click(screen.getByTestId("filler-correction-watched"))
    })
    expect(screen.getByTestId("filler-correction-watched")).not.toBeChecked()
    expect(open).toBeDisabled()
    expect(screen.getByTestId("filler-correction-source")).toBeInTheDocument()

    act(() => {
      fireEvent.change(screen.getByTestId("filler-correction-source"), {
        target: { value: "Fandom XML dump (CC BY-SA; link required)" },
      })
    })
    expect(open).not.toBeDisabled()
  })
})
