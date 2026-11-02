import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { consumeSettingsTab } from "@/lib/settings-tab"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const realFetch = global.fetch

function mockStatus(multiUser: boolean) {
  global.fetch = (async (url: unknown) => {
    if (String(url).includes("/api/status")) {
      return { ok: true, json: async () => ({ multiUser }) } as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
}

afterEach(() => {
  global.fetch = realFetch
  resetGuestGuardForTests()
  consumeSettingsTab()
})

describe("EditView welcome CTA", () => {
  it("opens the real Settings keys tab (Data) in single-user instead of the hidden Space tab", async () => {
    mockStatus(false)
    const setSettingsOpen = vi.fn()
    renderWithCtx(<EditView />, {
      tmdbKey: "",
      serverHasTmdbKey: false,
      instanceHasTmdbKey: false,
      instanceHasMdblistKey: false,
      setSettingsOpen,
    })

    const cta = await screen.findByRole("button", { name: "ui.configureKeys" })
    fireEvent.click(cta)

    expect(setSettingsOpen).toHaveBeenCalledWith(true)
    // Data hosts the instance API keys section; `spazio` is hidden with
    // single-user off and would be a dead-end.
    expect(consumeSettingsTab()).toBe("data")
  })
})
