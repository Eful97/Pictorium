import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Registra QUALI chiavi raggiungono l'ammissione (bucket) senza consumare
// token reali: i test verificano l'identità scelta, non il conteggio.
const admissions = vi.hoisted(() => [] as Array<{ key: string; bucket: string }>)

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>()
  return {
    ...actual,
    rateLimit: vi.fn(async (key: string, bucket: string) => {
      admissions.push({ key, bucket })
      return { ok: true, retAfter: 0 }
    }),
  }
})

import { rateLimitKey } from "@/lib/rate-limit"
import * as userAuth from "@/lib/user-auth"
import { pictoriumCatalog } from "@/lib/catalog-handler"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"

// UUID valido ma mai creato: è il caso "rotazione di ?u=".
const UNKNOWN_USER = "8f14e45f-ceea-467a-9c1e-0b7a1f2c3d4e"

function withUserAgent(ua: string): NextRequest {
  return new NextRequest("https://example.com/api/poster/movie/1", {
    headers: { "user-agent": ua },
  })
}

beforeEach(() => {
  admissions.length = 0
  process.env.PICTORIUM_MULTI_USER = "1"
  delete process.env.PICTORIUM_TRUST_PROXY
  delete process.env.POSTERIUM_TRUST_PROXY
})

afterEach(() => {
  delete process.env.PICTORIUM_MULTI_USER
  delete process.env.PICTORIUM_TRUST_PROXY
  delete process.env.POSTERIUM_TRUST_PROXY
  vi.restoreAllMocks()
})

describe("rateLimitKey senza proxy fidato: la rotazione di User-Agent non crea bucket (F2)", () => {
  it("UA diversi collassano sulla stessa chiave anonima d'istanza", () => {
    // Con la env di default (nessun TRUST_PROXY) lo User-Agent è un header
    // client arbitrario: se distinguesse i bucket, ruotarlo a ogni richiesta
    // azzererebbe il rate limit su poster/cataloghi/auth-pin.
    expect(rateLimitKey(withUserAgent("stremio/1.0"))).toBe("local")
    expect(rateLimitKey(withUserAgent("stremio/2.0"))).toBe("local")
    expect(rateLimitKey(withUserAgent("stremio/1.0"))).toBe(rateLimitKey(withUserAgent("stremio/2.0")))
    // Anche senza UA resta la stessa identità.
    expect(rateLimitKey(new NextRequest("https://example.com/api/poster/movie/1"))).toBe("local")
  })

  it("dietro proxy fidato il fallback per-UA resta byte-identico", () => {
    process.env.PICTORIUM_TRUST_PROXY = "1"
    expect(rateLimitKey(withUserAgent("curl/8"))).toBe("ua:curl/8")
  })

  it("dietro proxy fidato gli header IP restano l'identità (nessuna regressione)", () => {
    process.env.PICTORIUM_TRUST_PROXY = "1"
    const req = new NextRequest("https://example.com/api/poster/movie/1", {
      headers: { "x-real-ip": "5.6.7.8", "user-agent": "anything" },
    })
    expect(rateLimitKey(req)).toBe("5.6.7.8")
  })
})

describe("ammissione catalogo: lo spazio inesistente collassa PRIMA del rate-limit (A2)", () => {
  it("?u= UUID mai creato usa la chiave anonima (nessun bucket nuovo)", async () => {
    vi.spyOn(userAuth, "userExists").mockResolvedValue(false)
    const req = new NextRequest(
      `https://example.com/catalog/movie/pictorium-jw-movies.json?u=${UNKNOWN_USER}`,
    )
    // Tipo invalido: 400 subito dopo l'ammissione, nessuna I/O di catalogo.
    const res = await pictoriumCatalog(req, "bogus", "pictorium-jw-movies", UNKNOWN_USER, null)
    expect(res.status).toBe(400)
    expect(admissions).toEqual([{ key: "local", bucket: "catalog" }])
  })

  it("un utente reale mantiene il bucket isolato IP+UUID (isolamento legittimo)", async () => {
    vi.spyOn(userAuth, "userExists").mockResolvedValue(true)
    const req = new NextRequest(
      `https://example.com/catalog/movie/pictorium-jw-movies.json?u=${UNKNOWN_USER}`,
    )
    const res = await pictoriumCatalog(req, "bogus", "pictorium-jw-movies", UNKNOWN_USER, null)
    expect(res.status).toBe(400)
    expect(admissions).toEqual([{ key: `local|user:${UNKNOWN_USER}`, bucket: "catalog" }])
  })
})

describe("ammissione poster: lo spazio inesistente collassa PRIMA del rate-limit (A2)", () => {
  const params = () => ({ params: Promise.resolve({ type: "movie", id: "not-an-id" }) })

  it("?u= UUID mai creato usa la chiave anonima (nessun bucket nuovo)", async () => {
    vi.spyOn(userAuth, "userExists").mockResolvedValue(false)
    const req = new NextRequest(`https://example.com/api/poster/movie/not-an-id?u=${UNKNOWN_USER}`)
    // ID non risolvibile: 400 subito dopo l'ammissione, nessun render.
    const res = await posterGET(req, params())
    expect(res.status).toBe(400)
    expect(admissions).toEqual([{ key: "local", bucket: "poster" }])
  })

  it("un utente reale mantiene il bucket isolato IP+UUID (isolamento legittimo)", async () => {
    vi.spyOn(userAuth, "userExists").mockResolvedValue(true)
    const req = new NextRequest(`https://example.com/api/poster/movie/not-an-id?u=${UNKNOWN_USER}`)
    const res = await posterGET(req, params())
    expect(res.status).toBe(400)
    expect(admissions).toEqual([{ key: `local|user:${UNKNOWN_USER}`, bucket: "poster" }])
  })
})
