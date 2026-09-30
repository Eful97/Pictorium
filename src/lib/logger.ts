import { envWithFallback } from "@/lib/env-compat"

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  level: LogLevel
  module: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
// Finding 12: un valore env non valido (es. PICTORIUM_LOG_LEVEL=verbose) produceva
// undefined → `shouldLog` valutava `>= undefined` → ogni log silenziato. Con `??`
// si ripiega su info, che è anche il default quando la var è assente.
const rawLevel = envWithFallback("LOG_LEVEL")
const CURRENT_LEVEL: number = LOG_LEVELS[rawLevel as LogLevel] ?? LOG_LEVELS.info

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= CURRENT_LEVEL
}

const SENSITIVE_EXACT_KEYS = new Set([
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
  "tmdbkey",
  "tmdb_key",
  "tvdbkey",
  "tvdb_key",
  "tvdbapikey",
  "tvdb_api_key",
  "mdblistkey",
  "mdblist_key",
  "fanartkey",
  "fanart_key",
  "authorization",
  "cookie",
  "newpin",
  "pin",
])

export function isSensitiveKey(rawKey: string): boolean {
  const k = rawKey.toLowerCase()
  if (SENSITIVE_EXACT_KEYS.has(k)) return true
  // Safe whitelist check: non tocca chiavi di cache, cataloghi o routing
  if (
    k.endsWith("cachekey") ||
    k.endsWith("posterkey") ||
    k.endsWith("catalogkey") ||
    k.endsWith("ratelimitkey") ||
    k.endsWith("bucketkey") ||
    k === "keys" ||
    k === "kinds"
  ) {
    return false
  }
  // Suffix check per credenziali composte (es. userToken, clientSecret, oldPassword, tmdbApiKey, userPin)
  if (
    k.endsWith("token") ||
    k.endsWith("secret") ||
    k.endsWith("password") ||
    k.endsWith("apikey") ||
    k.endsWith("api_key") ||
    k.endsWith("pin")
  ) {
    return true
  }
  return false
}

const MAX_SANITIZE_DEPTH = 4

export function sanitizeLogData(
  val: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (val === null || typeof val !== "object") {
    return val
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return "[MAX_DEPTH]"
  }
  if (seen.has(val)) {
    return "[CIRCULAR]"
  }
  seen.add(val)

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeLogData(item, depth + 1, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      result[k] = "[REDACTED]"
    } else {
      result[k] = sanitizeLogData(v, depth + 1, seen)
    }
  }
  return result
}

function toJSON(entry: LogEntry): string {
  return JSON.stringify(entry)
}

function formatHuman(entry: LogEntry): string {
  const prefix = `[${entry.module}]`
  switch (entry.level) {
    case "error": return `${prefix} ❌ ${entry.message}${entry.data ? " " + JSON.stringify(entry.data) : ""}`
    case "warn":  return `${prefix} ⚠️  ${entry.message}${entry.data ? " " + JSON.stringify(entry.data) : ""}`
    case "debug": return `${prefix} 🔍 ${entry.message}${entry.data ? " " + JSON.stringify(entry.data) : ""}`
    default:      return `${prefix} ${entry.message}${entry.data ? " " + JSON.stringify(entry.data) : ""}`
  }
}

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  const sanitizedData = data ? (sanitizeLogData(data) as Record<string, unknown>) : undefined
  const entry: LogEntry = { level, module, message, data: sanitizedData, timestamp: new Date().toISOString() }
  const formatted = envWithFallback("LOG_FORMAT") === "json" ? toJSON(entry) : formatHuman(entry)
  switch (level) {
    case "error": return void console.error(formatted)
    case "warn":  return void console.warn(formatted)
    default:      return void console.log(formatted)
  }
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", module, msg, data),
    info:  (msg: string, data?: Record<string, unknown>) => log("info", module, msg, data),
    warn:  (msg: string, data?: Record<string, unknown>) => log("warn", module, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", module, msg, data),
  }
}
