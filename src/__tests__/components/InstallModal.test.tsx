import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
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
    fireEvent.click(screen.getByRole("checkbox"))
    expect(templateInput().value).toBe(NUVIO_AUTO)

    fireEvent.change(screen.getByLabelText("ID:"), { target: { value: "tmdb" } })
    expect(templateInput().value).toBe(NUVIO_TMDB)

    fireEvent.change(screen.getByLabelText("ID:"), { target: { value: "imdb" } })
    expect(templateInput().value).toBe(NUVIO_IMDB)
  })

  it("unchecking restores the classic template", () => {
    renderModal()
    const checkbox = screen.getByRole("checkbox")
    fireEvent.click(checkbox)
    expect(templateInput().value).toBe(NUVIO_AUTO)
    fireEvent.click(checkbox)
    expect(templateInput().value).toBe(AUTO)
  })

  it("copy button copies the displayed nuvio template", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } })
    renderModal()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Copia URL" }))
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(NUVIO_AUTO)
    })
  })
})
