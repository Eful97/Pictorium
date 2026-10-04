import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PosterLightbox } from "@/components/PosterLightbox"
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

const posterUrlFn = (path: string, size = "w500") => `https://image.tmdb.org/t/p/${size}${path}`
const t = (key: string) => key

function renderLightbox(mapping: Mapping) {
  return render(
    <PosterLightbox
      lightbox={{ mapping, rect: new DOMRect() }}
      onClose={() => {}}
      posterUrlFn={posterUrlFn}
      t={t}
    />,
  )
}

describe("PosterLightbox customPosterUrl", () => {
  it("mostra il custom URL quando presente (verticale)", () => {
    renderLightbox(baseMapping({ customPosterUrl: CUSTOM }))
    expect(screen.getByAltText("Fight Club").getAttribute("src")).toBe(CUSTOM)
  })

  it("conserva il posterPath TMDB quando il custom è assente", () => {
    renderLightbox(baseMapping())
    expect(screen.getByAltText("Fight Club").getAttribute("src")).toBe(posterUrlFn("/abc.jpg", "w500"))
  })

  it("a custom non caricabile passa al posterPath, senza cicli", () => {
    renderLightbox(baseMapping({ customPosterUrl: CUSTOM }))
    const img = screen.getByAltText("Fight Club")
    expect(img.getAttribute("src")).toBe(CUSTOM)
    // Primo errore: fallback al TMDB
    fireEvent.error(img)
    expect(screen.getByAltText("Fight Club").getAttribute("src")).toBe(posterUrlFn("/abc.jpg", "w500"))
    // Secondo errore (fallback esaurito): placeholder, nessun ritorno al custom
    fireEvent.error(screen.getByAltText("Fight Club"))
    expect(screen.queryByAltText("Fight Club")).toBeNull()
  })

  it("al cambio di URL dopo un errore la nuova immagine riprova", async () => {
    const view = renderLightbox(baseMapping({ customPosterUrl: CUSTOM }))
    fireEvent.error(screen.getByAltText("Fight Club"))
    expect(screen.getByAltText("Fight Club").getAttribute("src")).toBe(posterUrlFn("/abc.jpg", "w500"))
    view.rerender(
      <PosterLightbox
        lightbox={{ mapping: baseMapping({ customPosterUrl: CUSTOM_NEXT }), rect: new DOMRect() }}
        onClose={() => {}}
        posterUrlFn={posterUrlFn}
        t={t}
      />,
    )
    await waitFor(() => expect(screen.getByAltText("Fight Club").getAttribute("src")).toBe(CUSTOM_NEXT))
  })

  it("in orizzontale conserva backdrop e fallback, ignorando il custom", () => {
    renderLightbox(
      baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customPosterUrl: CUSTOM }),
    )
    const img = screen.getByAltText("Fight Club")
    expect(img.getAttribute("src")).toBe(posterUrlFn("/bd.jpg", "w780"))
    // Errore sul backdrop: fallback attuale, mai il custom
    fireEvent.error(img)
    expect(screen.queryByAltText("Fight Club")).toBeNull()
  })
})
