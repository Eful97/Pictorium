import { NextRequest } from "next/server"
import { getAll, importMappings, QuotaExceededError } from "@/lib/store"
import { requireAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { sanitizeUserId, invalidUserResponse, isMultiUserEnabled, userRateLimitKey } from "@/lib/user-auth"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

type RouteParams = { uuid: string }

/**
 * Import admin globale → namespace (multi-user).
 *
 * Copia i mapping globali legacy dentro il namespace utente (migrazione
 * one-shot operatore, es. single-user → UUID). Niente auto-merge al boot.
 * Solo admin (fail-closed anche su istanza pubblica), quota rispettata (413).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  if (!isMultiUserEnabled()) {
    return Response.json({ error: "Multi-user is disabled" }, { status: 404 })
  }
  const { uuid } = await params
  const userId = sanitizeUserId(uuid)
  const rl = await rateLimit(userId ? userRateLimitKey(req, userId) : rateLimitKey(req), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!userId) return invalidUserResponse()
  if (!(await requireAdminToken(req))) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  const global = await getAll()
  try {
    await importMappings(global, userId)
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return Response.json({ error: e.message }, { status: 413 })
    }
    throw e
  }
  await bumpCatalogEpoch(userId)
  return Response.json({ ok: true, count: global.length })
}
