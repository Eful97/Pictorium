import path from "node:path"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"

const log = createLogger("data-dir")

export const DATA_DIR = envWithFallback("DATA_DIR") || path.join(process.cwd(), "data")

// Su Vercel (serverless) il filesystem è read-only e non persistente: lo store
// file (mapping/defaults) fallirebbe. KV è l'unica persistenza valida lì.
// Senza KV i mapping non si salvano e resta solo il path stateless (config
// token `?config=` nei link). Avvertiamo subito invece
// di fallire a runtime in modo poco chiaro.
if (process.env.VERCEL && !(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)) {
  log.warn("⚠️  Vercel rilevato senza KV_REST_API_URL/KV_REST_API_TOKEN: mapping NON persistono; i profili degradano a stateless (config token). Imposta lo store KV di Vercel/Upstash per la persistenza server-side.")
}
