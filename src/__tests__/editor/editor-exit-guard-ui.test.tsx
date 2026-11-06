/**
 * Per-title editor exit + destructive Remove confirmation (F2/F10).
 *
 * Leaving the editor must stay immediate (entering/exiting speed): Back, the
 * header logo and SPA Back clear the open title with no dialog, dirty or clean.
 * These tests drive the REAL EditView (provider included) to prove there is no
 * false prompt; Remove keeps its explicit two-step confirmation.
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

function mappingPayload(legacyQualityOffsets = false) {
  return {
    tmdbId: ITEM_A.id,
    mediaType: ITEM_A.media_type,
    title: ITEM_A.title,
    posterPath: "/clean-101.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    qualityBadgeScale: 125,
    // Real saves persist the portrait default offsets too: a mapping written
    // by the app never looks dirty just because the live editor starts from
    // the format defaults (-4/+6 portrait). Older mappings have no keys at
    // all; those must fall back to the shape defaults as well (Task 4b).
    ...(legacyQualityOffsets ? {} : { qualityBadgeOffsetX: -4, qualityBadgeOffsetY: 6 }),
    updatedAt: new Date().toISOString(),
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function installFetchMock(options: { legacyQualityOffsets?: boolean } = {}) {
  const payload = mappingPayload(options.legacyQualityOffsets === true)
  fetchMock = vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url)
    const method = (init?.method ?? "GET").toUpperCase()
    if (u.includes("/api/mappings") && method === "DELETE") return okJson({})
    if (u.includes("/api/mappings") && method === "GET" && !u.includes("/api/mappings/")) {
      return okJson({ mappings: [payload] })
    }
    if (u.includes("/api/mappings")) return okJson({})
    if (u.includes("/meta/")) return okJson({ meta: { poster: "https://cdn.test/api/poster/movie/101?rv=x" } })
    if (u.includes("/api/tmdb/101/details")) return okJson(detailsFixture())
    if (u.includes("/api/tmdb/101/images")) {
      return okJson({
        posters: [img("/clean-101.jpg", null)],
        logos: [],
        backdrops: [img("/bd-101.jpg", null)],
      })
    }
    return okJson({})
  })
  vi.stubGlobal("fetch", fetchMock)
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

function deleteCalls() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes("/api/mappings/") &&
      ((init as { method?: string } | undefined)?.method ?? "GET").toUpperCase() === "DELETE",
  )
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

describe("per-title editor exits immediately", () => {
  it("clean draft: Back exits immediately without a dialog", async () => {
    await openSavedTitle()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: t("ui.back") }))
    await flush(2)

    expect(screen.queryByTestId("editor-dirty-dialog")).toBeNull()
    expect(ctx!.selected).toBeNull()
  })

  it("dirty draft: Back exits immediately without a dialog", async () => {
    await openSavedTitle()
    const user = userEvent.setup()
    await act(async () => { ed!.setQualityBadgeScale(160) })
    await flush(2)

    await user.click(screen.getByRole("button", { name: t("ui.back") }))
    await flush(2)

    expect(screen.queryByTestId("editor-dirty-dialog")).toBeNull()
    expect(ctx!.selected).toBeNull()
  })

  it("dirty draft: the header logo also exits immediately", async () => {
    await openSavedTitle()
    const user = userEvent.setup()
    await act(async () => { ed!.setQualityBadgeScale(160) })
    await flush(2)

    await user.click(screen.getAllByAltText("Pictorium")[0])
    await flush(2)

    expect(screen.queryByTestId("editor-dirty-dialog")).toBeNull()
    expect(ctx!.selected).toBeNull()
  })

  it("dirty draft: SPA browser back navigates immediately (no dialog)", async () => {
    await openSavedTitle()
    await act(async () => { ed!.setQualityBadgeScale(160) })
    await flush(2)

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { view: "search" } }))
    })
    await flush(2)

    // No guard is registered by the editor: the SPA transition applies and the
    // open title is cleared with no prompt.
    expect(screen.queryByTestId("editor-dirty-dialog")).toBeNull()
    expect(ctx!.selected).toBeNull()
    expect(ctx!.view).toBe("search")
  })

  it("legacy mapping without quality offsets: clean Back exits immediately", async () => {
    // Mappings saved before the offsets were frozen have no keys: the live
    // editor opens at the portrait defaults (-4/+6), so there is nothing
    // unsaved and Back must not prompt.
    installFetchMock({ legacyQualityOffsets: true })
    await openSavedTitle()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: t("ui.back") }))
    await flush(2)

    expect(screen.queryByTestId("editor-dirty-dialog")).toBeNull()
    expect(ctx!.selected).toBeNull()
  })
})

describe("Remove mapping confirmation", () => {
  it("cancel keeps the selection and the saved mapping (no DELETE)", async () => {
    await openSavedTitle()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: t("ui.remove") }))
    const dialog = await screen.findByRole("dialog", { name: t("ui.confirmDelete") })
    await user.click(within(dialog).getByRole("button", { name: t("ui.cancelAction") }))
    await flush(2)

    expect(screen.queryByRole("dialog", { name: t("ui.confirmDelete") })).toBeNull()
    expect(ctx!.selected?.id).toBe(ITEM_A.id)
    expect(ctx!.mappings).toHaveLength(1)
    expect(deleteCalls()).toHaveLength(0)
  })

  it("explicit confirm deletes the mapping and leaves the editor", async () => {
    await openSavedTitle()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: t("ui.remove") }))
    const dialog = await screen.findByRole("dialog", { name: t("ui.confirmDelete") })
    await user.click(within(dialog).getByRole("button", { name: t("ui.delete") }))
    await flush(2)

    expect(deleteCalls()).toHaveLength(1)
    expect(ctx!.selected).toBeNull()
    expect(ctx!.mappings).toHaveLength(0)
  })
})
