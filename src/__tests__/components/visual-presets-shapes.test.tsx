import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { BETTER_POSTER_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import { http } from "@/lib/http"
import { captureVisualPreset, resolveEffectiveLandscape } from "@/lib/visual-presets"
import type { VisualPreset } from "@/lib/visual-presets"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>()
  return { ...actual, http: vi.fn() }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const httpMock = vi.mocked(http)

type Editor = ReturnType<typeof usePosterEditor>
const editorBox: { current: Editor | null } = { current: null }
function Probe() {
  const ed = usePosterEditor()
  useEffect(() => { editorBox.current = ed })
  return null
}
const editor = () => editorBox.current!

const seen: { path: string; method?: string; body?: unknown }[] = []
const store: Record<"portrait" | "landscape", VisualPreset[]> = { portrait: [], landscape: [] }

function entry(shape: "portrait" | "landscape", name: string, values: unknown, id: string): VisualPreset {
  return { id, name, shape, values } as VisualPreset
}

function mockShapedHttp() {
  httpMock.mockImplementation(async (path: string, opts?: { method?: string; body?: BodyInit | null }) => {
    const body = opts?.body ? JSON.parse(String(opts.body)) : undefined
    seen.push({ path, method: opts?.method, body })
    const shape = !opts?.method && path.includes("shape=landscape") ? "landscape" : "portrait"
    if (opts?.method === "POST") {
      // Like the real route, mutations take the shape from the body.
      const target = (body.shape ?? "portrait") as "portrait" | "landscape"
      const id = store[target].find((p) => p.name === body.name)?.id ?? `id-${target}-${store[target].length}`
      const next = [...store[target].filter((p) => p.id !== id && p.name !== body.name), { id, ...body }]
      store[target] = next
      return { presets: next }
    }
    if (opts?.method === "DELETE") {
      const target = (body.shape ?? "portrait") as "portrait" | "landscape"
      store[target] = store[target].filter((p) => p.id !== body.id)
      return { presets: [...store[target]] }
    }
    return { presets: [...store[shape]] }
  })
}

async function openDisclosure() {
  const toggle = await screen.findByRole("button", { name: /ui\.visualPresetsTitle/ })
  fireEvent.click(toggle)
}

beforeEach(() => {
  vi.clearAllMocks()
  seen.length = 0
  store.portrait = []
  store.landscape = []
  editorBox.current = null
  window.localStorage.clear()
  mockShapedHttp()
})

describe("VisualPresetsSection orientation lists", () => {
  it("portrait save/apply/delete are shape-scoped and portrait apply preserves effective landscape", async () => {
    renderWithCtx(<><Probe /><VisualPresetsSection shape="portrait" /></>)
    await openDisclosure()
    expect(seen.some((r) => r.path.includes("/api/defaults/presets?shape=portrait"))).toBe(true)

    // Sparse landscape profile: only an explicit scale override.
    const saved = captureVisualPreset(editor())
    act(() => { editor().setLandscape({ topBadgeScale: 150 }) })

    fireEvent.change(screen.getByPlaceholderText("ui.visualPresetName"), { target: { value: "Same" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.visualPresetSave" }))
    await screen.findByRole("button", { name: "Same" })
    expect(seen.find((r) => r.method === "POST")?.body).toMatchObject({ name: "Same", shape: "portrait" })

    // Drift flats AND globals away from the saved look, then re-apply.
    const otherStyle = saved.defaultBadgeStyle === "pill" ? "colored" : "pill"
    const otherTop = saved.defaultTopBadgeScale === 130 ? 140 : 130
    const otherSources = saved.defaultRatingSources.includes("letterboxd") ? ["imdb"] : ["letterboxd"]
    const otherAlign = saved.defaultLogoAlign === "left" ? "center" : "left"
    act(() => {
      editor().setDefaultBadgeStyle(otherStyle)
      editor().setDefaultTopBadgeScale(otherTop)
      editor().setDefaultRatingSources(otherSources)
      editor().setDefaultLogoAlign(otherAlign)
    })
    const effectiveBeforeApply = resolveEffectiveLandscape(captureVisualPreset(editor()))

    fireEvent.click(screen.getByRole("button", { name: "Same" }))
    const after = captureVisualPreset(editor())
    // Mapped portrait flats restored…
    expect(after.defaultBadgeStyle).toBe(saved.defaultBadgeStyle)
    expect(after.defaultTopBadgeScale).toBe(saved.defaultTopBadgeScale)
    // …globals and delivery NOT restored (isolated presets never write them)…
    expect(after.defaultRatingSources).toEqual(otherSources)
    expect(after.defaultLogoAlign).toBe(otherAlign)
    expect(after.defaultPosterShape).toBe(saved.defaultPosterShape)
    // …explicit landscape override kept, effective landscape bit-identical.
    expect(editor().landscape.topBadgeScale).toBe(150)
    expect(resolveEffectiveLandscape(after)).toEqual(effectiveBeforeApply)
    // Highlight follows the isolated projection.
    expect(screen.getByRole("button", { name: "Same" })).toHaveAttribute("aria-pressed", "true")

    // Delete sends shape membership and empties only the portrait list.
    fireEvent.click(screen.getByRole("button", { name: "ui.delete Same" }))
    await screen.findByText("0/20")
    expect(seen.find((r) => r.method === "DELETE")?.body).toMatchObject({ shape: "portrait" })
  })

  it("landscape list is independent: same name allowed, apply is profile-only", async () => {
    store.portrait = [entry("portrait", "Same", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-p")]
    store.landscape = [
      entry("landscape", "Same", {
        ...BETTER_POSTER_VISUAL_DEFAULTS,
        defaultBadgeStyle: "colored",
        landscape: { badgeStyle: "vetro" as const },
      }, "id-l"),
      entry("landscape", "Wide", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-w"),
    ]
    const { rerender } = renderWithCtx(<><Probe /><VisualPresetsSection shape="portrait" /></>)
    await openDisclosure()
    await screen.findByRole("button", { name: "Same" })

    rerender(<><Probe /><VisualPresetsSection shape="landscape" /></>)
    // Landscape-only marker proves the landscape list (not the portrait one) loaded.
    await screen.findByRole("button", { name: "Wide" })
    expect(seen.some((r) => r.path.includes("shape=landscape") && !r.method)).toBe(true)
    const before = captureVisualPreset(editor())
    act(() => { editor().setLandscape({ badgeStyle: "shadow" }) })

    // Landscape save stores the effective resolution in the profile.
    fireEvent.change(screen.getByPlaceholderText("ui.visualPresetName"), { target: { value: "WideNew" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.visualPresetSave" }))
    await screen.findByRole("button", { name: "WideNew" })
    const saveCall = seen.find((r) => r.method === "POST" && (r.body as { name?: string })?.name === "WideNew")
    expect(saveCall?.body).toMatchObject({ name: "WideNew", shape: "landscape" })
    expect((saveCall?.body as { values: { landscape: Record<string, unknown> } }).values.landscape.badgeStyle).toBeDefined()

    // Landscape apply: flats untouched, profile updated.
    fireEvent.click(screen.getByRole("button", { name: "Same" }))
    const after = captureVisualPreset(editor())
    expect(after.defaultBadgeStyle).toBe(before.defaultBadgeStyle)
    expect(after.defaultTopBadgeScale).toBe(before.defaultTopBadgeScale)
    expect(after.defaultRatingSources).toEqual(before.defaultRatingSources)
    expect(editor().landscape.badgeStyle).toBe("vetro")

    // Delete removes only the landscape twin; the portrait twin survives.
    fireEvent.click(screen.getByRole("button", { name: "ui.delete Same" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Same" })).toBeNull())
    expect(seen.find((r) => r.method === "DELETE")?.body).toMatchObject({ id: "id-l", shape: "landscape" })
    expect(store.portrait).toHaveLength(1)
    expect(store.landscape.map((p) => p.name).sort()).toEqual(["Wide", "WideNew"])
  })

  it("late load responses after a shape switch are dropped", async () => {
    let releasePortrait!: (value: { presets: VisualPreset[] }) => void
    const portraitPending = new Promise<{ presets: VisualPreset[] }>((resolve) => { releasePortrait = resolve })
    const landscapeEntry = entry("landscape", "Wide", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-w")
    const staleEntry = entry("portrait", "Stale", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-p")
    httpMock.mockImplementation(async (path: string, opts?: { method?: string; body?: BodyInit | null }) => {
      seen.push({ path, method: opts?.method, body: opts?.body ? JSON.parse(String(opts.body)) : undefined })
      if (!opts?.method && !String(path).includes("shape=landscape")) return portraitPending
      return { presets: [landscapeEntry] }
    })
    const { rerender } = renderWithCtx(<><Probe /><VisualPresetsSection shape="portrait" /></>)
    await openDisclosure()
    // Portrait load still pending: status shown, nothing stale clickable.
    expect(screen.getByRole("status")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Stale" })).toBeNull()

    rerender(<><Probe /><VisualPresetsSection shape="landscape" /></>)
    await screen.findByRole("button", { name: "Wide" })

    // The abandoned portrait response resolves late: dropped, landscape intact.
    await act(async () => { releasePortrait({ presets: [staleEntry] }) })
    expect(screen.queryByRole("button", { name: "Stale" })).toBeNull()
    expect(screen.getByRole("button", { name: "Wide" })).toBeInTheDocument()
    expect(screen.getByText("1/20")).toBeInTheDocument()
  })

  it("late mutation responses after a shape switch are dropped", async () => {
    let releasePost!: (value: { presets: VisualPreset[] }) => void
    const postPending = new Promise<{ presets: VisualPreset[] }>((resolve) => { releasePost = resolve })
    const portraitEntry = entry("portrait", "Keep", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-p")
    const landscapeEntry = entry("landscape", "Wide", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-w")
    httpMock.mockImplementation(async (path: string, opts?: { method?: string; body?: BodyInit | null }) => {
      const body = opts?.body ? JSON.parse(String(opts.body)) : undefined
      seen.push({ path, method: opts?.method, body })
      if (opts?.method === "POST") return postPending
      return { presets: [String(path).includes("shape=landscape") ? landscapeEntry : portraitEntry] }
    })
    const { rerender } = renderWithCtx(<><Probe /><VisualPresetsSection shape="portrait" /></>)
    await openDisclosure()
    await screen.findByRole("button", { name: "Keep" })

    fireEvent.change(screen.getByPlaceholderText("ui.visualPresetName"), { target: { value: "New" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.visualPresetSave" }))
    rerender(<><Probe /><VisualPresetsSection shape="landscape" /></>)
    await screen.findByRole("button", { name: "Wide" })

    // The portrait POST resolves late: dropped, landscape intact.
    const savedEntry = entry("portrait", "New", { ...BETTER_POSTER_VISUAL_DEFAULTS }, "id-new")
    await act(async () => { releasePost({ presets: [portraitEntry, savedEntry] }) })
    expect(screen.queryByRole("button", { name: "New" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull()
    expect(screen.getByRole("button", { name: "Wide" })).toBeInTheDocument()
  })
})
