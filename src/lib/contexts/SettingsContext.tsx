"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { PictoriumCtx } from "@/lib/context"
import type { BackupExportOptions, BackupImportOptions } from "@/lib/useMappingsStore"

/**
 * SettingsCtx — subset di PictoriumCtx per impostazioni (chiavi API, tema, lingua, profilo).
 * Deriva dal padre via memo: cambia solo quando cambiano le impostazioni,
 * non quando cambiano badge/search/nav.
 */
export interface SettingsCtx {
  tmdbKey: string
  setTmdbKey: (v: string) => void
  /** True se l'istanza ha una chiave TMDB env: la home funziona senza chiave browser. */
  serverHasTmdbKey: boolean
  tmdbKeyInput: string
  setTmdbKeyInput: React.Dispatch<React.SetStateAction<string>>
  showKey: boolean
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>
  mdblistApiKey: string
  setMdblistApiKey: (v: string) => void
  tvdbApiKey: string
  setTvdbApiKey: (v: string) => void
  theme: "dark" | "light"
  setTheme: React.Dispatch<React.SetStateAction<"dark" | "light">>
  uiAccent: boolean
  setUiAccent: React.Dispatch<React.SetStateAction<boolean>>
  lang: string
  t: (key: string, params?: Record<string, string | number>) => string
  pickLang: (l: string) => void
  exportData: (opts?: BackupExportOptions) => Promise<void>
  importData: (opts?: BackupImportOptions) => void
  copyUrl: () => Promise<void>
}

const Ctx = createContext<SettingsCtx | null>(null)

export function useSettingsCtx() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSettingsCtx must be inside PictoriumProvider")
  return v
}

export function SettingsProvider({
  value,
  children,
}: {
  value: PictoriumCtx
  children: ReactNode
}) {
  const settingsCtx = useMemo<SettingsCtx>(
    () => ({
      tmdbKey: value.tmdbKey,
      setTmdbKey: value.setTmdbKey,
      serverHasTmdbKey: value.serverHasTmdbKey,
      tmdbKeyInput: value.tmdbKeyInput,
      setTmdbKeyInput: value.setTmdbKeyInput,
      showKey: value.showKey,
      setShowKey: value.setShowKey,
      mdblistApiKey: value.mdblistApiKey,
      setMdblistApiKey: value.setMdblistApiKey,
      tvdbApiKey: value.tvdbApiKey,
      setTvdbApiKey: value.setTvdbApiKey,
      theme: value.theme,
      setTheme: value.setTheme,
      uiAccent: value.uiAccent,
      setUiAccent: value.setUiAccent,
      lang: value.lang,
      t: value.t,
      pickLang: value.pickLang,
      exportData: value.exportData,
      importData: value.importData,
      copyUrl: value.copyUrl,
    }),
    [
      value.tmdbKey, value.setTmdbKey, value.serverHasTmdbKey,
      value.tmdbKeyInput, value.setTmdbKeyInput,
      value.showKey, value.setShowKey,
      value.mdblistApiKey, value.setMdblistApiKey,
      value.tvdbApiKey, value.setTvdbApiKey,
      value.theme, value.setTheme,
      value.uiAccent, value.setUiAccent,
      value.lang,
      value.t, value.pickLang,
      value.exportData, value.importData,
      value.copyUrl,
    ],
  )

  return <Ctx.Provider value={settingsCtx}>{children}</Ctx.Provider>
}