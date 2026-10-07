/**
 * N8 — direct A→B open with defaultPosterShape landscape must not paint
 * A's backdrop on B.
 *
 * Causal chain (proven by this test failing before the fix):
 * openPosterBrowser resets selected/selectedLogo/selectedBackdrop/previewPoster
 * but keeps the previous title's image collections. The EditView landscape
 * init effect reads (backdrops + selectedMappingKey): with B selected, a null
 * backdrop and A's stale list still in state, it auto-picks A's first visible
 * tile for B and marks B's init key done. When B's own list arrives the effect
 * early-returns on the spent mark, so the stale A path stays selected and —
 * not being part of B's list — renders with no tile highlighted. Switching to
 * portrait clears the mark (removeBackdrop + shape guard) so re-entering
 * landscape re-initializes from B's real list: exactly the reported
 * "only portrait→landscape fixes it" workaround.
 *
 * Drives the REAL provider (PictoriumRoot) + the REAL EditView with deferred
 * network and unique per-title fixture paths — never a mocked loader — so the
 * stale pick, when present, is observable as a real state value.
 */
import { useEffect } from "react"
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import EditView from "@/components/EditView"
import { usePosterFit } from "@/lib/usePosterFit"
import type { SearchResult, TMDBImage } from "@/lib/types"

vi.mock("@/lib/usePosterFit", () => ({ usePosterFit: vi.fn() }))
vi.mocked(usePosterFit).mockReturnValue({ bestFitPath: null, results: [], loading: false, error: null })

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

// --- Deferred fetch rig (same idiom as editor-early-ready) ---

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: unknown[] = []

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

function queueKey(url: string): string | null {
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (u.includes("/api/mappings")) return okJson({ mappings: mappingsPayload })
      if (key) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", onAbort, { once: true })
          const q = queues.get(key) ?? []
          queues.set(key, q)
          q.push({
            resolve: (res: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              resolve(res)
            },
            reject: (err: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              reject(err)
            },
          })
        })
      }
      return okJson({})
    }),
  )
}

function resolveAll(key: string, data: unknown) {
  const q = queues.get(key) ?? []
  queues.set(key, [])
  expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
  for (const p of q) p.resolve(okJson(data))
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

// --- Fixtures: unique real paths per title (never shared) ---

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_A = {
  posters: [img("/clean-a.jpg", null)],
  logos: [],
  backdrops: [img("/bd-a1.jpg", null)],
}
const IMAGES_B = {
  posters: [img("/clean-b.jpg", null)],
  logos: [],
  backdrops: [img("/bd-b1.jpg", null)],
}

function detailsFixture(title: string) {
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
    title,
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: null,
  }
}

async function renderRoot() {
  ctx = null
  ed = null
  render(
    <PictoriumRoot>
      <Probe />
      <EditView />
    </PictoriumRoot>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  expect(ed, "editor context available").toBeTruthy()
  await flush()
}

describe("N8 direct landscape A→B open (stale collection race)", () => {
  beforeEach(() => {
    queues.clear()
    mappingsPayload = []
    localStorage.clear()
    installFetchMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("never auto-picks A's backdrop for B: empty while loading, B tile after load", async () => {
    await renderRoot()
    // User config: default format landscape, no saved mappings (fresh titles).
    await act(async () => {
      ed!.setDefaultPosterShape("landscape")
    })
    await flush(2)

    // Complete load of A: landscape init picks A's own tile.
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
    })
    resolveAll("details:101", detailsFixture("Alpha"))
    resolveAll("images:101", IMAGES_A)
    await flush()
    expect(ctx!.loadingImages).toBe(false)
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.backdrops.map((b) => b.file_path)).toEqual(["/bd-a1.jpg"])
    expect(ed!.selectedBackdrop?.file_path).toBe("/bd-a1.jpg")

    // Direct open of B (no portrait detour), B's data still in flight.
    await act(async () => {
      ctx!.navigateToPoster(ITEM_B)
    })
    await flush(2)
    expect(ctx!.selected?.id).toBe(202)
    expect(ctx!.loadingImages).toBe(true)
    // The stale A tile must NOT be painted for B while B loads: the previous
    // title's collections are dropped at open, so the init effect has no
    // foreign list to pick from (and marks nothing).
    expect(ed!.backdrops).toEqual([])
    expect(ed!.selectedBackdrop).toBeNull()

    // B's own list arrives: first visible B tile is picked and highlighted.
    resolveAll("details:202", detailsFixture("Beta"))
    resolveAll("images:202", IMAGES_B)
    await flush()
    expect(ctx!.loadingImages).toBe(false)
    expect(ed!.backdrops.map((b) => b.file_path)).toEqual(["/bd-b1.jpg"])
    expect(ed!.selectedBackdrop?.file_path).toBe("/bd-b1.jpg")
  })
})
