import { describe, expect, it } from "vitest"
import { resolvePosterRenderConfig, clamp, type PosterRenderConfigInput } from "@/lib/poster-config"
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

describe("clamp", () => {
  it("bounds values within [min, max]", () => {
    expect(clamp(150, 5, 100)).toBe(100)
    expect(clamp(-3, 5, 100)).toBe(5)
    expect(clamp(42, 5, 100)).toBe(42)
  })
})

describe("resolvePosterRenderConfig", () => {
  it("uses defaults when nothing is provided", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.badgeStyle).toBe("shadow")
    expect(r.rankingBadgeStyle).toBe("default")
    expect(r.blurEnabled).toBe(true)
    expect(r.blurHeight).toBe(30)
    expect(r.blurIntensity).toBe(5)
    expect(r.blurFade).toBe(60)
    expect(r.blurDarkness).toBe(40)
    expect(r.badgesEnabled).toBe(true)
    expect(r.rankingEnabled).toBe(true)
    expect(r.ribbonSide).toBe("left")
    expect(r.queryExtra).toBeNull()
  })

  it("query bs beats mapping, config token and server defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bs: "pill" }),
      mapping: mapping({ badgeStyle: "colored" }),
      configOverride: config({ badgeStyle: "bar" }),
      sd: { badgeStyle: "bordo" },
    }))
    expect(r.badgeStyle).toBe("pill")
  })

  it("query rs beats mapping, config token and server defaults", () => {
    // M6: come per bs, la query `rs` vince sul mapping salvato (WYSIWYG).
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "pill" }),
      mapping: mapping({ rankingBadgeStyle: "colored" }),
      configOverride: config({ rankingBadgeStyle: "bar" }),
      sd: { rankingBadgeStyle: "netflix" },
    }))
    expect(r.rankingBadgeStyle).toBe("pill")
  })

  it("mapping rankingBadgeStyle 'default' is treated as no override (falls to config/sd)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ rankingBadgeStyle: "default" }),
      configOverride: config({ rankingBadgeStyle: "colored" }),
      sd: { rankingBadgeStyle: "bar" },
    }))
    expect(r.rankingBadgeStyle).toBe("colored")
  })

  it("invalid query value does not leak to the renderer (falls back to default rendering)", () => {
    // Fedele all'originale: la query invalida vince sul `||` e il renderer la
    // trattava come default — con i tipi union il confine la converte a "shadow".
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bs: "garbage" }),
      sd: { badgeStyle: "vetro" },
    }))
    expect(r.badgeStyle).toBe("shadow")
  })

  it("auto-detect: default ranking style becomes netflix when a rank exists", () => {
    const r = resolvePosterRenderConfig(baseInput({ finalRank: 3 }))
    expect(r.rankingBadgeStyle).toBe("netflix")
  })

  it("auto-detect: explicit netflix reverts to default without a rank", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "netflix" }),
    }))
    expect(r.rankingBadgeStyle).toBe("default")
  })

  it("explicit non-default ranking style is preserved regardless of rank", () => {
    const withRank = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "colored" }),
      finalRank: 7,
    }))
    expect(withRank.rankingBadgeStyle).toBe("colored")
    const withoutRank = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "colored" }),
    }))
    expect(withoutRank.rankingBadgeStyle).toBe("colored")
  })

  it("clamps out-of-range blur/gradient query values", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ blur: "999", bf: "-5", bd: "250", gradHeight: "0" }),
    }))
    expect(r.blurIntensity).toBe(100)
    expect(r.blurFade).toBe(0)
    expect(r.blurDarkness).toBe(100)
    expect(r.blurHeight).toBe(5)
  })

  it("non-finite numeric query falls back to config/default", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ blur: "abc", gradHeight: "1e999" }),
      configOverride: config({ blurIntensity: 12, gradientHeight: 40 }),
    }))
    expect(r.blurIntensity).toBe(12)
    expect(r.blurHeight).toBe(40)
  })

  it("badges=0 and ranking=0 disable badges (query mode)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ badges: "0", ranking: "0" }),
    }))
    expect(r.badgesEnabled).toBe(false)
    expect(r.rankingEnabled).toBe(false)
  })

  it("config token with ranking=0/other OFF flags disables them even with a configOverride", () => {
    // Regressione: un link ?config= + ranking=0/badges=0 (hasQuery true perché
    // c'è il config token) DEVE rispettare i flag OFF della query — prima
    // senza poster=/mapping espliciti hasQuery era false e il server forzava
    // badgesEnabled/rankingEnabled a true, mostrando il badge trend comunque.
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ badges: "0", ranking: "0", bg: "0", by: "0", br: "0", netLogo: "0" }),
      configOverride: config({}),
    }))
    expect(r.badgesEnabled).toBe(false)
    expect(r.rankingEnabled).toBe(false)
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(false)
    expect(r.badgeRating).toBe(false)
    expect(r.qNetLogo).toBe("0")
  })

  it("be=0 disables blur; blur defaults respect config token when set", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ be: "0" }),
    }))
    expect(r.blurEnabled).toBe(false)
    const r2 = resolvePosterRenderConfig(baseInput({
      configOverride: config({ blurEnabled: false, networkLogo: false }),
    }))
    expect(r2.blurEnabled).toBe(false)
    expect(r2.qNetLogo).toBe("0")
  })

  it("ribbonSide: query side=right or side=left wins, then config token (no mapping: globale)", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ side: "right" }) })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ side: "left" }), mapping: mapping({ ribbonSide: "right" }) })).ribbonSide).toBe("left")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ side: "left" }), configOverride: config({ ribbonSide: "right" }) })).ribbonSide).toBe("left")
    // Il mapping storico viene ignorato: vince il default globale.
    expect(resolvePosterRenderConfig(baseInput({ mapping: mapping({ ribbonSide: "right" }) })).ribbonSide).toBe("left")
    expect(resolvePosterRenderConfig(baseInput({ configOverride: config({ ribbonSide: "right" }) })).ribbonSide).toBe("right")
    expect(resolvePosterRenderConfig(baseInput()).ribbonSide).toBe("left")
  })

  it("networkLogo: query netLogo=1 or netLogo=0 wins, then mapping, then config token, then sd, then true", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netLogo: "1" }), mapping: mapping({ networkLogo: false }) })).networkLogo).toBe(true)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netLogo: "0" }), mapping: mapping({ networkLogo: true }) })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ mapping: mapping({ networkLogo: false }) })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ configOverride: config({ networkLogo: false }) })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ sd: { networkLogo: false } })).networkLogo).toBe(false)
    expect(resolvePosterRenderConfig(baseInput()).networkLogo).toBe(true)
  })

  it("queryExtra picks up extra param or config customBadge", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ extra: "Oggi" }) })).queryExtra).toBe("Oggi")
    expect(resolvePosterRenderConfig(baseInput({ configOverride: config({ customBadge: "Cult" }) })).queryExtra).toBe("Cult")
  })

  it("logo scale/offsets: query overrides mapping", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ scale: "120", ox: "5", oy: "-3" }),
      mapping: mapping({ logoScale: 80, logoOffsetX: 1, logoOffsetY: 2 }),
    }))
    expect(r.logoScale).toBe(120)
    expect(r.logoOffsetX).toBe(5)
    expect(r.logoOffsetY).toBe(-3)
    const r2 = resolvePosterRenderConfig(baseInput({ mapping: mapping({ logoScale: 80, logoOffsetX: 1, logoOffsetY: 2 }) }))
    expect(r2.logoScale).toBe(80)
    expect(r2.logoOffsetX).toBe(1)
    expect(r2.logoOffsetY).toBe(2)
  })

  it("logo scale/offsets are clamped (R1 anti-DoS)", () => {
    // Scale assurda → clamp 10..200 (prima arrivava a sharp → OOM/500).
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ scale: "999999" }) })).logoScale).toBe(200)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ scale: "-50" }) })).logoScale).toBe(10)
    // Non-numerico e 0 restano null come prima (nessun override).
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ scale: "abc" }) })).logoScale).toBeNull()
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ scale: "0" }) })).logoScale).toBeNull()
    // Offset oltre ±2000px → clamp (comunque fuori canvas).
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ ox: "99999" }) })).logoOffsetX).toBe(2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ oy: "-99999" }) })).logoOffsetY).toBe(-2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ ox: "xyz" }) })).logoOffsetX).toBeNull()
  })

  it("top badge scale/offsets default to 100/0/0", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.topBadgeScale).toBe(100)
    expect(r.topBadgeOffsetX).toBe(0)
    expect(r.topBadgeOffsetY).toBe(0)
  })

  it("top badge scale/offsets: query > mapping > config > server defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ tscale: "120", tox: "5", toy: "-3" }),
      mapping: mapping({ topBadgeScale: 80, topBadgeOffsetX: 1, topBadgeOffsetY: 2 }),
      configOverride: config({ topBadgeScale: 90, topBadgeOffsetX: 3, topBadgeOffsetY: 4 }),
      sd: { topBadgeScale: 70, topBadgeOffsetX: 6, topBadgeOffsetY: 7 },
    }))
    expect(r.topBadgeScale).toBe(120)
    expect(r.topBadgeOffsetX).toBe(5)
    expect(r.topBadgeOffsetY).toBe(-3)
    const rMapping = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ topBadgeScale: 80, topBadgeOffsetX: 1, topBadgeOffsetY: 2 }),
      configOverride: config({ topBadgeScale: 90, topBadgeOffsetX: 3, topBadgeOffsetY: 4 }),
      sd: { topBadgeScale: 70, topBadgeOffsetX: 6, topBadgeOffsetY: 7 },
    }))
    expect(rMapping.topBadgeScale).toBe(80)
    expect(rMapping.topBadgeOffsetX).toBe(1)
    expect(rMapping.topBadgeOffsetY).toBe(2)
    const rConfig = resolvePosterRenderConfig(baseInput({
      configOverride: config({ topBadgeScale: 90, topBadgeOffsetX: 3, topBadgeOffsetY: 4 }),
      sd: { topBadgeScale: 70, topBadgeOffsetX: 6, topBadgeOffsetY: 7 },
    }))
    expect(rConfig.topBadgeScale).toBe(90)
    expect(rConfig.topBadgeOffsetX).toBe(3)
    expect(rConfig.topBadgeOffsetY).toBe(4)
    const rSd = resolvePosterRenderConfig(baseInput({
      sd: { topBadgeScale: 70, topBadgeOffsetX: 6, topBadgeOffsetY: 7 },
    }))
    expect(rSd.topBadgeScale).toBe(70)
    expect(rSd.topBadgeOffsetX).toBe(6)
    expect(rSd.topBadgeOffsetY).toBe(7)
  })

  it("top badge scale/offsets are clamped (R1 anti-DoS)", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tscale: "999999" }) })).topBadgeScale).toBe(200)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tscale: "-50" }) })).topBadgeScale).toBe(10)
    // Non-numerico e 0 ricadono sul default 100 (non null: la scala ha sempre un valore).
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tscale: "abc" }) })).topBadgeScale).toBe(100)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tscale: "0" }) })).topBadgeScale).toBe(100)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tox: "99999" }) })).topBadgeOffsetX).toBe(2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ toy: "-99999" }) })).topBadgeOffsetY).toBe(-2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ tox: "xyz" }) })).topBadgeOffsetX).toBe(0)
  })

  it("genre badge scale defaults to 100; query > mapping > config > server defaults", () => {
    expect(resolvePosterRenderConfig(baseInput()).genreBadgeScale).toBe(100)
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ gscale: "120" }),
      mapping: mapping({ genreBadgeScale: 80 }),
      configOverride: config({ genreBadgeScale: 90 }),
      sd: { genreBadgeScale: 70 },
    }))
    expect(r.genreBadgeScale).toBe(120)
    expect(resolvePosterRenderConfig(baseInput({
      mapping: mapping({ genreBadgeScale: 80 }),
      configOverride: config({ genreBadgeScale: 90 }),
      sd: { genreBadgeScale: 70 },
    })).genreBadgeScale).toBe(80)
    expect(resolvePosterRenderConfig(baseInput({
      configOverride: config({ genreBadgeScale: 90 }),
      sd: { genreBadgeScale: 70 },
    })).genreBadgeScale).toBe(90)
    expect(resolvePosterRenderConfig(baseInput({
      sd: { genreBadgeScale: 70 },
    })).genreBadgeScale).toBe(70)
  })

  it("genre badge scale is clamped (R1 anti-DoS)", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gscale: "999999" }) })).genreBadgeScale).toBe(200)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gscale: "-50" }) })).genreBadgeScale).toBe(10)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gscale: "abc" }) })).genreBadgeScale).toBe(100)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gscale: "0" }) })).genreBadgeScale).toBe(100)
  })

  it("quality badge scale defaults to 100; query > mapping > config > server defaults", () => {
    expect(resolvePosterRenderConfig(baseInput()).qualityBadgeScale).toBe(100)
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ qscale: "120" }),
      mapping: mapping({ qualityBadgeScale: 80 }),
      configOverride: config({ qualityBadgeScale: 90 }),
      sd: { qualityBadgeScale: 70 },
    }))
    expect(r.qualityBadgeScale).toBe(120)
    expect(resolvePosterRenderConfig(baseInput({
      mapping: mapping({ qualityBadgeScale: 80 }),
      configOverride: config({ qualityBadgeScale: 90 }),
      sd: { qualityBadgeScale: 70 },
    })).qualityBadgeScale).toBe(80)
    expect(resolvePosterRenderConfig(baseInput({
      configOverride: config({ qualityBadgeScale: 90 }),
      sd: { qualityBadgeScale: 70 },
    })).qualityBadgeScale).toBe(90)
    expect(resolvePosterRenderConfig(baseInput({
      sd: { qualityBadgeScale: 70 },
    })).qualityBadgeScale).toBe(70)
  })

  it("quality badge scale is clamped (R1 anti-DoS)", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qscale: "999999" }) })).qualityBadgeScale).toBe(200)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qscale: "-50" }) })).qualityBadgeScale).toBe(10)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qscale: "abc" }) })).qualityBadgeScale).toBe(100)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qscale: "0" }) })).qualityBadgeScale).toBe(100)
  })

  it("genre/quality offsets default to 0; query > mapping > config > defaults", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.genreBadgeOffsetX).toBe(0)
    expect(r.genreBadgeOffsetY).toBe(0)
    expect(r.qualityBadgeOffsetX).toBe(0)
    expect(r.qualityBadgeOffsetY).toBe(0)
    const q = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ gox: "5", goy: "-3", qox: "7", qoy: "-9" }),
      mapping: mapping({ genreBadgeOffsetX: 1, genreBadgeOffsetY: 2, qualityBadgeOffsetX: 3, qualityBadgeOffsetY: 4 }),
      configOverride: config({ genreBadgeOffsetX: 10, genreBadgeOffsetY: 11, qualityBadgeOffsetX: 12, qualityBadgeOffsetY: 13 }),
      sd: { genreBadgeOffsetX: 20, genreBadgeOffsetY: 21, qualityBadgeOffsetX: 22, qualityBadgeOffsetY: 23 },
    }))
    expect(q.genreBadgeOffsetX).toBe(5)
    expect(q.genreBadgeOffsetY).toBe(-3)
    expect(q.qualityBadgeOffsetX).toBe(7)
    expect(q.qualityBadgeOffsetY).toBe(-9)
    const m = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ genreBadgeOffsetX: 1, genreBadgeOffsetY: 2, qualityBadgeOffsetX: 3, qualityBadgeOffsetY: 4 }),
      configOverride: config({ genreBadgeOffsetX: 10, genreBadgeOffsetY: 11, qualityBadgeOffsetX: 12, qualityBadgeOffsetY: 13 }),
      sd: { genreBadgeOffsetX: 20, genreBadgeOffsetY: 21, qualityBadgeOffsetX: 22, qualityBadgeOffsetY: 23 },
    }))
    expect(m.genreBadgeOffsetX).toBe(1)
    expect(m.genreBadgeOffsetY).toBe(2)
    expect(m.qualityBadgeOffsetX).toBe(3)
    expect(m.qualityBadgeOffsetY).toBe(4)
    // Zero esplicito in query vince (non cade sul mapping)
    const z = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ gox: "0", qoy: "0" }),
      mapping: mapping({ genreBadgeOffsetX: 1, qualityBadgeOffsetY: 4 }),
    }))
    expect(z.genreBadgeOffsetX).toBe(0)
    expect(z.qualityBadgeOffsetY).toBe(0)
  })

  it("genre/quality offsets are clamped to ±2000px", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gox: "99999" }) })).genreBadgeOffsetX).toBe(2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ goy: "-99999" }) })).genreBadgeOffsetY).toBe(-2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qox: "99999" }) })).qualityBadgeOffsetX).toBe(2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ qoy: "-99999" }) })).qualityBadgeOffsetY).toBe(-2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ gox: "xyz" }) })).genreBadgeOffsetX).toBe(0)
  })

  it("network logo offsets default to 0; query > mapping > config > defaults", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.networkLogoOffsetX).toBe(0)
    expect(r.networkLogoOffsetY).toBe(0)
    const q = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ nox: "5", noy: "-3" }),
      mapping: mapping({ networkLogoOffsetX: 1, networkLogoOffsetY: 2 }),
      configOverride: config({ networkLogoOffsetX: 10, networkLogoOffsetY: 11 }),
      sd: { networkLogoOffsetX: 20, networkLogoOffsetY: 21 },
    }))
    expect(q.networkLogoOffsetX).toBe(5)
    expect(q.networkLogoOffsetY).toBe(-3)
    const m = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ networkLogoOffsetX: 1, networkLogoOffsetY: 2 }),
      configOverride: config({ networkLogoOffsetX: 10, networkLogoOffsetY: 11 }),
      sd: { networkLogoOffsetX: 20, networkLogoOffsetY: 21 },
    }))
    expect(m.networkLogoOffsetX).toBe(1)
    expect(m.networkLogoOffsetY).toBe(2)
    // Zero esplicito in query vince (non cade sul mapping)
    const z = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ nox: "0" }),
      mapping: mapping({ networkLogoOffsetX: 1 }),
    }))
    expect(z.networkLogoOffsetX).toBe(0)
  })

  it("network logo offsets are clamped to ±2000px", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ nox: "99999" }) })).networkLogoOffsetX).toBe(2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ noy: "-99999" }) })).networkLogoOffsetY).toBe(-2000)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ nox: "xyz" }) })).networkLogoOffsetX).toBe(0)
  })

  it("network logo scale defaults to 100; query > mapping > config > server defaults", () => {
    expect(resolvePosterRenderConfig(baseInput()).networkLogoScale).toBe(100)
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ netscale: "120" }),
      mapping: mapping({ networkLogoScale: 80 }),
      configOverride: config({ networkLogoScale: 90 }),
      sd: { networkLogoScale: 70 },
    }))
    expect(r.networkLogoScale).toBe(120)
    expect(resolvePosterRenderConfig(baseInput({
      mapping: mapping({ networkLogoScale: 80 }),
      configOverride: config({ networkLogoScale: 90 }),
      sd: { networkLogoScale: 70 },
    })).networkLogoScale).toBe(80)
    expect(resolvePosterRenderConfig(baseInput({
      configOverride: config({ networkLogoScale: 90 }),
      sd: { networkLogoScale: 70 },
    })).networkLogoScale).toBe(90)
    expect(resolvePosterRenderConfig(baseInput({
      sd: { networkLogoScale: 70 },
    })).networkLogoScale).toBe(70)
  })

  it("network logo scale is clamped (R1 anti-DoS)", () => {
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netscale: "999999" }) })).networkLogoScale).toBe(200)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netscale: "-50" }) })).networkLogoScale).toBe(10)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netscale: "abc" }) })).networkLogoScale).toBe(100)
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URLSearchParams({ netscale: "0" }) })).networkLogoScale).toBe(100)
  })

  it("badgeGenre/badgeYear/badgeRating default to true", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.badgeGenre).toBe(true)
    expect(r.badgeYear).toBe(true)
    expect(r.badgeRating).toBe(true)
  })

  it("query bg/by/br=0 disables the component and wins over mapping/config", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ bg: "0", by: "0", br: "0" }),
      mapping: mapping({ badgeGenre: true, badgeYear: true, badgeRating: true }),
      configOverride: config({ badgeGenre: true, badgeYear: true, badgeRating: true }),
    }))
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(false)
    expect(r.badgeRating).toBe(false)
  })

  it("mapping badgeGenre/badgeYear/badgeRating/badgeQuality wins over config token", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ badgeGenre: false, badgeRating: false, badgeQuality: false }),
      configOverride: config({ badgeGenre: true, badgeRating: true, badgeQuality: true }),
    }))
    expect(r.badgeGenre).toBe(false)
    expect(r.badgeYear).toBe(true)
    expect(r.badgeRating).toBe(false)
    expect(r.badgeQuality).toBe(false)
  })

  it("config token badgeGenre/badgeYear/badgeRating/badgeQuality wins over server defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      configOverride: config({ badgeYear: false, badgeQuality: false }),
      sd: { badgeYear: true, badgeQuality: true },
    }))
    expect(r.badgeYear).toBe(false)
    expect(r.badgeQuality).toBe(false)
    expect(r.badgeGenre).toBe(true)
    expect(r.badgeRating).toBe(true)
  })

  it("preRelease defaults to false; query/config/sd chain wins in order", () => {
    expect(resolvePosterRenderConfig(baseInput()).preRelease).toBe(false)

    const rQuery = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ pre: "1" }),
    }))
    expect(rQuery.preRelease).toBe(true)

    const rQueryOff = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ pre: "0" }),
      configOverride: config({ preRelease: true }),
      sd: { preRelease: true },
    }))
    expect(rQueryOff.preRelease).toBe(false)

    const rConfig = resolvePosterRenderConfig(baseInput({
      configOverride: config({ preRelease: true }),
      sd: { preRelease: false },
    }))
    expect(rConfig.preRelease).toBe(true)

    const rSd = resolvePosterRenderConfig(baseInput({ sd: { preRelease: true } }))
    expect(rSd.preRelease).toBe(true)
  })

  it("customRatings defaults to true; query/mapping/config/sd chain wins in order", () => {
    expect(resolvePosterRenderConfig(baseInput()).customRatings).toBe(true)

    const rQuery = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ cr: "0" }),
      mapping: mapping({ customRatings: true }),
      configOverride: config({ customRatings: true }),
      sd: { customRatings: true },
    }))
    expect(rQuery.customRatings).toBe(false)

    const rMapping = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ customRatings: false }),
      configOverride: config({ customRatings: true }),
      sd: { customRatings: true },
    }))
    expect(rMapping.customRatings).toBe(false)

    const rConfig = resolvePosterRenderConfig(baseInput({
      configOverride: config({ customRatings: false }),
      sd: { customRatings: true },
    }))
    expect(rConfig.customRatings).toBe(false)

    const rSd = resolvePosterRenderConfig(baseInput({ sd: { customRatings: false } }))
    expect(rSd.customRatings).toBe(false)
  })

  it("ratingSources default is ['imdb', 'tmdb'] and query rsrc overrides it", () => {
    const rDef = resolvePosterRenderConfig(baseInput())
    expect(rDef.ratingSources).toEqual(["imdb", "tmdb"])

    const rQuery = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rsrc: "imdb,tomatoes,metacritic" }),
    }))
    expect(rQuery.ratingSources).toEqual(["imdb", "tomatoes", "metacritic"])

    const rConfig = resolvePosterRenderConfig(baseInput({
      configOverride: config({ ratingSources: ["letterboxd", "trakt"] }),
    }))
    expect(rConfig.ratingSources).toEqual(["letterboxd", "trakt"])
  })
})
