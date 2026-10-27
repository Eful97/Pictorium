/**
 * P6: integrated Card layouts (provider-glass/nuvio/stremio) UI + persistence.
 * - The layout selector exposes all 5 choices as a controlled radiogroup with
 *   accessible labels, illustrative CSS thumbnails (no second renderer) and a
 *   responsive wrapping grid (no 5-long-labels single-row overflow).
 * - Ranked-only scope per title (no scope dropdown, same as the global
 *   Classifiche): Fresh/Card stage `ranked`; a stored explicit "all" on an
 *   existing mapping is preserved until an explicit new selection.
 * - Per-title and per-shape default round-trips: portrait Provider Glass +
 *   landscape Stremio stay independent; reopen hydrates saved Card values;
 *   Standard/Fresh behavior is unchanged.
 * - On Card, every user transform stays live (explicit user contract): the
 *   shared Card compositor applies the same offsets/scales, so no Transform
 *   group is fixed-layout disabled and no "fixed positions" hint is shown.
 *   Neutral values keep the historic Card look.
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

describe("ranked-only scope per title (no scope dropdown, stored all preserved)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: SELECTED as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    return { ctx }
  }

  function presentationGroup(): HTMLElement {
    return within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
  }

  it("never shows a scope dropdown; Fresh/Card show the ranked-only hint with ranked staged", async () => {
    const { ctx } = renderEditor()
    await act(async () => {})
    // Standard: no scope control, no hint (stored preference untouched).
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    expect(screen.queryByText("ui.posterFreshScopeHint")).toBeNull()
    expect(screen.queryByText("ui.posterLayoutScopeHint")).toBeNull()
    // Fresh stages fresh+ranked with the ranked-only hint (no ALL choice).
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    expect(screen.getByText("ui.posterFreshScopeHint")).toBeTruthy()
    // Card stages the remembered skin + ranked with the generic hint.
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeTruthy()
    expect(screen.queryByText("ui.posterFreshScope")).toBeNull()
    // Back to a classic: hints hide again, no scope control appears.
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.ribbon" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByText("ui.posterFreshScopeHint")).toBeNull()
    expect(screen.queryByText("ui.posterLayoutScopeHint")).toBeNull()
  })

  it("preserves a stored explicit all on mount (no silent rewrite) until a new selection stages ranked", async () => {
    document.body.innerHTML = ""
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ posterLayout: "fresh", posterFreshScope: "all" }),
    )
    const { ctx } = renderEditor()
    await act(async () => {})
    // Mount never rewrites: stored all preserved, Fresh still selected.
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("all")
    expect(
      within(presentationGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    ).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.posterFreshScope).toBe("all")
    // Re-clicking Fresh is a no-op (stored scope kept).
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(ctx().posterFreshScope).toBe("all")
    // A new selection (classic detour + Fresh) stages ranked.
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.ribbon" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().posterFreshScope).toBe("all")
    fireEvent.click(
      within(presentationGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("ranked")
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

  it("selects Card per title via the unified presentation, keeps badge/logo/transform values, restores on switchback", () => {
    const { ctx } = renderEditor()
    const before = {
      badge: ctx().badgeStyle,
      rank: ctx().rankingBadgeStyle,
      logo: ctx().logoScale,
      top: ctx().topBadgeScale,
      genre: ctx().genreBadgeScale,
      net: ctx().networkLogoScale,
    }
    const group = within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
    // Card stages the remembered default skin (provider-glass) + ranked.
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    expect(ctx().posterFreshScope).toBe("ranked")
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
    // Classic detour keeps the remembered skin; Card restores it (not the default).
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.ribbon" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    // Skin switch stages stremio + ranked, Card stays checked with one skin checked.
    const skins = screen.getByTestId("poster-layout-skins")
    fireEvent.click(
      within(skins).getByRole("radio", { name: "ui.posterLayoutSkinViolet" }),
    )
    expect(ctx().posterLayout).toBe("stremio")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    ).toHaveAttribute("aria-checked", "true")
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
    const t = screen.getByTestId("badge-advanced-toggle")
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    const g = screen.getByTestId("badge-group-style-toggle")
    if (g.getAttribute("aria-expanded") !== "true") fireEvent.click(g)
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
    // 3B1: the inherited key freezes the pre-edit flat instead of following it.
    expect(portrait.ctx().landscape.posterLayout).toBe("standard")
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

describe("Card transform applicability (all user transforms live)", () => {
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

  it("keeps rank/genre/title-offset/provider-offset controls enabled on Card", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    // Standard: no disabled fieldset.
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    const before = {
      top: ctx().topBadgeScale,
      tox: ctx().topBadgeOffsetX,
      genre: ctx().genreBadgeScale,
      lox: ctx().logoOffsetX,
      nox: ctx().networkLogoOffsetX,
      follow: ctx().networkLogoFollowTitle,
    }
    const group = within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    )
    // Remembered default skin first, then the nuvio skin (explicit switch).
    expect(ctx().posterLayout).toBe("provider-glass")
    fireEvent.click(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinBlack" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
    // The shared compositor applies the user transforms on Card too: no
    // fixed-layout fieldset, no fixed-positions hint, follow toggle live.
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    // The follow switch may still wait for shared geometry, but never because
    // of a Card fixed-layout gate (no Card hint on it).
    expect(screen.getByRole("switch", { name: "ui.followTitleLogo" }).getAttribute("title")).toBeNull()
    expect(screen.queryByText("ui.posterLayoutCardHint")).toBeNull()
    // No value was rewritten by the layout switch.
    expect(ctx().topBadgeScale).toBe(before.top)
    expect(ctx().topBadgeOffsetX).toBe(before.tox)
    expect(ctx().genreBadgeScale).toBe(before.genre)
    expect(ctx().logoOffsetX).toBe(before.lox)
    expect(ctx().networkLogoOffsetX).toBe(before.nox)
    expect(ctx().networkLogoFollowTitle).toBe(before.follow)
    // Every range input stays enabled, and an edit actually writes.
    const enabledRanges = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).filter((el) => !(el as HTMLInputElement).disabled)
    expect(enabledRanges.length).toBeGreaterThan(0)
    let rankSection: HTMLElement | null = null
    for (const h of screen.getAllByText("ui.rankFamily", { exact: false })) {
      let el: HTMLElement | null = h.parentElement
      while (el && el.querySelectorAll('input[type="range"]').length === 0) {
        el = el.parentElement
      }
      if (el && el.querySelectorAll('input[type="range"]').length === 3) {
        rankSection = el
        break
      }
    }
    expect(rankSection).not.toBeNull()
    fireEvent.change(within(rankSection!).getByRole("slider", { name: "X" }), { target: { value: "33" } })
    expect(ctx().topBadgeOffsetX).toBe(33)
  })

  it("genre offsets are live on Card (the band follows the same gox/goy)", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    const group = within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    fireEvent.click(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinBlack" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
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
    // Scale, X, Y: all enabled (no ancestor fieldset[disabled]).
    for (const range of ranges) {
      expect((range as HTMLInputElement).closest("fieldset[disabled]")).toBeNull()
    }
    fireEvent.change(ranges[1], { target: { value: "12" } })
    fireEvent.change(ranges[2], { target: { value: "-9" } })
    expect(ctx().genreBadgeOffsetX).toBe(12)
    expect(ctx().genreBadgeOffsetY).toBe(-9)
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
  })

  it("Fresh keeps every Transform slider enabled (no Card gating leak)", async () => {
    const { ctx } = renderEditor()
    await act(async () => {
      ctx().setNetworkLogo(true)
      ctx().setRankingBadges(true)
      ctx().setGlobalBadges(true)
      ctx().setBadgeQuality(true)
    })
    const group = within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
    fireEvent.click(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(ctx().posterLayout).toBe("fresh")
    expect(document.querySelectorAll("fieldset[disabled]").length).toBe(0)
    expect(screen.queryByText("ui.posterLayoutCardHint")).toBeNull()
  })
})
