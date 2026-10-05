import type { TMDBImage, SearchResult } from "./types"

import { REGIONS, UI_LANG_META } from "./regions"

export const IMG_BASE = process.env.NEXT_PUBLIC_TMDB_IMG_URL || "https://image.tmdb.org/t/p"

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ")
}

export const LANG_FLAGS: Record<string, string> = {
  it: "🇮🇹", en: "🇬🇧", fr: "🇫🇷", de: "🇩🇪", es: "🇪🇸", "es-419": "🌎", pt: "🇵🇹",
  ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", ru: "🇷🇺", ar: "🇸🇦", nl: "🇳🇱",
  pl: "🇵🇱", sv: "🇸🇪", tr: "🇹🇷", hi: "🇮🇳", he: "🇮🇱", ro: "🇷🇴",
  cs: "🇨🇿", da: "🇩🇰", no: "🇳🇴", fi: "🇫🇮", el: "🇬🇷", hu: "🇭🇺",
  uk: "🇺🇦", th: "🇹🇭", id: "🇮🇩", vi: "🇻🇳",
}

export const LANG_NAMES: Record<string, string> = {
  en: "English", it: "Italiano", fr: "Français", de: "Deutsch",
  es: "Español", "es-419": "Español (Latinoamérica)", pt: "Português", ja: "日本語", ko: "한국어",
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

/** Vero quando il valore è un URL http(s) esterno (base custom), non un path TMDB. */
export function isCustomPosterUrl(value: string | null | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  return v.startsWith("http://") || v.startsWith("https://")
}

export interface PosterSaveSplit {
  /** posterPath da persistere (sempre path TMDB di fallback, mai URL). */
  readonly posterPath: string
  /** customPosterUrl da persistere (null = nessuna base custom). */
  readonly customPosterUrl: string | null
}

/**
 * Split del save quando il poster selezionato può essere un tile custom.
 * Tile custom → posterPath resta il riferimento TMDB (fallback del render se
 * l'URL muore) e l'URL va in customPosterUrl. Tile TMDB → custom azzerato: il
 * save congela lo stato mostrato, quindi tornare a un tile TMDB rimuove la
 * base custom precedentemente salvata.
 */
export function splitCustomPosterSave(previewFilePath: string, tmdbRef: string | null): PosterSaveSplit {
  if (isCustomPosterUrl(previewFilePath)) {
    const fallback = tmdbRef && !isCustomPosterUrl(tmdbRef) ? tmdbRef : previewFilePath
    return { posterPath: fallback, customPosterUrl: previewFilePath.trim() }
  }
  return { posterPath: previewFilePath, customPosterUrl: null }
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
 * Voci del selettore paese-chart: SOLO le nazionalità supportate (una per
 * regione). `key` è il codice paese (univoco), `code` la lingua UI a 2 lettere.
 * Lo step lingua dell'onboarding usa invece UI_LANGUAGES (include `vi`,
 * solo lingua UI senza regione chart).
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
 * Le lingue selezionabili per l'interfaccia: derivate dalla fonte canonica
 * UI_LANG_META (regions.ts) con l'aggiunta del sottotitolo display.
 * Include `vi` (solo lingua UI, senza regione chart: JustWatch non accetta VN).
 * Deterministic alphabetical order by native name (not by code/flag):
 * the canonical UI_LANG_META list stays untouched (validators/defaults);
 * only a shared display copy is sorted here, consumed by all pickers
 * (LangPicker language step, PrefsPanel language select).
 */
const UI_LANG_COLLATOR = new Intl.Collator("en", { sensitivity: "base" })

export const UI_LANGUAGES: readonly UiLangOption[] = UI_LANG_META.map((l) => ({
  code: l.code,
  flag: l.flag,
  name: l.name,
  sub: l.code.toUpperCase(),
})).sort((a, b) => UI_LANG_COLLATOR.compare(a.name, b.name))

export interface ImageLists {
  posters: TMDBImage[]
  logos: TMDBImage[]
  backdrops: TMDBImage[]
}

/**
 * Fonde due risposte /images TMDB (default + allargata alla lingua originale),
 * deduplicando per file_path. La prima lista vince a parità di path.
 * Spostata qui da context.tsx (move wholesale, logica identica).
 */
export function mergeImageLists(base: ImageLists, extra: ImageLists): ImageLists {
  const merge = (a: TMDBImage[], b: TMDBImage[]): TMDBImage[] => {
    const seen = new Set(a.map((img) => img.file_path))
    const out = [...a]
    for (const img of b) {
      if (!seen.has(img.file_path)) {
        seen.add(img.file_path)
        out.push(img)
      }
    }
    return out
  }
  return {
    posters: merge(base.posters || [], extra.posters || []),
    logos: merge(base.logos || [], extra.logos || []),
    backdrops: merge(base.backdrops || [], extra.backdrops || []),
  }
}
