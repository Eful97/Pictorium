import path from "node:path"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { getStorageMode } from "@/lib/kv"

const log = createLogger("data-dir")

export const DATA_DIR = envWithFallback("DATA_DIR") || path.join(process.cwd(), "data")

// Su Vercel (serverless) il filesystem è read-only e non persistente: lo store
// file (mapping/defaults) fallirebbe. KV è l'unica persistenza valida lì
// (Redis nativo via PICTORIUM_REDIS_URL o Vercel KV/Upstash via
// KV_REST_API_URL/TOKEN).
// Senza backend KV i mapping non si salvano e resta solo il path stateless
// (config token `?config=` nei link). Avvertiamo subito invece
// di fallire a runtime in modo poco chiaro.
if (process.env.VERCEL && getStorageMode() === "file") {
  log.warn("⚠️  Vercel rilevato senza backend KV (PICTORIUM_REDIS_URL o KV_REST_API_URL/KV_REST_API_TOKEN): mapping NON persistono; i profili degradano a stateless (config token). Imposta PICTORIUM_REDIS_URL o lo store KV di Vercel/Upstash per la persistenza server-side.")
}
