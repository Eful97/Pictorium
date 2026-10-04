import { NextRequest } from "next/server"
import { getTop10, getSupportedPlatforms, getSupportedCountries } from "@/lib/flixpatrol"
import { resolveRouteApiKey } from "@/lib/tmdb"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { GLOBAL_REGION } from "@/lib/regions"

const log = createLogger("flixpatrol-api")

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const apiKey = await resolveRouteApiKey(req)
  const platform = req.nextUrl.searchParams.get("platform") || "netflix"
  const country = req.nextUrl.searchParams.get("country") || "italy"
  const valid = getSupportedPlatforms().find((p) => p.slug === platform)
  if (!valid) {
    return Response.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }
  if (country !== GLOBAL_REGION.flixSlug && !getSupportedCountries().includes(country)) {
    return Response.json({ error: `Unknown country: ${country}` }, { status: 400 })
  }
  try {
    const data = await getTop10(platform, country, apiKey)
    return Response.json(data, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
  } catch (err) {
    log.error("Top10 fetch failed", { error: err instanceof Error ? err.message : String(err) })
    return Response.json({ error: "Failed to fetch FlixPatrol data" }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
