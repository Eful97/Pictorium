/**
 * L2 — selezione sfondi landscape: primo visibile, gesto manuale vs best-fit,
 * toggle-off stabile (cause A/B/C della diagnosi L1).
 *
 * - A (EditView init): dopo un clear esplicito non si riseleziona finché resta
 *   lo stesso titolo in landscape; rientrando dal portrait si reinizializza.
 * - B (BackdropOptions best-fit): un pick/clear manuale non è sovrascritto dai
 *   risultati tardivi né segue un riordino automatico; senza gesto
 *   l'automatismo resta (feature preservata); cambio titolo resetta la guardia
 *   (chiave media:id, vale anche movie:id vs tv:id).
 * - C (EditView init): il primo auto-selezionato è il primo VISIBILE della
 *   griglia (clean non escluso), mai un localizzato invisibile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect, useState } from "react"
import { BackdropOptions } from "@/components/BackdropOptions"
import EditView from "@/components/EditView"
import { usePosterFit, type PosterFitEntry } from "@/lib/usePosterFit"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { Mapping, SearchResult, TMDBImage } from "@/lib/types"

vi.mock("@/lib/usePosterFit", () => ({ usePosterFit: vi.fn() }))
const fitMock = vi.mocked(usePosterFit)

const img = (file_path: string, iso_639_1: string | null): TMDBImage =>
  ({ file_path, iso_639_1, vote_average: 0, width: 1920, height: 1080 })

const BD1 = img("/bd1.jpg", null)
const BD2 = img("/bd2.jpg", null)
const BD3 = img("/bd3.jpg", null)
const BD_LOC = img("/bd-loc.jpg", "it")
const LOGO = img("/logo.png", null)

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }
const ITEM_B: SearchResult = { id: 102, media_type: "movie", title: "Beta", poster_path: "/b.jpg" }

const entry = (posterPath: string, score: number): PosterFitEntry => ({
  posterPath,
  score,
  adjustedScore: score,
  textPenalty: 0,
  logoZoneScore: score,
  colorConflictPenalty: 0,
  qualityScore: score,
  metrics: { cleanliness: 1, contrast: 1, lowDetailScore: 0, badgeReadability: 1 },
  reasons: [],
})

function setFit(best: string | null, ranked: PosterFitEntry[], loading = false) {
  fitMock.mockReturnValue({ bestFitPath: best, results: ranked, loading, error: null })
}

function BackdropShell({ backdrops, initialSelected, onSelect }: {
  backdrops: TMDBImage[]
  initialSelected: SearchResult
  onSelect?: (img: TMDBImage) => void
}) {
  const [sel, setSel] = useState(initialSelected)
  const [active, setActive] = useState<string | null>(null)
  // Mirror openPosterBrowser: opening another title reloads the selection
  // state for the new title key.
  const titlePropKey = `${initialSelected.media_type}:${initialSelected.id}`
  useEffect(() => {
    setSel(initialSelected)
    setActive(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional prop-keyed reset on title switch
  }, [titlePropKey])
  const ctx = { ...MOCK_CTX, selected: sel, selectedLogo: LOGO, mappingsMap: new Map() }
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={ctx}>
          <BackdropOptions
            backdrops={backdrops}
            backdropActivePath={active}
            selectBackdrop={(i) => { setActive(i.file_path); onSelect?.(i) }}
            clearBackdrop={() => setActive(null)}
          />
        </PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

function tileOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('img[src*="/bd"]'))
    .map((i) => (i.getAttribute("src") || "").split("/").pop() ?? "")
}

function activePaths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button.poster-tile-active img"))
    .map((i) => (i.getAttribute("src") || "").split("/").pop() ?? "")
}

async function clickTile(container: HTMLElement, name: string) {
  const u = userEvent.setup()
  const tileImg = container.querySelector(`img[src*="${name}"]`)
  expect(tileImg).not.toBeNull()
  await u.click(tileImg!.closest("button")!)
}

beforeEach(() => {
  localStorage.clear()
  setFit(null, [], true)
})

describe("BackdropOptions: gesto manuale vs best-fit tardivo (causa B)", () => {
  const ranked = [entry("/bd1.jpg", 0.5), entry("/bd2.jpg", 0.6), entry("/bd3.jpg", 0.95)]

  it("pick manuale della prima immagine sopravvive al fit tardivo senza riordino", async () => {
    const onSelect = vi.fn()
    const view = render(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} onSelect={onSelect} />,
    )
    // Pick manuale PRIMA che il fit risolva.
    await clickTile(view.container, "/bd1.jpg")
    expect((activePaths(view.container)[0] ?? null)).toBe("bd1.jpg")
    // Il fit risolve TARDI con best diverso dal pick.
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} onSelect={onSelect} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd1.jpg")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(tileOrder(view.container)).toEqual(["bd1.jpg", "bd2.jpg", "bd3.jpg"])
  })

  it("senza gesto manuale il best-fit automatico sceglie il miglior candidato (feature preservata)", async () => {
    const onSelect = vi.fn()
    const view = render(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} onSelect={onSelect} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBeNull()
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} onSelect={onSelect} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd3.jpg")
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/bd3.jpg" }))
  })

  it("clear volontario resta vuoto anche a fit tardivo (nessuna riselezione)", async () => {
    const view = render(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} />,
    )
    await clickTile(view.container, "/bd2.jpg")
    expect((activePaths(view.container)[0] ?? null)).toBe("bd2.jpg")
    // Toggle-off sul tile attivo.
    await clickTile(view.container, "/bd2.jpg")
    expect((activePaths(view.container)[0] ?? null)).toBeNull()
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBeNull()
    expect(activePaths(view.container)).toEqual([])
  })

  it("A→B→A: returning to A re-arms automation (manual guard is per session)", async () => {
    const view = render(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} />,
    )
    await clickTile(view.container, "/bd1.jpg")
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd1.jpg")
    // Title B, no gesture: automation applies.
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_B} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd3.jpg")
    // Back to A: a NEW session — automation is allowed again, the old manual
    // pick must not suppress it.
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={ITEM_A} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd3.jpg")
    expect(tileOrder(view.container)[0]).toBe("bd3.jpg")
  })

  it("movie id=7 → tv id=7 resets sort and guards (titleKey, not bare id)", async () => {
    const MOVIE7: SearchResult = { id: 7, media_type: "movie", title: "Seven M", poster_path: "/m7.jpg" }
    const TV7: SearchResult = { id: 7, media_type: "tv", title: "Seven T", poster_path: "/t7.jpg" }
    const view = render(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={MOVIE7} />,
    )
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={MOVIE7} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd3.jpg")
    expect(tileOrder(view.container)[0]).toBe("bd3.jpg")
    // Same numeric id, other media: grid order and guards reset. Hold the
    // fit loading so the reset state is observable before automation.
    setFit(null, [], true)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={TV7} />,
    )
    expect(tileOrder(view.container)).toEqual(["bd1.jpg", "bd2.jpg", "bd3.jpg"])
    expect(activePaths(view.container)).toEqual([])
    setFit("/bd3.jpg", ranked)
    view.rerender(
      <BackdropShell backdrops={[BD1, BD2, BD3]} initialSelected={TV7} />,
    )
    expect((activePaths(view.container)[0] ?? null)).toBe("bd3.jpg")
  })
})

function renderLandscapeEditor(overrides?: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  function Probe() {
    const ed = usePosterEditor()
    useEffect(() => {
      capture.ed = ed
    }, [ed])
    return null
  }
  const selectBackdrop = vi.fn()
  const removeBackdrop = vi.fn()
  const view = renderWithCtx(
    <><EditView /><Probe /></>,
    {
      selected: ITEM_A,
      posters: [img("/p-clean.jpg", null)],
      previewPoster: img("/p-clean.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map(),
      selectBackdrop,
      removeBackdrop,
      ...overrides,
    },
  )
  return { ...view, editor: () => capture.ed as PosterEditorCtx, selectBackdrop, removeBackdrop }
}

describe("EditView: init landscape una tantum + primo visibile (cause A/C)", () => {
  async function switchLandscape() {
    const u = userEvent.setup()
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
  }

  it("primo auto-selezionato è il primo VISIBILE, mai il localizzato invisibile (causa C)", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor()
    act(() => { editor().setBackdrops([BD_LOC, BD1, BD2]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    expect(selectBackdrop).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/bd1.jpg" }))
  })

  it("clear esplicito resta vuoto finché stesso titolo in landscape (causa A)", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor()
    act(() => { editor().setBackdrops([BD1, BD2]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    // Lo stato reale applicherebbe la selezione (ctx.selectBackdrop → ed):
    // qui la simuliamo, poi l'azzeramento volontario (clearBackdrop).
    act(() => { editor().setSelectedBackdrop(BD1) })
    act(() => { editor().setSelectedBackdrop(null) })
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
  })

  it("rientro dal portrait reinizializza (coerenza switch formato)", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor()
    const u = userEvent.setup()
    act(() => { editor().setBackdrops([BD1, BD2]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    expect(selectBackdrop).toHaveBeenCalledTimes(2)
    expect(selectBackdrop).toHaveBeenLastCalledWith(expect.objectContaining({ file_path: "/bd1.jpg" }))
  })

  it("portrait invariato: nessuna auto-selezione sfondo", async () => {
    const { selectBackdrop } = renderLandscapeEditor()
    expect(selectBackdrop).not.toHaveBeenCalled()
  })

  it("direct landscape entry selects first visible without touching portrait state", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor()
    act(() => {
      editor().setBackdrops([BD_LOC, BD1, BD2])
      editor().setPosterShape("landscape")
    })
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    expect(selectBackdrop).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/bd1.jpg" }))
  })

  it("saved mapping backdrop restores directly with transforms preserved", async () => {
    const mapping: Mapping = {
      tmdbId: 101,
      mediaType: "movie",
      title: "Alpha",
      posterPath: "/a.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-01-01",
      posterShape: "landscape",
      backdropPath: "/saved-ext.jpg",
      backdropScale: 150,
      backdropOffsetX: 5,
      backdropOffsetY: -3,
    }
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:101", mapping]]),
    })
    act(() => {
      editor().setBackdrops([BD1, BD2])
      editor().setBackdropScale(150)
      editor().setBackdropOffsetX(5)
      editor().setBackdropOffsetY(-3)
    })
    await switchLandscape()
    // External saved path restores even though it is not a TMDB tile…
    expect(editor().selectedBackdrop?.file_path).toBe("/saved-ext.jpg")
    // …via direct restore, never via selectBackdrop (which would reset
    // the saved scale/offsets).
    expect(selectBackdrop).not.toHaveBeenCalled()
    expect(editor().backdropScale).toBe(150)
    expect(editor().backdropOffsetX).toBe(5)
    expect(editor().backdropOffsetY).toBe(-3)
  })
})
