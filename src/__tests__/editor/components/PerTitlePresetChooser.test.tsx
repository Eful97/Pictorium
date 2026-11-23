/**
 * PerTitlePresetChooser (task 2, UI):
 * collapsed quick-preset disclosure in single-poster customization. Closed by
 * default and keyboard operable; expanding shows the eleven canonical ready
 * looks (same source as the global Preset-tab gallery) plus the saved
 * GET /api/defaults/presets?shape=). Every apply goes through the per-title
 * action only — never the global-defaults applier, never autosave. Stale
 * orientation/user responses are never shown nor clickable; the saved list
 * failure keeps built-ins usable with retry/empty states.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode, useEffect, useState } from "react"
import { PerTitlePresetChooser } from "@/components/PerTitlePresetChooser"
import EditView from "@/components/EditView"
import { PictoriumProvider, type PictoriumCtx } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { http } from "@/lib/http"
import { t as suiteT } from "@/lib/i18n"
import { consumeSettingsTab } from "@/lib/settings-tab"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import itDictionary from "@/lib/translations/it.json"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  FRESH_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import { quickLookDesired } from "@/lib/quick-visual-presets"
import type { VisualPreset } from "@/lib/visual-presets"
import type { SearchResult, TMDBImage } from "@/lib/types"

vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>()
  return { ...actual, http: vi.fn() }
})
const httpMock = vi.mocked(http)

/**
 * Ready-label localization (same eleven global keys as the Preset-tab
 * gallery, `t(labelKey)`): the suite-wide i18n mock only carries three of
 * them, so this suite scopes the REAL Italian dictionary to exactly those
 * eleven label keys. Every other key keeps the suite key-echo behavior
 * (notably `ui.perTitleAgeGlobalNote`), and the global mock is untouched —
 * the Badge-tab quick-look suite still relies on those key echoes.
 */
const READY_LABEL_KEYS = [
  "ui.configPresetApple",
  "ui.configPresetBetterPoster",
  "ui.configPresetNotch",
  "ui.configPresetEditorial",
  "ui.configPresetGlass",
  "ui.configPresetCinema",
  "ui.configPresetMono",
  "ui.configPresetEssential",
  "ui.configPresetRatings",
  "ui.configPresetFull",
  "ui.configPresetFresh",
] as const

const readyItLabels: Record<string, string> = Object.fromEntries(
  READY_LABEL_KEYS.map((k) => [k, (itDictionary as Record<string, string>)[k]]),
)

function chooserT(key: string, params?: Record<string, string | number>): string {
  const hit = readyItLabels[key]
  if (typeof hit === "string" && hit.length > 0) {
    let val = hit
    if (params) {
      for (const [k, v] of Object.entries(params)) val = val.replace(`{${k}}`, String(v))
    }
    return val
  }
  return suiteT(key, params)
}

const hub: {
  setShape?: (s: "portrait" | "landscape") => void
  setUserId?: (u: string | null) => void
  ed: PosterEditorCtx | null
} = { ed: null }

function Probe() {
  const ed = usePosterEditor()
  useEffect(() => { hub.ed = ed })
  return null
}

/**
 * Test-only mirror of the EditView production path: EditView renders
 * `<PerTitlePresetChooser shape={ed.posterShape === "landscape" ? "landscape" : "portrait"} />`,
 * so the editor's own `posterShape` always matches the chooser `shape` prop.
 * The chooser harness keeps the same invariant (prop for the chooser,
 * `setPosterShape` for the editor action) so a landscape apply exercises the
 * real landscape projection instead of the portrait one.
 */
function ShapeSync({ shape }: { shape: "portrait" | "landscape" }) {
  const ed = usePosterEditor()
  const target = shape === "landscape" ? "landscape" : "poster"
  // Re-applied after every render until converged: the provider hydrates
  // defaults (localStorage + server refresh) on mount, which can overwrite a
  // mount-only set back to "poster". Guarded so it settles (no loop).
  useEffect(() => {
    if (ed.posterShape !== target) ed.setPosterShape(target as "landscape" | "poster")
  })
  return null
}

interface HarnessProps {
  shape?: "portrait" | "landscape"
  userId?: string | null
  ctxOverrides?: Partial<PictoriumCtx>
}

function Harness({ shape = "portrait", userId = null, ctxOverrides }: HarnessProps) {
  const [liveShape, setLiveShape] = useState<"portrait" | "landscape">(shape)
  const [liveUserId, setLiveUserId] = useState<string | null>(userId)
  useEffect(() => {
    hub.setShape = setLiveShape
    hub.setUserId = setLiveUserId
  }, [])
  const ctx: PictoriumCtx = { ...MOCK_CTX, t: chooserT, ...ctxOverrides, currentUserId: liveUserId }
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={ctx}>
          <Probe />
          <ShapeSync shape={liveShape} />
          <PerTitlePresetChooser shape={liveShape} />
        </PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

interface PendingGet {
  path: string
  resolve: (presets: VisualPreset[]) => void
  reject: (err: Error) => void
}

let calls: string[]
let pending: PendingGet[]

function entry(name: string, id: string, landscape = false): VisualPreset {
  return {
    id,
    name,
    shape: landscape ? "landscape" : "portrait",
    values: APPLE_VISUAL_DEFAULTS,
  } as VisualPreset
}

beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  pending = []
  hub.ed = null
  hub.setShape = undefined
  hub.setUserId = undefined
  window.localStorage.clear()
  httpMock.mockImplementation(async (path: string) => {
    const p = String(path)
    calls.push(p)
    if (p.startsWith("/api/defaults/presets")) {
      return new Promise<{ presets: VisualPreset[] }>((resolve, reject) => {
        pending.push({
          path: p,
          resolve: (presets) => resolve({ presets }),
          reject,
        })
      })
    }
    return {}
  })
})

function toggle() {
  // Test i18n (setup.ts) echoes the key: "ui.perTitlePresetsTitle · ui.posterShapePortrait".
  return screen.getByRole("button", { name: /ui\.perTitlePresetsTitle/ })
}

async function openChooser(u: ReturnType<typeof userEvent.setup>) {
  // Closed by default: every suite opens explicitly through the real toggle.
  await u.click(toggle())
  expect(toggle()).toHaveAttribute("aria-expanded", "true")
}

async function resolvePending(index: number, presets: VisualPreset[]) {
  await act(async () => { pending[index].resolve(presets) })
}

async function rejectPending(index: number, err = new Error("offline")) {
  await act(async () => { pending[index].reject(err) })
}

function defaultsSnapshot(ed: PosterEditorCtx): Record<string, unknown> {
  const snap: Record<string, unknown> = {}
  for (const key of Object.keys(ed) as (keyof PosterEditorCtx)[]) {
    if (key.startsWith("default") || key === "landscape") snap[key as string] = ed[key]
  }
  return snap
}

const LOGO: TMDBImage = {
  file_path: "/logo.png",
  iso_639_1: "en",
  vote_average: 0,
  width: 200,
  height: 100,
}

describe("PerTitlePresetChooser disclosure", () => {
  it("starts closed with no fetch, and opens via click/Enter/Space with all eleven looks", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    // Closed by default: the heading stays visible and operable, the body is
    // unmounted, and the saved list never fetches while closed.
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Stile BetterPoster")).not.toBeInTheDocument()
    expect(screen.queryByText("Stile Apple")).not.toBeInTheDocument()
    expect(screen.queryByText("Essenziale")).not.toBeInTheDocument()
    expect(calls.filter((c) => c.includes("/api/defaults/presets"))).toHaveLength(0)

    // Click open: all eleven canonical ready looks (same source as the global
    // gallery, same Italian dictionary names via t(labelKey)).
    await u.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "true")
    const controls = toggle().getAttribute("aria-controls")
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls!)).not.toBeNull()
    for (const name of ["Stile Apple", "Stile BetterPoster", "Essenziale", "Voti", "Completo", "Notch", "Editorial", "Glass", "Cinema", "Mono", "Fresh"]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // Honest scope: title-only plus the global-owned age note.
    expect(screen.getByTestId("per-title-age-note")).toHaveTextContent("ui.perTitleAgeGlobalNote")
    expect(calls.filter((c) => c.includes("/api/defaults/presets?shape=portrait"))).toHaveLength(1)

    // Collapse via click unmounts the body (lazy list torn down).
    await u.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Stile BetterPoster")).not.toBeInTheDocument()

    // Keyboard reopen: focus + Enter activates the native disclosure button.
    toggle().focus()
    await u.keyboard("[Enter]")
    expect(toggle()).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Stile BetterPoster")).toBeInTheDocument()

    // Collapse again, then Space opens too (native button behavior).
    await u.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    toggle().focus()
    await u.keyboard(" ")
    expect(toggle()).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Stile Apple")).toBeInTheDocument()
  })

  it("close/reopen keeps data with read-only semantics (lazy GETs only, no PUT, no stored flag)", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await openChooser(u)
    await resolvePending(0, [entry("Mine", "33333333-3333-4333-8333-333333333333")])
    expect(await screen.findByRole("button", { name: "Mine" })).toBeInTheDocument()

    // Collapse unmounts the body, reopen lazily refetches for the same target.
    await u.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    await openChooser(u)
    expect(pending).toHaveLength(2)
    await resolvePending(1, [entry("Mine", "33333333-3333-4333-8333-333333333333")])
    expect(await screen.findByRole("button", { name: "Mine" })).toBeInTheDocument()

    // Read-only disclosure: every request is a lazy saved-list GET, never a
    // PUT; the open state is never persisted (no disclosure storage key).
    expect(calls.every((c) => c.startsWith("/api/defaults/presets?shape="))).toBe(true)
    for (const [, options] of httpMock.mock.calls) {
      expect((options as { method?: string } | undefined)?.method ?? "GET").not.toBe("PUT")
    }
    const storedKeys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key) storedKeys.push(key)
    }
    expect(storedKeys.filter((k) => /disclosure|per-title-preset-open/i.test(k))).toHaveLength(0)
  })
})

describe("PerTitlePresetChooser apply", () => {
  it("applies a built-in through the per-title action only (no global apply, no save, defaults intact)", async () => {
    const u = userEvent.setup()
    const saveConfig = vi.fn()
    render(<Harness ctxOverrides={{ selectedLogo: LOGO, saveConfig }} />)
    await openChooser(u)
    await resolvePending(0, [])

    const before = defaultsSnapshot(hub.ed!)
    const applySpy = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    const globalSpy = vi.spyOn(hub.ed!, "applyVisualPreset")

    await u.click(screen.getByRole("button", { name: "Stile BetterPoster" }))

    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy).toHaveBeenCalledWith(BETTER_POSTER_VISUAL_DEFAULTS, LOGO)
    expect(globalSpy).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
    // Global defaults untouched; the live title took the snapshot values.
    expect(defaultsSnapshot(hub.ed!)).toEqual(before)
    expect(hub.ed!.badgeYear).toBe(BETTER_POSTER_VISUAL_DEFAULTS.defaultBadgeYear)
  })

  it("applies a saved preset in landscape with the selected logo (landscape-only gradient, portrait/defaults intact)", async () => {
    const u = userEvent.setup()
    render(<Harness shape="landscape" ctxOverrides={{ selectedLogo: LOGO }} />)
    await openChooser(u)
    expect(calls.some((c) => c.includes("/api/defaults/presets?shape=landscape"))).toBe(true)
    await resolvePending(0, [entry("Wide look", "22222222-2222-4222-8222-222222222222", true)])

    // The harness mirrors production: editor posterShape follows the chooser
    // shape prop (EditView derives the prop from ed.posterShape).
    await waitFor(() => expect(hub.ed!.posterShape).toBe("landscape"))
    // Apple flat blurFade is 50, the nested landscape profile is 100: only a
    // genuine landscape projection can produce 100 in landscapeBlur.
    const beforePortraitGradient = hub.ed!.gradientHeight
    const beforeLandscape = { ...hub.ed!.landscapeBlur }
    const beforeDefaults = defaultsSnapshot(hub.ed!)
    expect(beforeLandscape.blurFade).not.toBe(100)

    const saved = await screen.findByRole("button", { name: "Wide look" })
    const applySpy = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    await u.click(saved)
    expect(applySpy).toHaveBeenCalledWith(APPLE_VISUAL_DEFAULTS, LOGO)
    // Landscape-only gradient took the effective profile…
    expect(hub.ed!.landscapeBlur.blurFade).toBe(100)
    expect(hub.ed!.landscapeBlur.gradientHeight).toBe(50)
    // …while the portrait flats and every global default stayed untouched.
    expect(hub.ed!.gradientHeight).toBe(beforePortraitGradient)
    expect(defaultsSnapshot(hub.ed!)).toEqual(beforeDefaults)
  })

  it("applies quick looks and Fresh through the per-title action (canonical recipes)", async () => {
    const u = userEvent.setup()
    render(<Harness ctxOverrides={{ selectedLogo: LOGO }} />)
    await openChooser(u)
    await resolvePending(0, [])

    const applySpy = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    const globalSpy = vi.spyOn(hub.ed!, "applyVisualPreset")

    // Essential resolves the canonical quick-look recipe (badge patch +
    // transform reset — never live previous values), Fresh its faithful
    // snapshot; both stay per-title (no global apply).
    await u.click(screen.getByRole("button", { name: "Essenziale" }))
    expect(applySpy).toHaveBeenLastCalledWith(quickLookDesired("essential", true), LOGO)
    // The apply re-renders the provider with a new context identity: re-spy
    // the live object so the second click is observed on the current ed.
    const applySpy2 = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    await u.click(screen.getByRole("button", { name: "Fresh" }))
    expect(applySpy2).toHaveBeenLastCalledWith(FRESH_VISUAL_DEFAULTS, LOGO)
    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(applySpy2).toHaveBeenCalledTimes(1)
    expect(globalSpy).not.toHaveBeenCalled()
  })

  it("shows no active-preset highlight (no sticky selection state)", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await openChooser(u)
    await resolvePending(0, [entry("Mine", "33333333-3333-4333-8333-333333333333")])
    await u.click(screen.getByRole("button", { name: "Stile BetterPoster" }))
    for (const name of ["Stile BetterPoster", "Stile Apple", "Essenziale", "Voti", "Completo", "Notch", "Editorial", "Glass", "Cinema", "Mono", "Fresh", "Mine"]) {
      const btn = screen.getByRole("button", { name })
      expect(btn).not.toHaveAttribute("aria-pressed")
      expect(btn.getAttribute("class") ?? "").not.toMatch(/active|selected/)
    }
  })
})

describe("PerTitlePresetChooser stale guards", () => {
  it("drops a stale portrait response after switching to landscape", async () => {
    const u = userEvent.setup()
    render(<Harness shape="portrait" />)
    await openChooser(u)
    expect(pending).toHaveLength(1)

    act(() => { hub.setShape!("landscape") })
    expect(pending).toHaveLength(2)
    expect(pending[1].path).toContain("shape=landscape")

    // The superseded portrait response arrives late: never shown/clickable.
    await resolvePending(0, [entry("Old portrait", "44444444-4444-4444-8444-444444444444")])
    expect(screen.queryByRole("button", { name: "Old portrait" })).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()

    await resolvePending(1, [entry("New landscape", "55555555-5555-4555-8555-555555555555", true)])
    expect(await screen.findByRole("button", { name: "New landscape" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Old portrait" })).not.toBeInTheDocument()

    const applySpy = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    await u.click(screen.getByRole("button", { name: "New landscape" }))
    expect(applySpy).toHaveBeenCalledWith(APPLE_VISUAL_DEFAULTS, null)
  })

  it("clears shown entries immediately on orientation switch, before the reload lands", async () => {
    const u = userEvent.setup()
    render(<Harness shape="portrait" />)
    await openChooser(u)
    await resolvePending(0, [entry("Mine", "66666666-6666-4666-8666-666666666666")])
    expect(await screen.findByRole("button", { name: "Mine" })).toBeInTheDocument()

    // Paint right after the switch (reload still pending): stale entry gone.
    act(() => { hub.setShape!("landscape") })
    expect(screen.queryByRole("button", { name: "Mine" })).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  it("drops a stale response after the user switches", async () => {
    const u = userEvent.setup()
    render(<Harness userId="user-1" />)
    await openChooser(u)
    expect(pending).toHaveLength(1)

    act(() => { hub.setUserId!("user-2") })
    expect(pending).toHaveLength(2)

    await resolvePending(0, [entry("User one", "77777777-7777-4777-8777-777777777777")])
    expect(screen.queryByRole("button", { name: "User one" })).not.toBeInTheDocument()

    await resolvePending(1, [entry("User two", "88888888-8888-4888-8888-888888888888")])
    expect(await screen.findByRole("button", { name: "User two" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "User one" })).not.toBeInTheDocument()
  })
})

describe("PerTitlePresetChooser saved-list states", () => {
  it("keeps built-ins usable on load failure and recovers via retry", async () => {
    const u = userEvent.setup()
    render(<Harness ctxOverrides={{ selectedLogo: LOGO }} />)
    await openChooser(u)
    await rejectPending(0)

    expect(await screen.findByRole("alert")).toBeInTheDocument()
    // Built-ins stay usable while the saved list failed.
    const applySpy = vi.spyOn(hub.ed!, "applyPerTitleVisualPreset")
    await u.click(screen.getByRole("button", { name: "Glass" }))
    expect(applySpy).toHaveBeenCalledTimes(1)

    await u.click(screen.getByRole("button", { name: /Riprova/ }))
    expect(pending).toHaveLength(2)
    await resolvePending(1, [entry("Recovered", "99999999-9999-4999-8999-999999999999")])
    expect(await screen.findByRole("button", { name: "Recovered" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores a stale retry that resolves after close/reopen (same shape+user)", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await openChooser(u)
    await rejectPending(0)
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    // Retry A stays pending; collapse (unmounts the body) then reopen (B).
    await u.click(screen.getByRole("button", { name: /Riprova/ }))
    expect(pending).toHaveLength(2)
    await u.click(toggle())
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    await openChooser(u)
    expect(pending).toHaveLength(3)

    // Fresh reopen resolves first, then the stale retry lands late.
    // (Saved entry name avoids the ready "Fresh" look added in T2.)
    await resolvePending(2, [entry("Reopened", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")])
    expect(await screen.findByRole("button", { name: "Reopened" })).toBeInTheDocument()
    await resolvePending(1, [entry("Stale retry", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")])
    expect(screen.queryByRole("button", { name: "Stale retry" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reopened" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores a stale retry across a user roundtrip back to the same user", async () => {
    const u = userEvent.setup()
    render(<Harness userId="user-1" />)
    await openChooser(u)
    await rejectPending(0)
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    // Retry A (user-1) pending; cycle away and back: B (user-2), C (user-1).
    await u.click(screen.getByRole("button", { name: /Riprova/ }))
    expect(pending).toHaveLength(2)
    act(() => { hub.setUserId!("user-2") })
    act(() => { hub.setUserId!("user-1") })
    expect(pending).toHaveLength(4)

    // The newest same-target load wins; both older same-user responses lose.
    await resolvePending(3, [entry("Current", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")])
    expect(await screen.findByRole("button", { name: "Current" })).toBeInTheDocument()
    await resolvePending(1, [entry("Stale retry", "dddddddd-dddd-4ddd-8ddd-dddddddddddd")])
    await resolvePending(2, [entry("Other user", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")])
    expect(screen.queryByRole("button", { name: "Stale retry" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Other user" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Current" })).toBeInTheDocument()
  })

  it("ignores a stale retry across an orientation roundtrip back to portrait", async () => {
    const u = userEvent.setup()
    render(<Harness shape="portrait" />)
    await openChooser(u)
    await rejectPending(0)
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    // Retry A (portrait) pending; portrait -> landscape (B) -> portrait (C).
    await u.click(screen.getByRole("button", { name: /Riprova/ }))
    expect(pending).toHaveLength(2)
    act(() => { hub.setShape!("landscape") })
    act(() => { hub.setShape!("portrait") })
    expect(pending).toHaveLength(4)
    expect(pending[3].path).toContain("shape=portrait")

    await resolvePending(3, [entry("Current portrait", "ffffffff-ffff-4fff-8fff-ffffffffffff")])
    expect(await screen.findByRole("button", { name: "Current portrait" })).toBeInTheDocument()
    await resolvePending(1, [entry("Stale retry", "11111111-1111-4111-8111-111111111111")])
    await resolvePending(2, [entry("Landscape", "22222222-2222-4222-8222-222222222222", true)])
    expect(screen.queryByRole("button", { name: "Stale retry" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Landscape" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Current portrait" })).toBeInTheDocument()
  })

  it("shows the empty state when no saved presets exist for the orientation", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await openChooser(u)
    await resolvePending(0, [])
    expect(await screen.findByText("ui.perTitlePresetsEmpty")).toBeInTheDocument()
    // Built-ins remain available alongside the empty saved list.
    expect(screen.getByRole("button", { name: "Stile Apple" })).toBeInTheDocument()
  })
})

const MOVIE: SearchResult = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  name: "",
  poster_path: "/fc.jpg",
  release_date: "1999-10-15",
}

const SERIES: SearchResult = {
  id: 1399,
  media_type: "tv",
  title: "Breaking Bad",
  name: "",
  poster_path: "/bb.jpg",
  release_date: "2008-01-20",
}

function chooserToggle() {
  return screen.queryByRole("button", { name: /ui\.perTitlePresetsTitle/ })
}

describe("PerTitlePresetChooser EditView mount", () => {
  it("is present in single-poster customization and absent on home", () => {
    renderWithCtx(<EditView />, {
      selected: MOVIE,
      posters: [{ file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
    })
    expect(chooserToggle()).not.toBeNull()
  })

  it("is absent on home (no title selected)", () => {
    renderWithCtx(<EditView />)
    expect(chooserToggle()).toBeNull()
  })

  it("resets to closed when switching titles", async () => {
    const u = userEvent.setup()
    let switchTo: ((s: SearchResult) => void) | undefined
    function SwitchHarness() {
      const [selected, setSelected] = useState<SearchResult | null>(MOVIE)
      useEffect(() => { switchTo = setSelected }, [])
      const ctx: PictoriumCtx = {
        ...MOCK_CTX,
        selected,
        posters: [{ file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      }
      return (
        <ThemeProvider>
          <PosterEditorProvider>
            <PictoriumProvider value={ctx}>
              <EditView />
            </PictoriumProvider>
          </PosterEditorProvider>
        </ThemeProvider>
      )
    }
    render(<SwitchHarness />)
    expect(chooserToggle()).not.toBeNull()
    // Closed by default on a fresh mount: open, then switch title — the
    // title-keyed remount resets to closed (no auto-open on mount/title).
    expect(chooserToggle()).toHaveAttribute("aria-expanded", "false")
    await u.click(chooserToggle()!)
    expect(chooserToggle()).toHaveAttribute("aria-expanded", "true")

    await act(async () => { switchTo!(SERIES) })
    await waitFor(() => expect(chooserToggle()).toHaveAttribute("aria-expanded", "false"))
  })
})

describe("PerTitlePresetChooser StrictMode", () => {
  it("loads the saved list after the StrictMode setup->cleanup->setup replay", async () => {
    // Regression: mountedRef started true and the mount effect only cleared
    // it on cleanup, so the StrictMode remount replay left it false forever
    // and every saved-preset response was ignored (permanent Loading).
    const u = userEvent.setup()
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
    // Closed by default: nothing fetches until the first explicit open, so
    // the StrictMode setup->cleanup->setup replay runs while closed and the
    // open issues a single guarded load.
    expect(pending).toHaveLength(0)
    await openChooser(u)
    expect(pending).toHaveLength(1)
    await resolvePending(0, [entry("Strict mine", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")])
    expect(await screen.findByRole("button", { name: "Strict mine" })).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})

describe("PerTitlePresetChooser borderless styling", () => {
  it("outer section has no card chrome and the header matches the BadgeGroup pattern", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    const section = screen.getByTestId("per-title-preset-chooser")
    const outer = section.getAttribute("class") ?? ""
    // Borderless: no background/border/rounded/padded card (BadgeGroup has
    // no card; only the body chips keep their own borders).
    expect(outer).not.toContain("bg-surface")
    expect(outer).not.toContain("border")
    expect(outer).not.toContain("rounded-xl")
    expect(outer).not.toContain("p-3.5")
    // Modest bottom separation from the following tab controls/language
    // filters, in the closed state…
    expect(outer.split(/\s+/)).toContain("mb-4")

    // …and the header aligns with BadgeDefaultsSection BadgeGroup
    // (px-1 py-1 min-h-44, bold zinc-100 label, 44px target).
    const header = screen.getByTestId("per-title-preset-toggle")
    const headerCls = header.getAttribute("class") ?? ""
    for (const token of ["px-1", "py-1", "min-h-[44px]"]) expect(headerCls).toContain(token)
    const label = header.querySelector("span")
    expect(label?.getAttribute("class") ?? "").toContain("font-bold")
    expect(label?.getAttribute("class") ?? "").toContain("text-zinc-100")

    // …and the separation persists expanded while body chips keep borders.
    await openChooser(u)
    expect(section.getAttribute("class")?.split(/\s+/) ?? []).toContain("mb-4")
    await resolvePending(0, [])
    const chip = screen.getByRole("button", { name: "Stile BetterPoster" })
    expect(chip.getAttribute("class") ?? "").toContain("border")
  })

  it("keeps the bottom separation in the EditView production layout", () => {
    renderWithCtx(<EditView />, {
      selected: MOVIE,
      posters: [{ file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
    })
    const section = screen.getByTestId("per-title-preset-chooser")
    expect(section.getAttribute("class")?.split(/\s+/) ?? []).toContain("mb-4")
  })
})

describe("PerTitlePresetChooser scope honesty", () => {
  it("shows title-only scope copy and opens global styles without mutating defaults", async () => {
    const u = userEvent.setup()
    const setSettingsOpen = vi.fn()
    render(<Harness ctxOverrides={{ selectedLogo: LOGO, setSettingsOpen }} />)
    await openChooser(u)
    await resolvePending(0, [])
    // Honest scope: this title only, save to apply — never an inheritance claim.
    expect(screen.getByTestId("per-title-scope-note")).toHaveTextContent("ui.perTitleScopeNote")
    const before = defaultsSnapshot(hub.ed!)
    await u.click(screen.getByTestId("per-title-go-global"))
    expect(setSettingsOpen).toHaveBeenCalledWith(true)
    // Existing request mechanism: the legacy badge preset-link destination
    // is deliberately remapped to the new preset tab (compat).
    expect(consumeSettingsTab()).toBe("preset")
    expect(defaultsSnapshot(hub.ed!)).toEqual(before)
  })
})

describe("PerTitlePresetChooser ready localization", () => {
  it("renders the eleven ready looks with the Italian dictionary names (same keys as the global gallery)", async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await openChooser(u)
    await resolvePending(0, [])
    // Same eleven global label keys as the Preset-tab gallery (t(labelKey)),
    // resolved through the real Italian dictionary (read, not assumed).
    for (const name of ["Stile Apple", "Stile BetterPoster", "Essenziale", "Voti", "Completo", "Notch", "Editorial", "Glass", "Cinema", "Mono", "Fresh"]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // No raw English fallback for the three localized quick looks; the
    // Fresh brand name stays identical across dictionaries.
    for (const raw of ["Essential", "Ratings", "Full"]) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument()
    }
    expect(screen.getByRole("button", { name: "Essenziale" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Voti" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Completo" })).toBeInTheDocument()
  })
})
