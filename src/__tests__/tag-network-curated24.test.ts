/**
 * Curated network set (24 featured + Other group): RED-before/GREEN-after
 * for the user-authorized curation.
 *
 * - 9 bundled marks (peacock, discovery_plus, bbc, itv, channel4,
 *   starz, britbox, argos, real_time) with clean filenames: single matcher aliases,
 *   guarded against substring false positives; peacock wins over generic NBC.
 * - registry coherence: 75 IDs ↔ 75 files, display names, asset existence,
 *   old upload names gone, new provider-glass brands fall back to neutral
 *   (no invented palette).
 * - renderer semantics: Other OFF suppresses every non-featured local mark
 *   before load AND the whole TMDB fallback before fetch; featured marks
 *   stay on their own toggles; old stored hidden IDs are preserved and
 *   honored individually.
 * - transport: bounds/token/URL/cache carry all 76 entries; mixed groups
 *   stay explicit (never silently migrated).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  NETWORK_IDS,
  FEATURED_NETWORK_IDS,
  NETWORK_DISPLAY_NAMES,
  getNetworkKey,
  sanitizeDisabledNetworks,
  isNetworkDisabled,
  isFeaturedNetworkKey,
  isOtherNetworkMarkDisabled,
  isOtherNetworksDisabled,
  TMDB_FALLBACK_SENTINEL,
  MAX_DISABLED_NETWORKS,
} from "@/lib/network-keys"
import { NETWORK_MARK_FILES } from "@/lib/network-files"
import { networkAssetUrl, networkAssetKeys, TMDB_LOGO_ASSET_URL } from "@/lib/network-assets"
import { getNetworkSvgResult } from "@/lib/network-svgs"
import { renderNetworkOnlyLargePill } from "@/lib/poster-service"
import { resolveProviderGlassBrandHex, resolveProviderGlassAccent } from "@/lib/provider-brand-palette"
import { DEMO_SAMPLE_NETWORK } from "@/lib/demo-samples"
import { configTokenSchema, partialCatalogTokenSchema } from "@/lib/config-token"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"

vi.mock("@/lib/poster-render-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-render-helpers")>()
  return { ...mod, fetchImg: vi.fn() }
})

import { fetchImg } from "@/lib/poster-render-helpers"
import {
  renderFirstMatchingNetworkLogoBadgeHybrid,
  renderFirstMatchingNetworkRawBadgeHybrid,
} from "@/lib/network-svgs"

const mockedFetchImg = vi.mocked(fetchImg)

const ROOT = path.resolve(__dirname, "../..")

describe("curated registry (75 marks, 24 featured)", () => {
  it("exposes 75 canonical IDs with display names and a 24-strong featured set", () => {
    expect(NETWORK_IDS).toHaveLength(75)
    expect(new Set(NETWORK_IDS).size).toBe(75)
    for (const id of NETWORK_IDS) {
      expect(typeof NETWORK_DISPLAY_NAMES[id]).toBe("string")
      expect(NETWORK_DISPLAY_NAMES[id].length).toBeGreaterThan(0)
    }
    expect(FEATURED_NETWORK_IDS).toEqual([
      "netflix", "prime", "disney", "hbo", "apple", "paramount", "sky",
      "crunchyroll", "rai", "mediaset", "warner", "universal", "marvel",
      "pixar", "sony", "dreamworks", "ghibli", "a24", "century", "lionsgate",
      "peacock", "discovery_plus", "bbc", "starz",
    ])
    for (const id of FEATURED_NETWORK_IDS) {
      expect(NETWORK_IDS).toContain(id)
      expect(isFeaturedNetworkKey(id)).toBe(true)
    }
    expect(new Set(FEATURED_NETWORK_IDS).size).toBe(24)
    // Non-featured marks are group-gated, never individually listed.
    expect(isFeaturedNetworkKey("amc")).toBe(false)
    expect(isFeaturedNetworkKey("itv")).toBe(false)
    expect(isFeaturedNetworkKey("britbox")).toBe(false)
  })

  it("maps the curated marks to clean filenames with display names", () => {
    expect(NETWORK_MARK_FILES["peacock"]).toBe("peacock.svg")
    expect(NETWORK_MARK_FILES["discovery_plus"]).toBe("discovery-plus.svg")
    expect(NETWORK_MARK_FILES["bbc"]).toBe("bbc.svg")
    expect(NETWORK_MARK_FILES["itv"]).toBe("itv.svg")
    expect(NETWORK_MARK_FILES["channel4"]).toBe("channel-4.svg")
    expect(NETWORK_MARK_FILES["starz"]).toBe("starz.svg")
    expect(NETWORK_MARK_FILES["britbox"]).toBe("britbox.svg")
    expect(NETWORK_MARK_FILES["argos"]).toBe("argos.svg")
    expect(NETWORK_MARK_FILES["real_time"]).toBe("Real_Time_logo.svg")
    expect(NETWORK_DISPLAY_NAMES["peacock"]).toBe("Peacock")
    expect(NETWORK_DISPLAY_NAMES["discovery_plus"]).toBe("Discovery+")
    expect(NETWORK_DISPLAY_NAMES["bbc"]).toBe("BBC")
    expect(NETWORK_DISPLAY_NAMES["itv"]).toBe("ITV")
    expect(NETWORK_DISPLAY_NAMES["channel4"]).toBe("Channel 4")
    expect(NETWORK_DISPLAY_NAMES["starz"]).toBe("Starz")
    expect(NETWORK_DISPLAY_NAMES["britbox"]).toBe("BritBox")
    expect(NETWORK_DISPLAY_NAMES["argos"]).toBe("Argos")
    expect(NETWORK_DISPLAY_NAMES["real_time"]).toBe("Real Time")
  })

  it("maps the user-authorized Real Time mark with full-phrase guards", () => {
    expect(getNetworkSvgResult("Real Time", 500)?.networkKey).toBe("real_time")
    expect(getNetworkSvgResult("REAL TIME", 500)?.networkKey).toBe("real_time")
    expect(getNetworkKey("Real Time")).toBe("real_time")
    // Bare "Real"/"Time" or unrelated "…time" names must NOT match.
    expect(getNetworkSvgResult("Real", 500)).toBeNull()
    expect(getNetworkSvgResult("Time", 500)).toBeNull()
    expect(getNetworkSvgResult("Prime Time", 500)?.networkKey).toBe("prime")
    expect(getNetworkKey("Real")).toBeNull()
    // Real Time is non-featured: it rides the shared Other group, never its own row.
    expect(isFeaturedNetworkKey("real_time")).toBe(false)
    expect(isOtherNetworkMarkDisabled("real_time", [TMDB_FALLBACK_SENTINEL])).toBe(true)
    expect(isOtherNetworkMarkDisabled("real_time", [])).toBe(false)
  })

  it("maps the user-authorized Argos mark with word-boundary guards", () => {
    expect(getNetworkSvgResult("Argos", 500)?.networkKey).toBe("argos")
    expect(getNetworkSvgResult("ARGOS", 500)?.networkKey).toBe("argos")
    expect(getNetworkKey("Argos")).toBe("argos")
    // Embedded tokens must NOT match (no word boundary before a word char).
    expect(getNetworkSvgResult("Argosy", 500)).toBeNull()
    expect(getNetworkSvgResult("Argosy Films", 500)).toBeNull()
    expect(getNetworkKey("Argosy")).toBeNull()
    // Argos is non-featured: it rides the shared Other group, never its own row.
    expect(isFeaturedNetworkKey("argos")).toBe(false)
    expect(isOtherNetworkMarkDisabled("argos", [TMDB_FALLBACK_SENTINEL])).toBe(true)
    expect(isOtherNetworkMarkDisabled("argos", [])).toBe(false)
  })

  it("every registry file exists on disk; old upload names are gone", () => {
    for (const id of NETWORK_IDS) {
      const url = networkAssetUrl(id)
      expect(url, `networkAssetUrl(${id})`).toBe(`/networks/${NETWORK_MARK_FILES[id]}`)
      expect(
        fs.existsSync(path.join(ROOT, "public", "networks", NETWORK_MARK_FILES[id])),
        `bundled mark missing: public/networks/${NETWORK_MARK_FILES[id]}`,
      ).toBe(true)
    }
    expect([...networkAssetKeys()]).toEqual([...NETWORK_IDS])
    for (const stale of [
      "BBC_Logo_2021.svg",
      "BritBox_logo.svg",
      "channel-4-seeklogo.svg",
      "ITV_logo_2019.svg",
      "NBCUniversal_Peacock_Logo_(2020–2026).svg",
      "Starz_logo-1-.svg",
      "Tavola disegno 1.svg",
    ]) {
      expect(fs.existsSync(path.join(ROOT, "public", "networks", stale))).toBe(false)
    }
    // Argos is a registered bundled mark (user-authorized mapping): the
    // asset resolves through the shared registry and the matcher.
    expect(NETWORK_MARK_FILES["argos"]).toBe("argos.svg")
    expect(getNetworkKey("Argos")).toBe("argos")
    expect(getNetworkKey("ARGOS")).toBe("argos")
    expect(getNetworkSvgResult("Argos", 500)?.networkKey).toBe("argos")
    expect(TMDB_LOGO_ASSET_URL).toBe("/tmdb-logo.svg")
  })
})

describe("curated matcher aliases and false-positive guards", () => {
  it("resolves the 7 new brands", () => {
    expect(getNetworkSvgResult("Peacock", 500)?.networkKey).toBe("peacock")
    expect(getNetworkSvgResult("NBCUniversal Peacock", 500)?.networkKey).toBe("peacock")
    expect(getNetworkSvgResult("Discovery+", 500)?.networkKey).toBe("discovery_plus")
    expect(getNetworkSvgResult("DiscoveryPlus", 500)?.networkKey).toBe("discovery_plus")
    expect(getNetworkSvgResult("Discovery Plus", 500)?.networkKey).toBe("discovery_plus")
    expect(getNetworkSvgResult("BBC", 500)?.networkKey).toBe("bbc")
    expect(getNetworkSvgResult("BBC One", 500)?.networkKey).toBe("bbc")
    expect(getNetworkSvgResult("BBC iPlayer", 500)?.networkKey).toBe("bbc")
    expect(getNetworkSvgResult("ITV", 500)?.networkKey).toBe("itv")
    expect(getNetworkSvgResult("ITV1", 500)?.networkKey).toBe("itv")
    expect(getNetworkSvgResult("ITVX", 500)?.networkKey).toBe("itv")
    expect(getNetworkSvgResult("ITV Studios", 500)?.networkKey).toBe("itv")
    expect(getNetworkSvgResult("Channel 4", 500)?.networkKey).toBe("channel4")
    expect(getNetworkSvgResult("Channel4", 500)?.networkKey).toBe("channel4")
    expect(getNetworkSvgResult("Channel Four", 500)?.networkKey).toBe("channel4")
    expect(getNetworkSvgResult("Starz", 500)?.networkKey).toBe("starz")
    expect(getNetworkSvgResult("Starzplay", 500)?.networkKey).toBe("starz")
    expect(getNetworkSvgResult("BritBox", 500)?.networkKey).toBe("britbox")
    expect(getNetworkSvgResult("Brit Box", 500)?.networkKey).toBe("britbox")
  })

  it("rejects substring and bare-token false positives", () => {
    // Bare Discovery (no plus family) is NOT Discovery+: falls to TMDB.
    expect(getNetworkSvgResult("Discovery Channel", 500)).toBeNull()
    expect(getNetworkSvgResult("Discovery", 500)).toBeNull()
    // BBC/ITV need word boundaries.
    expect(getNetworkSvgResult("Subbc Channel", 500)).toBeNull()
    expect(getNetworkSvgResult("Positiv", 500)).toBeNull()
    // Channel 4 needs the full phrase: bare "4" or sibling brands never match.
    expect(getNetworkSvgResult("4", 500)).toBeNull()
    expect(getNetworkSvgResult("Film4", 500)).toBeNull()
    // Starz needs the trailing "z": generic Star-prefixed titles never match.
    expect(getNetworkSvgResult("Star", 500)).toBeNull()
    expect(getNetworkSvgResult("Star Trek", 500)).toBeNull()
    // BritBox needs the full compound.
    expect(getNetworkSvgResult("Brit", 500)).toBeNull()
  })

  it("preserves the existing guarded aliases (NOW/Sky, MGM vs Prime, Japanese NBC)", () => {
    expect(getNetworkSvgResult("NBC", 500)?.networkKey).toBe("nbc")
    expect(getNetworkSvgResult("NBCUniversal", 500)?.networkKey).toBe("nbc")
    expect(getNetworkSvgResult("NOW", 500)?.networkKey).toBe("sky")
    expect(getNetworkSvgResult("Amazon Prime Video", 500)?.networkKey).toBe("prime")
    expect(getNetworkSvgResult("Amazon MGM Studios", 500)?.networkKey).toBe("amazon_mgm")
    expect(getNetworkSvgResult("Metro-Goldwyn-Mayer", 500)?.networkKey).toBe("mgm")
    expect(getNetworkKey("WOWOW Prime")).toBeNull()
    expect(getNetworkKey("White Fox")).toBeNull()
    expect(getNetworkKey("Skydance")).toBe("skydance")
  })
})

describe("curated renderer semantics (Other group)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetchImg.mockResolvedValue(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
  })

  it("Other OFF suppresses non-featured local marks before load (no fetch), featured stay", async () => {
    const hidden = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "AMC", logoPath: null }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(hidden).toBeNull()
    expect(mockedFetchImg).not.toHaveBeenCalled()
    const featured = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Netflix", logoPath: null }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(featured?.networkKey).toBe("netflix")
    // New featured marks render under Other OFF too.
    const peacock = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Peacock", logoPath: null }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(peacock?.networkKey).toBe("peacock")
  })

  it("Other OFF suppresses the whole TMDB fallback before fetch on both pill and raw paths", async () => {
    for (const fn of [
      renderFirstMatchingNetworkLogoBadgeHybrid,
      renderFirstMatchingNetworkRawBadgeHybrid,
    ]) {
      const res = await fn(
        [{ name: "Some Unknown Network XYZ", logoPath: "/abc123.jpg" }],
        500,
        false,
        undefined,
        [TMDB_FALLBACK_SENTINEL],
      )
      expect(res).toBeNull()
    }
    expect(mockedFetchImg).not.toHaveBeenCalled()
  })

  it("Other ON re-enables hidden local marks and the TMDB fallback", async () => {
    const hidden = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "AMC", logoPath: null }],
      500,
      false,
      undefined,
      [],
    )
    expect(hidden?.networkKey).toBe("amc")
    const fallback = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Some Unknown Network XYZ", logoPath: "/abc123.jpg" }],
      500,
      false,
      undefined,
      [],
    )
    expect(fallback).not.toBeNull()
    expect(mockedFetchImg).toHaveBeenCalled()
  })

  it("an individually disabled featured mark never resurrects via TMDB (both paths)", async () => {
    for (const fn of [
      renderFirstMatchingNetworkLogoBadgeHybrid,
      renderFirstMatchingNetworkRawBadgeHybrid,
    ]) {
      const local = await fn([{ name: "Netflix", logoPath: null }], 500, false, undefined, ["netflix"])
      expect(local).toBeNull()
      const viaFallback = await fn(
        [{ name: "Netflix", logoPath: "/abc123.jpg" }],
        500,
        false,
        undefined,
        ["netflix"],
      )
      expect(viaFallback).toBeNull()
    }
  })

  it("stored hidden-ID exceptions are preserved and honored with Other ON (mixed stays honest)", async () => {
    // sanitize keeps pre-group hidden IDs verbatim (never silently dropped).
    expect(sanitizeDisabledNetworks(["amc", TMDB_FALLBACK_SENTINEL, "amc"])).toEqual([
      "amc",
      TMDB_FALLBACK_SENTINEL,
    ])
    // With Other ON but a stored hidden exception, the exception still wins
    // while its siblings render: group is mixed, renderer is explicit.
    const blocked = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "AMC", logoPath: null }],
      500,
      false,
      undefined,
      ["amc"],
    )
    expect(blocked).toBeNull()
    const sibling = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Tubi", logoPath: null }],
      500,
      false,
      undefined,
      ["amc"],
    )
    expect(sibling?.networkKey).toBe("tubi")
    expect(isOtherNetworksDisabled(["amc"])).toBe(false)
    expect(isOtherNetworksDisabled([TMDB_FALLBACK_SENTINEL])).toBe(true)
    expect(isOtherNetworkMarkDisabled("amc", ["amc"])).toBe(true)
    expect(isOtherNetworkMarkDisabled("tubi", ["amc"])).toBe(false)
    expect(isOtherNetworkMarkDisabled("netflix", [TMDB_FALLBACK_SENTINEL])).toBe(false)
    expect(isOtherNetworkMarkDisabled("amc", [TMDB_FALLBACK_SENTINEL])).toBe(true)
    expect(isNetworkDisabled("netflix", [TMDB_FALLBACK_SENTINEL])).toBe(false)
  })

  it("renders combined/network-only pills for the new marks (shared map, madhouse fixed)", async () => {
    // The combined path previously missed `madhouse` (65 vs 66 entries);
    // unifying it on the shared map fixes that intentionally.
    for (const key of ["madhouse", "peacock", "discovery_plus", "bbc", "itv", "channel4", "starz", "britbox", "argos", "real_time"] as const) {
      const pill = await renderNetworkOnlyLargePill(key, 500, false)
      expect(pill, `pill for ${key}`).not.toBeNull()
      expect(pill!.png).toBeInstanceOf(Buffer)
      expect(pill!.w).toBeGreaterThan(0)
      expect(pill!.h).toBeGreaterThan(0)
    }
  })

  it("demo samples ride the featured Netflix mark, untouched by the Other group", async () => {
    expect(DEMO_SAMPLE_NETWORK).toMatchObject({ name: "Netflix" })
    expect(isFeaturedNetworkKey("netflix")).toBe(true)
    const res = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(res?.networkKey).toBe("netflix")
  })
})

describe("curated transport (bounds, token, URL, cache)", () => {
  it("bounds derive from the registry: 75 + sentinel = 76", () => {
    expect(MAX_DISABLED_NETWORKS).toBe(NETWORK_IDS.length + 1)
    expect(MAX_DISABLED_NETWORKS).toBe(76)
    const full = [...NETWORK_IDS, TMDB_FALLBACK_SENTINEL]
    expect(sanitizeDisabledNetworks(full)).toEqual(full)
    expect(sanitizeDisabledNetworks([...full, "extra-overflow"])).toHaveLength(76)
  })

  it("config tokens accept the full 76-entry list and reject overlong ones", () => {
    const base = {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
    } as const
    const full = [...NETWORK_IDS, TMDB_FALLBACK_SENTINEL]
    expect(
      configTokenSchema.safeParse({ ...base, disabledNetworks: full }).success,
    ).toBe(true)
    expect(
      partialCatalogTokenSchema.safeParse({ disabledNetworks: full }).success,
    ).toBe(true)
    expect(
      configTokenSchema.safeParse({ ...base, disabledNetworks: [...full, "extra-overflow"] }).success,
    ).toBe(false)
    // Stored hidden IDs (old or new) survive the schema: no silent migration.
    expect(
      configTokenSchema.safeParse({ ...base, disabledNetworks: ["amc", "channel4"] }).success,
    ).toBe(true)
  })

  it("Stremio URLs emit canonical sorted IDs incl. new marks and the sentinel, explicit in compact", () => {
    const p = buildStremioPosterSearchParams({
      lang: "it",
      disabledNetworks: ["starz", "bogus", "bbc", TMDB_FALLBACK_SENTINEL],
    })
    expect(p.get("dnet")).toBe(`${TMDB_FALLBACK_SENTINEL},bbc,starz`)
    const compact = buildStremioPosterSearchParams({
      lang: "it",
      compactTuning: true,
      disabledNetworks: ["channel4"],
    })
    expect(compact.get("dnet")).toBe("channel4")
    expect(compact.has("dv")).toBe(true)
  })

  it("poster cache keys canonicalize new IDs with presence/empty invariance", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("dnet=starz,bbc"))
    const b = normalizePosterCacheParams(new URLSearchParams("dnet=bbc,starz,bogus"))
    expect(a.toString()).toBe(b.toString())
    expect(a.get("dnet")).toBe("bbc,starz")
    const empty = normalizePosterCacheParams(new URLSearchParams("dnet="))
    expect(empty.has("dnet")).toBe(true)
    const absent = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    expect(absent.has("dnet")).toBe(false)
    expect(absent.toString()).not.toBe(empty.toString())
  })
})

describe("curated provider-glass neutrality", () => {
  it("new brands resolve to neutral (no invented palette), manual accent still wins", () => {
    for (const key of ["peacock", "discovery_plus", "bbc", "itv", "channel4", "starz", "britbox", "argos", "real_time"]) {
      expect(resolveProviderGlassBrandHex(key)).toBeNull()
    }
    expect(resolveProviderGlassAccent("peacock", null)).toBeNull()
    expect(
      resolveProviderGlassAccent("peacock", { genreColor: "#123456", rankColor: "#123456" }),
    ).toBe("#123456")
  })
})
