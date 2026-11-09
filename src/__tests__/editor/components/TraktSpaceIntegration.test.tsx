import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  setStoredUserPassword,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"
import { __resetAdminTokenForTests } from "@/lib/admin-token"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

const realFetch = global.fetch

function stubFetch(): void {
  global.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u.includes("/api/status")) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ multiUser: true }) }
    }
    if (u.includes(`/api/users/${UUID}/trakt/status`)) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ configured: true, status: "disconnected" }),
      }
    }
    if (u.includes(`/api/users/${UUID}/trakt/authorize`) && init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ authorizeUrl: "https://auth.trakt.tv/oauth/authorize?state=x", expiresIn: 600 }),
      }
    }
    if (u.includes(`/api/users/${UUID}/keys`)) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }),
      }
    }
    if (init?.method === "PUT" && u.includes("/api/defaults")) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
    }
    if (u.includes("/api/defaults/presets")) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  resetGuestGuardForTests()
  stubFetch()
  setUrl(`/u/${UUID}/configure`)
  setStoredUserPassword(UUID, "space-password-4")
  window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

describe("Trakt Space integration", () => {
  // SettingsPanel mounts every tab/section (hidden ones included) and the
  // Space panel gates Connect behind an async Trakt status fetch, so a
  // document-wide role/name query here is heavy. Scoping the lookup to the
  // Space panel keeps each poll cheap and the explicit budgets keep the
  // integration render reliable under the parallel full-suite workers; the
  // assertions are unchanged.
  it("renders the Trakt section in Space after the API keys", { timeout: 15000 }, async () => {
    renderWithCtx(
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
    )
    // The Space tab is gated by the async multi-user/space-path resolution:
    // wait for the tab itself, then activate it.
    fireEvent.click(await screen.findByTestId("settings-secondary-spazio"))
    const spacePanel = screen.getByRole("tabpanel", { name: "ui.settingsTabSpace" })
    const connect = await within(spacePanel).findByRole(
      "button",
      { name: "ui.traktConnect" },
      { timeout: 5000 },
    )
    expect(connect).toBeInTheDocument()
    // Approved location: Space tabpanel, after the personal API keys card.
    const keysTitle = within(spacePanel).getByText("ui.userKeysTitle")
    const traktTitle = within(spacePanel).getByText("ui.traktTitle")
    expect(keysTitle.compareDocumentPosition(traktTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(traktTitle.closest('[role="tabpanel"]')).toBe(connect.closest('[role="tabpanel"]'))
  })

  it("dirty visual draft intercepts the external OAuth navigation (no silent loss)", { timeout: 15000 }, async () => {
    renderWithCtx(
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
    )
    await screen.findByTestId("poster-style-apple")
    // Stage an unsaved visual change, then move to Space (free navigation).
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    fireEvent.click(screen.getByTestId("settings-secondary-spazio"))
    const spacePanel = screen.getByRole("tabpanel", { name: "ui.settingsTabSpace" })
    const hrefBefore = window.location.href
    fireEvent.click(await within(spacePanel).findByRole(
      "button",
      { name: "ui.traktConnect" },
      { timeout: 5000 },
    ))
    // Guard dialog instead of navigation: keep editing drops the pending
    // OAuth run and the draft survives.
    expect(await screen.findByTestId("settings-dirty-dialog")).toBeInTheDocument()
    expect(window.location.href).toBe(hrefBefore)
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(window.location.href).toBe(hrefBefore)
    expect(window.location.href).not.toContain("trakt.tv")
    // Draft retained: Save still enabled.
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    resetGuestGuardForTests()
    global.fetch = realFetch
    setUrl("/")
  })
})
