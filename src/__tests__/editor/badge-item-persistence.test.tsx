/**
 * Per-item corrections persistence (defaults + live scope).
 *
 * Contract:
 * - configured corrections are written into the persisted payload (localStorage
 *   and PUT share `defaultsToPayload`);
 * - clearing them removes the key (automatic layout, historic payload);
 * - the live per-title scope canonicalizes on write (one stored form).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDefaults, readStoredDefaultBadgeItemTransforms } from "@/lib/useDefaults"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { renderWithCtx } from "@/__tests__/test-utils"
import { createElement } from "react"

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

describe("per-item corrections persistence", () => {
  let putBodies: Record<string, unknown>[]
  let storage: StorageStub

  beforeEach(() => {
    resetGuestGuardForTests()
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: true, json: async () => ({}) }
        }
        return { ok: true, json: async () => ({}) }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("writes configured corrections into the payload and drops them when cleared", async () => {
    const { result } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    act(() => {
      result.current.update({ defaultBadgeItemTransforms: "rating:imdb=120,4,0" })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    const stored = JSON.parse(storage.getItem("badgeDefaults") ?? "{}") as Record<string, unknown>
    expect(stored.badgeItemTransforms).toBe("rating:imdb=120,4,0")
    // The PUT carries the same value (single serializer).
    expect(putBodies.some((b) => b.badgeItemTransforms === "rating:imdb=120,4,0")).toBe(true)

    act(() => {
      result.current.update({ defaultBadgeItemTransforms: null })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    const cleared = JSON.parse(storage.getItem("badgeDefaults") ?? "{}") as Record<string, unknown>
    // Explicit null, never an omitted key: PUT /api/defaults merges over the
    // stored defaults, so a missing key would keep the old server-side offsets
    // (the rejoined badge would still appear nudged in the Test URL).
    expect(cleared.badgeItemTransforms).toBeNull()
    // Same wire form, so the merge really clears the stored map.
    expect(putBodies.some((b) => b.badgeItemTransforms === null)).toBe(true)
  })

  it("reads the committed default bit for the title-open hydration fallback", () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ badgeItemTransforms: " quality:tier=100,20,196 ; junk " }),
    )
    expect(readStoredDefaultBadgeItemTransforms()).toBe("quality:tier=100,20,196")
    storage.setItem("badgeDefaults", JSON.stringify({ badgeItemTransforms: null }))
    expect(readStoredDefaultBadgeItemTransforms()).toBeNull()
  })

  it("canonicalizes the live per-title scope on write", async () => {
    let ed: ReturnType<typeof usePosterEditor> | null = null
    function Probe() {
      ed = usePosterEditor()
      return null
    }
    renderWithCtx(createElement(Probe))
    await act(async () => {})
    await act(async () => {
      ed!.setBadgeItemTransforms(" rating:tmdb=110,2,0 ; rating:imdb=120,4,-3 ; junk ")
    })
    expect(ed!.badgeItemTransforms).toBe("rating:imdb=120,4,-3;rating:tmdb=110,2,0")
    await act(async () => {
      ed!.setBadgeItemTransforms("rating:imdb=100,0,0")
    })
    expect(ed!.badgeItemTransforms).toBeNull()
  })
})
