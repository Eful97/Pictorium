import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

/**
 * Select-all must respect the 8-mark write-boundary cap: a vendored pack can
 * push the option list past `MAX_QUALITY_MARKS`, and emitting every option
 * would be truncated server-side (client/server desync). The shipped pack is
 * empty, so this file mocks a synthetic pack to reach the capped state.
 */
const fakePack = vi.hoisted(() => ({
  version: "test",
  source: "test",
  marks: ["packa", "packb", "packc", "packd", "packe", "packf"].map((id) => ({
    id,
    label: id.toUpperCase(),
    icon: `quality-badges/pack/${id}.svg`,
    mode: "opaque",
    aspect: 2,
  })),
}))

vi.mock("@/data/quality-badge-pack.json", () => ({ default: fakePack }))

import { VideoFormatSelector } from "@/components/ui"
import { MAX_QUALITY_MARKS, QUALITY_MARK_OPTIONS } from "@/lib/quality-badge-pack"

describe("VideoFormatSelector cap", () => {
  it("select-all emits at most MAX_QUALITY_MARKS ids in option order", () => {
    expect(QUALITY_MARK_OPTIONS.length).toBeGreaterThan(MAX_QUALITY_MARKS)
    const onChange = vi.fn()
    render(<VideoFormatSelector selectedFormats={[]} onChange={onChange} t={(k) => k} />)

    fireEvent.click(screen.getByRole("button", { name: /formatsAll/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const emitted = onChange.mock.calls[0][0] as string[]
    expect(emitted).toHaveLength(MAX_QUALITY_MARKS)
    expect(emitted).toEqual(QUALITY_MARK_OPTIONS.slice(0, MAX_QUALITY_MARKS).map((opt) => opt.id))
  })

  it("advertises the cap when the option list exceeds it", () => {
    render(<VideoFormatSelector selectedFormats={[]} onChange={vi.fn()} t={(k) => k} />)
    const all = screen.getByRole("button", { name: /formatsAll/ })
    expect(all.textContent).toContain(String(MAX_QUALITY_MARKS))
  })
})
