import type { TMDBImage, SearchResult } from "./types"

import { REGIONS } from "./regions"

export const IMG_BASE = process.env.NEXT_PUBLIC_TMDB_IMG_URL || "https://image.tmdb.org/t/p"

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ")
}

export const LANG_FLAGS: Record<string, string> = {
  it: "🇮🇹", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", pt: "🇵🇹",
  ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", ru: "🇷🇺", ar: "🇸🇦", nl: "🇳🇱",
  pl: "🇵🇱", sv: "🇸🇪", tr: "🇹🇷", hi: "🇮🇳", he: "🇮🇱", ro: "🇷🇴",
  cs: "🇨🇿", da: "🇩🇰", no: "🇳🇴", fi: "🇫🇮", el: "🇬🇷", hu: "🇭🇺",
  uk: "🇺🇦", th: "🇹🇭", id: "🇮🇩", vi: "🇻🇳",
}

export const LANG_NAMES: Record<string, string> = {
  en: "English", it: "Italiano", fr: "Français", de: "Deutsch",
  es: "Español", pt: "Português", ja: "日本語", ko: "한국어",
  zh: "中文", ru: "Русский", ar: "العربية", nl: "Nederlands",
  pl: "Polski", sv: "Svenska", tr: "Türkçe", hi: "हिन्दी",
  he: "עברית", ro: "Română", cs: "Čeština", da: "Dansk",
  no: "Norsk", fi: "Suomi", el: "Ελληνικά", hu: "Magyar",
  uk: "Українська", th: "ไทย", id: "Bahasa Indonesia", vi: "Tiếng Việt",
  xx: "Senza lingua",
}

export function getDomain() {
  if (typeof window === "undefined") return ""
  return `${window.location.protocol}//${window.location.host}`
}

export function posterUrl(path: string, size = "w342") {
  if (path.startsWith("http")) return path
  return `${IMG_BASE}/${size}${path}`
}

export function titleOf(r: SearchResult) {
  return r.title || r.name || "Unknown"
}

export function yearOf(r: SearchResult) {
  const d = r.release_date || r.first_air_date
  return d ? d.slice(0, 4) : ""
}

export function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = fn(item)
    ;(acc[key] = acc[key] || []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}

export function limitBest(imgs: TMDBImage[], max = 15): TMDBImage[] {
  return [...imgs].sort((a, b) => b.vote_average - a.vote_average).slice(0, max)
}

export const STREAMING_PLATFORMS = [
  { slug: "netflix", name: "Netflix", icon: "" },
  { slug: "amazon-prime", name: "Prime Video", icon: "" },
  { slug: "disney", name: "Disney+", icon: "" },
  { slug: "now", name: "NOW / Sky", icon: "" },
  { slug: "apple-tv", name: "Apple TV+", icon: "" },
  { slug: "hbo-max", name: "HBO Max", icon: "" },
  { slug: "paramount-plus", name: "Paramount+", icon: "" },
  { slug: "crunchyroll", name: "Crunchyroll", icon: "" },
] as const

/**
 * Voci del selettore lingua: SOLO le nazionalità supportate (una per
 * regione). `key` è il codice paese (univoco), `code` la lingua UI a 2 lettere
 * (it/pl/en/fr/de/es/he/ar hanno un dizionario completo — ja/ko/pt/cs/ro
 * ripiegano sull'inglese in `i18n.lookup` per le chiavi che non traducono).
 */
export const PICKER_LANGS = REGIONS.map((r) => ({
  key: r.code,
  code: r.lang2,
  flag: r.flag,
  name: `${r.label} · ${r.languageName}`,
  sub: r.lang2.toUpperCase(),
}))

export interface UiLangOption {
  code: string
  flag: string
  name: string
  sub: string
}

/**
 * Le lingue selezionabili per l'interfaccia. it/pl/en/fr/de/es/he/ar hanno
 * un dizionario completo; `ja/ko/pt/cs/ro` ripiegano sull'inglese per le
 * stringhe `ui.*` (vedi translations/).
 */
export const UI_LANGUAGES: readonly UiLangOption[] = [
  { code: "it", flag: "🇮🇹", name: "Italiano", sub: "IT" },
  { code: "pl", flag: "🇵🇱", name: "Polski", sub: "PL" },
  { code: "en", flag: "🇬🇧", name: "English", sub: "EN" },
  { code: "fr", flag: "🇫🇷", name: "Français", sub: "FR" },
  { code: "de", flag: "🇩🇪", name: "Deutsch", sub: "DE" },
  { code: "es", flag: "🇪🇸", name: "Español", sub: "ES" },
  { code: "ja", flag: "🇯🇵", name: "日本語", sub: "JA" },
  { code: "ko", flag: "🇰🇷", name: "한국어", sub: "KO" },
  { code: "pt", flag: "🇵🇹", name: "Português", sub: "PT" },
  { code: "he", flag: "🇮🇱", name: "עברית", sub: "HE" },
  { code: "cs", flag: "🇨🇿", name: "Čeština", sub: "CS" },
  { code: "ro", flag: "🇷🇴", name: "Română", sub: "RO" },
  { code: "ar", flag: "🇸🇦", name: "العربية", sub: "AR" },
] as const
