import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { DataPanel } from "@/components/settings/DataPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { t } from "@/lib/i18n"

function renderDataPanel(overrides: {
  exportData?: (opts?: unknown) => void
  importData?: (opts?: unknown) => void
  setSettingsOpen?: (v: boolean) => void
} = {}) {
  const exportData = overrides.exportData ?? vi.fn()
  const importData = overrides.importData ?? vi.fn()
  const setSettingsOpen = overrides.setSettingsOpen ?? vi.fn()
  renderWithCtx(
    <DataPanel
      active
      exportData={exportData}
      importData={importData}
      setSettingsOpen={setSettingsOpen}
      multiUserOn={false}
    />,
  )
  return { exportData, importData, setSettingsOpen }
}

function checkboxes() {
  const includeExport = screen.getByRole("checkbox", { name: t("ui.backupIncludePersonalKeys") })
  const importBox = screen.getByRole("checkbox", { name: t("ui.backupImportPersonalKeys") })
  const overwriteBox = screen.getByRole("checkbox", { name: t("ui.backupOverwritePersonalKeys") })
  return { includeExport, importBox, overwriteBox }
}

describe("DataPanel personal keys opt-ins", () => {
  it("all OFF by default, overwrite disabled", () => {
    renderDataPanel()
    const { includeExport, importBox, overwriteBox } = checkboxes()
    expect(includeExport).not.toBeChecked()
    expect(importBox).not.toBeChecked()
    expect(overwriteBox).not.toBeChecked()
    expect(overwriteBox).toBeDisabled()
    expect(screen.getByText(t("ui.backupKeysPlaintextWarn"))).toBeInTheDocument()
  })

  it("export passes the opt-in snapshot and closes settings", () => {
    const exportData = vi.fn()
    const setSettingsOpen = vi.fn()
    renderDataPanel({ exportData, setSettingsOpen })
    // Default: explicit false.
    fireEvent.click(screen.getByText(t("ui.exportJson")))
    expect(exportData).toHaveBeenCalledWith({ includePersonalKeys: false })
    expect(setSettingsOpen).toHaveBeenCalledWith(false)
    // Opt-in.
    fireEvent.click(checkboxes().includeExport)
    fireEvent.click(screen.getByText(t("ui.exportJson")))
    expect(exportData).toHaveBeenLastCalledWith({ includePersonalKeys: true })
  })

  it("import passes the flags snapshot and closes settings", () => {
    const importData = vi.fn()
    const setSettingsOpen = vi.fn()
    renderDataPanel({ importData, setSettingsOpen })
    fireEvent.click(screen.getByText(t("ui.importJson")))
    expect(importData).toHaveBeenCalledWith({ importPersonalKeys: false, overwritePersonalKeys: false })
    fireEvent.click(checkboxes().importBox)
    fireEvent.click(checkboxes().overwriteBox)
    fireEvent.click(screen.getByText(t("ui.importJson")))
    expect(importData).toHaveBeenLastCalledWith({ importPersonalKeys: true, overwritePersonalKeys: true })
    expect(setSettingsOpen).toHaveBeenCalledWith(false)
  })

  it("overwrite enables with import and resets when import is unchecked", () => {
    renderDataPanel()
    const { importBox, overwriteBox } = checkboxes()
    expect(overwriteBox).toBeDisabled()
    fireEvent.click(importBox)
    expect(screen.getByRole("checkbox", { name: t("ui.backupOverwritePersonalKeys") })).not.toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: t("ui.backupOverwritePersonalKeys") }))
    expect(screen.getByRole("checkbox", { name: t("ui.backupOverwritePersonalKeys") })).toBeChecked()
    // Unchecking import resets overwrite to false and disables it.
    fireEvent.click(importBox)
    const reset = screen.getByRole("checkbox", { name: t("ui.backupOverwritePersonalKeys") })
    expect(reset).not.toBeChecked()
    expect(reset).toBeDisabled()
  })
})
