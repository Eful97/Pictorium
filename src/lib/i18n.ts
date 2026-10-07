// Client-safe base: only the synchronous fallback dictionaries are bundled
// statically. Every other language is registered at runtime — eagerly on the
// server via "./i18n-server" (route entry points), on demand on the client via
// "./i18n-loader". The sync APIs below never change signature: before a
// language is registered they resolve through the English fallback.
import en from "./translations/en.json"
import it from "./translations/it.json"

export type Lang =
  | "en" | "it" | "pl" | "fr" | "de" | "es" | "es-419" | "ja" | "ko"
  | "pt" | "he" | "cs" | "ro" | "ar" | "tr" | "nl" | "sv" | "vi"

export type Dictionary = Record<string, string>

const dicts: Record<string, Dictionary> = { en, it }

let _currentLang: string = "it"

export const BADGE_KEY_PREFIX = "__"

export function isPrefixedKey(val: string): boolean {
  return val.startsWith(BADGE_KEY_PREFIX)
}

export function badgeKey(val: string): string {
  return isPrefixedKey(val) ? val.slice(BADGE_KEY_PREFIX.length) : val
}

export function resolveLabel(val: string): string {
  return isPrefixedKey(val) ? t(badgeKey(val)) : val
}

export function resolveLabelFor(val: string, lang: string): string {
  return isPrefixedKey(val) ? createT(lang)(badgeKey(val)) : val
}

export function isRankKey(val: string | null): string | null {
  if (!val) return null
  if (isPrefixedKey(val)) {
    const key = badgeKey(val)
    if (key === "badge.today" || key === "badge.anime" || key === "badge.movie" || key === "badge.series") return key
    return null
  }
  if (val === "Oggi" || val === "Today" || val === "Aujourd'hui" || val === "Heute" || val === "Hoy" || val === "今日" || val === "오늘" || val === "Hoje" || val === "היום" || val === "Dnes" || val === "Dzisiaj" || val === "Azi" || val === "Astăzi" || val === "Astazi" || val === "اليوم" || val === "Bugün" || val === "Vandaag" || val === "Idag" || val === "Hôm nay") return "badge.today"
  if (val === "Anime" || val === "アニメ" || val === "애니메이션" || val === "אנימה" || val === "أنمي") return "badge.anime"
  if (val === "Film" || val === "Movie" || val === "Película" || val === "映画" || val === "영화" || val === "Filme" || val === "סרט" || val === "فيلم" || val === "Phim") return "badge.movie"
  if (val === "Serie tv" || val === "TV series" || val === "Series" || val === "Série TV" || val === "Série" || val === "Serie de TV" || val === "Serie" || val === "TVシリーズ" || val === "TV 시리즈" || val === "סדרה" || val === "Seriál" || val === "Serial" || val === "Seriale" || val === "مسلسل" || val === "مسلسلات" || val === "Dizi" || val === "Phim truyền hình") return "badge.series"
  return null
}

export function setLang(lang: string) {
  _currentLang = lang
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang
  }
}

export function getLang(): string {
  return _currentLang
}

export function canonicalDictLang(lang: string): string {
  const c = lang.toLowerCase()
  // The canonical TMDB locale es-MX has no dedicated UI dictionary: it
  // reuses the Latin American one (never the English fallback).
  if (c === "es-mx") return "es-419"
  return c
}

/**
 * Register (or replace) the dictionary for a language. Server entry points
 * register every language eagerly via "./i18n-server"; the client loader
 * registers one language per dynamic import. Overwriting is idempotent: the
 * same content registered twice resolves identically.
 */
export function registerDictionary(lang: string, dict: Dictionary): void {
  dicts[canonicalDictLang(lang)] = dict
}

export function isDictionaryLoaded(lang: string): boolean {
  return dicts[canonicalDictLang(lang)] !== undefined
}

export function getDictionary(lang: string): Dictionary | undefined {
  return dicts[canonicalDictLang(lang)]
}

function lookup(lang: string, key: string): string | undefined {
  return dicts[canonicalDictLang(lang)]?.[key] ?? dicts["en"]?.[key]
}

export function t(key: string, params?: Record<string, string | number>): string {
  let val = lookup(_currentLang, key) ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replaceAll(`{${k}}`, String(v))
    }
  }
  return val
}

export function createT(lang: string) {
  return (key: string, params?: Record<string, string | number>): string => {
    let val = lookup(lang, key) ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        val = val.replaceAll(`{${k}}`, String(v))
      }
    }
    return val
  }
}
