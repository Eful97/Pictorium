// Preflight del ranking (fase C della poster route): risolve la fonte del
// rank (JustWatch, streaming, anime, lista custom/addon), legge i pin degli
// snapshot chart e avvia i fetch condivisi entro il budget di preflight, così
// la cache key porta già il rank live. Corpo spostato da route.ts invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import { GLOBAL_REGION_CODE, type RegionDef } from "@/lib/regions"
import type { ServerDefaults } from "@/lib/server-defaults"
import { chartListGroupKey, chartPinCacheFragment, pinChartFamily, type ChartFamilyPin } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { addonRankingSourceKey, fetchAddonRanking } from "@/lib/addon-ranking"
import { fetchCustomRankingTop20, findRankingCustomCatalog } from "@/lib/custom-ranking"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { hashKey } from "@/lib/poster-render-helpers"
import { isAutomaticTrendRank } from "@/lib/badge-priority"
import { parseListRankParam } from "@/lib/poster-params-hardening"
import { resolveRankingSource } from "@/lib/ranking-source"
import { streamingRankingCoordinates, streamingRankingItemsFromPin } from "@/lib/streaming-ranking"
import type { PosterAdmission } from "./admission"
import { POSTER_PREFLIGHT_MS, POSTER_TMDB_TIMEOUT_MS, RENDER_TIMEOUT_MS } from "./constants"

/**
 * Coalesced pre-cache source fetch: concurrent poster requests for the same
 * chart/list share one upstream call instead of one per title. Inflight-only
 * (deleted on settle), no TTL cache added. Cleanup attaches dual handlers so
 * neither the stored promise nor the derived cleanup promise rejects unhandled.
 */
const rankSourceInflight = new Map<string, Promise<unknown>>()

function sharedSourceFetch<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = rankSourceInflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = start()
  rankSourceInflight.set(key, p as Promise<unknown>)
  void p.then(
    () => { if (rankSourceInflight.get(key) === p) rankSourceInflight.delete(key) },
    () => { if (rankSourceInflight.get(key) === p) rankSourceInflight.delete(key) },
  )
  return p
}

/**
 * Per-caller bounded wait on a shared source promise. Settles with the shared
 * outcome when it wins, otherwise rejects after ms (or on external abort)
 * without aborting the shared fetch other callers wait on. Timer and listener
 * are always cleaned up on either path.
 */
function awaitWithOwnBudget<T>(promise: Promise<T>, ms: number, external?: AbortSignal | null): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cleanup = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    if (onAbort !== undefined && external) { external.removeEventListener("abort", onAbort); onAbort = undefined }
  }
  const bounded = new Promise<T>((_, reject) => {
    timer = setTimeout(() => { cleanup(); reject(new DOMException("Aborted", "AbortError")) }, Math.max(1, ms))
    if (external) {
      if (external.aborted) { cleanup(); reject(new DOMException("Aborted", "AbortError")) }
      else {
        onAbort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")) }
        external.addEventListener("abort", onAbort, { once: true })
      }
    }
  })
  return Promise.race([promise, bounded]).then(
    (v) => { cleanup(); return v },
    (e) => { cleanup(); throw e },
  )
}

/** Valori della richiesta letti dal preflight (già risolti, mai riassegnati). */
export interface RankingPreflightContext {
  readonly req: NextRequest
  readonly hardenedParams: URLSearchParams
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly mapping: Mapping | null
  readonly earlyEffMapping: Mapping | null
  readonly sd: ServerDefaults
  readonly configOverride: PosterAdmission["configOverride"]
  readonly configToken: string | null
  readonly posterRegion: RegionDef
  readonly scopedUser: string | null
  readonly effTmdbKey: string | undefined
  readonly effMdblistKey: string | undefined
  readonly effTvdbKey: string | undefined
  readonly startTime: number
}

/** Esito letto dalla cache key e dalla risoluzione finale del rank. */
export async function runRankingPreflight(ctx: RankingPreflightContext) {
  const {
    req, hardenedParams, mediaType, tmdbId, mapping, earlyEffMapping, sd, configOverride,
    configToken, posterRegion, scopedUser, effTmdbKey, effMdblistKey, effTvdbKey, startTime,
  } = ctx
  // Pre-cache rank snapshot so the cache key carries the live trend/anime rank.
  // The same snapshot is reused by the render below: no second fetch.
  // Enabled-flag mirrors the later queryPoster/mapping branches exactly:
  // explicit query wins, query-poster branch ignores the mapping, otherwise
  // the mapping decides, unmapped defaults to true.
  const qRankingPre = req.nextUrl.searchParams.get("ranking")
  const rankingEnabledPre = qRankingPre !== null
    ? qRankingPre !== "0"
    : (!!hardenedParams.get("poster") ? true : (earlyEffMapping?.rankingBadges ?? true))
  // Same parsers as the render: qRank overrides trend only (anime stays
  // independent), and only a valid non-negative int skips the trend fetch.
  // rk is the ephemeral list-rank context (position in the originating
  // selected list, 0 = explicit unranked): valid 0..100 skips BOTH trend and
  // anime fetches and wins over live ranks (decision A). Explicit qRank wins
  // over rk (manual override preserved); invalid rk = absent (legacy inert).
  const qRankPre = hardenedParams.get("rank")
  const qRankParsedPre = qRankPre !== null ? parseInt(qRankPre, 10) : NaN
  const hasValidQRankOverride = qRankPre !== null && qRankParsedPre >= 0
  const qRkPre = hardenedParams.get("rk")
  const hasValidListRankPre = !hasValidQRankOverride && parseListRankParam(qRkPre) !== null
  const qAnimeRankParamPre = hardenedParams.get("animerank")
  const qAnimeRankPre = qAnimeRankParamPre ? Number(qAnimeRankParamPre) : NaN
  const rankingSelectionPre = {
    customCatalogs: configOverride?.customCatalogs ?? sd.customCatalogs,
    streamingSelections: configOverride?.streamingSelections ?? sd.streamingSelections,
    rankingSourceMovie: configOverride?.rankingSourceMovie ?? sd.rankingSourceMovie,
    rankingSourceSeries: configOverride?.rankingSourceSeries ?? sd.rankingSourceSeries,
  }
  const rankingSourcePre = resolveRankingSource(
    rankingSelectionPre,
    mediaType === "movie" ? "movie" : "series",
  )
  const rankingCustomPre = rankingSourcePre.kind === "custom" || rankingSourcePre.kind === "addon"
    ? findRankingCustomCatalog(rankingSelectionPre.customCatalogs, rankingSourcePre.customId)
    : undefined
  // Imported Top 10 ranking source: same pinned family the list's own catalog
  // serves (official 1..10 ranks). Coordinates are derivable from the id, so
  // the pin happens before the preflight exactly like the JW families.
  const streamingRankPre = rankingSourcePre.kind === "streaming"
    ? streamingRankingCoordinates(rankingSourcePre.catalogId)
    : null
  // Fail-closed per new JW mode: an upstream popular/trending error resolves
  // null (no stored-rank fallback from another source). The legacy charts
  // path keeps its historical degraded fallback to the saved rank (pinned by
  // poster-route-mapping.test.ts); the custom branch above is already
  // fail-closed (.catch(() => null)).
  const isNewJwModePre = rankingSourcePre.kind === "justwatch"
    && (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
  // Bounded preflight: the whole poster-path pins+refresh phase stays within
  // POSTER_PREFLIGHT_MS (~1.5s). Shared source calls run on a common timeout
  // signal (never req.signal: a disconnecting first client must not abort the
  // fetch others are coalesced on).
  const preflightStart = Date.now()
  // H3: read-only pin budget — a hanging durable read degrades to null (live
  // fragment in the coalescing key, no rank) instead of stalling the poster.
  const pinBudgetMs = Math.max(1, Math.min(POSTER_PREFLIGHT_MS, POSTER_TMDB_TIMEOUT_MS, RENDER_TIMEOUT_MS - (Date.now() - startTime)))
  const needTrendFetch = rankingEnabledPre && !hasValidQRankOverride && !hasValidListRankPre
  const needAnimeFetch = rankingEnabledPre && !(Number.isFinite(qAnimeRankPre) && qAnimeRankPre > 0) && !hasValidListRankPre
  const animeListKey = mediaType === "movie" ? "mdblistAnimeMovie" : "mdblistAnime"
  // MDBList key effective for the anime family: resolveUserApiKeys already
  // applies the multi-user instance/env guard (scoped requests never inherit
  // operator keys). Never re-read the env here: that bypassed the guard and
  // let a bare `?u=` burn the operator's MDBList quota.
  const animeKeyUsed = effMdblistKey || undefined
  // Per-family snapshots (render-budget path): canonical rank inputs come from
  // the SAME published snapshots the catalog and rank routes read — one pin
  // per family per request (mid-request consistency). One request refreshes
  // THAT stale family only (awaited, bounded); unrelated families are never
  // touched. Custom branch excluded (no chart I/O). Coalescing keys isolate
  // the exact group + pinned snapshot version: concurrent different
  // groups/generations never share in-flight reads.
  const jwSlot = mediaType === "movie" ? "movie" : "series"
  const jwFamily = rankingSourcePre.kind === "justwatch" && (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
    ? `jw:${jwSlot}:${rankingSourcePre.mode}`
    : `jw:${jwSlot}:charts`
  // GLOBAL popular/trending: unsupported (fail-closed, zero chart I/O — come
  // la rank route); nessun fetch, nessun gate, nessun fallback inventato.
  const jwGlobalUnsupported = rankingSourcePre.kind === "justwatch" &&
    (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending") &&
    posterRegion.code === GLOBAL_REGION_CODE
  // Conditional pins: pinChartFamily revalidates durable storage, so only
  // pin families this request actually needs. ranking=0 (or an explicit rank
  // override) skips the JW pin; custom sources skip JW chart I/O entirely;
  // anime pins only when the anime rank still needs resolving (a custom JW
  // selection keeps anime behavior: the anime family is independent).
  // Skipped pins fall back to the live fragment in the coalescing key (the
  // corresponding preflight resolves immediately, so the key is unused).
  // H3+H4: one durable pin read per family per request (parallel, never
  // serial), each bounded by pinBudgetMs and fail-open to null. The pins are
  // reused as prePin by the refresh calls below — no duplicate durable read
  // per family (H4).
  const needJwPin = needTrendFetch && !jwGlobalUnsupported && rankingSourcePre.kind === "justwatch"
  const needAnimePin = needAnimeFetch
  const jwGroupInput = { regionCode: posterRegion.code, regionLang: posterRegion.lang }
  const needStreamingPin = needTrendFetch && streamingRankPre !== null
  const chartAnimeFamily = mediaType === "movie" ? "anime:movie" : "anime:series"
  const animeGroupInput = { regionCode: posterRegion.code, regionLang: posterRegion.lang, mdblistKey: animeKeyUsed }
  const [jwPrePin, streamingPrePin, animePrePin] = await Promise.all([
    needJwPin
      ? awaitWithOwnBudget(pinChartFamily({ ...jwGroupInput, family: jwFamily }), pinBudgetMs, req.signal).catch(() => null)
      : Promise.resolve(null),
    needStreamingPin && streamingRankPre
      ? awaitWithOwnBudget(pinChartFamily({
        regionCode: streamingRankPre.regionCode,
        regionLang: streamingRankPre.regionLang,
        family: streamingRankPre.family,
      }), pinBudgetMs, req.signal).catch(() => null)
      : Promise.resolve(null),
    needAnimePin
      ? awaitWithOwnBudget(pinChartFamily({ ...animeGroupInput, family: chartAnimeFamily }), pinBudgetMs, req.signal).catch(() => null)
      : Promise.resolve(null),
  ])
  const jwSourceKey = `jw:${mediaType === "movie" ? "MOVIE" : "SHOW"}:${posterRegion.code}:20:${posterRegion.lang}${rankingSourcePre.kind === "justwatch" && rankingSourcePre.mode !== "charts" ? `:${rankingSourcePre.mode}` : ""}:g${chartListGroupKey(jwGroupInput)}${jwPrePin ? chartPinCacheFragment(jwPrePin) : ":cglive"}`
  const streamingSourceKey = streamingRankPre
    ? `streaming:${mediaType}:${streamingRankPre.family}:g${chartListGroupKey({ regionCode: streamingRankPre.regionCode, regionLang: streamingRankPre.regionLang })}${streamingPrePin ? chartPinCacheFragment(streamingPrePin) : ":cglive"}`
    : ""
  const animeSourceKey = `anime:${mediaType}:${posterRegion.code}:${posterRegion.lang}:${hashKey(animeKeyUsed ?? "")}${animePrePin ? chartPinCacheFragment(animePrePin) : ":cglive"}`
  const customSourceKey = `custom:${mediaType}:${scopedUser ?? "anon"}:${hashKey(JSON.stringify(rankingCustomPre ?? null))}:${hashKey([(effTmdbKey ?? ""), (effMdblistKey ?? ""), (effTvdbKey ?? "")].join("|"))}`
  // Imported addon ranking source: identity of the ACTUAL remote catalog (a
  // manifest can host several lists), shared across concurrent titles.
  const addonSourceKey = rankingSourcePre.kind === "addon" && rankingCustomPre?.addon
    ? `addon:${mediaType}:${scopedUser ?? "anon"}:${addonRankingSourceKey(rankingCustomPre.addon)}:${hashKey([(effTmdbKey ?? ""), (effTvdbKey ?? ""), configToken ?? ""].join("|"))}`
    : ""
  const addonRankingInput = rankingSourcePre.kind === "addon" && rankingCustomPre?.addon
    ? {
      custom: rankingCustomPre,
      slot: mediaType === "movie" ? ("movie" as const) : ("series" as const),
      apiKey: effTmdbKey,
      tvdbKey: effTvdbKey,
      userId: scopedUser,
      configParam: configToken,
      requestOrigin: getOriginFromRequest(req),
    }
    : null
  // Task D: provenance dei fatti baked-in. `true` quando il rank è servito da
  // uno snapshot pubblicato (fatto volatile con scadenza nota = fine slot),
  // non cake fallback al rank salvato (stabile, nessun cap) né abort/budget.
  let trendRankLive = false
  let animeRankLive = false
  // Rank effettivamente consumato dallo snapshot (per il freshness cap sotto).
  let trendSnapshotPin: ChartFamilyPin | null = null
  let animeSnapshotPin: ChartFamilyPin | null = null
  // Imported Top 10 ranking source: pinned snapshot consumed by this render.
  let streamingSnapshotPin: ChartFamilyPin | null = null
  // Saved-rank fallback for the automatic channel: only a stored Top-20
  // rank may stand in on cold failure. A saved platform/custom rank past
  // the window is never resurrected (explicit `rank=` overrides and the
  // `rk=` list context keep their own precedence below, untouched).
  const savedAutomaticRank = (m: typeof mapping): number | null => {
    const r = m?.badgeRank ?? m?.trendRank ?? null
    return isAutomaticTrendRank(r) ? r : null
  }
  // H3: the refresh half of the preflight gets only what's left of the total
  // poster preflight budget — pins+refresh together stay ~1.2-1.5s. When the
  // pins already consumed it, the budget collapses to 1ms and the refresh
  // degrades immediately (last-good / saved rank / no rank via the catches
  // below); catalog/rank routes own the refresh outside this path.
  const preflightBudgetMs = Math.max(1, Math.min(POSTER_PREFLIGHT_MS - (Date.now() - preflightStart), POSTER_TMDB_TIMEOUT_MS, RENDER_TIMEOUT_MS - (Date.now() - startTime)))
  const preflightSourceSignal = AbortSignal.timeout(preflightBudgetMs)
  const trendPreflight: Promise<number | null> = !needTrendFetch || jwGlobalUnsupported
    ? Promise.resolve(null)
    : (rankingSourcePre.kind === "streaming" && streamingRankPre
      ? awaitWithOwnBudget(sharedSourceFetch<ChartFamilyPin>(streamingSourceKey, () => ensureFreshChartFamily({
        regionCode: streamingRankPre.regionCode,
        regionLang: streamingRankPre.regionLang,
        tmdbLang: streamingRankPre.regionLang,
        signal: preflightSourceSignal,
        family: streamingRankPre.family,
        prePin: streamingPrePin,
      })), preflightBudgetMs, req.signal)
        // Per-caller lookup OUTSIDE the coalesced fetch (same contract as the
        // JW branch): the shared pin is read once, each request derives its
        // own official chart position.
        .then((pin) => {
          streamingSnapshotPin = pin
          trendRankLive = pin.snapshot != null
          // Cold failure: fail-closed (never another source's rank, never a
          // saved rank from a previous source).
          if (!pin.snapshot) return null
          // Same slot projection as the catalog/preview: mixed charts keep
          // their real per-row media type and official positions.
          const projected = streamingRankingItemsFromPin(
            pin,
            mediaType === "movie" ? "movie" : "series",
            streamingRankPre,
          )
          const found = projected.items.find((x) => x.tmdbId === tmdbId)?.rank ?? null
          return isAutomaticTrendRank(found) ? found : null
        })
        .catch(() => { trendRankLive = false; streamingSnapshotPin = null; return null })
      : rankingSourcePre.kind === "addon"
      ? (addonRankingInput
        ? awaitWithOwnBudget(sharedSourceFetch(addonSourceKey, () => fetchAddonRanking({
          ...addonRankingInput,
          signal: preflightSourceSignal,
        })), preflightBudgetMs, req.signal)
          .then((res) => {
            trendRankLive = res.status === "ok"
            if (res.status !== "ok") return null
            const found = res.items.find((x) => x.tmdbId === tmdbId)?.rank ?? null
            return isAutomaticTrendRank(found) ? found : null
          })
          .catch(() => { trendRankLive = false; return null })
        : Promise.resolve(null))
      : rankingSourcePre.kind === "custom" && rankingCustomPre
      ? awaitWithOwnBudget(sharedSourceFetch(customSourceKey, () => fetchCustomRankingTop20({
        custom: rankingCustomPre,
        slot: mediaType === "movie" ? "movie" : "series",
        apiKey: effTmdbKey,
        mdblistKey: effMdblistKey,
        tvdbKey: effTvdbKey,
        userId: scopedUser,
        signal: preflightSourceSignal,
      }))
        .then((r) => {
          trendRankLive = true
          if (r.status !== "ok") return null
          const idx = r.items.findIndex((x) => x.tmdbId === tmdbId)
          return idx >= 0 ? idx + 1 : null
        }), preflightBudgetMs, req.signal)
        .catch(() => { trendRankLive = false; return null })
      : awaitWithOwnBudget(sharedSourceFetch<ChartFamilyPin>(jwSourceKey, () => ensureFreshChartFamily({
        regionCode: posterRegion.code,
        regionLang: posterRegion.lang,
        tmdbLang: posterRegion.lang,
        signal: preflightSourceSignal,
        family: jwFamily,
        prePin: jwPrePin,
      })), preflightBudgetMs, req.signal)
        // Per-caller resolution OUTSIDE the coalesced fetch: the shared call
        // returns the raw pin (one fetch per source, key excludes tmdbId);
        // each waiter derives its own rank + pin/provenance from it. A
        // per-title lookup inside the shared callback would serve the first
        // caller's rank to every concurrent title.
        .then((pin) => {
          trendSnapshotPin = pin
          trendRankLive = pin.snapshot != null
          // Cold failure (no snapshot): legacy charts contract degrades to
          // the saved rank, capped at the automatic Top-20 window (never
          // resurrect a stale platform/custom rank past it); a genuine miss
          // in a published snapshot stays null (never resurrect a stale
          // saved rank for an unranked title).
          if (!pin.snapshot) return isNewJwModePre ? null : savedAutomaticRank(mapping)
          const found = pin.snapshot.rows.find((x) => x.tmdbId === tmdbId)?.rank ?? null
          // Automatic badges read official Top-20 positions only: an
          // official rank past the window (overfetch shift, package-filter
          // ranks) yields no badge — never clamped, never remapped.
          return isAutomaticTrendRank(found) ? found : null
        })
        .catch(() => { trendRankLive = false; trendSnapshotPin = null; return isNewJwModePre ? null : savedAutomaticRank(mapping) }))
  const animePreflight: Promise<number | null> = !needAnimeFetch
    // List-rank context wins over live anime (decision A): a skipped fetch
    // resolves to null, never NaN (stable cache key, no phantom anime win).
    // An explicit valid `animerank` still resolves below via the finite check.
    ? Promise.resolve(rankingEnabledPre && !hasValidListRankPre && Number.isFinite(qAnimeRankPre) ? qAnimeRankPre : null)
    : awaitWithOwnBudget(sharedSourceFetch<ChartFamilyPin>(animeSourceKey, () => ensureFreshChartFamily({
      regionCode: posterRegion.code,
      regionLang: posterRegion.lang,
      tmdbLang: posterRegion.lang,
      mdblistKey: animeKeyUsed,
      signal: preflightSourceSignal,
      family: chartAnimeFamily,
      prePin: animePrePin,
    })), preflightBudgetMs, req.signal)
      // Same per-caller contract as the trend branch above: raw pin is
      // shared, the position lookup + pin/provenance are per request.
      .then((pin) => {
        animeSnapshotPin = pin
        animeRankLive = pin.snapshot != null
        // Cold failure (no snapshot): fall back to the saved anime rank; a
        // genuine miss in a published snapshot stays null.
        if (!pin.snapshot) return mapping?.animeRank ?? null
        const idx = pin.snapshot.rows.findIndex((r) => r.tmdbId === tmdbId)
        return idx >= 0 ? idx + 1 : null
      })
      .catch(() => { animeRankLive = false; animeSnapshotPin = null; return mapping?.animeRank ?? null })
  const [preTrendRank, preAnimeRank] = await Promise.all([trendPreflight, animePreflight])
  // Preflight time is subtracted from the watchdog below: preflight does not
  // extend the existing render budget.
  const preflightMs = Date.now() - preflightStart
  return {
    rankingSourcePre,
    rankingCustomPre,
    streamingRankPre,
    needTrendFetch,
    needAnimeFetch,
    animeListKey,
    animeKeyUsed,
    jwFamily,
    chartAnimeFamily,
    addonRankingInput,
    trendRankLive,
    animeRankLive,
    trendSnapshotPin,
    animeSnapshotPin,
    streamingSnapshotPin,
    preTrendRank,
    preAnimeRank,
    preflightMs,
  }
}
