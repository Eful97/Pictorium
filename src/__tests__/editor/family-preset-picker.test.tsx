/**
 * Task B — FamilyPresetPicker (per-title per-family staged choices).
 *
 * Contract under test: one independent row per badge family (9) with no
 * global overwrite — Standard stages an explicit null clear for that family
 * only, Saved drops the staged key (follow the saved mapping again), and a
 * library preset stages its id/rev. Statuses reflect staged-over-saved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BADGE_FAMILY_IDS } from "@/lib/badge-preset"
import { FamilyPresetPicker } from "@/components/FamilyPresetPicker"

const setFamilyPreset = vi.fn()

let staged: Record<string, { id: string; rev: string | null } | null> | null = null
let saved: Record<string, { id: string; rev: string | null } | null> | null = null

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: staged,
    setFamilyPreset,
    posterShape: "poster",
  }),
}))

vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({
      selected: { id: 1, media_type: "movie" },
      mappingsMap: new Map(
        saved ? [["movie:1", { badgePresets: saved }]] : [],
      ),
      currentUserId: "123e4567-e89b-12d3-a456-426614174000",
    }),
}))

vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k, lang: "en" }),
}))

const mineQuality = {
  preset: {
    id: "Abc123-_XyZ",
    revision: "deadbeef",
    target: "quality",
    metadata: { name: "Neon Quality" },
  },
  downloads: 3,
}

vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: [mineQuality] })),
}))

beforeEach(() => {
  staged = null
  saved = null
  setFamilyPreset.mockClear()
})

describe("FamilyPresetPicker", () => {
  it("renders one independent row per badge family", () => {
    render(<FamilyPresetPicker />)
    expect(screen.getByTestId("badge-family-presets")).toBeInTheDocument()
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-preset-row-${family}`)).toBeInTheDocument()
    }
  })

  it("Standard stages an explicit null clear for that family only", async () => {
    const user = userEvent.setup()
    render(<FamilyPresetPicker />)
    await user.click(screen.getByTestId("family-preset-standard-quality"))
    expect(setFamilyPreset).toHaveBeenCalledTimes(1)
    expect(setFamilyPreset).toHaveBeenCalledWith("quality", null)
  })

  it("Saved drops the staged key so the mapping is followed again", async () => {
    staged = { quality: null }
    const user = userEvent.setup()
    render(<FamilyPresetPicker />)
    await user.click(screen.getByTestId("family-preset-saved-quality"))
    expect(setFamilyPreset).toHaveBeenCalledWith("quality", undefined)
  })

  it("shows staged clears and saved bindings distinctly without touching siblings", () => {
    staged = { quality: null }
    saved = { rank: { id: "Qwerty12-34", rev: "cafef00d" } }
    render(<FamilyPresetPicker />)
    expect(screen.getByTestId("family-preset-status-quality").textContent).toContain("ui.familyStandard")
    expect(screen.getByTestId("family-preset-status-rank").textContent).toContain("Qwerty12")
    expect(screen.getByTestId("family-preset-status-genre").textContent).toContain("ui.posterStyleDefault")
    // Only the staged family offers the Saved (unstage) action.
    expect(screen.getByTestId("family-preset-saved-quality")).toBeInTheDocument()
    expect(screen.queryByTestId("family-preset-saved-rank")).toBeNull()
  })

  it("stages a compatible library preset with its revision", async () => {
    const user = userEvent.setup()
    render(<FamilyPresetPicker />)
    const select = await screen.findByTestId("family-preset-select-quality")
    await user.selectOptions(select, "Abc123-_XyZ")
    await waitFor(() => {
      expect(setFamilyPreset).toHaveBeenCalledWith("quality", { id: "Abc123-_XyZ", rev: "deadbeef" })
    })
  })

  it("deep-links each family to the Lab with family/source context", () => {
    render(<FamilyPresetPicker />)
    const href = screen.getByTestId("family-preset-lab-quality").getAttribute("href") ?? ""
    expect(href).toContain("/lab/badges")
    expect(href).toContain("family=quality")
    expect(href).toContain("source=native")
  })
})
