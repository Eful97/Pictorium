import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { createLogger } from "@/lib/logger"
import { userDir } from "@/lib/user-auth"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("user-keys")

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

export type UserKeyKind = "tmdb" | "mdblist" | "tvdb" | "simkl"
export const USER_KEY_KINDS: readonly UserKeyKind[] = ["tmdb", "mdblist", "tvdb", "simkl"]

export type UserKeys = Partial<Record<UserKeyKind, string>>

/** Salvataggio rifiutato: cifratura non disponibile → fail-closed, mai in chiaro. */
export class KeysEncryptionUnavailableError extends Error {
  constructor() {
    super("Profile key encryption is unavailable: set PROFILE_ENCRYPTION_KEY (openssl rand -hex 32)")
    this.name = "KeysEncryptionUnavailableError"
  }
}

/** Valore chiave non valido (vuoto oltre il consentito / troppo lungo). */
export class InvalidUserKeyError extends Error {
  constructor(kind: string) {
    super(`Invalid API key for ${kind}`)
    this.name = "InvalidUserKeyError"
  }
}

function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

/**
 * Chiave AES-256-GCM da PROFILE_ENCRYPTION_KEY (`openssl rand -hex 32`).
 * Stretta di proposito: solo 64 hex chars (= 32 byte). Qualsiasi altro
 * formato → null (fail-closed, mai cifratura debole/silente).
 */
function encryptionKey(): Buffer | null {
  const raw = process.env.PROFILE_ENCRYPTION_KEY?.trim()
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) return null
  return Buffer.from(raw, "hex")
}

export function isUserKeysEncryptionAvailable(): boolean {
  return encryptionKey() !== null
}

interface EncBundle {
  iv: string
  tag: string
  data: string
}

interface KeysFile {
  version: 1
  keys: Partial<Record<UserKeyKind, EncBundle>>
  /** Soft-disable per kind (plaintext, mai segreti): la chiave resta cifrata
   * a riposo ma non viene usata per la risoluzione. Assente = tutto attivo. */
  disabled?: Partial<Record<UserKeyKind, boolean>>
  updatedAt: string
}

function encryptSecret(plaintext: string, key: Buffer): EncBundle {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  }
}

function decryptSecret(bundle: EncBundle, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"))
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(bundle.data, "base64")), decipher.final()]).toString("utf8")
}

function keysFile(userId: string): string {
  return path.join(userDir(userId), "keys.json")
}

function keysKvKey(userId: string): string {
  return `user:${userId}:keys`
}

function isValidBundle(v: unknown): v is EncBundle {
  if (!v || typeof v !== "object") return false
  const b = v as Record<string, unknown>
  return typeof b.iv === "string" && typeof b.tag === "string" && typeof b.data === "string"
}

async function readKeysFile(userId: string): Promise<KeysFile | null> {
  if (isKvMode()) {
    try {
      const raw = await getKv().get<KeysFile>(keysKvKey(userId))
      if (raw && typeof raw === "object" && raw.version === 1 && raw.keys && typeof raw.keys === "object") {
        return raw
      }
      return null
    } catch (e) {
      log.warn("user keys KV read failed", { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }
  try {
    const raw = await fsp.readFile(keysFile(userId), "utf-8")
    const parsed = JSON.parse(raw) as Partial<KeysFile>
    if (parsed?.version === 1 && parsed.keys && typeof parsed.keys === "object") {
      return parsed as KeysFile
    }
    return null
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return null
    log.warn("user keys read failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Chiavi decifrate del namespace (solo memoria, mai loggate).
 * Bundle non decifrabili (env ruotata/rimossa — v1 non supporta rotazione) →
 * skippati con error log e trattati come assenti (degraded, mai throw).
 * Le kind disattivate (soft-disable) sono escluse di default: la risoluzione
 * (cataloghi, poster, meta) non le vede. Solo azioni esplicite del
 * proprietario (reveal, riattivazione) usano `includeDisabled: true`.
 */
export async function getUserKeys(userId: string, opts?: { includeDisabled?: boolean }): Promise<UserKeys> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  if (!file) return {}
  const key = encryptionKey()
  if (!key) {
    log.error("user keys present but PROFILE_ENCRYPTION_KEY is missing/invalid — treating as key-missing")
    return {}
  }
  const disabled = file.disabled ?? {}
  const out: UserKeys = {}
  for (const kind of USER_KEY_KINDS) {
    if (!opts?.includeDisabled && disabled[kind] === true) continue
    const bundle = file.keys[kind]
    if (!isValidBundle(bundle)) continue
    try {
      const value = decryptSecret(bundle, key)
      if (value) out[kind] = value
    } catch {
      // Tamper o env cambiata: la singola kind degrada ad assente.
      log.error("user key failed to decrypt — treating as missing", { kind })
    }
  }
  return out
}

/** Flag soft-disable per kind (tutto false se mai impostato). */
export async function getUserKeysDisabled(userId: string): Promise<Record<UserKeyKind, boolean>> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  const disabled = file?.disabled ?? {}
  return {
    tmdb: disabled.tmdb === true,
    mdblist: disabled.mdblist === true,
    tvdb: disabled.tvdb === true,
    simkl: disabled.simkl === true,
  }
}

/** Solo presenza per kind (booleans): nessun valore, nessuna decifratura. */
export async function getUserKeysStatus(userId: string): Promise<Record<UserKeyKind, boolean>> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  return {
    tmdb: isValidBundle(file?.keys.tmdb),
    mdblist: isValidBundle(file?.keys.mdblist),
    tvdb: isValidBundle(file?.keys.tvdb),
    simkl: isValidBundle(file?.keys.simkl),
  }
}

/**
 * Stato chiavi onesto (presenza + decifrabilità): `present` = bundle salvato,
 * `decryptable` = decifrabile con la PROFILE_ENCRYPTION_KEY corrente.
 * Dopo una rotazione/rimozione dell'env i bundle restano `present:true` ma
 * `decryptable:false` — la UI deve mostrare "da riconfigurare" invece di un
 * verde bugiardo (i cataloghi degradano a key-missing, mai throw).
 */
export interface UserKeysHealth {
  present: Record<UserKeyKind, boolean>
  decryptable: Record<UserKeyKind, boolean>
  encryptionAvailable: boolean
}

export async function getUserKeysHealth(userId: string): Promise<UserKeysHealth> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  const present = {
    tmdb: isValidBundle(file?.keys.tmdb),
    mdblist: isValidBundle(file?.keys.mdblist),
    tvdb: isValidBundle(file?.keys.tvdb),
    simkl: isValidBundle(file?.keys.simkl),
  }
  const key = encryptionKey()
  if (!key) {
    return { present, decryptable: { tmdb: false, mdblist: false, tvdb: false, simkl: false }, encryptionAvailable: false }
  }
  const decryptable: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false, simkl: false }
  for (const kind of USER_KEY_KINDS) {
    const bundle = file?.keys[kind]
    if (!isValidBundle(bundle)) continue
    try {
      decryptSecret(bundle, key)
      decryptable[kind] = true
    } catch {
      decryptable[kind] = false
    }
  }
  return { present, decryptable, encryptionAvailable: true }
}

const MAX_KEY_LENGTH = 256

function normalizeKeyInput(kind: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new InvalidUserKeyError(kind)
  const v = value.trim()
  if (!v) return null
  if (v.length > MAX_KEY_LENGTH || /[\s]/.test(v)) throw new InvalidUserKeyError(kind)
  return v
}

/**
 * Salva (merge) le chiavi del namespace. `null`/`""` = cancella la kind.
 * Forma oggetto per il soft-disable senza toccare il materiale:
 * `{ value?: string | null, disabled?: boolean }` (campo assente = invariato).
 * Richiede cifratura disponibile quando almeno una kind va scritta (fail-closed:
 * mai chiavi in chiaro a riposo). Le sole cancellazioni e i soli flag passano
 * anche senza env (niente da cifrare).
 */
export async function setUserKeys(userId: string, input: Partial<Record<UserKeyKind, unknown>>): Promise<void> {
  assertValidUserId(userId)
  const writes: Partial<Record<UserKeyKind, string>> = {}
  const deletes: UserKeyKind[] = []
  const flagSets: Partial<Record<UserKeyKind, boolean>> = {}
  const flagClears: UserKeyKind[] = []
  for (const kind of USER_KEY_KINDS) {
    if (!(kind in input)) continue
    const raw = input[kind]
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>
      const hasValue = "value" in obj
      const hasDisabled = "disabled" in obj
      if (!hasValue && !hasDisabled) throw new InvalidUserKeyError(kind)
      if (hasDisabled) {
        if (typeof obj.disabled !== "boolean") throw new InvalidUserKeyError(kind)
        if (obj.disabled) flagSets[kind] = true
        else flagClears.push(kind)
      }
      if (hasValue) {
        const normalized = normalizeKeyInput(kind, obj.value)
        if (normalized === null) deletes.push(kind)
        else writes[kind] = normalized
      }
      continue
    }
    const normalized = normalizeKeyInput(kind, raw)
    if (normalized === null) deletes.push(kind)
    else writes[kind] = normalized
  }
  const current: KeysFile = (await readKeysFile(userId)) ?? { version: 1 as const, keys: {}, updatedAt: new Date().toISOString() }
  for (const kind of deletes) delete current.keys[kind]
  if (Object.keys(writes).length > 0) {
    const key = encryptionKey()
    if (!key) throw new KeysEncryptionUnavailableError()
    for (const [kind, value] of Object.entries(writes) as [UserKeyKind, string][]) {
      current.keys[kind] = encryptSecret(value, key)
    }
  }
  const disabled = current.disabled ?? {}
  for (const [kind] of Object.entries(flagSets) as [UserKeyKind, boolean][]) disabled[kind] = true
  for (const kind of flagClears) delete disabled[kind]
  if (Object.keys(disabled).length > 0) current.disabled = disabled
  else delete current.disabled
  current.updatedAt = new Date().toISOString()
  // Mai i valori nei log: solo le kind toccate (~ = flag soft-disable).
  log.info("User keys updated", { kinds: [...Object.keys(writes), ...deletes.map((k) => `-${k}`), ...Object.keys(flagSets).map((k) => `~${k}`), ...flagClears.map((k) => `~-${k}`)] })
  if (isKvMode()) {
    await getKv().set(keysKvKey(userId), current)
    return
  }
  await fsp.mkdir(userDir(userId), { recursive: true })
  await atomicWriteFile(keysFile(userId), JSON.stringify(current), { mode: 0o600 })
}
