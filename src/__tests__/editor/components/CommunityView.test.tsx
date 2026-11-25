import { describe, expect, it, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const m = vi.hoisted(() => ({
  http: vi.fn(),
  httpImpl: null as null | ((...args: unknown[]) => Promise<unknown>),
  setEditTargetShape: vi.fn(),
  setSettingsOpen: vi.fn(),
  requestPresetApply: vi.fn(),
  requestSettingsTab: vi.fn(),
}))
vi.mock("@/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/http")>(),
  http: (...args: unknown[]) => m.httpImpl ? m.httpImpl(...args) : m.http(...args),
}))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key, lang: "it" }),
}))
vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({ editTargetShape: "portrait", landscape: {}, setEditTargetShape: m.setEditTargetShape }),
}))
vi.mock("@/lib/context", () => ({
  usePSelector: (pick: (v: Record<string, unknown>) => unknown) => pick({
    setSettingsOpen: m.setSettingsOpen, currentUserId: "u", tmdbKey: "", localConfigToken: null,
  }),
}))
vi.mock("@/lib/defaults-preview-media", () => ({ usePreviewDemoMedia: () => [null, () => {}] }))
vi.mock("@/components/settings/DefaultsPosterPreview", () => ({ buildDefaultsPreviewUrlFromEditor: () => ({ url: "/thumb.png" }) }))
vi.mock("@/components/settings/VisualPresetsSection", () => ({ PresetThumbnail: () => null }))
vi.mock("@/lib/visual-presets", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/visual-presets")>(),
  captureVisualPreset: () => ({}),
}))
vi.mock("@/lib/preset-apply-projection", () => ({
  projectPreset: (_ed: unknown, _live: unknown, values: unknown) => values,
  withTargetExtraCleanup: (values: unknown) => values,
}))
vi.mock("@/lib/community-preset-apply", () => ({ requestPresetApply: m.requestPresetApply }))
vi.mock("@/lib/settings-tab", () => ({ requestSettingsTab: m.requestSettingsTab }))

import { ApiError } from "@/lib/http"
import { CommunityView } from "@/components/CommunityView"
import type { SharedPreset } from "@/components/settings/SharedPresetsSection"

const entry = (id: string, extra: Partial<SharedPreset> = {}): SharedPreset => ({
  id, name: `Look ${id}`, authorName: null, shape: "portrait", values: {} as SharedPreset["values"],
  mine: false, canRemove: false, likeCount: 0, likedByMe: false, ...extra,
})

beforeEach(() => {
  m.http.mockReset()
  m.httpImpl = null
  for (const fn of [m.setEditTargetShape, m.setSettingsOpen, m.requestPresetApply, m.requestSettingsTab]) fn.mockReset()
})

describe("CommunityView", () => {
  it("ranks entries, disables liking your own and sends an idempotent like", async () => {
    m.http.mockResolvedValueOnce({ presets: [entry("top", { likeCount: 3 }), entry("own", { mine: true, canRemove: true })] })
      .mockResolvedValueOnce({ presets: [entry("top", { likeCount: 4, likedByMe: true }), entry("own", { mine: true, canRemove: true })] })
    render(<CommunityView />)
    await screen.findByTestId("community-preset-top")
    expect(screen.getByTestId("community-preset-top").textContent).toContain("#1")
    expect((screen.getByTestId("community-like-own") as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId("community-rename-top")).toBeNull()
    fireEvent.click(screen.getByTestId("community-like-top"))
    await waitFor(() => expect(screen.getByTestId("community-like-top").getAttribute("aria-pressed")).toBe("true"))
    expect(m.http).toHaveBeenLastCalledWith("/api/defaults/presets/shared", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "top", like: true }) }))
  })

  it("renames inline: Enter saves, Escape cancels", async () => {
    m.http.mockResolvedValueOnce({ presets: [entry("own", { mine: true })] })
      .mockResolvedValueOnce({ presets: [entry("own", { mine: true, name: "Nuovo" })] })
    render(<CommunityView />)
    fireEvent.click(await screen.findByTestId("community-rename-own"))
    const input = screen.getByTestId("community-rename-input-own")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByTestId("community-rename-input-own")).toBeNull()
    fireEvent.click(screen.getByTestId("community-rename-own"))
    fireEvent.change(screen.getByTestId("community-rename-input-own"), { target: { value: "Nuovo" } })
    fireEvent.submit(screen.getByTestId("community-rename-input-own").closest("form")!)
    await screen.findByText("Nuovo")
    expect(m.http).toHaveBeenLastCalledWith("/api/defaults/presets/shared", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "own", name: "Nuovo" }) }))
  })

  it("Apply stages the preset and opens settings on the Preset tab", async () => {
    m.http.mockResolvedValueOnce({ presets: [entry("a")] })
    render(<CommunityView />)
    fireEvent.click(await screen.findByTestId("community-apply-a"))
    expect(m.setEditTargetShape).toHaveBeenCalledWith("portrait")
    expect(m.requestPresetApply).toHaveBeenCalledWith(expect.objectContaining({ id: "a", shape: "portrait" }))
    expect(m.requestSettingsTab).toHaveBeenCalledWith("preset")
    expect(m.setSettingsOpen).toHaveBeenCalledWith(true)
  })

  it("shows built-in ready looks labelled Pictorium and applies them through the ready path", async () => {
    m.http.mockResolvedValueOnce({ presets: [entry("ready:portrait:fresh", { builtin: "fresh", values: null, name: "Fresh", likeCount: 2 })] })
    render(<CommunityView />)
    await screen.findByTestId("community-builtin-ready:portrait:fresh")
    expect(screen.getByText("ui.configPresetFresh")).toBeTruthy()
    expect(screen.queryByTestId("community-rename-ready:portrait:fresh")).toBeNull()
    expect((screen.getByTestId("community-like-ready:portrait:fresh") as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId("community-apply-ready:portrait:fresh"))
    expect(m.requestPresetApply).toHaveBeenCalledWith(expect.objectContaining({ id: "fresh", name: "ui.configPresetFresh", ready: { fresh: true } }))
  })

  it("explains when the caller has no space on this instance", async () => {
    m.httpImpl = async () => { throw new ApiError(401, "Unauthorized") }
    render(<CommunityView />)
    await screen.findByTestId("community-unavailable")
  })
})
