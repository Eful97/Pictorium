import { describe, expect, it, vi } from "vitest"
// The global test setup mocks @/lib/i18n with a fixed Italian t(): opt out so
// the real canonicalDictLang (pure, no dictionaries involved) is used below.
vi.unmock("@/lib/i18n")

import { canonicalDictLang } from "@/lib/i18n"
import { SUPPORTED_UI_LANGS } from "@/lib/regions"

// Eager glob = every shipped dictionary file. A newly added locale file is
// covered automatically: there is no per-language import list to forget to
// extend. Mirrors the ground-truth pattern in i18n-server.test.ts.
const dictModules = import.meta.glob("@/lib/translations/*.json", {
  eager: true,
}) as Record<string, { default: Record<string, string> }>

const DICTS: Record<string, Record<string, string>> = {}
for (const [path, mod] of Object.entries(dictModules)) {
  DICTS[path.split("/").pop()!.replace(/\.json$/, "")] = mod.default
}
const LANGS = Object.keys(DICTS).sort()

// The nine CustomLogoUrl strings (toasts, error, placeholders): the feature
// they label ships in every locale, so every dictionary must carry a proper
// translation — not a copy of the English source. Brand/technical tokens
// (Pinterest, Reddit, URL, "…") legitimately recur inside translated
// sentences; only whole-value verbatim copies are rejected.
const CUSTOM_LOGO_KEYS = [
  "ui.customLogoAdd",
  "ui.customLogoAdded",
  "ui.customLogoTitle",
  "ui.customLogoPh",
  "ui.customLogoResolving",
  "ui.customLogoRemove",
  "ui.customLogoError",
  "ui.customLogoRemoved",
  "ui.customLogoActive",
]

function placeholders(s: string): string {
  const m = s.match(/\{[a-zA-Z]+\}/g) || []
  return [...new Set(m)].sort().join(",")
}

describe("translations parity", () => {
  it("covers every canonical supported locale: no added language escapes coverage", () => {
    // SUPPORTED_UI_LANGS is the canonical UI language list (regions.ts);
    // canonicalDictLang folds aliases (pt-br -> pt, es-MX -> es-419) to the
    // shipped dictionary files. Both sides must agree exactly: a JSON file
    // without a SUPPORTED entry, or a SUPPORTED entry without a JSON file,
    // fails here instead of silently skipping parity.
    const canonicalSupported = [...new Set(SUPPORTED_UI_LANGS.map(canonicalDictLang))].sort()
    expect(LANGS).toEqual(canonicalSupported)
    // Deliberate tripwire: bump together with the language set above when a
    // locale is intentionally added (all 18 dictionaries ship today).
    expect(LANGS).toHaveLength(18)
  })

  it("all dictionaries share the exact same key set", () => {
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
    for (const k of Object.keys(DICTS["en"])) {
      const ref = placeholders(DICTS["en"][k])
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

  it("custom-logo strings are translated in every locale, not copied from English", () => {
    const bad: string[] = []
    for (const l of LANGS) {
      if (l === "en") continue
      for (const k of CUSTOM_LOGO_KEYS) {
        const v = DICTS[l][k]
        if (!v || !v.trim()) {
          bad.push(`${l}:${k} empty`)
          continue
        }
        if (v === DICTS["en"][k]) bad.push(`${l}:${k} copies English verbatim`)
      }
    }
    expect(bad).toEqual([])
  })
})
