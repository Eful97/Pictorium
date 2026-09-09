import { NextRequest } from "next/server"
import { configTokenSchema, encodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { createLogger } from "@/lib/logger"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

const log = createLogger("config-token")

/**
 * POST /api/config-token
 *
 * Genera un config token firmato (`?config=`) dalla configurazione corrente
 * dell'editor. L'encoding richiede `node:crypto` → solo server: il client non
 * può generare il token. In produzione senza `CONFIG_HMAC_SECRET` l'encoding
 * fallisce (fail-closed): risposta chiara con le istruzioni.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "config")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const config = (body as { config?: unknown })?.config
  const parsed = configTokenSchema.safeParse(config)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid config", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    const token = encodeConfig(parsed.data as PictoriumUserConfig)
    return Response.json({ token })
  } catch (error) {
    log.error("encode failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json(
      { error: "CONFIG_HMAC_SECRET (or ENCRYPTION_KEY_SECRET) is not set: cannot sign config tokens in production. Set the secret to enable them." },
      { status: 500 },
    )
  }
}
