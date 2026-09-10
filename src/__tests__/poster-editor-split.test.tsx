/**
 * Split corrente/default (freeze per-titolo): i setter dell'editor scrivono
 * SOLO il valore corrente del poster aperto, i setter delle Impostazioni SOLO
 * il default globale. Prima dello split ogni setter scriveva entrambi i
 * livelli, così spegnere "Genere" su un poster lo spegneva per tutti
 * (auto-persist su localStorage + PUT /api/defaults).
 *
 * Copre anche saveDefaults(): salvare le Impostazioni non deve riscrivere il
 * poster aperto.
 */
import type { ReactNode } from "react"
import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { saveDefaults } from "@/lib/save-defaults"

function wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

describe("poster editor current/default split", () => {
  let putBodies: unknown[]

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    })
    putBodies = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") putBodies.push(JSON.parse(init.body as string))
        return { ok: true, json: async () => ({}) }
      })
    )
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("editor setters write current only, never the default", () => {
    const { result } = renderHook(() => usePosterEditor(), { wrapper })
    expect(result.current.badgeGenre).toBe(true)
    expect(result.current.defaultBadgeGenre).toBe(true)

    act(() => {
      result.current.setBadgeGenre(false)
    })
    expect(result.current.badgeGenre).toBe(false)
    expect(result.current.defaultBadgeGenre).toBe(true)

    act(() => {
      result.current.setGlobalBadges(false)
      result.current.setBadgeQuality(false)
      result.current.setBadgeStyle("pill")
      result.current.setBlurIntensity(9)
      result.current.setNetworkLogo(false)
      result.current.setRibbonSide("right")
    })
    expect(result.current.globalBadges).toBe(false)
    expect(result.current.defaultGlobalBadges).toBe(true)
    expect(result.current.badgeQuality).toBe(false)
    expect(result.current.defaultBadgeQuality).toBe(true)
    expect(result.current.badgeStyle).toBe("pill")
    expect(result.current.defaultBadgeStyle).toBe("shadow")
    expect(result.current.blurIntensity).toBe(9)
    expect(result.current.defaultBlurIntensity).toBe(5)
    expect(result.current.networkLogo).toBe(false)
    expect(result.current.defaultNetworkLogo).toBe(true)
    expect(result.current.ribbonSide).toBe("right")
    expect(result.current.defaultRibbonSide).toBe("left")
  })

  it("settings setters write the default only, never the open poster", () => {
    const { result } = renderHook(() => usePosterEditor(), { wrapper })

    act(() => {
      result.current.setDefaultBadgeGenre(false)
    })
    expect(result.current.defaultBadgeGenre).toBe(false)
    expect(result.current.badgeGenre).toBe(true)

    act(() => {
      result.current.setDefaultGlobalBadges(false)
      result.current.setDefaultBadgeStyle("pill")
      result.current.setDefaultBlurIntensity(9)
    })
    expect(result.current.defaultGlobalBadges).toBe(false)
    expect(result.current.globalBadges).toBe(true)
    expect(result.current.defaultBadgeStyle).toBe("pill")
    expect(result.current.badgeStyle).toBe("shadow")
    expect(result.current.defaultBlurIntensity).toBe(9)
    expect(result.current.blurIntensity).toBe(5)
  })

  it("saveDefaults persists defaults without touching the open poster", async () => {
    const { result } = renderHook(() => usePosterEditor(), { wrapper })
    // Flush del fetch di mount (GET /api/defaults) prima di agire.
    await act(async () => {})
    act(() => {
      result.current.setBadgeGenre(false)
    })
    expect(result.current.badgeGenre).toBe(false)

    let synced = false
    await act(async () => {
      synced = await saveDefaults(result.current)
    })
    expect(synced).toBe(true)
    // Il poster aperto resta com'è; il default salvato resta true.
    expect(result.current.badgeGenre).toBe(false)
    expect(result.current.defaultBadgeGenre).toBe(true)
    expect(putBodies).toHaveLength(1)
    expect((putBodies[0] as { badgeGenre: boolean }).badgeGenre).toBe(true)
  })
})
