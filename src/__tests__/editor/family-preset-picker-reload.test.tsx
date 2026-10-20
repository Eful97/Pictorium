/**
 * FamilyPresetPicker owner-list reload regression (Badge Lab E2E correction2).
 *
 * Proven E2E root cause: under React Strict Mode (Next dev, all E2E) the
 * once-per-namespace ref guard discarded the only in-flight `mine=1`
 * response — mount1 cleanup invalidated it while mount2 early-returned —
 * leaving the picker permanently empty (no family selects) despite a real
 * HTTP 200 with the owner's presets. A 401 path exists too: mount-while-locked
 * fetched before the session unlock and never retried for the same namespace.
 *
 * Contract under test (no HTTP stubbing of the product path beyond the
 * presets-client boundary already mocked in this suite):
 *  1. StrictMode double-mount still populates the owner list (no ref guard).
 *  2. Unauth mount (401, surfaced as error — never swallowed) followed by a
 *     USER_UNLOCK_EVENT for the same namespace reloads the list (existing
 *     unlock-event convention, same as AppShell/context).
 */
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { FamilyPresetPicker } from "@/components/FamilyPresetPicker"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"

const USER_ID = "123e4567-e89b-12d3-a456-426614174000"

const setFamilyPreset = vi.fn()

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: null,
    setFamilyPreset,
    posterShape: "poster",
  }),
}))

vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({
      selected: { id: 1, media_type: "movie" },
      mappingsMap: new Map(),
      currentUserId: USER_ID,
    }),
}))

vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k, lang: "en" }),
}))

const genreItem = {
  preset: {
    id: "Abc123-_XyZ",
    revision: "deadbeef",
    target: "genre",
    metadata: { name: "Owned Genre" },
  },
  downloads: 0,
}

const { listMyPresets } = vi.hoisted(() => ({ listMyPresets: vi.fn() }))

vi.mock("@/lib/presets-client", () => ({
  listMyPresets,
}))

beforeEach(() => {
  vi.mocked(listMyPresets).mockReset()
  setFamilyPreset.mockClear()
})

describe("FamilyPresetPicker owner-list reload", () => {
  it("populates the owner list despite a StrictMode remount (no once-per-namespace guard)", async () => {
    vi.mocked(listMyPresets).mockResolvedValue({ presets: [genreItem] })
    render(
      <StrictMode>
        <FamilyPresetPicker />
      </StrictMode>,
    )
    // The second (committed) mount must fetch again: the first mount's
    // response is discarded by its own cleanup.
    expect(await screen.findByTestId("family-preset-select-genre")).toBeInTheDocument()
  })

  it("surfaces 401 on unauth mount, then reloads the list on unlock for the same namespace", async () => {
    vi.mocked(listMyPresets).mockRejectedValueOnce(new Error("API 401: /api/presets?mine=1"))
    vi.mocked(listMyPresets).mockResolvedValue({ presets: [genreItem] })
    render(<FamilyPresetPicker />)
    // 401 is surfaced (error hint on every row), never silently swallowed
    // into an empty-but-healthy state.
    const errors = await screen.findAllByText("ui.visualPresetsError")
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.queryByTestId("family-preset-select-genre")).toBeNull()

    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: USER_ID } }))

    expect(await screen.findByTestId("family-preset-select-genre")).toBeInTheDocument()
    expect(screen.queryAllByText("ui.visualPresetsError")).toHaveLength(0)
  })

  it("ignores unlock events for a different namespace", async () => {
    vi.mocked(listMyPresets).mockRejectedValueOnce(new Error("API 401: /api/presets?mine=1"))
    vi.mocked(listMyPresets).mockResolvedValue({ presets: [genreItem] })
    render(<FamilyPresetPicker />)
    expect(await screen.findAllByText("ui.visualPresetsError")).not.toHaveLength(0)

    window.dispatchEvent(
      new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: "223e4567-e89b-12d3-a456-426614174000" } }),
    )

    // No refetch for another namespace: still error, no list, exactly one call.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("family-preset-select-genre")).toBeNull()
    expect(vi.mocked(listMyPresets)).toHaveBeenCalledTimes(1)
  })
})
