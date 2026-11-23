"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"
import { requestSettingsTab } from "@/lib/settings-tab"
import { Modal } from "@/components/ui/Modal"
import { OnboardingChecklistBody } from "@/components/OnboardingChecklistBody"
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
  /**
   * The setup wizard already showed this checklist as its last step: open
   * stepped aside (reopen pill) instead of stacking a second modal right after
   * it. Dismissal and replay semantics are unchanged.
   */
  startStepped?: boolean
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
export function OnboardingTour({ onOpenInstall, replayRequest, onReplayClosed, startStepped }: OnboardingTourProps) {
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
  // Read inside the mount/switch effect without re-running it when it flips.
  const startSteppedRef = useRef(startStepped)
  startSteppedRef.current = startStepped
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
        setShow(!startSteppedRef.current)
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
      setShow(!startSteppedRef.current)
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
          className="fixed bottom-20 left-4 z-[290] flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/85 px-3.5 py-2 text-xs font-medium text-zinc-200 shadow-xl shadow-black/40 backdrop-blur-md transition duration-150 hover:bg-zinc-900 active:scale-95 md:bottom-6"
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-500 transition duration-200 hover:bg-white/10 hover:text-zinc-300 active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <OnboardingChecklistBody
        hasKey={hasKey}
        hasSavedPoster={hasSavedPoster}
        installOpened={installOpened}
        onInstall={openInstall}
        onCustomize={customize}
        onOpenKeySettings={openKeySettings}
        onSkip={dismiss}
      />
      </Modal>
    </>
  )
}
