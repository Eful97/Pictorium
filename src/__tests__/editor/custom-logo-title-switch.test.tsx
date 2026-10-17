import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import EditView from "@/components/EditView"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { loadCustomLogoTiles, storeCustomLogoTiles } from "@/lib/custom-tiles-store"
import type { SearchResult, TMDBImage } from "@/lib/types"

function tile(url: string): TMDBImage {
  return { file_path: url, iso_639_1: null, vote_average: 0, width: 400, height: 200 }
}

const TILE_A = "https://i.imgur.com/logo-a.png"
const TILE_B = "https://i.imgur.com/logo-b.png"
const MOVIE_TILE = "https://i.imgur.com/movie-logo.png"
const TV_TILE = "https://i.imgur.com/tv-logo.png"

function asSelected(id: number, mediaType: "movie" | "tv", title: string): SearchResult {
  return { id, media_type: mediaType, title, name: title, poster_path: "/x.jpg" }
}

const SEL_A = asSelected(550, "movie", "Alpha")
const SEL_B = asSelected(551, "movie", "Beta")
const SEL_MOVIE_550 = asSelected(550, "movie", "Movie 550")
const SEL_TV_550 = asSelected(550, "tv", "TV 550")

/** Same mount, switchable provider value: mirrors opening another title in
 *  the same session (real EditView + real title-key/store effects). */
function renderSwitchableTitle(first: Record<string, unknown>) {
  function Host({ over }: { over: Record<string, unknown> }) {
    const value = { ...MOCK_CTX, ...over }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={value}>
            <EditView />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host over={first} />)
  return {
    ...view,
    show: (over: Record<string, unknown>) => view.rerender(<Host over={over} />),
  }
}

function baseOver(selected: SearchResult): Record<string, unknown> {
  return {
    selected,
    posters: [],
    previewPoster: null,
    logos: [],
    selectedLogo: null,
    selectLogo: vi.fn(async () => {}),
    removeLogo: vi.fn(async () => {}),
    mappingsMap: new Map(),
    loadMappings: vi.fn(async () => {}),
  }
}

function expectTileVisible(url: string) {
  const imgs = document.querySelectorAll("img")
  const found = Array.from(imgs).some((img) => img.getAttribute("src") === url)
  expect(found, `expected custom tile ${url} in the real EditView grid`).toBe(true)
}

function expectTileAbsent(url: string) {
  const imgs = document.querySelectorAll("img")
  const found = Array.from(imgs).some((img) => img.getAttribute("src") === url)
  expect(found, `expected custom tile ${url} to be gone from the real EditView grid`).toBe(false)
}

beforeEach(() => {
  localStorage.clear()
})

describe("custom logo title-switch storage (real EditView)", () => {
  it("A->B->A keeps each title's stored tiles (no stale overwrite)", async () => {
    storeCustomLogoTiles("movie:550", [tile(TILE_A)])
    storeCustomLogoTiles("movie:551", [tile(TILE_B)])

    const { show, unmount } = renderSwitchableTitle(baseOver(SEL_A))
    await waitFor(() => expectTileVisible(TILE_A))

    // Switch title through the REAL EditView: the store effect must not run
    // in the same commit with the NEW key and the OLD tiles (skip-flag
    // ownership), so B's storage survives the switch.
    show(baseOver(SEL_B))
    await waitFor(() => expectTileVisible(TILE_B))
    expectTileAbsent(TILE_A)
    expect(loadCustomLogoTiles("movie:551")).toEqual([tile(TILE_B)])

    // Coming back to A still reads A's tiles, and A's storage was never
    // clobbered by B's tiles while B was open.
    show(baseOver(SEL_A))
    await waitFor(() => expectTileVisible(TILE_A))
    expectTileAbsent(TILE_B)
    expect(loadCustomLogoTiles("movie:550")).toEqual([tile(TILE_A)])
    unmount()
    expect(screen.queryByTestId("custom-logo-url")).toBeNull()
  })

  it("movie and tv with the same numeric id never share tiles across a switch", async () => {
    storeCustomLogoTiles("movie:550", [tile(MOVIE_TILE)])
    storeCustomLogoTiles("tv:550", [tile(TV_TILE)])

    const { show, unmount } = renderSwitchableTitle(baseOver(SEL_MOVIE_550))
    await waitFor(() => expectTileVisible(MOVIE_TILE))

    show(baseOver(SEL_TV_550))
    await waitFor(() => expectTileVisible(TV_TILE))
    expectTileAbsent(MOVIE_TILE)
    expect(loadCustomLogoTiles("movie:550")).toEqual([tile(MOVIE_TILE)])
    expect(loadCustomLogoTiles("tv:550")).toEqual([tile(TV_TILE)])
    unmount()
  })
})
