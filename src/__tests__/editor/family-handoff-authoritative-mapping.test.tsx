/**
 * F4 correction1 — authoritative handoff settlement (real provider wiring).
 *
 * Real root: the Lab-handoff open polled the mappings LIST (reference change
 * >= 2, 4s timeout) and then opened UNCONDITIONALLY — while the authoritative
 * per-id mapping was still loading. Under full-file server load the list lost
 * the race, the already-saved title opened as "unmapped", and the explicit
 * Save froze the fresh-unmapped quality defaults (-10/+15) over the stored
 * explicit 0/0. The helper fix (fresh-unmapped defaults init) is correct for
 * genuinely new titles but must never overwrite a stored 0 under this race.
 *
 * Contract under test (through the REAL provider tree: `usePictorium` +
 * `usePosterEditor` on a live `PosterEditorProvider`; HTTP mocked at
 * `@/lib/http` only):
 * - list load pending forever + authoritative per-id GET 200 with
 *   qualityBadgeOffsetX/Y 0/0 (+ other distinct fields) + handoff
 *   `?title=movie:1&shape=landscape` opens the SAVED look (0/0, pill, 150 —
 *   never factory -10/+15/shadow/100), the preview carries qox=0/qoy=0, and
 *   the explicit Save POSTs 0/0 (portrait flat preserved on a landscape
 *   handoff) even though the list never settled first;
 * - authoritative per-id GET denied (401) opens NOTHING and stages NOTHING:
 *   no selected title, no POST, never treated as "no mapping".
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function deniedResponse(status = 401): Response {
  return { ok: false, status, json: async () => ({ error: "denied" }) } as unknown as Response
}

function savedMapping() {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    // Saved PORTRAIT mapping with explicit 0/0 (valid user contract: 0 is a
    // value, never "absent") + other fields distinct from every factory
    // default (a default-state pass is impossible).
    posterShape: "poster",
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    badgeStyle: "pill",
    topBadgeScale: 150,
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

function Wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

function useHarness() {
  const ctx = usePictorium()
  const ed = usePosterEditor()
  return { ctx, ed }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, "", "/")
})

describe("handoff authoritative per-id settlement (real open path)", () => {
  it("pending list + authoritative 0/0 opens the saved look and saves 0/0 (landscape handoff preserves portrait)", async () => {
    const authoritative = savedMapping()
    // List barrier: stays pending while the open runs (far past the old 4s
    // poll) — the open must NOT wait for it. Resolved only later so the
    // post-open Save can complete its reload.
    let resolveList!: (v: Response) => void
    const listPending = new Promise<Response>((res) => {
      resolveList = res
    })
    let listCalls = 0
    const posted: Record<string, unknown>[] = []
    mockUserFetch.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/api/mappings/movie:1")) return jsonResponse(authoritative)
      if (u.includes("/api/mappings")) {
        listCalls += 1
        return listPending
      }
      if (u.includes("/api/defaults")) return jsonResponse({})
      return jsonResponse({})
    })
    mockHttp.mockImplementation(async (url: string, opts?: { method?: string; body?: unknown }) => {
      const u = String(url)
      if (u === "/api/mappings" && (opts?.method ?? "GET") === "POST") {
        posted.push(JSON.parse(String(opts?.body ?? "{}")) as Record<string, unknown>)
        return { ok: true }
      }
      if (u.includes("/api/tmdb/1/details")) return DETAILS
      if (u.includes("/api/tmdb/1/images")) return IMAGES
      if (u.includes("/api/trending/rank")) return { rank: null }
      if (u.includes("/api/awards/")) return { awards: [], nominations: [], studios: [], director: null, keywords: [] }
      if (u.includes("/api/mdblist")) return {}
      return {}
    })

    window.history.replaceState({}, "", "/?title=movie:1&shape=landscape")
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })

    // The saved look wins while the list is STILL pending (old code opened
    // unmapped here: badgeStyle shadow + qox -10/qoy +15).
    await waitFor(() => expect(result.current.ed.posterShape).toBe("landscape"), { timeout: 8000 })
    await waitFor(() => expect(result.current.ed.badgeStyle).toBe("pill"), { timeout: 8000 })
    await waitFor(() => expect(result.current.ed.qualityBadgeOffsetX).toBe(0), { timeout: 8000 })
    expect(result.current.ed.qualityBadgeOffsetY).toBe(0)
    // Barrier proof: the list never settled — this came from the per-id
    // GET, not from the store.
    expect(listCalls).toBeGreaterThan(0)
    expect(result.current.ctx.mappingsMap.size).toBe(0)
    // Preview carries the explicit stored 0 (WYSIWYG, never factory -10/+15).
    await waitFor(() => expect(result.current.ctx.previewUrl).toContain("qox=0"), { timeout: 8000 })
    expect(result.current.ctx.previewUrl).toContain("qoy=0")

    // Let the slow list catch up WITH the mapping (it lost the race, then
    // arrived) so the Save reload can finish; the payload must preserve the
    // explicit stored 0/0 flat (portrait) through the landscape handoff —
    // never the fresh-unmapped defaults.
    act(() => {
      resolveList(jsonResponse({ mappings: [authoritative] }))
    })
    await waitFor(() => expect(result.current.ctx.mappingsMap.has("movie:1")).toBe(true), { timeout: 8000 })
    await waitFor(() => expect(posted.length).toBe(0))
    let ok: unknown = false
    await act(async () => {
      ok = await result.current.ctx.saveConfig()
    })
    expect(ok).toBe(true)
    expect(posted.length).toBe(1)
    expect(posted[0].qualityBadgeOffsetX).toBe(0)
    expect(posted[0].qualityBadgeOffsetY).toBe(0)
    expect(posted[0].topBadgeScale).toBe(150)
    const landscape = (posted[0] as Record<string, unknown>).landscape as Record<string, unknown>
    expect(landscape.qualityBadgeOffsetX).toBe(0)
    expect(landscape.qualityBadgeOffsetY).toBe(0)
  })

  it("denied authoritative lookup opens nothing and stages/saves nothing", async () => {
    const posted: Record<string, unknown>[] = []
    mockUserFetch.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/api/mappings/movie:1")) return deniedResponse(401)
      if (u.includes("/api/mappings")) return jsonResponse({ mappings: [] })
      if (u.includes("/api/defaults")) return jsonResponse({})
      return jsonResponse({})
    })
    mockHttp.mockImplementation(async (url: string, opts?: { method?: string; body?: unknown }) => {
      const u = String(url)
      if (u === "/api/mappings" && (opts?.method ?? "GET") === "POST") {
        posted.push(JSON.parse(String(opts?.body ?? "{}")) as Record<string, unknown>)
        return { ok: true }
      }
      if (u.includes("/api/tmdb/1/details")) return DETAILS
      if (u.includes("/api/tmdb/1/images")) return IMAGES
      if (u.includes("/api/trending/rank")) return { rank: null }
      if (u.includes("/api/awards/")) return { awards: [], nominations: [], studios: [], director: null, keywords: [] }
      if (u.includes("/api/mdblist")) return {}
      return {}
    })

    window.history.replaceState({}, "", "/?title=movie:1&shape=landscape")
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper })

    // Give the handoff pipeline time to (not) open: details resolve fast, the
    // denied per-id lookup must stop everything.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2000))
    })
    expect(result.current.ctx.selected).toBeNull()
    expect(result.current.ctx.previewUrl ?? "").not.toContain("qox=")
    // No empty-default mapping was ever written through the denied path.
    expect(posted.length).toBe(0)
  })
})
