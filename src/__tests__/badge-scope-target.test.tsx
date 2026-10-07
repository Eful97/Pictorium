/**
 * Badge tab follows the edit target (no new UX grouping yet):
 * portrait reads/writes shared flats, landscape reads `land[key] ?? flat`
 * and writes the landscape profile. Root defaults, delivery shape, global
 * sources/endpoints and the current per-title editor stay untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const opened: string[] = []
beforeEach(() => {
  opened.length = 0
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  class FakeXHR {
    onprogress: ((e: unknown) => void) | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    ontimeout: (() => void) | null = null
    responseType = ""
    timeout = 0
    status = 0
    response: unknown = null
    open(_method: string, url: string) {
      opened.push(String(url))
    }
    send() {}
    abort() {}
    setRequestHeader() {}
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.useFakeTimers()
})

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  openBadgeGroup("overlay")
  return { ctx: () => ctx as PosterEditorCtx }
}

function renderSettings() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
      createElement(Probe),
    ),
  )
  openBadgeGroup("overlay")
  return { ctx: () => ctx as PosterEditorCtx }
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

function badgeSwitch(name: string): HTMLElement {
  return screen.getByRole("switch", { name })
}

// T3 macro-groups: overlay/quality start collapsed (bodies mounted + hidden).
// Open disclosures before touching their controls; assertions unchanged.
function openBadgeGroup(...ids: Array<"style" | "base" | "overlay" | "quality">) {
  for (const id of ids) {
    const t = screen.getByTestId(`badge-group-${id}-toggle`)
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
  }
}

describe("badge target scope", () => {
  it("landscape toggle writes only the profile; flat and preview follow", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    fireEvent.click(badgeSwitch("ui.genreRatingBadge"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(ctx().landscape.globalBadges).toBe(false)
    expect(ctx().defaultGlobalBadges).toBe(true)
    const p = paramsOf(opened[opened.length - 1])
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("badges")).toBe("0")
  })

  it("portrait toggle writes the flat; profile stays empty", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.genreRatingBadge"))
    expect(ctx().defaultGlobalBadges).toBe(false)
    expect(ctx().landscape.globalBadges).toBeUndefined()
  })

  it("back to portrait restores flat values; profile edits survive", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const target = screen.getByTestId("format-target-selector")
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    fireEvent.click(badgeSwitch("ui.networkLogo"))
    expect(ctx().landscape.networkLogo).toBe(false)
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(within(target).getByText("ui.posterShapePortrait"))
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("true")
    expect(ctx().defaultNetworkLogo).toBe(true)
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("false")
    expect(ctx().landscape.networkLogo).toBe(false)
  })

  it("landscape appearance + sepstyle + sash write the profile; preview query follows", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    // Rank look lives in the Classifica card (no duplicated switch in Stili):
    // Badge appearance, then the corner variant.
    const appearance = screen.getByRole("radiogroup", { name: "ui.rankFamily" })
    fireEvent.click(within(appearance).getByRole("radio", { name: "ui.badgeSection" }))
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.corner" }))
    expect(ctx().landscape.rankingBadgeStyle).toBe("corner")
    expect(ctx().defaultRankingBadgeStyle).toBe("default")
    // Separate style pills in landscape (column stays the portrait flat).
    fireEvent.click(badgeSwitch("ui.separateRatings"))
    fireEvent.click(screen.getByText("ui.separateRatingsBottomPills"))
    expect(ctx().landscape.separateRatingsStyle).toBe("bottom-pills")
    expect(ctx().defaultSeparateRatingsStyle).toBe("column")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const p = paramsOf(opened[opened.length - 1])
    expect(p.get("rs")).toBe("corner")
    expect(p.get("sepstyle")).toBe("bottom-pills")
    expect(p.get("sep")).toBe("1")
  })

  it("false/[] persist to storage + PUT; current editor and delivery untouched", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().landscape.rankingBadges).toBe(false)
    expect(ctx().landscape.sashOrder).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.landscape.rankingBadges).toBe(false)
    expect(stored.landscape.sashOrder).toEqual([])
    const puts = (vi.mocked(fetch).mock.calls as unknown[][])
      .filter(([, init]) => (init as RequestInit)?.method === "PUT")
      .map(([, init]) => JSON.parse(String((init as RequestInit)?.body)))
    const last = puts[puts.length - 1]
    expect(last.landscape.rankingBadges).toBe(false)
    expect(last.landscape.sashOrder).toEqual([])
    // Root defaults, current editor state and delivery shape intact.
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder.length).toBeGreaterThan(0)
    expect(ctx().rankingBadges).toBe(true)
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("global sources and endpoint stay global in both targets", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByText("ui.configure"))
    fireEvent.click(screen.getByText("ui.enableAll"))
    expect(ctx().defaultRatingSources.length).toBe(16)
    expect(ctx().landscape).not.toHaveProperty("ratingSources")
    const endpoint = screen.getByPlaceholderText("https://example.com/ratings/{imdbId}") as HTMLInputElement
    fireEvent.change(endpoint, { target: { value: "https://x.test/r/{imdbId}" } })
    expect(ctx().defaultCustomRatingEndpoint).toBe("https://x.test/r/{imdbId}")
    expect(ctx().landscape).not.toHaveProperty("customRatingEndpoint")
  })

  it("scoped reset clears only Badge visual overrides", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ landscape: { topBadgeScale: 130 } }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    fireEvent.click(badgeSwitch("ui.networkLogo"))
    const badgePanel = screen.getByRole("tabpanel", { name: "ui.badgeSection" })
    const reset = within(badgePanel).getByRole("button", { name: "ui.reset · ui.posterShapeLandscape" })
    fireEvent.click(reset)
    expect(ctx().landscape.networkLogo).toBeUndefined()
    expect(ctx().landscape.topBadgeScale).toBe(130)
    expect(ctx().defaultNetworkLogo).toBe(true)
  })

  it("landscape preset writes the profile; root flats and rating sources intact", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultGlobalBadges: false }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    fireEvent.click(screen.getByText("ui.configPresetEssential"))
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(ctx().landscape.badgeStyle).toBe("minimal")
    expect(ctx().defaultGlobalBadges).toBe(false)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
  })

  it("sash stash is per target; portrait keeps the legacy key", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const target = screen.getByTestId("format-target-selector")
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(localStorage.getItem("pictorium_trend_sash_stash:landscape")).not.toBeNull()
    expect(localStorage.getItem("pictorium_trend_sash_stash")).toBeNull()
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().landscape.sashOrder?.length).toBeGreaterThan(0)
    fireEvent.click(within(target).getByText("ui.posterShapePortrait"))
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(localStorage.getItem("pictorium_trend_sash_stash")).not.toBeNull()
  })
})

describe("snapshot presets respect the edit target", () => {
  it("landscape BetterPoster: target visuals applied, preset-absent styles kept, flats intact", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultBadgeStyle: "pill",
      defaultPosterShape: "poster",
      landscape: { rankingBadgeStyle: "corner", extraBadgeStyle: "vetro", globalBadges: false },
    }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    fireEvent.click(screen.getByText("Stile BetterPoster"))
    // Snapshot values land on the target profile (flat ranking style + own landscape profile win).
    expect(ctx().landscape.rankingBadgeStyle).toBe("default")
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(ctx().landscape.badgeStyle).toBe("minimal")
    expect(ctx().landscape.gradientHeight).toBe(50)
    // Styles absent from the preset survive on the profile.
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")
    // Root flats and delivery never follow a landscape preset.
    expect(ctx().defaultBadgeStyle).toBe("pill")
    expect(ctx().defaultPosterShape).toBe("poster")
    // Truly shared globals still apply.
    expect(ctx().defaultRatingSources).toHaveLength(16)
  })

  it("portrait RPDB with landscape delivery keeps land byte-identical", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "landscape",
      defaultBadgeStyle: "shadow",
      landscape: { badgeStyle: "pill", extraBadgeStyle: "vetro", gradientHeight: 45 },
    }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const landBefore = JSON.stringify(ctx().landscape)
    fireEvent.click(screen.getByText("Stile RPDB"))
    expect(ctx().defaultPosterShape).toBe("landscape")
    expect(JSON.stringify(ctx().landscape)).toBe(landBefore)
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")
  })
})
