/**
 * Dropdown-only FamilyChoiceControl (user-confirmed simplification).
 *
 * ONE always-visible native select per family:
 * - first option "Default" (ui.bsDefault), then owner-compatible saved presets;
 * - title Default = follow the space settings (staged `__follow__` drop when
 *   a saved pin/legacy/Standard-clear exists, otherwise just unstage — the
 *   save deletes the stored key and persists the per-shape follow flag);
 * - defaults flat Default = delete the family global override (native);
 *   landscape Default = delete the profile key (follow portrait);
 * - no row buttons (Standard/Follow/Saved), no row Lab/Community links, no
 *   status noise; a single Lab editor entry lives on the dedicated panel.
 * Unknown/deleted/private-inaccessible pins render native and display as a
 * disabled unavailable option — never a lying Default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FAMILY_FOLLOW_SENTINEL } from "@/lib/family-preset-follow"
import { FamilyChoiceControl } from "@/components/settings/FamilyChoiceControl"

const setFamilyPreset = vi.fn()
const dropFamilyPreset = vi.fn()
const setDefaultFamilyPreset = vi.fn()
const setLandscape = vi.fn()

let staged: Record<string, unknown> | null = null
let saved: Record<string, unknown> | null = null
let savedFollows: Record<string, unknown> | null = null
let flatDefaults: Record<string, unknown> | null = null
let landProfile: Record<string, unknown> | undefined = undefined
let shape: "poster" | "landscape" = "poster"
let minePresets: unknown[] = []

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: staged,
    setFamilyPreset,
    dropFamilyPreset,
    posterShape: shape,
    legacyPresetTarget: null,
    defaultBadgePresets: flatDefaults,
    setDefaultFamilyPreset,
    landscape: landProfile !== undefined ? { badgePresets: landProfile } : {},
    setLandscape,
  }),
}))

vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({
      selected: { id: 1, media_type: "movie" },
      mappingsMap: new Map(
        saved || savedFollows ? [["movie:1", { badgePresets: saved ?? undefined, badgePresetFollows: savedFollows ?? undefined }]] : [],
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
    visibility: "public",
    metadata: { name: "Neon Quality" },
  },
  downloads: 3,
}

vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: minePresets })),
  getCachedLegacyPresetTarget: vi.fn(() => undefined),
  resolveLegacyPresetTarget: vi.fn(async () => null),
}))

beforeEach(() => {
  staged = null
  saved = null
  savedFollows = null
  flatDefaults = null
  landProfile = undefined
  shape = "poster"
  minePresets = [mineQuality]
  setFamilyPreset.mockClear()
  dropFamilyPreset.mockClear()
  setDefaultFamilyPreset.mockClear()
  setLandscape.mockClear()
})

describe("FamilyChoiceControl title scope (dropdown-only)", () => {
  it("renders one always-visible select with Default first, no row buttons/links/status", async () => {
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect(select.tagName).toBe("SELECT")
    const options = (select as HTMLSelectElement).options
    expect(options[0].value).toBe("")
    expect(options[0].textContent).toBe("ui.bsDefault")
    expect([...options].some((o) => o.value === "Abc123-_XyZ")).toBe(true)
    // Removed row actions/links/status.
    expect(screen.queryByTestId("family-choice-title-quality-standard")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-follow")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-saved")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-lab")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-community")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-status")).toBeNull()
    expect(screen.getByText("ui.familyQuality")).toBeInTheDocument()
    expect(screen.queryByTestId("badge-family-presets")).toBeNull()
  })

  it("select is visible even with no compatible presets (Default only)", async () => {
    minePresets = []
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    const options = (select as HTMLSelectElement).options
    expect(options).toHaveLength(1)
    expect(options[0].value).toBe("")
  })

  it("Default on a pinned title stages a follow drop (overrides the pin after save)", async () => {
    saved = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    const user = userEvent.setup()
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
    await user.selectOptions(select, "")
    expect(dropFamilyPreset).toHaveBeenCalledTimes(1)
    expect(dropFamilyPreset).toHaveBeenCalledWith("quality")
    expect(setFamilyPreset).not.toHaveBeenCalled()
  })

  it("persisted Standard displays as Default without mutating until edited", async () => {
    saved = { quality: null }
    const user = userEvent.setup()
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    // Persisted Standard renders native: displayed as Default, unmutated.
    expect((select as HTMLSelectElement).value).toBe("")
    expect(setFamilyPreset).not.toHaveBeenCalled()
    expect(dropFamilyPreset).not.toHaveBeenCalled()
    // Explicit edit toward a preset then back to Default stages the follow
    // drop, so save/reopen actually follows the space settings.
    await user.selectOptions(select, "Abc123-_XyZ")
    await user.selectOptions(select, "")
    expect(dropFamilyPreset).toHaveBeenCalledWith("quality")
  })

  it("Default on a clean title just unstages (no follow flag out of thin air)", async () => {
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("")
    expect(dropFamilyPreset).not.toHaveBeenCalled()
  })

  it("selecting Default after staging a custom unstages toward follow", async () => {
    staged = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    const user = userEvent.setup()
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
    await user.selectOptions(select, "")
    expect(dropFamilyPreset).toHaveBeenCalledWith("quality")
  })

  it("staged drop displays as Default without resurrecting the saved pin", () => {
    staged = { quality: FAMILY_FOLLOW_SENTINEL }
    saved = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    expect((screen.getByTestId("family-choice-title-quality-select") as HTMLSelectElement).value).toBe("")
  })

  it("stages a compatible library preset with its revision", async () => {
    const user = userEvent.setup()
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    await user.selectOptions(select, "Abc123-_XyZ")
    await waitFor(() => {
      expect(setFamilyPreset).toHaveBeenCalledWith("quality", { id: "Abc123-_XyZ", rev: "deadbeef" })
    })
  })

  it("unknown saved pin renders native with a disabled unavailable option", async () => {
    saved = { quality: { id: "Deleted1-234", rev: "deadbeef" } }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    const el = select as HTMLSelectElement
    // Displayed as the unavailable pin (selected), never as a lying Default.
    expect(el.value).toBe("Deleted1-234")
    const opt = [...el.options].find((o) => o.value === "Deleted1-234")
    expect(opt).toBeDefined()
    expect(opt!.disabled).toBe(true)
  })

  it("library load failure shows an honest error with retry", async () => {
    const { listMyPresets } = await import("@/lib/presets-client")
    vi.mocked(listMyPresets).mockRejectedValueOnce(new Error("offline"))
    render(<FamilyChoiceControl scope="title" family="quality" />)
    expect(await screen.findByTestId("family-choice-title-quality-retry")).toBeInTheDocument()
  })
})

describe("FamilyChoiceControl defaults scope (dropdown-only)", () => {
  it("flat absent displays Default; a pinned flat entry is removed by Default", async () => {
    render(<FamilyChoiceControl scope="defaults" family="quality" />)
    // quality family has no flat entry: Default displayed, nothing staged.
    expect((await screen.findByTestId("family-choice-defaults-quality-select") as HTMLSelectElement).value).toBe("")
    expect(setDefaultFamilyPreset).not.toHaveBeenCalled()
  })

  it("defaults pinned entry: choosing Default deletes the key (native)", async () => {
    const user = userEvent.setup()
    flatDefaults = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    render(<FamilyChoiceControl scope="defaults" family="quality" />)
    const select = await screen.findByTestId("family-choice-defaults-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
    await user.selectOptions(select, "")
    expect(setDefaultFamilyPreset).toHaveBeenCalledWith("quality", undefined)
  })

  it("defaults preset choice stages the binding", async () => {
    const user = userEvent.setup()
    render(<FamilyChoiceControl scope="defaults" family="quality" />)
    const select = await screen.findByTestId("family-choice-defaults-quality-select")
    await user.selectOptions(select, "Abc123-_XyZ")
    await waitFor(() => {
      expect(setDefaultFamilyPreset).toHaveBeenCalledWith("quality", { id: "Abc123-_XyZ", rev: "deadbeef" })
    })
  })

  it("landscape Default deletes the profile key (portrait inherited)", async () => {
    const user = userEvent.setup()
    shape = "landscape"
    flatDefaults = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    landProfile = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    render(<FamilyChoiceControl scope="defaults" family="quality" shape="landscape" />)
    const select = await screen.findByTestId("family-choice-defaults-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
    await user.selectOptions(select, "")
    expect(setLandscape).toHaveBeenCalledWith({ badgePresets: {} })
  })

  it("landscape preset choice shadows the flat without touching siblings", async () => {
    const user = userEvent.setup()
    shape = "landscape"
    flatDefaults = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    landProfile = {}
    render(<FamilyChoiceControl scope="defaults" family="quality" shape="landscape" />)
    const select = await screen.findByTestId("family-choice-defaults-quality-select")
    await user.selectOptions(select, "Abc123-_XyZ")
    await waitFor(() => {
      expect(setLandscape).toHaveBeenCalledWith({
        badgePresets: { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } },
      })
    })
  })
})
