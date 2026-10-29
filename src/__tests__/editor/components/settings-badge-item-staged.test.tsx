/**
 * Staged settings session × per-item badge corrections (PRODUCTION boundary).
 *
 * The settings panel owns ONE draft session (`useSettingsSession`) and exposes
 * it to every control through `PosterEditorValueOverride` (`{...outer,
 * ...session, ...localSetters}`). A defaults setter the panel's components call
 * MUST therefore be the session-local one: a setter that is missing from the
 * session falls through to the OUTER provider setter, so a purely local edit
 *   (a) writes/stores the live defaults without the single global Save, and
 *   (b) moves the outer identity under the dirty draft → the
 *       "settings changed elsewhere" conflict banner (and a staged Save that
 *       would persist the stale session value over the new one).
 *
 * These tests mount the REAL `SettingsPanel` (real session + override + preview
 * + drag layer + save/discard UI) — not the provider alone — because that
 * boundary is exactly where the omission was invisible. Flow per test:
 * stage another edit first (dirty draft) → manipulate ONE badge item → assert
 * the draft-only contract (outer truth/durable storage untouched, no conflict,
 * the debounced preview URL — the server render input, `bit=` — carries the
 * correction) → the single global Save commits it → a real external change
 * still conflicts and `discard` recovers onto it.
 *
 * Item pixels themselves are covered by
 * `src/__tests__/rendering/badge-item-route-pixels.test.ts` (same `bit=`
 * payload rendered by the shared renderer), so the URL is the contract asserted
 * here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import {
  PosterEditorValueOverride,
  usePosterEditor,
  type PosterEditorCtx,
} from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

/** XHR driven by the test: delivers one successful preview-image blob. */
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
  finished = false
  finish() {
    this.finished = true
    this.onload?.()
  }
}

/** What the shared renderer reports for the defaults sample (debug=1&netgeo=1). */
const GEOMETRY_ITEMS = [
  { id: "quality:tier", family: "quality", top: 10, left: 400, w: 90, h: 26 },
  { id: "rating:imdb", family: "separate", top: 120, left: 400, w: 80, h: 40 },
  { id: "rating:tmdb", family: "separate", top: 165, left: 400, w: 80, h: 40 },
] as const

/**
 * Renderer report for the requested preview URL: an item is flagged `custom`
 * when the URL carries its per-item correction (`bit=`), exactly like the
 * shared renderer marks the boxes it actually shifted.
 */
function geometryPayload(url: string) {
  const query = url.slice(url.indexOf("?") + 1)
  const corrections = parseBadgeItemTransforms(new URLSearchParams(query).get("bit"))
  return {
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
      items: GEOMETRY_ITEMS.map((item) => ({ ...item, custom: item.id in corrections })),
    },
  }
}

let puts: { url: string; body: Record<string, unknown> }[]
/** Every geometry (debug/netgeo) URL the preview asked the server to render. */
let netgeoUrls: string[]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
      }
      if (u.includes("netgeo=1")) {
        netgeoUrls.push(u)
        const payload = geometryPayload(u)
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: [] }),
          text: async () => JSON.stringify({ presets: [] }),
        }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
    }),
  )
}

function renderPanel() {
  let ctx: PosterEditorCtx | null = null
  function OuterProbe() {
    ctx = usePosterEditor()
    return null
  }
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
      createElement(OuterProbe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 60))
  })
}

/** Query params of the LAST preview URL the server was asked to render. */
function previewParams(): URLSearchParams | null {
  const url = netgeoUrls[netgeoUrls.length - 1]
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1))
}

/** Hand the poster image to the preview so the enlarged editor is reachable. */
async function deliverPreviewImage() {
  // The preview URL is debounced (200 ms) and every new URL starts a new XHR:
  // settle, then answer whatever is pending, until the displayed blob exists.
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120))
    })
    const pending = LoadableXHR.instances.filter((xhr) => !xhr.finished)
    if (pending.length === 0) continue
    await act(async () => {
      for (const xhr of pending) xhr.finish()
    })
    await settle()
    if (screen.queryByLabelText("ui.badgeEditOpen")) return
  }
  await screen.findByLabelText("ui.badgeEditOpen")
}

async function mountPanel() {
  const panel = renderPanel()
  await screen.findByTestId("poster-style-apple")
  // The outer defaults hydrate asynchronously (deterministic factory state
  // first, storage/server second): the draft session must open on the settled
  // truth, otherwise a first click can race the clean rebase.
  await waitFor(() => expect(panel.ctx().defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await settle()
  await deliverPreviewImage()
  return panel
}

/** Stage a visibly different edit so the draft session is DIRTY. */
async function stageDirtyDraft() {
  fireEvent.click(screen.getByTestId("poster-style-apple"))
  await waitFor(() => expect(screen.getByTestId("settings-save")).not.toBeDisabled())
}

/** Open the enlarged preview editor and switch it to the ITEM target level. */
async function openItemEditor(itemId: string) {
  fireEvent.click(await screen.findByLabelText("ui.badgeEditOpen"))
  await screen.findByTestId("defaults-preview-zoom-drag-area")
  fireEvent.click(screen.getByTestId("defaults-preview-target-level-item"))
  return await screen.findByTestId(`badge-item-handle-${itemId}`)
}

beforeEach(() => {
  localStorage.clear()
  LoadableXHR.instances = []
  puts = []
  netgeoUrls = []
  resetGuestGuardForTests()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
  vi.stubGlobal("XMLHttpRequest", LoadableXHR as unknown as typeof XMLHttpRequest)
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:pictorium-preview",
    revokeObjectURL: () => {},
  })
  stubFetch()
})

describe("per-item corrections inside the staged settings session", () => {
  it("stages an individual item drag: no outer write, no persistence, no conflict, then one Save", async () => {
    const { ctx } = await mountPanel()
    await stageDirtyDraft()
    const storageBefore = localStorage.getItem("badgeDefaults")
    const imdb = await openItemEditor("rating:imdb")

    // Nudge ONE rating pill (single-item gesture = applyItemMoves).
    fireEvent.keyDown(imdb, { key: "ArrowRight" })
    fireEvent.keyDown(imdb, { key: "ArrowDown", shiftKey: true })

    // The gesture is a DRAFT edit: the live outer truth is never written and no
    // "changed elsewhere" conflict is raised on a purely local edit.
    expect(ctx().defaultBadgeItemTransforms).toBeNull()
    expect(screen.queryByTestId("settings-conflict")).toBeNull()
    // The draft owns the correction: the preview URL the server renders carries
    // it (this is the exact input the single renderer consumes).
    await waitFor(() => expect(previewParams()?.get("bit")).toBe("rating:imdb=100,1,10"), { timeout: 3000 })
    // …and nothing leaked into durable storage or the network.
    expect(puts).toHaveLength(0)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(localStorage.getItem("badgeDefaults")).toBe(storageBefore)
    expect(puts).toHaveLength(0)
    // Group transforms were left alone by the item gesture (still a valid draft).
    expect(ctx().defaultSeparateBadgeOffsetX).toBe(0)

    // The single global Save commits the staged correction exactly once.
    fireEvent.click(screen.getByTestId("settings-save"))
    await waitFor(() => expect(puts).toHaveLength(1), { timeout: 3000 })
    expect(puts[0].body.badgeItemTransforms).toBe("rating:imdb=100,1,10")
    // Outer install converges onto the saved value (no phantom conflict).
    await waitFor(() => expect(ctx().defaultBadgeItemTransforms).toBe("rating:imdb=100,1,10"))
    expect(screen.queryByTestId("settings-conflict")).toBeNull()
  }, 15000)

  it("keeps a further staged drag and a real external change conflicting, and discard recovers onto it", async () => {
    const { ctx } = await mountPanel()
    await stageDirtyDraft()
    const tmdb = await openItemEditor("rating:tmdb")
    fireEvent.keyDown(tmdb, { key: "ArrowRight" })
    await waitFor(() => expect(previewParams()?.get("bit")).toBe("rating:tmdb=100,1,0"), { timeout: 3000 })

    // A REAL external update (legacy live path) under the dirty draft.
    await act(async () => {
      ctx().setDefaultBadgeItemTransforms("rating:imdb=130,5,0")
    })
    await settle()
    expect(screen.getByTestId("settings-conflict")).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    // The draft is preserved and no staged write went out.
    expect(previewParams()?.get("bit")).toBe("rating:tmdb=100,1,0")
    expect(puts.filter((p) => p.body.badgeItemTransforms === "rating:tmdb=100,1,0")).toHaveLength(0)

    // Discard: the draft is replaced by the outer truth (conflict cleared).
    fireEvent.click(screen.getByTestId("settings-conflict-discard"))
    await settle()
    expect(screen.queryByTestId("settings-conflict")).toBeNull()
    expect(ctx().defaultBadgeItemTransforms).toBe("rating:imdb=130,5,0")
    await waitFor(() => expect(previewParams()?.get("bit")).toBe("rating:imdb=130,5,0"), { timeout: 3000 })
  })

  it("stages a per-item RESET of an existing correction (double-click)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ badgeItemTransforms: "rating:imdb=130,5,0" }))
    const { ctx } = await mountPanel()
    await openItemEditor("rating:imdb")
    // The reported box reflects the stored correction once the preview URL
    // carries it (hydration/debounce may land after the handles first paint).
    await waitFor(
      () => expect(screen.getByTestId("badge-item-handle-rating:imdb").getAttribute("data-custom")).toBe("true"),
      { timeout: 3000 },
    )
    // The reset below is the edit of this test: the draft is clean until then.
    expect(screen.getByTestId("settings-save")).toBeDisabled()

    fireEvent.doubleClick(screen.getByTestId("badge-item-handle-rating:imdb"))

    // Only the draft clears the correction: automatic layout in the preview,
    // spelled as an EXPLICIT empty `bit=` so the server cannot inherit the
    // stored map…
    await waitFor(() => expect(previewParams()?.get("bit")).toBe(""), { timeout: 3000 })
    // …while the stored/live truth keeps it and no conflict is raised.
    expect(ctx().defaultBadgeItemTransforms).toBe("rating:imdb=130,5,0")
    expect(screen.queryByTestId("settings-conflict")).toBeNull()
    expect(puts).toHaveLength(0)
  })
})

/**
 * Contract guard for the whole defaults-setter surface of the staged session:
 * the session value is `{...outer, ...session, ...localSetters}`, so any
 * `setDefault*` that the session does not override is byte-identical (same
 * function reference) to the OUTER provider setter — i.e. it writes the live
 * defaults instead of the draft. That is exactly the omission class above, and
 * it must stay empty for every future defaults setter.
 *
 * Composed like `SettingsPanel` itself (`useSettingsSession` +
 * `PosterEditorValueOverride`); the probes read both sides of the boundary.
 */
describe("staged session setter surface", () => {
  function Boundary({ sink }: { sink: { session: SettingsSessionResult | null } }) {
    const session = useSettingsSession()
    sink.session = session
    return (
      <PosterEditorValueOverride value={session.value}>
        {null}
      </PosterEditorValueOverride>
    )
  }

  it("exposes no defaults setter taken verbatim from the outer provider", async () => {
    let outer: PosterEditorCtx | null = null
    function OuterProbe() {
      outer = usePosterEditor()
      return null
    }
    const sink: { session: SettingsSessionResult | null } = { session: null }
    renderWithCtx(createElement("div", null, createElement(OuterProbe), createElement(Boundary, { sink })))
    await settle()

    const session = sink.session!
    const outerCtx = outer as unknown as PosterEditorCtx
    const sessionDefaultsSetters = Object.entries(session.value as unknown as Record<string, unknown>).filter(
      ([key, value]) => key.startsWith("setDefault") && typeof value === "function",
    )
    // Sanity: the surface is real (the panel's controls live on it).
    expect(sessionDefaultsSetters.length).toBeGreaterThan(60)

    const fallenThrough = sessionDefaultsSetters
      .filter(([key, value]) => (outerCtx as unknown as Record<string, unknown>)[key] === value)
      .map(([key]) => key)
    expect(fallenThrough).toEqual([])
  })
})
