import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import itDict from "@/lib/translations/it.json"
import { InstallModal } from "@/components/InstallModal"
import { renderWithCtx } from "@/__tests__/test-utils"

const TMDB = "https://pictorium.test/api/poster/{type}/{tmdb_id}?lang=it&rv=1"
const IMDB = "https://pictorium.test/api/poster/{type}/{imdb_id}?lang=it&rv=1"
const AUTO = "https://pictorium.test/api/poster/{type}/{tmdb_id|imdb_id}?lang=it&rv=1"
const NUVIO_TMDB = "https://pictorium.test/api/poster/{type}/{tmdb_id}?lang=it&rv=1&shape={shape}"
const NUVIO_IMDB = "https://pictorium.test/api/poster/{type}/{imdb_id}?lang=it&rv=1&shape={shape}"
const NUVIO_AUTO = "https://pictorium.test/api/poster/{type}/{tmdb_id|imdb_id}?lang=it&rv=1&shape={shape}"

function renderModal() {
  renderWithCtx(
    <InstallModal
      isOpen={true}
      onClose={vi.fn()}
      manifestUrl="https://pictorium.test/manifest.json"
      posterUrlPattern={TMDB}
      posterUrlPatternImdb={IMDB}
      posterUrlPatternAuto={AUTO}
      posterUrlPatternNuvio={NUVIO_TMDB}
      posterUrlPatternNuvioImdb={NUVIO_IMDB}
      posterUrlPatternNuvioAuto={NUVIO_AUTO}
    />
  )
}

function templateInput(): HTMLInputElement {
  // PatternRow: input readonly con aria-label = copyLabel (ui.aiomLinkTitle).
  return screen.getByLabelText("Link per AIO e custom URL:") as HTMLInputElement
}

describe("InstallModal", () => {
  it("shows translated follow mode and keeps fixed settings in advanced options", () => {
    function ControlledModal() {
      const [mode, setMode] = useState<"follow" | "fixed">("follow")
      return <InstallModal isOpen={true} onClose={vi.fn()} manifestUrl="https://pictorium.test/manifest.json" hasUserSpace={true} linkMode={mode} onLinkModeChange={setMode} posterUrlPatternAuto={mode === "follow" ? `${AUTO}&live=1` : AUTO} />
    }
    renderWithCtx(<ControlledModal />, { t: (key) => (itDict as Record<string, string>)[key] ?? key })
    expect(screen.getByText("Segui il mio spazio")).toBeInTheDocument()
    expect(screen.getByText("Usa le modifiche salvate senza ricopiare il link")).toBeInTheDocument()
    const advanced = screen.getByText("Opzioni avanzate").closest("details")!
    expect(advanced).not.toHaveAttribute("open")
    expect(templateInput().value).toContain("live=1")
    fireEvent.click(screen.getByText("Opzioni avanzate"))
    // Set open explicitly: jsdom does not consistently implement summary's default action.
    advanced.open = true
    const fixed = screen.getByRole("checkbox", { name: "Impostazioni fisse nel link" })
    fireEvent.click(fixed)
    expect(fixed).toBeChecked()
    expect(templateInput().value).toBe(AUTO)
    fireEvent.click(fixed)
    expect(fixed).not.toBeChecked()
    expect(templateInput().value).toContain("live=1")
  })

  it("renders GitHub star gratification footer when open", () => {
    renderWithCtx(
      <InstallModal isOpen={true} onClose={vi.fn()} manifestUrl="https://pictorium.test/manifest.json" />
    )

    const starLink = screen.getByLabelText("Star Pictorium on GitHub")
    expect(starLink).toBeInTheDocument()
    expect(starLink).toHaveAttribute("href", "https://github.com/Eful97/Pictorium")
    expect(screen.getByText("Lascia una stella su GitHub")).toBeInTheDocument()
  })

  it("shows the classic auto template by default (no shape placeholder)", () => {
    renderModal()
    const input = templateInput()
    expect(input.value).toBe(AUTO)
    expect(input.value).not.toContain("{shape}")
  })

  it("nuvio checkbox combines the selected ID template with shape={shape}", () => {
    renderModal()
    fireEvent.click(screen.getByRole("checkbox", { name: /ui.patternNuvio/ }))
    expect(templateInput().value).toBe(NUVIO_AUTO)

    fireEvent.change(screen.getByLabelText("ID:"), { target: { value: "tmdb" } })
    expect(templateInput().value).toBe(NUVIO_TMDB)

    fireEvent.change(screen.getByLabelText("ID:"), { target: { value: "imdb" } })
    expect(templateInput().value).toBe(NUVIO_IMDB)
  })

  it("unchecking restores the classic template", () => {
    renderModal()
    const checkbox = screen.getByRole("checkbox", { name: /ui.patternNuvio/ })
    fireEvent.click(checkbox)
    expect(templateInput().value).toBe(NUVIO_AUTO)
    fireEvent.click(checkbox)
    expect(templateInput().value).toBe(AUTO)
  })

  it("copy button copies the displayed nuvio template", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    renderModal()
    fireEvent.click(screen.getByRole("checkbox", { name: /ui.patternNuvio/ }))
    fireEvent.click(screen.getByRole("button", { name: "Copia URL" }))
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(NUVIO_AUTO)
    })
  })
})
