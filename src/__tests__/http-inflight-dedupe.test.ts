import { afterEach, describe, expect, it, vi } from "vitest"
import { http, userFetch } from "@/lib/http"

/**
 * M1: module-level inflight GET dedupe in http.ts. Concurrent identical
 * scoped GETs share one network round-trip; sequential calls always
 * re-fetch; non-GETs never dedupe.
 */
describe("inflight GET dedupe", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("concurrent identical http() GETs share one fetch with isolated copies", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [a, b] = await Promise.all([
      http<{ ok: boolean; n: number }>("/api/defaults?dedupe=1", { retries: 0 }),
      http<{ ok: boolean; n: number }>("/api/defaults?dedupe=1", { retries: 0 }),
    ])
    expect(a).toEqual({ ok: true, n: 1 })
    expect(b).toEqual({ ok: true, n: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Isolated copies: mutating one joiner's value never leaks into the other.
    a.n = 999
    expect(b.n).toBe(1)
  })

  it("sequential http() GETs re-fetch (no stale sharing)", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await http("/api/defaults?dedupe=2", { retries: 0 })
    await http("/api/defaults?dedupe=2", { retries: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("different paths never share", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([
      http("/api/defaults?dedupe=a", { retries: 0 }),
      http("/api/defaults?dedupe=b", { retries: 0 }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("POSTs never dedupe", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([
      http("/api/defaults", { method: "POST", retries: 0 }),
      http("/api/defaults", { method: "POST", retries: 0 }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("concurrent identical userFetch() GETs share one fetch with independent bodies", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const [ra, rb] = await Promise.all([
      userFetch("/api/defaults?dedupe=user"),
      userFetch("/api/defaults?dedupe=user"),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(ra.json()).resolves.toEqual({ ok: true })
    await expect(rb.json()).resolves.toEqual({ ok: true })
  })
})
