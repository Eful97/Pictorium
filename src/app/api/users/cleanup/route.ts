import { NextRequest } from "next/server"
import { requireAdminToken, adminAuthResponse, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { isMultiUserEnabled } from "@/lib/user-auth"
import { cleanupInactiveUsers, getUserRetentionDays } from "@/lib/user-activity"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

/**
 * Cleanup utenti inattivi (multi-user): rimuove i namespace senza attività da
 * più di PICTORIUM_USER_RETENTION_DAYS (default 180, `0` = mai). Solo admin
 * (fail-closed anche su istanza pubblica). Pensato per cron/operatori, non
 * per i client.
 */
export async function POST(req: NextRequest) {
  if (!isMultiUserEnabled()) {
    return Response.json({ error: "Multi-user is disabled" }, { status: 404 })
  }
  const rl = await rateLimit(rateLimitKey(req), "defaults")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!requireAdminToken(req)) return adminAuthResponse()
  // La sessione PIN viaggia via cookie: senza same-origin un sito malevolo
  // potrebbe triggerare il cleanup col cookie ambiente dell'admin (CSRF).
  if (!isSameOrigin(req)) return originMismatchResponse()
  const result = await cleanupInactiveUsers()
  return Response.json({ ...result, retentionDays: getUserRetentionDays() })
}
