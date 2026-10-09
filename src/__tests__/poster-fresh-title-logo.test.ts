/**
 * Fresh title-logo default scale (task8a, user fix "logo fresh al 100%",
 * correzione c1 "solo per i fresh" + "margine fino 150/200").
 *
 * Contract (client ↔ server sync, poster-sync skill):
 * - EFFECTIVE Fresh ONLY (layout fresh AND (scope all OR a valid DISPLAYED
 *   rank 1..100, rankingEnabled-gated) — mai layout selezionato da solo, mai
 *   appartenenza catalogo) with an auto/missing title-logo scale renders at
 *   100 (`FRESH_TITLE_LOGO_DEFAULT_SCALE`), NOT the aspect curve (cap 75).
 *   100 is a scale-control value (percent of poster width into the Fresh
 *   title cap), never 100% of the canvas width; the bitmap is sized once by
 *   the single renderer, never double-scaled. Rank ignoto/pending sotto scope
 *   ranked = fallback Standard (aspect), col sentinel auto (`scale=0`/null),
 *   mai 100 baked.
 * - Client provenance (`logoScaleExplicit`): auto (preview sentinel, save
 *   null, ricalcolato ai soli rank-arrival/change, ranking on/off, scope
 *   ranked↔all, reset/switch) vs esplicito (preview/salvataggio congelati,
 *   mai toccato). Un 100 automatico non è mai un 100 esplicito.
 * - Explicit scales (query/mapping/config/per-shape default/saved, INCLUDING
 *   75/100/150/200) always win everywhere; Fresh auto is byte-identical to
 *   explicit 100.
 * - Effective Standard (standard selected, or fresh+ranked without a valid
 *   displayed rank) keeps the historic aspect-curve auto, unchanged.
 * - Fresh UI limits 10..200 (per-titolo + default entrambi i formati);
 *   Standard UI limits 10..100 unchanged. Fresh render cap grows 100→150→200
 *   (solo sicurezza canvas vincola).
 * - Editor: auto effettivi via `logoEffectiveAutoScale`; switching layout
 *   never rewrites an explicit scale (75/100/150 included) nor promotes an
 *   auto; save freezes explicits per-shape, autos as null. Hidden/missing
 *   logos stay safe on both shapes.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  FRESH_TITLE_LOGO_DEFAULT_SCALE,
  logoAutoScaleForLayout,
  logoDefaultScaleFromAspect,
} from "@/lib/logo-selection"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import { BadgeControls } from "@/components/BadgeControls"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
}

/** 220x100 wordmark: aspect auto would be 63, Fresh auto must be 100. */
async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.3,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: 6,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: "2024-03-10",
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    shape: "poster",
    ...overrides,
  }
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(buf).metadata()
  return { w: meta.width ?? 0, h: meta.height ?? 0 }
}

describe("logoAutoScaleForLayout (legacy selected-only, NOT the auto path)", () => {
  // Correzione c1: questo helper rank-agnostic era la ROOTCAUSE della
  // regressione utente (Fresh selezionato senza rank → 100 baked sui titoli
  // Standard). Resta per compat ma NESSUN auto-path lo usa più: gli auto
  // usano `logoEffectiveAutoScale` (Fresh effettivo) col sentinel auto.
  it("returns 100 for fresh regardless of aspect (legacy behavior, kept)", () => {
    expect(FRESH_TITLE_LOGO_DEFAULT_SCALE).toBe(100)
    expect(logoAutoScaleForLayout({ width: 220, height: 100 }, "fresh")).toBe(100)
    expect(logoAutoScaleForLayout({ width: 400, height: 400 }, "fresh")).toBe(100)
    expect(logoAutoScaleForLayout({ width: 1200, height: 400 }, "fresh")).toBe(100)
  })

  it("returns 100 for fresh with missing/degenerate dims (never 75)", () => {
    expect(logoAutoScaleForLayout(null, "fresh")).toBe(100)
    expect(logoAutoScaleForLayout(undefined, "fresh")).toBe(100)
    expect(logoAutoScaleForLayout({ width: 0, height: 100 }, "fresh")).toBe(100)
    expect(logoAutoScaleForLayout({ width: 100, height: 0 }, "fresh")).toBe(100)
  })

  it("keeps the aspect curve outside fresh (standard + unknown layouts)", () => {
    expect(logoAutoScaleForLayout({ width: 220, height: 100 }, "standard")).toBe(
      logoDefaultScaleFromAspect(220, 100),
    )
    expect(logoAutoScaleForLayout({ width: 400, height: 400 }, "standard")).toBe(38)
    expect(logoAutoScaleForLayout({ width: 220, height: 100 }, null)).toBe(
      logoDefaultScaleFromAspect(220, 100),
    )
    expect(logoAutoScaleForLayout({ width: 220, height: 100 }, "bogus")).toBe(
      logoDefaultScaleFromAspect(220, 100),
    )
  })

  it("falls back to 75 without dimensions outside fresh", () => {
    expect(logoAutoScaleForLayout(null, "standard")).toBe(75)
    expect(logoAutoScaleForLayout(null, null)).toBe(75)
    expect(logoAutoScaleForLayout({ width: 0, height: 0 }, "standard")).toBe(75)
  })
})

describe("effective Fresh auto == explicit 100 (single sizing, no double scale)", () => {
  it("ranked Fresh: auto renders byte-identical to explicit 100 (both shapes)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const full = {
        posterBuf: await patternedBase(W, H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape,
        rankingEnabled: true,
        finalRank: 6,
      }
      const auto = await generatePosterBuffer(baseInput(full))
      const explicit100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
      expect(await dims(auto)).toEqual({ w: W, h: H })
      expect(sha(auto)).toBe(sha(explicit100))
    }
  }, 180000)

  it("scope=all unranked Fresh: auto renders byte-identical to explicit 100 (both shapes)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const full = {
        posterBuf: await patternedBase(W, H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        posterFreshScope: "all" as const,
        shape,
        rankingEnabled: false,
        finalRank: null,
      }
      const auto = await generatePosterBuffer(baseInput(full))
      const explicit100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
      expect(await dims(auto)).toEqual({ w: W, h: H })
      expect(sha(auto)).toBe(sha(explicit100))
    }
  }, 180000)
})

describe("explicit title scales are honoured in effective Fresh", () => {
  it("explicit 50/20 differ from auto (landscape shows the scale ride; portrait caps wide marks)", async () => {
    const logo = await whiteLogo()
    const full = {
      posterBuf: await patternedBase(LAND_W, LAND_H),
      logoFetch: logo,
      posterLayout: "fresh" as const,
      shape: "landscape" as const,
      rankingEnabled: true,
      finalRank: 6,
    }
    const auto = await generatePosterBuffer(baseInput(full))
    // 50% of 768 = 384 < title cap 487: uncapped, must differ from the
    // capped auto-100. 20 is far below every cap on both shapes.
    expect(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: 50 })))).not.toBe(sha(auto))
    const posterFull = { ...full, posterBuf: await patternedBase(STD_W, STD_H), shape: "poster" as const }
    const posterAuto = await generatePosterBuffer(baseInput(posterFull))
    expect(sha(await generatePosterBuffer(baseInput({ ...posterFull, logoScale: 20 })))).not.toBe(
      sha(posterAuto),
    )
    expect(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: 20 })))).not.toBe(sha(auto))
  }, 180000)
})

describe("Standard fallback keeps the historic aspect auto", () => {
  it("fresh+ranked without a displayed rank renders Standard: auto == aspect, not Fresh-100 (landscape)", async () => {
    const logo = await whiteLogo()
    const aspect = logoDefaultScaleFromAspect(220, 100) ?? 75
    expect(aspect).not.toBe(100)
    const full = {
      posterBuf: await patternedBase(LAND_W, LAND_H),
      logoFetch: logo,
      posterLayout: "fresh" as const,
      shape: "landscape" as const,
      rankingEnabled: false,
      finalRank: null,
    }
    const auto = await generatePosterBuffer(baseInput(full))
    // Ranked scope without a rank falls back to Standard: the auto scale is
    // the aspect curve (explicit aspect is byte-identical).
    expect(sha(auto)).toBe(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: aspect }))))
    // And it is NOT the Fresh-100 render (scope=all forces effective Fresh).
    const freshAuto = await generatePosterBuffer(
      baseInput({ ...full, posterFreshScope: "all" as const }),
    )
    expect(sha(auto)).not.toBe(sha(freshAuto))
  }, 180000)

  it("standard layout auto is unchanged (aspect curve, both shapes)", async () => {
    const logo = await whiteLogo()
    const aspect = logoDefaultScaleFromAspect(220, 100) ?? 75
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const full = {
        posterBuf: await patternedBase(W, H),
        logoFetch: logo,
        posterLayout: "standard" as const,
        shape,
        rankingEnabled: true,
        finalRank: 6,
      }
      const auto = await generatePosterBuffer(baseInput(full))
      expect(await dims(auto)).toEqual({ w: W, h: H })
      expect(sha(auto)).toBe(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: aspect }))))
    }
  }, 180000)

  it("hidden/missing logos stay safe on both shapes (no throw, canvas dims)", async () => {
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const scope of [undefined, "all"] as const) {
        const buf = await generatePosterBuffer(
          baseInput({
            posterBuf: await patternedBase(W, H),
            logoFetch: null,
            posterLayout: "fresh" as const,
            ...(scope ? { posterFreshScope: scope } : {}),
            shape,
            rankingEnabled: true,
            finalRank: 6,
          }),
        )
        expect(await dims(buf)).toEqual({ w: W, h: H })
      }
    }
  }, 180000)
})

describe("editor Fresh-100 wiring (shared resolver, no baked 75)", () => {
  function probe() {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
  }

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    vi.useFakeTimers()
  })

  it("resetPerTitleVisuals resolves auto EFFECTIVELY: ranked+unknown rank = aspect, scope-all Fresh = 100", async () => {
    const { Probe, ctx } = probe()
    renderWithCtx(createElement("div", null, createElement(Probe)))
    await act(async () => {})
    const logo = { width: 220, height: 100 }
    const aspect = logoDefaultScaleFromAspect(220, 100) ?? 75
    // Default layout is standard: reset follows the aspect curve (auto).
    await act(async () => {
      ctx().resetPerTitleVisuals(logo)
    })
    expect(ctx().logoScale).toBe(aspect)
    expect(ctx().logoScaleExplicit).toBe(false)
    // Correzione c1 (era l'asserzione sbagliata selected-only): Fresh
    // selezionato con scope ranked di default e rank ignoto = fallback
    // Standard effettivo → aspect, MAI 100 baked.
    await act(async () => {
      ctx().setDefaultPosterLayout("fresh")
    })
    await act(async () => {
      ctx().resetPerTitleVisuals(logo)
    })
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().logoScale).toBe(aspect)
    expect(ctx().logoScaleExplicit).toBe(false)
    // Missing logo under Fresh+ranked is aspect fallback 75 (never baked 100).
    await act(async () => {
      ctx().resetPerTitleVisuals(null)
    })
    expect(ctx().logoScale).toBe(75)
    expect(ctx().logoScaleExplicit).toBe(false)
    // Scope "all" esplicito: Fresh effettivo senza rank → 100 auto.
    await act(async () => {
      ctx().setDefaultPosterFreshScope("all")
    })
    await act(async () => {
      ctx().resetPerTitleVisuals(logo)
    })
    expect(ctx().logoScale).toBe(100)
    expect(ctx().logoScaleExplicit).toBe(false)
    await act(async () => {
      ctx().resetPerTitleVisuals(null)
    })
    expect(ctx().logoScale).toBe(100)
    expect(ctx().logoScaleExplicit).toBe(false)
  })

  it("switching Fresh↔Standard never rewrites an explicit scale (75 included)", async () => {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    const layoutGroup = (): HTMLElement =>
      screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    await act(async () => {
      ctx().setLogoScale(75)
    })
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().logoScale).toBe(75)
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }))
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().logoScale).toBe(75)
  })

  it("save freezes an explicit Fresh scale per-shape (75 travels untouched)", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        if (typeof _url === "string" && _url.includes("/api/mappings")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")))
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => "{}",
          json: async () => ({}),
        }
      }),
    )
    let save: (() => Promise<unknown>) | null = null
    function Saver() {
      const { saveConfig } = usePosterSave({
        selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as never,
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
        posterShape: "poster",
        posterLayout: "fresh",
        posterFreshScope: "ranked",
        defaultSashOrder: null,
      })
      save = saveConfig
      return null
    }
    renderWithCtx(createElement(Saver))
    await act(async () => {
      await save?.()
    })
    const body = bodies[bodies.length - 1] as Record<string, unknown>
    expect(body.posterLayout).toBe("fresh")
    expect(body.logoScale).toBe(75)
  })
})
