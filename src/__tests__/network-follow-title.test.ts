/**
 * Network indipendente dal titolo ("Segui il logo del titolo" OFF).
 * ON (default/assente) = layout storico byte-identico; OFF + coordinate =
 * posizione assoluta top-left in px nel canvas per-shape, indifferente a
 * titolo/scala/offset, badge/stili rank, mirror e formato.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  generatePosterBuffer,
  type GenerationInput,
  type NetworkGeometry,
} from "@/lib/poster-service"
import {
  resolvePosterRenderConfig,
  resolveNetworkFollowTitle,
  resolveNetworkFixedCoords,
  resolveLandscapeNetworkOffsets,
} from "@/lib/poster-config"
import { resolveNetworkShapeView, resolveNetworkEffectiveView } from "@/lib/network-follow"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import {
  PRESET_FLAT_TO_LANDSCAPE,
  applyPortraitIsolated,
  landscapeProfilePatch,
  resolveEffectiveLandscape,
} from "@/lib/visual-presets"

async function darkPoster(w = STD_W, h = STD_H): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 80, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer()
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: undefined as never,
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
    badgesEnabled: false,
    rankingEnabled: false,
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
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
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: ["Netflix"],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: ((k: string) => k) as never,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: true,
    sd: { networkLogo: true } satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

async function renderWithGeo(overrides: Partial<GenerationInput> = {}): Promise<{ buf: Buffer; geo: NetworkGeometry | null }> {
  let geo: NetworkGeometry | null = null
  const buf = await generatePosterBuffer(baseInput({
    posterBuf: await darkPoster(),
    logoFetch: await whiteLogo(),
    ...overrides,
    onNetworkGeometry: (g) => { geo = g },
  }))
  return { buf, geo }
}

async function brightCount(buf: Buffer, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = Math.max(0, y0); y < Math.min(info.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(info.width, x1); x++) {
      if (data[(y * info.width + x) * 4] > 150) n++
    }
  }
  return n
}

const testMapping = {
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "",
} as unknown as Mapping

function resolveConfig(query: string | null, extra?: {
  mappingFollow?: boolean | null
  landscapeFollow?: boolean | null
  mappingNox?: number | null
  mappingNoy?: number | null
  landscapeNox?: number | null
  landscapeNoy?: number | null
  sdFollow?: boolean | null
  landscapeSdFollow?: boolean | null
  sdNox?: number | null
  sdNoy?: number | null
  landscapeSdNox?: number | null
  landscapeSdNoy?: number | null
}) {
  const sp = new URLSearchParams(query === null ? "" : query)
  const mapping = extra && (
    extra.mappingFollow !== undefined || extra.landscapeFollow !== undefined
    || extra.mappingNox !== undefined || extra.mappingNoy !== undefined
    || extra.landscapeNox !== undefined || extra.landscapeNoy !== undefined
  )
    ? {
      ...testMapping,
      ...(extra.mappingFollow !== undefined ? { networkLogoFollowTitle: extra.mappingFollow } : {}),
      ...(extra.mappingNox !== undefined ? { networkLogoOffsetX: extra.mappingNox } : {}),
      ...(extra.mappingNoy !== undefined ? { networkLogoOffsetY: extra.mappingNoy } : {}),
      ...((extra.landscapeFollow !== undefined || extra.landscapeNox !== undefined || extra.landscapeNoy !== undefined)
        ? {
          landscape: {
            ...(extra.landscapeFollow !== undefined ? { networkLogoFollowTitle: extra.landscapeFollow } : {}),
            ...(extra.landscapeNox !== undefined ? { networkLogoOffsetX: extra.landscapeNox } : {}),
            ...(extra.landscapeNoy !== undefined ? { networkLogoOffsetY: extra.landscapeNoy } : {}),
          },
        }
        : {}),
    }
    : null
  return resolvePosterRenderConfig({
    searchParams: sp,
    mapping,
    configOverride: null,
    sd: {
      ...(extra?.sdFollow !== undefined ? { networkLogoFollowTitle: extra.sdFollow } : {}),
      ...(extra?.sdNox !== undefined ? { networkLogoOffsetX: extra.sdNox } : {}),
      ...(extra?.sdNoy !== undefined ? { networkLogoOffsetY: extra.sdNoy } : {}),
      ...((extra?.landscapeSdFollow !== undefined || extra?.landscapeSdNox !== undefined || extra?.landscapeSdNoy !== undefined)
        ? {
          landscape: {
            ...(extra.landscapeSdFollow !== undefined ? { networkLogoFollowTitle: extra.landscapeSdFollow } : {}),
            ...(extra.landscapeSdNox !== undefined ? { networkLogoOffsetX: extra.landscapeSdNox } : {}),
            ...(extra.landscapeSdNoy !== undefined ? { networkLogoOffsetY: extra.landscapeSdNoy } : {}),
          },
        }
        : {}),
      // I null runtime (schema PUT li ammette, tipo no) ereditano come assenti.
    } as ServerDefaults,
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  })
}

describe("network follow-title contract", () => {
  it("defaults to follow (historic layout) when absent everywhere", () => {
    expect(resolveConfig(null).networkLogoFollowTitle).toBe(true)
    expect(resolveConfig(null).networkFixedX).toBeNull()
    expect(resolveConfig(null).networkFixedY).toBeNull()
    expect(resolveNetworkFollowTitle(new URLSearchParams(""), null, null, {}, "poster")).toBe(true)
  })

  it("query netFollow wins: 0 forces fixed (with coords), 1 forces follow, garbage follows the toggle pattern", () => {
    expect(resolveConfig("netFollow=0&nox=10&noy=20", { mappingFollow: true, sdFollow: true }).networkLogoFollowTitle).toBe(false)
    expect(resolveConfig("netFollow=1", { mappingFollow: false }).networkLogoFollowTitle).toBe(true)
    // Toggle presente-ma-invalido = true (stesso pattern di netLogo/badges).
    expect(resolveConfig("netFollow=yes", { mappingFollow: false }).networkLogoFollowTitle).toBe(true)
  })

  it("chain: mapping > config(token assente) > defaults > true; false esplicito prevale", () => {
    expect(resolveConfig(null, {
      mappingFollow: false, mappingNox: 1, mappingNoy: 2, sdFollow: true,
    }).networkLogoFollowTitle).toBe(false)
    const sdFixed = resolveConfig(null, {
      sdFollow: false, sdNox: 5, sdNoy: 6, mappingNox: 1, mappingNoy: 2,
    })
    // Layer legacy (relative, senza follow) ignorato: vince il fixed defaults.
    expect(sdFixed.networkLogoFollowTitle).toBe(false)
    expect(sdFixed.networkFixedX).toBe(5)
    expect(sdFixed.networkFixedY).toBe(6)
    expect(resolveConfig(null, { mappingFollow: true, sdFollow: false }).networkLogoFollowTitle).toBe(true)
    expect(resolveNetworkFollowTitle(new URLSearchParams(""), null, null, { networkLogoFollowTitle: false }, "poster")).toBe(false)
    expect(resolveNetworkFollowTitle(
      new URLSearchParams(""), null, null, { networkLogoFollowTitle: true, landscape: { networkLogoFollowTitle: false } }, "landscape",
    )).toBe(false)
    // Il flat eredita in landscape per il toggle (solo le coordinate sono shape-exclusive).
    expect(resolveNetworkFollowTitle(
      new URLSearchParams(""), null, null, { networkLogoFollowTitle: false }, "landscape",
    )).toBe(false)
  })

  it("fixed coords: layer-unit query > shape mapping > shape token > shape defaults", () => {
    const Q = (s: string) => new URLSearchParams(s)
    // Query completa vince su tutto.
    expect(resolveNetworkFixedCoords(Q("nox=100&noy=200"), null, null, {}, "poster")).toEqual({ x: 100, y: 200 })
    // Query parziale o garbage: si ignora del tutto, mai mixing con assi salvati.
    const m = { ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 111, networkLogoOffsetY: 222 }
    expect(resolveNetworkFixedCoords(Q("nox=999"), m, null, {}, "poster")).toEqual({ x: 111, y: 222 })
    expect(resolveNetworkFixedCoords(Q("nox=abc&noy="), m, null, {}, "poster")).toEqual({ x: 111, y: 222 })
    // Mapping fixed completo vince sui defaults.
    expect(resolveNetworkFixedCoords(Q(""), m, null, {
      networkLogoFollowTitle: false, networkLogoOffsetX: 500, networkLogoOffsetY: 600,
    }, "poster")).toEqual({ x: 111, y: 222 })
    // Layer legacy (follow assente) con offset relativi: ignorato come
    // assoluto, si eredita il fixed defaults sottostante.
    const legacyMapping = { ...testMapping, networkLogoOffsetX: 10, networkLogoOffsetY: 20 }
    expect(resolveNetworkFixedCoords(Q(""), legacyMapping, null, {
      networkLogoFollowTitle: false, networkLogoOffsetX: 500, networkLogoOffsetY: 600,
    }, "poster")).toEqual({ x: 500, y: 600 })
    // Layer parziale (solo X) non si mescola: cade sul layer fixed completo sotto.
    const partialMapping = {
      ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 100, networkLogoOffsetY: null,
    }
    expect(resolveNetworkFixedCoords(Q(""), partialMapping, null, {
      networkLogoFollowTitle: false, networkLogoOffsetX: 500, networkLogoOffsetY: 600,
    }, "poster")).toEqual({ x: 500, y: 600 })
    // Portrait: flat fixed; landscape: solo profilo (il flat non leak).
    const both = { ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 700, networkLogoOffsetY: 700 }
    expect(resolveNetworkFixedCoords(Q(""), both, null, {}, "poster")).toEqual({ x: 700, y: 700 })
    expect(resolveNetworkFixedCoords(Q(""), both, null, {}, "landscape")).toEqual({ x: null, y: null })
    const profiled = {
      ...testMapping, networkLogoOffsetX: 700, networkLogoOffsetY: 700,
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 300, networkLogoOffsetY: 100 },
    }
    expect(resolveNetworkFixedCoords(Q(""), profiled, null, {}, "landscape")).toEqual({ x: 300, y: 100 })
    // Profilo con nox esplicite ma follow assente: non è un fixed layer
    // (relative ereditate) → null, mai flat reinterpretato.
    const inheritedRelative = {
      ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 700, networkLogoOffsetY: 700,
      landscape: { networkLogoOffsetX: 310, networkLogoOffsetY: 110 },
    }
    expect(resolveNetworkFixedCoords(Q(""), inheritedRelative, null, {}, "landscape")).toEqual({ x: null, y: null })
  })

  it("token coords apply only to the declared shape (shape guard)", () => {
    const Q = (s: string) => new URLSearchParams(s)
    const portraitTokenBase = {
      networkLogoFollowTitle: false, networkLogoOffsetX: 400, networkLogoOffsetY: 500, posterShape: "poster",
    }
    const portraitToken = portraitTokenBase as never
    const landscapeToken = { ...portraitTokenBase, posterShape: "landscape" } as never
    const shapelessToken = {
      networkLogoFollowTitle: false, networkLogoOffsetX: 400, networkLogoOffsetY: 500,
    } as never
    expect(resolveNetworkFixedCoords(Q(""), null, portraitToken, {}, "poster")).toEqual({ x: 400, y: 500 })
    expect(resolveNetworkFixedCoords(Q(""), null, portraitToken, {}, "landscape")).toEqual({ x: null, y: null })
    expect(resolveNetworkFixedCoords(Q(""), null, landscapeToken, {}, "landscape")).toEqual({ x: 400, y: 500 })
    expect(resolveNetworkFixedCoords(Q(""), null, shapelessToken, {}, "poster")).toEqual({ x: null, y: null })
    expect(resolveNetworkFixedCoords(Q(""), null, shapelessToken, {}, "landscape")).toEqual({ x: null, y: null })
  })

  it("effective follow is ON until the shape configures fixed coords", () => {
    // Spento senza coordinate = incoerente: rende follow.
    expect(resolveConfig("netFollow=0").networkLogoFollowTitle).toBe(true)
    expect(resolveConfig(null, { mappingFollow: false }).networkLogoFollowTitle).toBe(true)
    // Con coordinate (query o salvate) lo spento vale.
    expect(resolveConfig("netFollow=0&nox=100&noy=200").networkLogoFollowTitle).toBe(false)
    expect(resolveConfig(null, {
      mappingFollow: false, mappingNox: 111, mappingNoy: 222,
    }).networkLogoFollowTitle).toBe(false)
    // Landscape senza profilo: ON anche con flat fixed (mai leak cross-shape).
    expect(resolveConfig("shape=landscape", {
      mappingFollow: false, mappingNox: 700, mappingNoy: 700,
    }).networkLogoFollowTitle).toBe(true)
    expect(resolveConfig("shape=landscape", {
      mappingFollow: false, landscapeFollow: false, landscapeNox: 300, landscapeNoy: 100,
    }).networkLogoFollowTitle).toBe(false)
  })

  it("render config exposes follow + fixed coords together", () => {
    const cfg = resolveConfig("netFollow=0&nox=100&noy=200")
    expect(cfg.networkLogoFollowTitle).toBe(false)
    expect(cfg.networkFixedX).toBe(100)
    expect(cfg.networkFixedY).toBe(200)
  })
})

describe("network fixed rendering (service)", () => {
  it("legacy path is byte-identical with follow fields absent vs explicit follow", async () => {
    const a = await renderWithGeo({ queryExtra: "Top 10", rankingBadgeStyle: "default" })
    const b = await renderWithGeo({ queryExtra: "Top 10", rankingBadgeStyle: "default", networkLogoFollowTitle: true })
    expect(b.geo).toEqual(a.geo)
    expect(b.geo?.followTitle).toBe(true)
    expect(b.buf.equals(a.buf)).toBe(true)
  })

  it("ON with leftover coords still applies them as offsets (historic behavior)", async () => {
    const a = await renderWithGeo({ networkLogoOffsetX: 30, networkLogoOffsetY: -20 })
    const b = await renderWithGeo({ networkLogoFollowTitle: true, networkLogoOffsetX: 30, networkLogoOffsetY: -20 })
    expect(b.buf.equals(a.buf)).toBe(true)
    expect(b.geo?.followTitle).toBe(true)
  })

  it("freeze is jump-free: fixed with actuals renders byte-identical buffers", async () => {
    const legacy = await renderWithGeo({ queryExtra: "Top 10", rankingBadgeStyle: "default" })
    expect(legacy.geo).not.toBeNull()
    const frozen = await renderWithGeo({
      queryExtra: "Top 10",
      rankingBadgeStyle: "default",
      networkLogoFollowTitle: false,
      networkFixedX: legacy.geo!.left,
      networkFixedY: legacy.geo!.top,
    })
    expect(frozen.geo).toEqual({ ...legacy.geo!, followTitle: false })
    expect(frozen.buf.equals(legacy.buf)).toBe(true)
  })

  it("fixed position ignores title scale/offset, badge style, netPos and mirror", async () => {
    const at = (overrides: Partial<GenerationInput>) => renderWithGeo({
      queryExtra: "Top 10",
      networkLogoFollowTitle: false,
      networkFixedX: 120,
      networkFixedY: 300,
      ...overrides,
    })
    const base = await at({})
    expect(base.geo).toMatchObject({ top: 300, left: 120, followTitle: false })
    expect(base.geo?.w).toBe(base.geo?.nominalW)
    for (const overrides of [
      { logoScale: 40 },
      { logoScale: 90, logoOffsetX: 60, logoOffsetY: -80 },
      { rankingBadgeStyle: "pill" },
      { rankingBadgeStyle: "corner" },
      { rankingBadgeStyle: "number" },
      { networkLogoPosition: "top" },
      { ribbonSide: "right" },
      { networkLogoScale: 150, networkLogoOffsetX: 40, networkLogoOffsetY: -30 },
    ] as Partial<GenerationInput>[]) {
      const v = await at(overrides as Partial<GenerationInput>)
      // Stesso box, stessa posizione; la scala resta ancorata top-left quindi
      // muove solo w/h, mai top/left.
      expect(v.geo?.top).toBe(300)
      expect(v.geo?.left).toBe(120)
    }
    // La scala muove solo le dimensioni, l'anchor resta.
    const scaled = await at({ networkLogoScale: 150 })
    expect(scaled.geo?.top).toBe(300)
    expect(scaled.geo?.left).toBe(120)
    expect(scaled.geo!.w).toBeGreaterThan(base.geo!.w)
  })

  it("fixed coords pass through unclamped near edges (clipping, no jump)", async () => {
    const edge = await renderWithGeo({
      networkLogoFollowTitle: false,
      networkFixedX: 5,
      networkFixedY: 5,
    })
    expect(edge.geo?.top).toBe(5)
    expect(edge.geo?.left).toBe(5)
    // La pill è davvero lì: pixel chiari nell'angolo.
    expect(await brightCount(edge.buf, 5, 5, 120, 60)).toBeGreaterThan(200)
  })

  it("partial fixed coords fall back to historic layout (no implicit origin)", async () => {
    const legacy = await renderWithGeo({})
    const partial = await renderWithGeo({
      networkLogoFollowTitle: false,
      networkFixedX: 120,
      networkFixedY: null,
    })
    expect(partial.geo?.followTitle).toBe(true)
    expect(partial.buf.equals(legacy.buf)).toBe(true)
  })

  it("collector reports null when the network is not rendered", async () => {
    const off = await renderWithGeo({ networkLogo: false })
    expect(off.geo).toBeNull()
    const nomatch = await renderWithGeo({ tmdbNetworks: ["Unknown Brand XYZ"] })
    expect(nomatch.geo).toBeNull()
  })

  it("landscape fixed is independent from portrait coords and title", async () => {
    const geos: (NetworkGeometry | null)[] = []
    const buf = await generatePosterBuffer(baseInput({
      posterBuf: await darkPoster(768, 432),
      logoFetch: await whiteLogo(),
      shape: "landscape",
      networkLogoFollowTitle: false,
      networkFixedX: 300,
      networkFixedY: 100,
      rankingBadgeStyle: "corner",
      queryExtra: "Top 10",
      onNetworkGeometry: (g) => { geos.push(g) },
    }))
    expect(buf).toBeInstanceOf(Buffer)
    const geo = geos[0]
    expect(geo?.top).toBe(100)
    expect(geo?.left).toBe(300)
    expect(geo?.followTitle).toBe(false)
  })

  it("fixed holds with Coming Soon ribbon and explicit top mode", async () => {
    const at = (overrides: Partial<GenerationInput>) => renderWithGeo({
      networkLogoFollowTitle: false,
      networkFixedX: 120,
      networkFixedY: 300,
      ...overrides,
    })
    const coming = await at({ preRelease: true, releaseDate: "2099-01-01" })
    expect(coming.geo?.top).toBe(300)
    expect(coming.geo?.left).toBe(120)
    const forcedTop = await at({ networkLogoPosition: "top" })
    expect(forcedTop.geo?.top).toBe(300)
    expect(forcedTop.geo?.left).toBe(120)
  })

  it("freeze after auto-shrink keeps position and size via effective scale", async () => {
    // Senza logo titolo + badge extra centrato sopra la pill top-left: lo
    // shrink anti-overlap riduce il bitmap (actual < nominal).
    const legacy = await renderWithGeo({
      logoFetch: null,
      queryExtra: "Top 10",
      rankingBadgeStyle: "default",
      networkLogoScale: 200,
    })
    expect(legacy.geo).not.toBeNull()
    expect(legacy.geo!.w).toBeLessThanOrEqual(legacy.geo!.nominalW)
    if (legacy.geo!.w === legacy.geo!.nominalW) {
      // Senza shrink il freeze semplice basta (copertura freeze sopra).
      expect(legacy.geo!.followTitle).toBe(true)
      return
    }
    // Scala effettiva = base * actual/nominal (ancora top-left, linearità
    // pre-clamp canvas): il freeze non salta né in posizione né in dimensioni.
    const effScale = Math.min(200, Math.max(10, Math.round(200 * legacy.geo!.w / legacy.geo!.nominalW)))
    const frozen = await renderWithGeo({
      logoFetch: null,
      queryExtra: "Top 10",
      rankingBadgeStyle: "default",
      networkLogoScale: effScale,
      networkLogoFollowTitle: false,
      networkFixedX: legacy.geo!.left,
      networkFixedY: legacy.geo!.top,
    })
    expect(frozen.geo?.top).toBe(legacy.geo!.top)
    expect(frozen.geo?.left).toBe(legacy.geo!.left)
    expect(frozen.geo?.w).toBe(legacy.geo!.w)
    expect(frozen.buf.equals(legacy.buf)).toBe(true)
  })
})

describe("network follow server contract (persistence/urls/cache)", () => {
  const cfgInput = {
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  } as const

  it("token and defaults alone drive fixed (no mapping)", () => {
    // Token fixed completo con shape dichiarata: vale per quella shape.
    const viaToken = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(""),
      mapping: null,
      configOverride: {
        networkLogoFollowTitle: false, networkLogoOffsetX: 400, networkLogoOffsetY: 500, posterShape: "poster",
      } as never,
      sd: {},
      ...cfgInput,
    })
    expect(viaToken.networkLogoFollowTitle).toBe(false)
    expect(viaToken.networkFixedX).toBe(400)
    expect(viaToken.networkFixedY).toBe(500)
    // Token portrait su render landscape: nessun leak (shape guard).
    const tokenLand = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("shape=landscape"),
      mapping: null,
      configOverride: {
        networkLogoFollowTitle: false, networkLogoOffsetX: 400, networkLogoOffsetY: 500, posterShape: "poster",
      } as never,
      sd: {},
      ...cfgInput,
    })
    expect(tokenLand.networkLogoFollowTitle).toBe(true)
    expect(tokenLand.networkFixedX).toBeNull()
    const viaDefaults = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(""),
      mapping: null,
      configOverride: null,
      sd: { networkLogoFollowTitle: false, networkLogoOffsetX: 111, networkLogoOffsetY: 222 },
      ...cfgInput,
    })
    expect(viaDefaults.networkLogoFollowTitle).toBe(false)
    expect(viaDefaults.networkFixedX).toBe(111)
    expect(viaDefaults.networkFixedY).toBe(222)
  })

  it("explicit ON overrides fixed mapping and defaults", () => {
    const cfg = resolveConfig("netFollow=1", {
      mappingFollow: false, mappingNox: 111, mappingNoy: 222, sdFollow: false,
    })
    expect(cfg.networkLogoFollowTitle).toBe(true)
  })

  it("legacy dv signature is pinned; follow toggle never enters it", () => {
    const legacy = buildStremioPosterSearchParams({ compactTuning: true })
    // Fixture esatta: qualsiasi cambio a parti/algoritmo invalida i dv
    // storici (bump intenzionale, mai silenzioso).
    expect(legacy.get("dv")).toBe("76947925")
    const off = buildStremioPosterSearchParams({ compactTuning: true, networkLogoFollowTitle: false })
    const on = buildStremioPosterSearchParams({ compactTuning: true, networkLogoFollowTitle: true })
    // Toggle esplicito: stessa firma (bassa cardinalità, viaggia esplicito).
    expect(off.get("dv")).toBe(legacy.get("dv"))
    expect(on.get("dv")).toBe(legacy.get("dv"))
    expect(off.get("netFollow")).toBe("0")
    expect(on.get("netFollow")).toBeNull()
    expect(legacy.get("netFollow")).toBeNull()
    // URL espliciti legacy: nessuna chiave netFollow con campo assente/true.
    const explicit = buildStremioPosterSearchParams({ networkLogoScale: 100 })
    expect(explicit.get("netFollow")).toBeNull()
  })

  it("cache keys separate netFollow states without collisions", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("netFollow")).toBe(true)
    const base = "netscale=100&nox=10&noy=20"
    const absent = normalizePosterCacheParams(new URLSearchParams(base))
    const off = normalizePosterCacheParams(new URLSearchParams(`${base}&netFollow=0`))
    const on = normalizePosterCacheParams(new URLSearchParams(`${base}&netFollow=1`))
    expect(absent.get("netFollow")).toBeNull()
    expect(off.get("netFollow")).toBe("0")
    expect(on.get("netFollow")).toBe("1")
    expect(new Set([absent.toString(), off.toString(), on.toString()]).size).toBe(3)
  })

  it("presets hardening keeps netFollow OFF on public non-preview", () => {
    const hardened = hardenPosterSearchParams(new URLSearchParams("netFollow=0&nox=12&noy=34"), {
      presets: true, preview: false, anonymous: true, publicInstance: true,
      hasMapping: false, mappingCustomBadge: null,
    })
    expect(hardened.get("netFollow")).toBe("0")
    // Preview resta esente (valori esatti per gli slider live).
    const live = hardenPosterSearchParams(new URLSearchParams("netFollow=0&nox=12&noy=34"), {
      presets: true, preview: true, anonymous: true, publicInstance: true,
      hasMapping: false, mappingCustomBadge: null,
    })
    expect(live.get("netFollow")).toBe("0")
    expect(live.get("nox")).toBe("12")
  })

  it("visual presets migrate: legacy without the field parses, map carries it", () => {
    expect(PRESET_FLAT_TO_LANDSCAPE.defaultNetworkLogoFollowTitle).toBe("networkLogoFollowTitle")
    const eff = resolveEffectiveLandscape({
      defaultNetworkLogoFollowTitle: false,
      landscape: { networkLogoFollowTitle: false },
    } as never)
    expect(eff.networkLogoFollowTitle).toBe(false)
    const inherited = resolveEffectiveLandscape({
      defaultNetworkLogoFollowTitle: false,
      landscape: {},
    } as never)
    expect(inherited.networkLogoFollowTitle).toBe(false)
  })

  it("preset legacy ON isolation: relative offsets keep derive/freeze, fixed skips", () => {
    // Legacy ON (nessun follow): derive e freeze originali, identici a HEAD.
    const legacyON = { defaultNetworkLogoOffsetX: 30, defaultNetworkLogoOffsetY: -20, landscape: {} } as never
    expect(resolveEffectiveLandscape(legacyON).networkLogoOffsetX).toBe(30)
    expect(resolveEffectiveLandscape(legacyON).networkLogoOffsetY).toBe(-20)
    expect(landscapeProfilePatch(legacyON).networkLogoOffsetX).toBe(30)
    const frozen = applyPortraitIsolated(
      { defaultNetworkLogoOffsetX: 30, landscape: {} } as never,
      { defaultNetworkLogoOffsetX: 50 } as never,
    )
    expect((frozen.landscape as Record<string, unknown>).networkLogoOffsetX).toBe(30)
    // Flat fixed: niente derive né freeze (mai fake fixed landscape).
    const fixedFlat = {
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 200,
      defaultNetworkLogoOffsetY: 500,
      landscape: {},
    } as never
    expect(resolveEffectiveLandscape(fixedFlat).networkLogoOffsetX).toBeUndefined()
    expect(resolveEffectiveLandscape(fixedFlat).networkLogoFollowTitle).toBe(false)
    expect(landscapeProfilePatch(fixedFlat).networkLogoOffsetX).toBeUndefined()
    const frozenFixed = applyPortraitIsolated(fixedFlat, { defaultNetworkLogoOffsetX: 210 } as never)
    expect((frozenFixed.landscape as Record<string, unknown>).networkLogoOffsetX).toBeUndefined()
  })

  it("catalog URL carries mapping follow-off, omits it otherwise", () => {
    const mk = (mapping: Mapping | null) =>
      buildStremioPosterUrl({
        origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping, lang: "it",
      }).toString()
    expect(mk(null)).not.toContain("netFollow=")
    const fixed = mk({ ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 50, networkLogoOffsetY: 60 })
    expect(fixed).toContain("netFollow=0")
  })

  it("stremio non-compact emits resolved absolutes when fixed, legacy offsets otherwise", () => {
    // Portrait fixed via mapping: nox/noy assoluti + netFollow=0 anche in chiaro.
    const fixed = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: { ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 50, networkLogoOffsetY: 60 },
      lang: "it",
    })
    // Compact di default (senza config): tuning omesso, dv copre.
    expect(fixed.searchParams.get("netFollow")).toBe("0")
    expect(fixed.searchParams.has("nox")).toBe(false)
    const plain = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping: null, lang: "it",
    })
    expect(plain.searchParams.has("netFollow")).toBe(false)
    expect(fixed.searchParams.get("dv")).not.toBe(plain.searchParams.get("dv"))
    // Non-compact (con config): assoluti risolti in chiaro + netFollow=0.
    const explicit = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: { ...testMapping, networkLogoFollowTitle: false, networkLogoOffsetX: 50, networkLogoOffsetY: 60 },
      lang: "it", config: "tok",
    })
    expect(explicit.searchParams.get("netFollow")).toBe("0")
    expect(explicit.searchParams.get("nox")).toBe("50")
    expect(explicit.searchParams.get("noy")).toBe("60")
  })
})

describe("network follow defaults preview (no cross-shape leak)", () => {
  function previewParams(extra: Record<string, unknown> = {}, shape?: "portrait" | "landscape") {
    const url = buildDefaultsPreviewUrl({ ...extra, ...(shape ? { previewShape: shape } : {}) } as never)
    return new URL(url).searchParams
  }

  it("legacy defaults: no netFollow key, nox/noy legacy exact", () => {
    const p = previewParams()
    expect(p.has("netFollow")).toBe(false)
    expect(p.get("nox")).toBe("0")
    expect(p.get("noy")).toBe("0")
  })

  it("portrait fixed flat (no landscape profile): portrait absolute, landscape explicit ON", () => {
    const flat = { defaultNetworkLogoFollowTitle: false, defaultNetworkLogoOffsetX: 100, defaultNetworkLogoOffsetY: 200 }
    const portrait = previewParams(flat, "portrait")
    expect(portrait.get("netFollow")).toBe("0")
    expect(portrait.get("nox")).toBe("100")
    expect(portrait.get("noy")).toBe("200")
    // Landscape senza profilo: ON esplicito, niente coordinate portrait.
    const land = previewParams(flat, "landscape")
    expect(land.get("netFollow")).toBe("1")
    // Server roundtrip con defaults storici (ON): resta ON.
    const back = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(`shape=landscape&netFollow=1&nox=${land.get("nox")}&noy=${land.get("noy")}`),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(back.networkLogoFollowTitle).toBe(true)
  })

  it("portrait fixed roundtrips against the fixed defaults", () => {
    const flat = { defaultNetworkLogoFollowTitle: false, defaultNetworkLogoOffsetX: 100, defaultNetworkLogoOffsetY: 200 }
    const portrait = previewParams(flat, "portrait")
    const back = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(`netFollow=0&nox=${portrait.get("nox")}&noy=${portrait.get("noy")}`),
      mapping: null,
      configOverride: null,
      sd: {
        networkLogoFollowTitle: false, networkLogoOffsetX: 100, networkLogoOffsetY: 200,
      },
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(back.networkLogoFollowTitle).toBe(false)
    expect(back.networkFixedX).toBe(100)
    expect(back.networkFixedY).toBe(200)
  })

  it("landscape dedicated fixed profile renders fixed only in landscape", () => {
    const prof = {
      defaultNetworkLogoFollowTitle: true,
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 300, networkLogoOffsetY: 100 },
    }
    const land = previewParams(prof, "landscape")
    expect(land.get("netFollow")).toBe("0")
    expect(land.get("nox")).toBe("300")
    expect(land.get("noy")).toBe("100")
    const portrait = previewParams(prof, "portrait")
    expect(portrait.get("netFollow")).toBe("1")
  })

  it("landscape ON never inherits portrait absolutes as relative offsets", () => {
    // Flat fixed portrait (200,500), nessun profilo: la preview landscape
    // emette ON esplicito e offset neutri (mai +200/+500).
    const flat = { defaultNetworkLogoFollowTitle: false, defaultNetworkLogoOffsetX: 200, defaultNetworkLogoOffsetY: 500 }
    const land = previewParams(flat, "landscape")
    expect(land.get("netFollow")).toBe("1")
    expect(land.get("nox")).toBe("0")
    expect(land.get("noy")).toBe("0")
    // Roundtrip server: ON storico senza alcuno shift.
    const back = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(`shape=landscape&netFollow=1&nox=0&noy=0`),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(back.networkLogoFollowTitle).toBe(true)
    expect(back.networkLogoOffsetX).toBe(0)
    expect(back.networkLogoOffsetY).toBe(0)
    // Stremio builder: stessa protezione in dv ed esplicito.
    const catalog = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 },
      mapping: null, lang: "it", forceShape: "landscape",
    })
    expect(catalog.searchParams.has("netFollow")).toBe(false)
  })

  it("explicit ON override of fixed defaults carries zero offsets (mode reset)", () => {
    // netFollow=1 senza nuovi offset: gli assoluti dei defaults non devono
    // diventare relativi (scegli 0,0 allo switch di modalità).
    const portrait = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("netFollow=1"),
      mapping: null,
      configOverride: null,
      sd: { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 },
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(portrait.networkLogoFollowTitle).toBe(true)
    expect(portrait.networkLogoOffsetX).toBe(0)
    expect(portrait.networkLogoOffsetY).toBe(0)
    const land = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("shape=landscape&netFollow=1"),
      mapping: null,
      configOverride: null,
      sd: { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 },
      hasQuery: true, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(land.networkLogoFollowTitle).toBe(true)
    expect(land.networkLogoOffsetX).toBe(0)
    expect(land.networkLogoOffsetY).toBe(0)
  })

  it("landscape offsets exclude fixed layers unless query explicit", () => {
    const Q = (s: string) => new URLSearchParams(s)
    // Profilo fixed + query ON: gli assoluti non rientrano come relativi.
    const fixedProfile = {
      ...testMapping,
      landscape: { networkLogoFollowTitle: false, networkLogoOffsetX: 300, networkLogoOffsetY: 100 },
    }
    expect(resolveLandscapeNetworkOffsets(Q("netFollow=1"), fixedProfile, null, {})).toEqual({ x: 0, y: 0 })
    // ...salvo query nox/noy esplicita, che vince sempre.
    expect(resolveLandscapeNetworkOffsets(Q("netFollow=1&nox=50&noy=60"), fixedProfile, null, {}))
      .toEqual({ x: 50, y: 60 })
    // Token shapeless con follow spento: escluso dai relativi.
    const shapeless = { networkLogoFollowTitle: false, networkLogoOffsetX: 400, networkLogoOffsetY: 500 } as never
    expect(resolveLandscapeNetworkOffsets(Q(""), null, shapeless, {})).toEqual({ x: 0, y: 0 })
    // Token ON/assente: legacy invariato.
    const plainToken = { networkLogoOffsetX: 40, networkLogoOffsetY: 50 } as never
    expect(resolveLandscapeNetworkOffsets(Q(""), null, plainToken, {})).toEqual({ x: 40, y: 50 })
    // Profilo ON con tweak: relativi preservati.
    const tweaked = { ...testMapping, landscape: { networkLogoOffsetX: 30, networkLogoOffsetY: -20 } }
    expect(resolveLandscapeNetworkOffsets(Q(""), tweaked, null, {})).toEqual({ x: 30, y: -20 })
  })
})

describe("resolveNetworkShapeView (UI bindings)", () => {
  it("portrait-fixed flat without landscape profile reads ON with 0,0", () => {
    const flat = { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 }
    const view = resolveNetworkShapeView(flat, null, "landscape")
    expect(view.follow).toBe(true)
    expect(view.fixedX).toBeNull()
    expect(view.fixedY).toBeNull()
    expect(view.relativeX).toBe(0)
    expect(view.relativeY).toBe(0)
  })

  it("complete landscape profile reads OFF with its absolutes", () => {
    const flat = { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 }
    const profile = { networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300 }
    const view = resolveNetworkShapeView(flat, profile, "landscape")
    expect(view.follow).toBe(false)
    expect(view.fixedX).toBe(120)
    expect(view.fixedY).toBe(300)
  })

  it("profile OFF without coords reads ON (never a false with missing coords)", () => {
    const flat = { networkLogoFollowTitle: true, networkLogoOffsetX: 0, networkLogoOffsetY: 0 }
    const profile = { networkLogoFollowTitle: false }
    const view = resolveNetworkShapeView(flat, profile, "landscape")
    expect(view.follow).toBe(true)
  })

  it("portrait mirrors the flat layer", () => {
    expect(resolveNetworkShapeView(
      { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 },
      null,
      "poster",
    )).toMatchObject({ follow: false, fixedX: 200, fixedY: 500 })
    expect(resolveNetworkShapeView(
      { networkLogoFollowTitle: true, networkLogoOffsetX: 11, networkLogoOffsetY: -4 },
      null,
      "poster",
    )).toMatchObject({ follow: true, relativeX: 11, relativeY: -4 })
  })
})

describe("resolveNetworkEffectiveView (mapping + defaults)", () => {
  const fixedFlat = { networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500 }

  it("mapping without network fields falls back to the defaults view", () => {
    // Landscape: flat fixed absolutes never leak — ON with 0,0.
    expect(resolveNetworkEffectiveView({}, fixedFlat, null, "landscape"))
      .toMatchObject({ follow: true, relativeX: 0, relativeY: 0 })
    // Portrait: the fixed box applies.
    expect(resolveNetworkEffectiveView({}, fixedFlat, null, "poster"))
      .toMatchObject({ follow: false, fixedX: 200, fixedY: 500 })
  })

  it("complete mapping overrides always win", () => {
    const landFixed = { networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300 }
    expect(resolveNetworkEffectiveView({ landscape: landFixed }, fixedFlat, null, "landscape"))
      .toMatchObject({ follow: false, fixedX: 120, fixedY: 300 })
    expect(resolveNetworkEffectiveView(
      { networkLogoFollowTitle: false, networkLogoOffsetX: 120, networkLogoOffsetY: 300 },
      fixedFlat,
      null,
      "poster",
    )).toMatchObject({ follow: false, fixedX: 120, fixedY: 300 })
  })

  it("mapping ON with relatives wins over fixed defaults", () => {
    expect(resolveNetworkEffectiveView(
      { networkLogoFollowTitle: true, networkLogoOffsetX: 30, networkLogoOffsetY: -20 },
      fixedFlat,
      null,
      "poster",
    )).toMatchObject({ follow: true, relativeX: 30, relativeY: -20 })
  })
})
