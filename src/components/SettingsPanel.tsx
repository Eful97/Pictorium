"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession } from "@/components/settings/useSettingsSession"
import { UserKeysSection } from "@/components/UserKeysSection"
import { UserSpaceSection } from "@/components/UserSpaceSection"
import { TraktAccountSection } from "@/components/TraktAccountSection"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { TagsNetworksSection } from "@/components/settings/TagsNetworksSection"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { DataPanel } from "@/components/settings/DataPanel"
import { PrefsPanel } from "@/components/settings/PrefsPanel"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { SeasonalKeywordsSection } from "@/components/SeasonalKeywordsSection"
import { isMultiUserServer } from "@/lib/guest-guard"
import { currentPathUuid } from "@/lib/user-token"
import { consumeSettingsTab } from "@/lib/settings-tab"
import {
  SlidersHorizontal,
  Move,
  Database,
  X,
  KeyRound,
  Palette,
  Trophy,
  Info,
  Sparkles,
  Tags,
  Download,
} from "lucide-react"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { FloatingPreview, type FloatingPreviewCorner } from "@/components/settings/FloatingPreview"
import { Modal } from "@/components/ui/Modal"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import { usePSelector } from "@/lib/context"
import { usePreviewDemoMedia } from "@/lib/defaults-preview-media"
import type { BackupExportOptions, BackupImportOptions } from "@/lib/useMappingsStore"

type PrimaryTabId = "preset" | "rankings" | "information" | "badge" | "tags" | "transform"
type SecondaryTabId = "prefs" | "data" | "catalogs" | "spazio"
type TabId = PrimaryTabId | SecondaryTabId

const PRIMARY_TABS: ReadonlyArray<{ id: PrimaryTabId; labelKey: string; icon: typeof Sparkles }> = [
  { id: "preset", labelKey: "ui.settingsTabPreset", icon: Sparkles },
  { id: "rankings", labelKey: "ui.settingsTabRankings", icon: Trophy },
  { id: "information", labelKey: "ui.settingsTabInformation", icon: Info },
  { id: "badge", labelKey: "ui.settingsTabBadge", icon: Palette },
  { id: "tags", labelKey: "ui.settingsTabTagsNetworks", icon: Tags },
  { id: "transform", labelKey: "ui.settingsTabTransform", icon: Move },
]

const SECONDARY_TABS: ReadonlyArray<{ id: SecondaryTabId; labelKey: string; icon: typeof SlidersHorizontal }> = [
  { id: "catalogs", labelKey: "ui.catalogsTitle", icon: SlidersHorizontal },
  { id: "prefs", labelKey: "ui.settingsTabPrefs", icon: SlidersHorizontal },
  { id: "data", labelKey: "ui.settingsTabData", icon: Database },
  { id: "spazio", labelKey: "ui.settingsTabSpace", icon: KeyRound },
]

function normalizeTab(tab: string | null): TabId | null {
  if (tab === "badge") return "preset"
  if (
    tab === "preset" ||
    tab === "rankings" ||
    tab === "information" ||
    tab === "tags" ||
    tab === "trasforma" ||
    tab === "prefs" ||
    tab === "data" ||
    tab === "catalogs" ||
    tab === "spazio"
  ) {
    return (tab === "trasforma" ? "transform" : tab) as TabId
  }
  return null
}

// Shared header-card chrome for the settings tab header slot: the format
// selector and the secondary tab titles share the same floor (64px mobile,
// 96px desktop) so the slot height never jumps between tabs. Mobile uses
// tighter padding (px-2.5/py-1.5) to leave body space at 568px heights;
// desktop keeps the roomier chrome.
const TAB_HEADER_CARD_CLASS =
  "bg-surface/50 border border-surface2/60 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm min-h-[48px]"

interface Props {
  setSettingsOpen: (v: boolean) => void
  exportData: (opts?: BackupExportOptions) => void
  importData: (opts?: BackupImportOptions) => void
  mobile?: boolean
  onOpenInstall?: () => void
}

export function SettingsPanel({ setSettingsOpen, exportData, importData, mobile, onOpenInstall }: Props) {
  const { t } = useT()
  // Single shared draft session: the ONLY owner of staged settings state.
  // One instance per panel mount — AppShell mounts a single responsive panel,
  // so the session survives tab/format changes and responsive resize.
  // `mobile` is a legacy prop (kept for compat); layout is responsive.
  void mobile
  const session = useSettingsSession()
  const [mobileViewport, setMobileViewport] = useState<boolean | null>(null)

  useEffect(() => {
    const update = () => setMobileViewport(window.innerWidth < 768)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const [activeTab, setActiveTab] = useState<TabId>(() => normalizeTab(consumeSettingsTab()) ?? "preset")
  useEffect(() => {
    const requested = normalizeTab(consumeSettingsTab())
    if (requested) setActiveTab(requested)
  }, [])
  // Edit target (portrait/landscape): preview + controls only, never the
  // persisted delivery format. Survives tab switches and resize.
  const [editTargetShape, setEditTargetShape] = useState<"portrait" | "landscape">("portrait")
  // Preview-only editing family + demo title: never persisted.
  const [previewFamily, setPreviewFamily] = useState<DefaultsPreviewFamily>("auto")
  const currentUserId = usePSelector((v) => v.currentUserId)
  // Agreed Settings -> Catalogs entry: same seasonal keywords section plus a
  // guarded link to the catalog manager (single owner stays CataloghiView).
  const router = usePSelector((v) => v.router)
  const [previewDemoMedia, setPreviewDemoMedia] = usePreviewDemoMedia(currentUserId)
  // Floating mini-preview state (mobile overlay only, in-memory): corner
  // snap + minimize survive tab switches and resize (the single preview
  // owner never unmounts across them).
  const [previewCorner, setPreviewCorner] = useState<FloatingPreviewCorner>("tr")
  const [previewMinimized, setPreviewMinimized] = useState(false)

  // Free navigation: tab/shape moves never prompt and never discard.
  // The shared staged session preserves edits across tabs/formats.
  // Only close paths (X/backdrop/Escape/external) and guarded
  // actions (install/export/import/repeat-setup) go through the dialog.
  const [pendingNav, setPendingNav] = useState<
    | { kind: "close" }
    | { kind: "action"; run: () => void }
    | null
  >(null)

  const doClose = () => setSettingsOpen(false)

  const requestTabChange = (tab: TabId) => {
    if (tab === activeTab) return
    setActiveTab(tab)
  }
  const requestShapeChange = (shape: "portrait" | "landscape") => {
    if (shape === editTargetShape) return
    setEditTargetShape(shape)
  }
  const requestClose = () => {
    if (session.saving) return
    if (session.dirty) {
      setPendingNav({ kind: "close" })
      return
    }
    doClose()
  }
  const requestAction = (run: () => void) => {
    if (session.saving) return
    if (session.dirty) {
      setPendingNav({ kind: "action", run })
      return
    }
    run()
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  const resolvePendingNav = (mode: "discard" | "keep") => {
    if (session.saving) return
    if (mode === "keep" || !pendingNav) {
      setPendingNav(null)
      return
    }
    const nav = pendingNav
    setPendingNav(null)
    session.discard()
    if (nav.kind === "action") {
      nav.run()
    } else doClose()
  }

  // Safe default for the exit-confirm modal: never discards, only returns to
  // editing. Stable identity so the shared Modal effect runs once per open.
  const dismissPendingNav = useCallback(() => {
    setPendingNav(null)
  }, [])

  // Save-then-exit (or save-then-action): a single staged PUT through the
  // shared session. Close/action runs ONLY on save ACK; a failed save keeps
  // the modal open with the draft intact so the user can retry. The session
  // itself drops concurrent saves (busy) and the buttons stay disabled while
  // saving (double-click guard). Conflict disables save: the draft is never
  // secretly overwritten — discard/rebase recovers explicitly.
  const handlePendingSave = async () => {
    if (session.saving || session.conflict || !pendingNav) return
    const res = await session.save()
    if (res.ok) {
      toast.success(t("ui.saved"))
      const nav = pendingNav
      setPendingNav(null)
      if (nav.kind === "action") {
        nav.run()
      } else doClose()
    } else {
      toast.error(t("ui.saveError"))
    }
  }

  // External close requests (toolbar toggle): every close path goes through
  // the session guard — the shell never unmounts the panel directly.
  useEffect(() => {
    const onRequest = () => requestCloseRef.current()
    window.addEventListener("pictorium:settings-close-request", onRequest)
    return () => window.removeEventListener("pictorium:settings-close-request", onRequest)
  }, [])

  const settingsRef = useRef<HTMLDivElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const prevActiveRef = useRef<HTMLElement | null>(null)

  // Dirty-dialog focus: the safe default (Continue editing) owns initial
  // focus; Escape is consumed here so the outer close handler never fires
  // underneath (no double-close, no propagation). Enter never confirms
  // (explicit press only). While saving, Escape is ignored (no resolve).
  // The shared Modal owns its own Tab trap; this effect keeps the same
  // first/last wrap as a second guard on the same button set.
  useEffect(() => {
    if (!pendingNav) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    continueRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        if (!session.saving) setPendingNav(null)
        return
      }
      if (e.key === "Enter") {
        const dialog = document.querySelector('[data-testid="settings-dirty-dialog"]')
        if (dialog && dialog.contains(document.activeElement)) {
          e.stopPropagation()
        }
        return
      }
      if (e.key !== "Tab") return
      const dialog = document.querySelector('[data-testid="settings-dirty-dialog"]')
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (restoreFocusRef.current && typeof restoreFocusRef.current.focus === "function") {
        restoreFocusRef.current.focus()
      }
    }
  }, [pendingNav, session.saving])

  // Single focus owner for both viewports: capture the opener once (never
  // re-capture after first mount), initial focus on open, Tab trap inside
  // the panel, restore on unmount. Hidden ancestors (`hidden` attr,
  // CSS `display:none`/`visibility:hidden`, aria-hidden) are filtered so
  // jsdom + zoom-hidden controls never become tab stops.
  const focusCapturedRef = useRef(false)
  useEffect(() => {
    if (mobileViewport === null) return
    if (!focusCapturedRef.current) {
      prevActiveRef.current = document.activeElement as HTMLElement | null
      focusCapturedRef.current = true
    }
    const panel = settingsRef.current
    if (!panel) return
    // While the exit-confirm modal owns focus, never steal it back to the
    // shell underneath (its safe-continue default keeps initial focus).
    const closeBtn = panel.querySelector<HTMLElement>('button[aria-label]')
    if (!pendingNav && closeBtn && !panel.contains(document.activeElement)) closeBtn.focus()
    const isVisible = (el: HTMLElement): boolean => {
      if (el.getAttribute("aria-hidden") === "true") return false
      if (el.hasAttribute("hidden") || el.closest("[hidden]")) return false
      if (el.style.display === "none" || el.style.visibility === "hidden") return false
      try {
        const cs = window.getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden") return false
      } catch {}
      let p = el.parentElement
      while (p && p !== panel) {
        try {
          const cs = window.getComputedStyle(p)
          if (cs.display === "none" || cs.visibility === "hidden") return false
        } catch {}
        if (p.hasAttribute("hidden")) return false
        p = p.parentElement
      }
      return true
    }
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      if (pendingNav) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => {
        if (!isVisible(el)) return false
        if (el.closest('[data-testid="settings-dirty-dialog"]')) return false
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
    }
  }, [mobileViewport, pendingNav])
  useEffect(() => () => {
    if (prevActiveRef.current && typeof prevActiveRef.current.focus === "function") {
      prevActiveRef.current.focus()
    }
  }, [])

  // Escape closes through the guard (desktop + mobile single owner).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingNav) {
        e.preventDefault()
        requestCloseRef.current()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [pendingNav, setSettingsOpen])

  // Body scroll lock while open (single responsive owner).
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  // The exit-confirm Modal clears the body scroll lock on unmount while the
  // panel underneath is still open: re-assert it when the modal resolves.
  useEffect(() => {
    if (!pendingNav) document.body.style.overflow = "hidden"
  }, [pendingNav])

  // Multi-user / space-tab visibility (unchanged semantics).
  const [multiUserOn, setMultiUserOn] = useState<boolean | null>(null)
  const [spacePathUuid, setSpacePathUuid] = useState<string | null>(null)
  const showSpaceTab = multiUserOn === true || spacePathUuid !== null

  const requestTabChangeRef = useRef(requestTabChange)
  requestTabChangeRef.current = requestTabChange

  useEffect(() => {
    isMultiUserServer().then(
      (v) => setMultiUserOn(v),
      () => setMultiUserOn(false),
    )
    setSpacePathUuid(currentPathUuid())
    const onSpaceTab = () => requestTabChangeRef.current("spazio")
    window.addEventListener("pictorium:settings-space-tab", onSpaceTab)
    return () => window.removeEventListener("pictorium:settings-space-tab", onSpaceTab)
  }, [])

  // Single global Save: one staged PUT, stays on the page, short toasts.
  // Error retains the editable draft (session-owned).
  const handleSave = async () => {
    const res = await session.save()
    if (res.ok) toast.success(t("ui.saved"))
    else toast.error(t("ui.saveError"))
  }
  const saveDisabled = !session.dirty || session.saving || session.conflict
  const syncStatusText = session.saving
    ? t("ui.syncing")
    : session.conflict
      ? t("ui.settingsConflict")
      : session.result !== null && !session.result.ok
        ? t("ui.saveError")
        : session.dirty
          ? t("ui.unsavedChanges")
          : session.result?.ok
            ? t("ui.synced")
            : t("ui.settingsNotSavedYet")

  const isPrimary = activeTab !== "prefs" && activeTab !== "data" && activeTab !== "catalogs" && activeTab !== "spazio"
  const showPreview = isPrimary
  const previewIsLandscape = editTargetShape === "landscape"

  const tabsNav = (
    <div className="shrink-0">
      {/* Mobile Category Selector: primary + secondary optgroups */}
      <div className="sm:hidden px-2.5 py-1 bg-white/[0.03] border-b border-white/10 flex items-center justify-between gap-2">
        <label htmlFor="mobile-settings-category" className="text-xs font-semibold text-zinc-400 shrink-0">
          {t("ui.section") || "Sezione"}:
        </label>
        <select
          id="mobile-settings-category"
          value={activeTab}
          onChange={(e) => requestTabChange(e.target.value as TabId)}
          className="flex-1 bg-zinc-900 border border-white/15 text-zinc-100 rounded-xl px-3 min-h-[44px] h-11 text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent-orange cursor-pointer touch-manipulation"
        >
          <optgroup label={t("ui.settingsGroupPrimary")}>
            {PRIMARY_TABS.map((tab) => (
              <option key={tab.id} value={tab.id} className="bg-zinc-900 text-zinc-100 py-1">
                {t(tab.labelKey)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("ui.settingsGroupSecondary")}>
            {SECONDARY_TABS.filter((tab) => tab.id !== "spazio" || showSpaceTab).map((tab) => (
              <option key={tab.id} value={tab.id} className="bg-zinc-900 text-zinc-100 py-1">
                {t(tab.labelKey)}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Desktop primary tablist (five equal tabs) */}
      <div
        role="tablist"
        aria-label={t("ui.settingsTitle")}
        className="hidden sm:flex border-b border-white/10 px-3 sm:px-6 bg-white/[0.02] gap-1 overflow-x-auto scrollbar-none"
      >
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => requestTabChange(tab.id)}
              className={`flex items-center gap-2 py-3 px-3.5 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? "border-accent-orange text-accent-orange"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t(tab.labelKey)}</span>
            </button>
          )
        })}
      </div>
      {/* Desktop secondary nav (Catalogs/Prefs/Data/Space): compact links, never equal tabs */}
      <div
        aria-label={t("ui.settingsGroupSecondary")}
        className="hidden sm:flex items-center gap-1 px-3 sm:px-6 py-1.5 bg-white/[0.01] border-b border-white/5"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mr-1">
          {t("ui.settingsGroupSecondary")}
        </span>
        {SECONDARY_TABS.filter((tab) => tab.id !== "spazio" || showSpaceTab).map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`settings-secondary-${tab.id}`}
              aria-pressed={isActive}
              onClick={() => requestTabChange(tab.id)}
              className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-white/10 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{t(tab.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  // Compact format selector (no explanatory paragraph): edit target only.
  // 44px touch targets are mobile-only (md:min-h-0 restores the natural
  // desktop height); desktop geometry is otherwise unchanged.
  const formatTargetSelector = (
    <div data-testid="format-target-selector" className="shrink-0 px-2.5 sm:px-6 pt-1 sm:pt-3">
      <div className={TAB_HEADER_CARD_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-zinc-200 text-xs">{t("ui.formatTarget")}</span>
          <div
            className="flex gap-1 p-1 rounded-xl bg-black/40 border border-white/10"
            role="group"
            aria-label={t("ui.formatTarget")}
          >
            {(["portrait", "landscape"] as const).map((shape) => (
              <button
                key={shape}
                type="button"
                aria-pressed={editTargetShape === shape}
                onClick={() => requestShapeChange(shape)}
                className={`flex-1 min-h-[44px] md:min-h-0 py-1.5 px-3 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap touch-manipulation ${
                  editTargetShape === shape
                    ? "bg-white/15 text-foreground shadow-sm"
                    : "text-muted hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {shape === "portrait" ? t("ui.posterShapePortrait") : t("ui.posterShapeLandscape")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  const activeSecondaryDef = SECONDARY_TABS.find((tab) => tab.id === activeTab)
  const ActiveSecondaryIcon = activeSecondaryDef?.icon ?? SlidersHorizontal
  const tabHeaderSlot = (
    <div data-testid="settings-tab-header-slot" className="shrink-0">
      {isPrimary ? (
        formatTargetSelector
      ) : (
        <div className="px-2.5 sm:px-6 pt-1 sm:pt-3">
          <div data-testid="settings-tab-title" className={`${TAB_HEADER_CARD_CLASS} flex flex-col justify-center gap-1`}>
            <span className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
              <ActiveSecondaryIcon className="w-3.5 h-3.5 text-accent-orange shrink-0" />
              {activeSecondaryDef ? t(activeSecondaryDef.labelKey) : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  )

  // Centered exit-confirm modal: a full-viewport overlay above the whole app
  // (settings shell is z-70/z-80, this overlay is z-100), strongly darkened
  // and pointer-blocking, with the card centered on mobile and desktop.
  // Rendered through the shared Modal (body portal: a sibling of the
  // settings dialog, never a nested dialog). Backdrop clicks never resolve
  // (no silent discard); Escape resolves to continue-editing via the effect
  // above and is ignored while saving. Guarded actions (install/export/
  // import/repeat-setup) share this modal: save runs the action only on ACK
  // (label "Save and continue"), discard closes then runs the action,
  // continue drops the pending action and keeps the edits.
  const pendingIsAction = pendingNav?.kind === "action"
  const pendingSaveFailed = session.result !== null && !session.result.ok
  const pendingDialog = (
    <Modal
      isOpen={pendingNav !== null}
      onClose={dismissPendingNav}
      closeOnEscape={false}
      closeOnBackdrop={false}
      labelledBy="settings-dirty-title"
      describedBy="settings-dirty-desc"
      testId="settings-dirty-dialog"
      overlayClassName="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      className="max-w-sm w-full p-5 sm:p-6 space-y-3 max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <div>
        <h3 id="settings-dirty-title" className="text-sm sm:text-base font-bold text-zinc-100">
          {t("ui.settingsUnsavedTitle")}
        </h3>
        <p id="settings-dirty-desc" className="text-xs text-zinc-400 leading-relaxed mt-1">
          {t("ui.settingsUnsavedHint")}
        </p>
      </div>
      {session.saving && (
        <p role="status" className="text-xs text-zinc-300">{t("ui.saving")}</p>
      )}
      {pendingSaveFailed && !session.saving && (
        <p role="alert" data-testid="settings-dirty-error" className="text-xs text-red-300 font-semibold">
          {t("ui.saveError")}
        </p>
      )}
      {session.conflict && (
        <p role="alert" className="text-[11px] text-red-200/80">{t("ui.settingsConflictHint")}</p>
      )}
      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          data-testid="settings-dirty-save"
          disabled={session.saving || session.conflict}
          onClick={handlePendingSave}
          className="w-full min-h-[44px] rounded-xl bg-accent-orange hover:bg-accent-orange/90 disabled:opacity-40 text-xs sm:text-sm font-semibold text-white cursor-pointer disabled:cursor-not-allowed touch-manipulation"
        >
          {session.saving
            ? t("ui.saving")
            : pendingIsAction
              ? t("ui.settingsSaveAndContinue")
              : t("ui.settingsSaveAndClose")}
        </button>
        <button
          ref={continueRef}
          type="button"
          data-testid="settings-dirty-continue"
          disabled={session.saving}
          onClick={() => resolvePendingNav("keep")}
          className="w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs sm:text-sm font-semibold text-zinc-100 cursor-pointer disabled:cursor-not-allowed touch-manipulation"
        >
          {t("ui.settingsContinueEditing")}
        </button>
        <button
          type="button"
          data-testid="settings-dirty-discard"
          disabled={session.saving}
          onClick={() => resolvePendingNav("discard")}
          className="w-full min-h-[44px] rounded-xl bg-transparent hover:bg-white/10 disabled:opacity-40 text-xs sm:text-sm font-semibold text-zinc-400 hover:text-zinc-100 border border-white/10 cursor-pointer disabled:cursor-not-allowed touch-manipulation"
        >
          {t("ui.settingsExitWithoutSaving")}
        </button>
      </div>
    </Modal>
  )

  const conflictBanner = session.conflict ? (
    <div role="alert" data-testid="settings-conflict" className="mx-3 sm:mx-6 mt-2 rounded-xl border border-red-400/30 bg-red-950/30 p-3 space-y-2">
      <p className="text-xs text-red-200 font-semibold">{t("ui.settingsConflict")}</p>
      <p className="text-[11px] text-red-200/80">{t("ui.settingsConflictHint")}</p>
      <button
        type="button"
        data-testid="settings-conflict-discard"
        disabled={session.saving}
        onClick={() => session.discard()}
        className="w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs font-semibold text-zinc-100 cursor-pointer disabled:cursor-not-allowed"
      >
        {t("ui.settingsDiscardAndReload")}
      </button>
    </div>
  ) : null

  const footer = (
    <div className="settings-dialog-footer border-t border-white/10 bg-[#0d0d10]/95 backdrop-blur-md px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
      <div className="text-center sm:text-left">
        <p role="status" data-testid="settings-save-status" className="text-xs text-zinc-400 select-none">
          {syncStatusText}
        </p>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto">
        {onOpenInstall && (
          <button
            type="button"
            data-testid="settings-install"
            disabled={session.saving}
            onClick={() => requestAction(() => {
              doClose()
              onOpenInstall()
            })}
            className="px-4 py-2.5 min-h-[44px] h-11 rounded-xl bg-accent-orange/15 hover:bg-accent-orange/25 border border-accent-orange/30 text-xs sm:text-sm font-semibold text-accent-orange transition-all active:scale-95 cursor-pointer touch-manipulation flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t("ui.install")}</span>
          </button>
        )}
        <button
          type="button"
          data-testid="settings-save"
          disabled={saveDisabled}
          onClick={handleSave}
          className="flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] h-11 rounded-xl text-xs sm:text-sm font-semibold bg-accent-orange hover:bg-accent-orange/90 disabled:opacity-40 text-white shadow-lg shadow-accent-orange/25 active:scale-95 transition-all cursor-pointer disabled:cursor-not-allowed touch-manipulation"
        >
          <span>{session.saving ? t("ui.saving") : t("ui.settingsSaveChanges")}</span>
        </button>
      </div>
    </div>
  )

  // Staged controls + preview: every defaults-backed edit below writes the
  // local session only — no PUT, no localStorage, no live outer mutation
  // until the single global Save.
  // Mobile (user-authorized floating design): NO reserved preview section —
  // the controls own the full body height (the only scroller) and the real
  // global preview floats as a corner-snapped mini overlay (draggable,
  // minimizable, tap-to-zoom) bounded inside this relative container, i.e.
  // below header/nav/format and above the footer. Desktop keeps the static
  // preview column. One mounted DefaultsPosterPreview owner in both modes
  // (floating/static flips by prop on resize: no unmount, no refetch).
  // On desktop the grid row is bounded (`minmax(0,1fr)`) so both columns
  // scroll independently inside the dialog body (preview: poster-first
  // compact layout with the search directly below; controls: existing scroller).
  // DOM order is preview-then-controls with matching desktop grid placement
  // (preview col 2, controls col 1), so keyboard/AT order always matches
  // the visual order — no flex-order swaps.
  const stagedPrimary = (
    <PosterEditorValueOverride value={session.value}>
      <div className={`relative flex-1 min-h-0 ${showPreview && mobileViewport !== true ? (previewIsLandscape ? "flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(300px,40%)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(360px,44%)]" : "flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(220px,32%)] md:grid-rows-[minmax(0,1fr)]") : "flex flex-col"}`}>
        {showPreview && (
          <FloatingPreview
            corner={previewCorner}
            onCornerChange={setPreviewCorner}
            minimized={previewMinimized}
            onMinimizedChange={setPreviewMinimized}
            widthClass={previewIsLandscape ? "w-[148px]" : "w-[104px]"}
            dragEnabled={mobileViewport === true}
          >
            <DefaultsPosterPreview
              floating={mobileViewport === true}
              suspended={pendingNav !== null}
              previewShape={editTargetShape}
              demoMedia={previewDemoMedia}
              onDemoMediaChange={setPreviewDemoMedia}
              previewFamily={previewFamily}
              onPreviewFamilyChange={setPreviewFamily}
            />
          </FloatingPreview>
        )}
        <div className="min-w-0 min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4 md:col-start-1 md:row-start-1" data-testid="settings-controls" data-scroll="settings-controls">
          <PresetsPanel shape={editTargetShape} demoMedia={previewDemoMedia} active={activeTab === "preset"} />
          <BadgeDefaultsSection
            active={activeTab === "rankings"}
            shape={editTargetShape}
            mode="rankings"
            testStaged
            testDirty={session.dirty}
            onPreviewFamilyChange={setPreviewFamily}
            presetsEnabled={false}
          />
          <BadgeDefaultsSection
            active={activeTab === "information"}
            shape={editTargetShape}
            mode="information"
            testStaged
            testDirty={session.dirty}
            onPreviewFamilyChange={setPreviewFamily}
            presetsEnabled={false}
          />
          <BadgeDefaultsSection
            active={activeTab === "badge"}
            shape={editTargetShape}
            mode="appearance"
            testStaged
            testDirty={session.dirty}
            onPreviewFamilyChange={setPreviewFamily}
            presetsEnabled={false}
          />
          <TagsNetworksSection active={activeTab === "tags"} />
          <TransformPanel
            active={activeTab === "transform"}
            previewShape={editTargetShape}
            onPreviewShapeChange={requestShapeChange}
            onPreviewFamilyChange={setPreviewFamily}
            demoMedia={previewDemoMedia}
            previewFamily={previewFamily}
            geometryOnly
          />
          <PrefsPanel active={activeTab === "prefs"} />
          <DataPanel
            active={activeTab === "data"}
            exportData={exportData}
            importData={importData}
            setSettingsOpen={setSettingsOpen}
            multiUserOn={multiUserOn}
            requestAction={requestAction}
          />
          {showSpaceTab && (
            <div
              role="tabpanel"
              aria-label={t("ui.settingsTabSpace")}
              className={`space-y-3.5 text-xs ${activeTab === "spazio" ? "block animate-tab-fade-in" : "hidden"}`}
            >
              <UserSpaceSection />
              <UserKeysSection />
              <TraktAccountSection active={activeTab === "spazio"} onRequestExternalAction={requestAction} />
            </div>
          )}
          <div
            role="tabpanel"
            aria-label={t("ui.catalogsTitle")}
            className={`space-y-3.5 text-xs ${activeTab === "catalogs" ? "block animate-tab-fade-in" : "hidden"}`}
          >
            <SeasonalKeywordsSection />
            <div className="px-4 py-3">
              <button
                type="button"
                data-testid="settings-open-catalog-manager"
                onClick={() => requestAction(() => {
                  doClose()
                  router.push("cataloghi")
                })}
                className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-xs sm:text-sm font-semibold text-zinc-100 transition-all active:scale-95 cursor-pointer touch-manipulation"
              >
                {t("ui.priorityNames")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PosterEditorValueOverride>
  )

  const isMobileLayout = mobileViewport === true
  const mobileHeader = (
    <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur-2xl flex items-center justify-between px-2.5 py-1.5 border-b border-white/10 shadow-lg shadow-black/20 shrink-0">
      <h2 id="settings-dialog-title" className="text-sm font-bold text-zinc-100 flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4 text-accent-orange" />
        <span>{t("ui.settingsGlobalTitle") || t("ui.settingsTitle")}</span>
      </h2>
      <button
        type="button"
        aria-label={t("ui.back")}
        disabled={session.saving}
        onClick={requestClose}
        className="px-4 py-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-xs sm:text-sm font-semibold text-zinc-200 hover:text-white active:scale-95 transition-all duration-150 min-h-[44px] min-w-[44px] inline-flex items-center justify-center touch-manipulation cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t("ui.back")}
      </button>
    </div>
  )

  // Single responsive owner: one mount for mobile + desktop (no CSS-hidden
  // twins), so the session, tab and format state survive resize.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      // While the exit-confirm modal is open the settings shell underneath
      // is inert and hidden from assistive tech: the portalled modal is a
      // DOM sibling (never a nested dialog) and the sole active dialog.
      aria-hidden={pendingNav !== null ? true : undefined}
      inert={pendingNav !== null}
      className={isMobileLayout
        ? "fixed inset-0 z-[70] bg-background flex flex-col animate-fade-scale-in"
        : "fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in"}
      onClick={isMobileLayout ? undefined : requestClose}
    >
      <div
        ref={settingsRef}
        tabIndex={-1}
        className={isMobileLayout
          ? "settings-panel flex flex-col h-full min-h-0 w-full max-w-lg mx-auto overflow-hidden"
          : "settings-panel settings-dialog-panel relative outline-none w-full max-w-5xl h-[88dvh] max-h-[88dvh] flex flex-col rounded-2xl border border-white/10 bg-[#121216] shadow-2xl shadow-black/90 select-text animate-modal-panel-in overflow-hidden my-auto transition-all duration-200"}
        onClick={isMobileLayout ? undefined : (e) => e.stopPropagation()}
      >
        {isMobileLayout ? (
          mobileHeader
        ) : (
          <div className="settings-dialog-header flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10 bg-[#141418] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/25">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <div>
                <h3 id="settings-dialog-title" className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-1.5">
                  <span>{t("ui.settingsGlobalTitle") || t("ui.settingsTitle")}</span>
                </h3>
              </div>
            </div>
            <button
              type="button"
              aria-label={t("ui.close")}
              disabled={session.saving}
              onClick={requestClose}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-90 cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {tabsNav}
        {tabHeaderSlot}
        {conflictBanner}
        {stagedPrimary}
        {pendingDialog}
        {footer}
      </div>
    </div>
  )
}
