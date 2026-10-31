/**
 * Voto medio a media pari (unico comportamento: i preset pesati sono stati
 * rimossi, resta il legacy).
 *
 * Modulo quasi-puro e FOGLIA CLIENT-SAFE: zero import runtime (solo
 * `import type`, cancellati in compilazione). Definisce DEFAULT_RATING_SOURCES
 * qui invece che in `ratings.ts` perché `ratings.ts` importa la cache/KV
 * (ioredis): se questa foglia importasse `ratings.ts` a runtime, il bundle
 * browser includerebbe ioredis e la build Turbopack fallirebbe con
 * "Can't resolve 'net'/'tls'/'dns'". `ratings.ts` re-esporta costante e parser
 * per compatibilità (i test di route usano importOriginal). `computeVote` è
 * l'unico choke point usato da poster route, details route e client (stesso
 * numero ovunque = Golden Rule).
 *
 * `SUPPORTED_RATING_SOURCES` + `parseRatingSources`/`resolveRatingSources`
 * vivono qui (e non in `ratings.ts`) per lo stesso motivo: `poster-config`
 * (importato dai settings `"use client"`) risolve `rsrc` a runtime, e un
 * import runtime da `ratings.ts` trascinerebbe `node:crypto`/cache/KV nel
 * bundle browser. `ratings.ts` li ri-esporta (route e hardening invariati).
 *
 * NOTA sui voti-per-fonte: la nuova media API riporta conteggi voti per
 * fonte (`votes`, intero o null) — il filtro `PICTORIUM_RATING_MIN_VOTES`
 * (default 10, 0 = disabilitato, definito in `ratings.ts`) scarta solo le
 * fonti con conteggio noto intero non-negativo sotto soglia; conteggi
 * null/mancanti/malformati (negativi, frazioni, NaN, Infinity, non numerici)
 * restano (mai conteggi inventati), RogerEbert è esente. Sulle normalizzazioni
 * vale il contratto score 0-100 (sempre /10); a score null/mancante la fonte
 * è indisponibile tranne il fallback nativo 0-4 documentato di RogerEbert
 * (mai euristiche toTen generiche). Una fonte senza score normalizzabile
 * contribuisce zero (renormalizzazione), mai trascinamento verso il basso.
 */

import type { AggregatedRatings } from "./ratings"

export const SUPPORTED_RATING_SOURCES = [
  "imdb",
  "tmdb",
  "mdblist",
  "tomatoes",
  "popcorntime",
  "letterboxd",
  "metacritic",
  "metacriticuser",
  "trakt",
  "simkl",
  "filmweb",
  "filmwebcritics",
  "rogerebert",
  "mal",
  "anilist",
  "kitsu",
  "tvmaze",
] as const

export type RatingSource = (typeof SUPPORTED_RATING_SOURCES)[number]

/** Fonti default del voto medio (imdb/tmdb). Definita qui (foglia client-safe), re-esportata da ratings.ts. */
export const DEFAULT_RATING_SOURCES: RatingSource[] = ["imdb", "tmdb"]

/**
 * Parsing unico del parametro `rsrc` (Fix D): split "," → trim → lowercase →
 * whitelist SUPPORTED_RATING_SOURCES. Ritorna null se il parametro è assente
 * (il chiamante applica la catena dei fallback), [] se presente ma senza
 * fonti valide. Unica implementazione usata da poster route, poster-config e
 * tmdb details route (stesso numero ovunque = Golden Rule).
 */
export function parseRatingSources(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null
  const valid = SUPPORTED_RATING_SOURCES as readonly string[]
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => valid.includes(s))
}

/**
 * Catena canonica delle fonti voto: query `rsrc` > fallbacks (mapping >
 * config token > server defaults) > DEFAULT_RATING_SOURCES. Un array vuoto
 * (nessuna fonte / solo garbage) vale come unset e fa cadere al fallback
 * successivo — mai media su zero fonti.
 */
export function resolveRatingSources(
  query: string | null | undefined,
  ...fallbacks: (readonly string[] | null | undefined)[]
): string[] {
  const parsed = parseRatingSources(query)
  if (parsed && parsed.length > 0) return parsed
  for (const fb of fallbacks) {
    if (fb && fb.length > 0) return fb.map((s) => s.toLowerCase())
  }
  return [...DEFAULT_RATING_SOURCES]
}

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
  { id: "tvmaze", labelKey: "ui.source_tvmaze", emoji: "🦉" },
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
