import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"
import { rateLimitKey } from "@/lib/rate-limit"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("user-auth")

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

/** True solo con opt-in esplicito: senza flag tutto resta byte-identico a oggi. */
export function isMultiUserEnabled(): boolean {
  return envWithFallback("MULTI_USER") === "1"
}

// UUID v4/v1 canonico, case-insensitive. Validato prima di qualsiasi uso in
// path (no traversal: niente `/`, `.`, `..` passa questo pattern) o chiave KV.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID normalizzato (lowercase) o null se assente/invalido. */
export function sanitizeUserId(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  return UUID_RE.test(v) ? v : null
}

/**
 * Namespace effettivo per una richiesta: l'UUID solo quando il flag è ON e
 * l'ID è valido. Con flag OFF ritorna sempre null → i caller usano il path
 * globale invariato (retrocompatibilità byte-identica).
 */
export function getScopedUserId(userParam: string | null | undefined): string | null {
  if (!isMultiUserEnabled()) return null
  return sanitizeUserId(userParam)
}

export function getMaxMappingsPerUser(): number {
  const raw = envWithFallback("MAX_MAPPINGS_PER_USER")
  const n = raw ? parseInt(raw, 10) : 500
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 500
}

/**
 * Cap anti-Sybil sul numero di namespace (istanza pubblica): `0` o assente =
 * nessun limite (comportamento storico). Oltre il cap `POST /api/users`
 * risponde 429. Env `PICTORIUM_MAX_USERS` (legacy `POSTERIUM_MAX_USERS`).
 */
export function getMaxUsers(): number {
  const raw = envWithFallback("MAX_USERS")
  if (raw === undefined || raw.trim() === "") return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 && n <= 1000000 ? n : 0
}

export function userDir(userId: string): string {
  return path.join(DATA_DIR, "users", userId)
}

function userAuthFile(userId: string): string {
  return path.join(userDir(userId), "auth.json")
}

function userAuthKvKey(userId: string): string {
  return `user:${userId}:auth`
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf-8").digest("hex")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export interface CreatedUser {
  uuid: string
  /** Mostrato una sola volta: mai persistito, mai loggato. */
  secret: string
}

/** Password utente (stile AIO): min 8, max 128. Il secret resta valido come recupero. */
export const MIN_USER_PASSWORD_LENGTH = 8
export const MAX_USER_PASSWORD_LENGTH = 128

/** Password non valida (lunghezza/tipo). Il caller risponde 400. */
export class InvalidUserPasswordError extends Error {
  constructor() {
    super(`Invalid password: use ${MIN_USER_PASSWORD_LENGTH}-${MAX_USER_PASSWORD_LENGTH} characters`)
    this.name = "InvalidUserPasswordError"
  }
}

export function normalizeUserPassword(value: unknown): string {
  if (typeof value !== "string") throw new InvalidUserPasswordError()
  // Trim degli estremi (tastiere mobile aggiungono spazi); spazi interni
  // ammessi (le passphrase con spazi sono ottime password).
  const v = value.trim()
  if (v.length < MIN_USER_PASSWORD_LENGTH || v.length > MAX_USER_PASSWORD_LENGTH) {
    throw new InvalidUserPasswordError()
  }
  return v
}

interface UserAuthRecord {
  hash?: string
  /** scrypt `salt:derived` (stessi parametri di pin-auth). Assente = password non impostata. */
  passwordHash?: string
  createdAt: string
}

async function readAuthRecord(userId: string): Promise<UserAuthRecord | null> {
  if (isKvMode()) {
    try {
      const raw = await getKv().get<UserAuthRecord>(userAuthKvKey(userId))
      if (raw && typeof raw === "object" && (typeof raw.hash === "string" || typeof raw.passwordHash === "string")) {
        return raw
      }
      return null
    } catch (e) {
      log.warn("user auth KV read failed", { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }
  try {
    const raw = await fsp.readFile(userAuthFile(userId), "utf-8")
    const parsed = JSON.parse(raw) as Partial<UserAuthRecord>
    if (parsed && typeof parsed === "object" && (typeof parsed.hash === "string" || typeof parsed.passwordHash === "string")) {
      return parsed as UserAuthRecord
    }
    return null
  } catch {
    return null
  }
}

async function writeAuthRecord(userId: string, record: UserAuthRecord): Promise<void> {
  if (isKvMode()) {
    await getKv().set(userAuthKvKey(userId), record)
    return
  }
  await fsp.mkdir(userDir(userId), { recursive: true })
  await atomicWriteFile(userAuthFile(userId), JSON.stringify(record), { mode: 0o600 })
}

function hashUserPassword(password: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString("hex")
  const derived = crypto.scryptSync(password, s, 64).toString("hex")
  return `${s}:${derived}`
}

/** Crea un utente: persiste solo sha256(secret) (+ scrypt(password) se data). Ritorna il secret in chiaro una volta sola. */
export async function createUser(password?: unknown): Promise<CreatedUser> {
  const uuid = crypto.randomUUID().toLowerCase()
  const secret = crypto.randomBytes(32).toString("base64url")
  const record: UserAuthRecord = { hash: hashSecret(secret), createdAt: new Date().toISOString() }
  if (password !== undefined && password !== null && password !== "") {
    record.passwordHash = hashUserPassword(normalizeUserPassword(password))
  }
  await writeAuthRecord(uuid, record)
  // Mai secret/password nei log: solo l'uuid.
  log.info("User created", { uuid })
  return { uuid, secret }
}

/** True se l'utente esiste (file o KV). Mai il secret in output. */
export async function userExists(userId: string): Promise<boolean> {
  if (isKvMode()) {
    try {
      return (await getKv().get(userAuthKvKey(userId))) != null
    } catch (e) {
      log.warn("user auth KV read failed", { error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }
  try {
    await fsp.stat(userAuthFile(userId))
    return true
  } catch {
    return false
  }
}

/** Verifica il secret utente contro lo sha256 persistito (timing-safe). */
export async function verifyUserToken(userId: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false
  const candidate = hashSecret(token)
  const record = await readAuthRecord(userId)
  const stored = record?.hash ?? null
  if (!stored) return false
  return constantTimeEqual(candidate, stored)
}

/**
 * Ruota il secret del namespace (revoca): richiede esistenza utente.
 * Genera un nuovo secret, sostituisce lo sha256 persistito (la password resta
 * invariata) e ritorna il nuovo secret in chiaro una volta sola.
 * Il vecchio secret smette di funzionare al primo uso successivo.
 */
export async function rotateUserSecret(userId: string): Promise<string> {
  const record = await readAuthRecord(userId)
  if (!record || typeof record.hash !== "string") throw new Error("User not found")
  const secret = crypto.randomBytes(32).toString("base64url")
  record.hash = hashSecret(secret)
  await writeAuthRecord(userId, record)
  log.info("User secret rotated", { uuid: userId })
  return secret
}

/** True se il namespace ha una password impostata (solo presenza, mai valori). */
export async function hasUserPassword(userId: string): Promise<boolean> {
  const record = await readAuthRecord(userId)
  return typeof record?.passwordHash === "string" && record.passwordHash.includes(":")
}

/** Verifica la password (scrypt, timing-safe). Assente = auth password disabilitata. */
export async function verifyUserPassword(userId: string, password: string | null | undefined): Promise<boolean> {
  if (!password || typeof password !== "string") return false
  const record = await readAuthRecord(userId)
  const stored = record?.passwordHash ?? null
  if (!stored || !stored.includes(":")) {
    // Timing uniforme anti-oracolo: un fantasma (o un utente senza password)
    // deve costare quanto un tentativo reale, altrimenti la durata dello
    // scrypt rivela (esistenza × ha-password). Lo scrypt dummy non tocca
    // alcun record: il risultato resta sempre false.
    dummyScrypt()
    return false
  }
  const sep = stored.indexOf(":")
  const salt = stored.slice(0, sep)
  const expected = stored.slice(sep + 1)
  if (!salt || !expected) {
    dummyScrypt()
    return false
  }
  // Stessa normalizzazione del set (trim estremi): " pass " al login matcha.
  const candidate = crypto.scryptSync(password.trim(), salt, 64).toString("hex")
  return constantTimeEqual(candidate, expected)
}

/** scrypt a vuoto (stessi parametri/costo di quello reale) per uniformare i tempi di risposta. */
function dummyScrypt(): void {
  const salt = crypto.randomBytes(16).toString("hex")
  crypto.scryptSync("dummy-password-for-timing-uniformity", salt, 64)
}

// ── Fail limiter password (anti grinding) ─────────────────────────────
// `checkUserAuth` è chiamato da endpoint con bucket larghi (mappings 120/10s,
// defaults 30/3s) e da uno senza bucket (GET /api/defaults): senza un freno
// centrale, la password (scrypt) sarebbe macinabile a decine di tentativi al
// secondo per IP. Il token bucket per-endpoint non basta perché gli endpoint
// legittimi (autosave con password) non devono 429are: qui si contano solo i
// FALLIMENTI (finestra scorrevole 5/5min per IP+UUID), i successi azzerano.
// A soglia raggiunta niente scrypt (fail-closed veloce, anche anti CPU-burn).
// Per-processo (come il throttle activity): su deploy multi-istanza il
// backstop cross-instance resta il bucket stretto `users-password` degli
// endpoint dedicati (verify/rotate/password/reveal).

const PW_FAIL_WINDOW_MS = 5 * 60 * 1000
const PW_FAIL_MAX = 5
const PW_FAIL_CAP = 2000
const pwFails = new Map<string, number[]>()

function pwFailPrune(key: string, now: number): number[] {
  const list = pwFails.get(key) ?? []
  const fresh = list.filter((t) => now - t < PW_FAIL_WINDOW_MS)
  if (fresh.length === 0) pwFails.delete(key)
  else pwFails.set(key, fresh)
  return fresh
}

/** Solo test: azzera i contatori di fallimenti password. */
export function __resetPwFailsForTests(): void {
  pwFails.clear()
}

/** Imposta/sostituisce la password (richiede esistenza utente). */
export async function setUserPassword(userId: string, password: unknown): Promise<void> {
  const normalized = normalizeUserPassword(password)
  const record = (await readAuthRecord(userId)) ?? { createdAt: new Date().toISOString() }
  record.passwordHash = hashUserPassword(normalized)
  await writeAuthRecord(userId, record)
  log.info("User password updated", { uuid: userId })
}

/** Rimuove la password (resta il secret). */
export async function clearUserPassword(userId: string): Promise<void> {
  const record = await readAuthRecord(userId)
  if (!record) return
  delete record.passwordHash
  await writeAuthRecord(userId, record)
  log.info("User password cleared", { uuid: userId })
}

/**
 * Parametro `u`/`user` dalla richiesta. Tollera i plain `Request` dei test
 * (senza `nextUrl`): fallback al parse di `req.url`. Mai un throw.
 */
export function extractUserParam(req: {
  nextUrl?: { searchParams: URLSearchParams }
  url?: string
}): string | null {
  try {
    const sp = req.nextUrl?.searchParams ?? (req.url ? new URL(req.url).searchParams : null)
    if (!sp) return null
    return sp.get("u") ?? sp.get("user")
  } catch {
    return null
  }
}

/** Secret dalla richiesta: header `x-user-token` > `Authorization: Bearer`. Mai dalla query. */
export function extractUserToken(req: { headers: Headers | { get: (name: string) => string | null } }): string | null {
  const direct = req.headers.get("x-user-token")
  if (direct && direct.trim()) return direct.trim()
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (bearer && bearer.trim()) return bearer.trim()
  return null
}

/** Password dalla richiesta: header `x-user-password`. Mai dalla query (stessa regola dei secret). */
export function extractUserPassword(req: { headers: Headers | { get: (name: string) => string | null } }): string | null {
  const direct = req.headers.get("x-user-password")
  if (direct && direct.length > 0) return direct
  return null
}

/**
 * Autenticazione completa sul namespace: secret (veloce) oppure password
 * (scrypt, solo se presentata). Da usare in tutti gli endpoint scoped così
 * le due credenziali restano intercambiabili senza duplicare la logica.
 *
 * Il ramo password passa dal fail limiter centrale (solo fallimenti, vedi
 * sopra): a soglia raggiunta niente scrypt. I successi non contano mai, così
 * l'autosave legittimo con password non 429a.
 */
export async function checkUserAuth(
  req: { headers: Headers | { get: (name: string) => string | null } },
  userId: string,
): Promise<boolean> {
  const token = extractUserToken(req)
  if (token && (await verifyUserToken(userId, token))) return true
  const password = extractUserPassword(req)
  if (!password) return false
  const failKey = `${rateLimitKey(req as Request)}|pw:${userId}`
  if (pwFailPrune(failKey, Date.now()).length >= PW_FAIL_MAX) return false
  if (await verifyUserPassword(userId, password)) {
    pwFails.delete(failKey)
    return true
  }
  const now = Date.now()
  const list = pwFailPrune(failKey, now)
  list.push(now)
  pwFails.set(failKey, list)
  if (pwFails.size > PW_FAIL_CAP) {
    const oldest = pwFails.keys().next().value
    if (oldest !== undefined) pwFails.delete(oldest)
  }
  return false
}

export function userAuthResponse(status = 401): Response {
  return new Response(JSON.stringify({ error: "Unauthorized. Set x-user-token or Authorization: Bearer header." }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

export function invalidUserResponse(): Response {
  return new Response(JSON.stringify({ error: "Invalid user id" }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

/**
 * Chiave bucket rate-limit per-utente: IP chiamante + UUID (composita).
 * Il bucket `user:<uuid>` da solo era indirizzabile da chiunque via `?u=`
 * senza token (DoS cross-user 1:1 sul bucket della vittima): con l'IP dentro,
 * l'attaccante brucia solo il proprio sotto-bucket e la quota legittima del
 * proprietario (stesso IP del suo browser) resta separata dagli IP altrui.
 */
export function userRateLimitKey(req: Request, userId: string): string {
  return `${rateLimitKey(req)}|user:${userId}`
}

/**
 * Identità canonica sulle route `/u/<uuid>/...` (anti confused-deputy):
 * il path vince sempre. Se la query `?u=`/`?user=` è presente e diverge dal
 * path (dopo sanitizzazione), ritorna `{ mismatch: true }` e il caller deve
 * rispondere 400 senza toccare alcun namespace. Query assente o uguale →
 * `{ user }`. Con flag OFF ritorna comunque il path sanitizzato (i caller
 * lo ignorano via getScopedUserId → null, byte-identico).
 */
export function resolvePathUser(
  pathUser: string | null | undefined,
  queryUser: string | null | undefined,
): { user: string | null; mismatch: boolean } {
  const pathId = sanitizeUserId(pathUser)
  if (queryUser === null || queryUser === undefined || queryUser === "") {
    return { user: pathId, mismatch: false }
  }
  const queryId = sanitizeUserId(queryUser)
  // Query invalida (non-UUID): la ignora Stremio? No — fail-closed: se il
  // client manda `?u=garbage` su path scoped è un errore di integrazione,
  // ma non una doppia identità. La trattiamo come mismatch solo se sembra
  // un tentativo di identità alternativa: qualsiasi `?u=` non vuoto e diverso
  // dal path normalizzato → 400. Semplice, predicibile, testabile.
  if (queryId === null) return { user: pathId, mismatch: true }
  if (pathId === null) return { user: null, mismatch: true }
  if (queryId !== pathId) return { user: pathId, mismatch: true }
  return { user: pathId, mismatch: false }
}
