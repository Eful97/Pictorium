import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// Fix M6: i query param della richiesta vengono inoltrati al target del proxy
// (genre/skip/...), ma le chiavi API dell'utente (api_key TMDB, mdblist_key)
// NON devono finire sul server dell'addon proxyato.

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

// La route carica fetch+Agent dallo stesso modulo undici via import dinamico:
// nei test lo sostituiamo con la fetch globale (spiabile) + Agent fittizio,
// così le asserzioni sugli URL inoltrati restano valide.
vi.mock("undici", () => ({
  Agent: class MockAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: (...args: Parameters<typeof fetch>) => (globalThis.fetch as typeof fetch)(...args),
}))

// DNS sempre verso un IP pubblico: il target del test non è reale.
vi.mock("node:dns", () => ({
  default: {
    promises: {
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    },
  },
}))

const { GET } = await import("@/app/api/proxy/[...path]/route")

describe("proxy resource forwarding — strip chiavi API (M6)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")

  beforeEach(() => {
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ metas: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    )
  })

  afterEach(() => {
    fetchSpy.mockReset()
  })

  it("il branch manifest usa la coppia fetch/dispatcher compatibile e riscrive id/nome", async () => {
    // Regressione: l'Agent npm passato alla fetch globale di Node falliva ogni
    // richiesta (`invalid onRequestStart method`) → 500 su tutto il proxy.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "up.id", name: "Up", description: "d" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const target = encodeURIComponent("https://addon.example.com/manifest.json")
    const req = new NextRequest(`http://localhost:3000/api/proxy/manifest?target=${target}`)
    const res = await GET(req, { params: Promise.resolve({ path: ["manifest"] }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id.startsWith("org.pictorium.proxy.")).toBe(true)
    expect(body.name).toContain("(Pictorium)")
  })
  it("non inoltra api_key/mdblist_key/param di controllo al target, ma preserva gli altri", async () => {
    const target = encodeURIComponent("https://addon.example.com/manifest.json")
    const req = new NextRequest(
      `http://localhost:3000/api/proxy/catalog/movie/top.json?target=${target}&api_key=SECRET_TMDB&API_KEY=SECRET_UPPER&mdblist_key=SECRET_MDBLIST&genre=Action&skip=20`,
    )
    const res = await GET(req, { params: Promise.resolve({ path: ["catalog", "movie", "top.json"] }) })
    expect(res.status).toBe(200)

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]))
    const targetCall = calls.find((u) => u.startsWith("https://addon.example.com/catalog"))
    expect(targetCall).toBeDefined()
    const url = new URL(targetCall!)
    // Chiavi e param di controllo strippati (case-insensitive)
    expect(url.searchParams.get("api_key")).toBeNull()
    expect(url.searchParams.get("API_KEY")).toBeNull()
    expect(url.searchParams.get("mdblist_key")).toBeNull()
    expect(url.searchParams.get("target")).toBeNull()
    // I param legittimi restano
    expect(url.searchParams.get("genre")).toBe("Action")
    expect(url.searchParams.get("skip")).toBe("20")
  })
})
