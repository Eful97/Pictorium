/**
 * Ancora del badge superiore centrato (`tanc`, solo rank) e ancora del badge
 * extra (`xanc`, indipendente): catena di risoluzione, predicati, enum finita
 * in hardening e allowlist della cache.
 */
import { describe, it, expect } from "vitest"
import {
  TOP_BADGE_ANCHORS,
  isTopBadgeAnchor,
  isActiveTopBadgeAnchor,
  resolveTopBadgeAnchor,
  EXTRA_BADGE_ANCHORS,
  isExtraBadgeAnchor,
  resolveExtraBadgeAnchor,
} from "@/lib/badge-anchor"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { topBadgeSampleAnchor } from "@/lib/badge-layout"

const BASE = { presets: true, preview: false, anonymous: true, publicInstance: true, hasMapping: false } as const

describe("TOP_BADGE_ANCHORS", () => {
  it("espone auto, le 9 posizioni fisse e above/below (relative al logo)", () => {
    expect([...TOP_BADGE_ANCHORS]).toEqual(["auto", "tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br", "above", "below"])
  })

  it("isTopBadgeAnchor accetta solo i valori dell'enum", () => {
    for (const v of ["auto", "tl", "tr"]) expect(isTopBadgeAnchor(v)).toBe(true)
    for (const v of ["top", "xx", "TL", "", null, undefined, 3]) expect(isTopBadgeAnchor(v)).toBe(false)
  })

  it("isActiveTopBadgeAnchor è vero solo per tl/tr (auto non è attivo)", () => {
    expect(isActiveTopBadgeAnchor("tl")).toBe(true)
    expect(isActiveTopBadgeAnchor("tr")).toBe(true)
    expect(isActiveTopBadgeAnchor("auto")).toBe(false)
    expect(isActiveTopBadgeAnchor(undefined)).toBe(false)
  })
})

describe("resolveTopBadgeAnchor (catena query > mapping > config > defaults > auto)", () => {
  it("la query valida vince su tutto il resto", () => {
    expect(resolveTopBadgeAnchor({ query: "tr", mapping: "tl", config: "tl", defaults: "tl" })).toBe("tr")
  })

  it("la query è normalizzata in minuscolo", () => {
    expect(resolveTopBadgeAnchor({ query: "TL" })).toBe("tl")
  })

  it("query non valida cade al mapping, poi al config, poi ai defaults", () => {
    expect(resolveTopBadgeAnchor({ query: "bogus", mapping: "tr", config: "tl", defaults: "auto" })).toBe("tr")
    expect(resolveTopBadgeAnchor({ query: null, mapping: "bogus", config: "tl", defaults: "tr" })).toBe("tl")
    expect(resolveTopBadgeAnchor({ query: "", mapping: undefined, config: null, defaults: "tr" })).toBe("tr")
  })

  it("niente di valido ⇒ auto", () => {
    expect(resolveTopBadgeAnchor({})).toBe("auto")
    expect(resolveTopBadgeAnchor({ query: "nope", mapping: 7, config: {}, defaults: "xx" })).toBe("auto")
  })
})

describe("hardening di tanc", () => {
  it("è nell'allowlist della cache", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("tanc")).toBe(true)
  })

  it("valore valido viene canonicalizzato in minuscolo", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("tanc=TR"), BASE)
    expect(out.get("tanc")).toBe("tr")
  })

  it("garbage viene scartato (enum finita, come qanc)", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("tanc=xx&qanc=tl"), BASE)
    expect(out.has("tanc")).toBe(false)
    expect(out.get("qanc")).toBe("tl")
  })

  it("auto resta auto (nessun collasso a assente)", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("tanc=auto"), BASE)
    expect(out.get("tanc")).toBe("auto")
  })
})

describe("resolveExtraBadgeAnchor (xanc, stessa catena di tanc)", () => {
  it("l'enum è quello di tanc (auto, tl, tr) e il guard lo accetta", () => {
    expect(EXTRA_BADGE_ANCHORS).toEqual(TOP_BADGE_ANCHORS)
    expect(isExtraBadgeAnchor("tl")).toBe(true)
    expect(isExtraBadgeAnchor("xx")).toBe(false)
  })

  it("query > mapping > config > defaults > auto, identica a tanc", () => {
    expect(resolveExtraBadgeAnchor({ query: "TR", mapping: "tl", config: "tl", defaults: "tl" })).toBe("tr")
    expect(resolveExtraBadgeAnchor({ query: "bogus", mapping: "bogus", config: "tl", defaults: "tr" })).toBe("tl")
    expect(resolveExtraBadgeAnchor({ defaults: "tr" })).toBe("tr")
    expect(resolveExtraBadgeAnchor({ query: "nope", mapping: 7, config: {}, defaults: "xx" })).toBe("auto")
  })

  it("è indipendente da tanc: stessa query, risultato dipendente solo dal parametro letto", () => {
    expect(resolveExtraBadgeAnchor({ query: "tl" })).toBe("tl")
    expect(resolveTopBadgeAnchor({ query: null })).toBe("auto")
  })
})

describe("hardening di xanc", () => {
  it("è nell'allowlist della cache", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("xanc")).toBe(true)
  })

  it("valore valido viene canonicalizzato in minuscolo", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("xanc=TR"), BASE)
    expect(out.get("xanc")).toBe("tr")
  })

  it("garbage viene scartato senza toccare tanc", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("xanc=xx&tanc=tl"), BASE)
    expect(out.has("xanc")).toBe(false)
    expect(out.get("tanc")).toBe("tl")
  })

  it("auto resta auto (nessun collasso a assente)", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("xanc=auto"), BASE)
    expect(out.get("xanc")).toBe("auto")
  })
})

describe("polarità del badge superiore (finestra di campionamento)", () => {
  it("tl/tr spostano la finestra sul lato scelto; auto e corner restano invariati", () => {
    const base = { topBadgeType: "rank" as const, rankingBadgeStyle: "default" as never }
    expect(topBadgeSampleAnchor({ ...base, topBadgeAnchor: "tl" })).toBe("left")
    expect(topBadgeSampleAnchor({ ...base, topBadgeAnchor: "tr" })).toBe("right")
    expect(topBadgeSampleAnchor({ ...base, topBadgeAnchor: "auto" })).toBe("center")
    expect(topBadgeSampleAnchor({ ...base })).toBe("center")
    expect(topBadgeSampleAnchor({ topBadgeType: "rank", rankingBadgeStyle: "corner" as never, topBadgeAnchor: "tr" })).toBe("left")
  })
})
