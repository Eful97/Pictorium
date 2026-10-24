/**
 * i18n regression: catalog/streaming/publication keys must exist natively in
 * all 18 locale dictionaries with real translations (never English fallback,
 * never raw `ui.*` keys in the UI).
 *
 * Background: the anchor rollback recovery proved these 33 keys were dropped
 * from every dict (present in pre-anchor T2-BEFORE snapshots + T2/MYDIFF per
 * locale, absent now). The shared `t()` falls back to English silently and
 * `renderWithCtx` mocks `t` as identity, so neither the app nor the older
 * unit tests surfaced the loss. These tests assert the dictionaries
 * themselves (direct JSON import, no fallback) plus end-to-end rendering
 * through the REAL `createT` (mirroring server/client registration).
 */
import { describe, expect, it, beforeAll, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { createT, registerDictionary, type Dictionary } from "@/lib/i18n"
import { TranslationProvider } from "@/lib/contexts/TranslationContext"
import type { PictoriumCtx } from "@/lib/context"
import { PublicationLine } from "@/components/PublicationLine"

// Use the REAL i18n module in this file: the global setup mocks createT/t
// with a hardcoded dictionary snapshot that lacks the catalog keys, which is
// exactly the blind spot this regression test closes (mocked t can never
// prove a real dictionary carries a key). A file-level vi.mock wins over the
// setup-file mock for this file only; every other suite keeps its mock.
vi.mock("@/lib/i18n", async (importOriginal) => importOriginal<typeof import("@/lib/i18n")>())

import ar from "@/lib/translations/ar.json"
import cs from "@/lib/translations/cs.json"
import de from "@/lib/translations/de.json"
import en from "@/lib/translations/en.json"
import es from "@/lib/translations/es.json"
import es419 from "@/lib/translations/es-419.json"
import fr from "@/lib/translations/fr.json"
import he from "@/lib/translations/he.json"
import itDict from "@/lib/translations/it.json"
import ja from "@/lib/translations/ja.json"
import ko from "@/lib/translations/ko.json"
import nl from "@/lib/translations/nl.json"
import pl from "@/lib/translations/pl.json"
import pt from "@/lib/translations/pt.json"
import ro from "@/lib/translations/ro.json"
import sv from "@/lib/translations/sv.json"
import tr from "@/lib/translations/tr.json"
import viDict from "@/lib/translations/vi.json"

const LOCALES: Record<string, Dictionary> = {
  ar, cs, de, en, es, "es-419": es419, fr, he, it: itDict, ja, ko, nl, pl, pt, ro, sv, tr, vi: viDict,
}
const LOCALE_IDS = Object.keys(LOCALES)

const KEYS = [
  "ui.publicationLabel",
  "ui.publicationUnknown",
  "ui.bulkDelete",
  "ui.bulkDeleteConfirm",
  "ui.bulkDeleteProtected",
  "ui.confirmRestoreDefaults",
  "ui.restoreDefaults",
  "ui.streamAddCount",
  "ui.streamAddTop10",
  "ui.streamAlreadyAdded",
  "ui.streamCoverageError",
  "ui.streamCoverageStale",
  "ui.streamCuratedTitle",
  "ui.streamDialogSub",
  "ui.streamDialogTitle",
  "ui.streamExpectedNote",
  "ui.streamLegacyBody",
  "ui.streamLegacyConfirm",
  "ui.streamLegacyTitle",
  "ui.streamLoadingCoverage",
  "ui.streamMaxReached",
  "ui.streamNoKeyNotice",
  "ui.streamOptInNote",
  "ui.streamPickCountry",
  "ui.streamPickProviders",
  "ui.streamPickSections",
  "ui.streamPickSource",
  "ui.streamSectionMixed",
  "ui.streamSelectedCount",
  "ui.streamSourceFp",
  "ui.streamSourceJw",
  "ui.streamSourceUnknown",
  "ui.streamUnavailable",
] as const

/** Placeholder names per key, exactly as the callers pass them. */
const PARAMS: Record<string, string[]> = {
  "ui.bulkDelete": ["count"],
  "ui.bulkDeleteConfirm": ["count"],
  "ui.streamAddCount": ["count"],
  "ui.streamSelectedCount": ["count", "lists"],
}

describe("catalog/publication i18n keys exist natively in every locale", () => {
  it("all 33 keys are present and non-empty in all 18 dictionaries (direct import, no fallback)", () => {
    expect(LOCALE_IDS).toHaveLength(18)
    expect(KEYS).toHaveLength(33)
    for (const lang of LOCALE_IDS) {
      const dict = LOCALES[lang] as Record<string, unknown>
      for (const key of KEYS) {
        expect(typeof dict[key], `${lang}:${key}`).toBe("string")
        expect((dict[key] as string).trim().length, `${lang}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it("every key carries exactly its caller-supplied placeholders in every locale", () => {
    for (const lang of LOCALE_IDS) {
      const dict = LOCALES[lang] as Record<string, string>
      for (const [key, params] of Object.entries(PARAMS)) {
        const val = dict[key] as string
        for (const p of params) {
          expect(val, `${lang}:${key}`).toContain(`{${p}}`)
        }
        const extras = [...val.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).filter((p) => !params.includes(p))
        expect(extras, `${lang}:${key}`).toEqual([])
      }
    }
  })
})

describe("real t() lookup resolves native strings (no English fallback masking)", () => {
  beforeAll(() => {
    // Mirror the real registration path (server eager + client loader):
    // every locale dict registered under its own code.
    for (const lang of LOCALE_IDS) registerDictionary(lang, LOCALES[lang])
  })

  it("createT resolves the native value per locale, never a fallback or the raw key", () => {
    for (const lang of LOCALE_IDS) {
      const t = createT(lang)
      for (const key of KEYS) {
        const native = (LOCALES[lang] as Record<string, string>)[key]
        expect(t(key), `${lang}:${key}`).toBe(native)
        expect(t(key), `${lang}:${key}`).not.toContain("ui.")
      }
    }
  })

  it("pt-br resolves from the canonical pt dictionary, never English", () => {
    const t = createT("pt-br")
    const ptDict = LOCALES["pt"] as Record<string, string>
    for (const key of KEYS) {
      expect(t(key), `pt-br:${key}`).toBe(ptDict[key])
    }
  })

  it("Italian publication strings match the user-facing contract exactly", () => {
    expect(createT("it")("ui.publicationLabel")).toBe("Aggiornato in Pictorium:")
    expect(createT("it")("ui.publicationUnknown")).toBe("Orario di aggiornamento non disponibile")
    expect(createT("en")("ui.publicationLabel")).toBe("Updated in Pictorium:")
    expect(createT("en")("ui.publicationUnknown")).toBe("Update time unavailable")
  })

  it("parameterized keys interpolate in every locale without leftover braces", () => {
    for (const lang of LOCALE_IDS) {
      const t = createT(lang)
      expect(t("ui.bulkDelete", { count: 3 }), lang).toContain("3")
      expect(t("ui.streamSelectedCount", { count: 2, lists: 5 }), lang).toContain("2")
      expect(t("ui.streamSelectedCount", { count: 2, lists: 5 }), lang).toContain("5")
      for (const key of ["ui.bulkDelete", "ui.bulkDeleteConfirm", "ui.streamAddCount", "ui.streamSelectedCount"]) {
        expect(t(key, { count: 2, lists: 5 }), `${lang}:${key}`).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
  })
})

function renderPublicationLine(lang: string, value: number | null) {
  const ctx = { t: createT(lang), lang, pickLang: () => {} } as unknown as PictoriumCtx
  return render(
    <TranslationProvider value={ctx}>
      <PublicationLine value={value} />
    </TranslationProvider>,
  )
}

describe("PublicationLine renders localized strings through the real t()", () => {
  it("shows the Italian label, colon, whitespace and a dated <time> element", () => {
    const stamp = 1761331200000
    const { container, unmount } = renderPublicationLine("it", stamp)
    try {
      const text = container.textContent ?? ""
      expect(text).toContain("Aggiornato in Pictorium:")
      expect(text).not.toContain("ui.")
      const time = container.querySelector("time")
      expect(time).not.toBeNull()
      expect(time!.getAttribute("dateTime")).toBe(new Date(stamp).toISOString())
      expect(time!.textContent ?? "").not.toContain("ui.")
      // Label, colon, whitespace, then the date (never glued, never English).
      expect(text).toMatch(/Aggiornato in Pictorium:\s/)
      expect(text).not.toContain("Updated in Pictorium:")
    } finally {
      unmount()
      cleanup()
    }
  })

  it("shows the honest Italian unavailable line for null/invalid stamps", () => {
    for (const bad of [null, 0, -1, NaN, "x", 946684799999] as unknown[]) {
      const { container, unmount } = renderPublicationLine("it", bad as number)
      try {
        expect(container.textContent ?? "").toContain("Orario di aggiornamento non disponibile")
        expect(container.textContent ?? "").not.toContain("ui.")
      } finally {
        unmount()
        cleanup()
      }
    }
  })
})
