import { describe, expect, it, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const httpMock = vi.hoisted(() => vi.fn())
const httpImpl = vi.hoisted(() => ({ fn: null as null | ((...args: unknown[]) => Promise<unknown>) }))
vi.mock("@/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/http")>(),
  http: (...args: unknown[]) => httpImpl.fn ? httpImpl.fn(...args) : httpMock(...args),
}))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/settings/VisualPresetsSection", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  PresetThumbnail: ({ url }: { url: string }) => <img data-testid="thumb" src={url} alt="" />,
}))

import { ApiError } from "@/lib/http"
import { SharedPresetsSection, type SharedPreset } from "@/components/settings/SharedPresetsSection"

const entry = (id: string, mine: boolean, canRemove = mine): SharedPreset => ({
  id, name: `Look ${id}`, authorName: null, shape: "portrait", values: {} as SharedPreset["values"], mine, canRemove, likeCount: 0, likedByMe: false,
})

const renderSection = (props: Partial<Parameters<typeof SharedPresetsSection>[0]> = {}) => {
  const onApply = vi.fn()
  const utils = render(
    <SharedPresetsSection shape="portrait" refreshKey={0} thumbnailFor={() => "/thumb.png"} onApply={onApply} {...props} />,
  )
  return { ...utils, onApply }
}

beforeEach(() => { httpMock.mockReset(); httpImpl.fn = null })

describe("SharedPresetsSection", () => {
  it("lists entries, applies on click and shows removal only where allowed", async () => {
    httpMock.mockResolvedValue({ presets: [entry("a", true), entry("b", false), entry("c", false, true)] })
    const { onApply } = renderSection()
    await screen.findByTestId("shared-preset-a")
    expect(screen.getByTestId("shared-preset-unpublish-a")).toBeTruthy()
    expect(screen.queryByTestId("shared-preset-unpublish-b")).toBeNull()
    expect(screen.getByTestId("shared-preset-unpublish-c")).toBeTruthy()
    expect(screen.getAllByText("ui.sharedPresetMine")).toHaveLength(1)
    fireEvent.click(screen.getByTestId("shared-preset-b"))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }))
  })

  it("unpublishes via DELETE and shows the returned list", async () => {
    httpMock.mockResolvedValueOnce({ presets: [entry("a", true)] }).mockResolvedValueOnce({ presets: [] })
    renderSection()
    fireEvent.click(await screen.findByTestId("shared-preset-unpublish-a"))
    await screen.findByText("ui.sharedPresetsEmpty")
    expect(httpMock).toHaveBeenLastCalledWith("/api/defaults/presets/shared", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: "a" }) }))
  })

  it("reloads when refreshKey changes", async () => {
    httpMock.mockResolvedValueOnce({ presets: [] }).mockResolvedValueOnce({ presets: [entry("new", true)] })
    const { rerender, onApply } = renderSection()
    await screen.findByText("ui.sharedPresetsEmpty")
    rerender(<SharedPresetsSection shape="portrait" refreshKey={1} thumbnailFor={() => null} onApply={onApply} />)
    await screen.findByTestId("shared-preset-new")
  })

  it("leaves built-in ready looks out (the tab already shows them)", async () => {
    httpMock.mockResolvedValue({ presets: [entry("ready:portrait:apple", false), entry("u", false)].map((p, i) => i === 0 ? { ...p, builtin: "apple", values: null } : p) })
    renderSection()
    await screen.findByTestId("shared-preset-u")
    expect(screen.queryByTestId("shared-preset-ready:portrait:apple")).toBeNull()
  })

  it("collapsible: closed by default, no thumbnails until opened", async () => {
    httpMock.mockResolvedValue({ presets: [{ ...entry("a", false), values: {} as SharedPreset["values"] }] })
    const thumbnailFor = vi.fn(() => "/thumb.png")
    render(<SharedPresetsSection shape="portrait" refreshKey={0} collapsible thumbnailFor={thumbnailFor} onApply={() => {}} />)
    await screen.findByTestId("shared-preset-a")
    const toggle = screen.getByTestId("shared-presets-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(thumbnailFor).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(thumbnailFor).toHaveBeenCalled()
  })

  it("shows only the top N and links to the community page", async () => {
    httpMock.mockResolvedValue({ presets: ["a", "b", "c"].map((id) => entry(id, false)) })
    const onSeeAll = vi.fn()
    renderSection({ limit: 2, onSeeAll })
    await screen.findByTestId("shared-preset-a")
    expect(screen.getByTestId("shared-preset-b")).toBeTruthy()
    expect(screen.queryByTestId("shared-preset-c")).toBeNull()
    fireEvent.click(screen.getByTestId("shared-presets-see-all"))
    expect(onSeeAll).toHaveBeenCalled()
  })

  it("hides itself when the server refuses the caller", async () => {
    httpImpl.fn = async () => { throw new ApiError(401, "Unauthorized") }
    const { container } = renderSection()
    await waitFor(() => expect(container.querySelector("[data-testid=shared-presets-section]")).toBeNull())
  })

  it("shows a retry on other failures", async () => {
    httpImpl.fn = async () => { throw new Error("network") }
    renderSection()
    await screen.findByText("ui.sharedPresetsError")
    expect(screen.getByText("ui.retry")).toBeTruthy()
  })
})
