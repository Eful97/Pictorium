import { NextRequest } from "next/server"
import { getJWRankings } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang } from "@/lib/regions"
import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { decodeConfig } from "@/lib/config-token"
import { resolveUserApiKeys } from "@/lib/tmdb"
import { resolveRankingSource, type RankingSlot } from "@/lib/ranking-source"
import { fetchCustomRankingTop20, findRankingCustomCatalog } from "@/lib/custom-ranking"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
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
  const rawFirst = Number(req.nextUrl.searchParams.get("first"))
  // Finestra di classifica consultata (semantica top-N, default 20 = top-20):
  // un titolo fuori dalla finestra non verrà mai trovato e risulta "senza
  // rank". `first` la rende configurabile (1-100) mantenendo il default.
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
  // the server-side app cache above still absorbs upstream cost. JW below
  // keeps its public caching untouched.
  const customNoCacheHeaders = { "Cache-Control": "private, no-cache, must-revalidate" }
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

  const cacheKey = `rank:v2:${rawType}:${id}:f${first}:r${region.code}`
  const cached = cacheGet<{ rank: number | null; period?: string }>(cacheKey)
  if (cached) {
    // Fix L9: anche il cache-hit dichiara i header cache (Next default
    // no-store) — altrimenti il path caldo non veniva mai cacchettato dalla CDN.
    return Response.json(cached, { headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" } })
  }
  const headers = { "Cache-Control": "public, max-age=300, s-maxage=1800" }
  try {
    const rankings = await getJWRankings(rawType === "movie" ? "MOVIE" : "SHOW", region.code, first, undefined, region.lang)
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
