import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { resolveRouteApiKey } from "@/lib/tmdb"
import {
  MDBLIST_BROWSE_MAX_LIMIT,
  fetchMDBListListSearch,
  fetchMDBListTopLists,
  fetchMDBListUserLists,
} from "@/lib/mdblist"
import { createLogger } from "@/lib/logger"

const log = createLogger("mdblist")

/**
 * GET /api/mdblist/lists
 *
 * Read-only MDBList browse for the "New catalog" picker:
 *   ?mode=top              (default) top lists
 *   ?mode=search&q=<text>  list search
 *   ?mode=user&user=<name> lists owned by one user
 *   &limit=1..50
 *
 * The API key is resolved server-side (request/namespace/instance fallback)
 * and never echoed, logged, or placed in a cache key. The 60-minute cache and
 * the daily-quota parking live in `lib/mdblist.ts`. Without a key the response
 * is an honest empty list (`configured: false`), never a guessed feed.
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const sp = req.nextUrl.searchParams
  const modeRaw = (sp.get("mode") || "top").toLowerCase()
  const mode = modeRaw === "search" || modeRaw === "user" ? modeRaw : "top"
  const limitRaw = Number(sp.get("limit"))
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MDBLIST_BROWSE_MAX_LIMIT, Math.floor(limitRaw)))
    : 30

  let apiKey: string | undefined
  try {
    apiKey = await resolveRouteApiKey(req, "mdblist")
  } catch (e) {
    log.warn("MDBList key resolution failed", { error: e instanceof Error ? e.message : String(e) })
    apiKey = undefined
  }
  if (!apiKey) {
    return Response.json({ lists: [], mode, configured: false })
  }

  try {
    let lists
    if (mode === "search") {
      const q = (sp.get("q") || "").trim()
      if (!q) return Response.json({ lists: [], mode, configured: true })
      lists = await fetchMDBListListSearch(q, apiKey, limit, req.signal)
    } else if (mode === "user") {
      const user = (sp.get("user") || sp.get("u") || "").trim()
      if (!user) return Response.json({ lists: [], mode, configured: true })
      lists = await fetchMDBListUserLists(user, apiKey, limit, req.signal)
    } else {
      lists = await fetchMDBListTopLists(apiKey, limit, req.signal)
    }
    return Response.json({ lists, mode, configured: true })
  } catch (e) {
    log.error("MDBList browse failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ lists: [], mode, configured: true })
  }
}
