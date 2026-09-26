import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isMultiUserEnabled, getMaxUsers } from "@/lib/user-auth"
import { countActiveUsers, listUsers, type UserInfo } from "@/lib/user-activity"
import { getKeyMissingStats } from "@/lib/catalog-handler"
import { isUserKeysEncryptionAvailable } from "@/lib/user-keys"
import { envWithFallback } from "@/lib/env-compat"
import { requireAdminToken } from "@/lib/auth"

/**
 * Sponsor/hosting pubblico dell'istanza (banner UI, mai segreti).
 * Whitelist rigida: solo "elfhosted" o null — il raw env non esce mai.
 * Primario l'env esplicito, fallback best-effort sull'host della richiesta.
 */
export function resolveHostedBy(req: NextRequest): "elfhosted" | null {
  const raw = envWithFallback("HOSTED_BY")?.toLowerCase().trim()
  if (raw === "elfhosted") return "elfhosted"
  if (raw) return null
  const host = req.headers.get("host")?.toLowerCase() ?? ""
  const xfh = req.headers.get("x-forwarded-host")?.toLowerCase() ?? ""
  if (host.includes("elfhosted.com") || xfh.includes("elfhosted.com")) return "elfhosted"
  return null
}

// PICTORIUM_PUBLIC_STATS=0: aggregate counts (users, active users, bytes,
// key-missing counters) are returned only to admins (token or PIN session).
// Public callers still get the fields the UI needs (multiUser, hostedBy).
// Default: public, as before. Read live, like HOSTED_BY above.
function publicStatsEnabled(): boolean {
  const raw = (envWithFallback("PUBLIC_STATS") || "").toLowerCase().trim()
  return !(raw === "0" || raw === "false")
}

// The body depends on credentials: keep it out of shared caches.
const NO_STORE = { "Cache-Control": "private, no-store" }

const STATUS_USERS_TTL_MS = 60_000
let usersCache: { at: number; users: UserInfo[] } | null = null

async function listUsersCached(): Promise<UserInfo[]> {
  const now = Date.now()
  if (usersCache && now - usersCache.at < STATUS_USERS_TTL_MS) return usersCache.users
  const users = await listUsers()
  usersCache = { at: now, users }
  return users
}

/**
 * Solo per i test: invalida il memo degli aggregati.
 */
export function __resetStatusUsersCache(): void {
  usersCache = null
}

/**
 * Stato multi-user (aggregati soli, nessun UUID/segreto): numero utenti,
 * utenti attivi ultimi 7 giorni (solo conteggio), cap spazi (0 = illimitati),
 * byte occupati, cifratura chiavi disponibile, contatori key-missing dei
 * cataloghi. Pubblico come /api/health (solo conteggi operativi), salvo
 * PICTORIUM_PUBLIC_STATS=0: allora solo multiUser/hostedBy per i non-admin.
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const multiUser = isMultiUserEnabled()
  if (!publicStatsEnabled() && !requireAdminToken(req)) {
    // Skip listUsers entirely: no storage scan for anonymous callers.
    return Response.json({
      multiUser,
      hostedBy: resolveHostedBy(req),
      timestamp: new Date().toISOString(),
    }, { headers: NO_STORE })
  }
  // Memo breve (v1.23.0): listUsers scansiona storage/Redis — i conteggi non
  // servono realtime, 60s bastano ed evitano SCAN+GET per utente a ogni hit.
  const users = multiUser ? await listUsersCached() : []
  let usersBytes = 0
  for (const u of users) {
    if (u.bytes > 0) usersBytes += u.bytes
  }
  return Response.json({
    multiUser,
    users: users.length,
    activeUsers: countActiveUsers(users),
    maxUsers: multiUser ? getMaxUsers() : 0,
    usersBytes,
    keysEncryption: isUserKeysEncryptionAvailable(),
    keyMissing: getKeyMissingStats(),
    hostedBy: resolveHostedBy(req),
    timestamp: new Date().toISOString(),
  }, { headers: NO_STORE })
}
