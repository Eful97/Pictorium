/**
 * Task B correction1 — real open/reopen/preview wiring (no helper-only).
 *
 * Goes through the REAL provider tree (`usePictorium` + `usePosterEditor` on
 * a live `PosterEditorProvider`): opening a saved title must render its
 * saved per-family presets in the preview identically to Stremio (sparse
 * staged absent = follow saved), choosing "Saved" (removing the staged key)
 * must follow the saved map again, and a Lab "Use for title" handoff must
 * initialize shape-effective values for the handoff shape (not the saved
 * one). HTTP is mocked at `@/lib/http` only; every other layer is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePictorium } from "@/lib/context"
import { http, userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({
  http: vi.fn(),
  userFetch: vi.fn(),
}))

const mockHttp = vi.mocked(http)
const mockUserFetch = vi.mocked(userFetch)

const A = "Abc123-_XyZ"
const REV = "deadbeef"
const OTHER = "Otherfam-01"
const LEG = "Legacy01-XY"
const LEG_REV = "1234abcd"

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function mapping(partial: Record<string, unknown> = {}) {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    posterShape: "poster",
    ...partial,
  }
}

const DETAILS = {
  title: "T",
  name: null,
  original_language: "en",
  genres: [{ id: 18, name: "Dramma" }],
  voteAverage: 7.5,
  voteCount: 10,
  status: null,
  type: null,
  release_date: "2024-01-01",
  first_air_date: null,
  last_air_date: null,
  next_episode_to_air: null,
  number_of_seasons: null,
  number_of_episodes: null,
  imdb_id: null,
  wikidata_id: null,
  networks: [],
  production_companies: [],
  aggregatedRatings: null,
}

const IMAGES = {
  posters: [{ file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 }],
  logos: [],
  backdrops: [],
}

let currentMappings: Record<string, unknown>[] = []

function installMocks() {
  mockHttp.mockImplementation(async (url: unknown) => {
    const u = String(url)
    if (u.includes("/api/tmdb/1/details")) return DETAILS
    if (u.includes("/api/tmdb/1/images")) return IMAGES
    if (u.includes("/api/trending/rank")) return { rank: null }
    if (u.includes("/api/awards/")) return { awards: [], nominations: [], studios: [], director: null, keywords: [] }
    if (u.includes("/api/mdblist")) return {}
    return {}
  })
  mockUserFetch.mockImplementation(async (url: unknown) => {
    const u = String(url)
    if (u.includes("/api/defaults")) return jsonResponse({})
    // Per-id GET is the authoritative handoff settlement (F4 correction1):
    // the real route returns the single mapping or 404, never the list
    // envelope — emulate exactly that so the handoff takes the mapped branch.
    const perId = u.match(/\/api\/mappings\/([^/?]+)/)
    if (perId) {
      const found = currentMappings.find(
        (m) => `${(m as { mediaType?: string }).mediaType}:${(m as { tmdbId?: number }).tmdbId}` === perId[1],
      )
      if (found) return jsonResponse(found)
      return { ok: false, status: 404, json: async () => ({ error: "not found" }) } as unknown as Response
    }
    if (u.includes("/api/mappings")) return jsonResponse({ mappings: currentMappings })
    return jsonResponse({})
  })
}

function Wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

function useHarness() {
  const ctx = usePictorium()
  const ed = usePosterEditor()
  return { ctx, ed }
}

const ITEM = { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" } as never

beforeEach(() => {
  vi.clearAllMocks()
  currentMappings = []
  installMocks()
  window.history.replaceState({}, "", "/")
})

describe("reopen renders saved family presets in the preview (real open path)", () => {
  it("saved per-family map and legacy singleton travel in the preview URL", async () => {
    currentMappings = [
      mapping({
        badgePresets: { quality: { id: A, rev: REV } },
        badgePresetId: LEG,
        badgePresetRev: LEG_REV,
      }),
    ]
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })
    // Real usage opens titles after the store loads (the handoff flow waits
    // for it explicitly): settle first so the open takes the mapped branch.
    await waitFor(() => expect(result.current.ctx.mappingsMap.has("movie:1")).toBe(true), { timeout: 8000 })
    await act(async () => {
      result.current.ctx.navigateToPoster(ITEM)
    })
    await waitFor(() => expect(result.current.ctx.previewUrl).toContain("bp="), { timeout: 8000 })
    const url = new URL(result.current.ctx.previewUrl)
    // Sparse staged absent = follow saved: the saved family renders …
    expect(url.searchParams.get("bp")).toBe(`quality:${A}.${REV}`)
    // … and the legacy singleton fans out server-side on its own query.
    expect(url.searchParams.get("badgePreset")).toBe(LEG)
    expect(url.searchParams.get("prv")).toBe(LEG_REV)
  })

  it("choosing Saved (removing the staged key) follows the saved map again", async () => {
    currentMappings = [
      mapping({ badgePresets: { quality: { id: A, rev: REV } } }),
    ]
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.ctx.mappingsMap.has("movie:1")).toBe(true), { timeout: 8000 })
    await act(async () => {
      result.current.ctx.navigateToPoster(ITEM)
    })
    await waitFor(() => expect(result.current.ctx.previewUrl).toContain("bp="), { timeout: 8000 })
    // Stage an override (what the picker select does) …
    act(() => {
      result.current.ed.setFamilyPreset("quality", { id: OTHER, rev: null })
    })
    await waitFor(
      () => expect(new URL(result.current.ctx.previewUrl).searchParams.get("bp")).toBe(`quality:${OTHER}`),
      { timeout: 8000 },
    )
    // … then choose Saved: the staged key is removed and the saved look
    // returns (before the fix the preview went standard here).
    act(() => {
      result.current.ed.setFamilyPreset("quality", undefined)
    })
    await waitFor(
      () => expect(new URL(result.current.ctx.previewUrl).searchParams.get("bp")).toBe(`quality:${A}.${REV}`),
      { timeout: 8000 },
    )
  })

  it("an explicit family clear still shadows the saved map", async () => {
    currentMappings = [
      mapping({ badgePresets: { quality: { id: A, rev: REV } } }),
    ]
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.ctx.mappingsMap.has("movie:1")).toBe(true), { timeout: 8000 })
    await act(async () => {
      result.current.ctx.navigateToPoster(ITEM)
    })
    await waitFor(() => expect(result.current.ctx.previewUrl).toContain("bp="), { timeout: 8000 })
    // Standard (explicit clear, what the picker Standard button stages).
    act(() => {
      result.current.ed.setFamilyPreset("quality", null)
    })
    await waitFor(
      () => expect(new URL(result.current.ctx.previewUrl).searchParams.get("bp")).toBe("quality:-"),
      { timeout: 8000 },
    )
  })
})

describe("Lab handoff initializes the handoff shape (real open path)", () => {
  it("portrait mapping + landscape return opens landscape-effective values", async () => {
    currentMappings = [
      mapping({
        posterShape: "poster",
        // Distinctive per-shape values: flat "pill" vs landscape "vetro"
        // (never the "shadow" default, so a default-state pass is impossible).
        badgeStyle: "pill",
        landscape: { badgeStyle: "vetro" },
      }),
    ]
    window.history.replaceState({}, "", "/?title=movie:1&shape=landscape")
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })
    // The open initialized the handoff shape with ITS effective values, not
    // the saved portrait ones (before the fix: shape landscape, values pill).
    await waitFor(() => expect(result.current.ed.posterShape).toBe("landscape"), { timeout: 8000 })
    await waitFor(() => expect(result.current.ed.badgeStyle).toBe("vetro"), { timeout: 8000 })
  })

  it("landscape mapping + portrait return opens portrait-effective values", async () => {
    currentMappings = [
      mapping({
        posterShape: "landscape",
        badgeStyle: "pill",
        landscape: { badgeStyle: "vetro" },
      }),
    ]
    window.history.replaceState({}, "", "/?title=movie:1&shape=poster")
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })
    // Before the fix the open initialized the saved landscape values and
    // only the canvas moved to portrait ("vetro" leaked into portrait).
    await waitFor(() => expect(result.current.ed.posterShape).toBe("poster"), { timeout: 8000 })
    await waitFor(() => expect(result.current.ed.badgeStyle).toBe("pill"), { timeout: 8000 })
  })
})
