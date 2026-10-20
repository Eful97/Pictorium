import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/mappings/import/route"

vi.mock("@/lib/store", () => {
  class QuotaExceededError extends Error {}
  return {
    importMappings: vi.fn(),
    setImdbAlias: vi.fn(),
    QuotaExceededError,
  }
})

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaultsChecked: vi.fn(async () => ({})),
  setServerDefaults: vi.fn(),
  getStoredUserDefaults: vi.fn(async () => ({})),
  setServerDefaultsForUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  checkAdminToken: vi.fn(() => true),
  isSameOrigin: vi.fn(() => true),
  adminAuthResponse: vi.fn(() => new Response("unauthorized", { status: 401 })),
  originMismatchResponse: vi.fn(() => new Response("forbidden", { status: 403 })),
}))

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...actual,
    extractUserParam: (req: NextRequest) => new URL(req.url).searchParams.get("u"),
    getScopedUserId: (raw: string | null) => raw,
    isMultiUserEnabled: () => true,
    checkUserAuth: vi.fn(async () => true),
    invalidUserResponse: vi.fn(() => new Response("bad user", { status: 400 })),
    userAuthResponse: vi.fn(() => new Response("unauth", { status: 401 })),
    userRateLimitKey: (req: NextRequest) => `test-${new URL(req.url).searchParams.get("u")}`,
  }
})

const BASE = "http://localhost:3000/api/mappings/import"

function mockRequest(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function validMapping(tmdbId: number, extra: Record<string, unknown> = {}) {
  return {
    tmdbId,
    mediaType: "movie",
    title: `T${tmdbId}`,
    posterPath: `/p${tmdbId}.jpg`,
    originalPosterPath: `/p${tmdbId}.jpg`,
    ...extra,
  }
}

describe("POST /api/mappings/import — backup v2", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("v1 legacy { mappings: {...} } (oggetto) si importa via Object.values", async () => {
    const { importMappings } = await import("@/lib/store")
    const res = await POST(mockRequest({ mappings: { a: validMapping(9) } }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(1)
    expect(importMappings).toHaveBeenCalledWith([expect.objectContaining({ tmdbId: 9 })], null)
  })

  it("local-only: ok senza toccare lo store", async () => {
    const { importMappings } = await import("@/lib/store")
    const res = await POST(mockRequest({ schemaVersion: 2, local: { lang: "it" } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      count: 0,
      imported: { mappings: 0, aliases: 0, defaults: 0, presets: 0 },
    })
    expect(importMappings).not.toHaveBeenCalled()
  })

  it("rifiuta body senza sezioni con 400", async () => {
    const res = await POST(mockRequest({ schemaVersion: 2 }))
    expect(res.status).toBe(400)
  })

  it("retired Badge Lab: la sezione `presets` si ignora, il resto si importa", async () => {
    const { importMappings, setImdbAlias } = await import("@/lib/store")
    const { setServerDefaults } = await import("@/lib/server-defaults")
    const body = {
      schemaVersion: 2,
      mappings: [validMapping(1, { badgePresetId: "OldId1234", badgePresetRev: "00000000" })],
      aliases: [{ imdbId: "tt1234567", mediaType: "movie", tmdbId: 1 }],
      defaults: { badgeStyle: "colored", serverKeys: { tmdbKey: "SECRET" }, tmdbKey: "SECRET" },
      presets: [{ id: "OldId1234", target: "top", metadata: { name: "Mio" } }],
      local: { lang: "it" },
    }
    const res = await POST(mockRequest(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.imported).toMatchObject({ mappings: 1, aliases: 1, defaults: 1, presets: 0 })
    expect(json.errors?.presets).toBeUndefined()
    expect(importMappings).toHaveBeenCalledTimes(1)
    // I campi Lab legacy dei mapping passano verbatim (mai riscritti, mai cancellati).
    expect(importMappings).toHaveBeenCalledWith(
      [expect.objectContaining({ badgePresetId: "OldId1234", badgePresetRev: "00000000" })],
      null,
    )
    expect(setImdbAlias).toHaveBeenCalledTimes(1)
    // I segreti non finiscono mai nei defaults persistiti.
    expect(setServerDefaults).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(setServerDefaults).mock.calls[0][0])).not.toContain("SECRET")
  })
})
