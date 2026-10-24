import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor, fireEvent, screen, within } from "@testing-library/react"
import { renderWithCtx } from "@/__tests__/test-utils"
import { CatalogManagerModal } from "@/components/CatalogManagerModal"
import { CataloghiView } from "@/components/CataloghiView"
import { userFetch } from "@/lib/http"
import { useCustomCatalogs } from "@/lib/useCustomCatalogs"
import {
  DEFAULT_TOP20_MOVIE_CATALOG_ID,
  DEFAULT_TOP20_SERIES_CATALOG_ID,
  areDefaultListsDirty,
  isDefaultTop20CatalogId,
  resolveDefaultTop20Visibility,
  withoutDefaultTop20Ids,
  withoutDefaultTop20Keys,
} from "@/lib/default-lists-reset"
import type { SearchResult } from "@/lib/types"
import { PICTORIUM_CATALOGS } from "@/lib/catalog-definitions"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/CustomCatalogModal", () => ({ CustomCatalogModal: () => null }))
vi.mock("@/components/AddonCatalogModal", () => ({ AddonCatalogModal: () => null }))

const mockedUserFetch = vi.mocked(userFetch)

function memStore(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v)
    },
    raw: () => Object.fromEntries(map),
  }
}

const okGet = { ok: true, json: async () => ({}) } as unknown as Response
const okPut = (body?: unknown) =>
  ({ ok: true, status: 200, json: async () => body ?? {} }) as unknown as Response

function putBodies(): string[] {
  return mockedUserFetch.mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === "PUT")
    .map(([, init]) => String((init as RequestInit)?.body))
}

describe("default-lists-reset pure helpers", () => {
  it("factory ids match the manifest catalog definitions", () => {
    const ids = new Set(PICTORIUM_CATALOGS.map((c) => c.id))
    expect(ids.has(DEFAULT_TOP20_MOVIE_CATALOG_ID)).toBe(true)
    expect(ids.has(DEFAULT_TOP20_SERIES_CATALOG_ID)).toBe(true)
    expect(PICTORIUM_CATALOGS.find((c) => c.id === DEFAULT_TOP20_MOVIE_CATALOG_ID)?.type).toBe("movie")
    expect(PICTORIUM_CATALOGS.find((c) => c.id === DEFAULT_TOP20_SERIES_CATALOG_ID)?.type).toBe("series")
  })

  it("isDefaultTop20CatalogId only matches the two factory lists", () => {
    expect(isDefaultTop20CatalogId(DEFAULT_TOP20_MOVIE_CATALOG_ID)).toBe(true)
    expect(isDefaultTop20CatalogId(DEFAULT_TOP20_SERIES_CATALOG_ID)).toBe(true)
    expect(isDefaultTop20CatalogId("pictorium-netflix-movies")).toBe(false)
    expect(isDefaultTop20CatalogId("pictorium-anime-movies")).toBe(false)
    expect(isDefaultTop20CatalogId("pictorium-custom-movie-abc")).toBe(false)
    expect(isDefaultTop20CatalogId("pictorium-stream-netflix-IT-movies")).toBe(false)
    expect(isDefaultTop20CatalogId("")).toBe(false)
  })

  it("withoutDefaultTop20Ids drops only defaults, order preserved", () => {
    expect(
      withoutDefaultTop20Ids(["a", DEFAULT_TOP20_MOVIE_CATALOG_ID, "b", DEFAULT_TOP20_SERIES_CATALOG_ID, "c"]),
    ).toEqual(["a", "b", "c"])
    expect(withoutDefaultTop20Ids(["x", "y"])).toEqual(["x", "y"])
  })

  it("withoutDefaultTop20Keys drops only default keys, identity when absent", () => {
    const rec = { [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "R", custom: "K", [DEFAULT_TOP20_SERIES_CATALOG_ID]: "S" }
    expect(withoutDefaultTop20Keys(rec)).toEqual({ custom: "K" })
    const clean = { custom: "K" }
    expect(withoutDefaultTop20Keys(clean)).toBe(clean)
  })

  it("areDefaultListsDirty: factory clean, dirty on remove/hide/rename/custom source", () => {
    const clean = {
      disabledCatalogIds: [] as string[],
      homeDisabledCatalogIds: [] as string[],
      catalogRenames: {} as Record<string, string>,
      rankingSourceMovie: "",
      rankingSourceSeries: "",
    }
    expect(areDefaultListsDirty(clean)).toBe(false)
    // Builtin popular/trending modes are also overrides of factory charts.
    expect(areDefaultListsDirty({ ...clean, rankingSourceMovie: "jw:popular" })).toBe(true)
    expect(areDefaultListsDirty({ ...clean, rankingSourceSeries: "jw:trending" })).toBe(true)
    expect(areDefaultListsDirty({ ...clean, rankingSourceMovie: "cat_1" })).toBe(true)
    expect(
      areDefaultListsDirty({ ...clean, disabledCatalogIds: [DEFAULT_TOP20_MOVIE_CATALOG_ID] }),
    ).toBe(true)
    expect(
      areDefaultListsDirty({ ...clean, homeDisabledCatalogIds: [DEFAULT_TOP20_SERIES_CATALOG_ID] }),
    ).toBe(true)
    expect(
      areDefaultListsDirty({ ...clean, catalogRenames: { [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "X" } }),
    ).toBe(true)
    // Unrelated custom/streaming state never counts.
    expect(
      areDefaultListsDirty({
        ...clean,
        disabledCatalogIds: ["pictorium-anime-movies", "pictorium-custom-movie-x"],
        catalogRenames: { "pictorium-stream-netflix-IT-movies": "Y" },
      }),
    ).toBe(false)
  })

  it("resolveDefaultTop20Visibility is per-list independent", () => {
    expect(resolveDefaultTop20Visibility([])).toEqual({ showMovies: true, showSeries: true })
    expect(resolveDefaultTop20Visibility([DEFAULT_TOP20_MOVIE_CATALOG_ID])).toEqual({
      showMovies: false,
      showSeries: true,
    })
    expect(
      resolveDefaultTop20Visibility([DEFAULT_TOP20_MOVIE_CATALOG_ID, DEFAULT_TOP20_SERIES_CATALOG_ID]),
    ).toEqual({ showMovies: false, showSeries: false })
    // Unrelated disables never hide the defaults.
    expect(resolveDefaultTop20Visibility(["pictorium-anime-movies"])).toEqual({
      showMovies: true,
      showSeries: true,
    })
  })
})

describe("useCustomCatalogs resetDefaultCatalogs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockedUserFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet
    })
  })

  function seededStore() {
    return memStore({
      // Non-blank device: skips the genuine-new-space default (C-owned).
      tmdb_key: "k",
      pictorium_disabled_catalogs: JSON.stringify([DEFAULT_TOP20_MOVIE_CATALOG_ID, "pictorium-anime-movies"]),
      pictorium_home_disabled_catalogs: JSON.stringify([DEFAULT_TOP20_SERIES_CATALOG_ID]),
      pictorium_catalog_order: JSON.stringify([
        DEFAULT_TOP20_MOVIE_CATALOG_ID,
        "pictorium-anime-movies",
        DEFAULT_TOP20_SERIES_CATALOG_ID,
      ]),
      pictorium_catalog_renames: JSON.stringify({
        [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "Mine",
        "pictorium-custom-movie-x": "Keep",
      }),
      pictorium_custom_catalogs: JSON.stringify([
        { id: "x", name: "Imported", type: "movie", url: "https://example.com/l" },
      ]),
      pictorium_catalog_shapes: JSON.stringify({ [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "landscape" }),
      pictorium_catalog_show_emojis: JSON.stringify(false),
      pictorium_seasonal_halloween_keywords: JSON.stringify(["spooky"]),
      pictorium_seasonal_christmas_keywords: JSON.stringify([]),
      // Unknown future field on the selection: reset must not rebuild it.
      pictorium_streaming_selections: JSON.stringify([
        { service: "netflix", country: "IT", sections: ["movies", "series"], futureField: "keep-me" },
      ]),
    })
  }

  it("restores the default slice and preserves everything else byte-identical", async () => {
    const store = seededStore()
    const rawStreamingBefore = store.raw()["pictorium_streaming_selections"]
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.resetDefaultCatalogs()
    })

    expect(result.current.disabledCatalogIds).toEqual(["pictorium-anime-movies"])
    expect(result.current.homeDisabledCatalogIds).toEqual([])
    expect(result.current.catalogOrder).toEqual(["pictorium-anime-movies"])
    expect(result.current.catalogRenames).toEqual({ "pictorium-custom-movie-x": "Keep" })
    // Card format is graphic preserve: shapes untouched.
    expect(result.current.catalogShapes).toEqual({ [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "landscape" })
    // Added/custom state untouched.
    expect(result.current.customCatalogs).toHaveLength(1)
    expect(result.current.catalogShowEmojis).toBe(false)
    expect(result.current.seasonalHalloweenKeywords).toEqual(["spooky"])
    // Streaming selections pass through verbatim (unknown fields kept in storage).
    expect(store.raw()["pictorium_streaming_selections"]).toBe(rawStreamingBefore)

    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 3000 })
    const body = JSON.parse(putBodies().at(-1)!)
    expect(body.disabledCatalogIds).toEqual(["pictorium-anime-movies"])
    expect(body.homeDisabledCatalogIds).toEqual([])
    expect(body.catalogRenames).toEqual({ "pictorium-custom-movie-x": "Keep" })
    expect(body.customCatalogs).toHaveLength(1)
    expect(body.catalogShapes).toEqual({ [DEFAULT_TOP20_MOVIE_CATALOG_ID]: "landscape" })
  })

  it("is idempotent: a second reset changes nothing and emits no PUT", async () => {
    const store = seededStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.resetDefaultCatalogs()
    })
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 3000 })
    mockedUserFetch.mockClear()

    await act(async () => {
      result.current.resetDefaultCatalogs()
    })
    // No state write happened, so the debounced sync sees an identical payload.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600))
    })
    expect(putBodies()).toHaveLength(0)
    expect(result.current.disabledCatalogIds).toEqual(["pictorium-anime-movies"])
  })

  it("is a no-op on factory-fresh state and keeps selections absent", async () => {
    const store = memStore({ tmdb_key: "k" })
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.resetDefaultCatalogs()
    })
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(result.current.streamingSelections).toBeUndefined()
    expect(store.get("pictorium_streaming_selections")).toBeNull()
  })
})

describe("CatalogManagerModal default remove/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    mockedUserFetch.mockResolvedValue(new Response(JSON.stringify({})))
  })

  it("factory lists have no Remove (toggle-only): Power disables, reset recovers", () => {
    const toggleBuiltinCatalog = vi.fn()
    renderWithCtx(<CatalogManagerModal isOpen onClose={() => {}} />, {
      disabledCatalogIds: [],
      toggleBuiltinCatalog,
    })
    // Explicit user decision: rankings can be disabled but never deleted —
    // no per-factory trash anywhere in the manager.
    expect(screen.queryByLabelText("ui.removeDefaultList")).toBeNull()
    expect(screen.queryByTitle("ui.removeDefaultList")).toBeNull()
    // Power toggles the factory movie row off (stays manageable for re-enable).
    const title = screen.getByText("🇮🇹 Top 20 Italia — Film")
    const row = title.closest("div[draggable]")
    if (!row) throw new Error("factory movie row not found")
    const { getByTitle } = within(row as HTMLElement)
    fireEvent.click(getByTitle("ui.disableStremio"))
    expect(toggleBuiltinCatalog).toHaveBeenCalledTimes(1)
    expect(toggleBuiltinCatalog).not.toHaveBeenCalledWith(DEFAULT_TOP20_SERIES_CATALOG_ID)
    expect(toggleBuiltinCatalog).toHaveBeenCalledWith(DEFAULT_TOP20_MOVIE_CATALOG_ID)
  })

  it("reset is hidden at factory, armed-confirms, then calls resetDefaultLists", () => {
    const reset = vi.fn().mockResolvedValue(undefined)
    const base = {
      disabledCatalogIds: [] as string[],
      catalogRenames: {},
      homeDisabledCatalogIds: [] as string[],
      rankingSourceMovie: "",
      rankingSourceSeries: "",
      resetDefaultLists: reset,
    }
    const first = renderWithCtx(<CatalogManagerModal isOpen onClose={() => {}} />, base)
    expect(screen.queryByText("ui.restoreDefaults")).toBeNull()
    first.unmount()

    renderWithCtx(<CatalogManagerModal isOpen onClose={() => {}} />, {
      ...base,
      disabledCatalogIds: [DEFAULT_TOP20_MOVIE_CATALOG_ID],
    })
    const btn = screen.getByText("ui.restoreDefaults")
    fireEvent.click(btn)
    // First click only arms.
    expect(reset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("ui.confirmRestoreDefaults"))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe("CataloghiView per-default visibility", () => {
  const movieItem: SearchResult & { rank: number } = { id: 11, media_type: "movie", title: "Film Uno", poster_path: "/a.jpg", rank: 1 }
  const seriesItem: SearchResult & { rank: number } = { id: 22, media_type: "tv", title: "Serie Uno", poster_path: "/b.jpg", rank: 2 }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    mockedUserFetch.mockResolvedValue(new Response(JSON.stringify({})))
  })

  it("removed movies hides only the movies row, series stays", () => {
    const { container } = renderWithCtx(<CataloghiView />, {
      trending: [movieItem, seriesItem],
      disabledCatalogIds: [DEFAULT_TOP20_MOVIE_CATALOG_ID],
    })
    // Tile alt text is unique to the SimklCard rows (RankingSourceSection
    // labels reuse the row titles, so text queries would collide).
    expect(screen.queryByAltText("Film Uno")).toBeNull()
    expect(screen.getByAltText("Serie Uno")).toBeTruthy()
    // The section heading survives with the remaining row.
    const headings = Array.from(container.querySelectorAll("h2.section-heading"))
    expect(headings.some((h) => h.textContent?.includes("ui.justwatchTop20"))).toBe(true)
  })

  it("both removed hides the section but the manager entry stays reachable", () => {
    const { container } = renderWithCtx(<CataloghiView />, {
      trending: [movieItem, seriesItem],
      disabledCatalogIds: [DEFAULT_TOP20_MOVIE_CATALOG_ID, DEFAULT_TOP20_SERIES_CATALOG_ID],
    })
    expect(screen.queryByAltText("Film Uno")).toBeNull()
    expect(screen.queryByAltText("Serie Uno")).toBeNull()
    const headings = Array.from(container.querySelectorAll("h2.section-heading"))
    expect(
      headings.some(
        (h) =>
          h.textContent?.includes("ui.justwatchTop20") ||
          h.textContent?.includes("ui.rankingSourceTitle"),
      ),
    ).toBe(false)
    expect(screen.getByText("ui.priorityNames")).toBeTruthy()
  })

  it("custom-sourced slot never wears the JustWatch mark (sibling keeps its own)", () => {
    const { container } = renderWithCtx(<CataloghiView />, {
      trending: [movieItem, seriesItem],
      disabledCatalogIds: [],
      rankingSourceMovie: "cat_1",
      rankingSourceSeries: "",
      customCatalogs: [{ id: "cat_1", name: "Imported", type: "movie", url: "https://example.com/l" }],
    })
    // Heading carries no brand at all (neutral title only).
    expect(container.querySelector('h2.section-heading img[src*="JW_Logo"]')).toBeNull()
    expect(screen.getByAltText("Film Uno")).toBeTruthy()
    // Per-slot honesty: the custom movies box has no JW icon, the actual JW
    // series box keeps its own.
    expect(container.querySelectorAll('img[src*="JW_Logo"]')).toHaveLength(1)
  })

  it("factory charts keep the JustWatch mark (one icon-only footer per box)", () => {
    const { container } = renderWithCtx(<CataloghiView />, {
      trending: [movieItem, seriesItem],
      disabledCatalogIds: [],
      rankingSourceMovie: "",
      rankingSourceSeries: "",
    })
    // No heading brand (neutral title); each box footer carries its own icon.
    expect(container.querySelector('h2.section-heading img[src*="JW_Logo"]')).toBeNull()
    expect(container.querySelectorAll('img[src*="JW_Logo"]')).toHaveLength(2)
  })
})

describe("H curated per-list integration (generic identities)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockedUserFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet
    })
  })

  function curatedStore() {
    // Non-blank device: no genuine-new init interferes with the seeded state.
    return memStore({
      tmdb_key: "k",
      pictorium_streaming_selections: JSON.stringify([
        { service: "netflix", country: "IT", sections: ["movies", "series"] },
        { service: "hulu", country: "united-states", sections: ["series"] },
      ]),
      pictorium_catalog_renames: JSON.stringify({
        "pictorium-stream-netflix-it-movies": "MineFlix",
        "pictorium-stream-netflix-it-series": "MineSerie",
        "pictorium-stream2-hulu--united-states--series--auto": "MineHulu",
      }),
      pictorium_catalog_order: JSON.stringify([
        "pictorium-stream-netflix-it-movies",
        "pictorium-stream-netflix-it-series",
        "pictorium-stream2-hulu--united-states--series--auto",
        "other-id",
      ]),
      pictorium_disabled_catalogs: JSON.stringify(["pictorium-stream-netflix-it-series"]),
    })
  }

  it("per-list trash removes JUST that list: sibling stays, other identities untouched", async () => {
    const store = curatedStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    expect(result.current.streamingSelections).toHaveLength(2)

    await act(async () => {
      result.current.removeStreamingSelection("netflix", "IT", "auto", null, "movies")
    })

    // Entry narrows to series (config kept); the hulu identity is untouched.
    expect(result.current.streamingSelections).toHaveLength(2)
    expect(result.current.streamingSelections?.[0]).toMatchObject({ service: "netflix", sections: ["series"] })
    expect(result.current.streamingSelections?.[1]).toMatchObject({ service: "hulu", sections: ["series"] })
    // ONLY the dropped derived id leaves the shared records.
    expect(result.current.catalogRenames["pictorium-stream-netflix-it-movies"]).toBeUndefined()
    expect(result.current.catalogRenames["pictorium-stream-netflix-it-series"]).toBe("MineSerie")
    expect(result.current.catalogRenames["pictorium-stream2-hulu--united-states--series--auto"]).toBe("MineHulu")
    expect(result.current.catalogOrder).not.toContain("pictorium-stream-netflix-it-movies")
    expect(result.current.catalogOrder).toContain("pictorium-stream-netflix-it-series")
    expect(result.current.catalogOrder).toContain("pictorium-stream2-hulu--united-states--series--auto")
    expect(result.current.catalogOrder).toContain("other-id")
  })

  it("same provider in another source is a distinct identity (never merged)", async () => {
    const store = curatedStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    let status: string | undefined
    await act(async () => {
      status = result.current.addStreamingSelection("netflix", "IT", ["movies"], "flixpatrol")
    })
    expect(status).toBe("added")
    expect(result.current.streamingSelections).toHaveLength(3)
    // The auto entry still carries both sections; the strict entry stands alone.
    expect(result.current.streamingSelections?.[0]).toMatchObject({ service: "netflix", sections: ["movies", "series"] })
    expect(result.current.streamingSelections?.[2]).toMatchObject({ service: "netflix", source: "flixpatrol", sections: ["movies"] })
  })

  it("per-section manager toggle narrows the entry; last section hides instead of deleting", async () => {
    const store = curatedStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.toggleStreamingSection("hulu", "united-states", "series", "auto", null)
    })
    // Single-section entry: Hide (enabled=false, config kept), nothing deleted.
    expect(result.current.streamingSelections?.[1]).toMatchObject({ service: "hulu", enabled: false, sections: ["series"] })
    expect(result.current.streamingSelections).toHaveLength(2)
  })
})
