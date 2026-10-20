/**
 * G2 correction c1 — FamilyChoiceControl UI truthfulness (dropdown-only).
 *
 * - select shows the TITLE-owned choice (saved pin incl. effective legacy),
 *   never a space-default custom as a pinned title and never a placeholder
 *   while pinned;
 * - legacy select value uses the EFFECTIVE shape mapping (landscape-owned
 *   pair), not the saved flat pair;
 * - rows carry no leave links: the single Lab editor entry on the dedicated
 *   panel owns the unsaved dirty guard (no silent sibling-staged discard).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { FamilyChoiceControl } from "@/components/settings/FamilyChoiceControl"

const setFamilyPreset = vi.fn()
const dropFamilyPreset = vi.fn()

let staged: Record<string, unknown> | null = null
let savedMapping: Record<string, unknown> | null = null
let shape: "poster" | "landscape" = "poster"

vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => ({
    badgePresets: staged,
    setFamilyPreset,
    dropFamilyPreset,
    posterShape: shape,
    legacyPresetTarget: "quality",
    defaultBadgePresets: null,
    setDefaultFamilyPreset: vi.fn(),
    landscape: {},
    setLandscape: vi.fn(),
  }),
}))

vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: Record<string, unknown>) => unknown) =>
    sel({
      selected: { id: 1, media_type: "movie" },
      mappingsMap: new Map(savedMapping ? [["movie:1", savedMapping]] : []),
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
  downloads: 1,
}

vi.mock("@/lib/presets-client", () => ({
  listMyPresets: vi.fn(async () => ({ presets: [mineQuality] })),
  getCachedLegacyPresetTarget: vi.fn(() => "quality"),
  resolveLegacyPresetTarget: vi.fn(async () => "quality"),
}))

beforeEach(() => {
  staged = null
  savedMapping = null
  shape = "poster"
  setFamilyPreset.mockClear()
  dropFamilyPreset.mockClear()
})

describe("FamilyChoiceControl c1 select truthfulness", () => {
  it("reopened title custom pin shows in the select (not placeholder)", async () => {
    savedMapping = { badgePresets: { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } } }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
  })

  it("staged custom shows in the select", async () => {
    staged = { quality: { id: "Abc123-_XyZ", rev: "deadbeef" } }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
  })

  it("legacy select value uses the landscape-owned pair, not the flat", async () => {
    shape = "landscape"
    savedMapping = {
      badgePresetId: "FlatTop12-34",
      badgePresetRev: "ffffffff",
      landscape: { badgePresetId: "Abc123-_XyZ", badgePresetRev: "deadbeef" },
    }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    const select = await screen.findByTestId("family-choice-title-quality-select")
    expect((select as HTMLSelectElement).value).toBe("Abc123-_XyZ")
  })
})

describe("FamilyChoiceControl row carries no leave links", () => {
  it("no per-row Lab/Community entries (single panel entry owns the guard)", async () => {
    staged = { rank: { id: "Qwerty12-34", rev: null } }
    render(<FamilyChoiceControl scope="title" family="quality" />)
    await screen.findByTestId("family-choice-title-quality-select")
    expect(screen.queryByTestId("family-choice-title-quality-lab")).toBeNull()
    expect(screen.queryByTestId("family-choice-title-quality-community")).toBeNull()
  })
})
