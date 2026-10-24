import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { screen, cleanup } from "@testing-library/react"
import { CatalogSourceBadge } from "@/components/CatalogSourceBadge"
import { SimklCard } from "@/components/SimklCard"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({ t: (key: string) => key }),
}))

const fetchMock = vi.spyOn(globalThis, "fetch")

beforeEach(() => {
  fetchMock.mockReset()
})

afterEach(() => cleanup())

function localImgs(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll("img")) as HTMLImageElement[]
}

describe("CatalogSourceBadge iconOnly (card-footer logo beside the counter)", () => {
  it("flixpatrol iconOnly shows ONLY the local FP svg at compact size, no visible text or pill", () => {
    renderWithCtx(<CatalogSourceBadge actual="flixpatrol" iconOnly />)
    const icon = screen.getByRole("img", { name: "FlixPatrol" })
    expect(icon.tagName).toBe("SPAN")
    expect(icon.getAttribute("title")).toBe("FlixPatrol")
    // Single naming: the decorative svg carries no competing label.
    const img = localImgs()[0]
    expect(img?.getAttribute("src")).toBe("/catalogs/idB7ODvhZ1_logos.svg")
    expect(img?.getAttribute("alt")).toBe("")
    expect(img?.getAttribute("aria-hidden")).toBe("true")
    expect(img?.className).toContain("w-5")
    expect(img?.className).toContain("h-5")
    // No visible provider text, no pill/outline/background chrome.
    expect(screen.queryByText("ui.streamSourceFp")).toBeNull()
    expect(icon.className).not.toMatch(/border|bg-|rounded|px-2/)
  })

  it("justwatch iconOnly shows ONLY the local JW svg, no visible text", () => {
    renderWithCtx(<CatalogSourceBadge actual="justwatch" iconOnly />)
    const icon = screen.getByRole("img", { name: "JustWatch" })
    expect(icon.getAttribute("title")).toBe("JustWatch")
    expect(localImgs()[0]?.getAttribute("src")).toBe("/catalogs/JW_Logo_color.svg")
    expect(screen.queryByText("ui.streamSourceJw")).toBeNull()
    expect(icon.className).not.toMatch(/border|bg-|rounded|px-2/)
  })

  it("unknown iconOnly renders NO guessed logo and NO visible text (screen-reader-only honest pending)", () => {
    renderWithCtx(<CatalogSourceBadge actual="unknown" iconOnly />)
    expect(localImgs()).toHaveLength(0)
    expect(screen.queryByRole("img")).toBeNull()
    const pending = screen.getByText("ui.streamSourceUnknown")
    expect(pending.className).toContain("sr-only")
  })

  it("custom label feeds only the tooltip in iconOnly, never visible text; accessible name stays the provider", () => {
    renderWithCtx(<CatalogSourceBadge actual="flixpatrol" label="Top 10 · FlixPatrol" iconOnly />)
    const icon = screen.getByRole("img", { name: "FlixPatrol" })
    expect(icon.getAttribute("title")).toBe("Top 10 · FlixPatrol")
    expect(screen.queryByText("Top 10 · FlixPatrol")).toBeNull()
  })

  it("default (iconOnly off) text badge DOM/semantics are unchanged for existing consumers", () => {
    const { rerender } = renderWithCtx(<CatalogSourceBadge actual="flixpatrol" />)
    expect(localImgs()[0]?.getAttribute("src")).toBe("/catalogs/idB7ODvhZ1_logos.svg")
    expect(screen.getByText("ui.streamSourceFp")).toBeTruthy()
    rerender(<CatalogSourceBadge actual="justwatch" label="Custom JW" />)
    expect(localImgs()[0]?.getAttribute("src")).toBe("/catalogs/JW_Logo_color.svg")
    expect(screen.getByText("Custom JW")).toBeTruthy()
    rerender(<CatalogSourceBadge actual="unknown" />)
    expect(localImgs()).toHaveLength(0)
    expect(screen.getByText("ui.streamSourceUnknown")).toBeTruthy()
  })

  it("emits no network requests of its own: every image is a verbatim local user asset, never /api/poster or TMDB", () => {
    const callsBefore = fetchMock.mock.calls.length
    renderWithCtx(
      <>
        <CatalogSourceBadge actual="flixpatrol" iconOnly />
        <CatalogSourceBadge actual="justwatch" iconOnly />
        <CatalogSourceBadge actual="unknown" iconOnly />
      </>,
    )
    for (const img of localImgs()) {
      const src = img.getAttribute("src") ?? ""
      expect(src.startsWith("/catalogs/")).toBe(true)
      expect(src).not.toContain("/api/poster")
      expect(src).not.toContain("image.tmdb.org")
    }
    // The badge renders plain local <img> tags: any fetch issued while it
    // renders must come from the shared test harness (context defaults),
    // never from poster/image/TMDB traffic of its own.
    const ownCalls = fetchMock.mock.calls.slice(callsBefore).map((c) => String(c[0]))
    for (const url of ownCalls) {
      expect(url).not.toContain("/api/poster")
      expect(url).not.toContain("image.tmdb.org")
      expect(url).not.toContain("/api/tmdb")
    }
  })

  it("iconOnly badge drops into the SimklCard footerAdornment slot beside the counter (contract for H)", () => {
    renderWithCtx(
      <SimklCard
        items={[{ id: 11, media_type: "movie", title: "Alpha", poster_path: "/alpha.jpg" }]}
        title="Top List"
        totalCount={20}
        footerAdornment={<CatalogSourceBadge actual="justwatch" iconOnly />}
      />,
    )
    const icon = screen.getByRole("img", { name: "JustWatch" })
    const counter = screen.getByText("20 ui.itemMany")
    expect(icon.parentElement).toBe(counter.parentElement)
  })
})
