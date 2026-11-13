/**
 * Poster route id parsing for Nuvio's `{tmdb_id|imdb_id|id}` template:
 * anime-native ids resolve via the local snapshot (same targets as the addon
 * proxy, zero network), `tvdb:`/`tvdbc:` via TMDB find, misses stay 400.
 * `getById` is the first call after id resolution: it records the resolved
 * (mediaType, tmdbId) and aborts the render.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { tmdbFindByTvdb } from "@/lib/tmdb"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))
vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))
vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tmdb")>(),
  tmdbFindByTvdb: vi.fn(async () => null),
}))

const STOP = new Error("resolved")
const mockedGetById = vi.mocked(getById)

async function resolveVia(type: string, id: string): Promise<{ status: number } | { mediaType: unknown; tmdbId: unknown }> {
  mockedGetById.mockReset()
  mockedGetById.mockRejectedValue(STOP)
  const req = new NextRequest(`http://localhost:3000/api/poster/${type}/${id}?api_key=k`)
  try {
    const res = await GET(req, { params: Promise.resolve({ type, id }) })
    return { status: res.status }
  } catch (err) {
    if (err !== STOP) throw err
    const [mediaType, tmdbId] = mockedGetById.mock.calls[0]
    return { mediaType, tmdbId }
  }
}

describe("poster route — anime / tvdb ids", () => {
  beforeEach(() => vi.mocked(tmdbFindByTvdb).mockReset())

  it("resolves anilist:/kitsu: ids to the snapshot TMDB target", async () => {
    expect(await resolveVia("series", "anilist:290")).toEqual({ mediaType: "tv", tmdbId: 26209 })
    expect(await resolveVia("series", "kitsu:123")).toEqual({ mediaType: "tv", tmdbId: 36837 })
    expect(await resolveVia("movie", "anilist:164")).toEqual({ mediaType: "movie", tmdbId: 128 })
  })

  it("keeps 400 on miss, ambiguity and side mismatch", async () => {
    expect(await resolveVia("series", "anilist:999999999")).toEqual({ status: 400 })
    expect(await resolveVia("movie", "anilist:11441")).toEqual({ status: 400 })
    expect(await resolveVia("series", "anilist:164")).toEqual({ status: 400 })
  })

  it("resolves tvdb:/tvdbc: via TMDB find, 400 when not found", async () => {
    vi.mocked(tmdbFindByTvdb).mockResolvedValueOnce(1399)
    expect(await resolveVia("series", "tvdb:121361")).toEqual({ mediaType: "tv", tmdbId: 1399 })
    expect(vi.mocked(tmdbFindByTvdb).mock.calls[0].slice(0, 2)).toEqual(["121361", "tv"])
    vi.mocked(tmdbFindByTvdb).mockRejectedValueOnce(new Error("no key"))
    expect(await resolveVia("series", "tvdbc:5")).toEqual({ status: 400 })
  })

  it("leaves tmdb: and numeric paths unchanged", async () => {
    expect(await resolveVia("movie", "tmdb:550")).toEqual({ mediaType: "movie", tmdbId: 550 })
    expect(await resolveVia("series", "1399")).toEqual({ mediaType: "tv", tmdbId: 1399 })
    expect(vi.mocked(tmdbFindByTvdb)).not.toHaveBeenCalled()
  })
})
