import { describe, it, expect, vi, afterEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
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
  vi.unstubAllGlobals()
})

describe("HomeHero", () => {
  it("renders kicker, split title, subtitle and pills", () => {
    renderWithCtx(<HomeHero />)
    expect(screen.getByText("ui.heroKicker")).toBeInTheDocument()
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).toContain("ui.heroTitleLead")
    expect(title.textContent).toContain("ui.heroTitleAccent")
    expect(title.textContent).toContain("ui.heroTitleTail")
    expect(screen.getByText("ui.heroSubtitle")).toBeInTheDocument()
    expect(screen.getByText("ui.heroPillLogos")).toBeInTheDocument()
    // "Best-fit" compare sia nella pill della copia sia nel chip flottante
    expect(screen.getAllByText("ui.heroPillBestFit").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("ui.heroPillLangs")).toBeInTheDocument()
  })

  it("renders three real podium posters via /api/poster without leaking api_key (M21)", async () => {
    const fetchMock = stubPosterFetch()
    const { container } = renderWithCtx(<HomeHero />, { tmdbKey: "test-key" })
    await waitFor(() => expect(posterFetchUrls(fetchMock)).toHaveLength(3))
    const imgs = Array.from(container.querySelectorAll(".p-frame img"))
    expect(imgs).toHaveLength(3)
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
    // Le img risultano popolate (object URL o URL pulito senza chiave)
    imgs.forEach((img) => expect(img.getAttribute("src")).toBeTruthy())
  })

  it("picks 2 random ranked movies + 1 ranked series with their real ranks (M21: letti dai fetch URL)", async () => {
    const fetchMock = stubPosterFetch()
    const trending = [
      { id: 101, media_type: "movie", title: "Movie B", name: "", poster_path: "/b.jpg", release_date: "2020-01-01", rank: 2 },
      { id: 100, media_type: "movie", title: "Movie A", name: "", poster_path: "/a.jpg", release_date: "2020-01-01", rank: 1 },
      { id: 102, media_type: "movie", title: "Movie C", name: "", poster_path: "/c.jpg", release_date: "2020-01-01", rank: 3 },
      { id: 200, media_type: "tv", title: "", name: "Series A", poster_path: "/s.jpg", release_date: "2020-01-01", rank: 1 },
    ] as const
    const { container } = renderWithCtx(<HomeHero />, { tmdbKey: "test-key", trending: [...trending] })
    await waitFor(() => expect(posterFetchUrls(fetchMock)).toHaveLength(3))
    expect(container.querySelectorAll(".p-frame img")).toHaveLength(3)
    // 2 film distinti tra quelli in classifica + 1 serie; rank reali in URL
    const posterUrls = posterFetchUrls(fetchMock)
    const movieIds = posterUrls.map((s) => s.match(/\/movie\/(\d+)\?/)?.[1]).filter(Boolean)
    expect(new Set(movieIds).size).toBe(2)
    expect(movieIds.every((id) => ["100", "101", "102"].includes(id!))).toBe(true)
    const tvSrc = posterUrls.find((s) => s.includes("/tv/"))
    expect(tvSrc).toContain("/tv/200?")
    expect(tvSrc).toContain("rank=1")
    // Il nastro Netflix identifica la serie giornaliera (e il primo film)
    expect(tvSrc).toContain("rs=netflix")
    posterUrls.forEach((s) => {
      const id = s.match(/\/(?:movie|tv)\/(\d+)\?/)?.[1]
      const item = [...trending].find((i) => String(i.id) === id)
      expect(s).toContain(`rank=${item!.rank}`)
    })
  })

  it("navigates to catalogs when CTA is clicked", async () => {
    stubPosterFetch()
    const u = userEvent.setup()
    const push = vi.fn()
    renderWithCtx(<HomeHero />, { router: { push, replace: vi.fn(), back: vi.fn() } })
    await u.click(screen.getByText("ui.heroCatalogsCta"))
    expect(push).toHaveBeenCalledWith("cataloghi")
  })

  it("opens the editor when a podium poster is clicked", async () => {
    stubPosterFetch()
    const u = userEvent.setup()
    const navigateToPoster = vi.fn()
    const trending = [
      { id: 100, media_type: "movie", title: "Movie A", name: "", poster_path: "/a.jpg", release_date: "2020-01-01", rank: 1 },
      { id: 101, media_type: "movie", title: "Movie B", name: "", poster_path: "/b.jpg", release_date: "2020-01-01", rank: 2 },
      { id: 200, media_type: "tv", title: "", name: "Series A", poster_path: "/s.jpg", release_date: "2020-01-01", rank: 1 },
    ] as const
    renderWithCtx(<HomeHero />, { tmdbKey: "test-key", trending: [...trending], navigateToPoster })
    await u.click(screen.getByRole("button", { name: "Movie A" }))
    expect(navigateToPoster).toHaveBeenCalledWith(expect.objectContaining({ id: 100, media_type: "movie" }))
    // Anche il fallback statico resta cliccabile (nessun trending)
    navigateToPoster.mockClear()
    renderWithCtx(<HomeHero />, { tmdbKey: "test-key", navigateToPoster })
    await u.click(screen.getByRole("button", { name: "Dark" }))
    expect(navigateToPoster).toHaveBeenCalledWith(expect.objectContaining({ id: 44217, media_type: "tv" }))
  })
})

describe("HomeStatusStrip", () => {
  it("renders operational state and service links", () => {
    renderWithCtx(<HomeStatusStrip />)
    expect(screen.getByText("ui.statusMeta")).toBeInTheDocument()
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
