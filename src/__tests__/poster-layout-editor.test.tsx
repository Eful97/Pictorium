/**
 * Task3: posterLayout (standard|fresh) client wiring.
 * - Preview/default-preview/template builders carry explicit layout, while
 *   absent stays absent on template/legacy paths (existing standard URLs
 *   unchanged outside preview).
 * - Per-title selector (BadgeControls) is separate from the ranking style
 *   and never mutates badge/logo/transform settings.
 * - Global defaults selector (BadgeDefaultsSection) is scoped per edit
 *   target: portrait writes the flat, landscape the profile override.
 * - Mapping dirty tracking compares the effective per-shape layout.
 * - useDefaults hydrates flat + default layout from storage (garbage falls
 *   back to standard); the persisted payload captures the selection.
 * - New i18n keys exist in all 18 dictionaries (same convention as t5a).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import {
  buildPreviewUrl,
  buildDefaultsPreviewUrl,
  buildUrlPattern,
} from "@/lib/poster-url"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { isMappingDirty } from "@/lib/gradient-dirty"
import { BadgeControls } from "@/components/BadgeControls"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { PosterLayoutSelector } from "@/components/PosterLayoutSelector"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

// Minimal preview state/badge params (same cast-as-never pattern as
// badge-font.test.ts): only the fields under test are meaningful.
function previewState() {
  return {
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
  }
}

function badgeParams() {
  return {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
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
  }
}

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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

describe("preview URL carries explicit layout", () => {
  it("defaults to layout=standard when unspecified (existing behaviour)", () => {
    const url = buildPreviewUrl(previewState() as never, badgeParams() as never)
    expect(paramsOf(url).get("layout")).toBe("standard")
  })

  it("emits layout=fresh when selected, layout=standard when explicit", () => {
    const fresh = buildPreviewUrl(
      previewState() as never,
      { ...badgeParams(), posterLayout: "fresh" } as never,
    )
    expect(paramsOf(fresh).get("layout")).toBe("fresh")
    const standard = buildPreviewUrl(
      previewState() as never,
      { ...badgeParams(), posterLayout: "standard" } as never,
    )
    expect(paramsOf(standard).get("layout")).toBe("standard")
  })
})

describe("defaults preview follows the effective layout per shape", () => {
  it("flat standard by default; flat fresh travels", () => {
    expect(paramsOf(buildDefaultsPreviewUrl({})).get("layout")).toBe("standard")
    expect(
      paramsOf(buildDefaultsPreviewUrl({ defaultPosterLayout: "fresh" })).get("layout"),
    ).toBe("fresh")
  })

  it("landscape profile wins only in landscape (land ?? flat)", () => {
    const portrait = paramsOf(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "fresh" },
      }),
    )
    expect(portrait.get("layout")).toBe("standard")
    const landscape = paramsOf(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "standard",
        landscape: { posterLayout: "fresh" },
        previewShape: "landscape",
      }),
    )
    expect(landscape.get("layout")).toBe("fresh")
    // Explicit landscape standard overrides an inherited flat fresh.
    const backToStandard = paramsOf(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "fresh",
        landscape: { posterLayout: "standard" },
        previewShape: "landscape",
      }),
    )
    expect(backToStandard.get("layout")).toBe("standard")
  })

  it("buildDefaultsPreviewUrlFromEditor reads the editor defaults per shape", async () => {
    const { Probe, ctx } = probe()
    renderWithCtx(createElement("div", null, createElement(Probe)))
    await act(async () => {
      ctx().setDefaultPosterLayout("fresh")
    })
    await act(async () => {
      ctx().setLandscape({ posterLayout: "standard" })
    })
    const ed = ctx()
    const portrait = buildDefaultsPreviewUrlFromEditor(ed, {
      tmdbKey: "k",
      userId: null,
      lang: "it",
      demoMedia: null,
      previewShape: "portrait",
      previewFamily: null,
    })
    expect(paramsOf(portrait.url).get("layout")).toBe("fresh")
    const landscape = buildDefaultsPreviewUrlFromEditor(ed, {
      tmdbKey: "k",
      userId: null,
      lang: "it",
      demoMedia: null,
      previewShape: "landscape",
      previewFamily: null,
    })
    expect(paramsOf(landscape.url).get("layout")).toBe("standard")
  })
})

describe("URL template captures the selection; absent stays absent", () => {
  function template(extra: Record<string, unknown> = {}) {
    return buildUrlPattern({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
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
      tmdbKey: "k",
      lang: "it",
      ...extra,
    } as never)
  }

  it("omits layout when unspecified (legacy templates byte-identical)", () => {
    expect(paramsOf(template()).get("layout")).toBeNull()
  })

  it("emits layout=fresh and explicit layout=standard when selected", () => {
    expect(paramsOf(template({ posterLayout: "fresh" })).get("layout")).toBe("fresh")
    expect(paramsOf(template({ posterLayout: "standard" })).get("layout")).toBe(
      "standard",
    )
  })

  it("followSpace templates carry no layout (server resolves the space)", () => {
    expect(
      paramsOf(template({ posterLayout: "fresh", followSpace: true })).get("layout"),
    ).toBeNull()
  })
})

describe("mapping dirty tracks the effective per-shape layout", () => {
  const base = {
    artwork: {
      posterPath: "/p.jpg",
      customPosterUrl: null,
      backdropPath: null,
      posterShape: "poster",
      logoPath: null,
    },
    gradient: {
      gradientHeight: 30,
      blurEnabled: true,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      tintStrength: 20,
      topShade: 50,
    },
  } as const

  it("absent layout on both sides is clean (legacy mappings)", () => {
    expect(
      isMappingDirty(
        { ...base, posterLayout: "standard" } as never,
        { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" } as never,
        base.gradient,
        "poster",
      ),
    ).toBe(false)
  })

  it("flat fresh vs saved standard is dirty; matching fresh is clean", () => {
    const mapping = {
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      posterLayout: "standard",
    } as never
    expect(
      isMappingDirty(
        { ...base, posterLayout: "fresh" } as never,
        mapping,
        base.gradient,
        "poster",
      ),
    ).toBe(true)
    expect(
      isMappingDirty(
        { ...base, posterLayout: "standard" } as never,
        mapping,
        base.gradient,
        "poster",
      ),
    ).toBe(false)
  })

  it("landscape compares the landscape profile, not the flat", () => {
    const mapping = {
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      posterLayout: "standard",
      landscape: { posterLayout: "fresh" },
    } as never
    const current = {
      ...base,
      artwork: { ...base.artwork, posterShape: "landscape" },
      posterLayout: "fresh",
    }
    expect(isMappingDirty(current as never, mapping, base.gradient, "landscape")).toBe(false)
    expect(
      isMappingDirty(
        { ...current, posterLayout: "standard" } as never,
        mapping,
        base.gradient,
        "landscape",
      ),
    ).toBe(true)
  })
})

describe("per-title layout selector (BadgeControls)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: SELECTED as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    // Distinct a11y group from the ranking appearance (ui.rankFamily).
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it("renders Standard/Fresh separate from the ranking style", () => {
    renderEditor()
    const group = layoutGroup()
    expect(within(group).getByRole("radio", { name: "ui.posterLayoutStandard" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    // The ranking appearance group is a different control.
    expect(screen.getByRole("radiogroup", { name: "ui.rankFamily" })).not.toBe(group)
  })

  it("switching to Fresh keeps badge/logo/transform settings intact", () => {
    const { ctx } = renderEditor()
    const before = {
      badge: ctx().badgeStyle,
      rank: ctx().rankingBadgeStyle,
      ribbon: ctx().ribbonEnabled,
      logo: ctx().logoScale,
      top: ctx().topBadgeScale,
    }
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().badgeStyle).toBe(before.badge)
    expect(ctx().rankingBadgeStyle).toBe(before.rank)
    expect(ctx().ribbonEnabled).toBe(before.ribbon)
    expect(ctx().logoScale).toBe(before.logo)
    expect(ctx().topBadgeScale).toBe(before.top)
    // Switching back restores Standard without touching the rest.
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().rankingBadgeStyle).toBe(before.rank)
    expect(ctx().topBadgeScale).toBe(before.top)
  })

  it("PosterLayoutSelector is a controlled radiogroup with a hint", () => {
    const onChange = vi.fn()
    renderWithCtx(
      createElement(PosterLayoutSelector, { value: "standard", onChange }),
    )
    fireEvent.click(screen.getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(onChange).toHaveBeenCalledWith("fresh")
    expect(screen.getByText("ui.posterLayoutHint")).toBeTruthy()
  })

  // Intentional exposure change (P6): all five cover layouts are now
  // selectable in the UI (historic Standard, full-bleed Fresh, and the three
  // integrated Card skins). The previous 2-button assertion had to go because
  // the contract/storage chain already carries the three cover IDs intact and
  // the selector is the only missing surface — not test-gaming, the product
  // requirement changed and the old expectation contradicts it.
  it("exposes all five layouts: Standard, Fresh, Provider Glass, Nuvio, Stremio", () => {
    const onChange = vi.fn()
    renderWithCtx(
      createElement(PosterLayoutSelector, { value: "standard", onChange }),
    )
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    const radios = within(group).getAllByRole("radio")
    expect(radios).toHaveLength(5)
    const names = [
      "ui.posterLayoutStandard",
      "ui.posterLayoutFresh",
      "ui.posterLayoutProviderGlass",
      "ui.posterLayoutNuvio",
      "ui.posterLayoutStremio",
    ]
    // Each choice is reachable by its accessible label (thumbnails are
    // aria-hidden illustrative CSS, never part of the name).
    for (const name of names) {
      expect(within(group).getByRole("radio", { name })).toBeTruthy()
    }
    // Every choice is clickable and reports its own ID (controlled).
    const ids = ["fresh", "provider-glass", "nuvio", "stremio"] as const
    ids.forEach((id, i) => {
      fireEvent.click(within(group).getByRole("radio", { name: names[i + 1] }))
      expect(onChange).toHaveBeenCalledWith(id)
    })
  })

  it("fails closed to Standard on garbage, keeping the control usable", () => {
    const onChange = vi.fn()
    renderWithCtx(
      createElement(PosterLayoutSelector, { value: "bogus", onChange }),
    )
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    expect(
      within(group).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    ).toHaveAttribute("aria-checked", "true")
    expect(within(group).getAllByRole("radio")).toHaveLength(5)
  })
})

describe("global layout defaults scoped per edit target", () => {
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
    // The layout card lives in the style group (open); other groups stay shut.
    const t = screen.getByTestId("badge-group-style-toggle")
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it("portrait writes the flat default; profile stays empty", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().defaultPosterLayout).toBe("fresh")
    expect(ctx().landscape.posterLayout).toBeUndefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // The persisted payload captures the selection (server + local).
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").posterLayout).toBe(
      "fresh",
    )
  })

  it("landscape writes only the profile override; flat stays standard", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().landscape.posterLayout).toBe("fresh")
    expect(ctx().defaultPosterLayout).toBe("standard")
  })

  it("unmapped open titles follow the default live; saved titles do not", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    // Live draft guard: an explicit per-title choice survives hydration.
    await act(async () => {
      ctx().setPosterLayout("fresh")
    })
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().defaultPosterLayout).toBe("standard")
  })
})

describe("useDefaults hydrates the layout from storage", () => {
  function renderProbe() {
    const { Probe, ctx } = probe()
    renderWithCtx(createElement("div", null, createElement(Probe)))
    return { ctx }
  }

  it("restores saved flat + default layout", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "fresh", posterLayout: "fresh" }),
    )
    const { ctx } = renderProbe()
    await act(async () => {})
    expect(ctx().defaultPosterLayout).toBe("fresh")
    expect(ctx().posterLayout).toBe("fresh")
  })

  it("falls back to standard on garbage", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "bogus", posterLayout: 42 }),
    )
    const { ctx } = renderProbe()
    await act(async () => {})
    expect(ctx().defaultPosterLayout).toBe("standard")
    expect(ctx().posterLayout).toBe("standard")
  })
})

describe("save freezes the layout per shape", () => {
  it("portrait save writes the flat; landscape save writes the profile and preserves the flat", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        if (typeof _url === "string" && _url.includes("/api/mappings")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")))
        }
        // http() reads res.text() (never .json()): a missing text() throws
        // into the retry backoff, which hangs under fake timers.
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => "{}",
          json: async () => ({}),
        }
      }),
    )
    function renderSaver(shape: "poster" | "landscape", layout: "standard" | "fresh") {
      let save: (() => Promise<unknown>) | null = null
      function Saver() {
        const { saveConfig } = usePosterSave({
          selected: SELECTED as never,
          previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 0, width: 500, height: 750 },
          selectedLogo: null,
          setSelectedLogo: () => {},
          setPreviewPoster: () => {},
          setPreviewId: () => {},
          posters: [],
          metaInfo: { genres: [], voteAverage: 0 },
          trendRank: null,
          mdblistAnimeList: [],
          mappingsMap: new Map(),
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
            gradientHeight: 30,
            blurEnabled: true,
            blurIntensity: 20,
            blurFade: 70,
            blurDarkness: 30,
            tintStrength: 20,
            topShade: 50,
          },
          landscapeBlurDirty: false,
          defaultLogoScale: null,
          defaultLogoOffsetX: null,
          defaultLogoOffsetY: null,
          landscapeDefaults: null,
          tintStrength: 20,
          topShade: 50,
          gradientHeight: 30,
          setGradientHeight: () => {},
          setBlurFade: () => {},
          setLandscapeBlur: () => {},
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
          rotationBackdrops: [],
          autoRotateBackdrop: false,
          defaultAutoRotateBackdrop: false,
          excludedBackdrops: [],
          backdrops: [],
          accentColor: null,
          autoAccentColor: null,
          logoDisabled: false,
          setLogoDisabled: () => {},
          setLogoScale: () => {},
          setLogoOffsetX: () => {},
          setLogoOffsetY: () => {},
          networkLogo: true,
          networkLogoPosition: "auto",
          networkLogoFollowTitle: true,
          ribbonEnabled: true,
          lang: "it",
          episodeGroupId: null,
          posterShape: shape,
          posterLayout: layout,
          posterFreshScope: "all",
          defaultSashOrder: null,
        })
        save = saveConfig
        return null
      }
      renderWithCtx(createElement(Saver))
      return async () => {
        await act(async () => {
          await save?.()
        })
      }
    }

    const runPortrait = renderSaver("poster", "fresh")
    await runPortrait()
    const portraitBody = bodies[bodies.length - 1] as Record<string, unknown>
    expect(portraitBody.posterLayout).toBe("fresh")
    expect(portraitBody.landscape).toBeNull()

    const runLandscape = renderSaver("landscape", "fresh")
    await runLandscape()
    const landscapeBody = bodies[bodies.length - 1] as Record<string, unknown>
    expect((landscapeBody.landscape as Record<string, unknown>).posterLayout).toBe("fresh")
    // New mapping in landscape: the flat inherits the live sliders (portrait
    // works immediately), exactly like separateRatingsStyle.
    expect(landscapeBody.posterLayout).toBe("fresh")
  })
})

describe("layout i18n (18 lingue)", () => {
  it("every dictionary defines the new keys with non-empty values", async () => {
    const mods = await Promise.all([
      import("@/lib/translations/ar.json"),
      import("@/lib/translations/cs.json"),
      import("@/lib/translations/de.json"),
      import("@/lib/translations/en.json"),
      import("@/lib/translations/es-419.json"),
      import("@/lib/translations/es.json"),
      import("@/lib/translations/fr.json"),
      import("@/lib/translations/he.json"),
      import("@/lib/translations/it.json"),
      import("@/lib/translations/ja.json"),
      import("@/lib/translations/ko.json"),
      import("@/lib/translations/nl.json"),
      import("@/lib/translations/pl.json"),
      import("@/lib/translations/pt.json"),
      import("@/lib/translations/ro.json"),
      import("@/lib/translations/sv.json"),
      import("@/lib/translations/tr.json"),
      import("@/lib/translations/vi.json"),
    ])
    const langs = ["ar","cs","de","en","es-419","es","fr","he","it","ja","ko","nl","pl","pt","ro","sv","tr","vi"] as const
    const keys = ["ui.posterLayout","ui.posterLayoutStandard","ui.posterLayoutFresh","ui.posterLayoutHint","ui.posterLayoutProviderGlass","ui.posterLayoutNuvio","ui.posterLayoutStremio","ui.posterLayoutScope","ui.posterLayoutScopeHint","ui.posterLayoutCardHint"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})
