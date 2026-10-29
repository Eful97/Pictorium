/**
 * Auto-logo in portrait: SOLO su base pulita.
 *
 * Contratto (parità con la base che il renderer unico compone per Stremio):
 * - base pulita = poster clean (`iso_639_1 === null`, clean abilitati) oppure
 *   base portrait automatica del server (backdrop 2:3 + logo, esposta da
 *   `portraitBaseBackdropPath`): in entrambi i casi l'immagine non ha un
 *   titolo cotto, quindi l'auto-logo è corretto;
 * - poster in lingua (titolo già nell'immagine): nessuna auto-selezione,
 *   altrimenti doppio titolo;
 * - clean disabilitati nei default: nessuna auto-selezione sul clean;
 * - rimozione manuale (logoDisabled) e logo già scelto mai scavalcati;
 * - stesso helper e stessi argomenti del ramo landscape
 *   (`selectBestLogo(logos, lang, original_language)`).
 *
 * I cambi di base sono pilotati dal value del context (rerender con la stessa
 * gerarchia di provider), così i test misurano il gate dell'effetto e non
 * l'ordine di mount.
 */
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { useEffect } from "react"
import EditView from "@/components/EditView"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider, type PictoriumCtx } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { selectBestLogo } from "@/lib/logo-selection"
import type { SearchResult, TMDBImage } from "@/lib/types"

const mockSelected: SearchResult = {
  id: 1508701,
  media_type: "movie",
  title: "...che Dio perdona a tutti",
  poster_path: "/p.jpg",
  imdb_id: "tt38681843",
}

const cleanPoster: TMDBImage = { file_path: "/p-clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
const langPoster: TMDBImage = { file_path: "/p-it.jpg", iso_639_1: "it", vote_average: 0, width: 1000, height: 1500 }
const logoEn: TMDBImage = { file_path: "/logo-en.png", iso_639_1: "en", vote_average: 0, width: 800, height: 300 }
const logoIt: TMDBImage = { file_path: "/logo-it.png", iso_639_1: "it", vote_average: 0, width: 800, height: 300 }
const logos = [logoEn, logoIt]

const BASE_OVERRIDES: Partial<PictoriumCtx> = {
  selected: mockSelected,
  posters: [cleanPoster, langPoster],
  previewPoster: cleanPoster,
  logos,
  selectedLogo: null,
  titleOrigLang: "it",
  portraitBaseBackdropPath: null,
}

// Value corrente del provider: mutarlo + rerender è il modo di simulare una
// nuova base (clean ↔ poster in lingua ↔ base auto) senza rimontare l'editor.
let ctxValue: PictoriumCtx = MOCK_CTX

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={ctxValue}>{children}</PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

function renderEditor(overrides?: Partial<PictoriumCtx>) {
  // Il React Compiler vieta la scrittura di variabili esterne durante il
  // render: l'aggancio all'editor avviene in un effect (pattern documentato).
  let editorCtx: PosterEditorCtx | null = null
  function Probe() {
    const ed = usePosterEditor()
    useEffect(() => { editorCtx = ed })
    return null
  }
  const merged = { ...BASE_OVERRIDES, ...overrides }
  ctxValue = { ...MOCK_CTX, ...merged }
  const view = render(<><EditView /><Probe /></>, { wrapper: Wrapper })
  return {
    ...view,
    editor: () => editorCtx as PosterEditorCtx,
    setCtx: (next: Partial<PictoriumCtx>) => {
      ctxValue = { ...MOCK_CTX, ...merged, ...next }
      view.rerender(<><EditView /><Probe /></>)
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe("portrait logo autoselect", () => {
  it("base clean: auto-seleziona lo stesso best logo del ramo condiviso", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo })
    const expected = selectBestLogo(logos, "it", "it")
    expect(expected?.file_path).toBe("/logo-it.png")
    expect(selectLogo).toHaveBeenCalledTimes(1)
    expect(selectLogo).toHaveBeenCalledWith(expect.objectContaining({ file_path: expected?.file_path }))
  })

  it("poster in lingua (titolo cotto): nessuna auto-selezione", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo, previewPoster: langPoster, posters: [langPoster] })
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("passaggio da poster in lingua a clean: auto-selezione", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    const { setCtx } = renderEditor({ selectLogo, previewPoster: langPoster, posters: [langPoster] })
    expect(selectLogo).not.toHaveBeenCalled()
    setCtx({ previewPoster: cleanPoster, posters: [cleanPoster, langPoster] })
    expect(selectLogo).toHaveBeenCalledTimes(1)
  })

  it("clean disabilitati nei default: nessuna auto-selezione sul clean", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    const { editor, setCtx } = renderEditor({ selectLogo, previewPoster: langPoster, posters: [langPoster] })
    act(() => { editor().setDefaultDisableCleanPosters(true) })
    setCtx({ previewPoster: cleanPoster, posters: [cleanPoster, langPoster] })
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("base portrait automatica (backdrop + logo): auto-selezione col poster in lingua in stato", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({
      selectLogo,
      previewPoster: langPoster,
      posters: [langPoster],
      portraitBaseBackdropPath: "/bd-clean.jpg",
    })
    const expected = selectBestLogo(logos, "it", "it")
    expect(selectLogo).toHaveBeenCalledTimes(1)
    expect(selectLogo).toHaveBeenCalledWith(expect.objectContaining({ file_path: expected?.file_path }))
  })

  it("rimozione manuale (logoDisabled) mai scavalcata", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    const { editor, setCtx } = renderEditor({ selectLogo, previewPoster: langPoster, posters: [langPoster] })
    act(() => { editor().setLogoDisabled(true) })
    setCtx({ previewPoster: cleanPoster, posters: [cleanPoster, langPoster] })
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("logo già scelto: mai toccato", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo, selectedLogo: logoEn })
    expect(selectLogo).not.toHaveBeenCalled()
  })

  it("senza loghi resta nessuno", () => {
    const selectLogo = vi.fn().mockResolvedValue(undefined)
    renderEditor({ selectLogo, logos: [] })
    expect(selectLogo).not.toHaveBeenCalled()
  })
})
