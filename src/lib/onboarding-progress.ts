"use client"

/**
 * First-use onboarding progress — persisted checklist state for the
 * action-based OnboardingTour.
 *
 * Namespace isolation: progress lives under
 * `pictorium_onboarding_progress:<uuid|local>`, so each space tracks its own
 * real actions (installation opened). Key presence and saved posters are
 * derived live from app state and are NEVER persisted here.
 *
 * Namespaced dismissal: `dismissOnboarding` writes ONLY the per-namespace
 * progress key. The legacy global `pictorium_onboarding_done` is honored
 * read-only (users dismissed under the old slide-based tour never replay)
 * but is never written by new dismissals — one space skipping must not
 * suppress onboarding in every other space.
 *
 * Privacy: booleans only — no keys, tokens, URLs or secrets ever enter
 * progress, URLs or logs.
 */

export const ONBOARDING_DONE_KEY = "pictorium_onboarding_done"

/** Window event fired when the install modal actually opens (real action). */
export const ONBOARDING_INSTALL_OPENED_EVENT = "pictorium:install-opened"

/**
 * Window event fired by the explicit "Repeat guided setup" action. Carries
 * the namespace the repeat was requested from (`detail.userId`, null for
 * the profileless space). Transient and in-memory only: AppShell holds the
 * pending/active replay in React state, so a page reload never auto-replays.
 * No keys, posters, settings or progress are touched by the request itself.
 */
export const ONBOARDING_REPLAY_EVENT = "pictorium:replay-onboarding"

export function requestOnboardingReplay(userId: string | null): void {
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_REPLAY_EVENT, { detail: { userId } }))
  } catch {
    // No window (SSR) — the repeat button never renders there anyway.
  }
}

const PROGRESS_PREFIX = "pictorium_onboarding_progress:"

export interface OnboardingProgress {
  v: 1
  dismissed?: boolean
  installOpened?: boolean
}

export function onboardingProgressKey(userId: string | null): string {
  return `${PROGRESS_PREFIX}${userId ?? "local"}`
}

function parseProgress(raw: string | null): OnboardingProgress | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const p = parsed as Record<string, unknown>
    if (p["v"] !== 1) return null
    const out: OnboardingProgress = { v: 1 }
    if (p["dismissed"] === true) out.dismissed = true
    if (p["installOpened"] === true) out.installOpened = true
    return out
  } catch {
    return null
  }
}

export function readOnboardingProgress(userId: string | null): OnboardingProgress | null {
  try {
    return parseProgress(localStorage.getItem(onboardingProgressKey(userId)))
  } catch {
    return null
  }
}

export function writeOnboardingProgress(
  userId: string | null,
  patch: Pick<OnboardingProgress, "dismissed" | "installOpened">,
): void {
  try {
    const prev = readOnboardingProgress(userId) ?? { v: 1 as const }
    const next: OnboardingProgress = { ...prev, v: 1 }
    if (patch.dismissed === true) next.dismissed = true
    if (patch.installOpened === true) next.installOpened = true
    localStorage.setItem(onboardingProgressKey(userId), JSON.stringify(next))
  } catch {
    // localStorage unavailable (SSR, private mode) — progress stays session-only.
  }
}

/** Explicit dismiss/skip or full completion: namespaced only. The legacy
 *  global key is intentionally NOT written here (read-only backcompat in
 *  `hasLegacyOnboardingDismissal`): a new skip in one space must leave every
 *  other space untouched. */
export function dismissOnboarding(userId: string | null): void {
  writeOnboardingProgress(userId, { dismissed: true })
}

/** Legacy global dismissal only (already-dismissed users never replay). */
export function hasLegacyOnboardingDismissal(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) !== null
  } catch {
    return false
  }
}
