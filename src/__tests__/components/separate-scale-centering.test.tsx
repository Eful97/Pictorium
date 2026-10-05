/**
 * T1 — slider separati centrati + caption esplicative rimosse.
 *
 * - Lo slider scala separati usa range 50..150 (neutro 100 al centro);
 *   i bounds numerici 8..154 restano per l'input manuale (legacy raw
 *   10/200 mai migrati, preservati on read senza auto-clamp).
 * - Le caption visibili `ui.separateRatingsScaleHint` (×3) e
 *   `ui.separateRatingsBarXDisabledHint` (×2) non sono più rese come
 *   testo: resta il tooltip `title` sul wrapper della X disabilitata.
 * - Tenuti: aria-label Scala/X/Y, valori numerici, nomi reset, tooltip.
 * - `SliderRow --pct` segue min/max (clamp visivo 0..100), non più i
 *   bounds: thumb e fill allineati alla posizione nativa del range.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { SliderRow } from "@/components/SliderRow"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { ReactNode } from "react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const SEP_ON = {
  globalBadges: true,
  badgeRating: true,
  separateRatings: true,
}

const DEF_SEP_ON = {
  defaultGlobalBadges: true,
  defaultBadgeRating: true,
  defaultSeparateRatings: true,
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

type RowProps = {
  label: string; value: number; min: number; max: number; boundsMin: number; boundsMax: number
  onChange: (v: number) => void; onDoubleClick: () => void
  editingValue: string | null; editText: string
  setEditingValue: (v: string | null) => void; setEditText: (v: string) => void
  editingKey: string; suffix?: string; icon?: ReactNode
}

function rowProps(over: Partial<RowProps> = {}): RowProps {
  return {
    label: "ui.scale",
    value: 100,
    min: 50,
    max: 150,
    boundsMin: 8,
    boundsMax: 154,
    onChange: vi.fn(),
    onDoubleClick: vi.fn(),
    editingValue: null,
    editText: "",
    setEditingValue: vi.fn(),
    setEditText: vi.fn(),
    editingKey: "separateScale",
    suffix: "%",
    ...over,
  }
}

function pctOf(name: string): string {
  const slider = screen.getByRole("slider", { name })
  return slider.style.getPropertyValue("--pct").trim()
}

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(<>{ui}<Probe /></>)
  return { ctx: () => ctx as PosterEditorCtx }
}

describe("SliderRow --pct segue min/max con clamp visivo", () => {
  it("valore neutro 100 su 50..150 → 50%", () => {
    renderWithCtx(<SliderRow {...rowProps()} />)
    expect(pctOf("ui.scale")).toBe("50%")
  })

  it("X 0 su -100..100 → 50%", () => {
    renderWithCtx(
      <SliderRow {...rowProps({ label: "X", value: 0, min: -100, max: 100, boundsMin: -500, boundsMax: 500, editingKey: "ox", suffix: "px" })} />,
    )
    expect(pctOf("X")).toBe("50%")
  })

  it("legacy sotto range (8) → 0% senza onChange automatico", () => {
    const onChange = vi.fn()
    renderWithCtx(<SliderRow {...rowProps({ value: 8, onChange })} />)
    expect(pctOf("ui.scale")).toBe("0%")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("legacy sopra range (154) → 100% senza onChange automatico", () => {
    const onChange = vi.fn()
    renderWithCtx(<SliderRow {...rowProps({ value: 154, onChange })} />)
    expect(pctOf("ui.scale")).toBe("100%")
  })
})

describe("T1 caption rimosse, a11y tenuta", () => {
  function sepCardControls() {
    const title = screen.getByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })
    const card = title.closest("div.rounded-xl")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("TransformControls: niente caption scala/bar-X, slider 50..150, tooltip tenuto", () => {
    seedDefaults({ ...SEP_ON })
    renderWithCtx(<TransformControls />)
    const card = sepCardControls()
    expect(within(card).queryByText("ui.separateRatingsScaleHint")).not.toBeInTheDocument()
    expect(within(card).queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
    const slider = within(card).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("min")).toBe("50")
    expect(slider.getAttribute("max")).toBe("150")
    // ARIA + numerico + reset tenuti.
    expect(within(card).getByRole("slider", { name: "X" })).toBeInTheDocument()
    expect(within(card).getByRole("slider", { name: "Y" })).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: "ui.reset" })).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: /ui.scale: 100/ })).toBeInTheDocument()
  })

  it("TransformControls barra portrait: tooltip tenuto senza caption", () => {
    seedDefaults({ ...SEP_ON, separateRatingsStyle: "bottom-bar" })
    renderWithCtx(<TransformControls />)
    const card = sepCardControls()
    expect(within(card).queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
    expect(within(card).getByTitle("ui.separateRatingsBarXDisabledHint")).toBeInTheDocument()
  })

  it("TransformPanel default: niente caption, slider 50..150", () => {
    seedDefaults({ ...DEF_SEP_ON })
    renderWithCtx(<TransformPanel active />)
    expect(screen.queryByText("ui.separateRatingsScaleHint")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
    const title = screen.getByText("ui.separateRatings", { exact: true })
    const card = title.closest("div.rounded-xl") as HTMLElement
    const slider = within(card).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("min")).toBe("50")
    expect(slider.getAttribute("max")).toBe("150")
  })

  it("Orizzontale: niente caption, slider 50..150", () => {
    seedDefaults({ ...DEF_SEP_ON })
    renderWithCtx(<TransformPanel active />)
    fireEvent.click(screen.getByText("ui.posterShapeLandscape"))
    expect(screen.queryByText("ui.separateRatingsScaleHint")).not.toBeInTheDocument()
    const title = screen.getByText("ui.separateRatings", { exact: true })
    const card = title.closest("div.space-y-1\\.5") as HTMLElement
    const slider = within(card).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("min")).toBe("50")
    expect(slider.getAttribute("max")).toBe("150")
  })
})

describe("T1 legacy raw preservati on read", () => {
  function sepCardControls() {
    const title = screen.getByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })
    const card = title.closest("div.rounded-xl")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("raw legacy 10 → UI 8 mostrato raw, stato intatto", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 10 })
    const { ctx } = renderWithProbe(<TransformControls />)
    expect(within(sepCardControls()).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("8%")
    expect(ctx().separateBadgeScale).toBe(10)
  })

  it("raw legacy 200 → UI 154 mostrato raw, stato intatto", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 200 })
    const { ctx } = renderWithProbe(<TransformControls />)
    expect(within(sepCardControls()).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("154%")
    expect(ctx().separateBadgeScale).toBe(200)
  })
})
