import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { MoodBoardTile, type TileHandlers } from "@/components/MoodBoardTile"
import { renderWithCtx } from "@/__tests__/test-utils"
import { posterUrl } from "@/lib/utils"
import type { Mapping } from "@/lib/types"

const CUSTOM = "https://i.imgur.com/custom.jpg"
const CUSTOM_NEXT = "https://i.imgur.com/custom-next.jpg"

function baseMapping(overrides?: Partial<Mapping>): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath: null,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: "2024-01-01",
    customPosterUrl: null,
    ...overrides,
  }
}

const handlers: TileHandlers = {
  select: vi.fn(),
  open: vi.fn(),
  quickView: vi.fn(),
  remove: vi.fn(),
  confirmRemove: vi.fn(),
  cancelRemove: vi.fn(),
  toggleShape: vi.fn(),
}

const t = (key: string) => key

function renderTile(mapping: Mapping) {
  return renderWithCtx(
    <MoodBoardTile mapping={mapping} idx={0} selectMode={false} isSelected={false} handlers={handlers} t={t} />,
  )
}

describe("MoodBoardTile customPosterUrl", () => {
  it("mostra il custom URL quando presente (verticale)", () => {
    renderTile(baseMapping({ customPosterUrl: CUSTOM }))
    const img = screen.getByAltText("Fight Club")
    expect(img.getAttribute("src")).toBe(CUSTOM)
  })

  it("conserva il posterPath TMDB quando il custom è assente", () => {
    renderTile(baseMapping())
    const img = screen.getByAltText("Fight Club")
    expect(img.getAttribute("src")).toBe(posterUrl("/abc.jpg", "w342"))
  })

  it("a custom non caricabile passa al posterPath, senza cicli", () => {
    renderTile(baseMapping({ customPosterUrl: CUSTOM }))
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    expect(img.getAttribute("src")).toBe(CUSTOM)
    // Primo errore: fallback al TMDB, immagine resta visibile
    fireEvent.error(img)
    expect(img.getAttribute("src")).toBe(posterUrl("/abc.jpg", "w342"))
    expect(img.style.display).not.toBe("none")
    // Secondo errore (fallback esaurito): nascosta, nessun ritorno al custom
    fireEvent.error(img)
    expect(img.style.display).toBe("none")
    expect(img.getAttribute("src")).toBe(posterUrl("/abc.jpg", "w342"))
  })

  it("al cambio di URL dopo un errore la nuova immagine riprova", async () => {
    const view = renderTile(baseMapping({ customPosterUrl: CUSTOM }))
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    fireEvent.error(img)
    expect(img.getAttribute("src")).toBe(posterUrl("/abc.jpg", "w342"))
    view.rerender(
      <MoodBoardTile
        mapping={baseMapping({ customPosterUrl: CUSTOM_NEXT })}
        idx={0}
        selectMode={false}
        isSelected={false}
        handlers={handlers}
        t={t}
      />,
    )
    await waitFor(() => expect(img.getAttribute("src")).toBe(CUSTOM_NEXT))
  })

  it("landscape keeps the backdrop and fallback, ignoring the portrait custom", () => {
    renderTile(
      baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customPosterUrl: CUSTOM }),
    )
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    expect(img.getAttribute("src")).toBe(posterUrl("/bd.jpg", "w780"))
    // Error on the backdrop: current fallback (hidden), never the portrait custom
    fireEvent.error(img)
    expect(img.style.display).toBe("none")
    expect(img.getAttribute("src")).toBe(posterUrl("/bd.jpg", "w780"))
  })

  it("landscape shows the saved customBackdropUrl (independent of portrait)", () => {
    renderTile(
      baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customPosterUrl: CUSTOM, customBackdropUrl: CUSTOM_NEXT }),
    )
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    expect(img.getAttribute("src")).toBe(CUSTOM_NEXT)
    // First error: fallback to the TMDB backdrop, never to the portrait custom
    fireEvent.error(img)
    expect(img.getAttribute("src")).toBe(posterUrl("/bd.jpg", "w780"))
    expect(img.style.display).not.toBe("none")
    // Second error (fallback exhausted): hidden, no return to the custom
    fireEvent.error(img)
    expect(img.style.display).toBe("none")
    expect(img.getAttribute("src")).toBe(posterUrl("/bd.jpg", "w780"))
  })

  it("landscape without a backdrop falls back to the poster after a custom error", () => {
    renderTile(
      baseMapping({ posterShape: "landscape", customBackdropUrl: CUSTOM }),
    )
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    expect(img.getAttribute("src")).toBe(CUSTOM)
    fireEvent.error(img)
    expect(img.getAttribute("src")).toBe(posterUrl("/abc.jpg", "w500"))
  })

  it("a landscape URL change after an error retries the new image", async () => {
    const view = renderTile(baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM }))
    const img = screen.getByAltText("Fight Club") as HTMLImageElement
    fireEvent.error(img)
    expect(img.getAttribute("src")).toBe(posterUrl("/bd.jpg", "w780"))
    view.rerender(
      <MoodBoardTile
        mapping={baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_NEXT })}
        idx={0}
        selectMode={false}
        isSelected={false}
        handlers={handlers}
        t={t}
      />,
    )
    await waitFor(() => expect(img.getAttribute("src")).toBe(CUSTOM_NEXT))
  })
})
