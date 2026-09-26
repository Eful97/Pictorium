import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { DesktopCommunityLinks, MobileCommunityLinks } from "@/components/HeaderCommunityLinks"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

const DESKTOP_KEY = "pictorium_elfhosted_minimized_desktop"
const MOBILE_KEY = "pictorium_elfhosted_minimized_mobile"

function mockApi(hostedBy: string | null) {
  global.fetch = (async (url: unknown) => {
    const u = String(url)
    if (u.includes("/api/status")) return { ok: true, status: 200, json: async () => ({ multiUser: false, hostedBy }) }
    if (u.includes("/api/kofi/goal")) return { ok: true, status: 200, json: async () => ({ current: 0, target: 6, percentage: 0 }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

const realFetch = global.fetch

beforeEach(() => {
  resetGuestGuardForTests()
  window.sessionStorage?.removeItem(DESKTOP_KEY)
  window.sessionStorage?.removeItem(MOBILE_KEY)
  window.history.replaceState({}, "", "/")
  vi.restoreAllMocks()
})

afterEach(() => {
  global.fetch = realFetch
})

describe("ElfHostedMenu (desktop)", () => {
  it("nascosto quando hostedBy è null", async () => {
    mockApi(null)
    renderWithCtx(<DesktopCommunityLinks />)
    await waitFor(() => expect(screen.getByLabelText("GitHub Repository")).toBeInTheDocument())
    expect(screen.queryByLabelText(/info sponsor/i)).toBeNull()
  })

  it("icona + tendina aperta al primo avvio", async () => {
    mockApi("elfhosted")
    renderWithCtx(<DesktopCommunityLinks />)
    const btn = await screen.findByLabelText(/info sponsor/i)
    expect(btn).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("link", { name: /guida gratuita/i })).toHaveAttribute(
      "href",
      "https://stremio-addons-guide.elfhosted.com/",
    )
    // Riga istanza privata presente ma non cliccabile (URL in arrivo)
    const deployRow = screen.getByText(/crea la tua istanza privata/i)
    expect(deployRow.closest("a")).toBeNull()
    expect(deployRow.closest("[aria-disabled='true']")).not.toBeNull()
  })

  it("tocco icona chiude e riapre, con persistenza", async () => {
    mockApi("elfhosted")
    renderWithCtx(<DesktopCommunityLinks />)
    const btn = await screen.findByLabelText(/info sponsor/i)
    fireEvent.click(btn)
    expect(window.sessionStorage?.getItem(DESKTOP_KEY)).toBe("1")
    expect(screen.queryByRole("link", { name: /guida gratuita/i })).toBeNull()
    fireEvent.click(screen.getByLabelText(/info sponsor/i))
    expect(window.sessionStorage?.getItem(DESKTOP_KEY)).toBeNull()
    expect(screen.getByRole("link", { name: /guida gratuita/i })).toBeInTheDocument()
  })

  it("parte chiuso se già minimizzato in sessione", async () => {
    mockApi("elfhosted")
    window.sessionStorage?.setItem(DESKTOP_KEY, "1")
    renderWithCtx(<DesktopCommunityLinks />)
    const btn = await screen.findByLabelText(/info sponsor/i)
    expect(btn).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("link", { name: /guida gratuita/i })).toBeNull()
  })

  it("il meno nella tendina chiude", async () => {
    mockApi("elfhosted")
    renderWithCtx(<DesktopCommunityLinks />)
    await screen.findByLabelText(/info sponsor/i)
    fireEvent.click(screen.getByRole("button", { name: /riduci a icona/i }))
    expect(screen.queryByRole("link", { name: /guida gratuita/i })).toBeNull()
  })
})

describe("ElfHostedMenu (mobile)", () => {
  it("icona + tendina aperta al primo avvio", async () => {
    mockApi("elfhosted")
    renderWithCtx(<MobileCommunityLinks />)
    const btn = await screen.findByLabelText(/info sponsor/i)
    expect(btn).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("link", { name: /guida gratuita/i })).toBeInTheDocument()
  })

  it("parte aperto anche se il desktop è minimizzato (stati indipendenti)", async () => {
    mockApi("elfhosted")
    window.sessionStorage?.setItem(DESKTOP_KEY, "1")
    renderWithCtx(<MobileCommunityLinks />)
    const btn = await screen.findByLabelText(/info sponsor/i)
    expect(btn).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("link", { name: /guida gratuita/i })).toBeInTheDocument()
    expect(window.sessionStorage?.getItem(MOBILE_KEY)).toBeNull()
  })
})
