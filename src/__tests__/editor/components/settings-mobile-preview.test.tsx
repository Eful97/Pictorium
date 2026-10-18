import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within, act, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

let puts: { url: string; body: Record<string, unknown> }[]

/** Deterministic preview-title results for the floating search dialog. */
const FLOATING_SEARCH_RESULTS = [
  {
    id: 1399,
    media_type: "tv",
    name: "La casa di carta",
    poster_path: "/casa.jpg",
    first_air_date: "2017-05-02",
    vote_average: 8.2,
  },
  {
    id: 19995,
    media_type: "movie",
    title: "Avatar",
    poster_path: "/avatar.jpg",
    release_date: "2009-12-10",
    vote_average: 7.6,
  },
]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
      }
      if (u.includes("/api/defaults/presets")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }), text: async () => '{"presets":[]}' }
      }
      if (u.includes("/api/custom-rating/test")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }), text: async () => '{"ok":true}' }
      }
      if (u.includes("/api/tmdb/search")) {
        const q = new URL(u, "http://localhost").searchParams.get("q") ?? ""
        const results = q.toLowerCase().includes("empty")
          ? []
          : FLOATING_SEARCH_RESULTS.filter((r) =>
              (r.title || r.name || "").toLowerCase().includes(q.trim().toLowerCase().slice(0, 4)),
            )
        const payload = { results, total_results: results.length, total_pages: 1 }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => payload,
          text: async () => JSON.stringify(payload),
        }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => "" }
    }),
  )
}

/** Transport-level fake XHR: serves the real preview blob path in jsdom. */
class FakeXHR {
  static urls: string[] = []
  status = 200
  response: Blob | null = null
  responseType = ""
  timeout = 0
  onprogress: ((e: never) => void) | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_method: string, url: string) {
    FakeXHR.urls.push(url)
  }
  send() {
    queueMicrotask(() => {
      this.response = new Blob(["fake-poster"], { type: "image/png" })
      this.onload?.()
    })
  }
  abort() {}
}

function renderPanel() {
  return renderWithCtx(
    createElement(SettingsPanel, {
      setSettingsOpen: () => {},
      exportData: () => {},
      importData: () => {},
    }),
  )
}

function setMobileWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w })
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  resetGuestGuardForTests()
  stubFetch()
  setMobileWidth(390)
})

describe("settings mobile floating preview (authorized overlay contract)", () => {
  it("default float: snapped top-right overlay, no reserved section, single owner, correct ratio", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const preview = screen.getByTestId("settings-preview")
    const controls = screen.getByTestId("settings-controls")
    // Floating overlay (out of flow) — never a reserved in-flow section.
    expect(preview).toHaveAttribute("data-floating", "true")
    expect(preview).toHaveAttribute("data-corner", "tr")
    expect(preview.className).toMatch(/absolute/)
    // DOM order is preview-then-controls (matches visual/focus order).
    expect(preview.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Controls own the body height (sole scroller); the float consumes none.
    expect(controls.className).toMatch(/flex-1/)
    expect(controls.className).toMatch(/overflow-y-auto/)
    // Single mounted preview owner: exactly one media node.
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    // Portrait keeps the correct ratio/bounds (small real poster).
    const media = screen.getByTestId("defaults-preview-media")
    expect(media.className).toMatch(/aspect-\[2\/3\]/)
    // Toolbar: minimize + corner cycle, labelled 44px targets (no tiny close).
    const minimize = screen.getByTestId("floating-preview-minimize")
    const corner = screen.getByTestId("floating-preview-corner")
    expect(minimize).toHaveAttribute("aria-label", "ui.previewCollapse")
    expect(corner).toHaveAttribute("aria-label", "ui.previewCornerCycle")
    expect(minimize.className).toMatch(/min-h-\[44px\]/)
    expect(corner.className).toMatch(/min-h-\[44px\]/)
    // No legacy strip collapse toggle.
    expect(screen.queryByTestId("defaults-preview-collapse")).toBeNull()
    // Footer + save reachable (float lives above the footer, never over it).
    expect(screen.getByTestId("settings-save").className).toMatch(/min-h-\[44px\]/)
    const footer = screen.getByTestId("settings-save").closest("div[class*='settings-dialog-footer']")
    expect(footer?.className).toMatch(/safe-area-inset-bottom/)
    expect(puts).toHaveLength(0)
  })

  it("landscape edit target keeps video bounds without duplicating the preview", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    const media = screen.getByTestId("defaults-preview-media")
    expect(media.className).toMatch(/aspect-video/)
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    // Wider float card for the 16/9 frame, still corner-snapped.
    expect(screen.getByTestId("settings-preview")).toHaveAttribute("data-corner", "tr")
    // Shape switch stages nothing by itself: no PUT, draft intact.
    expect(puts).toHaveLength(0)
  })

  it("minimize/restore keeps the single owner mounted with no PUT, surviving tab switches", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const media = () => screen.getByTestId("defaults-preview-media")
    // Minimize: owner stays mounted under hidden (no refetch on restore).
    fireEvent.click(screen.getByTestId("floating-preview-minimize"))
    expect(media().closest("div.hidden")).not.toBeNull()
    expect(screen.getByTestId("floating-preview-restore")).toHaveAttribute("aria-label", "ui.previewExpand")
    expect(screen.queryByTestId("floating-preview-minimize")).toBeNull()
    expect(puts).toHaveLength(0)
    // A deliberate minimize survives tab switches (state lives in the panel):
    // secondary tabs unmount the float, returning restores it minimized.
    fireEvent.click(screen.getByTestId("settings-secondary-prefs"))
    expect(screen.queryByTestId("settings-preview")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    expect(screen.getByTestId("floating-preview-restore")).toBeInTheDocument()
    expect(media().closest("div.hidden")).not.toBeNull()
    // Restore: same single owner, still no PUT.
    fireEvent.click(screen.getByTestId("floating-preview-restore"))
    expect(media().closest("div.hidden")).toBeNull()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })

  it("corner cycle moves clockwise pointer + keyboard with corner state surviving resize", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const preview = () => screen.getByTestId("settings-preview")
    expect(preview()).toHaveAttribute("data-corner", "tr")
    // Pointer cycle: tr -> br -> bl.
    fireEvent.click(screen.getByTestId("floating-preview-corner"))
    expect(preview()).toHaveAttribute("data-corner", "br")
    fireEvent.click(screen.getByTestId("floating-preview-corner"))
    expect(preview()).toHaveAttribute("data-corner", "bl")
    // Keyboard cycle: focus + Enter continues bl -> tl.
    const cycle = screen.getByTestId("floating-preview-corner")
    cycle.focus()
    fireEvent.keyDown(cycle, { key: "Enter" })
    fireEvent.click(cycle)
    expect(preview()).toHaveAttribute("data-corner", "tl")
    expect(puts).toHaveLength(0)
    // Resize to desktop: static column (no toolbar), corner remembered.
    setMobileWidth(1280)
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getByTestId("settings-preview")).toHaveAttribute("data-floating", "false")
    expect(screen.queryByTestId("floating-preview-corner")).toBeNull()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    // Back to mobile: same corner, same single owner.
    setMobileWidth(390)
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getByTestId("settings-preview")).toHaveAttribute("data-corner", "tl")
    expect(screen.getByTestId("floating-preview-corner")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  it("desktop keeps the static preview column with mobile-only 44px format targets", async () => {
    setMobileWidth(1280)
    renderPanel()
    await screen.findByTestId("presets-panel")
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getByTestId("settings-preview")).toHaveAttribute("data-floating", "false")
    expect(screen.queryByTestId("floating-preview-minimize")).toBeNull()
    expect(screen.getByTestId("defaults-preview-media").className).toMatch(/aspect-\[2\/3\]/)
    // Format buttons: 44px floor on mobile, natural height on desktop.
    for (const btn of within(screen.getByTestId("format-target-selector")).getAllByRole("button")) {
      expect(btn.className).toMatch(/min-h-\[44px\]/)
      expect(btn.className).toMatch(/md:min-h-0/)
    }
  })
})

describe("settings mobile floating drag vs tap (transport mocks, real blob path)", () => {
  beforeEach(() => {
    FakeXHR.urls = []
    let blobN = 0
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:fake-${++blobN}`),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    stubFetch()
  })

  it("tap on the thumbnail opens the large zoom; Escape closes without PUT", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const zoomOpen = await screen.findByTestId("defaults-preview-zoom-open")
    expect(FakeXHR.urls.length).toBeGreaterThan(0)
    expect(FakeXHR.urls[0]).toContain("/api/poster/")
    // Tap (press without movement) opens the shared zoom modal.
    fireEvent.click(zoomOpen)
    expect(screen.getAllByRole("dialog")).toHaveLength(2)
    // Full image in the enlarged view, correct ratio, uncropped fit.
    const enlarged = screen.getAllByAltText("Avatar")[1] as HTMLImageElement
    expect(enlarged.className).toMatch(/object-contain/)
    // Escape closes the zoom only (panel stays, no PUT, no discard).
    fireEvent.keyDown(enlarged.closest('[role="dialog"]')!, { key: "Escape" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByTestId("settings-preview")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  it("drag snaps to the nearest corner and never activates the zoom", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const zoomOpen = await screen.findByTestId("defaults-preview-zoom-open")
    const float = screen.getByTestId("settings-preview")
    expect(float).toHaveAttribute("data-corner", "tr")
    // Small movement under the threshold is still a tap (zoom opens).
    fireEvent.pointerDown(zoomOpen, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(zoomOpen, { pointerId: 1, pointerType: "mouse", clientX: 104, clientY: 103 })
    fireEvent.pointerUp(zoomOpen, { pointerId: 1, pointerType: "mouse", clientX: 104, clientY: 103 })
    expect(float).toHaveAttribute("data-corner", "tr")
    fireEvent.click(zoomOpen)
    expect(screen.getAllByRole("dialog")).toHaveLength(2)
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    // Real drag: press, move past the threshold, release bottom-left.
    // jsdom rects are zero: stub the body container box so the snap quadrant
    // is deterministic (release at 60,480 of a 390x568 box -> bl).
    const container = float.parentElement!
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 568, width: 390, height: 568, toJSON: () => ({}) }
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect as DOMRect)
    fireEvent.pointerDown(float, { pointerId: 2, pointerType: "mouse", button: 0, clientX: 300, clientY: 120 })
    fireEvent.pointerMove(float, { pointerId: 2, pointerType: "mouse", clientX: 200, clientY: 200 })
    fireEvent.pointerMove(float, { pointerId: 2, pointerType: "mouse", clientX: 60, clientY: 480 })
    fireEvent.pointerUp(float, { pointerId: 2, pointerType: "mouse", clientX: 60, clientY: 480 })
    expect(float).toHaveAttribute("data-corner", "bl")
    // The post-drag click is swallowed: no zoom opens.
    fireEvent.click(zoomOpen)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    // Same single owner throughout, nothing staged.
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })
})

describe("settings mobile resize + save contract", () => {
  it("single owner across resize: draft, tab and shape survive with one dialog and no PUT on navigation", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    expect(puts).toHaveLength(0)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    setMobileWidth(1280)
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("tab", { name: "ui.settingsTabBadge" })).toHaveAttribute("aria-selected", "true")
    expect(
      within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape").closest("button"),
    ).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    setMobileWidth(390)
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(puts).toHaveLength(0)
    // One global Save persists the staged draft with a single PUT and stays put.
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(screen.getByRole("tab", { name: "ui.settingsTabBadge" })).toHaveAttribute("aria-selected", "true")
  })

  it("preview family sync: entering a style card narrows the preview without saving", async () => {
    // The editing-family chip lives in the full desktop chrome (the mobile
    // float stays a pure thumbnail); run at desktop width.
    setMobileWidth(1280)
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    const genreGate = screen.getByTestId("badge-genre-style")
    const focusable = within(genreGate).getAllByRole("button")[0]
    fireEvent.focus(focusable)
    // Family chip reflects the narrowed preview-only family; nothing persisted.
    expect(screen.getByTestId("defaults-preview-editing")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    // Reset returns to the full auto preview when offered.
    const reset = screen.queryByTestId("defaults-preview-reset-family")
    if (reset) {
      fireEvent.click(reset)
      expect(screen.getByTestId("defaults-preview-editing")).toHaveTextContent("ui.previewEditingAuto")
      expect(puts).toHaveLength(0)
    }
  })
})

describe("settings mobile floating title search (preview-only dialog)", () => {
  beforeEach(() => {
    FakeXHR.urls = []
    let blobN = 0
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:fake-${++blobN}`),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    stubFetch()
  })

  function openSearch() {
    const trigger = screen.getByTestId("floating-preview-search")
    // Explicit focus mirrors the real tap (fireEvent.click alone does not
    // move jsdom focus); the dialog restores to this trigger on close.
    trigger.focus()
    fireEvent.click(trigger)
    return trigger
  }

  /** Scoped to the floating dialog: the settings body mounts other textboxes. */
  function dialogSearchBox() {
    return within(screen.getByTestId("floating-preview-search-dialog")).getByRole("textbox")
  }

  it("exposes an overlaid 44x44 search trigger with dialog wiring, no mounted dialog, no PUT", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const trigger = screen.getByTestId("floating-preview-search")
    expect(trigger).toHaveAttribute("aria-label", "ui.defaultsPreviewSearchLabel")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    const controlsId = trigger.getAttribute("aria-controls")
    expect(controlsId).toBeTruthy()
    // Overlaid INSIDE the existing thumbnail (absolute, no added row): fixed
    // 44px on both axes, mounted once beside the zoom target (never nested).
    expect(trigger.className).toMatch(/h-\[44px\]/)
    expect(trigger.className).toMatch(/w-\[44px\]/)
    expect(trigger.className).toMatch(/absolute/)
    expect(trigger.closest('[data-testid="defaults-preview-media"]')).not.toBeNull()
    expect(trigger.closest('button[data-testid="defaults-preview-zoom-open"]')).toBeNull()
    // Dialog mounts only on open: no second search owner beside the preview.
    expect(screen.queryByTestId("floating-preview-search-dialog")).toBeNull()
    expect(screen.queryByTestId("defaults-preview-title-search")).toBeNull()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })

  it("opens on click with focus in the search box; Escape closes with focus restore, settings stays open", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const mediaBefore = screen.getByTestId("defaults-preview-media")
    const trigger = openSearch()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const dialog = await screen.findByTestId("floating-preview-search-dialog")
    expect(dialog).toBeInTheDocument()
    // Exactly one search owner mounted (the dialog one).
    expect(screen.getAllByTestId("defaults-preview-title-search")).toHaveLength(1)
    // Focus lands in the search box (Modal first-focusable), not on open.
    expect(document.activeElement).toBe(dialogSearchBox())
    // Opening mounts no second preview and persists nothing.
    expect(screen.getByTestId("defaults-preview-media")).toBe(mediaBefore)
    expect(puts).toHaveLength(0)
    // Escape closes only the dialog (capture + stopPropagation, like zoom):
    // focus returns to the trigger, the settings panel stays mounted.
    fireEvent.keyDown(dialogSearchBox(), { key: "Escape" })
    await waitFor(() => expect(screen.queryByTestId("floating-preview-search-dialog")).toBeNull())
    expect(document.activeElement).toBe(trigger)
    expect(screen.getByTestId("settings-preview")).toBeInTheDocument()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(puts).toHaveLength(0)
  })

  it("keyboard Enter on the focused trigger opens the dialog", async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByTestId("presets-panel")
    const trigger = screen.getByTestId("floating-preview-search")
    trigger.focus()
    await user.keyboard("{Enter}")
    expect(await screen.findByTestId("floating-preview-search-dialog")).toBeInTheDocument()
    expect(document.activeElement).toBe(dialogSearchBox())
    expect(puts).toHaveLength(0)
  })

  it("selecting a tv title switches only the preview path/alt, keeps shape and draft clean", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    openSearch()
    await screen.findByTestId("floating-preview-search-dialog")
    const box = dialogSearchBox()
    fireEvent.change(box, { target: { value: "casa" } })
    fireEvent.keyDown(box, { key: "Enter" })
    const option = await screen.findByRole("option", { name: /La casa di carta/ })
    await waitFor(() => {
      expect(FakeXHR.urls.some((u) => u.includes("/api/poster/movie/19995"))).toBe(true)
    })
    const n = FakeXHR.urls.length
    fireEvent.click(option)
    // Preview-only: the poster path flips to tv/1399 while the staged draft
    // stays clean (Save disabled) and the shape stays portrait.
    await waitFor(() => {
      expect(FakeXHR.urls.slice(n).some((u) => u.includes("/api/poster/tv/1399"))).toBe(true)
    })
    expect(await screen.findByAltText("La casa di carta")).toBeInTheDocument()
    expect(screen.getByTestId("defaults-preview-media").className).toMatch(/aspect-\[2\/3\]/)
    expect(screen.queryByAltText("Avatar")).toBeNull()
    // Still inside settings: no navigation, no PUT, dialog stays for reset.
    expect(screen.getByTestId("settings-preview")).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    expect(screen.getByTestId("floating-preview-search-dialog")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    // Reset restores the Avatar sample without persisting.
    fireEvent.click(screen.getByLabelText("ui.defaultsPreviewReset"))
    await waitFor(() => {
      expect(FakeXHR.urls.filter((u) => u.includes("/api/poster/movie/19995")).length).toBeGreaterThanOrEqual(2)
    })
    expect(await screen.findByAltText("Avatar")).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    expect(puts).toHaveLength(0)
  })

  it("shows the no-key notice without credentials and never fails", async () => {
    renderWithCtx(
      createElement(SettingsPanel, {
        setSettingsOpen: () => {},
        exportData: () => {},
        importData: () => {},
      }),
      { tmdbKey: "", serverHasTmdbKey: false },
    )
    await screen.findByTestId("presets-panel")
    openSearch()
    await screen.findByTestId("floating-preview-search-dialog")
    expect(screen.getByText("ui.noKey")).toBeInTheDocument()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(puts).toHaveLength(0)
  })

  it("resize to desktop closes the dialog so owners never duplicate; desktop keeps the always-open search", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    openSearch()
    await screen.findByTestId("floating-preview-search-dialog")
    expect(screen.getAllByTestId("defaults-preview-title-search")).toHaveLength(1)
    setMobileWidth(1280)
    act(() => { window.dispatchEvent(new Event("resize")) })
    // Dialog unmounts on the flip (desktop owns the inline search instead).
    expect(screen.queryByTestId("floating-preview-search-dialog")).toBeNull()
    expect(screen.queryByTestId("floating-preview-search")).toBeNull()
    expect(within(screen.getByTestId("settings-preview")).getByRole("textbox")).toBeInTheDocument()
    expect(screen.queryByTestId("defaults-preview-search-toggle")).toBeNull()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(screen.getAllByTestId("defaults-preview-title-search")).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })

  it("pointer gestures starting inside the dialog never re-dock the corner", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    openSearch()
    await screen.findByTestId("floating-preview-search-dialog")
    const float = screen.getByTestId("settings-preview")
    expect(float).toHaveAttribute("data-corner", "tr")
    const box = dialogSearchBox()
    // Typing/scrolling gesture inside the dialog (portal-bubbled through the
    // React tree) must not start a corner drag on the floating wrapper.
    fireEvent.pointerDown(box, { pointerId: 9, pointerType: "touch", clientX: 200, clientY: 400 })
    fireEvent.pointerMove(box, { pointerId: 9, pointerType: "touch", clientX: 210, clientY: 430 })
    fireEvent.pointerUp(box, { pointerId: 9, pointerType: "touch", clientX: 210, clientY: 430 })
    expect(float).toHaveAttribute("data-corner", "tr")
    expect(screen.getByTestId("floating-preview-search-dialog")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  it("minimize hides the trigger with the preview; restore brings it back mounted once", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const trigger = screen.getByTestId("floating-preview-search")
    fireEvent.click(screen.getByTestId("floating-preview-minimize"))
    // Hidden with the single owner under `hidden` (same contract as the
    // thumbnail: still mounted once, no refetch on restore).
    expect(trigger.closest("div.hidden")).not.toBeNull()
    expect(screen.queryByTestId("floating-preview-search-dialog")).toBeNull()
    fireEvent.click(screen.getByTestId("floating-preview-restore"))
    expect(trigger.closest("div.hidden")).toBeNull()
    expect(screen.getByTestId("floating-preview-search")).toBeInTheDocument()
    expect(screen.getAllByTestId("defaults-preview-media")).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })
})
