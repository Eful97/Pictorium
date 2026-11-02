import { cacheClear } from "@/lib/cache"
import { clearAutoFitCache } from "@/lib/poster-auto-fit"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearFlixpatrolCache } from "@/lib/flixpatrol"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { clearRegionStatsCache } from "@/lib/image-utils"
import { clearTvdbCache } from "@/lib/tvdb"
import { __resetNetworkLogoCache } from "@/lib/network-svgs"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

export async function POST(req: Request) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!(await checkAdminToken(req))) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  // Il clear copre l'intero store condiviso di cache.ts (poster renderizzati,
  // badge, image-level, cataloghi) più le cache module-level con store proprio
  // (TMDB, JustWatch, FlixPatrol, TVDB, region-stats, session cache,
  // auto-fit, logo network).
  cacheClear()
  clearAutoFitCache()
  __resetJWRankingsCache()
  __clearTMDBCache()
  __clearFlixpatrolCache()
  __resetTMDBSessionCache()
  clearRegionStatsCache()
  clearTvdbCache()
  __resetNetworkLogoCache()
  return Response.json({ ok: true, message: "Cache svuotata" })
}
