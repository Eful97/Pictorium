import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }))

import { userFetch } from "@/lib/http"
import { isProfilelessOnMultiUser, shouldSkipServerSync } from "@/lib/guest-guard"
import { useCustomCatalogs } from "@/lib/useCustomCatalogs"
import {
  addGenericSelectionsToList,
  derivedIdsForGenericSelection,
  genericSelectionKey,
  isStreamingOptIn,
  orderGenericStreamingEntries,
  parseCatalogPosterIdentity,
  parseStreamingSourceHeader,
  streamingMetaToTile,
  toPersistedSelections,
} from "@/lib/streaming-catalog-client"
import { MAX_STREAMING_SELECTIONS, sanitizeGenericStreamingSelections } from "@/lib/streaming-catalogs"

const mockedFetch = vi.mocked(userFetch)
const mockedSkip = vi.mocked(shouldSkipServerSync)
const mockedProfileless = vi.mocked(isProfilelessOnMultiUser)

function memStore() {
  const map = new Map<string, string>()
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v)
    },
    raw: map,
  }
}

const okGet = (body: unknown = {}) =>
  ({ ok: true, json: async () => body }) as unknown as Response
const okPut = (body: unknown = {}) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

function putBodies(): string[] {
  return mockedFetch.mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === "PUT")
    .map(([, init]) => String((init as RequestInit)?.body))
}

describe("streaming-catalog-client pure helpers", () => {
  it("parses our poster identity (numeric tmdbId only, never a guess)", () => {
    expect(parseCatalogPosterIdentity("https://x/api/poster/series/12345?rv=abc")).toEqual({
      type: "series",
      tmdbId: 12345,
    })
    expect(parseCatalogPosterIdentity("https://x/api/poster/movie/7")).toEqual({ type: "movie", tmdbId: 7 })
    expect(parseCatalogPosterIdentity("https://image.tmdb.org/t/p/w500/x.jpg")).toBeNull()
    expect(parseCatalogPosterIdentity("https://x/api/poster/series/tt123")).toBeNull()
    expect(parseCatalogPosterIdentity(null)).toBeNull()
  })

  it("maps canonical Stremio metas to tiles without TMDB inference", () => {
    const tile = streamingMetaToTile(
      { id: "tt1000001", name: "Show", poster: "https://x/api/poster/series/99?region=IT&rk=1" },
      "series",
    )
    expect(tile).toMatchObject({ tmdbId: 99, mediaType: "tv", title: "Show" })
    expect(streamingMetaToTile({ id: "tt1", name: "X" }, "movies")).toBeNull()
  })

  it("parses the source header honestly (unknown on missing/garbage)", () => {
    expect(parseStreamingSourceHeader("flixpatrol")).toBe("flixpatrol")
    expect(parseStreamingSourceHeader("JustWatch")).toBe("justwatch")
    expect(parseStreamingSourceHeader(null)).toBe("unknown")
    expect(parseStreamingSourceHeader("platform:netflix")).toBe("unknown")
  })

  it("absent stays absent; explicit (even []) is opt-in", () => {
    expect(isStreamingOptIn(undefined)).toBe(false)
    expect(isStreamingOptIn(null)).toBe(false)
    expect(isStreamingOptIn([])).toBe(true)
  })

  it("adds/merges/dedups/bounds without mutating (identity = service+slug+source+variant)", () => {
    const base = sanitizeGenericStreamingSelections([{ service: "netflix", country: "IT", sections: ["movies"] }])!
    const merged = addGenericSelectionsToList(base, [{ service: "netflix", country: "IT", sections: ["series"] }])
    expect(merged.status).toBe("merged")
    expect(merged.selections).toHaveLength(1)
    expect(merged.selections[0].sections).toEqual(["movies", "series"])
    expect(base[0].sections).toEqual(["movies"])
    const dup = addGenericSelectionsToList(merged.selections, [{ service: "netflix", country: "it", sections: ["movies", "series"] }])
    expect(dup.status).toBe("duplicate")
    const added = addGenericSelectionsToList(base, [{ service: "prime", country: "US", sections: ["series"] }])
    expect(added.status).toBe("added")
    expect(added.selections).toHaveLength(2)
    // Same provider in another country/source/variant is a distinct identity.
    const cross = addGenericSelectionsToList(base, [
      { service: "netflix", country: "US", sections: ["movies"] },
      { service: "netflix", country: "IT", sections: ["movies"], source: "flixpatrol" },
      { service: "netflix", country: "IT", sections: ["series"], variant: "it" },
    ])
    expect(cross.status).toBe("added")
    expect(cross.added).toBe(3)
    expect(cross.selections).toHaveLength(4)
    // Unknown service/country can never enter through the UI helper.
    expect(addGenericSelectionsToList(base, [{ service: "nope!", country: "US", sections: ["movies"] }]).status).toBe("invalid")
    expect(addGenericSelectionsToList(base, [{ service: "netflix", country: "XX", sections: ["movies"] }]).status).toBe("invalid")
    // New-universe services sanitize (never Italy fallback).
    const hulu = addGenericSelectionsToList(base, [{ service: "hulu", country: "united-states", sections: ["series"] }])
    expect(hulu.status).toBe("added")
    expect(hulu.selections.some((s) => s.service === "hulu" && s.chartSlug === "united-states")).toBe(true)
    // Bound is the shared backend cap (not a fixed 40): fill to the cap, then full.
    const many = sanitizeGenericStreamingSelections(
      Array.from({ length: MAX_STREAMING_SELECTIONS }, (_, i) => ({
        service: `svc${i}`,
        country: "italy",
        sections: ["movies"],
      })),
    )!
    expect(many).toHaveLength(MAX_STREAMING_SELECTIONS)
    const over = addGenericSelectionsToList(many, [{ service: "extra", country: "italy", sections: ["movies"] }])
    expect(over.status).toBe("full")
    expect(over.selections).toHaveLength(MAX_STREAMING_SELECTIONS)
    // Persisted model: mutable arrays, auto source / base variant omitted.
    expect(toPersistedSelections(merged.selections)).toEqual([
      { service: "netflix", country: "IT", sections: ["movies", "series"], enabled: true },
    ])
    expect(derivedIdsForGenericSelection(merged.selections[0])).toEqual([
      "pictorium-stream-netflix-it-movies",
      "pictorium-stream-netflix-it-series",
    ])
    expect(genericSelectionKey({ service: "netflix", country: "IT" })).toBe(
      genericSelectionKey({ service: "netflix", chartSlug: "italy", source: "auto", variant: null }),
    )
  })

  it("orders entries by catalogOrder positions, unknowns keep array order", () => {
    const sels = sanitizeGenericStreamingSelections([
      { service: "prime", country: "US" },
      { service: "netflix", country: "IT" },
    ])!
    const ordered = orderGenericStreamingEntries(sels, ["pictorium-stream-netflix-it-movies"])
    expect(ordered.map((s) => s.service)).toEqual(["netflix", "prime"])
    expect(orderGenericStreamingEntries(sels, []).map((s) => s.service)).toEqual(["prime", "netflix"])
  })
})

describe("useCustomCatalogs streaming selections", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockedSkip.mockResolvedValue(false)
    mockedProfileless.mockResolvedValue(false)
    mockedFetch.mockResolvedValue(okGet())
    localStorage.clear()
  })

  it("legacy space with empty catalog domain: absent preserved, no PUT, no derived writes", async () => {
    // A trace of prior usage (API key) without any catalog configuration is
    // still a legacy space: mere mount must not migrate absent → explicit.
    const store = memStore()
    store.set("tmdb_key", "k")
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(mockedFetch.mock.calls.length).toBeGreaterThan(0), { timeout: 2000 })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(result.current.streamingSelections).toBeUndefined()
    expect(putBodies()).toHaveLength(0)
    expect(store.get("pictorium_streaming_selections")).toBeNull()
    expect(store.get("pictorium_disabled_catalogs")).toBeNull()
  })

  it("server failure is NOT proof of a new space: nothing initialized, no PUT", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(result.current.streamingSelections).toBeUndefined()
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(putBodies()).toHaveLength(0)
  })

  it("locked namespace read is NOT proof of a new space: no init", async () => {
    mockedSkip.mockResolvedValue(true)
    mockedProfileless.mockResolvedValue(false)
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(result.current.streamingSelections).toBeUndefined()
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(putBodies()).toHaveLength(0)
  })

  it("used device (onboarding dismissed) with empty catalog domain is NOT new: legacy preserved", async () => {
    const store = memStore()
    store.set("pictorium_onboarding_done", "true")
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(result.current.streamingSelections).toBeUndefined()
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(putBodies()).toHaveLength(0)
  })

  it("genuine-new space: explicit [] + anime disabled, persisted via the single catalog PUT", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    expect(result.current.disabledCatalogIds).toEqual(
      expect.arrayContaining(["pictorium-anime-movies", "pictorium-anime"]),
    )
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    const body = JSON.parse(putBodies()[0])
    expect(body.streamingSelections).toEqual([])
    expect(body.disabledCatalogIds).toEqual(
      expect.arrayContaining(["pictorium-anime-movies", "pictorium-anime"]),
    )
  })

  it("server explicit [] is respected without anime init (prior opt-in preserved)", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({ streamingSelections: [] })
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    // No anime disable: explicit [] is a prior decision, not a new space.
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(putBodies()).toHaveLength(0)
  })

  it("add/toggle-section/toggle/remove roundtrip with derived-id cleanup only", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    // Blank device + empty server: genuine-new init runs first ([] state).
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    // Unrelated pre-existing records (seeded via actions, like real usage).
    await act(async () => {
      result.current.setCatalogOrder(["pictorium-jw-movies", "other-id"])
      result.current.renameCatalog("other-id", "Mine")
    })

    let status: string | undefined
    await act(async () => {
      status = result.current.addStreamingSelection("netflix", "it", ["movies", "series"])
    })
    expect(status).toBe("added")
    expect(result.current.streamingSelections).toHaveLength(1)

    await act(async () => {
      status = result.current.addStreamingSelection("netflix", "IT", ["movies"])
    })
    expect(status).toBe("duplicate")
    await act(async () => {
      result.current.toggleStreamingSection("netflix", "IT", "movies")
    })
    // Narrowed to series only (config kept).
    expect(result.current.streamingSelections?.[0].sections).toEqual(["series"])
    await act(async () => {
      result.current.toggleStreamingSection("netflix", "IT", "series")
    })
    // Last section hides the entry instead of deleting it.
    expect(result.current.streamingSelections?.[0].enabled).toBe(false)
    expect(result.current.streamingSelections?.[0].sections).toEqual(["series"])
    await act(async () => {
      result.current.toggleStreamingSelection("netflix", "IT")
    })
    expect(result.current.streamingSelections?.[0].enabled).toBe(true)

    // Rename + order + disable touch the derived ids…
    await act(async () => {
      result.current.renameCatalog("pictorium-stream-netflix-it-movies", "MineFlix")
      result.current.toggleBuiltinCatalog("pictorium-stream-netflix-it-series")
    })
    // …then Remove cleans ONLY those ids, nothing unrelated.
    await act(async () => {
      result.current.removeStreamingSelection("netflix", "IT")
    })
    expect(result.current.streamingSelections).toEqual([])
    expect(result.current.catalogOrder).not.toContain("pictorium-stream-netflix-it-movies")
    expect(result.current.catalogOrder).toContain("other-id")
    expect(result.current.catalogRenames["pictorium-stream-netflix-it-movies"]).toBeUndefined()
    expect(result.current.catalogRenames["other-id"]).toBe("Mine")
    expect(result.current.disabledCatalogIds).not.toContain("pictorium-stream-netflix-it-series")
  })

  it("section-scoped remove narrows the entry and cleans only that derived id", async () => {    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    const moviesId = "pictorium-stream2-paramount--italy--movies--auto"
    const seriesId = "pictorium-stream2-paramount--italy--series--auto"
    const allId = "pictorium-stream2-paramount--italy--all--auto"
    await act(async () => {
      result.current.setCatalogOrder([moviesId, seriesId, allId, "other-id"])
      result.current.addStreamingSelections([{ service: "paramount", country: "italy", sections: ["movies", "series", "all"] }])
    })
    expect(result.current.streamingSelections).toHaveLength(1)
    expect(result.current.streamingSelections?.[0].sections).toEqual(["movies", "series", "all"])
    // Remove one split FIRST: the mixed list and the other split stay
    // (narrow, never wipe — only the split's derived id is cleaned).
    await act(async () => {
      result.current.removeStreamingSelection("paramount", "italy", "auto", null, "movies")
    })
    expect(result.current.streamingSelections?.[0].sections).toEqual(["series", "all"])
    expect(result.current.catalogOrder).toEqual(expect.arrayContaining([seriesId, allId, "other-id"]))
    expect(result.current.catalogOrder).not.toContain(moviesId)
    // Remove the mixed list now: the remaining split stays.
    await act(async () => {
      result.current.removeStreamingSelection("paramount", "italy", "auto", null, "all")
    })
    expect(result.current.streamingSelections?.[0].sections).toEqual(["series"])
    expect(result.current.catalogOrder).toEqual(expect.arrayContaining([seriesId, "other-id"]))
    expect(result.current.catalogOrder).not.toContain(allId)
  })

  it("single custom remove cleans ONLY that provider derived ids (no orphans, no wipe)", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    const mixMovie = "pictorium-custom-movie-mix"
    const mixSeries = "pictorium-custom-series-mix"
    await act(async () => {
      result.current.setCustomCatalogs([{ id: "mix", name: "Mix", type: "mixed", url: "https://mdblist.com/lists/u/mix" }])
      result.current.setCatalogOrder([mixMovie, mixSeries, "other-id"])
      result.current.setDisabledCatalogIds([mixSeries])
      result.current.setHomeDisabledCatalogIds([mixMovie])
      result.current.renameCatalog(mixMovie, "Mine")
      result.current.setCatalogShape(mixSeries, "landscape")
    })
    expect(result.current.customCatalogs).toHaveLength(1)
    await act(async () => {
      result.current.removeCustomCatalog("mix")
    })
    expect(result.current.customCatalogs).toEqual([])
    // ONLY the removed provider's derived ids are cleaned everywhere.
    expect(result.current.catalogOrder).toEqual(["other-id"])
    expect(result.current.disabledCatalogIds).toEqual([])
    expect(result.current.homeDisabledCatalogIds).toEqual([])
    expect(result.current.catalogRenames[mixMovie]).toBeUndefined()
    expect(result.current.catalogShapes[mixSeries]).toBeUndefined()
  })

  it("single addon custom remove cleans its derived id (same contract as mixed)", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    const addonId = "pictorium-custom-movie-a1"
    await act(async () => {
      result.current.setCustomCatalogs([{
        name: "Addon", id: "a1", type: "movie", url: "https://example.com/manifest.json",
        addon: { manifestUrl: "https://example.com/manifest.json", catalogId: "top", catalogType: "movie" },
      }])
      result.current.setCatalogOrder([addonId, "other-id"])
      result.current.setDisabledCatalogIds([addonId])
    })
    await act(async () => {
      result.current.removeCustomCatalog("a1")
    })
    expect(result.current.catalogOrder).toEqual(["other-id"])
    expect(result.current.disabledCatalogIds).toEqual([])
  })

  it("two same-tick single section removes compose (no stale-mirror resurrect)", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    await act(async () => {
      result.current.addStreamingSelection("netflix", "IT", ["movies", "series"])
    })
    expect(result.current.streamingSelections?.[0].sections).toEqual(["movies", "series"])
    // Two separate single removes in the SAME tick (one render): without a
    // synchronous mirror update the second call would recompute from the
    // stale pre-first-call array and resurrect the movies section.
    await act(async () => {
      result.current.removeStreamingSelection("netflix", "IT", "auto", null, "movies")
      result.current.removeStreamingSelection("netflix", "IT", "auto", null, "series")
    })
    expect(result.current.streamingSelections ?? []).toEqual([])
  })

  it("same-tick removes on two independent providers compose with exact cleanup", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    const aMovies = "pictorium-stream-netflix-it-movies"
    const aSeries = "pictorium-stream-netflix-it-series"
    const bMovies = "pictorium-stream-prime-us-movies"
    await act(async () => {
      result.current.addStreamingSelections([
        { service: "netflix", country: "IT", sections: ["movies", "series"] },
        { service: "prime", country: "US", sections: ["movies"] },
      ])
      result.current.setCatalogOrder([aMovies, aSeries, bMovies, "other-id"])
    })
    await act(async () => {
      result.current.removeStreamingSelection("netflix", "IT", "auto", null, "movies")
      result.current.removeStreamingSelection("prime", "US", "auto", null, "movies")
    })
    const sels = result.current.streamingSelections ?? []
    expect(sels.find((s) => s.service === "netflix")?.sections).toEqual(["series"])
    expect(sels.find((s) => s.service === "prime")).toBeUndefined()
    // Metadata cleaned ONLY for actually removed ids (sibling kept).
    expect(result.current.catalogOrder).toEqual(expect.arrayContaining([aSeries, "other-id"]))
    expect(result.current.catalogOrder).not.toContain(aMovies)
    expect(result.current.catalogOrder).not.toContain(bMovies)
  })

  it("PUT payload carries explicit selections (full update, no field dropped)", async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet({})
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await waitFor(() => expect(result.current.streamingSelections).toEqual([]), { timeout: 2000 })
    // Let the genuine-new init persist first so the next PUT is the Add alone.
    await waitFor(() => expect(putBodies().length).toBeGreaterThan(0), { timeout: 2000 })
    mockedFetch.mockClear()
    await act(async () => {
      result.current.addStreamingSelection("prime", "US", ["series"])
    })
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    const body = JSON.parse(putBodies()[0])
    expect(body.streamingSelections).toEqual([{ service: "prime", country: "US", sections: ["series"], enabled: true }])
    // The rest of the catalog payload travels with it (no silent wipe).
    expect(body).toHaveProperty("customCatalogs")
    expect(body).toHaveProperty("disabledCatalogIds")
    expect(body).toHaveProperty("catalogOrder")
  })
})
