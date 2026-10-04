import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { AppShell } from "@/components/AppShell"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
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

function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

function mockApi() {
  global.fetch = (async (url: unknown) => {
    const u = String(url)
    if (u.includes("/api/auth/pin")) {
      return { ok: true, status: 200, json: async () => ({ hasPin: true, authenticated: false }) }
    }
    if (u.includes("/api/status")) {
      return { ok: true, status: 200, json: async () => ({ multiUser: true }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  installStorages()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  mockApi()
})

describe("AppShell PinLockModal bypass sui path /u/", () => {
  it("su path globale il lucchetto PIN appare", async () => {
    setUrl("/")
    renderWithCtx(<AppShell />)
    expect(await screen.findByText("ui.pinLockTitle")).toBeInTheDocument()
  })

  it("su /u/<uuid> il lucchetto PIN non mura lo spazio (cancello = password)", async () => {
    setUrl(`/u/${UUID}/configure`)
    renderWithCtx(<AppShell />)
    // Lo sblocco spazio si apre (dynamics caricate) ma il PIN no.
    expect(await screen.findByText("ui.userUnlockTitle")).toBeInTheDocument()
    expect(screen.queryByText("ui.pinLockTitle")).not.toBeInTheDocument()
  })

  it("icona chiave su /u/ sbloccato: apre le impostazioni sul tab Spazio", async () => {
    setUrl(`/u/${UUID}/configure`)
    setStoredUserPassword(UUID, "pw-1")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    // Host con settingsOpen reale (il mock di default ha setter no-op).
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <PosterEditorProvider>
          <PictoriumProvider value={{ ...MOCK_CTX, settingsOpen: open, setSettingsOpen: setOpen }}>
            <AppShell />
          </PictoriumProvider>
        </PosterEditorProvider>
      )
    }
    render(<Host />)
    // Niente modal (già sbloccato): l'icona apre le impostazioni.
    // (Desktop + mobile coesistono nel DOM in jsdom: match multipli.)
    const icons = await screen.findAllByLabelText("ui.userSpaceTitle")
    expect(icons.length).toBeGreaterThan(0)
    fireEvent.click(icons[0])
    // Dialog impostazioni sul tab Spazio (sezione UUID presente).
    const dialogs = await screen.findAllByRole("dialog", { name: "ui.settingsGlobalTitle" }, { timeout: 4000 })
    expect(dialogs.length).toBeGreaterThan(0)
    expect(await screen.findAllByText("ui.userSpaceUuidLabel", {}, { timeout: 4000 })).not.toHaveLength(0)
    const tabs = screen.getAllByRole("tab", { name: "ui.settingsTabSpace" })
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) expect(tab).toHaveAttribute("aria-selected", "true")
  })
})
