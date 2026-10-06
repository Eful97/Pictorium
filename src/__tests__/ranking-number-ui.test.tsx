/**
 * Compito 3 — UI opzionale `rs=number`: swatch condiviso, label i18n,
 * opzioni editor/default, side raggiungibile, roundtrip reali
 * preview/Stremio/config-token. Default e altri stili invariati.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { BadgeStyleSelector } from "@/components/ui/BadgeStyleSelector"
import { renderWithCtx } from "@/__tests__/test-utils"
import { isSideControlVisible } from "@/components/settings/BadgeDefaultsSection"
import { buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"

const t = (k: string) => k

const baseBadgeParams = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow" as const,
  rankingBadgeStyle: "number" as const,
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

const basePosterState = {
  selected: { id: 123, media_type: "movie" as const, title: "Test Movie", poster_path: "/poster.jpg" },
  previewPoster: { file_path: "/poster.jpg", iso_639_1: "it", vote_average: 7.5, width: 500, height: 750 },
  selectedLogo: null,
  selectedBackdrop: null,
  logoScale: 75,
  logoOffsetX: 0,
  logoOffsetY: 0,
  backdropScale: 100,
  backdropOffsetX: 0,
  backdropOffsetY: 0,
  metaInfo: {
    genres: [{ id: 1, name: "Azione" }],
    voteAverage: 7.5,
  },
  trendRank: null,
  mdblistAnimeList: [],
  topEdgeColor: null,
  lang: "it",
  tmdbKey: "test-key",
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

describe("number style selector", () => {
  it("renders the number option with the ui.number label and gradient numeral swatch", () => {
    const onChange = vi.fn()
    renderWithCtx(
      <BadgeStyleSelector
        value="number"
        options={["default", "pill", "colored", "bordo", "vetro", "corner", "number"]}
        onChange={onChange}
        t={t}
        accentColor="#fb923c"
      />,
    )
    const btn = screen.getByRole("button", { name: /ui\.number/i })
    // Gradient-clipped numeral swatch (no plate, no "Aa" placeholder text).
    const swatch = btn.querySelector(".badge-style-preview span") as HTMLElement | null
    expect(swatch).not.toBeNull()
    expect(swatch!.textContent).toBe("1")
    expect(swatch!.style.background).toContain("linear-gradient")
    expect(btn.textContent).not.toContain("Aa")
    btn.click()
    // Claim: clicking the active option still fires onChange (selector contract).
    expect(onChange).toHaveBeenCalledWith("number")
  })

  it("leaves every pre-existing option label untouched", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="default"
        options={["default", "pill", "colored", "bordo", "vetro", "corner", "number"]}
        onChange={vi.fn()}
        t={t}
      />,
    )
    for (const name of [/ui\.bsDefault/i, /ui\.pill/i, /ui\.colored/i, /ui\.bordo/i, /ui\.vetro/i, /ui\.corner/i, /ui\.number/i]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
  })
})

describe("ui.number translations", () => {
  it("is Number in English and Numero in Italian, present in every dictionary", async () => {
    // NOTE: setup.ts mocks @/lib/i18n globally — use the real module like
    // tr-nl-sv.test.ts does, plus direct JSON imports (untouched by the mock).
    const { createT: realCreateT } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n")
    expect(realCreateT("en")("ui.number")).toBe("Number")
    expect(realCreateT("it")("ui.number")).toBe("Numero")
    // Same lookup the poster UI uses: unknown languages fall back to English.
    expect(realCreateT("xx")("ui.number")).toBe("Number")
    const dicts = import.meta.glob("@/lib/translations/*.json", { eager: true }) as Record<
      string,
      { default: Record<string, string> }
    >
    expect(Object.keys(dicts).length).toBeGreaterThan(10)
    for (const [path, mod] of Object.entries(dicts)) {
      expect(mod.default["ui.number"], `${path}:ui.number`).toBeDefined()
      expect(mod.default["ui.number"]!.trim().length, `${path}:ui.number`).toBeGreaterThan(0)
    }
  })
})

describe("side control reachability for number", () => {
  it("shows the side switch with ribbon on (historic rule, every style)", () => {
    for (const style of ["default", "pill", "corner", "number", "netflix"]) {
      expect(isSideControlVisible({ ribbonEnabled: true, rankingBadgeStyle: style })).toBe(true)
    }
  })

  it("shows the side switch with ribbon off only for number", () => {
    expect(isSideControlVisible({ ribbonEnabled: false, rankingBadgeStyle: "number" })).toBe(true)
    for (const style of ["default", "pill", "colored", "bordo", "vetro", "corner", "netflix", null, undefined]) {
      expect(isSideControlVisible({ ribbonEnabled: false, rankingBadgeStyle: style })).toBe(false)
    }
    expect(isSideControlVisible({ ribbonEnabled: undefined, rankingBadgeStyle: "number" })).toBe(true)
  })
})

describe("rs=number persistence and URL roundtrips", () => {
  it("preview URL carries rs=number and resolves back to number", () => {
    const url = buildPreviewUrl(basePosterState as never, baseBadgeParams as never)
    expect(url).toContain("rs=number")
    const params = new URL(url, "http://localhost").searchParams
    const r = resolvePosterRenderConfig(baseInput({ searchParams: params, rankingResult: 5 }))
    expect(r.rankingBadgeStyle).toBe("number")
  })

  it("Stremio params carry rs=number and resolve back to number", () => {
    const params = buildStremioPosterSearchParams({ rankingBadgeStyle: "number" })
    expect(params.get("rs")).toBe("number")
    const r = resolvePosterRenderConfig(baseInput({ searchParams: params, rankingResult: 5 }))
    expect(r.rankingBadgeStyle).toBe("number")
  })

  it("default style URLs are unchanged (no rs leak for default)", () => {
    const url = buildPreviewUrl(
      basePosterState as never,
      { ...baseBadgeParams, rankingBadgeStyle: "default" } as never,
    )
    expect(url).toContain("rs=default")
  })
})

describe("config token roundtrip with number", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined

  async function importConfigToken() {
    vi.resetModules()
    return import("@/lib/config-token")
  }

  beforeEach(() => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    consoleErrorSpy?.mockRestore()
    vi.resetModules()
  })

  it("round-trips rankingBadgeStyle number like corner", async () => {
    const { encodeConfig, decodeConfig } = await importConfigToken()
    const config = {
      globalBadges: true,
      rankingBadges: false,
      badgeStyle: "shadow",
      rankingBadgeStyle: "number",
      blurEnabled: true,
      blurIntensity: 5,
      blurFade: 60,
      blurDarkness: 40,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
      logoFitEnabled: true,
    } as const
    expect(decodeConfig(encodeConfig(config))).toEqual(config)
  })

  it("resolves number from a config token without a query override", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams(),
      configOverride: {
        globalBadges: true,
        rankingBadges: true,
        badgeStyle: "shadow",
        rankingBadgeStyle: "number",
        blurEnabled: true,
        blurIntensity: 5,
        blurFade: 60,
        blurDarkness: 40,
        gradientHeight: 30,
        networkLogo: true,
        autoRotateClean: false,
        logoFitEnabled: false,
      },
      rankingResult: 9,
    }))
    expect(r.rankingBadgeStyle).toBe("number")
  })
})
