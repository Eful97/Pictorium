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
  Save,
  Check,
  Sliders,
  Move,
  Database,
  Layers,
  X,
  KeyRound,
} from "lucide-react"

interface Props {
  setSettingsOpen: (v: boolean) => void
  exportData: () => void
  importData: () => void
  mobile?: boolean
}

export function SettingsPanel({ setSettingsOpen, exportData, importData, mobile }: Props) {
  const { t } = useT()
  const ed = usePosterEditor()

  const [activeTab, setActiveTab] = useState<"badge" | "trasforma" | "prefs" | "data" | "spazio">(
    () => consumeSettingsTab() ?? "badge",
  )
  useEffect(() => {
    // Se la tab arriva quando il componente è già montato
    const requested: SettingsTabId | null = consumeSettingsTab()
    if (requested) setActiveTab(requested)
  }, [])
  const [saved, setSaved] = useState(false)
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

  // Focus trap su mobile
  useEffect(() => {
    if (!mobile) return
    const panel = settingsRef.current
    if (!panel) return
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    panel.addEventListener("keydown", handleTab)
    first?.focus()
    return () => panel.removeEventListener("keydown", handleTab)
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


  const handleSaveDefaults = () => {
    void saveDefaults(ed).then((synced) => {
      if (!synced) {
        toast.warning(t("ui.defaultsSyncFailed"))
        return
      }
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
    })
  }

  // Barra di navigazione delle schede (Tabs)
  const tabsNav = (
    <div
      role="tablist"
      aria-label={t("ui.settingsTitle")}
      className="flex border-b border-white/10 px-3 sm:px-6 bg-white/[0.02] gap-1 shrink-0 overflow-x-auto scrollbar-none"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "badge"}
        onClick={() => setActiveTab("badge")}
        className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
          activeTab === "badge"
            ? "border-accent-orange text-accent-orange"
            : "border-transparent text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Layers className="w-3.5 h-3.5" />
        <span>{t("ui.badgeSection")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "trasforma"}
        onClick={() => setActiveTab("trasforma")}
        className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
          activeTab === "trasforma"
            ? "border-accent-orange text-accent-orange"
            : "border-transparent text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Move className="w-3.5 h-3.5" />
        <span>{t("ui.transform")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "prefs"}
        onClick={() => setActiveTab("prefs")}
        className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
          activeTab === "prefs"
            ? "border-accent-orange text-accent-orange"
            : "border-transparent text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Sliders className="w-3.5 h-3.5" />
        <span>{t("ui.settingsTabPrefs")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "data"}
        onClick={() => setActiveTab("data")}
        className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
          activeTab === "data"
            ? "border-accent-orange text-accent-orange"
            : "border-transparent text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Database className="w-3.5 h-3.5" />
        <span>{t("ui.settingsTabData")}</span>
      </button>
      {showSpaceTab && (
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "spazio"}
          onClick={() => setActiveTab("spazio")}
          className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === "spazio"
              ? "border-accent-orange text-accent-orange"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>{t("ui.settingsTabSpace")}</span>
        </button>
      )}
    </div>
  )

  // Scheda 1: Badge (specchio del tab Badge dell'editor, valori default)
  const badgePanel = (
    <BadgeDefaultsSection active={activeTab === "badge"} />
  )

  // Scheda 2: Trasforma (specchio del tab Trasforma dell'editor, valori default)
  // con due tab Verticale/Orizzontale: gli stessi parametri per formato (i
  // badge restano condivisi, solo sfumatura+scale differiscono).
  // Scheda 2: Trasforma (specchio del tab Trasforma dell'editor, valori default)
  // con due tab Verticale/Orizzontale: gli stessi parametri per formato (i
  // badge restano condivisi, solo sfumatura+scale differiscono).
  const trasformaPanel = (
    <TransformPanel active={activeTab === "trasforma"} />
  )

  // Scheda 2: Preferenze & Sistema
  const prefsPanel = (
    <PrefsPanel active={activeTab === "prefs"} />
  )

  // Scheda 3: Dati & Cache
  // Scheda 3: Dati & Cache
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
  // Vive qui invece che in Dati & Cache: è l'account, non la manutenzione.
  const spazioPanel = (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabSpace")}
      className={`space-y-3.5 text-xs ${activeTab === "spazio" ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Spazio utente: gate crea/entri, UUID + recupero, identità (tab Spazio) */}
      <UserSpaceSection />

      {/* Chiavi API server-side del namespace (multi-user: solo su /u/<uuid>) */}
      <UserKeysSection />
    </div>
  )

  // Sticky Actions Footer
  const footer = (
    <div className="border-t border-white/10 bg-[#0d0d10]/95 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0">
      <button
        type="button"
        onClick={() => setSettingsOpen(false)}
        className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-zinc-300 hover:text-white transition-all active:scale-95 cursor-pointer"
      >
        {t("ui.close")}
      </button>
      <button
        type="button"
        onClick={handleSaveDefaults}
        className="flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-accent-orange hover:bg-accent-orange/90 text-white shadow-lg shadow-accent-orange/25 active:scale-95 transition-all cursor-pointer"
      >
        {saved ? (
          <>
            <Check className="w-3.5 h-3.5" />
            <span>{t("ui.saved")}</span>
          </>
        ) : (
          <>
            <Save className="w-3.5 h-3.5" />
            <span>{t("ui.saveDefaults")}</span>
          </>
        )}
      </button>
    </div>
  )

  // Layout Mobile (innestato nella schermata di AppShell)
  if (mobile) {
    return (
      <div ref={settingsRef} className="space-y-4">
        {tabsNav}
        <div className="pt-2">
          {badgePanel}
          {trasformaPanel}
          {prefsPanel}
          {dataPanel}
          {showSpaceTab && spazioPanel}
        </div>
        <div className="pt-3">
          {footer}
        </div>
      </div>
    )
  }

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
        className="relative outline-none w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-[#121216] shadow-2xl shadow-black/90 select-text animate-modal-panel-in overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 bg-[#141418] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/25">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 id="settings-dialog-title" className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-1.5">
                <span>{t("ui.settingsTitle")}</span>
              </h3>
              <p className="text-[11px] text-muted hidden sm:block">
                {t("ui.settingsSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("ui.close")}
            onClick={() => setSettingsOpen(false)}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-90 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {tabsNav}

        {/* Contenuto scrollabile */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {badgePanel}
          {trasformaPanel}
          {prefsPanel}
          {dataPanel}
          {showSpaceTab && spazioPanel}
        </div>

        {footer}
      </div>
    </div>
  )
}


