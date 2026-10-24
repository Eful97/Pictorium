import { NextRequest } from "next/server"
import { getJWRankings } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang, GLOBAL_REGION_CODE } from "@/lib/regions"
import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { decodeConfig } from "@/lib/config-token"
import { resolveUserApiKeys } from "@/lib/tmdb"
import { resolveRankingSource, type RankingSlot } from "@/lib/ranking-source"
import { fetchCustomRankingTop20, findRankingCustomCatalog } from "@/lib/custom-ranking"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { CHART_LIVE_PIN_ID, chartListGroupKey, chartPinCacheFragment, currentChartSlotFloor, familySlotFloorMs, pinChartFamily, pinnedFamilyRows, type ChartFamilyPin } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { createLogger } from "@/lib/logger"
import crypto from "node:crypto"

const log = createLogger("trending-rank")

function hashFragment(value: string | undefined): string {
  return value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 8) : "none"
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const rawType = req.nextUrl.searchParams.get("type")
  const rawId = req.nextUrl.searchParams.get("id")
  // Fix H11: type validato esplicitamente — prima qualsiasi stringa non-"movie"
  // diventava silenziosamente SHOW, e i tipi inventati producevano lookup errati.
  if (rawType !== "movie" && rawType !== "tv") {
    return Response.json({ error: "Invalid type: must be 'movie' or 'tv'" }, { status: 400 })
  }
  const id = Number(rawId)
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "Invalid id: must be a positive integer" }, { status: 400 })
  }
  const rawFirstParam = req.nextUrl.searchParams.get("first")
  // Finestra di classifica consultata (semantica top-N, default 20 = top-20):
  // un titolo fuori dalla finestra non verrà mai trovato e risulta "senza
  // rank". `first` la rende configurabile (1-100) mantenendo il default.
  // Omitted/empty/non-numeric `first` means the canonical Top-20 window: the
  // real editor/preview readers (context.tsx) send no `first` and must read
  // the SAME published snapshot the catalog serves — never a live `first=1`
  // window (`Number(null) === 0` used to clamp an absent param to 1 and
  // bypass the snapshot). Explicit numerics keep today's clamp 1..100,
  // including an explicit top-1 window (live, never snapshot-sliced).
  const rawFirst = rawFirstParam === null || rawFirstParam.trim() === "" ? NaN : Number(rawFirstParam)
  const first = Number.isFinite(rawFirst) ? Math.min(Math.max(Math.round(rawFirst), 1), 100) : 20
  // Namespace for source selection (same as catalogs): `?u=` (user space)
  // and `?config=` (token wins over the namespace, as in the manifest).
  // Without either, the global selection applies — byte-identical to before.
  const userParam = req.nextUrl.searchParams.get("u") ?? req.nextUrl.searchParams.get("user")
  const configParam = req.nextUrl.searchParams.get("config") ?? req.nextUrl.searchParams.get("c")
  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  const tokenConfig = configParam ? decodeConfig(configParam) : null
  const namespaceDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : getServerDefaults()
  const slot: RankingSlot = rawType === "movie" ? "movie" : "series"
  const rankingSource = resolveRankingSource(
    {
      customCatalogs: tokenConfig?.customCatalogs ?? namespaceDefaults.customCatalogs,
      rankingSourceMovie: tokenConfig?.rankingSourceMovie ?? namespaceDefaults.rankingSourceMovie,
      rankingSourceSeries: tokenConfig?.rankingSourceSeries ?? namespaceDefaults.rankingSourceSeries,
    },
    slot,
  )
  const rankingCustom = rankingSource.kind === "custom"
    ? findRankingCustomCatalog(
        tokenConfig?.customCatalogs ?? namespaceDefaults.customCatalogs,
        rankingSource.customId,
      )
    : undefined
  // Regione classifica: `?region=`/`?country=` > `?lang=` > default server > IT.
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const qLang = req.nextUrl.searchParams.get("lang")
  const langRegion = qLang ? (parseRegion(qLang) ?? defaultRegionForLang(qLang)) : null
  const region = getRegionDef(qRegion ?? langRegion ?? normalizeRegion(namespaceDefaults.region))

  // Custom-driven rank: always the list Top-20 window (`first` stays a JW
  // contract and does not apply here); the key isolates per selection,
  // namespace and payload-changing credentials. Provider errors are explicit
  // and never cached, never a silent JW substitution. Browser/CDN caching
  // stays off on this branch (private no-cache): the URL does not change
  // when the selection does, so a public max-age would serve stale ranks;
  // the server-side app cache above still absorbs upstream cost (no branch
  // below uses shared caches — see the mutable-selection note).
  // Mutable-selection HTTP caching: every branch below resolves its source
  // server-side (namespace `?u=`, `?config=` token, or mutable global
  // defaults), so the URL does not version the selection — except an explicit
  // `?config=` token, which travels in the URL and therefore versions it.
  // Namespace/default selections can change without any URL change, so a
  // `public` Cache-Control would let shared (CDN/proxy) caches serve the
  // previous source's body after a save. All resolved-source branches
  // therefore stay out of shared caches (`private, no-cache`, the custom
  // precedent); the server-side app cache above still absorbs upstream cost.
  // Explicit failures and the GLOBAL-unsupported mode are `no-store` and
  // never cached anywhere. Data caches are untouched (headers only).
  const mutableSourceHeaders = { "Cache-Control": "private, no-cache, must-revalidate" }
  const customNoCacheHeaders = mutableSourceHeaders
  if (rankingSource.kind === "custom" && rankingCustom) {
    const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
    const cacheKey =
      `rank:v2:${rawType}:${id}:f20:r${region.code}` +
      `:rs${hashFragment(`${rankingSource.customId}:${rankingCustom.url}:${rankingCustom.datasetId ?? ""}`)}` +
      `${scopedUser ? `:u${hashFragment(scopedUser)}` : ""}` +
      `:ak${hashFragment(resolvedKeys.tmdb.key)}:mk${hashFragment(resolvedKeys.mdblist.key)}:vk${hashFragment(resolvedKeys.tvdb.key)}`
    const cached = cacheGet<{ rank: number | null; top: number }>(cacheKey)
    if (cached) {
      return Response.json(cached, { headers: customNoCacheHeaders })
    }
    const headers = customNoCacheHeaders
    let ranking: Awaited<ReturnType<typeof fetchCustomRankingTop20>>
    try {
      ranking = await fetchCustomRankingTop20({
        custom: rankingCustom,
        slot,
        apiKey: resolvedKeys.tmdb.key,
        mdblistKey: resolvedKeys.mdblist.key,
        tvdbKey: resolvedKeys.tvdb.key,
        userId: scopedUser,
      })
    } catch (e) {
      log.error("Custom ranking fetch failed", { error: e instanceof Error ? e.message : String(e) })
      return Response.json({ rank: null, error: "unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } })
    }
    if (ranking.status !== "ok" && ranking.status !== "empty") {
      return Response.json({ rank: null, error: ranking.status }, { status: 502, headers: { "Cache-Control": "no-store" } })
    }
    const idx = ranking.items.findIndex((r) => r.tmdbId === id)
    if (idx >= 0) {
      const body = { rank: idx + 1, period: "custom", top: 20 }
      cacheSet(cacheKey, body, ["rank", "custom_catalogs"])
      return Response.json(body, { headers })
    }
    const body = { rank: null, top: 20 }
    cacheSet(cacheKey, body, ["rank", "custom_catalogs"], 60_000)
    return Response.json(body, { headers })
  }

  // GLOBAL is unsupported for popular/trending (fetchTop20Ranking status
  // "unsupported", no region substitution): explicit unavailable, never a
  // publicly cached genuine miss. JwRankBadge renders `data?.error` as
  // unavailable, and the empty catalog is the approved UI state. Zero chart
  // I/O on this path (like the custom branch above): no pin, no drive.
  if (
    rankingSource.kind === "justwatch" &&
    (rankingSource.mode === "popular" || rankingSource.mode === "trending") &&
    region.code === GLOBAL_REGION_CODE
  ) {
    return Response.json({ rank: null, top: 20, period: rankingSource.mode, error: "unsupported" }, { headers: { "Cache-Control": "no-store" } })
  }

  // Per-family snapshot (custom/unsupported branches excluded above: zero
  // chart I/O there). Group identity MUST match the catalog/poster group
  // for the same effective coordinates (region + language; JW families never
  // depend on unrelated MDBList credentials), or keyed vs public generations
  // diverge across consumers. One request refreshes THAT stale family only
  // (awaited, bounded); competitors keep the pinned rows. Custom ranking
  // stays out (its own fetch owns ordering).
  const jwMode = rankingSource.kind === "justwatch" ? rankingSource.mode : null
  const chartFamily: string | null = jwMode
    ? `jw:${slot === "movie" ? "movie" : "series"}:${jwMode}`
    : null
  const chartGroup = chartListGroupKey({ regionCode: region.code, regionLang: region.lang })
  // Exact canonical window only (first=20, unfiltered): the pin is refreshed
  // here. The popular/trending branches always answer from the canonical
  // Top-20 snapshot (their window is fixed), so they always refresh. Other
  // windows stay live with today's keys+semantics (cycle-aware: in-slot
  // fresh via the floor) and are never published as canonical.
  const chartCanonical = first === 20
  const chartEnsure = chartFamily !== null && (chartCanonical || jwMode === "popular" || jwMode === "trending")
  const chartPin: ChartFamilyPin = chartFamily
    ? (chartEnsure
      ? await ensureFreshChartFamily({ regionCode: region.code, regionLang: region.lang, family: chartFamily })
      : await pinChartFamily({ regionCode: region.code, regionLang: region.lang, family: chartFamily }))
    : { id: CHART_LIVE_PIN_ID, snapshot: null }
  const chartCgFragment = chartFamily ? chartPinCacheFragment(chartPin) : ""
  // Cycle-aware freshness floor for in-scope source caches: the pinned
  // family's own slot start (00/06/12/18 for JW families).
  const chartFloor = chartFamily ? familySlotFloorMs(chartFamily) : currentChartSlotFloor()

  if (rankingSource.kind === "justwatch" && (rankingSource.mode === "popular" || rankingSource.mode === "trending")) {
    const cacheKey = `rank:v2:${rawType}:${id}:f20:r${region.code}:${rankingSource.mode}:g${chartGroup}${chartCgFragment}`
    const cached = cacheGet<{ rank: number | null; top: number; period: string }>(cacheKey)
    if (cached) {
      return Response.json(cached, { headers: mutableSourceHeaders })
    }
    try {
      // Rows come from the SAME published family snapshot the catalog order
      // and poster badge read (ensured upfront): one list, one rank.
      const res = { items: pinnedFamilyRows(chartPin) ?? [] }
      const found = res.items.find((r) => r.tmdbId === id)
      if (found) {
        const body = { rank: found.rank, period: rankingSource.mode, top: 20 }
        cacheSet(cacheKey, body, ["rank", "justwatch"])
        return Response.json(body, { headers: mutableSourceHeaders })
      }
      const body = { rank: null, top: 20, period: rankingSource.mode }
      cacheSet(cacheKey, body, ["rank", "justwatch"], 60_000)
      return Response.json(body, { headers: mutableSourceHeaders })
    } catch (e) {
      log.error("Fetch failed", { error: e instanceof Error ? e.message : String(e) })
      return Response.json({ rank: null }, { headers: { "Cache-Control": "no-store" } })
    }
  }

  // Exact canonical window only (first=20, unfiltered): other windows stay
  // live with today's keys+semantics (cycle-aware: in-slot fresh via the
  // floor) and are never published as canonical.
  const cacheKey = `rank:v2:${rawType}:${id}:f${first}:r${region.code}:g${chartGroup}${chartCanonical ? chartCgFragment : ""}`
  const cached = cacheGet<{ rank: number | null; period?: string }>(cacheKey)
  if (cached) {
    // Mutable defaults can retarget this same URL to another source, so even
    // the legacy charts branch stays out of shared caches (see above).
    return Response.json(cached, { headers: mutableSourceHeaders })
  }
  const headers = mutableSourceHeaders
  try {
    const jwType = rawType === "movie" ? "MOVIE" : "SHOW"
    // Canonical window rows come from the SAME published family snapshot the
    // catalog order reads (ensured upfront): one list, one rank. Non-canonical
    // windows stay live with the floor (never published as canonical).
    const rankings = chartCanonical
      ? (pinnedFamilyRows(chartPin) ?? [])
      : await getJWRankings(jwType, region.code, first, undefined, region.lang, undefined, chartFloor)
    const found = rankings.find((r) => r.tmdbId === id)
    if (found) {
      const body = { rank: found.rank, period: "day", top: first }
      cacheSet(cacheKey, body, ["rank", "justwatch"])
      return Response.json(body, { headers })
    }
    // No-match (fuori dalla finestra top-N o non in classifica): TTL breve —
    // un item può entrare in classifica nel giro di minuti, ma il fallimento
    // (o l'assenza) non deve congelarsi per MAX_TTL.
    const body = { rank: null, top: first }
    cacheSet(cacheKey, body, ["rank", "justwatch"], 60_000)
    return Response.json(body, { headers })
  } catch (e) {
    // Errore di rete: NON cachare il fallimento, ritenta al prossimo accesso.
    log.error("Fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ rank: null }, { headers: { "Cache-Control": "no-store" } })
  }
}
