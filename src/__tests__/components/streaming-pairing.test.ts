/**
 * Pure regression tests for curated list pairing (display-only grouping).
 *
 * Desired two-phase contract:
 * - Phase 1: exact descriptor (service + chart slug + source policy +
 *   variant) pairs ONLY when unique one-per-section. Ids/dedup unchanged.
 * - Phase 2: leftover family (service + slug + source) unambiguous singles
 *   (one unmatched Film + one unmatched Serie) pair despite variant
 *   difference (Rai base + variant-it).
 * - Anything else stays independent: ambiguous leftovers never pair and are
 *   never dropped; mixed `all` rows are always single; distinct
 *   source/country never pair; every list renders EXACTLY once with stable
 *   first-seen block order and Film left / Serie right.
 */
import { describe, expect, it } from "vitest"
import { pairCuratedLists, type PairableStreamingList } from "@/lib/streaming-pairing"

interface Row extends PairableStreamingList {
  section: "movies" | "series" | "all"
}

function row(
  key: string,
  service: string,
  chartSlug: string,
  section: Row["section"],
  extra: { source?: string | null; variant?: string | null } = {},
): Row {
  return {
    key,
    service,
    chartSlug,
    section,
    source: extra.source ?? "auto",
    variant: extra.variant ?? null,
  }
}

function kinds<T extends PairableStreamingList>(blocks: Array<{ kind: string; lists: T[] }>) {
  return blocks.map((b) => `${b.kind}:${b.lists.map((l) => l.key).join("+")}`)
}

describe("pairCuratedLists", () => {
  it("pairs an exact-variant Film+Serie while a same-family base Film stays single", () => {
    const lists = [
      row("v-a-m", "rai", "italy", "movies", { variant: "a" }),
      row("v-a-s", "rai", "italy", "series", { variant: "a" }),
      row("base-m", "rai", "italy", "movies"),
    ]
    expect(kinds(pairCuratedLists(lists))).toEqual([
      "pair:v-a-m+v-a-s",
      "single:base-m",
    ])
  })

  it("still pairs unambiguous Rai base Film + variant-it Serie (family leftovers)", () => {
    const lists = [
      row("base-m", "rai", "italy", "movies"),
      row("var-s", "rai", "italy", "series", { variant: "it" }),
    ]
    expect(kinds(pairCuratedLists(lists))).toEqual(["pair:base-m+var-s"])
  })

  it("exact per-variant pairs win; no cross-variant invention, nothing dropped", () => {
    const lists = [
      row("v-a-m", "rai", "italy", "movies", { variant: "a" }),
      row("v-b-m", "rai", "italy", "movies", { variant: "b" }),
      row("v-a-s", "rai", "italy", "series", { variant: "a" }),
      row("v-b-s", "rai", "italy", "series", { variant: "b" }),
    ]
    // Two exact pairs (one per variant) — no cross-variant invention.
    expect(kinds(pairCuratedLists(lists))).toEqual([
      "pair:v-a-m+v-a-s",
      "pair:v-b-m+v-b-s",
    ])
  })

  it("two unmatched films + one serie stay all single (no invention, no drop)", () => {
    const lists = [
      row("base-m", "rai", "italy", "movies"),
      row("other-m", "rai", "italy", "movies"),
      row("var-s", "rai", "italy", "series", { variant: "it" }),
    ]
    expect(kinds(pairCuratedLists(lists))).toEqual([
      "single:base-m",
      "single:other-m",
      "single:var-s",
    ])
  })

  it("mixed `all` always stays single and never swallows siblings", () => {
    const lists = [
      row("m", "paramount", "italy", "movies"),
      row("s", "paramount", "italy", "series"),
      row("a", "paramount", "italy", "all"),
    ]
    expect(kinds(pairCuratedLists(lists))).toEqual(["pair:m+s", "single:a"])
  })

  it("distinct source or country never pair", () => {
    const lists = [
      row("fp-m", "hulu", "united-states", "movies", { source: "flixpatrol" }),
      row("jw-s", "hulu", "united-states", "series", { source: "justwatch" }),
      row("it-m", "hulu", "italy", "movies", { source: "flixpatrol" }),
      row("us-s", "hulu", "united-states", "series", { source: "flixpatrol" }),
    ]
    // fp-m + us-s share service+slug+source: exact pair. jw-s differs by
    // source, it-m differs by country: both stay single.
    expect(kinds(pairCuratedLists(lists))).toEqual([
      "pair:fp-m+us-s",
      "single:jw-s",
      "single:it-m",
    ])
  })

  it("keeps stable first-seen block order with Film left / Serie right", () => {
    const lists = [
      row("s-first", "wow", "germany", "series"),
      row("m-second", "wow", "germany", "movies"),
      row("solo", "rai", "italy", "movies"),
    ]
    const blocks = pairCuratedLists(lists)
    expect(blocks[0]).toMatchObject({ kind: "pair", lists: [lists[1], lists[0]] })
    expect(blocks[1]).toMatchObject({ kind: "single", lists: [lists[2]] })
  })
})
