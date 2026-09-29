import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as GET_CATALOG } from "@/app/catalog/[type]/[id]/route"
import { GET as GET_META } from "@/app/meta/[type]/[id]/route"
import { fetchMDBList, MDBLIST_BLOCK_SIZE } from "@/lib/mdblist"
import { buildNoticeMeta, isNoticeId, NOTICE_ID_PREFIX } from "@/lib/notice-meta"
import { cacheClear, cacheInvalidate } from "@/lib/cache"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return { ...mod, getServerDefaults: vi.fn(() => ({})) }
})

const mockedGetById = vi.mocked(getById)

describe("notice cards (Fase 2: solo key-missing)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    cacheInvalidate("mdblist")
  })

  it("buildNoticeMeta usa id convenzionale e tipo richiesto", () => {
    const meta = buildNoticeMeta({ type: "series", poster: "http://localhost:3000/pictorium.png" })
    expect(meta.id.startsWith(NOTICE_ID_PREFIX)).toBe(true)
    expect(meta.type).toBe("series")
    expect(meta.poster).toContain("/pictorium.png")
    expect(isNoticeId(meta.id)).toBe(true)
    expect(isNoticeId("tmdb:123")).toBe(false)
  })

  it("catalogo JW senza chiave: notice card invece di metas vuoto", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json")
    const res = await GET_CATALOG(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id.startsWith(NOTICE_ID_PREFIX)).toBe(true)
    expect(body.metas[0].poster).toContain("/pictorium.png")
    expect(body.metas[0].poster).not.toContain("/api/poster/")
    // Nessuna chiamata upstream: il ramo key-missing ritorna prima di JW/TMDB.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("ricerca senza chiave: notice card invece di metas vuoto", async () => {
    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies.json?search=Avatar")
    const res = await GET_CATALOG(req, { params: Promise.resolve({ type: "movie", id: "pictorium-search-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id.startsWith(NOTICE_ID_PREFIX)).toBe(true)
  })

  it("/meta sulla notice: scheda informativa senza chiamate di rete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest("http://localhost:3000/meta/movie/pictorium:notice:missing-tmdb-key.json")
    const res = await GET_META(req, { params: Promise.resolve({ type: "movie", id: "pictorium:notice:missing-tmdb-key.json" }) })
    const body = await res.json()

    expect(body.meta).toMatchObject({
      id: "pictorium:notice:missing-tmdb-key",
      type: "movie",
    })
    expect(body.meta.poster).toContain("/pictorium.png")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("mdblist block-paging (Fase 1)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cacheInvalidate("mdblist")
  })

  it("richiede il blocco intero e non tronca a 20", async () => {
    const shows = Array.from({ length: 30 }, (_, i) => ({
      id: 1000 + i,
      title: `Anime ${i}`,
      imdb_id: `tt${String(9000000 + i)}`,
      release_year: 2024,
    }))
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ shows }))

    const items = await fetchMDBList("mdblistAnime", "block-test-key")

    expect(MDBLIST_BLOCK_SIZE).toBeGreaterThan(20)
    const calledUrl: string = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(calledUrl).toContain(`limit=${MDBLIST_BLOCK_SIZE}`)
    expect(items).toHaveLength(30)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
