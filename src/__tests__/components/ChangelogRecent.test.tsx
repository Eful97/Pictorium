import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithCtx } from "@/__tests__/test-utils"
import { ChangelogModal } from "@/components/ChangelogModal"

vi.mock("@/generated/recent-changes", () => ({
  RECENT_CHANGES: [
    { type: "feature", text: "Auto entry one", sha: "abc1234", date: "2026-09-01" },
    { type: "fix", text: "Auto entry two", sha: "def5678", date: "" },
  ],
}))

describe("ChangelogModal recent section", () => {
  it("renders auto entries below curated releases when present", () => {
    renderWithCtx(<ChangelogModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId("changelog-recent")).not.toBeNull()
    expect(screen.getByText("Auto entry one")).not.toBeNull()
    expect(screen.getByText("2026-09-01")).not.toBeNull()
    // Curated releases still on top
    expect(screen.getByText("v1.23")).not.toBeNull()
    expect(screen.getByText("v1.22")).not.toBeNull()
  })
})
