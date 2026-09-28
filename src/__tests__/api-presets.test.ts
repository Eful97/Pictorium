import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/user-auth")>()
  return { ...orig, checkUserAuth: vi.fn(async () => true) }
})

import { rateLimit } from "@/lib/rate-limit"
import { checkUserAuth } from "@/lib/user-auth"
import {
  deletePreset,
  getPreset,
  getPresetForUser,
  incrementDownload,
  listPublicPresets,
  listUserPresets,
  savePreset,
  updatePreset,
  PresetForbiddenError,
  PresetNotFoundError,
  PresetQuotaError,
  PresetValidationError,
} from "@/lib/badge-preset-store"
import { GET as catalogGET, POST as catalogPOST } from "@/app/api/presets/route"
import { GET as itemGET, PUT as itemPUT, DELETE as itemDELETE } from "@/app/api/presets/[id]/route"
import { POST as downloadPOST } from "@/app/api/presets/[id]/download/route"
import { GET as previewGET } from "@/app/api/presets/[id]/preview.svg/route"
import {
  POSTER_CACHE_ALLOWLIST,
  hardenPosterSearchParams,
} from "@/lib/poster-params-hardening"

const UUID = "123e4567-e89b-12d3-a456-426614174000"
const STRANGER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init)
}

const storedPublic = {
  preset: {
    version: 1,
    id: "Abc123-_XyZ",
    ownerUuid: UUID,
    target: "top",
    visibility: "public",
    metadata: { name: "Gold Top", description: "shiny", tags: ["gold"] },
    design: {
      shape: "pill",
      padding: { x: 12, y: 6 },
      background: { type: "solid", color: "#ff0000", opacity: 90 },
      text: {
        template: "★ {{rating}}",
        color: "#ffffff",
        opacity: 100,
        fontSize: 20,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "deadbeef",
  },
  downloads: 7,
}

const storedGenre = {
  preset: { ...storedPublic.preset, id: "Genre123_Xy", target: "genre", metadata: { name: "Blue Genre", tags: ["blue"] } },
  downloads: 1,
}

beforeEach(() => {
  vi.stubEnv("PICTORIUM_MULTI_USER", "1")
  vi.mocked(listPublicPresets).mockResolvedValue({ items: [storedPublic, storedGenre] as never, nextCursor: null })
  vi.mocked(listUserPresets).mockResolvedValue([storedPublic] as never)
  vi.mocked(savePreset).mockResolvedValue(storedPublic as never)
  vi.mocked(getPreset).mockResolvedValue(storedPublic as never)
  vi.mocked(getPresetForUser).mockResolvedValue(storedPublic as never)
  vi.mocked(updatePreset).mockResolvedValue(storedPublic as never)
  vi.mocked(deletePreset).mockResolvedValue(true)
  vi.mocked(incrementDownload).mockResolvedValue(8)
  vi.mocked(checkUserAuth).mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("GET /api/presets catalog", () => {
  it("returns the public catalog with cache headers", async () => {
    const res = await catalogGET(req("http://localhost:3000/api/presets"))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("public")
    const json = await res.json()
    expect(json.items).toHaveLength(2)
    expect(json.nextCursor).toBeNull()
  })

  it("filters by q, tag and target", async () => {
    const res = await catalogGET(req("http://localhost:3000/api/presets?q=gold&tag=gold&target=top"))
    const json = await res.json()
    expect(json.items.map((i: { preset: { metadata: { name: string } } }) => i.preset.metadata.name)).toEqual(["Gold Top"])
  })

  it("rejects invalid sort and target", async () => {
    expect((await catalogGET(req("http://localhost:3000/api/presets?sort=nope"))).status).toBe(400)
    expect((await catalogGET(req("http://localhost:3000/api/presets?target=nope"))).status).toBe(400)
  })

  it("requires namespace and auth for mine=1", async () => {
    expect((await catalogGET(req("http://localhost:3000/api/presets?mine=1"))).status).toBe(400)
    vi.mocked(checkUserAuth).mockResolvedValueOnce(false)
    expect((await catalogGET(req(`http://localhost:3000/api/presets?mine=1&u=${UUID}`))).status).toBe(401)
    const res = await catalogGET(req(`http://localhost:3000/api/presets?mine=1&u=${UUID}`))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(listUserPresets).toHaveBeenCalledWith(UUID)
  })
})

describe("POST /api/presets", () => {
  const body = {
    target: "top",
    visibility: "public",
    metadata: { name: "N", tags: [] },
    design: storedPublic.preset.design,
  }
  const post = (u: string | null, b: unknown, headers?: Record<string, string>) =>
    catalogPOST(
      req(u ? `http://localhost:3000/api/presets?u=${u}` : "http://localhost:3000/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(b),
      }),
    )

  it("creates with 201 and maps store errors", async () => {
    expect((await post(UUID, body)).status).toBe(201)
    vi.mocked(savePreset).mockRejectedValueOnce(new PresetQuotaError(100))
    expect((await post(UUID, body)).status).toBe(413)
    vi.mocked(savePreset).mockRejectedValueOnce(new PresetValidationError("bad"))
    expect((await post(UUID, body)).status).toBe(400)
    vi.mocked(savePreset).mockRejectedValueOnce(new Error("disk full"))
    expect((await post(UUID, body)).status).toBe(500)
  })

  it("requires namespace, auth and same origin", async () => {
    expect((await post(null, body)).status).toBe(400)
    vi.mocked(checkUserAuth).mockResolvedValueOnce(false)
    expect((await post(UUID, body)).status).toBe(401)
    expect((await post(UUID, body, { origin: "https://evil.com" })).status).toBe(403)
  })

  it("rejects oversized and invalid bodies", async () => {
    const big = await post(UUID, { data: "x".repeat(40000) })
    expect(big.status).toBe(413)
    const bad = catalogPOST(
      req(`http://localhost:3000/api/presets?u=${UUID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    )
    expect((await bad).status).toBe(400)
  })
})

describe("/api/presets/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it("GET validates id, maps missing, caches publics", async () => {
    expect((await itemGET(req("http://localhost:3000/api/presets/nope"), ctx("nope"))).status).toBe(400)
    vi.mocked(getPresetForUser).mockResolvedValueOnce(null)
    expect((await itemGET(req("http://localhost:3000/api/presets/Abc123-_XyZ"), ctx("Abc123-_XyZ"))).status).toBe(404)
    const res = await itemGET(req("http://localhost:3000/api/presets/Abc123-_XyZ"), ctx("Abc123-_XyZ"))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("public")
  })

  it("PUT/DELETE enforce auth, ownership and existence", async () => {
    const put = (b: unknown) =>
      itemPUT(
        req(`http://localhost:3000/api/presets/Abc123-_XyZ?u=${UUID}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        }),
        ctx("Abc123-_XyZ"),
      )
    expect((await put({})).status).toBe(200)
    vi.mocked(updatePreset).mockRejectedValueOnce(new PresetNotFoundError("x"))
    expect((await put({})).status).toBe(404)
    vi.mocked(updatePreset).mockRejectedValueOnce(new PresetForbiddenError())
    expect((await put({})).status).toBe(403)
    vi.mocked(checkUserAuth).mockResolvedValueOnce(false)
    expect((await put({})).status).toBe(401)

    const del = () => itemDELETE(req(`http://localhost:3000/api/presets/Abc123-_XyZ?u=${UUID}`, { method: "DELETE" }), ctx("Abc123-_XyZ"))
    expect((await del()).status).toBe(200)
    vi.mocked(deletePreset).mockResolvedValueOnce(false)
    expect((await del()).status).toBe(404)
    vi.mocked(deletePreset).mockRejectedValueOnce(new PresetForbiddenError())
    expect((await del()).status).toBe(403)
  })
})

describe("POST /api/presets/[id]/download", () => {
  const ctx = { params: Promise.resolve({ id: "Abc123-_XyZ" }) }

  it("counts downloads and maps missing/forbidden", async () => {
    const res = await downloadPOST(req("http://localhost:3000/api/presets/Abc123-_XyZ/download", { method: "POST" }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ downloads: 8 })
    vi.mocked(getPreset).mockResolvedValueOnce(null)
    expect((await downloadPOST(req("http://localhost:3000/api/presets/Abc123-_XyZ/download", { method: "POST" }), ctx)).status).toBe(404)
    vi.mocked(getPreset).mockResolvedValueOnce({
      preset: { ...storedPublic.preset, visibility: "private", ownerUuid: UUID },
      downloads: 0,
    } as never)
    const forbidden = await downloadPOST(
      req(`http://localhost:3000/api/presets/Abc123-_XyZ/download?u=${STRANGER}`, { method: "POST" }),
      ctx,
    )
    expect(forbidden.status).toBe(403)
    expect((await downloadPOST(req("http://localhost:3000/api/presets/nope/download", { method: "POST" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400)
  })
})

describe("GET /api/presets/[id]/preview.svg", () => {
  const ctx = { params: Promise.resolve({ id: "Abc123-_XyZ" }) }

  it("renders deterministic SVG with revision ETag", async () => {
    const res = await previewGET(req("http://localhost:3000/api/presets/Abc123-_XyZ/preview.svg"), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
    expect(res.headers.get("etag")).toBe('"prv-deadbeef"')
    const svg = await res.text()
    expect(svg).toContain("<svg")
    expect(svg).toContain("8.5")
    vi.mocked(getPresetForUser).mockResolvedValueOnce(null)
    expect((await previewGET(req("http://localhost:3000/api/presets/Abc123-_XyZ/preview.svg"), ctx)).status).toBe(404)
  })
})

describe("presets rate limiting + poster hardening", () => {
  it("returns 429 when the bucket is empty", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({ ok: false, retAfter: 3 })
    expect((await catalogGET(req("http://localhost:3000/api/presets"))).status).toBe(429)
  })

  it("allows badgePreset/prv in the poster cache key and drops junk", async () => {
    expect(POSTER_CACHE_ALLOWLIST.has("badgePreset")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("prv")).toBe(true)
    const base = { presets: true, preview: false, anonymous: false, publicInstance: true, hasMapping: false } as const
    const good = hardenPosterSearchParams(new URLSearchParams("badgePreset=Abc123-_XyZ&prv=deadbeef"), base)
    expect(good.get("badgePreset")).toBe("Abc123-_XyZ")
    expect(good.get("prv")).toBe("deadbeef")
    const bad = hardenPosterSearchParams(new URLSearchParams("badgePreset=<script>&prv=random"), base)
    expect(bad.has("badgePreset")).toBe(false)
    expect(bad.has("prv")).toBe(false)
  })
})
