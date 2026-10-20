"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { Check, Circle, Images, KeyRound, QrCode, Search, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"
import { requestSettingsTab } from "@/lib/settings-tab"
import { Modal } from "@/components/ui/Modal"
import {
  ONBOARDING_INSTALL_OPENED_EVENT,
  dismissOnboarding,
  hasLegacyOnboardingDismissal,
  readOnboardingProgress,
  writeOnboardingProgress,
} from "@/lib/onboarding-progress"

interface OnboardingTourProps {
  /** Opens the installation modal (AppShell-owned state). */
  onOpenInstall?: () => void
  /**
   * Explicit replay request from "Repeat guided setup" (AppShell-owned,
   * in-memory, consumed once). When the nonce is fresh and `userId` matches
   * the current namespace, the tour opens once even under a legacy or
   * namespaced dismissal — checklist steps still derive from live state.
   */
  replayRequest?: { nonce: number; userId: string | null } | null
  /**
   * Fired when a replay session ends via manual dismiss (skip/X/Escape).
   * The owner (AppShell) retires the active intent so a later tour remount
   * (ordinary wizard/PIN gate cycle) cannot replay the dismissed session.
   * Clearing is safe: the dismissal is already persisted per-namespace, so
   * the remount falls through to the stored dismissal instead of replaying.
   */
  onReplayClosed?: () => void
}

function StepRow({
  testId,
  icon,
  label,
  done,
  doneText,
  todoText,
  children,
}: {
  testId: string
  icon: React.ReactNode
  label: string
  done: boolean
  doneText: string
  todoText: string
  children?: React.ReactNode
}) {
  return (
    <li
      data-testid={testId}
      data-done={done ? "true" : "false"}
      className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-zinc-500"
        }`}
      >
        {done ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
          <span aria-hidden="true" className="text-zinc-500">{icon}</span>
          {label}
        </span>
        <span className={`mt-0.5 block text-[11px] ${done ? "text-emerald-300/90" : "text-zinc-500"}`}>
          {done ? doneText : todoText}
        </span>
        {children}
      </span>
    </li>
  )
}

/**
 * Action-based first-use onboarding: two guided paths (install now with
 * defaults, or search + customize a poster) plus a live checklist that
 * advances only on real actions — a configured key, a first saved poster,
 * and the installation modal actually opening.
 *
 * Path buttons navigate or open existing surfaces and never write any
 * poster/config themselves; key and save steps derive from live app state
 * (clicks alone never mark them). Skippable via skip/X/Escape and never
 * blocking: installation stays available regardless of saved posters.
 */
export function OnboardingTour({ onOpenInstall, replayRequest, onReplayClosed }: OnboardingTourProps) {
  const { t } = useT()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const serverHasTmdbKey = usePSelector((v) => v.serverHasTmdbKey)
  const mappings = usePSelector((v) => v.mappings)
  const currentUserId = usePSelector((v) => v.currentUserId)
  const router = usePSelector((v) => v.router)
  const setSettingsOpen = usePSelector((v) => v.setSettingsOpen)

  const hasKey = !!tmdbKey || serverHasTmdbKey
  const hasSavedPoster = (mappings ?? []).length > 0

  const [show, setShow] = useState(false)
  const [installOpened, setInstallOpened] = useState(false)
  // Explicit dismissal is sticky for the session: stepping aside via a path
  // button only hides the overlay (the checklist keeps advancing on real
  // actions), while skip/X/Escape or full completion dismiss it for good.
  const [dismissed, setDismissed] = useState(false)
  // Explicit replay session ("Repeat guided setup"): opens once even under a
  // previous dismissal and never auto-dismisses on mount — fully-complete
  // replays stay inspectable until the user skips/closes. Checklist steps
  // still reflect live state; only manual dismiss ends the replay.
  const [replayActive, setReplayActive] = useState(false)
  const consumedReplayRef = useRef(0)
  // Namespace the switch effect has actually loaded. Guards the
  // auto-complete below so stale live state from the previous space can
  // never dismiss the tour in the new one before its own progress loads.
  const [syncedUser, setSyncedUser] = useState(currentUserId)

  // First paint / namespace switch / explicit replay: a fresh replay nonce
  // for the current namespace wins over legacy and namespaced dismissal
  // (open once, keep real progress, no instant auto-dismiss — see the
  // completion effect below). A replay meant for another namespace is
  // ignored. Otherwise legacy dismissal wins, then the namespaced progress
  // (exact installOpened value — reset to false when the new space stored
  // nothing — plus dismissal).
  useEffect(() => {
    try {
      if (
        replayRequest &&
        replayRequest.nonce !== 0 &&
        replayRequest.nonce === consumedReplayRef.current &&
        replayRequest.userId === currentUserId
      ) {
        // Same replay session already consumed (e.g. a StrictMode second
        // execution with the identical intent): idempotent no-op — never
        // fall through to the dismissal branches below. Ref-based on
        // purpose: the second setup runs before any scheduled state lands.
        return
      }
      if (
        replayRequest &&
        replayRequest.nonce !== 0 &&
        replayRequest.nonce !== consumedReplayRef.current &&
        replayRequest.userId === currentUserId
      ) {
        consumedReplayRef.current = replayRequest.nonce
        const progress = readOnboardingProgress(currentUserId)
        setReplayActive(true)
        setDismissed(false)
        setInstallOpened(progress?.installOpened === true)
        setSyncedUser(currentUserId)
        setShow(true)
        return
      }
      if (hasLegacyOnboardingDismissal()) {
        setReplayActive(false)
        setDismissed(true)
        setShow(false)
        return
      }
      const progress = readOnboardingProgress(currentUserId)
      if (progress?.dismissed) {
        setReplayActive(false)
        setDismissed(true)
        setShow(false)
        setSyncedUser(currentUserId)
        return
      }
      setReplayActive(false)
      setDismissed(false)
      setInstallOpened(progress?.installOpened === true)
      setSyncedUser(currentUserId)
      setShow(true)
    } catch {
      setReplayActive(false)
      setDismissed(false)
      setInstallOpened(false)
      setSyncedUser(currentUserId)
      setShow(true)
    }
  }, [currentUserId, replayRequest])

  // The install step completes when the install modal actually opens — the
  // event fires from AppShell on real modal state, covering toolbar opens
  // too. Persisted per namespace, booleans only.
  useEffect(() => {
    const onOpened = () => {
      setInstallOpened(true)
      writeOnboardingProgress(currentUserId, { installOpened: true })
    }
    window.addEventListener(ONBOARDING_INSTALL_OPENED_EVENT, onOpened)
    return () => window.removeEventListener(ONBOARDING_INSTALL_OPENED_EVENT, onOpened)
  }, [currentUserId])

  const dismiss = useCallback(() => {
    const wasReplay = replayActive
    dismissOnboarding(currentUserId)
    setReplayActive(false)
    setDismissed(true)
    setShow(false)
    // Retire the owner intent when a replay session ends: without this, the
    // still-active intent would replay the dismissed session on the next
    // tour remount (wizard/PIN gate). No-op for ordinary dismissals (the
    // owner holds nothing then).
    if (wasReplay) onReplayClosed?.()
  }, [currentUserId, onReplayClosed, replayActive])

  // Full completion on real actions only: configured key + saved poster +
  // opened installation. Never required to save before installing — each
  // step completes independently whenever its action happens. Runs even
  // while the overlay is stepped aside (show === false) so progress made
  // after a path action still completes, and never on stale state from the
  // previous namespace (syncedUser guard). Skipped for explicit replays:
  // a fully-complete replay must stay inspectable until the user closes it.
  const completed = hasKey && hasSavedPoster && installOpened
  useEffect(() => {
    if (replayActive) return
    if (!dismissed && syncedUser === currentUserId && completed) dismiss()
  }, [dismissed, syncedUser, currentUserId, completed, dismiss, replayActive])

  // Path actions only navigate/open existing surfaces: no poster or config
  // is written here. The overlay steps aside (not dismissed) and the
  // reopen pill below brings the checklist back — it keeps reflecting
  // live progress on return.
  const openInstall = useCallback(() => {
    setShow(false)
    onOpenInstall?.()
  }, [onOpenInstall])

  const customize = useCallback(() => {
    setShow(false)
    router.push("search")
  }, [router])

  // Key settings live in Space settings (same destination as the home
  // welcome panel): opening them never marks the key step — only a real
  // configured key (local or server-held) does.
  const openKeySettings = useCallback(() => {
    setShow(false)
    requestSettingsTab("spazio")
    setSettingsOpen(true)
  }, [setSettingsOpen])

  const doneText = t("ui.done")
  const todoText = t("ui.installCheckNotChecked")

  // Small non-blocking way back while steps are still pending: a keyboard-
  // accessible pill (clears the mobile bottom nav, sits bottom-left on
  // desktop). Never forced back over the editor/install and never reshown
  // on its own — only this explicit tap reopens. During an explicit replay
  // the way back stays available even when every step is already done, so
  // stepping aside from a complete replay can still return to it.
  const reopen = useCallback(() => {
    setShow(true)
  }, [])
  const showLauncher = !show && !dismissed && (!completed || replayActive)

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          data-testid="onboarding-reopen"
          onClick={reopen}
          aria-label={t("ui.onboardingResume")}
          className="fixed bottom-20 left-4 z-[290] flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/85 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl shadow-black/40 backdrop-blur-md transition-all duration-150 hover:bg-zinc-900 active:scale-95 md:bottom-6"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-orange" />
          {t("ui.onboardingResume")}
        </button>
      )}
      <Modal
        isOpen={show}
      onClose={dismiss}
      labelledBy="onboarding-tour-title"
      describedBy="onboarding-tour-desc"
      testId="onboarding-tour"
      overlayClassName="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="onboarding-tour-title" className="text-base font-bold text-foreground">
          {t("ui.onboardingActionTitle")}
        </h3>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("ui.close")}
          data-testid="onboarding-close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-500 transition-all duration-200 hover:bg-white/10 hover:text-zinc-300 active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p id="onboarding-tour-desc" className="text-sm text-muted leading-relaxed">
        {t("ui.onboardingActionDesc")}
      </p>

      <div className="grid gap-2">
        <button
          type="button"
          data-testid="onboarding-path-install"
          onClick={openInstall}
          className="flex items-center gap-3 rounded-xl border border-accent-orange/30 bg-accent-orange/10 px-4 py-3 text-left transition-all duration-150 hover:bg-accent-orange/20 active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-orange/20 text-accent-orange">
            <QrCode className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {t("ui.onboardingPathInstall")}
            </span>
            <span className="block text-xs text-muted leading-relaxed">
              {t("ui.onboardingPathInstallDesc")}
            </span>
          </span>
        </button>

        <button
          type="button"
          data-testid="onboarding-path-customize"
          onClick={customize}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition-all duration-150 hover:bg-white/[0.08] active:scale-[0.98]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-300">
            <Search className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {t("ui.onboardingPathCustomize")}
            </span>
            <span className="block text-xs text-muted leading-relaxed">
              {t("ui.onboardingPathCustomizeDesc")}
            </span>
          </span>
        </button>
      </div>

      <ul
        data-testid="onboarding-checklist"
        aria-label={t("ui.onboardingChecklist")}
        aria-live="polite"
        className="grid gap-1.5"
      >
        <StepRow
          testId="onboarding-step-key"
          icon={<KeyRound className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepKey")}
          done={hasKey}
          doneText={doneText}
          todoText={todoText}
        >
          {!hasKey && (
            <button
              type="button"
              data-testid="onboarding-open-key-settings"
              onClick={openKeySettings}
              className="mt-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
            >
              {t("ui.onboardingOpenKeySettings")}
            </button>
          )}
          <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">
            {t("ui.onboardingKeyUnverified")}
          </span>
        </StepRow>
        <StepRow
          testId="onboarding-step-save"
          icon={<Images className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepSave")}
          done={hasSavedPoster}
          doneText={doneText}
          todoText={todoText}
        />
        <StepRow
          testId="onboarding-step-install"
          icon={<QrCode className="h-3.5 w-3.5" />}
          label={t("ui.onboardingStepInstall")}
          done={installOpened}
          doneText={doneText}
          todoText={todoText}
        />
      </ul>

      <button
        type="button"
        data-testid="onboarding-skip"
        onClick={dismiss}
        className="w-full rounded-xl py-2 text-xs text-zinc-600 transition-colors duration-150 hover:text-muted border-t border-white/5"
      >
        {t("ui.onboardingSkip")}
      </button>
      </Modal>
    </>
  )
}
