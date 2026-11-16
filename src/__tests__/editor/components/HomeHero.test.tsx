import { describe, it, expect, vi, afterEach } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HomeHero } from "@/components/HomeHero"
import { HomeStatusStrip } from "@/components/HomeStatusStrip"
import { renderWithCtx } from "@/__tests__/test-utils"

// M21: i poster del podio vengono scaricati via fetch con la chiave in header
// x-api-key (object URL) — mai api_key nel DOM. Nei test il fetch è stub che
// ritorna un blob qualunque.
function stubPosterFetch() {
  const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3, 4])]), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function posterFetchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])
    .map(([u]) => String(u))
    .filter((u) => u.includes("/api/poster/"))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("HomeHero", () => {
  it("renders the split title and subtitle without kicker, pills or duplicate catalogs CTA", () => {
    renderWithCtx(<HomeHero />)
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).toContain("ui.heroTitleLead")
    expect(title.textContent).toContain("ui.heroTitleAccent")
    expect(title.textContent).toContain("ui.heroTitleTail")
    expect(screen.getByText("ui.heroSubtitle")).toBeInTheDocument()
    expect(screen.queryByText("ui.heroKicker")).toBeNull()
    expect(screen.queryByText("ui.heroPillLogos")).toBeNull()
    expect(screen.queryByText("ui.heroCatalogsCta")).toBeNull()
  })

  it("renders one real poster via /api/poster without leaking api_key (M21)", async () => {
    const fetchMock = stubPosterFetch()
    const { container } = renderWithCtx(<HomeHero />, { tmdbKey: "test-key" })
    await waitFor(() => expect(posterFetchUrls(fetchMock)).toHaveLength(1))
    const imgs = Array.from(container.querySelectorAll(".p-frame img"))
    expect(imgs).toHaveLength(1)
    // La chiave personale NON compare mai nel DOM né negli URL di fetch:
    // viaggia nell'header x-api-key.
    expect(container.innerHTML).not.toContain("api_key")
    expect(container.innerHTML).not.toContain("test-key")
    for (const [url, init] of fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][]) {
      const u = String(url)
      if (u.includes("/api/poster/")) {
        expect(u).not.toContain("api_key")
        expect((init?.headers as Record<string, string> | undefined)?.["x-api-key"]).toBe("test-key")
      }
    }
    imgs.forEach((img) => expect(img.getAttribute("src")).toBeTruthy())
  })

  it("picks a random ranked movie with its real rank and compares it with the raw TMDB poster", async () => {
    const fetchMock = stubPosterFetch()
    const trending = [
      { id: 101, media_type: "movie", title: "Movie B", name: "", poster_path: "/b.jpg", release_date: "2020-01-01", rank: 2 },
      { id: 100, media_type: "movie", title: "Movie A", name: "", poster_path: "/a.jpg", release_date: "2020-01-01", rank: 1 },
      { id: 200, media_type: "tv", title: "", name: "Series A", poster_path: "/s.jpg", release_date: "2020-01-01", rank: 1 },
    ] as const
    const { container } = renderWithCtx(<HomeHero />, { tmdbKey: "test-key", trending: [...trending] })
    await waitFor(() => expect(posterFetchUrls(fetchMock)).toHaveLength(1))
    const [url] = posterFetchUrls(fetchMock)
    const id = url.match(/\/movie\/(\d+)\?/)?.[1]
    expect(["100", "101"]).toContain(id)
    const item = trending.find((i) => String(i.id) === id)!
    expect(url).toContain(`rank=${item.rank}`)
    // Il poster originale TMDB sta sotto lo slider prima/dopo
    expect(container.querySelector(".hero-before")?.getAttribute("src")).toContain(item.poster_path)
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("style chips re-render the poster with the chosen badge style", async () => {
    const fetchMock = stubPosterFetch()
    const u = userEvent.setup()
    renderWithCtx(<HomeHero />, { tmdbKey: "test-key" })
    await waitFor(() => expect(posterFetchUrls(fetchMock)).toHaveLength(1))
    expect(posterFetchUrls(fetchMock)[0]).toContain("layout=fresh")
    await u.click(screen.getByRole("button", { name: /notch/i }))
    await waitFor(() => expect(posterFetchUrls(fetchMock).some((s) => s.includes("layout=standard&rs=notch-crema&bs=notch-crema"))).toBe(true))
    expect(screen.getByRole("button", { name: /notch/i })).toHaveAttribute("aria-pressed", "true")
  })

  it("retired Badge Lab: no Lab link or route is exposed on the home hero", () => {
    stubPosterFetch()
    renderWithCtx(<HomeHero />)
    expect(screen.queryByRole("link", { name: "ui.labTitle" })).toBeNull()
    const hrefs = screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "")
    expect(hrefs.some((h) => h.includes("/lab/badges") || h.includes("/presets"))).toBe(false)
  })

  it("cycles the styles on its own and stops at the first interaction", async () => {
    vi.useFakeTimers()
    const fetchMock = stubPosterFetch()
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    renderWithCtx(<HomeHero />, { tmdbKey: "test-key" })
    await act(async () => { await vi.advanceTimersByTimeAsync(3300) })
    expect(posterFetchUrls(fetchMock).some((u) => u.includes("rs=vetro"))).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /notch/i })) })
    const after = posterFetchUrls(fetchMock).length
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(posterFetchUrls(fetchMock)).toHaveLength(after)
  })

  it("has no open-in-editor button: the hero only shows the comparison and style chips", () => {
    stubPosterFetch()
    renderWithCtx(<HomeHero />)
    expect(screen.queryByRole("button", { name: "Apri nell'editor" })).toBeNull()
  })
})

describe("HomeStatusStrip", () => {
  it("renders operational state and service links without the decorative meta label", () => {
    renderWithCtx(<HomeStatusStrip />)
    // The decorative "API poster · TMDB · Add-on" label was removed: the TMDB
    // attribution lives solely in the Credits region (exact legal notice).
    expect(screen.queryByText("ui.statusMeta")).toBeNull()
    expect(
      screen.getByText(
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "ui.statusTitle" })).toHaveAttribute("href", "/status")
  })

  it("preserves user space uuid in status link when in user space", () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    window.history.replaceState({}, "", `/u/${uuid}/configure`)
    renderWithCtx(<HomeStatusStrip />)
    expect(screen.getByRole("link", { name: "ui.statusTitle" })).toHaveAttribute("href", `/status?u=${uuid}`)
    window.history.replaceState({}, "", "/")
  })
})
