"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { http } from "@/lib/http"
import {
  MAX_PRESET_FILE_BYTES,
  buildPresetFile,
  parsePresetFileText,
  planGradientImport,
  planVisualImport,
  type GradientFileEntry,
  type VisualFileEntry,
} from "@/lib/preset-file"
import {
  addCustomGradientPreset,
  getCustomGradientPresets,
} from "@/lib/gradient-presets"
import type { VisualPreset } from "@/lib/visual-presets"

const endpoint = "/api/defaults/presets"

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32)
  return slug || "preset"
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

async function readPresets(): Promise<VisualPreset[]> {
  const result = await http<{ presets: VisualPreset[] }>(endpoint, { retries: 0 })
  return result.presets
}

/**
 * Shared preset-file transfer (visual + custom gradients). Import is
 * additive only: the fresh server list is loaded before planning, so
 * existing names are skipped (never overwritten) and only missing names
 * are POSTed one by one; gradients go through `addCustomGradientPreset`
 * with persistence required. Zero applied is info (never success); any
 * POST/auth/storage failure is error, partial counts included.
 */
export function usePresetTransfer(options?: {
  onVisualsChanged?: (next: VisualPreset[]) => void
}) {
  const { onVisualsChanged } = options ?? {}
  const { t } = useT()
  const [busy, setBusy] = useState(false)

  const exportAll = useCallback(async () => {
    setBusy(true)
    try {
      const visuals = await readPresets()
      downloadJson(`pictorium-presets-${dateStamp()}.json`, buildPresetFile({ visual: visuals, gradient: getCustomGradientPresets() }))
      toast.success(t("ui.saved"))
    } catch {
      toast.error(t("ui.visualPresetsError"))
    } finally {
      setBusy(false)
    }
  }, [t])

  const exportVisual = useCallback((preset: { name: string; values: unknown }) => {
    downloadJson(`pictorium-visual-preset-${slugify(preset.name)}.json`, buildPresetFile({ visual: [preset] }))
    toast.success(t("ui.saved"))
  }, [t])

  const exportGradients = useCallback(() => {
    downloadJson(`pictorium-gradient-presets-${dateStamp()}.json`, buildPresetFile({ gradient: getCustomGradientPresets() }))
    toast.success(t("ui.saved"))
  }, [t])

  const exportGradient = useCallback((preset: { name: string; values: unknown }) => {
    downloadJson(`pictorium-gradient-preset-${slugify(preset.name)}.json`, buildPresetFile({ gradient: [preset] }))
    toast.success(t("ui.saved"))
  }, [t])

  const importFile = useCallback(async (file: File) => {
    if (file.size > MAX_PRESET_FILE_BYTES) {
      toast.error(t("ui.presetFileTooLarge"))
      return
    }
    setBusy(true)
    try {
      let text: string
      try {
        text = await file.text()
      } catch {
        toast.error(t("ui.presetFileImportError"))
        return
      }
      const parsed = parsePresetFileText(text)
      if (!parsed.ok) {
        toast.error(t(parsed.error === "file-too-large" ? "ui.presetFileTooLarge" : "ui.presetFileInvalid"))
        return
      }
      // Server round-trip only when the file carries visuals: gradient-only
      // files import fully offline (no auth needed) and never touch visuals.
      let fresh: VisualPreset[] | null = null
      if (parsed.visual.length > 0) {
        try {
          fresh = await readPresets()
        } catch {
          toast.error(t("ui.presetFileImportError"))
          return
        }
      }
      const visualPlan = planVisualImport(fresh ?? [], parsed.visual)
      let visualOk = 0
      let failed = 0
      for (const entry of visualPlan.toAdd) {
        const body: VisualFileEntry = entry
        try {
          const result = await http<{ presets: VisualPreset[] }>(endpoint, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), retries: 0,
          })
          fresh = result.presets
          visualOk += 1
        } catch {
          failed += 1
        }
      }
      // Live snapshot AFTER all POST awaits: a gradient added concurrently
      // (even during our own visual POSTs above) counts as duplicate here,
      // never as a second row.
      const gradientPlan = planGradientImport(getCustomGradientPresets(), parsed.gradient)
      let gradientOk = 0
      for (const entry of gradientPlan.toAdd) {
        const added: GradientFileEntry = entry
        // Persistence required: a storage failure rejects here with no
        // phantom in-memory entry, and surfaces as failure, never success.
        if (addCustomGradientPreset(added.name, added.values, { requirePersistence: true })) gradientOk += 1
        else failed += 1
      }
      if (fresh) onVisualsChanged?.(fresh)
      const skipped =
        parsed.skipped.visual + parsed.skipped.visualOverCap +
        parsed.skipped.gradient + parsed.skipped.gradientOverCap +
        visualPlan.skippedDuplicate + visualPlan.skippedQuota +
        gradientPlan.skippedDuplicate + gradientPlan.skippedQuota
      const applied = visualOk + gradientOk
      if (failed > 0) {
        if (applied > 0) toast.error(t("ui.presetFileImportPartial", { applied, failed }))
        else toast.error(t("ui.presetFileImportError"))
        return
      }
      if (applied === 0) {
        toast.info(t("ui.presetFileImportEmpty", { skipped }))
        return
      }
      toast.success(t("ui.presetFileImportOk", { visual: visualOk, gradient: gradientOk, skipped }))
    } catch {
      toast.error(t("ui.presetFileImportError"))
    } finally {
      setBusy(false)
    }
  }, [onVisualsChanged, t])

  return { busy, exportAll, exportVisual, exportGradients, exportGradient, importFile }
}
