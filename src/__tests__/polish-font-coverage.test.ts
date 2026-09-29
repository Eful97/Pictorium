import fs from "node:fs"
import { describe, expect, it } from "vitest"
import { FONT_INTER_BLACK, FONT_INTER_BOLD, FONT_INTER_REGULAR } from "@/lib/fonts"
import { fontFamilyFor } from "@/lib/badge-svg-shared"

/**
 * L'integrazione polacca (regione PL / lingua UI `pl`) si affida a Inter per
 * i glifi latin-extended: ąćęłńóśźż e le loro maiuscole. Senza copertura i
 * badge con testo polacco escono come tofu (box vuoti), quindi questo test
 * fissa l'invariante leggendo direttamente la cmap del TTF — più deterministico
 * di un confronto pixel, che non distingue "glifo mancante" da "carattere
 * stretto".
 */
function readMappedCodepoints(file: string): Set<number> {
  const buf = fs.readFileSync(file)
  const numTables = buf.readUInt16BE(4)

  let cmapOff = 0
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    if (buf.toString("ascii", rec, rec + 4) === "cmap") {
      cmapOff = buf.readUInt32BE(rec + 8)
      break
    }
  }
  if (!cmapOff) throw new Error(`no cmap table in ${file}`)

  // Preferisce la sotto-tabella Unicode (platform 3, encoding 1/10, o platform 0).
  const numSub = buf.readUInt16BE(cmapOff + 2)
  let sub = 0
  for (let i = 0; i < numSub; i++) {
    const rec = cmapOff + 4 + i * 8
    const platformId = buf.readUInt16BE(rec)
    const encodingId = buf.readUInt16BE(rec + 2)
    if (platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10))) {
      sub = cmapOff + buf.readUInt32BE(rec + 4)
      break
    }
  }

  const out = new Set<number>()
  const format = buf.readUInt16BE(sub)
  if (format === 4) {
    const segCountX2 = buf.readUInt16BE(sub + 6)
    const segCount = segCountX2 / 2
    const endBase = sub + 14
    const startBase = endBase + segCountX2 + 2
    const deltaBase = startBase + segCountX2
    const rangeBase = deltaBase + segCountX2
    for (let s = 0; s < segCount; s++) {
      const end = buf.readUInt16BE(endBase + s * 2)
      const start = buf.readUInt16BE(startBase + s * 2)
      const delta = buf.readInt16BE(deltaBase + s * 2)
      const rangeOffset = buf.readUInt16BE(rangeBase + s * 2)
      if (start === 0xffff) continue
      for (let c = start; c <= end; c++) {
        let glyph: number
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff
        } else {
          const gi = rangeBase + s * 2 + rangeOffset + (c - start) * 2
          if (gi + 1 >= buf.length) continue
          glyph = buf.readUInt16BE(gi)
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff
        }
        if (glyph !== 0) out.add(c)
      }
    }
  } else if (format === 12) {
    const groups = buf.readUInt32BE(sub + 12)
    for (let g = 0; g < groups; g++) {
      const rec = sub + 16 + g * 12
      const start = buf.readUInt32BE(rec)
      const end = buf.readUInt32BE(rec + 4)
      for (let c = start; c <= end; c++) out.add(c)
    }
  } else {
    throw new Error(`unsupported cmap format ${format} in ${file}`)
  }
  return out
}

// Tutte le lettere dell'alfabeto polacco, maiuscole e minuscole.
const POLISH_ALPHABET = "aąbcćdeęfghijklłmnńoóprsśtuwyzźżAĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ"
const WEIGHTS: ReadonlyArray<readonly [string, string]> = [
  ["Regular", FONT_INTER_REGULAR],
  ["Bold", FONT_INTER_BOLD],
  ["Black", FONT_INTER_BLACK],
]

describe("Inter copre l'alfabeto polacco", () => {
  for (const [name, file] of WEIGHTS) {
    it(`weight ${name}: tutti i glifi di "${POLISH_ALPHABET}" sono mappati`, () => {
      expect(fs.existsSync(file)).toBe(true)
      const mapped = readMappedCodepoints(file)
      const missing: string[] = []
      for (const char of POLISH_ALPHABET) {
        if (!mapped.has(char.codePointAt(0)!)) missing.push(`${char} (U+${char.codePointAt(0)!.toString(16).toUpperCase()})`)
      }
      expect(missing).toEqual([])
    })
  }

  it("fontFamilyFor lascia il latino su Inter: nessun ramo polacco necessario", () => {
    // Il fallback per-glifo di resvg serve per l'ebraico (che Inter non ha).
    // Il polacco c'è già in Inter, quindi dichiarare un'altra famiglia
    // romperebbe l'allineamento dei pesi per nulla.
    expect(fontFamilyFor("ŁÓDŹ ŻÓŁĆ")).toBe("Inter")
    expect(fontFamilyFor("Kryminał")).toBe("Inter")
  })
})
