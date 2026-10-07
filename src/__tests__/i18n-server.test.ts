import { describe, expect, it, vi } from "vitest"
// Exercise the real dictionaries: opt out of the global @/lib/i18n mock.
vi.unmock("@/lib/i18n")

import {
  BADGE_KEY_PREFIX,
  createT,
  getLang,
  isDictionaryLoaded,
  isRankKey,
  resolveLabelFor,
} from "@/lib/i18n-server"
import { SUPPORTED_UI_LANGS } from "@/lib/regions"

// Same eager-glob pattern as tr-nl-sv.test.ts: direct JSON imports are
// untouched by the setup.ts mock and serve as ground truth.
const dictModules = import.meta.glob("@/lib/translations/*.json", {
  eager: true,
}) as Record<string, { default: Record<string, string> }>

function langOf(path: string): string {
  return path.split("/").pop()!.replace(/\.json$/, "")
}

describe("i18n-server eager registry", () => {
  it("registers every shipped dictionary", () => {
    const langs = Object.keys(dictModules).map(langOf)
    expect(langs).toHaveLength(18)
    for (const lang of langs) expect(isDictionaryLoaded(lang), lang).toBe(true)
    for (const lang of SUPPORTED_UI_LANGS) {
      expect(isDictionaryLoaded(lang), lang).toBe(true)
    }
  })

  it("resolves every language from its own dictionary", () => {
    for (const [path, mod] of Object.entries(dictModules)) {
      const lang = langOf(path)
      expect(createT(lang)("badge.today"), `${path}:badge.today`).toBe(
        mod.default["badge.today"],
      )
      expect(resolveLabelFor("__badge.today", lang), `${path}:resolveLabelFor`).toBe(
        mod.default["badge.today"],
      )
    }
  })

  it("canonicalizes es-MX to es-419 and falls back to English", () => {
    const t419 = createT("es-419")
    expect(createT("es-MX")("badge.today")).toBe(t419("badge.today"))
    expect(createT("xx")("badge.today")).toBe(createT("en")("badge.today"))
    expect(resolveLabelFor("__badge.today", "xx")).toBe(createT("en")("badge.today"))
  })

  it("keeps pure helpers and global-lang state intact", () => {
    expect(BADGE_KEY_PREFIX).toBe("__")
    expect(isRankKey("Oggi")).toBe("badge.today")
    expect(isRankKey("__badge.anime")).toBe("badge.anime")
    expect(getLang()).toBe("it")
  })
})
