/**
 * Parametri above/below (netPos, qanc, banc, tanc, xanc; NON lanc) e bov:
 * resolver, guardie, hardening, allowlist della cache, emissione Stremio.
 */
import { describe, it, expect } from "vitest"
import {
  LOGO_RELATIVE_POSITIONS,
  isLogoRelativePosition,
  isAnchorChoiceRel,
  resolveQualityAnchor,
  resolveTopBadgeAnchor,
  resolveExtraBadgeAnchor,
  resolveBottomAnchor,
  QUALITY_ANCHORS,
  BOTTOM_ANCHORS,
  TOP_BADGE_ANCHORS,
  EXTRA_BADGE_ANCHORS,
  isAnchorPosition,
} from "@/lib/badge-anchor"
import { resolveLogoAnchor, isLogoAnchor, LOGO_ANCHORS } from "@/lib/logo-layout"
import { isNetworkLogoPosition } from "@/lib/types"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { BADGE_OVERFLOW_MODES, isBadgeOverflow, pickBadgeOverflow, resolveBadgeOverflow } from "@/lib/badge-overflow"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"

const BASE = { presets: true, preview: false, anonymous: true, publicInstance: true, hasMapping: false } as const

describe("above/below: valori e resolver", () => {
  it("LOGO_RELATIVE_POSITIONS = above, below; non sono posizioni fisse", () => {
    expect([...LOGO_RELATIVE_POSITIONS]).toEqual(["above", "below"])
    expect(isLogoRelativePosition("above")).toBe(true)
    expect(isLogoRelativePosition("tl")).toBe(false)
    expect(isAnchorPosition("above")).toBe(false)
    expect(isAnchorChoiceRel("below")).toBe(true)
    expect(isAnchorChoiceRel("xx")).toBe(false)
  })

  it("le liste dei parametri non-logo accettano above/below; lanc no", () => {
    for (const set of [QUALITY_ANCHORS, BOTTOM_ANCHORS, TOP_BADGE_ANCHORS, EXTRA_BADGE_ANCHORS]) {
      expect((set as readonly string[]).includes("above")).toBe(true)
      expect((set as readonly string[]).includes("below")).toBe(true)
    }
    expect((LOGO_ANCHORS as readonly string[]).includes("above")).toBe(false)
    expect(isLogoAnchor("above")).toBe(false)
    expect(resolveLogoAnchor({ query: "above" })).toBe("auto")
  })

  it("netPos accetta above/below (legacy top resta valido)", () => {
    expect(isNetworkLogoPosition("above")).toBe(true)
    expect(isNetworkLogoPosition("below")).toBe(true)
    expect(isNetworkLogoPosition("top")).toBe(true)
  })

  it("resolver: query above/below vince su config e default; garbage cade al successivo", () => {
    expect(resolveQualityAnchor({ query: "above", config: "tl" })).toBe("above")
    expect(resolveQualityAnchor({ query: "zz", config: "below", defaults: "tl" })).toBe("below")
    expect(resolveTopBadgeAnchor({ query: null, config: null, defaults: "below" })).toBe("below")
    expect(resolveExtraBadgeAnchor({ query: "above" })).toBe("above")
    expect(resolveBottomAnchor({ query: "below" })).toBe("below")
    expect(resolveBottomAnchor({ query: "nope" })).toBe("auto")
  })
})

describe("above/below: hardening URL e cache", () => {
  it("qanc/banc/tanc/xanc/netPos above e below sopravvivono; lanc viene scartato", () => {
    for (const key of ["netPos", "qanc", "banc", "tanc", "xanc"]) {
      for (const v of ["above", "below"]) {
        expect(hardenPosterSearchParams(new URLSearchParams(`${key}=${v}`), BASE).get(key)).toBe(v)
        expect(normalizePosterCacheParams(new URLSearchParams(`${key}=${v}`)).get(key)).toBe(v)
      }
    }
    expect(hardenPosterSearchParams(new URLSearchParams("lanc=above"), BASE).has("lanc")).toBe(false)
  })

  it("garbage su bov scartato; hide/move passano", () => {
    expect(hardenPosterSearchParams(new URLSearchParams("bov=zz"), BASE).has("bov")).toBe(false)
    expect(hardenPosterSearchParams(new URLSearchParams("bov=hide"), BASE).get("bov")).toBe("hide")
    expect(hardenPosterSearchParams(new URLSearchParams("bov=move"), BASE).get("bov")).toBe("move")
  })

  it("bov sopravvive alla normalizzazione della cache (altrimenti hide servito dalla cache move)", () => {
    expect(normalizePosterCacheParams(new URLSearchParams("bov=hide")).get("bov")).toBe("hide")
  })
})

describe("bov: valori e catena di risoluzione (globale)", () => {
  it("valori: move | hide", () => {
    expect([...BADGE_OVERFLOW_MODES]).toEqual(["move", "hide"])
    expect(isBadgeOverflow("hide")).toBe(true)
    expect(isBadgeOverflow("HIDE")).toBe(false)
    expect(pickBadgeOverflow(undefined)).toBe("move")
    expect(pickBadgeOverflow("zz")).toBe("move")
  })

  it("query > config token > defaults > move", () => {
    expect(resolveBadgeOverflow({ query: "hide", config: "move", defaults: "move" })).toBe("hide")
    expect(resolveBadgeOverflow({ query: "zz", config: "hide", defaults: "move" })).toBe("hide")
    expect(resolveBadgeOverflow({ query: null, config: undefined, defaults: "hide" })).toBe("hide")
    expect(resolveBadgeOverflow({})).toBe("move")
  })
})

describe("bov: emissione Stremio (solo hide; move = URL storico invariato)", () => {
  it("hide emette bov=hide; move/assente non emette nulla", () => {
    const hide = buildStremioPosterSearchParams({ badgeOverflow: "hide" } as never)
    expect(hide.get("bov")).toBe("hide")
    const move = buildStremioPosterSearchParams({ badgeOverflow: "move" } as never)
    expect(move.has("bov")).toBe(false)
    const none = buildStremioPosterSearchParams({} as never)
    expect(none.has("bov")).toBe(false)
  })
})
