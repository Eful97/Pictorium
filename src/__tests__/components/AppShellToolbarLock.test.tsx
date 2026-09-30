import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import { AppShell } from "@/components/AppShell"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  setStoredUserPassword,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}
function mockApi(multiUser: boolean) {
  global.fetch = (async (url: unknown) => {
    const u = String(url)
    if (u.includes("/api/auth/pin")) return { ok: true, status: 200, json: async () => ({ hasPin: false, authenticated: false }) }
    if (u.includes("/api/status")) return { ok: true, status: 200, json: async () => ({ multiUser }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  resetGuestGuardForTests()
  setUrl("/")
})

describe("toolbar lock pre-auth", () => {
  it("multi-user senza uuid: bottoni disabilitati", async () => {
    mockApi(true)
    setUrl("/")
    renderWithCtx(<AppShell />)
    const btns = await screen.findAllByRole("button", { name: "ui.catalogs" })
    expect(btns.length).toBeGreaterThan(0)
    for (const b of btns) expect(b).toBeDisabled()
  })

  it("multi-user con uuid sbloccato: bottoni abilitati", async () => {
    mockApi(true)
    setUrl(`/u/${UUID}/configure`)
    setStoredUserPassword(UUID, "pw-12345678")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    renderWithCtx(<AppShell />)
    const btns = await screen.findAllByRole("button", { name: "ui.catalogs" })
    for (const b of btns) expect(b).not.toBeDisabled()
  })

  it("single-user: bottoni abilitati", async () => {
    mockApi(false)
    setUrl("/")
    renderWithCtx(<AppShell />)
    const btns = await screen.findAllByRole("button", { name: "ui.catalogs" })
    for (const b of btns) expect(b).not.toBeDisabled()
  })

  it("multi-user con uuid non sbloccato: bottoni disabilitati", async () => {
    mockApi(true)
    setUrl(`/u/${UUID}/configure`)
    renderWithCtx(<AppShell />)
    const btns = await screen.findAllByRole("button", { name: "ui.catalogs" })
    for (const b of btns) expect(b).toBeDisabled()
  })

  it("mostra il pulsante proxy sia nella toolbar desktop che nella navigazione mobile", async () => {
    mockApi(false)
    setUrl("/")
    renderWithCtx(<AppShell />)
    const proxyBtns = await screen.findAllByRole("button", { name: /Proxy/i })
    // Uno desktop (toolbar in alto) e uno mobile (barra in basso)
    expect(proxyBtns.length).toBeGreaterThanOrEqual(2)
  })
})
