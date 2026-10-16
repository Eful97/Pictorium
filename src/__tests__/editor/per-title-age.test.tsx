/**
 * Per-title age classification (Classificazione età nei poster singoli).
 *
 * Contract under test: the single-title editor supports the same age
 * activation/country/style choices as the global defaults, independently per
 * portrait/landscape shape, with preview/save/reopen/Stremio/direct/live
 * consistent. Old saved posters without age fields keep following the
 * shape-effective global defaults (no migration on read/open); explicit OFF
 * beats an ON default; per-title concrete country/style win; null/absent
 * inherit; invalid countries fail closed (IT chain, never cross-country).
 * No new URL names (age/agecountry/agebs already exist); same renderer.
 */
import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import {
  MAPPING_SHAPE_LAND_KEYS,
  MAPPING_SHAPE_FACTORY,
  mappingShapeChainEffective,
  snapshotMissingMappingLandscape,
} from "@/lib/visual-presets"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { usePosterSave } from "@/lib/usePosterSave"
import { BadgeControls } from "@/components/BadgeControls"
import EditView from "@/components/EditView"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { SearchResult, TMDBImage } from "@/lib/types"
import type { ServerDefaults } from "@/lib/server-defaults"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const noop = () => {}

function sdBase(over: Record<string, unknown> = {}): ServerDefaults {
  return {
    ageBadge: false,
    ageCountry: "IT",
    ageBadgeStyle: "standard",
    ...over,
  } as unknown as ServerDefaults
}

describe("resolveAgeBadgeRequest with per-title mapping", () => {
  it("explicit mapping OFF beats an ON shape default (no false fetch)", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      sdBase({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" }),
      sdBase({ ageBadge: true }),
      { ageBadge: false } as never,
    )
    expect(r.ageBadge).toBe(false)
  })

  it("explicit mapping ON beats an OFF shape default, country/style win", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      sdBase({ ageBadge: false }),
      sdBase({ ageBadge: false }),
      { ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" } as never,
    )
    expect(r).toEqual({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" })
  })

  it("null/absent mapping fields inherit the shape-effective defaults", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      sdBase({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" }),
      sdBase({ ageBadge: false }),
      { ageBadge: null, ageCountry: null, ageBadgeStyle: null } as never,
    )
    expect(r).toEqual({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" })
    const absent = resolveAgeBadgeRequest(new URLSearchParams(), null, sdBase({ ageBadge: true }), sdBase(), null)
    expect(absent.ageBadge).toBe(true)
  })

  it("invalid mapping country fail-closes to the defaults chain, never cross-country", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      sdBase({ ageBadge: true, ageCountry: "DE" }),
      sdBase(),
      { ageBadge: true, ageCountry: "USA" } as never,
    )
    expect(r.ageCountry).toBe("DE")
    const global = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      sdBase({ ageBadge: true }),
      sdBase(),
      { ageBadge: true, ageCountry: "GLOBAL" } as never,
    )
    expect(global.ageCountry).toBe("IT")
  })

  it("query still wins over the per-title mapping", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams({ age: "0", agecountry: "ES", agebs: "standard" }),
      null,
      sdBase({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" }),
      sdBase(),
      { ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" } as never,
    )
    expect(r).toEqual({ ageBadge: false, ageCountry: "ES", ageBadgeStyle: "standard" })
  })

  it("query present-but-invalid style stays fail-closed standard over a mapping knockout", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams({ agebs: "garbage" }),
      null,
      sdBase(),
      sdBase(),
      { ageBadge: true, ageBadgeStyle: "knockout" } as never,
    )
    expect(r.ageBadgeStyle).toBe("standard")
  })
})

describe("per-title age mapping overlay", () => {
  const base: Mapping = {
    tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
    logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  }

  it("MAPPING_SHAPE_LAND_KEYS owns the age trio with canonical factory values", () => {
    for (const k of ["ageBadge", "ageCountry", "ageBadgeStyle"] as const) {
      expect(MAPPING_SHAPE_LAND_KEYS).toContain(k)
    }
    expect(MAPPING_SHAPE_FACTORY.ageBadge).toBe(false)
    expect(MAPPING_SHAPE_FACTORY.ageCountry).toBe("IT")
    expect(MAPPING_SHAPE_FACTORY.ageBadgeStyle).toBe("standard")
  })

  it("mappingShapeChainEffective resolves the age trio chain-correct", () => {
    expect(mappingShapeChainEffective("ageBadge", { ageBadge: true }, null)).toEqual({ known: true, value: true })
    expect(mappingShapeChainEffective("ageBadge", { ageBadge: false }, null)).toEqual({ known: true, value: false })
    // Unknown provenance (neither level knows the key) stays sparse by
    // design — the boundary keeps the legacy factory/skip fallback, never a
    // guess over the edited live value.
    expect(mappingShapeChainEffective("ageBadge", {}, null)).toEqual({ known: false })
    expect(mappingShapeChainEffective("ageCountry", { ageCountry: "FR" }, null)).toEqual({ known: true, value: "FR" })
    expect(mappingShapeChainEffective("ageCountry", { ageCountry: "GLOBAL" }, null)).toEqual({ known: true, value: "IT" })
    expect(mappingShapeChainEffective("ageBadgeStyle", { ageBadgeStyle: "knockout" }, null)).toEqual({ known: true, value: "knockout" })
    expect(mappingShapeChainEffective("ageBadgeStyle", { ageBadgeStyle: "garbage" }, null)).toEqual({ known: true, value: "standard" })
  })

  it("effectiveMappingForShape overlays the landscape age profile per key", () => {
    const m: Mapping = {
      ...base,
      ageBadge: true, ageCountry: "IT", ageBadgeStyle: "standard",
      landscape: { ageBadge: false, ageCountry: "FR", ageBadgeStyle: "knockout" },
    }
    const land = effectiveMappingForShape(m, "landscape")
    expect(land?.ageBadge).toBe(false)
    expect(land?.ageCountry).toBe("FR")
    expect(land?.ageBadgeStyle).toBe("knockout")
    const portrait = effectiveMappingForShape(m, "poster")
    expect(portrait?.ageBadge).toBe(true)
    expect(portrait?.ageCountry).toBe("IT")
    // Absent profile inherits the flat (legacy mappings unchanged).
    const legacy = effectiveMappingForShape({ ...base, ageBadge: true }, "landscape")
    expect(legacy?.ageBadge).toBe(true)
  })

  it("portrait-save backfill freezes the pre-edit chain value for the age trio", () => {
    // Defaults ON, saved flat absent: an explicit OFF edit must freeze ON
    // into the landscape profile so the other shape keeps its look.
    const adds = snapshotMissingMappingLandscape({ ageBadge: false }, {})
    expect(adds.ageBadge).toBe(false)
  })

  it("validation accepts the age trio flat and in the landscape profile", () => {
    const parsed = mappingSchema.parse({
      ...base,
      ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout",
      landscape: { ageBadge: false, ageCountry: "DE", ageBadgeStyle: "standard" },
    })
    expect(parsed.ageBadge).toBe(true)
    expect(parsed.ageCountry).toBe("FR")
    expect(parsed.landscape?.ageBadge).toBe(false)
    expect(parsed.landscape?.ageCountry).toBe("DE")
    // Legacy mappings without age keys stay valid (no migration on read).
    const legacy = mappingSchema.parse({ ...base })
    expect("ageBadge" in legacy).toBe(false)
  })
})

describe("Stremio builder uses the effective per-title age", () => {
  const defaults = sdBase({ posterShape: "poster" })
  const mapping = (partial: Partial<Mapping>): Mapping => ({
    tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p.jpg",
    logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
    ...partial,
  })

  it("per-title ON beats space OFF (age=1 travels, server resolves the rest)", () => {
    const url = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 7, defaults, mapping: mapping({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" }) })
    expect(url.searchParams.get("age")).toBe("1")
    expect(url.searchParams.get("agecountry")).toBe("FR")
    expect(url.searchParams.get("agebs")).toBe("knockout")
  })

  it("per-title OFF beats space ON (no age=1; the saved mapping resolves OFF server-side)", () => {
    const on = sdBase({ posterShape: "poster", ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" })
    const url = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 7, defaults: on, mapping: mapping({ ageBadge: false }) })
    expect(url.searchParams.get("age")).not.toBe("1")
  })

  it("legacy mapping without age keys follows the space defaults byte-identically", () => {
    const off = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 7, defaults, mapping: mapping({}) })
    expect(off.searchParams.get("age")).not.toBe("1")
    expect(off.searchParams.has("agecountry")).toBe(false)
    expect(off.searchParams.has("agebs")).toBe(false)
  })
})

function saveDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: null, voteAverage: 0, width: 500, height: 750 },
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
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
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
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
    badgePresetId: null,
    badgePresetRev: null,
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
      gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 70,
      blurDarkness: 30, tintStrength: 20, topShade: 50, topShadeHeight: 25,
    },
    landscapeBlurDirty: false,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    topShadeHeight: 25,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    extraBadgeScale: null,
    extraBadgeOffsetX: null,
    extraBadgeOffsetY: null,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 130,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
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
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    logoScaleExplicit: true,
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: true,
    networkLogoPosition: "auto",
    networkLogoFollowTitle: true,
    ribbonEnabled: true,
    lang: "it",
    episodeGroupId: null,
    posterShape: "poster",
    posterLayout: "standard",
    posterFreshScope: "ranked",
    defaultSashOrder: null,
    ...overrides,
  } as never
}

describe("per-title age save boundary", () => {
  let posted: { url: string; body: Record<string, unknown> }[]
  beforeEach(() => {
    posted = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
  })

  function mappingPosts() {
    return posted.filter((p) => String(p.url).includes("/api/mappings"))
  }

  it("portrait save freezes the live age trio in the flat and backfills the chain into the profile", async () => {
    const { result } = renderHook(() => usePosterSave(saveDeps({
      ageBadge: true,
      ageCountry: "FR",
      ageBadgeStyle: "knockout",
      defaultAgeBadge: false,
      defaultAgeCountry: "IT",
      defaultAgeBadgeStyle: "standard",
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.ageBadge).toBe(true)
    expect(posts[0].body.ageCountry).toBe("FR")
    expect(posts[0].body.ageBadgeStyle).toBe("knockout")
    // The unvisited landscape keeps following the OFF/IT/standard chain.
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.ageBadge).toBe(false)
    expect(land.ageCountry).toBe("IT")
    expect(land.ageBadgeStyle).toBe("standard")
  })

  it("landscape save preserves the portrait age flat verbatim", async () => {
    const prev: Mapping = {
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
      ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout",
    }
    const { result } = renderHook(() => usePosterSave(saveDeps({
      posterShape: "landscape",
      ageBadge: false,
      ageCountry: "DE",
      ageBadgeStyle: "standard",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.ageBadge).toBe(true)
    expect(posts[0].body.ageCountry).toBe("FR")
    expect(posts[0].body.ageBadgeStyle).toBe("knockout")
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.ageBadge).toBe(false)
    expect(land.ageCountry).toBe("DE")
    expect(land.ageBadgeStyle).toBe("standard")
  })
})

const SELECTED = { id: 1, media_type: "movie" as const, title: "T", name: "T", poster_path: "/p.jpg" }

function renderEditor(seedObj: Record<string, unknown> = {}) {
  localStorage.setItem("badgeDefaults", JSON.stringify(seedObj))
  renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
}

describe("per-title age editor control", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })

  it("shows the per-title age toggle inside the quality family with country/style details", () => {
    renderEditor()
    const quality = screen.getByTestId("badge-family-quality")
    const toggle = within(quality).getByRole("switch", { name: "ui.ageBadge" })
    expect(toggle).toBeInTheDocument()
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    // Details hidden until enabled (same pattern as the global defaults card).
    expect(within(quality).queryByLabelText("ui.ageBadgeCountry")).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(within(quality).getByLabelText("ui.ageBadgeCountry")).toBeInTheDocument()
    expect(within(quality).getByText("ui.ageBadgeStyle")).toBeInTheDocument()
  })
})

function ageImg(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const AGE_ITEM: SearchResult = { id: 303, media_type: "movie", title: "Gamma", poster_path: "/g.jpg" }

function renderAgeSwitchableEditor(first: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  function AgeProbe() {
    const e = usePosterEditor()
    useEffect(() => {
      capture.ed = e
    })
    return null
  }
  function Host({ over }: { over: Record<string, unknown> }) {
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={{ ...MOCK_CTX, ...over }}>
            <EditView />
            <AgeProbe />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host over={first} />)
  return {
    ...view,
    editor: () => capture.ed as PosterEditorCtx,
  }
}

describe("mounted EditView age shape-switch independence (real handler)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("unsaved title: portrait and landscape keep their own staged age look", async () => {
    const u = userEvent.setup()
    const first = {
      selected: AGE_ITEM,
      posters: [ageImg("/g.jpg", null)],
      previewPoster: ageImg("/g.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor } = renderAgeSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Shape-effective defaults: portrait ON/US/knockout, landscape OFF/IT/standard.
    // Live set explicitly (same pattern as the badge switch suites — the
    // mounted harness opens without navigation, so defaults propagation is
    // gated; the unmapped live-follow path is covered by the preview suites).
    await act(async () => {
      editor().setDefaultAgeBadge(true)
      editor().setDefaultAgeCountry("US")
      editor().setDefaultAgeBadgeStyle("knockout")
      editor().setLandscape({ ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" })
      editor().setAgeBadge(true)
      editor().setAgeCountry("US")
      editor().setAgeBadgeStyle("knockout")
    })
    await waitFor(() => expect(editor().ageCountry).toBe("US"))
    expect(editor().ageBadge).toBe(true)
    // Stage a portrait edit (OFF stays staged for portrait).
    await act(async () => {
      editor().setAgeBadge(false)
    })
    // Real handler: switch to landscape — staged portrait must not leak in.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().ageBadge).toBe(false)
    expect(editor().ageCountry).toBe("IT")
    expect(editor().ageBadgeStyle).toBe("standard")
    // Stage a landscape-only country edit.
    await act(async () => {
      editor().setAgeCountry("DE")
    })
    expect(editor().ageCountry).toBe("DE")
    // Back to portrait: the staged portrait look returns, landscape DE stays out.
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    expect(editor().ageBadge).toBe(false)
    expect(editor().ageCountry).toBe("US")
    // And forth again: the staged landscape look returns.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().ageBadge).toBe(false)
    expect(editor().ageCountry).toBe("DE")
  })
})
