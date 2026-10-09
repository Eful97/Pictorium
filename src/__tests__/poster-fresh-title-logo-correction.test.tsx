/**
 * Correzione c1 task8a (regressione utente "vedo anche gli altri al 100" +
 * richiesta "margine fino 150/200% solo per i fresh").
 *
 * - Solo il Fresh EFFETTIVO parte da 100; il fallback Standard (fresh
 *   selezionato senza rank/disabilitato/ignoto) resta aspect e non congela 100.
 * - Provenance auto vs esplicito (`logoScaleExplicit`): preview sentinel
 *   `scale=0`, save null per gli auto; espliciti (75/100/150/200) intoccabili.
 * - Fresh UI 10..200 (per-titolo + default, entrambi i formati); Standard UI
 *   10..100 invariato; server clamp 10..200; hardening/cache invariati.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  FRESH_TITLE_LOGO_DEFAULT_SCALE,
  TITLE_LOGO_SCALE_MIN,
  FRESH_TITLE_LOGO_MAX_SCALE,
  STANDARD_TITLE_LOGO_MAX_SCALE,
  clampTitleLogoScale,
  resolveLogoDisplayedRank,
  isEffectiveFreshForLogo,
  logoEffectiveAutoScale,
  logoDefaultScaleFromAspect,
} from "@/lib/logo-selection"
import { computeLogoLayout } from "@/lib/logo-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { mappingSchema } from "@/lib/validation"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { PictoriumRoot } from "@/lib/context"
import { usePosterSave } from "@/lib/usePosterSave"
import { TransformControls } from "@/components/TransformControls"
import { BadgeControls } from "@/components/BadgeControls"
import { renderWithCtx } from "@/__tests__/test-utils"
import { render } from "@testing-library/react"

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

describe("c1 pure: displayed rank + effective Fresh + auto scale + bounds", () => {
  it("resolveLogoDisplayedRank follows service priority, ranking-gated, valid numerals only", () => {
    expect(resolveLogoDisplayedRank({ trendRank: 6, animeRank: 3, rankingEnabled: true })).toBe(6)
    expect(resolveLogoDisplayedRank({ trendRank: null, animeRank: 3, rankingEnabled: true })).toBe(3)
    expect(resolveLogoDisplayedRank({ trendRank: null, animeRank: null, rankingEnabled: true })).toBeNull()
    // Rank ignoto/pending = null (mai 100 forzato).
    expect(resolveLogoDisplayedRank({ trendRank: undefined, animeRank: undefined, rankingEnabled: true })).toBeNull()
    // Ranking spento: nessun rank mostrato anche con dati disponibili.
    expect(resolveLogoDisplayedRank({ trendRank: 6, animeRank: 3, rankingEnabled: false })).toBeNull()
    // Numerali non validi scartati (mai inventati): 0, >100, non interi.
    expect(resolveLogoDisplayedRank({ trendRank: 0, animeRank: null, rankingEnabled: true })).toBeNull()
    expect(resolveLogoDisplayedRank({ trendRank: 101, animeRank: null, rankingEnabled: true })).toBeNull()
    expect(resolveLogoDisplayedRank({ trendRank: 2.5, animeRank: null, rankingEnabled: true })).toBeNull()
    expect(resolveLogoDisplayedRank({ trendRank: NaN, animeRank: null, rankingEnabled: true })).toBeNull()
    expect(resolveLogoDisplayedRank({ trendRank: null, animeRank: 100, rankingEnabled: true })).toBe(100)
  })

  it("isEffectiveFreshForLogo: solo Fresh effettivo (mai layout selezionato da solo)", () => {
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: "all", displayedRank: null })).toBe(true)
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: 6 })).toBe(true)
    // Fallback Standard: fresh selezionato senza rank mostrato.
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: null })).toBe(false)
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: 0 })).toBe(false)
    expect(isEffectiveFreshForLogo({ posterLayout: "standard", posterFreshScope: "all", displayedRank: 6 })).toBe(false)
    expect(isEffectiveFreshForLogo({ posterLayout: "standard", posterFreshScope: "ranked", displayedRank: null })).toBe(false)
    // Scope assente = ranked fail-closed (default condiviso).
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: undefined, displayedRank: 6 })).toBe(true)
    expect(isEffectiveFreshForLogo({ posterLayout: "fresh", posterFreshScope: undefined, displayedRank: null })).toBe(false)
  })

  it("logoEffectiveAutoScale: 100 solo sotto Fresh effettivo, aspect altrove", () => {
    const wide = { width: 220, height: 100 }
    const aspect = logoDefaultScaleFromAspect(220, 100) ?? 75
    expect(aspect).not.toBe(100)
    expect(logoEffectiveAutoScale(wide, { posterLayout: "fresh", posterFreshScope: "all", displayedRank: null })).toBe(100)
    expect(logoEffectiveAutoScale(wide, { posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: 6 })).toBe(100)
    // La regressione utente: fresh selezionato senza rank = aspect, non 100.
    expect(logoEffectiveAutoScale(wide, { posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: null })).toBe(aspect)
    expect(logoEffectiveAutoScale(wide, { posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: 0 })).toBe(aspect)
    expect(logoEffectiveAutoScale(wide, { posterLayout: "standard", posterFreshScope: "all", displayedRank: 6 })).toBe(aspect)
    expect(logoEffectiveAutoScale(null, { posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: null })).toBe(75)
    expect(logoEffectiveAutoScale(null, { posterLayout: "fresh", posterFreshScope: "all", displayedRank: null })).toBe(100)
    expect(FRESH_TITLE_LOGO_DEFAULT_SCALE).toBe(100)
  })

  it("clampTitleLogoScale: Fresh 10..200, Standard 10..100 invariato", () => {
    expect(TITLE_LOGO_SCALE_MIN).toBe(10)
    expect(FRESH_TITLE_LOGO_MAX_SCALE).toBe(200)
    expect(STANDARD_TITLE_LOGO_MAX_SCALE).toBe(100)
    expect(clampTitleLogoScale(200, "fresh")).toBe(200)
    expect(clampTitleLogoScale(250, "fresh")).toBe(200)
    expect(clampTitleLogoScale(5, "fresh")).toBe(10)
    expect(clampTitleLogoScale(150, "fresh")).toBe(150)
    // Standard invariato: oltre 100 si ferma a 100 (vale per UI e clamp).
    expect(clampTitleLogoScale(150, "standard")).toBe(100)
    expect(clampTitleLogoScale(200, "standard")).toBe(100)
    expect(clampTitleLogoScale(75, "standard")).toBe(75)
    expect(clampTitleLogoScale(75, null)).toBe(75)
  })
})

describe("c1 service: no-rank Fresh == Standard auto; 100→150→200 cresce davvero", () => {
  it("fresh+ranked senza rank mostrato rende Standard: auto == aspect su entrambi i formati (regressione utente)", async () => {
    const logo = await whiteLogo()
    const aspect = logoDefaultScaleFromAspect(220, 100) ?? 75
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const noRankFresh = {
        posterBuf: await patternedBase(W, H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape,
        rankingEnabled: false,
        finalRank: null,
      }
      const auto = await generatePosterBuffer(baseInput(noRankFresh))
      const { width, height } = await sharp(auto).metadata().then((m) => ({ width: m.width, height: m.height }))
      expect({ width, height }).toEqual({ width: W, height: H })
      // Auto (null) == aspect esplicito sul fallback Standard…
      expect(sha(auto)).toBe(sha(await generatePosterBuffer(baseInput({ ...noRankFresh, logoScale: aspect }))))
      // …e NON è il Fresh-100 (scope=all lo forza: diverso).
      const freshAuto = await generatePosterBuffer(baseInput({ ...noRankFresh, posterFreshScope: "all" as const }))
      expect(sha(auto)).not.toBe(sha(freshAuto))
      // Standard selezionato con auto è identico al fallback (stesso Standard).
      const stdAuto = await generatePosterBuffer(baseInput({ ...noRankFresh, posterLayout: "standard" as const }))
      expect(sha(auto)).toBe(sha(stdAuto))
    }
  }, 180000)

  it("Fresh effettivo 100→150→200: render distinti e box in crescita su entrambi i formati (nessun cap nascosto)", async () => {
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
      const b100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
      const b150 = await generatePosterBuffer(baseInput({ ...full, logoScale: 150 }))
      const b200 = await generatePosterBuffer(baseInput({ ...full, logoScale: 200 }))
      expect(sha(b100)).not.toBe(sha(b150))
      expect(sha(b100)).not.toBe(sha(b200))
      if (shape === "poster") {
        // Task8a2 ranked-portrait title: the 100 cap already spans the usable
        // width (444/500), so 150 reaches the genuine canvas edge (500 wide)
        // and 200 cannot grow past it — the ONLY allowed cap is the canvas
        // itself. Both still differ from 100 (no hidden slot cap).
        if (sha(b150) === sha(b200)) {
          expect(sha(b150)).not.toBe(sha(b100))
        } else {
          expect(sha(b150)).not.toBe(sha(b200))
        }
      } else {
        expect(sha(b150)).not.toBe(sha(b200))
      }
      // Box di layout (stessi input del service, senza cap Standard in Fresh):
      // la larghezza cresce davvero 100→150→200 (solo il canvas vincola).
      const box = (s: number) => computeLogoLayout({ posterW: W, posterH: H, logoW: 220, logoH: 100, logoScale: s, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true, align: "center" })
      // Il service riusa il bitmap già dimensionato e allarga il title cap
      // fresh della stessa % (fitFreshTitleLogo): la crescita è nel composito
      // sopra (sha distinti); il box grezzo non deve mai RESTRINGERSI.
      expect(box(150).width).toBeGreaterThanOrEqual(box(100).width)
      expect(box(200).width).toBeGreaterThanOrEqual(box(150).width)
    }
  }, 180000)

  it("esplicito 75 sotto Fresh effettivo resta 75 (mai riscritto in 100)", async () => {
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
    const explicit75 = await generatePosterBuffer(baseInput({ ...full, logoScale: 75 }))
    expect(sha(explicit75)).not.toBe(sha(auto))
    // E l'esplicito 200 è il massimo crescimento (diverso da 100 e 150).
    const explicit200 = await generatePosterBuffer(baseInput({ ...full, logoScale: 200 }))
    expect(sha(explicit200)).not.toBe(sha(auto))
    expect(sha(explicit200)).not.toBe(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: 150 }))))
  }, 180000)
})

describe("c1 audit catena scala logo: schema/config/query/hardening/cache/default/token/url", () => {
  it("mappingSchema: 200 valido (flat + landscape), 201 rifiutato, null valido", () => {
    const base = { tmdbId: 11, mediaType: "movie" as const, title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, logoScale: 200 }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, logoScale: 150 }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, logoScale: 201 }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, logoScale: 9 }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, logoScale: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, landscape: { logoScale: 200 } }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, landscape: { logoScale: 201 } }).success).toBe(false)
  })

  it("poster-config: query/mapping/default 200 viaggiano, 0/null = auto, oltre = clamp 200", () => {
    const sd = {} as ServerDefaults
    const cfg = (sp: URLSearchParams, mapping: Parameters<typeof resolvePosterRenderConfig>[0]["mapping"] = null) =>
      resolvePosterRenderConfig({
        searchParams: sp, mapping, configOverride: null, sd,
        hasQuery: true, showBadges: true, rankingBadges: true,
        animeRank: null, rankingResult: null, finalRank: null, lang: "it",
      })
    expect(cfg(new URLSearchParams("scale=200")).logoScale).toBe(200)
    expect(cfg(new URLSearchParams("scale=150")).logoScale).toBe(150)
    // Sentinel auto: 0/non-numerico = null (il service risolve Fresh-100 vs aspect).
    expect(cfg(new URLSearchParams("scale=0")).logoScale).toBeNull()
    expect(cfg(new URLSearchParams("scale=abc")).logoScale).toBeNull()
    expect(cfg(new URLSearchParams("")).logoScale).toBeNull()
    // Nessun clamp arbitrario sotto 200: 250 si ferma a 200 (stesso bound ovunque).
    expect(cfg(new URLSearchParams("scale=250")).logoScale).toBe(200)
    // Mapping salvato 200 e default 200 arrivano intatti (roundtrip save→render).
    expect(cfg(new URLSearchParams(""), { logoScale: 200 } as never).logoScale).toBe(200)
    expect(cfg(new URLSearchParams(""), { logoScale: 75 } as never).logoScale).toBe(75)
    expect(cfg(new URLSearchParams(""), null).logoScale).toBeNull()
  })

  it("hardening presets: 200 e sentinel 0 sopravvivono, la preview è esente", () => {
    const presets = { presets: true, preview: false, anonymous: false, publicInstance: true, hasMapping: false } as const
    expect(hardenPosterSearchParams(new URLSearchParams("scale=200"), presets).get("scale")).toBe("200")
    expect(hardenPosterSearchParams(new URLSearchParams("scale=0"), presets).get("scale")).toBe("0")
    // Quantizzazione step 10 invariata (157 → 160), mai un drop del sentinel.
    expect(hardenPosterSearchParams(new URLSearchParams("scale=157"), presets).get("scale")).toBe("160")
    // Preview WYSIWYG sempre esente: valori esatti prima del save.
    expect(hardenPosterSearchParams(new URLSearchParams("scale=157"), { ...presets, preview: true }).get("scale")).toBe("157")
  })

  it("cache key: scale=0 e scale=200 restano chiavi distinte (mai collasso auto/esplicito)", () => {
    const k0 = normalizePosterCacheParams(new URLSearchParams("scale=0&layout=fresh&freshScope=ranked")).toString()
    const k200 = normalizePosterCacheParams(new URLSearchParams("scale=200&layout=fresh&freshScope=ranked")).toString()
    expect(k0).toContain("scale=0")
    expect(k200).toContain("scale=200")
    expect(k0).not.toBe(k200)
  })

  it("preview URL: auto → scale=0, espliciti 75/150/200 invariati; default 200 → scale=200", () => {
    const ps = {
      selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 0, width: 500, height: 750 },
      selectedLogo: { file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 },
      selectedBackdrop: null,
      logoOffsetX: 0,
      logoOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: null,
      mdblistAnimeList: [],
      topEdgeColor: null,
      bottomEdgeColor: null,
      accentColor: null,
      autoAccentColor: null,
      lang: "it",
      tmdbKey: "",
    }
    const bp = {
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default",
      badgeGenre: true, badgeYear: true, badgeRating: true, badgeQuality: true, customRatings: true,
      separateRatings: false, separateRatingsStyle: "column", customBadge: null,
      gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
      genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
      qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
      posterLayout: "fresh", posterFreshScope: "ranked",
    }
    const scaleOf = (url: string) => new URL(url, "http://localhost").searchParams.get("scale")
    // Fresh selezionato senza rank ma AUTO → sentinel, mai 100 baked.
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 63, logoScaleIsAuto: true } as never, bp as never))).toBe("0")
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 200, logoScaleIsAuto: false } as never, bp as never))).toBe("200")
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 150 } as never, bp as never))).toBe("150")
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 75 } as never, bp as never))).toBe("75")
    // Default esplicito 200 viaggia nella preview default (token/url invariati).
    const durl = buildDefaultsPreviewUrl({ defaultLogoScale: 200 })
    expect(new URL(durl, "http://localhost").searchParams.get("scale")).toBe("200")
    const durlAuto = buildDefaultsPreviewUrl({ defaultLogoScale: null })
    expect(new URL(durlAuto, "http://localhost").searchParams.get("scale")).toBe("0")
  })

  it("catena no-rank Fresh preview == Standard auto nel service reale (URL auto → config null → stesso render)", async () => {
    const logo = await whiteLogo()
    const W = LAND_W
    const H = LAND_H
    // La preview di un Fresh selezionato senza rank (auto) emette scale=0…
    const q = new URLSearchParams("scale=0&layout=fresh&freshScope=ranked")
    const resolved = resolvePosterRenderConfig({
      searchParams: q, mapping: null, configOverride: null, sd: {} as ServerDefaults,
      hasQuery: true, showBadges: true, rankingBadges: false,
      animeRank: null, rankingResult: null, finalRank: null, lang: "it",
    })
    expect(resolved.logoScale).toBeNull()
    // …e il service con auto rende come lo Standard auto (stessi byte).
    const base = {
      posterBuf: await patternedBase(W, H),
      logoFetch: logo,
      shape: "landscape" as const,
      rankingEnabled: false,
      finalRank: null,
    }
    const viaFreshSelected = await generatePosterBuffer(baseInput({ ...base, posterLayout: "fresh" as const, logoScale: resolved.logoScale }))
    const viaStandard = await generatePosterBuffer(baseInput({ ...base, posterLayout: "standard" as const, logoScale: null }))
    expect(sha(viaFreshSelected)).toBe(sha(viaStandard))
  }, 180000)
})

describe("c1 editor provenance + UI 150/200 + save/reload (actual provider)", () => {
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

  it("PictoriumRoot reale monta con scala auto iniziale (mai baked)", async () => {
    let edCtx: PosterEditorCtx | null = null
    function RootProbe() {
      edCtx = usePosterEditor()
      return null
    }
    render(createElement(PictoriumRoot, null, createElement(RootProbe)))
    await act(async () => {})
    expect(edCtx).not.toBeNull()
    expect(edCtx!.logoScale).toBe(75)
    expect(edCtx!.logoScaleExplicit).toBe(false)
  })

  it("setLogoScale utente marca esplicito; preset/reset null restano auto", async () => {
    const { Probe, ctx } = probe()
    renderWithCtx(createElement("div", null, createElement(Probe)))
    await act(async () => {})
    expect(ctx().logoScaleExplicit).toBe(false)
    await act(async () => {
      ctx().setLogoScale(75)
    })
    expect(ctx().logoScale).toBe(75)
    expect(ctx().logoScaleExplicit).toBe(true)
    // Reset torna auto (mai esplicito).
    await act(async () => {
      ctx().resetPerTitleVisuals({ width: 220, height: 100 })
    })
    expect(ctx().logoScaleExplicit).toBe(false)
    // Preset con scala esplicita resta esplicito…
    await act(async () => {
      ctx().applyPerTitleVisualPreset({ defaultLogoScale: 150 } as never, { width: 220, height: 100 })
    })
    expect(ctx().logoScale).toBe(150)
    expect(ctx().logoScaleExplicit).toBe(true)
    // …mentre null resta auto (Fresh scope-all = 100 auto, non baked).
    // Il preset legge il per-titolo corrente (non i default): si porta il
    // titolo su fresh/all espliciti di layout/scope (la scala resta auto).
    await act(async () => {
      ctx().setPosterLayout("fresh")
      ctx().setPosterFreshScope("all")
    })
    await act(async () => {
      ctx().applyPerTitleVisualPreset({ defaultLogoScale: null } as never, { width: 220, height: 100 })
    })
    expect(ctx().logoScale).toBe(100)
    expect(ctx().logoScaleExplicit).toBe(false)
  })

  it("switch Fresh↔Standard non riscrive né promuove: esplicito 75 resta, auto resta auto", async () => {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    const layoutGroup = (): HTMLElement => screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    await act(async () => {
      ctx().setLogoScale(75)
    })
    expect(ctx().logoScaleExplicit).toBe(true)
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().posterLayout).toBe("fresh")
    expect(ctx().logoScale).toBe(75)
    expect(ctx().logoScaleExplicit).toBe(true)
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }))
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().logoScale).toBe(75)
    expect(ctx().logoScaleExplicit).toBe(true)
    // Auto 100 (scope-all Fresh) passando a Standard resta auto (mai baked a esplicito).
    await act(async () => {
      ctx().setDefaultPosterFreshScope("all")
      ctx().resetPerTitleVisuals({ width: 220, height: 100 })
    })
    // Il reset segue il default effettivo: layout standard di default → aspect.
    expect(ctx().logoScaleExplicit).toBe(false)
    await act(async () => {
      ctx().setPosterLayout("fresh")
    })
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }))
    expect(ctx().posterLayout).toBe("standard")
    expect(ctx().logoScaleExplicit).toBe(false)
  })

  it("TransformControls: Fresh slider max 200 (slider + digitato), Standard max 100 invariato", async () => {
    const { Probe, ctx } = probe()
    const logo = { file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 }
    const sel = { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" }
    const { container } = renderWithCtx(
      createElement("div", null, createElement(TransformControls), createElement(Probe)),
      { selected: sel as never, selectedLogo: logo as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    const ranges = (): HTMLInputElement[] => Array.from(container.querySelectorAll('input[type="range"]'))
    // Standard: nessun range a 200 (limite storico invariato), logo a 100.
    expect(ranges().some((r) => r.getAttribute("max") === "200")).toBe(false)
    await act(async () => {
      ctx().setPosterLayout("fresh")
    })
    // Fresh selezionato: lo slider titolo arriva a 200 (anche in fallback Standard:
    // controllo disponibile come preferenza, lo Standard auto non si muove).
    const fresh200 = ranges().filter((r) => r.getAttribute("max") === "200")
    expect(fresh200.length).toBe(1)
    // Interazione reale 150 via slider → esplicito.
    fireEvent.change(fresh200[0], { target: { value: "150" } })
    expect(ctx().logoScale).toBe(150)
    expect(ctx().logoScaleExplicit).toBe(true)
    // Digitato 200 → esplicito 200.
    const valBtn = screen.getByRole("button", { name: "ui.scale: 150%" })
    fireEvent.click(valBtn)
    const edit = container.querySelector(".editor-input") as HTMLInputElement
    expect(edit).not.toBeNull()
    fireEvent.change(edit, { target: { value: "200" } })
    fireEvent.blur(edit)
    expect(ctx().logoScale).toBe(200)
    expect(ctx().logoScaleExplicit).toBe(true)
    // Standard: il digitato oltre 100 si ferma a 100 (limite invariato).
    await act(async () => {
      ctx().setPosterLayout("standard")
    })
    const stdBtn = screen.getByRole("button", { name: "ui.scale: 200%" })
    fireEvent.click(stdBtn)
    const stdEdit = container.querySelector(".editor-input") as HTMLInputElement
    expect(stdEdit).not.toBeNull()
    fireEvent.change(stdEdit, { target: { value: "200" } })
    fireEvent.blur(stdEdit)
    expect(ctx().logoScale).toBe(100)
  })

  it("save: auto → null (mai 100 baked), espliciti 75/150/200 congelati; reload 200 intatto", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        if (typeof _url === "string" && _url.includes("/api/mappings")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")))
        }
        return { ok: true, status: 200, headers: new Headers(), text: async () => "{}", json: async () => ({}) }
      }),
    )
    const saveDeps = (logoScale: number, logoScaleExplicit?: boolean) => ({
      selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as never,
      previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 0, width: 500, height: 750 },
      selectedLogo: { file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 },
      setSelectedLogo: () => {},
      setPreviewPoster: () => {},
      setPreviewId: () => {},
      posters: [],
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: null,
      mdblistAnimeList: [],
      mappingsMap: new Map(),
      loadMappings: async () => {},
      logoScale,
      logoScaleExplicit,
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
      landscapeBlur: { gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 70, blurDarkness: 30, tintStrength: 20, topShade: 50 },
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
    async function saveWith(logoScale: number, logoScaleExplicit?: boolean) {
      let save: (() => Promise<unknown>) | null = null
      function Saver() {
        const { saveConfig } = usePosterSave(saveDeps(logoScale, logoScaleExplicit) as never)
        save = saveConfig
        return null
      }
      const { unmount } = renderWithCtx(createElement(Saver))
      await act(async () => {
        await save?.()
      })
      unmount()
      return bodies[bodies.length - 1] as Record<string, unknown>
    }
    // Auto (fresh selezionato, rank ignoto → aspect 63): MAI 100 baked.
    expect(await saveWith(63, false)).toMatchObject({ logoScale: null })
    // Espliciti legittimi congelati intatti (75/150/200, mai sovrascritti).
    expect(await saveWith(75, true)).toMatchObject({ logoScale: 75 })
    expect(await saveWith(150, true)).toMatchObject({ logoScale: 150 })
    expect(await saveWith(200, true)).toMatchObject({ logoScale: 200 })
    // Reload: il 200 salvato si rilegge 200 (roundtrip mapping→config).
    const reloaded = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(""),
      mapping: { logoScale: 200 } as never,
      configOverride: null, sd: {} as ServerDefaults,
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null, lang: "it",
    })
    expect(reloaded.logoScale).toBe(200)
  })
})
