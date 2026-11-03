import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Transport-level retry composition (undici RetryAgent) behind the existing
 * DNS-pinned safe fetch. The mock only observes construction/plumbing: the
 * real retry policy (Retry-After parsing, backoff, abort) lives in undici and
 * is not re-implemented here.
 */

type AgentOptions = { connect?: { lookup?: unknown } }
type RetryOptions = { retryAfter?: unknown; methods?: unknown }

const captured: {
  agentOptions: AgentOptions[]
  agentInstances: unknown[]
  retryConstructors: { agent: unknown; options: RetryOptions }[]
  retryInstances: unknown[]
  dispatchers: unknown[]
} = {
  agentOptions: [],
  agentInstances: [],
  retryConstructors: [],
  retryInstances: [],
  dispatchers: [],
}

function resetCaptured(): void {
  captured.agentOptions = []
  captured.agentInstances = []
  captured.retryConstructors = []
  captured.retryInstances = []
  captured.dispatchers = []
}

function mockUndici(options: { withRetryAgent: boolean }) {
  class MockAgent {
    constructor(opts?: AgentOptions) {
      captured.agentOptions.push(opts ?? {})
      captured.agentInstances.push(this)
    }
  }
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    captured.dispatchers.push((init as { dispatcher?: unknown } | undefined)?.dispatcher)
    return new Response("ok")
  })
  const mod: Record<string, unknown> = { Agent: MockAgent, fetch: fetchMock }
  if (options.withRetryAgent) {
    mod.RetryAgent = class MockRetryAgent {
      constructor(agent: unknown, retryOptions?: RetryOptions) {
        captured.retryInstances.push(this)
        captured.retryConstructors.push({ agent, options: retryOptions ?? {} })
      }
    }
  }
  return mod
}

beforeEach(() => {
  vi.resetModules()
  resetCaptured()
  vi.spyOn(globalThis, "fetch")
})

afterEach(() => {
  vi.doUnmock("undici")
  vi.restoreAllMocks()
})

describe("safe fetch retry dispatcher", () => {
  it("wraps the pinned SSRF Agent in a RetryAgent with Retry-After and idempotent methods only", async () => {
    vi.doMock("undici", () => mockUndici({ withRetryAgent: true }))
    const { safeFetchRemote } = await import("@/lib/safe-remote-fetch")

    const res = await safeFetchRemote("https://example.com/image.jpg", {
      signal: AbortSignal.timeout(5_000),
    })
    expect(res.status).toBe(200)

    // The pinned Agent (the security boundary) is kept and wrapped, never replaced.
    expect(captured.agentOptions).toHaveLength(1)
    expect(captured.agentOptions[0].connect?.lookup).toBeTypeOf("function")
    expect(captured.retryConstructors).toHaveLength(1)
    expect(captured.retryConstructors[0].agent).toBe(captured.agentInstances[0])

    // Retry-After is honored (undici turns this flag into header-aware backoff).
    expect(captured.retryConstructors[0].options.retryAfter).toBe(true)

    // Idempotent methods only: a retry can never duplicate a POST/PATCH side effect.
    const methods = captured.retryConstructors[0].options.methods as string[]
    expect([...methods].sort()).toEqual(["DELETE", "GET", "HEAD", "OPTIONS", "PUT", "TRACE"])
    expect(methods).not.toContain("POST")
    expect(methods).not.toContain("PATCH")
    expect(methods).not.toContain("CONNECT")

    // The fetch uses the RetryAgent dispatcher, not the bare Agent and not global fetch.
    expect(captured.dispatchers[0]).toBe(captured.retryInstances[0])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("falls back to the pinned Agent when the runtime exposes no RetryAgent", async () => {
    vi.doMock("undici", () => mockUndici({ withRetryAgent: false }))
    const { safeFetchRemote } = await import("@/lib/safe-remote-fetch")

    const res = await safeFetchRemote("https://example.com/image.jpg", {
      signal: AbortSignal.timeout(5_000),
    })
    expect(res.status).toBe(200)

    // No retry wrapper is invented; the DNS-pinned dispatcher still travels.
    expect(captured.agentOptions).toHaveLength(1)
    expect(captured.agentOptions[0].connect?.lookup).toBeTypeOf("function")
    expect(captured.retryConstructors).toHaveLength(0)
    expect(captured.dispatchers[0]).toBe(captured.agentInstances[0])
  })

  it("builds one shared RetryAgent pair across concurrent requests", async () => {
    vi.doMock("undici", () => mockUndici({ withRetryAgent: true }))
    const { safeFetchRemote } = await import("@/lib/safe-remote-fetch")

    const signal = AbortSignal.timeout(5_000)
    await Promise.all([
      safeFetchRemote("https://example.com/one", { signal }),
      safeFetchRemote("https://example.com/two", { signal }),
    ])

    expect(captured.agentOptions).toHaveLength(1)
    expect(captured.retryConstructors).toHaveLength(1)
    expect(captured.dispatchers).toEqual([captured.retryInstances[0], captured.retryInstances[0]])
  })
})
