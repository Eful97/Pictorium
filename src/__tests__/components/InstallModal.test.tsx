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

function openStremioTab() {
  fireEvent.click(screen.getByRole("tab", { name: /stremio/i }))
}

function openAioTab() {
  fireEvent.click(screen.getByRole("tab", { name: /aio/i }))
}

function openNuvioTab() {
  fireEvent.click(screen.getByRole("tab", { name: /nuvio/i }))
}

function templateInput(): HTMLInputElement {
  const activePanel = document.querySelector('[role="tabpanel"]:not([hidden])')
  return activePanel?.querySelector("input[type='text']") as HTMLInputElement
}

function webStremioLink(): HTMLAnchorElement {
  return document.querySelector('a[href*="web.stremio.com"]') as HTMLAnchorElement
}

describe("InstallModal", () => {
  it("shows translated follow mode and keeps fixed settings in advanced options", () => {
    function ControlledModal() {
      const [mode, setMode] = useState<"follow" | "fixed">("follow")
      return (
        <InstallModal
          isOpen={true}
          onClose={vi.fn()}
          manifestUrl="https://pictorium.test/manifest.json"
          hasUserSpace={true}
          linkMode={mode}
          onLinkModeChange={setMode}
          posterUrlPatternAuto={mode === "follow" ? `${AUTO}&live=1` : AUTO}
        />
      )
    }
    renderWithCtx(<ControlledModal />, { t: (key) => (itDict as Record<string, string>)[key] ?? key })
    openAioTab()
    const aioPanel = document.getElementById("install-panel-aio")!
    expect(aioPanel.textContent).toContain("Segui il mio spazio")
    expect(aioPanel.textContent).toContain("Usa le modifiche salvate senza ricopiare il link")
    const advanced = aioPanel.querySelector("details")!
    expect(advanced).not.toHaveAttribute("open")
    expect(templateInput().value).toContain("live=1")
    fireEvent.click(advanced.querySelector("summary")!)
    // Set open explicitly: jsdom does not consistently implement summary's default action.
    advanced.open = true
    const fixed = aioPanel.querySelector("input[type='checkbox']") as HTMLInputElement
    fireEvent.click(fixed)
    expect(fixed).toBeChecked()
    expect(templateInput().value).toBe(AUTO)
    fireEvent.click(fixed)
    expect(fixed).not.toBeChecked()
    expect(templateInput().value).toContain("live=1")
  })

  it("does not render the GitHub star gratification footer", () => {
    renderWithCtx(
      <InstallModal isOpen={true} onClose={vi.fn()} manifestUrl="https://pictorium.test/manifest.json" />
    )

    expect(screen.queryByLabelText("Star Pictorium on GitHub")).not.toBeInTheDocument()
    expect(screen.queryByText("Lascia una stella su GitHub")).not.toBeInTheDocument()
  })

  it("selects the Stremio tab initially", () => {
    renderModal()
    const stremioTab = screen.getByRole("tab", { name: /stremio/i })
    const aioTab = screen.getByRole("tab", { name: /aio/i })
    const nuvioTab = screen.getByRole("tab", { name: /nuvio/i })
    expect(stremioTab).toHaveAttribute("aria-selected", "true")
    expect(aioTab).toHaveAttribute("aria-selected", "false")
    expect(nuvioTab).toHaveAttribute("aria-selected", "false")
    expect(document.getElementById("install-panel-stremio")).not.toHaveAttribute("hidden")
    expect(document.getElementById("install-panel-aio")).toHaveAttribute("hidden")
    expect(document.getElementById("install-panel-nuvio")).toHaveAttribute("hidden")
  })

  it("hides the tabs when no poster templates are available", () => {
    renderWithCtx(
      <InstallModal isOpen={true} onClose={vi.fn()} manifestUrl="https://pictorium.test/manifest.json" />
    )
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument()
    // Il percorso Stremio resta completo: deep link + web link.
    expect(document.querySelector('a[href^="stremio://"]')).toBeInTheDocument()
    expect(webStremioLink()).toBeInTheDocument()
  })

  it("supports arrow-key navigation between tabs", () => {
    renderModal()
    const stremioTab = screen.getByRole("tab", { name: /stremio/i })
    const aioTab = screen.getByRole("tab", { name: /aio/i })
    const nuvioTab = screen.getByRole("tab", { name: /nuvio/i })
    stremioTab.focus()
    fireEvent.keyDown(stremioTab, { key: "ArrowRight" })
    expect(aioTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(aioTab)
    expect(document.getElementById("install-panel-aio")).not.toHaveAttribute("hidden")

    fireEvent.keyDown(aioTab, { key: "ArrowRight" })
    expect(nuvioTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(nuvioTab)
    expect(document.getElementById("install-panel-nuvio")).not.toHaveAttribute("hidden")

    fireEvent.keyDown(nuvioTab, { key: "ArrowLeft" })
    expect(aioTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(aioTab)

    fireEvent.keyDown(aioTab, { key: "Home" })
    expect(stremioTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(stremioTab)

    fireEvent.keyDown(stremioTab, { key: "End" })
    expect(nuvioTab).toHaveAttribute("aria-selected", "true")
    expect(document.activeElement).toBe(nuvioTab)
  })

  it("preserves session selections when switching tabs", () => {
    renderModal()
    // Scheda Stremio: modalità Cataloghi.
    fireEvent.click(screen.getByRole("button", { name: /ui.modeCatalogs/ }))
    // Scheda AIO: ID TMDB.
    openAioTab()
    const selectAio = document.getElementById("install-panel-aio")!.querySelector("select")!
    fireEvent.change(selectAio, { target: { value: "tmdb" } })
    expect(templateInput().value).toBe(TMDB)

    // Scheda Nuvio: conserva ID TMDB e usa il template auto-shape
    openNuvioTab()
    expect(templateInput().value).toBe(NUVIO_TMDB)

    // Torna a Stremio: la modalità è conservata nel link.
    openStremioTab()
    expect(webStremioLink().getAttribute("href")).toContain("mode%3Dcatalogs")

    // Torna ad AIO: ID conservato.
    openAioTab()
    expect(templateInput().value).toBe(TMDB)
  })

  it("copies the manifest link matching the selected mode", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    renderWithCtx(
      <InstallModal isOpen={true} onClose={vi.fn()} manifestUrl="https://pictorium.test/manifest.json" />
    )
    fireEvent.click(screen.getByRole("button", { name: /ui.modeCatalogs/ }))
    fireEvent.click(screen.getByRole("button", { name: /ui.copyManifest/ }))
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("https://pictorium.test/manifest.json?mode=catalogs")
    })
  })

  it("shows the classic auto template by default in AIOMetadata tab", () => {
    renderModal()
    openAioTab()
    const input = templateInput()
    expect(input.value).toBe(AUTO)
    expect(input.value).not.toContain("{shape}")
  })

  it("shows the auto-shape template by default in Nuvio tab", () => {
    renderModal()
    openNuvioTab()
    const input = templateInput()
    expect(input.value).toBe(NUVIO_AUTO)
    expect(input.value).toContain("{shape}")
  })

  it("copies the displayed Nuvio template when clicking copy in Nuvio tab", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    renderModal()
    openNuvioTab()
    const copyBtn = document.getElementById("install-panel-nuvio")!.querySelector("button")!
    fireEvent.click(copyBtn)
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(NUVIO_AUTO)
    })
  })

  it("hides the Nuvio tab and panel when no Nuvio templates are provided", () => {
    renderWithCtx(
      <InstallModal
        isOpen={true}
        onClose={vi.fn()}
        manifestUrl="https://pictorium.test/manifest.json"
        posterUrlPattern={TMDB}
        posterUrlPatternAuto={AUTO}
      />
    )
    expect(screen.getByRole("tab", { name: /stremio/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /aio/i })).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: /nuvio/i })).not.toBeInTheDocument()
    expect(document.getElementById("install-panel-nuvio")).not.toBeInTheDocument()
  })

  it("shows the exact AIOMetadata path in the description", () => {
    renderWithCtx(
      <InstallModal
        isOpen={true}
        onClose={vi.fn()}
        manifestUrl="https://pictorium.test/manifest.json"
        posterUrlPatternAuto={AUTO}
      />,
      { t: (key) => (itDict as Record<string, string>)[key] ?? key }
    )
    openAioTab()
    const aioPanel = document.getElementById("install-panel-aio")!
    expect(aioPanel.textContent).toContain("Art Providers → Poster URL Pattern")
  })
})

