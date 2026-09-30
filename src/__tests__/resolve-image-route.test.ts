import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test-key"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
}))

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/user-auth")>()
  return { ...orig, checkUserAuth: vi.fn(async () => true) }
})

vi.mock("@/lib/resolve-image", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/resolve-image")>()
  return { ...orig, resolveToImageUrl: vi.fn() }
})

import { checkUserAuth } from "@/lib/user-auth"
import { resolveToImageUrl, ResolveImageError } from "@/lib/resolve-image"
import { GET } from "@/app/api/resolve-image/route"

const UUID = "123e4567-e89b-12d3-a456-426614174000"

function req(url: string): NextRequest {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("PICTORIUM_MULTI_USER", "1")
  vi.mocked(checkUserAuth).mockResolvedValue(true)
  vi.mocked(resolveToImageUrl).mockResolvedValue({
    imageUrl: "https://i.imgur.com/x.jpg",
    source: "direct",
    width: 1000,
    height: 1500,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("GET /api/resolve-image auth e namespace", () => {
  it("spazio sbloccato: risolve e non mette in cache", async () => {
    const res = await GET(req(`http://localhost:3000/api/resolve-image?u=${UUID}&url=${encodeURIComponent("https://imgur.com/gallery/abc")}`))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const json = await res.json()
    expect(json.imageUrl).toBe("https://i.imgur.com/x.jpg")
    expect(vi.mocked(resolveToImageUrl)).toHaveBeenCalledWith("https://imgur.com/gallery/abc")
  })

  it("spazio bloccato: 401 senza passthrough al resolver", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(false)
    const res = await GET(req(`http://localhost:3000/api/resolve-image?u=${UUID}&url=https://i.imgur.com/x.jpg`))
    expect(res.status).toBe(401)
    expect(vi.mocked(resolveToImageUrl)).not.toHaveBeenCalled()
  })

  it("uuid invalido: 400", async () => {
    const res = await GET(req("http://localhost:3000/api/resolve-image?u=nope&url=https://i.imgur.com/x.jpg"))
    expect(res.status).toBe(400)
    expect(vi.mocked(resolveToImageUrl)).not.toHaveBeenCalled()
  })

  it("url mancante: 400", async () => {
    const res = await GET(req(`http://localhost:3000/api/resolve-image?u=${UUID}`))
    expect(res.status).toBe(400)
  })

  it("propaga gli errori tipizzati del resolver (403 allowlist)", async () => {
    vi.mocked(resolveToImageUrl).mockRejectedValueOnce(new ResolveImageError(403, "Host not in the image-source allowlist"))
    const res = await GET(req(`http://localhost:3000/api/resolve-image?u=${UUID}&url=https://evil.com/x.jpg`))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/allowlist/)
  })
})
