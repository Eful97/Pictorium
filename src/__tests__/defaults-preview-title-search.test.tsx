import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, useEffect } from "react"
import { renderWithCtx } from "./test-utils"
import { buildDefaultsPreviewUrl, DEFAULTS_PREVIEW_DEMO_MEDIA, type DefaultsPreviewDemoMedia } from "@/lib/poster-url"
import { RENDER_VERSION } from "@/lib/render-version"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { DefaultsPreviewTitleSearch } from "@/components/settings/DefaultsPreviewTitleSearch"

describe("buildDefaultsPreviewUrl demoMedia (preview-only)", () => {
  it("keeps the Avatar demo endpoint byte-identical without demoMedia", () => {
    const url = buildDefaultsPreviewUrl({})
    expect(url).toContain(`/api/poster/${DEFAULTS_PREVIEW_DEMO_MEDIA.mediaType}/${DEFAULTS_PREVIEW_DEMO_MEDIA.id}`)
    expect(url).toContain(`rv=${RENDER_VERSION}`)
    expect(url).toContain("preview=1")
  })

  it("switches only the path for a tv demo title, with no new query names", () => {
    const demo: DefaultsPreviewDemoMedia = { mediaType: "tv", id: 1399, title: "La casa di carta" }
    const url = new URL(buildDefaultsPreviewUrl({ demoMedia: demo }), "http://localhost")
    expect(url.pathname).toBe("/api/poster/tv/1399")
    expect(url.searchParams.get("preview")).toBe("1")
    expect(url.searchParams.get("rv")).toBe(RENDER_VERSION)
    expect(url.search).not.toContain("demoMedia")
    expect(url.search).not.toContain("1399")
    expect(url.search).not.toContain(encodeURIComponent("La casa di carta"))
  })

  it("falls back to Avatar on invalid demoMedia", () => {
    const fallback = `/api/poster/${DEFAULTS_PREVIEW_DEMO_MEDIA.mediaType}/${DEFAULTS_PREVIEW_DEMO_MEDIA.id}`
    expect(buildDefaultsPreviewUrl({ demoMedia: null })).toContain(fallback)
    expect(buildDefaultsPreviewUrl({ demoMedia: { mediaType: "tv", id: 0 } })).toContain(fallback)
    expect(buildDefaultsPreviewUrl({ demoMedia: { mediaType: "tv", id: -5 } })).toContain(fallback)
    expect(buildDefaultsPreviewUrl({ demoMedia: { mediaType: "movie", id: NaN } })).toContain(fallback)
    expect(
      buildDefaultsPreviewUrl({ demoMedia: { mediaType: "weird", id: 1399 } as never }),
    ).toContain(fallback)
  })
})

/** Transport-level fake XHR: captures the real poster URLs emitted. */
class FakeXHR {
  static urls: string[] = []
  status = 200
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

function Host() {
  const [demoMedia, setDemoMedia] = useState<DefaultsPreviewDemoMedia | null>(null)
  return <DefaultsPosterPreview demoMedia={demoMedia} onDemoMediaChange={setDemoMedia} />
}

/**
 * Parent with its own bubble Escape listener, mirroring the desktop settings
 * dialog hook: closing the zoom must not close the parent.
 */
function NestedHost() {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  if (!open) return <p>parent closed</p>
  return <Host />
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
  {
    id: 19995,
    media_type: "movie",
    title: "Avatar",
    poster_path: "/avatar.jpg",
    release_date: "2009-12-10",
    vote_average: 7.6,
  },
]

const B_RESULTS = [
  {
    id: 11,
    media_type: "movie",
    title: "Abc Film",
    poster_path: "/abc.jpg",
    release_date: "2020-01-01",
    vote_average: 6.1,
  },
]

const okResponse = (results: unknown[]) =>
  new Response(JSON.stringify({ results, total_results: results.length, total_pages: 1 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let searchImpl: (q: string) => Promise<Response>

describe("DefaultsPreviewTitleSearch isolation (transport mocks, real logic)", () => {
  beforeEach(() => {
    searchImpl = () => Promise.resolve(okResponse(SEARCH_RESULTS))
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes("/api/tmdb/search")) {
          const q = new URL(url, "http://localhost").searchParams.get("q") ?? ""
          return searchImpl(q)
        }
        return new Response("not found", { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderSearch(props?: { language?: string }) {
    const onDemoMediaChange = vi.fn()
    renderWithCtx(
      <DefaultsPreviewTitleSearch
        tmdbKey="test-key"
        hasServerKey={false}
        language={props?.language ?? "it-IT"}
        demoMedia={null}
        onDemoMediaChange={onDemoMediaChange}
      />,
    )
    return { onDemoMediaChange }
  }

  it("selects a tv title with the typed id/type and no loader or false empty", async () => {
    const user = userEvent.setup()
    const { onDemoMediaChange } = renderSearch()
    await user.type(screen.getByRole("textbox"), "casa di carta")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await user.click(await screen.findByRole("option", { name: /La casa di carta/ }))
    expect(onDemoMediaChange).toHaveBeenCalledWith({
      mediaType: "tv",
      id: 1399,
      title: "La casa di carta",
    })
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByText("ui.noResults")).toBeNull()
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("ignores out-of-order responses: the latest query wins", async () => {
    const user = userEvent.setup()
    const gate = deferred<Response>()
    let calls = 0
    searchImpl = () => {
      calls += 1
      return calls === 1 ? gate.promise : Promise.resolve(okResponse(B_RESULTS))
    }
    renderSearch()
    await user.type(screen.getByRole("textbox"), "ab")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1))
    await user.clear(screen.getByRole("textbox"))
    await user.type(screen.getByRole("textbox"), "abc")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await screen.findByRole("option", { name: /Abc Film/ })
    gate.resolve(okResponse(SEARCH_RESULTS))
    await waitFor(() => expect(screen.queryByRole("option", { name: /La casa di carta/ })).toBeNull())
    expect(screen.getByRole("option", { name: /Abc Film/ })).toBeInTheDocument()
  })

  it("clearing below 2 chars drops the pending request without repopulating", async () => {
    const user = userEvent.setup()
    const gate = deferred<Response>()
    searchImpl = () => gate.promise
    renderSearch()
    await user.type(screen.getByRole("textbox"), "casa")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeNull())
    await user.clear(screen.getByRole("textbox"))
    await user.type(screen.getByRole("textbox"), "c")
    gate.resolve(okResponse(SEARCH_RESULTS))
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.queryByText("ui.noResults")).toBeNull()
    expect(screen.queryByRole("option")).toBeNull()
  })

  it("auth/language switch invalidates the in-flight request", async () => {
    const user = userEvent.setup()
    const gate = deferred<Response>()
    searchImpl = () => gate.promise
    const onDemoMediaChange = vi.fn()
    const { rerender } = renderWithCtx(
      <DefaultsPreviewTitleSearch
        tmdbKey="test-key"
        hasServerKey={false}
        language="it-IT"
        demoMedia={null}
        onDemoMediaChange={onDemoMediaChange}
      />,
    )
    await user.type(screen.getByRole("textbox"), "casa")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeNull())
    rerender(
      <DefaultsPreviewTitleSearch
        tmdbKey="test-key"
        hasServerKey={false}
        language="en-US"
        demoMedia={null}
        onDemoMediaChange={onDemoMediaChange}
      />,
    )
    gate.resolve(okResponse(SEARCH_RESULTS))
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onDemoMediaChange).not.toHaveBeenCalled()
  })

  it("shows the error with retry and recovers on retry", async () => {
    const user = userEvent.setup()
    let calls = 0
    searchImpl = () => {
      calls += 1
      return Promise.resolve(
        calls === 1 ? new Response("bad", { status: 400 }) : okResponse(SEARCH_RESULTS),
      )
    }
    renderSearch()
    await user.type(screen.getByRole("textbox"), "casa")
    await user.click(screen.getByLabelText("ui.searchButton"))
    await screen.findByRole("alert")
    const retryBtn = within(screen.getByRole("alert")).getByRole("button")
    await user.click(retryBtn)
    await screen.findByRole("option", { name: /La casa di carta/ })
    expect(calls).toBe(2)
  })
})

describe("DefaultsPosterPreview title search + zoom (transport mocks, real builder)", () => {
  let blobN = 0

  beforeEach(() => {
    FakeXHR.urls = []
    blobN = 0
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:fake-${++blobN}`),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes("/api/tmdb/search")) {
          return okResponse(SEARCH_RESULTS)
        }
        return new Response("not found", { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("loads Avatar by default, switches path+alt+caption on tv select, restores on reset", async () => {
    const user = userEvent.setup()
    renderWithCtx(<Host />)

    await waitFor(() => {
      expect(FakeXHR.urls.some((u) => u.includes("/api/poster/movie/19995"))).toBe(true)
    })
    expect(await screen.findByAltText("Avatar")).toBeInTheDocument()
    expect(screen.getByText("ui.defaultsPreviewSubtitle")).toBeInTheDocument()

    const searchbox = screen.getByRole("textbox")
    await user.type(searchbox, "casa di carta")
    await user.click(screen.getByLabelText("ui.searchButton"))

    const option = await screen.findByRole("option", { name: /La casa di carta/ })
    expect(option).toHaveTextContent("TV")
    await user.click(option)

    await waitFor(() => {
      expect(FakeXHR.urls.some((u) => u.includes("/api/poster/tv/1399"))).toBe(true)
    })
    expect(await screen.findByAltText("La casa di carta")).toBeInTheDocument()
    expect(screen.queryByAltText("Avatar")).toBeNull()
    // Dynamic caption follows the selected title instead of the stale Avatar one.
    expect(screen.queryByText("ui.defaultsPreviewSubtitle")).toBeNull()
    // The key stays the current transport one, never leaked beyond api_key/u.
    const tvUrl = FakeXHR.urls.find((u) => u.includes("/api/poster/tv/1399"))!
    expect(tvUrl).toContain("preview=1")

    await user.click(screen.getByLabelText("ui.defaultsPreviewReset"))
    await waitFor(() => {
      const avatarHits = FakeXHR.urls.filter((u) => u.includes("/api/poster/movie/19995")).length
      expect(avatarHits).toBeGreaterThanOrEqual(2)
    })
    expect(await screen.findByAltText("Avatar")).toBeInTheDocument()
    expect(screen.getByText("ui.defaultsPreviewSubtitle")).toBeInTheDocument()
  })

  it("opens the zoom dialog on preview click and restores on second click", async () => {
    const user = userEvent.setup()
    renderWithCtx(<Host />)

    await screen.findByAltText("Avatar")
    await user.click(screen.getByLabelText("ui.defaultsPreviewZoomOpen"))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()
    const zoomedImg = within(dialog).getByAltText("Avatar")
    expect(zoomedImg).toBeInTheDocument()

    await user.click(zoomedImg)
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
    // Underlying preview stays mounted with no layout shift.
    expect(screen.getByAltText("Avatar")).toBeInTheDocument()
  })

  it("closes the zoom dialog on Escape with focus restored to the preview button", async () => {
    const user = userEvent.setup()
    renderWithCtx(<Host />)

    await screen.findByAltText("Avatar")
    const opener = screen.getByLabelText("ui.defaultsPreviewZoomOpen")
    await user.click(opener)
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
    expect(document.activeElement).toBe(opener)
  })

  it("nested Escape closes only the zoom, never the parent dialog", async () => {
    const user = userEvent.setup()
    renderWithCtx(<NestedHost />)

    await screen.findByAltText("Avatar")
    await user.click(screen.getByLabelText("ui.defaultsPreviewZoomOpen"))
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
    expect(screen.queryByText("parent closed")).toBeNull()
    expect(screen.getByAltText("Avatar")).toBeInTheDocument()
  })

  it("backdrop click closes the zoom and keeps the parent open", async () => {
    const user = userEvent.setup()
    renderWithCtx(<NestedHost />)

    await screen.findByAltText("Avatar")
    await user.click(screen.getByLabelText("ui.defaultsPreviewZoomOpen"))
    const dialog = await screen.findByRole("dialog")
    await user.click(dialog)
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
    expect(screen.queryByText("parent closed")).toBeNull()
  })
})

describe("DefaultsPreviewTitleSearch compact toggle (mobile only)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderCompact() {
    renderWithCtx(
      <DefaultsPreviewTitleSearch
        tmdbKey="test-key"
        hasServerKey={false}
        language="it-IT"
        demoMedia={null}
        onDemoMediaChange={() => {}}
        compact
      />,
    )
  }

  it("starts closed behind a 44px icon toggle with expanded/controls wiring", async () => {
    renderCompact()
    const toggle = screen.getByTestId("defaults-preview-search-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(toggle).toHaveAttribute("aria-label", "ui.defaultsPreviewSearchLabel")
    expect(toggle.className).toContain("min-w-[44px]")
    expect(toggle.className).toContain("min-h-[44px]")
    const bodyId = toggle.getAttribute("aria-controls")
    expect(bodyId).toBeTruthy()
    const body = document.getElementById(bodyId!)
    expect(body).not.toBeNull()
    expect(body).toHaveClass("hidden")
    // Toggle lives outside the collapsible body.
    expect(body).not.toContainElement(toggle)
    // Desktop (non-compact) keeps the always-open search with no toggle.
    // (Covered by the isolation suite above: textbox present without toggle.)
  })

  it("desktop search stays always open with no toggle", async () => {
    renderWithCtx(
      <DefaultsPreviewTitleSearch
        tmdbKey="test-key"
        hasServerKey={false}
        language="it-IT"
        demoMedia={null}
        onDemoMediaChange={() => {}}
      />,
    )
    expect(screen.queryByTestId("defaults-preview-search-toggle")).toBeNull()
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("opens on toggle with autofocus, closes with focus back on the toggle", async () => {
    const user = userEvent.setup()
    renderCompact()
    const toggle = screen.getByTestId("defaults-preview-search-toggle")
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)
    expect(body).not.toHaveClass("hidden")
    expect(document.activeElement).toBe(screen.getByRole("textbox"))
    // Close via the same toggle: focus returns to the toggle.
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(document.activeElement).toBe(toggle)
  })

  it("Escape inside the open body closes and returns focus to the toggle", async () => {
    const user = userEvent.setup()
    renderCompact()
    const toggle = screen.getByTestId("defaults-preview-search-toggle")
    await user.click(toggle)
    expect(document.activeElement).toBe(screen.getByRole("textbox"))
    await user.keyboard("{Escape}")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(document.activeElement).toBe(toggle)
  })
})

describe("DefaultsPosterPreview compact sizing (mobile only)", () => {
  let blobN = 0

  beforeEach(() => {
    FakeXHR.urls = []
    blobN = 0
    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:fake-${++blobN}`),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("portrait uses a larger responsive frame with aspect 2/3 intact and no demo notice", async () => {
    renderWithCtx(<DefaultsPosterPreview compact previewShape="portrait" />)
    const media = await screen.findByTestId("defaults-preview-media")
    expect(media.className).toContain("w-[120px]")
    expect(media.className).toContain("max-w-[44vw]")
    expect(media.className).toContain("aspect-[2/3]")
    expect(media.className).not.toContain("w-20")
    expect(media.className).not.toContain("max-w-[240px]")
    // Mobile drops the demo-data notice (desktop keeps it).
    expect(screen.queryByText("ui.defaultsPreviewSamplesNotice")).toBeNull()
    // Search starts collapsed behind the icon toggle.
    expect(screen.getByTestId("defaults-preview-search-toggle")).toBeInTheDocument()
  })

  it("landscape uses the full width with no cap and keeps the collapse body mounted", async () => {
    const user = userEvent.setup()
    function CollapsibleHost() {
      const [collapsed, setCollapsed] = useState(false)
      return <DefaultsPosterPreview compact previewShape="landscape" collapsed={collapsed} onCollapsedChange={setCollapsed} />
    }
    renderWithCtx(<CollapsibleHost />)
    const media = await screen.findByTestId("defaults-preview-media")
    expect(media.className).toContain("w-full")
    expect(media.className).toContain("aspect-video")
    expect(media.className).not.toContain("max-w-[240px]")
    // Collapse toggle preserves the mounted body (no refetch on expand).
    const toggle = screen.getByTestId("defaults-preview-collapse")
    const bodyId = toggle.getAttribute("aria-controls")!
    const body = document.getElementById(bodyId)!
    await user.click(toggle)
    expect(body).toHaveClass("hidden")
    expect(document.getElementById(bodyId)).toBe(body)
    await user.click(toggle)
    expect(body).not.toHaveClass("hidden")
  })

  it("desktop keeps the samples notice and the always-open search", async () => {
    renderWithCtx(<DefaultsPosterPreview previewShape="portrait" />)
    expect(await screen.findByText("ui.defaultsPreviewSamplesNotice")).toBeInTheDocument()
    expect(screen.queryByTestId("defaults-preview-search-toggle")).toBeNull()
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })
})
