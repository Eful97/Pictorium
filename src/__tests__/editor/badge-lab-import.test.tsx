/**
 * T0 — Badge Lab JSON import fidelity.
 *
 * `onImportFile` in `src/app/lab/badges/page.tsx` parsed the preset through
 * `loadPresetIntoEditor` (which returns variant/house/design/meta) but only
 * applied `design` + `meta`, dropping the `variant` and `house` payload.
 * Importing an exported house preset therefore left the editor on the custom
 * branch with the house payload lost.
 *
 * These tests render the REAL page (same import path as production, not the
 * `loadPresetIntoEditor` helper in isolation) and drive the actual file input.
 *
 * The house fixture is deliberately NON-default (style/colored, scale 150,
 * polarity dark, showYear off, custom genre text) so the assertions below fail
 * when ONLY `setHouse(loaded.house)` is removed while `setVariant` remains:
 * branch-only assertions would still pass in that case and are not enough.
 *
 * NOTE: the i18n dictionaries are not loaded in this environment, so `t()`
 * renders raw keys (e.g. "ui.labSave"). Selectors below use those keys plus
 * literal placeholders, matching the ported editor structure.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@/lib/presets-client", () => ({
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  getPreset: vi.fn(),
  listMyPresets: vi.fn(async () => ({ presets: [] })),
  updatePreset: vi.fn(),
}))

vi.mock("@/lib/user-token", () => ({
  // Authorized namespace so the Save button is enabled and the save payload
  // (variant/house/forkedFrom) can be asserted through the real onSave path.
  currentPathUuid: () => OWNER,
  isUserUnlocked: () => true,
  USER_UNLOCK_EVENT: "pictorium:user-unlock",
}))

import BadgeLabPage from "@/app/lab/badges/page"
import { createPreset } from "@/lib/presets-client"
import {
  badgePresetSchema,
  computePresetFullRevision,
  normalizeBadgeDesign,
  normalizeHouseBadge,
} from "@/lib/badge-preset"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

// Non-default on every house axis: style (colored => accent picker visible),
// scale, polarity, one boolean segment and one text override. Defaults are
// style pill / scale 100 / polarity auto / all segments on / no overrides,
// so each assertion below distinguishes "house applied" from "stale defaults".
const housePayload = normalizeHouseBadge({
  style: "colored",
  showGenre: true,
  showYear: false,
  showRating: true,
  scale: 150,
  polarity: "dark",
  accent: "#ff8800",
  genreText: "Noir",
})

const housePreset = {
  version: 1 as const,
  id: "Abc123-_XyZ",
  ownerUuid: OWNER,
  target: "genre" as const,
  visibility: "public" as const,
  metadata: { name: "Golden House", tags: ["gold"] },
  variant: "house" as const,
  house: housePayload,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  revision: computePresetFullRevision("house", undefined, housePayload),
}

// Distinct template so the custom-after-house test proves the custom design
// payload (not just the branch switch) is restored.
const customDesign = normalizeBadgeDesign({
  shape: "pill",
  padding: { x: 12, y: 6 },
  background: { type: "solid", color: "#FF0000", opacity: 90 },
  text: {
    template: "CUSTOM {{genre}}",
    color: "#FFFFFF",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0,
    align: "center",
  },
  scale: 100,
})

const customPreset = {
  version: 1 as const,
  id: "ZyX987-_CbA",
  ownerUuid: OWNER,
  target: "top" as const,
  visibility: "public" as const,
  metadata: { name: "Custom Star", tags: ["star"] },
  variant: "custom" as const,
  design: customDesign,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  revision: computePresetFullRevision("custom", customDesign, undefined),
}

for (const [label, preset] of [
  ["house", housePreset],
  ["custom", customPreset],
] as const) {
  if (!badgePresetSchema.safeParse(preset).success) {
    throw new Error(`fixture ${label} preset must be schema-valid`)
  }
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error("lab file input not found")
  return input as HTMLInputElement
}

async function importJson(payload: unknown): Promise<void> {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload)
  const file = new File([raw], "preset.json", { type: "application/json" })
  // jsdom File.text() may be missing: the page only needs file.text().
  Object.defineProperty(file, "text", { value: async () => raw })
  const input = fileInput()
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  fireEvent.change(input)
  // onImportFile is async (await file.text()): let state settle.
  await screen.findByText(payload === housePreset ? "← Golden House" : "← Custom Star")
}

function nameValue(): string {
  return (screen.getByPlaceholderText("Gold top") as HTMLInputElement).value
}

function variantPressed(variant: "custom" | "house"): boolean {
  const key = variant === "custom" ? "ui.labVariantCustom" : "ui.labVariantHouse"
  return screen.getByRole("button", { name: key }).getAttribute("aria-pressed") === "true"
}

function openTab(labelKey: string): void {
  fireEvent.click(screen.getByRole("button", { name: labelKey }))
}

describe("Badge Lab JSON import fidelity (real page)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    // Real browsers ask before replacing unsaved work; auto-accept here so
    // the second import in a dirty editor exercises the replace path.
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  it("importing an exported house preset restores variant, house payload, design branch and metadata", async () => {
    render(<BadgeLabPage />)
    // Draft starts on the custom branch.
    expect(variantPressed("custom")).toBe(true)

    await importJson(housePreset)

    // Variant + house payload applied: the house branch renders.
    expect(variantPressed("house")).toBe(true)
    // Non-default house style applied: the accent picker only renders for
    // style "colored" (defaults are style "pill" with no accent row).
    openTab("ui.labBackground")
    expect(screen.getByText("ui.labHouseAccent")).toBeInTheDocument()
    // Non-default numeric payload applied (default scale is 100).
    openTab("ui.labDimensions")
    expect((screen.getByRole("slider", { name: "ui.labScale" }) as HTMLInputElement).value).toBe("150")
    // Non-default boolean segment applied (default showYear is on).
    openTab("ui.labContent")
    expect(screen.getByRole("switch", { name: "ui.badgeYear" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    // Non-default text override applied (defaults carry no genreText).
    expect((screen.getByPlaceholderText("Drama") as HTMLInputElement).value).toBe("Noir")
    // Metadata applied.
    expect(nameValue()).toBe("Golden House")
    // Fork semantics: import never resumes editing (stays "Save", not "Update").
    expect(screen.getByRole("button", { name: "ui.labSave" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ui.labUpdate" })).toBeNull()

    // Saved fork payload preserves the imported house settings and the
    // forkedFrom id of the imported preset.
    const savedPreset = badgePresetSchema.parse({ ...housePreset, id: "NewSave1234" })
    vi.mocked(createPreset).mockResolvedValue({ preset: savedPreset, downloads: 0 })
    fireEvent.click(screen.getByRole("button", { name: "ui.labSave" }))
    await waitFor(() => expect(vi.mocked(createPreset)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createPreset).mock.calls[0][0] as {
      variant: string
      house?: typeof housePayload
      forkedFrom?: string | null
    }
    expect(body.variant).toBe("house")
    expect(body.forkedFrom).toBe(housePreset.id)
    expect(body.house?.style).toBe("colored")
    expect(body.house?.scale).toBe(150)
    expect(body.house?.polarity).toBe("dark")
    expect(body.house?.showYear).toBe(false)
    expect(body.house?.genreText).toBe("Noir")
  })

  it("importing a custom preset after a house preset switches back to the custom branch", async () => {
    render(<BadgeLabPage />)
    await importJson(housePreset)
    expect(variantPressed("house")).toBe(true)

    // Custom file: bypass the notice wait (same-name helper is house-bound).
    const raw = JSON.stringify(customPreset)
    const file = new File([raw], "custom.json", { type: "application/json" })
    Object.defineProperty(file, "text", { value: async () => raw })
    const input = fileInput()
    Object.defineProperty(input, "files", { value: [file], configurable: true })
    fireEvent.change(input)

    // Custom branch renders again, house branch is gone.
    expect(await screen.findByText("← Custom Star")).not.toBeNull()
    expect(variantPressed("custom")).toBe(true)
    expect(nameValue()).toBe("Custom Star")
    // Custom design payload intact after the house detour (own template, not
    // the editor default): proves setDesign still applies on import.
    openTab("ui.labContent")
    expect((screen.getByPlaceholderText("★ {{rating}}") as HTMLInputElement).value).toBe(
      "CUSTOM {{genre}}",
    )
    expect(screen.getByRole("button", { name: "ui.labSave" })).toBeInTheDocument()
  })

  it("an invalid import does not mutate the valid draft", async () => {
    render(<BadgeLabPage />)
    await importJson(housePreset)
    expect(variantPressed("house")).toBe(true)
    expect(nameValue()).toBe("Golden House")

    const file = new File(["not json at all"], "broken.json", { type: "application/json" })
    Object.defineProperty(file, "text", { value: async () => "not json at all" })
    const input = fileInput()
    Object.defineProperty(input, "files", { value: [file], configurable: true })
    fireEvent.change(input)

    // Deterministic error for unparseable JSON, draft untouched.
    expect(await screen.findByText("ui.labImportBadJson")).not.toBeNull()
    expect(nameValue()).toBe("Golden House")
    expect(variantPressed("house")).toBe(true)
    expect(screen.getByRole("button", { name: "ui.labSave" })).toBeInTheDocument()
  })
})
