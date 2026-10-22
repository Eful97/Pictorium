/**
 * Space-wide exclusions, part 3: staged settings session + tab UI.
 *
 * - New session setters stage drafts (dirty without PUT/localStorage writes),
 *   persist through the single global Save PUT, and reset on discard.
 * - The "Tag e Network" tab renders the canonical rows with accessible
 *   toggles and per-group enable-all/disable-all controls.
 */
import type { ReactNode } from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, fireEvent, renderHook } from "@testing-library/react"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { TranslationProvider } from "@/lib/contexts/TranslationContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { TagsNetworksSection } from "@/components/settings/TagsNetworksSection"
import { createT } from "@/lib/i18n"
import type { PictoriumCtx } from "@/lib/context"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { shouldSkipServerSync } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

function createStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

function uiWrapper({ children }: { children: ReactNode }) {
  const fake = { lang: "en", pickLang: () => {}, t: createT("en") } as unknown as PictoriumCtx
  return (
    <PosterEditorProvider>
      <TranslationProvider value={fake}>{children}</TranslationProvider>
    </PosterEditorProvider>
  )
}

describe("exclusions staged session", () => {
  let putBodies: unknown[]

  beforeEach(() => {
    resetGuestGuardForTests()
    window.history.pushState({}, "", "/")
    const storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: true, status: 200, json: async () => ({}) }
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("stages exclusion edits dirty, saves them in one PUT, discards cleanly", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    expect(result.current.dirty).toBe(false)
    act(() => {
      result.current.value.setDefaultDisabledContentTags(["trueStory", "subgenre:heist"])
      result.current.value.setDefaultDisabledNetworks(["netflix"])
    })
    expect(result.current.dirty).toBe(true)
    expect(result.current.value.defaultDisabledContentTags).toEqual(["trueStory", "subgenre:heist"])
    expect(result.current.value.defaultDisabledNetworks).toEqual(["netflix"])
    let res: Awaited<ReturnType<SettingsSessionResult["save"]>> | null = null
    await act(async () => {
      res = await result.current.save()
    })
    expect(res!.ok).toBe(true)
    expect(result.current.dirty).toBe(false)
    expect(putBodies).toHaveLength(1)
    const body = putBodies[0] as Record<string, unknown>
    expect(body.disabledContentTags).toEqual(["trueStory", "subgenre:heist"])
    expect(body.disabledNetworks).toEqual(["netflix"])
  })

  it("discard resets staged exclusions to the outer baseline", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    act(() => {
      result.current.value.setDefaultDisabledContentTags(["award"])
    })
    expect(result.current.dirty).toBe(true)
    act(() => {
      result.current.discard()
    })
    expect(result.current.dirty).toBe(false)
    expect(result.current.value.defaultDisabledContentTags).toEqual([])
  })
})

describe("TagsNetworksSection tab", () => {
  it("renders canonical tag and network rows with enable-all/disable-all", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    expect(screen.getByTestId("settings-tags-networks")).toBeInTheDocument()
    // Tag groups (ranking switches stay in the existing tab: no rank rows).
    for (const g of ["upcoming", "new", "award", "extra"]) {
      expect(screen.getByTestId(`tag-group-${g}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tag-group-${g}-enable-all`)).toBeInTheDocument()
      expect(screen.getByTestId(`tag-group-${g}-disable-all`)).toBeInTheDocument()
    }
    expect(screen.queryByText("Anime")).not.toBeInTheDocument()
    // Individual canonical rows (test-harness i18n mock resolves Italian).
    expect(screen.getByText("Tratto da una storia vera")).toBeInTheDocument()
    expect(screen.getByText("Cyberpunk")).toBeInTheDocument()
    expect(screen.getByText("Netflix")).toBeInTheDocument()
    expect(screen.getByText("Discovery+")).toBeInTheDocument()
    // Non-featured marks (incl. Amazon MGM Studios) have no individual rows.
    expect(screen.queryByText("Amazon MGM Studios")).toBeNull()
    expect(screen.queryByText("AMC")).toBeNull()
    expect(screen.getByTestId("network-group-disable-all")).toBeInTheDocument()
  })

  it("toggling a tag flips its switch and stages the exclusion", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    const cyberpunk = screen.getByText("Cyberpunk")
    const row = cyberpunk.closest("div")!
    const sw = row.querySelector('[role="switch"]')!
    expect(sw.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(sw)
    expect(sw.getAttribute("aria-checked")).toBe("false")
  })

  it("disable-all on a group switches every toggle off", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    const group = screen.getByTestId("tag-group-award")
    const switches = group.querySelectorAll('[role="switch"]')
    expect(switches.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId("tag-group-award-disable-all"))
    for (const sw of Array.from(switches)) {
      expect(sw.getAttribute("aria-checked")).toBe("false")
    }
  })

  it("hidden when inactive (tab contract like the other sections)", () => {
    const { container } = render(<TagsNetworksSection active={false} />, { wrapper: uiWrapper })
    expect(screen.getByTestId("settings-tags-networks").className).toMatch(/hidden/)
    expect(container.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0)
  })
})
