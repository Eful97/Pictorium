"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import type { Mapping } from "./types"
import { http, userFetch } from "./http"
import { USER_UNLOCK_EVENT, currentPathUuid } from "./user-token"
import { applyLocalBackup, applyPersonalKeys, collectLocalBackup, collectPersonalKeys, stripLocalPersonalKeys } from "./backup-local"
import { t } from "./i18n"

/** Opt-in flags for personal API keys in backup export (all default off). */
export interface BackupExportOptions {
  /** Include device keys with valid personal provenance as `local.personalKeys`. */
  includePersonalKeys?: boolean
}

/** Opt-in flags for personal API keys in backup import (all default off). */
export interface BackupImportOptions {
  /** Apply the file's `local.personalKeys` to this device. */
  importPersonalKeys?: boolean
  /** Also replace device keys that already hold a (different or unknown) value. */
  overwritePersonalKeys?: boolean
}

/** Flag sessione per il toast post-reload dopo un import con reload. */
const BACKUP_RESTORED_KEY = "pictorium:backup-restored"

/**
 * Skipped-keys notice, counts only (never values): omitted keys were NOT
 * restored, so the toast must not promise a full key restore. No-op at zero.
 */
function notifySkippedPersonalKeys(skipped: number): void {
  if (!(skipped > 0)) return
  import("sonner").then(({ toast }) => toast(t("ui.backupKeysSkipped", { skipped })))
}

export function useMappingsStore() {
  const [mappings, setMappings] = useState<Mapping[]>([])

  const mappingsMap = useMemo(() => {
    const map = new Map<string, Mapping>()
    for (const m of mappings) {
      map.set(`${m.mediaType}:${m.tmdbId}`, m)
    }
    return map
  }, [mappings])

  const loadMappings = useCallback(async () => {
    try {
      // userFetch: su path /u/<uuid> legge/scrive il namespace (token da storage).
      const res = await userFetch("/api/mappings")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMappings(Array.isArray(data.mappings) ? data.mappings : [])
    } catch (e) {
      // 401 scoped (ospite su /u/ o token non ancora salvato dal #key=):
      // atteso e transitorio — debug, non error (il reload post-unlock segue sotto).
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("401")) console.debug("[pictorium] loadMappings unauthorized (guest or pre-unlock)")
      else console.error("[pictorium] Failed to load mappings:", e)
    }
  }, [])

  useEffect(() => { loadMappings() }, [loadMappings])

  // Post-unlock: la prima load può aver girato senza token (race col #key=) —
  // allo sblocco si ricarica il namespace, senza refresh pagina.
  useEffect(() => {
    const onUnlock = () => { void loadMappings() }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [loadMappings])

  const removeMapping = useCallback(async (m: Mapping) => {
    await http(`/api/mappings/${m.mediaType}:${m.tmdbId}`, { method: "DELETE" })
    setMappings((prev) => prev.filter((x) => !(x.tmdbId === m.tmdbId && x.mediaType === m.mediaType)))
    import("sonner").then(({ toast }) => toast(t("ui.mappingRemoved")))
  }, [])

  const exportData = useCallback(async (opts?: BackupExportOptions) => {
    try {
      const data = await http<Record<string, unknown>>("/api/mappings/export")
      // Sezione `local` (lingua, tema, ricerche recenti, mirror locali):
      // fail-open, il backup server resta valido anche senza.
      let local: Record<string, unknown> = {}
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          local = { ...collectLocalBackup(window.localStorage, currentPathUuid()) }
          // Personal keys: explicit opt-in only, provenance-gated. Default
          // export never reads device keys.
          if (opts?.includePersonalKeys === true) {
            const personalKeys = collectPersonalKeys(window.localStorage)
            if (Object.keys(personalKeys).length > 0) local = { ...local, personalKeys }
          }
        }
      } catch {
        local = {}
      }
      const blob = new Blob([JSON.stringify({ ...data, local }, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `pictorium-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      import("sonner").then(({ toast }) => toast.success(t("ui.saved") || "Backup esportato con successo!"))
    } catch (e) {
      console.error("[pictorium] Export failed:", e)
      import("sonner").then(({ toast }) => toast.error(t("ui.exportError")))
    }
  }, [])

  const importData = useCallback((opts?: BackupImportOptions) => {
    const input = document.createElement("input")
    input.type = "file"; input.accept = ".json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const data = JSON.parse(text)
        // Personal keys never leave the device: strip them from the server
        // payload (the server applies its own sections and ignores `local`)
        // and apply them locally below, opt-in only.
        const res = await userFetch("/api/mappings/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stripLocalPersonalKeys(data)),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => null)
          const hasDetails = errBody && typeof errBody.details === "object" && errBody.details !== null
          const detailsMsg = hasDetails ? Object.values(errBody.details).flat().join("; ") : ""
          const msg = errBody?.error || detailsMsg || t("ui.importError")
          import("sonner").then(({ toast }) => toast(msg))
          return
        }
        // Sezione `local` (solo backup v2): si scrive sul namespace corrente
        // (migrazione tra spazi), mai sulle chiavi d'origine.
        let appliedLocal: string[] = []
        let appliedPersonalKeys: string[] = []
        let skippedPersonalKeys: string[] = []
        try {
          if (typeof window !== "undefined" && window.localStorage && data && typeof data === "object" && "local" in data) {
            const localSection = (data as { local?: unknown }).local
            appliedLocal = applyLocalBackup(window.localStorage, currentPathUuid(), localSection).applied
            // Personal keys: explicit opt-in only (default off), never
            // overwriting existing device values without separate consent.
            if (opts?.importPersonalKeys === true) {
              const personalSection =
                typeof localSection === "object" && localSection !== null && !Array.isArray(localSection)
                  ? (localSection as { personalKeys?: unknown }).personalKeys
                  : undefined
              const personalResult = applyPersonalKeys(window.localStorage, personalSection, {
                overwrite: opts?.overwritePersonalKeys === true,
              })
              appliedPersonalKeys = personalResult.applied
              skippedPersonalKeys = personalResult.skipped
            }
          }
        } catch (err) {
          console.warn("[pictorium] Local backup apply failed:", err)
        }
        loadMappings()
        const result = await res.json()
        const imp = result.imported as { mappings?: number; aliases?: number; defaults?: number; presets?: number } | undefined
        if (imp && typeof imp === "object") {
          const summary = {
            posters: imp.mappings ?? 0,
            presets: imp.presets ?? 0,
            aliases: imp.aliases ?? 0,
            keysApplied: appliedPersonalKeys.length,
            keysSkipped: skippedPersonalKeys.length,
          }
          // Impostazioni, preferenze locali o chiavi personali: gli state si
          // idratano al mount (defaults, cataloghi, lingua, tema, gradienti,
          // chiavi) → reload. Il toast si mostra dopo il reload via flag di
          // sessione. Solo conteggi nel toast, mai valori.
          if ((imp.defaults ?? 0) > 0 || appliedLocal.length > 0 || appliedPersonalKeys.length > 0) {
            try {
              sessionStorage.setItem(BACKUP_RESTORED_KEY, JSON.stringify(summary))
            } catch { /* reload comunque */ }
            window.location.reload()
            return
          }
          import("sonner").then(({ toast }) => toast(t("ui.backupImportSuccess", summary)))
          notifySkippedPersonalKeys(skippedPersonalKeys.length)
        } else {
          import("sonner").then(({ toast }) => toast(t("ui.importSuccess", { count: result.count ?? data.mappings?.length ?? data.length })))
        }
      } catch (e) {
        const msg = e instanceof SyntaxError ? t("ui.importError") : (e as Error).message
        import("sonner").then(({ toast }) => toast(msg))
      }
    }
    input.click()
  }, [loadMappings])

  // Toast post-reload dopo un import che ha richiesto il reload.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BACKUP_RESTORED_KEY)
      if (!raw) return
      sessionStorage.removeItem(BACKUP_RESTORED_KEY)
      const summary = JSON.parse(raw) as { posters?: number; presets?: number; aliases?: number; keysSkipped?: number }
      import("sonner").then(({ toast }) =>
        toast(t("ui.backupImportSuccess", {
          posters: summary.posters ?? 0,
          presets: summary.presets ?? 0,
          aliases: summary.aliases ?? 0,
        })),
      )
      notifySkippedPersonalKeys(summary.keysSkipped ?? 0)
    } catch { /* niente toast */ }
  }, [])

  return { mappings, setMappings, mappingsMap, loadMappings, removeMapping, exportData, importData }
}
