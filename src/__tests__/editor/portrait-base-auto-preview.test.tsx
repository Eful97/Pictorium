/**
 * Portrait base decisa dal server (titolo senza poster clean) — parità
 * preview/Stremio e provenance della scelta.
 *
 * Contratto:
 * - finché l'utente non sceglie un tile, la preview NON emette `poster=` (né
 *   gli hint derivati): la base la compone lo stesso ramo automatico del
 *   renderer unico che serve Stremio;
 * - ri-selezionare in griglia il poster in lingua (quello già scelto
 *   dall'auto) è una scelta esplicita: la preview torna a `poster=`;
 * - il save congela il backdrop della base auto (`portraitBackdropPath`, primo
 *   clean) e il logo che il server compone, così Stremio non torna al poster
 *   in lingua;
 * - un mapping che ha già la base congelata riapre in base auto (preview
 *   senza `poster=`), quindi preview e Stremio restano allineati.
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
    if (/\/api\/tmdb\/\d+\/images/.test(u)) return okJson(imagesFixture())
    return okJson({})
  }))
}

function imagesFixture() {
  return {
    // Nessun poster clean: solo poster in lingua → ramo base auto.
    posters: [img("/lang-it.jpg", "it")],
    logos: [img("/logo-it.png", "it")],
    // Il PRIMO backdrop è clean: è quello che il server usa per il crop 2:3.
    backdrops: [img("/bd-clean.jpg", null), img("/bd-fr.jpg", "fr")],
  }
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
}

beforeEach(() => {
  ctx = null
  ed = null
  posts = []
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

describe("base portrait auto (nessun poster clean)", () => {
  it("preview senza `poster=`, e il tile in lingua cliccato ripristina la scelta esplicita", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()

    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })
    // Base decisa dal server: nessun override immagine né hint derivati.
    expect(previewParam("poster")).toBeNull()
    expect(previewParam("genreName")).toBeNull()

    // Provenance: il poster in lingua ri-selezionato in griglia è una scelta
    // esplicita e torna nella preview (prima restava invisibile).
    await act(async () => { await ctx!.selectPoster(img("/lang-it.jpg", "it")) })
    await flush()
    await waitFor(() => expect(previewParam("poster")).toBe("/lang-it.jpg"), { timeout: 3000 })
  })

  it("il save congela backdrop e logo della base auto", async () => {
    installFetchMock([])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean.jpg")
    // Senza questo il crop salvato sarebbe un'immagine senza titolo.
    expect(posts[0].body.logoPath).toBe("/logo-it.png")
  })

  it("un mapping con base congelata riapre in base auto (preview = Stremio)", async () => {
    const saved: Mapping = {
      tmdbId: ITEM.id,
      mediaType: "movie",
      title: "Alpha",
      posterPath: "/lang-it.jpg",
      logoPath: "/logo-it.png",
      originalPosterPath: "/lang-it.jpg",
      language: "it",
      updatedAt: "2026-01-01T00:00:00.000Z",
      portraitBackdropPath: "/bd-clean.jpg",
    }
    installFetchMock([saved])
    render(
      <ThemeProvider>
        <PictoriumRoot><Probe /></PictoriumRoot>
      </ThemeProvider>,
    )
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })
    expect(previewParam("poster")).toBeNull()

    // Il save conserva la base congelata (provenienza auto, nessun tile nuovo).
    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean.jpg")
  })
})
