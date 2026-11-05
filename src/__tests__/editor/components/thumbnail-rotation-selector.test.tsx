/**
 * Per-title Miniature rotation selector (episode studio): inherit / ON / OFF.
 *
 * Controlled widget + editor state: `null` inherits the space default, an
 * explicit true/false wins. The studio persists the draft with the same Save
 * as the still overrides; the selector never invents a fourth state.
 */
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { ThumbnailRotationSelector } from "@/components/settings/ThumbnailRotationSelector"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))

describe("ThumbnailRotationSelector", () => {
  it("renders inherit/on/off with the current value pressed and reports changes", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ThumbnailRotationSelector value={null} onChange={onChange} />)

    expect(screen.getByRole("group", { name: "ui.thumbnailRotation" })).toBeInTheDocument()
    expect(screen.getByTestId("episode-rotation-inherit")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("episode-rotation-on")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("episode-rotation-off")).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(screen.getByTestId("episode-rotation-on"))
    expect(onChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByTestId("episode-rotation-off"))
    expect(onChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByTestId("episode-rotation-inherit"))
    expect(onChange).toHaveBeenLastCalledWith(null)

    // Explicit values paint the matching pressed state (never two).
    rerender(<ThumbnailRotationSelector value={false} onChange={onChange} />)
    expect(screen.getByTestId("episode-rotation-off")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("episode-rotation-inherit")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("episode-rotation-on")).toHaveAttribute("aria-pressed", "false")
  })

  it("wires the editor per-title override state (null = inherit the space default)", () => {
    function Harness() {
      const ed = usePosterEditor()
      return (
        <>
          <ThumbnailRotationSelector
            value={ed.thumbnailRotationOverride}
            onChange={ed.setThumbnailRotationOverride}
          />
          <span data-testid="override">{String(ed.thumbnailRotationOverride)}</span>
        </>
      )
    }
    renderWithCtx(<Harness />)

    expect(screen.getByTestId("override").textContent).toBe("null")
    fireEvent.click(screen.getByTestId("episode-rotation-on"))
    expect(screen.getByTestId("override").textContent).toBe("true")
    fireEvent.click(screen.getByTestId("episode-rotation-off"))
    expect(screen.getByTestId("override").textContent).toBe("false")
    // Back to inherit: the space default governs again.
    fireEvent.click(screen.getByTestId("episode-rotation-inherit"))
    expect(screen.getByTestId("override").textContent).toBe("null")
  })
})
