/**
 * Trakt OAuth connect-state store — task 2/plan: opaque one-time server-side
 * state binding the initiating browser to the initiating profile.
 *
 * SERVER-ONLY: imports `node:crypto`/`node:fs` (same rule as `trakt-auth.ts` —
 * no `server-only` package import, boundary enforced by the import graph).
 * NEVER import from client components or shared client/server leaves. Only
 * `src/app/api/**` Trakt routes may import this module.
 *
 * Flow binding (login-CSRF protection + PKCE):
 * - `POST /api/users/[uuid]/trakt/authorize` creates `{state, nonce}`,
 *   generates a per-initiation PKCE `code_verifier` (43–128 unreserved
 *   chars, cryptographically random), keeps `{userId, nonceHash,
 *   redirectUri, encryptedVerifier, expiry}` server-side (file or KV) and
 *   sets the `nonce` in an HttpOnly browser cookie. The `state` travels to
 *   Trakt inside the authorize URL; the `nonce` never leaves the browser;
 *   only the derived `code_challenge` (S256) travels in the authorize URL —
 *   the verifier itself never appears in URLs, cookies, logs or responses.
 * - `GET /api/trakt/callback` consumes the state ATOMICALLY (single-use:
 *   replayed/concurrent callbacks lose the race), decrypts the verifier in
 *   server memory only, and only then compares the cookie nonce against the
 *   stored hash (constant-time). A callback without the initiating browser's
 *   cookie is rejected — the endpoint is necessarily unauthenticated in
 *   `x-user-header` terms, so this binding is the auth. The transient
 *   verifier dies with the consumed record on EVERY outcome (no reuse).
 * - `GET /api/trakt/callback` consumes the state ATOMICALLY (single-use:
 *   replayed/concurrent callbacks lose the race) and only then compares the
 *   cookie nonce against the stored hash (constant-time). A callback without
 *   the initiating browser's cookie is rejected — the endpoint is necessarily
 *   unauthenticated in `x-user-header` terms, so this binding is the auth.
 *
 * Single outstanding flow per browser (deliberate): one cookie name
 * (`pictorium_trakt_oauth`). Starting a second flow overwrites the cookie, so
 * the older flow fails closed with a binding error and must be restarted.
 * This keeps cookies bounded (no per-state cookie accumulation) and the
 * server state single-use either way.
 *
 * Persistence: `trakt-oauth/<state>.json` files (0600, atomic write) or the
 * shared KV backend (`trakt:oauth:<state>`, 10 min TTL) — same dual-backend
 * pattern as `user-keys.ts`/`trakt-auth.ts`. File consume claims the record
 * via an atomic rename (loser gets ENOENT → replay) PLUS a fixed-name
 * O_EXCL witness (`<state>.consumed`): rename resolution alone is NOT
 * mutually exclusive — concurrent renames of the same source to different
 * destinations can sometimes both resolve with readable duplicates
 * (observed on Windows, rare ~1/300 races), so exactly one witness creator
 * wins and every other duplicate reader fails closed as a replay. Stale witnesses (crash between
 * witness-create and claim-unlink, or a duplicate claim that lost the
 * witness race) are reaped by the opportunistic sweep past one TTL.
 * KV consume uses ONLY server-side EVAL get-and-del. EVAL failure is
 * fail-closed (no record, no get+del fallback): a non-atomic fallback would
 * let two concurrent callbacks both consume during an EVAL outage.
 *
 * No plaintext secrets at rest here: only the sha256 of the browser nonce,
 * the user id, the configured redirect URI and the AES-256-GCM-encrypted
 * PKCE verifier (same `PROFILE_ENCRYPTION_KEY` envelope as the OAuth tokens
 * in `trakt-auth.ts`; fail-closed when encryption is unavailable). OAuth
 * tokens stay in `trakt-auth.ts`.
 */
import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { atomicWriteFile } from "@/lib/atomic-write"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { getKv, getStorageMode } from "@/lib/kv"
import {
  decryptProfileSecret,
  encryptProfileSecret,
  isValidEncBundle,
  profileEncryptionKey,
  type EncBundle,
} from "@/lib/profile-crypto"

const log = createLogger("trakt-oauth-state")

// Lettura live (mai a module level): i test mutano le env + resetModules.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

/** Server state TTL + browser cookie lifetime (10 min). */
export const TRAKT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const TRAKT_OAUTH_STATE_TTL_SEC = 600

/** Single-outstanding-flow binding cookie (see module doc). */
export const TRAKT_OAUTH_COOKIE_NAME = "pictorium_trakt_oauth"

/** Cookie is only ever sent to the canonical callback path. */
export const TRAKT_OAUTH_COOKIE_PATH = "/api/trakt/callback"

/** Opaque state id: 32 random bytes as base64url (always 43 chars). */
const STATE_RE = /^[A-Za-z0-9_-]{43}$/

/**
 * PKCE verifier alphabet (RFC 7636 unreserved): `A-Z a-z 0-9 -._~`,
 * 43–128 chars. Trakt only supports the `S256` challenge method.
 */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

/** Verifier generation refused: encryption unavailable → fail-closed, never plaintext. */
export class TraktOAuthStateEncryptionUnavailableError extends Error {
  constructor() {
    super("Trakt OAuth state encryption is unavailable: set PROFILE_ENCRYPTION_KEY (openssl rand -hex 32)")
    this.name = "TraktOAuthStateEncryptionUnavailableError"
  }
}

/**
 * Fresh cryptographically-secure PKCE verifier per initiation: 64 random
 * bytes as base64url (86 chars — inside the 43–128 range, unreserved
 * alphabet). Discard after the exchange; never persist plaintext.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url")
}

/**
 * `S256` challenge: base64url (no padding) of SHA-256 over the verifier.
 * The ONLY method Trakt accepts. Throws on a malformed verifier (fail-closed:
 * never derive a challenge for an out-of-range input).
 */
export function deriveCodeChallengeS256(verifier: string): string {
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) {
    throw new Error("Invalid PKCE verifier")
  }
  return crypto.createHash("sha256").update(verifier, "utf-8").digest("base64url")
}

export interface TraktOAuthStateRecord {
  version: 1
  /** Profile that started the flow — tokens are saved ONLY here. */
  userId: string
  /** sha256 hex of the browser cookie nonce (never the nonce itself). */
  nonceHash: string
  /** Configured redirect URI bound at initiation (exact-match on callback). */
  redirectUri: string
  /**
   * PKCE verifier bound at initiation, AES-256-GCM envelope (same key as
   * the token store). Decrypted in server memory only at consume time for
   * the code exchange; dies with the record on every outcome. Never the
   * plaintext in files, KV, cookies, URLs, responses or logs.
   */
  verifier: EncBundle
  /**
   * Fencing generation bound AT INITIATION (task 3 correction): the
   * callback carries this initiator snapshot and the guarded save commits
   * only when the live generation still matches. A flow started, then
   * disconnected before the callback, can never relink — the disconnect's
   * fence moved the generation. Null when the profile was never fenced.
   */
  traktGen: string | null
  createdAt: number
  expiresAt: number
}

export interface TraktOAuthStateCreated {
  state: string
  /** Set once in the HttpOnly cookie; never logged, never in URLs. */
  nonce: string
  /**
   * S256 challenge for the authorize URL (public by design — it travels in
   * the URL). The verifier itself is NEVER returned here.
   */
  codeChallenge: string
  expiresAt: number
}

export type TraktStateConsume =
  | { ok: true; record: TraktOAuthStateRecord; verifier: string }
  | { ok: false; reason: "unknown" | "expired" | "malformed" | "binding" | "verifier" }

function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

function hashNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce, "utf-8").digest("hex")
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function stateDir(): string {
  return path.join(DATA_DIR, "trakt-oauth")
}

function stateFile(state: string): string {
  return path.join(stateDir(), `${state}.json`)
}

function stateKvKey(state: string): string {
  return `trakt:oauth:${state}`
}

/**
 * Fixed per-state single-use witness. Created with O_EXCL (`wx`) AFTER the
 * rename-claim and its verifying read, so exactly one duplicate reader wins
 * no matter how the renames resolved (rename resolution is not exclusive
 * across threads/processes on every platform). The winner keeps it — it is
 * never deleted on the consume path, so a slow duplicate reader can never
 * win a recreated witness. The opportunistic sweep reaps it past one TTL
 * (the guarded record expires by then, so no late reader can ever go `ok`).
 * Payload is a bare timestamp: no user, nonce, verifier or secret.
 */
function stateWitnessFile(state: string): string {
  return path.join(stateDir(), `${state}.consumed`)
}

function isValidRecord(v: unknown): v is TraktOAuthStateRecord {
  if (!v || typeof v !== "object") return false
  const r = v as Record<string, unknown>
  return (
    r.version === 1 &&
    typeof r.userId === "string" &&
    /^[0-9a-f-]{36}$/i.test(r.userId) &&
    typeof r.nonceHash === "string" &&
    /^[0-9a-f]{64}$/i.test(r.nonceHash) &&
    typeof r.redirectUri === "string" &&
    r.redirectUri.length > 0 &&
    // Encrypted PKCE verifier: mandatory (records predating it fail closed
    // as malformed — they can never complete an exchange).
    isValidEncBundle(r.verifier) &&
    // Initiation-bound fence: present in all new flows; missing (pre-fix
    // records, ≤10min TTL) is treated as null at consume time, never as a
    // bypass — a null snapshot still fences against any later disconnect.
    (r.traktGen === undefined || r.traktGen === null || typeof r.traktGen === "string") &&
    typeof r.createdAt === "number" &&
    Number.isFinite(r.createdAt) &&
    typeof r.expiresAt === "number" &&
    Number.isFinite(r.expiresAt)
  )
}

function parseStored(raw: unknown): TraktOAuthStateRecord | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  return isValidRecord(raw) ? raw : null
}

/** Browser binding cookie (repo convention: Secure only in production, like pin-auth). */
export function buildTraktOAuthCookie(nonce: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${TRAKT_OAUTH_COOKIE_NAME}=${nonce}; Path=${TRAKT_OAUTH_COOKIE_PATH}; Max-Age=${TRAKT_OAUTH_STATE_TTL_SEC}; HttpOnly; SameSite=Lax${secure}`
}

/** Terminal responses always clear the binding cookie (same Path). */
export function buildClearTraktOAuthCookie(): string {
  return `${TRAKT_OAUTH_COOKIE_NAME}=; Path=${TRAKT_OAUTH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`
}

// Atomic get-and-delete: the record exists exactly once, so concurrent
// callbacks cannot both win (the loser sees no record → replay rejected).
const CONSUME_SCRIPT = `local v = redis.call("GET", KEYS[1])
if v then
  redis.call("DEL", KEYS[1])
  return v
end
return nil`

async function consumeKvRecord(key: string): Promise<unknown> {
  // Atomic-only: EVAL get-and-del is the single-use guarantee. Any EVAL
  // failure (unsupported/outage/timeout) propagates to the caller, which
  // fails closed with NO get+del fallback — a non-atomic fallback would let
  // two concurrent callbacks both read the record before either deletes it.
  const kv = getKv()
  const raw = await kv.eval<unknown>(CONSUME_SCRIPT, [key], [])
  return raw ?? null
}

/**
 * Claim the file record via atomic rename, then prove exclusivity with the
 * fixed-name O_EXCL witness. The rename moves the record to a unique claim
 * (loser gets ENOENT) and the verifying read catches renames that resolved
 * without landing; the witness covers the residual case where concurrent
 * renames of the same source can sometimes both resolve with readable
 * duplicate claims (observed on Windows, rare) — exactly one witness creator wins, every other duplicate reader
 * fails closed as a replay (`unknown`). Read-before-witness preserves
 * liveness: whenever at least one claim holds the bytes, exactly one
 * consumer proceeds (a witness-first order could crown an empty claim and
 * wedge a live flow). Stale `.claim` files (crash between rename and unlink)
 * are reaped by the opportunistic sweep on create.
 */
async function consumeFileRecord(state: string): Promise<unknown> {
  const file = stateFile(state)
  const claim = `${file}.${crypto.randomBytes(8).toString("hex")}.claim`
  try {
    await fsp.rename(file, claim)
  } catch (e) {
    // ENOENT = unknown/tampered/replayed/consumed. Anything else (perm/IO)
    // is fail-closed the same way: no record, no tokens touched.
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) {
      log.warn("trakt oauth state claim failed")
    }
    return null
  }
  let raw: string
  try {
    raw = await fsp.readFile(claim, "utf-8")
  } catch {
    return null
  } finally {
    await fsp.unlink(claim).catch(() => {})
  }
  try {
    await fsp.writeFile(stateWitnessFile(state), JSON.stringify({ createdAt: Date.now() }), {
      flag: "wx",
      mode: 0o600,
    })
  } catch (e) {
    // EEXIST = a duplicate reader already won this state (replay). Any
    // other IO trouble is fail-closed the same way: the record is already
    // consumed (source renamed away), so the flow must restart either way.
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EEXIST")) {
      log.warn("trakt oauth state witness failed")
    }
    return null
  }
  return raw
}

/** Opportunistic reaping of expired state files (best-effort, never throws). */
async function sweepExpiredFileStates(now: number): Promise<void> {
  try {
    const dir = stateDir()
    const entries = await fsp.readdir(dir)
    let checked = 0
    for (const entry of entries) {
      if (checked++ > 100) break
      const full = path.join(dir, entry)
      if (/^[A-Za-z0-9_-]{43}\.consumed$/.test(entry)) {
        // Single-use witness whose state is long consumed (or a duplicate
        // claim that lost the witness race): reap past one TTL by mtime.
        // Fresh witnesses MUST survive — a slow duplicate reader may still
        // be in flight inside the race window, and reaping early would
        // reopen it. Past-TTL readers can only ever see `expired`, never
        // `ok`, so late reaping is safe.
        try {
          const st = await fsp.stat(full)
          if (st.mtimeMs < now - TRAKT_OAUTH_STATE_TTL_MS) await fsp.unlink(full).catch(() => {})
        } catch {
          /* race: gone already */
        }
        continue
      }
      if (/^[A-Za-z0-9_-]{43}\.json\.[0-9a-f]+\.claim$/.test(entry)) {
        // Orphaned claim (crash mid-consume): reap past one TTL by mtime.
        try {
          const st = await fsp.stat(full)
          if (st.mtimeMs < now - TRAKT_OAUTH_STATE_TTL_MS) await fsp.unlink(full).catch(() => {})
        } catch {
          /* race: gone already */
        }
        continue
      }
      if (!/^[A-Za-z0-9_-]{43}\.json$/.test(entry)) continue
      try {
        const raw = JSON.parse(await fsp.readFile(full, "utf-8")) as Partial<TraktOAuthStateRecord>
        if (typeof raw.expiresAt !== "number" || !Number.isFinite(raw.expiresAt) || raw.expiresAt <= now) {
          await fsp.unlink(full).catch(() => {})
        }
      } catch {
        // Unparseable file in our private dir can never be consumed: drop it.
        await fsp.unlink(full).catch(() => {})
      }
    }
  } catch {
    /* missing dir or IO trouble: never break the authorize path */
  }
}

/**
 * Start a flow: generate the PKCE verifier, persist the binding record and
 * return the opaque `state` (for the Trakt authorize URL), the S256
 * `codeChallenge` (for the authorize URL — public by design) plus the
 * one-time browser `nonce` (for the HttpOnly cookie). `ttlMsOverride` exists
 * for tests (e.g. immediately expired states); callers pass no override in
 * production. `traktGen` is the fencing generation bound at initiation
 * (missing → null snapshot). Fails closed without valid encryption: the
 * verifier is a secret and is never stored plaintext.
 */
export async function createTraktOAuthState(
  userId: string,
  redirectUri: string,
  opts?: { ttlMs?: number; traktGen?: string | null },
): Promise<TraktOAuthStateCreated> {
  assertValidUserId(userId)
  if (typeof redirectUri !== "string" || !redirectUri) throw new Error("Invalid redirect uri")
  const ttlMs = opts?.ttlMs ?? TRAKT_OAUTH_STATE_TTL_MS
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) throw new Error("Invalid ttl")
  if (opts?.traktGen !== undefined && opts.traktGen !== null && typeof opts.traktGen !== "string") {
    throw new Error("Invalid trakt generation")
  }
  const key = profileEncryptionKey()
  if (!key) throw new TraktOAuthStateEncryptionUnavailableError()
  const state = crypto.randomBytes(32).toString("base64url")
  const nonce = crypto.randomBytes(32).toString("base64url")
  const verifier = generateCodeVerifier()
  const now = Date.now()
  const record: TraktOAuthStateRecord = {
    version: 1,
    userId,
    nonceHash: hashNonce(nonce),
    redirectUri,
    verifier: encryptProfileSecret(verifier, key),
    traktGen: opts?.traktGen ?? null,
    createdAt: now,
    expiresAt: now + ttlMs,
  }
  // Never state/nonce/user binding details in logs: only the outcome.
  if (isKvMode()) {
    await getKv().set(stateKvKey(state), record, { ex: TRAKT_OAUTH_STATE_TTL_SEC })
  } else {
    await fsp.mkdir(stateDir(), { recursive: true })
    await atomicWriteFile(stateFile(state), JSON.stringify(record), { mode: 0o600 })
    void sweepExpiredFileStates(now)
  }
  log.info("Trakt OAuth flow started")
  return { state, nonce, codeChallenge: deriveCodeChallengeS256(verifier), expiresAt: record.expiresAt }
}

/**
 * Single-use consume + browser binding verification. The record (verifier
 * included) is destroyed BEFORE any check, so every outcome
 * (expired/malformed/binding/verifier/denied) burns the state: replays
 * always land on `unknown`. `nonceCandidate` is the raw cookie value (or
 * null when the browser sent no cookie). On success the decrypted verifier
 * travels in server memory only — for the immediate code exchange, never
 * for cookies, URLs, responses or logs.
 */
export async function consumeTraktOAuthState(
  state: unknown,
  nonceCandidate: unknown,
): Promise<TraktStateConsume> {
  if (typeof state !== "string" || !STATE_RE.test(state)) {
    return { ok: false, reason: "unknown" }
  }
  let raw: unknown
  try {
    raw = isKvMode() ? await consumeKvRecord(stateKvKey(state)) : await consumeFileRecord(state)
  } catch {
    log.warn("trakt oauth state consume failed")
    return { ok: false, reason: "unknown" }
  }
  if (raw === null || raw === undefined) {
    // Never existed, already consumed (replay), or concurrently consumed.
    return { ok: false, reason: "unknown" }
  }
  const record = parseStored(raw)
  if (!record) {
    log.warn("trakt oauth state malformed")
    return { ok: false, reason: "malformed" }
  }
  if (record.expiresAt <= Date.now()) return { ok: false, reason: "expired" }
  if (typeof nonceCandidate !== "string" || !nonceCandidate) return { ok: false, reason: "binding" }
  if (!constantTimeEqualHex(hashNonce(nonceCandidate), record.nonceHash)) {
    return { ok: false, reason: "binding" }
  }
  // Decrypt the PKCE verifier last (binding first): missing/rotated
  // encryption or a tampered envelope fails closed with no exchange.
  const key = profileEncryptionKey()
  if (!key) return { ok: false, reason: "verifier" }
  let verifier: string
  try {
    verifier = decryptProfileSecret(record.verifier, key)
  } catch {
    return { ok: false, reason: "verifier" }
  }
  if (!VERIFIER_RE.test(verifier)) return { ok: false, reason: "verifier" }
  // Pre-fix records lack the initiation fence: normalize to the null
  // snapshot (still fences against any later disconnect).
  return { ok: true, record: { ...record, traktGen: record.traktGen ?? null }, verifier }
}
