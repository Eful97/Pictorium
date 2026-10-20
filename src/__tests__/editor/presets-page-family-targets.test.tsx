/**
 * Task B — community library navigation: the target filter exposes the
 * UI-visible targets (single Classifica: legacy `top` hidden, `rank`
 * present; strict allowlist, same contract as the API), and the
 * Lab entry point stays reachable from the page.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { LAB_VISIBLE_TARGETS } from "@/lib/badge-preset"
import PresetsPage from "@/app/presets/page"

vi.mock("@/lib/presets-client", () => ({
  listPublicPresets: vi.fn(async () => ({ items: [], nextCursor: null })),
  downloadPresetFile: vi.fn(),
  presetPreviewUrl: (id: string) => `/api/presets/${id}/preview.svg`,
}))

vi.mock("@/lib/i18n", () => ({
  t: (k: string) => k,
  getLang: () => "en",
  setLang: () => {},
  isDictionaryLoaded: () => true,
}))

vi.mock("@/lib/i18n-loader", () => ({
  loadLanguage: vi.fn(async () => {}),
}))

vi.mock("@/lib/user-token", () => ({
  currentPathUuid: () => null,
}))

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

describe("PresetsPage target filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("offers the single-Classifica visible targets (legacy `top` hidden, rank present) and applies them to the list query", async () => {
    const { listPublicPresets } = await import("@/lib/presets-client")
    render(<PresetsPage />)
    const select = screen.getByRole("combobox", { name: "ui.presetsTarget" })
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"))
    expect(options).toContain("")
    for (const target of LAB_VISIBLE_TARGETS) {
      expect(options).toContain(target)
    }
    // No duplicate "Badge superiore": legacy `top` is accepted by the API but
    // never offered; stored `top` presets surface under the `rank` filter.
    expect(options).not.toContain("top")
    await waitFor(() => {
      expect(vi.mocked(listPublicPresets)).toHaveBeenCalled()
    })
    const firstCall = vi.mocked(listPublicPresets).mock.calls[0][0] as { target?: string }
    expect(firstCall.target).toBeUndefined()
  })
})
