/**
 * Automatic wordmark in the editor preview (single renderer parity).
 *
 * A title without any TMDB logo now gets its wordmark from the title, so the
 * editor must stage the SAME textless base the server composes for Stremio
 * (clean poster when available, portrait backdrop-crop base otherwise) and
 * carry only the `lauto=1` flag — never the derived text. The save must not
 * persist the automatic wordmark as `logoText`: it regenerates deterministically
 * at every render.
 */
import { useEffect } from "react"
import { render, act, waitFor, cleanup } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { Mapping, SearchResult, TMDBImage } from "@/lib/types"

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null
let posts: { url: string; body: Record<string, unknown> }[] = []

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  useEffect(() => {
    ctx = v
    ed = e
  })
  return null
}

function okJson(data: unknown) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data), json: async () => data }
}

function installFetchMock(mappings: Mapping[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url)
    const method = (init?.method ?? "GET").toUpperCase()
    if (u.includes("/api/mappings") && method !== "GET") {
      posts.push({ url: u, body: init?.body ? JSON.parse(init.body) : {} })
      return okJson({ ok: true })
    }
    if (u.includes("/api/mappings")) return okJson({ mappings })
    if (/\/api\/tmdb\/\d+\/details/.test(u)) return okJson(detailsFixture())
    if (/\/api\/tmdb\/\d+\/images/.test(u)) return okJson(images)
    return okJson({})
  }))
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

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const ITEM: SearchResult = { id: 303, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }

let images: { posters: TMDBImage[]; logos: TMDBImage[]; backdrops: TMDBImage[] }

function cleanOnly() {
  images = { posters: [img("/clean.jpg", null)], logos: [], backdrops: [] }
}

function noCleanWithBackdrops() {
  images = {
    posters: [img("/lang-it.jpg", "it")],
    logos: [],
    backdrops: [img("/bd-clean.jpg", null)],
  }
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) await act(async () => {})
}

function previewParam(name: string): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(name)
}

async function openTitle() {
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await waitFor(() => expect(ed!.defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await act(async () => { ctx!.navigateToPoster(ITEM) })
  await flush()
  await waitFor(() => expect(ctx!.loadingImages).toBe(false), { timeout: 3000 })
  await flush()
  await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })
}

function savedCleanMapping(): Mapping {
  return {
    tmdbId: ITEM.id,
    mediaType: "movie",
    title: "Alpha",
    posterPath: "/clean.jpg",
    logoPath: null,
    originalPosterPath: "/clean.jpg",
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

beforeEach(() => {
  ctx = null
  ed = null
  posts = []
  cleanOnly()
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("automatic wordmark preview/save", () => {
  it("no TMDB logo + clean poster: preview starts from the clean base with `lauto`, no text", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()

    await waitFor(() => expect(previewParam("poster")).toBe("/clean.jpg"), { timeout: 3000 })
    expect(previewParam("lauto")).toBe("1")
    // The derived text never travels: the server derives it (same function),
    // and the save cannot inherit it as a typed wordmark.
    expect(previewParam("ltext")).toBeNull()
    expect(previewParam("lfont")).toBeNull()
    expect(ctx!.selectedLogo).toBeNull()
  })

  it("the save does not freeze the automatic wordmark as logoText", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()
    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.logoText ?? null).toBeNull()
    expect(posts[0].body.logoPath ?? null).toBeNull()
    // Clean base saved as-is: the automatic wordmark regenerates server-side.
    expect(posts[0].body.portraitBackdropPath ?? null).toBeNull()
  })

  it("no clean poster + backdrops: the server base is textless, so no `poster=` is emitted", async () => {
    noCleanWithBackdrops()
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()

    await waitFor(() => expect(previewParam("poster")).toBeNull(), { timeout: 3000 })
    // Base auto already implies the automatic wordmark on the server.
    expect(previewParam("lauto")).toBeNull()
    expect(ctx!.selectedLogo).toBeNull()

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean.jpg")
    // Without this the frozen crop would be an image without a title on
    // Stremio; the automatic wordmark fills that role (nothing persisted).
    expect(posts[0].body.logoPath ?? null).toBeNull()
    expect(posts[0].body.logoText ?? null).toBeNull()
  })

  it("reopening a clean saved mapping keeps the preview on the clean base with `lauto`", async () => {
    installFetchMock([savedCleanMapping()])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()

    await waitFor(() => expect(previewParam("poster")).toBe("/clean.jpg"), { timeout: 3000 })
    await waitFor(() => expect(previewParam("lauto")).toBe("1"), { timeout: 3000 })
    expect(previewParam("ltext")).toBeNull()
  })

  it("a typed wordmark wins: no auto flag, the text travels", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()
    await act(async () => { ed!.setLogoText("Manual Title") })
    await waitFor(() => expect(previewParam("ltext")).toBe("Manual Title"), { timeout: 3000 })
    expect(previewParam("lauto")).toBeNull()
  })

  it("logoDisabled always wins (explicit no-logo choice)", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()
    await waitFor(() => expect(previewParam("lauto")).toBe("1"), { timeout: 3000 })
    await act(async () => { ed!.setLogoDisabled(true) })
    await waitFor(() => expect(previewParam("lauto")).toBeNull(), { timeout: 3000 })
  })
})
