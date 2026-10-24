import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getStreamingAvailability } from "@/lib/streaming-availability"

/**
 * GET /api/streaming-availability — read-only discovery for the opt-in
 * streaming catalog UI (follow-up slice consumes it; no UI is wired here).
 *
 * Returns every selectable service × country × section choice: the legacy
 * supported subset plus the generic dynamic universe (every indexed
 * service × chart-country, base + variant charts, `all`/mixed for overall)
 * with FlixPatrol chart coverage (from the bounded cached availability
 * index — the single upstream fetch, `schema_version: 1`) and verified
 * own-brand JustWatch fallback eligibility, plus honest display labels
 * ("Top 10 · FlixPatrol" for real charts vs "Top 10 · JustWatch" for
 * the daily-chart fallback: index existence means chart coverage, never a
 * claim of commercial availability, official viewing counts, or guaranteed
 * chart freshness).
 *
 * Filters (service/country match nothing unknown — empty choices, never a
 * fallback; an unknown section is ignored; an unknown source fails closed
 * with empty choices, never a silent `auto`):
 * `?service=netflix&country=IT&section=movies&source=auto`. The `source`
 * policy selects the potential computation — `flixpatrol` never reports
 * `justwatch` potential (and vice versa), `justwatch` omits unsupported
 * pairs entirely. No mass provider or network probing: choices never
 * trigger per-pair upstream traffic.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const rl = await rateLimit(rateLimitKey(req), "availability")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const params = req.nextUrl.searchParams
  const service = params.get("service")?.trim().toLowerCase() || undefined
  const country = params.get("country")?.trim().toUpperCase() || undefined
  const section = params.get("section")?.trim().toLowerCase() || undefined
  const source = params.get("source")?.trim().toLowerCase() || undefined

  const validSection = section === "movies" || section === "series" || section === "all" ? section : undefined

  const body = await getStreamingAvailability({
    service,
    country,
    section: validSection,
    source,
  })
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}
