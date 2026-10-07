import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BETTER_POSTER_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import {
  GRADIENT_PRESET_NERO,
  NATURAL_GRADIENT_DEFAULTS,
  addCustomGradientPreset,
  resetCustomPresetStore,
  useCustomGradientPresets,
} from "@/lib/gradient-presets"
import { http } from "@/lib/http"
import { MAX_PRESET_FILE_BYTES } from "@/lib/preset-file"
import { usePresetTransfer } from "@/lib/usePresetTransfer"
import type { VisualPreset } from "@/lib/visual-presets"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"
import { GradientPresetRow } from "@/components/GradientPresetRow"

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>()
  return { ...actual, http: vi.fn() }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"

const httpMock = vi.mocked(http)
const toastMock = vi.mocked(toast)

const VISUAL = BETTER_POSTER_VISUAL_DEFAULTS
const GRADIENT = { ...NATURAL_GRADIENT_DEFAULTS }
const UID = "123e4567-e89b-12d3-a456-426614174000"

function visualEntry(name: string, extraValues: Record<string, unknown> = {}): VisualPreset {
  return { id: UID, name, values: { ...VISUAL, ...extraValues } } as VisualPreset
}

function presetFile(body: unknown): File {
  return new File([JSON.stringify(body)], "presets.json", { type: "application/json" })
}

const downloaded: { filename: string; json: string }[] = []
const clickedFilenames: string[] = []
const posted: unknown[] = []
const methods: (string | undefined)[] = []

function mockAnchors() {
  window.URL.createObjectURL = vi.fn((blob: unknown) => {
    void (blob as Blob).text().then((text) => downloaded.push({ filename: clickedFilenames[downloaded.length] ?? "", json: text }))
    return "blob:mock"
  }) as unknown as typeof URL.createObjectURL
  window.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedFilenames.push(this.download)
  })
}

function mockHttpList(fresh: VisualPreset[], landscapeFresh: VisualPreset[] = [], failPost = false) {
  const lists = { portrait: [...fresh], landscape: [...landscapeFresh] }
  httpMock.mockImplementation(async (_path: string, opts?: { method?: string; body?: BodyInit | null }) => {
    methods.push(opts?.method)
    if (opts?.method === "POST") {
      const body = JSON.parse(String(opts.body))
      posted.push(body)
      if (failPost) throw new Error("denied")
      const target = body.shape === "landscape" ? "landscape" : "portrait"
      lists[target] = [...lists[target], { id: UID, ...body }]
      return { presets: lists[target] }
    }
    const target = String(_path).includes("shape=landscape") ? "landscape" : "portrait"
    return { presets: lists[target] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  downloaded.length = 0
  clickedFilenames.length = 0
  posted.length = 0
  methods.length = 0
  resetCustomPresetStore()
  window.localStorage.clear()
  mockAnchors()
})

async function flushBlobs() {
  await act(async () => { await Promise.resolve() })
}

function storeNames(): string[] {
  const probe = renderHook(() => useCustomGradientPresets(), { wrapper: createWrapper() })
  const names = probe.result.current.map((p) => p.name)
  probe.unmount()
  return names
}

describe("usePresetTransfer", () => {
  it("export-all downloads a combined file without secrets or config", async () => {
    mockHttpList([visualEntry("Look", { tmdbKey: "V-SECRET", apiKey: "V-SECRET" })])
    act(() => { addCustomGradientPreset("Mine", GRADIENT) })
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    await act(async () => { await result.current.exportAll() })
    await flushBlobs()
    expect(downloaded).toHaveLength(1)
    expect(clickedFilenames).toMatchObject([expect.stringMatching(/^pictorium-presets-\d{4}-\d{2}-\d{2}\.json$/)])
    const body = JSON.parse(downloaded[0]?.json ?? "{}")
    expect(Object.keys(body).sort()).toEqual(["exportedAt", "formatVersion", "gradientPresets", "kind", "visualPresets"])
    expect(body.visualPresets).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain("SECRET")
    expect(body.gradientPresets).toEqual([{ name: "Mine", values: GRADIENT }])
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it("single exports use slugged filenames and single-entry payloads", async () => {
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    act(() => { result.current.exportVisual({ name: "My Look!", values: VISUAL }) })
    act(() => { result.current.exportGradient({ name: "Glow", values: GRADIENT }) })
    await flushBlobs()
    expect(clickedFilenames).toEqual([
      "pictorium-visual-preset-my-look.json",
      "pictorium-gradient-preset-glow.json",
    ])
    expect(JSON.parse(downloaded[0]?.json ?? "{}").visualPresets).toHaveLength(1)
    expect(JSON.parse(downloaded[1]?.json ?? "{}").gradientPresets).toHaveLength(1)
  })

  it("import POSTs only missing names (ADD-only, no PUT/DELETE, secret entries skipped)", async () => {
    mockHttpList([visualEntry("Keep")])
    const onVisualsChanged = vi.fn()
    const { result } = renderHook(() => usePresetTransfer({ onVisualsChanged }), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        { name: "  KEEP  ", values: VISUAL },
        { name: "Fresh", values: VISUAL },
        { name: "Leaky", values: { ...VISUAL, adminToken: "V-SECRET" } },
      ],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({ name: "Fresh", shape: "portrait", values: VISUAL })
    expect(methods).not.toContain("PUT")
    expect(methods).not.toContain("DELETE")
    expect(JSON.stringify(posted)).not.toContain("SECRET")
    expect(onVisualsChanged).toHaveBeenCalledWith("portrait", expect.any(Array))
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.success.mock.calls[0]?.[0]).toBe("ui.presetFileImportOk")
  })

  it("import skips quota overflow without POSTing and reports info on zero applied", async () => {
    const existing = Array.from({ length: 20 }, (_, i) => visualEntry(`E${i}`))
    mockHttpList(existing)
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ name: "Extra", values: VISUAL }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(posted).toHaveLength(0)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.info).toHaveBeenCalledTimes(1)
    expect(toastMock.info.mock.calls[0]?.[0]).toBe("ui.presetFileImportEmpty")
  })

  it("import routes entries per shape with separate namespaces and per-shape refresh", async () => {
    mockHttpList([visualEntry("Twin")], [{ ...visualEntry("Wide"), shape: "landscape" }])
    const onVisualsChanged = vi.fn()
    const { result } = renderHook(() => usePresetTransfer({ onVisualsChanged }), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [
        { name: "  TWIN  ", values: VISUAL },
        { name: "Twin", shape: "landscape", values: VISUAL },
        { name: "Fresh", shape: "landscape", values: VISUAL },
      ],
    })
    await act(async () => { await result.current.importFile(file) })
    // Portrait "Twin" collides (skipped); landscape twins are a separate
    // namespace, so both landscape entries POST with their shape.
    expect(posted).toEqual([
      { name: "Twin", shape: "landscape", values: VISUAL },
      { name: "Fresh", shape: "landscape", values: VISUAL },
    ])
    expect(onVisualsChanged).toHaveBeenCalledWith("landscape", expect.any(Array))
    expect(onVisualsChanged).not.toHaveBeenCalledWith("portrait", expect.any(Array))
    expect(toastMock.success.mock.calls[0]?.[0]).toBe("ui.presetFileImportOk")
  })

  it("export-all carries both lists with shapes; single export preserves shape", async () => {
    mockHttpList([visualEntry("Look")], [{ ...visualEntry("Wide"), shape: "landscape" }])
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    await act(async () => { await result.current.exportAll() })
    await flushBlobs()
    const body = JSON.parse(downloaded[0]?.json ?? "{}")
    expect(body.visualPresets.map((v: { name: string; shape: string }) => [v.name, v.shape])).toEqual([
      ["Look", "portrait"],
      ["Wide", "landscape"],
    ])
    act(() => { result.current.exportVisual({ name: "Wide", shape: "landscape", values: VISUAL }) })
    await flushBlobs()
    expect(JSON.parse(downloaded[1]?.json ?? "{}").visualPresets).toEqual([
      { name: "Wide", shape: "landscape", values: expect.any(Object) },
    ])
  })

  it("import adds gradients to the live store so the UI refreshes", async () => {
    mockHttpList([])
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      gradientPresets: [{ name: "Glow", values: GRADIENT }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(storeNames()).toContain("Glow")
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it("gradient-only file imports without any server call, even when the server is down", async () => {
    httpMock.mockRejectedValue(new Error("server down"))
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      gradientPresets: [{ name: "Glow", values: GRADIENT }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(httpMock).not.toHaveBeenCalled()
    expect(storeNames()).toContain("Glow")
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it("planning reads the live store, not the stale render closure", async () => {
    mockHttpList([])
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    // Concurrent add AFTER hook creation: a stale closure would miss it and dup it.
    act(() => { addCustomGradientPreset("Glow", GRADIENT) })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      gradientPresets: [{ name: "glow", values: GRADIENT }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(storeNames()).toEqual(["Glow"])
    expect(toastMock.info).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("gradient added during visual POSTs is skipped, never duplicated", async () => {
    httpMock.mockImplementation(async (_path: string, opts?: { method?: string; body?: BodyInit | null }) => {
      methods.push(opts?.method)
      if (opts?.method === "POST") {
        const body = JSON.parse(String(opts.body))
        posted.push(body)
        // Concurrent add while our POST is pending: the final live snapshot
        // must see it as a duplicate.
        addCustomGradientPreset("Glow", GRADIENT)
        return { presets: [visualEntry("Fresh")] }
      }
      return { presets: [] }
    })
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ name: "Fresh", values: VISUAL }],
      gradientPresets: [{ name: "glow", values: GRADIENT }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(posted).toHaveLength(1)
    expect(storeNames()).toEqual(["Glow"])
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(toastMock.success.mock.calls[0]?.[0]).toBe("ui.presetFileImportOk")
  })

  it("unreadable file errors without server calls and resets busy", async () => {
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const bad = presetFile({ kind: "pictorium-presets", formatVersion: 1 })
    vi.spyOn(bad, "text").mockRejectedValue(new Error("read fail"))
    await act(async () => { await result.current.importFile(bad) })
    expect(httpMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error.mock.calls[0]?.[0]).toBe("ui.presetFileImportError")
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })

  it("storage failure adds nothing and errors, never reports success", async () => {
    mockHttpList([])
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError")
    })
    try {
      const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
      const file = presetFile({
        kind: "pictorium-presets",
        formatVersion: 1,
        gradientPresets: [{ name: "Glow", values: GRADIENT }],
      })
      await act(async () => { await result.current.importFile(file) })
      expect(storeNames()).toHaveLength(0)
      expect(toastMock.error).toHaveBeenCalledTimes(1)
      expect(toastMock.success).not.toHaveBeenCalled()
      expect(toastMock.info).not.toHaveBeenCalled()
    } finally {
      setItemSpy.mockRestore()
    }
  })

  it("partial failure (POST down, gradient ok) reports partial error with counts", async () => {
    mockHttpList([], [], true)
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ name: "Fresh", values: VISUAL }],
      gradientPresets: [{ name: "Glow", values: GRADIENT }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(posted).toHaveLength(1)
    expect(storeNames()).toContain("Glow")
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error.mock.calls[0]?.[0]).toBe("ui.presetFileImportPartial")
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("invalid file errors without any server call", async () => {
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    await act(async () => { await result.current.importFile(presetFile({ kind: "nope", formatVersion: 1 })) })
    expect(httpMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("oversize file errors before reading text or calling the server", async () => {
    const { result } = renderHook(() => usePresetTransfer(), { wrapper: createWrapper() })
    const big = new File(["x".repeat(MAX_PRESET_FILE_BYTES + 1)], "big.json", { type: "application/json" })
    await act(async () => { await result.current.importFile(big) })
    expect(httpMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("POST/auth failure is an error, never a success", async () => {
    mockHttpList([], [], true)
    const onVisualsChanged = vi.fn()
    const { result } = renderHook(() => usePresetTransfer({ onVisualsChanged }), { wrapper: createWrapper() })
    const file = presetFile({
      kind: "pictorium-presets",
      formatVersion: 1,
      visualPresets: [{ name: "Fresh", values: VISUAL }],
    })
    await act(async () => { await result.current.importFile(file) })
    expect(posted).toHaveLength(1)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.success).not.toHaveBeenCalled()
    // Total failure changes no list: no refresh callback, error toast only.
    expect(onVisualsChanged).not.toHaveBeenCalled()
  })
})

describe("preset transfer UI", () => {
  async function openDisclosure() {
    const toggle = await screen.findByRole("button", { name: /ui\.visualPresetsTitle/ })
    fireEvent.click(toggle)
    return toggle
  }

  it("VisualPresetsSection is closed by default with mounted header count", async () => {
    mockHttpList([visualEntry("Look")])
    renderWithCtx(<VisualPresetsSection />)
    // Load runs at mount so the header count becomes accurate while closed.
    await screen.findByText("1/20")
    const toggle = await screen.findByRole("button", { name: /ui\.visualPresetsTitle/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(toggle).toHaveAttribute("aria-controls")
    expect(toggle.className).toContain("min-h-[44px]")
    // Header count stays mounted while the body is unmounted.
    expect(toggle.textContent).toContain("1/20")
    expect(screen.queryByRole("button", { name: "ui.presetFileExportAll" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ui.presetFileImport" })).not.toBeInTheDocument()
    expect(screen.queryByText("ui.visualPresetsHint")).not.toBeInTheDocument()
  })

  it("toggle reopens the body with aria states and all transfer controls", async () => {
    mockHttpList([visualEntry("Look")])
    renderWithCtx(<VisualPresetsSection />)
    const toggle = await screen.findByRole("button", { name: /ui\.visualPresetsTitle/ })
    const bodyId = toggle.getAttribute("aria-controls")
    expect(bodyId).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByRole("button", { name: "ui.presetFileExportAll" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ui.presetFileImport" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ui.presetFileExportOne Look" })).toBeInTheDocument()
    expect(screen.getByText("ui.visualPresetsHint")).toBeInTheDocument()
    // aria-controls points at the mounted body.
    expect(document.getElementById(bodyId!)).not.toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "ui.presetFileExportAll" })).not.toBeInTheDocument()
  })

  it("disclosure toggles via keyboard on the native button", async () => {
    mockHttpList([visualEntry("Look")])
    renderWithCtx(<VisualPresetsSection />)
    const toggle = await screen.findByRole("button", { name: /ui\.visualPresetsTitle/ })
    expect(toggle.tagName).toBe("BUTTON")
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    await userEvent.keyboard("{Enter}")
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByRole("button", { name: "ui.presetFileExportAll" })).toBeInTheDocument()
    await userEvent.keyboard(" ")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "ui.presetFileExportAll" })).not.toBeInTheDocument()
  })

  it("VisualPresetsSection shows combined export/import and per-preset download", async () => {
    mockHttpList([visualEntry("Look")])
    renderWithCtx(<VisualPresetsSection />)
    await openDisclosure()
    expect(await screen.findByRole("button", { name: "ui.presetFileExportAll" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ui.presetFileImport" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ui.presetFileExportOne Look" })).toBeInTheDocument()
  })

  it("GradientPresetRow shows single/all gradient transfer controls", () => {
    renderWithCtx(
      <GradientPresetRow
        current={GRADIENT}
        onApply={() => {}}
        naturalLabel="Naturale"
        colorLabel="Colore"
        addTitle="Aggiungi"
        namePlaceholder="Nome"
        deleteLabel="Elimina"
      />,
    )
    expect(screen.getByRole("button", { name: "ui.presetFileExportGradients" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ui.presetFileImport" })).toBeInTheDocument()
  })

  it("GradientPresetRow applies the Nero built-in via its chip", () => {
    const onApply = vi.fn()
    renderWithCtx(
      <GradientPresetRow
        current={{ ...GRADIENT_PRESET_NERO }}
        onApply={onApply}
        naturalLabel="Naturale"
        colorLabel="Colore"
        neroLabel="Nero"
        addTitle="Aggiungi"
        namePlaceholder="Nome"
        deleteLabel="Elimina"
      />,
    )
    const nero = screen.getByRole("button", { name: "Nero" })
    expect(nero).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(nero)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(GRADIENT_PRESET_NERO)
  })
})
