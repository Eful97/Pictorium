/**
 * Badge offset ranges shared by the per-title editor and the
 * Vertical/Horizontal defaults panels: full canvas crossing via drag.
 *
 * - Helper `getBadgeOffsetRange`: portrait X ±500 / Y ±750, landscape
 *   X ±768 / Y ±432; numeric edit ±2000 (server contract); fail-closed
 *   fallback to portrait for garbage/null shapes. Portrait constants mirror
 *   the canonical `STD_W`/`STD_H` (checked below); the helper itself never
 *   imports sharp/image-utils (client bundle guard, checked below).
 * - `TransformControls` (per-title), `TransformPanel` (defaults Verticale)
 *   and `LandscapeDefaultsSection` (defaults Orizzontale): all 5 offset
 *   families (top/genre/quality/separate/network) plus the default logo
 *   offsets use those ranges with pixel step; the `number` top X slider
 *   keeps showing the effective value (stored + baseline -20) and converts
 *   edits back to the stored adjustment; mount performs no writes.
 *   Per-title film-logo dynamic bounds are unchanged; scale/gradient
 *   sliders and existing disabled/hint constraints are untouched.
 */
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ReactNode } from "react"
import { fireEvent, screen, within } from "@testing-library/react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { SliderRow } from "@/components/SliderRow"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import {
  BADGE_OFFSET_NUMERIC_LIMIT,
  PORTRAIT_OFFSET_CANVAS_H,
  PORTRAIT_OFFSET_CANVAS_W,
  getBadgeOffsetRange,
} from "@/lib/badge-offset-ranges"
import { LAND_H, LAND_W } from "@/lib/constants"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    createElement("div", null, ui, createElement(Probe)),
  )
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function cardByTitle(title: string): HTMLElement {
  const el = screen.getByText(title, { exact: true })
  const card = el.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

const ALL_ON = {
  defaultGlobalBadges: true,
  defaultRankingBadges: true,
  defaultBadgeRating: true,
  defaultSeparateRatings: true,
  defaultBadgeQuality: true,
  defaultNetworkLogo: true,
  // Quality offsets carry portrait defaults (-10/+15): pin explicit zeros so
  // the mount assertion below proves read-only mapping, not default values.
  defaultQualityBadgeOffsetX: 0,
  defaultQualityBadgeOffsetY: 0,
}

const FAMILIES = [
  "ui.topBadge",
  "ui.genreRatingBadge",
  "ui.badgeQuality",
  "ui.separateRatings",
  "ui.networkLogo",
] as const

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

describe("getBadgeOffsetRange", () => {
  it("portrait: X ±500, Y ±750, numeric ±2000", () => {
    expect(PORTRAIT_OFFSET_CANVAS_W).toBe(500)
    expect(PORTRAIT_OFFSET_CANVAS_H).toBe(750)
    expect(BADGE_OFFSET_NUMERIC_LIMIT).toBe(2000)
    expect(getBadgeOffsetRange("poster", "x")).toEqual({
      min: -500,
      max: 500,
      boundsMin: -2000,
      boundsMax: 2000,
    })
    expect(getBadgeOffsetRange("poster", "y")).toEqual({
      min: -750,
      max: 750,
      boundsMin: -2000,
      boundsMax: 2000,
    })
  })

  it("landscape: X ±768, Y ±432, numeric ±2000", () => {
    expect(LAND_W).toBe(768)
    expect(LAND_H).toBe(432)
    expect(getBadgeOffsetRange("landscape", "x")).toEqual({
      min: -768,
      max: 768,
      boundsMin: -2000,
      boundsMax: 2000,
    })
    expect(getBadgeOffsetRange("landscape", "y")).toEqual({
      min: -432,
      max: 432,
      boundsMin: -2000,
      boundsMax: 2000,
    })
  })

  it("fail-closed: garbage/null shapes fall back to portrait", () => {
    for (const shape of [undefined, null, "", "garbage", "LANDSCAPE"]) {
      expect(getBadgeOffsetRange(shape, "x")).toEqual(
        getBadgeOffsetRange("poster", "x"),
      )
      expect(getBadgeOffsetRange(shape, "y")).toEqual(
        getBadgeOffsetRange("poster", "y"),
      )
    }
  })
})

describe("SliderRow step prop", () => {
  function rowProps(over: Record<string, unknown> = {}) {
    return {
      label: "X",
      value: 0,
      min: -500,
      max: 500,
      boundsMin: -2000,
      boundsMax: 2000,
      onChange: vi.fn(),
      onDoubleClick: vi.fn(),
      editingValue: null,
      editText: "",
      setEditingValue: vi.fn(),
      setEditText: vi.fn(),
      editingKey: "ox",
      suffix: "px",
      ...over,
    }
  }

  it("defaults to range/100 (legacy behavior untouched)", () => {
    renderWithCtx(createElement(SliderRow, rowProps()))
    expect(screen.getByRole("slider", { name: "X" }).getAttribute("step")).toBe(
      "10",
    )
  })

  it("explicit step wins (offset sliders use pixel step)", () => {
    renderWithCtx(createElement(SliderRow, rowProps({ step: 1 })))
    expect(screen.getByRole("slider", { name: "X" }).getAttribute("step")).toBe(
      "1",
    )
  })
})

describe("TransformControls portrait offset ranges", () => {
  it("all 5 families drag a full canvas crossing with pixel step", () => {
    seedDefaults(ALL_ON)
    const { ctx } = renderWithProbe(createElement(TransformControls))
    for (const family of FAMILIES) {
      const card = cardByTitle(`${family} · ui.posterShapePortrait`)
      const x = within(card).getByRole("slider", { name: "X" })
      const y = within(card).getByRole("slider", { name: "Y" })
      expect(x.getAttribute("min")).toBe("-500")
      expect(x.getAttribute("max")).toBe("500")
      expect(x.getAttribute("step")).toBe("1")
      expect(y.getAttribute("min")).toBe("-750")
      expect(y.getAttribute("max")).toBe("750")
      expect(y.getAttribute("step")).toBe("1")
    }
    // Mount is read-only: no stored offset is rewritten.
    expect(ctx().topBadgeOffsetX).toBe(0)
    expect(ctx().topBadgeOffsetY).toBe(0)
    expect(ctx().genreBadgeOffsetX).toBe(0)
    expect(ctx().genreBadgeOffsetY).toBe(0)
    expect(ctx().qualityBadgeOffsetX).toBe(0)
    expect(ctx().qualityBadgeOffsetY).toBe(0)
    expect(ctx().separateBadgeOffsetX).toBe(0)
    expect(ctx().separateBadgeOffsetY).toBe(0)
    expect(ctx().networkLogoOffsetX).toBe(0)
    expect(ctx().networkLogoOffsetY).toBe(0)
  })

  it("film-logo sliders keep their dynamic bounds (untouched)", () => {
    seedDefaults(ALL_ON)
    renderWithCtx(createElement(TransformControls))
    // No logo selected in test ctx: the film-logo card stays hidden and no
    // logo offset state exists on the per-title editor path.
    expect(screen.queryByText(/ui\.logoSection/)).toBeNull()
  })
})

describe("TransformControls landscape offset ranges", () => {
  it("all 5 families drag a full 16:9 canvas crossing", () => {
    seedDefaults({ ...ALL_ON, posterShape: "landscape" })
    renderWithCtx(createElement(TransformControls))
    for (const family of FAMILIES) {
      const card = cardByTitle(`${family} · ui.posterShapeLandscape`)
      const x = within(card).getByRole("slider", { name: "X" })
      const y = within(card).getByRole("slider", { name: "Y" })
      expect(x.getAttribute("min")).toBe("-768")
      expect(x.getAttribute("max")).toBe("768")
      expect(x.getAttribute("step")).toBe("1")
      expect(y.getAttribute("min")).toBe("-432")
      expect(y.getAttribute("max")).toBe("432")
      expect(y.getAttribute("step")).toBe("1")
    }
  })
})

describe("TransformControls top X with number baseline", () => {
  function topPortraitCard(): HTMLElement {
    return cardByTitle("ui.topBadge · ui.posterShapePortrait")
  }

  it("shows the effective value on the shifted range, edit stores the adjustment", () => {
    seedDefaults({ ...ALL_ON, defaultRankingBadgeStyle: "number" })
    const { ctx } = renderWithProbe(createElement(TransformControls))
    const x = within(topPortraitCard()).getByRole("slider", { name: "X" })
    expect(x.getAttribute("min")).toBe("-520")
    expect(x.getAttribute("max")).toBe("480")
    expect(x.getAttribute("step")).toBe("1")
    expect((x as HTMLInputElement).value).toBe("-20")
    expect(ctx().topBadgeOffsetX).toBe(0)
    fireEvent.change(x, { target: { value: "-10" } })
    expect(ctx().topBadgeOffsetX).toBe(10)
  })

  it("numeric edit clamps to the shifted ±2000 contract (raw stays in contract)", () => {
    seedDefaults({ ...ALL_ON, defaultRankingBadgeStyle: "number" })
    const { ctx } = renderWithProbe(createElement(TransformControls))
    const card = topPortraitCard()
    fireEvent.click(within(card).getByRole("button", { name: "X: -20px" }))
    const editor = card.querySelector("input.editor-input") as HTMLInputElement | null
    expect(editor).not.toBeNull()
    fireEvent.change(editor!, { target: { value: "5000" } })
    fireEvent.blur(editor!)
    // Displayed 1980 = raw 2000 (contract edge), never beyond.
    expect(ctx().topBadgeOffsetX).toBe(2000)
  })
})

describe("canonical portrait dims (no sharp in client bundle)", () => {
  it("helper portrait constants mirror STD_W/STD_H", async () => {
    // Canonical import lives in the test only: the helper itself must stay
    // sharp-free (guard below) since image-utils pulls sharp into the bundle.
    const { STD_W, STD_H } = await import("@/lib/image-utils")
    expect(PORTRAIT_OFFSET_CANVAS_W).toBe(STD_W)
    expect(PORTRAIT_OFFSET_CANVAS_H).toBe(STD_H)
  })

  it("helper module never imports sharp/image-utils", () => {
    // Static-import guard (comments may name the modules): no import
    // statement may pull sharp or image-utils into the client bundle.
    const src = readFileSync("src/lib/badge-offset-ranges.ts", "utf8")
    expect(src).not.toMatch(/^\s*import[^;]*sharp/m)
    expect(src).not.toMatch(/from\s+["'][^"']*image-utils["']/)
  })
})

describe("TransformPanel portrait defaults offset ranges", () => {
  function defCard(title: string): HTMLElement {
    const el = screen.getByText(title, { exact: true })
    const card = el.closest("div.rounded-xl")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("all 5 families drag a full canvas crossing with pixel step, mount writes nothing", () => {
    seedDefaults(ALL_ON)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    for (const family of FAMILIES) {
      const card = defCard(family)
      const x = within(card).getByRole("slider", { name: "X" })
      const y = within(card).getByRole("slider", { name: "Y" })
      expect(x.getAttribute("min")).toBe("-500")
      expect(x.getAttribute("max")).toBe("500")
      expect(x.getAttribute("step")).toBe("1")
      expect(y.getAttribute("min")).toBe("-750")
      expect(y.getAttribute("max")).toBe("750")
      expect(y.getAttribute("step")).toBe("1")
    }
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
    expect(ctx().defaultGenreBadgeOffsetY).toBe(0)
    expect(ctx().defaultQualityBadgeOffsetX).toBe(0)
    expect(ctx().defaultQualityBadgeOffsetY).toBe(0)
    expect(ctx().defaultSeparateBadgeOffsetX).toBe(0)
    expect(ctx().defaultSeparateBadgeOffsetY).toBe(0)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(0)
    expect(ctx().defaultNetworkLogoOffsetY).toBe(0)
  })

  it("default logo sliders share the full-canvas ranges (intentional requirement change)", () => {
    seedDefaults(ALL_ON)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    const card = defCard("ui.logoSection")
    const x = within(card).getByRole("slider", { name: "X" })
    const y = within(card).getByRole("slider", { name: "Y" })
    expect(x.getAttribute("min")).toBe("-500")
    expect(x.getAttribute("max")).toBe("500")
    expect(x.getAttribute("step")).toBe("1")
    expect(y.getAttribute("min")).toBe("-750")
    expect(y.getAttribute("max")).toBe("750")
    expect(y.getAttribute("step")).toBe("1")
    // Reset/default semantics untouched: null (follow) renders as 0.
    expect(ctx().defaultLogoOffsetX).toBeNull()
    expect(ctx().defaultLogoOffsetY).toBeNull()
  })

  it("logo drag beyond ±100 lands on the portrait default only", () => {
    seedDefaults(ALL_ON)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    const card = defCard("ui.logoSection")
    fireEvent.change(within(card).getByRole("slider", { name: "X" }), { target: { value: "250" } })
    expect(ctx().defaultLogoOffsetX).toBe(250)
    fireEvent.change(within(card).getByRole("slider", { name: "Y" }), { target: { value: "-300" } })
    expect(ctx().defaultLogoOffsetY).toBe(-300)
    // The landscape profile is never written by portrait edits.
    expect(ctx().landscape.logoOffsetX).toBeUndefined()
    expect(ctx().landscape.logoOffsetY).toBeUndefined()
  })

  it("number baseline: shifted range, edit stores the adjustment, numeric clamps to contract", () => {
    seedDefaults({ ...ALL_ON, defaultRankingBadgeStyle: "number" })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    const card = defCard("ui.topBadge")
    const x = within(card).getByRole("slider", { name: "X" })
    expect(x.getAttribute("min")).toBe("-520")
    expect(x.getAttribute("max")).toBe("480")
    expect(x.getAttribute("step")).toBe("1")
    expect((x as HTMLInputElement).value).toBe("-20")
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    fireEvent.change(x, { target: { value: "-10" } })
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
    fireEvent.click(within(card).getByRole("button", { name: "X: -10px" }))
    const editor = card.querySelector("input.editor-input") as HTMLInputElement | null
    expect(editor).not.toBeNull()
    fireEvent.change(editor!, { target: { value: "5000" } })
    fireEvent.blur(editor!)
    expect(ctx().defaultTopBadgeOffsetX).toBe(2000)
  })
})

describe("LandscapeDefaultsSection offset ranges", () => {
  function openLandscape() {
    fireEvent.click(screen.getByText("ui.posterShapeLandscape"))
  }

  function landGroup(title: string): HTMLElement {
    const el = screen.getByText(title, { exact: true })
    const headRow = el.closest("div.flex")
    expect(headRow?.parentElement).not.toBeNull()
    return headRow!.parentElement as HTMLElement
  }

  function landSepBlock(): HTMLElement {
    const el = screen.getByText("ui.separateRatings", { exact: true })
    const block = el.closest("div.space-y-1\\.5")
    expect(block).not.toBeNull()
    return block as HTMLElement
  }

  it("scaleGroup families drag a full 16:9 crossing, overrides untouched on mount", () => {
    seedDefaults({ ...ALL_ON, landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    openLandscape()
    for (const family of ["ui.topBadge", "ui.genreRatingBadge", "ui.badgeQuality", "ui.networkLogo"] as const) {
      const group = landGroup(family)
      const x = within(group).getByRole("slider", { name: "X" })
      const y = within(group).getByRole("slider", { name: "Y" })
      expect(x.getAttribute("min")).toBe("-768")
      expect(x.getAttribute("max")).toBe("768")
      expect(x.getAttribute("step")).toBe("1")
      expect(y.getAttribute("min")).toBe("-432")
      expect(y.getAttribute("max")).toBe("432")
      expect(y.getAttribute("step")).toBe("1")
    }
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.topBadgeOffsetY).toBeUndefined()
    expect(ctx().landscape.genreBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.genreBadgeOffsetY).toBeUndefined()
    expect(ctx().landscape.qualityBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.qualityBadgeOffsetY).toBeUndefined()
    expect(ctx().landscape.networkLogoOffsetX).toBeUndefined()
    expect(ctx().landscape.networkLogoOffsetY).toBeUndefined()
    // Flats never touched by rendering the landscape target.
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("separate block drags the 16:9 crossing, override written only on edit", () => {
    seedDefaults({ ...ALL_ON, landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    openLandscape()
    const block = landSepBlock()
    const x = within(block).getByRole("slider", { name: "X" })
    const y = within(block).getByRole("slider", { name: "Y" })
    expect(x.getAttribute("min")).toBe("-768")
    expect(x.getAttribute("max")).toBe("768")
    expect(x.getAttribute("step")).toBe("1")
    expect(y.getAttribute("min")).toBe("-432")
    expect(y.getAttribute("max")).toBe("432")
    expect(y.getAttribute("step")).toBe("1")
    expect(ctx().landscape.separateBadgeOffsetX).toBeUndefined()
    fireEvent.change(x, { target: { value: "100" } })
    expect(ctx().landscape.separateBadgeOffsetX).toBe(100)
    expect(ctx().defaultSeparateBadgeOffsetX).toBe(0)
  })

  it("landscape logo sliders share the 16:9 ranges (intentional requirement change)", () => {
    seedDefaults({ ...ALL_ON, landscape: {} })
    renderWithCtx(createElement(TransformPanel, { active: true }))
    openLandscape()
    const group = landGroup("ui.logoSection")
    const x = within(group).getByRole("slider", { name: "X" })
    const y = within(group).getByRole("slider", { name: "Y" })
    expect(x.getAttribute("min")).toBe("-768")
    expect(x.getAttribute("max")).toBe("768")
    expect(x.getAttribute("step")).toBe("1")
    expect(y.getAttribute("min")).toBe("-432")
    expect(y.getAttribute("max")).toBe("432")
    expect(y.getAttribute("step")).toBe("1")
  })

  it("logo drag beyond ±100 lands on the landscape override only", () => {
    seedDefaults({ ...ALL_ON, landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    openLandscape()
    const group = landGroup("ui.logoSection")
    fireEvent.change(within(group).getByRole("slider", { name: "X" }), { target: { value: "400" } })
    expect(ctx().landscape.logoOffsetX).toBe(400)
    fireEvent.change(within(group).getByRole("slider", { name: "Y" }), { target: { value: "-200" } })
    expect(ctx().landscape.logoOffsetY).toBe(-200)
    // The portrait flat is never written by landscape edits.
    expect(ctx().defaultLogoOffsetX).toBeNull()
    expect(ctx().defaultLogoOffsetY).toBeNull()
  })

  it("number baseline follows the landscape style, edits write the land-only adjustment", () => {
    seedDefaults({ ...ALL_ON, defaultRankingBadgeStyle: "number", landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    openLandscape()
    const x = within(landGroup("ui.topBadge")).getByRole("slider", { name: "X" })
    expect(x.getAttribute("min")).toBe("-788")
    expect(x.getAttribute("max")).toBe("748")
    expect(x.getAttribute("step")).toBe("1")
    expect((x as HTMLInputElement).value).toBe("-20")
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    fireEvent.change(x, { target: { value: "-10" } })
    expect(ctx().landscape.topBadgeOffsetX).toBe(10)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })
})
