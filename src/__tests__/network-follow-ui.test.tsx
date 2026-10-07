/**
 * Network follow UI/state: per-title and global checkbox, freeze with guards,
 * ON-restore, save/preset roundtrip. No mocked geometry in renders: the
 * freeze goes through the real debug fetch (transport mock) and pure resolvers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx, createWrapper } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { useNetworkFreeze } from "@/lib/useNetworkFreeze"
import { useNetworkGeometry } from "@/lib/useNetworkGeometry"
import { buildNetGeoUrl } from "@/lib/network-freeze"
import { usePosterSave } from "@/lib/usePosterSave"
import { saveDefaults } from "@/lib/save-defaults"
import { captureVisualPreset, visualPresetValuesSchema } from "@/lib/visual-presets"
import type { Mapping } from "@/lib/types"
import type { PictoriumCtx } from "@/lib/context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function renderWithProbe(ui: ReactNode, overrides?: Partial<PictoriumCtx>) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    createElement("div", null, ui, createElement(Probe)),
    overrides,
  )
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function followSwitch(): HTMLElement {
  const candidates = screen.queryAllByRole("switch")
  const found = candidates.find((el) => /followTitleLogo|Segui il logo|Follow the title/i.test(el.getAttribute("aria-label") ?? ""))
  expect(found).toBeDefined()
  return found as HTMLElement
}

// OFF stays disabled until the shared geometry prefetch proves the network
// box is rendered, so tests wait for the gate instead of the first paint.
async function waitForSwitchEnabled(): Promise<void> {
  await waitFor(() => expect(followSwitch().hasAttribute("disabled")).toBe(false))
}

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const TITLE = { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" }
const PREVIEW_URL = "http://localhost:3000/api/poster/movie/1?rv=9&scale=60"
const NET_GEO = { top: 34, left: 24, w: 90, h: 30, nominalW: 120, nominalH: 40, followTitle: true }

function stubFetchGeo() {
  return vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes("netgeo=1")) {
      return { ok: true, status: 200, json: async () => ({ network: { ...NET_GEO } }) }
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", stubFetchGeo())
})

describe("TransformControls follow checkbox (per-title)", () => {
  it("default ON, enabled once title+preview+geometry are ready", async () => {
    seedDefaults({})
    renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await waitForSwitchEnabled()
    const sw = followSwitch()
    expect(sw.getAttribute("aria-checked")).toBe("true")
  })

  it("disabled without title/preview, keeps value", async () => {
    seedDefaults({})
    renderWithProbe(createElement(TransformControls))
    await act(async () => {})
    const sw = followSwitch()
    expect(sw.hasAttribute("disabled")).toBe(true)
    expect(sw.getAttribute("aria-checked")).toBe("true")
  })

  it("without network logo the network card (and its switch) is hidden", async () => {
    seedDefaults({ networkLogo: false })
    renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await act(async () => {})
    const candidates = screen.queryAllByRole("switch")
    const found = candidates.find((el) => /followTitleLogo|Segui il logo|Follow the title/i.test(el.getAttribute("aria-label") ?? ""))
    expect(found).toBeUndefined()
  })

  it("stays disabled when the network is not rendered (null geometry)", async () => {
    seedDefaults({})
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ network: null }) })))
    renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    const sw = followSwitch()
    expect(sw.getAttribute("aria-checked")).toBe("true")
    expect(sw.hasAttribute("disabled")).toBe(true)
  })

  it("OFF fetches the exact preview URL + netgeo and applies actuals", async () => {
    seedDefaults({})
    const fetchMock = stubFetchGeo()
    vi.stubGlobal("fetch", fetchMock)
    const { ctx } = renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await waitForSwitchEnabled()
    expect(ctx().networkLogoFollowTitle).toBe(true)
    await act(async () => {
      fireEvent.click(followSwitch())
    })
    const geoCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("netgeo=1"))
    // Gate prefetch on mount + fresh safety fetch on click, both on the exact
    // preview URL (never a recomputed/duplicated URL).
    expect(geoCalls.length).toBeGreaterThanOrEqual(1)
    for (const u of geoCalls) expect(u).toBe(`${PREVIEW_URL}&debug=1&netgeo=1`)
    // Actual top/left + effective post-shrink scale (100 * 90/120 = 75).
    expect(ctx().networkLogoFollowTitle).toBe(false)
    expect(ctx().networkLogoOffsetX).toBe(24)
    expect(ctx().networkLogoOffsetY).toBe(34)
    expect(ctx().networkLogoScale).toBe(75)
  })

  it("reload OFF->ON restores 0,0, never stored fixed absolutes", async () => {
    // Stored fixed box (absolute top-left) from a previous session: no stash
    // survives reload, so ON must fall back to neutral 0,0, not 200/500.
    seedDefaults({
      networkLogoFollowTitle: false,
      networkLogoOffsetX: 200,
      networkLogoOffsetY: 500,
    })
    const { ctx } = renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await act(async () => {})
    expect(ctx().networkLogoFollowTitle).toBe(false)
    // Way back ON is always allowed (no geometry needed to re-follow).
    expect(followSwitch().hasAttribute("disabled")).toBe(false)
    await act(async () => {
      fireEvent.click(followSwitch())
    })
    expect(ctx().networkLogoFollowTitle).toBe(true)
    expect(ctx().networkLogoOffsetX).toBe(0)
    expect(ctx().networkLogoOffsetY).toBe(0)
  })

  it("reset restores the shape default with coherent follow", async () => {
    seedDefaults({
      defaultNetworkLogoFollowTitle: true,
      networkLogoFollowTitle: false,
      networkLogoOffsetX: 111,
    })
    const { ctx } = renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await act(async () => {})
    expect(ctx().networkLogoFollowTitle).toBe(false)
    const card = followSwitch().closest("div.rounded-xl") as HTMLElement
    const reset = within(card).getByLabelText("ui.reset")
    await act(async () => {
      fireEvent.click(reset)
    })
    // Shape default restored with coherent follow (ON + relative offsets).
    expect(ctx().networkLogoFollowTitle).toBe(true)
    expect(ctx().networkLogoOffsetX).toBe(111)
    expect(ctx().networkLogoOffsetY).toBe(0)
  })

  it("landscape title reset on portrait-fixed globals stays coherent (ON + 0,0)", async () => {
    seedDefaults({
      posterShape: "landscape",
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
    })
    const { ctx } = renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
    await act(async () => {})
    const card = followSwitch().closest("div.rounded-xl") as HTMLElement
    await act(async () => {
      fireEvent.click(within(card).getByLabelText("ui.reset"))
    })
    // Effective landscape view: ON with relative offsets, never the flat
    // absolutes reinterpreted as fixed.
    expect(ctx().networkLogoFollowTitle).toBe(true)
    expect(ctx().networkLogoOffsetX).toBe(0)
    expect(ctx().networkLogoOffsetY).toBe(0)
  })
})

describe("useNetworkFreeze hook", () => {
  it("applies actuals + effective scale, ignores stale responses", async () => {
    const live = { titleKey: "movie:1", shape: "poster", previewUrl: PREVIEW_URL }
    let resolveFetch!: (v: unknown) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolveFetch = r })))
    const { result } = renderHook(() => useNetworkFreeze())
    const applied: unknown[] = []
    const p = result.current.freezeOff({
      titleKey: "movie:1",
      shape: "poster",
      previewUrl: PREVIEW_URL,
      networkLogo: true,
      currentScale: 100,
      currentOffsetX: 0,
      currentOffsetY: 0,
      applyFixed: (v) => { applied.push(v) },
      getLive: () => ({ ...live }),
    })
    // Mid-flight title change: the response must be discarded.
    live.titleKey = "movie:2"
    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ network: { ...NET_GEO } }) })
    })
    expect(await p).toBe(false)
    expect(applied).toHaveLength(0)
  })

  it("network null keeps ON, turnOn restores stash else neutral", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ network: null }) })))
    const { result } = renderHook(() => useNetworkFreeze())
    const applied: unknown[] = []
    const ok = await act(async () => result.current.freezeOff({
      titleKey: "movie:1",
      shape: "poster",
      previewUrl: PREVIEW_URL,
      networkLogo: true,
      currentScale: 100,
      currentOffsetX: 7,
      currentOffsetY: 8,
      applyFixed: (v) => { applied.push(v) },
      getLive: () => ({ titleKey: "movie:1", shape: "poster", previewUrl: PREVIEW_URL }),
    }))
    expect(ok).toBe(false)
    expect(applied).toHaveLength(0)
    // Stash is still written at start: ON restores the priors.
    const restored: unknown[] = []
    act(() => {
      result.current.turnOn({
        titleKey: "movie:1", shape: "poster", neutralX: 0, neutralY: 0,
        applyOn: (v) => { restored.push(v) },
      })
    })
    expect(restored).toEqual([{ follow: true, offsetX: 7, offsetY: 8 }])
    // Miss (other title): neutrals.
    const neutral: unknown[] = []
    act(() => {
      result.current.turnOn({
        titleKey: "movie:9", shape: "poster", neutralX: 1, neutralY: 2,
        applyOn: (v) => { neutral.push(v) },
      })
    })
    expect(neutral).toEqual([{ follow: true, offsetX: 1, offsetY: 2 }])
  })

  it("unmount mid-flight never applies and never toasts", async () => {
    let resolveFetch!: (v: unknown) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolveFetch = r })))
    const { result, unmount } = renderHook(() => useNetworkFreeze())
    const applied: unknown[] = []
    const p = result.current.freezeOff({
      titleKey: "movie:1",
      shape: "poster",
      previewUrl: PREVIEW_URL,
      networkLogo: true,
      currentScale: 100,
      currentOffsetX: 0,
      currentOffsetY: 0,
      applyFixed: (v) => { applied.push(v) },
      getLive: () => ({ titleKey: "movie:1", shape: "poster", previewUrl: PREVIEW_URL }),
    })
    unmount()
    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ network: { ...NET_GEO } }) })
    })
    expect(await p).toBe(false)
    expect(applied).toHaveLength(0)
  })
})

describe("useNetworkGeometry shared prefetch", () => {
  it("stays idle while disabled, fetches the exact URL once enabled", async () => {
    const fetchMock = stubFetchGeo()
    vi.stubGlobal("fetch", fetchMock)
    const { result, rerender } = renderHook(
      ({ url, enabled }: { url: string; enabled: boolean }) => useNetworkGeometry(url, enabled),
      { initialProps: { url: PREVIEW_URL, enabled: false } },
    )
    expect(result.current.geometry).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ url: PREVIEW_URL, enabled: true })
    await waitFor(() => expect(result.current.geometry).not.toBeNull())
    expect(result.current.geometry).toMatchObject({ top: 34, left: 24, w: 90, h: 30 })
    const geoCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("netgeo=1"))
    expect(geoCalls).toEqual([`${PREVIEW_URL}&debug=1&netgeo=1`])
  })

  it("null geometry means network not rendered (OFF stays disabled)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ network: null }) })))
    const { result } = renderHook(() => useNetworkGeometry(PREVIEW_URL, true))
    await waitFor(() => expect(result.current.geometryLoading).toBe(false))
    expect(result.current.geometry).toBeNull()
  })

  it("drops stale geometry immediately on URL change", async () => {
    const fetchMock = stubFetchGeo()
    vi.stubGlobal("fetch", fetchMock)
    const URL_B = `${PREVIEW_URL}&scale=61`
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useNetworkGeometry(url, true),
      { initialProps: { url: PREVIEW_URL } },
    )
    await waitFor(() => expect(result.current.geometry).not.toBeNull())
    expect(result.current.geometryUrl).toBe(PREVIEW_URL)
    rerender({ url: URL_B })
    // Same tick: the old box must not read as current (switch disables now,
    // not after the debounced fetch lands).
    expect(result.current.geometry).toBeNull()
    expect(result.current.geometryLoading).toBe(true)
    await waitFor(() => expect(result.current.geometry).not.toBeNull())
    expect(result.current.geometryUrl).toBe(URL_B)
  })

  it("ignores a late superseded response; null geometry wins", async () => {
    const pending = new Map<string, (v: unknown) => void>()
    vi.stubGlobal("fetch", vi.fn((url: unknown) => {
      const u = String(url)
      return new Promise((resolve) => {
        pending.set(u, resolve as (v: unknown) => void)
      })
    }))
    const URL_B = `${PREVIEW_URL}&scale=61`
    const keyA = buildNetGeoUrl(PREVIEW_URL)
    const keyB = buildNetGeoUrl(URL_B)
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useNetworkGeometry(url, true),
      { initialProps: { url: PREVIEW_URL } },
    )
    await waitFor(() => expect(pending.has(keyA)).toBe(true))
    rerender({ url: URL_B })
    await waitFor(() => expect(pending.has(keyB)).toBe(true))
    // Late A response (with geometry) after B started: discarded.
    await act(async () => {
      pending.get(keyA)!({ ok: true, status: 200, json: async () => ({ network: { ...NET_GEO } }) })
    })
    expect(result.current.geometry).toBeNull()
    // B resolves null (network not rendered): wins, gate stays disabled.
    await act(async () => {
      pending.get(keyB)!({ ok: true, status: 200, json: async () => ({ network: null }) })
    })
    await waitFor(() => expect(result.current.geometryLoading).toBe(false))
    expect(result.current.geometry).toBeNull()
    expect(result.current.geometryUrl).toBe(URL_B)
  })

  it("unmount mid-fetch never writes state", async () => {
    let resolveFetch!: (v: unknown) => void
    const fetchMock = vi.fn(() => new Promise((r) => { resolveFetch = r }))
    vi.stubGlobal("fetch", fetchMock)
    const { unmount } = renderHook(() => useNetworkGeometry(PREVIEW_URL, true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => {
      resolveFetch({ ok: true, status: 200, json: async () => ({ network: { ...NET_GEO } }) })
    })
  })
})

describe("TransformPanel global follow (Trasforma tab)", () => {
  it("default ON, global freeze writes flat defaults", async () => {
    seedDefaults({})
    const fetchMock = stubFetchGeo()
    vi.stubGlobal("fetch", fetchMock)
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "portrait" }),
    )
    await waitForSwitchEnabled()
    const sw = followSwitch()
    expect(sw.getAttribute("aria-checked")).toBe("true")
    await act(async () => {
      fireEvent.click(sw)
    })
    const geoCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("netgeo=1"))
    expect(geoCalls.length).toBeGreaterThanOrEqual(1)
    // Same URL as the displayed defaults preview (same builder/sample): only netgeo added.
    expect(geoCalls[0]).toContain("debug=1&netgeo=1")
    expect(geoCalls[0]).toContain("/api/poster/")
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(false)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(24)
    expect(ctx().defaultNetworkLogoOffsetY).toBe(34)
  })

  it("reload OFF->ON restores 0,0, never stored fixed absolutes", async () => {
    seedDefaults({
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
    })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "portrait" }),
    )
    await act(async () => {})
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(false)
    expect(followSwitch().hasAttribute("disabled")).toBe(false)
    await act(async () => {
      fireEvent.click(followSwitch())
    })
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(true)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(0)
    expect(ctx().defaultNetworkLogoOffsetY).toBe(0)
  })

  it("reset restores follow ON with 0,0", async () => {
    seedDefaults({
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
    })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "portrait" }),
    )
    await act(async () => {})
    const card = followSwitch().closest("div.rounded-xl") as HTMLElement
    const reset = within(card).getByLabelText("ui.reset")
    await act(async () => {
      fireEvent.click(reset)
    })
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(true)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(0)
    expect(ctx().defaultNetworkLogoOffsetY).toBe(0)
  })

  it("landscape writes the profile, flat untouched", async () => {
    seedDefaults({})
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "landscape" }),
    )
    await waitForSwitchEnabled()
    await act(async () => {
      fireEvent.click(followSwitch())
    })
    expect(ctx().landscape.networkLogoFollowTitle).toBe(false)
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(true)
  })

  it("landscape reload OFF->ON restores 0,0 in the profile", async () => {
    // Stored fixed landscape layer (absolute box coords): no stash survives
    // reload, so ON must fall back to neutral 0,0, not 200/500.
    seedDefaults({
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 },
    })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "landscape" }),
    )
    await act(async () => {})
    expect(ctx().landscape.networkLogoFollowTitle).toBe(false)
    expect(followSwitch().hasAttribute("disabled")).toBe(false)
    await act(async () => {
      fireEvent.click(followSwitch())
    })
    expect(ctx().landscape.networkLogoFollowTitle).toBe(true)
    expect(ctx().landscape.networkLogoOffsetX).toBe(0)
    expect(ctx().landscape.networkLogoOffsetY).toBe(0)
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(true)
  })

  it("portrait-fixed defaults without landscape profile read ON with relative 0,0", async () => {
    // Same server semantics as the render: the flat OFF never leaks its
    // absolutes into the landscape bindings.
    seedDefaults({
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
    })
    const fetchMock = stubFetchGeo()
    vi.stubGlobal("fetch", fetchMock)
    renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "landscape" }),
    )
    await waitForSwitchEnabled()
    expect(followSwitch().getAttribute("aria-checked")).toBe("true")
    const group = followSwitch().closest('[data-preview-family="logo"]') as HTMLElement
    expect(within(group).getByLabelText("X: 0px")).toBeDefined()
    expect(within(group).getByLabelText("Y: 0px")).toBeDefined()
    // Render side: explicit ON with neutral offsets, never +200/+500.
    const geoCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("netgeo=1"))
    expect(geoCalls.length).toBeGreaterThanOrEqual(1)
    const shown = new URL(geoCalls[0])
    expect(shown.searchParams.get("netFollow")).toBe("1")
    expect(shown.searchParams.get("nox")).toBe("0")
    expect(shown.searchParams.get("noy")).toBe("0")
  })

  it("landscape group reset clears the fixed profile back to effective ON", async () => {
    seedDefaults({
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300 },
    })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "landscape" }),
    )
    await act(async () => {})
    // Complete fixed profile: genuinely OFF with its absolutes.
    expect(followSwitch().getAttribute("aria-checked")).toBe("false")
    const group = followSwitch().closest('[data-preview-family="logo"]') as HTMLElement
    expect(within(group).getByLabelText("X: 120px")).toBeDefined()
    await act(async () => {
      fireEvent.click(within(group).getByLabelText("ui.reset"))
    })
    expect(ctx().landscape.networkLogoFollowTitle).toBeUndefined()
    expect(followSwitch().getAttribute("aria-checked")).toBe("true")
    expect(within(group).getByLabelText("X: 0px")).toBeDefined()
    expect(within(group).getByLabelText("Y: 0px")).toBeDefined()
  })

  it("PUT body carries follow after saveDefaults", async () => {
    seedDefaults({ defaultNetworkLogoFollowTitle: false })
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await act(async () => {})
    expect(box.ed?.defaultNetworkLogoFollowTitle).toBe(false)
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.networkLogoFollowTitle).toBe(false)
  })

  it("preset capture keeps follow, legacy presets parse", async () => {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await act(async () => {})
    await act(async () => {
      box.ed!.setDefaultNetworkLogoFollowTitle(false)
    })
    const captured = captureVisualPreset(box.ed!)
    expect(captured.defaultNetworkLogoFollowTitle).toBe(false)
    const legacy = { ...captured } as Record<string, unknown>
    delete legacy.defaultNetworkLogoFollowTitle
    expect(visualPresetValuesSchema.safeParse(legacy).success).toBe(true)
  })
})

const noop = () => {}

function baseSaveDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
    posters: [],
    metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
    trendRank: null,
    mdblistAnimeList: [],
    mappingsMap: new Map<string, Mapping>(),
    loadMappings: async () => {},
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: true,
    rankingBadges: false,
    badgeGenre: true,
    badgeYear: false,
    badgeRating: true,
    badgeQuality: false,
    customRatings: true,
    ratingSources: ["imdb", "tmdb"],
    separateRatings: true,
    customBadge: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeFont: "inter",
    qualityBadgeStyle: "standard",
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    landscapeBlur: {
      gradientHeight: 30, blurIntensity: 20, blurFade: 70,
      blurDarkness: 30, tintStrength: 20, topShade: 50, blurEnabled: true,
    },
    landscapeBlurDirty: false,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 150,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    rotationPosters: [],
    autoRotateClean: false,
    defaultAutoRotateClean: false,
    excludedPosters: [],
    accentColor: null,
    logoDisabled: false,
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: true,
    networkLogoPosition: "auto",
    networkLogoFollowTitle: true,
    ribbonEnabled: true,
    lang: "it",
    posterShape: "poster",
    ...overrides,
  } as never
}

describe("usePosterSave network follow", () => {
  it("portrait saves flat follow, landscape writes profile + preserves flat", async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    const { result } = renderHook(() => usePosterSave(baseSaveDeps({
      networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300,
    })))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.networkLogoFollowTitle).toBe(false)
    expect(mappings[0].body.networkLogoOffsetX).toBe(120)

    posted.length = 0
    const { result: landResult } = renderHook(() => usePosterSave(baseSaveDeps({
      posterShape: "landscape",
      networkLogoFollowTitle: false, networkLogoOffsetX: 300, networkLogoOffsetY: 100,
    })))
    await act(async () => {
      await landResult.current.saveConfig({ silent: true })
    })
    const landPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    const profile = landPost.body.landscape as Record<string, unknown>
    expect(profile.networkLogoFollowTitle).toBe(false)
    expect(profile.networkLogoOffsetX).toBe(300)
  })
})
