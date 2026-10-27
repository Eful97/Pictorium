import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { renderWithCtx } from "../test-utils"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"

/**
 * Desktop global-settings preview compact contract (Impostazioni globali):
 * title search sits DIRECTLY BELOW the poster in the same DOM order
 * (keyboard/AT order matches visual order, no flex-order swaps), the redundant
 * explanations are gone (hint + global desc) while the demo-data caution,
 * loading/error/retry/zoom status paths stay intact, and the mobile
 * compact + floating branches are byte-identical in behavior.
 */

/** Transport-level fake XHR: serves the real preview blob path in jsdom. */
class FakeXHR {
  static urls: string[] = []
  static status = 200
  status = FakeXHR.status
  response: Blob | null = null
  responseType = ""
  timeout = 0
  onprogress: ((e: never) => void) | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(_method: string, url: string) {
    FakeXHR.urls.push(url)
  }
  send() {
    queueMicrotask(() => {
      this.response = new Blob(["fake-poster"], { type: "image/png" })
      this.onload?.()
    })
  }
  abort() {}
}

const SEARCH_RESULTS = [
  {
    id: 1399,
    media_type: "tv",
    name: "La casa di carta",
    poster_path: "/casa.jpg",
    first_air_date: "2017-05-02",
    vote_average: 8.2,
  },
]

const okResponse = (results: unknown[]) =>
  new Response(JSON.stringify({ results, total_results: results.length, total_pages: 1 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

function stubTransport() {
  FakeXHR.urls = []
  FakeXHR.status = 200
  let blobN = 0
  vi.stubGlobal("XMLHttpRequest", FakeXHR)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:fake-${++blobN}`),
    revokeObjectURL: vi.fn(),
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes("/api/tmdb/search")) return okResponse(SEARCH_RESULTS)
      return new Response("not found", { status: 404 })
    }),
  )
}

function Host({ shape }: { shape: "portrait" | "landscape" }) {
  const [demoMedia, setDemoMedia] = useState<DefaultsPreviewDemoMedia | null>(null)
  return <DefaultsPosterPreview previewShape={shape} demoMedia={demoMedia} onDemoMediaChange={setDemoMedia} />
}

describe("desktop global preview compact layout", () => {
  beforeEach(() => {
    stubTransport()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("portrait: search directly below the poster in DOM order with clutter removed and caution kept", async () => {
    renderWithCtx(<Host shape="portrait" />)
    await screen.findByAltText("Avatar")

    // Always-open desktop search, no mobile toggle.
    const search = screen.getByTestId("defaults-preview-title-search")
    expect(screen.queryByTestId("defaults-preview-search-toggle")).toBeNull()
    expect(within(search).getByRole("textbox")).toBeInTheDocument()

    // DOM order matches visual order: poster BEFORE the search (no
    // flex-order swaps, so keyboard/AT order follows the visual layout).
    const media = screen.getByTestId("defaults-preview-media")
    expect(media.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Redundant desktop explanations are gone…
    expect(screen.queryByText("ui.previewEditingHint")).toBeNull()
    expect(screen.queryByText("ui.settingsGlobalDesc")).toBeNull()
    // …while the header, editing chip (hint kept as its tooltip),
    // demo-data caution and ratio bounds stay.
    expect(screen.getByText("ui.defaultsPreviewTitle")).toBeInTheDocument()
    const chip = screen.getByTestId("defaults-preview-editing")
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveAttribute("title", "ui.previewEditingHint")
    expect(screen.getByText("ui.defaultsPreviewSamplesNotice")).toBeInTheDocument()
    expect(media.className).toContain("aspect-[2/3]")
    // Bounded on both axes: full poster fits the remaining column height
    // (no vertical overflow), with a visually useful floor (no 1px shrink).
    expect(media.className).toContain("max-h-[calc(88dvh_-_493px)]")
    expect(media.className).toContain("min-h-[120px]")
    expect(media.className).toContain("max-w-[min(100%,calc((88dvh_-_493px)*0.667))]")
  })

  it("landscape: same poster-first order with 16/9 bounds", async () => {
    renderWithCtx(<Host shape="landscape" />)
    await screen.findByAltText("Avatar")
    const search = screen.getByTestId("defaults-preview-title-search")
    const media = screen.getByTestId("defaults-preview-media")
    expect(media.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(media.className).toContain("aspect-video")
    expect(media.className).toContain("max-h-[calc(88dvh_-_493px)]")
    expect(media.className).toContain("min-h-[90px]")
    expect(screen.queryByText("ui.previewEditingHint")).toBeNull()
    expect(screen.queryByText("ui.settingsGlobalDesc")).toBeNull()
    expect(screen.getByText("ui.defaultsPreviewSamplesNotice")).toBeInTheDocument()
  })

  it("selecting a title rebuilds the real preview URL with no new query names", async () => {
    const user = userEvent.setup()
    renderWithCtx(<Host shape="portrait" />)
    await screen.findByAltText("Avatar")

    await user.type(screen.getByRole("textbox"), "casa di carta")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await user.click(await screen.findByRole("option", { name: /La casa di carta/ }))

    await waitFor(() => {
      expect(FakeXHR.urls.some((u) => u.includes("/api/poster/tv/1399"))).toBe(true)
    })
    const tvUrl = FakeXHR.urls.find((u) => u.includes("/api/poster/tv/1399"))!
    expect(tvUrl).toContain("preview=1")
    expect(await screen.findByAltText("La casa di carta")).toBeInTheDocument()
  })

  it("zoom + error/retry status paths stay intact", async () => {
    const user = userEvent.setup()
    renderWithCtx(<Host shape="portrait" />)
    await screen.findByAltText("Avatar")

    // The enlarged surface is the editor: it closes through its explicit
    // control (clicking the poster never closes it, so no gesture is lost).
    await user.click(screen.getByLabelText("ui.defaultsPreviewZoomOpen"))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByAltText("Avatar")).toBeInTheDocument()
    await user.click(within(dialog).getByTestId("defaults-preview-badge-edit-close"))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })

  it("failed poster load keeps the error copy with retry", async () => {
    FakeXHR.status = 500
    renderWithCtx(<Host shape="portrait" />)
    await screen.findByText("ui.posterLoadError")
    // `ui.retry` resolves to real Italian via the setup mock dictionary.
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument()
  })
})

describe("desktop compact change leaves mobile branches untouched", () => {
  beforeEach(() => {
    stubTransport()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("compact keeps the collapsed search toggle and drops the demo notice", async () => {
    renderWithCtx(<DefaultsPosterPreview compact previewShape="portrait" />)
    const media = await screen.findByTestId("defaults-preview-media")
    expect(media.className).toContain("aspect-[2/3]")
    expect(screen.getByTestId("defaults-preview-search-toggle")).toBeInTheDocument()
    expect(screen.queryByText("ui.defaultsPreviewSamplesNotice")).toBeNull()
  })

  it("floating keeps the pure thumbnail with no search chrome", async () => {
    renderWithCtx(<DefaultsPosterPreview floating previewShape="portrait" />)
    const media = await screen.findByTestId("defaults-preview-media")
    expect(media.className).toContain("aspect-[2/3]")
    expect(screen.queryByTestId("defaults-preview-title-search")).toBeNull()
    expect(screen.queryByTestId("defaults-preview-editing")).toBeNull()
    // Zoom control appears once the blob resolves (debounced URL + XHR).
    expect(await screen.findByTestId("defaults-preview-zoom-open")).toBeInTheDocument()
  })
})
