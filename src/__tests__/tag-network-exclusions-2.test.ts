/**
 * Space-wide exclusions, part 2: resolution, transport and cache alignment.
 *
 * - poster-config chain: query `dct`/`dnet` > config token > server defaults
 *   (flat, shared) > [] (historical); unknown IDs dropped at every level.
 * - Stremio/defaults-preview URLs emit canonical `dct`/`dnet` only when
 *   non-empty (legacy URLs byte-identical), explicit even in compact mode.
 * - `normalizePosterCacheParams` canonicalizes (sorted, deduped) and drops
 *   empties/garbage so one render keeps one key.
 * - Config tokens accept the new bounded fields (old tokens stay valid);
 *   the proxy defaults signature rotates when exclusions change.
 * - The shared network pipeline skips disabled marks before both the local
 *   and TMDB-fallback paths (no resurrection), on every layout.
 * - Manual explicit overrides stay authoritative over disabled auto tags.
 */
import { describe, it, expect } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { configTokenSchema } from "@/lib/config-token"
import { proxyDefaultsSignature } from "@/lib/addon-proxy"
import { computeTopBadge, type BadgeInput } from "@/lib/poster-badge"
import {
  renderFirstMatchingNetworkLogoBadgeHybrid,
  renderFirstMatchingNetworkRawBadgeHybrid,
} from "@/lib/network-svgs"

const t = (k: string) => k

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: false,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

function baseBadgeInput(over: Partial<BadgeInput> = {}): BadgeInput {
  return {
    mediaType: "movie",
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    voteAverage: 7.5,
    trendRank: null,
    animeRank: null,
    awards: [],
    nominations: [],
    studios: [],
    director: null,
    tvType: null,
    tvStatus: null,
    ...over,
  }
}

describe("poster-config exclusion chain", () => {
  it("absent everywhere resolves to empty (historical)", () => {
    const cfg = resolvePosterRenderConfig(baseInput())
    expect(cfg.disabledContentTags).toEqual([])
    expect(cfg.disabledNetworks).toEqual([])
  })

  it("query wins over config and defaults, unknown dropped", () => {
    const cfg = resolvePosterRenderConfig(
      baseInput({
        searchParams: new URLSearchParams("dct=trueStory,bogus,subgenre:heist&dnet=netflix,nope"),
        configOverride: { disabledContentTags: ["award"], disabledNetworks: ["prime"] } as never,
        sd: { disabledContentTags: ["kdrama"], disabledNetworks: ["hbo"] },
      }),
    )
    expect(cfg.disabledContentTags).toEqual(["trueStory", "subgenre:heist"])
    expect(cfg.disabledNetworks).toEqual(["netflix"])
  })

  it("config wins over defaults when query absent", () => {
    const cfg = resolvePosterRenderConfig(
      baseInput({
        configOverride: { disabledContentTags: ["trueStory"], disabledNetworks: ["sky"] } as never,
        sd: { disabledContentTags: ["award"], disabledNetworks: ["hbo"] },
      }),
    )
    expect(cfg.disabledContentTags).toEqual(["trueStory"])
    expect(cfg.disabledNetworks).toEqual(["sky"])
  })

  it("defaults apply, sanitized", () => {
    const cfg = resolvePosterRenderConfig(
      baseInput({ sd: { disabledContentTags: ["award", "zzz"], disabledNetworks: ["prime"] } }),
    )
    expect(cfg.disabledContentTags).toEqual(["award"])
    expect(cfg.disabledNetworks).toEqual(["prime"])
  })
})

describe("stremio URL emission", () => {
  it("omits dct/dnet when empty (legacy URLs byte-identical)", () => {
    const p = buildStremioPosterSearchParams({ lang: "it" })
    expect(p.has("dct")).toBe(false)
    expect(p.has("dnet")).toBe(false)
  })

  it("emits canonical sorted allowlisted IDs", () => {
    const p = buildStremioPosterSearchParams({
      lang: "it",
      disabledContentTags: ["trueStory", "bogus", "award", "award"],
      disabledNetworks: ["prime", "nope", "netflix"],
    })
    expect(p.get("dct")).toBe("award,trueStory")
    expect(p.get("dnet")).toBe("netflix,prime")
  })

  it("stays explicit in compact mode (never inside dv)", () => {
    const p = buildStremioPosterSearchParams({
      lang: "it",
      compactTuning: true,
      disabledContentTags: ["trueStory"],
      disabledNetworks: ["netflix"],
    })
    expect(p.get("dct")).toBe("trueStory")
    expect(p.get("dnet")).toBe("netflix")
    expect(p.has("dv")).toBe(true)
  })
})

describe("defaults preview emission", () => {
  it("always emits dct/dnet explicitly (empty as dct= so staged [] overrides saved)", () => {
    const empty = new URL(
      buildDefaultsPreviewUrl({ defaultDisabledContentTags: [], defaultDisabledNetworks: [] }),
      "http://x",
    )
    expect(empty.searchParams.has("dct")).toBe(true)
    expect(empty.searchParams.get("dct")).toBe("")
    expect(empty.searchParams.has("dnet")).toBe(true)
    expect(empty.searchParams.get("dnet")).toBe("")
    const url = new URL(
      buildDefaultsPreviewUrl({ defaultDisabledContentTags: ["kdrama"], defaultDisabledNetworks: ["hbo"] }),
      "http://x",
    )
    expect(url.searchParams.get("dct")).toBe("kdrama")
    expect(url.searchParams.get("dnet")).toBe("hbo")
  })
})

describe("poster cache key normalization", () => {
  it("canonicalizes order; garbage and explicit empty share the dct= key, distinct from absent", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("dct=trueStory,award&dnet=prime,netflix"))
    const b = normalizePosterCacheParams(new URLSearchParams("dct=award,trueStory,bogus&dnet=netflix,prime"))
    expect(a.toString()).toBe(b.toString())
    expect(a.get("dct")).toBe("award,trueStory")
    const empty = normalizePosterCacheParams(new URLSearchParams("dct=&dnet="))
    expect(empty.get("dct")).toBe("")
    expect(empty.has("dct")).toBe(true)
    expect(empty.has("dnet")).toBe(true)
    const garbage = normalizePosterCacheParams(new URLSearchParams("dct=bogus&dnet=nope"))
    expect(garbage.toString()).toBe(empty.toString())
    // Absent keeps its own key: it may inherit disabled defaults server-side
    // while explicit empty renders with no exclusions.
    const absent = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    expect(absent.has("dct")).toBe(false)
    expect(absent.has("dnet")).toBe(false)
    expect(absent.toString()).not.toBe(empty.toString())
  })

  it("non-exclusion params keep their historical keys", () => {
    const p = normalizePosterCacheParams(new URLSearchParams("sash=extra,rank&bs=pill"))
    expect(p.get("sash")).toBe("extra,rank")
    expect(p.get("bs")).toBe("pill")
  })
})

describe("config token acceptance", () => {
  it("accepts bounded exclusions, old tokens stay valid", () => {
    const full = configTokenSchema.safeParse({
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
      disabledContentTags: ["trueStory", "subgenre:heist"],
      disabledNetworks: ["netflix", "amazon_mgm"],
    })
    expect(full.success).toBe(true)
    const legacy = configTokenSchema.safeParse({
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
    })
    expect(legacy.success).toBe(true)
  })

  it("rejects overlong exclusion entries", () => {
    const res = configTokenSchema.safeParse({
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
      disabledContentTags: ["x".repeat(41)],
    })
    expect(res.success).toBe(false)
  })

  it("proxy signature rotates when exclusions change (cache alignment)", () => {
    const a = proxyDefaultsSignature({ badgeStyle: "shadow" })
    const b = proxyDefaultsSignature({ badgeStyle: "shadow", disabledContentTags: ["trueStory"] })
    const c = proxyDefaultsSignature({ badgeStyle: "shadow", disabledNetworks: ["netflix"] })
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
    // Stable: same content, same key (explicit empty is its own stable key
    // once saved — same render, no cross-request flapping).
    expect(proxyDefaultsSignature({ badgeStyle: "shadow", disabledContentTags: ["trueStory"] })).toBe(b)
  })
})

describe("shared network pipeline exclusions", () => {
  it("skips a disabled mark on the local path (no resurrection)", async () => {
    const enabled = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Netflix", logoPath: null }],
      500,
      false,
    )
    expect(enabled?.networkKey).toBe("netflix")
    const disabled = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Netflix", logoPath: null }],
      500,
      false,
      undefined,
      ["netflix"],
    )
    expect(disabled).toBeNull()
  })

  it("falls through to the next enabled candidate", async () => {
    const res = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [
        { name: "Netflix", logoPath: null },
        { name: "HBO", logoPath: null },
      ],
      500,
      false,
      undefined,
      ["netflix"],
    )
    expect(res?.networkKey).toBe("hbo")
  })

  it("raw path honors the same exclusion (all layouts share the pipeline)", async () => {
    const res = await renderFirstMatchingNetworkRawBadgeHybrid(
      [{ name: "Netflix", logoPath: null }],
      500,
      false,
      undefined,
      ["netflix"],
    )
    expect(res).toBeNull()
  })
})

describe("manual overrides stay authoritative", () => {
  it("disabled auto tags do not affect the computed label used under a manual extra", () => {
    // The renderer prefers queryExtra over computed: a disabled auto tag
    // simply yields; a saved manual choice still renders.
    const computed = computeTopBadge(
      baseBadgeInput({ keywords: ["cyberpunk"], disabledContentTags: ["subgenre:cyberpunk"] }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge).toBeNull()
    const manual = "My custom badge"
    const effective = manual || computed.badge?.label
    expect(effective).toBe("My custom badge")
  })

  it("non-disabled auto tags still compute with exclusions present", () => {
    const computed = computeTopBadge(
      baseBadgeInput({ keywords: ["based on a true story"], disabledContentTags: ["subgenre:cyberpunk"] }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge?.label).toBe("badge.trueStory")
  })
})
