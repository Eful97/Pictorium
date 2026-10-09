/**
 * Correction cycle 1 — per-shape posterLayout precedence, exercised through
 * the REAL provider (PictoriumRoot, deferred network) and the REAL EditView
 * shape switch (stash), never through stubbed probes:
 * - saved landscape legacy mapping (no layout) follows the landscape profile
 *   even when the flat is standard;
 * - flat default edits never clobber an explicit landscape override while
 *   editing landscape;
 * - unmapped titles follow the default live, saved titles stay protected;
 * - defaults-only templates bake the effective per-shape layout;
 * - per-title layout survives a portrait -> landscape -> portrait round-trip.
 */
import { useEffect, createElement } from "react"
import { render, act, fireEvent, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const calls: string[] = []
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
  if (url.includes("/api/mappings")) return "mappings"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      calls.push(u)
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (key === "mappings") return okJson({ mappings: mappingsPayload })
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

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

const ITEM_9001: SearchResult = { id: 9001, media_type: "movie", title: "Layout Land", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_9001 = {
  posters: [img("/layout-it.jpg", "it")],
  logos: [img("/layout-logo.png", "it")],
  backdrops: [img("/layout-bd.jpg", null)],
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
    title: "Layout Land",
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
    </PictoriumRoot>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await flush()
}

async function open9001() {
  await act(async () => {
    ctx!.setTmdbKey("test-key")
  })
  await act(async () => {
    ctx!.navigateToPoster(ITEM_9001)
  })
  await flush(2)
  await act(async () => {
    resolveAll("details:9001", detailsFixture())
    resolveAll("images:9001", IMAGES_9001)
  })
  await flush()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  await flush()
}

beforeEach(() => {
  calls.length = 0
  queues.clear()
  mappingsPayload = []
  localStorage.clear()
  installFetchMock()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("saved landscape legacy mapping follows the land profile", () => {
  it("no layout in mapping + land fresh + flat standard opens fresh", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "landscape",
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "fresh" },
      }),
    )
    mappingsPayload = [
      {
        tmdbId: 9001,
        mediaType: "movie",
        title: "Layout Land",
        posterPath: "/saved-9001.jpg",
        logoPath: null,
        originalPosterPath: null,
        language: "it",
        updatedAt: new Date().toISOString(),
        posterShape: "landscape",
      } satisfies Mapping,
    ]
    await renderRoot()
    await open9001()
    expect(ed!.posterShape).toBe("landscape")
    // The server resolves the same case to fresh (effective mapping absent >
    // effective landscape default fresh): the editor must match.
    expect(ed!.posterLayout).toBe("fresh")
    expect(ed!.defaultPosterLayout).toBe("standard")
  })
})

describe("flat default edits never clobber the landscape override", () => {
  it("converged fresh/fresh + flat edit to standard keeps the open landscape fresh", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "landscape",
        defaultPosterLayout: "fresh",
        landscape: { posterLayout: "fresh" },
      }),
    )
    await renderRoot()
    await open9001()
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.posterLayout).toBe("fresh")
    // Flat standardizes while the landscape profile still says fresh: the
    // open unmapped landscape title must keep the explicit profile.
    await act(async () => {
      ed!.setDefaultPosterLayout("standard")
    })
    await flush()
    expect(ed!.defaultPosterLayout).toBe("standard")
    expect(ed!.landscape.posterLayout).toBe("fresh")
    expect(ed!.posterLayout).toBe("fresh")
  })
})

describe("unmapped follows live, mapped stays protected", () => {
  it("unmapped portrait follows the flat default live", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "standard" }),
    )
    await renderRoot()
    await open9001()
    expect(ed!.posterShape).toBe("poster")
    expect(ed!.posterLayout).toBe("standard")
    await act(async () => {
      ed!.setDefaultPosterLayout("fresh")
    })
    await flush()
    expect(ed!.posterLayout).toBe("fresh")
  })

  it("saved mapping never follows the default live", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "standard" }),
    )
    mappingsPayload = [
      {
        tmdbId: 9001,
        mediaType: "movie",
        title: "Layout Land",
        posterPath: "/saved-9001.jpg",
        logoPath: null,
        originalPosterPath: null,
        language: "it",
        updatedAt: new Date().toISOString(),
        posterShape: "poster",
        posterLayout: "standard",
      } satisfies Mapping,
    ]
    await renderRoot()
    await open9001()
    expect(ed!.posterLayout).toBe("standard")
    await act(async () => {
      ed!.setDefaultPosterLayout("fresh")
    })
    await flush()
    expect(ed!.defaultPosterLayout).toBe("fresh")
    expect(ed!.posterLayout).toBe("standard")
  })
})

describe("defaults-only template bakes the effective per-shape layout", () => {
  it("landscape delivery bakes the land profile", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "landscape",
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "fresh" },
      }),
    )
    await renderRoot()
    expect(ctx!.previewId).toBeNull()
    expect(paramsOf(ctx!.urlPattern).get("layout")).toBe("fresh")
  })

  it("portrait delivery bakes the flat", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "fresh" },
      }),
    )
    await renderRoot()
    expect(ctx!.previewId).toBeNull()
    expect(paramsOf(ctx!.urlPattern).get("layout")).toBe("standard")
  })
})

describe("per-title layout survives the format stash round-trip", () => {
  function renderEditorWithProbe() {
    let editor: PosterEditorCtx | null = null
    function EditorProbe() {
      const e = usePosterEditor()
      useEffect(() => {
        editor = e
      })
      return null
    }
    const selected = {
      id: 11,
      media_type: "movie",
      title: "Probe",
      poster_path: "/p.jpg",
    } as const
    renderWithCtx(
      createElement("div", null, createElement(EditView), createElement(EditorProbe)),
      {
        selected: selected as never,
        posters: [{ file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      },
    )
    return { editor: () => editor as unknown as PosterEditorCtx }
  }

  it("portrait fresh -> landscape standard -> portrait returns fresh", () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "standard" },
      }),
    )
    const { editor } = renderEditorWithProbe()
    // Per-title choice via the real editor setter (same as the selector).
    act(() => {
      editor().setPosterLayout("fresh")
    })
    expect(editor().posterLayout).toBe("fresh")
    // Real EditView switch: stash portrait, load the landscape profile.
    fireEvent.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    expect(editor().posterShape).toBe("landscape")
    expect(editor().posterLayout).toBe("standard")
    // Back: the stashed portrait choice returns, other visuals untouched.
    fireEvent.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    expect(editor().posterShape).toBe("poster")
    expect(editor().posterLayout).toBe("fresh")
  })
})
