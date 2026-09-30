import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchUnifiedCatalogResult, __resetTvdbTokenCache } from "@/lib/custom-catalog-providers"

function jsonRes(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => payload,
  }
}

describe("fetchUnifiedCatalogResult statuses", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    __resetTvdbTokenCache()
    process.env.PICTORIUM_TRAKT_CLIENT_ID = "test-trakt-client-id"
    delete process.env.TRAKT_API_URL
    delete process.env.TVDB_API_URL
  })

  it("maps Trakt outcomes to distinct statuses", async () => {
    const byStatus = (status: number) => {
      global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes(status, []))) as unknown as typeof fetch
    }
    byStatus(401)
    expect((await fetchUnifiedCatalogResult("https://trakt.tv/users/u/lists/trakt-st-private")).status).toBe("private")
    byStatus(404)
    expect((await fetchUnifiedCatalogResult("https://trakt.tv/users/u/lists/trakt-st-missing")).status).toBe("not_found")
    byStatus(429)
    expect((await fetchUnifiedCatalogResult("https://trakt.tv/users/u/lists/trakt-st-limited")).status).toBe("rate_limited")
    expect(await fetchUnifiedCatalogResult("https://trakt.tv/users/u/watchlist")).toMatchObject({ status: "unsupported", items: [] })
  })

  it("reports key_missing for Trakt without a client ID", async () => {
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    global.fetch = vi.fn(() => Promise.reject(new Error("must not fetch"))) as unknown as typeof fetch
    const res = await fetchUnifiedCatalogResult("https://trakt.tv/users/u/lists/trakt-st-nokey")
    expect(res).toMatchObject({ status: "key_missing", items: [] })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("distinguishes Letterboxd errors", async () => {
    const headWith = (identifier: string | null, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(identifier ? { "x-letterboxd-identifier": identifier } : {}),
    })
    // HEAD 404 → not_found.
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(headWith(null, 404))) as unknown as typeof fetch
    expect((await fetchUnifiedCatalogResult("https://letterboxd.com/u/list/lb-st-404")).status).toBe("not_found")
    // HEAD 403 → private.
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(headWith(null, 403))) as unknown as typeof fetch
    expect((await fetchUnifiedCatalogResult("https://letterboxd.com/u/list/lb-st-private")).status).toBe("private")
    // HEAD network fail → unavailable.
    global.fetch = vi.fn().mockImplementation(() => Promise.reject(new Error("down"))) as unknown as typeof fetch
    expect((await fetchUnifiedCatalogResult("https://letterboxd.com/u/list/lb-st-down")).status).toBe("unavailable")
    // StremThru 429 → rate_limited; empty items → empty.
    global.fetch = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "HEAD") return Promise.resolve(headWith("1XEE4"))
      return Promise.resolve(jsonRes(429, {}))
    }) as unknown as typeof fetch
    expect((await fetchUnifiedCatalogResult("https://letterboxd.com/u/list/lb-st-limited")).status).toBe("rate_limited")
    global.fetch = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "HEAD") return Promise.resolve(headWith("1XEE4"))
      return Promise.resolve(jsonRes(200, { data: { items: [] } }))
    }) as unknown as typeof fetch
    expect(await fetchUnifiedCatalogResult("https://letterboxd.com/u/list/lb-st-empty")).toMatchObject({ status: "empty", items: [] })
  })

  it("maps IMDb dataset outcomes (ok / not_found / unsupported)", async () => {
    expect(await fetchUnifiedCatalogResult("https://www.imdb.com/list/ls000000001/")).toMatchObject({
      status: "unsupported",
      items: [],
    })
    expect(await fetchUnifiedCatalogResult("imdb-csv:ds_doesnotexist")).toMatchObject({
      status: "not_found",
      items: [],
    })
  })
})

describe("TVDB lists via official v4 API (BYOK)", () => {
  const URL = "https://thetvdb.com/lists/tvdb-test-list"

  beforeEach(() => {
    vi.restoreAllMocks()
    __resetTvdbTokenCache()
  })

  function mockTvdb(opts: {
    loginStatus?: number
    slugStatus?: number
    slugId?: number
    extStatus?: number
    entities?: Array<{ movieId?: number; seriesId?: number }>
    expireFirstGet?: boolean
  } = {}) {
    const { loginStatus = 200, slugStatus = 200, slugId = 42, extStatus = 200, entities = [], expireFirstGet = false } = opts
    const calls: string[] = []
    let gets = 0
    global.fetch = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
      calls.push(`${init?.method || "GET"} ${String(url)}`)
      if (String(url).endsWith("/login")) {
        return Promise.resolve(jsonRes(loginStatus, loginStatus === 200 ? { data: { token: "tok123" } } : {}))
      }
      if (String(url).includes("/lists/slug/")) {
        return Promise.resolve(jsonRes(slugStatus, slugStatus === 200 ? { data: { id: slugId, name: "L" } } : {}))
      }
      if (String(url).includes("/lists/42/extended")) {
        gets++
        if (expireFirstGet && gets === 1) return Promise.resolve(jsonRes(401, {}))
        return Promise.resolve(jsonRes(extStatus, extStatus === 200 ? { data: { id: 42, entities } } : {}))
      }
      return Promise.resolve(jsonRes(404, {}))
    }) as unknown as typeof fetch
    return calls
  }

  it("fetches a mixed list with the user key and keeps tvdb-only items", async () => {
    const calls = mockTvdb({ entities: [{ movieId: 123 }, { seriesId: 456 }, { movieId: 123 }] })
    const res = await fetchUnifiedCatalogResult(URL, { tvdbKey: "user-tvdb-key" })
    expect(res.status).toBe("ok")
    expect(res.items.length).toBe(2)
    expect(res.items[0]).toMatchObject({ tvdb: 123, mediatype: "movie" })
    expect(res.items[1]).toMatchObject({ tvdb: 456, mediatype: "tv" })
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/login"))).toBe(true)
    expect(calls.some((c) => c.includes("/lists/slug/tvdb-test-list"))).toBe(true)
    // Mai la chiave in chiaro nei log/URL: login body is POST, URLs carry none.
    expect(calls.some((c) => c.includes("user-tvdb-key"))).toBe(false)
  })

  it("reports key_missing without a key and never hits the network", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("must not fetch"))) as unknown as typeof fetch
    const res = await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-nokey")
    expect(res).toMatchObject({ status: "key_missing", items: [] })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("reports key_missing for a disabled key (login 401)", async () => {
    mockTvdb({ loginStatus: 401 })
    const res = await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-badkey", { tvdbKey: "bad" })
    expect(res).toMatchObject({ status: "key_missing", items: [] })
  })

  it("retries once after an expired token", async () => {
    const calls = mockTvdb({ entities: [{ seriesId: 7 }], expireFirstGet: true })
    const res = await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-expired", { tvdbKey: "k" })
    expect(res.status).toBe("ok")
    expect(res.items[0]).toMatchObject({ tvdb: 7 })
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(2)
  })

  it("maps slug/item failures distinctly", async () => {
    mockTvdb({ slugStatus: 404 })
    expect((await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-404", { tvdbKey: "k" })).status).toBe("not_found")
    __resetTvdbTokenCache()
    mockTvdb({ slugStatus: 403 })
    expect((await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-403", { tvdbKey: "k" })).status).toBe("private")
    __resetTvdbTokenCache()
    mockTvdb({ extStatus: 429 })
    expect((await fetchUnifiedCatalogResult("https://thetvdb.com/lists/tvdb-st-429", { tvdbKey: "k" })).status).toBe("rate_limited")
  })

  it("isolates cache entries per TVDB key", async () => {
    const mkEntities = (id: number) => [{ seriesId: id }]
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith("/login")) return Promise.resolve(jsonRes(200, { data: { token: "t" } }))
      if (String(url).includes("/lists/slug/")) return Promise.resolve(jsonRes(200, { data: { id: 42 } }))
      return Promise.resolve(jsonRes(200, { data: { id: 42, entities: mkEntities(900) } }))
    }) as unknown as typeof fetch
    const url = "https://thetvdb.com/lists/tvdb-st-iso"
    const one = await fetchUnifiedCatalogResult(url, { tvdbKey: "KEY-A" })
    const two = await fetchUnifiedCatalogResult(url, { tvdbKey: "KEY-B" })
    expect(one.status).toBe("ok")
    expect(two.status).toBe("ok")
    // Chiavi diverse → login separati (nessun riuso incrociato del token).
    const logins = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
      String(c[0]).endsWith("/login"),
    )
    expect(logins.length).toBe(2)
  })
})
