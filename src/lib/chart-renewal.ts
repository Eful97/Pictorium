import {
  CHART_LIVE_PIN_ID,
  commitChartFamilySnapshot,
  familySlotFloorMs,
  familySlotKey,
  isChartFamilyGated,
  pinChartFamily,
  releaseChartFamilyLease,
  tryAcquireChartFamilyLease,
  type ChartFamilyPin,
  type ChartFamilyProvenance,
  type ChartFamilyStatus,
  type ChartGroupInput,
} from "@/lib/chart-generation"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import type { JustWatchRankingMode } from "@/lib/ranking-source"
import { getJWRankings, type JWRankEntry } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { getTop10, resolveFlixPlatformSides, resolveGenericFlixCharts, type FlixGenericSection } from "@/lib/flixpatrol"
import {
  STREAMING_JW_PACKAGES,
  chartCountryInfo,
  genericIndexServiceId,
  genericJwPackagesForService,
  genericJwServiceKey,
  jwFallbackSupported,
  parseGenericStreamFamily,
  streamingFlixSlug,
  type StreamingService,
} from "@/lib/streaming-catalogs"
import { getRegionDef, GLOBAL_REGION_CODE } from "@/lib/regions"
import { createLogger } from "@/lib/logger"

const log = createLogger("chart-renewal")

// ---------------------------------------------------------------------------
// Per-family renewal: one request to its catalog/rank refreshes THAT stale
// list only — never unrelated platforms, anime lists, or modes.
//
// `ensureFreshChartFamily` is the single reusable awaited refresh API (also
// suitable for a future scheduled trigger, which stays a separate task: no
// scheduler, no config, no deploy changes here):
// - pin is current (a published snapshot of this slot) → return it, zero
//   upstream fetches;
// - failure gate active (<60s after a source failure) → return the old pin
//   (retention: the last good snapshot keeps serving);
// - another owner holds the refresh lease → return the old pin immediately
//   (competitors never wait; the owner serves new rows after its commit);
// - else this request becomes the owner: one bounded fetch at exact serving
//   coordinates (existing internal upstream timeouts bound it; nothing
//   survives the request lifecycle), guarded atomic commit, lease release —
//   all awaited inside the owning request lifecycle, never fire-and-forget.
//
// A cold start (no published snapshot) fetches the requested list only and
// publishes it immediately on success.
// ---------------------------------------------------------------------------

/**
 * Canonical LEGACY platform sources (historic coordinate table: package
 * filter for the JustWatch fast-path + FlixPatrol slug for the fallback). JW
 * ignores unknown regional package codes, so the unions are safe in every
 * region. Historic unions are preserved byte-identical here (NOW via
 * `pct`/`pcp` Peacock, Paramount via `sst` SkyShowtime): task2 must not drift
 * legacy `pictorium-<platform>-*` catalogs. New opt-in `stream:` families
 * below use the strict own-brand packages from `streaming-catalogs.ts`
 * (no sibling aliases) — separate family identity, separate pins.
 */
export const CHART_PLATFORM_SOURCES: Record<string, { jwPackages: string[]; flixSlug: string }> = {
  // Prime: shortName regionale — `prv` (IT/FR/ES/...) vs `amp` (US/GB/DE/JP).
  netflix: { jwPackages: ["nfx"], flixSlug: "netflix" },
  prime: { jwPackages: ["prv", "amp"], flixSlug: "amazon-prime" },
  disney: { jwPackages: ["dnp"], flixSlug: "disney" },
  // NOW/Sky esiste solo in alcuni paesi; negli USA il catalogo mappa Peacock
  // (stesso gruppo NBCUniversal/Comcast): `pct`+`pcp`, ignorati dove assenti.
  now: { jwPackages: ["ntv", "skg", "pct", "pcp"], flixSlug: "now" },
  apple: { jwPackages: ["atp"], flixSlug: "apple-tv" },
  hbo: { jwPackages: ["mxx"], flixSlug: "hbo-max" },
  // Paramount+ in ES è SkyShowtime (`sst`): unione sicura come sopra.
  paramount: { jwPackages: ["pmp", "sst"], flixSlug: "paramount-plus" },
  crunchyroll: { jwPackages: ["cru"], flixSlug: "crunchyroll" },
}

export interface ChartRenewalContext extends ChartGroupInput {
  /** TMDB UI language for title localization (defaults to region language). */
  readonly tmdbLang?: string
  /** TMDB key for the FlixPatrol fallback enrichment path (unenriched: unused). */
  readonly tmdbKey?: string
  /** Abort signal (e.g. poster preflight budget): fetch stays bounded. */
  readonly signal?: AbortSignal
}

export interface FamilyFetchResult {
  readonly rows: unknown
  readonly status: ChartFamilyStatus
  readonly provenance?: ChartFamilyProvenance
}

/**
 * Fetch ONE canonical family at exact serving coordinates (cycle-aware: the
 * freshness floor forces a real upstream refresh past the slot boundary; the
 * floor only bypasses pre-boundary entries — in-slot entries and independent
 * quality/availability caches are untouched). Throws on transport failure
 * (the refresh converts it to an error contribution: gate + retention).
 *
 * Platform families select JW or FlixPatrol via the existing serving
 * fallback and retain the winning provenance + order. Only the REQUESTED
 * side is returned (a FlixPatrol payload inherently observes both sides at
 * once, but the sibling refreshes on its own request — no cross-family
 * writes here).
 */
export async function fetchChartFamilyRows(
  family: string,
  ctx: ChartRenewalContext & { floor: number },
): Promise<FamilyFetchResult> {
  const { regionCode, regionLang, tmdbLang, mdblistKey, tmdbKey, signal, floor } = ctx
  const lang = tmdbLang ?? regionLang

  const jwMatch = /^(jw:(movie|series):(charts|popular|trending))$/.exec(family)
  if (jwMatch) {
    const slotType = jwMatch[2] as "movie" | "series"
    const mode = jwMatch[3] as JustWatchRankingMode
    const res = await fetchTop20Ranking({
      slot: slotType,
      source: { kind: "justwatch", mode },
      regionCode,
      regionLang,
      signal,
      minFetchedAtMs: floor,
      strict: true,
    })
    if (res.status === "error" || res.status === "unsupported") {
      throw new Error(`chart-renewal ${family}: ${res.status}`)
    }
    // A successful zero-row read is a genuine empty for this cycle: it
    // publishes an empty snapshot (a miss stays null and never resurrects a
    // saved rank). Only transport failure (throw → error contribution, gate +
    // retention) keeps the last good snapshot. Strict mode guarantees the []
    // here is a real upstream success, never a conflated outage (circuit-open
    // and HTTP failures throw above).
    if (res.status === "empty" || res.items.length === 0) {
      return { rows: [], status: "empty" }
    }
    return { rows: res.items, status: "ok" }
  }

  const platformMatch = /^platform:(.+):(movie|series)$/.exec(family)
  if (platformMatch) {
    const [, platformKey, stType] = platformMatch
    const src = CHART_PLATFORM_SOURCES[platformKey]
    if (!src) throw new Error(`chart-renewal: unknown platform family ${family}`)
    const objectType = stType === "movie" ? "MOVIE" : "SHOW"
    // Exact canonical coordinates: unfiltered top-10 window, same as serving.
    const isGlobal = (regionCode || "").toUpperCase() === GLOBAL_REGION_CODE
    const flixCountry = getRegionDef(regionCode).flixSlug
    // FP-first (non-GLOBAL only): a fresh usable fp-crawler chart for the
    // REQUESTED side wins with ZERO JW traffic — a fresh movies chart never
    // suppresses the series JW fallback or vice versa (no cross-side
    // filling, never blended within one chart; an opposite-side integrity
    // failure never blocks the requested side). FP misses (absent split,
    // stale/invalid date, transport failure, malformed document/chart —
    // including charts with zero usable tmdbIds) fall through to the JW
    // fallback below; only a JW failure on top of that throws (both sources
    // down: failure retention + 60s gate), never a fake empty. GLOBAL keeps
    // the historical JW-only path (GLOBAL FP deliberately excluded by scope)
    // — unchanged.
    // LEGACY policy: the historic JW group-package unions always apply here
    // (NOW via Peacock, Paramount via SkyShowtime). No no-alias gate on this
    // path — task2 must not drift legacy catalogs when no opt-in selection
    // exists. The strict policy lives on the `stream:` families below.
    if (!isGlobal) {
      const fp = await resolveFlixPlatformSides(src.flixSlug, flixCountry, {
        minFetchedAtMs: floor,
        freshOrThrow: true,
      })
      const side = stType === "movie" ? fp.movie : fp.tv
      if (side.kind === "hit") {
        const seen = new Set<number>()
        const rows: JWRankEntry[] = []
        for (const e of side.entries) {
          const id = e.tmdb?.id ?? null
          if (!id || seen.has(id)) continue
          seen.add(id)
          rows.push({ tmdbId: id, imdbId: null, rank: e.rank, title: e.title ?? null })
          if (rows.length >= 10) break
        }
        // A successful fallback read with zero rows is a genuine empty for
        // this cycle: it publishes an empty snapshot so a miss stays null.
        // Failure (throw above, incl. the integrity violations) keeps the
        // last good snapshot via the error path.
        if (rows.length === 0) {
          return { rows: [], status: "empty", provenance: "flixpatrol" }
        }
        return { rows, status: "ok", provenance: "flixpatrol" }
      }
      // Miss → JW fallback below (same strict fetch as before).
    }
    // Strict: a transport failure (including an open circuit) throws and, for
    // non-GLOBAL families, propagates (both sources failed → error retention
    // via the caller); a successful [] is a real upstream answer, not an
    // outage — it publishes an empty snapshot. GLOBAL empties are legitimate
    // by design.
    try {
      const rows = await getJWRankings(objectType, regionCode, 10, src.jwPackages, lang, signal, floor, true)
      if (rows.length > 0) {
        return { rows: rows.slice(0, 10), status: "ok", provenance: "justwatch" }
      }
      if (!isGlobal) {
        return { rows: [], status: "empty", provenance: "justwatch" }
      }
      // GLOBAL: historical path below (unchanged) — GLOBAL FP is deliberately
      // excluded by scope, so the FP probe always misses by design.
    } catch (e) {
      if (!isGlobal) {
        log.debug("chart-renewal platform JW fallback failed, retaining last good", {
          family,
          error: e instanceof Error ? e.message : String(e),
        })
        throw e
      }
      log.debug("chart-renewal platform JW failed, trying FlixPatrol", {
        family,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    // GLOBAL-only historical tail (unchanged): GLOBAL FP is deliberately
    // excluded by scope, so the probe always misses by design.
    const data = await getTop10(src.flixSlug, flixCountry, tmdbKey, { enrich: false, minFetchedAtMs: floor, freshOrThrow: true })
    const items = stType === "movie" ? data.movies : data.tv
    const toRows = (list: { tmdbId: number | null; title: string; rank: number }[]): JWRankEntry[] =>
      list.filter((i) => i.tmdbId).slice(0, 10).map((i) => ({ tmdbId: i.tmdbId as number, imdbId: null, rank: i.rank, title: i.title ?? null }))
    const rows = toRows(items)
    // A successful fallback read with zero rows is a genuine empty for this
    // cycle on every region (not merely GLOBAL): it publishes an empty
    // snapshot so a miss stays null. Failure (throw above: JW strict failure,
    // or the getTop10 strict both-down throw when FP missed and JW failed)
    // keeps the last good snapshot via the error path. GLOBAL empties remain
    // legitimate by design (scope exclusion, never national fill).
    if (rows.length === 0) {
      return { rows: [], status: "empty", provenance: "flixpatrol" }
    }
    return { rows, status: "ok", provenance: "flixpatrol" }
  }

  const streamMatch = /^stream:(.+):(movie|series)$/.exec(family)
  if (streamMatch) {
    const [, serviceKey, stType] = streamMatch
    const service = serviceKey as StreamingService
    const strictPackages = STREAMING_JW_PACKAGES[service]
    if (!strictPackages) throw new Error(`chart-renewal: unknown stream family ${family}`)
    const objectType = stType === "movie" ? "MOVIE" : "SHOW"
    const isGlobal = (regionCode || "").toUpperCase() === GLOBAL_REGION_CODE
    // Opt-in selections never carry GLOBAL (parse rejects it), but fail
    // closed if it ever arrives: no global fill under a selection name.
    if (isGlobal) return { rows: [], status: "empty" }
    const flixSlug = streamingFlixSlug(service)
    const flixCountry = getRegionDef(regionCode).flixSlug
    // FP-first with the same per-side independence as the legacy path.
    const fp = await resolveFlixPlatformSides(flixSlug, flixCountry, {
      minFetchedAtMs: floor,
      freshOrThrow: true,
    })
    const side = stType === "movie" ? fp.movie : fp.tv
    if (side.kind === "hit") {
      const seen = new Set<number>()
      const rows: JWRankEntry[] = []
      for (const e of side.entries) {
        const id = e.tmdb?.id ?? null
        if (!id || seen.has(id)) continue
        seen.add(id)
        rows.push({ tmdbId: id, imdbId: null, rank: e.rank, title: e.title ?? null })
        if (rows.length >= 10) break
      }
      if (rows.length === 0) {
        return { rows: [], status: "empty", provenance: "flixpatrol" }
      }
      return { rows, status: "ok", provenance: "flixpatrol" }
    }
    // Strict no-alias gate (opt-in contract): pairs without a verified
    // own-brand JW fallback never touch JW (zero group-package traffic, no
    // Peacock/SkyShowtime laundering) — FP-only, otherwise a genuine empty
    // with NO provenance. Failure retention: an FP transport outage
    // (`loadFailed`) or an unusable FP source (malformed document or
    // malformed requested-side entries) THROWS here — the refresh converts
    // it to an error contribution (old pin kept + 60s gate), never a fake
    // empty that would retire the last-good snapshot. Only an actually
    // absent split (no chart) or a stale-dated chart for the requested side
    // publishes a genuine empty (unavailable pair, miss stays null).
    if (!jwFallbackSupported(service, regionCode)) {
      if (fp.loadFailed) {
        throw fp.loadError instanceof Error ? fp.loadError : new Error(`chart-renewal ${family}: flixpatrol load failed`)
      }
      if (fp.docInvalid || (side.kind === "miss" && side.reason === "invalid")) {
        throw new Error(`chart-renewal ${family}: flixpatrol source unusable (integrity failure)`)
      }
      return { rows: [], status: "empty" }
    }
    try {
      const rows = await getJWRankings(objectType, regionCode, 10, [...strictPackages], lang, signal, floor, true)
      if (rows.length > 0) {
        return { rows: rows.slice(0, 10), status: "ok", provenance: "justwatch" }
      }
      return { rows: [], status: "empty", provenance: "justwatch" }
    } catch (e) {
      log.debug("chart-renewal stream JW fallback failed, retaining last good", {
        family,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  const genericMatch = parseGenericStreamFamily(family)
  if (genericMatch) {
    const desc = genericMatch
    const info = chartCountryInfo(desc.chartSlug)
    // Mixed `all` (overall) charts are FP-only by design in every source
    // mode: blending separate JW movies+shows charts would invent ranks, so
    // `auto` on `all` behaves like FP-only (no JW traffic at all).
    const allowsFp = desc.source === "auto" || desc.source === "flixpatrol"
    const allowsJw = (desc.source === "auto" || desc.source === "justwatch") && desc.section !== "all"
    // Alias-aware: curated names (`prime`) and index ids (`amazon-prime`)
    // resolve to the same FP chart and the same own-brand JW packages.
    const fpService = genericIndexServiceId(desc.service)
    const jwService = genericJwServiceKey(desc.service)
    const strictPackages = genericJwPackagesForService(desc.service)
    const jwCode = info.knownRegion ? info.code : null
    const jwEligible =
      allowsJw &&
      !!strictPackages &&
      !!jwService &&
      !!jwCode &&
      jwCode !== GLOBAL_REGION_CODE &&
      jwFallbackSupported(jwService, jwCode)
    const objectType = desc.section === "series" ? "SHOW" : "MOVIE"
    const sectionDefaultMedia = desc.section === "series" ? "tv" : "movie"

    const toGenericRows = (entries: Array<{ rank: number; title: string; tmdb?: { id?: unknown; media_type?: unknown } | null }>): JWRankEntry[] => {
      const seen = new Set<number>()
      const rows: JWRankEntry[] = []
      for (const e of entries) {
        const id = Number((e.tmdb as { id?: unknown } | null)?.id ?? NaN)
        if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
        seen.add(id)
        const rawMt = (e.tmdb as { media_type?: unknown } | null)?.media_type
        const mediaType = rawMt === "tv" || rawMt === "movie" ? rawMt : sectionDefaultMedia
        rows.push({
          tmdbId: id,
          imdbId: null,
          rank: e.rank,
          title: e.title ?? null,
          mediaType: mediaType as "movie" | "tv",
        } as JWRankEntry)
        if (rows.length >= 10) break
      }
      return rows
    }

    const fetchJwStrict = async (): Promise<FamilyFetchResult> => {
      const rows = await getJWRankings(objectType, jwCode as string, 10, [...(strictPackages as readonly string[])], info.lang, signal, floor, true)
      if (rows.length > 0) {
        return {
          rows: rows.slice(0, 10).map((r) => ({
            tmdbId: r.tmdbId,
            imdbId: r.imdbId ?? null,
            rank: r.rank,
            title: r.title ?? null,
            mediaType: sectionDefaultMedia,
          })),
          status: "ok",
          provenance: "justwatch",
        }
      }
      return { rows: [], status: "empty", provenance: "justwatch" }
    }

    if (allowsFp) {
      const fp = await resolveGenericFlixCharts(fpService, desc.chartSlug, desc.section as FlixGenericSection, {
        variant: desc.variant,
        minFetchedAtMs: floor,
      })
      if (fp.kind === "hit") {
        const rows = toGenericRows(fp.entries)
        if (rows.length === 0) {
          return { rows: [], status: "empty", provenance: "flixpatrol" }
        }
        return { rows, status: "ok", provenance: "flixpatrol" }
      }
      const fpOutage = fp.loadFailed || fp.docInvalid || fp.reason === "invalid"
      if (fpOutage) {
        // Outage/integrity (transport failure, malformed document or
        // unusable entries): retention, never a fake empty. With an eligible
        // JW fallback the JW attempt owns the decision (a JW failure on top
        // throws: both sources down); without one this throws now.
        if (jwEligible) {
          try {
            return await fetchJwStrict()
          } catch (e) {
            log.debug("chart-renewal generic stream JW fallback failed after FP outage, retaining last good", {
              family,
              error: e instanceof Error ? e.message : String(e),
            })
            throw e
          }
        }
        throw fp.loadError instanceof Error ? fp.loadError : new Error(`chart-renewal ${family}: flixpatrol source unusable`)
      }
      // Absent split or stale-dated chart: genuinely unavailable for this
      // cycle (no provenance). With an eligible JW fallback the JW attempt
      // owns the decision instead.
      if (jwEligible) {
        try {
          return await fetchJwStrict()
        } catch (e) {
          log.debug("chart-renewal generic stream JW fallback failed, retaining last good", {
            family,
            error: e instanceof Error ? e.message : String(e),
          })
          throw e
        }
      }
      return { rows: [], status: "empty" }
    }

    // JW-only (or `auto` where FP is inapplicable): only verified own-brand
    // pairs serve; anything else is unavailable (never a silent substitution,
    // never FP rows under a justwatch-only name).
    if (!jwEligible) return { rows: [], status: "empty" }
    try {
      return await fetchJwStrict()
    } catch (e) {
      log.debug("chart-renewal generic justwatch-only fetch failed, retaining last good", {
        family,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  const animeMatch = /^anime:(movie|series)$/.exec(family)
  if (animeMatch) {    const [, animeType] = animeMatch
    const listKey = animeType === "movie" ? "mdblistAnimeMovie" : "mdblistAnime"
    // Strict: transport failure (HTTP !ok, invalid JSON, abort) THROWS and
    // becomes an error contribution (gate + last-good retention); a cached
    // error-negative can never masquerade as success. A successful [] is a
    // genuine empty for this cycle: it publishes an empty snapshot so a miss
    // stays null and never resurrects a saved anime rank. Titles/years are
    // preserved: snapshots power the catalog fallback when TMDB enrichment
    // is unavailable.
    const live = await fetchMDBList(listKey, mdblistKey ?? undefined, signal, floor, true)
    if (live.length === 0) return { rows: [], status: "empty" }
    return {
      rows: live.map((e, i) => ({
        tmdbId: e.tmdb ?? 0,
        imdbId: e.imdb || null,
        rank: i + 1,
        title: e.title || null,
        year: e.year || null,
      })),
      status: "ok",
    }
  }

  throw new Error(`chart-renewal: unsupported family ${family}`)
}

/**
 * Reusable awaited per-family refresh (serving paths + future scheduled
 * trigger). Resolves the CURRENT slot, then:
 * - pin current → return it (zero upstream fetches; same-slot snapshots are
 *   served until the next boundary even when underlying rolling caches
 *   expire — no upstream churn inside the slot);
 * - gated (<60s after a source failure) or lease held by a concurrent
 *   owner → return the old pin (retention; competitors never wait);
 * - else fetch exactly this family (bounded by existing upstream timeouts),
 *   abort the commit on slot rollover, and return the fresh pin on success.
 * All work is awaited inside the calling request lifecycle — no background
 * fetches surviving it.
 */
export async function ensureFreshChartFamily(
  input: ChartRenewalContext & { family: string },
  opts?: {
    /** Override the canonical fetch (tests + callers with extra credentials). */
    fetch?: (ctx: ChartRenewalContext & { floor: number }) => Promise<FamilyFetchResult>
  },
): Promise<ChartFamilyPin> {
  const { family } = input
  const groupInput = {
    regionCode: input.regionCode,
    regionLang: input.regionLang,
    mdblistKey: input.mdblistKey,
  }
  const startPin = await pinChartFamily({ ...groupInput, family })
  // Family cadence: JW families (charts/popular/trending, incl.
  // `stream2:justwatch:*`) refresh on 00/06/12/18 Europe/Rome; every other
  // family stays on 00/12. Old pins migrate naturally (same ids at 00/12).
  const slot = familySlotKey(family)
  // Pin current (a published snapshot of this slot): nothing to do.
  if (startPin.id !== CHART_LIVE_PIN_ID && startPin.id >= slot) return startPin
  // Failure gate active (a source failed <60s ago): fetching more now is
  // waste — publish is gated anyway. Skip; the next request resumes.
  try {
    if (await isChartFamilyGated({ ...groupInput, family })) return startPin
  } catch {
    // fail-open: refresh anyway
  }
  // Single owner per family: competitors keep serving the pinned snapshot.
  const owner = await tryAcquireChartFamilyLease({ ...groupInput, family })
  if (!owner) return startPin
  try {
    // Abort on slot rollover while acquiring: a stale slot never publishes
    // (family cadence, same slot as above).
    if (familySlotKey(family) !== slot) return pinChartFamily({ ...groupInput, family })
    const floor = familySlotFloorMs(family)
    let result: FamilyFetchResult
    try {
      const fetch = opts?.fetch ?? ((ctx) => fetchChartFamilyRows(family, ctx))
      result = await fetch({ ...input, floor })
    } catch (e) {
      log.debug("chartfam refresh fetch failed; last good snapshot kept", {
        family,
        error: e instanceof Error ? e.message : String(e),
      })
      return await commitChartFamilySnapshot({ ...groupInput, family, rows: [], status: "error", slot }, owner)
    }
    return await commitChartFamilySnapshot(
      { ...groupInput, family, rows: result.rows, status: result.status, provenance: result.provenance, slot },
      owner,
    )
  } finally {
    await releaseChartFamilyLease({ ...groupInput, family }, owner)
  }
}
