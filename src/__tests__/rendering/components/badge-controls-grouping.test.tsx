/**
 * BadgeControls family grouping (UI-only reorganization, no renderer changes):
 * every control is still accessible exactly once, lives in its own family,
 * ranking (Nastro/Numero/Badge/Fresh/Card) and custom-extra controls are no
 * longer mixed, the seasonal frame family sits between ranking and extra,
 * and conditional details still follow their masters.
 *
 * Uses the existing harness (`renderWithCtx`, raw-key `t`) like the other
 * BadgeControls suites — no production code touched here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { BadgeControls } from "@/components/BadgeControls"
import { renderWithCtx } from "@/__tests__/test-utils"
import { QUALITY_BADGE_STYLES } from "@/lib/badge-styles"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const SELECTED = {
  id: 1,
  media_type: "movie" as const,
  title: "T",
  name: "T",
  poster_path: "/p.jpg",
}

const ALL_ON = {
  globalBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  separateRatings: true,
  separateRatingsStyle: "column",
  ratingSources: ["imdb", "tmdb"],
  rankingBadges: true,
  badgeQuality: true,
  customRatings: true,
  networkLogo: true,
  networkLogoPosition: "auto",
}

function seed(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

function renderEditor(seedObj: Record<string, unknown> = ALL_ON) {
  seed(seedObj)
  renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
}

function family(id: string): HTMLElement {
  return screen.getByTestId(id)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

describe("BadgeControls families: six groups, each control exactly once", () => {
  it("renders the six families exactly once with the shared card layout", () => {
    renderEditor()
    const ids = [
      "badge-family-genre",
      "badge-family-ranking",
      "badge-family-seasonal",
      "badge-family-extra",
      "badge-family-quality",
      "badge-family-common",
    ]
    for (const id of ids) expect(family(id)).toBeInTheDocument()
    for (const id of ids) {
      expect(family(id).className).toMatch(/rounded-xl/)
      expect(family(id).className).toMatch(/bg-surface\/50/)
    }
    // Intentionally absent: the per-title Badge Lab preset picker was removed
    // from the per-poster editor (user request) — library presets apply via
    // the Lab "Use for title" handoff instead. The Lab page, the saved
    // mappings and the rendering are untouched.
    expect(screen.queryByTestId("badge-family-presets")).toBeNull()
    expect(document.querySelectorAll('[data-testid^="badge-family-"]')).toHaveLength(6)
  })

  it("genre/year/ratings family owns activation, style/font and rating sources", () => {
    renderEditor()
    const genre = family("badge-family-genre")
    for (const name of ["ui.genreRatingBadge", "ui.badgeGenre", "ui.badgeYear", "ui.badgeRating", "ui.separateRatings", "ui.customRatings"]) {
      expect(within(genre).getByRole("switch", { name })).toBeInTheDocument()
      expect(screen.getAllByRole("switch", { name })).toHaveLength(1)
    }
    expect(within(genre).getByText("ui.styleGenreBadge")).toBeInTheDocument()
    expect(within(genre).getByText("ui.badgeFont")).toBeInTheDocument()
    // Collapsible rating sources live here (button by provider label).
    expect(within(genre).getByText("ui.ratingSources")).toBeInTheDocument()
  })

  it("ranking family owns the master plus Nastro/Numero/Badge/Fresh/Card", () => {
    renderEditor()
    const ranking = family("badge-family-ranking")
    expect(within(ranking).getByRole("switch", { name: "ui.topBadge" })).toBeInTheDocument()
    expect(screen.getAllByRole("switch", { name: "ui.topBadge" })).toHaveLength(1)
    expect(within(ranking).getByText("ui.singleBadgeHint")).toBeInTheDocument()
    const appearance = within(ranking).getByRole("radiogroup", { name: "ui.rankFamily" })
    expect(within(appearance).getAllByRole("radio")).toHaveLength(5)
    for (const name of ["ui.ribbon", "ui.number", "ui.badgeSection", "ui.posterLayoutGroupedFresh", "ui.posterLayoutGroupedCard"]) {
      expect(within(appearance).getByRole("radio", { name })).toBeInTheDocument()
    }
  })

  it("seasonal family owns the per-title frame selector", () => {
    renderEditor()
    const seasonal = family("badge-family-seasonal")
    expect(within(seasonal).getByText("ui.seasonalFrame")).toBeInTheDocument()
    expect(within(seasonal).getByTestId("seasonal-frame-selector")).toBeInTheDocument()
    expect(within(seasonal).getByText("ui.seasonalFrameHint")).toBeInTheDocument()
    expect(screen.getAllByTestId("seasonal-frame-selector")).toHaveLength(1)
  })

  it("extra family owns automatic/custom choice plus its own style", () => {
    renderEditor()
    const extra = family("badge-family-extra")
    expect(within(extra).getByText("ui.customBadge")).toBeInTheDocument()
    expect(within(extra).getByRole("combobox")).toBeInTheDocument()
    expect(within(extra).getByText("ui.titleInfoFamily")).toBeInTheDocument()
    expect(within(extra).getByText("ui.extraBadgeStyle")).toBeInTheDocument()
    expect(screen.getByText("ui.extraBadgeStyle").closest('[data-testid="badge-family-extra"]')).not.toBeNull()
  })

  it("quality family owns activation, style and common family owns accent/network/blur", () => {
    renderEditor()
    const quality = family("badge-family-quality")
    expect(within(quality).getByRole("switch", { name: "ui.badgeQuality" })).toBeInTheDocument()
    expect(screen.getAllByRole("switch", { name: "ui.badgeQuality" })).toHaveLength(1)
    expect(within(quality).getByText("ui.qualityBadgeStyle")).toBeInTheDocument()
    const common = family("badge-family-common")
    expect(within(common).getByText("ui.commonAppearance")).toBeInTheDocument()
    for (const name of ["ui.networkLogo", "ui.blurSection"]) {
      expect(within(common).getByRole("switch", { name })).toBeInTheDocument()
      expect(screen.getAllByRole("switch", { name })).toHaveLength(1)
    }
    // Accent picker (native color + hex field) lives in the common family.
    expect(common.querySelector('input[type="color"]')).not.toBeNull()
    expect(within(common).getByText("ui.networkLogoPosition")).toBeInTheDocument()
  })

  it("quality style selector offers every enum style, premium included", () => {
    renderEditor()
    const quality = family("badge-family-quality")
    const premium = within(quality).getByRole("button", { name: /ui\.qbsPremium/ })
    expect(premium).toBeInTheDocument()
    // La griglia che contiene premium offre esattamente gli stili dell'enum
    // (derivata, non una lista duplicata in UI): nessuno stile resta fuori.
    const grid = premium.closest("div.grid")
    expect(grid).not.toBeNull()
    expect(grid!.querySelectorAll(":scope > button").length).toBe(QUALITY_BADGE_STYLES.length)
  })
})

describe("BadgeControls families: approved DOM order genre/ranking/seasonal/extra/quality/presets/common", () => {
  it("renders the families in the approved visual/DOM order", () => {
    renderEditor()
    const order = Array.from(document.querySelectorAll('[data-testid^="badge-family-"]')).map((el) =>
      el.getAttribute("data-testid"),
    )
    expect(order).toEqual([
      "badge-family-genre",
      "badge-family-ranking",
      "badge-family-seasonal",
      "badge-family-extra",
      "badge-family-quality",
      "badge-family-common",
    ])
  })
})

describe("BadgeControls families: common accent label and sources disclosure state", () => {
  it("accent picker and hex field share the visible localized accent label as accessible name", () => {
    renderEditor()
    const common = family("badge-family-common")
    // Visible localized label (existing key, no new copy).
    expect(within(common).getByText("ui.accentSharedBadge")).toBeInTheDocument()
    // Both controls (native color + hex field) expose it as accessible name.
    const labelled = within(common).getAllByLabelText("ui.accentSharedBadge")
    expect(labelled).toHaveLength(2)
    expect(labelled.map((el) => el.tagName.toLowerCase())).toEqual(["input", "input"])
    expect(labelled.map((el) => el.getAttribute("type")).sort()).toEqual(["color", "text"])
  })

  it("rating-sources disclosure conveys state via aria-expanded/aria-controls", () => {
    renderEditor()
    const genre = family("badge-family-genre")
    const toggle = within(genre).getByText("ui.ratingSources").closest("button")
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute("aria-expanded")).toBe("false")
    const panelId = toggle!.getAttribute("aria-controls")
    expect(panelId).toBeTruthy()
    expect(genre.querySelector(`#${CSS.escape(panelId!)}`)).toBeNull()
    fireEvent.click(toggle!)
    expect(toggle!.getAttribute("aria-expanded")).toBe("true")
    const panel = genre.querySelector(`#${CSS.escape(panelId!)}`)
    expect(panel).not.toBeNull()
    // Providers unchanged: enabling still offers the full list.
    expect(within(panel as HTMLElement).getByText("ui.enableAll")).toBeInTheDocument()
  })
})
describe("BadgeControls families: ranking and custom-extra are never mixed", () => {
  it("ranking family has no extra controls; extra family has no rank controls", () => {
    renderEditor()
    const ranking = family("badge-family-ranking")
    expect(within(ranking).queryByText("ui.customBadge")).toBeNull()
    expect(within(ranking).queryByText("ui.extraBadgeStyle")).toBeNull()
    expect(within(ranking).queryByText("ui.titleInfoFamily")).toBeNull()
    const extra = family("badge-family-extra")
    expect(within(extra).queryByRole("radiogroup", { name: "ui.rankFamily" })).toBeNull()
    expect(within(extra).queryByRole("switch", { name: "ui.topBadge" })).toBeNull()
    expect(within(extra).queryByText("ui.singleBadgeHint")).toBeNull()
    // The seasonal frame selector lives in its own family, never mixed in.
    expect(within(ranking).queryByTestId("seasonal-frame-selector")).toBeNull()
    expect(within(extra).queryByTestId("seasonal-frame-selector")).toBeNull()
    expect(within(family("badge-family-seasonal")).queryByRole("radiogroup", { name: "ui.rankFamily" })).toBeNull()
    expect(within(family("badge-family-seasonal")).queryByText("ui.customBadge")).toBeNull()
  })
})

describe("BadgeControls families: conditional details still follow their masters", () => {
  it("quality style hides with the master off, master stays", () => {
    renderEditor({ ...ALL_ON, badgeQuality: false })
    expect(screen.getByRole("switch", { name: "ui.badgeQuality" })).toBeInTheDocument()
    expect(screen.queryByText("ui.qualityBadgeStyle")).toBeNull()
  })

  it("network position hides with the logo off, switch stays", () => {
    renderEditor({ ...ALL_ON, networkLogo: false })
    expect(screen.getByRole("switch", { name: "ui.networkLogo" })).toBeInTheDocument()
    expect(screen.queryByText("ui.networkLogoPosition")).toBeNull()
  })

  it("rating sources collapse hides with the rating off, genre master stays", () => {
    renderEditor({ ...ALL_ON, badgeRating: false })
    expect(screen.getByRole("switch", { name: "ui.genreRatingBadge" })).toBeInTheDocument()
    expect(screen.queryByText("ui.ratingSources")).toBeNull()
  })

  it("genre/year sub-controls hide with the genre master off, extras stay reachable", () => {
    renderEditor({ ...ALL_ON, globalBadges: false })
    expect(screen.queryByText("ui.badgeGenre")).toBeNull()
    expect(screen.getByRole("switch", { name: "ui.topBadge" })).toBeInTheDocument()
    expect(screen.getByText("ui.extraBadgeStyle")).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "ui.rankFamily" })).toBeInTheDocument()
  })

  it("master toggles still write through (no handler lost in the move)", () => {
    renderEditor()
    const top = screen.getByRole("switch", { name: "ui.topBadge" })
    const beforeTop = top.getAttribute("aria-checked")
    fireEvent.click(top)
    expect(top.getAttribute("aria-checked")).not.toBe(beforeTop)
    const genre = screen.getByRole("switch", { name: "ui.badgeGenre" })
    const beforeGenre = genre.getAttribute("aria-checked")
    fireEvent.click(genre)
    expect(genre.getAttribute("aria-checked")).not.toBe(beforeGenre)
    const quality = screen.getByRole("switch", { name: "ui.badgeQuality" })
    const beforeQuality = quality.getAttribute("aria-checked")
    fireEvent.click(quality)
    expect(quality.getAttribute("aria-checked")).not.toBe(beforeQuality)
    expect(screen.queryByText("ui.qualityBadgeStyle")).toBeNull()
  })
})
