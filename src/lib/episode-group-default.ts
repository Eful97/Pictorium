import { getTVEpisodeGroups, type TMDBEpisodeGroupDetails, type TMDBEpisodeGroupItem } from "@/lib/tmdb"

/**
 * Default automatico "Parts" per i meta videos delle serie.
 *
 * Contesto: TMDB espone di default le stagioni standard (es. Casa di Carta:
 * 3 stagioni 15/16/10), ma per alcuni titoli esiste un Episode Group "Parts
 * originali" che è quello che gli spettatori conoscono (5 parti 9+6+8+8+10,
 * come mostra SeriesGraph nella vista griglia). Quando nessun mapping salvato
 * sceglie esplicitamente un ordinamento, questo modulo prova a rilevare quel
 * gruppo e usarlo come default — con fallback sicuro allo standard.
 *
 * Regole di sicurezza (tutte devono valere, altrimenti null = standard):
 * 1. Il gruppo deve suddividere in più parti E in un numero di gruppi diverso
 *    dalle stagioni standard (se coincide non aggiunge nulla).
 * 2. Il totale episodi del gruppo deve coincidere con quello standard: un
 *    re-cut con totale diverso (es. versione Netflix 48ep vs originale 41ep)
 *    cambia gli episodi veri, non solo il raggruppamento → scartato.
 * 3. Nome/descrizione riconoscibile come "Parti" (original/part*), mai
 *    varianti editoriali (edited, re-cut, director's, alternate, ...).
 * 4. "standard" salvato esplicitamente disattiva sempre l'automatico (vedi
 *    chiamanti); ogni errore di rete/parsing degrada a null.
 */

const EXCLUDE_RE = /edit|re-?cut|director'?s|deleted|alternat|chronolog|dvd|broadcast|air.?date|absolut|special|trailer|extra/i
const ORIGINAL_RE = /original/i
const PART_RE = /part/i

export function pickDefaultEpisodeGroupId(
  groups: TMDBEpisodeGroupItem[] | undefined | null,
  standardSeasonCount: number,
  standardEpisodeCount: number,
): string | null {
  if (!groups || groups.length === 0) return null
  if (!(standardSeasonCount > 0) || !(standardEpisodeCount > 0)) return null
  let best: { id: string; score: number } | null = null
  for (const g of groups) {
    if (!g?.id) continue
    const gc = g.group_count ?? 0
    const ec = g.episode_count ?? 0
    if (gc <= 1 || ec <= 0) continue
    // Stesso numero di gruppi delle stagioni = nessun valore aggiunto
    if (gc === standardSeasonCount) continue
    // Totale diverso = re-cut editoriale, non puro ri-raggruppamento
    if (ec !== standardEpisodeCount) continue
    const text = `${g.name ?? ""} ${g.description ?? ""}`
    // Le esclusioni editoriali si valutano sul NOME (scelta intenzionale):
    // le descrizioni spesso citano le versioni edited solo per distinguerle
    // (es. Original Parts: "does not include the edited episodes...").
    if (EXCLUDE_RE.test(g.name ?? "")) continue
    let score = 0
    if (ORIGINAL_RE.test(text)) score += 3
    if (PART_RE.test(text)) score += 2
    if (score === 0) continue
    if (!best || score > best.score) best = { id: g.id, score }
  }
  return best?.id ?? null
}

/** Totale episodi nei dettagli di un gruppo (guardia pre-uso). */
export function groupDetailsEpisodeCount(details: TMDBEpisodeGroupDetails | null | undefined): number {
  if (!details?.groups) return 0
  return details.groups.reduce((n, g) => n + (g.episodes?.length ?? 0), 0)
}

const GROUP_LIST_CACHE = new Map<number, { value: TMDBEpisodeGroupItem[]; expiry: number }>()
const GROUP_LIST_TTL_MS = 6 * 60 * 60 * 1000
const GROUP_LIST_MAX = 500

function groupListCacheGet(tvId: number): TMDBEpisodeGroupItem[] | undefined {
  const e = GROUP_LIST_CACHE.get(tvId)
  if (!e || Date.now() > e.expiry) {
    if (e) GROUP_LIST_CACHE.delete(tvId)
    return undefined
  }
  return e.value
}

function groupListCacheSet(tvId: number, value: TMDBEpisodeGroupItem[]) {
  if (GROUP_LIST_CACHE.size >= GROUP_LIST_MAX) {
    const oldest = GROUP_LIST_CACHE.keys().next().value as number | undefined
    if (oldest !== undefined) GROUP_LIST_CACHE.delete(oldest)
  }
  GROUP_LIST_CACHE.set(tvId, { value, expiry: Date.now() + GROUP_LIST_TTL_MS })
}

/**
 * Risolve l'ID del gruppo Parts-default per una serie, o null (= standard).
 * Mai lancia: ogni fallimento degrada silenziosamente a null.
 */
export async function resolveDefaultEpisodeGroupId(
  tvId: number,
  standardSeasonCount: number,
  standardEpisodeCount: number,
  apiKey?: string,
): Promise<string | null> {
  try {
    let groups = groupListCacheGet(tvId)
    if (!groups) {
      groups = await getTVEpisodeGroups(tvId, apiKey)
      groupListCacheSet(tvId, groups)
    }
    const picked = pickDefaultEpisodeGroupId(groups, standardSeasonCount, standardEpisodeCount)
    return picked
  } catch {
    return null
  }
}
