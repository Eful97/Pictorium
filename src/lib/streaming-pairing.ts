/**
 * Pure curator pairing for opt-in streaming lists (display-only grouping).
 *
 * Two-phase contract:
 * - Phase 1 pairs EXACT descriptors (service + chart slug + source policy +
 *   variant) only when unique one-per-section. Ids are never rewritten.
 * - Phase 2 pairs leftover COMPLEMENTARY singles of one family (service +
 *   chart slug + source policy): one unmatched movies + one unmatched
 *   series pair despite variant difference (e.g. Rai base Film + variant-it
 *   Serie). Mixed `all` rows never join a split pair; ambiguous leftovers
 *   stay independent cards (never invented, never dropped); distinct
 *   source/country never pair; every list renders exactly once with stable
 *   first-seen block order, Film left / Serie right.
 */
import type { GenericStreamingSection } from "./streaming-catalogs"

export interface PairableStreamingList {
  readonly key: string
  readonly service: string
  readonly chartSlug: string
  readonly source?: string | null
  readonly variant?: string | null
  readonly section: GenericStreamingSection
}

export interface CuratedBlock<T extends PairableStreamingList> {
  readonly key: string
  readonly kind: "pair" | "single"
  readonly lists: T[]
}

export function pairCuratedLists<T extends PairableStreamingList>(
  lists: readonly T[],
): Array<CuratedBlock<T>> {
  const familyKey = (l: T) => `${l.service}::${l.chartSlug}::${l.source ?? "auto"}`
  const exactKey = (l: T) => `${familyKey(l)}::${l.variant ?? "-"}`
  const pairedWith = new Map<T, T>()
  const pairExact = (a: T, b: T) => {
    pairedWith.set(a, b)
    pairedWith.set(b, a)
  }
  // Phase 1: exact descriptors (service + slug + source + variant), unique
  // one-per-section. Same-variant identity wins; nothing invented.
  const exactMovies = new Map<string, T[]>()
  const exactSeries = new Map<string, T[]>()
  for (const list of lists) {
    if (list.section !== "movies" && list.section !== "series") continue
    const bucket = list.section === "movies" ? exactMovies : exactSeries
    const arr = bucket.get(exactKey(list))
    if (arr) arr.push(list)
    else bucket.set(exactKey(list), [list])
  }
  for (const [key, movies] of exactMovies) {
    const series = exactSeries.get(key) ?? []
    if (movies.length === 1 && series.length === 1) pairExact(movies[0], series[0])
  }
  // Phase 2: leftover family complementary singles (variant may differ).
  const famMovies = new Map<string, T[]>()
  const famSeries = new Map<string, T[]>()
  for (const list of lists) {
    if (list.section !== "movies" && list.section !== "series") continue
    if (pairedWith.has(list)) continue
    const fam = familyKey(list)
    const bucket = list.section === "movies" ? famMovies : famSeries
    const arr = bucket.get(fam)
    if (arr) arr.push(list)
    else bucket.set(fam, [list])
  }
  for (const [fam, movies] of famMovies) {
    const series = famSeries.get(fam) ?? []
    if (movies.length === 1 && series.length === 1) pairExact(movies[0], series[0])
  }
  const emitted = new Set<T>()
  const blocks: Array<CuratedBlock<T>> = []
  for (const list of lists) {
    if (emitted.has(list)) continue
    emitted.add(list)
    const mate = pairedWith.get(list)
    if (mate && !emitted.has(mate)) {
      emitted.add(mate)
      const movies = list.section === "movies" ? list : mate
      const series = list.section === "movies" ? mate : list
      blocks.push({ key: `pair:${movies.key}+${series.key}`, kind: "pair", lists: [movies, series] })
      continue
    }
    blocks.push({ key: list.key, kind: "single", lists: [list] })
  }
  return blocks
}
