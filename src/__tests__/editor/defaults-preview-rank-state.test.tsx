/**
 * Settings preview: the explicit TWO-state switch (with ranking / without
 * ranking).
 *
 * Reuses the existing preview-only family mechanism and the single render
 * endpoint: no saved defaults, no second renderer, no new URL parameter.
 * - with ranking: `rank` family → `sash=rank` when the CONFIGURED preview can
 *   paint a rank (master ON + bucket in the effective sash); the configured
 *   layout (Fresh/Card included) is untouched. The drawn badge value is the
 *   real source rank or — when the previewed title has none — the existing
 *   disclosed Settings demo sample: this switch never promises a live chart.
 * - without ranking: `info`/`extra` families drop `rank` from the effective
 *   sash (every other enabled bucket stays) plus the existing info-family
 *   sample, i.e. the actual fallback composition (extra badge, genre/rating).
 *   When rank is not configured the `rank` family itself falls back to the
 *   same real composition (never an empty third state).
 * - Families that keep the full configured priority (`auto`, `logo`,
 *   `gradient`, `genre`, ratings, quality) can paint a numeral or not depending
 *   on live source data, so the control presses neither state there: no false
 *   claim in either direction.
 * - Floating mobile preview has no chrome: the same control lives in the
 *   enlarged editor toolbar, which is the only editing surface there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import {
  buildDefaultsPreviewUrl,
  isDefaultsPreviewRankConfigured,
  type DefaultsPreviewFamily,
} from "@/lib/poster-url"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

/** XHR the test can complete, so the enlarged editor (which needs imgSrc) opens.
 *  Also records every requested URL: the pressed-state and the displayed image
 *  are asserted against the same request. */
class LoadableXHR {
  static instances: LoadableXHR[] = []
  static opened: string[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: ProgressEvent) => void) | null = null
  responseType = ""
  timeout = 0
  status = 200
  response: unknown = new Blob()
  constructor() {
    LoadableXHR.instances.push(this)
  }
  open(_method: string, url: string) {
    LoadableXHR.opened.push(String(url))
  }
  send() {}
  abort() {}
  setRequestHeader() {}
  finish() {
    this.onload?.()
  }
}

const GEOMETRY_PAYLOAD = {
  badges: {
    canvasW: 500,
    canvasH: 750,
    kind: "rank",
    layout: "ranked",
    families: { rank: { top: 20, left: 190, w: 120, h: 40 } },
    fixedX: {},
    items: [],
  },
}

beforeEach(() => {
  localStorage.clear()
  LoadableXHR.instances = []
  LoadableXHR.opened = []
  vi.stubGlobal("XMLHttpRequest", LoadableXHR as unknown as typeof XMLHttpRequest)
  // Keep the URL constructor (paramsOf) while stubbing the blob helpers.
  const RealURL = URL
  class StubURL extends RealURL {
    static createObjectURL = () => "blob:pictorium-preview"
    static revokeObjectURL = () => {}
  }
  vi.stubGlobal("URL", StubURL)
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => GEOMETRY_PAYLOAD })))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPreview(props: {
  previewFamily?: DefaultsPreviewFamily
  previewShape?: "portrait" | "landscape"
  floating?: boolean
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
}) {
  const { onPreviewFamilyChange, ...rest } = props
  return renderWithCtx(
    createElement(DefaultsPosterPreview, {
      previewShape: "portrait",
      ...rest,
      ...(onPreviewFamilyChange ? { onPreviewFamilyChange } : null),
    }),
  )
}

async function loadPreviewImage() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  const xhr = LoadableXHR.instances[LoadableXHR.instances.length - 1]
  await act(async () => {
    xhr.finish()
  })
  vi.useRealTimers()
}

function pressed(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("aria-pressed")
}

/** Last preview request the component actually issued. */
async function settlePendingUrl() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  return paramsOf(LoadableXHR.opened[LoadableXHR.opened.length - 1])
}

describe("two-state preview URL contract (same endpoint, no new renderer)", () => {
  it("with ranking narrows to the rank bucket and keeps the configured layout", () => {
    const params = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        defaultRankingBadges: true,
        defaultPosterLayout: "fresh",
        defaultPosterFreshScope: "ranked",
        previewFamily: "rank",
      }),
    )
    expect(params.get("sash")).toBe("rank")
    expect(params.get("ranking")).toBe("1")
    expect(params.get("extra")).toBeNull()
    // Fresh is not a third mode: the configured layout is untouched.
    expect(params.get("layout")).toBe("fresh")
    expect(params.get("freshScope")).toBe("ranked")
  })

  it("without ranking drops the rank bucket and keeps the configured layout query", () => {
    const params = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        defaultRankingBadges: true,
        defaultPosterLayout: "fresh",
        previewFamily: "extra",
      }),
    )
    // The without-ranking request can never paint a rank numeral, whatever the
    // source data availability: the bucket is gone, the other enabled buckets
    // (and the configured layout) stay untouched.
    expect(params.get("sash")).toBe([...DEFAULT_SASH_ORDER].filter((b) => b !== "rank").join(","))
    expect(params.get("layout")).toBe("fresh")
    expect(params.get("ranking")).toBe("1")
  })

  it("only-rank sash: the without-ranking request paints no numeral and invents no sample", () => {
    // RED before the fix: `sash` still carried `rank`, so the existing
    // `demosamples` rank sample drew the numeral while the switch said
    // "without". No info bucket is enabled here, so nothing may be fabricated.
    for (const family of ["extra", "info"] as const) {
      const params = paramsOf(
        buildDefaultsPreviewUrl({
          defaultSashOrder: ["rank"],
          defaultRankingBadges: true,
          previewFamily: family,
        }),
      )
      expect(params.get("sash"), family).toBe("")
      expect(params.get("extra"), family).toBeNull()
      expect(params.get("ranking"), family).toBe("1")
    }
  })

  it("only-rank sash keeps the ranked Fresh/Card fallback numeral-free", () => {
    // Ranked Fresh/Card layouts only paint a numeral from a displayed rank:
    // dropping the bucket keeps the configured layout while the fallback
    // renders its real composed base (no numeral, config unchanged).
    for (const layout of ["fresh", "provider-glass"] as const) {
      const params = paramsOf(
        buildDefaultsPreviewUrl({
          defaultSashOrder: ["rank"],
          defaultRankingBadges: true,
          defaultPosterLayout: layout,
          defaultPosterFreshScope: "ranked",
          previewFamily: "extra",
        }),
      )
      expect(params.get("sash"), layout).toBe("")
      expect(params.get("layout"), layout).toBe(layout)
      expect(params.get("ranking"), layout).toBe("1")
    }
  })

  it("info family keeps the other enabled buckets but never rank", () => {
    const params = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: ["extra", "rank", "new"],
        defaultRankingBadges: true,
        previewFamily: "info",
      }),
    )
    expect(params.get("sash")).toBe("extra,new")
  })

  it("rank family falls back to the real without-ranking composition when rank cannot be painted", () => {
    const masterOff = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        defaultRankingBadges: false,
        previewFamily: "rank",
      }),
    )
    expect(masterOff.get("sash")).toBe([...DEFAULT_SASH_ORDER].filter((b) => b !== "rank").join(","))
    expect(masterOff.get("ranking")).toBe("0")
  })

  it("rank eligibility follows the previewed shape (`land ?? flat`)", () => {
    expect(
      isDefaultsPreviewRankConfigured({
        defaultRankingBadges: true,
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
      }),
    ).toBe(true)
    expect(
      isDefaultsPreviewRankConfigured({
        defaultRankingBadges: true,
        defaultSashOrder: ["extra", "new"],
      }),
    ).toBe(false)
    expect(
      isDefaultsPreviewRankConfigured({
        defaultRankingBadges: true,
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        landscape: { rankingBadges: false },
        previewShape: "landscape",
      }),
    ).toBe(false)
    // The landscape override never leaks into portrait.
    expect(
      isDefaultsPreviewRankConfigured({
        defaultRankingBadges: true,
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        landscape: { rankingBadges: false },
        previewShape: "portrait",
      }),
    ).toBe(true)
  })
})

describe("two-state switch UI", () => {
  it("offers exactly two states and drives the existing preview family", () => {
    const spy = vi.fn()
    const ui = renderPreview({ previewFamily: "rank", onPreviewFamilyChange: spy })
    const group = screen.getByTestId("defaults-preview-rank-state")
    const buttons = within(group).getAllByRole("button")
    expect(buttons).toHaveLength(2)
    // Default saved config (rank master ON + rank in the sash) can paint rank.
    expect(pressed("defaults-preview-rank-state-with")).toBe("true")
    expect(pressed("defaults-preview-rank-state-without")).toBe("false")

    fireEvent.click(within(group).getByTestId("defaults-preview-rank-state-without"))
    expect(spy).toHaveBeenCalledWith("extra")

    // Owner applies the family: the same control now reflects the fallback.
    ui.rerender(
      createElement(DefaultsPosterPreview, {
        previewShape: "portrait",
        previewFamily: "extra",
        onPreviewFamilyChange: spy,
      }),
    )
    expect(pressed("defaults-preview-rank-state-without")).toBe("true")
    fireEvent.click(screen.getByTestId("defaults-preview-rank-state-with"))
    expect(spy).toHaveBeenCalledWith("rank")
  })

  it("never offers a ranking state the configured preview cannot paint", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultRankingBadges: false }))
    const spy = vi.fn()
    renderPreview({ previewFamily: "rank", onPreviewFamilyChange: spy })
    expect(screen.getByTestId("defaults-preview-rank-state-with").getAttribute("aria-disabled")).toBe("true")
    expect(pressed("defaults-preview-rank-state-without")).toBe("true")
    fireEvent.click(screen.getByTestId("defaults-preview-rank-state-with"))
    // No dead/lying action and no family write.
    expect(spy).not.toHaveBeenCalled()
  })

  it("floating mobile preview only shows the switch inside the enlarged editor", async () => {
    const spy = vi.fn()
    renderPreview({ previewFamily: "rank", floating: true, onPreviewFamilyChange: spy })
    // The floating thumbnail has no chrome row: no inline switch.
    expect(screen.queryByTestId("defaults-preview-rank-state")).toBeNull()
    await loadPreviewImage()
    fireEvent.click(screen.getByTestId("defaults-preview-zoom-open"))
    await screen.findByTestId("defaults-preview-zoom-drag-area")
    const group = await screen.findByTestId("defaults-preview-rank-state-zoom")
    expect(within(group).getAllByRole("button")).toHaveLength(2)
    fireEvent.click(within(group).getByTestId("defaults-preview-rank-state-zoom-without"))
    expect(spy).toHaveBeenCalledWith("extra")
  })

  it("only-rank sash: the explicit without click requests a rank-free image", async () => {
    // RED before the fix: pressing "without" built `sash=rank` (no info bucket
    // enabled), so `demosamples` painted the rank numeral over a switch that
    // claimed the fallback. The request itself must drop the bucket.
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["rank"] }))
    const spy = vi.fn()
    const ui = renderPreview({ previewFamily: "rank", onPreviewFamilyChange: spy })
    expect(pressed("defaults-preview-rank-state-with")).toBe("true")
    fireEvent.click(screen.getByTestId("defaults-preview-rank-state-without"))
    expect(spy).toHaveBeenCalledWith("extra")

    ui.rerender(
      createElement(DefaultsPosterPreview, {
        previewShape: "portrait",
        previewFamily: "extra",
        onPreviewFamilyChange: spy,
      }),
    )
    const params = await settlePendingUrl()
    expect(params.get("sash")).toBe("")
    expect(params.get("extra")).toBeNull()
    expect(params.get("ranking")).toBe("1")
    // Run-time default layout, explicitly transported (sash stays the only
    // difference from the with-ranking request).
    expect(params.get("layout")).toBe("standard")
    // The pressed state matches that request (no false "with").
    expect(pressed("defaults-preview-rank-state-without")).toBe("true")
  })

  it("never claims a rank for the families that keep the full configured priority", () => {
    // `auto` (and the other editing families) request the whole saved priority:
    // an upcoming/award bucket can win over rank, so the painted numeral is
    // data-dependent. The control offers both states without pressing either.
    for (const family of ["auto", "genre", "logo", "gradient", "ratings", "quality"] as const) {
      const ui = renderPreview({ previewFamily: family, onPreviewFamilyChange: vi.fn() })
      const group = screen.getByTestId("defaults-preview-rank-state")
      expect(group.getAttribute("data-rank-state"), family).toBe("unset")
      expect(pressed("defaults-preview-rank-state-with"), family).toBe("false")
      expect(pressed("defaults-preview-rank-state-without"), family).toBe("false")
      // Both choices stay real actions (no dead state).
      expect(screen.getByTestId("defaults-preview-rank-state-with").getAttribute("aria-disabled"), family).toBeNull()
      ui.unmount()
    }
  })

  it("without configured rank every request is numeral-free, so the fallback is explicit", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["extra", "new"] }))
    renderPreview({ previewFamily: "auto", onPreviewFamilyChange: vi.fn() })
    const group = screen.getByTestId("defaults-preview-rank-state")
    expect(group.getAttribute("data-rank-state")).toBe("without")
    expect(pressed("defaults-preview-rank-state-without")).toBe("true")
    expect(screen.getByTestId("defaults-preview-rank-state-with").getAttribute("aria-disabled")).toBe("true")
  })

  it("keeps a direct editing chip reset control with a matching accessible name", () => {
    renderPreview({ previewFamily: "info", onPreviewFamilyChange: vi.fn() })
    // Visible text is "× Full preview": the accessible name must match it.
    expect(screen.getByTestId("defaults-preview-reset-family").getAttribute("aria-label")).toBe(
      "ui.previewEditingAuto",
    )
  })

  it("names the drag-mode toggle with its visible state (label in name)", async () => {
    renderPreview({ previewFamily: "rank", onPreviewFamilyChange: vi.fn() })
    await loadPreviewImage()
    fireEvent.click(screen.getByLabelText("ui.badgeEditOpen"))
    await screen.findByTestId("defaults-preview-zoom-drag-area")
    const toggle = screen.getByTestId("defaults-preview-badge-drag-toggle-zoom")
    // The enlarged editor offers the same two-state preview switch (desktop
    // and mobile), so the poster can be compared without closing it.
    expect(screen.getByTestId("defaults-preview-rank-state-zoom")).toBeTruthy()
    const label = toggle.getAttribute("aria-label") ?? ""
    expect(label).toContain("ui.badgeDragToggle")
    expect(label).toContain((toggle.textContent ?? "").trim())
  })
})
