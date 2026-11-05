/**
 * Fresh client defaults are IMDb-only (uniform IMDb default).
 *
 * The authoritative default carrier is `useDefaults`: its factory state feeds
 * the preview URL builder, so a clean install must emit `rsrc=imdb` (never the
 * legacy blended `rsrc=imdb,tmdb`). An explicit stored selection stays intact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

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

async function mountDefaults() {
  const { result } = renderHook(() => useDefaults())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200)
  })
  return result
}

function rsrcOf(state: Parameters<typeof buildDefaultsPreviewUrl>[0]): string | null {
  return new URL(buildDefaultsPreviewUrl({ ...state, lang: "it" }), "http://localhost").searchParams.get("rsrc")
}

describe("fresh defaults rating sources", () => {
  let storage: StorageStub

  beforeEach(() => {
    resetGuestGuardForTests()
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("no stored override: IMDb-only state and rsrc=imdb in the preview URL", async () => {
    const result = await mountDefaults()

    expect(result.current.defaultRatingSources).toEqual(["imdb"])
    expect(result.current.ratingSources).toEqual(["imdb"])
    // Acceptance: the preview URL must never carry the legacy blend.
    expect(rsrcOf(result.current)).toBe("imdb")
  })

  it("an explicit stored selection is preserved verbatim", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultRatingSources: ["imdb", "tmdb"],
        ratingSources: ["imdb", "tmdb"],
      }),
    )
    const result = await mountDefaults()

    expect(result.current.defaultRatingSources).toEqual(["imdb", "tmdb"])
    expect(result.current.ratingSources).toEqual(["imdb", "tmdb"])
    expect(rsrcOf(result.current)).toBe("imdb,tmdb")
  })
})
