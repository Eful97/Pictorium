/**
 * T1: per-title unified ranking presentation (Personalizza/Classifica).
 * ONE exclusive Nastro/Numero/Badge/Fresh/Card group in BadgeControls
 * replaces the old separate layout card — no second renderer, no new stored
 * keys, existing `posterLayout`/`posterFreshScope`/`rankingBadgeStyle` /
 * `ribbonEnabled` transport (preview/save endpoint unchanged).
 * - Classic (Nastro/Numero/Badge) stages `standard` + its canonical rank
 *   style (extra freeze intact); scope untouched.
 * - Fresh stages `fresh`+`ranked` (no user-facing ALL option, ranked-only
 *   rule like the global Classifiche) with the enter-once offset reset
 *   (genre X/Y + logo X/Y to the per-title neutral 0, edited shape only);
 *   re-clicking Fresh preserves manual edits; returning is one-way.
 * - Card stages the remembered skin + `ranked`; skins only while Card is
 *   selected; the stored rank style is never rewritten by Fresh/Card.
 * - A stored explicit "all" scope on an existing mapping is preserved until
 *   an explicit new selection (never rewritten on mount).
 * - Side stays omitted (global-only); variant rows follow the presentation.
 * - No `default*` writes, no autosave; save freezes the edited shape and
 *   preserves the other shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, renderHook, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import { legacyExtraStyleForRank } from "@/components/RankingAppearanceSelector"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

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

function renderTitle(seedObj: Record<string, unknown> = {}) {
  localStorage.setItem("badgeDefaults", JSON.stringify(seedObj))
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null, createElement(BadgeControls), createElement(Probe)),
    { selected: SELECTED as never },
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx }
}

function presentationGroup(): HTMLElement {
  return within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
}

function clickRadio(name: string) {
  fireEvent.click(within(presentationGroup()).getByRole("radio", { name }))
}

function checkedNames(): string[] {
  return within(presentationGroup())
    .getAllByRole("radio")
    .filter((o) => o.getAttribute("aria-checked") === "true")
    .map((o) => o.textContent ?? "")
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

describe("unified presentation group (per-title)", () => {
  it("single exclusive 5-choice group, no layout card, no scope dropdown, Nastro checked by default", async () => {
    renderTitle({})
    await act(async () => {})
    expect(screen.queryByTestId("poster-layout-card")).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.posterLayout" })).toBeNull()
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    const options = within(presentationGroup()).getAllByRole("radio")
    expect(options).toHaveLength(5)
    for (const name of ["ui.ribbon", "ui.number", "ui.badgeSection", "ui.posterLayoutGroupedFresh", "ui.posterLayoutGroupedCard"]) {
      expect(within(presentationGroup()).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(checkedNames()).toEqual(["ui.ribbon"])
    // Card skins hidden until Card is selected; side row always absent.
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
  })

  it("classic clicks stage standard + canonical rank writes; scope untouched", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    clickRadio("ui.number")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("number")
    expect(ctx().ribbonEnabled).toBe(true)
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(checkedNames()).toEqual(["ui.number"])
    clickRadio("ui.badgeSection")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("pill")
    expect(ctx().ribbonEnabled).toBe(true)
    // Canonical extra freeze on the first rank change (explicit click only).
    expect(ctx().extraBadgeStyle).toBe(legacyExtraStyleForRank("default"))
    clickRadio("ui.ribbon")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    expect(ctx().ribbonEnabled).toBe(true)
    expect(checkedNames()).toEqual(["ui.ribbon"])
  })

  it("variant/side rows follow the presentation; Fresh/Card hide them, skins only on Card", async () => {
    renderTitle({})
    await act(async () => {})
    // Nastro: ribbon variants + position note, no badge variants.
    expect(screen.getByRole("radiogroup", { name: "ui.ribbon" })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.getByText("ui.ribbonPosition", { exact: false })).toBeInTheDocument()
    // Numero: note only.
    clickRadio("ui.number")
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.getByText("ui.ribbonPosition", { exact: false })).toBeInTheDocument()
    // Badge: badge variants only, no note.
    clickRadio("ui.badgeSection")
    expect(screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByText("ui.ribbonPosition", { exact: false })).toBeNull()
    // Fresh: neither, ranked-only hint, no skins.
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByText("ui.ribbonPosition", { exact: false })).toBeNull()
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(screen.getByText("ui.posterFreshScopeHint")).toBeInTheDocument()
    // Card: skins + Card hint, still no variant rows.
    clickRadio("ui.posterLayoutGroupedCard")
    const skins = screen.getByTestId("poster-layout-skins")
    for (const name of ["ui.posterLayoutSkinProvider", "ui.posterLayoutSkinBlack", "ui.posterLayoutSkinViolet"]) {
      expect(within(skins).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(checkedNames()).toEqual(["ui.posterLayoutGroupedCard"])
  })
})

describe("fresh enter-once reset (edited shape only)", () => {
  it("transition neutralizes only genre/logo offsets; scales, rank, badge and provenance intact; no default writes", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    await act(async () => {
      ctx().setGenreBadgeOffsetX(15)
      ctx().setGenreBadgeOffsetY(-40)
      ctx().setGenreBadgeScale(130)
      ctx().setLogoOffsetX(12)
      ctx().setLogoOffsetY(-40)
      ctx().setLogoScale(75)
      ctx().setTopBadgeScale(150)
    })
    expect(ctx().logoScaleExplicit).toBe(true)
    const storedBefore = localStorage.getItem("badgeDefaults")
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(ctx().genreBadgeOffsetX).toBe(0)
    expect(ctx().genreBadgeOffsetY).toBe(0)
    expect(ctx().logoOffsetX).toBe(0)
    expect(ctx().logoOffsetY).toBe(0)
    // Everything else untouched.
    expect(ctx().genreBadgeScale).toBe(130)
    expect(ctx().logoScale).toBe(75)
    expect(ctx().logoScaleExplicit).toBe(true)
    expect(ctx().topBadgeScale).toBe(150)
    expect(ctx().rankingBadgeStyle).toBe("default")
    expect(ctx().ribbonEnabled).toBe(true)
    expect(ctx().badgeStyle).toBe("shadow")
    expect(checkedNames()).toEqual(["ui.posterLayoutGroupedFresh"])
    // Per-title edits never write the global defaults (no autosave).
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("re-clicking Fresh preserves manual edits; returning to a classic is one-way", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    clickRadio("ui.posterLayoutGroupedFresh")
    await act(async () => {
      ctx().setGenreBadgeOffsetX(25)
      ctx().setLogoOffsetX(9)
    })
    // Re-click: deliberate slider edits preserved (offsets and scope kept).
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().genreBadgeOffsetX).toBe(25)
    expect(ctx().genreBadgeOffsetY).toBe(0)
    expect(ctx().logoOffsetX).toBe(9)
    expect(ctx().logoOffsetY).toBe(0)
    // Back to Nastro: Standard + canonical style, offsets NOT restored.
    clickRadio("ui.ribbon")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    expect(ctx().genreBadgeOffsetX).toBe(25)
    expect(ctx().genreBadgeOffsetY).toBe(0)
    expect(ctx().logoOffsetX).toBe(9)
    expect(ctx().logoOffsetY).toBe(0)
  })
})

describe("ranked-only scope compatibility (stored all)", () => {
  it("mount preserves a stored explicit all with no selector; new selections stage ranked", async () => {
    const { ctx } = renderTitle({ posterLayout: "fresh", posterFreshScope: "all" })
    await act(async () => {})
    // No silent rewrite on mount: stored all preserved, Fresh selected.
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("all")
    expect(checkedNames()).toEqual(["ui.posterLayoutGroupedFresh"])
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").posterFreshScope).toBe("all")
    // Re-clicking Fresh is a no-op (stored scope kept).
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(ctx().posterFreshScope).toBe("all")
    // Classic detour keeps the stored scope…
    clickRadio("ui.ribbon")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().posterFreshScope).toBe("all")
    // …and the new Fresh selection stages ranked.
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().posterFreshScope).toBe("ranked")
  })
})

describe("card switching (remembered skin + ranked)", () => {
  it("Card stages the remembered skin with ranked; skins switch; classic detour restores the remembered skin; rank style kept", async () => {
    const { ctx } = renderTitle({ posterLayout: "stremio", posterFreshScope: "ranked" })
    await act(async () => {})
    // Saved skin hydrates the selection with no write.
    expect(checkedNames()).toEqual(["ui.posterLayoutGroupedCard"])
    expect(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinViolet" }),
    ).toHaveAttribute("aria-checked", "true")
    // Classic detour keeps the remembered skin; the Nastro click writes its
    // canonical style while Card never rewrites it.
    clickRadio("ui.ribbon")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    clickRadio("ui.posterLayoutGroupedCard")
    expect(ctx().posterLayout).toBe("stremio")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    // Switching skins stages the new skin + ranked, single Card checked.
    fireEvent.click(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinBlack" }),
    )
    expect(ctx().posterLayout).toBe("nuvio")
    expect(ctx().posterFreshScope).toBe("ranked")
    expect(checkedNames()).toEqual(["ui.posterLayoutGroupedCard"])
    // Badge: Standard + canonical centered writes.
    clickRadio("ui.badgeSection")
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe("pill")
    expect(ctx().ribbonEnabled).toBe(true)
  })

  it("Fresh never rewrites the stored rank style; side stays untouched", async () => {
    const { ctx } = renderTitle({ rankingBadgeStyle: "pill", ribbonEnabled: true, defaultRibbonSide: "left", ribbonSide: "left" })
    await act(async () => {})
    expect(checkedNames()).toEqual(["ui.badgeSection"])
    clickRadio("ui.posterLayoutGroupedFresh")
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().rankingBadgeStyle).toBe("pill")
    expect(ctx().ribbonEnabled).toBe(true)
    expect(ctx().ribbonSide).toBe("left")
    expect(ctx().defaultRibbonSide).toBe("left")
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
  })
})

describe("save transport (edited shape frozen, other shape preserved)", () => {
  it("portrait save carries fresh/ranked/zeroed offsets; landscape profile preserved; no side persisted", async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    const prevMapping = {
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
      posterLayout: "standard",
      posterFreshScope: "ranked",
      genreBadgeOffsetX: 5,
      genreBadgeOffsetY: 6,
      logoOffsetX: 7,
      logoOffsetY: 8,
      landscape: { posterLayout: "standard", posterFreshScope: "ranked", genreBadgeOffsetX: 5 },
    } as unknown as Mapping
    const deps = {
      selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedLogo: null,
      setSelectedLogo: () => {},
      setPreviewPoster: () => {},
      setPreviewId: () => {},
      posters: [],
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: null,
      mdblistAnimeList: [],
      mappingsMap: new Map<string, Mapping>([["movie:1", prevMapping]]),
      loadMappings: async () => {},
      logoScale: 75,
      logoOffsetX: 0,
      logoOffsetY: 0,
      selectedBackdrop: null,
      setSelectedBackdrop: () => {},
      backdropScale: 100,
      backdropOffsetX: 0,
      backdropOffsetY: 0,
      setBackdropScale: () => {},
      setBackdropOffsetX: () => {},
      setBackdropOffsetY: () => {},
      globalBadges: true,
      rankingBadges: true,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
      badgeQuality: true,
      customRatings: true,
      ratingSources: ["imdb", "tmdb"],
      separateRatings: false,
      separateRatingsStyle: "column",
      customBadge: null,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      extraBadgeStyle: null,
      badgeFont: "inter",
      qualityBadgeStyle: "standard",
      videoFormats: null,
      defaultBadgeStyle: "shadow",
      defaultRankingBadgeStyle: "default",
      defaultExtraBadgeStyle: null,
      blurEnabled: true,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      landscapeBlur: {
        gradientHeight: 30, blurIntensity: 20, blurFade: 70,
        blurDarkness: 30, tintStrength: 20, topShade: 50, blurEnabled: true,
      },
      landscapeBlurDirty: false,
      setLandscapeBlur: () => {},
      defaultLogoScale: null,
      defaultLogoOffsetX: null,
      defaultLogoOffsetY: null,
      landscapeDefaults: null,
      tintStrength: 20,
      topShade: 50,
      gradientHeight: 30,
      setGradientHeight: () => {},
      setBlurFade: () => {},
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      qualityBadgeScale: 100,
      separateBadgeScale: 130,
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
      setLogoDisabled: () => {},
      setLogoScale: () => {},
      setLogoOffsetX: () => {},
      setLogoOffsetY: () => {},
      rotationBackdrops: [],
      autoRotateBackdrop: false,
      defaultAutoRotateBackdrop: false,
      excludedBackdrops: [],
      backdrops: [],
      networkLogo: true,
      networkLogoPosition: "auto",
      ribbonEnabled: true,
      lang: "it",
      posterShape: "poster",
      posterLayout: "fresh",
      posterFreshScope: "ranked",
    } as never
    const { result } = renderHook(() => usePosterSave(deps))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    // Edited portrait shape carries the unified Fresh selection.
    expect(mappings[0].body.posterLayout).toBe("fresh")
    expect(mappings[0].body.posterFreshScope).toBe("ranked")
    expect(mappings[0].body.genreBadgeOffsetX).toBe(0)
    expect(mappings[0].body.genreBadgeOffsetY).toBe(0)
    // Other (landscape) shape profile preserved, not clobbered.
    expect(mappings[0].body.landscape).toMatchObject({ posterLayout: "standard", genreBadgeOffsetX: 5 })
    // Saving never promises a side override: no per-title side is persisted.
    expect("ribbonSide" in mappings[0].body).toBe(false)
  })
})
