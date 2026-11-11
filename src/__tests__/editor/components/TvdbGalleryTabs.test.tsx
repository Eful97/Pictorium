import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { PosterOptions } from "@/components/PosterOptions"
import { LogoOptions } from "@/components/LogoOptions"
import { BackdropOptions } from "@/components/BackdropOptions"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { usePosterFit } from "@/lib/usePosterFit"
import { __resetTvdbArtworksClientCache } from "@/lib/useTvdbArtworks"
import type { SearchResult, TMDBImage } from "@/lib/types"

vi.mock("@/lib/usePosterFit", () => ({ usePosterFit: vi.fn() }))
const fitMock = vi.mocked(usePosterFit)

const SELECTED = { id: 7, media_type: "movie", title: "Test", poster_path: "/t.jpg" } as unknown as SearchResult

const IMG = (p: string) => `https://artworks.thetvdb.com${p}`
const POSTER_1 = IMG("/banners/v4/poster/1.jpg")
const POSTER_2 = IMG("/banners/v4/poster/2.jpg")
const BACKDROP_1 = IMG("/banners/v4/fanart/1.jpg")
const LOGO_1 = IMG("/banners/v4/clearlogo/1.png")
const LOGO_1_THUMB = IMG("/banners/v4/clearlogo/1_t.png")

function galleryPayload(over: Record<string, unknown> = {}) {
  return {
    posters: [
      { url: POSTER_1, thumbnail: null, language: "eng", width: 680, height: 1000, includesText: false, score: 7.5, source: "tvdb", type: 14 },
      { url: POSTER_2, thumbnail: null, language: null, width: 680, height: 1000, score: 3, source: "tvdb", type: 14 },
    ],
    backdrops: [
      { url: BACKDROP_1, thumbnail: null, language: "ita", width: 1920, height: 1080, score: 5, source: "tvdb", type: 15 },
    ],
    logos: [
      { url: LOGO_1, thumbnail: LOGO_1_THUMB, language: "eng", width: 800, height: 310, score: 6, source: "tvdb", type: 25 },
    ],
    source: "tvdb",
    ...over,
  }
}

const okRes = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload })
const errRes = (status: number, payload: unknown) => ({ ok: false, status, json: async () => payload })

function mockTvdbFetch(tvdbImpl: (url: string) => Promise<unknown> | unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(((url: unknown) => {
    if (String(url).includes("/api/tvdb/")) return Promise.resolve(tvdbImpl(String(url)))
    return Promise.resolve(errRes(404, {}))
  }) as unknown as typeof fetch)
}

function tvdbCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/tvdb/"))
}

const mockPosters: TMDBImage[] = [
  { file_path: "/clean1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
  { file_path: "/en1.jpg", iso_639_1: "en", vote_average: 0, width: 1000, height: 1500 },
]

const mockBackdrops: TMDBImage[] = [
  { file_path: "/bd1.jpg", iso_639_1: null, vote_average: 0, width: 1920, height: 1080 },
]

function BackdropShell({ backdrops, onSelect, onClear }: {
  backdrops: TMDBImage[]
  onSelect: (img: TMDBImage) => void
  onClear: () => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const ctx = { ...MOCK_CTX, selected: SELECTED, mappingsMap: new Map() }
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={ctx}>
          <BackdropOptions
            backdrops={backdrops}
            backdropActivePath={active}
            selectBackdrop={(i) => { setActive(i.file_path); onSelect(i) }}
            clearBackdrop={() => { setActive(null); onClear() }}
          />
        </PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

beforeEach(() => {
  __resetTvdbArtworksClientCache()
  fitMock.mockReturnValue({ bestFitPath: null, results: [], loading: false, error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PosterOptions TVDB tab", () => {
  it("hides the TVDB tab without a selected title", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.queryByTestId("tvdb-posters-panel")).toBeNull()
    expect(screen.queryByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ })).toBeNull()
  })

  it("shows the TVDB tab lazily and selects a tile (stages portrait custom URL, no autosave)", async () => {
    const u = userEvent.setup()
    const onSelect = vi.fn()
    const fetchSpy = mockTvdbFetch(() => okRes(galleryPayload()))
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={onSelect} />,
      { selected: SELECTED },
    )
    expect(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ })).toBeInTheDocument()
    // Lazy: no TVDB request before the tab opens.
    expect(tvdbCalls(fetchSpy)).toHaveLength(0)

    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").querySelectorAll("button img")).toHaveLength(2)
    })
    const panel = screen.getByTestId("tvdb-posters-panel")
    const srcs = Array.from(panel.querySelectorAll("button img")).map((img) => img.getAttribute("src"))
    expect(srcs).toContain(POSTER_1)
    expect(srcs).toContain(POSTER_2)
    // Honest language labels (raw 3-letter code, unknown stays unknown) + provider badge.
    expect(panel.textContent).toContain("ENG")
    expect(panel.textContent).toContain("ui.fanartLangUnknown")
    expect(panel.textContent).toContain("ui.tvdbTitle")
    // Opening the tab never auto-selects.
    expect(onSelect).not.toHaveBeenCalled()

    const tiles = panel.querySelectorAll("button")
    await u.click(tiles[0])
    // Selection stages exactly one portrait tile: absolute TVDB URL with the
    // honest textness flag (POSTER_1 is genuinely textless, so iso null) —
    // the existing save split persists it as customPosterUrl with the TMDB
    // fallback (no new schema, no autosave here: single onSelect call).
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: POSTER_1, iso_639_1: null }),
    )
  })

  it("highlights the current selection by absolute URL across source switches", async () => {
    const u = userEvent.setup()
    mockTvdbFetch(() => okRes(galleryPayload()))
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={POSTER_2} lang="it" selectPoster={() => {}} />,
      { selected: SELECTED },
    )
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").querySelectorAll("button img")).toHaveLength(2)
    })
    // The externally selected URL (e.g. reloaded mapping) highlights without
    // needing membership in any TMDB array.
    const active = screen.getByTestId("tvdb-posters-panel").querySelector("button.poster-tile-active img")
    expect(active?.getAttribute("src")).toBe(POSTER_2)
  })

  it("shows honest empty / not-configured / unavailable states with retry", async () => {
    const u = userEvent.setup()
    mockTvdbFetch(() => okRes(galleryPayload({ posters: [] })))
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />,
      { selected: SELECTED },
    )
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").textContent).toContain("ui.tvdbEmptyPosters")
    })
  })

  it("shows not-configured on 503 without pretending empty", async () => {
    const u = userEvent.setup()
    mockTvdbFetch(() => errRes(503, { error: "nope", code: "tvdb_not_configured" }))
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />,
      { selected: SELECTED },
    )
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").textContent).toContain("ui.tvdbNotConfigured")
    })
  })

  it("shows unavailable on 502 and retries on demand", async () => {
    const u = userEvent.setup()
    const fetchSpy = mockTvdbFetch(() => errRes(502, { error: "down", code: "tvdb_unavailable" }))
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />,
      { selected: SELECTED },
    )
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").textContent).toContain("ui.tvdbUnavailable")
    })
    // TMDB tiles stay intact while TVDB fails.
    expect(screen.getByTestId("tvdb-posters-panel")).toBeInTheDocument()
    fetchSpy.mockImplementation(((url: unknown) => {
      if (String(url).includes("/api/tvdb/")) return Promise.resolve(okRes(galleryPayload()))
      return Promise.resolve(errRes(404, {}))
    }) as unknown as typeof fetch)
    await u.click(screen.getByRole("button", { name: "Riprova" }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-posters-panel").querySelectorAll("button img")).toHaveLength(2)
    })
    expect(tvdbCalls(fetchSpy)).toHaveLength(2)
  })
})

describe("LogoOptions TVDB tab", () => {
  const mockLogos: TMDBImage[] = [
    { file_path: "/logo-tmdb.png", iso_639_1: null, vote_average: 0, width: 800, height: 310 },
  ]

  it("shows source tabs only with a selected title (TMDB UI unchanged otherwise)", () => {
    renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={() => {}} removeLogo={() => {}} />)
    expect(screen.queryByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ })).toBeNull()
    expect(screen.queryByTestId("tvdb-logos-panel")).toBeNull()
  })

  it("selects a TVDB logo as an absolute URL (thumbnail preview, same state rules)", async () => {
    const u = userEvent.setup()
    const onSelect = vi.fn()
    const fetchSpy = mockTvdbFetch(() => okRes(galleryPayload()))
    renderWithCtx(
      <LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={onSelect} removeLogo={() => {}} />,
      { selected: SELECTED },
    )
    expect(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ })).toBeInTheDocument()
    expect(tvdbCalls(fetchSpy)).toHaveLength(0)

    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-logos-panel").querySelector(`img[src="${LOGO_1_THUMB}"]`)).not.toBeNull()
    })
    const panel = screen.getByTestId("tvdb-logos-panel")
    // Native thumbnail preview (absolute TVDB URL, no TMDB prefix concat).
    expect(panel.querySelector('button img[src^="https://"]')?.getAttribute("src")).toBe(LOGO_1_THUMB)
    expect(panel.textContent).toContain("ui.tvdbTitle")
    expect(onSelect).not.toHaveBeenCalled()

    await u.click(panel.querySelector("button")!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    // Absolute TVDB URL staged with the honest language flag (LOGO_1 has
    // unknown textness, so it stays non-clean "eng" — only includesText
    // false may read as clean); logo save is path-based either way.
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: LOGO_1, iso_639_1: "eng" }),
    )
  })

  it("reports an honest empty state per kind and highlights the selected logo", async () => {
    const u = userEvent.setup()
    mockTvdbFetch(() => okRes(galleryPayload({ logos: [] })))
    const selectedLogo: TMDBImage = { file_path: "/logo-tmdb.png", iso_639_1: null, vote_average: 0, width: 800, height: 310 }
    renderWithCtx(
      <LogoOptions logos={mockLogos} selectedLogo={selectedLogo} lang="it" selectLogo={() => {}} removeLogo={() => {}} />,
      { selected: SELECTED },
    )
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-logos-panel").textContent).toContain("ui.tvdbEmptyLogos")
    })
  })
})

describe("BackdropOptions TVDB tab", () => {
  it("selects a TVDB backdrop as an absolute URL with toggle-off (TMDB grid intact)", async () => {
    const u = userEvent.setup()
    const onSelect = vi.fn()
    const onClear = vi.fn()
    const fetchSpy = mockTvdbFetch(() => okRes(galleryPayload()))
    render(
      <BackdropShell backdrops={mockBackdrops} onSelect={onSelect} onClear={onClear} />,
    )
    expect(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ })).toBeInTheDocument()
    expect(tvdbCalls(fetchSpy)).toHaveLength(0)

    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-backdrops-panel").querySelectorAll("button img")).toHaveLength(1)
    })
    const tile = screen.getByTestId("tvdb-backdrops-panel").querySelector("button")!
    await u.click(tile)
    // Absolute TVDB URL staged via the existing backdrop state (saved as
    // backdropPath, rendered by the single poster endpoint) — and nothing
    // else: one field staged, no autosave, other formats untouched. The tile
    // keeps its honest language flag (unknown textness stays non-clean).
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: BACKDROP_1, iso_639_1: "ita" }),
    )
    expect(onClear).not.toHaveBeenCalled()
    // Toggle-off restores the automatic backdrop.
    await u.click(tile)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("keeps per-kind honesty (empty backdrops beside full posters) and TMDB on TVDB failure", async () => {
    const u = userEvent.setup()
    mockTvdbFetch(() => okRes(galleryPayload({ backdrops: [] })))
    render(<BackdropShell backdrops={mockBackdrops} onSelect={() => {}} onClear={() => {}} />)
    await u.click(screen.getByRole("button", { name: /^ui\.tvdbTitle\s*\d*$/ }))
    await waitFor(() => {
      expect(screen.getByTestId("tvdb-backdrops-panel").textContent).toContain("ui.tvdbEmptyBackdrops")
    })
    // Back to TMDB: the existing grid is untouched by the TVDB miss.
    await u.click(screen.getByRole("button", { name: /^ui\.tmdb\s*\d*$/ }))
    expect(document.querySelectorAll('img[src*="/bd1.jpg"]')).toHaveLength(1)
  })
})
