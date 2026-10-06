import { describe, expect, it } from "vitest"
import enDict from "@/lib/translations/en.json"
import itDict from "@/lib/translations/it.json"
import frDict from "@/lib/translations/fr.json"
import deDict from "@/lib/translations/de.json"
import esDict from "@/lib/translations/es.json"
import es419Dict from "@/lib/translations/es-419.json"
import jaDict from "@/lib/translations/ja.json"
import koDict from "@/lib/translations/ko.json"
import ptDict from "@/lib/translations/pt.json"
import heDict from "@/lib/translations/he.json"
import csDict from "@/lib/translations/cs.json"
import roDict from "@/lib/translations/ro.json"
import plDict from "@/lib/translations/pl.json"
import viDict from "@/lib/translations/vi.json"
import nlDict from "@/lib/translations/nl.json"
import svDict from "@/lib/translations/sv.json"
import arDict from "@/lib/translations/ar.json"
import trDict from "@/lib/translations/tr.json"

// The edit-target selector must never render a raw key: both labels exist in
// every dictionary, so the English fallback is never needed for them.
const DICTS: Record<string, Record<string, string>> = {
  en: enDict,
  it: itDict,
  fr: frDict,
  de: deDict,
  es: esDict,
  "es-419": es419Dict,
  ja: jaDict,
  ko: koDict,
  pt: ptDict,
  he: heDict,
  cs: csDict,
  ro: roDict,
  pl: plDict,
  vi: viDict,
  nl: nlDict,
  sv: svDict,
  ar: arDict,
  tr: trDict,
}
const NEW_KEYS = ["ui.formatTarget", "ui.formatTargetHint"] as const

describe("format target i18n", () => {
  it("all 18 dictionaries define the new keys with non-empty values", () => {
    expect(Object.keys(DICTS)).toHaveLength(18)
    for (const [lang, dict] of Object.entries(DICTS)) {
      for (const key of NEW_KEYS) {
        expect(dict[key]?.trim(), `${lang}:${key}`).toBeTruthy()
      }
    }
  })

  it("heading reads as edit target, not delivery format", () => {
    expect((enDict as Record<string, string>)["ui.formatTarget"]).toBe("Format to edit")
    expect((itDict as Record<string, string>)["ui.formatTarget"]).toBe("Formato da modificare")
  })
})
