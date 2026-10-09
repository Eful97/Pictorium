/**
 * P6: integrated Card layouts (provider-glass/nuvio/stremio) UI + persistence.
 * - The layout selector exposes all 5 choices as a controlled radiogroup with
 *   accessible labels, illustrative CSS thumbnails (no second renderer) and a
 *   responsive wrapping grid (no 5-long-labels single-row overflow).
 * - The apply-scope selector is visible for Fresh AND Card (generic wording
 *   for Card, same stored `posterFreshScope`), hidden for Standard with the
 *   stored value kept.
 * - Per-title and per-shape default round-trips: portrait Provider Glass +
 *   landscape Stremio stay independent; reopen hydrates saved Card values;
 *   Standard/Fresh behavior is unchanged.
 * - On Card, the fixed-geometry Transform sliders (rank, genre offsets,
 *   title offsets, provider follow/offsets) render disabled with an active
 *   hint while the stored values persist for switchback; title/network/genre
 *   scales, quality, extra and blur stay enabled (P15: genre scale sizes the
 *   Card main standard badge).
 * No rendering/service math is touched here (UI + persistence only).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import { TransformControls } from "@/components/TransformControls"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { PosterLayoutSelector } from "@/components/PosterLayoutSelector"
import { buildPreviewUrl } from "@/lib/poster-url"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function probe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
}

const SELECTED = {
  id: 11,
  media_type: "movie",
  title: "Probe",
  poster_path: "/p.jpg",
} as const

const LOGO = {
  file_path: "/logo.png",
  iso_639_1: "en",
  vote_average: 0,
  width: 400,
  height: 200,
} as const

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

describe("five-choice layout selector", () => {
  it("renders 5 radios with labels, thumbnails and a wrapping grid", () => {
    const onChange = vi.fn()
    renderWithCtx(
      createElement(PosterLayoutSelector, { value: "nuvio", onChange }),
    )
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    // Responsive: wrapping grid, never one fixed 5-label row.
    expect(group.className).toContain("poster-layout-grid")
    expect(group.className).toContain("grid-cols-2")
    const radios = within(group).getAllByRole("radio")
    expect(radios).toHaveLength(5)
    for (const name of [
      "ui.posterLayoutStandard",
      "ui.posterLayoutFresh",
      "ui.posterLayoutProviderGlass",
      "ui.posterLayoutNuvio",
      "ui.posterLayoutStremio",
    ]) {
      expect(within(group).getByRole("radio", { name })).toBeTruthy()
    }
    // Saved Card value passes through (aria-checked on nuvio, not standard).
    expect(
      within(group).getByRole("radio", { name: "ui.posterLayoutNuvio" }),
    ).toHaveAttribute("aria-checked", "true")
    // Illustrative thumbnails: present but aria-hidden (names stay clean).
    const thumbs = group.querySelectorAll('[aria-hidden="true"]')
    expect(thumbs.length).toBeGreaterThanOrEqual(5)
    // Clicking reports the layout ID.
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutStremio" }),
    )
    expect(onChange).toHaveBeenCalledWith("stremio")
  })

  it("shows the Card fixed-positions hint on Card, Standard/Fresh hints otherwise", () => {
    const noop = vi.fn()
    const { unmount } = renderWithCtx(
      createElement(PosterLayoutSelector, { value: "provider-glass", onChange: noop }),
    )
    expect(screen.getByText("ui.posterLayoutCardHint")).toBeTruthy()
    expect(screen.queryByText("ui.posterLayoutHint")).toBeNull()
    unmount()
    renderWithCtx(
      createElement(PosterLayoutSelector, { value: "fresh", onChange: noop }),
    )
    expect(screen.getByText("ui.posterLayoutHint")).toBeTruthy()
    expect(screen.queryByText("ui.posterLayoutCardHint")).toBeNull()
  })
})

describe("scope selector visibility (Card + Fresh, never Standard)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: SELECTED as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it("hides on Standard, shows generic wording on Card, Fresh wording on Fresh", () => {
    const { ctx } = renderEditor()
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutNuvio" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
    expect(screen.getByTestId("fresh-scope-selector")).toBeTruthy()
    expect(screen.getByText("ui.posterLayoutScope")).toBeTruthy()
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeTruthy()
    expect(screen.queryByText("ui.posterFreshScope")).toBeNull()
    fireEvent.change(screen.getByTestId("fresh-scope-select"), {
      target: { value: "all" },
    })
    expect(ctx().posterFreshScope).toBe("all")
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }),
    )
    expect(screen.getByText("ui.posterFreshScope")).toBeTruthy()
    expect(screen.getByText("ui.posterFreshScopeHint")).toBeTruthy()
    // The stored scope survives the layout switch (fresh inherits "all").
    expect(ctx().posterFreshScope).toBe("all")
  })
})

describe("per-title Card round-trip (portrait provider-glass, landscape stremio)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: SELECTED as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    return { ctx }
  }

  it("selects Card per title, keeps badge/logo/transform values, restores on switchback", () => {
    const { ctx } = renderEditor()
    const before = {
      badge: ctx().badgeStyle,
      rank: ctx().rankingBadgeStyle,
      logo: ctx().logoScale,
      top: ctx().topBadgeScale,
      genre: ctx().genreBadgeScale,
      net: ctx().networkLogoScale,
    }
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutProviderGlass" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    expect(ctx().badgeStyle).toBe(before.badge)
    expect(ctx().rankingBadgeStyle).toBe(before.rank)
    expect(ctx().logoScale).toBe(before.logo)
    expect(ctx().topBadgeScale).toBe(before.top)
    expect(ctx().genreBadgeScale).toBe(before.genre)
    expect(ctx().networkLogoScale).toBe(before.net)
    // Preview emits the current Card ID (generic chain, no Fresh collapse).
    const preview = buildPreviewUrl(
      {
        selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
        previewPoster: null,
        selectedLogo: null,
        selectedBackdrop: null,
        logoScale: 75,
        logoOffsetX: 0,
        logoOffsetY: 0,
        backdropScale: 100,
        backdropOffsetX: 0,
        backdropOffsetY: 0,
        metaInfo: { genres: [], voteAverage: 0 },
        trendRank: null,
        mdblistAnimeList: [],
        topEdgeColor: null,
        bottomEdgeColor: null,
        accentColor: null,
        autoAccentColor: null,
        lang: "it",
        tmdbKey: "k",
        userId: null,
      } as never,
      { posterLayout: ctx().posterLayout } as never,
    )
    expect(paramsOf(preview).get("layout")).toBe("provider-glass")
    // Standard detour keeps the Card scope; switching back restores Card.
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe(before.rank)
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutStremio" }),
    )
    expect(ctx().posterLayout).toBe("stremio")
  })
})

describe("defaults per shape: portrait provider-glass, landscape stremio", () => {
  function renderBadge(shape: "portrait" | "landscape") {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, { active: true, shape }),
        createElement(Probe),
      ),
    )
    const t = screen.getByTestId("badge-group-style-toggle")
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it("portrait writes the flat, landscape the profile override, independently", async () => {
    const portrait = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutProviderGlass" }),
    )
    expect(portrait.ctx().defaultPosterLayout).toBe("provider-glass")
    expect(portrait.ctx().landscape.posterLayout).toBeUndefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").posterLayout).toBe(
      "provider-glass",
    )
  })

  it("landscape writes only the profile; flat stays standard", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStremio" }),
    )
    expect(ctx().landscape.posterLayout).toBe("stremio")
    expect(ctx().defaultPosterLayout).toBe("standard")
  })
})

describe("reopen persists saved Card values", () => {
  function renderProbe() {
    const { Probe, ctx } = probe()
    renderWithCtx(createElement("div", null, createElement(Probe)))
    return { ctx }
  }

  it("restores saved flat Card layout + scope", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterLayout: "nuvio",
        posterLayout: "provider-glass",
        defaultPosterFreshScope: "all",
        posterFreshScope: "all",
      }),
    )
    const { ctx } = renderProbe()
    await act(async () => {})
    expect(ctx().defaultPosterLayout).toBe("nuvio")
    expect(ctx().posterLayout).toBe("provider-glass")
    expect(ctx().posterFreshScope).toBe("all")
  })

  it("Standard/Fresh saved values are unchanged by the Card exposure", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "fresh", posterLayout: "standard" }),
    )
    const { ctx } = renderProbe()
    await act(async () => {})
    expect(ctx().defaultPosterLayout).toBe("fresh")
    expect(ctx().posterLayout).toBe("standard")
  })
})

describe("Card transform applicability (fixed geometry disabled, values kept)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(BadgeControls),
        createElement(TransformControls),
        createElement(Probe),
      ),
      {
        selected: SELECTED as never,
        selectedLogo: LOGO as never,
        metaInfo: { genres: [], voteAverage: 0 } as never,
      },
    )
    return { ctx }
  }

  it("disables rank/genre/title-offset/provider-offset controls on Card, keeps values", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    // Standard: no Card-disabled fieldset.
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    const before = {
      top: ctx().topBadgeScale,
      tox: ctx().topBadgeOffsetX,
      genre: ctx().genreBadgeScale,
      lox: ctx().logoOffsetX,
      nox: ctx().networkLogoOffsetX,
      follow: ctx().networkLogoFollowTitle,
    }
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutNuvio" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
    // Four fixed-geometry groups disabled: title offsets, rank, genre, network offsets.
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(4)
    // Provider follow switch is disabled too (fixed slot), values untouched.
    expect(
      screen.getByRole("switch", { name: "ui.followTitleLogo" }),
    ).toBeDisabled()
    // Active hint explains the fixed positions + ranked fallback.
    expect(screen.getAllByText("ui.posterLayoutCardHint").length).toBeGreaterThanOrEqual(4)
    // No value was rewritten by the layout switch.
    expect(ctx().topBadgeScale).toBe(before.top)
    expect(ctx().topBadgeOffsetX).toBe(before.tox)
    expect(ctx().genreBadgeScale).toBe(before.genre)
    expect(ctx().logoOffsetX).toBe(before.lox)
    expect(ctx().networkLogoOffsetX).toBe(before.nox)
    expect(ctx().networkLogoFollowTitle).toBe(before.follow)
    // Title/network scales, quality, extra and blur stay enabled (no
    // blanket disable): at least one enabled range input remains.
    const enabledRanges = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).filter((el) => !(el as HTMLInputElement).disabled)
    expect(enabledRanges.length).toBeGreaterThan(0)
    // Switchback to Standard re-enables everything with values intact.
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    )
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    expect(ctx().topBadgeScale).toBe(before.top)
    expect(ctx().genreBadgeScale).toBe(before.genre)
  })

  it("P15: genre scale stays live on Card (main standard badge), only X/Y offsets disabled", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutNuvio" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
    // The genre section keeps exactly one disabled fieldset (the fixed X/Y
    // offsets); the scale slider resizes the Card main standard badge.
    // Two blocks share the key (BadgeControls toggles + the TransformControls
    // slider section): pick the ancestor section holding exactly the 3 genre
    // sliders (scale, X, Y).
    const headings = screen.getAllByText("ui.genreRatingBadge", { exact: false })
    expect(headings.length).toBeGreaterThanOrEqual(1)
    let section: HTMLElement | null = null
    for (const h of headings) {
      let el: HTMLElement | null = h.parentElement
      while (el && el.querySelectorAll('input[type="range"]').length === 0) {
        el = el.parentElement
      }
      if (el && el.querySelectorAll('input[type="range"]').length === 3) {
        section = el
        break
      }
    }
    expect(section).not.toBeNull()
    const ranges = Array.from(section!.querySelectorAll('input[type="range"]'))
    expect(ranges.length).toBe(3)
    // DOM order: scale, X, Y. Disabled state rides the ancestor fieldset
    // (jsdom `.disabled` IDL ignores fieldset ancestry — assert containment).
    expect((ranges[0] as HTMLInputElement).closest("fieldset[disabled]")).toBeNull()
    expect((ranges[1] as HTMLInputElement).closest("fieldset[disabled]")).not.toBeNull()
    expect((ranges[2] as HTMLInputElement).closest("fieldset[disabled]")).not.toBeNull()
    // Total disabled Card fieldsets unchanged (title offsets, rank, genre
    // offsets, network offsets): the scale row moved out, nothing re-enabled.
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(4)
  })

  it("Fresh keeps every Transform slider enabled (no Card gating leak)", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutFresh" }),
    )
    expect(ctx().posterLayout).toBe("fresh")
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    expect(screen.queryByText("ui.posterLayoutCardHint")).toBeNull()
  })
})
