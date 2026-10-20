import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * File-backend single-use claim: concurrent renames of the same state file
 * can sometimes both resolve with readable duplicates (Windows MoveFile
 * semantics — rare, ~1/300 races), so rename alone does not mutually exclude
 * consumers. The fixed-name O_EXCL witness (`<state>.consumed`) provides the
 * fixed-name O_EXCL witness (`<state>.consumed`) provides the real
 * exactly-once boundary: N concurrent consumers → exactly one `ok`, every
 * other reader fails closed as `unknown` (replay), deterministically, in
 * this process and across processes/hosts sharing nothing but the dir.
 */
const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_REDIS_URL",
  "POSTERIUM_REDIS_URL",
  "REDIS_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "PICTORIUM_RATELIMIT_KV",
] as const

let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-traktclaim-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  for (const k of ENV_KEYS.slice(3)) delete process.env[k]
  vi.resetModules()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function loadState() {
  vi.resetModules()
  return import("@/lib/trakt-oauth-state")
}

async function stateDirEntries(): Promise<string[]> {
  return fsp.readdir(path.join(tempDir!, "trakt-oauth")).catch(() => [] as string[])
}

describe("file single-use witness (O_EXCL mutual exclusion)", () => {
  it("concurrent pairs link exactly once: 200 races, every loser is unknown", async () => {
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    for (let i = 0; i < 200; i++) {
      const created = await mod.createTraktOAuthState(uuid, "https://pictorium.duckdns.org/api/trakt/callback")
      const [a, b] = await Promise.all([
        mod.consumeTraktOAuthState(created.state, created.nonce),
        mod.consumeTraktOAuthState(created.state, created.nonce),
      ])
      const wins = [a, b].filter((r) => r.ok)
      expect(wins, `race ${i}: exactly one winner`).toHaveLength(1)
      const loser = [a, b].find((r) => !r.ok)!
      expect(loser).toEqual({ ok: false, reason: "unknown" })
      if (wins[0].ok) expect(wins[0].record.userId).toBe(uuid)
    }
  })

  it("32-way burst on one state: exactly one winner, 31 unknown", async () => {
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    const created = await mod.createTraktOAuthState(uuid, "https://pictorium.duckdns.org/api/trakt/callback")
    const results = await Promise.all(
      Array.from({ length: 32 }, () => mod.consumeTraktOAuthState(created.state, created.nonce)),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    for (const loser of results.filter((r) => !r.ok)) {
      expect(loser).toEqual({ ok: false, reason: "unknown" })
    }
  })

  it("duplicate-readable renames: exactly one winner (deterministic, OS-independent)", async () => {
    // Controlled boundary test: forces the residual platform case where two
    // renames of the same source BOTH resolve holding the SAME encrypted
    // record bytes (observed rarely on Windows; forced here on every OS).
    // Only the rename boundary is stubbed (narrowly: this state's source
    // only); reads, the O_EXCL witness write and the public consume API stay
    // real. Both reads are barriered before either witness attempt, so the
    // witness alone decides. Old code without the witness returns 2× ok
    // (fails); fixed code returns exactly 1 ok + 1 unknown (passes).
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    const redirect = "https://pictorium.duckdns.org/api/trakt/callback"
    const created = await mod.createTraktOAuthState(uuid, redirect)
    const source = path.join(tempDir!, "trakt-oauth", `${created.state}.json`)
    const realBytes = await fsp.readFile(source, "utf-8")

    const realRename = fsp.rename.bind(fsp)
    const realReadFile = fsp.readFile.bind(fsp)
    const realWriteFile = fsp.writeFile.bind(fsp)

    let renameCount = 0
    let readsCompleted = 0
    let notifyBothReads!: () => void
    const bothReads = new Promise<void>((resolve) => {
      notifyBothReads = resolve
    })

    const renameSpy = vi
      .spyOn(fsp, "rename")
      .mockImplementation(async (src: Parameters<typeof fsp.rename>[0], dest: Parameters<typeof fsp.rename>[1]) => {
        if (String(src) === source) {
          renameCount += 1
          if (renameCount === 1) {
            await realRename(src, dest)
            return
          }
          // Second claimant gets the SAME bytes: the duplicate-readable case.
          await realWriteFile(dest as string, realBytes, "utf-8")
          return
        }
        await realRename(src, dest)
      })
    const readSpy = vi.spyOn(fsp, "readFile").mockImplementation(async (file: unknown, opts: unknown) => {
      const data = await (realReadFile as (f: unknown, o: unknown) => Promise<never>)(file, opts)
      if (typeof file === "string" && file.endsWith(".claim")) {
        readsCompleted += 1
        if (readsCompleted === 2) notifyBothReads()
      }
      return data
    })
    const writeSpy = vi.spyOn(fsp, "writeFile").mockImplementation(async (file: unknown, data: unknown, opts: unknown) => {
      if (typeof file === "string" && file.endsWith(".consumed")) {
        await bothReads
        await (realWriteFile as (f: unknown, d: unknown, o: unknown) => Promise<never>)(file, data, opts)
        return
      }
      await (realWriteFile as (f: unknown, d: unknown, o: unknown) => Promise<never>)(file, data, opts)
    })

    try {
      const [a, b] = await Promise.all([
        mod.consumeTraktOAuthState(created.state, created.nonce),
        mod.consumeTraktOAuthState(created.state, created.nonce),
      ])
      expect(renameCount).toBe(2)
      expect(readsCompleted).toBe(2)
      const wins = [a, b].filter((r) => r.ok)
      expect(wins).toHaveLength(1)
      const loser = [a, b].find((r) => !r.ok)!
      expect(loser).toEqual({ ok: false, reason: "unknown" })
      if (wins[0].ok) {
        expect(wins[0].record.userId).toBe(uuid)
        expect(crypto.createHash("sha256").update(wins[0].verifier, "utf-8").digest("base64url")).toBe(
          created.codeChallenge,
        )
      }
    } finally {
      renameSpy.mockRestore()
      readSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })

  it("validation still burns the state: wrong nonce then correct nonce is unknown", async () => {
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    const created = await mod.createTraktOAuthState(uuid, "https://pictorium.duckdns.org/api/trakt/callback")
    expect(await mod.consumeTraktOAuthState(created.state, "wrong-nonce")).toEqual({
      ok: false,
      reason: "binding",
    })
    expect(await mod.consumeTraktOAuthState(created.state, created.nonce)).toEqual({
      ok: false,
      reason: "unknown",
    })
  })

  it("expired state burns and never links, live flow unaffected", async () => {
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    const old = await mod.createTraktOAuthState(uuid, "https://pictorium.duckdns.org/api/trakt/callback", {
      ttlMs: -1000,
    })
    expect(await mod.consumeTraktOAuthState(old.state, old.nonce)).toEqual({
      ok: false,
      reason: "expired",
    })
    const live = await mod.createTraktOAuthState(uuid, "https://pictorium.duckdns.org/api/trakt/callback")
    const ok = await mod.consumeTraktOAuthState(live.state, live.nonce)
    expect(ok.ok).toBe(true)
  })

  it("sweep reaps stale witnesses but keeps fresh ones", async () => {
    const mod = await loadState()
    const uuid = crypto.randomUUID()
    const redirect = "https://pictorium.duckdns.org/api/trakt/callback"

    // Consume a flow: leaves a fresh `<state>.consumed` witness.
    const first = await mod.createTraktOAuthState(uuid, redirect)
    expect((await mod.consumeTraktOAuthState(first.state, first.nonce)).ok).toBe(true)
    const witness = path.join(tempDir!, "trakt-oauth", `${first.state}.consumed`)
    await expect(fsp.stat(witness)).resolves.toBeTruthy()

    // A new flow triggers the opportunistic sweep (fire-and-forget): wait for
    // the sweep's own stat on the witness before asserting survival, so the
    // assertion cannot pass vacuously before the sweep ran.
    const sweepStatSpy = vi.spyOn(fsp, "stat")
    await mod.createTraktOAuthState(uuid, redirect)
    await vi.waitFor(() => {
      expect(sweepStatSpy.mock.calls.some(([p]) => String(p) === witness)).toBe(true)
    })
    sweepStatSpy.mockRestore()
    await expect(fsp.stat(witness)).resolves.toBeTruthy()

    // Backdate past the TTL: the next sweep reaps it. The sweep is
    // fire-and-forget, so poll for the real FS deletion event (no sleeps).
    const stale = Date.now() - 20 * 60 * 1000
    await fsp.utimes(witness, new Date(stale), new Date(stale))
    await mod.createTraktOAuthState(uuid, redirect)
    await vi.waitFor(async () => {
      await expect(fsp.stat(witness)).rejects.toThrow()
    })
    // No litter beyond live records: only state files remain.
    for (const entry of await stateDirEntries()) {
      expect(entry.endsWith(".consumed")).toBe(false)
    }
  })
})
