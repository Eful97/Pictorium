import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// In-memory KV (file-mode tests never touch it). `eval` emulates each
// server-side script atomically (single-threaded mock = same single-step
// semantics as Lua): the state-consume get-and-del, the task-3 profile-lock
// acquire (SET NX PX with expiry) / release (owner-checked del), and the
// task-3 token CAS (auth-exists + generation-match check-and-set).
// `rawEval` flips consume to return objects (Upstash REST deserializes JSON
// automatically, Redis returns raw strings — the consumer must handle both).
const kvStore = vi.hoisted(() => new Map<string, unknown>())
const kvLocks = vi.hoisted(() => new Map<string, { owner: string; expiresAt: number }>())
const kvCtl = vi.hoisted(() => ({ rawEval: false, evalFail: false, getCalls: 0, delCalls: 0 }))
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => {
      kvCtl.getCalls++
      return kvStore.get(key) ?? null
    },
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
    del: async (key: string) => {
      kvCtl.delCalls++
      kvLocks.delete(key)
      return kvStore.delete(key) ? 1 : 0
    },
    eval: async (_script: string, keys: string[], args: string[]) => {
      if (kvCtl.evalFail) throw new Error("EVAL unavailable (injected)")
      if (_script.includes("trakt-lock-acquire")) {
        const cur = kvLocks.get(keys[0])
        if (cur && cur.expiresAt > Date.now()) return 0
        kvLocks.set(keys[0], { owner: args[0], expiresAt: Date.now() + Number(args[1]) })
        return 1
      }
      if (_script.includes("trakt-lock-release")) {
        const cur = kvLocks.get(keys[0])
        if (cur && cur.owner === args[0]) {
          kvLocks.delete(keys[0])
          return 1
        }
        return 0
      }
      if (_script.includes("trakt-token-cond-clear")) {
        if (!kvStore.has(keys[2])) return "no_user"
        const g = kvStore.get(keys[1])
        const cur = typeof g === "string" ? g : ""
        if (cur !== (args[0] ?? "")) return "stale"
        const held = kvLocks.get(keys[3])
        if (!held || held.expiresAt <= Date.now() || held.owner !== args[2]) return "stale"
        kvStore.delete(keys[0])
        kvStore.set(keys[1], args[1])
        return "ok"
      }
      if (_script.includes("trakt-token-cas")) {
        if (!kvStore.has(keys[2])) return "no_user"
        const g = kvStore.get(keys[1])
        const cur = typeof g === "string" ? g : ""
        if (cur !== (args[0] ?? "")) return "stale"
        const held = kvLocks.get(keys[3])
        if (!held || held.expiresAt <= Date.now() || held.owner !== args[3]) return "stale"
        kvStore.set(keys[0], JSON.parse(args[1]))
        kvStore.set(keys[1], args[2])
        return "ok"
      }
      if (_script.includes("trakt-disconnect")) {
        if (!kvStore.has(keys[2])) return "no_user"
        kvStore.set(keys[1], args[0])
        kvStore.delete(keys[0])
        return "ok"
      }
      const v = kvStore.get(keys[0]) ?? null
      if (v === null || v === undefined) return null
      kvStore.delete(keys[0])
      if (kvCtl.rawEval) return v
      return typeof v === "string" ? v : JSON.stringify(v)
    },
  },
}))

const CLIENT_ID = "test-trakt-client-id"
const REDIRECT_DUCK = "https://pictorium.duckdns.org/api/trakt/callback"
const REDIRECT_ELF = "https://pictorium.elfhosted.com/api/trakt/callback"

const TOKEN_REPLY = {
  access_token: "test-oauth-access-0123456789abcdef",
  token_type: "Bearer",
  expires_in: 7776000,
  refresh_token: "test-oauth-refresh-0123456789abcdef",
  scope: "public",
  created_at: 1750000000,
}

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_RATELIMIT_KV",
  // Alias KV keys read by the storage/rate-limit modules but never cleaned
  // before F7: a leaked REDIS_URL (or POSTERIUM_RATELIMIT_KV) flips
  // getStorageMode()/isKvStore() for every later test in the worker.
  "POSTERIUM_RATELIMIT_KV",
  "PICTORIUM_REDIS_URL",
  "POSTERIUM_REDIS_URL",
  "REDIS_URL",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TRAKT_CLIENT_ID",
  "POSTERIUM_TRAKT_CLIENT_ID",
  "TRAKT_CLIENT_ID",
  "PICTORIUM_TRAKT_CLIENT_SECRET",
  "POSTERIUM_TRAKT_CLIENT_SECRET",
  "PICTORIUM_TRAKT_REDIRECT_URI",
  "POSTERIUM_TRAKT_REDIRECT_URI",
  "TRAKT_API_URL",
  "PICTORIUM_TRAKT_TIMEOUT_MS",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

const DISTINCT_SECRET = "DISTINCTIVE_TEST_SECRET_abc123"
const BODY_MARKER = "BODY_MARKER_should_never_be_logged"
const CODE_MARKER = "CODE_MARKER_should_never_be_logged"

function setValidConfig(redirect = REDIRECT_DUCK) {
  process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
  process.env.PICTORIUM_TRAKT_REDIRECT_URI = redirect
  // Leftover pre-PKCE secret on purpose: it must be ignored everywhere —
  // never required, never sent, never logged.
  process.env.PICTORIUM_TRAKT_CLIENT_SECRET = DISTINCT_SECRET
}

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-traktoauth-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  delete process.env.PICTORIUM_RATELIMIT_KV
  delete process.env.POSTERIUM_RATELIMIT_KV
  delete process.env.PICTORIUM_REDIS_URL
  delete process.env.POSTERIUM_REDIS_URL
  delete process.env.REDIS_URL
  delete process.env.PICTORIUM_TRAKT_CLIENT_ID
  delete process.env.POSTERIUM_TRAKT_CLIENT_ID
  delete process.env.TRAKT_CLIENT_ID
  delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
  delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
  delete process.env.PICTORIUM_TRAKT_REDIRECT_URI
  delete process.env.POSTERIUM_TRAKT_REDIRECT_URI
  delete process.env.TRAKT_API_URL
  delete process.env.PICTORIUM_TRAKT_TIMEOUT_MS
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  setValidConfig()
  kvStore.clear()
  kvLocks.clear()
  kvCtl.rawEval = false
  kvCtl.evalFail = false
  kvCtl.getCalls = 0
  kvCtl.delCalls = 0
  // Defensive: restoreAllMocks/resetModules do NOT undo vi.doMock. A leaked
  // always-429 "@/lib/rate-limit" mock (pre-F7 line-932 doUnmock sat AFTER the
  // assert, so any failure skipped it) 429s every later startFlow in the file.
  // Never doUnmock "@/lib/kv" or "@vercel/kv" here: the hoisted memory mock
  // must stay registered (unmocking it would route KV tests at real Upstash).
  vi.doUnmock("@/lib/rate-limit")
  vi.restoreAllMocks()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  kvStore.clear()
  kvLocks.clear()
  kvCtl.rawEval = false
  kvCtl.evalFail = false
  kvCtl.getCalls = 0
  kvCtl.delCalls = 0
  // Contain in-test doMock leaks even on early throw: the rate-limit test's
  // old doUnmock-after-assert never ran once line-930 failed, 429-poisoning
  // the next three tests. Belt-and-braces with the in-test try/finally.
  vi.doUnmock("@/lib/rate-limit")
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function loadAll() {
  vi.resetModules()
  const auth = await import("@/lib/user-auth")
  const authorize = await import("@/app/api/users/[uuid]/trakt/authorize/route")
  const status = await import("@/app/api/users/[uuid]/trakt/status/route")
  const callback = await import("@/app/api/trakt/callback/route")
  const trakt = await import("@/lib/trakt-auth")
  const oauthState = await import("@/lib/trakt-oauth-state")
  return { auth, authorize, status, callback, trakt, oauthState }
}

function postAuthorize(url: string, secret?: string, extra?: Record<string, string>): NextRequest {
  const headers: Record<string, string> = { ...extra }
  if (secret) headers["x-user-token"] = secret
  return new NextRequest(url, { method: "POST", headers })
}

function getCallback(url: string, cookie?: string, extra?: Record<string, string>): NextRequest {
  const headers: Record<string, string> = { ...extra }
  if (cookie) headers.cookie = cookie
  return new NextRequest(url, { headers })
}

async function startFlow(
  authorize: { POST: (req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) => Promise<Response> },
  uuid: string,
  secret: string,
): Promise<{ authorizeUrl: string; state: string; nonce: string; cookie: string; codeChallenge: string }> {
  const res = await authorize.POST(postAuthorize(`http://localhost/api/users/${uuid}/trakt/authorize`, secret), {
    params: Promise.resolve({ uuid }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { authorizeUrl: string; expiresIn: number }
  const setCookie = res.headers.get("set-cookie")
  expect(setCookie).toContain("pictorium_trakt_oauth=")
  const nonce = /pictorium_trakt_oauth=([^;]+)/.exec(setCookie!)?.[1]
  expect(nonce).toBeTruthy()
  const params = new URL(body.authorizeUrl).searchParams
  const state = params.get("state")
  const codeChallenge = params.get("code_challenge")
  expect(state).toBeTruthy()
  expect(codeChallenge).toBeTruthy()
  return { authorizeUrl: body.authorizeUrl, state: state!, nonce: nonce!, cookie: `pictorium_trakt_oauth=${nonce}`, codeChallenge: codeChallenge! }
}

function stubExchangeSuccess(reply: unknown = TOKEN_REPLY): { urls: string[]; bodies: unknown[] } {
  const urls: string[] = []
  const bodies: unknown[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    urls.push(String(input))
    bodies.push(init?.body ? JSON.parse(init.body as string) : null)
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return { urls, bodies }
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const push = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
  }
  const spies = [
    vi.spyOn(console, "log").mockImplementation(push),
    vi.spyOn(console, "warn").mockImplementation(push),
    vi.spyOn(console, "error").mockImplementation(push),
  ]
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) }
}

async function stateDirEntries(): Promise<string[]> {
  return fsp.readdir(path.join(tempDir!, "trakt-oauth")).catch(() => [] as string[])
}

describe("POST /api/users/[uuid]/trakt/authorize", () => {
  it("valid start: fixed auth.trakt.tv PKCE authorize URL, binding cookie, no-store, no secrets", async () => {
    const { auth, authorize } = await loadAll()
    const created = await auth.createUser()
    const res = await authorize.POST(postAuthorize(`http://localhost/api/users/${created.uuid}/trakt/authorize`, created.secret), {
      params: Promise.resolve({ uuid: created.uuid }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = (await res.json()) as { authorizeUrl: string; expiresIn: number }
    expect(body.expiresIn).toBe(600)
    const url = new URL(body.authorizeUrl)
    // PKCE host ALWAYS auth.trakt.tv — never env/request-derived.
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("https://auth.trakt.tv/oauth/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_DUCK)
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // PKCE S256: challenge travels, verifier never does.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // API credentials never in the URL or the JSON body (incl. the leftover
    // pre-PKCE secret decoy, which must be ignored, never sent).
    expect(body.authorizeUrl).not.toContain(DISTINCT_SECRET)
    expect(JSON.stringify(body)).not.toContain(DISTINCT_SECRET)
    // Binding cookie: HttpOnly, SameSite=Lax, callback-path scoped, host-only.
    const setCookie = res.headers.get("set-cookie")!
    expect(setCookie).toContain("pictorium_trakt_oauth=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
    expect(setCookie).toContain("Path=/api/trakt/callback")
    expect(setCookie).toContain("Max-Age=600")
    expect(setCookie).not.toContain("Domain=")
    // Server state persisted exactly once (single outstanding flow record).
    expect(await stateDirEntries()).toHaveLength(1)
  })

  it("every initiation mints a unique verifier (unique S256 challenge)", async () => {
    const { auth, authorize } = await loadAll()
    const created = await auth.createUser()
    const ctx = { params: Promise.resolve({ uuid: created.uuid }) }
    const url = `http://localhost/api/users/${created.uuid}/trakt/authorize`
    const first = await (
      await authorize.POST(postAuthorize(url, created.secret), ctx)
    ).json() as { authorizeUrl: string }
    const second = await (
      await authorize.POST(postAuthorize(url, created.secret), ctx)
    ).json() as { authorizeUrl: string }
    const c1 = new URL(first.authorizeUrl).searchParams.get("code_challenge")
    const c2 = new URL(second.authorizeUrl).searchParams.get("code_challenge")
    expect(c1).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(c2).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(c1).not.toBe(c2)
  })

  it("starts with NO secret configured (PKCE public client)", async () => {
    // The app under test registers no secret at all — the supported shape.
    delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
    delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
    vi.resetModules()
    const fresh = await loadAll()
    const created = await fresh.auth.createUser()
    const res = await fresh.authorize.POST(
      postAuthorize(`http://localhost/api/users/${created.uuid}/trakt/authorize`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { authorizeUrl: string }
    const url = new URL(body.authorizeUrl)
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("https://auth.trakt.tv/oauth/authorize")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  })

  it("no GET side effect: GET is not exported (405 by framework convention)", async () => {
    const { auth, authorize } = await loadAll()
    const created = await auth.createUser()
    expect("GET" in authorize).toBe(false)
    expect(await stateDirEntries()).toHaveLength(0)
    expect(created.uuid).toBeTruthy()
  })

  it("rejects disabled multi-user, bad UUID, anonymous and unowned callers, cross-origin", async () => {
    const { auth, authorize } = await loadAll()
    const a = await auth.createUser()
    const b = await auth.createUser()
    const ctxA = { params: Promise.resolve({ uuid: a.uuid }) }

    // Multi-user off → 404, no state minted.
    process.env.PICTORIUM_MULTI_USER = "0"
    vi.resetModules()
    const off = await import("@/app/api/users/[uuid]/trakt/authorize/route")
    const offRes = await off.POST(postAuthorize(`http://localhost/api/users/${a.uuid}/trakt/authorize`, a.secret), ctxA)
    expect(offRes.status).toBe(404)
    expect(offRes.headers.get("cache-control")).toBe("no-store")
    delete process.env.PICTORIUM_MULTI_USER
    process.env.PICTORIUM_MULTI_USER = "1"

    // Bad UUID → 400.
    expect(
      (await authorize.POST(postAuthorize("http://localhost/api/users/nope/trakt/authorize", a.secret), {
        params: Promise.resolve({ uuid: "not-a-uuid" }),
      })).status,
    ).toBe(400)
    // Anonymous → 401; unowned UUID (B's token for A's flow) → 401.
    expect((await authorize.POST(postAuthorize(`http://localhost/api/users/${a.uuid}/trakt/authorize`), ctxA)).status).toBe(401)
    expect((await authorize.POST(postAuthorize(`http://localhost/api/users/${a.uuid}/trakt/authorize`, b.secret), ctxA)).status).toBe(401)
    // Cross-origin → 403.
    expect(
      (
        await authorize.POST(
          postAuthorize(`http://localhost/api/users/${a.uuid}/trakt/authorize`, a.secret, { origin: "https://evil.example.com" }),
          ctxA,
        )
      ).status,
    ).toBe(403)
    expect(await stateDirEntries()).toHaveLength(0)
  })

  it("fail-closed before start: unconfigured OAuth or missing encryption → 503", async () => {
    const { auth, authorize } = await loadAll()
    const created = await auth.createUser()
    const ctx = { params: Promise.resolve({ uuid: created.uuid }) }
    const url = `http://localhost/api/users/${created.uuid}/trakt/authorize`

    // No client ID (the leftover secret decoy alone configures nothing).
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    vi.resetModules()
    const uncfg = await import("@/app/api/users/[uuid]/trakt/authorize/route")
    expect((await uncfg.POST(postAuthorize(url, created.secret), ctx)).status).toBe(503)
    setValidConfig()

    // A missing secret NEVER blocks the start (PKCE needs none).
    delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
    delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
    vi.resetModules()
    const nosecret = await import("@/app/api/users/[uuid]/trakt/authorize/route")
    expect((await nosecret.POST(postAuthorize(url, created.secret), ctx)).status).toBe(200)
    setValidConfig()

    delete process.env.PROFILE_ENCRYPTION_KEY
    vi.resetModules()
    const mintedBefore = await stateDirEntries()
    const noenc = await import("@/app/api/users/[uuid]/trakt/authorize/route")
    const noencRes = await noenc.POST(postAuthorize(url, created.secret), ctx)
    expect(noencRes.status).toBe(503)
    expect(await noencRes.json()).toMatchObject({ error: expect.any(String) })
    // No new state minted without encryption (the verifier is a secret).
    expect(await stateDirEntries()).toEqual(mintedBefore)
    void authorize
  })
})

describe("GET /api/users/[uuid]/trakt/status (secret-free)", () => {
  it("auth gate mirrors keys GET; honest states incl. unavailable (never disconnected)", async () => {
    const { auth, status, trakt } = await loadAll()
    const a = await auth.createUser()
    const b = await auth.createUser()
    const urlA = `http://localhost/api/users/${a.uuid}/trakt/status`

    expect((await status.GET(new NextRequest(urlA), { params: Promise.resolve({ uuid: a.uuid }) })).status).toBe(401)
    expect(
      (await status.GET(new NextRequest(urlA, { headers: { "x-user-token": b.secret } }), { params: Promise.resolve({ uuid: a.uuid }) }))
        .status,
    ).toBe(401)
    expect(
      (await status.GET(new NextRequest("http://localhost/api/users/nope/trakt/status", { headers: { "x-user-token": a.secret } }), {
        params: Promise.resolve({ uuid: "nope" }),
      })).status,
    ).toBe(400)

    const fresh = await status.GET(new NextRequest(urlA, { headers: { "x-user-token": a.secret } }), {
      params: Promise.resolve({ uuid: a.uuid }),
    })
    expect(fresh.status).toBe(200)
    expect(fresh.headers.get("cache-control")).toBe("no-store")
    expect(await fresh.json()).toEqual({ configured: true, status: "disconnected" })

    // Linked then encryption lost → unavailable (transient), never disconnected.
    await trakt.saveTraktTokens(a.uuid, {
      accessToken: "saved-access-token",
      refreshToken: "saved-refresh-token",
      expiresAt: Date.now() + 3600_000,
    })
    const linked = await status.GET(new NextRequest(urlA, { headers: { "x-user-token": a.secret } }), {
      params: Promise.resolve({ uuid: a.uuid }),
    })
    expect(await linked.json()).toEqual({ configured: true, status: "connected" })
    delete process.env.PROFILE_ENCRYPTION_KEY
    vi.resetModules()
    const status2 = await import("@/app/api/users/[uuid]/trakt/status/route")
    const degraded = await status2.GET(new NextRequest(urlA, { headers: { "x-user-token": a.secret } }), {
      params: Promise.resolve({ uuid: a.uuid }),
    })
    expect(await degraded.json()).toEqual({ configured: true, status: "unavailable" })

    // Unconfigured deployment still answers honestly (never throws).
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    vi.resetModules()
    const status3 = await import("@/app/api/users/[uuid]/trakt/status/route")
    const uncfg = await status3.GET(new NextRequest(urlA, { headers: { "x-user-token": a.secret } }), {
      params: Promise.resolve({ uuid: a.uuid }),
    })
    expect(await uncfg.json()).toMatchObject({ configured: false })
  })
})

describe("GET /api/trakt/callback", () => {
  it("happy path: links the initiating profile only, profile redirect, cookie cleared, no-store", async () => {
    const { auth, authorize, status, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const b = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const seen = stubExchangeSuccess()

    const res = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_valid&state=${flow.state}`, flow.cookie),
    )
    expect(res.status).toBe(302)
    // Profile-safe return: the initiating profile's configure page (UUID
    // from the consumed server state only — never a request param).
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const cleared = res.headers.get("set-cookie")!
    expect(cleared).toContain("pictorium_trakt_oauth=;")
    expect(cleared).toContain("Max-Age=0")
    expect(cleared).toContain("Path=/api/trakt/callback")

    // Official token endpoint, server-side POST with the exact binding.
    expect(seen.urls).toEqual(["https://api.trakt.tv/oauth/token"])
    expect(seen.bodies).toHaveLength(1)
    const sentBody = seen.bodies[0] as Record<string, unknown>
    expect(sentBody).toMatchObject({
      code: `${CODE_MARKER}_valid`,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_DUCK,
      grant_type: "authorization_code",
    })
    // PKCE: the exchange carries the initiation verifier, never a secret.
    expect(sentBody).not.toHaveProperty("client_secret")
    expect(JSON.stringify(sentBody)).not.toContain(DISTINCT_SECRET)
    expect(typeof sentBody.code_verifier).toBe("string")
    expect(sentBody.code_verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    // …and that verifier is the one behind the authorize challenge.
    const expectedChallenge = crypto
      .createHash("sha256")
      .update(sentBody.code_verifier as string, "utf-8")
      .digest("base64url")
    expect(expectedChallenge).toBe(flow.codeChallenge)

    // Tokens land on the initiator only; the other profile stays disconnected.
    const readA = await trakt.getTraktTokens(a.uuid)
    expect(readA.status).toBe("connected")
    if (readA.status === "connected") {
      expect(readA.tokens.accessToken).toBe(TOKEN_REPLY.access_token)
      expect(readA.tokens.refreshToken).toBe(TOKEN_REPLY.refresh_token)
      expect(readA.tokens.redirectUri).toBe(REDIRECT_DUCK)
      expect(readA.tokens.expiresAt).toBe(TOKEN_REPLY.created_at * 1000 + TOKEN_REPLY.expires_in * 1000)
    }
    expect(await trakt.getTraktTokenStatus(b.uuid)).toBe("disconnected")

    const st = await status.GET(
      new NextRequest(`http://localhost/api/users/${a.uuid}/trakt/status`, { headers: { "x-user-token": a.secret } }),
      { params: Promise.resolve({ uuid: a.uuid }) },
    )
    expect(await st.json()).toEqual({ configured: true, status: "connected" })
  })

  it("denied grant burns state and keeps its own indicator; replay lands on failed", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const denied = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?error=access_denied&state=${flow.state}`, flow.cookie),
    )
    expect(denied.status).toBe(302)
    // Denied consumes a valid state: back to the initiating profile.
    expect(denied.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=denied`)
    expect(denied.headers.get("cache-control")).toBe("no-store")
    expect(denied.headers.get("set-cookie")).toContain("Max-Age=0")
    // No exchange attempted, nothing persisted.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")

    // Replay (even with a code now) → failed on the generic home: the
    // burned state proves nothing, so no profile is named.
    const replay = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=x&state=${flow.state}`, flow.cookie),
    )
    expect(replay.status).toBe(302)
    expect(replay.headers.get("location")).toBe("/?trakt=failed")
  })

  it("rejects missing/garbage/tampered state and missing/wrong cookie (login-CSRF guard)", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    stubExchangeSuccess()

    // Probes that reference no live state: nothing burns.
    const cases: Array<[string, string | undefined, string]> = [
      ["http://localhost/api/trakt/callback?code=x", flow.cookie, "missing state"],
      ["http://localhost/api/trakt/callback?code=x&state=not-valid!!", flow.cookie, "garbage state"],
      [`http://localhost/api/trakt/callback?code=x&state=${"A".repeat(43)}`, flow.cookie, "unknown state"],
    ]
    for (const [url, cookie, label] of cases) {
      const res = await callback.GET(getCallback(url, cookie))
      expect(res.status, label).toBe(302)
      expect(res.headers.get("location"), label).toBe("/?trakt=failed")
      expect(res.headers.get("cache-control"), label).toBe("no-store")
    }
    // Tampered state id (one char flipped): unknown → failed, original still live.
    const tampered = flow.state.slice(0, -1) + (flow.state.endsWith("A") ? "B" : "A")
    const tre = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=x&state=${tampered}`, flow.cookie))
    expect(tre.headers.get("location")).toBe("/?trakt=failed")

    // Binding failures burn the state by design (consume-first, replay-safe):
    // a wrong/missing cookie destroys that flow — it must be restarted.
    const noCookie = await startFlow(authorize, a.uuid, a.secret)
    const nc = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=x&state=${noCookie.state}`))
    expect(nc.headers.get("location")).toBe("/?trakt=failed")
    const ncRetry = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=x&state=${noCookie.state}`, noCookie.cookie),
    )
    expect(ncRetry.headers.get("location")).toBe("/?trakt=failed")

    const wrongCookie = await startFlow(authorize, a.uuid, a.secret)
    const wc = await callback.GET(
      getCallback(
        `http://localhost/api/trakt/callback?code=x&state=${wrongCookie.state}`,
        "pictorium_trakt_oauth=wrongnonce",
      ),
    )
    expect(wc.headers.get("location")).toBe("/?trakt=failed")
    const wcRetry = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=x&state=${wrongCookie.state}`, wrongCookie.cookie),
    )
    expect(wcRetry.headers.get("location")).toBe("/?trakt=failed")

    // Original flow untouched by the probes above: still completes on the
    // initiating profile's page.
    const ok = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_late&state=${flow.state}`, flow.cookie))
    expect(ok.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
  })

  it("expired state is rejected and reaped", async () => {
    const { auth, authorize, callback, oauthState } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    stubExchangeSuccess()
    // Directly minted already-expired state (no sleeping).
    const old = await oauthState.createTraktOAuthState(a.uuid, REDIRECT_DUCK, { ttlMs: -1000 })
    const res = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=x&state=${old.state}`, `pictorium_trakt_oauth=${old.nonce}`),
    )
    expect(res.headers.get("location")).toBe("/?trakt=failed")
    // Expired consume burns the record; the live flow still completes.
    const ok = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=y&state=${flow.state}`, flow.cookie))
    expect(ok.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
  })

  it("single-use: sequential replay and concurrent callbacks link exactly once", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const seen = stubExchangeSuccess()

    const first = await startFlow(authorize, a.uuid, a.secret)
    const r1 = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=one&state=${first.state}`, first.cookie))
    expect(r1.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    const r2 = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=two&state=${first.state}`, first.cookie))
    expect(r2.headers.get("location")).toBe("/?trakt=failed")

    // Concurrent pair on a fresh flow: exactly one winner.
    const second = await startFlow(authorize, a.uuid, a.secret)
    const [c1, c2] = await Promise.all([
      callback.GET(getCallback(`http://localhost/api/trakt/callback?code=c1&state=${second.state}`, second.cookie)),
      callback.GET(getCallback(`http://localhost/api/trakt/callback?code=c2&state=${second.state}`, second.cookie)),
    ])
    const locations = [c1.headers.get("location"), c2.headers.get("location")].sort()
    expect(locations).toEqual(["/?trakt=failed", `/u/${a.uuid}/configure?trakt=connected`])
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
    // Exactly-once upstream cost: the sequential link plus the single
    // concurrent winner exchanged; the loser never reached the network
    // (it failed closed at the single-use claim).
    expect(seen.bodies).toHaveLength(2)
  })

  it("deleted profile: callback fails closed without resurrecting the namespace", async () => {
    const { auth, authorize, callback } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("exchange must not be attempted for a wiped profile")
    })
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(a.uuid)

    const res = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=x&state=${flow.state}`, flow.cookie))
    // The consumed state still names the wiped profile's page (fixed shape,
    // never a request param) — the save path below is what stays shut.
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    expect(fetchSpy).not.toHaveBeenCalled()
    // No namespace resurrection by the token save path.
    await expect(fsp.stat(path.join(tempDir!, "users", a.uuid))).rejects.toThrow()
  })

  it("redirect binding: flow started under another registration cannot complete", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    stubExchangeSuccess()

    // Deployment now registers the OTHER confirmed redirect URI.
    process.env.PICTORIUM_TRAKT_REDIRECT_URI = REDIRECT_ELF
    vi.resetModules()
    const callback2 = await import("@/app/api/trakt/callback/route")
    const res = await callback2.GET(getCallback(`http://localhost/api/trakt/callback?code=x&state=${flow.state}`, flow.cookie))
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
    void callback
  })

  it("provider failure/timeout/malformed: generic failed, nothing persisted, nothing secret logged", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const ctx = { params: Promise.resolve({ uuid: a.uuid }) }
    void ctx

    // 500 with a body containing markers: body must never reach the logs.
    let flow = await startFlow(authorize, a.uuid, a.secret)
    const captured = captureConsole()
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: BODY_MARKER, detail: DISTINCT_SECRET }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    )
    let res = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_1&state=${flow.state}`, flow.cookie))
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
    const logged = captured.lines.join("\n")
    expect(logged).not.toContain(BODY_MARKER)
    expect(logged).not.toContain(DISTINCT_SECRET)
    expect(logged).not.toContain(`${CODE_MARKER}_1`)
    captured.restore()
    vi.restoreAllMocks()

    // Transport failure → failed, nothing persisted.
    flow = await startFlow(authorize, a.uuid, a.secret)
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"))
    res = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_2&state=${flow.state}`, flow.cookie))
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
    vi.restoreAllMocks()

    // Hang with a tiny cap → timeout → failed (fast, no 8s wait). The stub
    // emulates real fetch abort semantics (reject on abort signal).
    process.env.PICTORIUM_TRAKT_TIMEOUT_MS = "100"
    vi.resetModules()
    const mod2 = await loadAll()
    flow = await startFlow(mod2.authorize, a.uuid, a.secret)
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
        }),
    )
    res = await mod2.callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_3&state=${flow.state}`, flow.cookie),
    )
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    expect(await mod2.trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
    vi.restoreAllMocks()
    delete process.env.PICTORIUM_TRAKT_TIMEOUT_MS

    // 200 with invalid schema (missing refresh_token, bad expiry) → failed, never persisted.
    vi.resetModules()
    const mod3 = await loadAll()
    for (const bad of [
      { access_token: "x", token_type: "Bearer", expires_in: 100, created_at: 1750000000 },
      { access_token: "x", refresh_token: "y", expires_in: "soon", created_at: 1750000000 },
      { access_token: "x", refresh_token: "y", expires_in: 100, created_at: -5 },
      "not-an-object",
    ]) {
      flow = await startFlow(mod3.authorize, a.uuid, a.secret)
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(bad), { status: 200, headers: { "Content-Type": "application/json" } }),
      )
      res = await mod3.callback.GET(getCallback(`http://localhost/api/trakt/callback?code=z&state=${flow.state}`, flow.cookie))
      expect(res.headers.get("location"), JSON.stringify(bad)).toBe(`/u/${a.uuid}/configure?trakt=failed`)
      vi.restoreAllMocks()
    }
    expect(await mod3.trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
    void callback
  })

  it("no open redirects, no Host/XFH steering: locations are always fixed relative", async () => {
    const { auth, authorize, callback } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    stubExchangeSuccess()

    const evil = {
      host: "evil.example.com",
      "x-forwarded-host": "evil.example.com",
      origin: "https://evil.example.com",
    }
    // Poisoned-host failure stays on the fixed relative target.
    const bad = await callback.GET(
      getCallback(`http://evil.example.com/api/trakt/callback?code=x&state=${"B".repeat(43)}&next=https://evil.example.com`, flow.cookie, evil),
    )
    expect(bad.headers.get("location")).toBe("/?trakt=failed")
    expect(bad.headers.get("location")).not.toContain("evil")

    // Even the success path under a poisoned Host redirects to the fixed target.
    const ok = await callback.GET(
      getCallback(`http://evil.example.com/api/trakt/callback?code=${CODE_MARKER}_ok&state=${flow.state}&next=https://evil.example.com`, flow.cookie, evil),
    )
    // Profile-safe success target: the initiating profile only — the
    // attacker-supplied `next` param is ignored (no open redirect).
    expect(ok.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(ok.headers.get("location")).not.toContain("evil")
  })

  it("KV backend: full link + replay + object-form consume, no disk files", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    process.env.PICTORIUM_RATELIMIT_KV = "0"
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    stubExchangeSuccess()

    const res = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=kv1&state=${flow.state}`, flow.cookie))
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
    // Nothing on disk in KV mode (state and tokens both remote).
    expect(await stateDirEntries()).toHaveLength(0)
    expect(await fsp.stat(path.join(tempDir!, "users", a.uuid, "trakt.json")).catch(() => null)).toBeNull()

    // Replay through KV (state already consumed) → failed.
    const replay = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=kv2&state=${flow.state}`, flow.cookie))
    expect(replay.headers.get("location")).toBe("/?trakt=failed")

    // Object-form records (Upstash-style deserialized EVAL result) consume fine.
    kvCtl.rawEval = true
    const flow2 = await startFlow(authorize, a.uuid, a.secret)
    const res2 = await callback.GET(getCallback(`http://localhost/api/trakt/callback?code=kv3&state=${flow2.state}`, flow2.cookie))
    expect(res2.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
  })

  it("KV EVAL failure is fail-closed: no get/del fallback, no exchange, no tokens", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    process.env.PICTORIUM_RATELIMIT_KV = "0"
    const { auth, authorize, callback, trakt, oauthState } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    // Outage from here on: every atomic consume throws.
    kvCtl.evalFail = true
    kvCtl.getCalls = 0
    kvCtl.delCalls = 0
    const res = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_outage&state=${flow.state}`, flow.cookie),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/?trakt=failed")
    expect(res.headers.get("cache-control")).toBe("no-store")
    // Fail-closed: no downgrade to non-atomic get+del, no exchange, no save.
    expect(kvCtl.getCalls).toBe(0)
    expect(kvCtl.delCalls).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")

    // Direct consume under EVAL outage: unknown, never ok.
    // (Reset counters: the status read above is a legitimate KV get.)
    kvCtl.getCalls = 0
    kvCtl.delCalls = 0
    const direct = await oauthState.consumeTraktOAuthState(flow.state, flow.nonce)
    expect(direct).toEqual({ ok: false, reason: "unknown" })
    expect(kvCtl.getCalls).toBe(0)
    expect(kvCtl.delCalls).toBe(0)

    // Outage over: the record survived (EVAL never ran) — the flow completes.
    kvCtl.evalFail = false
    stubExchangeSuccess()
    const retry = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_retry&state=${flow.state}`, flow.cookie),
    )
    expect(retry.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
  })

  it("KV concurrent consume: atomic EVAL lets exactly one consumer win", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    process.env.PICTORIUM_RATELIMIT_KV = "0"
    const { auth, oauthState } = await loadAll()
    const a = await auth.createUser()
    const created = await oauthState.createTraktOAuthState(a.uuid, REDIRECT_DUCK)

    // Two consumers race on the same state through the real atomic path
    // (the mock EVAL does get-and-del with no await in between — same
    // single-server-step semantics as the Lua script).
    const [first, second] = await Promise.all([
      oauthState.consumeTraktOAuthState(created.state, created.nonce),
      oauthState.consumeTraktOAuthState(created.state, created.nonce),
    ])
    // Exactly one winner holds the record; the loser sees unknown (replay).
    // The winner also holds the in-memory verifier behind the challenge.
    if (first.ok) {
      expect(first.record.userId).toBe(a.uuid)
      expect(typeof first.verifier).toBe("string")
      expect(crypto.createHash("sha256").update(first.verifier, "utf-8").digest("base64url")).toBe(
        created.codeChallenge,
      )
      expect(second).toEqual({ ok: false, reason: "unknown" })
    } else {
      expect(first).toEqual({ ok: false, reason: "unknown" })
      expect(second.ok).toBe(true)
      if (second.ok) {
        expect(second.record.userId).toBe(a.uuid)
        expect(crypto.createHash("sha256").update(second.verifier, "utf-8").digest("base64url")).toBe(
          created.codeChallenge,
        )
      }
    }
  })

  it("KV concurrent callbacks link exactly once", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    process.env.PICTORIUM_RATELIMIT_KV = "0"
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    stubExchangeSuccess()

    const flow = await startFlow(authorize, a.uuid, a.secret)
    const [c1, c2] = await Promise.all([
      callback.GET(getCallback(`http://localhost/api/trakt/callback?code=kvc1&state=${flow.state}`, flow.cookie)),
      callback.GET(getCallback(`http://localhost/api/trakt/callback?code=kvc2&state=${flow.state}`, flow.cookie)),
    ])
    const locations = [c1.headers.get("location"), c2.headers.get("location")].sort()
    expect(locations).toEqual(["/?trakt=failed", `/u/${a.uuid}/configure?trakt=connected`])
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
  })

  it("rate-limited callback: 429 carries no-store and clears the binding cookie", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)

    // Deterministic limiter outage: the ONLY mocked piece is rateLimit
    // (mocked module re-export keeps rateLimitKey/rateLimitResponse real).
    vi.resetModules()
    vi.doMock("@/lib/rate-limit", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/rate-limit")>()
      return { ...actual, rateLimit: async () => ({ ok: false as const, retAfter: 7 }) }
    })
    const limitedMod = await import("@/app/api/trakt/callback/route")
    // Network observation starts AFTER the import on purpose (F7 root proof):
    // the full-suite failure showed ONE real Upstash pipeline POST
    // (EVAL get-and-del of a trakt:oauth:* key) recorded by a spy installed
    // BEFORE this import — i.e. import-time / in-flight traffic outside the
    // GET, via the dynamic-import race past vi.mock documented in
    // trakt-lifecycle.test.ts. Scoping the mock to the GET window keeps the
    // 429 no-network proof exact; the state-dir + bodies counters below pin
    // the original intent (no consume, no exchange, no save).
    const seen = stubExchangeSuccess()
    let limited: Response
    try {
      limited = await limitedMod.GET(
        getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_rl&state=${flow.state}`, flow.cookie),
      )
    } finally {
      // Unconditional: the pre-F7 doUnmock sat after the asserts, so the
      // line-930 failure skipped it and the always-429 mock 429-poisoned the
      // next three tests' startFlow calls (verify.log: 7621 pass / 4 fail).
      vi.doUnmock("@/lib/rate-limit")
    }
    expect(limited.status).toBe(429)
    expect(limited.headers.get("cache-control")).toBe("no-store")
    expect(limited.headers.get("retry-after")).toBe("7")
    const cleared = limited.headers.get("set-cookie")!
    expect(cleared).toContain("pictorium_trakt_oauth=;")
    expect(cleared).toContain("Max-Age=0")
    expect(cleared).toContain("Path=/api/trakt/callback")
    // Nothing burned, nothing exchanged, nothing persisted: no fetch at all
    // in the GET window, the exchange mock saw zero bodies, the state file
    // is still on disk, and the profile is still disconnected.
    expect(seen.urls).toHaveLength(0)
    expect(seen.bodies).toHaveLength(0)
    expect(await stateDirEntries()).toHaveLength(1)
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")

    // State untouched by the 429: the flow still completes afterwards
    // (fresh real limiter — the mock never saw the state).
    const fresh = await loadAll()
    stubExchangeSuccess()
    const ok = await fresh.callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_after_rl&state=${flow.state}`, flow.cookie),
    )
    expect(ok.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=connected`)
    expect(await fresh.trakt.getTraktTokenStatus(a.uuid)).toBe("connected")
    void callback
  })

  it("mock-hygiene probe A: simulated mid-test throw leaves the always-429 mock registered (hook must contain it)", async () => {
    // Regression for the F7 cascade: the pre-fix rate-limit test threw at its
    // fetch assert with the always-429 mock still registered, and the next
    // three tests' startFlow calls 429'd. This probe replays that shape
    // (throw on the early-exit path, no in-test cleanup) and proves the leak
    // is REAL at test end — so probe B deterministically fails unless the
    // afterEach defensive doUnmock contains it.
    const { auth } = await loadAll()
    const u = await auth.createUser()
    vi.resetModules()
    vi.doMock("@/lib/rate-limit", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/rate-limit")>()
      return { ...actual, rateLimit: async () => ({ ok: false as const, retAfter: 7 }) }
    })
    const mod = await import("@/app/api/users/[uuid]/trakt/authorize/route")
    const ctx = { params: Promise.resolve({ uuid: u.uuid }) }
    const url = `http://localhost/api/users/${u.uuid}/trakt/authorize`
    const denied = await mod.POST(postAuthorize(url, u.secret), ctx)
    expect(denied.status).toBe(429)
    try {
      throw new Error("simulated pre-fix line-930 assert failure (early exit skips in-test cleanup)")
    } catch {
      // Swallowed: the suite stays green; the early-exit path is the point.
    }
    // Leak is real at test end (proves this probe is not vacuous)...
    const again = await mod.POST(postAuthorize(url, u.secret), ctx)
    expect(again.status).toBe(429)
    // ...and is deliberately NOT cleaned here: the afterEach hook MUST
    // contain it (probe B fails otherwise). No other test is affected
    // because the hook runs before the next test's first import.
  })

  it("mock-hygiene probe B: flows are healthy after probe A (proves afterEach contained the leak)", async () => {
    const { auth, authorize } = await loadAll()
    const v = await auth.createUser()
    const res = await authorize.POST(postAuthorize(`http://localhost/api/users/${v.uuid}/trakt/authorize`, v.secret), {
      params: Promise.resolve({ uuid: v.uuid }),
    })
    // Real limiter on fresh buckets: 200. With the leak uncontained this is
    // 429 (the always-429 mock survives resetModules/restoreAllMocks).
    expect(res.status).toBe(200)
  })

  it("profile wiped DURING the token exchange: no namespace resurrection", async () => {
    const { auth, authorize, callback } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)

    // Gate the exchange so the wipe deterministically lands mid-flight
    // (after the pre-exchange userExists check has passed).
    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let exchangeStarted!: () => void
    const started = new Promise<void>((resolve) => {
      exchangeStarted = () => resolve()
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      exchangeStarted()
      return gate
    })
    const pending = callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_midflight&state=${flow.state}`, flow.cookie),
    )
    await started
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(a.uuid)

    release(new Response(JSON.stringify(TOKEN_REPLY), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(`/u/${a.uuid}/configure?trakt=failed`)
    // The post-exchange guard stopped the save: no namespace resurrection.
    await expect(fsp.stat(path.join(tempDir!, "users", a.uuid))).rejects.toThrow()
  })

  it("tampered verifier envelope fails closed: no exchange, no tokens, generic home", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    // Tamper the encrypted verifier at rest (the nonce envelope stays
    // intact, so this isolates the verifier check from the binding check).
    const files = await stateDirEntries()
    expect(files).toHaveLength(1)
    const file = path.join(tempDir!, "trakt-oauth", files[0])
    const parsed = JSON.parse(await fsp.readFile(file, "utf-8")) as Record<string, unknown>
    const verifier = { ...(parsed.verifier as Record<string, unknown>) }
    verifier.data = Buffer.from("tampered-envelope").toString("base64")
    parsed.verifier = verifier
    await fsp.writeFile(file, JSON.stringify(parsed))

    const res = await callback.GET(
      getCallback(`http://localhost/api/trakt/callback?code=${CODE_MARKER}_tampered&state=${flow.state}`, flow.cookie),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/?trakt=failed")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await trakt.getTraktTokenStatus(a.uuid)).toBe("disconnected")
  })

  it("verifier is encrypted at rest: no plaintext in state files, challenge matches", async () => {
    const { auth, authorize, oauthState } = await loadAll()
    const a = await auth.createUser()
    const flow = await startFlow(authorize, a.uuid, a.secret)
    const files = await stateDirEntries()
    expect(files).toHaveLength(1)
    const raw = await fsp.readFile(path.join(tempDir!, "trakt-oauth", files[0]), "utf-8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Encrypted envelope present (iv/tag/data), never a plaintext verifier.
    const verifier = parsed.verifier as Record<string, unknown>
    expect(typeof verifier.iv).toBe("string")
    expect(typeof verifier.tag).toBe("string")
    expect(typeof verifier.data).toBe("string")
    // The browser nonce never persists plaintext either.
    expect(raw).not.toContain(flow.nonce)
    // Decrypting with the configured key yields the initiation verifier
    // behind the public challenge (S256 match, server-side only).
    const { decryptProfileSecret, profileEncryptionKey } = await import("@/lib/profile-crypto")
    const key = profileEncryptionKey()
    expect(key).not.toBeNull()
    const plaintext = decryptProfileSecret(
      verifier as unknown as Parameters<typeof decryptProfileSecret>[0],
      key!,
    )
    expect(plaintext).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(crypto.createHash("sha256").update(plaintext, "utf-8").digest("base64url")).toBe(flow.codeChallenge)
    void oauthState
  })
})

describe("PKCE primitives (RFC 7636, S256-only)", () => {
  it("challenge matches the RFC 7636 Appendix B test vector", async () => {
    const { deriveCodeChallengeS256 } = await import("@/lib/trakt-oauth-state")
    // Canonical vector from RFC 7636 §Appendix B.
    expect(deriveCodeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    )
  })

  it("verifiers are unique, in-range, unreserved; challenges are 43-char S256", async () => {
    const { generateCodeVerifier, deriveCodeChallengeS256 } = await import("@/lib/trakt-oauth-state")
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const v = generateCodeVerifier()
      expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
      expect(seen.has(v)).toBe(false)
      seen.add(v)
      expect(deriveCodeChallengeS256(v)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it("derive rejects malformed verifiers; exchange rejects a wrong verifier without network", async () => {
    const { deriveCodeChallengeS256 } = await import("@/lib/trakt-oauth-state")
    const { exchangeTraktCode, TraktTokenRequestError } = await import("@/lib/trakt-token-exchange")
    for (const bad of ["", "short", "has space inside", "x".repeat(129), "bad!chars*here-0123456789abcdef0123456789ab", 123, null]) {
      expect(() => deriveCodeChallengeS256(bad as never)).toThrow()
    }
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(
      exchangeTraktCode({ clientId: CLIENT_ID, redirectUri: REDIRECT_DUCK }, "code-value", "wrong-verifier!!"),
    ).rejects.toBeInstanceOf(TraktTokenRequestError)
    // Fail-closed before any network: no code/verifier ever left the box.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("trakt oauth cookie builders", () => {
  it("binding cookie is HttpOnly/Lax/path-scoped/host-only; clear cookie expires it", async () => {
    const { oauthState } = await loadAll()
    const set = oauthState.buildTraktOAuthCookie("nonce-value-123")
    expect(set).toContain("pictorium_trakt_oauth=nonce-value-123")
    expect(set).toContain("HttpOnly")
    expect(set).toContain("SameSite=Lax")
    expect(set).toContain("Path=/api/trakt/callback")
    expect(set).toContain("Max-Age=600")
    expect(set).not.toContain("Domain=")
    // Test env (NODE_ENV=test): no Secure — production adds it (next case).
    expect(set).not.toContain("Secure")

    const clear = oauthState.buildClearTraktOAuthCookie()
    expect(clear).toContain("pictorium_trakt_oauth=;")
    expect(clear).toContain("Max-Age=0")
    expect(clear).toContain("Path=/api/trakt/callback")
    expect(clear).toContain("HttpOnly")
  })

  it("production cookie carries Secure", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const oauthState = await import("@/lib/trakt-oauth-state")
    expect(oauthState.buildTraktOAuthCookie("n")).toContain("Secure")
  })
})
