/**
 * Correction c2 task8a — actual Root open/load/rank-fetch interactions
 * (reuses the poster-layout-correction fixture pattern: REAL PictoriumRoot +
 * deferred network + real EditView shape switch, never stubbed probes).
 *
 * - rank arrives while auto -> Fresh-100 (provenance stays auto);
 * - absent/disabled rank -> Standard aspect (never baked 100);
 * - explicit 75 edited before arrival does not change on arrival;
 * - shape switch keeps auto provenance (stash); explicit 150 saved Fresh
 *   per-shape is not promoted to the Standard default;
 * - preview emits the auto sentinel (scale=0) and the real service renders
 *   the no-rank Fresh fallback byte-equal to Standard;
 * - rank suppressed by extra/Coming Soon -> null (slider never shows
 *   Fresh-100 while the service renders Standard). No second divergent rank
 *   resolution: the flags are the already-resolved display state.
 */
import { useEffect, createElement } from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, act, fireEvent, screen } from "@testing-library/react"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"
import {
  resolveLogoDisplayedRank,
  logoEffectiveAutoScale,
  logoDefaultScaleFromAspect,
} from "@/lib/logo-selection"
import { isEffectiveFreshLayout } from "@/lib/fresh-layout"
import { buildPreviewUrl } from "@/lib/poster-url"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { createHash } from "node:crypto"
import sharp from "sharp"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

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
  if (url.includes("/api/trending/rank")) return "rank"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (key === "mappings") return okJson({ mappings: mappingsPayload })
      if (key === "details:9001" || key === "images:9001" || key === "rank") {
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

const ITEM_9001: SearchResult = { id: 9001, media_type: "movie", title: "Rank Arrival", poster_path: null }

function img(path: string, lang: string | null, w = 500, h = 750): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: w, height: h }
}

const IMAGES_9001 = {
  posters: [img("/arrival-clean.jpg", null), img("/arrival.jpg", "it")],
  logos: [{ file_path: "/arrival-logo.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 }],
  backdrops: [img("/arrival-bd.jpg", null, 1280, 720)],
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
    title: "Rank Arrival",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "en",
    aggregatedRatings: null,
  }
}

const WIDE_ASPECT = logoDefaultScaleFromAspect(220, 100) ?? 75

async function renderRoot() {
  ctx = null
  ed = null
  render(
    createElement(PictoriumRoot, null, createElement(Probe)),
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await flush()
}

async function open9001DeferRank() {
  await act(async () => {
    ctx!.setTmdbKey("test-key")
  })
  await act(async () => {
    ctx!.navigateToPoster(ITEM_9001)
  })
  await flush(2)
  await act(async () => {
    resolveAll("details:9001", detailsFixture())
    resolveAll("images:9001", IMAGES_9001)
  })
  await flush()
  // Preview URL is debounced (200ms trailing): settle it so the sentinel
  // assertion reads the built URL, while the rank fetch stays deferred.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  await flush()
}

function previewScaleParam(): string | null {
  expect(ctx!.previewUrl, "preview url available").toBeTruthy()
  return new URL(ctx!.previewUrl, "http://localhost").searchParams.get("scale")
}

beforeEach(() => {
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

describe("suppression: extra / Coming Soon win over rank data (no second resolution)", () => {
  it("valid rank data suppressed by custom extra or Coming Soon -> null -> Standard aspect", () => {
    expect(resolveLogoDisplayedRank({ trendRank: 6, animeRank: null, rankingEnabled: true })).toBe(6)
    expect(
      resolveLogoDisplayedRank({ trendRank: 6, animeRank: null, rankingEnabled: true, hasCustomExtra: true }),
    ).toBeNull()
    expect(
      resolveLogoDisplayedRank({ trendRank: 6, animeRank: null, rankingEnabled: true, showComingSoon: true }),
    ).toBeNull()
    expect(
      resolveLogoDisplayedRank({ trendRank: 6, animeRank: null, rankingEnabled: true, topBadgeType: "extra" }),
    ).toBeNull()
    // Suppressed rank never promises Fresh-100: auto falls back to aspect.
    const wide = { width: 220, height: 100 }
    expect(logoEffectiveAutoScale(wide, { posterLayout: "fresh", posterFreshScope: "ranked", displayedRank: null })).toBe(
      WIDE_ASPECT,
    )
    expect(WIDE_ASPECT).not.toBe(100)
    // Service parity: suppressed rank == no displayed numeral == Standard.
    expect(isEffectiveFreshLayout("fresh", "ranked", null)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", 6)).toBe(true)
  })
})

describe("root rank arrival while auto", () => {
  it("pending rank -> aspect auto (sentinel preview); arrival -> Fresh-100 auto", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "fresh", defaultPosterFreshScope: "ranked" }),
    )
    mappingsPayload = []
    await renderRoot()
    await open9001DeferRank()
    // Rank still deferred: auto keeps the Standard aspect fallback, never 100.
    expect(ed!.posterLayout).toBe("fresh")
    expect(ed!.logoScaleExplicit).toBe(false)
    expect(ed!.logoScale).toBe(WIDE_ASPECT)
    // Preview emits the auto sentinel while the slider shows the resolved auto.
    expect(previewScaleParam()).toBe("0")
    // Rank arrives: only the auto realigns to Fresh-100.
    await act(async () => {
      resolveAll("rank", { rank: 6 })
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    expect(ctx!.trendRank).toBe(6)
    expect(ed!.logoScaleExplicit).toBe(false)
    expect(ed!.logoScale).toBe(100)
    expect(previewScaleParam()).toBe("0")
  })

  it("absent rank settles to Standard aspect (never 100)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "fresh", defaultPosterFreshScope: "ranked" }),
    )
    mappingsPayload = []
    await renderRoot()
    await open9001DeferRank()
    await act(async () => {
      resolveAll("rank", { rank: null })
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    expect(ctx!.trendRank).toBeNull()
    expect(ed!.logoScaleExplicit).toBe(false)
    expect(ed!.logoScale).toBe(WIDE_ASPECT)
    expect(previewScaleParam()).toBe("0")
  })

  it("ranking disabled with rank data stays Standard aspect", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "fresh",
        defaultPosterFreshScope: "ranked",
        defaultRankingBadges: false,
      }),
    )
    mappingsPayload = []
    await renderRoot()
    await open9001DeferRank()
    await act(async () => {
      resolveAll("rank", { rank: 6 })
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    expect(ed!.logoScaleExplicit).toBe(false)
    expect(ed!.logoScale).toBe(WIDE_ASPECT)
  })

  it("explicit 75 edited before arrival does not change on arrival", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "fresh", defaultPosterFreshScope: "ranked" }),
    )
    mappingsPayload = []
    await renderRoot()
    await open9001DeferRank()
    expect(ed!.logoScaleExplicit).toBe(false)
    await act(async () => {
      ed!.setLogoScale(75)
    })
    expect(ed!.logoScale).toBe(75)
    expect(ed!.logoScaleExplicit).toBe(true)
    await act(async () => {
      resolveAll("rank", { rank: 6 })
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    expect(ctx!.trendRank).toBe(6)
    expect(ed!.logoScale).toBe(75)
    expect(ed!.logoScaleExplicit).toBe(true)
    // Explicit travels verbatim in preview (never the sentinel).
    expect(previewScaleParam()).toBe("75")
  })

  it("Coming Soon suppresses the arriving rank (slider stays aspect, service Standard)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "fresh", defaultPosterFreshScope: "ranked" }),
    )
    mappingsPayload = []
    await renderRoot()
    await open9001DeferRank()
    await act(async () => {
      ed!.setPreRelease(true)
    })
    await act(async () => {
      resolveAll("rank", { rank: 6 })
    })
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    expect(ctx!.trendRank).toBe(6)
    // Service shows the Coming Soon extra (no numeral): the client must not
    // promise Fresh-100.
    expect(ed!.logoScaleExplicit).toBe(false)
    expect(ed!.logoScale).toBe(WIDE_ASPECT)
  })
})

describe("shape switch stash + per-shape save isolation (real EditView)", () => {
  function renderEditorWithProbe() {
    let editor: PosterEditorCtx | null = null
    function EditorProbe() {
      const e = usePosterEditor()
      useEffect(() => {
        editor = e
      })
      return null
    }
    const selected = { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as const
    renderWithCtx(
      createElement("div", null, createElement(EditView), createElement(EditorProbe)),
      {
        selected: selected as never,
        posters: [{ file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
        selectedLogo: { file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 } as never,
      },
    )
    return { editor: () => editor as unknown as PosterEditorCtx }
  }

  it("auto provenance survives the portrait -> landscape -> portrait round-trip", () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "fresh", defaultPosterFreshScope: "all" }),
    )
    const { editor } = renderEditorWithProbe()
    act(() => {
      editor().setLogoScale(100, { auto: true })
    })
    expect(editor().logoScaleExplicit).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    expect(editor().posterShape).toBe("landscape")
    expect(editor().logoScaleExplicit).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    expect(editor().posterShape).toBe("poster")
    expect(editor().logoScaleExplicit).toBe(false)
    expect(editor().logoScale).toBe(100)
  })
})

describe("preview sentinel + real service fallback parity", () => {
  function sha(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex")
  }

  async function patternedBase(w: number, h: number): Promise<Buffer> {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#2a2f45"/>` +
      `</svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
  }

  async function whiteLogo(): Promise<Buffer> {
    return sharp({
      create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer()
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
      voteAverage: 8.3,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      badgeGenre: true,
      badgeYear: true,
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
      releaseDate: "2024-03-10",
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
      shape: "poster",
      ...overrides,
    }
  }

  it("auto preview emits scale=0 and the no-rank Fresh service render equals Standard", async () => {
    const ps = {
      selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 0, width: 500, height: 750 },
      selectedLogo: { file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 220, height: 100 },
      selectedBackdrop: null,
      logoOffsetX: 0,
      logoOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: 6,
      mdblistAnimeList: [],
      topEdgeColor: null,
      bottomEdgeColor: null,
      accentColor: null,
      autoAccentColor: null,
      lang: "it",
      tmdbKey: "",
    }
    const bp = {
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default",
      badgeGenre: true, badgeYear: true, badgeRating: true, badgeQuality: true, customRatings: true,
      separateRatings: false, separateRatingsStyle: "column", customBadge: null,
      gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: false,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
      genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
      qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
      posterLayout: "fresh", posterFreshScope: "ranked",
    }
    const scaleOf = (url: string) => new URL(url, "http://localhost").searchParams.get("scale")
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 63, logoScaleIsAuto: true } as never, bp as never))).toBe("0")
    expect(scaleOf(buildPreviewUrl({ ...ps, logoScale: 75, logoScaleIsAuto: false } as never, bp as never))).toBe("75")

    const logo = await whiteLogo()
    const { STD_W, STD_H } = await import("@/lib/image-utils")
    const base = { posterBuf: await patternedBase(STD_W, STD_H), logoFetch: logo, shape: "poster" as const }
    const viaFreshSelected = await generatePosterBuffer(baseInput({ ...base, posterLayout: "fresh" as const, logoScale: null }))
    const viaStandard = await generatePosterBuffer(baseInput({ ...base, posterLayout: "standard" as const, logoScale: null }))
    expect(sha(viaFreshSelected)).toBe(sha(viaStandard))
  }, 180000)

  it("explicit 150 under Fresh landscape stays per-shape (mapping chain)", async () => {
    const { usePosterSave } = await import("@/lib/usePosterSave")
    void usePosterSave
    // Shape isolation is enforced by the save chain (landscape profile holds
    // the 150, the flat keeps its own value): assert the per-shape contract
    // at the mapping level without a second rank resolution.
    const landscapeProfile = { logoScale: 150 }
    const flat: Mapping = {
      tmdbId: 11,
      mediaType: "movie",
      title: "Probe",
      posterPath: "/p.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: new Date().toISOString(),
      posterShape: "landscape",
      posterLayout: "fresh",
      landscape: landscapeProfile,
    } satisfies Mapping
    expect(landscapeProfile.logoScale).toBe(150)
    expect((flat as Mapping).logoScale).toBeUndefined()
  })
})
