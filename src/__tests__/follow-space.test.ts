import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildUrlPattern } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import {
  isImmutablePosterRequest,
  isLivePosterRequest,
  normalizePosterCacheParams,
  posterHeaders,
  posterNotModifiedHeaders,
} from "@/lib/poster-runtime-cache"
import { resolvePosterRenderConfig, resolvePosterShape } from "@/lib/poster-config"
import { validatePosterQuery } from "@/lib/validation"

// UUID v4 validi e distinti per i namespace di test.
const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"

const baseBadgeParams = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow" as const,
  rankingBadgeStyle: "default" as const,
  customBadge: null,
  gradientHeight: 30,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  blurEnabled: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
}

describe("follow-space template (Segui il mio spazio)", () => {
  it("omits visual params and keeps identity + live=1 + rv", () => {
    const url = buildUrlPattern({
      ...baseBadgeParams,
      tmdbKey: "k",
      lang: "it",
      userId: UUID_A,
      followSpace: true,
    })
    expect(url).toContain("/api/poster/{type}/{imdb_id}")
    expect(url).toContain("live=1")
    expect(url).toContain(`u=${UUID_A}`)
    expect(url).toContain("api_key=k")
    expect(url).toContain("rv=")
    for (const frozen of [
      "gradHeight=", "blur=", "bf=", "bd=", "tint=", "ts=",
      "bs=", "rs=", "qbs=", "badges=", "ranking=", "be=",
      "netLogo=", "netPos=", "ribbon=", "side=", "cr=", "sep=",
      "tscale=", "tox=", "toy=", "gscale=", "gox=", "goy=",
      "qscale=", "qox=", "qoy=", "sepscale=", "sepox=", "sepoy=", "netscale=", "nox=", "noy=",
      "lang=", "shape=",
    ]) {
      expect(url).not.toContain(frozen)
    }
  })

  it("keeps id placeholders and the Nuvio shape placeholder", () => {
    const tmdb = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", userId: UUID_A, followSpace: true, idPlaceholder: "{tmdb_id}" })
    expect(tmdb).toContain("/api/poster/{type}/{tmdb_id}")
    expect(tmdb).toContain("live=1")
    const auto = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", followSpace: true, idPlaceholder: "{tmdb_id|imdb_id}" })
    expect(auto).toContain("/api/poster/{type}/{tmdb_id|imdb_id}")
    // Variante Nuvio: il formato resta guidato dalla vista client.
    const nuvio = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", followSpace: true, shapePlaceholder: "{shape}" })
    expect(nuvio).toContain("shape={shape}")
    expect(nuvio).toContain("live=1")
  })

  it("omits api_key per policy but keeps the user identity", () => {
    const url = buildUrlPattern({
      ...baseBadgeParams, tmdbKey: "k", mdblistApiKey: "m", lang: "it",
      userId: UUID_A, omitApiKey: true, omitMdblistKey: true, followSpace: true,
    })
    expect(url).toContain(`u=${UUID_A}`)
    expect(url).not.toContain("api_key=")
    expect(url).not.toContain("mdblist_key=")
    expect(url).toContain("live=1")
  })

  it("fixed template keeps explicit overrides and no live=1", () => {
    const url = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", blurEnabled: false, globalBadges: false })
    expect(url).toContain("be=0")
    expect(url).toContain("badges=0")
    expect(url).not.toContain("live=")
  })

  it("followSpace builder emits only identity + live + rv", () => {
    const params = buildStremioPosterSearchParams({ user: UUID_A, followSpace: true })
    expect(params.get("live")).toBe("1")
    expect(params.get("u")).toBe(UUID_A)
    expect(params.has("rv")).toBe(true)
    expect(params.has("lang")).toBe(false)
    expect(params.has("bs")).toBe(false)
    expect(params.has("blur")).toBe(false)
    expect(params.has("badges")).toBe(false)
  })

  it("live alone combines with explicit overrides (no follow)", () => {
    const params = buildStremioPosterSearchParams({ live: true, lang: "it", blurEnabled: false })
    expect(params.get("live")).toBe("1")
    expect(params.get("be")).toBe("0")
    expect(params.get("lang")).toBe("it")
  })
})

describe("live=1 validation and cache key", () => {
  it("accepts live=1 and rejects other values", () => {
    expect(validatePosterQuery(new URLSearchParams("live=1"))).toBeNull()
    expect(validatePosterQuery(new URLSearchParams("live=2"))).toContain("live")
  })

  it("keeps live in the normalized cache params (key + ETag)", () => {
    const normalized = normalizePosterCacheParams(new URLSearchParams("live=1&lang=it&rv=99"))
    expect(normalized.get("live")).toBe("1")
    expect(normalized.has("rv")).toBe(false)
    expect(isLivePosterRequest(new URLSearchParams("live=1"))).toBe(true)
    expect(isLivePosterRequest(new URLSearchParams("lang=it"))).toBe(false)
  })
})

describe("live=1 HTTP cache policy", () => {
  it("serves must-revalidate without freshness or SWR on 200", () => {
    const headers = posterHeaders("\"etag\"", false, false, true, "jpeg", undefined, true)
    expect(headers["Cache-Control"]).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(headers["CDN-Cache-Control"]).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(headers["Surrogate-Control"]).toBe("max-age=0, must-revalidate")
    expect(headers["ETag"]).toBe("\"etag\"")
    expect(headers["Cache-Control"]).not.toContain("stale-while-revalidate")
    expect(headers["Cache-Control"]).not.toContain("no-store")
  })

  it("applies the same policy on 304", () => {
    const headers = posterNotModifiedHeaders("\"etag\"", false, true, 21600, true)
    expect(headers["Cache-Control"]).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(headers["CDN-Cache-Control"]).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(headers["Surrogate-Control"]).toBe("max-age=0, must-revalidate")
    expect(headers["ETag"]).toBe("\"etag\"")
  })

  it("preview stays no-store even with live=1", () => {
    const headers = posterHeaders("\"etag\"", false, true, false, "jpeg", undefined, true)
    expect(headers["Cache-Control"]).toContain("no-store")
  })

  it("live=1 is never immutable, and neither is the versioned mapped path (audit problems 3-4)", () => {
    const params = new URLSearchParams("rv=81&mv=1784218530000&live=1")
    expect(isImmutablePosterRequest(params, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: true,
    })).toBe(false)
    // mapping+rv+mv non coprono ranking live e altri dati dinamici: niente
    // immutable annuale nemmeno fuori dal live (contratto conservativo).
    const fixed = new URLSearchParams("rv=81&mv=1784218530000")
    expect(isImmutablePosterRequest(fixed, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: true,
    })).toBe(false)
  })
})

describe("live=1 server resolution (absent params follow the space)", () => {
  function liveConfig(sd: Record<string, unknown>, mapping: null = null) {
    return resolvePosterRenderConfig({
      searchParams: new URLSearchParams("live=1"),
      mapping,
      configOverride: null,
      sd: sd as Parameters<typeof resolvePosterRenderConfig>[0]["sd"],
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
  }

  it("saved false stays false when the param is absent", () => {
    const cfg = liveConfig({ globalBadges: false, rankingBadges: false, blurEnabled: false })
    expect(cfg.badgesEnabled).toBe(false)
    expect(cfg.rankingEnabled).toBe(false)
    expect(cfg.blurEnabled).toBe(false)
  })

  it("landscape blur follows the saved format profile", () => {
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("live=1&shape=landscape"),
      mapping: null, configOverride: null,
      sd: { blurEnabled: true, landscape: { blurEnabled: false } },
      hasQuery: false, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(cfg.blurEnabled).toBe(false)
  })

  it("live ribbon side follows the space unless explicitly overridden", () => {
    expect(liveConfig({ ribbonSide: "right" }).ribbonSide).toBe("right")
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("live=1&side=left"),
      mapping: null, configOverride: null, sd: { ribbonSide: "right" },
      hasQuery: false, showBadges: true, rankingBadges: true,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(cfg.ribbonSide).toBe("left")
  })

  it("live badge toggles prefer title settings over the config token", () => {
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("live=1"),
      mapping: { showBadges: false, rankingBadges: false } as never,
      configOverride: { globalBadges: true, rankingBadges: true } as never,
      sd: { globalBadges: true, rankingBadges: true },
      hasQuery: true, showBadges: false, rankingBadges: false,
      animeRank: null, rankingResult: null, finalRank: null,
    })
    expect(cfg.badgesEnabled).toBe(false)
    expect(cfg.rankingEnabled).toBe(false)
  })

  it("legacy path without live keeps ON defaults (unchanged behavior)", () => {
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(""),
      mapping: null,
      configOverride: null,
      sd: { globalBadges: false, rankingBadges: false, blurEnabled: false },
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfg.badgesEnabled).toBe(true)
    expect(cfg.rankingEnabled).toBe(true)
    expect(cfg.blurEnabled).toBe(true)
  })

  it("explicit overrides still win on the live path", () => {
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("live=1&badges=0&ranking=0&be=0"),
      mapping: null,
      configOverride: null,
      sd: { globalBadges: true, rankingBadges: true, blurEnabled: true },
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfg.badgesEnabled).toBe(false)
    expect(cfg.rankingEnabled).toBe(false)
    expect(cfg.blurEnabled).toBe(false)
  })

  it("changed space values resolve on the next request (same live URL)", () => {
    const before = liveConfig({ blurIntensity: 20, badgeStyle: "shadow" })
    const after = liveConfig({ blurIntensity: 60, badgeStyle: "pill" })
    expect(before.blurIntensity).toBe(20)
    expect(after.blurIntensity).toBe(60)
    expect(before.badgeStyle).toBe("shadow")
    expect(after.badgeStyle).toBe("pill")
  })

  it("shape follows mapping then space; Nuvio placeholder falls back", () => {
    const q = new URLSearchParams("live=1")
    expect(resolvePosterShape(q, { posterShape: "landscape" } as never, null, {})).toBe("landscape")
    expect(resolvePosterShape(q, null, null, { posterShape: "landscape" })).toBe("landscape")
    expect(resolvePosterShape(new URLSearchParams("live=1&shape=%7Bshape%7D"), null, null, {})).toBe("poster")
    expect(resolvePosterShape(new URLSearchParams("live=1&shape=landscape"), null, null, {})).toBe("landscape")
  })
})

describe("defaults revision via epoch (two simulated instances)", () => {
  const ENV_KEYS = ["PICTORIUM_DATA_DIR", "PICTORIUM_MULTI_USER"] as const
  let savedEnv: Record<string, string | undefined> = {}
  let tempDir: string | undefined

  beforeEach(async () => {
    savedEnv = {}
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-follow-"))
    process.env.PICTORIUM_DATA_DIR = tempDir
    process.env.PICTORIUM_MULTI_USER = "1"
    vi.resetModules()
  })

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    vi.resetModules()
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it("user namespace: external save + bump is visible without waiting the TTL", async () => {
    const sd = await import("@/lib/server-defaults")
    const epoch = await import("@/lib/catalog-epoch")
    // Istanza B: prima lettura (popola la cache in memoria).
    expect((await sd.getServerDefaultsForUser(UUID_A)).blurIntensity).toBeUndefined()
    // Istanza A: scrive direttamente sul backend condiviso e fa bump.
    await fsp.mkdir(path.join(tempDir!, "users", UUID_A), { recursive: true })
    await fsp.writeFile(
      path.join(tempDir!, "users", UUID_A, "defaults.json"),
      JSON.stringify({ blurIntensity: 77 }),
    )
    await epoch.bumpCatalogEpoch(UUID_A)
    // Istanza B: rileva la revisione e ricarica (niente attesa 5min).
    expect((await sd.getServerDefaultsForUser(UUID_A)).blurIntensity).toBe(77)
  })

  it("user namespace: writes on A do not leak into B", async () => {
    const sd = await import("@/lib/server-defaults")
    const epoch = await import("@/lib/catalog-epoch")
    await sd.setServerDefaultsForUser(UUID_A, { blurIntensity: 11 })
    await epoch.bumpCatalogEpoch(UUID_A)
    expect((await sd.getServerDefaultsForUser(UUID_A)).blurIntensity).toBe(11)
    expect((await sd.getServerDefaultsForUser(UUID_B)).blurIntensity).toBeUndefined()
  })

  it("global defaults: external save + bump is visible via the checked read", async () => {
    const sd = await import("@/lib/server-defaults")
    const epoch = await import("@/lib/catalog-epoch")
    expect((await sd.getServerDefaultsChecked()).blurIntensity).toBeUndefined()
    await fsp.writeFile(path.join(tempDir!, "defaults.json"), JSON.stringify({ blurIntensity: 42 }))
    await epoch.bumpCatalogEpoch()
    expect((await sd.getServerDefaultsChecked()).blurIntensity).toBe(42)
  })

  it("unchanged revision reuses memory (deleted file still served)", async () => {
    const sd = await import("@/lib/server-defaults")
    await sd.setServerDefaults({ blurIntensity: 5 })
    expect((await sd.getServerDefaultsChecked()).blurIntensity).toBe(5)
    await fsp.rm(path.join(tempDir!, "defaults.json"), { force: true })
    // Nessun bump: la revisione è invariata, vale la memoria.
    expect((await sd.getServerDefaultsChecked()).blurIntensity).toBe(5)
  })
})
