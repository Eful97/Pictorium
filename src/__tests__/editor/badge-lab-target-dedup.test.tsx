/**
 * Badge Lab single-Classifica UI (user request: "badge superiore e
 * classifica sono la stessa cosa. mettiamo solo classifica").
 *
 * - The Lab target selector offers ONLY the UI-visible targets
 *   (`LAB_VISIBLE_TARGETS`): no duplicate "Badge superiore"/`top` option,
 *   single Classifica (`rank`); Extra stays its own separate target.
 * - A stored/imported legacy `top` preset still opens with Classifica
 *   selected (never a blank selection) and saves its verbatim `top` target
 *   (no silent migration: `top` fans out to rank+extra at render, `rank`
 *   would not — migrating would change rendered output).
 * - The public contract is untouched: `BADGE_TARGETS` still accepts `top`
 *   (presets/URLs/imports keep validating) and the community `rank` filter
 *   surfaces legacy `top` presets (see `isCommunityTargetMatch`).
 *
 * Rendering is byte-identical by construction (no builder/template touched:
 * 8 top + 6 extra + 7 genre shared native templates); pixel parity stays
 * covered by `badge-native-parity.test.ts` + `badge-preset-templates.test.ts`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
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
  currentPathUuid: () => OWNER,
  isUserUnlocked: () => true,
  USER_UNLOCK_EVENT: "pictorium:user-unlock",
}))

import BadgeLabPage from "@/app/lab/badges/page"
import { createPreset } from "@/lib/presets-client"
import {
  badgePresetSchema,
  computePresetFullRevision,
  isCommunityTargetMatch,
  LAB_VISIBLE_TARGETS,
  labVisibleTargetFor,
  normalizeBadgeDesign,
} from "@/lib/badge-preset"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

const legacyTopPreset = {
  version: 1 as const,
  id: "TopLegacy1",
  ownerUuid: OWNER,
  target: "top" as const,
  visibility: "public" as const,
  metadata: { name: "Legacy Top", tags: ["legacy"] },
  variant: "custom" as const,
  design: normalizeBadgeDesign({
    shape: "pill",
    padding: { x: 12, y: 6 },
    background: { type: "solid", color: "#112233", opacity: 90 },
    text: {
      template: "LEGACY {{rating}}",
      color: "#ffffff",
      opacity: 100,
      fontSize: 20,
      fontWeight: 700,
      uppercase: false,
      letterSpacing: 0,
      align: "center",
    },
    scale: 100,
  }),
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  revision: computePresetFullRevision(
    "custom",
    normalizeBadgeDesign({
      shape: "pill",
      padding: { x: 12, y: 6 },
      background: { type: "solid", color: "#112233", opacity: 90 },
      text: {
        template: "LEGACY {{rating}}",
        color: "#ffffff",
        opacity: 100,
        fontSize: 20,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    }),
    undefined,
  ),
}

if (!badgePresetSchema.safeParse(legacyTopPreset).success) {
  throw new Error("legacy top fixture must stay schema-valid (public contract)")
}

/** The target Seg group: scope by its visible label, not the whole page. */
function targetGroup(): HTMLElement {
  const label = screen.getByText("ui.presetsTarget")
  const container = label.closest("div")
  if (!container) throw new Error("target label container not found")
  return container as HTMLElement
}

function targetButtonNames(): string[] {
  return within(targetGroup()).getAllByRole("button").map((b) => b.textContent ?? "")
}

function pressedTarget(): string | null {
  const pressed = within(targetGroup()).getAllByRole("button").find(
    (b) => b.getAttribute("aria-pressed") === "true",
  )
  return pressed ? (pressed.textContent ?? null) : null
}

async function importLegacyTop(): Promise<void> {
  const raw = JSON.stringify(legacyTopPreset)
  const file = new File([raw], "legacy-top.json", { type: "application/json" })
  Object.defineProperty(file, "text", { value: async () => raw })
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error("lab file input not found")
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  fireEvent.change(input)
  await screen.findByText("← Legacy Top")
}

describe("labVisibleTargetFor + LAB_VISIBLE_TARGETS (pure)", () => {
  it("offers rank and extra but never the legacy `top` alias", () => {
    expect(LAB_VISIBLE_TARGETS).toContain("rank")
    expect(LAB_VISIBLE_TARGETS).toContain("extra")
    expect(LAB_VISIBLE_TARGETS as readonly string[]).not.toContain("top")
  })

  it("maps legacy `top` to Classifica and passes every visible target through", () => {
    expect(labVisibleTargetFor("top")).toBe("rank")
    expect(labVisibleTargetFor("rank")).toBe("rank")
    expect(labVisibleTargetFor("extra")).toBe("extra")
    expect(labVisibleTargetFor("genre")).toBe("genre")
  })

  it("fail-safes unknown/absent targets to Classifica (never blank)", () => {
    expect(labVisibleTargetFor("nope")).toBe("rank")
    expect(labVisibleTargetFor(null)).toBe("rank")
    expect(labVisibleTargetFor(undefined)).toBe("rank")
  })
})

describe("isCommunityTargetMatch (pure)", () => {
  it("matches the `rank` filter against both `rank` and legacy `top` presets", () => {
    expect(isCommunityTargetMatch("rank", "rank")).toBe(true)
    expect(isCommunityTargetMatch("rank", "top")).toBe(true)
    expect(isCommunityTargetMatch("rank", "extra")).toBe(false)
    expect(isCommunityTargetMatch("genre", "genre")).toBe(true)
  })

  it("keeps explicit `top` and empty filters working verbatim", () => {
    expect(isCommunityTargetMatch("top", "top")).toBe(true)
    expect(isCommunityTargetMatch("top", "rank")).toBe(false)
    expect(isCommunityTargetMatch("", "top")).toBe(true)
    expect(isCommunityTargetMatch(null, "top")).toBe(true)
  })
})

describe("BadgeLabPage single-Classifica target selector (real page)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.mocked(createPreset).mockImplementation(async (body) => {
      const parsed = badgePresetSchema.parse({ ...legacyTopPreset, ...(body as object), id: "NewSaveTop1" })
      return { preset: parsed, downloads: 0 }
    })
  })

  it("shows a single Classifica with Extra separate and no Badge-superiore duplicate", () => {
    render(<BadgeLabPage />)
    const names = targetButtonNames()
    expect(names).toContain("ui.familyRank")
    expect(names).toContain("ui.familyExtra")
    expect(names).not.toContain("ui.topBadge")
    // One Classifica button only (no top/rank duplicate pair).
    expect(names.filter((n) => n === "ui.familyRank")).toHaveLength(1)
  })

  it("defaults a new preset to Classifica", () => {
    render(<BadgeLabPage />)
    expect(pressedTarget()).toBe("ui.familyRank")
  })

  it("opens a legacy `top` import with Classifica selected (never blank) and preserves `top` on save", async () => {
    render(<BadgeLabPage />)
    await importLegacyTop()
    // Displayed as Classifica, never a blank selection.
    expect(pressedTarget()).toBe("ui.familyRank")
    expect(targetButtonNames()).not.toContain("ui.topBadge")
    // Save keeps the verbatim legacy target (no silent migration: render
    // behavior for the top slot is unchanged).
    fireEvent.click(screen.getByRole("button", { name: "ui.labSave" }))
    await waitFor(() => expect(vi.mocked(createPreset)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createPreset).mock.calls[0][0] as { target: string }
    expect(body.target).toBe("top")
  })
})
