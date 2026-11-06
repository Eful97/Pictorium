/**
 * SPA browser Back/Forward (popstate) must not silently discard the per-title
 * editor draft. useNavigation owns the history handler: while the editor
 * reports a dirty draft it restores the editor entry and asks the editor's
 * confirm dialog (same three-way contract as the in-app exits); a clean draft
 * keeps the historic immediate navigation.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  registerEditorNavigationGuard,
  useNavigation,
  type EditorNavigationGuard,
} from "@/lib/useNavigation"

const ITEM = { id: 7, media_type: "movie" } as never

function pop(state: unknown): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state }))
  })
}

let unregister: (() => void) | null = null

afterEach(() => {
  unregister?.()
  unregister = null
  window.history.replaceState({}, "", "/")
})

describe("useNavigation popstate guard", () => {
  it("dirty back is cancelled: view stays, state intact, editor asked to confirm", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(ITEM, "cataloghi", "Halloween Nights")
    })
    expect(result.current.view).toBe("edit")
    expect(result.current.seasonalTheme).toBe("halloween")

    const requestConfirm = vi.fn<(discard: () => void) => void>()
    unregister = registerEditorNavigationGuard({ isDirty: () => true, requestConfirm })
    pop({ view: "search" })

    // Nessuna transizione applicata e nessun reset del contesto effimero.
    expect(result.current.view).toBe("edit")
    expect(result.current.seasonalTheme).toBe("halloween")
    expect(requestConfirm).toHaveBeenCalledTimes(1)
    expect(typeof requestConfirm.mock.calls[0][0]).toBe("function")
  })

  it("clean back navigates immediately (no false guard)", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(ITEM, "cataloghi", "Halloween Nights")
    })
    const requestConfirm = vi.fn<(discard: () => void) => void>()
    unregister = registerEditorNavigationGuard({ isDirty: () => false, requestConfirm })

    pop({ view: "search" })

    expect(result.current.view).toBe("search")
    expect(result.current.seasonalTheme).toBeNull()
    expect(requestConfirm).not.toHaveBeenCalled()
  })

  it("without a registered guard navigation is unchanged (no global regression)", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(ITEM, "cataloghi", "Halloween Nights")
    })

    pop({ view: "thumbnails" })

    expect(result.current.view).toBe("thumbnails")
    expect(result.current.seasonalTheme).toBeNull()
  })

  it("unregistering restores the unguarded behaviour", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(ITEM, "cataloghi")
    })
    const guard: EditorNavigationGuard = { isDirty: () => true, requestConfirm: vi.fn() }
    const stop = registerEditorNavigationGuard(guard)
    stop()

    pop({ view: "search" })

    expect(result.current.view).toBe("search")
  })
})
