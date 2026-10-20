import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { StrictMode, useState } from "react"
import { fireEvent, screen, waitFor, act, render } from "@testing-library/react"
import en from "@/lib/translations/en.json"
import { OnboardingTour } from "@/components/OnboardingTour"
import { PictoriumProvider } from "@/lib/context"
import { consumeSettingsTab } from "@/lib/settings-tab"
import {
  ONBOARDING_DONE_KEY,
  ONBOARDING_INSTALL_OPENED_EVENT,
  onboardingProgressKey,
  requestOnboardingReplay,
} from "@/lib/onboarding-progress"
import { useOnboardingReplayIntent } from "@/lib/use-onboarding-replay"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

const t = (key: string) => (en as Record<string, string>)[key] ?? key

const UUID_A = "123e4567-e89b-12d3-a456-426614174000"
const UUID_B = "223e4567-e89b-12d3-a456-426614174001"

function savedPoster(): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Saved Title",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: new Date().toISOString(),
  }
}

function renderTour(overrides: Record<string, unknown> = {}, onOpenInstall = vi.fn()) {
  return renderWithCtx(<OnboardingTour onOpenInstall={onOpenInstall} />, {
    t: t as never,
    tmdbKey: "",
    serverHasTmdbKey: false,
    mappings: [],
    currentUserId: null,
    ...overrides,
  } as never)
}

describe("OnboardingTour (action-based first use)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it("offers both paths and a pending checklist to a fresh user without key or posters", () => {
    renderTour()
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-path-install")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-path-customize")).toBeInTheDocument()
    for (const step of ["key", "save", "install"] as const) {
      expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "false")
    }
    // No key anywhere: the key-settings action is offered inline.
    expect(screen.getByTestId("onboarding-open-key-settings")).toBeInTheDocument()
  })

  it("stays hidden for already-dismissed users (legacy key preserved, every space)", () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    const a = renderTour({ currentUserId: UUID_A })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    a.unmount()
    // A preexisting global dismissal still suppresses every namespace.
    const b = renderTour({ currentUserId: UUID_B })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    b.unmount()
  })

  it("skip dismisses only the current namespace, never the global key nor other spaces", () => {
    const first = renderTour()
    fireEvent.click(screen.getByTestId("onboarding-skip"))
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    // New dismissals are scoped: the legacy global key is left untouched.
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBeNull()
    expect(window.localStorage.getItem(onboardingProgressKey(null))).toContain("dismissed")
    first.unmount()
    // Same-namespace reload stays dismissed.
    const second = renderTour()
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    second.unmount()
    // Another space is unaffected and starts pending.
    const third = renderTour({ currentUserId: UUID_B })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    for (const step of ["key", "save", "install"] as const) {
      expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "false")
    }
    third.unmount()
  })

  it("Escape dismisses through the shared modal contract, scoped to the namespace", () => {
    const { unmount } = renderTour()
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId("onboarding-tour"), { key: "Escape", bubbles: true })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBeNull()
    expect(window.localStorage.getItem(onboardingProgressKey(null))).toContain("dismissed")
    unmount()
  })

  it("install path opens the installation with zero saved posters (no save prerequisite)", () => {
    const onOpenInstall = vi.fn()
    const { unmount } = renderTour({}, onOpenInstall)
    fireEvent.click(screen.getByTestId("onboarding-path-install"))
    expect(onOpenInstall).toHaveBeenCalledTimes(1)
    // The tour steps aside, but nothing is marked done by the click alone.
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBeNull()
    // ... and a keyboard-accessible launcher offers the way back.
    const reopen = screen.getByTestId("onboarding-reopen")
    expect(reopen.tagName).toBe("BUTTON")
    expect(reopen).toHaveAttribute("aria-label", t("ui.onboardingResume"))
    unmount()
  })

  it("install step completes only on the real install-opened event, not on the click", () => {
    const onOpenInstall = vi.fn()
    const { unmount } = renderTour({}, onOpenInstall)
    fireEvent.click(screen.getByTestId("onboarding-path-install"))
    expect(onOpenInstall).toHaveBeenCalledTimes(1)
    unmount()
    // Click alone persisted nothing for the install step.
    expect(window.localStorage.getItem(onboardingProgressKey(null))).toBeNull()
    renderTour({}, onOpenInstall)
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "true")
  })

  it("persists install progress per namespace and never leaks across spaces", () => {
    const { unmount } = renderTour({ currentUserId: UUID_A })
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "true")
    const raw = window.localStorage.getItem(onboardingProgressKey(UUID_A))
    expect(raw).toContain("installOpened")
    // No secrets, tokens, keys or URLs in persisted progress.
    expect(raw).not.toMatch(/token|secret|api[_-]?key|http/i)
    unmount()
    // Another space starts with a pending install step.
    renderTour({ currentUserId: UUID_B })
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    // And the profileless namespace is unaffected too.
    expect(window.localStorage.getItem(onboardingProgressKey(null))).toBeNull()
  })

  it("customize path navigates to search without marking a save", () => {
    const push = vi.fn()
    renderTour({ router: { push, replace: vi.fn(), back: vi.fn() } })
    fireEvent.click(screen.getByTestId("onboarding-path-customize"))
    expect(push).toHaveBeenCalledWith("search")
    expect(push).toHaveBeenCalledTimes(1)
  })

  it("save step reflects an actual saved poster, not the customize click", () => {
    const push = vi.fn()
    const { unmount } = renderTour({ router: { push, replace: vi.fn(), back: vi.fn() } })
    fireEvent.click(screen.getByTestId("onboarding-path-customize"))
    expect(push).toHaveBeenCalledWith("search")
    unmount()
    renderTour({ mappings: [savedPoster()] })
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "true")
  })

  it("key step counts a server-held key (no local key needed)", () => {
    renderTour({ serverHasTmdbKey: true })
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.queryByTestId("onboarding-open-key-settings")).not.toBeInTheDocument()
  })

  it("key step counts a locally configured key", () => {
    renderTour({ tmdbKey: "test-tmdb-key-configured" })
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.queryByTestId("onboarding-open-key-settings")).not.toBeInTheDocument()
  })

  it("key-settings action opens Space settings without marking the key done", () => {
    const setSettingsOpen = vi.fn()
    renderTour({ setSettingsOpen })
    fireEvent.click(screen.getByTestId("onboarding-open-key-settings"))
    expect(setSettingsOpen).toHaveBeenCalledWith(true)
    expect(consumeSettingsTab()).toBe("spazio")
    // Reopen: the click alone never fakes a configured key.
    renderTour({ setSettingsOpen })
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "false")
  })

  it("completes and dismisses only when key, save and install are all real", async () => {
    const { unmount } = renderTour({ tmdbKey: "test-tmdb-key-configured", mappings: [savedPoster()] })
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    })
    // Full completion is scoped too: no new global dismissal is written.
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBeNull()
    expect(window.localStorage.getItem(onboardingProgressKey(null))).toContain("dismissed")
    unmount()
    renderTour({ tmdbKey: "test-tmdb-key-configured", mappings: [savedPoster()] })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
  })

  it("announces checklist status changes to assistive technology", () => {
    renderTour()
    const list = screen.getByTestId("onboarding-checklist")
    expect(list).toHaveAttribute("aria-live", "polite")
    for (const step of ["key", "save", "install"] as const) {
      const el = screen.getByTestId(`onboarding-step-${step}`)
      expect(el.textContent).toContain(t("ui.installCheckNotChecked"))
    }
  })

  it("shows the done status text once a step is complete", () => {
    renderTour({ tmdbKey: "test-tmdb-key-configured" })
    expect(screen.getByTestId("onboarding-step-key").textContent).toContain(t("ui.done"))
  })

  it("stepping aside offers reopen, and live actions complete while hidden", () => {
    const onOpenInstall = vi.fn()
    const push = vi.fn()
    const { unmount } = renderTour(
      { router: { push, replace: vi.fn(), back: vi.fn() } },
      onOpenInstall,
    )
    // Install path: steps aside, nothing marked, launcher offered.
    fireEvent.click(screen.getByTestId("onboarding-path-install"))
    expect(onOpenInstall).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.getByTestId("onboarding-reopen")).toBeInTheDocument()
    // A real install opening completes the step even while hidden.
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.getByTestId("onboarding-reopen")).toBeInTheDocument()
    // Reopen without reload: honest live progress (install done, rest pending).
    fireEvent.click(screen.getByTestId("onboarding-reopen"))
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "false")
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "false")
    // Customize path steps aside the same way (still no fake save).
    fireEvent.click(screen.getByTestId("onboarding-path-customize"))
    expect(push).toHaveBeenCalledWith("search")
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.getByTestId("onboarding-reopen")).toBeInTheDocument()
    unmount()
  })

  it("completes while hidden when the last real action lands (no reopen needed)", async () => {
    const onOpenInstall = vi.fn()
    const { unmount } = renderTour(
      { tmdbKey: "test-tmdb-key-configured", mappings: [savedPoster()] },
      onOpenInstall,
    )
    fireEvent.click(screen.getByTestId("onboarding-path-install"))
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    // All three real while stepped aside: dismissed, no modal, no launcher.
    await waitFor(() => {
      expect(window.localStorage.getItem(onboardingProgressKey(null))).toContain("dismissed")
    })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.queryByTestId("onboarding-reopen")).not.toBeInTheDocument()
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBeNull()
    unmount()
  })

  it("namespace switch on the same mounted tree never leaks installOpened (A key+save+install -> empty B)", async () => {    const controls: {
      setUid?: (u: string | null) => void
      setExtra?: (e: Record<string, unknown>) => void
    } = {}
    function SwitchingTour({
      initialUid,
      initialExtra,
      onOpenInstall,
    }: {
      initialUid: string | null
      initialExtra?: Record<string, unknown>
      onOpenInstall: () => void
    }) {
      const [uid, setUid] = useState<string | null>(initialUid)
      const [extra, setExtra] = useState<Record<string, unknown>>(initialExtra ?? {})
      controls.setUid = setUid
      controls.setExtra = setExtra
      const ctx = {
        ...MOCK_CTX,
        t: t as never,
        tmdbKey: "",
        serverHasTmdbKey: false,
        mappings: [],
        currentUserId: uid,
        ...extra,
      } as never
      return (
        <PictoriumProvider value={ctx}>
          <OnboardingTour onOpenInstall={onOpenInstall} />
        </PictoriumProvider>
      )
    }
    const onOpenInstall = vi.fn()
    const { unmount } = render(
      <SwitchingTour
        initialUid={UUID_A}
        initialExtra={{ tmdbKey: "test-tmdb-key-configured", mappings: [savedPoster()] }}
        onOpenInstall={onOpenInstall}
      />,
    )
    // A: key + save real, install pending.
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    act(() => {
      window.dispatchEvent(new CustomEvent(ONBOARDING_INSTALL_OPENED_EVENT))
    })
    // A completes on real actions: scoped dismissal, overlay gone.
    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    })
    expect(window.localStorage.getItem(onboardingProgressKey(UUID_A))).toContain("installOpened")
    // Switch to empty B WITHOUT unmounting: same tree, fresh pending tour.
    act(() => {
      controls.setUid!(UUID_B)
      controls.setExtra!({})
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    for (const step of ["key", "save", "install"] as const) {
      expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "false")
    }
    // Key + save become real in B with no install ever opened there:
    // the tour must stay (stale A state must not complete B).
    act(() => {
      controls.setExtra!({ tmdbKey: "other-key-configured", mappings: [savedPoster()] })
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    unmount()
  })
})

describe("OnboardingTour explicit replay (Repeat guided setup)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it("reopens once despite legacy global dismissal, with honest live checklist", () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    renderWithCtx(
      <OnboardingTour
        onOpenInstall={vi.fn()}
        replayRequest={{ nonce: 1, userId: null }}
      />,
      {
        t: t as never,
        tmdbKey: "test-tmdb-key-configured",
        serverHasTmdbKey: false,
        mappings: [savedPoster()],
        currentUserId: null,
      } as never,
    )
    // Bypassed suppression, but nothing faked: key + save done, install pending.
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-step-key")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-save")).toHaveAttribute("data-done", "true")
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
  })

  it("stays inspectable when fully complete and closes on skip without touching keys or posters", async () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    window.localStorage.setItem(
      onboardingProgressKey(null),
      JSON.stringify({ v: 1, installOpened: true }),
    )
    const setSettingsOpen = vi.fn()
    const { unmount } = renderWithCtx(
      <OnboardingTour
        onOpenInstall={vi.fn()}
        replayRequest={{ nonce: 7, userId: null }}
      />,
      {
        t: t as never,
        tmdbKey: "test-tmdb-key-configured",
        serverHasTmdbKey: false,
        mappings: [savedPoster()],
        currentUserId: null,
        setSettingsOpen,
      } as never,
    )
    // All three real — yet the replay stays open for inspection (no instant auto-dismiss).
    for (const step of ["key", "save", "install"] as const) {
      expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "true")
    }
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    await act(async () => {})
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    // Skip closes the replay; key/poster state is untouched.
    fireEvent.click(screen.getByTestId("onboarding-skip"))
    await waitFor(() => {
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    })
    expect(window.localStorage.getItem(ONBOARDING_DONE_KEY)).toBe("true")
    unmount()
  })

  it("ignores a replay meant for another namespace", () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    const { unmount } = renderWithCtx(
      <OnboardingTour
        onOpenInstall={vi.fn()}
        replayRequest={{ nonce: 3, userId: UUID_A }}
      />,
      {
        t: t as never,
        tmdbKey: "",
        serverHasTmdbKey: false,
        mappings: [],
        currentUserId: UUID_B,
      } as never,
    )
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    unmount()
  })

  it("StrictMode double-effect keeps a fully-complete replay visible (idempotent same-session consume)", async () => {
    // NOTE: StrictMode must wrap OUTSIDE the app providers — nested inside
    // (as renderWithCtx places children) the mount commits once and the
    // double-invoke never fires. Outermost matches a real StrictMode tree.
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    window.localStorage.setItem(
      onboardingProgressKey(null),
      JSON.stringify({ v: 1, installOpened: true }),
    )
    const ctx = {
      ...MOCK_CTX,
      t: t as never,
      tmdbKey: "test-tmdb-key-configured",
      serverHasTmdbKey: false,
      mappings: [savedPoster()],
      currentUserId: null,
    } as never
    const { unmount } = render(
      <StrictMode>
        <PictoriumProvider value={ctx}>
          <OnboardingTour
            onOpenInstall={vi.fn()}
            replayRequest={{ nonce: 11, userId: null }}
          />
        </PictoriumProvider>
      </StrictMode>,
    )
    // Fully complete, yet the explicit replay stays inspectable.
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    await act(async () => {})
    // The second effect execution sees the same nonce already consumed: it
    // must be a no-op, never fall through to legacy suppression.
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    for (const step of ["key", "save", "install"] as const) {
      expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "true")
    }
    unmount()
  })
})

/**
 * Owner-lifetime regressions (finding 1): AppShell owns the replay intent and
 * retires it on dismiss. The harness below uses the REAL owner state machine
 * (`useOnboardingReplayIntent`, the same hook AppShell wires) — never a
 * hand-set `replayRequest` — plus the real tour, with a wizard-gate toggle
 * modelling the `!showLangPicker` unmount/remount cycle.
 */
describe("OnboardingTour replay owner lifetime (AppShell intent)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  function ReplayOwner({
    initialUid,
    controls,
  }: {
    initialUid: string | null
    controls: {
      setWizardOpen?: (v: boolean) => void
      setUid?: (u: string | null) => void
      promote?: () => void
    }
  }) {
    const [uid, setUid] = useState<string | null>(initialUid)
    const [wizardOpen, setWizardOpen] = useState(false)
    const replay = useOnboardingReplayIntent(uid)
    controls.setWizardOpen = setWizardOpen
    controls.setUid = setUid
    controls.promote = replay.promotePendingReplay
    const ctx = {
      ...MOCK_CTX,
      t: t as never,
      tmdbKey: "test-tmdb-key-configured",
      serverHasTmdbKey: false,
      mappings: [savedPoster()],
      currentUserId: uid,
    } as never
    return (
      <PictoriumProvider value={ctx}>
        {wizardOpen && <div data-testid="fake-wizard" />}
        {!wizardOpen && (
          <OnboardingTour
            onOpenInstall={vi.fn()}
            replayRequest={replay.activeReplay}
            onReplayClosed={replay.clearActiveReplay}
          />
        )}
      </PictoriumProvider>
    )
  }

  it("dismissed replay never replays on wizard/PIN remount; a new explicit repeat works again", () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    window.localStorage.setItem(
      onboardingProgressKey(null),
      JSON.stringify({ v: 1, installOpened: true }),
    )
    const controls: {
      setWizardOpen?: (v: boolean) => void
      setUid?: (u: string | null) => void
      promote?: () => void
    } = {}
    const { unmount } = render(<ReplayOwner initialUid={null} controls={controls} />)
    // Legacy dismissal hides the tour before any repeat.
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    // Explicit repeat: real event -> owner promotes on wizard done.
    act(() => {
      requestOnboardingReplay(null)
    })
    act(() => {
      controls.promote!()
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    // Mid-session wizard cycle (not dismissed): the remount resumes it.
    act(() => {
      controls.setWizardOpen!(true)
    })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.queryByTestId("fake-wizard")).toBeInTheDocument()
    act(() => {
      controls.setWizardOpen!(false)
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    // Dismiss ends the session and retires the owner intent.
    fireEvent.click(screen.getByTestId("onboarding-skip"))
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    // Ordinary wizard/PIN remount after dismiss: no replay.
    act(() => {
      controls.setWizardOpen!(true)
    })
    act(() => {
      controls.setWizardOpen!(false)
    })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(screen.queryByTestId("onboarding-reopen")).not.toBeInTheDocument()
    // A new explicit repeat works again.
    act(() => {
      requestOnboardingReplay(null)
    })
    act(() => {
      controls.promote!()
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    unmount()
  })

  it("namespace switch retires stale replay and re-enables the completion guard", () => {
    // Space B is fully complete; space A stored nothing.
    window.localStorage.setItem(
      onboardingProgressKey(UUID_B),
      JSON.stringify({ v: 1, installOpened: true }),
    )
    const controls: {
      setWizardOpen?: (v: boolean) => void
      setUid?: (u: string | null) => void
      promote?: () => void
    } = {}
    const { unmount } = render(<ReplayOwner initialUid={UUID_A} controls={controls} />)
    // A starts as a normal pending tour (install step open).
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-step-install")).toHaveAttribute("data-done", "false")
    // Explicit repeat in A: opens even though nothing is dismissed there.
    act(() => {
      requestOnboardingReplay(UUID_A)
    })
    act(() => {
      controls.promote!()
    })
    expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
    // Switch to fully-complete B: no stale A intent may apply, and the
    // completion guard must fire (a leaked replayActive would keep it open).
    act(() => {
      controls.setUid!(UUID_B)
    })
    expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    expect(window.localStorage.getItem(onboardingProgressKey(UUID_B))).toContain("dismissed")
    unmount()
  })
})
