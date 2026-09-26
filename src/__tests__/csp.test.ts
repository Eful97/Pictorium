import { describe, expect, it } from "vitest"
import { buildCspHeader, cspExtraOrigins } from "@/lib/csp"

describe("cspExtraOrigins", () => {
  it("vuoto senza env (policy invariata)", () => {
    expect(cspExtraOrigins({})).toEqual([])
  })

  it("NEXT_PUBLIC vince su POSTER_CDN_URL, solo scheme+host", () => {
    expect(
      cspExtraOrigins({
        NEXT_PUBLIC_POSTER_CDN_URL: "https://cdn.example.com/some/path///",
        POSTER_CDN_URL: "https://other.example.com",
      }),
    ).toEqual(["https://cdn.example.com"])
  })

  it("fallback a POSTER_CDN_URL e tollera host nudo", () => {
    expect(cspExtraOrigins({ POSTER_CDN_URL: "cdn.example.com" })).toEqual(["https://cdn.example.com"])
  })

  it("scarta scheme non http(s) e valori malformati", () => {
    expect(cspExtraOrigins({ POSTER_CDN_URL: "ftp://cdn.example.com" })).toEqual([])
    expect(cspExtraOrigins({ POSTER_CDN_URL: "http://[invalid" })).toEqual([])
    expect(cspExtraOrigins({ POSTER_CDN_URL: "   " })).toEqual([])
  })
})

describe("buildCspHeader", () => {
  const BASE =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https://image.tmdb.org https://artworks.thetvdb.com; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'self' https://huggingface.co https://*.huggingface.co https://*.hf.space"

  it("byte-identico alla policy congelata storica senza CDN", () => {
    expect(buildCspHeader({})).toBe(BASE)
  })

  it("aggiunge scheme+host CDN a img-src e connect-src (stessa precedenza env)", () => {
    const header = buildCspHeader({ POSTER_CDN_URL: "https://cdn.example.com/x?y=1" })
    expect(header).toContain("img-src 'self' data: blob: https://image.tmdb.org https://artworks.thetvdb.com https://cdn.example.com")
    expect(header).toContain("connect-src 'self' https://cdn.example.com")
    expect(header).not.toContain("/x")
  })

  it("CDN invalido = policy invariata", () => {
    expect(buildCspHeader({ POSTER_CDN_URL: "ftp://cdn.example.com" })).toBe(BASE)
  })

  it("dev aggiunge unsafe-eval e websocket HMR", () => {
    const header = buildCspHeader({}, { isDev: true })
    expect(header).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(header).toContain("connect-src 'self' ws://127.0.0.1:* ws://localhost:*")
  })

  it("PICTORIUM_FRAME_ANCESTORS sovrascrive il default HF (v1.23.0)", () => {
    const header = buildCspHeader({ PICTORIUM_FRAME_ANCESTORS: "'self'" })
    expect(header).toContain("frame-ancestors 'self'")
    expect(header).not.toContain("hf.space")
  })
})
