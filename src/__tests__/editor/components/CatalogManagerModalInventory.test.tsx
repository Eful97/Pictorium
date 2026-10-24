import { useState } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { CatalogManagerModal } from "@/components/CatalogManagerModal"
import { renderWithCtx } from "@/__tests__/test-utils"
import { PICTORIUM_CATALOGS } from "@/lib/catalog-definitions"
import {
  streamingCatalogName,
  genericStreamingCatalogName,
  genericStreamingCatalogId,
} from "@/lib/streaming-catalogs"
import { stripCatalogEmojis, resolveCatalogDisplayName } from "@/lib/ranking-source"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  // Key passthrough WITH count interpolation so footer/bulk counts stay assertable.
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params && typeof params.count === "number" ? `${key}:${params.count}` : key,
    lang: "it",
  }),
}))

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open-manager</button>
      <CatalogManagerModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}

function openManager(overrides?: Parameters<typeof renderWithCtx>[1]) {
  const view = renderWithCtx(<Harness />, overrides)
  fireEvent.click(screen.getByRole("button", { name: "open-manager" }))
  screen.getByRole("dialog", { name: "ui.catMgrTitle" })
  return { view }
}

function rowByTitle(title: string): HTMLElement {
  const el = screen.getByText(title)
  const row = el.closest("div[draggable]")
  if (!row) throw new Error(`manager row not found for ${title}`)
  return row as HTMLElement
}

function rowsByTitle(title: string): HTMLElement[] {
  return screen
    .getAllByText(title)
    .map((el) => el.closest("div[draggable]"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
}

function rowByTitleAndType(title: string, typeLabel: string): HTMLElement {
  const rows = rowsByTitle(title)
  const match = rows.find((row) => within(row).queryByText(typeLabel) !== null)
  if (!match) throw new Error(`manager row not found for ${title} / ${typeLabel}`)
  return match
}

const NETFLIX_TITLE = "🔴 Netflix Italia - Top 10"

describe("CatalogManagerModal effective inventory (opt-in ghosts)", () => {
  it("hides legacy platform rows in curated mode but keeps JW + anime + curated rows", () => {
    const { view } = openManager({
      streamingSelections: [{ service: "netflix", country: "IT" }],
    })
    // Legacy platform ghosts are gone (they are not served while opt-in).
    expect(screen.queryByText("🔴 Netflix — Film")).toBeNull()
    expect(screen.queryByText("🔴 Netflix — Serie TV")).toBeNull()
    // Effective inventory stays: general JW + anime + the chosen lists.
    // Both curated splits share the brief default name (no section suffix);
    // the separate Film/Serie TV type badges keep them distinct.
    expect(screen.getAllByText(NETFLIX_TITLE)).toHaveLength(2)
    expect(screen.getAllByRole("combobox")).toHaveLength(2 + 2 + 2)
    // Footer counts actual enabled emitted catalogs, not hidden rows.
    expect(screen.getByText("ui.enabledCount:6")).toBeTruthy()
    view.unmount()
  })

  it("legacy mode is unchanged: all historical platforms stay manageable", () => {
    const { view } = openManager({ streamingSelections: undefined })
    expect(screen.getByText("🔴 Netflix — Film")).toBeTruthy()
    expect(screen.getAllByRole("combobox")).toHaveLength(PICTORIUM_CATALOGS.length)
    view.unmount()
  })

  it("disabled factory JW stays manageable via Power (no trash, no bulk)", () => {
    const toggleBuiltinCatalog = vi.fn()
    const { view } = openManager({
      disabledCatalogIds: ["pictorium-jw-movies"],
      toggleBuiltinCatalog,
    })
    const row = rowByTitle("🇮🇹 Top 20 Italia — Film")
    // No per-list trash on factory rows (toggle-only, never deletable).
    expect(within(row).queryByTitle("ui.deleteCatalog")).toBeNull()
    expect(within(row).queryByTitle("ui.removeDefaultList")).toBeNull()
    // Power re-enables the hidden row.
    fireEvent.click(within(row).getByTitle("ui.enableStremio"))
    expect(toggleBuiltinCatalog).toHaveBeenCalledWith("pictorium-jw-movies")
    view.unmount()
  })
})

describe("CatalogManagerModal per-section streaming delete", () => {
  it("series trash removes only the series list (movie sibling stays)", () => {
    const removeStreamingSelection = vi.fn()
    const { view } = openManager({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      removeStreamingSelection,
    })
    const seriesRow = rowByTitleAndType(NETFLIX_TITLE, "ui.tvSeries")
    fireEvent.click(within(seriesRow).getByTitle("ui.deleteCatalog"))
    expect(removeStreamingSelection).toHaveBeenCalledTimes(1)
    expect(removeStreamingSelection).toHaveBeenCalledWith("netflix", "italy", "auto", null, "series")
    // Sibling movie row is untouched (narrow, never wipe).
    expect(rowByTitleAndType(NETFLIX_TITLE, "ui.movie")).toBeTruthy()
    view.unmount()
  })
})

describe("CatalogManagerModal bulk delete", () => {
  it("removes selected streaming lists atomically, factory JW excluded", () => {
    const removeStreamingSelections = vi.fn(() => ({ removed: 2, droppedIds: [] }))
    const removeCustomCatalogs = vi.fn()
    const setDisabledCatalogIds = vi.fn()
    const { view } = openManager({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      removeStreamingSelections,
      removeCustomCatalogs,
      setDisabledCatalogIds,
    })
    // Select everything, then confirm the destructive batch (two-step).
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    const bulk = screen.getByRole("button", { name: "ui.bulkDelete:2" })
    fireEvent.click(bulk)
    fireEvent.click(screen.getByRole("button", { name: "ui.bulkDeleteConfirm:2" }))
    expect(removeStreamingSelections).toHaveBeenCalledTimes(1)
    expect(removeStreamingSelections).toHaveBeenCalledWith([
      { service: "netflix", country: "italy", source: "auto", variant: null, section: "movies" },
      { service: "netflix", country: "italy", source: "auto", variant: null, section: "series" },
    ])
    expect(removeCustomCatalogs).not.toHaveBeenCalled()
    // Factory JW ids are never disabled/removed by the batch.
    expect(setDisabledCatalogIds).not.toHaveBeenCalled()
    // Selection clears after the batch.
    expect(screen.getByRole("button", { name: "ui.selectAll" })).toBeTruthy()
    view.unmount()
  })

  it("deletes a whole custom provider only when all its sections are selected", () => {
    const removeCustomCatalogs = vi.fn()
    const removeStreamingSelections = vi.fn(() => ({ removed: 0, droppedIds: [] }))
    const { view } = openManager({
      customCatalogs: [{ id: "mix", name: "Mix", type: "mixed", url: "https://mdblist.com/lists/u/mix" }],
      removeCustomCatalogs,
      removeStreamingSelections,
    })
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.bulkDelete:2" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.bulkDeleteConfirm:2" }))
    expect(removeCustomCatalogs).toHaveBeenCalledTimes(1)
    expect(removeCustomCatalogs).toHaveBeenCalledWith(
      ["mix"],
      ["pictorium-custom-movie-mix", "pictorium-custom-series-mix"],
    )
    view.unmount()
  })

  it("arming then changing the selection requires a fresh confirm (no stale execute)", () => {
    const removeStreamingSelections = vi.fn(() => ({ removed: 1, droppedIds: [] }))
    const { view } = openManager({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      removeStreamingSelections,
      removeCustomCatalogs: vi.fn(),
    })
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    // Arm on both lists.
    fireEvent.click(screen.getByRole("button", { name: "ui.bulkDelete:2" }))
    expect(screen.getByRole("button", { name: "ui.bulkDeleteConfirm:2" })).toBeTruthy()
    // Switch the selection while non-empty: the armed confirm must lapse.
    const moviesRow = rowByTitleAndType(NETFLIX_TITLE, "ui.movie")
    fireEvent.click(within(moviesRow).getAllByRole("button")[0])
    expect(screen.queryByRole("button", { name: /ui\.bulkDeleteConfirm/ })).toBeNull()
    const rearm = screen.getByRole("button", { name: "ui.bulkDelete:1" })
    fireEvent.click(rearm)
    // First click after the switch only re-arms — nothing is deleted.
    expect(removeStreamingSelections).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "ui.bulkDeleteConfirm:1" }))
    expect(removeStreamingSelections).toHaveBeenCalledTimes(1)
    expect(removeStreamingSelections).toHaveBeenCalledWith([
      { service: "netflix", country: "italy", source: "auto", variant: null, section: "series" },
    ])
    view.unmount()
  })

  it("skips a partially selected custom provider (never deletes one section of a pair)", () => {
    const removeCustomCatalogs = vi.fn()
    const { view } = openManager({
      customCatalogs: [{ id: "mix", name: "Mix", type: "mixed", url: "https://mdblist.com/lists/u/mix" }],
      removeCustomCatalogs,
      removeStreamingSelections: vi.fn(() => ({ removed: 0, droppedIds: [] })),
    })
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    // Unselect just the series split (row select = first button in the row).
    const seriesRow = rowByTitle("Mix — ui.tvSeries")
    fireEvent.click(within(seriesRow).getAllByRole("button")[0])
    // Nothing deletable remains: the action disables instead of inventing a partial delete.
    expect(screen.getByRole("button", { name: "ui.bulkDelete:0" })).toBeDisabled()
    expect(removeCustomCatalogs).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe("CatalogManagerModal seasonal keywords disclosure", () => {
  it("starts collapsed, expands to editable fields, preserves values across collapse", () => {
    const { view } = openManager({
      seasonalHalloweenKeywords: ["spooky"],
      seasonalChristmasKeywords: [],
    })
    const disclosure = screen.getByRole("button", { name: "ui.seasonalKeywordsTitle" })
    expect(disclosure).toHaveAttribute("aria-expanded", "false")
    expect(disclosure).toHaveAttribute("aria-controls", "seasonal-keywords-panel")
    // Collapsed: fields are hidden accessibly (kept mounted, no remount).
    expect(screen.queryByRole("textbox", { name: "ui.seasonalHalloweenKeywords" })).toBeNull()
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute("aria-expanded", "true")
    const halloween = screen.getByRole("textbox", { name: "ui.seasonalHalloweenKeywords" })
    const christmas = screen.getByRole("textbox", { name: "ui.seasonalChristmasKeywords" })
    expect(halloween).toHaveValue("spooky")
    // Edit, collapse, reopen: the draft survives (no remount clearing).
    fireEvent.change(halloween, { target: { value: "spooky, cozy" } })
    expect(christmas).toHaveValue("")
    fireEvent.click(disclosure)
    expect(screen.queryByRole("textbox", { name: "ui.seasonalHalloweenKeywords" })).toBeNull()
    fireEvent.click(disclosure)
    expect(screen.getByRole("textbox", { name: "ui.seasonalHalloweenKeywords" })).toHaveValue("spooky, cozy")
    view.unmount()
  })

  it("toggling the disclosure never touches row selection", () => {
    const { view } = openManager({
      streamingSelections: [{ service: "netflix", country: "IT" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "ui.selectAll" }))
    expect(screen.getByText("ui.selectedCount:6")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "ui.seasonalKeywordsTitle" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.seasonalKeywordsTitle" }))
    expect(screen.getByText("ui.selectedCount:6")).toBeTruthy()
    view.unmount()
  })
})

describe("streaming default Top 10 names (brief contract)", () => {
  it("legacy + generic + mixed share one brief title for the same provider+country", () => {
    // No flag, no section suffix, no bullets: type stays a separate badge/descriptor.
    expect(streamingCatalogName("netflix", "IT", "movies")).toBe("🔴 Netflix Italia - Top 10")
    expect(streamingCatalogName("netflix", "IT", "series")).toBe("🔴 Netflix Italia - Top 10")
    expect(genericStreamingCatalogName("paramount", "italy", "all", null)).toBe("🏔️ Paramount+ Italia - Top 10")
    expect(genericStreamingCatalogName("netflix", "italy", "movies", null)).toBe("🔴 Netflix Italia - Top 10")
    for (const name of [
      streamingCatalogName("netflix", "IT", "movies"),
      genericStreamingCatalogName("paramount", "italy", "all", null),
    ]) {
      expect(name).not.toContain("🇮🇹")
      expect(name).not.toContain("Film")
      expect(name).not.toContain("Serie")
      expect(name).not.toContain("·")
      expect(name).not.toContain("—")
    }
  })

  it("variant suffix is dropped from the name but kept in the id", () => {
    expect(genericStreamingCatalogName("rai", "italy", "series", "it")).toBe("📡 Rai Italia - Top 10")
    expect(genericStreamingCatalogId("rai", "italy", "series", "auto", "it")).toBe(
      "pictorium-stream2-rai--italy--series--auto--it",
    )
  })

  it("unknown generic brands get the honest 📺 fallback (never a guessed brand)", () => {
    expect(genericStreamingCatalogName("hulu", "united-states", "series", null)).toBe("📺 Hulu USA - Top 10")
    expect(genericStreamingCatalogName("tubi", "italy", "movies", null)).toBe("📺 Tubi Italia - Top 10")
    expect(genericStreamingCatalogName("discovery-plus", "italy", "movies", null)).toBe("🌍 Discovery Plus Italia - Top 10")
  })

  it("provider emoji respects showEmojis OFF without padding; renames stay verbatim", () => {
    expect(resolveCatalogDisplayName("🔴 Netflix Italia - Top 10", false)).toBe("Netflix Italia - Top 10")
    expect(resolveCatalogDisplayName("🔴 Netflix Italia - Top 10", true)).toBe("🔴 Netflix Italia - Top 10")
    expect(stripCatalogEmojis("🏔️ Paramount+ Italia - Top 10")).toBe("Paramount+ Italia - Top 10")
    expect(stripCatalogEmojis("📡 Rai Italia - Top 10")).toBe("Rai Italia - Top 10")
    expect(stripCatalogEmojis("🌍 Discovery Plus Italia - Top 10")).toBe("Discovery Plus Italia - Top 10")
    expect(stripCatalogEmojis("📺 Tubi Italia - Top 10")).toBe("Tubi Italia - Top 10")
    expect(resolveCatalogDisplayName("My Custom", false)).toBe("My Custom")
  })

  it("country label follows the existing localization mechanism", () => {
    expect(streamingCatalogName("prime", "US", "movies")).toContain("USA")
    expect(genericStreamingCatalogName("hulu", "united-states", "series", null)).toContain("USA")
  })
})
