import { describe, expect, it } from "vitest"
import enDict from "@/lib/translations/en.json"
import itDict from "@/lib/translations/it.json"
import frDict from "@/lib/translations/fr.json"
import deDict from "@/lib/translations/de.json"
import esDict from "@/lib/translations/es.json"
import jaDict from "@/lib/translations/ja.json"
import koDict from "@/lib/translations/ko.json"
import ptDict from "@/lib/translations/pt.json"
import heDict from "@/lib/translations/he.json"

const DICTS: Record<string, Record<string, string>> = { en: enDict, it: itDict, fr: frDict, de: deDict, es: esDict, ja: jaDict, ko: koDict, pt: ptDict, he: heDict }
const LANGS = Object.keys(DICTS)

function placeholders(s: string): string {
  const m = s.match(/\{[a-zA-Z]+\}/g) || []
  return [...new Set(m)].sort().join(",")
}

describe("translations parity", () => {
  it("all 9 dictionaries share the exact same key set", () => {
    const allKeys = new Set<string>()
    for (const l of LANGS) for (const k of Object.keys(DICTS[l])) allKeys.add(k)
    expect(allKeys.size).toBeGreaterThan(500)
    for (const l of LANGS) {
      const missing = [...allKeys].filter((k) => !(k in DICTS[l]))
      expect(missing, `${l} missing keys`).toEqual([])
    }
  })

  it("every key keeps the same {placeholders} as English", () => {
    const bad: string[] = []
    for (const k of Object.keys(enDict)) {
      const ref = placeholders((enDict as Record<string, string>)[k])
      for (const l of LANGS) {
        const mine = placeholders(DICTS[l][k] ?? "")
        if (mine !== ref) bad.push(`${l}:${k} en{${ref}} vs {${mine}}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("no empty values", () => {
    const bad: string[] = []
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(DICTS[l])) {
        if (!v || !v.trim()) bad.push(`${l}:${k}`)
      }
    }
    expect(bad).toEqual([])
  })
})
