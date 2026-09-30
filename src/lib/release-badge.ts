export type UpcomingReleaseT = (key: string, params?: Record<string, string | number>) => string

import { t as tGlobal } from "./i18n"

/**
 * Formato della data nel badge "in uscita": `locale` segue la lingua UI
 * (it → DD.MM.AA, en → MM.DD.AA), gli altri sono espliciti e uguali in
 * ogni lingua. Default `locale` (byte-identico al passato).
 */
export type DateFormat = "locale" | "dmy" | "mdy" | "iso"

export function parseDateFormat(value: string | null | undefined): DateFormat | null {
  if (value === "locale" || value === "dmy" || value === "mdy" || value === "iso") return value
  return null
}

export function getUpcomingReleaseLabel(input: {
  mediaType: "movie" | "tv"
  releaseDate?: string | null
  firstAirDate?: string | null
  locale?: string
  /** Formato data (default `locale`): da query `df` > default utente. */
  dateFormat?: DateFormat | null
  /** Traduttore per la label — default `t` globale (M14: "In uscita" non è più hardcodato). */
  t?: UpcomingReleaseT
}): string | null {
  // Film: release_date futura. Serie TV: first_air_date futura (serie annunciate
  // ma non ancora in onda — prima le serie future non avevano alcun badge).
  const raw = input.mediaType === "movie" ? input.releaseDate : input.firstAirDate
  const date = parseTmdbDate(raw)
  if (!date) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (date.getTime() <= today.getTime()) return null

  const translate = input.t ?? tGlobal
  return translate("badge.upcomingRelease", { date: formatReleaseDate(date, input.locale ?? "it", input.dateFormat ?? "locale") })
}

function parseTmdbDate(value?: string | null): Date | null {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatReleaseDate(date: Date, locale: string, dateFormat: DateFormat): string {
  // Formati espliciti: uguali in ogni lingua, anno a 2 cifre per dmy/mdy
  // (stessa larghezza badge del passato), ISO a 4 cifre (non ambiguo).
  if (dateFormat !== "locale") {
    const p2 = (n: number) => String(n).padStart(2, "0")
    const dd = p2(date.getDate())
    const mm = p2(date.getMonth() + 1)
    const yy = p2(date.getFullYear() % 100)
    if (dateFormat === "dmy") return `${dd}.${mm}.${yy}`
    if (dateFormat === "mdy") return `${mm}.${dd}.${yy}`
    return `${date.getFullYear()}-${mm}-${dd}`
  }
  // Calendario gregoriano + cifre latine SEMPRE: con `ar` il default sarebbe
  // il calendario islamico (2026 -> anno 26!) con cifre arabo-indiche.
  // Le estensioni unicode `-u-ca-gregory-nu-latn` valgono per ogni locale
  // senza cambiare il formato degli altri (it/de/he invariati).
  const base = locale === "it" ? "it-IT" : locale
  const tag = base.includes("-u-") ? base : `${base}-u-ca-gregory-nu-latn`
  const d = date.toLocaleDateString(tag, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
  // toLocaleDateString arabo inserisce marchi direzionali invisibili
  // (RLM/LRM/ALM): spogliarli, o falserebbero la stima larghezza badge.
  return d.replace(/[\u200E\u200F\u061C]/g, "").replaceAll("/", ".")
}
