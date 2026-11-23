import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LangPicker } from "@/components/LangPicker"
import { PrefsPanel } from "@/components/settings/PrefsPanel"
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
  it("puts selectable global rankings first in the preferences dropdown", async () => {
    const user = userEvent.setup()
    renderWithCtx(<PrefsPanel active />)
    const select = screen.getByRole("combobox", { name: "ui.region" }) as HTMLSelectElement
    expect(select.options[0].value).toBe("GLOBAL")
    expect(select.options[0].textContent).toContain("ui.regionGlobal")
    await user.selectOptions(select, "GLOBAL")
    expect(select.value).toBe("GLOBAL")
  })

  it("mostra le lingue UI al passo lingua", () => {
    renderWizard()
    // 19 voci lingua UI (incl. Español (Latinoamérica), Português (Portugal),
    // Português (Brasil) e Tiếng Việt, senza regione chart) + tasto back assente al passo 1
    expect(screen.getByText("Italiano")).toBeInTheDocument()
    expect(screen.getByText("English")).toBeInTheDocument()
    expect(screen.getByText("Español (Latinoamérica)")).toBeInTheDocument()
    expect(screen.getByText("Português (Portugal)")).toBeInTheDocument()
    expect(screen.getByText("Português (Brasil)")).toBeInTheDocument()
    expect(screen.getByText("Tiếng Việt")).toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(19)
    // Lo step lingua non accoppia più paese e lingua (vi non ha regione chart)
    expect(screen.queryByText("USA · English")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.back")).not.toBeInTheDocument()
  })

  it("seleziona es-419 come lingua UI latinoamericana", async () => {
    const user = userEvent.setup()
    const { onPickLang } = renderWizard()

    await user.click(screen.getByText("Español (Latinoamérica)"))
    expect(onPickLang).toHaveBeenCalledWith("es-419")
    // Passo regione: il Messico resta una scelta paese separata (non tutta LatAm)
    expect(screen.getByText("Messico")).toBeInTheDocument()
  })

  it("passa alla scelta del paese dopo la lingua e completa", async () => {
    const user = userEvent.setup()
    const { onPickLang, onPickRegion, onDone } = renderWizard()

    await user.click(screen.getByText("English"))
    expect(onPickLang).toHaveBeenCalledWith("en")
    // Passo regione: titolo tradotto (mock) + voci paese, senza doppioni lingua
    expect(screen.getByText("ui.setupRegionTitle")).toBeInTheDocument()
    expect(screen.getByText("Italia")).toBeInTheDocument()
    expect(screen.queryByText("USA · English")).not.toBeInTheDocument()

    await user.click(screen.getByText("Giappone"))
    expect(onPickRegion).toHaveBeenCalledWith("JP")
    expect(screen.getByText("Proteggi il tuo pannello")).toBeInTheDocument()

    await user.click(screen.getByText("Salta questo passaggio"))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("offers global charts first at the region step", async () => {
    const user = userEvent.setup()
    const { onPickRegion } = renderWizard()
    await user.click(screen.getByText("Tiếng Việt"))
    const global = screen.getByRole("button", { name: /ui.regionGlobal/ })
    const regionButtons = screen.getAllByRole("button").filter((button) => button.textContent?.includes("GLOBAL") || button.textContent?.includes("Italia"))
    expect(regionButtons[0]).toBe(global)
    await user.click(global)
    expect(onPickRegion).toHaveBeenCalledWith("GLOBAL")
  })

  it("il tasto indietro torna alla lingua senza completare", async () => {
    const user = userEvent.setup()
    const { onPickLang, onPickRegion, onDone } = renderWizard()

    await user.click(screen.getByText("Français"))
    expect(onPickLang).toHaveBeenCalledWith("fr")
    await user.click(screen.getByText("Indietro"))
    expect(screen.getByText("Italiano")).toBeInTheDocument()
    expect(screen.getByText("Tiếng Việt")).toBeInTheDocument()
    expect(onPickRegion).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("il tasto indietro dal PIN torna alla regione", async () => {
    const user = userEvent.setup()
    const { onDone } = renderWizard()

    await user.click(screen.getByText("English"))
    await user.click(screen.getByText("Italia"))
    expect(screen.getByText("Proteggi il tuo pannello")).toBeInTheDocument()

    await user.click(screen.getByText("Indietro"))
    expect(screen.getByText("ui.setupRegionTitle")).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("salta il passaggio del PIN quando skipPin=true (es. multi-user)", async () => {
    const user = userEvent.setup()
    const onPickLang = vi.fn()
    const onPickRegion = vi.fn()
    const onDone = vi.fn()
    renderWithCtx(
      <LangPicker onPickLang={onPickLang} onPickRegion={onPickRegion} onDone={onDone} skipPin={true} />
    )

    await user.click(screen.getByText("English"))
    expect(onPickLang).toHaveBeenCalledWith("en")

    await user.click(screen.getByText("Giappone"))
    expect(onPickRegion).toHaveBeenCalledWith("JP")
    expect(screen.queryByText("Proteggi il tuo pannello")).not.toBeInTheDocument()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
  describe("passo guida finale (checklist)", () => {
    function renderWithChecklist(skipPin = true) {
      const onDone = vi.fn()
      const checklist = {
        hasKey: false,
        hasSavedPoster: false,
        installOpened: false,
        onInstall: vi.fn(),
        onCustomize: vi.fn(),
        onOpenKeySettings: vi.fn(),
        onSkip: vi.fn(),
      }
      renderWithCtx(
        <LangPicker onPickLang={vi.fn()} onPickRegion={vi.fn()} onDone={onDone} skipPin={skipPin} checklist={checklist} />
      )
      return { onDone, checklist }
    }

    it("dopo la regione mostra la guida invece di chiudere il wizard", async () => {
      const user = userEvent.setup()
      const { onDone } = renderWithChecklist()
      await user.click(screen.getByText("English"))
      await user.click(screen.getByText("Giappone"))
      expect(onDone).not.toHaveBeenCalled()
      expect(screen.getByTestId("onboarding-checklist")).toBeInTheDocument()
      expect(screen.getByTestId("onboarding-path-install")).toBeInTheDocument()
      // Nessun "indietro" su questo passo: il PIN è già stato gestito.
      expect(screen.queryByText("Indietro")).not.toBeInTheDocument()
    })

    it("dopo il PIN saltato mostra la guida e i pulsanti delegano al chiamante", async () => {
      const user = userEvent.setup()
      const { onDone, checklist } = renderWithChecklist(false)
      await user.click(screen.getByText("English"))
      await user.click(screen.getByText("Italia"))
      await user.click(screen.getByText("Salta questo passaggio"))
      expect(onDone).not.toHaveBeenCalled()

      await user.click(screen.getByTestId("onboarding-path-install"))
      expect(checklist.onInstall).toHaveBeenCalledTimes(1)
      await user.click(screen.getByTestId("onboarding-path-customize"))
      expect(checklist.onCustomize).toHaveBeenCalledTimes(1)
      await user.click(screen.getByTestId("onboarding-open-key-settings"))
      expect(checklist.onOpenKeySettings).toHaveBeenCalledTimes(1)
      await user.click(screen.getByTestId("onboarding-skip"))
      expect(checklist.onSkip).toHaveBeenCalledTimes(1)
      // Il wizard non chiama mai onDone da solo su questo passo.
      expect(onDone).not.toHaveBeenCalled()
    })
  })
})
