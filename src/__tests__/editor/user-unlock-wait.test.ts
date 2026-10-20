/**
 * `waitForUserUnlock` (user-token): bounded session-unlock wait for full-load
 * landings (Lab "Use for title" handoff return). Resolves true when already
 * unlocked or on the matching unlock event; false on timeout or without a
 * namespace — never rejects, never outlives `timeoutMs`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  USER_UNLOCK_EVENT,
  __resetUnlockedUsersForTests,
  isUserUnlocked,
  waitForUserUnlock,
} from "@/lib/user-token"

const UUID = "123e4567-e89b-12d3-a456-426614174000"

function dispatchUnlock(uuid: string): void {
  window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
}

beforeEach(() => {
  __resetUnlockedUsersForTests()
  vi.useRealTimers()
})

describe("waitForUserUnlock", () => {
  it("resolves true immediately when already unlocked", async () => {
    dispatchUnlock(UUID)
    expect(isUserUnlocked(UUID)).toBe(true)
    await expect(waitForUserUnlock(UUID, 50)).resolves.toBe(true)
  })

  it("resolves true on the matching unlock event (case-insensitive)", async () => {
    const pending = waitForUserUnlock(UUID, 1000)
    dispatchUnlock(UUID.toUpperCase())
    await expect(pending).resolves.toBe(true)
  })

  it("ignores unlock events for other namespaces and times out", async () => {
    vi.useFakeTimers()
    const pending = waitForUserUnlock(UUID, 100)
    dispatchUnlock("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    const assertion = expect(pending).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(150)
    await assertion
  })

  it("resolves false without a namespace", async () => {
    await expect(waitForUserUnlock(null, 10)).resolves.toBe(false)
    await expect(waitForUserUnlock("", 10)).resolves.toBe(false)
  })
})
