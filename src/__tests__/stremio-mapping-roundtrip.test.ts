import { describe, expect, it, vi } from "vitest"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import type { PictoriumUserConfig } from "@/lib/config-token"
import type { Mapping } from "@/lib/types"

// Il setup globale mocca `@/lib/i18n` con `isRankKey: () => null`: per questo
// test serve la logica reale (mirror fedele di i18n.isRankKey), altrimenti la
// guardia rank-key in buildStremioPosterUrl non è verificabile.
vi.mock("@/lib/i18n", () => {
  const rankKeys = new Set(["badge.today", "badge.anime", "badge.movie", "badge.series"])
  const identity = (v: string) => v
  return {
    t: identity,
    createT: () => identity,
    setLang: () => {},
    getLang: () => "it",
    isPrefixedKey: (v: string) => v.startsWith("__"),
    badgeKey: (v: string) => (v.startsWith("__") ? v.slice(2) : v),
    resolveLabel: identity,
    resolveLabelFor: identity,
    isRankKey: (v: string | null) => {
      if (!v) return null
      if (v.startsWith("__")) {
        const key = v.slice(2)
        return rankKeys.has(key) ? key : null
      }
      if (v === "Anime") return "badge.anime"
      return null
    },
    BADGE_KEY_PREFIX: "__",
  }
})

function styledMapping(): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "Styled",
    posterPath: "/custom.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
    showBadges: false,
    rankingBadges: false,
    badgeStyle: "pill",
    rankingBadgeStyle: "colored",
    gradientHeight: 80,
    blurEnabled: false,
    blurIntensity: 50,
    blurFade: 10,
    blurDarkness: 90,
    customBadge: "Da cinema",
  }
}

// Config token che dice l'opposto del mapping: la query esplicita deve
// vincere sul token (installazioni /c/<token>), mai il contrario.
function opposingToken(): PictoriumUserConfig {
  return {
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
  }
}

function resolveFromUrl(url: URL, mapping: Mapping | null, configOverride: PictoriumUserConfig | null) {
  return resolvePosterRenderConfig({
    searchParams: url.searchParams,
    mapping,
    configOverride,
    sd: {},
    hasQuery: true,
    showBadges: mapping?.showBadges ?? true,
    rankingBadges: mapping?.rankingBadges ?? true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    lang: "it",
  })
}

describe("stremio mapping round-trip (F2)", () => {
  it("emits per-title values explicitly in the Stremio URL", () => {
    const url = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: styledMapping(),
      lang: "it",
    })
    const q = url.searchParams
    expect(q.get("badges")).toBe("0")
    expect(q.get("ranking")).toBe("0")
    expect(q.get("bs")).toBe("pill")
    expect(q.get("rs")).toBe("colored")
    expect(q.get("gradHeight")).toBe("80")
    expect(q.get("blur")).toBe("50")
    expect(q.get("bf")).toBe("10")
    expect(q.get("bd")).toBe("90")
    expect(q.get("be")).toBe("0")
    expect(q.get("extra")).toBe("Da cinema")
  })

  it("resolves the mapping style server-side, even against an opposing config token", () => {
    const mapping = styledMapping()
    const url = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: {},
      mapping,
      lang: "it",
    })
    const cfg = resolveFromUrl(url, mapping, opposingToken())
    expect(cfg.badgesEnabled).toBe(false)
    expect(cfg.rankingEnabled).toBe(false)
    expect(cfg.badgeStyle).toBe("pill")
    expect(cfg.rankingBadgeStyle).toBe("colored")
    expect(cfg.blurHeight).toBe(80)
    expect(cfg.blurEnabled).toBe(false)
    expect(cfg.blurIntensity).toBe(50)
    expect(cfg.blurFade).toBe(10)
    expect(cfg.blurDarkness).toBe(90)
    expect(cfg.queryExtra).toBe("Da cinema")
  })

  it("does not emit rank-key customBadges as extra (no duplicate badge)", () => {
    for (const rankKey of ["__badge.today", "__badge.anime", "__badge.movie", "__badge.series", "Anime"]) {
      const mapping: Mapping = { ...styledMapping(), customBadge: rankKey }
      const url = buildStremioPosterUrl({
        origin: "https://x.test",
        type: "movie",
        id: 1,
        defaults: {},
        mapping,
        lang: "it",
      })
      expect(url.searchParams.has("extra")).toBe(false)
      expect(resolveFromUrl(url, mapping, null).queryExtra).toBeNull()
    }
  })

  it("falls back to defaults when the mapping carries no style opinion", () => {
    const url = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 1,
      defaults: { badgeStyle: "bar", globalBadges: false },
      mapping: null,
    })
    expect(url.searchParams.get("bs")).toBe("bar")
    expect(url.searchParams.get("badges")).toBe("0")
    expect(url.searchParams.has("extra")).toBe(false)
  })
})
