import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isPrivateHost,
  isPrivateIp,
  resetSafeFetchForTests,
  safeFetchRemote,
} from "@/lib/safe-remote-fetch"

// Redirect controllati: il trasporto sicuro usa undici dynamic import + DNS
// pin. Qui il DNS è pubblico finto e la fetch è stub, così il test prova il
// loop di redirect reale (hop-0 + cancellazione body + famiglia host).
vi.mock("undici", () => ({
  Agent: class MockUndiciAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}))

vi.mock("node:dns", () => ({
  default: {
    promises: {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    },
  },
  promises: {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  },
}))

import { fetch as undiciFetch } from "undici"
import { fetchPinnedProviderUrl } from "@/lib/custom-catalog-providers"

const mockUndiciFetch = vi.mocked(undiciFetch as unknown as typeof fetch)

describe("public IP classification gaps", () => {
  it("blocks multicast/reserved/IETF literals that were previously open", () => {
    for (const ip of [
      "224.0.0.1", // 224.0.0.0/4 multicast
      "239.255.255.255",
      "240.0.0.1", // 240.0.0.0/4 reserved
      "255.255.255.255", // broadcast
      "192.0.0.1", // 192.0.0.0/24 IETF protocol assignments
      "192.88.99.1", // 192.88.99.0/24 6to4 relay anycast
      "0.1.2.3", // 0.0.0.0/8 this network
      "ff02::1", // IPv6 multicast ff00::/8
    ]) {
      expect(isPrivateIp(ip)).toBe(true)
    }
  })

  it("keeps public literals public", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "223.255.255.255", "192.0.1.1"]) {
      expect(isPrivateIp(ip)).toBe(false)
    }
    // Un nome DNS non è un letterale: mai bloccato dal testo.
    expect(isPrivateHost("224.example.com")).toBe(false)
  })
})

describe("safeFetchRemote hop-0 private target", () => {
  beforeEach(() => {
    resetSafeFetchForTests()
    mockUndiciFetch.mockReset()
  })

  it("rejects literal loopback/private targets even when the caller forgot its pre-check", async () => {
    const signal = AbortSignal.timeout(5_000)
    for (const url of [
      "http://127.0.0.1/secret",
      "http://localhost:3000/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
    ]) {
      await expect(safeFetchRemote(url, { signal })).rejects.toMatchObject({ reason: "private-target" })
    }
    // Nessun trasporto è stato nemmeno inizializzato per quei target.
    expect(mockUndiciFetch).not.toHaveBeenCalled()
  })

  it("cancels redirect response bodies instead of leaking a socket per hop", async () => {
    let cancelled = false
    const redirectBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    mockUndiciFetch
      .mockResolvedValueOnce(
        new Response(redirectBody, { status: 302, headers: { location: "https://example.com/next" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))

    const res = await safeFetchRemote("https://example.com/start", { signal: AbortSignal.timeout(5_000) })
    expect(res.status).toBe(200)
    expect(cancelled).toBe(true)
    expect(mockUndiciFetch).toHaveBeenCalledTimes(2)
  })
})

describe("fetchPinnedProviderUrl (provider redirect pinning)", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("refuses a redirect to a private literal (SSRF via provider redirect)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })) as unknown as typeof fetch
    await expect(fetchPinnedProviderUrl("https://api.example.com/x", {}, "api.example.com")).rejects.toThrow(
      /Blocked provider host/,
    )
  })

  it("refuses a redirect outside the pinned host family", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example.net/x" } })) as unknown as typeof fetch
    await expect(fetchPinnedProviderUrl("https://api.example.com/x", {}, "api.example.com")).rejects.toThrow(
      /Blocked provider host/,
    )
  })

  it("follows a same-family redirect and returns the final response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://sub.api.example.com/y" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await fetchPinnedProviderUrl("https://api.example.com/x", { method: "GET" }, "api.example.com")
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://sub.api.example.com/y")
  })
})
