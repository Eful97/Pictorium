import {
  canonicalDictLang,
  getDictionary,
  registerDictionary,
  type Dictionary,
} from "./i18n"

type DictModule = { default: Dictionary }

/**
 * Explicit per-language chunks. `en`/`it` are already bundled in "./i18n"
 * (synchronous fallback) and need no loader entry.
 *
 * Each language keeps its own literal import path. This explicit map is the
 * reliable way to keep one chunk per language instead of collapsing them
 * into a single context chunk via a variable/template-string path.
 */
const loaders: Record<string, () => Promise<DictModule>> = {
  pl: () => import("./translations/pl.json"),
  fr: () => import("./translations/fr.json"),
  de: () => import("./translations/de.json"),
  es: () => import("./translations/es.json"),
  "es-419": () => import("./translations/es-419.json"),
  ja: () => import("./translations/ja.json"),
  ko: () => import("./translations/ko.json"),
  pt: () => import("./translations/pt.json"),
  he: () => import("./translations/he.json"),
  cs: () => import("./translations/cs.json"),
  ro: () => import("./translations/ro.json"),
  ar: () => import("./translations/ar.json"),
  tr: () => import("./translations/tr.json"),
  nl: () => import("./translations/nl.json"),
  sv: () => import("./translations/sv.json"),
  vi: () => import("./translations/vi.json"),
}

// Coalesces concurrent loads of the same language into a single import.
const inflight = new Map<string, Promise<Dictionary>>()

/**
 * Ensure the dictionary for `lang` is registered, fetching its chunk on
 * first use. Resolves to the registered dictionary (same object identity for
 * concurrent callers). Unknown languages resolve to the English fallback
 * without a network fetch. Failures are never cached: `inflight` is cleared
 * on error so a retry re-attempts the import.
 */
export function loadLanguage(lang: string): Promise<Dictionary> {
  const canonical = canonicalDictLang(lang)
  const existing = getDictionary(canonical)
  if (existing) return Promise.resolve(existing)
  const pending = inflight.get(canonical)
  if (pending) return pending
  const loader = loaders[canonical]
  if (!loader) {
    return Promise.resolve(getDictionary("en") as Dictionary)
  }
  const next = loader().then(
    (mod) => {
      registerDictionary(canonical, mod.default)
      inflight.delete(canonical)
      return mod.default
    },
    (err) => {
      inflight.delete(canonical)
      throw err
    },
  )
  inflight.set(canonical, next)
  return next
}
