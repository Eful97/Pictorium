import crypto from "node:crypto"
import fsp from "node:fs/promises"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Store KV in-memory: valida il cablaggio trakt-auth -> kv.ts -> @/lib/upstash-kv-client
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@/lib/upstash-kv-client", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
    del: async (key: string) => (kvStore.delete(key) ? 1 : 0),
  },
}))

const UUID_A = "22222222-2222-4222-8222-222222222222"
const UUID_B = "33333333-3333-4333-8333-333333333333"

const ACCESS_A = "test-access-token-alpha-0123456789abcdef"
const REFRESH_A = "test-refresh-token-alpha-0123456789abcdef"
const ACCESS_B = "test-access-token-beta-fedcba9876543210"
const REFRESH_B = "test-refresh-token-beta-fedcba9876543210"

const CLIENT_ID = "test-trakt-client-id"
const REDIRECT_DUCK = "https://pictorium.duckdns.org/api/trakt/callback"
const REDIRECT_ELF = "https://pictorium.elfhosted.com/api/trakt/callback"

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TRAKT_CLIENT_ID",
  "POSTERIUM_TRAKT_CLIENT_ID",
  "TRAKT_CLIENT_ID",
  // PKCE ignores any secret env, but save/restore hygiene still covers the
  // leftover pre-PKCE variables so tests never leak them.
  "PICTORIUM_TRAKT_CLIENT_SECRET",
  "POSTERIUM_TRAKT_CLIENT_SECRET",
  "PICTORIUM_TRAKT_REDIRECT_URI",
  "POSTERIUM_TRAKT_REDIRECT_URI",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

function testSecret(): string {
  return crypto.randomBytes(32).toString("hex")
}

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-traktauth-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  delete process.env.PICTORIUM_TRAKT_CLIENT_ID
  delete process.env.POSTERIUM_TRAKT_CLIENT_ID
  delete process.env.TRAKT_CLIENT_ID
  delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
  delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
  delete process.env.PICTORIUM_TRAKT_REDIRECT_URI
  delete process.env.POSTERIUM_TRAKT_REDIRECT_URI
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  kvStore.clear()
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function loadTrakt() {
  vi.resetModules()
  return import("@/lib/trakt-auth")
}

function setValidConfig(redirect = REDIRECT_DUCK) {
  process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
  process.env.PICTORIUM_TRAKT_REDIRECT_URI = redirect
}

function tokenInput(expiresAt = Date.now() + 3600_000) {
  return { accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt }
}

describe("trakt OAuth config (fail-closed, PKCE — no secret)", () => {
  it("valid config: both registered redirect URIs accepted, secret never in status", async () => {
    for (const redirect of [REDIRECT_DUCK, REDIRECT_ELF]) {
      setValidConfig(redirect)
      const trakt = await loadTrakt()
      const cfg = trakt.getTraktOAuthConfig()
      expect(cfg.clientId).toBe(CLIENT_ID)
      expect(cfg.redirectUri).toBe(redirect)
      // PKCE public client: the config carries no secret at all.
      expect(cfg).not.toHaveProperty("clientSecret")
      expect(trakt.isTraktOAuthConfigured()).toBe(true)
      expect(trakt.getTraktOAuthStatus()).toEqual({ configured: true, reason: null })
      const pub = trakt.getTraktOAuthPublicInfo()
      expect(pub).toEqual({ configured: true, redirectUri: redirect })
      expect(JSON.stringify(pub)).not.toContain(CLIENT_ID.slice(0, 8) + "x")
    }
  })

  it("leftover pre-PKCE secret env is ignored (never required, never read)", async () => {
    setValidConfig()
    const trakt = await loadTrakt()
    expect(trakt.isTraktOAuthConfigured()).toBe(true)
    // Garbage, whitespace, even absurd values: the secret is not part of the
    // config anymore, so none of these can break or influence it.
    for (const leftover of ["has space inside", "   ", "", "x".repeat(600)]) {
      process.env.PICTORIUM_TRAKT_CLIENT_SECRET = leftover
      const reloaded = await loadTrakt()
      expect(reloaded.isTraktOAuthConfigured(), JSON.stringify(leftover)).toBe(true)
      expect(reloaded.getTraktOAuthConfig()).toEqual({ clientId: CLIENT_ID, redirectUri: REDIRECT_DUCK })
    }
    delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
    process.env.POSTERIUM_TRAKT_CLIENT_SECRET = "legacy-leftover"
    expect((await loadTrakt()).isTraktOAuthConfigured()).toBe(true)
  })

  it("missing pieces: distinct reasons, generic messages without values", async () => {
    const trakt = await loadTrakt()
    // Nothing set at all.
    expect(trakt.isTraktOAuthConfigured()).toBe(false)
    expect(trakt.getTraktOAuthStatus()).toEqual({ configured: false, reason: "missing_client_id" })
    expect(trakt.getTraktOAuthPublicInfo()).toEqual({ configured: false, redirectUri: null })
    try {
      trakt.getTraktOAuthConfig()
      expect.unreachable("must throw")
    } catch (e) {
      expect(e).toBeInstanceOf(trakt.TraktConfigError)
      expect((e as { reason: string }).reason).toBe("missing_client_id")
    }

    // Client ID alone is one half: redirect still missing (no secret step).
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    expect((await loadTrakt()).getTraktOAuthStatus()).toEqual({ configured: false, reason: "missing_redirect_uri" })
    try {
      ;(await loadTrakt()).getTraktOAuthConfig()
      expect.unreachable("must throw")
    } catch (e) {
      // Generic message: no client ID, no redirect echoed.
      expect((e as Error).message).not.toContain(CLIENT_ID)
      expect((e as Error).message).not.toContain(REDIRECT_DUCK)
    }
  })

  it("invalid client id rejected without leaking values", async () => {
    setValidConfig()
    // Empty client ID (whitespace) → invalid, not missing.
    process.env.PICTORIUM_TRAKT_CLIENT_ID = "   "
    let trakt = await loadTrakt()
    expect(trakt.getTraktOAuthStatus()).toEqual({ configured: false, reason: "invalid_client_id" })
    // Whitespace inside / oversize → invalid.
    process.env.PICTORIUM_TRAKT_CLIENT_ID = "has space"
    trakt = await loadTrakt()
    expect(trakt.getTraktOAuthStatus()).toEqual({ configured: false, reason: "invalid_client_id" })
    try {
      trakt.getTraktOAuthConfig()
      expect.unreachable("must throw")
    } catch (e) {
      expect((e as Error).message).not.toContain("has space")
    }
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    expect((await loadTrakt()).isTraktOAuthConfigured()).toBe(true)
  })

  it("redirect matrix: https + exact callback path only, never request-derived", async () => {
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    const cases: Array<[string, boolean]> = [
      ["not a url", false],
      // PKCE rule: https only — plain http is rejected even on loopback
      // (local testing goes through an HTTPS tunnel serving the whole origin).
      ["http://example.com/api/trakt/callback", false],
      ["http://localhost:3000/api/trakt/callback", false],
      ["http://127.0.0.1:3000/api/trakt/callback", false],
      ["http://localhost/api/trakt/callback", false],
      ["https://example.com/other", false],
      ["https://example.com/api/trakt/callback?x=1", false],
      ["https://example.com/api/trakt/callback#frag", false],
      ["https://user:pass@example.com/api/trakt/callback", false],
      ["https://example.com/api/trakt/callback/evil", false],
      ["ftp://example.com/api/trakt/callback", false],
      [REDIRECT_DUCK, true],
      [REDIRECT_ELF, true],
      ["https://example.com/api/trakt/callback/", true],
      ["http://evil.com/api/trakt/callback", false],
    ]
    for (const [uri, valid] of cases) {
      process.env.PICTORIUM_TRAKT_REDIRECT_URI = uri
      const trakt = await loadTrakt()
      expect(trakt.isTraktOAuthConfigured(), uri).toBe(valid)
      if (!valid) {
        expect(trakt.getTraktOAuthStatus().reason, uri).toBe("invalid_redirect_uri")
      }
    }
  })

  it("env conventions: canonical wins, legacy + raw fallbacks kept (secret ignored)", async () => {
    // Raw TRAKT_CLIENT_ID fallback (same as public-list client).
    process.env.TRAKT_CLIENT_ID = "raw-client-id"
    process.env.PICTORIUM_TRAKT_REDIRECT_URI = REDIRECT_DUCK
    let trakt = await loadTrakt()
    expect(trakt.getTraktOAuthConfig().clientId).toBe("raw-client-id")
    // Canonical wins over raw.
    process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
    trakt = await loadTrakt()
    expect(trakt.getTraktOAuthConfig().clientId).toBe(CLIENT_ID)
    // Legacy POSTERIUM_* fallback for the redirect URI (the secret was never
    // part of the PKCE config — only the redirect keeps its fallback).
    delete process.env.PICTORIUM_TRAKT_REDIRECT_URI
    process.env.POSTERIUM_TRAKT_CLIENT_SECRET = testSecret()
    process.env.POSTERIUM_TRAKT_REDIRECT_URI = REDIRECT_ELF
    trakt = await loadTrakt()
    expect(trakt.getTraktOAuthConfig().redirectUri).toBe(REDIRECT_ELF)
    // Canonical wins over legacy; the ignored secret never surfaces.
    process.env.PICTORIUM_TRAKT_REDIRECT_URI = REDIRECT_DUCK
    trakt = await loadTrakt()
    expect(trakt.getTraktOAuthConfig()).toEqual({ clientId: CLIENT_ID, redirectUri: REDIRECT_DUCK })
  })
})

describe("trakt token store (encrypted at rest)", () => {
  it("round-trip file: decryptable, metadata kept, never plaintext, 0600", async () => {
    const trakt = await loadTrakt()
    const expiresAt = Date.now() + 7200_000
    await trakt.saveTraktTokens(UUID_A, {
      accessToken: ACCESS_A,
      refreshToken: REFRESH_A,
      expiresAt,
      scope: "public",
      tokenType: "Bearer",
      redirectUri: REDIRECT_DUCK,
    })
    const read = await trakt.getTraktTokens(UUID_A)
    expect(read.status).toBe("connected")
    if (read.status !== "connected") return
    expect(read.tokens.accessToken).toBe(ACCESS_A)
    expect(read.tokens.refreshToken).toBe(REFRESH_A)
    expect(read.tokens.expiresAt).toBe(expiresAt)
    expect(read.tokens.scope).toBe("public")
    expect(read.tokens.tokenType).toBe("Bearer")
    expect(read.tokens.redirectUri).toBe(REDIRECT_DUCK)
    expect(await trakt.getTraktTokenStatus(UUID_A)).toBe("connected")

    const raw = await fsp.readFile(path.join(tempDir!, "users", UUID_A, "trakt.json"), "utf-8")
    expect(raw).not.toContain(ACCESS_A)
    expect(raw).not.toContain(REFRESH_A)
    if (process.platform !== "win32") {
      const st = await fsp.stat(path.join(tempDir!, "users", UUID_A, "trakt.json"))
      expect(st.mode & 0o777).toBe(0o600)
    }
  })

  it("overwrite preserves createdAt, unknown user is disconnected", async () => {
    const trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    const first = await trakt.getTraktTokens(UUID_A)
    expect(first.status).toBe("connected")
    await trakt.saveTraktTokens(UUID_A, { accessToken: ACCESS_B, refreshToken: REFRESH_B, expiresAt: Date.now() + 1000 })
    const second = await trakt.getTraktTokens(UUID_A)
    expect(second.status).toBe("connected")
    if (first.status !== "connected" || second.status !== "connected") return
    expect(second.tokens.accessToken).toBe(ACCESS_B)
    expect(second.tokens.createdAt).toBe(first.tokens.createdAt)
    expect(second.tokens.scope).toBeNull()
    expect(second.tokens.redirectUri).toBeNull()
    // Never linked: disconnected, never unavailable.
    expect(await trakt.getTraktTokens(UUID_B)).toEqual({ status: "disconnected", tokens: null, reason: "no_record" })
    expect(await trakt.getTraktTokenStatus(UUID_B)).toBe("disconnected")
    expect(await trakt.clearTraktTokens(UUID_B)).toBe(false)
  })

  it("user isolation: clear touches only the requested record", async () => {
    const trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    await trakt.saveTraktTokens(UUID_B, { accessToken: ACCESS_B, refreshToken: REFRESH_B, expiresAt: Date.now() + 5000 })
    expect(await trakt.clearTraktTokens(UUID_A)).toBe(true)
    expect(await trakt.getTraktTokenStatus(UUID_A)).toBe("disconnected")
    const stillThere = await trakt.getTraktTokens(UUID_B)
    expect(stillThere.status).toBe("connected")
    if (stillThere.status === "connected") expect(stillThere.tokens.accessToken).toBe(ACCESS_B)
    expect(await trakt.clearTraktTokens(UUID_A)).toBe(false)
  })

  it("invalid UUID rejected on every op, traversal blocked", async () => {
    const trakt = await loadTrakt()
    const bad = ["../../etc/passwd", "..", ".", "", "not-a-uuid", "11111111-1111-4111-8111-11111111111", `${UUID_A}/x`, "  "]
    for (const id of bad) {
      await expect(trakt.saveTraktTokens(id, tokenInput()), id).rejects.toThrow("Invalid user id")
      await expect(trakt.getTraktTokens(id), id).rejects.toThrow("Invalid user id")
      await expect(trakt.getTraktTokenStatus(id), id).rejects.toThrow("Invalid user id")
      await expect(trakt.clearTraktTokens(id), id).rejects.toThrow("Invalid user id")
    }
    // Nothing escaped the users dir: only valid-UUID namespaces may exist.
    const usersDir = path.join(tempDir!, "users")
    const entries = await fsp.readdir(usersDir).catch(() => [] as string[])
    for (const e of entries) {
      expect(e, `unexpected namespace dir: ${e}`).toMatch(/^[0-9a-f-]{36}$/i)
    }
  })

  it("fail-closed without encryption: writes rejected, deletes pass, reads unavailable", async () => {
    let trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    delete process.env.PROFILE_ENCRYPTION_KEY
    trakt = await loadTrakt()
    await expect(trakt.saveTraktTokens(UUID_A, tokenInput())).rejects.toThrowError(
      trakt.TraktTokensEncryptionUnavailableError,
    )
    // Deletes carry no material: allowed without env.
    expect(await trakt.clearTraktTokens(UUID_B)).toBe(false)
    // Malformed env (not 64 hex) = unavailable too.
    process.env.PROFILE_ENCRYPTION_KEY = "too-short"
    trakt = await loadTrakt()
    await expect(trakt.saveTraktTokens(UUID_A, tokenInput())).rejects.toThrowError(
      trakt.TraktTokensEncryptionUnavailableError,
    )
  })

  it("missing encryption on read: unavailable (never disconnected), record survives", async () => {
    let trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    delete process.env.PROFILE_ENCRYPTION_KEY
    trakt = await loadTrakt()
    expect(await trakt.getTraktTokens(UUID_A)).toEqual({
      status: "unavailable",
      tokens: null,
      reason: "encryption_unavailable",
    })
    expect(await trakt.getTraktTokenStatus(UUID_A)).toBe("unavailable")
  })

  it("tampered ciphertext: unavailable (never disconnected), record intact, rotation recoverable", async () => {
    const trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    const file = path.join(tempDir!, "users", UUID_A, "trakt.json")
    const parsed = JSON.parse(await fsp.readFile(file, "utf-8"))
    parsed.access.data = Buffer.from("tampered").toString("base64")
    await fsp.writeFile(file, JSON.stringify(parsed))
    expect(await trakt.getTraktTokens(UUID_A)).toEqual({
      status: "unavailable",
      tokens: null,
      reason: "decrypt_failed",
    })
    expect(await trakt.getTraktTokenStatus(UUID_A)).toBe("unavailable")
    // Tamper did not delete the record: fixing the bytes restores access.
    await trakt.saveTraktTokens(UUID_A, tokenInput())
    const healed = await trakt.getTraktTokens(UUID_A)
    expect(healed.status).toBe("connected")

    // Key rotation: same unavailable shape, and restoring the key recovers
    // without any re-save (proof nothing was deleted on transient failure).
    const goodKey = process.env.PROFILE_ENCRYPTION_KEY!
    process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
    const rotated = await loadTrakt()
    expect((await rotated.getTraktTokens(UUID_A)).status).toBe("unavailable")
    process.env.PROFILE_ENCRYPTION_KEY = goodKey
    const restored = await loadTrakt()
    const reread = await restored.getTraktTokens(UUID_A)
    expect(reread.status).toBe("connected")
    if (reread.status === "connected") expect(reread.tokens.accessToken).toBe(ACCESS_A)
  })

  it("malformed record: unavailable malformed, never throw, never disconnected", async () => {
    const trakt = await loadTrakt()
    const dir = path.join(tempDir!, "users", UUID_A)
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, "trakt.json"), "this is not json{{{")
    expect(await trakt.getTraktTokens(UUID_A)).toEqual({ status: "unavailable", tokens: null, reason: "malformed" })
    await fsp.writeFile(path.join(dir, "trakt.json"), JSON.stringify({ version: 2, nope: true }))
    expect(await trakt.getTraktTokens(UUID_A)).toEqual({ status: "unavailable", tokens: null, reason: "malformed" })
    await fsp.writeFile(path.join(dir, "trakt.json"), JSON.stringify({ version: 1, expiresAt: 123 }))
    expect(await trakt.getTraktTokens(UUID_A)).toEqual({ status: "unavailable", tokens: null, reason: "malformed" })
  })

  it("invalid token input rejected (never persisted)", async () => {
    const trakt = await loadTrakt()
    const bad = [
      { accessToken: "", refreshToken: REFRESH_A, expiresAt: 1 },
      { accessToken: ACCESS_A, refreshToken: "", expiresAt: 1 },
      { accessToken: "has space", refreshToken: REFRESH_A, expiresAt: 1 },
      { accessToken: 123, refreshToken: REFRESH_A, expiresAt: 1 },
      { accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt: NaN },
      { accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt: -5 },
      { accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt: 1, scope: "x".repeat(257) },
      { accessToken: ACCESS_A, refreshToken: REFRESH_A, expiresAt: 1, redirectUri: "not a url" },
    ]
    for (const input of bad) {
      await expect(trakt.saveTraktTokens(UUID_A, input as never)).rejects.toThrowError(trakt.InvalidTraktTokenError)
    }
    expect(await trakt.getTraktTokenStatus(UUID_A)).toBe("disconnected")
  })

  it("KV backend: encrypted round-trip, no disk file, cross-instance read", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const trakt = await loadTrakt()
    await trakt.saveTraktTokens(UUID_A, {
      accessToken: ACCESS_A,
      refreshToken: REFRESH_A,
      expiresAt: Date.now() + 3600_000,
      scope: "public",
      redirectUri: REDIRECT_ELF,
    })
    expect(await trakt.getTraktTokens(UUID_A)).toMatchObject({ status: "connected" })
    // Never plaintext at rest in KV…
    expect(JSON.stringify(kvStore.get(`user:${UUID_A}:trakt`))).not.toContain(ACCESS_A)
    expect(JSON.stringify(kvStore.get(`user:${UUID_A}:trakt`))).not.toContain(REFRESH_A)
    // …and never a file on disk (KV branch really taken).
    expect(await fsp.stat(path.join(tempDir!, "users", UUID_A, "trakt.json")).catch(() => null)).toBeNull()

    // Another instance (module reloaded): reads from shared KV.
    const reloaded = await loadTrakt()
    const reread = await reloaded.getTraktTokens(UUID_A)
    expect(reread.status).toBe("connected")
    if (reread.status === "connected") {
      expect(reread.tokens.accessToken).toBe(ACCESS_A)
      expect(reread.tokens.redirectUri).toBe(REDIRECT_ELF)
    }
    // Disconnect removes only this user's KV record.
    await trakt.saveTraktTokens(UUID_B, tokenInput())
    expect(await reloaded.clearTraktTokens(UUID_A)).toBe(true)
    expect(await reloaded.getTraktTokenStatus(UUID_A)).toBe("disconnected")
    expect(await reloaded.getTraktTokenStatus(UUID_B)).toBe("connected")
  })

  it("isTraktTokenExpired honors skew (pure helper for later refresh)", async () => {
    const trakt = await loadTrakt()
    expect(trakt.isTraktTokenExpired({ expiresAt: Date.now() + 3600_000 })).toBe(false)
    expect(trakt.isTraktTokenExpired({ expiresAt: Date.now() - 1000 })).toBe(true)
    expect(trakt.isTraktTokenExpired({ expiresAt: Date.now() + 30_000 })).toBe(true)
    expect(trakt.isTraktTokenExpired({ expiresAt: Date.now() + 30_000 }, 0)).toBe(false)
  })
})

describe("trakt-auth server boundary (no token spread to clients)", () => {
  function walkTs(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue
        walkTs(full, out)
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        out.push(full)
      }
    }
    return out
  }

  it("only server modules import trakt-auth / profile-crypto", () => {
    const root = process.cwd()
    const traktAllowed = new Set([
      path.join("src", "lib", "trakt-auth.ts"),
      path.join("src", "__tests__", "providers", "trakt-auth.test.ts"),
      // Task 2 (OAuth connect/state/callback/status): legitimate server-only
      // importers of the deployment config + encrypted token store.
      path.join("src", "app", "api", "users", "[uuid]", "trakt", "authorize", "route.ts"),
      path.join("src", "app", "api", "users", "[uuid]", "trakt", "status", "route.ts"),
      path.join("src", "app", "api", "trakt", "callback", "route.ts"),
      path.join("src", "__tests__", "providers", "trakt-oauth-flow.test.ts"),
      // Task 3 (coordinated refresh/disconnect lifecycle): the explicit
      // disconnect route and the lifecycle test use the same store/accessor.
      path.join("src", "app", "api", "users", "[uuid]", "trakt", "disconnect", "route.ts"),
      path.join("src", "__tests__", "providers", "trakt-lifecycle.test.ts"),
      // Task 4 (owning-user private catalogs): the server-only unified
      // catalog provider resolves the valid access token + fencing generation
      // internally from the caller-authorized UUID (never a request token).
      // Still server-only: node:crypto/cache imports already forbid client use.
      path.join("src", "lib", "custom-catalog-providers.ts"),
      // Task 4 correction cycle 1 (fail-closed outer cache): the Stremio
      // catalog handler establishes the same coherent token+generation
      // lease BEFORE any outer L1/L2 lookup and revalidates it before
      // serving/caching private bodies (destructures generation + status
      // only — the access token is never read here). Server-only like the
      // provider above (node:crypto + next/server imports).
      path.join("src", "lib", "catalog-handler.ts"),
      // Correction cycle 1 lease contract tests (real lease, scripted fence).
      path.join("src", "__tests__", "providers", "trakt-catalog-lease.test.ts"),
    ])
    const cryptoAllowed = new Set([
      path.join("src", "lib", "profile-crypto.ts"),
      path.join("src", "lib", "user-keys.ts"),
      // Instance API-key store (single-user deployments): same encrypted
      // envelope as the namespace store, server-only like `user-keys.ts`
      // (node:crypto/fs + KV imports already forbid any client use).
      path.join("src", "lib", "instance-keys.ts"),
      path.join("src", "lib", "trakt-auth.ts"),
      path.join("src", "__tests__", "providers", "trakt-auth.test.ts"),
      // PKCE: the OAuth state store encrypts the per-initiation verifier at
      // rest with the same PROFILE_ENCRYPTION_KEY envelope (server-only:
      // node:crypto/fs imports already forbid client use).
      path.join("src", "lib", "trakt-oauth-state.ts"),
      // Task 2: the authorize route fail-closes before start when encryption
      // is unavailable; the flow test provisions PROFILE_ENCRYPTION_KEY.
      path.join("src", "app", "api", "users", "[uuid]", "trakt", "authorize", "route.ts"),
      path.join("src", "__tests__", "providers", "trakt-oauth-flow.test.ts"),
    ])
    const edgeRe = /(?:from\s*["']|import\s*\(\s*["'])([^"']*(?:trakt-auth|profile-crypto)[^"']*)["']/g
    const violations: string[] = []
    for (const file of walkTs(path.join(root, "src"))) {
      const rel = path.relative(root, file)
      const source = fs.readFileSync(file, "utf-8")
      for (const m of source.matchAll(edgeRe)) {
        const spec = m[1]
        const allowed = spec.includes("profile-crypto") ? cryptoAllowed : traktAllowed
        if (!allowed.has(rel)) violations.push(`${rel} imports "${spec}"`)
      }
    }
    expect(violations).toEqual([])
  })

  it("server-only markers: node: imports present, no client directives", () => {
    for (const rel of ["src/lib/trakt-auth.ts", "src/lib/profile-crypto.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), rel), "utf-8")
      expect(source, `${rel} must pull Node-only builtins`).toMatch(/from\s*["']node:/)
      expect(source, `${rel} must never be a client component`).not.toMatch(/["']use client["']/)
    }
  })
})
