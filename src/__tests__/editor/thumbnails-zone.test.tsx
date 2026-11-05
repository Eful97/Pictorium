// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ThumbnailsView } from "@/components/ThumbnailsView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { t } from "@/lib/i18n"
import type { Mapping } from "@/lib/types"

const httpMock = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock("@/lib/http", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/http")>()
  return { ...mod, http: httpMock }
})

function mapping(overrides: Partial<Mapping> & { tmdbId: number }): Mapping {
  return {
    mediaType: "tv",
    title: `Serie ${overrides.tmdbId}`,
    posterPath: "/poster.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Mapping
}

function baseMappings(): Mapping[] {
  return [
    // Excluded: movie with stills (thumbnails are TV-only).
    mapping({ tmdbId: 1, mediaType: "movie", episodeThumbnailStills: { "1:1": "/a.jpg" } }),
    // Included: still overrides.
    mapping({ tmdbId: 2, title: "With Stills", episodeThumbnailStills: { "1:2": "/still-two.jpg" } }),
    // Included: explicit rotation override only.
    mapping({ tmdbId: 3, title: "Rotation Only", thumbnailRotation: true }),
    // Included: both.
    mapping({ tmdbId: 4, title: "Alpha Show", episodeThumbnailStills: { "2:3": "/alpha.jpg" }, thumbnailRotation: false }),
    // Excluded: no customization (null = inherit).
    mapping({ tmdbId: 5, title: "Plain", thumbnailRotation: null }),
  ]
}

beforeEach(() => {
  httpMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Thumbnails zone (top-level)", () => {
  it("lists only customized TV titles, sorted, with compact rows (no preview until expanded)", () => {
    renderWithCtx(<ThumbnailsView />, { lang: "en", mappings: baseMappings() })

    const rows = screen.getAllByTestId("thumbnail-zone-row")
    expect(rows).toHaveLength(3)
    expect(screen.getByText("Alpha Show")).toBeTruthy()
    expect(screen.getByText("Rotation Only")).toBeTruthy()
    expect(screen.getByText("With Stills")).toBeTruthy()
    expect(screen.queryByText("Plain")).toBeNull()
    // Compact by default: the composed preview only mounts when expanded.
    expect(screen.queryByRole("img")).toBeNull()
    expect(rows[0].querySelector('[data-testid="thumbnail-zone-edit"]')).toBeNull()
  })

  it("expands one row at a time to reveal preview + rotation + still-studio entry", () => {
    renderWithCtx(<ThumbnailsView />, { lang: "en", mappings: baseMappings() })

    const stillRow = screen.getByText("With Stills").closest("li") as HTMLLIElement
    fireEvent.click(screen.getByLabelText(`${t("ui.details")}: With Stills`))

    const preview = stillRow.querySelector("img") as HTMLImageElement
    expect(preview.getAttribute("src")).toBe(
      "/api/thumbnail/tv/2/season/1/episode/2?w=160&badges=vote&still=%2Fstill-two.jpg",
    )
    expect(stillRow.querySelector('[data-testid="episode-rotation-inherit"]')).toBeTruthy()
    expect(stillRow.querySelector('[data-testid="thumbnail-zone-edit"]')).toBeTruthy()

    // Collapsing hides them again.
    fireEvent.click(screen.getByLabelText(`${t("ui.details")}: With Stills`))
    expect(stillRow.querySelector("img")).toBeNull()
  })

  it("filters by series name client-side and keeps the selection across filters", () => {
    renderWithCtx(<ThumbnailsView />, { lang: "en", mappings: baseMappings() })
    expect(screen.getAllByTestId("thumbnail-zone-row")).toHaveLength(3)

    const search = screen.getByPlaceholderText(t("ui.thumbnailsZoneSearch"))
    fireEvent.change(search, { target: { value: "rotation" } })
    expect(screen.getAllByTestId("thumbnail-zone-row")).toHaveLength(1)
    expect(screen.getByText("Rotation Only")).toBeTruthy()

    // Select the filtered row, then clear the filter: selection survives.
    fireEvent.click(screen.getByLabelText(`${t("ui.selectAll")}: Rotation Only`))
    fireEvent.change(search, { target: { value: "stills" } })
    // "With Stills" remains visible; the selected (hidden) row is still counted.
    expect(screen.getAllByTestId("thumbnail-zone-row")).toHaveLength(1)
    expect(screen.getByTestId("thumbnails-selected-count").getAttribute("data-count")).toBe("1")
    fireEvent.change(search, { target: { value: "zzz" } })
    expect(screen.getByTestId("thumbnail-zone-no-results")).toBeTruthy()
    expect(screen.getByTestId("thumbnails-selected-count").getAttribute("data-count")).toBe("1")
  })

  it("writes ONLY the rotation key through the thumbnail-only PATCH", async () => {
    const loadMappings = vi.fn(async () => {})
    renderWithCtx(<ThumbnailsView />, {
      lang: "en",
      loadMappings,
      mappings: [mapping({ tmdbId: 3, title: "Rotation Only", thumbnailRotation: false })],
    })

    fireEvent.click(screen.getByLabelText(`${t("ui.details")}: Rotation Only`))
    fireEvent.click(screen.getByTestId("episode-rotation-on"))

    await waitFor(() => expect(httpMock).toHaveBeenCalledTimes(1))
    const [url, init] = httpMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/mappings/tv:3")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(String(init.body))).toEqual({ thumbnailRotation: true })
    await waitFor(() => expect(loadMappings).toHaveBeenCalledTimes(1))
  })

  it("bulk-deletes THUMBNAIL keys only after the confirm dialog", async () => {
    const loadMappings = vi.fn(async () => {})
    renderWithCtx(<ThumbnailsView />, {
      lang: "en",
      loadMappings,
      mappings: [
        mapping({ tmdbId: 2, title: "With Stills", episodeThumbnailStills: { "1:2": "/two.jpg" } }),
        mapping({ tmdbId: 3, title: "Rotation Only", thumbnailRotation: true }),
        mapping({ tmdbId: 4, title: "Not Selected", episodeThumbnailStills: { "1:1": "/x.jpg" } }),
      ],
    })

    fireEvent.click(screen.getByLabelText(`${t("ui.selectAll")}: With Stills`))
    fireEvent.click(screen.getByLabelText(`${t("ui.selectAll")}: Rotation Only`))
    expect(screen.getByTestId("thumbnails-selected-count").getAttribute("data-count")).toBe("2")
    fireEvent.click(screen.getByTestId("thumbnails-bulk-delete"))

    // Nothing is written before the confirmation.
    expect(httpMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: t("ui.delete") }))

    await waitFor(() => expect(httpMock).toHaveBeenCalledTimes(2))
    for (const [url, init] of httpMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url.startsWith("/api/mappings/tv:")).toBe(true)
      expect(init.method).toBe("PATCH")
      // Both thumbnail keys cleared; no poster field can ride this body.
      expect(JSON.parse(String(init.body))).toEqual({
        episodeThumbnailStills: null,
        thumbnailRotation: null,
      })
    }
    const urls = (httpMock.mock.calls as unknown as [string][]).map(([url]) => url).sort()
    expect(urls).toEqual(["/api/mappings/tv:2", "/api/mappings/tv:3"])
    await waitFor(() => expect(loadMappings).toHaveBeenCalledTimes(1))
  })

  it("supports a per-row delete (thumbnail keys only)", async () => {
    const loadMappings = vi.fn(async () => {})
    renderWithCtx(<ThumbnailsView />, {
      lang: "en",
      loadMappings,
      mappings: [mapping({ tmdbId: 2, title: "With Stills", episodeThumbnailStills: { "1:2": "/two.jpg" } })],
    })

    fireEvent.click(screen.getByTestId("thumbnail-zone-delete-row"))
    await waitFor(() => expect(httpMock).toHaveBeenCalledTimes(1))
    const [url, init] = httpMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/mappings/tv:2")
    expect(JSON.parse(String(init.body))).toEqual({
      episodeThumbnailStills: null,
      thumbnailRotation: null,
    })
    await waitFor(() => expect(loadMappings).toHaveBeenCalledTimes(1))
  })

  it("shows an honest empty state when no title has custom thumbnails", () => {
    renderWithCtx(<ThumbnailsView />, {
      lang: "en",
      mappings: [mapping({ tmdbId: 9, title: "Plain" })],
    })
    expect(screen.getByTestId("thumbnail-zone-empty")).toBeTruthy()
    expect(screen.queryAllByTestId("thumbnail-zone-row")).toHaveLength(0)
    expect(screen.getByTestId("thumbnails-bulk-delete")).toBeDisabled()
  })
})
