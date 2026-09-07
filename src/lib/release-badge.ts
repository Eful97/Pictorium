export type UpcomingReleaseT = (key: string, params?: Record<string, string | number>) => string

import { t as tGlobal } from "./i18n"

export function getUpcomingReleaseLabel(input: {
  mediaType: "movie" | "tv"
  releaseDate?: string | null
  firstAirDate?: string | null
  locale?: string
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
  return translate("badge.upcomingRelease", { date: formatReleaseDate(date, input.locale ?? "it") })
}

function parseTmdbDate(value?: string | null): Date | null {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatReleaseDate(date: Date, locale: string): string {
  const d = date.toLocaleDateString(locale === "it" ? "it-IT" : locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
  return d.replaceAll("/", ".")
}
