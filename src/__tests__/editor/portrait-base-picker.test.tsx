/**
 * Picker della base portrait da backdrop (titolo senza poster clean).
 *
 * Contratto:
 * - il picker compare solo quando la base 2:3 può venire da un backdrop
 *   (`portraitBasePickable`) e ci sono backdrop CLEAN da offrire; senza
 *   backdrop clean non esiste (la base storica dal poster resta intatta);
 * - i tile sono gli stessi di BackdropOptions (`PosterBtn` landscape, path
 *   TMDB) e offrono SOLO i clean non esclusi;
 * - la scelta è live in preview via `pbase` (il server croppa quel backdrop,
 *   stesso renderer) e si congela al save in `portraitBackdropPath`;
 * - una scelta non-clean non arriva mai al renderer: la provenienza storica
 *   (poster in lingua) resta invariata;
 * - il tile del poster in lingua mantiene la provenienza esistente
 *   (`poster=`, base = poster salvato).
 */
import { useEffect } from "react"
import { render, act, waitFor, cleanup, screen, within } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import EditView from "@/components/EditView"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider, PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { Mapping, SearchResult, TMDBImage } from "@/lib/types"

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 1280, height: 720 }
}

const CLEAN_1 = img("/bd-clean-1.jpg", null)
const CLEAN_2 = img("/bd-clean-2.jpg", null)
const LANG_BD = img("/bd-fr.jpg", "fr")

/* ------------------------------------------------------------------ */
/* Parte 1 — tile e guardie (EditView + context iniettato)             */
/* ------------------------------------------------------------------ */

let ctxValue: PictoriumCtx = MOCK_CTX

// Titolo in editing: senza, EditView non renderizza il pannello artwork.
const ITEM: SearchResult = { id: 404, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={ctxValue}>{children}</PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

function renderEditor(overrides?: Partial<PictoriumCtx>) {
  let editorCtx: PosterEditorCtx | null = null
  function Probe() {
    const ed = usePosterEditor()
    useEffect(() => { editorCtx = ed })
    return null
  }
  const merged = { ...MOCK_CTX, selected: ITEM, ...overrides }
  ctxValue = merged
  const view = render(<><EditView /><Probe /></>, { wrapper: Wrapper })
  return { ...view, editor: () => editorCtx as PosterEditorCtx }
}

function setBackdrops(editor: () => PosterEditorCtx, list: TMDBImage[], excluded: string[] = []) {
  act(() => {
    editor().setBackdrops(list)
    editor().setExcludedBackdrops(excluded)
  })
}

describe("picker base portrait: tile e guardie", () => {
  beforeEach(() => { localStorage.clear() })

  it("nessun backdrop → nessun picker", () => {
    const { editor } = renderEditor({ portraitBasePickable: true })
    setBackdrops(editor, [])
    expect(screen.queryByTestId("portrait-base-picker")).toBeNull()
  })

  it("solo backdrop in lingua → nessun picker (guardia: base storica)", () => {
    const { editor } = renderEditor({ portraitBasePickable: true })
    setBackdrops(editor, [LANG_BD])
    expect(screen.queryByTestId("portrait-base-picker")).toBeNull()
  })

  it("base non pickable (base = poster) → nessun picker", () => {
    const { editor } = renderEditor({ portraitBasePickable: false })
    setBackdrops(editor, [CLEAN_1, CLEAN_2])
    expect(screen.queryByTestId("portrait-base-picker")).toBeNull()
  })

  it("offre solo i backdrop clean non esclusi e marca quello attivo", () => {
    const { editor } = renderEditor({ portraitBasePickable: true, portraitBaseBackdropPath: CLEAN_2.file_path })
    setBackdrops(editor, [CLEAN_1, CLEAN_2, LANG_BD], ["/bd-clean-1.jpg"])
    const picker = screen.getByTestId("portrait-base-picker")
    const tiles = within(picker).getAllByRole("button")
    // Un tile + il badge "selected" del tile attivo.
    const thumbnails = tiles.filter((b) => b.className.includes("poster-tile"))
    expect(thumbnails).toHaveLength(1)
    expect(thumbnails[0].querySelector("img")?.getAttribute("src")).toContain("/bd-clean-2.jpg")
    expect(picker.textContent).toContain("Sfondi")
  })

  it("il click sul tile passa dalla selezione condivisa del context", () => {
    const selectPortraitBaseBackdrop = vi.fn()
    const { editor } = renderEditor({ portraitBasePickable: true, selectPortraitBaseBackdrop })
    setBackdrops(editor, [CLEAN_1, CLEAN_2])
    const picker = screen.getByTestId("portrait-base-picker")
    const tiles = within(picker).getAllByRole("button").filter((b) => b.className.includes("poster-tile"))
    expect(tiles).toHaveLength(2)
    act(() => { tiles[1].click() })
    expect(selectPortraitBaseBackdrop).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/bd-clean-2.jpg" }))
  })
})

/* ------------------------------------------------------------------ */
/* Parte 2 — preview WYSIWYG + persistenza (provider reale)            */
/* ------------------------------------------------------------------ */

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null
let posts: { url: string; body: Record<string, unknown> }[] = []

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  useEffect(() => { ctx = v; ed = e })
  return null
}

function okJson(data: unknown) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data), json: async () => data }
}

function imagesFixture() {
  return {
    // Nessun poster clean: la base verticale viene da un backdrop.
    posters: [img2("/lang-it.jpg", "it")],
    logos: [{ file_path: "/logo-it.png", iso_639_1: "it", vote_average: 0, width: 800, height: 300 }],
    // Due backdrop clean: il picker può cambiare la base; il terzo è in lingua
    // (non offribile, non deve mai arrivare al renderer).
    backdrops: [
      { ...CLEAN_1, width: 1280, height: 720 },
      { ...CLEAN_2, width: 1280, height: 720 },
      { ...LANG_BD, width: 1280, height: 720 },
    ],
  }
}

function img2(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 1000, height: 1500 }
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

function installFetchMock(mappings: Mapping[] = []) {
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

describe("picker base portrait: preview e save", () => {
  beforeEach(() => {
    ctx = null
    ed = null
    posts = []
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      removeAll: () => {},
      clear: () => {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("scelta live → `pbase` in preview e base congelata al save", async () => {
    installFetchMock()
    render(<ThemeProvider><PictoriumRoot><Probe /></PictoriumRoot></ThemeProvider>)
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })
    // Base automatica: nessun override (il server usa il primo clean).
    expect(previewParam("poster")).toBeNull()
    expect(previewParam("pbase")).toBeNull()
    expect(ctx!.portraitBasePickable).toBe(true)

    await act(async () => { ctx!.selectPortraitBaseBackdrop(CLEAN_2) })
    await flush()
    await waitFor(() => expect(previewParam("pbase")).toBe("/bd-clean-2.jpg"), { timeout: 3000 })
    expect(previewParam("poster")).toBeNull()

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean-2.jpg")
  })

  it("ricliccare il backdrop scelto torna alla base automatica", async () => {
    installFetchMock()
    render(<ThemeProvider><PictoriumRoot><Probe /></PictoriumRoot></ThemeProvider>)
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })

    await act(async () => { ctx!.selectPortraitBaseBackdrop(CLEAN_2) })
    await flush()
    await waitFor(() => expect(previewParam("pbase")).toBe("/bd-clean-2.jpg"), { timeout: 3000 })

    await act(async () => { ctx!.selectPortraitBaseBackdrop(CLEAN_2) })
    await flush()
    await waitFor(() => expect(previewParam("pbase")).toBeNull(), { timeout: 3000 })
  })

  it("un backdrop non-clean non arriva al renderer (catena storica intatta)", async () => {    installFetchMock()
    render(<ThemeProvider><PictoriumRoot><Probe /></PictoriumRoot></ThemeProvider>)
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })

    await act(async () => { ctx!.selectPortraitBaseBackdrop(LANG_BD) })
    await flush()
    expect(previewParam("pbase")).toBeNull()
    expect(previewParam("poster")).toBeNull()

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    // Base auto conservata (primo clean), nessuna scelta non-clean congelata.
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean-1.jpg")
  })

  it("titolo già salvato: la nuova scelta vince sulla base congelata", async () => {
    const saved: Mapping = {
      tmdbId: ITEM.id,
      mediaType: "movie",
      title: "Alpha",
      posterPath: "/lang-it.jpg",
      logoPath: "/logo-it.png",
      originalPosterPath: "/lang-it.jpg",
      language: "it",
      updatedAt: "2026-01-01T00:00:00.000Z",
      portraitBackdropPath: "/bd-clean-1.jpg",
    }
    installFetchMock([saved])
    render(<ThemeProvider><PictoriumRoot><Probe /></PictoriumRoot></ThemeProvider>)
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })
    // Base congelata: la preview la lascia risolvere al server (stesso crop).
    expect(previewParam("poster")).toBeNull()
    expect(previewParam("pbase")).toBeNull()
    expect(ctx!.portraitBaseBackdropPath).toBe("/bd-clean-1.jpg")
    expect(ctx!.portraitBasePickable).toBe(true)

    await act(async () => { ctx!.selectPortraitBaseBackdrop(CLEAN_2) })
    await flush()
    await waitFor(() => expect(previewParam("pbase")).toBe("/bd-clean-2.jpg"), { timeout: 3000 })

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts[0].body.portraitBackdropPath).toBe("/bd-clean-2.jpg")
  })

  it("il tile del poster in lingua resta la provenienza esplicita", async () => {
    installFetchMock()
    render(<ThemeProvider><PictoriumRoot><Probe /></PictoriumRoot></ThemeProvider>)
    await openTitle()
    await waitFor(() => expect(ctx!.previewUrl).not.toBe(""), { timeout: 3000 })

    await act(async () => { await ctx!.selectPoster(img2("/lang-it.jpg", "it")) })
    await flush()
    await waitFor(() => expect(previewParam("poster")).toBe("/lang-it.jpg"), { timeout: 3000 })
    expect(previewParam("pbase")).toBeNull()

    await act(async () => { await ctx!.saveConfig({ silent: true }) })
    await flush()
    expect(posts[0].body.portraitBackdropPath).toBeNull()
  })
})
