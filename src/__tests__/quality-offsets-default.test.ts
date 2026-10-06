import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  DEFAULT_QUALITY_BADGE_OFFSET_X,
  DEFAULT_QUALITY_BADGE_OFFSET_Y,
  DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
  DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
  getQualityBadgeOffsetDefault,
} from "@/lib/badge-styles"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { useDefaults, defaultsStorageKey } from "@/lib/useDefaults"
import type { Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

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

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

const config = (partial: Partial<PictoriumUserConfig> = {}): PictoriumUserConfig => ({
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
  logoFitEnabled: false,
  ...partial,
})

describe("quality badge offset defaults (verticale vs orizzontale)", () => {
  it("centralized defaults: portrait -10/+15, landscape 0/0", () => {
    expect(DEFAULT_QUALITY_BADGE_OFFSET_X).toBe(-10)
    expect(DEFAULT_QUALITY_BADGE_OFFSET_Y).toBe(15)
    expect(DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE).toBe(0)
    expect(DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE).toBe(0)
    expect(getQualityBadgeOffsetDefault("poster", "x")).toBe(-10)
    expect(getQualityBadgeOffsetDefault("poster", "y")).toBe(15)
    expect(getQualityBadgeOffsetDefault("landscape", "x")).toBe(0)
    expect(getQualityBadgeOffsetDefault("landscape", "y")).toBe(0)
  })

  it("server fallback: portrait gets -10/+15, landscape stays 0/0", () => {
    const portrait = resolvePosterRenderConfig(baseInput())
    expect(portrait.qualityBadgeOffsetX).toBe(-10)
    expect(portrait.qualityBadgeOffsetY).toBe(15)
    const landscape = resolvePosterRenderConfig(
      baseInput({ searchParams: new URLSearchParams("shape=landscape") }),
    )
    expect(landscape.posterShape).toBe("landscape")
    expect(landscape.qualityBadgeOffsetX).toBe(0)
    expect(landscape.qualityBadgeOffsetY).toBe(0)
  })

  it("explicit values (including 0) always win over the new defaults", () => {
    const explicitZero = resolvePosterRenderConfig(
      baseInput({ sd: { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 } }),
    )
    expect(explicitZero.qualityBadgeOffsetX).toBe(0)
    expect(explicitZero.qualityBadgeOffsetY).toBe(0)
    const explicitZeroLandscape = resolvePosterRenderConfig(
      baseInput({
        searchParams: new URLSearchParams("shape=landscape"),
        sd: { qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 },
      }),
    )
    expect(explicitZeroLandscape.qualityBadgeOffsetX).toBe(0)
    expect(explicitZeroLandscape.qualityBadgeOffsetY).toBe(0)
    const query = resolvePosterRenderConfig(
      baseInput({ searchParams: new URLSearchParams("qox=5&qoy=-7") }),
    )
    expect(query.qualityBadgeOffsetX).toBe(5)
    expect(query.qualityBadgeOffsetY).toBe(-7)
    const fromMapping = resolvePosterRenderConfig(
      baseInput({ mapping: mapping({ qualityBadgeOffsetX: 7, qualityBadgeOffsetY: -3 }) }),
    )
    expect(fromMapping.qualityBadgeOffsetX).toBe(7)
    expect(fromMapping.qualityBadgeOffsetY).toBe(-3)
    const fromConfig = resolvePosterRenderConfig(
      baseInput({ configOverride: config({ qualityBadgeOffsetX: 9, qualityBadgeOffsetY: -9 }) }),
    )
    expect(fromConfig.qualityBadgeOffsetX).toBe(9)
    expect(fromConfig.qualityBadgeOffsetY).toBe(-9)
    // Legacy portrait default stored as an explicit value stays put
    // (explicit 10 is an intentional override, never re-seeded to 15).
    const explicitLegacyTen = resolvePosterRenderConfig(
      baseInput({ sd: { qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 10 } }),
    )
    expect(explicitLegacyTen.qualityBadgeOffsetX).toBe(-10)
    expect(explicitLegacyTen.qualityBadgeOffsetY).toBe(10)
    const explicitLegacyTenMapping = resolvePosterRenderConfig(
      baseInput({ mapping: mapping({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 10 }) }),
    )
    expect(explicitLegacyTenMapping.qualityBadgeOffsetX).toBe(-10)
    expect(explicitLegacyTenMapping.qualityBadgeOffsetY).toBe(10)
  })

  it("landscape inherits explicit flat/mapping values but never the new portrait default", () => {
    const shape = new URLSearchParams("shape=landscape")
    const inheritsFlatMapping = resolvePosterRenderConfig(
      baseInput({ searchParams: shape, mapping: mapping({ qualityBadgeOffsetX: 7, qualityBadgeOffsetY: -3 }) }),
    )
    expect(inheritsFlatMapping.qualityBadgeOffsetX).toBe(7)
    expect(inheritsFlatMapping.qualityBadgeOffsetY).toBe(-3)
    const inheritsFlatDefaults = resolvePosterRenderConfig(
      baseInput({ searchParams: shape, sd: { qualityBadgeOffsetX: 4, qualityBadgeOffsetY: -4 } }),
    )
    expect(inheritsFlatDefaults.qualityBadgeOffsetX).toBe(4)
    expect(inheritsFlatDefaults.qualityBadgeOffsetY).toBe(-4)
    const landscapeProfileWins = resolvePosterRenderConfig(
      baseInput({
        searchParams: shape,
        mapping: mapping({
          qualityBadgeOffsetX: 7,
          qualityBadgeOffsetY: -3,
          landscape: { qualityBadgeOffsetX: 3, qualityBadgeOffsetY: 2 },
        }),
        sd: { qualityBadgeOffsetX: 4, landscape: { qualityBadgeOffsetX: 2 } },
      }),
    )
    expect(landscapeProfileWins.qualityBadgeOffsetX).toBe(3)
    expect(landscapeProfileWins.qualityBadgeOffsetY).toBe(2)
  })
})

describe("stremio URLs stay WYSIWYG with the server fallback", () => {
  it("explicit (config) emission: portrait -10/+15, landscape 0/0", () => {
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: null,
      config: "tok",
    })
    expect(portrait.searchParams.get("qox")).toBe("-10")
    expect(portrait.searchParams.get("qoy")).toBe("15")
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: { posterShape: "landscape" },
      mapping: null,
      config: "tok",
    })
    expect(landscape.searchParams.get("shape")).toBe("landscape")
    expect(landscape.searchParams.get("qox")).toBe("0")
    expect(landscape.searchParams.get("qoy")).toBe("0")
  })

  it("explicit per-title 0 and legacy 10 are preserved in stremio URLs (never clobbered by the new default)", () => {
    const url = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: mapping({ qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0 }),
      config: "tok",
    })
    expect(url.searchParams.get("qox")).toBe("0")
    expect(url.searchParams.get("qoy")).toBe("0")
    const legacy = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: mapping({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 10 }),
      config: "tok",
    })
    expect(legacy.searchParams.get("qox")).toBe("-10")
    expect(legacy.searchParams.get("qoy")).toBe("10")
  })

  it("compact URLs omit tuning but carry a shape-aware dv matching the server fallback", () => {
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: null,
    })
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: { posterShape: "landscape" },
      mapping: null,
    })
    // Tuning omesso: il server risolve da mapping > defaults dello spazio.
    expect(portrait.searchParams.get("qox")).toBeNull()
    expect(landscape.searchParams.get("qox")).toBeNull()
    const dvPortrait = portrait.searchParams.get("dv")
    const dvLandscape = landscape.searchParams.get("dv")
    expect(dvPortrait).toBeTruthy()
    expect(dvLandscape).toBeTruthy()
    // Firme diverse: il cambio default invalida la cache per formato.
    expect(dvPortrait).not.toBe(dvLandscape)
    // Parità server: la risoluzione senza query dà gli stessi effettivi.
    expect(resolvePosterRenderConfig(baseInput()).qualityBadgeOffsetX).toBe(-10)
    expect(resolvePosterRenderConfig(baseInput()).qualityBadgeOffsetY).toBe(15)
    expect(
      resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams("shape=landscape") })).qualityBadgeOffsetX,
    ).toBe(0)
  })

  it("defaults preview emits the portrait fallback (-10/+15) when unset", () => {
    const url = new URL(buildDefaultsPreviewUrl({} as never))
    expect(url.searchParams.get("qox")).toBe("-10")
    expect(url.searchParams.get("qoy")).toBe("15")
  })
})

describe("useDefaults hydration: landscape provenance from raw stored data", () => {
  function createStorageStub() {
    const store = new Map<string, string>()
    return {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v))
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => {
        store.clear()
      },
    }
  }

  type StorageStub = ReturnType<typeof createStorageStub>
  let storage: StorageStub

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    // window.localStorage may be a separate getter in some setups
    try {
      Object.defineProperty(window, "localStorage", { value: storage, configurable: true })
    } catch { /* already stubbed */ }
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function renderSettled() {
    const hook = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    return hook
  }

  it("new settings: portrait -10/+15, landscape 0/0", async () => {
    const { result } = await renderSettled()
    expect(result.current.defaultQualityBadgeOffsetX).toBe(-10)
    expect(result.current.defaultQualityBadgeOffsetY).toBe(15)
    expect(result.current.landscape.qualityBadgeOffsetX).toBe(0)
    expect(result.current.landscape.qualityBadgeOffsetY).toBe(0)
  })

  it("stored flat exactly -10/+10 with no landscape profile: landscape follows (-10/+10), not 0", async () => {
    storage.setItem(
      defaultsStorageKey(),
      JSON.stringify({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 10 }),
    )
    const { result } = await renderSettled()
    expect(result.current.defaultQualityBadgeOffsetX).toBe(-10)
    expect(result.current.defaultQualityBadgeOffsetY).toBe(10)
    // Profilo assente = follow dei flat (modello esistente): i consumer
    // `land ?? flat` mostrano -10/+10, come il server (spread raw).
    expect(result.current.landscape.qualityBadgeOffsetX).toBeUndefined()
    expect(result.current.landscape.qualityBadgeOffsetY).toBeUndefined()
    expect(result.current.landscape.qualityBadgeOffsetX ?? result.current.defaultQualityBadgeOffsetX).toBe(-10)
    expect(result.current.landscape.qualityBadgeOffsetY ?? result.current.defaultQualityBadgeOffsetY).toBe(10)
  })

  it("stored explicit 0 stays 0 and landscape keeps following (no seed, no migration)", async () => {
    storage.setItem(
      defaultsStorageKey(),
      JSON.stringify({ qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0, landscape: {} }),
    )
    const { result } = await renderSettled()
    expect(result.current.defaultQualityBadgeOffsetX).toBe(0)
    expect(result.current.defaultQualityBadgeOffsetY).toBe(0)
    expect(result.current.landscape.qualityBadgeOffsetX).toBeUndefined()
    expect(result.current.landscape.qualityBadgeOffsetY).toBeUndefined()
  })

  it("stored flat customization is preserved and landscape keeps following it", async () => {
    storage.setItem(
      defaultsStorageKey(),
      JSON.stringify({ defaultQualityBadgeOffsetX: 20, defaultQualityBadgeOffsetY: -7 }),
    )
    const { result } = await renderSettled()
    expect(result.current.defaultQualityBadgeOffsetX).toBe(20)
    expect(result.current.defaultQualityBadgeOffsetY).toBe(-7)
    expect(result.current.landscape.qualityBadgeOffsetX).toBeUndefined()
    expect(result.current.landscape.qualityBadgeOffsetY ?? result.current.defaultQualityBadgeOffsetY).toBe(-7)
  })

  it("stored landscape override wins over everything", async () => {
    storage.setItem(
      defaultsStorageKey(),
      JSON.stringify({ landscape: { qualityBadgeOffsetX: 5, qualityBadgeOffsetY: -5 } }),
    )
    const { result } = await renderSettled()
    expect(result.current.defaultQualityBadgeOffsetX).toBe(-10)
    expect(result.current.landscape.qualityBadgeOffsetX).toBe(5)
    expect(result.current.landscape.qualityBadgeOffsetY).toBe(-5)
  })

  it("vertical reset does not touch the landscape profile", async () => {
    const { result } = await renderSettled()
    expect(result.current.landscape.qualityBadgeOffsetX).toBe(0)
    act(() => {
      result.current.update({ defaultQualityBadgeOffsetX: 20, defaultQualityBadgeOffsetY: -7 })
    })
    expect(result.current.defaultQualityBadgeOffsetX).toBe(20)
    expect(result.current.landscape.qualityBadgeOffsetX).toBe(0)
    expect(result.current.landscape.qualityBadgeOffsetY).toBe(0)
  })
})
