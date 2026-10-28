/**
 * Extra badge style task: Fresh keeps its fixed appearance (no renderer
 * changes); the standalone extra-style control reports the dedicated `extra`
 * preview family so the defaults preview shows the extra-bucket sample (whose
 * look `xbs` drives) instead of the Fresh/Coming Soon sample. `colored` —
 * renderer-supported via EXTRA_BADGE_STYLES — is always offered in both extra
 * style selectors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement, useState } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { EXTRA_BADGE_STYLES } from "@/lib/badge-styles"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const SELECTED = {
  id: 1,
  media_type: "movie" as const,
  title: "T",
  name: "T",
  poster_path: "/p.jpg",
}

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

class FakeXHR {
  static opened: string[] = []
  onload: (() => void) | null = null
  responseType = ""
  timeout = 0
  status = 0
  response: unknown = null
  open(_method: string, url: string) {
    FakeXHR.opened.push(String(url))
  }
  send() {}
  abort() {}
  setRequestHeader() {}
}

function lastPreviewUrl(): URLSearchParams {
  expect(FakeXHR.opened.length).toBeGreaterThan(0)
  return paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1])
}

let puts: { url: string; body: Record<string, unknown> }[]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }
      if (u.includes("/api/defaults/presets")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
    }),
  )
}

function storageSnapshot(): string {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!
    if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
  }
  return JSON.stringify(out)
}

function probe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  FakeXHR.opened = []
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  resetGuestGuardForTests()
  stubFetch()
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.useFakeTimers()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

function renderPreview(props: {
  previewFamily?: DefaultsPreviewFamily | null
  previewShape?: "portrait" | "landscape"
}) {
  renderWithCtx(createElement(DefaultsPosterPreview, { previewShape: "portrait", ...props }))
}

function openBadgeGroup(...ids: Array<"style" | "base" | "overlay" | "quality">) {
  const adv = screen.getByTestId("badge-advanced-toggle")
  if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
  for (const id of ids) {
    const t = screen.getByTestId(`badge-group-${id}-toggle`)
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
  }
}

/** Style option buttons inside an extra-style card, keyed by i18n label. */
function extraOptionButtons(wrap: HTMLElement): HTMLElement[] {
  return within(wrap).getAllByRole("button")
}

function extraOption(wrap: HTMLElement, labelKey: string): HTMLElement {
  const hit = extraOptionButtons(wrap).find((b) => b.textContent?.includes(labelKey))
  expect(hit, `extra option ${labelKey}`).toBeTruthy()
  return hit!
}

describe("extra preview family prioritizes the extra-bucket sample", () => {
  it("extra family forces __badge.trending + staged xbs (not Coming Soon)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultExtraBadgeStyle: "vetro", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPreview({ previewFamily: "extra", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("extra")).toBe("__badge.trending")
    expect(params.get("xbs")).toBe("vetro")
    // Without-ranking family: rank is dropped (other buckets kept), so the
    // extra sample can never coexist with a rank numeral.
    expect(params.get("sash")).toBe([...DEFAULT_SASH_ORDER].filter((b) => b !== "rank").join(","))
  })

  it("info family still forces the first enabled sample (other demos unchanged)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultExtraBadgeStyle: "vetro", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPreview({ previewFamily: "info", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("extra")).toBe("__badge.comingSoon")
    expect(params.get("xbs")).toBe("vetro")
  })

  it("extra family with the extra bucket disabled falls back to the first enabled non-rank sample", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultExtraBadgeStyle: "pill",
        defaultSashOrder: ["upcoming", "new", "award"],
      }),
    )
    renderPreview({ previewFamily: "extra", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    // Forced `extra=` samples always render as extra-type top badges, so the
    // staged xbs stays visible without enabling a switched-off category.
    expect(params.get("extra")).toBe("__badge.comingSoon")
    expect(params.get("xbs")).toBe("pill")
  })

  it("extra family with no enabled info bucket emits no sample (no phantom)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["rank"] }))
    renderPreview({ previewFamily: "extra", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(lastPreviewUrl().get("extra")).toBeNull()
  })

  it("extra family with the master off emits no sample (no phantom)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultRankingBadges: false, defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPreview({ previewFamily: "extra", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("extra")).toBeNull()
    expect(params.get("ranking")).toBe("0")
  })

  it("extra family respects the effective per-shape sash (cross-shape gate)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultExtraBadgeStyle: "bordo",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        landscape: { sashOrder: ["award"] },
      }),
    )
    renderPreview({ previewFamily: "extra", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(lastPreviewUrl().get("extra")).toBe("__badge.trending")
    renderPreview({ previewFamily: "extra", previewShape: "landscape" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // Landscape profile drops `extra`: first enabled non-rank bucket wins.
    const land = lastPreviewUrl()
    expect(land.get("extra")).toBe("__badge.absoluteCinema")
    expect(land.get("xbs")).toBe("bordo")
  })
})

describe("extra style card reports the extra family (pointer + keyboard)", () => {
  function renderSection(spy?: (f: DefaultsPreviewFamily) => void) {
    const p = probe()
    function Harness() {
      const [family, setFamily] = useState<DefaultsPreviewFamily>("auto")
      return createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, {
          active: true,
          shape: "portrait",
          onPreviewFamilyChange: (f: DefaultsPreviewFamily) => {
            spy?.(f)
            setFamily((prev) => (prev === f ? prev : f))
          },
        }),
        createElement("div", { "data-testid": "family" }, family),
        createElement(p.Probe),
      )
    }
    const ui = renderWithCtx(createElement(Harness))
    openBadgeGroup("style")
    return { ui, ctx: p.ctx }
  }

  it("keyboard focus on the extra control reports extra without writes", async () => {
    const spy = vi.fn()
    renderSection(spy)
    await act(async () => {})
    const storedBefore = localStorage.getItem("badgeDefaults")
    const wrap = screen.getByTestId("badge-extra-style-wrap")
    const btn = extraOption(wrap, "ui.vetro")
    btn.focus()
    fireEvent.focus(btn)
    expect(spy).toHaveBeenCalledWith("extra")
    expect(screen.getByTestId("family").textContent).toBe("extra")
    expect(document.activeElement).toBe(btn)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("pointer press on the extra control reports extra", async () => {
    const spy = vi.fn()
    renderSection(spy)
    await act(async () => {})
    const wrap = screen.getByTestId("badge-extra-style-wrap")
    fireEvent.pointerDown(extraOption(wrap, "ui.pill"))
    expect(spy).toHaveBeenCalledWith("extra")
    expect(screen.getByTestId("family").textContent).toBe("extra")
  })

  it("repeated style changes stage new xbs values while the family persists", async () => {
    const spy = vi.fn()
    const { ctx } = renderSection(spy)
    await act(async () => {})
    const wrap = screen.getByTestId("badge-extra-style-wrap")
    fireEvent.pointerDown(extraOption(wrap, "ui.vetro"))
    fireEvent.click(extraOption(wrap, "ui.vetro"))
    expect(ctx().defaultExtraBadgeStyle).toBe("vetro")
    // Second change needs no extra family click: the family report persists.
    fireEvent.click(extraOption(wrap, "ui.pill"))
    expect(ctx().defaultExtraBadgeStyle).toBe("pill")
    expect(spy.mock.calls.flat().every((f) => f === "extra")).toBe(true)
    expect(screen.getByTestId("family").textContent).toBe("extra")
  })
})

describe("colored is always offered in both extra style selectors", () => {
  it("defaults extra selector offers the full renderer-supported subset", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const p = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape: "portrait" }), createElement(p.Probe)),
    )
    openBadgeGroup("style")
    await act(async () => {})
    const wrap = screen.getByTestId("badge-extra-style-wrap")
    const labels = extraOptionButtons(wrap).map((b) => b.textContent ?? "")
    expect(labels.some((t) => t.includes("ui.colored"))).toBe(true)
    expect(extraOptionButtons(wrap)).toHaveLength(6)
    // Every offered option is a canonical renderer-supported style.
    for (const b of extraOptionButtons(wrap)) {
      const key = (b.textContent ?? "").replace(/^Aa/, "")
      const style = (
        {
          "ui.bsDefault": "default",
          "ui.pill": "pill",
          "ui.corner": "corner",
          "ui.vetro": "vetro",
          "ui.bordo": "bordo",
          "ui.colored": "colored",
        } as Record<string, string>
      )[key]
      expect(style, key).toBeTruthy()
      expect((EXTRA_BADGE_STYLES as readonly string[]).includes(style)).toBe(true)
    }
  })

  it("defaults appearance tab (five-tab) also offers colored", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    renderWithCtx(createElement(BadgeDefaultsSection, { active: true, shape: "portrait", mode: "appearance" }))
    await act(async () => {})
    const wrap = screen.getByTestId("badge-extra-style")
    expect(extraOption(wrap, "ui.colored")).toBeInTheDocument()
  })

  it("per-title extra selector offers colored with canonical behavior", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    const p = probe()
    renderWithCtx(createElement("div", null, createElement(BadgeControls), createElement(p.Probe)), {
      selected: SELECTED as never,
    })
    await act(async () => {})
    const labels = screen
      .getByText("ui.extraBadgeStyle")
      .closest("div")!
      .querySelectorAll("button")
    const texts = Array.from(labels).map((b) => b.textContent ?? "")
    expect(texts.some((t) => t.includes("ui.colored"))).toBe(true)
    // Selecting it stores the canonical renderer-supported value.
    const colored = Array.from(labels).find((b) => (b.textContent ?? "").includes("ui.colored")) as HTMLElement
    fireEvent.click(colored)
    expect(p.ctx().extraBadgeStyle).toBe("colored")
  })
})

describe("SettingsPanel: Fresh stays staged while the extra sample previews xbs", () => {
  function renderPanel() {
    const p = probe()
    const rendered = renderWithCtx(
      createElement("div", null,
        createElement(SettingsPanel, {
          setSettingsOpen: () => {},
          exportData: () => {},
          importData: () => {},
        }),
        createElement(p.Probe),
      ),
    )
    return { ...rendered, ctx: p.ctx }
  }

  function visibleExtraWrap(): HTMLElement {
    const wraps = screen.getAllByTestId("badge-extra-style-wrap")
    const hit = wraps.find((w) => !w.hasAttribute("hidden"))
    expect(hit, "visible extra style card").toBeTruthy()
    return hit!
  }

  it("Fresh + extra focus/click previews trending + chosen xbs with layout=fresh, no save yet", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "fresh", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPanel()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const storedAfterMount = storageSnapshot()
    const putsAfterMount = puts.length
    // Appearance tab owns the standalone extra style card.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    const wrap = visibleExtraWrap()
    const vetro = extraOption(wrap, "ui.vetro")
    fireEvent.pointerDown(vetro)
    fireEvent.focus(vetro)
    fireEvent.click(vetro)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const params = lastPreviewUrl()
    // Extra-originated family: the extra-bucket sample (not Coming Soon), the
    // staged xbs, and the still-Fresh staged layout travel together. The
    // without-ranking request drops `rank` (kept: every other enabled bucket).
    expect(params.get("extra")).toBe("__badge.trending")
    expect(params.get("xbs")).toBe("vetro")
    expect(params.get("layout")).toBe("fresh")
    expect(params.get("sash")).toBe([...DEFAULT_SASH_ORDER].filter((b) => b !== "rank").join(","))
    const chip = screen.getByTestId("defaults-preview-editing")
    expect(chip.textContent).toContain("ui.titleInfoFamily")
    // Staged session: no PUT and no storage write before the single Save.
    expect(puts.length).toBe(putsAfterMount)
    expect(storageSnapshot()).toBe(storedAfterMount)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    // Repeated change needs no extra click: new xbs, same extra sample.
    const pill = extraOption(visibleExtraWrap(), "ui.pill")
    fireEvent.click(pill)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const again = lastPreviewUrl()
    expect(again.get("xbs")).toBe("pill")
    expect(again.get("extra")).toBe("__badge.trending")
    expect(again.get("layout")).toBe("fresh")
    expect(puts.length).toBe(putsAfterMount)
    expect(storageSnapshot()).toBe(storedAfterMount)
  })

  it("landscape target previews the same extra sample with shape=landscape", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "fresh", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPanel()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    const wrap = visibleExtraWrap()
    const bordo = extraOption(wrap, "ui.bordo")
    fireEvent.pointerDown(bordo)
    fireEvent.click(bordo)
    // Switch the preview/edit target to landscape (free navigation, no save).
    fireEvent.click(
      within(screen.getByTestId("format-target-selector")).getByRole("button", {
        name: "ui.posterShapeLandscape",
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const params = lastPreviewUrl()
    expect(params.get("shape")).toBe("landscape")
    expect(params.get("extra")).toBe("__badge.trending")
    // Cross-shape isolation: the portrait edit froze the landscape profile to
    // its pre-edit effective (`follow-rank` sentinel for a legacy null flat),
    // so the landscape preview renders the extra sample with the landscape
    // own-rank look — the staged portrait `bordo` never leaks across shapes.
    expect(params.get("xbs")).toBe("follow-rank")
    expect(params.get("layout")).toBe("fresh")
    expect(puts.length).toBe(0)
  })
})
