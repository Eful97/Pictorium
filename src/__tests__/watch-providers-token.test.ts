/**
 * "Dove guardare" must travel with the install token (self-contained Stremio
 * links) and be honoured by the poster config via `configOverride`.
 */
import { describe, it, expect } from "vitest"
import { configTokenSchema, partialCatalogTokenSchema } from "@/lib/config-token"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"

const minimalToken = {
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
}

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

describe("config token carries watch providers", () => {
  it("full token keeps watchProviders + watchRegion", () => {
    const parsed = configTokenSchema.parse({ ...minimalToken, watchProviders: true, watchRegion: "US" })
    expect(parsed.watchProviders).toBe(true)
    expect(parsed.watchRegion).toBe("US")
  })

  it("partial (device) token keeps them too", () => {
    const parsed = partialCatalogTokenSchema.parse({ watchProviders: true, watchRegion: "FR" })
    expect(parsed.watchProviders).toBe(true)
    expect(parsed.watchRegion).toBe("FR")
  })

  it("old tokens without the fields stay valid", () => {
    expect(configTokenSchema.safeParse(minimalToken).success).toBe(true)
  })
})

describe("poster-config chain with a token", () => {
  const token = configTokenSchema.parse({ ...minimalToken, watchProviders: true, watchRegion: "DE" })

  it("token applies over server defaults", () => {
    const cfg = resolvePosterRenderConfig(baseInput({ configOverride: token, sd: { watchProviders: false, watchRegion: "IT" } }))
    expect(cfg.watchProviders).toBe(true)
    expect(cfg.watchRegion).toBe("DE")
  })

  it("query still wins over the token", () => {
    const cfg = resolvePosterRenderConfig(
      baseInput({ configOverride: token, searchParams: new URLSearchParams("wp=0&wpr=US") }),
    )
    expect(cfg.watchProviders).toBe(false)
    expect(cfg.watchRegion).toBe("US")
  })
})
