/**
 * Posizioni di ancoraggio estese (`auto` + tl tc tr ml mc mr bl bc br) condivise
 * da lanc / netPos / qanc / banc / tanc / xanc.
 *
 * (a) anchorRect puro: 9 posizioni su canvas portrait (500×750) e landscape
 *     (768×432), con margini asimmetrici per verificare la colonna/riga;
 * (b) predicati e insiemi: 9 valori validi, garbage/legacy gestiti;
 * (c) hardening URL: i 9 valori passano, il garbage collassa (param rimosso).
 */
import { describe, it, expect } from "vitest"
import {
  ANCHOR_POSITIONS,
  ANCHOR_CHOICES,
  ANCHOR_CHOICES_REL,
  anchorRect,
  isAnchorPosition,
  isAnchorChoice,
  QUALITY_ANCHORS,
  BOTTOM_ANCHORS,
  TOP_BADGE_ANCHORS,
  EXTRA_BADGE_ANCHORS,
} from "@/lib/badge-anchor"
import { LOGO_ANCHORS, isLogoAnchor } from "@/lib/logo-layout"
import { NETWORK_LOGO_POSITIONS, NETWORK_LOGO_POSITION_CHOICES, isNetworkLogoPosition } from "@/lib/types"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { LAND_W, LAND_H } from "@/lib/constants"

describe("anchorRect (puro)", () => {
  const portrait = { canvasW: STD_W, canvasH: STD_H, w: 100, h: 50, marginX: 20, marginTop: 30, marginBottom: 40 }
  const landscape = { canvasW: LAND_W, canvasH: LAND_H, w: 200, h: 80, marginX: 24, marginTop: 10, marginBottom: 16 }

  it("portrait: le 9 posizioni, colonna l/c/r e riga t/m/b", () => {
    expect(anchorRect("tl", portrait)).toEqual({ left: 20, top: 30 })
    expect(anchorRect("tc", portrait)).toEqual({ left: 200, top: 30 })
    expect(anchorRect("tr", portrait)).toEqual({ left: 380, top: 30 })
    expect(anchorRect("ml", portrait)).toEqual({ left: 20, top: 350 })
    expect(anchorRect("mc", portrait)).toEqual({ left: 200, top: 350 })
    expect(anchorRect("mr", portrait)).toEqual({ left: 380, top: 350 })
    expect(anchorRect("bl", portrait)).toEqual({ left: 20, top: 660 })
    expect(anchorRect("bc", portrait)).toEqual({ left: 200, top: 660 })
    expect(anchorRect("br", portrait)).toEqual({ left: 380, top: 660 })
  })

  it("landscape: stessa regola con margini asimmetrici (centro arrotondato)", () => {
    // w=200 h=80 su 768×432: centro x = (768-200)/2 = 284, centro y = (432-80)/2 = 176.
    expect(anchorRect("tl", landscape)).toEqual({ left: 24, top: 10 })
    expect(anchorRect("tc", landscape)).toEqual({ left: 284, top: 10 })
    expect(anchorRect("tr", landscape)).toEqual({ left: 768 - 200 - 24, top: 10 })
    expect(anchorRect("mc", landscape)).toEqual({ left: 284, top: 176 })
    expect(anchorRect("ml", landscape)).toEqual({ left: 24, top: 176 })
    expect(anchorRect("mr", landscape)).toEqual({ left: 768 - 200 - 24, top: 176 })
    expect(anchorRect("bc", landscape)).toEqual({ left: 284, top: 432 - 80 - 16 })
    expect(anchorRect("bl", landscape)).toEqual({ left: 24, top: 432 - 80 - 16 })
    expect(anchorRect("br", landscape)).toEqual({ left: 768 - 200 - 24, top: 432 - 80 - 16 })
  })

  it("centro arrotondato su dimensioni dispari (round, non floor)", () => {
    // (500-101)/2 = 199.5 → 200 ; (750-51)/2 = 349.5 → 350
    expect(anchorRect("mc", { ...portrait, w: 101, h: 51 })).toEqual({ left: 200, top: 350 })
  })

  it("il rettangolo non viene clampato (il chiamante decide)", () => {
    expect(anchorRect("br", { ...portrait, marginX: -10 }).left).toBe(500 - 100 + 10)
  })
})

describe("insiemi di ancore e predicati", () => {
  it("ANCHOR_POSITIONS ha 9 valori distinti; ANCHOR_CHOICES = auto + 9", () => {
    expect([...ANCHOR_POSITIONS]).toEqual(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"])
    expect(ANCHOR_CHOICES[0]).toBe("auto")
    expect(ANCHOR_CHOICES.length).toBe(10)
    expect(new Set(ANCHOR_CHOICES).size).toBe(10)
  })

  it("isAnchorPosition / isAnchorChoice: 9 validi, auto solo come choice, garbage rifiutato", () => {
    for (const p of ANCHOR_POSITIONS) {
      expect(isAnchorPosition(p)).toBe(true)
      expect(isAnchorChoice(p)).toBe(true)
    }
    expect(isAnchorPosition("auto")).toBe(false)
    expect(isAnchorChoice("auto")).toBe(true)
    for (const bad of ["top", "", "TL", "xx", null, undefined, 3]) {
      expect(isAnchorChoice(bad)).toBe(false)
    }
  })

  it("tutti i parametri d'ancora accettano le 9 posizioni (alias storici); lanc resta senza above/below", () => {
    for (const set of [QUALITY_ANCHORS, BOTTOM_ANCHORS, TOP_BADGE_ANCHORS, EXTRA_BADGE_ANCHORS]) {
      expect([...set]).toEqual([...ANCHOR_CHOICES_REL])
    }
    expect([...LOGO_ANCHORS]).toEqual([...ANCHOR_CHOICES])
  })

  it("netPos: 9 posizioni + auto + legacy top; la UI offre auto + 9 senza top", () => {
    for (const p of ANCHOR_POSITIONS) expect(isNetworkLogoPosition(p)).toBe(true)
    expect(isNetworkLogoPosition("top")).toBe(true)
    expect(isNetworkLogoPosition("auto")).toBe(true)
    expect(isNetworkLogoPosition("xx")).toBe(false)
    expect([...NETWORK_LOGO_POSITIONS]).toEqual(["auto", "top", ...ANCHOR_POSITIONS, "above", "below"])
    expect([...NETWORK_LOGO_POSITION_CHOICES]).toEqual([...ANCHOR_CHOICES_REL])
    expect(NETWORK_LOGO_POSITION_CHOICES).not.toContain("top")
  })
})

describe("hardening URL: 9 posizioni passano, garbage collassa", () => {
  it("qanc/lanc/banc/tanc/xanc/netPos: ogni posizione sopravvive alla normalizzazione", () => {
    for (const key of ["qanc", "lanc", "banc", "tanc", "xanc", "netPos"]) {
      for (const p of ANCHOR_POSITIONS) {
        const out = normalizePosterCacheParams(new URLSearchParams(`${key}=${p}`))
        expect(out.get(key)).toBe(p)
      }
    }
  })

  it("garbage (valore inesistente) viene scartato dall'hardening, come l'assenza", () => {
    const BASE = { presets: true, preview: false, anonymous: true, publicInstance: true, hasMapping: false } as const
    for (const key of ["qanc", "lanc", "banc", "tanc", "xanc", "netPos"]) {
      const out = hardenPosterSearchParams(new URLSearchParams(`${key}=zz`), BASE)
      expect(out.has(key)).toBe(false)
    }
  })
})
