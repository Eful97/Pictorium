"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { saveDefaults } from "@/lib/save-defaults"
import { UserKeysSection } from "@/components/UserKeysSection"
import { UserSpaceSection } from "@/components/UserSpaceSection"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { DataPanel } from "@/components/settings/DataPanel"
import { PrefsPanel } from "@/components/settings/PrefsPanel"
import { isMultiUserServer } from "@/lib/guest-guard"
import { currentPathUuid } from "@/lib/user-token"
import { consumeSettingsTab, type SettingsTabId } from "@/lib/settings-tab"
import {
  Check,
  SlidersHorizontal,
  Move,
  Database,
  Tags,
  X,
  KeyRound,
  RotateCw,
  Download,
} from "lucide-react"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"

interface Props {
  setSettingsOpen: (v: boolean) => void
  exportData: () => void
  importData: () => void
  mobile?: boolean
  onOpenInstall?: () => void
}

export function SettingsPanel({ setSettingsOpen, exportData, importData, mobile, onOpenInstall }: Props) {
  const { t } = useT()
  const ed = usePosterEditor()
  const [mobileViewport, setMobileViewport] = useState<boolean | null>(null)

  useEffect(() => {
    const update = () => setMobileViewport(window.innerWidth < 768)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const [activeTab, setActiveTab] = useState<"badge" | "trasforma" | "prefs" | "data" | "spazio">(
    () => consumeSettingsTab() ?? "badge",
  )
  useEffect(() => {
    // Se la tab arriva quando il componente è già montato
    const requested: SettingsTabId | null = consumeSettingsTab()
    if (requested) setActiveTab(requested)
  }, [])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  // Multi-user ON: la sezione PIN sparisce (lì l'admin è ADMIN_TOKEN e il
  // cancello è per-spazio). null = ancora ignoto: si mostra come oggi
  // (fail-open display, mai togliere UI su rete lenta).
  const [multiUserOn, setMultiUserOn] = useState<boolean | null>(null)
  // Tab Spazio: solo quando ha contenuto (multi-user ON o path /u/).
  // Stato (non lettura live) per non rompere l'hydration: appare al mount.
  const [spacePathUuid, setSpacePathUuid] = useState<string | null>(null)
  const showSpaceTab = multiUserOn === true || spacePathUuid !== null

  useEffect(() => {
    isMultiUserServer().then(
      (v) => setMultiUserOn(v),
      () => setMultiUserOn(false),
    )
    setSpacePathUuid(currentPathUuid())
    // Richiesta esterna (icona chiave toolbar): salta al tab Spazio.
    const onSpaceTab = () => setActiveTab("spazio")
    window.addEventListener("pictorium:settings-space-tab", onSpaceTab)
    return () => window.removeEventListener("pictorium:settings-space-tab", onSpaceTab)
  }, [])

  const desktopPrevActiveRef = useRef<HTMLElement | null>(null)

  // Focus trap, focus iniziale e ripristino focus per il modale desktop
  useEffect(() => {
    // AppShell also mounts this instance inside hidden md:block on mobile.
    if (mobile || window.innerWidth < 768) return
    desktopPrevActiveRef.current = document.activeElement as HTMLElement | null

    const panel = settingsRef.current
    if (!panel) return

    // Focus iniziale sul pulsante chiusura o primo elemento interattivo
    const closeBtn = panel.querySelector<HTMLElement>('button[aria-label]')
    if (closeBtn) {
      closeBtn.focus()
    } else {
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      first?.focus()
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || window.innerWidth < 768) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => {
        if (el.style.display === "none" || el.style.visibility === "hidden" || el.getAttribute("aria-hidden") === "true") return false
        return true
      })

      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", handleTab)
    return () => {
      window.removeEventListener("keydown", handleTab)
      if (desktopPrevActiveRef.current && typeof desktopPrevActiveRef.current.focus === "function") {
        desktopPrevActiveRef.current.focus()
      }
    }
  }, [mobile])

  // Chiusura con tasto Escape su desktop
  useEffect(() => {
    if (mobile) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setSettingsOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [mobile, setSettingsOpen])

  const handleSaveDefaults = async () => {
    setSaving(true)
    try {
      const synced = await saveDefaults(ed)
      if (!synced) {
        toast.warning(t("ui.defaultsSyncFailed"))
        return
      }
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  const tabs: { id: SettingsTabId; label: string; icon: typeof Tags }[] = [
    { id: "badge", label: t("ui.badgeSection"), icon: Tags },
    { id: "trasforma", label: t("ui.transform"), icon: Move },
    { id: "prefs", label: t("ui.settingsTabPrefs"), icon: SlidersHorizontal },
    { id: "data", label: t("ui.settingsTabData"), icon: Database },
    ...(showSpaceTab ? [{ id: "spazio" as const, label: t("ui.settingsTabSpace"), icon: KeyRound }] : []),
  ]

  // Barra di navigazione delle schede (Tabs)
  const tabsNav = (
    <div className="shrink-0">
      {/* Mobile Category Selector */}
      <div className="sm:hidden px-3 py-2 bg-white/[0.03] border-b border-white/10 flex items-center justify-between gap-2">
        <label htmlFor={mobile ? "mobile-settings-category" : "desktop-settings-category"} className="text-xs font-semibold text-zinc-400 shrink-0">
          {t("ui.section") || "Sezione"}:
        </label>
        <select
          id={mobile ? "mobile-settings-category" : "desktop-settings-category"}
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value as SettingsTabId)}
          className="flex-1 bg-zinc-900 border border-white/15 text-zinc-100 rounded-xl px-3 min-h-[44px] h-11 text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent-orange cursor-pointer touch-manipulation"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id} className="bg-zinc-900 text-zinc-100 py-1">
              {tab.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop Tablist */}
      <div
        role="tablist"
        aria-label={t("ui.settingsTitle")}
        className="hidden sm:flex border-b border-white/10 px-3 sm:px-6 bg-white/[0.02] gap-1 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? "border-accent-orange text-accent-orange"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  // Scheda 1: Badge (specchio del tab Badge dell'editor, valori default)
  const badgePanel = (
    <BadgeDefaultsSection active={activeTab === "badge"} />
  )

  // Scheda 2: Trasforma (specchio del tab Trasforma dell'editor, valori default)
  const trasformaPanel = (
    <TransformPanel active={activeTab === "trasforma"} />
  )

  // Scheda 3: Preferenze & Sistema
  const prefsPanel = (
    <PrefsPanel active={activeTab === "prefs"} />
  )

  // Scheda 4: Dati & Cache
  const dataPanel = (
    <DataPanel
      active={activeTab === "data"}
      exportData={exportData}
      importData={importData}
      setSettingsOpen={setSettingsOpen}
      multiUserOn={multiUserOn}
    />
  )

  // Scheda Spazio: identità/gate, UUID + recupero, chiavi API del namespace.
  const spazioPanel = (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabSpace")}
      className={`space-y-3.5 text-xs ${activeTab === "spazio" ? "block animate-tab-fade-in" : "hidden"}`}
    >
      <UserSpaceSection />
      <UserKeysSection />
    </div>
  )

  // Actions Footer (condiviso desktop/mobile)
  const footer = (
    <div className="settings-dialog-footer border-t border-white/10 bg-[#0d0d10]/95 backdrop-blur-md px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
      <p className="text-xs text-zinc-400 text-center sm:text-left select-none">
        {t("ui.defaultsAutoSaved")}
      </p>
      <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto">
        {onOpenInstall && (
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false)
              onOpenInstall()
            }}
            className="px-4 py-2.5 min-h-[44px] h-11 rounded-xl bg-accent-orange/15 hover:bg-accent-orange/25 border border-accent-orange/30 text-xs sm:text-sm font-semibold text-accent-orange transition-all active:scale-95 cursor-pointer touch-manipulation flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t("ui.install")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(false)}
          className="px-5 py-2.5 min-h-[44px] h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-all active:scale-95 cursor-pointer touch-manipulation flex items-center justify-center"
        >
          {t("ui.close")}
        </button>
        <button
          type="button"
          onClick={handleSaveDefaults}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] h-11 rounded-xl text-xs sm:text-sm font-semibold bg-accent-orange hover:bg-accent-orange/90 text-white shadow-lg shadow-accent-orange/25 active:scale-95 transition-all cursor-pointer touch-manipulation disabled:opacity-50"
        >
          {saving ? (
            <>
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t("ui.syncing")}</span>
            </>
          ) : saved ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>{t("ui.saved")}</span>
            </>
          ) : (
            <>
              <RotateCw className="w-3.5 h-3.5" />
              <span>{t("ui.syncNow")}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )

  // Layout Mobile (innestato nella schermata di AppShell)
  if (mobile) {
    return (
      <div ref={settingsRef} className="settings-panel flex flex-col h-full min-h-0 w-full">
        {tabsNav}
        {mobileViewport === true && (activeTab === "badge" || activeTab === "trasforma") && (
          <div className="shrink-0 px-4 pt-3">
            <DefaultsPosterPreview compact />
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 pb-8" data-testid="settings-controls">
          {mobileViewport === true && (activeTab === "badge" || activeTab === "trasforma") && <VisualPresetsSection />}
          {badgePanel}
          {trasformaPanel}
          {prefsPanel}
          {dataPanel}
          {showSpaceTab && spazioPanel}
        </div>
        <div className="shrink-0">
          {footer}
        </div>
      </div>
    )
  }

  const isVisualTab = activeTab === "badge" || activeTab === "trasforma"

  // Layout Desktop: Modal Dialog centrato con backdrop blur
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        ref={settingsRef}
        tabIndex={-1}
        className={`settings-panel settings-dialog-panel relative outline-none w-full ${isVisualTab ? "max-w-5xl h-[88dvh]" : "max-w-2xl"} max-h-[88dvh] flex flex-col rounded-2xl border border-white/10 bg-[#121216] shadow-2xl shadow-black/90 select-text animate-modal-panel-in overflow-hidden my-auto transition-all duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="settings-dialog-header flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 bg-[#141418] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/25">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 id="settings-dialog-title" className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-1.5">
                <span>{t("ui.settingsGlobalTitle") || t("ui.settingsTitle")}</span>
              </h3>
              <p className="text-[11px] text-muted hidden sm:block max-w-xl">
                {t("ui.settingsGlobalDesc") || t("ui.settingsSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("ui.close")}
            onClick={() => setSettingsOpen(false)}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-90 cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {tabsNav}

        {/* Contenuto scrollabile */}
        <div className={`flex-1 min-h-0 ${isVisualTab ? "flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(220px,32%)]" : "flex flex-col"}`}>
          <div className="min-w-0 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4" data-testid="settings-controls">
            {mobileViewport === false && isVisualTab && <VisualPresetsSection />}
            {badgePanel}
            {trasformaPanel}
            {prefsPanel}
            {dataPanel}
            {showSpaceTab && spazioPanel}
          </div>
          {isVisualTab && (
            <div className="hidden md:block min-h-0 p-4 pl-0" data-testid="settings-preview">
              {mobileViewport === false && <DefaultsPosterPreview />}
            </div>
          )}
        </div>

        {footer}
      </div>
    </div>
  )
}
