/**
 * Miniature (episode thumbnail) 24h rotation — GLOBAL toggle.
 *
 * The server contract (`thumbnailRotation` flat flag) already exists: `/meta`
 * emits `rotate=1` only when the effective value is ON. This suite covers the
 * selector side: the toggle lives in the rotation prefs card next to the
 * portrait/landscape rotations, defaults OFF, and persists both states through
 * the shared defaults payload (localStorage + debounced PUT).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { PrefsPanel } from "@/components/settings/PrefsPanel"
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

describe("thumbnail rotation global toggle", () => {
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

  it("renders in the rotation card, defaults OFF and persists both states", async () => {
    renderWithCtx(<PrefsPanel active />)
    await settle()

    // Same on/off pattern as the portrait/landscape rotations.
    expect(screen.getByRole("switch", { name: t("ui.autoRotateDefaultPortrait") })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: t("ui.autoRotateDefaultLandscape") })).toBeInTheDocument()
    const toggle = screen.getByRole("switch", { name: t("ui.autoRotateDefaultThumbnails") })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(storedPayload().thumbnailRotation).toBe(false)

    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(storedPayload().thumbnailRotation).toBe(true)
    await settle()
    expect(putBodies.some((b) => b.thumbnailRotation === true)).toBe(true)

    // Explicit false must travel too: PUT merges, so omitting the key would
    // leave the stored true active after reload.
    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(storedPayload().thumbnailRotation).toBe(false)
    await settle()
    expect(putBodies.some((b) => b.thumbnailRotation === false)).toBe(true)
  })
})
