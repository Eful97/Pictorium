/**
 * Task B — Lab handoff navigation: with a title deep-link context
 * (?family=&source=native&return=) the Lab initializes the family starter
 * (no DB writes) and exposes "Use for title" for the staged return.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: [] })),
  getPreset: vi.fn(async () => { throw new Error("nope") }),
  createPreset: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
}))

vi.mock("@/lib/http", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/http")>()
  return { ...orig, ApiError: class ApiError extends Error {} }
})

import BadgeLabPage from "@/app/lab/badges/page"

describe("BadgeLabPage title handoff", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/lab/badges?family=quality&source=native&return=%2Fc%3Ftitle%3Dmovie%3A1",
    )
    window.localStorage.clear()
  })

  it("initializes the family starter and shows the staged return", async () => {
    render(<BadgeLabPage />)
    await waitFor(() => {
      expect(screen.getByTestId("lab-handoff")).toBeInTheDocument()
    })
    // No saved preset yet: the handoff button explains it needs a save first.
    const useForTitle = screen.getByTestId("lab-use-for-title")
    expect(useForTitle).toBeDisabled()
  })
})
