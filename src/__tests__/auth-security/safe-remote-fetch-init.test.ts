import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetch as undiciFetch } from "undici"
import {
  isPrivateIp,
  resetSafeFetchForTests,
  safeFetchRemote,
} from "@/lib/safe-remote-fetch"

vi.mock("undici", () => ({
  Agent: class MockUndiciAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}))

const mockUndiciFetch = vi.mocked(undiciFetch as unknown as typeof fetch)

beforeEach(() => {
  resetSafeFetchForTests()
  mockUndiciFetch.mockReset()
  mockUndiciFetch.mockImplementation(async () => new Response("ok"))
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("safe fetch initialization", () => {
  it("shares one initialization across concurrent requests and never uses unpinned global fetch", async () => {
    const signal = AbortSignal.timeout(5_000)
    const [first, second] = await Promise.all([
      safeFetchRemote("https://example.com/first", { signal }),
      safeFetchRemote("https://example.com/second", { signal }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mockUndiciFetch).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe("isPrivateIp IPv6 classification", () => {
  it("classifies hexadecimal IPv4-mapped addresses by value", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true) // 127.0.0.1
    expect(isPrivateIp("::ffff:a00:1")).toBe(true) // 10.0.0.1
    expect(isPrivateIp("0:0:0:0:0:ffff:7f00:1")).toBe(true)
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateIp("::ffff:808:808")).toBe(false) // 8.8.8.8
  })

  it("classifies expanded loopback, ULA and link-local addresses", () => {
    expect(isPrivateIp("0:0:0:0:0:0:0:1")).toBe(true)
    expect(isPrivateIp("0:0:0:0:0:0:0:0")).toBe(true)
    expect(isPrivateIp("fd00::1")).toBe(true)
    expect(isPrivateIp("fe80::1")).toBe(true)
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false)
  })
})
