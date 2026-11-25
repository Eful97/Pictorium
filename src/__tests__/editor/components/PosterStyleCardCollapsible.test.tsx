import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

vi.mock("@/lib/useAuthenticatedPreview", () => ({ useAuthenticatedPreviewUrl: (url: string | null) => url }))

import { PosterStyleCard } from "@/components/settings/PosterStyleCard"

const options = [{ id: "a", title: "A", desc: "", active: false, onApply: () => {}, thumbnailUrl: "/api/poster/movie/1?x=1" }]

describe("PosterStyleCard collapsible", () => {
  it("starts closed without fetching thumbnails, opens on the header", () => {
    render(<PosterStyleCard title="Configurazioni rapide" desc="d" note="n" options={options} compact collapsible />)
    const toggle = screen.getByTestId("poster-style-cards-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByTestId("poster-style-a").querySelector("img")).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByTestId("poster-style-a").querySelector("img")).not.toBeNull()
  })

  it("non-collapsible callers stay open with no toggle", () => {
    render(<PosterStyleCard title="T" desc="d" note="n" options={options} compact />)
    expect(screen.queryByTestId("poster-style-cards-toggle")).toBeNull()
    expect(screen.getByTestId("poster-style-a").querySelector("img")).not.toBeNull()
  })
})
