import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetSafeFetchForTests,
  safeFetchRemote,
  SafeFetchUnavailableError,
} from "@/lib/safe-remote-fetch"

vi.mock("undici", () => ({
  get Agent(): never {
    throw new Error("agent init failed")
  },
  fetch: vi.fn(),
}))

beforeEach(() => {
  resetSafeFetchForTests()
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("safe fetch initialization failure", () => {
  it("fails closed instead of falling back to an unpinned fetch", async () => {
    await expect(
      safeFetchRemote("https://example.com/image.jpg", { signal: AbortSignal.timeout(5_000) }),
    ).rejects.toBeInstanceOf(SafeFetchUnavailableError)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
