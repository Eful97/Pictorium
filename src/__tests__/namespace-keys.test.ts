import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TMDB_KEY",
  "TMDB_KEY",
  "TMDB_API_KEY",
  "PICTORIUM_MDBLIST_KEY",
  "MDBLIST_KEY",
  "MDBLIST_API_KEY",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

const NS_TMDB_KEY = "ns-tmdb-key-12345"

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-nskeys-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function nextReq(url: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, init)
}

function tmdbSearchPayload() {
  return {
    results: [{ id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg", release_date: "1999-10-15" }],
    page: 1,
    total_pages: 1,
    total_results: 1,
  }
}

describe("chiavi namespace sulle route proxy (?u=)", () => {
  it("resolveRouteApiKey: ?u= + token → chiave profilo; senza → undefined", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const keys = await import("@/lib/user-keys")
    const tmdb = await import("@/lib/tmdb")
    const { uuid, secret } = await auth.createUser()
    await keys.setUserKeys(uuid, { tmdb: NS_TMDB_KEY })

    const withUser = await tmdb.resolveRouteApiKey(
      nextReq(`http://x/api/tmdb/search?q=x&u=${uuid}`, { headers: { "x-user-token": secret } }),
    )
    expect(withUser).toBe(NS_TMDB_KEY)

    // Senza ?u= e senza env: niente chiave (come prima del fix).
    const withoutUser = await tmdb.resolveRouteApiKey(nextReq("http://x/api/tmdb/search?q=x"))
    expect(withoutUser).toBeUndefined()
  })

  it("GET /api/tmdb/search usa la chiave profilo e risponde risultati", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const keys = await import("@/lib/user-keys")
    const { uuid, secret } = await auth.createUser()
    await keys.setUserKeys(uuid, { tmdb: NS_TMDB_KEY })

    const outbound: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      outbound.push(String(url))
      return new Response(JSON.stringify(tmdbSearchPayload()), { status: 200 })
    }))

    const route = await import("@/app/api/tmdb/search/route")
    const res = await route.GET(nextReq(`http://x/api/tmdb/search?q=fight+club&u=${uuid}`, { headers: { "x-user-token": secret } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total_results).toBe(1)
    // L'upstream TMDB ha visto la chiave del namespace, mai quella vuota.
    expect(outbound.length).toBeGreaterThan(0)
    expect(outbound[0]).toContain(`api_key=${NS_TMDB_KEY}`)
  })

  it("senza ?u= e senza chiavi: 401 chiave mancante, nessun upstream (contratto esplicito)", async () => {
    vi.resetModules()
    const spy = vi.fn(async () => new Response(JSON.stringify(tmdbSearchPayload()), { status: 200 }))
    vi.stubGlobal("fetch", spy)
    const route = await import("@/app/api/tmdb/search/route")
    const res = await route.GET(nextReq("http://x/api/tmdb/search?q=fight+club+xyz"))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: "search_missing_key" })
    expect(spy).not.toHaveBeenCalled()
  })
})
