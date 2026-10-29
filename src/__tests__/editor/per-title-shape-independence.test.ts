/**
 * Per-title portrait/landscape visual independence (mapping-level).
 *
 * Contract:
 * - editing portrait must not modify the landscape look, and vice versa;
 * - preview, shape switch, save, reopen and Stremio agree (single renderer,
 *   same effective mapping per shape);
 * - legacy mappings without a `landscape` profile render exactly as before
 *   on both shapes (null/absent = inherit the flat);
 * - explicit `false`/concrete styles win; legacy `null`/absent inherits;
 *   `follow-rank` shadows the flat with the shape's own rank.
 * - data/shared fields (ratingSources, language, titles) stay flat-only;
 *   the formerly-shared visuals (customBadge, accentColor, badgePresetId/Rev)
 *   are independent per shape since the user-authorized independence
 *   (explicit-null-shadows, preset pair-atomic); global-only controls
 *   (sash/minQuality/ribbonSide, preRelease has no per-title field) keep
 *   using effective shape defaults.
 */
import { describe, expect, it } from "vitest"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import {
  resolvePosterRenderConfig,
  resolveSeparateRatingsEnabled,
  type PosterRenderConfigInput,
} from "@/lib/poster-config"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import {
  snapshotMissingMappingLandscape,
  mappingShapeChainEffective,
  MAPPING_SHAPE_LAND_KEYS,
} from "@/lib/visual-presets"

function baseMapping(partial: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    ...partial,
  }
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

function shapeInput(shape: "poster" | "landscape", extra: Partial<PosterRenderConfigInput> = {}) {
  const sp = new URLSearchParams(extra.searchParams ? String(extra.searchParams) : "")
  if (shape === "landscape") sp.set("shape", "landscape")
  return baseInput({ ...extra, searchParams: sp })
}

describe("effectiveMappingForShape per-title styles", () => {
  it("portrait returns the same object (no overlay)", () => {
    const m = baseMapping({ badgeStyle: "pill" })
    expect(effectiveMappingForShape(m, "poster")).toBe(m)
  })

  it("landscape without a profile returns the same object (legacy byte-identical)", () => {
    const m = baseMapping({ badgeStyle: "pill", badgeGenre: false })
    expect(effectiveMappingForShape(m, "landscape")).toBe(m)
  })

  it("landscape overlays owned style/toggle keys per key", () => {
    const m = baseMapping({
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      badgeFont: "oswald",
      badgeGenre: false,
      badgeYear: true,
      badgeRating: true,
      badgeQuality: true,
      showBadges: true,
      rankingBadges: true,
      customRatings: true,
      separateRatings: false,
      qualityBadgeStyle: "color",
      videoFormats: ["dv"],
      networkLogo: true,
      networkLogoPosition: "auto",
      ribbonEnabled: true,
      extraBadgeStyle: "pill",
      landscape: {
        badgeStyle: "vetro",
        badgeGenre: true,
        qualityBadgeStyle: "mono",
        networkLogo: false,
        networkLogoPosition: "top",
        ribbonEnabled: false,
      },
    })
    const eff = effectiveMappingForShape(m, "landscape")
    expect(eff).not.toBe(m)
    expect(eff?.badgeStyle).toBe("vetro")
    expect(eff?.badgeGenre).toBe(true)
    expect(eff?.qualityBadgeStyle).toBe("mono")
    expect(eff?.networkLogo).toBe(false)
    expect(eff?.networkLogoPosition).toBe("top")
    expect(eff?.ribbonEnabled).toBe(false)
    // Untouched keys keep following the flat.
    expect(eff?.rankingBadgeStyle).toBe("pill")
    expect(eff?.badgeFont).toBe("oswald")
    expect(eff?.badgeYear).toBe(true)
    expect(eff?.videoFormats).toEqual(["dv"])
    expect(eff?.extraBadgeStyle).toBe("pill")
  })

  it("landscape null/invalid profile values inherit the flat", () => {
    const m = baseMapping({
      badgeStyle: "pill",
      badgeFont: "oswald",
      qualityBadgeStyle: "color",
      videoFormats: ["dv"],
      extraBadgeStyle: "pill",
      landscape: {
        badgeStyle: null,
        badgeFont: null,
        qualityBadgeStyle: null,
        videoFormats: null,
        extraBadgeStyle: null,
      },
    })
    const eff = effectiveMappingForShape(m, "landscape")
    expect(eff?.badgeStyle).toBe("pill")
    expect(eff?.badgeFont).toBe("oswald")
    expect(eff?.qualityBadgeStyle).toBe("color")
    expect(eff?.videoFormats).toEqual(["dv"])
    expect(eff?.extraBadgeStyle).toBe("pill")
  })

  it("landscape badgeItemTransforms: an OWNED null clears the profile, absent inherits the flat", () => {
    // Explicit null = the "automatic layout" marker a per-shape reset/preset
    // owns (same rule as the defaults profile, see
    // `resolveShapeBadgeItemTransforms`): reading it through `??` would
    // resurrect the portrait per-item nudges on the shape the user cleared.
    const cleared = baseMapping({
      badgeItemTransforms: "rating:imdb=100,1,10",
      landscape: { badgeItemTransforms: null },
    })
    expect(effectiveMappingForShape(cleared, "landscape")?.badgeItemTransforms).toBeNull()
    expect(effectiveMappingForShape(cleared, "poster")?.badgeItemTransforms).toBe("rating:imdb=100,1,10")

    // Absent key keeps the documented legacy inherit (byte-identical URLs).
    const inherited = baseMapping({
      badgeItemTransforms: "rating:imdb=100,1,10",
      landscape: { badgeStyle: "vetro" },
    })
    expect(effectiveMappingForShape(inherited, "landscape")?.badgeItemTransforms).toBe("rating:imdb=100,1,10")
  })

  it("landscape follow-rank shadows the flat with the shape's own rank", () => {
    const m = baseMapping({
      extraBadgeStyle: "pill",
      landscape: { extraBadgeStyle: "follow-rank" },
    })
    expect(effectiveMappingForShape(m, "landscape")?.extraBadgeStyle).toBe("follow-rank")
    expect(effectiveMappingForShape(m, "poster")?.extraBadgeStyle).toBe("pill")
  })
})

describe("mapping validation per-shape", () => {
  it("accepts the new landscape style/toggle keys", () => {
    const parsed = mappingSchema.safeParse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      landscape: {
        showBadges: false,
        rankingBadges: false,
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        badgeQuality: false,
        customRatings: false,
        separateRatings: true,
        badgeStyle: "vetro",
        rankingBadgeStyle: "number",
        extraBadgeStyle: "follow-rank",
        badgeFont: "oswald",
        qualityBadgeStyle: "knockout",
        videoFormats: ["dv", "atmos"],
        networkLogo: false,
        networkLogoPosition: "top",
        ribbonEnabled: false,
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    // Parsed keys, not just success: the profile survives validation intact.
    expect(parsed.data.landscape?.showBadges).toBe(false)
    expect(parsed.data.landscape?.rankingBadges).toBe(false)
    expect(parsed.data.landscape?.badgeGenre).toBe(false)
    expect(parsed.data.landscape?.badgeYear).toBe(false)
    expect(parsed.data.landscape?.badgeRating).toBe(false)
    expect(parsed.data.landscape?.badgeQuality).toBe(false)
    expect(parsed.data.landscape?.customRatings).toBe(false)
    expect(parsed.data.landscape?.separateRatings).toBe(true)
    expect(parsed.data.landscape?.badgeStyle).toBe("vetro")
    expect(parsed.data.landscape?.rankingBadgeStyle).toBe("number")
    expect(parsed.data.landscape?.extraBadgeStyle).toBe("follow-rank")
    expect(parsed.data.landscape?.badgeFont).toBe("oswald")
    expect(parsed.data.landscape?.qualityBadgeStyle).toBe("knockout")
    expect(parsed.data.landscape?.videoFormats).toEqual(["dv", "atmos"])
    expect(parsed.data.landscape?.networkLogo).toBe(false)
    expect(parsed.data.landscape?.networkLogoPosition).toBe("top")
    expect(parsed.data.landscape?.ribbonEnabled).toBe(false)
  })

  it("rejects invalid landscape style enums", () => {
    const parsed = mappingSchema.safeParse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      landscape: { badgeStyle: "garbage", badgeFont: "comic-sans" },
    })
    expect(parsed.success).toBe(false)
  })

  it("persists the flat badgeQuality toggle (portrait profile)", () => {
    const parsed = mappingSchema.safeParse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      badgeQuality: false,
      landscape: { badgeQuality: true },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.badgeQuality).toBe(false)
      expect(parsed.data.landscape?.badgeQuality).toBe(true)
    }
  })

  it("strips data fields smuggled into the landscape profile (fail-closed)", () => {
    const parsed = mappingSchema.safeParse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      customBadge: "TOP",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      ratingSources: ["imdb"],
      landscape: {
        badgeStyle: "vetro",
        customBadge: "TOP",
        accentColor: "#ff0000",
        badgePresetId: "Abc123-_XyZ",
        ratingSources: ["imdb"],
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    // Only data fields without a per-shape counterpart cannot diverge:
    // ratingSources stays shared (flat-only). The formerly-shared visuals
    // (customBadge/accentColor/badgePresetId) are owned per shape since the
    // user-authorized independence — the profile keeps them verbatim.
    // (Non-strict object: unknown keys are stripped, never persisted.)
    const land = parsed.data.landscape as Record<string, unknown> | null
    expect(land).not.toBeNull()
    expect(land!.customBadge).toBe("TOP")
    expect(land!.accentColor).toBe("#ff0000")
    expect(land!.badgePresetId).toBe("Abc123-_XyZ")
    expect("ratingSources" in land!).toBe(false)
    // The owned style key survives; the flat shared fields are untouched.
    expect(land!.badgeStyle).toBe("vetro")
    expect(parsed.data.customBadge).toBe("TOP")
    expect(parsed.data.ratingSources).toEqual(["imdb"])
  })

  it("shared metadata renders identically on both shapes", () => {
    const m = baseMapping({
      badgeStyle: "pill",
      customBadge: "TOP",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      ratingSources: ["imdb"],
      landscape: { badgeStyle: "vetro" },
    })
    // No per-shape carrier exists: both shapes read the same flat binding.
    expect(effectiveMappingForShape(m, "poster")?.customBadge).toBe("TOP")
    expect(effectiveMappingForShape(m, "landscape")?.customBadge).toBe("TOP")
    expect(effectiveMappingForShape(m, "poster")?.accentColor).toBe("#ff0000")
    expect(effectiveMappingForShape(m, "landscape")?.accentColor).toBe("#ff0000")
    expect(effectiveMappingForShape(m, "poster")?.badgePresetId).toBe("Abc123-_XyZ")
    expect(effectiveMappingForShape(m, "landscape")?.badgePresetId).toBe("Abc123-_XyZ")
    expect(effectiveMappingForShape(m, "poster")?.ratingSources).toEqual(["imdb"])
    expect(effectiveMappingForShape(m, "landscape")?.ratingSources).toEqual(["imdb"])
  })
})

describe("poster-config resolves per-title styles per shape", () => {
  it("per-item corrections: an owned landscape null is never the portrait map", () => {
    const mapping = baseMapping({
      posterShape: "landscape",
      badgeItemTransforms: "rating:imdb=100,1,10",
      landscape: { badgeItemTransforms: null },
    })
    // Renderer chain: the shape-effective mapping owns the clear, so the
    // resolved value falls to the shape-effective defaults (automatic here),
    // never to the portrait flat corrections.
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.badgeItemTransforms).toEqual({})
    // Clearing the title profile shadows portrait, not the config/default
    // layers below the mapping. Match the editor's nullish fallback chain.
    const defaults = { badgeItemTransforms: "quality:tier=90,2,3" }
    const inheritedDefaults = resolvePosterRenderConfig(shapeInput("landscape", { mapping, sd: defaults }))
    expect(inheritedDefaults.badgeItemTransforms).toEqual({
      "quality:tier": { scale: 90, offsetX: 2, offsetY: 3 },
    })
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults, mapping, forceShape: "landscape",
    })
    const fromStremio = resolvePosterRenderConfig(shapeInput("landscape", {
      mapping, sd: defaults, searchParams: url.searchParams,
    }))
    expect(fromStremio.badgeItemTransforms).toEqual(inheritedDefaults.badgeItemTransforms)
    // A title that does NOT own the key still inherits the portrait flat.
    const inheritedMapping = baseMapping({
      posterShape: "landscape",
      badgeItemTransforms: "rating:imdb=100,1,10",
      landscape: { badgeStyle: "vetro" },
    })
    const inherited = resolvePosterRenderConfig(shapeInput("landscape", { mapping: inheritedMapping }))
    expect(inherited.badgeItemTransforms).toEqual({ "rating:imdb": { scale: 100, offsetX: 1, offsetY: 10 } })
  })

  it("per-item corrections: the Stremio URL omits the portrait nudges after an owned landscape clear", () => {
    const mapping = baseMapping({
      posterShape: "landscape",
      badgeItemTransforms: "rating:imdb=100,1,10",
      landscape: { badgeItemTransforms: null },
    })
    // `config` = explicit tuning: the per-item corrections travel as `bit`
    // (in compact mode they are folded into the `dv` signature instead, so
    // the comparison below must use the explicit layer).
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping, forceShape: "landscape", config: "tok",
    })
    // No `bit=` = automatic layout server-side, the same clear the WYSIWYG
    // preview sends as an explicit empty `bit=`.
    expect(url.searchParams.get("bit")).toBeNull()
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping, forceShape: "poster", config: "tok",
    })
    expect(portrait.searchParams.get("bit")).toBe("rating:imdb=100,1,10")
  })

  it("badgeStyle/rank style/font/quality style follow the effective mapping", () => {
    const mapping = baseMapping({
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      badgeFont: "oswald",
      qualityBadgeStyle: "color",
      landscape: {
        badgeStyle: "vetro",
        rankingBadgeStyle: "vetro",
        badgeFont: "barlow-condensed",
        qualityBadgeStyle: "mono",
      },
    })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    expect(portrait.badgeStyle).toBe("pill")
    expect(portrait.rankingBadgeStyle).toBe("pill")
    expect(portrait.badgeFont).toBe("oswald")
    expect(portrait.qualityBadgeStyle).toBe("color")
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.badgeStyle).toBe("vetro")
    expect(landscape.rankingBadgeStyle).toBe("vetro")
    expect(landscape.badgeFont).toBe("barlow-condensed")
    expect(landscape.qualityBadgeStyle).toBe("mono")
  })

  it("genre/year/rating/quality component toggles follow the effective mapping", () => {
    const mapping = baseMapping({
      badgeGenre: false,
      badgeYear: true,
      badgeRating: true,
      badgeQuality: false,
      landscape: { badgeGenre: true, badgeQuality: true },
    })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    expect(portrait.badgeGenre).toBe(false)
    expect(portrait.badgeQuality).toBe(false)
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.badgeGenre).toBe(true)
    expect(landscape.badgeYear).toBe(true)
    expect(landscape.badgeQuality).toBe(true)
  })

  it("network logo toggle/position and ribbon follow the effective mapping", () => {
    const mapping = baseMapping({
      networkLogo: true,
      networkLogoPosition: "auto",
      ribbonEnabled: true,
      landscape: { networkLogo: false, networkLogoPosition: "top", ribbonEnabled: false },
    })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    expect(portrait.networkLogo).toBe(true)
    expect(portrait.networkLogoPosition).toBe("auto")
    expect(portrait.ribbonEnabled).toBe(true)
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.networkLogo).toBe(false)
    expect(landscape.networkLogoPosition).toBe("top")
    expect(landscape.ribbonEnabled).toBe(false)
  })

  it("customRatings and videoFormats-independent toggles follow the effective mapping", () => {
    const mapping = baseMapping({
      customRatings: true,
      separateRatings: false,
      videoFormats: ["dv"],
      landscape: { customRatings: false, separateRatings: true },
    })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    expect(portrait.customRatings).toBe(true)
    expect(portrait.separateRatings).toBe(false)
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.customRatings).toBe(false)
    expect(landscape.separateRatings).toBe(true)
  })

  it("extra style: landscape follow-rank resolves own-rank, portrait keeps the flat", () => {
    const mapping = baseMapping({
      rankingBadgeStyle: "pill",
      extraBadgeStyle: "pill",
      landscape: { extraBadgeStyle: "follow-rank" },
    })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    expect(portrait.extraBadgeStyle).toBe("pill")
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.extraBadgeStyle).toBeNull()
    expect(landscape.rankingBadgeStyle).toBe("pill")
  })

  it("legacy mapping without a profile resolves the flat on both shapes", () => {
    const mapping = baseMapping({ badgeStyle: "pill", badgeGenre: false, networkLogo: false })
    const portrait = resolvePosterRenderConfig(shapeInput("poster", { mapping }))
    const landscape = resolvePosterRenderConfig(shapeInput("landscape", { mapping }))
    expect(landscape.badgeStyle).toBe(portrait.badgeStyle)
    expect(landscape.badgeGenre).toBe(portrait.badgeGenre)
    expect(landscape.networkLogo).toBe(portrait.networkLogo)
  })

  it("query still wins over both shape profiles", () => {
    const mapping = baseMapping({
      badgeStyle: "pill",
      landscape: { badgeStyle: "vetro" },
    })
    const sp = new URLSearchParams({ shape: "landscape", bs: "minimal", bfont: "oswald" })
    const r = resolvePosterRenderConfig(baseInput({ searchParams: sp, mapping }))
    expect(r.badgeStyle).toBe("minimal")
    expect(r.badgeFont).toBe("oswald")
  })
})

describe("resolveSeparateRatingsEnabled is shape-aware", () => {
  it("landscape profile shadows the flat; portrait keeps the flat", () => {
    const mapping = baseMapping({ separateRatings: true, landscape: { separateRatings: false } })
    expect(
      resolveSeparateRatingsEnabled(new URLSearchParams(), mapping, null, {}, null, "poster"),
    ).toBe(true)
    expect(
      resolveSeparateRatingsEnabled(new URLSearchParams(), mapping, null, {}, null, "landscape"),
    ).toBe(false)
  })

  it("query still wins on both shapes", () => {
    const mapping = baseMapping({ separateRatings: true, landscape: { separateRatings: false } })
    expect(
      resolveSeparateRatingsEnabled(new URLSearchParams({ sep: "0" }), mapping, null, {}, null, "poster"),
    ).toBe(false)
    expect(
      resolveSeparateRatingsEnabled(new URLSearchParams({ sep: "1" }), mapping, null, {}, null, "landscape"),
    ).toBe(true)
  })
})

describe("Stremio builder emits the effective mapping per shape", () => {
  it("badge style/font/quality style differ per shape", () => {
    const mapping = baseMapping({
      badgeStyle: "pill",
      badgeFont: "oswald",
      qualityBadgeStyle: "color",
      landscape: { badgeStyle: "vetro", badgeFont: "barlow-condensed", qualityBadgeStyle: "mono" },
    })
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
    })
    expect(portrait.searchParams.get("bs")).toBe("pill")
    expect(portrait.searchParams.get("bfont")).toBe("oswald")
    expect(portrait.searchParams.get("qbs")).toBe("color")
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
      forceShape: "landscape",
    })
    expect(landscape.searchParams.get("shape")).toBe("landscape")
    expect(landscape.searchParams.get("bs")).toBe("vetro")
    expect(landscape.searchParams.get("bfont")).toBe("barlow-condensed")
    expect(landscape.searchParams.get("qbs")).toBe("mono")
  })

  it("component toggles differ per shape (false emits, true omits)", () => {
    const mapping = baseMapping({
      badgeGenre: false,
      badgeQuality: false,
      landscape: { badgeGenre: true, badgeQuality: true },
    })
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
    })
    expect(portrait.searchParams.get("bg")).toBe("0")
    expect(portrait.searchParams.get("bq")).toBe("0")
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
      forceShape: "landscape",
    })
    expect(landscape.searchParams.has("bg")).toBe(false)
    expect(landscape.searchParams.has("bq")).toBe(false)
  })

  it("network toggle/position and ribbon differ per shape", () => {
    const mapping = baseMapping({
      networkLogo: true,
      networkLogoPosition: "auto",
      ribbonEnabled: true,
      landscape: { networkLogo: false, networkLogoPosition: "top", ribbonEnabled: false },
    })
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
    })
    expect(portrait.searchParams.has("netLogo")).toBe(false)
    expect(portrait.searchParams.has("netPos")).toBe(false)
    expect(portrait.searchParams.has("ribbon")).toBe(false)
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
      forceShape: "landscape",
    })
    expect(landscape.searchParams.get("netLogo")).toBe("0")
    expect(landscape.searchParams.get("netPos")).toBe("top")
    expect(landscape.searchParams.get("ribbon")).toBe("0")
  })

  it("legacy mapping without a profile keeps legacy URLs byte-identical", () => {
    const mapping = baseMapping({ badgeStyle: "pill", badgeGenre: false })
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
    })
    expect(portrait.searchParams.get("bs")).toBe("pill")
    expect(portrait.searchParams.get("bg")).toBe("0")
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
      forceShape: "landscape",
    })
    expect(landscape.searchParams.get("bs")).toBe("pill")
    expect(landscape.searchParams.get("bg")).toBe("0")
  })
})

describe("mappingShapeChainEffective (correction c1 save boundary)", () => {
  it("unknown on both default levels reports not-known (legacy fallback)", () => {
    expect(mappingShapeChainEffective("badgeStyle", {}, null)).toEqual({ known: false })
    expect(mappingShapeChainEffective("badgeGenre", {}, {})).toEqual({ known: false })
    expect(mappingShapeChainEffective("extraBadgeStyle", {}, null)).toEqual({ known: false })
  })

  it("flat default resolves when the profile default is absent", () => {
    expect(mappingShapeChainEffective("badgeStyle", { badgeStyle: "vetro" }, null))
      .toEqual({ known: true, value: "vetro" })
    expect(mappingShapeChainEffective("badgeGenre", { badgeGenre: false }, {}))
      .toEqual({ known: true, value: false })
    expect(mappingShapeChainEffective("separateRatings", { separateRatings: true }, null))
      .toEqual({ known: true, value: true })
  })

  it("landscape-defaults profile wins over the flat default", () => {
    expect(mappingShapeChainEffective("badgeStyle", { badgeStyle: "vetro" }, { badgeStyle: "colored" }))
      .toEqual({ known: true, value: "colored" })
    expect(mappingShapeChainEffective("badgeGenre", { badgeGenre: true }, { badgeGenre: false }))
      .toEqual({ known: true, value: false })
  })

  it("reads showBadges through the globalBadges profile name", () => {
    expect(mappingShapeChainEffective("showBadges", { showBadges: false }, { globalBadges: true }))
      .toEqual({ known: true, value: true })
    expect(mappingShapeChainEffective("showBadges", { showBadges: false }, {}))
      .toEqual({ known: true, value: false })
  })

  it("invalid default values fail closed to the factory look (still known)", () => {
    expect(mappingShapeChainEffective("badgeStyle", { badgeStyle: "garbage" }, null))
      .toEqual({ known: true, value: "shadow" })
    expect(mappingShapeChainEffective("badgeGenre", { badgeGenre: "yes" }, null))
      .toEqual({ known: true, value: true })
    expect(mappingShapeChainEffective("networkLogoPosition", { networkLogoPosition: "left" }, null))
      .toEqual({ known: true, value: "auto" })
    expect(mappingShapeChainEffective("badgeFont", { badgeFont: "comic-sans" }, null))
      .toEqual({ known: true, value: "inter" })
  })

  it("extra style resolves concrete/profile values, legacy to the own-rank marker", () => {
    expect(mappingShapeChainEffective("extraBadgeStyle", { extraBadgeStyle: "pill" }, null))
      .toEqual({ known: true, value: "pill" })
    expect(mappingShapeChainEffective("extraBadgeStyle", { extraBadgeStyle: "follow-rank" }, null))
      .toEqual({ known: true, value: "follow-rank" })
    expect(mappingShapeChainEffective("extraBadgeStyle", { extraBadgeStyle: null }, null))
      .toEqual({ known: true, value: "follow-rank" })
    expect(mappingShapeChainEffective("extraBadgeStyle", {}, { extraBadgeStyle: "vetro" }))
      .toEqual({ known: true, value: "vetro" })
  })

  it("videoFormats filters to known formats, absent resolves the full list", () => {
    expect(mappingShapeChainEffective("videoFormats", { videoFormats: ["dv", "nope"] }, null))
      .toEqual({ known: true, value: ["dv"] })
    expect(mappingShapeChainEffective("videoFormats", { videoFormats: null }, null))
      .toEqual({ known: true, value: ["dv", "hdr", "hdr10plus", "atmos", "imax"] })
  })

  it("never aliases the caller array", () => {
    const src = ["dv"]
    const r = mappingShapeChainEffective("videoFormats", { videoFormats: src }, null)
    expect(r).toEqual({ known: true, value: ["dv"] })
    src.push("atmos")
    expect(r.value).toEqual(["dv"])
  })
})

describe("legacy Stremio URLs stay byte-identical (full-query fixture)", () => {
  // Volatile versioning params (own contracts, change independently):
  // `rv` = RENDER_VERSION, `mv` = mapping version, `dv` = compact-tuning
  // signature. The shape contract pins every STABLE param absolutely and the
  // landscape/portrait relation exactly (landscape adds only `shape`).
  const VOLATILE = new Set(["rv", "mv", "dv"])
  function stableSearch(url: URL): string {
    const keep = [...url.searchParams.entries()]
      .filter(([k]) => !VOLATILE.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&")
    return `?${keep}`
  }
  it("portrait and landscape URLs for a legacy mapping match the pinned fixture", () => {
    const mapping = baseMapping({ badgeStyle: "pill", badgeGenre: false })
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
    })
    const landscape = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping,
      forceShape: "landscape",
    })
    expect(stableSearch(portrait)).toBe("?bfont=inter&bg=0&bs=pill&lang=it&rs=default&title=T")
    expect(stableSearch(landscape)).toBe("?bfont=inter&bg=0&bs=pill&lang=it&rs=default&shape=landscape&title=T")
    // Relational byte-identity: landscape adds exactly `shape`, nothing else.
    const p = new URLSearchParams(portrait.search)
    const l = new URLSearchParams(landscape.search)
    for (const k of [...VOLATILE, "shape"]) { p.delete(k); l.delete(k) }
    expect([...l.entries()].sort()).toEqual([...p.entries()].sort())
    expect(landscape.searchParams.get("shape")).toBe("landscape")
    expect(portrait.searchParams.has("shape")).toBe(false)
    // Versioning params still travel on both shapes.
    for (const k of VOLATILE) {
      expect(portrait.searchParams.has(k)).toBe(true)
      expect(landscape.searchParams.has(k)).toBe(true)
    }
  })
})

describe("snapshotMissingMappingLandscape (portrait-save backfill)", () => {
  it("covers every new per-title shape key", () => {
    for (const k of [
      "showBadges", "rankingBadges", "badgeGenre", "badgeYear", "badgeRating",
      "badgeQuality", "customRatings", "separateRatings", "badgeStyle",
      "rankingBadgeStyle", "extraBadgeStyle", "badgeFont", "qualityBadgeStyle",
      "videoFormats", "networkLogo", "networkLogoPosition", "ribbonEnabled",
    ]) {
      expect(MAPPING_SHAPE_LAND_KEYS, `missing ${k}`).toContain(k)
    }
  })

  it("freezes pre-edit flats for missing keys, skips owned keys, clones arrays", () => {
    const src = ["dv"]
    const adds = snapshotMissingMappingLandscape(
      { badgeStyle: "pill", badgeGenre: false, videoFormats: src },
      { badgeStyle: "vetro" },
    )
    expect(adds.badgeStyle).toBeUndefined()
    expect(adds.badgeGenre).toBe(false)
    expect(adds.videoFormats).toEqual(["dv"])
    src.push("atmos")
    expect(adds.videoFormats).toEqual(["dv"])
  })

  it("legacy null/inherit flats freeze the canonical effective value", () => {
    const adds = snapshotMissingMappingLandscape(
      { badgeFont: null, qualityBadgeStyle: null, videoFormats: null, extraBadgeStyle: null },
      {},
    )
    expect(adds.badgeFont).toBe("inter")
    expect(adds.qualityBadgeStyle).toBe("standard")
    expect(adds.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])
    expect(adds.extraBadgeStyle).toBe("follow-rank")
  })

  it("owned follow-rank and concrete styles are never re-frozen", () => {
    const adds = snapshotMissingMappingLandscape(
      { extraBadgeStyle: "pill", badgeStyle: "minimal" },
      { extraBadgeStyle: "follow-rank" },
    )
    expect("extraBadgeStyle" in adds).toBe(false)
    expect(adds.badgeStyle).toBe("minimal")
  })
})
