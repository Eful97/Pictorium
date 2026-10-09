import type { NextRequest } from "next/server"
import fsp from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, PUT } from "@/app/api/defaults/route"
import { cacheClear, cacheGet, cacheSet } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { DATA_DIR } from "@/lib/data-dir"
import { setServerDefaults } from "@/lib/server-defaults"

// I PUT di questo file scrivono i defaults via file; isoliamo lo store in una
// dir temporanea (test-results/, gitignored) così i config di test non toccano
// il reale data/defaults.json dell'istanza.
vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-defaults-test`,
}))

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

function mockPutRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/defaults", () => {
  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid body fields", async () => {
    const req = mockPutRequest({ badgeStyle: 123, blurEnabled: "yes" })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("returns 401 when ADMIN_TOKEN is set and header is missing", async () => {
    process.env.ADMIN_TOKEN = "secret-token"
    const req = mockPutRequest({ badgeStyle: "bar" })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(401)
  })

  it("accepts valid body with no auth token set", async () => {
    delete process.env.ADMIN_TOKEN
    const req = mockPutRequest({ badgeStyle: "bar", rankingBadges: true })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  it("persists disableCleanPosters through PUT and GET", async () => {
    delete process.env.ADMIN_TOKEN
    const putRes = await PUT(mockPutRequest({ disableCleanPosters: true }) as unknown as NextRequest)
    expect(putRes.status).toBe(200)
    const getRes = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const data = await getRes.json()
    expect(data.disableCleanPosters).toBe(true)
  })

  it("preserves custom catalog datasetId through PUT and GET", async () => {
    delete process.env.ADMIN_TOKEN
    const catalogs = [
      { id: "cat1", name: "My CSV", type: "mixed", url: "imdb-csv:ds_abc123", datasetId: "ds_abc123", enabled: true },
    ]
    const putRes = await PUT(mockPutRequest({ customCatalogs: catalogs }) as unknown as NextRequest)
    expect(putRes.status).toBe(200)
    const getRes = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const data = await getRes.json()
    expect(data.customCatalogs?.[0]).toMatchObject({ datasetId: "ds_abc123" })
  })

  it("invalidates poster and catalog cache after saving defaults", async () => {
    delete process.env.ADMIN_TOKEN
    cacheSet("poster:movie:1", "poster", ["poster"])
    cacheSet("catalog:movie:top", "catalog", ["catalog"])
    cacheSet("tmdb:search:avatar", "search", ["tmdb"])

    const req = mockPutRequest({ badgeStyle: "bar" })
    const res = await PUT(req as unknown as NextRequest)

    expect(res.status).toBe(200)
    expect(cacheGet("poster:movie:1")).toBeNull()
    expect(cacheGet("catalog:movie:top")).toBeNull()
    expect(cacheGet("tmdb:search:avatar")).toBe("search")
  })

  it("merge: un payload parziale preserva i default già salvati", async () => {
    delete process.env.ADMIN_TOKEN
    await PUT(mockPutRequest({ badgeStyle: "bar", gradientHeight: 40 }) as unknown as NextRequest)

    const res = await PUT(mockPutRequest({ gradientHeight: 55 }) as unknown as NextRequest)
    expect(res.status).toBe(200)

    const resGet = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const body = (await resGet.json()) as Record<string, unknown>
    expect(body.badgeStyle).toBe("bar")
    expect(body.gradientHeight).toBe(55)
  })

  it("GET reloads global defaults saved by another instance", async () => {
    await setServerDefaults({ blurIntensity: 20 })
    await fsp.writeFile(path.join(DATA_DIR, "defaults.json"), JSON.stringify({ blurIntensity: 77 }))
    await bumpCatalogEpoch()

    const res = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    expect((await res.json()).blurIntensity).toBe(77)
  })

  it("partial PUT preserves global defaults saved by another instance", async () => {
    await setServerDefaults({ blurIntensity: 20 })
    await fsp.writeFile(path.join(DATA_DIR, "defaults.json"), JSON.stringify({ blurIntensity: 77, badgeStyle: "pill" }))
    await bumpCatalogEpoch()

    const res = await PUT(mockPutRequest({ gradientHeight: 55 }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const stored = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "defaults.json"), "utf-8"))
    expect(stored).toMatchObject({ blurIntensity: 77, badgeStyle: "pill", gradientHeight: 55 })
  })

  it("persists gradient tuning including tintStrength", async () => {
    delete process.env.ADMIN_TOKEN
    const res = await PUT(mockPutRequest({ gradientHeight: 40, tintStrength: 60 }) as unknown as NextRequest)
    expect(res.status).toBe(200)

    const resGet = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const body = (await resGet.json()) as Record<string, unknown>
    expect(body.gradientHeight).toBe(40)
    expect(body.tintStrength).toBe(60)
  })

  it("rejects invalid tintStrength instead of silently stripping it", async () => {
    delete process.env.ADMIN_TOKEN
    // Senza il campo nello schema, zod stripperebbe la chiave e il PUT
    // risponderebbe 200 scartando il valore (bug tinta non salvata).
    const res = await PUT(mockPutRequest({ tintStrength: "hot" }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("accepts a valid custom rating endpoint and rejects unsafe ones", async () => {
    delete process.env.ADMIN_TOKEN
    const ok = await PUT(mockPutRequest({ customRatingEndpoint: "https://example.com/ratings/{imdbId}" }) as unknown as NextRequest)
    expect(ok.status).toBe(200)
    for (const bad of [
      "https://example.com/ratings/no-placeholder",
      "file:///ratings/{imdbId}",
      "https://user:pass@example.com/{imdbId}",
      "not a url {imdbId}",
    ]) {
      const res = await PUT(mockPutRequest({ customRatingEndpoint: bad }) as unknown as NextRequest)
      expect(res.status).toBe(400)
    }
  })

  it("accepts and returns the landscape blur profile, rejects mistyped keys", async () => {
    delete process.env.ADMIN_TOKEN
    const res = await PUT(
      mockPutRequest({ landscape: { blurFade: 70, gradientHeight: 20, blurEnabled: true, tintStrength: 80, topShade: 10 } }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)

    const resGet = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const body = (await resGet.json()) as Record<string, { blurFade?: number; gradientHeight?: number; tintStrength?: number; topShade?: number }>
    expect(body.landscape).toMatchObject({ blurFade: 70, gradientHeight: 20, tintStrength: 80, topShade: 10 })

    const bad = await PUT(mockPutRequest({ landscape: { blurFade: "much" } }) as unknown as NextRequest)
    expect(bad.status).toBe(400)
  })

  it("persists valid flat and landscape fresh posterLayout through PUT", async () => {
    delete process.env.ADMIN_TOKEN
    // Single PUT (the shared "defaults" rate-limit bucket caps the whole
    // file at 30 requests): one body covers both the flat key and the
    // landscape profile. Persistence is verified on the stored file, like
    // the "partial PUT preserves global defaults" test below — no extra
    // GET request spent.
    const res = await PUT(
      mockPutRequest({ posterLayout: "fresh", landscape: { posterLayout: "fresh" } }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)

    const stored = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "defaults.json"), "utf-8"))
    expect(stored).toMatchObject({ posterLayout: "fresh", landscape: { posterLayout: "fresh" } })
  })

  it("rejects an invalid posterLayout instead of silently stripping it", async () => {
    delete process.env.ADMIN_TOKEN
    // Without the enum in the schema, zod would strip the keys and the PUT
    // would answer 200 while dropping the values. Single body covers both
    // the flat key and the landscape profile (either stripped key alone
    // would still yield 200 under the stripping bug).
    const res = await PUT(
      mockPutRequest({ posterLayout: "bogus", landscape: { posterLayout: "bogus" } }) as unknown as NextRequest,
    )
    expect(res.status).toBe(400)
  })
})

describe("GET /api/defaults hasInstanceKeys", () => {
  const KEY_ENVS = ["PICTORIUM_TMDB_KEY", "POSTERIUM_TMDB_KEY", "TMDB_KEY", "TMDB_API_KEY"] as const
  let saved: Record<string, string | undefined>

  function mockGetRequest(headers?: Record<string, string>): Request {
    return new Request("http://localhost:3000/api/defaults", { headers })
  }

  beforeEach(() => {
    saved = {}
    for (const k of KEY_ENVS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    delete process.env.ADMIN_TOKEN
  })

  afterEach(() => {
    for (const k of KEY_ENVS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    delete process.env.ADMIN_TOKEN
  })

  it("exposes only booleans publicly, never key values (no leak)", async () => {
    process.env.PICTORIUM_TMDB_KEY = "secret-instance-key"
    const res = await GET(mockGetRequest() as unknown as NextRequest)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.hasInstanceKeys).toMatchObject({ tmdbKey: true, mdblistKey: false, tvdbKey: false })
    expect(body).not.toHaveProperty("serverKeys")
    expect(JSON.stringify(body)).not.toContain("secret-instance-key")
  })

  it("reports false when no instance key is configured", async () => {
    const res = await GET(mockGetRequest() as unknown as NextRequest)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.hasInstanceKeys).toMatchObject({ tmdbKey: false, mdblistKey: false, tvdbKey: false })
    expect(body).not.toHaveProperty("serverKeys")
  })

  it("still exposes values to an authenticated admin", async () => {
    process.env.PICTORIUM_TMDB_KEY = "secret-instance-key"
    process.env.ADMIN_TOKEN = "secret-token"
    const res = await GET(
      mockGetRequest({ "x-admin-token": "secret-token" }) as unknown as NextRequest,
    )
    const body = (await res.json()) as Record<string, unknown>
    expect(body.hasInstanceKeys).toMatchObject({ tmdbKey: true })
    expect(body).toHaveProperty("serverKeys")
    expect((body.serverKeys as Record<string, unknown>).tmdbKey).toBe("secret-instance-key")
  })
})
