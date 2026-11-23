import { describe, it, expect, afterEach } from "vitest"
import { render, act } from "@testing-library/react"
import { PosterCarousel } from "@/components/PosterCarousel"

describe("PosterCarousel pause", () => {
  afterEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
  })

  it("pauses the wall animation while the tab is hidden and resumes after", () => {
    const { container } = render(<PosterCarousel />)
    const root = container.querySelector<HTMLElement>(".home-stage-wall")!

    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(root.dataset.paused).toBe("true")

    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(root.dataset.paused).toBe("false")
  })
})
