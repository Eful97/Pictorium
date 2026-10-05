/**
 * T2 — auto-logo al passaggio in landscape (parità con default Orizzontale).
 *
 * Condizione (fixture, non metadati reali del titolo): portrait senza
 * poster clean, backdrop e loghi disponibili. Il cambio formato non
 * toccava mai il logo (handleShapeChange) mentre l'apertura diretta con
 * default Orizzontale auto-seleziona il best logo (applyLoadedSelection).
 *
 * - switch editor → auto-select dello stesso logo del flusso default
 *   (stesso selectBestLogo con lang + original_language);
 * - rimozione manuale (logoDisabled) mai scavalcata;
 * - senza loghi resta nessuno;
 * - logo già presente (override salvato) mai toccato;
 * - ritorno in portrait: comportamento esistente (logo mai azzerato,
 *   backdrop rimosso).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { selectBestLogo } from "@/lib/logo-selection"
import type { PictoriumCtx } from "@/lib/context"
import type { SearchResult, TMDBImage } from "@/lib/types"

const mockSelected: SearchResult = {
  id: 1508701,
  media_type: "movie",
  title: "...che Dio perdona a tutti",
  poster_path: "/p.jpg",
  imdb_id: "tt38681843",
}

// Solo shape della condizione: poster NON clean, un backdrop, due loghi.
const nonCleanPoster: TMDBImage = { file_path: "/p-it.jpg", iso_639_1: "it", vote_average: 0, width: 1000, height: 1500 }
const logoEn: TMDBImage = { file_path: "/logo-en.png", iso_639_1: "en", vote_average: 0, width: 800, height: 300 }
const logoIt: TMDBImage = { file_path: "/logo-it.png", iso_639_1: "it", vote_average: 0, width: 800, height: 300 }
const logos = [logoEn, logoIt]

function renderEditor(overrides?: Partial<PictoriumCtx>) {
  let editorCtx: PosterEditorCtx | null = null
  function Probe() {
    editorCtx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    <><EditView /><Probe /></>,
    {
      selected: mockSelected,
      posters: [nonCleanPoster],
      previewPoster: nonCleanPoster,
      logos,
      selectedLogo: null,
      titleOrigLang: "it",
      ...overrides,
    },
  )
  return { ...view, editor: () => editorCtx as PosterEditorCtx }
}

async function switchShape(shape: "landscape" | "poster") {
  const u = userEvent.setup()
  await u.click(screen.getByRole("button", { name: shape === "landscape" ? "ui.posterShapeLandscape" : "ui.posterShapePortrait" }))
}

beforeEach(() => {
  localStorage.clear()
})

describe("landscape logo autoselect", () => {
  it("switch editor auto-seleziona lo stesso logo del flusso default Orizzontale", async () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo })
    await switchShape("landscape")
    // Parità: identico helper e identici argomenti del ramo
    // defaultPosterShape landscape in applyLoadedSelection.
    const expected = selectBestLogo(logos, "it", "it")
    expect(expected?.file_path).toBe("/logo-it.png")
    expect(selectLogo).toHaveBeenCalledTimes(1)
    expect(selectLogo).toHaveBeenCalledWith(expect.objectContaining({ file_path: expected?.file_path }))
  })

  it("rimozione manuale (logoDisabled) mai scavalcata", async () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    const { editor } = renderEditor({ selectLogo })
    act(() => { editor().setLogoDisabled(true) })
    await switchShape("landscape")
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("senza loghi resta nessuno", async () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo, logos: [] })
    await switchShape("landscape")
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("logo già presente (override salvato) mai toccato", async () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo, selectedLogo: logoEn })
    await switchShape("landscape")
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("ritorno in portrait: comportamento esistente (logo tenuto, backdrop rimosso)", async () => {
    const setSelectedLogo = vi.fn()
    const removeBackdrop = vi.fn()
    renderEditor({ selectedLogo: logoEn, setSelectedLogo, removeBackdrop })
    await switchShape("landscape")
    await switchShape("poster")
    expect(setSelectedLogo).not.toHaveBeenCalled()
    expect(removeBackdrop).toHaveBeenCalled()
  })
})
