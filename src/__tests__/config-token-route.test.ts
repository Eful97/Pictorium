import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/config-token/route"
import { decodeConfig } from "@/lib/config-token"
import type { PictoriumUserConfig } from "@/lib/config-token"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/auth", () => ({
  isSameOrigin: vi.fn(() => true),
  originMismatchResponse: vi.fn(() => new Response("origin mismatch", { status: 403 })),
}))

const VALID_CONFIG: PictoriumUserConfig = {
  globalBadges: true,
  rankingBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeStyle: "colored",
  rankingBadgeStyle: "netflix",
  blurEnabled: true,
  blurIntensity: 7,
  blurFade: 70,
  blurDarkness: 50,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
  logoFitEnabled: true,
  customBadge: "Oscar",
  ribbonSide: "left",
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/config-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/config-token", () => {
  it("returns a token that decodes back to the same config", async () => {
    const res = await POST(makeRequest({ config: VALID_CONFIG }))
    expect(res.status).toBe(200)
    const { token } = await res.json()
    expect(typeof token).toBe("string")
    expect(token.length).toBeGreaterThan(50)
    const decoded = decodeConfig(token)
    expect(decoded).toEqual(VALID_CONFIG)
  })

  it("returns 400 for an invalid config", async () => {
    const res = await POST(makeRequest({ config: { globalBadges: "not-a-bool" } }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for a missing config", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 403 on cross-origin requests", async () => {
    const { isSameOrigin } = await import("@/lib/auth")
    vi.mocked(isSameOrigin).mockReturnValue(false)
    const res = await POST(makeRequest({ config: VALID_CONFIG }))
    expect(res.status).toBe(403)
  })
})
