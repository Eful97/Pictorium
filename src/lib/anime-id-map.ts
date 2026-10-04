import snapshotData from "@/generated/anime-id-map.json"

// Mappatura locale anime ↔ TMDB (snapshot versionato di Fribb/anime-lists,
// generato con `scripts/build-anime-id-map.mjs` — mai editare a mano).
//
// SERVER-ONLY: lo snapshot (~680KB) non deve finire nei bundle browser.
// Importato solo da `addon-proxy.ts` (proxy route) e `anime-ratings.ts`
// (poster route), entrambi server-side. Mai importare da componenti client.
//
// Semantica lookup (indipendente dallo storage: vedi createAnimeIdMapResolver):
// - forward (anime ns+id + lato TMDB -> artwork): `resolved` solo se UNICO,
//   `ambiguous` su conflitti (mai first-pick), `missing` se assente,
//   `unavailable` se lo snapshot non è valido/caricato.
// - reverse (TMDB/IMDb -> entries): restituisce TUTTI i match (più stagioni
//   anime sullo stesso show TMDB restano visibili al chiamante, che decide la
//   policy di unicità — i rating usano il mapping solo se non ambiguo).

export type AnimeNamespace = "anilist" | "kitsu" | "mal" | "anidb"
export type AnimeTmdbSide = "movie" | "tv"
export type AnimeMapStatus = "resolved" | "missing" | "ambiguous" | "unavailable"

export interface AnimeMapRecord {
  /** AniList id (se noto). */
  a?: number
  /** Kitsu id (se noto). */
  k?: number
  /** MAL id (se noto). */
  m?: number
  /** AniDB id (se noto). */
  d?: number
  /** Target artwork TMDB. */
  t: number
  /** Lato TMDB del target ("movie" | "tv": gli id sono condivisi tra i due). */
  y: AnimeTmdbSide
  /** Stagione TMDB quando nota — solo informativa, NON stabilisce l'ordinamento episodi. */
  s?: number
  /** IMDb ids validati (["tt..."]). */
  i?: string[]
}

export interface AnimeArtworkResolution {
  status: AnimeMapStatus
  tmdbId?: number
  tmdbSide?: AnimeTmdbSide
}

export interface AnimeMapInfo {
  available: boolean
  schemaVersion: number | null
  sourceRevision: string | null
  generatedAt: string | null
  recordCount: number
}

const NAMESPACES: readonly AnimeNamespace[] = ["anilist", "kitsu", "mal", "anidb"]

function namespaceField(ns: AnimeNamespace): "a" | "k" | "m" | "d" {
  return ns === "anilist" ? "a" : ns === "kitsu" ? "k" : ns === "mal" ? "m" : "d"
}

export function parseAnimeNamespace(value: string | null | undefined): AnimeNamespace | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  return (NAMESPACES as readonly string[]).includes(v) ? (v as AnimeNamespace) : null
}

function toPositiveInt(v: unknown): number | null {
  // Interi positivi sicuri soltanto: niente parseInt parziale ("164junk" →
  // 164), niente troncamenti di frazionari (3.5 → 3), niente unsafe oltre
  // Number.MAX_SAFE_INTEGER. Stringhe solo se interamente numeriche.
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v > 0 ? v : null
  }
  if (typeof v === "string") {
    const t = v.trim()
    if (!/^\d+$/.test(t)) return null
    const n = Number(t)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  return null
}

function normalizeImdb(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return /^tt\d+$/i.test(t) ? t.toLowerCase() : null
}

function isValidRecord(r: unknown): r is AnimeMapRecord {
  if (!r || typeof r !== "object") return false
  const rec = r as Record<string, unknown>
  return toPositiveInt(rec.t) !== null && (rec.y === "movie" || rec.y === "tv")
}

export interface AnimeIdMapResolver {
  resolveArtwork(namespace: string | null | undefined, id: unknown, side: string | null | undefined): AnimeArtworkResolution
  findByTmdb(tmdbId: unknown, side?: string | null): AnimeMapRecord[]
  findByImdb(imdbId: unknown, side?: string | null): AnimeMapRecord[]
  info(): AnimeMapInfo
}

/**
 * Costruisce un resolver con indici in-memory su un set di record.
 * Lookup O(1), nessuna scansione per-item, nessuna rete.
 */
export function createAnimeIdMapResolver(
  input: unknown,
  meta?: { schemaVersion?: unknown; sourceRevision?: unknown; generatedAt?: unknown },
): AnimeIdMapResolver {
  const source: unknown[] = Array.isArray(input) ? input : []
  const records: AnimeMapRecord[] = []
  const forward = new Map<string, number[]>()
  const byTmdb = new Map<string, number[]>()
  const byImdb = new Map<string, number[]>()

  source.forEach((raw) => {
    if (!isValidRecord(raw)) return
    const idx = records.length
    records.push(raw)
    const sides: AnimeTmdbSide[] = [raw.y]
    for (const side of sides) {
      const tmdbKey = `${side}:${raw.t}`
      const tmdbList = byTmdb.get(tmdbKey)
      if (tmdbList) tmdbList.push(idx)
      else byTmdb.set(tmdbKey, [idx])
    }
    for (const ns of NAMESPACES) {
      const vid = raw[namespaceField(ns)]
      // Snapshot trattato come untrusted: solo interi sicuri indicizzati
      // (niente frazionari/unsafe/stringhe parziali dal dataset).
      if (typeof vid === "number" && Number.isSafeInteger(vid) && vid > 0) {
        for (const side of sides) {
          const key = `${ns}:${vid}:${side}`
          const list = forward.get(key)
          if (list) list.push(idx)
          else forward.set(key, [idx])
        }
      }
    }
    if (Array.isArray(raw.i)) {
      for (const imdb of raw.i) {
        const norm = normalizeImdb(imdb)
        if (!norm) continue
        const list = byImdb.get(norm)
        if (list) list.push(idx)
        else byImdb.set(norm, [idx])
      }
    }
  })

  const available = records.length > 0
  const schemaVersion = typeof meta?.schemaVersion === "number" ? meta.schemaVersion : null
  const sourceRevision = typeof meta?.sourceRevision === "string" ? meta.sourceRevision : null
  const generatedAt = typeof meta?.generatedAt === "string" ? meta.generatedAt : null

  return {
    resolveArtwork(namespace, id, side): AnimeArtworkResolution {
      if (!available) return { status: "unavailable" }
      const ns = parseAnimeNamespace(namespace)
      const vid = toPositiveInt(id)
      if (!ns || vid === null || (side !== "movie" && side !== "tv")) return { status: "missing" }
      const list = forward.get(`${ns}:${vid}:${side}`)
      if (!list || list.length === 0) return { status: "missing" }
      const targets = new Set(list.map((idx) => records[idx].t))
      if (targets.size > 1) return { status: "ambiguous" }
      return { status: "resolved", tmdbId: records[list[0]].t, tmdbSide: side }
    },

    findByTmdb(tmdbId, side): AnimeMapRecord[] {
      if (!available) return []
      const tid = toPositiveInt(tmdbId)
      if (tid === null) return []
      if (side === "movie" || side === "tv") {
        return (byTmdb.get(`${side}:${tid}`) ?? []).map((idx) => records[idx])
      }
      return [...(byTmdb.get(`movie:${tid}`) ?? []), ...(byTmdb.get(`tv:${tid}`) ?? [])].map((idx) => records[idx])
    },

    findByImdb(imdbId, side): AnimeMapRecord[] {
      if (!available) return []
      const norm = normalizeImdb(imdbId)
      if (!norm) return []
      const matches = (byImdb.get(norm) ?? []).map((idx) => records[idx])
      // Filtro lato come findByTmdb: un imdb identifica un titolo specifico,
      // mai prestato all'altro lato (TMDB riusa gli id numerici tra movie/tv).
      if (side === "movie" || side === "tv") return matches.filter((r) => r.y === side)
      return matches
    },

    info(): AnimeMapInfo {
      return { available, schemaVersion, sourceRevision, generatedAt, recordCount: records.length }
    },
  }
}

function snapshotRecords(): { records: unknown; meta: { schemaVersion?: unknown; sourceRevision?: unknown; generatedAt?: unknown } } {
  try {
    const data = snapshotData as { meta?: Record<string, unknown>; records?: unknown }
    return { records: data.records, meta: data.meta ?? {} }
  } catch {
    return { records: [], meta: {} }
  }
}

const snapshot = snapshotRecords()
const defaultResolver = createAnimeIdMapResolver(snapshot.records, snapshot.meta)

/** Anime ns+id + lato TMDB -> target artwork (unico) — vedi resolveArtwork. */
export function resolveAnimeArtwork(
  namespace: string | null | undefined,
  id: unknown,
  side: string | null | undefined,
): AnimeArtworkResolution {
  return defaultResolver.resolveArtwork(namespace, id, side)
}

/** TMDB -> tutte le entries anime corrispondenti (tutti i match preservati). */
export function findAnimeByTmdb(tmdbId: unknown, side?: string | null): AnimeMapRecord[] {
  return defaultResolver.findByTmdb(tmdbId, side)
}

/** IMDb -> tutte le entries anime corrispondenti (tutti i match preservati). */
export function findAnimeByImdb(imdbId: unknown, side?: string | null): AnimeMapRecord[] {
  return defaultResolver.findByImdb(imdbId, side)
}

/** Disponibilità/versione/conter snapshot per diagnostica. */
export function animeMapInfo(): AnimeMapInfo {
  return defaultResolver.info()
}
