import { describe, expect, it } from "vitest"
import { renderQualityBadgeGroup } from "@/lib/poster-service"
import type { QualityBadgeStyle } from "@/lib/badge-styles"

/**
 * Priorità render-only HDR10+ sul generico HDR: con l'effettivo che include
 * entrambi, il gruppo non disegna HDR (DB/provenance/raw utente invariati).
 * Usa il renderer condiviso reale con tier 4K (i formati da soli
 * ritornerebbero il percorso early-return storico).
 */
describe("hdr10plus render priority over generic hdr", () => {
  const STYLES: QualityBadgeStyle[] = ["standard", "mono", "color", "knockout"]

  it("suppresses hdr only when effective formats include hdr10plus (both orders)", async () => {
    for (const style of STYLES) {
      for (const topLight of [false, true]) {
        const both = await renderQualityBadgeGroup("4K", style, ["hdr", "hdr10plus"], 380, topLight)
        const plusOnly = await renderQualityBadgeGroup("4K", style, ["hdr10plus"], 380, topLight)
        const reversed = await renderQualityBadgeGroup("4K", style, ["hdr10plus", "hdr"], 380, topLight)
        expect(both).not.toBeNull()
        expect(plusOnly).not.toBeNull()
        expect(reversed).not.toBeNull()
        expect(both!.png.equals(plusOnly!.png)).toBe(true)
        expect(both!.w).toBe(plusOnly!.w)
        expect(both!.h).toBe(plusOnly!.h)
        // L'ordine dei rimanenti è preservato: entrambe le direzioni collassano
        // sullo stesso bitmap.
        expect(reversed!.png.equals(plusOnly!.png)).toBe(true)
      }
    }
  })

  it("keeps hdr-only and hdr10plus-only renders distinct", async () => {
    const hdrOnly = await renderQualityBadgeGroup("4K", "standard", ["hdr"], 380, false)
    const plusOnly = await renderQualityBadgeGroup("4K", "standard", ["hdr10plus"], 380, false)
    expect(hdrOnly).not.toBeNull()
    expect(plusOnly).not.toBeNull()
    expect(hdrOnly!.png.equals(plusOnly!.png)).toBe(false)
  })

  it("preserves dv/atmos/imax siblings and combo when hdr is suppressed", async () => {
    const both = await renderQualityBadgeGroup(
      "4K", "standard", ["dv", "atmos", "hdr", "hdr10plus", "imax"], 380, false,
    )
    const withoutHdr = await renderQualityBadgeGroup(
      "4K", "standard", ["dv", "atmos", "hdr10plus", "imax"], 380, false,
    )
    expect(both).not.toBeNull()
    expect(withoutHdr).not.toBeNull()
    expect(both!.png.equals(withoutHdr!.png)).toBe(true)
    expect(both!.w).toBe(withoutHdr!.w)
    expect(both!.h).toBe(withoutHdr!.h)
  })

  it("does not mutate the caller formats array", async () => {
    const input = ["hdr", "hdr10plus", "imax"] as const
    const snapshot = [...input]
    await renderQualityBadgeGroup("4K", "standard", input, 380, false)
    expect([...input]).toEqual(snapshot)
  })
})
