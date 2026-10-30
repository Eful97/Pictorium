import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { HomeStatusStrip } from "@/components/HomeStatusStrip"
import { renderWithCtx } from "@/__tests__/test-utils"

function mockStatus(payload: unknown, opts?: { ok?: boolean; reject?: boolean }) {
  global.fetch = (async () => {
    if (opts?.reject) throw new Error("network down")
    return { ok: opts?.ok ?? true, status: 200, json: async () => payload }
  }) as unknown as typeof fetch
}

const realFetch = global.fetch

beforeEach(() => {
  window.history.replaceState({}, "", "/")
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe("HomeStatusStrip spaces indicator", () => {
  it("mostra occupazione spazi quando multi-user è attivo con cap", async () => {
    mockStatus({ multiUser: true, users: 3, maxUsers: 100, activeUsers: 2 })
    renderWithCtx(<HomeStatusStrip />)
    const pill = await screen.findByTestId("home-spaces")
    await waitFor(() => expect(pill).toHaveTextContent("3"))
    expect(pill.parentElement).toHaveAttribute("title", "3/100 spazi (2 attivi)")
  })

  it("mostra solo il conteggio quando il cap è illimitato (maxUsers 0)", async () => {
    mockStatus({ multiUser: true, users: 7, maxUsers: 0, activeUsers: 3 })
    renderWithCtx(<HomeStatusStrip />)
    const pill = await screen.findByTestId("home-spaces")
    await waitFor(() => expect(pill).toHaveTextContent("7"))
    expect(pill.parentElement).toHaveAttribute("title", "7 spazi (3 attivi)")
  })

  it("resta nascosto quando activeUsers manca (skew di versione)", async () => {
    mockStatus({ multiUser: true, users: 3, maxUsers: 100 })
    renderWithCtx(<HomeStatusStrip />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("home-spaces")).toBeNull()
  })

  it("resta nascosto quando multi-user è spento", async () => {
    mockStatus({ multiUser: false, users: 0, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("home-spaces")).toBeNull()
  })

  it("resta nascosto se l'endpoint fallisce", async () => {
    mockStatus(null, { reject: true })
    renderWithCtx(<HomeStatusStrip />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("home-spaces")).toBeNull()
  })

  it("mostra l'attribution TMDB con link (TOS, v1.23.0)", async () => {
    mockStatus({ multiUser: false, users: 0, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)
    const link = await screen.findByRole("link", { name: /uses the TMDB API/i })
    expect(link).toHaveAttribute("href", "https://www.themoviedb.org/")
  })
})

describe("HomeStatusStrip TMDB attribution (Credits region)", () => {
  const NOTICE =
    "This product uses the TMDB API but is not endorsed or certified by TMDB."
  const LOGO_SRC =
    "/attribution/tmdb/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"

  it("shows the exact notice inside an accessible, never-hidden Credits region", async () => {
    mockStatus({ multiUser: false, users: 0, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)

    const notice = await screen.findByText(NOTICE)

    // No ancestor up to the strip <footer> may carry Tailwind's `hidden`
    // utility: the notice must stay visible on mobile too.
    let el: HTMLElement | null = notice
    while (el) {
      const tokens = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
      expect(tokens).not.toContain("hidden")
      expect(tokens.some((c) => /(^|:)hidden$/.test(c))).toBe(false)
      if (el.getAttribute("data-testid") === "home-status") break
      el = el.parentElement
    }

    const region = screen.getByRole("region", { name: "Credits" })
    expect(region).toContainElement(notice)
  })

  it("links the notice to themoviedb.org and serves the local official logo undistorted", async () => {
    mockStatus({ multiUser: false, users: 0, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)

    const link = await screen.findByRole("link", { name: /This product uses the TMDB API/ })
    expect(link).toHaveAttribute("href", "https://www.themoviedb.org/")
    expect(link).toHaveTextContent(NOTICE)

    const logo = screen.getByRole("img", { name: "The Movie Database (TMDB)" })
    expect(logo).toHaveAttribute("src", LOGO_SRC)
    // Integer attributes 18504 x 13340 equal the intrinsic ratio of the official
    // file (viewBox 185.04 x 133.4 on both axes). Cross-multiplying asserts the
    // ratio exactly, so no floating-point tolerance is needed. No browser layout
    // is simulated here: JSDOM does not lay images out.
    const width = Number(logo.getAttribute("width"))
    const height = Number(logo.getAttribute("height"))
    expect(width).toBe(18504)
    expect(height).toBe(13340)
    expect(width * 13340).toBe(height * 18504)
  })
})
