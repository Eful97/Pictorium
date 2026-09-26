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
