import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// Alias `/api/proxy/manifest.json`: Stremio rifiuta transport URL che non
// terminano con `/manifest.json` ("protocol violation"). Delega alla stessa
// logica del proxy, senza duplicazione.

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("undici", () => ({
  Agent: class MockAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: (...args: Parameters<typeof fetch>) => (globalThis.fetch as typeof fetch)(...args),
}))

vi.mock("node:dns", () => ({
  default: {
    promises: {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    },
  },
}))

const { GET } = await import("@/app/api/proxy/manifest.json/route")

describe("proxy manifest.json alias", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")

  beforeEach(() => {
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "up.id", name: "Up", description: "d" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
  })

  afterEach(() => {
    fetchSpy.mockReset()
  })

  it("risponde 200 con manifest riscritto come il branch manifest", async () => {
    const target = encodeURIComponent("https://addon.example.com/manifest.json")
    const req = new NextRequest(`http://localhost:3000/api/proxy/manifest.json?target=${target}`)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id.startsWith("org.pictorium.proxy.")).toBe(true)
    expect(body.name).toContain("(Pictorium)")
  })
})
