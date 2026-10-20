"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ONBOARDING_REPLAY_EVENT } from "@/lib/onboarding-progress"

/**
 * Explicit onboarding replay intent ("Repeat guided setup") — AppShell-owned,
 * in-memory only. A reload never auto-replays. Keys, posters and settings are
 * untouched; the setup wizard (LangPicker) always runs first and the tour
 * opens after it closes (never stacked).
 *
 * Lifecycle (owner lifetime):
 * - `requestOnboardingReplay(userId)` (window event, fired by DataPanel
 *   through the settings dirty-guard) arms a *pending* intent.
 * - `promotePendingReplay()` (wired to the wizard `onDone`) activates it, but
 *   only when the request came from the current namespace; anything else is
 *   dropped, never replayed later.
 * - `clearActiveReplay()` retires the active intent. The tour calls it back
 *   via `onReplayClosed` on manual dismiss (skip/X/Escape): the intent must
 *   not survive its session, otherwise a later tour remount (ordinary
 *   wizard/PIN gate cycle) would replay a dismissed session again. Clearing
 *   here is safe because the dismissal is already persisted per-namespace, so
 *   the remount falls through to the stored dismissal instead of replaying.
 * - A namespace switch drops pending/active intent scoped to another space.
 */
export interface OnboardingReplayIntent {
  userId: string | null
  nonce: number
}

export function useOnboardingReplayIntent(currentUserId: string | null) {
  const [pendingReplay, setPendingReplay] = useState<OnboardingReplayIntent | null>(null)
  const [activeReplay, setActiveReplay] = useState<OnboardingReplayIntent | null>(null)
  const replayNonceRef = useRef(0)

  useEffect(() => {
    const onReplay = (e: Event) => {
      const userId = (e as CustomEvent<{ userId?: string | null }>).detail?.userId ?? null
      replayNonceRef.current += 1
      setPendingReplay({ userId, nonce: replayNonceRef.current })
    }
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay)
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay)
  }, [])

  // A switch to another space retires intent scoped elsewhere: it must never
  // reapply there (nor leak back on return — a new explicit repeat re-arms).
  useEffect(() => {
    setPendingReplay((prev) => (prev && prev.userId !== currentUserId ? null : prev))
    setActiveReplay((prev) => (prev && prev.userId !== currentUserId ? null : prev))
  }, [currentUserId])

  // The wizard owns the focus while open (the tour stays parked). Only a
  // replay requested from the current namespace activates; anything else is
  // dropped, never replayed later.
  const promotePendingReplay = useCallback(() => {
    if (pendingReplay && pendingReplay.userId === currentUserId) {
      setActiveReplay(pendingReplay)
    }
    setPendingReplay(null)
  }, [pendingReplay, currentUserId])

  const clearActiveReplay = useCallback(() => {
    setActiveReplay(null)
  }, [])

  return { pendingReplay, activeReplay, promotePendingReplay, clearActiveReplay }
}
