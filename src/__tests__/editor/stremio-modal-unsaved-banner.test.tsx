/**
 * "Test Stremio URL" modal — unsaved-changes warning coverage.
 *
 * The modal shows the SAVED poster (the server resolves the mapping), so any
 * unsaved per-title change that moves pixels must be announced. The warning
 * was wired to gradient+artwork only: a badge geometry/per-item/structure
 * change (all of them carried by `isMappingDirty`) shipped silently. These
 * tests drive the REAL modal (provider + EditView) and assert the warning for
 * the mapping-only case while the gradient case keeps working.
 */
import { useEffect } from "react"
import { render, act, waitFor, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { SearchResult, TMDBImage } from "@/lib/types"
import { t } from "@/lib/i18n"
import EditView from "@/components/EditView"

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  useEffect(() => {
    ctx = v
    ed = e
  })
  return null
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

function detailsFixture() {
  return {
    genres: [{ id: 18, name: "Drama" }],
    voteAverage: 8.2,
    voteCount: 120,
    status: null,
    type: null,
    release_date: "2024-03-01",
    first_air_date: null,
    last_air_date: null,
    next_episode_to_air: null,
    number_of_seasons: null,
    number_of_episodes: null,
    title: "Alpha",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
  }
}

function mappingPayload() {
  return {
    tmdbId: ITEM_A.id,
    mediaType: ITEM_A.media_type,
    title: ITEM_A.title,
    posterPath: "/clean-101.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    qualityBadgeScale: 125,
    updatedAt: new Date().toISOString(),
  }
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url)
      const method = (init?.method ?? "GET").toUpperCase()
      if (u.includes("/api/mappings") && method === "GET" && !u.includes("/api/mappings/")) {
        return okJson({ mappings: [mappingPayload()] })
      }
      if (u.includes("/api/mappings")) return okJson({})
      if (u.includes("/meta/")) return okJson({ meta: { poster: "https://cdn.test/api/poster/movie/101?rv=x" } })
      if (u.includes("/api/tmdb/101/details")) return okJson(detailsFixture())
      if (u.includes("/api/tmdb/101/images")) {
        // No logo, no backdrop: the AUTO selections must not differ from the
        // saved mapping, otherwise the baseline is artwork-dirty and the
        // warning would show for an unrelated reason.
        return okJson({
          posters: [img("/clean-101.jpg", null)],
          logos: [],
          backdrops: [img("/bd-101.jpg", null)],
        })
      }
      return okJson({})
    }),
  )
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

async function openSavedTitle() {
  render(
    <ThemeProvider>
      <PictoriumRoot>
        <Probe />
        <EditView />
      </PictoriumRoot>
    </ThemeProvider>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await waitFor(() => expect(ed!.defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await act(async () => { ctx!.navigateToPoster(ITEM_A) })
  await flush()
  await waitFor(() => expect(ed!.qualityBadgeScale).toBe(125), { timeout: 3000 })
}

/**
 * Opens the modal and waits for the server-resolved (saved) poster URL.
 * Returns the modal scope: the editor has its own inline "unsaved" banner, so
 * the assertion must be made inside the dialog, never on the whole tree.
 */
async function openStremioModal(): Promise<HTMLElement> {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: t("ui.testStremioUrl") }))
  await waitFor(() => expect(ctx!.stremioPreviewUrl).toBeTruthy(), { timeout: 3000 })
  await flush()
  return screen.getByRole("dialog", { name: "Stremio" })
}

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Stremio modal unsaved-changes warning", () => {
  it("warns for a badge geometry change that is not a gradient/artwork edit", async () => {
    await openSavedTitle()
    // Mapping-only change: `isMappingDirty` sees it, gradient/artwork do not.
    await act(async () => { ed!.setQualityBadgeScale(160) })
    await flush(2)

    const modal = await openStremioModal()

    expect(within(modal).getByText(t("ui.unsavedChanges"))).toBeInTheDocument()
    // The save affordances of the modal stay reachable (contract unchanged).
    expect(within(modal).getByRole("button", { name: t("ui.savePoster") })).toBeInTheDocument()
    expect(within(modal).getByRole("button", { name: t("ui.saveCoverOnly") })).toBeInTheDocument()
  })

  it("still warns for a gradient change (previous behaviour preserved)", async () => {
    await openSavedTitle()
    await act(async () => { ed!.setGradientHeight(ed!.gradientHeight + 12) })
    await flush(2)

    const modal = await openStremioModal()

    expect(within(modal).getByText(t("ui.unsavedChanges"))).toBeInTheDocument()
  })
})
