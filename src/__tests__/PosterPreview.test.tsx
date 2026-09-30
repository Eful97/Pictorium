import { describe, expect, it, vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { renderWithCtx } from "./test-utils"
import { PosterPreview } from "@/components/PosterPreview"

// t() che ritorna la key stessa — test non dipendenti dalle traduzioni
const t = (k: string) => k

const BASE_PROPS = {
  previewLoading: false,
  loadProgress: 0,
  imageError: false,
  setImageError: vi.fn(),
  imgSrc: "",
}

const SELECTED_MOVIE = {
  id: 1,
  media_type: "movie" as const,
  title: "Test Movie",
  name: "Test Movie",
  poster_path: "/test.jpg",
}

describe("PosterPreview", () => {
  it("renders nothing when no poster is selected and no previewUrl", () => {
    const { container } = renderWithCtx(
      <PosterPreview {...BASE_PROPS} />,
      { selected: null, previewUrl: "", t },
    )
    expect(container.querySelector("img")).toBeNull()
  })

  it("renders skeleton when selected but no previewUrl", () => {
    renderWithCtx(
      <PosterPreview {...BASE_PROPS} />,
      { selected: SELECTED_MOVIE, previewUrl: "", t },
    )
    expect(document.querySelector(".animate-pulse")).toBeTruthy()
  })

  it("renders the preview image when imgSrc is provided", () => {
    const { container } = renderWithCtx(
      <PosterPreview {...BASE_PROPS} imgSrc="https://example.com/poster.jpg" />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    const img = container.querySelector("img[src]")
    expect(img).toBeTruthy()
    expect(img?.getAttribute("src")).toBe("https://example.com/poster.jpg")
  })

  it("shows discrete updating status when previewLoading is true", () => {
    renderWithCtx(
      <PosterPreview {...BASE_PROPS} previewLoading loadProgress={45} />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    expect(screen.getByText("ui.previewUpdating")).toBeTruthy()
  })

  it("shows error overlay when imageError is true", () => {
    renderWithCtx(
      <PosterPreview {...BASE_PROPS} imageError />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    expect(screen.getByText("ui.imageNotAvailable")).toBeTruthy()
  })

  it("calls setImageError(false) on retry click", () => {
    const setImageError = vi.fn()
    renderWithCtx(
      <PosterPreview {...BASE_PROPS} imageError setImageError={setImageError} />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    fireEvent.click(screen.getByText("ui.retry"))
    expect(setImageError).toHaveBeenCalledWith(false)
  })

  it("calls onRetry on retry click when provided (re-fetch del preview)", () => {
    const setImageError = vi.fn()
    const onRetry = vi.fn()
    renderWithCtx(
      <PosterPreview {...BASE_PROPS} imageError setImageError={setImageError} onRetry={onRetry} />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    fireEvent.click(screen.getByText("ui.retry"))
    expect(setImageError).toHaveBeenCalledWith(false)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps the old buffer behind until the new image loads", () => {
    const { container, rerender } = renderWithCtx(
      <PosterPreview {...BASE_PROPS} imgSrc="https://example.com/a.jpg" />,
      { selected: SELECTED_MOVIE, previewUrl: "https://example.com/preview", t },
    )
    const first = container.querySelector('img[src="https://example.com/a.jpg"]')
    expect(first).toBeTruthy()
    fireEvent.load(first!)

    rerender(
      <PosterPreview {...BASE_PROPS} imgSrc="https://example.com/b.jpg" />,
    )
    // Vecchio buffer ancora dietro, nuovo subito visibile (progressivo).
    expect(container.querySelector('img[src="https://example.com/a.jpg"]')).toBeTruthy()
    const second = container.querySelector('img[src="https://example.com/b.jpg"]')
    expect(second).toBeTruthy()

    fireEvent.load(second!)
    // A load completato il vecchio viene rimosso (un solo buffer).
    expect(container.querySelector('img[src="https://example.com/a.jpg"]')).toBeNull()
    expect(container.querySelector('img[src="https://example.com/b.jpg"]')).toBeTruthy()
  })
})
