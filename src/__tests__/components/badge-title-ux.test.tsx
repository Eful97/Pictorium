/**
 * Per-title badge UX: rank appearance vs title-info style, coherent with the
 * global defaults (no new models). Master is the top badge (single winner,
 * never rank-only); side stays global-only so per-title preview always
 * matches Stremio. Rank edits freeze the legacy extra look on click only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import {
  legacyExtraStyleForRank,
  rankVariantValue,
  rankingAppearanceValue,
  resolveRankingAppearance,
  resolveRibbonVariant,
  ribbonVariantValue,
} from "@/components/RankingAppearanceSelector"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { resolveTopBadgeStyle } from "@/lib/poster-service"
import { buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { renderHook } from "@testing-library/react"
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

function seed(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

function renderTitle(seedObj: Record<string, unknown> = {}) {
  seed(seedObj)
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null, createElement(BadgeControls), createElement(Probe)),
    { selected: SELECTED as never },
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function appearanceGroup(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "ui.rankFamily" })
}

function clickRadio(group: HTMLElement, name: string) {
  fireEvent.click(within(group).getByRole("radio", { name }))
}

function badgeSwitch(name: string): HTMLElement {
  return screen.getByRole("switch", { name })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

describe("master top badge + rank/title-info split", () => {
  it("master is Badge superiore (single topBadge): no sash, no classifica-only framing", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    // Master renamed: Top badge, not Trend.
    expect(badgeSwitch("ui.topBadge")).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "ui.trendBadge" })).toBeNull()
    expect(screen.getByText("ui.singleBadgeHint")).toBeInTheDocument()
    // No per-title sash categories (stay global in Settings).
    for (const sash of ["ui.sash_rank", "ui.sash_upcoming", "ui.sash_new", "ui.sash_award", "ui.sash_extra"]) {
      expect(screen.queryByRole("switch", { name: sash })).toBeNull()
    }
    expect(screen.queryByText("ui.advancedBadgePriority")).toBeNull()
    // Toggling the master preserves styles (single winner gate, not a reset).
    const beforeRs = ctx().rankingBadgeStyle
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().rankingBadges).toBe(false)
    expect(ctx().rankingBadgeStyle).toBe(beforeRs)
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().rankingBadges).toBe(true)
  })

  it("old ribbon toggle + ranking/extra style selector are gone; shared selector owns the rank", async () => {
    renderTitle({})
    await act(async () => {})
    expect(screen.queryByRole("switch", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByText("ui.styleRankingExtra")).toBeNull()
    // Shared appearance: three choices + variant row, no side row here.
    const group = appearanceGroup()
    expect(within(group).getAllByRole("radio")).toHaveLength(3)
    expect(screen.getByText("ui.rankFamily")).toBeInTheDocument()
    expect(screen.getByText("ui.titleInfoFamily")).toBeInTheDocument()
    expect(screen.getByText("ui.extraBadgeStyle")).toBeInTheDocument()
  })

  it("appearance clicks write canonical rs+ribbon; colored/standard switch ribbon off, numero keeps it on", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    const group = appearanceGroup()
    clickRadio(group, "ui.number")
    expect(ctx().rankingBadgeStyle).toBe("number")
    expect(ctx().ribbonEnabled).toBe(true)
    clickRadio(group, "ui.ribbon")
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    expect(ctx().ribbonEnabled).toBe(true)
    clickRadio(group, "ui.badgeSection")
    expect(ctx().rankingBadgeStyle).toBe("pill")
    expect(ctx().ribbonEnabled).toBe(true)
    // Variants: renderer truth (colored/standard switch ribbon off).
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.colored" }))
    expect(ctx().rankingBadgeStyle).toBe("colored")
    expect(ctx().ribbonEnabled).toBe(false)
    expect(resolveRankingAppearance({ rankingBadgeStyle: "colored", ribbonEnabled: false })).toBe("badge")
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.qbsStandard" }))
    expect(ctx().rankingBadgeStyle).toBe("default")
    expect(ctx().ribbonEnabled).toBe(false)
    // Pure helpers (actual branches): standard = default+ribbon false, numero true.
    expect(rankVariantValue("standard")).toEqual({ rankingBadgeStyle: "default", ribbonEnabled: false })
    expect(rankVariantValue("colored")).toEqual({ rankingBadgeStyle: "colored", ribbonEnabled: false })
    expect(rankingAppearanceValue("numero")).toEqual({ rankingBadgeStyle: "number", ribbonEnabled: true })
  })
})

describe("extra independence + legacy freeze on click only", () => {
  it("mount/read never migrates: null stays null, inherited hint shows the legacy look", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    expect(ctx().extraBadgeStyle).toBeNull()
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.extraBadgeStyle ?? null).toBeNull()
    expect(stored.defaultExtraBadgeStyle ?? null).toBeNull()
    expect(screen.getByText("ui.inherited", { exact: false })).toBeInTheDocument()
  })

  it("first rank change materializes the legacy extra look; later extras stay independent", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    expect(ctx().extraBadgeStyle).toBeNull()
    clickRadio(appearanceGroup(), "ui.badgeSection")
    expect(ctx().rankingBadgeStyle).toBe("pill")
    expect(ctx().extraBadgeStyle).toBe(legacyExtraStyleForRank("default"))
    // Explicit extra choice sticks independently from later rs changes.
    const extraBlock = screen.getByText("ui.extraBadgeStyle").closest("div") as HTMLElement
    fireEvent.click(within(extraBlock).getByText("ui.vetro"))
    expect(ctx().extraBadgeStyle).toBe("vetro")
    clickRadio(appearanceGroup(), "ui.number")
    expect(ctx().rankingBadgeStyle).toBe("number")
    expect(ctx().extraBadgeStyle).toBe("vetro")
  })

  it("legacy fallback preserved: null extra renders with rs (single topBadge, no second logic)", async () => {
    renderTitle({})
    await act(async () => {})
    // Extra without xbs shares the rs look (legacy); explicit xbs detaches it.
    expect(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: null })).toBe("netflix")
    expect(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner" })).toBe("corner")
    expect(resolveTopBadgeStyle({ topBadgeType: "rank", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner" })).toBe("netflix")
    const input: PosterRenderConfigInput = {
      searchParams: new URLSearchParams(),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    }
    expect(resolvePosterRenderConfig(input).extraBadgeStyle).toBeNull()
  })
})

describe("side is global-only (no per-title side control)", () => {
  it("per-title exposes no side switch; rank edits never touch side or defaults", async () => {
    const { ctx } = renderTitle({ defaultRibbonSide: "left", ribbonSide: "left" })
    await act(async () => {})
    // Current side mirrors the default (loaded on open); no switch to change it.
    expect(ctx().ribbonSide).toBe("left")
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    const group = appearanceGroup()
    clickRadio(group, "ui.number")
    clickRadio(group, "ui.ribbon")
    clickRadio(group, "ui.badgeSection")
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.colored" }))
    expect(ctx().ribbonSide).toBe("left")
    expect(ctx().defaultRibbonSide).toBe("left")
  })

  it("position note points at Settings while the side row stays hidden", async () => {
    renderTitle({})
    await act(async () => {})
    // Nastro selected by default: note visible instead of the side switch.
    expect(screen.getByText("ui.ribbonPosition", { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    clickRadio(appearanceGroup(), "ui.badgeSection")
    expect(screen.queryByText("ui.ribbonPosition", { exact: false })).toBeNull()
  })

  it("preview and Stremio agree on the effective default side; save promises no override", async () => {
    // Seed mirrors the context load: current side follows the default.
    const { ctx } = renderTitle({ defaultRibbonSide: "right", ribbonSide: "right", extraBadgeStyle: "corner", rankingBadgeStyle: "netflix" })
    await act(async () => {})
    expect(ctx().ribbonSide).toBe(ctx().defaultRibbonSide)
    const bp = {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow" as const,
      rankingBadgeStyle: ctx().rankingBadgeStyle,
      extraBadgeStyle: ctx().extraBadgeStyle,
      customBadge: null,
      gradientHeight: 30,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      blurEnabled: true,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeScale: 100,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoScale: 100,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
      ribbonSide: ctx().ribbonSide,
      ribbonEnabled: ctx().ribbonEnabled,
    }
    const ps = {
      selected: { id: 1, media_type: "movie" as const, poster_path: "/p.jpg" },
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
      lang: "it",
      tmdbKey: "",
    }
    const url = new URL(buildPreviewUrl(ps, bp))
    expect(url.searchParams.get("side")).toBe("right")
    expect(url.searchParams.get("xbs")).toBe("corner")
    expect(url.searchParams.get("rs")).toBe("netflix")
    // Legacy URL without extra stays byte-identical (no xbs).
    const legacy = new URL(buildPreviewUrl(ps, { ...bp, extraBadgeStyle: null }))
    expect(legacy.searchParams.has("xbs")).toBe(false)
    // Server parser ignores historical mapping sides (existing contract).
    const mapping = {
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
      ribbonSide: "right",
    } as unknown as Mapping
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(),
      mapping,
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfg.ribbonSide).toBe("left")
    // Same effective default side: preview and Stremio render it equally.
    const stremioRight = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 1, defaults: { ribbonSide: "right" }, mapping })
    expect(stremioRight.searchParams.get("side")).toBe(url.searchParams.get("side"))
    // Stremio carries only the global side, never the per-title one.
    const stremio = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping })
    expect(stremio.searchParams.get("side")).toBeNull()
  })

  it("save payload freezes per-title rank+extra; defaults untouched", async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    const deps = {
      selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedLogo: null,
      setSelectedLogo: () => {},
      setPreviewPoster: () => {},
      setPreviewId: () => {},
      posters: [],
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
      trendRank: null,
      mdblistAnimeList: [],
      mappingsMap: new Map<string, Mapping>(),
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
      rankingBadgeStyle: "pill",
      extraBadgeStyle: "corner",
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
    } as never
    const { result } = renderHook(() => usePosterSave(deps))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.rankingBadgeStyle).toBe("pill")
    expect(mappings[0].body.extraBadgeStyle).toBe("corner")
    expect(mappings[0].body.defaultExtraBadgeStyle).toBeNull()
    // Saving never promises a side override: no per-title side is persisted.
    expect("ribbonSide" in mappings[0].body).toBe(false)
  })
})

describe("extras reachable with genre/rating off", () => {
  it("globalBadges OFF hides genre/year only; rank appearance + extra stay", async () => {
    renderTitle({ globalBadges: false })
    await act(async () => {})
    expect(screen.queryByText("ui.badgeGenre")).toBeNull()
    expect(screen.getByText("ui.extraBadgeStyle")).toBeInTheDocument()
    expect(appearanceGroup()).toBeInTheDocument()
    expect(badgeSwitch("ui.topBadge")).toBeInTheDocument()
  })
})

describe("nastro standard/colorato per-title (U1)", () => {
  function ribbonGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.ribbon" })
  }

  function ribbonRadio(group: HTMLElement, name: string): HTMLElement {
    return within(group).getByRole("radio", { name })
  }

  it("ribbon row shows Standard checked by default; no side switch per-title", async () => {
    renderTitle({})
    await act(async () => {})
    // Nastro selected by default: sub-row visible, Standard checked.
    const ribbon = ribbonGroup()
    expect(within(ribbon).getAllByRole("radio")).toHaveLength(2)
    expect(ribbonRadio(ribbon, "ui.qbsStandard")).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
  })

  it("ribbon clicks write per-title canonical pairs; side and defaults untouched", async () => {
    const { ctx } = renderTitle({ defaultRankingBadgeStyle: "default", defaultRibbonSide: "left", ribbonSide: "left" })
    await act(async () => {})
    const ribbon = ribbonGroup()
    fireEvent.click(ribbonRadio(ribbon, "ui.colored"))
    expect(ctx().rankingBadgeStyle).toBe("colored")
    expect(ctx().ribbonEnabled).toBe(true)
    expect(ribbonRadio(ribbon, "ui.colored")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(ribbonRadio(ribbon, "ui.qbsStandard"))
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    expect(ctx().ribbonEnabled).toBe(true)
    // Per-title edits never touch the side or the global defaults.
    expect(ctx().ribbonSide).toBe("left")
    expect(ctx().defaultRibbonSide).toBe("left")
    expect(ctx().defaultRankingBadgeStyle).toBe("default")
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
  })

  it("seeded colored reads Nastro/Colorato; legacy netflix-color reads Nastro/Standard; no migration", async () => {
    const seeded = renderTitle({ rankingBadgeStyle: "colored", ribbonEnabled: true })
    await act(async () => {})
    expect(within(appearanceGroup()).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
    expect(ribbonRadio(ribbonGroup(), "ui.colored")).toHaveAttribute("aria-checked", "true")
    expect(seeded.ctx().rankingBadgeStyle).toBe("colored")
    expect(seeded.ctx().extraBadgeStyle).toBeNull()
  })

  it.each(["netflix", "netflix-color", "default"] satisfies string[])(
    "legacy per-title %s+ribbon reads Nastro/Standard and keeps the stored value",
    async (rs) => {
      const seeded = renderTitle({ rankingBadgeStyle: rs, ribbonEnabled: true })
      await act(async () => {})
      expect(within(appearanceGroup()).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
      expect(ribbonRadio(ribbonGroup(), "ui.qbsStandard")).toHaveAttribute("aria-checked", "true")
      expect(seeded.ctx().rankingBadgeStyle).toBe(rs)
      expect(seeded.ctx().extraBadgeStyle).toBeNull()
    },
  )

  it("pure ribbon helpers (actual per-title branches)", () => {
    expect(resolveRibbonVariant("colored")).toBe("colored")
    expect(resolveRibbonVariant("netflix")).toBe("standard")
    expect(resolveRibbonVariant("netflix-color")).toBe("standard")
    expect(ribbonVariantValue("standard")).toEqual({ rankingBadgeStyle: "netflix", ribbonEnabled: true })
    expect(ribbonVariantValue("colored")).toEqual({ rankingBadgeStyle: "colored", ribbonEnabled: true })
  })

  it("ribbon variants roundtrip through the actual render config", () => {
    const roundtrip = (rs: string, ribbon: boolean) => {
      const r = resolvePosterRenderConfig({
        searchParams: new URLSearchParams({ rank: "3" }),
        mapping: null,
        configOverride: null,
        sd: { rankingBadgeStyle: rs as never, ribbonEnabled: ribbon },
        hasQuery: true,
        showBadges: true,
        rankingBadges: true,
        animeRank: null,
        rankingResult: null,
        finalRank: null,
      })
      return { style: r.rankingBadgeStyle, accent: r.rankingBadgeAccent }
    }
    expect(roundtrip(...Object.values(ribbonVariantValue("standard")) as [string, boolean])).toEqual({ style: "netflix", accent: false })
    expect(roundtrip(...Object.values(ribbonVariantValue("colored")) as [string, boolean])).toEqual({ style: "colored", accent: false })
  })

  it("first ribbon change materializes the legacy extra look; later extras stay independent", async () => {
    const { ctx } = renderTitle({})
    await act(async () => {})
    expect(ctx().extraBadgeStyle).toBeNull()
    fireEvent.click(ribbonRadio(ribbonGroup(), "ui.colored"))
    expect(ctx().rankingBadgeStyle).toBe("colored")
    expect(ctx().extraBadgeStyle).toBe(legacyExtraStyleForRank("default"))
    const extraBlock = screen.getByText("ui.extraBadgeStyle").closest("div") as HTMLElement
    fireEvent.click(within(extraBlock).getByText("ui.vetro"))
    expect(ctx().extraBadgeStyle).toBe("vetro")
    fireEvent.click(ribbonRadio(ribbonGroup(), "ui.qbsStandard"))
    expect(ctx().rankingBadgeStyle).toBe("netflix")
    expect(ctx().extraBadgeStyle).toBe("vetro")
  })
})

