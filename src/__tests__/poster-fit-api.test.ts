import { afterEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/poster-fit/route"

async function makePosterBuffer(r: number, g: number, b: number): Promise<Buffer> {
  const data = Buffer.alloc(500 * 750 * 3)
  for (let i = 0; i < 500 * 750; i++) {
    const off = i * 3
    data[off] = r; data[off + 1] = g; data[off + 2] = b
  }
  return sharp(data, { raw: { width: 500, height: 750, channels: 3 } }).jpeg().toBuffer()
}

async function makeLogoBuffer(r: number, g: number, b: number): Promise<Buffer> {
  const data = Buffer.alloc(200 * 80 * 4)
  for (let i = 0; i < 200 * 80; i++) {
    const off = i * 4
    data[off] = r; data[off + 1] = g; data[off + 2] = b; data[off + 3] = 255
  }
  return sharp(data, { raw: { width: 200, height: 80, channels: 4 } }).png().toBuffer()
}

function mockNextRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/poster-fit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/poster-fit", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns ranked results for valid input", async () => {
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      return new Response(new Uint8Array(posterBuf))
    }))

    const req = mockNextRequest({ posterPaths: ["/test.jpg"], logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ranked).toHaveLength(1)
    expect(json.ranked[0].posterPath).toBe("/test.jpg")
    expect(json.ranked[0].score).toBeGreaterThan(0)
    expect(json.ranked[0].adjustedScore).toBeGreaterThan(0)
    expect(json.ranked[0].textPenalty).toBeTypeOf("number")
    expect(json.ranked[0].logoZoneScore).toBeTypeOf("number")
    expect(json.ranked[0].colorConflictPenalty).toBeTypeOf("number")
    expect(json.ranked[0].qualityScore).toBeTypeOf("number")
    expect(json.ranked[0].metrics).toHaveProperty("cleanliness")
    expect(json.ranked[0].metrics).toHaveProperty("contrast")
    expect(json.ranked[0].metrics).toHaveProperty("lowDetailScore")
    expect(json.ranked[0].metrics).toHaveProperty("badgeReadability")
    expect(json.ranked[0].reasons).toBeInstanceOf(Array)
    expect(json.bestPosterPath).toBe("/test.jpg")
    expect(json.total).toBe(1)
    expect(json.failed).toBe(0)
  })

  it("returns 400 when posterPaths is missing", async () => {
    const req = mockNextRequest({ logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when logoPath is missing", async () => {
    const req = mockNextRequest({ posterPaths: ["/test.jpg"] })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for empty posterPaths", async () => {
    const req = mockNextRequest({ posterPaths: [], logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/poster-fit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 502 when logo fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
    const req = mockNextRequest({ posterPaths: ["/test.jpg"], logoPath: "/missing.png" })
    const res = await POST(req)
    expect(res.status).toBe(502)
  })

  it("skips posters that fail to fetch", async () => {
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    let callCount = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      callCount++
      if (callCount === 1) return new Response(null, { status: 404 })
      return new Response(new Uint8Array(posterBuf))
    }))

    const req = mockNextRequest({ posterPaths: ["/fail.jpg", "/ok.jpg"], logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ranked).toHaveLength(1)
    expect(json.failed).toBe(1)
  })

  it("rejects an injected posterSize and falls back to w342 (M13 — set chiuso)", async () => {
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      return new Response(new Uint8Array(posterBuf))
    }))

    const req = mockNextRequest({
      posterPaths: ["/test.jpg"],
      logoPath: "/logo.png",
      posterSize: "../../../etc/passwd",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    // Il path injected non deve comparire mai nell'URL TMDB: caduta sul default w342.
    const posterUrl = urls.find((u) => u.includes("test.jpg"))
    expect(posterUrl).toBe("https://image.tmdb.org/t/p/w342/test.jpg")
  })

  it("honors a valid posterSize from the closed set (w500)", async () => {
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      return new Response(new Uint8Array(posterBuf))
    }))

    const req = mockNextRequest({
      posterPaths: ["/test.jpg"],
      logoPath: "/logo.png",
      posterSize: "w500",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const posterUrl = urls.find((u) => u.includes("test.jpg"))
    expect(posterUrl).toBe("https://image.tmdb.org/t/p/w500/test.jpg")
  })

  it("only analyzes up to candidate pool (5+5)", async () => {
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      return new Response(new Uint8Array(posterBuf))
    })
    vi.stubGlobal("fetch", fetchFn)

    const paths = Array.from({ length: 25 }, (_, i) => `/poster${i}.jpg`)
    const req = mockNextRequest({ posterPaths: paths, logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBeLessThanOrEqual(16)
    expect(json.ranked.length).toBeLessThanOrEqual(16)
  })

  it("sorts ranked by adjustedScore descending", async () => {
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    const darkBuf = await makePosterBuffer(20, 20, 30)
    const lightBuf = await makePosterBuffer(230, 230, 240)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      if (url.includes("/dark")) return new Response(new Uint8Array(darkBuf))
      return new Response(new Uint8Array(lightBuf))
    }))

    const req = mockNextRequest({
      posterPaths: ["/light.jpg", "/dark.jpg"],
      logoPath: "/logo.png",
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ranked).toHaveLength(2)
    expect(json.ranked[0].adjustedScore).toBeGreaterThanOrEqual(json.ranked[1].adjustedScore)
    expect(json.ranked[0].posterPath).toBe("/dark.jpg")
  })
})

describe("POST /api/poster-fit — auth (S10)", () => {
  afterEach(() => {
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
    process.env.POSTERIUM_PUBLIC_INSTANCE = "1"
    vi.restoreAllMocks()
  })

  it("returns 401 without a valid admin token when one is configured", async () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = mockNextRequest({ posterPaths: ["/test.jpg"], logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 401 in production without POSTERIUM_PUBLIC_INSTANCE (fail-closed, caso HF/Vercel)", async () => {
    // Regressione: in locale (NODE_ENV=development) le route admin sono aperte,
    // ma in produzione senza POSTERIUM_PUBLIC_INSTANCE=1 (o ADMIN_TOKEN) il
    // best-fit UI risponde 401 → l'editor non mostra il poster migliore.
    delete process.env.POSTERIUM_PUBLIC_INSTANCE
    vi.stubEnv("NODE_ENV", "production")
    const req = mockNextRequest({ posterPaths: ["/test.jpg"], logoPath: "/logo.png" })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("accepts the request with a valid x-admin-token", async () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const posterBuf = await makePosterBuffer(20, 20, 30)
    const logoBuf = await makeLogoBuffer(255, 255, 255)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/logo")) return new Response(new Uint8Array(logoBuf))
      return new Response(new Uint8Array(posterBuf))
    }))
    const req = new NextRequest("http://localhost:3000/api/poster-fit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "secret" },
      body: JSON.stringify({ posterPaths: ["/test.jpg"], logoPath: "/logo.png" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
