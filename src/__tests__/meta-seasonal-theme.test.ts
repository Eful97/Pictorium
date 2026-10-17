/**
 * /meta forwards an explicit ephemeral `theme=` to the saved/default poster
 * builder (both shapes via the shared builder): themed portrait AND
 * landscape posters carry theme=<tema>, unthemed /meta stays byte-identical.
 * No catalog inference in /meta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const epochCtl = vi.hoisted(() => ({ value: "e-meta-theme" }))
vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => epochCtl.value),
  bumpCatalogEpoch: vi.fn(async () => epochCtl.value),
}))

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return { ...mod, enrichVideosWithTvdb: vi.fn(), enrichVideosWithTvdbDetailed: vi.fn(async () => true) }
})

const mockedGetById = vi.mocked(getById)

describe("GET /meta theme forwarding (explicit only)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    cacheClear()
    __clearTMDBCache()
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
  })

  function mockTitle() {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: 550, title: "Fight Club", external_ids: { imdb_id: "tt0137523" } }))
      .mockResolvedValueOnce(Response.json({ id: 550, logos: [] }))
  }

  it("themed portrait /meta carries theme=halloween in the poster", async () => {
    mockTitle()
    const req = new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k&theme=halloween")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) })
    const { meta } = await res.json()
    expect(new URL(meta.poster).searchParams.get("theme")).toBe("halloween")
  })

  it("themed portrait /meta carries theme=christmas in the poster", async () => {
    mockTitle()
    const req = new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k&theme=christmas")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) })
    const { meta } = await res.json()
    expect(new URL(meta.poster).searchParams.get("theme")).toBe("christmas")
  })

  it("unthemed /meta has no theme (legacy-identical) and invalid collapses onto it", async () => {
    mockTitle()
    const plain = await (await GET(
      new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k"),
      { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) },
    )).json()
    cacheClear()
    __clearTMDBCache()
    mockTitle()
    const garbage = await (await GET(
      new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k&theme=easter"),
      { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) },
    )).json()
    expect(new URL(plain.meta.poster).searchParams.has("theme")).toBe(false)
    expect(new URL(garbage.meta.poster).searchParams.has("theme")).toBe(false)
    expect(garbage.meta.poster).toBe(plain.meta.poster)
  })

  it("landscape carries the explicit theme with its own asset", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "landscape" })
    mockTitle()
    const req = new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k&theme=halloween")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) })
    const { meta } = await res.json()
    expect(meta.posterShape).toBe("landscape")
    expect(new URL(meta.poster).searchParams.get("theme")).toBe("halloween")
    cacheClear()
    __clearTMDBCache()
    mockTitle()
    const xmas = await GET(
      new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=k&theme=christmas"),
      { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) },
    )
    const { meta: xmeta } = await xmas.json()
    expect(new URL(xmeta.poster).searchParams.get("theme")).toBe("christmas")
  })
})
