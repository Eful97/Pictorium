import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useCallback, useState } from "react"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import en from "@/lib/translations/en.json"
import { PictoriumProvider } from "@/lib/context"
import { DataPanel } from "@/components/settings/DataPanel"
import { LangPicker } from "@/components/LangPicker"
import { OnboardingTour } from "@/components/OnboardingTour"
import { renderWithCtx, MOCK_CTX } from "@/__tests__/test-utils"
import { ONBOARDING_DONE_KEY, ONBOARDING_REPLAY_EVENT } from "@/lib/onboarding-progress"
import { useOnboardingReplayIntent } from "@/lib/use-onboarding-replay"

const t = (key: string) => (en as Record<string, string>)[key] ?? key

/**
 * Targeted integration for "Repeat guided setup" (finding 3): the REAL
 * DataPanel repeat handler through the settings dirty-guard contract, the
 * REAL owner intent (`useOnboardingReplayIntent`, the same hook AppShell
 * wires), the REAL setup wizard (`LangPicker.onDone`) and the REAL tour.
 * The tour is never opened by hand-setting `replayRequest` — it only opens
 * when the full event chain fires.
 *
 * Guard semantics (unchanged): `requestAction` defers the action; cancel
 * never runs it (nothing dispatched), commit runs it exactly once.
 */
describe("Repeat guided setup integration (DataPanel guard -> wizard -> tour)", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  function ChainHarness({ guard }: { guard?: (run: () => void) => void }) {
    const [wizardOpen, setWizardOpen] = useState(false)
    const replay = useOnboardingReplayIntent(null)
    const promotePendingReplay = replay.promotePendingReplay
    // Same shape as AppShell.handleWizardDone: close the wizard, then
    // promote a pending replay (if the request came from this namespace).
    const handleWizardDone = useCallback(() => {
      setWizardOpen(false)
      promotePendingReplay()
    }, [promotePendingReplay])
    return (
      <PictoriumProvider
        value={
          {
            ...MOCK_CTX,
            t: t as never,
            currentUserId: null,
            tmdbKey: "",
            serverHasTmdbKey: false,
            mappings: [],
            setSettingsOpen: vi.fn(),
            setShowLangPicker: ((v: boolean) => setWizardOpen(v)) as never,
          } as never
        }
      >
        <DataPanel
          active
          exportData={vi.fn()}
          importData={vi.fn()}
          setSettingsOpen={vi.fn()}
          multiUserOn={false}
          requestAction={guard}
        />
        {wizardOpen && (
          <LangPicker
            onPickLang={vi.fn()}
            onPickRegion={vi.fn()}
            onDone={handleWizardDone}
            skipPin
          />
        )}
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

  function countReplayEvents() {
    let dispatched = 0
    const onReplay = () => {
      dispatched += 1
    }
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay)
    return {
      count: () => dispatched,
      stop: () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay),
    }
  }

  it("cancelled guarded repeat dispatches nothing and opens nothing", () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    const events = countReplayEvents()
    try {
      let captured: (() => void) | null = null
      renderWithCtx(<ChainHarness guard={(run) => { captured = run }} />)
      // Legacy dismissal: no tour before any repeat.
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId("repeat-setup"))
      // Guard contract: the action is deferred, not dropped — but cancel
      // never runs it.
      expect(captured).not.toBeNull()
      expect(events.count()).toBe(0)
      // No wizard, no tour.
      expect(screen.queryByText("Italiano")).not.toBeInTheDocument()
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
    } finally {
      events.stop()
    }
  })

  it("committed guarded repeat runs the real chain: event -> wizard -> tour replay", async () => {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "true")
    const events = countReplayEvents()
    try {
      renderWithCtx(<ChainHarness guard={(run) => run()} />)
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId("repeat-setup"))
      // The committed action dispatched exactly once through the real handler.
      expect(events.count()).toBe(1)
      // The setup wizard runs first (tour parked).
      expect(screen.getByText("Italiano")).toBeInTheDocument()
      expect(screen.queryByTestId("onboarding-tour")).not.toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(screen.getByText("English"))
      await user.click(screen.getByText("Giappone"))
      // Wizard done (skipPin) promotes the pending replay: the tour opens
      // despite the legacy dismissal — only the replay path can do that.
      await waitFor(() => {
        expect(screen.getByTestId("onboarding-tour")).toBeInTheDocument()
      })
      // Honest checklist: nothing faked by the chain (no key, no posters,
      // install never opened).
      for (const step of ["key", "save", "install"] as const) {
        expect(screen.getByTestId(`onboarding-step-${step}`)).toHaveAttribute("data-done", "false")
      }
    } finally {
      events.stop()
    }
  })
})
