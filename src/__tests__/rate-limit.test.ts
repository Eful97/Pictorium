import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

describe("rateLimitKey con POSTERIUM_TRUST_PROXY=1 (deploy dietro proxy fidato)", () => {
  beforeEach(() => { process.env.POSTERIUM_TRUST_PROXY = "1" })
  afterEach(() => { delete process.env.POSTERIUM_TRUST_PROXY })

  it("prefers x-real-ip over cf-connecting-ip (fix L27: anti-spoofing)", () => {
    // Su deploy non-Cloudflare che impostano solo x-real-ip, cf-connecting-ip
    // è un header client spoofabile: prima aveva la precedenza e il rate
    // limit era bypassabile ruotandolo. Ora vince x-real-ip (scritto
    // dall'edge); Cloudflare non imposta x-real-ip, quindi i suoi client
    // cadono su cf-connecting-ip.
    const req = new NextRequest("http://localhost:3000/", {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "x-forwarded-for": "9.9.9.9, 10.10.10.10",
      },
    })
    expect(rateLimitKey(req)).toBe("5.6.7.8")
  })

  it("falls back to cf-connecting-ip when x-real-ip is absent (Cloudflare)", () => {
    const req = new NextRequest("http://localhost:3000/", {
      headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 10.10.10.10" },
    })
    expect(rateLimitKey(req)).toBe("1.2.3.4")
  })

  it("uses the FIRST hop of x-forwarded-for when the trusted headers are absent", () => {
    // Catena "client, proxy1, proxy2": il client è il primo elemento.
    // Prendere l'ultimo raggruppava tutti gli utenti dietro lo stesso
    // proxy/gateway nello stesso bucket (falsi 429).
    const req = new NextRequest("http://localhost:3000/", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.10.10.10" },
    })
    expect(rateLimitKey(req)).toBe("9.9.9.9")
  })

  it("trims values and defaults to 'local' with no IP headers", () => {
    const req = new NextRequest("http://localhost:3000/", {
      headers: { "x-forwarded-for": "9.9.9.9,   10.10.10.10 " },
    })
    expect(rateLimitKey(req)).toBe("9.9.9.9")
    expect(rateLimitKey(new NextRequest("http://localhost:3000/"))).toBe("local")
  })
})

describe("rateLimitKey senza flag (header IP spoofabili ignorati — v1.23.0)", () => {
  afterEach(() => { delete process.env.POSTERIUM_TRUST_PROXY })

  it("ignora x-real-ip/cf-connecting-ip/XFF senza trust (niente bucket spoofabili)", () => {
    const req = new NextRequest("http://localhost:3000/", {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "x-forwarded-for": "9.9.9.9, 10.10.10.10",
      },
    })
    const key = rateLimitKey(req)
    expect(key).not.toBe("5.6.7.8")
    expect(key).not.toBe("1.2.3.4")
    expect(key).not.toBe("9.9.9.9")
    expect(rateLimitKey(new NextRequest("http://localhost:3000/"))).toBe("local")
  })

  it("il flag con valore non '1' non abilita trust ma resta per-IP", () => {
    process.env.POSTERIUM_TRUST_PROXY = "true"
    const req = new NextRequest("http://localhost:3000/", {
      headers: { "x-real-ip": "5.6.7.8" },
    })
    expect(rateLimitKey(req)).not.toBe("5.6.7.8")
  })
})

// NOTA: il bucket map è module-level e condiviso tra i test del file: ogni
// test usa una chiave client univoca per non interferire con gli altri.
describe("rateLimit (token bucket per (bucket, key))", () => {
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.POSTERIUM_TRUST_PROXY
  })

  it("scarica un bucket e risponde 429 con Retry-After quando è esaurito", async () => {
    const key = "h2-exhaust-1"
    // warmup ha maxTokens=5, refill 1/s → 6 richieste: le prime 5 ok, la 6a no
    for (let i = 0; i < 5; i++) {
      expect(await rateLimit(key, "warmup")).toEqual({ ok: true, retAfter: 0 })
    }
    const denied = await rateLimit(key, "warmup")
    expect(denied.ok).toBe(false)
    expect(denied.retAfter).toBeGreaterThan(0)
  })

  it("route diverse con la stessa chiave client NON condividono il bucket (chiave composta)", async () => {
    // Senza trust proxy la chiave client è sempre "shared": prima del fix il
    // bucket era unico e il cfg dell'ultima route chiamata vinceva.
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 5; i++) expect((await rateLimit("shared", "warmup")).ok).toBe(true)
      expect((await rateLimit("shared", "warmup")).ok).toBe(false) // warmup esaurito

      // Il bucket poster (max 200) è intatto: non deve risentire del cap warmup.
      expect((await rateLimit("shared", "poster")).ok).toBe(true)
      for (let i = 0; i < 4; i++) expect((await rateLimit("shared", "poster")).ok).toBe(true)
      // E nemmeno il bucket default (max 120): riparte pieno.
      expect((await rateLimit("shared", "default")).ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("ricarica i token dopo la finestra di refill (con clock finto)", async () => {
    vi.useFakeTimers()
    try {
      const key = "h2-refill-1"
      for (let i = 0; i < 5; i++) expect((await rateLimit(key, "warmup")).ok).toBe(true)
      expect((await rateLimit(key, "warmup")).ok).toBe(false)

      // Dopo 2 finestre da 1 s: 2 token aggiuntivi (capped al max di 5) → 2 richieste ok
      vi.setSystemTime(Date.now() + 2_000)
      expect((await rateLimit(key, "warmup")).ok).toBe(true)
      expect((await rateLimit(key, "warmup")).ok).toBe(true)
      expect((await rateLimit(key, "warmup")).ok).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("bucket sconosciuti cadono sul default (120 burst)", async () => {
    const key = "h2-fallback-1"
    for (let i = 0; i < 120; i++) expect((await rateLimit(key, "non-esistente")).ok).toBe(true)
    expect((await rateLimit(key, "non-esistente")).ok).toBe(false)
  })
})
