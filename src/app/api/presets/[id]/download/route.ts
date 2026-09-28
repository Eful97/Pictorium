import { createHash } from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  checkUserAuth,
  getScopedUserId,
  extractUserParam,
  invalidUserResponse,
  isMultiUserEnabled,
  userRateLimitKey,
} from "@/lib/user-auth"
import { isBadgePresetId } from "@/lib/badge-preset"
import { getPreset, incrementDownload } from "@/lib/badge-preset-store"
import { createLogger } from "@/lib/logger"

const log = createLogger("api-presets")

type RouteParams = { id: string }

/**
 * POST /api/presets/[id]/download — contatore protetto: 1/IP/24h, mai
 * self-download, mai sui privati altrui. Contatore pubblico, niente
 * same-origin (la Community lo chiama dal browser) ma con rate-limit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return invalidUserResponse()
  }
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { id } = await params
  if (!isBadgePresetId(id)) return Response.json({ error: "Invalid preset id" }, { status: 400 })
  const stored = await getPreset(id)
  if (!stored) return Response.json({ error: "not found" }, { status: 404 })
  const isOwner = !!scoped && (await checkUserAuth(req, scoped)) && stored.preset.ownerUuid === scoped
  if (stored.preset.visibility !== "public" && !isOwner) {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }
  // Identità anti-farming: hash dell'identità di rate-limit (IP o fallback),
  // mai l'IP in chiaro nel KV.
  const ipHash = createHash("sha256").update(rateLimitKey(req)).digest("hex").slice(0, 32)
  try {
    const downloads = await incrementDownload(id, ipHash, { isOwner })
    return Response.json({ downloads })
  } catch (e) {
    log.error("Preset download increment failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
