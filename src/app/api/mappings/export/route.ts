import { NextRequest } from "next/server"
import { getAll, getAllAliases } from "@/lib/store"
import { getServerDefaults, getStoredUserDefaults } from "@/lib/server-defaults"
import { APP_VERSION } from "@/generated/app-version"
import { BACKUP_SCHEMA_VERSION, stripBackupSecrets } from "@/lib/backup-schema"
import { checkAdminToken, adminAuthResponse } from "@/lib/auth"
import { extractUserParam, checkUserAuth, getScopedUserId, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const rawUser = extractUserParam(req)
  const rawInvalid = !!rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(rawInvalid ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (rawInvalid) return invalidUserResponse()
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  } else {
    // Fail-open senza ADMIN_TOKEN (istanza pubblica HF Spaces); fail-closed con token.
    if (!checkAdminToken(req)) return adminAuthResponse()
  }
  const mappings = await getAll(scoped)
  const aliases = await getAllAliases(scoped)
  // Defaults: sul namespace solo lo STORATO (mai l'effettivo ENV+storato,
  // altrimenti l'env dell'istanza si cuocerebbe nel file); sul globale
  // l'effettivo come il PUT, comunque sbiancato dai segreti.
  const defaults = stripBackupSecrets(scoped ? await getStoredUserDefaults(scoped) : getServerDefaults())
  // Retired Badge Lab (custom badge library removed): no presets to export.
  // The field stays (empty) so old backup readers keep their shape.
  const presets: never[] = []
  return Response.json({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    scope: scoped ?? null,
    mappings,
    aliases,
    defaults,
    presets,
  })
}
