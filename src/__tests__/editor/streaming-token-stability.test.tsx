/**
 * Regression: context.tsx token-hook callsite must pass the stable
 * `streamingSelections` state reference (never a per-render copy), or the
 * `useLocalConfigToken` effect re-runs every render (pending/ready
 * oscillation, never-settling act, remint storm).
 *
 * Two layers: hook-consumer tests pin the effect/input contract (stable ref
 * = one mint; real edit = remint; undefined omits the key, [] carries it);
 * the PictoriumRoot tests guard the real callsite line itself (they render
 * the actual root, so reintroducing a per-render copy makes them time out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, renderHook, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guest-guard")>()
  return {
    ...actual,
    isProfilelessOnMultiUser: vi.fn().mockResolvedValue(true),
  }
})
vi.mock("@/lib/mint-config-token", () => ({
  mintConfigToken: vi.fn(async (payload: Record<string, unknown>) => `tok-${JSON.stringify(payload)}`),
}))

import { mintConfigToken } from "@/lib/mint-config-token"
import { useLocalConfigToken } from "@/lib/useLocalConfigToken"
import type { StreamingSelection } from "@/lib/streaming-catalogs"

const mockedMint = vi.mocked(mintConfigToken)

// Stable module-level inputs: fresh literals here would change identity every
// render and mask the regression under test (same as in context.tsx, where
// customCatalogs comes from hook state).
const CUSTOMS: never[] = []

const SEL: StreamingSelection[] = [{ service: "netflix", country: "IT", sections: ["movies"] }]
const SEL_EDITED: StreamingSelection[] = [
  { service: "netflix", country: "IT", sections: ["movies"] },
  { service: "prime", country: "IT", sections: ["series"] },
]

/**
 * Replicates the context.tsx token-hook callsite verbatim: the state array
 * reference must travel unchanged (absent key when undefined) so the hook
 * effect only re-runs on real edits. A per-render copy here would re-mint on
 * every render (pending/ready oscillation, never-settling act).
 */
function useCallsite(sel: StreamingSelection[] | undefined) {
  return useLocalConfigToken({
    customCatalogs: CUSTOMS,
    rankingSourceMovie: "",
    rankingSourceSeries: "",
    ...(sel !== undefined ? { streamingSelections: sel } : {}),
  })
}

function payloadOf(callIndex: number): Record<string, unknown> {
  return mockedMint.mock.calls[callIndex][0] as Record<string, unknown>
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

describe("streaming token input identity (context callsite)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("explicit [] settles once and survives rerenders without reminting", async () => {
    const EMPTY: StreamingSelection[] = []
    const { result, rerender } = renderHook(({ sel }) => useCallsite(sel), {
      initialProps: { sel: EMPTY as StreamingSelection[] | undefined },
    })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(mockedMint).toHaveBeenCalledTimes(1)
    expect(payloadOf(0)).toEqual({
      customCatalogs: CUSTOMS,
      rankingSourceMovie: "",
      rankingSourceSeries: "",
      streamingSelections: [],
    })
    const token = result.current.token

    rerender({ sel: EMPTY })
    rerender({ sel: EMPTY })
    rerender({ sel: EMPTY })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(mockedMint).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({ token, status: "ready" })
  })

  it("configured selections stay stable across rerenders (no extra mint)", async () => {
    const { result, rerender } = renderHook(({ sel }) => useCallsite(sel), {
      initialProps: { sel: SEL as StreamingSelection[] | undefined },
    })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(mockedMint).toHaveBeenCalledTimes(1)
    const token = result.current.token

    rerender({ sel: SEL })
    rerender({ sel: SEL })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(mockedMint).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({ token, status: "ready" })
  })

  it("a real edit remints with the new payload", async () => {
    const { result, rerender } = renderHook(({ sel }) => useCallsite(sel), {
      initialProps: { sel: SEL as StreamingSelection[] | undefined },
    })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    const firstToken = result.current.token

    rerender({ sel: SEL_EDITED })
    await waitFor(() => expect(mockedMint).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.status).toBe("ready"))

    expect(payloadOf(1).streamingSelections).toEqual(SEL_EDITED)
    expect(result.current.token).not.toBe(firstToken)
  })

  it("absent (undefined) omits the key; defined carries it; transitions remint", async () => {
    const { result, rerender } = renderHook(({ sel }) => useCallsite(sel), {
      initialProps: { sel: undefined as StreamingSelection[] | undefined },
    })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(mockedMint).toHaveBeenCalledTimes(1)
    expect("streamingSelections" in payloadOf(0)).toBe(false)

    // undefined -> explicit [] : absent-vs-explicit boundary (cleared device
    // wins over the namespace fill), so this must remint.
    rerender({ sel: [] })
    await waitFor(() => expect(mockedMint).toHaveBeenCalledTimes(2))
    expect(payloadOf(1).streamingSelections).toEqual([])

    // [] -> populated: real edit, remints again with content.
    rerender({ sel: SEL })
    await waitFor(() => expect(mockedMint).toHaveBeenCalledTimes(3))
    expect(payloadOf(2).streamingSelections).toEqual(SEL)
    await waitFor(() => expect(result.current.status).toBe("ready"))
  })
})

describe("root token stability (PictoriumRoot, real callsite)", () => {
  let ctx: PictoriumCtx | null = null

  function Probe() {
    const v = useP()
    useEffect(() => {
      ctx = v
    })
    return null
  }

  beforeEach(() => {
    ctx = null
    vi.clearAllMocks()
    localStorage.clear()
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => okJson({})) as unknown as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("explicit [] settles (no pending/off oscillation) and unrelated rerenders mint nothing", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.setStreamingSelections([])
    })
    await flush()
    // Settles instead of oscillating pending -> off/ready forever.
    await vi.waitFor(() => expect(ctx!.localConfigTokenStatus).not.toBe("pending"))
    const settled = ctx!.localConfigToken
    const calls = mockedMint.mock.calls.length
    expect(calls).toBeGreaterThan(0)

    // Unrelated root rerenders must not remint: the callsite passes the
    // stable state reference, so the hook effect sees no input change.
    await act(async () => {
      ctx!.setSettingsOpen(true)
    })
    await act(async () => {
      ctx!.setSettingsOpen(false)
    })
    await flush()
    expect(mockedMint.mock.calls.length).toBe(calls)
    expect(ctx!.localConfigTokenStatus).not.toBe("pending")
    expect(ctx!.localConfigToken).toBe(settled)
  })

  it("a real selection change from the root remints once with the new payload", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.setStreamingSelections([])
    })
    await flush()
    await vi.waitFor(() => expect(ctx!.localConfigTokenStatus).not.toBe("pending"))
    const callsBefore = mockedMint.mock.calls.length
    const tokenBefore = ctx!.localConfigToken

    await act(async () => {
      ctx!.setStreamingSelections([...SEL])
    })
    await vi.waitFor(() => expect(mockedMint.mock.calls.length).toBe(callsBefore + 1))
    // The root sanitizes through the backend leaf: canonical form carries
    // enabled:true (absent in the raw edit) with content otherwise intact.
    expect(payloadOf(callsBefore).streamingSelections).toEqual([
      { service: "netflix", country: "IT", sections: ["movies"], enabled: true },
    ])
    await vi.waitFor(() => expect(ctx!.localConfigTokenStatus).not.toBe("pending"))
    expect(ctx!.localConfigToken).not.toBe(tokenBefore)
  })
})
