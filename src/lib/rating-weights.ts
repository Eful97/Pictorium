/**
 * Voto medio a media pari (unico comportamento: i preset pesati sono stati
 * rimossi, resta il legacy).
 *
 * Modulo quasi-puro e FOGLIA CLIENT-SAFE: zero import runtime (solo
 * `import type`, cancellati in compilazione). Definisce DEFAULT_RATING_SOURCES
 * qui invece che in `ratings.ts` perché `ratings.ts` importa la cache/KV
 * (ioredis): se questa foglia importasse `ratings.ts` a runtime, il bundle
 * browser includerebbe ioredis e la build Turbopack fallirebbe con
 * "Can't resolve 'net'/'tls'/'dns'". `ratings.ts` re-esporta la costante per
 * compatibilità (i test di route usano importOriginal). `computeVote` è
 * l'unico choke point usato da poster route, details route e client (stesso
 * numero ovunque = Golden Rule).
 *
 * NOTA sui voti-per-fonte: il payload MDBList NON riporta conteggi voti per
 * fonte (verificato live: ogni rating ha solo source/value/score) — quindi
 * niente filtro RATING_MIN_VOTES. Una fonte senza score contribuisce zero
 * (renormalizzazione), mai trascinamento verso il basso.
 */

import type { AggregatedRatings, RatingSource } from "./ratings"

/** Fonti default del voto medio (imdb/tmdb). Definita qui (foglia client-safe), re-esportata da ratings.ts. */
export const DEFAULT_RATING_SOURCES: RatingSource[] = ["imdb", "tmdb"]

/** Metadati UI delle fonti voto (id + label i18n + emoji). Pura, definita qui per gli editor client. */
export const UI_RATING_SOURCES: { id: RatingSource; labelKey: string; emoji: string }[] = [
  { id: "imdb", labelKey: "ui.source_imdb", emoji: "⭐" },
  { id: "tmdb", labelKey: "ui.source_tmdb", emoji: "🌐" },
  { id: "mdblist", labelKey: "ui.source_mdblist", emoji: "📊" },
  { id: "tomatoes", labelKey: "ui.source_tomatoes", emoji: "🍅" },
  { id: "popcorntime", labelKey: "ui.source_popcorntime", emoji: "🍿" },
  { id: "letterboxd", labelKey: "ui.source_letterboxd", emoji: "👁️" },
  { id: "metacritic", labelKey: "ui.source_metacritic", emoji: "🎯" },
  { id: "metacriticuser", labelKey: "ui.source_metacriticuser", emoji: "👥" },
  { id: "trakt", labelKey: "ui.source_trakt", emoji: "📺" },
  { id: "simkl", labelKey: "ui.source_simkl", emoji: "⚡" },
  { id: "filmweb", labelKey: "ui.source_filmweb", emoji: "🎥" },
  { id: "filmwebcritics", labelKey: "ui.source_filmwebcritics", emoji: "🖋️" },
  { id: "rogerebert", labelKey: "ui.source_rogerebert", emoji: "🎖️" },
  { id: "mal", labelKey: "ui.source_mal", emoji: "🌸" },
  { id: "anilist", labelKey: "ui.source_anilist", emoji: "💫" },
  { id: "kitsu", labelKey: "ui.source_kitsu", emoji: "🦊" },
]

/** Media pari sulle fonti richieste (default imdb/tmdb). */
function equalAverage(ratings: AggregatedRatings | null, sources: readonly string[]): number | null {
  if (!ratings || !ratings.sources) return null
  const values: number[] = []
  for (const rawSrc of sources) {
    const v = ratings.sources[rawSrc.toLowerCase()]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) values.push(v)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Voto unico a media pari sulle fonti richieste (`rsrc` o default imdb/tmdb).
 */
export function computeVote(
  ratings: AggregatedRatings | null,
  rsrc?: readonly string[] | null,
): number | null {
  const allowlist = rsrc && rsrc.length > 0 ? rsrc.map((s) => s.toLowerCase()) : null
  return equalAverage(ratings, allowlist ?? [...DEFAULT_RATING_SOURCES])
}
