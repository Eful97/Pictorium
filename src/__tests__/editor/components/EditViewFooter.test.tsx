import { describe, it, expect, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { defaultsStorageKey } from "@/lib/useDefaults"
import { t } from "@/lib/i18n"
import type { SearchResult } from "@/lib/types"

const mockSelected: SearchResult = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  name: "",
  poster_path: "/fc.jpg",
  release_date: "1999-10-15",
}

const previewPoster = { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }

const savedMapping = {
  tmdbId: 550,
  mediaType: "movie" as const,
  title: "Fight Club",
  posterPath: "/fc.jpg",
  logoPath: null,
  originalPosterPath: null,
  language: null,
  updatedAt: "2026-01-01",
  posterShape: "poster" as const,
}

function renderFooter(overrides?: Parameters<typeof renderWithCtx>[1]) {
  const utils = renderWithCtx(
    <EditView />,
    { selected: mockSelected, previewPoster, ...overrides },
  )
  const grid = utils.container.querySelector(".editor-panel-footer .grid")
  expect(grid).toBeInTheDocument()
  const buttons = Array.from(grid!.querySelectorAll(":scope > button"))
  const byLabel = (label: string) => {
    const btn = buttons.find((b) => b.getAttribute("aria-label") === label)
    expect(btn, `footer button "${label}"`).toBeInTheDocument()
    return btn!
  }
  return { ...utils, grid: grid!, buttons, byLabel }
}

describe("EditView footer action grid", () => {
  it("lays actions out in an aligned responsive grid with equal-height buttons", () => {
    const { grid, buttons } = renderFooter()
    expect(grid).toHaveClass("grid")
    expect(grid).toHaveClass("grid-cols-1")
    expect(grid.className).toContain("min-[420px]:grid-cols-2")
    expect(grid).toHaveClass("items-stretch")
    expect(grid).toHaveClass("auto-rows-fr")
    // Equal heights + 44px minimum touch targets, wrapping text allowed.
    for (const btn of buttons) {
      expect(btn).toHaveClass("min-h-[44px]")
      expect(btn).toHaveClass("h-full")
      expect(btn).toHaveClass("w-full")
      expect(btn.className).not.toContain("truncate")
    }
    // No fixed physical alignment that would break RTL document direction.
    for (const btn of buttons) {
      expect(btn.className).not.toContain("text-left")
      expect(btn.className).not.toContain("text-right")
      expect(btn.className).not.toContain("justify-start")
      expect(btn.className).not.toContain("justify-end")
    }
  })

  it("keeps Save Poster the only primary action; Test/Cover subdued, Remove quiet red", () => {
    const mappingsMap = new Map([["movie:550", savedMapping]])
    const { byLabel } = renderFooter({ mappingsMap })
    const save = byLabel("ui.savePoster")
    const test = byLabel(t("ui.testStremioUrl"))
    const cover = byLabel("ui.saveCoverOnly")
    const remove = byLabel("ui.remove")
    // Only Save is primary (idle unsaved state here is covered separately;
    // with a clean mapping Save shows the emerald saved status instead).
    expect(test).toHaveClass("btn-secondary")
    expect(test).not.toHaveClass("btn-primary")
    expect(cover).toHaveClass("btn-secondary")
    expect(cover).not.toHaveClass("btn-primary")
    // Quiet destructive: red text/icon on a faint background, not a loud danger fill.
    expect(remove).not.toHaveClass("btn-danger")
    expect(remove.className).toContain("text-red-300")
    expect(remove.className).toContain("border-red-500/25")
    expect(remove.className).toContain("bg-red-500/10")
    expect(save).not.toHaveClass("btn-secondary")
    // Idle unsaved footer Save is the single primary action in the grid.
    expect(save).toHaveClass("btn-primary")
  })

  it("uses consistent 18px icon geometry across all footer actions", () => {
    const mappingsMap = new Map([["movie:550", savedMapping]])
    const { grid } = renderFooter({ mappingsMap })
    const icons = Array.from(grid.querySelectorAll("button svg"))
    expect(icons.length).toBeGreaterThanOrEqual(4)
    for (const icon of icons) {
      expect(icon.classList.contains("w-[18px]")).toBe(true)
      expect(icon.classList.contains("h-[18px]")).toBe(true)
    }
  })

  it("omits Remove when no mapping exists: natural 3-item flow, no placeholders", () => {
    const { grid, buttons } = renderFooter()
    expect(buttons).toHaveLength(3)
    expect(grid.children).toHaveLength(3)
    for (const child of Array.from(grid.children)) {
      expect(child.tagName.toLowerCase()).toBe("button")
    }
    expect(screen.queryByRole("button", { name: "ui.remove" })).not.toBeInTheDocument()
  })

  it("shows Remove and deletes the mapping only after explicit confirmation", async () => {
    const u = userEvent.setup()
    const removeMapping = vi.fn(async () => {})
    const mappingsMap = new Map([["movie:550", savedMapping]])
    const { buttons, byLabel } = renderFooter({ mappingsMap, removeMapping })
    expect(buttons).toHaveLength(4)

    // Cancel keeps the title and the saved mapping: no DELETE.
    await u.click(byLabel("ui.remove"))
    const cancelDialog = await screen.findByRole("dialog", { name: t("ui.confirmDelete") })
    await u.click(within(cancelDialog).getByRole("button", { name: t("ui.cancelAction") }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: t("ui.confirmDelete") })).toBeNull())
    expect(removeMapping).not.toHaveBeenCalled()

    // Explicit confirm deletes with the saved mapping.
    await u.click(byLabel("ui.remove"))
    const confirmDialog = await screen.findByRole("dialog", { name: t("ui.confirmDelete") })
    await u.click(within(confirmDialog).getByRole("button", { name: t("ui.delete") }))
    await waitFor(() => expect(removeMapping).toHaveBeenCalledTimes(1))
    expect(removeMapping).toHaveBeenCalledWith(savedMapping)
  })

  it("preserves full-save click semantics", async () => {
    const u = userEvent.setup()
    const saveConfig = vi.fn(async () => true)
    const { byLabel } = renderFooter({ saveConfig })
    await u.click(byLabel("ui.savePoster"))
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })

  it("preserves cover-only click semantics and hint", async () => {
    const u = userEvent.setup()
    const saveCoverOnly = vi.fn(async () => true)
    const { byLabel } = renderFooter({ saveCoverOnly })
    const cover = byLabel("ui.saveCoverOnly")
    expect(cover).toHaveAttribute("title", "ui.saveCoverOnlyHint")
    await u.click(cover)
    expect(saveCoverOnly).toHaveBeenCalledTimes(1)
  })

  it("routes the Test action through the Stremio preview trigger", async () => {
    const u = userEvent.setup()
    const setStremioPreview = vi.fn()
    const { byLabel } = renderFooter({ setStremioPreview })
    await u.click(byLabel(t("ui.testStremioUrl")))
    expect(setStremioPreview).toHaveBeenCalledWith(true)
  })

  it("shows the saving state and disables footer saves while a save is in flight", async () => {
    const u = userEvent.setup()
    let resolveSave!: (v: boolean) => void
    const saveConfig = vi.fn(() => new Promise<boolean>((res) => { resolveSave = res }))
    const { byLabel } = renderFooter({ saveConfig })
    const save = byLabel("ui.savePoster")
    const cover = byLabel("ui.saveCoverOnly")
    const inFlight = u.click(save)
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(save).toBeDisabled()
      expect(cover).toBeDisabled()
    })
    expect(save.textContent).toBe("ui.saving")
    resolveSave(true)
    await inFlight
    await waitFor(() => {
      expect(save).toBeEnabled()
      expect(cover).toBeEnabled()
    })
  })

  it("shows the error status on save failure without promoting secondary actions", async () => {
    const u = userEvent.setup()
    const saveConfig = vi.fn(async () => false)
    const { byLabel, grid } = renderFooter({ saveConfig })
    await u.click(byLabel("ui.savePoster"))
    // Scope to the footer grid: the mobile quick-save bar mirrors the same state.
    const save = await within(grid as HTMLElement).findByText("ui.saveError")
    const saveBtn = save.closest("button")!
    expect(saveBtn).toHaveClass("btn-danger")
    // Secondary actions stay subdued even in the error status.
    expect(byLabel("ui.saveCoverOnly")).toHaveClass("btn-secondary")
    expect(byLabel("ui.saveCoverOnly")).not.toHaveClass("btn-primary")
    expect(byLabel(t("ui.testStremioUrl"))).toHaveClass("btn-secondary")
  })

  it("keeps the emerald saved status (not primary) when the mapping is clean", () => {
    const mappingsMap = new Map([["movie:550", savedMapping]])
    const fcPoster = { file_path: "/fc.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
    // renderWithCtx mocks PictoriumProvider: hydrate the stored defaults with
    // the portrait shape default so the live editor matches the real
    // title-open chain (-4/+6 quality offsets) instead of the 0/0 hook seed.
    localStorage.setItem(defaultsStorageKey(), JSON.stringify({ defaultPosterShape: "poster" }))
    try {
      const { byLabel } = renderFooter({ mappingsMap, posters: [fcPoster], previewPoster: fcPoster })
      const save = byLabel("ui.savePoster")
      expect(save.textContent).toBe("ui.savedShort")
      expect(save).not.toHaveClass("btn-primary")
      expect(save.className).toContain("emerald")
    } finally {
      localStorage.removeItem(defaultsStorageKey())
    }
  })
})
