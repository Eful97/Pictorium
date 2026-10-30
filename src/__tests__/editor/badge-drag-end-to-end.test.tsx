/**
 * END-TO-END regression of direct badge editing (gesture → editor state →
 * preview URL → renderer).
 *
 * Why this file exists: the overlay unit tests exercise the component with its
 * own prop defaults, so they never reproduced the reported bug ("I move them
 * but nothing happens"). These tests mount the REAL preview component (real
 * editor state, real preview URL builder, real renderer geometry) and check
 * the whole chain:
 *
 * 1. the ordinary move must work out of the box (no preference was ever
 *    stored) — the drag-mode safety switch defaulted to OFF and swallowed
 *    every pointer move, leaving only a selection;
 * 2. Windows-like multi-selection: Ctrl/Cmd-click adds/removes, one drag moves
 *    the whole selection with a SINGLE shared delta clamped to every selected
 *    box, and the write is one atomic map update (React batching must not drop
 *    all but the last item);
 * 3. double-click on a GROUP restores that family's automatic layout of the
 *    active profile AND clears that family's per-item overrides (otherwise the
 *    items stay outside the restored layout), while other families' item
 *    overrides survive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import sharp from "sharp"
import { DefaultsPosterPreview, buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import type { BadgeDragGeometryAdapter } from "@/lib/badge-drag-adapter"
import { generatePosterBuffer, type BadgeGeometryReport, type GenerationInput } from "@/lib/poster-service"
import { STD_H, STD_W } from "@/lib/poster-render-helpers"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

/* ------------------------------------------------------------------ */
/* Real renderer geometry (no hand-written boxes for the item flow)    */
/* ------------------------------------------------------------------ */

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "standard",
    videoFormats: ["dv"],
    separateRatings: [
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
    ],
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

async function renderGeometry(overrides: Partial<GenerationInput> = {}): Promise<BadgeGeometryReport> {
  const posterBuf = await sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
  let geometry: BadgeGeometryReport | null = null
  await generatePosterBuffer(
    posterInput({ ...overrides, posterBuf, onBadgeGeometry: (geo) => { geometry = geo } }),
  )
  if (!geometry) throw new Error("the renderer reported no badge geometry")
  return geometry as unknown as BadgeGeometryReport
}

/* ------------------------------------------------------------------ */
/* Real preview component transport stubs (same as the zoom tests)     */
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
  finish() {
    this.onload?.()
  }
}

/** Reported poster width of the enlarged preview in the jsdom surface. */
const DISPLAY = { width: 250, height: 375 }

function stubDisplayRect(element: HTMLElement) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, width: DISPLAY.width, height: DISPLAY.height,
    top: 0, left: 0, right: DISPLAY.width, bottom: DISPLAY.height,
    toJSON: () => ({}),
  } as DOMRect)
}

/** Drag a handle by `screenDx` screen px (the layer projects it to canvas px). */
function dragHandle(handle: HTMLElement, screenDx: number, screenDy = 0, pointerId = 41) {
  fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId })
  fireEvent.pointerMove(handle, { clientX: 100 + screenDx, clientY: 100 + screenDy, pointerId })
  fireEvent.pointerUp(handle, { clientX: 100 + screenDx, clientY: 100 + screenDy, pointerId })
}

/* ------------------------------------------------------------------ */

beforeEach(() => {
  localStorage.clear()
  LoadableXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", LoadableXHR as unknown as typeof XMLHttpRequest)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Mounts the real preview with real editor state and the given geometry. */
async function mountPreview(badgesPayload: unknown) {
  vi.useFakeTimers()
  // The preview loads its poster through an object URL (XHR above): stub only
  // that part, so the real `URL` constructor stays available for the URL
  // assertions.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:pictorium-preview",
    revokeObjectURL: () => {},
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ network: null, badges: badgesPayload }) })),
  )
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    createElement("div", null, createElement(DefaultsPosterPreview, {}), createElement(Probe)),
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  const xhr = LoadableXHR.instances[LoadableXHR.instances.length - 1]
  await act(async () => {
    xhr.finish()
  })
  vi.useRealTimers()
  fireEvent.click(screen.getByLabelText("ui.badgeEditOpen"))
  await screen.findByTestId("defaults-preview-zoom-drag-area")
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function previewUrlOf(ctx: PosterEditorCtx): string {
  return buildDefaultsPreviewUrlFromEditor(ctx, {
    tmdbKey: "",
    userId: null,
    lang: "it",
    demoMedia: null,
    previewShape: null,
    previewFamily: null,
  }).url
}

describe("ordinary badge move works out of the box (reported bug)", () => {
  it("moves the element on a plain drag with NO stored preference", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const { ctx } = await mountPreview({
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      // Away from every snap axis: a plain +20 canvas px move with no snap.
      families: {
        rank: { top: 20, left: 90, w: 120, h: 40 },
        genre: { top: 700, left: 150, w: 200, h: 30 },
      },
      fixedX: {},
      items: [],
    })
    // The preference was never written (first-time user).
    expect(localStorage.getItem("previewBadgeDrag")).toBeNull()
    const handle = await screen.findByTestId("badge-drag-handle-rank")
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))
    // Drag right by 10 screen px on a 250px surface showing a 500px canvas.
    dragHandle(handle, 10)
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(20))
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    // The same value travels in the preview URL (single source, WYSIWYG).
    expect(previewUrlOf(ctx())).toContain("tox=20")
  })
})

describe("a click never nudges the element", () => {
  it("selects on press/release without snapping the stored offset", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const { ctx } = await mountPreview({
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      // Centre 150 is 100 canvas px away from the poster centre: no snap should
      // pull it there, and a zero delta must stay a zero delta.
      families: {
        rank: { top: 20, left: 90, w: 120, h: 40 },
        genre: { top: 700, left: 150, w: 200, h: 30 },
      },
      fixedX: {},
      items: [],
    })
    const handle = await screen.findByTestId("badge-drag-handle-rank")
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))
    // Press + release with NO movement: magnet snapping must not fire.
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 51 })
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 100, pointerId: 51 })
    await waitFor(() => expect(handle.getAttribute("aria-pressed")).toBe("true"))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    // The preview URL carries the unchanged offset (`tox` is always explicit).
    expect(previewUrlOf(ctx())).toContain("tox=0&")
  })
})

describe("multi-selection writes are atomic and move the real render", () => {
  it("moves every selected item by one shared delta in a single update", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const geometry = await renderGeometry()
    const ids = geometry.items.map((item) => item.id)
    expect(ids).toContain("rating:imdb")
    expect(ids).toContain("rating:tmdb")

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ network: null, badges: geometry }) })),
    )
    let ed: PosterEditorCtx | null = null
    function Probe() {
      ed = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement(
        "div",
        { style: { position: "relative", width: DISPLAY.width, height: DISPLAY.height } },
        createElement(PosterBadgeDragLayer, {
          previewUrl: "http://localhost:3000/api/poster/movie/1?rv=9&scale=60",
          shape: "poster",
          enabled: true,
          targetLevel: "item",
        }),
        createElement(Probe),
      ),
    )
    const imdb = await screen.findByTestId("badge-item-handle-rating:imdb")
    const tmdb = await screen.findByTestId("badge-item-handle-rating:tmdb")
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))
    // Windows-like additive selection: Ctrl-click adds without dropping IMDb.
    fireEvent.pointerDown(imdb, { button: 0, clientX: 100, clientY: 100, pointerId: 11 })
    fireEvent.pointerUp(imdb, { button: 0, clientX: 100, clientY: 100, pointerId: 11 })
    fireEvent.pointerDown(tmdb, { button: 0, clientX: 100, clientY: 120, pointerId: 12, ctrlKey: true })
    fireEvent.pointerUp(tmdb, { button: 0, clientX: 100, clientY: 120, pointerId: 12, ctrlKey: true })
    await waitFor(() => expect(imdb.getAttribute("aria-pressed")).toBe("true"))
    expect(tmdb.getAttribute("aria-pressed")).toBe("true")
    // One drag of one member moves the whole selection together.
    dragHandle(imdb, 0, 10, 13)
    await waitFor(() => expect(ed!.defaultBadgeItemTransforms).not.toBeNull())
    const stored = parseBadgeItemTransforms(ed!.defaultBadgeItemTransforms)
    // Both SELECTED positions carry the SAME delta: the second write did not
    // clobber the first inside the same React batch. The defaults surface
    // writes POSITIONAL slots (paint order: imdb = 1, tmdb = 2), never the
    // provider identities (those stay per-title).
    expect(stored["rating:slot:1"]).toMatchObject({ offsetX: 0 })
    expect(stored["rating:slot:2"]).toMatchObject({ offsetX: 0 })
    expect(stored["rating:slot:1"]?.offsetY ?? 0).toBeGreaterThan(0)
    expect(stored["rating:slot:2"]?.offsetY).toBe(stored["rating:slot:1"]?.offsetY)
    // Nothing else was touched: no provider identity, no third slot.
    expect(stored["rating:imdb"]).toBeUndefined()
    expect(stored["rating:tmdb"]).toBeUndefined()
    expect(stored["rating:tomatoes"]).toBeUndefined()
    expect(stored["rating:slot:3"]).toBeUndefined()

    // The stored correction reaches the REAL renderer through the preview URL.
    const url = previewUrlOf(ed!)
    const bit = new URL(url).searchParams.get("bit")
    expect(bit).toBeTruthy()
    const transforms = parseBadgeItemTransforms(bit)
    const deltaY = transforms["rating:slot:1"]?.offsetY ?? 0
    expect(deltaY).toBeGreaterThan(0)

    const posterBuf = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
    let reported: BadgeGeometryReport | null = null
    await generatePosterBuffer(
      posterInput({ posterBuf, badgeItemTransforms: transforms, onBadgeGeometry: (geo) => { reported = geo } }),
    )
    const tuned = reported as unknown as BadgeGeometryReport
    const base = {
      imdb: geometry.items.find((i) => i.id === "rating:imdb")!,
      tmdb: geometry.items.find((i) => i.id === "rating:tmdb")!,
      tomatoes: geometry.items.find((i) => i.id === "rating:tomatoes")!,
    }
    const moved = {
      imdb: tuned.items.find((i) => i.id === "rating:imdb")!,
      tmdb: tuned.items.find((i) => i.id === "rating:tmdb")!,
      tomatoes: tuned.items.find((i) => i.id === "rating:tomatoes")!,
    }
    expect(moved.imdb.top).toBe(base.imdb.top + deltaY)
    expect(moved.tmdb.top).toBe(base.tmdb.top + deltaY)
    expect(moved.tomatoes.top).toBe(base.tomatoes.top)
  })
})

describe("marquee selection moves several groups atomically", () => {
  it("selects every group the rubber band touches and moves them together", async () => {
    // Explicit zero baselines (the quality family has its own canonical X
    // default): every family must receive the SAME delta from its own start.
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultTopBadgeOffsetX: 0,
        defaultTopBadgeOffsetY: 0,
        defaultGenreBadgeOffsetX: 0,
        defaultGenreBadgeOffsetY: 0,
        defaultQualityBadgeOffsetX: 0,
        defaultQualityBadgeOffsetY: 0,
      }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          network: null,
          badges: {
            canvasW: 500,
            canvasH: 750,
            kind: "rank",
            layout: "ranked",
            families: {
              rank: { top: 20, left: 90, w: 120, h: 40 },
              genre: { top: 700, left: 150, w: 200, h: 30 },
              quality: { top: 300, left: 60, w: 90, h: 80 },
            },
            fixedX: {},
            items: [],
          },
        }),
      })),
    )
    let ed: PosterEditorCtx | null = null
    function Probe() {
      ed = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement(
        "div",
        { style: { position: "relative", width: DISPLAY.width, height: DISPLAY.height } },
        createElement(PosterBadgeDragLayer, {
          previewUrl: "http://localhost:3000/api/poster/movie/1?rv=9&scale=60",
          shape: "poster",
          enabled: true,
        }),
        createElement(Probe),
      ),
    )
    const rank = await screen.findByTestId("badge-drag-handle-rank")
    await screen.findByTestId("badge-drag-handle-genre")
    await screen.findByTestId("badge-drag-handle-quality")
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))
    // Rubber band over the whole poster: every reported group is selected.
    const backdrop = screen.getByTestId("badge-drag-backdrop")
    fireEvent.pointerDown(backdrop, { button: 0, clientX: 4, clientY: 4, pointerId: 21 })
    fireEvent.pointerMove(backdrop, { clientX: 240, clientY: 370, pointerId: 21 })
    expect(screen.getByTestId("badge-drag-marquee")).toBeTruthy()
    fireEvent.pointerUp(backdrop, { clientX: 240, clientY: 370, pointerId: 21 })
    await waitFor(() => expect(rank.getAttribute("aria-pressed")).toBe("true"))
    expect(screen.getByTestId("badge-drag-handle-genre").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("badge-drag-handle-quality").getAttribute("aria-pressed")).toBe("true")
    // One drag of one member moves the whole selection by the same delta.
    dragHandle(rank, 10, 0, 22)
    await waitFor(() => expect(ed!.defaultTopBadgeOffsetX).not.toBe(0))
    const delta = ed!.defaultTopBadgeOffsetX
    expect(ed!.defaultGenreBadgeOffsetX).toBe(delta)
    expect(ed!.defaultQualityBadgeOffsetX).toBe(delta)
    expect(ed!.defaultTopBadgeOffsetY).toBe(0)
  })
})

describe("double-click reset of a group clears that family's item overrides", () => {
  it("restores the family layout and drops only that family's item corrections", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultQualityBadgeOffsetX: 12,
        defaultSeparateBadgeOffsetX: 9,
        badgeItemTransforms: "rating:imdb=100,6,0;quality:tier=100,4,0",
      }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          network: null,
          badges: {
            canvasW: 500,
            canvasH: 750,
            kind: "rank",
            layout: "ranked",
            families: {
              rank: { top: 20, left: 190, w: 120, h: 40 },
              quality: { top: 10, left: 400, w: 90, h: 80 },
              separate: { top: 120, left: 400, w: 80, h: 90 },
            },
            fixedX: {},
            items: [],
          },
        }),
      })),
    )
    let ed: PosterEditorCtx | null = null
    function Probe() {
      ed = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement(
        "div",
        { style: { position: "relative", width: DISPLAY.width, height: DISPLAY.height } },
        createElement(PosterBadgeDragLayer, {
          previewUrl: "http://localhost:3000/api/poster/movie/1?rv=9&scale=60",
          shape: "poster",
          enabled: true,
        }),
        createElement(Probe),
      ),
    )
    const separate = await screen.findByTestId("badge-drag-handle-separate")
    fireEvent.doubleClick(separate)
    await waitFor(() => expect(ed!.defaultSeparateBadgeOffsetX).toBe(0))
    const remaining = parseBadgeItemTransforms(ed!.defaultBadgeItemTransforms)
    // The separate family's own item overrides are gone (they would otherwise
    // keep the pills outside the restored layout) ...
    expect(remaining["rating:imdb"]).toBeUndefined()
    // ... and an unrelated family's correction, and the family transforms of
    // the other groups, are untouched.
    expect(remaining["quality:tier"]).toEqual({ scale: 100, offsetX: 4, offsetY: 0 })
    expect(ed!.defaultQualityBadgeOffsetX).toBe(12)
  })
})

/**
 * SURFACE SPLIT of an item drag (same overlay, one implementation):
 *  - the DEFAULTS surface (no injected adapter) writes the content-bound HOME
 *    correction (`quality:home:<kind>`), so the nudge follows its group on
 *    every title instead of only on the previewed one, and the empty homes the
 *    renderer reports as ghosts (`ghost: true`) are draggable dashed handles
 *    that write their home too;
 *  - the PER-TITLE editor (injected adapter) keeps writing the per-title
 *    IDENTITY correction and never offers a ghost.
 */
const GEOMETRY_URL = "http://localhost:3000/api/poster/movie/1?rv=9&scale=60"

/** Minimal adapter: neutral values, item writes recorded. */
function perTitleAdapter(writes: { id: string; offsetY: number }[]): BadgeDragGeometryAdapter {
  const neutral = {
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    extraBadgeScale: 100,
    extraBadgeOffsetX: 0,
    extraBadgeOffsetY: 0,
    extraBadgeScaleExplicit: null,
    extraBadgeOffsetXExplicit: null,
    extraBadgeOffsetYExplicit: null,
    genreBadgeScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeScale: 100,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    separateBadgeScale: 100,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    networkLogoScale: 100,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    logoScale: null,
    logoOffsetX: 0,
    logoOffsetY: 0,
  }
  return {
    isLandscape: false,
    itemTransforms: {},
    posterLayout: "standard",
    ...neutral,
    applyFamilyMoves: () => {},
    applyItemMoves: (moves) => {
      for (const move of moves) writes.push({ id: move.id, offsetY: move.transform.offsetY })
    },
    setFamilyScale: () => {},
    resetFamilies: () => {},
    resetItems: () => {},
    rejoin: () => {},
  }
}

/** Geometry block with the quality items of the defaults preview sample. */
function qualityItemsGeometry(items: readonly Record<string, unknown>[]) {
  return {
    network: null,
    badges: {
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      families: { quality: { top: 300, left: 400, w: 60, h: 90 } },
      fixedX: {},
      items,
    },
  }
}

describe("item drag: HOME on the defaults surface, IDENTITY per title", () => {
  it("stores quality:home:hdr for a painted HDR10+ mark (never the identity)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const { ctx } = await mountPreview(
      qualityItemsGeometry([
        { id: "quality:tier", family: "quality", top: 300, left: 400, w: 60, h: 40, custom: false },
        { id: "quality:format:hdr10plus", family: "quality", top: 340, left: 400, w: 60, h: 40, custom: false },
      ]).badges,
    )
    fireEvent.click(screen.getByTestId("defaults-preview-target-level-item"))
    const tier = await screen.findByTestId("badge-item-handle-quality:tier")
    const hdrPlus = await screen.findByTestId("badge-item-handle-quality:format:hdr10plus")
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))

    dragHandle(hdrPlus, 0, 10)
    await waitFor(() => expect(ctx().defaultBadgeItemTransforms).not.toBeNull())
    const stored = parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)
    // The painted HDR10+ mark binds to the HDR home: the correction is stored
    // under the CONTENT GROUP, so it survives the title that paints HDR alone.
    expect(Object.keys(stored)).toEqual(["quality:home:hdr"])
    expect(stored["quality:home:hdr"].offsetY).toBeGreaterThan(0)
    expect(stored["quality:home:hdr"].offsetX).toBe(0)
    // The identity of the painted badge is NOT written by a defaults gesture.
    expect(stored["quality:format:hdr10plus"]).toBeUndefined()
    // The untouched tier keeps its automatic box.
    expect(stored["quality:home:tier"]).toBeUndefined()
    expect(tier.getAttribute("data-ghost")).toBeNull()

    // …and the stored value travels in the preview URL as a home identity.
    expect(previewUrlOf(ctx())).toContain("quality%3Ahome%3Ahdr")
  })

  it("drags a dashed GHOST of an empty home and writes that home", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const { ctx } = await mountPreview(
      qualityItemsGeometry([
        { id: "quality:tier", family: "quality", top: 300, left: 400, w: 60, h: 40, custom: false },
        // Box-only entry: nothing is painted there (IMAX absent from the sample).
        { id: "quality:home:imax", family: "quality", top: 0, left: 0, w: 60, h: 40, custom: false, ghost: true },
      ]).badges,
    )
    fireEvent.click(screen.getByTestId("defaults-preview-target-level-item"))
    const ghost = await screen.findByTestId("badge-item-handle-quality:home:imax")
    // The ghost is a handle, not a badge: dashed frame + explicit marker.
    expect(ghost.getAttribute("data-ghost")).toBe("true")
    expect(ghost.className).toContain("border-dashed")
    expect(screen.getByTestId("badge-item-handle-quality:tier").getAttribute("data-ghost")).toBeNull()
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))

    dragHandle(ghost, 0, 10)
    await waitFor(() => expect(ctx().defaultBadgeItemTransforms).not.toBeNull())
    const stored = parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)
    expect(Object.keys(stored)).toEqual(["quality:home:imax"])
    expect(stored["quality:home:imax"].offsetY).toBeGreaterThan(0)
  })

  it("writes the per-title IDENTITY when the overlay is driven by an adapter", async () => {
    const writes: { id: string; offsetY: number }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          network: null,
          badges: {
            canvasW: 500,
            canvasH: 750,
            kind: "rank",
            layout: "ranked",
            families: { quality: { top: 300, left: 400, w: 60, h: 90 } },
            fixedX: {},
            items: [
              { id: "quality:format:hdr10plus", family: "quality", top: 340, left: 400, w: 60, h: 40, custom: false },
              // Ghosts are ignored by a per-title surface, even if reported.
              { id: "quality:home:imax", family: "quality", top: 0, left: 0, w: 60, h: 40, ghost: true },
            ],
          },
        }),
      })),
    )
    renderWithCtx(
      createElement(
        "div",
        { style: { position: "relative", width: DISPLAY.width, height: DISPLAY.height } },
        createElement(PosterBadgeDragLayer, {
          previewUrl: GEOMETRY_URL,
          shape: "poster",
          enabled: true,
          targetLevel: "item",
          adapter: perTitleAdapter(writes),
        }),
      ),
    )
    const hdrPlus = await screen.findByTestId("badge-item-handle-quality:format:hdr10plus")
    await waitFor(() => expect(screen.queryByTestId("badge-item-handle-quality:home:imax")).toBeNull())
    stubDisplayRect(screen.getByTestId("badge-drag-layer"))
    dragHandle(hdrPlus, 0, 10)
    await waitFor(() => expect(writes.length).toBeGreaterThan(0))
    // Per-title UNCHANGED: the identity of the painted badge, never its home.
    expect(writes.map((w) => w.id)).toEqual(["quality:format:hdr10plus"])
    expect(writes[0].offsetY).toBeGreaterThan(0)
  })
})
