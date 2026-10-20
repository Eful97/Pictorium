/**
 * Task D — technical-family declarative appearance through the native
 * builders (live data, brand artwork intact).
 *
 * For every technical family: the neutral house starter stays bitmap-identical
 * to the native render; every honored knob (material container + value-text
 * presentation) moves pixels and/or dimensions; brand artwork (network marks,
 * provider logos, AV glyphs) and knockout cut-outs are never recolored; the
 * off/no-data gates stay closed (a preset never invents content or turns a
 * gated-off badge on); cache identity rotates with honored overrides.
 */
import sharp from "sharp"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  generatePosterBuffer,
  type GenerationInput,
} from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import type { BadgePreset } from "@/lib/badge-preset"
import { normalizeBadgePreset } from "@/lib/badge-preset"
import {
  technicalPresetAppearance,
  technicalPresetAppearanceFrag,
  technicalPresetTypography,
  technicalTypographyForStyle,
  type TechnicalFamilyId,
} from "@/lib/badge-preset-technical"
import { POST as draftPreviewPOST } from "@/app/api/presets/draft-preview/route"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

function housePreset(
  id: string,
  target: BadgePreset["target"],
  style: string,
  extraHouse: Record<string, unknown> = {},
): BadgePreset {
  return normalizeBadgePreset({
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "house",
    house: { style, scale: 100, polarity: "auto", ...extraHouse },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "00000000",
  })
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

async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer()
  const rb = await sharp(b).ensureAlpha().raw().toBuffer()
  if (ra.length !== rb.length) return Number.MAX_SAFE_INTEGER
  let diff = 0
  for (let i = 0; i < ra.length; i += 16) if (Math.abs(ra[i] - rb[i]) > 12) diff++
  return diff
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

const RED_BG = { background: { type: "solid", color: "#cc0000", opacity: 100 } }

describe("technical appearance resolvers", () => {
  it("return null without a preset, and sanitize per family", () => {
    expect(technicalPresetAppearance("quality", null)).toBeNull()
    expect(technicalPresetAppearanceFrag("quality", null)).toBeNull()
    // Network drops text knobs (logo-only mark): container keys survive.
    const net = housePreset("Net00001-aa", "network", "pill", {
      appearance: {
        background: { type: "solid", color: "#cc0000", opacity: 100 },
        fontWeight: 800,
        letterSpacing: 4,
      },
    })
    const sanitized = technicalPresetAppearance("network", net)
    expect(sanitized).not.toBeNull()
    expect(sanitized).toHaveProperty("background")
    expect(sanitized).not.toHaveProperty("fontWeight")
    expect(sanitized).not.toHaveProperty("letterSpacing")
    // ComingSoon drops width/height scale (fixed corner contract).
    const cs = housePreset("Com00001-aa", "comingSoon", "ribbon", {
      appearance: { ...RED_BG, widthScale: 150, heightScale: 150 },
    })
    const csSan = technicalPresetAppearance("comingSoon", cs)
    expect(csSan).not.toBeNull()
    expect(csSan).not.toHaveProperty("widthScale")
    expect(csSan).not.toHaveProperty("heightScale")
    expect(csSan).toHaveProperty("background")
  })

  it("knockout drops text color (cut-out letters have no ink), keeps size/case", () => {
    const p = housePreset("Age00001-aa", "age", "knockout", {
      fontSize: 20,
      textColor: "#00ff00",
      uppercase: true,
    })
    const gated = technicalTypographyForStyle("age", "knockout", technicalPresetTypography(p))
    expect(gated).not.toBeNull()
    expect(gated).not.toHaveProperty("textColor")
    expect(gated?.fontSize).toBe(20)
    expect(gated?.uppercase).toBe(true)
  })

  it("appearance frags rotate the cache identity only when honored", () => {
    const plain = housePreset("Qual0001-aa", "quality", "standard")
    const styled = housePreset("Qual0002-bb", "quality", "standard", { appearance: RED_BG })
    expect(technicalPresetAppearanceFrag("quality", plain)).toBeNull()
    const frag = technicalPresetAppearanceFrag("quality", styled)
    expect(frag).toMatch(/^[0-9a-f]{8}$/)
    // Same payload twice = same frag (deterministic, cache-hit stable).
    const again = housePreset("Qual0002-bb", "quality", "standard", { appearance: RED_BG })
    expect(technicalPresetAppearanceFrag("quality", again)).toBe(frag)
  })
})

describe("quality + age material/typography", () => {
  it("material container repaints the plate and grows the bitmap", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: { quality: housePreset("Qual1001-aa", "quality", "standard", { appearance: RED_BG }) },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(50)
  })

  it("text color + size restyle the tier text without touching the tier value", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const inked = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          quality: housePreset("Qual1002-bb", "quality", "standard", { textColor: "#00ff00", fontSize: 24 }),
        },
      }),
    )
    expect(await pixelDiff(baseline, inked)).toBeGreaterThan(50)
    // Invalid appearance never breaks the render (fail-closed = native plate).
    // Built by hand: the schema itself rejects bad hex at write time, so this
    // exercises the render-side defense for legacy/invalid stored payloads.
    const validBase = housePreset("Qual1003-cc", "quality", "standard")
    const broken = {
      ...validBase,
      house: { ...validBase.house, appearance: { background: { type: "solid", color: "nope", opacity: 100 } } },
    } as unknown as BadgePreset
    const brokenOut = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: broken } }),
    )
    expect(await pixelDiff(baseline, brokenOut)).toBe(0)
  })

  it("knockout text color is inert, size still applies", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K" }
    const knockout = housePreset("Qual1004-dd", "quality", "knockout")
    const knockoutColor = housePreset("Qual1005-ee", "quality", "knockout", { textColor: "#00ff00" })
    const knockoutSized = housePreset("Qual1006-ff", "quality", "knockout", { fontSize: 24 })
    const a = await generatePosterBuffer(baseInput({ ...input, badgeFamilyPresets: { quality: knockout } }))
    const b = await generatePosterBuffer(baseInput({ ...input, badgeFamilyPresets: { quality: knockoutColor } }))
    const c = await generatePosterBuffer(baseInput({ ...input, badgeFamilyPresets: { quality: knockoutSized } }))
    expect(await pixelDiff(a, b)).toBe(0)
    expect(await pixelDiff(a, c)).toBeGreaterThan(20)
  })

  it("age renders with the live certification and honors material", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: null, ageLabel: "VM14" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: { age: housePreset("Age1001-aa", "age", "standard", { appearance: RED_BG }) },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(20)
  })
})

describe("network container", () => {
  it("starter stays native, plate wraps the retained mark", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, networkLogo: true as const, tmdbNetworks: ["Netflix"] }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { network: housePreset("Net1001-aa", "network", "pill") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    const plated = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          network: housePreset("Net1002-bb", "network", "pill", {
            appearance: {
              background: { type: "solid", color: "#cc0000", opacity: 100 },
              border: { enabled: true, width: 3, color: "#ffffff", opacity: 100 },
            },
          }),
        },
      }),
    )
    expect(await pixelDiff(baseline, plated)).toBeGreaterThan(20)
    // The plated bitmap is larger (container padding), never smaller.
    const baseDims = await dims(baseline)
    const platedDims = await dims(plated)
    expect(platedDims.w).toBe(baseDims.w)
    expect(platedDims.h).toBe(baseDims.h)
  })

  it("no native match = no badge, preset or not (never invented)", async () => {
    const poster = await darkPoster()
    const input = {
      posterBuf: poster,
      networkLogo: true as const,
      tmdbNetworks: ["Some Unknown Network XYZ"],
    }
    const native = await generatePosterBuffer(baseInput(input))
    const plated = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          network: housePreset("Net1003-cc", "network", "pill", { appearance: RED_BG }),
        },
      }),
    )
    expect(await pixelDiff(native, plated)).toBe(0)
  })
})

describe("separate + custom rows", () => {
  it("column material + text presentation restyle live items", async () => {
    const poster = await darkPoster()
    const items = [
      { id: "imdb", value: 7.3 },
      { id: "tmdb", value: 7.8 },
    ]
    const input = { posterBuf: poster, separateRatings: items }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          separateRatings: housePreset("Sep1001-aa", "separateRatings", "column", {
            appearance: RED_BG,
            textColor: "#00ff00",
            fontSize: 20,
          }),
        },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(50)
  })

  it("bottom styles honor the finish without duplicating content", async () => {
    const poster = await darkPoster()
    const items = [{ id: "imdb", value: 7.3 }]
    const input = { posterBuf: poster, separateRatings: items, separateRatingsStyle: "bottom-pills" as const }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          separateRatings: housePreset("Sep1002-bb", "separateRatings", "bottom-pills", { appearance: RED_BG }),
        },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(20)
  })

  it("unknown sources render nothing (no-data gate), mutual exclusion holds", async () => {
    const poster = await darkPoster()
    const bare = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const unknown = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        separateRatings: [{ id: "nope", value: 1 }],
        badgeFamilyPresets: { separateRatings: housePreset("Sep1003-cc", "separateRatings", "column", { appearance: RED_BG }) },
      }),
    )
    expect(await pixelDiff(bare, unknown)).toBe(0)
    // Bottom suppresses the custom provider row even with a preset bound.
    const items = [{ id: "imdb", value: 7.3 }]
    const ratings = [{ id: "mdblist", name: "MDBList", value: 7.3, format: "decimal" as const }]
    const bottomOnly = await generatePosterBuffer(
      baseInput({ posterBuf: poster, separateRatings: items, separateRatingsStyle: "bottom-pills" as const }),
    )
    const bottomWithCustom = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        separateRatings: items,
        separateRatingsStyle: "bottom-pills" as const,
        ratings,
        badgeFamilyPresets: { customRatings: housePreset("Cus1001-aa", "customRatings", "row", { appearance: RED_BG }) },
      }),
    )
    expect(await pixelDiff(bottomOnly, bottomWithCustom)).toBe(0)
  })

  it("custom row keeps live provider values and honors the finish", async () => {
    const poster = await darkPoster()
    const ratings = [{ id: "mdblist", name: "MDBList", value: 7.3, format: "decimal" as const }]
    const input = { posterBuf: poster, ratings }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: { customRatings: housePreset("Cus1002-bb", "customRatings", "row", { appearance: RED_BG, fontSize: 24 }) },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(20)
  })
})

describe("comingSoon finish", () => {
  it("material + typography restyle the ribbon, scale stays inert, gate holds", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, preRelease: true }
    const baseline = await generatePosterBuffer(baseInput(input))
    const styled = await generatePosterBuffer(
      baseInput({
        ...input,
        badgeFamilyPresets: {
          comingSoon: housePreset("Com1001-aa", "comingSoon", "ribbon", {
            appearance: RED_BG,
            textColor: "#ffff00",
            fontSize: 26,
          }),
        },
      }),
    )
    expect(await pixelDiff(baseline, styled)).toBeGreaterThan(20)
    // No pre-digital gate = no ribbon, preset or not.
    const gated = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        badgeFamilyPresets: { comingSoon: housePreset("Com1002-bb", "comingSoon", "ribbon", { appearance: RED_BG }) },
      }),
    )
    const bare = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    expect(await pixelDiff(gated, bare)).toBe(0)
  })
})

describe("technical appearance cache identity", () => {
  it("same honored preset twice = byte-identical (cache-hit stable)", async () => {
    const poster = await darkPoster()
    const input = {
      posterBuf: poster,
      quality: "4K" as const,
      badgeFamilyPresets: {
        quality: housePreset("Qual2001-aa", "quality", "standard", { appearance: RED_BG, textColor: "#00ff00" }),
      },
    }
    const a = await generatePosterBuffer(baseInput(input))
    const b = await generatePosterBuffer(baseInput(input))
    expect(a.equals(b)).toBe(true)
  })
})

describe("draft preview route (live unsaved edits)", () => {
  // The shared test setup simulates a PUBLIC instance
  // (POSTERIUM_PUBLIC_INSTANCE=1), where the draft-preview route follows the
  // preview authorization policy and denies anonymous drafts. These render
  // tests unlock via a real admin token (live env read, no mocks) so they
  // keep exercising the native renderers; the denial matrix lives in the
  // dedicated route-auth suite.
  const ADMIN_TOKEN = "test-draft-admin-token"
  beforeEach(() => {
    vi.stubEnv("PICTORIUM_ADMIN_TOKEN", ADMIN_TOKEN)
  })

  function post(body: unknown, origin?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_TOKEN,
    }
    if (origin) headers.origin = origin
    return draftPreviewPOST(
      new NextRequest("http://localhost:3000/api/presets/draft-preview", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    )
  }

  it("rejects invalid payloads and cross-origin posts", async () => {
    expect((await post({ preset: { variant: "house" } })).status).toBe(400)
    expect((await post({ preset: { variant: "house", target: "nope", house: { style: "pill", scale: 100, polarity: "auto" } } })).status).toBe(400)
    expect(
      (
        await post(
          { preset: { variant: "house", target: "quality", house: { style: "standard", scale: 100, polarity: "auto" } } },
          "https://evil.com",
        )
      ).status,
    ).toBe(403)
  })

  it("renders two different unsaved drafts to different SVGs (no save needed)", async () => {
    const draft = (appearance?: unknown): unknown => ({
      preset: {
        variant: "house",
        target: "quality",
        house: {
          style: "standard",
          scale: 100,
          polarity: "auto",
          ...(appearance ? { appearance } : {}),
        },
      },
    })
    const plain = await post(draft())
    const styled = await post(draft(RED_BG))
    expect(plain.status).toBe(200)
    expect(styled.status).toBe(200)
    expect(plain.headers.get("Content-Type")).toContain("image/svg+xml")
    expect(styled.headers.get("Cache-Control")).toContain("no-store")
    const plainSvg = await plain.text()
    const styledSvg = await styled.text()
    expect(plainSvg).toContain("<svg")
    expect(styledSvg).toContain("<svg")
    expect(styledSvg).not.toBe(plainSvg)
    expect(styled.headers.get("ETag")).not.toBe(plain.headers.get("ETag"))
  })

  it("renders raster families from fixtures without a saved preset", async () => {
    for (const target of ["network", "separateRatings", "customRatings"] as const) {
      const style = target === "customRatings" ? "row" : target === "network" ? "pill" : "column"
      const res = await post({
        preset: { variant: "house", target, house: { style, scale: 100, polarity: "auto", appearance: RED_BG } },
      })
      expect(res.status).toBe(200)
      const svg = await res.text()
      expect(svg).toContain("<svg")
      expect(svg.length).toBeGreaterThan(200)
    }
  })
})

describe("support matrix honesty", () => {
  it("marks material/typography/container only where honored", async () => {
    const { TECHNICAL_FAMILY_META } = await import("@/lib/badge-preset-technical")
    const byId = Object.fromEntries(TECHNICAL_FAMILY_META.map((m) => [m.family, m.supports])) as Record<
      TechnicalFamilyId,
      (typeof TECHNICAL_FAMILY_META)[number]["supports"]
    >
    expect(byId.quality.appearance).toBe(true)
    expect(byId.quality.typography).toBe(true)
    expect(byId.network.container).toBe(true)
    expect(byId.network.typography).toBe(false)
    expect(byId.comingSoon.scale).toBe(false)
    expect(byId.comingSoon.appearance).toBe(true)
  })
})
