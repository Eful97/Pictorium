/**
 * Task B — GET /api/presets public target filter accepts every badge family
 * (strict allowlist: known BADGE_TARGETS pass through to matching, anything
 * else 400s before the scan). Single-Classifica discovery: the visible
 * `rank` filter also matches stored legacy `top`-slot presets (same top
 * slot — see `isCommunityTargetMatch`); every other filter stays exact and
 * `?target=top` keeps working verbatim (public contract).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/badge-preset-store", () => ({
  listPublicPresets: vi.fn(),
  listUserPresets: vi.fn(),
  savePreset: vi.fn(),
  getPreset: vi.fn(),
  getPresetForUser: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
  incrementDownload: vi.fn(),
  PresetQuotaError: class PresetQuotaError extends Error {
    constructor(readonly max: number) {
      super(`Preset quota exceeded: max ${max} per user`)
    }
  },
  PresetNotFoundError: class PresetNotFoundError extends Error {},
  PresetForbiddenError: class PresetForbiddenError extends Error {},
  PresetValidationError: class PresetValidationError extends Error {},
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test-key"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
}))

import { listPublicPresets } from "@/lib/badge-preset-store"
import { GET as catalogGET } from "@/app/api/presets/route"
import { BADGE_TARGETS } from "@/lib/badge-preset"

function req(url: string): NextRequest {
  return new NextRequest(url)
}

const itemFor = (target: string) => ({
  preset: {
    version: 1,
    id: "Abc123-_XyZ",
    ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
    target,
    visibility: "public",
    metadata: { name: `${target} preset`, tags: [] },
    design: {
      shape: "pill",
      padding: { x: 12, y: 6 },
      background: { type: "solid", color: "#000000", opacity: 90 },
      text: { template: "T", color: "#ffffff", opacity: 100, fontSize: 20, fontWeight: 700, uppercase: false, letterSpacing: 0, align: "center" },
      scale: 100,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "deadbeef",
  },
  downloads: 1,
})

beforeEach(() => {
  vi.mocked(listPublicPresets).mockImplementation(async () => ({
    items: BADGE_TARGETS.map((t) => itemFor(t)) as never,
    nextCursor: null,
  }))
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("GET /api/presets family target filter", () => {
  it("accepts every BADGE_TARGETS value and filters to it (rank also surfaces legacy `top`)", async () => {
    for (const target of BADGE_TARGETS) {
      const res = await catalogGET(req(`http://localhost:3000/api/presets?target=${target}`))
      expect(res.status).toBe(200)
      const json = await res.json()
      const got = json.items.map((i: { preset: { target: string } }) => i.preset.target)
      // Single Classifica: the `rank` filter matches the `rank` family AND
      // the legacy `top` slot alias (same rendered top slot); the explicit
      // `top` filter keeps meaning exactly the stored alias.
      expect(got).toEqual(target === "rank" ? ["top", "rank"] : [target])
    }
  })

  it("rejects unknown targets and keeps the invalid-target message strict", async () => {
    for (const bad of ["sideways", "TOP", "top "] ) {
      const res = await catalogGET(req(`http://localhost:3000/api/presets?target=${encodeURIComponent(bad)}`))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(String(json.error)).toContain("Invalid target")
    }
  })
})
