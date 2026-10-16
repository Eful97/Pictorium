/**
 * Correction 1/3 (real provider): open restores the saved manual accent, the
 * async auto recompute never clobbers an explicit manual, and the full
 * Reset -> switch -> save -> reopen flow holds on the production wiring.
 *
 * Drives the REAL provider (PictoriumRoot + useP) with the REAL EditView
 * mounted: real openPosterBrowser, real Reset/switch/Save clicks, real
 * ctx.saveConfig (shared-stash bridge, same as the exclusion autosaves) and
 * real ctx.autoSaveExcludedPosters. Deferred network fixtures, no sleeps.
 */
import { useEffect } from "react"
import { render, act, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import userEvent from "@testing-library/user-event"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import EditView from "@/components/EditView"
import type { SearchResult, TMDBImage } from "@/lib/types"

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

const calls: { url: string; method: string; body: unknown }[] = []
const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: Record<string, unknown>[] = []

const MANUAL = "#a1b2c3"

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
      if (method === "POST" && u.includes("/api/mappings")) {
        const body = init?.body ? JSON.parse(init.body) : {}
        calls.push({ url: u, method, body })
        // Fresh array (like a real server round trip): mutating the shared
        // array in place would keep the reference identical and React would
        // bail out of setMappings -> the store map would go stale.
        const idx = mappingsPayload.findIndex(
          (m) => m.tmdbId === body.tmdbId && String(m.mediaType) === String(body.mediaType),
        )
        mappingsPayload = idx >= 0
          ? mappingsPayload.map((m, i) => (i === idx ? { ...m, ...body } : m))
          : [...mappingsPayload, body]
        return okJson({})
      }
      if (u.includes("/api/mappings")) return okJson({ mappings: [...mappingsPayload] })
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

function mappingPosts() {
  return calls.filter((c) => c.method === "POST" && c.url.includes("/api/mappings"))
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

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_A = {
  posters: [img("/clean-a.jpg", null), img("/it-a.jpg", "it")],
  logos: [img("/logo-a.png", "it")],
  backdrops: [img("/bd-a.jpg", null)],
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
    title: "Alpha",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
  }
}

function savedManualMapping(): Record<string, unknown> {
  return {
    tmdbId: 101,
    mediaType: "movie",
    title: "Alpha",
    posterPath: "/clean-a.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: new Date().toISOString(),
    accentColor: MANUAL,
  }
}

async function renderRoot() {
  ctx = null
  ed = null
  const root = render(
    <ThemeProvider>
      <PictoriumRoot>
        <Probe />
        <EditView />
      </PictoriumRoot>
    </ThemeProvider>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await flush()
  return root
}

async function openItemA() {
  await act(async () => {
    await ctx!.setTmdbKey("test-key")
  })
  const opened = act(async () => {
    await ctx!.navigateToPoster(ITEM_A)
  })
  resolveAll("details:101", detailsFixture())
  resolveAll("images:101", IMAGES_A)
  await opened
  await flush()
}

describe("correction 1/3: real-provider open / recompute / save / reopen", () => {
  beforeEach(() => {
    calls.length = 0
    queues.clear()
    mappingsPayload = [savedManualMapping()]
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

  it("opening a saved manual restores the live manual (correct visual + provenance)", async () => {
    await renderRoot()
    await openItemA()
    // The open sync restores the saved manual into live state (not auto):
    // the preview shows the manual look and the Reset control can clear it.
    expect(ctx!.accentColor).toBe(MANUAL)
  })

  it("async auto recompute fills the auto channel but never clobbers the restored manual", async () => {
    // Fake image pipeline: loading completes with weaveable pixels.
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 4 * 4; i++) {
      pixels[i * 4] = 200
      pixels[i * 4 + 1] = 50
      pixels[i * 4 + 2] = 50
      pixels[i * 4 + 3] = 255
    }
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      crossOrigin = ""
      naturalWidth = 4
      naturalHeight = 4
      set src(_: string) {
        queueMicrotask(() => this.onload?.())
      }
      get src(): string {
        return ""
      }
    }
    vi.stubGlobal("Image", FakeImage)
    const fakeCtx = {
      imageSmoothingEnabled: false,
      drawImage() {},
      getImageData: () => ({ data: pixels }),
    }
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    const prevGetContext = proto.getContext
    proto.getContext = () => fakeCtx

    try {
      await renderRoot()
      await openItemA()
      expect(ctx!.accentColor).toBe(MANUAL)
      // The recompute ran (auto channel filled from the same bytes as the
      // server render) while the explicit manual survived untouched.
      await waitFor(() => expect(ctx!.autoAccentColor).toMatch(/^#[0-9a-f]{6}$/))
      expect(ctx!.accentColor).toBe(MANUAL)
      expect(ctx!.autoAccentColor).not.toBe(MANUAL)
    } finally {
      proto.getContext = prevGetContext
    }
  })

  it("unmapped open starts automatic and follows the recompute (no stale manual)", async () => {
    mappingsPayload = []
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 4 * 4; i++) {
      pixels[i * 4] = 200
      pixels[i * 4 + 1] = 50
      pixels[i * 4 + 2] = 50
      pixels[i * 4 + 3] = 255
    }
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      crossOrigin = ""
      naturalWidth = 4
      naturalHeight = 4
      set src(_: string) {
        queueMicrotask(() => this.onload?.())
      }
      get src(): string {
        return ""
      }
    }
    vi.stubGlobal("Image", FakeImage)
    const fakeCtx = {
      imageSmoothingEnabled: false,
      drawImage() {},
      getImageData: () => ({ data: pixels }),
    }
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    const prevGetContext = proto.getContext
    proto.getContext = () => fakeCtx
    try {
      await renderRoot()
      await openItemA()
      await waitFor(() => expect(ctx!.autoAccentColor).toMatch(/^#[0-9a-f]{6}$/))
      // No saved manual: live follows the sampled auto (nothing to preserve).
      expect(ctx!.accentColor).toBe(ctx!.autoAccentColor)
    } finally {
      proto.getContext = prevGetContext
    }
  })

  it("full flow: Reset -> landscape switch -> save + autosave drop the flat, reopen holds both shapes", async () => {
    const u = userEvent.setup()
    await renderRoot()
    await openItemA()
    expect(ctx!.accentColor).toBe(MANUAL)

    // Explicit auto through the real Reset control.
    await u.click(screen.getByRole("tab", { name: "ui.badgeSection" }))
    await u.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(ctx!.accentColor).toBe(ctx!.autoAccentColor))

    // Real shape-switch handler (stages the portrait explicit-auto).
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(ed!.posterShape).toBe("landscape"))

    // Real provider save (shared-stash bridge, same as exclusion autosaves).
    await act(async () => {
      await ctx!.saveConfig({ silent: true })
    })
    // Literal exclusion autosave entry.
    await act(async () => {
      await ctx!.autoSaveExcludedPosters(["/x.jpg"])
    })

    const posts = mappingPosts()
    expect(posts).toHaveLength(2)
    for (const post of posts) {
      const body = post.body as Record<string, unknown>
      expect("accentColor" in body).toBe(false)
    }
    // Reopen: the saved shape is landscape (switched before saving), and its
    // live correctly shows the frozen-inherit manual — the portrait clear did
    // not leak across. Switching back to portrait restores the staged
    // explicit auto (the clear survived the round trip).
    await openItemA()
    expect(ed!.posterShape).toBe("landscape")
    expect(ctx!.accentColor).toBe(MANUAL)
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(ed!.posterShape).toBe("poster"))
    expect(ctx!.accentColor).toBe(ctx!.autoAccentColor)

    // The saved payload parses and selects per shape on the shared boundary.
    const parsed = mappingSchema.safeParse(posts[0].body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.accentColor).toBeUndefined()
  })
})
