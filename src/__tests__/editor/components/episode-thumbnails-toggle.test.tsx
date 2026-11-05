/**
 * U1 — episode thumbnails settings toggle.
 *
 * Backend contract (D1-D5): `episodeThumbnails` is persisted through
 * `PUT /api/defaults` and consumed by `/meta`; absent/false keeps the legacy
 * raw TMDB stills. This suite covers the client side only:
 * - the toggle renders in the Prefs episode-metadata card, default OFF;
 * - flipping it updates the shared defaults payload (localStorage + the
 *   debounced PUT body) with an explicit `episodeThumbnails:true/false`;
 * - hydration accepts the flat server key and stays OFF when absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, renderHook, screen } from "@testing-library/react"
import { PrefsPanel } from "@/components/settings/PrefsPanel"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { t } from "@/lib/i18n"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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

type StorageStub = ReturnType<typeof createStorageStub>

describe("episode thumbnails toggle", () => {
  let putBodies: Record<string, unknown>[]
  let storage: StorageStub

  beforeEach(() => {
    storage = createStorageStub()
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
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
  }

  function storedPayload(): Record<string, unknown> {
    return JSON.parse(storage.getItem("badgeDefaults") ?? "{}") as Record<string, unknown>
  }

  it("renders near the episode metadata source, defaults OFF and persists both states", async () => {
    renderWithCtx(<PrefsPanel active />)
    await settle()

    const toggle = screen.getByRole("switch", { name: t("ui.episodeThumbnails") })
    // No stored flag: the feature stays OFF and the hint is visible.
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText(t("ui.episodeThumbnailsHint"))).toBeInTheDocument()
    expect(storedPayload().episodeThumbnails).toBe(false)

    // ON: immediate local write + debounced PUT carry the explicit true.
    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(storedPayload().episodeThumbnails).toBe(true)
    await settle()
    expect(putBodies.some((b) => b.episodeThumbnails === true)).toBe(true)

    // Back OFF: the explicit false must travel too (PUT merges, omitting the
    // key would leave the stored true active after reload).
    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(storedPayload().episodeThumbnails).toBe(false)
    await settle()
    expect(putBodies.some((b) => b.episodeThumbnails === false)).toBe(true)
  })

  it("hydrates the flat server key and keeps OFF when the flag is absent", async () => {
    const { result: absent } = renderHook(() => useDefaults())
    await settle()
    expect(absent.current.defaultEpisodeThumbnails).toBe(false)

    storage.setItem("badgeDefaults", JSON.stringify({ episodeThumbnails: true }))
    const { result: flat } = renderHook(() => useDefaults())
    await settle()
    expect(flat.current.defaultEpisodeThumbnails).toBe(true)

    storage.setItem("badgeDefaults", JSON.stringify({ defaultEpisodeThumbnails: true }))
    const { result: prefixed } = renderHook(() => useDefaults())
    await settle()
    expect(prefixed.current.defaultEpisodeThumbnails).toBe(true)
  })
})
