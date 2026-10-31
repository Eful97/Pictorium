import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within, act } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"

// UserSpaceSection requires the Next app router: same mock as EditViewGate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"

let puts: { url: string; body: Record<string, unknown> }[]
let putOk = true

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return {
          ok: putOk,
          status: putOk ? 200 : 500,
          headers: { get: () => null },
          json: async () => ({}),
        }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: [] }),
        }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
    }),
  )
}

function renderPanel(props?: { setSettingsOpen?: (v: boolean) => void; onOpenInstall?: () => void }) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const setSettingsOpen = props?.setSettingsOpen ?? (() => {})
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, {
        setSettingsOpen,
        exportData: () => {},
        importData: () => {},
        onOpenInstall: props?.onOpenInstall,
      }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx, setSettingsOpen, container: rendered.container }
}

async function makeDirty() {
  await screen.findByTestId("poster-style-apple")
  fireEvent.click(screen.getByTestId("poster-style-apple"))
  expect(screen.getByTestId("settings-save")).not.toBeDisabled()
}

function closeViaX() {
  fireEvent.click(screen.getByRole("button", { name: /Chiudi|Close|ui\.close/i }))
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  putOk = true
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  resetGuestGuardForTests()
  stubFetch()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

describe("settings exit-confirm centered modal", () => {
  it("dirty close opens a centered blocking overlay with three explicit actions", async () => {
    renderPanel()
    await makeDirty()
    closeViaX()
    const dialog = screen.getByTestId("settings-dirty-dialog")
    expect(dialog).toBeInTheDocument()
    // Centered overlay above the whole app: full-viewport, strongly
    // darkened, flex-centered, above the settings shell (z-70/z-80).
    const overlay = screen.getByRole("dialog")
    expect(overlay).toHaveAttribute("aria-modal", "true")
    expect(overlay.getAttribute("aria-labelledby")).toBe("settings-dirty-title")
    expect(overlay.getAttribute("aria-describedby")).toBe("settings-dirty-desc")
    expect(overlay.className).toContain("bg-black/85")
    expect(overlay.className).toContain("z-[100]")
    expect(overlay.className).toContain("items-center")
    expect(overlay.className).toContain("justify-center")
    expect(dialog.className).toContain("max-w-sm")
    // Three actions, safe continue focused, real labels (no raw-key fallback).
    expect(screen.getByTestId("settings-dirty-save")).toHaveTextContent("Salva e chiudi")
    expect(screen.getByTestId("settings-dirty-continue")).toHaveTextContent("Continua a modificare")
    expect(screen.getByTestId("settings-dirty-discard")).toHaveTextContent("Esci senza salvare")
    expect(document.activeElement).toBe(screen.getByTestId("settings-dirty-continue"))
    // The shell underneath is inert: a single active dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
  })

  it("tab and format-target changes never open the dialog and keep the draft", async () => {
    renderPanel()
    await makeDirty()
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    // Draft retained across the switch: still dirty, staged preset kept.
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    // Edit-target (format) switches are free navigation too: no dialog.
    fireEvent.click(
      within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
    )
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(puts).toHaveLength(0)
  })

  it("continue editing keeps the draft with zero PUT and the panel stays open", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(puts).toHaveLength(0)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
  })

  it("discard closes with zero PUT", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    fireEvent.click(screen.getByTestId("settings-dirty-discard"))
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(puts).toHaveLength(0)
  })

  it("save-and-close issues one PUT and closes only on success", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    expect(screen.getByTestId("settings-dirty-save")).toHaveTextContent("Salva e chiudi")
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await act(async () => {})
    expect(puts).toHaveLength(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith("ui.saved")
  })

  it("failed save keeps the modal open with edits intact and the same button retries", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    putOk = false
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await screen.findByTestId("settings-dirty-error")
    // Modal open, edits intact, nothing closed.
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(puts).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith("ui.saveError")
    expect(screen.getByTestId("settings-dirty-save")).not.toBeDisabled()
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    // Retry through the same modal button succeeds and closes.
    putOk = true
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await act(async () => {})
    expect(puts).toHaveLength(2)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
  })

  it("double-clicking save-and-close issues a single PUT", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    const save = screen.getByTestId("settings-dirty-save")
    fireEvent.click(save)
    fireEvent.click(save)
    await act(async () => {})
    expect(puts).toHaveLength(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it("Escape resolves to continue-editing, never to discard", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    closeViaX()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(puts).toHaveLength(0)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
  })

  it("mobile back opens the same centered modal; discard closes with zero PUT", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await makeDirty()
    const back = await screen.findByRole("button", { name: "Indietro" })
    fireEvent.click(back)
    const dialog = screen.getByTestId("settings-dirty-dialog")
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole("dialog").className).toContain("z-[100]")
    fireEvent.click(screen.getByTestId("settings-dirty-discard"))
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(puts).toHaveLength(0)
  })
})

describe("settings exit-confirm guarded actions", () => {
  it("install runs save-then-action only on ACK, never before", async () => {
    const closeSpy = vi.fn()
    const installSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy, onOpenInstall: installSpy })
    await makeDirty()
    fireEvent.click(screen.getByTestId("settings-install"))
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    expect(installSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
    // Action flavor: the primary button offers save-and-continue.
    expect(screen.getByTestId("settings-dirty-save")).toHaveTextContent("Salva e continua")
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await act(async () => {})
    expect(puts).toHaveLength(1)
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(installSpy).toHaveBeenCalledTimes(1)
  })

  it("guarded action never runs on a failed save; the modal stays open", async () => {
    const closeSpy = vi.fn()
    const installSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy, onOpenInstall: installSpy })
    await makeDirty()
    fireEvent.click(screen.getByTestId("settings-install"))
    putOk = false
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await screen.findByTestId("settings-dirty-error")
    expect(installSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    // Retry succeeds and only then runs the action.
    putOk = true
    fireEvent.click(screen.getByTestId("settings-dirty-save"))
    await act(async () => {})
    expect(installSpy).toHaveBeenCalledTimes(1)
    expect(puts).toHaveLength(2)
  })

  it("guarded discard closes then runs the action with zero PUT", async () => {
    const closeSpy = vi.fn()
    const installSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy, onOpenInstall: installSpy })
    await makeDirty()
    fireEvent.click(screen.getByTestId("settings-install"))
    fireEvent.click(screen.getByTestId("settings-dirty-discard"))
    expect(puts).toHaveLength(0)
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(installSpy).toHaveBeenCalledTimes(1)
  })
})
