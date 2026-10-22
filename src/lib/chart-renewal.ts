import {
  CHART_LIVE_PIN_ID,
  commitChartFamilySnapshot,
  currentChartSlotFloor,
  isChartFamilyGated,
  pinChartFamily,
  releaseChartFamilyLease,
  romeSlotKey,
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
import { getTop10 } from "@/lib/flixpatrol"
import { getRegionDef } from "@/lib/regions"
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
 * Canonical platform sources (shared coordinate table: package filter for the
 * JustWatch fast-path + FlixPatrol slug for the fallback). JW ignores unknown
 * regional package codes, so the unions are safe in every region.
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
    // Strict: a transport failure (including an open circuit) throws and
    // falls through to the FlixPatrol fallback below; a successful [] falls
    // through as well — it is a real upstream answer, not an outage.
    try {
      const rows = await getJWRankings(objectType, regionCode, 10, src.jwPackages, lang, signal, floor, true)
      if (rows.length > 0) {
        return { rows: rows.slice(0, 10), status: "ok", provenance: "justwatch" }
      }
      // Empty JW side: fall through to the FlixPatrol fallback below (same
      // as the serving path); GLOBAL empties are legitimate by design.
    } catch (e) {
      log.debug("chart-renewal platform JW failed, trying FlixPatrol", {
        family,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    const flixCountry = getRegionDef(regionCode).flixSlug
    // Fixed-cycle renewal: freshOrThrow forbids laundering a pre-floor stale
    // fp-crawler body as a fresh fetch (failure retention: 60s gate, old pin
    // kept, no new generation). The catalog serving path deliberately omits
    // the flag and keeps the stale fail-open fallback on cold failure.
    const data = await getTop10(src.flixSlug, flixCountry, tmdbKey, { enrich: false, minFetchedAtMs: floor, freshOrThrow: true })
    const items = stType === "movie" ? data.movies : data.tv
    const toRows = (list: { tmdbId: number | null; title: string; rank: number }[]): JWRankEntry[] =>
      list.filter((i) => i.tmdbId).slice(0, 10).map((i) => ({ tmdbId: i.tmdbId as number, imdbId: null, rank: i.rank, title: i.title ?? null }))
    const rows = toRows(items)
    // A successful fallback read with zero rows is a genuine empty for this
    // cycle on every region (not merely GLOBAL): it publishes an empty
    // snapshot so a miss stays null. Failure (throw above, incl. the
    // freshOrThrow stale-catalog guard) keeps the last good snapshot via the
    // error path. GLOBAL empties remain legitimate by design (worldwide-only).
    if (rows.length === 0) {
      return { rows: [], status: "empty", provenance: "flixpatrol" }
    }
    return { rows, status: "ok", provenance: "flixpatrol" }
  }

  const animeMatch = /^anime:(movie|series)$/.exec(family)
  if (animeMatch) {
    const [, animeType] = animeMatch
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
  const slot = romeSlotKey()
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
    // Abort on slot rollover while acquiring: a stale slot never publishes.
    if (romeSlotKey() !== slot) return pinChartFamily({ ...groupInput, family })
    const floor = currentChartSlotFloor()
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
