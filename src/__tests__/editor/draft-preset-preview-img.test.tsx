/**
 * Task D correction1 — DraftPresetPreviewImg lifecycle evidence (real
 * component, userFetch boundary mocked):
 * - debounced server render (no fetch per slider tick);
 * - stale-response suppression when the draft changes mid-flight;
 * - a single fetch for rapid payload bursts (latest payload wins);
 * - Blob URL lifecycle (show on success, revoke on replace + unmount);
 * - pending/loading and failure placeholders (never a stale thumb);
 * - in-flight requests aborted on cleanup via the userFetch signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { DraftPresetPreviewImg } from "@/components/DraftPresetPreviewImg"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({
  userFetch: vi.fn(),
}))

const house = (extra: Record<string, unknown> = {}) => ({
  style: "pill",
  scale: 100,
  polarity: "auto" as const,
  ...extra,
})

function svgResponse(): Response {
  return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
    status: 200,
    headers: { "Content-Type": "image/svg+xml" },
  })
}

let blobCounter = 0

beforeEach(() => {
  vi.useFakeTimers()
  blobCounter = 0
  vi.mocked(userFetch).mockReset()
  vi.mocked(userFetch).mockResolvedValue(svgResponse())
  if (
    typeof (URL as unknown as { createObjectURL?: unknown }).createObjectURL !== "function"
  ) {
    ;(URL as unknown as Record<string, unknown>).createObjectURL = () => `blob:mock-${++blobCounter}`
  } else {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mock-${++blobCounter}`)
  }
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

function lastBody(): unknown {
  const init = vi.mocked(userFetch).mock.calls.at(-1)?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

describe("DraftPresetPreviewImg", () => {
  it("debounces the server render and posts the unsaved draft envelope", async () => {
    render(<DraftPresetPreviewImg target="network" house={house()} name="Net" className="thumb" />)
    expect(userFetch).not.toHaveBeenCalled()
    // Slider ticks inside the debounce window fire no request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(userFetch).not.toHaveBeenCalled()
    await settleDebounce()
    expect(userFetch).toHaveBeenCalledTimes(1)
    const [url] = vi.mocked(userFetch).mock.calls[0]
    expect(url).toBe("/api/presets/draft-preview")
    expect(lastBody()).toEqual({
      preset: { variant: "house", target: "network", house: house() },
    })
  })

  it("shows a loading placeholder until the debounced render resolves", async () => {
    render(<DraftPresetPreviewImg target="network" house={house()} name="Net" />)
    expect(document.querySelector("[data-preview-loading]")).not.toBeNull()
    await settleDebounce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" })).toHaveAttribute("src", "blob:mock-1")
  })

  it("shows an explicit failure placeholder instead of a stale thumbnail", async () => {
    vi.mocked(userFetch).mockResolvedValueOnce(new Response("denied", { status: 401 }))
    render(
      <DraftPresetPreviewImg
        target="network"
        house={house()}
        name="Net"
        fallbackLabel="No preview"
      />,
    )
    await settleDebounce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const fallback = screen.getByRole("img", { name: "Net" })
    expect(fallback.tagName).toBe("DIV")
    expect(fallback).toHaveAttribute("data-preview-fallback", "1")
    expect(fallback).toHaveTextContent("No preview")
  })

  it("suppresses stale responses when the draft changes mid-flight", async () => {
    let resolveFirst: ((r: Response) => void) | null = null
    let resolveSecond: ((r: Response) => void) | null = null
    vi.mocked(userFetch)
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveFirst = r }))
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveSecond = r }))
    const { rerender } = render(
      <DraftPresetPreviewImg target="network" house={house({ scale: 100 })} name="Net" />,
    )
    await settleDebounce()
    expect(userFetch).toHaveBeenCalledTimes(1)
    // Unsaved edit while the first render is still in flight.
    rerender(<DraftPresetPreviewImg target="network" house={house({ scale: 150 })} name="Net" />)
    await settleDebounce()
    expect(userFetch).toHaveBeenCalledTimes(2)
    // The latest payload wins the second request.
    expect(lastBody()).toEqual({
      preset: { variant: "house", target: "network", house: house({ scale: 150 }) },
    })
    await act(async () => {
      resolveSecond?.(svgResponse())
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" }).getAttribute("src")).toBe("blob:mock-1")
    // The stale first response arrives late and must not replace the current thumb.
    await act(async () => {
      resolveFirst?.(svgResponse())
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" }).getAttribute("src")).toBe("blob:mock-1")
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1)
  })

  it("coalesces rapid payload bursts into a single request with the latest draft", async () => {
    const { rerender } = render(
      <DraftPresetPreviewImg target="network" house={house({ scale: 100 })} name="Net" />,
    )
    rerender(<DraftPresetPreviewImg target="network" house={house({ scale: 120 })} name="Net" />)
    rerender(<DraftPresetPreviewImg target="network" house={house({ scale: 150 })} name="Net" />)
    await settleDebounce()
    expect(userFetch).toHaveBeenCalledTimes(1)
    expect(lastBody()).toEqual({
      preset: { variant: "house", target: "network", house: house({ scale: 150 }) },
    })
  })

  it("revokes the previous Blob URL when an unsaved edit re-renders", async () => {
    vi.mocked(userFetch).mockImplementation(async () => svgResponse())
    const { rerender } = render(
      <DraftPresetPreviewImg target="network" house={house({ scale: 100 })} name="Net" />,
    )
    await settleDebounce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" }).getAttribute("src")).toBe("blob:mock-1")
    rerender(<DraftPresetPreviewImg target="network" house={house({ scale: 150 })} name="Net" />)
    await settleDebounce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" }).getAttribute("src")).toBe("blob:mock-2")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1")
  })

  it("revokes the Blob URL on unmount", async () => {
    const { unmount } = render(
      <DraftPresetPreviewImg target="network" house={house()} name="Net" />,
    )
    await settleDebounce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("img", { name: "Net" }).getAttribute("src")).toBe("blob:mock-1")
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1")
  })

  it("aborts the in-flight render on cleanup via the userFetch signal", async () => {
    let capturedSignal: AbortSignal | null = null
    vi.mocked(userFetch).mockImplementation(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>(() => {
          capturedSignal = (init?.signal as AbortSignal | null) ?? null
        }),
    )
    const { unmount } = render(
      <DraftPresetPreviewImg target="network" house={house()} name="Net" />,
    )
    await settleDebounce()
    expect(capturedSignal).not.toBeNull()
    expect(capturedSignal!.aborted).toBe(false)
    unmount()
    expect(capturedSignal!.aborted).toBe(true)
  })

  it("aborts the superseded render when a newer edit takes over", async () => {
    const signals: AbortSignal[] = []
    vi.mocked(userFetch).mockImplementation(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>(() => {
          if (init?.signal) signals.push(init.signal as AbortSignal)
        }),
    )
    const { rerender } = render(
      <DraftPresetPreviewImg target="network" house={house({ scale: 100 })} name="Net" />,
    )
    await settleDebounce()
    expect(signals).toHaveLength(1)
    rerender(<DraftPresetPreviewImg target="network" house={house({ scale: 150 })} name="Net" />)
    // The payload switch aborts the in-flight first render immediately.
    expect(signals[0].aborted).toBe(true)
    await settleDebounce()
    expect(signals).toHaveLength(2)
    expect(signals[1].aborted).toBe(false)
  })
})
