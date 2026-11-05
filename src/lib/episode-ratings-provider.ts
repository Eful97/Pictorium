/**
 * Episode ratings provider registry (the ★ of a TV episode thumbnail).
 *
 * The default is ShowGrid's per-episode IMDb poll, followed by the TMDB episode
 * vote as the fail-open fallback. This is an explicit product decision by the
 * operator, who accepted the third-party risk: ShowGrid has no licence and the
 * provider permission is still pending. No environment variable is required.
 *
 * Cinemeta is NO LONGER consulted on the episode path. Title ratings keep using
 * `lib/cinemeta.ts` untouched; only this episode-facing registry changed. Legacy
 * `cinemeta`/`imdb`/`imdb-cinemeta` values are accepted as aliases of the
 * default ShowGrid source so an existing deployment keeps working.
 *
 * Alternative providers are opt-in and fail closed:
 *
 * - `seriesgraph` requires the SeriesGraph operator's WRITTEN consent plus
 *   `PICTORIUM_NON_COMMERCIAL_ACK=1` and `PICTORIUM_SERIESGRAPH_URL`;
 * - `dataset` requires a licensed IMDb dataset (IMDb datasets are personal-use
 *   only, never redistributed) plus `PICTORIUM_NON_COMMERCIAL_ACK=1` and
 *   `PICTORIUM_IMDB_DATASET_URL`.
 *
 * When an opt-in provider is selected without its acknowledgement/URL the
 * resolver logs a warning and falls back to ShowGrid — a misconfiguration can
 * never become a silent terms-of-service bypass. SeriesGraph/dataset are still
 * intentionally shipped as fail-closed stubs (see the TODOs). This module only
 * owns selection, provenance and the provider contract.
 *
 * The env is read per call (never at module level) so tests, request handling
 * and future config reloads all observe the same resolver.
 */

import { fetchShowgridEpisodeRatings } from "@/lib/showgrid-episode-ratings"
import { createLogger } from "@/lib/logger"

const log = createLogger("episode-ratings")

/** Canonical provider ids. `showgrid` is the default episode source. */
export const EPISODE_RATINGS_PROVIDERS = ["tmdb", "seriesgraph", "dataset", "showgrid"] as const
export type EpisodeRatingsProviderId = (typeof EPISODE_RATINGS_PROVIDERS)[number]

/** Everything a provider needs to resolve ONE episode rating. */
export interface EpisodeRatingQuery {
  readonly seriesId: number
  /** Series IMDb id when the caller could resolve one (may be null/invalid). */
  readonly imdbId: string | null
  readonly season: number
  readonly episode: number
  /** Caller abort signal (already carries the route's overall timeout). */
  readonly signal?: AbortSignal
}

/**
 * A per-episode rating source. `fetch` resolves a 0-10 value or `null` on any
 * miss; the route owns the TMDB fallback leg, so a provider never has to throw
 * and never fabricates a value.
 */
export interface EpisodeRatingsProvider {
  readonly id: EpisodeRatingsProviderId
  fetch(query: EpisodeRatingQuery): Promise<number | null>
}

/**
 * The effective provider plus why it was chosen. `requested` keeps the raw
 * configured value so logs/diagnostics can explain a fallback.
 */
export interface EpisodeRatingsProviderSelection {
  readonly provider: EpisodeRatingsProviderId
  readonly requested: string
  readonly usedFallback: boolean
  readonly reason: string | null
}

/** Provenance of the ★ value, echoed in `X-Pictorium-Vote-Source`. */
export type EpisodeVoteProvenance = "imdb" | "tmdb" | "imdb-fallback"

const DEFAULT_PROVIDER = "showgrid"
/**
 * Legacy values that used to select Cinemeta on the episode path. Cinemeta is
 * gone here, so they resolve to the default ShowGrid IMDb poll (never a
 * fallback to the removed source).
 */
const CINEMETA_ALIASES = new Set(["cinemeta", "imdb", "imdb-cinemeta"])

type EnvLike = Record<string, string | undefined>

function readEnv(env: EnvLike, name: string): string {
  const raw = env[name]
  return typeof raw === "string" ? raw.trim() : ""
}

/** Absolute http(s) URL only: a path or a free-form string fails closed. */
function isAcceptableProviderUrl(raw: string): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isAckEnabled(env: EnvLike): boolean {
  return readEnv(env, "PICTORIUM_NON_COMMERCIAL_ACK") === "1"
}

const warnedKeys = new Set<string>()

function warnOnce(key: string, message: string, data?: Record<string, unknown>): void {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  log.warn(message, data)
}

/** Reset the warn-once state (tests only). */
export function __resetEpisodeRatingsProviderWarnings(): void {
  warnedKeys.clear()
}

/**
 * Resolve the configured provider for this process/request.
 *
 * No configuration selects ShowGrid (the default, user-accepted third-party
 * risk). Unknown values and opt-in providers missing their
 * acknowledgement/URL fall back to ShowGrid with `usedFallback: true` (and a
 * warning log). `tmdb`/`off` select the route-owned TMDB leg explicitly and are
 * not a fallback. Legacy Cinemeta aliases resolve to ShowGrid because Cinemeta
 * is no longer part of the episode path.
 */
export function resolveEpisodeRatingsProvider(
  env: EnvLike = process.env,
): EpisodeRatingsProviderSelection {
  const configured = readEnv(env, "PICTORIUM_EPISODE_RATINGS_PROVIDER").toLowerCase()

  if (!configured) {
    return { provider: DEFAULT_PROVIDER, requested: DEFAULT_PROVIDER, usedFallback: false, reason: null }
  }

  if (configured === "showgrid") {
    // ShowGrid needs no key and no URL: its public origin is the built-in
    // default and `PICTORIUM_SHOWGRID_URL` is only an optional override.
    return { provider: "showgrid", requested: configured, usedFallback: false, reason: null }
  }

  if (CINEMETA_ALIASES.has(configured)) {
    // Cinemeta was removed from the episode path; keep old deployments working
    // by resolving their value to the default ShowGrid source.
    return { provider: "showgrid", requested: configured, usedFallback: false, reason: null }
  }

  if (configured === "tmdb" || configured === "off") {
    // `off` means "no external episode provider": the route skips the provider
    // leg and resolves the TMDB episode vote exactly as `tmdb` does.
    return { provider: "tmdb", requested: configured, usedFallback: false, reason: null }
  }

  if (configured === "seriesgraph" || configured === "dataset") {
    const urlVar = configured === "seriesgraph"
      ? "PICTORIUM_SERIESGRAPH_URL"
      : "PICTORIUM_IMDB_DATASET_URL"
    if (!isAckEnabled(env)) {
      warnOnce(
        `fallback:${configured}:ack`,
        `Episode ratings provider "${configured}" requires PICTORIUM_NON_COMMERCIAL_ACK=1 and an explicit non-commercial permission; using ShowGrid instead`,
        { provider: configured },
      )
      return { provider: DEFAULT_PROVIDER, requested: configured, usedFallback: true, reason: "missing-ack" }
    }
    if (!isAcceptableProviderUrl(readEnv(env, urlVar))) {
      warnOnce(
        `fallback:${configured}:url`,
        `Episode ratings provider "${configured}" requires ${urlVar} (an absolute http(s) URL); using ShowGrid instead`,
        { provider: configured },
      )
      return { provider: DEFAULT_PROVIDER, requested: configured, usedFallback: true, reason: "missing-url" }
    }
    return { provider: configured, requested: configured, usedFallback: false, reason: null }
  }

  warnOnce(
    `fallback:${configured}:unknown`,
    `Unknown PICTORIUM_EPISODE_RATINGS_PROVIDER value "${configured}"; using ShowGrid instead`,
    { provider: configured },
  )
  return { provider: DEFAULT_PROVIDER, requested: configured, usedFallback: true, reason: "unknown-provider" }
}

/**
 * Marker for the route-owned TMDB episode leg. The route resolves it with the
 * request language and key; the registry must never issue a second fetch.
 */
const tmdbProvider: EpisodeRatingsProvider = {
  id: "tmdb",
  async fetch() {
    return null
  },
}

/**
 * TODO(seriesgraph): implement the fetch only after the SeriesGraph operator
 * grants written permission (and `PICTORIUM_NON_COMMERCIAL_ACK=1` records it).
 * Until then the provider fails closed: an enabled-but-unimplemented source
 * must never fabricate or mislabel a rating.
 */
const seriesgraphProvider: EpisodeRatingsProvider = {
  id: "seriesgraph",
  async fetch() {
    warnOnce(
      "unimplemented:seriesgraph",
      "SeriesGraph provider is not implemented; falling back to the TMDB episode vote",
      { provider: "seriesgraph" },
    )
    return null
  },
}

/**
 * TODO(dataset): import a licensed IMDb episode dataset only for the operator
 * who acknowledged the personal-use terms. IMDb datasets are never
 * redistributed by Pictorium; the default episode source is ShowGrid.
 */
const datasetProvider: EpisodeRatingsProvider = {
  id: "dataset",
  async fetch() {
    warnOnce(
      "unimplemented:dataset",
      "IMDb dataset provider is not implemented; falling back to the TMDB episode vote",
      { provider: "dataset" },
    )
    return null
  },
}

/**
 * ShowGrid per-episode IMDb poll. Fail-open: an invalid id, transport error,
 * empty payload or missing/zero entry resolves to `null`, so the route's TMDB
 * leg still serves the ★. This is the default episode source (the operator
 * explicitly accepted the third-party risk: no licence, permission pending).
 */
const showgridProvider: EpisodeRatingsProvider = {
  id: "showgrid",
  async fetch(query) {
    const ratings = await fetchShowgridEpisodeRatings(query.imdbId, query.signal)
    const entry = ratings.get(`${query.season}:${query.episode}`)
    if (!entry) return null
    if (!Number.isFinite(entry.rating) || entry.rating <= 0) return null
    return entry.rating
  },
}

const REGISTRY: Record<EpisodeRatingsProviderId, EpisodeRatingsProvider> = {
  seriesgraph: seriesgraphProvider,
  dataset: datasetProvider,
  showgrid: showgridProvider,
  tmdb: tmdbProvider,
}

export function getEpisodeRatingsProvider(id: EpisodeRatingsProviderId): EpisodeRatingsProvider {
  return REGISTRY[id]
}

/**
 * Header value for the ★ actually drawn.
 *
 * `imdb-fallback` is only for an acknowledged/opt-in provider that was NOT
 * usable and therefore resolved through the default ShowGrid IMDb poll: the
 * pixels come from an IMDb poll, but the response honestly discloses the
 * configured provider did not run. A genuine ShowGrid hit (and a legacy
 * Cinemeta alias, now served by ShowGrid) stays `imdb`; any TMDB leg values
 * are `tmdb`.
 */
export function resolveEpisodeVoteProvenance(
  selection: EpisodeRatingsProviderSelection,
  effectiveSource: "imdb" | "tmdb",
): EpisodeVoteProvenance {
  if (effectiveSource === "tmdb") return "tmdb"
  return selection.usedFallback ? "imdb-fallback" : "imdb"
}
