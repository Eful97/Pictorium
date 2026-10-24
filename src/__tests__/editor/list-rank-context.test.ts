// Ephemeral list-rank context: navigation carry-through, clearing and
// save-payload isolation (never frozen into mappings/defaults/tokens).
import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useNavigation } from "@/lib/useNavigation"
import { toSearchResult } from "@/lib/types"
import { mappingUpdateSchema } from "@/lib/validation"

describe("ephemeral list-rank context", () => {
  it("navigateToPoster sets rank+region; second title without context clears (no leak)", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(
        toSearchResult({ id: 9001, media_type: "tv", title: "Lupin", poster_path: "/p.jpg", listRank: 1, listRegion: "IT" }),
        "cataloghi",
        "Netflix Italia",
        null,
      )
    })
    expect(result.current.listRank).toBe(1)
    expect(result.current.listRegion).toBe("IT")

    act(() => {
      result.current.navigateToPoster(
        toSearchResult({ id: 55, media_type: "movie", title: "Other", poster_path: "/o.jpg" }),
        "search",
        null,
        null,
      )
    })
    expect(result.current.listRank).toBeNull()
    expect(result.current.listRegion).toBeNull()
  })

  it("goHome clears the context", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(
        toSearchResult({ id: 9001, media_type: "tv", title: "Lupin", poster_path: "/p.jpg", listRank: 12, listRegion: "US" }),
        "cataloghi",
        "Top 10",
        null,
      )
    })
    expect(result.current.listRank).toBe(12)
    act(() => {
      result.current.goHome()
    })
    expect(result.current.listRank).toBeNull()
    expect(result.current.listRegion).toBeNull()
  })

  it("invalid rank/region collapse to absent (no poisoned fetch skip)", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(
        toSearchResult({ id: 1, media_type: "movie", title: "X", poster_path: null, listRank: 101, listRegion: "  " }),
        "cataloghi",
        "Top 10",
        null,
      )
    })
    expect(result.current.listRank).toBeNull()
    expect(result.current.listRegion).toBeNull()
  })

  it("save payloads never persist the ephemeral fields", () => {
    const parsed = mappingUpdateSchema.safeParse({
      title: "Lupin",
      listRank: 1,
      listRegion: "IT",
    } as unknown as Record<string, unknown>)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).listRank).toBeUndefined()
      expect((parsed.data as Record<string, unknown>).listRegion).toBeUndefined()
    }
  })
})
