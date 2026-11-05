/**
 * V1 — Settings format target: Verticale / Orizzontale / Miniature.
 *
 * - The existing two-way selector gains a third option (Miniature).
 * - Miniature swaps the LIVE settings preview to the existing
 *   `/api/thumbnail` sample (series S01E01), same panel chrome.
 * - Switching back restores the exact poster preview URL (byte-identical
 *   string, so the poster renderer/cache is untouched).
 * - The target lives in the editor context: it survives tab switches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { useThumbnailBadgeGeometry } from "@/components/settings/useThumbnailBadgeGeometry"
import type { BadgeDragGeometryAdapter } from "@/lib/badge-drag-adapter"
import { renderWithCtx } from "@/__tests__/test-utils"
import {
  THUMBNAIL_BADGE_SCALE,
  THUMBNAIL_PREVIEW_DEMO_SERIES_ID,
  THUMBNAIL_PREVIEW_SAMPLE_STILL,
  THUMBNAIL_PREVIEW_WIDTH,
} from "@/components/settings/thumbnail-preview"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

describe("settings format target: thumbnail", () => {
  const opened: string[] = []
  beforeEach(() => {
    localStorage.clear()
    opened.length = 0
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultGradientHeight: 30,
        defaultTopBadgeScale: 100,
        landscape: { gradientHeight: 20, topBadgeScale: 120 },
      }),
    )
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
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    // Two passes: the first flushes the thumbnail still fetch, the second
    // lets the resulting URL settle through the 200ms preview debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
  }

  function mountPanel() {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(SettingsPanel, {
          setSettingsOpen: () => {},
          exportData: () => {},
          importData: () => {},
        }),
        createElement(Probe),
      ),
    )
    return () => ctx as unknown as PosterEditorCtx
  }

  async function openBadgeTab() {
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    await settle()
  }

  const lastOpenedUrl = () => opened.at(-1)
  const lastPosterUrl = () => opened.filter((u) => u.includes("/api/poster/")).at(-1)
  const lastThumbnailUrl = () => opened.filter((u) => u.includes("/api/thumbnail/")).at(-1)

  const thumbnailMasterSwitch = () =>
    within(screen.getByTestId("thumbnail-control-episode-thumbnails")).getByRole("switch")
  async function enableThumbnailBadges() {
    const master = thumbnailMasterSwitch()
    if (master.getAttribute("aria-checked") !== "true") fireEvent.click(master)
    await settle()
  }

  function stubFetchWithStills(stills: unknown[]) {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/season/1/episode/1/images")) {
        return { ok: true, status: 200, json: async () => ({ stills }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("renders three options and keeps portrait as the default", async () => {
    mountPanel()
    await openBadgeTab()

    const selector = screen.getByTestId("format-target-selector")
    const buttons = within(selector).getAllByRole("button")
    expect(buttons).toHaveLength(3)
    expect(buttons.map((b) => b.textContent)).toEqual([
      "ui.posterShapePortrait",
      "ui.posterShapeLandscape",
      "ui.episodeThumbnails",
    ])
    expect(screen.getByTestId("format-target-portrait")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("format-target-landscape")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("format-target-thumbnail")).toHaveAttribute("aria-pressed", "false")
  })

  it("swaps the live preview to /api/thumbnail and restores the exact poster URL", async () => {
    const ctx = mountPanel()
    await openBadgeTab()
    const posterBefore = lastPosterUrl()
    expect(posterBefore).toContain("/api/poster/")

    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    const thumbnail = lastThumbnailUrl()
    expect(thumbnail).toBeDefined()
    expect(thumbnail).toContain(
      `/api/thumbnail/tv/${THUMBNAIL_PREVIEW_DEMO_SERIES_ID}/season/1/episode/1`,
    )
    const thumbnailParams = paramsOf(thumbnail!)
    expect(thumbnailParams.get("still")).toBe(THUMBNAIL_PREVIEW_SAMPLE_STILL)
    expect(thumbnailParams.get("w")).toBe(String(THUMBNAIL_PREVIEW_WIDTH))
    expect(thumbnailParams.get("badges")).toBe("both")
    expect(ctx().editTargetShape).toBe("thumbnail")

    // Back to Verticale: the poster preview URL is the exact same string.
    fireEvent.click(screen.getByTestId("format-target-portrait"))
    await settle()
    expect(lastPosterUrl()).toBe(posterBefore)
    expect(ctx().editTargetShape).toBe("portrait")
  })

  it("uses the previewed TV title's own S01E01 first still", async () => {
    localStorage.setItem(
      "previewDemoMedia",
      JSON.stringify({ mediaType: "tv", id: 424242, title: "Still Test" }),
    )
    const fetchMock = stubFetchWithStills([
      { file_path: "/first-still.jpg" },
      { file_path: "/second-still.jpg" },
    ])
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/tmdb/424242/season/1/episode/1/images")),
    ).toBe(true)
    const thumbnail = lastThumbnailUrl()
    expect(thumbnail).toContain("/api/thumbnail/tv/424242/season/1/episode/1")
    expect(paramsOf(thumbnail!).get("still")).toBe("/first-still.jpg")
  })

  it("falls back to Breaking Bad S01E01 when the TV title has no stills", async () => {
    localStorage.setItem(
      "previewDemoMedia",
      JSON.stringify({ mediaType: "tv", id: 555555, title: "No Stills" }),
    )
    stubFetchWithStills([])
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    const thumbnail = lastThumbnailUrl()
    expect(thumbnail).toContain(
      `/api/thumbnail/tv/${THUMBNAIL_PREVIEW_DEMO_SERIES_ID}/season/1/episode/1`,
    )
    expect(paramsOf(thumbnail!).get("still")).toBe(THUMBNAIL_PREVIEW_SAMPLE_STILL)
  })

  it("master OFF shows the raw still and hides every sub-option; ON restores badges", async () => {
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()

    // Default OFF: master first, no sub-options, raw still without pills.
    expect(thumbnailMasterSwitch()).toHaveAttribute("aria-checked", "false")
    expect(screen.getByTestId("thumbnail-control-episode-thumbnails")).toBeVisible()
    expect(screen.getByTestId("thumbnail-subcontrols")).not.toBeVisible()
    expect(lastOpenedUrl()).toContain("image.tmdb.org/t/p/w780")
    expect(lastOpenedUrl()).not.toContain("/api/thumbnail")

    // ON: sub-options + composed badge preview come back.
    await enableThumbnailBadges()
    expect(thumbnailMasterSwitch()).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("thumbnail-subcontrols")).toBeVisible()
    expect(lastThumbnailUrl()).toContain("/api/thumbnail")
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("pill")

    // Blur defaults OFF (no param); ON adds blur=1 after the badges.
    expect(paramsOf(lastThumbnailUrl()!).has("blur")).toBe(false)
    const blurSwitch = within(screen.getByTestId("thumbnail-control-blur")).getByRole("switch")
    expect(blurSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(blurSwitch)
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("blur")).toBe("1")
    fireEvent.click(blurSwitch)
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).has("blur")).toBe(false)

    // OFF again: no badge URL is requested.
    fireEvent.click(thumbnailMasterSwitch())
    await settle()
    expect(screen.getByTestId("thumbnail-subcontrols")).not.toBeVisible()
    expect(lastOpenedUrl()).not.toContain("/api/thumbnail")
    expect(lastOpenedUrl()).toContain("image.tmdb.org/t/p/w780")
  })

  it("position presets anchor each corner; manual X/Y becomes custom", async () => {
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    // Default top-right (TOP convention), zero offsets.
    expect(screen.getByTestId("thumbnail-position-tr")).toHaveAttribute("aria-pressed", "true")
    expect(paramsOf(lastThumbnailUrl()!).get("anchor")).toBe("tr")
    expect(paramsOf(lastThumbnailUrl()!).get("ox")).toBe("0")
    expect(paramsOf(lastThumbnailUrl()!).get("oy")).toBe("0")

    for (const anchor of ["tl", "bl", "br", "tr"] as const) {
      fireEvent.click(screen.getByTestId(`thumbnail-position-${anchor}`))
      await settle()
      expect(screen.getByTestId(`thumbnail-position-${anchor}`)).toHaveAttribute("aria-pressed", "true")
      const params = paramsOf(lastThumbnailUrl()!)
      expect(params.get("anchor")).toBe(anchor)
      expect(params.get("ox")).toBe("0")
      expect(params.get("oy")).toBe("0")
    }

    // No numeric fine-tuning boxes: the enlarged preview drag writes the
    // same offsets underneath, and a preset resets them.
    expect(screen.queryByTestId("thumbnail-offset-x")).toBeNull()
    expect(screen.queryByTestId("thumbnail-offset-y")).toBeNull()
    // Localized hint (the hardcoded English string is gone): IT is the mocked
    // test language, so the guidance still mentions dragging the badge.
    expect(screen.getByTestId("thumbnail-position-hint")).toHaveTextContent(/Trascina/)
  })

  it("shows only the six thumbnail controls and restores poster panels", async () => {
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    const section = screen.getByTestId("thumbnail-settings")
    expect(section).toBeVisible()
    for (const id of [
      "badge-style",
      "provider",
      "blur",
      "episode-thumbnails",
      "position",
    ]) {
      expect(screen.getByTestId(`thumbnail-control-${id}`)).toBeVisible()
    }
    expect(within(section).getAllByTestId(/^thumbnail-control-/)).toHaveLength(5)
    // Scale is locked to the standard 100: no scale control for thumbnails.
    expect(THUMBNAIL_BADGE_SCALE).toBe(100)
    expect(within(section).queryByText("ui.scale")).toBeNull()
    const position = screen.getByTestId("thumbnail-control-position")
    // No numeric X/Y (or scale) boxes: presets + enlarged-preview drag only.
    expect(position.querySelectorAll("input")).toHaveLength(0)
    expect(screen.queryByTestId("thumbnail-offset-x")).toBeNull()
    expect(screen.queryByTestId("thumbnail-offset-y")).toBeNull()
    expect(within(position).queryByLabelText("ui.scale")).toBeNull()
    expect(paramsOf(lastThumbnailUrl()!).has("scale")).toBe(false)
    // Poster-only controls are still mounted (state preserved) but hidden.
    expect(screen.getByTestId("badge-genre-style")).not.toBeVisible()
    for (const card of screen.getAllByTestId("badge-classifica-card")) {
      expect(card).not.toBeVisible()
    }

    expect(screen.getByTestId("thumbnail-subcontrols")).toBeVisible()

    // Resolution is NOT configurable: no dropdown, `w` locked to standard 320.
    expect(screen.queryByTestId("thumbnail-width-select")).toBeNull()
    expect(screen.queryByTestId("thumbnail-control-width")).toBeNull()
    expect(paramsOf(lastThumbnailUrl()!).get("w")).toBe("320")
    expect(paramsOf(lastThumbnailUrl()!).has("scale")).toBe(false)

    // Style selector carries bstyle (pill/bordo/vetro/branded/naked/score).
    const styleSelect = screen.getByTestId("thumbnail-badge-style-select")
    expect(within(styleSelect).getAllByRole("option")).toHaveLength(6)
    fireEvent.change(styleSelect, { target: { value: "bordo" } })
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("bordo")
    fireEvent.change(styleSelect, { target: { value: "vetro" } })
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("vetro")
    fireEvent.change(styleSelect, { target: { value: "branded" } })
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("branded")
    fireEvent.change(styleSelect, { target: { value: "naked" } })
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("naked")
    fireEvent.change(styleSelect, { target: { value: "score" } })
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("bstyle")).toBe("score")

    // Transform tab: poster geometry is hidden, thumbnail controls stay.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabTransform" }))
    await settle()
    expect(screen.getByTestId("transform-geo-logo")).not.toBeVisible()
    expect(screen.getByTestId("thumbnail-control-position")).toBeVisible()

    // Back to Verticale: full poster panels return, thumbnail section hides.
    fireEvent.click(screen.getByTestId("format-target-portrait"))
    await settle()
    expect(screen.getByTestId("thumbnail-settings")).not.toBeVisible()
    expect(screen.getByTestId("transform-geo-logo")).toBeVisible()
  })

  it("thumbnail drag adapter writes the same corner offsets (preset/drag parity)", async () => {
    let ctx: PosterEditorCtx | null = null
    let adapter: BadgeDragGeometryAdapter | null = null
    function Probe() {
      ctx = usePosterEditor()
      adapter = useThumbnailBadgeGeometry()
      return null
    }
    renderWithCtx(createElement(Probe))

    act(() => {
      adapter!.applyFamilyMoves([{ family: "genre", offsetX: 12, offsetY: -4 }])
    })
    expect((ctx as unknown as PosterEditorCtx).thumbnailBadgeOffsetX).toBe(12)
    expect((ctx as unknown as PosterEditorCtx).thumbnailBadgeOffsetY).toBe(-4)

    act(() => {
      adapter!.resetFamilies(["genre"])
    })
    expect((ctx as unknown as PosterEditorCtx).thumbnailBadgeOffsetX).toBe(0)
    expect((ctx as unknown as PosterEditorCtx).thumbnailBadgeOffsetY).toBe(0)
  })

  it("provider switch offers IMDb + TMDB, defaults to IMDb and drives ?source", async () => {
    mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()
    await enableThumbnailBadges()

    const provider = screen.getByTestId("thumbnail-control-provider")
    const options = within(provider).getAllByRole("button")
    expect(options).toHaveLength(2)
    // Existing i18n label keys (no raw renderer ids, no `imdb_`/`tmdb_` artifact).
    expect(options.map((b) => b.textContent)).toEqual(["ui.source_imdb", "ui.source_tmdb"])
    for (const option of options) {
      expect(option.textContent).not.toMatch(/^(imdb|tmdb)_/)
    }

    // Default = IMDb (renderer default), explicit in the WYSIWYG preview URL.
    expect(screen.getByTestId("thumbnail-provider-imdb")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("thumbnail-provider-tmdb")).toHaveAttribute("aria-pressed", "false")
    expect(paramsOf(lastThumbnailUrl()!).get("source")).toBe("imdb")

    // Switch to TMDB: URL follows immediately (debounced), selection swaps.
    fireEvent.click(screen.getByTestId("thumbnail-provider-tmdb"))
    await settle()
    expect(screen.getByTestId("thumbnail-provider-tmdb")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("thumbnail-provider-imdb")).toHaveAttribute("aria-pressed", "false")
    expect(paramsOf(lastThumbnailUrl()!).get("source")).toBe("tmdb")

    // And back to IMDb.
    fireEvent.click(screen.getByTestId("thumbnail-provider-imdb"))
    await settle()
    expect(paramsOf(lastThumbnailUrl()!).get("source")).toBe("imdb")
  })

  it("keeps the target across settings tabs (context persistence)", async () => {
    const ctx = mountPanel()
    await openBadgeTab()
    fireEvent.click(screen.getByTestId("format-target-thumbnail"))
    await settle()

    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabTransform" }))
    await settle()

    expect(screen.getByTestId("format-target-selector")).not.toBeNull()
    expect(screen.getByTestId("format-target-thumbnail")).toHaveAttribute("aria-pressed", "true")
    expect(ctx().editTargetShape).toBe("thumbnail")
  })
})
