import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Store KV in-memory: valida il cablaggio user-keys -> kv.ts -> @vercel/kv
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

const UUID_A = "11111111-1111-4111-8111-111111111111"
const NS_TMDB_KEY = "nstmdbkey1234567890"

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_MAX_MAPPINGS_PER_USER",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TMDB_KEY",
  "TMDB_KEY",
  "TMDB_API_KEY",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-userkeys-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  delete process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
  delete process.env.PICTORIUM_TMDB_KEY
  delete process.env.TMDB_KEY
  delete process.env.TMDB_API_KEY
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function nextReq(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(url, init)
}

describe("user-keys encryption", () => {
  it("round-trip: salva, rilegge, mai plaintext a riposo, status, delete", async () => {
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY, mdblist: "ns-mdblist-1" })
    expect(await keys.getUserKeys(UUID_A)).toMatchObject({ tmdb: NS_TMDB_KEY, mdblist: "ns-mdblist-1" })
    expect(await keys.getUserKeysStatus(UUID_A)).toEqual({ tmdb: true, mdblist: true, tvdb: false, simkl: false })
    const raw = await fsp.readFile(path.join(tempDir!, "users", UUID_A, "keys.json"), "utf-8")
    expect(raw).not.toContain(NS_TMDB_KEY)
    expect(raw).not.toContain("ns-mdblist-1")
    // "" cancella la kind, campo assente = invariato.
    await keys.setUserKeys(UUID_A, { tmdb: "" })
    expect(await keys.getUserKeysStatus(UUID_A)).toEqual({ tmdb: false, mdblist: true, tvdb: false, simkl: false })
    expect(await keys.getUserKeys(UUID_A)).toMatchObject({ mdblist: "ns-mdblist-1" })
  })

  it("fail-closed senza PROFILE_ENCRYPTION_KEY (save rifiutato, delete ok)", async () => {
    delete process.env.PROFILE_ENCRYPTION_KEY
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    expect(keys.isUserKeysEncryptionAvailable()).toBe(false)
    await expect(keys.setUserKeys(UUID_A, { tmdb: "x" })).rejects.toThrowError(keys.KeysEncryptionUnavailableError)
    // Le sole cancellazioni passano anche senza env (niente da cifrare).
    await keys.setUserKeys(UUID_A, { tmdb: null })
    // Env malformata (non 64 hex) = indisponibile.
    process.env.PROFILE_ENCRYPTION_KEY = "troppo-corta"
    vi.resetModules()
    const keys2 = await import("@/lib/user-keys")
    expect(keys2.isUserKeysEncryptionAvailable()).toBe(false)
    await expect(keys2.setUserKeys(UUID_A, { tmdb: "x" })).rejects.toThrowError(keys2.KeysEncryptionUnavailableError)
  })

  it("input invalidi → InvalidUserKeyError", async () => {
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await expect(keys.setUserKeys(UUID_A, { tmdb: "con spazi" })).rejects.toThrowError(keys.InvalidUserKeyError)
    await expect(keys.setUserKeys(UUID_A, { tmdb: "x".repeat(257) })).rejects.toThrowError(keys.InvalidUserKeyError)
    await expect(keys.setUserKeys(UUID_A, { tmdb: 123 as unknown as string })).rejects.toThrowError(keys.InvalidUserKeyError)
    await expect(keys.setUserKeys(UUID_A, { nope: "x" } as never)).resolves.toBeUndefined()
  })

  it("bundle manomesso → missing (mai throw), mai valori nei log", async () => {
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY })
    const file = path.join(tempDir!, "users", UUID_A, "keys.json")
    const parsed = JSON.parse(await fsp.readFile(file, "utf-8"))
    parsed.keys.tmdb.data = Buffer.from("tampered").toString("base64")
    await fsp.writeFile(file, JSON.stringify(parsed))
    expect(await keys.getUserKeys(UUID_A)).toEqual({})
    expect(await keys.getUserKeysStatus(UUID_A)).toMatchObject({ tmdb: true })
  })

  it("soft-disable: flag senza toccare il materiale, risoluzione ed reveal", async () => {
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY, mdblist: "ns-mdblist-1" })
    // Disattiva solo tmdb: presenza invariata, risoluzione esclusa.
    await keys.setUserKeys(UUID_A, { tmdb: { disabled: true } })
    expect(await keys.getUserKeysDisabled(UUID_A)).toEqual({ tmdb: true, mdblist: false, tvdb: false, simkl: false })
    expect(await keys.getUserKeysStatus(UUID_A)).toEqual({ tmdb: true, mdblist: true, tvdb: false, simkl: false })
    expect(await keys.getUserKeys(UUID_A)).toMatchObject({ mdblist: "ns-mdblist-1" })
    expect(await keys.getUserKeys(UUID_A)).not.toHaveProperty("tmdb")
    // Reveal esplicito vede anche le disattivate (serve alla riattivazione).
    expect(await keys.getUserKeys(UUID_A, { includeDisabled: true })).toMatchObject({ tmdb: NS_TMDB_KEY })
    // Riattiva: il materiale è ancora lì, niente ridigitazione.
    await keys.setUserKeys(UUID_A, { tmdb: { disabled: false } })
    expect(await keys.getUserKeysDisabled(UUID_A)).toMatchObject({ tmdb: false })
    expect(await keys.getUserKeys(UUID_A)).toMatchObject({ tmdb: NS_TMDB_KEY })
  })

  it("flag senza env: passa (niente da cifrare); oggetti malformati → errore", async () => {
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY })
    delete process.env.PROFILE_ENCRYPTION_KEY
    await expect(keys.setUserKeys(UUID_A, { tmdb: { disabled: true } })).resolves.toBeUndefined()
    expect(await keys.getUserKeysDisabled(UUID_A)).toMatchObject({ tmdb: true })
    await expect(keys.setUserKeys(UUID_A, { tmdb: {} as never })).rejects.toThrowError(keys.InvalidUserKeyError)
    await expect(keys.setUserKeys(UUID_A, { tmdb: { disabled: "sì" } as never })).rejects.toThrowError(keys.InvalidUserKeyError)
  })
})

describe("resolveUserApiKeys", () => {
  it("header > query > namespace > env > none (tmdb)", async () => {
    vi.resetModules()
    const tmdb = await import("@/lib/tmdb")
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY })

    // Header vince su tutto (anche sul namespace).
    let r = await tmdb.resolveUserApiKey(
      nextReq("http://x/?api_key=query-key&u=" + UUID_A, { headers: { "x-api-key": "header-key" } }),
      UUID_A, "tmdb",
    )
    expect(r).toEqual({ key: "header-key", source: "header" })

    // Query vince sul namespace.
    r = await tmdb.resolveUserApiKey(nextReq(`http://x/?api_key=query-key&u=${UUID_A}`), UUID_A, "tmdb")
    expect(r).toEqual({ key: "query-key", source: "query" })

    // Namespace (nessuna chiave esplicita, nessuna env).
    r = await tmdb.resolveUserApiKey(nextReq(`http://x/?u=${UUID_A}`), UUID_A, "tmdb")
    expect(r).toEqual({ key: NS_TMDB_KEY, source: "namespace" })

    // Env come ultima spiaggia.
    process.env.PICTORIUM_TMDB_KEY = "env-key"
    r = await tmdb.resolveUserApiKey(nextReq("http://x/"), null, "tmdb")
    expect(r).toEqual({ key: "env-key", source: "env" })

    // Niente da nessuna parte.
    delete process.env.PICTORIUM_TMDB_KEY
    r = await tmdb.resolveUserApiKey(nextReq("http://x/"), null, "tmdb")
    expect(r).toEqual({ key: undefined, source: "none" })
  })

  it("kind mdblist/tvdb: query dedicate + namespace", async () => {
    vi.resetModules()
    const tmdb = await import("@/lib/tmdb")
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { mdblist: "ns-mdb", tvdb: "ns-tvdb" })

    let r = await tmdb.resolveUserApiKey(nextReq(`http://x/?mdblist_key=q-mdb&u=${UUID_A}`), UUID_A, "mdblist")
    expect(r).toEqual({ key: "q-mdb", source: "query" })
    r = await tmdb.resolveUserApiKey(nextReq(`http://x/?u=${UUID_A}`), UUID_A, "mdblist")
    expect(r).toEqual({ key: "ns-mdb", source: "namespace" })
    r = await tmdb.resolveUserApiKey(nextReq(`http://x/?tvdb_key=q-tvdb&u=${UUID_A}`), UUID_A, "tvdb")
    expect(r).toEqual({ key: "q-tvdb", source: "query" })
    r = await tmdb.resolveUserApiKey(nextReq(`http://x/?u=${UUID_A}`), UUID_A, "tvdb")
    expect(r).toEqual({ key: "ns-tvdb", source: "namespace" })
    // L'header TMDB non oscura le query mdblist/tvdb.
    r = await tmdb.resolveUserApiKeys(
      nextReq("http://x/?mdblist_key=q-mdb", { headers: { "x-api-key": "h-tmdb" } }), null,
    ).then((all) => all.mdblist)
    expect(r).toEqual({ key: "q-mdb", source: "query" })
  })
})

describe("keys API route", () => {
  it("401 senza token, 400 uuid invalido, 200 con token (mai valori)", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const route = await import("@/app/api/users/[uuid]/keys/route")
    const created = await auth.createUser()
    const base = `http://localhost:3000/api/users/${created.uuid}/keys`

    const noToken = await route.GET(nextReq(base), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(noToken.status).toBe(401)

    const badUuid = await route.GET(nextReq(base), { params: Promise.resolve({ uuid: "../../etc" }) })
    expect(badUuid.status).toBe(400)

    const put = await route.PUT(
      nextReq(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-token": created.secret },
        body: JSON.stringify({ tmdb: NS_TMDB_KEY, extra: "ignored" }),
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(put.status).toBe(200)

    const get = await route.GET(
      nextReq(base, { headers: { "x-user-token": created.secret } }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(body).toMatchObject({ tmdb: true, mdblist: false, tvdb: false, hasPassword: false })
    expect(JSON.stringify(body)).not.toContain(NS_TMDB_KEY)

    // PUT con secret sbagliato → 401, niente scrittura.
    const wrong = await route.PUT(
      nextReq(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-token": "nope" },
        body: JSON.stringify({ mdblist: "x" }),
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(wrong.status).toBe(401)
  })

  it("PUT persiste anche simkl (regressione: whitelist hardcodata la scartava)", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const route = await import("@/app/api/users/[uuid]/keys/route")
    const tmdb = await import("@/lib/tmdb")
    const created = await auth.createUser()
    const base = `http://localhost:3000/api/users/${created.uuid}/keys`

    const put = await route.PUT(
      nextReq(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-token": created.secret },
        body: JSON.stringify({ simkl: "ns-simkl-client-id" }),
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(put.status).toBe(200)

    const get = await route.GET(
      nextReq(base, { headers: { "x-user-token": created.secret } }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    const body = await get.json()
    expect(body.simkl).toBe(true)

    const r = await tmdb.resolveUserApiKey(nextReq(`http://x/?u=${created.uuid}`), created.uuid, "simkl")
    expect(r).toEqual({ key: "ns-simkl-client-id", source: "namespace" })
  })

  it("503 senza PROFILE_ENCRYPTION_KEY quando si scrive", async () => {
    delete process.env.PROFILE_ENCRYPTION_KEY
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const route = await import("@/app/api/users/[uuid]/keys/route")
    const created = await auth.createUser()
    const base = `http://localhost:3000/api/users/${created.uuid}/keys`
    const put = await route.PUT(
      nextReq(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-token": created.secret },
        body: JSON.stringify({ tmdb: "x" }),
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(put.status).toBe(503)
  })
})

describe("keys reveal route", () => {
  it("200 al proprietario (secret o password), 401 anon, 400 kind, 404 assente", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const keys = await import("@/lib/user-keys")
    const route = await import("@/app/api/users/[uuid]/keys/reveal/route")
    const created = await auth.createUser("reveal-me-12")
    await keys.setUserKeys(created.uuid, { tmdb: NS_TMDB_KEY })
    const base = `http://localhost:3000/api/users/${created.uuid}/keys/reveal`
    const body = (kind: unknown) => JSON.stringify({ kind })

    const anon = await route.POST(
      nextReq(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("tmdb") }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(anon.status).toBe(401)

    const badKind = await route.POST(
      nextReq(base, { method: "POST", headers: { "Content-Type": "application/json", "x-user-token": created.secret }, body: body("nope") }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(badKind.status).toBe(400)

    const missing = await route.POST(
      nextReq(base, { method: "POST", headers: { "Content-Type": "application/json", "x-user-token": created.secret }, body: body("tvdb") }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(missing.status).toBe(404)

    const bySecret = await route.POST(
      nextReq(base, { method: "POST", headers: { "Content-Type": "application/json", "x-user-token": created.secret }, body: body("tmdb") }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(bySecret.status).toBe(200)
    expect(await bySecret.json()).toEqual({ kind: "tmdb", value: NS_TMDB_KEY })

    const byPassword = await route.POST(
      nextReq(base, { method: "POST", headers: { "Content-Type": "application/json", "x-user-password": "reveal-me-12" }, body: body("tmdb") }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(byPassword.status).toBe(200)
    expect(await byPassword.json()).toEqual({ kind: "tmdb", value: NS_TMDB_KEY })
  })

  it("404 con flag OFF", async () => {
    delete process.env.PICTORIUM_MULTI_USER
    vi.resetModules()
    const route = await import("@/app/api/users/[uuid]/keys/reveal/route")
    const res = await route.POST(
      nextReq(`http://x/api/users/${UUID_A}/keys/reveal`, { method: "POST", body: JSON.stringify({ kind: "tmdb" }) }),
      { params: Promise.resolve({ uuid: UUID_A }) },
    )
    expect(res.status).toBe(404)
  })
})

describe("catalog con chiave namespace (fatal-block fix)", () => {
  function jwResponse(tmdbId: number, imdbId: string): Response {
    return Response.json({
      data: {
        streamingCharts: {
          edges: [
            {
              streamingChartInfo: { rank: 1 },
              node: { content: { externalIds: { tmdbId, imdbId } } },
            },
          ],
        },
      },
    })
  }

  function tmdbDetailsResponse(tmdbId: number): Response {
    return Response.json({
      id: tmdbId,
      title: "House of the Dragon",
      overview: "Trama",
      genres: [{ id: 18, name: "Dramma" }],
      vote_average: 8.4,
      vote_count: 100,
      backdrop_path: "/bd.jpg",
      release_date: "2022-08-21",
      external_ids: { imdb_id: "tt11198330" },
    })
  }

  function tmdbImagesResponse(tmdbId: number): Response {
    return Response.json({ id: tmdbId, backdrops: [], posters: [], logos: [] })
  }

  it("serve il catalogo con la sola chiave namespace (niente chiave in request/env)", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser("namespace-12")
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(created.uuid, { tmdb: NS_TMDB_KEY })
    const { cacheClear } = await import("@/lib/cache")
    cacheClear()
    const { __resetJWRankingsCache } = await import("@/lib/justwatch")
    __resetJWRankingsCache()
    const { GET } = await import("@/app/catalog/[type]/[id]/route")

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jwResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbDetailsResponse(94997))
      .mockResolvedValueOnce(tmdbImagesResponse(94997))

    const req = nextReq(`http://localhost:3000/catalog/series/pictorium-jw-series.json?u=${created.uuid}`)
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].poster).toContain("/api/poster/series/94997")
    // La chiave namespace ha davvero viaggiato verso TMDB (mai in chiaro nei log/URL serviti).
    const tmdbCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("api.themoviedb.org"))
    expect(String(tmdbCall?.[0])).toContain(NS_TMDB_KEY)
    expect(body.metas[0].poster).not.toContain(NS_TMDB_KEY)
  })

  it("senza chiavi da nessuna parte: notice card (key-missing esplicito)", async () => {
    vi.resetModules()
    const { cacheClear } = await import("@/lib/cache")
    cacheClear()
    const { __resetJWRankingsCache } = await import("@/lib/justwatch")
    __resetJWRankingsCache()
    const { GET } = await import("@/app/catalog/[type]/[id]/route")
    const req = nextReq(`http://localhost:3000/catalog/series/pictorium-jw-series.json?u=${UUID_A}`)
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id.startsWith("pictorium:notice:")).toBe(true)
    expect(body.metas[0].poster).toContain("/pictorium.png")
  })
})

describe("user-keys KV backend (Redis/Upstash via lib/kv)", () => {
  it("round-trip cifrato sulla KV condivisa, mai file su disco", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    await keys.setUserKeys(UUID_A, { tmdb: NS_TMDB_KEY })
    expect(await keys.getUserKeys(UUID_A)).toMatchObject({ tmdb: NS_TMDB_KEY })
    // Mai plaintext a riposo nella KV…
    expect(JSON.stringify(kvStore.get(`user:${UUID_A}:keys`))).not.toContain(NS_TMDB_KEY)
    // …e mai file su disco (ramo KV preso davvero).
    expect(await fsp.stat(path.join(tempDir!, "users", UUID_A, "keys.json")).catch(() => null)).toBeNull()

    // Altra istanza (modulo ricaricato): legge dalla KV condivisa.
    vi.resetModules()
    const reloaded = await import("@/lib/user-keys")
    expect(await reloaded.getUserKeys(UUID_A)).toMatchObject({ tmdb: NS_TMDB_KEY })
  })
})
