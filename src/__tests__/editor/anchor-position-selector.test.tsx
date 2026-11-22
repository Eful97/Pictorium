import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"

vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k }),
}))

const POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const

function renderSel(value: string | null | undefined, onChange = vi.fn()) {
  render(
    <AnchorPositionSelector
      value={value}
      onChange={onChange}
      label="ui.logoAnchor"
      testId="sel-group"
      optionTestPrefix="sel"
    />,
  )
  return onChange
}

describe("AnchorPositionSelector", () => {
  it("renders Auto plus the 9 fixed positions", () => {
    renderSel("auto")
    expect(screen.getByTestId("sel-auto")).toBeInTheDocument()
    for (const pos of POSITIONS) expect(screen.getByTestId(`sel-${pos}`)).toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(10)
    expect(screen.getByTestId("sel-group")).toBeInTheDocument()
  })

  it("presses the button matching the value", () => {
    renderSel("mc")
    expect(screen.getByTestId("sel-mc")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("sel-tl")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("sel-auto")).toHaveAttribute("aria-pressed", "false")
  })

  it("presses Auto for auto and nothing for null", () => {
    const { unmount } = render(
      <AnchorPositionSelector value="auto" onChange={vi.fn()} label="ui.logoAnchor" testId="g" optionTestPrefix="s" />,
    )
    expect(screen.getByTestId("s-auto")).toHaveAttribute("aria-pressed", "true")
    unmount()
    renderSel(null)
    expect(screen.getByTestId("sel-auto")).toHaveAttribute("aria-pressed", "true")
  })

  it("presses nothing for the legacy top value", () => {
    renderSel("top")
    for (const pos of POSITIONS) expect(screen.getByTestId(`sel-${pos}`)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("sel-auto")).toHaveAttribute("aria-pressed", "false")
  })

  it("calls onChange with the clicked position and with auto", () => {
    const onChange = renderSel("auto")
    fireEvent.click(screen.getByTestId("sel-br"))
    expect(onChange).toHaveBeenLastCalledWith("br")
    fireEvent.click(screen.getByTestId("sel-auto"))
    expect(onChange).toHaveBeenLastCalledWith("auto")
  })

  it("moves focus with arrow keys inside the 3x3 grid", () => {
    renderSel("tl")
    const tl = screen.getByTestId("sel-tl")
    tl.focus()
    fireEvent.keyDown(tl, { key: "ArrowRight" })
    expect(screen.getByTestId("sel-tc")).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId("sel-tc"), { key: "ArrowDown" })
    expect(screen.getByTestId("sel-mc")).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId("sel-mc"), { key: "ArrowLeft" })
    expect(screen.getByTestId("sel-ml")).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId("sel-ml"), { key: "ArrowUp" })
    expect(screen.getByTestId("sel-tl")).toHaveFocus()
    // clamped at the edge: no wrap, focus stays
    fireEvent.keyDown(screen.getByTestId("sel-tl"), { key: "ArrowUp" })
    expect(screen.getByTestId("sel-tl")).toHaveFocus()
  })

  it("keeps a single roving tab stop", () => {
    renderSel("mr")
    const stops = POSITIONS.filter((p) => screen.getByTestId(`sel-${p}`).getAttribute("tabindex") === "0")
    expect(stops).toEqual(["mr"])
  })
})
