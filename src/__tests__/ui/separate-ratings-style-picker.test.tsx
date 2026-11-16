import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SeparateRatingsStylePicker } from "@/components/ui/SeparateRatingsStylePicker"

const t = (k: string) => k

describe("SeparateRatingsStylePicker", () => {
  it("groups by position; Notch is one tile that opens its materials", () => {
    const onChange = vi.fn()
    const { container } = render(<SeparateRatingsStylePicker value="column" landscape={false} onChange={onChange} t={t} />)
    // Colonna: pill, anelli (radio) + una sola tile Notch; nessuna riga materiali finché non si sceglie.
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    expect(screen.queryByTestId("sep-style-variants")).toBeNull()
    fireEvent.click(screen.getByText("ui.notch"))
    expect(onChange).toHaveBeenLastCalledWith("column-notch-crema")
    const variants = screen.getByTestId("sep-style-variants")
    expect(variants.querySelectorAll('[role="radio"] img')).toHaveLength(4)
    fireEvent.click(screen.getByText("ui.notchVetro"))
    expect(onChange).toHaveBeenLastCalledWith("column-notch-vetro")
    expect(container.querySelectorAll('[aria-pressed="true"]').length).toBeGreaterThan(0)
  })

  it("an active notch value shows the bottom materials with the right one checked", () => {
    render(<SeparateRatingsStylePicker value="notch-vetro" landscape={false} onChange={vi.fn()} t={t} />)
    const variants = screen.getByTestId("sep-style-variants")
    const checked = variants.querySelector('[aria-checked="true"]')
    expect(checked?.textContent).toBe("ui.notchVetro")
    // In basso: barra, pill, monocolore, icone colorate + 4 materiali.
    expect(screen.getAllByRole("radio")).toHaveLength(8)
  })
})
