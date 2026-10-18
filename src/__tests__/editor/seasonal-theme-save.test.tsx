/**
 * Per-title seasonal frame: editor selector -> save -> reopen -> clear.
 * - the BadgeControls selector stages Automatic/None/Halloween/Christmas
 *   into the shared editor state (fail-closed normalization);
 * - the REAL usePosterSave.saveConfig persists the explicit choice as a
 *   flat title-level field (Automatic = absent = follow the list), shared
 *   by both shapes (no landscape profile);
 * - the saved mapping resolves through the production resolver/builders
 *   (poster-config + preview + Stremio), explicit beats list, none
 *   suppresses, absent inherits;
 * - cover-only save clears the choice (style contract, like other visuals).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, renderHook, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import { SeasonalKeywordsSection } from "@/components/SeasonalKeywordsSection"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import { mappingSchema } from "@/lib/validation"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const noop = () => {}

let posted: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  posted = []
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
    const body = (init as { body?: string })?.body
    posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
  }))
})

const SELECTED = {
  id: 7,
  media_type: "movie" as const,
  title: "T",
  name: "T",
  poster_path: "/p.jpg",
}

function renderEditor() {
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

function saveDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
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
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
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
    seasonalTheme: null,
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
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
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
    posterShape: "poster",
    posterLayout: "standard",
    posterFreshScope: "ranked",
    ...overrides,
  } as never
}

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
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
    ...overrides,
  }
}

const basePosterState = {
  selected: { id: 7, media_type: "movie" as const, title: "T", poster_path: "/p.jpg" },
  previewPoster: { file_path: "/p.jpg", iso_639_1: null as string | null, vote_average: 0, width: 500, height: 750 },
  selectedLogo: null,
  selectedBackdrop: null,
  logoScale: 75,
  logoOffsetX: 0,
  logoOffsetY: 0,
  backdropScale: 100,
  backdropOffsetX: 0,
  backdropOffsetY: 0,
  metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
  trendRank: null,
  mdblistAnimeList: [],
  topEdgeColor: null,
  lang: "it",
  tmdbKey: "test-key",
}

const baseBadgeParams = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow" as const,
  rankingBadgeStyle: "default" as const,
  customBadge: null,
  gradientHeight: 30,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  blurEnabled: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
}

describe("editor selector (accessible staging, fail-closed)", () => {
  it("stages Automatic/None/Halloween/Christmas with label and hint", () => {
    const { ctx } = renderEditor()
    const select = screen.getByTestId("seasonal-frame-selector") as HTMLSelectElement
    expect(select.value).toBe("__automatic__")
    expect(screen.getByText("ui.seasonalFrameHint")).toBeTruthy()

    fireEvent.change(select, { target: { value: "halloween" } })
    expect(ctx().seasonalTheme).toBe("halloween")
    fireEvent.change(select, { target: { value: "none" } })
    expect(ctx().seasonalTheme).toBe("none")
    fireEvent.change(select, { target: { value: "christmas" } })
    expect(ctx().seasonalTheme).toBe("christmas")
    fireEvent.change(select, { target: { value: "__automatic__" } })
    expect(ctx().seasonalTheme).toBeNull()
  })

  it("staged choice drives the preview URL over the list context", () => {
    const { ctx } = renderEditor()
    fireEvent.change(screen.getByTestId("seasonal-frame-selector"), { target: { value: "halloween" } })
    const url = new URL(
      buildPreviewUrl(
        { ...basePosterState, seasonalTheme: "christmas", seasonalThemeChoice: ctx().seasonalTheme } as never,
        { posterShape: "poster", ...baseBadgeParams } as never,
      ),
    )
    // Explicit halloween beats the christmas list context.
    expect(url.searchParams.get("theme")).toBe("halloween")
  })

  it("cover-only reset returns the staged choice to Automatic", () => {
    const { ctx } = renderEditor()
    fireEvent.change(screen.getByTestId("seasonal-frame-selector"), { target: { value: "christmas" } })
    expect(ctx().seasonalTheme).toBe("christmas")
    act(() => {
      ctx().resetPerTitleVisuals()
    })
    expect(ctx().seasonalTheme).toBeNull()
    expect((screen.getByTestId("seasonal-frame-selector") as HTMLSelectElement).value).toBe("__automatic__")
  })
})

describe("save boundary (flat, shared shapes, no leakage)", () => {
  async function savedBody(choice: unknown, shape = "poster") {
    const { result } = renderHook(() => usePosterSave(saveDeps({ seasonalTheme: choice, posterShape: shape })))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    return mappings[0].body
  }

  it("persists explicit halloween/christmas/none in portrait and landscape", async () => {
    for (const shape of ["poster", "landscape"]) {
      for (const choice of ["halloween", "christmas", "none"]) {
        posted = []
        const body = await savedBody(choice, shape)
        expect(body.seasonalTheme).toBe(choice)
        expect(body.landscape == null || !("seasonalTheme" in (body.landscape as object))).toBe(true)
        expect(
          mappingSchema.safeParse({ tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p.jpg", seasonalTheme: body.seasonalTheme }).success,
        ).toBe(true)
      }
    }
  })

  it("omits Automatic (absent = follow the list, legacy-identical URLs)", async () => {
    const body = await savedBody(null)
    expect("seasonalTheme" in body).toBe(false)
  })

  it("saved explicit choice resolves on reopen through the production chain", async () => {
    const body = await savedBody("halloween")
    const saved = { tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01", seasonalTheme: body.seasonalTheme }
    // Server render beats a conflicting list query.
    expect(
      resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams("theme=christmas"), mapping: saved as never })).seasonalTheme,
    ).toBe("halloween")
    // Preview carries the saved choice without list context.
    const preview = new URL(
      buildPreviewUrl({ ...basePosterState, seasonalThemeChoice: body.seasonalTheme } as never, { posterShape: "poster", ...baseBadgeParams } as never),
    )
    expect(preview.searchParams.get("theme")).toBe("halloween")
    // Stremio URL carries the saved choice (same title everywhere).
    const stremio = buildStremioPosterUrl({ origin: "http://localhost:3000", type: "movie", id: 7, defaults: {}, mapping: saved as never, seasonalTheme: "halloween" })
    expect(stremio.searchParams.get("theme")).toBe("halloween")
  })

  it("cover-only save clears the choice (style contract, no leakage)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: { tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p.jpg", updatedAt: "x", seasonalTheme: "halloween" } as never,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body).not.toBeNull()
    expect("seasonalTheme" in (body as Record<string, unknown>)).toBe(false)
  })
})

describe("keyword input Escape (cancel never commits the stale draft)", () => {
  // Regression: onKeyDown Escape reset the draft via setDraft (async) then
  // blurred, and the onBlur closure committed the OLD draft — the canceled
  // edit was saved. The cancel ref is visible to the pending blur regardless
  // of closure, so Escape only resets.
  function mountKeywords(onCommit: (keywords: string[]) => void) {
    renderWithCtx(createElement(SeasonalKeywordsSection), {
      seasonalHalloweenKeywords: [],
      setSeasonalHalloweenKeywords: onCommit,
    } as never)
    return screen.getByLabelText("ui.seasonalHalloweenKeywords") as HTMLInputElement
  }

  it("Escape resets the draft without committing", () => {
    const onCommit = vi.fn()
    const input = mountKeywords(onCommit)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "spooky night" } })
    expect(input.value).toBe("spooky night")
    fireEvent.keyDown(input, { key: "Escape" })
    // The handler blurs by itself; force the blur event deterministically:
    // pre-fix this commits the canceled draft (RED), post-fix it is skipped.
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe("")
  })

  it("Enter/blur still commits the edit", () => {
    const onCommit = vi.fn()
    const input = mountKeywords(onCommit)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "spooky night" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(["spooky night"])
  })
})

describe("settings catalogs entry (Settings -> Catalogs)", () => {
  // Agreed placement: Settings hosts a Catalogs tab exposing the same
  // SeasonalKeywordsSection plus a link to the catalog manager (whose single
  // owner stays CataloghiView — no duplicate modal owners/ids).
  it("reaches seasonal frames from the Catalogs tab", () => {
    renderWithCtx(
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
    )
    // Secondary tabs render as buttons (primary tabs are role=tab).
    const tab = screen.getByRole("button", { name: "ui.catalogsTitle" })
    fireEvent.click(tab)
    expect(screen.getByText("ui.seasonalKeywordsTitle")).toBeTruthy()
    expect(screen.getByTestId("settings-open-catalog-manager")).toBeTruthy()
  })
})

describe("SeasonalKeywordsSection co-mount (Settings + CatalogManager)", () => {
  // Regression: fixed IDs collided when Settings and the catalog manager
  // mounted the section twice in the same DOM. Each instance now scopes its
  // title/input/hint IDs via useId; labels and hints stay correctly
  // associated per instance and test selectors keep using roles.
  it("renders two instances with unique IDs and correctly associated labels/hints", () => {
    const { container } = renderWithCtx(
      createElement(
        "div",
        null,
        createElement(SeasonalKeywordsSection),
        createElement(SeasonalKeywordsSection),
      ),
    )
    const halloweenInputs = screen.getAllByLabelText(
      "ui.seasonalHalloweenKeywords",
    ) as HTMLInputElement[]
    const christmasInputs = screen.getAllByLabelText(
      "ui.seasonalChristmasKeywords",
    ) as HTMLInputElement[]
    expect(halloweenInputs).toHaveLength(2)
    expect(christmasInputs).toHaveLength(2)
    const inputs = [...halloweenInputs, ...christmasInputs]
    // Every input carries a distinct id (no DOM collision).
    const inputIds = inputs.map((el) => el.id)
    expect(new Set(inputIds).size).toBe(inputIds.length)
    for (const input of inputs) {
      // Label association survives the scoping (role-based queries pass).
      const label = container.querySelector(`label[for="${input.id}"]`)
      expect(label).not.toBeNull()
      // Hint association survives: aria-describedby points at the own hint.
      expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-hint`)
      expect(document.getElementById(`${input.id}-hint`)).not.toBeNull()
    }
    // Section titles are unique and each section points at its own title.
    const titleEls = Array.from(
      container.querySelectorAll("section[aria-labelledby] h4[id]"),
    )
    expect(titleEls).toHaveLength(2)
    const titleIds = titleEls.map((el) => el.getAttribute("id") as string)
    expect(new Set(titleIds).size).toBe(titleIds.length)
    const sections = Array.from(container.querySelectorAll("section[aria-labelledby]"))
    expect(sections).toHaveLength(2)
    for (const section of sections) {
      const labelledBy = section.getAttribute("aria-labelledby") as string
      expect(titleIds).toContain(labelledBy)
      expect(document.getElementById(labelledBy)).not.toBeNull()
    }
    // No duplicate id attribute anywhere in the co-mounted tree.
    const allIds = Array.from(container.querySelectorAll("[id]")).map((el) =>
      el.getAttribute("id"),
    )
    expect(new Set(allIds).size).toBe(allIds.length)
  })
})
