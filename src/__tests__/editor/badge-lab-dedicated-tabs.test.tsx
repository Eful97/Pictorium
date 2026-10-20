/**
 * Dedicated Badge Lab tabs (user-confirmed reorganization).
 *
 * All 9 per-family custom choices live in ONE Badge Lab tab per surface:
 * - global Settings (scope "defaults", staged through the shared session),
 * - per-title editor (scope "title", staged until Salva Poster).
 * The native Badge tab keeps ONLY native appearance/toggle controls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BadgeLabPanel, BADGE_LAB_FAMILIES } from "@/components/settings/BadgeLabPanel"
import { BADGE_FAMILY_IDS } from "@/lib/badge-preset"

let staged: Record<string, unknown> | null = null
let saved: Record<string, unknown> | null = null
let flatDefaults: Record<string, unknown> | null = null
let landProfile: Record<string, unknown> | undefined = undefined
let shape: "poster" | "landscape" = "poster"
let userId: string | null = "123e4567-e89b-12d3-a456-426614174000"
let hasSelected = true

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: staged,
    setFamilyPreset: vi.fn(),
    dropFamilyPreset: vi.fn(),
    posterShape: shape,
    legacyPresetTarget: null,
    defaultBadgePresets: flatDefaults,
    setDefaultFamilyPreset: vi.fn(),
    landscape: landProfile !== undefined ? { badgePresets: landProfile } : {},
    setLandscape: vi.fn(),
  }),
}))

vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({
      selected: hasSelected ? { id: 1, media_type: "movie" } : null,
      mappingsMap: new Map(saved ? [["movie:1", { badgePresets: saved }]] : []),
      currentUserId: userId,
    }),
}))

vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k, lang: "en" }),
}))

vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: [] })),
  getCachedLegacyPresetTarget: vi.fn(() => undefined),
  resolveLegacyPresetTarget: vi.fn(async () => null),
}))

beforeEach(() => {
  staged = null
  saved = null
  flatDefaults = null
  landProfile = undefined
  shape = "poster"
  userId = "123e4567-e89b-12d3-a456-426614174000"
  hasSelected = true
  vi.restoreAllMocks()
})

describe("BadgeLabPanel family coverage", () => {
  it("covers all 9 badge families with no duplicate mechanisms", () => {
    expect([...BADGE_LAB_FAMILIES].sort()).toEqual([...BADGE_FAMILY_IDS].sort())
    expect(BADGE_LAB_FAMILIES).toHaveLength(9)
  })

  it("title scope renders all 9 family rows plus the Lab editor entry", () => {
    render(<BadgeLabPanel scope="title" />)
    expect(screen.getByTestId("badge-lab-panel-title")).toBeInTheDocument()
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-choice-title-${family}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId("badge-lab-panel-title-open-editor")).toBeInTheDocument()
    // No Community entries (hidden while Community is on pause) and no
    // per-row action buttons: one select per family + one Lab entry.
    expect(screen.queryByTestId("badge-lab-panel-title-community")).toBeNull()
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-choice-title-${family}-select`)).toBeInTheDocument()
      expect(screen.queryByTestId(`family-choice-title-${family}-community`)).toBeNull()
      expect(screen.queryByTestId(`family-choice-title-${family}-lab`)).toBeNull()
      expect(screen.queryByTestId(`family-choice-title-${family}-standard`)).toBeNull()
      expect(screen.queryByTestId(`family-choice-title-${family}-follow`)).toBeNull()
      expect(screen.queryByTestId(`family-choice-title-${family}-saved`)).toBeNull()
    }
    // The old standalone 9-row card stays gone.
    expect(screen.queryByTestId("badge-family-presets")).toBeNull()
  })

  it("title scope renders nothing without a selected title", () => {
    hasSelected = false
    const { container } = render(<BadgeLabPanel scope="title" />)
    expect(container.firstChild).toBeNull()
  })

  it("defaults scope renders all 9 family rows in both shapes", () => {
    const { unmount } = render(<BadgeLabPanel scope="defaults" active shape="portrait" />)
    expect(screen.getByTestId("badge-lab-panel-defaults")).toBeInTheDocument()
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-choice-defaults-${family}`)).toBeInTheDocument()
    }
    expect(screen.queryByTestId("badge-family-presets")).toBeNull()
    unmount()
    render(<BadgeLabPanel scope="defaults" active shape="landscape" />)
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-choice-defaults-${family}`)).toBeInTheDocument()
    }
  })

  it("defaults scope hides (never unmounts state) when inactive", () => {
    render(<BadgeLabPanel scope="defaults" active={false} shape="portrait" />)
    const panel = screen.getByTestId("badge-lab-panel-defaults")
    expect(panel).not.toBeVisible()
    // Rows stay mounted so staged edits survive tab switches.
    expect(screen.getByTestId("family-choice-defaults-genre")).toBeInTheDocument()
  })

  it("anonymous users still see all rows (profile-aware, no crash)", () => {
    userId = null
    render(<BadgeLabPanel scope="title" />)
    for (const family of BADGE_FAMILY_IDS) {
      expect(screen.getByTestId(`family-choice-title-${family}`)).toBeInTheDocument()
    }
  })
})

describe("BadgeLabPanel leave guards", () => {
  it("title Lab entry guards on staged families even when mappingDirty is clean", async () => {
    staged = { genre: null }
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<BadgeLabPanel scope="title" />)
    await user.click(screen.getByTestId("badge-lab-panel-title-open-editor"))
    expect(confirm).toHaveBeenCalledWith("ui.labDiscardChanges")
    confirm.mockRestore()
  })

  it("title Lab entry guards on mappingDirty without family staging", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<BadgeLabPanel scope="title" hasUnsavedEdits />)
    await user.click(screen.getByTestId("badge-lab-panel-title-open-editor"))
    expect(confirm).toHaveBeenCalledWith("ui.labDiscardChanges")
    confirm.mockRestore()
  })

  it("title Lab entry does not prompt when fully clean", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<BadgeLabPanel scope="title" />)
    await user.click(screen.getByTestId("badge-lab-panel-title-open-editor"))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it("defaults Lab entry guards on the global dirty scope (gradient/artwork/defaults)", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<BadgeLabPanel scope="defaults" active hasUnsavedEdits />)
    await user.click(screen.getByTestId("badge-lab-panel-defaults-open-editor"))
    expect(confirm).toHaveBeenCalledWith("ui.labDiscardChanges")
    confirm.mockRestore()
  })

  it("defaults Lab entry does not prompt when the session is clean", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<BadgeLabPanel scope="defaults" active />)
    await user.click(screen.getByTestId("badge-lab-panel-defaults-open-editor"))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})

describe("BadgeLabPanel preview family dispatch", () => {
  it("reports the pertinent preview family on focus without writing", async () => {
    const seen: string[] = []
    render(<BadgeLabPanel scope="defaults" active onPreviewFamilyChange={(f) => seen.push(f)} />)
    fireEvent.focus(screen.getByTestId("family-choice-defaults-genre-select"))
    fireEvent.focus(screen.getByTestId("family-choice-defaults-separateRatings-select"))
    fireEvent.focus(screen.getByTestId("family-choice-defaults-rank-select"))
    expect(seen).toEqual(["genre", "ratings", "rank"])
  })
})

describe("BadgeLabPanel staging persistence", () => {
  it("staged choices survive an unmount/remount (tab switch never resets state)", () => {
    staged = { genre: null }
    const { unmount } = render(<BadgeLabPanel scope="title" />)
    // Persisted-Standard staged clear renders native: displayed as Default.
    expect((screen.getByTestId("family-choice-title-genre-select") as HTMLSelectElement).value).toBe("")
    unmount()
    render(<BadgeLabPanel scope="title" />)
    expect((screen.getByTestId("family-choice-title-genre-select") as HTMLSelectElement).value).toBe("")
  })
})
