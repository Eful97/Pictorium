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

vi.mock("@/lib/badge-preset-store", () => {
  class PresetQuotaError extends Error {}
  class PresetValidationError extends Error {}
  return {
    listUserPresets: vi.fn(async () => presetMockState.existing),
    savePreset: vi.fn(async (_uuid: string, input: Record<string, unknown>) => ({
      preset: { id: "NewPresetId1", revision: "abcdef12", ...(input as object) },
      downloads: 0,
    })),
    PresetQuotaError,
    PresetValidationError,
  }
})

const presetMockState = vi.hoisted(() => ({ existing: [] as unknown[] }))

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

function privatePreset(id: string, name: string) {
  return {
    preset: {
      id,
      ownerUuid: "11111111-1111-4111-8111-111111111111",
      target: "top",
      visibility: "private",
      metadata: { name, tags: [] },
      variant: "custom",
      design: {},
      createdAt: 1,
      updatedAt: 2,
      revision: "00000000",
    },
    downloads: 0,
  }
}

describe("POST /api/mappings/import — backup v2", () => {
  afterEach(() => {
    presetMockState.existing = []
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

  it("rifiuta oltre 100 preset con 413", async () => {
    const presets = Array.from({ length: 101 }, (_, i) => privatePreset(`id${i}`, `P${i}`))
    const res = await POST(mockRequest({ schemaVersion: 2, presets }))
    expect(res.status).toBe(413)
  })

  it("senza namespace i preset privati si saltano, il resto si importa", async () => {    const { importMappings, setImdbAlias } = await import("@/lib/store")
    const { setServerDefaults } = await import("@/lib/server-defaults")
    const body = {
      schemaVersion: 2,
      mappings: [validMapping(1)],
      aliases: [{ imdbId: "tt1234567", mediaType: "movie", tmdbId: 1 }],
      defaults: { badgeStyle: "shadow", serverKeys: { tmdbKey: "SECRET" }, tmdbKey: "SECRET" },
      presets: [privatePreset("OldId1234", "Mio")],
      local: { lang: "it" },
    }
    const res = await POST(mockRequest(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.imported).toMatchObject({ mappings: 1, aliases: 1, defaults: 1, presets: 0 })
    expect(json.errors.presets).toMatch(/namespace/)
    expect(importMappings).toHaveBeenCalledTimes(1)
    expect(setImdbAlias).toHaveBeenCalledTimes(1)
    // I segreti non finiscono mai nei defaults persistiti.
    expect(setServerDefaults).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(setServerDefaults).mock.calls[0][0])).not.toContain("SECRET")
  })

  it("nel namespace importa i preset privati e rimappa i mapping che li citano", async () => {
    const uuid = "11111111-1111-4111-8111-111111111111"
    const { importMappings } = await import("@/lib/store")
    const { savePreset, listUserPresets } = await import("@/lib/badge-preset-store")
    const { setServerDefaultsForUser } = await import("@/lib/server-defaults")
    const body = {
      schemaVersion: 2,
      mappings: [validMapping(5, { badgePresetId: "OldId1234", badgePresetRev: "00000000" })],
      defaults: { badgeStyle: "colored" },
      presets: [privatePreset("OldId1234", "Mio")],
    }
    const req = new NextRequest(`${BASE}?u=${uuid}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.imported).toMatchObject({ mappings: 1, presets: 1, defaults: 1 })
    expect(listUserPresets).toHaveBeenCalledWith(uuid)
    // Forzati privati, senza fork cross-spazio.
    expect(savePreset).toHaveBeenCalledWith(
      uuid,
      expect.objectContaining({ visibility: "private", forkedFrom: null }),
    )
    // Il mapping cita il NUOVO id generato dal server, non quello del backup.
    expect(importMappings).toHaveBeenCalledWith(
      [expect.objectContaining({ badgePresetId: "NewPresetId1", badgePresetRev: "abcdef12" })],
      uuid,
    )
    expect(setServerDefaultsForUser).toHaveBeenCalledTimes(1)
  })

  it("il re-import non duplica i preset con stesso nome", async () => {
    const uuid = "11111111-1111-4111-8111-111111111111"
    const { savePreset } = await import("@/lib/badge-preset-store")
    presetMockState.existing = [
      {
        preset: {
          id: "Existing1",
          target: "top",
          visibility: "private",
          metadata: { name: "Mio", tags: [] },
        },
        downloads: 0,
      },
    ]
    const req = new NextRequest(`${BASE}?u=${uuid}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, presets: [privatePreset("OldId1234", "Mio")] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ imported: expect.objectContaining({ presets: 0 }) })
    expect(savePreset).not.toHaveBeenCalled()
  })
})
