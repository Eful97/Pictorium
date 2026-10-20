/**
 * Task C — Lab body-vs-bleed geometry (RED-first).
 *
 * The shared contract is: `w/h` = ACTUAL raster canvas pixels, `bleed/body`
 * = visible-body rect inside that canvas. Placement anchors the BODY (stable
 * across shadow/border/offset/scale overrides); scale/fit helpers resize the
 * real canvas; shadows may only clip at real canvas edges.
 */
import sharp from "sharp"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Resvg } from "@resvg/resvg-js"
import { FONT_FILES } from "@/lib/fonts"
import {
  buildHousePresetSvg,
  buildHouseGenreSvg,
  buildQualityKnockoutSvg,
} from "@/lib/badge-svg-shared"
import { applyHouseAppearance } from "@/lib/badge-house-appearance"
import { buildHousePresetBadgeSVG } from "@/lib/svg-badge"
import type { BadgePreset } from "@/lib/badge-preset"
import {
  generatePosterBuffer,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"

vi.mock("@/lib/badge-preset-store", () => ({
  getPresetForUser: vi.fn(),
}))

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const context = { genre: "Drama", rating: "8.5", year: "2024", rank: "3" }
const scene = { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" as const }
const render = (svg: string) => new Resvg(svg, { font: { fontFiles: [...FONT_FILES], loadSystemFonts: false } }).render().asPng()

function housePreset(
  id: string,
  rev: string,
  target: BadgePreset["target"],
  house: BadgePreset["house"],
): BadgePreset {
  return {
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "H", tags: [] },
    variant: "house",
    house,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: rev,
  } as BadgePreset
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
    rankingEnabled: false,
    genreName: "Dramma",
    voteAverage: 8.5,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: false,
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
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
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
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: 500, height: 750, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

/** Bounding box of strongly-red badge pixels (solid #cc0000 house bg). */
async function redBBox(png: Buffer): Promise<{ left: number; top: number; w: number; h: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let l = info.width, t = info.height, r = -1, b = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) {
        if (x < l) l = x
        if (x > r) r = x
        if (y < t) t = y
        if (y > b) b = y
      }
    }
  }
  if (r < 0) return null
  return { left: l, top: t, w: r - l + 1, h: b - t + 1 }
}

describe("Task C RED: bitmap dims must equal actual raster canvas", () => {
  it("house/top preset w/h match the real PNG pixels, body inside canvas", async () => {
    for (const target of ["genre", "top"] as const) {
      const preset = housePreset("TaskC0000-aa", "aa000001", target, {
        style: "pill",
        scale: 100,
        polarity: "auto",
        appearance: {
          background: { type: "solid", color: "#cc0000", opacity: 100 },
          border: { enabled: true, width: 3, color: "#ffffff", opacity: 100 },
          shadow: { enabled: true, blur: 5, offsetX: -8, offsetY: 4, opacity: 60 },
          widthScale: 130,
          textOffsetX: 2,
          textOffsetY: 3,
        },
      })
      const r = await buildHousePresetBadgeSVG(preset, context, 380, scene)
      expect(r, target).not.toBeNull()
      const meta = await sharp(r!.png).metadata()
      // FULL canvas dims travel with the bitmap through every resize/placement.
      expect(meta.width, `${target} w`).toBe(r!.w)
      expect(meta.height, `${target} h`).toBe(r!.h)
      // Visible body lives strictly inside the canvas (shadow = bleed only).
      const body = r!.bleed!
      expect(body, `${target} bleed`).toBeDefined()
      expect(body.x).toBeGreaterThanOrEqual(0)
      expect(body.y).toBeGreaterThanOrEqual(0)
      expect(body.x + body.w).toBeLessThanOrEqual(r!.w)
      expect(body.y + body.h).toBeLessThanOrEqual(r!.h)
      expect(body.w).toBeLessThan(r!.w)
      expect(body.h).toBeLessThan(r!.h)
    }
  })

  it("shadow variations never move the visible body box", async () => {
    const bodies: Array<{ w: number; h: number }> = []
    for (const [enabled, blur, offsetX, offsetY] of [[false, 0, 0, 0], [true, 4, 0, 3], [true, 40, -50, 50], [true, 0, 50, -50]] as const) {
      const preset = housePreset("TaskC0001-bb", "bb000002", "top", {
        style: "pill",
        scale: 100,
        polarity: "auto",
        appearance: {
          background: { type: "solid", color: "#cc0000", opacity: 100 },
          shadow: { enabled, blur, offsetX, offsetY, opacity: 70 },
        },
      })
      const r = await buildHousePresetBadgeSVG(preset, context, 380, scene)
      const meta = await sharp(r!.png).metadata()
      expect(meta.width).toBe(r!.w)
      expect(meta.height).toBe(r!.h)
      // No appearance padding (shadow off) = no layout: body fills the canvas.
      bodies.push({ w: r!.bleed?.w ?? r!.w, h: r!.bleed?.h ?? r!.h })
    }
    for (const body of bodies) expect(body).toEqual(bodies[0])
  })

  it("extreme bounded values keep body inside a correctly-sized canvas", async () => {
    const preset = housePreset("TaskC0002-cc", "cc000003", "genre", {
      style: "pill",
      scale: 100,
      polarity: "auto",
      appearance: {
        background: { type: "solid", color: "#cc0000", opacity: 100 },
        border: { enabled: true, width: 10, color: "#ffffff", opacity: 100 },
        shadow: { enabled: true, blur: 40, offsetX: -50, offsetY: 50, opacity: 100 },
        widthScale: 50,
        heightScale: 200,
        textOffsetX: -50,
        textOffsetY: 50,
      },
    })
    const r = await buildHousePresetBadgeSVG(preset, context, 380, scene)
    const meta = await sharp(r!.png).metadata()
    expect(meta.width).toBe(r!.w)
    expect(meta.height).toBe(r!.h)
    const body = r!.bleed!
    expect(body.x).toBeGreaterThanOrEqual(0)
    expect(body.y).toBeGreaterThanOrEqual(0)
    expect(body.x + body.w).toBeLessThanOrEqual(r!.w)
    expect(body.y + body.h).toBeLessThanOrEqual(r!.h)
    expect(body.w).toBeGreaterThan(0)
    expect(body.h).toBeGreaterThan(0)
  })

  it("appearance targeting never recolors star paths or knockout masks", () => {
    // Condensed font: the rating star is a real <path> (fill inherits text).
    const condensed = buildHouseGenreSvg({
      genreName: "Drama",
      voteStr: "8.5",
      yearStr: "2024",
      pw: 380,
      style: "pill",
      accentColor: "#555555",
      bottomLight: false,
      parts: { showGenre: true, showRating: true, showYear: true },
      font: "barlow-condensed",
    })
    expect(condensed.svg).toContain("<path d=\"M")
    const recolored = applyHouseAppearance(condensed, {
      background: { type: "solid", color: "#cc0000", opacity: 100 },
      border: { enabled: true, width: 2, color: "#ffffff", opacity: 100 },
    }, 1)
    const starPaths = recolored.svg.match(/<path d="M[^>]*>/g) ?? []
    expect(starPaths.length).toBeGreaterThan(0)
    for (const p of starPaths) expect(p).not.toContain("#cc0000")
    // Knockout: the mask rect/text live in <defs> and must stay intact so the
    // cut-out keeps working after any appearance override.
    const knockout = buildQualityKnockoutSvg("4K", 17)
    const koMaskBefore = knockout.svg.match(/<mask id="qkm">[\s\S]*?<\/mask>/)?.[0] ?? ""
    expect(koMaskBefore).toContain('fill="#ffffff"')
    const koAfter = applyHouseAppearance(knockout, {
      background: { type: "solid", color: "#cc0000", opacity: 100 },
      fontWeight: 400,
      letterSpacing: 2,
      textOffsetX: 3,
      textOffsetY: -3,
    }, 1)
    const koMaskAfter = koAfter.svg.match(/<mask id="qkm">[\s\S]*?<\/mask>/)?.[0] ?? ""
    // The whole mask block (white plate + black glyphs with their own
    // tracking) survives every appearance override byte-identically.
    expect(koMaskAfter).toBe(koMaskBefore)
  })
})

describe("Task C RED: service composite anchors the visible body", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPresetJsonCacheForTests()
  })

  it("shadow on/off does not move the genre body on the final poster", async () => {
    const poster = await darkPoster()
    const plain = housePreset("TaskC0003-dd", "dd000004", "genre", {
      style: "pill",
      scale: 100,
      polarity: "auto",
      appearance: { background: { type: "solid", color: "#cc0000", opacity: 100 } },
    })
    const shadowed = housePreset("TaskC0004-ee", "ee000005", "genre", {
      style: "pill",
      scale: 100,
      polarity: "auto",
      appearance: {
        background: { type: "solid", color: "#cc0000", opacity: 100 },
        shadow: { enabled: true, blur: 5, offsetX: -8, offsetY: 4, opacity: 60 },
      },
    })
    const a = await generatePosterBuffer(baseInput({ posterBuf: poster, badgeFamilyPresets: { genre: plain } }))
    const b = await generatePosterBuffer(baseInput({ posterBuf: poster, badgeFamilyPresets: { genre: shadowed } }))
    const boxA = await redBBox(a)
    const boxB = await redBBox(b)
    expect(boxA).not.toBeNull()
    expect(boxB).not.toBeNull()
    // Same visible body anchor: the shadow pads the canvas but the red body
    // must not jump (tolerance 1px for resampling).
    expect(Math.abs(boxA!.left - boxB!.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(boxA!.top - boxB!.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(boxA!.w - boxB!.w)).toBeLessThanOrEqual(1)
    expect(Math.abs(boxA!.h - boxB!.h)).toBeLessThanOrEqual(1)
  })

  it("service body matches the same builder at service width (Lab parity)", async () => {
    const poster = await darkPoster()
    const preset = housePreset("TaskC0005-ff", "ff000006", "genre", {
      style: "pill",
      scale: 100,
      polarity: "auto",
      appearance: {
        background: { type: "solid", color: "#cc0000", opacity: 100 },
        shadow: { enabled: true, blur: 5, offsetX: -8, offsetY: 4, opacity: 60 },
      },
    })
    const out = await generatePosterBuffer(baseInput({ posterBuf: poster, badgeFamilyPresets: { genre: preset } }))
    const box = await redBBox(out)
    expect(box).not.toBeNull()
    const meta = await sharp(out).metadata()
    const CW = meta.width!
    const CH = meta.height!
    // Same builder the service runs, at the service canvas width.
    const direct = await buildHousePresetBadgeSVG(
      preset,
      { genre: "Dramma", rating: "8.5", year: "", rank: "" },
      CW,
      scene,
    )
    const body = direct!.bleed!
    // Ink box of the direct bitmap (the solid container inside the body;
    // the body itself carries the recipe's native shadow pad, as in Lab).
    const directRaw = await sharp(direct!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let dl = directRaw.info.width, dt = directRaw.info.height, dr = -1, db = -1
    for (let y = 0; y < directRaw.info.height; y++) {
      for (let x = 0; x < directRaw.info.width; x++) {
        const i = (y * directRaw.info.width + x) * 4
        if (directRaw.data[i] > 150 && directRaw.data[i + 1] < 80 && directRaw.data[i + 2] < 80) {
          if (x < dl) dl = x
          if (x > dr) dr = x
          if (y < dt) dt = y
          if (y > db) db = y
        }
      }
    }
    const inkW = dr - dl + 1
    const inkH = db - dt + 1
    // Same ink, same size: the final poster anchors the builder body, so the
    // red container lands at the body anchor plus its in-body offset.
    expect(Math.abs(box!.w - inkW)).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.h - inkH)).toBeLessThanOrEqual(1)
    // Portrait genre anchor: centered body (baseInput targetCenter/gox/goy = 0).
    const bodyLeft = Math.round((CW - body.w) / 2)
    const bodyTop = CH - body.h - Math.max(0, Math.round(0 - body.h / 2))
    expect(Math.abs(box!.left - (bodyLeft - body.x + dl))).toBeLessThanOrEqual(1)
    expect(Math.abs(box!.top - (bodyTop - body.y + dt))).toBeLessThanOrEqual(1)
    // Portrait genre is horizontally centered: body center == canvas center,
    // exactly like the Lab mock zone centers its preview body.
    expect(Math.abs(box!.left + box!.w / 2 - CW / 2)).toBeLessThanOrEqual(2)
    // Lab preview body (pw=380) carries the same contract: canvas == body +
    // symmetric shadow bleed on both widths (shared padding math: ceil on
    // the scaled blur/offset fan-out, 0 bodyPadding here).
    const lab = buildHousePresetSvg(
      { variant: "house", target: "genre", house: preset.house },
      { genre: "Dramma", rating: "8.5", year: "", rank: "" },
      380,
      scene,
    )!
    const labBodyW = lab.layout?.w ?? lab.w
    const labPad = Math.ceil(5 * 3 + Math.max(Math.abs(-8), Math.abs(4)))
    expect(lab.w - labBodyW).toBe(labPad * 2)
    // Cross-width proportionality of the body itself (native rounding only).
    expect(Math.abs(body.w - (labBodyW * CW) / 380)).toBeLessThanOrEqual(Math.ceil(CW / 38))
  })

  it("house preset without appearance stays pixel-identical to native", async () => {
    const poster = await darkPoster()
    const noop = housePreset("TaskC0006-gg", "gg000007", "genre", {
      style: "shadow",
      scale: 100,
      polarity: "auto",
    })
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withNoop = await generatePosterBuffer(baseInput({ posterBuf: poster, badgeFamilyPresets: { genre: noop } }))
    const ra = await sharp(baseline).ensureAlpha().raw().toBuffer()
    const rb = await sharp(withNoop).ensureAlpha().raw().toBuffer()
    expect(ra.length).toBe(rb.length)
    let diff = 0
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) diff++
    expect(diff).toBe(0)
    void render
  })
})
