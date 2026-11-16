import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SeparateRatingsStylePicker } from "@/components/ui/SeparateRatingsStylePicker"

const t = (k: string) => k

describe("SeparateRatingsStylePicker", () => {
  it("groups by position, previews every variant, notch materials on their own row", () => {
    const onChange = vi.fn()
    const { container } = render(<SeparateRatingsStylePicker value="column" landscape={false} onChange={onChange} t={t} />)
    // Colonna: pill, anelli + 4 linguette (ognuna con anteprima).
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(6)
    expect(container.querySelectorAll('[role="radio"] img')).toHaveLength(4)
    expect(screen.getByText("ui.notch")).toBeTruthy()
    fireEvent.click(screen.getAllByText("ui.notchCrema")[0])
    expect(onChange).toHaveBeenLastCalledWith("column-notch-crema")
  })

  it("bottom family keeps the gradino materials", () => {
    const onChange = vi.fn()
    render(<SeparateRatingsStylePicker value="notch-vetro" landscape={false} onChange={onChange} t={t} />)
    expect(screen.getAllByRole("radio")).toHaveLength(8)
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")
    expect(checked?.textContent).toBe("ui.notchVetro")
  })
})
