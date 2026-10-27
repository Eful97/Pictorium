/**
 * Direct badge editing of an INDIVIDUAL TITLE (`PerTitleBadgeEditor`).
 *
 * Contract asserted here with the REAL provider, the REAL EditView and the REAL
 * overlay (no component mocks, no setter-only fakes):
 *
 * - the fullscreen entry of the per-title preview mounts the SAME overlay the
 *   settings editor uses, with the per-title adapter: handles come from the
 *   boxes the shared renderer reported for the displayed preview URL;
 * - move/resize/reset/rejoin write the OPEN title's draft only: a global
 *   default, the other shape's profile, the applied-preset baseline and the
 *   saved mapping are never touched (no request, no mapping mutation);
 * - the numeric Transform controls and the gestures share one state, so they
 *   cannot desynchronize;
 * - "Testa URL Stremio" keeps showing the SAVED state while the draft diverges;
 * - the existing Save button is the ONLY persistence boundary: it writes this
 *   title and this shape (flat or landscape profile, `bit` included);
 * - without Save nothing leaks: opening the next title starts from ITS saved
 *   values and re-opening the edited one shows the saved truth again;
 * - a title change closes the surface, so no overlay state survives and no
 *   callback can land on the next title.
 */
import { StrictMode, useEffect, type ReactNode } from "react"
import { render, act, waitFor, screen, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { SearchResult, TMDBImage } from "@/lib/types"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { usePerTitleBadgeGeometry } from "@/lib/usePerTitleBadgeGeometry"
import type { BadgeDragGeometryAdapter } from "@/lib/badge-drag-adapter"
import EditView from "@/components/EditView"

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

/* ------------------------------------------------------------------ */
/* Transport stubs: the preview bitmap (XHR) and the JSON APIs (fetch)  */
/* ------------------------------------------------------------------ */

class LoadableXHR {
  static instances: LoadableXHR[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: ProgressEvent) => void) | null = null
  responseType = ""
  timeout = 0
  status = 200
  response: unknown = new Blob()
  constructor() {
    LoadableXHR.instances.push(this)
  }
  open() {}
  send() {}
  abort() {}
  setRequestHeader() {}
  getResponseHeader() {
    return null
  }
  finish() {
    this.onload?.()
  }
}

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: Record<string, unknown>[] = []
/** Bodies of every persistence POST (empty = nothing was saved). */
let savedBodies: Record<string, unknown>[] = []

/** Displayed size of the enlarged editor surface for a 500x750 canvas. */
const DISPLAY = { width: 250, height: 375 }

/**
 * Geometry the renderer reports for the preview URL. Boxes are deliberately
 * far from the poster centre / the neighbouring edges so snapping never
 * changes the asserted delta.
 */
const GEOMETRY = {
  canvasW: 500,
  canvasH: 750,
  kind: "rank",
  layout: "ranked",
  families: {
    rank: { top: 20, left: 150, w: 120, h: 40 },
    quality: { top: 100, left: 350, w: 100, h: 80 },
    separate: { top: 300, left: 350, w: 100, h: 120 },
    logo: { top: 620, left: 100, w: 200, h: 60 },
  },
  fixedX: {},
  items: [
    { id: "quality:tier", family: "quality", top: 100, left: 350, w: 100, h: 26, custom: false },
    { id: "rating:imdb", family: "separate", top: 300, left: 350, w: 100, h: 40, custom: false },
  ],
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    blob: async () => new Blob(),
    json: async () => data,
  }
}

function queueKey(url: string): string | null {
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  m = url.match(/\/api\/trending\/rank\?[^ ]*[?&]id=(\d+)/)
  if (m) return `rank:${m[1]}`
  m = url.match(/\/api\/awards\/\w+\/(\d+)/)
  if (m) return `awards:${m[1]}`
  return null
}

/**
 * The addon `/meta` payload: the poster URL the SAVED mapping resolves to.
 * "Testa URL Stremio" reads this endpoint, so it proves what the user would
 * see in Stremio — never the unsaved draft.
 */
function savedMetaPoster(): string {
  const saved = mappingsPayload[0] ?? {}
  const land = (saved.landscape ?? {}) as Record<string, unknown>
  const shape = saved.posterShape === "landscape" ? land : saved
  const qox = shape.qualityBadgeOffsetX ?? 0
  const bit = shape.badgeItemTransforms ?? ""
  return `https://example.test/poster.png?qox=${qox}&bit=${encodeURIComponent(String(bit))}`
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      const u = String(url)
      const method = (init?.method ?? "GET").toUpperCase()
      if (u.includes("/api/mappings") && method === "GET") return okJson({ mappings: [...mappingsPayload] })
      if (u.includes("/api/mappings")) {
        // Persistence boundary: the saved truth moves ONLY here.
        const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
        savedBodies.push(body)
        const idx = mappingsPayload.findIndex(
          (m) => m.tmdbId === body.tmdbId && m.mediaType === body.mediaType,
        )
        const merged = { ...(idx >= 0 ? mappingsPayload[idx] : {}), ...body }
        if (idx >= 0) mappingsPayload[idx] = merged
        else mappingsPayload.push(merged)
        return okJson({})
      }
      if (u.includes("/meta/")) return okJson({ meta: { poster: savedMetaPoster() } })
      // Diagnostic geometry of the shared renderer (`debug=1&netgeo=1`).
      if (u.includes("/api/poster/")) return okJson({ network: null, badges: GEOMETRY })
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
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

function imagesFixture(tag: string) {
  return {
    posters: [img(`/clean-${tag}.jpg`, null), img(`/it-${tag}.jpg`, "it")],
    logos: [img(`/logo-${tag}.png`, "it")],
    backdrops: [img(`/bd-${tag}.jpg`, null)],
  }
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
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
  }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: null }

function savedMapping(item: SearchResult, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tmdbId: item.id,
    mediaType: item.media_type,
    title: item.title,
    posterPath: `/clean-${item.id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: new Date().toISOString(),
    ...extra,
  }
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

/** The app tree every test renders (optionally under the real StrictMode). */
function appTree(opts: { strict?: boolean; extra?: ReactNode } = {}) {
  const tree = (
    <ThemeProvider>
      <PictoriumRoot>
        <Probe />
        <EditView />
        {opts.extra ?? null}
      </PictoriumRoot>
    </ThemeProvider>
  )
  // StrictMode must wrap OUTSIDE the app providers: nested inside them the
  // effect replay never reaches the provider subtree.
  return opts.strict ? <StrictMode>{tree}</StrictMode> : tree
}

async function renderRoot(opts: { strict?: boolean; extra?: ReactNode } = {}) {
  ctx = null
  ed = null
  const root = render(appTree(opts))
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await waitFor(() => expect(ed!.defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await flush()
  return root
}

/** Settle the preview bitmap the modal gate waits for. */
async function settlePreview() {
  const xhr = LoadableXHR.instances[LoadableXHR.instances.length - 1]
  if (xhr) await act(async () => { xhr.finish() })
  await flush()
}

async function openItem(item: SearchResult) {
  await act(async () => {
    await ctx!.setTmdbKey("test-key")
  })
  const id = item.id
  const opened = act(async () => {
    await ctx!.navigateToPoster(item)
  })
  resolveAll(`details:${id}`, detailsFixture(String(item.title)))
  resolveAll(`images:${id}`, imagesFixture(String(id)))
  await opened
  await flush()
  await settlePreview()
}

/** Open the fullscreen per-title editor and give the overlay a real surface. */
async function openBadgeEditor() {
  fireEvent.click(screen.getByTestId("per-title-badge-editor-open"))
  await screen.findByTestId("per-title-badge-editor")
  await settlePreview()
  await screen.findByTestId("per-title-badge-editor-drag-area")
  const layer = await screen.findByTestId("badge-drag-layer")
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, width: DISPLAY.width, height: DISPLAY.height,
    top: 0, left: 0, right: DISPLAY.width, bottom: DISPLAY.height,
    toJSON: () => ({}),
  } as DOMRect)
  return layer
}

/** Drag a handle by `screenDx` screen px (the overlay projects to canvas px). */
function dragHandle(handle: HTMLElement, screenDx: number, screenDy = 0, pointerId = 77) {
  fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId })
  fireEvent.pointerMove(handle, { clientX: 100 + screenDx, clientY: 100 + screenDy, pointerId })
  fireEvent.pointerUp(handle, { clientX: 100 + screenDx, clientY: 100 + screenDy, pointerId })
}

/** 10 screen px on a 250px surface = 20 canvas px of a 500px canvas. */
const CANVAS_DELTA = 20

/**
 * Adapter instances of every mount, oldest first (`usePerTitleBadgeGeometry`
 * pulled out of the overlay so the write guard can be exercised directly).
 */
let adapterHistory: BadgeDragGeometryAdapter[] = []

function AdapterProbe({ identity }: { identity: string }) {
  const adapter = usePerTitleBadgeGeometry(identity)
  useEffect(() => {
    adapterHistory.push(adapter)
  })
  return null
}

function previewBit(): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("bit")
}

function previewParam(name: string): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(name)
}

beforeEach(() => {
  queues.clear()
  mappingsPayload = []
  savedBodies = []
  LoadableXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", LoadableXHR as unknown as typeof XMLHttpRequest)
  // Real `URL` constructor stays available (the app builds URLs with it): only
  // the object-URL transport of the preview bitmap is stubbed.
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:pictorium-preview", writable: true, configurable: true })
  Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true, configurable: true })
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  installFetchMock()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("per-title direct editing — draft only", () => {
  it("moves a GROUP on the title's live state, keeps defaults/mapping/saved URL intact, and the numeric control in sync", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5, qualityBadgeOffsetY: 0 })]
    await renderRoot()
    await openItem(ITEM_A)
    expect(ed!.qualityBadgeOffsetX).toBe(5)
    const globalBefore = ed!.defaultQualityBadgeOffsetX

    const layer = await openBadgeEditor()
    expect(layer.getAttribute("data-layout")).toBe("ranked")
    const handle = await screen.findByTestId("badge-drag-handle-quality")
    dragHandle(handle, 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA))

    // The draft reaches the preview URL (single shared renderer).
    // The preview URL is debounced (200ms): wait for the rebuilt URL.
    await waitFor(() => expect(previewParam("qox")).toBe(String(5 + CANVAS_DELTA)), { timeout: 3000 })
    // Nothing global, nothing persisted.
    expect(ed!.defaultQualityBadgeOffsetX).toBe(globalBefore)
    expect(savedBodies).toHaveLength(0)
    expect(mappingsPayload[0].qualityBadgeOffsetX).toBe(5)
    // The numeric Transform control reads the SAME state (cannot desync).
    const user = userEvent.setup()
    await user.click(screen.getByRole("tab", { name: "ui.transform" }))
    await flush()
    const sliders = screen.getAllByRole("slider")
    expect(sliders.some((s) => s.getAttribute("aria-valuetext") === `${5 + CANVAS_DELTA}px`)).toBe(true)
  })

  it("moves a single BADGE (item correction) without touching the group, the defaults or the mapping", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { separateBadgeOffsetX: 3 })]
    await renderRoot()
    await openItem(ITEM_A)
    await openBadgeEditor()
    const user = userEvent.setup()
    await user.click(screen.getByTestId("per-title-badge-editor-target-level-item"))
    const item = await screen.findByTestId("badge-item-handle-rating:imdb")
    dragHandle(item, 10)

    await waitFor(() => expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["rating:imdb"]).toBeTruthy())
    const stored = parseBadgeItemTransforms(ed!.badgeItemTransforms)
    expect(stored["rating:imdb"]).toMatchObject({ offsetX: CANVAS_DELTA })
    expect(stored["rating:tmdb"]).toBeUndefined()
    // Group geometry, global defaults and the saved mapping are untouched.
    expect(ed!.separateBadgeOffsetX).toBe(3)
    expect(ed!.defaultBadgeItemTransforms).toBeNull()
    expect(ed!.defaultSeparateBadgeOffsetX).toBe(0)
    expect(savedBodies).toHaveLength(0)
    expect(mappingsPayload[0].badgeItemTransforms).toBeUndefined()
    // The correction is what the preview asks the shared renderer for.
    await waitFor(() => expect(previewBit()).toContain("rating:imdb"), { timeout: 3000 })
  })

  it("Testa URL Stremio keeps showing the SAVED poster while the draft diverges", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 })]
    await renderRoot()
    await openItem(ITEM_A)
    await openBadgeEditor()
    const handle = await screen.findByTestId("badge-drag-handle-quality")
    dragHandle(handle, 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA))

    // The addon metadata is resolved from the SAVED mapping: no draft leak.
    await act(async () => {
      ctx!.setStremioPreview(true)
    })
    await waitFor(() => expect(ctx!.stremioPreviewUrl).toBeTruthy(), { timeout: 3000 })
    expect(ctx!.stremioPreviewUrl).toContain("qox=5&")
    expect(ctx!.stremioPreviewUrl).not.toContain(`qox=${5 + CANVAS_DELTA}`)
  })

  it("saves ONLY this title and this shape (flat fields + bit), never the other title", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 })]
    await renderRoot()
    await openItem(ITEM_A)
    await openBadgeEditor()
    await dragHandle(await screen.findByTestId("badge-drag-handle-quality"), 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA))
    const user = userEvent.setup()
    await user.click(screen.getByTestId("per-title-badge-editor-target-level-item"))
    await dragHandle(await screen.findByTestId("badge-item-handle-rating:imdb"), 10)
    await waitFor(() => expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["rating:imdb"]).toBeTruthy())

    await user.click(screen.getAllByRole("button", { name: "ui.savePoster" })[0])
    await waitFor(() => expect(savedBodies).toHaveLength(1), { timeout: 3000 })
    const body = savedBodies[0]
    expect(body.tmdbId).toBe(ITEM_A.id)
    expect(body.mediaType).toBe(ITEM_A.media_type)
    expect(body.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA)
    expect(String(body.badgeItemTransforms)).toContain("rating:imdb")
    // Portrait save: the landscape profile never carries the dragged geometry
    // (per-shape independence; a style backfill column may still exist).
    expect((body.landscape as Record<string, unknown> | null)?.qualityBadgeOffsetX ?? null).toBeNull()
    // Only one title was ever written.
    expect(savedBodies.every((b) => b.tmdbId === ITEM_A.id)).toBe(true)
  })

  it("without Save nothing leaks into the next title, and re-opening shows the saved truth", async () => {
    mappingsPayload = [
      savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 }),
      savedMapping(ITEM_B, { qualityBadgeOffsetX: 7 }),
    ]
    await renderRoot()
    await openItem(ITEM_A)
    await openBadgeEditor()
    await dragHandle(await screen.findByTestId("badge-drag-handle-quality"), 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA))

    // Next title, no Save: its OWN saved value, never title A's draft, and the
    // fullscreen surface of the previous title is gone.
    await openItem(ITEM_B)
    expect(ed!.qualityBadgeOffsetX).toBe(7)
    expect(screen.queryByTestId("per-title-badge-editor")).toBeNull()

    // Back to A: the draft was discarded by the existing open flow.
    await openItem(ITEM_A)
    expect(ed!.qualityBadgeOffsetX).toBe(5)
    expect(savedBodies).toHaveLength(0)
    expect(mappingsPayload[1].qualityBadgeOffsetX).toBe(7)
  })

  it("writes the title's LANDSCAPE draft and saves it in the landscape profile only", async () => {
    mappingsPayload = [savedMapping(ITEM_A, {
      posterShape: "landscape",
      qualityBadgeOffsetX: 1,
      landscape: { qualityBadgeOffsetX: 2 },
    })]
    await renderRoot()
    await openItem(ITEM_A)
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.qualityBadgeOffsetX).toBe(2)
    const globalLandscape = ed!.landscape?.qualityBadgeOffsetX

    await openBadgeEditor()
    await dragHandle(await screen.findByTestId("badge-drag-handle-quality"), 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(2 + CANVAS_DELTA))
    // The global landscape profile is untouched by a per-title gesture.
    expect(ed!.landscape?.qualityBadgeOffsetX).toBe(globalLandscape)
    expect(savedBodies).toHaveLength(0)

    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: "ui.savePoster" })[0])
    await waitFor(() => expect(savedBodies).toHaveLength(1), { timeout: 3000 })
    const body = savedBodies[0]
    const land = body.landscape as Record<string, unknown>
    expect(body.posterShape).toBe("landscape")
    expect(land.qualityBadgeOffsetX).toBe(2 + CANVAS_DELTA)
    // The flat portrait column keeps the saved value (per-shape independence).
    expect(body.qualityBadgeOffsetX).toBe(1)
  })

  it("double-click resets a group to the per-title reset reference, not to an applied-preset baseline", async () => {
    mappingsPayload = [savedMapping(ITEM_A, {
      posterShape: "landscape",
      landscape: {
        qualityBadgeOffsetX: 40,
        qualityBadgeOffsetY: 40,
        badgeItemTransforms: "quality:tier=80,-6,12;rating:imdb=110,2,0",
      },
    })]
    await renderRoot()
    // Global shape defaults are the reset reference of the per-title buttons.
    await act(async () => {
      ed!.setLandscape({ qualityBadgeOffsetX: 4 })
    })
    await openItem(ITEM_A)
    expect(ed!.qualityBadgeOffsetX).toBe(40)

    await openBadgeEditor()
    fireEvent.doubleClick(await screen.findByTestId("badge-drag-handle-quality"))
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(4))
    expect(ed!.qualityBadgeOffsetY).toBe(0)
    // The reset family owns its item corrections: they go back to the automatic
    // layout, while another family's badge keeps its own correction.
    await waitFor(() => expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["quality:tier"]).toBeUndefined())
    expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["rating:imdb"]).toEqual({ scale: 110, offsetX: 2, offsetY: 0 })
    // A reset is a draft write: defaults/profile/mapping unchanged, no request.
    expect(ed!.landscape?.qualityBadgeOffsetX).toBe(4)
    expect(savedBodies).toHaveLength(0)
    expect((mappingsPayload[0].landscape as Record<string, unknown>).qualityBadgeOffsetX).toBe(40)
  })

  it("rejoin drops only the selected family's corrections and keeps the group and the other badges", async () => {
    mappingsPayload = [savedMapping(ITEM_A, {
      badgeItemTransforms: "quality:tier=80,-6,12;rating:imdb=110,2,0",
      qualityBadgeOffsetX: 9,
    })]
    await renderRoot()
    await openItem(ITEM_A)
    const before = parseBadgeItemTransforms(ed!.badgeItemTransforms)
    expect(before["quality:tier"]).toBeTruthy()

    await openBadgeEditor()
    const user = userEvent.setup()
    await user.click(screen.getByTestId("per-title-badge-editor-target-level-item"))
    const tier = await screen.findByTestId("badge-item-handle-quality:tier")
    fireEvent.pointerDown(tier, { button: 0, clientX: 100, clientY: 100, pointerId: 91 })
    fireEvent.pointerUp(tier, { button: 0, clientX: 100, clientY: 100, pointerId: 91 })
    const bar = await screen.findByTestId("badge-drag-rejoin-bar")
    await user.click(within(bar).getByTestId("badge-drag-rejoin"))

    await waitFor(() => expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["quality:tier"]).toBeUndefined())
    const after = parseBadgeItemTransforms(ed!.badgeItemTransforms)
    // Only the selected badge's correction is gone.
    expect(after["rating:imdb"]).toEqual({ scale: 110, offsetX: 2, offsetY: 0 })
    // Group geometry and the persistence boundary are untouched.
    expect(ed!.qualityBadgeOffsetX).toBe(9)
    expect(savedBodies).toHaveLength(0)
  })
})

describe("per-title direct editing — write guard", () => {
  /**
   * Regression: `mountedRef` started true and the mount effect ONLY cleared it
   * in cleanup, so React's dev StrictMode setup→cleanup→setup replay left the
   * flag false forever and every direct per-title write was silently dropped
   * (the "gesture shows a frame, nothing is stored" class of bug).
   */
  it("StrictMode effect replay keeps group and item gestures writable", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 })]
    await renderRoot({ strict: true })
    await openItem(ITEM_A)
    expect(ed!.qualityBadgeOffsetX).toBe(5)

    await openBadgeEditor()
    dragHandle(await screen.findByTestId("badge-drag-handle-quality"), 10)
    await waitFor(() => expect(ed!.qualityBadgeOffsetX).toBe(5 + CANVAS_DELTA))

    // Direct per-ITEM writes go through the same guard: they must survive the
    // replay too (the reported failure mode is exactly a dropped write).
    const user = userEvent.setup()
    await user.click(screen.getByTestId("per-title-badge-editor-target-level-item"))
    dragHandle(await screen.findByTestId("badge-item-handle-rating:imdb"), 10)
    await waitFor(() => expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["rating:imdb"]).toBeTruthy())
    expect(parseBadgeItemTransforms(ed!.badgeItemTransforms)["rating:imdb"]).toMatchObject({ offsetX: CANVAS_DELTA })
    // Still a draft: nothing left the per-title state.
    expect(savedBodies).toHaveLength(0)
  })

  it("refuses writes after the surface actually unmounts", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 })]
    adapterHistory = []
    const root = await renderRoot({ extra: <AdapterProbe identity="movie:101" /> })
    await openItem(ITEM_A)
    expect(ed!.qualityBadgeOffsetX).toBe(5)

    const mounted = adapterHistory[adapterHistory.length - 1]
    act(() => mounted.resetFamilies(["quality"]))
    await flush()
    // The guard is open while mounted (this is the same write path the overlay
    // uses, reached directly so the unmounted case can be exercised).
    expect(ed!.qualityBadgeOffsetX).not.toBe(5)

    await act(async () => {
      ed!.setQualityBadgeOffsetX(9)
    })
    // Real unmount: cleanup runs, no further setup.
    root.rerender(appTree())
    await flush()
    act(() => mounted.resetFamilies(["quality"]))
    act(() => mounted.resetItems(["rating:imdb"]))
    await flush()
    expect(ed!.qualityBadgeOffsetX).toBe(9)
    // No throw, no write: the stale adapter is inert.
  })

  it("refuses writes of an adapter whose owner identity changed", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { qualityBadgeOffsetX: 5 })]
    adapterHistory = []
    const root = await renderRoot({ extra: <AdapterProbe identity="movie:101" /> })
    await openItem(ITEM_A)
    const stale = adapterHistory[adapterHistory.length - 1]
    const scaleBefore = ed!.qualityBadgeScale

    // Same surface, next title: the captured closure keeps the OLD identity.
    root.rerender(appTree({ extra: <AdapterProbe identity="movie:202" /> }))
    await flush()
    const live = adapterHistory[adapterHistory.length - 1]
    expect(live).not.toBe(stale)

    act(() => stale.setFamilyScale("quality", scaleBefore + 40))
    await flush()
    expect(ed!.qualityBadgeScale).toBe(scaleBefore)

    act(() => live.setFamilyScale("quality", scaleBefore + 40))
    await flush()
    expect(ed!.qualityBadgeScale).toBe(scaleBefore + 40)
  })

  /**
   * Why one item write per gesture is enough (no batched family+item reset can
   * reach `setBadgeItemTransforms` twice in a tick): the overlay keeps ONE
   * hit-testable level at a time and a level switch drops the selection, so a
   * double-click can never reset a group and an unrelated badge together.
   */
  it("a level switch drops the group selection, so a reset batch never mixes families and items", async () => {
    mappingsPayload = [savedMapping(ITEM_A, {
      badgeItemTransforms: "quality:tier=80,-6,12;rating:imdb=110,2,0",
      qualityBadgeOffsetX: 9,
    })]
    await renderRoot()
    await openItem(ITEM_A)
    await openBadgeEditor()

    // Select the quality GROUP, then move to the item level: the group
    // selection must not survive, otherwise one gesture would carry both.
    const groupHandle = await screen.findByTestId("badge-drag-handle-quality")
    fireEvent.pointerDown(groupHandle, { button: 0, clientX: 100, clientY: 100, pointerId: 95 })
    fireEvent.pointerUp(groupHandle, { button: 0, clientX: 100, clientY: 100, pointerId: 95 })
    expect(groupHandle.getAttribute("data-selected")).toBe("true")

    const user = userEvent.setup()
    await user.click(screen.getByTestId("per-title-badge-editor-target-level-item"))
    fireEvent.doubleClick(await screen.findByTestId("badge-item-handle-rating:imdb"))

    const after = parseBadgeItemTransforms(ed!.badgeItemTransforms)
    // Only the double-clicked badge lost its correction: no group reset fired.
    expect(after["rating:imdb"]).toBeUndefined()
    expect(after["quality:tier"]).toEqual({ scale: 80, offsetX: -6, offsetY: 12 })
    expect(ed!.qualityBadgeOffsetX).toBe(9)
    expect(savedBodies).toHaveLength(0)
  })
})
