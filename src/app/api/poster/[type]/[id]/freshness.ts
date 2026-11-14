// Politica di freschezza della cache poster (fase J della poster route):
// TTL effimero per i render degradati (qualità, età, Wikidata, custom base,
// prossimo episodio, pre-release indeciso) e freshness cap dai fatti volatili
// consumati (rank, offers, data digitale, upcoming). Il cap restringe soltanto
// la policy, mai la estende. Corpo spostato da route.ts invariato.

import type { CustomCatalogConfig, Mapping } from "@/lib/types"
import type { RegionDef } from "@/lib/regions"
import type { ServerDefaults } from "@/lib/server-defaults"
import { type WikidataResult, directorBadgeLabel } from "@/lib/awards"
import type { AggregatedRatings } from "@/lib/ratings"
import type { StreamQualityResult } from "@/lib/stream-quality"
import type { PosterBaseResult } from "@/lib/custom-poster-base"
import type { RankingSource } from "@/lib/ranking-source"
import { type DateFormat, parseDateFormat, getUpcomingReleaseLabel } from "@/lib/release-badge"
import { sanitizeAgeLabel } from "@/lib/certification"
import { DEMO_SAMPLE_AGE_LABEL } from "@/lib/demo-samples"
import { isNextEpisodeDisplayed } from "@/lib/poster-badge"
import { isPreReleaseDetectionUndecided, isRankFactConsumed, resolvePosterFactCapMs, capPosterTtlMs } from "@/lib/poster-freshness"
import { type ChartFamilyPin, familySlotEndMs, chartSlotEndMs } from "@/lib/chart-generation"
import { customRankingRemainingMs } from "@/lib/custom-ranking"
import { addonRankingRemainingMs } from "@/lib/addon-ranking"
import { jwTitlesRemainingMs, JW_DIGITAL_MONETIZATION_TYPES, jwRankingsRemainingMs, jwAvailabilityRemainingMs } from "@/lib/justwatch"
import { mdblistRemainingMs } from "@/lib/mdblist"
import { dynamicPosterTtlMs } from "@/lib/poster-runtime-cache"
import { msUntilPosterScheduledRefresh } from "@/lib/cache"
import { QUALITY_EPHEMERAL_TTL_SEC } from "./constants"
import type { runRankingPreflight } from "./ranking-preflight"
import type { PosterTitleMeta } from "./sources"

type RankingPreflight = Awaited<ReturnType<typeof runRankingPreflight>>

/** Input del TTL effimero: config del render ed esiti del fetch. */
export interface EphemeralPolicyContext {
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly mapping: Mapping | null
  readonly sd: ServerDefaults
  readonly hardenedParams: URLSearchParams
  readonly canonicalLang: string | null
  readonly posterRegion: RegionDef
  readonly t: (key: string, params?: Record<string, string | number>) => string
  readonly demoSamples: boolean
  readonly badgesEnabled: boolean
  readonly rankingEnabled: boolean
  readonly badgeQuality: boolean
  readonly ageBadge: boolean
  readonly preRelease: boolean
  readonly queryExtra: string | null
  readonly sashOrder: ("rank" | "extra" | "upcoming" | "new" | "award")[]
  readonly disabledContentTags: string[]
  readonly qQualityParam: string | null
  readonly liveQualityResult: StreamQualityResult
  readonly ageCert: { label: string | null; ok: boolean }
  readonly wikidataResult: WikidataResult
  readonly wikidataRaceTimedOut: boolean
  readonly effectiveCustomUrl: string | null
  readonly originalBase: PosterBaseResult | null
  readonly preDigital: string | null
  readonly preJw: boolean | null
  readonly preReleaseDetected: boolean
  readonly finalRank: number | null
  readonly animeRankResult: number | null
  readonly tmdbKeywords: string[]
  readonly imdbTop250: boolean
  readonly aggregated: AggregatedRatings | null
  readonly dynamicTtlSec: number | undefined
  readonly immutablePoster: boolean
}

export interface EphemeralPolicy {
  ageLabel: string | null
  ageEphemeral: boolean
  ephemeralTtl: boolean
  effectiveTtlSec: number | undefined
  effectiveImmutable: boolean
}

export function resolveEphemeralPolicy(ctx: EphemeralPolicyContext, titleMeta: PosterTitleMeta): EphemeralPolicy {
  const {
    mediaType, tmdbId, mapping, sd, hardenedParams, canonicalLang, posterRegion, t, demoSamples,
    badgesEnabled, rankingEnabled, badgeQuality, ageBadge, preRelease, queryExtra, sashOrder,
    disabledContentTags, qQualityParam, liveQualityResult, ageCert, wikidataResult, wikidataRaceTimedOut,
    effectiveCustomUrl, originalBase, preDigital, preJw, preReleaseDetected, finalRank, animeRankResult,
    tmdbKeywords, imdbTop250, aggregated, dynamicTtlSec, immutablePoster,
  } = ctx
  // Render degradato per timeout/errore upstream sulla qualità (solo se il
  // badge FINALE è attivo e senza override esplicito): TTL effimero 120s
  // invece di 6h/24h + niente header immutable, così Stremio riprova poco
  // dopo. Early resta solo per il gating del fetch (Block A).
  const qualityEphemeral = badgeQuality && !qQualityParam && liveQualityResult.status !== "resolved"
  // Etichetta età FINALE: solo col badge finale attivo (stessa catena del
  // gating fetch — early e finale coincidono: catena globale senza mapping)
  // E col master badge globale ON (badgesEnabled !== false, stessa
  // semantica di hasAgeBadge in poster-service: undefined = ON storico):
  // con master OFF il badge è nascosto e l'etichetta resta null (niente
  // pill, niente TTL effimero spurio). Sanificata (tetto lunghezza/charset,
  // mai testo grezzo nel badge).
  // Null = badge nascosto (disabilitato o dati assenti per il paese).
  // Demo samples (Settings preview only): a demonstration label when the
  // title resolves none, so the age badge style stays visible. Same gate
  // (master toggle + age toggle) and same sanitizer: real data first, never
  // in Stremio posters or per-title editor previews.
  const realAgeLabel = ageBadge && badgesEnabled !== false ? sanitizeAgeLabel(ageCert.label) : null
  const ageLabel = realAgeLabel
    ?? (demoSamples && ageBadge && badgesEnabled !== false ? sanitizeAgeLabel(DEMO_SAMPLE_AGE_LABEL) : null)
  // Stesso trattamento effimero della qualità per il degrado rete età
  // (fetch fallito a badge attivo): il poster senza pill resta in cache 2
  // minuti invece di 6h/24h. Miss genuino (ok, paese assente) = stabile.
  // Master OFF = stabile (badge già nascosto, nessun degrado da ritentare).
  const ageEphemeral = !!ageBadge && badgesEnabled !== false && !ageCert.ok
  // Stesso trattamento per Wikidata degradato (race persa, breaker, outage):
  // il poster senza premi resta in cache 2 minuti invece di 6h/24h, così un
  // miss transitorio (es. Emmy intermittente) guarisce al ricaricamento
  // senza togli/metti manuale del mapping. `degraded` assente (mock storici,
  // ramo ranking OFF deterministico) = non effimero.
  const wikidataEphemeral = wikidataResult.degraded === true || wikidataRaceTimedOut
  // Stesso trattamento per il fallback TMDB causato da custom fallito: il
  // poster senza base custom resta in cache 2 minuti invece di 6h/24h, così
  // un'origine tornata su guarisce al ricaricamento senza re-save manuale.
  // Solo fallback reale (custom richiesto ma base TMDB): custom riuscito o
  // nessun custom = TTL pieno invariato.
  const customFallbackEphemeral = !!effectiveCustomUrl && originalBase !== null && !originalBase.custom
  // Next-episode freshness: cap to 120s ONLY when the next-episode badge
  // is the EFFECTIVE displayed top badge (auto or canonical manual
  // identity). A merely eligible date that loses to rank/upcoming/awards,
  // a manual override, a disabled `new` sash bucket, or Coming Soon keeps
  // the existing TTL untouched. An elapsed manual identity shows nothing
  // (no stale date, no cap). Shared selection, no divergent chain.
  const ephemeralLocale = canonicalLang || mapping?.language || posterRegion.lang2
  const ephemeralDateFormat = parseDateFormat(hardenedParams.get("df") ?? sd.dateFormat ?? null) ?? "locale"
  const nextEpisodeEphemeral = isNextEpisodeDisplayed({
    mediaType,
    rankingEnabled,
    badgesEnabled,
    queryExtra,
    badgeInput: {
      mediaType,
      tmdbId,
      digitalReleaseDate: preDigital ?? null,
      releaseDate: titleMeta.releaseDate ?? null,
      firstAirDate: titleMeta.firstAirDate ?? null,
      lastAirDate: titleMeta.lastAirDate ?? null,
      seasonCount: titleMeta.seasonCount ?? null,
      nextEpisodeAirDate: titleMeta.nextEpisodeAirDate ?? null,
      numberOfEpisodes: titleMeta.numberOfEpisodes ?? null,
      originCountries: [...titleMeta.originCountries],
      genreIds: titleMeta.genreIds ? [...titleMeta.genreIds] : null,
      voteAverage: titleMeta.voteAverage ?? 0,
      trendRank: finalRank,
      animeRank: animeRankResult,
      awards: wikidataResult.awards,
      nominations: wikidataResult.nominations,
      studios: [...wikidataResult.studios],
      director: directorBadgeLabel(wikidataResult.director, t),
      tvType: titleMeta.tvType ?? null,
      tvStatus: titleMeta.tvStatus ?? null,
      keywords: [...tmdbKeywords],
      imdbTop250: !!imdbTop250,
      whatsonFeatures: aggregated?.whatsonFeatures ?? null,
      disabledContentTags: disabledContentTags ?? null,
    },
    locale: ephemeralLocale,
    sashOrder,
    dateFormat: ephemeralDateFormat,
    preRelease: !!(preRelease && preReleaseDetected),
    t,
  })
  // Stabilization: an ENABLED pre-release whose JustWatch availability is
  // still unknown (fetch error / 2500ms race lost, preJw stays null) is an
  // undecided volatile fact. Never freeze a possibly-wrong poster for the
  // flat 6h/24h policy: reuse the existing ephemeral TTL so the next render
  // can resolve the real state. Known answers (preJw true/false) keep the
  // existing fact-cap path untouched, and disabled pre-release adds nothing.
  const preReleaseUndecidedEphemeral = isPreReleaseDetectionUndecided({
    preReleaseEnabled: preRelease,
    mediaType,
    jwAvailable: preJw,
  })
  const ephemeralTtl = qualityEphemeral || wikidataEphemeral || customFallbackEphemeral || ageEphemeral || !!nextEpisodeEphemeral || preReleaseUndecidedEphemeral
  // Task D: riassegnato dal freshness cap (resolveFactCap: solo restrizione, mai estensione).
  const effectiveTtlSec: number | undefined = ephemeralTtl ? QUALITY_EPHEMERAL_TTL_SEC : dynamicTtlSec
  const effectiveImmutable = immutablePoster && !ephemeralTtl

  return { ageLabel, ageEphemeral, ephemeralTtl, effectiveTtlSec, effectiveImmutable }
}

/** Input del freshness cap: stato del ranking preflight e policy di cache. */
export interface FactCapContext {
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  readonly posterRegion: RegionDef
  readonly t: (key: string, params?: Record<string, string | number>) => string
  readonly scopedUser: string | null
  readonly effTmdbKey: string | undefined
  readonly effMdblistKey: string | undefined
  readonly effTvdbKey: string | undefined
  readonly rankingEnabled: boolean
  readonly preRelease: boolean
  readonly preDigital: string | null
  readonly preJw: boolean | null
  readonly rankingSourcePre: RankingSource
  readonly rankingCustomPre: CustomCatalogConfig | undefined
  readonly streamingRankPre: RankingPreflight["streamingRankPre"]
  readonly needTrendFetch: boolean
  readonly needAnimeFetch: boolean
  readonly trendRankLive: boolean
  readonly animeRankLive: boolean
  readonly preTrendRank: number | null
  readonly preAnimeRank: number | null
  readonly trendSnapshotPin: RankingPreflight["trendSnapshotPin"]
  readonly animeSnapshotPin: RankingPreflight["animeSnapshotPin"]
  readonly streamingSnapshotPin: RankingPreflight["streamingSnapshotPin"]
  readonly jwFamily: string
  readonly chartAnimeFamily: string
  readonly animeListKey: string
  readonly animeKeyUsed: string | undefined
  readonly addonRankingInput: RankingPreflight["addonRankingInput"]
  readonly cacheKey: string
  readonly dynamicPoster: boolean
  readonly dynamicCutTtlMs: number | null
}

/** Valori derivati dalla route tra TTL effimero e cap. */
export interface FactCapDerived {
  readonly applyPreRelease: boolean
  readonly locale: string
  readonly dateFormat: DateFormat
  readonly ephemeralTtl: boolean
}

export interface FactCap {
  /** TTL HTTP dopo il cap (invariato senza fatti consumati). */
  effectiveTtlSec: number | undefined
  factExpiresAtMs: number | null
  policyBaseMs: number | undefined
  cappedTtlMs: number | undefined
  factCappedWrite: boolean
}

export function resolveFactCap(
  ctx: FactCapContext,
  titleMeta: PosterTitleMeta,
  derived: FactCapDerived,
  ttlSec: number | undefined,
): FactCap {
  const {
    mediaType, tmdbId, posterRegion, t, scopedUser, effTmdbKey, effMdblistKey, effTvdbKey,
    rankingEnabled, preRelease, preDigital, preJw, rankingSourcePre, rankingCustomPre, streamingRankPre,
    needTrendFetch, needAnimeFetch, trendRankLive, animeRankLive, preTrendRank, preAnimeRank,
    trendSnapshotPin, animeSnapshotPin, streamingSnapshotPin, jwFamily, chartAnimeFamily, animeListKey,
    animeKeyUsed, addonRankingInput, cacheKey, dynamicPoster, dynamicCutTtlMs,
  } = ctx
  const { applyPreRelease, locale, dateFormat, ephemeralTtl } = derived
  let effectiveTtlSec = ttlSec
  // Task D — freshness cap: il poster non deve sopravvivere alla scadenza
  // reale dei fatti volatili che cuoce dentro. Solo fatti CONSUMATI:
  // ranking finale abilitato + fetch live vinto senza override da query
  // (il fallback al rank salvato è stabile, non un fatto volatile);
  // offers solo se il pre-release ha consumato il dato noto; la data
  // digitale solo se il velo dipende davvero da lei; l'upcoming solo se
  // effettivamente renderizzato. I remaining sono assoluti
  // (generation+TTL delle cache sorgente): una HIT non rinnova mai la
  // scadenza e non si fa alcun upstream extra solo per la scadenza.
  // Il cap restringe soltanto la policy (effimera/cut/jitter/scheduled):
  // il jitter deterministico non può mai estenderlo.
  const factNowMs = Date.now()
  // Snapshot-backed rank facts expire at the slot end: the published
  // snapshot is valid until the next boundary, when a refresh publishes new
  // rows. Same-slot snapshots are served even after the underlying rolling
  // source caches expire, so the cap follows the snapshot — not the source
  // caches (their remaining is only a fallback at the exact boundary).
  const snapshotSlotRemainingMs = (pin: ChartFamilyPin | null, family: string | null, nowMs: number): number | null => {
    if (!pin?.snapshot) return null
    // Family cadence: the pinned end follows the family's own slots
    // (00/06/12/18 for JW, 00/12 otherwise) — never the current window.
    const slotEnd = family ? familySlotEndMs(family, pin.snapshot.generation) : chartSlotEndMs(pin.snapshot.generation)
    if (!slotEnd) return null
    const remaining = slotEnd - nowMs
    // A pin published in a previous slot (retained on outage, or a render
    // starting just before the boundary) is already expired: yield ZERO,
    // never null — null would fall through to the rolling JW TTL and extend
    // freshness past the published list. The write path turns 0 into
    // max-age=0 + no store (see factExpiredAtWrite below).
    return remaining > 0 ? remaining : 0
  }
  let trendFactMs: number | null = null
  if (
    isRankFactConsumed({
      rankingEnabled,
      fetchNeeded: needTrendFetch,
      fetchWon: trendRankLive,
      rank: preTrendRank,
    })
  ) {
    if (rankingSourcePre.kind === "custom" && rankingCustomPre) {
      trendFactMs = customRankingRemainingMs(
        {
          custom: rankingCustomPre,
          slot: mediaType === "movie" ? "movie" : "series",
          apiKey: effTmdbKey,
          mdblistKey: effMdblistKey,
          tvdbKey: effTvdbKey,
          userId: scopedUser,
        },
        factNowMs,
      )
    } else if (rankingSourcePre.kind === "streaming") {
      // Imported Top 10 ranking source: the fact expires with its pinned
      // family slot (6h/12h cadence), never a fixed TTL.
      trendFactMs = snapshotSlotRemainingMs(
        streamingSnapshotPin,
        streamingRankPre?.family ?? null,
        factNowMs,
      )
    } else if (rankingSourcePre.kind === "addon") {
      // Imported addon ranking source: the fact expires with the effective
      // remote page freshness (10 min / 60s empty), never a blind policy.
      trendFactMs = addonRankingInput
        ? addonRankingRemainingMs(addonRankingInput, factNowMs)
        : null
    } else {
      trendFactMs = snapshotSlotRemainingMs(trendSnapshotPin, jwFamily, factNowMs) ?? (
        rankingSourcePre.kind === "justwatch" &&
        (rankingSourcePre.mode === "popular" || rankingSourcePre.mode === "trending")
          ? jwTitlesRemainingMs(
            {
              objectType: mediaType === "movie" ? "MOVIE" : "SHOW",
              country: posterRegion.code,
              first: 20,
              offset: 0,
              sortBy: rankingSourcePre.mode === "popular" ? "POPULAR" : "TRENDING",
              packages: undefined,
              genres: undefined,
              monetizationTypes: [...JW_DIGITAL_MONETIZATION_TYPES],
              language: posterRegion.lang,
              overfetch: false,
            },
            factNowMs,
          )
          : jwRankingsRemainingMs(
            mediaType === "movie" ? "MOVIE" : "SHOW",
            posterRegion.code,
            20,
            undefined,
            posterRegion.lang,
            factNowMs,
          )
      )
    }
  }
  const animeFactMs = isRankFactConsumed({
    rankingEnabled,
    fetchNeeded: needAnimeFetch,
    fetchWon: animeRankLive,
    rank: preAnimeRank,
  })
    ? (snapshotSlotRemainingMs(animeSnapshotPin, chartAnimeFamily, factNowMs) ?? mdblistRemainingMs(animeListKey, animeKeyUsed, factNowMs))
    : null
  const offersFactMs =
    preRelease && mediaType === "movie" && preJw !== null
      ? jwAvailabilityRemainingMs("MOVIE", posterRegion.code, tmdbId, factNowMs)
      : null
  const digitalDateForCap =
    applyPreRelease && mediaType === "movie" && preJw !== true ? preDigital : null
  const upcomingLabelForCap = getUpcomingReleaseLabel({
    mediaType,
    releaseDate: titleMeta.releaseDate,
    firstAirDate: titleMeta.firstAirDate,
    locale,
    dateFormat,
    t,
  })
  const upcomingDateForCap = upcomingLabelForCap
    ? (mediaType === "movie" ? titleMeta.releaseDate : titleMeta.firstAirDate)
    : null
  const factCapMs = resolvePosterFactCapMs({
    trendRankRemainingMs: trendFactMs,
    animeRankRemainingMs: animeFactMs,
    availabilityRemainingMs: offersFactMs,
    digitalReleaseDate: digitalDateForCap,
    upcomingReleaseDate: upcomingDateForCap,
    nowMs: factNowMs,
  })
  // Base di policy invariata: il cap la restringe soltanto. Senza fatti
  // consumati i rami restano byte-identici allo storico (stesso jitter per
  // i dinamici, scheduled per i mappati).
  // Task D (elapsed-render fix): factCapMs above is REMAINING at factNowMs.
  // The render below (generatePosterBuffer) takes real time, so the write
  // must recompute from the ABSOLUTE fact expiry, never reuse the stale
  // remaining — otherwise write TTL from old remaining extends fact expiry.
  const factExpiresAtMs = factCapMs !== null ? factNowMs + factCapMs : null
  // Policy base for the recompute at write time (uncapped value).
  let policyBaseMs: number | undefined
  if (ephemeralTtl) {
    policyBaseMs = QUALITY_EPHEMERAL_TTL_SEC * 1000
  } else if (dynamicCutTtlMs !== null) {
    policyBaseMs = dynamicCutTtlMs
  } else if (dynamicPoster) {
    policyBaseMs = dynamicPosterTtlMs(cacheKey)
  } else if (factCapMs !== null) {
    policyBaseMs = msUntilPosterScheduledRefresh(factNowMs)
  }
  let cappedTtlMs: number | undefined
  if (policyBaseMs !== undefined) {
    cappedTtlMs = capPosterTtlMs(policyBaseMs, factCapMs === null ? [] : [factCapMs])
  }
  // Oltre la scadenza del fatto la entry non si serve stale/SWR (byte
  // potenzialmente di un mondo cambiato): si rivalida. Solo entry con un
  // vero deadline da fatti; la policy resta SWR come prima.
  const factCappedWrite = factCapMs !== null && cappedTtlMs !== undefined
  if (cappedTtlMs !== undefined) {
    // Uncapped path preserves the historical round+max(1): fact-capped HTTP
    // uses floor at response time (see write block), never a 1s round-up
    // past the fact.
    effectiveTtlSec = factCappedWrite
      ? Math.max(0, Math.floor(cappedTtlMs / 1000))
      : Math.max(1, Math.round(cappedTtlMs / 1000))
  }

  return { effectiveTtlSec, factExpiresAtMs, policyBaseMs, cappedTtlMs, factCappedWrite }
}
