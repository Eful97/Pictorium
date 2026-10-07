/**
 * N5 — fresh (unsaved, mapping-less) title opened with defaultPosterShape
 * landscape starts from the landscape profile (`land ?? flat`, same
 * `effectiveDefaultsForShape` rule as the settings preview and the server).
 * Portrait fresh titles keep the flats. Saved mappings always win.
 *
 * Drives the REAL provider (PictoriumRoot) with deferred network, captures
 * the outgoing editor preview XHR params, and cross-checks them against the
 * server effective config (resolvePosterRenderConfig, mapping null).
 */
import { useEffect } from "react"
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import type { ServerDefaults } from "@/lib/server-defaults"

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  useEffect(() => {
    ctx = v
    ed = e
  })
  return null
}

// --- Deferred fetch rig (same idiom as editor-early-ready) ---

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const calls: string[] = []
const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: unknown[] = []

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

function queueKey(url: string): string | null {
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  if (url.includes("/api/mappings")) return "mappings"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      calls.push(u)
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (key === "mappings") return okJson({ mappings: mappingsPayload })
      if (key) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", onAbort, { once: true })
          const q = queues.get(key) ?? []
          queues.set(key, q)
          q.push({
            resolve: (res: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              resolve(res)
            },
            reject: (err: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              reject(err)
            },
          })
        })
      }
      return okJson({})
    }),
  )
}

function resolveAll(key: string, data: unknown) {
  const q = queues.get(key) ?? []
  queues.set(key, [])
  expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
  for (const p of q) p.resolve(okJson(data))
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

// --- Outgoing preview capture ---
// No EditView mounted here (no usePosterPreview XHR): the provider itself
// publishes the outgoing editor preview URL in ctx.previewUrl.

function lastPreviewParams(): URLSearchParams {
  expect(ctx!.previewUrl, "provider published a preview url").toBeTruthy()
  return new URL(ctx!.previewUrl, "http://localhost").searchParams
}

// --- Fixtures ---

const ITEM_9001: SearchResult = { id: 9001, media_type: "movie", title: "Fresh Land", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_9001 = {
  posters: [img("/fresh-it.jpg", "it")],
  logos: [img("/fresh-logo.png", "it")],
  backdrops: [img("/fresh-bd.jpg", null)],
}

function detailsFixture() {
  return {
    genres: [{ id: 18, name: "Drama" }],
    voteAverage: 8.2,
    voteCount: 120,
    status: null,
    type: null,
    release_date: "2024-03-01",
    first_air_date: null,
    last_air_date: null,
    next_episode_to_air: null,
    number_of_seasons: null,
    number_of_episodes: null,
    title: "Fresh Land",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: null,
  }
}

// Portrait flats vs landscape profile: every scoped field differs.
const STORED = {
  defaultPosterShape: "landscape",
  defaultBadgeStyle: "shadow",
  defaultRankingBadgeStyle: "pill",
  defaultBadgeFont: "inter",
  defaultQualityBadgeStyle: "standard",
  defaultGlobalBadges: true,
  defaultRankingBadges: false,
  defaultBadgeGenre: true,
  defaultBadgeYear: true,
  defaultBadgeRating: false,
  defaultBadgeQuality: true,
  defaultCustomRatings: false,
  defaultSeparateRatings: false,
  defaultNetworkLogo: true,
  defaultNetworkLogoPosition: "auto",
  defaultPreRelease: false,
  defaultRibbonSide: "left",
  defaultRibbonEnabled: false,
  defaultVideoFormats: ["hdr"],
  defaultSashOrder: ["extra", "rank", "new", "award", "upcoming"],
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultGradientHeight: 30,
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultTopShade: 50,
  landscape: {
    badgeStyle: "colored",
    rankingBadgeStyle: "number",
    extraBadgeStyle: "vetro",
    badgeFont: "oswald",
    qualityBadgeStyle: "knockout",
    globalBadges: false,
    rankingBadges: true,
    badgeGenre: false,
    badgeYear: false,
    badgeRating: true,
    badgeQuality: false,
    customRatings: true,
    separateRatings: true,
    separateRatingsStyle: "bottom-pills",
    networkLogo: false,
    networkLogoPosition: "top",
    preRelease: true,
    ribbonSide: "right",
    ribbonEnabled: true,
    videoFormats: ["dv"],
    sashOrder: ["award", "extra"],
    topBadgeScale: 140,
    topBadgeOffsetX: 11,
    topBadgeOffsetY: -7,
    genreBadgeScale: 120,
    gradientHeight: 60,
    blurIntensity: 5,
    blurFade: 90,
    blurDarkness: 80,
    tintStrength: 10,
    topShade: 15,
  },
}

async function renderRoot() {
  ctx = null
  ed = null
  render(
    <PictoriumRoot>
      <Probe />
    </PictoriumRoot>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await flush()
}

async function openFresh9001() {
  await act(async () => {
    ctx!.setTmdbKey("test-key")
  })
  await act(async () => {
    ctx!.navigateToPoster(ITEM_9001)
  })
  await flush(2)
  await resolveFresh9001()
}

async function resolveFresh9001() {
  await act(async () => {
    resolveAll("details:9001", detailsFixture())
    resolveAll("images:9001", IMAGES_9001)
  })
  await flush()
  // Rank/awards/mdblist enrich afterwards; settle empty so nothing pends.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  await flush()
}

beforeEach(() => {
  calls.length = 0
  queues.clear()
  mappingsPayload = []
  localStorage.clear()
  installFetchMock()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("N5 fresh landscape defaults", () => {
  it("fresh landscape title starts from the land profile; preview carries it", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED))
    await renderRoot()
    await openFresh9001()

    // Editor state follows the land profile (not the portrait flats).
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.badgeStyle).toBe("colored")
    expect(ed!.rankingBadgeStyle).toBe("number")
    expect(ed!.extraBadgeStyle).toBe("vetro")
    expect(ed!.badgeFont).toBe("oswald")
    expect(ed!.qualityBadgeStyle).toBe("knockout")
    expect(ed!.globalBadges).toBe(false)
    expect(ed!.rankingBadges).toBe(true)
    expect(ed!.badgeGenre).toBe(false)
    expect(ed!.badgeYear).toBe(false)
    expect(ed!.badgeRating).toBe(true)
    expect(ed!.badgeQuality).toBe(false)
    expect(ed!.customRatings).toBe(true)
    expect(ed!.separateRatings).toBe(true)
    expect(ed!.separateRatingsStyle).toBe("bottom-pills")
    expect(ed!.networkLogo).toBe(false)
    expect(ed!.networkLogoPosition).toBe("top")
    expect(ed!.ribbonSide).toBe("right")
    expect(ed!.ribbonEnabled).toBe(true)
    expect(ed!.preRelease).toBe(true)
    expect(ed!.topBadgeScale).toBe(140)
    expect(ed!.topBadgeOffsetX).toBe(11)
    expect(ed!.topBadgeOffsetY).toBe(-7)
    expect(ed!.genreBadgeScale).toBe(120)
    // Landscape gradient profile intact.
    expect(ed!.landscapeBlur.gradientHeight).toBe(60)
    expect(ed!.landscapeBlur.blurIntensity).toBe(5)
    expect(ed!.landscapeBlur.blurFade).toBe(90)
    // Portrait flats untouched in storage/defaults.
    expect(ed!.defaultBadgeStyle).toBe("shadow")
    expect(ed!.defaultTopBadgeScale).toBe(100)
    expect(ed!.defaultPreRelease).toBe(false)
    expect(ed!.defaultVideoFormats).toEqual(["hdr"])

    // Outgoing editor preview carries the land visuals.
    const p = lastPreviewParams()
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("bs")).toBe("colored")
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("vetro")
    expect(p.get("bfont")).toBe("oswald")
    expect(p.get("qbs")).toBe("knockout")
    expect(p.get("badges")).toBe("0")
    expect(p.get("ranking")).toBe("1")
    expect(p.get("bg")).toBe("0")
    expect(p.get("by")).toBe("0")
    expect(p.get("br")).toBe("1")
    expect(p.get("bq")).toBe("0")
    expect(p.get("cr")).toBe("1")
    expect(p.get("sep")).toBe("1")
    expect(p.get("sepstyle")).toBe("bottom-pills")
    expect(p.get("netLogo")).toBe("0")
    expect(p.get("netPos")).toBe("top")
    expect(p.get("side")).toBe("right")
    expect(p.get("ribbon")).toBe("1")
    expect(p.get("pre")).toBe("1")
    expect(p.get("tscale")).toBe("140")
    expect(p.get("tox")).toBe("11")
    expect(p.get("toy")).toBe("-7")
    expect(p.get("gscale")).toBe("120")
    expect(p.get("gradHeight")).toBe("60")
    expect(p.get("blur")).toBe("5")
    expect(p.get("bf")).toBe("90")
    expect(p.get("bd")).toBe("80")
    expect(p.get("tint")).toBe("10")
    expect(p.get("ts")).toBe("15")
    // A/V formats are explicit per-title: the landscape profile (dv) wins
    // over the auto-persisted portrait flat (hdr) — same freeze contract as
    // the other visuals, and the same value the saved TestURL carries.
    expect(p.get("formats")).toBe("dv")
    expect(ed!.videoFormats).toEqual(["dv"])
  })

  it("early sync init already carries land network/ribbon before images resolve", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED))
    await renderRoot()
    await act(async () => {
      ctx!.setTmdbKey("test-key")
    })
    await act(async () => {
      ctx!.navigateToPoster(ITEM_9001)
    })
    await flush(2)
    // Fetch still in flight: the immediate open-time init (no portrait flash)
    // already shows the landscape profile...
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.badgeStyle).toBe("colored")
    expect(ed!.networkLogo).toBe(false)
    expect(ed!.networkLogoPosition).toBe("top")
    expect(ed!.ribbonSide).toBe("right")
    expect(ed!.ribbonEnabled).toBe(true)
    expect(ed!.preRelease).toBe(true)
    expect(ed!.defaultNetworkLogo).toBe(true)
    expect(ed!.defaultRibbonSide).toBe("left")
    expect(ed!.defaultPreRelease).toBe(false)
    // ...and it survives the async load (loadDefaultsToState reset + re-init).
    await resolveFresh9001()
    expect(ed!.badgeStyle).toBe("colored")
    expect(ed!.networkLogo).toBe(false)
    expect(ed!.networkLogoPosition).toBe("top")
    expect(ed!.ribbonSide).toBe("right")
    expect(ed!.ribbonEnabled).toBe(true)
    expect(ed!.preRelease).toBe(true)
    expect(ed!.defaultNetworkLogo).toBe(true)
    expect(ed!.defaultRibbonSide).toBe("left")
    expect(ed!.defaultPreRelease).toBe(false)
  })

  it("server effective config matches the preview (TestURL after persist, no per-title override)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED))
    await renderRoot()
    await openFresh9001()
    const p = lastPreviewParams()

    // Persisted server defaults (flats + landscape profile) with no mapping:
    // the saved TestURL/meta resolves through the same land profile.
    const sd: ServerDefaults = {
      badgeStyle: "shadow",
      rankingBadgeStyle: "pill",
      badgeFont: "inter",
      qualityBadgeStyle: "standard",
      globalBadges: true,
      rankingBadges: false,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: false,
      badgeQuality: true,
      customRatings: false,
      separateRatings: false,
      separateRatingsStyle: "column",
      networkLogo: true,
      networkLogoPosition: "auto",
      ribbonSide: "left",
      ribbonEnabled: false,
      posterShape: "landscape",
      videoFormats: ["hdr"] as ServerDefaults["videoFormats"],
      preRelease: false,
      sashOrder: ["extra", "rank", "new", "award", "upcoming"],
      topBadgeScale: 100,
      gradientHeight: 30,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      tintStrength: 20,
      topShade: 50,
      landscape: { ...(STORED.landscape as object) } as ServerDefaults["landscape"],
    }
    const cfg = resolvePosterRenderConfig({
      // The real saved TestURL: buildStremioPosterUrl emits the explicit
      // per-title/default flags (mapping null + persisted defaults).
      searchParams: buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 9001,
        defaults: sd,
        mapping: null,
      }).searchParams,
      mapping: null,
      configOverride: null,
      sd,
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
      lang: "it",
    })
    expect(cfg.posterShape).toBe("landscape")
    expect(cfg.badgeStyle).toBe(p.get("bs"))
    expect(cfg.qualityBadgeStyle).toBe(p.get("qbs"))
    expect(cfg.badgeFont).toBe(p.get("bfont"))
    expect(String(cfg.topBadgeScale)).toBe(p.get("tscale"))
    expect(String(cfg.genreBadgeScale)).toBe(p.get("gscale"))
    expect(cfg.badgesEnabled).toBe(p.get("badges") === "1")
    expect(cfg.rankingEnabled).toBe(p.get("ranking") === "1")
    expect(cfg.badgeGenre).toBe(p.get("bg") === "1")
    expect(cfg.badgeRating).toBe(p.get("br") === "1")
    expect(cfg.customRatings).toBe(p.get("cr") === "1")
    expect(cfg.separateRatings).toBe(p.get("sep") === "1")
    expect(cfg.networkLogo).toBe(p.get("netLogo") === "1")
    expect(cfg.networkLogoPosition).toBe(p.get("netPos"))
    expect(cfg.ribbonSide).toBe(p.get("side"))
    expect(cfg.ribbonEnabled).toBe(p.get("ribbon") === "1")
    expect(cfg.preRelease).toBe(true)
    expect(p.get("pre")).toBe("1")
    expect(cfg.sashOrder).toEqual(["award", "extra"])
    // A/V formats: the editor preview carries the explicit landscape profile
    // (dv) — never the portrait flat (hdr) — matching the saved TestURL.
    expect(p.get("formats")).toBe("dv")
    expect(effectiveDefaultsForShape(sd, "landscape").videoFormats).toEqual(["dv"])
    expect(
      buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 9001,
        defaults: sd,
        mapping: null,
      }).searchParams.get("formats"),
    ).toBe("dv")
    expect(String(cfg.blurHeight)).toBe(p.get("gradHeight"))
    expect(String(cfg.blurIntensity)).toBe(p.get("blur"))
    expect(String(cfg.blurFade)).toBe(p.get("bf"))
    expect(String(cfg.blurDarkness)).toBe(p.get("bd"))
    expect(String(cfg.tintStrength)).toBe(p.get("tint"))
    expect(String(cfg.topShade)).toBe(p.get("ts"))
  })

  it("portrait fresh title keeps the flats (delivery unchanged)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ ...STORED, defaultPosterShape: "poster" }),
    )
    await renderRoot()
    await openFresh9001()
    expect(ed!.posterShape).toBe("poster")
    expect(ed!.badgeStyle).toBe("shadow")
    expect(ed!.rankingBadgeStyle).toBe("pill")
    expect(ed!.extraBadgeStyle).toBeNull()
    expect(ed!.badgeFont).toBe("inter")
    expect(ed!.globalBadges).toBe(true)
    expect(ed!.badgeGenre).toBe(true)
    expect(ed!.topBadgeScale).toBe(100)
    expect(ed!.preRelease).toBe(false)
    expect(ed!.landscape.rankingBadgeStyle).toBe("number")
    expect(ed!.landscape.preRelease).toBe(true)
    const p = lastPreviewParams()
    expect(p.get("shape")).toBe("poster")
    expect(p.get("bs")).toBe("shadow")
    expect(p.get("pre")).toBeNull()
    // Portrait keeps the long-standing explicit flat formats.
    expect(p.get("formats")).toBe("hdr")
    expect(ed!.videoFormats).toEqual(["hdr"])
  })

  it("saved mapping wins over land defaults on reload", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED))
    const mapping: Mapping = {
      tmdbId: 9001,
      mediaType: "movie",
      title: "Fresh Land",
      posterPath: "/saved-9001.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: new Date().toISOString(),
      badgeStyle: "pill",
      rankingBadgeStyle: "corner",
      posterShape: "landscape",
      topBadgeScale: 100,
      landscape: { topBadgeScale: 150, topBadgeOffsetX: 5 },
    }
    mappingsPayload = [mapping]
    await renderRoot()
    await openFresh9001()
    // Per-title stored styles win (never clobbered by land defaults)...
    expect(ed!.badgeStyle).toBe("pill")
    expect(ed!.rankingBadgeStyle).toBe("corner")
    // ...and the saved landscape numerics win over land defaults.
    expect(ed!.topBadgeScale).toBe(150)
    expect(ed!.topBadgeOffsetX).toBe(5)
  })
})
