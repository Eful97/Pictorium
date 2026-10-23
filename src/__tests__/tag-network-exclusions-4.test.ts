/**
 * Space-wide exclusions, part 4: follow-up corrections.
 *
 * RED-before/GREEN-after for the independent-review findings:
 * (1) preview/default-preview must EXPLICITLY override saved nonempty
 *     defaults: staged [] emits `dct=`/`dnet=` and the server resolves []
 *     instead of inheriting the saved lists;
 * (2) `normalizePosterCacheParams` must keep explicit empty (`dct=`) and
 *     garbage (`dct=bogus`) as their own canonical key (`dct=`), distinct
 *     from the absent key (which may inherit disabled defaults);
 * (3) the profileless catalog-only token must carry the device's exclusion
 *     choices (not just the instance defaults) — tested at the real route
 *     payload level, not schema-only;
 * (4) multiple canonical sub-genre keyword matches: a disabled first match
 *     yields to the next ENABLED match before lower-priority trueStory/etc;
 * (TMDB) the `__tmdb_fallback` sentinel gates the whole Other group
 *     (every non-featured local mark before load plus the TMDB fallback
 *     path), while featured marks stay on their own individual toggles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return { ...mod, getServerDefaultsChecked: vi.fn(async () => ({})) }
})

import { getServerDefaultsChecked } from "@/lib/server-defaults"
import {
  NETWORK_IDS,
  NETWORK_DISPLAY_NAMES,
  sanitizeDisabledNetworks,
  isNetworkDisabled,
  TMDB_FALLBACK_SENTINEL,
  MAX_DISABLED_NETWORKS,
  isTmdbFallbackDisabled,
} from "@/lib/network-keys"
import { getAllSubGenreMatches } from "@/lib/subgenres"
import { isContentTagDisabled } from "@/lib/content-tags"
import { computeTopBadge, type BadgeInput } from "@/lib/poster-badge"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { POST as mintPOST } from "@/app/api/config-token/route"
import { decodeConfig } from "@/lib/config-token"

vi.mock("@/lib/poster-render-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-render-helpers")>()
  return { ...mod, fetchImg: vi.fn() }
})

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
}))

import { fetchImg } from "@/lib/poster-render-helpers"
import {
  renderFirstMatchingNetworkLogoBadgeHybrid,
  renderFirstMatchingNetworkRawBadgeHybrid,
} from "@/lib/network-svgs"
import { userFetch } from "@/lib/http"
import { isProfilelessOnMultiUser } from "@/lib/guest-guard"
import { useLocalConfigToken } from "@/lib/useLocalConfigToken"
import { __clearMintConfigTokenCache } from "@/lib/mint-config-token"
import { renderHook, waitFor } from "@testing-library/react"

const mockedFetchImg = vi.mocked(fetchImg)

const t = (k: string) => k

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

function baseRenderInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
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

describe("tmdb-fallback sentinel registry", () => {
  it("is documented, bounded, and never a canonical SVG key", () => {
    expect(TMDB_FALLBACK_SENTINEL).toBe("__tmdb_fallback")
    expect(NETWORK_IDS).not.toContain(TMDB_FALLBACK_SENTINEL)
    expect(NETWORK_DISPLAY_NAMES[TMDB_FALLBACK_SENTINEL]).toBeUndefined()
    // 74 canonical marks + the sentinel share one bounded list.
    expect(MAX_DISABLED_NETWORKS).toBe(75)
  })

  it("sanitize keeps the sentinel, drops unknown, dedupes, caps at 75", () => {
    expect(sanitizeDisabledNetworks([TMDB_FALLBACK_SENTINEL])).toEqual([TMDB_FALLBACK_SENTINEL])
    expect(
      sanitizeDisabledNetworks(["bogus", TMDB_FALLBACK_SENTINEL, "netflix", TMDB_FALLBACK_SENTINEL]),
    ).toEqual([TMDB_FALLBACK_SENTINEL, "netflix"])
    expect(sanitizeDisabledNetworks("nope" as unknown as string[])).toEqual([])
    const full = [...NETWORK_IDS, TMDB_FALLBACK_SENTINEL, "extra-overflow"]
    expect(sanitizeDisabledNetworks(full)).toHaveLength(75)
    expect(sanitizeDisabledNetworks(full)).toContain(TMDB_FALLBACK_SENTINEL)
  })

  it("gates only the TMDB fallback, never registered marks", () => {
    expect(isTmdbFallbackDisabled([TMDB_FALLBACK_SENTINEL])).toBe(true)
    expect(isTmdbFallbackDisabled(["netflix"])).toBe(false)
    expect(isTmdbFallbackDisabled(null)).toBe(false)
    expect(isTmdbFallbackDisabled([])).toBe(false)
    // The sentinel must not read as a disabled registered mark.
    expect(isNetworkDisabled("netflix", [TMDB_FALLBACK_SENTINEL])).toBe(false)
    expect(isNetworkDisabled(TMDB_FALLBACK_SENTINEL, [TMDB_FALLBACK_SENTINEL])).toBe(false)
  })
})

describe("shared network pipeline tmdb-fallback gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A valid 1x1 transparent PNG: the fallback WOULD succeed without the gate.
    mockedFetchImg.mockResolvedValue(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
  })

  it("skips unknown TMDB marks before any fetch when the sentinel is set", async () => {
    const res = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Some Unknown Network XYZ", logoPath: "/abc123.jpg" }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(res).toBeNull()
    expect(mockedFetchImg).not.toHaveBeenCalled()
  })

  it("raw path honors the same gate", async () => {
    const res = await renderFirstMatchingNetworkRawBadgeHybrid(
      [{ name: "Some Unknown Network XYZ", logoPath: "/abc123.jpg" }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(res).toBeNull()
    expect(mockedFetchImg).not.toHaveBeenCalled()
  })

  it("featured local marks stay independent of the sentinel; hidden ones follow the Other group", async () => {
    const featured = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Netflix", logoPath: null }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(featured?.networkKey).toBe("netflix")
    expect(mockedFetchImg).not.toHaveBeenCalled()
    // A non-featured bundled mark is group-gated: sentinel OFF suppresses
    // it before load (no fetch), clearing the sentinel re-enables it.
    const hidden = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "AMC", logoPath: null }],
      500,
      false,
      undefined,
      [TMDB_FALLBACK_SENTINEL],
    )
    expect(hidden).toBeNull()
    expect(mockedFetchImg).not.toHaveBeenCalled()
    const reenabled = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "AMC", logoPath: null }],
      500,
      false,
      undefined,
      [],
    )
    expect(reenabled?.networkKey).toBe("amc")
  })
})

describe("subgenre next-enabled match", () => {
  it("lists every canonical match in priority order", () => {
    const all = getAllSubGenreMatches(["cyberpunk", "heist"], "it")
    expect(all.map((m) => m.key)).toEqual(["cyberpunk", "heist"])
    expect(all[0]?.label).toBe("Cyberpunk")
    expect(all[1]?.label).toBe("Film di Rapina")
    expect(getAllSubGenreMatches(["romantic comedy"], "it")).toEqual([])
  })

  it("a disabled first match yields to the next enabled subgenre", () => {
    const computed = computeTopBadge(
      baseBadgeInput({
        keywords: ["cyberpunk", "heist"],
        disabledContentTags: ["subgenre:cyberpunk"],
      }),
      t,
      "it",
      null,
      "locale",
    )
    // Italian Heist label ("Film di Rapina"), not trueStory/book, not null.
    expect(computed.badge?.label).toBe("Film di Rapina")
  })

  it("family exclusion still disables every subgenre badge", () => {
    const computed = computeTopBadge(
      baseBadgeInput({
        keywords: ["cyberpunk", "heist", "based on a true story"],
        disabledContentTags: ["subgenre"],
      }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge?.label).toBe("badge.trueStory")
  })

  it("all subgenres disabled falls through to lower buckets (unchanged)", () => {
    const computed = computeTopBadge(
      baseBadgeInput({
        keywords: ["cyberpunk", "heist", "based on a true story"],
        disabledContentTags: ["subgenre:cyberpunk", "subgenre:heist"],
      }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge?.label).toBe("badge.trueStory")
  })

  it("isContentTagDisabled still matches family and canonical keys", () => {
    expect(isContentTagDisabled("subgenre", "heist", ["subgenre:cyberpunk"])).toBe(false)
    expect(isContentTagDisabled("subgenre", "heist", ["subgenre:heist"])).toBe(true)
    expect(isContentTagDisabled("subgenre", "heist", ["subgenre"])).toBe(true)
  })
})

describe("preview explicit-empty override (saved nonempty + staged empty)", () => {
  it("defaults preview emits dct=/dnet= for staged empty lists", () => {
    const url = new URL(
      buildDefaultsPreviewUrl({ defaultDisabledContentTags: [], defaultDisabledNetworks: [] }),
      "http://x",
    )
    expect(url.searchParams.has("dct")).toBe(true)
    expect(url.searchParams.get("dct")).toBe("")
    expect(url.searchParams.has("dnet")).toBe(true)
    expect(url.searchParams.get("dnet")).toBe("")
  })

  it("staged empty query resolves [] over saved nonempty defaults", () => {
    const cfg = resolvePosterRenderConfig(
      baseRenderInput({
        searchParams: new URLSearchParams("dct=&dnet="),
        sd: { disabledContentTags: ["award"], disabledNetworks: ["netflix"] },
      }),
    )
    expect(cfg.disabledContentTags).toEqual([])
    expect(cfg.disabledNetworks).toEqual([])
  })

  it("end to end: staged empty preview URL clears saved nonempty on resolve", () => {
    const preview = new URL(
      buildDefaultsPreviewUrl({ defaultDisabledContentTags: [], defaultDisabledNetworks: [] }),
      "http://x",
    )
    const cfg = resolvePosterRenderConfig(
      baseRenderInput({
        searchParams: preview.searchParams,
        sd: { disabledContentTags: ["award"], disabledNetworks: ["netflix"] },
      }),
    )
    expect(cfg.disabledContentTags).toEqual([])
    expect(cfg.disabledNetworks).toEqual([])
  })
})

describe("poster cache explicit-empty vs absent", () => {
  it("keeps explicit empty as its own key, distinct from absent", () => {
    const empty = normalizePosterCacheParams(new URLSearchParams("dct=&dnet="))
    expect(empty.has("dct")).toBe(true)
    expect(empty.get("dct")).toBe("")
    expect(empty.has("dnet")).toBe(true)
    const absent = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    expect(absent.has("dct")).toBe(false)
    expect(absent.has("dnet")).toBe(false)
    expect(empty.toString()).not.toBe(absent.toString())
  })

  it("collapses garbage onto explicit empty (same render, one key)", () => {
    const garbage = normalizePosterCacheParams(new URLSearchParams("dct=bogus&dnet=nope"))
    const empty = normalizePosterCacheParams(new URLSearchParams("dct=&dnet="))
    expect(garbage.toString()).toBe(empty.toString())
  })

  it("keeps sorted canonical values and the sentinel in the key", () => {
    const p = normalizePosterCacheParams(
      new URLSearchParams(`dct=trueStory,award&dnet=prime,${TMDB_FALLBACK_SENTINEL}`),
    )
    expect(p.get("dct")).toBe("award,trueStory")
    expect(p.get("dnet")).toBe(`__tmdb_fallback,prime`)
  })
})

function postBody(config: unknown) {
  return new NextRequest("http://localhost/api/config-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ config }),
  })
}

describe("profileless token carries device exclusion choices (route payload)", () => {
  const baseInstance = {
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

  it("device exclusions win over instance defaults in the issued token", async () => {
    vi.mocked(getServerDefaultsChecked).mockResolvedValueOnce({ ...baseInstance })
    const res = await mintPOST(
      postBody({
        rankingSourceMovie: "cat_m",
        disabledContentTags: ["trueStory", "subgenre:heist"],
        disabledNetworks: ["netflix", TMDB_FALLBACK_SENTINEL],
      }),
    )
    expect(res.status).toBe(200)
    const decoded = decodeConfig((await res.json()).token)
    expect(decoded?.disabledContentTags).toEqual(["trueStory", "subgenre:heist"])
    expect(decoded?.disabledNetworks).toEqual(["netflix", TMDB_FALLBACK_SENTINEL])
  })

  it("device explicit empty clears instance defaults in the issued token", async () => {
    vi.mocked(getServerDefaultsChecked).mockResolvedValueOnce({
      ...baseInstance,
      disabledContentTags: ["award"],
      disabledNetworks: ["hbo"],
    })
    const res = await mintPOST(
      postBody({ rankingSourceMovie: "cat_m", disabledContentTags: [], disabledNetworks: [] }),
    )
    expect(res.status).toBe(200)
    const decoded = decodeConfig((await res.json()).token)
    expect(decoded?.disabledContentTags).toEqual([])
    expect(decoded?.disabledNetworks).toEqual([])
  })

  it("omitted device fields keep the instance fill (legacy behavior)", async () => {
    vi.mocked(getServerDefaultsChecked).mockResolvedValueOnce({
      ...baseInstance,
      disabledContentTags: ["award"],
    })
    const res = await mintPOST(postBody({ rankingSourceMovie: "cat_m" }))
    expect(res.status).toBe(200)
    const decoded = decodeConfig((await res.json()).token)
    expect(decoded?.disabledContentTags).toEqual(["award"])
    expect(decoded?.disabledNetworks).toBeUndefined()
  })
})

describe("useLocalConfigToken carries device exclusions (mint payload)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearMintConfigTokenCache()
  })

  it("includes staged exclusions (even explicit empty) in the catalog-only payload", async () => {
    vi.mocked(isProfilelessOnMultiUser).mockResolvedValue(true)
    const seen: unknown[] = []
    vi.mocked(userFetch).mockImplementation(async (_url: unknown, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)))
      return { ok: true, json: async () => ({ token: "tok-x" }) } as unknown as Response
    })
    const { result } = renderHook(() =>
      useLocalConfigToken({
        customCatalogs: [],
        rankingSourceMovie: "cat_m",
        rankingSourceSeries: "",
        disabledContentTags: ["trueStory"],
        disabledNetworks: [TMDB_FALLBACK_SENTINEL],
      }),
    )
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      config: {
        rankingSourceMovie: "cat_m",
        disabledContentTags: ["trueStory"],
        disabledNetworks: [TMDB_FALLBACK_SENTINEL],
      },
    })
    // Explicit empty travels too (clears instance defaults server-side).
    __clearMintConfigTokenCache()
    seen.length = 0
    const { result: result2 } = renderHook(() =>
      useLocalConfigToken({
        customCatalogs: [],
        rankingSourceMovie: "cat_m",
        rankingSourceSeries: "",
        disabledContentTags: [],
        disabledNetworks: [],
      }),
    )
    await waitFor(() => expect(result2.current.status).toBe("ready"))
    expect(seen[0]).toMatchObject({
      config: { rankingSourceMovie: "cat_m", disabledContentTags: [], disabledNetworks: [] },
    })
  })
})
