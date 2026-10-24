import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGetShared, cacheSet, hashUserFragment } from "@/lib/cache"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { getDetails, resolveUserApiKeys } from "@/lib/tmdb"
import { concurrentMap } from "@/lib/episode-ordering"
import { getRegionDef } from "@/lib/regions"
import {
  CHART_READY_TTL_MS,
  chartPinCacheFragment,
  familySlotEndMs,
  pinChartFamily,
  pinnedFamilyRows,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import {
  STREAMING_SOURCE_HEADER,
  genericSelectionRegionDef,
  genericStreamFamily,
  parseGenericStreamingCatalogId,
  parseStreamingCatalogId,
} from "@/lib/streaming-catalogs"
import { CATALOG_EMPTY_TTL_MS } from "@/lib/catalog-handler"
import { createLogger } from "@/lib/logger"

const log = createLogger("streaming-browse")

export const maxDuration = 60

/** Per-title TMDB timeout in the browse projection (fail-open, like catalogs). */
const BROWSE_TMDB_TIMEOUT_MS = 2500
const BROWSE_CONCURRENCY = 5

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

function browseTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(BROWSE_TMDB_TIMEOUT_MS)
    : undefined
}

export interface StreamingBrowseItem {
  readonly tmdbId: number
  readonly mediaType: "movie" | "tv"
  readonly title: string
  readonly rank: number
  /** Original TMDB poster path (client prefixes `https://image.tmdb.org/t/p/w185|w342`). Null when unknown. */
  readonly posterPath: string | null
  readonly year: number | null
}

/**
 * GET /api/streaming-catalog?catalog=<id> — safe read-only browsing
 * projection for opt-in streaming lists (SimklCard-style boxes with fast
 * ORIGINAL TMDB thumbnails, no rendered Pictorium posters).
 *
 * Returns the pinned chart rows (the same source rows Stremio serves: order
 * + rank + real media type preserved) enriched with the original TMDB
 * `poster_path` via the shared details cache. NEVER touches the poster
 * render endpoint, never calls images/external_ids/logo endpoints per
 * title — one bounded `getDetails` per row at most (concurrency 5,
 * 2500ms fail-open each). Secrets never enter cache keys (key hashes
 * only), responses, or logs: key precedence is request > namespace >
 * permitted instance env (`resolveUserApiKeys`, unchanged).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const rl = await rateLimit(rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const params = req.nextUrl.searchParams
  const rawCatalog = params.get("catalog")?.trim() || ""
  const userParam = params.get("u") || params.get("user")

  const legacy = parseStreamingCatalogId(rawCatalog)
  const generic = !legacy && rawCatalog.length <= 160 ? parseGenericStreamingCatalogId(rawCatalog) : null
  if (!legacy && !generic) {
    return Response.json({ error: "Unknown streaming catalog id" }, { status: 404 })
  }
  // Legacy ids read the legacy `stream:` family pins (the exact rows Stremio
  // serves there); generic ids read their isolated `stream2:` family.
  const family = legacy
    ? `stream:${legacy.service}:${legacy.section === "movies" ? "movie" : "series"}`
    : genericStreamFamily(generic!)

  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  if (scopedUser) touchUserActivity(scopedUser)

  const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = resolvedKeys.tmdb.key

  const region = legacy ? getRegionDef(legacy.country) : genericSelectionRegionDef(generic!)
  const chartSlug = legacy ? getRegionDef(legacy.country).flixSlug : generic!.chartSlug
  const section = legacy ? legacy.section : generic!.section
  const service = legacy ? legacy.service : generic!.service

  const pin = await ensureFreshChartFamily({
    regionCode: region.code,
    regionLang: region.lang,
    mdblistKey: resolvedKeys.mdblist.key,
    tmdbLang: region.lang,
    tmdbKey: apiKey,
    family,
  }).catch((e) => {
    log.debug("streaming browse refresh failed, serving pinned snapshot", {
      error: e instanceof Error ? e.message : String(e),
    })
    return pinChartFamily({ regionCode: region.code, regionLang: region.lang, family })
  })

  const rows = (pinnedFamilyRows(pin) ?? []).slice(0, 10)
  const source = pin.snapshot?.provenance ?? "unknown"
  const cgFragment = chartPinCacheFragment(pin)
  // Publication metadata (T1 backend contract): last successful publication
  // time of the SAME snapshot served here (snapshot.publishedAt, ms epoch) —
  // Pictorium's publication, NOT the fp-crawler chart date, NOT the request
  // time. Null with no genuine pin. Cache hits do NOT retimestamp.
  const updatedAt = pin.snapshot?.publishedAt ?? null
  const cacheKey =
    `streaming:browse:v1:${rawCatalog}:r${region.code}` +
    `${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}` +
    `:ak${apiKey ? hashFragment(apiKey) : "none"}${cgFragment}`

  // Ready TTL follows the PINNED family end (6h stream2:justwatch vs 12h
  // legacy); a stale/cold pin keeps the short empty TTL under its fenced key.
  const slotEndMs = pin.snapshot ? familySlotEndMs(family, pin.snapshot.generation) : 0
  const readyTtlMs = (body?: { items?: unknown[] } | null): number => {
    if (!body?.items?.length) return CATALOG_EMPTY_TTL_MS
    if (!pin.snapshot || slotEndMs - Date.now() <= 0) return CATALOG_EMPTY_TTL_MS
    return Math.min(CHART_READY_TTL_MS, slotEndMs - Date.now())
  }
  const cached = await cacheGetShared<{ items: StreamingBrowseItem[]; source: string; updatedAt: number | null }>(
    cacheKey,
    ["streaming", "browse"],
    readyTtlMs,
  )
  const respond = (items: StreamingBrowseItem[], actualSource: string, stamp: number | null): Response =>
    Response.json(
      {
        catalogId: rawCatalog,
        service,
        chartSlug,
        section,
        source: actualSource,
        region: region.code,
        updatedAt: stamp,
        items,
      },
      {
        headers: {
          "Cache-Control": "no-cache, max-age=0, must-revalidate",
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json; charset=utf-8",
          [STREAMING_SOURCE_HEADER]: actualSource,
          "Access-Control-Expose-Headers": STREAMING_SOURCE_HEADER,
        },
      },
    )

  if (cached) return respond(cached.items, cached.source, cached.updatedAt ?? null)

  const sectionDefaultMedia = section === "series" ? "tv" : "movie"
  const items = (
    await concurrentMap(rows, async (row): Promise<StreamingBrowseItem | null> => {
      if (!row.tmdbId) return null
      const mediaType = row.mediaType === "tv" || row.mediaType === "movie" ? row.mediaType : sectionDefaultMedia
      if (!apiKey) {
        return {
          tmdbId: row.tmdbId,
          mediaType,
          title: row.title || "",
          rank: row.rank,
          posterPath: null,
          year: row.year ?? null,
        }
      }
      try {
        const d = await getDetails(mediaType, row.tmdbId, region.lang, apiKey, browseTimeoutSignal(), BROWSE_TMDB_TIMEOUT_MS)
        const yearRaw = (d?.release_date || d?.first_air_date || "").slice(0, 4)
        const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : (row.year ?? null)
        return {
          tmdbId: row.tmdbId,
          mediaType,
          title: d?.title || d?.name || row.title || "",
          rank: row.rank,
          posterPath: d?.poster_path ?? null,
          year,
        }
      } catch {
        return {
          tmdbId: row.tmdbId,
          mediaType,
          title: row.title || "",
          rank: row.rank,
          posterPath: null,
          year: row.year ?? null,
        }
      }
    }, BROWSE_CONCURRENCY)
  ).filter((m): m is StreamingBrowseItem => m !== null)

  cacheSet(cacheKey, { items, source, updatedAt }, ["streaming", "browse"], items.length > 0 ? readyTtlMs({ items }) : CATALOG_EMPTY_TTL_MS)
  return respond(items, source, updatedAt)
}
