import { NextRequest } from "next/server"
import sharp from "sharp"
import { adminAuthResponse, requireAdminToken } from "@/lib/auth"
import { cacheStatus } from "@/lib/cache"
import { getPosterStats, posterErrorStats } from "@/lib/poster-runtime-cache"
import { getTMDBStats } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isBreakerOpen as isAwardsBreakerOpen } from "@/lib/awards"
import { isMdblistBreakerOpen } from "@/lib/ratings"
import { getMdbQuotaSummary } from "@/lib/mdblist-quota"
import { isJustwatchBreakerOpen } from "@/lib/justwatch"
import { isTvdbBreakerOpen } from "@/lib/tvdb"
import { outboundStats } from "@/lib/outbound-stats"
import { imageBytesStats } from "@/lib/image-bytes-cache"

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Telemetria sensibile (conteggi globali, memoria, pipeline): fail-closed
  // stretto — solo ADMIN_TOKEN o sessione PIN valida, anche su istanze
  // pubbliche (dove checkAdminToken resterebbe aperto a chiunque).
  if (!(await requireAdminToken(req))) return adminAuthResponse()

  const sharpCache = sharp.cache()
  const sharpCounters = sharp.counters()
  const procMem = process.memoryUsage()

  const systemStats = {
    sharp: {
      memory: sharpCache,
      counters: sharpCounters,
      concurrency: sharp.concurrency(),
      simd: sharp.simd(),
    },
    memory: {
      rssMb: Math.round((procMem.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((procMem.heapUsed / (1024 * 1024)) * 10) / 10,
      heapTotalMb: Math.round((procMem.heapTotal / (1024 * 1024)) * 10) / 10,
      externalMb: Math.round((procMem.external / (1024 * 1024)) * 10) / 10,
      arrayBuffersMb: Math.round(((procMem.arrayBuffers ?? 0) / (1024 * 1024)) * 10) / 10,
    },
    uptimeSeconds: Math.round(process.uptime()),
  }

  return Response.json({
    ...cacheStatus(),
    posterErrors: posterErrorStats(),
    poster: getPosterStats(),
    tmdb: getTMDBStats(),
    outbound: outboundStats(),
    imageBytes: imageBytesStats(),
    system: systemStats,
    circuitBreakers: {
      awards: isAwardsBreakerOpen(),
      mdblist: isMdblistBreakerOpen(),
      justwatch: isJustwatchBreakerOpen(),
      tvdb: isTvdbBreakerOpen(),
    },
    // MDBList per-key daily-quota parked state (sanitized counts + reset
    // timing only, per-process scope): same fail-closed admin auth as the
    // rest of this operator surface, never on public /api/status.
    mdblistQuota: getMdbQuotaSummary(),
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
