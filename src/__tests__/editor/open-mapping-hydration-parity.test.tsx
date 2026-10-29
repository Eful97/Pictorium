/**
 * Title open vs. mappings-list hydration — WYSIWYG / saved-poster parity.
 *
 * Reported regression: right after page load the mappings list is still in
 * flight, so opening a SAVED title seeds the editor live state from the
 * defaults (the open reads an empty list). The list arrives a moment later but
 * nothing re-seeds the draft: the preview keeps rendering the default quality
 * badge geometry and the default per-item corrections while "Test Stremio URL"
 * (server chain over the saved mapping) renders the saved look — and a Save
 * from that draft would persist the defaults over the mapping.
 *
 * Contract asserted here (REAL provider, REAL open flow, deferred list):
 * - the open waits for the one-shot list hydration, so the FIRST draft is the
 *   mapping truth (no default quality geometry, no divergent `bit=`);
 * - the preview URL carries exactly the shape-effective mapping values;
 * - rapid title switches still settle on the last title with its own truth
 *   (the superseded open never inits over it, no cross-title leak).
 */
import { useEffect } from "react"
import { render, act, waitFor, cleanup } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { SearchResult, TMDBImage } from "@/lib/types"
import EditView from "@/components/EditView"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import type { Mapping } from "@/lib/types"

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
/** Committed global defaults, distinct from every saved per-title value. */
const BIT_FLAT = "rating:imdb=100,1,10"
const BIT_TITLE = "quality:tier=80,-6,12"
const DEFAULT_QUALITY = { scale: 180, x: 3, y: -4 } as const

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

/**
 * `/api/mappings` is QUEUED on purpose: the whole point of this file is to
 * control when the list hydration lands relative to a title open.
 */
function queueKey(url: string): string | null {
  if (url.includes("/api/mappings") && !url.includes("/api/mappings/")) return "mappings"
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  m = url.match(/\/api\/trending\/rank\?[^ ]*[?&]id=(\d+)/)
  if (m) return `rank:${m[1]}`
  m = url.match(/\/api\/awards\/\w+\/(\d+)/)
  if (m) return `awards:${m[1]}`
  if (url.includes("/api/mdblist?imdb=")) return "mdblist"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      const u = String(url)
      const method = (init?.method ?? "GET").toUpperCase()
      if (u.includes("/api/mappings") && method !== "GET") return okJson({})
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
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

function pendingCount(key: string): number {
  return queues.get(key)?.length ?? 0
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

/** Microtask drain INSIDE an act scope (queued mock responses settle here). */
async function drain(rounds = 12) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

function imagesFixture(tag: string) {
  return {
    posters: [img(`/clean-${tag}.jpg`, null)],
    logos: [img(`/logo-${tag}.png`, "it")],
    backdrops: [img(`/bd-${tag}.jpg`, null)],
  }
}

function detailsFixture(title: string) {
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
    title,
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
  }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: null }

function savedMapping(item: SearchResult, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tmdbId: item.id,
    mediaType: item.media_type,
    title: item.title,
    posterPath: `/clean-${item.id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: new Date().toISOString(),
    ...extra,
  }
}

/** A saved title: quality geometry and per-item corrections differ from the defaults. */
const SAVED_A = savedMapping(ITEM_A, {
  qualityBadgeScale: 125,
  qualityBadgeOffsetX: 7,
  qualityBadgeOffsetY: -5,
  badgeItemTransforms: BIT_TITLE,
})

async function renderRoot() {
  ctx = null
  ed = null
  render(
    <ThemeProvider>
      <PictoriumRoot>
        <Probe />
        <EditView />
      </PictoriumRoot>
    </ThemeProvider>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await waitFor(() => expect(ed!.defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await flush()
}

/** Distinct-from-factory committed defaults: the wrong branch is visible. */
async function seedDefaults() {
  await act(async () => {
    ed!.setDefaultQualityBadgeScale(DEFAULT_QUALITY.scale)
    ed!.setDefaultQualityBadgeOffsetX(DEFAULT_QUALITY.x)
    ed!.setDefaultQualityBadgeOffsetY(DEFAULT_QUALITY.y)
    ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
  })
  await flush(2)
}

/** `param` in the last preview URL the client asked the server to render. */
function previewParam(name: string): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(name)
}

beforeEach(() => {
  queues.clear()
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("opening a saved title while the mappings list is still hydrating", () => {
  it("seeds the draft from the saved mapping, not from the defaults (preview = Stremio)", async () => {
    await renderRoot()
    await seedDefaults()
    // The list is still in flight: this is the reported race window.
    expect(pendingCount("mappings")).toBeGreaterThan(0)

    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
      // Hydration lands while the open is pending: A is a SAVED title.
      resolveAll("mappings", { mappings: [SAVED_A] })
      await drain()
    })
    await flush()

    await act(async () => {
      resolveAll("details:101", detailsFixture("Alpha"))
      resolveAll("images:101", imagesFixture("101"))
      await drain()
    })
    await flush()
    expect(ctx!.loadingImages).toBe(false)

    // Live state = mapping truth (the unmapped branch would install the
    // defaults seeded above: 180 / 3 / -4 / BIT_FLAT).
    expect(ed!.qualityBadgeScale).toBe(125)
    expect(ed!.qualityBadgeOffsetX).toBe(7)
    expect(ed!.qualityBadgeOffsetY).toBe(-5)
    expect(ed!.badgeItemTransforms).toBe(BIT_TITLE)

    // The preview URL asks the server for exactly those values, i.e. the same
    // pixels "Test Stremio URL" resolves from the saved mapping.
    await waitFor(() => expect(previewParam("qscale")).toBe("125"), { timeout: 3000 })
    expect(previewParam("qox")).toBe("7")
    expect(previewParam("qoy")).toBe("-5")
    expect(previewParam("bit")).toBe(BIT_TITLE)
  })

  it("a cleared landscape title profile uses the same nonempty defaults as Stremio", async () => {
    await renderRoot()
    await seedDefaults()
    // Flat edits preserve the independent landscape defaults. Configure the
    // landscape layer explicitly so both client and server fixtures match.
    await act(async () => { ed!.setLandscape({ badgeItemTransforms: BIT_FLAT }) })
    await flush()
    const mapping = savedMapping(ITEM_A, {
      posterShape: "landscape",
      badgeItemTransforms: BIT_TITLE,
      landscape: { badgeItemTransforms: null },
    }) as unknown as Mapping
    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
      resolveAll("mappings", { mappings: [mapping] })
      await drain()
    })
    await flush()
    await act(async () => {
      resolveAll("details:101", detailsFixture("Alpha"))
      resolveAll("images:101", imagesFixture("101"))
      await drain()
    })
    await flush()
    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await waitFor(() => expect(previewParam("bit")).toBe(BIT_FLAT))
    const server = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("shape=landscape"),
      mapping,
      configOverride: null,
      sd: { badgeItemTransforms: BIT_FLAT, landscape: { badgeItemTransforms: BIT_FLAT } },
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(server.badgeItemTransforms).toEqual({
      "rating:imdb": { scale: 100, offsetX: 1, offsetY: 10 },
    })
  })

  it("does not expose an editable title draft before mappings hydrate", async () => {
    await renderRoot()
    await seedDefaults()

    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    await flush()
    expect(ctx!.selected).toBeNull()
    expect(ctx!.previewId).toBeNull()
    expect(pendingCount("details:101")).toBe(0)

    await act(async () => {
      resolveAll("mappings", { mappings: [SAVED_A] })
      await drain()
    })
    await flush()
    expect(ctx!.selected?.id).toBe(ITEM_A.id)
    expect(ed!.qualityBadgeScale).toBe(125)
    // Edits made after initialization survive the remaining image load.
    await act(async () => { ed!.setQualityBadgeScale(140) })
    await act(async () => {
      resolveAll("details:101", detailsFixture("Alpha"))
      resolveAll("images:101", imagesFixture("101"))
      await drain()
    })
    await flush()
    expect(ed!.qualityBadgeScale).toBe(140)
  })

  it("uses defaults committed while a title is waiting for mappings", async () => {
    await renderRoot()
    await seedDefaults()
    await act(async () => { ctx!.navigateToPoster(ITEM_B) })
    await act(async () => { ed!.setDefaultQualityBadgeScale(190) })
    await act(async () => {
      resolveAll("mappings", { mappings: [] })
      await drain()
    })
    await flush()
    expect(ed!.qualityBadgeScale).toBe(190)
    await act(async () => {
      resolveAll("details:202", detailsFixture("Beta"))
      resolveAll("images:202", imagesFixture("202"))
      await drain()
    })
    await flush()
    expect(ed!.qualityBadgeScale).toBe(190)
  })

  it("unmounting during hydration does not start a detached title load", async () => {
    await renderRoot()
    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    cleanup()
    await act(async () => {
      resolveAll("mappings", { mappings: [SAVED_A] })
      await drain()
    })
    expect(pendingCount("details:101")).toBe(0)
    expect(pendingCount("images:101")).toBe(0)
  })

  it("leaving during hydration cancels the pending title open", async () => {
    await renderRoot()
    await act(async () => { ctx!.navigateToPoster(ITEM_A) })
    await act(async () => { ctx!.goHome() })
    await act(async () => {
      resolveAll("mappings", { mappings: [SAVED_A] })
      await drain()
    })
    await flush()
    expect(ctx!.selected).toBeNull()
    expect(pendingCount("details:101")).toBe(0)
    expect(pendingCount("images:101")).toBe(0)
  })

  it("rapid A(mapped) → B(unmapped) switch while hydrating ends on B, never on A's values", async () => {
    await renderRoot()
    await seedDefaults()
    expect(pendingCount("mappings")).toBeGreaterThan(0)

    await act(async () => {
      ctx!.navigateToPoster(ITEM_A)
      ctx!.navigateToPoster(ITEM_B)
      resolveAll("mappings", { mappings: [SAVED_A] })
      await drain()
    })
    await flush()

    // The superseded open (A) never started its own load: the fetchId guard
    // drops it while hydration is pending, so it cannot init over B.
    expect(pendingCount("details:101")).toBe(0)
    expect(pendingCount("images:101")).toBe(0)

    await act(async () => {
      // Only the last title's data settles the UI: A's open is superseded.
      if (pendingCount("images:101") > 0) resolveAll("images:101", imagesFixture("101"))
      if (pendingCount("details:101") > 0) resolveAll("details:101", detailsFixture("Alpha"))
      resolveAll("details:202", detailsFixture("Beta"))
      resolveAll("images:202", imagesFixture("202"))
      await drain()
    })
    await flush()

    expect(ctx!.selected?.id).toBe(ITEM_B.id)
    // B is unmapped: the shape-effective DEFAULTS, never A's saved geometry.
    expect(ed!.qualityBadgeScale).toBe(DEFAULT_QUALITY.scale)
    expect(ed!.qualityBadgeOffsetX).toBe(DEFAULT_QUALITY.x)
    expect(ed!.qualityBadgeOffsetY).toBe(DEFAULT_QUALITY.y)
    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)

    await waitFor(() => expect(previewParam("qscale")).toBe(String(DEFAULT_QUALITY.scale)), { timeout: 3000 })
    expect(previewParam("qox")).toBe(String(DEFAULT_QUALITY.x))
    expect(previewParam("qoy")).toBe(String(DEFAULT_QUALITY.y))
    expect(previewParam("bit")).toBe(BIT_FLAT)
  })
})
