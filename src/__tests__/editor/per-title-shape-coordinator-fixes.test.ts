/**
 * Coordinator RED-before/GREEN-after regressions for the two confirmed
 * per-shape precedence bugs:
 * 1. mapped non-live toggles must honor explicit landscape-owned fields
 *    end-to-end (route flat vars + resolvePosterRenderConfig non-live);
 * 2. NEW landscape-owned explicit shadow/inter/default must win over
 *    differing defaults/token (historic flat sentinels preserved).
 */
import { describe, expect, it } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import type { Mapping } from "@/lib/types"

function baseMapping(partial: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 42,
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

function landscapeInput(extra: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  const sp = new URLSearchParams(extra.searchParams ? String(extra.searchParams) : "")
  sp.set("shape", "landscape")
  return baseInput({ ...extra, searchParams: sp })
}

describe("coordinator bug 1: landscape-owned toggles win non-live", () => {
  it("landscape showBadges=false disables badges without query/config", () => {
    const mapping = baseMapping({ showBadges: true, landscape: { showBadges: false } })
    // Route-like flat flags (old route passed flat true here).
    const cfg = resolvePosterRenderConfig(
      landscapeInput({ mapping, showBadges: true, rankingBadges: true }),
    )
    expect(cfg.badgesEnabled).toBe(false)
  })

  it("landscape rankingBadges=false disables ranking without query/config", () => {
    const mapping = baseMapping({ rankingBadges: true, landscape: { rankingBadges: false } })
    const cfg = resolvePosterRenderConfig(
      landscapeInput({ mapping, showBadges: true, rankingBadges: true }),
    )
    expect(cfg.rankingEnabled).toBe(false)
  })

  it("legacy mapping without landscape keeps flat behavior", () => {
    const mapping = baseMapping({ showBadges: false, rankingBadges: false })
    const cfg = resolvePosterRenderConfig(
      landscapeInput({ mapping, showBadges: false, rankingBadges: false }),
    )
    expect(cfg.badgesEnabled).toBe(false)
    expect(cfg.rankingEnabled).toBe(false)
  })

  it("explicit query still wins over owned landscape false", () => {
    const mapping = baseMapping({ showBadges: true, landscape: { showBadges: false } })
    const sp = new URLSearchParams("shape=landscape&badges=1")
    const cfg = resolvePosterRenderConfig(
      baseInput({ mapping, searchParams: sp, showBadges: true, rankingBadges: true }),
    )
    expect(cfg.badgesEnabled).toBe(true)
  })
})

describe("coordinator bug 2: owned sentinel styles win over defaults/token", () => {
  it("owned landscape shadow wins over vetro default", () => {
    const mapping = baseMapping({ badgeStyle: "pill", landscape: { badgeStyle: "shadow" } })
    const cfg = resolvePosterRenderConfig(landscapeInput({ mapping, sd: { badgeStyle: "vetro" } as never }))
    expect(cfg.badgeStyle).toBe("shadow")
  })

  it("owned landscape inter wins over oswald default", () => {
    const mapping = baseMapping({ badgeFont: "oswald", landscape: { badgeFont: "inter" } })
    const cfg = resolvePosterRenderConfig(landscapeInput({ mapping, sd: { badgeFont: "oswald" } as never }))
    expect(cfg.badgeFont).toBe("inter")
  })

  it("owned landscape default wins over pill token via auto-detect with rank", () => {
    const mapping = baseMapping({
      rankingBadgeStyle: "pill",
      badgeRank: 3,
      landscape: { rankingBadgeStyle: "default" },
    })
    const cfg = resolvePosterRenderConfig(
      landscapeInput({
        mapping,
        configOverride: { rankingBadgeStyle: "pill" } as never,
        finalRank: { rank: 3 } as never,
      }),
    )
    // Owned default auto-detects to the Netflix ribbon when a rank shows.
    expect(cfg.rankingBadgeStyle).toBe("netflix")
  })

  it("legacy null/absent landscape inherits the flat (byte-identical)", () => {
    const mapping = baseMapping({ badgeStyle: "pill", badgeFont: "oswald", rankingBadgeStyle: "pill", landscape: {} })
    const cfg = resolvePosterRenderConfig(landscapeInput({ mapping, sd: {} }))
    expect(cfg.badgeStyle).toBe("pill")
    expect(cfg.badgeFont).toBe("oswald")
    expect(cfg.rankingBadgeStyle).toBe("pill")
  })

  it("historic flat shadow still reads as absent (no global change)", () => {
    const mapping = baseMapping({ badgeStyle: "shadow" })
    const cfg = resolvePosterRenderConfig(
      landscapeInput({ mapping, sd: { badgeStyle: "vetro" } as never }),
    )
    // Flat shadow is the historic absent sentinel, so the default wins.
    expect(cfg.badgeStyle).toBe("vetro")
  })

  it("direct resolve matches the explicit Stremio builder query", () => {
    const mapping = baseMapping({
      showBadges: true,
      badgeStyle: "pill",
      badgeFont: "oswald",
      landscape: { showBadges: false, badgeStyle: "shadow", badgeFont: "inter" },
    })
    const url = buildStremioPosterUrl({
      origin: "https://x.test",
      type: "movie",
      id: 42,
      defaults: {},
      mapping,
      forceShape: "landscape",
    })
    expect(url.searchParams.get("bs")).toBe("shadow")
    expect(url.searchParams.get("bfont")).toBe("inter")
    // Same explicit query values resolve identically without the mapping.
    const direct = resolvePosterRenderConfig(landscapeInput({ mapping }))
    const viaQuery = resolvePosterRenderConfig(
      landscapeInput({ mapping: null, searchParams: new URLSearchParams(`shape=landscape&badges=0&bs=shadow&bfont=inter`) }),
    )
    expect(direct.badgesEnabled).toBe(false)
    expect(viaQuery.badgesEnabled).toBe(false)
    expect(direct.badgeStyle).toBe(viaQuery.badgeStyle)
    expect(direct.badgeFont).toBe(viaQuery.badgeFont)
  })
})
