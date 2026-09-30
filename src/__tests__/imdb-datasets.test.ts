import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
    userRateLimitKey: (req: NextRequest) => `test-imdb-${new URL(req.url).searchParams.get("u")}`,
  }
})

const BASE = "http://localhost:3000/api/mdblist/custom-imdb"

function postRequest(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const CSV = [
  "Const,Title,Year,Title Type",
  "tt0371746,Iron Man,2008,Feature Film",
  "tt0903747,Breaking Bad,2008,TV Series",
].join("\n")

describe("POST /api/mdblist/custom-imdb", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-imdb-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tempDir)
    vi.resetModules()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it("imports a valid CSV and persists the dataset for later reads", async () => {
    const { POST } = await import("@/app/api/mdblist/custom-imdb/route")
    const res = await POST(postRequest({ csv: CSV, name: "My List" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.itemCount).toBe(2)
    expect(json.datasetId).toMatch(/^ds_/)
    expect(json.sample[0]).toMatchObject({ title: "Iron Man" })

    // Persistenza: rilettura dallo store e via provider.
    const { getImdbDataset } = await import("@/lib/imdb-datasets")
    const stored = await getImdbDataset(json.datasetId, null)
    expect(stored?.itemCount).toBe(2)
    expect(stored?.items[1]).toMatchObject({ imdb: "tt0903747", mediatype: "tv" })

    const { fetchUnifiedCatalogItems } = await import("@/lib/custom-catalog-providers")
    const items = await fetchUnifiedCatalogItems(`imdb-csv:${json.datasetId}`, { limit: 500 })
    expect(items.length).toBe(2)
    expect(items[0]).toMatchObject({ imdb: "tt0371746", tmdb: undefined })
  })

  it("reads a dataset through the saved catalog url + datasetId option", async () => {
    const { saveImdbDataset } = await import("@/lib/imdb-datasets")
    const ds = await saveImdbDataset(
      "Via URL",
      [{ imdb: "tt0111161", title: "Shawshank", year: 1994, mediatype: "movie" }],
      { userId: null },
    )
    const { fetchUnifiedCatalogItems } = await import("@/lib/custom-catalog-providers")
    const items = await fetchUnifiedCatalogItems("https://www.imdb.com/list/ls123456789/", {
      datasetId: ds.id,
    })
    expect(items.length).toBe(1)
    expect(items[0].imdb).toBe("tt0111161")
  })

  it("returns [] for bare IMDb URLs without a dataset (no scraping)", async () => {
    const { fetchUnifiedCatalogItems } = await import("@/lib/custom-catalog-providers")
    global.fetch = vi.fn(() => Promise.reject(new Error("must not fetch"))) as unknown as typeof fetch
    try {
      const items = await fetchUnifiedCatalogItems("https://www.imdb.com/list/ls123456789/")
      expect(items).toEqual([])
      expect(global.fetch).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it("rejects empty and invalid CSV with 400 codes", async () => {
    const { POST } = await import("@/app/api/mdblist/custom-imdb/route")
    const empty = await POST(postRequest({ csv: "", name: "x" }))
    expect(empty.status).toBe(400)
    const bad = await POST(postRequest({ csv: "Title,Year\nIron Man,2008\n", name: "x" }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: "no_const_column" })
  })

  it("rejects oversized CSV with 413 and enforces the per-scope quota", async () => {
    const { POST } = await import("@/app/api/mdblist/custom-imdb/route")
    const big = await POST(postRequest({ csv: "x".repeat(2_000_001), name: "x" }))
    // Body oltre il cap JSON o parser too_large: in entrambi i casi 413.
    expect(big.status).toBe(413)

    const { saveImdbDataset, MAX_DATASETS_PER_SCOPE } = await import("@/lib/imdb-datasets")
    const one = [{ imdb: "tt0371746", title: "Iron Man", year: 2008, mediatype: "movie" as const }]
    for (let i = 0; i < MAX_DATASETS_PER_SCOPE; i++) {
      await saveImdbDataset(`D${i}`, one, { userId: null })
    }
    const over = await POST(postRequest({ csv: CSV, name: "over" }))
    expect(over.status).toBe(413)
    expect(await over.json()).toMatchObject({ error: "quota_exceeded" })
  })

  it("isolates datasets between scopes and validates preview GET", async () => {
    const userA = "11111111-1111-4111-8111-111111111111"
    const { saveImdbDataset } = await import("@/lib/imdb-datasets")
    const ds = await saveImdbDataset(
      "Scoped",
      [{ imdb: "tt0371746", title: "Iron Man", year: 2008, mediatype: "movie" as const }],
      { userId: userA },
    )
    const { getImdbDataset } = await import("@/lib/imdb-datasets")
    // Altro scope: miss.
    expect(await getImdbDataset(ds.id, null)).toBeNull()
    expect(await getImdbDataset(ds.id, userA)).not.toBeNull()

    const { GET } = await import("@/app/api/mdblist/custom-imdb/route")
    const scoped = await GET(new NextRequest(`${BASE}?dataset=${ds.id}&u=${userA}`))
    expect(scoped.status).toBe(200)
    const json = await scoped.json()
    expect(json.total).toBe(1)
    expect(json.items[0]).toMatchObject({ title: "Iron Man", media_type: "movie" })

    const other = await GET(new NextRequest(`${BASE}?dataset=${ds.id}`))
    expect(await other.json()).toMatchObject({ items: [] })
  })

  it("loads scoped CSV catalogs through the general preview route, including source URLs", async () => {
    const userA = "22222222-2222-4222-8222-222222222222"
    const { saveImdbDataset } = await import("@/lib/imdb-datasets")
    const ds = await saveImdbDataset("CSV preview", [{ imdb: "tt0371746", title: "Iron Man", year: 2008, mediatype: "movie" }], { userId: userA })
    const tmdb = await import("@/lib/tmdb")
    vi.spyOn(tmdb, "resolveRouteApiKey").mockResolvedValue(undefined)
    const { GET } = await import("@/app/api/mdblist/custom/route")
    for (const url of [`imdb-csv:${ds.id}`, "https://www.imdb.com/list/ls123456789/"]) {
      const params = new URLSearchParams({ url, dataset: ds.id, u: userA })
      const res = await GET(new NextRequest(`http://localhost:3000/api/mdblist/custom?${params}`))
      expect(await res.json()).toMatchObject({ total: 1, status: "ok", items: [{ title: "Iron Man" }] })
    }
    const missing = await GET(new NextRequest(`http://localhost:3000/api/mdblist/custom?url=imdb-csv:${ds.id}`))
    expect(await missing.json()).toMatchObject({ items: [], status: "not_found" })
  })

  it("requires authentication for dataset access through the general preview route", async () => {
    const userAuth = await import("@/lib/user-auth")
    vi.mocked(userAuth.checkUserAuth).mockResolvedValueOnce(false)
    const { GET } = await import("@/app/api/mdblist/custom/route")
    const res = await GET(new NextRequest("http://localhost:3000/api/mdblist/custom?url=imdb-csv:ds_test&u=22222222-2222-4222-8222-222222222222"))
    expect(res.status).toBe(401)
  })
})
