import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("pin-auth")

export function getSecurityFile(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, "security.json")
}

function getDataDir(): string {
  return envWithFallback("DATA_DIR") || DATA_DIR
}

const KV_KEY = "security"

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

export const PIN_COOKIE_NAME = "pictorium_pin_session"
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60 // 30 giorni

export interface SecurityConfig {
  pinHash?: string // format: `${salt}:${hash}`
  sessionSecret?: string
  // Hash sha256 dell'ADMIN_TOKEN in vigore quando il PIN è stato impostato
  // via token (mai via PIN): se il token ruota o sparisce, il binding non
  // combacia più e il PIN si auto-disabilita (v1.23.0, anti-persistenza).
  // Assente = impostato via PIN o senza token configurato: sempre attivo.
  adminHash?: string
  updatedAt?: string
}

let cachedConfig: SecurityConfig | null = null
let cacheAt = 0
const CACHE_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 1000

export function _resetPinCache(): void {
  cachedConfig = null
  cacheAt = 0
}

export async function readSecurityConfig(): Promise<SecurityConfig> {
  const now = Date.now()
  if (cachedConfig && now - cacheAt < CACHE_TTL_MS) {
    return cachedConfig
  }

  if (isKvMode()) {
    try {
      const data = await getKv().get<SecurityConfig>(KV_KEY)
      cachedConfig = data ?? {}
      cacheAt = now
      return cachedConfig
    } catch (err) {
      log.error("Failed to read security config from KV", { err })
      return {}
    }
  }

  try {
    const file = getSecurityFile()
    if (!existsSync(file)) {
      cachedConfig = {}
      cacheAt = now
      return cachedConfig
    }
    const raw = await fs.readFile(file, "utf-8")
    cachedConfig = JSON.parse(raw) as SecurityConfig
    cacheAt = now
    return cachedConfig
  } catch (err) {
    log.error("Failed to read security config from file", { err })
    return {}
  }
}

export function readSecurityConfigSync(): SecurityConfig {
  const now = Date.now()
  if (cachedConfig && now - cacheAt < CACHE_TTL_MS) {
    return cachedConfig
  }
  if (!isKvMode()) {
    try {
      const file = getSecurityFile()
      if (!existsSync(file)) {
        cachedConfig = {}
        cacheAt = now
        return cachedConfig
      }
      const raw = readFileSync(file, "utf-8")
      cachedConfig = JSON.parse(raw) as SecurityConfig
      cacheAt = now
      return cachedConfig
    } catch {
      return {}
    }
  }
  return cachedConfig ?? {}
}

export function hasPinConfiguredSync(): boolean {
  const cfg = readSecurityConfigSync()
  return !!cfg.pinHash && cfg.pinHash.includes(":") && adminBindingOk(cfg)
}

export function verifySessionFromRequestSync(request: Request): boolean {
  const cfg = readSecurityConfigSync()
  if (!cfg.pinHash || !cfg.sessionSecret) return false
  if (!adminBindingOk(cfg)) return false

  const token = extractSessionToken(request)
  if (!token) return false

  const parts = token.split(".")
  if (parts.length !== 2) return false

  const [payload, signature] = parts
  const expiresAt = Number(payload)
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) return false

  const expectedSignature = crypto.createHmac("sha256", cfg.sessionSecret).update(payload).digest("hex")
  if (expectedSignature.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

export async function writeSecurityConfig(config: SecurityConfig): Promise<void> {
  const updated: SecurityConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  }

  if (isKvMode()) {
    try {
      await getKv().set(KV_KEY, updated)
      cachedConfig = updated
      cacheAt = Date.now()
      return
    } catch (err) {
      log.error("Failed to write security config to KV", { err })
      throw err
    }
  }

  try {
    const dataDir = getDataDir()
    const file = getSecurityFile()
    await fs.mkdir(dataDir, { recursive: true })
    const tmp = `${file}.tmp.${Date.now()}`
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8")
    await fs.rename(tmp, file)
    cachedConfig = updated
    cacheAt = Date.now()
  } catch (err) {
    log.error("Failed to write security config to file", { err })
    throw err
  }
}

export function hashPin(pin: string, salt?: string): { hash: string; salt: string; pinHash: string } {
  const generatedSalt = salt || crypto.randomBytes(16).toString("hex")
  const derived = crypto.scryptSync(pin, generatedSalt, 64).toString("hex")
  return {
    hash: derived,
    salt: generatedSalt,
    pinHash: `${generatedSalt}:${derived}`,
  }
}

function currentAdminTokenHash(): string | null {
  const t = envWithFallback("ADMIN_TOKEN") || process.env.ADMIN_TOKEN
  if (!t) return null
  return crypto.createHash("sha256").update(t, "utf-8").digest("hex")
}

/**
 * Binding PIN↔admin token (v1.23.0): un PIN impostato via admin token muore
 * con la rotazione. Senza binding (via PIN o senza token all'epoca) resta
 * attivo; se il token sparisce del tutto con binding presente, fail-closed
 * (recuperabile: senza PIN configurato il primo set torna libero).
 */
function adminBindingOk(cfg: SecurityConfig): boolean {
  if (!cfg.adminHash) return true
  const current = currentAdminTokenHash()
  if (!current || current.length !== cfg.adminHash.length) return false
  return crypto.timingSafeEqual(Buffer.from(current), Buffer.from(cfg.adminHash))
}

export async function hasPinConfigured(): Promise<boolean> {
  const cfg = await readSecurityConfig()
  return !!cfg.pinHash && cfg.pinHash.includes(":") && adminBindingOk(cfg)
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!pin || typeof pin !== "string") return false
  const cfg = await readSecurityConfig()
  if (!cfg.pinHash) return false
  if (!adminBindingOk(cfg)) return false

  const [salt, storedHash] = cfg.pinHash.split(":")
  if (!salt || !storedHash) return false

  const candidate = crypto.scryptSync(pin, salt, 64).toString("hex")
  if (candidate.length !== storedHash.length) return false
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash))
}

export async function setPin(newPin: string, opts?: { viaAdminToken?: boolean }): Promise<boolean> {
  if (!newPin || typeof newPin !== "string" || newPin.trim().length < 6) {
    return false
  }
  const cleanPin = newPin.trim()
  const cfg = await readSecurityConfig()
  const { pinHash } = hashPin(cleanPin)
  // Rotazione sempre: cambiare PIN invalida tutte le sessioni precedenti
  // (prima il secret veniva riusato e i vecchi token restavano validi 30gg).
  const sessionSecret = crypto.randomBytes(32).toString("hex")

  await writeSecurityConfig({
    ...cfg,
    pinHash,
    sessionSecret,
    // Binding rotazione: impostato via token → hash corrente; via PIN →
    // resta il binding precedente; senza token → nessun binding.
    adminHash: opts?.viaAdminToken ? (currentAdminTokenHash() ?? undefined) : cfg.adminHash,
  })
  return true
}

export async function removePin(currentPin: string): Promise<boolean> {
  const isValid = await verifyPin(currentPin)
  if (!isValid) return false

  await writeSecurityConfig({
    pinHash: undefined,
    sessionSecret: undefined,
  })
  return true
}

export async function createSessionToken(): Promise<string | null> {
  const cfg = await readSecurityConfig()
  if (!cfg.pinHash || !cfg.sessionSecret) return null

  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000
  const payload = String(expiresAt)
  const signature = crypto.createHmac("sha256", cfg.sessionSecret).update(payload).digest("hex")
  return `${payload}.${signature}`
}

export function buildSessionCookie(token: string): string {
  const isProd = process.env.NODE_ENV === "production"
  const secure = isProd ? "; Secure" : ""
  // Senza Max-Age: scade automaticamente alla chiusura della sessione del browser
  return `${PIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

export function buildClearSessionCookie(): string {
  return `${PIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token || typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length !== 2) return false

  const [payload, signature] = parts
  const expiresAt = Number(payload)
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) return false

  const cfg = await readSecurityConfig()
  if (!cfg.sessionSecret) return false
  if (!adminBindingOk(cfg)) return false

  const expectedSignature = crypto.createHmac("sha256", cfg.sessionSecret).update(payload).digest("hex")
  if (expectedSignature.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

export function extractSessionToken(request: Request): string | null {
  // 1. Header esplicito
  const headerToken = request.headers.get("x-pin-token")
  if (headerToken) return headerToken

  // 2. Cookie
  const cookieHeader = request.headers.get("cookie")
  if (!cookieHeader) return null

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PIN_COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function verifySessionFromRequest(request: Request): Promise<boolean> {
  const hasPin = await hasPinConfigured()
  if (!hasPin) {
    // Se nessun PIN è configurato, la sessione non è richiesta
    return true
  }
  const token = extractSessionToken(request)
  return verifySessionToken(token)
}
