/**
 * Regione paese per le classifiche JustWatch + FlixPatrol.
 *
 * JustWatch GraphQL vuole il `Country` ISO maiuscolo ("IT"), FlixPatrol vuole
 * lo slug minuscolo ("italy"), TMDB vuole il locale ("it-IT" — i titoli seguono
 * la regione: eng → titoli eng, france → titoli franc, ecc.).
 * Questo modulo è l'unica sorgente di verità per il mapping.
 */

export const DEFAULT_REGION = "IT" as const
export const GLOBAL_REGION_CODE = "GLOBAL" as const

export interface RegionDef {
  /** Codice JustWatch / ISO (usato anche come chiave canonica). */
  readonly code: string
  /** Slug FlixPatrol (`SUPPORTED_COUNTRIES` in flixpatrol.ts). */
  readonly flixSlug: string
  /** Locale TMDB + lingua query JustWatch. */
  readonly lang: string
  /**
   * Lingua UI a 2 lettere (stato `lang` dell'app, `preferred_lang`).
   * it/en/fr/de/es/pl/he/ar/tr/nl/sv/vi hanno un dizionario UI completo —
   * ja/ko/pt/cs ripiegano sull'inglese in `i18n.lookup` per le stringhe `ui.*`
   * (he/ar hanno badge/award tradotti), mentre i contenuti TMDB seguono `lang`.
   * `vi` è supportata solo come lingua UI (JustWatch non accetta VN come
   * paese chart): non ha una regione in REGIONS, vedi SUPPORTED_UI_LANGS.
   */
  readonly lang2: string
  /** Nome lingua in lingua nativa (per il selettore lingua). */
  readonly languageName: string
  /** Nome italiano per manifest/UI. */
  readonly label: string
  readonly flag: string
}

export const REGIONS: readonly RegionDef[] = [
  { code: "IT", flixSlug: "italy", lang: "it-IT", lang2: "it", languageName: "Italiano", label: "Italia", flag: "🇮🇹" },
  { code: "PL", flixSlug: "poland", lang: "pl-PL", lang2: "pl", languageName: "Polski", label: "Polonia", flag: "🇵🇱" },
  { code: "US", flixSlug: "united-states", lang: "en-US", lang2: "en", languageName: "English", label: "USA", flag: "🇺🇸" },
  { code: "GB", flixSlug: "united-kingdom", lang: "en-GB", lang2: "en", languageName: "English", label: "Regno Unito", flag: "🇬🇧" },
  { code: "FR", flixSlug: "france", lang: "fr-FR", lang2: "fr", languageName: "Français", label: "Francia", flag: "🇫🇷" },
  { code: "DE", flixSlug: "germany", lang: "de-DE", lang2: "de", languageName: "Deutsch", label: "Germania", flag: "🇩🇪" },
  { code: "ES", flixSlug: "spain", lang: "es-ES", lang2: "es", languageName: "Español", label: "Spagna", flag: "🇪🇸" },
  { code: "MX", flixSlug: "mexico", lang: "es-MX", lang2: "es", languageName: "Español (México)", label: "Messico", flag: "🇲🇽" },
  { code: "IL", flixSlug: "israel", lang: "he-IL", lang2: "he", languageName: "עברית", label: "Israele", flag: "🇮🇱" },
  { code: "JP", flixSlug: "japan", lang: "ja-JP", lang2: "ja", languageName: "日本語", label: "Giappone", flag: "🇯🇵" },
  { code: "KR", flixSlug: "south-korea", lang: "ko-KR", lang2: "ko", languageName: "한국어", label: "Corea del Sud", flag: "🇰🇷" },
  { code: "PT", flixSlug: "portugal", lang: "pt-PT", lang2: "pt", languageName: "Português", label: "Portogallo", flag: "🇵🇹" },
  { code: "BR", flixSlug: "brazil", lang: "pt-BR", lang2: "pt", languageName: "Português (Brasil)", label: "Brasile", flag: "🇧🇷" },
  { code: "IN", flixSlug: "india", lang: "en-IN", lang2: "en", languageName: "English", label: "India", flag: "🇮🇳" },
  { code: "CA", flixSlug: "canada", lang: "en-CA", lang2: "en", languageName: "English", label: "Canada", flag: "🇨🇦" },
  { code: "AU", flixSlug: "australia", lang: "en-AU", lang2: "en", languageName: "English", label: "Australia", flag: "🇦🇺" },
  { code: "CZ", flixSlug: "czech-republic", lang: "cs-CZ", lang2: "cs", languageName: "Čeština", label: "Cechia", flag: "🇨🇿" },
  { code: "RO", flixSlug: "romania", lang: "ro-RO", lang2: "ro", languageName: "Română", label: "Romania", flag: "🇷🇴" },
  { code: "SA", flixSlug: "saudi-arabia", lang: "ar-SA", lang2: "ar", languageName: "العربية", label: "Arabia Saudita", flag: "🇸🇦" },
  { code: "TR", flixSlug: "turkey", lang: "tr-TR", lang2: "tr", languageName: "Türkçe", label: "Turchia", flag: "🇹🇷" },
  { code: "NL", flixSlug: "netherlands", lang: "nl-NL", lang2: "nl", languageName: "Nederlands", label: "Paesi Bassi", flag: "🇳🇱" },
  { code: "SE", flixSlug: "sweden", lang: "sv-SE", lang2: "sv", languageName: "Svenska", label: "Svezia", flag: "🇸🇪" },
] as const

/** Global chart scope. The locale only localizes metadata; it does not select US ranks. */
export const GLOBAL_REGION: RegionDef = {
  code: GLOBAL_REGION_CODE, flixSlug: "global", lang: "en-US", lang2: "en",
  languageName: "English", label: "Mondiale", flag: "🌐",
}
export const CHART_REGIONS: readonly RegionDef[] = [GLOBAL_REGION, ...REGIONS]

const BY_CODE = new Map(CHART_REGIONS.map((r) => [r.code, r]))
const BY_FLIX_SLUG = new Map(REGIONS.map((r) => [r.flixSlug, r]))

/**
 * Parsa un input libero (codice "us"/"US", slug "united-states", con o senza
 * spazi/case) in un codice regione canonico. Ritorna null se sconosciuto
 * (fail-closed: il chiamante ripiega su DEFAULT_REGION, mai su fetch arbitrari).
 */
export function parseRegion(input: string | null | undefined): string | null {
  if (!input) return null
  const t = input.trim()
  if (!t) return null
  const upper = t.toUpperCase()
  if (BY_CODE.has(upper)) return upper
  const lower = t.toLowerCase()
  const bySlug = BY_FLIX_SLUG.get(lower)
  if (bySlug) return bySlug.code
  return null
}

/** Come parseRegion ma non ritorna mai null (fallback DEFAULT_REGION). */
export function normalizeRegion(input: string | null | undefined): string {
  return parseRegion(input) ?? DEFAULT_REGION
}

export function getRegionDef(code: string | null | undefined): RegionDef {
  return BY_CODE.get(normalizeRegion(code))!
}

/** Slug FlixPatrol per un codice regione (canonico, sempre valido). */
export function regionToFlixSlug(code: string | null | undefined): string {
  return getRegionDef(code).flixSlug
}

/** Codice JustWatch (= codice canonico) per uno slug FlixPatrol; null se fuori da quelli supportati. */
export function flixSlugToRegionCode(slug: string): string | null {
  return BY_FLIX_SLUG.get(slug)?.code ?? null
}

export function isSupportedRegionCode(code: string): boolean {
  return BY_CODE.has(code.toUpperCase())
}

export interface UiLangMeta {
  readonly code: string
  readonly flag: string
  readonly name: string
}

/**
 * Canonical source of UI languages (BCP47 code + display metadata).
 * Almost all are 2-letter codes; `es-419` (Latin American Spanish,
 * UN M.49 419) is the exception: UI-only, never sent to providers
 * (TMDB/JustWatch expect ISO639-1 + ISO3166, e.g. es-MX).
 * `SUPPORTED_UI_LANGS` (validazione, qui sotto) e `UI_LANGUAGES` (voci picker,
 * in utils.ts) derivano entrambi da questa lista: aggiungere una lingua
 * significa aggiungere una riga qui. `vi` è solo lingua UI senza regione
 * chart (JustWatch non accetta VN come paese): non compare in REGIONS ma è
 * in questa lista. Vive in regions.ts — e non in utils.ts — perché utils.ts
 * importa già regions.ts (l'inverso creerebbe una dipendenza circolare).
 */
export const UI_LANG_META: readonly UiLangMeta[] = [
  { code: "it", flag: "🇮🇹", name: "Italiano" },
  { code: "pl", flag: "🇵🇱", name: "Polski" },
  { code: "en", flag: "🇬🇧", name: "English" },
  { code: "fr", flag: "🇫🇷", name: "Français" },
  { code: "de", flag: "🇩🇪", name: "Deutsch" },
  { code: "es", flag: "🇪🇸", name: "Español" },
  { code: "es-419", flag: "🌎", name: "Español (Latinoamérica)" },
  { code: "ja", flag: "🇯🇵", name: "日本語" },
  { code: "ko", flag: "🇰🇷", name: "한국어" },
  { code: "pt", flag: "🇵🇹", name: "Português" },
  { code: "he", flag: "🇮🇱", name: "עברית" },
  { code: "cs", flag: "🇨🇿", name: "Čeština" },
  { code: "ro", flag: "🇷🇴", name: "Română" },
  { code: "ar", flag: "🇸🇦", name: "العربية" },
  { code: "tr", flag: "🇹🇷", name: "Türkçe" },
  { code: "nl", flag: "🇳🇱", name: "Nederlands" },
  { code: "sv", flag: "🇸🇪", name: "Svenska" },
  { code: "vi", flag: "🇻🇳", name: "Tiếng Việt" },
]

export const SUPPORTED_UI_LANGS: readonly string[] = UI_LANG_META.map((l) => l.code)

export function isSupportedUiLang(code: string | null | undefined): boolean {
  return !!code && (SUPPORTED_UI_LANGS as readonly string[]).includes(code.toLowerCase())
}

/** Localize poster metadata independently of chart country, preserving matching regional locales. */
export function contentLanguageForUiLang(lang: string | null | undefined, regionCode: string): string {
  const region = getRegionDef(regionCode)
  const code = lang?.toLowerCase()
  // es-419 is UI-only: providers always receive es-MX (valid TMDB locale
  // ISO639-1 + ISO3166; es-419 is never sent), in any chart.
  if (code === "es-419") return "es-MX"
  return isSupportedUiLang(code) && code !== region.lang2 ? code! : region.lang
}

/** Voce del selettore lingua per una regione: bandiera + paese + lingua. */
export function regionLangOption(regionCode: string): { key: string; lang: string; flag: string; name: string; sub: string } {
  const r = getRegionDef(regionCode)
  return { key: r.code, lang: r.lang2, flag: r.flag, name: `${r.label} · ${r.languageName}`, sub: r.lang2.toUpperCase() }
}

/**
 * Restituisce la regione predefinita per una lingua UI (es. "fr" -> "FR", "it" -> "IT", "de" -> "DE").
 * Se `currentRegion` appartiene già alla stessa famiglia linguistica (es. "GB" con lingua "en"), la mantiene.
 * Languages without a supported national chart select global rankings.
 * An explicitly selected global chart is preserved across language changes.
 */
export function defaultRegionForLang(lang: string | null | undefined, currentRegion?: string | null): string | null {
  if (!lang) return null
  const l = lang.toLowerCase().trim()
  if (!isSupportedUiLang(l)) return null
  if (parseRegion(currentRegion) === GLOBAL_REGION_CODE) return GLOBAL_REGION_CODE
  // es-419 shares the es family (ES/MX): the current Spanish region is
  // preserved as with "es" (never force a change of an explicit country).
  const family = l === "es-419" ? "es" : l
  if (currentRegion) {
    const cur = getRegionDef(currentRegion)
    if (cur && cur.lang2 === family) return cur.code
  }
  // Without a current region (or outside the family): the Latin American
  // variant points to Mexico (es-MX), never Spain; "es" stays on ES (historic).
  if (l === "es-419") return "MX"
  const found = REGIONS.find((r) => r.lang2 === l)
  return found?.code ?? GLOBAL_REGION_CODE
}
