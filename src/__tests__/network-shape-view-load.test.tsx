/**
 * N3 correction 3/3: real integration coverage for the shared network shape
 * view on the mapping-load and shape-roundtrip paths.
 *
 * - Context load of a REAL saved mapping (both shapes) with portrait-fixed
 *   defaults (200/500): a landscape mapping WITHOUT network fields must load
 *   ON with relative 0,0 (server semantics), never the flat absolutes;
 *   complete mappings (both shapes) load verbatim (overrides preserved).
 * - EditView roundtrip: portrait-fixed -> landscape -> modify -> new title
 *   (mapping without network fields) -> portrait restores the portrait
 *   fixed box (200/500 OFF), never the landscape-modified live values; the
 *   landscape side stays independent.
 */
import { useEffect } from "react"
import { render, act, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import userEvent from "@testing-library/user-event"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import EditView from "@/components/EditView"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { usePosterFit } from "@/lib/usePosterFit"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"

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

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: "/b.jpg" }
const IMAGES_B = {
  posters: [img("/b.jpg", null)],
  logos: [],
  backdrops: [],
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

function seedPortraitFixedDefaults() {
  localStorage.setItem("badgeDefaults", JSON.stringify({
    defaultNetworkLogoFollowTitle: false,
    defaultNetworkLogoOffsetX: 200,
    defaultNetworkLogoOffsetY: 500,
  }))
}

function savedMapping(overrides: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 202,
    mediaType: "movie",
    title: "Beta",
    posterPath: "/b.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    ...overrides,
  }
}

async function openSavedTitle() {
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
  await act(async () => {
    ctx!.navigateToPoster(ITEM_B)
  })
  resolveAll("details:202", detailsFixture("Beta"))
  resolveAll("images:202", IMAGES_B)
  await flush()
  expect(ctx!.loadingImages).toBe(false)
}

describe("context load of a real saved mapping (network shape view)", () => {
  beforeEach(() => {
    queues.clear()
    mappingsPayload = []
    localStorage.clear()
    installFetchMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("landscape mapping without network fields loads ON with relative 0,0", async () => {
    seedPortraitFixedDefaults()
    mappingsPayload = [savedMapping({ posterShape: "landscape" })]
    await openSavedTitle()
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.networkLogoFollowTitle).toBe(true)
    expect(ed!.networkLogoOffsetX).toBe(0)
    expect(ed!.networkLogoOffsetY).toBe(0)
  })

  it("portrait mapping without network fields loads the fixed box verbatim", async () => {
    seedPortraitFixedDefaults()
    mappingsPayload = [savedMapping({ posterShape: "poster" })]
    await openSavedTitle()
    expect(ed!.posterShape).toBe("poster")
    expect(ed!.networkLogoFollowTitle).toBe(false)
    expect(ed!.networkLogoOffsetX).toBe(200)
    expect(ed!.networkLogoOffsetY).toBe(500)
  })

  it("landscape mapping with fixed network fields is preserved", async () => {
    seedPortraitFixedDefaults()
    mappingsPayload = [savedMapping({
      posterShape: "landscape",
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300 },
    })]
    await openSavedTitle()
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.networkLogoFollowTitle).toBe(false)
    expect(ed!.networkLogoOffsetX).toBe(120)
    expect(ed!.networkLogoOffsetY).toBe(300)
  })

  it("portrait mapping with fixed network fields is preserved", async () => {
    seedPortraitFixedDefaults()
    mappingsPayload = [savedMapping({
      posterShape: "poster",
      networkLogoFollowTitle: false,
      networkLogoOffsetX: 120,
      networkLogoOffsetY: 300,
    })]
    await openSavedTitle()
    expect(ed!.posterShape).toBe("poster")
    expect(ed!.networkLogoFollowTitle).toBe(false)
    expect(ed!.networkLogoOffsetX).toBe(120)
    expect(ed!.networkLogoOffsetY).toBe(300)
  })
})

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }

function portraitMappingNoNetwork(): Mapping {
  return {
    tmdbId: 202,
    mediaType: "movie",
    title: "Beta",
    posterPath: "/b.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    posterShape: "poster",
  }
}

/** Same mount, switchable provider value: mirrors opening another title in
 *  the same session (editor state persists, provider value changes). */
function renderSwitchableEditor(first: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  function SwitchProbe() {
    const e = usePosterEditor()
    useEffect(() => {
      capture.ed = e
    })
    return null
  }
  function Host({ over }: { over: Record<string, unknown> }) {
    const value = {
      ...MOCK_CTX,
      ...over,
    }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={value}>
            <EditView />
            <SwitchProbe />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host over={first} />)
  return {
    ...view,
    show: (over: Record<string, unknown>) => view.rerender(<Host over={over} />),
    editor: () => capture.ed as PosterEditorCtx,
  }
}

describe("EditView shape roundtrip keeps portrait fixed and landscape independent", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returning to portrait after landscape edits restores the fixed box", async () => {
    seedPortraitFixedDefaults()
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map(),
    }
    const { editor, show } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Portrait starts from the fixed defaults box.
    expect(editor().networkLogoFollowTitle).toBe(false)
    expect(editor().networkLogoOffsetX).toBe(200)
    expect(editor().networkLogoOffsetY).toBe(500)
    // Landscape follows with relative offsets (server semantics).
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().networkLogoFollowTitle).toBe(true)
    expect(editor().networkLogoOffsetX).toBe(0)
    // Modify the landscape live values, then open another title whose saved
    // mapping carries no network fields (stash cleared by the key change).
    await act(async () => {
      editor().setNetworkLogoOffsetX(50)
      editor().setNetworkLogoOffsetY(60)
    })
    show({
      ...first,
      selected: ITEM_B,
      previewPoster: img("/b.jpg", null),
      mappingsMap: new Map([["movie:202", portraitMappingNoNetwork()]]),
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Portrait fixed box restored: never the landscape-modified live values.
    expect(editor().networkLogoFollowTitle).toBe(false)
    expect(editor().networkLogoOffsetX).toBe(200)
    expect(editor().networkLogoOffsetY).toBe(500)
  })
})
