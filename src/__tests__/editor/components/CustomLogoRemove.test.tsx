import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import EditView from "@/components/EditView"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { loadCustomLogoTiles, storeCustomLogoTiles } from "@/lib/custom-tiles-store"
import type { Mapping, SearchResult, TMDBImage } from "@/lib/types"

const selected: SearchResult = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  name: "Fight Club",
  poster_path: "/abc.jpg",
}
const REMOVED = "https://i.imgur.com/logo-removed.png"
const OTHER = "https://i.imgur.com/logo-other.png"

function logoTile(url: string): TMDBImage {
  return { file_path: url, iso_639_1: null, vote_average: 0, width: 400, height: 200 }
}

function mappingWithLogo(logoPath: string | null): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: new Date().toISOString(),
    customPosterUrl: null,
  }
}

function okJson(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

beforeEach(() => {
  localStorage.clear()
})

/**
 * Real EditView removal: the saved custom logo is cleared server-side, the
 * provider map refreshes via the REAL loadMappings boundary, and only then
 * does the REAL EditView onRemove run — the removed URL must leave the
 * session tiles (so the next Save cannot resurrect it) and the live
 * selection must fall back without touching another selection.
 */
function renderRealEditor(opts: {
  selectLogo: (logo: TMDBImage) => Promise<void>
  initialMap: Map<string, Mapping>
}) {
  const puts: Array<{ url: string; body: string }> = []
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/api/mappings/") && (init?.method ?? "GET") === "PUT") {
      puts.push({ url, body: String(init?.body ?? "") })
      return okJson({ ok: true })
    }
    // PosterEditorProvider defaults and any other editor fetch: inert.
    return okJson({})
  }) as unknown as typeof fetch

  function Host() {
    const [map, setMap] = useState(opts.initialMap)
    const loadMappings = async () => {
      // Real post-PUT refresh: the saved mapping no longer carries the logo.
      setMap(new Map([["movie:550", mappingWithLogo(null)]]))
    }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider
            value={{
              ...MOCK_CTX,
              selected,
              posters: [],
              previewPoster: null,
              logos: [],
              selectedLogo: logoTile(REMOVED),
              selectLogo: opts.selectLogo,
              removeLogo: vi.fn(async () => {}),
              mappingsMap: map,
              loadMappings,
            }}
          >
            <EditView />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host />)
  return { ...view, puts }
}

function expectGridTile(url: string, present: boolean) {
  const imgs = Array.from(document.querySelectorAll("img"))
  const found = imgs.some((img) => img.getAttribute("src") === url)
  expect(found, `expected grid tile ${url} present=${present}`).toBe(present)
}

describe("custom logo removal (real EditView, after loadMappings)", () => {
  it("clears the removed saved URL from session tiles and falls back when active", async () => {
    const user = userEvent.setup()
    // Session copy holds the removed URL (unsaved tile) alongside another tile.
    storeCustomLogoTiles("movie:550", [logoTile(REMOVED), logoTile(OTHER)])
    const selectLogo = vi.fn<(logo: TMDBImage) => Promise<void>>(async () => {})
    const { puts } = renderRealEditor({
      selectLogo,
      initialMap: new Map([["movie:550", mappingWithLogo(REMOVED)]]),
    })

    await waitFor(() => expectGridTile(REMOVED, true))
    expectGridTile(OTHER, true)

    // The import box renders collapsed in the real editor: open it first.
    await user.click(screen.getByRole("button", { name: "ui.customLogoTitle" }))
    await user.click(screen.getByRole("button", { name: /customLogoRemove/ }))

    // Server-side clear happened first.
    await waitFor(() => {
      expect(puts.length).toBeGreaterThan(0)
      expect(puts[0].url).toContain("/api/mappings/movie:550")
      expect(JSON.parse(puts[0].body)).toEqual({ logoPath: null })
    })
    // After the real loadMappings refresh + real onRemove: the saved URL is
    // gone from the session copy (next Save cannot resurrect it) and the
    // live selection fell back to the remaining custom tile.
    await waitFor(() => expectGridTile(REMOVED, false))
    expectGridTile(OTHER, true)
    expect(loadCustomLogoTiles("movie:550")).toEqual([logoTile(OTHER)])
    await waitFor(() =>
      expect(selectLogo).toHaveBeenCalledWith(expect.objectContaining({ file_path: OTHER })),
    )
  })
})
