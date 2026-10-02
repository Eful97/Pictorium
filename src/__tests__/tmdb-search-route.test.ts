import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tmdb/search/route"
import { __clearTMDBCache } from "@/lib/tmdb"

const ENV_KEYS = ["PICTORIUM_TMDB_KEY", "POSTERIUM_TMDB_KEY", "TMDB_BASE_URL"] as const
let savedEnv: Record<string, string | undefined> = {}

function req(url: string): NextRequest {
  return new NextRequest(url)
}

function payload(results: unknown[]) {
  return { results, page: 1, total_pages: 3, total_results: 60 }
}

describe("GET /api/tmdb/search", () => {
  beforeEach(() => {
    savedEnv = {}
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    for (const k of ENV_KEYS) delete process.env[k]
    __clearTMDBCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    __clearTMDBCache()
    vi.unstubAllGlobals()
  })

  it("query vuota/corta: 200 vuoto senza chiave, cache o upstream", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", spy)
    for (const q of ["", "x", "  "]) {
      const res = await GET(req(`http://x/api/tmdb/search?q=${encodeURIComponent(q)}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ results: [], total_results: 0, total_pages: 0 })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it("chiave mancante: 401 tipizzato, nessun upstream", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(payload([])), { status: 200 }))
    vi.stubGlobal("fetch", spy)
    const res = await GET(req("http://x/api/tmdb/search?q=chiaveassente1"))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: "search_missing_key" })
    expect(spy).not.toHaveBeenCalled()
  })

  it("chiave invalida (upstream 401): 401 tipizzato senza segreti", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })))
    const res = await GET(req("http://x/api/tmdb/search?q=chiaveinvalida1&api_key=bad-key-1"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe("search_invalid_key")
    expect(JSON.stringify(body)).not.toContain("bad-key-1")
  })

  it("upstream in errore: 502 indisponibile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })))
    const res = await GET(req("http://x/api/tmdb/search?q=upstreamko1&api_key=good-key-2"))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: "search_unavailable" })
  })

  it("pagina invalida: 400 senza upstream", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(payload([])), { status: 200 }))
    vi.stubGlobal("fetch", spy)
    for (const page of ["abc", "-1", "0", "2.5", "501", ""]) {
      const res = await GET(req(`http://x/api/tmdb/search?q=paginainvalida1&api_key=good-key-3&page=${page}`))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: "search_invalid_page" })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it("successo: include i senza poster, esclude le persone, riusa la cache", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(payload([
      { id: 1, media_type: "movie", title: "Con poster", poster_path: "/a.jpg" },
      { id: 2, media_type: "tv", name: "Senza poster", poster_path: null },
      { id: 3, media_type: "person", name: "Attore", poster_path: "/b.jpg" },
    ])), { status: 200 }))
    vi.stubGlobal("fetch", spy)
    const url = "http://x/api/tmdb/search?q=cachehit1&api_key=good-key-4"
    const first = await GET(req(url))
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.results.map((r: { id: number }) => r.id)).toEqual([1, 2])
    // Cache hit: secondo passaggio senza upstream
    const second = await GET(req(url))
    expect(second.status).toBe(200)
    expect((await second.json()).results).toHaveLength(2)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
