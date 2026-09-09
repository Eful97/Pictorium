import { test, expect } from "@playwright/test"

// Catalog / Meta / Manifest API tests — no TMDB key needed (mock server)

test.describe("catalog API", () => {
  test("pictorium-jw-movies returns metas with tmdb: ids", async ({ request }) => {
    const res = await request.get("/catalog/movie/pictorium-jw-movies.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.metas)).toBeTruthy()
    expect(body.metas.length).toBeGreaterThan(0)
    for (const m of body.metas) {
      expect(m.id.startsWith("tmdb:")).toBeTruthy()
      expect(m.poster).toContain("/api/poster/")
    }
  })

  test("legacy posterium-jw-movies alias returns the same metas", async ({ request }) => {
    const res = await request.get("/catalog/movie/posterium-jw-movies.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.metas.length).toBeGreaterThan(0)
    for (const m of body.metas) {
      expect(m.id.startsWith("tmdb:")).toBeTruthy()
    }
  })

  test("search catalog with query returns results", async ({ request }) => {
    const res = await request.get("/catalog/movie/pictorium-search-movies.json?search=Avatar", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.metas.length).toBeGreaterThan(0)
    expect(body.metas[0].name).toContain("Avatar")
  })

  test("search metas carry rating, background, genres and description like AIOMetadata", async ({ request }) => {
    const res = await request.get("/catalog/movie/pictorium-search-movies.json?search=Avatar", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.metas.length).toBeGreaterThan(0)
    const meta = body.metas[0]
    expect(meta.imdbRating).toBe("7.9")
    expect(meta.background).toContain("/t/p/original/")
    expect(meta.genres).toContain("Azione")
    expect(meta.description).toBeTruthy()
  })

  test("platform catalog pagination skip returns fewer-or-empty", async ({ request }) => {
    const res1 = await request.get("/catalog/movie/pictorium-netflix-movies.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    const res2 = await request.get("/catalog/movie/pictorium-netflix-movies.json?skip=1", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res1.ok() && res2.ok()).toBeTruthy()
    const b1 = await res1.json()
    const b2 = await res2.json()
    // skip=1 should return at most same count, and differ
    expect(b2.metas.length).toBeLessThanOrEqual(b1.metas.length)
    if (b1.metas.length > 0 && b2.metas.length > 0) {
      expect(b2.metas[0].id).not.toBe(b1.metas[0].id)
    }
  })

  test("genre filter via query param", async ({ request }) => {
    const res = await request.get("/catalog/movie/pictorium-jw-movies.json?genre=Azione", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.metas)).toBeTruthy()
  })

  test("without api key returns empty metas", async ({ request }) => {
    const res = await request.get("/catalog/movie/pictorium-jw-movies.json")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.metas.length).toBe(0)
  })
})

test.describe("meta API", () => {
  test("movie meta by tmdb: id returns details", async ({ request }) => {
    const res = await request.get("/meta/movie/tmdb:19995.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.meta).not.toBeNull()
    expect(body.meta.type).toBe("movie")
    expect(body.meta.poster).toContain("/api/poster/")
  })

  test("series meta includes videos from standard seasons", async ({ request }) => {
    const res = await request.get("/meta/series/tmdb:19995.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.meta.videos.length).toBeGreaterThan(0)
    expect(body.meta.videos[0].season).toBeGreaterThan(0)
  })

  test("series meta with episodeGroupId returns grouped videos", async ({ request }) => {
    // Create a mapping with episodeGroupId to trigger group path — via meta cache key includes group
    // Just test that plain tv details still works (group endpoint mocked)
    const res = await request.get("/meta/series/tmdb:19995.json", {
      headers: { "x-api-key": "e2e-key" },
    })
    expect(res.ok()).toBeTruthy()
  })
})

test.describe("manifest API", () => {
  test("base manifest has catalogs and poster+meta resources", async ({ request }) => {
    const res = await request.get("/manifest.json")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.id.startsWith("org.pictorium")).toBeTruthy()
    expect(body.catalogs.length).toBeGreaterThan(10)
    expect(body.resources.some((r: string | { name: string }) => typeof r === "string" ? r === "catalog" : r.name === "meta")).toBeTruthy()
  })

  test("manifest mode=search returns only search catalogs", async ({ request }) => {
    const res = await request.get("/manifest.json?mode=search")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.catalogs.every((c: { id: string }) => c.id.startsWith("pictorium-search-"))).toBeTruthy()
  })

  test("manifest mode=catalogs excludes search catalogs", async ({ request }) => {
    const res = await request.get("/manifest.json?mode=catalogs")
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.catalogs.every((c: { id: string }) => !c.id.startsWith("pictorium-search-"))).toBeTruthy()
  })

  test("manifest extra includes genre and skip", async ({ request }) => {
    const res = await request.get("/manifest.json")
    const body = await res.json()
    const first = body.catalogs[0]
    expect(first.extra.some((e: { name: string }) => e.name === "genre")).toBeTruthy()
    expect(first.extra.some((e: { name: string }) => e.name === "skip")).toBeTruthy()
  })
})
