/**
 * Task D correction1 — draft-preview authorization + validation contract.
 *
 * The route renders unsaved drafts with real CPU (sharp). On public or
 * multi-user instances (the shared test setup simulates PUBLIC via
 * POSTERIUM_PUBLIC_INSTANCE=1, so `isPreviewAuthRequired()` is true) it
 * must follow the preview authorization policy:
 * - a syntactically valid `?u=` alone never authenticates and never selects
 *   the scoped rate-limit bucket (IP bucket for every unauthenticated
 *   caller, no bucket switching via query `u`);
 * - anonymous drafts are denied BEFORE any raster work (fail-closed, no
 *   render called on denial);
 * - authenticated scoped callers and unlocked (PIN/admin) sessions stay live.
 * Local single-user instances (no preview-auth requirement) keep anonymous
 * drafts open. Validation stays fail-closed: oversized bodies 413, unknown
 * envelope fields 400, house style/target mismatches 400 (never a
 * placeholder 200). Denials are small, CORS-open and no-store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test-ip-key"),
  rateLimitResponse: vi.fn((_retAfter: number) => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn((_req: unknown, userId: string) => `test-ip-key|user:${userId}`),
}))

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...orig,
    checkUserAuth: vi.fn(async () => false),
    // Deterministic scoped bucket independent of the rate-limit wiring the
    // real helper closes over: the assertion target is the route's choice of
    // bucket (IP vs scoped), not the helper's IP derivation.
    userRateLimitKey: (_req: unknown, userId: string) => `test-ip-key|user:${userId}`,
  }
})

vi.mock("@/lib/badge-preset-technical-preview", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/badge-preset-technical-preview")>()
  return {
    ...orig,
    renderTechnicalPresetPreviewSvg: vi.fn(orig.renderTechnicalPresetPreviewSvg),
  }
})

import { rateLimit } from "@/lib/rate-limit"
import { checkUserAuth } from "@/lib/user-auth"
import { renderTechnicalPresetPreviewSvg } from "@/lib/badge-preset-technical-preview"
import { POST as draftPreviewPOST } from "@/app/api/presets/draft-preview/route"

const UUID = "123e4567-e89b-12d3-a456-426614174000"
const OTHER_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const ADMIN_TOKEN = "test-route-auth-admin-token"

const qualityHouse = {
  variant: "house",
  target: "quality",
  house: { style: "standard", scale: 100, polarity: "auto" },
} as const

function req(url: string, body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

const URL_OF = "http://localhost:3000/api/presets/draft-preview"

beforeEach(() => {
  vi.mocked(checkUserAuth).mockResolvedValue(false)
  vi.mocked(rateLimit).mockResolvedValue({ ok: true, retAfter: 0 })
  vi.stubEnv("PICTORIUM_MULTI_USER", "1")
  vi.stubEnv("PICTORIUM_ADMIN_TOKEN", ADMIN_TOKEN)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("draft-preview authorization (public instance)", () => {
  it("denies an unauthenticated spoofed u without rendering (IP bucket, 401, no-store)", async () => {
    const res = await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, { preset: qualityHouse }))
    expect(res.status).toBe(401)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const text = await res.text()
    expect(text.length).toBeLessThanOrEqual(16 * 1024)
    expect(text).not.toContain(UUID)
    // The spoofed namespace must not earn its bucket: IP key, not user key.
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe("test-ip-key")
    expect(vi.mocked(rateLimit).mock.calls[0][1]).toBe("presets")
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("keeps unauthenticated callers on the IP bucket across different u values", async () => {
    await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, { preset: qualityHouse }))
    await draftPreviewPOST(req(`${URL_OF}?u=${OTHER_UUID}`, { preset: qualityHouse }))
    const keys = vi.mocked(rateLimit).mock.calls.map((c) => c[0])
    expect(keys).toEqual(["test-ip-key", "test-ip-key"])
  })

  it("denies anonymous drafts without u on public instances (401, no render)", async () => {
    const res = await draftPreviewPOST(req(URL_OF, { preset: qualityHouse }))
    expect(res.status).toBe(401)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("lets an authenticated scoped caller render on the scoped bucket (200, svg, no-store)", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(true)
    const res = await draftPreviewPOST(
      req(`${URL_OF}?u=${UUID}`, { preset: qualityHouse }, { "x-user-token": "secret" }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe(`test-ip-key|user:${UUID}`)
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).toHaveBeenCalledTimes(1)
    const svg = await res.text()
    expect(svg).toContain("<svg")
  })

  it("lets an unlocked admin session render without u on public instances", async () => {
    const res = await draftPreviewPOST(
      req(URL_OF, { preset: qualityHouse }, { "x-admin-token": ADMIN_TOKEN }),
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).toHaveBeenCalled()
  })

  it("rejects cross-origin posts with 403 before any render (CORS-open, no-store)", async () => {
    const res = await draftPreviewPOST(
      req(URL_OF, { preset: qualityHouse }, { origin: "https://evil.example" }),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("rejects syntactically invalid u with 400 (invalid user, no render)", async () => {
    const res = await draftPreviewPOST(req(`${URL_OF}?u=not-a-uuid`, { preset: qualityHouse }))
    expect(res.status).toBe(400)
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })
})

describe("draft-preview validation (fail-closed, no placeholder 200)", () => {
  it("rejects oversized bodies with 413 before rendering", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(true)
    const padded = `${" ".repeat(17 * 1024)}${JSON.stringify({ preset: qualityHouse })}`
    const res = await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, padded))
    expect(res.status).toBe(413)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("rejects a house style mismatched to its target with 400 (never placeholder 200)", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(true)
    const mismatched = {
      preset: {
        variant: "house",
        target: "quality",
        // "ribbon" belongs to comingSoon, not quality.
        house: { style: "ribbon", scale: 100, polarity: "auto" },
      },
    }
    const res = await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, mismatched))
    expect(res.status).toBe(400)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    const text = await res.text()
    expect(text).not.toContain("<svg")
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("rejects unknown envelope fields despite the strict contract (400)", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(true)
    const res = await draftPreviewPOST(
      req(`${URL_OF}?u=${UUID}`, { preset: qualityHouse, junk: "ignored?" }),
    )
    expect(res.status).toBe(400)
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("rejects missing variant payloads with 400 (never placeholder 200)", async () => {
    vi.mocked(checkUserAuth).mockResolvedValue(true)
    for (const body of [
      { preset: { variant: "house", target: "quality" } },
      { variant: "house", target: "quality" },
      { preset: { variant: "custom", target: "genre" } },
    ]) {
      const res = await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, body))
      expect(res.status).toBe(400)
    }
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).not.toHaveBeenCalled()
  })

  it("accepts the bare (unenveloped) payload for authenticated callers", async () => {
    vi.mocked(checkUserAuth).mockResolvedValueOnce(true)
    const res = await draftPreviewPOST(req(`${URL_OF}?u=${UUID}`, qualityHouse))
    expect(res.status).toBe(200)
    expect(vi.mocked(renderTechnicalPresetPreviewSvg)).toHaveBeenCalledTimes(1)
  })
})

describe("draft-preview on a local single-user instance (no preview-auth requirement)", () => {
  it("permits anonymous drafts without rendering policy friction", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_PUBLIC_INSTANCE", "0")
    vi.stubEnv("PICTORIUM_MULTI_USER", "0")
    vi.stubEnv("PICTORIUM_PREVIEW_AUTH", "")
    vi.stubEnv("PREVIEW_AUTH", "")
    const { POST: localPOST } = await import("@/app/api/presets/draft-preview/route")
    const res = await localPOST(req(URL_OF, { preset: qualityHouse }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(await res.text()).toContain("<svg")
    vi.resetModules()
  })
})
