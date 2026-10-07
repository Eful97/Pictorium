/**
 * L4 fix verification (genre preview family + separate-offset deps).
 * - `genre` family (aggregate genre/year/rating style controls) keeps the
 *   effective saved sash and forces no `extra=` sample: full actual preview.
 *   Only the title-info card (`info`) keeps the synthetic top sample.
 * - `BadgeStyleSection` genre style + font report `genre`; quality keeps
 *   `quality`. Portrait genre card (`TransformPanel`) and landscape genre
 *   group (`LandscapeDefaultsSection`) report `genre`.
 * - `DefaultsPosterPreview` rebuilds on portrait separate-offset edits
 *   (`defaultSeparateBadgeOffsetX/Y` in the URL memo deps); landscape
 *   overrides keep winning per shape without touching the other shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { GenreStyleSection, QualityStyleSection } from "@/components/settings/BadgeStyleSection"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { LandscapeDefaultsSection } from "@/components/LandscapeDefaultsSection"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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
  FakeXHR.opened = []
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

describe("genre preview family (builder)", () => {
  it("keeps the effective saved sash in portrait and landscape, no extra", () => {
    for (const shape of [undefined, "landscape"] as const) {
      const p = paramsOf(
        buildDefaultsPreviewUrl({
          defaultSashOrder: ["extra", "rank"],
          defaultRankingBadges: true,
          previewShape: shape ?? undefined,
          landscape: { sashOrder: ["award", "rank"] },
          previewFamily: "genre",
        }),
      )
      expect(p.get("sash")).toBe(shape === "landscape" ? "award,rank" : "extra,rank")
      expect(p.get("extra")).toBeNull()
    }
    // Full default order untouched, like auto.
    expect(
      paramsOf(buildDefaultsPreviewUrl({ previewFamily: "genre" })).get("sash"),
    ).toBe([...DEFAULT_SASH_ORDER].join(","))
  })
})

describe("genre family wiring (press reports, no writes)", () => {
  it("BadgeStyleSection: genre style + font report genre, quality keeps quality", async () => {
    const spy = vi.fn()
    const seen: string[] = []
    renderWithCtx(
      createElement("div", null,
        createElement(GenreStyleSection, {
          shape: "portrait",
          onPreviewFamilyChange: (f) => {
            seen.push(f)
            spy(f)
          },
        }),
        createElement(QualityStyleSection, {
          shape: "portrait",
          qualityEnabled: true,
          onPreviewFamilyChange: (f) => {
            seen.push(f)
            spy(f)
          },
        }),
      ),
    )
    await act(async () => {})
    const storedBefore = localStorage.getItem("badgeDefaults")
    fireEvent.pointerDown(screen.getByText("ui.styleGenreBadge"))
    fireEvent.pointerDown(screen.getByText("ui.badgeFont"))
    fireEvent.pointerDown(screen.getByText("ui.qualityBadgeStyle"))
    expect(seen).toEqual(["genre", "genre", "quality"])
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("TransformPanel portrait genre card reports genre", async () => {
    const seen: string[] = []
    renderWithCtx(
      createElement(TransformPanel, {
        active: true,
        onPreviewFamilyChange: (f) => seen.push(f),
      }),
    )
    await act(async () => {})
    fireEvent.pointerDown(screen.getAllByText("ui.genreRatingBadge")[0])
    expect(seen).toContain("genre")
  })

  it("LandscapeDefaultsSection genre group reports genre (rank control intact)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ separateRatings: false }))
    const seen: string[] = []
    renderWithCtx(
      createElement(LandscapeDefaultsSection, {
        editVal: null,
        editTxt: "",
        setEditVal: () => {},
        setEditTxt: () => {},
        onPreviewFamilyChange: (f) => seen.push(f),
      }),
    )
    await act(async () => {})
    // X sliders without the separate group: logo, top, extra, genre,
    // quality, network (the extra group shares the rank preview family).
    const sliders = screen.getAllByRole("slider", { name: "X" })
    expect(sliders.length).toBe(6)
    fireEvent.pointerDown(sliders[1])
    fireEvent.pointerDown(sliders[3])
    expect(seen).toContain("rank")
    expect(seen).toContain("genre")
  })
})

describe("separate-offset preview deps", () => {
  function renderPreview(previewShape: "portrait" | "landscape") {
    const p = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(DefaultsPosterPreview, { previewShape }),
        createElement(p.Probe),
      ),
    )
    return p
  }

  it("portrait separate X/Y edits rebuild the preview URL", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultSeparateBadgeOffsetX: 0, defaultSeparateBadgeOffsetY: 0 }),
    )
    const p = renderPreview("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(FakeXHR.opened.length).toBeGreaterThan(0)
    expect(paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1]).get("sepox")).toBe("0")
    await act(async () => {
      p.ctx().setDefaultSeparateBadgeOffsetX(7)
      p.ctx().setDefaultSeparateBadgeOffsetY(-4)
    })
    expect(p.ctx().defaultSeparateBadgeOffsetX).toBe(7)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const last = paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1])
    expect(last.get("sepox")).toBe("7")
    expect(last.get("sepoy")).toBe("-4")
  })

  it("landscape override wins per shape; flat edits never clobber the other shape", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultSeparateBadgeOffsetX: 0,
        landscape: { separateBadgeOffsetX: 33, separateBadgeOffsetY: -12 },
      }),
    )
    const p = renderPreview("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1]).get("sepox")).toBe("33")
    // Flat edit: landscape request keeps the override.
    await act(async () => {
      p.ctx().setDefaultSeparateBadgeOffsetX(7)
    })
    expect(p.ctx().defaultSeparateBadgeOffsetX).toBe(7)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const last = paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1])
    expect(last.get("sepox")).toBe("33")
    expect(last.get("sepoy")).toBe("-12")
  })
})
