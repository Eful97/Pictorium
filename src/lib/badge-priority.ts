import { BADGE_KEY_PREFIX } from "./i18n"

export interface BadgeResult {
  type: "extra" | "rank"
  label: string
  rank?: number
  rankLabel?: string
}

type T = (key: string, params?: Record<string, string | number>) => string

const _idT: T = (k) => k

/**
 * Categorie sash (bucket) in ordine di priorità di default — IDENTICO
 * all'ex if-chain (upcoming > animeRank > trendRank > isNewMovie >
 * isNewSeries > newSeason > award > imdbTop250 > nomination > subGenre >
 * isKDrama > director > studio > extra). L'ordine interno a ogni bucket è
 * fisso e preservato; la lista è pilotabile (sottoinsieme/riordino) via
 * query `sash` o default globali — mai DSL.
 */
export const SASH_BUCKETS = ["upcoming", "rank", "new", "award", "extra"] as const

export type SashBucket = (typeof SASH_BUCKETS)[number]

/** Tetto classifica anime: la chart MDBList è intera (centinaia di titoli),
 *  il badge rank vale solo fino alla Top 20 — oltre cade al bucket
 *  successivo, come una miss da chart. Il trend è già limitato per
 *  costruzione (fetch top-20 JustWatch). */
export const ANIME_RANK_MAX = 20

export const DEFAULT_SASH_ORDER: readonly SashBucket[] = ["upcoming", "rank", "new", "award", "extra"]

function isSashBucket(v: string): v is SashBucket {
  return (SASH_BUCKETS as readonly string[]).includes(v)
}

/**
 * Lista `sash` query: token validi, dedup, ordine dato (non listati = spenti).
 * - assente (null/undefined) → null = catena continua (defaults);
 * - presente ma vuota (`?sash=`) → [] = tutto spento esplicito;
 * - solo garbage → null = mai spazzatura (fallback default).
 */
export function parseSashOrder(raw: string | null | undefined): SashBucket[] | null {
  if (raw === null || raw === undefined) return null
  if (!raw.trim()) return []
  const out: SashBucket[] = []
  for (const tok of raw.split(",")) {
    const v = tok.trim().toLowerCase()
    if (isSashBucket(v) && !out.includes(v)) out.push(v)
  }
  return out.length > 0 ? out : null
}

/** Normalizza una lista salvata (defaults.json): validi + dedup, in ordine canonico. Vuota = tutto spento (stato valido). */
export function normalizeSashOrder(raw: unknown): SashBucket[] | null {
  if (!Array.isArray(raw)) return null
  const set = new Set<SashBucket>()
  for (const v of raw) {
    if (typeof v === "string" && isSashBucket(v.toLowerCase())) set.add(v.toLowerCase() as SashBucket)
  }
  return DEFAULT_SASH_ORDER.filter((b) => set.has(b))
}

/** true se la lista equivale al default (niente emissione `sash`, niente invalidazione cache). */
export function isDefaultSashOrder(order: readonly SashBucket[] | null | undefined): boolean {
  if (!order) return true
  return order.length === DEFAULT_SASH_ORDER.length && order.every((b, i) => b === DEFAULT_SASH_ORDER[i])
}

export interface BadgeParams {
  mediaType: "movie" | "tv"
  upcomingRelease: string | null
  isNewMovie: boolean
  isNewSeries: boolean
  /** Label "Nuova stagione [S2]" già localizzata (da getNewSeasonLabel) o null. */
  newSeason?: string | null
  animeRank: number | null
  trendRank: number | null
  award: string | null
  nomination: string | null
  studio: string | null
  director: string | null
  /** Miniserie (formato permanente) — auto in coda all'extra, prima di returning. */
  miniseries?: string | null
  /** Serie in corso — auto in coda all'extra; MAI congelato nei mapping (transitorio). */
  returning?: string | null
  subGenre?: string | null
  /** Serie TV prodotta in Corea del Sud (origin country KR). */
  isKDrama?: boolean
  imdbTop250?: boolean
  extra: string | null
}

function resolveBucket(bucket: SashBucket, params: BadgeParams, t: T): BadgeResult | null {
  switch (bucket) {
    case "upcoming":
      if (params.upcomingRelease) return { type: "extra", label: params.upcomingRelease }
      return null
    case "rank":
      if (params.animeRank && params.animeRank <= ANIME_RANK_MAX) return { type: "rank", label: t("badge.anime"), rank: params.animeRank }
      // Label del rank per media type: "Film" per i film, "Serie tv" per le serie
      // (invece del periodo "Oggi"). qLabel/rankLabel possono comunque sovrascrivere.
      if (params.trendRank) return { type: "rank", label: t(params.mediaType === "movie" ? "badge.movie" : "badge.series"), rank: params.trendRank }
      return null
    case "new":
      if (params.isNewMovie) return { type: "extra", label: t("badge.newMovie") }
      if (params.isNewSeries) return { type: "extra", label: t("badge.newSeries") }
      if (params.newSeason) return { type: "extra", label: params.newSeason }
      return null
    case "award":
      if (params.award) return { type: "extra", label: params.award }
      if (params.imdbTop250) return { type: "extra", label: t("badge.absoluteCinema") }
      if (params.nomination) return { type: "extra", label: params.nomination }
      return null
    case "extra":
      if (params.subGenre) return { type: "extra", label: params.subGenre }
      if (params.isKDrama) return { type: "extra", label: "K-Drama" }
      if (params.director) return { type: "extra", label: params.director }
      if (params.studio) return { type: "extra", label: params.studio }
      if (params.miniseries) return { type: "extra", label: params.miniseries }
      if (params.returning) return { type: "extra", label: params.returning }
      if (params.extra) return { type: "extra", label: params.extra }
      return null
  }
}

export function computeBadge(params: BadgeParams, _t?: T, order?: readonly SashBucket[] | null): BadgeResult | null {
  const t = _t || _idT
  for (const bucket of order ?? DEFAULT_SASH_ORDER) {
    const hit = resolveBucket(bucket, params, t)
    if (hit) return hit
  }
  return null
}

/**
 * Compute the Absolute Cinema badge from IMDb Top 250 membership.
 * Previously used voteAverage >= 8.3; now relies on IMDb Top 250.
 */
export function computeAbsoluteCinema(params: {
  mediaType: "movie" | "tv"
  imdbTop250: boolean
}, _t?: T): string | null {
  const t = _t || _idT
  if (params.mediaType === "movie" && params.imdbTop250) return t("badge.absoluteCinema")
  return null
}

function keyed(key: string): string {
  return `${BADGE_KEY_PREFIX}${key}`
}

export function getAllBadgeOptions(params: {
  upcomingRelease: string | null
  isNewMovie: boolean
  isNewSeries: boolean
  newSeason?: string | null
  animeRank: number | null
  trendRank: number | null
  award: string | null
  nomination: string | null
  studio: string | null
  director: string | null
  subGenre?: string | null
  isKDrama?: boolean
  imdbTop250?: boolean
  extra: string | null
  mediaType: "movie" | "tv"
  voteAverage: number
  tvType: string | null | undefined
  tvStatus: string | null | undefined
}): string[] {
  const options = new Set<string>()
  if (params.upcomingRelease) options.add(params.upcomingRelease)
  if (params.isNewMovie) options.add(keyed("badge.newMovie"))
  if (params.isNewSeries) options.add(keyed("badge.newSeries"))
  if (params.newSeason) options.add(keyed("badge.newSeason"))
  if (params.trendRank) options.add(keyed(params.mediaType === "movie" ? "badge.movie" : "badge.series"))
  if (params.animeRank && params.animeRank <= ANIME_RANK_MAX) options.add(keyed("badge.anime"))
  if (params.award) options.add(params.award)
  if (params.mediaType === "movie" && params.imdbTop250) options.add(keyed("badge.absoluteCinema"))
  if (params.nomination) options.add(params.nomination)
  if (params.subGenre) options.add(params.subGenre)
  if (params.isKDrama) options.add("K-Drama")
  if (params.director) options.add(params.director)
  if (params.studio) options.add(params.studio)
  if (params.mediaType === "tv") {
    const tLower = (params.tvType || "").toLowerCase()
    const sLower = (params.tvStatus || "").toLowerCase()
    if (tLower === "miniseries" || tLower === "miniserie") options.add(keyed("badge.miniseries"))
    if (sLower === "returning series" || sLower === "in corso") options.add(keyed("badge.returning"))
  }
  options.delete("")
  return [...options]
}
