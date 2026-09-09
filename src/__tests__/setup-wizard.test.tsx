import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LangPicker } from "@/components/LangPicker"
import { renderWithCtx } from "@/__tests__/test-utils"

function renderWizard() {
  const onPickLang = vi.fn()
  const onPickRegion = vi.fn()
  const onDone = vi.fn()
  renderWithCtx(
    <LangPicker onPickLang={onPickLang} onPickRegion={onPickRegion} onDone={onDone} />
  )
  return { onPickLang, onPickRegion, onDone }
}

describe("SetupWizard", () => {
  it("mostra le 13 nazionalita al passo lingua", () => {
    renderWizard()
    // 13 voci lingua (una per nazionalita) + tasto back assente al passo 1
    expect(screen.getByText("Italia · Italiano")).toBeInTheDocument()
    expect(screen.getByText("USA · English")).toBeInTheDocument()
    expect(screen.getByText("Messico · Español (México)")).toBeInTheDocument()
    expect(screen.getByText("Giappone · 日本語")).toBeInTheDocument()
    expect(screen.queryByText("ui.back")).not.toBeInTheDocument()
  })

  it("passa alla scelta del paese dopo la lingua e completa", async () => {
    const user = userEvent.setup()
    const { onPickLang, onPickRegion, onDone } = renderWizard()

    await user.click(screen.getByText("USA · English"))
    expect(onPickLang).toHaveBeenCalledWith("en")
    // Passo regione: titolo tradotto (mock) + voci paese, senza doppioni lingua
    expect(screen.getByText("ui.setupRegionTitle")).toBeInTheDocument()
    expect(screen.getByText("Italia")).toBeInTheDocument()
    expect(screen.queryByText("USA · English")).not.toBeInTheDocument()

    await user.click(screen.getByText("Giappone"))
    expect(onPickRegion).toHaveBeenCalledWith("JP")
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("il tasto indietro torna alla lingua senza completare", async () => {
    const user = userEvent.setup()
    const { onPickLang, onPickRegion, onDone } = renderWizard()

    await user.click(screen.getByText("Francia · Français"))
    expect(onPickLang).toHaveBeenCalledWith("fr")
    await user.click(screen.getByText("Indietro"))
    expect(screen.getByText("Italia · Italiano")).toBeInTheDocument()
    expect(onPickRegion).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
