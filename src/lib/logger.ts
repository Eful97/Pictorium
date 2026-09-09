type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  level: LogLevel
  module: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
// Finding 12: un valore env non valido (es. POSTERIUM_LOG_LEVEL=verbose) produceva
// undefined → `shouldLog` valutava `>= undefined` → ogni log silenziato. Con `??`
// si ripiega su info, che è anche il default quando la var è assente.
const rawLevel = process.env.PICTORIUM_LOG_LEVEL || process.env.POSTERIUM_LOG_LEVEL
const CURRENT_LEVEL: number = LOG_LEVELS[rawLevel as LogLevel] ?? LOG_LEVELS.info

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= CURRENT_LEVEL
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
  const entry: LogEntry = { level, module, message, data, timestamp: new Date().toISOString() }
  const formatted = process.env.POSTERIUM_LOG_FORMAT === "json" ? toJSON(entry) : formatHuman(entry)
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
