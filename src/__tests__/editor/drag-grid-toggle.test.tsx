import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { DragGridOverlay, DragGridToggle } from "@/components/settings/DragGridControls"
import { DRAG_GRID_STORAGE_KEY, readDragGrid, writeDragGrid } from "@/lib/drag-grid-pref"

vi.mock("@/lib/contexts/TranslationContext", () => ({ useT: () => ({ t: (key: string) => key }) }))

function Harness() {
  const [on, setOn] = useState(readDragGrid())
  return (
    <>
      <DragGridToggle
        enabled={on}
        onToggle={() => {
          const next = !on
          setOn(next)
          writeDragGrid(next)
        }}
      />
      {on ? <DragGridOverlay /> : null}
    </>
  )
}

describe("drag grid toggle", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("starts OFF with aria-pressed false and no overlay", () => {
    render(<Harness />)
    const btn = screen.getByRole("button", { name: "ui.dragGrid" })
    expect(btn).toHaveAttribute("aria-pressed", "false")
    expect(screen.queryByTestId("badge-drag-grid-overlay")).toBeNull()
  })

  it("toggles aria-pressed, shows the overlay and persists to localStorage", () => {
    render(<Harness />)
    const btn = screen.getByRole("button", { name: "ui.dragGrid" })
    fireEvent.click(btn)
    expect(btn).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("badge-drag-grid-overlay")).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAG_GRID_STORAGE_KEY)).toBe("1")
    fireEvent.click(btn)
    expect(btn).toHaveAttribute("aria-pressed", "false")
    expect(window.localStorage.getItem(DRAG_GRID_STORAGE_KEY)).toBe("0")
  })

  it("restores the persisted ON state", () => {
    window.localStorage.setItem(DRAG_GRID_STORAGE_KEY, "1")
    render(<Harness />)
    expect(screen.getByRole("button", { name: "ui.dragGrid" })).toHaveAttribute("aria-pressed", "true")
  })

  it("degrades to OFF and no-ops when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readDragGrid()).toBe(false)
    expect(() => writeDragGrid(true)).not.toThrow()
  })
})
